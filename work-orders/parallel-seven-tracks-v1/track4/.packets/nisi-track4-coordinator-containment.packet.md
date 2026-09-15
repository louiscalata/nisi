---
packet: nisi-track4-coordinator-containment
project_root: /Users/louiscalata/nisi-next-private/work-orders/parallel-seven-tracks-v1/track4
created_by: claude
created: 2026-09-14T05:55:00-07:00
write_owner: opencode
status: blocked
---

# Nisi — execution coordinator v1: contain owner callbacks, cancel rejections and the owners container

## Context

Isolated private work-order copy of `hosts/repository/execution-coordinator-v1.mjs`
(Track 4 of the seven-track plan). Node 24, ESM, no dependencies. `src/contracts.mjs`
is a frozen copy of the product `cloneFreeze` helper; do not edit it.
`npm test` (the author's 12 tests) passes and MUST keep passing.
`npm run test:containment` (Claude's independent oracle, 10 tests) fails 8 of 10
against the draft; those 8 are the defects. Read `tests/execution-coordinator-containment.test.mjs`
in full: each test states the required behaviour in its title and assertions.

The module is a pure OFF/drain coordinator over already-registered owners
`{ id, status(), settled(), cancel() }`. It must never let an owner callback
reach coordinator bookkeeping, never let a cancel() failure escape or be
forgotten, and never trust a live owners container. Three defects, each with
its exact fix:

1. **Owner callbacks receive the mutable owner record as `this`.** `sample()`
   calls `o.status()` and `operate()` calls `o.cancel()` (and `settle()` passes
   `o.settled` to `.then`, which invokes it with `undefined` — that one is fine).
   A `function`-style `status()` can therefore write `this.settlement='SETTLED'`
   and flip a rejected settlement to OFF. Fix: keep the registered callbacks
   OUTSIDE the mutable record (e.g. a separate frozen `handles` array or fields
   on a private object the record does not expose) and invoke every callback
   detached: `Reflect.apply(fn, undefined, [])`. No callback may observe any
   object that carries `ownerStatus`, `settlement`, `cancelRequested` or `error`.
2. **`cancel()`'s return value is discarded.** A rejecting promise (or a
   thenable whose `then` rejects) escapes as an unhandled rejection; a sync
   throw is recorded as `CANCEL_ERROR` but `settle()` then sets `o.error=null`
   and the owner can still reach OFF. Fix: in `operate()`, for each owner not
   yet cancel-requested, call cancel detached inside
   `Promise.resolve().then(() => Reflect.apply(cancel, undefined, []))`, catch
   and record `o.error='CANCEL_ERROR'`, collect these promises, and
   `await Promise.all(...)` them BEFORE settling; bound that wait by the same
   `settleTimeoutMs` race used for settlement (a cancel that never resolves
   must not hang: treat timeout as still-pending, do not record an error for
   it, and let the settlement race produce UNCONFIRMED). Move the
   `o.error=null` reset out of `settle()` to the START of `operate()` (before
   the cancel loop) so a cancel error recorded in this operation survives to
   the existing `!o.error` gate. An owner with `error==='CANCEL_ERROR'` from a
   PREVIOUS operation must keep it on `recheck()` (recheck does not re-cancel
   and must not clear it): so the reset applies only when `cancel` is true.
3. **The owners container is read live three times** (`Array.isArray`,
   `.length` for the bound, `.map`), so a Proxy can lie about `length` and
   hide or add owners, and a sparse array reaches `sample()` as `undefined`
   and throws a raw TypeError. Fix: before the bound check, snapshot the
   container once into a fresh array with a single `length` read and a
   bounded `for` loop over own data descriptors (holes, accessors or symbol
   keys → `throw Error('SCHEMA')`); then apply the 1–16 bound and the
   per-owner validation to that local copy only. `Array.isArray` and the
   `Array.prototype` check stay.

Keep everything else byte-for-byte in behaviour: the result shape
`{ schemaVersion, status, reason, snapshot, authorizing:false }`, statuses
SNAPSHOT / OFF / UNCONFIRMED / REFUSED, reasons COORDINATOR_BUSY,
STATUS_UNCONFIRMED, SETTLEMENT_ERROR, SETTLEMENT_TIMEOUT, CANCEL_ERROR, the
`busy` gate, `revision`, and `capacityReusable === (state==='OFF')`.
Admission, consent and scheduler state are OUT of scope for this packet (a
separate contract).

## Constraints

- Write ONLY `src/execution-coordinator-v1.mjs`. Everything else is read-only:
  `src/contracts.mjs`, `package.json`, both test files, `.packets/`, `evidence/`.
  No parent-tree exploration.
- No dependencies, installs, network or model calls; no new imports beyond the
  existing `./contracts.mjs`.
- Do not run commands, tests or nested packets yourself. The installed wrapper
  runs the inspected acceptance checks and writes the execution receipt.
- Do not alter tests, acceptance commands, order or receipt to obtain DONE.

## Items

### P1 — Contain callbacks, cancel results and the owners container
- **files**: src/execution-coordinator-v1.mjs
- **do**: Apply the three fixes above exactly, preserving every existing status, reason, shape and the author's 12 tests.
- **accept**: npm run test:containment

## Packet acceptance
npm test

## Post-run note (Claude, integrator, 2026-09-13 22:50 PDT)

The go-tier run (kimi-k2.7-code, 11 min) implemented all three fixes as
written: containment 10/10. It was BLOCKED by the packet acceptance because two
of the author's tests then failed — and they were right: fix 2 as I specified
it ("move `o.error=null` out of `settle()`") also stopped `SETTLEMENT_TIMEOUT` /
`SETTLEMENT_ERROR` from clearing on `recheck()`, which the author's contract
requires ("may recover on recheck"). The packet under-specified the rule. The
correct rule, applied by the integrator in `settle()` (one clause): a fresh
successful settlement clears a settlement-derived error; `CANCEL_ERROR` is never
cleared by settlement. Result: author 12/12, containment 10/10. Module SHA256
`8dfb60343c161f2990a514256c3a2a98c35ef5a528b7a14fb9839eceec1cd580`. The go
receipt is retained as-is (blocked); this note is the correction record.
