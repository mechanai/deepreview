---
description: "Run deepreview-spec in a loop: review, apply fixes, re-review until clean"
---

You are an orchestrator that runs deepreview-spec repeatedly until the spec/plan is clean. Follow these steps EXACTLY.

STEP 1: DETERMINE INPUT
- If "$ARGUMENTS" is empty, tell the user "Usage: /deepreview-spec-loop <file1.md> [file2.md ...]" and STOP.
- Set FILES="$ARGUMENTS"
- Set ITERATION=1

STEP 2: RUN INITIAL DEEPREVIEW-SPEC (full pipeline with cross-validation)
Run the full deepreview-spec pipeline (Stages 1-5 from the deepreview-spec command):
- Determine SESSION_DIR=".ai/reviews/spec-loop-iter1-$(date +%Y-%m-%d-%H%M%S)" and write input.txt
- Stage 1: 5 parallel reviewers (completeness, consistency, feasibility, docs, architecture)
- Stage 2: 5 parallel validators (cross-validation)
- Stage 3: Synthesizer
- Stage 4: Implementation planner (spec changes, not code changes)

Record the stats from the synthesis return: count of critical, warning, and suggestion findings.

STEP 3: CHECK EXIT CONDITION
If the synthesis/review has 0 critical AND 0 warning AND 0 suggestion findings:
- Tell the user: "deepreview-spec-loop complete after $ITERATION iteration(s). No findings remain."
- STOP.

STEP 4: APPLY ALL FIXES
Dispatch the applier automatically — do NOT ask the user for permission.
Use the Task tool with subagent_type="deepreview-applier":
"Read the implementation plan at $SESSION_DIR/implementation-plan.md. Apply the fixes."

Wait for the applier to return.

STEP 5: INCREMENT AND RE-REVIEW
Set ITERATION = ITERATION + 1

If ITERATION > 5:
- Tell the user: "deepreview-spec-loop hit iteration limit (5). Remaining findings may require manual intervention or a design decision."
- Show the latest stats.
- Ask the user: "Continue for more iterations, or stop here?"
- If user says stop → STOP.
- If user says continue → reset limit to ITERATION + 5 and proceed.

Create new session directory: SESSION_DIR=".ai/reviews/spec-loop-iter$ITERATION-$(date +%Y-%m-%d-%H%M%S)"
Run `mkdir -p $SESSION_DIR`

Re-read the same files into `$SESSION_DIR/input.txt`:
`for f in $FILES; do echo "=== $f ===" >> $SESSION_DIR/input.txt; cat "$f" >> $SESSION_DIR/input.txt; echo >> $SESSION_DIR/input.txt; done`

Check if input.txt is empty. If empty, tell user "Nothing to review — files are empty." and STOP.

NOW RUN A FULL REVIEW (with cross-validation):

Unlike the code loop, spec review iterations ALWAYS include cross-validation. Specs have no
objective "correct" — without validators filtering subjective opinions, reviewers diverge rather
than converge, producing more findings each iteration instead of fewer.

Stage 1 — DISPATCH 5 PARALLEL REVIEWERS:
Each reviewer prompt MUST include: "This is a fresh review. You have no prior context about this spec. Review it as if seeing it for the first time. Do not assume anything is correct just because it looks intentional. Focus ONLY on objective issues (contradictions, gaps, impossibilities) — do NOT flag stylistic preferences or reorganization suggestions."

Task 1 — Use the Task tool with subagent_type="deepreview-spec-completeness":
"This is a fresh review. You have no prior context about this spec. Review it as if seeing it for the first time. Focus ONLY on objective issues — do NOT flag stylistic preferences. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-completeness.md."

Task 2 — Use the Task tool with subagent_type="deepreview-spec-consistency":
"This is a fresh review. You have no prior context about this spec. Review it as if seeing it for the first time. Focus ONLY on objective issues — do NOT flag stylistic preferences. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-consistency.md."

Task 3 — Use the Task tool with subagent_type="deepreview-spec-feasibility":
"This is a fresh review. You have no prior context about this spec. Review it as if seeing it for the first time. Focus ONLY on objective issues — do NOT flag stylistic preferences. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-feasibility.md."

Task 4 — Use the Task tool with subagent_type="deepreview-docs":
"This is a fresh review. You have no prior context about this spec. Review it as if seeing it for the first time. Focus ONLY on objective issues — do NOT flag stylistic preferences. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-docs.md."

Task 5 — Use the Task tool with subagent_type="deepreview-architecture":
"This is a fresh review. You have no prior context about this spec. Review it as if seeing it for the first time. Focus ONLY on objective issues — do NOT flag stylistic preferences. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-architecture.md."

Wait for all 5. Record which succeeded.

Stage 2 — DISPATCH 5 PARALLEL VALIDATORS (cross-validation):
Task 6-10 — Use the Task tool with subagent_type="deepreview-validator" (5 times, one per perspective):
Each validator reads ALL review files and writes to $SESSION_DIR/validated-{completeness,consistency,feasibility,docs,architecture}.md.

Wait for all 5.

Stage 3 — DISPATCH SYNTHESIZER:
Task 11 — Use the Task tool with subagent_type="deepreview-synthesizer":
"Read the validated reviews at: $SESSION_DIR/validated-completeness.md, $SESSION_DIR/validated-consistency.md, $SESSION_DIR/validated-feasibility.md, $SESSION_DIR/validated-docs.md, $SESSION_DIR/validated-architecture.md. Write the synthesis to $SESSION_DIR/synthesis.md."

Record the stats line.

Stage 4 — DISPATCH PLANNER:
Task 12 — Use the Task tool with subagent_type="deepreview-planner":
"Read the synthesis at $SESSION_DIR/synthesis.md. The original input is a spec/plan document, not code. Write an implementation plan that describes what changes to make to the spec/plan document itself (not code changes). Write to $SESSION_DIR/implementation-plan.md."

Record the summary line.

Go to STEP 3.

STEP 6: DIVERGENCE AND DEADLOCK DETECTION
Track finding counts across iterations. Detect TWO failure modes:

A) DIVERGENCE: If total findings (critical + warning + suggestion) INCREASE from one iteration to the next:
- Tell the user: "Divergence detected: findings increased from N to M. The review is not converging — fixes are introducing new issues or reviewers are finding new stylistic concerns."
- Show the iteration-over-iteration stats.
- Ask: "Accept current state, revert last iteration's changes, or continue with only critical/warning fixes (ignore suggestions)?"
- Follow the user's instruction.

B) DEADLOCK: If two consecutive iterations produce the same findings (same location, same issue title):
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
- Each iteration uses a NEW session directory — never reuse a previous one.
