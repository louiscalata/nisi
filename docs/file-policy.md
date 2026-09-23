# File Access Policy

Import `createFileAccessPolicy` from `nisi/policy` or the package root. This is
an additive name for `createContentConsent`; the original module, result codes
and v1 digest remain compatible. Run `node examples/allow-a-file.mjs` for six
admission/refusal cases without model execution.

## Declaration

The factory takes UTF-8 **canonical JSON bytes**, not a JavaScript object. Build
those bytes with `canonicalizeJsonV1(Buffer.from(JSON.stringify(declaration)))`.
Every declaration has exactly these fields:

| Field | Accepted value |
|---|---|
| kind | `nisi-content-consent-v1` |
| schemaVersion | `1` |
| generation | Positive safe integer |
| grantId | 1–96 lowercase ID characters, beginning with a letter |
| consentClass | `WRITTEN_DECLARATION` |
| scopeRoot | Absolute path, at most 1,024 characters |
| allowedKinds | Nonempty unique list drawn from `json`, `markdown`, `text` |
| maxContentBytes | Integer 1–65,536 |
| maxAdvisoryChars | Integer 0–2,048, measured in UTF-16 code units |
| lifetimeMs | Integer 1–3,600,000 |
| destination | `ON_DEVICE_APPLE_FOUNDATION_MODELS_ONLY` |
| networkEgress | `false` |
| contentPersisted | `false` |
| transcriptPersisted | `false` |

The factory also requires `{ clock }`, a function returning safe-integer
milliseconds. A ready result contains `grant`. Check `result.ok` before using
it. Construction and admission refusals return named codes; the separate JSON
canonicalizer throws its documented errors for invalid raw input.

## Admission

`grant.admitContent({ filePath, kind })` accepts exactly those two fields. The
path must be absolute and the kind must be permitted by the declaration. Kind
is a caller-provided label: labeling arbitrary UTF-8 text `json` does not parse
or validate its JSON structure.

The policy checks liveness, resolves the file and root, enforces directory
scope, checks a regular nonempty file and its size, opens the resolved file,
compares descriptor identity and nanosecond metadata, reads with a hard byte
cap, rechecks the opened file, and validates UTF-8. Where available, the open
uses `O_NOFOLLOW` and `O_NONBLOCK`. The successful record contains copied bytes,
content digest/length, consent digest, kind and advisory cap.

The opened-object checks reduce replacement and mutation races. A same-size
in-place write is detected when the filesystem reports changed metadata; a
write that leaves the compared metadata unchanged can escape that check. The
parent directories and file writers must remain trusted and stable: this is
not a directory-descriptor sandbox or proof against every concurrent filesystem
change.

`grant.revoke()` is terminal and prevents future admissions. It does not retract
returned bytes or cancel a model already running. `grant.status()` reports the
current liveness and admission count. Later clock failures are named refusals;
an operation samples its liveness once.

## Host responsibility

This records and enforces a written declaration at this file-read boundary.
It is not proof that a user clicked an approval button. The host must route
relevant reads through the policy and honor its destination/persistence rules
after receiving bytes. The booleans are declared constraints, not operating
system controls. This v1 grant never authorizes the local-chat or a cloud route.
