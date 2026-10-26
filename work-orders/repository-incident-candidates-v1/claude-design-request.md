# Private Nisi — source-bound incident candidates

You are a bounded tool-disabled coauthor. Return an implementable design review,
not a claim of executed tests. No source changes or external disclosure. Opus is
the retained working Claude route after Fable credit unavailability this task.

We are merging private Veritas into Nisi. Next step is actual per-stage failure
intelligence, not labeling an aggregate failed run a model defect. Propose the
minimal useful source-bound incident-candidate projection and identify pitfalls.

Current real Node host retains original issued preparations, Swift static plans
and groups, and Node executions. Its collect(report) awaits both owners, validates
all invocation bindings and constructs createRepositoryRunBundleV1(context).
context exact keys: report, preparation, suite, nodeRegistrationFingerprint,
plans, groups, executions. readRepositoryRunBundleV1(bundle,context) reruns those
checks and compares canonical contents. It does not authenticate its trusted
adapters. Output flags executionVerified/authorizing/certificationGranted false.
Host state is SETTLED iff both owners IDLE and bundle creation valid; otherwise
QUARANTINED, bundle=null, with retained diagnostics. History preview currently
stores only metadata summary and counts, never stage findings. That v1 meaning
must remain unchanged.

Bundle contains report.stages {stage,status,candidateFingerprint,code,evidence},
staticBundle.entries {group,disposition}, and testEntries
{execution,adapterResult,disposition}. Disposition distinguishes RESULT_RECORDED
from ENGINE_INTERRUPTED; records arriving after an engine deadline are not an
accepted task failure. Original-issued checks exist in the bundle reader, not
on deserialized JSON. Stage evidence binds run/task/attempt/candidate. A repaired
run can finish COMPLETED after attempt0 failed and attempt1 passed; retain that
earlier failure without making repaired attempts independent occurrences. FAIL
is a deterministic check outcome, not proven root cause or model attribution.
Node receipt FAIL validates closed process, confirmed drain, no deadline/cancel,
untruncated outputs. Static group can contain per-file checks; unavailability
must not be promoted merely because another field says FAIL.

The native imported PipelineIncidentAdapter admits only existing deterministic
native profile reruns against ArtifactSnapshot/PipelineResult; do NOT pass Node
observations into that v1 API, edit frozen imports, or claim equivalence. A new
versioned Node incident candidate is legitimate progress; native bridge follows.

Candidate direction: new metadata-only versioned helper, actual host exposes
incidentPreview() after settlement; computes per-stage rows only using original
context and readRepositoryRunBundleV1; exact receipt/plan/group/report/bundle
digests, candidate/run/task/attempt/stage index binding; hash free text and source
paths rather than retaining them. No raw code, output, claims, learning consent,
native writes, predictions, causal proof or public release. Already-stored v1
aggregate cannot be upgraded into qualified failure evidence. Replay should
have stable row identity, content digest detects conflicts, occurrence identity
counts one task run/family rather than each attempt as independent recurrence.
Future persistence must have explicit separate scope/consent/retention and
recheck revocation/expiry. Preview itself is not persisted or learning eligible.

Give <=6 concrete design corrections and a suggested compact exact row schema,
qualification rules, and test cases. Keep uncertainty and source trust explicit.
