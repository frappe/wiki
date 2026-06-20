#!/bin/bash
# spec-loop: loop Claude headless, implementing ONE tracer bullet from a single spec per
# iteration, tracking progress inside the spec file itself.
#
# Usage: scripts/spec-loop.sh <spec-file> [iterations]
#   <spec-file>   the spec to drive (e.g. specs/github_one_way_sync.md)
#   [iterations]  max loop count (default 10). Each iteration = one tracer bullet.
#
# Branch: derived from the spec filename (feat/<spec-slug>). Created ONCE at the start if it
# doesn't already exist; otherwise the existing branch is checked out. The loop never creates
# another branch — all bullets land on this one branch.
#
# Stops early when the model emits <promise>COMPLETE</promise> (all bullets done per the spec's
# Progress section).
set -e

SPEC="$1"
ITERATIONS="${2:-10}"

if [ -z "$SPEC" ]; then
  echo "Usage: $0 <spec-file> [iterations]"
  exit 1
fi
if [ ! -f "$SPEC" ]; then
  echo "Spec file not found: $SPEC"
  exit 1
fi

# Branch name from the spec slug, e.g. specs/github_one_way_sync.md -> feat/github-one-way-sync
slug=$(basename "$SPEC" .md | tr '_' '-')
branch="feat/$slug"

if git rev-parse --verify "$branch" >/dev/null 2>&1; then
  git checkout "$branch"
else
  git checkout -b "$branch" develop
fi
echo "Working on branch: $branch"

# jq filter to stream assistant text to the terminal as it arrives
stream_text='select(.type == "assistant").message.content[]? | select(.type == "text").text // empty | gsub("\n"; "\r\n") | . + "\r\n\n"'

# jq filter to extract the final result of an iteration
final_result='select(.type == "result").result // empty'

for ((i=1; i<=ITERATIONS; i++)); do
  echo "===== spec-loop iteration $i / $ITERATIONS — $SPEC ====="
  tmpfile=$(mktemp)
  trap "rm -f $tmpfile" EXIT

  recent_commits=$(git log --oneline -n 15 2>/dev/null || echo "none")

  claude --dangerously-skip-permissions \
    --verbose \
    --print \
    --output-format stream-json \
    "Spec to work on: $SPEC
Current branch (do NOT create another): $branch
Recent commits: $recent_commits
@scripts/prompt.md" \
  | grep --line-buffered '^{' \
  | tee "$tmpfile" \
  | jq --unbuffered -rj "$stream_text"

  result=$(jq -r "$final_result" "$tmpfile")

  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    echo "spec-loop complete after $i iterations — all tracer bullets implemented."
    exit 0
  fi
done

echo "spec-loop stopped after $ITERATIONS iterations (not COMPLETE)."
