"""Long-form TTS orchestration.

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
  1. Detect language (heuristic)
  2. Rewrite for speech (Haiku) — only when text has ≥2 markdown markers
  3. Generate title + delivery note (Haiku, parallel after rewrite)
  4. Build instruct: base voice character + delivery note
  5. Chunk at sentence boundaries (400 chars soft limit)
  6. Synthesize each chunk via mlx-audio :8000
  7. Numpy concat → 50ms silence between chunks → ffmpeg → MP3 → base64

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
    "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16",
)

# Base voice description — English only.
# VoiceDesign's instruct is benchmarked on EN/ZH; German instruct is unreliable.
# lang_code="german" forces native German phonemes regardless of instruct language.
_BASE_INSTRUCT = (
    "Deep German male voice, mid-40s, warm authoritative baritone, "
    "calm and measured, slight gravel in the low register, "
    "professional broadcast tone, steady pace, clear articulation, "
    "native German prosody. Speaks English words with correct English "
    "pronunciation and German words with correct German pronunciation."
)

_ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")
_ANTHROPIC_URL = os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
_HAIKU = "claude-haiku-4-5-20251001"

# Qwen3-TTS codec_language_id keys — full lowercase English names only.
# "de" / "auto" both fall through to English output. Always use full names.
_LANG_CODE = {"de": "german", "en": "english"}

_DE_CHARS = frozenset("äöüÄÖÜß")
_DE_WORDS = frozenset(
    "ich ist das der die und mit für auf sie wir aber nicht auch nach "
    "wie wenn war hat wird bin kann noch mehr sehr durch dann über "
    "zum zur vom bis aus bei alle schon jetzt hier gibt mein sein".split()
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


def _chunk_text(text: str, max_chars: int = 400) -> list[str]:
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    chunks: list[str] = []
    current = ""
    for s in sentences:
        if len(current) + len(s) + 1 <= max_chars:
            current = (current + " " + s).strip()
        else:
            if current:
                chunks.append(current)
            current = s
    if current:
        chunks.append(current)
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


async def _delivery_note(text: str) -> str:
    result = await _haiku(
        system=(
            "Given text that will be spoken aloud, write ONE short delivery note "
            "(half a sentence) in English for emotional tone and pacing of THIS specific content. "
            "Describe only delivery style, not voice character. "
            "Examples: 'calm and informative, steady pace' | 'warm with quiet energy' | "
            "'direct and focused'. Reply ONLY with the note, no quotes."
        ),
        user=text[:300],
        max_tokens=24,
    )
    return result.strip()


async def _synth_chunk(
    chunk: str,
    lang_code: str,
    instruct: str,
    client: httpx.AsyncClient,
) -> np.ndarray:
    r = await client.post(
        f"{_MLX_URL}/v1/audio/speech",
        json={
            "model": _TTS_MODEL,
            "input": chunk,
            "voice": "alloy",  # required field but ignored by VoiceDesign
            "response_format": "wav",
            "instruct": instruct,
            "lang_code": lang_code,
            "temperature": 0.7,
            "top_p": 0.95,
            "top_k": 40,
            "repetition_penalty": 1.05,
            "max_tokens": 2000,
        },
        timeout=120.0,
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
    lang_code = _LANG_CODE.get(lang, "auto")

    # 2. Speakable rewrite — only when text has markdown noise
    if len(text) > 150 and _needs_rewrite(text):
        spoken = await _rewrite_for_speech(text, lang)
    else:
        spoken = _strip_markdown(text)

    # 3. Title + delivery note in parallel
    if len(spoken) > 50 and _ANTHROPIC_KEY:
        title, delivery = await asyncio.gather(
            _make_title(spoken, lang),
            _delivery_note(spoken),
        )
    else:
        title = re.sub(r'[<>:"/\\|?*]', "", spoken[:40]).strip() or "Voice memo"
        delivery = ""

    # 4. Build instruct: base voice + per-message delivery
    instruct = f"{_BASE_INSTRUCT} {delivery}." if delivery else _BASE_INSTRUCT

    # 5. Chunk at sentence boundaries
    chunks = _chunk_text(spoken, req.max_chunk_chars)

    # 6. Synthesize sequentially (mlx-audio is single-threaded GPU)
    silence_50ms = np.zeros(int(0.05 * 24000), dtype=np.float32)
    audio_parts: list[np.ndarray] = []

    async with httpx.AsyncClient() as http:
        for i, chunk in enumerate(chunks):
            part = await _synth_chunk(chunk, lang_code, instruct, http)
            audio_parts.append(part)
            if i < len(chunks) - 1:
                audio_parts.append(silence_50ms)

    # 7. Concatenate → WAV → MP3
    combined = np.concatenate(audio_parts)
    duration_secs = round(len(combined) / 24000.0, 2)

    wav_tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    mp3_tmp = wav_tmp.name.replace(".wav", ".mp3")
    try:
        sf.write(wav_tmp.name, combined, 24000)
        wav_tmp.close()
        proc = subprocess.run(
            ["ffmpeg", "-i", wav_tmp.name, "-q:a", "4", "-y", "-loglevel", "error", mp3_tmp],
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
