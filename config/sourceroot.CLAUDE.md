# SourceRoot - Personal Projects Configuration

## Workspace Context

- **Location:** `/Users/johannes.krumm/SourceRoot/`
- **Version Control:** GitHub
- **No ticket numbers** (no JK-XX or EP-XX prefixes in this workspace)

---

## Infrastructure

### Servers

| Server | SSH | Repos | Secrets Vault |
|-|-|-|-|
| HomeLab | `ssh homelab` | `~/homelab`, `~/homelab-private` | `homelab` + `common` |
| VPS | `ssh vps` | `~/vps` | `vps` + `common` |

SSH config is in `~/.ssh/config` — key auth via Tailscale IPs. For sudo on servers:

```bash
# Homelab (requires password for sudo)
ROOT_PW=$(op read "op://Private/homelab-server/password") && ssh homelab "echo '$ROOT_PW' | sudo -S <cmd>"
# VPS (has NOPASSWD sudo — root pw rarely needed)
ROOT_PW=$(op read "op://Private/vps-server/password") && ssh vps "echo '$ROOT_PW' | sudo -S <cmd>"
```

### Repos

| Repo | Location | Purpose |
|-|-|-|
| `homelab` | `~/SourceRoot/homelab` | Main homelab stack — 25+ containers |
| `homelab-private` | `~/SourceRoot/homelab-private` | Additional private homelab services |
| `vps` | `~/SourceRoot/vps` | VPS stack — 3 compose files |

### Secrets (1Password)

All secrets managed via 1Password with `op run --env-file=.env.tpl -- <command>` pattern. Use `/secrets` skill for vault ops.

---

## Local Dev Proxy

All local services run on **static ports** with **`.test` domains** via Caddy + dnsmasq.
Config lives in `~/SourceRoot/claude-local/config/Caddyfile` (version-controlled).

### Port Registry

| Domain | Port | Project |
|-|-|-|
| `rollhook.test` | 7700 | rollhook API |
| `rollhook-marketing.test` | 7701 | rollhook marketing |
| `rollhook-dashboard.test` | 7702 | rollhook dashboard |
| `sideclaw.test` | 7705 | sideclaw |
| `hyperdx.test` | 7707 | HyperDX observability |
| `basalt.test` | 7710 | basalt-ui dev |
| `basalt-example.test` | 7711 | basalt-ui example |
| `basalt-ui-playground.test` | 7712 | basalt-ui playground frontend |
| `basalt-ui-playground-api.test` | 7713 | basalt-ui playground API |

### Conventions

**Every app must:**
1. Use a **static port** — never random, never default (3000/5173). Reserve it in the table above.
2. Kill the port before starting — so `dev`/`serve`/`start` works regardless of prior state:
   ```json
   "dev": "npx kill-port 7705 && vite --port 7705 --strictPort"
   ```
   Or for bun/other runtimes: prefix the start command with `kill -9 $(lsof -ti:PORT) 2>/dev/null; `.
3. Use `--strictPort` (Vite) or equivalent — fail loudly if port is taken rather than silently picking another.
4. Have a **`.test` domain** registered in `claude-local/config/Caddyfile`.

### Adding a New Service

1. Pick the next available port (increment from last in registry above).
2. Add to `~/SourceRoot/claude-local/config/Caddyfile`:
   ```caddyfile
   myapp.test {
       import local
       reverse_proxy localhost:PORT
   }
   ```
3. Run `caddy reload` — no sudo, instant, zero downtime.
4. Update the port registry table above.
5. Commit both changes together in `claude-local`.

Access via `https://myapp.test` — HTTP redirects to HTTPS automatically.

---

## BasaltUI Integration

**Repository:** https://github.com/jkrumm/basalt-ui
**Main CSS:** `packages/basalt-ui/src/index.css`

**Detection:** Check for `basalt-ui` in dependencies, `@import "basalt-ui/css"` in global styles.

**Config requirements** for apps using basalt-ui:
```js
// vite config
optimizeDeps: { exclude: ['basalt-ui'] }
```
```css
/* global CSS — source basalt-ui for Tailwind v4 custom utilities */
@source "../path/to/packages/basalt-ui/src";
```

**After changing components in packages/basalt-ui**: always run `bun run build` before testing.

### Component Placement Rule
- Blueprint-styled ShadCN components → `packages/basalt-ui/src/components/`
- Consumer apps re-export: `export { Button } from 'basalt-ui'`
- Commit basalt-ui first, app second (separate commits — NPM published)

---

## Skills Available

| Skill | Purpose | Context | Model |
|-|-|-|-|
| `/commit [options]` | Smart conventional commits | main | haiku |
| `/check` | Format, lint, typecheck, test | **subprocess** | haiku |
| `/review` | Multi-angle code review + CodeRabbit CLI | **subprocess** | sonnet |
| `/research <query>` | Deep technical research (WebSearch + WebFetch) | **subprocess** | sonnet |
| `/grill` | Question until clear direction, generate PRD | main | (inherits) |
| `/implement` | Guided implementation with research + explore + check | main | sonnet subagent |
| `/ship` | Full flow: check → review → commit → PR → CodeRabbit → merge → release | main | haiku |
| `/browse` | Chrome DevTools debugging via subagent | **fork** | haiku |
| `/analyze` | Deep static analysis (fallow — dead code, dupes, complexity) | **subprocess** | haiku |
| `/git-cleanup` | Squash and group noisy branch commits | main | haiku |
| `/pr [action]` | GitHub PR workflow (create, status, merge) | main | haiku |
| `/ralph [cmd]` | Autonomous multi-group implementation loop | main | sonnet |
| `/otel [env] [intent]` | Debug OTEL traces/logs/metrics in ClickHouse | **subprocess** | haiku |
| `/secrets` | 1Password vault ops, .env.tpl patterns | main | haiku |
| `/upgrade-deps` | Dependency upgrade assistant | main | (inherits) |
| `/excalidraw-diagram` | Create Excalidraw diagrams | main | haiku |
| `/read-drawing` | Interpret Excalidraw diagrams | **subprocess** | haiku |
| `/frontend-design` | Production-grade frontend interfaces | main | (inherits) |
| `/skill-creator` | Create, modify, and test skills | main | (inherits) |

---

## Git Workflow Pipeline

```
/commit          → Commit work (one logical concern at a time)
/git-cleanup     → Group noisy commits (if ≥3 on branch)
/ship            → Full flow: check → review → PR → CodeRabbit → merge → release
```

**Or use `/ship` directly** — it auto-detects state and runs the right steps.

**Direct-to-master repos:** homelab, homelab-private, vps, claude-local, sideclaw, basalt-ui-playground — `/ship` skips PR flow.

**`/pr create` automatically:** errors on default branch, proposes branch rename, runs `/commit` if uncommitted, offers `/git-cleanup` if ≥3 commits, runs `/check` pre-flight.

**`/pr status` automatically:** warns on uncommitted/unpushed work, shows CodeRabbit feedback, offers to implement fixes.

