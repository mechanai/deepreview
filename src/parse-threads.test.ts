import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { parseThreads } from "./parse-threads.ts";

describe("parseThreads summary extraction", () => {
  it("extracts a summary document marked with summary: true", () => {
    const input = [
      "---",
      "summary: true",
      "---",
      "Overall this PR looks good with minor issues.",
      "---",
      "path: src/main.go",
      "line: 10",
      "---",
      "Error not propagated.",
    ].join("\n");

    const result = parseThreads(input);
    assert.equal(result.summary, "Overall this PR looks good with minor issues.");
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].path, "src/main.go");
  });

  it("returns undefined summary when no summary document exists", () => {
    const input = ["---", "path: src/main.go", "line: 10", "---", "Error not propagated."].join(
      "\n",
    );

    const result = parseThreads(input);
    assert.equal(result.summary, undefined);
    assert.equal(result.findings.length, 1);
  });

  it("handles summary at end of file", () => {
    const input = [
      "---",
      "path: src/main.go",
      "line: 10",
      "---",
      "Finding body.",
      "---",
      "summary: true",
      "---",
      "Summary at the end.",
    ].join("\n");

    const result = parseThreads(input);
    assert.equal(result.summary, "Summary at the end.");
    assert.equal(result.findings.length, 1);
  });
});

describe("parseThreads summary edge cases", () => {
  it("treats empty summary body as empty string", () => {
    const input = [
      "---",
      "summary: true",
      "---",
      "",
      "---",
      "path: src/main.go",
      "line: 10",
      "---",
      "Finding.",
    ].join("\n");

    const result = parseThreads(input);
    assert.equal(result.summary, "");
    assert.equal(result.findings.length, 1);
  });
});

describe("parseThreads findings", () => {
  it("parses a single finding", () => {
    const input = [
      "---",
      "path: pkg/server/handler.go",
      "line: 48",
      "---",
      "The error is silently discarded.",
    ].join("\n");

    const result = parseThreads(input);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].path, "pkg/server/handler.go");
    assert.equal(result.findings[0].line, 48);
    assert.equal(result.findings[0].startLine, undefined);
    assert.equal(result.findings[0].body.trim(), "The error is silently discarded.");
  });

  it("parses multiple findings separated by ---", () => {
    const input = [
      "---",
      "path: a.go",
      "startLine: 10",
      "line: 15",
      "---",
      "Finding one.",
      "---",
      "path: b.go",
      "line: 3",
      "---",
      "Finding two.",
    ].join("\n");

    const result = parseThreads(input);
    assert.equal(result.findings.length, 2);
    assert.equal(result.findings[0].path, "a.go");
    assert.equal(result.findings[0].startLine, 10);
    assert.equal(result.findings[0].line, 15);
    assert.equal(result.findings[1].path, "b.go");
    assert.equal(result.findings[1].line, 3);
  });

  it("ignores startLine: 0 (treats as single-line)", () => {
    const input = ["---", "path: x.go", "startLine: 0", "line: 5", "---", "Body."].join("\n");

    const result = parseThreads(input);
    assert.equal(result.findings[0].startLine, undefined);
  });

  it("returns empty findings for empty input", () => {
    const result = parseThreads("");
    assert.equal(result.findings.length, 0);
  });
});
