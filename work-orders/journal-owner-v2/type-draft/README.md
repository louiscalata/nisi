# Journal owner v2 declaration draft

This directory is an isolated consumer-facing type draft for the reviewed JavaScript API. It is not wired into a package, export map, canonical `types/`, or product integration.

Typecheck command using the repository's existing compiler and Node declarations:

```sh
/Users/louiscalata/nisi-next-private/node_modules/typescript/bin/tsc -p /Users/louiscalata/nisi-next-private/work-orders/journal-owner-v2/type-draft/tsconfig.json
```

The draft is checked with the repository's existing TypeScript compiler at `/Users/louiscalata/nisi-next-private/node_modules/typescript/bin/tsc`.

The initial draft typechecked before the rejected-store correspondence review, but that alone did not prove its declared result shapes matched every runtime branch. In particular, a representable response rejected by `storeResponseMatches` is retained on `STORE_FAILED` as plain evidence. The declaration therefore exposes that field as `PlainData`, while `RECORDED` and `STORE_CONFLICT` retain validated store-result narrowing.

## Source-bound cautions

- `JournalOwner` uses a declaration-only private brand. The runtime value remains an empty frozen object registered in a private WeakMap.
- TypeScript cannot prove exact own enumerable key sets, ordinary/null prototypes, data descriptors, absence of symbols/accessors, well-formed strings, safe nonnegative integers, acyclicity, redaction-path validity, or the 16 MiB serialized limit. The JavaScript implementation remains authoritative for those checks.
- `PlainData` describes the supported recursive value domain but cannot express runtime integer bounds, density of arrays, or cycle rejection.
- `sha256: string` cannot express the runtime lowercase 64-hex invariant.
- Snapshot and result properties are declared recursively readonly to match frozen returned observations. This does not make caller-supplied input immutable at runtime; the implementation defensively copies accepted data.
- A `SUCCEEDED` journal entry is historical observation data, not a correctness, execution, authorization, native-product, or release certificate.
- `JournalOwnerFs` describes the methods the owner calls, not a security boundary or a claim of cross-process locking, power-loss durability, or safe proxy behavior.
