Confidential bounded contract critique; tool-disabled, no repository or browsing.
Use only this supplied contract. No authenticated-consent, incident-learning or
execution claims may be inferred. Return at most four concrete problems and
recommended fixes, plus a compact implementation outline. The contract will be
pasted below by the bounded local caller. Existing imported functions are trusted
already-reviewed frozen APIs, not source-reviewed by you here:
- inspectJournalOwner({owner}) gives REFUSED or SNAPSHOT with state OPEN, SEALED,
  COMMIT_UNCERTAIN. Actual handles are private WeakMap empty frozen objects.
- fixedXpcJournalObservation gives REFUSED INVALID_INPUT or deeply frozen ENTRY;
  hashes original bytes, carries execution/authority false, no raw source text.
- recordJournalObservation performs project checks/redaction/TTL/CAS, returns
  original frozen RECORDED/DUPLICATE/CONFLICT/REFUSED/STORE_CONFLICT/STORE_FAILED.
  A STORE_FAILED after rename has COMMIT_UNCERTAIN with cleared rows/hash; a
  precommit failure preserves the old snapshot. No automatic retry or locks.
Scope preference: small single-use written-admission wrapper with explicit
admission-before-write revocation boundary, not a new filesystem/auth subsystem.
