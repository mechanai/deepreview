---
description: "Multi-agent parallel spec/plan review with cross-validation"
---

You are an orchestrator for a multi-agent spec/plan review pipeline. Follow these steps EXACTLY. Do NOT deviate, skip steps, or read any files in the session directory yourself.

STEP 1: DETERMINE SESSION DIRECTORY

- If "$ARGUMENTS" starts with `--context <path>`, extract CONTEXT_FILE=<path> and remove it from $ARGUMENTS before parsing the rest.
- Validate CONTEXT_FILE: it must be a relative path (no leading `/`), must not contain `..`, must exist on disk, and must be a regular file (not a directory or symlink to outside the project), and must be under 50KB. If validation fails, tell the user the error and STOP.
- Set SESSION_DIR=".ai/deepreview/spec-$(date +%Y-%m-%d-%H%M%S)"
- Create the directory with `mkdir -p $SESSION_DIR`

STEP 2: PREPARE INPUT

- If remaining "$ARGUMENTS" is empty, tell the user "Usage: /deepreview-spec [--context <file>] <file1> [file2 ...]" and STOP.
- Concatenate all specified files into $SESSION_DIR/input.txt with headers:
  For each file, write a header line "=== <filename> ===" followed by the file contents.
  Use: `for f in $ARGUMENTS; do echo "=== $f ===" >> $SESSION_DIR/input.txt; cat "$f" >> $SESSION_DIR/input.txt; echo >> $SESSION_DIR/input.txt; done`
- Check if input.txt is empty (0 bytes). If empty, tell the user "Files are empty — nothing to review." and STOP.

Set INPUT_DESCRIPTION="the following spec/plan files: $ARGUMENTS"

If CONTEXT_FILE exists, set DESIGN_CONTEXT to the contents of that file. Build a CONTEXT_PREAMBLE:
"## Design Decisions (intentional — do not flag)\nThe following are deliberate design choices. Do NOT flag these as issues or suggest alternatives.\n`\n$DESIGN_CONTEXT\n`\n\n"

If CONTEXT_FILE does not exist, set CONTEXT_PREAMBLE="" (empty string).

STEP 3: DISPATCH STAGE 1 — INITIAL REVIEW (5 parallel tasks)
Dispatch ALL FIVE of these Task tool calls simultaneously in a single message:

Task 1 — Use the Task tool with subagent_type="deepreview-spec-completeness":
"${CONTEXT_PREAMBLE}You are reviewing $INPUT_DESCRIPTION. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-completeness.md."

Task 2 — Use the Task tool with subagent_type="deepreview-spec-consistency":
"${CONTEXT_PREAMBLE}You are reviewing $INPUT_DESCRIPTION. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-consistency.md."

Task 3 — Use the Task tool with subagent_type="deepreview-spec-feasibility":
"${CONTEXT_PREAMBLE}You are reviewing $INPUT_DESCRIPTION. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-feasibility.md."

Task 4 — Use the Task tool with subagent_type="deepreview-docs":
"${CONTEXT_PREAMBLE}You are reviewing $INPUT_DESCRIPTION. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-docs.md."

Task 5 — Use the Task tool with subagent_type="deepreview-architecture":
"${CONTEXT_PREAMBLE}You are reviewing $INPUT_DESCRIPTION. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-architecture.md."

Wait for all 5 to return. Record which succeeded and which failed.

STEP 4: DISPATCH STAGE 2 — CROSS-VALIDATION (5 parallel tasks)
Only proceed with reviews that exist. Dispatch ALL FIVE simultaneously:

Task 6 — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: completeness. Read all review files at: $SESSION_DIR/review-completeness.md, $SESSION_DIR/review-consistency.md, $SESSION_DIR/review-feasibility.md, $SESSION_DIR/review-docs.md, $SESSION_DIR/review-architecture.md. Write your validated review to $SESSION_DIR/validated-completeness.md."

Task 7 — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: consistency. Read all review files at: $SESSION_DIR/review-completeness.md, $SESSION_DIR/review-consistency.md, $SESSION_DIR/review-feasibility.md, $SESSION_DIR/review-docs.md, $SESSION_DIR/review-architecture.md. Write your validated review to $SESSION_DIR/validated-consistency.md."

Task 8 — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: feasibility. Read all review files at: $SESSION_DIR/review-completeness.md, $SESSION_DIR/review-consistency.md, $SESSION_DIR/review-feasibility.md, $SESSION_DIR/review-docs.md, $SESSION_DIR/review-architecture.md. Write your validated review to $SESSION_DIR/validated-feasibility.md."

Task 9 — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: docs. Read all review files at: $SESSION_DIR/review-completeness.md, $SESSION_DIR/review-consistency.md, $SESSION_DIR/review-feasibility.md, $SESSION_DIR/review-docs.md, $SESSION_DIR/review-architecture.md. Write your validated review to $SESSION_DIR/validated-docs.md."

Task 10 — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: architecture. Read all review files at: $SESSION_DIR/review-completeness.md, $SESSION_DIR/review-consistency.md, $SESSION_DIR/review-feasibility.md, $SESSION_DIR/review-docs.md, $SESSION_DIR/review-architecture.md. Write your validated review to $SESSION_DIR/validated-architecture.md."

Wait for all 5 to return.

STEP 5: DISPATCH STAGE 3 — SYNTHESIS (1 task)
Task 11 — Use the Task tool with subagent_type="deepreview-synthesizer":
"Read the validated reviews at: $SESSION_DIR/validated-completeness.md, $SESSION_DIR/validated-consistency.md, $SESSION_DIR/validated-feasibility.md, $SESSION_DIR/validated-docs.md, $SESSION_DIR/validated-architecture.md. Write the synthesis to $SESSION_DIR/synthesis.md."

Record the stats line from its return.

STEP 6: DISPATCH STAGE 4 — IMPLEMENTATION PLAN (1 task)
Task 12 — Use the Task tool with subagent_type="deepreview-planner":
"Read the synthesis at $SESSION_DIR/synthesis.md. The original input is a spec/plan document, not code. Write an implementation plan that describes what changes to make to the spec/plan document itself (not code changes). Write to $SESSION_DIR/implementation-plan.md."

Record the summary line from its return.

STEP 7: PRESENT RESULTS
Show the user:

- Session directory: $SESSION_DIR/
- Which reviewers completed (and any that failed)
- Stats from synthesis (the stats line from Step 5)
- Summary from planner (the summary line from Step 6)
- Ask: "Do you want me to apply the fixes to the spec?"

STEP 8: IF USER SAYS YES — DISPATCH STAGE 5 (1 task)
Task 13 — Use the Task tool with subagent_type="deepreview-applier":
"Read the implementation plan at $SESSION_DIR/implementation-plan.md. Apply the fixes."

Show the user the list of files changed from the applier's return.

IMPORTANT RULES:

- Do NOT read any files in $SESSION_DIR yourself. Ever.
- Use ONLY the file paths and stats/summary lines returned by subagents.
- If a subagent fails, note which one failed and continue with what you have.
- If all 5 reviewers fail in Stage 1, tell the user and STOP.
