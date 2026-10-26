# History Proxy boundary correction — private owner checkpoint

Status: **isolated implementation verified; canonical integration pending**.
Date: September 20, 2026. Owner: Codex. No publication authorization.

## Finding and correction

Caller-controlled JavaScript Proxies could trigger code while the history owner
or journal inspected request envelopes, configuration, entries, or the filesystem
capability wrapper. A revoked request Proxy could throw instead of returning a
structured refusal. This is one boundary-defect family, not 30 separate defects.

Luna's original `proposal.patch` is preserved. Independent review found that its
helper-only guards did not protect `createRunJournal(config)` or
`staged.append(req.entry, now)`: these call paths copied raw caller data first.
Its so-called nested-entry test also proxied the entry root, not nested payloads.

The owner correction adds Proxy refusal before reflection in the journal's
existing recursive `copy()`, the owner's `envelope()` and `plainCopy()`, and before
filesystem method reads. Using the existing core copy avoids duplicate snapshots
and preserves `TIME` before `ENTRY` validation, `CONFIG`/`ENTRY` error mapping,
redaction, journal formats, replay behavior, and valid null-prototype inputs.
The filesystem remains an injected trusted capability, not a deep-copied object.
This does not protect against arbitrary malicious trusted filesystem methods or
globally tampered JavaScript intrinsics, and is not an execution sandbox.

## Exact reviewed candidate

| Path relative to `candidate/` | SHA-256 |
| --- | --- |
| `history/journal-owner-v2.mjs` | `2120bf0c75d9aa6122c06a2b34d55b3256a08f024d0e5fa43d8877e4eb67e44f` |
| `history/run-journal-v1.mjs` | `0164f10da27f6d12cfd1f3d443bd8e0f7c237b46363353570ae4a759a97f749b` |
| `tests/journal-proxy-boundaries.test.mjs` | `4608d36de36c91b0318889b712e78f4971d7a2ea5c6093112e9975553ce8a1cb` |

`before/` retains the canonical originals; the same new regression file is used
against both source revisions. Neither canonical production file was changed.

## Actual checks

Latest complete check: `checks-pHQtKm/checks.json`, with raw stdout/stderr logs.

| Scope | Before | Candidate |
| --- | ---: | ---: |
| Existing owner, journal, maintenance, and store tests | 95/95 pass | 95/95 pass |
| New Proxy-boundary regressions | 11/41 pass; 30 fail | 41/41 pass |

All test runs use actual Node `v24.18.0`, zero skips/cancellations/TODOs, and
unchanged before/after source snapshots. The existing tests include a real owned
temporary-filesystem round trip and a fresh Node process. These are not a native
app acceptance test, Node22 compatibility run, product benchmark or live-model run.
Earlier narrow checks remain in `checks-U2ibvJ/` (32 maintenance + 41 new cases).

Nisi's actual three-file contract/syntax validator separately returned VALIDATED:
`nisi-validation-xtUkLM/stdout.log` and `receipt.json`. Nisi did not run behavioral
tests in that operation; the owner-run test evidence above is separate.

## Independent review

Reviewer task: `/root/sharedchami_cleanup_daybreak_review`.
Requested route/model label: Daybreak Blue; actual served identity and model
token/cost receipt are not independently available and remain UNKNOWN.
No reviewer execution or tests were claimed.

The first review rejected the original proposal's missed call paths and coverage.
The final exact-source review passed `NODE_HISTORY_PROXY_BOUNDARIES`: core `copy()`
protects direct and wrapped journal calls before any Proxy traps; tests cover all
four owner APIs, nested config/entries, function/object capability wrappers,
forged owner handles, immutable prior state, zero I/O on refusal, subsequent valid
writes, null-prototype compatibility, and clock-error precedence.

## Next integration step — do not replace historical evidence

- [x] Reproduce the defect on original source with the exact new oracle.
- [x] Correct and independently review the exact candidate.
- [x] Run 95 existing and 41 new cases, plus Nisi syntax/contract checks.
- [ ] Add a reviewed, exact two-path dependency transition for C04–C07; keep all
  old receipts/maps byte-identical. Re-run the importing restart/recovery suites.
- [ ] Explicitly update the protected store oracle's old source pins only as part
  of that reviewed transition, and rerun its fault-injection cases. It was not run
  against this candidate, and no new result is claimed for it.
- [ ] Review and test the transition's negative cases; integrate production files
  and the regression only after the live closure checks accept the exact revision.
- [ ] Refresh affected CLI/package evidence on the integrated source revision.

Current verified inventory remains finish **70% (7/10)**, NX **30% (3/10)**,
v1 **0% (0/8)**. This isolated correction grants no milestone, native, inference,
dispatch or release authority. Fable's pause and Jev key rotation remain held;
OpenCode and Spark inference did not run. No unrelated dirty files were changed.
