# Decision for Louis — embedded Node in the fixed private XPC fixture

Date: 2026-09-13. Decision owner: Louis. Integration owner: Astra (Codex).
Status: APPROVED_INHERIT_2026-09-13_OBSERVED. Provenance: Louis, 2026-09-13 ~10:40 PDT, in the Claude session, verbatim: "Approve the inherit entitlement, have Astra rerun it"; subsequent user follow-up approved the exact staged relocation and experiment-container effects. One additional native launch completed: protected checker FIXED_EMBEDDED_NODE_OBSERVED, errors []; all five fixed canaries matched, Node exit 0 and drain observed. See [inherit checkpoint](../../docs/verification/2026-09-13/u02-xpc-embedded-node-inherit-checkpoint.json). The launch authorization is consumed; no retry, further entitlement change, generated-code execution or isolation acceptance is authorized. Earlier proposals and first-attempt statements below are historical. Fable receipt verification is pending.

## Exact question

May the XPC service fixture embed a Node binary to run a FIXED, non-generated
script under App-Sandbox-only entitlements, as the prerequisite experiment
before any isolation acceptance?

## Already measured — retained evidence, not rerun in this session

- [Fixed private XPC prototype](../../docs/verification/2026-09-12/u02-private-xpc-prototype-checkpoint.json):
  `FIXED_PRIVATE_XPC_PROTOTYPE_OBSERVED`; two fresh native experiments.
  Host and service carried only `com.apple.security.app-sandbox: true`.
  Own-container read/write succeeded; selected outside read/write and IPv4 bind
  were denied with errno 1. Client launch/close/exit were observed; independent
  service termination was not proven. `prototypeIntegrated: false`.
  Isolated parser: 9/9 checks, 3/3 selected mutants detected; not integrated.
- [Initial fixed App Sandbox probe](../../docs/verification/2026-09-12/u02-app-sandbox-probe-checkpoint.json):
  `FIXED_NATIVE_CAPABILITY_OBSERVED_NOT_ISOLATION_ACCEPTANCE`.
  Selected outside read/write and loopback bind were denied; a fixed child ran.
  Child PID was self-reported; the container remained after execution.
- [Repeatable App Sandbox probe](../../docs/verification/2026-09-12/u02-repeatable-app-sandbox-checkpoint.json):
  `SCOPED_FIXED_NATIVE_AND_PORTABLE_ACCEPTANCE`; two native experiments/four
  launched fixtures, with direct close observed. Portable 972/972; selected
  parser mutants 4/4 detected. `completeIsolation: false`, `authorizing: false`.
- [Earlier Node sandbox investigation](../../docs/verification/2026-09-12/u02-generated-approval-checkpoint.json):
  checkpoint `PASS_SCOPED_WITH_ISOLATION_UNACCEPTED`; isolation result
  `PARTIAL_CAPABILITY_ONLY`. The only working Node profile needed broad file
  reads; a narrow allowlist was not found. Generated-code suitability was false.

## Bounded experiment proposed if Louis approves

1. Freeze and hash the exact embedded Node binary, fixed script, host/service,
   entitlements and checker; verify the nested signatures and runtime inventory.
   Use App-Sandbox-only entitlements; stop if Node requires broader entitlements.
2. Copy the reviewed script to one predetermined service-container location.
   The XPC service uses `posix_spawn` with fixed Node path/argv, container cwd and
   a minimal fixed environment. Reject interpreter overrides such as NODE_OPTIONS.
   Accept no caller script, path, command, environment, model output or repository
   path; do not read or execute a repository candidate through this fixture.
3. Record spawn return/errno, child identity, observed exec or exec failure,
   raw wait/exit/signal outcome, bounded stdout/stderr and observed EOF/drain.
   Use a deadline and output cap; unknown exec, exit or drain cannot become PASS.
4. Use fixed canary operations to observe the Node child's own-container access
   and selected outside/network denials. Compare raw outcomes with a protected
   checker. Record timeout/cancellation and any descendant/cleanup uncertainty.
5. Retain exact inputs, hashes, timings, raw logs and container inventory.
   Keep `generatedCodeExecuted: false`, `completeIsolation: false` and
   `authorizing: false`. A successful prerequisite leaves isolation acceptance open.

## Risks and recommendation

Inference: Node/V8 startup, signing or sandbox inheritance may fail under these
entitlements; measure that failure without widening the approved experiment.
Mutable scripts, runtime hooks, environment or path resolution could enlarge the
executable input. Direct-child exit does not prove service/descendant settlement;
finite canary denials do not prove complete isolation. Containers can persist.

Recommendation: approve this fixed-script prerequisite only. Require a separate
reviewed isolation/ownership decision before generated-source execution.
No Node embedding, signing, fixture launch or model request was performed here.
Luna extracted retained evidence; Daybreak Blue reviewed the proposed boundary.
