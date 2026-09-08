#!/usr/bin/env bash
# worktree-audit — find and (on request) reclaim stale git worktrees across
# the whole estate. Read-only by default; `make worktree-audit` / `--prune`.
#
# WHY THIS EXISTS. Worktrees accumulate and nothing ever reclaims them. A live
# scan on 2026-09-08 found 8 across 3 repos in FOUR different parent
# directories — `<repo>/.claude/worktrees/` (Claude Code's native worktree
# feature), `~/IuRoot/worktrees/`, `~/IuRoot/.wt/`, and one inside the repo
# itself. 6 of them were fully merged into origin's default branch with a
# clean tree and had been dead for weeks (~2.5 GB). So this tool never assumes
# a location — it asks git (`git worktree list --porcelain`) per repo, which
# reports every linked worktree regardless of where it physically lives.
#
# CLASSIFICATION IS FAIL-CLOSED. A worktree is only ever SAFE to remove when
# it is clean, unlocked, present on disk, AND its branch has zero commits
# ahead of origin's default branch. Anything we cannot prove merged — no
# upstream default branch, a rev-list that errors, a detached HEAD, a locked
# worktree — is KEPT. `--prune` never passes `--force` to `git worktree
# remove` for the same reason: a race that dirties a worktree between the
# audit and the prune must abort that one removal, not silently blow it away.

set -euo pipefail

usage() {
  cat <<'USAGE'
usage: worktree-audit.sh [--prune | --count] [--help]

  (no flags)  Read-only report: a table of every linked worktree found under
              $WORKTREE_ROOTS (default: ~/SourceRoot ~/IuRoot), one row per
              worktree with verdict SAFE / KEEP / STALE + reason, then a
              summary line.
  --prune     Additionally remove every SAFE worktree (`git worktree remove`,
              never --force — fails closed on anything dirty), then run
              `git worktree prune` in every scanned repo to clear stale
              registrations.
  --count     Print one summary line only (used by `make doctor`).
  --help      This message.

Roots are the immediate children of each entry in $WORKTREE_ROOTS that are
themselves git repos (a `.git` file or directory) — worktrees living under
special subfolders (worktrees/, .wt/, .claude/worktrees/) are discovered
transitively via `git worktree list`, never by scanning into those folders.
USAGE
}

MODE="audit"
for arg in "$@"; do
  case "$arg" in
    --prune) MODE="prune" ;;
    --count) MODE="count" ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "worktree-audit: unknown argument: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

# Deliberately word-split below — a space-separated list of roots, overridable
# for tests.
ROOTS="${WORKTREE_ROOTS:-$HOME/SourceRoot $HOME/IuRoot}"

total_safe=0
total_keep=0
total_stale=0
total_reclaim_kb=0
had_error=0

# Convert a KB integer into a `du -h`-shaped string, so the same value backs
# both the printed table and the summed total.
human_kb() {
  local kb="$1"
  if [ "$kb" -ge 1048576 ]; then
    LC_NUMERIC=C awk -v k="$kb" 'BEGIN { printf "%.1fG", k / 1048576 }'
  elif [ "$kb" -ge 1024 ]; then
    LC_NUMERIC=C awk -v k="$kb" 'BEGIN { printf "%.0fM", k / 1024 }'
  else
    printf '%dK' "$kb"
  fi
}

short_path() {
  printf '%s' "${1/#$HOME/~}"
}

print_row() {
  [ "$MODE" = "count" ] && return 0
  local path="$1" size="$2" branch="$3" date="$4" verdict="$5" reason="$6"
  printf '  %-52s %7s  %-24s %-10s  %-5s %s\n' \
    "$(short_path "$path")" "$size" "${branch:-detached}" "$date" "$verdict" "$reason"
}

# Classify and (in --prune mode) act on one linked worktree.
#   repo           main repo path (the one `git worktree list` was run against)
#   wpath          the linked worktree's path
#   wbranch        local branch name, empty if detached
#   wlocked        1 if the porcelain output carried a `locked` line
#   default_branch resolved default branch name, empty if unresolvable
handle_worktree() {
  local repo="$1" wpath="$2" wbranch="$3" wlocked="$4" default_branch="$5"
  local date size_kb size verdict reason dirty ahead

  if [ ! -d "$wpath" ]; then
    print_row "$wpath" "-" "$wbranch" "-" "STALE" "stale-registration"
    total_stale=$((total_stale + 1))
    return 0
  fi

  size_kb=$(du -sk "$wpath" 2>/dev/null | cut -f1)
  size_kb="${size_kb:-0}"
  size=$(human_kb "$size_kb")
  date=$(git -C "$wpath" log -1 --format=%cs 2>/dev/null || echo "?")

  if [ -z "$default_branch" ]; then
    verdict="KEEP"; reason="no-upstream-default"
  elif [ "$wlocked" -eq 1 ]; then
    verdict="KEEP"; reason="locked"
  elif [ -z "$wbranch" ]; then
    verdict="KEEP"; reason="detached"
  else
    dirty=$(git -C "$wpath" status --porcelain 2>/dev/null || true)
    if [ -n "$dirty" ]; then
      verdict="KEEP"; reason="dirty"
    elif ! ahead=$(git -C "$repo" rev-list --count "origin/$default_branch..$wbranch" 2>/dev/null); then
      verdict="KEEP"; reason="rev-list-failed"
    elif [ "$ahead" -gt 0 ]; then
      verdict="KEEP"; reason="ahead ($ahead)"
    else
      verdict="SAFE"; reason="clean, merged"
    fi
  fi

  print_row "$wpath" "$size" "$wbranch" "$date" "$verdict" "$reason"

  if [ "$verdict" = "SAFE" ]; then
    total_safe=$((total_safe + 1))
    total_reclaim_kb=$((total_reclaim_kb + size_kb))
    if [ "$MODE" = "prune" ]; then
      local out
      if out=$(git -C "$repo" worktree remove "$wpath" 2>&1); then
        echo "  removed: $(short_path "$wpath")"
      else
        echo "  warn: could not remove $(short_path "$wpath"): $out" >&2
        had_error=1
      fi
    fi
  else
    total_keep=$((total_keep + 1))
  fi
}

# Resolve origin's default branch, then walk every linked worktree (skipping
# the main one, which is always the first porcelain record).
process_repo() {
  local repo="$1"
  local default_branch origin_head porcelain index
  local wpath wbranch wlocked line

  origin_head=$(git -C "$repo" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || true)
  default_branch="$origin_head"
  if [ -z "$default_branch" ]; then
    if git -C "$repo" rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
      default_branch="main"
    elif git -C "$repo" rev-parse --verify --quiet origin/master >/dev/null 2>&1; then
      default_branch="master"
    fi
  fi

  porcelain=$(git -C "$repo" worktree list --porcelain 2>/dev/null || true)
  [ -n "$porcelain" ] || return 0

  index=0
  while IFS= read -r -d $'\x1e' block; do
    index=$((index + 1))
    [ "$index" -eq 1 ] && continue  # the main worktree — never touched

    wpath=""; wbranch=""; wlocked=0
    while IFS= read -r line; do
      case "$line" in
        "worktree "*) wpath="${line#worktree }" ;;
        "branch "*) wbranch="${line#branch refs/heads/}" ;;
        "detached") wbranch="" ;;
        "locked"*) wlocked=1 ;;
      esac
    done <<< "$block"

    [ -n "$wpath" ] || continue
    handle_worktree "$repo" "$wpath" "$wbranch" "$wlocked" "$default_branch"
  done < <(printf '%s' "$porcelain" | awk 'BEGIN { RS = ""; ORS = "\x1e" } { print }')

  if [ "$MODE" = "prune" ]; then
    git -C "$repo" worktree prune
  fi
}

if [ "$MODE" != "count" ]; then
  printf '  %-52s %7s  %-24s %-10s  %-5s %s\n' "PATH" "SIZE" "BRANCH" "LAST COMMIT" "VERDICT" "REASON"
fi

# shellcheck disable=SC2086  # intentional word-splitting of a space-separated root list
for root in $ROOTS; do
  [ -d "$root" ] || continue
  for dir in "$root"/*/; do
    [ -d "$dir" ] || continue
    repo="${dir%/}"
    [ -e "$repo/.git" ] || continue
    process_repo "$repo"
  done
done

if [ "$MODE" = "count" ]; then
  if [ "$total_safe" -gt 0 ]; then
    echo "worktrees: $total_safe reclaimable ($(human_kb "$total_reclaim_kb")) — make worktree-prune"
  else
    echo "worktrees: none reclaimable"
  fi
  exit 0
fi

echo ""
echo "  $total_safe safe ($(human_kb "$total_reclaim_kb") reclaimable), $total_keep kept, $total_stale stale registrations"

if [ "$MODE" = "prune" ]; then
  if [ "$total_safe" -eq 0 ]; then
    echo "  nothing to remove."
  fi
fi

[ "$had_error" -eq 0 ] || exit 1
exit 0
