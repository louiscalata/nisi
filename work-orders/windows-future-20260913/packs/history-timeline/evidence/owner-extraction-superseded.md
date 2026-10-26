# Owner extraction and correction record

`evidence/revision-1.json` was treated as an outer worker envelope, not as a
compliant implementation artifact. The owner located the one exact literal
fence pair in its `output` string (` ```json ` ... ` ``` `), extracted only the
bytes between those delimiters, and applied strict `JSON.parse` to that inner
text. The outer reply was not accepted as compliant because it contained the
Markdown fence. The parsed inner object contained exactly one file,
`src/index.mjs`.

The parsed revision was installed as the starting source. Before correction,
the source omitted exact root-key validation and accepted negative zero for
`attempt`/`createdAt` (because the extracted checks used `Number.isSafeInteger`
plus `< 0` only). Running `npm run test:acceptance` against that source gave
exit 1 with 9 passing and 2 failing tests: the exact-input test and the
safe-nonnegative-integer test. The failing observations were the extra-key
root input being returned READY and `attempt: -0` being accepted.

The source-only correction added `keysExactly(input, ['runId', 'events'])` at
the root and centralized `safeNatural()` with an explicit `Object.is(value,
-0)` rejection for attempt and createdAt. The existing duration validator
already rejected negative zero. No tests, package, packet, queue, or roadmap
files were changed.
