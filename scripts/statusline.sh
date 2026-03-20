#!/bin/bash

# Claude Code Statusline — 2–3 line layout
#
# Line 1: Model · Context (usable) · Session lines · Total tokens · Duration
# Line 2: CWD · Git branch & dirty flag
# Line 3: Queue status — only shown when ~/.claude/queue.md has tasks

input=$(cat)

# ── Model ──────────────────────────────────────────────────────────────────────
model=$(echo "$input" | jq -r '.model.display_name // "Unknown"')

# ── Working directory ──────────────────────────────────────────────────────────
cwd=$(echo "$input" | jq -r '.workspace.current_dir // "~"')
cwd_display="${cwd/#$HOME/~}"
cwd_display="${cwd_display/#~\/IuRoot\/worktrees\/student-enrolment\//WT·SE }"

# ── Context window ─────────────────────────────────────────────────────────────
total_input=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
total_output=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')
context_size=$(echo "$input" | jq -r '.context_window.context_window_size // 200000')
used_percentage=$(echo "$input" | jq -r '.context_window.used_percentage // 0')

# Subtract ~30k autocompact buffer to show usable space
autocompact_buffer=30000
usable_size=$((context_size - autocompact_buffer))
usable_k=$((usable_size / 1000))
used_tokens=$((used_percentage * context_size / 100))
used_k=$((used_tokens / 1000))

if [ "$usable_size" -gt 0 ]; then
  usable_pct=$((used_tokens * 100 / usable_size))
else
  usable_pct=0
fi

if [ "$usable_pct" -lt 50 ]; then
  color="\033[32m"   # green
elif [ "$usable_pct" -lt 75 ]; then
  color="\033[33m"   # yellow
else
  color="\033[31m"   # red
fi
reset="\033[0m"
pct_colored=$(printf "${color}%d%%${reset}" "$usable_pct")

# ── Session lines changed (Claude's edits this session) ────────────────────────
lines_added=$(echo "$input" | jq -r '.cost.total_lines_added // 0')
lines_removed=$(echo "$input" | jq -r '.cost.total_lines_removed // 0')

# ── Total tokens (cumulative) ──────────────────────────────────────────────────
total_tokens=$((total_input + total_output))
if [ "$total_tokens" -ge 1000000 ]; then
  tokens_fmt=$(awk "BEGIN {printf \"%.1fM\", $total_tokens/1000000}")
elif [ "$total_tokens" -ge 1000 ]; then
  tokens_fmt=$(awk "BEGIN {printf \"%.0fk\", $total_tokens/1000}")
else
  tokens_fmt="$total_tokens"
fi

# ── Duration ───────────────────────────────────────────────────────────────────
duration_ms=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')
duration_s=$((duration_ms / 1000))
hours=$((duration_s / 3600))
minutes=$(((duration_s % 3600) / 60))
if [ "$hours" -ge 1 ]; then
  duration="${hours}h ${minutes}min"
else
  duration="${minutes}min"
fi

# ── Git ────────────────────────────────────────────────────────────────────────
git_section=""
if git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
  branch=$(git -C "$cwd" -c core.useBuiltinFSMonitor=false rev-parse --abbrev-ref HEAD 2>/dev/null | head -1)
  [ -z "$branch" ] && branch="?"
  # Truncate long branch names at 22 chars
  if [ ${#branch} -gt 22 ]; then
    branch="${branch:0:22}…"
  fi

  if git -C "$cwd" diff-index --quiet HEAD -- 2>/dev/null; then
    status_icon="✓"
  elif git -C "$cwd" diff --name-only --diff-filter=U 2>/dev/null | grep -q .; then
    status_icon="!!"
  else
    status_icon="*"
  fi

  git_section=" | ${status_icon} ${branch}"
fi

# ── Queue (read queue.md from git root of session cwd) ─────────────────────────
queue_line=""
git_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)
queue_file=""
[ -n "$git_root" ] && queue_file="${git_root}/queue.md"
if [ -n "$queue_file" ] && [ -f "$queue_file" ]; then
  # Strip comment lines and blank lines to get task content
  content=$(grep -v '^#' "$queue_file" | sed '/^[[:space:]]*$/d')
  if [ -n "$content" ]; then
    seps=$(echo "$content" | grep -c '^---$' 2>/dev/null)
    seps=${seps:-0}
    queue_count=$((seps + 1))
    # First task = everything before the first --- separator
    first_task=$(echo "$content" | sed '/^---$/,$d' | head -1)

    if [ "$first_task" = "PAUSE" ]; then
      queue_line="⏸ paused · ${queue_count} total"
    elif echo "$first_task" | grep -q '^/'; then
      preview="${first_task:0:40}"
      if [ "$queue_count" -gt 1 ]; then
        queue_line="⚡ ${preview} · +$((queue_count - 1)) more"
      else
        queue_line="⚡ ${preview}"
      fi
    else
      preview="${first_task:0:40}"
      if [ "$queue_count" -gt 1 ]; then
        queue_line="◆ ${preview} · +$((queue_count - 1)) more"
      else
        queue_line="◆ ${preview}"
      fi
    fi
  fi
fi

# ── Output ─────────────────────────────────────────────────────────────────────
echo -e "${model} | ${used_k}k/${usable_k}k ${pct_colored} | +${lines_added} -${lines_removed} | ${tokens_fmt} | ${duration}"
echo -e "${cwd_display}${git_section}"
[ -n "$queue_line" ] && echo -e "${queue_line}"
exit 0
