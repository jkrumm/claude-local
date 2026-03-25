# Secrets — read from macOS Keychain at shell startup (no network, no op dependency)
# Source of truth: 1Password CLI vault. Cached here via: make setup / make refresh-secrets

export OP_SERVICE_ACCOUNT_TOKEN=$(security find-generic-password -a "$USER" -s "op-service-account-token" -w 2>/dev/null)
export ANTHROPIC_API_KEY=$(security find-generic-password -a "$USER" -s "anthropic-api-key" -w 2>/dev/null)
export ANTHROPIC_BASE_URL=$(security find-generic-password -a "$USER" -s "anthropic-base-url" -w 2>/dev/null)

[[ -z "$OP_SERVICE_ACCOUNT_TOKEN" ]] && echo "⚠  secrets: run 'make setup' in claude-local to initialise"
