# Agent Instructions

## Versioning

This project uses [semantic-release](https://github.com/semantic-release/semantic-release) to manage versions. The `version` field in `package.json` is `0.0.0-development` and must never be changed manually. Semantic-release determines the next version from commit messages at publish time.

## Formatting, Linting, Tests

Always use mise tasks for formatting, linting, and running tests:

- **Format:** `mise run fmt`
- **Lint:** `mise run lint`
- **Tests:** `mise run test`

Do not run individual linters, formatters, or test runners (e.g., `oxlint`, `oxfmt`) directly. The mise tasks are the source of truth for which tools run and with what flags.
