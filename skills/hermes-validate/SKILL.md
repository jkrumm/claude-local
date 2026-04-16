---
name: hermes-validate
description: Test, observe, and improve Hermes Agent behavior — send test messages, read session traces, identify routing failures, and fix SOUL.md/SKILL.md
---

# hermes-validate

Iterative workflow for validating and improving Hermes skill routing and response quality.
Run this when adding a new skill, after changing SOUL.md/SKILL.md, or when Hermes gives a bad response.

---

## Send a Test Message

Messages sent via the homelab Slack API arrive as the HomeLab bot (`allow_bots: all` + `SLACK_ALLOW_ALL_USERS=true`).

```bash
HOMELAB_API_KEY=$(grep HOMELAB_API_KEY ~/.hermes/.env | cut -d= -f2)
CHANNEL=$(grep SLACK_CHANNEL_HERMES ~/.hermes/.env | cut -d= -f2)

curl -s -X POST \
  -H "Authorization: Bearer $HOMELAB_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"your test prompt here"}' \
  "https://api.jkrumm.com/slack/channels/$CHANNEL/messages"
```

Wait for a response:
```bash
until tail -1 ~/.hermes/logs/agent.log | grep -q "response ready"; do sleep 5; done
tail -3 ~/.hermes/logs/agent.log
```

---

## Read the Session Trace

Every conversation is stored as a JSONL session file:

```bash
# Find the latest session
ls -t ~/.hermes/sessions/*.jsonl | head -3

# Read the full tool call trace
python3 << 'EOF'
import json, glob
latest = sorted(glob.glob('/Users/jkrumm/.hermes/sessions/*.jsonl'))[-1]
print('Session:', latest)
for i, line in enumerate(open(latest).readlines()):
    o = json.loads(line)
    role, content = o.get('role',''), o.get('content','')
    reasoning = o.get('reasoning','')
    if reasoning: print(f'[{i}] THINK: {reasoning[:150]}')
    if isinstance(content, str) and content:
        print(f'[{i}] {role}: {content[:250]}')
EOF
```

---

## What to Look For

**From `agent.log` response line:**
```
response ready: platform=slack chat=... time=51.7s api_calls=3 response=751 chars
```
| Metric | Good | Investigate |
|-|-|-|
| `api_calls` | ≤5 | >8 |
| `time` | <90s | >150s |

**From session JSONL — healthy pattern:**
```
[1] user: question
[2] THINK: knows to use skill_view('homelab-api')...
[3] tool: {"success": true, "name": "homelab-api", ...}   ← skill_view hit directly
[4] THINK: read the endpoints, forming curl command
[5] tool: {"status": "success", "output": "..."}          ← terminal/curl result
[6] assistant: clean answer
```

**Red flags in the trace:**
- `skills_list` appearing twice before `skill_view` → skill not mentioned in SOUL.md by name
- `execute_code` with Python requests → SOUL.md needs to say "use terminal, not execute_code"
- `find skills/homelab-api/reference.md` → dead file path in SOUL.md (rename to skill name)
- 404 on guessed API paths → skill SKILL.md missing or not loaded
- `gpt-4o-mini not found` → session summarization auxiliary failure, non-blocking

---

## Common Failures and Fixes

### Hermes searches filesystem instead of using skill
**Symptom:** session shows `search_files`, `read_file` with a path like `skills/homelab-api/reference.md`
**Cause:** SOUL.md had a dead file path reference
**Fix:** Replace file paths in SOUL.md with skill names: `skill_view('homelab-api')`

### Hermes uses `execute_code` instead of `terminal` for curl
**Symptom:** session shows Python `requests` code, often with import errors
**Fix:** Add explicit instruction to SOUL.md:
> "use `terminal` with curl — never `execute_code`"

### Skill not found on first try (2 `skills_list` calls)
**Symptom:** `skills_list` appears twice in trace before `skill_view`
**Cause:** Gemma4 lists all skills to verify, rather than calling `skill_view` directly
**Fix:** In SOUL.md name the exact skill and tool call: `call skill_view('homelab-api')`

### Wrong interpretation of API response values
**Symptom:** Hermes reports wrong status (e.g., UptimeKuma `status: 1` called "down")
**Fix:** Add field semantics to the relevant SKILL.md. Example:
> "`status: 1` = UP, `status: 0` = DOWN"

### 33+ API calls, looping behavior
**Symptom:** `api_calls` very high, session reasoning repeats the same question
**Cause:** Usually a dead reference in SOUL.md causing Gemma4 to search and give up repeatedly
**Fix:** Find and remove the dead reference, point to skill name instead

---

## After Fixing SOUL.md or a SKILL.md

Skills are symlinked so SKILL.md changes are live immediately.
SOUL.md changes require a gateway restart:

```bash
hermes gateway stop && hermes gateway start
# Wait for connection
until grep -q "Bolt app is running" ~/.hermes/logs/agent.log; do sleep 2; done
```

Then re-send the same test message and compare `api_calls` and `time` in `agent.log`.

---

## Validated Capabilities (as of Phase 0)

| Query type | Skill used | Calls | Time | Status |
|-|-|-|-|-|
| LocalAI health (Ollama/VRAM) | `localai-debug` | 3 | ~50s | Working |
| UptimeKuma status | `homelab-api` | 3 | ~40s | Working |
| Docker homelab + VPS summary | `homelab-api` | ~9 | ~150s | Working but slow |
| Weather forecast (weekend) | `weather` | 2 | ~66s | Working |
| Weather UV query (sunscreen) | `weather` | 2 | ~60s | Working |
| TickTick tasks | `homelab-api` | TBD | TBD | Not yet tested |
| Gmail / Calendar | `homelab-api` | TBD | TBD | Not yet tested |

Update this table after each validation run.

---

## Key Files

| File | Purpose |
|-|-|
| `hermes/SOUL.md` | System prompt — skill routing hints live here |
| `hermes/skills/homelab-api/SKILL.md` | homelab API reference for Hermes |
| `hermes/skills/localai-debug/SKILL.md` | localAI management API reference |
| `hermes/skills/weather/SKILL.md` | Weather forecast skill (Open-Meteo via homelab API) |
| `~/.hermes/logs/agent.log` | Structured run log (api_calls, time, inbound messages) |
| `~/.hermes/sessions/*.jsonl` | Full turn-by-turn session traces |
| `~/.hermes/logs/gateway.log` | Gateway stdout (startup, tool progress bars) |
