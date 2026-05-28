"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { parseThreads } = require("./parse-threads.js");
const { classifyFindings } = require("./diff-classifier.js");
const { main } = require("./post-review.js");

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

describe("post-review main logic", () => {
  it("exits with error when no args provided", () => {
    const errorMessages = [];
    const originalError = console.error;
    const originalExit = process.exit;

    console.error = (...args) => errorMessages.push(args.join(" "));
    process.exit = (code) => {
      throw new Error(`EXIT_${code}`);
    };

    try {
      assert.throws(() => main({ argv: [] }), { message: "EXIT_1" });
      assert.ok(errorMessages.some((m) => m.includes("Usage:")));
    } finally {
      console.error = originalError;
      process.exit = originalExit;
    }
  });

  it("exits when threads file has no findings", () => {
    const logs = [];
    const originalLog = console.log;
    const originalExit = process.exit;

    console.log = (...args) => logs.push(args.join(" "));
    process.exit = (code) => {
      throw new Error(`EXIT_${code}`);
    };

    const noFindingsContent = "Just some text with no valid frontmatter.\n";
    const readFileFn = () => noFindingsContent;

    try {
      assert.throws(() => main({ argv: ["threads.md", "42"], readFileFn }), { message: "EXIT_0" });
      assert.ok(logs.some((m) => m.includes("No findings")));
    } finally {
      console.log = originalLog;
      process.exit = originalExit;
    }
  });
});
