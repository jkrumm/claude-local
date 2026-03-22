# cq — Claude Code Task Queue

## What It Is

`cq` is a per-repo task queue that automates unattended multi-task Claude Code sessions.
When Claude finishes a task (Stop event fires), the `notify.ts` hook pops the next block
from `queue.md` at the repo's git root and injects it as the next user message via exit
code 2 — keeping the session alive without babysitting the terminal.

**Planned rename:** `queue.md` → `cqueue.md` (more explicit, avoids collision with project queue files).

## Files

| File | Location | Purpose |
|-|-|-|
| CLI | `~/.claude/queue.ts` | `cq` command — add, list, pop, clear, stop |
| Queue file | `{git-root}/queue.md` | Per-repo task list |
| Stop hook | `~/.claude/hooks/notify.ts` | Pops tasks and injects them on Stop |
| Shell alias | `~/.zshrc` | `alias cq="bun ~/.claude/queue.ts"` |

## Queue File Format

Human-editable Markdown at `{git-root}/queue.md`. Tasks separated by `---`.

```markdown
# Claude Queue

/commit --split
---
Implement unit tests for the auth validators.

Focus on edge cases for token expiry.
Relevant: src/auth/validators.ts
---
/code-quality
---
STOP
---
Write CHANGELOG entry
```

### Block Types

| Block | Icon | Behavior |
|-|-|-|
| Lines starting with `/` | ⚡ | Injected as slash command → triggers skill |
| Plain text | ◆ | Injected as user message |
| `STOP` exactly | ⏹ | Ends queue processing — session stops |

**Rules:**
- `#` lines at the very top = file-level comments, ignored by parser
- Blocks can be arbitrarily multi-line (paste links, code, context)
- Last block doesn't need a trailing `---`
- Parser splits on `\n---\n` and trims each block

## CLI Reference

```bash
cq add "text"     # Append single-line task
cq add            # Append multi-line task via stdin (Ctrl+D)
cq edit           # Open queue.md in $EDITOR
cq list           # Show all tasks with index, icon, preview
cq pop            # Print + remove first task (used by Stop hook internally)
cq status         # One-line pending count
cq clear          # Empty the queue
cq stop           # Append STOP sentinel at end
cq help           # Usage reference
```

## Stop Hook Mechanics

The relevant section in `~/.claude/hooks/notify.ts` (inside `handleStopEvent`):

```typescript
const queueFile = findQueueFile(input.cwd);
const nextTask  = queueFile ? popQueueTask(queueFile) : null;

if (nextTask === "STOP") {
  process.stderr.write("[cq] STOPPED — resume with: cq add\n");
  process.exit(0);   // Normal stop — session ends
}

if (nextTask) {
  // JSON decision=block continues session, reason becomes feedback to Claude
  const output = JSON.stringify({ decision: "block", reason: nextTask });
  writeSync(1, output);     // Synchronous stdout write
  process.exit(0);          // Exit 0 — Claude parses JSON and continues
}

// Queue empty — fall through to normal stop notification
```

**Why `writeSync` + immediate `process.exit(0)`?**
Any `await` between the stdout write and `process.exit` risks hanging
(e.g. cmux notify, osascript). A hanging hook gets killed by Claude Code,
dropping the queued task. `writeSync` is synchronous and guaranteed to flush
before `process.exit`.

**`findQueueFile`** resolves the queue path by running
`git rev-parse --show-toplevel` from `input.cwd`, then appending `queue.md`.
Returns `null` if not in a git repo — queue injection is silently skipped.

**`popQueueTask`** reads the file, splits on `\n---\n`, trims blocks,
removes the first block, writes the rest back atomically, returns the
popped block (or `null` if empty).

## Queue File Location

Per-repo, always at `$(git rev-parse --show-toplevel)/queue.md`. This means:

- Each repo has its own independent queue
- Multiple Claude Code sessions in different repos don't interfere
- The file is globally gitignored (see `~/.gitignore_global`)

## Global Gitignore

`queue.md` (and future `cqueue.md`, `cnotes.md`) are in `~/.gitignore_global`:

```
queue.md
cqueue.md
cnotes.md
```

Configured via: `git config --global core.excludesfile ~/.gitignore_global`

## Statusline Integration

Line 3 of the statusline (`~/.claude/statusline.sh`) shows queue state when non-empty:

```
⚡ /commit --split · +2 more
◆ Refactor auth service · +1 more
⏹ stopped · 3 total
```

Reads from `${git_root}/queue.md` directly — always live.
