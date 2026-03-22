# claude-local

Version-controlled source of truth for Johannes's local Claude Code setup.
Config files live here and are symlinked outward — `~/.zshrc`, `~/.gitconfig`,
`~/.claude/` hooks/scripts/skills all point into this repo.

## Structure

```
claude-local/
├── config/          zshrc, gitconfig (+personal/work), CLAUDE.md files,
│                    gitignore_global, settings.template.json
├── hooks/           notify.ts — Claude Code hook system (all 4 events)
├── scripts/         queue.ts (cq CLI), statusline.sh
├── skills/          15 Claude Code skills (SourceRoot-scoped)
├── docs/            cq system, hooks, statusline reference
├── cqueue/          PRD — web dashboard for cqueue.md + cnotes.md (not yet built)
└── Makefile         Bootstrap + idempotent setup
```

## Bootstrap (fresh machine)

```bash
git clone git@github.com:jkrumm/claude-local.git ~/SourceRoot/claude-local
cd ~/SourceRoot/claude-local
make setup
```

`make setup` is fully idempotent — safe to re-run after any change.

## Symlink Map

| claude-local | Live path |
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

**Not symlinked:** `~/.claude/settings.json` (machine-specific permissions).
`make setup` creates it from `config/settings.template.json` on first run,
then merges on subsequent runs — template wins on all keys, permissions preserved.

## Key Tooling

**cq** — per-repo task queue at `{git-root}/cqueue.md`. The Stop hook pops the
next task and injects it via JSON `decision:block` on stdout, enabling unattended
multi-task sessions. `cq add`, `cq list`, `cq stop`, `cq clear`.

**notify.ts** — single hook script for all Claude Code events: session timing,
rich notifications (cmux-first, osascript fallback), queue injection on Stop.

**Statusline** — 3-line display: model/context/tokens/duration · cwd/branch · queue preview.

**Skills** — 15 skills scoped to SourceRoot via `--plugin-dir` in the `c()` launcher.
Not available in IuRoot (intentional — work projects use per-project skills).

**gitconfig** — `includeIf` switches identity and 1Password SSH signing key
between `jkrumm@pm.me` (SourceRoot) and `johannes.krumm@iu.org` (IuRoot).

## Per-Repo AI Files (globally gitignored)

| File | Purpose |
|-|-|
| `queue.md` | Task queue — cq CLI + Stop hook |
| `cnotes.md` | Session notes — future cqueue dashboard |
