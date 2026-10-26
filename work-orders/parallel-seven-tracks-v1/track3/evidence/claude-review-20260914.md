# Track 3 review — `evaluation/prevention-experiment-plan-v1.mjs`

**Verdict: REJECT** — two contract findings each let a plan that the acceptance text says must be refused be emitted as `status:'DECLARED'` with a valid `planSha256` (#1 oversized/non-counterbalanced inventory via a length-lying Proxy; #2 held-out oracle/baseline digest present in `trainingDigests`). Both are one-line fixes; the author's 9 tests still pass on a patched scratch copy. Everything else probed holds. Re-confirmed 2026-09-14 with `scratchpad/t3/synth-confirm.mjs` (node v24.18.0) against the real module by absolute path; repo untouched.

## Findings

### 1. `list()` re-reads `value.length` four times, so a Proxy get-trap defeats every inventory bound and the armOrder/repetitions invariant
- **Clause broken:** "fixed arm order/repetitions/exclusions"; "bounded" inventory / "overflow ... mutants fail". The emitted plan violates the module's own `list(task.armOrder, repetitions, repetitions)` and `tasks <= 256` invariants while carrying a valid hash.
- **Repro** (`scratchpad/t3/synth-confirm.mjs`, also `probe-proxy.mjs` A2-A4b):
  ```js
  const real = Array.from({length:300},(_,i)=>({caseId:'case.'+i,taskSha256:(i+1000).toString(16).padStart(64,'0'),baselineSha256:d('d'),oracleSha256:d('e'),armOrder:['OFF_ON','ON_OFF']}));
  let n=0; v.tasks = new Proxy(real,{get(t,k,r){ if(k==='length'){n++; return n<=2?200:t.length;} return Reflect.get(t,k,r);} }); read(v);
  v2.tasks[0].armOrder = new Proxy(['OFF_ON','ON_OFF','ON_OFF','ON_OFF'], /* same trap, 2 then 4 */); read(v2); // repetitions: 2
  ```
  Observed: `REFUSED 300 tasks plain PLAN_LIST` but `ACCEPTED 300 tasks Proxy length DECLARED 9be177d754d5 tasks 300` and `ACCEPTED armOrder 4 Proxy reps=2 DECLARED c02e62f6b0f8 armOrder 4` (counterbalance passes because only `OFF_ON` is counted: 1*2===2). Same trap accepts 100 exclusions and 400 trainingDigests.
- **Fix:** in `list()` snapshot once — `const length = Object.getOwnPropertyDescriptor(value,'length')?.value; if (!Number.isSafeInteger(length) || length < min || length > max) fail('PLAN_LIST');` and use `length` for the key-count check and the loop; additionally `if (types.isProxy(value)) fail('PLAN_RECORD'/'PLAN_LIST')` at the top of `record()`/`list()` (`import { types } from 'node:util'`). Verified on `t3/patched.mjs`: all four cases become `PLAN_LIST`, author's suite 9/9.
- **Oracle test:** `list bounds hold against a length-lying Proxy` — for tasks(300), trainingDigests(400), exclusions(100), armOrder(4 with repetitions 2): `assert.throws(() => read(v), { code: 'PLAN_LIST' })`; plus `assert.equal(result.tasks[0].armOrder.length, result.repetitions)` on every accepted plan.
- **Severity:** contract.

### 2. Training/evaluation disjointness checks `taskSha256` only; an oracle or baseline that was a training example is DECLARED
- **Clause broken:** "disjoint training and evaluation digests"; gap paragraph "held-out oracle identity"; EV-02 (roadmap.md:5233) "Keep held-out acceptance tests ... separate from ... policy-training examples" — the oracle is the held-out acceptance test.
- **Repro** (`synth-confirm.mjs`; `probe1.mjs` P1-P3; `probe-values.mjs` B1-B2):
  ```js
  const v = fixture(); v.tasks[0].oracleSha256   = v.trainingDigests[0]; read(v);
  const w = fixture(); w.tasks[0].baselineSha256 = w.trainingDigests[0]; read(w);
  const c = fixture(); c.tasks[0].taskSha256     = c.trainingDigests[0]; read(c); // control
  ```
  Observed: `ACCEPTED oracle in training DECLARED 30afdcacfaa6`, `ACCEPTED baseline in training DECLARED 246bc946520d`, `REFUSED task in training PLAN_TRAINING_EVALUATION_OVERLAP`. Only line 84 compares against `trainingDigests`, and only `task.taskSha256`.
- **Fix:** lines 83-85 — `const training = new Set(trainingDigests); for (const key of ['taskSha256','baselineSha256','oracleSha256']) { task[key] = digest(task[key]); if (training.has(task[key])) fail('PLAN_TRAINING_EVALUATION_OVERLAP'); }`.
- **Oracle test:** extend `training and held-out evaluation tasks are digest-disjoint and unique` with two mutants: `tasks[0].oracleSha256 = trainingDigests[0]` and `tasks[0].baselineSha256 = trainingDigests[0]` -> `assert.throws(..., { code: 'PLAN_TRAINING_EVALUATION_OVERLAP' })`.
- **Severity:** contract (interpretive dependency: reads "evaluation digests" as all per-task digests, which the gap paragraph and EV-02 support).

### 3. Suite never exercises numeric lower bounds, list upper bounds, or arm-order asymmetry — 10 bound mutants survive 9/9
- **Clause broken:** "fixed arm order/repetitions"; "bounded budgets"; "overflow ... mutants fail" (test-discrimination side of the deliverable; the shipped module refuses every input).
- **Repro** (`scratchpad/t3/mutate.mjs`, `results.txt`): surviving mutants `natural.drop-min` (l.52), `reps.min-0` (l.68), `budget.min-0` (l.103), `natural.isFinite`/`isInteger` (l.52), `list.drop-max` (l.28), `arm.max-256` (l.86), `tasks.max-257`, `training.max-257`, `excl.max-65`, `arm.counter-gt` (l.91) each report `# pass 9 # fail 0`. Under them `{repetitions:0, armOrder:[]}`, `budget.maxModelCalls=0`, `maxDurationMs=-5`/`1.5`/`2**53+2`, 3 arm orders with repetitions 2, 257 tasks, 257 trainingDigests, 65 exclusions, `['ON_OFF','ON_OFF']` are ACCEPTED. Root cause: budget tests use only `null`/`-0`; only overflow test is repetitions=34; counterbalance test only tries all-OFF_ON.
- **Fix:** none in the module; add the boundary test below to `tests/prevention-experiment-plan.test.mjs`.
- **Oracle test:** `declared bounds are exact on both sides` — per budget key `[0,-1,1.5,2**53+2,'4']` -> `PLAN_NATURAL`, `1` accepted; `repetitions=0,armOrder=[]` -> `PLAN_NATURAL`; armOrder length `repetitions+1` -> `PLAN_LIST`; 256/256/64 accepted and 257/257/65 -> `PLAN_LIST`; `['ON_OFF','ON_OFF']` -> `PLAN_COUNTERBALANCE`.
- **Severity:** medium (test strength; contract-adjacent under "overflow mutants fail").

## Missing oracle (independent containment suite must contain)
- Length-lying Proxy for tasks/trainingDigests/exclusions/armOrder -> `PLAN_LIST`; accepted plan asserts `armOrder.length === repetitions` and `tasks.length <= 256` (#1).
- Revoked Proxy and passthrough Proxy at top/task/list level -> coded `PLAN_RECORD`/`PLAN_LIST`, trap call count 0 (#1 fix).
- `oracleSha256` / `baselineSha256` in `trainingDigests` -> `PLAN_TRAINING_EVALUATION_OVERLAP` (#2).
- Two-sided bound table for every budget key, repetitions, armOrder length, tasks/trainingDigests/exclusions caps (#3).
- All-`ON_OFF` armOrder -> `PLAN_COUNTERBALANCE` (#3, kills `arm.counter-gt`).
- `influenceEnabled` in `['true',1,0,'',null,undefined,'false','off']` -> `PLAN_INFLUENCE_MUST_BE_OFF`; strict `result.policy.influenceEnabled === false` (M1 mutants `=== true`/truthy and post-guard forced `true`).
- Echo fidelity: `assert.deepEqual({...result}, {...fixture(), planSha256, status:'DECLARED', preventionResult:null, promotionEligible:false, influenceEnabled:false, authorizing:false})` and exact `Object.keys` order (M3 swap/drop/const/schema mutants).
- Parametrised `PLAN_IDENTIFIER` over proposer/acceptanceReviewer/policy.version/tasks[].caseId/exclusions[].code (`{}`, `7`, trailing space, uppercase) and `PLAN_TEXT` over description (`''`, 257 chars, padded, NUL, lone surrogate) (M4).
- `measuredTelemetry` in `['0','','UNKNOWN','unknown_until_run',0,null,undefined,{input:0}]` -> `PLAN_TELEMETRY_BOUNDARY` (M5 `typeof !== 'string'` mutant).
- Golden digest: fixture -> `b2ef61eff575bd167f2c51610ecd365e7d0820c42891d8ffb167914d349c51df`; fully key-permuted input -> same hash; output key order canonical (M6).

## Refuted
- T3-02 (oracle === task/baseline digest): reproduces, but no clause requires intra-task distinctness; paired-trial precedent has none; binding is satisfied by hash inclusion.
- T3-03 (Proxy runs caller code): the validator never issues [[Get]] on records and never invokes accessors (calls=0); hash byte-identical to plain input; the only real harm is the length trap, folded into #1.
- T3-04 / IH-4 (no budget upper cap): "bounded" in this codebase means safe-integer with floor (intake-v1 `natural()`, paired-trial test accepts MAX_SAFE_INTEGER); contract names no ceiling; plan is `authorizing:false`.
- T3-M1 (influence sentinel type): shipped module refuses all eight values; genuine influence-on mutants are killed; type-loosening is not an enumerated mutant class (kept as hardening test above).
- T3-M3 (echo fidelity untested): finder's own deepEqual passes verbatim on the real module; no swapped/dropped field is emitted.
- T3-M4 (per-site identifier/text validators untested): original refuses all 14 inputs; duplicate and independence guards intact and killed.
- T3-M5 (telemetry sentinel weakening): original refuses every probed value; check removal is killed via `{input:0}`.
- T3-M6 (no golden hash): shipped canonicalizer is key-order independent (`b2ef61ef...`); fixture JSON is allowed, not required.
- IH-3 (Proxy accepted as exact closed shape): output byte-identical and isolated; no get/has traps fire; contract does not ask for Proxy refusal.
- IH-5 (bidi/ANSI in description): description is hash-bound byte-exactly; identity key is `code` which refuses all such characters; rendering attack on a human is speculative.

## Probed fine
Author's 9 tests pass. Hash binds every declared field (independent sha256 recompute matches; 14-way sensitivity; deterministic; key-order canonical across top/policy/task/budget/exclusion; null-prototype and Proxy input hash identically to plain). Output deeply frozen at every level, no caller object reachable, post-hoc input mutation leaves plan/hash unchanged, constant fields `status/preventionResult/promotionEligible/influenceEnabled/authorizing` present, re-read of an accepted plan refused `PLAN_FIELDS`, no outcome/uplift computed. Duplicates: caseId/taskSha256/trainingDigests/exclusion code all refused; shared oracle/baseline across tasks accepted (legitimate). Repetitions even, 2..32, armOrder length must equal repetitions on plain arrays, exact counterbalance, 34 refused `PLAN_REPETITION_LIMIT`. Exclusions 0..64 unique codes. Influence must be literal `false`. Telemetry only exact `'UNKNOWN_UNTIL_RUN'`. Proposer === reviewer refused. Shapes: Array subclass, sparse holes, `__proto__` own key, extra fields, accessors (getter never invoked), non-enumerable keys, Map, symbol keys, class instances, arguments-like, wrapper objects (String/Number/Boolean) all refused with coded errors. Digests exactly 64 lowercase hex; identifiers `^[a-z][a-z0-9_.-]{0,95}$` incl. U+212A/U+202E/NUL/lone-surrogate refusals. Budgets refuse 0, -0, 1.5, '4', 4n, NaN, Infinity, 2^53. Plain 257 tasks / 65 exclusions refused; 256x32 maximum accepted. 79 single-site mutants: 35 killed incl. every acceptance-enumerated class (accessor, duplicate x4, overlap, overflow cap, influence, independence, telemetry, freeze, sha1), 44 survived of which the non-equivalent ones are listed under #3 and Missing oracle. Noted, not filed: empty `trainingDigests` accepted (vacuous disjointness); `policy.sha256` in trainingDigests accepted; revoked Proxy refused with bare TypeError (coded by #1 fix); `tests/fixtures/prevention-experiment-plan-v1.json` absent (allowed, not required).

Probe files: `/private/tmp/claude-501/-Users-louiscalata-pending-review-nisi/2f53d710-6292-4004-827d-779c1b004c30/scratchpad/t3/{synth-confirm,probe1,probe-values,probe-proxy,mutate,patched}.mjs`, `results.txt`.

---
Workflow wf_38c2b880-343: 3 finder lenses, 2 refuters per candidate, synthesis; 34 agents, read-only; candidates 15, survivors 4. Module reviewed: sha256 185b6550b0f8dce7a77fdfd06e568500ffb9315f2e7349425f38ab65345d4829.
