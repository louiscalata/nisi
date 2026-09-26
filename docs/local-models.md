# Local model author and reviewer

`adapters/local-chat.mjs` implements author and reviewer callbacks for a local
HTTP chat-completions endpoint. It uses the request form documented by
[LM Studio](https://lmstudio.ai/docs/developer/openai-compat/chat-completions),
with structured response validation on Nisi's side. It has no runtime package
dependencies. A model server and suitable models must already be available.
The endpoint and model must support JSON-schema structured output. Nisi requests
a closed schema for each role using `response_format`, plus temperature zero;
it still validates the returned bytes. Candidate paths in the schema exclude the
task's protected files (unless every allowed file is protected), and finding
codes and messages carry the engine's limits of 1–128 and 1–2,048 characters.
It does not retry with an unconstrained response when the server refuses that
format. See
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

Only the fields in the example and `maxRequestBytes`, `maxResponseBytes`,
`maxOutputTokens`, `timeoutMs` and an optional test `fetch` implementation are
accepted. The default request/response cap is 1 MiB each (allowed range 256 bytes
to 16 MiB), output cap 4,096 tokens (1–32,768), timeout 120,000 ms
(1–86,400,000). The engine's total deadline can be shorter. Settings and callback
references are captured at construction.

The destination must resolve through URL parsing to literal IPv4 or IPv6
loopback (`127.0.0.1` or `[::1]`) over HTTP. Hostname aliases, credentials, queries,
fragments, HTTPS and non-loopback addresses are refused as
`LOCAL_CHAT_DESTINATION_REFUSED`; so are `0.0.0.0`, `127.0.0.2` and
`[::ffff:127.0.0.1]`. An unparsable endpoint, or one longer than 2,048
characters, is `LOCAL_CHAT_ENDPOINT_INVALID`. Forms that the URL parser rewrites
to `127.0.0.1`, such as `http://2130706433/` or a trailing dot, are accepted and
requested as that address. Redirects are errors.
No tools or streaming generation are requested. Response-body reads are bounded
and cancelled on overflow or abort. First-observed timeout/cancellation wins.

Without an injected `fetch`, each request uses `node:http` with a private
connection agent, not the global `fetch`, its dispatcher or `http.globalAgent`.
Node's environment proxy (`NODE_USE_ENV_PROXY=1` or `--use-env-proxy` with
`HTTP_PROXY`) and a host-installed dispatcher therefore do not reroute it. This
transport asks for an uncompressed response, never follows redirects and has no
timeout of its own, so `timeoutMs`, the payload's `signal` and the engine deadline
bound the whole call across the full 1–86,400,000 ms range. A status outside
2xx, or 204 or 205, is `LOCAL_CHAT_RESPONSE_UNAVAILABLE`; a refused, reset or
truncated connection is `LOCAL_CHAT_UNAVAILABLE`. An injected `fetch` receives
`redirect: "error"` and brings its own routing, proxy and timeout behavior. Node's
global `fetch`, for example, follows its dispatcher's proxy settings and default
300-second response-header timeout.

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

Each refusal has a fixed code. An envelope or choice that is not an object, or
not exactly one choice, is `LOCAL_CHAT_CHOICES_INVALID`. Another finish reason, a
`tool_calls` value other than absent, `null` or `[]`, or a truthy `refusal` is
`LOCAL_CHAT_FINISH_REFUSED`. A different reported model is
`LOCAL_CHAT_MODEL_MISMATCH`. A missing or non-object message, or blank content, is
`LOCAL_CHAT_EMPTY_RESPONSE`. Usage that is present but not an object whose
`prompt_tokens` and `completion_tokens` are non-negative integers summing to
`total_tokens` is `LOCAL_CHAT_USAGE_INVALID`; omitted or `null` usage is accepted
as missing. A call whose payload is not an object with a `task` object, an
`allowedFiles` array and, if present, a `protectedFiles` array is refused as
`LOCAL_CHAT_PAYLOAD_INVALID` before any request or timer starts.

## Receipts and measured scope

`author.receipts()` and `reviewer.receipts()` return frozen snapshots. Every
receipt has `schemaVersion`, `operation`, `adapterId`, `requestedModel`, `runId`,
`taskFingerprint`, `attempt`, `inputCandidateFingerprint`,
`requestedMaxOutputTokens`, `requestSha256`, `elapsedMs`, `status`,
`reportedModel`, `candidateFingerprint`, `resultCandidateFingerprint`,
`responseSha256`, `contentSha256`, `usage` and `httpStatus`. `usage` holds
provider-reported `promptTokens`, `completionTokens` and `totalTokens`; missing
usage is `null`, not zero. A validated call has status `RESPONSE_VALIDATED`.
A failure has status `UNAVAILABLE`, a specific `code` and null candidate
fingerprints, and keeps whatever the endpoint had already supplied: the HTTP
status of a returned response, the response and content digests, a reported
model name of at most 256 characters, and usage that passes validation. Anything
not yet known is `null`. The generic engine reports a rejected adapter promise
as ADAPTER_EXCEPTION.

Receipts remain in adapter memory; the host may store them with the run report.
Apart from the reported model name and token counts, they contain hashes rather
than copies of prompts or responses. The endpoint can misreport its model or
usage; these records are not model attestation or independent billing
measurements.

An earlier example run completed with Qwen as author, four real configuration
assertions, and GPT-OSS as reviewer, before JSON-schema requests were added.
With the current JSON-schema request format, Gemma 3 (`google/gemma-3-4b`)
authored a valid candidate, four assertions passed, and Gemma 4
(`google/gemma-4-26b-a4b-qat`) reviewed the same candidate successfully. That
configuration completed within a 90-second total deadline. Other configurations
were refused: Qwen returned empty final content, and a GPT-OSS review timed out. See [verification](verification.md) for all retained outcomes.
The adapter is experimental; these runs do not establish general coding quality
or measured token savings.
