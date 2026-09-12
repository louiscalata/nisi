# Architecture

Nisi separates workflow coordination from the application actions that perform
file reads, model calls, checks, tests, reviews, and report storage. The orchestrator
captures task data and supplies frozen snapshots to callbacks. It validates structure,
identity, stage order, and evidence before continuing.

## Component boundaries

`workflow/engine.mjs` exports `runWorkflow` and coordinates a sequential edit
or review run. `workflow/contracts.mjs` owns task and candidate normalization,
deep-copy and freeze behavior, stable serialization, fingerprints, and result
schemas. `policy/file-access.mjs` controls the separate file-admission
boundary. `serialization/canonical-json-v1.mjs` gives supported JSON a stable
representation and digest. The Apple Foundation Models and local chat modules
are adapters; neither is required by the workflow orchestrator.

The application supplies all executable work through adapters. The engine does
not read files, start processes, call a model endpoint, modify a candidate on
disk, commit, publish, or release. A report store is also an injected callback.

## Execution flow

The Workflow Orchestrator carries one task through a fixed path:

1. **Intake and authorization:** normalize the task and ask the host whether
   the permitted context may be used.
2. **Draft:** in edit mode, the author returns a candidate snapshot and note.
3. **Static checks and tests:** evaluate the current candidate against the
   fixed criteria. Tests must report a positive executed-assertion count when
   they pass or fail.
4. **Review:** each required reviewer receives the candidate and fresh check
   and test records. Review mode uses a supplied candidate and reaches review only after
   authorization, checks, and tests.
5. **Repair or finish:** a failed check, test, or review may invoke the author
   within the repair budget. The repaired candidate begins a fresh cycle.

The engine binds every stage to a run ID, complete task fingerprint, repair
attempt, and candidate fingerprint. A stale or contradictory record stops the
run. A repeated candidate or explicit no-change repair produces `NO_PROGRESS`.

## Glossary

| Term | Meaning in Nisi |
|---|---|
| **Pipeline** | The ordered processing path from task intake through authorization, candidate work, checks, tests, review, repair, and report creation. |
| **Workflow** | The rules and steps for completing a task, including authorization, stage order, acceptance criteria, repair policy, and stopping conditions. A run executes those rules. |
| **Run** | A single invocation of `runWorkflow`, identified by a fresh `runId` and represented by one immutable report. |
| **Stage** | One named step in a run, such as `authorizeContext`, `draft`, `staticChecks`, `tests`, `review`, or `repair`. Its record contains status, binding, and evidence. |
| **Status** | The result returned by an adapter: `PASS`, `FAIL`, `NOT_RUN`, or `UNAVAILABLE`. Repair additionally permits `REPAIRED` and `NO_CHANGE`; draft returns candidate and evidence without a status field. |
| **Outcome** | The engine's final run result: `COMPLETED`, `FAILED`, `BLOCKED`, `CANCELLED`, `TIMED_OUT`, `REPAIR_LIMIT`, or `NO_PROGRESS`. |
| **Candidate** | A nonempty, normalized snapshot of changed relative file names and complete file contents. It has a stable fingerprint and an author ID. It is not a patch and does not apply itself. |
| **Adapter** | An application-supplied callback object for authorization, authoring, checks, tests, review, or storage. The engine validates its declared identity and returned data; the host remains responsible for its behavior. |
| **State** | The run's current task, candidate, attempt number, stage records, outcome, and identity bindings. Input snapshots and returned reports are frozen so callbacks cannot mutate the engine's view after capture. |

## Architectural patterns

The implementation uses sequential orchestration, callback dependency injection,
runtime contract validation, and immutable snapshots. Model calls, test processes,
and storage are implemented behind adapter interfaces supplied by the host.
State is held in memory during a run; Nisi has no checkpoint/resume API, durable
workflow scheduler, distributed workers, or configurable dependency graph.

## Evidence and trust

Every stage receives a binding containing `schemaVersion`, `runId`,
`taskFingerprint`, `attempt`, and `candidateFingerprint`. Stage-specific
evidence adds findings, reasons, reviewer identity, notes, or assertion
counts. The engine rejects unknown fields, missing required fields, stale
bindings, duplicate reviewer IDs, and an author/reviewer identity match.

Binding validation checks that a returned record declares the identity expected
for this run. It does not prove that the callback performed the claimed work. For
example, a `PASS` test record is valid only when its evidence has positive
executed and passed counts, but Nisi cannot independently observe the test
process. The same trust boundary applies to provider-reported model names and
token usage in local-chat receipts.

## Outcomes and host decisions

`COMPLETED` means every configured required stage supplied valid passing
evidence for the current candidate. It does not authorize applying files or
shipping a release. `FAILED` records a stage failure with no permitted repair or a failed repair;
`BLOCKED` records setup, evidence, availability, or required-storage problems;
`CANCELLED` and `TIMED_OUT` preserve the reason progress stopped;
`REPAIR_LIMIT` records exhausted corrections; and `NO_PROGRESS` records a
repeated candidate or no-change response.

The optional report store receives a frozen preliminary report and an exact
versioned digest. Its acknowledgement can set `reportStored`; the engine does
not independently prove durable retention. Use the [Workflow API](workflow-api.md)
for exact schemas, [File Access Policy](file-policy.md) for host-controlled
content admission, [Local Models](local-models.md) for loopback adapter setup,
and [Verification](verification.md) for source- and environment-scoped checks.
