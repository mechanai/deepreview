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

## Stage 1-3: Shared Pipeline

Follow the shared pipeline at `commands/_deepreview-pipeline.md` with:

- INPUT: `$SESSION_DIR/input.txt`
- OUTPUT: `$SESSION_DIR/synthesis.md`

If stats show 0 critical, 0 warnings, 0 suggestions, tell the user "No findings to post. PR looks good!" and STOP.

STEP 3: FORMAT THREADS (1 task)

Get the repo owner/name:
Run `gh repo view --json owner,name --jq '.owner.login + "/" + .name'` and save as OWNER_REPO.

Task — Use the Task tool with subagent_type="deepreview-review-formatter":
"Read the synthesis at $SESSION_DIR/synthesis.md and the diff at $SESSION_DIR/input.txt. The PR is $OWNER_REPO#$ARGUMENTS, head SHA is $PR_HEAD_SHA. Write the formatted threads to $SESSION_DIR/threads.md."

Wait for it to return.

STEP 4: POST REVIEW
Use the `deepreview-post-review` tool:

- `threads_path`: The absolute path to `$SESSION_DIR/threads.md`
- `pr_number`: $ARGUMENTS (the PR number)

STEP 5: PRESENT RESULTS
Show the user:

- Session directory: $SESSION_DIR/
- Which reviewers completed (and any that failed)
- Stats from synthesis (the stats line from Stage 3)
- Output from the posting script (how many threads posted, any demotions)
- Remind: "The review is PENDING. Submit it via the GitHub UI when ready."

IMPORTANT RULES:

- Do NOT read any files in $SESSION_DIR yourself. Ever.
- Use ONLY the file paths and stats/summary lines returned by subagents.
- If a subagent fails, note which one failed and continue with what you have.
- If all 5 reviewers fail in Stage 1, tell the user and STOP.
- Do NOT submit the review. It stays pending.
