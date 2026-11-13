# Local models and Jev

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

Pass `author` and `[reviewer]` to the orchestrator (`runWorkflow`) along with your context
authorization, static checks and tests. The application supplies the task and
enforces which project data these callbacks may receive. The Apple-only file
grant does not authorize this destination. For the runnable configuration-data
example, which never executes model-generated programs:

```bash
npm run example:local-model -- http://127.0.0.1:1234/v1/chat/completions AUTHOR_MODEL REVIEWER_MODEL
```

The same fixed example runs as `nisi local-model ENDPOINT AUTHOR_MODEL REVIEWER_MODEL` (in a source checkout, `node bin/nisi.mjs local-model ...`).

- It needs exactly three arguments and two different model names.
- It checks four fixed assertions and sends the candidate and results to the reviewer.
- It evaluates JSON as data and changes no repository.
- Invalid arguments print an error and usage, exit code `2`, before any model request. A completed workflow exits `0`, an incomplete one `1`.
- A Node preflight refuses unsupported runtimes before loading the example.

## Configuration and boundaries

Only these options are accepted; anything else is refused. Settings and callback
references are captured at construction.

| Option | Default | Notes |
| --- | --- | --- |
| `id`, `destination`, `endpoint`, `model` | required | `destination` must be `'LOOPBACK_HTTP'` |
| `maxOutputTokens` | 4,096 | 1 to 32,768 |
| `timeoutMs` | 120,000 | 1 to 86,400,000; the orchestrator's total deadline can be shorter. Reasoning models can need several minutes per call, so raise it for hard tasks |
| `maxRequestBytes`, `maxResponseBytes` | 1 MiB each | 256 bytes to 16 MiB |
| `reasoningEffort` | omitted | `none`, `minimal`, `low`, `medium` or `high`; see below |
| `fetch` | built-in loopback transport | for tests; an injected implementation is trusted |

### Reasoning effort

`reasoningEffort` is sent as the OpenAI-compatible `reasoning_effort` field. With
a reasoning model, `none` stops hidden reasoning from using up the output budget.
Without the option the request body is unchanged (byte-identical to v0.2.1), and
servers that ignore the field behave as before.

### Transport and timeouts

The default transport is Node's `http` module, not `fetch`. Node's `fetch` gives up
on a request that has received no response headers for 300 s, and these requests
are not streamed, so a slow local model was cut off at five minutes whatever
`timeoutMs` said (the call failed as `LOCAL_CHAT_UNAVAILABLE`). With the built-in
transport, only `timeoutMs` and the caller's signal end a call. It does not follow
redirects, and any status other than 2xx is refused with
`LOCAL_CHAT_RESPONSE_UNAVAILABLE`. A `fetch` you inject keeps its own limits.

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
The adapter supplies orchestrator bindings, candidate digests and configured identity;
the model cannot return replacement test counts, permissions or a final verdict.

Both the transport envelope and model JSON are parsed with duplicate-key,
Unicode, finite-number and nesting checks. One explicit JSON code fence is
accepted. Unknown model-output fields are refused. This transport parser permits
finite fractional numbers used by provider metadata; it does not change Nisi's
integer-only canonical JSON v1 profile.

There must be exactly one choice, `finish_reason: "stop"`, a nonempty content
string, no requested tools or refusal, and a reported model name exactly matching
the configured name. Malformed or truncated results are unavailable, never a
passing review. The orchestrator still trusts the adapter and the endpoint's reports.

## Receipts and measured scope

`author.receipts()` and `reviewer.receipts()` return frozen snapshots containing
operation, adapter ID, requested/reported model, run/task/attempt identity,
input and result candidate fingerprints, request/response/content digests, elapsed time,
the requested output-token cap,
and provider-reported token counts when supplied. Missing usage is `null`, not
zero. Failures retain an UNAVAILABLE receipt and a specific code. The generic
orchestrator reports a rejected adapter promise as ADAPTER_EXCEPTION.

Receipts remain in adapter memory; the host may store them with the run report.
They contain hashes rather than copies of prompts or responses. The endpoint
can misreport its model or usage; these records are not model attestation or
independent billing measurements.

An earlier example run completed with Qwen as author, four real configuration
assertions, and GPT-OSS as reviewer, before JSON-schema requests were added.
On 11 September 2026, with the JSON-schema request format of that revision (the
schema has since gained length and non-blank constraints), Gemma 3
(`google/gemma-3-4b`)
authored a valid candidate, four assertions passed, and Gemma 4
(`google/gemma-4-26b-a4b-qat`) reviewed the same candidate successfully. That
configuration completed within a 90-second total deadline. Other configurations
were refused: Qwen returned empty final content, and a GPT-OSS review timed out.
See [verification](verification.md) for all retained outcomes. The adapter is
experimental; these runs do not establish general coding quality or measured
token savings.

## Jev pre- and post-analysis (optional)

`nisi/adapters/jev-advisor` (a separate module that loads only if you import it) uses Jev, TypeSafe's System One model (a hosted service that returns typed answers and probabilities), to make two judgments around a run.

**Version boundary.** The explicit `judge: 'typesafe'` setup below is unreleased source on main. In v0.3.1, invoking planning or review without a judge uses the hosted client when `TYPESAFE_API_KEY` is set; constructing a reviewer does not send a request. The v0.3.1 harder-task runner requires a judge module and does not use this environment fallback.

**What is sent, by whom, when (unreleased main).** Jev is a hosted service, so the data below leaves your machine. Nisi builds a `state` record: the task's id, mode, language, allowed file names and acceptance criteria and, for the reviewer, the candidate's files and whether the tests passed. A `judge` function receives that `state` and decides what is sent. Pass `judge: 'typesafe'` to use the built-in client, which sends the `state` as is to `https://api.typesafe.ai/v1/systemone` and reads `TYPESAFE_API_KEY`. The send happens when you call `planWithJev` before the run and when the Jev reviewer runs. If the variable is set and you do not pass `judge`, `planWithJev` rejects and `createJevReviewer` throws `JEV_JUDGE_REQUIRED`; each prints one line to stderr and sends nothing. Field-level details are in **What leaves your machine**, below.

Cost depends on the submitted task, candidate size and TypeSafe's current pricing. Check TypeSafe's pricing before enabling hosted calls.

**Quick setup.** Put your TypeSafe key in `TYPESAFE_API_KEY` and pass the config
flag `judge: 'typesafe'`. The harder-task runner's matching flag is `--judge typesafe`.
Nisi then uses its built-in client (`nisi/adapters/jev-client`):

```bash
export TYPESAFE_API_KEY=...   # never commit it; the variable alone does not send
```

```js
const plan = await planWithJev(task, { judge: 'typesafe' });
const reviewer = createJevReviewer({ id: 'jev.review', judge: 'typesafe' });
```

With only the variable set, `planWithJev` rejects and `createJevReviewer` throws
`JEV_JUDGE_REQUIRED`; each prints one line to stderr and sends nothing. A value other than a function or
`'typesafe'` throws `JEV_JUDGE_INVALID`. The client is also available directly, for a pinned model or an explicit
key: `createJevJudge({ apiKey, model: 'jev-1.14.0', timeoutMs })`. The default
model is `jev-latest`, which can change; pin a version when you need repeatable
runs, and the served model is recorded in `evidence.jevModel`.

**What the built-in client does.** It makes one POST of `{ model, state,
questions }` to `https://api.typesafe.ai/v1/systemone` with your key as a Bearer
token. The endpoint is fixed, so the key is never sent anywhere else; redirects are
errors; the request and the response are each limited to 1 MiB; the call times out
after 60 s by default (1 s to 24 h). `planWithJev(task, { judge: 'typesafe', timeoutMs })` and `createJevReviewer({ id, judge: 'typesafe', timeoutMs })` pass that value to the built-in client. A `judge` function is used as is, and this timeout does not apply to it. The default transport is Node's `https` module,
so a timeout longer than five minutes is not cut off by `fetch`. A `fetch` you pass
to `createJevJudge`, `planWithJev` or `createJevReviewer` replaces that transport
and keeps `fetch`'s own limits, including the five-minute header timeout. A `request`
function replaces `https.request` for tests; it is still called with the fixed host,
port and path. Neither
the key nor the response body appears in any error. Its failures use these codes: `JEV_API_KEY_REQUIRED`,
`JEV_API_KEY_INVALID`, `JEV_MODEL_INVALID`, `JEV_TIMEOUT_INVALID`,
`JEV_REQUEST_INVALID`, `JEV_REQUEST_TOO_LARGE`, `JEV_AUTH_FAILED` (401 or 403),
`JEV_RATE_LIMITED` (429), `JEV_HTTP_ERROR` (any other non-2xx status),
`JEV_TIMEOUT`, `JEV_RESPONSE_TOO_LARGE`, `JEV_RESPONSE_INVALID` and `JEV_UNAVAILABLE` (no connection, or any other failure that is not one of the codes above).

**Your own judge.** To use another transport, a proxy or a different model, pass
`judge({ state, questions })` yourself; it must return `{ model, answers }` and
Nisi never needs the key.

**What leaves your machine.** For pre-analysis the `state` is
`{ task: { taskId, mode, language, allowedFiles, acceptanceCriteria } }` (not
`protectedFiles`, `protectedSnapshots` or `policy`). For the reviewer it also
holds `candidate: { files }` and `testsPassed`. With `judge: 'typesafe'` the built-in client sends it as
is. A `judge` function decides what is sent.

**The judge contract.** `questions` maps a name to `{ type, instructions,
criteria? }`. Pre-analysis asks `plan` (`type: 'choice'`, with the criteria
`direct` and `reason`) and `underspecified` (`type: 'noul'`); the reviewer asks
`satisfies` (`type: 'noul'`). `answers` must have exactly one entry per question
name: `{ choice }` for a choice question (one of its criteria), `{ noul }` for a
probability between 0 and 1, and an optional `confidence` between 0 and 1. An
invalid answer is refused with `JEV_RESPONSE_INVALID`; a judge that throws gives
`JEV_UNAVAILABLE`. Other codes: `JEV_JUDGE_REQUIRED`, `JEV_JUDGE_INVALID`, `JEV_POLICY_INVALID`,
`JEV_TASK_INVALID`, `JEV_ID_INVALID`, `JEV_GATE_INVALID`, `JEV_THRESHOLD_INVALID`.

```js
import { planWithJev, createJevReviewer } from 'nisi/adapters/jev-advisor';

const plan = await planWithJev(task, { judge });          // before the run
const author = createLocalChatAuthorAdapter({ ...config, ...plan.settings });
// task.policy.requiredReviewers must equal reviewers.length, so raise it by one.
const reviewers = [myReviewer, createJevReviewer({ id: 'jev.review', judge })];
```

- **Pre-analysis** asks whether the task needs the model to reason (`reason`) or
  follows directly from the input (`direct`), and whether it is missing
  information (`underspecified`, a probability). The default policy gives
  `reason` tasks 4,096 output tokens, and `direct` tasks no reasoning
  (`reasoningEffort: 'none'`) and a 1,024-token cap.
- **Post-analysis** is a reviewer that records Jev's probability that the
  candidate meets every acceptance criterion. By default it is advisory: it
  passes and puts the probability in the review summary, so it adds a recorded
  number but no independent check, and it should not be the only reviewer. It
  counts as one of the task's required reviewers. If the judge fails or returns
  an invalid answer, the review is `UNAVAILABLE` and the run ends `BLOCKED` with
  `REVIEW_UNAVAILABLE`. With `gate: true` it fails below `threshold` (default
  0.5) and sends the candidate to repair.

### Measured results

The harder-task benchmark has 16 frozen tasks since v0.3.0. v0.3.1 adds `--tasks v2`, 42 more tasks in six categories. Every answer is computed by a generator. Some generators cross-check with a second implementation in the same file.

On 16 harder tasks with `qwen3.8-27b` (single runs), the adapter defaults
(4,096 tokens, 120 s) solve 14. A single unchecked draft also solves 14, and so
does the Jev plan. The Jev run took 12.7 min against 15.4 min for a flat
4,096-token budget at the same 300 s timeout, not counting the planning calls,
but that gap is almost entirely one task. Both runs got the base64 task (t06) wrong.
Jev planned it as `direct` (1,024 tokens, no reasoning), so the planned run
failed after two repairs in 18 s, while the flat run spent 168 s before its call
failed. Apart from that task and the run-length encoding task (about
22 s), the per-task times differ by seconds. Treat it as no demonstrated gain
in accuracy or speed. The table, the flags and the raw run files are in the
[harder-task benchmark](../benchmarks/harder/README.md).

Jev's post-analysis is not reliable enough to gate a run. On the 31 distinct
final answers collected from three earlier runs it ranked correct above
incorrect with AUC 0.78. At a threshold of 0.3 it caught 10 of the 13 wrong
answers and failed 7 of the 18 right ones; at 0.5 it caught all 13 and failed
14 of the 18. Those thresholds were scored on the same answers, the reviewer was
called without test results, and gating inside a workflow, where tests have
already passed, was not measured. Read the numbers as a ranking signal, not a
tuned gate. The labels and probabilities are in
[`benchmarks/harder/results/jev-post-calibration.json`](../benchmarks/harder/results/README.md);
the answers themselves are the `final` fields of the three run files, which the
earlier harness cut to 300 characters (one answer was scored from its truncation).
