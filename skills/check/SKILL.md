---
name: check
description: Run validation (format, lint, tsc, test) via claude -p subprocess. Replaces /code-quality.
model: haiku
---

# Check — Lightweight Validation

Runs project validation in a `claude -p` subprocess. Only the pass/fail report returns to main context.

## IMPORTANT — Subprocess Only

Always run via `claude -p`. Never execute inline. Never use the Agent tool.
If the API key lookup fails, report the error — do not fall back to inline execution.

## Execution

Single bash command — `mktemp` ensures no collision if run in parallel:

```bash
TMPFILE=$(mktemp /tmp/claude-check-XXXXXX.txt)
cat > "$TMPFILE" << 'PROMPT_END'
Run project validation in the current directory.

Step 1 — Discover commands: Read package.json scripts. Look for:
- Combined: pre, validate, check, ci
- Format: format, format:check, fmt, biome:format
- Lint: lint, eslint, biome:lint
- Typecheck: typecheck, tsc, check:types, type-check
- Test: test, test:unit, vitest, jest

Prefer combined scripts over individual ones.

Step 2 — Run in order: Format → Lint → Typecheck → Test.
Stop on first failure category. Only run tests if format + lint + typecheck pass.

Step 3 — Report results.

Output format (under 1500 chars):

## Check Results

✓/✗ Format ([command used])
✓/✗ Lint ([command used])
✓/✗ Typecheck — N errors:
  - src/file.ts:42 — error message verbatim
⊘ Test (skipped — typecheck failed)

Rules:
- Never fix code — only report.
- Show errors verbatim with exact file:line locations.
- If no validation scripts found, report that and suggest what to add.
PROMPT_END
ANTHROPIC_API_KEY=$(security find-generic-password -s claude-sdk-api-key -w) \
ANTHROPIC_BASE_URL=$(security find-generic-password -s claude-sdk-base-url -w) \
  claude -p --model claude-haiku-4-5-20251001 --dangerously-skip-permissions < "$TMPFILE"
rm -f "$TMPFILE"
```
