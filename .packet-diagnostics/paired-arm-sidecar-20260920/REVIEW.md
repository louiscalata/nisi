# Durable paired-arm evidence — private implementation checkpoint

Date: 2026-09-20. Baseline: `4d07da125379318c49e0f71223fb9a917a636e96`.
Owner: Codex. No publication, inference, native-app acceptance or release approval.
Finish-packet acceptance remains **70% (7/10)**; NX/v0.2 remains **30% (3/10)**;
v1 remains **0% (0/8)**. These are separate acceptance checklists.

## Outcome and scope

The original scheduled-arm controller now has a bounded, separately chained,
redacted admission/projection sidecar, a read-only cross-ledger inspector, and
a durable composition using the original runner and owner lifecycles. Existing
main-log formats and accepted packet source pins are unchanged.

Before: admission/projection callbacks could be inspected only in process.
After: the sidecar binds exact retained main-record hashes, scheduled intents,
immutable approval, original owner-set identities, phase starts, results and
final rows. Missing links, invalid shapes and inconsistent histories refuse or
remain incomplete. This does not create authority from stored data.

### Retention order

```text
main SCHEDULE → sidecar HEADER
sidecar PREPARED → main START → sidecar START_LINKED
sidecar HISTORY → main PHASE_RESULT → sidecar PHASE_OBSERVED
main FINAL → sidecar FINAL
```

The store uses exclusive creation, private file/parent checks, bounded records,
short-write handling, fsync, readback and explicit EOF validation. FINAL is not
acknowledged until close succeeds. Storage uncertainty is sticky: no reopen,
retry, reconstructed permission, automatic resume or replacement dispatch.

## Actual verification

Current accepted receipt: `checks-M9eSQX/checks.json`.
Owner-authored driver: `verify.mjs`. Runtime: Node v24.18.0.

| Check | Actual result |
| --- | --- |
| New codec/store/composition/crash tests | 55/55 pass |
| Existing importing regression suites | 242/242 pass |
| Unchanged control after mutations | 55/55 pass |
| Deliberate producer-shape fault | 3 assertion failures; caught |
| Deliberate nullable-outcome fault | 2 assertion failures; caught |
| Deliberate scheduled-intent-binding fault | 2 assertion failures; caught |
| Deliberate mutable-approval fault | 1 assertion failure; caught |
| Nisi ten-file scope/contract/syntax validation | VALIDATED; contract and syntax PASS |
| Relative-import input inventory | 105 hashes unchanged before/after |

Normal runs have no failures, skips, cancellations or TODOs. Mutations ran only
in isolated mirrors, with reviewed unchanged dependencies linked to the canonical
checkout. Counts are test points, not product accuracy or unique requirements.
The input inventory covers the driver's relative-import closure, not every
possible dynamic asset. On continuation, all 105 current hashes were independently
compared with the retained receipt and still matched.

Nisi normalized input SHA-256:
`f770b30179d17ebe4d39f492ffb466fd97afa98298eabf5fcd7e17b8f1baf013`.
Nisi inference and scratch behavioral-test mode were NOT_RUN; project-native
tests above were separate owner-run checks.

Seven child-process SIGKILL cuts cover sidecar preparation, main start, sidecar
start, main executor result, oracle result, main final and sidecar final.
Each child must close with SIGKILL before parent inspection/cleanup. The last
cut can leave a complete cross-linked byte history without proof that the caller
ever received its acknowledgement. Synthetic model requests are counted only
as fixture requests; they do not establish provider execution or billing.

## Findings repaired and adverse evidence preserved

- Exact producer schema checks now run before fingerprint checking/redaction;
  recomputed hashes do not authorize extra, omitted or hybrid producer fields.
- Null/unknown terminal outcomes and receipt labels no longer pass validation.
- Failed FINAL close no longer advances acknowledgement/counters. Readback
  checks EOF; an existing empty file differs from an absent file.
- Caller approval is captured immutably once for controller and sidecar. The
  before-fix mutation regression failed, and the corrected test passes.
- Semantic forgery tests update unrelated reference hashes so their failures
  exercise intended semantic checks, not merely stale downstream links.
- Initial assertion/fixture errors (null-prototype comparison, wrong no-change
  option and macOS `/var` alias) were corrected rather than credited as defects.
- Independent crash-harness review found fixture workspaces outside the owned
  temporary root. The helper now accepts an optional absolute workspace parent;
  the crash child supplies its parent-owned root, and the parent verifies it.
  Existing default fixture behavior is unchanged. Final verification includes
  this correction; older possible `.build` leftovers remain preserved for
  separate classification, not claimed cleaned.

Earlier `checks-p941sc` and `checks-Uy0jW0` are superseded, retained history.
Original drafts/notes and adverse results remain on disk. Mutation mirrors and
unrelated working copies are not blanket-staged into this checkpoint.

## Independent work and routing limits

- Luna-requested agent drafted the store; owner inspected/corrected/integrated it.
  Its final independent crash-harness re-audit closed the cleanup finding on
  the exact hashes below. It did not execute the owner tests.
- A Daybreak-labelled independent source review reported no remaining scoped
  P1/P2 findings in the four production files and three primary tests. The
  exact reviewed hashes match this receipt. This review is separate from tests.
- Requested labels are not proof of served model identity; usage and served
  identity were not returned for those reviews and remain UNKNOWN.
- Fable remains paused by its explicit usage-cap handoff. Jev key rotation has
  not been confirmed, so composed inference/feedback was not attempted.
- At 16:56:42Z, shared router status was `active:null`; Qwen3.8-27b was reported
  loaded, inference NOT_TESTED. No model was loaded, evicted or swapped. A fresh
  idle listing does not settle the historical uncertain OpenCode request.
- No callable Spark tool was exposed. No model participation is inferred from
  installed credentials, catalog entries, role names or historical receipts.

## Exact implementation/test hashes

```text
f79bff6baf8c6dbc6738c47df4a49039044384569ca139e140438ed7c094922d  history/paired-arm-sidecar-codec-v1.mjs
89b71397aae2a4638a4074242057dbf447f37a653c20d9c8154220d1f9e2f59b  history/paired-arm-sidecar-store-v1.mjs
8c22a08ef5508a9af4567e787cdf9602cdd97a0d949dbf317a96ad3e7850c489  history/paired-arm-reconciliation-v1.mjs
4c0edecf1174e8eaef1b46c3807583d03a659b3e40372d4ccb4b8b3ad876331a  hosts/repository/durable-paired-arm-owner-v1.mjs
63c661254236f050102301cd1ad572187f81916b31885c1352cdfa7beaa4d578  tests/paired-arm-sidecar-codec.test.mjs
f78f4eece891fc1dc6f34bc3725fb9d9b7a1405ec7645b7817dfd784f00fff09  tests/paired-arm-sidecar-store.test.mjs
e0196511b0f04b1eb7a96baf33885b7819d9476742d68cbf58495e37650a386d  tests/durable-paired-arm.test.mjs
5b30f989a042e8162fe3d5cdd321ee0f542fe810e254fba527b1c42d57a39ea1  tests/paired-arm-process-death.test.mjs
315ea763b3e2b2e5338fae80050b819ed9e4a5b4d428505dad89c45bf4ec79fb  tests/helpers/paired-arm-crash-child.mjs
ff539128d0dda47fcd9a7c930b9edabca0dd40433fd1856b8a90af584ef53ee4  tests/helpers/repository-live-run-fixture.mjs
```

> [!CAUTION]
> **Cross-linked evidence is not a successful or resumable experiment.** A final
> ledger may contain incomplete or not-started rows. Fsync acknowledgement does
> not prove power-loss durability, authenticated authorship, hostile-writer
> isolation, simultaneous two-file capture, remote stop or a prior caller's ack.
> Actual dispatch count remains unknown. IO methods are trusted seams.

> [!WARNING]
> **Private component acceptance does not clear execution or release gates.**
> There is no operator-facing durable command/provider assembly yet. No live
> matched benchmark, accuracy, token savings, causal benefit, native acceptance
> or publication is established. C08 real export and C09 approved Node22 rehearsal
> remain missing; C10 and broader NX gates stay open.

Next: compose the operator lifecycle and explicit read-only CLI inspection,
then validate/install the reviewed private CLI dependency closure offline.
Do not silently alter accepted C01–C09 contracts or treat synthetic counters as
real model usage. Preserve all unrelated dirty work and publish nothing.
