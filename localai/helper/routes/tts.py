"""Long-form TTS orchestration via Fish S2 Pro.

POST /v1/tts/synthesize
  Body (JSON):
    text:            str   — text to speak (any length)
    lang_hint:       str?  — "de" | "en" | None (auto-detect)
    max_chunk_chars: int?  — paragraph/sentence chunk size, default 1800

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
  4. Hierarchical chunking — paragraphs first, then pysbd-segmented sentences
     within an oversized paragraph. Each chunk carries its trailing-break
     type ("paragraph"|"sentence"|"end") so the assembler can pick the right
     pause length.
  5. Synthesize each chunk via Fish S2 Pro (:8002), passing voice="de"|"en"
     and post_process=False (post-processing happens once after concat).
     max_new_tokens scales with chunk length: ceil(chars * 2.5) + 512.
  6. 5 ms linear fades on chunk edges; break-aware silence between chunks
     (300 ms after a sentence break, 600 ms after a paragraph break).
  7. Single ffmpeg pass over the concatenated audio: smile EQ + loudnorm
     for German, loudnorm-only for English. Then WAV → MP3 → base64 JSON.

Voice references and the smile EQ chain live in `localai/fish-s2-pro/`.
The chain string is mirrored here (see _SMILE_EQ_CHAIN) because the two
processes can't share a Python import — keep them in sync if either changes.

Credentials: ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL injected by
start-localai-helper.sh from macOS Keychain. If absent, Haiku calls
are skipped and fallbacks apply (no rewrite, title = first words).
"""

import asyncio
import base64
import io
import math
import os
import re
import subprocess
import tempfile

import httpx
import numpy as np
import pysbd
import soundfile as sf
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

_FISH_URL = os.getenv("LOCALAI_FISH_URL", "http://127.0.0.1:8002")

_ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")
_ANTHROPIC_URL = os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
_HAIKU = "claude-haiku-4-5-20251001"

# Fish output sample rate. mlx-speech's Fish S2 Pro codec is 44.1 kHz native
# (the HF model card's "24 kHz" claim is wrong — verified against
# mlx_speech/models/fish_s2_pro/codec_config.py and the S2 paper §3.1).
_SAMPLE_RATE = 44100

# Mirror of localai/fish-s2-pro/server.py:SMILE_EQ_CHAIN. Static EQ filters
# only — loudnorm runs separately as a single pass after concat to avoid
# per-chunk loudness drift. Keep this string in sync with the fish server.
_SMILE_EQ_CHAIN = (
    "highpass=f=70,"
    "equalizer=f=600:t=q:w=2.5:g=-3,"
    "equalizer=f=5500:t=q:w=2.5:g=3,"
    "equalizer=f=12000:t=q:w=2:g=1.5"
)
# EBU R128 target — Spotify/Apple briefing convention.
_LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11"

# Pause lengths between concatenated chunks. Calibrated to spoken German
# news cadence: a sentence break is a beat, a paragraph break is a breath.
_PAUSE_AFTER = {
    "sentence": 0.30,
    "paragraph": 0.60,
    "end": 0.0,
}
# Linear fade applied at each chunk edge to suppress codec boundary pops.
_EDGE_FADE_MS = 5

_DE_CHARS = frozenset("äöüÄÖÜß")
_DE_WORDS = frozenset(
    # high-frequency German tokens that are not English homographs
    "ich ist das der die und mit für auf sie wir aber nicht auch nach "
    "wie wenn war hat wird bin kann noch mehr sehr durch dann über "
    "zum zur vom bis aus bei alle schon jetzt hier gibt mein sein "
    "im am ein eine einen einer eines kein keine "
    "heute morgen gestern dies diese dieser dieses jenen jener "
    "drei vier fünf sechs sieben acht neun zehn "
    "ja nein doch genau klar gut schlecht "
    "haben hatten waren sind seid wart "
    "läuft funktioniert oder also immer wieder nichts etwas "
    "uhr stunde minute sekunde freitag samstag sonntag montag "
    "dienstag mittwoch donnerstag januar februar märz april mai juni "
    "juli august september oktober november dezember".split()
)


class TTSRequest(BaseModel):
    text: str
    lang_hint: str | None = None
    # M2 Pro 32 GB Metal allocator caps single buffers at ~20 GB. Fish's
    # attention scratch grows past that around the 1300-char mark, crashing
    # the worker (libc++abi: [metal::malloc] Attempting to allocate >20 GB).
    # 800 chars produces ~50 s of audio per chunk and stays comfortably under
    # the cap on every Mac we run on. Bigger Apple Silicon (M2/M3 Max with
    # more unified memory) can override this per-request.
    max_chunk_chars: int = 800
    # Per-request override of the silence inserted between paragraph-boundary
    # chunks. Default (None) keeps the standard ~0.6s breath. Use this for
    # multi-section briefings where a noticeably longer beat between sections
    # improves comprehension (~1.5–2.5s feels natural without sounding stalled).
    paragraph_pause_secs: float | None = None


class TTSResponse(BaseModel):
    title: str
    audio_b64: str
    duration_secs: float
    chunks: int
    lang: str


# ---------- language detection ----------


def _detect_lang(text: str) -> str:
    words = re.findall(r"\b\w+\b", text.lower())
    de_chars = sum(1 for c in text if c in _DE_CHARS)
    de_words = sum(1 for w in words if w in _DE_WORDS)
    # Threshold of 1 on either signal: short German phrases like "Fish S2 Pro
    # läuft." (one umlaut, no strong DE word) used to fall through to English
    # under the old threshold of 2. The cost is misclassifying rare English
    # text containing an umlaut as German — we prefer the failure mode where
    # German always picks the German reference clip.
    return "de" if (de_chars >= 1 or de_words >= 1) else "en"


# ---------- markdown handling ----------


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


# ---------- sentence-aware chunking ----------

# pysbd is heavy to instantiate (regex compilation) — keep one Segmenter per
# language for the process lifetime.
_SEGMENTERS: dict[str, pysbd.Segmenter] = {}


def _segmenter(lang: str) -> pysbd.Segmenter:
    seg = _SEGMENTERS.get(lang)
    if seg is None:
        # pysbd supports language="de"/"en" with abbreviation lists tuned per
        # language. clean=False preserves whitespace so we can re-join cleanly.
        seg = pysbd.Segmenter(language=lang if lang in {"de", "en"} else "en", clean=False)
        _SEGMENTERS[lang] = seg
    return seg


def _split_sentences(text: str, lang: str) -> list[str]:
    sentences = [s.strip() for s in _segmenter(lang).segment(text) if s and s.strip()]
    return sentences or [text]


def _chunk_text(
    text: str,
    lang: str,
    max_chars: int,
    *,
    preserve_paragraphs: bool = False,
) -> list[tuple[str, str]]:
    """Hierarchical splitter: paragraphs first, then sentences within.

    Returns ``[(chunk_text, trailing_break_type), …]`` where the break type is
    "paragraph" if the next chunk starts a new paragraph, "sentence" if it
    continues the current paragraph, and "end" for the last chunk.

    Rationale: paragraph boundaries deserve a longer pause (breath) than
    mid-paragraph sentence boundaries (beat). Tracking the type per chunk lets
    the assembler insert appropriately scaled silence.

    ``preserve_paragraphs=True`` skips the phase-2 greedy merge of short
    paragraphs into the previous chunk. Use this when the caller has placed
    paragraph breaks deliberately (e.g. a multi-section briefing) and wants
    each paragraph to be synthesized — and paused after — as its own beat.
    """
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text.strip()) if p.strip()]
    if not paragraphs:
        return [(text, "end")]

    # Phase 1: split each paragraph into sub-chunks ≤ max_chars on sentence
    # boundaries. Keep paragraph identity so phase 2 can attach break types.
    para_chunks: list[list[str]] = []
    for para in paragraphs:
        if len(para) <= max_chars:
            para_chunks.append([para])
            continue
        sentences = _split_sentences(para, lang)
        bucket = ""
        sub: list[str] = []
        for s in sentences:
            if not s:
                continue
            # Sentence longer than max_chars on its own — emit it solo. Fish
            # handles oversized chunks via its own context window; better one
            # long chunk than a mid-sentence break.
            if len(s) > max_chars and not bucket:
                sub.append(s)
                continue
            join = (bucket + " " + s).strip() if bucket else s
            if len(join) <= max_chars:
                bucket = join
            else:
                if bucket:
                    sub.append(bucket)
                bucket = s
        if bucket:
            sub.append(bucket)
        para_chunks.append(sub)

    # Phase 2: greedily merge whole paragraphs across the chunk boundary when
    # the previous paragraph fit in a single sub-chunk and the combined size
    # stays within max_chars. This keeps short paragraphs (a single date line,
    # a one-sentence reminder) from each becoming their own model call.
    chunks: list[tuple[str, str]] = []
    i = 0
    while i < len(para_chunks):
        sub = para_chunks[i]
        # Merge with previous if previous was a single sub-chunk and so is sub
        # — unless the caller asked us to preserve paragraph identity.
        if (
            not preserve_paragraphs
            and chunks
            and len(sub) == 1
            and chunks[-1][1] == "paragraph"
            and len(chunks[-1][0]) + 2 + len(sub[0]) <= max_chars
        ):
            prev_text, _ = chunks[-1]
            chunks[-1] = (prev_text + "\n\n" + sub[0], "paragraph")
        else:
            for j, c in enumerate(sub):
                # Mid-paragraph splits get a sentence break; the last sub of
                # a paragraph gets a paragraph break (overwritten to "end" at
                # the very end below).
                brk = "paragraph" if j == len(sub) - 1 else "sentence"
                chunks.append((c, brk))
        i += 1

    # Final chunk should signal end-of-stream (no trailing silence).
    if chunks:
        last_text, _ = chunks[-1]
        chunks[-1] = (last_text, "end")
    return chunks or [(text, "end")]


# ---------- audio helpers ----------


def _silence(secs: float) -> np.ndarray:
    n = max(0, int(secs * _SAMPLE_RATE))
    return np.zeros(n, dtype=np.float32)


def _fade_edges(audio: np.ndarray, ms: int = _EDGE_FADE_MS) -> np.ndarray:
    """In-place 5ms linear fade in + out. Suppresses codec boundary clicks."""
    n = max(1, int(ms * _SAMPLE_RATE / 1000))
    n = min(n, len(audio) // 2)
    if n <= 0:
        return audio
    ramp = np.linspace(0.0, 1.0, n, dtype=np.float32)
    audio[:n] *= ramp
    audio[-n:] *= ramp[::-1]
    return audio


def _budget_max_new_tokens(chars: int) -> int:
    """Audio-token budget at the codec's 21.5 Hz frame rate.

    Spoken German runs ~14 chars/sec; codec emits 21.5 audio tokens/sec.
    Empirical multipliers (Fish S2 paper + mlx-speech profiling):
      chars * 1.54 — plain narration
      chars * 2.20 — heavy prosody tagging
    We use 2.0 + 384 absolute headroom to cover both regimes without
    leaving so much slack that a misbehaving generation can run for
    20+ minutes before the runtime gives up. Cap at 2400 (~1.9 min audio,
    matches the 800-char chunk default and the M2 Pro Metal envelope).

    The runtime breaks on EOS — over-budget cycles cost nothing if the
    model stops cleanly. Under-budget hard-cuts mid-word with no error.
    """
    return min(2400, math.ceil(chars * 2.0) + 384)


# ---------- Haiku helpers ----------


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


_SPEAKABLE_SYSTEM_DE = """Du wandelst Nachrichten in natürliche, gesprochene deutsche Prosa um und reicherst sie mit Fish S2 Pro Prosodie-Tags an. Antworte AUSSCHLIESSLICH mit dem umgeschriebenen Text — keine Erklärungen, keine Anführungszeichen.

GRUNDREGELN:
- Sprache: Deutsch beibehalten. Keine Begrüßung, keine Anrede mit Namen.
- Markdown entfernen: Aufzählungen zu fließenden Sätzen, Bold/Italic strippen, Headlines weg, URLs weg, Code in einfache Worte umschreiben.
- Alle Informationen erhalten — nichts kürzen.
- Klingen wie gesprochen, nicht wie geschrieben (kürzere Sätze, natürliche Konnektoren wie "dann", "und außerdem", "übrigens").

PROSODIE-TAGS — verwende sie aktiv. Tags wirken auf den FOLGENDEN Text bis zum nächsten Tag oder starkem Satzzeichen.

ANKER (genau EINMAL ganz am Anfang setzen, bestimmt den Grundton):
- [professional broadcast tone] [warm] — Standard für Briefings, Updates, Status, Tagesüberblick. Default für deutsche Sprachnachrichten.
- [narrator tone] — etwas erzählender, für längere Geschichten oder Recaps.
- [serious] — für Warnungen, Alerts, kritische Statusmeldungen.

UNIVERSELL SICHER (großzügig einsetzen, sie tragen den Großteil der Lebendigkeit):
- [emphasis] — betont das nächste Wort/die Phrase. Setze 2–4 Mal pro Absatz auf das WICHTIGSTE Wort jedes Satzes (eine Zahl, ein Name, ein Schlüsselverb). NICHT auf jeden Satz.
- [pause] — ~1 Sekunde echter Beat. Setze einen [pause] zwischen jedem Themenwechsel (Wetter → Termine → Inbox → Infrastruktur etc.) und vor jeder Pointe. Etwa einer pro 2–3 Sätze. (Hinweis: [short pause] wirkt im Deutschen kaum hörbar — immer [pause] benutzen.)

EMOTIONALE TAGS (deutsche Tier-2-Stimme: am Satzanfang klingen sie leicht gekünstelt — nutze sie nur, wenn der Inhalt sie wirklich verlangt):
- [excited] — bei guten Nachrichten, Erfolgen, Plänen ("Heute Abend wird es großartig").
- [delight] — bei netten Überraschungen, freudigen Momenten.
- [sigh] — bei Frust, Aufgabe, Resignation ("Das hätten wir uns sparen können").
- [serious] — bei Warnungen mitten im Text.
- [chuckle] / [laughing] — bei tatsächlich Lustigem; spürbar weicher Effekt im Deutschen, also wirklich nur bei Witzen.
- [whisper] / [low voice] — für Insider-Bemerkungen, vertrauliche Asides.

PLATZIERUNG:
- Nicht 3+ Tags direkt hintereinander (außer dem Anker am Anfang).
- Was Satzzeichen schon machen, NICHT taggen (Fragezeichen hebt die Stimme bereits).
- Bei reinen Aufzählungen: Konnektoren wie "erstens, zweitens, drittens" einbauen, dann [emphasis] auf das jeweilige Hauptwort.

BEISPIELE:

Eingabe: "Wetter München: 18°C, sonnig. Standup 9:30, Architektur-Review um 11. Inbox: 1 Erinnerung, 2 Newsletter."
Ausgabe: [professional broadcast tone] [warm] In München heute [emphasis] achtzehn Grad und Sonne. [pause] Im Kalender steht zuerst der Standup um neun Uhr dreißig, danach das [emphasis] Architektur-Review um elf. [pause] In der Inbox eine Erinnerung und zwei Newsletter — nichts Dringendes.

Eingabe: "Alle Server up, garmin-sync ist seit drei Tagen unhealthy. HR-Dashboard repariert."
Ausgabe: [professional broadcast tone] [warm] Alle Server laufen, [pause] mit einer Ausnahme: garmin-sync ist jetzt den [emphasis] dritten Tag in Folge unhealthy. Das HR-Dashboard ist [emphasis] wieder repariert."""

_SPEAKABLE_SYSTEM_EN = """You convert messages into natural spoken English prose enriched with Fish S2 Pro prosody tags. Reply with ONLY the rewritten text — no commentary, no quotes.

GROUND RULES:
- Keep language: English. No greeting, no addressing the listener by name.
- Strip markdown: bullets become flowing sentences, no bold/italic, drop headers, omit URLs, describe code in plain words.
- Preserve every piece of information.
- Sound spoken, not written (shorter sentences, natural connectors like "then", "also", "by the way").

PROSODY TAGS — use them actively. Each tag affects the text that FOLLOWS until the next tag or strong punctuation.

ANCHORS (place EXACTLY ONCE at the very start to set overall register):
- [professional broadcast tone] [warm] — default for briefings, updates, status, daily summaries.
- [narrator tone] — slightly more theatrical, for stories or longer recaps.
- [serious] — for warnings, alerts, critical status.

ALWAYS-SAFE (use generously — these carry most of the life):
- [emphasis] — stresses the next word/phrase. 2–4 per paragraph on the MOST important word in each sentence (a number, a name, a key verb). Not on every sentence.
- [pause] — ~1 s real beat. One between every topic change (weather → calendar → inbox → infra) and before any punchline. ~1 per 2–3 sentences. ([short pause] is barely audible in practice — use [pause].)

EMOTIONAL TAGS (Tier-1 English: full set works naturally — use them when the content has the actual emotion):
- [excited] — good news, plans, wins.
- [delight] — pleasant surprises.
- [chuckle] / [laughing] — actual jokes.
- [sigh] — frustration, exhaustion.
- [whisper] / [low voice] — confidential asides.
- [sad] / [shocked] / [serious] — when content matches.

PLACEMENT:
- Don't stack 3+ tags adjacent (except the opening anchor).
- Don't tag what punctuation already does (a question mark already raises pitch).
- For raw lists: add connectors ("first, second, third") then [emphasis] on the headword.

EXAMPLES:

Input: "Munich weather: 18°C sunny. Standup at 9:30, architecture review at 11. Inbox: 1 reminder, 2 newsletters."
Output: [professional broadcast tone] [warm] Munich today: [emphasis] eighteen degrees and sunny. [pause] On the calendar, standup at nine thirty, then the [emphasis] architecture review at eleven. [pause] Inbox has one reminder and two newsletters — nothing urgent.

Input: "All servers up, garmin-sync unhealthy 3rd day. HR dashboard fixed."
Output: [professional broadcast tone] [warm] All servers up, [pause] with one exception: garmin-sync is now on its [emphasis] third day unhealthy. The HR dashboard is [emphasis] back online."""


async def _rewrite_for_speech(text: str, lang: str) -> str:
    system = _SPEAKABLE_SYSTEM_DE if lang == "de" else _SPEAKABLE_SYSTEM_EN
    result = await _haiku(
        system=system,
        user=text[:4000],
        # Enriched output is ~1.2-1.5x input length (tags + connectors).
        # 2048 tokens ≈ 6000 chars, plenty for the largest single rewrite
        # we'd ever pass (the helper chunks AFTER rewrite).
        max_tokens=2048,
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


# ---------- synthesis ----------


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
            "voice": lang,
            "response_format": "wav",
            "max_new_tokens": _budget_max_new_tokens(len(chunk)),
            # Skip per-chunk EQ — we apply it once after concat to avoid
            # boundary loudness drift and save N-1 ffmpeg fork+exec cycles.
            "post_process": False,
        },
        # Cold M2 Pro can take ~3 audio-tokens/sec on the first chunks before
        # MLX kernels are fully warm; budget cap × worst-case rate ≈ 1600 s.
        # Set timeout above that so a hot-cap generation completes rather
        # than dying mid-stream.
        timeout=1800.0,
    )
    r.raise_for_status()
    audio, _ = sf.read(io.BytesIO(r.content), dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1).astype(np.float32)
    return _fade_edges(np.ascontiguousarray(audio))


def _post_process(combined: np.ndarray, lang: str) -> bytes:
    """Single ffmpeg pass: smile EQ (DE only) + loudnorm. Returns MP3 bytes."""
    chain_parts: list[str] = []
    if lang == "de":
        chain_parts.append(_SMILE_EQ_CHAIN)
    chain_parts.append(_LOUDNORM)
    af = ",".join(chain_parts)

    wav_buf = io.BytesIO()
    sf.write(wav_buf, combined, _SAMPLE_RATE, format="WAV", subtype="PCM_16")
    proc = subprocess.run(
        [
            "ffmpeg", "-loglevel", "error",
            "-i", "pipe:0",
            "-af", af,
            "-ar", str(_SAMPLE_RATE),
            "-ac", "1",
            "-codec:a", "libmp3lame", "-q:a", "4",
            "-f", "mp3", "pipe:1",
        ],
        input=wav_buf.getvalue(),
        capture_output=True,
        timeout=180,
    )
    if proc.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"ffmpeg post-process failed: {proc.stderr.decode()[-300:]}",
        )
    return proc.stdout


@router.post("/v1/tts/synthesize", response_model=TTSResponse)
async def synthesize(req: TTSRequest) -> TTSResponse:
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    # 1. Language detection
    lang = req.lang_hint or _detect_lang(text)

    # 2. Speakable rewrite — fires for anything substantial. The Haiku call
    # not only strips markdown but also injects Fish S2 Pro prosody tags
    # ([professional broadcast tone] [warm] anchor + [emphasis] on key words
    # + [short pause] between topics). Skip for short replies (<80 chars)
    # where tags add no value and the input is already speakable.
    if len(text) >= 80 and _ANTHROPIC_KEY:
        spoken = await _rewrite_for_speech(text, lang)
    else:
        spoken = _strip_markdown(text)

    # 3. Title (single Haiku call)
    if len(spoken) > 50 and _ANTHROPIC_KEY:
        title = await _make_title(spoken, lang)
    else:
        title = re.sub(r'[<>:"/\\|?*]', "", spoken[:40]).strip() or "Voice memo"

    # 4. Chunk at paragraph + sentence boundaries.
    # When the caller passes paragraph_pause_secs, they're declaring the
    # paragraphs are deliberate section beats — preserve them and don't
    # let the phase-2 merge collapse short sections back into one chunk.
    chunks = _chunk_text(
        spoken,
        lang,
        req.max_chunk_chars,
        preserve_paragraphs=req.paragraph_pause_secs is not None,
    )

    # 5. Synthesize sequentially. Fish has an internal synth lock; concurrent
    # requests would just queue inside the server, so serializing here saves
    # the round-trip overhead.
    audio_parts: list[np.ndarray] = []
    pause_overrides = dict(_PAUSE_AFTER)
    if req.paragraph_pause_secs is not None and req.paragraph_pause_secs >= 0:
        pause_overrides["paragraph"] = float(req.paragraph_pause_secs)
    async with httpx.AsyncClient() as http:
        for chunk_text, brk in chunks:
            part = await _synth_chunk(chunk_text, lang, http)
            audio_parts.append(part)
            pause = pause_overrides.get(brk, 0.0)
            if pause > 0:
                audio_parts.append(_silence(pause))

    # 6. Concatenate → ffmpeg post-process (EQ + loudnorm) → MP3
    combined = np.concatenate(audio_parts) if audio_parts else _silence(0.1)
    duration_secs = round(len(combined) / _SAMPLE_RATE, 2)
    mp3_bytes = await asyncio.to_thread(_post_process, combined, lang)
    audio_b64 = base64.b64encode(mp3_bytes).decode()

    return TTSResponse(
        title=title,
        audio_b64=audio_b64,
        duration_secs=duration_secs,
        chunks=len(chunks),
        lang=lang,
    )
