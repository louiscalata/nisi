# Opus contract review — owner adjudication

Private. September 14, 2026 UTC. No product integration or release acceptance.

Actual tool-disabled Opus review: `opus-contract-review.json`; requested `opus`,
reported `claude-opus-5` plus Haiku auxiliary usage. 99.6 seconds total wall time,
reported $0.2331445. No Fable participation in this review. Source inspection and
adjudication by Codex; model recommendations are not authority.

1. **Time and precedence — accepted with source-based precision.** The frozen
   journal persists header `now`, but exposes no public watermark accessor.
   Opening compares that validated field before list(now). A later record below
   the accepted memory clock keeps the journal's TIME refusal. Sealed listing is
   display-only and may prune expired payloads, never recovered evidence IDs.
2. **Store-entry boundary — accepted.** Use a structural storeEntered flag,
   prepare a success snapshot before IO, and seal uncertainty before constructing
   a result. Unknown store outcomes cannot be treated as rollback. Dependency
   responses receive shape/outcome consistency checks.
3. **Config persistence — concern checked, conditional removal rejected.** The
   actual pinned journal serializes all four config fields and preserves ordered
   redactPaths. Compare those validated canonical header configs. Project mismatch
   precedes other config mismatch even for a damaged but header-valid prefix.
4. **Copying — accepted; silent dropping/conversion rejected.** Actual frozen
   dependencies return plain JSON-like data. Deep-copy then freeze. Unexpected
   Buffers/functions/accessors are errors, not evidence to drop or reinterpret.
   DUPLICATE returns the unchanged current owner snapshot, not an entry snapshot.
5. **NEW and UNCHANGED — clarified, blanket conflict mapping rejected.** The
   store verifies predecessor bytes before identical-byte handling. Identical
   first writes may be UNCHANGED. Different writes conflict. Other precommit
   failures remain STORE_FAILED; their causes must not be mislabeled conflicts.

Remaining limits: synchronous trusted filesystem seam, no cross-process lock or
power-loss guarantee, no proof of execution from historical observations, no claim
that passing owner tests resolves every NX-05 requirement or existing v1 caller.
