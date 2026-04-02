---
name: review
description: Multi-angle code review — CodeRabbit CLI, static analysis, architecture, KISS, race conditions, TS quality, test gaps, security
context: fork
model: haiku
agent: Explore
---

# Review — Comprehensive Code Review

Multi-angle review that catches issues locally before they reach PRs. Combines automated tools with semantic analysis.

## Usage

```bash
/review                    # Review staged/uncommitted changes
/review HEAD~1             # Review last commit
/review path/to/file.ts    # Review specific file
```

## Process

### Step 1: Load Project Rules
Read CLAUDE.md and any ARCHITECTURE.md for project-specific patterns, conventions, and constraints.

### Step 2: Get Changes
```bash
# Staged changes (default)
git diff --cached
# If nothing staged, check uncommitted
git diff
# For last commit
git show HEAD
```

### Step 3: CodeRabbit CLI (if available)
```bash
# Check if cr is installed
which coderabbit 2>/dev/null

# Run CodeRabbit on uncommitted changes
coderabbit --prompt-only -t uncommitted 2>/dev/null

# Or on a specific target
coderabbit --prompt-only -t HEAD~1 2>/dev/null
```
Parse the output for findings. CodeRabbit catches: style issues, potential bugs, security concerns, performance problems.

### Step 4: Quick Static Analysis
```bash
# Dead code in changed files (if knip available)
npx knip --reporter json 2>/dev/null | jq '.counters // empty'

# Duplication check (if jscpd available)
npx jscpd ./src --reporters json --output /tmp/jscpd-report 2>/dev/null
```

### Step 5: Semantic Review

Review from multiple angles — don't just check style:

| Angle | What to Look For |
|-|-|
| **Architecture** | Does this fit the existing patterns? Layer violations? Coupling? |
| **KISS** | Over-engineered? Premature abstraction? Could be simpler? |
| **TypeScript Quality** | `any` usage, missing types, wrong generics, type safety gaps |
| **Race Conditions** | Async issues, shared state, missing awaits, cleanup |
| **Error Handling** | Unhandled promise rejections, swallowed errors, missing error paths |
| **Security** | Injection, XSS, exposed secrets, auth bypass, OWASP top 10 |
| **Performance** | Unnecessary re-renders, N+1 queries, missing memoization, large bundles |
| **Test Gaps** | What tests should exist? Unit, integration, E2E? |
| **Code Duplication** | Same logic in multiple places? Extract or consolidate? |
| **Bugs** | Logic errors, off-by-one, null handling, edge cases |

### Step 6: Test Gap Analysis

For each changed file, assess:
- Does it have tests? Should it?
- What scenarios aren't covered?
- Suggest specific test cases (name + what they verify)

## Output Format

```markdown
## Review: [scope]

**Files reviewed:** N
**Issues:** N blocking, N warnings, N suggestions

### Blocking
- **[file:line]** CATEGORY — description. Fix: ...

### Warnings
- **[file:line]** CATEGORY — description. Fix: ...

### Suggestions
- **[file:line]** CATEGORY — description.

### Test Gaps
- [file] — missing tests for: [scenarios]
- Suggested test: `it("should [behavior]", ...)`

### Summary
[1-2 sentence assessment]
```

## Severity Levels

- **Blocking** — Must fix: bugs, security, race conditions, type errors
- **Warning** — Should fix: KISS violations, missing error handling, style
- **Suggestion** — Nice to have: simplifications, test ideas, refactoring

## Integration

Use before committing:
1. `/review` — Semantic review + CodeRabbit CLI
2. `/check` — Automated validation (format, lint, tsc, test)
3. `/commit` — Commit with conventional message
4. Or just `/ship` — runs all of the above automatically
