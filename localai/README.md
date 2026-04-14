# LocalAI Stack — M2 Max 32GB Dedicated Server

Dedicated MacBook M2 Max (12 CPU, 30 GPU, 32GB unified memory) running as an always-on local AI server. All models accessible via OpenAI-compatible API over Tailscale.

## Architecture

```
Tailscale → Caddy (HTTPS, path routing) → backends
  /v1/chat/*               → Ollama :11434        (LLM)
  /v1/audio/speech*         → mlx-audio :8000      (TTS)
  /v1/audio/transcriptions* → mlx-audio :8000      (STT)
```

## Models

All audio models lazy-load on first request. Specify model per API call — no server restart needed.

### LLM: Gemma 4 26B-A4B MoE

| Model | Arena Elo | Active Params | Memory |
|-|-|-|-|
| **gemma4-agent** (custom, 64K ctx) | 1472 | 3.8B/token | ~18 GB + ~2 GB KV |

Beats Gemini 2.5 Flash (1430), Claude Haiku 4.5 (1427), GPT-4o-mini (1393) on LMArena. Apache 2.0, multimodal, native tool use. MoE architecture = fast inference (50-80 tok/s) with only 3.8B params active per token.

**Ollama config:** Flash Attention disabled (Gemma 4 hybrid attention incompatible, causes ~33% throughput drop). KV cache quantized to q8_0.

### STT: Whisper via mlx-audio

| Use Case | Model | Memory | Speed |
|-|-|-|-|
| Live dictation | `mlx-community/whisper-large-v3-turbo-asr-fp16` | 1.6 GB | Fast |
| Journal / quality | `mlx-community/whisper-large-v3-asr-fp16` | 3 GB | Slower, more accurate |

MacWhisper configured to use the turbo model via custom OpenAI endpoint. Caddy rewrites `Content-Type` to `application/json` for client compatibility.

### TTS: Kokoro + Qwen3-TTS via mlx-audio

| Use Case | Model | Memory | Speed |
|-|-|-|-|
| Quick / interactive | `mlx-community/Kokoro-82M-bf16` | 0.4 GB | <0.3s, 210x RT |
| Podcast / voice cloning | `mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16` | 4.2 GB | 97ms TTFB |

Kokoro: 8 languages, 54 voices, MOS 4.5, Apache 2.0. Qwen3-TTS VoiceDesign: voice design via natural language `instruct` parameter (no named voices — describe the voice instead), streaming.

## Memory Budget

Ollama reports 25 GB GPU-addressable on this machine.

| Scenario | GPU Usage | Headroom |
|-|-|-|
| LLM only (idle) | ~20 GB | 5 GB |
| LLM + Whisper Turbo (dictation) | ~22 GB | 3 GB |
| LLM + Whisper Full + Kokoro | ~23 GB | 2 GB |
| LLM + Qwen3-TTS (quality TTS) | ~24 GB | 1 GB |

Models lazy-load and can be unloaded via `DELETE /v1/models`. Ollama unloads after 30 min idle (`OLLAMA_KEEP_ALIVE`).

## Setup

### 1. Ollama (LLM)

```bash
brew install ollama
ollama pull gemma4:26b
ollama create gemma4-agent -f localai/Modelfile.gemma4
```

### 2. mlx-audio (TTS + STT)

```bash
uv tool install "mlx-audio[all]"
# Fix webrtcvad dependency (setuptools v81+ removed pkg_resources)
uv pip install --python ~/.local/share/uv/tools/mlx-audio/bin/python3 "setuptools<81"
uv pip install --python ~/.local/share/uv/tools/mlx-audio/bin/python3 python-multipart
# Kokoro TTS deps (misaki >=0.9 breaks espeakng_loader API)
uv pip install --python ~/.local/share/uv/tools/mlx-audio/bin/python3 "misaki[en]<0.9" num2words phonemizer espeakng_loader spacy
uv pip install --python ~/.local/share/uv/tools/mlx-audio/bin/python3 en-core-web-sm@https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl
brew install ffmpeg  # required for mp3/flac encoding
```

**Apply local patch** (fixes M4A format rejection — MacWhisper sends M4A for long recordings):
```bash
patch -p1 \
  -d ~/.local/share/uv/tools/mlx-audio/lib/python3.12/site-packages \
  < ~/SourceRoot/claude-local/localai/patches/mlx-audio-m4a-stt.patch
```

**After `uv tool upgrade mlx-audio`:** re-apply the patch above. The upgrade overwrites server.py.

Server binary: `~/.local/bin/mlx_audio.server`

### 3. Caddy (HTTPS reverse proxy)

Custom build with Cloudflare DNS plugin:
```bash
xcaddy build --with github.com/caddy-dns/cloudflare --output /tmp/caddy-custom
sudo cp /tmp/caddy-custom /opt/homebrew/Cellar/caddy/$(caddy version | cut -d' ' -f1 | tr -d v)/bin/caddy
```

Note: `brew upgrade caddy` overwrites the custom binary. Rebuild if `caddy list-modules | grep cloudflare` fails.

### 4. Power management

```bash
# Prevent idle + lid-close sleep (required for headless clamshell operation)
sudo pmset -a sleep 0 displaysleep 0 disksleep 0
sudo pmset -a disablesleep 1

# Battery health — cap charge at 70% since it's always on AC
brew install batt
sudo brew services start batt
sudo batt limit 70
```

### 5. Launchd services

Three plists in `~/Library/LaunchAgents/`:

| Plist | Service | Key Config |
|-|-|-|
| `com.localai.ollama.plist` | Ollama serve | FA=0, q8_0 KV, 0.0.0.0:11434 |
| `com.localai.audio.plist` | mlx-audio server | 0.0.0.0:8000, PATH includes homebrew, log-dir=/tmp/mlx-audio-logs |
| `com.localai.monitor.plist` | snapshot.sh (5 min) | → SQLite monitor.db |

```bash
launchctl load ~/Library/LaunchAgents/com.localai.ollama.plist
launchctl load ~/Library/LaunchAgents/com.localai.audio.plist
launchctl load ~/Library/LaunchAgents/com.localai.monitor.plist
```

### 6. SSH remote access

Enable Remote Login in **System Settings → General → Sharing → Remote Login**, then:

```bash
# Key-only auth — disable password and PAM keyboard-interactive challenge
sudo sh -c 'printf "PubkeyAuthentication yes\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n" > /etc/ssh/sshd_config.d/50-keyonly.conf'
sudo launchctl kickstart -k system/com.openssh.sshd

# Authorize jkrumm SSH key (ed25519 from 1Password)
mkdir -p ~/.ssh && chmod 700 ~/.ssh
op item get "jkrumm" --account tkrumm --fields "public key" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Add to `~/.ssh/config` on client machines:
```
Host localai
    HostName <tailscale-ip>
    User johannes.krumm
```

Tailscale IP: visible via `tailscale status --self`. The `IdentityAgent` 1Password wildcard block handles key auth on the client side.

## API Endpoints

All endpoints OpenAI-compatible. From any Tailscale device:

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://<ts-hostname>.ts.net/v1",
    api_key="unused"  # no auth — Tailscale is the access control
)

# LLM
response = client.chat.completions.create(
    model="gemma4-agent",
    messages=[{"role": "user", "content": "Hello"}]
)

# TTS (fast)
audio = client.audio.speech.create(
    model="mlx-community/Kokoro-82M-bf16",
    input="Hello, how are you?",
    voice="af_heart"
)

# TTS (quality, voice design — describe the voice via extra_body instruct)
audio = client.audio.speech.create(
    model="mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16",
    input="Hello, how are you?",
    voice="",
    extra_body={"instruct": "A warm, clear female voice with medium pitch and natural pace"}
)

# STT (fast)
transcript = client.audio.transcriptions.create(
    model="mlx-community/whisper-large-v3-turbo-asr-fp16",
    file=open("audio.wav", "rb")
)

# STT (quality)
transcript = client.audio.transcriptions.create(
    model="mlx-community/whisper-large-v3-asr-fp16",
    file=open("journal.wav", "rb")
)
```

### MacWhisper Configuration

Custom OpenAI provider in MacWhisper settings:
- **Base URL:** `https://<ts-hostname>.ts.net`
- **Model:** `mlx-community/whisper-large-v3-turbo-asr-fp16`
- **API Key:** any non-empty string (e.g., `unused`)

## Monitoring

SQLite database at `localai/monitor.db` — snapshots every 5 min via `localai/snapshot.sh`. 90-day auto-retention.

```bash
# Recent snapshots
sqlite3 -header -column localai/monitor.db \
  "SELECT ts, mem_used_gb, battery_pct, ollama_vram_gb, tts_up, stt_up
   FROM snapshots ORDER BY ts DESC LIMIT 20;"

# Live
ollama ps                          # loaded models + VRAM
curl -s localhost:8000/v1/models   # audio server + loaded models
memory_pressure | head -1          # system memory
```

## Auth & Secrets

No API keys needed. Tailscale is the sole access control — only tailnet devices reach the Caddy endpoints. To add auth later: add `basicauth` directive to the Caddy block.

## Rejected Alternatives

| Tool | Why Rejected |
|-|-|
| LocalAI (mudler) | llama.cpp not MLX (40-90% slower), limited TTS/STT models |
| MetalRT | Requires M3+ (Metal 3.1) |
| Docker | No Metal GPU passthrough on macOS |
| WhisperKit | `serve` command unreliable, model downloads timed out, fragile Swift build chain |
| Parakeet (STT) | Response format incompatible with OpenAI API clients (returns `sentences` not `segments`) |

**Last model research:** 2026-04-09
