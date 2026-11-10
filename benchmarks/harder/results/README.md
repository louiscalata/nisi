# Raw results

The run files behind the tables in [the harder-task benchmark](../README.md) and
[the Jev section of the local-models guide](../../../docs/local-models.md#measured-results).
Each `run-*.json` holds one row per task and arm (`A` one draft, `C` Nisi workflow)
with outcome, correctness, repairs, calls, tokens and milliseconds. All use
`qwen3.8-27b` on LM Studio and the frozen task file (`datasetSha256` in each file).

**Provenance.** These runs were made on 2026-11-07 with an earlier private harness
that drives the same workflow as `run.mjs` but takes its settings from environment
variables and does not record the token cap or timeout in the output. The settings
below are therefore the harness defaults and the commands that were run, not a
complete record stored in the files. That harness is not shipped. A run made with
the current `run.mjs` writes those values in `settings`, including on a partial
file. These historical files cannot be repeated from the file alone. The `tree`
field is the name of the source checkout that was measured, with its local path
removed.

| File | Settings | Notes |
| --- | --- | --- |
| `run-v0.2.1.json` | 1,024 tokens, 300 s | |
| `run-v0.2.1-4096.json` | 4,096 tokens, 300 s | |
| `run-base-defaults.json` | 4,096 tokens, 120 s | the adapter defaults |
| `run-effort-none.json` | reasoning `none`, 1,024 tokens, 300 s | |
| `run-effort-diag.json` | as above, second run | on a tree with an experimental repair-feedback change that was dropped; Nisi arm 7/16 where the first run had 8/16 |
| `run-effort-low.json` | reasoning `low`, 1,024 tokens, 300 s | not used in the tables |
| `run-jev-plan.json` | Jev plan per task (default policy), 300 s | planning answers in `jev-plans.json` |
| `run-staged.json` | draft reasoning `none` at 1,024 tokens, then repairs with reasoning on at 4,096 tokens and an 8,192 ceiling, 120 s | needs an unshipped option; 12/16, worse than the defaults |
| `run-ceiling-300.json` | 4,096 tokens with an 8,192 ceiling, 300 s | needs the unshipped `maxOutputTokensCeiling`; 15/16 in 24.8 min; the only run with reasoning on and a 4,096-token base that solves t07 |

Each setting was run once except reasoning `none`, which was run twice. Times are
wall-clock for the arm and exclude the Jev planning calls.

## Jev post-analysis calibration

`jev-post-calibration.json` holds the 31 distinct final answers (18 correct, 13
wrong) from `run-v0.2.1.json`, `run-effort-none.json` and `run-effort-diag.json`,
each with the oracle label and the probability Jev gave for "satisfies every
criterion". The reviewer was called with no test results, the answers come from
unchecked and failed drafts, and the thresholds in the guide (0.3 and 0.5) were
scored on this same set, so they are descriptive, not a validated gate. The script
that produced it imported a private tree and is not shipped; the AUC (0.7756) and
the threshold counts can be recomputed from the file.
