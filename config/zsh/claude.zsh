# Claude Code launcher — workspace-aware with cqueue /clear restart loop
#
# Usage: c [claude-args...]
#
# Workspace detection:
#   ~/SourceRoot/*  → loads ~/SourceRoot/.claude skills + ENABLE_TOOL_SEARCH
#   ~/IuRoot/*      → loads per-project .claude/ skills
#   elsewhere       → plain claude with ENABLE_TOOL_SEARCH
#
# Queue restart: when the stop hook writes a next task to .queue-restart,
# the session is restarted with fresh context and the task injected.

c() {
  local restart_marker="$HOME/.claude/.queue-restart"
  local claude_args=("$@")

  while true; do
    if [[ "$PWD" == "$HOME/SourceRoot"* ]]; then
      ENABLE_TOOL_SEARCH=true claude --dangerously-skip-permissions --plugin-dir ~/SourceRoot/.claude "${claude_args[@]}"
    elif [[ "$PWD" == "$HOME/IuRoot"* ]]; then
      ENABLE_TOOL_SEARCH=true claude --dangerously-skip-permissions --plugin-dir "$(git rev-parse --show-toplevel 2>/dev/null || echo '.')/.claude" "${claude_args[@]}"
    else
      ENABLE_TOOL_SEARCH=true claude --dangerously-skip-permissions "${claude_args[@]}"
    fi

    if [[ -f "$restart_marker" ]]; then
      local next_task
      next_task=$(<"$restart_marker")
      rm -f "$restart_marker"
      if [[ -n "$next_task" ]]; then
        echo "\n[cq] Fresh context — continuing queue\n"
        claude_args=("$next_task")
        continue
      fi
    fi
    break
  done
}
