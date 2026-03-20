---
name: code-quality
description: Run validation (format, lint, tsc, test) via forked agent for token efficiency
context: fork
agent: general-purpose
---

# Code Quality Skill

Execute code quality checks via a forked agent. Isolates validation output from main context, saving tokens and providing clean error reports.

## Usage

```
/code-quality                    # Full validation
/code-quality check:typecheck    # TypeScript only
/code-quality check:lint         # Lint only
/code-quality check:test         # Tests only
/code-quality files:path/to/file.ts  # Specific files
```

## Process

### Step 1: Runtime Detection (MANDATORY)

Detect runtime and package manager from lockfiles:

```bash
if [ -f "bun.lockb" ]; then
  RUNTIME="bun"; PKG_CMD="bun"
elif [ -f "pnpm-lock.yaml" ]; then
  RUNTIME="node"; PKG_CMD="pnpm"
elif [ -f "yarn.lock" ]; then
  RUNTIME="node"; PKG_CMD="yarn"
elif [ -f "package-lock.json" ]; then
  RUNTIME="node"; PKG_CMD="npm"
else
  RUNTIME="node"; PKG_CMD="npm"
fi
```

### Step 2: Script Discovery (MANDATORY)

Read `package.json` and identify available scripts:

| Category | Scripts to Find |
|----------|-----------------|
| Combined | `pre`, `check`, `validate`, `ci` |
| Format | `format`, `fmt`, `prettier`, `biome:format` |
| Lint | `lint`, `lint:fix`, `eslint`, `biome:lint` |
| Typecheck | `typecheck`, `type-check`, `tsc`, `types` |
| Test | `test`, `test:unit`, `vitest`, `jest` |
| Build | `build`, `build:types` |

**Priority:** Prefer combined scripts (`pre`, `check`, `validate`) over individual.

### Step 3: Execute Validation

Based on argument provided:

| Argument | Command |
|----------|---------|
| (none) | Combined script OR format + lint + tsc + test |
| `check:typecheck` | `$PKG_CMD run tsc` or `$PKG_CMD run typecheck` |
| `check:lint` | `$PKG_CMD run lint` |
| `check:test` | `$PKG_CMD test -- -o` (changed files) |
| `files:<path>` | `$PKG_CMD test -- <path>` |

### Step 4: Parse Output & Return Report

**Report Format:**

```markdown
## Code Quality Report

### Runtime Environment
- **Runtime:** Bun 1.x / Node 20.x
- **Package Manager:** bun / pnpm / npm
- **Scripts Used:** `pre` (combined) / individual

### Results

#### Formatting
✅ **PASSED** - All files formatted correctly
⚠️ **FIXED** - 3 files auto-formatted
❌ **FAILED** - 2 files have formatting issues
   - `src/utils/parser.ts:45` - Line too long

#### Linting
✅ **PASSED** - No linting errors
⚠️ **WARNINGS** - 5 warnings (non-blocking)
❌ **ERRORS** - 3 errors must be fixed
   - `src/hooks/useAuth.ts:15:3` - 'any' type not allowed

#### Type Checking
✅ **PASSED** - No type errors
❌ **FAILED** - 2 type errors
   - `src/api/types.ts:34:5` - Type 'string' not assignable to 'number'

#### Tests
✅ **PASSED** - 42 tests passed
⚠️ **SKIPPED** - 3 tests skipped
❌ **FAILED** - 2 tests failed
   - `src/utils/parser.test.ts` › parseJSON › should handle null

### Summary
| Check | Status | Details |
|-------|--------|---------|
| Format | ✅ | Clean |
| Lint | ⚠️ | 5 warnings |
| Types | ❌ | 2 errors |
| Tests | ❌ | 2 failed |

### Suggested Fixes
[Specific fix suggestions for each error]
```

## Error Parsing Patterns

**TypeScript errors:**
```
src/path/file.ts(line,col): error TS1234: Message
```

**ESLint errors:**
```
path/file.ts:line:col - error: Message
```

**Test failures:**
```
FAIL src/path/file.spec.ts
  ● TestSuite › test name
    Expected: X
    Received: Y
```

## Test Runner Detection

| Dependency | Runner | Changed Files Flag |
|------------|--------|-------------------|
| `vitest` | Vitest | `vitest run --changed` |
| `jest` | Jest | `jest -o` |
| `bun:test` | Bun Test | `bun test` |

## When to Use

- After implementing any code changes
- Before suggesting a commit message
- When debugging test failures
- Before creating a PR (invoked automatically by `/pr create`)

## Anti-Patterns (AVOID)

- Running commands without checking `package.json` first
- Assuming `npm` when `bun.lockb` exists
- Running full test suite when only specific files changed
- Running `dev` servers (user validates running apps manually)
- Refactoring untouched code while fixing errors
