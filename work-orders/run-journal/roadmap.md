# Run journal v1 — isolated work order

Canonical product scope: [Nisi roadmap](../../roadmap.md), U02-04 and its parallel-ready history contract. This work order owns only this directory. Actual host integration waits for U02-02.

- [x] Read packet spec/authoring, queue identity policy and existing integrity/receipt boundaries.
- [x] Freeze the complete observational contract and protected tests.
- [x] Verify green baseline, red journal pre-state and packet lint.
- [x] Execute local OpenCode and retain each receipt, log and source snapshot: three attempts, all BLOCKED.
- [x] Owner source review, protected-file verification and final measured checks: actual source remains the placeholder.
- [ ] Claude cross-review of the implementation and separate product integration decision.

No host storage, disk durability, fsync, locking, incident qualification, receipt issuance, generated execution, automatic retry, product acceptance, commit or publication is implemented or authorized by this work order. Serialization is a pure data boundary. The payload retention bound does not bound permanent identity metadata. Measured outcome will be appended after execution.

## Measured outcome — 2026-09-13

**BLOCKED.** The contract, protected tests and reviewed reference are available;
OpenCode did not implement or install the actual source in any attempt. The
original run plus both user-authorized reruns are exhausted. No fourth attempt,
tier switch, direct source installation, commit or push occurred.

All selected-tier preflights passed and reported the model loaded. Requested
route: `local/lmstudio/qwen/qwen3.8-27b` through the installed `packet` agent.
OpenCode session metadata records that provider/model; this is not independently
authenticated served-model identity. Every final response ended `finish: length`
with 7,999 reasoning tokens, zero answer-output tokens and no source write call.

| Attempt | Packet correction | Elapsed seconds | P1 | Baseline | Receipt |
|---|---|---:|---|---|---|
| 1 | Complete original contract | 619.008 | FAILED, exit 1 | exit 0 | [run 1](evidence/run-01.result.md) |
| 2 | Require small incremental writes | 666.018 | FAILED, exit 1 | exit 0 | [run 2](evidence/run-02.result.md) |
| 3 | Mechanically install exact reviewed reference | 604.569 | FAILED, exit 1 | exit 0 | [run 3](evidence/run-03.result.md) |

Total wrapper wall time: **1,889.595 seconds**. All revisions linted **OK**, one
item each, with `npm run test:journal` as discriminating acceptance and `npm test`
as packet acceptance. The [final receipt](.packets/nisi-run-journal.result.md)
remains `outcome: blocked` / `P1: FAILED`. Its baseline exit 0 is not journal
acceptance. No total token or time savings are claimed.

Pre-state and final actual-source checks are identical: baseline **2/2 PASS**;
journal **0/18 PASS, 18 FAIL**, no skipped/cancelled tests. Source diffs are empty.
Protected journal tests, baseline tests and local package.json match their
pre-state SHA-256 values. The source still throws NOT_IMPLEMENTED.

### Reference and reviews — separate from actual source

The [reference text](evidence/packet-reference-candidate.txt) was drafted by Luna,
then read and corrected by Astra. Corrections covered redaction traversal,
signed payload numbers, retry refusal semantics, retained null payloads, array
symbols/prototypes/index traversal, Unicode keys, frozen outputs and canonical
parsing. Daybreak found no additional confirmed blocker after those corrections.
The duplicate-key scanner was removed because exact canonical comparison already
rejects duplicate keys. A footer-report wording ambiguity was resolved in the
packet before the last lint/run.

Only the reference was exercised through in-memory module import redirection:
**18/18 unchanged protected tests + 7/7 supplemental probes PASS**. This did not
write source or alter/weaken the protected tests. See
[reference validation](evidence/reference-validation.json). The final packet
includes these exact reference bytes but the executor still wrote nothing.

Fable's initial design review succeeded, with reported `claude-fable-5-1` and
auxiliary `claude-haiku-4-5-20251001` usage; elapsed 106.601 s, reported cost
USD 0.41229825. Its later code-review request produced **NOT_RUN** after the
USD 0.50 request cap, with no usable verdict and unavailable usage in that result.
That is not a successful Claude source review. Cross-review with the parallel
Claude work order remains open; its directory was not inspected or modified.

The [history mutant runner](scripts/test-history-mutants.mjs) and supplemental
owner probes are prepared, but actual-source mutants and a fresh-process
persisted reopen fixture are **NOT_RUN** because the actual source is absent.
No durable storage, restart/crash qualification, incident eligibility or host
integration is claimed. U02-02/U02-04 product acceptance remains unchanged.

### Final SHA-256

| File | SHA-256 |
|---|---|
| `.packets/nisi-run-journal.packet.md` | `3a97daea6e19e964ada329c3b8ef9f0ed487b3e2dcf45451f5af934ee69cd849` |
| `tests/run-journal.test.mjs` | `25355f0d280a262243f1fe707fd4e0de5fc795926ce37d910c40a12721390c6d` |
| `tests/baseline.test.mjs` | `adb784891764841fe628e00b0aa9d9fdf025035e659aaacdedd766cafa81b8d3` |
| `src/run-journal-v1.mjs` (placeholder) | `c9a4cc003509d25ec798f80233c0460e89f52ec6df7e454e4133139df65d96a5` |
| `evidence/packet-reference-candidate.txt` | `dee9f490c091000b2560cd9464d945885e7f341091b87dde9ae4f2b7cdbd359e` |

Full measured summary: [final verification](evidence/final-verification.json).
Next decision for Louis: authorize a separately scoped direct installation and
actual-source acceptance, or investigate the local output-budget failure before
authorizing another packet. No next step is silently started here.

- [x] 2026-09-13 11:50 PDT (Claude, co-author, installer): installed the reviewed reference byte-for-byte (sha256 dee9f490c091000b2560cd9464d945885e7f341091b87dde9ae4f2b7cdbd359e) as `src/run-journal-v1.mjs`; `npm run test:journal` 18/18, `npm test` 2/2; deterministic receipt DONE naming the reference authors and the installer. Local executor root cause per Astra: `finish: length` at 7,999 reasoning tokens, zero output tokens — the model output cap; fixed in Claude tooling separately. Astra review of the installed source still open.

## Product integration — Astra, 2026-09-13

- [x] Integrate the reviewed reference at `history/run-journal-v1.mjs` with
  `tests/run-journal.test.mjs` and `scripts/test-history-mutants.mjs`.
  Louis authorized this integration in the Claude session at approximately
  12:00 PDT: "Go for it"; Astra is the sole product writer.

The accepted installed source equals the reviewed reference and the product
copy byte-for-byte: SHA256 before/after
`dee9f490c091000b2560cd9464d945885e7f341091b87dde9ae4f2b7cdbd359e`.
Astra read the installed source, checked both hashes, and verified all 18/18
relocated protected tests; only the module import changed. Daybreak's fresh
read-only integration review found no additional pure-source blocker.
The product mutation runner changes only its source/oracle location, oracle hash
and evidence output setup to the product `.build` convention; it does not edit
canonical source or assertions. Measured result: 8/8 mutants CAUGHT; all eight
runs execute 18 tests, with failed counts 6, 3, 1, 5, 1, 1, 1, 1 respectively,
zero skipped/cancelled. Original runner and work-order files remain unchanged.

This supersedes the earlier source-absent / actual-source-mutants-NOT_RUN / owner
review-open status. Claude Fable 5.1's post-integration source review remains
pending, so the original compound Claude-review checkbox is still open.
The [canonical integration evidence](../../docs/verification/2026-09-13/five-work-order-integration/receipt.json)
retains the exact placement hashes and measurements. Host integration, durability,
fresh-process persisted reopen/crash qualification and incident admission remain
open. This is the pure U02-04 contract slice only; no milestone closure.
