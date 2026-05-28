import { type Plugin, type PluginInput, tool } from "@opencode-ai/plugin";
import { postReview } from "../../src/post-review.js";

export const server: Plugin = async (input: PluginInput) => {
  return {
    tool: {
      "deepreview-post-review": tool({
        description:
          "Post a GitHub PR review from a threads.md file. " +
          "Parses findings, classifies them into line-level/file-level/review-body " +
          "tiers based on the PR diff, and submits via GitHub GraphQL API. " +
          "Returns a summary of what was posted.",
        args: {
          threads_path: tool.schema.string().describe("Absolute path to the threads.md file"),
          pr_number: tool.schema.number().describe("Pull request number"),
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
            return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
          }
        },
      }),
    },
  };
};
