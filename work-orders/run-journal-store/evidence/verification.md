# Verification — baseline migration and run-journal disk store v1

2026-09-13. Astra owns authoring/integration/acceptance; OpenCode was the only
writer of the work-order implementation target during each packet run. No
product source was changed for these tasks.

## Task 1

Added tests/run-journal-baseline.test.mjs (2 tests) and
tests/native-probe-summary-baseline.test.mjs (1 test). The original product
assertions are unchanged; adjusted module/source paths and gave the journal
export assertion a standalone test wrapper. Original work-order baselines and
product modules remain byte-identical. Product package metadata assertions were
not transplanted. Luna confirmed counts and paths.

`npm run check`: exit 0; 1163/1163 PASS (1160 + 3), no failed/cancelled/skipped/todo;
8137.418375 ms. Structural PASS: 8/8 mutations caught, 8/8 allowed cases, no source
findings. Addendum with hashes appended to
docs/verification/2026-09-13/five-work-order-integration/closing-corrections.md.

## Task 2 contract and preparation

Synchronous writeSerializedJournal({path,serialized,fs,expectedPreviousSha256})
and readSerializedJournal({path,fs}), using injected node:fs-compatible sync
methods. Raw UTF-8 canonical journal JSONL, exact framing/hash-chain/footer
validation, exclusive same-directory temp + rename, short-write completion,
file/directory fsync attempts with recorded result/error, byte readback before
and after rename, SHA-256 and byte count. Truncation/data errors return REFUSED
without a partial serialized result. Different existing content requires the
matching prior checksum and is rechecked immediately before replacement.

READ, UNCHANGED and all REFUSED results carry durable:false. WRITTEN only carries
durable:true after both syncs, closes and final readback succeed. Post-rename
readback refusal carries committed:true. Only owned temp files are cleaned.

Sixteen protected store tests and two baseline tests were authored first. Claude
Fable 5.1 supplied a bounded design review. Daybreak identified five test issues
that Astra corrected BEFORE first execution: discriminating rehashed broken
chains, at-most-once close fault simulation, readback exceptions, close/read
ordering and framing markers. All test/package bytes stayed frozen throughout
both local executions. Initial placeholder: baseline 2/2, store 0/16. Both
prelaunch packet-lint runs passed; final source syntax and whitespace checks pass.

## Actual route and retained receipts

Both runs used CHAMI_PACKET_TIER=local ~/bin/packet-run on the same packet,
resolved as lmstudio/qwen/qwen3.8-27b. Response metadata reports that model/provider.
This is retained client/provider metadata, not independent served-model
authentication. No extra Bionic loads were performed.

First run: 904.678 s total; 900 s edit timeout, zero source writes, exact placeholder
retained. Receipt table verbatim:

| item | status | accept exit | note |
|------|--------|-------------|------|
| P1 | FAILED | 1 |   } |
Packet acceptance: exit 0
Files changed: (not reported)

After reading the blocked receipt, Astra authored a concrete implementation
reference and tested it against byte-identical copies of the protected oracle:
16/16 store + 2/2 baselines. Daybreak reviewed the source. One recommendation
about the optional cleanupError field was adjudicated nonblocking: it records a
close or unlink error, including primary close, rather than specifically an
unlink failure. The precise finding and rationale are retained separately.

Second/final local run: 622.019 s total, exact reference installed through one
OpenCode write; terminal receipt table verbatim:

| item | status | accept exit | note |
|------|--------|-------------|------|
| P1 | DONE | 0 |  |
Packet acceptance: exit 0
Files changed: (not reported)

PC fallback was not run because the second local attempt completed DONE. This
was an Astra-authored reference installed by OpenCode; do not attribute its
algorithm authorship to Qwen or claim a three-minute execution. First-attempt
uncompleted generation usage is unknown, not zero. A separate collaborator's
Fable review attempt lost session capture; no review/model/usage claim relies
on that attempt. The successful root Claude design artifact is retained.

## Owner acceptance of actual installed source

Astra read the complete installed module and verified byte equality to the
reviewed reference, SHA-256 fa1817d924471cbf6307f9583c5f513f6e6aa97eee61ce8445f9addc13c1163a.
Fresh owner `npm run test:store`: exit 0, 16/16, 175.699333 ms.
Fresh owner `npm test`: exit 0, 2/2, 35.992541 ms.
No failed/cancelled/skipped/todo tests in either command. `node --check`: exit 0.

Additional owner compatibility probe: the product createRunJournal serialized
three observations with two retained; store write/read preserved bytes, product
reopen returned COMPLETE, all observations remained historical/non-authorizing.
Both write fsyncs were observed successful (write durable:true); the read
correctly remained durable:false. This is same-process compatibility only.

Exactly one physical note was added under product U02-04 after store acceptance.
Removing that note reproduces the immediately preceding roadmap hash, recorded
in product-roadmap-note.json. The work-order roadmap records the accepted scope.

## Not claimed and next decision

No host integration, concurrent CAS lock, hostile-directory defense, full journal
semantic admission, power-loss/reboot/fresh-process recovery test, Windows-native
filesystem acceptance, crash qualification, incident admission, U02-04/NX-05
closure, commit or push. No work in native-canary-summary or brand canvas.

Louis must decide the next product/host integration slice, who owns writer
serialization or locking there, and the native crash/durability acceptance
protocol before expanding this isolated checkpoint into a product claim.

## SHA-256 of principal delivered files

- `tests/run-journal-baseline.test.mjs`: `17a8de142999f7ebdbe164336d81ce5c0a7ef27b00e105ff7bf7a1113ea37e7f`
- `tests/native-probe-summary-baseline.test.mjs`: `28756bd6d730045e0bb12c9d5de04ed79523ba33b319ef3dfe593a56856e71ed`
- `docs/verification/2026-09-13/five-work-order-integration/closing-corrections.md`: `7fc529af34663cc0be89301df78bd3e42118d94bf8ca7f4399217e2eed49b4f1`
- `work-orders/run-journal-store/src/run-journal-store-v1.mjs`: `fa1817d924471cbf6307f9583c5f513f6e6aa97eee61ce8445f9addc13c1163a`
- `work-orders/run-journal-store/tests/run-journal-store.test.mjs`: `7190d7d212f8c2012b8978057e6a5e2314ff2bbeee29e69a377ff9bdc36e4834`
- `work-orders/run-journal-store/tests/baseline.test.mjs`: `f20367b8eaec8ccb58736fb36eaee393b55c8d89c21a104c6d3161f6787d8f76`
- `work-orders/run-journal-store/package.json`: `42bed7239d3e46cf5f4952e03bd2295d63d3af1368c34f8b285ae77937c42e94`
- `work-orders/run-journal-store/.packets/nisi-run-journal-store-v1.packet.md`: `bd6ca91746d79384d06f779ff436f6cce95ac2d17ed7d54374f3efa054b556e2`
- `work-orders/run-journal-store/.packets/nisi-run-journal-store-v1.result.md`: `2fddff3475a56282bab1532d3268e8778ce16a1e6dd84d1b148195fc3707cbc7`
- `work-orders/run-journal-store/roadmap.md`: `b7557960fe757fdfa53f1003ae3f4df667ad4c9c466e0bd0cce7eb6366ecf33e`

2026-09-13 post-fix bookkeeping follow-up (Astra): the retained pre-fix hashes and 16-test count above are historical and superseded by these current hashes: `work-orders/run-journal-store/evidence/protected-sha256.json` `41dbd70cfd777e1c55c97fc469aa8eba06a3558203aab30b5a4e430c78b24b60` → `1a4d6ff43fe7b06d86fba965f8a1dcefa604279867f3260296bb60a823c59733`; `work-orders/run-journal-store/roadmap.md` `b7557960fe757fdfa53f1003ae3f4df667ad4c9c466e0bd0cce7eb6366ecf33e` → `6f227ea1dc7089f734681cf447d8b414e7ccf40dce9f6b7fd7d2b7d891dc0a32`; `work-orders/run-journal-store/src/run-journal-store-v1.mjs` `fa1817d924471cbf6307f9583c5f513f6e6aa97eee61ce8445f9addc13c1163a` → `1356028b65f9f8b96e3b9ec8ba3bfbb4968092af53d00e8b5dfdb11b161f4792`; `work-orders/run-journal-store/tests/run-journal-store.test.mjs` `7190d7d212f8c2012b8978057e6a5e2314ff2bbeee29e69a377ff9bdc36e4834` → `304909a7275e04fd1af8d38a5ec16a21027e415c4cb6c4422d86dc8ec246969a`. Triggering cross-review added to the manifest: `work-orders/run-journal-store/evidence/claude-crossreview-via-astra-20260913-1515.md`, SHA-256 `0d28770c87a2e4bb844147cd10abbd587183f92fba4464332f1278dbaf3014f4`. Fresh `node --test tests/run-journal-store.test.mjs` from `work-orders/run-journal-store`: exit 0, **17/17 PASS**, fail/cancelled/skipped/todo all 0, duration 162.692417 ms. The source, tests, protected-hash file and work-order roadmap were already fixed and are unchanged in this bookkeeping pass; no new product, host, durability, native or milestone acceptance is claimed.
