# Handoff to OpenCode / Codex / Claude — 2026-09-17 online session

**Authorization (Louis, 2026-09-17):** "make sure all progress can be picked up
by codex and claude later." Earlier in the same session Louis authorized a
12-hour OpenCode work window across the nisi v0.2 and Forged Render Engine
projects, the one-line `npm install` remediation in `~/nisi`,
one `chami-ensure` mount attempt for SharedChami, and — when the window failed —
asked the OpenCode orchestrator to do the work itself as the writer.

**Full detail:** `docs/verification/opencode-online-session-20260917.md`
(18 KB, canonical). This file is the short index that matches the
`work-orders/opencode-handoff-YYYYMMDD/` convention; read that document for
evidence, exact counts, and the provider-failure post-mortem.

## The three co-authors and the one rule

> **INCIDENT 2026-09-14 10:22Z:** OpenCode wrote a new target into the FROZEN Veritas import
> (`integrations/veritas/…/CodenameVeritasFramework/`) and built it in place. Never write, format or
> build under `integrations/veritas/` — it is manifest-verified and any change fails the product
> suite. New Swift work goes through the Nisi overlay `native/macos/Nisi/` and only with a Claude
> contract.

> **INCIDENT 2026-09-17 (governance, Forged Render Engine):** that repository carries an
> **unreleased** `.opencode-task-claim` (2026-09-14) and **no READY task** in
> `OPENCODE-TASK-STATE.json` (order 26 `MAC-RESYNC-GATES-01` is `DONE-SCOPED`). Its `AGENTS.md`
> forbids edits while a claim exists, so **no agent may write there** until Louis clears it.
> Three authored packets are held unrun for that reason; see
> `~/pipeline-runs/HELD-render-engine-20260917.md`.

One writer per directory. The tasks below name their owned paths; write nowhere
else. The nisi repos have no claim directory and no `AGENTS.md`, so nisi work is
not subject to that protocol — but the Veritas freeze above still applies
everywhere.

## Measured state at handoff (re-measured, 2026-09-17 ~23:50)

| target | command | result |
|---|---|---|
| `nisi` root | `npm test` | 1782 total, **1780 pass, 2 fail** |
| `nisi` root | `npm run test:types` | exit 0 (all `TS2688` cleared) |
| `nisi` root | `npm run preflight` | `PRESENT @types/node@24.13.3`, exit 0 |
| `track1` | `npm test` | **10 total, 10 pass, 0 fail** |
| Forged Render Engine | `npm test` | 878 total, 857 pass, **17 fail, all `ERR_ASSERTION`** |

The only red in `nisi` is frozen-import overlay drift confined to
`tests/nisi-native-overlay.test.mjs` (6 pass / 2 fail at `:122`, `:130`, `:138`,
`:156`). `tests/veritas-import.test.mjs` is fully green (13/13) — an earlier
document misattributed one failure to it and has been corrected.

Nothing produced by this session is `CERTIFIED`: there is no supported
`run.json`, and the deterministic gate cannot scan `.mjs`/`.js` candidates
(`NOT_RUN: candidate must be a .py or .swift file`).

## What changed on disk

- `package.json` — modified by the completed `nisi-fix-type-prerequisite` packet
  and by the authorized `npm install` (lockfile itself unchanged).
- `tests/type-prerequisite.test.mjs`, `docs/verification/known-red-baseline-2026-09-17.md`,
  `docs/verification/opencode-online-session-20260917.md`,
  `work-orders/opencode-handoff-20260917/HANDOFF.md` — new.
- `work-orders/parallel-seven-tracks-v1/track1/README.md` — an appended
  "Session status (OpenCode online, 2026-09-17)" section and a design note.
- Four new packet specs under `track1/.packets/`, one under `nisi/.packets/`,
  one under `nisi-next-private/work-orders/nisi-render-tile-loop-v1/.packets/`.
- **No source file in any project was modified by the failed window.** `track1`
  is byte-identical to its 2026-09-15 00:45 state; the runner and the protected
  oracle were never edited.

## What did NOT happen (do not mistake for completed work)

Six packet runs were attempted between 13:58 and 20:58 and **all failed in
5-7 s** with `Error from provider (Console): OpenCode's free tier can only be
used from within OpenCode`. No receipt was written for any of them, and the
queue driver never advanced to the `local` or `go` tier because that failure
returns exit 1 (blocked) rather than exit 3 (unreachable). Nine hours of the
window were idle. Consequently:

- **Six packets carry `status: executing`** but never ran. Clear them to
  `ready` deliberately before re-running, or pass the run tool's force flag.
- **No `findings-*.test.mjs` exists**; implementation of track1 second-pass
  findings 1 and 4 had not started when the session ended.

## Tasks, in priority order, with owned paths

1. **`track1/` — second-pass findings 1 and 4.** Spec:
   `track1/.packets/nisi-track1-fix-bundle-receipt.packet.md`. **Read the design
   note appended to `track1/README.md` first**: the spec adds the new slices as
   separate files with their own `test:f1`/`test:f4` scripts, but `npm test`
   there runs only `repository-fixture-runner.test.mjs`, so a runner that
   fabricates the bundle would still pass the graded suite. Either move the
   re-read assertions into the oracle's own T1/T8 or widen the `test` script to
   include the new files. The protected oracle must keep its discriminating
   assertions and stay green.
2. **`track1/` — findings 2, 5, 7, 8** (`nisi-track1-fix-cleanup-outcome.packet.md`),
   then **finding 3** (`nisi-track1-fix-containment-guard.packet.md`), then
   **findings 6 and 9** (`nisi-track1-fix-imports-and-input.packet.md`).
3. **`nisi` — overlay drift diagnosis** (`nisi/.packets/nisi-overlay-drift-diagnosis.packet.md`),
   strictly read-only with respect to both test files and the Veritas import. If
   the deciding evidence exists only in Git history, the honest verdict is
   `UNKNOWN` plus the named missing artifact.
4. **`nisi-next-private/work-orders/nisi-render-tile-loop-v1/`** — the
   hardening-review packet, unrun and unstarted.
5. **Forged Render Engine** — blocked on claim clearance (see the incident box).
6. **SharedChami / Windows PC worker** — degraded. An authorized
   `chami-ensure` returned exit 1, `status: mount_failed`,
   `share: smb://<retired-host-ip>/SharedChami`; no retry loop was started. Repair is a
   mount plus a Windows-side action, outside a packet agent's authority (it has
   no shell).

## Open decisions for Louis

1. Render Engine: clear the stale claim (its own protocol:
   `mkdir -p .opencode-task-claim-history`, `mv`, `rmdir`, then a card naming
   `Write owner: opencode`), or authorize the three held packets as an
   exception. Also: remove those three packet files, or keep them?
2. Which tier for unattended packet work now — `local` (zero-cost, LM Studio is
   up on `127.0.0.1:1234` serving `qwen/qwen3.8-27b`, never yet exercised) or
   metered `go` (`opencode-go/kimi-k2.7-code`, needs explicit approval)?
3. Whether to fix the exit-code classification in `packet_run.py` so a
   provider refusal is treated as tier-unreachable: that defect is what made the
   tier ladder useless for nine hours.
4. Whether to flip the six stuck packets back to `ready`.
