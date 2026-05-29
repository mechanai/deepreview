# deepreview

Multi-agent parallel code/spec review for [OpenCode](https://opencode.ai). Spawns 5 specialized
review agents, cross-validates findings, synthesizes results, and produces an actionable
implementation plan.

## Install

Add to your `opencode.json` (project-level or global):

```jsonc
{
  "plugin": ["@mechanai/deepreview"]
}
```

OpenCode installs the package automatically at startup.

## Usage

```
/deepreview                   # Review current branch vs main
/deepreview 123               # Review PR #123
/deepreview file1.ts file2.ts # Review specific files

/deepreview-loop              # Review + fix loop (repeats until clean or 5 iterations)
/deepreview-loop 123          # Same, targeting a PR

/deepreview-pr-review 123     # Review PR and post findings as a pending GitHub review

/deepreview-spec spec.md      # Spec-focused review (completeness, consistency, feasibility)
/deepreview-spec-loop spec.md # Spec review + fix loop
```

All commands accept a branch diff, PR number, or file path(s). The `-loop` variants
apply fixes automatically and re-review until no findings remain. Pauses on deadlocks
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

| Agent | Code review | Spec review |
| --- | --- | --- |
| correctness / completeness | Logic bugs, edge cases, error handling | Gaps, missing edge cases, undefined behavior |
| security / consistency | Vulnerabilities, performance | Contradictions, name mismatches, type drift |
| architecture | Patterns, coupling, complexity | Patterns, coupling, complexity |
| docs | Comment quality, stale claims | Comment quality, stale claims |
| compatibility / feasibility | Breaking changes, API contracts | Implicit dependencies, can it be built |

## Requirements

- [OpenCode](https://opencode.ai)
- `git`
- `gh` CLI (only for PR commands)

## Development

```bash
bun install
mise run test
mise run lint
mise run fmt
```

## License

MIT
