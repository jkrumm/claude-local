#!/bin/bash
# Monitoring snapshot — runs every 5 minutes via launchd
# Writes system + service state to SQLite for historical analysis
# Retention: 90 days auto-pruned

DB="$HOME/SourceRoot/claude-local/localai/monitor.db"

# Ensure schema exists (idempotent)
sqlite3 "$DB" <<'SQL'
CREATE TABLE IF NOT EXISTS snapshots (
  ts             TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime')),
  mem_used_gb    REAL,
  mem_pressure   TEXT,
  battery_pct    INTEGER,
  battery_charging INTEGER,
  ollama_models  TEXT,
  ollama_vram_gb REAL,
  tts_up         INTEGER,
  stt_up         INTEGER
);
SQL

# Collect metrics (vm_stat values have trailing periods — strip with gsub)
mem_used_gb=$(vm_stat | awk '/Pages active|Pages wired/ {gsub(/\./,"",$NF); sum += $NF} END {printf "%.1f", sum * 4096 / 1073741824}')
mem_pressure=$(memory_pressure 2>/dev/null | head -1)
battery_pct=$(pmset -g batt | grep -o '[0-9]*%' | tr -d '%')
battery_charging=$(pmset -g batt | grep -c 'AC Power')

# Ollama state
ollama_models=$(curl -sf localhost:11434/api/ps 2>/dev/null | jq -c '[.models[].name]' 2>/dev/null || echo '[]')
ollama_vram_gb=$(curl -sf localhost:11434/api/ps 2>/dev/null | jq '[.models[].size_vram] | add / 1073741824 | . * 100 | floor / 100' 2>/dev/null || echo 0)

# Service health (1=up, 0=down) — single mlx-audio server handles both TTS+STT
audio_up=$(curl -sf localhost:8000/v1/models >/dev/null 2>&1 && echo 1 || echo 0)
tts_up=$audio_up
stt_up=$audio_up

# Insert snapshot (use parameterized-ish approach — single quotes escaped)
mem_pressure_escaped="${mem_pressure//\'/\'\'}"
ollama_models_escaped="${ollama_models//\'/\'\'}"

sqlite3 "$DB" "INSERT INTO snapshots (mem_used_gb, mem_pressure, battery_pct, battery_charging, ollama_models, ollama_vram_gb, tts_up, stt_up) VALUES (${mem_used_gb:-0}, '${mem_pressure_escaped}', ${battery_pct:-0}, ${battery_charging:-0}, '${ollama_models_escaped}', ${ollama_vram_gb:-0}, ${tts_up:-0}, ${stt_up:-0});"

# Prune entries older than 90 days
sqlite3 "$DB" "DELETE FROM snapshots WHERE ts < datetime('now','-90 days','localtime');"
