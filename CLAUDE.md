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
| `config/zshrc` | `~/.zshrc` | Thin loader — sources all modules in conf.d |
| `config/zsh/*.zsh` | `~/.zsh/conf.d/` (dir symlink) | ai, aliases, claude, git, keybindings, path, secrets, tools |
| `config/gitconfig` | `~/.gitconfig` | includeIf per workspace |
| `config/gitconfig-personal` | `~/.gitconfig-personal` | jkrumm@pm.me + 1Password signing |
| `config/gitconfig-work` | `~/.gitconfig-work` | johannes.krumm@iu.org + 1Password signing |
| `config/gitignore_global` | `~/.gitignore_global` | cqueue.md, cnotes.md |
| `config/ghostty/config` | `~/.config/ghostty/config` | Ghostty terminal config + auto theme switching |
| `config/ghostty/themes/*` | `~/.config/ghostty/themes/` | Blueprint v6 light/dark terminal themes |
| `config/localias.yaml` | `~/Library/Application Support/localias.yaml` | localias proxy config (cqueue.local → 7705) |
| `hooks/notify.ts` | `~/.claude/hooks/notify.ts` | All 4 hook events |
| `scripts/queue.ts` | `~/.claude/queue.ts` | cq CLI |
| `scripts/statusline.sh` | `~/.claude/statusline.sh` | 3-line statusline |
| `scripts/fetch_usage.py` | `~/.claude/fetch_usage.py` | Claude.ai usage % fetcher (uv script) |
| `skills/{name}/` | `~/SourceRoot/.claude/skills/{name}/` | SourceRoot-only |

**Not symlinked:** `~/.claude/settings.json` — machine-specific permissions.
`make setup` creates from template if missing, otherwise jq-merges:
template wins on structural keys (hooks, statusLine, plugins, env); permissions + model/effortLevel/alwaysThinkingEnabled preserved from live file.

## Secrets Strategy

Currently using **personal 1Password account** (biometric/session token). `make setup` calls `op signin` to authenticate; `op` CLI then works interactively with Touch ID.

`ANTHROPIC_API_KEY` is intentionally **not exported** — Claude Code falls back to the subscription when the key is absent. Exporting it would cause Claude Code to bill API credits instead.

**New machine setup:**
1. Install 1Password CLI (`brew install 1password-cli`)
2. Sign in once: `op signin`
3. `make setup`

**Switching back to service account:**
- Uncomment `OP_SERVICE_ACCOUNT_TOKEN` in `config/zsh/secrets.zsh`
- Uncomment the service account block in `_setup-op-token` (Makefile)
- Add token to Keychain: `security add-generic-password -a "$USER" -s op-service-account-token -w ops1_... -T /usr/bin/security`

## Rules

**Adding a skill:** create `skills/{name}/SKILL.md` here, then `make setup`.
Never create directly in `~/SourceRoot/.claude/skills/` — won't be in VCS.

**Skills scope:** loaded only in SourceRoot via `--plugin-dir ~/SourceRoot/.claude`
in `c()`. Not available in IuRoot — intentional. IuRoot uses per-project `.claude/`.

**settings.json changes:** update `config/settings.template.json`, then `make setup`
to merge into the live file. Never edit the live settings.json for persistent changes.

## Debug Logs

Structured JSONL logs at `~/.claude/logs/YYYY-MM-DD.jsonl`. Written by `hooks/notify.ts` and `scripts/fetch_usage.py`. 3-day auto-cleanup on every invocation.

**Query examples:**
```bash
# All events today
cat ~/.claude/logs/$(date +%Y-%m-%d).jsonl | jq .

# Hook stop decisions only
cat ~/.claude/logs/$(date +%Y-%m-%d).jsonl | jq 'select(.event == "stop_decision")'

# Question detection results (why queue fired or paused)
cat ~/.claude/logs/$(date +%Y-%m-%d).jsonl | jq 'select(.event == "question_detect" or .event == "haiku_call" or .event == "haiku_skip")'

# fetch_usage errors
cat ~/.claude/logs/$(date +%Y-%m-%d).jsonl | jq 'select(.src == "fetch_usage")'
```

**Key events to check when debugging:**
- Queue fires on a question → look for `question_detect` (check `reason`, `has_question_mark`) and `haiku_skip` (check `no_api_key`)
- Haiku not called → `haiku_skip` with `reason: "no_api_key"` means `ANTHROPIC_API_KEY` not in hook env
- fetch_usage broken → `fetch_error` with `type` field shows which exception class failed
- Unexpected stop behavior → `stop_decision` shows exact decision taken

## Key Technical Facts

- `cqueue.md` blocks separated by `\n---\n`. Block types: plain text (◆), `/slash` (⚡), `STOP` (⏹).
- Stop hook: JSON `{"decision":"block","reason":task}` to stdout + `process.exit(0)` continues session. Queue empties = natural stop.
- STOP exits with code 0 synchronously — no async notification call before exit.
- Skills have optional `model:` frontmatter (`haiku` for fast forks, default = sonnet).
- `c()` in zshrc: sets `--plugin-dir` and `--dangerously-skip-permissions` per workspace.
