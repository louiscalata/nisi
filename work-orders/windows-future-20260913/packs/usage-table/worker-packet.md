# Nisi Windows drafting packet — usage-table

**Status: PREPARED, not dispatched or accepted.**
**Overall product progress: 30% (3/10 NX milestones).**

Draft owner: registered Windows Qwen chat worker. Code installation/test owner:
Codex in this isolated work order only. GPT-OSS gets a separate review request.
This is NOT an OpenCode execution receipt or permission to modify the product.

## Contract

Private future Nisi prototype, not integrated product API. Implement ONLY src/index.mjs as dependency-free synchronous ESM with the single named export below. No imports, filesystem, network, process, models, eval, dynamic code or clocks. Input is ordinary JSON; return REFUSED rather than throw for every malformed input. All object key sets are exact, unknown keys rejected; top-level null/array rejected. Nonempty bounded strings mean length 1..128. Array cap 200 unless stated. No mutation; output copies all rows so later input changes do not alter it. Invalid return exactly {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false}. Output field ordering follows examples. No claim that this validates actual model, hardware, code accuracy, permissions or execution evidence. Only transforms supplied synthetic data.

Named export: `buildUsageTable(input)`.

Input {runId,rows}; runId bounded string. rows exact {id,stage,provider,model,inputTokens,outputTokens,reasoningTokens,durationMs}; id unique bounded string, stage bounded string; provider/model bounded string OR null. Token counters null OR nonnegative safe integer excluding -0. reasoningTokens is a subset of outputTokens: if both known, reasoning<=output. durationMs null OR finite nonnegative number excluding -0. Output {schemaVersion:1,status:'READY',runId,rows:[copy each row preserving listed fields and append totalTokens],totals:{inputTokens,outputTokens,reasoningTokens,totalTokens,durationMs},unknownRows,authorizing:false}. Row totalTokens=input+output if both known and safe-integer sum else null; never add reasoning again. Each totals column sums its row column, null if any null or total exceeds Number.MAX_SAFE_INTEGER or is not finite. Empty totals=0. unknownRows counts rows with null in any of input/output/reasoning/duration (not provider/model, and not overflow-only derived total). Unknown telemetry never becomes zero.

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
