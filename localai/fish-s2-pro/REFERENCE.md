# Fish S2 Pro — Reference

Authoritative notes for running Fish Audio S2 Pro locally on Apple Silicon via the
[`mlx-speech`](https://github.com/appautomaton/mlx-speech) library. Last verified: 2026-04-29.

## Why S2 Pro

Open-weight as of March 2026 (Fish Audio Research License — non-commercial). 5B-parameter
dual-AR architecture (4B slow AR + 400M fast AR), trained on 10M+ hours, 15,000+ free-form
prosody/emotion tags. Bradley-Terry blind-test score 3.07 vs ElevenLabs V3 at 1.90 on
production traffic (Fish Audio's own April 2026 study — directional, not impartial).

The 8-bit MLX port at [`appautomaton/fishaudio-s2-pro-8bit-mlx`](https://huggingface.co/appautomaton/fishaudio-s2-pro-8bit-mlx)
is 6.74 GB on disk, ~7 GB resident at runtime, and runs at ~21 tokens/sec on Apple Silicon.

## Install

Requires Python 3.13+. The library expects to live in its own `uv` tool venv —
do **not** mix with the existing `mlx-audio` venv (different MLX version pin).

```bash
uv tool install mlx-speech --python 3.13
```

The model auto-downloads from HF on first synthesis call. For ~6.7 GB on a typical
home connection, expect 5–15 minutes.

To use a specific local checkpoint, point `--model-dir` at the unpacked folder.

## Voice cloning is mandatory

S2 Pro has **no stock voice presets** — every synthesis call requires a paired
`reference_audio` + `reference_text` (the transcript of the reference). The model
copies the timbre and identity of the reference speaker.

**Reference clip requirements (observed, not strictly documented):**
- Format: WAV, 16-bit PCM, 24 kHz mono works reliably; the loader resamples
- Length: ~5–15 seconds; longer doesn't measurably help, shorter risks timbre instability
- Content: a clean spoken sentence or two — no music, ambient noise, or overlapping voices
- Transcript: must match the audio exactly. Whisper/Parakeet output works fine

**Voice cloning ≠ phonology transfer.** The reference clip determines *who the voice sounds like*.
It does **not** improve the model's German pronunciation when the underlying training tier
(Tier 2 for German) is the bottleneck. For German output, expect Tier-1 timbre quality with
Tier-2 prosody/rhythm naturalness.

### Reference clip cadence tuning (the +5% trick)

The model copies cadence from the reference clip, not just timbre. If a voice sounds technically
clean but emotionally flat ("Schlaftablette" register), speeding up the reference clip itself
before synthesis is more effective than post-processing the output:

```bash
ffmpeg -i ben_de.wav -af "atempo=1.05" ben_de_fast.wav
```

`atempo` preserves pitch — only the timing is compressed. Empirically tested on the production
"Ben" German reference: +5% reference-side speedup measurably improves perceived energy without
distorting the voice. **Post-processing the output instead** (atempo on the generated WAV) only
makes the same boring delivery faster.

Range that works: 1.03–1.08. Above ~1.10 the cadence starts feeling rushed.

The reference-side trick works because Fish S2 Pro encodes the reference's prosodic structure
into its conditioning — a faster reference means the model produces a faster baseline, *with
appropriately scaled pauses and emphasis durations*, not just a sped-up version of the slow output.

## CLI

```bash
mlx-speech tts --model fish-s2-pro \
  --text "Testing the system." \
  --reference-audio voices/daniel_en_uk.wav \
  --reference-text "Most great ideas appear in the quiet moments between tasks." \
  --max-new-tokens 1024 \
  -o out.wav
```

| Flag | Default | Effect |
|-|-|-|
| `--text` | required | Text to synthesize. Inline `[tag]` syntax for prosody. |
| `--reference-audio` | required | WAV path |
| `--reference-text` | required | Transcript of reference audio (must match) |
| `--max-new-tokens` | 1024 | Audio length cap. ~21.5 Hz codec → 1024 ≈ 47 s, 2048 ≈ 95 s |
| `--output` / `-o` | `outputs/fish_s2_pro.wav` | Output WAV path |
| `--model-dir` | auto-downloaded | Local path to the MLX checkpoint |
| `--codec-dir` | auto-downloaded | Local path to the codec submodel |
| `--trim-leading-silence` | False | Trim leading low-energy audio |
| `--normalize-peak` | 0.0 | Target peak amplitude normalization (0.0 = off) |

For sampling controls (`temperature`, `top_p`, `top_k`, etc.) you must call the
Python API or run `scripts/generate/fish_s2_pro.py` directly — the CLI doesn't
expose them. Defaults: `temperature=0.8, top_p=0.8, top_k=30, max_new_tokens=1024`.

## Python API

```python
from pathlib import Path
import mlx_speech

model = mlx_speech.tts.load("fish-s2-pro")  # downloads on first call
result = model.generate(
    text="Testing the system.",
    reference_audio="voices/daniel_en_uk.wav",
    reference_text="Most great ideas appear in the quiet moments between tasks.",
    max_new_tokens=1024,
)
# result.waveform: mx.array
# result.sample_rate: int
# result.generated_tokens: int
```

The lower-level entry point if you want every parameter:

```python
from mlx_speech.generation.fish_s2_pro import generate_fish_s2_pro
```

## Token cost

- Plain text: **~1.0 tokens per character**
- With emotion tags: **~1.8–2.0 tokens per character**

For a 240-character paragraph with moderate tagging, budget `max_new_tokens=512`. For
a podcast paragraph with heavy tagging, budget 1024–1536.

If you cap too low, audio truncates mid-sentence. Better to over-budget — unused
tokens cost nothing at sample time.

## Emotion / Prosody Tags

S2 Pro's killer feature. The model accepts arbitrary natural-language tags inside
`[brackets]`. Fish's training set covers 15,000+ unique tags. The categories below
are the most reliable; arbitrary phrases like `[in a thoughtful tone]` or
`[mock-serious]` also work but with less consistency.

**Vocal effects:**
`[pause]` `[short pause]` `[inhale]` `[exhale]` `[clearing throat]`
`[laughing]` `[chuckle]` `[chuckling]` `[sigh]` `[moaning]` `[panting]`
`[audience laughter]`

**Emotion:**
`[excited]` `[angry]` `[sad]` `[surprised]` `[shocked]` `[delight]`
`[happy]` `[serious]` `[tender]`

**Volume:**
`[volume up]` `[volume down]` `[low volume]` `[loud]` `[screaming]` `[shouting]`

**Voice quality:**
`[whisper]` `[low voice]` `[singing]` `[with strong accent]`

**Prosody:**
`[emphasis]` `[laughing tone]` `[excited tone]` `[pitch up]` `[pitch down]`
`[professional broadcast tone]` `[narrator tone]` `[dramatic]`

**Effects:**
`[echo]` `[interrupting]`

### Tag placement rules

- Tags affect the text that **follows** them until the next tag or strong punctuation
- Stack carefully — `[whisper] [excited]` is undefined; pick one
- Place `[pause]` between sentences, not mid-clause, unless you want a beat
- Punctuation still drives natural prosody — don't over-tag what punctuation already does

### Patterns that work well in practice

```
[chuckle] You won't believe what happened.
[pause] At first I thought I was hallucinating.
[whisper] Just between us — this is the part nobody talks about.
[excited] And then it hit me.
[sigh] Six months. Six whole months.
```

## Languages

| Tier | Languages |
|-|-|
| 1 (full quality) | Japanese, English, Chinese |
| 2 (strong) | Korean, Spanish, Portuguese, Arabic, Russian, French, German |
| 3 (supported) | 70+ additional languages |

**Tier 2 means less training data, not "speaks with English accent."** For German you
get coherent native pronunciation but flatter prosody and a more generic rhythm than
a Tier-1 model would produce. We compensate by:
1. Using a high-quality real German reference clip (Pip Klöckner)
2. Pre-processing the reference: Audacity-cut + smile EQ baked in
3. Post-processing the output with the same smile EQ chain via ffmpeg

This stack measurably outperformed Voxtral 4B TTS (which was Tier-1 native German
but emotionally flat) in side-by-side listening tests.

## Performance on Apple Silicon

Measured loosely on M2 Pro 32 GB (the host this playground runs on):

| Operation | Time |
|-|-|
| First model load (cold) | ~8–12 s |
| Subsequent load (warm in launchd) | ~3 s |
| Synthesis | ~21 tokens/s → roughly 1× real-time at 24 kHz |
| Memory resident | ~7 GB (model) + ~500 MB (codec) |

For interactive usage (Slack memos), warm-up at launchd startup once, then 3-second
input → 5-second wait → 3-second audio is realistic.

For batch (audiobook) usage, plan ~1.5–2× wall time per minute of audio plus the
overhead of paragraph-aware chunking.

## Architecture

- **5B params** — 4B slow AR (semantic content) + 400M fast AR (acoustic detail)
- **Codec** — RVQ with 10 codebooks at ~21.5 Hz frame rate
- **Output** — 24 kHz mono PCM
- **Inference** — int8 weights, MLX kernels, Apple Silicon-only

## Known limitations

- **Long generations drift** — past ~2048 tokens the timbre can wander. For long-form,
  chunk at paragraph boundaries (≤ 600 chars) and concatenate. The existing localai-helper
  chunking strategy (paragraphs → sentences) ports cleanly.
- **No instruct prompt** — you cannot pass a system message describing the desired
  tone. Tone control is entirely via the reference clip + inline emotion tags.
- **Reference clip leakage** — if the reference clip has background music or ambient noise,
  it will bleed into the output. Use clean isolated speech.
- **Tag explosions** — sequences of 3+ adjacent tags can produce unstable output. Keep tags
  spread across the text.

## License

Fish Audio Research License. Free for research and non-commercial. Commercial use
requires a separate license: business@fish.audio.

## Production wiring (already done)

Fish S2 Pro is the production TTS engine. The wiring:

1. `com.localai.fish` launchd service runs `bin/start-fish.sh` → `fish-s2-pro/server.py`
   on `127.0.0.1:8002`. Model warm-loaded at boot.
2. `localai/helper/routes/tts.py` calls `:8002/v1/audio/speech` with `voice: "de"|"en"`
   based on language detection. Helper-side stays dumb about which clip backs each language.
3. Production references and the smile EQ chain live in `fish-s2-pro/`. The EQ chain
   string is the single source of truth in `server.py:SMILE_EQ_CHAIN`.

To swap a reference clip: replace `voices/<id>.{wav,txt,json}` and restart the service
(`launchctl kickstart -k gui/$(id -u)/com.localai.fish`).

## See also

- [`appautomaton/mlx-speech` README](https://github.com/appautomaton/mlx-speech)
- [`fishaudio/s2-pro` model card](https://huggingface.co/fishaudio/s2-pro)
- [Fish Audio S2 Pro 8-bit MLX](https://huggingface.co/appautomaton/fishaudio-s2-pro-8bit-mlx)
- [Original Fish S2 paper / blog](https://fish.audio)
