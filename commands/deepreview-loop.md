---
description: "Run deepreview in a loop: review, apply fixes, re-review until clean"
---

You are an orchestrator that runs deepreview repeatedly until the code is clean. Follow these steps EXACTLY.

STEP 1: DETERMINE INPUT MODE
Parse "$ARGUMENTS" the same way as /deepreview:

- If it is a number → MODE=pr, TARGET="$ARGUMENTS"
- If it is a file path or multiple file paths → MODE=files, TARGET="$ARGUMENTS"
- If it is empty → MODE=branch, TARGET=""

Set ITERATION=1

STEP 2: RUN INITIAL DEEPREVIEW (full pipeline with cross-validation)
Run the full deepreview pipeline (Stages 1-5 from the deepreview command):

- Determine SESSION_DIR and write input.txt
- Stage 1: 5 parallel reviewers
- Stage 2: 5 parallel validators (cross-validation)
- Stage 3: Synthesizer
- Stage 4: Implementation planner

Record the stats from the synthesis return: count of critical, warning, and suggestion findings.

STEP 3: CHECK EXIT CONDITION
If the synthesis/review has 0 critical AND 0 warning AND 0 suggestion findings:

- Tell the user: "deepreviewloop complete after $ITERATION iteration(s). No findings remain."
- STOP.

STEP 4: APPLY ALL FIXES
Dispatch the applier automatically — do NOT ask the user for permission.
Use the Task tool with subagent_type="deepreview-applier":
"Read the implementation plan at $SESSION_DIR/implementation-plan.md. Apply the fixes."

Wait for the applier to return.

STEP 5: INCREMENT AND RE-REVIEW (lightweight — NO cross-validation)
Set ITERATION = ITERATION + 1

If ITERATION > 5:

- Tell the user: "deepreviewloop hit iteration limit (5). Remaining findings may require manual intervention or a design decision."
- Show the latest stats.
- Ask the user: "Continue for more iterations, or stop here?"
- If user says stop → STOP.
- If user says continue → reset limit to ITERATION + 5 and proceed.

Create new session directory: SESSION_DIR=".ai/deepreview/loop-iter$ITERATION-$(date +%Y-%m-%d-%H%M%S)"
Run `mkdir -p $SESSION_DIR`

Prepare fresh input:

- MODE=pr or MODE=branch: run `git diff main > $SESSION_DIR/input.txt`
- MODE=files: re-read the same files into `$SESSION_DIR/input.txt`

Check if input.txt is empty. If empty, tell user "Nothing to review — all changes resolved." and STOP.

NOW RUN A LIGHTWEIGHT REVIEW (Stages 1, 3, 4 only — NO cross-validation):

The key difference: iteration 2+ skips cross-validation entirely. This prevents the validators from filtering out new issues introduced by fixes. Each iteration is a fresh, unbiased review.

Stage 1 — DISPATCH 5 PARALLEL REVIEWERS:
Each reviewer prompt MUST include: "This is a fresh review. You have no prior context about this code. Review it as if seeing it for the first time. Do not assume anything is correct just because it looks intentional."

Task 1 — Use the Task tool with subagent_type="deepreview-correctness":
"This is a fresh review. You have no prior context about this code. Review it as if seeing it for the first time. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-correctness.md."

Task 2 — Use the Task tool with subagent_type="deepreview-security":
"This is a fresh review. You have no prior context about this code. Review it as if seeing it for the first time. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-security.md."

Task 3 — Use the Task tool with subagent_type="deepreview-architecture":
"This is a fresh review. You have no prior context about this code. Review it as if seeing it for the first time. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-architecture.md."

Task 4 — Use the Task tool with subagent_type="deepreview-docs":
"This is a fresh review. You have no prior context about this code. Review it as if seeing it for the first time. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-docs.md."

Task 5 — Use the Task tool with subagent_type="deepreview-compatibility":
"This is a fresh review. You have no prior context about this code. Review it as if seeing it for the first time. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-compatibility.md."

Wait for all 5. Record which succeeded.

Stage 3 (skip Stage 2) — DISPATCH SYNTHESIZER DIRECTLY ON RAW REVIEWS:
Task 6 — Use the Task tool with subagent_type="deepreview-synthesizer":
"Read the reviews at: $SESSION_DIR/review-correctness.md, $SESSION_DIR/review-security.md, $SESSION_DIR/review-architecture.md, $SESSION_DIR/review-docs.md, $SESSION_DIR/review-compatibility.md. Write the synthesis to $SESSION_DIR/synthesis.md."

Record the stats line.

Stage 4 — DISPATCH PLANNER:
Task 7 — Use the Task tool with subagent_type="deepreview-planner":
"Read the synthesis at $SESSION_DIR/synthesis.md. Write the implementation plan to $SESSION_DIR/implementation-plan.md."

Record the summary line.

Go to STEP 3.

STEP 6: DECISION DEADLOCK DETECTION
If two consecutive iterations produce the SAME findings (same file:line, same issue title), this indicates a deadlock — the applier is making changes that don't resolve the issue, or the reviewer keeps flagging the same thing.

When deadlock is detected:

- Tell the user: "Deadlock detected: the following findings persist across iterations:"
- List the repeated findings.
- Ask: "How would you like to resolve these? Options: skip these findings, provide guidance, or stop the loop."
- Follow the user's instruction.

IMPORTANT RULES:

- Do NOT read any review/synthesis/plan files yourself. Ever.
- Use ONLY the file paths and stats/summary lines returned by subagents.
- Apply ALL findings (critical, warning, AND suggestion) — the goal is a clean review.
- Do NOT ask the user for permission to apply fixes. Apply automatically.
- DO ask the user if iteration limit is hit or deadlock is detected.
- Iteration 2+ MUST skip cross-validation and MUST include "fresh review" framing in prompts.
- Each iteration uses a NEW session directory — never reuse a previous one.
