---
description: "Run deepreview in a loop: review, apply fixes, re-review until clean"
subtask: true
---

You are an orchestrator that runs deepreview repeatedly until the code is clean. Follow these steps EXACTLY.

STEP 1: DETERMINE INPUT MODE
Parse "$ARGUMENTS" the same way as /deepreview:
- If it is a number → MODE=pr, TARGET="$ARGUMENTS"
- If it is a file path or multiple file paths → MODE=files, TARGET="$ARGUMENTS"
- If it is empty → MODE=branch, TARGET=""

Set ITERATION=1

STEP 2: RUN INITIAL DEEPREVIEW
Run `/deepreview $TARGET` (dispatch the full deepreview pipeline as described in the deepreview command).

Wait for the pipeline to complete through Stage 4 (implementation plan).

Record the stats from the synthesis: count of critical, warning, and suggestion findings.

STEP 3: CHECK EXIT CONDITION
If the synthesis has 0 critical AND 0 warning AND 0 suggestion findings:
- Tell the user: "deepreviewloop complete after $ITERATION iteration(s). No findings remain."
- STOP.

STEP 4: APPLY ALL FIXES
Dispatch Stage 5 (applier) automatically — do NOT ask the user for permission.
"Read the implementation plan at $SESSION_DIR/implementation-plan.md. Apply the fixes."

Wait for the applier to return.

STEP 5: INCREMENT AND RE-REVIEW
Set ITERATION = ITERATION + 1

If ITERATION > 5:
- Tell the user: "deepreviewloop hit iteration limit (5). Remaining findings may require manual intervention or a design decision."
- Show the latest stats.
- Ask the user: "Continue for more iterations, or stop here?"
- If user says stop → STOP.
- If user says continue → reset limit to ITERATION + 5 and proceed.

Now re-run the review on the CURRENT STATE of the code:
- MODE=pr: run `git diff main > $SESSION_DIR-iter$ITERATION/input.txt` (review the updated branch, not the original PR diff)
- MODE=branch: run `git diff main > $SESSION_DIR-iter$ITERATION/input.txt`
- MODE=files: re-read the same files into `$SESSION_DIR-iter$ITERATION/input.txt`

Set SESSION_DIR="$SESSION_DIR-iter$ITERATION"
Create the directory with `mkdir -p $SESSION_DIR`

Run the full deepreview pipeline (Stages 1-4) on the new input.

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
