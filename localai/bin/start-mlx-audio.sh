#!/bin/bash
# mlx-audio server wrapper — binds localhost (no Tailscale exposure) and
# warms the STT model so the first transcription request hits a hot cache.
#
# Started by ~/Library/LaunchAgents/com.localai.audio.plist via launchd.
# launchd restarts on crash (KeepAlive=true), so this script must stay in
# the foreground for the duration of the server process.

set -u

STT_MODEL="${LOCALAI_STT_MODEL:-mlx-community/parakeet-tdt-0.6b-v3}"
PORT="${LOCALAI_PORT:-8000}"
HOST="127.0.0.1"
LOG_DIR="/tmp/mlx-audio-logs"
WARMUP_AUDIO="/tmp/_mlx-audio-warmup.wav"

mkdir -p "$LOG_DIR"

# Generate a 0.5s silent WAV for warm-up (idempotent — only if missing).
if [[ ! -f "$WARMUP_AUDIO" ]]; then
  ffmpeg -f lavfi -i "anullsrc=r=16000:cl=mono" -t 0.5 -y "$WARMUP_AUDIO" \
    >/dev/null 2>&1 || true
fi

# Background warm-up: poll until server is listening, then load STT + TTS models.
# Runs in subshell so it doesn't block server startup.
(
  for _ in $(seq 1 60); do
    if curl -fsS "http://${HOST}:${PORT}/v1/models" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  # STT warm-up — keeps Parakeet resident in ModelProvider.models[]
  if [[ -f "$WARMUP_AUDIO" ]]; then
    curl -fsS -X POST "http://${HOST}:${PORT}/v1/audio/transcriptions" \
      -F "model=${STT_MODEL}" \
      -F "file=@${WARMUP_AUDIO}" \
      -o /tmp/mlx-audio-warmup.log 2>&1 || true
    echo "[$(date +%H:%M:%S)] STT warm-up complete: ${STT_MODEL}" \
      >> /tmp/mlx-audio-warmup.log
  fi

  # TTS warm-up — lazy-loads Qwen3-TTS on first request; fire a short synth
  # so the 4.2 GB model is already resident when the first real memo arrives.
  TTS_MODEL="${LOCALAI_TTS_MODEL:-mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16}"
  curl -fsS -X POST "http://${HOST}:${PORT}/v1/audio/speech" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"${TTS_MODEL}\",\"input\":\"Bereit.\",\"voice\":\"alloy\",\"response_format\":\"wav\",\"instruct\":\"warm-up\",\"lang_code\":\"german\"}" \
    -o /dev/null 2>&1 || true
  echo "[$(date +%H:%M:%S)] TTS warm-up complete: ${TTS_MODEL}" \
    >> /tmp/mlx-audio-warmup.log
) &

# Server in foreground — launchd needs PID 1 alive to manage lifecycle.
exec "$HOME/.local/bin/mlx_audio.server" \
  --host "$HOST" \
  --port "$PORT" \
  --log-dir "$LOG_DIR"
