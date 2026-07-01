import { type Plugin, type PluginInput, tool } from "@opencode-ai/plugin";
import { postReview } from "../../src/post-review.ts";
import { buildPriorReview } from "../../src/build-prior-review.ts";

// oxlint-disable-next-line require-await -- Why: Plugin type signature requires async but this plugin has no async initialization
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
    },
  };
};
