#!/bin/bash
# LocalAI helper server wrapper.
#
# Started by ~/Library/LaunchAgents/com.localai.helper.plist via launchd.
# Runs the FastAPI app from localai/helper/server.py using mlx-audio's venv
# (already has fastapi + httpx + soundfile + numpy — no extra deps needed).
#
# Injects Anthropic API credentials from macOS Keychain so the TTS route
# can make Haiku calls for speakable rewrite, title, and delivery notes.
# Credential names match what `make setup` caches for claude -p offloading:
#   security find-generic-password -s claude-sdk-api-key
#   security find-generic-password -s claude-sdk-base-url
#
# launchd needs PID 1 alive for the duration; exec the server in foreground.

set -u

PORT="${LOCALAI_HELPER_PORT:-8001}"
HOST="127.0.0.1"
HELPER_DIR="$(cd "$(dirname "$0")/../helper" && pwd)"

# Inject Anthropic credentials from Keychain — used by tts.py for Haiku calls.
# Silently skip if absent; Haiku calls fall back gracefully (no rewrite, title
# falls back to first words of text).
ANTHROPIC_API_KEY=$(security find-generic-password -s claude-sdk-api-key -w 2>/dev/null || echo "")
ANTHROPIC_BASE_URL=$(security find-generic-password -s claude-sdk-base-url -w 2>/dev/null || echo "https://api.anthropic.com")
export ANTHROPIC_API_KEY ANTHROPIC_BASE_URL

cd "$HELPER_DIR"
exec "$HOME/.local/share/uv/tools/mlx-audio/bin/python" \
  "$HELPER_DIR/server.py" \
  --host "$HOST" \
  --port "$PORT"
