"""Fish S2 Pro Playground — FastAPI server.

Loads the Fish S2 Pro model once on startup and reuses it for every
request — keeps live synthesis snappy (no per-request model reload).

POST /api/synthesize  → run Fish S2 Pro with given voice + text + params
GET  /api/voices       → list of reference voices (with transcript previews)
GET  /api/scripts      → pre-defined demo scripts
GET  /api/samples      → manifest of pre-generated samples
GET  /voices/<file>    → serve reference WAV
GET  /samples/<file>   → serve generated audio
GET  /                 → playground HTML
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path

import mlx_speech
import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
VOICES_DIR = ROOT / "voices"
SAMPLES_DIR = ROOT / "samples"
SCRIPTS_DIR = ROOT / "scripts"
PLAYGROUND_DIR = ROOT / "playground"

SAMPLES_DIR.mkdir(parents=True, exist_ok=True)


def _voices() -> list[dict]:
    out: list[dict] = []
    for wav in sorted(VOICES_DIR.glob("*.wav")):
        txt_file = wav.with_suffix(".txt")
        transcript = txt_file.read_text().strip() if txt_file.exists() else ""
        meta_file = wav.with_suffix(".json")
        meta = json.loads(meta_file.read_text()) if meta_file.exists() else {}
        out.append(
            {
                "id": wav.stem,
                "wav": wav.name,
                "transcript": transcript,
                "label": meta.get("label", wav.stem),
                "lang": meta.get("lang", "en"),
                "source": meta.get("source", "unknown"),
                "description": meta.get("description", ""),
            }
        )
    return out


def _scripts() -> list[dict]:
    """Pre-defined demo scripts in scripts/<id>.json."""
    out: list[dict] = []
    for path in sorted(SCRIPTS_DIR.glob("*.json")):
        d = json.loads(path.read_text())
        d["id"] = path.stem
        out.append(d)
    return out


_VARIANT_SUFFIXES = {
    "eq": "smile EQ",
    "fast": "+5% post",
    "eqfast": "smile EQ + 5%",
    "post5": "+5% post",
    "post10": "+10% post",
}


def _samples_manifest() -> list[dict]:
    """Return the matrix manifest plus auto-detected output post-process variants.

    For every base entry `matrix_<script>__<voice>.wav`, scan for sibling files
    `matrix_<script>__<voice>_<suffix>.wav` where suffix is in `_VARIANT_SUFFIXES`,
    and surface them as additional rows tagged with a `variant` field.
    """
    manifest_file = SAMPLES_DIR / "manifest.json"
    base = json.loads(manifest_file.read_text()) if manifest_file.exists() else []
    extras: list[dict] = []

    for row in base:
        af = row["audio_file"]
        if not af.endswith(".wav"):
            continue
        stem = af[:-4]  # matrix_<script>__<voice>
        for suffix, label in _VARIANT_SUFFIXES.items():
            variant_file = SAMPLES_DIR / f"{stem}_{suffix}.wav"
            if not variant_file.exists():
                continue
            extras.append(
                {
                    **row,
                    "script_id": f"{row['script_id']}__{suffix}",
                    "script_label": f"{row['script_label']}  ({label})",
                    "audio_file": variant_file.name,
                    "elapsed_s": 0.0,
                    "variant": suffix,
                    "base_script_id": row["script_id"],
                }
            )

    return base + extras


class SynthesizeRequest(BaseModel):
    text: str
    voice_id: str
    max_new_tokens: int = 1024


# Warm-loaded model — populated in lifespan startup
_MODEL = {"tts": None}


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[fish-s2-pro] loading model into memory…")
    t0 = time.time()
    _MODEL["tts"] = mlx_speech.tts.load("fish-s2-pro")
    print(f"[fish-s2-pro] model loaded in {time.time() - t0:.1f}s")
    yield


app = FastAPI(title="Fish S2 Pro Playground", lifespan=lifespan)


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    html = (PLAYGROUND_DIR / "index.html").read_text()
    return HTMLResponse(html)


@app.get("/api/voices")
def get_voices():
    return _voices()


@app.get("/api/scripts")
def get_scripts():
    return _scripts()


@app.get("/api/samples")
def get_samples():
    return _samples_manifest()


@app.get("/voices/{name}")
def serve_voice(name: str):
    p = VOICES_DIR / name
    if not p.exists() or ".." in name:
        raise HTTPException(404)
    return FileResponse(p)


@app.get("/samples/{name}")
def serve_sample(name: str):
    p = SAMPLES_DIR / name
    if not p.exists() or ".." in name:
        raise HTTPException(404)
    return FileResponse(p)


_synth_lock = asyncio.Lock()


def _synthesize_blocking(
    text: str, ref_wav: Path, ref_text: str, max_new_tokens: int
) -> tuple[np.ndarray, int, int]:
    result = _MODEL["tts"].generate(
        text=text,
        reference_audio=str(ref_wav),
        reference_text=ref_text,
        max_new_tokens=max_new_tokens,
    )
    waveform = np.asarray(result.waveform, dtype=np.float32)
    if waveform.ndim > 1:
        waveform = waveform.squeeze()
    return waveform, int(result.sample_rate), getattr(result, "generated_tokens", 0)


@app.post("/api/synthesize")
async def synthesize(req: SynthesizeRequest):
    if _MODEL["tts"] is None:
        raise HTTPException(503, "model not yet loaded — try again in a few seconds")

    voices = {v["id"]: v for v in _voices()}
    if req.voice_id not in voices:
        raise HTTPException(400, f"unknown voice {req.voice_id}")
    voice = voices[req.voice_id]

    key = hashlib.sha1(
        f"{req.voice_id}|{req.text}|{req.max_new_tokens}".encode()
    ).hexdigest()[:16]
    out_wav = SAMPLES_DIR / f"live_{key}.wav"

    cached = out_wav.exists()
    elapsed = 0.0
    tokens = 0

    if not cached:
        ref_wav = VOICES_DIR / voice["wav"]
        ref_text = voice["transcript"]
        async with _synth_lock:
            t0 = time.time()
            try:
                waveform, sample_rate, tokens = await asyncio.to_thread(
                    _synthesize_blocking,
                    req.text,
                    ref_wav,
                    ref_text,
                    req.max_new_tokens,
                )
            except Exception as e:
                raise HTTPException(500, f"synthesis failed: {type(e).__name__}: {e}")
            elapsed = time.time() - t0

        sf.write(out_wav, waveform, sample_rate)

    return JSONResponse(
        {
            "url": f"/samples/{out_wav.name}",
            "voice_id": req.voice_id,
            "cached": cached,
            "elapsed_s": elapsed,
            "tokens": tokens,
        }
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.getenv("FISH_PLAYGROUND_PORT", "8002")),
        log_level="info",
    )
