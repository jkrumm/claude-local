#!/bin/bash
# LocalAI helper server wrapper.
#
# Started by ~/Library/LaunchAgents/com.localai.helper.plist via launchd.
# Runs the FastAPI app from localai/helper/server.py using mlx-audio's venv
# (already has fastapi + httpx + uvicorn — no extra deps needed).
#
# launchd needs PID 1 alive for the duration; we exec the server in
# foreground.

set -u

PORT="${LOCALAI_HELPER_PORT:-8001}"
HOST="127.0.0.1"
HELPER_DIR="$(cd "$(dirname "$0")/../helper" && pwd)"

cd "$HELPER_DIR"
exec "$HOME/.local/share/uv/tools/mlx-audio/bin/python" \
  "$HELPER_DIR/server.py" \
  --host "$HOST" \
  --port "$PORT"
