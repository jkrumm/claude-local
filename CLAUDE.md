# claude-local — Claude Code Instructions

## What This Repo Is

The version-controlled source of truth for Johannes's Claude Code configuration.
All config files live here and are symlinked outward — `~/.claude/`, `~/.zshrc`,
`~/.gitconfig`, `~/SourceRoot/CLAUDE.md` etc. all point into this repo.

## Symlink Architecture

**Edit either end — they're the same file.** Symlinks are transparent.
Editing `~/.zshrc` directly is identical to editing `config/zshrc` here.
Git always sees the change in this repo regardless of which path was used.

**After any edit: commit here.**
```bash
cd ~/SourceRoot/claude-local
git add -A && git commit -m "..."
```

## Symlink Map

| File in claude-local | Symlinked from |
|-|-|
| `config/global.CLAUDE.md` | `~/.claude/CLAUDE.md` |
| `config/sourceroot.CLAUDE.md` | `~/SourceRoot/CLAUDE.md` |
| `config/zshrc` | `~/.zshrc` |
| `config/gitconfig` | `~/.gitconfig` |
| `config/gitconfig-personal` | `~/.gitconfig-personal` |
| `config/gitconfig-work` | `~/.gitconfig-work` |
| `config/gitignore_global` | `~/.gitignore_global` |
| `hooks/notify.ts` | `~/.claude/hooks/notify.ts` |
| `scripts/queue.ts` | `~/.claude/queue.ts` |
| `scripts/statusline.sh` | `~/.claude/statusline.sh` |
| `skills/{name}/` | `~/SourceRoot/.claude/skills/{name}/` |

**NOT symlinked (machine-specific, stays local):**
- `~/.claude/settings.json` — permissions list; use `config/settings.template.json` as reference
- `~/IuRoot/.claude/settings.local.json` — work-specific permissions

## Directory Map

| Dir | Contents |
|-|-|
| `config/` | CLAUDE.md files, zshrc, gitconfig, gitignore |
| `hooks/` | `notify.ts` — all Claude Code hook events |
| `scripts/` | `queue.ts` (cq CLI), `statusline.sh` |
| `skills/` | All Claude Code skills (SourceRoot-scoped via `--plugin-dir`) |
| `cqueue/` | Web dashboard — see `cqueue/PRD.md` |
| `docs/` | Technical docs: cq system, hooks, statusline |

## Key Rules When Editing

### Adding a new skill
Create it in `skills/{name}/SKILL.md` here, then run `make setup` to symlink it.
Do NOT create skills directly in `~/SourceRoot/.claude/skills/` — they won't be in VCS.

### Editing hooks or scripts
Edit directly (either path). After editing `hooks/notify.ts`, test by triggering
a Claude Code Stop event — the debug line `[cq] cwd=...` appears in the hook panel.

### Skills scope
Skills in `skills/` load only in SourceRoot sessions (via `--plugin-dir ~/SourceRoot/.claude`
in the `c()` function in `config/zshrc`). They are NOT available in IuRoot — intentional.
IuRoot projects use their own per-project `.claude/skills/`.

### cqueue dashboard
```bash
make up          # start (localhost:7705)
make rebuild     # force recreate after code changes
make logs        # tail logs
```

## Key Technical Facts

- `cqueue.md` format: blocks separated by `\n---\n`. Do NOT change this — the cq CLI, Stop hook, and cqueue web app all parse it identically.
- Stop hook uses `writeSync(1, task)` + `process.exit(2)` to inject tasks. Never add `await` between them.
- Skills have optional `model:` frontmatter — `haiku` for fast/cheap, default (sonnet) for complex.
- The `c()` function in `config/zshrc` is the Claude launcher — it sets `--plugin-dir` and `--dangerously-skip-permissions` per workspace.
