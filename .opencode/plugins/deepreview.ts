import { type Plugin, type PluginInput, tool } from "@opencode-ai/plugin";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { postReview } from "../../src/post-review.ts";
import { buildPriorReview } from "../../src/build-prior-review.ts";
import {
  type CalibrationEntry,
  type CalibrationSettings,
  loadCalibration,
  formatCalibrationPreamble,
  writeCalibration,
} from "../../src/calibration.ts";

/**
 * Resolve the main repository root (not a worktree root) from a working directory.
 * Falls back to the given directory if git resolution fails.
 */
function resolveRepoRoot(cwd: string): string {
  try {
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd,
      encoding: "utf-8",
    }).trim();
    // git-common-dir returns the path to .git (or the shared .git dir for worktrees).
    // It may be relative, so resolve against cwd, then strip trailing /.git for the repo root.
    return resolve(cwd, gitCommonDir).replace(/\/\.git$/u, "");
  } catch {
    return cwd;
  }
}

// oxlint-disable-next-line require-await, max-lines-per-function -- Why: Plugin type signature requires async but this plugin has no async initialization; function is long due to tool registrations with schema definitions
export const server: Plugin = async (_input: PluginInput) => {
  return {
    tool: {
      "deepreview-post-review": tool({
        description:
          "Post a GitHub PR review from a threads.md file. " +
          "Parses findings, classifies them into line-level/file-level/review-body " +
          "tiers based on the PR diff, and submits via GitHub GraphQL API. " +
          "Returns a summary of what was posted.",
        args: {
          threads_path: tool.schema
            .string()
            .describe("Relative path to the threads.md file (from workspace root)"),
          pr_number: tool.schema.number().int().positive().describe("Pull request number"),
          dry_run: tool.schema
            .boolean()
            .optional()
            .describe("Print what would be posted without submitting"),
          skip_ids: tool.schema
            .array(tool.schema.string())
            .optional()
            .describe("Finding IDs to skip (for retrying partial failures)"),
        },
        async execute(args, context) {
          try {
            const result = await postReview({
              threadsPath: args.threads_path,
              prNumber: args.pr_number,
              dryRun: args.dry_run ?? false,
              skipIds: args.skip_ids,
              cwd: context.directory,
            });
            return result.summary;
          } catch (err) {
            throw err instanceof Error ? err : new Error(String(err));
          }
        },
      }),
      "deepreview-build-prior-review": tool({
        description:
          "Fetch PR description and existing review threads from GitHub, " +
          "format them into a prior-review Markdown document for deduplication. " +
          "Merges with an optional manually-provided prior review file.",
        args: {
          pr_number: tool.schema.number().int().positive().describe("Pull request number"),
          output_path: tool.schema
            .string()
            .describe("Path to write the generated prior-review file"),
          manual_prior_review: tool.schema
            .string()
            .optional()
            .describe("Path to a user-provided prior-review file to merge in"),
        },
        async execute(args, context) {
          try {
            return await buildPriorReview({
              prNumber: args.pr_number,
              outputPath: args.output_path,
              manualPriorReview: args.manual_prior_review,
              cwd: context.directory,
            });
          } catch (err) {
            throw err instanceof Error ? err : new Error(String(err));
          }
        },
      }),
      "deepreview-calibration-load": tool({
        description:
          "Load per-project calibration entries (learned severity adjustments from prior " +
          "review sessions). Returns active entries, expired entries needing re-confirmation, " +
          "and a formatted preamble for reviewer injection.",
        args: {},
        async execute(_args, context) {
          const repoRoot = resolveRepoRoot(context.directory);
          const { active, expired } = loadCalibration(repoRoot);
          const preamble = formatCalibrationPreamble(active);
          return JSON.stringify({ active, expired, preamble });
        },
      }),
      "deepreview-calibration-save": tool({
        description:
          "Save calibration entries to .ai/deepreview/calibration.yml (local, unversioned). " +
          "Always writes to local — never modifies .deepreview.yml.",
        args: {
          entries: tool.schema.string().describe("JSON array of CalibrationEntry objects to save"),
          expiry_days: tool.schema
            .number()
            .int()
            .positive()
            .optional()
            .describe("Expiry window in days (default: 30)"),
        },
        async execute(args, context) {
          const repoRoot = resolveRepoRoot(context.directory);
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Why: JSON.parse returns any; schema is validated by the caller (orchestrator)
          const entries = JSON.parse(args.entries) as CalibrationEntry[];
          const settings: CalibrationSettings = { expiryDays: args.expiry_days ?? 30 };
          writeCalibration(repoRoot, { version: 1, settings, entries });
          return JSON.stringify({ written: `${repoRoot}/.ai/deepreview/calibration.yml` });
        },
      }),
    },
  };
};
