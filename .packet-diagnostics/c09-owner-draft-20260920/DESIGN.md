# C09 owner correction contract — private, isolated, not accepted

Progress remains finish70% / NX30%. C07 checkpoint: `2aa0aeb3132f362fbb0b1c2fda10b51cb8431927`.
Fable's retained C09 draft is preserved separately. This directory contains exact
`before/` copies and a separately owned `candidate/`; no canonical C09 files are
released. Root owns canonical integration. Luna may edit only the three candidate
consumer files below. No model, network, installation, native execution or commits.

## Hold disposition and original outcome

The owner has inspected the actual writer `scripts/check-private-package.mjs`
and the private package contract:29 packaged files,12 consumer files,8 TypeScript
consumers,73 expected negative locations,11 runtime tests. `/usr/local/bin/node`
is currently v24.18.0. The inspected Node22 paths have no approved executable.
The real receipt remains `nisi-private-package-rehearsal-v1`; do not invent new
fields in that retained schema or change its writer to fit a test.

This resolves the schema/runtime-choice hold **for isolated correction only**.
Canonical packet dispatch remains held. The goal remains actual Node22 and
Node24 consumer evidence for the same archive. A synthetic matrix, a missing
Node22 row, or this owner document cannot complete that outcome. Provisioning
Node22 and executing either real rehearsal require a separate bounded owner run.

## Allowed candidate paths

- `work-orders/v02-finish-cluster-v1/consumer/runtime-matrix-v1.mjs`
- `work-orders/v02-finish-cluster-v1/consumer/runtime-matrix-v1.test.mjs`
- `work-orders/v02-finish-cluster-v1/consumer/README.md`

Everything else in `candidate/` and everything in `before/` is read-only context.
Retain the exports and pure-reader architecture. No child processes, filesystem
access, downloads, inference or acceptance authority in the production reader.
Every regression is in the named existing test file (the frozen test:c09 target).

## Frozen correction requirements

1. Bound input size and array lengths. Reject ordinary and revoked Proxies before
   prototype/descriptor/own-key operations at every object/array boundary using
   `node:util` proxy detection. No getter or proxy trap may run. Descriptor reads
   must not coerce caller values. Keep named errors and deeply frozen outputs.
   Exact successful inventories: rows2, package maps29, case map12, TS cases8,
   runtime cases4, negative locations73, checks35, typeRoots1. Parsing caps before
   per-element processing: array128, plain-record keys64, map keys64; field/key/
   path/argument strings8192 UTF8 bytes, stdout2MiB, stderr256KiB, diagnostic
   matches512. Receipt text remains4MiB. Missing/partial failed receipts may have
   smaller inventories, never a successful row. Reject oversized collections and
   strings before sorting/matching their contents; these are resource bounds,
   not hostile-writer or memory-isolation guarantees.
2. A positive row requires retained receipt **text**, not merely a parsed object.
   Parsed objects may be inspected with `readRehearsalRecord`, but the public
   matrix must not award them PASS. Cap receipt text at4MiB. Retain original text
   SHA256 and UTF8 byte length; invalid text, missing/failed/unsupported/skipped
   rows stay visibly non-PASS. Null durations and unknown tokens stay null.
3. Positive rows require a closed `expected` contract with:
   `sourceManifest`, `stageManifest`, `caseManifest`, `toolchain`,
   `negativeLocations`, `notBefore`, `notAfter`, `observations`.
   The first three maps contain exact file-to-hash pins. Toolchain uses the exact
   writer's toolchain fields. Negative locations are unique `{file,line}` pairs
   derived by the owner from the pinned TypeScript cases, not receipt counts.
   Times are explicit ISO cutoffs; reject observations outside the window.
   `observations` has exactly node22/node24, each null (not observed) or
   `{receiptSha256,receiptByteLength,node,archive}`. Node uses writer node fields;
   archive is `{sha256,byteLength}` independently captured by the owner. Missing
   expected proof must remain non-PASS, never implicit current-source proof.
   Exact window: `notBefore <= observedAt <= completedAt <= notAfter`, inclusive
   at both endpoints; inverted windows refuse. These compare receipt claims only.
   Actual process start/close times belong to the separate owner capture below.
4. Match source, staged, case and toolchain pins exactly. All package inventories
   equal the imported29-file contract; case inventory is12/8/4. All non-metadata
   staged files equal their source bytes. Do not accept an internally coherent
   but stale receipt or a receipt/Node/archive identity substituted after capture.
5. Require exactly one npm pack, one archive inventory,29 exact archive extraction
   checks, one install, one positive TS, one negative TS and one runtime check.
   Verify their order, executable, cwd and exact argv against the real writer,
   including all strict compiler flags, NodeNext/ES2022, typeRoots and case order.
   Unknown/duplicate/missing checks or ignored extra flags cannot supply PASS.
   All checks terminate cleanly; only the negative TS check has expected exit2.
6. Verify pack JSON identifies the expected filename and exact package inventory.
   Verify tar inventory output has the exact package entries, and every extraction
   output hash matches the stage/archive entry. Do not trust entries-only claims.
   The writer's extraction stdout is decoded UTF8 text; this comparison has the
   same text scope. It does not independently reconstruct arbitrary binary entry
   bytes. The separate owner capture hashes the actual `.tgz` bytes.
7. Re-derive negative file+line locations from retained stdout. Require each of
   the73 expected locations at least once, and reject duplicate diagnostics used
   to substitute for missing locations. Extra distinct diagnostics at expected
   locations can be retained only with truthful observed counts; no unexpected
   file/line may pass. Runtime TAP has one unambiguous plan/summary, exactly11
   tests/pass and zero failed/cancelled/skipped/TODO; contradictory duplicates fail.
8. Cross-runtime archive identities agree; separate runtime/executable/receipt/
   evidence identities remain required. Do not treat coincident timestamps alone
   as proof of shared execution; exact recorded run identities matter. A pure
   reader cannot authenticate the observer. Output explicitly remains
   `authorizing:false`, `executionAttested:false`,
   `sourceAuthenticityAttested:false`, scope
   `CALLER_SUPPLIED_REHEARSAL_EVIDENCE_ONLY`. Actual independent capture and owner
   acceptance remain mandatory. Bare npm/tar executable provenance is not attested.
   Freeze acceptance now: a separate retained owner-capture artifact must bind
   exact receipt bytes/hash/length after writer close, actual archive bytes/hash/
   length before and after inspection, resolved Node path/hash/version before
   and after execution, observed child PID/start/close, exact command/cwd and
   capture timestamps. Actual start/close must fall inside the declared window.
   Acceptance controls must pin both that artifact and its expected contract.
   The pure reader's caller-supplied pins alone never establish independent
   execution. No synthetic fixture can stand in for either runtime's capture.
9. Preserve/adapt existing adverse cases; positive fixtures must include complete
   synthetic archive bytes and externally supplied expected pins. Cover each
   missing/wrong tar role, every command category, stale case hash, cutoff,
   receipt hash/length, Node/archive swap, omitted pins, object receipt, duplicate
   TAP, exact negative locations and zero-trap nested/revoked proxies.

## Mutation interpretation

B10 needs a discriminating accessor regression (source and archive manifests).
N6's removed receipt-hash clause and N25's removed null-TAP guard currently have
equivalent observable behavior. Preserve clarity but do not claim killed mutants
or production defects without a discriminating counterexample. The new independent
receipt binding must have its own wrong-hash regression.

## Verification and next action

The owner inspects candidate source before executing tests. Execute the same
new oracle against before and after sources in owned scratch trees, retaining
raw failures. Run exact independent review and Nisi deterministic validation.
No C09 acceptance until required actual runtime evidence and controls are done;
no percentage increase for writing this proposal or for synthetic fixtures alone.
