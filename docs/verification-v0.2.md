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

For the public code at `d2eaf44`, all 24 focused tests passed on macOS arm64
with Node v24.18.0. The full `npm run check` passed 197 tests and skipped one
Windows-only launcher control; the scoped static check and all 12 editable
README checks passed. The package archive contained 15 declared files
with no worker or private artifacts, and an installed consumer imported the
declared entrypoints successfully. The earlier `a3319d1` candidate also passed
the full 197-test Mac suite on Node v22.23.2.

[GitHub CI run 35897012299](https://github.com/louiscalata/nisi/actions/runs/35897012299)
passed on `d2eaf44`: hosted Windows Node 22 and 24 each passed 198/198 Node
tests; hosted Linux Node 22 and 24 each passed 197 with the Windows-only control
skipped. Every job also passed the 24 focused journal/store tests, scoped static
check and 12 editable README checks. The Windows launcher runs registered
stand-in probes through Node; this does not exercise an Apple model or a native
Windows Nisi application. The separate Windows PC handoff has no exact result.
Live provider behavior, performance, signed native distribution, and production
readiness remain unverified for this public candidate. The final GitHub commit
must be checked independently after publication.

The prior v0.1 workflow, local-chat and platform evidence remains in the
[version-scoped v0.1 verification record](verification.md); it is not evidence
for new v0.2 behavior.
