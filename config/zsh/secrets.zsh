# Secrets — loaded from 1Password at shell startup
# Requires: op-service-account-token in macOS Keychain (see make setup)

export OP_SERVICE_ACCOUNT_TOKEN=$(security find-generic-password -a "$USER" -s "op-service-account-token" -w 2>/dev/null)
export ANTHROPIC_API_KEY=$(op read "op://CLI/Anthropic/credential" 2>/dev/null)
export ANTHROPIC_BASE_URL=$(op read "op://CLI/Anthropic/hostname" 2>/dev/null)
