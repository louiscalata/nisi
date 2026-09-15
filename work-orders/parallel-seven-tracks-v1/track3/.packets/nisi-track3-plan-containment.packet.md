---
packet: nisi-track3-plan-containment
project_root: /Users/louiscalata/nisi-next-private/work-orders/parallel-seven-tracks-v1/track3
created_by: claude
created: 2026-09-14T01:15:00-0700
write_owner: opencode
status: done
---

# Close two containment defects in the prevention experiment-plan validator

## Context
`src/prevention-experiment-plan-v1.mjs` (111 lines, ES module, imports only
`node:crypto`) exports `readPreventionExperimentPlanV1(input)`: a pure
validator/canonicalizer that refuses a bad plan by throwing
`Object.assign(new Error(code), { code })` via the local `fail(code)` helper and
returns a deep-frozen copy otherwise. Helpers: `record(value, keys)` copies an
exact plain record; `list(value, min, max)` copies an exact plain array;
`digest(value)` accepts a 64-char lowercase hex string.

Two suites exist. `npm run test:author` runs the author's 9 tests
(`tests/author.test.mjs`, all pass now and must keep passing). `npm test` runs
the independent containment oracle `tests/plan-containment.test.mjs` (17 tests):
10 pass and 7 fail on the current module. The 7 failures are exactly the two
defects below; every other test in that file already passes and must not change.

Defect 1 — `list()` (lines 27-38) reads `value.length` four times (bounds
check, key-count check, loop condition). A Proxy whose `length` reports a small
number on the first reads and the true number later passes the bounds and then
yields an oversized array. Required end state of `list()`:

```js
function list(value, min, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('PLAN_LIST');
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < min || length > max) fail('PLAN_LIST');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || keys.at(-1) !== 'length') fail('PLAN_LIST_SHAPE');
  const out = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) fail('PLAN_DESCRIPTOR');
    out.push(descriptor.value);
  }
  return out;
}
```

Defect 2 — lines 83-84 validate the three per-task digests but compare only
`taskSha256` against `trainingDigests`; an oracle or baseline digest that is a
training example is accepted. Required end state of those two lines (inside the
`tasks` map callback, replacing the existing `for` line and the following
`if (trainingDigests.includes(task.taskSha256)) …` line):

```js
    for (const key of ['taskSha256','baselineSha256','oracleSha256']) {
      task[key] = digest(task[key]);
      if (trainingDigests.includes(task[key])) fail('PLAN_TRAINING_EVALUATION_OVERLAP');
    }
```

Everything else in the file stays byte-identical. Error codes are unchanged.

## Constraints
- Edit only `src/prevention-experiment-plan-v1.mjs`; never edit anything under `tests/`.
- Do not add imports, dependencies, files, comments or new error codes.
- Do not change any other function, constant, key list or the export name.
- Never run `git`, `npm install`, or anything outside this project root.

## Items

### P1 — apply the two end-state edits to the validator
- **files**: src/prevention-experiment-plan-v1.mjs
- **do**: replace the body of `list()` with the end-state shown in Context
  (Defect 1) and replace the two per-task digest lines with the end-state shown
  in Context (Defect 2). No other change.
- **accept**: npm test

## Packet acceptance
npm run test:author
