import matter from "gray-matter";
import yaml from "js-yaml";
import type { Finding } from "./diff-classifier.ts";

/**
 * gray-matter engine restricted to safe YAML parsing (no !!js/function etc.).
 * FAILSAFE_SCHEMA returns all scalars as strings — numeric fields (line, startLine)
 * are coerced to number downstream in parseThreads. This is intentional.
 */
const safeYamlEngine = (s: string): Record<string, unknown> => {
  const result: unknown = yaml.load(s, { schema: yaml.FAILSAFE_SCHEMA });
  if (result === null || result === undefined || typeof result !== "object") return {};
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Why: narrowed to object via typeof guard above; FAILSAFE_SCHEMA always yields a plain object
  return result as Record<string, unknown>;
};
const matterOptions = { engines: { yaml: safeYamlEngine } };

/**
 * Parse a threads.md file into an array of finding objects.
 * The file uses --- separators between findings, each with YAML frontmatter.
 */
function parseThreads(content: string): Finding[] {
  const findings: Finding[] = [];
  const documents = splitDocuments(content);

  for (const doc of documents) {
    let parsed: matter.GrayMatterFile<string>;
    try {
      parsed = matter(doc, matterOptions);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Skipping malformed finding: ${message}`);
      continue;
    }
    const data = parsed.data as Record<string, unknown>;
    const path = typeof data.path === "string" ? data.path : undefined;
    const lineNum = Number(data.line);
    if (path === undefined || path === "" || !Number.isFinite(lineNum) || lineNum < 1) {
      if (path !== undefined && path !== "") {
        console.warn(`WARN: Skipping finding with invalid line number in ${path}`);
      }
      continue;
    }

    const rawStartLine: unknown = data.startLine;
    const startLineNum =
      rawStartLine !== null && rawStartLine !== undefined ? Number(rawStartLine) : undefined;
    findings.push({
      path,
      line: lineNum,
      startLine:
        startLineNum !== undefined && startLineNum > 0 && Number.isFinite(startLineNum)
          ? startLineNum
          : undefined,
      body: parsed.content.trim(),
    });
  }

  return findings;
}

const YAML_KEY_RE = /^\w[\w\s]*:/u;

function peekIsYamlKey(lines: string[], startIndex: number): boolean {
  for (let j = startIndex; j < lines.length; j++) {
    if (lines[j].trim() === "") continue;
    return YAML_KEY_RE.test(lines[j].trim());
  }
  return false;
}

/**
 * Split a multi-document frontmatter file into individual documents.
 * Each document starts with "---" (YAML open), has frontmatter, then "---" (YAML close),
 * then body content until the next document or EOF.
 */
function splitDocuments(content: string): string[] {
  const lines = content.split("\n");
  const documents: string[] = [];
  let current: string[] = [];
  let inFrontmatter = false;
  let foundFirstDoc = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") {
      if (!foundFirstDoc) {
        foundFirstDoc = true;
        inFrontmatter = true;
        current.push(line);
      } else if (inFrontmatter) {
        inFrontmatter = false;
        current.push(line);
      } else {
        // Only split if this looks like a new document (next non-blank line has a YAML key)
        const looksLikeNewDoc = peekIsYamlKey(lines, i + 1);
        if (looksLikeNewDoc) {
          documents.push(current.join("\n"));
          current = [line];
          inFrontmatter = true;
        } else {
          current.push(line);
        }
      }
    } else if (foundFirstDoc) {
      current.push(line);
    }
  }

  if (current.length > 0) {
    documents.push(current.join("\n"));
  }

  return documents;
}

export { parseThreads };
