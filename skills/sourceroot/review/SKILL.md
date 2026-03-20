---
name: review
description: Agnostic code review that reads project rules from CLAUDE.md and analyzes staged changes
context: fork
agent: Explore
---

# Review Skill

Automated code review that dynamically reads project rules from documentation and analyzes code changes for violations, issues, and improvement suggestions.

**Style:** CodeRabbit-like review - categorized findings with file:line references and fix suggestions.

## Usage

```
/review                    # Review staged changes
/review HEAD~1             # Review last commit
/review path/to/file.ts    # Review specific file
```

## Process

### Step 1: Load Project Rules (Dynamic)

**Read CLAUDE.md for:**
- Coding Standards section
- Core Patterns section
- Error handling conventions
- Type usage rules
- Project-specific patterns

**Optionally read architecture docs if exists (check both locations):**
- `ARCHITECTURE.md` (project root)
- `docs/architecture.md`

**Extract from architecture docs:**
- Architecture patterns
- Layer responsibilities
- Design decisions

**Why read dynamically?** Rules live in project documentation. Reading them ensures the review uses current standards without hardcoding rules that could drift.

### Step 2: Analyze Changes

Get the changes to review:

```bash
# For staged changes (default)
git diff --cached

# For last commit
git show HEAD --stat
git show HEAD

# For specific file
cat <file>
```

Identify:
- Files modified
- Types of changes (new code, modifications, deletions)
- Affected modules/layers

### Step 3: Check Against Loaded Rules

**Review Categories (derived from CLAUDE.md, not hardcoded):**

| Category | What to Check |
|----------|---------------|
| `PATTERN_VIOLATION` | Project patterns not followed |
| `TYPE_ISSUE` | TypeScript type problems |
| `ERROR_HANDLING` | Missing or incorrect error handling |
| `CODE_STYLE` | Style guide violations |
| `SIMPLIFICATION` | Unnecessary complexity |
| `PROBLEM` | Logic errors, bugs |
| `SECURITY` | Potential vulnerabilities |

### Step 4: Output Report

**Format:**

```markdown
## Code Review Summary

**Files reviewed:** {count}
**Issues found:** {count by severity}

---

## Issues

### ❌ PATTERN_VIOLATION

**{file_path}:{line}**
```typescript
{code snippet}
```

**Issue:** {description of the violation}
**Rule:** {quote from CLAUDE.md}
**Fix:** {suggested correction}

---

### ⚠️ TYPE_ISSUE

**{file_path}:{line}**
```typescript
{code snippet}
```

**Issue:** {description}
**Fix:** {suggested correction}

---

## Suggestions (Non-blocking)

### 💡 SIMPLIFICATION

**{file_path}:{line}**
{suggestion for cleaner code}

---

## Summary

{1-2 sentence overall assessment}
```

## Severity Levels

- ❌ **Error** - Must fix before merge (pattern violations, security issues, bugs)
- ⚠️ **Warning** - Should fix (code standards violations)
- 💡 **Suggestion** - Nice to have (simplifications, optimizations)

## Common Patterns to Check

### General (All Projects)
- TypeScript strict mode compliance
- Proper error handling
- No `any` types without justification
- Consistent naming conventions
- Early returns over deep nesting

### React/Next.js Projects
- Hook rules compliance
- Component naming (PascalCase)
- Proper key props in lists
- Effect cleanup

### Node.js/Backend Projects
- Async/await error handling
- Input validation
- Proper typing for API contracts

## Example Output

```markdown
## Code Review Summary

**Files reviewed:** 3
**Issues found:** 2 errors, 1 warning, 2 suggestions

---

## Issues

### ❌ TYPE_ISSUE

**src/utils/parser.ts:45**
```typescript
const result: any = parseData(input);
```

**Issue:** Using `any` type without justification
**Rule:** "No `any` unless explicitly justified with comment" - CLAUDE.md
**Fix:**
```typescript
interface ParseResult {
  data: string;
  valid: boolean;
}
const result: ParseResult = parseData(input);
```

---

### ⚠️ CODE_STYLE

**src/components/Button.tsx:23**
```typescript
if (condition) {
  if (otherCondition) {
    if (thirdCondition) {
      doSomething();
    }
  }
}
```

**Issue:** Deep nesting (3 levels)
**Rule:** "Low nesting: early returns, guard clauses" - CLAUDE.md
**Fix:** Use early returns to flatten the logic

---

## Suggestions

### 💡 SIMPLIFICATION

**src/api/client.ts:89-95**
The conditional chain could be simplified using a lookup object.

---

## Summary

2 issues require attention: an `any` type usage and deep nesting.
Code quality is generally good with clear naming and structure.
```

## When to Use

- Before committing changes
- During PR self-review
- When refactoring unfamiliar code
- After receiving PR feedback (verify fixes)

## Integration

This skill complements `/code-quality`:
- `/code-quality` - Runs automated tools (lint, tsc, test)
- `/review` - Semantic code review against project patterns

Use both before creating a PR:
1. `/review` - Check patterns and conventions
2. `/code-quality` - Run automated validation
3. `/commit` - Commit with conventional message
4. `/pr create` - Create PR
