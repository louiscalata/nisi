# Claude Opus 5 post-integration review — afternoon of 2026-09-13

Adversarial workflow: 3 finder lenses → 2 independent refuters per candidate → synthesis. 30 agents, read-only, diff vs checkpoint 1179f1b. Not milestone, isolation or release acceptance.

POST-INTEGRATION REVIEW — nisi-next-private, afternoon integration vs checkpoint 1179f1b (2026-09-13)

Scope: static review plus read-only node probes of the diff/untracked additions relative to 1179f1b. This is not milestone acceptance, isolation acceptance or release acceptance. No product-code defect survived refutation; all confirmed defects are test-bookkeeping or evidence-bookkeeping.

VERDICT: ACCEPT_WITH_DEFECTS

CONFIRMED DEFECTS (each survived two independent refutation attempts)

1. [low, tests] /Users/louiscalata/nisi-next-private/tests/native-canary-adapter-baseline.test.mjs:27-28
   What: the migrated adapter baseline pins sha256 444acc75... of the LIVE product module hosts/macos-xpc/native-canary-adjudicator.mjs under the title "baseline frozen fixtures are byte-identical to the accepted sources". The work-order original pinned the vendored copy (../src/, cf875eaa...); the mechanical path rewrite (five-work-order-integration/receipt.json, 2 occurrences) silently changed the assertion to "the product module never changes". No in-file provenance comment; only literal sha256 pin of a product module in tests/. It already churned once today (cf875eaa -> 444acc75, formatter-display-escape/receipt.json:40-47) and caused two wrong re-pins of sibling work-order baselines that had to be reverted.
   Evidence: probe appending one comment line to the live module in memory yields a hash != pin, so any adjudicator edit fails the ADAPTER suite at line 28 (the adjudicator's own baseline pins nothing). Test passes as-is today.
   Fix: drop the adjudicator readFile+pin at lines 27-28 (keep the stdout fixture pin at 31-33); if a tripwire is intended, move it to tests/native-canary-adjudicator-baseline.test.mjs with a provenance comment and an accurate title.
   Owner: Astra (product tests/).

2. [medium, bookkeeping] /Users/louiscalata/nisi-next-private/roadmap.md:4050-4051 and :4186
   What: canonical roadmap states, present tense and without an appended correction, that "A narrow Louis decision is pending for the two literal changes `24` to `27`" and "product suite currently 1,159/1,160, with this sole failure" (the latter in the open-risk table). Both lines were added since 1179f1b.
   Evidence: tests/private-package-contract.test.mjs:9 already asserts length 27 (5/5 pass; PRIVATE_PACKAGE_FILES.length probe = 27); closing-corrections.md records the 24->27 application (177193ff... -> 2fc26ef9...) and 1160/1160 then 1163/1163; formatter-display-escape/receipt.json:161-163 records npm run check 1170/1170. `grep -n '1160\|1163\|1170\|closing-corrections' roadmap.md` returns nothing. The roadmap was edited after the decision was applied (14:44 PDT edit added line 3948) yet these lines were left as-is. Repo convention for stale status is an appended dated follow-up (cf. roadmap.md:36).
   Fix: append a dated follow-up under the U02-08 section and next to :4186 stating the 24->27 change was applied (closing-corrections.md), suite 1170/1170 per docs/verification/2026-09-13/formatter-display-escape/receipt.json; do not rewrite the retained text.
   Owner: Astra (roadmap.md is a product file).
   Note: the original claim cited README.md:23 for 1170; only receipt.json carries that figure. Refuters rated this low; kept medium because the canonical status document reports a failing suite and an open decision that do not exist.

3. [medium, bookkeeping] /Users/louiscalata/nisi-next-private/work-orders/run-journal-store/evidence/SHA256SUMS (lines 17, 47, 48, 50) and evidence/verification.md:117-118, verification.json:76-77
   What: after the post-review fix recorded at work-orders/run-journal-store/roadmap.md:53 (src fa1817d9 -> 1356028b, tests 7190d7d2 -> 304909a7, 16 -> 17 tests), evidence/protected-sha256.json was re-pinned but SHA256SUMS and verification.md/json were not. roadmap.md:11 is ticked as having recorded the hashes in both files.
   Evidence: `cd work-orders/run-journal-store && shasum -a 256 -c evidence/SHA256SUMS` -> 4 FAILED (src/run-journal-store-v1.mjs, tests/run-journal-store.test.mjs, evidence/protected-sha256.json, roadmap.md). Reconstruction proves stale-not-corrupt: `head -n 52 roadmap.md` hashes to b7557960... (manifest value) and protected-sha256.json with 304909a7 -> 7190d7d2 substituted hashes to 41dbd70c.... `node --test tests/run-journal-store.test.mjs` = 17/17. No header/date/superseded annotation, unlike the convention used in native-canary-adapter/handoff-claude-20260913/SHA256SUMS. The triggering cross-review file evidence/claude-crossreview-via-astra-20260913-1515.md is absent from the manifest.
   Fix: regenerate evidence/SHA256SUMS from current bytes (or append dated "superseded by" lines retaining the originals, per the adapter convention), add the cross-review file, and append a post-fix hash/17-test line to verification.md and verification.json.
   Owner: Astra (run-journal-store is outside Claude's two owned work orders; Claude owns only work-orders/native-canary-summary and work-orders/fixed-run-journal-entry).

CHECKED AND SOUND (candidates raised and refuted; no action required)
- hosts/macos-xpc/native-canary-adjudicator.mjs:227 displayField escape set: exhaustive U+0000..U+10FFFF sweep shows 0 unescaped Cc, Bidi_Control or line terminators; Cf/zero-width pass-through is the documented, tested out-of-scope class (REPORT.md:61-63; display test "non-control Unicode remain readable"). No Cf survivor forges a second Overall: line.
- displayField TypeError on non-string fields: only reachable with hand-built out-of-contract rows; JSON round-trip of real results renders identically; accepted in codex-opus-takeover/REPORT.md:122-124.
- Unescaped overall/verdict/expectedOutcome/numeric slots: enum/integer-constrained by adjudicateFixedCanaries; every caller formats in-process output; declared design at line 224-225.
- tests/native-canary-table-display.test.mjs: 7/7 pass on real module; backslash-escape rule is enforced by test 5. Residual (optional, low): no positive assertion pins the `\u000a` rendering, so a delete-controls mutant survives; consider one assert.match on the documented rendering.
- hosts/macos-xpc/native-probe-summary.mjs newline pass-through: contract-mandated verbatim rendering of a trusted display view; no product caller yet; 14/14 tests pass.
- tests/run-journal-baseline.test.mjs and tests/native-probe-summary-baseline.test.mjs: dropped package.json assertions are documented in closing-corrections.md addendum; SHA-256s match; originals still enforce them in work-orders. Hygiene regex breadth (randomInt/getRandomValues not blocked) is a tripwire preference; the frozen module hash dee9f490... and 18-test oracle are the real guards.
- roadmap.md:3947-3948 (cf875eaa placement hash + "verification pending"): historical checkpoint row plus dated correction; agrees with the receipt hash chain. Residual: no follow-up line links formatter-display-escape/ PASS_SCOPED; fold into the fix for defect 2 if desired.
- roadmap.md:4032-4033 ten->eleven / 16->18 in-place edit: accurate, disclosed in receipt.json roadmapEditAccounting, original bytes retained in before/ copies.
- roadmap.md:4081 "16/16 store tests": dated packet-installation checkpoint, pins no hash; work-order roadmap :53 carries the 17/17 delta and is the linked canonical record.

Suite state observed: root check 1170/1170 (per receipt), private-package-contract 5/5, run-journal-store 17/17, canary table/display 13/13, adapter baseline passes as pinned.

## Disposition (Astra)

2026-09-13 — Requested corrections 1–5 applied and their required checks passed in order; this append records item 6. Astra (Codex) was the sole writer in this pass. The retained Claude review above is unchanged; Daybreak Blue and Luna supplied read-only advisory checks in this session. No fresh Claude review is claimed.

1. **Adapter baseline:** removed the live adjudicator `readFile` and SHA-256 assertion from `tests/native-canary-adapter-baseline.test.mjs`; retained the stdout fixture length/hash and exported-function checks. No replacement product tripwire was added. `tests/native-canary-adjudicator-baseline.test.mjs` remains byte-identical at SHA-256 `6ce47a651d8139e198b7b3d585229913481832004ffbaa03e7941306643b185e`. `node --test tests/native-canary-adapter-baseline.test.mjs tests/native-canary-adjudicator-baseline.test.mjs`: exit 0, **5/5 PASS** (3 adapter + 2 adjudicator), fail/cancelled/skipped/todo all 0, duration 34.330417 ms.
2. **Canonical roadmap:** appended two dated follow-ups after the historical inventory paragraph and the corresponding open-risk row. Each links the applied `24` → `27` correction in `docs/verification/2026-09-13/five-work-order-integration/closing-corrections.md` and the **1170/1170** result in `docs/verification/2026-09-13/formatter-display-escape/receipt.json`. Removing only those additions reproduces the original roadmap SHA-256 below. All **13** lines containing `30%` remain unchanged, including the **one** exact `30% — 3 of 10` headline.
3. **Run-journal-store evidence:** appended dated post-fix records to `evidence/verification.md` and `evidence/verification.json`, preserving the historical Markdown prefix and existing JSON records. The current store rerun was `node --test tests/run-journal-store.test.mjs` from `work-orders/run-journal-store`: exit 0, **17/17 PASS**, fail/cancelled/skipped/todo all 0, duration 162.692417 ms. In `evidence/SHA256SUMS`, six superseded records (the four previously stale entries plus both amended verification files) retain their original hash/path text as comments; dated superseded-by annotations and current active records are appended. This preserves the adapter handoff's historical-supersession convention while allowing raw `shasum -c` to check current state. Added the retained cross-review to the manifest. Final `shasum -a 256 -c evidence/SHA256SUMS`: exit 0, **51/51 current-state records OK**, no warnings. The first checksum pass also verified 51/51 but warned about an inserted blank line; removing that blank line produced the final clean result. JSON parsing and preservation of the old records were verified. Source, store tests, protected-hash file, work-order roadmap and cross-review bytes were not edited in this pass.
4. **Display hardening:** added exactly one positive `assert.match` in the existing escape-distinguishability test, requiring the table line `Unexpected operations: extra\u000aInjected: text` with the literal six-character `\u000a` sequence. The edit also removed one terminal blank line. `node --test tests/native-canary-table-display.test.mjs`: exit 0, **7/7 PASS**, fail/cancelled/skipped/todo all 0, duration 42.54875 ms. No test was added, so the suite denominator is unchanged. No delete-controls mutant was executed in this pass.
5. **Root verification:** `npm run check` from the repository root: exit 0, **1170/1170 PASS**, suites 0, fail/cancelled/skipped/todo all 0, duration 7090.798791 ms. Structural check: **8/8 mutation fixtures caught**, **8/8 allowed cases**, **0 source findings**, status `PASS`.
6. **Review disposition:** appended this dated section to `docs/verification/2026-09-13/afternoon-integration-review/claude-review-report.md`; its original prefix is retained. Pre-disposition SHA-256: `5072480b75cf2f541a7dbc968ea5d975b5bffe4e4fc3a17d560dbc6938f58c85`. The full post-append file hash is reported separately in the final response to avoid a self-referential checksum.

Full-file SHA-256 changes made in items 1–4:

| File | Before this pass | After this pass |
| --- | --- | --- |
| `tests/native-canary-adapter-baseline.test.mjs` | `894e6d2e48fd0696908a236b1b5adce504d0e9ee5fe54800dd250cf24ffc2a7a` | `52db252c30a1d6badeb7c3a0015ea0921e231564cec5e8691f4c8dee460132c5` |
| `roadmap.md` | `98b5573731564b91eb377ac2bf1da7043591fb20e20c35f79ff652e8ca0dee11` | `e9aa7539faa41a15d4a7c35bbef057d20d4cc127f3bd78e6ffdaa3b265dead29` |
| `work-orders/run-journal-store/evidence/SHA256SUMS` | `b121a93d4c9b256706f52263e1560a7359318aee2016003e9c10ae56678277f8` | `625d21ad631bd9d5c91bea048f2aa2072d3b3494639bfb96a3d57fc9e6511266` |
| `work-orders/run-journal-store/evidence/verification.md` | `ab2eef26c17dcbdbeb7c35311675eb2f414f861f0fe015a45da56e851436d466` | `17ff011fd2eb305ec94e34257f9a221a38a13a51b9d7a5437363a6d4dc123b77` |
| `work-orders/run-journal-store/evidence/verification.json` | `8d7d6dcc22c619091756db2e3f45be824d1c6bb202f952d82996865f7050d6d8` | `9a97934ca8a0534216061632876d6cc063de1b1534b52f033e83b2b3c9f93f16` |
| `tests/native-canary-table-display.test.mjs` | `3738bcb8799b299ed26ff7bd9d8aaf9dfdeebb5a58c45da09534cf3706ceda6d` | `c4fc57b7360eaf0bd94acd5145840ea5881c76486da08ac8eff9b2836a18efaf` |

Historical → current checksums reconciled by item 3 (these underlying files were already fixed and were not edited in this pass):

| File | Superseded recorded SHA-256 | Current SHA-256 |
| --- | --- | --- |
| `work-orders/run-journal-store/evidence/protected-sha256.json` | `41dbd70cfd777e1c55c97fc469aa8eba06a3558203aab30b5a4e430c78b24b60` | `1a4d6ff43fe7b06d86fba965f8a1dcefa604279867f3260296bb60a823c59733` |
| `work-orders/run-journal-store/roadmap.md` | `b7557960fe757fdfa53f1003ae3f4df667ad4c9c466e0bd0cce7eb6366ecf33e` | `6f227ea1dc7089f734681cf447d8b414e7ccf40dce9f6b7fd7d2b7d891dc0a32` |
| `work-orders/run-journal-store/src/run-journal-store-v1.mjs` | `fa1817d924471cbf6307f9583c5f513f6e6aa97eee61ce8445f9addc13c1163a` | `1356028b65f9f8b96e3b9ec8ba3bfbb4968092af53d00e8b5dfdb11b161f4792` |
| `work-orders/run-journal-store/tests/run-journal-store.test.mjs` | `7190d7d212f8c2012b8978057e6a5e2314ff2bbeee29e69a377ff9bdc36e4834` | `304909a7275e04fd1af8d38a5ec16a21027e415c4cb6c4422d86dc8ec246969a` |

Added manifest entry: `work-orders/run-journal-store/evidence/claude-crossreview-via-astra-20260913-1515.md`, SHA-256 `0d28770c87a2e4bb844147cd10abbd587183f92fba4464332f1278dbaf3014f4`; its bytes are unchanged.

**Scope limitation:** an additional whole-checkout hash comparison did not match: the inventory outside the named edit candidates grew from 832 to 834 files during this pass, with recent activity under other work-order paths, including `work-orders/journal-restart-recovery`. That aggregate comparison is inconclusive for this session's write scope because the shared checkout was changing concurrently. It is not a passing whole-checkout immutability check. Edits were paused for read-only diagnosis; all write commands in this session targeted only the six named files above and this report. The named-file review and all required executable checks passed. No unrelated files were reverted or repaired.

**Not claimed:** no product implementation change, commit, push, model-load command, packet execution or canvas edit in this session; no writes to `work-orders/host-journal-bundle`, `work-orders/fixed-run-journal-entry` or `work-orders/native-canary-summary`; no fresh exhaustive Unicode sweep, fresh independent Claude acceptance, native/Windows acceptance, generated-code isolation acceptance, journal host integration, crash/durability qualification, release acceptance or milestone closure. Overall roadmap progress remains **30% — 3 of 10**. Prior review verdicts and historical test counts remain retained evidence, not newly rerun claims.
