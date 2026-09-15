Private bounded SOURCE review of a small history-admission module. Tool-disabled:
no file access, browsing or test execution. Review only the supplied source and
contract. Maximum FOUR concrete defects, each with evidence and smallest fix.
Do not invent authenticated consent, commit-time cancellation, filesystem-source
acquisition, background deletion or native incident features outside this slice.

The original contract critique is adjudicated: exact response/currentness reasons
are now pinned. Projector returns deeply frozen plain data; owner accepts arbitrary
plain payload objects and clones then redacts them. A fresh entry/payload copy can
legitimately add payload.historyCapture WITHOUT changing imported API envelopes.
Owner itself checks project/config/time, stores via its private CAS digest, and
publishes COMMIT_UNCERTAIN after observed postrename failure. Both old APIs remain
unchanged. Any actual record invocation consumes the permit, even a refusal; this
is intentional, no retry. Revoke means future admissions disabled, never erasure.

Known APIs (not part of source review): inspectJournalOwner({owner}) is REFUSED or
SNAPSHOT with state OPEN/SEALED/COMMIT_UNCERTAIN; real handles are WeakMap protected.
fixedXpcJournalObservation is ENTRY+frozenentry or REFUSED/INVALID_INPUT/false only.
recordJournalObservation returns frozen RECORDED, DUPLICATE, CONFLICT, REFUSED,
STORE_CONFLICT, STORE_FAILED. STORE_FAILED contains snapshot and store with actual
committed/durable flags; uncertain owner clears rows/hash and will refuse reuse.
Injected clocks, proxies, owner FS are trusted host callbacks, but reentry from
clock/FS is tested. Only source SHA binds exact bytes, not process authenticity.
31 independent tests pass locally; you may NOT claim to have run them. Check the
source for actual implementation defects, including unexpected outcome handling.
