# Actual repository host history — private work order

**Overall Nisi: 30% (3/10 NX milestones). This slice: 100% (5/5 deliverables).**
This percentage covers the optional source-checkout host integration, not NX-05,
authenticated approval, automatic failure learning, a native app or release.

## Accepted deliverables

- [x] Source-grounded contract, independent oracle and retained stub-red evidence.
- [x] Real repository host wiring for post-settlement metadata-only preview.
- [x] Explicit one-attempt storage with digest, clock, reentry and outcome guards.
- [x] 30 focused tests, relocated control, eight semantic mutants and full1472/1472
  product check; five separate unforeseen-dependency regressions.
- [x] Real temporary filesystem capture/sync and two fresh-process reopens with
  exact entry, candidate-presence, preview and declaration identities.

| Evidence | Actual result |
| --- | --- |
| [Original stub](../../.build/repository-host-history-red-BypYAv/verification.json) | 1/30 pass, 29 failures before implementation; the exposed API test already passed |
| [Final source verification](../../.build/repository-host-history-verification-HzMJM7/verification.json) | 1472/1472 product, 30/30 focused and relocated control, 242 stable selected hashes |
| [Storage-uncertainty red](../../.build/repository-host-history-post-admission-Cv2zGH/verification.json) | 0/5; five assertion failures on original helper |
| [Storage-uncertainty green](../../.build/repository-host-history-post-admission-IH78TN/verification.json) | 5/5 on corrected helper; no second record call or malformed-result leakage |
| [Real filesystem](../../.build/repository-host-history-verification-real-MYiulo/verification.json) | Two synthetic observations stored and synced, both reopened in separate Node processes |
| [Original Opus source finding](evidence/opus-source-response.json) | FAIL retained; contract discrepancy adjudicated, classification improved |
| [Opus correction review](evidence/opus-resolution-response.json) | PASS for supplied current capture excerpt and revised contract; no independent test execution |
| [Corrections and attribution](evidence/adjudication.md) | Model suggestions, root corrections and source pins retained |

Eight mutation assertion counts: **1, 1, 1, 1, 2, 1, 1, 1**, all real
`ERR_ASSERTION` failures, no runtime-only credit. All variants discover30 tests
and exit1. Five additional dependency-substitution checks are work-order tests,
not silently included in the1472 product-test total.

## Reproduce privately

```sh
node work-orders/repository-host-history-v1/verify.mjs
node work-orders/repository-host-history-v1/verify-post-admission.mjs e74aa40389a1c132ec535c77a90b0e56a61b91aa20126b48546b5942091d5418
node work-orders/repository-host-history-v1/verify-real-host-history.mjs .build/repository-host-history-verification-HzMJM7/verification.json
```

For fresh acceptance, give the third command the first command's emitted receipt
path. Scripts create only new owned evidence directories. Target/control/mutants
are bounded20 seconds, product check120 seconds, fresh-process reopens15 seconds.
Timeouts and missing terminal evidence are not acceptance. The explicit source hash
for the post-admission check must identify a separately reviewed revision.

## Interface and meaning

The existing actual repository host exposes `historyPreview()` and
`captureHistory({owner, declaration, clock})`. It privately publishes only after
owner settlement. No raw source, paths, diagnostic message strings or invocation
history are copied. See [full private contract](CONTRACT.md) for exact fields.
Candidate absence remains null/false with a reserved `none:<runId>` storage marker;
that is not an evaluated candidate. Operational FAILED is not a model-failure label.

The same current journal owner stores the observation. No legacy caller or format
is replaced; the original reportStored flag, report/proposal/state and immutable
result identity remain unchanged. Each host admits at most one record attempt;
known failed/refused writes consume it too. Unexpected post-admission outcomes
are explicitly uncertain and never trigger an automatic retry.

> [!WARNING]
> **Declarations and hashes do not authenticate consent or correctness.** A
> trusted host supplies the declaration; hashes identify metadata, not who approved
> it. No source/execution attestation or learning authority is granted, and hashed
> identifiers are not anonymous. This prevents history storage being presented as
> proof that code is correct or that learning/publication has been approved.

> [!CAUTION]
> **This is not automatic native-app history or incident admission.** Portable
> tests use synthetic execution adapters; the disk proof uses owned temporary data.
> No live history changed and no new Swift/app launch occurred. UI approval collection, additive types,
> package inclusion, separate native acceptance and native incident eligibility
> remain open. NX-05 is not closed by a stored operational observation.

Next integration should expose this exact API through a bounded host-facing approval
flow, with additive types and independent refusal tests, before native acceptance
and evaluated prevention. Keep all detailed code/design/evidence private.
