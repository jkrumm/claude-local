#!/usr/bin/env python3
"""
LocalAI management API — control the stack and query monitoring data.
Runs on 127.0.0.1:9001, proxied through Caddy at /api/*.
Tailscale is the sole auth layer — no credentials needed on the API itself.
"""
import collections
import json
import re
import socket
import sqlite3
import subprocess
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 9001
DB_PATH = Path.home() / "SourceRoot/claude-local/localai/monitor.db"
PLIST_DIR = Path.home() / "Library/LaunchAgents"
AI_PLISTS = ["com.localai.ollama", "com.localai.audio", "com.localai.monitor"]

LOG_FILES: dict[str, dict[str, str | None]] = {
    "ollama":  {"out": "/tmp/ollama.log",          "err": "/tmp/ollama.err"},
    "audio":   {"out": "/tmp/audio.log",            "err": "/tmp/audio.err"},
    "api":     {"out": "/tmp/localai-api.log",      "err": "/tmp/localai-api-error.log"},
    "monitor": {"out": None,                         "err": "/tmp/localai-monitor.err"},
}

# ---------------------------------------------------------------------------
# OpenAPI spec (static — served at /api/openapi.json)
# ---------------------------------------------------------------------------

OPENAPI_SPEC = {
    "openapi": "3.0.0",
    "info": {
        "title": "LocalAI Management API",
        "version": "1.1.0",
        "description": (
            "Control the LocalAI stack (Ollama + mlx-audio) and query monitoring data. "
            "Access via Tailscale HTTPS — Tailscale is the sole auth layer, no credentials needed."
        ),
    },
    "servers": [{"url": "/api", "description": "LocalAI M2 Max"}],
    "paths": {
        "/health": {
            "get": {"summary": "Liveness probe", "responses": {"200": {"description": '{"ok": true}'}}}
        },
        "/status": {
            "get": {
                "summary": "Service state — launchd loaded flags + port liveness for Ollama, audio, API",
                "responses": {"200": {"description": "loaded map + *_port booleans"}},
            }
        },
        "/system": {
            "get": {
                "summary": "Live system stats — memory, battery, load avg, memory pressure",
                "responses": {"200": {"description": "mem_used_gb, mem_total_gb, battery_pct, load_avg_*, memory_pressure"}},
            }
        },
        "/models": {
            "get": {
                "summary": "Models currently loaded in Ollama VRAM (proxies /api/ps)",
                "responses": {"200": {"description": "models[], total_vram_gb"}},
            }
        },
        "/logs/{service}": {
            "get": {
                "summary": "Tail log files for a service",
                "parameters": [
                    {"name": "service", "in": "path", "required": True,
                     "schema": {"type": "string", "enum": list(LOG_FILES)},
                     "description": "One of: ollama, audio, api, monitor"},
                    {"name": "lines", "in": "query", "schema": {"type": "integer", "default": 100},
                     "description": "Number of tail lines (max 1000)"},
                ],
                "responses": {
                    "200": {"description": "stdout[] and stderr[] arrays of log lines"},
                    "404": {"description": "Unknown service name"},
                },
            }
        },
        "/snapshots": {
            "get": {
                "summary": "Recent monitoring snapshots from SQLite (5-min cadence)",
                "parameters": [
                    {"name": "limit", "in": "query", "schema": {"type": "integer", "default": 20},
                     "description": "Row count (max 500)"}
                ],
                "responses": {"200": {"description": "Array of snapshot rows ordered newest-first"}},
            }
        },
        "/snapshots/summary": {
            "get": {
                "summary": "Aggregated 24h stats — uptime %, avg VRAM, memory, battery",
                "responses": {"200": {"description": "total_snapshots, audio_uptime_pct, avg_vram_gb, avg_mem_gb, battery_*"}},
            }
        },
        "/analytics": {
            "get": {
                "summary": "Time-bucketed series for charting — VRAM, memory, audio uptime over a window",
                "parameters": [
                    {"name": "hours", "in": "query", "schema": {"type": "integer", "default": 24},
                     "description": "Lookback window in hours (max 720)"}
                ],
                "responses": {"200": {"description": "series[], hours, bucket_minutes"}},
            }
        },
        "/start": {
            "post": {"summary": "Load ollama + audio + monitor via launchctl",
                     "responses": {"200": {"description": "Per-plist load results"}}}
        },
        "/stop": {
            "post": {"summary": "Unload ollama + audio + monitor (API stays up)",
                     "responses": {"200": {"description": "Per-plist unload results"}}}
        },
        "/restart": {
            "post": {"summary": "Unload AI services, wait 2s, reload",
                     "responses": {"200": {"description": "stop + start results"}}}
        },
        "/openapi.json": {
            "get": {"summary": "This OpenAPI spec", "responses": {"200": {"description": "OpenAPI 3.0 JSON"}}}
        },
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def port_alive(host: str, port: int, timeout: float = 2.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def launchctl_action(action: str, plists: list[str]) -> list[dict]:
    results = []
    for label in plists:
        path = PLIST_DIR / f"{label}.plist"
        r = subprocess.run(["launchctl", action, str(path)], capture_output=True, text=True)
        results.append({
            "plist": label,
            "rc": r.returncode,
            "stderr": r.stderr.strip() or None,
        })
    return results


def tail_file(path: str | None, n: int) -> list[str] | None:
    """Return last n lines from a file. None if path is None, [] if missing."""
    if path is None:
        return None
    p = Path(path)
    if not p.exists():
        return []
    with open(p, "r", errors="replace") as f:
        return list(collections.deque((line.rstrip() for line in f), maxlen=n))


# ---------------------------------------------------------------------------
# Data functions
# ---------------------------------------------------------------------------

def service_status() -> dict:
    r = subprocess.run(["launchctl", "list"], capture_output=True, text=True)
    loaded = {p: False for p in AI_PLISTS}
    for line in r.stdout.splitlines():
        for label in AI_PLISTS:
            if label in line:
                loaded[label] = True
    return {
        "loaded": loaded,
        "ollama_port": port_alive("127.0.0.1", 11434),
        "audio_port": port_alive("127.0.0.1", 8000),
        "api_port": True,
    }


def system_stats() -> dict:
    # Memory: active + wired pages × page size
    vm = subprocess.run(["vm_stat"], capture_output=True, text=True)
    mem_used_gb = 0.0
    for line in vm.stdout.splitlines():
        if "Pages active" in line or "Pages wired" in line:
            val = line.split()[-1].rstrip(".")
            try:
                mem_used_gb += int(val) * 4096 / 1_073_741_824
            except ValueError:
                pass

    hw = subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True)
    try:
        mem_total_gb = int(hw.stdout.strip()) / 1_073_741_824
    except ValueError:
        mem_total_gb = 0.0

    # Battery
    batt = subprocess.run(["pmset", "-g", "batt"], capture_output=True, text=True)
    battery_pct = 0
    battery_charging = "AC Power" in batt.stdout
    m = re.search(r"(\d+)%", batt.stdout)
    if m:
        battery_pct = int(m.group(1))

    # Load averages
    load = subprocess.run(["sysctl", "-n", "vm.loadavg"], capture_output=True, text=True)
    load_parts = [x for x in load.stdout.strip().strip("{}").split() if re.match(r"[\d.]+", x)]
    load_1, load_5, load_15 = (float(load_parts[i]) if i < len(load_parts) else None for i in range(3))

    # Memory pressure level (kern.memorystatus_vm_pressure_level: 1=normal, 2=warning, 4=critical)
    press = subprocess.run(["sysctl", "-n", "kern.memorystatus_vm_pressure_level"], capture_output=True, text=True)
    pressure_level = {"1": "normal", "2": "warning", "4": "critical"}.get(press.stdout.strip(), "unknown")

    return {
        "mem_used_gb": round(mem_used_gb, 1),
        "mem_total_gb": round(mem_total_gb, 1),
        "mem_used_pct": round(mem_used_gb / mem_total_gb * 100, 1) if mem_total_gb else 0,
        "battery_pct": battery_pct,
        "battery_charging": battery_charging,
        "load_avg_1m": load_1,
        "load_avg_5m": load_5,
        "load_avg_15m": load_15,
        "memory_pressure": pressure_level,
    }


def loaded_models() -> dict:
    try:
        with urllib.request.urlopen("http://localhost:11434/api/ps", timeout=3) as r:
            data = json.loads(r.read())
        models = [
            {
                "name": m.get("name"),
                "vram_gb": round(m.get("size_vram", 0) / 1_073_741_824, 2),
                "size_gb": round(m.get("size", 0) / 1_073_741_824, 2),
                "expires_at": m.get("expires_at"),
            }
            for m in data.get("models", [])
        ]
        return {"models": models, "total_vram_gb": round(sum(m["vram_gb"] for m in models), 2)}
    except Exception as e:
        return {"error": str(e), "models": [], "total_vram_gb": 0}


def get_logs(service: str, lines: int) -> dict:
    if service not in LOG_FILES:
        return None  # signals 404
    files = LOG_FILES[service]
    return {
        "service": service,
        "stdout": tail_file(files["out"], lines),
        "stderr": tail_file(files["err"], lines),
    }


def query_snapshots(limit: int) -> list[dict]:
    if not DB_PATH.exists():
        return []
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM snapshots ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def snapshots_summary() -> dict:
    if not DB_PATH.exists():
        return {}
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute("""
        SELECT
            COUNT(*) AS total_snapshots,
            ROUND(AVG(tts_up) * 100, 1)  AS audio_uptime_pct,
            ROUND(AVG(ollama_vram_gb), 2) AS avg_vram_gb,
            ROUND(AVG(mem_used_gb), 2)    AS avg_mem_gb,
            ROUND(MIN(battery_pct))       AS battery_min,
            ROUND(MAX(battery_pct))       AS battery_max,
            ROUND(AVG(battery_pct))       AS battery_avg
        FROM snapshots
        WHERE ts >= datetime('now', '-24 hours', 'localtime')
    """).fetchone()
    conn.close()
    return dict(row) if row else {}


def analytics(hours: int) -> dict:
    if not DB_PATH.exists():
        return {"series": [], "hours": hours}

    # Auto-select bucket size to keep series density reasonable
    if hours <= 6:
        bucket_min = 10
    elif hours <= 24:
        bucket_min = 30
    elif hours <= 72:
        bucket_min = 60
    else:
        bucket_min = 120

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(f"""
        SELECT
            strftime('%Y-%m-%dT%H:', ts) ||
                printf('%02d', (CAST(strftime('%M', ts) AS INTEGER) / {bucket_min}) * {bucket_min})
                AS bucket,
            ROUND(AVG(ollama_vram_gb), 2) AS avg_vram_gb,
            ROUND(MAX(ollama_vram_gb), 2) AS peak_vram_gb,
            ROUND(AVG(mem_used_gb), 2)    AS avg_mem_gb,
            ROUND(AVG(tts_up) * 100, 1)  AS audio_uptime_pct,
            ROUND(AVG(battery_pct))       AS avg_battery_pct,
            COUNT(*)                      AS samples
        FROM snapshots
        WHERE ts >= datetime('now', :window, 'localtime')
        GROUP BY bucket
        ORDER BY bucket ASC
    """, {"window": f"-{hours} hours"}).fetchall()
    conn.close()

    return {"series": [dict(r) for r in rows], "hours": hours, "bucket_minutes": bucket_min}


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # silence default access log
        pass

    def send_json(self, data, status: int = 200):
        body = json.dumps(data, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        try:
            self._do_GET()
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def _do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        # Dynamic: /api/logs/{service}
        if path.startswith("/api/logs/"):
            service = path[len("/api/logs/"):]
            lines = min(int(qs.get("lines", ["100"])[0]), 1000)
            result = get_logs(service, lines)
            if result is None:
                self.send_json({"error": f"unknown service '{service}'. valid: {list(LOG_FILES)}"}, 404)
            else:
                self.send_json(result)
            return

        match path:
            case "/api/health":
                self.send_json({"ok": True})
            case "/api/status":
                self.send_json(service_status())
            case "/api/system":
                self.send_json(system_stats())
            case "/api/models":
                self.send_json(loaded_models())
            case "/api/snapshots":
                limit = min(int(qs.get("limit", ["20"])[0]), 500)
                self.send_json(query_snapshots(limit))
            case "/api/snapshots/summary":
                self.send_json(snapshots_summary())
            case "/api/analytics":
                hours = min(int(qs.get("hours", ["24"])[0]), 720)
                self.send_json(analytics(hours))
            case "/api/openapi.json":
                self.send_json(OPENAPI_SPEC)
            case _:
                self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        try:
            self._do_POST()
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def _do_POST(self):
        match self.path:
            case "/api/start":
                self.send_json({"action": "start", "results": launchctl_action("load", AI_PLISTS)})
            case "/api/stop":
                self.send_json({"action": "stop", "results": launchctl_action("unload", AI_PLISTS)})
            case "/api/restart":
                stop = launchctl_action("unload", AI_PLISTS)
                time.sleep(2)
                start = launchctl_action("load", AI_PLISTS)
                self.send_json({"action": "restart", "stop": stop, "start": start})
            case _:
                self.send_json({"error": "not found"}, 404)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"LocalAI API on :{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
