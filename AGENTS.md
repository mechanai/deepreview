# Agent Instructions

## Versioning

This project uses [semantic-release](https://github.com/semantic-release/semantic-release) to manage versions. The `version` field in `package.json` is `0.0.0-development` and must never be changed manually. Semantic-release determines the next version from commit messages at publish time.

## Formatting and Linting

Always use mise tasks for formatting and linting:

- **Format:** `mise run fmt`
- **Lint:** `mise run lint`

Do not run individual linters or formatters (e.g., `oxlint`, `oxfmt`) directly. The mise tasks are the source of truth for which tools run and with what flags.
