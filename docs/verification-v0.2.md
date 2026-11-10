# Nisi v0.2 verification record

> **Scope: v0.2.0 only.** This record covers the v0.2.0 source (release tag
> `v0.2.0`, commit `e5f73b7`, tree `cb0d664`, which merges `91744af`) and the
> release candidates before it. v0.2.1 later
> changed journal reopen, store writes, the consent gate, snapshot limits and
> the CLI, and v0.3.0 added the `reasoningEffort` option and the Jev advisor.
> The v0.2.1 changes are covered by the regression tests listed in
> [the 2026-11-03 review](reviews/2026-11-03-main-findings.md); v0.2.1 and v0.3.0
> have no verification record equivalent to this one. Statements below about reopen,
> pruning and the CLI describe v0.2.0 and are not current behavior.

This record covers the public v0.2 command line, run journal, and journal store.
It does not carry forward v0.1 integration results or private experiments.

## Stable CLI scope

The public `nisi` command exposes help, version, a fixed deterministic workflow
demonstration, and an opt-in local-model demonstration for a fixed JSON task.
The latter requires an explicitly configured loopback endpoint and two distinct
model names. Neither command applies changes to an arbitrary repository, and
the fixed workflow demonstration makes no model call. CLI tests and installed
archive checks cover command parsing, error exits, packaging, and the fixed
demonstration. They do not establish live-model accuracy or native application
readiness.

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

From the repository root on Node.js 22 or newer, run the public source and
installed-package checks:

```sh
npm ci
npm run check:static
npm run check
npm run check:cli-package
```

The last command packs the declared files, installs the archive in a fresh
temporary consumer with scripts disabled, and invokes the installed `nisi`
command. It uses a fixed demonstration and malformed model arguments; it does
not contact a model server.

For the September 23 stable CLI candidate on macOS arm64 with Node v24.18.0,
`npm run check:static` passed its eight forbidden and eight allowed structural
fixtures. `npm run check` passed the structural check and 207 Node tests, with
one Windows-only launcher control skipped. The installed-package check passed
with 18 declared archive files, offline installation, help, version, the fixed
demo, a preserved-symlink entrypoint, and refusal of malformed local-model
arguments before inference. The fixed demo returned `COMPLETED`, one repair,
`reportStored: true`, and `modelCalls: 0`. The editable v0.1 README consistency
check passed 12/12. These Mac results do not establish live provider behavior.
The hosted Windows/Linux Node 22/24 run for the stable commit
([run 35907095428](https://github.com/louiscalata/nisi/actions/runs/35907095428))
passed on commit `41fb6ae`, the `v0.2.0` release target, whose tree (`cb0d664`) is
identical to the tag commit `e5f73b7`.

Run both focused journal and store test files separately when investigating
those APIs:

```sh
node --test tests/run-journal.test.mjs tests/run-journal-store.test.mjs
```

Commit identities in this record refer to today's `main`. Its history was
rewritten after these checks. The cited commits kept identical source trees,
but the linked CI runs show their earlier identities: `759d76e` was `d2eaf44`,
`61be5ae` was `004b728`, `b7fc3e2` was `17d6178`, and `143a778` was `a3319d1`.

For the public code at `759d76e`, all 24 focused tests passed on macOS arm64
with Node v24.18.0. The full `npm run check` passed 197 tests and skipped one
Windows-only launcher control; the scoped static check and all 12 editable
README checks passed. The package archive contained 15 declared files
with no worker or private artifacts, and an installed consumer imported the
declared entrypoints successfully. The earlier `143a778` candidate also passed
the full 197-test Mac suite on Node v22.23.2.

[GitHub CI run 35897012299](https://github.com/louiscalata/nisi/actions/runs/35897012299)
passed on `759d76e`: hosted Windows Node 22 and 24 each passed 198/198 Node
tests; hosted Linux Node 22 and 24 each passed 197 with the Windows-only control
skipped. Every job also passed the 24 focused journal/store tests, scoped static
check and 12 editable README checks. The Windows launcher runs registered
stand-in probes through Node; this does not exercise an Apple model or a native
Windows Nisi application. No result from a physical Windows PC is recorded.
Live provider behavior, performance, signed native distribution, and production
readiness remain unverified for this public candidate. After publication, the
GitHub prerelease tag `v0.2.0-rc.1` was verified at
`61be5ae53e7ef2eb19822d9ae21f3fa47951aef3`.
[CI run 35897477859](https://github.com/louiscalata/nisi/actions/runs/35897477859)
passed all four hosted Windows/Linux Node 22/24 jobs on that source tree.

## rc.2 correction and release baseline

The rc.2 source candidate checks that every retained entry's stored fingerprint
matches its validated, redacted entry during reopen. A regression builds a
canonical journal with a recomputed record chain and a mismatched fingerprint;
reopen reports `INVALID` and seals the journal, and the store refuses it.
In v0.2.0, an entry whose payload was legitimately pruned still reopened with
its original historical fingerprint. From v0.2.1, `reopen` rejects such rows
because the fingerprint is recomputed from the stored null-payload entry.

On macOS arm64 with Node v24.18.0, the focused journal/store tests passed
27/27. The full `npm run check` passed the structural check and 200 Node tests
with one Windows-only control skipped. The package dry run contained 15
declared files, and `npm audit --omit=dev` found zero production dependency
vulnerabilities. These checks do not verify native Windows operation or live
provider behavior. The published rc.2 tag targets
`b7fc3e23089c2ef8b5197e10d0d4671130fe7bd3`; its
[four-job Windows/Linux Node 22/24 CI run](https://github.com/louiscalata/nisi/actions/runs/35901126815)
passed on that source tree. The stable v0.2.0 CLI was checked on the
final stable commit, as recorded above.

The prior v0.1 workflow, local-chat and platform evidence remains in the
[version-scoped v0.1 verification record](verification.md); it is not evidence
for new v0.2 behavior.
