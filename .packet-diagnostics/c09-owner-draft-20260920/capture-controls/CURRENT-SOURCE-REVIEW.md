# C09 current-source owner check

Private engineering checkpoint · 2026-09-20 · **PASS SCOPED, C09 NOT ACCEPTED**

Finish packets **70% (7/10)** · NX **30% (3/10)** · v1 **0% (0/8)**.
The preceding engineering goal turn integrated history hardening. This turn
changes the C09 verification implementation and produces fresh owner evidence;
it is engineering progress, not a completed product or compatibility matrix.

## Before and after

| Boundary | Earlier checker | Current owner path |
|---|---|---|
| Current source | Caller could supply expectations derived from retained capture | Independently hashes the actual package, tests, toolchain and runtime |
| Capture identity | Caller supplies seven-file pins | Fixed command freezes seven hashes and byte lengths outside the capture |
| Package policy | Initial context draft imported checkout code before checking it | Independent reviewed policy; checkout contract is hashed but never executed |
| Original file identities | Closed field names, incomplete scalar validation | Normalized absolute paths, SHA-256, safe nonnegative integers and regular-file modes |
| Drift | Per-capture consistency | Full context and imported-code snapshots before and after |
| Test setup | Some draft fixtures used wrong paths and expected source changes to throw | Fresh positive scratch fixtures, changed hashes observed, stale captures refused separately |

## Verified evidence

- `current-gi3RNb/receipt.json`: actual fixed-root command returned
  `CONSISTENT_CURRENT_NODE24_ONLY`, with independent before/after context equal.
- `checks-Cc7aYX/checks.json`: 35/35 tests, no failures/skips/cancellations/TODOs,
  unchanged code and retained capture. This run predates adding Nisi validation.
- `checks-BMRkD0/checks.json`: same35/35 plus actual Nisi five-file validation:
  `VALIDATED`, contract PASS and syntax PASS. Nisi model inference and behavioral
  test mode were not used. Owner Node tests are separate evidence.
- Final `checks-uHKgdv/checks.json` repeats35/35 and the same five-file Nisi
  validation, now also pinning the owner test-runner itself before/after.
- The tests cover coherent capture substitutions, malformed file identities,
  UTF-8 failures, source/case changes, moved negative markers, dependency
  insertion, missing/extra/nonregular cases, oversized sources, proxies and
  accessors. An executable contract mutation refuses without setting its marker.
- The reviewed unit fixtures are owned temporary directories and are removed
  after testing; no user project data or retained real evidence was removed.

Run from `/Users/louiscalata/nisi`:

```sh
node .packet-diagnostics/c09-owner-draft-20260920/capture-controls/verify.mjs
node .packet-diagnostics/c09-owner-draft-20260920/capture-controls/verify-current-capture.mjs
```

## Independent source review

The existing Daybreak-labelled review agent first found import-before-pin
ordering; the owner corrected it. Its final exact-source review returned
**scoped PASS**, with no remaining material P1/P2 finding within the trusted,
static-checkout boundary. The agent did not execute tests. Requested route:
Daybreak-labelled existing agent; actual served identity, latency and usage:
UNKNOWN. Luna supplied and revised the isolated test proposal; the owner inspected
it, corrected its integration and executed the actual checks. No model consensus
or token-saving claim follows from this division of work.

| Reviewed file | SHA-256 |
|---|---|
| `c09-owner-context.mjs` | `855c90bbf74f6c76e7dc52b5ab1520f4d8379e54b3b0dd254cab28fe32db82ee` |
| `c09-owner-capture-check.mjs` | `d6fb2e01d4c86afb493d26224f64253dcfdf30512ac7db1af99890ff90f3ba85` |
| `verify-current-capture.mjs` | `ec5d71af76743d76b8c696c9b08b315cac31464471c737b91f12eda5f83bf1ab` |
| `c09-owner-capture-check.test.mjs` | `240856187c4b0fb5921bd2179edfe170a5fbebb03e7a91dc42526ea67d3ba9aa` |

The source-only Luna proposal delivered at
`3f485245cab9e73173abf9ab4e37af1bc8cdd14e66d7d08efe11874d8a5e3db0`
was inspected before execution. Prior failed runs and old receipts remain unchanged.

## Limits and next actions

> [!CAUTION]
> **Consistency is not authenticated execution.** The fixed command checks a
> trusted static checkout and the retained Node24 evidence. Its own reviewed
> bytes are bound by outer owner evidence; it cannot authenticate itself. It is
> not protection against a hostile same-user writer, npm/tar provenance proof,
> fsync/readback durability evidence, or descendant-drain attestation.

> [!WARNING]
> **Node22 is NOT_RUN; matrix INCOMPLETE.** A real separately approved Node22
> rehearsal of the same archive is still required. The pending isolated-runtime
> approval is not replaced by synthetic tests or this successful Node24 check.

- C08 still needs a qualifying actual OpenCode session export; its provisional
  fixture cannot prove the custom tools ran. The parallel read-only audit located
  the hold in `.packets/nisi-v02-c08-opencode-agent-proof.packet.md` and the retained
  share capture note (empty events, historical exit143); no live process is inferred.
- C10 and whole-product gates remain open. No package was published, no runtime
  installed, no native app launched, and no system/authentication setting changed.
- Fresh pipeline status at 2026-09-20T16:07Z: router `active:null`; one Qwen
  `qwen/qwen3.8-27b` instance reported loaded; inference NOT_TESTED. No models were
  loaded, evicted or swapped. Fable's pause and unrotated Jev key hold composed
  inference. Spark has no verified callable route. None receives participation
  credit in this checkpoint. Nisi's deterministic validation did run.

Publication remains prohibited pending the exact legal and engineering gates.
