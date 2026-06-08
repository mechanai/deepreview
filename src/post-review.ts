import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { parseThreads } from "./parse-threads.ts";
import { type Finding, type ClassifiedFinding } from "./diff-classifier.ts";
import { type PrInfo, getPrInfo, execFileAsync } from "./graphql.ts";
import {
  type PendingReview,
  findPendingReview,
  createPendingReview,
  updateReviewBody,
  addLineThread,
  addFileThread,
  updateReviewComment,
} from "./review-api.ts";
import {
  isValidPath,
  isRateLimitError,
  findingId,
  embedFindingId,
  extractFindingId,
  buildReviewBody,
  classifyAndLog,
} from "./review-helpers.ts";

export interface PostReviewOptions {
  threadsPath: string;
  prNumber: number;
  dryRun?: boolean;
  skipIds?: string[];
  expectedSha?: string;
  cwd?: string;
  diffText?: string;
}

export interface PostReviewResult {
  summary: string;
  failed: string[];
}

const MAX_INLINE_FINDINGS = 200;

async function updateExistingThreads(
  existingReview: PendingReview,
  findings: ClassifiedFinding[],
): Promise<Set<string>> {
  const existingComments = existingReview.comments.nodes;
  const existingById = new Map<string, { id: string; body: string }>();
  for (const c of existingComments) {
    const id = extractFindingId(c.body);
    if (id !== null) existingById.set(id, c);
  }

  const toUpdate: Array<{ finding: ClassifiedFinding; commentId: string; id: string }> = [];
  for (const f of findings) {
    const id = findingId(f.path, f.startLine, f.line, f.body);
    const existing = existingById.get(id);
    if (existing) {
      toUpdate.push({ finding: f, commentId: existing.id, id });
    }
  }

  const CONCURRENCY = 2;
  for (let i = 0; i < toUpdate.length; i += CONCURRENCY) {
    if (i > 0) await Bun.sleep(1000);
    const batch = toUpdate.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ finding, commentId, id }) => {
        const body = embedFindingId(finding.body, id);
        await updateReviewComment(commentId, body);
      }),
    );
  }

  console.log(`Updated ${toUpdate.length} existing threads.`);
  return new Set(toUpdate.map(({ id }) => id));
}

async function postThread(
  reviewId: string,
  finding: ClassifiedFinding,
  body: string,
): Promise<void> {
  if (finding.tier === 1) {
    await addLineThread(reviewId, finding.path, finding.line, finding.startLine, body);
  } else {
    await addFileThread(reviewId, finding.path, body);
  }
}

async function postWithRetry(
  reviewId: string,
  finding: ClassifiedFinding,
  body: string,
): Promise<boolean> {
  try {
    await postThread(reviewId, finding, body);
    return true;
  } catch (err: unknown) {
    if (!isRateLimitError(err)) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`FAIL: ${finding.path}:${finding.line} — ${message}`);
      return false;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      console.warn(
        `Rate limited on ${finding.path}:${finding.line}. Waiting 60s (retry ${attempt + 1}/2)...`,
      );
      await Bun.sleep(60_000 + Math.floor(Math.random() * 10_000));
      try {
        await postThread(reviewId, finding, body);
        return true;
      } catch (retryErr: unknown) {
        if (!isRateLimitError(retryErr)) {
          const message = retryErr instanceof Error ? retryErr.message : String(retryErr);
          console.error(`FAIL: ${finding.path}:${finding.line} — ${message}`);
          return false;
        }
      }
    }
    console.error(`FAIL: ${finding.path}:${finding.line} — rate limited after retries`);
    return false;
  }
}

async function postInlineThreads(
  reviewId: string,
  inlineFindings: ClassifiedFinding[],
  updatedIds: Set<string>,
): Promise<string[]> {
  const CONCURRENCY = 2;
  const failedFindings: string[] = [];
  const pending = inlineFindings.filter(
    (f) => !updatedIds.has(findingId(f.path, f.startLine, f.line, f.body)),
  );

  if (pending.length > MAX_INLINE_FINDINGS) {
    console.warn(
      `WARN: ${pending.length} inline findings exceed limit of ${MAX_INLINE_FINDINGS}. Truncating.`,
    );
  }
  const capped = pending.slice(0, MAX_INLINE_FINDINGS);

  for (let i = 0; i < capped.length; i += CONCURRENCY) {
    if (i > 0) await Bun.sleep(1000);
    const batch = capped.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (f) => {
        const id = findingId(f.path, f.startLine, f.line, f.body);
        // Body rendered by GitHub's Markdown sanitizer; no escaping needed here
        const body = embedFindingId(f.body, id);
        const ok = await postWithRetry(reviewId, f, body);
        return ok ? null : id;
      }),
    );
    for (const id of results) {
      if (id !== null) failedFindings.push(id);
    }
  }
  return failedFindings;
}

async function ensureReview(
  prNodeId: string,
  headOid: string,
  tier1: ClassifiedFinding[],
  tier2: ClassifiedFinding[],
  tier3: ClassifiedFinding[],
  owner: string,
  name: string,
  summary?: string,
): Promise<{ reviewId: string; updatedFindings: Set<string> }> {
  const existingReview = await findPendingReview(prNodeId);
  if (existingReview) {
    console.log(`Found existing pending review: ${existingReview.id}`);
    await updateReviewBody(
      existingReview.id,
      buildReviewBody(tier3, owner, name, headOid, summary),
    );
    const updated = await updateExistingThreads(existingReview, [...tier1, ...tier2]);
    return { reviewId: existingReview.id, updatedFindings: updated };
  }
  const reviewId = await createPendingReview(
    prNodeId,
    headOid,
    buildReviewBody(tier3, owner, name, headOid, summary),
  );
  console.log(`Created pending review: ${reviewId}`);
  return { reviewId, updatedFindings: new Set() };
}

async function loadAndValidatePr(
  threadsPath: string,
  prNumber: number,
  expectedSha: string | undefined,
  cwd: string | undefined,
): Promise<{ findings: Finding[]; prInfo: PrInfo; summary?: string } | null> {
  if (!isValidPath(threadsPath)) {
    throw new Error(`Invalid threadsPath: ${threadsPath}`);
  }
  // cwd is a trusted parameter set by the plugin framework (not user-supplied)
  const base = await realpath(resolve(cwd ?? process.cwd()));
  const candidatePath = resolve(base, threadsPath);
  let resolved: string;
  try {
    resolved = await realpath(candidatePath);
  } catch {
    throw new Error(`Threads file not found: ${candidatePath}`);
  }
  if (!resolved.startsWith(base + "/") && resolved !== base) {
    throw new Error(`threadsPath escapes working directory: ${threadsPath}`);
  }
  const content = await readFile(resolved, "utf8");
  const { findings, summary } = parseThreads(content);
  if (findings.length === 0 && (summary === undefined || summary === "")) return null;

  const prInfo = await getPrInfo(prNumber, { cwd });
  if (prInfo.state !== "OPEN") {
    throw new Error(`PR is ${prInfo.state}. Aborting.`);
  }

  const resolvedSha = expectedSha ?? process.env.PR_HEAD_SHA;
  if (resolvedSha !== undefined && resolvedSha !== "" && resolvedSha !== prInfo.headOid) {
    throw new Error(`ABORT: PR head moved (expected ${resolvedSha}, got ${prInfo.headOid}).`);
  }

  return { findings, prInfo, summary };
}

async function postFindings(
  tier1: ClassifiedFinding[],
  tier2: ClassifiedFinding[],
  tier3: ClassifiedFinding[],
  prInfo: PrInfo,
  skipIds: string[],
  summary?: string,
): Promise<PostReviewResult> {
  const { owner, name, prNodeId, headOid } = prInfo;
  const { reviewId, updatedFindings } = await ensureReview(
    prNodeId,
    headOid,
    tier1,
    tier2,
    tier3,
    owner,
    name,
    summary,
  );

  const skipSet = new Set(skipIds);
  const inlineFindings = [...tier1, ...tier2].filter((f) => {
    const id = findingId(f.path, f.startLine, f.line, f.body);
    return !skipSet.has(id);
  });

  const failedIds = await postInlineThreads(reviewId, inlineFindings, updatedFindings);
  const skipped = inlineFindings.filter((f) =>
    updatedFindings.has(findingId(f.path, f.startLine, f.line, f.body)),
  ).length;
  const pending = inlineFindings.length - skipped;
  const truncatedCount = Math.max(0, pending - MAX_INLINE_FINDINGS);
  const posted = Math.min(pending, MAX_INLINE_FINDINGS) - failedIds.length;
  const totalFindings = [...tier1, ...tier2].length;
  const skippedByUser = totalFindings - inlineFindings.length;
  const statusSummary =
    `Posted ${posted}/${totalFindings} inline threads (${skipped} up-to-date, ${skippedByUser} skipped, ${failedIds.length} failed${truncatedCount > 0 ? `, ${truncatedCount} truncated` : ""}). ` +
    `${tier3.length} findings in review body.`;

  console.log(statusSummary);

  return { summary: statusSummary, failed: failedIds };
}

export async function postReview(opts: PostReviewOptions): Promise<PostReviewResult> {
  const { threadsPath, prNumber, dryRun = false, skipIds = [], expectedSha } = opts;

  const result = await loadAndValidatePr(threadsPath, prNumber, expectedSha, opts.cwd);
  if (!result) return { summary: "No findings to post.", failed: [] };

  const { findings, prInfo, summary: reviewSummary } = result;

  const diff =
    opts.diffText ??
    (
      await execFileAsync("gh", ["pr", "diff", String(prNumber)], {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        signal: AbortSignal.timeout(30_000),
        cwd: opts.cwd,
      })
    ).stdout;
  const { tier1, tier2, tier3 } = classifyAndLog(findings, diff);

  if (dryRun) {
    return {
      summary: `Dry run: ${tier1.length} line-level, ${tier2.length} file-level, ${tier3.length} review-body findings.`,
      failed: [],
    };
  }

  return postFindings(tier1, tier2, tier3, prInfo, skipIds, reviewSummary);
}
