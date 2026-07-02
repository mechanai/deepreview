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
const BATCH_CONCURRENCY = 2;
const BATCH_DELAY_MS = 1000;

/** Process items in batches with concurrency and inter-batch delay. */
async function mapBatch<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += BATCH_CONCURRENCY) {
    if (i > 0) await Bun.sleep(BATCH_DELAY_MS);
    results.push(...(await Promise.all(items.slice(i, i + BATCH_CONCURRENCY).map(fn))));
  }
  return results;
}

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

  await mapBatch(toUpdate, async ({ finding, commentId, id }) => {
    const body = embedFindingId(finding.renderedBody ?? finding.body, id);
    await updateReviewComment(commentId, body);
  });

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

const RATE_LIMIT_DELAY_MS = 60_000;
const RATE_LIMIT_JITTER_MS = 10_000;
const MAX_RATE_LIMIT_RETRIES = 2;

/** Retry an async operation with rate-limit-aware backoff. Returns true on success. */
async function withRateLimitRetry(
  fn: () => Promise<void>,
  label: string,
  maxRetries: number = MAX_RATE_LIMIT_RETRIES,
): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err: unknown) {
    if (!isRateLimitError(err)) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`FAIL: ${label} — ${message}`);
      return false;
    }
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      console.warn(`Rate limited on ${label}. Waiting 60s (retry ${attempt + 1}/${maxRetries})...`);
      await Bun.sleep(RATE_LIMIT_DELAY_MS + Math.floor(Math.random() * RATE_LIMIT_JITTER_MS));
      try {
        await fn();
        return true;
      } catch (retryErr: unknown) {
        if (!isRateLimitError(retryErr)) {
          const message = retryErr instanceof Error ? retryErr.message : String(retryErr);
          console.error(`FAIL: ${label} — ${message}`);
          return false;
        }
      }
    }
    console.error(`FAIL: ${label} — rate limited after retries`);
    return false;
  }
}

async function postWithRetry(
  reviewId: string,
  finding: ClassifiedFinding,
  body: string,
): Promise<boolean> {
  return withRateLimitRetry(
    async () => postThread(reviewId, finding, body),
    `${finding.path}:${finding.line}`,
  );
}

async function postInlineThreads(
  reviewId: string,
  inlineFindings: ClassifiedFinding[],
  updatedIds: Set<string>,
): Promise<string[]> {
  const pending = inlineFindings.filter(
    (f) => !updatedIds.has(findingId(f.path, f.startLine, f.line, f.body)),
  );

  if (pending.length > MAX_INLINE_FINDINGS) {
    console.warn(
      `WARN: ${pending.length} inline findings exceed limit of ${MAX_INLINE_FINDINGS}. Truncating.`,
    );
  }
  const capped = pending.slice(0, MAX_INLINE_FINDINGS);

  const results = await mapBatch(capped, async (f) => {
    const id = findingId(f.path, f.startLine, f.line, f.body);
    const body = embedFindingId(f.renderedBody ?? f.body, id);
    const ok = await postWithRetry(reviewId, f, body);
    return ok ? null : id;
  });
  return results.filter((id): id is string => id !== null);
}

async function postReplyThreads(
  replyFindings: ClassifiedFinding[],
  reviewId: string,
): Promise<string[]> {
  const results = await mapBatch(replyFindings, async (f) => {
    const id = findingId(f.path, f.startLine, f.line, f.body);
    const body = embedFindingId(f.renderedBody ?? f.body, id);
    const threadId = f.replyTo!;
    const replied = await withRateLimitRetry(
      async () => replyToThread(threadId, body),
      `reply to ${threadId}`,
    );
    if (replied) return null;
    console.warn(`WARN: Reply to thread ${threadId} failed. Falling back to new thread.`);
    const ok = await postWithRetry(reviewId, f, body);
    return ok ? null : id;
  });
  return results.filter((id): id is string => id !== null);
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
