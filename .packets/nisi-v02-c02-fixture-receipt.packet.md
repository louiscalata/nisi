---
packet: nisi-v02-c02-fixture-receipt
project_root: ~/nisi
created_by: codex
created: 2026-09-18T17:10:00-07:00
write_owner: opencode
status: blocked
---

# C02 — Bind fixture receipts to real product bundles and actual retained bytes

> PRIVATE — OWNER INTEGRATED, INERT FIXTURE SCOPE ONLY; NOT DISPATCH-READY.
> This new order never resets or resumes a historical executing packet.

Owner amendment, September 20: the reviewed Fable snapshot was integrated
with Codex/Daybreak completion binding and independent Luna/owner adverse tests.
The local owner, not an OpenCode edit-phase process, owns this integration.
`status: blocked` continues to prohibit execution/retry; do not manufacture a
packet result. Final source-bound acceptance is recorded separately in cluster.json.

## Context

Retained second-pass review findings 1/4: the old ten-test oracle admitted a fabricated bundle stub, stale receipt bindings and wrong hashes. The runner is inert and does not execute a real model or native child. Existing executing packets are historical adverse evidence; this is a new order, not a reset.

Milestone mapping: NX-04. Coauthor/review assignment: Fable 5.1.
Cluster dependencies: none.
The executor receives only a contract frozen by the owner. The current order is
held until its named stop below is resolved. Source references (read-only unless
also explicitly listed in an item):

- work-orders/parallel-seven-tracks-v1/track1/README.md
- work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.mjs
- work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.test.mjs
- receipts/repository-run-v1.mjs

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
- Hold: Owner reviews the new oracle before implementation dispatch and the exact diff afterward; C03 is still needed for cleanup/outcome truth.

## Items

### P1 — Add the discriminating regression oracle
- **files**: work-orders/parallel-seven-tracks-v1/track1/findings-cluster-receipt.test.mjs
- **do**: Add an independently inspected oracle that re-reads h.bundle with readRepositoryRunBundleV1(h.bundle,{report:h.report,preparation:prepared.repaired,suite:fixture.suite,nodeRegistrationFingerprint:h.bundle.nodeRegistrationFingerprint,plans:h.staticHistory.map(x=>x.plan),groups:h.staticHistory.map(x=>x.group),executions:h.testHistory.map(x=>x.execution)}). Assert CONSISTENT, finalChecksRecordedPass true, testCount and recordedTestPasses 1, fingerprint equal h.bundleSummary.fingerprint. Assert exact retry-settings.mjs MODIFY before/after hashes and static attempt/status [[0,'FAIL'],[1,'PASS']]. A fabricated bundle must fail a semantic assertion. Create the named test only after the owner resolves the hold. Syntax acceptance here proves only a parseable oracle; behavioral acceptance is P2.
- **accept**: node --check work-orders/parallel-seven-tracks-v1/track1/findings-cluster-receipt.test.mjs

### P2 — Implement the frozen bounded change and verify
- **files**: work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.mjs, work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.test.mjs, work-orders/parallel-seven-tracks-v1/track1/findings-cluster-receipt.test.mjs, tests/fixture-receipt-completion.test.mjs
- **do**: Retain preflight.json (manifest plus reviewedSourceFingerprint) first, then engine-report.json and host-result.json, then completion-only runner-receipt.json. All writes exclusive; compute retained digest and byte length from actual written/re-read bytes. Bind receipt runId, repaired candidateFingerprint, reviewedSourceFingerprint, bundleFingerprint and reviewDefaults:{history:false,incident:false}. Assert exact written/retained sets, EEXIST handling and wrong-run/stale-candidate/digest mutants. Change only the old exact retained-name assertion where needed; do not weaken other oracle assertions. This packet does not fix cleanup or install the runner in production.
- **accept**: npm run test:c02 --prefix work-orders/v02-finish-cluster-v1
- **needs**: P1

Owner completion clarification: SETTLED is a drain fact, not successful task
completion. Independently re-read the actual product bundle using issued evidence
and the original tests owner's registration. Require COMPLETED engine/workflow,
the exact repaired candidate/preparation, matching run and bundle fingerprints,
and finalChecksRecordedPass true. Ineligible settled runs retain no completion
receipt. Add bounded fresh-Node dependency faults for genuine cancellation after
tests, noncompleted/wrong-run/stale reports, fabricated bundles and false or
misbound summaries. Add first/last-record readback failure probes. These are
test-harness Node processes, never real model or native-checker execution.
Retained records acknowledge pre-cleanup reads, not durable storage; C03 still
owns cleanup reporting. Every added test runs in test:c02.

## Packet acceptance

npm test --prefix work-orders/v02-finish-cluster-v1
npm run test:dispatch --prefix work-orders/v02-finish-cluster-v1 -- C02

## Owner release checklist

Owner-only completion: source-bound C02 fixture acceptance is recorded in
cluster.json after independent review, 33 graded checks and retained adverse
mutation evidence. This supersedes the edit-phase release steps below for this
candidate; they remain unperformed because OpenCode did not execute this packet.
C03–C05 and native acceptance remain open. Do not relabel this packet DONE or
run it again to obtain an executor receipt for already-integrated owner work.

- [ ] Resolve ORACLE_REVIEW_REQUIRED; collect current source hashes and confirm write ownership.
- [ ] Review contract/oracle, freeze exact allowed paths and candidate acceptance.
- [ ] Resolve each dependency with source-bound acceptance; no stale DONE reuse.
- [ ] Replace the cluster's staging latch only through a separately reviewed owner
      change; executor may not change it or skip its command.
- [ ] Mark this new packet ready, then run real packet-lint (it executes commands).
      Baseline must pass; each item accept must fail before implementation.
- [ ] Dispatch one writer on the explicitly selected local route; no duplicate work.
- [ ] Inspect real receipt, scope diff, graded tests and adverse cases. Required
      independent review/native checks remain distinct from receipt completion.
