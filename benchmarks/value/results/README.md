# Local structured-output pilot · 2026-09-24

This is an **exploratory integration result**, not a quality benchmark for Nisi
against other products. The [raw 36-row result](pilot-local-gemma-20260924.json)
is SHA-256 `17c117821d347bf4ad248b70b319d8847bbedc2647edebf6b0a2e8edf996b10a`.
The [source manifest](pilot-local-gemma-source-sha256.json) pins the exact runner,
released workflow, local-chat adapter, checked-loop reference, dataset, and test
source used for this run. The current runner was subsequently revised to make
the shared-router gate configurable and to retain partial output on interruption;
its source hash therefore differs from the historical collection manifest.
Those operational changes did not alter the model prompts or scoring rule. The
retained candidate contents below allow independent rescoring without relying
on that claim. The [frozen dataset](../fixtures/live-pilot-v1.json)
has 12 public synthetic tasks: four JSON configuration transforms, four
classifications, and four text extractions.

One already loaded `google/gemma-4-26b-a4b-qat` instance answered through a
loopback OpenAI-compatible chat endpoint. All three arms used the shipped Nisi
author adapter, temperature 0, the same 1,024-token output cap and identical
draft request bytes per task. The two checked arms also used identical repair
request bytes per task, deterministic structural checks and reviewer, and at
most one repair. No independent reviewer model judged answer meaning. The
external strict-match oracle required one `answer.json` file whose JSON object
had only an `answer` key holding the expected value. It ran after each arm,
using the frozen answer key rather than the workflow report. The candidate
file contents and full workflow reports are retained in the raw result, so
those oracle verdicts can be recalculated.

| Arm | Output-contract matches | Model calls | Repairs | Reported tokens |
|---|---:|---:|---:|---:|
| A · direct one-shot draft | 6 / 12 | 12 | 0 | 4,803 |
| B · handwritten checked loop | 12 / 12 | 18 | 6 | 8,295 |
| C · Nisi workflow | 12 / 12 | 18 | 6 | 8,291 |

Every one of the 48 model-call receipts reports `RESPONSE_VALIDATED` and the
requested model identity. The six one-shot misses were structurally malformed
outputs lacking the required `answer` key. Each unwrapped JSON value equaled
the frozen expected answer; the strict oracle still correctly scored those
outputs as contract failures. Each checked arm detected those shapes and
repaired them once. **Nisi and the checked loop tied on these tasks.**
The one-shot arm had no repair opportunity, so this comparison shows the effect
of the added checking and repair path under this setup, not an advantage unique
to Nisi. A structurally complete workflow still cannot prove the answer is
correct; the external oracle is what checks these synthetic answers.

The same tasks had been exercised in a smoke run and earlier exploratory runs;
the repair feedback was normalized after an earlier run exposed different B/C
repair request bytes. This result is therefore not a fresh or confirmatory
sample. The server's cache behavior was not measured. Row times in the raw
result are observed local times, not isolated engine overhead or latency
estimates for other hardware. This run uses one model, one local endpoint, one
non-streaming adapter, and no live Windows or hosted provider. It does not
establish broad AGIW-suite interoperability, cost savings, or production task
accuracy. See the [study protocol](../LIVE-STUDY.md) for the next tests.
