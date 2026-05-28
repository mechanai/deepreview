"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { parseThreads } = require("./parse-threads.js");
const { classifyFindings } = require("./diff-classifier.js");

describe("integration: parse → classify", () => {
  const threadsContent = [
    "---",
    "path: src/main.go",
    "startLine: 10",
    "line: 15",
    "---",
    "Error not propagated.",
    "---",
    "path: src/main.go",
    "line: 200",
    "---",
    "Missing docs.",
    "---",
    "path: pkg/other.go",
    "line: 5",
    "---",
    "Unused import.",
  ].join("\n");

  const diff = [
    "diff --git a/src/main.go b/src/main.go",
    "index abc..def 100644",
    "--- a/src/main.go",
    "+++ b/src/main.go",
    "@@ -8,6 +8,10 @@ func main() {",
    "     existing()",
    "+    newCode()",
    "+    moreNew()",
    "+    evenMore()",
    "+    andMore()",
    "     rest()",
  ].join("\n");

  it("classifies findings correctly across all 3 tiers", () => {
    const findings = parseThreads(threadsContent);
    assert.equal(findings.length, 3);

    const classified = classifyFindings(findings, diff);
    // line 10-15 is within hunk (newStart=8, newLines=10) → tier 1
    assert.equal(classified[0].tier, 1);
    // line 200 in src/main.go but not in hunk → tier 2
    assert.equal(classified[1].tier, 2);
    // pkg/other.go not in diff → tier 3
    assert.equal(classified[2].tier, 3);
  });
});
