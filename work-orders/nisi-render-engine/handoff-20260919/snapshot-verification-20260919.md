# Render-engine staged snapshot — verification evidence (2026-09-19)

Scope: deterministic verification of the staged render-engine snapshot on the
SharedChami mount, plus a read-only verification of the reference checkout,
filling the verification slot opened by `PACKET-MERGE-20260919.md` and the
receiving-side handoff evidence.

Naming (per owner direction, 2026-09-19): the component is the **Nisi Render
Engine**. Predecessor-era *physical artifact identifiers* (bundle filenames,
packet filenames, share paths, environment variables, workload IDs) retain
their on-disk names and appear below only as quoted literals — they are facts
about where evidence lives, not branding.

## 1. Staged snapshot on the share (2026-08-30)

`/Volumes/SharedChami/chamiDATA/forged-render-engine-windows-x64-20260830/`
(5 files, dated 2026-08-30): `forged-render-engine-current.bundle` (Git bundle,
1,203,690 bytes), `README.md`, `RUN-WINDOWS-X64.ps1`, `SHA256SUMS.txt`,
`SOURCE-MANIFEST.json`.

Note: the receiving-side evidence named this snapshot
`SharedChami/Nisi/v0.2/forged-render-engine/`. A 2026-09-19 mount inspection
found no `Nisi/` (capital) or `nisi/v0.2/` path on the Mac SMB mount; the
actual staged packet exists at the `chamiDATA/` path above.

### Provenance chain — all passed

1. `SHA256SUMS.txt` vs actual files — **4/4 OK** (`shasum -a 256`, 2026-09-19):
   `a471576f…` README.md, `17433779…` RUN-WINDOWS-X64.ps1,
   `4effc0f6…` SOURCE-MANIFEST.json, `601397d9…` bundle — all OK.
2. `SOURCE-MANIFEST.json`: schemaVersion 1, kind
   `forged-render-engine-windows-x64-development-source-snapshot-v1` (literal
   kind string), `createdAt 2026-08-30T13:51:59Z`,
   `snapshotCommit e9b1fb143feedd904cfb4e89d18ca470b7cab625`,
   `snapshotTree c5c5950931bba175a001313ba1ce62480a0adece`,
   scope `synthetic-current-mac-working-tree-development-only`,
   `canonicalReleaseSource: false`, `nativeQualification: false`.
3. `git clone` of the bundle → detached HEAD resolves to exactly
   `e9b1fb1…` ("Synthetic Windows x64 development handoff snapshot").
   Checked out to
   `/var/folders/mr/_s2_2c_n3dzcc1clncg5rwsh0000gn/T/opencode/forged-snapshot/checkout`.

### Executed checks (Node v24.18.0, macOS, 2026-09-19)

`src/companion-ui.js` (289 lines) and `test/companion-ui.test.js` (388 lines)
read in full before execution.

- `node --check` over the import closure — **PASS 8/8**
  (companion-ui.js, companion-ui.test.js, companion.js, coordinator-client.js,
  platform-compatibility.js, unix-socket.js, index.js, host-capacity-broker.js).
- `node --test test/companion-ui.test.js` — **PASS 8/8, exit 0, 2407 ms**
  (submit accept/reject, non-loopback refusal, production-surface scan,
  automatic-reserve broker, spawned-app lifecycle, bounded signal shutdown,
  standalone-Coordinator attach).
- `chami_gate_scan` — **NOT_RUN** for both JS files
  ("candidate must be a .py or .swift file"). The Chami gate covers Python/Swift
  only; recorded as such, never read as a pass. The JS lane's deterministic
  contract here is the two checks above.

## 2. Reference checkout (OneDrive sync, 2026-09-19) — read-only extraction

`~/OneDrive/Playground Mac/Forged Render Engine` — the OneDrive-synced tree of
the reference checkout (directory name retired; content is the Nisi Render
Engine reference). Git: single checkpoint commit `c5b0e60` on `main`, **448
uncommitted working-tree paths** (active work; Codex is the write owner — this
lane read and copied only, wrote nothing into it). 4,498 tracked files probed:
4,497 materialized; the one unreadable cloud placeholder
(`.cleanup-archive-2026-09-18/.opencode-task-claim/claim.json` — a coordination
record AGENTS.md excludes from products) was left in place.

Full working tree copied to
`/var/folders/mr/_s2_2c_n3dzcc1clncg5rwsh0000gn/T/opencode/nisi-render-canonical`
(4,497 files; 5/5 spot `cmp` identical, incl. both companion files).

`src/companion-ui.js` — sha256 `22e63739…` (316 lines),
`test/companion-ui.test.js` — sha256 `d117f075…` (428 lines).

Executed (both files read in full before running):

- `node --check` — **PASS 8/8** over the same import closure.
- `node --test test/companion-ui.test.js` — **7/8 PASS; 1 FAIL (harness drift)**:
  `companion injects one shared automatic-reserve broker…` fails its source-scan
  regex `/runLeasedWorker\(\{([\s\S]*?)\n  \}\);/u` because the working tree
  re-indented the call one level deeper (closing `});` at 4 spaces; the regex
  requires exactly 2). All contract fields the test demands remain present in
  the block (`renewalIntervalMs`, `signal: workerAbort.signal`,
  `onProcessTreeBound/Released`, no `hostCapacityBroker` in the worker call),
  and the suite's behavioral twin — the spawned-app lifecycle test, which
  actually starts the app, leases the worker, renders, and verifies capacity
  accounting and shutdown order — **passes**. Classification: harness drift in
  the test, not a product defect. The last all-green baseline remains the
  2026-08-30 snapshot (§1).
  The suite's other new assertions (packaged-renderer `bundled-strict-v1`,
  `/api/renderer-processes`) pass.

## 3. Discrepancy — the dual-progress revision is in no Mac-reachable copy

Receiving-side handoff evidence described the staged snapshot as containing a
**dual-progress** companion UI, file hashes `b0a1dbdd…` / `0c2b95d6…`. That
description matches nothing reachable from this Mac (all inspected 2026-09-19):

- the claimed `Nisi/v0.2/` path does not exist on the share mount; the actual
  staging is the §1 snapshot, whose UI is a **single** progress bar
  (`a9cbf1c4…` / `6c6b74e3…`) and which contains no `dual` construct;
- a full-share `find` (excluding node_modules/venv/.git) returns **zero**
  `*companion*` files anywhere on the mount;
- local `~/pending-review` and `~/code-runs` contain none;
- the reference checkout (§2) — including its 448 uncommitted paths — contains
  no dual-progress implementation; its UI is also single-bar.

Conclusion: the dual-progress revision can exist only in the **unsynced Windows
side of the OneDrive tree** (or in an unmaterialized state of it). It therefore
could not be inspected, executed, or merged from this lane. The two verified
states above — the 2026-08-30 snapshot (all-green) and the current reference
working tree (7/8 + harness drift) — bound what the Mac lane can attest.

## 4. What this evidence does and does not establish

Established:

- staged-snapshot integrity (all in-packet digests) and exact manifest
  commit/tree binding;
- all-Node contract tests pass on the 2026-08-30 revision (Node 24.18.0/macOS);
- current reference working tree: import-closure syntax valid, 7/8 companion
  contract tests pass, the one failure is test-side harness drift with the
  behavior intact (spawned-app lifecycle green);
- the dual-progress revision is absent from every Mac-reachable copy.

NOT established (remain false / not-run / pending):

- the dual-progress change itself — pending the Windows side (§5);
- Windows x64 native execution (the packet's own lane: MSVC, PE32+, `CREATE_NEW`,
  ten Windows contract tests — pending on the retained Windows worker);
- any Chami/Certified status (no run.json exists for these artifacts; JS lane is
  gate NOT_RUN);
- render qualification, DACL containment, Authenticode, release readiness.

## 5. Dispositions

1. Keep the §1 packet at `chamiDATA/`; its README's run procedure (copy to NTFS,
   digest compare, VS x64 tools session) remains the Windows lane's path.
2. Reference checkout: no writes from this lane. The 448 uncommitted paths and
   the harness-drift regex are for the write owner (Codex) — the note in
   `from-claude-mac/` flags them.
3. Dual-progress lane: a handoff note was placed at
   `/Volumes/SharedChami/from-claude-mac/RENDER-ENGINE-V02-LANE-20260919.md`
   asking the Windows side to extract and stage the revision (SHA256SUMS
   packet, as the §1 one). Upon its appearance on the share, this lane runs the
   §1 check set against it.
