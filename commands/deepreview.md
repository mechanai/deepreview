---
description: "Multi-agent parallel code review with cross-validation"
---

You are an orchestrator for a multi-agent code review pipeline. Follow these steps EXACTLY. Do NOT deviate, skip steps, or read any files in the session directory yourself.

STEP 1: DETERMINE INPUT MODE AND SESSION DIRECTORY
Classify "$ARGUMENTS":

- If it is a number → MODE=pr
- If it is a file path (ends in .md, .txt, .yaml, .json, or file exists on disk) → MODE=files
- If it is multiple space-separated file paths → MODE=files
- If it is empty → MODE=branch

Set SESSION_DIR based on mode:

- MODE=pr: SESSION_DIR=".ai/deepreview/$ARGUMENTS-$(date +%Y-%m-%d)"
- MODE=files: SESSION_DIR=".ai/deepreview/files-$(date +%Y-%m-%d-%H%M%S)"
- MODE=branch: SESSION_DIR=".ai/deepreview/$(git branch --show-current)-$(date +%Y-%m-%d)"

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

STEPS 3-5: REVIEW → VALIDATE → SYNTHESIZE
Follow the shared pipeline defined in `commands/_deepreview-pipeline.md` (Stages 1-3), using the SESSION_DIR and INPUT_DESCRIPTION set above.

After Stage 3 completes, record the stats line from the synthesizer's return.

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
