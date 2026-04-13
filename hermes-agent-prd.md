# Hermes Agent — Personal AI Assistant Stack

## Problem

Johannes runs a multi-machine homelab/VPS infrastructure (47 containers across 3 environments), uses TickTick for task management, Obsidian for knowledge, and has a local AI stack (Gemma 4 + Whisper + TTS) on a dedicated M2 Max. Currently there is no unified AI agent that ties these systems together — monitoring is fragmented across UptimeKuma/Beszel/Dozzle/shell watchdogs, personal journaling is in Mindsera (disconnected from everything), news consumption is manual across YouTube/podcasts/newsletters/Reddit, and daily planning requires checking multiple apps.

Hermes Agent (Nous Research, v0.8.0, MIT license) is a self-improving AI agent framework with native Slack integration, MCP support, cron skills, voice mode, and a learning loop. It runs on Python, supports any OpenAI-compatible LLM backend, and stores memory as curated markdown + SQLite FTS5.

## Goals

1. **Single Hermes instance on Mac Mini M2 Pro** as always-on personal AI agent
2. **Slack as the unified interface** — one workspace, domain-specific channels, audio memos back and forth
3. **Four skill domains**: Assistant (daily management), Journal (diary + reflection), Watchdog (infra monitoring), News (aggregation + dedup)
4. **Morning/evening audio briefings** generated via Qwen3-TTS on M2 Max, posted to Slack
5. **TickTick as task hub** — agent reads, writes, recommends; watchdog creates tasks for infra issues
6. **Obsidian integration** — journal entries, briefing archives, knowledge notes
7. **Claude Code handover** — infra issues escalated as GitHub Issues for Claude Code to resolve
8. **Config in GitHub** (claude-local repo), data backed up to homelab, important data via restic to Backblaze B2

## Non-Goals

- Multiple Hermes profiles (start single, split later if memory gets noisy)
- Outlook/Microsoft calendar integration (later phase)
- Self-healing beyond soft container restarts (start read-only, expand gradually)
- Custom REST API service alongside Hermes (use MCP servers instead)
- Native iOS app (Slack mobile is the interface)
- News content in Hermes MEMORY.md (news is ephemeral file-based data, not retained agent memory)

## Architecture

### Machines

| Machine | Role | Always On |
|-|-|-|
| Mac Mini M2 Pro | Hermes host, Obsidian vault, Slack gateway | Yes (`pmset -a sleep 0`) |
| M2 Max MacBook | LLM inference (Gemma 4), STT (Whisper), TTS (Kokoro/Qwen3-TTS) | Yes (clamshell, HDMI) |
| Homelab (4-core) | Storage, CouchDB, backups, UptimeKuma, Beszel, 19+8 containers | Yes |
| VPS | Production web apps, 20 containers, ClickStack observability | Yes |

All connected via Tailscale. Hermes on Mac Mini reaches all other machines over the mesh.

### LLM Strategy

- **Primary**: Gemma 4 26B-A4B on M2 Max via OpenAI-compatible API (`https://<localai-tailscale>/v1/chat/completions`)
- **Fallback**: Anthropic Claude Sonnet or Gemini Flash via API (when M2 Max is off or for heavy reasoning tasks)
- **Auxiliary models** (compression, session search summarization): Gemini Flash (cheap, fast)
- Provider fallback chain configured in `~/.hermes/config.yaml`

### Voice Pipeline

| Direction | Model | Endpoint | Location |
|-|-|-|-|
| STT (quality) | Whisper Large-v3 | `https://<localai-tailscale>/v1/audio/transcriptions` | M2 Max |
| STT (fast) | Whisper Large-v3-Turbo | Same endpoint, different model param | M2 Max |
| TTS (interactive) | Kokoro 82M | `https://<localai-tailscale>/v1/audio/speech` | M2 Max |
| TTS (longform/briefings) | Qwen3-TTS 1.7B VoiceDesign | Same endpoint, different model param | M2 Max |

Hermes config points STT/TTS at the M2 Max Caddy endpoints. All audio stays on the local network.

### Slack Workspace

Single workspace. Agent responds to all DMs and @mentions. Cron jobs post to designated channels.

| Channel | Type | Purpose |
|-|-|-|
| `#hermes` | Interactive | Main conversation — assistant queries, triage, general interaction |
| `#inbox` | Interactive | Drop journal voice memos, random links, quick captures for processing |
| `#journal` | Output | Processed journal entries, mood analysis, structured reflections |
| `#watchdog` | Automated | Infra alerts, container status changes, incident reports |
| `#news` | Automated | Daily news digest, source links, recommendations |
| `#briefings` | Automated | Morning/evening audio reports (mp3 attachments) |

When you interact in `#hermes`, the agent handles assistant/general tasks. When you drop content in `#inbox`, the agent recognizes it as journal/capture input and processes accordingly. `#watchdog`, `#news`, and `#briefings` are primarily for automated output — you read there, then discuss/triage in `#hermes`.

### Data Layer

```
Hermes Memory (curated, small)
  MEMORY.md (~2,200 chars) — agent's environment facts, learned patterns
  USER.md (~1,375 chars) — user preferences, communication style
  state.db (SQLite FTS5) — all session history, searchable

Obsidian Vault (human-readable, CouchDB-synced)
  Journal/ — structured diary entries from voice memos and text
  Briefings/ — archived text versions of morning/evening reports
  Knowledge/ — elevated notes (nutrition plans, interesting articles, etc.)
  (NO news dump, NO watchdog logs)

News Data (ephemeral, file-based)
  ~/.hermes/skills/news/data/ — fetched items, scored, deduplicated
  7-day rolling window, auto-cleanup
  Never enters MEMORY.md or session memory

Audio Files
  Generated briefings: ephemeral on Mac Mini, 7-day rolling window
  Journal voice recordings: backed up to homelab after transcription

Configs (version controlled)
  claude-local repo — Hermes config templates, skill definitions, cron configs
  .env.tpl with 1Password references (no plaintext secrets)
```

### Backup Topology

```
Mac Mini (~/.hermes/)
  ├→ Homelab (rsync/rclone daily) — full agent state, sessions, skills
  │    └→ Backblaze B2 (restic, existing schedule) — disaster recovery
  ├→ GitHub (claude-local repo) — config templates, skill files, .env.tpl
  └→ Obsidian vault → CouchDB sync → all devices

Journal voice recordings
  Mac Mini → Homelab (rsync after transcription)
  Homelab → Backblaze B2 (via existing restic)

Generated audio (briefings)
  Mac Mini only, 7-day rolling, no backup needed
```

### Secrets Management

All secrets via 1Password CLI (`op run --env-file=.env.tpl`). Template file committed to GitHub, real values resolved at runtime.

Required secrets (new vault: `hermes` in 1Password):
- `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` — Slack app credentials
- `ANTHROPIC_API_KEY` — fallback LLM provider
- `GEMINI_API_KEY` — auxiliary model (compression, search summarization)
- `OPENAI_API_KEY` — optional fallback
- `TICKTICK_CLIENT_ID` + `TICKTICK_CLIENT_SECRET` — TickTick API OAuth
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — Gmail + Calendar OAuth (read-only)
- `GITHUB_TOKEN` — for GitHub Issue creation
- Plus any existing keys (localai endpoints don't need auth — Tailscale ACLs suffice)

### MCP Servers

| Server | Purpose | Transport |
|-|-|-|
| ticktick-mcp | Task management — read, write, reschedule, query | stdio |
| Google Calendar MCP | Calendar read-only + event queries | stdio |
| Gmail MCP | Email read-only — scanning newsletters, calendar invites | stdio |
| GitHub MCP | Issue creation, repo queries (for watchdog handover) | stdio |
| Docker MCP (or HTTP via socket-proxy) | Container stats, logs, restart (watchdog) | HTTP |

MCP servers run as subprocesses managed by Hermes. Each declared in `~/.hermes/config.yaml` under `mcp_servers`. The Docker access goes through the existing socket-proxy containers (read-only initially).

### Watchdog — Monitoring Scope

**47 containers across 3 environments** already monitored by UptimeKuma, Beszel, Dozzle, and two shell watchdog scripts. The Hermes watchdog skill layer adds:

- **Intelligent triage**: Instead of raw alerts, the agent classifies severity, correlates with recent changes, and writes actionable summaries
- **UptimeKuma integration**: Query via API/WebSocket for current status, pipe alerts to `#watchdog` Slack channel (replacing ntfy)
- **Docker socket-proxy queries**: HTTP GET to existing read-only socket-proxies on homelab (port via Docker socket-proxy) and VPS (port 2376/Tailscale) for container stats and logs
- **GitHub Issue creation**: For issues requiring code changes, the agent creates a well-structured GitHub Issue in the relevant repo (homelab/vps/claude-local) with context, logs, and suggested fix
- **TickTick task creation**: For operational tasks (update container, renew cert, check disk), creates TickTick tasks with priority and due date
- **Escalation path**: Alert in `#watchdog` → if unresolved, create TickTick task → if code change needed, create GitHub Issue

**Self-healing progression** (gradually enabled):
1. Read-only: query stats, read logs, check health endpoints. Alert only.
2. Soft actions: restart containers, clear caches. Requires Slack approval button.
3. Harder actions: modify configs, scale services. Requires Slack approval.

### Claude Code Handover

Hermes watchdog detects issue → creates GitHub Issue in relevant repo with:
- Error logs and context
- Affected container/service
- Suspected root cause
- Attempted remediation (if any)
- Suggested fix approach

Johannes picks up the issue with Claude Code Opus on Mac Mini in a separate session. No automatic code deployment — human-in-the-loop for all code changes.

### News Agent — Isolation Pattern

News skill runs on cron (configurable frequency, e.g., every 6 hours + morning pre-briefing).

**Sources** (to be configured incrementally):
- RSS feeds (user-curated list)
- YouTube channel new videos (YouTube Data API or RSS)
- Spotify podcast new episodes (Spotify API or RSS)
- Email newsletters (parsed from Gmail inbox, specific senders)
- Reddit (specific subreddits, top posts)

**Processing pipeline**:
1. Fetch from all sources
2. Deduplicate by semantic similarity (same story from 3 sources → 1 entry)
3. Score relevance against user interest profile (defined in skill config, NOT in MEMORY.md)
4. Store scored items as JSON/markdown files in `~/.hermes/skills/news/data/`
5. Auto-cleanup items older than 7 days

**Output**:
- Daily digest posted to `#news` with headlines, 2-line summaries, source links
- Top recommendations for YouTube videos and podcast episodes to actually watch/listen
- Morning briefing includes top 3-5 news items (read from data files by briefing skill)

**Isolation guarantee**: News data never enters MEMORY.md, USER.md, or session memory. It exists only as skill data files. The agent knows news through skills, not through memory.

### Morning/Evening Briefing — Longform Audio

**Morning briefing** (cron, e.g., 7:00 AM):
1. Skill queries TickTick for today's tasks and overdue items
2. Queries Gmail calendar for today's events
3. Reads weather for user's location
4. Reads `~/.hermes/skills/news/data/` for top news items
5. Reads recent journal mood trend from Obsidian
6. Checks `#watchdog` for any overnight incidents
7. Synthesizes into a flowing narrative (~10-20 min target)
8. Sends text to Qwen3-TTS on M2 Max (chunked, parallel generation, FFmpeg merge)
9. Posts mp3 to `#briefings` with text summary

**Evening briefing** (cron, e.g., 8:00 PM):
1. What got done today (TickTick completed tasks)
2. What's coming tomorrow
3. Any unresolved watchdog items
4. Journal reflection prompt (optional)
5. Same audio generation pipeline

The longform TTS pipeline is a shared skill (`skills/audio/longform-tts.md`) that any cron job can invoke. It handles chunking text into sentence groups, calling Qwen3-TTS with a consistent voice design prompt, generating segments in parallel, and merging with FFmpeg.

### Journal — Migration and Ongoing

**Migration from Mindsera** (~60 entries):
- Export CSV from Mindsera
- Claude Code processes entries into Obsidian-compatible markdown files
- Place in `Obsidian/Journal/YYYY/MM-DD-title.md` format
- One-time migration task in Phase 2

**Ongoing journal flow**:
1. User drops voice memo or text in `#inbox`
2. Agent transcribes (Whisper on M2 Max if audio)
3. Agent structures into a journal entry — date, themes, mood indicators, key reflections
4. Writes to Obsidian vault `Journal/` folder
5. Posts structured entry to `#journal` for confirmation
6. Updates mood trend data (tracked in skill data, surfaced in briefings)

**Obsidian vault structure** (single vault, CouchDB-synced):
```
Vault/
  Journal/
    2026/
      04-10-morning-reflection.md
      04-10-evening-thoughts.md
  Briefings/
    2026/
      04-10-morning.md
      04-10-evening.md
  Knowledge/
    nutrition-plan.md
    (elevated items from any domain)
```

User manually elevates items into `Knowledge/` or other vault folders as desired. Agent writes only to `Journal/` and `Briefings/`.

---

## Implementation Phases

### Phase 0 — Foundation

**Goal**: Hermes running on Mac Mini, connected to LLM backend and Slack. Nothing smart yet — just the base platform working.

**Steps**:
1. Install Hermes on Mac Mini via official installer
2. Run `hermes setup` — configure LLM provider pointing at M2 Max Ollama endpoint via Tailscale, set cloud fallback chain (Anthropic → Gemini)
3. Configure voice: STT pointing at M2 Max Whisper endpoint, TTS pointing at Kokoro (interactive) endpoint
4. Create Slack workspace, create Slack app (bot token scopes: `chat:write`, `app_mentions:read`, `channels:history`, `channels:read`, `groups:history`, `im:history`, `im:read`, `im:write`, `users:read`, `files:write`, `files:read`), enable Socket Mode, subscribe to events
5. Create all 6 Slack channels: `#hermes`, `#inbox`, `#journal`, `#watchdog`, `#news`, `#briefings`
6. Set up 1Password vault `hermes` with all required secrets
7. Configure `~/.hermes/.env` via `op run --env-file=.env.tpl` pattern
8. Set up `hermes gateway` as a LaunchAgent (auto-start on boot)
9. Configure `pmset -a sleep 0` on Mac Mini
10. Verify: send a message in `#hermes` on Slack, get a response from Hermes via Gemma 4
11. Verify: send a voice memo in Slack, get a transcribed + spoken response back
12. Set up SOUL.md with agent identity/personality (helpful personal assistant, concise, no fluff)
13. Set up initial USER.md with Johannes's preferences and context
14. Commit Hermes config templates and .env.tpl to claude-local repo

**Validation**: Interactive Slack conversation works. Voice round-trip works. Agent uses Gemma 4 on M2 Max. Fallback to cloud works when M2 Max is unreachable.

### Phase 1 — Assistant

**Goal**: Daily task management, calendar awareness, weather, basic morning briefing.

**Steps**:
1. Set up ticktick-mcp server — research the best available implementation, configure OAuth credentials, add to `mcp_servers` in config.yaml
2. Set up Google Calendar MCP — OAuth with Gmail account, calendar read-only scope, add to config
3. Set up Gmail MCP — read-only scope, add to config
4. Create assistant skills:
   - `skills/assistant/daily-tasks.md` — query TickTick, show today's priorities, allow interactive management (mark done, reschedule, create new)
   - `skills/assistant/schedule.md` — query calendar, show today's events, check for conflicts
   - `skills/assistant/weather.md` — fetch weather for user's location (via API or MCP)
   - `skills/assistant/recommend.md` — based on schedule + tasks + time of day, suggest what to do next
5. Create the longform TTS shared skill:
   - `skills/audio/longform-tts.md` — chunked text → Qwen3-TTS on M2 Max → parallel generation → FFmpeg merge → output mp3
   - Accepts text input, voice design prompt, output path
   - Handles Tailscale connectivity errors gracefully (fall back to Edge TTS if M2 Max unreachable)
6. Create morning briefing cron skill:
   - `skills/assistant/morning-briefing.md` — aggregates tasks, calendar, weather
   - Generates narrative text → invokes longform-tts skill → posts audio to `#briefings`, text summary alongside
   - Cron: `0 7 * * *` (7:00 AM daily, adjust to preference)
7. Create evening briefing cron skill:
   - `skills/assistant/evening-briefing.md` — completed tasks, tomorrow preview, open items
   - Same TTS pipeline → `#briefings`
   - Cron: `0 20 * * *` (8:00 PM daily, adjust)
8. Verify TickTick interactive management works from `#hermes`
9. Verify morning briefing generates and posts audio to `#briefings`
10. Commit skill files and config to claude-local repo

**Validation**: "What's on my plate today?" in `#hermes` returns real TickTick tasks. Morning audio briefing plays in `#briefings`. Interactive task triage works.

### Phase 2 — Journal

**Goal**: Voice memo journal pipeline, Obsidian integration, mood tracking, Mindsera migration.

**Steps**:
1. Ensure Obsidian vault path is configured and writable by Hermes on Mac Mini
2. Create journal skills:
   - `skills/journal/process-entry.md` — receives text or transcription from `#inbox`, structures into dated journal entry (themes, mood indicators, key reflections), writes to `Obsidian/Journal/YYYY/MM-DD-title.md`, posts confirmation to `#journal`
   - `skills/journal/mood-tracker.md` — maintains a mood trend file in skill data directory, updated on each journal entry, queryable for briefings
   - `skills/journal/reflect.md` — weekly reflection synthesis skill, reads past 7 days of entries, generates mood summary + patterns, writes to Obsidian as weekly review note
3. Configure `#inbox` channel behavior — agent watches for new messages, auto-processes voice memos (transcribe via Whisper) and text posts as journal input
4. Set up weekly reflection cron: `0 18 * * 0` (Sunday 6 PM)
5. Integrate mood data into morning/evening briefings (update briefing skills)
6. Migration: Export Mindsera CSV, create a one-time migration script/skill that processes ~60 entries into `Obsidian/Journal/` format. Run via Claude Code.
7. Set up Proton Bridge on Mac Mini if email integration for Proton is desired at this phase (optional — can defer)
8. Verify: drop a voice memo in `#inbox` → appears as structured entry in `#journal` and in Obsidian vault
9. Verify: "How have I been feeling this week?" in `#hermes` → agent reads mood data and responds
10. Commit to claude-local repo

**Validation**: Voice memo → transcription → structured Obsidian entry works end-to-end. Mood tracking surfaces in briefings. Mindsera entries migrated.

### Phase 3 — Watchdog

**Goal**: Infrastructure monitoring with intelligent triage, Slack alerts, GitHub Issue and TickTick task creation.

**Steps**:
1. Set up Docker access via existing socket-proxies:
   - Homelab: HTTP to docker-socket-proxy container (read-only)
   - VPS: HTTP to socket-proxy-claude on port 2376 via Tailscale (read-only, already exists for claude-remote)
   - Access via MCP server or direct HTTP skill — evaluate best approach
2. Set up GitHub MCP server — personal access token, scoped to homelab/homelab-private/vps/claude-local repos
3. Configure UptimeKuma integration — API or WebSocket to query current status, pipe alerts through Hermes to `#watchdog` (replacing ntfy for Hermes-managed alerts; existing ntfy stays for non-Hermes alerting)
4. Create watchdog skills:
   - `skills/watchdog/health-check.md` — cron skill (every 10 min), queries Docker stats on both environments, checks container health/restart counts, posts to `#watchdog` only on anomalies
   - `skills/watchdog/incident-triage.md` — when anomaly detected, classify severity, correlate with recent container changes, write actionable summary
   - `skills/watchdog/create-github-issue.md` — for code-change issues, creates structured GitHub Issue in the right repo with logs, context, root cause analysis, suggested fix
   - `skills/watchdog/create-task.md` — for operational tasks, creates TickTick task with priority and context
   - `skills/watchdog/container-restart.md` — soft self-healing, requires Slack approval button before executing
5. Integrate watchdog status into morning/evening briefings (overnight incidents section)
6. Start with read-only mode — all skills except container-restart active. Approval buttons wired up but restart skill disabled until you're comfortable.
7. Gradually enable soft actions after 1-2 weeks of read-only monitoring
8. Verify: simulate a container restart → alert appears in `#watchdog` with triage
9. Verify: "Create a GitHub issue for this" in `#hermes` → issue created in correct repo
10. Commit to claude-local repo

**Validation**: `#watchdog` shows relevant alerts (not noise). GitHub Issues are well-structured. TickTick tasks created for operational items. No false positive floods.

### Phase 4 — News

**Goal**: Aggregated, deduplicated news from multiple sources, with recommendations and briefing integration.

**Steps**:
1. Create news skill infrastructure:
   - `skills/news/data/` directory for ephemeral item storage
   - `skills/news/config.yaml` or similar — source list, interest profile for relevance scoring, cleanup rules
   - Interest profile: AI/ML, infrastructure/DevOps, TypeScript/web dev, personal productivity (refine over time)
2. Create news source skills:
   - `skills/news/fetch-rss.md` — fetch configured RSS feeds, extract items
   - `skills/news/fetch-youtube.md` — YouTube Data API or channel RSS, new videos from subscribed channels
   - `skills/news/fetch-reddit.md` — specific subreddits, top posts (time-filtered)
   - `skills/news/fetch-newsletters.md` — parse specific sender emails from Gmail inbox as news items
   - `skills/news/fetch-podcasts.md` — Spotify/podcast RSS, new episodes from subscribed shows
3. Create processing skills:
   - `skills/news/deduplicate.md` — semantic similarity check across all fetched items, merge duplicates, keep best source link
   - `skills/news/score-relevance.md` — score each item against interest profile, filter low-relevance
   - `skills/news/recommend.md` — from YouTube videos and podcast episodes, pick top 3-5 worth watching/listening based on relevance + recency
4. Create output skills:
   - `skills/news/daily-digest.md` — cron (e.g., `0 6 * * *`, before morning briefing), formats scored items as digest, posts to `#news` with headlines, summaries, source links, and watch/listen recommendations
   - High-relevance items optionally promoted to Obsidian `Knowledge/` (user confirms in `#hermes`)
5. Integrate top news items into morning briefing (update briefing skill to read from `skills/news/data/`)
6. Set up auto-cleanup cron: delete news data files older than 7 days
7. Configure source list incrementally — start with a few RSS feeds and YouTube channels, expand over time
8. Verify: news digest appears in `#news` with deduplicated items
9. Verify: morning briefing includes news section
10. Commit to claude-local repo

**Validation**: `#news` shows a clean, deduplicated daily digest. No news data in MEMORY.md. Morning briefing naturally includes top news. Recommendations are actionable (direct links to watch/listen).

---

## Cross-Cutting Concerns

### Config Management
- All Hermes config templates (config.yaml, .env.tpl, skill files, cron definitions) versioned in `claude-local` repo under `hermes/` directory
- Actual `~/.hermes/` on Mac Mini is the live runtime state (NOT symlinked — too much dynamic data)
- Skill files may be symlinked from repo to `~/.hermes/skills/` for easy editing
- Changes committed in claude-local, then synced/deployed to Mac Mini

### Backup Schedule
- Daily: `~/.hermes/` (minus audio cache) → homelab via rsync/rclone
- Homelab → Backblaze B2 via existing restic schedule
- Obsidian vault: CouchDB live sync + homelab rsync as cold backup
- Journal voice recordings: homelab storage after transcription, included in restic
- Generated audio: 7-day rolling on Mac Mini, no backup

### Proton Bridge (Deferred)
- Install Proton Bridge on Mac Mini when email integration expands
- Exposes local IMAP endpoint that an email MCP server can connect to
- Not required for Phase 1 (Gmail covers calendar + newsletters)

### Profile Split (If Needed Later)
- If after weeks of use the watchdog's session chatter degrades journal quality:
  - `hermes profile create watchdog --clone` to split out
  - Move watchdog skills to the new profile
  - Configure separate Slack bot token for the watchdog profile
  - Both profiles share skills via `skills.external_dirs`
  - Briefing skill on main profile calls watchdog profile's API for status

---

## Success Criteria

1. Daily morning audio briefing plays in `#briefings` before 7:30 AM with tasks, calendar, weather, news, mood
2. Interactive TickTick management works from `#hermes` — create, complete, reschedule tasks via natural language
3. Voice memo in `#inbox` → structured Obsidian journal entry within 2 minutes
4. Infra anomalies appear in `#watchdog` with intelligent triage within 10 minutes of occurrence
5. News digest in `#news` daily with deduplicated, scored items and recommendations
6. GitHub Issues created by watchdog are well-structured enough for Claude Code to action
7. No news data or watchdog log noise in MEMORY.md — memory stays clean and curated
8. Full disaster recovery possible from homelab backup + GitHub config in under 1 hour
9. System works when M2 Max is off (falls back to cloud LLM, Edge TTS)
10. Slack is the single interface — no need to open any other app for daily agent interaction
