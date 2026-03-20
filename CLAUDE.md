# claude-local — Claude Code Instructions

## What This Repo Is

VCS source of truth for Johannes's Claude Code setup. Everything is symlinked
outward — edit at either end, git always sees the change here.

**After any edit: commit here.**

## Symlink Map

| File here | Live path | Notes |
|-|-|-|
| `config/global.CLAUDE.md` | `~/.claude/CLAUDE.md` | Global Claude instructions |
| `config/sourceroot.CLAUDE.md` | `~/SourceRoot/CLAUDE.md` | SourceRoot workspace |
| `config/zshrc` | `~/.zshrc` | Includes `c()` launcher, `cq` alias |
| `config/gitconfig` | `~/.gitconfig` | includeIf per workspace |
| `config/gitconfig-personal` | `~/.gitconfig-personal` | jkrumm@pm.me + 1Password signing |
| `config/gitconfig-work` | `~/.gitconfig-work` | johannes.krumm@iu.org + 1Password signing |
| `config/gitignore_global` | `~/.gitignore_global` | queue.md, cnotes.md |
| `hooks/notify.ts` | `~/.claude/hooks/notify.ts` | All 4 hook events |
| `scripts/queue.ts` | `~/.claude/queue.ts` | cq CLI |
| `scripts/statusline.sh` | `~/.claude/statusline.sh` | 3-line statusline |
| `skills/{name}/` | `~/SourceRoot/.claude/skills/{name}/` | SourceRoot-only |

**Not symlinked:** `~/.claude/settings.json` — machine-specific permissions.
`make setup` creates from template if missing, otherwise jq-merges:
template wins on all keys (hooks, statusLine, plugins), permissions block preserved.

## Rules

**Adding a skill:** create `skills/{name}/SKILL.md` here, then `make setup`.
Never create directly in `~/SourceRoot/.claude/skills/` — won't be in VCS.

**Skills scope:** loaded only in SourceRoot via `--plugin-dir ~/SourceRoot/.claude`
in `c()`. Not available in IuRoot — intentional. IuRoot uses per-project `.claude/`.

**settings.json changes:** update `config/settings.template.json`, then `make setup`
to merge into the live file. Never edit the live settings.json for persistent changes.

## Key Technical Facts

- `queue.md` blocks separated by `\n---\n`. Block types: plain text (◆), `/slash` (⚡), `PAUSE` (⏸).
- Stop hook: `writeSync(1, task)` + `process.exit(2)` injects next task. No `await` between them.
- PAUSE exits with code 0 synchronously — no async notification call before exit.
- Skills have optional `model:` frontmatter (`haiku` for fast forks, default = sonnet).
- `c()` in zshrc: sets `--plugin-dir` and `--dangerously-skip-permissions` per workspace.
