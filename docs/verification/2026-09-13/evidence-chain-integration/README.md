# Evidence-chain integration — 2026-09-13

**STOPPED_FINAL_SCOPE_AUDIT.** The four accepted modules, fixtures, eight migrated tests and helper are installed, all requested checks passed, and the append-only roadmap additions are in place. The final whole-tree scope audit then found an unrelated pre-existing file changed since the pre-state snapshot. No further integration action was taken; this receipt and README report the stop honestly.

Unexpected file: `work-orders/windows-future-20260913/packs/usage-table/tests/acceptance.test.mjs`. This integration did not write or revert it. Its writer is unknown. Before SHA256: `0d594a693f25421fd87b371eaaf91a67985d12bd24a9c664ad01b8546cdf39bc`; reporting-snapshot SHA256: `2c66e069ed0d59f2a1cf3c31b738ddf2500ddfdc846a25830c0684f7abe418dc`. See [scope-audit.json](scope-audit.json).

Authorization: Louis’s **“Autointegrate”**, **2026-09-13, Claude session**, explicitly carried forward in the user instruction. Astra (Codex) was the sole integration writer. Retained Claude preflight files supplied the exact target test bytes; Luna performed a bounded read-only migration review. No new Claude invocation, model-load command or packet run occurred.

Pre-state means the live dirty tree, not Git HEAD. All 22 placement targets were absent. All modules, data fixtures, package fixtures, tests and the helper were installed with `cp`. The eight tests exactly match `preflight-tests/`.

| Verification | Actual result |
|---|---|
| Pre-state `npm run check` | 1170/1170; fail/cancelled/skipped/todo all 0 |
| Integrated `npm run check` | 1230/1230; fail/cancelled/skipped/todo all 0 |
| Structural contract, before and after | PASS; 0 source findings; 8/8 mutations caught; 8/8 allowed snippets clean |
| `npm run test:types` | Exit 0; six TypeScript consumers |
| `npm run check:private-package` | Exit 0; PASS_SCOPED; exact 27-file archive and installed inventory |
| Installed archive TypeScript | Six consumers pass; 39/39 expected negative diagnostics detected |
| Installed archive runtime | 8/8; fail/cancelled/skipped/todo all 0 |
| Final whole-tree scope audit | FAILED: unrelated pre-existing work-order test drift; integration stopped |

Structural PASS concerns the existing `canonical/canonical-json-v1.mjs` pure-region contract; it is not a scan of the new modules. The private archive excludes `hosts/macos-xpc/` and `history/`. Archive SHA256: `d368985e340002993046fdcba14501ba804993fcdc32154d1f88480339e2cbd3`. Normal generated rehearsal output remains under `.build/private-package-6XXmhf`; its receipt is also copied here.

| Work order | Functional | Baseline | Total |
|---|---:|---:|---:|
| native-canary-summary | 10/10 | 3/3 | 13/13 |
| fixed-run-journal-entry | 8/8 | 3/3 | 11/11 |
| run-journal-store | 17/17 | 2/2 | 19/19 |
| host-journal-bundle | 14/14 | 3/3 | 17/17 |
| **Total** | **49/49** | **11/11** | **60/60** |

Per-file test counts are included in the full product check; passing names were matched to the migrated declarations. Each of the four modules matches its user-supplied SHA256 before and after `cp`.

| Placed file (absent before) | SHA256 after |
|---|---|
| `hosts/macos-xpc/native-canary-summary.mjs` | `92590f11d91071fb7d5c1a0208958ef7c094d06a723fd38c5827fc63e6fb9c41` |
| `history/fixed-run-journal-entry.mjs` | `ba888a4f4d5b1b78f799045e44fbdfe79b75545847ab9b3ed2673fd7b353585c` |
| `history/run-journal-store-v1.mjs` | `1356028b65f9f8b96e3b9ec8ba3bfbb4968092af53d00e8b5dfdb11b161f4792` |
| `history/host-journal-bundle.mjs` | `97b2554b7fe50812fcb0065197964967d2beefc0c8cb322a38154ec16ebb9894` |
| `tests/fixtures/native-canary/inherit-run-service-raw.json` | `00f76c88284738036b884c8242dbfa59c52f207bb2398a71d12798e591387d64` |
| `tests/fixtures/fixed-run/summary-canaries-not-matched.json` | `855b60f16c134943e9b04bbdc6c5385f686991728161d1ae58052b5e894f9ddf` |
| `tests/fixtures/fixed-run/summary-identity-unavailable.json` | `2468510c52d2ff361a68fc9c636361d73995d5453a9db3bf4b804ced9ae9bbf2` |
| `tests/fixtures/fixed-run/summary-observed.json` | `a00dce2160b6f271080f1297b6f426c958205dc20a1369a2671c2c657bb4e8ad` |
| `tests/fixtures/fixed-run/summary-timeout.json` | `2d9180eb8a0d5fb6083489b1298fd23c26281df7c92ed85d74895d63e5bbd407` |
| `tests/fixtures/native-canary-summary-package.json` | `048871064d5309de15f799a75945aade84d6f9bf6e44f05e22836f0767d580ea` |
| `tests/fixtures/fixed-run-journal-entry-package.json` | `d165304f582275ed7132a577eab58c305b5d0cff88a6e5dcbf24230b87aa6747` |
| `tests/fixtures/run-journal-store-package.json` | `42bed7239d3e46cf5f4952e03bd2295d63d3af1368c34f8b285ae77937c42e94` |
| `tests/fixtures/host-journal-bundle-package.json` | `1e3e8fa0baa6c87457c7eb55b4ddf117f9e256328f35288f3bde7915be6d4d87` |
| `tests/native-canary-summary.test.mjs` | `438d4b3240895525f0fd0bb51f0f1cbe1e86de8dfa847f358aa734025c3e8aaa` |
| `tests/native-canary-summary-baseline.test.mjs` | `1cfdb066f5a451bc31bf79dadafc53fe2bbc2e44f9f8af60fa2db6e207842a23` |
| `tests/fixed-run-journal-entry.test.mjs` | `2f28c6a1d5834049d33a454ef24a4d5242eda723ce106359d2dcc357568325c4` |
| `tests/fixed-run-journal-entry-baseline.test.mjs` | `00f26ae85558cfd634c7cd329cae4b3dfe2d18bd3495cb329613a0ea877d49b4` |
| `tests/run-journal-store.test.mjs` | `f1caa70d02795044583ed1c872657970662f527afd1dee7eb788d31e59254360` |
| `tests/run-journal-store-baseline.test.mjs` | `71e9a74adbfe349a75cf6f982aacf6ff496b1f2b4a829b25f5d71f1e09543fb5` |
| `tests/host-journal-bundle.test.mjs` | `9973b1375f1aaa658796de6b482ff900069eccf0326bb8901213e69b116f4105` |
| `tests/host-journal-bundle-baseline.test.mjs` | `8930bb2bd82a4d8ac57ee30360a362e1a9714afbaf99f54b58a730ddab2ba962` |
| `tests/helpers/memfs.mjs` | `e202da18a120645ccdf6c51da48843f64ca90b6af48e87d3fdcb5cda0f9319c0` |

Reused unchanged stdout fixture: `tests/fixtures/native-canary/inherit-run-node.stdout`, SHA256 `51612e7ba818bfe7dd2a42d46e8c0cf8e84332d63f2562132842e9879bc3dddc`.

All eight retained diffs compare product tests with their work-order originals. Reconstruction using only path substitutions and deletion of frozen source-pin entries produced exactly the retained preflight bytes. Fixture hash literals, package assertions and behavioral assertions are unchanged. No frozen-copy module pin was reattached to a product path.

| Test | Path substitutions | Dropped pins | Total edits | Diff |
|---|---:|---:|---:|---|
| `native-canary-summary.test.mjs` | 4 | 0 | 4 | [diff](native-canary-summary.test.mjs.diff) |
| `native-canary-summary-baseline.test.mjs` | 4 | 2 | 6 | [diff](native-canary-summary-baseline.test.mjs.diff) |
| `fixed-run-journal-entry.test.mjs` | 5 | 0 | 5 | [diff](fixed-run-journal-entry.test.mjs.diff) |
| `fixed-run-journal-entry-baseline.test.mjs` | 6 | 1 | 7 | [diff](fixed-run-journal-entry-baseline.test.mjs.diff) |
| `run-journal-store.test.mjs` | 1 | 0 | 1 | [diff](run-journal-store.test.mjs.diff) |
| `run-journal-store-baseline.test.mjs` | 3 | 0 | 3 | [diff](run-journal-store-baseline.test.mjs.diff) |
| `host-journal-bundle.test.mjs` | 9 | 0 | 9 | [diff](host-journal-bundle.test.mjs.diff) |
| `host-journal-bundle-baseline.test.mjs` | 4 | 3 | 7 | [diff](host-journal-bundle-baseline.test.mjs.diff) |
| **Total** | **36** | **6** | **42** | |

Inherited baseline titles still mention frozen modules; they remain unchanged to preserve exact preflight bytes. Migrated baselines retain fixture pins only.

Append-only checkpoint lines were added under U02-02 for the fixed-run summary and under U02-04 for the entry builder, disk store and host bundle. One dated integrated line was appended to each of the four work-order roadmaps. These lines report module placement and passing checks, not a clean whole-tree scope audit. Progress stays **30% — 3 of 10**.

| Roadmap | SHA256 before integration | SHA256 immediately after this integration’s append |
|---|---|---|
| `roadmap.md` | `e9aa7539faa41a15d4a7c35bbef057d20d4cc127f3bd78e6ffdaa3b265dead29` | `74fc1c1590c8af3eda1e779fdcb09a95b7c170c02a6b3a0ab2e6b20ee8e0edba` |
| `work-orders/native-canary-summary/roadmap.md` | `532994e96ffc4b538c35a975925f448c86dd4a0152ee91a369b0bb0a2c0439d7` | `aa4daee191bdec8581b9ba7f4001ab7d62fffffa4a2c669c82c0ad7e230075c6` |
| `work-orders/fixed-run-journal-entry/roadmap.md` | `471b6cfbe3ab77ff8e42a606fc60546c6fcad3427a18ff14bc4692435ce04a8b` | `1aa2f53189ef4dc8ff8d927d1fbfde1047fa4a22d98bbda33902d641986105b3` |
| `work-orders/run-journal-store/roadmap.md` | `6f227ea1dc7089f734681cf447d8b414e7ccf40dce9f6b7fd7d2b7d891dc0a32` | `ccd10b5b66d80792cfdcee1581c0788f6cc858a402d7cd0d5a6090b53288e216` |
| `work-orders/host-journal-bundle/roadmap.md` | `1bb57934242a3e3ca0aaa12604fadf5411a2e953a797433955023be4f3197c79` | `20ba30358414d43cb3455ad03ea6ec74445ffce000cd7dc896ef0dcd8d98ec1e` |

The reporting audit found 8 pre-existing files changed among 940: five authorized roadmap additions plus the unexpected file(s) recorded in `scope-audit.json`. All 22 placement bytes still match their sources. The 44 protected files in these four work orders, 16 product script files, 20 retained preflight files, package metadata and Git HEAD remain unchanged. This is not a clean scope result across every work order.

The shared tree continued changing during stop-report preparation. The reporting snapshot records **three changed pre-existing non-target paths and eight new non-target paths**, listed in `scope-audit.json`. The canonical roadmap also changed after this integration’s append: our append hash was `74fc1c1590c8af3eda1e779fdcb09a95b7c170c02a6b3a0ab2e6b20ee8e0edba`; the later reporting read was `eb7afa5608aba3fb44c03558c581d7c5b70e5df679100e93646a510d9c37176d`. All four integration checkpoint lines are still present, and the progress header still reports 30% — 3 of 10. Roadmap hashes in the table above describe this integration’s append, not an immutable final shared tree. These additional changes were not written or reverted by this integration; no writer is attributed.

What is not claimed:

- A clean final whole-tree scope audit is not claimed: an unrelated pre-existing work-order test changed during the task; its writer is unknown.
- Host wiring of the bundle to the XPC runner is not closed.
- Real-filesystem durability acceptance is not closed. Store tests include bounded temporary-filesystem checks; bundle tests use injected memfs. No broad filesystem or power-loss guarantee is established.
- Cross-process locking, hostile-writer isolation and multi-process compare-and-swap are not established.
- Crash qualification, fresh-process/native recovery acceptance and power-loss qualification are not established.
- Incident admission and failure-history acceptance are not closed.
- U02-02, U02-04, NX milestone closure, release acceptance and public distribution are not claimed.
- No new native XPC canary execution, generated-code isolation acceptance or authorizing evidence is claimed. Retained fixed-run data supplies the test input.
- No live model or packet participation is established by the passing product tests.

Full authorization, placements, before/after hashes, per-test diffs, counts and limits are retained in [receipt.json](receipt.json). [before-manifest.json](before-manifest.json) records the pre-state; [roadmap-changes.json](roadmap-changes.json) records append-only edits. Command outputs are retained in `baseline-check.log`, `integrated-check.log`, `integrated-types.log` and `integrated-private-package.log`.
