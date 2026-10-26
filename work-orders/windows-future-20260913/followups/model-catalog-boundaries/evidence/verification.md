# Verification

## Strengthened Windows boundaries

Command: `node --test --test-timeout=10000 tests/windows-boundaries.test.mjs`

Exit: 0

```text
✔ buildModelCatalog: 200-row boundary (1.178166ms)
✔ buildModelCatalog: 128-char string boundary (0.07125ms)
✔ buildModelCatalog: mixed UNKNOWN/AVAILABLE and independent axes (0.06225ms)
✔ buildModelCatalog: maximum-sized post-return mutation immutability (0.739792ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 34.729667
```

## Existing baseline

Command: `npm test`

Exit: 0

```text
> nisi-future-model-catalog@0.0.0-private test
> node --test --test-timeout=10000 tests/baseline.test.mjs

✔ private dependency-free ESM package (0.391208ms)
✔ named synchronous API placeholder exists (0.049625ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 33.430209
```

## Existing acceptance

Command: `npm run test:acceptance`

Exit: 0

```text
> nisi-future-model-catalog@0.0.0-private test:acceptance
> node --test --test-timeout=10000 tests/acceptance.test.mjs

✔ empty catalog is READY with exact keys and zero counts (0.606084ms)
✔ preserves row order and counts every availability and location enum (0.393667ms)
✔ accepts non-ASCII names as inert catalog data (0.2265ms)
✔ output is a copy and later input mutation cannot change it (0.19625ms)
✔ equivalent ordinary JSON input is deterministic (0.192083ms)
✔ refuses missing, extra, and wrong top-level keys with the exact refusal (0.082417ms)
✔ refuses malformed row shapes, missing fields, and extra fields (0.066666ms)
✔ refuses empty, non-string, and overlong identity text (0.095166ms)
✔ refuses unknown or incorrectly cased availability and location enums (0.074542ms)
✔ refuses duplicate ids and more than 200 rows (0.121583ms)
✔ dangerous ordinary-JSON keys are data-shape violations and never alter prototypes (0.061584ms)
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 37.288584
```

## Deliberate arithmetic mutant

The retained isolated wrapper changes only the maximum-sized READY result by incrementing `unknown` from 66 to 67. It does not alter the pack source.

Command: `node --test --test-timeout=10000 tests/windows-boundaries-mutant.test.mjs`

Exit: 1 (expected; mutant caught)

```text
✖ maximum counts are exact and conserve the total (2.006917ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 38.575667

✖ failing tests:

test at tests/windows-boundaries-mutant.test.mjs:15:1
✖ maximum counts are exact and conserve the total (2.006917ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

    {
      available: 67,
      local: 67,
      remote: 67,
      total: 200,
      unavailable: 67,
  +   unknown: 67,
  -   unknown: 66,
      unknownLocation: 66
    }
```

## Hash ledger

- raw worker response, unchanged: `1340fe9bcc5aa8e45bc180d19791e32747e185eda31caeea3ead35ae655db8f8`
- exact decoded initial worker test: `347f3b057f240a7e6b7fd180f612843cd74e3e56e6556514ce75dd7828b1e038`
- strengthened pack test: `d22771d230563a15af41466a4c84b86d0d6d275c018eeadfb595e1e017a30c89`
- pack source, unchanged: `383fea468bb42469e7abb6aaec7ef5a479bc995b3fb96237e32591985d608a65`
- baseline test, unchanged: `2cba3cd0fccb697d96c7160bc929d4c1f7aa189e9c0004c4ba8f4a5357e451c2`
- acceptance test, unchanged: `a59ee6cd8de2c55753fd8bb7e836d0fc05e1083a9278e68111818e04c9e8d475`
- package manifest, unchanged: `5ff6f1fdbcb6d77072fff7628b3d3df23e0fb5ed655564eec3fdca4b33ce8b29`
- owner review: `6defeffd633786adb2299e21692315083ec7a52ccad1913fd5a475d3bba7cab7`
- mutant source: `70732062d192c5cdc40562121b062d5eb8e3dabbee98e975e30d57978cf2365f`
- mutant test: `83c56ee0d48b04a51fed9eaf62e1fcb93827df78f74d634eb3fee4b0a5c267e1`
