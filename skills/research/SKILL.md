---
name: research
description: Deep technical research via forked agent for library docs, web search, and architecture decisions
context: fork
agent: general-purpose
---

# Research Skill

Execute research queries via a forked agent to save ~80% tokens. Uses available search tools internally and returns summarized findings.

## Tavily Token Budget (CRITICAL — read first)

| Tool | Cost | Use When |
|-|-|-|
| `tavily_search` basic | **1 credit** | Default for all searches |
| `tavily_search` advanced | **2 credits** | Only if basic returns irrelevant results |
| `tavily_extract` basic | **1 credit / 5 URLs** | URL content needed + WebFetch failed |
| `WebFetch` | **0 credits** | Always try before tavily_extract |
| `tavily_research` mini | **4–110 credits** | Multi-source synthesis, no good search results |
| `tavily_research` pro | **15–250 credits** | Complex open-ended research only |

**Default pattern — costs 1 credit total:**
```
tavily_search(query="...", search_depth="basic")  → get URLs
WebFetch(url="<best result URL>", prompt="...")   → read content (FREE)
```

**NEVER use `tavily_research`** when `tavily_search` + `WebFetch` would answer the question.
`tavily_research` minimum spend is 4 credits (mini) or 15 credits (pro) per call — reserve for when you genuinely need multi-source synthesis that you can't do manually.

## Usage

```
/research <query>
/research docs:React useTransition
/research debug:hydration mismatch astro
/research compare:Astro vs Next.js for content sites
```

## Critical Behavior: Dig Deep Until Sufficient

Do NOT stop after a single search. Research iteratively until you have:

1. **Sufficient answer** - Directly addresses the question with confidence
2. **Code examples** - Working, copy-paste-ready snippets (when applicable)
3. **Multiple sources** - Cross-verified information from 2+ sources
4. **Practical guidance** - Actionable next steps, not just theory

## Research Tier Classification

### Tier 1: Simple Facts
**Pattern:** "What is X?", "Is X stable?", "Latest version of Y?"
**Strategy:** Quick web search
**Example:** "What is the latest stable version of Next.js?"

### Tier 2: Library API/Usage
**Pattern:** "How to use [specific API]?", "What's the syntax for X?"
**Strategy:** Context7 MCP (preferred) OR web search for official docs

```
# Use Context7 for library documentation
ToolSearch("select:mcp__context7__resolve-library-id")
ToolSearch("select:mcp__context7__query-docs")

# 2-step process:
1. resolve-library-id(libraryName="react")
2. query-docs(libraryId="/facebook/react", topic="useTransition hook", tokens=8000)
```

**Fallback to web search if:**
- Library not in Context7
- Need changelog/migration guides
- Context7 returns insufficient results

### Tier 3: Complex Implementation Patterns
**Pattern:** "How to implement [complex pattern]?", "Best approach for [edge case]?"
**Strategy:** Deep web research with blogs + official docs

**Example:** "Dark mode toggle for Astro, no flicker, respect system + localStorage"

```
# Use Tavily for web research (basic = 1 credit, advanced = 2 credits)
ToolSearch("select:mcp__claude_ai_Tavily__tavily_search")

tavily_search(
  query="prevent flash dark mode static site astro localStorage system preference",
  search_depth="basic",   # start here; upgrade to "advanced" only if results are off-target
  max_results=5
)
# Then WebFetch the most relevant URL(s) for free
```

**Why blogs matter:** Official docs rarely cover edge cases. Blog posts show real-world patterns, gotchas, complete implementations.

### Tier 4: Debugging Errors
**Pattern:** "Why does X error occur?", "Fix for [specific error message]"
**Strategy:** Search GitHub issues + Stack Overflow + blogs

**Example:** "Astro hydration mismatch with React components"

```
tavily_search(
  query="astro hydration mismatch react component client:load directive",
  search_depth="basic",   # 1 credit; upgrade to "advanced" only if results miss the error
  max_results=5
)
# WebFetch the GitHub issue or SO answer URL (FREE)
```

**Prioritize:**
- Closed GitHub issues with solutions
- Highly-voted SO answers
- Blog post-mortems

### Tier 5: Architecture/Tech Selection
**Pattern:** "Should I use X or Y?", "Compare A vs B", "Best architecture for Z?"
**Strategy:** Deep research with multiple perspectives

**Example:** "Choose between Astro Content Collections vs MDX for documentation"

## Fetching Specific URLs / Pages

When you need to **load a specific URL** (not search), always try WebFetch first:

```
# Step 1: Try Claude's built-in WebFetch
WebFetch(url="https://example.com/docs/api", prompt="Extract ...")

# Step 2: Only fall back to tavily_extract if WebFetch fails or returns
#         empty/incomplete content (e.g. client-side rendered SPA)
ToolSearch("select:mcp__claude_ai_Tavily__tavily_extract")
tavily_extract(urls=["https://example.com/docs/api"])
```

**Decision rule:**
- WebFetch succeeded with real content → use it, skip Tavily
- WebFetch returned blank, JS placeholder, or login wall → use tavily_extract

This rule applies **only to direct URL access**. For search (finding pages), always use Tavily or Context7 as described below.

## MCP Tool Loading

Before using MCP tools, load them via ToolSearch:

```
# For Context7 (Library docs)
ToolSearch("select:mcp__context7__resolve-library-id")
ToolSearch("select:mcp__context7__query-docs")

# For Tavily (Web search)
ToolSearch("select:mcp__claude_ai_Tavily__tavily_search")
ToolSearch("select:mcp__claude_ai_Tavily__tavily_extract")
```

If MCP tools are not available, fall back to Claude's built-in WebSearch.

## Search Escalation Strategy

```
First attempt insufficient?
├─ Missing API details    → Context7 or official docs
├─ Missing examples       → Web search (GitHub, blogs, Stack Overflow)
├─ Conflicting info       → Multiple source comparison
├─ Need trade-offs        → Comparative analysis
└─ Still unclear          → Report uncertainty, ask user
```

## Output Format

Return findings in this structure:

```markdown
## Research Summary
[2-3 sentence summary with confidence level]

## Key Findings
- **Finding 1:** [Detail with source]
- **Finding 2:** [Detail with source]
- **Finding 3:** [Detail with source]

## Code Examples
[Working, tested code snippets - REQUIRED when applicable]
[Include imports, types, and error handling]

## Trade-offs & Considerations
[When applicable - pros/cons, gotchas, edge cases]

## Sources
- [Source 1](url) - [why trusted]
- [Source 2](url) - [cross-verification]

## Recommendation
[Specific, actionable next step for this codebase]

## Confidence
[High/Medium/Low] - [reasoning]
```

## Domain Strategy by Problem Type

| Problem Type | Preferred Sources |
|--------------|-------------------|
| API/Library Usage | Context7, official docs |
| Implementation Patterns | Blog posts, dev.to, css-tricks |
| Debugging Errors | GitHub issues, Stack Overflow |
| Performance | web.dev, developer.chrome.com |
| Security | owasp.org, auth0.com/blog |

## When to Use

- NestJS/TypeORM patterns
- Library API documentation
- Architecture decisions
- Comparing technical options
- Debugging obscure errors
- Implementation guidance

## Anti-Patterns (AVOID)

- Stopping after first search result
- Ignoring blogs for complex implementations
- Using Context7 for changelogs/issues (use web search)
- Not cross-verifying information
- Returning vague "it depends" without specifics
