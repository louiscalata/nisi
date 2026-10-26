# C09 — private package evidence per supported Node runtime

PRIVATE. Nisi v0.2 finish cluster, packet `.packets/nisi-v02-c09-private-consumer-matrix.packet.md`
(NX-09). Author: Fable 5.1 (Claude), 2026-09-20, in an isolated mirror; the
integrator owns the checkout. Advisory evidence only: nothing here accepts,
installs, publishes or selects a runtime.

STATUS: REPAIR DRAFT FOR OWNER REVIEW (second candidate; the first was
rejected by review, every issue is addressed below). Oracle 8/8 (113 table
rows), graded `test:c09` 24/24, cluster baseline 34/34, 42/44 mutants caught
and the 2 survivors are behaviourally equivalent (named below). The Node 22
row is honestly NOT_RUN on this Mac.

## What this is

`runtime-matrix-v1.mjs` is a pure report reader over separately retained
staged-rehearsal receipts, the `receipt.json` that
`scripts/check-private-package.mjs` writes under `.build/private-package-*/`.
It reuses that rehearsal exactly as it exists (same archive, same consumer
fixtures, same export/file boundary, same `--offline --ignore-scripts` route)
and adds no second packaging path. The reader itself imports only
`node:crypto`, `node:path` (posix string helpers) and the package-file
inventory from `scripts/private-package-contract.mjs`; the oracle asserts the
module source names no filesystem, process, network, `fetch`, dynamic import
or `eval`.

The caller supplies one row per supported runtime:

```js
createRuntimeMatrix({
  rows: [
    { runtime: 'node22', receipt: null, prerequisite: NODE22_PREREQUISITE },
    { runtime: 'node24', receipt: fs.readFileSync('.build/private-package-XXXXXX/receipt.json', 'utf8') },
  ],
  expected: { sourceManifest: {/* file: sha256 of the current checkout */}, caseFiles: [/* tests/private-consumer listing */] },
});
```

`receipt` is retained text (hash-bound as `receiptSha256`) or a parsed object
(no hash to bind, so `null`); `null` means the runtime was not run and then a
`prerequisite` is mandatory and must be concrete: it names `Node <major>` of
that row and `scripts/check-private-package.mjs` (a placeholder such as `'x'`
is refused with `MATRIX_ROW_SCHEMA`). `expected` pins are optional; without
them source/case staleness is unknown and is not claimed either way. The
29-file package inventory is the imported contract itself: there is no
`packageFiles` pin (the first candidate had one, and it could lift a 27-file
archive to PASS; passing it now refuses with `MATRIX_EXPECTED_SCHEMA`).

## Row verdicts (never coerced toward PASS)

| status | when |
|---|---|
| `PASS` | rehearsal `PASS_SCOPED`; node major equals the row's runtime; archive, install, toolchain and negative-control evidence present, none duplicated; inventories equal the 29-file contract (and the pins, if given); stage bytes equal archive bytes; install exact; evidence directory is `<root>/.build/private-package-<tmp>` with `root` absolute; archive at `<evidence>/nisi-0.2.0-private.0.tgz`, installed at `<evidence>/consumer/node_modules/nisi`; pack and install argv equal the rehearsal route token for token (`rehearsalCommands` spells the same route) from `<evidence>/stage` and `<evidence>/consumer`, exit 0; TypeScript, negative-control and runtime checks executed by the identified `node.path` binary, inside `<evidence>/consumer`, with the compiler named by `toolchain.compilerPath`; TypeScript consumers exit 0 with `--noEmit` on every retained `.mts` case; negative controls exit 2 on every `negative-*.mts`, all expected locations detected, observed >= expected > 0, and the retained tsc diagnostics re-count to exactly `observed`, each naming a `negative-*.mts` of this rehearsal; runtime `--test` exit 0 whose TAP summary has tests = pass >= 1, fail/cancelled/skipped/todo = 0 and a matching plan; no signal/error on any check |
| `NOT_RUN` | no receipt; carries the concrete prerequisite |
| `MALFORMED` | not JSON, not a plain object, unknown/missing field at any depth, accessor or non-enumerable property, foreign prototype, symbol key (top level or inside a manifest), Array subclass, sparse array, lone surrogate, bad hex/ISO/version/count, `completedAt` before `observedAt`, a check that ran (`error:null`) without `stdout`/`stderr` (`RECEIPT_JSON`, `RECEIPT_SCHEMA`) |
| `UNSUPPORTED` | other rehearsal schema, unknown status vocabulary, any boundary differing from the rehearsal's declared nine, node major outside {22, 24} |
| `FAIL` | retained `FAIL`/`INCOMPLETE`/failure (judged before evidence presence, so a run that died before pack still reads `REHEARSAL_FAILED` with its failure surfaced); duplicated evidence for any role; aborted check (any check); `EVIDENCE_OUTSIDE_ROOT`, `ARCHIVE_PATH_MISMATCH`, `INSTALL_PATH_MISMATCH`; pack/install online, script-enabled, failed, run elsewhere (`*_CWD_MISMATCH`) or with any other argv (`*_ARGV_MISMATCH`, which is what `--no-offline`, `--ignore-scripts=false`, `--registry=...` or a foreign `--cache` read as); install of a different archive or not exact; `TYPESCRIPT/NEGATIVE_CONTROL/RUNTIME_CWD_MISMATCH`; `TOOLCHAIN_COMPILER_MISMATCH`; TypeScript/negative/runtime check failed, counts disagree, `NEGATIVE_DIAGNOSTICS_MISMATCH`, stage/archive drift |
| `MISMATCH` | `RUNTIME_RELABELED` (a Node 24 receipt on the Node 22 row or the reverse, or two retained rows that share a runtime identity, see below) or `CROSS_RUNTIME_ARCHIVE` (rows describe different archives; every retained row is marked) |
| `STALE` | archive/source/stage inventory differs from the package contract, source manifest differs from the checkout pins, consumer cases differ from the fixture listing |
| `SKIPPED` | `PASS_SCOPED` receipt missing archive/install/toolchain/negative-control evidence or a pack/install/TypeScript/negative/runtime check executed by the identified binary (one foreign-binary check is enough: `<ROLE>_EVIDENCE_MISSING`), or TAP reporting skipped/todo tests |

Matrix status: `PASS_SCOPED` only when every row is `PASS`; `INCOMPLETE` when
the only non-PASS rows are `NOT_RUN`; otherwise `FAIL`. `authorizing` is
always `false`. Unknown per-check durations stay `null` (never 0); `tokens`
is always `null` because the rehearsal declares `modelInference:false`;
`wallClockMs` comes only from the retained timestamps.

### Cross-row runtime identity

Row-local reads cannot tell a consistently relabeled copy from a real Node 22
run: review measured that `sed` on the only receipt this Mac can produce
(`v24.18.0` -> `v22.12.0`, `/usr/local/bin/node` -> `/opt/node22/bin/node`)
read as a complete two-runtime `PASS_SCOPED`. The matrix now refuses that: two
retained rows that share the binary hash (`node.sha256`, one binary cannot be
two majors), the evidence directory, `observedAt`, `completedAt` or the
receipt text hash are both marked `MISMATCH/RUNTIME_RELABELED` with matrix
reason `RUNTIME_IDENTITY_SHARED` and status `FAIL`. Measured on the real
`MrXumO` receipt relabeled onto the Node 22 row: `FAIL`, both rows
`RUNTIME_RELABELED`; a relabeled second real receipt (`Yr8SlF`, different
evidence directory and timestamps) is still caught by the shared binary hash.

Residual, stated plainly: a forgery that also invents a new `node.sha256`,
evidence directory and timestamps is a fully independent record and no pure
reader can distinguish it from an independent run (measured: `PASS_SCOPED`).
Binding `node.sha256` to a known Node 22 binary hash is an owner decision
after the Node 22 prerequisite is met; it is not a knob here.

## Current matrix on this Mac (measured 2026-09-20, mirror)

Only Node v24.18.0 at `/usr/local/bin/node` is installed. All seven retained
receipts under `~/nisi/.build/private-package-*` (every one predates this
packet; none was produced by it), read with `caseFiles` pinned and again with
the live checkout's source pins, identical results:

| receipt | observedAt (UTC) | node24 row | reason |
|---|---|---|---|
| `MrXumO` | 2026-09-20 06:41 | `PASS` | 29 entries, 8 TS cases, 73/73 negative locations re-counted from the retained diagnostics, 11/11 runtime tests |
| `Yr8SlF` | 2026-09-20 06:38 | `PASS` | as above, a second independent 29-file run |
| `Kr9uSm` | 2026-09-20 00:02 | `STALE` | `INVENTORY_STALE` (27-file archive) |
| `u6ZMvC` | 2026-09-20 00:29 | `STALE` | `INVENTORY_STALE` (27-file archive) |
| `0bMWQ4` | 2026-09-19 20:21 | `STALE` | `INVENTORY_STALE` (27-file archive) |
| `YQ3QA6` | 2026-09-19 20:18 | `FAIL` | `REHEARSAL_FAILED`, retained `ERR_ASSERTION` |
| `SeWBZX` | 2026-09-17 18:28 | `FAIL` | `REHEARSAL_FAILED`, retained ENOENT `@types/node` |

With `MrXumO` (or `Yr8SlF`) as the node24 row the matrix is `INCOMPLETE`:
`reasons: ['node22:RUNTIME_NOT_INSTALLED']`. That is the honest state: the
declared `engines.node >= 22` is not evidence of a Node 22 run. Selection
rule for the table: every `private-package-*` directory present, no omission.

## Node 22 prerequisite and the exact isolated route (owner executes later)

Nothing in this packet downloads, installs, or selects a runtime; no
automatic download is ever attempted. `NODE22_PREREQUISITE` says the same
thing. When the owner has placed an approved Node 22 binary in an isolated
prefix outside the checkout, the rehearsal runs unchanged under it, from the
checkout root:

```sh
PATH=<node22-prefix>/bin:$PATH NISI_INSTALLED_ARCHIVE_CHECK=1 <node22-prefix>/bin/node scripts/check-private-package.mjs
```

That script (unchanged by this packet) performs the two isolated npm steps
below with a fresh cache and lifecycle scripts disabled; `rehearsalCommands`
returns the same argv for documentation and refuses (`COMMAND_ARGS`) a node
path inside the checkout, because `node_modules/.bin` is not an isolated
prefix. The judge binds a retained receipt's pack/install argv to this same
route token for token.

```sh
# cwd <evidence>/stage
npm pack --offline --ignore-scripts --no-audit --no-fund --cache <evidence>/npm-cache --json --pack-destination <evidence>
# cwd <evidence>/consumer
npm install <evidence>/nisi-0.2.0-private.0.tgz --offline --ignore-scripts --no-audit --no-fund --cache <evidence>/npm-cache --package-lock=false
```

The receipt it writes becomes the `node22` row. The TypeScript compiler and
`@types/node` still come from the checkout's `node_modules`; the reader
records their versions/hashes per row and binds `toolchain.compilerPath` to
the tsc the checks actually ran, but does not require versions to match
across rows. If npm or tar is missing on the prefixed PATH the writer retains
a `FAIL` receipt whose spawn-failed check has no `stdout`/`stderr` keys
(spawnSync leaves them undefined); the reader accepts that shape only when
`error` is non-null and reads it as `FAIL/REHEARSAL_FAILED` with the failure
surfaced (measured on review's `writer-enoent-receipt.json`).

## What changed since the rejected candidate

| review issue | change | pinned by |
|---|---|---|
| consistent relabel read as PASS_SCOPED (high) | cross-row identity rule above | relabel test: sed-relabeled text, each shared field alone, identical text |
| only the TypeScript role's binary binding was pinned (high) | no reader change; fixtures | relabel test: one role relabeled at a time -> `RUNTIME_`/`NEGATIVE_CONTROL_`/`TYPESCRIPT_EVIDENCE_MISSING` |
| `args.includes('--offline')` open reader (medium) | exact argv and cwd binding to `npmRoute()` | table: `--no-offline`, `--ignore-scripts=false`, `--registry`, `--offline=false` inserted, foreign `--cache`, lock left on, cwd elsewhere |
| writer ENOENT receipt read as MALFORMED (medium) | `stdout`/`stderr` optional only when `error` is non-null | table: ran-without-stdout is MALFORMED; ENOENT fixture is FAIL/REHEARSAL_FAILED with failure, node and durations retained |
| symbol key in a manifest escaped as TypeError (medium) | key types checked before sort | table: symbol inside sourceManifest / archive.entries -> MALFORMED |
| `expected.packageFiles` knob (medium) | removed | closed-schema test and a 27-file pin refusal |
| checks not bound to this rehearsal's install (medium) | cwd of TS/negative/runtime = install cwd; installed path; compiler path | table: `*_CWD_MISMATCH`, `INSTALL_PATH_MISMATCH`, `TOOLCHAIN_COMPILER_MISMATCH` |
| pack exit / duplicate rules unpinned (medium) | fixtures | table: `pack exit 1`, duplicated pack/install/typescript/negative/runtime |
| paths unconstrained, negative count self-reported (low) | evidence layout, archive/installed path, diagnostics re-count with file membership | table: `EVIDENCE_OUTSIDE_ROOT` x4, `ARCHIVE_PATH_MISMATCH`, `NEGATIVE_DIAGNOSTICS_MISMATCH` x5 |
| node inside checkout accepted; `'x'` prerequisite accepted (low) | refusals | commands test; closed-schema test |
| README listed four of seven receipts (low) | table above lists all seven | measured on this Mac |
| unpinned closed-reader guards (low) | fixtures | lone surrogate, Array subclass, manifest accessor (by refusal `detail`), CHECK_ABORTED on tar/pack checks, FAIL-before-evidence |

## Acceptance evidence (measured in the mirror, Node 24.18.0)

| command | result |
|---|---|
| `node --check work-orders/v02-finish-cluster-v1/consumer/runtime-matrix-v1.test.mjs` | exit 0 |
| new oracle against the rejected candidate (+ one `REHEARSAL_SCRIPT` export shim so it links) | exit 1, 4/8 fail: relabel (sed copy reads `PASS_SCOPED`), table, closed schema (`'x'` accepted), commands (node inside checkout accepted) |
| new oracle against the naive stand-in that copies the receipt's own status | exit 1, 7/8 fail |
| `npm run test:c09 --prefix work-orders/v02-finish-cluster-v1` | exit 0, 24/24 (8 oracle + 5 package-contract + 11 consumer) |
| `npm test --prefix work-orders/v02-finish-cluster-v1` | exit 0, 34/34 |
| review's 26 scenarios (probe-forge, probe-adv A6/A9-A12/A20/A24/A26-A28, edges E1-E9, survivors B1/B2/B7) re-run on the repaired module | 26/26 read as required |

Mutants (module mutated in place, restored byte-identically after each run,
hash checked):

| mutant | verdict / failing assertion |
|---|---|
| B1/B2/B2t runtime, negative or typescript role not bound to `node.path` | caught: single-role relabel fixtures |
| B3 pack exit ignored | caught: `pack exit 1` |
| B4 ill-formed strings accepted | caught: `lone surrogate in a retained string` |
| B5 Array subclasses accepted | caught: `checks as an Array subclass` |
| B7 duplicates refused only for runtime | caught: `duplicated pack check` |
| B8 non-exact ISO accepted | caught: `observedAt not ISO` |
| B9 retained FAIL judged after evidence presence | caught: ENOENT fixture (`SKIPPED` !== `FAIL`) |
| B10 manifest accessor accepted | caught: `readRehearsalRecord` refusal `detail` |
| B11 CHECK_ABORTED only on the runtime check | caught: `archive inventory check killed by a signal` |
| B12 install archive binding dropped | caught: `install of a different archive` |
| B13 stage/archive drift unchecked | caught |
| B14 matrix status ignores MISMATCH | caught (3 tests) |
| B15 uppercase hex accepted | caught |
| B16 negative role `every` -> `some` | caught: `negative controls mixed with a positive case` |
| N1 identity rule dropped; N2-N5 one shared field dropped; N7 only node22 marked | caught: relabel test, one assertion per field |
| N8/N8b exact argv dropped / trailing tokens tolerated | caught: `install --no-offline appended` |
| N9-N14b cwd, archive path, installed path, evidence layout (incl. nested), compiler (both checks) | caught, one table row each |
| N15-N17 recount dropped / below-only / file membership dropped | caught, one table row each |
| N18 manifest key-type check dropped | caught: foreign `TypeError` escapes |
| N19/N20 stdout always / never required | caught |
| N21 prerequisite minimum dropped; N22 node-inside-checkout dropped; N23 `packageFiles` reintroduced; N24 NOT_OFFLINE reason collapsed | caught |
| N6 receipt-hash clause of the identity rule dropped | survived, equivalent: identical text implies identical hash, evidence and timestamps, so the clause is defense in depth and not independently observable |
| N25 `tapSummary(null)` guard dropped | survived, equivalent: `RegExp.exec(null)` coerces to `'null'` and returns no match, same result |

Not claimed: a Node 22 run; that a synthetic fixture equals a live receipt
(the reader was additionally exercised on all seven real receipts above and
on review's ENOENT receipt); independent acceptance (this oracle was written
with the implementation); resistance to a forgery that invents every identity
field (residual above).

## Observations and decisions for the owner

- Sequencing: P1 says "Create the named test only after the owner resolves
  the hold". `cluster.json` still shows `RUNTIME_SELECTION_REVIEW` and the
  packet is `blocked`; this oracle exists ahead of that resolution, in the
  mirror and the drafts directory only, and nothing entered the checkout. The
  owner decides whether to accept it as the frozen oracle or re-derive one
  after the hold.
- Pre-packet, `npm run test:c09` exits 0 with 16 tests even though the
  oracle file does not exist: `node --test` treats a missing path as an
  unmatched pattern. The P2 accept therefore cannot fail for a missing
  oracle; the dispatch check may want an existence assertion.
- `NODE22_PREREQUISITE` is the only prerequisite text this packet exports; a
  node24 NOT_RUN row (a Node-22-only host) needs its own text naming `Node 24`
  and the rehearsal script, which the schema enforces but does not supply.
- The packet hold and `cluster.json` are untouched; this draft edits only the
  three allowed files.
