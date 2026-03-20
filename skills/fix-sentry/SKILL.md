---
name: fix-sentry
description: Debug and fix Sentry errors with deep code investigation and research
---

# Fix Sentry Skill

Debug and fix production errors from Sentry with deep code investigation and research.

## Arguments

- `project` - Sentry project slug
- `search` - Search query to find issues
- `note` - Optional context about the error

## Skill Architecture (Token Efficiency)

**Principle:** Keep main thread focused on coordination. Use forked skills for heavy operations.

### Available Skills

| Skill | Use For | Context |
|-------|---------|---------|
| **`/research`** | Error research, library docs, solutions | fork |
| **Built-in Explore** | Deep codebase analysis, finding error sources | Explore agent |

### Delegation Rules

**ALWAYS delegate:**
- Code investigation (reading >3 files) → Built-in Explore agent
- External research (web search, library docs) → `/research` skill

**Keep in main thread:**
- Sentry MCP queries (lightweight, essential context)
- User communication and approval flows
- Solution presentation and iteration

### Why Delegation?

- MCP tool responses can be 10-50k tokens each
- Forked skills process internally and return only summaries
- Main thread stays focused on **error analysis** with user
- Token savings: ~80% for research, ~75% for codebase exploration

---

## MCP Tools for Debugging

### Sentry MCP (Main Thread - Essential)

Load Sentry tools before use:
```
ToolSearch("select:mcp__sentry__search_issues")
ToolSearch("select:mcp__sentry__get_issue_details")
```

**Available operations:**
- `search_issues`: Find issues matching criteria
- `get_issue_details`: Full error details, stack trace, breadcrumbs
- `search_events`: Find specific error events
- `get_trace_details`: Distributed trace context

---

## Workflow

### Step 1: Lookup Issues → Main Thread (Sentry MCP)

```markdown
## 🔍 Loading Sentry Issues

**Project:** $1
**Search:** $2
**Context:** $3

Using Sentry MCP to find matching issues...

[Execute Sentry MCP queries:]
- search_issues(organizationSlug: "...", projectSlug: "$1", query: "$2")
- get_issue_details for top results
```

**Present findings:**

```markdown
## 📊 Sentry Issues Found

### Issue 1: [Title]
- **ID:** [Issue ID]
- **Events:** [Count] | **Users Affected:** [Count]
- **First Seen:** [Date] | **Last Seen:** [Date]
- **Trending:** [↑ increasing / → stable / ↓ decreasing]

### Issue 2: [Title]
[...]

---

**Which issue should I investigate first?**
```

**⏸️ WAIT for user selection!**

---

### Step 2: Understand the Data → Main Thread

For the selected issue, analyze Sentry data in main thread:

```markdown
## 🔬 Error Analysis: [Issue Title]

### Error Details
- **Type:** [Error type]
- **Message:** [Error message]
- **Environment:** [client-side / server-side]
- **Release:** [Version]

### Stack Trace
```
[Full stack trace from Sentry]
```

### Breadcrumbs
[Relevant breadcrumbs leading to error]

### Context Tags
[User info, browser, OS, custom tags]

### Frequency Pattern
- **Total Events:** [Count]
- **Recent Trend:** [Description]
- **Peak Times:** [If notable pattern]

---

**Initial Assessment:**
- Likely location: `[file:line]`
- Suspected cause: [Brief hypothesis]
- Impact: [Critical / High / Medium / Low]

**⏸️ Proceed with code investigation?**
```

---

### Step 3: Code Investigation → Explore Agent

**⚠️ ALWAYS use Explore agent for codebase analysis.**

Ask Claude directly:
```
Investigate Sentry error in codebase:

**Error:** [Type] - [Message]
**Stack Trace Location:** [file:line from Sentry]
**Suspected Area:** [Initial assessment]

Analyze:
1. Exact error location - Find the code at [file:line]
2. Surrounding context - Read 50+ lines around error location
3. Call chain - Trace how we got to this code
4. Related code - Find all callers and dependencies
5. Git history - Check recent changes to affected files
6. Similar patterns - Find if this pattern exists elsewhere
7. Error handling - How are errors handled in this area?
```

**After investigation:**

```markdown
### 🔎 Code Investigation Results

#### Error Location
**File:** `[path:line]`
```typescript
// [Code snippet with context]
```

#### Call Chain
```
[Entry point]
  → [Function A]
    → [Function B]
      → [ERROR HERE]
```

#### Recent Changes
| Commit | Date | Author | Message |
|--------|------|--------|---------|
| [hash] | [date] | [author] | [msg] |

#### Root Cause Hypothesis
[Summary from investigation]

---

**Shall I research potential solutions?** (via /research skill)
**Or do you see the issue and want to proceed to fixes?**
```

**⏸️ WAIT for user feedback!**

---

### Step 4: Research → /research Skill

**⚠️ ALWAYS use /research skill for external research.**

If research is needed:

```
/research debug:[error type] [framework] [specific context]
```

**After research returns:**

```markdown
### 📚 Research Results

#### Common Causes
1. [Cause 1] - [Description]
2. [Cause 2] - [Description]

#### Recommended Solutions
**Solution A:** [Description]
```typescript
// Code example
```

**Solution B:** [Description]
```typescript
// Code example
```

#### Relevant Sources
- [Source 1](url) - [Brief description]
- [Source 2](url) - [Brief description]

---

**Which solution approach should we pursue?**
```

**⏸️ WAIT for user decision!**

---

### Step 5: Solution Ideation

Based on investigation and research, synthesize solutions:

```markdown
## 💡 Solution Options

### Option A: [Quick Fix]
**Approach:** [Description]
**Pros:** Fast, minimal changes
**Cons:** [Any drawbacks]
**Risk:** Low

### Option B: [Comprehensive Solution]
**Approach:** [Description]
**Pros:** [Benefits]
**Cons:** More changes required
**Risk:** Medium

### Option C: [Alternative]
**Approach:** [Description]
**Pros:** [Benefits]
**Cons:** [Drawbacks]
**Risk:** [Level]

---

**My Recommendation:** Option [X] because [reasoning]

**Which approach should we implement?**
```

**⏸️ WAIT for user decision!**

---

### Step 6: Implementation

After approval, implement the fix:

```markdown
## 🔧 Implementing Fix

**Chosen Approach:** [Option X]

### Changes to make:

**File:** `[path]`
```typescript
// Before
[old code]

// After
[new code]
```

**⏸️ Shall I make these changes?**
```

After implementation, validate:

```markdown
### ✅ Validation

- [ ] TypeScript compiles without errors
- [ ] Lint passes
- [ ] Existing tests pass
- [ ] Error scenario is handled correctly

**Run /code-quality to validate?**
```

---

### Step 7: Follow-Up Actions

After implementing the fix:

```markdown
## ✅ Fix Complete

### Changes Made
- `[file1]`: [Brief description]
- `[file2]`: [Brief description]

### Commit Suggestion
```
fix: resolve [brief description]

[More detailed explanation of what was fixed and why]

Fixes: [Sentry Issue URL]
```

**⏸️ Shall I commit these changes?** (use /commit)
```

After commit:

```markdown
### Sentry Issue Resolution

**Issue:** [ID] - [Title]

**Options:**
- [ ] Resolve the Sentry issue
- [ ] Add comment linking to fix commit
- [ ] Wait for deployment to verify fix

**⏸️ How should we handle the Sentry issue?**
```

---

## Behavioral Rules

### ✅ DO:
- **Always** load Sentry data fully and understand it first
- **Always** analyze stack trace and breadcrumbs
- **Always** wait for user confirmation after each phase
- **Delegate** code investigation to Explore agent
- **Delegate** all research to `/research` skill
- **Always** prefer KISS solutions
- **Always** maintain error handling and monitoring

### ❌ DON'T:
- **Never** propose fixes without complete error analysis
- **Never** read more than 3 files directly – use Explore agent
- **Never** commit without explicit approval
- **Never** resolve Sentry issues without confirmation

---

## Quick Reference: Skill Delegation

| Phase | Operation | Skill/Agent |
|-------|-----------|-------------|
| Step 1 | Sentry lookup | Main thread (Sentry MCP) |
| Step 2 | Error analysis | Main thread |
| Step 3 | Code investigation | Explore agent |
| Step 4 | Research | `/research` skill |
| Step 5 | Solution ideation | Main thread |
| Step 6 | Implementation | Main thread |
| Step 7 | Follow-up | Main thread |

### Token Efficiency

| Operation | Without Delegation | With Delegation | Savings |
|-----------|-------------------|-----------------|---------|
| Web research | ~45k tokens | ~8k returned | 82% |
| Read 10+ files | ~30k tokens | ~6k returned | 80% |
