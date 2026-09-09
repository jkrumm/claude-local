#!/usr/bin/env bash
# Upgrade herdr on the dev host, with the two things that make a hand-driven
# upgrade go wrong taken away from you.
#
# THE FIRST IS THE DRIVER. A herdr upgrade bounces the herdr server, so run it
# from inside a herdr pane and it kills the shell running it — mid-sequence,
# between `brew upgrade` and the plist convergence, which is the one window
# where stopping leaves the boot path reverted. This refuses to start there
# (the same `CLAUDECODE`-style guard agent-dispatch uses) rather than trusting
# you to remember which kind of shell you are in.
#
# THE SECOND IS THE PLIST. `brew upgrade herdr` regenerates herdr's brew-service
# plist from the formula and strips the session-leader wrapper. Nothing errors;
# the server comes up fine and only the next `desk` starts asking "restart the
# remote server now? [y/N]" again, which reads as a herdr quirk rather than as a
# reverted config. `_herdr-supervise` runs here unconditionally.
#
# WHAT A RESTART ACTUALLY COSTS, measured rather than feared: shells, dev
# servers and anything else in a pane die, but Claude panes do NOT — herdr's
# native agent session restore resumes them with `claude --resume <id>`, needs
# integration version 6+ (this machine reports 8) and `resume_agents_on_restore`
# defaults to true. The inventory below is written anyway, because "eligible"
# is not "observed" and a list beats memory.
#
# LATER, ON A NEWER HERDR: `server.live_handoff` takes {import_exe,
# expected_version, expected_protocol} over the socket, which replaces a running
# server while KEEPING pane processes alive — i.e. an upgrade with no restart at
# all, drivable without herdr's self-updater fighting the brew install. It is
# experimental and opt-in upstream, and a stop is still required for the
# one-time move off a pre-generation-1 server. This script is where that goes.
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INVENTORY="$HOME/.config/herdr/last-restore-inventory.txt"

die() { printf '  ✗ %s\n' "$*" >&2; exit 1; }

# --- guards ------------------------------------------------------------------

if [[ -n "${HERDR_ENV:-}" ]]; then
  cat >&2 <<'BRIEF'
  ✗ refusing to run inside a herdr pane — this restarts the server that owns it

    Run it detached, from a shell herdr does not own. DETACHED MATTERS AWAY FROM
    HOME: a foreground `ssh mini '<cmd>'` dies with the link, and a link that
    drops between `brew upgrade` and the plist convergence is the one failure
    this target exists to prevent.

      ssh mini 'cd ~/SourceRoot/dotfiles && nohup make herdr-upgrade YES=1 \
        </dev/null >~/Library/Logs/herdr-upgrade.log 2>&1 & echo started'
      ssh mini 'tail -f ~/Library/Logs/herdr-upgrade.log'

    Or from a daemon that outlives both the link and the restart:
      claude --bg 'run make herdr-upgrade YES=1 in dotfiles and report'
BRIEF
  exit 1
fi

BACKEND=$(tr -d '[:space:]' < "$HOME/.config/secrets/backend" 2>/dev/null || echo "")
[[ "$BACKEND" == "cache" ]] || die "not the dev host (backend=${BACKEND:-unset}) — herdr runs no server here"
command -v herdr >/dev/null 2>&1 || die "herdr not installed — run: brew bundle install"
command -v jq >/dev/null 2>&1 || die "jq not installed — run: brew bundle install"

# --- version delta -----------------------------------------------------------

CURRENT=$(herdr --version | awk '{print $2}')
LATEST=$(brew info --json=v2 herdr 2>/dev/null | jq -r '.formulae[0].versions.stable // empty')
[[ -n "$LATEST" ]] || die "could not resolve herdr's stable version from brew"

if [[ "$CURRENT" == "$LATEST" ]]; then
  echo "  ✓ herdr $CURRENT is current — nothing to upgrade"
  exit 0
fi
echo "  herdr $CURRENT → $LATEST"

# --- inventory, and the working/blocked gate ---------------------------------

# Written BEFORE anything is touched: once the server is bounced, the only
# record of what was running is this file.
AGENTS=$(herdr agent list 2>/dev/null || echo '{}')
BUSY=$(jq -r '[.result.agents[]? | select(.agent_status=="working" or .agent_status=="blocked")] | length' <<<"$AGENTS")
TOTAL=$(jq -r '.result.agents? | length // 0' <<<"$AGENTS")

mkdir -p "$(dirname "$INVENTORY")"
{
  echo "# herdr restore inventory — $(date '+%Y-%m-%d %H:%M:%S'), before $CURRENT → $LATEST"
  echo "# Panes herdr does not resume itself come back as plain shells in these directories."
  echo
  jq -r '.result.agents[]? | "\(.agent_status)\t\(.cwd)\t\(.agent_session.value // "-")\t\(.terminal_title // "")"' <<<"$AGENTS"
} > "$INVENTORY"
echo "  $TOTAL agents ($BUSY working or blocked) → $INVENTORY"

if [[ "$BUSY" -gt 0 && "${YES:-}" != "1" ]]; then
  jq -r '.result.agents[]? | select(.agent_status=="working" or .agent_status=="blocked")
         | "    \(.agent_status)  \(.cwd)"' <<<"$AGENTS"
  die "agents are mid-flight — park them, or override with: make herdr-upgrade YES=1"
fi

if [[ "${YES:-}" != "1" ]]; then
  [[ -t 0 ]] || die "no TTY and YES is unset — re-run with: make herdr-upgrade YES=1"
  printf '  Upgrade and restart the herdr server, killing every pane? [y/N] '
  read -r reply
  [[ "$reply" == "y" || "$reply" == "Y" ]] || { echo "  · aborted"; exit 0; }
fi

# --- upgrade -----------------------------------------------------------------

echo "  → brew upgrade herdr"
brew upgrade herdr || die "brew upgrade herdr failed"

# Unconditional, and before the restart: the plist brew just rewrote is the one
# launchd will bootstrap.
make -C "$DOTFILES_DIR" --no-print-directory _herdr-supervise
make -C "$DOTFILES_DIR" --no-print-directory herdr-restart YES=1

# --- assert ------------------------------------------------------------------

for _ in $(seq 1 30); do
  herdr status server 2>/dev/null | grep -q "^status: running" && break
  sleep 1
done
herdr status server 2>/dev/null | grep -q "^status: running" \
  || die "herdr server did not come back — launchctl print $(brew services info herdr --json | jq -r '.[0].name // "herdr"')"

RUNNING=$(herdr status server 2>/dev/null | awk -F': ' '/^version:/{print $2; exit}')
[[ "$RUNNING" == "$LATEST" ]] \
  || echo "  · server reports '$RUNNING', expected '$LATEST' — a client may be pinning an old build"

# A new herdr can reject a key the old one accepted, and a rejected config is
# silently the default rather than an error at startup.
herdr config check || die "config.toml is not valid for herdr $LATEST — fix it, then: herdr server reload-config"

# Spaces come back from session.json, but a restored space that was opened after
# the last run lands under OTHER until this re-asserts the declared order.
make -C "$DOTFILES_DIR" --no-print-directory herdr-groups

echo "  ✓ herdr $LATEST running, boot path converged, groups re-applied"
echo "    restore checklist: $INVENTORY"
echo "    reattach with: desk"
