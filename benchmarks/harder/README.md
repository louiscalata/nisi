# Harder-task benchmark

Sixteen frozen tasks that a small local model gets wrong in one pass: ISO week
numbers, multi-key sorts, interval merges, topological order, business days,
Levenshtein distance, banker's rounding, Semantic Versioning order and similar.
`make_tasks.py` computes every expected answer; none is typed by hand. Run it
to check the answers, and it rewrites `tasks-v1.json` byte for byte
(sha256 `c7a521d4…0a99a`, pinned in `run.mjs`).

This benchmark calls a real model. It is opt-in and needs a local
OpenAI-compatible endpoint, such as LM Studio or llama.cpp.

```bash
node benchmarks/harder/run.mjs --allow-live http://127.0.0.1:1234/v1/chat/completions <model> ./harder.json
```

Each task runs in two arms with the same author settings:

- **A**: one draft with no checks.
- **C**: the Nisi workflow, with a shape check, tests and a repair budget of 2.
  A failing test says which part is wrong (for example "2 of 6 elements are
  incorrect, at positions 0, 1") and the required length, never the expected
  values. The workflow's 600-second total deadline covers the draft and both
  repairs, so a slow model may not get its full repair budget.

| Option | Effect |
| --- | --- |
| `--max-tokens N` | Output-token cap per call (default 1,024) |
| `--reasoning EFFORT` | Sends `reasoning_effort` (`none`, `minimal`, `low`, `medium`, `high`) |
| `--tests shape` | Tests check only the answer form, as on a host with no answer oracle |
| `--judge MODULE --plan` | Jev pre-analysis picks the settings per task |
| `--judge MODULE --jev-review` | Adds the advisory Jev reviewer to arm C |
| `--task ID` | Runs one task; repeat it to run several |

`MODULE` is a file that exports `judge({ state, questions })`, which sends one
TypeSafe System One request and resolves to `{ model, answers }`. The key and
transport stay in that file; see [Jev pre- and post-analysis](../../docs/local-models.md).
The output file must not exist yet. Bad options are refused before it is
created. A run that fails midway still writes the rows it finished, marked
`PARTIAL`. A finished run records the dataset hash, the settings, one row per
task and arm (outcome, correctness, repairs, calls, tokens, time) and a per-arm
summary; the summary time covers that arm's calls only, not the Jev planning
calls.

## Results so far

`qwen3.8-27b` on LM Studio, arm C, one run per setting, 2026-11-07:

| Settings | Correct | Time |
| --- | --- | --- |
| 1,024-token cap, reasoning on | 10/16 | 9.8 min |
| 4,096-token cap, reasoning on | 14/16 | 15.4 min |
| `--reasoning none` | 8/16 | 2.7 min |
| `--plan` (Jev per task) | 14/16 | 12.7 min |

These are single runs on one host and one model. They show where the token
budget and the reasoning setting matter. They do not estimate accuracy on
other models or task sets.
