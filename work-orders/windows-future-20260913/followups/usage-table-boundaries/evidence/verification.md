# Usage-table boundary verification

## New boundary oracle

Command: `node --test --test-timeout=10000 tests/windows-boundaries.test.mjs`

```text
✔ boundary test group 1: max durationMs preserves row, totals.durationMs null (0.41675ms)
✔ boundary test group 2: two rows with finite durations (0.069333ms)
✔ boundary test group 3: MAX_SAFE_INTEGER inputTokens overflow totals (0.067458ms)
✔ boundary test group 4: mixed null tokens and duration (2.605375ms)
✔ boundary test group 5: 200 rows max cap (0.996583ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 36.767333
```

Exit status: 0.

## Existing baseline

Command: `npm test`

```text

> nisi-future-usage-table@0.0.0-private test
> node --test --test-timeout=10000 tests/baseline.test.mjs

✔ private dependency-free ESM package (0.4075ms)
✔ named synchronous API placeholder exists (0.048375ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 34.127375
```

Exit status: 0.

## Existing acceptance

Command: `npm run test:acceptance`

```text

> nisi-future-usage-table@0.0.0-private test:acceptance
> node --test --test-timeout=10000 tests/acceptance.test.mjs

✔ empty input returns the exact ready shape with zero totals (0.6165ms)
✔ known zero counters and duration remain numeric zero (0.364417ms)
✔ nullable metrics produce row and column unknowns without inventing zeros (0.063042ms)
✔ reasoning tokens are reported as a subset and are not double-counted in totalTokens (0.055709ms)
✔ multiple rows sum each known column and count unknown rows (0.108542ms)
✔ input is exact and invalid ordinary values are refused (0.128708ms)
✔ provider and model may be null but non-null labels must be bounded nonempty strings (0.15775ms)
✔ negative, unsafe, negative-zero and invalid duration metrics are refused (0.135542ms)
✔ known reasoning count with unknown output does not invent a contradiction (0.082667ms)
✔ numeric overflow makes the affected totals null (0.103875ms)
✔ output is cloned and does not mutate or alias the input (0.108292ms)
✔ identical input is deterministic (0.055375ms)
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 34.618917
```

Exit status: 0.

## Existing owner regressions

Command: `node --test --test-timeout=10000 tests/owner-regressions.test.mjs`

```text
✔ unknown input on an earlier row cannot skip independent later columns (0.633125ms)
✔ known reasoning/output contradiction is refused even when input tokens unknown (0.099542ms)
✔ combined input and output overflow stays null although column sums individually fit (0.0875ms)
✔ unknown reasoning on one row does not skip later duration sums (0.078542ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 33.279833
```

Exit status: 0.

## Isolated deliberate arithmetic mutant

Command from `evidence/mutant`: `node --test --test-timeout=10000 tests/windows-boundaries.test.mjs`

```text
✖ boundary test group 1: max durationMs preserves row, totals.durationMs null (0.662ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 34.584667

✖ failing tests:

test at tests/windows-boundaries.test.mjs:6:1
✖ boundary test group 1: max durationMs preserves row, totals.durationMs null (0.662ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  
  + 1.7976931348623157e+308
  - null
  
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/windows-future-20260913/followups/usage-table-boundaries/evidence/mutant/tests/windows-boundaries.test.mjs:29:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.start (node:internal/test_runner/test:1191:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:385:17) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 1.7976931348623157e+308,
    expected: null,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

Exit status: 1, expected for the deliberate isolated mutant. The mutant wrapper
changes only oversized duration aggregation and imports the untouched pack source.
