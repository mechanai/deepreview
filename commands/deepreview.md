---
description: "Multi-agent parallel code review with cross-validation"
subtask: true
---

You are an orchestrator for a multi-agent code review pipeline. Follow these steps EXACTLY. Do NOT deviate, skip steps, or read any files in the session directory yourself.

STEP 1: DETERMINE INPUT MODE AND SESSION DIRECTORY
Classify "$ARGUMENTS":
- If it is a number → MODE=pr
- If it is a file path (ends in .md, .txt, .yaml, .json, or file exists on disk) → MODE=files
- If it is multiple space-separated file paths → MODE=files
- If it is empty → MODE=branch

Set SESSION_DIR based on mode:
- MODE=pr: SESSION_DIR="reviews/$ARGUMENTS-$(date +%Y-%m-%d)"
- MODE=files: SESSION_DIR="reviews/files-$(date +%Y-%m-%d-%H%M%S)"
- MODE=branch: SESSION_DIR="reviews/$(git branch --show-current)-$(date +%Y-%m-%d)"

Create the directory with `mkdir -p $SESSION_DIR`

STEP 2: PREPARE INPUT
- MODE=pr: run `gh pr diff $ARGUMENTS > $SESSION_DIR/input.txt`
- MODE=branch: run `git diff main > $SESSION_DIR/input.txt`
- MODE=files: concatenate all specified files into $SESSION_DIR/input.txt with headers:
  For each file, write a header line "=== <filename> ===" followed by the file contents.
  Use: `for f in <files>; do echo "=== $f ===" >> $SESSION_DIR/input.txt; cat "$f" >> $SESSION_DIR/input.txt; echo >> $SESSION_DIR/input.txt; done`

Check if input.txt is empty (0 bytes). If empty, tell the user "Nothing to review." and STOP.

Set INPUT_DESCRIPTION based on mode:
- MODE=pr: "a PR diff"
- MODE=branch: "a branch diff against main"
- MODE=files: "the following files: <list of filenames>"

STEP 3: DISPATCH STAGE 1 — INITIAL REVIEW (5 parallel tasks)
Dispatch ALL FIVE of these Task tool calls simultaneously in a single message:

Task 1 — Use the Task tool with subagent_type="deepreview-correctness":
"You are reviewing $INPUT_DESCRIPTION. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-correctness.md."

Task 2 — Use the Task tool with subagent_type="deepreview-security":
"You are reviewing $INPUT_DESCRIPTION. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-security.md."

Task 3 — Use the Task tool with subagent_type="deepreview-architecture":
"You are reviewing $INPUT_DESCRIPTION. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-architecture.md."

Task 4 — Use the Task tool with subagent_type="deepreview-docs":
"You are reviewing $INPUT_DESCRIPTION. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-docs.md."

Task 5 — Use the Task tool with subagent_type="deepreview-compatibility":
"You are reviewing $INPUT_DESCRIPTION. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-compatibility.md."

Wait for all 5 to return. Record which succeeded and which failed.

STEP 4: DISPATCH STAGE 2 — CROSS-VALIDATION (5 parallel tasks)
Only proceed with reviews that exist. Dispatch ALL FIVE simultaneously:

Task 6 — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: correctness. Read all review files at: $SESSION_DIR/review-correctness.md, $SESSION_DIR/review-security.md, $SESSION_DIR/review-architecture.md, $SESSION_DIR/review-docs.md, $SESSION_DIR/review-compatibility.md. Write your validated review to $SESSION_DIR/validated-correctness.md."

Task 7 — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: security. Read all review files at: $SESSION_DIR/review-correctness.md, $SESSION_DIR/review-security.md, $SESSION_DIR/review-architecture.md, $SESSION_DIR/review-docs.md, $SESSION_DIR/review-compatibility.md. Write your validated review to $SESSION_DIR/validated-security.md."

Task 8 — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: architecture. Read all review files at: $SESSION_DIR/review-correctness.md, $SESSION_DIR/review-security.md, $SESSION_DIR/review-architecture.md, $SESSION_DIR/review-docs.md, $SESSION_DIR/review-compatibility.md. Write your validated review to $SESSION_DIR/validated-architecture.md."

Task 9 — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: docs. Read all review files at: $SESSION_DIR/review-correctness.md, $SESSION_DIR/review-security.md, $SESSION_DIR/review-architecture.md, $SESSION_DIR/review-docs.md, $SESSION_DIR/review-compatibility.md. Write your validated review to $SESSION_DIR/validated-docs.md."

Task 10 — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: compatibility. Read all review files at: $SESSION_DIR/review-correctness.md, $SESSION_DIR/review-security.md, $SESSION_DIR/review-architecture.md, $SESSION_DIR/review-docs.md, $SESSION_DIR/review-compatibility.md. Write your validated review to $SESSION_DIR/validated-compatibility.md."

Wait for all 5 to return.

STEP 5: DISPATCH STAGE 3 — SYNTHESIS (1 task)
Task 11 — Use the Task tool with subagent_type="deepreview-synthesizer":
"Read the validated reviews at: $SESSION_DIR/validated-correctness.md, $SESSION_DIR/validated-security.md, $SESSION_DIR/validated-architecture.md, $SESSION_DIR/validated-docs.md, $SESSION_DIR/validated-compatibility.md. Write the synthesis to $SESSION_DIR/synthesis.md."

Record the stats line from its return.

STEP 6: DISPATCH STAGE 4 — IMPLEMENTATION PLAN (1 task)
Task 12 — Use the Task tool with subagent_type="deepreview-planner":
"Read the synthesis at $SESSION_DIR/synthesis.md. Write the implementation plan to $SESSION_DIR/implementation-plan.md."

Record the summary line from its return.

STEP 7: PRESENT RESULTS
Show the user:
- Session directory: $SESSION_DIR/
- Which reviewers completed (and any that failed)
- Stats from synthesis (the stats line from Step 5)
- Summary from planner (the summary line from Step 6)
- Ask: "Do you want me to apply the fixes?"

STEP 8: IF USER SAYS YES — DISPATCH STAGE 5 (1 task)
Task 13 — Use the Task tool with subagent_type="deepreview-applier":
"Read the implementation plan at $SESSION_DIR/implementation-plan.md. Apply the fixes."

Show the user the list of files changed from the applier's return.

IMPORTANT RULES:
- Do NOT read any files in $SESSION_DIR yourself. Ever.
- Use ONLY the file paths and stats/summary lines returned by subagents.
- If a subagent fails, note which one failed and continue with what you have.
- If all 5 reviewers fail in Stage 1, tell the user and STOP.
