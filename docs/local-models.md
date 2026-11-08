# Local model author and reviewer

`adapters/local-chat.mjs` implements author and reviewer callbacks for a local
HTTP chat-completions endpoint. It uses the request form documented by
[LM Studio](https://lmstudio.ai/docs/developer/openai-compat/chat-completions),
with structured response validation on Nisi's side. It has no runtime package
dependencies. A model server and suitable models must already be available.
The endpoint and model must support JSON-schema structured output. Nisi requests
a closed schema for each role using `response_format`, plus temperature zero;
it still validates the returned bytes. It does not retry with an unconstrained
response when the server refuses that format. See
[LM Studio's structured-output contract](https://lmstudio.ai/docs/developer/openai-compat/structured-output).

```js
import { createLocalChatAuthorAdapter, createLocalChatReviewerAdapter } from 'nisi';

const author = createLocalChatAuthorAdapter({
  id: 'local.author',
  destination: 'LOOPBACK_HTTP',
  endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
  model: 'YOUR_AUTHOR_MODEL',
});
const reviewer = createLocalChatReviewerAdapter({
  id: 'local.reviewer',
  destination: 'LOOPBACK_HTTP',
  endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
  model: 'YOUR_REVIEW_MODEL',
});
```

Pass `author` and `[reviewer]` to the Workflow Orchestrator along with your context
authorization, static checks and tests. The application supplies the task and
enforces which project data these callbacks may receive. The Apple-only file
grant does not authorize this destination. For the runnable configuration-data
example, which never executes model-generated programs:

```bash
npm run example:local-model -- http://127.0.0.1:1234/v1/chat/completions AUTHOR_MODEL REVIEWER_MODEL
```

The command requires exactly three arguments and two different model names.
It validates arguments before requesting inference. Missing or invalid configuration
prints an error and usage with exit code `2`; a completed workflow exits `0`,
and an incomplete workflow exits `1`. The Node preflight refuses unsupported
runtimes before loading the example.

## Configuration and boundaries

Only these options are accepted; anything else is refused. Settings and callback
references are captured at construction.

| Option | Default | Notes |
| --- | --- | --- |
| `id`, `destination`, `endpoint`, `model` | required | `destination` must be `'LOOPBACK_HTTP'` |
| `maxOutputTokens` | 4,096 | 1 to 32,768 |
| `timeoutMs` | 120,000 | 1 to 86,400,000; the engine's total deadline can be shorter |
| `maxRequestBytes`, `maxResponseBytes` | 1 MiB each | 256 bytes to 16 MiB |
| `reasoningEffort` | omitted | `none`, `minimal`, `low`, `medium` or `high`; see below |
| `fetch` | global `fetch` | for tests; an injected implementation is trusted |

### Reasoning effort

`reasoningEffort` is sent as the OpenAI-compatible `reasoning_effort` field. With
a reasoning model, `none` stops hidden reasoning from using up the output budget.
Without the option the request body is unchanged, and servers that ignore the
field behave as before.

### Destination

The destination must resolve through URL parsing to literal IPv4 or IPv6
loopback (`127.0.0.1` or `[::1]`) over HTTP. Hostname aliases, credentials, queries,
fragments, HTTPS and non-loopback addresses are refused. Redirects are errors.
No tools or streaming generation are requested. Response-body reads are bounded
and cancelled on overflow or abort. First-observed timeout/cancellation wins.

This restricts the client's destination, not the server's behavior. Nisi does
not authenticate the listening process or independently establish that it runs
inference locally, avoids logging, or forwards nothing. The host must choose a
trusted local server. An injected fetch implementation is also trusted.

## Model output

The author receives fixed task requirements and generates `{ candidate, note }`.
Repair receives the previous candidate and failed stage evidence and generates
`{ status, candidate, note }`, with REPAIRED or NO_CHANGE. Review receives the
candidate and fresh check/test results and generates `{ findings, summary }`.
The adapter supplies engine bindings, candidate digests and configured identity;
the model cannot return replacement test counts, permissions or a final verdict.

Both the transport envelope and model JSON are parsed with duplicate-key,
Unicode, finite-number and nesting checks. One explicit JSON code fence is
accepted. Unknown model-output fields are refused. This transport parser permits
finite fractional numbers used by provider metadata; it does not change Nisi's
integer-only canonical JSON v1 profile.

There must be exactly one choice, `finish_reason: "stop"`, a nonempty content
string, no requested tools or refusal, and a reported model name exactly matching
the configured name. Malformed or truncated results are unavailable, never a
passing review. The engine still trusts the adapter and the endpoint's reports.

## Receipts and measured scope

`author.receipts()` and `reviewer.receipts()` return frozen snapshots containing
operation, adapter ID, requested/reported model, run/task/attempt identity,
input and result candidate fingerprints, request/response/content digests, elapsed time,
the requested output-token cap,
and provider-reported token counts when supplied. Missing usage is `null`, not
zero. Failures retain an UNAVAILABLE receipt and a specific code. The generic
engine reports a rejected adapter promise as ADAPTER_EXCEPTION.

Receipts remain in adapter memory; the host may store them with the run report.
They contain hashes rather than copies of prompts or responses. The endpoint
can misreport its model or usage; these records are not model attestation or
independent billing measurements.

An earlier example run completed with Qwen as author, four real configuration
assertions, and GPT-OSS as reviewer, before JSON-schema requests were added.
With the current JSON-schema request format, Gemma 3 (`google/gemma-3-4b`)
authored a valid candidate, four assertions passed, and Gemma 4
(`google/gemma-4-26b-a4b-qat`) reviewed the same candidate successfully. That
configuration completed within a 90-second total deadline. Other configurations
were refused: Qwen returned empty final content, and a GPT-OSS review timed out.
See [verification](verification.md) for all retained outcomes. The adapter is
experimental; these runs do not establish general coding quality or measured
token savings.

## Jev pre- and post-analysis (optional)

`nisi/adapters/jev-advisor` uses Jev, TypeSafe's System One model (a hosted
service that returns typed answers and probabilities), to make two judgments
around a run. Nisi does not call Jev itself. You pass a
`judge({ state, questions })` function that sends one System One request and
returns `{ model, answers }`, so the key and transport stay with the host.
Whatever you put in `state` leaves your machine: the task text for pre-analysis,
and the task plus the candidate's files for the reviewer.

```js
import { planWithJev, createJevReviewer } from 'nisi/adapters/jev-advisor';

const plan = await planWithJev(task, { judge });          // before the run
const author = createLocalChatAuthorAdapter({ ...config, ...plan.settings });
const reviewers = [myReviewer, createJevReviewer({ id: 'jev.review', judge })];
```

- **Pre-analysis** asks whether the task needs the model to reason (`reason`) or
  follows directly from the input (`direct`), and whether it is missing
  information (`underspecified`, a probability). The default policy gives
  `reason` tasks 4,096 output tokens, and `direct` tasks no reasoning
  (`reasoningEffort: 'none'`) and a 1,024-token cap.
- **Post-analysis** is a reviewer that records Jev's probability that the
  candidate meets every acceptance criterion. It is advisory by default: it
  passes and puts the probability in the review summary. With `gate: true` it
  fails below `threshold` and sends the candidate to repair.

Measured on 16 harder tasks with `qwen3.8-27b` (single runs): the adapter
defaults (4,096 tokens, 120 s) solve 14, and Jev planning solves 14 in 12.7 min
against 15.4 min without it at the same 300 s timeout, with the planning calls
excluded from the time. A single unchecked draft scores the same 14, so these
are speed results, not accuracy gains. The full table, the flags for each row and
the caveats are in the [harder-task benchmark](../benchmarks/harder/README.md).

Jev's post-analysis is not reliable enough to gate a run. On 31 labelled
answers it ranked correct above incorrect with AUC 0.78. At a threshold of 0.3
it caught 10 of the 13 wrong answers and failed 7 of the 18 right ones. At the
default threshold of 0.5 it caught all 13 and failed 14 of the 18, so `gate: true`
with the default would send most correct candidates to repair.

