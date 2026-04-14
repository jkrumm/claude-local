# /// script
# requires-python = ">=3.14"
# dependencies = [
#   "cryptography",
#   "requests",
# ]
# ///
"""Fetch Claude.ai subscription usage stats via web API.

Reads Chrome cookies from macOS Keychain + SQLite, calls the Claude.ai
usage endpoint, and writes /tmp/claude_sl/usage_api.json for statusline.sh.

Run via: uv run ~/.claude/fetch_usage.py
"""

import json
import shutil
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

CACHE_DIR = Path("/tmp/claude_sl")
CACHE_FILE = CACHE_DIR / "usage_api.json"
COOKIE_DB = Path.home() / "Library/Application Support/Google/Chrome/Default/Cookies"
CLAUDE_CFG = Path.home() / ".claude.json"
LOG_DIR = Path.home() / ".claude" / "logs"


def log_event(src: str, event: str, level: str, data: dict) -> None:
    try:
        LOG_DIR.mkdir(exist_ok=True)
        date_str = datetime.now().strftime("%Y-%m-%d")
        entry = json.dumps({
            "ts": datetime.now(timezone.utc).isoformat(),
            "src": src,
            "event": event,
            "level": level,
            "data": data,
        }) + "\n"
        with open(LOG_DIR / f"{date_str}.jsonl", "a") as f:
            f.write(entry)
    except Exception:
        pass


def cleanup_old_logs(keep_days: int = 3) -> None:
    try:
        cutoff = time.time() - keep_days * 86400
        for f in LOG_DIR.glob("*.jsonl"):
            if f.stat().st_mtime < cutoff:
                f.unlink(missing_ok=True)
    except Exception:
        pass


def _aes_key() -> bytes:
    result = subprocess.run(
        ["security", "find-generic-password", "-s", "Chrome Safe Storage", "-w"],
        capture_output=True,
        text=True,
        check=True,
    )
    password = result.stdout.strip().encode("utf-8")
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA1(),
        length=16,
        salt=b"saltysalt",
        iterations=1003,
        backend=default_backend(),
    )
    return kdf.derive(password)


def _decrypt(encrypted: bytes, key: bytes) -> str:
    if not encrypted.startswith(b"v10"):
        return encrypted.decode("utf-8", errors="replace")
    cipher = Cipher(algorithms.AES(key), modes.CBC(b" " * 16), backend=default_backend())
    plaintext = cipher.decryptor().update(encrypted[3:])
    pad = plaintext[-1]
    plaintext = plaintext[: -pad if 1 <= pad <= 16 else len(plaintext)]
    return plaintext[32:].decode("utf-8", errors="replace")  # skip Chrome's 32-byte prefix


def _chrome_cookies() -> dict[str, str]:
    tmp = Path("/tmp/chrome_cookies_fetch.db")
    shutil.copy2(COOKIE_DB, tmp)
    try:
        conn = sqlite3.connect(str(tmp))
        rows = conn.execute(
            "SELECT name, encrypted_value FROM cookies WHERE host_key LIKE '%claude.ai%'"
        ).fetchall()
        conn.close()
    finally:
        tmp.unlink(missing_ok=True)
    key = _aes_key()
    return {name: _decrypt(enc, key) for name, enc in rows}


def _org_id() -> str:
    with open(CLAUDE_CFG) as f:
        return json.load(f)["oauthAccount"]["organizationUuid"]


def _to_epoch(ts: str | None) -> int | None:
    if not ts:
        return None
    try:
        return int(datetime.fromisoformat(ts).timestamp())
    except Exception:
        return None


def fetch() -> None:
    CACHE_DIR.mkdir(exist_ok=True)
    cleanup_old_logs()

    cookies = _chrome_cookies()
    log_event("fetch_usage", "cookies_ok", "info", {"count": len(cookies)})

    org_id = _org_id()
    log_event("fetch_usage", "fetch_start", "info", {"org_id": org_id[:8] + "..."})

    t0 = time.time()
    resp = requests.get(
        f"https://claude.ai/api/organizations/{org_id}/usage",
        headers={
            "Cookie": "; ".join(f"{k}={v}" for k, v in cookies.items()),
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "application/json",
            "Referer": "https://claude.ai/",
        },
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    latency_ms = round((time.time() - t0) * 1000)

    def extract(key: str) -> dict:
        w = data.get(key) or {}
        return {
            "utilization": w.get("utilization"),
            "resets_at_epoch": _to_epoch(w.get("resets_at")),
        }

    result = {
        "five_hour": extract("five_hour"),
        "seven_day": extract("seven_day"),
        "seven_day_sonnet": extract("seven_day_sonnet"),
        "fetched_at": int(datetime.now(timezone.utc).timestamp()),
    }

    five_h_pct = round(result["five_hour"].get("utilization") or 0)
    seven_d_pct = result["seven_day"].get("utilization")
    log_event("fetch_usage", "fetch_success", "info", {
        "five_hour_pct": five_h_pct,
        "seven_day_pct": round(seven_d_pct) if seven_d_pct is not None else None,
        "http_status": resp.status_code,
        "latency_ms": latency_ms,
    })

    tmp = CACHE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(result))
    tmp.rename(CACHE_FILE)

    # Push to cqueue UI (localhost:7705) — fail silently if not running
    try:
        five_h = result["five_hour"]
        seven_d = result["seven_day"]
        now_ts = result["fetched_at"]
        reset_epoch = five_h.get("resets_at_epoch")
        mins_left = round((reset_epoch - now_ts) / 60) if reset_epoch and reset_epoch > now_ts else None
        requests.post(
            "http://localhost:7705/api/usage",
            json={
                "five_hour_pct": round(five_h.get("utilization") or 0),
                "five_hour_mins_left": mins_left,
                "seven_day_pct": round(seven_d.get("utilization")) if seven_d.get("utilization") is not None else None,
            },
            timeout=1,
        )
    except Exception:
        pass


if __name__ == "__main__":
    try:
        fetch()
    except Exception as e:
        log_event("fetch_usage", "fetch_error", "error", {
            "error": str(e),
            "type": type(e).__name__,
        })
        # Write minimal error record so statusline knows a fetch was attempted
        CACHE_DIR.mkdir(exist_ok=True)
        CACHE_FILE.write_text(json.dumps({"error": str(e), "fetched_at": 0}))
        sys.exit(1)
