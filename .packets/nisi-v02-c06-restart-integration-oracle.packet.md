---
packet: nisi-v02-c06-restart-integration-oracle
project_root: ~/nisi
created_by: codex
created: 2026-09-18T17:10:00-07:00
write_owner: opencode
status: blocked
---

# C06 — Prepare restart integration acceptance without granting resume authority

> PRIVATE — OWNER INTEGRATION CONTRACT; NOT OPENCODE DISPATCH-READY.
> This new order never resets or resumes a historical executing packet.

## Context

Fresh-process bundle and journal-recovery modules already exist. Their success
is not a replayable workflow checkpoint. The owner has now frozen the bounded
`recordHostObservationV1({bundle, settled, now, ttlMs})` seam in the existing
journal-bundle module. Fable's retained contract/oracle, Daybreak's isolated
implementation, Luna's exact-source review and owner verification are retained
under `.packet-diagnostics/c06-owner-draft-20260920/`.

The owner, not an edits-only executor, integrates this public-API/persistence
change. `status: blocked` and the OpenCode write-owner field retain the
undispatched packet format; neither claims OpenCode execution or grants a writer.
The exact four-file integration scope is P1/P2 below. Cluster acceptance remains
separate and requires source-bound owner controls and canonical checks.

Milestone mapping: NX-05/NX-07. Coauthor/review assignment: Fable 5.1.
Cluster dependencies: C02, C03.
The executor receives only a contract frozen by the owner. The current order is
held until its named stop below is resolved. Source references (read-only unless
also explicitly listed in an item):

- history/host-journal-bundle.mjs
- history/bundle-restart-demo.mjs
- history/recovery-worker.mjs
- hosts/repository/interrupted-run-decision-v1.mjs
- hosts/repository/reviewed-workflow-v1.mjs
- tests/bundle-restart-demo.test.mjs
- tests/journal-restart-recovery.test.mjs

## Constraints

- One writer; inspect fresh dirty state and coordinate with Claude before handoff.
- No writes outside the item file lists. Packet/config/acceptance-control files
  are owner-managed and never executor targets.
- Never edit, format, build inside or re-pin integrations/veritas/.
- Preserve existing dirty work, historical packets, failed evidence and source IDs.
- No installation, native launch, model call, network, credentials, service changes,
  signing, publication, commits or pushes from an edit-phase packet.
- No automatic tier fallback, stale forced retry, scope expansion or invented APIs.
- Every new regression must run in the graded cluster command, not an unused file.
  Coauthored tests are not independent acceptance by themselves.
- Imported/generated code is inspected by the owner before execution.
- Hold: OWNER INTEGRATION ONLY. Do not lint, dispatch or manufacture an OpenCode
  receipt for this already-reviewed candidate. The dispatch command below must
  remain HELD (exit 2); it is not expected to pass as an executor release.
- Preserve the existing journal format, readers and legacy behavioral tests.
  Closed own-data records and primitive identities are validated before use;
  proxy/accessor hooks must not execute. The privately issued bundle selects
  storage; replacement public fields are refused. A caller-supplied host record
  establishes coherence only, never execution provenance.
- Record terminal history only. Failed writes restore exact pre-append memory,
  including its watermark. Identical identity/content/time is a non-writing
  duplicate; changed content under that identity remains a conflict.
- Source authenticity, native execution, resume, restored consent, learning,
  publication and generated-code authority remain false. Deterministic truncation
  and bounded fresh Node readers do not replace real process-death or native tests.

## Items

### P1 — Add the discriminating regression oracle
- **files**: work-orders/v02-finish-cluster-v1/restart/host-bundle-integration.test.mjs, tests/host-journal-bundle.test.mjs
- **do**: Owner integrates the reviewed real-seam oracle: exact terminal identities/outcomes; forged or tampered bundle refusal; proxy/accessor/coercion refusal; explicit storage; both existing fresh-process readers; truncated/leftover-temp evidence; stale-store and write-failure rollback including the pre-append watermark; legacy recording after rollback; no execution or consent restoration. Explicitly migrate only the old dependency/export inventory to allow node:util types Proxy detection and recordHostObservationV1; retain all prior behavior and process/network/eval/timer/ambient-clock bans. Syntax acceptance is not behavioral acceptance.
- **accept**: node --check work-orders/v02-finish-cluster-v1/restart/host-bundle-integration.test.mjs

### P2 — Implement the frozen bounded change and verify
- **files**: history/host-journal-bundle.mjs, work-orders/v02-finish-cluster-v1/restart/README.md
- **do**: Owner integrates the exact reviewed observation seam alongside the private issued-bundle WeakMap and documents its caller-supplied-data limits. Preserve all prior APIs and storage formats. Persist with the existing expected-previous-hash store; on failure restore pre-append serialization, not an empty NEW journal. No production host auto-wiring, redispatch, full workflow resume, format migration, lock/auth changes or SIGKILL session is included. After source inspection run the graded C06 command and all journal compatibility checks, and retain actual evidence separately from packet status.
- **accept**: npm run test:c06 --prefix work-orders/v02-finish-cluster-v1
- **needs**: P1

## Packet acceptance

npm test --prefix work-orders/v02-finish-cluster-v1
npm run test:dispatch --prefix work-orders/v02-finish-cluster-v1 -- C06

## Owner release checklist

- [x] Resolve the bounded observation contract; retain the original held scope in Git.
- [x] Inspect the candidate and retain independent exact-source review and Nisi validation.
- [x] Freeze the four source/test/document paths; root is the canonical writer.
- [ ] Bind the relevant test/dependency closure and extend owner acceptance controls.
- [ ] Integrate exact reviewed bytes and run the canonical graded and compatibility gates.
- [ ] Record scoped owner acceptance only when all evidence matches; keep dispatch held.
- [ ] Separately complete the remaining native/full-workflow requirements before v0.2 completion.

Original failed candidate checks remain retained. Neither this amendment nor
any subordinate PASS grants implementation, native or publication acceptance.
