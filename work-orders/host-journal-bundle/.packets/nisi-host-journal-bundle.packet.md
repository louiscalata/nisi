---
packet: nisi-host-journal-bundle
project_root: /Users/louiscalata/nisi-next-private/work-orders/host-journal-bundle
created_by: claude
created: 2026-09-13T16:20:00-07:00
write_owner: opencode
status: done
---

# Nisi — host journal bundle (open persisted journal → record fixed run → write back)

## Context

Isolated private work-order workspace, NOT the Nisi runtime. Implement one
module with two synchronous functions. Do not read or edit any parent directory.

Oracle correction (Claude, 2026-09-13 15:30 PDT, before any accepted draft): one
test asserted `TIME` for a `createdAt` later than `now`; the frozen journal
throws `ENTRY` for that and `TIME` only for a clock earlier than its watermark.
The test now asserts both correctly. Found by Astra's parallel authoring run.

Node 24; ESM; no dependencies. `npm test` passes 3 baseline checks against the
placeholder (pins three frozen modules and two fixtures by sha256).
`npm run test:bundle` (14 tests) fails against the placeholder; those are
expected unfinished work, not permission to edit tests or fixtures. This prose
is the complete contract; `tests/bundle.test.mjs` is the acceptance oracle and
may not be visible to the executor, so implement from the prose alone.

Target: `src/host-journal-bundle.mjs`. Its ONLY import statements are the three
frozen siblings (read them; do not edit them):
- `./run-journal-v1.mjs` exports `createRunJournal(config)` → journal
  `{ append(entry, now), list(now), retain(now), serialize() }` and
  `reopen(serialized)` → `{ journal, report }` where `report` is
  `{ status: 'COMPLETE'|'INCOMPLETE'|'INVALID', recoveredIds, rejectedLine, reason, authorizing: false }`.
  On INCOMPLETE/INVALID the returned journal is SEALED: `append` returns
  `{ status: 'REFUSED', reason: 'SEALED' }` and `serialize()` throws. On INVALID
  with a bad header, `journal` is `null`. `list(now)` rows are
  `{ entry, historical, retained, revoked, expired, liveness, authorizing }`;
  `liveness` is `'UNKNOWN'` for a RUNNING entry whose `heartbeatAt` is `null`
  or older than `config.heartbeatTtlMs` at `now`, `'EXPIRED'` once
  `now >= createdAt + ttlMs`, else the state. `append` returns
  `{ status: 'APPENDED'|'DUPLICATE', id }` or `{ status: 'CONFLICT', id, reason: 'ID_CONTENT_MISMATCH' }`
  or `{ status: 'REFUSED', id, reason }`; it THROWS an Error with `.code`
  (`'ENTRY'`, `'TIME'`, `'CONFIG'`) on invalid entry, `createdAt > now`, or a
  clock earlier than the journal's watermark. `createRunJournal` throws
  `.code === 'CONFIG'` on an invalid config.
- `./run-journal-store-v1.mjs` exports `readSerializedJournal({ path, fs })` →
  `{ status: 'READ', serialized, sha256, bytes, ... }` or
  `{ status: 'REFUSED', reason: 'INVALID_INPUT'|'NOT_FOUND'|'READ_FAILED'|'INVALID_JOURNAL', ... }`,
  and `writeSerializedJournal({ path, serialized, fs, expectedPreviousSha256 })` →
  `{ status: 'WRITTEN'|'UNCHANGED', sha256, bytes, durable, committed, fsync, fsyncErrors, ... }`
  or `{ status: 'REFUSED', reason, committed, durable: false, ... }`. Pass
  `expectedPreviousSha256` ONLY when the bundle has a known on-disk hash (a
  string); for a first write to an absent path omit the key. All disk activity
  goes through the injected `fs`.
- `./fixed-run-journal-entry.mjs` exports `fixedRunJournalEntry(input)` →
  `{ status: 'ENTRY', entry, authorizing: false }` or
  `{ status: 'REFUSED', reason, authorizing: false }`; it throws `TypeError` on a
  non-object input. Its input is
  `{ summary, projectId, runId, attempt, candidateId, receiptId, createdAt, ttlMs }`.

### `openJournalBundle({ path, fs, config, now })`
Validation (any failure → `{ status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false }`,
keys in that order, nothing else): input must be a non-null non-array object
with exactly those four own enumerable keys; `path` a non-empty string;
`fs` a non-null object with function-valued `readFileSync`, `openSync`,
`writeSync`, `closeSync`, `renameSync`, `unlinkSync` (fsyncSync optional);
`config` such that `createRunJournal(config)` does not throw; `now` a safe
integer >= 0 and not `-0`.

Then read the store: `readSerializedJournal({ path, fs })`.
- `NOT_FOUND` → a NEW bundle: `journal = createRunJournal(config)`,
  `recovery = { status: 'NEW', recoveredIds: [], rejectedLine: null, reason: null, authorizing: false }`,
  `sha256 = null`, `bytes = 0`.
- `READ_FAILED` or `INVALID_INPUT` → `{ status: 'REFUSED', reason: 'READ_FAILED', authorizing: false }`.
- `READ` or `INVALID_JOURNAL` → obtain the exact raw text: on `READ` use the
  store's `serialized`; on `INVALID_JOURNAL` the store returns no text, so read
  the bytes through `fs.readFileSync(path)` and decode as UTF-8 (if that read
  throws → `READ_FAILED`). Then call `reopen(rawText)`; it returns the proper
  report and a sealed (or `null`) journal for any malformed text.
- `reopen` report COMPLETE → `status: 'OPEN'`. Before accepting, compare the
  persisted header's `config.projectId` with `config.projectId`: parse the first
  line of the raw text as JSON and read `.config.projectId`; a mismatch →
  `{ status: 'REFUSED', reason: 'PROJECT_MISMATCH', authorizing: false }`.
  (Only check this when the report is COMPLETE or INCOMPLETE and the first line
  parsed; a header that does not parse is INVALID, not a mismatch.)
- report INCOMPLETE or INVALID → `status: 'SEALED'`; `journal` is the sealed
  journal from `reopen`, or, when `reopen` returned `journal: null`, an object
  whose `append` returns `{ status: 'REFUSED', id: <entry.id if readable else null>, reason: 'SEALED' }`
  and whose `list` returns `[]`.
- `sha256`/`bytes`: on a `READ` result use the store's `sha256` and `bytes`.
  On the `INVALID_JOURNAL` path no hash is available without `node:crypto`
  (forbidden), so set `sha256 = null` and `bytes` = the byte length of the raw
  buffer.

Result keys IN ORDER: `status` ('OPEN' | 'SEALED'), `recovery` (the reopen
report or the NEW report above, copied as a plain object with those five keys),
`sha256`, `bytes`, `entries`, `interrupted`, `journal`, `authorizing: false`.
`entries` = `journal.list(now)` as a plain array (empty for a null journal).
`interrupted` = for each row with `entry.state === 'RUNNING'` and
`liveness === 'UNKNOWN'` (not EXPIRED, not revoked), in list order:
`{ id, runId, attempt, stage, liveness, heartbeatAt, createdAt }` copied from
the entry. The bundle object is mutable and stateful: `recordFixedRun` updates
`entries`, `sha256` and `bytes` on it in place after a successful write.
Opening never writes: the only fs call is `readFileSync`.

### `recordFixedRun({ bundle, run, now })`
Validation → `{ status: 'REFUSED', reason: 'INVALID_INPUT', entryId: null, journal: null, store: null, sha256: null, bytes: null, authorizing: false }`
(keys in that order for EVERY result of this function): input a non-null
non-array object with exactly those three keys; `bundle` an object produced
by `openJournalBundle` (check `status` is 'OPEN' or 'SEALED' and `journal` is
an object with an `append` function, and that `bundle.recovery` is an object);
`run` a non-null non-array object; `now` a safe integer >= 0 and not `-0`.
Then, in order:
1. `bundle.status === 'SEALED'` → `REFUSED` with `reason: 'BUNDLE_SEALED'`
   (entryId etc. null). No fs activity.
2. Build the entry: `fixedRunJournalEntry({ ...run, projectId: bundle's config projectId })`.
   The bundle must remember its `config` (keep a private reference; do NOT add
   a `config` key to the bundle result). `run` must have exactly the keys
   summary, runId, attempt, candidateId, receiptId, createdAt, ttlMs — pass
   them through; a TypeError from the builder or a `REFUSED` result → return
   `REFUSED` with the builder's `reason` (for TypeError use `'INVALID_INPUT'`).
   No fs activity.
3. `bundle.journal.append(entry, now)` inside try/catch: a thrown error with
   `.code` → `REFUSED` with `reason` = that code (`'TIME'`, `'ENTRY'`),
   `entryId` = entry.id, journal/store/sha256/bytes null. A `REFUSED` result →
   `REFUSED` with its reason. `DUPLICATE` → `{ status: 'DUPLICATE', entryId, journal: <append result>, store: null, sha256: bundle.sha256, bytes: bundle.bytes, authorizing: false }`.
   `CONFLICT` → same shape with `status: 'CONFLICT'`. Neither touches the fs.
4. `APPENDED` → `serialized = bundle.journal.serialize()`; then
   `writeSerializedJournal({ path, serialized, fs, expectedPreviousSha256: bundle.sha256 })`
   when `bundle.sha256` is a string, else without that key.
   - `WRITTEN` or `UNCHANGED` → update `bundle.sha256 = result.sha256`,
     `bundle.bytes = result.bytes`, `bundle.entries = bundle.journal.list(now)`;
     return `{ status: 'RECORDED', entryId, journal: <append result>, store: <store result>, sha256: result.sha256, bytes: result.bytes, authorizing: false }`.
     A non-durable WRITTEN is still RECORDED (the store result carries
     `durable:false` and the fsync errors; do not hide it).
   - `REFUSED` with `reason === 'CONFLICT'` → the disk changed underneath:
     ROLL BACK the append so the in-memory journal matches the last known disk
     state, return `{ status: 'STORE_CONFLICT', entryId, journal: <append result>, store: <store result>, sha256: bundle.sha256, bytes: bundle.bytes, authorizing: false }`
     and leave `bundle.entries` unchanged.
   - any other `REFUSED` → same but `status: 'STORE_FAILED'`, same rollback.
   Rollback rule: the accepted journal has no remove operation, so the bundle
   must keep its in-memory journal as a REBUILDABLE value: after every
   successful write remember the serialized text that is on disk (initially
   the text read at open, or `createRunJournal(config)` for NEW); on rollback
   replace the bundle's private journal with `reopen(lastGoodSerialized).journal`
   (or a fresh `createRunJournal(config)` for NEW) and set `bundle.journal` to
   it. `bundle.journal` is therefore replaced, never mutated in place, on
   rollback; callers read `bundle.journal` fresh. After rollback the same
   record on the same bundle must behave identically (append succeeds again,
   write fails again the same way) until the caller reopens.
Never throw for these cases. `authorizing` is always `false`.

## Constraints

- Write ONLY `src/host-journal-bundle.mjs`. Everything else is read-only:
  `package.json`, `roadmap.md`, `tests/` (including `tests/memfs.mjs`),
  `fixtures/`, `evidence/`, `.packets/` and the three frozen siblings in `src/`.
  No parent-tree exploration.
- The executor owns only this draft. Claude authored the contract; Astra
  (Codex) owns review and integration; packet completion is not product completion.
- No dependencies, installs, network or model calls; no `node:` imports (the
  fs is injected); no ambient clock or randomness; synchronous only.
- Keep all work private. No commits, pushes, packages, public README/demo or
  disclosures. Nothing in this packet grants publication permission.
- Do not run commands, tests or nested packets yourself. The installed wrapper
  runs the inspected acceptance checks and writes the execution receipt.
- Do not alter tests, fixtures, acceptance commands, order or receipt to obtain
  DONE. If required context is missing, leave a concrete blocker, not an
  invented result.

## Items

### P1 — Implement openJournalBundle and recordFixedRun
- **files**: src/host-journal-bundle.mjs
- **do**: Replace the placeholder with the two synchronous named exports implementing the open/recovery/interrupted contract, the record chain (build → append → serialize → write with expected-previous hash), the rollback-on-store-failure rule and the exact result shapes above.
- **accept**: npm run test:bundle

## Packet acceptance
npm test
