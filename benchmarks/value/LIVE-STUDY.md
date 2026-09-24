# Proposed live inference and integration study

Status: the 12-task **exploratory local pilot was run** on one configured Gemma
endpoint; [raw rows and scope](results/README.md) are retained. The broader
multi-backend integration and confirmatory quality studies below are **NOT RUN**.
The pilot does not establish general provider compatibility, productivity, or
cost savings.

## Frozen exploratory pilot runner

`fixtures/live-pilot-v1.json` contains 12 synthetic tasks and an external exact
answer key. Its byte digest is pinned in `live-pilot.mjs`. The runner is opt-in:

```sh
node benchmarks/value/live-pilot.mjs --allow-live \
  http://127.0.0.1:1234/v1/chat/completions MODEL_ID output.json all
```

`MODEL_ID` must be the exact identity reported by an already resident local
loopback chat server. The runner never loads or swaps a model. On hosts using
the separate online-code-mode router, set `NISI_ROUTER_COMMAND` to that
executable's path. The runner then checks its status before starting and before
every arm; an active run or unavailable status stops the pilot. Other hosts do
not need Louis's private router. The output file must not exist: the runner
reserves it before inference and appends each completed arm to a `.rows.jsonl`
sidecar. If interrupted, the output records `PARTIAL` and the remaining row
count, while the sidecar retains completed rows. Use a single task ID in place
of `all` for a canary.
Fake-fetch unit tests make no live inference request. The completed live pilot
used the earlier runner revision pinned in its source manifest; the current
runner adds output and router-gate safeguards. Earlier smoke and exploratory
runs saw the same tasks, so the completed result is not a fresh confirmatory
sample.

Each task rotates A/B/C order. A calls the shipped author adapter once. B uses
the handwritten checked loop. C uses the released workflow engine. All use the
same task text, model, author adapter, temperature zero, output-token cap, and
loopback transport. B/C share deterministic file-shape checks, a structural
reviewer, and one repair attempt. Their reviewer is not a second model and does
not verify answer meaning. The frozen exact-answer key is applied after each
arm, independently of its report. Thus `COMPLETED` can coexist with an
incorrect answer; such rows must remain visible. A has no checks or repair, so
its outcome is `DRAFTED`, not a workflow completion. The runner records per-call
adapter receipts and usage when reported; missing usage remains unknown. This
small pilot measures feasibility for one server configuration only.

## Start with integration portability

The adoption question is whether an existing inference system can keep its model
and transport while reusing the workflow's checks, review and stop conditions.
Do not equate different providers with different inference modalities.

Start with the shipped loopback chat adapter and two resident local model
configurations. Include a host-owned callback integration only when that host
already has a working inference client. Record the exact connector implementation,
model identity/revision, source hashes, request settings, server/runtime, hardware,
and whether the response is real, replayed, cached, or mocked. Keep Apple advisory
helpers separate from coding author/reviewer adapters. Hosted APIs need separate
host adapters and authorized data handling; they are not built into local-chat.

The completed first pilot used 12 frozen structured-output tasks (four
configuration transformations, four classifications, four bounded text
extractions), authored before model calls. File snapshots served as the
transport-neutral result representation. A valid workflow report and an
external oracle were separate checks. For the next backend, freeze new tasks
and expected outputs before calls; adjudicate labels with humans where there
is no unambiguous programmatic answer. Report each family separately.

For each backend record:

- Installation/adapter setup steps actually required, dependency changes and
  measured integration time; report operator experience, not an invented estimate.
- Files and lines changed in host adapter code, plus the workflow source digest
  before and after. Zero workflow changes establishes this integration's reuse,
  not universal compatibility.
- Requests attempted, accepted, rejected, timed out, cancelled, and unknown;
  parse/schema failures separately from incorrect answers.
- Whether authorization, repair limits, independent reviewer configuration and
  report storage can be preserved without backend-specific workflow changes.
- Real streaming completion signals, empty outputs and interruption behavior.
  Stopping locally does not establish that a remote provider stopped work/billing.
- Provider-reported usage and any missing usage. A missing number is unknown,
  never zero. Local inference is not automatically cost-free.

For the next study, predeclare equal checked-arm repair budgets and identical
prompts and request parameters per provider. The current pilot allowed one
repair in each checked arm and none in the direct arm. This is feasibility
evidence; 12 tasks do not establish
superiority. Preserve failures and all planned rows. Do not silently switch models
after observing a disappointing result.

## Then isolate a workflow benefit

For a confirmatory quality study compare a competent handwritten workflow with
Nisi under equal author/reviewer models, prompt bytes, sampling parameters,
context, test feedback, repair/call/token/time budgets, task files, and tool access.
The handwritten reference here shares value-object contracts; document that
dependency or build and audit a genuinely independent reference for a broader
library comparison. Compare one-shot separately, since its repair budget differs.

Use fresh tasks from intended user workflows and an independently implemented
oracle. Freeze task, prompt, adapter, model, evaluator and analysis hashes before
outcome collection. Keep pilot tasks out of the confirmatory set. Randomize paired
arm order with a retained seed, block by model and task family, record cache state
and interleave arms to reduce time/order bias. Run at least three replicates per
task/configuration; repeated runs are nested within task, not independent samples.

Primary endpoint: per-task majority **externally correct accepted result**. Also
report incorrect acceptance, correct candidate refused, repair recovery, non-run
rows, timeouts, and budget violations. Use a paired task-level analysis with an
effect-size interval; an exact McNemar test may accompany binary paired results.
Choose and freeze the final number of independent tasks from a power analysis
using a stated worthwhile effect and pilot discordance estimate. Do not stop when
a p-value first looks favorable. Predeclare multiplicity handling for secondary
quality hypotheses and any exclusions; report intention-to-run and sensitivity
views without hiding failed setup rows.

Measure full wall time from request admission to final report, including checks,
review and repair. Record model service time separately. Report total tokens and
cost per externally correct result over all attempted runs, with cost/usage
coverage and uncertainty; unknown usage prevents a complete cost claim. Provider
prices must be pinned by date, and local hardware energy/amortization must be
explicit if estimating local cost. Quality, latency and cost remain separate
trade-offs; combine them only under a predeclared user utility function.

For a project-size or context-efficiency claim, predeclare fresh target
repositories across measured size bands. Record tracked source files and bytes,
task-touched files, and the actual context bytes and tokens sent in every model
request. Separate input, output, cached, reviewer, and repair tokens; include
failed and incomplete runs in total usage. Pair arms on the same repository task
with matched model, context-selection policy, call/repair limits, and acceptance
tests. A smaller framework package alone is not evidence of fewer model tokens.

## Broader task benchmarks

[SWE-bench](https://www.swebench.com/) evaluates repository issue resolution;
it needs a repository tool environment beyond the released fixed demo.
[LiveCodeBench](https://arxiv.org/abs/2403.07974) covers code generation and related
capabilities including self-repair. Either can complement real user tasks once
the corresponding host exists; neither measures integration effort by itself.
Pin dataset versions and task dates, disclose prior exposure, and validate task
tests. Published tasks are not automatically unseen by current models. The
[OpenAI analysis of SWE-bench Verified](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/)
describes why flawed tests and training exposure can distort coding evaluation.

No leaderboard result should be reported from the 25 synthetic control specimens
or from the four mocked interface shapes in this directory.
