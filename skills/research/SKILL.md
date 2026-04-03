---
name: research
description: Deep technical research via claude -p subprocess — library docs, web search, architecture decisions
model: haiku
---

# Research Skill

Launches a `claude -p` subprocess to research a query. All searching and fetching stays isolated — only the final summary returns to main context.

## IMPORTANT — Subprocess Only

Always run via `claude -p`. Never execute inline. Never use the Agent tool.
If the API key lookup fails, report the error — do not fall back to inline execution.

## Execution

Build the prompt with the arguments substituted and run:

```bash
ANTHROPIC_API_KEY=$(security find-generic-password -s claude-sdk-api-key -w) \
ANTHROPIC_BASE_URL=$(security find-generic-password -s claude-sdk-base-url -w) \
  claude -p --model claude-haiku-4-5-20251001 "$(cat <<'EOF'
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
EOF
)"
```

Replace `[ARGUMENTS]` with the skill arguments before running.
