# nisi/render-tile/v1 — contract (work order nisi-render-tile-v1, 2026-09-14)

Owner: Claude (contract + protected tests). Draft: PC worker. Integration:
Claude. Review: OpenCode or Astra. Not integrated into the product until Louis
says so. Product context: Nisi Render Engine (see work-orders/nisi-render-engine).

## Module

`src/render-tile-v1.mjs`, ESM, zero dependencies. Imports only
`canonicalizeJSONV1` from `../../../canonical/canonical-json-v1.mjs`. The
whole body except the export list sits between `// PURE-REGION-BEGIN` and
`// PURE-REGION-END`: no process spawn, no filesystem, no network, no dynamic
code, no module load, no process mutation. Never include input content in an
error message (a refusal code is not input content).

Exports (all constants frozen):

- `RENDER_TILE_PROFILE_V1 = 'nisi-render-tile-v1'`
- `RENDER_TILE_LIMITS_V1 = { inputs: 256, neighbours: 256, children: 4096, idLength: 128, modelLength: 128, paramsBytes: 65536, paramsDepth: 120, paramsMembers: 4096 }`
- `RENDER_TILE_ROLES_V1 = ['generator','denoiser','reconciler','checker','assemble']`
- `RENDER_TILE_MODALITIES_V1 = ['code','image','text']`
- `RENDER_TILE_APRON_UNITS_V1 = ['symbols','pixels','chars']`
- `RENDER_TILE_VERDICTS_V1 = ['PASS','VALIDITY_FAIL','QUALITY_FAIL','APRON_STALE','REPLAY']`
- `RENDER_TILE_CODES_V1` = every refusal code below, in the order listed.
- `readRenderTileV1(input)` → `Object.freeze({ ok: true, profile, tile })` or
  `Object.freeze({ ok: false, profile, code, path })`. Never throws for any input value.
- `identityRenderTileV1(tile, childOutputs = [])` → 64-char lowercase hex.
  Throws an `Error` whose `.code` and `.message` are the refusal code when
  `tile` does not read (`readRenderTileV1` is applied to it first) or when
  `childOutputs` does not snapshot to an `Array.prototype` array of
  SHA256-or-null whose length equals `tile.children.length` (code
  `RENDER_TILE_CHILD_OUTPUTS`). It never throws any other error for a tile the
  reader accepts: every accepted tile has a computable identity.

## Definitions

- ID: string matching `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/`.
- SHA256: string matching `/^[0-9a-f]{64}$/`.
- INT: `Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0)`.
- Plain object: `typeof x === 'object'`, not null, and its prototype is
  `Object.prototype` or `null` (so arrays, Dates, Maps, class instances are not
  plain). Only own, enumerable, string-keyed data members count.
- Snapshot: before any validation the reader copies the input once with a
  descriptor walk. It refuses — as `RENDER_TILE_NOT_OBJECT` at `$` — any
  accessor property, non-enumerable own property, symbol key, object that is
  not plain, array whose prototype is not `Array.prototype` or that has own
  keys beyond its indices and `length`, any cycle (an object that is its own
  ancestor; shared sub-objects are copied again), a walk deeper than 160 (the
  root is depth 0), more than 200,000 object/array nodes, more than 8,000,000
  units of payload (string characters of keys and values plus array elements,
  counted per copy), any own key longer than 4,096 characters, and anything
  that throws during the walk (a Proxy trap on descriptors, keys or prototype;
  a getter). Everything after operates on the snapshot; no input property is
  read twice, no input method is ever called and the input's `[[Get]]` is never
  used (a Proxy whose only trap is `get` reads transparently).
- The member names `__proto__`, `prototype` and `constructor` are never schema
  members: as members of a schema object they are refused as
  `RENDER_TILE_UNKNOWN_MEMBER` with the path to that key; as `inputs` names
  they are refused as `RENDER_TILE_INPUTS` at `$.inputs`; as `apron` keys as
  `RENDER_TILE_APRON` at `$.apron`; inside `params` as `RENDER_TILE_PARAMS`.

## Schema (every member required; no other members anywhere)

```
{
  "schemaVersion": 1,
  "profile": "nisi-render-tile-v1",
  "tileId": ID,
  "kind": "leaf" | "parent",
  "inputs": { ID: SHA256 },                 // <= limits.inputs members, may be {}
  "recipe": {
    "role": one of ROLES,                   // "assemble" if and only if kind is "parent"
    "modality": one of MODALITIES,
    "model": null | non-empty well-formed string, length <= limits.modelLength
             (lengths are UTF-16 code units, String.prototype.length),
    "seed": null | INT,
    "params": plain object of values inside the canonical-json-v1 grammar:
              safe integers (not -0), well-formed strings, booleans, null,
              arrays, plain objects with well-formed NFC NUL-free string keys
              that are not the three reserved names; at most limits.paramsMembers
              members per object; objects and arrays nested at most
              limits.paramsDepth levels inside params (params itself is level 1);
              JSON.stringify byte length of the snapshot <= limits.paramsBytes
              (the reader keeps a running lower-bound estimate while walking
              params and stops at the first leaf that pushes it past the limit,
              so no O(n) operation ever runs on an unbounded string),
    "apron": { "size": INT, "unit": one of APRON_UNITS }
  },
  "neighbours": [ID],                       // unique, <= limits.neighbours, none equal to tileId
  "children": [ID],                         // unique, <= limits.children, none equal to tileId,
                                            // disjoint from neighbours; [] iff kind is "leaf"
  "attempt": INT,
  "budget": { "wallMs": INT >= 1, "tokens": null | INT, "memoryBytes": null | INT },
  "apron": { neighbourId: SHA256 | null }   // key set equals the neighbours set exactly
}
```

## Refusal codes and paths

Check order: snapshot (refusals are `RENDER_TILE_NOT_OBJECT` at `$`) → unknown
members of the root → missing members of the root → member values in schema
order; a nested object's unknown and missing members are checked when that
object is reached, before its values; on an `inputs` entry a bad name wins
over a bad value; nested values in schema order (`recipe.apron.size` before
`recipe.apron.unit`). Report the first failure only. Paths use `$`, `.name` and `[index]`.
For `neighbours` and `children`: array-level problems (not an array, too
many, or []/non-[] against kind) report the array path; entry-level problems
(not an ID, a duplicate — reported at the later occurrence — self, or a child
that is also a neighbour) report the entry index.

| code | when | path |
|---|---|---|
| `RENDER_TILE_NOT_OBJECT` | input is not a plain object | `$` |
| `RENDER_TILE_UNKNOWN_MEMBER` | any member outside the schema, at any level | the member |
| `RENDER_TILE_MISSING_MEMBER` | a required member absent, at any level | the member |
| `RENDER_TILE_SCHEMA_VERSION` | not exactly the number 1 | `$.schemaVersion` |
| `RENDER_TILE_PROFILE` | not exactly the profile string | `$.profile` |
| `RENDER_TILE_ID` | tileId not an ID | `$.tileId` |
| `RENDER_TILE_KIND` | not "leaf"/"parent" | `$.kind` |
| `RENDER_TILE_INPUTS` | not a plain object, too many members, or a name that is not an ID | `$.inputs` |
| `RENDER_TILE_DIGEST` | a value that is not SHA256 (inputs) or not SHA256-or-null (apron) | `$.inputs.<name>` / `$.apron.<id>` |
| `RENDER_TILE_RECIPE` | recipe not a plain object; role/modality/model/seed/apron invalid; role–kind mismatch | `$.recipe` or `$.recipe.<member>` (`$.recipe.apron.size` etc.) |
| `RENDER_TILE_PARAMS` | params not a plain object of JSON values, or too large | `$.recipe.params` |
| `RENDER_TILE_NEIGHBOURS` | not an array, too many, duplicate, self, or an entry that is not an ID | `$.neighbours` or `$.neighbours[i]` |
| `RENDER_TILE_CHILDREN` | not an array, too many, duplicate, self, overlaps neighbours, or []/non-[] against kind, or an entry that is not an ID | `$.children` or `$.children[i]` |
| `RENDER_TILE_ATTEMPT` | not INT | `$.attempt` |
| `RENDER_TILE_BUDGET` | budget not a plain object or a member invalid | `$.budget` or `$.budget.<member>` |
| `RENDER_TILE_APRON` | not a plain object, or key set differs from neighbours | `$.apron` |
| `RENDER_TILE_CHILD_OUTPUTS` | identity: childOutputs invalid | (thrown) |

## Output shape

`tile` is a fresh deep-frozen plain object with members in schema order;
`inputs` and `apron` members inserted in sorted key order (JavaScript still
enumerates integer-like keys first in numeric order — the canonical codec
re-sorts by key bytes for the identity, so that order is the normative one);
`recipe` members in the order role, modality, model, seed, params, apron;
`params` deep-copied. No reference to the input survives.

## Identity

`identityRenderTileV1(tile, childOutputs)` =
`canonicalizeJSONV1(Buffer.from(JSON.stringify({ apron, children: childOutputs, inputs, recipe }))).sha256`
where `apron`, `inputs`, `recipe` are the read tile's members.
Identity therefore ignores `tileId`, `kind`, `profile`, `schemaVersion`,
neighbour ORDER, `children` (ids), `budget` and `attempt`, and changes with
apron (whose keys are the neighbour ids, so a neighbour rename changes it),
child outputs, inputs and recipe. `childOutputs` is snapshotted and copied
by index before hashing. `attempt` was removed from identity on
2026-09-14 (panel finding: with attempt in the key, a vetoed attempt-0 identity
could replay in a later job; the journal now carries tombstones instead — see
unit-03). It is byte-compatible with the Python
reference `unit-02-tile-loop` for ASCII content (pinned vectors in the tests).
