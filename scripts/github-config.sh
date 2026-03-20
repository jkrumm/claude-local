#!/usr/bin/env bash
# Apply consistent branch protection and merge settings to all GitHub repos.
#
# Strategy:
#   Public repos → GitHub Rulesets (modern, supports bypass actors)
#   Private repos on free tier → No API protection available (requires GitHub Pro)
#                                 Claude Code hook (protect-branches.ts) still applies
#
# Enforces per repo:
#   - Pull request required to merge to main/master (0 approvals — solo dev)
#   - No force pushes (Rulesets: admin bypass; Classic: enforce_admins=false)
#   - Linear history required before merge
#   - No branch deletion
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
[ "$DRY_RUN" = "1" ] && echo "  DRY RUN — no changes will be made"
echo ""

repos=$(gh repo list "$OWNER" \
  --limit 200 \
  --no-archived \
  --json name,isPrivate \
  --jq '.[] | "\(.name) \(.isPrivate)"')

total=$(echo "$repos" | wc -l | xargs)
echo "  Found $total non-archived repos"
echo ""

ok=0
failed=0

while IFS=" " read -r repo is_private; do
  if [ "$DRY_RUN" = "1" ]; then
    [ "$is_private" = "true" ] \
      && echo "  [dry] $OWNER/$repo (private → hook only, no API on free tier)" \
      || echo "  [dry] $OWNER/$repo (public → ruleset)"
    continue
  fi

  echo "  → $OWNER/$repo"

  if [ "$is_private" = "true" ]; then
    # Private repos: GitHub Rulesets AND classic branch protection both require
    # GitHub Pro on private repos. Nothing can be applied via API on free tier.
    # Protection is provided solely by the Claude Code hook (hooks/protect-branches.ts).
    echo "    ⚠ private repo — GitHub API protection requires Pro subscription"
    echo "    · Claude Code hook (protect-branches.ts) still blocks pushes to main/master"
    ((ok++)) || true
  else
    # Public repo: use Rulesets
    existing_id=$(gh api "repos/$OWNER/$repo/rulesets" \
      --jq '.[] | select(.name=="protect-default-branch") | .id' 2>/dev/null || echo "")

    ruleset_ok=false
    if [ -n "$existing_id" ]; then
      if gh api "repos/$OWNER/$repo/rulesets/$existing_id" \
          -X PUT --input "$RULESET_FILE" --silent 2>/dev/null; then
        echo "    ✓ ruleset updated (id: $existing_id)"
        ruleset_ok=true
      else
        echo "    ✗ ruleset update failed" >&2
      fi
    else
      new_id=$(gh api "repos/$OWNER/$repo/rulesets" \
        -X POST --input "$RULESET_FILE" --jq '.id' 2>/dev/null || echo "")
      if [ -n "$new_id" ]; then
        echo "    ✓ ruleset created (id: $new_id)"
        ruleset_ok=true
      else
        echo "    ✗ ruleset creation failed" >&2
      fi
    fi
    if $ruleset_ok; then ((ok++)) || true; else ((failed++)) || true; fi
  fi

  # Apply merge strategy regardless of protection method
  if gh api "repos/$OWNER/$repo" -X PATCH \
      --field allow_merge_commit=false \
      --field allow_squash_merge=false \
      --field allow_rebase_merge=true \
      --field delete_branch_on_merge=true \
      --silent 2>/dev/null; then
    echo "    ✓ rebase-only merge, auto-delete branches"
  else
    echo "    ✗ merge settings update failed" >&2
  fi

done <<< "$repos"

echo ""
echo "  Done: $ok configured, $failed failed"
echo ""
