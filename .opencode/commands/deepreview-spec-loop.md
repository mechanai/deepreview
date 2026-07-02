---
description: "Run deepreview-spec in a loop: review, apply fixes, re-review until clean"
---

You are an orchestrator that runs deepreview-spec repeatedly until the spec/plan is clean. Follow these steps EXACTLY.

STEP 1: DETERMINE INPUT

- If "$ARGUMENTS" starts with `--context <path>`, extract CONTEXT_FILE=<path> and remove it from $ARGUMENTS before parsing the rest.
- Validate CONTEXT_FILE: it must be a relative path (no leading `/`), must not contain `..`, must exist on disk, and must be a regular file (not a directory or symlink to outside the project), and must be under 50KB. If validation fails, tell the user the error and STOP.
- If remaining "$ARGUMENTS" is empty, tell the user "Usage: /deepreview-spec-loop [--context <file>] <file1> [file2 ...]" and STOP.
- Set FILES="$ARGUMENTS"
- Set ITERATION=1
- Set PRIOR_CONTEXT="" (empty — built up across iterations; holds both design context and prior findings)
- Set CONSECUTIVE_ZERO_NEW=0 (tracks consecutive iterations with 0 new findings for deadlock detection)
- Set ALL_SESSION_DIRS=[] (list of all session directories used, in order)
- Determine REPO_ROOT — the main repository root (not a worktree root). Run:
  `REPO_ROOT=$(realpath "$(git rev-parse --git-common-dir)" | sed 's|/\.git$||')`

Extract PROJECT_CONTEXT by detecting project metadata (version, deployment model, publish status):

- Check for package.json or Cargo.toml to detect version and publish status
- Check for .deepreview.yml to detect explicit deployment model (threatModel field)
- If no .deepreview.yml exists, infer deployment model: v0.x.0 and private packages are "internal-network", v1+.x.x and public are "public-facing", otherwise "unknown"
- Format as a calibration preamble with version info, deployment model, and guidance for severity adjustment
- If metadata extraction fails or no version info is found, set PROJECT_CONTEXT="" (empty string)

Build PRIOR_CONTEXT:

- Start with PROJECT_CONTEXT (if non-empty)
- If CONTEXT_FILE exists, append:
  "## Design Decisions (intentional — do not flag)\nThe following are deliberate design choices. Do NOT flag these as issues or suggest alternatives.\n`\n" + contents of CONTEXT_FILE + "\n`\n\n"
- If neither PROJECT_CONTEXT nor CONTEXT_FILE exist, set PRIOR_CONTEXT="" (empty string)

STEP 2: RUN INITIAL DEEPREVIEW-SPEC (full pipeline with cross-validation)
Run the full deepreview-spec pipeline (Stages 1-5 from the deepreview-spec command):

- Determine SESSION_DIR="$REPO_ROOT/.ai/deepreview/spec-loop-iter1-$(date +%Y-%m-%d-%H%M%S)" and write input.txt
- Append SESSION_DIR to ALL_SESSION_DIRS
- Stage 1: 5 parallel reviewers (completeness, consistency, feasibility, docs, architecture) — prepend PRIOR_CONTEXT (if non-empty) to each reviewer's prompt as "${PRIOR_CONTEXT}You are reviewing ... Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-{perspective}.md."
- Stage 2: 5 parallel validators (cross-validation)
- Stage 3: Synthesizer
- Stage 4: Implementation planner (spec changes, not code changes)
- Stage 5: Plan validator — dispatch plan-validator with implementation-plan.md, synthesis.md, and input.txt.
  If it fails, warn and set PLAN_FILE="$SESSION_DIR/implementation-plan.md".
  Otherwise set PLAN_FILE="$SESSION_DIR/validated-plan.md".

Record the stats from the synthesis return: count of critical, warning, and suggestion findings.

STEP 3: CHECK EXIT CONDITIONS

Parse the stats line from the synthesizer. If it contains novelty metrics (the `| N new, N recurring, N regression` suffix), use NOVELTY MODE. Otherwise use LEGACY MODE.

NOVELTY MODE (iter2+ only):

A) CLEAN EXIT: If 0 critical AND 0 warning AND 0 suggestion:
- Tell the user: "deepreview-spec-loop complete after $ITERATION iteration(s). No findings remain."
- STOP.

B) CONVERGENCE EXIT: If `0 new AND 0 regression`:
- Tell the user: "deepreview-spec-loop converged after $ITERATION iteration(s). No new findings detected. Remaining recurring findings (if any) reflect reviewer opinion differences."
- STOP.

C) DEADLOCK EXIT: If `0 new AND N recurring (N > 0) AND 0 regression` for 2 consecutive iterations:
- Tell the user: "Deadlock detected: $N recurring findings persist with no new issues found across 2 iterations:"
- List the recurring findings.
- Ask: "How would you like to resolve these? Options: skip these findings, provide guidance, or stop the loop."
- Follow the user's instruction.

D) Otherwise: proceed to STEP 4.

Tracking: If `0 new`, increment CONSECUTIVE_ZERO_NEW. If `> 0 new`, reset CONSECUTIVE_ZERO_NEW to 0. Deadlock (C) triggers when CONSECUTIVE_ZERO_NEW >= 2 AND recurring > 0.

LEGACY MODE (fallback when synthesizer omits novelty metrics):

Warn the user: "Synthesizer did not return novelty metrics — falling back to legacy convergence detection."

Track the total finding count (critical + warning + suggestion) for each iteration in a list: HISTORY.

A) CLEAN EXIT: If 0 critical AND 0 warning AND 0 suggestion:
- Tell the user: "deepreview-spec-loop complete after $ITERATION iteration(s). No findings remain."
- STOP.

B) PLATEAU EXIT: If ITERATION >= 3 and the total has not decreased compared to the minimum of any previous iteration for 2 consecutive iterations:
- Tell the user: "deepreview-spec-loop plateau after $ITERATION iteration(s). Findings are oscillating (history: [list totals]) and not converging."
- Show the latest stats breakdown.
- STOP.

STEP 4: APPLY ALL FIXES
Dispatch the applier automatically — do NOT ask the user for permission.
Use the Task tool with subagent_type="deepreview-applier":
"Read the implementation plan at $PLAN_FILE. Apply the fixes."

Wait for the applier to return.

<!-- Note: No verification failure handling here (unlike code-loop) because spec changes don't trigger lint/test failures. -->

STEP 5: INCREMENT AND RE-REVIEW
Set ITERATION = ITERATION + 1

If ITERATION > 7:

- Tell the user: "deepreview-spec-loop hit iteration limit (7). This should not normally happen — convergence or deadlock detection should have stopped earlier."
- Show the latest stats.
- STOP.

Create new session directory: SESSION_DIR="$REPO_ROOT/.ai/deepreview/spec-loop-iter$ITERATION-$(date +%Y-%m-%d-%H%M%S)"
Run `mkdir -p $SESSION_DIR`
Append SESSION_DIR to ALL_SESSION_DIRS

Re-read the same files into `$SESSION_DIR/input.txt`:
`for f in $FILES; do echo "=== $f ===" >> $SESSION_DIR/input.txt; cat "$f" >> $SESSION_DIR/input.txt; echo >> $SESSION_DIR/input.txt; done`

Check if input.txt is empty. If empty, tell user "Nothing to review — files are empty." and STOP.

BUILD PRIOR CONTEXT FOR THIS ITERATION:
Dispatch a helper task to extract findings from ALL previous syntheses:
Task — Use the Task tool with subagent_type="general":
"Read the synthesis files AND implementation plan files from these directories: [LIST EACH PATH FROM ALL_SESSION_DIRS EXCLUDING CURRENT]. If any file does not exist, skip it. Extract:

## Prior Findings (already reported — do not re-report or verify)

For each finding, include the title, category, location, AND a 1-sentence mechanism description explaining what the underlying problem is:

- [Short Issue Title] ([category]) — [file:line or section reference] — [1-sentence description of the underlying mechanism/problem]

Example:

- Missing error recovery path (completeness) — spec.md:§3.2 — no defined behavior when upstream service returns partial data

## Known Issue Locations (same location = likely same issue — justify if reporting again)

List every location from Prior Findings in a condensed location-first index:

- [file:line or section reference] — [condensed mechanism] ([category])

## Applied Fixes (changes made by previous iterations — new bugs here are regressions)

- [Fix title from implementation plan] — [file:line or section reference] (applied in iter N)

## Covered Regions (already examined — prioritize elsewhere)

- [file or section references, padded generously around each finding location]

Deduplicate findings that appear in multiple syntheses. Return ONLY these four sections, nothing else."

Set PRIOR_CONTEXT to the returned text. Validate that it contains "## Prior Findings" — if not, warn the user ("Helper returned malformed prior context — proceeding without deduplication") and set PRIOR_CONTEXT="". If CONTEXT_FILE exists, prepend:
"## Design Decisions (intentional — do not flag)\nThe following are deliberate design choices. Do NOT flag these as issues or suggest alternatives.\n`\n" + contents of CONTEXT_FILE + "\n`\n\n"

The REVIEWER_PREAMBLE for all iter2+ reviewers is:
"Your goal is to find issues that PREVIOUS reviewers missed. Do NOT re-report, verify, or comment on prior findings.

When you encounter a potential issue:

1. Check "Known Issue Locations" — if your finding is at or near a listed location, it is almost certainly already reported. Only report it if the mechanism is genuinely different (not just differently worded).
2. Check "Prior Findings" — if your finding matches an existing mechanism description (even at a different location), it is a variant of an already-reported issue. Do not report it.

$PRIOR_CONTEXT

Find genuinely new issues. You may find different issues in covered regions, but prioritize areas not yet examined. Focus ONLY on objective issues — do NOT flag stylistic preferences."

<!-- The objectivity constraint is spec-loop-specific because specs lack objective correctness criteria, making subjective drift more likely in iterative passes. -->

NOW RUN A FULL REVIEW (with cross-validation):

Unlike the code loop, spec review iterations ALWAYS include cross-validation. Without validators
filtering subjective opinions, reviewers diverge rather than converge.

Stage 1 — DISPATCH 5 PARALLEL REVIEWERS:

Task 1 — Use the Task tool with subagent_type="deepreview-spec-completeness":
"$REVIEWER_PREAMBLE

Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-completeness.md."

Task 2 — Use the Task tool with subagent_type="deepreview-spec-consistency":
"$REVIEWER_PREAMBLE

Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-consistency.md."

Task 3 — Use the Task tool with subagent_type="deepreview-spec-feasibility":
"$REVIEWER_PREAMBLE

Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-feasibility.md."

Task 4 — Use the Task tool with subagent_type="deepreview-docs":
"$REVIEWER_PREAMBLE

Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-docs.md."

Task 5 — Use the Task tool with subagent_type="deepreview-architecture":
"$REVIEWER_PREAMBLE

Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-architecture.md."

Wait for all 5. Record which succeeded.

Stage 2 — DISPATCH 5 PARALLEL VALIDATORS (cross-validation):
Task 6-10 — Use the Task tool with subagent_type="deepreview-validator" (5 times, one per perspective):
Each validator reads ALL review files and writes to $SESSION_DIR/validated-{completeness,consistency,feasibility,docs,architecture}.md.
Note: Validators intentionally do NOT receive PRIOR_CONTEXT. They filter on objective merit only — whether findings are technically valid and actionable. The novelty filter is applied at the reviewer level.

Wait for all 5.

Stage 3 — DISPATCH SYNTHESIZER:
Extract PRIOR_FINDINGS_SECTION from PRIOR_CONTEXT: include only the "## Prior Findings" and "## Applied Fixes" sections (not "Known Issue Locations" or "Covered Regions" — those are for reviewers only).

Task 11 — Use the Task tool with subagent_type="deepreview-synthesizer":
"## Prior Findings for Novelty Classification
$PRIOR_FINDINGS_SECTION

Read the validated reviews at: $SESSION_DIR/validated-completeness.md, $SESSION_DIR/validated-consistency.md, $SESSION_DIR/validated-feasibility.md, $SESSION_DIR/validated-docs.md, $SESSION_DIR/validated-architecture.md (skip any that don't exist). Write the synthesis to $SESSION_DIR/synthesis.md."

Record the stats line.

Stage 4 — DISPATCH PLANNER:
Task 12 — Use the Task tool with subagent_type="deepreview-planner":
"Read the synthesis at $SESSION_DIR/synthesis.md. The original input is a spec/plan document, not code. Write an implementation plan that describes what changes to make to the spec/plan document itself (not code changes). Write to $SESSION_DIR/implementation-plan.md."

Record the summary line.

Stage 5 — DISPATCH PLAN VALIDATOR:
Task 13 — Use the Task tool with subagent_type="deepreview-plan-validator":
"Read the implementation plan at $SESSION_DIR/implementation-plan.md, the synthesis at $SESSION_DIR/synthesis.md, and the original input at $SESSION_DIR/input.txt. Write the validated plan to $SESSION_DIR/validated-plan.md."

If this task fails, emit a warning: "Plan validation failed — applying unvalidated plan." and set PLAN_FILE="$SESSION_DIR/implementation-plan.md". Otherwise set PLAN_FILE="$SESSION_DIR/validated-plan.md" and record the stats line.

Go to STEP 3.

STEP 6: DIVERGENCE AND DEADLOCK DETECTION
Track finding counts across iterations. Detect TWO failure modes:

A) DIVERGENCE: If total findings INCREASE from one iteration to the next:
- If novelty metrics are available AND all additional findings are classified [RECURRING] (none are [NEW]):
  Treat as deadlock, not divergence. Tell the user: "Apparent divergence is actually recurring findings being re-reported. Treating as deadlock."
  Trigger deadlock prompt.
- Otherwise (genuinely new findings increasing):
  Tell the user: "Divergence detected: findings increased from N to M. The review is not converging — fixes are introducing new issues or reviewers are finding new stylistic concerns."
  Show the iteration-over-iteration stats.
  Ask: "Accept current state, revert last iteration's changes, or continue with only critical/warning fixes (ignore suggestions)?"
  Follow the user's instruction.

B) DEADLOCK: If STEP 3 NOVELTY MODE deadlock has not triggered but two consecutive iterations produce the same findings (same location, same issue title):

- Tell the user: "Deadlock detected: the following findings persist across iterations:"
- List the repeated findings.
- Ask: "How would you like to resolve these? Options: skip these findings, provide guidance, or stop the loop."
- Follow the user's instruction.

IMPORTANT RULES:

- Do NOT read any review/synthesis/plan files yourself. Ever.
- Use ONLY the file paths and stats/summary lines returned by subagents.
- Apply ALL findings (critical, warning, AND suggestion) — the goal is a clean review.
- Do NOT ask the user for permission to apply fixes. Apply automatically.
- DO ask the user if iteration limit is hit, divergence is detected, or deadlock is detected.
- ALL iterations include cross-validation (unlike the code loop).
- Iteration 2+ MUST include PRIOR_CONTEXT and novelty-seeking framing.
- Iteration 2+ MUST NOT tell reviewers to "verify" or "check status of" prior findings.
- Each iteration uses a NEW session directory — never reuse a previous one.
- If --context file is provided, include its contents under "Design Decisions" in PRIOR_CONTEXT for ALL iterations (including iter1).
