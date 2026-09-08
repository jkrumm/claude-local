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
# The key never enters the config file. codex reads it from IU_API_KEY, which
# these functions resolve per call — Keychain on the MacBook, the SOPS cache on
# the mini — and pass by prefix assignment rather than `env VAR=…`, which would
# leak it into `ps auxww`.

_codex_iu_key() {
  local key
  key=$(security find-generic-password -s claude-sdk-api-key -w 2>/dev/null)
  [[ -n "$key" ]] || key=$(secrets-run read op://common/anthropic/API_KEY 2>/dev/null)
  if [[ -z "$key" ]]; then
    print -ru2 "codex: IU key missing — run 'make setup' in dotfiles"
    return 1
  fi
  print -r -- "$key"
}

# gpt-5.6-sol, effort high. The everyday challenger.
cx() {
  local key; key=$(_codex_iu_key) || return 1
  IU_API_KEY="$key" command codex "$@"
}

# gpt-6-astra, effort xhigh. Several times the price — reach for it when the
# question is genuinely hard, not to save a `cx` invocation.
cxa() {
  local key; key=$(_codex_iu_key) || return 1
  IU_API_KEY="$key" command codex --profile astra "$@"
}
