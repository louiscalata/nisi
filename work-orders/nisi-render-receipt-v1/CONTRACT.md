# nisi/render-receipt/v1 — contract (work order nisi-render-receipt-v1, 2026-09-14)

Owner: Claude (contract + protected tests). Draft: PC worker. Integration:
Claude. Review: OpenCode or Astra. Not integrated into the product until Louis
says so. Companion of `nisi/render-tile/v1` (work order nisi-render-tile-v1).
One receipt records one verify (or one replay) of one tile attempt. The panel
of 2026-09-14 asked that a receipt carry, per check, `{checkId, measured,
threshold, scope}` so a failing check can be shown, not just the verdict.

## Module

`src/render-receipt-v1.mjs`, ESM, zero dependencies. Imports only
`canonicalizeJSONV1` from `../../../canonical/canonical-json-v1.mjs`. The whole
body except the export list sits between `// PURE-REGION-BEGIN` and `// PURE-REGION-END`: no process
spawn, filesystem, network, dynamic code, module load or process mutation.
Never include input content in an error message.

Exports (all constants frozen):

- `RENDER_RECEIPT_PROFILE_V1 = 'nisi-render-receipt-v1'`
- `RENDER_RECEIPT_LIMITS_V1 = { checks: 256, idLength: 128, modelLength: 128, textLength: 256 }`
- `RENDER_RECEIPT_VERDICTS_V1 = ['PASS','VALIDITY_FAIL','QUALITY_FAIL','APRON_STALE','REPLAY']`
- `RENDER_RECEIPT_SOURCE_KINDS_V1 = ['worker','journal','assemble']`
- `RENDER_RECEIPT_CHECK_KINDS_V1 = ['validity','quality']`
- `RENDER_RECEIPT_OUTCOMES_V1 = ['pass','fail','not_run']`
- `RENDER_RECEIPT_SCOPES_V1 = ['cell','row','frame']`
- `RENDER_RECEIPT_CODES_V1` = every refusal code below, in the order listed.
- `readRenderReceiptV1(input)` → `Object.freeze({ ok: true, profile, receipt })` or
  `Object.freeze({ ok: false, profile, code, path })`. Never throws for any input value.
- `digestRenderReceiptV1(receipt)` → 64-char lowercase hex =
  `canonicalizeJSONV1(Buffer.from(JSON.stringify(readReceipt))).sha256` of the
  READ receipt (the ordered, copied object the reader returns). Throws an
  `Error` whose `.code` is the reader's refusal code when `receipt` does not read.

## Definitions

- ID: `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/`. SHA256: `/^[0-9a-f]{64}$/`.
  CODE: `/^[A-Z][A-Z0-9_]{0,63}$/`. INT: `Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0)`.
- TEXT: a well-formed string (no lone surrogates) of at most
  `limits.textLength` UTF-16 code units (`String.prototype.length`); model
  and id lengths are counted the same way.
- MEASURE: `null`, a safe integer that is not `-0`, or TEXT. This is the
  digest domain of canonical-json-v1 (safe-integer number tokens only); a
  fractional metric is carried as a scaled integer or as TEXT.
- Plain object: `typeof x === 'object'`, not null, prototype `Object.prototype`
  or `null`. Only own, enumerable, string-keyed data members count.
- Snapshot: before any validation the reader copies the input once with a
  descriptor walk. It refuses — as `RENDER_RECEIPT_NOT_OBJECT` at `$` — any
  accessor property, non-enumerable own property, symbol key, object that is
  not plain, array whose prototype is not `Array.prototype` or that has own
  keys beyond its indices and `length`, any cycle (an object that is its own
  ancestor; shared sub-objects are copied again), a walk deeper than 64 (the
  root is depth 0, so 64 nested containers walk and 65 refuse), more than
  200,000 object/array nodes, more than 8,000,000 units of payload (string
  characters of keys and values plus array elements, counted per copy), any
  own key longer than 4,096 characters, and anything that throws during the
  walk (a Proxy trap on descriptors, keys or prototype; a getter). Non-object
  values, functions included, pass through the walk and fall to the member
  rule. Everything after operates on the snapshot; no input property is read
  twice, no input method is ever called and the input's `[[Get]]` is never
  used (a Proxy whose only trap is `get` reads transparently).
- The member names `__proto__`, `prototype`, `constructor` are never schema
  members; where present as keys they are refused as
  `RENDER_RECEIPT_UNKNOWN_MEMBER` with the path to that key.

## Schema (every member required; no other members anywhere)

```
{
  "schemaVersion": 1,
  "profile": "nisi-render-receipt-v1",
  "tileId": ID,
  "identity": SHA256,                          // the tile identity (nisi/render-tile/v1)
  "attempt": INT,
  "source": { "kind": "worker"|"journal"|"assemble", "id": ID|null, "model": null|non-empty well-formed string <= limits.modelLength, "block": ID|null },
  "candidate": SHA256 | null,
  "verdict": one of VERDICTS,
  "checks": [ { "checkId": ID, "kind": "validity"|"quality", "outcome": "pass"|"fail"|"not_run",
                "measured": MEASURE, "threshold": MEASURE, "scope": "cell"|"row"|"frame", "code": CODE|null } ],
              // <= limits.checks entries; checkId unique within the receipt; a check with outcome "fail" must carry a non-null code
  "reviewer": null | { "id": ID, "model": null|non-empty well-formed string <= limits.modelLength },
  "elapsedMs": INT,
  "tokens": null | INT
}
```

## Refusal codes and paths

Check order: snapshot (refusals are `RENDER_RECEIPT_NOT_OBJECT` at `$`) →
unknown members of the root → missing members of the root → member values in
schema order (a nested object's unknown
and missing members are checked when that object is reached, before its
values) → consistency rules last. Report the first failure only. Paths use
`$`, `.name` and `[index]`. For `checks`: array-level problems (not an array,
too many) report `$.checks`; entry-level problems report `$.checks[i]` (not a
plain object) or `$.checks[i].<member>` (a bad member; a duplicate `checkId` at
the later occurrence; a failing check without a code at `$.checks[i].code`).

| code | when | path |
|---|---|---|
| `RENDER_RECEIPT_NOT_OBJECT` | input is not a plain object | `$` |
| `RENDER_RECEIPT_UNKNOWN_MEMBER` | any member outside the schema, at any level | the member |
| `RENDER_RECEIPT_MISSING_MEMBER` | a required member absent, at any level | the member |
| `RENDER_RECEIPT_SCHEMA_VERSION` | not exactly the number 1 | `$.schemaVersion` |
| `RENDER_RECEIPT_PROFILE` | not exactly the profile string | `$.profile` |
| `RENDER_RECEIPT_ID` | tileId not an ID | `$.tileId` |
| `RENDER_RECEIPT_IDENTITY` | identity not SHA256 | `$.identity` |
| `RENDER_RECEIPT_ATTEMPT` | attempt not INT | `$.attempt` |
| `RENDER_RECEIPT_SOURCE` | source not a plain object or a member invalid | `$.source` or `$.source.<member>` |
| `RENDER_RECEIPT_CANDIDATE` | candidate not SHA256-or-null | `$.candidate` |
| `RENDER_RECEIPT_VERDICT` | not one of VERDICTS | `$.verdict` |
| `RENDER_RECEIPT_CHECKS` | checks invalid (see above) | `$.checks`, `$.checks[i]`, `$.checks[i].<member>` |
| `RENDER_RECEIPT_REVIEWER` | reviewer not null and not a valid object | `$.reviewer` or `$.reviewer.<member>` |
| `RENDER_RECEIPT_ELAPSED` | elapsedMs not INT | `$.elapsedMs` |
| `RENDER_RECEIPT_TOKENS` | tokens not INT-or-null | `$.tokens` |
| `RENDER_RECEIPT_CONSISTENCY` | a consistency rule below fails | the path named by the rule |

## Consistency rules (evaluated in this order after all members are valid)

1. `source.kind` "worker" requires `source.id` non-null; "journal" and "assemble" require `source.id` null. Path `$.source.id`.
2. `verdict` "REPLAY" requires `source.kind` "journal"; any other verdict requires `source.kind` not "journal". Path `$.source.kind`.
3. "REPLAY" requires `checks` empty and `reviewer` null. Path `$.checks`, then `$.reviewer`.
4. "APRON_STALE" requires `checks` empty and `reviewer` null. Path `$.checks`, then `$.reviewer`.
5. "PASS" and "REPLAY" require `candidate` non-null. Path `$.candidate`.
6. "PASS" requires `reviewer` non-null (path `$.reviewer`), then `reviewer.id` different from `source.id` (path `$.reviewer.id`), then no check with outcome "fail", at least one "validity" check with outcome "pass" and at least one "quality" check with outcome "pass" (path `$.checks`).
7. "VALIDITY_FAIL" requires at least one "validity" check with outcome "fail". Path `$.checks`.
8. "QUALITY_FAIL" requires no "validity" check with outcome "fail" and at least one "quality" check with outcome "fail" (path `$.checks`), then `reviewer` non-null (path `$.reviewer`), then `reviewer.id` different from `source.id` (path `$.reviewer.id`).

Design note: rules 6 and 8 compare two id strings. For `assemble` and
`journal` sources `source.id` is null, so the comparison is vacuous by design
(the assembly step has no model actor); the same real actor under two ids
also satisfies it. A pure reader has no roster; actor identity is the
integrator's concern, not this module's.

## Output shape

`receipt` is a fresh deep-frozen plain object (arrays are `Array.prototype`
arrays) with members in schema order;
`source` members in the order kind, id, model, block; each check in the order
checkId, kind, outcome, measured, threshold, scope, code; `reviewer` members in
the order id, model. No reference to the input survives.
