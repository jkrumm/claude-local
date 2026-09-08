#!/usr/bin/env bash
# Emit the research-gateway bearer as a JSON header object, for Claude Code's
# `headersHelper`. Registered by `make setup` (_setup-research-gateway-mcp).
#
# Why a helper and not a literal header: `claude mcp add --header` writes the
# resolved token into ~/.claude.json, so a live bearer sat in a file every agent
# reads routinely, and rotating it meant re-running setup on both machines. A
# helper keeps the token out of the file entirely and re-reads it on every
# reconnect, so a rotation is picked up by the next connection.
#
# Claude Code gives a helper 10 SECONDS and takes stdout as a JSON object of
# string headers. That budget is the whole design constraint here:
#
#   - Keychain first. `security find-generic-password` returns in milliseconds
#     and needs no network, which is what keeps us inside the budget on the
#     MacBook, where the secrets shim resolves through 1Password and can raise a
#     biometric prompt — a prompt nobody wants on every MCP reconnect, and one
#     that would blow the 10 s budget anyway.
#   - `secrets-run` second, for the mini, where the age-encrypted cache answers
#     without a prompt and without a network round trip. This is also the path a
#     fresh machine takes before `make setup` has seeded the Keychain.
#
# Failure is silent by contract: print `{}` and exit 0. Claude Code then connects
# without the header and the gateway answers 401, which reads as an auth problem
# — the truth — rather than as a broken MCP server. Never print the token to
# stderr, and never let a partial read reach stdout.
set -euo pipefail

REF="op://vps/research-gateway/API_SECRET"
KEYCHAIN_SERVICE="research-gateway-token"
SECRETS_RUN="${SECRETS_RUN_BIN:-$HOME/.local/bin/secrets-run}"

token=""

if command -v security >/dev/null 2>&1; then
  token="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true)"
fi

if [ -z "$token" ] && [ -x "$SECRETS_RUN" ]; then
  # 8s, not the full 10: leave room for the JSON write and the caller's own
  # bookkeeping, so a hung resolve degrades to `{}` instead of a killed helper.
  token="$(OP_ACCOUNT=tkrumm /usr/bin/env - HOME="$HOME" PATH="$PATH" \
    "$(command -v timeout || command -v gtimeout || echo)" 8 \
    "$SECRETS_RUN" read "$REF" 2>/dev/null || true)"
  # No `timeout` binary on this box: fall back to a plain read rather than skip.
  if [ -z "$token" ]; then
    token="$(OP_ACCOUNT=tkrumm "$SECRETS_RUN" read "$REF" 2>/dev/null || true)"
  fi
fi

token="${token%%$'\n'*}"

if [ -z "$token" ]; then
  printf '{}\n'
  exit 0
fi

# Hand-built rather than jq: one fewer dependency on a path that runs before
# anything else, and the value is a bearer token — no escaping to get wrong.
printf '{"Authorization":"Bearer %s"}\n' "$token"
