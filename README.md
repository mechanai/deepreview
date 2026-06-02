# deepreview

Multi-agent parallel code/spec review for [OpenCode](https://opencode.ai). Spawns 5 specialized
review agents, cross-validates findings, synthesizes results, and produces an actionable
implementation plan.

## Install

Run the setup script:

```bash
bunx @mechanai/deepreview@latest/setup          # Global install (~/.config/opencode/)
bunx @mechanai/deepreview@latest/setup --local   # Project-level install (.opencode/)
```

Or with Node.js (v22+):

```bash
npx --package @mechanai/deepreview@latest deepreview-setup
npx --package @mechanai/deepreview@latest deepreview-setup --local
```

This will:

1. Add `@mechanai/deepreview` to the `plugin` array in your `opencode.json` (creates the file if needed)
2. Symlink agents and commands into the appropriate config directory

> [!NOTE]
> The symlinks are needed because OpenCode does not yet auto-discover
> agents and commands from installed plugin packages.

## Usage

```
/deepreview                   # Review current branch vs main
/deepreview 123               # Review PR #123
/deepreview file1.ts file2.ts # Review specific files
/deepreview --context decisions.md   # Review with design context (suppresses known decisions)

/deepreview-loop              # Review + fix loop (repeats until clean or 5 iterations)
/deepreview-loop 123          # Same, targeting a PR
/deepreview-loop --context decisions.md       # Loop with design context
/deepreview-spec-loop --context decisions.md spec.md  # Spec loop with design context

/deepreview-pr-review 123     # Review PR and post findings as a pending GitHub review

/deepreview-spec spec.md                  # Spec-focused review (completeness, consistency, feasibility)
/deepreview-spec --context decisions.md spec.md  # Spec review with design context
/deepreview-spec-loop spec.md             # Spec review + fix loop
```

All commands accept a branch diff, PR number, or file path(s). The `-loop` variants
apply fixes automatically and re-review until no findings remain. Pauses on plateaus
(same finding persists across iterations).

## Pipeline

```mermaid
graph LR
    A[5 Reviewers] --> B[5 Validators]
    B --> C[Synthesizer]
    C --> D[Planner]
    D --> E[Applier]
```

Stages communicate via files on disk — the orchestrator never reads review content into
its own context, keeping token usage minimal.

### Review agents

| Agent                       | Code review                            | Spec review                                  |
| --------------------------- | -------------------------------------- | -------------------------------------------- |
| correctness / completeness  | Logic bugs, edge cases, error handling | Gaps, missing edge cases, undefined behavior |
| security / consistency      | Vulnerabilities, performance           | Contradictions, name mismatches, type drift  |
| architecture                | Patterns, coupling, complexity         | Patterns, coupling, complexity               |
| docs                        | Comment quality, stale claims          | Comment quality, stale claims                |
| compatibility / feasibility | Breaking changes, API contracts        | Implicit dependencies, can it be built       |

## Requirements

- [OpenCode](https://opencode.ai)
- [Bun](https://bun.sh/) >= 1.2 or [Node.js](https://nodejs.org/) >= 22
- `git`
- `gh` CLI (only for PR commands)

## Upgrade

OpenCode caches plugins on first install and does not automatically check for newer versions.
To upgrade:

```bash
rm -rf ~/.cache/opencode/packages/*deepreview*/
```

Then restart OpenCode. It will re-fetch the latest version.

If you installed with `--local`, also re-run the setup script to update symlinks:

```bash
bunx @mechanai/deepreview@latest/setup --local
```

> [!NOTE]
> If upgrading from the old `npx @anthropic/deepreview install` workflow, remove
> the old copied files first (`rm ~/.config/opencode/agents/deepreview*
~/.config/opencode/commands/deepreview*`), then run the setup script above.
> The setup script uses symlinks instead of copies, so future upgrades only
> require re-running the script.

## Development

This project uses [Bun](https://bun.sh/) as its runtime and package manager.

```bash
bun install
mise run test
mise run lint
mise run fmt
```

## License

MIT
