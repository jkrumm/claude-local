---
name: ralph
description: Scaffold and run a RALPH loop — an autonomous multi-group implementation plan executed by Claude via CLI with state tracking, retries, and per-group learning notes
context: main
---

# RALPH Loop Skill

**RALPH** = Research, Analyze, Learn, Plan, Hack — an autonomous multi-group implementation pattern. Each group is a focused direction; Claude researches, plans, and implements it, then signals completion. The bash runner orchestrates retries, validation, and state between groups.

## When to Use

Large migrations, rewrites, or feature rollouts that are:
- Too big for a single Claude session (>3–4 hours of work)
- Naturally sequenced (each group builds on the previous)
- Risky enough to need per-group validation and rollback safety
- Complex enough to benefit from Claude planning each group independently

Examples: language rewrites, database migrations, API redesigns, CI/CD overhauls.

## Invocation

```
/ralph setup      # Scaffold a new RALPH loop for the current project
/ralph run        # Start/continue running pending groups
/ralph status     # Print group status from state file
/ralph reset N    # Reset group N to pending
```

---

## How to Run Setup (`/ralph setup`)

When the user invokes `/ralph setup`, follow this workflow:

### Step 1 — Understand the task

Ask the user:
- What is the overall goal? (e.g. "rewrite TypeScript server in Go")
- What tech stack / toolchain is involved?
- What are the validation commands? (build, test, lint, typecheck, E2E)
- How many groups (rough estimate)? Groups should be ~1–3h of Claude work each.
- Any hard sequencing constraints (e.g. "Group 5 must pass E2E before Group 6")?

### Step 2 — Define groups

Decompose the goal into 5–12 groups. Each group has a single clear focus. Rules:
- Group 1 is always the skeleton/foundation (no validation failures possible yet)
- Groups build on previous — never require skipping a group
- E2E green checkpoints: at least one group explicitly validates full E2E before risky changes
- Dangerous/breaking groups (delete old system, cut over production) go last

Output a numbered list for user review before creating files.

### Step 3 — Create directory structure

```
<project>/
  scripts/
    ralph.sh            # runner (generated from template below)
    ralph-reset.sh      # reset helper
  docs/ralph/
    shared-context.md   # injected into every group prompt
    RALPH_NOTES.md      # Claude appends after each group
    RALPH_REPORT.md     # auto-generated status
    prompts/
      group-1.md
      group-2.md
      ...
```

State and logs are gitignored:
```
.ralph-tasks.json
.ralph-logs/
```

Add to `.gitignore`:
```
.ralph-tasks.json
.ralph-logs/
```

### Step 4 — Write shared-context.md

The shared context is prepended to every group prompt. Include:

```markdown
# <Project> — RALPH Shared Context

You are implementing: **<goal>**. Read this fully before starting your group.

---

## What <Project> Is

[2–3 paragraph description: what it does, why it exists, key design decisions]

---

## Repository Layout

[tree or table of relevant files/dirs]

---

## Tech Stack

| Concern | Choice |
|-|-|
| ... | ... |

---

## Validation Commands

**Primary (run after every group):**
```bash
<build command>    # must compile/bundle clean
<test command>     # all unit tests pass
<lint command>     # must be clean
```

**E2E (only when instructed — may require Docker/infra):**
```bash
<e2e command>
```

---

## Research Before Implementing

Always start by:
1. Explore the codebase with Glob/Grep/Read — understand existing patterns
2. Research unfamiliar libraries with Context7 or Tavily Search + WebFetch
3. Read relevant existing code before writing new code
4. The group prompt is direction, not prescription — use a better approach if you find one

---

## Learning Notes

After completing each group, **always append** to `docs/ralph/RALPH_NOTES.md`:

```markdown
## Group N: <title>

### What was implemented
<1–3 sentences>

### Deviations from prompt
<what you changed and why>

### Gotchas & surprises
<anything unexpected — library APIs, language quirks, tooling surprises>

### Security notes
<security-relevant decisions, if any>

### Tests added
<list of test files/functions added>

### Future improvements
<deferred work, tech debt, better approaches possible>
```

---

## Commit Format

Conventional commits, no AI attribution:
```
feat(<scope>): <description>
refactor(<scope>): <description>
fix(<scope>): <description>
```

Stage only modified files. Commit before signaling completion.

---

## Completion Signal

Output exactly one of these at the end, as the very last line:

```
RALPH_TASK_COMPLETE: Group N
```

If you cannot proceed due to an unresolvable blocker:

```
RALPH_TASK_BLOCKED: Group N - <reason in one sentence>
```
```

### Step 5 — Write group prompt files

Each `group-N.md` follows this template:

```markdown
# Group N: <Title>

## What You're Doing

[2–4 sentences. What is the goal of this group? What state does it leave the codebase in?]

---

## Research & Exploration First

1. [Specific file to read — always read before writing]
2. [Library to research via Context7 or Tavily]
3. [Existing pattern to understand]
4. [Edge case to investigate]

---

## What to Implement

### 1. <Component/file name>

[What to create or change. Be specific about interfaces, types, function signatures.]

```<lang>
// Key signatures or skeleton
```

### 2. <Next component>

[...]

---

## Validation

```bash
<build>    # must pass
<test>     # all pass, including new tests for this group
<lint>     # clean
```

[List what to test specifically — table-driven tests, edge cases, happy paths.]

---

## Commit

```
feat(<scope>): <description of this group's work>
```

---

## Done

Append learning notes to `docs/ralph/RALPH_NOTES.md`, then:
```
RALPH_TASK_COMPLETE: Group N
```
```

**Group prompt discipline:**
- Group 1: foundation only, no validation gate (nothing to validate yet)
- E2E checkpoint groups: explicitly state "Run full E2E: `<cmd>`"
- Cutover/breaking groups: add a "DANGER" note at the top, explicit rollback instructions
- Keep prompts tight: direction + key signatures + validation. Not a full spec.

### Step 6 — Generate the runner script

Write `scripts/ralph.sh` using the proven template:

```bash
#!/usr/bin/env bash
# <Project> — RALPH Loop Runner
#
# Usage:
#   ./scripts/ralph.sh              # Run all pending groups
#   ./scripts/ralph.sh 3            # Run only group 3
#   ./scripts/ralph.sh --reset 3    # Reset group 3 to pending, then run
#   ./scripts/ralph.sh --status     # Print status and exit
#
# Logs: .ralph-logs/group-N.log
# Watch live: tail -f .ralph-logs/group-N.log
#
# Prerequisites:
#   brew install coreutils   # for gtimeout
#   claude CLI must be in PATH

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCS_DIR="$REPO_ROOT/docs/ralph"
PROMPTS_DIR="$DOCS_DIR/prompts"
STATE_FILE="$REPO_ROOT/.ralph-tasks.json"
LOGS_DIR="$REPO_ROOT/.ralph-logs"
REPORT_FILE="$DOCS_DIR/RALPH_REPORT.md"

MAX_RETRIES=3
CLAUDE_TIMEOUT=2700  # 45 minutes per group

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

TOTAL_GROUPS=<N>

GROUP_TITLES=(
  ""  # 1-indexed
  "<title 1>"
  "<title 2>"
  # ...
)

log_info()    { echo -e "${BLUE}[ralph]${NC} $*"; }
log_success() { echo -e "${GREEN}[ralph]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[ralph]${NC} $*"; }
log_error()   { echo -e "${RED}[ralph]${NC} $*"; }

require_commands() {
  local missing=0
  for cmd in claude gtimeout python3; do
    if ! command -v "$cmd" &>/dev/null; then
      log_error "$cmd not found."
      missing=1
    fi
  done
  [[ $missing -eq 0 ]] || { echo "Install: brew install coreutils"; exit 1; }
}

# ── State management ──────────────────────────────────────────────────────────

init_state() {
  [[ -f "$STATE_FILE" ]] && { log_info "Resuming from existing state."; return; }
  log_info "Initializing task state..."
  python3 - <<PYEOF
import json
titles = [$(printf '"%s", ' "${GROUP_TITLES[@]:1}" | sed 's/, $//')]
groups = [{"id": i+1, "title": t, "status": "pending", "attempts": 0,
           "started_at": None, "completed_at": None}
          for i, t in enumerate(titles)]
state = {"groups": groups, "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
with open("$STATE_FILE", "w") as f:
    json.dump(state, f, indent=2)
print("State initialized.")
PYEOF
}

get_field() {
  python3 -c "
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == $1:
        print(g.get('$2', ''))
        break
"
}

set_field() {
  python3 - <<PYEOF
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == $1:
        val = '$3'
        if val in ('True', 'False', 'None'):
            val = {'True': True, 'False': False, 'None': None}[val]
        g['$2'] = val
        break
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
PYEOF
}

inc_attempts() {
  python3 - <<PYEOF
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == $1:
        g['attempts'] = g.get('attempts', 0) + 1
        break
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
PYEOF
}

print_status() {
  python3 - <<PYEOF
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
icons = {'complete': '✅', 'blocked': '🚫', 'pending': '⬜', 'in_progress': '🔄'}
total = len(state['groups'])
done = sum(1 for g in state['groups'] if g['status'] == 'complete')
blocked = sum(1 for g in state['groups'] if g['status'] == 'blocked')
pending = total - done - blocked
print(f"  {total} groups | {done} complete | {pending} pending | {blocked} blocked")
print()
for g in state['groups']:
    icon = icons.get(g['status'], '⬜')
    attempts = f"  (attempt {g['attempts']})" if g['attempts'] > 0 else ""
    print(f"  {icon}  Group {g['id']}: {g['title']}{attempts}")
PYEOF
}

# ── Validation ────────────────────────────────────────────────────────────────

validate() {
  local label=${1:-""}
  log_info "Validation${label:+ ($label)}..."
  cd "$REPO_ROOT"
  # CUSTOMIZE: replace with your project's validation commands
  if ! <build command> 2>&1; then log_error "Build failed"; return 1; fi
  if ! <test command> 2>&1; then log_error "Tests failed"; return 1; fi
  log_success "Validation passed"
  return 0
}

# ── Claude invocation ─────────────────────────────────────────────────────────

run_group() {
  local group_id=$1
  local prompt_file="$PROMPTS_DIR/group-$group_id.md"
  local context_file="$DOCS_DIR/shared-context.md"
  local log_file="$LOGS_DIR/group-$group_id.log"

  mkdir -p "$LOGS_DIR"

  if [[ ! -f "$prompt_file" ]]; then
    log_error "Prompt not found: $prompt_file"
    return 1
  fi

  local full_prompt
  full_prompt="$(cat "$context_file")"$'\n\n---\n\n'"$(cat "$prompt_file")"

  log_info "Claude running (timeout: ${CLAUDE_TIMEOUT}s) → log: .ralph-logs/group-$group_id.log"
  log_info "Watch live: tail -f .ralph-logs/group-$group_id.log"
  echo ""

  local exit_code=0
  if CLAUDE_CODE_ENABLE_TASKS=true CLAUDECODE="" gtimeout "$CLAUDE_TIMEOUT" claude \
    -p "$full_prompt" \
    --dangerously-skip-permissions \
    --output-format stream-json \
    --verbose \
    --no-session-persistence \
    < /dev/null > "$log_file" 2>&1; then
    exit_code=0
  else
    exit_code=$?
  fi

  [[ $exit_code -eq 124 ]] && { log_error "Timed out after ${CLAUDE_TIMEOUT}s"; return 1; }

  grep -q "RALPH_TASK_COMPLETE: Group $group_id" "$log_file" && return 0
  grep -q "RALPH_TASK_BLOCKED: Group $group_id" "$log_file" && return 2

  log_warn "Claude finished but no completion signal in log."
  return 1
}

# ── Report ────────────────────────────────────────────────────────────────────

generate_report() {
  python3 - <<PYEOF
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
icons = {'complete': '✅', 'blocked': '🚫', 'pending': '⬜', 'in_progress': '🔄'}
total = len(state['groups'])
done = sum(1 for g in state['groups'] if g['status'] == 'complete')
blocked = sum(1 for g in state['groups'] if g['status'] == 'blocked')
pending = total - done - blocked
lines = [
    "# RALPH Report",
    "",
    f"Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)",
    f"Groups: {total} total | {done} complete | {pending} pending | {blocked} blocked",
    "", "## Status", "",
]
for g in state['groups']:
    icon = icons.get(g['status'], '⬜')
    attempts = f" (attempts: {g['attempts']})" if g['attempts'] > 0 else ""
    lines.append(f"- {icon} **Group {g['id']}**: {g['title']}{attempts}")
lines += ["", "## Next Steps", ""]
if done == total:
    lines += ["All groups complete.", "", "1. Review: `git log --oneline -20`", "2. Run full E2E", "3. Create PR: `/pr`"]
elif pending > 0:
    lines.append("Run `./scripts/ralph.sh` to continue.")
with open('$REPORT_FILE', 'w') as f:
    f.write('\n'.join(lines) + '\n')
print(f"Report: $REPORT_FILE")
PYEOF
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  local target_group=""
  local do_reset=false
  local status_only=false

  while [[ $# -gt 0 ]]; do
    case $1 in
      --status) status_only=true; shift ;;
      --reset) do_reset=true; target_group="${2:?'--reset requires a group number'}"; shift 2 ;;
      [0-9]*) target_group="$1"; shift ;;
      *) echo "Unknown: $1"; echo "Usage: $0 [group] [--reset group] [--status]"; exit 1 ;;
    esac
  done

  echo ""
  echo -e "${BOLD}  RALPH Loop${NC}"
  echo ""

  require_commands
  cd "$REPO_ROOT"
  init_state

  if $status_only; then print_status; exit 0; fi

  if $do_reset; then
    log_info "Resetting Group $target_group to pending..."
    set_field "$target_group" "status" "pending"
    python3 - <<PYEOF
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == $target_group:
        g['attempts'] = 0; break
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
PYEOF
  fi

  print_status; echo ""

  local groups_to_run=()
  if [[ -n "$target_group" ]]; then
    groups_to_run=("$target_group")
  else
    for i in $(seq 1 $TOTAL_GROUPS); do groups_to_run+=("$i"); done
  fi

  for group_id in "${groups_to_run[@]}"; do
    local status
    status=$(get_field "$group_id" "status")

    if [[ "$status" == "complete" ]]; then
      echo -e "  ✅  Group $group_id: ${GROUP_TITLES[$group_id]} — skipped (complete)"
      continue
    fi
    if [[ "$status" == "blocked" ]]; then
      echo -e "  🚫  Group $group_id: ${GROUP_TITLES[$group_id]} — skipped (blocked)"
      continue
    fi

    local attempts
    attempts=$(get_field "$group_id" "attempts")

    if [[ "$attempts" -ge "$MAX_RETRIES" ]]; then
      log_warn "Group $group_id reached max retries. Marking blocked."
      set_field "$group_id" "status" "blocked"
      continue
    fi

    echo ""
    echo "  ────────────────────────────────────────────"
    echo -e "  ${BOLD}Group $group_id: ${GROUP_TITLES[$group_id]}${NC}"
    echo "  Attempt: $((attempts + 1)) / $MAX_RETRIES"
    echo "  ────────────────────────────────────────────"
    echo ""

    # Pre-group validation (skip group 1 — nothing to validate yet)
    if [[ "$group_id" -gt 1 ]]; then
      if ! validate "pre-group $group_id"; then
        log_error "Pre-group validation failed. Fix before continuing."
        exit 1
      fi
      echo ""
    fi

    set_field "$group_id" "status" "in_progress"
    inc_attempts "$group_id"

    run_result=0
    run_group "$group_id" || run_result=$?
    echo ""

    if [[ $run_result -eq 0 ]]; then
      log_success "Group $group_id complete."
      set_field "$group_id" "status" "complete"
      set_field "$group_id" "completed_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo ""
      if validate "post-group $group_id"; then
        log_success "Post-group validation passed ✓"
      else
        log_warn "Post-group validation FAILED. Review log and fix."
        log_warn "Retry: ./scripts/ralph.sh --reset $group_id"
      fi
    elif [[ $run_result -eq 2 ]]; then
      log_warn "Group $group_id blocked. See: .ralph-logs/group-$group_id.log"
      set_field "$group_id" "status" "blocked"
    else
      log_error "Group $group_id failed (attempt $((attempts + 1)) / $MAX_RETRIES)"
      set_field "$group_id" "status" "pending"
      log_info "Log: .ralph-logs/group-$group_id.log"
      new_attempts=$(get_field "$group_id" "attempts")
      if [[ "$new_attempts" -ge "$MAX_RETRIES" ]]; then
        set_field "$group_id" "status" "blocked"
      elif [[ -z "$target_group" ]]; then
        log_warn "Stopping. Fix Group $group_id before proceeding."
        break
      fi
    fi

    echo ""
  done

  echo ""
  generate_report
  echo ""
  echo -e "${BOLD}  RALPH loop done.${NC}"
  echo ""
  print_status
  echo ""
}

main "$@"
```

Also create `scripts/ralph-reset.sh`:

```bash
#!/usr/bin/env bash
# Reset a group to pending (allows re-running after manual fix)
# Usage: ./scripts/ralph-reset.sh <group-id>
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/ralph.sh" --reset "${1:?'Usage: ralph-reset.sh <group-id>'}"
```

Make both executable: `chmod +x scripts/ralph.sh scripts/ralph-reset.sh`

---

## Key Design Decisions (battle-tested)

### Claude invocation flags

```bash
gtimeout "$CLAUDE_TIMEOUT" claude \
  -p "$full_prompt" \
  --dangerously-skip-permissions \  # lets Claude run tools without prompting
  --output-format stream-json \     # writes to log file in real-time (text format buffers)
  --verbose \                       # includes tool use in log output
  --no-session-persistence \        # fresh context each group
  < /dev/null                       # prevents interactive prompts from blocking
```

`CLAUDE_CODE_ENABLE_TASKS=true` + `CLAUDECODE=""` suppress interactive UI noise.

### Completion signal detection

The runner greps the raw log file for `RALPH_TASK_COMPLETE: Group N`. Claude must emit this as literal text in its response (not inside a code block). If Claude finishes without the signal, it's treated as a failure and retried.

### Validation gate

Pre-group validation (group > 1): ensures previous group left repo clean before Claude starts.
Post-group validation: catches regressions introduced in the current group.
If post-group fails: print warning but don't mark as blocked — Claude completed its task; the human needs to fix validation errors before retrying.

### Retry semantics

- `attempts` increments before run (not after)
- On failure: status → pending; runner stops sequential execution so human can inspect log
- On blocked signal: status → blocked; skipped in all future runs until manual `--reset`
- Max retries reached: auto-mark blocked

### Shared context injection

`full_prompt = shared_context + "\n\n---\n\n" + group_prompt`

Shared context is read fresh each group run — it can be updated between runs.

---

## Group Sizing Guidelines

| Group duration | Size indicator |
|-|-|
| < 30 min | Too small — merge with adjacent group |
| 1–2h | Ideal |
| 2–3h | Acceptable for focused work |
| > 3h | Split — Claude loses focus, errors accumulate |

Each group should leave the repo in a **compilable, testable state**. Never have a group that deliberately breaks the build (except explicitly transient mid-group state).

---

## After All Groups Complete

1. `./scripts/ralph.sh --status` — confirm all green
2. `git log --oneline -20` — review commit history
3. Run full E2E suite
4. Review `docs/ralph/RALPH_NOTES.md` — capture gotchas in CLAUDE.md if broadly applicable
5. `/pr` — create PR

---

## Anti-Patterns to Avoid

- **God groups**: one group does everything — split it
- **Underspecified validation**: "it should work" — name the exact commands
- **No research step in prompt**: Claude invents APIs it doesn't know — always include "Research First"
- **Skipping the notes template**: the notes file is the institutional memory — don't skip it
- **Overly prescriptive prompts**: include key interfaces and constraints, not a full implementation spec — leave Claude room to find better approaches
- **E2E-only validation**: E2E is slow and fragile for early groups; use unit tests until the system is wired together
