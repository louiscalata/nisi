# Parallel seven-track engineering triage

Canonical progress remains **30% (3/10 NX milestones)**. This document selects
private, source-checkout work only. It does not authorize model/native execution,
installation, authentication changes, disclosure, publication, or edits to
Claude's separate working copy. Track 2 (`native-incident-source*`) is intentionally
excluded because the root owner holds it.

## Track 1 — live repository workflow

- **Current sources:** `examples/repository-live-model.mjs`,
  `examples/repository-task/reviewed-live-fixture-v1.mjs`,
  `hosts/repository/reviewed-workflow-v1.mjs`,
  `hosts/repository/task-workspace-v1.mjs`, `tests/repository-live-cli.test.mjs`,
  `tests/repository-history-cli.test.mjs`, and
  `tests/repository-incident-cli.test.mjs`.
- **Actual gap:** the private CLI has source-checkout history and incident controls,
  but the roadmap still distinguishes the fixed sanitized repository workflow from
  an approved live-model demonstration. Existing CLI tests stub project imports;
  they do not provide one deterministic, model-free command receipt binding the
  reviewed fixture, settled host result, receipt, and optional-review defaults.
- **Bounded implementation:** add a fixture-only acceptance runner that invokes the
  reviewed repository host with inert reviewed adapters, retains an exact manifest
  and terminal result in an owned temporary root, and proves default invocation
  performs neither history nor incident review. It must refuse source-pin drift and
  never contact a model endpoint.
- **Allowed files:**
  `work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.mjs`,
  `work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.test.mjs`,
  `work-orders/parallel-seven-tracks-v1/track1/README.md` only.
- **Acceptance:** exact source manifest; failing baseline then repaired candidate;
  settled host precedes receipt; stale/wrong-profile/cancelled cases remain adverse;
  no review-summary properties by default; owned fixtures cleaned on success and
  failure. Run only the new test file.
- **Dependencies/authority:** depends on current reviewed fixture and host APIs.
  No new authority for fixture-only implementation; any live model or generated
  candidate execution requires separate action-time authority.

## Track 3 — evaluated prevention

- **Current sources:** `evaluation/paired-trial-v1.mjs`,
  `evaluation/fixtures/paired-example-v1.mjs`, `tests/paired-trial.test.mjs`, and
  the NX-06/EV-01–03 rules in `roadmap.md`.
- **Actual gap:** paired accounting validates synthetic OFF/ON rows, but there is no
  frozen experiment-plan contract binding task inventory, held-out oracle identity,
  arm order, repetitions, exclusions, policy version, and influence-OFF default
  before observations exist. Therefore current metrics cannot establish evaluated
  prevention or promotion eligibility.
- **Bounded implementation:** implement a pure `readPreventionExperimentPlanV1`
  validator/canonicalizer. It accepts declarations only—no trial execution or policy
  promotion—and emits an immutable digest-bound plan with `influenceEnabled:false`
  and `authorizing:false`.
- **Allowed files:** `evaluation/prevention-experiment-plan-v1.mjs`,
  `tests/prevention-experiment-plan.test.mjs`, and
  `tests/fixtures/prevention-experiment-plan-v1.json` only.
- **Acceptance:** exact closed shapes; unique held-out task IDs; disjoint training
  and evaluation digests; fixed arm order/repetitions/exclusions; bounded budgets;
  unknown telemetry is not zero; proposer cannot be acceptance reviewer; mutation,
  accessor, duplicate, overflow, and influence-on mutants fail. No outcome or uplift
  is computed.
- **Dependencies/authority:** depends only on EV-01/02 semantics and existing digest
  helpers. No new authority to implement the plan contract. Running trials, using
  incident data, or enabling policy influence requires separate authorization and
  completed U02-04 evidence.

## Track 4 — scheduler, providers, and macOS host

- **Current sources:**
  `integrations/veritas/tooling/neural/shared-work-slot-scheduler.mjs`,
  `integrations/veritas/tooling/neural/scheduler-queue-responses.mjs`,
  `hosts/repository/reviewed-live-model-v1.mjs`,
  `hosts/repository/reviewed-live-model-v3.mjs`,
  `hosts/repository/live-model-selection-v3.mjs`, and the scheduler/provider tests
  under `integrations/veritas/tooling/tests/`.
- **Actual gap:** scheduler and provider lanes have separate evidence, while NX-07
  requires one owner to reconcile reservation, consent expiry, cancellation,
  interrupted work, and actual drain. Configured slots or a heartbeat are not
  measured capacity, and no macOS UI state should be inferred from them.
- **Bounded implementation:** create a pure injected-lane coordinator contract that
  consumes scheduler state, provider settlement, consent expiry, and host terminal
  state, and returns only `ADMIT`, `REFUSE`, or `DRAIN_UNCONFIRMED`. It must never
  start/reload/probe a provider or claim the macOS app is working.
- **Allowed files:** `hosts/repository/execution-coordinator-v1.mjs`,
  `tests/execution-coordinator.test.mjs`, and
  `tests/fixtures/execution-coordinator-cases.json` only.
- **Acceptance:** foreground ordering cannot bypass consent; expired/revoked consent
  refuses; timeout/cancel with pending transports is unconfirmed; OFF waits for every
  registered owner; stale scheduler snapshots refuse; configured capacity alone
  cannot admit; injected provider errors preserve exact adverse status. Include
  delayed-settlement and cancellation mutants without native/provider calls.
- **Dependencies/authority:** depends on stable scheduler response vocabulary and
  repository lane snapshots. Pure contract work needs no new authority. Wiring it
  to a real provider, process owner, or macOS UI requires separate native/runtime
  authorization and platform-specific acceptance.

## Track 5 — modular extensions

- **Current sources:** retained modular material under
  `integrations/veritas/tooling/neural/`, especially scheduler-owned capacity work;
  NX-08/U02-07 in `roadmap.md` requires versioned plugin/traveler interfaces,
  budgets, consent, reversible activation, and historical identity preservation.
- **Actual gap:** there is no Nisi-owned experimental-module admission registry.
  Existing retained modules cannot be treated as installed, activated, compatible,
  learned, or safe merely because source files exist.
- **Bounded implementation:** add a data-only experimental module manifest and state
  reducer supporting `REGISTERED`, `ACTIVE`, `DISABLED`, and `INCOMPATIBLE`, with
  explicit capability/resource bounds and reversible activation. It must expose no
  dynamic import, executable entrypoint, tool permission, learning influence, or
  installer behavior.
- **Allowed files:** `experimental/module-registry-v1.mjs`,
  `tests/experimental-module-registry.test.mjs`, and
  `tests/fixtures/experimental-module-manifests.json` only.
- **Acceptance:** exact version/capability/budget schema; duplicate or conflicting
  identities refuse; activation requires explicit supplied consent and compatible
  host contract; disable is reversible and preserves history; unknown/incompatible
  modules remain inert; module data cannot expand providers/files/tools or mutate
  policy. Faults for implicit activation, identity rewrite, budget widening, and
  executable fields must be detected.
- **Dependencies/authority:** can be implemented as a pure experimental contract
  without new authority. Loading plugins, running traveler work, migrating stores,
  or enabling learned strengths requires later authority and U02-05/U02-06 gates.

## Track 6 — complete product, installation, and evaluation acceptance

- **Current sources:** `scripts/private-package-contract.mjs`,
  `scripts/check-private-package.mjs`, `tests/private-package-contract.test.mjs`,
  `tests/private-consumer/`, `package.json`, and NX-09/DX-01–06/EV-01–03 in
  `roadmap.md`.
- **Actual gap:** private archive/consumer slices exist, but there is no single
  recomputable readiness ledger proving all required feature gates, exact-tree
  identity, declared exports/types, private-install evidence, matched-evaluation
  status, and supported-platform results. Test totals alone are not product value.
- **Bounded implementation:** build an offline, read-only acceptance-ledger checker
  that consumes explicitly named existing receipt files and emits PASS, FAIL,
  NOT_RUN, ERROR, or INCONCLUSIVE per gate. Missing or stale evidence must remain
  non-PASS. It must not run installers, models, native binaries, or package scripts.
- **Allowed files:**
  `work-orders/parallel-seven-tracks-v1/track6/check-product-readiness.mjs`,
  `work-orders/parallel-seven-tracks-v1/track6/check-product-readiness.test.mjs`,
  and `work-orders/parallel-seven-tracks-v1/track6/readiness-input.example.json` only.
- **Acceptance:** exact receipt path/hash binding; feature inventory completeness;
  source snapshot agreement; separate portable/native/Windows/install/evaluation
  states; stale, malformed, missing, timed-out, skipped, or unknown evidence never
  passes; no aggregate PASS unless every required gate passes. A fixture with the
  current known gaps must remain not ready.
- **Dependencies/authority:** checker implementation needs no new authority.
  Creating fresh installation, native-platform, live-model, Windows, or human-pilot
  evidence requires each lane's separate approval and environment.

## Track 7 — private release readiness

- **Current sources:** `package.json`, `scripts/check-private-package.mjs`,
  `scripts/private-package-contract.mjs`, `roadmap.md` NX-10, and retained private
  package verification under `docs/verification/`.
- **Actual gap:** compatibility, supported-platform, exact-artifact, installation,
  disclosure/legal, and scoped release-authorization gates remain open. Existing
  commits, hashes, archives, CI, or private test success do not authorize release.
- **Bounded implementation:** create an administrative release-readiness manifest
  validator and report generator. It records engineering evidence and explicit
  `NOT_RUN`/`INCONCLUSIVE`/`REQUIRES_AUTHORITY` gates; it cannot mark legal clearance,
  publication authorization, notarization, signing, or registry availability by
  inference.
- **Allowed files:**
  `work-orders/parallel-seven-tracks-v1/track7/release-readiness-schema.json`,
  `work-orders/parallel-seven-tracks-v1/track7/check-release-readiness.mjs`,
  `work-orders/parallel-seven-tracks-v1/track7/check-release-readiness.test.mjs`,
  and `work-orders/parallel-seven-tracks-v1/track7/current-readiness.json` only.
- **Acceptance:** closed schema and exact artifact digest; platform matrix entries
  cannot be omitted; legal/disclosure and release authorization require explicit
  externally supplied records and default to `REQUIRES_AUTHORITY`; private install,
  signing/notarization, and publication are distinct; missing evidence cannot be
  coerced to PASS; output is non-authorizing and performs no network or filesystem
  mutation beyond an explicitly supplied output sink in tests.
- **Dependencies/authority:** administrative validator needs no new authority.
  Legal clearance belongs to Louis/counsel; signing, notarization, installation,
  registry publication, Git push, or public disclosure each requires separate
  action-time authorization. This task must not attempt any of them.

## Collision map and dispatch order

The six proposed file sets do not overlap each other or Track 2. Tracks 1, 3, 5,
6, and 7 are pure fixture/contract work and may start independently. Track 4 may
draft against current injected scheduler/provider snapshots but must not claim
integration until the relevant owner contracts are stable. Track 6 consumes only
completed receipts and should initially report the current product as not ready;
Track 7 consumes Track 6's eventual report but can implement its administrative
schema now. No lane may edit `roadmap.md`, package exports, production sources
outside its allowed files, or another lane's evidence without a new scoped handoff.
