# Handoff — native-probe-summary formatter drafted on the SharedChami worker

Date: 2026-09-13 01:34–01:37 PDT. Author of this record: Claude (co-writer, granted by Louis in chat this session).
Direction: Louis said "Use sharedchami worker as your headless llm" after the local attempt was BLOCKED (`Model is unloaded.`).
This resolves the work-order item "Resolve model availability and obtain direction for a new bounded attempt".

## What ran
- Route: `chami-dispatch request --json` (schema-1 queue, Mac submits, registered PC worker claims). No Mac model was loaded, replaced or restarted.
- Job id: `mac-20260913-013410-4a6a67433191e182b7dd50406c00daaf`
- Model returned by the worker: `Qwen3-Coder-Next 80B-A3B Q4_K_M` (explicitly requested; dispatcher verified the returned model matches). Elapsed: 33.8 s.
- Prompt (9,909 chars): the packet's rendering contract restated plus the full formatter test file as the oracle. Retained: `worker-job.json` sha256 `c8415dc699a5ce136659db4531b9d1a11a3e0ee15092a1f70d21db6a51b0b6db`.
- Raw worker output retained: `worker-result.json` sha256 `5a79521fbfc3186066b09c5c22d3172d2f9ad37d158946caa1403ca08110da54`.

## Draft, review and repair
- Raw draft written to `src/native-probe-summary.mjs` (sha256 `15b867e29d35fb74505f4922dc5f71fa59a11a9c43dc83f65fdb4c89259eb0dc`): `npm run test:formatter` = **10/13 pass, 3 fail**. Claude's source review found one defect: no trailing newline on the returned string (contract requires the output to end with a newline).
- Integrator repair (Claude, one line): `return lines.join('\n')` → `return lines.join('\n') + '\n'`. No other change to the draft.
- Final `src/native-probe-summary.mjs` sha256 `c048df362405ffbd3053de93aedd05a0b51ec5c64417d19c9ee5ea22a6d90056`
  - `npm run test:formatter`: **13/13 pass**, 0 fail, 0 skipped, 0 cancelled
  - `npm test` (baseline): **2/2 pass**
  - Forbidden-token grep over the source (import/require/process/fetch/XMLHttpRequest/eval/Function/setTimeout/setInterval/Date/performance/Math.random): none.
- Author ≠ reviewer: the PC worker model drafted; Claude reviewed and applied the one-line repair; the tests were authored by Codex before the draft and were not modified.

## Protected files — unchanged by this handoff
- `package.json` sha256 `e8019bb08fd426b0491695968b6e936f2103e2ef4a42f87f855b7c927b6a7c56`
- `roadmap.md` (work-order) sha256 `90f95807edd1c3127ef5e4a7f7edd1be017e775ab0655393079e5edec00d93df`
- `tests/native-probe-summary.test.mjs` sha256 `203ab14a1096a6de072af45e45ef39d527c9b6c3b6053985185e130986cc4e67`
- `tests/baseline.test.mjs` sha256 `32664b54c73170511d89911bc7d4e030bb8c7ac3082d3572bce70b5fe215a6b1`
- `.packets/` untouched. The packet status remains `blocked` in the packet header; this was NOT a `packet-run` execution and there is no wrapper receipt for it.

## Not claimed
- Not a packet-run receipt, not a certificate, not product integration, not UI/native work, not publication. Codex owns source review, roadmap acceptance and any copy into the Nisi product.
- Windows worker inference is model inference only; it is not native acceptance on any platform.
