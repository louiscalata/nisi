# Selected failure-observation storage

**Private Nisi v0.2 — overall roadmap: 30% (3/10 NX milestones).**
This work order contributes to NX-05; it does not close that milestone.

## Outcome and acceptance

- [x] Implement source-bound, explicitly declared selection of one failure row.
- [x] Connect create/capture/revoke methods to the actual repository owner.
- [x] Add fresh disk queries with revocation, expiry, pruning and closed metadata validation.
- [x] Complete Opus source review and 32 focused checks.
- [x] Complete full portable checks, semantic fault variants and final source pins.
- [x] Complete separately source-bound real-disk/fresh-process proof.
- [x] Update the canonical roadmap and human-readable system equation with final evidence.

Final [source acceptance](../../.build/repository-incident-capture-verification-IC2zRR/verification.json):
1567/1567 portable checks,32/32 focused and relocated controls,267 selected pins
unchanged.258 of the prior260 pins remain exact; only the intended projector and
host extensions changed. Seven fault variants trigger1,1,1,2,8,1,1 assertions,
with zero runtime-only failures/skips/cancellations/todos.
Separate [disk proof](../../.build/repository-incident-capture-v1-75xHwM/verification.json)
rechecks all267 source pins, writes one synthetic observation on the real local
filesystem and reopens it in a fresh child with exact IDs/fingerprints/digests.

## What changed

`history/repository-incident-capture-v1.mjs` provides explicit selected-observation
admission and read-only fresh queries. The existing projector gains a private
issuance registry without changing its preview schema or hashes. The real host
adds `createIncidentPermit`, `captureIncident` and `revokeIncidentPermit` while
preserving the existing history and run interfaces. Journal/native formats,
package exports/allowlist and CLI storage controls are unchanged.

The caller must declare the task, selected row and content/preview digests,
time window, retention and metadata-only destination. A frozen runtime handle
belongs to one access instance. Initial/final clock checks, a callback busy guard,
revocation and one admitted attempt per row are enforced. Re-entry cannot refund
an attempt. A post-admission failure is not permission to retry.

Queries reopen the actual journal every time. They return one of available,
revoked, expired, not-retained, missing or refused. No query writes, sweeps or
authorizes later use. Retained rows have exact field/code allowlists and checked
identity/content hashes. A structurally valid journal is not proof of execution.

> [!WARNING]
> **Stored does not mean approved for learning.** These are unauthenticated
> observations; causal diagnosis, independent recurrence, native incident
> eligibility and policy promotion still require their own evidence and gates.

> [!CAUTION]
> **A storage outcome is not a universal durability guarantee.** Exact replay
> can use a cached journal snapshot. A previously empty owner encountering exact
> matching disk bytes can report RECORDED/STORED over store UNCHANGED with
> durable:false. Preserve that actual result. Disk comparisons around rename are
> optimistic checks, not an atomic cross-process lock. Use one task-owned writer.

> [!CAUTION]
> **Expiry and revocation limit availability, not disclosure already made.**
> Caller clocks/declarations are not authenticated identity, hashes are linkable,
> and explicit pruning is not automatic secure deletion or a background sweeper.

## Review adjudication

Opus coauthored the earlier design review and reviewed the full selected module,
projector and host source. The source review returned PASS with no findings.
Its earlier design suggestions were assessed against the existing journal:

- Entry identity excludes row content/declaration/time so changed content under
  the same row ID conflicts. Exact envelope replay remains a duplicate. Changing
  legacy journal deduplication semantics to ignore declarations was not adopted.
- Revocation during a clock callback can stop admission; after entry into the
  record dependency it cannot undo the operation or mask its actual result.
- Observations may predate a permit; both time windows are checked. Clock
  monotonicity takes precedence over not-yet-valid/expiry classifications.
- Revocation entries and explicit retention maintenance already exist. Generic
  consumers were inspected; no relevant FAILED-record aggregator required a
  changed run ID. The versioned stage still distinguishes these observations.
- Stored metadata is validated structurally. The in-memory issuance registry is
  never claimed to authenticate data after a process restart.

Claude design and source-review calls together report USD 0.5078615, including
auxiliary Haiku usage. This is not all-model cost, token savings or product speed.
Held Fable/OpenCode/Windows review routes were not blindly retried.

## Retained adverse evidence and corrections

- Initial focused receipt `1nnIVv`: 21/23. A byte-identical second NEW-owner write
  was incorrectly expected to conflict; a query at its exact expiry was
  incorrectly expected to be available. Corrected the fixtures, not validation.
- Focused receipt `iUO8wT`: 31/32. Moving backward from an already valid permit
  correctly reports INVALID_CLOCK before NOT_YET_VALID. The revised oracle also
  checks invalid creation time separately and uses a longer permit window for
  the retention-expiry case.
- Root boundary draft `incident-boundaries-initial-4SaoCt`: 6/7. A test clock
  forgot to return its value. Corrected the callback and asserted permit creation.
- Full verifier `repository-incident-capture-verification-GSQhsi`: canonical
  focused32/32, but relocated controls used a stale relative dynamic import and
  derived the wrong repository root. Corrected relocation only; no product or
  mutation result was claimed in that adverse run.
- The earlier `repository-incident-capture-v1-E4KcSH` disk exercise used unrelated
  Windows-file pins. It is retained as limited storage execution, not source
  acceptance for this feature. The proof now requires this work order's selected
  implementation paths, hashes them before/after, compares exact child-process
  identities/digests and cleans owned fixture resources on failure as well.

Daybreak owns the independent capture oracle and acceptance-runner draft. Luna
owns query tests and the real-disk proof draft. Codex implements/integrates,
adjudicates/corrects test assumptions and adds seven boundary checks. No native
launch, live model task, automatic learning, commit, push or publication is implied.

## Next integration boundary

Carry these explicit selected-observation controls into a reviewed operator
interface and additive source-checkout types. A native bridge must reconstruct
and rerun native evidence before native ledger admission; it must not cast Node
observations into the old native input format. Then connect independently
evaluated prevention. Full native hosting, crash/concurrent-writer qualification,
the broader Veritas merger and release remain open in the canonical roadmap.
