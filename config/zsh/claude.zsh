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

# API mode: pulls ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL from 1Password and
# delegates to c() — bypasses subscription, routes through custom endpoint.
capi() {
  local api_key base_url
  api_key=$(op read "op://common/anthropic/API_KEY") || return 1
  base_url=$(op read "op://common/anthropic/BASE_URL") || return 1
  ANTHROPIC_API_KEY="$api_key" ANTHROPIC_BASE_URL="$base_url" c "$@"
}

c() {
  local restart_marker="$HOME/.claude/.queue-restart"
  local claude_args=("$@")

  while true; do
    # Auto-sync Claude Code theme with macOS appearance (no "system" theme exists)
    local appearance claude_theme
    appearance=$(defaults read -g AppleInterfaceStyle 2>/dev/null)
    [[ "$appearance" == "Dark" ]] && claude_theme="dark-ansi" || claude_theme="light-ansi"
    jq --arg t "$claude_theme" '.theme = $t' ~/.claude.json > /tmp/.claude.json.tmp \
      && mv /tmp/.claude.json.tmp ~/.claude.json

    if [[ "$PWD" == "$HOME/SourceRoot"* ]]; then
      ENABLE_TOOL_SEARCH=true ANTHROPIC_API_KEY="" ANTHROPIC_BASE_URL="" claude --dangerously-skip-permissions --plugin-dir ~/SourceRoot/.claude "${claude_args[@]}"
    elif [[ "$PWD" == "$HOME/IuRoot"* ]]; then
      ENABLE_TOOL_SEARCH=true ANTHROPIC_API_KEY="" ANTHROPIC_BASE_URL="" claude --dangerously-skip-permissions --plugin-dir "$(git rev-parse --show-toplevel 2>/dev/null || echo '.')/.claude" "${claude_args[@]}"
    else
      ENABLE_TOOL_SEARCH=true ANTHROPIC_API_KEY="" ANTHROPIC_BASE_URL="" claude --dangerously-skip-permissions "${claude_args[@]}"
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
