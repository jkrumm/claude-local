"""Long-form TTS orchestration via Fish S2 Pro.

POST /v1/tts/synthesize
  Body (JSON):
    text:            str   — text to speak (any length)
    lang_hint:       str?  — "de" | "en" | None (auto-detect)
    max_chunk_chars: int?  — sentence-boundary chunk size, default 400

  Response (JSON):
    title:        str   — 3-8 word title for filename
    audio_b64:    str   — base64 MP3
    duration_secs: float
    chunks:       int
    lang:         str   — detected language code

Pipeline:
  1. Detect language (heuristic — German chars + word list)
  2. Rewrite for speech (Haiku) — only when ≥2 markdown markers
  3. Title (Haiku) for filename
  4. Hierarchical chunking — paragraphs > sentences (400-char default)
  5. Synthesize each chunk via Fish S2 Pro (:8002), passing voice="de"|"en"
  6. The Fish service applies the smile EQ post-process for German
  7. Numpy concat with 50ms silence between chunks → ffmpeg WAV → MP3

Voice references and EQ chain live in `localai/fish-s2-pro/` — this helper
is intentionally dumb about which clip backs each language.

Credentials: ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL injected by
start-localai-helper.sh from macOS Keychain. If absent, Haiku calls
are skipped and fallbacks apply (no rewrite, title = first words).
"""

import asyncio
import base64
import io
import os
import re
import subprocess
import tempfile

import httpx
import numpy as np
import soundfile as sf
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

_FISH_URL = os.getenv("LOCALAI_FISH_URL", "http://127.0.0.1:8002")

_ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")
_ANTHROPIC_URL = os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
_HAIKU = "claude-haiku-4-5-20251001"

# Fish output sample rate. The model writes 44.1 kHz mono regardless of
# language; the smile EQ post-process keeps the same rate.
_SAMPLE_RATE = 44100

_DE_CHARS = frozenset("äöüÄÖÜß")
_DE_WORDS = frozenset(
    # high-frequency German words that are not English homographs
    "ich ist das der die und mit für auf sie wir aber nicht auch nach "
    "wie wenn war hat wird bin kann noch mehr sehr durch dann über "
    "zum zur vom bis aus bei alle schon jetzt hier gibt mein sein "
    "im am ein eine einen einer eines kein keine "
    "heute morgen gestern dies diese dieser dieses jenen jener "
    "drei vier fünf sechs sieben acht neun zehn "
    "ja nein doch genau klar gut schlecht "
    "haben hatten waren sind seid wart "
    "auch nur etwa ungefähr".split()
)


class TTSRequest(BaseModel):
    text: str
    lang_hint: str | None = None
    max_chunk_chars: int = 400


class TTSResponse(BaseModel):
    title: str
    audio_b64: str
    duration_secs: float
    chunks: int
    lang: str


def _detect_lang(text: str) -> str:
    words = re.findall(r"\b\w+\b", text.lower())
    de_chars = sum(1 for c in text if c in _DE_CHARS)
    de_words = sum(1 for w in words if w in _DE_WORDS)
    # Loose thresholds — false-DE on tiny English fragments is acceptable
    # (Fish handles English text in the de path, just without expressive EN
    # cadence); false-EN on actual German text means the wrong reference clip.
    return "de" if (de_chars >= 2 or de_words >= 2) else "en"


def _needs_rewrite(text: str) -> bool:
    markers = 0
    if re.search(r"^[-*] ", text, re.MULTILINE):
        markers += 1
    if re.search(r"^#{1,4} ", text, re.MULTILINE):
        markers += 1
    if "```" in text:
        markers += 1
    if re.search(r"https?://", text):
        markers += 1
    return markers >= 2


def _strip_markdown(text: str) -> str:
    text = re.sub(r"```[\s\S]*?```", " ", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"\*(.+?)\*", r"\1", text)
    text = re.sub(r"`(.+?)`", r"\1", text)
    text = re.sub(r"^#{1,4}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[-*]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _chunk_text(text: str, max_chars: int = 600) -> list[str]:
    """Hierarchical splitter: paragraphs first, then sentences within.

    Fish S2 Pro is stable across calls (same reference clip), so the only
    reasons to chunk are (a) avoid model drift past ~2048 tokens per call,
    (b) natural pause insertion at boundaries. Paragraph boundaries are
    stronger than sentence boundaries — splitting *between* paragraphs
    feels like a speaker pausing for breath, splitting *within* a paragraph
    breaks the rhetorical flow.
    """
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text.strip()) if p.strip()]
    if not paragraphs:
        return [text]

    chunks: list[str] = []
    current = ""

    def flush():
        nonlocal current
        if current:
            chunks.append(current)
            current = ""

    for para in paragraphs:
        if current and len(current) + len(para) + 2 <= max_chars:
            current = current + "\n\n" + para
            continue
        flush()
        if len(para) <= max_chars:
            current = para
            continue
        for s in re.split(r"(?<=[.!?])\s+", para):
            if not s:
                continue
            if current and len(current) + len(s) + 1 <= max_chars:
                current = current + " " + s
            else:
                flush()
                current = s

    flush()
    return chunks or [text]


async def _haiku(system: str, user: str, max_tokens: int = 128) -> str:
    if not _ANTHROPIC_KEY:
        return ""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                f"{_ANTHROPIC_URL.rstrip('/')}/v1/messages",
                headers={
                    "x-api-key": _ANTHROPIC_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": _HAIKU,
                    "max_tokens": max_tokens,
                    "system": system,
                    "messages": [{"role": "user", "content": user}],
                },
            )
            r.raise_for_status()
            return r.json()["content"][0]["text"].strip()
    except Exception:
        return ""


async def _rewrite_for_speech(text: str, lang: str) -> str:
    lang_name = "German" if lang == "de" else "English"
    result = await _haiku(
        system=(
            f"Convert the following message to natural spoken {lang_name} prose. "
            "Remove all markdown: bullets become flowing sentences, strip bold/italic, "
            "remove headers, describe code concepts in plain words, omit URLs. "
            "Preserve all information. Sound like someone speaking, not writing. "
            "Match the input language exactly. Never start with a greeting or "
            "address the listener by name. Reply with ONLY the rewritten text."
        ),
        user=text[:2000],
        max_tokens=1024,
    )
    return result or _strip_markdown(text)


async def _make_title(text: str, lang: str) -> str:
    lang_name = "German" if lang == "de" else "English"
    result = await _haiku(
        system=(
            f"Generate a concise 3-8 word title in {lang_name} for this spoken memo. "
            "Reply ONLY with the title — no quotes, no punctuation at the end."
        ),
        user=text[:400],
        max_tokens=24,
    )
    return re.sub(r'[<>:"/\\|?*]', "", result).strip() or "Voice memo"


async def _synth_chunk(
    chunk: str,
    lang: str,
    client: httpx.AsyncClient,
) -> np.ndarray:
    r = await client.post(
        f"{_FISH_URL}/v1/audio/speech",
        json={
            "model": "fish-s2-pro",
            "input": chunk,
            "voice": lang,  # "de" or "en" — Fish dispatches to the right reference
            "response_format": "wav",
            "max_new_tokens": 1536,
        },
        timeout=300.0,
    )
    r.raise_for_status()
    audio, _ = sf.read(io.BytesIO(r.content), dtype="float32")
    return audio


@router.post("/v1/tts/synthesize", response_model=TTSResponse)
async def synthesize(req: TTSRequest) -> TTSResponse:
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    # 1. Language detection
    lang = req.lang_hint or _detect_lang(text)

    # 2. Speakable rewrite — only when text has markdown noise
    if len(text) > 150 and _needs_rewrite(text):
        spoken = await _rewrite_for_speech(text, lang)
    else:
        spoken = _strip_markdown(text)

    # 3. Title (single Haiku call)
    if len(spoken) > 50 and _ANTHROPIC_KEY:
        title = await _make_title(spoken, lang)
    else:
        title = re.sub(r'[<>:"/\\|?*]', "", spoken[:40]).strip() or "Voice memo"

    # 4. Chunk at sentence boundaries
    chunks = _chunk_text(spoken, req.max_chunk_chars)

    # 5. Synthesize sequentially. Fish has an internal synth lock; concurrent
    # requests would just queue inside the server, so serializing here saves
    # the round-trip overhead.
    silence_50ms = np.zeros(int(0.05 * _SAMPLE_RATE), dtype=np.float32)
    audio_parts: list[np.ndarray] = []

    async with httpx.AsyncClient() as http:
        for i, chunk in enumerate(chunks):
            part = await _synth_chunk(chunk, lang, http)
            audio_parts.append(part)
            if i < len(chunks) - 1:
                audio_parts.append(silence_50ms)

    # 6. Concatenate → ffmpeg WAV → MP3
    combined = np.concatenate(audio_parts)
    duration_secs = round(len(combined) / _SAMPLE_RATE, 2)

    wav_tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    mp3_tmp = wav_tmp.name.replace(".wav", ".mp3")
    try:
        sf.write(wav_tmp.name, combined, _SAMPLE_RATE)
        wav_tmp.close()
        proc = subprocess.run(
            [
                "ffmpeg", "-i", wav_tmp.name,
                "-q:a", "4", "-y", "-loglevel", "error", mp3_tmp,
            ],
            capture_output=True,
            timeout=120,
        )
        if proc.returncode != 0:
            raise HTTPException(status_code=500, detail="ffmpeg MP3 conversion failed")
        with open(mp3_tmp, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode()
    finally:
        for p in (wav_tmp.name, mp3_tmp):
            try:
                os.unlink(p)
            except OSError:
                pass

    return TTSResponse(
        title=title,
        audio_b64=audio_b64,
        duration_secs=duration_secs,
        chunks=len(chunks),
        lang=lang,
    )
