# Handoff — native-canary-adjudicator (2026-09-13T18:04Z)

Author of contract, tests and this record: Claude Fable 5.1 (co-author). Direction: Louis, 2026-09-13 ~11:00 PDT: "if opencode or the llm pipeline is free, you should utilize the time. draft an opencode packet for the next step and execute to save time" and "use astra ultra as a reviewer and orchestrator for 50-50 of your work". Owner review: Astra (pending at write time).

## Route, measured
1. Packet `.packets/nisi-native-canary-adjudicator.packet.md` linted OK (2 items, discriminating accepts). `CHAMI_PACKET_TIER=local` run 10:48:04–11:00:09 PDT on `lmstudio/qwen/qwen3.8-27b` (JIT-loaded by Bionic at context 208,384 — the clamp fix on the real JIT path). The executor read the three test files and made **no edit**; deterministic receipt: `outcome=blocked · P1=FAILED P2=SKIPPED · acceptance exit 0`, source still the 216-byte placeholder. Same failure shape as Codex's 2026-09-13 00:00 formatter attempt. A BLOCKED item returns to the author.
2. Resolved on Louis's designated headless route, the SharedChami PC worker (`chami-dispatch request --json`, model `Qwen3-Coder-Next 80B-A3B Q4_K_M`), as two bounded jobs, prompts = contract + the protected tests as oracle (no local paths, no repository content):
   - job `mac-20260913-110059-289c2b47aa9cad262905308348cb80fe` (adjudicate, 11,662-char prompt): 87.9 s → raw draft passed **11/11** untouched.
   - job `mac-20260913-110305-e54fb72ba620719278081ed28497e55c` (format, 6,171-char prompt): 29.7 s → raw draft **3/6**; single integrator repair by Claude: `return lines.join('\n')` → `return lines.join('\n') + '\n'` (missing final newline; the same defect class as the formatter work order) → **6/6**.
   Retained: worker-job-*.json / worker-result-*.json beside this file; hashes in SHA256SUMS.
3. Final `src/native-canary-adjudicator.mjs` sha256 `cf875eaa7adf335ceab49ae16f9941e2d9b5b9780f5ca15c22eea4c97405de00`; raw combined draft before repair `0caa07e6c050e6092862cdfaba5a6b5e492d94690e8ee4854509515d570df5a4`. `npm test` 2/2, `npm run test:adjudicate` 11/11, `npm run test:format` 6/6; forbidden-token grep none. `packet-receipt` re-derived deterministically (no edit phase): P1 DONE, P2 DONE, acceptance exit 0; `executed_by` records `pc-worker/… + claude-integrator` — the OpenCode executor did not produce these edits.

## Author ≠ reviewer
The PC worker drafted; Claude authored the tests before any draft and applied one line; Astra reviews. Protected files (package.json, tests/, roadmap.md, .packets/) were not changed after lint except the packet's own status flips by the wrappers.

## Review notes for Astra
- The adjudicate draft strips one trailing `\r` from the whole output instead of per line (contract says per line). Behaviorally inert for JSON lines because a trailing `\r` is JSON whitespace and blank detection uses `trim()`; a per-line strip would be the literal contract. Decide: accept as-is or one-line tighten.
- Vocabulary gap to resolve at integration: the real fixed script in `.build/xpc-embedded-node-9u2lavy_/logs/node.stdout` emits `operation` (snake_case), `outcome` allowed|error|observed, `code`/`syscall`; this contract expects `op` and ALLOWED|DENIED|SELF_REPORT. Either the fixed script adopts this vocabulary or the adjudicator takes a key/outcome mapping. Not decided here.

## Not claimed
Not product integration, not isolation adjudication authority, not a security boundary; the table's caveat and `isolationAccepted: false` are literal. No commits, pushes, or publication.

## Owner review — Astra

Date: 2026-09-13 (America/Los_Angeles). Verdict: **ACCEPTED against the packet Context contract for this isolated private work order**, with the contract limitations in (b) explicitly retained. Product integration remains open. Astra independently read the handoff, checksum manifest, packet, receipt, implementation, all three protected test files, both raw worker results, and the real fixed-script stdout referenced below. No models or packet runs were invoked for this review. The retained worker metadata is provenance evidence, not a new worker execution by Astra.

### Independent commands and results

All commands ran from this work-order directory. Runtime: `node --version` = `v24.18.0`; `npm --version` = `11.16.0`.

| Command | Observed result |
| --- | --- |
| `shasum -a 256 -c handoff-claude-20260913/SHA256SUMS` | Exit 0; **10/10 entries OK**, covering both worker requests, both worker results, source, all three tests, package.json, and packet. |
| `npm test` | Exit 0; **2 tests, 2 passed**. |
| `npm run test:adjudicate` | Exit 0; **11 tests, 11 passed**. |
| `npm run test:format` | Exit 0; **6 tests, 6 passed**. |
| `LC_ALL=C grep -Enw 'import\|require\|process\|fetch\|XMLHttpRequest\|eval\|Function\|setTimeout\|setInterval\|Date\|performance' src/native-canary-adjudicator.mjs` | Exit 1; no forbidden keyword matches. |
| `LC_ALL=C grep -En 'Math[[:space:]]*\.[[:space:]]*random([^[:alnum:]_]\|$)' src/native-canary-adjudicator.mjs` | Exit 1; no randomness matches. |
| `python3 - <<'PY'` (fenced-code extraction, composition, SHA-256 assertions and unified diff) | Exit 0; adjudicator unchanged, exactly the one documented formatter repair. Extraction details below. |
| `node --input-type=module <<'JS'` (inline owner review probes; no test-file edits) | Exit 0; **13/13 named checks passed**. Coverage below. |

Across the three protected test commands: **19/19 tests passed**, zero failed, cancelled, skipped or todo; each runner reported zero suites. The 13 inline review checks are additional checks, not additional protected tests. They covered exact exports/result keys; CR equivalence in 12 mixed valid/invalid inputs and original line numbering; duplicate observation rejection; each malformed category; unexpected operations and exact spelling; expected validation before raw-output access; unconstrained SELF_REPORT; unconstrained errno; duplicate JSON keys; positive/exact identity matching; deep freezing and fresh return-object graphs; prototype-like operation names; and the real stdout mismatch. No source change was necessary, so all three protected test results apply to the accepted source hash below.

### Hash and worker-diff evidence

- Accepted source, unchanged: `cf875eaa7adf335ceab49ae16f9941e2d9b5b9780f5ca15c22eea4c97405de00`.
- Raw combined worker draft, independently reconstructed: `0caa07e6c050e6092862cdfaba5a6b5e492d94690e8ee4854509515d570df5a4`.
- Worker adjudicate result: `e4a63e75952fe561c75fd5eceaa79d9a2c9a55ef114edf6d8ccbfcf4d3dcc8a8`.
- Worker format result: `485190a62360e6d8f9a8a8323f323e9679571642fc4ba652355cb69af0404982`.
- Original checksum manifest, unchanged: `36768289a75d9ff21bc2beb255f323f3b445d3d6010446de4c0d41e53394cbf3`.
- Receipt, read and unchanged (not an entry in SHA256SUMS): `fe0e66a7e24ccb6dc5ebba1e8926784480e5da2877f82c0942cfa7bcc39ca6b4`.
- HANDOFF.md before this append: `b8bb4f0f4361168f67b241d2802132e8de2e242f34d460c41fba312dc5a3cc65`.
- Work-order roadmap.md before ticking owner review: `c3d3aaa0b46b099de3ef74c0dd1a4ffd40b7a9c9dc54b3cbdf66f06d574eb7bc`.

The Python command parsed each worker-result JSON `output` and required exactly one complete javascript/js fence, preserving code whitespace. It extracted 6,737 bytes from the adjudicate job and 1,853 bytes from the format job, replaced only the adjudicate draft's `formatCanaryTable` placeholder with the second job's formatter, and hashed that combined draft. It asserted that substituting the single line below produces the final source byte for byte. The adjudicate portion is byte-identical; the unified diff has one hunk:

```diff
--- extracted-worker-combined.mjs
+++ src/native-canary-adjudicator.mjs
@@ -268,5 +268,5 @@
   lines.push('');
   lines.push('Isolation acceptance is not established by this table.');
 
-  return lines.join('\n');
+  return lines.join('\n') + '\n';
 }
```

The receipt is consistent with deterministic acceptance of the retained implementation. Its `executed_by` value still begins with `opencode` and parenthetically attributes `pc-worker/... + claude-integrator`; the handoff explicitly says the OpenCode executor made no edit. This review credits the retained PC drafts and Claude repair, and does not treat that prefix as evidence of OpenCode authorship. The receipt was not rewritten.

### Decisions (a–d)

**(a) Trailing CR: accept as inert; no source edit.** The implementation removes one trailing CR from the complete string, while the contract requests removal from each split line. A trailing CR is JSON whitespace, and blank detection already uses `trim()`. Removing it does not change parsing success, parsed values, malformed reasons, or original split-line numbering. A literal CR inside a JSON string remains invalid. The 12-case comparison against per-line-normalized input passed, including CRLF, multiple CRs, blank lines, malformed JSON, unexpected rows and duplicates. This is an accepted literal implementation difference with equivalent observable behavior for the specified string/null/undefined input domain.

**(b) Verdict acceptance: correct to the current contract, with material limits.** Two or more observations for the same expected operation yield AMBIGUOUS with null observed fields, including when one duplicate has an invalid outcome. Any recorded malformed line or unexpected operation blocks ALL_MATCHED; a separate valid expected row can still have row-level MATCH. Exact equality and safe-integer checks enforce the specified constraints. Three routes can nevertheless accept weak or ambiguous evidence under this contract: (1) SELF_REPORT with neither expectedPid nor expectedPpid accepts even `{"op":"self-report"}` as MATCH/ALL_MATCHED; outcome and errno are ignored for SELF_REPORT, and a partially specified identity constrains only that component. (2) ALLOWED/DENIED without expectedErrno accepts absent or invalid errno when the outcome matches, as explicitly required by the protected tests. (3) JSON.parse uses the last occurrence of duplicate member names within a single object: `{"op":"extra","op":"x","outcome":"DENIED","outcome":"ALLOWED","errno":0}` yields ALL_MATCHED for expected x/ALLOWED/0, concealing the earlier op/outcome. This is distinct from duplicate observation lines, which are rejected. Duplicate-member rejection is not part of the mandated JSON.parse contract. These are contract limits, not grounds to silently alter protected semantics in this review. At integration, specify trustworthy identity/errno expectations and decide whether strict duplicate-member rejection is required before evidence receives meaning beyond this table. Extra observation fields are ignored as specified. `isolationAccepted` remains false in all results.

**(c) Mutation, aliasing and state: accepted.** Expected validation completes before raw-output property access; an inline Proxy probe confirmed this for invalid configurations. Expected rows are only read. Parsing creates local objects, grouping uses fresh local Maps/Sets, and returned row fields are primitives. All returned objects/arrays, including counts and malformed-line records, were disjoint across two calls. A fully deep-frozen result rendered unchanged; mutating an earlier result's row, malformed record, unexpected list and counts did not affect later calls. Prototype-like operation strings remain literal Map keys, and a parsed __proto__ field did not pollute objects. No module-level shared mutable state or input/output object alias was found for the trusted configuration contract.

**(d) Vocabulary integration recommendation (no code change).** Read-only inspection of `/Users/louiscalata/nisi-next-private/.build/xpc-embedded-node-9u2lavy_/logs/node.stdout` confirms five rows using `operation`, snake_case operation names, lowercase allowed/error/observed, and EPERM/open or EPERM/listen diagnostics on error rows; self_report reports pid 20280 and ppid 20279 in this retained run. Unadapted input produces five MISSING_OP records, five NOT_OBSERVED rows, and NOT_ACCEPTED. Recommend adapting on the product integration side with an explicit versioned adapter before this adjudicator, preserving the original stdout and this module's exact-match contract. Map the five operation names explicitly (self_report to self-report, own_container_write/read to own-write/read, outside_read to outside-read, ipv4_loopback_bind to loopback-bind); allow ALLOWED only for recognized allowed observations, use the self-report identity fields, and classify error as DENIED only for the approved operation-specific errno/code/syscall combination (the retained denial evidence is errno 1, EPERM, open/listen), never for every error. Unknown names/outcomes, contradictory diagnostics, malformed records and duplicates must remain rejection evidence. Obtain identity expectations from trusted runtime evidence rather than copying child claims or these historical PIDs, and preserve the existing non-authorizing flags and isolation caveat. Louis must decide the adapter/schema and strictness contract before separately authorizing product integration.

Owner-review writes are limited to this appended section and the dated owner-review checkbox in this directory's roadmap.md. The source, protected tests, package.json, packet, receipt, checksum manifest and worker artifacts remain unchanged; product integration remains unchecked. No product files were edited and no commit or push was made. Final document hashes are reported separately to avoid a self-referential HANDOFF.md hash.
