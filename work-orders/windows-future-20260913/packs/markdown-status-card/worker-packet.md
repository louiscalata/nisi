# Nisi Windows drafting packet — markdown-status-card

**Status: PREPARED, not dispatched or accepted.**
**Overall product progress: 30% (3/10 NX milestones).**

Draft owner: registered Windows Qwen chat worker. Code installation/test owner:
Codex in this isolated work order only. GPT-OSS gets a separate review request.
This is NOT an OpenCode execution receipt or permission to modify the product.

## Contract

Private future Nisi prototype, not integrated product API. Implement ONLY src/index.mjs as dependency-free synchronous ESM with the single named export below. No imports, filesystem, network, process, models, eval, dynamic code or clocks. Input is ordinary JSON; return REFUSED rather than throw for every malformed input. All object key sets are exact, unknown keys rejected; top-level null/array rejected. Nonempty bounded strings mean length 1..128. Array cap 200 unless stated. No mutation; output copies all rows so later input changes do not alter it. Invalid return exactly {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false}. Output field ordering follows examples. No claim that this validates actual model, hardware, code accuracy, permissions or execution evidence. Only transforms supplied synthetic data.

Named export: `renderStatusCard(input)`.

Input exact {title,fields}; title nonempty string 1..128; fields array max50; each field exact {label,value}; label string1..128; value null OR string length0..2048 OR finite number abs<=Number.MAX_SAFE_INTEGER excluding -0. Duplicate labels preserved. Output {schemaVersion:1,status:'READY',markdown,authorizing:false}. Exact markdown: '# '+escape(title)+'\n\n| Field | Value |\n| --- | --- |\n' followed each field '| '+escape(label)+' | '+escape(value===null?'UNKNOWN':String(value))+' |\n'. If no fields add '| Status | No fields supplied |\n'. Escape per Unicode codepoint, no trimming/normalization: every character in ASCII '<>&\"\'|\\`#[]()*_!' and every U+0000..001F,U+007F..009F,U+2028,U+2029,U+202A..202E,U+2066..2069 becomes '&#x'+codepoint.toString(16).toUpperCase()+';'. All other characters preserved including non-control Unicode. Ampersands in original entity text are escaped once; do not re-escape entities you generate. Pure string output only; no browser or markdown execution or external URLs. Numeric0 displays0,null UNKNOWN.

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
