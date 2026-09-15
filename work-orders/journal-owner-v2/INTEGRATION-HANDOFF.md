# Journal owner v2 — private integration handoff

**Overall Nisi progress: 30% (3/10).** The first owner-controlled canonical integration
slice below is now complete (5/5); it is not release or full NX-05 acceptance.

## Latest canonical integration

The reviewed source is now `history/journal-owner-v2.mjs` with exactly the accepted
hash below. Eight byte-checked source/test/helper relocations are complete, plus
the adjacent `.d.mts` owner declaration, source-checkout type consumer and a real
`history/import-fixed-xpc-observation-v1.mjs` consumer. It preserves uncertainty
and host redaction while retaining non-authorizing observation semantics.

Canonical tests: **1331/1331**, 231 selected files unchanged during acceptance.
Three saved native-test records imported/reopened on disk; no new native launch.
See the canonical roadmap and `evidence/integration-accounting.md` for receipts.
The original isolated 56-test/9-mutation evidence is preserved, not overwritten.
The new importer passed 16 checks and four targeted mutations; type tests reject
eight intended misuse sites. OpenCode's 900-second zero-edit timeout is retained
as blocked; Codex completed the exact copy after confirmed terminality, without retry.

Next owner slice: consent/source-bound host import adapter and trusted incident
admission. Automatic native/UI wiring, old v1 caller migration, staged-package
inclusion, retention/revocation governance and release approval remain open.

## Accepted candidate

Source: `src/index.mjs`, SHA-256
`54777f65338a36ca6c208fc880c8ca4013ffce675c7aede2afdc2d8fa85f4e49`.
It composes unchanged journal/store v1 serialization. There is no new disk format.
`evidence/owner-verification.json` pins 14 work-order files and current canonical
projector/fixture/protocol dependencies. Its before/after comparison is unchanged;
all 218 previously selected canonical files still match the retained product run.

| Old v1 risk | Explicit v2 behavior |
| --- | --- |
| Committed write refusal restores stale state | Clear current authority, report COMMIT_UNCERTAIN, require a new open |
| Damaged foreign-project prefix becomes visible | Project and full config binding precede any recovered-row exposure |
| Invalid UTF-8 is decoded with replacement characters | Exact byte round-trip or refuse without a prefix |
| Public journal/hash fields alter append/CAS authority | Empty frozen handle; mutable state and predecessor hash stay private |

API: `openJournalOwner({path,fs,config,now})`,
`inspectJournalOwner({owner})`, `recordJournalObservation({owner,entry,now})`.
Read the full CONTRACT.md for exact request/result shapes and lifecycle rules.
Inspection returns the last immutable publication, not live filesystem freshness.

## Reproduce before integrating

Run in this work-order directory:

```sh
npm run check
npm run test:mutants
```

Expected check count: 56 (2 baseline + 28 owner + 6 adjudication + 16 store-boundary
+ 4 current-XPC integration). Expected mutation results: eight variants each cause
at least one of 34 checks to fail; the XPC promotion mutant causes exactly 1 of 4
to fail. A successful mutation harness means the broken variant was rejected,
not that the broken code passed. All failed outputs are retained in evidence.
The store substitution fixtures are testing only; they do not add a production
dependency-injection feature. Actual temporary-disk fresh-process recovery is
covered, while XPC input remains synthetic data through real canonical parsers.

## Completed first integration slice (historical work order)

1. Recheck the exact live Claude work and protected candidate hashes. Do not touch
   `history/host-journal-bundle.mjs` or its historical work order incidentally.
2. Add the accepted source at a **new explicitly versioned** product path such as
   `history/journal-owner-v2.mjs`, preserving the frozen sibling format imports.
   Add copied/relocated tests and an explicit type contract. Do not silently replace
   public `bundle.journal`, `bundle.sha256` or old v1 response semantics.
3. A mechanical OpenCode relocation packet may be used only after exact file
   mapping, protected hashes and acceptance commands are fixed. No model may
   redesign this write authority or weaken tests during that copy.
4. Wire one read-only observation-history consumer through open/record/inspect,
   handling SEALED, STORE_CONFLICT and COMMIT_UNCERTAIN explicitly. Use the current
   XPC projector, not the older five-canary summary. Do not launch native code or
   infer authorization from a historical SUCCEEDED observation.
5. Rerun relevant product acceptance against final source hashes and record the
   exact new scope. Keep native UI, cross-process ownership, incident admission,
   retention governance, prevention evaluation and legal/release gates separate.

No cross-process lock, exactly-once guarantee, power-loss certification, automatic
retry/reconciliation, generated-code execution or new permission is supplied here.
The store's before-rename comparison is not a substitute for a cross-process lock.
All original v1 fault evidence remains valid until its callers migrate or are fixed.
