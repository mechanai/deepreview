export interface ThreadComment {
  authorLogin: string;
  authorType: "human" | "bot";
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
