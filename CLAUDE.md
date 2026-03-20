# claude-local — Claude Code Instructions

## What This Repo Is

The version-controlled source of truth for Johannes's Claude Code configuration.
Files here are symlinked to `~/.claude/` so the entire setup is tracked in git.

## Directory Map

| Dir | Contents |
|-|-|
| `cqueue/` | Web dashboard (Bun/Elysia + React/BlueprintJS) — see `cqueue/PRD.md` |
| `hooks/` | `notify.ts` — all Claude Code hook events |
| `scripts/` | `queue.ts` (cq CLI), `statusline.sh` |
| `skills/` | Claude Code skill definitions |
| `config/` | `global.CLAUDE.md` (→ `~/.claude/CLAUDE.md`), `sourceroot.CLAUDE.md` |
| `docs/` | Technical docs: cq, hooks, statusline |

## Working Here

### Editing hooks or scripts

Files in `hooks/` and `scripts/` are the source of truth — they are symlinked
from `~/.claude/`. Edit them here; changes take effect immediately (symlinks).

After editing `hooks/notify.ts`, test by triggering a Claude Code Stop event.
The debug stderr line (`[cq] cwd=...`) appears in the "Stop hook error" UI panel.

### Editing skills

Skills in `skills/` follow the structure: `skills/{name}/SKILL.md`.
Each skill is symlinked into `~/.claude/skills/{name}/` and `~/SourceRoot/.claude/skills/{name}/`.

### cqueue development

See `cqueue/PRD.md` for architecture. Docker Compose mounts `~/SourceRoot` and
`~/IuRoot` as read-write volumes. The server is stateless — all state lives in
`cqueue.md` and `cnotes.md` files within each repo.

```bash
make up          # start cqueue
make rebuild     # force recreate after code changes
make logs        # tail logs
```

### Adding a new repo to cqueue

No configuration needed. The cqueue server auto-discovers any directory under
`/repos/SourceRoot` or `/repos/IuRoot` that contains `cqueue.md` or `cnotes.md`.

Run once in the new repo to create the files:
```bash
touch cqueue.md cnotes.md
```

Or just `cq add "first task"` — cq creates `cqueue.md` on first use.

## Key Facts for Claude

- `cqueue.md` format: blocks separated by `\n---\n`, plain text. Do NOT change this format — the cq CLI, Stop hook, and cqueue web app all parse it identically.
- The Stop hook uses `process.exit(2)` + stdout write to inject the next task. Never add `await` calls between the `writeSync` and `process.exit(2)`.
- `~/.claude/settings.json` is NOT symlinked here — it contains machine-specific permissions and should stay local.
- Skills have a `model:` frontmatter field — `haiku` for fast/cheap skills, default (sonnet) for complex ones.
