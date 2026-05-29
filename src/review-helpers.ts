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
  if (filePath.includes("\0")) return false;
  if (filePath.startsWith("/") || filePath.includes("..")) return false;
  if (filePath === "") return false;
  // Normalize away harmless . and trailing slashes before comparison
  const normalized = filePath
    .split("/")
    .filter((s) => s !== "." && s !== "")
    .join("/");
  return normalized.length > 0;
}

export interface RateLimitLike {
  status?: number;
  type?: string;
  message?: string;
}

export function isRateLimitError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Why: narrowed to object via typeof guard; property access checked individually below
  const e = err as Record<string, unknown>;
  const status = typeof e.status === "number" ? e.status : undefined;
  const type = typeof e.type === "string" ? e.type : undefined;
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";

  if (status === 429) return true;
  if (status === 403) {
    return message.includes("rate limit") || message.includes("secondary rate limit");
  }
  if (type === "RATE_LIMITED") return true;
  return message.includes("rate limit") || message.includes("secondary rate limit");
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
  const match = FINDING_ID_RE.exec(body);
  return match ? match[1] : null;
}
