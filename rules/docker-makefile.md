# Docker Commands: Use Makefile Targets

Never run raw `docker`, `docker-compose`, or `docker compose` commands directly. Use Makefile targets instead.

**Why:** Makefiles encode essential context — secret injection (via `op run`), deployment order, required flags, environment setup, health checks. Raw docker commands bypass all of this and produce broken or insecure results.

**What to do:**
1. Check if a `Makefile` exists in the project root
2. Run `make` or `make help` to list available targets
3. Use the appropriate `make` target (e.g., `make up`, `make deploy`, `make rebuild`, `make logs`)

**Common patterns across repos:**
- `make up` / `make start` — start services
- `make down` / `make stop` — stop services
- `make rebuild` — rebuild and restart
- `make deploy` — production deployment
- `make logs` — view logs

**If no Makefile exists:** raw docker commands are acceptable, but consider suggesting a Makefile to the user.

**If no make target covers the need:** explain what you need to do and ask the user — don't fall back to raw docker commands silently.
