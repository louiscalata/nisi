# C09 owner-capture checker proposal

## Latest owner verification — 10/10; still not accepted

After inspecting the revised code, the owner corrected dependent expected and
receipt descriptors in the owned mutation fixtures and limited large-map handling
to `negativeLocations`. The retained actual Node24 bundle, unmodified owned copy,
and targeted refusal controls now pass **10/10**, zero skipped/cancelled/TODO,
with unchanged input/bundle hashes: `checks-F2JMDE/checks.json` and raw logs.
The earlier8/9 failure remains in `checks-4UlqHZ/`; it exposed fixture masking,
not a valid substitute for the intended semantic negative tests.

This is scoped unit evidence only. The tests still source their expected contract
from retained fixture data. A separate owner wrapper must independently derive
current source/case/toolchain/runtime/writer expectations; Node22 and final source
review remain open. No C09 integration or acceptance is granted.

This is an isolated proposal. It reads the fixed seven-file Node24 bundle and
returns trusted-owner consistency only; it does not launch a process, rewrite
evidence, install Node22, attest hostile-writer isolation, attest descendant
drain, authenticate Node/npm/tar provenance, or authorize acceptance.

`c09-owner-capture-check.mjs` uses external `{root,pins,contract,ownerPins}` input so the capture
cannot self-authorize its own file hashes. It validates regular non-symlink
files, private modes, physical root identity, file identity stability, size
caps, closed JSON records, lifecycle/authority flags, exact command/cwd and
timeout, receipt/archive/expected/intent consistency, raw stdout/stderr hashes,
and the existing strict matrix reader. Node22 is deliberately represented as
`NOT_RUN`; a real independent Node22 bundle is required before a two-runtime
matrix can become complete.

The test proposal uses the retained `runtime-node24-TyjDOb` files read-only and
requires the exact trusted-owner result `CONSISTENT_NODE24_ONLY`, with Node22
`NOT_RUN` and matrix `INCOMPLETE`. Semantic lifecycle, source-contract, archive,
pin, fixed-root, closed-pin, and no-execution-surface cases use only scoped
temporary copies where a refreshed external pin cannot make an invalid record
valid.

Known boundary: this utility verifies consistency of caller-supplied owner
evidence against a separately supplied current source/stage/case/toolchain
contract. It cannot establish independent authenticity of the observer,
archive provenance beyond its retained bytes and receipt relationship, actual
process descendant drainage, or Node22 availability. It does not create a new
receipt schema. The original delegated drafting task did not execute tests.

## Owner test checkpoint — not acceptance

The owner inspected the proposal and executed the source-bound `verify.mjs`.
`checks-eluEFV/` retains the initial4/7 result: three semantic negative cases
stopped at `CAPTURE_PATH`, because `/tmp` is an alias on this Mac. The retained
Node24 positive control passed. The owner changed only the temporary fixture to
use the physical OS temporary directory and corrected the archive mutation's
assertion to the earliest actual binding check (`CAPTURE_SUMMARY`). No production
guard was weakened. `checks-9Xu63I/` then passed7/7 with zero skip/cancel/TODO;
checker/test/reader/context and seven retained capture-file hashes were unchanged
during each run. Owned temporary fixture copies were removed by test cleanup;
the retained real bundle was not changed.

This does **not** close DESIGN.md or C09. The current positive fixture obtains its
contract from retained expected.json, not independently from current repository
source. A real owner wrapper still must supply independently frozen current
source/runtime/writer expectations. The draft's optional after-identities,
unreconciled retained descriptors and remaining bounds/closed-input behavior
also require correction/review before any acceptance use. Do not install this
draft as an authorization gate on the strength of seven passing tests.

## Independent review disposition — NEEDS FIX

Read-only reviewer task `/root/sharedchami_cleanup_daybreak_review` returned these
five material findings against checker `8c492476b9d3660aa81f4f6b4caded7bc4aaab90bb57448bfd08ce57850e274e`.
Requested route label: Daybreak Blue; served identity and usage receipt UNKNOWN.
The review performed no executions and granted no acceptance.

1. Require `nodeAfter`/`writerAfter`; never substitute before-identities when
   after-evidence is missing. Add omission regressions.
2. Require and reconcile receipt/archive before/after and retained descriptors,
   retained expected descriptor and `expectedSha256`; bind exact paths, hashes,
   lengths and stable identities. Reject a failure field on positive captures.
3. Replace the self-derived test contract with an externally pinned fixture and
   a separately verified current-source owner wrapper. Include Node major/version/
   path/hash, writer identity and exact command/cwd. Observed inode/device facts
   remain per-run data, not portable expectations.
4. Replace `readFileSync(fd)` with a capped descriptor read and explicit EOF plus
   post-read mode/size/identity validation; refuse growth before unbounded allocation.
5. Recursively snapshot nested caller contracts with bounded Proxy-first,
   descriptor-first validation before any stringify. Cover revoked Proxies,
   getters and toJSON with zero-trap regressions. Close nested stdout fields too.

These are source-backed engineering gaps in an unintegrated owner utility, not
evidence that the original retained Node24 package test did not execute. Preserve
that capture and the original failures. Do not dispatch another model for a PASS
without repairing this reviewed candidate and rerunning discriminating tests.

## Isolated repair revision — source/test only, not acceptance

The candidate now requires explicit `nodeAfter`/`writerAfter`, receipt and
archive before/after records, retained receipt/archive/expected descriptors,
and `expectedSha256`; all are reconciled to stable retained bytes and exact
paths. Positive captures with a failure field are refused. Descriptor reads
use a bounded file-descriptor loop with an explicit EOF probe and post-read
identity/mode/size check.

Caller contracts are recursively bounded with Proxy-first and descriptor-first
inspection before comparison, including string/array/key/depth caps. The
checker rejects accessors, `toJSON` fields, ordinary proxies, revoked proxies,
cycles, and oversized nested records. Tests include omission and zero-trap
proxy/accessor regressions on owned temporary inputs.

The utility now requires an explicit frozen `ownerPins` record for Node and
writer identity, version, command, and cwd, separate from the seven retained
file pins and the source/stage/case/toolchain contract. This closes self-report
of runtime/writer identity inside the retained capture. It remains a caller
boundary: the isolated utility does not itself hash the live canonical source
tree or execute `check-private-package.mjs`; root must supply and independently
verify those current-source contract pins in the owner wrapper before any
acceptance use. No tests were executed for this revision.

## Schema repair revision — review follow-up, not acceptance

The retained descriptor families are now handled according to their actual
schemas: retained receipt/archive/expected records are exactly
`{path,sha256,byteLength}`, while receipt/archive before/after records retain
the seven-field identity shape. Original receipt/archive hashes and lengths
are bound to the retained bytes, and their before/after paths must resolve to
the exact evidence-directory paths reported by the receipt. Stdout archive and
negative-control objects are closed with their actual five/three-field shapes.

Recursive caller-array validation now handles arrays before object key limits,
requires dense own numeric elements plus `length`, and permits the frozen
negative-location count of 73 without treating array metadata as an extra
key. The regression records a getter trap counter and requires zero getter
invocations; descriptor-family omission cases are exercised only in temporary
copies with refreshed pins.

The independent-current-source owner wrapper remains intentionally open. This
isolated checker requires explicit frozen `ownerPins` and a separate contract,
but does not itself hash the live canonical source tree or execute the writer
contract. Root must supply and verify those current-source manifests,
toolchain, negative locations, Node major/version/path/hash, writer identity,
and command/cwd before any acceptance use. No tests were executed for this
revision.

## Owner review follow-up — temporary-root rebinding and input snapshot repair

The owner’s latest source-bound verification reported 8/9 checks passing and
one intended semantic negative misclassified: the temporary fixture retained
original-root descriptor paths, so the source-mismatch case stopped at
`CAPTURE_DESCRIPTOR` before reaching its intended `CAPTURE_INTENT` assertion.
The fixture now rebinds retained receipt/archive/expected paths to the owned
temporary root before mutation, and adds an unmodified temporary-copy positive
control. Production guards were not weakened.

The checker snapshots supplied contract and owner-pin trees recursively,
Proxy-first and descriptor-first, before nested field access or filesystem
reads. This removes the prior `ownerPins.command` proxy access before the
proxy guard and keeps revoked/ordinary proxy and getter counters at zero.
The independent current-source owner wrapper remains intentionally unresolved;
root must still derive and verify live canonical source/check-private-package
pins before acceptance use. No tests were executed for this revision.
