#!/bin/sh
# Runs on wake from sleep via sleepwatcher — reload local dev routing
BREW=$( [ -x /opt/homebrew/bin/brew ] && echo /opt/homebrew || echo /usr/local )
"${BREW}/bin/caddy" reload --config "${BREW}/etc/caddy/Caddyfile" 2>/dev/null || true
