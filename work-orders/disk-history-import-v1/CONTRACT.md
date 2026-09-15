# Private disk-to-history import contract

Overall Nisi **30% (3/10 NX milestones)**. This is real host integration toward
NX-05/U02-04, not native incident admission, authenticated consent or release.

## Reuse rather than weaken

Use the current `hosts/repository/disk-capture.mjs` and
`history/history-capture-permit-v1.mjs` unchanged. Disk capture supports POSIX
operator-trusted-static-local-v1 files <=1MiB, no symlinks below its root, no
hardlinks/cross-device files, opened-file identity and byte-count/UTF-8 checks,
close confirmation and best-effort static-tree drift detection. It explicitly
does not prove hostile-tree containment, absence of concurrent writers, local
mount type or a hard I/O deadline. Do not claim otherwise or silently follow links.

## Public host API

New `hosts/history/import-fixed-xpc-from-disk-v1.mjs` exports exactly:

`importFixedXpcHistoryFromDisk({owner, declaration, source, clock, signal})`

Async function. All five request keys required, own enumerable data keys on a
plain/null-prototype object. `clock` callable; `signal` null or actual AbortSignal
(use native aborted getter and EventTarget methods, not caller overrides).
No arbitrary provider/read callback; the real pinned reader is the only reader.

`source` exact plain data fields:

- schemaVersion `nisi-history-source-selection/v1`
- consentClass `WRITTEN_DECLARATION`
- root: same bounded absolute-root grammar as the retained reader
- relativePath: exact single path accepted by createRepositorySnapshot
- profile: `operator-trusted-static-local-v1`
- rawContentPersisted:false, networkEgress:false

Source selection is an explicit trusted-host assertion for one file; not proof
that a person approved it. Validate and copy it BEFORE any clock or filesystem
call. No default folder, traversal, discovery or fallback scope. Compute
sourceSelectionDigest = SHA256(`nisi-history-source-selection/v1\n` + sorted-key
canonical JSON of the validated source). Copy retains the originally supplied
root string; the reader handles canonical OS aliases above it. Never echo the
root/path or serialize the raw source into the returned result.

`declaration` is the existing exact fixed-XPC history declaration. Pass it to
createFixedXpcHistoryPermit before reading any source bytes; its private copy
binds owner, expected bytes, project/candidate/receipt, time and retention. Do not
reuse the Apple-model content consent, which expressly forbids persistence.

## Sequence and cancellation

1. Exact request/signal/callable clock or REFUSED INVALID_INPUT.
2. Exact source selection/path/profile or REFUSED INVALID_SOURCE_SELECTION.
3. Already aborted signal -> CANCELLED ABORTED, no permit/clock/file/record.
4. Register the native abort listener. Create the existing permit; preserve its
   refusal reason if it fails. Always remove listener in finally.
5. Recheck aborted immediately after creation; abort during creation/clock means
   revoke the recognized permit, then CANCELLED ABORTED without a file read.
6. Call captureRepositoryFromDisk ONCE for the copied root + exactly one path.
   sourceReadAttempted=true immediately before calling it. Cancellation during
   asynchronous file I/O revokes the permit; it does not kill/undo the OS read.
   Await that same operation to completion/cleanup; no race/timeout-created retry.
7. After read or read-error, if aborted, CANCELLED ABORTED. Otherwise map reader
   failures to REFUSED using an explicit allowlist of its closed codes; unexpected
   throw -> REFUSED SOURCE_CAPTURE_FAILED. Never expose error message/path/reason.
8. Successful reader returns the expected single-file snapshot. Derive a small
   frozen sourceEvidence object from its fingerprints and actual captured bytes.
9. Call captureFixedXpcHistory ONCE with private permit and captured content;
   captureAttempted=true immediately before the call. That API rechecks clock and
   exact bytes and consumes before the journal record operation. Preserve its
   actual immutable capture result and outer status/reason, including failure,
   duplicate, refusal, conflict and uncertainty. Do not override an actual admitted
   write with CANCELLED merely because abort arrives from inside the record call.
10. Always revoke the permit on exit, including failed reads and pre-record refusal;
    it is internal to this one invocation and may not leak or auto-retry.

If abort occurs inside the permit's pre-record clock, its exact PERMIT_REVOKED
refusal is preserved (captureAttempted true). If abort occurs after record
admission, preserve its actual write result. No promise of commit-time cancellation.
Sticky cancellation uses the native `signal.aborted`, not a synthetic dispatched
abort event or an overridden instance property. Signal.reason is never read.

## Exact output

Every result has exactly:

schemaVersion `nisi-disk-fixed-xpc-history-import/v1`, status, reason,
sourceReadAttempted, captureAttempted, sourceSelectionDigest, declarationDigest,
sourceEvidence, sourceFailure, capture, meaning `HISTORY_OBSERVATIONS_ONLY`, authorizing:false.

Unknown/malformed request or source -> both digests null. Valid source gives its
digest even when already aborted; declarationDigest only after CREATED permit.
sourceEvidence only after successful reader completion and no observed abort:

```
{profile:'operator-trusted-static-local-v1',
 rootFingerprint, snapshotFingerprint, captureFingerprint,
 sourceSha256, sourceBytes,
 handlesClosed:true, atomicSnapshot:false,
 sourceAuthenticityAttested:false, executionAttested:false, authorizing:false}
```

It contains no absolute/relative file path, file contents or unredacted projection.
capture is the original existing permit capture result, null before capture call.
No new caller-visible permit. All returned objects recursively frozen. The retained
APIs already return frozen values; trusted proxy/clock/FS callbacks are not an
adversarial process isolation boundary. Unexpected errors before capture return
REFUSED INTERNAL_ERROR. Unexpected throw during capture invocation is UNCERTAIN
INTERNAL_ERROR (capture:null), because side effects cannot safely be ruled out.
If a real capture result was obtained before a later wrapper error, preserve it
on UNCERTAIN INTERNAL_ERROR rather than discarding the only write-outcome evidence.

## Acceptance

Independent filesystem/owner tests before implementation and a finite red run.
Actual temp-file read -> journal write -> fresh-process reopen; source unchanged.
Malformed selection, links, directory, >1MiB, invalid UTF-8, mismatched digest,
malformed source record, already-abort, abort during await, abort during clock,
post-admission abort, source/decl mutation during await, no raw data leak,
one-read/no retry, conflict, duplicate, uncertainty. Use targeted mutants.
Native windows unsupported is an explicit outcome, not a skipped acceptance.
No native app, models, installs, publication, existing code edits or live stores.

## Pre-oracle clarification: reader failures and precedence

sourceFailure is always null except after an actual reader exception, when it is
the closed mapped code. Preserve it even if cancellation wins the outer status;
in particular CANCELLED must not hide DISK_CAPTURE_CLOSE_UNCONFIRMED. No raw
system error, path, or AbortSignal.reason may be retained.

Known RepositoryCaptureError codes map unchanged into reason/sourceFailure:
DISK_CAPTURE_INPUT_SCHEMA, DISK_CAPTURE_PROFILE_REQUIRED, DISK_CAPTURE_ROOT_INVALID,
DISK_CAPTURE_PATHS_SCHEMA, DISK_CAPTURE_PATH_COUNT, DISK_CAPTURE_SYMLINK,
DISK_CAPTURE_DIRECTORY_REQUIRED, DISK_CAPTURE_REGULAR_FILE_REQUIRED,
DISK_CAPTURE_HARDLINK, DISK_CAPTURE_FILE_LIMIT, DISK_CAPTURE_CHANGED,
DISK_CAPTURE_UTF8_INVALID, DISK_CAPTURE_BINARY_UNSUPPORTED,
DISK_CAPTURE_BYTE_ROUNDTRIP, DISK_CAPTURE_CLOSE_UNCONFIRMED,
DISK_CAPTURE_PLATFORM_UNSUPPORTED, DISK_CAPTURE_CROSS_DEVICE,
DISK_CAPTURE_TOTAL_LIMIT, DISK_CAPTURE_IO_ERROR.

Known RepositorySnapshotError codes, if they escape the retained reader, also map
unchanged: REPOSITORY_SNAPSHOT_SCHEMA, REPOSITORY_FILES_SCHEMA,
REPOSITORY_FILES_LIMIT, REPOSITORY_FILE_SCHEMA, REPOSITORY_PATH_INVALID,
REPOSITORY_CONTENT_LIMIT, REPOSITORY_CONTENT_UNICODE, REPOSITORY_PATH_COLLISION,
REPOSITORY_PATH_CASE_COLLISION, REPOSITORY_PATH_PREFIX_COLLISION,
REPOSITORY_TOTAL_LIMIT. Source selection's own pre-validation failures instead
map INVALID_SOURCE_SELECTION before I/O. Unknown class/code -> SOURCE_CAPTURE_FAILED.

After create returns: retain handle/digest only when CREATED, then recheck abort
before publishing any create refusal. An abort during the trusted clock therefore
returns CANCELLED even if that same create returns REFUSED. Always revoke any
created permit and remove listener. A synthetic abort event whose native aborted
state is false does nothing and must not consume the actual abort listener.

Successful reader shape must bind its one file path, bytes/hash and capture's
snapshotFingerprint to the supplied snapshot, and its profile/closed outcome flags
must match the retained contract. Contradictory result -> REFUSED
SOURCE_CAPTURE_INVALID, no captureAttempted; sourceFailure remains null (not a
thrown read failure). No data is handed to the journal before these checks.
