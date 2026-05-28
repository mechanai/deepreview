import crypto from "node:crypto";

const FINDING_ID_RE = /<!-- finding:([a-f0-9]+) -->/u;

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function isValidPath(filePath: string): boolean {
  if (filePath.startsWith("/") || filePath.includes("..")) return false;
  const normalized = filePath
    .split("/")
    .filter((s) => s !== "." && s !== "")
    .join("/");
  return normalized === filePath;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => {
    setTimeout(r, ms);
  });
}

export interface RateLimitLike {
  status?: number;
  type?: string;
  message?: string;
}

export function isRateLimitError(err: unknown): boolean {
  const e = err as RateLimitLike;
  if (e.status === 429 || e.status === 403) return true;
  if (e.type === "RATE_LIMITED") return true;
  const msg = e.message?.toLowerCase() ?? "";
  return msg.includes("rate limit") || msg.includes("secondary rate limit");
}

export function findingId(
  path: string,
  startLine: number | undefined,
  line: number,
  body = "",
): string {
  const key = `${path}:${startLine ?? 0}:${line}:${body.slice(0, 200)}`;
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);
}

export function embedFindingId(body: string, id: string): string {
  return `${body}\n<!-- finding:${id} -->`;
}

export function extractFindingId(body: string): string | null {
  const match = body.match(FINDING_ID_RE);
  return match ? match[1] : null;
}
