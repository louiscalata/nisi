---
packet: nisi-interrupted-run-decision-v1
project_root: /Users/louiscalata/nisi-next-private/work-orders/interrupted-run-decision-v1
created_by: claude
created: 2026-09-14T02:58:00-0700
write_owner: opencode
status: blocked
---

# Implement decideInterruptedRunV1 so the written oracle passes

## Context
This work order is a pure decision contract for Nisi (NX-07 / DX-03: refuse stale
state, distinguish safe restart from validated resume; a stored report is not a
checkpoint API). Two files in this project root are ground truth and MUST be read
in full before editing anything:

- `README.md` — the contract: §Input (exact closed records, ID/HEX64/NAT/CODE
  rules, coherence rules), §Output (fixed key order), §Check order table (step →
  condition → decision → reason code, first failure wins, later cells stay
  `NOT_EVALUATED`), §Decisions, the 25 reason codes.
- `tests/interrupted-run-decision.test.mjs` — the oracle (18 tests, 0/18 on
  the placeholder). Its fixtures show the exact input shapes: `expected`,
  `journal` (`projectId, observedAtMs, recovery{status,recoveredIds,rejectedLine,reason,authorizing}, sha256, bytes, entries[]`),
  a `list(now)` row (`entry{14 keys}, historical, retained, revoked, expired, liveness, authorizing`),
  and the v1 checkpoint. Read the `row()`, `journal()`, `E()`, `ER()`, `CK()`
  builders and every `refused(...)`/`invalid(...)` expectation literally.

`src/interrupted-run-decision-v1.mjs` is a placeholder exporting
`decideInterruptedRunV1` that returns `undefined`. Replace its whole body.

Hard requirements the oracle checks mechanically:
- Exactly one export: `decideInterruptedRunV1`. ZERO `import` statements. The
  source must not contain the words `require`, `process`, `fetch`, `setTimeout`,
  `setInterval`, `Date`, `performance`, `globalThis` or `Math.random` anywhere
  (comments included). No clock: `now` comes only from the input.
- Never throws: every bad input (including `undefined`, `null`, primitives,
  accessor properties, symbol or non-enumerable keys, prototype other than
  `Object.prototype`/`null`) yields `REFUSE_STALE` / `INVALID_INPUT` with all
  seven cells `NOT_EVALUATED` and `interrupted: null`. Validate with
  `Reflect.ownKeys` + `Object.getOwnPropertyDescriptor` (own enumerable DATA
  properties, string keys only, exact key SET, order irrelevant). Never read a
  value through a getter; `entry.payload` is opaque: only its descriptor is
  inspected (must be an own enumerable data property), its value is never read.
- Output: `Object.freeze` with own keys in exactly this order:
  `schemaVersion`('nisi-interrupted-run-decision/v1'), `status`, `reason`,
  `checks` (frozen; keys in order `journal, project, entries, consent, checkpoint, identity, stages`),
  `interrupted` (null or frozen list of frozen items
  `{id, runId, attempt, stage, liveness:'UNKNOWN', heartbeatAt, createdAt}` in file order),
  `journalSha256`, `authorizing:false`, `executionGranted:false`, `resumeGranted:false`.
  Fresh object per call; the input is never mutated (it may be deep-frozen).
- `status` ∈ {SAFE_RESTART, REFUSE_STALE, RESUME_ELIGIBLE}; `reason` is null
  iff status !== REFUSE_STALE, otherwise the first failing check's code from the
  README's closed list.
- The `interrupted` list is computed at the entries step from rows with
  `entry.state === 'RUNNING' && liveness === 'UNKNOWN' && !revoked && !expired`,
  and is `null` if the decision stopped before that step.
- Row invariants (INVALID_INPUT on violation) are listed under README §Input
  "Coherence"; implement every one, including `entries.map(id) === recoveredIds`
  element-wise, `entry.projectId === journal.projectId`, `createdAt <= observedAtMs`,
  `heartbeatAt null | <= createdAt`, `revokes !== null ⇔ state === 'REVOKED'`
  and names an id in entries, `revoked === (some row.entry.revokes === id)`,
  `expired === (observedAtMs >= createdAt + ttlMs)`, `retained === false ⇒ payload === null`,
  liveness derivation rules, and the recovery/sha256/bytes coherence table.
- Checkpoint: read `schemaVersion` first (must be an own enumerable string; if
  it is not exactly `'nisi-interrupted-run-checkpoint/v1'` → `CHECKPOINT_SCHEMA`
  with no other key validated). A non-v1 checkpoint exempts no row at the
  entries step; a v1 checkpoint exempts only the row named by `entryId`.

`npm test` runs the oracle; `npm run test:baseline` runs the baseline (1 test,
green now, must stay green). Node 24; no dependencies.

## Constraints
- Edit only `src/interrupted-run-decision-v1.mjs`. Never edit `README.md`,
  `tests/`, `package.json` or anything else.
- No imports, no dependencies, no new files, no network, no git, no npm install.
- If the contract and the oracle contradict each other on a point, the oracle
  wins for that point; do not weaken or skip any test.

## Items

### P1 — implement the decision module
- **files**: src/interrupted-run-decision-v1.mjs
- **do**: replace the placeholder with a complete implementation of
  `decideInterruptedRunV1(input)` per README §Input, §Output and §Check order,
  satisfying every test in `tests/interrupted-run-decision.test.mjs`.
- **accept**: npm test

## Packet acceptance
npm run test:baseline
