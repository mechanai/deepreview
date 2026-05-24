# deepreview

Multi-agent parallel code review for [OpenCode](https://opencode.ai). Spawns 5 specialized
review agents, cross-validates findings, synthesizes results, and produces an actionable
implementation plan.

## How it works

```
/deepreview [PR#]

Stage 1: 5 parallel reviewers (correctness, security, architecture, docs, compatibility)
Stage 2: 5 parallel cross-validators (try to disprove each finding)
Stage 3: Synthesizer (deduplicate, rank, produce unified report)
Stage 4: Planner (write exact code fixes)
Stage 5: Applier (apply fixes — user-gated)
```

All communication between stages happens via files on disk. The orchestrator never reads
review content into its own context, keeping token usage minimal.

## Install

Copy or symlink the agent and command files into your OpenCode config:

```bash
# Clone the repo
git clone <repo-url> ~/.local/share/deepreview

# Symlink agents
for f in ~/.local/share/deepreview/agents/*.md; do
  ln -sf "$f" ~/.config/opencode/agents/
done

# Symlink command
ln -sf ~/.local/share/deepreview/commands/deepreview.md ~/.config/opencode/commands/
```

Or copy directly:

```bash
cp agents/*.md ~/.config/opencode/agents/
cp commands/*.md ~/.config/opencode/commands/
```

## Usage

In any OpenCode session inside a git repo:

```
/deepreview        # Review current branch vs main
/deepreview 123    # Review PR #123
```

The pipeline runs automatically. At the end, you'll see a summary and be asked whether
to apply the fixes.

## Requirements

- [OpenCode](https://opencode.ai)
- `git` (for diffs)
- `gh` CLI (only if reviewing PRs by number)

## Review agents

| Agent | Focus |
|-------|-------|
| correctness | Logic bugs, edge cases, error handling, missing tests |
| security | Vulnerabilities, auth issues, performance bottlenecks |
| architecture | Patterns, coupling, abstractions, complexity |
| docs | Comment quality, stale claims, duplicate content |
| compatibility | Breaking changes, API contract violations |

## Output

All review artifacts are saved to `reviews/<branch-or-PR>-<date>/`:

```
reviews/feature-xyz-2025-05-10/
├── diff.txt
├── review-correctness.md
├── review-security.md
├── review-architecture.md
├── review-docs.md
├── review-compatibility.md
├── validated-correctness.md
├── validated-security.md
├── validated-architecture.md
├── validated-docs.md
├── validated-compatibility.md
├── synthesis.md
└── implementation-plan.md
```

## License

MIT
