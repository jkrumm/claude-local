# Claude Code - Personal Configuration

## Temporal Context

**Current date: March 2026** — The AI model's training cutoff may be mid-2025 or earlier. Assume:
- Library versions, APIs, and best practices may have evolved since the model's knowledge cutoff
- When recommending dependencies or patterns, prefer checking docs (Context7/Tavily) over relying on training knowledge
- Do not default to versions or syntax from 2024/2025 — treat all ecosystem knowledge as potentially stale

---

## Personal Context

- **Name:** Johannes Krumm
- **Role:** Solo Senior Full-Stack Developer and TechLead
- **Working Style:** Iterative, careful, quality-focused – prefer multiple small steps over one big change
- **Language:** User may write in German for chat discussions, but ALL written artifacts (code, commits, docs, specs) MUST be in English. AI responses should default to English unless specifically discussing/clarifying requirements.

---

## Workspaces

### Personal Projects: `/Users/johannes.krumm/SourceRoot/`
- GitHub for version control and PRs
- Has its own CLAUDE.md with conventions and workflow
- Skills: `/commit`, `/pr`, `/fix-sentry`, `/code-quality`, `/research`, `/review`, `/upgrade-deps`, `/homelab-api`

### HomeLab API: `claude-remote-api.jkrumm.com`
Personal backend for all private tooling. A Bun/Elysia proxy on the home server that absorbs OAuth2 complexity and exposes a single Bearer-token API. Secret in Doppler:
```bash
doppler secrets get HOMELAB_API_SECRET --plain -p homelab -c prod
```
Current integrations: TickTick task management. Use `/homelab-api` skill for full endpoint reference, auth patterns, and date handling. Source: `/Users/johannes.krumm/SourceRoot/homelab/homelab-api/`

### Work Projects: `/Users/johannes.krumm/IuRoot/`
- Project-specific CLAUDE.md files (e.g., `epos.student-enrolment/CLAUDE.md`)
- Each project has its own conventions (DDD, NestJS, Vue patterns)
- No root-level configuration (colleagues have own setups)

---

## AI Interaction Preferences

### Communication Style
- Senior-to-senior communication: concise, precise, technical
- Critical feedback over validation: question assumptions, suggest better approaches
- No superlatives or over-explanation: avoid "great", "excellent", "amazing"
- No repetition: don't restate what was already understood
- Challenge immature or over-engineered solutions

### Scope Discipline
- **ONLY implement what I explicitly ask for**
- Don't implement the entire plan at once
- Research/plan fully, THEN build piece by piece
- Wait for me to ask for each specific piece
- Don't add features, refactorings, or improvements I didn't request
- If unclear about scope, ask instead of assuming more work

### When Uncertain
When uncertain: state the question, list 2 options with tradeoffs, give tendency, ask.

---

## Security in Documentation

**Never expose** real IPs, passwords, usernames, tokens, API keys, hostnames, Tailscale IPs, internal service URLs, or any sensitive configuration values in:
- README files or any documentation
- Code comments
- Any file tracked by git

Use placeholders instead: `<your-domain>`, `<tailscale-ip>`, `<see-doppler>`, `example.com`.
All actual values go in Doppler (or equivalent secret manager). This applies to **all projects**.

---

## Universal Coding Standards

### TypeScript
- Strict mode enabled (`strict: true`)
- No `any` unless explicitly justified with comment
- Prefer type inference where clear, explicit types for public APIs
- Use `satisfies` for type validation without widening
- Typed objects as function arguments (not multiple parameters)

### Code Quality
- Readability and simplicity are paramount
- Low nesting: early returns, guard clauses
- Simple, battle-tested solutions over clever abstractions
- No premature optimization or over-engineering
- Self-documenting code over comments

### Error Handling
- Throw and propagate errors (don't catch everywhere)
- Global error monitoring (Sentry for tracking)
- Let errors bubble up to global handlers

### Commit Messages
- Conventional commits format
- Concise but descriptive
- Focus on "why" over "what"
- Use `/commit` skill for intelligent commit generation
- **NO AI attribution** (no Co-Authored-By footer)

---

## Global Skills

### `/commit [ticket] [options]`
Smart git commit with conventional commits and intelligent splitting.

**Options:** `--amend` (CodeRabbit/SonarQube fixes), `--split` (force split), `--no-split`, `--dry-run`

**Rules:**
- **basalt-ui**: ALWAYS separate commit (NPM published package)
- Full-stack features: keep together (don't split by frontend/backend)
- **NO AI attribution** (no Co-Authored-By footer)
- IuRoot: use `ticket` arg for EP-XX; SourceRoot: no tickets
- **NEVER create single-line/trivial fix commits** — always `git reset --soft HEAD~1 && git commit --amend` to fold follow-up fixes into the commit that introduced the issue. CI failures, lint fixes, export order, missing deps, config tweaks caused by your own changes all belong in the original commit.

---

## Task Queue (`cq`)

Automates unattended multi-task Claude Code sessions. The Stop hook in `~/.claude/hooks/notify.ts` pops the next task from the per-repo `cqueue.md` and injects it as the next user message (exit code 2), keeping the session alive without babysitting.

**Queue file:** `<git-root>/cqueue.md` — human-editable, tasks separated by `---`

| Command | Effect |
|-|-|
| `cq add "text"` | Append a task (single-line) |
| `cq add` | Append a multi-line task via stdin (Ctrl+D) |
| `cq edit` | Open cqueue.md in $EDITOR |
| `cq list` | Show all tasks with index and preview |
| `cq status` | Pending count |
| `cq pause` | Append PAUSE sentinel (stops queue, sends notification) |
| `cq clear` | Empty the queue |

**Block types:** `/command` blocks (⚡) invoke skills; plain text (◆) is injected as a user message; `PAUSE` (⏸) stops the queue.

---

## Shell Commands (zsh)

Git worktree management via **wtp** (`brew install satococoa/tap/wtp`):

| Command | Purpose |
|---------|---------|
| `wtp add <branch>` | Create worktree with hooks (auto-install deps) |
| `wtp cd <name>` | Navigate to worktree |
| `wtp list` | List all worktrees |
| `wtp remove <name>` | Remove worktree |
| `wtp remove <name> --with-branch` | Remove worktree + branch |
| `gback` | Alias for `git reset --soft HEAD~1` |

**Config:** Per-repo `.wtp.yml` with `base_dir` and `post_create` hooks.

---

## MCP Integration

### Active MCPs

| MCP | Purpose | Tools | Context Cost |
|-----|---------|-------|--------------|
| **Sentry** | Error tracking, issue monitoring | ~10 tools | ~2,000 tokens |
| **Tavily** | Web research, content extraction | 5 tools | ~1,000 tokens |
| **Context7** | Official library documentation | 2 tools | ~500 tokens |

### ToolSearch & Deferred Loading

Use `ToolSearch("select:mcp__server__tool")` to load tools on-demand; tool results are only added to context when executed.

### Tavily Credit Costs — ALWAYS be token-aware

| Tool | Cost | Default? |
|-|-|-|
| `tavily_search` basic | **1 credit** | Yes — always start here |
| `tavily_search` advanced | **2 credits** | Only if basic results are off-target |
| `tavily_extract` basic | **1 credit / 5 URLs** | Only if WebFetch fails |
| `WebFetch` | **0 credits** | Always try before tavily_extract |
| `tavily_research` mini | **4–110 credits** | Rarely — need synthesized multi-source research |
| `tavily_research` pro | **15–250 credits** | Almost never — only for truly complex open-ended research |

**Default pattern (costs 1 credit total):**
`tavily_search` basic → get URLs → `WebFetch` the best URL (free)

**NEVER** call `tavily_research` when search + WebFetch would suffice. The minimum spend is 4 credits (mini) or 15 credits (pro) per call.

### Research Decision Tree
```
Quick fact / URL known?     → WebFetch (0 credits)
Need to find pages?         → tavily_search basic (1 credit) + WebFetch results
Need official docs?         → Context7 MCP → fallback: tavily_search basic
Basic not finding it?       → tavily_search advanced (2 credits)
Multi-source synthesis?     → tavily_research mini (4+ credits) — justify first
Deep open-ended research?   → /research skill (handles escalation internally)
Sentry debugging?           → /fix-sentry skill (uses Sentry MCP)
```

**Fallback:** Claude WebSearch is always available if MCPs are unavailable.

---

## Context Efficiency

### Subagent Discipline

**Context-aware delegation:**
- Under ~50k context: prefer inline work for tasks under ~5 tool calls.
- Over ~50k context: prefer subagents for self-contained tasks, even simple ones — the per-call token tax on large contexts adds up fast.

When using subagents, include output rules: "Final response under 2000 characters. List outcomes, not process."
Never call TaskOutput twice for the same subagent. If it times out, increase the timeout — don't re-read.

### File Reading

Read files with purpose. Before reading a file, know what you're looking for.
Use Grep to locate relevant sections before reading entire large files.
Never re-read a file you've already read in this session.
For files over 500 lines, use offset/limit to read only the relevant section.

### Responses

Don't echo back file contents you just read — the user can see them.
Don't narrate tool calls ("Let me read the file..." / "Now I'll edit..."). Just do it.
Keep explanations proportional to complexity. Simple changes need one sentence, not three paragraphs.

**Tables — STRICT RULES (apply everywhere, always):**
- Markdown tables: use minimum separator (`|-|-|`). Never pad with repeated hyphens (`|---|---|`).
- NEVER use box-drawing / ASCII-art tables with characters like `┌`, `┬`, `─`, `│`, `└`, `┘`, `├`, `┤`, `┼`. These are completely banned.
- No exceptions. Not for "clarity", not for alignment, not for terminal output.

---

## Forked Skills Strategy (Token Efficiency)

Skills with `context: fork` run in isolated contexts. They process search/MCP responses internally and return only summarized findings. This saves **80%+ tokens** for research/validation tasks.

### Mandatory Skill Routing

**ALWAYS use forked skills:**
| Operation | Skill | Token Savings |
|-----------|-------|---------------|
| Web search / MCP research | `/research` | ~80% |
| Library docs lookup | `/research` | ~80% |
| Codebase exploration (>3 files) | Built-in Explore agent | ~75% |
| Validation (format/lint/tsc/test) | `/code-quality` | ~70% |
| Code review | `/review` | ~70% |

**NEVER do inline in main thread:**
- Web search or MCP calls for research
- Reading >3 files for understanding
- Running validate/test/lint commands

---

## Development Workflow

### Standard Workflow
1. Understand request thoroughly
2. Propose plan if non-trivial (wait for approval)
3. Implement changes
4. Check `package.json` for available scripts
5. Run `/code-quality` for validation
6. Run `/commit` for intelligent commit generation

### Validation Process
- Check `package.json` for validation commands before assuming
- Prefer `pre` commands that combine format + lint + tsc
- Use `/code-quality` skill for validation (token efficient)
- Fix errors in changed files only (don't refactor untouched code)
- I validate running apps manually (don't run `dev` servers for me)

---

## When Something Seems Wrong

Flag these explicitly rather than working around them silently:
- Tool returns unexpected output → stop and report, don't retry in a loop
- File missing where expected → check git status, don't speculatively create it
- Validation fails on untouched files → report only, don't refactor to fix
- Skill times out → increase timeout; don't re-invoke and double-read output
- Code/patterns contradict CLAUDE.md → flag it, may indicate outdated instructions

---

## CLAUDE.md Maintenance

### Hierarchical Structure
- **Global** (`~/.claude/CLAUDE.md`): This file – personal preferences, MCP strategy
- **Workspace** (`/SourceRoot/CLAUDE.md`): Personal project conventions and workflow
- **Project** (`/project/CLAUDE.md`): Project-specific patterns

### When to Update
- Architecture changes (new patterns, structural decisions)
- Tooling changes (new build tools, linters, formatters)
- Important gotchas discovered

### Update Rules
- Include CLAUDE.md updates in same commit as related code changes
- If CLAUDE.md-only changes, use `docs:` prefix

---

## Session Start Checklist

1. [ ] Read this global CLAUDE.md
2. [ ] Read workspace CLAUDE.md
3. [ ] Read project-specific CLAUDE.md (if exists)
4. [ ] Check README.md for project context
5. [ ] Detect runtime, package manager, and project structure
6. [ ] Check package.json for available scripts and dependencies
