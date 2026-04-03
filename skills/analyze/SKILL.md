---
name: analyze
description: Deep static analysis (dead code, duplication, circular deps, complexity) via claude -p subprocess
model: haiku
---

# Analyze — Deep Static Analysis

Runs static analysis tools in a `claude -p` subprocess. Only the findings report returns to main context.

## IMPORTANT — Subprocess Only

Always run via `claude -p`. Never execute inline. Never use the Agent tool.
If the API key lookup fails, report the error — do not fall back to inline execution.

## Execution

```bash
ANTHROPIC_API_KEY=$(security find-generic-password -s claude-sdk-api-key -w) \
ANTHROPIC_BASE_URL=$(security find-generic-password -s claude-sdk-base-url -w) \
  claude -p --model claude-haiku-4-5-20251001 --dangerously-skip-permissions "$(cat <<'EOF'
Run comprehensive static analysis in the current directory. Check package.json first — some tools may already be configured.

Tools to run (use whichever are available):

Dead code (knip):
  npx knip --reporter json 2>/dev/null || npx knip 2>/dev/null

Duplication (jscpd):
  npx jscpd ./src --reporters json --output /tmp/jscpd-report 2>/dev/null
  Then read /tmp/jscpd-report/jscpd-report.json

Circular deps (dependency-cruiser):
  npx depcruise src --output-type json 2>/dev/null | jq '.summary.violations[] | select(.rule.severity == "error")'

Complexity (ESLint, if configured):
  npx eslint src --format json 2>/dev/null | jq '[.[] | .messages[] | select(.ruleId | test("complexity|cognitive"))]'

Output format (under 2000 chars):

## Static Analysis Report

**Dead code (knip):**
- [N] unused exports in [files]
- [N] unused dependencies: [list]

**Duplication (jscpd):**
- [N] clones found ([percentage]% duplication)
- Largest: [file1]:[lines] ↔ [file2]:[lines]

**Circular deps:**
- [N] cycles: [list shortest cycles]

**Complexity:**
- [N] functions above threshold: [list]

**Recommendations:**
1. [Highest impact action]
2. [Second action]
3. [Third action]

Prioritize actionable findings. Skip sections where tools are unavailable.
EOF
)"
```
