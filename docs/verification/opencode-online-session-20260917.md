# OpenCode online session — handoff, 2026-09-17

Self-contained pickup document for **Codex** and **Claude**. Written by the
OpenCode online-mode orchestrator at the end of a session that ran from roughly
11:20 to 23:00 local (America/Los_Angeles) on 2026-09-17. Everything below is
either a measured fact with the command that produced it, or an explicit open
decision. Nothing here is certified.

## 0. Read order for a picking-up agent

1. This document.
2. `docs/verification/known-red-baseline-2026-09-17.md` — the measured red
   baseline, pre- and post-remediation.
3. `work-orders/parallel-seven-tracks-v1/track1/README.md`, section
   "Session status (OpenCode online, 2026-09-17)" appended at the end.
4. The four packet specs in
   `work-orders/parallel-seven-tracks-v1/track1/.packets/`.
5. Outside this repo, in the pipeline workspace, the queue definitions, run
   logs and the Render Engine hold note live under
   `~/pipeline-runs/` (`queue-12h-20260917-v3.json`,
   `queue-20260917-115803/run.{log,jsonl}`,
   `HELD-render-engine-20260917.md`). This document is the canonical handoff;
   no duplicate copy is kept there.

## 1. Mode and route in force

- Online code mode, **Mac-local**. Windows/SharedChami is **pending**: a
  mount attempt failed (below). Windows parity was never accepted.
- Pipeline identity is V4.1 `foundation-preview` under the schema-v3 contract;
  Chami is **v1** (never v2).
- The packet agents in this route run with **no shell** — they cannot `mkdir`,
  `git`, mount, or run `mkdir`-based claim protocols.
- One write owner. In this session OpenCode was the writer; no other writer
  edited concurrently.
- Nothing in this session produced a `CERTIFIED` result. `CERTIFIED` may only
  come from `chami_certify_read` on a real supported `run.json` with tests,
  an explicit pure gate PASS, every requested reviewer's well-formed PASS,
  complete quorum and retained hashes. No such manifest exists here. Treat all
  work below as **evidence-backed but UNCERTIFIED**.

## 2. Verified completions

### 2.1 `nisi-fix-type-prerequisite` — DONE, independently re-verified

- Packet: `nisi/.packets/nisi-fix-type-prerequisite.packet.md`
- Receipt: `nisi/.packets/nisi-fix-type-prerequisite.result.md`
  (`outcome: done`, P1 DONE exit 0, P2 DONE exit 0, packet acceptance exit 0,
  tier `free`, 335.3 s, served by `free/opencode/big-pickle` as a *requested
  route*, not served-model proof).
- Files it produced: `nisi/package.json` (modified),
  `nisi/tests/type-prerequisite.test.mjs` (new),
  `nisi/docs/verification/known-red-baseline-2026-09-17.md` (new).
- What it does: `npm run preflight` now runs
  `node scripts/require-node.cjs && node tests/type-prerequisite.test.mjs --check-types-prerequisite`
  and fails closed with
  `MISSING_TYPES_NODE @types/node@24.13.3 is not installed; run: npm install`
  when the declared pin is absent, and `PRESENT @types/node@24.13.3` when it is
  present. New scripts: `test:type-prerequisite`.
- Independent re-verification by the orchestrator: 4/4 new tests pass;
  `test:types` is byte-identical to its pre-packet value (the red suite was not
  edited into passing); `preflight` now exits 0 with `PRESENT`.
- Note for pickup: **`preflight` is intentionally fail-closed.** On a machine
  without the installed pin it is red by design. That is the point of the card.

### 2.2 Authorized environment repair

- Louis authorized `npm install`, run as
  `npm install --no-audit --no-fund --ignore-scripts` in `~/nisi`:
  2 packages added in 104 ms from the local cache. `git status` shows
  `package-lock.json` **unmodified** — the lock already pinned the packages; the
  install only materialized `node_modules`.
- Effect: the eight `TS2688` failures cleared. Re-measured afterward:
  `npm test` → 1782 total / 1780 pass / 2 fail; `npm run test:types` → exit 0.
- Arithmetic reconciles: 1768 pass + 8 cleared + 4 new packet-1 tests = 1780;
  10 failures − 8 cleared = 2.

### 2.3 A verified correction to an earlier claim

The baseline document originally attributed the two remaining failures to
`tests/veritas-import.test.mjs` and `tests/nisi-native-overlay.test.mjs`. That
was **wrong**. Isolated per-file runs:

- `tests/veritas-import.test.mjs` → 13 tests, 13 pass, 0 fail (fully green).
- `tests/nisi-native-overlay.test.mjs` → 8 tests, 6 pass, 2 fail.

**Both** remaining failures are therefore in `nisi-native-overlay.test.mjs`
alone, at `:122`, `:130`, `:138`, `:156`; the last is a `deepStrictEqual` with
`actual: []` against
`expected: ['native/macos/CodenameVeritasFramework/.build']`.

## 3. Current measured baselines (re-measured at handoff time)

| target | command | result |
|---|---|---|
| `nisi` root | `npm test` | 1782 total, **1780 pass, 2 fail** |
| `nisi` root | `npm run test:types` | exit 0, no `TS2688` |
| `nisi` root | `npm run preflight` | `PRESENT @types/node@24.13.3`, exit 0 |
| `track1` | `npm test` | **10 total, 10 pass, 0 fail** |
| Render Engine | `npm test` | 878 total, 857 pass, **17 fail, all `ERR_ASSERTION`** |

Environment: node `v24.18.0`, npm `11.16.0`, registry `https://registry.npmjs.org/`,
no proxy. LM Studio is listening on `127.0.0.1:1234` and serves
`qwen/qwen3.8-27b`, `google/gemma-3-4b` and an embedding model.

## 4. The pipeline failure that cost the 12-hour window

**Outcome: the 12-hour queue delivered nothing after 11:36.** Six in-window
attempts each died in 5–7 seconds with the same provider error and wrote no
receipt:

```
Error from provider (Console): OpenCode's free tier can only be used from within OpenCode
refusing receipt: edit phase unsuccessful or terminality unconfirmed
```

Timestamps and exits, from `~/pipeline-runs/queue-20260917-115803/run.jsonl`:
13:58:10 exit 1 (7.2 s), 15:13:11 exit 1 (7.6 s), 16:28:08 exit 1 (5.3 s),
17:43:09 exit 1 (5.4 s), 18:58:10 exit 1 (6.5 s), 20:58:08 exit 1 (5.1 s). Each
is followed by `{"event": "stopped"}`. The queue then ended
`reason: exhausted`.

### 4.1 Root cause, with evidence

1. The tier ladder **is** implemented: `~/bin/packet-queue-run:160`,
   `for tier in TIERS` with `TIERS = ("free", "go", "local")` (line 23), and it
   advances only when a tier returns exit code **3** (unreachable).
2. `chami-tier resolve free` → `opencode/big-pickle`, exit 0. So
   `packet_run.py:13`'s preflight (which runs *before* the status flip) passes,
   the packet flips to `status: executing`, and only then does the provider
   refuse. That refusal surfaces as exit **1** (blocked/failed), which the
   ladder reads as *blocked*, not *unreachable* — so `go` and `local` were
   **never attempted in nine hours**.
3. The "tiers" are **OpenCode agents, not shell binaries**: `packet_run.py:44`
   maps `{"local": "packet", "free": "packet-free", "go": "packet-go"}` and none
   of those three names exists in `~/bin`. That is consistent with the provider
   message: the free tier requires the request to originate inside OpenCode.
4. `chami-tier resolve go` refuses without `--allow-paid`:
   `opencode-go/kimi-k2.7-code` is **METERED**. `go` was never run and no paid
   usage was spent.
5. `chami-tier resolve local` → `lmstudio/qwen/qwen3.8-27b`, and LM Studio is
   up on `127.0.0.1:1234` serving that model — so a zero-cost headless route
   probably exists and was simply never reached.
6. `codemode_pipeline_status` reports `overall: false`,
   `install_contract_ok: false`, `components.design: false`,
   `windows.status: pending-pc`, `windows.v5_parity.accepted: false`,
   `chami: "v1"`.

### 4.2 Candidate fixes, none applied

- Classify a provider-entitlement/refusal error as *tier unreachable* (exit 3)
  in `packet_run.py`, so the ladder falls through to `local`. Not applied —
  this changes a fail-closed classification and needs the user's decision.
- Or add a `--tiers` override to `packet-queue-run` (an orchestrator-created
  tool, not the user's pipeline) so `local` can be tried first.
- Or use the `go` tier with `--allow-paid` — **spends paid usage; requires
  explicit approval.**

## 5. Packet inventory and stuck state

### 5.1 Packets that are lint-clean and were never run

| packet | status in file | lint |
|---|---|---|
| `track1/.packets/nisi-track1-fix-bundle-receipt.packet.md` | `executing` | OK |
| `track1/.packets/nisi-track1-fix-cleanup-outcome.packet.md` | `executing` | OK |
| `track1/.packets/nisi-track1-fix-containment-guard.packet.md` | `executing` | OK |
| `track1/.packets/nisi-track1-fix-imports-and-input.packet.md` | `executing` | OK |
| `nisi/.packets/nisi-overlay-drift-diagnosis.packet.md` | `executing` | OK |
| `nisi-next-private/work-orders/nisi-render-tile-loop-v1/.packets/nisi-render-tile-loop-hardening-review.packet.md` | `executing` | OK |

They read `executing` because `packet_run.py` flips the status before the
provider refuses, and no receipt step ran to flip them back. **A picking-up
agent must clear this deliberately** — flip `status: executing` to
`status: ready` in each packet file, or pass the run tool's force flag. Do not
assume these packets ran: there are no `.result.md` receipts for any of them and
no source edits were made.

### 5.2 Packet-lint contracts discovered the hard way

- An accept command must start with an **allowlisted executor command**:
  `python3 -m pytest|unittest|compileall|py_compile`, `node --check`,
  `tsc --noEmit`, `ruff check`, `biome check`, `shellcheck`, `shfmt -d`,
  `swift test`, `npm test`, `npm run test:<name>`, `git status`, `git diff`.
  `node --test <file>` and bare `node <script>.mjs` are **rejected** — that is
  why these packets add `test:*` scripts to `package.json` instead.
- A packet's **packet-acceptance must already be green** in `project_root`
  before handover ("baseline not green" is a lint failure). Item accepts are
  expected to fail pre-packet. In `nisi` root this meant acceptance could not be
  `npm test` (red: the 2 overlay failures) nor `npm run preflight` (not
  allowlisted), so it is `npm run test:types`.

### 5.3 The queue driver, as built

- `~/bin/packet-queue-run` (written this session, python3). Constants:
  `TIERS = ("free", "go", "local")`, `EDIT_TIMEOUT = "900"`, so no single packet
  can exceed 15 minutes — the 12-hour window is a paced queue, not one long run.
- `--keep-going` continues after a blocked packet instead of halting the
  window. It was in force for the final run.
- **Known sharp edge:** `load_queue` is called **once** at line 106; the driver
  does **not** re-read the queue file between entries. Editing a queue file
  under a running driver has no effect — restart the driver instead. This
  surprised the orchestrator once and is worth fixing.
- Queues and logs: `~/pipeline-runs/queue-12h-20260917.json` (original),
  `-v2.json` (keeps Render Engine, adds GATE-TRUTH-02),
  `-v3.json` (Render Engine entries moved to `held_for_clearance`; the one that
  actually ran). Run logs: `~/pipeline-runs/queue-20260917-113058/`,
  `-114707/`, `-115803/` (`run.log` + `run.jsonl`). Nohup log:
  `~/pipeline-runs/queue-nohup.log`.

## 6. Render Engine: HELD, and a deviation to disclose

Full detail: `~/pipeline-runs/HELD-render-engine-20260917.md`.

- **The three Render Engine packets must not run.** That repo has an
  **unreleased** `.opencode-task-claim` (`claim.json` mtime
  `2026-09-14T14:46:56`, dir mtime `2026-09-14T21:57:21`, appearing in no
  claim-history entry) and its `AGENTS.md` states: *"If `.opencode-task-claim`
  already exists, do not edit anything. Never break or replace a stale claim
  without explicit user clearance."*
- Reading `claim.json` **failed with `Errno 60` (Operation timed out)** — an
  OneDrive on-demand placeholder. The claimed owner cannot be inspected
  reliably from the Mac.
- The ledger has **no READY task**: `OPENCODE-TASK-STATE.json`
  (`updatedAtUtc 2026-09-05T21:04:18Z`) ends at order 26 `MAC-RESYNC-GATES-01`
  = `DONE-SCOPED`, handoff `.packets/macos-resync-test-commands.result.md`. The
  only approved additive OpenCode card there is order 26, and it is finished —
  so the three held packets, which invent new cards, are outside the sanctioned
  flow even if the claim were cleared.
- That repo is cloud-backed and partly dataless; expect stalls on first read of
  unmaterialized files.
- **Deviation to disclose:** the three packet files were written into that tree
  at 11:29, 11:31 and 11:44 on 2026-09-17, *before* the claim was discovered.
  They are new, untracked, never staged, and touch no product source, test,
  card or ledger object; the `docs/opencode-tasks/` and `scripts/` files they
  describe were **never created**. They were left in place because deleting them
  is itself a write requiring clearance. Hashes:
  `forged-fix-failure-triage` `b64ca0c5afb04557a8e8786d4f9cf214f3166dc8943d0674b7c3193150ec3454`,
  `forged-gate-truth-01` `1f1274e0c35ff136186c4428a33c358f17d66a80f6fbeff3fce1c900e712e32c`,
  `forged-gate-truth-02` `83f43be28d3bba0068b3af34e51c5505f392e3e530ede7c53e96a0e35c56edc7`.
- Verified unrelated: the failing test *"retained v2 packets stay immutable and
  additive current packet matches every source byte"*
  (`test/windows-build-baseline-handoff-v2.test.js:215`) concerns the
  `windows-build-baseline-handoff-v2` artifact directories, not `.packets/`.
  Suite totals were 878/857/17 both before those packet files existed and after.
- The nisi repos (`nisi`, `nisi-next-private`, `track1`) have **no** claim
  directory and **no** `AGENTS.md`/`OPENCODE-PICKUP.md`, so writes there were not
  in violation of any such protocol.

## 7. Remaining work, in priority order

1. **track1 second-pass findings 1 and 4** (`track1/README.md` lines ~166-192,
   findings 1 and 4). This is where work stopped: the runner, the product
   reader and the oracle had been read; **no code was written** and no
   `findings-*.test.mjs` file exists yet. The two packet specs
   (`nisi-track1-fix-bundle-receipt.packet.md`, P1/P2) contain the exact
   assertions. Key API facts for whoever picks this up:
   - Product reader: `../../../receipts/repository-run-v1.mjs` →
     `readRepositoryRunBundleV1(input, context)`, where `input` must have
     exactly the 16 `bundleKeys` and `context` exactly
     `['report','plans','groups','executions','preparation','suite','nodeRegistrationFingerprint']`;
     it throws `REPOSITORY_RUN_SCHEMA` / `REPOSITORY_RUN_MISMATCH` otherwise and
     returns `{ status: 'CONSISTENT', finalChecksRecordedPass, testCount,
     recordedTestPasses, fingerprint, ... }`.
   - The runner's inert owners are **not exported**; the oracle builds its own
     fixture via `createReviewedLiveFixtureV1()` and a self-contained
     `guardSideEffects(run, allowWritesUnder)`.
   - Finding 1's fix must not be satisfiable by a stub: a stub that fabricates
     the bundle must fail with the product reader's own schema error.
   - Finding 4 requires the runner to retain `preflight.json` first, write every
     retained file with `flag: 'wx'`, derive each record's sha256 from the bytes
     actually written, and add `reviewedSourceFingerprint`, `bundleFingerprint`
     and `reviewDefaults: {history:false, incident:false}` to the receipt. The
     oracle's `retained.map(r => r.path)` must then deep-equal exactly
     `['preflight.json','engine-report.json','host-result.json','runner-receipt.json']`.
   - `track1` must stay 10/10 green throughout; the protected oracle must not
     lose a discriminating assertion.
2. **track1 third item** (`nisi-track1-fix-cleanup-outcome`, findings 2, 5, 7, 8)
   and then findings 3 (`containment guard`), 6 and 9 (`imports and input`).
3. **The last red in nisi**: the frozen-import overlay drift in
   `tests/nisi-native-overlay.test.mjs`. `nisi/.packets/nisi-overlay-drift-diagnosis.packet.md`
   is a read-only diagnosis packet; the deciding evidence may only exist in Git
   history, in which case the honest verdict is `UNKNOWN` plus the named missing
   artifact. **Never write under `native/macos/CodenameVeritasFramework` or any
   `integrations/` path** — a prior incident makes those writes forbidden, and
   the packet-agent has no shell anyway.
4. **`nisi-next-private` render-tile-loop review** — unrun, unstarted.
5. **Render Engine** — blocked on claim clearance (section 6).
6. **SharedChami / Windows PC worker** — degraded. `/Volumes/SharedChami` is
   absent; an authorized `chami-ensure` run returned exit 1 with
   `status: mount_failed`, `share: smb://<retired-host-ip>/SharedChami`, hint "check the
   PC/LAN and configure saved credentials once in Finder if needed. Continue
   locally." No retry loop was started. A packet agent cannot fix this: it is a
   mount plus a Windows-side action.

## 8. Open decisions for Louis

1. Render Engine: clear the stale claim (or run the protocol's own
   `mkdir -p .opencode-task-claim-history && mv … && rmdir …` and add a card
   naming `Write owner: opencode`), or authorize the three held packets as an
   exception. Also: remove the three packet files, or keep them?
2. Which tier should unattended packet work use now — `local` (zero-cost,
   LM Studio up, never yet exercised) or metered `go` (needs explicit approval)?
3. Whether to fix the exit-code classification in `packet_run.py`
   (section 4.2) — it is the defect that made the ladder useless.
4. Whether the six stuck packets should be flipped back to `ready` (see 5.1).

## 9. Machine-readable state

```json
{
  "session": "opencode-online-2026-09-17",
  "mode": "online-code-mode/mac-local",
  "writer": "opencode",
  "certified": false,
  "gate_verdict_for_new_mjs": "NOT_RUN: candidate must be a .py or .swift file",
  "nisi": {"test": {"total": 1782, "pass": 1780, "fail": 2},
           "failing_file": "tests/nisi-native-overlay.test.mjs",
           "test_types_exit": 0, "preflight": "PRESENT @types/node@24.13.3"},
  "track1": {"test": {"total": 10, "pass": 10, "fail": 0}},
  "render_engine": {"test": {"total": 878, "pass": 857, "fail": 17},
                    "all_failures": "ERR_ASSERTION",
                    "state": "HELD: unreleased .opencode-task-claim + no READY task"},
  "windows_sharedchami": {"state": "degraded", "mount": "mount_failed",
                          "share": "smb://<retired-host-ip>/SharedChami"},
  "packets_never_run": 6,
  "packets_held": 3,
  "packets_done": 1,
  "unresolved": ["track1 findings 1,4 (in progress, no code written)",
                 "track1 findings 2,3,5,6,7,8,9",
                 "nisi overlay drift diagnosis",
                 "nisi-next-private render-tile-loop review",
                 "render engine (blocked on claim)",
                 "sharedchami mount + windows-side action"]
}
```
