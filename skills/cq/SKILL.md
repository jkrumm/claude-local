---
name: cq
description: Claude Code task queue — inspect, add, pause, and manage the ~/.claude/queue.md queue that auto-injects tasks via the Stop hook
model: haiku
---

# Claude Code Task Queue (`cq`)

The queue enables unattended multi-task Claude Code sessions. When Claude finishes a task (Stop event fires), the notify.ts hook pops the next block from `~/.claude/queue.md` and injects it as the next user message (exit code 2). This allows queuing up work ahead of time without babysitting the terminal.

**Queue file:** `~/.claude/queue.md`
**Hook integration:** `~/.claude/hooks/notify.ts` → `handleStopEvent`
**CLI:** `bun ~/.claude/queue.ts` (aliased as `cq`)

---

## Queue File Format

Human-editable Markdown. Tasks are separated by `---` on its own line.

```markdown
# Claude Queue

/commit --split
---
Implement unit tests for the auth service validators.

Focus on edge cases for token expiry. Relevant files:
- src/auth/validators.ts
- src/auth/validators.test.ts
---
/code-quality
---
PAUSE
---
Write a summary of changes in CHANGELOG.md
```

**Block types:**

| Block | Icon | Behavior |
|-|-|-|
| `/command` | ⚡ | Injected as slash command (triggers skill invocation) |
| Plain text | ◆ | Injected as user message |
| `PAUSE` | ⏸ | Stops queue, sends macOS notification |

**Rules:**
- `#` lines at the top of the file are comments, not tasks
- Blocks can be arbitrarily multi-line — paste links, code snippets, context
- Last block does not need a trailing `---`

---

## CLI Reference

```bash
cq add "text"     # Add single-line task
cq add            # Add multi-line task via stdin (Ctrl+D to finish)
cq edit           # Open queue.md in $EDITOR directly
cq list           # Show all tasks with index, icon, and preview
cq status         # One-line pending count
cq pop            # Print + remove first task (used internally by Stop hook)
cq clear          # Empty the queue
cq pause          # Append PAUSE block at end
cq help           # Usage reference
```

---

## When to Use This Skill

Invoke `/cq` when the user wants to:

- **Inspect the queue**: run `cq list` or `cq status` and report what's pending
- **Add tasks to the queue**: use `cq add "..."` for each task
- **Pause the queue**: append a `PAUSE` block between tasks
- **Clear the queue**: run `cq clear`
- **Queue a series of tasks**: build a sequence of task blocks including slash commands

---

## Workflow: Queueing a Task Series

When asked to "queue up" a set of tasks:

1. Run `cq status` to understand current queue state
2. For each task in order, run `cq add "..."` (or write multi-line via stdin)
3. Insert `cq pause` between logical groups if appropriate
4. Run `cq list` to confirm the full queue looks correct
5. Report the queue contents to the user

**Example — queue a full pipeline:**
```bash
cq add "/code-quality"
cq add "/commit --split"
cq add "/pr create"
cq list
```

---

## Slash Command Injection

When a block starts with `/`, Claude Code receives it exactly as if the user typed it — the system prompt instructs Claude to invoke the `Skill` tool for slash commands. So `/commit`, `/code-quality`, etc. all trigger their respective skills automatically.

If a slash command doesn't seem to invoke the skill, the fallback is to phrase it as an instruction:
```
Please run the /commit skill with --split flag.
```

---

## PAUSE Behavior

When the Stop hook pops a `PAUSE` block:
- Sends a macOS notification: "Queue paused — resume with: cq add"
- Exits with code 0 (normal stop — does NOT continue session)
- The queue resumes automatically on the next Claude Code session if tasks remain after the PAUSE

To resume after a pause: start a new Claude session or remove the PAUSE block manually via `cq edit`.

---

## Stop Hook Mechanics

The relevant code in `~/.claude/hooks/notify.ts`:

```typescript
// handleStopEvent runs on every Stop event
const nextTask = popQueueTask();   // reads + removes first block
if (nextTask === "PAUSE") { /* notify + exit 0 */ }
if (nextTask) {
  process.stdout.write(nextTask);  // inject as next user message
  process.exit(2);                 // exit 2 = continue session
}
// else: normal stop notification
```

Exit code 2 + stdout text = Claude Code treats it as a new user message and continues the session automatically.
