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

Pass `author` and `[reviewer]` to the Workflow Engine along with your context
authorization, static checks and tests. The application supplies the task and
enforces which project data these callbacks may receive. The Apple-only file
grant does not authorize this destination. For the runnable configuration-data
example, which never executes model-generated programs:

```bash
node examples/local-model-workflow.mjs http://127.0.0.1:1234/v1/chat/completions AUTHOR_MODEL REVIEWER_MODEL
```

## Configuration and boundaries

Only the fields in the example and `maxRequestBytes`, `maxResponseBytes`,
`maxOutputTokens`, `timeoutMs` and an optional test `fetch` implementation are
accepted. The default request/response cap is 1 MiB each (allowed range 256 bytes
to 16 MiB), output cap 4,096 tokens (1–32,768), timeout 120,000 ms
(1–86,400,000). The engine's total deadline can be shorter. Settings and callback
references are captured at construction.

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
were refused: Qwen returned empty final content, and a GPT-OSS review timed out. See [verification](verification.md) for all retained outcomes.
The adapter is experimental; these runs do not establish general coding quality
or measured token savings.
