# cqueue — Developer Notes

## Architecture

React frontend (Vite) + Bun/Elysia backend, both running inside Docker.
Served on `http://cqueue.local` (via localias proxy → port 7705).

## Development Commands

| Command | Purpose |
|-|-|
| `make rebuild` | **Required after any frontend/backend change** — rebuilds Docker image and recreates container |
| `make up` | Start without forcing rebuild |
| `make down` | Stop containers |
| `make logs` | Tail logs |
| `make shell` | Shell into container |

**IMPORTANT:** The app is served from Docker (`docker compose`). Running `bun run build`
locally does NOT update the running app. Always use `make rebuild` to
propagate code changes to the running instance.

## Validating UI Changes

After `make rebuild`, reload `http://cqueue.local` in the browser to verify.
Use the Chrome MCP extension for visual validation via screenshots.
