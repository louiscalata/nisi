---
packet: nisi-track1-fix-cleanup-outcome
project_root: ~/nisi/work-orders/parallel-seven-tracks-v1/track1
created_by: codex
created: 2026-09-17T11:41:00-07:00
write_owner: opencode
status: blocked
---

# Track 1 — close must-fixes 2 and 5 (cleanup truth, outcome derivation)

## Context

Source of truth: the "Cross-review (Claude, adversarial, second pass, 2026-09-14)"
section of `README.md` in this directory, findings 2 and 5, and the final
"Next (OpenCode, in this directory only)" paragraph. Read both findings before
editing; they name the exact lines, the mutants that passed (`rm-only-on-completed`,
`leak-check.mjs tree rm-denied`), and the probe that showed a CANCELLED report
with a SETTLED host labelled COMPLETED.

Hard rules for this packet: `cleaned` must never be a constant, `catch {}` must
never swallow a removal failure, and no COMPLETED status or receipt may be minted
while the owned root is still on disk. Adverse outcomes stay adverse. Oracle
first, then the runner. New hardening slices live beside the protected oracle;
never delete a discriminating assertion from `repository-fixture-runner.test.mjs`,
and keep `npm test` green.

No installs, no network, no model calls, no commits, no edits outside this
directory.

## Items

### P1 — Write the finding-2 cleanup slice, then make cleanup truthful
- **files**: findings-f2-cleanup-truth.test.mjs, package.json
- **do**: Create `findings-f2-cleanup-truth.test.mjs` (new file) proving cleanup is observed, not asserted: in T3 and T5 return `{ value, ownedExisted: fs.existsSync(value.ownedRoot) }` from inside the guard and assert `ownedExisted === false` plus an `fsp.rm` journal entry for the exact owned root; assert `typeof ownedRoot === 'string'`, `path.dirname(ownedRoot) === parent` and `/^nisi-fixture-/.test(path.basename(ownedRoot))` on the runs that create one; add a case that makes the removal throw once and assert the result reports `cleaned === false` with a populated `cleanupError` and no COMPLETED status and no retained receipt. Add script `"test:f2": "node --test findings-f2-cleanup-truth.test.mjs"` and `"test:f7": "node --test findings-f7-owned-root.test.mjs"` to `package.json`, changing nothing else.
- **accept**: npm run test:f2

### P2 — Make the runner derive cleanup from the filesystem (findings 2 and 7)
- **files**: repository-fixture-runner.mjs
- **do**: In `repository-fixture-runner.mjs`: replace every literal `cleaned: true` with a value derived from a real `lstat` of the owned root taken after `fsp.rm` (treat `ENOENT` as cleaned, report `cleanupError` otherwise), never swallow the removal error, and build the frozen outcome object only after cleanup; on COMPLETED/CANCELLED-after-root/UNCONFIRMED the returned `ownedRoot` must be the same path the runner actually removed. Move the `mkdtemp` and chmod work inside the `try` so a raw OS error cannot escape, verify the owned root is `0o700` with `lstat` instead of chmod, and return `refusalResult('OWNED_ROOT_UNAVAILABLE')` when it cannot be created. `npm test` must stay green.
- **accept**: npm run test:f7
- **needs**: P1

### P3 — Derive status, reason and receipt from the engine report (findings 5 and 8)
- **files**: findings-f5-outcome-derivation.test.mjs
- **do**: Create `findings-f5-outcome-derivation.test.mjs` (new file) adding the abort-window sweep the review specifies (a getter-flip signal over n in {0,4,8,...,28}) and asserting the invariant `status === 'COMPLETED'` only when the run settled AND `report.outcome === 'COMPLETED'` AND `report.workflowOutcome === 'COMPLETED'` AND `bundleError === null` AND `proposedChanges !== null`; otherwise CANCELLED/TIMED_OUT/UNCONFIRMED per the report, with no receipt for any non-completed run. Assert `reason === 'ABORTED'` for the pre-aborted signal and `reason === 'SYNTHETIC_SETTLEMENT'` for the injected refusal, and include both in the T2 projection. Add both reason assertions to the finding-2 slice's run shape only if it does not duplicate them. Add script `"test:f5": "node --test findings-f5-outcome-derivation.test.mjs"`. Then apply the runner change the review prescribes: compute `completed` from settled + report outcome + workflowOutcome + bundleError + proposedChanges, map status CANCELLED/TIMED_OUT/UNCONFIRMED otherwise, mint the receipt only when completed, and prefer `report.code` over `bundleError.code` when the engine stopped (CANCELLED/TIMED_OUT).
- **accept**: npm run test:f5
- **needs**: P2

## Packet acceptance

npm test
