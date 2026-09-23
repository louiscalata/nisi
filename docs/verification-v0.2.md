# Nisi v0.2 verification record

This record is limited to the public run journal and journal store in
`history/`. It does not carry forward v0.1 integration results or private
experiments.

## Scope

The direct journal tests exercise append identity and conflict handling, project
binding, payload redaction before fingerprinting and storage, revocation and expiry views, and
reopen behavior for a missing footer, malformed records and a broken hash chain.
They call the journal API directly and do not start a worker process. The store
tests exercise validated writes, read-back, replacement protection, truncation,
and malformed input through an injected filesystem interface. A regression
also checks that the store refuses a structurally valid chain containing an
invalid journal entry.

The journal and store are recordkeeping components. Their passing tests do not
prove that recorded events are true, that a filesystem honors durability
requests across every failure mode, or that another process or hardware layer
cannot modify data. Hash chains detect changes relative to the chain; they do
not authenticate a writer.

## Reproduction

Run both focused public test files from the repository root:

```sh
node --test tests/run-journal.test.mjs tests/run-journal-store.test.mjs
```

For this candidate snapshot, all 24 focused tests passed on Node v22.23.2 and
Node v24.18.0 on macOS arm64: 5 direct journal tests and 19 journal-store tests.
The full public `npm run check` passed 197 tests on each version. The scoped
static check also passed. The package archive contained 15 declared runtime
files with no worker or private artifacts, and an installed consumer imported
the declared entrypoints successfully. Native Windows results for this exact
candidate, hosted CI, live provider behavior, performance, and production
readiness remain unverified. Hosted CI must be checked against the exact commit
that runs it.

The prior v0.1 workflow, local-chat and platform evidence remains in the
[version-scoped v0.1 verification record](verification.md); it is not evidence
for new v0.2 behavior.
