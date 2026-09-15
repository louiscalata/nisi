# Claude Opus 5 review of experimental/module-registry-v1.mjs (Track 5) — 2026-09-14

Adversarial workflow: 3 finder lenses → 2 independent refuters per candidate → synthesis. 34 agents, read-only static + probes. Not NX-08/U02-07 acceptance. Handed to OpenCode as task O3 (see ../../opencode-handoff-20260914/HANDOFF.md).

Static+probe review of `/Users/louiscalata/nisi-next-private/experimental/module-registry-v1.mjs` (draft, product path). This is NOT NX-08/U02-07 acceptance; it is a read-only code-and-probe review against the Track 5 acceptance text. Author tests: 7/7 pass (node --test, re-run 2026-09-13).

VERDICT: ACCEPT_WITH_DEFECTS

Two confirmed defects, both medium, both one-line fixes at existing validation sites. No high-severity finding: every probe left registry state, history, identity hashes, and the data-only bound intact; no dynamic import, executable entrypoint, tool permission, provider/file expansion, or policy mutation is reachable.

CONFIRMED DEFECTS

D1 (medium) — inspect()/disable() skip identifier validation and coerce ids via template literal
- experimental/module-registry-v1.mjs:88-89 (disable) and :100-101 (inspect); contrast :131-132 (requestActivation calls requireIdentifier) and :178.
- Acceptance violated: "exact version/capability/budget schema" and "Faults for ... executable fields must be detected"; also the bounded text "data-only ... must expose no ... executable entrypoint" and the author's own accessor invariant (test 6, "without invoking them").
- Repro (BN01 fixture registered): inspect({moduleId:[id], versionId:[ver]}) -> ok:true; inspect({moduleId:{toString(){calls++;...}}, versionId}) -> ok:true, toString invoked once; disable({moduleId:[id], versionId:{[Symbol.toPrimitive](){...}}, sourceSha256}) -> ok:true state DISABLED (state transition on non-string identity); module registered as '1'/'2' matched by numeric 1/2 on inspect and disable while requestActivation with the same numbers -> INVALID_MODULE_ID; a toString that re-entrantly calls s.disable()/s.requestActivation() inside inspect() succeeds mid-reduction; moduleId: Symbol('s') or Object.create(null) or {toString:1} throws an uncaught TypeError out of the API (key build is outside the try) instead of a reject record.
- Bounds: sourceSha256 is strict-compared (:91), so disable still needs the exact hash; coercion only resolves already-registered exact ids; no persisted identity rewrite; history/sequence stayed consistent under re-entrancy.
- Fix (packet item): in disable() and inspect(), move the Map-key construction inside the try block and call requireIdentifier(request.moduleId, 'INVALID_MODULE_ID') and requireIdentifier(request.versionId, 'INVALID_VERSION_ID') immediately after cloneRecord, mirroring readRequest :131-132. Add tests: array/number/toString-object/Symbol ids on inspect and disable must return {ok:false, code:'INVALID_MODULE_ID'|'INVALID_VERSION_ID'} with caller toString call count 0.

D2 (medium) — cloneRecord exactness check ignores non-enumerable and Symbol-keyed own properties
- experimental/module-registry-v1.mjs:148 (`Object.keys(input).length === keys.length && keys.every(hasOwn)`).
- Acceptance violated: "Faults for implicit activation, identity rewrite, budget widening, and executable fields must be detected" and "exact version/capability/budget schema". The author test (tests/experimental-module-registry.test.mjs:88-90) defines detection as UNEXPECTED_FIELDS and only probes enumerable extras.
- Repro: for each of entrypoint/main/exec/script/command/import/require/url, Object.defineProperty(manifest, name, {value:'run()', enumerable:false}) then register() -> ok:true REGISTERED_INERT (8/8); manifest[Symbol('entrypoint')]='import("x")' -> ok:true; non-enumerable resources.command -> ok:true; activation request with non-enumerable entrypoint -> ok:true DECLARED_ACTIVE; registry config with hidden 'loader' accepted. Padding variant: an ENUMERABLE rawCode:'run()' (the exact shape test line 89 refuses) registers ok:true when one allowlisted key (e.g. dataType) is made non-enumerable, because :148 is a count, not a set equality.
- Bounds: hidden fields are stripped by the allowlist copy (:149-155), never stored, hashed, invoked, or echoed; stored manifest has exactly the 10 schema keys and 0 symbols; identitySha256 equals a clean registration. Unreachable from JSON; requires an in-process caller.
- Fix (packet item): at :148 replace Object.keys(input).length with Reflect.ownKeys(input).length (covers non-enumerable own keys and symbols, and defeats the padding variant); keep keys.every(hasOwn). Add tests: non-enumerable own extra, Symbol-keyed extra, and the padding variant must all refuse UNEXPECTED_FIELDS on manifest, resources, activation request, and registry config.

RECORDED, NOT CARRIED (refuted as acceptance defects; owner may still want them)
- reject(error.message) passes through caller-thrown values (:52-53, :58, :73, :88, :100): result.code can be a function or live caller object (then deep-frozen); `throw null` from a toString escapes as TypeError; sourceSha256 regex at :118/:133 coerces before typeof check. State never changes. Hardening: typeof string guard before the regex; reject() whitelists module vocabulary.
- INCOMPATIBLE state absent (:5): incompatible manifests are refused with distinct codes and never recorded; inert holds. The bounded-implementation bullet names INCOMPATIBLE; acceptance does not. Design decision for the owner.
- Unbounded history/registry, O(n) history copy per answer() (:107, :164): host-driven only; "preserves history" is satisfied. Efficiency preference.
- moduleId aliasing of one retained source (:61): identity is IDENTITY_KEYS incl. moduleId by design; multi-role per interface requires it.
- Proxy manifests: traps run on the caller's own object; all validation runs on the captured copy; nothing retained.
- Fixture location: tests/fixtures/experimental-module-manifests.json does not exist; tests/experimental-module-registry.test.mjs:7 reads work-orders/parallel-seven-tracks-v1/track5/retained-bn01-module.json, outside the Track 5 "Allowed files" list. Process note, not a code defect.

CHECKED AND SOUND (probed, no defect)
- Duplicate (same moduleId+versionId) and conflicting (same moduleId, other versionId) identities refuse (:60-63).
- Activation requires consent === 'DECLARE_ACTIVE_ONLY' and matching hostContractId; wrong/absent consent refuses; no implicit activation from register.
- Identity rewrite on activation/disable refused by strict sourceSha256 compare (:76, :91); stored identity and identitySha256 never change.
- Budget widening refused (BUDGET_WIDENING_REFUSED :79); module budget over host refused (MODULE_BUDGET_EXCEEDS_HOST :64); resources are 4 safe non-negative integers.
- Disable reversible (DISABLED -> DECLARED_ACTIVE re-activates) and history append-only with monotonic sequence.
- Unsupported interface/role/type, invented capability, retained-source drift all refuse; refused manifests never enter records.
- Enumerable extra fields, accessors (reads===0), non-plain prototypes, function-valued schema fields all refuse.
- No import(), require, eval, fs, child_process, fetch, or timer in the module; output records are deep-frozen plain objects; no input reference retained (armed Proxy traps untouched after register).

MISSING ORACLE (acceptance sentences with no discriminating author test)
- "exact version/capability/budget schema" — no test sends non-string ids to inspect/disable, no test for non-enumerable/Symbol own keys, no test for the count-vs-set padding variant (D1, D2).
- "duplicate or conflicting identities refuse" — tested for same moduleId only; no test asserts the intended behaviour for a second moduleId over the same retained source (aliasing is by design but undocumented in tests).
- "disable is reversible and preserves history" — tested once; no test asserts sequence monotonicity, or that a rejected transition appends nothing.
- "unknown/incompatible modules remain inert" — no test that requestActivation/disable on a refused-incompatible identity returns MODULE_NOT_REGISTERED; no test that the reject envelope carries authorizing/installed/loaded/running all false.
- "module data cannot expand providers/files/tools or mutate policy" — no test compares registry/config state before and after a poisoned manifest; no negative test for a manifest that tries to carry sourcePath outside the pinned set under a supported interfaceId beyond the single drift case.
- "Faults for implicit activation ... must be detected" — implicit activation is tested only via register(); no test that inspect() or disable() cannot transition INERT -> ACTIVE.
- "must expose no dynamic import, executable entrypoint ... installer behavior" — no static-grep or import-surface test; currently verified only by this review's manual probe.
- Never-throws envelope contract — no test asserts that every public entry point returns a record rather than throwing on hostile input (D1 exposes two throw paths).
