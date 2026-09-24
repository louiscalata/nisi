# Proposed live inference and integration study

Status: **NOT RUN**. This is a protocol proposal, not evidence of provider
compatibility, performance, task accuracy, productivity, or cost savings.

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

Use 12 fresh structured-output tasks (four configuration transformations, four
classification-to-JSON tasks, four bounded text-extraction tasks) as an exploratory
integration pilot. These are new host task contracts, with file snapshots used as
the transport-neutral result representation. Have a second author write frozen
input/expected-output pairs before running the adapters. Success requires both a
valid workflow report and an external oracle. Human label adjudication is required
where there is no unambiguous programmatic answer. Report each family separately.

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

Run the same one-shot and two-repair policies, with identical prompts and request
parameters per provider. This is feasibility evidence; 12 tasks do not establish
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
