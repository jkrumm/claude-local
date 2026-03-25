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

Secrets flow: **1Password CLI vault → macOS Keychain → shell env**. No plain-text files, no network calls at shell startup.

**Why service account, not personal account + biometric:**
Personal account + Touch ID gives full vault access — any process in the session could read banking passwords, SSH keys, etc. The service account is scoped to the CLI vault only, limiting blast radius to dev/automation secrets (Anthropic API key etc.) regardless of what gets triggered.

**Why Keychain cache, not live `op read` at startup:**
`op read` with a service account hits the 1Password API over HTTPS — ~200ms per call, every terminal open. Caching in Keychain makes startup instant and offline-capable. 1Password remains the source of truth; the cache is refreshed via `make setup` or `make refresh-secrets`.

**Keychain entries:**

| Key | Content |
|-|-|
| `op-service-account-token` | 1Password CLI service account token (CLI vault only) |
| `anthropic-api-key` | Fetched from `op://CLI/Anthropic/credential` |
| `anthropic-base-url` | Fetched from `op://CLI/Anthropic/hostname` |

**New machine setup:**
1. Create service account in 1Password → Developer Tools → Service Accounts (CLI vault only)
2. Store token: `security add-generic-password -a "$USER" -s op-service-account-token -w ops1_... -T /usr/bin/security`
3. `make setup` — fetches and caches Anthropic keys automatically

**Rotating a secret:** update in 1Password, then `make setup`, then `source ~/.zshrc`.

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
