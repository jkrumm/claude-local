"""Regenerate sample matrix via the running playground server (warm model).

Much faster than pregenerate.py because the warm-loaded server reuses the
model across calls. ~20 s per synthesis vs ~80 s with subprocess CLI.

Usage:
    python pregenerate_via_server.py
"""

from __future__ import annotations

import json
import shutil
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOICES_DIR = ROOT / "voices"
SCRIPTS_DIR = ROOT / "scripts"
SAMPLES_DIR = ROOT / "samples"

SERVER = "http://127.0.0.1:8002"


def get(path):
    with urllib.request.urlopen(SERVER + path, timeout=10) as r:
        return json.load(r)


def post(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        SERVER + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def main():
    voices = get("/api/voices")
    scripts = get("/api/scripts")
    print(f"voices: {len(voices)}  scripts: {len(scripts)}")

    manifest = []
    for script in scripts:
        # Per-script voice filter: if set, only generate for these voice IDs
        voice_filter = set(script.get("voice_filter") or [])
        for voice in voices:
            if voice["lang"] != script["lang"]:
                continue
            if voice_filter and voice["id"] not in voice_filter:
                continue
            stable_path = SAMPLES_DIR / f"matrix_{script['id']}__{voice['id']}.wav"
            if stable_path.exists():
                print(f"[{script['id']}] × [{voice['id']}]  (cached → skip)", flush=True)
                elapsed = 0.0
            else:
                print(f"\n[{script['id']}] × [{voice['id']}]", flush=True)
                t0 = time.time()
                try:
                    resp = post(
                        "/api/synthesize",
                        {
                            "voice_id": voice["id"],
                            "text": script["text"],
                            "max_new_tokens": 1536,
                        },
                    )
                except Exception as e:
                    print(f"  FAIL: {e}")
                    continue
                elapsed = time.time() - t0
                live_path = SAMPLES_DIR / Path(resp["url"]).name
                if live_path.exists() and live_path != stable_path:
                    shutil.copy(live_path, stable_path)
                print(f"  ok ({elapsed:.1f}s) → {stable_path.name}")
            manifest.append(
                {
                    "script_id": script["id"],
                    "script_label": script["label"],
                    "voice_id": voice["id"],
                    "lang": script["lang"],
                    "category": script["category"],
                    "text": script["text"],
                    "audio_file": stable_path.name,
                    "elapsed_s": elapsed,
                }
            )

    (SAMPLES_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\ndone — {len(manifest)} samples")


if __name__ == "__main__":
    main()
