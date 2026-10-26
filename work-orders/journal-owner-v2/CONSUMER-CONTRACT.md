# First fixed-XPC observation history consumer — owner adjudication

Private engineering only. Overall Nisi 30% (3/10); not native or NX-05 acceptance.

New canonical file: history/import-fixed-xpc-observation-v1.mjs.
One exported function, importFixedXpcObservation(request).
Exact eight own enumerable data keys: owner,serializedRecord,projectId,candidateId,
receiptId,createdAt,ttlMs,now. Plain/null-prototype envelope; reject getters, symbols,
hidden/extra/missing fields without invoking getters. Proxy traps remain outside the
trusted-object guarantee. now must be safe integer >=0, not -0, before inspecting.

Order: envelope/now -> inspect existing owner -> phase -> projector -> record once.
inspectJournalOwner EXISTS in the reviewed source. Inspection is a non-authoritative
precheck, not a lock or disk read. Honor the actual record result independently.
No implicit open, retries, clock, filesystem import, native launch, child or network.

Return exact frozen object:
{schemaVersion:'nisi-fixed-xpc-history-import/v1',status,reason,recordAttempted,
 projection,journal,meaning:'HISTORY_OBSERVATIONS_ONLY',authorizing:false}.
RecordAttempted means the record API was called, NOT that storage was attempted.
No new durability, verification, execution or permission flags.

Projection output is a small frozen summary, NOT the pre-journal full entry:
- null before projection;
- actual frozen projector refusal when projection refuses (currently INVALID_INPUT);
- {status:'ENTRY',entryId:entry.id,state:entry.state,authorizing:false} otherwise.
The unchanged full entry goes directly to record. Only its journal-returned redacted
form may be exposed, so stricter host-configured journal redaction is not undone by
echoing the original projected payload.

Journal output is null if record was not called, otherwise its exact frozen result.
Envelope/invalid owner -> REFUSED INVALID_INPUT, attempted false, projection null.
SEALED -> REFUSED OWNER_SEALED, attempted false, projection null.
COMMIT_UNCERTAIN precheck -> REFUSED COMMIT_UNCERTAIN, attempted false, projection null.
Projector refusal -> REFUSED original reason, attempted false, journal null.

Record mappings (reason copied verbatim, or null):
- RECORDED -> IMPORTED; store durability preserved, including false.
- DUPLICATE -> DUPLICATE; not a fresh write.
- CONFLICT or STORE_CONFLICT -> CONFLICT; journal.status preserves which kind.
- REFUSED -> REFUSED; includes reentrant OWNER_BUSY, no retry.
- STORE_FAILED with snapshot.state COMMIT_UNCERTAIN -> UNCERTAIN.
- other STORE_FAILED -> STORE_FAILED.
Dependencies are direct trusted imports, not arbitrary injected result callbacks.
An unknown status must not become IMPORTED: conservative INTERNAL_RESULT refusal,
recordAttempted true, original result retained. Tests use actual implementations,
not made-up dependency response stubs.

An adverse structurally valid source record may be IMPORTED with entry state FAILED.
This says its observation was persisted; it does not say the underlying run passed.
Fresh explicit open is the only reconciliation after postcommit uncertainty.

## Claude review adjudication

Retained tool-disabled Opus 5 conceptual review: evidence/opus-consumer-response.json,
74.222s, tool-reported USD0.1598875. No source access or executed tests were claimed.
Accepted: precheck non-authority, recordAttempted distinction, explicit UNCERTAIN,
preserve complete journal diagnostics, no retry, no implicit open.
Corrected: inspect API does exist; projector refuses INVALID_INPUT, not INVALID_RECORD;
pre-rename failure is NOT postcommit uncertainty; a real postrename verify/read fault
is needed. Byte equality is inappropriate for failed committed writes. Request proxy
traps are outside guarantee. Added host-redaction-safe projection summary after root
review. The conceptual review is not source/test acceptance.

## Acceptance scope

Malformed exact envelopes and no getter calls; forged handle; invalid now;
sealed owner before projection; valid imported identity and immutable summary;
adverse FAILED observation not promoted; duplicate with no extra fs IO; entry conflict;
stale disk digest conflict preserving previous snapshot; precommit write failure;
postcommit read fault -> UNCERTAIN/cleared owner and fresh-open recovery; subsequent
call on uncertain owner refused before projection; missing fsync accepted nondurably;
malformed/old source refusal before write; stricter configured redaction not leaked.
No native launches, real credentials, background service changes or publication.
