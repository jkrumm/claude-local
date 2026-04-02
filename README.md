# claude-local

Version-controlled source of truth for Johannes's local Claude Code setup.
Config files live here and are symlinked outward — `~/.zshrc`, `~/.gitconfig`,
`~/.claude/` hooks/scripts/skills/rules all point into this repo.

## Strategy

**Token-efficient, model-routed Claude Code setup** optimized for a solo senior developer hitting daily 5h subscription windows.

### Architecture Principles

| Principle | Implementation |
|-|-|
| Lean context | CLAUDE.md files <150 lines each, conventions in `.claude/rules/` |
| Model routing | Opus for strategy, Sonnet for implementation, Haiku for all delegation |
| Fresh over fork | Haiku subagents with fresh context, not conversation forks |
| No MCPs in main | Chrome DevTools MCP with deferred loading (~400 tokens). Research/search via CLI/API |
| API offloading | `claude -p` with Keychain-cached API key for expensive repetitive tasks |
| Rules > CLAUDE.md | Focused `.claude/rules/*.md` files (96% adherence vs 92% for monolithic CLAUDE.md) |

### Token Budget per Session

| Layer | Tokens | Content |
|-|-|-|
| Global CLAUDE.md | ~800 | Personal context, model routing, workflow |
| Global rules (7 files) | ~1,200 | Attribution, commits, TS, code style, security, formatting, research |
| SourceRoot CLAUDE.md | ~700 | Infra, basalt-ui, skills table, git pipeline |
| Chrome DevTools (deferred) | ~400 | Tool names only — schemas loaded on demand |
| **Total baseline** | **~3,100** | Down from ~8,000+ with 4 MCPs |

### Model Routing

| Model | Use | Skills |
|-|-|-|
| Opus | Strategy, planning, PRD, architecture | `/grill`, main conversation |
| Sonnet | Implementation, complex code changes | `/ralph`, `/implement` |
| Haiku | All delegated work (read-only, validation, review) | `/check`, `/review`, `/research`, `/browse`, `/analyze`, `/commit`, `/pr`, `/ship`, `/otel`, `/secrets`, `/git-cleanup`, `/excalidraw-diagram`, `/read-drawing` |

### Workflow

```text
Idea → /grill → PRD → /ralph or /implement → /ship
                                                ↓
                                 check → review → commit → PR
                                 → CodeRabbit iteration → merge → release
```

Small tasks (infra, config): implement → `/ship` (auto-detects direct-to-master).

## Structure

```text
claude-local/
├── config/          CLAUDE.md files, zshrc, zsh modules, gitconfig, ghostty,
│                    settings.template.json, localias
├── rules/           7 global rules (→ ~/.claude/rules/)
├── hooks/           notify.ts (all 4 events), protect-branches.ts
├── scripts/         queue.ts (cq CLI), statusline.sh, fetch_usage.py
├── skills/          20 Claude Code skills (→ ~/SourceRoot/.claude/skills/)
├── cqueue/          Web dashboard for cqueue.md (Docker)
└── Makefile         Bootstrap + idempotent setup
```

## Bootstrap

```bash
git clone git@github.com:jkrumm/claude-local.git ~/SourceRoot/claude-local
cd ~/SourceRoot/claude-local
make setup        # idempotent — safe to re-run after any change
coderabbit auth login   # one-time CodeRabbit CLI auth (GitHub OAuth)
```

`make setup` handles: symlinks, Homebrew tools, 1Password auth, API key caching (Anthropic SDK + Tavily → Keychain), Chrome DevTools MCP registration, settings.json merge.

## Symlink Map

| claude-local | Live path |
|-|-|
| `config/global.CLAUDE.md` | `~/.claude/CLAUDE.md` |
| `config/sourceroot.CLAUDE.md` | `~/SourceRoot/CLAUDE.md` |
| `rules/` | `~/.claude/rules/` |
| `config/zshrc` | `~/.zshrc` |
| `config/zsh/` | `~/.zsh/conf.d/` |
| `config/gitconfig*` | `~/.gitconfig*` |
| `config/gitignore_global` | `~/.gitignore_global` |
| `config/ghostty/` | `~/.config/ghostty/` |
| `hooks/notify.ts` | `~/.claude/hooks/notify.ts` |
| `scripts/queue.ts` | `~/.claude/queue.ts` |
| `scripts/statusline.sh` | `~/.claude/statusline.sh` |
| `scripts/fetch_usage.py` | `~/.claude/fetch_usage.py` |
| `skills/{name}/` | `~/SourceRoot/.claude/skills/{name}/` |

**Not symlinked:** `~/.claude/settings.json` (machine-specific permissions).

## Skills (20)

| Skill | Model | Context | Purpose |
|-|-|-|-|
| `/grill` | opus | main | Question until clear direction, generate PRD |
| `/implement` | sonnet | main | Guided implementation with research + explore + check |
| `/ralph` | sonnet | main | Autonomous multi-group implementation loop |
| `/ship` | haiku | main | Full flow: check → review → commit → PR → CodeRabbit → merge → release |
| `/commit` | haiku | main | Smart conventional commits |
| `/pr` | haiku | main | GitHub PR workflow (create, status, merge) |
| `/git-cleanup` | haiku | main | Squash and group noisy branch commits |
| `/check` | haiku | fork | Validation: format, lint, typecheck, test |
| `/review` | haiku | fork | Multi-angle code review + CodeRabbit CLI |
| `/research` | haiku | fork | Context7 CLI + Tavily API + WebFetch |
| `/browse` | haiku | fork | Chrome DevTools debugging (isolated MCP) |
| `/analyze` | haiku | fork | Deep static analysis (knip, jscpd, dep-cruiser) |
| `/otel` | haiku | fork | Debug OTEL traces/logs in ClickHouse |
| `/secrets` | haiku | main | 1Password vault ops |
| `/upgrade-deps` | inherits | main | Dependency upgrade assistant |
| `/frontend-design` | inherits | main | Production-grade frontend interfaces |
| `/excalidraw-diagram` | haiku | main | Create Excalidraw diagrams |
| `/read-drawing` | haiku | main | Interpret Excalidraw diagrams |
| `/skill-creator` | inherits | main | Create, modify, and test skills |
| `/code-quality` | haiku | fork | Legacy alias for /check |

## API Keys (Keychain-cached)

| Key | Source | Purpose |
|-|-|-|
| `claude-sdk-api-key` | `op://common/anthropic/API_KEY` | API offloading via `claude -p` |
| `claude-sdk-base-url` | `op://common/anthropic/BASE_URL` | Custom API endpoint |
| `tavily-api-key` | `op://common/tavily/API_KEY` | Web search in `/research` skill |

## Key Tooling

| Tool | Purpose |
|-|-|
| **cq** | Per-repo task queue (`cqueue.md`). Stop hook injects next task |
| **notify.ts** | All 4 Claude Code events: timing, notifications, queue, session end |
| **statusline.sh** | Model/context/tokens/duration, cwd/branch, queue preview |
| **coderabbit** | Local code review CLI (free: 3 reviews/hr) |
| **wtp** | Git worktree management with post-create hooks |

## Per-Repo AI Files (globally gitignored)

| File | Purpose |
|-|-|
| `cqueue.md` | Task queue — cq CLI + Stop hook |
| `cnotes.md` | Session notes — future cqueue dashboard |
