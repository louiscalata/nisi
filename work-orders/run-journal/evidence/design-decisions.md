# Owner design decisions before execution

Claude review requested alias fable; metadata reports claude-fable-5-1 plus auxiliary claude-haiku-4-5-20251001. Valid review, one attempt, 106.601 seconds; reported total cost USD 0.41229825. Raw response retained. Luna provided additional read-only test/design review through Codex collaboration.

Adopted: payload-only retention with permanent identity metadata; domain-separated original-entry fingerprints; strict plain-data intake; redaction before exposure; explicit caller-time watermark; sequence and previous-hash chain; exact recovered prefix and strict post-footer handling.

Scope decisions: entries are immutable observation identities, not queue lifecycle owners. Fable's proposed follows/state-machine expansion is deferred to host integration; this module grants no work/issuance authority. Retry citations remain explicit and validated against terminal, expired or revoked observations. No stale-heartbeat auto-retry.

Rejected Fable's optional sealed-snapshot reserialization into an appendable successor: that could forget ids in the missing tail. A damaged reopened journal is permanently sealed, cannot serialize, and offers only historical prefix views. External reconciliation belongs to a later host owner.

The digest is an equality fingerprint, not authenticated evidence or cryptographic secret erasure; permanent digest/identity metadata and caller-disclosed ids may carry sensitive information. MaxEntries bounds payload count, not total metadata bytes. Existing product canonical/integrity/receipt formats remain unchanged and are not imported into this isolated package.
