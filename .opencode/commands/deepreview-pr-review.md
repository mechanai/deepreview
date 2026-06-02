---
description: "Multi-agent parallel code review posted as a pending GitHub PR review"
---

You are an orchestrator for a multi-agent code review pipeline that posts findings as a pending GitHub PR review. Follow these steps EXACTLY. Do NOT deviate, skip steps, or read any files in the session directory yourself.

STEP 1: VALIDATE INPUT
$ARGUMENTS must be a PR number (integer). If it is not a number, tell the user "Usage: /deepreview-pr-review <PR_NUMBER>" and STOP.

Set SESSION_DIR=".ai/deepreview/$ARGUMENTS-review-$(date +%Y-%m-%d-%H%M%S)"
Create the directory with `mkdir -p $SESSION_DIR`
Set INPUT_DESCRIPTION="a PR diff (code changes)"

STEP 2: PREPARE INPUT
Run `gh pr diff $ARGUMENTS > $SESSION_DIR/input.txt`
Check if input.txt is empty (0 bytes). If empty, tell the user "Nothing to review — PR has no diff." and STOP.

Get and store the PR head SHA:
Run `gh pr view $ARGUMENTS --json headRefOid --jq .headRefOid` and save the output as PR_HEAD_SHA.

STEP 3: DISPATCH STAGE 1 — INITIAL REVIEW (5 parallel tasks)
Dispatch ALL FIVE of these Task tool calls simultaneously in a single message:

Task 1 — Use the Task tool with subagent_type="deepreview-correctness":
"You are reviewing a PR diff (code changes). Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-correctness.md."

Task 2 — Use the Task tool with subagent_type="deepreview-security":
"You are reviewing a PR diff (code changes). Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-security.md."

Task 3 — Use the Task tool with subagent_type="deepreview-architecture":
"You are reviewing a PR diff (code changes). Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-architecture.md."

Task 4 — Use the Task tool with subagent_type="deepreview-docs":
"You are reviewing a PR diff (code changes). Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-docs.md."

Task 5 — Use the Task tool with subagent_type="deepreview-compatibility":
"You are reviewing a PR diff (code changes). Read the content at $SESSION_DIR/input.txt. Write your review to $SESSION_DIR/review-compatibility.md."

Wait for all 5 to return. Record which succeeded and which failed.

STEP 4: DISPATCH STAGE 2 — CROSS-VALIDATION (5 parallel tasks)
Only proceed with reviews that exist. Dispatch ALL FIVE simultaneously:

Task 6 — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: correctness. Read all review files at: $SESSION_DIR/review-correctness.md, $SESSION_DIR/review-security.md, $SESSION_DIR/review-architecture.md, $SESSION_DIR/review-docs.md, $SESSION_DIR/review-compatibility.md. Also read the original input at $SESSION_DIR/input.txt for context. Write your validated review to $SESSION_DIR/validated-correctness.md."

Task 7 — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: security. Read all review files at: $SESSION_DIR/review-correctness.md, $SESSION_DIR/review-security.md, $SESSION_DIR/review-architecture.md, $SESSION_DIR/review-docs.md, $SESSION_DIR/review-compatibility.md. Also read the original input at $SESSION_DIR/input.txt for context. Write your validated review to $SESSION_DIR/validated-security.md."

Task 8 — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: architecture. Read all review files at: $SESSION_DIR/review-correctness.md, $SESSION_DIR/review-security.md, $SESSION_DIR/review-architecture.md, $SESSION_DIR/review-docs.md, $SESSION_DIR/review-compatibility.md. Also read the original input at $SESSION_DIR/input.txt for context. Write your validated review to $SESSION_DIR/validated-architecture.md."

Task 9 — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: docs. Read all review files at: $SESSION_DIR/review-correctness.md, $SESSION_DIR/review-security.md, $SESSION_DIR/review-architecture.md, $SESSION_DIR/review-docs.md, $SESSION_DIR/review-compatibility.md. Also read the original input at $SESSION_DIR/input.txt for context. Write your validated review to $SESSION_DIR/validated-docs.md."

Task 10 — Use the Task tool with subagent_type="deepreview-validator":
"Your perspective: compatibility. Read all review files at: $SESSION_DIR/review-correctness.md, $SESSION_DIR/review-security.md, $SESSION_DIR/review-architecture.md, $SESSION_DIR/review-docs.md, $SESSION_DIR/review-compatibility.md. Also read the original input at $SESSION_DIR/input.txt for context. Write your validated review to $SESSION_DIR/validated-compatibility.md."

Wait for all 5 to return.

STEP 5: DISPATCH STAGE 3 — SYNTHESIS (1 task)
Task 11 — Use the Task tool with subagent_type="deepreview-synthesizer":
"Read the validated reviews at: $SESSION_DIR/validated-correctness.md, $SESSION_DIR/validated-security.md, $SESSION_DIR/validated-architecture.md, $SESSION_DIR/validated-docs.md, $SESSION_DIR/validated-compatibility.md (skip any that don't exist). Write the synthesis to $SESSION_DIR/synthesis.md."

Record the stats line from its return.

If stats show 0 critical, 0 warnings, 0 suggestions, tell the user "No findings to post. PR looks good!" and STOP.

STEP 6: FORMAT THREADS (1 task)

Get the repo owner/name:
Run `gh repo view --json owner,name --jq '.owner.login + "/" + .name'` and save as OWNER_REPO.

Task — Use the Task tool with subagent_type="deepreview-review-formatter":
"Read the synthesis at $SESSION_DIR/synthesis.md and the diff at $SESSION_DIR/input.txt. The PR is $OWNER_REPO#$ARGUMENTS, head SHA is $PR_HEAD_SHA. Write the formatted threads to $SESSION_DIR/threads.md."

Wait for it to return.

STEP 7: POST REVIEW
Use the `deepreview-post-review` tool:

- `threads_path`: The absolute path to `$SESSION_DIR/threads.md`
- `pr_number`: $ARGUMENTS (the PR number)

STEP 8: PRESENT RESULTS
Show the user:

- Session directory: $SESSION_DIR/
- Which reviewers completed (and any that failed)
- Stats from synthesis (the stats line from Step 5)
- Output from the posting script (how many threads posted, any demotions)
- Remind: "The review is PENDING. Submit it via the GitHub UI when ready."

IMPORTANT RULES:

- Do NOT read any files in $SESSION_DIR yourself. Ever.
- Use ONLY the file paths and stats/summary lines returned by subagents.
- If a subagent fails, note which one failed and continue with what you have.
- If all 5 reviewers fail in Stage 1, tell the user and STOP.
- Do NOT submit the review. It stays pending.
