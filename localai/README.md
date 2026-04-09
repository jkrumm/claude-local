# LocalAI Stack — M2 Max 32GB Dedicated Server

Dedicated MacBook M2 Max (12 CPU, 30 GPU, 32GB unified memory, Metal 4) running as an always-on local AI server. All models accessible via OpenAI-compatible API over Tailscale.

## Architecture

```
Tailscale network → <ts-hostname>.ts.net → Caddy (path routing, HTTPS)
  /v1/chat/*               → Ollama :11434   (LLM)
  /v1/audio/speech*         → TTS server :8000 (TTS)
  /v1/audio/transcriptions* → WhisperKit :50060 (STT)
```

## Model Selection (April 2026)

### LLM: Gemma 4 26B-A4B Q4_K_M via Ollama 0.19 MLX

| Considered | Decision | Reason |
|-|-|-|
| Gemma 4 31B Dense | Rejected | KV cache at 64K context pushes total to ~30-33GB — too tight with TTS+STT loaded. Slower inference (10-15 tok/s vs 50-80 tok/s for MoE) hurts agentic workflows |
| **Gemma 4 26B-A4B MoE** | **Selected** | 97% of 31B quality (Elo 1441 vs 1452). Only 3.8B params active per token = fast inference. ~18GB Q4 + ~3GB KV at 64K = 21GB, leaving room for TTS+STT |
| Gemma 4 E4B/E2B | Rejected | Too small for agent-quality reasoning |

**Why Gemma 4:** Apache 2.0, multimodal (text+vision), 256K max context, tool use/function calling trained natively, top-3 open model on LMArena (April 2026).

**Why 26B-A4B over 31B:** For Hermes Agent (64K+ context, many tool calls), the MoE's speed advantage compounds across agentic loops. The 3% quality gap is invisible in practice. Memory headroom means all models stay loaded simultaneously.

**Runtime: Ollama 0.19 MLX** — 57% faster prefill, 93% faster decode vs llama.cpp Metal. OpenAI-compatible `/v1/` API. Model-agnostic — swap with `ollama pull`.

### TTS: Qwen3-TTS 1.7B via mlx-audio

| Considered | MOS/Quality | Latency | Memory | Reason |
|-|-|-|-|-|
| Kokoro 82M | 4.5 MOS | <300ms | 0.3 GB | Too low quality for "best possible" |
| Orpheus 3B | 4.6 MOS | 200ms | 2 GB Q4 | Great but English-only, not MLX-native, older (Mar 2025) |
| Sesame CSM 1B | 4.7 MOS | Slow | 8 GB | Too slow for real-time, too much memory |
| **Qwen3-TTS 1.7B** | **SOTA** | **97ms** | **4.2 GB** | Beats ElevenLabs on Seed-TTS benchmark. Native MLX. 10 languages. Voice cloning |
| Qwen3-TTS 0.6B | Good | Fast | 2.3 GB | Fallback if memory is tight |

**Why Qwen3-TTS:** State-of-the-art as of Feb 2026 — lowest WER on Seed-TTS benchmark, beats commercial APIs (ElevenLabs, MiniMax) in speaker similarity across 10 languages. 97ms first-packet streaming. Native MLX (purpose-built for Apple Silicon). Voice cloning from 3-second reference. Emotion/tone/prosody control.

**Why not Orpheus:** English-only, runs via llama.cpp (not native MLX), older model overtaken by Qwen3-TTS on benchmarks. Still a valid fallback.

### STT: WhisperKit Large v3 Turbo

| Considered | WER | Runs On | API Server | Reason |
|-|-|-|-|-|
| Moonshine v2 | 6.65% | MLX (GPU) | No | Accuracy too low |
| Parakeet TDT 0.6B v2 | 1.69% | Neural Engine (FluidAudio) | No built-in | Best accuracy but no OpenAI-compatible server |
| **WhisperKit Large v3 Turbo** | **2.2%** | **Neural Engine** | **Built-in `/v1/`** | Best combo of accuracy + API + zero GPU impact |
| Whisper Large v3 (MLX) | ~3% | GPU | Via wrapper | Eats GPU memory, slower |

**Why WhisperKit:** Runs on the Neural Engine — zero GPU memory impact (critical for fitting LLM+TTS on GPU). Built-in OpenAI-compatible server (`/v1/audio/transcriptions`). 2.2% WER with compressed model (0.6GB). Real-time streaming. 99 languages.

**Why not Parakeet v2:** 0.5% better WER but no API server — would need a custom FastAPI wrapper. The engineering cost isn't worth the marginal accuracy gain.

## Memory Budget

| Component | Memory | Hardware |
|-|-|-|
| macOS (dedicated, minimal) | ~4 GB | — |
| Gemma 4 26B-A4B Q4_K_M | ~18 GB | GPU (Metal/MLX) |
| KV cache @ 64K context | ~2-3 GB | GPU |
| Qwen3-TTS 1.7B (MLX) | ~4.2 GB | GPU (Metal/MLX) |
| WhisperKit Large v3 Turbo | ~0.6 GB | Neural Engine |
| **Total** | **~28.8-29.8 GB** | |
| **Headroom** | **~2.2-3.2 GB** | |

Single user — models don't all peak simultaneously. WhisperKit on Neural Engine doesn't touch GPU. Ollama can unload LLM during extended TTS sessions if needed (`OLLAMA_KEEP_ALIVE`).

**Fallback if memory is tight:** Swap Qwen3-TTS 1.7B → 0.6B (saves 1.9GB).

## Components

### 1. Ollama (LLM)

```bash
# Install
brew install ollama

# Pull model
ollama pull gemma4:26b

# Custom Modelfile with 64K context
ollama create gemma4-agent -f localai/Modelfile.gemma4

# Serve (bind to all interfaces for Tailscale)
OLLAMA_HOST=0.0.0.0 ollama serve
```

**Key config:**
- `OLLAMA_HOST=0.0.0.0` — accept connections from Tailscale
- `OLLAMA_KEEP_ALIVE=30m` — keep model loaded for 30min after last request
- `OLLAMA_MAX_LOADED_MODELS=3` — headroom for loading test models alongside main LLM

### 2. Qwen3-TTS via mlx-audio (TTS)

```bash
# Install
uv tool install mlx-audio

# Or in a venv
uv venv localai/.venv && source localai/.venv/bin/activate
uv pip install mlx-audio

# Serve with OpenAI-compatible API
mlx-audio serve --model mlx-community/Qwen3-TTS-1.7B --host 0.0.0.0 --port 8000
```

Endpoint: `POST /v1/audio/speech`

### 3. WhisperKit (STT)

```bash
# Install (Swift package — requires Xcode CLI tools)
brew install argmaxinc/tap/whisperkit-cli

# Or build from source (BUILD_ALL=1 enables server support)
git clone https://github.com/argmaxinc/WhisperKit.git
cd WhisperKit && BUILD_ALL=1 swift build --product whisperkit-cli

# Serve with OpenAI-compatible API
whisperkit-cli serve --host 0.0.0.0 --port 50060
```

Endpoint: `POST /v1/audio/transcriptions`

### 4. Power Management

```bash
# Never sleep (AC power)
sudo pmset -c sleep 0 displaysleep 0 disksleep 0 standby 0 \
  autopoweroff 0 hibernatemode 0 powernap 0 proximitywake 0 \
  tcpkeepalive 1 womp 1

# Battery charge limit at 70%
brew install charlie0129/homebrew-tap/batt
sudo batt limit 70

# Verify
pmset -g
batt status
```

**Clamshell mode:** Requires HDMI dummy plug (~$8 Amazon) for lid-closed operation on Apple Silicon.

### 5. Caddy (Reverse Proxy)

Add to existing Caddyfile (`config/Caddyfile`):

```caddyfile
# LocalAI endpoints — accessible over Tailscale
# Cert: tailscale cert <hostname>.ts.net
<hostname>.ts.net {
  tls /path/to/ts-cert.pem /path/to/ts-key.pem

  handle /v1/chat/* {
    reverse_proxy localhost:11434
  }
  handle /v1/models* {
    reverse_proxy localhost:11434
  }
  handle /v1/audio/speech* {
    reverse_proxy localhost:8000
  }
  handle /v1/audio/transcriptions* {
    reverse_proxy localhost:50060
  }
}
```

Generate Tailscale certs: `tailscale cert <hostname>.ts.net`

### 6. Launchd (Auto-Start)

Services auto-start on boot via launchd plists in `~/Library/LaunchAgents/`:

- `com.localai.ollama.plist` — Ollama serve (binds 0.0.0.0, KEEP_ALIVE=30m)
- `com.localai.tts.plist` — mlx-audio TTS server (:8000)
- `com.localai.stt.plist` — WhisperKit STT server (:50060)
- `com.localai.monitor.plist` — Snapshot script every 5 minutes → SQLite

The `/localai setup` skill creates all plists with correct paths and loads them.

## Client Usage

From any device on your Tailscale network:

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://<hostname>.ts.net/v1",
    api_key="unused"  # no auth needed on tailnet
)

# Chat
response = client.chat.completions.create(
    model="gemma4-agent",
    messages=[{"role": "user", "content": "Hello"}]
)

# TTS
audio = client.audio.speech.create(
    model="qwen3-tts-1.7b",
    input="Hello, how are you?",
    voice="Chelsie"
)

# STT
transcript = client.audio.transcriptions.create(
    model="whisper-large-v3-turbo",
    file=open("audio.mp3", "rb")
)
```

## Monitoring

### SQLite Database (Historical)

`localai/monitor.db` — snapshots every 5 minutes via `localai/snapshot.sh` (launchd timer). 90-day retention, auto-pruned.

**Schema:**
- `snapshots` — memory usage, memory pressure, battery %, VRAM, service up/down (every 5 min)

**Queries via `/localai monitor`:**
```bash
# Recent snapshots
sqlite3 -header -column localai/monitor.db \
  "SELECT ts, mem_used_gb, mem_pressure, battery_pct, ollama_vram_gb, tts_up, stt_up
   FROM snapshots ORDER BY ts DESC LIMIT 20;"

# Daily averages (last 7 days)
sqlite3 -header -column localai/monitor.db \
  "SELECT date(ts) as day, ROUND(AVG(mem_used_gb),1) as avg_mem,
          ROUND(AVG(battery_pct),0) as avg_batt,
          SUM(CASE WHEN tts_up=0 OR stt_up=0 THEN 1 ELSE 0 END) as downtime
   FROM snapshots WHERE ts > datetime('now','-7 days','localtime')
   GROUP BY date(ts) ORDER BY day DESC;"

# 30-day uptime percentage
sqlite3 localai/monitor.db \
  "SELECT ROUND(100.0 * SUM(tts_up) / COUNT(*), 1) as tts_uptime,
          ROUND(100.0 * SUM(stt_up) / COUNT(*), 1) as stt_uptime
   FROM snapshots WHERE ts > datetime('now','-30 days','localtime');"
```

### Live Commands
```bash
ollama ps                                                      # loaded models + VRAM
curl -s localhost:11434/api/ps | jq '.models[] | {name, size_vram, processor}'
memory_pressure | head -1                                      # system memory
batt status                                                    # battery
sudo powermetrics --samplers gpu_power -i 1000 -n 1            # GPU power
curl -s localhost:8000/health                                  # TTS health
curl -s localhost:50060/health                                 # STT health
```

## Machine Scope

This stack is specific to the dedicated M2 Max MacBook. The `localai/` directory lives in claude-local (which is on multiple machines) but the `/localai` skill checks hardware before executing — it refuses to run on non-M2-Max machines.

Other machines with claude-local see the documentation but don't activate the services.

## Auth & Secrets

**No authentication required.** Tailscale is the sole access control layer:
- Ollama, mlx-audio, WhisperKit all serve without API keys
- Only devices on the Tailscale network can reach the Caddy endpoints
- No 1Password secrets, no env vars, no tokens

To add auth later (e.g., if sharing tailnet): add `basicauth` to the Caddy block.

## Updating & Model Research

Run `/localai update` periodically (every few weeks). It does two things:

1. **Upgrade tools + pull latest model versions** — brew upgrade, ollama pull, uv upgrade
2. **Research if better models exist** — uses `/research` skill to web-search for newer models that beat the current selection. Compares benchmarks, checks Apple Silicon compatibility and memory fit, and recommends swaps only when clearly better.

After research, the README model selection tables are updated with findings and the date of last review.

**Last model research:** 2026-04-09 (initial selection)

## Swapping Models

The stack is model-agnostic. To swap any component:

**LLM:** `ollama pull <new-model>` and update Modelfile or use directly. Caddy routing doesn't change.

**TTS:** Change the `--model` flag in the mlx-audio serve command. Any model supported by mlx-audio works (Orpheus, Kokoro, Qwen3-TTS variants).

**STT:** WhisperKit supports multiple model sizes. Parakeet can be swapped in if a server wrapper is available.

## Rejected Alternatives

| Tool | Why Rejected |
|-|-|
| LocalAI (mudler) | Uses llama.cpp not MLX (40-90% slower). TTS/STT model selection limited (Piper, not Qwen3-TTS). Jack-of-all-trades, master of none |
| MetalRT (RunAnywhere) | Requires M3+ (Metal 3.1). Falls back to llama.cpp on M2 Max |
| Docker | Metal GPU passthrough impossible on macOS. All inference must run native |
| Cloudflare Tunnel | Unnecessary — Tailscale + Caddy is simpler and already in use |
| Open WebUI | Not needed — API endpoints only, no web UI required |
| Gemma 4 E2B/E4B for STT | Only models with audio input, but too small (2-4B) for quality STT |

## Gemma 4 Audio Note

Gemma 4 E2B and E4B have native ASR (speech-to-text) but only on those tiny models. The 26B/31B have no audio capability. Gemma has no TTS models at all. Dedicated TTS/STT models remain necessary.
