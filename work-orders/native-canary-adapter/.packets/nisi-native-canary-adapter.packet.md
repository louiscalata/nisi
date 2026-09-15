---
packet: nisi-native-canary-adapter
project_root: /Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter
created_by: claude
created: 2026-09-13T11:30:00-07:00
write_owner: opencode
status: done
---

# Nisi — fixed-canary vocabulary adapter (v1)

## Context

Isolated private work-order workspace, NOT the Nisi runtime. Implement a pure
data-mapping module. Do not read or edit any parent directory.

Node 24 is installed; this ESM package has no dependencies. `npm test` passes
its three baseline checks against the placeholder (it also pins two frozen
fixtures by sha256: `src/native-canary-adjudicator.mjs`, the accepted
adjudicator, and `fixtures/inherit-run-node.stdout`, a real 781-byte run
output). `npm run test:adapter` (14 tests) fails against the placeholder; those
failures are expected unfinished work, not permission to edit tests or fixtures.
The tests are the contract; read `tests/adapter.test.mjs` in full before coding.

The only implementation target is `src/native-canary-adapter.mjs`. It exports
exactly three named functions, all synchronous and pure. The adjudicator
(read-only fixture) consumes lines shaped `{"op":..., "outcome":..., "errno":...}`
and, for identity rows, `{"op":..., "pid":..., "ppid":...}`; it expects outcomes
`ALLOWED` / `DENIED` and operation names `own-write`, `own-read`,
`outside-read`, `loopback-bind`, `self-report`.

### `fixedCanaryMappingV1()` returns a fresh object, exactly

```js
{ version: 'nisi-fixed-canary-mapping/v1',
  operations: { own_container_write: 'own-write', own_container_read: 'own-read',
                outside_read: 'outside-read', ipv4_loopback_bind: 'loopback-bind',
                self_report: 'self-report' },
  outcomes: { allowed: 'ALLOWED' },
  denialSignatures: { outside_read: { errno: 1, code: 'EPERM', syscall: 'open' },
                      ipv4_loopback_bind: { errno: 1, code: 'EPERM', syscall: 'listen' } },
  identityOperation: 'self_report' }
```

New objects (including nested ones) on every call.

Acceptance uses an unmodified `fixedCanaryMappingV1()` result and the complete
`expectedMatrixFor(runtime)` matrix. A caller-supplied alternative mapping is
trusted policy, not stdout evidence; shape validation alone does not approve
its semantics or make it v1. Preserve raw stdout and the report for review.

### `adaptFixedCanaryOutput(rawStdout, mapping)` returns `{ version, adaptedOutput, report, counts }`

Validate `mapping` FIRST and throw `TypeError` (before touching `rawStdout`)
unless it is a non-null object with: string `version`; object `operations` whose
every value is a nonempty string; object `outcomes`; object `denialSignatures`
whose every value is an object with a safe-integer `errno`, string `code` and
string `syscall`; nonempty string `identityOperation`.
Here and for `runtime`, object means non-null and non-array. Required fields,
key-existence checks and table lookups use own properties; table validation
examines own enumerable string-keyed entries. Outcome-table values have no
additional validation requirement. Inputs are trusted data objects, not
accessors or proxies; inherited properties never supply policy or identities.

`rawStdout`: string; `null`/`undefined` mean `''`; all other types throw
`TypeError` after mapping validation, without coercion. Split on `\n`, strip one
trailing `\r` per line. Produce exactly one output line per input line (same
count, same order); `adaptedOutput` is the output lines joined with `\n`. For
each input line (1-based `line` over the split) append one report entry
`{ line, action, operation, op, outcome, mappedOutcome }` where every field not
described below is `null`:

1. Whitespace-only or empty line (`line.trim() === ''`) → output `''`; action `BLANK`.
2. **Duplicate member name, checked BEFORE parsing the whole line, tolerant of any text
   (never throws):** scan the characters tracking string literals (with
   backslash escapes) and a stack of open containers; each `{` pushes a new
   key set, `[` pushes an array marker, `}`/`]` pop. When a string literal ends
   directly inside an object (not an array) and, after optional whitespace, the
   next character is `:` (whitespace uses JavaScript `\s`), that literal is a
   member name. Decode that complete
   quoted literal with `JSON.parse` inside a try/catch and compare decoded
   names within that object's key set (`"outcome"` and `"\u006futcome"` are
   the same name). If the literal cannot decode, compare its raw escaped text
   in a separate set for that object. A repeated name rejects the line.
   Unmatched closing containers and unfinished strings never throw; full-line
   parsing in step 3 still rejects malformed text that has no detected duplicate.
   Output `{"op":"","reason":"DUPLICATE_KEY"}`; action
   `REJECTED_DUPLICATE_KEY`. Braces or quotes inside string literals do not
   count. The same name in separate objects is not a duplicate, including
   separate objects in an array; repeated names within one array element's
   object are rejected.
3. `JSON.parse` throws, or the value is not a plain object (array, null,
   primitive) → output the input line unchanged; action `PASSTHROUGH_INVALID`.
4. Before any passthrough or mapping of a parsed object `rec`, reject if any
   of these conditions holds:
   - `rec` has an `op` key (already-adjudicator or mixed vocabulary).
   - Its string `operation` is not a key of `mapping.operations` but equals
     one of that table's values (an unmapped name colliding with an output op).
   - It has a mapped, non-identity operation and a string `outcome` equal to
     `ALLOWED` or `DENIED` that is not a key of `mapping.outcomes` (an unknown
     input outcome colliding with an adjudicator outcome).
   - It has a mapped identity operation and either a present `outcome` other
     than `observed`, a present `errno` other than numeric `0`, or any `code`
     or `syscall` key. Missing outcome/errno remain permitted for identity rows.
   - It has a mapped, non-identity operation, `outcome !== 'error'`, and a
     `code` or `syscall` key (diagnostics that would otherwise be discarded).
   Output `{"op":"","reason":"UNTRUSTED_VOCABULARY"}`; action
   `REJECTED_UNTRUSTED_VOCABULARY`; all report fields except line/action are
   null. These guards take precedence over steps 5 and 6. Other extra metadata
   is outside the canary comparison and is omitted from mapped output.
5. `operation` missing, not a string, or empty → unchanged; action
   `PASSTHROUGH_NO_OPERATION`.
6. Otherwise let `rec` be the parsed object; report `operation` = `rec.operation`;
   report `outcome` = `rec.outcome` if it is a string, else `null`.
   - If `rec.operation === mapping.identityOperation` and it has a mapped name:
     output `{"op": <mapped>}` plus `"pid": rec.pid` and `"ppid": rec.ppid`,
     each copied verbatim (any JSON type) and only when that key exists on
     `rec`; key order `op`, `pid`, `ppid`. Action `MAPPED_IDENTITY`; report `op`
     = mapped name; `mappedOutcome` `null`.
   - Else if `rec.operation` is an own key of `mapping.operations`: output
     `{"op": <mapped>, "outcome": <O>, "errno": rec.errno}` where `outcome` is
     present only when `rec` has an `outcome` key and `errno` only when `rec`
     has an `errno` key (copied verbatim); key order `op`, `outcome`, `errno`.
     `<O>` and action:
     - `rec.outcome === 'error'` and `mapping.denialSignatures[rec.operation]`
       exists and `rec.errno`, `rec.code`, `rec.syscall` are strictly equal to
       that signature's `errno`, `code`, `syscall` → `'DENIED'`, action
       `MAPPED_DENIAL`, `mappedOutcome: 'DENIED'`.
     - `rec.outcome === 'error'` otherwise → `'ERROR'`, action
       `MAPPED_ERROR_UNRECOGNIZED`, `mappedOutcome: 'ERROR'`.
     - `rec.outcome` is a string that is an own key of `mapping.outcomes` →
       that value, action `MAPPED`, `mappedOutcome` = that value.
     - otherwise → `rec.outcome` copied verbatim (any type, or omitted when
       absent), action `MAPPED_OUTCOME_UNKNOWN`, `mappedOutcome: null`.
     Report `op` = mapped name.
   - Else (operation not mapped): output `{"op": rec.operation, "outcome":
     rec.outcome, "errno": rec.errno}` with `outcome`/`errno` present only when
     the keys exist, copied verbatim; action `PASSTHROUGH_UNMAPPED_OPERATION`;
     report `op` = `rec.operation`; `mappedOutcome` `null`.

Output objects are serialized with `JSON.stringify` (no spaces). `counts` =
`{ mapped, passthrough, rejected, blank }` counting actions that start with
`MAPPED`, `PASSTHROUGH`, `REJECTED`, and `BLANK` respectively. `version` =
`mapping.version`. Fresh objects every call; never mutate inputs (they may be
frozen); no state between calls.

### `expectedMatrixFor(runtime)` returns a fresh array, exactly

Throw `TypeError` unless `runtime` is a non-null object whose `childPid` and
`servicePid` are both positive safe integers. Return:

```js
[ { operation: 'own-write',     expectedOutcome: 'ALLOWED',     expectedErrno: 0 },
  { operation: 'own-read',      expectedOutcome: 'ALLOWED',     expectedErrno: 0 },
  { operation: 'outside-read',  expectedOutcome: 'DENIED',      expectedErrno: 1 },
  { operation: 'loopback-bind', expectedOutcome: 'DENIED',      expectedErrno: 1 },
  { operation: 'self-report',   expectedOutcome: 'SELF_REPORT', expectedPid: childPid, expectedPpid: servicePid } ]
```

The caller must obtain both identities from trusted host/service evidence for
the same run, never from the child's stdout or adapter report. For this frozen
fixture, the owner verified service evidence: `childPid: 20280` from the spawn
result and `servicePid: 20279` from the service's own identity. The pure helper
validates values; it cannot authenticate their provenance. Source acquisition,
run binding and isolation acceptance remain separate integration obligations.

Do not use `import`, `require`, `process`, `fetch`, `XMLHttpRequest`, `eval`,
`Function`, `setTimeout` or `setInterval` anywhere in the implementation,
including comments; no clocks or random values (`Date`, `performance`,
`Math.random`). A protected static check greps the file for those tokens.

## Constraints

- Write ONLY `src/native-canary-adapter.mjs`. Everything else is read-only:
  `package.json`, `roadmap.md`, `tests/`, `fixtures/`, `.packets/`, and the frozen
  `src/native-canary-adjudicator.mjs`. No parent-tree exploration.
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

### P1 — Implement the adapter module
- **files**: src/native-canary-adapter.mjs
- **do**: Replace the placeholder with the three synchronous named exports fixedCanaryMappingV1(), adaptFixedCanaryOutput(rawStdout, mapping) and expectedMatrixFor(runtime), implementing the complete mapping, duplicate-member rejection, passthrough, report, counts, identity-matrix and non-mutation contract above.
- **accept**: npm run test:adapter

## Packet acceptance
npm test
