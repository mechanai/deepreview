import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { validateSuggestionAnchors } from "./review-helpers.ts";

describe("validateSuggestionAnchors — no warnings", () => {
  it("returns no warnings for findings without suggestion blocks", () => {
    const findings = [
      { path: "foo.go", line: 10, body: "This is just prose feedback.", tier: 1 as const },
    ];
    const warnings = validateSuggestionAnchors(findings);
    assert.equal(warnings.length, 0);
  });

  it("returns no warnings when suggestion lines fit within anchor range", () => {
    const body = [
      "Replace this function:",
      "```suggestion",
      "func foo() {",
      "  return 42",
      "}",
      "```",
    ].join("\n");
    // Anchor covers 3 lines (8..10), suggestion has 3 lines — matches
    const findings = [{ path: "foo.go", startLine: 8, line: 10, body, tier: 1 as const }];
    const warnings = validateSuggestionAnchors(findings);
    assert.equal(warnings.length, 0);
  });

  it("ignores non-suggestion fenced code blocks", () => {
    const body = [
      "Example:",
      "```go",
      "func foo() {}",
      "func bar() {}",
      "func baz() {}",
      "```",
    ].join("\n");
    const findings = [{ path: "foo.go", line: 5, body, tier: 1 as const }];
    const warnings = validateSuggestionAnchors(findings);
    assert.equal(warnings.length, 0);
  });

  it("skips tier 2 and tier 3 findings", () => {
    const body = ["```suggestion", "a", "b", "c", "```"].join("\n");
    const findings = [
      { path: "foo.go", line: 5, body, tier: 2 as const },
      { path: "bar.go", line: 10, body, tier: 3 as const },
    ];
    const warnings = validateSuggestionAnchors(findings);
    assert.equal(warnings.length, 0);
  });
});

describe("validateSuggestionAnchors — warnings", () => {
  it("warns when suggestion has more lines than anchor range", () => {
    const body = [
      "Fix this:",
      "```suggestion",
      "line1",
      "line2",
      "line3",
      "line4",
      "line5",
      "```",
    ].join("\n");
    // Anchor is single-line (31), suggestion has 5 lines
    const findings = [{ path: "mise.toml", line: 31, body, tier: 1 as const }];
    const warnings = validateSuggestionAnchors(findings);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("mise.toml:31"));
    assert.ok(warnings[0].includes("1-line anchor"));
    assert.ok(warnings[0].includes("5-line suggestion"));
  });

  it("warns for multi-line anchor that is still too narrow", () => {
    const body = ["```suggestion", "line1", "line2", "line3", "line4", "line5", "```"].join("\n");
    // Anchor covers 2 lines (893..894), suggestion has 5 lines
    const findings = [{ path: "migration.md", startLine: 893, line: 894, body, tier: 1 as const }];
    const warnings = validateSuggestionAnchors(findings);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("migration.md:893-894"));
    assert.ok(warnings[0].includes("2-line anchor"));
  });

  it("handles multiple suggestion blocks — warns based on largest", () => {
    const body = [
      "First fix:",
      "```suggestion",
      "a",
      "b",
      "c",
      "```",
      "Second fix:",
      "```suggestion",
      "x",
      "y",
      "```",
    ].join("\n");
    // Single-line anchor, two suggestion blocks (3 lines and 2 lines)
    const findings = [{ path: "foo.go", line: 5, body, tier: 1 as const }];
    const warnings = validateSuggestionAnchors(findings);
    // Should warn — the largest suggestion (3 lines) exceeds the 1-line anchor
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("3-line suggestion"));
  });
});
