import matter from "gray-matter";
import yaml from "js-yaml";

/** gray-matter engine restricted to safe YAML parsing (no !!js/function etc.) */
const safeYamlEngine = (s) => yaml.load(s, { schema: yaml.FAILSAFE_SCHEMA });
const matterOptions = { engines: { yaml: safeYamlEngine } };

/**
 * Parse a threads.md file into an array of finding objects.
 * The file uses --- separators between findings, each with YAML frontmatter.
 *
 * @param {string} content - Raw content of threads.md
 * @returns {Array<{path: string, line: number, startLine?: number, body: string}>}
 */
function parseThreads(content) {
  const findings = [];
  const documents = splitDocuments(content);

  for (const doc of documents) {
    const parsed = matter(doc, matterOptions);
    const { path, line, startLine } = parsed.data;
    const lineNum = Number(line);
    if (!path || !Number.isFinite(lineNum)) continue;

    const startLineNum = startLine ? Number(startLine) : undefined;
    findings.push({
      path,
      line: lineNum,
      startLine: startLineNum && Number.isFinite(startLineNum) ? startLineNum : undefined,
      body: parsed.content.trim(),
    });
  }

  return findings;
}

/**
 * Split a multi-document frontmatter file into individual documents.
 * Each document starts with "---" (YAML open), has frontmatter, then "---" (YAML close),
 * then body content until the next document or EOF.
 */
function splitDocuments(content) {
  const lines = content.split("\n");
  const documents = [];
  let current = [];
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
        documents.push(current.join("\n"));
        current = [line];
        inFrontmatter = true;
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
