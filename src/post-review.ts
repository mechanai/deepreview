import { type ClassifiedFinding } from "./diff-classifier.ts";
import { type PrInfo, execFileAsync } from "./graphql.ts";
import {
  type PendingReview,
  findPendingReview,
  createPendingReview,
  updateReviewBody,
  addLineThread,
  addFileThread,
  updateReviewComment,
  replyToThread,
} from "./review-api.ts";
import {
  isRateLimitError,
  findingId,
  embedFindingId,
  extractFindingId,
  buildReviewBody,
  classifyAndLog,
} from "./review-helpers.ts";
import { loadAndValidatePr } from "./load-pr.ts";

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
        const body = embedFindingId(finding.renderedBody ?? finding.body, id);
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
        const body = embedFindingId(f.renderedBody ?? f.body, id);
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

async function tryReplyWithRetry(finding: ClassifiedFinding, body: string): Promise<boolean> {
  try {
    await replyToThread(finding.replyTo!, body);
    return true;
  } catch (err: unknown) {
    if (!isRateLimitError(err)) return false;
    console.warn(`Rate limited on reply to ${finding.replyTo}. Waiting 60s...`);
    await Bun.sleep(60_000 + Math.floor(Math.random() * 10_000));
    try {
      await replyToThread(finding.replyTo!, body);
      return true;
    } catch {
      return false;
    }
  }
}

async function postReplyThreads(
  replyFindings: ClassifiedFinding[],
  reviewId: string,
): Promise<string[]> {
  const CONCURRENCY = 2;
  const failedIds: string[] = [];

  for (let i = 0; i < replyFindings.length; i += CONCURRENCY) {
    if (i > 0) await Bun.sleep(1000);
    const batch = replyFindings.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (f) => {
        const id = findingId(f.path, f.startLine, f.line, f.body);
        const body = embedFindingId(f.renderedBody ?? f.body, id);
        const replied = await tryReplyWithRetry(f, body);
        if (replied) return null;
        console.warn(`WARN: Reply to thread ${f.replyTo} failed. Falling back to new thread.`);
        const ok = await postWithRetry(reviewId, f, body);
        return ok ? null : id;
      }),
    );
    for (const id of results) {
      if (id !== null) failedIds.push(id);
    }
  }
  return failedIds;
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
  const allInline = [...tier1, ...tier2].filter((f) => {
    const id = findingId(f.path, f.startLine, f.line, f.body);
    return !skipSet.has(id);
  });

  // Split into reply findings and new findings
  const replyFindings = allInline.filter(
    (f) =>
      f.replyTo !== undefined &&
      !updatedFindings.has(findingId(f.path, f.startLine, f.line, f.body)),
  );
  const newFindings = allInline.filter((f) => f.replyTo === undefined);

  const replyFailedIds = await postReplyThreads(replyFindings, reviewId);
  const newFailedIds = await postInlineThreads(reviewId, newFindings, updatedFindings);

  const failedIds = [...replyFailedIds, ...newFailedIds];
  const skipped = newFindings.filter((f) =>
    updatedFindings.has(findingId(f.path, f.startLine, f.line, f.body)),
  ).length;
  const pendingNew = newFindings.length - skipped;
  const postedNew = Math.min(pendingNew, MAX_INLINE_FINDINGS) - newFailedIds.length;
  const postedReplies = replyFindings.length - replyFailedIds.length;
  const totalFindings = [...tier1, ...tier2].length;
  const truncated = Math.max(0, pendingNew - MAX_INLINE_FINDINGS);
  const statusSummary =
    `Posted ${postedNew + postedReplies}/${totalFindings} inline threads` +
    ` (${postedReplies} replies, ${skipped} up-to-date, ${totalFindings - allInline.length} skipped, ${failedIds.length} failed${truncated > 0 ? `, ${truncated} truncated` : ""}). ${tier3.length} findings in review body.`;

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
