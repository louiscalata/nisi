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

## What it actually checks

- **Scope is a path, not a prefix.** `/docs-evil/x` is not inside `/docs`.
- **Symlinks resolve first.** A link *inside* the allowed folder that points
  *outside* it is refused. The example demonstrates this.
- **The file is re-checked after reading.** If its size changed between the
  stat and the read, `CONTENT_CHANGED_DURING_READ`.
- **Time only moves forward.** A clock that goes backwards is refused, and no
  rule set lives longer than an hour.
- **Codes carry no content.** A refusal for `secrets.json` never quotes `secrets.json`.

## Also in the repo

- `canonical/` — a JSON hasher: same meaning → same `sha256`, whatever the key
  order. The rules above are hashed with it, and you can use it to log exactly
  what was sent. Zero dependencies, 1 MiB / depth 128 limits, integers only.
- `scripts/structural-check.mjs` — proves the hasher's core contains no file
  write, network call or `eval`, by walking the AST. It tests itself against
  8 planted bugs and 8 look-alikes that must *not* trip it.
- `gate/afm-content-executor.mjs` + `probes/` — wires the allow-list to Apple's
  on-device model (AFM). Needs a Mac with Apple Intelligence. Everything else
  runs on any Node 22+.

## Numbers

119 tests. Refusing costs 1–25 µs; admitting a 1 KiB file costs 35 µs
(`npm run bench`). The AST check vs. asking a small on-device LLM the same
16 questions: 16/16 vs 14/16, the model's two misses both false alarms on
clean code (`npm run ab:purity`, Mac only).

## Limits

Prototype, one author, no external review. **Not a sandbox** — if the model can
call `fs.readFile` itself, this does nothing; it only works when the model is
on the far side of a tool call you control. `consentClass: 'WRITTEN_DECLARATION'`
means exactly that: a rule was written and enforced, not that a person clicked
"allow."

[`contracts/canonical-json-v1-profile.md`](contracts/canonical-json-v1-profile.md) ·
[`SECURITY.md`](SECURITY.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md) · [Apache 2.0](LICENSE)
