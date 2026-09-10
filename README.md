> This is my first personal project I worked on in tech. If there's anyone out there with feedback, email me at jlcalata@me.com. — Louis Calata

# Nisi

**Nothing passes unless it is admitted.**

*Nisi* is Latin for *unless*. A decree nisi is a ruling that takes effect unless a
condition is met — the condition is the whole point, and nothing happens by
default. That is the design.

Nisi is three boundaries for systems that hand untrusted input to a language
model: a canonical JSON codec, a consent gate for on-device model input, and a
static purity checker that is mutation-tested against itself.

Each one refuses with an **exact named code** a caller can branch on: the codec
throws a typed `CanonicalJSONErrorV1` whose `.code` is that name and nothing else;
the gate and the executor return a frozen `{ ok: false, code }`. Nothing guesses,
nothing coerces, and there is no fallback path.

> **Where it runs.** The codec, the consent gate, the purity checker and the
> executor are plain Node.js — anywhere Node 22 or later runs, and CI exercises
> all of them on Linux with portable stand-in probes. The *real* probe under
> `probes/`, which hands admitted content to Apple's on-device model, builds and
> runs only on an Apple Silicon Mac with macOS 26 or later and Apple Intelligence
> enabled. Every number in this README was measured on Apple Silicon, macOS 27 —
> the one machine the complete system has been run on.

---

## The problem

Three things go wrong quietly when a pipeline feeds a model:

1. **The same payload hashes differently.** Key order or encoding shifts, digests
   stop matching, caches miss, and receipts from two runs can't be compared.
2. **Deciding what reaches the model is a judgement call.** Usually a boolean
   someone flips, or a prompt that politely asks not to include secrets.
3. **The code enforcing all this is code like any other.** If it silently stops
   enforcing, everything downstream keeps reporting success.

The third is the one that gets skipped, and it is the one that matters most. A
guard that quietly stops guarding is indistinguishable from a guard that is
working.

---

## The three boundaries

### 1. Canonical JSON

Bytes in, a frozen `{profile, canonical, sha256}` out. Two documents that mean the
same thing produce the same digest; two that don't, don't.

```js
import { canonicalizeJSONV1 } from './canonical/canonical-json-v1.mjs';

const { canonical, sha256 } = canonicalizeJSONV1(Buffer.from('{"z":1,"a":2}'));
// canonical → '{"a":2,"z":1}'
// sha256    → stable across key order, whitespace and escape form
```

It accepts `Uint8Array` and nothing else, because accepting "an object" means
accepting whatever that object's getters decide to return:

```js
const lengthOf = Object.getOwnPropertyDescriptor(typedArray, 'byteLength').get;
// …
if (!types.isUint8Array(input)) refuse('INVALID_JSON_INPUT');
```

Intrinsic getters are captured once at module load and the brand check is native,
so a `Proxy` never gets its traps invoked, a spoofed `byteLength` is ignored, and
a resized-out-of-bounds view cannot pass itself off as a valid empty document.
Limits are fixed and public: **1 MiB, depth 128, 4096 members per object.**
Integers only, by value: 9,007,199,254,740,991 is admitted and one more is not.

Refusal codes carry no input content, so a diagnostic can never leak the document
it refused. The full rule set is written down in
[`contracts/canonical-json-v1-profile.md`](contracts/canonical-json-v1-profile.md).

### 2. Consent gate

The boundary that lets caller-supplied content reach the on-device model. It is
deliberately a gate rather than a flag.

A grant is a canonical, digest-bound declaration of exactly **what** may be sent,
**from where**, **how much**, **for how long**, and **what may come back** — all
fourteen fields required, no extras permitted:

```js
{
  kind: 'nisi-content-consent-v1', schemaVersion: 1, generation: 1,
  grantId: 'release.notes', consentClass: 'WRITTEN_DECLARATION',
  scopeRoot: '/abs/path/to/approved',
  allowedKinds: ['json', 'text'],
  maxContentBytes: 4096, maxAdvisoryChars: 256, lifetimeMs: 60000,
  destination: 'ON_DEVICE_APPLE_FOUNDATION_MODELS_ONLY',
  networkEgress: false, contentPersisted: false, transcriptPersisted: false,
}
```

Every item is then checked individually against it, and the call returns the
**file's** bytes — never the caller's claim about them:

```js
const { grant } = createContentConsent(grantBytes, { clock: () => Date.now() });
const out = grant.admitContent({ filePath, kind: 'json' });
// out.code → 'CONTENT_ADMITTED' | 'CONTENT_OUT_OF_SCOPE' | 'CONTENT_KIND_REFUSED' | …
// out.bytes, out.contentSha256
```

Nothing throws. Absence of a grant is refusal, never a default.

What the gate actually enforces is best read off its test names:

- *scope is a path boundary, not a string prefix* — `/data/safe-x` is not inside `/data/safe`
- *a symlink cannot carry content across the boundary* — links resolve **before**
  the scope test, so a link inside the approved root pointing outside it is refused
- *a clock that moves backwards is refused, not trusted*
- *revocation is immediate and terminal*
- *a grant does not outlive its declared lifetime* — capped at one hour regardless

There is also a check most code omits: after reading, the byte count must still
match the `stat` — otherwise `CONTENT_CHANGED_DURING_READ`. A file swapped
between the size check and the read does not get through.

**A grant claims exactly what it can prove.** A local process cannot witness an
OS-issued user action, so `consentClass` records which of two things a grant is.
The stronger of the two, `CAPTURED_USER_INTERFACE_ACTION`, is declared and
deliberately left unissuable — no code path produces it, because nothing here can
honestly witness it.

The destination is `SystemLanguageModel`, the local model.
`PrivateCloudComputeLanguageModel` is a separate class this path never
constructs, so **a grant authorises no network egress of content.**

The executor in `neural/afm-content-executor.mjs` is what runs the gate: it
admits the item *first*, and only then spawns the hash-pinned probe with the
bytes on stdin, no arguments and no inherited environment. The probe's answer is
read by a closed reader — exact schema, exact evidence class, every authority
flag still false, digests matching the grant and the item — and anything else
is refused by name. A request the grant refuses never reaches a process; the
tests prove that with a marker file the stand-in probe never gets to write.

### 3. Purity checker

The codec's core sits between `// PURE-REGION-BEGIN` and `// PURE-REGION-END`.
The checker parses that region with the TypeScript AST and fails the build on any
process spawn, filesystem write, network call, dynamic code evaluation, module
load, process mutation, dynamic import or worker construction.

It works on the syntax tree, not the text — which is the entire point, and is what
the fixtures test in both directions: eight deliberate impurities that must be
caught, and eight clean near-misses (a variable named `evaluation`, an object key
named `spawn`, a method *declared* `writeFile`) that must **not** be flagged.

---

## Benchmarks

Node v24.18.0, `darwin-arm64`, 2026-09-10, median of 200 iterations.
Reproduce with `npm run bench`.

| case | bytes | median µs | result |
|---|---:|---:|---|
| admit 1 KiB | 1,082 | 34.85 | 29.6 MiB/s |
| admit 16 KiB | 16,645 | 365.65 | 43.4 MiB/s |
| admit 259 KiB | 265,264 | 5,568.5 | 45.4 MiB/s |
| admit 889 KiB | 910,475 | 19,199.6 | 45.2 MiB/s |
| refuse non-`Uint8Array` | — | 1.50 | `INVALID_JSON_INPUT` |
| refuse over byte cap | — | 1.71 | `INVALID_JSON_SIZE` |
| refuse depth over 128 | — | 23.50 | `INVALID_JSON_DEPTH` |
| refuse malformed bytes | — | 3.50 | `INVALID_JSON_SYNTAX` |

The second block is the one that matters for a gate. **Refusing costs 1–25 µs;
admitting a real document costs 35 µs to 19 ms.** A boundary under load degrades
toward refusal rather than toward cost, which is the correct direction for a
boundary to fail.

Purity checker self-test, about **0.13 s**: `"status": "PASS"`, no findings on
the codec, 8 of 8 mutations caught, 8 of 8 clean fixtures at zero findings.

Test suite: **118 tests, 118 passing.**

---

## With Nisi, versus asking a model

The purity check is a task you could hand to an LLM instead. So I measured it —
same 16 fixtures, same question, nothing simulated.

| | Deterministic checker | On-device model |
|---|---|---|
| Correct | **16 / 16** | 14 / 16 (87.5%) |
| Missed a real side effect | 0 | **0** |
| Flagged clean code | 0 | **2 of 8 (25%)** |
| Wall time, 16 cases | ~0.13 s (whole self-test) | 5–6 s (~300 ms median per snippet) |

**The model caught every real side effect.** Not one spawn, write, network call,
eval, import, require, process exit or worker got past it. The interesting result
is not that the model is bad at this.

It failed in the other direction. Both errors were false alarms on clean code:

```js
// ALLOW-003-EVAL-SUBSTRING              → model said IMPURE
const evaluation = scoreOf(input);

// ALLOW-004-FORBIDDEN-WORDS-AS-DATA     → model said IMPURE
const settings = { network: true, spawn: false, exec: null };
```

A variable named `evaluation` contains `eval`. Those object keys are data, not
calls. An AST knows the difference by construction; a reader working from text has
to *decide*, and here it decided wrong a quarter of the time — even though the
prompt told it, in so many words, that a substring is not a side effect.

**Why that matters more than the accuracy number.** False negatives get caught
downstream — something breaks and someone investigates. False positives get the
check turned off. A gate that cries wolf on a quarter of clean code will not
survive contact with a build pipeline, and its failure mode is that someone
disables it and nobody notices.

Re-running it reproduces the 14/16, the zero misses, and the same two false alarms
exactly; only the wall time drifts between runs, as inference does.

### What this measurement is, and is not

The model is Apple's on-device foundation model, driven through a small local CLI
called `afm` — a thin wrapper over the FoundationModels framework that takes a
prompt on stdin and prints the reply. Any equivalent works; pass its path as
`AFM=/path/to/afm npm run ab:purity`. It runs at ~300 ms per snippet. It is a
**small** model, and this is **not** a measurement of Claude, Codex or any
frontier model — those would very likely score higher on sixteen short snippets.
The claim here is narrower and more durable: *a probabilistic reader has a
false-positive rate on this task and an AST does not, and no amount of model
quality changes which of the two is a guarantee.*

The checker's 16/16 needs its own caveat: those are its own fixtures, so it is
defined to be exact on them. What they prove is that it **stays** exact — the
mutation half fails if it stops detecting, the allowed half fails if it starts
over-detecting. A checker that quietly went blind would fail its own suite.

---

## What's in the tree

| Path | What it is |
|---|---|
| `canonical/canonical-json-v1.mjs` | The codec. Zero dependencies. |
| `contracts/canonical-json-v1-profile.md` | Its written contract, rule by rule. |
| `contracts/canonical-vectors.json` | 13 agreement vectors. Expected bytes come from an independent serializer, never from the codec under test. |
| `neural/content-consent.mjs` | The consent gate. |
| `neural/afm-content-executor.mjs` | Runs the gate, then the pinned probe, then a closed reader over its evidence. |
| `scripts/structural-check.mjs` | The purity checker; `contracts/structural-fixtures.json` is its 8 mutants and 8 near-misses. |
| `scripts/common.mjs` | A second, simpler serializer, kept only as an independent oracle. |
| `scripts/bench.mjs` · `scripts/ab-purity.mjs` | The benchmark and the model A/B above. |
| `probes/afm-content-probe.swift` | The on-device probe the executor spawns. stdin only, no arguments. |
| `probes/afm-concurrency-probe.swift` | The concurrency measurement, 1–16 sessions. |
| `tests/` | 118 tests, 3 suites. |

---

## Install and run

Requires **Node 22+**. No runtime dependencies.

```bash
npm ci
npm run check      # purity check, then the full test suite
npm run bench      # the benchmark table above
```

CI is set up to run the same two commands on Node 22 and 24. The two Swift probes carry their
build line in their own header comment; the executor pins the resulting binary by
digest, so a probe is rebuilt and re-pinned locally rather than committed.

## Limits

- **Prototype**, version 0.1.0, one author, no external security review.
- The Swift probes under `probes/` need macOS 26, Apple Silicon and Apple
  Intelligence, which no hosted runner has; CI runs the Node half only.
  `npm run ab:purity` needs the `afm` CLI for the same reason.
- The consent gate proves a declaration was presented and enforced. It is **not**
  captured user-interface consent and cannot prove an OS-issued user action —
  `consentClass` exists so nothing can pretend otherwise.
- The canonical profile is versioned (`nisi-canonical-json-v1`) and callers must
  bind it explicitly. `scripts/common.mjs` is not a fallback; it is the
  independent oracle the agreement corpus is derived from.
- The A/B is sixteen short snippets against one small model: a real measurement
  of a narrow thing, not a general benchmark.

## License

[Apache License 2.0](LICENSE).
