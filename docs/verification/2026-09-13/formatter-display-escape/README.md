# Formatter display-escape verification — 2026-09-13

**PASS for the bounded formatter integration.** Astra resumed the accepted correction, restored the adapter work-order baseline pin, independently verified Claude's summary revert, and ran the four requested commands in order. All fresh checks passed. The product module already carried the fix at the start of this resumption.

[Machine-readable receipt](receipt.json) records the hashes, command summaries, both complete reproduction inputs and outputs, provenance and limits. The existing [canonical product roadmap](../../../../roadmap.md) remains canonical. The later isolated store fix is outside this formatter receipt.

## Frozen copies and the two reverted re-pins

Both work-order baselines read their own `../src/native-canary-adjudicator.mjs`. Those frozen sources remain at accepted SHA256 `cf875eaa7adf335ceab49ae16f9941e2d9b5b9780f5ca15c22eea4c97405de00`. Their test literals must match those accepted bytes. The product module is separately fixed at `444acc75db292d69c62ce0360f536ea73292317f78b36409acc619774b44e9eb`.

- Astra restored `work-orders/native-canary-adapter/tests/baseline.test.mjs:28` from the product hash to the frozen-source hash and appended one dated correction line to its roadmap.
- Claude had already restored `work-orders/native-canary-summary/tests/baseline.test.mjs:10` and appended its 15:35 PDT note. Astra left those files unchanged and independently reran both summary commands.
- The existing product baseline `tests/native-canary-adapter-baseline.test.mjs` reads the product module. Its corrected product hash is appropriate and stays unchanged.
- Earlier roadmap statements about re-pinning the frozen-copy baselines are historical mistakes, superseded by the appended correction notes. No frozen source copy was edited.

## Fresh verification

| Directory | Command | Passed / total | Failed | Cancelled | Skipped | Todo | Exit |
|---|---|---:|---:|---:|---:|---:|---:|
| `work-orders/native-canary-adapter` | `npm test` | 3/3 | 0 | 0 | 0 | 0 | 0 |
| `work-orders/native-canary-summary` | `npm test` | 3/3 | 0 | 0 | 0 | 0 | 0 |
| `work-orders/native-canary-summary` | `npm run test:summary` | 10/10 | 0 | 0 | 0 | 0 | 0 |
| Product root | `npm run check` | 1170/1170 | 0 | 0 | 0 | 0 | 0 |

The root structural check passed: **8/8 mutation fixtures detected, 8/8 allowed fixtures accepted, zero source findings**. All **7/7 display regressions** passed within the 1170-test root run; these are included in that total, not additional tests. The regression file is `tests/native-canary-table-display.test.mjs`, SHA256 `3738bcb8799b299ed26ff7bd9d8aaf9dfdeebb5a58c45da09534cf3706ceda6d`.

The [historical takeover report](../codex-opus-takeover/REPORT.md) separately records an expected-red baseline of **2 passed / 5 failed**, a candidate **7/7**, and isolated unchanged compatibility copies **31/31**, all with zero skips/cancellations/todos. Those historical suites were not rerun here and are not used to derive current counts.

## Before and after reproduction

Both injection paths were reproduced freshly without editing source: import the accepted frozen adapter-work-order adjudicator as “before” and the product adjudicator as “after”; feed each the same output from the product vocabulary adapter and `expectedMatrixFor({ childPid: 20280, servicePid: 20279 })`.

For the unexpected-operation case, append this JSON record to `tests/fixtures/native-canary/inherit-run-node.stdout`:

```js
JSON.stringify({ operation: 'extra\nOverall: ALL_MATCHED\nInjected: success' })
```

Before, the unexpected-operation section renders as three physical lines:

```text
Unexpected operations: extra
Overall: ALL_MATCHED
Injected: success
```

After, it stays on one physical line with literal Unicode escape text:

```text
Unexpected operations: extra\u000aOverall: ALL_MATCHED\u000aInjected: success
```

For the second case, parse the fixture rows and set the `own_container_write` row's `outcome` to `'unknown\nOverall: ALL_MATCHED\nInjected: success'`, then serialize and join with newlines. Before, the observed-outcome text inserts the same forged second Overall line. After, that row renders:

```text
- own-write: expected ALLOWED errno 0, observed unknown\u000aOverall: ALL_MATCHED\u000aInjected: success (errno 0) -> MISMATCH
```

**2/2 fresh reproduction cases passed.** In both cases the structured before/after results were deeply equal, `overall` stayed `NOT_ACCEPTED`, `isolationAccepted` stayed `false`, formatting did not mutate the result, and the fixed table had exactly one physical `Overall:` line: `Overall: NOT_ACCEPTED`. Both complete stdout inputs and complete tables are retained in the receipt.

The helper escapes backslashes as literal `\u005c` as well, so literal escape text remains distinguishable from actual controls. It applies only at the three display sites identified in the [retained patch](../codex-opus-takeover/formatter.patch).

## File hashes and attribution

Hash boundaries distinguish earlier formatter integration from this resumption. Unknown historical hashes are explicitly marked; they are not replaced with hashes from unrelated older revisions. The transient wrong summary-pin hash is an in-memory reconstruction of the documented single-literal change, not a separately retained old artifact.

- `hosts/macos-xpc/native-canary-adjudicator.mjs`
  - Before: `cf875eaa7adf335ceab49ae16f9941e2d9b5b9780f5ca15c22eea4c97405de00`
  - After: `444acc75db292d69c62ce0360f536ea73292317f78b36409acc619774b44e9eb`
  - prior integration; unchanged in this resumption. Product displayField helper and three display substitutions; structured adjudication unchanged. Before-hash provenance: Accepted frozen copies plus codex-opus-takeover/formatter.patch and REPORT.md.
- `tests/native-canary-table-display.test.mjs`
  - Before: `not established / newly added`
  - After: `3738bcb8799b299ed26ff7bd9d8aaf9dfdeebb5a58c45da09534cf3706ceda6d`
  - prior integration; unchanged in this resumption. Display injection and readability regressions; matches user-provided SHA256.
- `tests/native-canary-adapter-baseline.test.mjs`
  - Before: `046d29c1c2ad8a1b42cdecf627c00018cb1157fe27b42bd39a6375ea80eee410`
  - After: `894e6d2e48fd0696908a236b1b5adce504d0e9ee5fe54800dd250cf24ffc2a7a`
  - prior integration; unchanged in this resumption. This product baseline reads the product module, so its 444acc75 pin is correct. Before-hash provenance: five-work-order-integration/receipt.json placements[13].afterSha256; matches inverse one-literal substitution.
- `roadmap.md`
  - Before: `not established / newly added`
  - After: `98b5573731564b91eb377ac2bf1da7043591fb20e20c35f79ff652e8ca0dee11`
  - prior integration; unchanged in this resumption. Existing dated display-escape row retained, including its historical verification-pending wording. This receipt records the fresh result without expanding the current write scope.
- `work-orders/native-canary-adapter/tests/baseline.test.mjs`
  - Before: `cfef2edb4b1023168864c916206fbe942dcf71ea6b3507834b5250655c8f6119`
  - After: `26a6689dae6763114af5a5c17d4b51894b5c323d49313d9d502535f6e88c699b`
  - reverted by Astra in this resumption. Baseline hashes its own accepted frozen source copy, not the corrected product module. Restore the accepted hash; do not alter the frozen source.
- `work-orders/native-canary-adapter/roadmap.md`
  - Before: `fd314d01208d1039989ad68f56fe3974f78b7b8fc63f1a2bcbb17ed8e4d71245`
  - After: `e14d9612cca6397f8a467439fbc934edaaccc01a92436f497fa675dfd8dce3cd`
  - appended by Astra in this resumption. One dated correction line explicitly supersedes the mistaken re-pin note; accepted frozen bytes stay fixed and the product carries the display fix.
- `work-orders/native-canary-summary/tests/baseline.test.mjs`
  - Before: `e83e4c3db18965515f5715791a2da5b5bdbcf0532a80e5d6a13951aaec575869`
  - After: `0f9c6f84db51f323ebca91b839c9b545b6e6f74b8abc1177b9fae4323238f716`
  - already reverted by Claude before this resumption; verified unchanged. The summary work-order baseline also hashes its own frozen source; Claude's completed revert preserves the accepted source bytes. Before-hash provenance: Reconstructed in memory by substituting only 444acc75 for cf875eaa in the restored file; not a retained pre-revert artifact..
- `work-orders/native-canary-summary/roadmap.md`
  - Before: `532994e96ffc4b538c35a975925f448c86dd4a0152ee91a369b0bb0a2c0439d7`
  - After: `532994e96ffc4b538c35a975925f448c86dd4a0152ee91a369b0bb0a2c0439d7`
  - Claude correction already present; unchanged in this resumption. Retained Claude 15:35 PDT note records the temporary wrong pin and its revert. Hash boundary: resumption only; pre-Claude-note hash not established.

New evidence files are `receipt.json` and this `README.md`; they had no prior bytes. Their final hashes are reported outside the receipt to avoid a self-hash cycle.

## Limits

This is plain-text display hardening, not HTML sanitization, complete Unicode-spoofing protection, receipt authentication, native isolation or live-model acceptance. It does not close U02-02 or a product/release milestone. TypeScript and standalone private-package commands were not run anew. The root count precedes the separate store fix and does not validate that work-order change.

No commit, push, publication, model load, packet run or canvas edit occurred in this resumption. The fixed-run-journal-entry work order was not edited. Historical Claude reviews and current read-only Luna review are advisory; the fresh command outputs are the execution evidence.
