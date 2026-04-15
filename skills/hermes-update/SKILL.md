---
name: hermes-update
description: Update Hermes Agent to latest version, resolve conflicts in locally-modified source files, and restart the gateway
---

# hermes-update

Updates `~/.hermes/hermes-agent/` from upstream, re-applies local customizations if upstream changed the same files, then restarts the gateway.

## Run the update

```bash
hermes update
```

Then check what happened:

```bash
cd ~/.hermes/hermes-agent && git status --short
```

If clean: jump straight to **Restart**. If conflicts or unexpected changes: see below.

---

## Known local modifications

These files have been customized beyond upstream defaults. Re-apply if upstream overwrote them.

### `tools/tts_tool.py`

**What was added and why:**

1. **`_prepare_tts_metadata(text, default_instruct) → (title, instruct)`**
   A function that calls the compression auxiliary model (local Gemma 4) with a single prompt to produce two things:
   - A concise 3-10 word **title** for the audio filename (replaces the `tts_YYYYMMDD_HHMMSS` timestamp pattern)
   - A **dynamic delivery note** (half sentence) describing emotion/pacing for *this specific message* — e.g. "calm but focused, slightly quicker pace" for alerts, "gentle and unhurried" for personal content
   
   Falls back to first words of text + static instruct if the LLM call fails. Short text (≤50 chars) skips the LLM entirely.

2. **`_generate_openai_tts` signature extended** with `voice_instruct: str = ""` parameter.
   When provided, it merges `voice_instruct` into `extra_body["instruct"]`, overriding the static config value. This is how the dynamic delivery note reaches Qwen3-TTS.

3. **Filename format changed** from `tts_YYYYMMDD_HHMMSS.mp3` → `{tts_title} HH:MM DD.MM.YY.mp3`

4. **In `text_to_speech_tool`**: calls `_prepare_tts_metadata` before generating, passes `dynamic_instruct` to `_generate_openai_tts`.

**How to re-apply after an upstream update:**
Read the current `tools/tts_tool.py` and re-integrate the four points above. The logic is self-contained — no other files reference these additions. Preserve upstream changes; only add what's missing.

---

## Restart

```bash
hermes gateway stop && hermes gateway start
```

Verify it came up:

```bash
tail -20 /tmp/hermes-gateway.log
```

## Verify

Send a message in `#hermes` on Slack and confirm a response. If TTS was touched, send a short message that triggers voice output and check `~/.hermes/audio_cache/` for a sensibly-named file.
