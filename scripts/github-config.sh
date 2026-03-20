#!/usr/bin/env bash
# Apply consistent branch protection and merge settings to all GitHub repos.
#
# Enforces per repo:
#   - Pull request required to merge to main/master (0 approvals — solo dev)
#   - No direct force pushes (bypass_actors: RepositoryRole/Admin = you)
#   - Linear history required before merge
#   - Rebase merge only (no merge commits, no squash)
#   - Auto-delete merged branches
#
# Usage:
#   ./scripts/github-config.sh              # all repos for jkrumm
#   GITHUB_OWNER=other ./scripts/github-config.sh
#   DRY_RUN=1 ./scripts/github-config.sh   # preview without applying
#
# Prerequisites: gh CLI authenticated (gh auth status)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RULESET_FILE="$SCRIPT_DIR/../config/github-ruleset.json"
OWNER="${GITHUB_OWNER:-jkrumm}"
DRY_RUN="${DRY_RUN:-0}"

if [ ! -f "$RULESET_FILE" ]; then
  echo "Error: ruleset file not found at $RULESET_FILE" >&2
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "Error: not authenticated with gh CLI. Run: gh auth login" >&2
  exit 1
fi

echo ""
echo "  GitHub Config — $OWNER"
echo "  Ruleset: $(basename $RULESET_FILE)"
[ "$DRY_RUN" = "1" ] && echo "  DRY RUN — no changes will be made"
echo ""

repos=$(gh repo list "$OWNER" \
  --limit 200 \
  --no-archived \
  --json name \
  --jq '.[].name')

total=$(echo "$repos" | wc -l | xargs)
echo "  Found $total non-archived repos"
echo ""

ok=0
skipped=0
failed=0

for repo in $repos; do
  if [ "$DRY_RUN" = "1" ]; then
    echo "  [dry] $OWNER/$repo"
    continue
  fi

  echo "  → $OWNER/$repo"

  # Apply branch ruleset (idempotent: update if exists, create if not)
  existing_id=$(gh api "repos/$OWNER/$repo/rulesets" \
    --jq '.[] | select(.name=="protect-default-branch") | .id' 2>/dev/null || echo "")

  if [ -n "$existing_id" ]; then
    if gh api "repos/$OWNER/$repo/rulesets/$existing_id" \
        -X PUT --input "$RULESET_FILE" --silent 2>/dev/null; then
      echo "    ✓ ruleset updated (id: $existing_id)"
    else
      echo "    ✗ ruleset update failed" >&2
      ((failed++)) || true
      continue
    fi
  else
    new_id=$(gh api "repos/$OWNER/$repo/rulesets" \
      -X POST --input "$RULESET_FILE" --jq '.id' 2>/dev/null || echo "")
    if [ -n "$new_id" ]; then
      echo "    ✓ ruleset created (id: $new_id)"
    else
      echo "    ✗ ruleset creation failed" >&2
      ((failed++)) || true
      continue
    fi
  fi

  # Apply merge strategy: rebase only, auto-delete merged branches
  if gh api "repos/$OWNER/$repo" -X PATCH \
      --field allow_merge_commit=false \
      --field allow_squash_merge=false \
      --field allow_rebase_merge=true \
      --field delete_branch_on_merge=true \
      --silent 2>/dev/null; then
    echo "    ✓ rebase-only merge, auto-delete branches"
    ((ok++)) || true
  else
    echo "    ✗ merge settings update failed" >&2
    ((failed++)) || true
  fi
done

echo ""
echo "  Done: $ok configured, $failed failed"
echo ""
