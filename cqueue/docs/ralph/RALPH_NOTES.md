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
