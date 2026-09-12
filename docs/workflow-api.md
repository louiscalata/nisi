# Workflow Orchestrator API

Nisi is a Node.js ES module library. Import `runWorkflow`, `createCandidate`, and
`createTaskSpecification` from `nisi/workflow` when installed, or from
`./workflow/engine.mjs` in this checkout. Run `npm run example:workflow` for a
complete executable example.

## Task specification

```js
const task = {
  taskId: 'project.change',
  mode: 'edit', // 'edit' or 'review'
  language: 'javascript',
  allowedFiles: ['src/example.mjs', 'tests/example.test.mjs'],
  protectedFiles: ['tests/example.test.mjs'],
  protectedSnapshots: { 'tests/example.test.mjs': 'EXPECTED_SHA256_OF_TEST_SOURCE' },
  acceptanceCriteria: ['The result satisfies the fixed project requirement.'],
  policy: {
    repairBudget: 1,
    totalDeadlineMs: 60_000,
    requiredReviewers: 1,
    requireReportStore: false,
  },
};
```

Replace the illustrative digest with the actual 64-character SHA-256 of the
protected UTF-8 source. A task has exactly these fields. IDs use lowercase
letters, digits, dots, underscores and hyphens, starting with a letter, at most
96 characters. The policy permits 0–100 repairs, a deadline of 1–86,400,000 ms,
and 1–16 reviewers. Language is a nonblank string of at most 64 characters.
There must be 1–128 nonblank acceptance criteria, each at most 2,048 characters.

`allowedFiles` contains 1–1,024 unique relative snapshot names. Paths use `/`;
absolute paths, drive prefixes, backslashes, NUL, empty path components and
`.`/`..` components are refused. Protected paths must be in that allowlist and
each must have a matching digest entry. Paths are case-sensitive logical names.
The host must resolve them under its project root using its platform's rules.
They do not grant filesystem access or prevent another process writing files.

The task and candidate are copied and frozen. Accessor properties, symbol
properties, cycles and non-data objects are refused. The complete normalized
task is hashed under `nisi/workflow-task/v1`. Criteria, scope and policy are
therefore part of the evidence identity.

## Candidate

```js
const candidate = { files: [
  { path: 'src/example.mjs', content: 'export const answer = 42;\n' },
] };
```

This is a nonempty **changed-file snapshot**, not a patch or full checkout.
Every file has exactly `path` and `content`; duplicate names are refused. A
candidate has at most 256 files, each at most 1,048,576 UTF-16 code units, and at
most 8 MiB of UTF-8 content in total. Omitted files mean unchanged. File deletion,
binary content and filesystem application are outside this representation.

`createCandidate(candidate, { authorId })` adds frozen metadata and a
`fingerprint`: SHA-256 of the versioned, sorted path/content snapshot. Author
metadata is excluded so repeated content can be detected as no progress. A
protected file included in a candidate must retain its original source digest.

## Host adapters

```js
const report = await runWorkflow(task, {
  adapters: {
    authorizeContext: { authorize },
    author: { id: 'author.primary', draft, repair },
    staticChecks: { check },
    tests: { run },
    reviewers: [{ id: 'reviewer.primary', review }],
  },
  signal: abortController.signal, // optional
  reportStore: { store },        // optional unless policy requires it
});
```

Callbacks are provided by the application. Methods and IDs are captured once,
and the reviewer plan is fixed before execution. There must be exactly the
configured number of reviewers, with unique IDs distinct from the author ID.
This checks declared separation; the host decides what independent review means
and prevents an author from controlling its reviewers or acceptance tools.

Review mode additionally supplies `candidate` and `candidateAuthorId` in options.
It does not require an author adapter and never calls draft or repair. It still
authorizes the task, checks, tests and reviews. It does not make host callbacks
or the filesystem read-only.

Each stage receives frozen `task`, `candidate`, `acceptanceCriteria`, `binding`
and an `AbortSignal`. Draft has `candidate: null`. Tests also receive the static
check result. Reviewers receive `checks`, `tests`, and `reviewerId`. Repair
receives the preceding attempt's frozen stage records. The engine performs no
file reads, process launches, model requests, candidate writes or publication.

## Evidence schemas

Every evidence record starts with the supplied binding:

```js
{
  schemaVersion: 1,
  runId,                // fresh UUID for this invocation
  taskFingerprint,      // complete normalized task
  attempt,              // zero for initial work; increments for each repair call
  candidateFingerprint, // null before drafting; exact candidate otherwise
}
```

Callbacks return data, not authority to bypass stages. Except for draft, repair
and storage, results have exactly `{ status, evidence }`. Status is `PASS`,
`FAIL`, `NOT_RUN`, or `UNAVAILABLE`. Required fields added to the binding are:

| Stage | Additional evidence fields |
|---|---|
| Authorization | `reason` |
| Static checks | `findings`, `reason` |
| Tests | `assertionsExecuted`, `assertionsPassed`, `failures`, `reason` |
| Review | `reviewerId`, `findings`, `summary`, `reason` |

Findings and failures are arrays of exactly `{ code, message }`, with nonblank
strings. PASS uses an empty reason and empty findings/failures. FAIL requires a
reason and at least one finding/failure. NOT_RUN and UNAVAILABLE require a reason
and no findings. A review always includes a nonblank summary.

Tests additionally enforce these invariants:

| Status | Assertion evidence |
|---|---|
| PASS | Positive safe-integer executed count; passed equals executed; no failures |
| FAIL | Positive executed count; 0 ≤ passed < executed; at least one failure |
| NOT_RUN / UNAVAILABLE | Both counts zero; no failures |

Draft returns exactly `{ candidate, evidence }`, with the binding's candidate
fingerprint replaced by the new candidate fingerprint and a nonblank `note`.
Repair returns exactly `{ status, candidate, evidence }`. Its statuses are
`REPAIRED`, `NO_CHANGE`, `FAIL`, `NOT_RUN`, `UNAVAILABLE`. REPAIRED supplies a new
candidate; all other statuses supply `candidate: null`. Repair evidence includes
`baseCandidateFingerprint` and a nonblank `note`; its candidate fingerprint is
the returned candidate's fingerprint for REPAIRED, otherwise the base fingerprint.

Unknown fields, mismatched run/task/attempt/candidate bindings, malformed records
and contradictory counts block completion. Thrown adapter exceptions become
`ADAPTER_EXCEPTION`; raw exception messages are not copied into the report.
Specific provider failures can be retained separately by an adapter's receipts.

This validates what adapters **report**. It cannot prove that they really ran
their assertions or models, performed independent review, or reported honestly.

## Outcomes, deadlines and repairs

| Outcome | Meaning |
|---|---|
| COMPLETED | All configured required stages supplied valid PASS evidence |
| FAILED | A check, test or review failed with no permitted repair, or repair reported FAIL |
| BLOCKED | Invalid configuration, missing/unavailable/malformed required work or a required storage failure |
| CANCELLED | External cancellation was observed |
| TIMED_OUT | The total deadline expired |
| REPAIR_LIMIT | The configured repair attempts were used and a required stage still failed |
| NO_PROGRESS | The author reported no change or returned any candidate already seen in this run |

Static failures skip tests and review until a successful repair. Test failures
skip review. Reviewer failures stop further reviews for that attempt. A repair
starts fresh static checks, tests and reviews for its candidate. Valid repair
responses, including no-change and failures, remain in the report.

The default clock is monotonic. A custom `clock()` is for testing and must return
nonnegative, nondecreasing safe-integer milliseconds. Clock exceptions,
regression and unsafe deadline arithmetic block the run. A total deadline is
checked before calls and after settlement; asynchronous work is raced against a
timer. Late results are ignored. JavaScript synchronous work cannot be preempted;
the engine rejects its late result after control returns. Host adapters must
cooperate with cancellation and clean up their own processes and requests.

## Run report and storage

The frozen report includes task/run identity, mode, final candidate, stage
records, repair-attempt count, `outcome`, `code`, `workflowOutcome`, and storage
fields. A setup refusal after a valid task retains task identity; invalid tasks
have null identity. Setup refusals do not invoke adapters or the store.

An optional `store({ report, reportSha256, binding, signal })` receives the frozen
**preliminary** report. The digest uses `nisi/run-report/v1` and the engine's
sorted-key serialization. Its return is exactly:

```js
{ status: 'PASS', evidence: { ...binding, outcome: report.outcome, reportSha256 } }
```

Other allowed statuses are FAIL, NOT_RUN and UNAVAILABLE with the same fields.
An exact PASS acknowledgement sets `reportStored: true`, `storedReportSha256`
and `reportStoreEvidence`. These refer to the preliminary report, not the final
report that adds the storage result. The engine trusts that acknowledgement;
it does not independently prove durability or retention. The example performs
an actual write, file sync and read-back digest check.

`workflowOutcome` preserves the outcome before storage. Ordinary optional-store
failures leave `outcome` unchanged and set `reportStoreCode`. Required-store
failures make it BLOCKED. Cancellation or expiry during either kind of storage
produces CANCELLED or TIMED_OUT. A missing required store blocks before any work.
COMPLETED is not a claim of universal correctness or permission to apply or ship.
