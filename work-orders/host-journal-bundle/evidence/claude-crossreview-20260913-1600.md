# Claude Opus 5 cross-review of src/host-journal-bundle.mjs — 2026-09-13 16:00 PDT

Adversarial workflow: 3 finder lenses → 2 independent refuters per candidate → synthesis. 22 agents, read-only static + memfs probes. Not host integration, durability, locking or milestone acceptance.

VERDICT: ACCEPT (as a work-order draft against the packet as written)

Module: /Users/louiscalata/nisi-next-private/work-orders/host-journal-bundle/src/host-journal-bundle.mjs (174 lines, Astra)
Contract: /Users/louiscalata/nisi-next-private/work-orders/host-journal-bundle/.packets/nisi-host-journal-bundle.packet.md (Claude)
Oracle: /Users/louiscalata/nisi-next-private/work-orders/host-journal-bundle/tests/bundle.test.mjs (Claude)
Re-run this pass: `npm test` 3/3 pass, `npm run test:bundle` 14/14 pass.

CONFIRMED DEFECTS: none. Eight candidates were raised; every one was refuted by two independent attempts. In each case the observed behaviour reproduced but the module was doing exactly what a quoted packet sentence prescribes, or the packet is silent and the candidate's "expected" outcome is itself outside the packet's enumerated results.

CHECKED AND SOUND (module line -> packet rule, confirmed by oracle and/or read-only memfs probe)
- :41-52 open-input validation: exact key set {path, fs, config, now}, six fs methods, safe non-negative integer `now`, `createRunJournal(config)` must not throw; every failure -> REFUSED/INVALID_INPUT; no throw.
- :54-58 read dispatch: NOT_FOUND -> recovery NEW; READ or INVALID_JOURNAL -> raw bytes decoded and handed to `reopen`; other refusals -> READ_FAILED. Opening never writes (fs event trace: readFileSync only).
- :76-86 projectId check gated to COMPLETE/INCOMPLETE with parsed header -> PROJECT_MISMATCH; INVALID header is INVALID, not a mismatch (packet 85-86).
- :98-116 result shape and key order; OPEN for NEW/COMPLETE, SEALED for INCOMPLETE/INVALID; sealed journal from `reopen` retained; `entries = journal.list(now)`; `interrupted` = RUNNING rows with liveness UNKNOWN, list order, id/runId/attempt/heartbeatAt/createdAt; sha256 null on the INVALID_JOURNAL path per packet 92-94.
- :114 private state (path, fs, config copy with cloned redactPaths, journal, lastGoodSerialized) in a WeakMap; no `config` key on the bundle; identity check at :128-129 rejects copies/proxies with INVALID_INPUT.
- :121-133 record-input validation and BUNDLE_SEALED before builder or journal are touched.
- :135-148 builder refusal / TypeError -> INVALID_INPUT with entryId; `append` throw with `.code` -> REFUSED with that reason (TIME confirmed for a clock behind the watermark); DUPLICATE and CONFLICT returned with store null and unchanged sha256/bytes; nothing written (oracle: "identical replay... touches nothing on disk").
- :154-164 serialize, `expectedPreviousSha256` only when `bundle.sha256` is a string, WRITTEN/UNCHANGED advance lastGoodSerialized, sha256, bytes, entries in place; durable:false surfaced, not hidden.
- :167-173 rollback: CONFLICT -> STORE_CONFLICT, other refusals -> STORE_FAILED; journal rebuilt from `reopen(lastGoodSerialized)` or fresh `createRunJournal(config)` for NEW; `bundle.journal` replaced; entries/sha256/bytes untouched; the same record on the same bundle repeats identically until reopen (oracle 204-263).
- Purity: imports only the three frozen siblings, no node: modules (oracle test 14).

REFUTED CANDIDATES (recorded, no action required on the module; each is a contract-scope note for the packet owner, Claude, if wanted)
1. :86 clock behind persisted watermark -> INVALID_INPUT rather than TIME. Packet never defines open's outcome when `list(now)` throws; TIME is not an enumerated open reason. Gap, not violation.
2. :76 foreign-project rows surfaced on a SEALED/INVALID bundle. Packet 85-86 forbids the projectId check on INVALID; packet 87-99 mandates the sealed journal's rows. Bundle is never adopted (no write, append -> SEALED).
3. :73 header config drift adopted from `reopen`; `reopen` has arity 1 in the frozen sibling and the packet enumerates no drift reason or key.
4. :168 rollback restores the persisted watermark, so a `now` refused before a transient store failure is accepted after it. Literal packet 145-147 mechanism; no bundle-level monotonic-clock invariant is stated.
5. :156 store INVALID_JOURNAL but `reopen` COMPLETE -> OPEN with sha256 null, then STORE_FAILED/EXISTING_INVALID forever. Every step is prescribed (packet 76-81, 92-94, 130-131, 141-151); EXISTING_INVALID fires before any hash comparison, so a hash would change nothing. Reachability requires external corruption that lossy-decodes to an existing U+FFFD.
6. :146 journal operations dispatch on caller-writable `bundle.journal`. Packet 124/129/133 spell `bundle.journal.append/serialize/list`; the public handle already permits direct appends; no trust boundary is contracted.
7. :161 `Object.freeze(bundle)` makes the post-commit assignment throw. Packet 103-104 declares the bundle mutable and updated in place; preventExtensions/seal work correctly, only freeze throws; caller-induced.
8. :170 rollback via `reopen` marks the bundle's own appended rows historical:true. Frozen sibling sets it unconditionally; packet has no historical-stability or entries==list() rule; recovery report unaffected.

SCOPE: this is a static + read-only memfs probe review of an isolated work-order module against its packet and oracle. It does not cover host integration, on-disk durability on a real filesystem, cross-process locking, concurrent writers, or milestone acceptance. No files were created, edited, moved or deleted.
