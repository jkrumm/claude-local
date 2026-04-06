---
name: update-agent-rules
description: Update frontend agent rules (React best practices, TanStack Query/Router/Start) from upstream GitHub repos. Use this skill when the user wants to update, sync, check versions, add new rule sets, or troubleshoot the frontend rules setup. Also trigger when the user mentions "agent skills", "agent rules", "react rules", "tanstack rules", or asks about the rules architecture.
model: haiku
---

# Update Agent Rules

Manages the frontend best-practice rules sourced from community agent-skills repos. These rules give Claude context-aware guidance when writing React/TanStack code.

## Architecture

Two layers — lightweight index files auto-load during development, full reference files available on demand for deep reviews.

### Layer 1: Index Rules (auto-load via `paths:`)

Location: `~/SourceRoot/claude-local/rules/`

| File | Source Repo | Rules |
|-|-|-|
| `react-best-practices.md` | `vercel-labs/agent-skills` | 69 rules — async, bundle, server, client, re-render, rendering, JS perf, advanced |
| `tanstack-query.md` | `DeckardGer/tanstack-agent-skills` | 21 rules — query keys, caching, mutations, error handling, prefetching, SSR |
| `tanstack-router.md` | `DeckardGer/tanstack-agent-skills` | 15 rules — type safety, route org, data loading, search params, navigation |
| `tanstack-start.md` | `DeckardGer/tanstack-agent-skills` | 13+4 rules — server functions, security, middleware, auth + integration patterns |

Each file has `paths: ["**/*.tsx", "**/*.jsx"]` frontmatter — loads automatically when touching React files, zero cost on backend work. Total ~5K tokens.

### Layer 2: Full Reference (manual reads)

Location: `~/SourceRoot/claude-local/reference/`

```
reference/
  react-best-practices/   # 69 .md files with code examples (bad → good)
  tanstack-query/          # 21 .md files
  tanstack-router/         # 15 .md files
  tanstack-start/          # 13 .md files
  tanstack-integration/    #  4 .md files
```

These are the original rule files from the upstream repos — unmodified. Each contains explanation, incorrect example, correct example, and context. Total ~81K tokens. The `/review` skill reads these when reviewing `.tsx` code.

### Version Tracking

Each index rule file has a `source:` field in its YAML frontmatter:

```yaml
source: vercel-labs/agent-skills@73140fc (2026-04-02)
source: DeckardGer/tanstack-agent-skills@0e8bcdc (2026-04-03)
```

Format: `{org}/{repo}@{short-sha} ({date})`. Compare against upstream to check for updates.

## Update Process

### 1. Check for upstream changes

```bash
# Clone fresh copies
cd /tmp
git clone --depth 1 https://github.com/vercel-labs/agent-skills.git
git clone --depth 1 https://github.com/DeckardGer/tanstack-agent-skills.git

# Compare commit hashes against source: fields in rules/
git -C /tmp/agent-skills log -1 --format="%h %ci"
git -C /tmp/tanstack-agent-skills log -1 --format="%h %ci"
```

If the hashes match what's in the `source:` frontmatter, no update needed.

### 2. Update reference files (full rules)

Copy the original rule files — no modifications:

```bash
CLAUDE_LOCAL=~/SourceRoot/claude-local

# React best practices
rm -rf "$CLAUDE_LOCAL/reference/react-best-practices"
mkdir -p "$CLAUDE_LOCAL/reference/react-best-practices"
cp /tmp/agent-skills/skills/react-best-practices/rules/*.md "$CLAUDE_LOCAL/reference/react-best-practices/"
rm -f "$CLAUDE_LOCAL/reference/react-best-practices/_template.md" "$CLAUDE_LOCAL/reference/react-best-practices/_sections.md"

# TanStack (all 4 packages)
for skill in tanstack-query tanstack-router tanstack-start tanstack-integration; do
  rm -rf "$CLAUDE_LOCAL/reference/$skill"
  mkdir -p "$CLAUDE_LOCAL/reference/$skill"
  cp "/tmp/tanstack-agent-skills/skills/$skill/rules/"*.md "$CLAUDE_LOCAL/reference/$skill/"
done
```

### 3. Update index rules

Read the upstream SKILL.md files — they contain the quick-reference lists:

```
/tmp/agent-skills/skills/react-best-practices/SKILL.md
/tmp/tanstack-agent-skills/skills/tanstack-query/SKILL.md
/tmp/tanstack-agent-skills/skills/tanstack-router/SKILL.md
/tmp/tanstack-agent-skills/skills/tanstack-start/SKILL.md
/tmp/tanstack-agent-skills/skills/tanstack-integration/SKILL.md
```

For each, diff against the existing index rule in `rules/`. Look for:
- New rules added (new lines in Quick Reference sections)
- Rules removed or renamed
- Priority changes
- Category restructuring

Update the index files in `rules/` to reflect changes. Preserve the Claude Code frontmatter:

```yaml
---
description: <keep existing or update if scope changed>
paths: ["**/*.tsx", "**/*.jsx"]
source: {org}/{repo}@{new-short-sha} ({new-date})
---
```

The tanstack-start index file also includes tanstack-integration rules at the bottom — update both sections.

### 4. Verify and clean up

```bash
# Verify file counts match upstream
for d in react-best-practices tanstack-query tanstack-router tanstack-start tanstack-integration; do
  echo "$d: $(ls ~/SourceRoot/claude-local/reference/$d/*.md | wc -l | tr -d ' ') files"
done

# Verify rules are visible via symlink
ls ~/.claude/rules/react-best-practices.md ~/.claude/rules/tanstack-query.md ~/.claude/rules/tanstack-router.md ~/.claude/rules/tanstack-start.md

# Clean up
rm -rf /tmp/agent-skills /tmp/tanstack-agent-skills
```

### 5. Commit

Commit in claude-local with: `docs: update frontend agent rules from upstream`

## Adding a New Rule Set

To add rules from a new agent-skills repo:

1. Clone the repo, inspect its `skills/` directory structure
2. Copy original rule files to `reference/{name}/`
3. Create an index rule file in `rules/{name}.md` from the repo's SKILL.md — add `paths:` and `source:` frontmatter
4. Verify symlink visibility via `~/.claude/rules/`
5. Commit in claude-local

## Troubleshooting

**Rules not loading on .tsx files:** Check `~/.claude/rules/` symlink points to `~/SourceRoot/claude-local/rules/`. Run `make setup` if broken.

**Too much context:** The index files total ~5K tokens. If this grows with new rule sets, consider whether all need `**/*.tsx` or if some could use more specific paths (e.g., files importing specific packages).

**Review skill not finding reference files:** Ensure paths in the review skill match `~/SourceRoot/claude-local/reference/`. The reference directory is NOT in `~/.claude/rules/` — it lives only in the claude-local repo.
