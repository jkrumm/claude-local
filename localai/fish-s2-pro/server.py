"""Fish S2 Pro production TTS server.

OpenAI-compatible /v1/audio/speech endpoint, drop-in replacement for the
mlx-audio Voxtral path that localai-helper used to call. Loads the Fish
S2 Pro model and the two production reference voices once at startup;
dispatches by language and applies the smile EQ post-process for German.

Endpoints:
  POST /v1/audio/speech    OpenAI-compatible TTS
  GET  /v1/models          list loaded reference voices (debugging)
  GET  /health             liveness probe

Request shape (OpenAI):
  {
    "model": "fish-s2-pro",       # ignored — there's only one
    "input": "text to speak",
    "voice": "de" | "en",         # language code (NOT a Voxtral preset name)
    "response_format": "wav"|"mp3"  # default wav
  }

Started by launchd via bin/start-fish.sh on port 8002.
"""

from __future__ import annotations

import asyncio
import io
import os
import re
import subprocess
import time
from contextlib import asynccontextmanager
from pathlib import Path

import mlx_speech
import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent
VOICES_DIR = ROOT / "voices"

# Production voice references — language → (wav path, transcript path)
_VOICES: dict[str, dict] = {
    "de": {"id": "pip_cut_smile_de"},
    "en": {"id": "ethan_en"},
}

# Smile EQ chain — applied to German output. Same recipe used to build
# the reference clip and validated across 7 production scripts. Keep this
# string as the single source of truth; bin/start-fish.sh calls into ffmpeg
# directly so this module is the canonical definition.
SMILE_EQ_CHAIN = (
    "highpass=f=70,"
    "equalizer=f=600:t=q:w=2.5:g=-3,"
    "equalizer=f=5500:t=q:w=2.5:g=3,"
    "equalizer=f=12000:t=q:w=2:g=1.5,"
    "loudnorm=I=-18:TP=-2:LRA=7"
)

# Languages where the smile EQ is applied. English stays raw — Ethan was
# tuned on fish.audio's own demo clips and doesn't need it.
_POST_EQ = {"de"}


class SpeechRequest(BaseModel):
    model: str | None = None
    input: str
    voice: str = "en"  # language code: "de" or "en"
    response_format: str = "wav"
    max_new_tokens: int = 1536


_MODEL = {"tts": None}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load reference clips + transcripts at startup. Cheap, ~50 KB each.
    for lang, v in _VOICES.items():
        wav = VOICES_DIR / f"{v['id']}.wav"
        txt = VOICES_DIR / f"{v['id']}.txt"
        if not wav.exists() or not txt.exists():
            raise RuntimeError(f"missing reference for lang={lang}: {wav}")
        v["wav_path"] = str(wav)
        v["transcript"] = txt.read_text().strip()
        print(f"[fish] {lang} → {v['id']}")

    print("[fish] loading Fish S2 Pro into memory…")
    t0 = time.time()
    _MODEL["tts"] = mlx_speech.tts.load("fish-s2-pro")
    print(f"[fish] model loaded in {time.time() - t0:.1f}s")

    # Warm-up synthesis so the first real request is fast.
    try:
        await asyncio.to_thread(
            _synthesize_blocking, "Bereit.", _VOICES["de"], 256
        )
        print("[fish] warm-up synthesis complete")
    except Exception as e:
        print(f"[fish] warm-up failed (non-fatal): {e}")

    yield


app = FastAPI(title="Fish S2 Pro production TTS", lifespan=lifespan)

# Single-flight lock so concurrent requests serialize through the model
# (mlx-speech model is not thread-safe; one synthesis at a time).
_synth_lock = asyncio.Lock()


def _synthesize_blocking(text: str, voice: dict, max_new_tokens: int) -> tuple[np.ndarray, int]:
    result = _MODEL["tts"].generate(
        text=text,
        reference_audio=voice["wav_path"],
        reference_text=voice["transcript"],
        max_new_tokens=max_new_tokens,
    )
    waveform = np.asarray(result.waveform, dtype=np.float32)
    if waveform.ndim > 1:
        waveform = waveform.squeeze()
    return waveform, int(result.sample_rate)


def _apply_smile_eq(wav_in: np.ndarray, sample_rate: int) -> tuple[np.ndarray, int]:
    """Pipe waveform through ffmpeg with the smile EQ chain."""
    buf_in = io.BytesIO()
    sf.write(buf_in, wav_in, sample_rate, format="WAV", subtype="PCM_16")
    proc = subprocess.run(
        [
            "ffmpeg", "-loglevel", "error",
            "-i", "pipe:0",
            "-af", SMILE_EQ_CHAIN,
            "-ar", str(sample_rate),
            "-ac", "1",
            "-f", "wav",
            "-acodec", "pcm_s16le",
            "pipe:1",
        ],
        input=buf_in.getvalue(),
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        # If EQ fails, fall back to raw — better some audio than no audio.
        print(f"[fish] smile EQ failed, falling back to raw: {proc.stderr.decode()[-300:]}")
        return wav_in, sample_rate
    wav_out, sr_out = sf.read(io.BytesIO(proc.stdout))
    return np.asarray(wav_out, dtype=np.float32), int(sr_out)


def _encode(waveform: np.ndarray, sample_rate: int, response_format: str) -> tuple[bytes, str]:
    if response_format == "wav":
        buf = io.BytesIO()
        sf.write(buf, waveform, sample_rate, format="WAV", subtype="PCM_16")
        return buf.getvalue(), "audio/wav"
    if response_format == "mp3":
        # ffmpeg WAV → MP3 (libmp3lame, decent default bitrate)
        buf_in = io.BytesIO()
        sf.write(buf_in, waveform, sample_rate, format="WAV", subtype="PCM_16")
        proc = subprocess.run(
            [
                "ffmpeg", "-loglevel", "error",
                "-i", "pipe:0",
                "-codec:a", "libmp3lame", "-q:a", "4",
                "-f", "mp3", "pipe:1",
            ],
            input=buf_in.getvalue(),
            capture_output=True,
            check=False,
        )
        if proc.returncode != 0:
            raise HTTPException(500, f"mp3 encode failed: {proc.stderr.decode()[-300:]}")
        return proc.stdout, "audio/mpeg"
    raise HTTPException(400, f"unsupported response_format: {response_format}")


def _normalize_lang(voice_field: str) -> str:
    """Accept 'de'/'en' or legacy Voxtral preset names ('de_male', 'neutral_male', etc.)."""
    v = (voice_field or "en").lower().strip()
    if v.startswith("de"):
        return "de"
    return "en"


@app.get("/health")
def health():
    return {"ok": _MODEL["tts"] is not None}


@app.get("/v1/models")
def models():
    return {
        "object": "list",
        "data": [
            {"id": "fish-s2-pro", "object": "model", "voices": list(_VOICES.keys())},
        ],
    }


@app.post("/v1/audio/speech")
async def speech(req: SpeechRequest):
    if _MODEL["tts"] is None:
        raise HTTPException(503, "model not loaded — try again in a few seconds")

    lang = _normalize_lang(req.voice)
    if lang not in _VOICES:
        raise HTTPException(400, f"unsupported voice/lang: {req.voice}")
    voice = _VOICES[lang]

    text = (req.input or "").strip()
    if not text:
        raise HTTPException(400, "empty input")

    async with _synth_lock:
        try:
            waveform, sr = await asyncio.to_thread(
                _synthesize_blocking, text, voice, req.max_new_tokens
            )
        except Exception as e:
            raise HTTPException(500, f"synthesis failed: {type(e).__name__}: {e}")

    if lang in _POST_EQ:
        waveform, sr = await asyncio.to_thread(_apply_smile_eq, waveform, sr)

    audio_bytes, mime = _encode(waveform, sr, req.response_format)
    return Response(content=audio_bytes, media_type=mime)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.getenv("FISH_PORT", "8002")),
        log_level="info",
    )
