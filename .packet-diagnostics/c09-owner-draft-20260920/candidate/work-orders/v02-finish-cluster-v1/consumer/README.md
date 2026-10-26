# C09 — private package evidence matrix (owner correction candidate)

Private isolated advisory reader. It performs no process, filesystem, install,
network, inference, runtime selection, or acceptance action. The original goal
remains independent Node22 and Node24 rehearsals for the same archive. A missing
approved Node22 executable remains `NOT_RUN/RUNTIME_NOT_INSTALLED`; synthetic
fixtures cannot close that row.

The public matrix accepts retained receipt text only (maximum 4 MiB). Parsed
objects may be inspected with `readRehearsalRecord`, but cannot earn `PASS`.
Each text row retains SHA-256 and UTF-8 byte length. The closed expected input
requires `sourceManifest`, `stageManifest`, `caseManifest`, exact `toolchain`,
73 unique owner-pinned `negativeLocations`, inclusive `notBefore`/`notAfter`,
and exactly `node22`/`node24` owner observations. Missing proof is non-PASS.

The reader binds the real writer contract: 29 package files, 12 consumer cases
(8 TypeScript and 4 runtime), exactly 35 checks (pack, inventory, 29 decoded
UTF-8 extraction checks, install, positive TS, negative TS, runtime), exact
cwd/executable/argv/order/compiler flags/case order, clean termination, and
the writer's observed status. Tar inventory and each extraction stdout hash are
checked; this does not pretend to reconstruct arbitrary binary bytes. Owner
capture must separately bind receipt bytes, archive bytes, Node identity, child
PID/times, commands, cwd, and capture timestamps.

Negative diagnostics are re-derived as file+line pairs: all 73 expected
locations must appear, no unexpected location or duplicate substitution passes.
TAP must have one unambiguous plan/summary with exactly 11 tests and 11 passes,
zero fail/cancel/skip/TODO. Resource limits are enforced before processing:
arrays 128, object/map keys 64, strings 8192 UTF-8 bytes, stdout 2 MiB,
stderr 256 KiB, diagnostic matches 512, receipt text 4 MiB. Proxies (including
revoked), accessors, foreign prototypes, sparse arrays, symbols, unknown fields,
and malformed values are rejected without invoking caller traps.

Output always states `authorizing:false`, `executionAttested:false`,
`sourceAuthenticityAttested:false`, and scope
`CALLER_SUPPLIED_REHEARSAL_EVIDENCE_ONLY`. N6 receipt-hash and N25 null-TAP
guards remain explicit without false mutation-kill credit. B10 has direct
source/archive manifest accessor regressions in the named oracle.

No C09 acceptance is claimed until real owner-captured Node22 and Node24
receipts, independent review, and required controls are complete.
