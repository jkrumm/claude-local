---
name: implement
description: Guided implementation with research, exploration, and validation. Keeps main agent lean by delegating to a sonnet subagent.
---

# Implement — Guided Implementation

Structured implementation flow for medium-complexity tasks. Lighter than `/ralph`, more guided than ad-hoc coding.

## When to Use

- You have a clear task (from `/grill`, a PRD, or a direct request)
- The task touches multiple files but doesn't need multi-group orchestration
- You want research + explore + implement + validate in one flow

## Process

### 1. Research (if needed)
Before writing code, check if the task involves libraries, APIs, or patterns that may have changed since the model's training cutoff:
- Use `/research` for library docs or external patterns
- Use Explore agent for understanding surrounding codebase
- Read relevant existing code to understand patterns in use

### 2. Plan
State your approach in 2-5 bullet points. Include:
- Which files you'll change and why
- Any new files needed
- Patterns you'll follow from existing code
- Anything you're uncertain about (ask the user)

### 3. Implement
Write the code. Follow existing patterns in the codebase. Key rules:
- Research latest info for any post-2025 patterns
- Explore surrounding code before writing — match existing style
- Keep changes minimal and focused
- Don't refactor untouched code
- Don't add features beyond what was asked

### 4. Validate
After implementation, run `/check` to validate:
- Format, lint, typecheck, test must all pass
- Fix any errors in YOUR changed files
- If validation reveals issues in untouched files, report but don't fix

### 5. Document Learnings
If you discovered something non-obvious during implementation (a gotcha, a pattern, a constraint), consider:
- Adding it to the project's CLAUDE.md if it'll help future sessions
- Adding an ESLint rule if it's an enforceable pattern
- Mentioning it to the user if it's a one-time observation

## Rules

- Always run `/check` before declaring done
- Never skip the research step for unfamiliar libraries
- Keep the main agent informed with concise progress updates
- If blocked, ask the user — don't guess and accumulate wrong assumptions
