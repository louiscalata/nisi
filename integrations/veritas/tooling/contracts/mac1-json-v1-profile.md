# MAC1 canonical JSON v1 — private explicit codec contract

This is an opt-in codec prerequisite, not a migration of existing records or an
acceptance authority. Profile: `veritas-mac1-canonical-json-v1`. The legacy
`common.mjs` and `veritas.ts` serializers, signed records, digest domains and
Stage 5 roots are unchanged. Producers/consumers must bind the explicit profile
before adoption; there is no automatic fallback to legacy bytes.

Input is an ordinary, non-shared `Uint8Array` (including Node Buffer), captured
once. Objects/strings/proxies, shared-memory views and detached or resized-out-of-
bounds views are refused. Current in-bounds resizable views are supported; limits
apply to the captured view, not unused backing bytes. Output is an
immutable profile/string/SHA-256 tuple, never a model verdict or certification.
No file, network, queue, or model action is performed by the codec.
The host JavaScript realm and its built-ins are trusted. Rejecting proxy inputs
does not make this a sandbox or protect against malicious replacement of global
JSON/string/Buffer functions by code already executing in the same realm.

## Exact rules and refusal precedence

- Maximum input/output: 1,048,576 bytes. Container nesting: at most 128, counting
  the root container as one. At most 4,096 members **per object**, not globally.
- UTF-8 decoding is fatal. An initial UTF-8 BOM is refused. A BOM inside a string
  is preserved. `INVALID_JSON_SIZE`, `INVALID_JSON_UTF8`, `INVALID_JSON_BOM`,
  `INVALID_JSON_DEPTH`, and `INVALID_JSON_OBJECT_SIZE` name these boundaries.
- Strings decode JSON escapes exactly. Unpaired surrogate escapes refuse with
  `INVALID_JSON_STRING_SURROGATE`; malformed/truncated escapes or raw controls
  refuse with `INVALID_JSON_STRING`. Values are never Unicode-normalized.
- Object keys are checked left-to-right after decoding: NUL gives
  `INVALID_JSON_DUPLICATE_KEY`; a non-NFC key gives `INVALID_JSON_KEY_NOT_NFC`;
  then an exact repeated key gives `INVALID_JSON_DUPLICATE_KEY`. This explicit
  precedence resolves ambiguous wording in the earlier draft. Keys are emitted
  in ascending UTF-8/scalar order from an entry list, not a JavaScript object.
- Numbers must match `-?(0|[1-9][0-9]*)`, exclude `-0`, and have magnitude at most
  9,007,199,254,740,991. Every violation, including range, fraction/exponent,
  NaN or infinity, is `INVALID_JSON_NUMBER` before numeric conversion/output.
- Arrays retain order. Empty containers and top-level scalars are supported.
  Null and an absent member remain distinct. No trailing newline is hashed.
- Output escaping is JSON's short quote/backslash/control escapes, remaining C0
  controls as lowercase `\u00xx`, slash unescaped, other scalars raw UTF-8.
- Other grammar/trailing-content errors give `INVALID_JSON_SYNTAX`.
  Numeric candidates start with a digit, `-`, `+`, `N`, or `I`: malformed `.1`
  or `e1` is syntax, whereas `-.1`, `+1`, `NaN` and `Infinity` are number
  refusals. The spelling `1.0` is a number refusal before conversion to `1`.
  Wrong/uncapturable input gives `INVALID_JSON_INPUT`. Errors include no input
  content. Overlapping malformed cases follow the parser's left-to-right order.

This profile implements the intended R1–R8 byte boundary, with the above explicit
grammar/resource/error decisions. It does not by itself fix producer omissions,
array semantics, domain framing, Swift production parity or legacy migration.
Ordinary artifact validation is unchanged and may still admit fractional JSON.

## Historical corpus warning

The September 7 corpus is preserved. Six rows (ADV-06, ADV-05, S7, S05, S11 and
S12) contain descriptions or annotations rather than only the claimed raw input
bytes. The second versioned reassessment reconstructs their explicitly documented
hex/formulas as data, checks all three available generated-input hashes, and
retains the first 64/65 adverse audit unchanged. S05 and S12 are valid strings
after byte reconstruction, not refusal cases. Its old JS comparison
counts any exception as satisfying an expected refusal. The Python/Swift
references allow depth 512 rather than the stated 128 and use a separate integer
range code. Agreement between those references is not production R1–R8 proof.
New tests must state exact bytes and require exact error codes; no historical
expectation or success claim is rewritten to make the new codec pass.
