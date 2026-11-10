# Harder-task benchmark

Sixteen frozen tasks chosen because a small local model often errs on them: ISO
week numbers, multi-key sorts, interval merges, topological order, business
days, Levenshtein distance, banker's rounding, Semantic Versioning order and
similar. With the shipped options, one `qwen3.8-27b` draft solves 7 to 14 of the 16,
depending on the token budget and reasoning setting. `make_tasks.py` computes every expected
answer; none is typed by hand. Run it to check the answers, and it rewrites
`tasks-v1.json` byte for byte (sha256 `c7a521d4…0a99a`, pinned in `run.mjs`).

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
| `--max-tokens N` | Output-token cap per call (default 4,096, the adapter default) |
| `--timeout-ms N` | Timeout per model call (default 120,000, the adapter default). This does not change the Jev call. |
| `--jev-timeout-ms N` | Timeout for the built-in Jev client (default 60,000; 1,000 to 86,400,000). Ignored when `--judge` is set. |
| `--reasoning EFFORT` | Sends `reasoning_effort` (`none`, `minimal`, `low`, `medium`, `high`) |
| `--tests shape` | Tests check only the answer form, as on a host with no answer oracle |
| `--plan` | Jev pre-analysis picks the settings per task |
| `--jev-review` | Adds the advisory Jev reviewer to arm C |
| `--judge MODULE` | Use this module instead of the built-in Jev client |
| `--task ID` | Runs one task; repeat it to run several |

`--plan` and `--jev-review` use the built-in Jev client when `TYPESAFE_API_KEY` is
set. They send the task state to `https://api.typesafe.ai/v1/systemone`. With no
key and no `--judge` file, the run is refused before it creates the output file
and nothing is sent. `--judge MODULE` still wins over the environment variable.
`MODULE` exports `judge({ state, questions })`, which resolves to `{ model, answers }`.
The key and transport stay in that file when you use one; see
[Jev pre- and post-analysis](../../docs/local-models.md).
The output file must not exist yet. Unknown flags, a judge module that does not
export `judge`, an invalid reasoning effort, an out-of-range `--max-tokens` or
`--timeout-ms`, an endpoint the adapter refuses, and an unknown task id are
refused before it is created. A run that fails midway still writes the rows it finished, marked
`PARTIAL`. A finished run records the dataset hash, the settings, one row per
task and arm (outcome, correctness, repairs, calls, tokens, time) and a per-arm
summary; the summary time covers that arm's calls only, not the Jev planning
calls. `settings` in that file records the token cap, timeout, reasoning effort,
plan and review flags, task-set id, arms, repair budget, total deadline, judge
source (`builtin`, `module` or `function`), the built-in Jev timeout when that client is used, package version and runtime. It does
not record the API key or the judge module path. The endpoint is included so the
host that ran it can be seen; repeating the run still needs a live server there.

## Task set v2

`--tasks v2` runs 42 harder tasks in six categories of seven (state simulation,
text formats, algorithms, calendar and time, exact numbers, structured data),
18 medium and 24 hard. The prompts are procedural and self-contained: every
tie-break, rounding and output rule is stated, so the answer is the result of
careful execution, not knowledge. Every expected answer is computed by a standard-
library generator in `v2/generators/` (fixed seeds, no network). Some generators
cross-check with a second implementation in the same file. A separate program
that re-solved only the prompts is not in this repository.
`python3 make_tasks_v2.py` regenerates `tasks-v2.json` byte for byte (sha256
`63007882…350f5c`, pinned in `run.mjs`). For answers with at most two distinct
values (one task), the repair feedback gives only the count of wrong elements, not
their positions, because the positions would reveal the answer.

## Results so far

`qwen3.8-27b` on LM Studio, 2026-11-07. "One draft" is arm A and "Nisi" is arm C,
correct out of 16; time is for arm C and excludes Jev planning calls. Each row is
one run, except reasoning off, which was run twice (Nisi arm 8, then 7). The raw
files and how their settings were recovered are in [`results/`](results/README.md):
they came from an earlier private harness, so the flags below are the equivalent
`run.mjs` command, not values recorded in the files.

| Flags | One draft | Nisi | Time |
| --- | --- | --- | --- |
| `--max-tokens 1024 --timeout-ms 300000` | 10 | 10 | 9.8 min |
| none (library defaults: 4,096 tokens, 120 s) | 14 | 14 | 14.0 min |
| `--timeout-ms 300000` | 14 | 14 | 15.4 min |
| `--max-tokens 1024 --timeout-ms 300000 --reasoning none` | 7 | 8 | 2.7 min |
| `--timeout-ms 300000 --judge <module> --plan` | 14 | 14 | 12.7 min |

- The library defaults already solve 14 of 16, so at most 2 more tasks (16 of 16)
  are possible from any setting.
- A single unchecked draft scores the same as the Nisi arm in four of the five
  rows. In the reasoning-off row the Nisi arm scored 8 and 7 in its two runs, so
  that difference is within run-to-run noise.
- The 1,024-token row is a cap a host might choose, not the default.
- Jev planning solved 14, as did the defaults, and its 12.7 min against 15.4 min
  at the same 300 s timeout comes almost entirely from one task. Jev planned the
  base64 task (t06) as `direct`; both runs got it wrong, but the planned run
  failed after two repairs in 18 s while the flat run spent 168 s. The run-length
  encoding task (t08) saved another 22 s, and the other 14 tasks differ by seconds.
  This is not evidence that planning is faster or more accurate.
- Reasoning off alone is fastest but solves about half the tasks, though it solves
  t07 (Levenshtein) in about 4 s, where every reasoning run at 4,096 tokens or
  less fails it; only the unshipped 8,192-ceiling run solves it, in 417 s.
- A staged setup (draft with reasoning off, repair with reasoning on) solved 12 in
  13.8 min against 7 for its one-draft arm, and was worse than the defaults
  (14 in 14.0 min) because four reasoning repairs hit the 120 s timeout. A run
  with an 8,192 output ceiling and a 300 s timeout solved 15 in 24.8 min. Both
  need options that are not part of the package.
- Every figure is one run (or two) on one model and one machine.
