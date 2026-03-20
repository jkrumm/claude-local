# Claude Code Statusline

## Overview

A 2–3 line custom statusline rendered by `~/.claude/statusline.sh`, configured
in `~/.claude/settings.json` as:

```json
"statusLine": { "type": "command", "command": "~/.claude/statusline.sh" }
```

The script receives a JSON payload on stdin with session context and prints
1–3 lines to stdout. Each line becomes a separate statusline row.

## Output Format

```
Claude Sonnet 4.6 | 86k/170k 51% | +660 -52 | 308k | 23min
~/SourceRoot/basalt-ui | * feat/add-button
⚡ /commit --split · +2 more
```

**Line 1** — Session metrics:
- Model name
- Context: `{used}k/{usable}k {color-coded %}` — usable = total minus 30k autocompact buffer
- Lines changed: `+{added} -{removed}` (Claude's edits this session)
- Total tokens (cumulative input + output), formatted as `308k` or `1.2M`
- Session duration

**Line 2** — Location:
- CWD (home-shortened, worktree-aware: `WT·SE proj/path` for student-enrolment worktrees)
- Git branch + status: `✓` clean, `*` dirty, `!!` merge conflicts

**Line 3** — Queue (only shown when `queue.md` is non-empty):
- `⚡ /command · +N more` — slash command up next
- `◆ task preview · +N more` — regular task up next
- `⏸ paused · N total` — queue is paused

## Context Color Coding

| Usage | Color |
|-|-|
| < 50% of usable | Green |
| 50–74% | Yellow |
| ≥ 75% | Red |

"Usable" = `context_window_size - 30000` (30k reserved for autocompact buffer).

## Known Gotchas

- `grep -c` on macOS exits 1 when there are no matches, which can corrupt
  arithmetic via `|| echo 0` producing double output. Fixed with `${var:-0}` fallback.
- Script must end with `exit 0` — otherwise the last command's exit code
  leaks out and Claude Code may suppress the statusline display.
- Branch detection uses `| head -1` to prevent multi-line output from
  poisoning the variable (can happen in detached HEAD state).
