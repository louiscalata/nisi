# Installed Mac reviewer-summary repetition refusal

## Actual state — 2026-09-29 PDT

The installed Mac Nisi runtime is generation `4bbabe71`, published from an exact verified installed snapshot plus the reviewed repetition guard. This identifier is content-addressed runtime evidence, not a Git commit. The publisher manifest records commit/tree/archive null. The same guard is integrated into the canonical adapter by a minimal helper insertion and reviewer-call change, with three new test/fixture files. The inverse of that adapter patch restores the pre-existing dirty adapter exactly. A future runtime publication must preserve the other installed changes as well; canonical and installed adapters otherwise differ.

The guard refuses a reviewer summary with an exact contiguous unit repeated at least 16 times, covering at least 256 code points and more than half the summary. The period bound is floor(code-point length / 16), at most 256 under the existing 4,096 UTF-16-unit cap. It throws `LOCAL_CHAT_REVIEW_SUMMARY_REPETITIVE` before PASS/FAIL review construction and RESPONSE_VALIDATED. Candidate source and author notes are outside this check. This detects extreme exact repetition; it does not certify factual accuracy or catch every loop. Honest dominant quoted repetition can also be refused.

## Verification

- 15 injected-response regressions passed against the installed runtime, including both saved observed failures: 481 Prompt/ units and a 69-character sentence unit repeated 30 times (2,070/4,096 characters).
- The 15 new canonical regressions and nine existing adapter/lifecycle cases also passed. Both observed-summary cases fail against the saved pre-edit canonical adapter as expected. The new test resolves its runtime with fileURLToPath so paths containing escaped characters are decoded correctly.
- Three long-period cases failed against the previous installed guard as expected. Earlier baseline tests also discriminated the original short-period defect.
- Existing reconciliation checks plus four named-error/ownership cases passed 39/39. Wrong request digest, unrecovered pending marker and busy owner still refuse. No automatic retry or relaxed ownership rule was added.
- Unchanged accepted publishers passed disposable HOME preparation, verification, dry-run, installation and receipt rollback. Live owner/dependency/Monitor admission then passed.
- Nine host target hashes and seven runtime file hashes match the reviewed package. Five host generation references changed; four router closure files remained byte-identical. Earlier runtime generations and installation/rollback receipts remain preserved.
- Already-running OpenCode tool imports require reload; that lifecycle has not been verified while the Mac is locked.

## Model evidence boundaries

Cursor reported actual **Grok 4.7 256K Low Fast** and completed the bounded read-only extension review with no findings. Parallel Astra and Codex source reviews also found no actionable issue in their scoped changes.

A live Nisi Gemma4 review exposed the second repetition pattern. The later resident Gemma3 call returned a concise schema-valid result, but its summary incorrectly described the two thresholds with OR and described the intentional refusal as preventing an adapter throw. Neither local answer supplies code approval. Both remain `accepted:false`, with zero independent-review count. Jev `jev-1.13.0` separately classified the repair, with low route confidence (0.51); its route stayed unresolved and advisory. No new model was loaded.

## Retained evidence

- `agiw-stage/nisi-review-repetition-20260929`: original observed summary, first candidate/baseline tests, 39 reconciliation checks, first publication package and live Gemma4 receipt.
- `agiw-stage/nisi-review-repetition-long-20260929`: second observed summary and measurement, final tests and negative controls, reviewed package pins, live installation/pin checks, final model receipts and completion-receipt.json.
- `agiw-stage/nisi-review-repetition-canonical-20260929`: exact pre-edit canonical snapshot, own adapter patch, import-closure preservation checks, canonical tests, existing adapter cases and baseline negative controls.

These stages are under the SharedChami workspace. No GitHub push or Nisi v0.2 NX acceptance gate was completed. Mac App Store Build 5 source/package are unchanged; its technical checklist remains 8/13 (61%).
