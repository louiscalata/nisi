# Owner-context oracle proposal

Owner update: the delivered proposal has now been inspected and executed.
`checks-BMRkD0/checks.json` records the combined35/35 tests plus Nisi validation;
`CURRENT-SOURCE-REVIEW.md` supersedes the draft's unexecuted/wrapper-absent status
below. The original proposal description is retained as delivery context.

This is an isolated source-only test proposal for `c09-owner-context.mjs`.
It is not an acceptance gate and has not been executed. It does not read or
rewrite a retained capture as its source of truth.

The real-root case uses the current checkout plus the explicit Node24 path and
asserts the retained expected shape only after collecting fresh bytes. The
retained bundle is resolved as sibling `../runtime-node24-TyjDOb`, not as
`ROOT/runtime...`. It
requires 29 package files, 12 case records, 73 negative locations, exact
Node24 `v24.18.0`, and the retained writer identity/command shape.

The scratch fixture is physically owned and cleaned up by each test. It is
constructed from `collectOwnerContext({projectRoot: ROOT}).inputs`, copying
only project-relative files; every scratch fixture is positively collected
before its one mutation. The external Node binary path is supplied explicitly
rather than copied. It
tests a positive independent-source context and then source, case, writer,
symlink-ancestor, and 8 MiB oversize mutations. The scratch positive is not a
retained-capture positive and must not be used to claim rehearsal acceptance.

The expected implementation boundary remains: regular non-symlink files,
ancestor containment and identity, bounded reads, current-file SHA-256 maps,
runtime/writer descriptors, exact package/case inventories, current
TypeScript/@types/node/lock metadata, and frozen `ownerPins`. It must not
claim npm/tar provenance, native execution, model inference, publication, or
Node22 evidence.

Source and case text mutations are expected to produce a new current hash;
capture validation, not this context collector, owns stale-capture refusal.
The oracle also covers malformed UTF-8, moved `@ts-expect-error` markers with
73 locations retained, forbidden package dependencies, missing/extra/symlink/
directory cases, writer/contract changes, oversize source, and zero-trap
options accessors/proxies. Malformed UTF-8 is tested independently for
`package.json`, TypeScript metadata, `@types/node` metadata, and a baseline
case. Contract-source mutation also asserts the project contract is never
executed and cannot set a global marker. The proposal assumes the owner API rejects with a
`CONTEXT_*` code for fixture contradictions. If the implementation uses a
different documented refusal shape, adapt assertions without accepting a
success result. No current-source independent wrapper is present in this
directory yet; the test is intended to expose that integration requirement
rather than substitute for it.
