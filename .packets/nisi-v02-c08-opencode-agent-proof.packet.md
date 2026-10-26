---
packet: nisi-v02-c08-opencode-agent-proof
project_root: ~/nisi
created_by: codex
created: 2026-09-18T17:10:00-07:00
write_owner: opencode
status: blocked
---

# C08 — Qualify an actual OpenCode agent task using Nisi advisory tools

> PRIVATE — STAGED, NOT DISPATCH-READY. HARNESS_REVIEW_AND_LIVE_OPT_IN.
> This new order never resets or resumes a historical executing packet.

## Context

Prior 6/6 live smokes call the installed tool directly, not an OpenCode agent. Current online/packet routes resolve to local Qwen; role labels do not prove model identity. Installed files outside the repository are read-only here. Same-model review gives zero independence credit.

Milestone mapping: NX-04/NX-09. Coauthor/review assignment: Codex.
Cluster dependencies: none.
The executor receives only a contract frozen by the owner. The current order is
held until its named stop below is resolved. Source references (read-only unless
also explicitly listed in an item):

- hosts/local-models/opencode-orchestration-v1.mjs
- tests/opencode-orchestration-v1.test.mjs
- work-orders/opencode-local-orchestration-v1/live-smoke.mjs
- work-orders/opencode-local-orchestration-v1/verify-local.mjs

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
- Hold: Capture/inspect a supported event envelope and exact command before freezing reader tests. Default acceptance is offline only; live smoke does not authorize arbitrary generated-code execution.

## Items

### P1 — Add the discriminating regression oracle
- **files**: work-orders/v02-finish-cluster-v1/agent/agent-evidence-v1.test.mjs
- **do**: Test a read-only structured agent-event evidence reader against inspected supported OpenCode JSON envelopes: valid bounded synthetic-data task; missing tool invocation; wrong candidate/task/model; missing/nonterminal events; failed process; usage unknown; tool-only trace falsely offered as full agent proof. No live inference during lint. Freeze the actual CLI event schema from an approved tiny capture first; do not assume tool-output formats. Create the named test only after the owner resolves the hold. Syntax acceptance here proves only a parseable oracle; behavioral acceptance is P2.
- **accept**: node --check work-orders/v02-finish-cluster-v1/agent/agent-evidence-v1.test.mjs

### P2 — Implement the frozen bounded change and verify
- **files**: work-orders/v02-finish-cluster-v1/agent/agent-evidence-v1.mjs, work-orders/v02-finish-cluster-v1/agent/agent-evidence-v1.test.mjs, work-orders/v02-finish-cluster-v1/agent/README.md
- **do**: Implement only the offline reader and explicit manual execution instructions for a synthetic retry-config.json task. Require observed nisi_local_status/work tool events plus exact returned candidate bytes, actual deterministic checks and terminal process evidence. Preserve advisoryOnly, accepted:false and tests NOT_RUN from model output; actual checks are separate. No self-review quorum, automatic file application, secrets, model swaps or global config edits. Owner invokes the live agent separately with reviewed command and bounds, retaining source/config hashes and unknown telemetry.
- **accept**: npm run test:c08 --prefix work-orders/v02-finish-cluster-v1
- **needs**: P1

## Packet acceptance

npm test --prefix work-orders/v02-finish-cluster-v1
npm run test:dispatch --prefix work-orders/v02-finish-cluster-v1 -- C08

## Owner release checklist

- [ ] Resolve HARNESS_REVIEW_AND_LIVE_OPT_IN; collect current source hashes and confirm write ownership.
- [ ] Review contract/oracle, freeze exact allowed paths and candidate acceptance.
- [ ] Resolve each dependency with source-bound acceptance; no stale DONE reuse.
- [ ] Replace the cluster's staging latch only through a separately reviewed owner
      change; executor may not change it or skip its command.
- [ ] Mark this new packet ready, then run real packet-lint (it executes commands).
      Baseline must pass; each item accept must fail before implementation.
- [ ] Dispatch one writer on the explicitly selected local route; no duplicate work.
- [ ] Inspect real receipt, scope diff, graded tests and adverse cases. Required
      independent review/native checks remain distinct from receipt completion.

