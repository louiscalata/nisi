# C07 — private admission and evidence-binding correction

**Status: isolated correction; not integrated or accepted.** Finish-packet
acceptance remains **60%**; NX v0.2 acceptance remains **30%**. The objective
still includes real native qualification and the remaining finish packets.

## Verified before state

Owner run `checks-KNvt6H/checks.json` executed the frozen draft after source
inspection. The original source-plan suites pass **31/31**, the new identity
accessor passes **2/2**, but C07 passes only **33/41**, with **8 failures**.
There were no skips, cancellations, TODOs, or timeouts. Candidate and canonical
source hashes remained unchanged. This is actual Node execution, not native
Swift execution or model inference.

## Findings that invalidate the prior source-review PASS

Root traced these defects; the existing Daybreak reviewer independently
confirmed them in a bounded follow-up. `daybreak-review-third.json` is retained
as historical evidence, not deleted or reclassified into a successful test.

1. The private source input has no `selection` property; every genuine admission
   refused with `SOURCE_PLAN_PAYLOAD_INVALID`.
2. Original receipt and expectation fingerprints were read at the wrong nesting
   level, which would make a terminal record contain unsupported undefined data.
3. The test receipt helper received an incident source plan instead of the
   original issued Swift check plan, causing `SWIFT_PLAN_NOT_ISSUED`.
4. The expectation-Proxy test placed its override in an ignored helper argument.
5. Binding checked expiry but not a clock earlier than admission.

Owner follow-through also identified incomplete row-versus-expectation binding,
unbound report bytes, paired request-hash substitution, and an unused validated
report snapshot. These are being corrected together, not hidden by loosening
the positive assertions.

Final Daybreak review then identified a P2 digest-alias inconsistency: the wrapper
and returned handle shared consumption state but were hashed as different
admissions. The correction stores the canonical returned-handle digest in that
private state. A new regression compares both entry points and both consumed
aliases; the new `alias-digest` mutation must be detected before finalization.

## Correction contract

- Read the existing privately issued source-input body; do not alter v1 source
  shapes or hash domains to repair a mistaken consumer.
- Compare row-level identities at their real locations, plus the exact original
  issued expectation fingerprint and executor identity.
- Compare validated report snapshots only. Require the original request hash,
  fixed outcome inventory and a consistent aggregate status.
- For a present report, require bounded caller-supplied `rawObservation` with
  `stdoutHex` and `stderrHex`; verify each stream's captured bytes/hash and parse
  the framed stdout through the existing canonical JSON reader. Its report must
  equal the validated report snapshot. Matching bytes still do not authenticate
  execution.
- Compare outcome IDs/statuses; explanatory wording may change without changing
  the classified outcome. Keep digest-only original/fresh records separate.
- Consume the handle before adverse evidence or reversed-clock checks. An
  earlier-than-admission timestamp refuses rather than reviving permission.
- Wire the additive identity tests into the frozen C07 command through an
  oracle import; do not modify frozen package scripts or omit new tests.
- Keep `freshEvidenceOrigin: CALLER_SUPPLIED`, `nativeRerun: NOT_RUN`, and every
  execution, learning, persistence and publication authority false.

## Actual correction evidence

| Run | C07 | Existing source tests | Identity accessor | Result |
| --- | ---: | ---: | ---: | --- |
| `checks-KNvt6H` | 33/41 | 31/31 | 2/2 | Original draft: eight failures |
| `checks-o3AP1u` | 38/47 | 31/31 | 2/2 | Returned handle was copied by `cloneFreeze` but the pre-copy object was registered |
| `checks-puqb9x` | 47/47 | 31/31 | 2/2 | Returned handle and wrapper now share the actual private issued state |
| `checks-tiB8mi` | **53/53** | **31/31** | **2/2** | Expanded identity, raw-evidence, profile and adverse regression coverage |
| `checks-LrT9D5` | **54/54** | **31/31** | **2/2** | Final canonical alias-digest correction and regression |

All runs are retained. The final run has no failures/skips/cancellations/TODOs,
and the candidate, canonical tree and staged dependencies remained unchanged.
The two identity cases are included in C07 through an oracle import; the
separate identity run repeats them, so these counts must not be summed.

The preceding `mutations-80aHL4/checks.json` catches five deliberate defects: handle reuse,
reversed-clock acceptance, skipped stream-hash binding, paired request-hash
substitution and grant executable mismatch. Each produces assertion failures;
both unchanged controls pass22/22. No mutated code was applied to the candidate
or canonical tree. This is test discrimination, not a product benchmark.

Final `mutations-aHt2co/checks.json` adds the canonical alias-digest defect and
catches all **six** mutants. Both unchanged controls pass **23/23**; all mutants
fail actual assertions without skipped, cancelled or TODO tests. Mutated stage
source was restored and all four candidate hashes remain unchanged.

Final `nisi-validation-AKuzou/receipt.json` records actual four-file Nisi contract and
JavaScript syntax VALIDATED. Candidate fingerprint:
`e69730ebd50d7845cf5eaf154ba06255584fb0e79e308471a843c95ba06c6392`.
`reviewBindingMatches:false` correctly distinguishes deterministic validation
from independent source review; no inference occurred.

`daybreak-source-review-final.json` binds the exact four-file revision and the
real independent review response: no remaining P1/P2 finding in scope. The
reviewer did not execute tests; served model identity remains UNKNOWN.

## Integration continuity

The C07 accessor changes a dependency pinned by C06:
`hosts/repository/native-incident-source-v1.mjs`, historically
`ab08ed666126011f3e57f7d3975dce8602a1d570f81c8c544f1c58a2f0616a26`.
Integration must bind that exact predecessor to the new hash through an
explicit one-dependency supersession and rerun C06 compatibility checks.
Do not edit C06's immutable evidence or its old dependency-map digest simply
to make it pass. A bounded independent Luna planning review confirmed this
approach; it did not implement or approve the future acceptance guard.

## Remaining work

- [x] Execute and retain the failing pre-correction candidate.
- [x] Complete the coherent isolated source/oracle correction.
- [x] Run actual C07 and source compatibility checks; retain all failures.
- [x] Run actual Nisi deterministic contract/syntax validation.
- [x] Obtain independent exact-revision review after changes settle.
- [x] Amend the owner packet scope and add discriminating acceptance controls.
- [x] Integrate with explicit dependency-evidence supersession, then reverify.
- [ ] Conduct the separately authorized real native acceptance session.

## Canonical integration checkpoint — September 20, 2026

C07 is now accepted only as `CALLER_SUPPLIED_NATIVE_INCIDENT_EVIDENCE_NODE_ONLY`.
The single changed source dependency participates in **C04, C05 and C06** live
checks, not only C06. The first expanded control run (`controls-SgNBpk`) found
eight real failures in the predecessor fixtures/gates. The correction validates
complete C07 evidence before allowing the exact old-to-new source transition;
all historical acceptance rows, source maps and receipts remain unchanged.

- Canonical receipt `canonical-MybG74/checks.json`: C07 **54/54**, C06 **52/52**,
  C05 **111/111**, journal compatibility **80/80**; five source files and97
  dependencies unchanged.
- Final post-ledger receipt `controls-fHpNaX/checks.json`: C07 controls **31/31**,
  C06 controls **25/25**, baseline **117/117**, C01 **112/112**. The disabled
  guard gives **4/31 pass,27 expected assertion failures**. No skips,
  cancellations or TODOs. Suites overlap and must not be summed.
- Actual seven-file Nisi contract/syntax validation passes. This performs no
  inference and does not replace independent exact-source review.
- `daybreak-control-review-final.json` retains the independent control review;
  reviewer-executed tests are false and actual served-model identity is UNKNOWN.
- Live inventory and held C07 dispatch are retained in the post-ledger receipt:
  finish packets **70% (7/10)**, overall NX **30% (3/10)**, native acceptance
  false, dispatch approvals empty; C07 repeat dispatch is HELD with exit2.

The explicit owner ledger grants the scoped integration acceptance, not this
report. No OpenCode dispatch, provider inference, authentication, native
execution, push or publication was performed or authorized by this report.
