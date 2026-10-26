---
packet: nisi-track1-fix-imports-and-input
project_root: ~/nisi/work-orders/parallel-seven-tracks-v1/track1
created_by: codex
created: 2026-09-17T11:43:00-07:00
write_owner: opencode
status: blocked
---

# Track 1 — close should-fixes 6 and 9, correct the README, re-submit the oracle

## Context

Source of truth: findings 6 and 9 plus the Notes section of the
"Cross-review (Claude, adversarial, second pass, 2026-09-14)" section of
`README.md` in this directory, and the final "Next (OpenCode, in this directory
only)" paragraph.

Finding 6: the static allowlist is bypassed by dynamic `import()` and re-export
(`dyn-import-lane`, `reexport-engine`, `dyn-net-socket` all pass 10/10 today),
it matches only `import … from`, it admits eight specifiers the runner never
imports, and the runtime guard misses `net.Socket.prototype.connect`.

Finding 9: the input is not a closed shape — `{endpoint, authorModel,
reviewerModel}`, `{reviewHistory:true}`, `{reviewIncidents:true}` and
`{inject:{staticOwner:{check: throws}}}` all COMPLETE today, while every product
module it drives `exact()`s its input.

The Notes section also records two false claims that must be corrected rather
than preserved: README items 1-2 overstate what the inert run proves (the tests
owner never sees the baseline; reordered exact bytes COMPLETE), and
`README.md`'s STATUS and the "Defect 5" disposition line assert repairs the
second pass measured false.

This is the last lane packet: it must leave `npm test` green and end with the
re-submission line the review asks for. Oracle first. No installs, no network,
no model calls, no commits, no edits outside this directory.

## Items

### P1 — Add the finding-6 and finding-9 slices
- **files**: findings-f6-import-allowlist.test.mjs, findings-f9-closed-input.test.mjs, package.json
- **do**: Create `findings-f6-import-allowlist.test.mjs` (new file): collect static `import … from`, dynamic `import(…)` (require a string literal; fail on non-literal, `createRequire`, `process.binding`), and re-export `export … from` specifiers from the runner source; assert every specifier is in an exact sorted allowlist equal to the runner's real specifier set (replace any `>= 8`-style count bar), and fail on any model-lane, socket or process module. Add the runtime guard assertions: `net.Socket.prototype.connect`, `tls.TLSSocket.prototype.connect`, `dgram.createSocket`, `http2.connect` and `dns.lookup`/`resolve` are instrumented or refused when reached, while a legitimate owned-root write still succeeds. Create `findings-f9-closed-input.test.mjs` (new file): assert each of the four unclosed shapes from finding 9 throws/reports `RUNNER_ARGS` with no side effect, that `{sources}` and `{inject:{testsOwner}}` remain the only test-only seams and are documented as such, and that a valid exact input still COMPLETES. Add scripts `"test:f6": "node --test findings-f6-import-allowlist.test.mjs"` and `"test:f9": "node --test findings-f9-closed-input.test.mjs"` to `package.json`, changing nothing else.
- **accept**: npm run test:f9

### P2 — Enforce the allowlist and the closed input shape in the runner
- **files**: repository-fixture-runner.mjs
- **do**: In `repository-fixture-runner.mjs`: add `exact(input, ['parentRoot','profile', …present optional keys], 'RUNNER_ARGS')` for the top-level input and `exact(input.inject, ['testsOwner'], 'RUNNER_ARGS')` for the inject seam, refusing every unknown or review-shaped key before any side effect; instrument the socket/dgram/http2/dns entry points the oracle names; make the runner import nothing outside that exact allowlist and add no dynamic or re-exported specifier. Do not remove any existing refusal, assertion or safety behaviour. `npm test` must stay green.
- **accept**: npm run test:f6
- **needs**: P1

### P3 — Correct the README and re-submit the oracle for review
- **files**: README.md, readme-truth.test.mjs, package.json
- **do**: Create `readme-truth.test.mjs` (new file) that reads `README.md` and asserts: the STATUS line states the true current state after findings 1-9 (no "all 9 findings repaired" claim), items 1-2 no longer assert that the inert tests owner sees the baseline or that reordered exact bytes refuse, the Disposition "Defect 5" line no longer claims assertions that a stub can fabricate, every finding 1-9 has a disposition line that names its slice file, and the file ends with a dated `ORACLE READY FOR REVIEW` line. Then edit `README.md` to satisfy it: append a dated paragraph titled `## Re-submission (OpenCode, <date>) — findings 1-9 closed, slices green` that lists each slice, its script and the observed counts, states honestly that these are new hardening slices beside the protected oracle and that the integrator may fold them in at promotion, and ends with `ORACLE READY FOR REVIEW`. Add script `"test:readme-truth": "node --test readme-truth.test.mjs"` to `package.json`. Correct only claims the review measured false; never delete the review text itself.
- **accept**: npm run test:readme-truth
- **needs**: P2

## Packet acceptance

npm test
