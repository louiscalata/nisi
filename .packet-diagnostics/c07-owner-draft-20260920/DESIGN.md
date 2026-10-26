# C07 isolated owner draft — native incident readiness/evidence binding

Status: **ISOLATED CORRECTION; NOT INTEGRATED, DISPATCHED, OR ACCEPTED**.
The original candidate was executed in `checks-KNvt6H` and failed eight C07
assertions. `REVIEW.md` records the defects and the current correction contract;
the earlier source-review PASS is insufficient for acceptance.

This folder proposes one new private module, an additive issued-identity
accessor and their integration oracles. It does
not change source-plan issuance, the Swift executor, incident capture/storage,
journals, retention, learning, scheduler state, permissions, or native
execution. The candidate is written against the existing exports below and is
intended to be staged only after owner review.

## Exact readset and exports

The proposed module is
`hosts/repository/native-incident-admission-v1.mjs`. Its only imported product
contracts are:

- `workflow/contracts.mjs`: `cloneFreeze`, `stableStringify`, `sha256Text`.
- `integrity/record-utils.mjs`: `exact` grammar.
- `hosts/repository/native-incident-source-v1.mjs`:
  `isIssuedNativeIncidentSourcePlanV1` and
  `readNativeIncidentSourceInputV1`, plus additive
  `readNativeIncidentExecutionIdentityV1`.
- `receipts/repository-execution-v1.mjs`: `readExecutionReceipt`.

It exports exactly:

- `admitNativeIncidentRerunV1({ plan, grant, host, now })`
- `bindNativeIncidentRerunV1({ admission, fresh, now })`
- `isIssuedNativeIncidentAdmissionV1(value)`

The source-plan module remains the issuance authority. The admission module
keeps a separate private `WeakMap` for its single-use in-memory handle. No
handle, grant, plan payload, raw source, path, or fresh receipt is persisted.

## Normalized input grammar and check order

All top-level and nested records are own-enumerable data-only records with
exact key sets, plain or null prototypes, no accessors, no proxies, and no
extra symbols/non-enumerables. Invalid top-level shape is rejected before any
value is read. Time is a safe non-negative integer and `-0` is refused.

Admission checks, first failure wins:

`INVALID_INPUT` → `INVALID_CLOCK` → `SOURCE_PLAN_NOT_ISSUED` →
`SOURCE_EXECUTION_IDENTITY_UNAVAILABLE` →
`GRANT_SCHEMA`/`GRANT_MISMATCH`/`GRANT_SCOPE` → `GRANT_REVOKED` →
`GRANT_NOT_YET_VALID` → `GRANT_EXPIRED` → `HOST_SCHEMA`/`HOST_FUTURE`/
`HOST_STALE`/`TRANSPORTS_PENDING`/`HOST_NOT_IDLE` →
`GRANT_EXECUTION_PROFILE_MISMATCH`/`GRANT_EXECUTABLE_MISMATCH`.

Grant keys are exactly:
`schemaVersion, grantId, sourcePlanDigest, inputSha256, rowId,
previewSha256, executionProfileSha256, executableSha256, issuedAt, expiresAt, revoked, scope,
rawContentPersisted, networkEgress, learningInfluence`.
The source-plan and selection digests remain byte-compatible with v1. The
additive private execution-identity accessor derives
`executionProfileSha256` from the already-issued expectation binding and
retains its exact `executableSha256`; the grant must match both at admission.
If the accessor does not recognize the exact issued plan,
`SOURCE_EXECUTION_IDENTITY_UNAVAILABLE` is returned rather than copying a
caller hash. The window is
`expiresAt > issuedAt`, at most one hour. Scope is exactly
`NATIVE_RERUN_ORIGINAL_SNAPSHOT_ONLY`; the three side-effect flags are false.

Host keys are exactly `state, pendingTransports, observedAtMs`, with the
existing IDLE/BUSY/QUARANTINED/OFF/TIMEOUT/CANCELLED vocabulary. Stale means
`now - observedAtMs >= 5000`; a future observation yields `HOST_FUTURE`; pending transports yield
`DRAIN_UNCONFIRMED` only for OFF/TIMEOUT/CANCELLED and refusal otherwise.

An admitted output is a frozen
`nisi-native-incident-admission/v1` record with exact keys:
`schemaVersion,status,reason,checks,sourcePlanDigest,grantDigest,admission,
nativeRerun,executionVerified,learningEligible,persistable,authorizing,
executionGranted`. Admission is a decision only: `nativeRerun:'NOT_RUN'`,
`executionVerified:false`, `learningEligible:false`, `persistable:false`,
`authorizing:false`, and `executionGranted:false` are constant.

Binding checks time and handle issuance, then consumes the handle before
inspecting fresh evidence, including rejecting a time before admission. It
reads the real frozen private source-input body, not a nonexistent nested
selection. It first performs a descriptor-only, proxy-first
snapshot of the complete receipt graph (top-level, binding, process, outputs,
stdout, stderr, and result), then passes only that inert snapshot to the
existing `readExecutionReceipt`; it does not implement a second receipt parser.
It binds original run, attempt,
task/candidate/baseline/preparation/materialized identities, static-check
stage/check identity, profile, executable, artifact, and request fingerprints.
Reservation reconciliation, owner quarantine, cancellation, unknown drain,
receipt errors, and missing native reports remain adverse outcomes.
For a present report, bounded raw stdout/stderr hex must match receipt stream
hashes/lengths; the canonical JSON decoded from framed stdout must match the
validated report snapshot and the original request identity. The fixed three
outcome IDs and aggregate status are enforced. Outcome comparison uses IDs and
statuses, while exact explanatory text remains represented in transcript hashes.

The normalized rerun output has exact keys:
`schemaVersion,status,reason,sourcePlanDigest,admissionDigest,original,fresh,
evidenceDistinct,rawContentIncluded,persistable,freshEvidenceOrigin,nativeRerun,
nativeExecutionAttested,executionVerified,learningEligible,authorizing`.
`original` and `fresh` are distinct digest-only records; neither contains raw
content, source path, stdout, prior outcomes, or executable details.

Status classification after identity validation is fixed:

| Condition | Status | Reason |
| --- | --- | --- |
| cancellation requested | `INTERRUPTED` | `RERUN_CANCELLED` |
| unknown drain or receipt `INCONCLUSIVE` | `INCONCLUSIVE` | `DRAIN_UNCONFIRMED` |
| receipt `ERROR` or no native report | `ERROR` | explicit process error or `NO_NATIVE_REPORT` |
| report `FAIL` and outcome identities equal | `MATCHED` | `null` |
| report present but PASS or outcome identities differ | `DIVERGED` | `OUTCOMES_DIFFER` |

This isolated caller-supplied fixture lane always reports
`freshEvidenceOrigin:'CALLER_SUPPLIED'`, `nativeRerun:'NOT_RUN'` and `nativeExecutionAttested:false`, including
MATCHED/DIVERGED. `rawObservation` presence is not provenance. A future
operator-exclusive owner may supply separately approved real execution proof;
this seam never upgrades caller data into native proof.

## Required oracle cases

The companion test preserves the real issued source-plan fixture and exercises:

1. exact issued plan + matching synthetic FAIL → MATCHED with NOT_RUN;
2. cloned, serialized, spread, refusal-envelope, and public-hash plans;
3. wrong run/task/candidate/artifact/profile/executable identities;
4. grant mismatch, scope, revocation, not-yet-valid, expiry, and one-hour cap;
5. stale, busy, quarantined, and pending-transport host observations;
6. pre-aborted/cancelled, unknown-drain, receipt-error, missing-report, and
   reservation-reconciliation adverse outcomes;
7. single-use, expiry-before-bind, copied-handle, and malformed-fresh refusal;
8. exact normalized output keys, no raw path/content, and every authority flag
   false; and
9. no journal/store/retention/learning writes and no executor construction.

All tests remain synthetic/offline. Passing them cannot close the native lane,
NX-05, or product acceptance.
