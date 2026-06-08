#!/usr/bin/env bash
set -euo pipefail

# Determine next release version via semantic-release dry run.
# Simulates a squash-merge onto the default branch so semantic-release
# can analyze commits as if the PR were merged.
# Outputs: will_release (true/false), next_version (semver or empty)

DEFAULT_BRANCH="${GITHUB_BASE_REF:-main}"
PR_SHA=$(git rev-parse HEAD)

# Use the PR title as the squash commit subject, matching GitHub's default
# squash-merge behavior. Fall back to the first commit subject if unavailable.
PR_NUMBER="${GITHUB_PR_NUMBER:-}"
if [ -n "$PR_NUMBER" ]; then
  PR_TITLE=$(gh pr view "$PR_NUMBER" --json title --jq .title)
else
  PR_TITLE=$(git log "${DEFAULT_BRANCH}".."${PR_SHA}" --reverse --format=%s | head -1)
fi

# Squash-merge PR onto default branch to simulate post-merge state
git config user.name "CI"
git config user.email "ci@localhost"
git checkout "$DEFAULT_BRANCH"

if git diff --quiet "$PR_SHA"; then
  echo "will_release=false" >> "$GITHUB_OUTPUT"
  echo "next_version=" >> "$GITHUB_OUTPUT"
  echo "No changes to release."
  exit 0
fi

git merge --squash "$PR_SHA"
git commit --no-verify -m "$PR_TITLE"

# Update origin ref to match our simulated merge so semantic-release's
# git push --dry-run check sees them as equal.
git update-ref "refs/remotes/origin/${DEFAULT_BRANCH}" HEAD

# Write a minimal release config for dry-run that only analyzes commits.
# This avoids needing NPM_TOKEN for the npm plugin's verifyConditions.
cat > .releaserc.json <<'EOF'
{"plugins":["@semantic-release/commit-analyzer","@semantic-release/release-notes-generator"]}
EOF

# Run semantic-release dry-run on the simulated merge.
# Override GitHub Actions env vars so env-ci detects this as a push to the
# default branch rather than a pull_request event.
set +e
OUTPUT=$(GITHUB_REF="refs/heads/${DEFAULT_BRANCH}" \
  GITHUB_EVENT_NAME="push" \
  GITHUB_SHA=$(git rev-parse HEAD) \
  bun x semantic-release@25.0.3 --dry-run --no-ci 2>&1)
EXIT_CODE=$?
set -e

# Strip ANSI escape codes (bash ${//} doesn't support regex character classes)
# shellcheck disable=SC2001
OUTPUT=$(sed 's/\x1b\[[0-9;]*m//g' <<< "$OUTPUT")

# Log for debugging
echo "::group::semantic-release dry-run output (exit $EXIT_CODE)"
echo "$OUTPUT"
echo "::endgroup::"

# Match "next release version is X.Y.Z"
NEXT_VERSION=$(grep -oP 'next release version is \K[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?' <<< "$OUTPUT" || true)

if [ -n "$NEXT_VERSION" ]; then
  echo "will_release=true" >> "$GITHUB_OUTPUT"
  echo "next_version=$NEXT_VERSION" >> "$GITHUB_OUTPUT"
else
  echo "will_release=false" >> "$GITHUB_OUTPUT"
  echo "next_version=" >> "$GITHUB_OUTPUT"
fi
