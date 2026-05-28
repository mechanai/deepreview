"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { parseThreads } = require("./parse-threads.js");

describe("parseThreads", () => {
  it("parses a single finding", () => {
    const input = [
      "---",
      "path: pkg/server/handler.go",
      "line: 48",
      "---",
      "The error is silently discarded.",
    ].join("\n");

    const result = parseThreads(input);
    assert.equal(result.length, 1);
    assert.equal(result[0].path, "pkg/server/handler.go");
    assert.equal(result[0].line, 48);
    assert.equal(result[0].startLine, undefined);
    assert.equal(result[0].body.trim(), "The error is silently discarded.");
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
    assert.equal(result.length, 2);
    assert.equal(result[0].path, "a.go");
    assert.equal(result[0].startLine, 10);
    assert.equal(result[0].line, 15);
    assert.equal(result[1].path, "b.go");
    assert.equal(result[1].line, 3);
  });

  it("ignores startLine: 0 (treats as single-line)", () => {
    const input = [
      "---",
      "path: x.go",
      "startLine: 0",
      "line: 5",
      "---",
      "Body.",
    ].join("\n");

    const result = parseThreads(input);
    assert.equal(result[0].startLine, undefined);
  });
});
