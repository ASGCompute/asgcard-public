#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-}"
BACKLOG_CSV="${2:-docs/execution/github/stellar_pilot_issue_backlog.csv}"

if [[ -z "$REPO" ]]; then
  echo "Usage: $0 <owner/repo> [backlog_csv_path]"
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI not found."
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Error: gh is not authenticated. Run: gh auth login"
  exit 1
fi

if [[ ! -f "$BACKLOG_CSV" ]]; then
  echo "Error: backlog csv not found: $BACKLOG_CSV"
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

expected_ids="$tmpdir/expected_ids.txt"
repo_ids="$tmpdir/repo_ids.txt"

tail -n +2 "$BACKLOG_CSV" | cut -d',' -f1 | tr -d '\r' | sort -u >"$expected_ids"

gh issue list --repo "$REPO" --state all --limit 500 --json title --jq '.[].title' \
  | sed -n 's/^\[\([^]]\+\)\].*/\1/p' \
  | sort >"$repo_ids"

echo "=== Backlog Audit: $REPO ==="
echo "Expected IDs: $(wc -l <"$expected_ids" | tr -d ' ')"
echo "Issue IDs in repo (from [ID] title tags): $(wc -l <"$repo_ids" | tr -d ' ')"
echo

echo "Duplicates in repo IDs:"
if sort "$repo_ids" | uniq -d | sed -n '1,200p'; then
  :
fi

echo
echo "Missing IDs (expected but not found in repo issues):"
if comm -23 "$expected_ids" <(sort -u "$repo_ids") | sed -n '1,200p'; then
  :
fi

echo
echo "Unexpected IDs (found in issues but not in expected backlog):"
if comm -13 "$expected_ids" <(sort -u "$repo_ids") | sed -n '1,200p'; then
  :
fi

echo
echo "Open issues count:"
gh issue list --repo "$REPO" --state open --limit 500 --json number --jq 'length'

echo
echo "Labels count:"
gh label list --repo "$REPO" --limit 500 --json name --jq 'length'

echo
echo "Milestones:"
gh api "repos/$REPO/milestones?state=all&per_page=100" --jq '.[] | [.title,.state,.due_on] | @tsv'

