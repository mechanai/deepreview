---
internal: true
description: "Shared pipeline stages for deepreview commands (review → validate → synthesize)"
---

# Shared Pipeline: Review → Validate → Synthesize

This template defines 3 stages used by deepreview orchestrator commands. The orchestrator must set SESSION_DIR and INPUT_DESCRIPTION before invoking these stages.

## STAGE 1: INITIAL REVIEW (5 parallel tasks)

Dispatch ALL FIVE of these Task tool calls simultaneously in a single message:

Task — Use the Task tool with subagent_type="deepreview-correctness":
"You are reviewing $INPUT_DESCRIPTION. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-correctness.md."

Task — Use the Task tool with subagent_type="deepreview-security":
"You are reviewing $INPUT_DESCRIPTION. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-security.md."

Task — Use the Task tool with subagent_type="deepreview-architecture":
"You are reviewing $INPUT_DESCRIPTION. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-architecture.md."

Task — Use the Task tool with subagent_type="deepreview-docs":
"You are reviewing $INPUT_DESCRIPTION. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-docs.md."

Task — Use the Task tool with subagent_type="deepreview-compatibility":
"You are reviewing $INPUT_DESCRIPTION. Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-compatibility.md."

Wait for all 5 to return. Record which succeeded and which failed.

## STAGE 2: CROSS-VALIDATION (5 parallel tasks)

Only proceed with reviews that exist. For each validator below, replace $REVIEW_FILE_LIST with ONLY the review files that were successfully created in Stage 1. If a review file failed, omit it from the list entirely. Dispatch validators simultaneously:

Task — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: correctness. Read all available review files at: $REVIEW_FILE_LIST. Also read the original input at $SESSION_DIR/input.txt for context. Write your validated review to $SESSION_DIR/validated-correctness.md."

Task — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: security. Read all available review files at: $REVIEW_FILE_LIST. Also read the original input at $SESSION_DIR/input.txt for context. Write your validated review to $SESSION_DIR/validated-security.md."

Task — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: architecture. Read all available review files at: $REVIEW_FILE_LIST. Also read the original input at $SESSION_DIR/input.txt for context. Write your validated review to $SESSION_DIR/validated-architecture.md."

Task — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: docs. Read all available review files at: $REVIEW_FILE_LIST. Also read the original input at $SESSION_DIR/input.txt for context. Write your validated review to $SESSION_DIR/validated-docs.md."

Task — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: compatibility. Read all available review files at: $REVIEW_FILE_LIST. Also read the original input at $SESSION_DIR/input.txt for context. Write your validated review to $SESSION_DIR/validated-compatibility.md."

Wait for all 5 to return.

## STAGE 3: SYNTHESIS (1 task)

Task — Use the Task tool with subagent_type="deepreview-synthesizer":
"Read the validated reviews at: $SESSION_DIR/validated-correctness.md, $SESSION_DIR/validated-security.md, $SESSION_DIR/validated-architecture.md, $SESSION_DIR/validated-docs.md, $SESSION_DIR/validated-compatibility.md (skip any that don't exist). Write the synthesis to $SESSION_DIR/synthesis.md."

Record the stats line from its return.
