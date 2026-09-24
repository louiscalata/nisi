# Benchmarks for deciding whether to use Nisi

Run these benchmarks when evaluating Nisi's workflow controls, integration seam,
and execution overhead. They use the unchanged released v0.2.0 orchestrator.
They do not call a model or claim that Nisi improves a model's reasoning.

From a source checkout with Node.js 22 or newer, use new output directories:

```bash
node benchmarks/value/run.mjs ./control-results
node benchmarks/value/interop.mjs ./interface-results
node benchmarks/value/overhead.mjs ./overhead-results
node --test tests/value-benchmark.test.mjs tests/value-interop.test.mjs
```

The three benchmark commands write a source manifest, raw JSON results and a Markdown report.
Existing output directories are refused. The benchmark sources are source-checkout
tools, excluded from the packaged runtime's file list. The canonical development
roadmap is `roadmap.md` at the repository root.

| Question | What runs | What the result can establish |
|---|---|---|
| Are the checks and repair rules useful? | 25 authored control scenarios across a checked one-shot, a competent checked loop, and Nisi | Which specified control paths accept, repair or refuse; no production accuracy estimate |
| Can an existing inference interface be wrapped? | Synchronous callback, Promise text, host-aggregated async text, and the shipped chat adapter with fake HTTP transport | Four synthetic adaptation examples with the workflow unchanged; live provider compatibility remains unverified |
| How much does orchestration cost? | Trace-matched first-pass and one-repair paths, three file payload sizes, 1,200 measured pairs | Warm inert-callback runtime overhead on the measured host; no model speed or dollar-cost claim |
| Does it improve real outcomes? | A proposed paired live study | Not yet measured by these benchmarks; see the study plan |

The handwritten scheduler shares Nisi task/candidate validation and hashing. It
provides a competent scheduling comparison, not a fully independent competing
library. The one-shot arm differs in repair budget, so better recovery is not
attributed uniquely to Nisi. A tie is useful: it shows which controls a host can
reuse rather than maintaining another implementation. Development time saved
requires a separate integration study.

## Adapt an existing inference system

```mermaid
flowchart LR
    backend["Existing model or inference service"] --> adapter["Host adapter: normalize output and bind evidence"]
    adapter --> workflow["Unchanged Nisi workflow"]
    workflow --> checks["Host checks, tests and review"]
    checks --> report["Bound result and stop reason"]
    checks -->|"Repair within budget"| adapter
```

The protocol can differ behind the callback. The host must still produce Nisi's
file-snapshot candidate and evidence schemas. The bundled local-chat adapter is
limited to a compatible loopback HTTP chat-completions endpoint with non-streaming
structured output. Async-stream aggregation in this demonstration is custom host
code. Hosted vendors, tool-calling, multimodal inference and embeddings are not
validated by these fixtures. The Apple advisory helper has a separate contract.

## Trust boundary

The dishonest-PASS specimen intentionally accepts a wrong answer when all host
callbacks lie consistently. Its external oracle flags **incorrect acceptance**.
Do not convert expected behavior across the specimens into a “100% accurate” or
“100% safe” claim. Nisi validates the evidence contract, not a callback's honesty.
Report-store acknowledgement tests likewise do not establish disk durability.

See [the controlled protocol](PROTOCOL.md) for exact methodology and amendments,
[the proposed live study](LIVE-STUDY.md) for the next evidence needed, and the
generated reports for observed outcomes and raw timing data.
