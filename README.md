# claude-local

Version-controlled source of truth for Johannes's local Claude Code setup.

All files that live in `~/.claude/` are symlinked here so the entire Claude Code
configuration (hooks, scripts, skills, CLAUDE.md files) is tracked in git.

---

## What Lives Here

```
claude-local/
├── cqueue/          Web dashboard — visualize cqueue.md + cnotes.md per repo
├── hooks/           Claude Code hooks (source → symlinked to ~/.claude/hooks/)
├── scripts/         CLI scripts: cq (queue), cn (notes), statusline
├── skills/          Claude Code skills (source → symlinked to ~/.claude/skills/)
├── config/          CLAUDE.md files and global gitignore
├── docs/            Technical documentation for this setup
├── Makefile         Setup, symlink management, Docker ops
└── .env.example     Template for local path config
```

---

## Tooling Overview

### cq — Task Queue (`scripts/queue.ts`)

Per-repo task queue for unattended multi-task Claude Code sessions.
The Stop hook injects the next queued task as a user message (exit code 2),
keeping the session alive automatically.

```bash
cq add "Refactor the auth service"
cq add "/commit --split"
cq pause          # Insert a PAUSE sentinel
cq list           # Show all pending tasks
cq clear
```

Queue file lives at `{git-root}/cqueue.md` — per-repo, globally gitignored.
See [`docs/cq.md`](docs/cq.md) for full reference.

### cqueue — Web Dashboard (`cqueue/`)

A Bun/Elysia + React/BlueprintJS web app running on `localhost:7705`.
- Visualizes `cqueue.md` as interactive task cards (drag to reorder, add, delete)
- EasyMDE editor for `cnotes.md` session notes
- Real-time sync via SSE — reflects CLI and Claude Code file changes instantly
- Per-repo routing: `localhost:7705/SourceRoot/vps`
- Indexes all repos under `~/SourceRoot` and `~/IuRoot`

See [`cqueue/PRD.md`](cqueue/PRD.md) for architecture.

### notify.ts — Hook System (`hooks/notify.ts`)

Single Bun script wired to all four Claude Code hook events:

| Event | Behavior |
|-|-|
| SessionStart | Record start time, capture project/branch |
| Notification | Alert: input required or permission needed |
| Stop | **Queue injection** → notification on completion |
| SessionEnd | Session summary with duration |

Prefers `cmux notify` when inside a cmux session, falls back to osascript.
See [`docs/hooks.md`](docs/hooks.md) for full reference.

### Statusline (`scripts/statusline.sh`)

2–3 line Claude Code statusline:
```
Claude Sonnet 4.6 | 86k/170k 51% | +660 -52 | 308k | 23min
~/SourceRoot/basalt-ui | * feat/add-button
⚡ /commit --split · +2 more
```

See [`docs/statusline.md`](docs/statusline.md).

---

## Setup

### First-Time Install

```bash
git clone git@github.com:jkrumm/claude-local.git ~/SourceRoot/claude-local
cd ~/SourceRoot/claude-local
cp .env.example .env
# Edit .env with your actual paths
make setup
```

`make setup` creates all symlinks from `~/.claude/` → `claude-local/` and
installs the global gitignore. Existing files are backed up before being replaced.

### Start cqueue

```bash
make up         # docker compose up -d --build
```

Open `localhost:7705` in browser (or cmux webview tab).

---

## Symlink Map

After `make setup`, these symlinks are active:

| Symlink | Points To |
|-|-|
| `~/.claude/hooks/notify.ts` | `claude-local/hooks/notify.ts` |
| `~/.claude/queue.ts` | `claude-local/scripts/queue.ts` |
| `~/.claude/statusline.sh` | `claude-local/scripts/statusline.sh` |
| `~/.claude/skills/{name}/` | `claude-local/skills/{name}/` |
| `~/.gitignore_global` | `claude-local/config/gitignore_global` |

---

## Per-Repo AI Files

Both are globally gitignored via `~/.gitignore_global`:

| File | Purpose |
|-|-|
| `cqueue.md` | Task queue — read/written by `cq` CLI and Stop hook |
| `cnotes.md` | Session notes — edited via cqueue web dashboard |
