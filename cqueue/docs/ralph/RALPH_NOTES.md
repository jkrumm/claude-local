# RALPH Notes — cqueue

Learning notes appended after each group. Read before starting the next group.

---

## Group 1: Project Skeleton & Tooling

### What was implemented

Full project scaffold: `package.json` with pinned deps, root + server + src tsconfigs, Vite config with `/api` proxy, multi-stage Dockerfile, docker-compose.yml, Makefile, `.gitignore`, `.env.example`, and minimal stubs for `server/index.ts` and `src/main.tsx`.

### Deviations from prompt

- Added `.out/` directories as implicit tsc composite output targets (required for `--noEmit` on project references without emitting). Typecheck runs clean because `tsc --noEmit` with composite projects skips emit but still validates types.
- `tsconfig.src.json` includes `vite.config.ts` so the root vite config is checked under the browser tsconfig (correct target).
- Dockerfile uses `bun.lockb*` glob to handle missing lockfile gracefully on first build; the lockfile is generated locally and committed.

### Gotchas & surprises

- `bun install` emits peer dependency warnings for BlueprintJS expecting older React versions. These are warnings only — React 19 works fine.
- `vite@8` and `@vitejs/plugin-react@6` are current but may be very fresh; the build succeeded cleanly.
- `@dnd-kit/sortable@10` pairs with `@dnd-kit/core@6` — version pairing must stay aligned in later groups.

### Security notes

No auth, no network exposure beyond localhost. The `.env` with paths is excluded from git via `.gitignore`. `.env.example` uses placeholder values only.

### Future improvements

- Add `.dockerignore` in Group 2+ to avoid copying `node_modules/`, `dist/`, `.env` into the Docker build context — currently the full `node_modules/` is transferred (slow).

---

## Group 2: Server Core — Parser, Repos, Git

### What was implemented

Queue parser (`parse-queue.ts`) with `parseQueue`/`serializeQueue`, repo scanner (`repo-scanner.ts`) that walks `/repos/SourceRoot` and `/repos/IuRoot`, git status runner (`git.ts`) via `Bun.spawnSync`, and the `/api/repos` + `/api/repo` routes. `server/index.ts` wired up with `staticPlugin` and exported `App` type for Eden Treaty.

### Deviations from prompt

- Used `existsSync` (Node compat shim in Bun) rather than `Bun.file().exists()` for synchronous directory scanning — cleaner and avoids async in scanRepos.
- `ensureFile` in repos route creates missing `cqueue.md`/`cnotes.md` lazily on first `/api/repo` request, matching `cq` CLI behavior without polluting the scanner.
- Exported `App` type from `server/index.ts` so the frontend can use Eden Treaty's type-safe client in a later group.

### Gotchas & surprises

- `Bun.spawnSync` returns a `Uint8Array` stdout — must decode with `new TextDecoder()`. The Bun docs show `result.stdout.toString()` but that calls Buffer.toString() which isn't available on raw Uint8Array in all contexts; explicit TextDecoder is safer.
- `git rev-list --left-right --count HEAD...@{upstream}` exits non-zero when no upstream is configured — handled by treating null result as ahead=0/behind=0.
- `@elysiajs/static` must come after route registrations; it acts as a catch-all for unmatched paths.

### Security notes

All file access is constrained to paths under `/repos/` (container mount). No path traversal guard yet — acceptable for localhost-only tool but worth revisiting if the service ever listens on a non-loopback interface.

### Future improvements

- Add `.dockerignore` (deferred from Group 1).
- Add path validation to reject paths outside `/repos/` for defense-in-depth.
- `/api/repo` currently returns `hasQueue`/`hasNotes` based on pre-ensureFile existence; after `ensureFile` both will always be `true` — minor inconsistency to clean up.

---
