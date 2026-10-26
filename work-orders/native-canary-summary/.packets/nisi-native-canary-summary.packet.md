---
packet: nisi-native-canary-summary
project_root: /Users/louiscalata/nisi-next-private/work-orders/native-canary-summary
created_by: claude
created: 2026-09-13T13:40:00-07:00
write_owner: opencode
status: blocked
---

# Nisi — fixed-run summary (receipt + stdout → adjudicated canary table)

## Context

Isolated private work-order workspace, NOT the Nisi runtime. Implement one pure
composition function. Do not read or edit any parent directory.

Node 24 is installed; this ESM package has no dependencies. `npm test` passes
its three baseline checks against the placeholder (it pins two frozen modules
and two fixtures by sha256). `npm run test:summary` (10 tests) fails against the
placeholder; those failures are expected unfinished work, not permission to
edit tests or fixtures. The tests are the contract; read `tests/summary.test.mjs`
in full before coding.

The only implementation target is `src/native-canary-summary.mjs`. It may
import ONLY these two sibling modules (read-only fixtures, do not edit):
- `./native-canary-adapter.mjs` exports `fixedCanaryMappingV1()`,
  `adaptFixedCanaryOutput(rawStdout, mapping)` → `{ version, adaptedOutput, report, counts }`,
  `expectedMatrixFor({ childPid, servicePid })` (throws TypeError unless both are positive safe integers).
- `./native-canary-adjudicator.mjs` exports `adjudicateFixedCanaries(rawOutput, expected)`
  → `{ rows, malformedLines, unexpectedOperations, counts, overall: 'ALL_MATCHED'|'NOT_ACCEPTED', isolationAccepted: false }`
  and `formatCanaryTable(result)` → string.

### `summarizeFixedRun(receipt, stdout)` returns a fresh result object

Validate first: throw `TypeError` unless `receipt` is a non-null, non-array
object. `stdout` `null`/`undefined` mean `''`; any other non-string throws
`TypeError`. Read every receipt field with `Object.hasOwn` (inherited
properties are ignored; a missing field reads as `null`).

Typed reads (each yields the value or `null`):
- integers `childPid`, `servicePid`, `waitObservedPid`: value only if a POSITIVE safe integer;
- integers `spawnReturn`, `exitCode`, `rawWaitStatus`: value only if a safe integer (negative allowed);
- booleans `stdoutEOF`, `stderrEOF`, `drainObserved`, `waitObserved`, `timeout`, `outputCapExceeded`: value only if exactly `true` or `false`;
- `signal`: `null` if missing/`null`/`undefined`; the value if it is a number or a string; otherwise `null`.

Result shape, keys in exactly this order:
```js
{ schemaVersion: 'nisi-fixed-run-summary/v1',
  identity: { childPid, servicePid, waitObservedPid },
  lifecycle: { spawnReturn, exitCode, signal, rawWaitStatus, stdoutEOF, stderrEOF, drainObserved, waitObserved, timeout, outputCapExceeded },
  gate: 'RUN_COMPLETE' | 'RUN_INCOMPLETE',
  reasons: [ ...codes in the fixed order below ],
  adaptation: <adapter result> | null,
  adjudication: <adjudicator result> | null,
  table: <string> | null,
  overall: 'OBSERVED' | 'NOT_ACCEPTED',
  isolationAccepted: false, generatedCodeExecuted: false, authorizing: false }
```

`reasons` is built in this exact order, appending each code whose condition
holds (using the typed reads above):
1. `SPAWN_FAILED` — `spawnReturn !== 0`
2. `WAIT_NOT_OBSERVED` — `waitObserved !== true`
3. `IDENTITY_UNAVAILABLE` — `childPid === null || servicePid === null`
4. `PID_MISMATCH` — identity available AND `waitObservedPid !== childPid`
5. `SIGNALED` — `signal !== null`
6. `NONZERO_EXIT` — `exitCode !== 0`
7. `STDOUT_NOT_DRAINED` — `stdoutEOF !== true`
8. `STDERR_NOT_DRAINED` — `stderrEOF !== true`
9. `DRAIN_NOT_OBSERVED` — `drainObserved !== true`
10. `TIMEOUT` — `timeout !== false`
11. `OUTPUT_CAP_EXCEEDED` — `outputCapExceeded !== false`
12. then, only when identity is available: `adaptation = adaptFixedCanaryOutput(stdout, fixedCanaryMappingV1())`,
    `adjudication = adjudicateFixedCanaries(adaptation.adaptedOutput, expectedMatrixFor({ childPid, servicePid }))`,
    `table = formatCanaryTable(adjudication)`, and append `CANARIES_NOT_MATCHED` when
    `adjudication.overall !== 'ALL_MATCHED'`. When identity is unavailable, `adaptation`,
    `adjudication` and `table` are `null`.

`gate` is `'RUN_COMPLETE'` iff none of codes 1–11 was appended; otherwise
`'RUN_INCOMPLETE'`. `overall` is `'OBSERVED'` iff `reasons` is empty; otherwise
`'NOT_ACCEPTED'`. The three trailing literals are always `false`.

Fresh objects every call; never mutate `receipt` or `stdout` (they may be
frozen); no state between calls. Do not use `require`, `process`, `fetch`,
`XMLHttpRequest`, `eval`, `Function`, `setTimeout`, `setInterval`, `Date`,
`performance` or `Math.random` anywhere in the file, including comments; the
only `import` statements permitted are the two sibling modules above.

## Constraints

- Write ONLY `src/native-canary-summary.mjs`. Everything else is read-only:
  `package.json`, `roadmap.md`, `tests/`, `fixtures/`, `.packets/`, and the two
  frozen sibling modules in `src/`. No parent-tree exploration.
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

### P1 — Implement summarizeFixedRun
- **files**: src/native-canary-summary.mjs
- **do**: Replace the placeholder with the synchronous named export summarizeFixedRun(receipt, stdout) implementing the typed reads, the fixed-order reasons, the gated adjudication through the two sibling modules, the exact result shape and the non-mutation contract above.
- **accept**: npm run test:summary

## Packet acceptance
npm test
