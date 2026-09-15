# Five-work-order integration closing corrections — 2026-09-13

Astra (Codex) is the sole writer for this closing pass. Louis supplied Claude Fable 5.1's completed independent post-integration review: ACCEPT_WITH_DEFECTS, six read-only agents, diff base checkpoint `1179f1b` plus Astra's 12:15:30 before-manifest. This is attribution of Louis's supplied review, not a newly recovered review transcript or a fresh model invocation. The existing "Go for it" authorization covers the mechanical inventory correction; Louis's closing instructions report Claude's approval of that choice.

This note and the receipt's `closingPass` record supersede the initial integration's pending inventory decision and review status. Retained earlier logs, diffs, manifests and status text are historical snapshots. They were not rewritten by this closing pass, except for the explicitly requested restoration of the roadmap's original blocked-attempt wording.

## Inventory correction

Applied `proposed-inventory-count.diff` exactly to `tests/private-package-contract.test.mjs:9`: both cardinality literals changed from 24 to 27. Reversing only that retained line reproduces the original SHA256; every other byte is unchanged.

- Before: `177193ffcf7ad6111a047c4beba718888c607b1710625655fc275606d558451f`
- After: `2fc26ef962f778502688294fc7b0939734a8a262a1bd2e5e003acacfd9363784`

## Roadmap edit accounting and historical restoration

The prior integration edit accounting omitted changes in the `# Nisi roadmap` top section. The complete explicit enumeration requested by the review is below. Review coordinates refer to the integrated snapshot before this closing pass; inserting the single follow-up line shifts subsequent final-file coordinates by one.

- `roadmap.md:12-20`: new integration summary paragraph under `# Nisi roadmap`.
- `roadmap.md:29-30`: the integration had rewritten the blocked-attempt wording in place. This pass restores the original bytes: "The formatter remains the exact empty-string placeholder. Independent reruns" followed by "confirm **baseline 2/2 PASS; formatter 0/13 PASS (13 expected unfinished failures)**,". The complete original historical paragraph is preserved. One dated follow-up line, now at line 36, records later completion (13/13 PASS, SHA256 `c048df362405ffbd3053de93aedd05a0b51ec5c64417d19c9ee5ea22a6d90056`) and integration at `hosts/macos-xpc/native-probe-summary.mjs`.
- `roadmap.md:48`: newly ticked implementation-review box, with integration/test follow-up at lines 49-50 (now lines 49-51).
- `roadmap.md:4030-4032`: the existing U02-03 portable typed-consumer bullet was changed in place from `ten` to `eleven` declarations and `16-path` to `18-path` mapping (now lines 4031-4033). These were earlier integration edits, not new closing-pass edits.

The correct section accounting is **97 of 102 sections unchanged**, with five changed sections: `# Nisi roadmap`, U02-02, U02-03, U02-04 and U02-08. The prior claim of "98 untouched sections" was incorrect. A fresh comparison against `before/roadmap.md` reproduces 97/102. Overall roadmap progress remains 30%, 3/10 NX milestones closed.

The prior `roadmap.md:4166` reference is incorrect: the changed U02-08 table rows are **4180, 4182 and 4183** in the review snapshot, respectively candidate isolation, prevention/durable history, and the archive inventory assertion. Their final-file coordinates are **4181, 4183 and 4184** after the one-line insertion. The receipt records both coordinate sets. This closing pass resolves the inventory decision in the receipt and this note; it does not rewrite the retained earlier table status.

## Other mechanical changes previously made during integration

`scripts/check-private-package.mjs` count literals were edited: `7 → 9` fixture files, `5 → 6` TypeScript consumers, `29 → 39` expected negative controls, and `7 → 8` runtime tests/pass counts. These are the same category of inventory/cardinality correction as the two `24 → 27` test literals above; they are not path-only edits. Their retained diff is `scripts__check-private-package.mjs.diff`.

- Before: `80b384b406dbde63a65408c16cdb5634596c15bfcc19b60971b50b8e0580b841`
- After: `55a476c062b535a6e3df8b071bedad8c57a5acadbac04c006f40f3e4f4ede740`

`scripts/test-history-mutants.mjs:16` gained `mkdirSync(out,{recursive:true})` in place of `mkdirSync(out)`. This is a benign non-path change permitting the parent evidence directory to be created. The line-15 no-overwrite guard remains intact: `if(existsSync(out))throw new Error('Evidence directory already exists; do not overwrite retained mutants');`. Neither script was edited or the history mutation runner rerun during this closing pass.

## Review and work-order provenance corrections

- Receipt entries for Daybreak Blue and Luna are downgraded to **"self-reported, no artifact retained"**. No transcript, timestamped review artifact, or new participation is claimed.
- `work-orders/native-canary-adapter/handoff-claude-20260913/SHA256SUMS` retains the original `adb76dca0106d5ab5cd5f5e049a8fb8954e3c02127ab8f47b44c45fecbce506b` source entry and appends a dated annotation naming accepted successor `ac9c9cfaacfad91a27f08d2daee461b1f0580892509dc76693ccd36bd35a5c8f` from Astra's whitespace fix. The current source reproduces the accepted successor hash.
- `work-orders/native-chat-types/roadmap.md:19` now states on the integrate line that `tests/private-consumer/native-chat-runtime.test.mjs` is a new synthetic test, not sourced from the work order.
- Optional item 8 was omitted: preserving the baseline checks clearly would exceed the approximately 15-line allowance. No baseline test files were added; the product denominator remains 1160.

## Closing verification and limits

- `npm run check`: exit 0, tests 1160, pass 1160, fail 0, cancelled 0, skipped 0, todo 0; test duration 6963.975083 ms. Structural check PASS: 8/8 mutations caught, 8/8 allowed cases, zero source findings.
- `npm run test:types`: exit 0; six TypeScript consumers.
- `npm run check:private-package`: exit 0, PASS_SCOPED; exact 27-file archive, 39/39 expected negative-control diagnostics at their intended locations, 8/8 installed runtime tests, six installed TypeScript consumers, exact installed/archive byte match. Archive SHA256: `d368985e340002993046fdcba14501ba804993fcdc32154d1f88480339e2cbd3`. Detailed generated evidence: `.build/private-package-TjKZxZ/receipt.json` at the repository root.

The integration receipt records closing file hashes, exact counts, and the final one-shot `nisi-ckpt` outcome. No product commit/push, model load, packet execution, new native acceptance, host journal integration, durability acceptance or milestone closure is claimed. The earlier 8/8 journal-mutant evidence was not rerun in this pass.

## Addendum — optional item 8 baseline migration, 2026-09-13

Louis subsequently authorized optional item 8. Added two journal product tests
(export surface and import purity) and one formatter baseline test (synchronous
string result and frozen input unchanged). Product-relevant assertions are copied
from the original work-order baselines; only module/source paths changed. The
work-order package-metadata assertions stay in their original baselines. The
export assertion has a standalone product-test wrapper; the original files and
product modules remain byte-identical. This addendum supersedes the earlier
statement that item 8 was omitted; it preserves that historical record.

`npm run check`: exit 0, **1163/1163 PASS** (1160 + 3), fail/cancelled/skipped/todo
all 0, duration 8137.418375 ms. Structural check PASS: 8/8 mutations caught,
8/8 allowed cases, zero source findings. No other product test or source changed
for this addendum. Luna independently checked the three copied tests and their
paths; this review is source inspection, not an additional test execution.

SHA-256 (full bytes):

- `tests/run-journal-baseline.test.mjs`: `17a8de142999f7ebdbe164336d81ce5c0a7ef27b00e105ff7bf7a1113ea37e7f`
- `tests/native-probe-summary-baseline.test.mjs`: `28756bd6d730045e0bb12c9d5de04ed79523ba33b319ef3dfe593a56856e71ed`
- `work-orders/run-journal/tests/baseline.test.mjs`: `adb784891764841fe628e00b0aa9d9fdf025035e659aaacdedd766cafa81b8d3`
- `work-orders/native-probe-summary/tests/baseline.test.mjs`: `32664b54c73170511d89911bc7d4e030bb8c7ac3082d3572bce70b5fe215a6b1`
- `history/run-journal-v1.mjs`: `dee9f490c091000b2560cd9464d945885e7f341091b87dde9ae4f2b7cdbd359e`
- `hosts/macos-xpc/native-probe-summary.mjs`: `c048df362405ffbd3053de93aedd05a0b51ec5c64417d19c9ee5ea22a6d90056`
- Check log `work-orders/run-journal-store/evidence/task1-npm-check.log`: `8591a5a7236a77c98111b8bf7bb3e6a0adcbf35f7793950848554f45d9da894a`
