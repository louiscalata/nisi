One defect survived source rereading and an independent reproduction.

1. **Medium — directory-close failure erases earlier fsync failure evidence.**  
   Location: [src/run-journal-store-v1.mjs:165](/Users/louiscalata/nisi-next-private/work-orders/run-journal-store/src/run-journal-store-v1.mjs:165).

   Contract violated: “Failure records error.code if a nonempty string, otherwise a nonempty fallback such as FSYNC_FAILED.” Also: “No swallowed sync evidence.” These requirements appear in the [original behavioral packet](/Users/louiscalata/nisi-next-private/work-orders/run-journal-store/evidence/run-01.packet.md:54).

   **Reproduction:** Pass a valid empty journal from `createRunJournal(...).serialize()` to `writeSerializedJournal`, using an in-memory injected filesystem at a virtual `/tmp` path. Let writing, file fsync, file close, temp verification, destination recheck and rename succeed. Make directory `fsyncSync` throw an ordinary `Error` with `code:"EFSYNC"`, then make directory `closeSync` throw with `code:"ECLOSE"`. Let final read-back succeed.

   Observed result, showing relevant fields:

   ```js
   {
     status: "WRITTEN",
     verified: true,
     committed: true,
     durable: false,
     fsync: { file: true, directory: false },
     fsyncErrors: { file: null, directory: "ECLOSE" },
     cleanupError: "ECLOSE"
   }
   ```

   `syncFile` initially records `"EFSYNC"`, but line 165 overwrites it. The returned result loses that failure evidence.

   **Refutation attempted:** The contract explicitly treats directory-close failures as directory-sync failures, so recording `"ECLOSE"` is required. However, that does not resolve the separate “No swallowed sync evidence” requirement. I ran fsync-only, close-only and combined-failure controls: fsync-only preserves `"EFSYNC"`; the combined result is identical to close-only and contains no evidence of the earlier fsync failure. Both failures need to remain observable.

   **Impact:** Diagnostic evidence loss on a combined failure path. Exact-byte verification and the conservative `durable:false` result remain correct.

**Verdict: ACCEPT_WITH_DEFECTS for the DRAFT as an isolated work-order module.** This is not product acceptance.

Checked and found sound:

- **Protected checks:** Independently ran `npm test` — **2/2 passed** — and `npm run test:store` — **16/16 passed**. Both exited 0, with no failures, skips, cancellations or todos.
- **Contract and operation order:** Walked write steps 1–10 and the read operation. Additional probes passed **9 destination/expected-hash decisions, 11 write-progress cases, 3 destination-presence/content rechecks and 3 read-result cases**. Checked result key sets, hashes, byte counts, verification/commit flags, stage reasons, deterministic temp naming, `wx`/`0o600`, short-write completion, close-before-rename, both read-backs and conservative durability.
- **Framing:** **72 variants exercised through both read and write**, plus separate invalid-UTF-8 and zero-entry footer-hash probes, passed. Used real `createRunJournal` → `append` → `serialize` output, including an empty journal and two entries with one retained. Checked duplicate/reordered keys, alternate escaping, missing newline, blank lines, trailing garbage, exact framing keys/types, hash constants, contiguous sequence numbers and footer linkage. Framing-valid content outside product entry semantics remained accepted, as contracted.
- **Faults and cleanup:** **17 individual injected-fault cases** returned the required outcomes without escaping exceptions. Descriptor references clear before close; failed closes are not retried; cleanup targets only the owned temp and records failures; directory descriptors close at most once. Post-rename read failure returns `REFUSED / READBACK_MISMATCH`, `committed:true`, `durable:false`. The combined directory failure above is the surviving exception to correct error accounting.
- **Purity:** Exactly the two synchronous exports; imports limited to `node:crypto`’s `createHash` and `node:path`; filesystem operations use the injected object; no ambient filesystem, clock or randomness.

No project files were written. Additional probes used in-memory filesystems; the permitted test suites used temporary directories.