# Agent Instructions

## Project Overview

This is an [OpenCode plugin](https://opencode.ai/docs/plugins) that provides multi-agent parallel code/spec review. When installed via `"plugin": ["@mechanai/deepreview"]` in a consumer's `opencode.json`, it exposes custom agents, commands, and tools.

## Directory Structure

```
.opencode/
  agents/       # Subagent definitions (discovered by OpenCode at .opencode/agents/)
  commands/     # Slash commands like /deepreview (discovered at .opencode/commands/)
  plugins/      # Plugin entry point exposing custom tools
src/            # Library source (post-review API, diff classification, thread parsing)
```

> [!IMPORTANT]
> Agents and commands **must** live under `.opencode/` for OpenCode to discover them. Do not move them to top-level directories.

## Versioning

This project uses [semantic-release](https://github.com/semantic-release/semantic-release) to manage versions. The `version` field in `package.json` is `0.0.0-development` and must never be changed manually. Semantic-release determines the next version from commit messages at publish time.

## Formatting, Linting, Tests

Always use mise tasks for formatting, linting, and running tests:

- **Format:** `mise run fmt`
- **Lint:** `mise run lint`
- **Tests:** `mise run test`

Do not run individual linters, formatters, or test runners (e.g., `oxlint`, `oxfmt`) directly. The mise tasks are the source of truth for which tools run and with what flags.
