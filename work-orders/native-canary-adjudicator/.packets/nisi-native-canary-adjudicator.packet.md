---
packet: nisi-native-canary-adjudicator
project_root: /Users/louiscalata/nisi-next-private/work-orders/native-canary-adjudicator
created_by: claude
created: 2026-09-13T11:05:00-07:00
write_owner: opencode
status: done
---

# Nisi — fixed-canary adjudicator and plain-text table

## Context

This is an isolated private work-order workspace, NOT the Nisi runtime or an
execution sandbox. Implement a pure data-adjudication module for a future
status window. Do not read or edit any parent directory.

Node 24 is installed; this ESM package has no dependencies. `npm test` passes
its two baseline checks against the placeholder. `npm run test:adjudicate`
(11 tests) and `npm run test:format` (6 tests) fail against the placeholder;
those failures are expected unfinished work, not permission to edit the tests.
The tests are the contract; read them in full before writing code.

The only implementation target is `src/native-canary-adjudicator.mjs`. It
exports exactly two named functions, both synchronous and pure.

### `adjudicateFixedCanaries(rawOutput, expected)` returns a result object

Input `rawOutput`: the child's stdout as a string; `null`/`undefined` mean empty.
Split on `\n`; strip one trailing `\r` per line; ignore lines that are empty or
whitespace-only. Line numbers are 1-based over the ORIGINAL split (blank lines
still count). Each remaining line is parsed with `JSON.parse`:

| Condition | Record in `malformedLines` as |
|---|---|
| `JSON.parse` throws | `{ line, reason: 'INVALID_JSON' }` |
| Parsed value is not a plain object (array, null, number, string, boolean) | `{ line, reason: 'NOT_AN_OBJECT' }` |
| `op` is missing, not a string, or the empty string | `{ line, reason: 'MISSING_OP' }` |

A well-formed observed row has `op` (nonempty string) and optionally `outcome`,
`errno`, `pid`, `ppid`. Read them exactly; never trim, lowercase or coerce.
"Integer" below means `Number.isSafeInteger(value)` is true.

Input `expected`: a trusted configuration array. Validate it FIRST and throw
`TypeError` (before touching `rawOutput`) unless: it is an array with at least
one element; every element is an object whose `operation` is a nonempty string,
unique across the array; `expectedOutcome` is one of `'ALLOWED'`, `'DENIED'`,
`'SELF_REPORT'`; `expectedErrno`, `expectedPid`, `expectedPpid` are each either
absent/`undefined` or a nonnegative integer.

For each expected row, in the given order, produce a result row:

```js
{ operation, expectedOutcome,
  expectedErrno: <integer or null>,          // null when not specified
  observedOutcome: <string or null>,
  observedErrno: <integer or null>,
  observedPid: <integer or null>, observedPpid: <integer or null>,
  verdict: 'MATCH' | 'MISMATCH' | 'NOT_OBSERVED' | 'AMBIGUOUS' }
```

Candidates are the well-formed observed rows whose `op === operation`:
- 0 candidates: `verdict: 'NOT_OBSERVED'`, all observed fields `null`.
- 2+ candidates: `verdict: 'AMBIGUOUS'`, all observed fields `null`.
- exactly 1 candidate `c`:
  - `observedOutcome` = `c.outcome` if it is a string, else `null`;
    `observedErrno` = `c.errno` if it is a nonnegative integer, else `null`.
  - For `ALLOWED`/`DENIED`: `observedPid`/`observedPpid` are `null`.
    `MATCH` iff `observedOutcome === expectedOutcome` AND
    (`expectedErrno` is null OR `observedErrno === expectedErrno`); else `MISMATCH`.
  - For `SELF_REPORT`: `observedOutcome` and `observedErrno` are `null`;
    `observedPid` = `c.pid` if it is a POSITIVE integer, else `null`; same for
    `observedPpid` from `c.ppid`. `MATCH` iff, for each of `expectedPid` and
    `expectedPpid` that is specified, the observed value equals it (an
    unspecified expectation constrains nothing); else `MISMATCH`.

`unexpectedOperations`: the `op` of every well-formed observed row whose `op`
matches no expected row, in observation order, duplicates preserved.

`counts`: `{ matched, mismatched, notObserved, ambiguous }` over the rows.
`overall`: `'ALL_MATCHED'` iff `matched === rows.length` AND
`malformedLines.length === 0` AND `unexpectedOperations.length === 0`;
otherwise `'NOT_ACCEPTED'`. `isolationAccepted`: always the literal `false`.

The result object has exactly these keys: `rows`, `malformedLines`,
`unexpectedOperations`, `counts`, `overall`, `isolationAccepted`. Return a
fresh object every call; never mutate inputs (they may be frozen); no state
between calls.

### `formatCanaryTable(result)` returns a string

Throw `TypeError` unless `result` is an object with an array `rows`, an object
`counts`, an array `malformedLines`, an array `unexpectedOperations`, and a
string `overall`. Output, with `\n` line endings and a final newline:

```text
Fixed canary adjudication
Overall: <overall>
Rows:
- <operation>: expected <expectedOutcome><E>, observed <O> -> <verdict>
Malformed lines: <malformedLines.length>
Unexpected operations: <none | ops joined by ", ">

Isolation acceptance is not established by this table.
```

One `- ` line per row in result order. `<E>` is ` errno <expectedErrno>` when
`expectedErrno` is not null, else empty. `<O>` is:
- for `SELF_REPORT` rows: `pid <observedPid or Unknown> ppid <observedPpid or Unknown>`;
- otherwise `Unknown` when `observedOutcome` is null, else
  `<observedOutcome> (errno <observedErrno or Unknown>)`.
`Unexpected operations:` prints `none` for an empty list. There is exactly one
blank line before the literal caveat. The two literal lines are
`Fixed canary adjudication` and `Isolation acceptance is not established by this table.`
Never mutate `result`.

Do not use `import`, `require`, `process`, `fetch`, `XMLHttpRequest`, `eval`,
`Function`, `setTimeout` or `setInterval` anywhere in the implementation,
including comments; no clocks or random values (`Date`, `performance`,
`Math.random`). A protected static check greps the file for those tokens.

## Constraints

- Write ONLY `src/native-canary-adjudicator.mjs`. Everything else is read-only,
  including `package.json`, `roadmap.md`, `tests/` and `.packets/`. No parent-tree exploration.
- OpenCode owns only this draft. Claude authored the contract; Astra (Codex) owns
  review and integration; packet completion is not product completion.
- No dependencies, installs, network or model calls, filesystem or process APIs,
  and no changes to the actual Nisi runtime.
- Keep all work private. No commits, pushes, packages, public README/demo or
  disclosures. Nothing in this packet grants publication permission.
- Do not run commands, tests or nested packets yourself. The installed wrapper
  runs the inspected acceptance checks and writes the execution receipt.
- Do not alter tests, acceptance commands, order or receipt to obtain DONE. If
  required context is missing, leave a concrete blocker, not an invented result.

## Items

### P1 — Implement adjudicateFixedCanaries
- **files**: src/native-canary-adjudicator.mjs
- **do**: Replace the placeholder with the synchronous named export adjudicateFixedCanaries(rawOutput, expected) implementing the complete parsing, validation, per-row verdict, unexpected-operation, counts, overall and non-mutation contract above. Keep the formatCanaryTable export present (it may still return null until P2).
- **accept**: npm run test:adjudicate

### P2 — Implement formatCanaryTable
- **files**: src/native-canary-adjudicator.mjs
- **do**: Replace the formatCanaryTable placeholder with the exact plain-text renderer specified above, including the TypeError guard and the literal caveat. Leave adjudicateFixedCanaries unchanged.
- **accept**: npm run test:format
- **needs**: P1

## Packet acceptance
npm test
