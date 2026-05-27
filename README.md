# deepreview

Multi-agent parallel code review for [OpenCode](https://opencode.ai). Spawns 5 specialized
review agents, cross-validates findings, synthesizes results, and produces an actionable
implementation plan.

## How it works

### Code review (`/deepreview`)

```
Stage 1: 5 parallel reviewers (correctness, security, architecture, docs, compatibility)
Stage 2: 5 parallel cross-validators (try to disprove each finding)
Stage 3: Synthesizer (deduplicate, rank, produce unified report)
Stage 4: Planner (write exact code fixes)
Stage 5: Applier (apply fixes — user-gated)
```

### Spec/plan review (`/deepreview-spec`)

```
Stage 1: 5 parallel reviewers (completeness, consistency, feasibility, docs, architecture)
Stage 2: 5 parallel cross-validators (try to disprove each finding)
Stage 3: Synthesizer (deduplicate, rank, produce unified report)
Stage 4: Planner (write spec/plan fixes, not code fixes)
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

# Symlink commands
for f in ~/.local/share/deepreview/commands/*.md; do
  ln -sf "$f" ~/.config/opencode/commands/
done
```

Or copy directly:

```bash
cp agents/*.md ~/.config/opencode/agents/
cp commands/*.md ~/.config/opencode/commands/
```

## Usage

In any OpenCode session inside a git repo:

```
/deepreview                        # Review current branch vs main
/deepreview 123                    # Review PR #123
/deepreview path/to/spec.md        # Review a spec or plan
/deepreview doc1.md doc2.md        # Review multiple files

/deepreview-loop                   # Review + fix loop until clean
/deepreview-loop 123               # Same, targeting a PR
/deepreview-loop spec.md           # Same, targeting files

/deepreview-spec spec.md           # Spec-focused review (completeness, consistency, feasibility)
/deepreview-spec a.md b.md         # Review multiple spec/plan files

/deepreview-spec-loop spec.md      # Review + fix loop for specs until clean
/deepreview-spec-loop a.md b.md    # Same, targeting multiple files
```

`/deepreview-loop` runs the full code review, applies all fixes automatically, then
re-reviews. It repeats until no findings remain or hits the iteration limit (5,
extendable). Pauses on decision deadlocks (same finding persists across iterations).

`/deepreview-spec-loop` does the same for spec/plan files, applying spec fixes (not code
fixes) each iteration. Includes plateau detection to stop when findings oscillate rather
than converge.

The pipeline runs automatically. At the end, you'll see a summary and be asked whether
to apply the fixes.

## Requirements

- [OpenCode](https://opencode.ai)
- `git` (for diffs)
- `gh` CLI (only if reviewing PRs by number)

## Review agents

### Code review

| Agent | Focus |
|-------|-------|
| correctness | Logic bugs, edge cases, error handling, missing tests |
| security | Vulnerabilities, auth issues, performance bottlenecks |
| architecture | Patterns, coupling, abstractions, complexity |
| docs | Comment quality, stale claims, duplicate content |
| compatibility | Breaking changes, API contract violations |

### Spec/plan review

| Agent | Focus |
|-------|-------|
| spec-completeness | Gaps, missing edge cases, undefined behavior |
| spec-consistency | Contradictions, name mismatches, type drift |
| spec-feasibility | Can it be built, implicit dependencies, complexity |
| docs | Comment quality, stale claims, duplicate content |
| architecture | Patterns, coupling, abstractions, complexity |

## Output

All review artifacts are saved to `.ai/reviews/<branch-or-PR>-<date>/`:

```
.ai/reviews/feature-xyz-2025-05-10/
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
