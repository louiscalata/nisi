# Confidential follow-up: coauthor C01–C07, not duplicate modules

Your first proposal was a useful scope warning but several features already
exist. We must NOT recreate recovery, admission, drain, registry or paired-trial
contracts. Also a fresh residency check NEVER proves inference: correct that
sentence from your P09. P08 self-review labeling already exists exactly.

Coauthor the implementation contract for seven of ten packets using only the
verified facts below. Return seven concise sections, each: intended change,
tests that discriminate, dependencies, owner-review stop. No tools/writes.
Keep packet scope bounded; security/concurrency implementation is held for
owner-led review, not unattended execution. No automatic publication.

C01 native-overlay artifact tolerance (NX04/07): tests/nisi-native-overlay.test.mjs
and work-orders/parallel-seven-tracks-v1/build-nisi-macos.mjs require precisely
one excluded directory native/macos/CodenameVeritasFramework/.build and two
legacy markers .buildSystem_debug and CACHEDIR.TAG. Actual directory absent;
two overlay tests fail while all 13 frozen-import verifier tests pass. The 225
source hashes match. Proposed contract: accept clean absence OR exactly the
historical marker set; reject all unknown entries, wrong kinds, symlinks and
in-build mutation. Do not create cache artifacts or change frozen source/pins.
Separate pure inventory validation from real builds; synthetic tests first.
Build source currently walks compiled symlinks against the manifest and snapshots
hidden state before/after, which must remain. Initial correction is NOT a native
build/launch/signing acceptance. Actual historical marker byte hashes must be
resolved from retained evidence or legacy-marker acceptance stays owner-held.

C02 fixture bundle/receipt truth (NX04): isolated work-order runner and oracle at
work-orders/parallel-seven-tracks-v1/track1/. Existing 10-test oracle passes a
fabricated bundle stub. Review requires oracle re-read via product reader
readRepositoryRunBundleV1(bundle,{report,preparation:prepared.repaired,suite,
nodeRegistrationFingerprint:bundle.nodeRegistrationFingerprint,
plans:staticHistory.map(x=>x.plan),groups:staticHistory.map(x=>x.group),
executions:testHistory.map(x=>x.execution)}). Expect CONSISTENT, true
finalChecksRecordedPass, testCount=recordedTestPasses=1, exact bundle fingerprint,
actual retry-settings.mjs MODIFY before/after hashes and static FAIL then PASS.
Runner should retain preflight.json first (exact source manifest+fingerprint),
engine-report.json, host-result.json and completion-only runner-receipt.json;
exclusive writes; each digest from actual bytes. Receipt binds run, repaired
candidate, reviewedSourceFingerprint, bundleFingerprint, reviewDefaults both false.
All new tests must be included in graded npm test. No production install yet.

C03 fixture cleanup/outcome (depends C02): currently frozen result built before
finally, cleaned:true constant, fsp.rm errors swallowed; SETTLED alone maps to
COMPLETED even for CANCELLED engine. Exact completed predicate: settled AND
report.outcome and report.workflowOutcome both COMPLETED AND bundleError===null
AND proposedChanges!==null. Derive cleanup after removal using lstat ENOENT only;
on removal failure cleaned:false, cleanupError and adverse status, no accepted
receipt. Handle mkdtemp/chmod failure without leaked root; prefer report.code for
CANCELLED/TIMED_OUT. Tests inspect residue BEFORE harness cleanup, include denied
removal, failed creation/permissions, cancellation timing and settlement rejection.
Do not promise removal of an already-written file when removal itself failed.

C04 fixture containment oracle (depends C03): review identified leak mutants
through parentRoot, fsp.open, callback fs.writeFile, symlink ancestor and link/..
normalization; old lexical guard and late cleanup hide them. Exact owned-root
write boundary after allocation, zero writes before profile/source validation.
Harden test helper with realpath of deepest existing ancestor, all write-capable
open/fs callback/sync/async paths and both source/destination where applicable.
Use exclusively owned synthetic escape roots; never touch unrelated temp entries.
Reject six targeted mutants through assertions with per-mutant counts, not import
errors. This is test containment, NOT an OS sandbox. Owner security review required.

C05 fixture closed inputs/imports (depends C04): reject unknown endpoint/model/
reviewHistory/reviewIncidents fields and unsupported inject.staticOwner. Known
input keys parentRoot,profile, optional signal,sources,inject; inject only testsOwner
(confirm actual source before freeze). Descriptor/accessor/prototype/symbol cases
must be checked before side effects. Static audit handles literal dynamic imports,
re-exports, nonliteral import/createRequire/process.binding; exact approved import
set, no >=8 padding. Runtime guard observes socket connect/TLS/dgram/http2/DNS.
These are bounded regression guards, NOT proof arbitrary JS cannot escape.

C06 host restart wiring (NX05/07): history/bundle-restart-demo.mjs and
history/recovery-worker.mjs already integrated with fresh-process tests. Missing
piece is real repository host bundle integration under reviewed-workflow-v1.mjs.
Author a held contract/test seam consuming exact settled run/bundle identities;
record historical observation only; no resume, replay of side effects, permission
restoration, implicit storage or learning. Existing interruption decision is a
pure classifier. Define refusal/crash/partial-write tests and needed owner decisions,
NOT invented production API names or automatic wiring.

C07 native incident admission (NX05): native-incident-source-v1.mjs already issues
SOURCE_BOUND plans in WeakMap, raw source read only via issued accessor. Status
declares nativeRerun NOT_RUN, executionVerified false, learningEligible false,
requiresSeparateAdmission true. Only staticChecks recorded FAIL accepted;
Node test failures unsupported. Next held owner-led design connects exact issued
plan to existing Swift owner with separate admission/capture choice. Preserve
original vs fresh evidence, digest/profile/task/run/candidate matching, TTL/revoke,
cancel/drain failures. No weakening issuance into public-hash authorization.

C08–C10 are owner-led: C08 full OpenCode agent integration smoke (not direct tool
only), C09 clean private Node22/types/package consumer, C10 complete feature/gate
acceptance inventory and remaining NX06/07/08 owner actions. Do not imply ten
packets alone complete all roadmap features. Seven Fable assignments is workload
allocation, not measured 70% wall time or independence.
