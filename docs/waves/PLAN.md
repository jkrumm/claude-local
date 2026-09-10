# Estate Round 2 — acting on the findings

**Goal:** every finding in the Round 2 audit is fixed, deferred with a reason, or
explicitly rejected — and the docs describe the estate that actually exists.

**Gate:** `/check` on the touched repo, plus `/review` on anything non-trivial.

**Findings (the what and why):** `~/SourceRoot/brain/Inbox/Estate Review Round 2 — Findings.md`
Read it first. It is the authority on *what* is wrong; this file only says *which
context does what*. Its finding 27 carries the ranked fix order.

**Cross-repo note:** this chain spans repos, so every wave prompt must reference
this plan by absolute path (`~/SourceRoot/dotfiles/docs/waves/PLAN.md`) and each
wave runs in its own repo's herdr space via `rd wave <repo> '<prompt>'`.

## External blocker — read before starting

The shared IU API key answers `403 rolling-30-day-cost-service-denial-limit`.
That is **upstream and being fixed by IU** — do not investigate it, do not work
around it, do not rewrite routing because of it. Probe with a single cheap call
before any wave that needs it; if still 403, skip that wave and move on.

Everything in Waves 2 and 3 is local and needs no IU key.

## Wave 1 — the dead cheap lane (repo: `sideclaw`)   <!-- status: pending, needs IU key -->
- [ ] Finding 1: every `check`/`overview` job has failed since 2026-09-09 12:09Z with
      `[claude-code:unrecognized_model] glm-5.3-flash`. This is **ours**, not the 403.
- [ ] Finding 22 and finding 1's tail: a route failure that is neither quota- nor
      timeout-shaped fires no fallback and alerts nobody. Make a dead route loud.
**Left behind:**

## Wave 2 — enforcement, not prose (repo: `dotfiles`)   <!-- status: active -->
- [ ] Findings 11 and 14: orchestration and model discipline exist only as prose.
      Two Bash-only hooks are the whole enforcement layer. Add a `SubagentStart`
      hook that rejects a worker on Opus/Fable unless explicitly justified —
      **verify the blocking semantics first, they are undocumented.**
- [ ] Finding 4's real content: the "cannot spawn Fable" claim was false. Either
      make it true or correct the wording in `output-styles/Direct.md`. Do not
      leave a rule that probes disprove.
- [ ] Finding 13's tail: `/wave`'s green gate is prose. Decide what can be
      mechanical (a `--gate` check before spawning) and what must stay judgment.
- [ ] `@verifier` is invoked by nothing. Wire it into `/implement` and `/ship`.
- [ ] Finding 9: `global.CLAUDE.md`'s "50 s regardless" sideclaw wait contract is
      stale; `otel` bypassing the job queue on Max is stale.
**Left behind:**

## Wave 3 — docs describe the estate that exists (repos: `dotfiles`, `brain`)   <!-- status: pending -->
- [ ] Findings 23 and 24: `global.CLAUDE.md`, the brain wiki (zero hits for
      `warden`) and both archify diagrams do not know Warden exists.
- [ ] Finding 8: `warden/DESIGN.md` says four LaunchAgents; there are five.
- [ ] Finding 9: a 41.9k `CLAUDE.md` (over the 40k rule), a 286 KB `STATE.md`,
      secrets prose duplicated across 19 files.
- [ ] The model exists nowhere as one piece. Write the single page a new agent
      reads to get the shape — machine, orchestrator, delegation roster, model
      discipline, `/wave`, Warden's loop, sideclaw's tiers. One home, everything
      else links to it.
**Left behind:**

## Wave 4 — Warden's actuator (repos: `warden`, `hermes-agent`)   <!-- status: blocked -->
Findings 2-6 and 16: dispatch/implement/merge/approvals still run through
`hermes-agent/scripts/hermes-cc.sh`; verdict delivery depends on the Hermes
gateway binary; "merge is deploy" has no code path, so `verified_unattended_fixes`
is structurally 0; Hermes's persona line 41 still claims it triages.

**Blocked on the IU key** and on the owner — this is the largest change in the
estate and its design is not settled. Do not start it in this chain. Report it as
the next decision needed.
