---
name: localai
description: Manage the local AI stack (LLM + TTS + STT) on the dedicated M2 Max MacBook — setup, update models, monitor, troubleshoot
model: haiku
---

# LocalAI Stack Management

Manages the always-on local AI server stack on the dedicated M2 Max 32GB MacBook.

**Full documentation:** Read `~/SourceRoot/claude-local/localai/README.md` first.

## Machine Guard

Before executing any command:
```bash
chip=$(sysctl -n machdep.cpu.brand_string 2>/dev/null)
if [[ "$chip" != *"M2 Max"* ]]; then
  echo "ERROR: This skill is for the M2 Max AI server only (detected: $chip)"
  exit 1
fi
```

## Stack Overview

| Component | Service | Port |
|-|-|-|
| Ollama (Gemma 4 26B MoE) | com.localai.ollama | 11434 |
| mlx-audio (TTS + STT) | com.localai.audio | 8000 |
| Monitoring (snapshot.sh) | com.localai.monitor | — |
| Caddy (HTTPS proxy) | homebrew.mxcl.caddy | 443 |

**Models (lazy-loaded per request):**
- STT fast: `mlx-community/whisper-large-v3-turbo-asr-fp16`
- STT quality: `mlx-community/whisper-large-v3-asr-fp16`
- TTS fast: `mlx-community/Kokoro-82M-bf16` (named voices, e.g. `af_heart`)
- TTS quality: `mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16` (voice via `instruct` param)

## Commands

Parse the user's intent from ARGUMENTS and execute the matching section below.

### `/localai setup`

Full setup from scratch. Execute interactively, confirming each step.

**Step 1 — Prerequisites:**
```bash
system_profiler SPHardwareDataType | grep -E "Chip|Memory"
which brew ollama tailscale
```

**Step 2 — Install components:**
```bash
brew install ollama
brew install charlie0129/homebrew-tap/batt
brew install ffmpeg  # required for mp3/flac encoding in mlx-audio
uv tool install "mlx-audio[all]"
uv pip install --python ~/.local/share/uv/tools/mlx-audio/bin/python3 "setuptools<81"
uv pip install --python ~/.local/share/uv/tools/mlx-audio/bin/python3 python-multipart
# Kokoro TTS deps (misaki >=0.9 breaks espeakng_loader API)
uv pip install --python ~/.local/share/uv/tools/mlx-audio/bin/python3 "misaki[en]<0.9" num2words phonemizer espeakng_loader spacy
uv pip install --python ~/.local/share/uv/tools/mlx-audio/bin/python3 en-core-web-sm@https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl
```

**Step 3 — Pull models:**
```bash
ollama pull gemma4:26b
ollama create gemma4-agent -f ~/SourceRoot/claude-local/localai/Modelfile.gemma4
# Audio models auto-download on first request
```

**Step 4 — Power management:**
```bash
sudo pmset -a sleep 0 displaysleep 0 disksleep 0
sudo batt limit 70
```

**Step 5 — Monitoring database:**
```bash
bash ~/SourceRoot/claude-local/localai/snapshot.sh
sqlite3 ~/SourceRoot/claude-local/localai/monitor.db "SELECT COUNT(*) FROM snapshots;"
```

**Step 6 — Caddy config:**
Read `~/SourceRoot/claude-local/config/Caddyfile` for the LocalAI block.
Generate certs: `tailscale cert <hostname>.ts.net`
Reload: `caddy-reload`

**Step 7 — Launchd services:**

`com.localai.ollama.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.localai.ollama</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/ollama</string>
    <string>serve</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OLLAMA_HOST</key><string>0.0.0.0:11434</string>
    <key>OLLAMA_KEEP_ALIVE</key><string>30m</string>
    <key>OLLAMA_MAX_LOADED_MODELS</key><string>3</string>
    <key>OLLAMA_FLASH_ATTENTION</key><string>0</string>
    <key>OLLAMA_KV_CACHE_TYPE</key><string>q8_0</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/ollama.log</string>
  <key>StandardErrorPath</key><string>/tmp/ollama.err</string>
</dict>
</plist>
```

`com.localai.audio.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.localai.audio</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/johannes.krumm/.local/bin/mlx_audio.server</string>
    <string>--host</string>
    <string>0.0.0.0</string>
    <string>--port</string>
    <string>8000</string>
    <string>--log-dir</string>
    <string>/tmp/mlx-audio-logs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>WorkingDirectory</key><string>/tmp</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/audio.log</string>
  <key>StandardErrorPath</key><string>/tmp/audio.err</string>
</dict>
</plist>
```

`com.localai.monitor.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.localai.monitor</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/johannes.krumm/SourceRoot/claude-local/localai/snapshot.sh</string>
  </array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>/tmp/localai-monitor.err</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.localai.ollama.plist
launchctl load ~/Library/LaunchAgents/com.localai.audio.plist
launchctl load ~/Library/LaunchAgents/com.localai.monitor.plist
```

**Step 8 — Verify:** Run `/localai status`.

---

### `/localai status`

```bash
echo "=== Ollama ==="
curl -sf localhost:11434/api/tags | jq -r '.models[] | "\(.name) — \(.size / 1073741824 | floor)GB"' 2>/dev/null || echo "Ollama: DOWN"
curl -sf localhost:11434/api/ps | jq -r '.models[] | "\(.name) — VRAM: \(.size_vram / 1073741824 * 100 | floor / 100)GB — \(.processor)"' 2>/dev/null || echo "No models loaded"

echo ""
echo "=== Audio (mlx-audio — TTS + STT) ==="
curl -sf localhost:8000/v1/models | jq -r '.data[] | .id' 2>/dev/null && echo "Audio server: UP" || echo "Audio server: DOWN"

echo ""
echo "=== System ==="
memory_pressure | head -1
batt status 2>/dev/null || echo "batt not installed"
pmset -g | grep -E "sleep |displaysleep"

echo ""
echo "=== Monitoring DB ==="
sqlite3 ~/SourceRoot/claude-local/localai/monitor.db \
  "SELECT COUNT(*) || ' snapshots, oldest: ' || MIN(ts) || ', newest: ' || MAX(ts) FROM snapshots;"

echo ""
echo "=== Tailscale ==="
tailscale status --self | head -1
```

---

### `/localai update`

**Phase 1 — Upgrade stack:**
```bash
brew upgrade ollama
ollama pull gemma4:26b
ollama create gemma4-agent -f ~/SourceRoot/claude-local/localai/Modelfile.gemma4
uv tool upgrade mlx-audio
uv pip install --python ~/.local/share/uv/tools/mlx-audio/bin/python3 "setuptools<81"
uv pip install --python ~/.local/share/uv/tools/mlx-audio/bin/python3 python-multipart
uv pip install --python ~/.local/share/uv/tools/mlx-audio/bin/python3 "misaki[en]<0.9" num2words phonemizer espeakng_loader spacy
uv pip install --python ~/.local/share/uv/tools/mlx-audio/bin/python3 en-core-web-sm@https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl

# Check Caddy cloudflare module survived brew upgrade
caddy list-modules 2>/dev/null | grep -q cloudflare || echo "WARNING: Caddy cloudflare module missing — rebuild with xcaddy"

launchctl kickstart -k gui/$(id -u)/com.localai.ollama
launchctl kickstart -k gui/$(id -u)/com.localai.audio
```

**Phase 2 — Research better models:**
Use `/research` to check for newer models in each category:
1. **LLM:** Compare vs Gemma 4 26B-A4B — must fit ~20 GB, need tool use
2. **TTS fast:** Compare vs Kokoro 82M — must be small, multilingual
3. **TTS quality:** Compare vs Qwen3-TTS 1.7B — voice cloning, streaming
4. **STT:** Compare vs Whisper Large v3 Turbo — OpenAI API compatible

Update README.md with findings and date.

---

### `/localai swap-model <component> <model>`

Components: `llm`, `tts`, `stt`.

**LLM:** `ollama pull <model>`, update Modelfile, `ollama create`.

**TTS/STT:** Models are per-request — just use the new model name in API calls. Pre-load:
```bash
curl -X POST localhost:8000/v1/models -H 'Content-Type: application/json' -d '{"model":"<model-id>"}'
```

**Note:** Qwen3-TTS VoiceDesign uses `instruct` parameter (natural language voice description), not named `voice` presets.

Update README.md after any swap.

---

### `/localai monitor`

```bash
# Recent snapshots
sqlite3 -header -column ~/SourceRoot/claude-local/localai/monitor.db \
  "SELECT ts, mem_used_gb, battery_pct, ollama_vram_gb, tts_up, stt_up
   FROM snapshots ORDER BY ts DESC LIMIT 20;"

# Daily averages
sqlite3 -header -column ~/SourceRoot/claude-local/localai/monitor.db \
  "SELECT date(ts) as day, ROUND(AVG(mem_used_gb),1) as avg_mem,
          ROUND(AVG(battery_pct),0) as avg_batt,
          SUM(CASE WHEN tts_up=0 OR stt_up=0 THEN 1 ELSE 0 END) as down
   FROM snapshots WHERE ts > datetime('now','-7 days','localtime')
   GROUP BY date(ts) ORDER BY day DESC;"

# Live
watch -n 5 'ollama ps 2>/dev/null; echo ""; memory_pressure | head -3'
```

---

### `/localai stop` / `/localai start`

```bash
# Stop all
launchctl unload ~/Library/LaunchAgents/com.localai.ollama.plist
launchctl unload ~/Library/LaunchAgents/com.localai.audio.plist
launchctl unload ~/Library/LaunchAgents/com.localai.monitor.plist

# Start all
launchctl load ~/Library/LaunchAgents/com.localai.ollama.plist
launchctl load ~/Library/LaunchAgents/com.localai.audio.plist
launchctl load ~/Library/LaunchAgents/com.localai.monitor.plist
```

---

## Troubleshooting

**OOM / model won't load:**
- `ollama ps` — check if other models are loaded
- `curl -X DELETE localhost:8000/v1/models -d '{"model":"..."}'` — unload audio models
- Reduce Modelfile `num_ctx` to 32768

**Slow inference:**
- Verify `OLLAMA_FLASH_ATTENTION=0` in plist (Gemma 4 MoE incompatible with FA)
- Check `memory_pressure` — if "critical", models are swapping

**mlx-audio won't start:**
- Check `tail -50 /tmp/audio.err`
- `pkg_resources` error → `uv pip install --python ~/.local/share/uv/tools/mlx-audio/bin/python3 "setuptools<81"`
- Port conflict → `lsof -i :8000`

**Kokoro TTS errors:**
- `No module named 'misaki'/'num2words'/'phonemizer'/'espeakng_loader'/'spacy'` → re-run Kokoro deps from setup step 2
- `EspeakWrapper.set_data_path` AttributeError → pin `misaki<0.9`
- `spacy.cli.download` fails → install model directly: `uv pip install --python ... en-core-web-sm@https://...`
- `ffmpeg not found` → ensure plist has `PATH` env var including `/opt/homebrew/bin`; use `response_format: wav` as workaround

**MacWhisper "incorrect format" error:**
- Ensure using Whisper model (not Parakeet — incompatible response format)
- Ensure going through Caddy (rewrites Content-Type to application/json)
- Base URL: `https://<ts-hostname>.ts.net` (not localhost)

**Caddy cloudflare module missing after brew upgrade:**
- Rebuild: `xcaddy build --with github.com/caddy-dns/cloudflare`
- Replace: `sudo cp caddy /opt/homebrew/Cellar/caddy/*/bin/caddy`
