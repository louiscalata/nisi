Private bounded design critique. Tool-disabled; no repository/browsing/execute.
Review the supplied new contract using these source-grounded API facts. Max4
concrete issues plus small implementation outline. Do not invent a new low-level
reader or add authority beyond the declared trusted-static input boundary.

captureRepositoryFromDisk({root,paths,profile}) async, actual POSIX fs/promises;
validates exact descriptor data, source path grammar; stat and read <=1MiB files
through O_NOFOLLOW|O_NONBLOCK; compare dev/ino/mode/nlink/size/mtime/ctime and final
tree metadata; strict UTF8 byte roundtrip, reject NUL, close all handles before
return. Returned {snapshot,capture} is frozen; snapshot.files[].content actualtext;
capture.{profile,rootFingerprint,snapshotFingerprint,fingerprint,handlesClosed,
atomicSnapshot:false,executionStatus:'NOT_RUN',authorizing:false}. Trusted static
local operator precondition, not hostile race containment or OS I/O deadline.

createFixedXpcHistoryPermit({owner,declaration,clock}) validates exact declaration,
recognizes real opaque owner, checks live monotonic clock, stores copied declaration
privately. Returns CREATED+empty frozen permit+declarationDigest or REFUSED/reason.
captureFixedXpcHistory({permit,serializedRecord}) synchronous, source hash + 1MiB
limit + projector + finalclock, consumes immediately before record call; returns
frozen {status,reason,recordAttempted,declarationDigest,journal,meaning,authorizing}.
Revoke stops future admissions, cannot undo already-admitted writes. Postrename
owner failure yields UNCERTAIN, actual committed diagnostic and cleared snapshot.
No raw source or full pre-redaction projection returned. Auth flags false.

We will send the complete contract next through stdin. No real filesystem source
or user data is included in this review. The implementation will reuse both APIs.
