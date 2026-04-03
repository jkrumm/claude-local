---
name: research
description: Deep technical research via claude -p subprocess — library docs, web search, architecture decisions
model: sonnet
---

# Research Skill

Launches a `claude -p` subprocess to research a query. All searching and fetching stays isolated — only the final summary returns to main context.

## IMPORTANT — Subprocess Only

Always run via `claude -p`. Never execute inline. Never use the Agent tool.
If invocation fails, report the error — do not fall back to inline execution.

## Execution

**Step 1** — Generate a unique temp path for this invocation: `/tmp/claude-research-<timestamp>`
(Use current epoch ms, e.g. `1711234567890`. This avoids conflicts if skill runs in parallel.)

**Step 2** — Write the prompt below to that path using the Write tool. Replace `[ARGUMENTS]` with the actual skill arguments.

```
You are a research assistant. Research the query below using WebSearch and WebFetch.
Cross-verify findings from 2+ sources before concluding.

Research pattern:
1. If library docs needed: try Context7 first — npx -y @vedanth/context7 docs <lib> <topic> --tokens 8000
2. WebSearch the query — pick 2-3 most relevant URLs
3. WebFetch each URL for details
4. Cross-verify and synthesize

Output format (under 2000 chars unless code examples require more):

## Research: [query]
**Summary:** [2-3 sentences, confidence level]
**Findings:**
- [finding] — [source URL]
**Recommendation:** [specific actionable next step]
**Confidence:** [High/Medium/Low] — [reason]
**Sources:** [URLs]

Anti-patterns:
- Do NOT stop after first result
- Do NOT return vague "it depends" without specifics
- Do NOT hallucinate import paths or method signatures — verify via docs or WebFetch

QUERY: [ARGUMENTS]
```

**Step 3** — Run the subprocess and clean up (subscription, no API key needed):

```bash
claude -p --model claude-sonnet-4-6 < /tmp/claude-research-<timestamp>
rm -f /tmp/claude-research-<timestamp>
```
