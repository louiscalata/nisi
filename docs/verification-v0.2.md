# Nisi v0.2 verification record

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

At v0.2.0, the last command packs the declared files, installs the archive in a
fresh temporary consumer with scripts disabled, and invokes the installed `nisi`
command. It uses a fixed demonstration and malformed model arguments; it does
not contact a model server. On `main` after the September 26, 2026 hardening
pass, it also checks that every export target is packed, that packed text uses
LF line endings, and that every relative link in the packed README resolves
to a packed file (the README currently uses only absolute GitHub URLs). It
imports every package export from the installed archive and removes
`NODE_USE_ENV_PROXY` from its child processes' environment. It also runs the
installed `nisi local-model` with well-formed arguments against a closed
loopback port, where nothing is listening, so it still does not contact a
model server.

For the September 23 stable CLI candidate on macOS arm64 with Node v24.18.0,
`npm run check:static` passed its eight forbidden and eight allowed structural
fixtures. `npm run check` passed the structural check and 207 Node tests, with
one Windows-only launcher control skipped. The installed-package check passed
with 18 declared archive files, offline installation, help, version, the fixed
demo, a preserved-symlink entrypoint, and refusal of malformed local-model
arguments before inference. The fixed demo returned `COMPLETED`, one repair,
`reportStored: true`, and `modelCalls: 0`. The editable v0.1 README consistency
check passed 12/12. Hosted Windows/Linux results for the stable release commit
are recorded under [Stable v0.2.0 release](#stable-v020-release); these Mac
results do not establish live provider behavior.

Run both focused journal and store test files separately when investigating
those APIs:

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
readiness remain unverified for this public candidate. After publication, the
GitHub prerelease tag `v0.2.0-rc.1` was verified at
`004b728959f70b379333137e66fd0d1aadac1807`.
[CI run 35897477859](https://github.com/louiscalata/nisi/actions/runs/35897477859)
passed all four hosted Windows/Linux Node 22/24 jobs on that exact commit.

## rc.2 correction and release baseline

The rc.2 source candidate checks that every retained entry's stored fingerprint
matches its validated, redacted entry during reopen. A regression builds a
canonical journal with a recomputed record chain and a mismatched fingerprint;
reopen reports `INVALID` and seals the journal, and the store refuses it.
An entry whose payload was legitimately pruned still reopens with its original
historical fingerprint. The check covers retained entries only. A retired
entry's fingerprint cannot be recomputed from its cleared payload and is
trusted as recorded in the chain, which does not authenticate its writer; a
party able to rehash the file can still change how that ID is classified. The
unreleased source on `main` also rejects a retired record that is neither
expired at the header time nor followed by `maxEntries` records, which narrows
but does not close that gap.

On macOS arm64 with Node v24.18.0, the focused journal/store tests passed
27/27. The full `npm run check` passed the structural check and 200 Node tests
with one Windows-only control skipped. The package dry run contained 15
declared files, and `npm audit --omit=dev` found zero production dependency
vulnerabilities. These checks do not verify native Windows operation or live
provider behavior. The published rc.2 tag targets
`17d6178e15ea0cd40a277c19ba8a26bcb3813597`; its
[four-job Windows/Linux Node 22/24 CI run](https://github.com/louiscalata/nisi/actions/runs/35901126815)
passed on that exact commit. The CLI added for stable v0.2.0 was checked again
on the final stable commit, as recorded below.

## Stable v0.2.0 release

The stable tag `v0.2.0` targets `41fb6aeb67713011abc40b1434f5a939a5704aa4`.
[CI run 35907095428](https://github.com/louiscalata/nisi/actions/runs/35907095428)
passed all four hosted Windows/Linux Node 22/24 jobs on that exact commit. Each
job ran the scoped static check, `npm run check`, the installed CLI package
check, the focused journal/store tests, and the editable README checks. GitHub
records the run as finished at 19:07:18 UTC on September 23, 2026, and the
release as published at 19:07:54 UTC. The release asset `nisi-0.2.0.tgz` is
42,439 bytes with SHA-256
`aa46147005814c4e72aaa87099894552122ebe2bed91dad89a61b61388be3737`, the digest
also recorded in
[the benchmark footprint manifest](../benchmarks/value/footprint/packages.json).

The tag, run, and asset facts above were read back from GitHub's release and
Actions records on September 27, 2026 and are recorded in
[github-actions.json](verification/2026-09-23-v0.2.0/github-actions.json). This
repository retains no job logs or per-job test counts for that run. These checks do not establish live-model
accuracy or native application readiness.

The prior v0.1 workflow, local-chat and platform evidence remains in the
[version-scoped v0.1 verification record](verification.md); it is not evidence
for new v0.2 behavior.
