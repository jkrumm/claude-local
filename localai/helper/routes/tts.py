"""Long-form TTS orchestration via Voxtral 4B TTS.

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
  4. Map language → Voxtral voice preset (de_male / neutral_male)
  5. Chunk at sentence boundaries
  6. Synthesize each chunk via mlx-audio :8000 (Voxtral)
  7. Numpy concat with 50ms silence between chunks → ffmpeg
     filter chain (trim leading silence + 30ms fade-in + 3% slowdown)
     → MP3 → base64

Why no `_delivery_note()` call: Voxtral does not accept an instruct/system
prompt. Voice preset is the only character knob. Removed to save one Haiku
roundtrip per memo.

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

_MLX_URL = os.getenv("LOCALAI_HELPER_UPSTREAM", "http://127.0.0.1:8000")
_TTS_MODEL = os.getenv(
    "TTS_MODEL",
    "mlx-community/Voxtral-4B-TTS-2603-mlx-4bit",
)

_ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")
_ANTHROPIC_URL = os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
_HAIKU = "claude-haiku-4-5-20251001"

# Language → Voxtral voice preset.
# Voxtral ships 20 fixed presets keyed by language+gender. de_male leans
# Austrian Hochdeutsch; neutral_male is the cleanest English baseline.
# All other languages fall back to neutral_male (English) since the
# helper's language detection only distinguishes de vs en.
_VOICE_MAP = {
    "de": "de_male",
    "en": "neutral_male",
}
_VOICE_FALLBACK = "neutral_male"

_DE_CHARS = frozenset("äöüÄÖÜß")
_DE_WORDS = frozenset(
    "ich ist das der die und mit für auf sie wir aber nicht auch nach "
    "wie wenn war hat wird bin kann noch mehr sehr durch dann über "
    "zum zur vom bis aus bei alle schon jetzt hier gibt mein sein".split()
)

# ffmpeg filter chain applied to the concatenated WAV before MP3 encode.
#   silenceremove           : trim leading silence > 30ms (kills hiccup at start)
#   afade in (30ms)         : smooth attack so first audible note isn't a click
#   areverse → afade → areverse : double-reverse trick for fade-out without
#                                 needing to know post-trim duration in advance
#
# No slowdown, no denoise, no loudnorm, no EQ — every additional filter we
# tried made Voxtral sound more processed and less natural. Trim + fades is
# the only universally beneficial pp.
_AUDIO_FILTER = (
    "silenceremove=start_periods=1:start_silence=0.03:start_threshold=-50dB,"
    "afade=t=in:st=0:d=0.03,"
    "areverse,afade=t=in:st=0:d=0.05,areverse"
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
    return "de" if (de_chars >= 3 or de_words >= 3) else "en"


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

    Voxtral's voice identity is stable across calls, so the only reasons
    to chunk are (a) max_tokens, (b) natural pause insertion at boundaries.
    Paragraph boundaries are stronger than sentence boundaries — splitting
    *between* paragraphs feels like a speaker pausing for breath, splitting
    *within* a paragraph mid-sentence breaks the rhetorical flow.

    Strategy:
      1. Split text into paragraphs (\\n\\n).
      2. Pack consecutive paragraphs into one chunk while they fit max_chars.
      3. If a single paragraph exceeds max_chars, split that paragraph at
         sentence boundaries.
      4. Last resort (very rare): a sentence longer than max_chars is
         emitted as-is — Voxtral handles long sentences without drift.
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
        # Small paragraph fits with what we've accumulated → pack it
        if current and len(current) + len(para) + 2 <= max_chars:
            current = current + "\n\n" + para
            continue

        flush()

        # Paragraph fits in one chunk on its own
        if len(para) <= max_chars:
            current = para
            continue

        # Paragraph too long → split at sentence boundaries
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
    voice: str,
    client: httpx.AsyncClient,
) -> np.ndarray:
    r = await client.post(
        f"{_MLX_URL}/v1/audio/speech",
        json={
            "model": _TTS_MODEL,
            "input": chunk,
            "voice": voice,
            "response_format": "wav",
            "temperature": 0.7,
            "top_p": 0.95,
            "top_k": 50,
            "max_tokens": 4096,
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

    # 1. Language detection → voice preset
    lang = req.lang_hint or _detect_lang(text)
    voice = _VOICE_MAP.get(lang, _VOICE_FALLBACK)

    # 2. Speakable rewrite — only when text has markdown noise
    if len(text) > 150 and _needs_rewrite(text):
        spoken = await _rewrite_for_speech(text, lang)
    else:
        spoken = _strip_markdown(text)

    # 3. Title (single Haiku call — delivery note is gone, Voxtral has no instruct)
    if len(spoken) > 50 and _ANTHROPIC_KEY:
        title = await _make_title(spoken, lang)
    else:
        title = re.sub(r'[<>:"/\\|?*]', "", spoken[:40]).strip() or "Voice memo"

    # 4. Chunk at sentence boundaries
    chunks = _chunk_text(spoken, req.max_chunk_chars)

    # 5. Synthesize sequentially (Voxtral concurrent requests crash — issue #638)
    silence_50ms = np.zeros(int(0.05 * 24000), dtype=np.float32)
    audio_parts: list[np.ndarray] = []

    async with httpx.AsyncClient() as http:
        for i, chunk in enumerate(chunks):
            part = await _synth_chunk(chunk, voice, http)
            audio_parts.append(part)
            if i < len(chunks) - 1:
                audio_parts.append(silence_50ms)

    # 6. Concatenate → ffmpeg (filter chain + MP3 encode in one pass)
    combined = np.concatenate(audio_parts)
    duration_secs = round(len(combined) / 24000.0, 2)

    wav_tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    mp3_tmp = wav_tmp.name.replace(".wav", ".mp3")
    try:
        sf.write(wav_tmp.name, combined, 24000)
        wav_tmp.close()
        proc = subprocess.run(
            [
                "ffmpeg", "-i", wav_tmp.name,
                "-af", _AUDIO_FILTER,
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

    # Note: post-processing slightly changes total duration (3% slowdown +
    # leading silence trim). The number reported is the raw concatenated
    # duration before filtering — close enough for caller telemetry.
    return TTSResponse(
        title=title,
        audio_b64=audio_b64,
        duration_secs=duration_secs,
        chunks=len(chunks),
        lang=lang,
    )
