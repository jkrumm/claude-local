#!/usr/bin/env python3
"""
LocalAI management API — control the stack and query monitoring data.
Runs on 127.0.0.1:9001, proxied through Caddy at /api/*.
Tailscale is the sole auth layer — no credentials needed on the API itself.

Endpoints:
  GET  /api/health            Liveness probe
  GET  /api/status            Service state (launchd loaded + port alive)
  POST /api/start             Load ollama + audio + monitor via launchctl
  POST /api/stop              Unload ollama + audio + monitor via launchctl
  POST /api/restart           Unload, wait 2s, reload
  GET  /api/snapshots         Recent rows from monitor.db (?limit=N, max 500)
  GET  /api/snapshots/summary Uptime %, avg memory, avg VRAM over last 24h
"""
import json
import socket
import sqlite3
import subprocess
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 9001
DB_PATH = Path.home() / "SourceRoot/claude-local/localai/monitor.db"
PLIST_DIR = Path.home() / "Library/LaunchAgents"
AI_PLISTS = ["com.localai.ollama", "com.localai.audio", "com.localai.monitor"]


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
        r = subprocess.run(
            ["launchctl", action, str(path)],
            capture_output=True, text=True,
        )
        results.append({
            "plist": label,
            "rc": r.returncode,
            "stderr": r.stderr.strip() or None,
        })
    return results


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


def query_snapshots(limit: int) -> list[dict]:
    if not DB_PATH.exists():
        return []
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM snapshots ORDER BY ts DESC LIMIT ?", (limit,)
    ).fetchall()
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
            ROUND(AVG(tts_up) * 100, 1) AS audio_uptime_pct,
            ROUND(AVG(ollama_vram_gb), 2) AS avg_vram_gb,
            ROUND(AVG(mem_used_gb), 2) AS avg_mem_gb,
            ROUND(MIN(battery_pct)) AS battery_min,
            ROUND(MAX(battery_pct)) AS battery_max,
            ROUND(AVG(battery_pct)) AS battery_avg
        FROM snapshots
        WHERE ts >= datetime('now', '-24 hours', 'localtime')
    """).fetchone()
    conn.close()
    return dict(row) if row else {}


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
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)

        match parsed.path:
            case "/api/health":
                self.send_json({"ok": True})
            case "/api/status":
                self.send_json(service_status())
            case "/api/snapshots":
                limit = min(int(qs.get("limit", ["20"])[0]), 500)
                self.send_json(query_snapshots(limit))
            case "/api/snapshots/summary":
                self.send_json(snapshots_summary())
            case _:
                self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        match self.path:
            case "/api/start":
                results = launchctl_action("load", AI_PLISTS)
                self.send_json({"action": "start", "results": results})
            case "/api/stop":
                results = launchctl_action("unload", AI_PLISTS)
                self.send_json({"action": "stop", "results": results})
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
