# C06 / C07 — private engineering decisions

Status: owner-approved direction for isolated development, not implementation
acceptance or an OpenCode dispatch release. C06 is now accepted separately:
finish acceptance is 60% (C01–C06); overall NX acceptance remains 30%. C07's
corrected isolated candidate passes54/54 with six discriminating mutants,
actual Nisi syntax/contract checks and final independent source review. It is
privately checkpointed at `7422f0bc6fe176df84673408289443559fed00a9`, but not
integrated or accepted. No native execution is authorized
by this document. Root retains canonical integration ownership.

## Sources and collaboration

Fable's retained `CONTRACT-PROPOSAL.md` files under
`/Users/Shared/SharedChami/Nisi/v0.2/finish-cluster-20260920/drafts/C06/`
and `drafts/C07/` supply the starting designs. The current host journal and
source-plan/executor interfaces, not historical line numbers, are authoritative.
Daybreak's read-only contract review identified the changes below. Fable remains
paused at its recorded usage cap; no new Fable, Jev or OpenCode call is claimed.
These decisions do not turn a reviewer's proposed code into accepted code.

## C06 — real journal observation seam

- Develop `recordHostObservationV1({bundle, settled, now, ttlMs})` beside the
  existing module-private issued-bundle WeakMap in `history/host-journal-bundle.mjs`.
  A shape-only test-local substitute cannot reject a forged bundle and is not
  the production feature. The packet scope must be amended by the owner before
  any executor release; isolated supervised drafting can proceed now.
- Preserve existing exports, journal format, readers, sealing and persistence
  behavior. Use the actual settled inert repository runner as the test source.
  Product project identity comes from the issued bundle's private configuration,
  not a caller-added projectId field.
- Use terminal history states: COMPLETED → SUCCEEDED; CANCELLED/TIMED_OUT →
  CANCELLED; other accepted workflow outcomes → FAILED. Entry identity remains
  `${runId}:${repairAttempts}:repository-host`. No RUNNING/QUEUED observation.
- Snapshot and validate the closed settled-record readset through own data
  descriptors, with Proxy rejection before reflection and null-prototype support.
  Preserve all outcome/identity consistency checks and reject authority flags.
- Mark source authenticity unestablished: `sourceAuthenticityAttested:false`.
  A coherent caller-supplied settled record is historical data, not proof of a
  host execution. No execution, resume, consent restoration or learning promotion.
- Reuse append → serialize → expected-previous-hash store → publish semantics.
  Storage failure must restore the last-good in-memory journal, including
  `bundle.journal`, not leave an unpersisted append behind.
- Exercise both existing inspected fresh-process readers and a simulated
  truncated-main/leftover-temp case. No SIGKILL, live model, native Swift,
  credential or service operation is required for this offline test scope.

Historical disjoint draft owner: Daybreak, exclusively under
`.packet-diagnostics/c06-owner-draft-20260920/`. Root completed inspection,
tests, independent review, scope amendment and integration; the accepted C06
checkpoint is `b37c40d8a641b27ad3756d660254ac6f9f4c830c`.

## C07 — readiness and evidence binding, not execution permission

- A separate proposed module, `hosts/repository/native-incident-admission-v1.mjs`,
  is needed. Tests and README changes alone cannot implement the missing seam.
  Existing source-plan issuance stays unchanged. No C07 implementation is
  accepted or dispatched by this note.
- Preserve an exact issued source-plan identity; bind the minimal grant to that
  plan and original run/attempt, executable identity and explicit time window.
  Keep copied host-state checks without inventing scheduler/capacity approval.
- Use a single-use in-memory issued handle. After basic input/time checks,
  consume it before inspecting fresh evidence, so malformed/adverse evidence
  cannot be retried into success. The handle remains non-authorizing.
- Compare complete normalized outcome identities and statuses, not just status
  values. ERROR, INCONCLUSIVE and INTERRUPTED are retained adverse evidence;
  neither an automatic retry nor a forced MATCHED result is permitted.
- Keep raw content and paths out of the public result. No journal/incident-store
  write, retention change or learning promotion is part of this seam.

> [!WARNING]
> Reject the draft rule `synthetic = rawObservation === null` and any automatic
> `nativeRerun: OBSERVED` derived from caller-supplied result fields.
> **Why:** real pre-launch failures can have no raw observation, while fabricated
> input can contain one. Field presence does not establish execution provenance.

For caller-supplied fixture evidence, require
`freshEvidenceOrigin: CALLER_SUPPLIED`, `nativeRerun: NOT_RUN` and
`nativeExecutionAttested:false`. A future actual execution-owner binding and
separately approved operator-exclusive native session are still required to
establish real rerun evidence. This retains the full v0.2 native requirement;
it does not replace it with synthetic tests or close NX-05.

## Next acceptance steps

- [x] Finish and accept C05's exact source/control integration.
- [x] Inspect and test the C06 isolated production seam and all Fable oracle cases.
- [x] Independently review C06 persistence/rollback and issued-identity behavior.
- [x] Freeze and verify C07's isolated normalized outcome/readset grammar,
  including receipt/raw-report reconciliation and canonical alias digests.
- [x] Amend the C06 packet's production-file scope and accept its Node-only work.
- [ ] Amend C07 packet scope and add acceptance controls with explicit C06
  dependency supersession; preserve historical evidence and rerun compatibility.
- [ ] Obtain fresh native session authority and execution evidence when C07's
  real native lane is ready; never infer it from passing offline tests.

No publication, credentials, machine configuration or v1 design changed.
