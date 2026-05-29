#!/usr/bin/env bash
set -euo pipefail

# Post or update a sticky version-preview comment on a PR.
# Required env: WILL_RELEASE, NEXT_VERSION, REPO, PR_NUMBER

MARKER="<!-- version-preview -->"
if [ "$WILL_RELEASE" = "true" ]; then
  BODY=$(printf '%s\n📦 This PR will release **v%s**.' "$MARKER" "$NEXT_VERSION")
else
  BODY=$(printf '%s\n📦 This PR will not trigger a new release.' "$MARKER")
fi

# Find existing comment with our marker
COMMENT_ID=$(gh api "repos/${REPO}/issues/${PR_NUMBER}/comments" \
  --jq ".[] | select(.body | contains(\"$MARKER\")) | .id" | head -1)

if [ -n "$COMMENT_ID" ]; then
  gh api "repos/${REPO}/issues/comments/${COMMENT_ID}" \
    -X PATCH -f body="$BODY"
else
  gh pr comment "$PR_NUMBER" --body "$BODY"
fi
