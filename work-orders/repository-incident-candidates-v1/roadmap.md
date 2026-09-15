# Repository incident candidates — private work order

**Overall Nisi: 30% (3/10 milestones). This slice: 100% (5/5 deliverables).**

## Accepted

- [x] Closed, source-bound per-check projection with original-issued validation.
- [x] Real host `incidentPreview()` integration without old history/report changes.
- [x] 25 focused tests, including genuine failed→repair fixture, interruption,
  mixed operational evidence, conflict identity and isolated projection failure.
- [x] Opus design/source review, Daybreak independent tests and native-boundary
  audit, Luna actual-host fixture, Codex corrections and final acceptance.
- [x] 1535/1535 product checks, 19/19 relocated controls, six semantic mutations,
  260 selected hashes unchanged; prior host sole deliberate old-file change.

| Evidence | Result |
| --- | --- |
| [Contract](CONTRACT.md) | Exact schema, classification, identity and non-authorizing scope |
| [Design response](claude-design-response.json) | Useful proposal with corrections documented below |
| [Source review](claude-source-response.json) | Opus PASS; no tests executed by reviewer |
| [First retained focused check](../../.build/repository-incidents-focused-BL3dcQ/verification.json) | 17/23; new fixtures still incorrect |
| [Final focused check](../../.build/repository-incidents-focused-eDSoNd/verification.json) | 25/25, stable selected source |
| [Rejected mutation proof](../../.build/repository-incident-candidates-verification-Zd4mTd/verification.json) | Runtime-only refusal correctly not credited as semantic detection |
| [Final acceptance](../../.build/repository-incident-candidates-verification-9Hh64Z/verification.json) | 1535/1535; mutant assertion counts 2,1,1,3,2,1; no skips/cancellations |

The independent verifier first passed 1534/1534. Root inspected it, reran it, then
added the missing same-identity/different-content assertion and updated only that
new test's pin/count. Final acceptance is 1535; earlier receipts remain historical.

## Reproduce locally

```sh
node work-orders/repository-incident-candidates-v1/verify-focused.mjs
node work-orders/repository-incident-candidates-v1/verify.mjs
```

These run deterministic synthetic-adapter tests and the portable product suite,
not a model, native app or Windows reviewer. The full verifier binds the previous
252-pin receipt and permits only the declared host edit plus eight new files.
The oracle/control/mutants use the same original-issued dependencies; their
relocation does not replace issued expectations with JSON lookalikes.

## What the capability provides

Call `host.incidentPreview()` on the existing repository owner after settlement.
It returns per-file static rows and per-suite Node rows, in engine stage order.
The exact versioned contract is in CONTRACT.md. A preview never dispatches work,
stores data, grants consent or changes the workflow verdict. A future importer
must not treat a serialized row or aggregate v1 history as execution authority.

## Corrections and scope

Opus proposed an occurrence key containing candidate and stage index while
claiming it remained stable across repair: those changing fields were excluded.
The suggested REPAIRED label, truncated output and anonymization inference from
run-derived salts were not adopted. Hashes remain explicitly linkable.

Test corrections preserved production validation: skipped Node work has no
issued row; the original storage-failure helper started with a passing candidate;
a PASS-to-PASS mutation was no mutation; null-prototype plain data is legitimate;
Node history must retain exact preparation/error fields; mixed static groups
stop after operational error; extra context keys are invalid. New fixtures now
exercise these scenarios honestly. Root added pending-fixture cleanup, exact
host FAIL→PASS assertions, old capture refusal semantics, injected projector
failure isolation and same-row content conflict. Existing tests were not changed.

Source hashes:

- projector: `3468b78bd5617d1c69905dfd34a90cebf457f7aa935751c9195610493c269359`
- host: `26a4589dbedd7d6b266bfb3fef5f54842fdfa6356df5dadea35b7380b1a26bde`

> [!WARNING]
> **FAILURE_CANDIDATE is not root cause, independent recurrence or learning.**
> The checked adapters are trusted statements, not authenticated execution.
> A later PASS does not prove resolution. All authority/influence flags are false.

> [!CAUTION]
> **No native incident or persistent candidate was written.** The imported native
> adapter and aggregate history format are untouched. Separate exact permission,
> project isolation, current lifecycle checks, native rerun and admission remain
> required. Preview freshness means settled snapshot only; hashes are not privacy.

## Next work, not completed by this slice

1. Explicit selected-candidate storage with scoped identity, source digest,
   one-attempt admission, truthful uncertainty, and fresh lifecycle checks.
2. Versioned Node/native transport and native input reconstruction/rerun without
   widening the imported v1 contract or claiming Node/native result equivalence.
3. Reopened incident attribution, current revocation/retention, then paired
   prevention evaluation and independently approved influence (OFF by default).

Keep private. No package export/allowlist change, install, commit, push, public
artifact, device/authentication change or release approval is part of this work.
