# AI shell helpers — Claude Sonnet via ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL
# Both are loaded from 1Password in secrets.zsh at shell startup.
#
#   ai <description>      generate a zsh command from natural language, confirm before run
#   fix [description]     fix the last failed command (ai-generated or regular)
#                         pass description when command succeeded but output was wrong

# Last AI-generated command + original prompt — used by fix to avoid re-invoking ai
_AI_LAST_CMD=""
_AI_LAST_PROMPT=""
_AI_FIX_HISTORY=""  # accumulates all attempted commands + errors across fix iterations

# Internal: call Claude Sonnet and return a single shell command (or empty on error)
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
      model: "claude-sonnet-4-6",
      max_tokens: 512,
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
  if [[ "$REPLY" == [yY] ]]; then
    _AI_LAST_CMD="$cmd"
    _AI_LAST_PROMPT="$*"
    _AI_FIX_HISTORY=""
    eval "$cmd"
  fi
}

fix() {
  local description="${1:-}"
  local cmd_to_fix
  local last_history
  last_history=$(fc -ln -1 2>/dev/null | sed 's/^[[:space:]]*//')

  # If last history entry was ai/fix and we have a saved AI-generated command, fix that
  # instead of re-invoking ai (which would just generate a new command)
  if [[ ( "$last_history" == ai\ * || "$last_history" == fix* ) && -n "$_AI_LAST_CMD" ]]; then
    cmd_to_fix="$_AI_LAST_CMD"
  else
    cmd_to_fix="$last_history"
    [[ -z "$cmd_to_fix" || "$cmd_to_fix" == "fix" ]] && { echo "No previous command to fix"; return 1 }
    _AI_LAST_PROMPT="$cmd_to_fix"
    _AI_FIX_HISTORY=""
  fi

  print -P "%F{blue}Re-running to capture output:%f $cmd_to_fix"
  local captured exit_code
  captured=$(setopt pipefail 2>/dev/null; eval "$cmd_to_fix" 2>&1)
  exit_code=$?

  local is_error=false
  if [[ $exit_code -ne 0 ]] || grep -qi '\[error\]\|error:\|fatal:\|failed' <<< "$captured" 2>/dev/null; then
    is_error=true
  fi

  # Append this attempt to the fix history
  local attempt_record="Command: $cmd_to_fix"
  if [[ $is_error == false && -n "$description" ]]; then
    attempt_record="$attempt_record
Output: $captured
Issue: $description"
  else
    attempt_record="$attempt_record
Error: $captured"
  fi
  _AI_FIX_HISTORY="${_AI_FIX_HISTORY}
---
$attempt_record"

  local prompt
  if [[ $is_error == false ]]; then
    if [[ -z "$description" ]]; then
      print -P "%F{yellow}Command succeeded.%f Describe what's wrong: fix '<description>'"
      return 0
    fi
    print -P "%F{yellow}Output:%f"
    echo "$captured" | head -20
    echo ""
  else
    print -P "%F{red}Error (exit $exit_code):%f"
    echo "$captured" | head -20
    echo ""
  fi

  prompt="Original intent: $_AI_LAST_PROMPT

Previous attempts (do not repeat these mistakes):$_AI_FIX_HISTORY

Return ONLY the corrected zsh command."

  local fixed
  fixed=$(_claude_shell_cmd "$prompt") || return 1
  [[ -z "$fixed" ]] && { echo "No fix generated"; return 1 }

  _AI_LAST_CMD="$fixed"
  print -P "\n%F{green}Fix:%f $fixed\n"
  echo -n "Execute? [y/n] "
  read -rk1; echo
  [[ "$REPLY" == [yY] ]] && eval "$fixed"
}
