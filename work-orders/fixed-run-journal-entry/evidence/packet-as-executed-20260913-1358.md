---
packet: nisi-fixed-run-journal-entry
project_root: /Users/louiscalata/nisi-next-private/work-orders/fixed-run-journal-entry
created_by: claude
created: 2026-09-13T14:02:00-07:00
write_owner: opencode
status: blocked
---

# Nisi — fixed-run journal entry (summary → run-journal entry)

## Context

Isolated private work-order workspace, NOT the Nisi runtime. Implement one pure
function. Do not read or edit any parent directory.

Node 24; ESM; no dependencies. `npm test` passes 3 baseline checks against the
placeholder (pins the frozen journal module and four summary fixtures by
sha256). `npm run test:entry` (8 tests) fails against the placeholder; those are
expected unfinished work, not permission to edit tests or fixtures. The tests
are the contract; read `tests/entry.test.mjs` in full before coding.

Target: `src/fixed-run-journal-entry.mjs`, exporting exactly one named function
`fixedRunJournalEntry(input)` and nothing else. The module has NO import
statements at all (the frozen `src/run-journal-v1.mjs` is used only by tests).
Do not use `require`, `process`, `fetch`, `XMLHttpRequest`, `eval`, `Function`,
`setTimeout`, `setInterval`, `globalThis`, `structuredClone`, `Date`,
`performance` or `Math.random` anywhere in the file, including comments.

### Input checks, in this exact order
Throw `TypeError` unless `input` is a non-null object that is neither an array
nor a function. Then return the FIRST applicable refusal
`{ status: 'REFUSED', reason, authorizing: false }` (keys in that order):
1. `INVALID_INPUT` — own enumerable keys are not exactly the set {summary,
   projectId, runId, attempt, candidateId, receiptId, createdAt, ttlMs} (any
   order; inherited keys do not count; extra or missing keys refuse).
2. `INVALID_SUMMARY` — `summary` fails the contract below.
3. `INVALID_PROJECT`, 4. `INVALID_RUN`, 5. `INVALID_CANDIDATE` — `projectId`,
   `runId`, `candidateId` not an ID string `/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/`.
6. `INVALID_RECEIPT` — `receiptId` neither an ID string nor exactly `null`.
7. `INVALID_ATTEMPT` — `attempt` not a safe integer >= 0, or `-0` (`Object.is`).
8. `INVALID_TIME` — `createdAt` not a safe integer >= 0 or is `-0`; `ttlMs` not a
   safe integer >= 1; or `createdAt + ttlMs` not a safe integer.
9. `ID_TOO_LONG` — the derived id `${runId}:${attempt}:fixed-run` is longer than
   128 characters.
10. `PAYLOAD_UNREPRESENTABLE` — see Payload representability.

### Summary contract (`INVALID_SUMMARY` when any check fails)
Non-null non-array object whose own enumerable keys are exactly, IN ORDER:
schemaVersion, identity, lifecycle, gate, reasons, adaptation, adjudication,
table, overall, isolationAccepted, generatedCodeExecuted, authorizing.
- `schemaVersion === 'nisi-fixed-run-summary/v1'`; the last three keys exactly `false`.
- `identity`: own keys exactly childPid, servicePid, waitObservedPid; each `null`
  or a safe integer > 0.
- `lifecycle`: own keys exactly, in order: spawnReturn, exitCode, signal,
  rawWaitStatus, stdoutEOF, stderrEOF, drainObserved, waitObserved, timeout,
  outputCapExceeded. spawnReturn/exitCode/rawWaitStatus `null` or a safe
  integer; the six flags `null`, `true` or `false`; `signal` `null`, a string or
  a number (any number passes here; representability is checked in step 10).
- `gate` in {RUN_COMPLETE, RUN_INCOMPLETE}; `overall` in {OBSERVED, NOT_ACCEPTED}.
- `reasons`: an array of codes from this fixed vocabulary, in strictly increasing
  vocabulary order, no duplicates: SPAWN_FAILED, WAIT_NOT_OBSERVED,
  IDENTITY_UNAVAILABLE, PID_MISMATCH, SIGNALED, NONZERO_EXIT, STDOUT_NOT_DRAINED,
  STDERR_NOT_DRAINED, DRAIN_NOT_OBSERVED, TIMEOUT, OUTPUT_CAP_EXCEEDED,
  CANARIES_NOT_MATCHED.
- Consistency: `gate === 'RUN_COMPLETE'` iff no code other than
  CANARIES_NOT_MATCHED is present; `overall === 'OBSERVED'` iff `reasons` is
  empty; IDENTITY_UNAVAILABLE is present iff `identity.childPid === null ||
  identity.servicePid === null`.
- When IDENTITY_UNAVAILABLE is present: `adaptation`, `adjudication` and `table`
  must all be `null`. Otherwise: `adaptation` is a non-null non-array object
  with own `version` (string), `counts` (non-null non-array object) and
  `report` (array); `adjudication` is a non-null non-array object with own
  `overall` in {ALL_MATCHED, NOT_ACCEPTED}, `counts` (non-null non-array
  object), `malformedLines` and `unexpectedOperations` (present, any value) and
  `isolationAccepted` exactly `false`; `table` is a string; and
  CANARIES_NOT_MATCHED is present iff `adjudication.overall !== 'ALL_MATCHED'`.
  Extra keys inside adaptation/adjudication (adaptedOutput, rows, ...) are
  allowed and ignored.
Do NOT recompute reasons from lifecycle values; the summary module owns that.

### Result
`{ status: 'ENTRY', entry, authorizing: false }` (keys in that order). `entry`
has own keys exactly, IN ORDER: id, projectId, runId, attempt, candidateId,
stage, receiptId, createdAt, ttlMs, state, heartbeatAt, retryOf, revokes,
payload — with `id` = `${runId}:${attempt}:fixed-run`, `stage: 'fixed-run'`,
`state` = `'SUCCEEDED'` when `summary.overall === 'OBSERVED'` else `'FAILED'`,
`heartbeatAt`, `retryOf`, `revokes` = `null`, and the input values passed through.

`payload` has own keys exactly, IN ORDER: schemaVersion
`'nisi-fixed-run-entry/v1'`, summarySchema `'nisi-fixed-run-summary/v1'`,
overall, gate, reasons (copy), identity (copy, same key order), lifecycle (copy,
same key order), adaptation (`null`, or `{ version, counts, report }` deep
copies, keys in that order), adjudication (`null`, or `{ overall, counts,
malformedLines, unexpectedOperations }` deep copies, keys in that order), table,
then isolationAccepted, generatedCodeExecuted, authorizing all `false`.

### Payload representability (`PAYLOAD_UNREPRESENTABLE`)
Every value copied into `payload` must be journal-representable: `null`, `true`,
`false`, a well-formed string (`String.prototype.isWellFormed`), a safe integer
that is not `-0`, an array, or a plain object (prototype `Object.prototype` or
`null`). Arrays and plain objects are copied recursively through own enumerable
string-keyed data properties. Refuse on any other value (`undefined`, bigint,
symbol, function, non-integer or unsafe number, Map or any other prototype), a
non-enumerable or accessor own property, a symbol-keyed own property, the keys
`__proto__`, `prototype` or `constructor`, or a cycle. Copies are fresh: never
return or embed any object reachable from `input`.

### Purity
Same input gives a deep-equal result. Never mutate `input` or anything under it
(everything may be frozen). No state between calls.

## Constraints

- Write ONLY `src/fixed-run-journal-entry.mjs`. Everything else is read-only:
  `package.json`, `roadmap.md`, `tests/`, `fixtures/`, `evidence/`, `.packets/`
  and the frozen `src/run-journal-v1.mjs`. No parent-tree exploration.
- The executor owns only this draft. Claude authored the contract; Astra (Codex)
  owns review and integration; packet completion is not product completion.
- No dependencies, installs, network or model calls, filesystem or process APIs,
  and no changes to the actual Nisi runtime.
- Keep all work private. No commits, pushes, packages, public README/demo or
  disclosures. Nothing in this packet grants publication permission.
- Do not run commands, tests or nested packets yourself. The installed wrapper
  runs the inspected acceptance checks and writes the execution receipt.
- Do not alter tests, fixtures, acceptance commands, order or receipt to obtain
  DONE. If required context is missing, leave a concrete blocker, not an
  invented result.

## Items

### P1 — Implement fixedRunJournalEntry
- **files**: src/fixed-run-journal-entry.mjs
- **do**: Replace the placeholder with the synchronous named export fixedRunJournalEntry(input) implementing the ordered input checks, the summary contract validation, the exact entry and payload shapes, the representability check with fresh deep copies, and the purity rules above.
- **accept**: npm run test:entry

## Packet acceptance
npm test
