# cqueue — Product Requirements Document

## Overview

`cqueue` is a local web dashboard for Claude Code's per-repo AI workflow files:

- **`cqueue.md`** — the task queue injected into Claude sessions via the Stop hook
- **`cnotes.md`** — freeform session notes alongside each project

It provides a purpose-built UI that understands queue structure (task types, ordering, PAUSE sentinels) and a rich markdown editor for notes — running as a persistent local service in Docker.

---

## Goals

- See and manage the active queue for any local repo without touching the CLI
- Take session notes in a proper editor (EasyMDE) per repo
- File changes from CLI (`cq add`, `cq pop`) or Claude Code are reflected in the UI in near-real-time
- No backend state — every truth lives in the files; the server is stateless

[[I am compltly missing a GitHub integration. Seeing the branch wer are on how many + and - changes how many commits staged. How many on branch already. And global ones like how many PRs are open what the status is on them e.g. failing CI or pending ci or CI and CodeRabbit feedback concluded...]]

## Non-Goals

- Authentication, multi-user, or any network exposure
- Replacing the `cq` CLI (the CLI remains authoritative for scripting and Stop hook)
- Editing arbitrary markdown files beyond `cqueue.md` and `cnotes.md`
- A database, ORM, or any persistent server-side state

---

## Architecture

### KISS: One Server, One Port

```
┌─────────────────────────────────────┐
│  Docker container (port 7705)       │
│                                     │
│  Bun/Elysia server                  │
│  ├── /api/*        REST + SSE       │
│  └── /*            Vite SPA (built) │
│                                     │
│  Volume: ~/SourceRoot → /repos      │
│  Volume: ~/.claude  → /claude       │
└─────────────────────────────────────┘
```

Single `package.json`, no Bun workspace needed. Vite builds the React SPA to `dist/`; Elysia serves it as static files alongside the API. In development, Vite dev server proxies `/api` to Elysia.

### Stack

| Layer | Choice | Reason |
|-|-|-|
| Runtime | Bun | Matches existing cq tooling, fast startup |
| Server | Elysia | Typed, Bun-native, built-in SSE |
| Frontend | React 19 + Vite | BlueprintJS is React-first | [[We connect FE and BE with EdenTreaty, right? Does that work for SSE aswell?]]
| UI | BlueprintJS v6 | Requested; dark/light, rich components |
| Editor | EasyMDE | Markdown editor for cnotes.md |
| Fonts | JetBrains Mono + Geist Sans | Requested |
| Container | Docker Compose | Always-on, file volume access |
| Build | Makefile | Easy ongoing ops |

---

## File System Integration

The container mounts the host filesystem read-write:

```yaml
volumes:
  - ~/SourceRoot:/repos          # all project repos [[Also IuRoot]]
  - ~/.claude:/claude            # queue state dir (for future global views)
```

Paths in the API use the host path prefix. Example:
- URL: `localhost:7705/repos/SourceRoot/vps`
- Container resolves to: `/repos/vps/cqueue.md` and `/repos/vps/cnotes.md`

The server scans for repos by finding all directories under `/repos` (one level deep, or recursively) that contain either `cqueue.md` or `cnotes.md`.

---

## Data Model

### `cqueue.md` Format (unchanged — CLI-compatible)

Tasks separated by `\n---\n`. Block types detected by first line:

```
task text (plain)
---
/slash-command
---
PAUSE
---
Multi-line task
with context
```

### Parsed Task Object

```typescript
interface QueueTask {
  index: number;
  kind: "task" | "slash" | "pause";
  content: string;        // full block text
  preview: string;        // first line
  lineCount: number;
}
```

Parsing logic mirrors `queue.ts` exactly (shared module) so CLI and web are never out of sync on interpretation. [[Is this queue.ts maybe not part of this repo or folder so maybe cq CLI should move here and actually share code etc dont forget to update Makefile etc if we do this]]

---

## Sync Strategy

### Problem

`cqueue.md` is modified by three actors concurrently:
1. **`cq` CLI** — user adds/removes tasks
2. **Claude Code Stop hook** — pops tasks on session end
3. **Web UI** — user drags, edits, deletes via browser

### Solution: File Watching + SSE + Last-Write-Wins

```
File change (any actor)
    │
    ▼
Bun fs.watch() on cqueue.md / cnotes.md
    │
    ▼
SSE event → all connected clients → React re-fetches
    │
    ▼
UI shows fresh state (no stale cache)
```

**Write path (web UI):**
1. User action → optimistic UI update
2. `PATCH /api/queue/:repo` with full task array
3. Server serializes to `cqueue.md` and writes atomically (write to `.cqueue.md.tmp`, then rename)
4. File watcher fires, SSE broadcasts — other clients sync

**Conflict handling:** Last-write-wins is correct here. This is a single-user local tool. The only real race is Claude Code's Stop hook popping a task while the user is reordering — the SSE sync handles this gracefully (UI resets to actual file state after the write).

**Atomic write** (rename trick) ensures the file is never half-written when the CLI reads it. [[Are those temp files also in my global gitignore?]]

---

## API

```
GET  /api/repos                       List all repos with cqueue.md or cnotes.md
GET  /api/repo?path=/repos/vps        Parse both files for a repo
GET  /api/queue?path=/repos/vps       Parse cqueue.md → task array
PUT  /api/queue?path=/repos/vps       Write task array → cqueue.md
GET  /api/notes?path=/repos/vps       Read cnotes.md raw markdown
PUT  /api/notes?path=/repos/vps       Write cnotes.md
GET  /api/events?path=/repos/vps      SSE stream — emits "change" on file mutation
```

All routes return `{ ok: true, data: ... }` or `{ ok: false, error: string }`.

---

## UI / UX

### Routing

```
/                          Repo list (all repos with cqueue.md or cnotes.md)
/:encodedPath              Project dashboard for one repo
```

`encodedPath` is the repo's absolute path URL-encoded (e.g. `%2Frepos%2Fvps`).

### Project Dashboard

```
┌──────────────────────────────────────────┐
│  Header: repo name + path                │
│  [☀/🌙 theme toggle] [[Usually just system theme]]  [Refresh]         │
├──────────────────────────────────────────┤
│  QUEUE  [collapse]              [+ Add]  │
│  ┌─────────────────────────────────┐     │
│  │ ⚡ /commit --split         [×] │     │
│  │ ◆ Refactor auth service    [×] │     │
│  │ ⏸ PAUSE                    [×] │     │
│  │ ◆ Write CHANGELOG          [×] │     │
│  └─────────────────────────────────┘     │
│  Drag to reorder · Click to expand       │
├──────────────────────────────────────────┤
│  NOTES  [collapse]                       │
│  ┌─────────────────────────────────┐     │
│  │  EasyMDE editor                 │     │
│  │  (cnotes.md content)            │     │
│  └─────────────────────────────────┘     │
│  Auto-saves after 1s debounce            │
└──────────────────────────────────────────┘
```

### Queue Cards

Each task renders as a BlueprintJS Card:
- **Icon** left: ⚡ (Intent.PRIMARY), ◆ (Intent.NONE), ⏸ (Intent.WARNING)
- **Preview** text: first line of content (JetBrains Mono for slash commands)
- **Expand** button: shows full multi-line content
- **Delete** button: removes from queue
- **Drag handle**: reorder via @dnd-kit/sortable

Add task: BlueprintJS InputGroup at bottom of list, Enter to add. Slash commands detected by `/` prefix.

### Notes Editor

EasyMDE with:
- `spellChecker: false`
- `autosave: { enabled: true, delay: 1000 }`
- BlueprintJS-matched toolbar
- Syncs from SSE (if file changes externally while editor open, soft-merge: show diff banner, let user accept)

### Theme

- Blueprint's `dark` class toggled on `<body>` — persisted to `localStorage`
- Geist Sans as default sans-serif (via CSS variable / Blueprint font override)
- JetBrains Mono for code, slash commands, and queue previews

---

## Docker Setup

```
claude-local/cqueue/
├── Dockerfile
├── docker-compose.yml
├── Makefile
├── package.json
├── vite.config.ts
├── tsconfig.json
├── server/
│   ├── index.ts          Elysia app, static serving, SSE
│   ├── routes/
│   │   ├── repos.ts
│   │   ├── queue.ts
│   │   └── notes.ts
│   └── lib/
│       └── parse-queue.ts  Shared parser (same logic as cq CLI)
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── pages/
    │   ├── RepoList.tsx
    │   └── RepoDashboard.tsx
    └── components/
        ├── QueuePanel.tsx
        ├── QueueCard.tsx
        └── NotesPanel.tsx
```

### Makefile targets

```makefile
up          docker compose up -d --build
down        docker compose down
rebuild     docker compose up -d --build --force-recreate
logs        docker compose logs -f
shell       docker compose exec cqueue sh
```

### Environment Configuration

Paths are configured via `.env` (from `../.env` at repo root, not committed):

```env
SOURCEROOT_PATH=/Users/yourname/SourceRoot
IUROOT_PATH=/Users/yourname/IuRoot
CQUEUE_PORT=7705
```

`docker-compose.yml` reads these:

```yaml
services:
  cqueue:
    build: .
    ports:
      - "${CQUEUE_PORT:-7705}:7705"
    volumes:
      - ${SOURCEROOT_PATH}:/repos/SourceRoot:rw
      - ${IUROOT_PATH}:/repos/IuRoot:rw
    user: "${UID}:${GID}"
    restart: unless-stopped
```

### Key Docker details

- **Dual volume mounts**: both `~/SourceRoot` and `~/IuRoot` are mounted under `/repos/`, making repos from both workspaces visible at `/repos/SourceRoot/*` and `/repos/IuRoot/*`
- **Host UID**: `user: "${UID}:${GID}"` ensures file writes have correct ownership — no permission issues when `cq` CLI or Claude Code reads the same files afterward
- **Makefile delegates to root `.env`**: `cd cqueue && docker compose --env-file ../.env up`

---

## File Creation Behavior

When a repo directory is accessed that has neither `cqueue.md` nor `cnotes.md`, the server creates empty files on first access so the UI always has something to work with. This mirrors `cq`'s behavior of writing the queue file on first `cq add`.

---

## Open Questions

1. **Recursive repo discovery** — scan one level under `/repos` or deeper? Start with one level (direct children of `~/SourceRoot`), add depth later.
2. **`cqueue.md` format extension** — keep pure markdown for CLI compat? Yes, no binary or JSON hybrid. The parser gets smarter, the format stays human-editable.
3. **Notes conflict on external edit** — banner with "File changed externally — reload?" is probably enough. No true merge needed (single user).
