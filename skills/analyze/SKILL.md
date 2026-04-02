---
name: analyze
description: Deep static analysis — dead code (knip), duplication (jscpd), circular deps (dependency-cruiser), complexity. Structured findings report.
context: fork
model: haiku
---

# Analyze — Deep Static Analysis

Run comprehensive static analysis tools and produce an actionable findings report.

## Tools

Run whichever tools are available in the project. Check `package.json` first — some may already be configured.

### Dead Code & Unused Exports (knip)
```bash
npx knip --reporter json 2>/dev/null || npx knip 2>/dev/null
```
Detects: unused files, exports, dependencies, dev dependencies, unlisted dependencies.

### Code Duplication (jscpd)
```bash
npx jscpd ./src --reporters json --output /tmp/jscpd-report 2>/dev/null
```
Detects: copy-pasted code blocks across files. Read `/tmp/jscpd-report/jscpd-report.json` for results.

### Circular Dependencies (dependency-cruiser)
```bash
npx depcruise src --output-type json 2>/dev/null | jq '.summary.violations[] | select(.rule.severity == "error")'
```
Detects: circular imports, orphaned modules, dependency rule violations.

### Complexity (via existing ESLint)
If eslint is configured, check for complexity warnings:
```bash
npx eslint src --format json 2>/dev/null | jq '[.[] | .messages[] | select(.ruleId | test("complexity|cognitive"))]'
```

## Output Format

```
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
```

Keep response under 2000 characters. Prioritize actionable findings.
