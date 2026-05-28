import parseDiff from "parse-diff";

/**
 * Classify findings into placement tiers based on the PR diff.
 *
 * Tier 1: line-level (line within a diff hunk's new-side range)
 * Tier 2: file-level (file in diff but line not in any hunk)
 * Tier 3: review body (file not in diff)
 *
 * @param {Array<{path: string, line: number, startLine?: number, body: string}>} findings
 * @param {string} diffText - Unified diff text
 * @returns {Array<{path: string, line: number, startLine?: number, body: string, tier: 1|2|3}>}
 */
function classifyFindings(findings, diffText) {
  const parsed = parseDiff(diffText);
  const fileMap = buildFileMap(parsed);

  return findings.map((finding) => {
    const file = fileMap.get(finding.path);
    if (!file) {
      return { ...finding, tier: 3 };
    }

    const lineInHunk = file.hunks.some((hunk) => {
      return finding.line >= hunk.newStart && finding.line < hunk.newStart + hunk.newLines;
    });

    if (lineInHunk) {
      return { ...finding, tier: 1 };
    }
    return { ...finding, tier: 2 };
  });
}

/**
 * Build a map of file path → {hunks: [{newStart, newLines}]}
 */
function buildFileMap(parsedDiff) {
  const map = new Map();
  for (const file of parsedDiff) {
    const filePath = file.to === "/dev/null" ? file.from : file.to;
    if (!filePath) continue;

    const hunks = file.chunks.map((chunk) => ({
      newStart: chunk.newStart,
      newLines: chunk.newLines,
    }));

    map.set(filePath, { hunks });
  }
  return map;
}

export { classifyFindings };
