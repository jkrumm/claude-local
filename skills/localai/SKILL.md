---
name: localai
description: Manage the local AI stack (LLM + TTS + STT) on the dedicated M2 Max MacBook — setup, update models, monitor, troubleshoot
model: haiku
---

# LocalAI Stack Management

Manages the always-on local AI server stack on the dedicated M2 Max 32GB MacBook.

**Full documentation:** Read `~/SourceRoot/claude-local/localai/README.md` first — it contains architecture decisions, memory budget, model selection reasoning, and all component details.

## Machine Guard

This skill only applies to the dedicated AI MacBook. Before executing any command, verify:

```bash
chip=$(sysctl -n machdep.cpu.brand_string 2>/dev/null)
if [[ "$chip" != *"M2 Max"* ]]; then
  echo "ERROR: This skill is for the M2 Max AI server only (detected: $chip)"
  exit 1
fi
```

If not on the right machine, tell the user and stop.

## Auth & Secrets

**No auth needed.** All services run without API keys or tokens. Tailscale is the only access control layer — only devices on the tailnet can reach the endpoints via Caddy. No 1Password secrets, no env vars.

If the user later wants to add auth (e.g., shared tailnet), add `basicauth` directive to the Caddy block.

## Commands

Parse the user's intent from ARGUMENTS and execute the matching section below.

### `/localai setup`

Full setup from scratch. Execute interactively, confirming each step.

**Step 1 — Prerequisites:**
```bash
system_profiler SPHardwareDataType | grep -E "Chip|Memory"
# Expect: Apple M2 Max, 32 GB

which brew ollama tailscale
xcode-select -p  # needed for WhisperKit Swift build
```

**Step 2 — Install components:**
```bash
# Ollama (LLM runtime — MLX backend on Apple Silicon)
brew install ollama

# batt (battery charge limiter — Apple Silicon native)
brew install charlie0129/homebrew-tap/batt

# mlx-audio (TTS — native MLX for Apple Silicon)
uv tool install mlx-audio

# WhisperKit (STT — Neural Engine, not GPU)
brew install argmaxinc/tap/whisperkit-cli
# Fallback if not in tap:
# git clone https://github.com/argmaxinc/WhisperKit.git
# cd WhisperKit && BUILD_ALL=1 swift build --product whisperkit-cli
```

**Step 3 — Pull models:**
```bash
ollama pull gemma4:26b
ollama create gemma4-agent -f ~/SourceRoot/claude-local/localai/Modelfile.gemma4
# TTS + STT models auto-download on first serve
```

**Step 4 — Power management:**
```bash
sudo pmset -c sleep 0 displaysleep 0 disksleep 0 standby 0 \
  autopoweroff 0 hibernatemode 0 powernap 0 proximitywake 0 \
  tcpkeepalive 1 womp 1
sudo batt limit 70
```

**Step 5 — Monitoring database:**
The `snapshot.sh` script auto-creates the schema on first run. Verify it works:
```bash
bash ~/SourceRoot/claude-local/localai/snapshot.sh
sqlite3 ~/SourceRoot/claude-local/localai/monitor.db "SELECT COUNT(*) FROM snapshots;"
```

**Step 6 — Caddy config:**
Read current Caddyfile at `~/SourceRoot/claude-local/config/Caddyfile`.
Add the Tailscale reverse proxy block from `localai/README.md`.
Run `tailscale cert <hostname>.ts.net` to generate certs.
Reload: `caddy-reload`

**Step 7 — Launchd services:**
Create plist files in `~/Library/LaunchAgents/` for auto-start:

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
    <key>OLLAMA_HOST</key><string>0.0.0.0</string>
    <key>OLLAMA_KEEP_ALIVE</key><string>30m</string>
    <key>OLLAMA_MAX_LOADED_MODELS</key><string>3</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/ollama.log</string>
  <key>StandardErrorPath</key><string>/tmp/ollama.err</string>
</dict>
</plist>
```

`com.localai.tts.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.localai.tts</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/johannes.krumm/.local/bin/mlx-audio</string>
    <string>serve</string>
    <string>--model</string>
    <string>mlx-community/Qwen3-TTS-1.7B</string>
    <string>--host</string>
    <string>0.0.0.0</string>
    <string>--port</string>
    <string>8000</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/tts.log</string>
  <key>StandardErrorPath</key><string>/tmp/tts.err</string>
</dict>
</plist>
```

`com.localai.stt.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.localai.stt</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/whisperkit-cli</string>
    <string>serve</string>
    <string>--host</string>
    <string>0.0.0.0</string>
    <string>--port</string>
    <string>50060</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/stt.log</string>
  <key>StandardErrorPath</key><string>/tmp/stt.err</string>
</dict>
</plist>
```

`com.localai.monitor.plist` (snapshot every 5 minutes):
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

Load all:
```bash
launchctl load ~/Library/LaunchAgents/com.localai.ollama.plist
launchctl load ~/Library/LaunchAgents/com.localai.tts.plist
launchctl load ~/Library/LaunchAgents/com.localai.stt.plist
launchctl load ~/Library/LaunchAgents/com.localai.monitor.plist
```

**Step 8 — Verify:**
Run `/localai status` (see below).

---

### `/localai status`

Quick health check of all components.

```bash
echo "=== Ollama ==="
curl -sf localhost:11434/api/tags | jq -r '.models[] | "\(.name) — \(.size / 1073741824 | floor)GB"' 2>/dev/null || echo "Ollama: DOWN"
curl -sf localhost:11434/api/ps | jq -r '.models[] | "\(.name) — VRAM: \(.size_vram / 1073741824 * 100 | floor / 100)GB — \(.processor)"' 2>/dev/null || echo "No models loaded"

echo ""
echo "=== TTS (Qwen3-TTS) ==="
curl -sf localhost:8000/health && echo " OK" || echo "TTS: DOWN"

echo ""
echo "=== STT (WhisperKit) ==="
curl -sf localhost:50060/health && echo " OK" || echo "STT: DOWN"

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

Two-phase update: (1) upgrade tools and pull latest model versions, (2) research if better models exist.

**Phase 1 — Upgrade current stack:**
```bash
brew upgrade ollama
ollama pull gemma4:26b
ollama create gemma4-agent -f ~/SourceRoot/claude-local/localai/Modelfile.gemma4
uv tool upgrade mlx-audio
brew upgrade argmaxinc/tap/whisperkit-cli

# Restart services
launchctl kickstart -k gui/$(id -u)/com.localai.ollama
launchctl kickstart -k gui/$(id -u)/com.localai.tts
launchctl kickstart -k gui/$(id -u)/com.localai.stt
```

**Phase 2 — Research better models:**

Use the `/research` skill to investigate whether better models have been released since the current selection. Research each category independently:

1. **LLM:** `/research "best open source LLM for Apple Silicon M2 Max 32GB <current-year> — compare current leaders vs Gemma 4 26B-A4B, must fit 18-20GB Q4, need 64K context, tool use"`
2. **TTS:** `/research "best open source TTS model <current-year> Apple Silicon MLX — compare vs Qwen3-TTS 1.7B, need streaming, OpenAI API, high quality"`
3. **STT:** `/research "best open source STT model <current-year> Apple Silicon Neural Engine — compare vs WhisperKit Large v3 Turbo, need OpenAI API, low WER"`

Present findings in a comparison table. Recommend a swap only if the new model is clearly better (not just marginally). If recommending a swap, use `/localai swap-model` to execute.

Update the README.md with any new findings (add to the comparison tables, mark date of last research).

---

### `/localai swap-model <component> <model>`

Swap a model for a different one. Components: `llm`, `tts`, `stt`.

**LLM example:** `/localai swap-model llm qwen3.5:27b`
```bash
ollama pull qwen3.5:27b
# Update Modelfile FROM line and recreate
ollama create custom-agent -f updated-modelfile
```

**TTS example:** `/localai swap-model tts orpheus-3b`
Update the `--model` argument in `com.localai.tts.plist` and restart:
```bash
launchctl kickstart -k gui/$(id -u)/com.localai.tts
```

After any swap, update `localai/README.md` model selection tables with the change and reasoning.

---

### `/localai monitor`

Show monitoring data from the SQLite database.

**Recent snapshots:**
```bash
sqlite3 -header -column ~/SourceRoot/claude-local/localai/monitor.db \
  "SELECT ts, mem_used_gb, mem_pressure, battery_pct, ollama_vram_gb, tts_up, stt_up
   FROM snapshots ORDER BY ts DESC LIMIT 20;"
```

**Daily averages (last 7 days):**
```bash
sqlite3 -header -column ~/SourceRoot/claude-local/localai/monitor.db \
  "SELECT date(ts) as day,
          ROUND(AVG(mem_used_gb),1) as avg_mem_gb,
          ROUND(AVG(ollama_vram_gb),1) as avg_vram_gb,
          ROUND(AVG(battery_pct),0) as avg_battery,
          SUM(CASE WHEN tts_up=0 OR stt_up=0 THEN 1 ELSE 0 END) as downtime_samples
   FROM snapshots
   WHERE ts > datetime('now','-7 days','localtime')
   GROUP BY date(ts)
   ORDER BY day DESC;"
```

**Uptime percentage:**
```bash
sqlite3 ~/SourceRoot/claude-local/localai/monitor.db \
  "SELECT 'Ollama: ' || ROUND(100.0 * SUM(CASE WHEN ollama_vram_gb > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) || '%, ' ||
          'TTS: ' || ROUND(100.0 * SUM(tts_up) / COUNT(*), 1) || '%, ' ||
          'STT: ' || ROUND(100.0 * SUM(stt_up) / COUNT(*), 1) || '%'
   FROM snapshots WHERE ts > datetime('now','-30 days','localtime');"
```

**Live view:**
```bash
watch -n 5 'ollama ps 2>/dev/null; echo ""; memory_pressure | head -3; echo ""; batt status 2>/dev/null'
```

**Database retention:** The snapshot.sh script auto-prunes entries older than 90 days.

---

### `/localai stop` / `/localai start`

```bash
# Stop all
launchctl unload ~/Library/LaunchAgents/com.localai.ollama.plist
launchctl unload ~/Library/LaunchAgents/com.localai.tts.plist
launchctl unload ~/Library/LaunchAgents/com.localai.stt.plist
launchctl unload ~/Library/LaunchAgents/com.localai.monitor.plist

# Start all
launchctl load ~/Library/LaunchAgents/com.localai.ollama.plist
launchctl load ~/Library/LaunchAgents/com.localai.tts.plist
launchctl load ~/Library/LaunchAgents/com.localai.stt.plist
launchctl load ~/Library/LaunchAgents/com.localai.monitor.plist
```

---

## Troubleshooting

**Model won't load / OOM:**
- Check `ollama ps` — another model may be hogging memory
- Reduce `OLLAMA_MAX_LOADED_MODELS` to 2
- Swap Qwen3-TTS 1.7B → 0.6B (`mlx-community/Qwen3-TTS-0.6B`)
- Reduce context: edit Modelfile `num_ctx 32768`

**Slow inference:**
- Verify MLX backend: `ollama ps` should show 100% GPU
- Check memory pressure: `memory_pressure` — if "critical", models are swapping
- Kill other apps: this is a dedicated machine

**Service won't start:**
- Check logs: `tail -50 /tmp/ollama.err`
- Verify binary paths in plists match actual install locations
- Check port conflicts: `lsof -i :11434` / `:8000` / `:50060`

**Tailscale can't reach services:**
- Verify services bind to `0.0.0.0` (not `127.0.0.1`)
- Check Caddy config and reload: `caddy-reload`
- Verify Tailscale status: `tailscale status`

**Monitoring DB missing data:**
- Check: `launchctl list | grep localai.monitor`
- Check logs: `cat /tmp/localai-monitor.err`
- Verify script: `bash ~/SourceRoot/claude-local/localai/snapshot.sh`
