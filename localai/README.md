# LocalAI Stack — Per-Machine mlx-audio (TTS + STT)

Each Mac runs its own `mlx-audio` server bound to `127.0.0.1:8000`. No cross-Tailscale audio routing. Installed automatically by `make setup`.

## Architecture

```
Hermes (tts_tool.py)        →  http://127.0.0.1:8001/v1/tts/synthesize  (helper)
MacWhisper / strict clients →  https://whisper.test/v1/...               (Caddy)
                                  ├─ /v1/audio/transcriptions → :8001 (helper, response transform)
                                  └─ /v1/*                     → :8000 (mlx-audio direct)

mlx-audio          (com.localai.audio,  127.0.0.1:8000)
  POST /v1/audio/speech         → TTS  (warm on launchd start)
  POST /v1/audio/transcriptions → STT  (warm on launchd start)
  GET  /v1/models               → list of currently-loaded models
  DELETE /v1/models             → unload a model

localai-helper     (com.localai.helper, 127.0.0.1:8001)
  POST /v1/tts/synthesize       → TTS orchestration: language detect → voice
                                  preset → speakable rewrite (Haiku, only when
                                  markdown-heavy) → title (Haiku) → paragraph-
                                  aware chunking → Voxtral synthesis → numpy
                                  concat → ffmpeg WAV→MP3 → base64 JSON
  POST /v1/audio/transcriptions → forwards to mlx-audio + transforms
                                  Parakeet's {text, sentences} into OpenAI's
                                  verbose_json {text, segments, language,
                                  duration, task} for strict clients.
  GET  /health                  → liveness probe

  Extension point — drop new modules in `helper/routes/` for additional
  local processing. Helper runs in mlx-audio's uv venv (fastapi + httpx +
  soundfile + numpy available). Anthropic API credentials injected from
  Keychain at launchd start for Haiku calls.
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

### TTS: Voxtral 4B (Mistral)

| Model | Size | Voices | Notes |
|-|-|-|-|
| **mlx-community/Voxtral-4B-TTS-2603-mlx-4bit** | 2.5 GB | 20 fixed presets, 10 langs | 0.74× RTF long-form on M2 Pro |

**Voice presets (language-keyed in `helper/routes/tts.py`):**
- `de_male` — German, slight Austrian Hochdeutsch lean (Mistral demo "Patrick")
- `de_female` — German female
- `neutral_male` / `casual_male` / `cheerful_female` — English presets
- 13 more for FR / ES / IT / PT / NL / AR / HI

**API surface is much simpler than Qwen3:** No `lang_code`, no `instruct`, no `extra_body`. Just `model` + `input` + `voice` + `response_format`. Expression comes from text content (implicit steering). `(lacht)`, `[seufzt]`, SSML — all no-ops.

**No audio post-processing.** Voxtral output goes through ffmpeg only for the WAV→MP3 encode. Tested slowdown, denoise, loudnorm, EQ, fade in/out — every filter made the voice sound more processed and less natural.

**Warm on launchd start** — `start-mlx-audio.sh` synthesizes "Bereit." with `de_male` at boot so Voxtral is resident before the first real request.

All TTS calls from Hermes go through `localai-helper:8001/v1/tts/synthesize` which orchestrates rewrite + chunking + synthesis + post-processing. Hermes does not call mlx-audio directly for TTS.

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

First run downloads ~2 GB of Python deps (mlx-audio + transformers). Parakeet (1.2 GB) downloads on first STT request, Voxtral (2.5 GB) on first TTS request — both cached at `~/.cache/huggingface/hub/` and warmed by the launchd wrapper at next boot.

## Verify

```bash
# Server reachable
curl http://127.0.0.1:8000/v1/models

# Transcribe
curl -X POST http://127.0.0.1:8000/v1/audio/transcriptions \
  -F "model=mlx-community/parakeet-tdt-0.6b-v3" \
  -F "file=@audio.m4a"

# Synthesize (Voxtral)
curl -X POST http://127.0.0.1:8000/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model":"mlx-community/Voxtral-4B-TTS-2603-mlx-4bit","input":"Hallo zusammen.","voice":"de_male","response_format":"mp3"}' \
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
    model: "mlx-community/Voxtral-4B-TTS-2603-mlx-4bit"
    voice: ""
    base_url: "http://127.0.0.1:8001/v1"  # helper, not mlx-audio direct
    api_key: "not-needed"
```

TTS calls from Hermes go through `localai-helper:8001` (`tts_tool.py` → `POST /v1/tts/synthesize`). The helper manages language detection, Haiku rewrites, paragraph-aware chunking, Voxtral synthesis at `:8000`, and MP3 encoding. Voice presets and language mapping are in `helper/routes/tts.py`.

## Rejected Alternatives

| Tool | Why |
|-|-|
| Ollama (Gemma 4 local) | Cloud Sonnet 4.6 cheaper than M2 Max electricity for light use; better agent quality |
| LocalAI (mudler) | llama.cpp not MLX (40-90% slower) |
| WhisperKit | `serve` unreliable, fragile Swift build |
| whisper-large-v3-turbo | Replaced by Parakeet v3 — 25% smaller, ~3× faster, similar accuracy |
| Qwen3-TTS VoiceDesign | English-accented German output ("Hasselhoff effect") — VoiceDesign instruct path is Chinese/English-only by design |
| Qwen3-TTS Base + voice clone | Better German quality but requires server-accessible WAV reference; Voxtral preset is simpler |
| F5-TTS-German | Documented umlaut bug requiring Ä→ae preprocessing; fragile for production |
| Piper TTS (thorsten-de) | Native German phonetics but robotic; replaced by Voxtral |

**Last model research:** 2026-04-28
