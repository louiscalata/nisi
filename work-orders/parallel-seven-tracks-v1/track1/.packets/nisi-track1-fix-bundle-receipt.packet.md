---
packet: nisi-track1-fix-bundle-receipt
project_root: ~/nisi/work-orders/parallel-seven-tracks-v1/track1
created_by: codex
created: 2026-09-17T11:40:00-07:00
write_owner: opencode
status: blocked
---

# Track 1 — close must-fixes 1 and 4 (bundle re-read, receipt binding)

## Context

Source of truth: the "Cross-review (Claude, adversarial, second pass, 2026-09-14)"
section of `README.md` in this directory, findings 1 and 4, and the final
"Next (OpenCode, in this directory only)" paragraph. Read those two findings
before editing; they name the exact modules, line numbers, arguments and
assertions. Nothing else in the repository is in scope.

Order is fixed by that review: **oracle first, then the runner.** This packet may
add new hardening slices beside the protected oracle; it must never delete a
discriminating assertion from `repository-fixture-runner.test.mjs`, and it must
keep `npm test` green (the protected oracle is 10/10 right now).

The review's second pass is not satisfied by literals that a stub can fabricate:
the new assertions must read real product objects through the product reader
`receipts/repository-run-v1.mjs` (`readRepositoryRunBundleV1`) reached as
`../../../receipts/repository-run-v1.mjs`.

Do not weaken, delete or skip anything. Do not add placeholder manifests, do not
install dependencies, do not touch `../../../../tests/`, `hosts/`, `examples/`,
`receipts/` or the frozen Veritas import. No network, no model calls, no commits.

## Items

### P1 — Add the finding-1 bundle re-read slice to the oracle
- **files**: findings-f1-bundle-reread.test.mjs, package.json
- **do**: Create `findings-f1-bundle-reread.test.mjs` (new file) holding the finding-1 assertions: in the same settled-run shape as the protected oracle's T1 and T8, re-read the bundle through the product reader `readRepositoryRunBundleV1(h.bundle, { report: h.report, preparation: prepared.repaired, suite: fixture.suite, nodeRegistrationFingerprint: h.bundle.nodeRegistrationFingerprint, plans: h.staticHistory.map(x => x.plan), groups: h.staticHistory.map(x => x.group), executions: h.testHistory.map(x => x.execution) })` and assert `status === 'CONSISTENT'`, `finalChecksRecordedPass === true`, `testCount === 1`, `recordedTestPasses === 1`, `fingerprint === h.bundleSummary.fingerprint`; assert `h.proposedChanges.changes` deep-equals the single `{path:'retry-settings.mjs', kind:'MODIFY'}` entry whose before/after sha256 are `manifest[0].sha256`/`manifest[1].sha256`; assert `h.staticHistory.map(x => [x.plan.binding.attempt, x.group.adapterResult.status])` deep-equals `[[0,'FAIL'],[1,'PASS']]`; assert `h.testHistory[0].workspace.root.startsWith(result.ownedRoot + '/nisi-task-')`. A runner that fabricates the bundle must make this file fail with the product reader's own error. Add two scripts to `package.json`: `"test:f1": "node --test findings-f1-bundle-reread.test.mjs"` and `"test:f4": "node --test findings-f4-receipt-binding.test.mjs"`. Change nothing else in `package.json`.
- **accept**: npm run test:f1

### P2 — Retain preflight.json and bind the receipt (finding 4)
- **files**: findings-f4-receipt-binding.test.mjs, repository-fixture-runner.mjs, package.json
- **do**: In `repository-fixture-runner.mjs`: retain `preflight.json` (the exact five-entry manifest plus the reviewed source fingerprint) FIRST, write every retained file with `flag: 'wx'`, and derive each retained record's sha256 from the bytes actually written; add `reviewedSourceFingerprint`, `bundleFingerprint` and `reviewDefaults: {history:false, incident:false}` to the receipt, and mint the receipt only for a run that the packet's finding-5 slice would call completed. Add `findings-f4-receipt-binding.test.mjs` asserting: `receipt.runId === hostResult.report.runId`, `receipt.candidateFingerprint === prepared.repaired.candidateFingerprint`, `receipt.workflowOutcome === 'COMPLETED'`, both new fields present and correct, `retained.map(r => r.path)` deep-equals exactly `['preflight.json','engine-report.json','host-result.json','runner-receipt.json']` (and without the receipt when no receipt is minted), each `sha256 === sha256(JSON.stringify(<surfaced object>, null, 2) + '\n')`, and that the journal writeFile set equals the retained set. If the protected oracle's retained-name assertion becomes false because of the added `preflight.json`, correct exactly that assertion in `repository-fixture-runner.test.mjs` and change nothing else there. `npm test` must stay green.
- **accept**: npm run test:f4
- **needs**: P1

## Packet acceptance

npm test
