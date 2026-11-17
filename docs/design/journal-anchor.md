# Journal anchor design (review item R1) — 16 November 2026

Back to the [documentation index](../README.md). This is the design for review item R1 of the [journal authentication review](../reviews/2026-11-14-journal-auth-review.md). **Status: implemented** on 16 November 2026 in `history/run-journal-anchor-v1.mjs` and `tests/run-journal-anchor.test.mjs`. The recommended design (Design 1) was built with the decisions of section 10 as recommended; section 13 records what the implementation settled. Sections 1 to 12 are the design as written and describe `origin/main` at `51bfbc8`. The design changes no file format.

Base: `origin/main` at `51bfbc8` (merge of PR #64). Scope: findings F2 (full rewrite with rehash) and F3 (truncate and re-footer, or replay an older copy). Both still reopen as `COMPLETE`, and the store still returns `READ` with `verified: true` (`docs/run-journal.md:87`). The [roadmap](../../roadmap.md) lists R1 as not started (`roadmap.md:35-37`).

**Summary.** A host that keeps a small record outside the journal's writable area can detect both findings, because the file can no longer match that record after either change. The record has to name the journal's exact bytes and a hash of the entries' fixed fields, not only the footer's `lastHash` as the review proposed. The chain hashes of v1 change on every legitimate write (section 3), so a later file never contains an earlier footer hash. The recommended design (section 8) is a host-held anchor file written in two phases. It needs no change to the v1 format, adds one new module, and does not protect against an attacker who can also write the anchor.

## 1. What the code does today

Each statement below was read in the files named. Line numbers are those of `51bfbc8`, before this change adds lines to the roadmap, the changelog and the index.

- **Format.** A journal is canonical JSON lines: a header, one envelope per record, and a footer (`history/run-journal-v1.mjs:179-182`). The chain starts at `SHA-256("nisi-run-journal/header/v1\n" + header)`, and each envelope hash covers `seq`, `previousHash` and the record (`:180-181`). The footer holds `count` and `lastHash` (`:182`). All hashes are unkeyed. Entries carry no writer field (`:7`).
- **Reopen.** `reopen` checks the header, each envelope, each fingerprint and the footer (`:194-233`). The footer check compares `count` and `lastHash` with values computed from the same file (`:206`). It has no input from outside the file except the optional `{projectId, redactPaths, maxNow}` expectations (`:103-109`, `:237-240`), which came in with PR #62 (review R3).
- **Mutation of old rows.** Retirement clears the payload of an earlier row and recomputes its fingerprint (`:142`). `serialize` then rebuilds every record hash from the current rows (`:181`). The header carries the clock watermark `now` (`:179`), and every successful append moves that watermark (`:172`). The header hash seeds the chain (`:180`), so a new watermark changes every hash after it.
- **Store.** The store checks format and chain (`history/run-journal-store-v1.mjs:25-58`) and then calls `reopen` (`:52`). A write replaces the file with any valid journal when the caller passes the current file's digest as `expectedPreviousSha256` (`:186-190`). It never compares old content with new content. Writes use a temp file, `fsync`, rename and a directory sync (`:194-267`). A symlinked destination is refused (`:178-180`).
- **Read-only check.** `nisi validate` reads the file from one descriptor and reports `PASS` for any journal the store accepts (`history/validate-data.mjs:94-101`).
- **Documented limits.** `verified: true` is not authenticity (`docs/run-journal.md:86`, `SECURITY.md:77-84`). `expectedPreviousSha256` is a sequential stale-write guard, not a concurrency guard (`docs/run-journal.md:85`). A test pins the rollback behaviour (`tests/run-journal.test.mjs:341`; its comment at `:336-340` says to update the documents if rollback detection is ever added).
- **No runtime dependencies.** `package.json:33` lists only `devDependencies`. The module list in the archive is explicit (`package.json:46-47` for files, `:74-75` and `:89-90` for exports).

### Reproduction on `51bfbc8`

A scratch script outside the repository (`probe.mjs`, listed in section 12) ran these against the modules in this worktree:

| Case | Result |
|---|---|
| Three-entry journal cut to two entries with a footer rebuilt from the dropped line's `previousHash` | `reopen` `COMPLETE`; `readSerializedJournal` `verified: true`; `validateData` `PASS` |
| Older complete copy written with `expectedPreviousSha256` set to the current digest | `writeSerializedJournal` `WRITTEN` |
| Entry `e3` changed to `CANCELLED` with a new payload, fingerprint, record hashes and footer recomputed | `reopen` `COMPLETE` |
| Payload of `e2` changed, fingerprint and hashes recomputed, all other fields unchanged | `reopen` `COMPLETE` |

## 2. Threat model

**Assets.** The set of entries a host will read as the run history, their order, their states and their retained payloads.

**Attacker.** Anything that can write the journal file or the directory that holds it, and can run Node code. Examples: another process of the same user, a sync or backup tool that restores an older copy, an editor, a script that deletes the file and starts again, a lower-privileged account with write access to the directory. The attacker knows the format (the repository is public) and can compute every hash in it. The attacker cannot guess a secret, because v1 has none.

**What the host can hold outside the journal.** The host is the code that calls `serialize`, `writeSerializedJournal` and `reopen`. It is the only legitimate writer (`docs/run-journal.md:85` already asks for one writer per journal). It can keep a small record in a place the attacker above cannot write. Which places qualify depends on the machine:

| Place | Separation it gives |
|---|---|
| A directory writable only by the host's account, while the journal directory is also writable by other accounts or tools | Real, on POSIX mode bits or Windows ACLs. |
| The host's own database, keychain item or configuration store | Real if the attacker's access path does not reach it. |
| A directory outside the journal directory, but owned and writable by the same account as the attacker | None against an attacker who runs as that account. It still stops accidents and tools that touch only the journal directory (restores, sync conflicts, cleanup). |
| Memory of a long-running host | Real, but lost on restart. Not a solution by itself. |

The design does not decide which place a host uses. It requires that the host be able to name one that the attacker cannot write, and it says in each case what happens when that is not true.

**Not in the model.** An attacker who can run code as the host and so can call the anchor writer. An attacker who captured the whole machine state, anchor included, and restores both together (a point-in-time restore of the disk). Anything about whether the recorded events happened (`SECURITY.md:77-84`: a valid chain does not prove that). Confidentiality of payloads. Attribution of an entry to a writer, which needs keys (R2).

**Goals.**

1. A host that holds the anchor detects F3: truncation with a rebuilt footer, replacement by an older complete copy, and deletion followed by a fresh journal.
2. The same host detects F2: a rewrite of history, and a rewrite of a retained payload with every hash recomputed.
3. Legitimate writes never look like attacks: appends, retirements and watermark advances, including a crash between writing the journal and updating the anchor.
4. A host that holds no anchor gets today's behaviour, labelled as unanchored, never a silent pass.
5. No v1 format change. Existing journals can be adopted.

## 3. Why the review's `(count, lastHash)` wording does not work on v1

The review proposes that the host store `(projectId, count, lastHash)` and check that the file's footer "extends that anchor: same prefix and a count that has not gone down" (review R1, `docs/reviews/2026-11-14-journal-auth-review.md:51`). On v1 a later footer never contains an earlier `lastHash` once either of two ordinary things happens. The probe measured both:

- **Watermark.** A journal with two entries serialized at `now` 100 has a footer `lastHash` starting `5dfd7a9b7f57`. After a third entry is appended at `now` 200, the second record's hash in the new file starts `239436ca9f62`, and the new file does not contain the old `lastHash`. If the watermark does not move, the old `lastHash` does survive as a prefix.
- **Retirement.** With `maxEntries` 1, appending a second entry retires the first. The first record's `retained` flag goes from `true` to `false` and its hash changes, so the old `lastHash` is not in the new file.

So a stored footer can only be compared for equality. It says "the file is exactly what I last wrote", not "the file extends what I last wrote". That is enough for Design 2 below, but it cannot tell a journal that is merely ahead of the anchor from one whose history was rewritten.

The stable part of an entry is everything except the payload. Entries never change after they are appended except for retirement, which sets the payload to `null`, the `retained` flag to `false` and a new fingerprint (`run-journal-v1.mjs:142`). Redaction paths all start with `payload.` (`:88`), so redaction cannot change anything else either. The anchor therefore also records a chain over the payload-free form of each entry, called the **stem chain**. The probe confirmed that the stem chain is unchanged by a watermark change and by retirement, while `lastHash` changes in both cases.

### Stem chain (shared by Designs 1 and 3)

All hashes are SHA-256 over UTF-8 bytes, hex lowercase, and `C(x)` is the journal's canonical JSON (keys sorted by UTF-16 code units, no spaces).

```
seed    = H("nisi-journal-anchor/seed/v1\n" + C({"projectId": P}))
stem_i  = H("nisi-journal-anchor/stem/v1\n" + C(entry_i with payload set to null))
S_0     = seed
S_i     = H("nisi-journal-anchor/step/v1\n" + S_(i-1) + "\n" + stem_i)
stemTip = S_count
```

`entry_i` is the validated entry of record `i` (`ENTRY_KEYS`, `run-journal-v1.mjs:7`), so `receiptId`, `state`, `createdAt`, `ttlMs`, `heartbeatAt`, `retryOf`, `revokes` and the IDs are all covered. Only `payload` is not. A change to a retained payload with all other fields untouched is caught by the exact-bytes digest in Design 1 and is not caught by the stem chain alone. The three domain strings differ so that a seed, a stem and a step can never be mistaken for one another.

## 4. Design 1: host-held anchor file with a monotonic generation

**Idea.** The host keeps one small file in a directory that the journal's other writers cannot write. After every legitimate write it records the exact digest of the bytes, the entry count, the stem tip and a counter that only goes up.

### Data format

File `<anchorDir>/<name>.anchor.json`, canonical JSON, one line ending in LF. `<name>` is the lowercase hex SHA-256 of the host's chosen anchor key (UTF-8). The key is the host's own label for the journal. It is not the path, so moving the journal does not break the link. The hash keeps the file name inside `[0-9a-f]`, which matters on Windows (section 4.6).

```json
{"current":{"count":3,"fileSha256":"96b2…f38b","generation":7,"journalSchema":"nisi-run-journal-v1","lastHash":"2b0d…085f","projectId":"project-a","stemTip":"7c2b…cfe8"},"pending":null,"schema":"nisi-journal-anchor-v1"}
```

| Field | Meaning |
|---|---|
| `schema` | `nisi-journal-anchor-v1`. A reader that does not know the value refuses the file. |
| `current` | The last state the host confirmed. |
| `pending` | `null`, or an object with the same keys as `current`: the state the host is about to write. |
| `generation` | Safe integer, starts at 1, increases by exactly 1 at each promotion. |
| `count`, `lastHash` | The footer values of the file (`run-journal-v1.mjs:182`). |
| `fileSha256` | SHA-256 of the journal file bytes, the same digest the store reports as `sha256` (`run-journal-store-v1.mjs:155`). |
| `stemTip` | The stem chain tip. |
| `projectId`, `journalSchema` | Copied from the journal header. |

The example above is the anchor the probe computed for a real three-entry journal. With `pending` null it is 385 bytes. It contains hashes and counters only: no payload, no entry ID and no path.

### Write protocol (host as sole writer)

1. Read the anchor and verify the journal against it (below). Anything but `OK` or `OK_PENDING` stops the write. If it is `OK_PENDING`, promote `pending` to `current` first.
2. Build the new bytes with `serialize(now)`. Compute the new `fileSha256`, `count`, `lastHash` and `stemTip`.
3. Continuity check: the new journal must have `count` at least that of `current`, equal stem chain up to `current.count` (so `stemTip` matches at that index), and the same `projectId`. Otherwise refuse with `NOT_EXTENSION` and write nothing. This closes the gap in `docs/run-journal.md:85`, where a matching digest permits replacement with any valid journal.
4. Write the anchor with `pending` set to the new state and `current` unchanged. Use the same pattern as the store: exclusive temp file in the anchor directory, `fsync`, rename, directory sync.
5. Call `writeSerializedJournal` with `expectedPreviousSha256` set to `current.fileSha256`.
6. Write the anchor again with `current` set to the new state, `generation + 1` and `pending` null. If step 5 was refused, write the anchor with `pending` null instead.

### Verification algorithm

Input: journal bytes, anchor file bytes (or absent), the host's policy (`require` or `unanchored-ok`).

1. Anchor absent: `ANCHOR_MISSING` under `require`, `UNANCHORED` under `unanchored-ok`. Neither is `OK`.
2. Anchor unreadable, not canonical, wrong keys or an unknown `schema`: `ANCHOR_INVALID`.
3. Journal not `COMPLETE` under `reopen` (with the host's expectations if it has them): `JOURNAL_NOT_COMPLETE`.
4. `projectId` differs from the anchor: `ANCHOR_PROJECT`.
5. `sha256(bytes) == current.fileSha256`: `OK`. `== pending.fileSha256`: `OK_PENDING`.
6. Otherwise compute the stem chain of the file and let `n` be its `count`, `a` be `current.count`:
   - `n < a`: `ROLLED_BACK`. This covers truncation with a rebuilt footer, an older copy, and a deleted file replaced by a shorter one.
   - `n >= a` and `S_a == current.stemTip`: if `n == a`, `CONTENT_DIFFERS` (same entries, different bytes: a payload rewrite or a replaced retirement); if `n > a`, `AHEAD` (extra entries the anchor does not know).
   - Otherwise `DIVERGED` (an entry among the first `a` differs from what was anchored: a rewrite of history, or an unrelated journal of the same project).

Every result other than `OK` and `OK_PENDING` means the host does not rely on the journal. `AHEAD` is the one a host may resolve, by an explicit, logged re-anchor decision. The helper never re-anchors by itself and never edits a journal (`AGENTS.md:64`).

The probe ran this algorithm as a prototype outside the repository over 21 checks. All passed on `51bfbc8` (section 12).

### Failure modes

| Event | Result |
|---|---|
| Crash after step 4 | Journal is old, matches `current`: `OK`. The stale `pending` is replaced at the next write. |
| Crash after step 5 | Journal matches `pending`: `OK_PENDING`; the next writer promotes. |
| Step 5 refused (`CONFLICT`, `SYMLINK`, disk full) | Journal still matches `current`: `OK`. |
| Anchor write fails in step 6 | Same as the crash after step 5. |
| Anchor deleted by the attacker | `ANCHOR_MISSING` under `require`. Under `unanchored-ok` the downgrade is silent. That is why new journals use `require` (decision 4). |
| Anchor restored from an old backup | Journal is `AHEAD` of it. Detected, resolved by an explicit re-anchor. |
| Journal and anchor both restored from one backup | `OK`. Not detected (section 8). |
| Two writers | Both reach step 4. The generation recorded in `current` lets the second writer's step 1 see a changed anchor, and a later verify reports a state matching neither as `CONTENT_DIFFERS` or `DIVERGED`. Detected, not prevented. One writer per journal stays the rule. |
| Host loses the anchor directory | All journals under it are `ANCHOR_MISSING`. Recovery is a re-anchor after the host's own judgement. |

### Upgrade and compatibility

- **No format change.** The journal bytes, `reopen`, the store and `nisi validate` keep their behaviour. A journal written by the anchored path is byte-identical to one written by `writeSerializedJournal`.
- **Existing journal.** An `adopt` step reads the file, requires `COMPLETE`, and writes generation 1. Adoption is trust on first use: whatever the file said at that moment is accepted, and nothing before it is protected. Adoption is explicit and recorded by the host, never automatic. A journal that fails with `LEGACY_UNRETAINED_FINGERPRINT` cannot be adopted (`AGENTS.md:64`).
- **New journal.** The first anchored write creates the anchor with the empty-journal tip `S_0 = seed` and `require`.
- **Later v2 format (R2).** The anchor has its own `schema`, and `journalSchema` says which journal format its tip was computed for. A v2 journal that keeps the entry keys can reuse the stem chain. If the keys change, use `.../stem/v2` strings and a new anchor schema. A v1 verifier refuses an unknown anchor schema, which is the safe direction. Migration by copy-forward (review, `:46`) creates a new anchor key and leaves the old anchor frozen.
- **Mixed fleet.** A host that does not yet know the anchor module keeps writing the journal. Its writes make the journal `AHEAD`, `CONTENT_DIFFERS` or `DIVERGED` for any host that does.

### Windows

- File names are lowercase hex, so there are no case collisions, no reserved names (`CON`, `NUL`) and no `:`. The journal ID format allows `:` (`run-journal-v1.mjs:9`), which Windows reads as an alternate data stream marker in a path, so the anchor key must never be used as a file name directly.
- Rename over an existing file can fail with `EPERM` or `EBUSY` while a scanner or indexer holds the target open. This is general Windows behaviour and was not reproduced here. The anchor writer would need a short bounded retry. The store has no retry today (`run-journal-store-v1.mjs:245`).
- Directory sync opens the directory with `'r+'` (`run-journal-store-v1.mjs:21`). If it fails, the result is reported with `durable: false` (`:267`). The anchor writer reports the same way, and a host that needs durable anchors treats `durable: false` as a failed step.
- `O_NOFOLLOW` does not exist, so a symlink or junction check relies on `lstat` before the open (review, `:36`). The anchor reader has the same gap as `readSerializedJournal` on Windows.
- Mode `0o600` does nothing useful. Separation comes from an ACL on the anchor directory, set by the host or the installer. Node cannot set an ACL, so on Windows the anchor defends against accidents and other tools unless the host sets one.
- NOT_RUN: nothing in this design was run on Windows or on any hardware.

### Cost

| Item | Measured or stated |
|---|---|
| Anchor size | 385 bytes with `pending` null (probe). |
| Extra files | One anchor file per journal, plus one temp file during each of the two anchor writes. |
| Extra I/O per journal write | Two small atomic writes, each with a file sync and a directory sync. NOT_RUN: latency was not measured. |
| Verification compute, 10,000 records (5,498,044 bytes) | `reopen` 126 ms, stem chain including a second parse 153 ms, file SHA-256 1.7 ms (medians of 5 runs, one Apple Silicon Mac, Node v24.22.2). In an implementation the stem chain would use records `reopen` has already parsed. The 27 ms difference is an upper bound of its extra work. |
| New runtime dependencies | None. `node:crypto` only. |
| New public surface | One new module and export, and a change to `package.json` `files` and `exports`. `AGENTS.md:35` lists 21 archive files for `check:cli-package`, so that count changes. |

## 5. Design 2: chain head kept in the host's own state

**Idea.** This is the review's R1 as worded: the host stores `(projectId, count, lastHash)` in whatever it already keeps (a database row, a configuration entry, a keychain item) and compares it with the file's footer. It needs no anchor file and no stem chain.

### Data format

One canonical JSON object, stored under the host's own key:

```json
{"count":3,"lastHash":"2b0d…085f","projectId":"project-a","schema":"nisi-journal-tip-v1"}
```

### Verification

1. Reopen the file. Not `COMPLETE`: `JOURNAL_NOT_COMPLETE`.
2. `projectId` differs: `ANCHOR_PROJECT`.
3. `count` and `lastHash` equal the stored values: `OK`. Equal `lastHash` at equal `count` means identical header and records, because the chain covers both (`run-journal-v1.mjs:180-182`).
4. File `count` below the stored value: `ROLLED_BACK`. Equal count with another `lastHash`: `REWRITTEN`.
5. File `count` above the stored value: `UNVERIFIABLE`. Section 3 shows why: the old `lastHash` is not in the new file after a watermark change or a retirement, so the check cannot separate a journal that grew from one that was rewritten and given more entries.

### Failure modes

- There is no pending slot, so a crash between the journal rename and the state update leaves the file ahead of the state. That is `UNVERIFIABLE`, a false alarm that a human has to resolve. Adding a pending slot turns this design into Design 1.
- No continuity check on write: nothing compares old and new content, so a legitimate-looking replacement with more entries passes once the host updates its state.
- A retained payload rewrite is caught (the footer changes). Which entry changed is not known.

### Upgrade, Windows, cost

- Compatibility: same as Design 1. Adoption stores the current footer. No format change.
- Windows: no new files, so none of the file-system points above apply. The separation depends only on where the host keeps its state. If that is an ACL-protected store, the same ACL caveat holds.
- Cost: about 100 bytes of host state, no extra I/O of its own, and one `reopen` per check (126 ms at 10,000 records). The helper needs only the footer parse. NOT_RUN: not implemented.

## 6. Design 3: external timestamp or witness

**Idea.** The host periodically sends a digest to a party the attacker does not control, such as an RFC 3161 time-stamp authority or a public transparency log, and keeps the receipt. The receipt proves that the digest existed at a time and could not have been made later. The attacker cannot forge it, even with full control of the host.

### Data format

A witness file outside the journal directory, one canonical JSON line per witnessed state, appended and never edited:

```json
{"at":1763300000000,"count":3,"projectId":"project-a","receipt":"<base64 of the witness response>","schema":"nisi-journal-witness-v1","stemTip":"7c2b…cfe8"}
```

The imprint sent to the witness is `H("nisi-journal-witness/imprint/v1\n" + C({count, projectId, stemTip}))`. It uses the stem chain from section 3 so that later growth of the journal can still be proven to extend the witnessed state.

### Verification

1. Verify each receipt against a pinned witness key or certificate chain. Failure: `WITNESS_INVALID`.
2. For the latest valid line with count `a`, compute the stem chain of the file. Fewer than `a` entries: `ROLLED_BACK`. `S_a` different: `DIVERGED`. Otherwise `OK` for the first `a` entries.
3. Entries after the last witnessed state are not covered. The width of that gap is the witness interval.

### Failure modes

- The witness is unreachable: witnesses lag, the unprotected window grows, and a host that insists on fresh receipts cannot write.
- Certificate expiry or revocation, a witness that changes its signing key, a clock the host cannot trust for `at`.
- The stem chain ignores payloads, so a retained payload rewrite is not detected. Witnessing `fileSha256` instead would need a witness call after every write.
- The attacker can delete the witness file. That is a downgrade unless the host also keeps the latest count.

### Upgrade, Windows, cost

- Compatibility: same adoption rule. There is nothing before the first receipt.
- Data boundary: the imprint is a hash, but the call leaves the machine, and `AGENTS.md:7` says calls that leave the machine happen only when the caller opts in. A witness must be an explicit option, off by default.
- The package has no runtime dependencies (`package.json:33`). Parsing an RFC 3161 response needs an ASN.1 and CMS parser that Node does not provide, so this design means writing one or taking the first runtime dependency. NOT_RUN: nothing was tried.
- Windows: the TLS and certificate-store behaviour of the host decides. The Node side has no Windows-specific code beyond what exists for the store.
- Cost: one network round trip per witness, a third party. The receipt size and the latency were not measured.

## 7. Comparison

| | Design 1: anchor file | Design 2: chain head in host state | Design 3: external witness |
|---|---|---|---|
| F3 truncate and re-footer | Detected | Detected | Detected below the last witness |
| F3 older copy | Detected | Detected | Detected below the last witness |
| F3 delete and start again | Detected | Detected | Detected below the last witness |
| F2 rewrite of history | Detected as `DIVERGED` | Detected as `REWRITTEN` or `UNVERIFIABLE` | Detected inside the witnessed prefix |
| F2 retained payload rewrite | Detected as `CONTENT_DIFFERS` | Detected as `REWRITTEN` | Not detected |
| Journal ahead of anchor (crash) | `OK_PENDING` | False alarm | Not applicable |
| Attacker can write the anchor store | Not detected | Not detected | Still detected |
| Network and third party | No | No | Yes |
| New runtime dependency | No | No | Likely |
| Rollback inside the interval | Not applicable | Not applicable | Not detected |

## 8. Recommendation

**Design 1**, with the stem chain, the exact-bytes digest, the pending slot and the continuity check on write. Reasons:

1. It closes both findings for a host that can protect one small file, and it works on v1 as it is. Section 3 shows the review's simpler wording cannot separate growth from rewriting.
2. The pending slot makes a crash between the two writes a normal, named state instead of an alarm.
3. The digest catches payload rewrites that the stem chain alone cannot, and the stem chain gives the reasons (`ROLLED_BACK`, `AHEAD`, `DIVERGED`) that a bare mismatch hides.
4. It adds no dependency and sends nothing off the machine. It fits `AGENTS.md:7`.
5. It leaves the way open for R2 and for Design 3. A MAC would not stop replay without an anchor (review `:52`), so R1 is the foundation either way.

**What it does not protect against.**

- An attacker who can write the anchor as well as the journal. A same-account attacker on a machine where the anchor directory is writable by that account is in this class.
- An attacker who runs the host's own code and calls the anchor writer.
- A restore of the journal and the anchor together from one backup.
- Anything written before adoption. Adoption trusts the file as it is at that moment.
- A deleted anchor under `unanchored-ok`. New journals use `require`; adopted ones should move to it.
- Appends by anyone who can also write the anchor. An unauthenticated entry stays unauthenticated: the anchor says "this is what the host wrote", not "the entry is true" or "this writer wrote it" (R2).
- Denial of service. An attacker who can change the file can make it fail verification. The host loses trust in the file, not data it already trusts elsewhere.
- Older copies that still hold retired payloads. Replay detection does not remove them from disk.
- Whether two copies of a journal on two machines agree. The anchor belongs to one host.
- A rewrite of a retained payload that comes with an appended entry. The stem chain leaves out payloads and the anchor holds no fingerprints, so the journal is `AHEAD`, not `CONTENT_DIFFERS`, and a re-anchor accepts the rewritten payloads. The same rewrite without the append is `CONTENT_DIFFERS`. Closing it needs per-entry fingerprints in the anchor, which is a format change that this design does not make.
- A one-write rollback while the pending slot is set. A journal that matches `current` verifies `OK` and the result does not show the pending state, until the next anchored write promotes it.
- A verify that straddles a legitimate write. It reads the anchor and then the journal, so it can report `AHEAD` for a journal the host just wrote. That is a false alarm and never a false `OK`, and a host verifies again before it re-anchors.

## 9. Tests first

These tests would be written before any code, in a new `tests/run-journal-anchor.test.mjs`. They use only `node:test` and a temp directory, in the style of `tests/run-journal.test.mjs`. Each lists the setup and the result it must assert. None exists yet.

| # | Test | Asserts |
|---|---|---|
| 1 | Rollback to an older complete copy | With an anchor for three entries, the two-entry copy verifies as `ROLLED_BACK`. The store alone still reads it as `READ`. |
| 2 | Truncate and re-footer | Cutting the last entry line and writing the footer from the dropped line's `previousHash` (the case at `tests/run-journal.test.mjs:341`) verifies as `ROLLED_BACK`. The existing test stays as it is: without an anchor nothing detects it. |
| 3 | Replay through the store | `writeSerializedJournal` with `expectedPreviousSha256` of the current file still returns `WRITTEN` for the older copy. The anchored writer refuses the same input with `NOT_EXTENSION` and leaves the file and the anchor unchanged. |
| 4 | Delete and start again | A missing journal, then a new empty one, verify as `ROLLED_BACK` against an anchor with `count` 3. |
| 5 | Full rewrite with rehash (F2) | Entry state and payload changed, all hashes recomputed: `reopen` is `COMPLETE`, anchored verification is `DIVERGED`. |
| 6 | Payload-only rewrite | Same stems, one retained payload changed: `CONTENT_DIFFERS`. |
| 7 | Anchor missing | No anchor file: `ANCHOR_MISSING` under `require`, `UNANCHORED` under `unanchored-ok`, never `OK`. An anchor deleted after use gives `ANCHOR_MISSING` under `require`. |
| 8 | Anchor ahead of journal | Anchor `count` 3 and journal `count` 2 (older real state): `ROLLED_BACK`. Anchor `count` 3 and a journal of the same project with 4 unrelated entries: `DIVERGED`. |
| 9 | Journal ahead of anchor | Anchor older than a journal that extends it: `AHEAD`. No automatic re-anchor. An explicit re-anchor makes it `OK` with `generation + 1`. |
| 10 | Crash windows | A fake `fs` that fails after each step of the write protocol: anchor write, journal rename, anchor promotion. Results are `OK` or `OK_PENDING`, and the next write settles to `current` with `pending` null. A refused store write clears `pending`. |
| 11 | Concurrent writers | Two writers read the same `generation`. The second finds the anchor changed and returns `CONFLICT`. With an interleaving injected between read and rename, the later verify is not `OK`. |
| 12 | Legitimate churn stays `OK` | Appends at advancing watermarks and a retirement through `maxEntries` keep `OK` after each anchored write. This pins the stem-chain invariance measured in section 3. |
| 13 | Other project or key | A journal of another `projectId`: `ANCHOR_PROJECT`. An anchor for another key: not read. |
| 14 | Damaged anchor | Truncated, non-canonical, extra key, unknown `schema`, oversized, symlinked, and an anchor inside the journal's directory: each `ANCHOR_INVALID` or `ANCHOR_INSIDE_JOURNAL_DIR`, with no payload or path in the message. |
| 15 | Legacy and incomplete journals | `LEGACY_UNRETAINED_FINGERPRINT` and `INCOMPLETE` journals cannot be adopted: `JOURNAL_NOT_COMPLETE`. |
| 16 | Golden vectors | A fixed journal produces fixed `seed`, `stem_i`, `S_i`, `stemTip`, `lastHash` and `fileSha256`. This pins the hash strings of section 3 and the anchor bytes of section 4. |
| 17 | No format change | `serialize` output and `reopen` results for a fixed journal are byte-identical before and after the module exists. All of `tests/run-journal*.test.mjs` pass unchanged. |
| 18 | File names | The anchor file name is `[0-9a-f]{64}.anchor.json` for keys containing `:`, upper case, `CON` and a 128-character ID. On Windows the rename retry is exercised with an injected `EPERM`. Directory-sync failure gives `durable: false`. |
| 19 | No secrets in output | A marker in a payload and in a fake `fs` error message appears neither in the anchor nor in any refusal (the check used in review section "Refuted or holding"). |
| 20 | Docs | `docs/run-journal.md` and `SECURITY.md` say what an unanchored read does not detect and what an anchored read does and does not detect. A link check passes. |

### Review items this closes, and those it does not

- **F3: closed** for a host that holds the anchor: tests 1 to 4.
- **F2: closed to detection** for a host that holds the anchor, including payload rewrites: tests 5 and 6. Attribution and keyed authentication stay with R2.
- **R1: closed** when the module, tests and documentation exist. It is not closed by this document.
- **R4 (documentation)** is partly done (`docs/run-journal.md:87`). The anchored behaviour must be added with the module.
- **Not closed:** R2 (needs the key owner and rotation decision, `roadmap.md:36-37`), the temp-file name note in the review's unknowns, and F1, F4, F5 and R5, which are already done.

## 10. Open decisions

Each has a recommended answer.

1. **Which design?** Design 1. Keep Design 3 as a later, opt-in layer on the same stem chain.
2. **Where does the anchor live?** The host passes the directory. The library refuses a directory inside the journal's directory (`ANCHOR_INSIDE_JOURNAL_DIR`) and documents that real separation needs different write permissions. No default location.
3. **New module or change to the store?** New module `history/run-journal-anchor-v1.mjs`, no change to the store or `reopen`. It reuses the store for the journal write.
4. **Default policy for a missing anchor?** `require` for journals created through the anchored path. `unanchored-ok` only as an explicit setting for journals not yet adopted.
5. **Strict continuity check on write (step 3)?** Yes. It also compares retained fingerprints: a row retained in both old and new files must have the same fingerprint, and a retired row must stay retired.
6. **Keep a history of anchors?** No. One record with one pending slot. Add history only if a host asks for it.
7. **`nisi validate` and the anchor?** Add `--anchor FILE` later, reporting an `anchor` status next to `verified`. Without the flag, `PASS` and `verified: true` keep today's meaning and the documentation keeps saying so.
8. **Windows ACLs?** Document only. Nisi does not set ACLs.
9. **R2 timing?** Separate. Decide the key owner and rotation first (`roadmap.md:36-37`).
10. **Release?** None proposed. This design is not a feature, and nothing here is a release.

## 11. Windows summary

NOT_RUN. No code exists, so nothing could run on Windows. The points above come from reading the store and the review. The Windows CI jobs would run the new tests once they exist, and the one-PC hardware record (`docs/verification-v0.3-windows.md`) covers v0.3.0 only.

## 12. Verification of this document

Commands were run from the worktree a worktree of this repository on macOS (Darwin, arm64) with Node v24.22.2. `npm ci` was not run, so `npm run check:structural`, `npm run check:static` and `npm run check:cli-package` are NOT_RUN here (they need `typescript`).

- Probe: `node probe.mjs <worktree>` (kept outside the repository). 21 checks, 0 failed. It reproduces F2 and F3 on `51bfbc8`, measures the watermark and retirement effect of section 3, runs the section 4 algorithm as a prototype and times a 10,000-record journal.
- Targeted tests: `node --test tests/run-journal.test.mjs tests/run-journal-store.test.mjs tests/run-journal-expectations.test.mjs tests/run-journal-store-read-bounds.test.mjs tests/measurement-notes.test.mjs`. The result is in the pull request body.
- Link check: a scratch script resolves every relative link and `#fragment` in this file and in the index and roadmap lines it touches. The result is in the pull request body.

## 13. Implementation notes

What the code settled where this document left room. Nothing here changes a decision in section 10.

- **API.** `writeAnchoredJournal`, `verifyAnchoredJournal`, `adoptJournal`, `reanchorJournal`, `describeJournal` and `anchorFileName`, in the new module only. The anchor addition preserves `reopen` and `nisi validate` and writes through the store. The store also caps descriptor requests, refuses shrinkage and catches byte-conversion failures as described in the [run-journal guide](../run-journal.md#store). `nisi validate --anchor FILE` (decision 7) is not part of this change.
- **First write.** The anchor needs a `current` before any journal exists. A new key starts at a genesis state at generation 1: count 0, `stemTip` = `S_0` = the seed, and 64 zeros for `fileSha256` and `lastHash`, which no file can have as its digest. The first journal is therefore written as pending generation 2, and an adopted journal starts at generation 1 (section 4). If the first write stops before the journal exists, the next write with the same key resumes it.
- **Generation guard.** The writer takes an optional `expectedGeneration` and returns `CONFLICT` if `current.generation` differs. Before each anchor rename it also re-reads the anchor and returns `CONFLICT` if the bytes changed since it last read or wrote them. A rival that lands between that read and the rename is not prevented (the file system has no compare-and-swap); the later verify reports a state that is not `OK`, as the failure table says.
- **Refusals.** A verify status other than `OK` or `OK_PENDING` refuses the write with that status as the reason. Extra reason codes: `NOT_EXTENSION`, `ANCHOR_EXISTS` (adopt over an existing anchor), `NOT_AHEAD` (re-anchor of anything but `AHEAD`), `ANCHOR_WRITE_FAILED` (an anchor write failed; `committed` says whether the journal had already changed), `GENERATION_EXHAUSTED`, `ANCHOR_PATH_UNRESOLVED` and `INVALID_INPUT`.
- **Anchor limits.** At most 4,096 bytes, and a `pending` slot must be the next generation of the same project. An anchor with `pending` null is 385 bytes for the project ID `project-a`, as the probe measured, 504 for a 128-character project ID, and at most 942 with `pending` set.
- **Anchor directory check.** Each directory is resolved once, component by component, through the supplied filesystem. Empty and `.` components are skipped. Optional `realpathSync` is used until its first failure; fallback inspects components with `lstatSync` and expands symbolic links with optional `readlinkSync` before processing subsequent components, including `..`. It never retries realpath on a remaining physical alias/`..` spelling. Relative targets require an observed parent directory and start there; absolute targets start at their root. At most 40 links and 4,096 non-dot components are processed. Ordinary missing suffixes retain their spelling without creating directories; an unobserved missing prefix before `..` is refused. Virtual aliases with usable complete directory names retain their physical parents even if a spelled ancestor is absent. The resolved journal directory plus the original final file name is used for the check and all journal reads and writes; the final file is not dereferenced, so the store can still refuse a symlink. The resolved anchor directory is used for the check and its file.
  The guard refuses a contained directory with `ANCHOR_INSIDE_JOURNAL_DIR`. It additionally compares exact device/inode identities through physical POSIX parents using literal `/..`, preserving macOS volfs, case and Unicode normalisation alias checks. On Windows it takes string parents only after expanding directory links, preserving checks for case and 8.3 aliases when usable identities are available. Missing, null, negative or unsafe numeric identities, and inode 0, prove nothing. Without canonical resolution, every existing ancestor needed to establish separation must have a usable identity. An unreadable or unresolvable link, unknown ancestry, a repeated non-root identity without canonical proof, or an exhausted traversal bound returns `ANCHOR_PATH_UNRESOLVED` before file I/O. The identity walk is capped at 4,096 steps. Canonical resolution can still establish a legitimate sibling relationship when identities are unavailable. A bind mount of a journal subdirectory whose mounted parent chain never reaches the journal directory can evade this walk. There remains a symlink swap window between the check and the write: replacing a resolved directory or an ancestor can redirect a later open or rename. Hosts must prevent those changes; the check is not a directory-handle sandbox.
- **Generation ceiling.** A write, and a re-anchor, is refused with `GENERATION_EXHAUSTED` before anything changes when the next generation would not be a safe integer; a pending anchor is not promoted in that case.
- **Retry.** A rename that fails with `EPERM`, `EBUSY` or `EACCES` is tried up to 5 times, waiting 10, 20, 40 and 80 ms. The tests inject `EPERM` and `EBUSY`. It was not seen on Windows.
- **Hash strings.** The strings of section 3 were re-derived by a separate script written from this document and matched the module's output before the golden vectors of test 16 were recorded.
- **Not covered.** R2, Windows hardware and Windows file-system behaviour, latency of the anchored write, and Design 3.
