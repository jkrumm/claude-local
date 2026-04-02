---
name: research
description: Deep technical research via forked agent for library docs, web search, and architecture decisions
context: fork
model: haiku
agent: general-purpose
---

# Research Skill

Execute research queries via a forked agent. No MCPs — uses Context7 CLI, Tavily API, and WebFetch directly.

## Tools Available (no MCPs)

### Context7 CLI — Library Documentation
```bash
# Find library ID
npx -y @vedanth/context7 resolve <library>

# Fetch topic-filtered docs
npx -y @vedanth/context7 docs <library> <topic> --tokens 8000
```
Use for: API references, usage patterns, type signatures.
Fallback to web search if library not in Context7.

### Tavily API — Web Search
```bash
TAVILY_KEY=$(security find-generic-password -s tavily-api-key -w 2>/dev/null)
curl -s -X POST https://api.tavily.com/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TAVILY_KEY" \
  -d '{"query": "...", "search_depth": "basic", "max_results": 5}'
```
API key is cached in macOS Keychain by `make setup` (source: `op://common/tavily/API_KEY`).

**Cost awareness:**
- basic search = 1 credit (default, always start here)
- advanced search = 2 credits (only if basic returns irrelevant results)
- Never use tavily_research endpoint (4-250 credits) — manual search + WebFetch is always sufficient

### WebFetch — Direct URL Content (FREE)
Always try WebFetch before any paid extraction. Use for reading specific URLs found via search.

### WebSearch — Built-in Fallback (FREE)
Claude's built-in WebSearch works when other tools are unavailable. No credits needed.

## Default Research Pattern (1 credit)

```text
1. Context7 CLI (if library docs needed)     → FREE
2. Tavily search basic (if web search needed) → 1 credit
3. WebFetch the best URL(s)                   → FREE
```

## Research Tiers

### Tier 1: Library API/Usage
Context7 CLI first → fallback to web search.
```bash
npx -y @vedanth/context7 docs react useTransition --tokens 8000
```

### Tier 2: Implementation Patterns
Tavily search → WebFetch best URLs (blogs, GitHub, SO).

### Tier 3: Debugging Errors
Tavily search for GitHub issues + SO → WebFetch solutions.

### Tier 4: Architecture/Comparison
Multiple searches + WebFetch from different perspectives.

## Escalation Strategy

```text
First attempt insufficient?
├─ Missing API details    → Context7 CLI or official docs via WebFetch
├─ Missing examples       → Web search (GitHub, blogs, SO)
├─ Conflicting info       → Multiple source comparison
├─ WebFetch returns blank → Try WebSearch, last resort: Tavily advanced
└─ Still unclear          → Report uncertainty to user
```

## Output Format

```markdown
## Research: [query]

**Summary:** [2-3 sentences, confidence level]

**Findings:**
- [Finding 1 with source]
- [Finding 2 with source]

**Code Examples:** (when applicable)
[Working snippets with imports and types]

**Recommendation:** [Specific, actionable next step]

**Confidence:** [High/Medium/Low] — [reasoning]

**Sources:** [URLs]
```

Keep response under 2000 characters unless code examples require more.

## Anti-Patterns

- Stopping after first search result
- Using Tavily advanced when basic would work
- Not trying WebFetch before paid extraction
- Returning vague "it depends" without specifics
- Not cross-verifying information from 2+ sources
