# AI shell helpers — Claude Haiku via ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL
# Both are loaded from 1Password in secrets.zsh at shell startup.
#
#   ai <description>    generate a zsh command from natural language, confirm before run
#   fix                 re-run last failed command, capture error, ask Claude to fix

# Internal: call Claude Haiku and return a single shell command (or empty on error)
_claude_shell_cmd() {
  local prompt="$1" system="${2:-Shell command generator for macOS zsh. Output ONLY the raw command. No explanation, no markdown, no backticks.}"

  if [[ -z "$ANTHROPIC_API_KEY" ]]; then
    echo "ANTHROPIC_API_KEY not set — run 'sz' to reload secrets" >&2
    return 1
  fi

  local base="${ANTHROPIC_BASE_URL:-https://api.anthropic.com}"
  local response
  response=$(curl -s "${base%/}/v1/messages" \
    -H "content-type: application/json" \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -d "$(jq -n --arg s "$system" --arg p "$prompt" '{
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: $s,
      messages: [{role: "user", content: $p}]
    }')") || return 1

  if jq -e '.type == "error"' <<< "$response" &>/dev/null; then
    echo "API error: $(jq -r '.error.message' <<< "$response")" >&2
    return 1
  fi

  jq -r '.content[0].text // empty' <<< "$response"
}

ai() {
  [[ -z "$1" ]] && { echo "Usage: ai <describe what you want>"; return 1 }
  local cmd
  cmd=$(_claude_shell_cmd "$*") || return 1
  [[ -z "$cmd" ]] && { echo "No command generated"; return 1 }
  print -P "\n%F{yellow}▶%f $cmd\n"
  echo -n "Execute? [y/n] "
  read -rk1; echo
  [[ "$REPLY" == [yY] ]] && eval "$cmd"
}

fix() {
  local last_cmd
  last_cmd=$(fc -ln -1 2>/dev/null | sed 's/^[[:space:]]*//')
  [[ -z "$last_cmd" || "$last_cmd" == "fix" ]] && { echo "No previous command to fix"; return 1 }
  print -P "%F{blue}Re-running to capture error:%f $last_cmd"
  local err_out exit_code
  err_out=$(eval "$last_cmd" 2>&1)
  exit_code=$?
  [[ $exit_code -eq 0 ]] && { echo "Command succeeded — nothing to fix"; return 0 }
  print -P "%F{red}Error (exit $exit_code):%f"
  echo "$err_out" | head -20
  echo ""
  local fixed
  fixed=$(_claude_shell_cmd "Fix this zsh command.
Command: $last_cmd
Error: $err_out
Return ONLY the corrected command.") || return 1
  [[ -z "$fixed" ]] && { echo "No fix generated"; return 1 }
  print -P "\n%F{green}Fix:%f $fixed\n"
  echo -n "Execute? [y/n] "
  read -rk1; echo
  [[ "$REPLY" == [yY] ]] && eval "$fixed"
}
