# Secrets — 1Password personal account (biometric / session token via op signin)
# Switch back to service account: uncomment OP_SERVICE_ACCOUNT_TOKEN and comment out the signin block

# [SERVICE ACCOUNT — disabled] export OP_SERVICE_ACCOUNT_TOKEN=$(security find-generic-password -a "$USER" -s "op-service-account-token" -w 2>/dev/null)

# 1Password SSH agent — required for op-ssh-sign (git commit signing) and SSH key auth
export SSH_AUTH_SOCK=~/Library/Group\ Containers/2BUA8C4S2C.com.1password/t/agent.sock

# ANTHROPIC_* intentionally not exported — Claude Code would prefer API credits over subscription if set
# export ANTHROPIC_API_KEY=$(security find-generic-password -a "$USER" -s "anthropic-api-key" -w 2>/dev/null)
# export ANTHROPIC_BASE_URL=$(security find-generic-password -a "$USER" -s "anthropic-base-url" -w 2>/dev/null)
