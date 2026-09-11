> My first tech project. Feedback welcome: jlcalata@me.com — Louis Calata

# Nisi

**An allow-list for your AI's `read_file` tool.**

The model is untrusted; your Node process is trusted. When the model — or a
prompt injection steering it — asks for a file, Nisi checks the request against
rules *you* wrote and returns either the bytes or a named refusal code. Never
an exception, never partial data, never the refused content in a log line.

[![ci](https://github.com/louiscalata/nisi/actions/workflows/ci.yml/badge.svg)](https://github.com/louiscalata/nisi/actions/workflows/ci.yml)

## Use it

```js
import { createContentConsent } from './gate/content-consent.mjs';
import { canonicalizeJSONV1 } from './canonical/canonical-json-v1.mjs';

// 1. The rules. All fourteen fields are required; nothing is defaulted.
const rules = {
  kind: 'nisi-content-consent-v1', schemaVersion: 1, generation: 1,
  grantId: 'docs', consentClass: 'WRITTEN_DECLARATION',
  scopeRoot: '/srv/app/docs',                  // only files under here
  allowedKinds: ['json', 'markdown', 'text'],  // only these types
  maxContentBytes: 65536,                      // only this big
  maxAdvisoryChars: 512,                       // cap on what may come back
  lifetimeMs: 600_000,                         // rules expire in 10 min
  destination: 'ON_DEVICE_APPLE_FOUNDATION_MODELS_ONLY',
  networkEgress: false, contentPersisted: false, transcriptPersisted: false,
};

// 2. Hash the rules so the permission you wrote is the permission that runs.
const bytes = Buffer.from(canonicalizeJSONV1(Buffer.from(JSON.stringify(rules))).canonical);
const { grant } = createContentConsent(bytes, { clock: () => Date.now() });

// 3. In your tool handler. Synchronous; reads the file itself.
const r = grant.admitContent({ filePath: '/srv/app/docs/notes.md', kind: 'markdown' });
if (!r.ok) return r.code;   // CONTENT_OUT_OF_SCOPE | CONTENT_KIND_REFUSED | CONTENT_BYTE_LIMIT | …
return r.bytes;             // plus r.contentSha256 for your logs

// 4. Later.
grant.revoke();             // every request from now on: CONSENT_REVOKED
```

Run the full version and watch six requests get admitted or refused:

```bash
npm ci && node examples/allow-a-file.mjs
```

### The fourteen fields

Every field is required and there are no defaults, so a rule set can never be
looser than the one you wrote. The four at the bottom are fixed: a rule set
naming any other destination, or `true` for any of the three flags, is refused
outright at `createContentConsent` with `CONSENT_DECLARATION_REFUSED`.

| Field | Meaning | Allowed values |
|---|---|---|
| `kind`, `schemaVersion` | Which contract this is | `'nisi-content-consent-v1'`, `1` |
| `generation` | Your own version counter for this rule set | integer ≥ 1 |
| `grantId` | A name for your logs | `[a-z][a-z0-9_.-]*`, ≤ 96 chars |
| `consentClass` | What this rule set *is* — see Limits | `'WRITTEN_DECLARATION'` |
| `scopeRoot` | The one folder files may come from | absolute path, ≤ 1024 chars |
| `allowedKinds` | File types the model may receive | non-empty subset of `json`, `markdown`, `text`, no duplicates |
| `maxContentBytes` | Largest file that will be admitted | 1 … 65,536 |
| `maxAdvisoryChars` | Cap on text the model may send back | 0 … 2,048 |
| `lifetimeMs` | How long the rules stay valid | 1 … 3,600,000 (one hour, hard cap) |
| `destination` | Where admitted bytes may go | `'ON_DEVICE_APPLE_FOUNDATION_MODELS_ONLY'` only |
| `networkEgress` | May content leave the machine? | `false` only |
| `contentPersisted` | May content be written anywhere? | `false` only |
| `transcriptPersisted` | May a transcript be kept? | `false` only |

The rule set has to arrive as canonical bytes, not an object — that's what step 2
does. It means the `consentDigest` you get back is the hash of exactly the rules
in force, and two people holding the same rules hold the same digest.

### What `admitContent` checks, in order

Each request is checked independently. The first failing check names the
refusal; nothing later runs.

1. **Is the rule set still live?** Revoked → `CONSENT_REVOKED`. Clock returned a
   non-integer → `CONSENT_CLOCK_INVALID`. Clock went backwards →
   `CONSENT_CLOCK_REGRESSION`. Past `lifetimeMs` → `CONSENT_EXPIRED`.
2. **Is the request well-formed?** Exactly `{ filePath, kind }`, nothing else →
   otherwise `CONTENT_ITEM_INVALID`. Path must be absolute → `CONTENT_PATH_INVALID`.
3. **Is the kind allowed?** → `CONTENT_KIND_REFUSED`.
4. **Resolve symlinks on both the file and `scopeRoot`** (`realpath`). Either
   fails to resolve → `CONTENT_PATH_UNRESOLVABLE`.
5. **Is the resolved file under the resolved root?** Compared as a path with a
   trailing separator, so `/docs-evil/x` is not under `/docs`. Outside →
   `CONTENT_OUT_OF_SCOPE`. Because step 4 ran first, a symlink *inside* the root
   pointing *outside* it lands here too.
6. **Is it a regular, non-empty file within the byte cap?** `lstat` on the
   resolved path: not a file → `CONTENT_NOT_REGULAR_FILE`; zero bytes →
   `CONTENT_EMPTY`; over `maxContentBytes` → `CONTENT_BYTE_LIMIT`.
7. **Read it, then check it again.** Unreadable → `CONTENT_UNREADABLE`. If the
   byte count differs from the `lstat` size, the file changed between the check
   and the read → `CONTENT_CHANGED_DURING_READ`.
8. **Is it valid UTF-8?** Fatal decode; any bad byte → `CONTENT_NOT_UTF8`.

On success you get `{ ok: true, code: 'CONTENT_ADMITTED', bytes, contentSha256,
contentBytes, kind, consentDigest }`. The gate read the file itself, so `bytes`
is what is on disk — not what the caller claimed.

`revoke()` is immediate and terminal: there is no un-revoke. `status()` reports
`grantId`, `consentDigest`, how many items have been admitted, and whether the
rules are still live.

## Also in the repo

### `canonical/` — a JSON hasher

Same meaning → same `sha256`, whatever the key order, whitespace or escape form.
Used to hash the rules above; useful on its own for logging exactly what was
sent to a model or for cache keys.

```js
const a = canonicalizeJSONV1(Buffer.from('{"z":1,"a":2}'));
const b = canonicalizeJSONV1(Buffer.from('{ "a": 2, "z": 1 }'));
a.sha256 === b.sha256   // true;  a.canonical === '{"a":2,"z":1}'
```

Input is a `Uint8Array` and nothing else — objects, strings, proxies and
shared-memory views are refused with `INVALID_JSON_INPUT`. The typed-array
getters are captured once at module load, so a `Proxy` wrapping the input never
gets its traps invoked during validation. Limits: 1 MiB, nesting depth 128,
4,096 members per object. Keys are emitted in UTF-8 byte order; duplicate keys
and keys that aren't NFC-normalised are refused rather than silently merged.
Numbers are integers only, checked by value: 9,007,199,254,740,991 is admitted,
one more is `INVALID_JSON_NUMBER`. `null` and an absent key are different
things and hash differently. Every refusal is one of eleven `INVALID_JSON_*`
codes thrown as a `CanonicalJSONErrorV1` whose `.code` is the whole message —
no input content ever appears in the error.

The full contract, rule by rule, is in
[`contracts/canonical-json-v1-profile.md`](contracts/canonical-json-v1-profile.md).
`contracts/canonical-vectors.json` holds thirteen agreement vectors whose expected
bytes come from a second, independent serializer (`scripts/common.mjs`), never
from the codec under test, so the agreement test is not circular.

### `scripts/structural-check.mjs` — proof the hasher has no side effects

The hasher's core sits between `// PURE-REGION-BEGIN` and `// PURE-REGION-END`.
The checker parses that region into a TypeScript AST and fails on any call
matching eight rules: process spawn, filesystem write, network, `eval` /
`Function`, `require` / `dlopen`, `process.exit` and friends, dynamic `import()`,
and `new Worker` / `new WebSocket`. Because it walks the syntax tree rather than
grepping text, a variable named `evaluation` or an object key named `spawn`
doesn't trip it.

It tests itself in both directions on every run, using
`contracts/structural-fixtures.json`: eight snippets that each contain exactly
one forbidden call and must be caught by exactly that rule, and eight
look-alikes that must produce zero findings. A checker that silently stopped
detecting — or started over-detecting — fails its own suite.

`npm run check` runs this first, then the tests.

### `gate/afm-content-executor.mjs` + `probes/` — wiring it to a model

The one concrete integration: Apple's on-device model (AFM, via the
FoundationModels framework). Needs an Apple Silicon Mac with macOS 26+ and
Apple Intelligence on. Everything above runs on any Node 22+; CI runs the
executor's tests on Linux using stand-in probes.

The executor takes the rule set, a map of `taskId → { filePath, kind }`, and the
path plus SHA-256 of a compiled probe binary. For each request it:

1. runs `admitContent` — a refused request never reaches a process;
2. re-verifies the probe binary's digest, every launch, not once at startup;
3. spawns the probe with no arguments and no inherited environment, writing a
   one-line JSON header plus the admitted bytes to its stdin;
4. reads the probe's answer with a *closed reader*: exactly the expected
   fields, `status: "PASS"`, the right evidence class, every authority flag
   still `false`, and digests that match both the rule set and the admitted
   file. Anything else is refused by name (`BOUNDARY_VIOLATED`,
   `CONSENT_DIGEST_MISMATCH`, `EVIDENCE_SCHEMA`, …).

The answer to the caller is `{ ok, code, payloadSha256 }` — a digest, not the
model's text. The text is available separately through `readings()`, and the
reason for every refusal through `refusals()`, so a caller can tell exactly
which boundary a request hit.

`probes/afm-content-probe.swift` is that probe: stdin only, uses
`SystemLanguageModel` (on-device) and never `PrivateCloudComputeLanguageModel`,
keeps no transcript, echoes no content back, and marks every authority flag
false. `probes/afm-concurrency-probe.swift` is the benchmark that found the
model saturates at about 6 requests/second and reaches it with 4 concurrent
sessions. Both carry their build line in the header comment; the executor pins
the resulting binary by digest, so probes are rebuilt locally rather than
committed.

## Numbers

Measured on Apple Silicon, macOS 27, Node v24.18.0. Every figure here can be
re-run.

- **119 tests, 4 suites** — `npm test`. One suite runs `examples/allow-a-file.mjs`
  and pins its output, so the README sample can't drift from what the code prints.
- **Refusing is cheap.** `npm run bench`: refusing bad input costs 1–25 µs;
  admitting a 1 KiB document costs 35 µs, a 889 KiB one 19 ms. A boundary under
  load degrades toward refusal, not toward cost.
- **AST beats asking a model.** `npm run ab:purity` (Mac only) puts the same 16
  purity fixtures to a small on-device LLM. The checker: 16/16. The model: 14/16
  — it caught every real side effect and false-alarmed on two clean snippets
  (`const evaluation = …`, `{ network: true, spawn: false }`), even though the
  prompt said a substring isn't a side effect. Re-running reproduces the same
  two misses. Not a claim about large models; a claim that a syntax tree has
  no false-positive rate and a reader working from text does.

## Limits

- **Prototype.** Version 0.1.0, one author, no external security review.
- **Not a sandbox.** If the model can call `fs.readFile` itself, this does
  nothing. It only works when the model is on the far side of a tool call your
  process controls. It trusts the Node realm it runs in.
- **`consentClass: 'WRITTEN_DECLARATION'` means exactly that.** A rule was
  written and enforced. It does *not* mean a person clicked "allow" — a local
  process can't witness that. The stronger class,
  `CAPTURED_USER_INTERFACE_ACTION`, is declared but deliberately has no code path
  that issues it.
- **Synchronous.** `admitContent` reads the file on the calling thread. Fine
  for a tool handler; wrap it if you're on a hot path.
- **The only wired-up model is Apple's.** Attaching the gate to another
  provider's tool-call loop is a few lines in your handler (step 3 above), but
  nothing in the repo does it for you.

[`SECURITY.md`](SECURITY.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md) · [Apache 2.0](LICENSE)
