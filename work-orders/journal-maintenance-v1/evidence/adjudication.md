# Private journal lifecycle adjudication

Opus 5 supplied conceptual coauthor review: 84.574s, reported USD0.1732935
including Haiku auxiliary usage. No source was independently executed by Claude.
Root read the complete returned design and checked its source-dependent claims.

- Adopted shared neutral commit outcome with separate unchanged record envelope
  and new maintenance envelope. Preserve private registry/busy state and quarantine.
- UNCHANGED is possible at identical watermark; the serialized header advances
  on later times. Backward time must refuse TIME, never silently ignore time.
- The current store already refuses a different existing file when no expected
  hash is supplied, and checks again before rename. Missing SHA does NOT mean an
  unconditional overwrite. Identical valid bytes may be accepted as UNCHANGED.
  No store change or claim of hostile multi-process compare-and-swap is warranted.
- `revokes` is top-level entry metadata, not payload. It remains after retention
  nulls payloads, and the revoked set is rebuilt on reopen. Add TTL-order/capacity
  tests rather than changing the already-compatible file format.
- REVOKED entries require revokes non-null and retryOf:null. Luna's initial
  wording that both references were required was corrected against entryOf.
- A coherent fsync failure is a verified but NON-DURABLE WRITTEN result under the
  current store. It is not automatically COMMIT_UNCERTAIN; malformed responses or
  committed readback failure are. Preserve that distinction in tests and types.
- Existing record output has no top-level meaning field; its snapshot does.
  Keep exact existing schemas rather than copying the model's approximate outline.
- Maintenance removes expired payloads from current serialized bytes, not every
  revoked payload immediately, older returned objects, backups or SSD remnants.
  Physical secure erasure and authenticated user revocation are not claimed.

Claude's user-owned working copy remains separate. Session mtime changed because
of a queue enqueue at 2026-09-14T01:36:00.727Z; no newer implementation end-turn was
observed. Queue activity is not completion. No session was resumed or interrupted.

## Oracle and type-contract corrections

Daybreak supplied29 lifecycle groups. Before running them, root replaced a vacuous
undefined-versus-undefined public-view fingerprint comparison with actual on-disk
fingerprints, and added three concrete guards: revocation expires before its live
target, capacity removal preserves revocation links, and same-watermark maintenance
still detects changed disk. Stub result:2/32 pass,30 fail; finite exit1 with zero
skip/cancel/todo. Two groups exercised already-existing record validation/replay.

Luna supplied additive types and a fixture with SEVEN negative sites, not the six
claimed in its harness. First type test run:1/2 pass; negative harness failed the
7-versus-6 marker count before invoking the negative compiler. Root corrected the
marker count, tightened REFUSED.store to null and required bounded-child error/signal
checks. Unsafe failed-store access legitimately yields two compiler diagnostics;
the expected total is eight on seven distinct exact fixture lines.

Existing baseline now intentionally allows the fourth maintenance export. The
store-boundary fixture pins the reviewed new owner b64e21ae… while every existing
behavior assertion and journal/store/memfs pin remains unchanged. Historical
work-order copies and their original pin receipts are untouched.

## Final verification and model attribution

Exact owner b64e21ae… received Opus5 PASS with no issues. This second call took
35.395s wall time and reported USD0.195999, including Haiku auxiliary usage.
The two Claude calls total USD0.3692925; this is reported call cost, not total
engineering cost or a savings benchmark. Fable's same-task credit failure and
OpenCode's previous confirmed local timeout were not blindly retried.

Root removed the verifier draft's predicted mutant failure counts before execution.
The first attempt (journal-maintenance-verification-RxaxbL) retained32/32 canonical
and relocated-control passes, then refused the first mutant because two failures
were runtime fixture errors. Inspection found11 genuine assertion failures plus
two ERR_INVALID_ARG_TYPE failures when intentionally skipped persistence left no
file for later setup. The verifier now records both categories exactly and requires
at least one actual assertion failure; runtime-only failures cannot kill a mutant.
No production source or target tests changed for this adjustment.

Daybreak independently reviewed the real-disk proof and found two verification
gaps: declared240 pins without checking map size, and replay status assertions
without checking actual disk bytes. Root added exact cardinality and byte equality
after EACH duplicate/conflict call, plus conflict.store:null. Daybreak re-reviewed
both corrected scripts, with no remaining scoped finding.

Final journal-maintenance-verification-qbLBtS:1442/1442 portable tests;32/32 focused;
32/32 relocated control. Six mutations have11,1,2,5,1,2 assertion failures; first
also has two separately excluded runtime errors. Zero skip/cancel/todo, all240
selected files unchanged. Exactly four prior files were deliberately revised;
all233 other prior pins remain exact. New target/type/harness files add three pins.

Real disk journal-maintenance-real-BTcSPr uses synthetic clock ticks100,110,120,1100,
not elapsed-clock benchmarking. Target/revocation writes and maintenance verify
file/directory fsync and readback. Two fresh Node processes reopen both identities,
logical revocation, expired payloads and byte-identical replay. A real rename then
injected readback refusal yields COMMIT_UNCERTAIN; only a new owner reconciles the
committed payload removal. This is not physical deletion, authentication, native
execution, crash/power-loss qualification, automated sweeping or release acceptance.

Luna's next-step caller inventory, checked by root search, found no non-test
old-history-bundle caller. Direct v2 host-run create/read calls are test-only;
production receipt layers reuse only its final-report reader. The reviewed
repository workflow has no journal-owner/import connection. Next-step wording
was corrected accordingly; do not call an unused compatibility adapter a live
migration or conflate parser reuse with history integration. No caller was changed.
