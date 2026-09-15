# Owner extraction and correction record

`evidence/qwen-alternate-draft.json` was treated as an outer worker envelope,
not as a compliant returned artifact. The owner located its one exact literal
` ```json ` / ` ``` ` fence pair, extracted only the bytes between that pair,
and applied strict `JSON.parse` to the inner text. The outer fenced response
was not called compliant. The parsed inner object contained exactly one
`src/index.mjs` file.

The draft implemented the row and enum contract but omitted exact validation
of the root `{ models }` key set. That omission allowed an ordinary JSON root
with an extra `__proto__` key to return READY. The owner reproduced this as
the acceptance red state: `npm run test:acceptance`, exit 1, 9/11 passing and
2 failures (extra top-level keys and dangerous top-level JSON keys).

The only source correction was adding exact root-key validation before reading
`models`. Nested exact-key validation, bounded strings, duplicate IDs, enum
counts, cloning, and inert handling of Unicode/special string values were
preserved. No tests, package, packet, queue, or roadmap files were changed.
