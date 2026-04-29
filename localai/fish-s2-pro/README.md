# Fish S2 Pro — Local TTS

Production setup for using Fish Audio S2 Pro as the TTS engine on this Mac,
plus a playground for evaluation. Replaces Voxtral 4B TTS for English and
German output in Hermes (when wired in — see "Production wiring" below).

## Final voice config — LOCKED

| Lang | Voice ID | Reference clip | Output post-process |
|-|-|-|-|
| **de** | `pip_cut_smile_de` | Pip Klöckner snippet (8:01–8:28 from `memo.m4a`), manually cut in Audacity to remove breaths/fillers, then smile EQ chain applied to the reference itself | Smile EQ chain applied via ffmpeg |
| **en** | `ethan_en` *or* `james_en` (TBD — listen and pick) | fish.audio S2 demo voices ("head_stand" and "merge_conflicts") | None (matches fish.audio demo quality as-is) |

### The German production pipeline

```
Input text
  ↓ Fish S2 Pro synthesize (reference: voices/pip_cut_smile_de.wav)
  ↓ ffmpeg smile EQ: highpass=70 + scoop@600Hz -3dB + presence@5.5kHz +3dB + air@12kHz +1.5dB + loudnorm -18 LUFS
  ↓ Output WAV
```

The smile EQ is applied **twice on purpose** — once on the reference clip (during voice creation) and once on the synthesized output. The first one shapes the voice character Fish learns; the second compensates for any midrange mud that creeps back in during synthesis and brings the output to broadcast loudness.

### Lessons captured during evaluation

- **+5% atempo on the reference clip** (`ben_fast_de` trick) added energy for Ben but wasn't needed for Pip — Pip's natural cadence is already engaging
- **+5% atempo on the output** was tested across 7 scripts and rejected — it sounded just as good without speedup, and the speedup occasionally introduced subtle artifacts on long pauses
- **Voice cloning ≠ phonology transfer** — even with a perfect reference, Fish's Tier-2 German pronunciation is the bottleneck; switching to a Tier-1 model would help more than reference tweaks
- **Reference clip quality dominates** — the entire arc from "Daniel UK system voice" (synthetic→synthetic, terrible) to "Pip Klöckner Audacity-cut + EQ" (real human, processed) was 30 minutes of listening tests; this lesson is repeated on the audio side at every level

## Quick start

```bash
# (one-time) install mlx-speech
uv tool install mlx-speech --python 3.13

# (one-time) Caddy entry — fish-playground.test → :8002
caddy reload --config $(brew --prefix)/etc/Caddyfile

# launch the playground
./playground/run.sh

# open https://fish-playground.test
```

First synthesis triggers the 6.7 GB model download (~10 min). After that,
warm-loaded model in the playground server gives ~20 s synthesis for short
clips, ~90 s for paragraphs.

## Layout

| Path | Purpose |
|-|-|
| `voices/` | Reference clips: `ben_de.{wav,txt,json}` + `ethan_en.*` + `james_en.*` |
| `scripts/` | 7 demo scripts (5 EN + 2 DE) |
| `samples/` | Pre-generated comparison matrix + `manifest.json` + on-demand cache |
| `playground/server.py` | FastAPI server :8002, model warm-loaded, /api/synthesize for live text |
| `playground/index.html` | Single-page UI |
| `playground/pregenerate_via_server.py` | Builds the matrix via warm server (~20× faster than CLI subprocess) |
| `playground/run.sh` | uv launcher |
| `REFERENCE.md` | Fish S2 Pro API docs, parameters, emotion tag taxonomy |

## Adding a voice

```
voices/<id>.wav        # 5–15 s clean speech, mono
voices/<id>.txt        # exact transcript
voices/<id>.json       # {"label": "...", "lang": "en|de", "source": "...", "description": "..."}
```

Reload the page — the voice appears in the picker. Run `pregenerate_via_server.py`
to fill in matrix entries (cached entries are skipped automatically).

## Production wiring (when ready)

Currently the playground is **standalone** (foreground process, port 8002,
not in launchd). To promote this into the actual Hermes pipeline:

1. **Add a launchd service** mirroring `localai/com.localai.audio.plist.template`
   for a Fish S2 Pro server on `:8003`. Reuse `playground/server.py` — it
   already does the warm-load + synthesis. Add a smile-EQ post-process step
   in the synthesize handler before returning the WAV.

2. **Update `localai/helper/routes/tts.py`**:
   - Replace `_VOICE_MAP` with engine dispatch:
     - `de` → Fish S2 Pro on `:8003` with `voice_id=pip_cut_smile_de` + smile EQ post
     - `en` → Fish S2 Pro on `:8003` with `voice_id=ethan_en` (or `james_en`), no post
   - The smile EQ chain lives in `playground/postprocess_pip_smile.py:SMILE_EQ_CHAIN` —
     port that constant into the production helper

3. **Drop Voxtral entirely.** Free 2.5 GB RAM. The localai-helper STT path
   (Parakeet) stays as-is.

4. **Inject emotion tags in the Haiku rewrite stage** — when input is
   markdown-heavy and gets rewritten, also add `[chuckle]`, `[pause]`,
   `[emphasis]` where natural. This is where Fish's expressiveness pays off.

License caveat: Fish Audio Research License is non-commercial. Personal
Hermes use is fine. Don't ship into anything customer-facing without
licensing it from Fish Audio.

## Reference voice maintenance

The signed Cloudflare R2 URLs for fish.audio voices expire after 1 hour.
The downloaded WAVs in `voices/` are permanent — no re-download needed.
But if you want to source a new fish.audio voice in the future, use Chrome
DevTools to capture a fresh signed URL while the page plays the audio.
