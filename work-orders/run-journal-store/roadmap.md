# Run-journal disk store v1 roadmap

Canonical roadmap for this isolated U02-04 work order. Astra authors the protected
tests and packet; OpenCode is the sole implementation writer while running.

- [x] Inspect the product journal framing and establish the raw UTF-8 storage contract.
- [x] Obtain bounded Claude Fable 5.1 design review; pin statuses, checksums, same-content behavior and failure outcomes.
- [x] Author 16 protected store tests, two baseline tests, private ESM package and source placeholder.
- [x] Verify green baseline (2/2) and discriminating failing store tests (0/16); apply Daybreak pre-implementation findings, freeze hashes and lint (exit 0).
- [x] Execute the authorized local packet, inspect source and independently test: final local rerun DONE; owner store 16/16 and baseline 2/2 PASS.
- [x] Record receipt, elapsed route, source/test hashes and review findings in evidence/verification.md and evidence/SHA256SUMS.

This store preserves raw canonical journal JSONL, verifies framing/hash chain and
footer, writes through an exclusive same-directory temp, reads back exact bytes,
and only reports durable=true after successful file and directory fsync. READ
and UNCHANGED always carry durable=false. Checksums detect corruption; they do
not authenticate data. Full journal entry/retention/relationship validation stays
with the existing journal reopen contract; this module does not duplicate it.

Caller owns a trusted directory and serializes writers. The destination is
rechecked before rename; this is not a multi-process compare-and-swap lock or a
defense against hostile directory mutation. No parent directories are created.
No host integration, reboot/power-loss test, capacity policy, incident admission,
Windows filesystem acceptance, fresh-process recovery or U02-04 closure is claimed.

## Accepted isolated checkpoint — 2026-09-13

First local attempt: 904.678 seconds, edit timeout, unchanged placeholder, receipt
BLOCKED/P1 FAILED. Astra then authored and reviewed an exact source reference;
unchanged test/package copies passed 16/16 + 2/2 before handoff. The corrected
packet installed that reference on the same local route in 622.019 seconds:
DONE/P1 DONE, packet acceptance exit 0. PC fallback not used.

Astra read the actual installed source and independently reran store 16/16 and
baseline 2/2, both exit 0 with no skipped/cancelled/todo tests; final syntax check
passed. Installed source and reviewed reference match SHA-256
`fa1817d924471cbf6307f9583c5f513f6e6aa97eee61ce8445f9addc13c1163a`.
Protected tests/package stayed unchanged across both packet executions.

An additional same-process compatibility probe used the real product serializer,
stored/reloaded its three observations (two retained), and reopened COMPLETE
with exact bytes, historical=true and authorizing=false. This is compatibility
evidence; it does not integrate the store into a host.

Claude Fable 5.1 supplied design corrections; Daybreak Blue reviewed and improved
the tests before their freeze, then reviewed the exact source. One diagnostic
naming recommendation was retained as nonblocking: optional cleanupError means
a close or unlink reported an error, including a primary close. It does not
mean unlink specifically failed. Source-review details and Astra's adjudication
are in evidence/daybreak-source-review.md. No broader durability or milestone
acceptance is implied. Louis must decide the product/host integration slice and
its writer-ownership and native crash/durability acceptance protocol.
2026-09-13 post-review fix (Astra): directory close failure no longer overwrites the earlier directory fsync error; both codes recorded in order. Source fa1817d924471cbf6307f9583c5f513f6e6aa97eee61ce8445f9addc13c1163a → 1356028b65f9f8b96e3b9ec8ba3bfbb4968092af53d00e8b5dfdb11b161f4792; protected tests 7190d7d212f8c2012b8978057e6a5e2314ff2bbeee29e69a377ff9bdc36e4834 → 304909a7275e04fd1af8d38a5ec16a21027e415c4cb6c4422d86dc8ec246969a (16 → 17 tests; 17/17 and baseline 2/2 rerun by Astra and independently by Claude).

2026-09-13 — integrated (Astra; Louis “Autointegrate”, 2026-09-13 Claude session): `history/run-journal-store-v1.mjs` copied byte-for-byte, SHA256 `1356028b65f9f8b96e3b9ec8ba3bfbb4968092af53d00e8b5dfdb11b161f4792`; 19/19 migrated tests (17 functional + 2 baseline), product check 1230/1230 with zero failed/skipped/cancelled/todo, TypeScript PASS and PRIVATE_PACKAGE_FILES 27. Not closed: host wiring of the bundle to the XPC runner, real-filesystem durability, cross-process locking, crash qualification, or incident admission. Progress stays 30% — 3 of 10; no milestone closure. Receipt: `../../docs/verification/2026-09-13/evidence-chain-integration/receipt.json`.
