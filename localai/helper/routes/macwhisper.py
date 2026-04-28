"""OpenAI verbose_json shape compat for STT clients that need it.

MacWhisper (and strict OpenAI clients) reject mlx-audio's native
`{text, sentences}` Parakeet shape with errors like "Ohne Transkription
beendet". OpenAI's verbose_json format is `{text, segments, language,
duration, task}`. This route forwards to mlx-audio and rewrites the
response keys.

POST /v1/audio/transcriptions  (multipart form, OpenAI-compatible)
"""

import json
import os

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

router = APIRouter()
UPSTREAM = os.environ.get("LOCALAI_HELPER_UPSTREAM", "http://127.0.0.1:8000")
TIMEOUT = httpx.Timeout(300.0, connect=10.0)


@router.post("/v1/audio/transcriptions")
async def transcribe(request: Request):
    body = await request.body()
    headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in ("host", "content-length", "accept-encoding")
    }
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.post(
            f"{UPSTREAM}/v1/audio/transcriptions",
            content=body,
            headers=headers,
        )
    if r.status_code >= 400:
        return Response(
            content=r.content, status_code=r.status_code, media_type=r.headers.get("content-type")
        )

    # mlx-audio sends NDJSON (one JSON line). Take the first line.
    text_body = r.text.strip()
    first_line = text_body.split("\n", 1)[0] if text_body else "{}"
    try:
        data = json.loads(first_line)
    except json.JSONDecodeError:
        return Response(content=r.content, status_code=502, media_type="text/plain")

    text = data.get("text", "")
    sentences = data.get("sentences") or []

    segments = []
    for i, s in enumerate(sentences):
        tokens = s.get("tokens") or []
        token_ids = [t.get("id") for t in tokens if isinstance(t, dict) and t.get("id") is not None]
        segments.append(
            {
                "id": i,
                "seek": 0,
                "start": float(s.get("start") or 0.0),
                "end": float(s.get("end") or 0.0),
                "text": s.get("text", ""),
                "tokens": token_ids,
                "temperature": 0.0,
                "avg_logprob": 0.0,
                "compression_ratio": 1.0,
                "no_speech_prob": 0.0,
            }
        )

    duration = max((seg["end"] for seg in segments), default=0.0)
    language = data.get("language") or "english"

    return JSONResponse(
        {
            "task": "transcribe",
            "language": language,
            "duration": duration,
            "text": text,
            "segments": segments,
        }
    )
