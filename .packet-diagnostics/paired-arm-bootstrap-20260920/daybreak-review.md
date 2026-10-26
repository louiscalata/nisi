# Daybreak independent review — reviewed paired-arm bootstrap v0.2

Date: 2026-09-20  
Scope: read-only review of `hosts/repository/reviewed-paired-arm-bootstrap-v1.mjs` and its existing contracts. This note does not authorize live providers, native build execution, publication, cleanup, resume, or a shell execution command.

## Acceptance position

The bootstrap boundary is legitimate for v0.2 if it continues to preserve these facts:

- The caller's `approval`, `now`, and `observe` callbacks remain explicitly trusted inputs. The bootstrap does not authenticate them and does not invent scheduler, capacity, consent, custody, or provider evidence.
- Production `reserve(intent)` constructs a fresh fixed-fixture reviewed host, V4 lane, and registered oracle for that exact issued intent.
- The command owner remains the signal, cancellation, durable-retention, and cross-ledger-inspection owner.
- Synthetic/injected transports intentionally project `modelCalls: null` and token usage `null`. The real runner therefore stops after the first arm with `RUNNER_REPORTED_BUDGET_UNCONFIRMED`. This is truthful acceptance and must not be weakened to manufacture four completed arms.
- The fixed reviewed fixture supports one task identity. No acceptance test should introduce distinct task hashes merely to exercise schedule ordering.

## Concrete blockers and required repairs

### 1. Expected schedule must match the runner

Current source builds `schedule` task-major at lines 95–96, while the runner's canonical order is repetition-major, then task, then arm. Root has already identified this repair. Implement the runner's exact ordering even though the accepted fixed-fixture population currently has one task and will not expose the difference dynamically.

Do not add fake distinct tasks. A source-level assertion or a pure schedule helper test may establish equivalence. If a test needs more than one task solely to distinguish loop order, it may reuse the same fixed task/baseline/oracle hashes with distinct case IDs only if the plan contract already permits that; it must not be described as multi-task production acceptance.

### 2. Every dependency remains synchronous

The dependency boundary must reject native Promises from `checkBuild`, `createHost`, `createOracle`, and `createLane` immediately, attach a rejection observer, and stop before calling the next factory. Required properties:

- A resolved Promise is still refused; asynchronous completion cannot become an owner.
- A rejected Promise is observed so it cannot become an unhandled rejection.
- `checkBuild` must return exactly `undefined` synchronously.
- Host/oracle/lane factory results must be non-null objects before the next factory is invoked.
- A Promise or malformed host means oracle and lane factories are not called.
- A Promise or malformed oracle means lane is not called.
- No asynchronous dependency result is entered into `lanes` or returned to the controller.

Use one fixed refusal code such as `ARM_BOOTSTRAP_ASYNC_DEPENDENCY`; do not include dependency exception text in reports.

### 3. V4 partial-allocation rollback must be local to V4

The bootstrap can revoke a lane only after `createLane` returns it. V4 currently creates author and reviewer transport owners internally. If construction throws after the first owner is allocated, the bootstrap has no handle.

Minimum acceptable repair: V4 constructor-local rollback tracks each created transport owner and calls its existing stop operation exactly once on any later constructor failure. The original fixed error remains the outward error; rollback failure must be bounded and must not cause a retry. A test seam should fail construction immediately after the first owner and prove that owner's terminal/stop path is invoked once and no request is sent.

This is the only complete place to solve that leak. Bootstrap `finally` cannot repair an owner it never received.

### 4. Cleanup accounting must be explicit

The bootstrap report should distinguish:

- `lanesCreated`
- `lanesCleanupConfirmed`
- `lanesCleanupUnconfirmed`
- zero-lane cleanup (`NOT_REQUIRED` or equivalent) versus actual confirmed revocation

`recorded` may be true only when the command report is recorded, no bootstrap reason exists, and every created lane has confirmed terminal cleanup. Cleanup failure must never alter the retained ledgers, synthesize another FINAL, retry an owner, delete session data, or claim remote execution stopped.

An already revoked and terminal lane counts as confirmed without a second revoke. A created but unreadable, busy, draining, pending-transport, or recovery-required lane counts unconfirmed.

### 5. Parent roots and retained filesystem state

The current layout is suitable for the declared operator-exclusive, non-hostile-writer boundary:

- The explicit private state root is resolved during preflight and rechecked before session creation and reservation.
- The session uses `mkdtempSync` beneath that root.
- Each reservation uses separate ordinal `workspace-N` and `oracle-N` roots.
- No request ID, model ID, endpoint, or candidate data enters a pathname.

Acceptance must verify:

- Host receives only its exact `workspace-N` root.
- Oracle receives only its exact, distinct `oracle-N` root.
- Neither root is reused across reservations.
- Both roots are beneath the actual session directory.
- A root or owner-construction failure preserves the session and any already created directories; there is no deletion or second allocation attempt for that request.
- Directory modes are private under the tested POSIX lane. No hostile-writer or symlink-race isolation is claimed.

The session directory itself and partial roots are evidence/state retained for operator inspection, not garbage to clean automatically.

### 6. Consumed reservation semantics

The request must be consumed before the first fallible state-root recheck, directory allocation, or owner construction. On any later failure:

- `cursor` does not roll back.
- The request ID remains in the consumed set.
- A second call for the same request refuses before filesystem or factory effects.
- No replacement host, oracle, or lane is created.
- The bootstrap reason becomes sticky.

This matches the controller's one-shot owner and no-retry contract.

### 7. Captured inputs and mutable dependencies

The production build is an original, deeply frozen, process-issued object, so passing its original identity into the host is correct. Do not clone it: a clone would lose issuance. Continue checking that its external state-root path, device, and inode match the selected root.

Capture once at bootstrap construction:

- plan and profile data
- approval data
- role selection
- budgets
- exact OFF/ON treatment identities
- dependency functions and signal source

Post-construction caller mutation must not change later reservations. Original issued oracle/treatment/build identities must remain original identities, not serialized reconstructions.

## Detailed acceptance cases

### A. Pure construction and preflight

1. **Valid preflight is effect-bounded.** Constructor returns READY with zero reservation attempts, zero lanes created, no session directory, no signal listeners, no host/oracle/lane factory calls, and no provider request.
2. **Schema/accessor/proxy refusal.** Extra/missing keys, accessors, proxies, malformed budgets, invalid callback types, or asynchronous dependencies refuse before state allocation or factories.
3. **Issued-identity refusal.** Copied oracle registration, copied OFF/ON treatment, unissued build, wrong build root identity, or swapped treatment arms refuse during preflight.
4. **Environment binding.** Profile toolchain/resource digests must equal the fixed issued build and exact captured budgets. Mutation after construction does not change them.
5. **Model/policy binding.** Both planned OFF and ON descriptions bind to the same profile model/settings and trial policy. OFF remains policy mode OFF at the scheduled-intent layer; ON remains isolated treatment.
6. **Fixed population.** Every plan row uses the one reviewed fixture's task/baseline hashes and the issued oracle hash. Distinct arbitrary task hashes refuse; this is not a general task bootstrap.

### B. Truthful first-arm integration matrix

For each API combination accepted by the closed selection contract and for both possible first arms:

1. Run through the real bootstrap, command owner, durable owner, controller, injected issued V4 lane, reviewed host seam, and registered oracle seam without live provider/native execution.
2. Confirm exactly one reservation and one executor start for the first scheduled arm.
3. Confirm no second-arm reservation after the first executor projection reports synthetic `modelCalls: null` / tokens `null`.
4. Confirm runner stop reason is exactly `RUNNER_REPORTED_BUDGET_UNCONFIRMED`, not success, user cancellation, or provider failure.
5. Confirm the durable main and sidecar ledgers close and cross-link according to the existing adverse-final contract.
6. Confirm bootstrap cleanup closes the one created lane and reports counts accurately.
7. Confirm result flags remain non-authorizing, non-resumable, unmeasured, non-causal, non-promotable, with actual dispatch count and remote stop unknown.

This matrix proves the actual current production accounting path. It does not prove four-arm completion or provider use.

### C. Separate four-owner freshness acceptance

Use a construction-only test, separate from trial-result accounting:

1. Capture the four original issued scheduled intents for the one fixed task and two repetitions from a runner's retained SCHEDULE event, stopping before executor dispatch.
2. Feed those exact intent identities to the internal reservation/owner-set assembler in canonical order under an inert RUNNING session.
3. Use synchronous inert issued factories. If `checkRepositoryTrialIntentV2` is exercised, lanes must be genuine issued injected-transport V4 lanes; do not replace issuance readers with plain objects.
4. Assert four distinct top-level hosts, four distinct lanes, four distinct oracles, eight distinct model transport owners, and distinct host static/test children where identity readers expose them.
5. Assert exact arm sequence and exact original treatment identity for each lane.
6. Assert `workspace-0..3` and `oracle-0..3` are distinct, correctly paired to the ordinal, and all remain under the one session.
7. Assert duplicate, stale-runner, wrong-order, unknown-request, and post-failure reservations refuse before another factory or directory effect.
8. Close the construction-only session and prove all four lanes are revoked/terminal once, with cleanup counts `4/4/0`.
9. Emit no executor/oracle result, token count, model-call count, effectiveness result, or provider-delivery claim from this test.

This is owner-freshness evidence only.

### D. Failure and cleanup matrix

For each boundary below, assert sticky failure, no retry, retained partial roots, bounded error reporting, and correct cleanup counts:

1. state-root recheck failure before roots
2. workspace directory creation failure
3. oracle directory creation failure after workspace root
4. host factory throw / resolved Promise / rejected Promise / malformed return
5. oracle factory throw / resolved Promise / rejected Promise / malformed return
6. lane factory throw before return
7. V4 internal failure after first transport allocation, with constructor-local rollback
8. lane returned, then scheduled-intent binding check fails; lane is registered first and revoked in final cleanup
9. controller refuses after reserve because caller observation changed; unused lane is revoked, no next reservation
10. lane revoke throws, remains draining, retains pending transport, or reports recovery required; cleanup unconfirmed and bootstrap `recorded` false
11. command storage or inspection failure; lane cleanup still runs exactly once and cannot upgrade the command report
12. setup stop before command assignment and SIGINT/SIGTERM during execution; existing command cancellation owns stop, bootstrap cleanup remains serialized afterward

### E. Retention and report invariants

1. `inspect()` before run is immutable and contains no paths, endpoints, model IDs, request IDs, owner identities, approval capability, raw observations, candidates, or exception messages.
2. `inspect()` after run is the stable final object.
3. `reservationAttempts` counts consumed reservation attempts, not successful owner creation.
4. `lanesCreated` counts only returned lanes registered for cleanup.
5. Cleanup counters sum consistently and never exceed `lanesCreated`.
6. A recorded command plus unconfirmed bootstrap cleanup is not a recorded bootstrap.
7. A recorded bootstrap still does not mean task success, provider execution, measurement validity, causal effect, promotion eligibility, remote stop, or public-release authority.
8. Session and evidence directories remain on success and failure. No automatic deletion, resume, or writable recovery is added.

## Non-blocking observations

- The production issued build is already deeply frozen before WeakSet issuance; mutable-build aliasing is not a current production defect.
- Fresh ordinal child roots are adequate only under the documented operator-exclusive static-local boundary. The bootstrap must not claim hostile-writer or mount-race isolation.
- Host and oracle owners have no general NEW-state close API. Under current constructors they should not dispatch before start. Do not invent cleanup calls; if future constructors allocate resources at NEW, add explicit owner cleanup APIs at those kernels.
- A zero-lane setup failure can truthfully report cleanup not required, but should not be worded as though one or more lanes were positively closed.

## Scoped disposition

Acceptance is blocked until schedule ordering, synchronous dependency refusal/observation, V4 constructor-local partial rollback, and explicit cleanup counts are integrated and tested. Once those repairs pass the pure/inert cases above, the bootstrap can be accepted as a private fixed-fixture owner-assembly feature with truthful first-arm budget-stop behavior. Live-provider/native-build acceptance remains separate and NOT RUN in this review.

---

## Addendum — exact canonical re-review after root repairs

### Remaining actionable findings

#### P1 — V4 constructor rollback failure is silently discarded

`hosts/repository/reviewed-live-model-v4.mjs:89-107` attempts to stop every transport owner allocated before a constructor error, but every `owner.stop()` exception is swallowed and the original construction error is rethrown. No lane handle is returned, so neither bootstrap cleanup nor any caller can recover or inspect that hidden owner. The bootstrap can consequently report `lanesCreated: 0` and cleanup confirmed even when the allocated transport owner failed to stop.

Direct fix: attempt every allocated stop once, track stop/status uncertainty, and throw a fixed `LIVE_LANE_CONSTRUCTOR_ROLLBACK_UNCONFIRMED` if any rollback is not confirmed. Preserve the original error only as bounded prior context if supported; never leak private text. Bootstrap must map this to sticky failure and cleanup unconfirmed even though the owner never entered `lanesCreated`.

Required test: fail reviewer-adapter construction after the author transport owner exists, then make author stop throw or remain nonterminal. Assert fixed rollback-unconfirmed status, no request, no retry, bootstrap `recorded: false`, and cleanup not confirmed. A companion case should prove successful rollback stops the allocated owner exactly once and preserves a bounded construction refusal.

#### P2 — asynchronous factories can create late unreachable owners while cleanup reports confirmed

Bootstrap `synchronous()` at lines 30–36 observes both Promise branches and refuses to use the late value. That prevents unhandled rejection and later-factory progression. But a resolving `createHost`, `createOracle`, or `createLane` Promise may later produce a real owner after finalization. Its value is intentionally discarded, the registry stays empty, and `closeLanes()` reports confirmed.

Production constructors are synchronous, so the fixed production path remains sound. The injected dependency cleanup claim is too strong. Mark an `asyncFactoryUnconfirmed` flag for owner-producing factory kinds before discarding the Promise. Final cleanup must be `UNCONFIRMED` (or a separate bounded async-factory-uncertain status) even with zero registered lanes. Continue ignoring the fulfilled value: do not adopt, inspect, revoke, retry, or upgrade it. Extend resolved/rejected Promise tests to assert no later factory and cleanup uncertainty for owner-producing factories.

#### P2 evidence gap — stale root after session creation

The state root is correctly rechecked before session creation (`:169`) and every reservation (`:121`). Add an inert boundary test that makes the reservation-time recheck fail after the session exists but before `workspace-0`. Assert no owner factory, a consumed/no-retry request, retained empty session, one reservation attempt, zero lanes, bounded reason, and false `recorded`. This validates current behavior without claiming hostile-writer isolation.

### Confirmed repaired areas

- Expected ordering now matches the runner: repetition, task, arm (`reviewed-paired-arm-bootstrap-v1.mjs:108-109`). The accepted population remains one fixed task.
- Signal methods are captured/bound once (`:76-79`). Setup from `run()` entry through command listener installation contains no `await`, so ordinary Node OS-signal callbacks cannot interleave before command handlers exist. The command remains the sole signal lifecycle owner; no second signal owner is required.
- Setup-stop replay is serialized immediately after `command.run()` returns its original Promise (`:159-175`).
- Issued host identity is checked before oracle creation; issued oracle identity is checked before lane creation (`:124-130`).
- The returned lane is registered before the final fallible intent check (`:130-134`), so downstream admission refusal leaves an owned lane for final cleanup.
- Returned-lane cleanup counts are explicit (`:138-155`). Already revoked terminal lanes count closed without redispatch.
- Root rechecks and ordinal `workspace-N` / `oracle-N` children preserve the operator-exclusive static-local boundary. No request/model/candidate value enters paths.
- Plan, profile, approval, selection, budgets, dependency functions, signal methods, and the environment description are captured. Original issued build/oracle/treatment identities remain original identities.
- Environment digest is recomputed before session creation (`:169-171`).
- Pure V4 preflight shares actual preparation/configuration logic and allocates no transport owner (`reviewed-live-model-v4.mjs:27-59`; `paired-trial-projection-v2.mjs:15-37`).
- Synthetic accounting remains truthful: tokens/model calls stay null and integration stops after the first arm with `RUNNER_REPORTED_BUDGET_UNCONFIRMED`.

### Additional focused acceptance cases

1. Emit a fake signal after lane return but before post-reservation admission. Exactly one stop request, zero model requests, unused lane closed, unrelated listeners preserved.
2. During final lane cleanup, do not reinstall/forward signals, mutate ledgers, or claim remote stop; cleanup failure remains bootstrap-only uncertainty.
3. After bootstrap construction mutate caller selection, budgets, approval, treatment container, dependency methods, and signal-source methods. Reservations must use captured values/functions and original issued identities.
4. Return previously used issued host/oracle/lane identities. Refuse before dispatch; any newly registered lane is cleaned once; no later factory after an earlier detectable alias.
5. Always assert `lanesClosed + lanesCleanupUnconfirmed === lanesCreated`. Track hidden V4 rollback and async-owner uncertainty separately because those owners never entered `lanesCreated`.
6. Resolve factory Promises after the final report. Report never upgrades; late value is unused; owner-producing async factory cleanup remains explicitly unconfirmed.
7. In a construction-only lane, fail root recheck before a later reservation: no new roots/owners, prior lanes still cleaned, no retry. Do not change production budget accounting to reach this boundary.

### Exact hashes reviewed

```text
dc2c525ec22645ec61836c613d396fa1ec1024892cef72cb470320bb415e6c2a  hosts/repository/reviewed-paired-arm-bootstrap-v1.mjs
c062ed8c639892c623c87c780be6f6b9df6767c6d9c2b1dcbb59c811209f7026  hosts/repository/paired-trial-projection-v2.mjs
31eab784dfc77c97920add4e57ce3d58c00ad77469cb8664752291d1c3a243a1  hosts/repository/reviewed-live-model-v4.mjs
c2faaf7d0f37d5a566194cbe474fca62ee8db4088198ef8998e3cb2b09f596f2  tests/helpers/paired-arm-bootstrap-fixture.mjs
560d94d82016611dfbdfa1894f88cf6a6d5d3e92a2fca697ef565fc595a2f883  tests/reviewed-paired-arm-bootstrap-v1.test.mjs
```

### Addendum disposition

The canonical repair closes the earlier ordering, predictable allocation, ordinary unused-lane cleanup, snapshot, and synchronous setup concerns. Acceptance remains blocked on truthful handling of V4 constructor rollback failure and late asynchronous owner-factory uncertainty. The stale-root-after-session test is required evidence for the existing recheck, not a broader filesystem feature request.

---

## Final addendum — rollback and construction harness re-review

### Remaining P2

`reviewed-paired-arm-bootstrap-v1.mjs:133-139` conservatively marks cleanup uncertainty when a host/oracle/lane factory throws or returns a Promise. However, a factory may synchronously return a non-null but unissued host or oracle object. `construct()` then succeeds, the subsequent issued-identity reader throws, and `constructionCleanupUnconfirmed` remains false. The returned object is not retained in a cleanup registry and may represent a resource-bearing capability from the trusted injected seam. Final cleanup can therefore report `CONFIRMED` with zero lanes even though the returned host/oracle was rejected and is unreachable.

Direct fix: wrap both factory return and immediate issued-identity validation in the same conservative construction boundary, or catch `readIssuedRepositoryWorkflowIdentityV1(host)` / `readIssuedRepositoryTrialOracleV1(oracle)` failure and set `constructionCleanupUnconfirmed=true` before rethrow. No invented host/oracle close call is required; uncertainty is the truthful result. Extend the existing `unissued createHost/createOracle` tests to assert `constructionCleanupUnconfirmed:true`, cleanup `UNCONFIRMED`, and `recorded:false`.

This is P2 rather than P1 because production constructors return original issued owners; it affects the trusted injected seam and report truthfulness, not the fixed production path.

### Final source assessment

No additional P1 was found.

- V4 constructor rollback now attempts every allocated owner, reads terminal status, and emits `LIVE_CONSTRUCTOR_ROLLBACK_UNCONFIRMED` on throw/nonterminal state (`reviewed-live-model-v4.mjs:89-116`). The isolated child harness faults real canonical owner/adapter allocation sites, proves zero transport calls, distinguishes confirmed rollback from stop-throw/no-op uncertainty, and does not claim provider/native acceptance.
- Bootstrap now treats every throwing or asynchronous owner factory as construction cleanup uncertainty and never consumes late Promise values (`reviewed-paired-arm-bootstrap-v1.mjs:112-120,147-165`).
- Root replacement after session creation is tested without deleting the original retained session, and refuses before owner factories.
- The construction-only child obtains original issued intents from the actual runner, stops that runner at SCHEDULE before dispatch, replaces only the command composition inside the isolated child, constructs four sets, checks 28 unique identities and eight distinct roots, closes all lanes, and explicitly reports zero execution/model requests and non-acceptance. Its semantics support freshness only, as claimed.
- Signal tests cover setup stop and in-flight stop without broadening remote-stop or cleanup claims.
- Snapshot mutation tests confirm captured plan/selection/budgets/factory methods; production issued build/oracle/treatment identities remain original identities.
- Preflight tests compare prospective descriptors with fresh original issued lanes and revoke/join those lanes in `finally`.

### Exact hashes reviewed in final pass

```text
f80266e92d76193ae192c91c9d198440850cc29e7016db874725a63303094778  hosts/repository/reviewed-paired-arm-bootstrap-v1.mjs
c062ed8c639892c623c87c780be6f6b9df6767c6d9c2b1dcbb59c811209f7026  hosts/repository/paired-trial-projection-v2.mjs
0e02eedd8ab34a3e10ee61c8294542a8c18d15ebae09a0fa79e170dea18f511d  hosts/repository/reviewed-live-model-v4.mjs
ff89ba12db37f86e5066b83f112f5fc6718b68a52a5d9b620f6b926399e21c14  tests/helpers/paired-arm-bootstrap-construction-child.mjs
ac60621447957494734639db8b5e7273828ef6dcf4297c394fed3e8c515baa18  tests/helpers/paired-arm-bootstrap-constructor-child.mjs
c2faaf7d0f37d5a566194cbe474fca62ee8db4088198ef8998e3cb2b09f596f2  tests/helpers/paired-arm-bootstrap-fixture.mjs
697af8057a7798a1879fd1fc15d1b8bcb54b07f08efb08752836131ba95a5403  tests/paired-arm-bootstrap-constructor-fault.test.mjs
f2b3615e2a108713d774514c94ef4c652c8cc7c370e3d4a8771fd60e06f31508  tests/paired-arm-bootstrap-preflight.test.mjs
660aabcd49a4b63661ad4fa7463cfddc7f4b5bef669a8a9626fd0e495661886d  tests/reviewed-paired-arm-bootstrap-v1.test.mjs
```

Native build, provider operation, authentication, and live-model acceptance remain NOT RUN and are not implied by these harnesses.

---

## Final scoped verdict after issued-validation repair

Scoped PASS. No remaining P1 or P2 was found in the reviewed fixed-fixture bootstrap, prospective projection, V4 constructor rollback, or bootstrap harnesses.

The final repair places the synchronous factory call and immediate issued-identity validator inside the same conservative `construct()` boundary (`reviewed-paired-arm-bootstrap-v1.mjs:114-120`). Host and oracle construction now pass their exact original issued readers into that boundary (`:133-136`). Therefore a throw, native Promise, malformed return, copied/unissued owner, or validator failure all set `constructionCleanupUnconfirmed` before the reservation fails. Final cleanup becomes unconfirmed and bootstrap `recorded` cannot become true (`:145-165`).

The two adverse tests now explicitly prove this for unissued host and oracle returns: later factories stop, no model request occurs, `constructionCleanupUnconfirmed` is true, cleanup is `UNCONFIRMED`, and the result is not recorded (`tests/reviewed-paired-arm-bootstrap-v1.test.mjs:79-85`).

This closes the last prior P2 without adding a fabricated close method or adopting late asynchronous values.

### Final exact hashes

```text
e8d52c134a53f53dab756adef35a0c8da7b456055c25893abc7c5989be7b0008  hosts/repository/reviewed-paired-arm-bootstrap-v1.mjs
c062ed8c639892c623c87c780be6f6b9df6767c6d9c2b1dcbb59c811209f7026  hosts/repository/paired-trial-projection-v2.mjs
0e02eedd8ab34a3e10ee61c8294542a8c18d15ebae09a0fa79e170dea18f511d  hosts/repository/reviewed-live-model-v4.mjs
ff89ba12db37f86e5066b83f112f5fc6718b68a52a5d9b620f6b926399e21c14  tests/helpers/paired-arm-bootstrap-construction-child.mjs
ac60621447957494734639db8b5e7273828ef6dcf4297c394fed3e8c515baa18  tests/helpers/paired-arm-bootstrap-constructor-child.mjs
c2faaf7d0f37d5a566194cbe474fca62ee8db4088198ef8998e3cb2b09f596f2  tests/helpers/paired-arm-bootstrap-fixture.mjs
697af8057a7798a1879fd1fc15d1b8bcb54b07f08efb08752836131ba95a5403  tests/paired-arm-bootstrap-constructor-fault.test.mjs
f2b3615e2a108713d774514c94ef4c652c8cc7c370e3d4a8771fd60e06f31508  tests/paired-arm-bootstrap-preflight.test.mjs
44064d5f02e05abef98e11436a5d507046112c81fa3b919d95e6f95ea75ecf99  tests/reviewed-paired-arm-bootstrap-v1.test.mjs
```

This verdict is limited to source correctness and the stated private fixed-fixture/inert harness contract. It does not convert the concurrently running 573-test/Nisi run into PASS, and it does not claim native build, provider delivery, authentication, model execution, measurement validity, causal effect, promotion eligibility, publication, or remote-stop evidence. Those remain separate evidence gates.
