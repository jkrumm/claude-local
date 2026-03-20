---
name: homelab-api
description: HomeLab API reference — base URL, auth via Doppler, all endpoints (TickTick, health), curl patterns, and date handling for claude-remote-api.jkrumm.com
agent: general-purpose
---

# HomeLab API Reference

Simple Bun/Elysia proxy at `claude-remote-api.jkrumm.com`. Absorbs TickTick OAuth2 complexity and exposes a clean Bearer-token API.

**Source:** `/Users/johannes.krumm/SourceRoot/homelab/homelab-api/`

---

## Auth

Bearer token stored in Doppler. Fetch it locally:

```bash
HOMELAB_API_SECRET=$(doppler secrets get HOMELAB_API_SECRET --plain -p homelab -c prod)
```

Every request requires:
```
Authorization: Bearer <token>
Content-Type: application/json
```

---

## Base URL

```
https://claude-remote-api.jkrumm.com
```

---

## All Endpoints

| Method | Path | Purpose |
|-|-|-|
| GET | `/health` | Public health check |
| GET | `/api/ping` | Authenticated ping |
| GET | `/api/ticktick/projects` | All TickTick projects |
| GET | `/api/ticktick/project/{projectId}/data` | Project + tasks + columns |
| POST | `/api/ticktick/task` | Create task |
| POST | `/api/ticktick/task/{taskId}` | Update task (partial) |
| POST | `/api/ticktick/project/{projectId}/task/{taskId}/complete` | Complete task |
| DELETE | `/api/ticktick/project/{projectId}/task/{taskId}` | Delete task |

All `/api/*` routes require Bearer auth. Responses are wrapped: `{ data: T }`.

---

## curl Examples

```bash
SECRET=$(doppler secrets get HOMELAB_API_SECRET --plain -p homelab -c prod)

# Health (no auth)
curl https://claude-remote-api.jkrumm.com/health

# Ping (auth check)
curl https://claude-remote-api.jkrumm.com/api/ping -H "Authorization: Bearer $SECRET"

# List projects
curl https://claude-remote-api.jkrumm.com/api/ticktick/projects -H "Authorization: Bearer $SECRET"

# Get tasks for a project
curl https://claude-remote-api.jkrumm.com/api/ticktick/project/{projectId}/data \
  -H "Authorization: Bearer $SECRET"

# Create task (send YYYY-MM-DD for dueDate — server normalizes)
curl -X POST https://claude-remote-api.jkrumm.com/api/ticktick/task \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"title":"Fix bug","projectId":"abc123","dueDate":"2026-03-11","priority":3,"timeZone":"Europe/Berlin"}'

# Update task
curl -X POST https://claude-remote-api.jkrumm.com/api/ticktick/task/{taskId} \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"title":"Updated title","priority":5}'

# Complete task
curl -X POST https://claude-remote-api.jkrumm.com/api/ticktick/project/{projectId}/task/{taskId}/complete \
  -H "Authorization: Bearer $SECRET"

# Delete task
curl -X DELETE https://claude-remote-api.jkrumm.com/api/ticktick/project/{projectId}/task/{taskId} \
  -H "Authorization: Bearer $SECRET"
```

---

## Date Handling (Critical)

Send `dueDate` as `YYYY-MM-DD`. The server handles everything else:

- Computes midnight in the task's `timeZone` (e.g. `"Europe/Berlin"`)
- Sets `startDate = dueDate` (TickTick requires both or date is silently ignored)
- Sets `isAllDay: true`
- Formats as `"2026-03-10T23:00:00.000+0000"` matching TickTick's storage format

**Never compute the ISO timestamp client-side** — result depends on the machine's local timezone and will be wrong when the user is outside Berlin.

---

## TickTick Task Model

```typescript
interface TickTickTask {
  id: string;
  projectId: string;
  title: string;
  content: string;           // markdown body
  isAllDay: boolean;
  startDate: string | null;  // "2026-03-10T23:00:00.000+0000"
  dueDate: string | null;    // "2026-03-10T23:00:00.000+0000"
  timeZone: string;          // e.g. "Europe/Berlin"
  priority: 0 | 1 | 3 | 5;  // None / Low / Medium / High
  status: 0 | 2;             // Active / Completed
  tags: string[];
  repeatFlag: string | null;
  sortOrder: number;
  kind: "TEXT" | "CHECKLIST" | "NOTE";
}
```

Reading dates back: use `toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" })` — never slice the ISO string, the UTC date differs from the Berlin date.

---

## Deploy After Changes

The image must be rebuilt (not just recreated) for code changes to take effect:

```bash
ssh homelab "cd ~/homelab && git pull && docker compose build homelab-api && doppler run -- docker compose up -d --force-recreate homelab-api"
```
