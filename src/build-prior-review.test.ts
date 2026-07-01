import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  buildPriorReviewContent,
  formatPriorReview,
  mapGraphQLThreads,
  truncateToFit,
} from "./build-prior-review.ts";
import type { ReviewThread, ThreadComment } from "./build-prior-review.ts";

function makeThread(
  path: string,
  line: number,
  comments: { login: string; body: string }[],
  opts?: { startLine?: number; isResolved?: boolean; isOutdated?: boolean },
): ReviewThread {
  return {
    path,
    startLine: opts?.startLine ?? null,
    line,
    isResolved: opts?.isResolved ?? false,
    isOutdated: opts?.isOutdated ?? false,
    comments: comments.map(
      (c): ThreadComment => ({
        authorLogin: c.login,
        authorType: "human",
        body: c.body,
        createdAt: "2026-01-01T00:00:00Z",
      }),
    ),
  };
}

describe("formatPriorReview: sections", () => {
  it("formats PR description only", () => {
    const result = formatPriorReview("This PR adds feature X.", [], null);
    assert.ok(result.includes("## PR Description"));
    assert.ok(result.includes("This PR adds feature X."));
    assert.ok(!result.includes("## Prior Review Comments"));
    assert.ok(!result.includes("## Manual Prior Review"));
  });

  it("includes manual prior review section", () => {
    const result = formatPriorReview("body", [], "Manual findings here.");
    assert.ok(result.includes("## Manual Prior Review"));
    assert.ok(result.includes("Manual findings here."));
  });

  it("returns empty string when all inputs are empty", () => {
    const result = formatPriorReview("", [], null);
    assert.equal(result, "");
  });
});

describe("formatPriorReview: thread formatting", () => {
  it("formats threads grouped by file with line numbers", () => {
    const threads: ReviewThread[] = [
      {
        path: "src/foo.ts",
        startLine: 10,
        line: 15,
        isResolved: false,
        isOutdated: false,
        comments: [
          {
            authorLogin: "octocat",
            authorType: "human",
            body: "Should this be async?",
            createdAt: "2026-01-01T00:00:00Z",
          },
          {
            authorLogin: "author",
            authorType: "human",
            body: "Good point, fixed.",
            createdAt: "2026-01-01T01:00:00Z",
          },
        ],
      },
      {
        path: "src/foo.ts",
        startLine: null,
        line: 42,
        isResolved: true,
        isOutdated: false,
        comments: [
          {
            authorLogin: "bot-reviewer[bot]",
            authorType: "bot",
            body: "Unused import.",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      },
    ];
    const result = formatPriorReview("PR body.", threads, null);
    assert.ok(result.includes("### src/foo.ts"));
    assert.ok(result.includes("**L10-15**"));
    assert.ok(result.includes("[source: @octocat, human]"));
    assert.ok(result.includes("**L42**"));
    assert.ok(result.includes("[source: @bot-reviewer[bot], bot, resolved]"));
    assert.ok(result.includes("@author replied:"));
  });
});

describe("formatPriorReview: thread ordering and flags", () => {
  it("sorts threads by file path then line number", () => {
    const threads = [
      makeThread("src/z.ts", 1, [{ login: "a", body: "z" }]),
      makeThread("src/a.ts", 5, [{ login: "a", body: "a5" }]),
      makeThread("src/a.ts", 1, [{ login: "a", body: "a1" }]),
    ];
    const result = formatPriorReview("", threads, null);
    const aPos = result.indexOf("### src/a.ts");
    const zPos = result.indexOf("### src/z.ts");
    assert.ok(aPos < zPos, "src/a.ts should come before src/z.ts");
    const a1Pos = result.indexOf("a1");
    const a5Pos = result.indexOf("a5");
    assert.ok(a1Pos < a5Pos, "line 1 should come before line 5");
  });

  it("marks outdated threads", () => {
    const threads = [
      makeThread("src/x.ts", 1, [{ login: "a", body: "old" }], { isOutdated: true }),
    ];
    const result = formatPriorReview("", threads, null);
    assert.ok(result.includes("outdated"));
  });
});

describe("truncateToFit", () => {
  it("returns content unchanged when under budget", () => {
    const content = "short content";
    assert.equal(truncateToFit(content, 50_000), content);
  });

  it("truncates to fit within byte limit", () => {
    const content = "x".repeat(60_000);
    const result = truncateToFit(content, 50_000);
    assert.ok(Buffer.byteLength(result, "utf8") <= 50_000);
  });
});

describe("fetchPrReviewThreads", () => {
  it("is exported as a function", async () => {
    const { fetchPrReviewThreads } = await import("./build-prior-review.ts");
    assert.equal(typeof fetchPrReviewThreads, "function");
  });
});

describe("mapGraphQLThreads", () => {
  it("maps GraphQL response nodes to ReviewThread[]", () => {
    const nodes = [
      {
        id: "t1",
        path: "src/foo.ts",
        startLine: 10,
        line: 15,
        isResolved: false,
        isOutdated: false,
        comments: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              author: { login: "octocat", __typename: "User" },
              body: "Fix this",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
        },
      },
      {
        id: "t2",
        path: "src/bar.ts",
        startLine: null,
        line: 5,
        isResolved: true,
        isOutdated: false,
        comments: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              author: { login: "ci-bot[bot]", __typename: "Bot" },
              body: "Lint error",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
        },
      },
    ];
    const result = mapGraphQLThreads(nodes);
    assert.equal(result.length, 2);
    assert.equal(result[0].path, "src/foo.ts");
    assert.equal(result[0].comments[0].authorType, "human");
    assert.equal(result[1].comments[0].authorType, "bot");
    assert.equal(result[1].isResolved, true);
  });

  it("detects bot by __typename Bot", () => {
    const nodes = [
      {
        id: "t1",
        path: "a.ts",
        startLine: null,
        line: 1,
        isResolved: false,
        isOutdated: false,
        comments: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              author: { login: "dependabot", __typename: "Bot" },
              body: "bump",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
        },
      },
    ];
    const result = mapGraphQLThreads(nodes);
    assert.equal(result[0].comments[0].authorType, "bot");
  });

  it("detects bot by [bot] suffix when __typename is missing", () => {
    const nodes = [
      {
        id: "t1",
        path: "a.ts",
        startLine: null,
        line: 1,
        isResolved: false,
        isOutdated: false,
        comments: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              author: { login: "some-bot[bot]", __typename: "User" },
              body: "x",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
        },
      },
    ];
    const result = mapGraphQLThreads(nodes);
    assert.equal(result[0].comments[0].authorType, "bot");
  });

  it("detects deepreview by finding ID HTML comment in body", () => {
    const nodes = [
      {
        id: "t1",
        path: "src/foo.ts",
        startLine: null,
        line: 10,
        isResolved: false,
        isOutdated: false,
        comments: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              author: { login: "reviewer-human", __typename: "User" },
              body: "Missing error handling.\n<!-- finding:abc123 -->",
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
        },
      },
    ];
    const result = mapGraphQLThreads(nodes);
    assert.equal(result[0].comments[0].authorType, "deepreview");
    assert.equal(result[0].comments[0].authorLogin, "reviewer-human");
  });
});

describe("buildPriorReviewContent: basic behavior", () => {
  it("keeps all content when under budget", () => {
    const threads: ReviewThread[] = [
      {
        path: "a.ts",
        startLine: null,
        line: 1,
        isResolved: false,
        isOutdated: false,
        comments: [
          {
            authorLogin: "a",
            authorType: "human",
            body: "small",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      },
    ];
    const result = buildPriorReviewContent("PR body", threads, "manual");
    assert.ok(result.includes("PR body"));
    assert.ok(result.includes("small"));
    assert.ok(result.includes("manual"));
  });

  it("returns empty string when all inputs empty", () => {
    const result = buildPriorReviewContent("", [], null);
    assert.equal(result, "");
  });
});

describe("buildPriorReviewContent: truncation", () => {
  it("drops oldest threads first when over budget", () => {
    const oldThread: ReviewThread = {
      path: "old.ts",
      startLine: null,
      line: 1,
      isResolved: false,
      isOutdated: false,
      comments: [
        {
          authorLogin: "a",
          authorType: "human",
          body: "x".repeat(20_000),
          createdAt: "2020-01-01T00:00:00Z",
        },
      ],
    };
    const newThread: ReviewThread = {
      path: "new.ts",
      startLine: null,
      line: 1,
      isResolved: false,
      isOutdated: false,
      comments: [
        {
          authorLogin: "b",
          authorType: "human",
          body: "y".repeat(20_000),
          createdAt: "2026-06-01T00:00:00Z",
        },
      ],
    };
    const result = buildPriorReviewContent("PR body", [oldThread, newThread], null);
    const bytes = Buffer.byteLength(result, "utf8");
    assert.ok(bytes <= 50 * 1024, `Expected <= 50KB, got ${bytes}`);
    assert.ok(result.includes("new.ts"));
  });

  it("preserves PR description and manual content even when threads are large", () => {
    const bigThread: ReviewThread = {
      path: "big.ts",
      startLine: null,
      line: 1,
      isResolved: false,
      isOutdated: false,
      comments: [
        {
          authorLogin: "a",
          authorType: "human",
          body: "z".repeat(45_000),
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    };
    const result = buildPriorReviewContent(
      "Important PR description",
      [bigThread],
      "Critical manual notes",
    );
    assert.ok(result.includes("Important PR description"));
    assert.ok(result.includes("Critical manual notes"));
    assert.ok(Buffer.byteLength(result, "utf8") <= 50 * 1024);
  });
});
