import parseDiff from "parse-diff";

export interface Finding {
  path: string;
  line: number;
  startLine?: number;
  body: string;
}

export interface ClassifiedFinding extends Finding {
  tier: 1 | 2 | 3;
}

interface FileHunks {
  hunks: { newStart: number; newLines: number }[];
}

/**
 * Classify findings into placement tiers based on the PR diff.
 *
 * Tier 1: line-level (line within a diff hunk's new-side range)
 * Tier 2: file-level (file in diff but line not in any hunk)
 * Tier 3: review body (file not in diff)
 */
function classifyFindings(findings: Finding[], diffText: string): ClassifiedFinding[] {
  const parsed = parseDiff(diffText);
  const fileMap = buildFileMap(parsed);

  return findings.map((finding) => {
    const file = fileMap.get(finding.path);
    if (!file) {
      return { ...finding, tier: 3 as const };
    }

    const lineInHunk = file.hunks.some((hunk) => {
      return finding.line >= hunk.newStart && finding.line < hunk.newStart + hunk.newLines;
    });

    if (lineInHunk) {
      return { ...finding, tier: 1 as const };
    }
    return { ...finding, tier: 2 as const };
  });
}

/**
 * Build a map of file path → {hunks: [{newStart, newLines}]}
 */
function buildFileMap(parsedDiff: parseDiff.File[]): Map<string, FileHunks> {
  const map = new Map<string, FileHunks>();
  for (const file of parsedDiff) {
    const filePath = file.to === "/dev/null" ? file.from : file.to;
    if (filePath === null || filePath === undefined || filePath === "") continue;

    const hunks = file.chunks.map((chunk) => ({
      newStart: chunk.newStart,
      newLines: chunk.newLines,
    }));

    map.set(filePath, { hunks });
  }
  return map;
}

export { classifyFindings };
