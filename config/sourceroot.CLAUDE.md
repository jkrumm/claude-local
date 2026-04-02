# SourceRoot - Personal Projects Configuration

## Workspace Context

- **Location:** `/Users/johannes.krumm/SourceRoot/`
- **Version Control:** GitHub
- **No ticket numbers** (no JK-XX or EP-XX prefixes in this workspace)

---

---

## Infrastructure

### Servers

| Server | SSH | Repos | Secrets Vault |
|-|-|-|-|
| HomeLab | `ssh homelab` | `~/homelab`, `~/homelab-private` | `homelab` + `common` |
| VPS | `ssh vps` | `~/vps` | `vps` + `common` |

SSH config is in `~/.ssh/config` — key auth via Tailscale IPs. Root passwords stored in 1Password (`homelab/server/ROOT_PASSWORD`, `vps/server/ROOT_PASSWORD`). Use `echo '<pw>' | sudo -S <cmd>` for remote privileged operations.

### Repos

| Repo | Location | Purpose |
|-|-|-|
| `homelab` | `~/SourceRoot/homelab` | Main homelab stack — 25+ containers (Caddy, Immich, ntfy, Uptime Kuma, etc.) |
| `homelab-private` | `~/SourceRoot/homelab-private` | Additional private homelab services — shares homelab's `.env.tpl` |
| `vps` | `~/SourceRoot/vps` | VPS stack — 3 compose files (networking, infra, monitoring) |

### Secrets (1Password)

All secrets managed via 1Password with `op run --env-file=.env.tpl -- <command>` pattern. Each repo has a `.env.tpl` committed to git containing only `op://` references — never actual values.

Use `/secrets` skill for vault structure, operational patterns, adding/rotating secrets, and cron/watchdog setup.

---

## BasaltUI Integration

**Repository:** https://github.com/jkrumm/basalt-ui

**Main CSS:** `packages/basalt-ui/src/index.css`

**Detection:**
- Check for `basalt-ui` in dependencies
- Look for `@import "basalt-ui/css"` or relative path to `index.css` in global styles

### Component API

basalt-ui exports Blueprint-styled React components directly:

```tsx
import { Button, Badge, Switch, Checkbox, RadioGroup, RadioGroupItem, DropdownMenu } from 'basalt-ui'

// Blueprint intent system
<Button variant="primary">Save</Button>
<Button variant="success">Done</Button>
<Button variant="warning">Overwrite</Button>
<Button variant="danger">Delete</Button>

// Badge with intent + minimal variants
<Badge variant="primary">Active</Badge>
<Badge variant="warning-minimal">Pending</Badge>

// Compact form controls
<Switch />       // 14×24px
<Checkbox />     // 14×14px
```

**Two config requirements** for any app using basalt-ui components:

```js
// vite config — prevents pre-bundling so peer deps resolve from app context
optimizeDeps: { exclude: ['basalt-ui'] }
```

```css
/* global CSS — Tailwind v4 won't scan dist/index.js, so custom utilities
   (shadow-btn, bg-light-2, etc.) must be sourced from the component source */
@source "../path/to/packages/basalt-ui/src";
```

**After changing components in packages/basalt-ui**: always run `bun run build` before testing.

### Component Placement Rule

When customizing a ShadCN component for Blueprint style:
- Move it to `packages/basalt-ui/src/components/` (source of truth)
- In the marketing app, replace the component file with a 1-line re-export:
  ```ts
  export { Button, buttonVariants } from 'basalt-ui'
  ```
- Commit basalt-ui first, marketing app second (separate commits — NPM published)

### ShadCN CLI

Add raw ShadCN components (before Blueprint customization):

```bash
cd apps/marketing && bunx --bun shadcn@latest add <component>
```

Then move the component to basalt-ui package if it needs Blueprint-level styling.

---

## Skills Available

### Slash Commands

All available skills in this project:

| Skill | Purpose | Context | When to Use |
|-------|---------|---------|-------------|
| `/commit [options]` | Smart conventional commits | main | After completing implementation work |
| `/git-cleanup` | Squash and group noisy branch commits | main | Before PR creation, after multi-session work |
| `/pr [action]` | GitHub PR workflow | main | create, status, merge PRs |
| `/fix-sentry <project> <search>` | Debug Sentry errors | main | Investigate production errors |
| `/upgrade-deps` | Dependency upgrade assistant | main | Update project dependencies |
| `/code-quality` | Format, lint, typecheck, test | **fork** | After implementation, before commits |
| `/research <query>` | Deep technical research | **fork** | Library docs, architecture decisions |
| `/review` | Agnostic code review | **fork** | Check patterns before committing |
| `/ralph [setup\|run\|status\|reset N]` | Autonomous multi-group implementation loop | main | Large migrations, rewrites, multi-session tasks |
| `/react` | React performance best practices (Vercel) | **fork** | Writing/reviewing React components |
| `/web-design` | Web Interface Guidelines (Vercel) | **fork** | UI/UX review, accessibility audit |

| `/secrets` | 1Password secrets management — vault ops, .env.tpl patterns, rotation | **fork** | Adding/rotating secrets, debugging op run issues |
| `/excalidraw-diagram` | Create Excalidraw diagrams that argue visually | main | Visualizing workflows, architectures, concepts |
| `/read-drawing` | Read and interpret Excalidraw diagrams for context | main | When given a .excalidraw or .svg path to understand its content |
| `/pencil-design` | Pencil MCP design workflow with basalt-ui tokens | main | Creating/editing .pen design files |

**Note:** For codebase exploration, ask Claude directly and it will use the built-in Explore agent.

---

## No AI Attribution

**CRITICAL:** Do NOT add AI attribution anywhere in this project.

| Location | Rule |
|----------|------|
| **Code comments** | No "Generated by AI", "Claude wrote this", etc. |
| **Commit messages** | No `Co-Authored-By: Claude...` footer |
| **PR descriptions** | No "Created with Claude Code" footer |
| **Documentation** | No "AI-generated" disclaimers |

**Rationale:** AI assistance is tooling, not authorship. Keep all artifacts clean and professional.

---

## Git Workflow

### Commit Convention

Format: `{type}({scope}): {description}`

**Example:**
```
feat(auth): add refresh token rotation

Implement automatic token refresh when access token expires.
Tokens are rotated on each refresh for security.
```

No tickets in SourceRoot.

### Iteration Workflow

| Scenario | Action | Command |
|----------|--------|---------|
| Multiple logical changes | Force split analysis | `/commit --split` |
| CodeRabbit/SonarQube fixes | Amend (workflow, not feature) | `/commit --amend` |

### Special Handling

- **basalt-ui changes**: ALWAYS separate commit(s) (NPM published package)
- **Full-stack features**: Keep together (don't split by frontend/backend)
- **Direct main commits**: Valid for small fixes (no branch needed)
- **NEVER create single-line/trivial fix commits** — fold follow-up fixes from your own work (CI failures, lint, missing deps, config tweaks) into the commit that introduced the issue using `git reset --soft HEAD~1 && git commit --amend`. Single-fix commits are noise.

### Git Workflow Pipeline

Skills chain together in a defined order for clean PRs:

```
/commit          → Commit work as you go (one logical concern at a time)
/git-cleanup     → Group noisy commits into logical units (if ≥3 commits on branch)
/pr create       → Validates branch, runs quality checks, rebases, opens PR
/pr status       → Check CI + CodeRabbit; offers to implement fixes interactively
/commit --amend  → Fold in review fixes from CodeRabbit/SonarQube
/pr merge        → Rebase merge + worktree cleanup
```

**`/pr create` automatically:**
- Errors if you're on the default branch
- Proposes a branch rename if the name doesn't match the changes
- Runs `/commit` if there are uncommitted changes
- Offers `/git-cleanup` if there are ≥3 commits on the branch
- Runs `/code-quality` as pre-flight before creating the PR

**`/pr status` automatically:**
- Warns if uncommitted or unpushed work exists
- Shows all CodeRabbit feedback (blocking + suggestions) and offers to implement fixes
- Offers to regenerate the PR description if new commits were pushed

**When to skip `/git-cleanup`:**
- 1–2 well-named commits → go straight to `/pr create`
- `/pr create` will offer it automatically when it detects ≥3 commits

---

## Design Workflow (Pencil)

**Convention:** Design files live in `design/` per project (e.g., `apps/web/design/`, `packages/basalt-ui/design/`).

**Token source:** `SourceRoot/basalt-ui/packages/basalt-ui/src/index.css` — OKLCH variables, semantic tokens, typography, spacing.
Never copy token values into .pen files or docs. Read `index.css` directly when specifics are needed.

**Master design file:** `SourceRoot/basalt-ui/packages/basalt-ui/design/basalt-ui.pen`
This is the canonical visual reference for basalt-ui — color palette, type scale, spacing, ShadCN component examples.
Use it as the starting point for any app's .pen files.

**When to use Pencil MCP:**
- Creating or editing `.pen` design files
- Prototyping UI layouts before coding
- Visual review of component compositions

Use `/pencil-design` skill for Pencil MCP workflow, variable import patterns, and basalt-ui design philosophy.

---

## MCP Integration

MCPs active: Sentry, Tavily, Context7. See global CLAUDE.md for ToolSearch strategy.

