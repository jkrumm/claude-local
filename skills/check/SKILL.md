---
name: check
description: Run validation (format, lint, tsc, test) via forked haiku agent for token efficiency. Replaces /code-quality.
context: fork
model: haiku
agent: general-purpose
---

# Check — Lightweight Validation

Run project validation commands and report results. This is the lightweight counterpart to `/analyze`.

## Process

1. **Discover commands** — Read `package.json` scripts. Look for:
   - `pre` or `validate` (combined format + lint + tsc)
   - `format` or `format:check`
   - `lint`
   - `typecheck` or `tsc` or `check:types`
   - `test` or `test:unit`

2. **Run in order** — Format → Lint → Typecheck → Test. Stop on first failure category and report.

3. **Report results** — Concise summary of what passed and what failed.

## Output Format

```
## Check Results

✓ Format (biome check)
✓ Lint (eslint)
✗ Typecheck — 3 errors:
  - src/foo.ts:42 — Type 'string' is not assignable to type 'number'
  - src/bar.ts:15 — Property 'x' does not exist on type 'Y'
  - src/baz.ts:8 — Cannot find module './missing'
⊘ Test (skipped — typecheck failed)
```

Keep response under 1500 characters. Show errors verbatim — the main agent needs exact locations to fix them.

## Rules

- Never fix code — only report. The main agent decides what to fix.
- Only run tests if format + lint + typecheck pass.
- If no validation scripts found, report that and suggest what to add.
