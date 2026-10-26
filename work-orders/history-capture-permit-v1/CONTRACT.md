# Private history-capture permit v1

Overall Nisi: **30% (3/10 NX milestones)**. This is a bounded host-admission
component, not NX-05 completion or a native incident adapter.

## Objective and boundary

Permit one exact retained fixed-XPC record to be projected and offered to the
existing opaque journal owner under a separate written persistence declaration.
Do not reuse the Apple-model content consent, which explicitly forbids storage.
Do not write to the retained native incident ledger: its current adapter accepts
only native deterministic assist failures with model participation NOT_RUN.

The declaration is a trusted host's written assertion, NOT authenticated user
consent, an OS permission, a protected signature, or durable execution provenance.
This module performs no source-file reading, native launch, model call, or network
request. Source binding means SHA-256 of the exact supplied UTF-8 bytes, not proof
that those bytes came from a trusted process. The host remains responsible for
acquiring the declaration and selecting the owner and source.

## API and closed data

`createFixedXpcHistoryPermit({owner, declaration, clock})` returns CREATED with an
empty frozen opaque permit, declarationDigest, and false authorizing; or REFUSED.
clock is a trusted synchronous function returning nonnegative safe integer epoch
milliseconds. Validate own enumerable data properties only; reject getters,
symbols, extras, malformed scalars and forged owners before admitting work.

Declaration exact fields:

- schemaVersion: `nisi-fixed-xpc-history-declaration/v1`
- declarationId, projectId, candidateId, receiptId: 1–128 ASCII identifier syntax
  `[A-Za-z0-9][A-Za-z0-9_.:-]*`
- consentClass: `WRITTEN_DECLARATION`
- sourceSha256: 64 lowercase hexadecimal characters
- issuedAt, expiresAt: safe integer milliseconds; positive lifetime <= one hour
- createdAt: safe integer observation timestamp <= current time
- retentionMs: integer 1..7,776,000,000 (90 days); safe createdAt+retentionMs;
  observation must not already be expired at admission
- destination: `LOCAL_OBSERVATION_JOURNAL_ONLY`
- rawContentPersisted, networkEgress, learningInfluence: exactly false

Declaration digest = SHA-256 of domain `nisi-history-declaration/v1\n` plus
recursively key-sorted canonical JSON of the validated declaration. Copy and
freeze it privately. Owner binding is the actual existing opaque handle, not a
caller-writable owner ID. Clock must be live, monotonic within this permit and
never re-enable a revoked/expired/clock-invalid permit. Host clock/proxy/FS
callbacks are trusted, not an adversarial process sandbox.

`captureFixedXpcHistory({permit, serializedRecord})`: validate exact request,
claim private BUSY before calling the clock, validate currentness, then check
well-formed UTF-8 source <=1MiB and exact SHA-256. Use the existing fixed-XPC
projector with only declaration metadata. Add only this closed metadata to its
payload before the existing owner applies project binding and redaction:

```
historyCapture: {
  schemaVersion: 'nisi-history-capture-provenance/v1',
  declarationDigest,
  consentClass: 'WRITTEN_DECLARATION',
  consentAuthenticityAttested: false,
  sourceAuthenticityAttested: false,
  executionAttested: false
}
```

Check clock/currentness again immediately BEFORE the record call. Consume the
permit irreversibly when calling record, regardless of success, duplicate,
conflict or write failure; never retry inside this API. Pre-record malformed
source may be corrected with the same still-current permit. Expiration and
invalid/backward clock permanently invalidate it. Capture refusal must not
expose raw source, unredacted projection or caller exception text.

Return schemaVersion `nisi-fixed-xpc-history-capture/v1`, status, reason,
recordAttempted, declarationDigest (null before a recognized permit), journal
(original frozen owner result or null), meaning HISTORY_OBSERVATIONS_ONLY and
authorizing false. Map RECORDED=>IMPORTED, DUPLICATE=>DUPLICATE,
CONFLICT/STORE_CONFLICT=>CONFLICT, REFUSED=>REFUSED,
STORE_FAILED+COMMIT_UNCERTAIN snapshot=>UNCERTAIN, other STORE_FAILED=>STORE_FAILED.
Preserve FAILED observation state and the owner's actual commit/durability flags.

`revokeFixedXpcHistoryPermit({permit})`: exact envelope. Recognized permit gets
REVOKED (idempotent), unknown gets REFUSED. Revocation prevents a new record
admission, including reentrant revocation from the clock before admission.

IMPORTANT: synchronous admission is the linearization boundary, NOT rename or
durability. Revocation after record admission does not abort or undo that write.
Its actual outcome must still be returned. The consumed permit cannot be reused.
This does not revoke persisted rows, erase bytes, enforce background expiry,
refresh stale snapshots, or establish authenticated UI consent. TTL/redaction
remain the existing journal's logical retention behavior, not physical erasure.

## Acceptance

### Exact responses and precedence (owner clarification before tests)

Create AND revoke responses always have exactly schemaVersion
`nisi-fixed-xpc-history-permit/v1`, status, reason, permit, declarationDigest,
authorizing:false. CREATED has reason:null and the opaque handle; REVOKED has
reason:null and permit:null. REFUSED has permit:null. declarationDigest is null
for create refusals or unknown/malformed revoke; recognized revoke returns its
digest. Capture's previously listed keys are exact; reason is always present
(null on successful import/duplicate, otherwise the actual refusal/store reason).

Create precedence: exact request including callable clock -> INVALID_INPUT;
closed declaration -> INVALID_DECLARATION; unknown owner -> INVALID_OWNER;
SEALED -> OWNER_SEALED; COMMIT_UNCERTAIN -> COMMIT_UNCERTAIN; then clock/currentness.
Clock calls returning invalid time or throwing -> INVALID_CLOCK. A time before
issuedAt -> PERMIT_NOT_YET_VALID; time >= expiresAt -> PERMIT_EXPIRED;
time < createdAt -> OBSERVATION_IN_FUTURE; time >= createdAt+retentionMs ->
OBSERVATION_EXPIRED. Creation never exposes a handle on refusal.

Capture precedence: exact request -> INVALID_INPUT; unknown handle ->
INVALID_PERMIT; revoked -> PERMIT_REVOKED; consumed -> PERMIT_CONSUMED;
busy -> PERMIT_BUSY. Then claim busy, call clock and recheck revocation. An invalid
or backwards clock -> INVALID_CLOCK; permanently invalidate that permit so later
captures return PERMIT_REVOKED. Expired/invalid time similarly permanently revokes
after returning its first precise reason. Repeat clock/currentness after projection
and before record; time must not go backward between ANY observed calls.

Source must be a well-formed string <=1MiB or INVALID_SOURCE; digest mismatch ->
SOURCE_DIGEST_MISMATCH; projector refusal -> its actual INVALID_INPUT. Non-temporal
pre-record refusals leave permit available. Record admission sets consumed BEFORE
calling the owner. Synchronous post-admission revoke does not alter the actual
returned journal outcome; later capture returns PERMIT_REVOKED. Unexpected thrown
owner/projector errors -> INTERNAL_ERROR, never raw text; consumed if and only if
record admission was reached. Unknown owner result maps INTERNAL_RESULT (and
retains journal only when it is the documented frozen owner result).

Revoke malformed request -> INVALID_INPUT; unknown permit -> INVALID_PERMIT.
Recognized revoke always sets revoked=true (even busy/consumed) and returns REVOKED.
All scalar safe-time checks reject negative zero.

Independent tests before implementation; finite red baseline; positive and
negative exact schemas, source digest, no getters, no forged permits, owner
isolation, declaration copying, project mismatch, expiry/rollback, reentrancy,
pre-admission vs post-admission revocation, one-shot failure/duplicate behavior,
redaction, uncertain write and fresh reopen. Targeted mutants must be killed.
Recheck canonical selected-source pins; no edits to existing owner/projector,
native Swift adapter, user Claude copy or installed packages.
