# cqueue — Developer Notes

## Architecture

React frontend (Vite) + Bun/Elysia backend, running natively on the host.
Served on `http://cqueue.local` (localias proxy → port 7705).

Bun loads `.env` automatically from the `cqueue/` directory — all env vars
(`PERSONAL_REPOS_PATH`, `WORK_REPOS_PATH`, `GITHUB_TOKEN`) live there.

## Development

```bash
make dev    # Vite on :7705 (HMR) + API on :7706 — both via http://cqueue.local
make build  # Build frontend to dist/
make start  # Prod: Elysia serves everything on :7705
```

**Dev:** Vite runs on :7705 and proxies `/api` to Elysia on :7706. Full HMR,
`cqueue.local` works as-is. Server hot-reloads via `bun --watch`.

**Prod:** Elysia serves `dist/` + API on :7705 directly.

## Production (always-on)

```bash
# One-time: build frontend + install LaunchAgent
make build
make install-agent

# Reload after code changes
make build && launchctl kickstart -k gui/$(id -u)/com.jkrumm.cqueue

# Logs
tail -f /tmp/cqueue.log
tail -f /tmp/cqueue.err
```

The LaunchAgent starts automatically on login and restarts on crash.

## Validating UI Changes

In dev: changes reflect immediately via Vite HMR at the dev server port.
In prod: `make build` + reload `http://cqueue.local` in browser.
Use the Chrome MCP extension for visual validation via screenshots.

## LaunchAgent (always-on, when ready)

```bash
make build && make install-agent   # install + start
make uninstall-agent               # remove
tail -f /tmp/cqueue.log            # logs
```
