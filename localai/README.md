# LocalAI Stack — Per-Machine mlx-audio (TTS + STT)

Each Mac runs its own `mlx-audio` server bound to `127.0.0.1:8000`. No cross-Tailscale audio routing. Installed automatically by `make setup`.

## Architecture

```
Hermes / scripts            →  http://127.0.0.1:8000/v1/...     (mlx-audio direct)
MacWhisper / strict clients →  https://whisper.test/v1/...      (Caddy)
                                  ├─ /v1/audio/transcriptions → :8001 (helper, response transform)
                                  └─ /v1/*                     → :8000 (mlx-audio direct)

mlx-audio          (com.localai.audio,  127.0.0.1:8000)
  POST /v1/audio/speech         → TTS  (lazy-load on first request)
  POST /v1/audio/transcriptions → STT  (warm on launchd start)
  GET  /v1/models               → list of currently-loaded models
  DELETE /v1/models             → unload a model

localai-helper     (com.localai.helper, 127.0.0.1:8001)
  POST /v1/audio/transcriptions → forwards to mlx-audio + transforms
                                  Parakeet's {text, sentences} into OpenAI's
                                  verbose_json {text, segments, language,
                                  duration, task} for strict clients.
  GET  /health                  → liveness probe

  Extension point — drop new modules in `helper/routes/` for additional
  local processing (model routing, format converters, batch ops, etc).
```

LLM is no longer local — Hermes uses the IU unified endpoint (Anthropic-compatible path) for all chat completions.

## Models

### STT: NVIDIA Parakeet TDT v3

| Model | Size | Languages | Speed |
|-|-|-|-|
| **mlx-community/parakeet-tdt-0.6b-v3** | 1.2 GB | 25 EU langs incl. EN/DE | 10–60× RT |

Always-warm: the launchd wrapper script (`bin/start-mlx-audio.sh`) fires a warm-up transcription right after server boot so the model stays resident in `ModelProvider.models[]` for the process lifetime.

**Why Parakeet, not Whisper:** Tried Whisper Turbo but mlx-audio 0.4.2 has a bug — `load_model()` doesn't attach `WhisperProcessor`, so `get_tokenizer()` raises `Processor not found`. Patching to load the processor at request time triggers an MLX Metal threading crash (`There is no Stream(gpu, 2) in current thread`). Parakeet works cleanly.

**MacWhisper:** Point at `https://whisper.test` — Caddy proxies `/v1/audio/transcriptions` through `localai-helper` which transforms the response into OpenAI verbose_json shape (`{text, segments, language, duration, task}`). Other paths go direct to mlx-audio. Model: `mlx-community/parakeet-tdt-0.6b-v3`. API key: any non-empty string.

### TTS: Kokoro + Qwen3-TTS

| Use Case | Model | Size | Speed |
|-|-|-|-|
| Quick / interactive | `mlx-community/Kokoro-82M-bf16` | 0.4 GB | <0.3s, 210× RT |
| Quality / voice cloning | `mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16` | 4.2 GB | 97ms TTFB |

TTS lazy-loads on first request; stays in memory until explicitly unloaded.

## Files

| File | Purpose |
|-|-|
| `com.localai.audio.plist.template` | mlx-audio launchd plist (templated — `__HOME__` substituted at install) |
| `com.localai.helper.plist.template` | localai-helper launchd plist (templated) |
| `bin/start-mlx-audio.sh` | Wrapper: starts mlx-audio + fires STT warm-up curl |
| `bin/start-localai-helper.sh` | Wrapper: starts the FastAPI helper using mlx-audio's venv |
| `helper/server.py` | FastAPI app — extension point for local processing |
| `helper/routes/macwhisper.py` | OpenAI verbose_json transform for STT |
| `patches/mlx-audio-m4a-stt.patch` | m4a/aac/mp4/ogg/opus/webm transcoding via ffmpeg (Slack voice memos) |

Re-apply the patch after `uv tool upgrade mlx-audio`. `_setup-localai` does this idempotently.

## Setup

```bash
make setup           # Full setup — runs _setup-localai automatically
make _setup-localai  # Just the localai chunk (mlx-audio + deps + ffmpeg + patch + plist)
make localai-setup   # Just (re)render the audio plist + reload
make start           # launchctl load com.localai.audio
make stop            # launchctl unload com.localai.audio
```

First run downloads ~2 GB of Python deps (mlx-audio + Kokoro). Parakeet (1.2 GB) downloads on first STT request and is then cached at `~/.cache/huggingface/hub/`.

## Verify

```bash
# Server reachable
curl http://127.0.0.1:8000/v1/models

# Transcribe
curl -X POST http://127.0.0.1:8000/v1/audio/transcriptions \
  -F "model=mlx-community/parakeet-tdt-0.6b-v3" \
  -F "file=@audio.m4a"

# Synthesize (Kokoro)
curl -X POST http://127.0.0.1:8000/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model":"mlx-community/Kokoro-82M-bf16","input":"Hello","voice":"af_heart"}' \
  --output out.mp3

# Tail server log
tail -f /tmp/audio.log

# Tail warm-up log
cat /tmp/mlx-audio-warmup.log
```

## Hermes Integration

`~/.hermes/config.yaml`:

```yaml
stt:
  provider: "openai"
  openai:
    model: "mlx-community/parakeet-tdt-0.6b-v3"
    base_url: "http://127.0.0.1:8000/v1"
    api_key: "not-needed"

tts:
  provider: "openai"
  openai:
    model: "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16"
    voice: ""
    base_url: "http://127.0.0.1:8000/v1"
    api_key: "not-needed"
    extra_body:
      instruct: "<voice description>"
```

## Migration from Tailscale-fronted M2 Max

The old setup ran Ollama (Gemma 4) + mlx-audio + Caddy + management API on a dedicated MacBook M2 Max, exposed via Tailscale. That stack is retired.

To clean up M2 Max after migration:

```bash
ssh iumac
launchctl unload ~/Library/LaunchAgents/com.localai.{api,ollama,monitor,audio}.plist
rm ~/Library/LaunchAgents/com.localai.{api,ollama,monitor,audio}.plist
brew uninstall ollama  # optional
sudo rm /opt/homebrew/etc/Caddyfile.localai.conf  # if still present
sudo brew services restart caddy
```

Then `git pull` in `~/SourceRoot/claude-local` will land the cleaned-up state.

## Rejected Alternatives

| Tool | Why |
|-|-|
| Ollama (Gemma 4 local) | Cloud Sonnet 4.6 cheaper than M2 Max electricity for light use; better agent quality |
| LocalAI (mudler) | llama.cpp not MLX (40-90% slower) |
| WhisperKit | `serve` unreliable, fragile Swift build |
| whisper-large-v3-turbo | Replaced by Parakeet v3 — 25% smaller, ~3× faster, similar accuracy |

**Last model research:** 2026-04-28
