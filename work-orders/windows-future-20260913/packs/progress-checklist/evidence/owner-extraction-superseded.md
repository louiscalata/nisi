# Owner extraction record

`evidence/revision-1.json` is an outer worker envelope whose `output` contains
one literal ` ```json ` ... ` ``` ` pair. The owner selected that single pair,
extracted only its inner text, and applied strict `JSON.parse` to it. The outer
fenced response was recorded as noncompliant with the worker protocol. Only
the declared `src/index.mjs` path/content pair was selected; no evaluation or
other generated content was executed.

The extracted source already included exact root and milestone key validation,
bounded text, duplicate-ID refusal, enum counting, stable order, cloning, and
the contract's floor/null percentage calculation. No source correction was
required after installation.
