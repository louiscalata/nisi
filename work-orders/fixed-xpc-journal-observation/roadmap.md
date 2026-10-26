# Fixed XPC journal observation — private work order

**Overall Nisi progress: 30% — 3/10 NX milestones closed.**
**This bounded implementation: 27/27 checks passed; canonical relocation verified.**
These are scoped results, not a new closed product milestone or native acceptance.

## Purpose

Turn the current fixed XPC runner's serialized result into a bounded, journal-compatible
observation. The older five-canary receipt is a different format and is not silently
reused. The [contract](CONTRACT.md) owns the exact input, refusal and output rules.

```text
Actual fixed-run result JSON, supplied by the caller
  → enforce size, depth, exact schema and run/case bindings
  → recompute captured stream digests and parse complete protocol bytes
  → check lifecycle, expected case outcome and supplied postconditions
  → SUCCEEDED or FAILED observation, or INVALID_INPUT refusal
  → authorizing: false; no persistence or execution permission
```

An expected malformed-request or no-reply case can produce a successful *observation*.
That never means generated code succeeded. Source manifest hashes are structurally
checked, not independently verified against disk; supplied process and postcondition
data do not prove service identity, termination or isolation.

## Completed work and evidence

- [x] Obtain a bounded, tool-disabled Opus 5 contract critique and adjudicate it.
- [x] Have Daybreak prepare independent fixtures/oracles from the actual runner.
- [x] Correct two fixture defects before implementing; retain the original evidence.
- [x] Confirm the corrected oracle rejects the placeholder: 0/20 passed.
- [x] Implement the pure projector and five additional owner boundary tests.
- [x] Verify 27/27 checks, with no skipped, cancelled or todo tests.
- [x] Catch all six targeted mutant variants; preserve each variant and test output.
- [x] Reproject three retained runner records without launching native code.
- [x] Obtain Daybreak's scoped source review: no remaining findings at the reviewed hash.
- [x] Execute the five-file OpenCode relocation packet and wait for terminal completion.
- [x] Correct OpenCode's five missing final LF bytes; independently verify exact copies.
- [x] Run the product suite: 1257/1257 passed; 218 selected files unchanged during it.

The immediately preceding product run was 1230/1230. All 213 files pinned by that
run remained unchanged; the relocation adds five files and 27 checks. Frozen
protocol/journal dependencies exactly match their canonical counterparts.

Reviewed origin SHA-256:
`dda78a29edbe8952ac97960a572496ebc18f6be6117bb06e38880dc19e95bca1`.
Canonical projector SHA-256 after the declared import relocation:
`00cc7a0a0e6331777889979ebd9c6353fc06bf83781e3d9687918180a71a3ba2`.

Evidence directory: [private receipts](../../.build/xpc-history-projection-h918xQ/).
Key records: [exact copy accounting](../../.build/xpc-history-projection-h918xQ/canonical-copy-accounting.json),
[post-integration suite](../../.build/xpc-history-projection-h918xQ/product-post-integration.json),
[mutants](../../.build/xpc-history-projection-h918xQ/mutants.json),
[retained record projections](../../.build/xpc-history-projection-h918xQ/retained-record-projections.json).
The actual OpenCode route was `free/opencode/big-pickle`; its diagnostic establishes
terminal process completion, not authenticated model identity or measured token savings.

## Remaining product work

- [ ] Resolve the four separate host-journal correctness findings on Claude's owner lane.
- [ ] Design and verify explicit runner/store wiring, preserving observation-only semantics.
- [ ] Complete separately authorized native and full host acceptance.

> [!WARNING]
> **The green suite does not clear the four host-journal findings.** The affected
> canonical and work-order source still share hash `97b2554b7fe50812fcb0065197964967d2beefc0c8cb322a38154ec16ebb9894`.
>
> **Why this matters:** integration records and passing existing tests do not
> invalidate reproduced stale-state, cross-project, UTF-8 or mutable-authority defects.

Everything remains private. No new native execution, signing, installation,
authentication changes, commits, pushes or publication occurred for this slice.
