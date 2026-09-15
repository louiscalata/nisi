# Nisi Windows drafting packet — comparison-table

**Status: PREPARED, not dispatched or accepted.**
**Overall product progress: 30% (3/10 NX milestones).**

Draft owner: registered Windows Qwen chat worker. Code installation/test owner:
Codex in this isolated work order only. GPT-OSS gets a separate review request.
This is NOT an OpenCode execution receipt or permission to modify the product.

## Contract

Private future Nisi prototype, not integrated product API. Implement ONLY src/index.mjs as dependency-free synchronous ESM with the single named export below. No imports, filesystem, network, process, models, eval, dynamic code or clocks. Input is ordinary JSON; return REFUSED rather than throw for every malformed input. All object key sets are exact, unknown keys rejected; top-level null/array rejected. Nonempty bounded strings mean length 1..128. Array cap 200 unless stated. No mutation; output copies all rows so later input changes do not alter it. Invalid return exactly {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false}. Output field ordering follows examples. No claim that this validates actual model, hardware, code accuracy, permissions or execution evidence. Only transforms supplied synthetic data.

Named export: `buildComparisonTable(input)`.

Input exact {rows}; each row exact {id,label,off,on,unit}; id/label bounded strings, ids unique; unit TOKENS|MILLISECONDS|CHECKS. off/on null OR finite nonnegative number <= Number.MAX_SAFE_INTEGER excluding -0. For TOKENS/CHECKS values must also be safe integers. Output exact {schemaVersion:1,status:'READY',rows:[copied row fields then delta,relativeChangePercent],summary:{total,knownPairs,unknownPairs},authorizing:false}. delta=on-off if both known else null; relativeChangePercent=(on-off)/off*100 if both known and off>0 and result finite else null. No rounding or aggregate across units. off=on=0 gives delta0, relativeChangePercent null. Counts: knownPairs both known even when off0; unknownPairs rest. Empty rows[],zeros counts. No lower-is-better/savings/accuracy/reliability claims or inference that unequal tasks are comparable.

## Required returned artifact

Return only valid JSON, no markdown fences:
`{"schemaVersion":1,"files":[{"path":"src/index.mjs","content":"complete JavaScript source"}],"notes":["brief limitations"]}`.
One source file only, ideally <=180 lines. Do not claim tests were run: the chat
worker has no test or filesystem tools. Do not send a fragment or pseudocode.

## Owner acceptance

The owner reads the whole source before executing. No imports or executable side
effects; only the pure named function and helpers. Preserve protected tests and
package; run `npm test` separately from `npm run test:acceptance`. Both must
pass. Retain actual stdout, exit status, source and test hashes, model-reported
provenance, missing usage as unknown, and separate review findings. A baseline
pass alone never accepts the implementation. Code is for future integration only.
