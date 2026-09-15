Private bounded source review, tool-disabled: no repository, browsing, or execute.
Review the exact SOURCE pasted after this brief. Return PASS/FAIL with at most four
concrete issues, not scope expansions. The independent 32-group oracle passed
locally, but you did not run it. Root will run further boundary tests and mutants.

Contract is an async PRIVATE host wrapper that reads ONE explicitly selected,
operator-trusted static local POSIX source through an existing audited disk reader
and sends text to a separate one-use history permit. It does not authenticate user
consent, guarantee hostile-tree containment/hard I/O timeout, or write native FI0.
No raw source paths/text/error messages/signal.reason returned. Abort during I/O
waits for that same read to finish; preserve closed reader failure even on cancel.
Abort before/during permitcreation=>CANCELLED; inside captureclock=>actual
PERMIT_REVOKED; afterrecordadmission=>actual write outcome, never masked CANCELLED.
Unknown wrapper throw after capture starts=>UNCERTAIN; keep any obtained capture.
Sourcecopy/digest preserve originalrootspelling; pure path check is the existing
createRepositorySnapshot export (verified available). Source selection7keys,
outeroutput12keys including sourceFailure. Shape/metadata immutable and no retry.

Existing pinned dependencies, not source-reviewed here:
- createRepositorySnapshot({files:[{path,content}]}) validates exact bounded ASCII
  relative path grammar, returns frozen .files with path/content/byteLength/sha256,
  .fingerprint; 1MiB file limit. No I/O.
- captureRepositoryFromDisk({root,paths,profile}) validates and reads using
  O_NOFOLLOW/NONBLOCK, rejects symlinks/hardlinks/crossdevice, compares stat identity,
  strictUTF8roundtrip, confirms close before return. Returns frozen {snapshot,capture};
  capture schemaVersion1,profile,rootFingerprint,snapshotFingerprint,files(metadata),
  fingerprint,statusCAPTURED_TRUSTED_STATIC_INPUT,handlesClosedtrue,atomicSnapshotfalse,
  executionStatusNOT_RUN,authorizingfalse. Throws known RepositoryCaptureError or
  pre-validation RepositorySnapshotError; both public classes carry closed code.
- createFixedXpcHistoryPermit exact {owner,declaration,clock}: private declaration
  copy inclsourceSHA and times, realownerWeakMap; returns CREATED/REFUSED and digest.
- revokeFixedXpcHistoryPermit({permit}) idempotently revokes, no throw for realhandles.
- captureFixedXpcHistory synchronous: rechecks liveclock/revocation, exactsourceSHA,
  validatesprojector, checksclock/revocationagain, consumes BEFORErecord; freezes
  originalowneroutcome. Current statuses IMPORTED/DUPLICATE/CONFLICT/REFUSED/
  STORE_FAILED/UNCERTAIN. No raw projection. Actual store can be committed/durable.
  Its currentTime catch handles explicit revoke+throw precedence correctly.
Hostproxies/clocks/FS are trustedcode, not maliciousprocess sandbox. Signal instance
overrides are explicitly handled; native getter/EventTargetmethods required.
