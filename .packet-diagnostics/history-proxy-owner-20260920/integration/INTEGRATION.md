# History boundary correction — canonical private integration

**Status: verified Node-only correction integrated. September 20, 2026.**
Finish packets **70% (7/10)**; NX v0.2 **30% (3/10)**; v1 **0% (0/8)**.
This closes a history-input defect, not another whole-product milestone.

## What changed

`history/journal-owner-v2.mjs` and `history/run-journal-v1.mjs` now reject ordinary
and revoked Proxies before reflection. The correction is identical to the
independently reviewed candidate. Requests, configuration, nested entries and
filesystem capability wrappers are covered. The clock-error priority, valid
null-prototype inputs, redaction, serialization and post-refusal recovery remain.
The store implementation and memory-filesystem oracle remain byte-identical.

The new `historyHardening` record allows only two exact predecessor-to-current
source transitions. It is separate from C07's original one-file transition.
Old C04-C07 evidence, source maps and receipts were not rewritten. Historical
tests restore the actual hash-checked old sources; current tests require the
new record and all bound evidence. Missing or rehashed evidence cannot silently
authorize unrelated source changes, native execution, inference or publication.

## Before and after

| Check | Original source | Integrated source |
| --- | ---: | ---: |
| New Proxy-boundary oracle | 11/41 pass, 30 fail | 41/41 pass |
| Existing isolated owner/journal/store cases | 95/95 | 95/95 |
| Canonical history including protected store faults | Not rerun as this combined suite | 154/154 |
| Host and CLI history integration | Not rerun this turn on predecessor | 50/50 |
| Affected C05 / C06 / C07 suites | Prior evidence retained | 111/111, 52/52, 54/54 |
| Inventory / dispatch adverse controls | Historical results retained | 106/106 |
| Offline CLI archive, install and command checks | Prior archive retained | 111 checks, PASS_SCOPED |

These scopes overlap. Do not sum them into unique tests or infer product
accuracy, token savings, a benchmark advantage or native-app acceptance.
Every test suite reports zero skipped/cancelled/TODO tests and unchanged input
snapshots. Actual runtime: Node v24.18.0. Node22 compatibility remains separate.

## Evidence

- `evidence.json`: frozen additive source/evidence record; exact three-file Nisi
  validation and structured source review included. Nisi validation was reused
  for identical candidate bytes; no fresh model call is claimed.
- `canonical-jwtGZe/checks.json`: 154/50/111/52/54 importing suites and raw logs.
- `controls-3rrvv2/checks.json`: inventory, 106 adverse tests and offline CLI run.
- `offline-cli-receipt.json`: exact retained copy of the 111-check CLI receipt.
  Original archive/install tree remains under `.build/private-cli-package-NyVtZP/`;
  it is local, not a published or globally installed package.
- `final-source-review.json`: owner transcription of final independent source
  review. Requested Daybreak label; actual served identity/usage UNKNOWN. The
  reviewer did not run tests. Luna drafted adverse cases; owner corrected paths,
  integrated them, added composed-current checks, and ran all verification.

> [!CAUTION]
> **This remains a trusted-host interface, not an execution sandbox.** Refusing
> Proxies does not make arbitrary injected filesystem methods or modified global
> JavaScript intrinsics trustworthy. History observations grant no execution or
> resume permission. The full native, live-model and release gates remain open.

## Parallel C09 work

The isolated capture checker now requires before/after identities, binds retained
receipt/archive/expected bytes, reads through bounded descriptors with EOF checks,
and rejects nested caller Proxies before inspection. Its real Node24 bundle and
owned-copy controls pass 10/10 in `capture-controls/checks-F2JMDE/` after a retained
8/9 failure exposed an invalid temporary-fixture descriptor.
This is **not C09 acceptance**: independent current-source expectations still need
an owner wrapper, final review is incomplete, and the real Node22 lane is NOT_RUN.

Fable stays on its retained usage-cap pause. Jev's key rotation remains pending,
so composed inference is held; no standalone bypass was used. No Spark inference,
model load/eviction, authentication change, native launch, push or publication.
