# Claude Opus 5 review + mutation pass — hosts/repository/native-incident-source-v1.mjs (Track 2) — 2026-09-14

Adversarial workflow: 2 finder lenses, 1 mutation agent (8 one-site mutants), 2 refuters per candidate, synthesis. 14 agents, read-only; mutants under .build/nis-mutants-review/. Not the Swift bridge, native execution or milestone acceptance.

SCOPE: static + probe + mutation review of hosts/repository/native-incident-source-v1.mjs (87 lines) and its retention seam in hosts/repository/reviewed-workflow-v1.mjs, against work-orders/native-incident-source-v1/{design-request.md,source-review-request.md}. NOT a review of the Swift bridge, native execution, DeterministicGateRunner rerun, or milestone acceptance; macos-build-plan.md's "explicitly leaves the Swift bridge unproven" stands. The five reviewed files are untracked in git (`??`) and were not modified by this review; all probe/mutant writes stayed under /Users/louiscalata/nisi-next-private/.build/nis-mutants-review/. Baseline re-run at synthesis time: 31/31 pass.

VERDICT: ACCEPT (as a private-source-payload component, with two documented test-oracle gaps carried to the open Track 2 pin/mutation receipt).

CONFIRMED SOURCE DEFECTS: none. Zero of five claims survived adjudication; each was reproduced mechanically, none violated a quoted contract sentence on in-boundary input.

REFUTED (record only, one line each; full reasoning already on file):
- :79 catch-all reason mapping echoes a caller-thrown closed-set code (needs a lying Proxy on context; "Hostile proxies are outside this boundary"; no dependency in the 18-file import closure throws any closed-set literal).
- :35 prefix-match mutant M30 survives (source correct: strict `r.rowId===rowId` after 64-hex gate; test-strength gap, see survivors below).
- :66 TOCTOU on child.stdoutHex via Proxy leaf (unreachable through structuredClone/JSON; production path passes cloneFreeze'd null-prototype tree; the proposed fix is bypassed by a stateful Proxy).
- :79 `error?.code` re-throw on a two-layer poisoned Proxy (nothing issued, thrown value is the attacker's own Error; out of boundary).
- :17 shallow-freeze mutant survives (source correct: cloneFreeze deep-freezes and copies; test-strength gap, see survivors below).

MUTATION TABLE (harness: M0 null mutant 31/31, canary schemaVersion bump kills 11, single module instance verified):
| id | site | semantic | caught | failing tests |
| M1-brand-skip | :30 | disable preview WeakSet brand check | yes | 1 (source:33) |
| M2-digest-drops-preview | :76 | drop previewSha256 from source-plan digest | yes | 1 (boundaries:27) |
| M3-cap-off-by-one | :55 | `>` -> `>=` KERNEL_ARTIFACT_CAP | yes | 2 (boundaries:19, :23) |
| M4-issued-always-true | :23 | isIssued... -> `()=>true` | yes | 4 (source:29,33,47; boundaries:29) |
| M5-widen-advisory-whitelist | :65 | allowedAdvisoryDimensions:['clarity'] | yes | 1 (boundaries:21) |
| M6-row-missing-code-swap | :36 | ROW_MISSING -> ROW_NOT_FAILURE | yes | 2 (source:37; boundaries:29) |
| M7-public-envelope-shallow-freeze | :17 | cloneFreeze -> Object.freeze on public envelope | NO | 0 |
| M8-host-clones-retained-plans | reviewed-workflow-v1.mjs:136 | plans: cloneFreeze(...) instead of retained refs | yes | 12 |
Additional survivor observed during adjudication (not in the harness set above): M30 at :35, `r.rowId===rowId` -> `r.rowId.startsWith(rowId.slice(0,8))`, 31/31 pass, non-equivalent (near-miss 64-hex rowId returns SOURCE_BOUND with the wrong row and readNativeIncidentSourceInputV1 then yields that row's content).

SURVIVORS -> exact oracle test that kills each (test-only changes; source unchanged):
1. M7 (:17). Contract: design-request.md:23 "The first returns a frozen, metadata-only SOURCE_BOUND result". Kill in tests/native-incident-source.test.mjs:51 ('public selection metadata is copied and deeply frozen against later mutation') by adding: `assert.ok(Object.isFrozen(plan.selection)); assert.ok(Object.isFrozen(plan.selection.profile)); assert.ok(Object.isFrozen(plan.selection.profile.allowedAdvisoryDimensions)); assert.notStrictEqual(plan.selection.binding,row.binding); assert.throws(()=>{plan.selection.rowId='0'.repeat(64)},TypeError); assert.throws(()=>plan.selection.profile.allowedAdvisoryDimensions.push('x'),TypeError)`. Alternatively apply the recursive `frozen()` helper from tests/native-incident-source-boundaries.test.mjs:11 to `plan` (it is currently applied only to the private input at :21/:25). Why it survives today: the two existing assert.throws target plan.selection.binding.attempt and plan.selection.source.receiptSha256, which the upstream preview already froze; assertClosed (source:19) checks Object.isFrozen on the envelope only.
2. M30 (:35). Contract: design-request.md:32 "compare entire digest/data (not just row ID); select full rowId". Kill in tests/native-incident-source.test.mjs:37 ('missing, partial, malformed and noncanonical row ids refuse without fallback selection') by adding a well-formed near-miss to the loop: `[row.rowId.slice(0,63)+(row.rowId.at(-1)==='0'?'1':'0'),'ROW_MISSING']` and `[row.rowId.slice(0,8)+'0'.repeat(56),'ROW_MISSING']`. Why it survives today: every rowId in the 31 tests is rejected before :35 by the hex/exact gate or HOST_NOT_SETTLED, or shares no 8-hex prefix with a real row.

CHECKED AND SOUND (probe-verified, in-boundary):
- Input gate: `exact` (integrity/record-utils.mjs:9-16) rejects accessor descriptors and extra keys; `hex` typeof-gates rowId; INVALID_INPUT for '', null, 'x', 63-char, uppercase, extra keys.
- Preview authority: WeakSet brand (:30) plus whole-preview stableStringify rebind against createRepositoryIncidentPreviewV1({bundle,context}) (:33-34); structuredClone'd preview -> INVALID_PREVIEW; cloned/cross-run context -> INVALID_EVIDENCE/ROW_MISSING.
- Row selection: strict full-string equality after 64-hex gate; ROW_MISSING on near-miss (canonical source).
- Stage/group/file binding: UNSUPPORTED_STAGE, SOURCE_MISMATCH on groupFingerprint, path, byteLength, sha256, malformed UTF-16, and priorReport.status!=='FAIL' (:37,:51-56,:66-67).
- Cap: 1 MiB exact is SOURCE_BOUND, 1 MiB+1 is ARTIFACT_LIMIT (:55; M3 killed).
- Profile closure: fixedProfile reused with allowedAdvisoryDimensions:[], modelParticipationRequired:false, maximumAdvisoryDimensions:0 (:65; M5 killed).
- Digests: source-plan digest covers previewSha256 (M2 killed); three native hashes match canonical domains (boundaries:27).
- Public envelope: cloneFreeze deep-frozen copy, rawContentIncluded:false, persistable:false, nativeRerun:'NOT_RUN', executionVerified:false, learningEligible:false, authorizing:false; recursive raw-content/path/stdout/report exclusion (boundaries:23).
- Private payload: WeakMap-keyed on the issued frozen object (:77); serialized/cloned plans have no authority (M4 killed); private input deep-freeze pinned (M1-payload variant killed by 2 tests).
- Closed reason set: every REFUSED reason is in the ten-code Set; foreign codes collapse to INVALID_EVIDENCE (:22,:79); no dependency in the 18-file transitive import closure throws any closed-set literal.
- Host seam: reviewed-workflow-v1.mjs:134-136 retains original-issued plans/bundle (M8 killed by 12 tests); :167-173 exposes only {rowId}, spreads into a plain object, HOST_NOT_SETTLED before settlement; bare catch never dereferences the error.
- No raw source in exception messages or envelope on any refusal path probed (design-request.md:28).

OPEN (carried, not blocking): PAUSED-HANDOFF.md Track 2 "no final pin/mutation/full-suite receipt" remains accurate; the two survivor kills above are the concrete content of that receipt. Full-suite run and Swift-bridge rerun/transcript comparison (design-request.md:70-72) were not exercised here.
