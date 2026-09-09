#!/usr/bin/env bash
# Block until the herdr server answering the socket is one this client can talk
# to. Exits 0 when it is, 1 on timeout — and prints the last state it saw, so a
# timeout is diagnosable rather than just late.
#
#   herdr-ready.sh [--timeout SECONDS] [--version X.Y.Z] [--quiet]
#
# WHY THIS EXISTS AND WHY IT IS NOT A SLEEP. `launchctl bootout` retires the
# launchd job; it does not stop the server, which since 0.9.0 runs as a DETACHED
# DAEMON (`capabilities.detached_server_daemon`) and keeps the socket until it
# exits on its own. So for a while after bootout+bootstrap the socket is still
# answered by the OLD binary. `make herdr-restart` used to bridge that with
# `sleep 2` and then immediately run `make agent-overview`, which on the 0.8.2 →
# 0.9.0 upgrade meant a 0.9.0 client talking to the 0.8.2 server:
#
#   protocol_mismatch: client protocol 22 is newer than server protocol 20
#
# `workspace create` returned that error, the recipe read the id out with jq
# anyway, got empty, and died with `no pane in workspace ` — a confusing
# downstream symptom of an upstream that was simply not ready yet.
#
# THE EXIT CODE OF `herdr status` IS NOT THE SIGNAL — measured: against a socket
# path that does not exist it prints `"running": false` and still exits 0. Only
# the JSON body says anything true, which is also why the fallback below is a
# string match rather than a check of `$?`.
set -euo pipefail

TIMEOUT=60
WANT_VERSION=""
QUIET=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --version) WANT_VERSION="$2"; shift 2 ;;
    --quiet)   QUIET=1; shift ;;
    *) printf 'herdr-ready.sh: unknown argument %s\n' "$1" >&2; exit 2 ;;
  esac
done

say() { [[ "$QUIET" == 1 ]] || printf '%s\n' "$*"; }

deadline=$(( $(date +%s) + TIMEOUT ))
last="no status read"

while :; do
  json=$(herdr status --json 2>/dev/null || true)

  if [[ -n "$json" ]] && jq -e '.server' >/dev/null 2>&1 <<<"$json"; then
    read -r running compatible version protocol <<<"$(
      jq -r '[(.server.running // false), (.server.compatible // false),
              (.server.version // "?"), (.server.protocol // "?")] | @tsv' <<<"$json"
    )"
    last="running=$running compatible=$compatible version=$version protocol=$protocol"
    if [[ "$running" == "true" && "$compatible" == "true" ]] \
       && { [[ -z "$WANT_VERSION" ]] || [[ "$version" == "$WANT_VERSION" ]]; }; then
      say "  ✓ herdr server $version ready (protocol $protocol)"
      exit 0
    fi
  else
    # Pre-0.9.0 herdr, or a client too old for `status --json`. The text form is
    # all there is, and it cannot report compatibility at all.
    if herdr status server 2>/dev/null | grep -q "^status: running"; then
      last="running=true (text status — no compatibility field)"
      [[ -z "$WANT_VERSION" ]] && { say "  ✓ herdr server ready"; exit 0; }
      if herdr status server 2>/dev/null | grep -q "^version: $WANT_VERSION\$"; then
        say "  ✓ herdr server $WANT_VERSION ready"; exit 0
      fi
    else
      last="running=false (text status)"
    fi
  fi

  [[ $(date +%s) -lt $deadline ]] || break
  sleep 0.5
done

printf '  ✗ herdr server not ready after %ss — last seen: %s\n' "$TIMEOUT" "$last" >&2
[[ -z "$WANT_VERSION" ]] || printf '    expected version %s\n' "$WANT_VERSION" >&2
exit 1
