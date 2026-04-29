#!/usr/bin/env bash
# Launch the Fish S2 Pro playground.
#   ./run.sh           — runs in foreground on port 8002
# Caddy maps fish-playground.test → 127.0.0.1:8002
set -euo pipefail
cd "$(dirname "$0")"
exec uv run --python 3.13 \
  --with mlx-speech \
  --with fastapi --with uvicorn --with pydantic --with soundfile \
  python server.py
