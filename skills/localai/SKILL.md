---
name: localai
description: Manage per-machine mlx-audio (TTS + STT) on 127.0.0.1:8000 — install, status, swap STT model, troubleshoot
model: haiku
---

# LocalAI Stack Management

Per-machine `mlx-audio` (TTS + STT) bound to `127.0.0.1:8000`. Installed automatically by `make setup`. No Tailscale exposure, no Ollama, no LLM — Hermes uses cloud Sonnet 4.6 via the IU unified endpoint.

**Full documentation:** Read `~/SourceRoot/claude-local/localai/README.md` first.

## Stack Overview

| Component | Service | Port |
|-|-|-|
| mlx-audio (TTS + STT) | `com.localai.audio` | 8000 (localhost) |
| localai-helper (FastAPI extension layer — STT response transform, future local processing) | `com.localai.helper` | 8001 (localhost) |

**Models:**
- STT (always-warm): `mlx-community/parakeet-tdt-0.6b-v3` — 1.2 GB, 25 EU langs incl. EN/DE, fast (10–60× RT)
- TTS quick: `mlx-community/Kokoro-82M-bf16` — 0.4 GB, 54 named voices
- TTS quality: `mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16` — 4.2 GB, voice via `instruct` param

STT warms on launchd start (wrapper script fires a silent transcription). TTS lazy-loads on first request.

**Why Parakeet, not Whisper:** mlx-audio 0.4.2 has a Whisper bug — `load_model()` doesn't attach `WhisperProcessor` (required for `get_tokenizer()`). Patching at request-time triggers an MLX Metal threading crash. Parakeet works cleanly.

**MacWhisper endpoint:** `https://whisper.test` — Caddy block in `config/Caddyfile` rewrites Content-Type to `application/json` (mlx-audio's `application/x-ndjson` confuses MacWhisper's parser). Use any STT model id (e.g., `mlx-community/parakeet-tdt-0.6b-v3`).

## Commands

### `/localai setup`

Run the Makefile target — does everything (mlx-audio, deps, ffmpeg, m4a patch, plist install + load):

```bash
cd ~/SourceRoot/claude-local
make _setup-localai
```

Or as part of full setup: `make setup`.

First run downloads ~2 GB of Python deps. Parakeet (1.2 GB) downloads on first STT request and caches at `~/.cache/huggingface/hub/`.

### `/localai status`

```bash
echo "=== mlx-audio (127.0.0.1:8000) ==="
curl -sf http://127.0.0.1:8000/v1/models | jq -r '.data[]?.id' 2>/dev/null \
  || echo "DOWN — check tail /tmp/audio.err"

echo ""
echo "=== launchd ==="
launchctl list | grep com.localai.audio || echo "Not loaded"

echo ""
echo "=== Warm-up log ==="
tail -3 /tmp/mlx-audio-warmup.log 2>/dev/null

echo ""
echo "=== System ==="
memory_pressure | head -1
```

### `/localai update`

```bash
# Upgrade mlx-audio + deps
uv tool upgrade mlx-audio
uv pip install --python ~/.local/share/uv/tools/mlx-audio/bin/python3 "setuptools<81" python-multipart
uv pip install --python ~/.local/share/uv/tools/mlx-audio/bin/python3 \
  "misaki[en]<0.9" num2words phonemizer espeakng_loader spacy

# Re-apply m4a STT patch (uv tool upgrade overwrites server.py)
patch -p1 -d ~/.local/share/uv/tools/mlx-audio/lib/python3.12/site-packages \
  < ~/SourceRoot/claude-local/localai/patches/mlx-audio-m4a-stt.patch

# Restart
launchctl kickstart -k gui/$(id -u)/com.localai.audio
```

Or just re-run `make _setup-localai` — it handles all of the above idempotently.

### `/localai swap-model <component> <model>`

Components: `tts` | `stt`.

**STT default (warm-on-start):** edit the wrapper script env or set `LOCALAI_STT_MODEL` in the audio plist:

```xml
<key>EnvironmentVariables</key>
<dict>
  <key>LOCALAI_STT_MODEL</key><string>mlx-community/parakeet-tdt-0.6b-v3</string>
  ...
</dict>
```

Then restart: `launchctl kickstart -k gui/$(id -u)/com.localai.audio`.

**Per-request:** any client can specify any model in the API call — it lazy-loads.

**Pre-load manually:**
```bash
curl -X POST http://127.0.0.1:8000/v1/models \
  -H 'Content-Type: application/json' \
  -d '{"model":"<model-id>"}'
```

### `/localai stop` / `/localai start`

```bash
make stop    # launchctl unload com.localai.audio
make start   # launchctl load com.localai.audio
```

## Troubleshooting

**Server won't start:**
- `tail -50 /tmp/audio.err` — startup errors
- `pkg_resources` error → `uv pip install --python ~/.local/share/uv/tools/mlx-audio/bin/python3 "setuptools<81"`
- Port 8000 conflict → `lsof -i :8000`

**STT not warm on first request:**
- Check `/tmp/mlx-audio-warmup.log` — should see "STT warm-up complete"
- If empty: server may not have been ready when warm-up curl fired (wrapper retries 60×1s). Increase polling timeout in `localai/bin/start-mlx-audio.sh` if needed.

**Kokoro TTS errors:**
- Missing `misaki`/`num2words`/`phonemizer`/`espeakng_loader`/`spacy` → re-run `make _setup-localai`
- `EspeakWrapper.set_data_path` AttributeError → pin `misaki<0.9`
- `ffmpeg not found` → check plist has `PATH` env var including `/opt/homebrew/bin`

**Slack voice memo "incorrect format" / m4a errors:**
- Verify m4a STT patch applied: `grep -q "ffmpeg" ~/.local/share/uv/tools/mlx-audio/lib/python3.12/site-packages/mlx_audio/server.py && echo "patched" || echo "MISSING"`
- Re-apply: `make _setup-localai`

**Migration cleanup (M2 Max only — old Tailscale-fronted setup):**
```bash
ssh iumac
launchctl unload ~/Library/LaunchAgents/com.localai.{api,ollama,monitor,audio}.plist
rm ~/Library/LaunchAgents/com.localai.{api,ollama,monitor,audio}.plist
brew uninstall ollama  # optional
sudo rm /opt/homebrew/etc/Caddyfile.localai.conf
sudo brew services restart caddy
git -C ~/SourceRoot/claude-local pull  # land cleaned-up state
```
