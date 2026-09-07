# opbackup + the secrets auto-reseed

`opbackup` (`scripts/backup-1password.py`) exports every vault, age-encrypts it in
memory and rsyncs the ciphertext to homelab. The same hourly agent
(`com.jkrumm.opbackup`) also reseeds the headless mini's secrets cache, through
its own guard in `scripts/opbackup-seed-auto.sh`.

Commands and the one-line rules live in `CLAUDE.md` → *opbackup + secrets
auto-reseed*; this is the rationale behind them.

## Why it stays attended

The first `op` call raises a biometric approval, and every way around that parks
a credential able to export every vault. The goal is not an unattended backup —
it is a prompt at a sane moment, on a machine with a human in front of it.

## The backup guard

- **Hourly via `StartCalendarInterval`**, never `RunAtLoad`/`StartInterval` — only
  calendar intervals coalesce a fire missed while asleep into one wake-up run.
- **Every decision lives in `scripts/opbackup-auto.sh`**, cheapest-first, each
  exiting **0** (a skip is the normal case). Two separate stamps (success >5d,
  attempt >6h), because declining an approval must not mean being asked again in
  60 minutes forever. Screen lock is `ioreg -n Root -d1 -k
  CGSSessionScreenIsLocked` — the key is **absent** while unlocked — read into a
  variable, never piped to `grep -q` (`pipefail` turns SIGPIPE into a false fail).
- **Retention:** `prune_remote()` keeps the newest 8 plus the newest per calendar
  month, deleting an explicit regex-validated filename list, never a remote glob —
  an old dump stays decryptable after the passwords in it are rotated.
- **A skip line in `~/Library/Logs/opbackup.log` is a claim, not a diagnosis** —
  three Secrets gotchas above (whoami, per-binary approval, a locked app reading as
  "mini unreachable") each present as a clean deliberate skip.
- **One transient `op read` failure must not discard a whole ~150-ref run** — reads
  are `timeout -k`-bounded and retried 3× **on transient errors only**; retrying a
  genuinely missing ref just delays an error a human has to fix.

## The reseed trigger — why age is not enough

The reseed guard used to fire on one condition: the mini's cache file older than
`MAX_AGE_DAYS` (5). That is the wrong question, and it produced a daily chore.

An agent on the mini that needs a new secret adds the ref to
`dotfiles-private/headless.refs` and commits it. The mini's cache is still *fresh
by mtime* — nothing about it changed — so the age gate skipped, for up to five
days. Meanwhile the ref it needs does not resolve, so the agent does the only
thing left to it: enqueues an `ask-human` request asking for a manual
`make secrets-seed`. That is the loop that made the queue feel like a daily tax.

The second half of the same bug is worse because it is silent. This machine
seals from **its own** checkout of dotfiles-private. Nothing pulled it. So even
a reseal that ran — manually, or on the 5-day tick — sealed a refs list that did
not contain the new ref, reported success, and delivered a cache missing exactly
the secret that triggered it. Observed 2026-09-07: `secrets-seed` reported *161
secrets sealed* while `op://vps/argo/HYPERDX_API_KEY_PROD` was still
unresolvable on the mini, because the MacBook's checkout was one commit behind.

The fix treats **the refs list changing as the cache going stale**, which it is:

1. `git fetch` dotfiles-private (a failure degrades to the age gate alone — no
   network must never mean no reseed).
2. Take the newest **upstream** commit touching `headless.refs` or
   `headless.iu.refs` and compare its timestamp to the mini cache's mtime.
3. Newer than the seal ⇒ due, bypassing the age gate. Fast-forward first, then
   seal.

No new state file, so nothing can drift out of sync with reality — the two
timestamps being compared are both facts about the world.

**It fails open, loudly.** A dirty or diverged checkout cannot fast-forward; the
seed still runs (so the age-driven reseal keeps working) and the log says the new
refs will be missing. A silent skip there would be permanent and invisible —
this repo has been bitten by that shape more than once.

**What it means for an agent on the mini:** commit the ref and **push** it. It is
live within the hour, with one Touch ID prompt on the MacBook at a natural
moment. No `ask-human` round trip.

`make opbackup-seed-test` is the hermetic regression suite — stubbed ssh/op/
pgrep/ioreg and a local bare repo as `origin`, so it runs on either machine and
touches no network.
