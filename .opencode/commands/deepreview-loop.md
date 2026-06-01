---
description: "Run deepreview in a loop: review, apply fixes, re-review until clean"
---

You are an orchestrator that runs deepreview repeatedly until the code is clean. Follow these steps EXACTLY.

STEP 1: DETERMINE INPUT MODE
Parse "$ARGUMENTS" the same way as /deepreview:

- If it starts with `--context <path>`, extract CONTEXT_FILE=<path> and remove it from $ARGUMENTS before parsing the rest.
- Validate CONTEXT_FILE: it must be a relative path (no leading `/`), must not contain `..`, must exist on disk, and must be a regular file (not a directory or symlink to outside the project), and must be under 50KB. If validation fails, tell the user the error and STOP.
- If it is a number → MODE=pr, TARGET="$ARGUMENTS"
- If it is a file path or multiple file paths → MODE=files, TARGET="$ARGUMENTS"
- If it is empty → MODE=branch, TARGET=""

Set ITERATION=1
Set PRIOR_CONTEXT="" (empty — built up across iterations)
Set ALL_SESSION_DIRS=[] (list of all session directories used, in order)

If CONTEXT_FILE exists, read its contents and set PRIOR_CONTEXT to:
"## Design Decisions (intentional — do not flag)\nThe following are deliberate design choices. Do NOT flag these as issues or suggest alternatives.\n`\n" + contents of CONTEXT_FILE + "\n`\n"

STEP 2: RUN INITIAL DEEPREVIEW (full pipeline with cross-validation)
Run the full deepreview pipeline (Stages 1-5 from the deepreview command):

- Determine SESSION_DIR and write input.txt
- Append SESSION_DIR to ALL_SESSION_DIRS
- Stage 1: 5 parallel reviewers — prepend PRIOR_CONTEXT (if non-empty) to each reviewer's prompt as "${PRIOR_CONTEXT}You are reviewing ... Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-{perspective}.md."
- Stage 2: 5 parallel validators (cross-validation)
  - Note: validators do NOT receive PRIOR_CONTEXT. This is intentional — validators independently verify reviewer claims without being influenced by design context.- Stage 3: Synthesizer
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
Append SESSION_DIR to ALL_SESSION_DIRS

Prepare fresh input:

- MODE=pr or MODE=branch: run `git diff main > $SESSION_DIR/input.txt`
- MODE=files: re-read the same files into `$SESSION_DIR/input.txt`

Check if input.txt is empty. If empty, tell user "Nothing to review — all changes resolved." and STOP.

STEP 5a: BUILD PRIOR CONTEXT
Accumulate findings from ALL previous iterations into PRIOR_CONTEXT so no finding is re-reported.

To build this, dispatch a helper task that reads ALL previous syntheses:
NOTE: Interpolate the actual directory paths from ALL_SESSION_DIRS into this task string — the subagent cannot access your variables.
Task — Use the Task tool with subagent_type="general":
"Read the synthesis files from these directories: [LIST EACH PATH FROM ALL_SESSION_DIRS EXCLUDING CURRENT]. If any synthesis file does not exist, skip it. Extract ALL findings across them as a deduplicated Markdown list in this exact format:

## Prior Findings (already reported — do not re-report or verify)

- [Short Issue Title] ([category]) — [file:line]

## Covered Regions (already examined — prioritize elsewhere)

- [file:line-range] (pad each finding's file:line by 20 lines in each direction)

Deduplicate findings that appear in multiple syntheses. Return ONLY these two sections, nothing else."

Set PRIOR_CONTEXT to the returned text. Validate that it contains "## Prior Findings" — if not, warn the user ("Helper returned malformed prior context — proceeding without deduplication") and set PRIOR_CONTEXT="". If CONTEXT_FILE exists, prepend:
"## Design Decisions (intentional — do not flag)\nThe following are deliberate design choices. Do NOT flag these as issues or suggest alternatives.\n`\n" + contents of CONTEXT_FILE + "\n`\n\n"

NOW RUN A LIGHTWEIGHT REVIEW (Stages 1, 3, 4 only — NO cross-validation):

The key difference: iteration 2+ skips cross-validation. This prevents validators from filtering out new issues introduced by fixes.

Stage 1 — DISPATCH 5 PARALLEL REVIEWERS:
Each reviewer prompt MUST include PRIOR_CONTEXT and the novelty-seeking framing below.

The REVIEWER_PREAMBLE for all iter2+ reviewers is:
"Your goal is to find issues that PREVIOUS reviewers missed. Do NOT re-report, verify, or comment on prior findings.

$PRIOR_CONTEXT

Find genuinely new issues. You may find different issues in covered regions, but prioritize areas not yet examined."

Task 1 — Use the Task tool with subagent_type="deepreview-correctness":
"$REVIEWER_PREAMBLE

Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-correctness.md."

Task 2 — Use the Task tool with subagent_type="deepreview-security":
"$REVIEWER_PREAMBLE

Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-security.md."

Task 3 — Use the Task tool with subagent_type="deepreview-architecture":
"$REVIEWER_PREAMBLE

Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-architecture.md."

Task 4 — Use the Task tool with subagent_type="deepreview-docs":
"$REVIEWER_PREAMBLE

Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-docs.md."

Task 5 — Use the Task tool with subagent_type="deepreview-compatibility":
"$REVIEWER_PREAMBLE

Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-compatibility.md."

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
- Iteration 2+ MUST skip cross-validation, MUST include PRIOR_CONTEXT, and MUST use novelty-seeking framing.
- Iteration 2+ MUST NOT tell reviewers to "verify" or "check status of" prior findings.
- Each iteration uses a NEW session directory — never reuse a previous one.
- If --context file is provided, include its contents under "Design Decisions" in PRIOR_CONTEXT for ALL iterations (including iter1).
