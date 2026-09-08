# ── Codex CLI — the OpenAI lane ───────────────────────────────────────────────
#
# Claude Code stays the daily driver; this is the rare second opinion from a
# non-Anthropic frontier model. Codex is the harness because its wire protocol
# is Responses-only, which is the only way OpenAI's reasoning models keep their
# reasoning items across tool calls.
#
# Config: ~/.codex/config.toml (rendered from config/codex/config.toml.tpl by
# `make setup`, because the endpoint host never enters git) plus
# ~/.codex/astra.config.toml for the `astra` profile.
#
# Neither secret enters a config file. codex reads them from IU_API_KEY and
# RESEARCH_GATEWAY_TOKEN, which these functions resolve per call — Keychain on
# the MacBook, the SOPS cache on the mini — and pass by prefix assignment rather
# than `env VAR=…`, which would leak them into `ps auxww`.

# Keychain first (milliseconds, no prompt), the secrets shim second — and the
# shim is time-boxed: on the MacBook it resolves through 1Password and can raise
# a biometric prompt nobody is watching, which would otherwise hang the launch
# on an optional secret. `mcp-research-headers.sh` bounds the same call for the
# same reason.
_codex_secret() {
  local svc="$1" ref="$2" val to
  val=$(security find-generic-password -s "$svc" -w 2>/dev/null)
  if [[ -z "$val" ]]; then
    to=$(command -v timeout || command -v gtimeout)
    if [[ -n "$to" ]]; then
      val=$("$to" 8 secrets-run read "$ref" 2>/dev/null)
    else
      val=$(secrets-run read "$ref" 2>/dev/null)
    fi
  fi
  print -r -- "$val"
}

_codex_run() {
  local key token
  key=$(_codex_secret claude-sdk-api-key op://common/anthropic/API_KEY)
  if [[ -z "$key" ]]; then
    print -ru2 "codex: IU key missing — run 'make setup' in dotfiles"
    return 1
  fi

  # An unset (or empty) bearer_token_env_var is FATAL to codex's MCP startup —
  # it refuses to start the client rather than connecting and taking a 401. So
  # an unresolvable bearer disables the server for this launch instead, which
  # costs research and nothing else. Chiefly this fires on a shell that hasn't
  # re-sourced this file since the server was wired up: `sz`.
  local -a args=()
  token=$(_codex_secret research-gateway-token op://vps/research-gateway/API_SECRET)
  if [[ -z "$token" ]]; then
    print -ru2 "codex: research-gateway bearer unresolvable — starting without it"
    args=(-c mcp_servers.research-gateway.enabled=false)
  fi

  IU_API_KEY="$key" RESEARCH_GATEWAY_TOKEN="$token" command codex "${args[@]}" "$@"
}

# gpt-5.6-sol, effort high. The everyday challenger.
cx() { _codex_run "$@" }

# gpt-6-astra, effort xhigh. Several times the price — reach for it when the
# question is genuinely hard, not to save a `cx` invocation.
cxa() { _codex_run --profile astra "$@" }
