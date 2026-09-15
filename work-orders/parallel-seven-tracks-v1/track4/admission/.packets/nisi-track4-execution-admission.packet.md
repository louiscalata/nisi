---
packet: nisi-track4-execution-admission
project_root: /Users/louiscalata/nisi-next-private/work-orders/parallel-seven-tracks-v1/track4/admission
created_by: claude
created: 2026-09-14T06:30:00-07:00
write_owner: opencode
status: done
---

# Nisi — execution admission decision (the Track 4 acceptance the drain coordinator left out)

## Context

Isolated private work-order directory. Node 24, ESM, no dependencies.
`npm test` (2 baseline checks) passes. `npm run test:admission` (Claude's
oracle, 10 tests) fails 9 of 10 against the placeholder; those failures are
the work. This prose is the complete contract; read `tests/admission.test.mjs`
in full (it shows the exact input fixture and every expected outcome).

Target: `src/execution-admission-v1.mjs`, exporting exactly one synchronous
function `decideExecutionAdmission(input)`. The module has NO import
statements and uses no clock, timer or randomness (`now` in the input is the
only time source). Forbidden tokens anywhere in the file: `import`, `require`,
`process`, `fetch`, `setTimeout`, `setInterval`, `Date`, `performance`,
`globalThis`, `Math.random`. It is a pure decision over injected snapshots: it
never probes, starts, reloads or contacts anything, and its ADMIT grants
nothing (`executionGranted` is always `false`).

### Input (exactly these own enumerable keys, all plain objects; anything else → INVALID_INPUT)
```
{ now, consent, scheduler, capacity, host, request }
```
- `now`: safe integer >= 0 (not -0).
- `consent`: `{ grantedAtMs, expiresAtMs, revoked, scope }` — safe integers,
  `revoked` boolean, `scope` string. `grantedAtMs > now` → INVALID_INPUT.
  `consent` may be `undefined`/`null` (→ CONSENT_MISSING, not INVALID_INPUT).
- `scheduler`: `{ decision, observedAtMs, freshnessMs, queueState }` —
  `decision` one of the scheduler's own vocabulary `ALLOW | WINDOW_FULL |
  COURIER_RESERVED | COURIER_BUDGET_EXHAUSTED | INPUT_INVALID` (any other
  string → INVALID_INPUT); `queueState` `ACTIVE | OFF`; times safe integers,
  `freshnessMs >= 1`.
- `capacity`: `{ configuredSlots, measuredFreeSlots, measuredAtMs, freshnessMs }`
  — `configuredSlots` safe integer >= 0; `measuredFreeSlots` `null` (unmeasured)
  or a safe integer >= 0 that must not exceed `configuredSlots` (→ INVALID_INPUT).
- `host`: `{ state, pendingTransports, observedAtMs }` — `state` one of
  `IDLE | BUSY | QUARANTINED | OFF | TIMEOUT | CANCELLED`; `pendingTransports`
  safe integer >= 0; `observedAtMs` safe integer. Host freshness bound is a
  fixed 5000 ms (no field): `now - observedAtMs >= 5000` → HOST_STALE.
- `request`: `{ priority, ownerId }` — `priority` `FOREGROUND | BACKGROUND`;
  `ownerId` non-empty string. Priority NEVER changes any outcome (it is
  recorded, not consulted).
Read every field as an own enumerable data property; an accessor anywhere in
the input, an extra key at any level, or a missing key → INVALID_INPUT.
Never mutate the input.

### Result (frozen; keys in this order)
```
{ schemaVersion: 'nisi-execution-admission/v1', status, reason, checks, authorizing: false, executionGranted: false }
```
`status` ∈ `ADMIT | REFUSE | DRAIN_UNCONFIRMED`. `checks` is a frozen object
with keys in order `consent, scheduler, capacity, host`, each `'OK'`, a
reason word, the scheduler's own decision word (for SCHEDULER_REFUSED), the
host state word (for DRAIN_UNCONFIRMED / HOST_NOT_IDLE), or `'NOT_EVALUATED'`
for checks after the first failure.

### Decision, in this fixed order; the FIRST failure is the reason and later checks are NOT_EVALUATED
1. Input validation → `REFUSE / INVALID_INPUT` with all four checks
   `'NOT_EVALUATED'`.
2. consent: missing → `CONSENT_MISSING`; `expiresAtMs <= now` →
   `CONSENT_EXPIRED` (closed boundary: equal is expired); `revoked === true` →
   `CONSENT_REVOKED`; `scope !== 'execute'` → `CONSENT_SCOPE`. Order within
   consent: expired, then revoked, then scope. Any → `REFUSE`, checks.consent
   = that word.
3. scheduler: `now - observedAtMs >= freshnessMs` → `SCHEDULER_STALE`;
   `queueState !== 'ACTIVE'` → `QUEUE_NOT_ACTIVE`; `decision !== 'ALLOW'` →
   `SCHEDULER_REFUSED` with `checks.scheduler` = the scheduler's decision word.
   Order: stale, then queue, then decision.
4. capacity: `measuredFreeSlots === null` → `CAPACITY_UNMEASURED`;
   `now - measuredAtMs >= freshnessMs` → `CAPACITY_STALE`;
   `measuredFreeSlots === 0` → `CAPACITY_EXHAUSTED`. Order: unmeasured,
   stale, exhausted. `configuredSlots` alone never admits.
5. host: `now - observedAtMs >= 5000` → `HOST_STALE`; then if
   `pendingTransports > 0`: state `OFF | TIMEOUT | CANCELLED` →
   `status: 'DRAIN_UNCONFIRMED', reason: 'TRANSPORTS_PENDING', checks.host = state`;
   any other state → `REFUSE / TRANSPORTS_PENDING`; then `state !== 'IDLE'`
   → `HOST_NOT_IDLE` with `checks.host` = the state word.
6. All four OK → `ADMIT`, `reason: null`, checks all `'OK'`.

## Constraints

- Write ONLY `src/execution-admission-v1.mjs`. Everything else is read-only:
  `package.json`, `tests/`, `.packets/`. No parent-tree exploration.
- No dependencies, installs, network or model calls.
- Do not run commands, tests or nested packets yourself. The installed wrapper
  runs the inspected acceptance checks and writes the execution receipt.
- Do not alter tests, acceptance commands, order or receipt to obtain DONE.

## Items

### P1 — Implement decideExecutionAdmission
- **files**: src/execution-admission-v1.mjs
- **do**: Replace the placeholder with the synchronous named export implementing the input validation, the fixed-order decision and the exact result shape above.
- **accept**: npm run test:admission

## Packet acceptance
npm test

## Post-run note (Claude, integrator, 2026-09-13 23:10 PDT)

The go-tier run (kimi-k2.7-code, 5 min) implemented the contract: 10/10.
Reading the module found the key-set check used `Object.keys` (count), so a
symbol-keyed or non-enumerable extra passed — the same hole Claude's Track 5
review reported as D2. The contract said "an extra key at any level"; the
oracle did not test hidden keys. Fixed by the integrator (`Reflect.ownKeys` +
`enumerable` check) and three oracle cases added. Both suites green.
