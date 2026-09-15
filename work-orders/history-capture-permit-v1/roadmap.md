# Private history-capture admission roadmap

**Overall Nisi: 30% (3/10 NX milestones). This slice: 100% (5/5 bounded items).**
This file scopes the work order; `/Users/louiscalata/nisi-next-private/roadmap.md`
remains the canonical product roadmap and owns milestone acceptance.

- [x] Freeze the exact contract and adjudicate Claude/independent-test ambiguities.
- [x] Retain red31/31 failures and deeper5/6 regression before the catch-path fix.
- [x] Integrate the single-use written-declaration/source-digest admission wrapper.
- [x] Pass37/37, kill7/7 deliberate mutants, pass1368/1368 canonical product checks;
  preserve234 selected pins and both older v1 sources.
- [x] Verify actual file write/fsync/readback and fresh-process reopen with synthetic
  data, plus one-use/revocation/no-raw-content behavior.

Accepted source: `history/history-capture-permit-v1.mjs`, SHA256
`96c2bb7d7503b6fc92237e0b250d83b66257cd3d76695d2f89c3afb99e52b08d`.

Evidence:

- `.build/history-capture-verification-LWb99c/verification.json` (canonical root).
- `.build/history-permit-real-store-9GFtBT/verification.json` (canonical root).
- `evidence/red.txt`, `evidence/adjudication-red.txt`, `evidence/adjudication.md`.
- `evidence/opus-contract-response.json`, `evidence/opus-source-response.json`.

## Handoff — do not silently widen this contract

The wrapper's inputs are already-supplied text plus a trusted written declaration.
It does not acquire user consent, open source files, authenticate a process, write
the native incident ledger, delete stored rows, or wire the UI/background runner.
The pre-fix implementation-draft.mjs is HISTORICAL EVIDENCE, not a copy to integrate.
Existing owner/projector/importer and v1 APIs remain unchanged. New source is not
in the staged-package allowlist and has no new package-level type/export contract.

Next: a bounded host source acquisition/declaration interface, then explicit caller
migration and stored-history lifecycle. Separate reviewed native incident bridge
must preserve the retained closed schema, scope/currentness and non-authorizing
guarantees. Operational observations must not be coerced into confirmed model failures.
Use the canonical roadmap's NX-05/U02-04 gates; this slice does not close them.
