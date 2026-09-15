# Private source and contract adjudication

Opus5 coauthored the contract in87.843s, reported USD0.2004205 including Haiku
auxiliary. Tools disabled; no source inspection or tests independently performed.

Root adopted additive real-host preview/capture, cached deterministic metadata,
candidate absence namespace and immediate one-attempt storage without a grant API.
Corrections to the supplied proposal and model response:

- inspectJournalOwner returns SNAPSHOT, not root prompt's mistaken INSPECTED.
  Daybreak found this against actual source; implementation/tests use SNAPSHOT.
- Set busy BEFORE either trusted clock callback. Model's late busy setting allows
  reentrant admission; consumed is set BEFORE entering record, not after it returns.
- Every actual record call consumes, even REFUSED. Read-only inspection is not a
  second record/write attempt. Wrong-project refusal is necessarily post-admission
  because private owner config is not exposed; do not invent a preflight check.
- Reject oversized/unknown stage metadata rather than clamping counts. Actual
  engine stage vocabulary includes REPAIRED/NO_CHANGE as well as adapter statuses.
- No derived candidate PASS verdict or confident root-cause attribution. Keep
  final engine outcome, host/owner state and all attestation/learning flags separate.
- Hash ALL diagnostic code text, not an invented comprehensive engine allowlist.
  This keeps arbitrary adapter strings out without discarding operational failures.
- `none:<runId>` explicitly means no candidate, with payload null/false; `cand:`
  identifies actual fingerprints. It must not be consumed as an evaluated candidate.
- Preserve actual journal result; do not add a loosely derived durable-success
  boolean or rewrite engine reportStored, which describes a different stage.

## Exact-source review finding and corrected contract

The first full helper/host review returned FAIL in60.901s, reported USD0.2807415
including Haiku. It identified REFUSED INTERNAL_ERROR after record throws or
unexpected results. The frozen contract explicitly prescribed that classification
with attempted/consumed true, so the reviewer overstated a literal contract breach.
Codex accepted the safer semantic change, not that inaccurate attribution:
unexpected outcomes after admission now report UNCERTAIN INTERNAL_ERROR, retaining
attempted/consumed true and journal:null. Known outcomes stay exact; STORE_FAILED
requires a known snapshot state. Missing state must not imply definite failure.
The existing recordAttempted flag is the admission marker; no new flag or production
dependency injection API is needed. Untrusted malformed results are not echoed.

Daybreak's dependency-substitution oracle was read before running. Codex added
explicit journal:null/authorizing assertions, exact test counters/error-code accounting,
before/after source checks and an explicit expected-source-hash parameter before
either run. The same five test definitions then produced:

- Old helper e72b514e…: **0/5 pass, five ERR_ASSERTION**, receipt
  `../../../.build/repository-host-history-post-admission-Cv2zGH/verification.json`.
- Corrected helper e74aa403…: **5/5 pass**, receipt
  `../../../.build/repository-host-history-post-admission-IH78TN/verification.json`.

These inject a throwing dependency, null/unknown result, missing snapshot and
missing state. They establish wrapper behavior, not an observed production disk
failure. A second Opus review of the exact changed capture excerpt and correction
returned PASS/no issues in25.171s, reported USD0.089105 including Haiku. The original
FAIL remains retained. All three Claude calls total USD0.570267; broader development
cost and savings are unknown.

## Final acceptance and verification corrections

Codex reviewed and ran the final verifier; only the independently reviewed helper
pin changed from e72b514e… to e74aa403… after the correction. Host6b53aa8d… and
oracle4defe306… were unchanged. Canonical30/30, relocated30/30, eight semantic
mutants caught by1,1,1,1,2,1,1,1 actual ERR_ASSERTION failures; full1472/1472.
All242 selected pins remained exact during verification;239 of240 prior pins
remain unchanged, with the deliberately rewired host the sole prior change.

Luna supplied the real-filesystem proof draft. Codex corrected canonical-data
comparison so null-object versus plain persistence prototypes do not create a
false failure, and retained the fresh-child reopen result in the receipt. Two real
temporary journals then stored/synced/reopened candidate-less and quarantined
candidate-present observations with exact source/declaration/entry identities.
No native execution is implied: these workflow execution adapters are synthetic.

No live journal changed and no new Swift/app launch occurred. Daybreak/Luna were bounded
collaborators; no new Windows/OpenCode request or held Fable route retry occurred.
