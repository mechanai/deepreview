import { graphql } from "./graphql.ts";

export interface ThreadComment {
  authorLogin: string;
  authorType: "human" | "bot" | "deepreview";
  body: string;
  createdAt: string;
}

export interface ReviewThread {
  path: string;
  startLine: number | null;
  line: number | null;
  isResolved: boolean;
  isOutdated: boolean;
  comments: ThreadComment[];
}

const MAX_BYTES = 50 * 1024;

function formatLineRef(startLine: number | null, line: number | null): string {
  if (startLine !== null && line !== null && startLine !== line) {
    return `**L${startLine}-${line}**`;
  }
  if (line !== null) return `**L${line}**`;
  if (startLine !== null) return `**L${startLine}**`;
  return "**file-level**";
}

function formatSourceTag(comment: ThreadComment, thread: ReviewThread): string {
  const parts = [`@${comment.authorLogin}`, comment.authorType];
  if (thread.isResolved) parts.push("resolved");
  if (thread.isOutdated) parts.push("outdated");
  return `[source: ${parts.join(", ")}]`;
}

function formatThread(thread: ReviewThread): string {
  if (thread.comments.length === 0) return "";
  const first = thread.comments[0];
  const replies = thread.comments.slice(1);
  const lines: string[] = [];
  const lineRef = formatLineRef(thread.startLine, thread.line);
  const tag = formatSourceTag(first, thread);
  lines.push(`- ${lineRef} ${tag}: ${JSON.stringify(first.body)}`);
  for (const reply of replies) {
    lines.push(`  - @${reply.authorLogin} replied: ${JSON.stringify(reply.body)}`);
  }
  return lines.join("\n");
}

export function formatPriorReview(
  prBody: string,
  threads: ReviewThread[],
  manualContent: string | null,
): string {
  const sections: string[] = [];

  if (prBody.trim()) {
    sections.push(`## PR Description\n\n${prBody.trim()}`);
  }

  if (threads.length > 0) {
    const sorted = [...threads].sort((a, b) => {
      const pathCmp = a.path.localeCompare(b.path);
      if (pathCmp !== 0) return pathCmp;
      return (a.line ?? a.startLine ?? 0) - (b.line ?? b.startLine ?? 0);
    });

    const byFile = new Map<string, ReviewThread[]>();
    for (const t of sorted) {
      const existing = byFile.get(t.path);
      if (existing) existing.push(t);
      else byFile.set(t.path, [t]);
    }

    const fileSections: string[] = [];
    for (const [filePath, fileThreads] of byFile) {
      const threadLines = fileThreads.map(formatThread).filter(Boolean);
      if (threadLines.length > 0) {
        fileSections.push(`### ${filePath}\n\n${threadLines.join("\n")}`);
      }
    }

    if (fileSections.length > 0) {
      sections.push(`## Prior Review Comments\n\n${fileSections.join("\n\n")}`);
    }
  }

  if (manualContent !== null && manualContent.trim() !== "") {
    sections.push(`## Manual Prior Review\n\n${manualContent.trim()}`);
  }

  return sections.join("\n\n");
}

export function truncateToFit(content: string, maxBytes: number = MAX_BYTES): string {
  const byteLength = Buffer.byteLength(content, "utf8");
  if (byteLength <= maxBytes) return content;

  // Binary search for the right character count
  let lo = 0;
  let hi = content.length;
  const suffix = "\n\n[truncated — content exceeds size limit]";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  const target = maxBytes - suffixBytes;

  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (Buffer.byteLength(content.slice(0, mid), "utf8") <= target) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return content.slice(0, lo) + suffix;
}

function newestCommentTimestamp(thread: ReviewThread): string {
  if (thread.comments.length === 0) return "1970-01-01T00:00:00Z";
  return thread.comments[thread.comments.length - 1].createdAt;
}

export function buildPriorReviewContent(
  prBody: string,
  threads: ReviewThread[],
  manualContent: string | null,
): string {
  // If all inputs are empty, return empty
  if (
    !prBody.trim() &&
    threads.length === 0 &&
    (manualContent === null || manualContent.trim() === "")
  ) {
    return "";
  }

  // Build fixed sections (PR description + manual) that are always kept
  const fixedSections: string[] = [];
  if (prBody.trim()) {
    fixedSections.push(`## PR Description\n\n${prBody.trim()}`);
  }
  if (manualContent !== null && manualContent.trim() !== "") {
    fixedSections.push(`## Manual Prior Review\n\n${manualContent.trim()}`);
  }
  const fixedContent = fixedSections.join("\n\n");

  // If no threads, just return fixed content (potentially truncated)
  if (threads.length === 0) {
    return truncateToFit(fixedContent, MAX_BYTES);
  }

  // Sort threads by newest comment timestamp descending — newest retained first
  const sortedByRecency = [...threads].sort((a, b) =>
    newestCommentTimestamp(b).localeCompare(newestCommentTimestamp(a)),
  );

  // Greedily keep newest threads that fit within the budget.
  // We estimate bytes using formatThread + file header overhead, then do a
  // final safety pass with truncateToFit.
  const fixedBytes = Buffer.byteLength(fixedContent, "utf8");
  const separator = "\n\n";
  const separatorBytes = Buffer.byteLength(separator, "utf8");
  const sectionHeaderBytes = Buffer.byteLength("## Prior Review Comments\n\n", "utf8");
  let budgetRemaining =
    MAX_BYTES - fixedBytes - (fixedContent ? separatorBytes : 0) - sectionHeaderBytes;

  const keptThreads: ReviewThread[] = [];
  for (const thread of sortedByRecency) {
    const threadText = formatThread(thread);
    const fileHeader = `### ${thread.path}\n\n`;
    const threadBytes = Buffer.byteLength(threadText + fileHeader, "utf8") + separatorBytes;
    if (threadBytes <= budgetRemaining) {
      keptThreads.push(thread);
      budgetRemaining -= threadBytes;
    }
  }

  // formatPriorReview handles final ordering (by file path / line number)
  const result = formatPriorReview(prBody, keptThreads, manualContent);

  // Final safety check in case our byte estimate was off
  return truncateToFit(result, MAX_BYTES);
}

// --- GraphQL types ---

interface GQLPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface GQLCommentAuthor {
  login: string;
  __typename: string;
}

interface GQLComment {
  author: GQLCommentAuthor | null;
  body: string;
  createdAt: string;
}

interface GQLCommentsConnection {
  pageInfo: GQLPageInfo;
  nodes: GQLComment[];
}

interface GQLThreadNode {
  id: string;
  path: string;
  startLine: number | null;
  line: number | null;
  isResolved: boolean;
  isOutdated: boolean;
  comments: GQLCommentsConnection;
}

interface GQLReviewThreadsConnection {
  pageInfo: GQLPageInfo;
  nodes: GQLThreadNode[];
}

interface GQLPullRequest {
  body: string;
  reviewThreads: GQLReviewThreadsConnection;
}

interface GQLFetchResponse {
  repository: {
    pullRequest: GQLPullRequest | null;
  };
}

interface GQLThreadCommentsResponse {
  node: {
    comments: GQLCommentsConnection;
  };
}

// --- Constants ---

const MAX_THREAD_PAGES = 20;
const MAX_COMMENT_PAGES = 10;
const AGGREGATE_TIMEOUT_MS = 5 * 60 * 1000;

// --- Mapping ---

const FINDING_ID_RE = /<!-- finding:[a-f0-9]+ -->/u;

function classifyAuthorType(
  author: GQLCommentAuthor | null,
  body: string,
): "human" | "bot" | "deepreview" {
  // deepreview embeds finding IDs as HTML comments; detect regardless of posting account
  if (FINDING_ID_RE.test(body)) return "deepreview";
  // ghost/deleted users treated as bot
  if (!author) return "bot";
  if (author.__typename === "Bot" || author.__typename === "Mannequin") return "bot";
  if (author.login.endsWith("[bot]")) return "bot";
  return "human";
}

export function mapGraphQLThreads(nodes: GQLThreadNode[]): ReviewThread[] {
  return nodes.map((node) => ({
    path: node.path,
    startLine: node.startLine,
    line: node.line,
    isResolved: node.isResolved,
    isOutdated: node.isOutdated,
    comments: node.comments.nodes.map((c) => ({
      authorLogin: c.author?.login ?? "ghost",
      authorType: classifyAuthorType(c.author, c.body),
      body: c.body,
      createdAt: c.createdAt,
    })),
  }));
}

// --- Fetching ---

const REVIEW_THREADS_QUERY = `
  query ($owner: String!, $name: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        body
        reviewThreads(first: 50, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            path
            startLine
            line
            isResolved
            isOutdated
            comments(first: 100) {
              pageInfo { hasNextPage endCursor }
              nodes {
                author { login __typename }
                body
                createdAt
              }
            }
          }
        }
      }
    }
  }
`;

const THREAD_COMMENTS_QUERY = `
  query ($threadId: ID!, $after: String!) {
    node(id: $threadId) {
      ... on PullRequestReviewThread {
        comments(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            author { login __typename }
            body
            createdAt
          }
        }
      }
    }
  }
`;

export async function fetchPrReviewThreads(
  owner: string,
  name: string,
  prNumber: number,
): Promise<{ prBody: string; threads: ReviewThread[] }> {
  const deadline = Date.now() + AGGREGATE_TIMEOUT_MS;
  const allThreadNodes: GQLThreadNode[] = [];
  let prBody = "";
  let after: string | null = null;
  let pages = 0;

  // Paginate review threads
  while (pages < MAX_THREAD_PAGES) {
    if (Date.now() > deadline) {
      console.warn(
        "WARN: Aggregate timeout reached fetching review threads. Returning partial results.",
      );
      break;
    }
    pages++;

    const data: GQLFetchResponse = await graphql<GQLFetchResponse>(REVIEW_THREADS_QUERY, {
      owner,
      name,
      number: prNumber,
      after,
    });

    const pr: GQLPullRequest | null = data.repository.pullRequest;
    if (!pr) throw new Error(`PR #${prNumber} not found in ${owner}/${name}`);

    if (pages === 1) prBody = pr.body;

    allThreadNodes.push(...pr.reviewThreads.nodes);

    if (!pr.reviewThreads.pageInfo.hasNextPage) break;
    after = pr.reviewThreads.pageInfo.endCursor;
  }

  if (pages >= MAX_THREAD_PAGES) {
    console.warn(
      `WARN: Reached MAX_THREAD_PAGES (${MAX_THREAD_PAGES}) — thread data may be incomplete.`,
    );
  }

  // Paginate comments for threads that have more
  for (const thread of allThreadNodes) {
    if (!thread.comments.pageInfo.hasNextPage) continue;
    if (Date.now() > deadline) {
      console.warn(
        "WARN: Aggregate timeout reached fetching thread comments. Returning partial results.",
      );
      break;
    }

    let commentAfter: string | null = thread.comments.pageInfo.endCursor;
    let commentPages = 0;
    while (commentAfter !== null && commentPages < MAX_COMMENT_PAGES) {
      if (Date.now() > deadline) break;
      commentPages++;

      const data = await graphql<GQLThreadCommentsResponse>(THREAD_COMMENTS_QUERY, {
        threadId: thread.id,
        after: commentAfter,
      });

      thread.comments.nodes.push(...data.node.comments.nodes);
      if (!data.node.comments.pageInfo.hasNextPage) break;
      commentAfter = data.node.comments.pageInfo.endCursor;
    }
  }

  return { prBody, threads: mapGraphQLThreads(allThreadNodes) };
}
