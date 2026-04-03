---
name: review
description: Multi-angle code review via claude -p subprocess — fresh unbiased context, CodeRabbit CLI, architecture, KISS, security
model: sonnet
---

# Review — Comprehensive Code Review

Launches a `claude -p` subprocess with fresh context — no bias from the current conversation.
Multi-angle review: automated tools + semantic analysis. Only the findings report returns to main context.

## IMPORTANT — Subprocess Only

Always run via `claude -p`. Never execute inline. Never use the Agent tool.
Fresh context is intentional — the reviewer must not be influenced by the current conversation.
If the API key lookup fails, report the error — do not fall back to inline execution.

## Usage

```
/review                    # Review staged/uncommitted changes
/review HEAD~1             # Review last commit
/review path/to/file.ts    # Review specific file
```

## Execution

Build the prompt with the scope substituted and run:

```bash
claude -p --model claude-sonnet-4-6 --dangerously-skip-permissions "$(cat <<'EOF'
You are a senior code reviewer with fresh context — no prior knowledge of why these changes were made.
Review the changes in the current directory at scope [SCOPE].

Step 1 — Load project rules:
Read CLAUDE.md and any ARCHITECTURE.md for conventions and constraints.

Step 2 — Get changes:
  git diff --cached              # staged (default)
  git diff                       # uncommitted (if nothing staged)
  git show HEAD                  # for HEAD~1 or specific commits
  git diff [SCOPE] -- if path    # for specific files

Step 3 — CodeRabbit CLI (if available):
  coderabbit --prompt-only -t uncommitted 2>/dev/null

Step 4 — Quick static analysis:
  npx knip --reporter json 2>/dev/null | jq '.counters // empty'

Step 5 — Semantic review from these angles:
| Angle | What to check |
| Architecture | Layer violations, coupling, fits existing patterns? |
| KISS | Over-engineered, premature abstraction, could be simpler? |
| TypeScript | any usage, missing types, type safety gaps |
| Race conditions | Async issues, shared state, missing awaits |
| Error handling | Unhandled rejections, swallowed errors |
| Security | Injection, XSS, exposed secrets, OWASP top 10 |
| Performance | N+1 queries, missing memoization, large bundles |
| Test gaps | What tests should exist but don't? |
| Bugs | Logic errors, null handling, edge cases |

Step 6 — Test gap analysis: for each changed file, list missing test scenarios.

Output format:

## Review: [scope]

**Files reviewed:** N
**Issues:** N blocking, N warnings, N suggestions

### Blocking
- **[file:line]** CATEGORY — description. Fix: ...

### Warnings
- **[file:line]** CATEGORY — description.

### Suggestions
- **[file:line]** CATEGORY — description.

### Test Gaps
- [file] — missing: [scenario]

### Summary
[1-2 sentence assessment]

Severity: Blocking = bugs/security/type errors. Warning = KISS/missing handling. Suggestion = simplifications.

SCOPE: [SCOPE]
EOF
)"
```

Replace `[SCOPE]` with the skill arguments (default: `uncommitted`).
