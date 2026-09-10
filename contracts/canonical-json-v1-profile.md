# Canonical JSON v1 — codec contract

An opt-in, explicitly versioned codec. Profile: `nisi-canonical-json-v1`.
Producers and consumers bind the profile explicitly; there is no automatic
fallback to some other serializer's bytes.

Input is an ordinary, non-shared `Uint8Array` (including Node Buffer), captured
once. Objects/strings/proxies, shared-memory views and detached or resized-out-of-
bounds views are refused. Current in-bounds resizable views are supported; limits
apply to the captured view, not unused backing bytes. Output is an
immutable profile/string/SHA-256 tuple. No file, network, queue, or model action
is performed by the codec — `scripts/structural-check.mjs` checks that
statically, and is itself mutation-tested.

The host JavaScript realm and its built-ins are trusted. Refusing proxy inputs
does not make this a sandbox, and it does not protect against malicious
replacement of global JSON/string/Buffer functions by code already running in
the same realm.

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
  then an exact repeated key gives `INVALID_JSON_DUPLICATE_KEY`. Keys are emitted
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

## What this does not claim

The rules above are the whole contract: byte order for keys, exact-byte key
identity under NFC, integers only, fatal UTF-8, null distinct from absent, fixed
container limits, exact literals, and a named code for every refusal. It does not make any statement about the correctness of
data passing through it, and agreement between two implementations of a profile
is evidence of agreement, not of correctness.

Tests must state exact bytes and require exact error codes. A test that accepts
"some exception was thrown" where a specific refusal code is specified does not
constrain this codec — which
is why `contracts/canonical-vectors.json` derives its expected bytes from an
independent serializer rather than from the codec under test.
