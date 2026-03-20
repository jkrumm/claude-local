# Claude Code Hooks — notify.ts

## Overview

A single Bun script (`~/.claude/hooks/notify.ts`) handles all four Claude Code
hook events. It provides rich macOS notifications, workspace identification by
sound, session timing, and the cq task queue injection mechanism.

## Hook Events Handled

| Event | What Triggers It | Handler Behavior |
|-|-|-|
| `SessionStart` | Claude session opens (startup/resume/clear/compact) | Record session start time, capture project/branch context |
| `Notification` | Claude needs user input (idle_prompt) or permission | Send "Input Required" notification with context |
| `Stop` | Claude finishes a task | **Check queue first** → inject next task or send completion notification |
| `SessionEnd` | Claude session closes | Send session summary with total duration |

## Registration

In `~/.claude/settings.json`:

```json
"hooks": {
  "SessionStart": [{ "matcher": "startup|resume|clear|compact", "hooks": [{ "type": "command", "command": "~/.claude/hooks/notify.ts" }] }],
  "Notification":  [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.claude/hooks/notify.ts" }] }],
  "Stop":          [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.claude/hooks/notify.ts" }] }],
  "SessionEnd":    [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.claude/hooks/notify.ts" }] }]
}
```

The hook receives a JSON payload on stdin describing the event type and context.

## Notification Routing

Notifications prefer **cmux** when running inside a cmux session, fall back to **osascript**:

```typescript
// 1. Prefer cmux notify (when CMUX_SOCKET_PATH env var is set by cmux)
if (process.env.CMUX_SOCKET_PATH) {
  await $`cmux notify --title ${title} --body ${body} --tab ${CMUX_TAB_ID}`.quiet();
  return;
}

// 2. Fallback: native macOS notification via osascript
// (terminal-notifier is NOT used — it hangs in multiplexer environments)
await $`osascript -e 'display notification ...'`.quiet();
```

`CMUX_SOCKET_PATH` and `CMUX_TAB_ID` are set automatically by cmux for all
child processes. No manual configuration needed.

## Workspace Sound Identification

Different macOS sounds per workspace — hear which project completed without
looking at the screen:

| Workspace | Sound | Detection |
|-|-|-|
| `SourceRoot` | Hero | `input.cwd` contains `/SourceRoot/` |
| `IuRoot` | Ping | `input.cwd` contains `/IuRoot/` |
| Other | Tink | Fallback |

## Context Extraction

Notifications show: `project • branch • duration`

- **SourceRoot**: extracts 2 path levels — `basalt-ui/packages/web` → `"basalt-ui/packages/web"`
- **IuRoot**: extracts 1 path level — `epos.student-enrolment` → `"epos.student-enrolment"`
- **Branch**: extracted from Claude's transcript, skips `main`/`master` (not interesting)
- **Duration**: elapsed time since `SessionStart` stored in `~/.claude/notification-state.json`

## State Persistence

Between hook invocations, state is written to `~/.claude/notification-state.json`:

```typescript
interface NotificationState {
  sessionStartTime?: number;   // ms timestamp
  projectName?:      string;
  gitBranch?:        string;
  workspace?:        "SourceRoot" | "IuRoot" | "Other";
}
```

## Queue Integration (Stop Event)

See `docs/cq.md` for full details. The critical sequence in `handleStopEvent`:

```
1. findQueueFile(input.cwd)   → resolves {git-root}/queue.md
2. popQueueTask(queueFile)    → removes + returns first block
3a. "PAUSE" → stderr message + process.exit(0)
3b. task    → writeSync(1, task) + process.exit(2)   ← continues session
3c. null    → normal stop notification
```

## Exit Codes

| Code | Meaning |
|-|-|
| 0 | Normal — hook ran clean, Claude session ends |
| 2 | Continue — Claude treats stdout as next user message |
| non-zero | Hook error — shown in Claude UI as "Stop hook error: {stderr}" |

## Debug Output

A temporary debug line writes to stderr on every Stop event:
```
[cq] cwd=/path/to/repo | file=/path/to/repo/queue.md | task="task preview..."
```
This appears in Claude's "Stop hook error" panel. Remove once queue injection is confirmed stable.
