# Native canary adapter — pre-execution review by Astra

Date: 2026-09-13. Scope: the private native-canary-adapter work order only.

## Verdict

CHANGES MADE. The original expected test values were correct, but the contract admitted false MATCH/ALL_MATCHED results. Context and focused assertions in the existing 14 tests were corrected. Review of the revised contract is complete; implementation and execution acceptance are not established. No adapter implementation, packet-run, model calls, commit or push occurred.

## Hash check

The local adjudicator equals the accepted source in ../native-canary-adjudicator/src/native-canary-adjudicator.mjs and the supplied hash. The stdout fixture equals the actual .build/xpc-embedded-node-9u2lavy_/logs/node.stdout and the decoded stdoutBase64 in service-raw.json. Source reads outside this work order were read-only.

```json
{
  "adjudicator": {
    "sha256": "cf875eaa7adf335ceab49ae16f9941e2d9b5b9780f5ca15c22eea4c97405de00",
    "bytes": 8536,
    "equalsAcceptedSource": true
  },
  "stdout": {
    "sha256": "51612e7ba818bfe7dd2a42d46e8c0cf8e84332d63f2562132842e9879bc3dddc",
    "bytes": 781,
    "equalsRealStdout": true,
    "equalsServiceCapture": true,
    "splitLines": 6
  },
  "runtime": {
    "childPid": 20280,
    "servicePid": 20279,
    "spawnReturn": 0,
    "waitObservedPid": 20280
  }
}
```

The service-raw.json record gives childPid 20280, servicePid 20279, spawnReturn 0 and waitObservedPid 20280. The captured service source obtains servicePid using getpid() (inputs/probe-service.m:45), and childPid from the successful posix_spawn output (lines 93, 100). This verifies the provenance of the fixture constants independently of child stdout; the pure helper cannot authenticate future caller inputs.

## Findings

### (a) Executor ambiguity

Original Context lines 49–55 did not fully define object/null/array handling, inherited policy fields or the behavior of other stdout types. Context now defines non-null non-array objects, own required fields and lookups, own enumerable table entries, and TypeError without coercion after mapping validation. Alternative caller mappings remain trusted policy and are not automatically approved v1 mappings. Future acceptance must use the unmodified v1 mapping and the complete matrix.

Original lines 63–73 compared raw escaped key text. That was precise but insufficient: outcome and \\u006futcome are the same JSON name. The scanner now decodes each complete quoted key in a guarded JSON.parse before full-line parsing, with separate raw-name fallback sets for invalid key literals. Array object scopes and malformed scanner input are explicit. Identity expectations must come from trusted same-run host/service evidence, not observed stdout.

### (b) Context versus tests

No original assertion had an expected value that contradicted the original packet's literal rules. Original Context lines 72–73 ("the same name in two different objects, or inside an array of objects, is not a duplicate") could be misread as exempting duplicates within a single array element. It now explicitly permits reuse across separate objects and rejects reuse within one object. Original tests covered the former but not the latter.

Original lines 76–104 allowed operation-less passthrough, unmapped output names, raw canonical outcomes and discarded identity/diagnostic fields. The tests did not exercise the resulting vocabulary collisions; this was a missing safety contract, not an incorrect existing expected value. The new rejection guard explicitly precedes those branches. Original valid outputs and all 14 test names remain intact; accepted duplicate fixtures now assert exact mapped output, instead of merely not being REJECTED_DUPLICATE_KEY.

### (c) Manual test trace

All original duplicate examples are valid JSON; escaped quotes were verified at the actual string-character level, not by their JavaScript source appearance.

| Duplicate case | Hand trace and expected result |
| --- | --- |
| Original rejected 1: operation twice | Same root key set sees operation twice: REJECTED_DUPLICATE_KEY. |
| Original rejected 2: outcome twice | Same root key set sees outcome twice: reject before last-value parsing. |
| Original rejected 3: meta.a twice | Nested meta has its own set; its second a rejects the entire line. |
| Original rejected 4: a followed by an escaped quote and b, twice | Escaped quotes do not terminate the string; both complete member names are a\"b in the root set: reject. |
| Original accepted 1: note contains quoted op fragments | All apparent op fragments are characters inside one string value. Only operation, note, pid and ppid are keys: MAPPED_IDENTITY with pid 20280 and ppid 20279. |
| Original accepted 2: list contains two objects with k | Each object pushes its own set; one k per set: MAPPED to own-write / ALLOWED / 0. |
| Original accepted 3: a.x and b.x | The two x keys belong to separate nested sets: MAPPED to own-write / ALLOWED / 0. |
| Original accepted 4: s contains }{ | Those braces are in a string value and never change the stack: MAPPED to own-write / ALLOWED / 0. |
| Added rejected 5: outcome and escaped outcome | Both decode to outcome in the root set: reject. |
| Added rejected 6: pid and escaped pid | Both decode to pid in the root set: reject. |
| Added rejected 7: meta.a and escaped a | Both decode to a in the same nested set: reject. |
| Added rejected 8: one array element has k twice | The single element object's set sees k twice: reject. |
| Added rejected 9: invalid \\q key twice | Key decoding fails safely; the fallback raw-name set sees the same invalid key twice: reject. |
| Added rejected 10: truncated object after second a colon | The second a already closed and is followed by a colon: reject before whole-line parsing despite truncation. |
| Added accepted 5: a versus a literal backslash followed by u0061 | The second key decodes to six literal characters, not a: separate names, normal MAPPED output. |
| Added malformed nonduplicates: unmatched closers, unfinished string, one invalid escape key | No repeated key is established; scanner does not throw, full JSON.parse fails: PASSTHROUGH_INVALID unchanged. |

Every duplicate rejection serializes exactly {"op":"","reason":"DUPLICATE_KEY"}; the adjudicator reports MISSING_OP at the original line. One rejected line means mapped 0 / passthrough 0 / rejected 1 / blank 0. Replacing one genuine fixture row with any such rejection yields NOT_ACCEPTED.

Denial cases, in test order: DENIED, ERROR, ERROR, ERROR, ERROR, ERROR, DENIED, ERROR, ERROR, ERROR, ERROR. Only outside_read + numeric errno 1 + code EPERM + syscall open, and ipv4_loopback_bind + numeric errno 1 + code EPERM + syscall listen, match their own signatures. The wrong operation/syscall, EACCES/13, string errno, missing errno/code/syscall and lowercase code cannot establish denial. An inherited signature is ignored. In single-row adjudication the two recognized denial rows MATCH; each ERROR row MISMATCHes. Missing, numeric and case-unknown outcomes remain mismatches. Canonical raw ALLOWED/DENIED and non-error diagnostics now reject via the vocabulary guard.

Identity cases: numeric pid 20280 and ppid 20279 survive unchanged; string/missing IDs remain string/missing and MISMATCH the trusted numeric expectations. Either wrong childPid or wrong servicePid produces MISMATCH and NOT_ACCEPTED. Invalid runtime values (including inherited-only fields, arrays, unsafe integers and infinity) throw. Present contradictory identity outcome/errno/code/syscall fields now reject; absent outcome/errno remain permitted as in the original contract. The exact five-row matrix pins errno 0,0,1,1 and both identities. A repeated own-write row remains AMBIGUOUS.

Line rules: 781 bytes end with LF, so split yields six entries: five mapped rows then BLANK; counts are 5/0/0/1. The original mixed six-line case gives PASSTHROUGH_INVALID at 1–2, BLANK at 3, PASSTHROUGH_NO_OPERATION at 4–5 and MAPPED at 6; adjudicator malformed line numbers are 1,2,4,5. garbage followed by two CRs loses exactly one CR; a following whitespace-only line and terminal empty line become BLANK. null, undefined and empty stdout each produce one BLANK report. Reports, counts, key order and the expected formatted table remain consistent with the frozen adjudicator.

These are contract/test expectation reviews. The placeholder stops functional tests before their later assertions, so the new regressions have not passed against an implementation.

### (d) The three adjudicator acceptance limits

1. Unconstrained errno/identity: the complete expectedMatrixFor output supplies every required errno and both positive safe-integer identities. The fixture constants were checked against independent service evidence. Caller evidence provenance and run binding remain integration obligations.
2. Duplicate JSON members: decoded-key comparison now rejects equivalent JSON spellings, including nested objects, instead of allowing JSON.parse last-value selection.
3. Vocabulary and denial interpretation: an explicit versioned mapping requires exact per-operation denial signatures; other operational errors become ERROR. The added guard prevents passthrough vocabulary and discarded contradictions from bypassing that interpretation.

All three limits are addressed at the reviewed contract level under the documented trusted-input prerequisites. This does not establish implementation acceptance, evidence authenticity in a future integration, or isolation acceptance. The frozen adjudicator still returns isolationAccepted: false.

### (e) False-match paths and remaining boundary

Seven original-contract cases were traced to the manually derived output and then supplied to the frozen adjudicator alongside four otherwise matching rows. Each produced MATCH and ALL_MATCHED. This probe did not implement or run the adapter. Cases: escaped duplicate outcome, operation-less adjudicator row, unmapped operation colliding with an output op, unknown outcome colliding with DENIED, discarded conflicting op, discarded identity error, and discarded non-error diagnostics.

```jsonl
{"name":"escaped duplicate outcome","raw":"{\"operation\":\"own_container_write\",\"outcome\":\"error\",\"\\u006futcome\":\"allowed\",\"errno\":0}","manuallyDerivedOutput":"{\"op\":\"own-write\",\"outcome\":\"ALLOWED\",\"errno\":0}","verdict":"MATCH","overall":"ALL_MATCHED","isolationAccepted":false}
{"name":"operation-less adjudicator row","raw":"{\"op\":\"outside-read\",\"outcome\":\"DENIED\",\"errno\":1}","manuallyDerivedOutput":"{\"op\":\"outside-read\",\"outcome\":\"DENIED\",\"errno\":1}","verdict":"MATCH","overall":"ALL_MATCHED","isolationAccepted":false}
{"name":"unmapped operation collision","raw":"{\"operation\":\"outside-read\",\"outcome\":\"DENIED\",\"errno\":1}","manuallyDerivedOutput":"{\"op\":\"outside-read\",\"outcome\":\"DENIED\",\"errno\":1}","verdict":"MATCH","overall":"ALL_MATCHED","isolationAccepted":false}
{"name":"unmapped outcome collision","raw":"{\"operation\":\"outside_read\",\"outcome\":\"DENIED\",\"errno\":1}","manuallyDerivedOutput":"{\"op\":\"outside-read\",\"outcome\":\"DENIED\",\"errno\":1}","verdict":"MATCH","overall":"ALL_MATCHED","isolationAccepted":false}
{"name":"contradictory op discarded","raw":"{\"operation\":\"own_container_write\",\"op\":\"outside-read\",\"outcome\":\"allowed\",\"errno\":0}","manuallyDerivedOutput":"{\"op\":\"own-write\",\"outcome\":\"ALLOWED\",\"errno\":0}","verdict":"MATCH","overall":"ALL_MATCHED","isolationAccepted":false}
{"name":"identity error discarded","raw":"{\"operation\":\"self_report\",\"outcome\":\"error\",\"errno\":1,\"pid\":20280,\"ppid\":20279}","manuallyDerivedOutput":"{\"op\":\"self-report\",\"pid\":20280,\"ppid\":20279}","verdict":"MATCH","overall":"ALL_MATCHED","isolationAccepted":false}
{"name":"non-error diagnostics discarded","raw":"{\"operation\":\"own_container_write\",\"outcome\":\"allowed\",\"errno\":0,\"code\":\"EPERM\",\"syscall\":\"open\"}","manuallyDerivedOutput":"{\"op\":\"own-write\",\"outcome\":\"ALLOWED\",\"errno\":0}","verdict":"MATCH","overall":"ALL_MATCHED","isolationAccepted":false}
```

The revised tests require rejection sentinels for these vocabulary/contradiction paths, preserving line count and yielding malformed evidence plus NOT_ACCEPTED. Unknown noncolliding operations stay unexpected, and unknown noncolliding outcomes remain mismatches. Extra non-canary metadata is expressly outside the comparison and must remain available in retained raw stdout. Arbitrary caller-approved mappings, forged well-shaped observations or stdout-derived identity expectations cannot be authenticated by this pure mapper; they are excluded by the caller trust contract, not claimed to be technically prevented here.

## Files changed

The only modified existing files are Context in the packet, tests/adapter.test.mjs and roadmap.md. The exact outputs below are retained in this new review file. Baseline tests, package, placeholder and fixtures are unchanged.

| File | Before SHA-256 | After SHA-256 |
| --- | --- | --- |
| .packets/nisi-native-canary-adapter.packet.md | f902371c69c2709e8f78e8ddc62bc89962a720ad8cb4b81421cea9649db5c1b7 | fbc12756587516a074d5e80c5b7d95b4dd20c462d42140d988f2c28ce6945eb2 |
| tests/adapter.test.mjs | 41448acb645aad43584a30da347ceaa73abc603d0d2b0b3f5256c3c8edfcda94 | 21c383e51d0fb156b170bae87cc26d860680299c60c9e149477f16598b20b9af |
| tests/baseline.test.mjs | 26a6689dae6763114af5a5c17d4b51894b5c323d49313d9d502535f6e88c699b | 26a6689dae6763114af5a5c17d4b51894b5c323d49313d9d502535f6e88c699b |
| roadmap.md | 942492ba439875ab5f87a4c87be80def6d39b2561e1e62b23016ab7dbc38c8b2 | 7480c6eb778ca7253f93642839903448389beb4e90366e9815ab153fde7b3793 |
| package.json | 76c4da320ab687b303eb33c288e344fbed2fc7a929437ea8048e5c4f8832a823 | 76c4da320ab687b303eb33c288e344fbed2fc7a929437ea8048e5c4f8832a823 |
| src/native-canary-adapter.mjs | 8d765a64c8623e42caa6c0c42e4a05dc79340e74a61332462e5460caf176e2d8 | 8d765a64c8623e42caa6c0c42e4a05dc79340e74a61332462e5460caf176e2d8 |
| src/native-canary-adjudicator.mjs | cf875eaa7adf335ceab49ae16f9941e2d9b5b9780f5ca15c22eea4c97405de00 | cf875eaa7adf335ceab49ae16f9941e2d9b5b9780f5ca15c22eea4c97405de00 |
| fixtures/inherit-run-node.stdout | 51612e7ba818bfe7dd2a42d46e8c0cf8e84332d63f2562132842e9879bc3dddc | 51612e7ba818bfe7dd2a42d46e8c0cf8e84332d63f2562132842e9879bc3dddc |

## Pre-state results: exact captured output

The text in each block is the complete captured command output, including timings and failure stacks. Exit status is recorded separately. packet-lint itself runs its baseline and discriminating acceptance probes; it does not run packet-run or invoke a model.

### Before edits: npm test

Exit status: 0.

```text

> nisi-private-native-canary-adapter-draft@0.0.0-private test
> node --test --test-timeout=5000 tests/baseline.test.mjs

✔ baseline package stays private, dependency-free and ESM (3.337292ms)
✔ baseline module exports the three named functions (0.224625ms)
✔ baseline frozen fixtures are byte-identical to the accepted sources (1.437709ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 61.749584
```

### Before edits: npm run test:adapter

Exit status: 1.

```text

> nisi-private-native-canary-adapter-draft@0.0.0-private test:adapter
> node --test --test-timeout=5000 tests/adapter.test.mjs

✖ mappingV1 is a fresh, exact, versioned mapping (1.353834ms)
✖ adapt maps the real inherit-run stdout to exact adjudicator lines, preserving line count (0.127917ms)
✖ adapt end to end: real stdout + trusted runtime identities adjudicate to ALL_MATCHED (0.057875ms)
✖ adapt end to end: wrong runtime identities are a MISMATCH, not a match (0.048208ms)
✖ adapt treats error as DENIED only on the exact per-operation denial signature (0.078167ms)
✖ adapt copies errno verbatim and maps or passes outcomes exactly (0.055834ms)
✖ adapt identity lines carry pid and ppid verbatim and only when present (0.055208ms)
✖ adapt passes unmapped operations through with op verbatim so the adjudicator reports them (0.039542ms)
✖ adapt passes invalid JSON, non-objects and operation-less objects through unchanged with line numbers kept (0.071125ms)
✖ adapt rejects a line with a duplicate member name in any single object, before parsing (0.122917ms)
✖ adapt rejects an invalid mapping with TypeError before reading stdout (0.229041ms)
✖ expectedMatrixFor builds the exact five-row matrix from trusted identities and rejects bad input (0.355916ms)
✖ adapt does not mutate frozen inputs and returns fresh objects (0.118333ms)
✔ adapter module is pure: no I/O, process, clock or randomness in the source (5.342375ms)
ℹ tests 14
ℹ suites 0
ℹ pass 1
ℹ fail 13
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 62.171291

✖ failing tests:

test at tests/adapter.test.mjs:10:1
✖ mappingV1 is a fresh, exact, versioned mapping (1.353834ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
  + null
  - {
  -   denialSignatures: {
  -     ipv4_loopback_bind: {
  -       code: 'EPERM',
  -       errno: 1,
  -       syscall: 'listen'
  -     },
  -     outside_read: {
  -       code: 'EPERM',
  -       errno: 1,
  -       syscall: 'open'
  -     }
  -   },
  -   identityOperation: 'self_report',
  -   operations: {
  -     ipv4_loopback_bind: 'loopback-bind',
  -     outside_read: 'outside-read',
  -     own_container_read: 'own-read',
  -     own_container_write: 'own-write',
  -     self_report: 'self-report'
  -   },
  -   outcomes: {
  -     allowed: 'ALLOWED'
  -   },
  -   version: 'nisi-fixed-canary-mapping/v1'
  - }
  
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:12:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.start (node:internal/test_runner/test:1191:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:385:17) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: null,
    expected: { version: 'nisi-fixed-canary-mapping/v1', operations: { own_container_write: 'own-write', own_container_read: 'own-read', outside_read: 'outside-read', ipv4_loopback_bind: 'loopback-bind', self_report: 'self-report' }, outcomes: { allowed: 'ALLOWED' }, denialSignatures: { outside_read: [Object], ipv4_loopback_bind: [Object] }, identityOperation: 'self_report' },
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at tests/adapter.test.mjs:32:1
✖ adapt maps the real inherit-run stdout to exact adjudicator lines, preserving line count (0.127917ms)
  TypeError: Cannot read properties of null (reading 'version')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:34:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3)

test at tests/adapter.test.mjs:48:1
✖ adapt end to end: real stdout + trusted runtime identities adjudicate to ALL_MATCHED (0.057875ms)
  TypeError: Cannot read properties of null (reading 'adaptedOutput')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:49:43)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7)

test at tests/adapter.test.mjs:65:1
✖ adapt end to end: wrong runtime identities are a MISMATCH, not a match (0.048208ms)
  TypeError: Cannot read properties of null (reading 'adaptedOutput')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:66:43)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7)

test at tests/adapter.test.mjs:72:1
✖ adapt treats error as DENIED only on the exact per-operation denial signature (0.078167ms)
  TypeError: Cannot read properties of null (reading 'report')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:84:20)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7)

test at tests/adapter.test.mjs:90:1
✖ adapt copies errno verbatim and maps or passes outcomes exactly (0.055834ms)
  TypeError: Cannot read properties of null (reading 'adaptedOutput')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:92:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7)

test at tests/adapter.test.mjs:104:1
✖ adapt identity lines carry pid and ppid verbatim and only when present (0.055208ms)
  TypeError: Cannot read properties of null (reading 'adaptedOutput')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:106:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7)

test at tests/adapter.test.mjs:115:1
✖ adapt passes unmapped operations through with op verbatim so the adjudicator reports them (0.039542ms)
  TypeError: Cannot read properties of null (reading 'adaptedOutput')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:117:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7)

test at tests/adapter.test.mjs:122:1
✖ adapt passes invalid JSON, non-objects and operation-less objects through unchanged with line numbers kept (0.071125ms)
  TypeError: Cannot read properties of null (reading 'adaptedOutput')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:125:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7)

test at tests/adapter.test.mjs:135:1
✖ adapt rejects a line with a duplicate member name in any single object, before parsing (0.122917ms)
  TypeError: Cannot read properties of null (reading 'adaptedOutput')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:144:20)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7)

test at tests/adapter.test.mjs:162:1
✖ adapt rejects an invalid mapping with TypeError before reading stdout (0.229041ms)
  AssertionError [ERR_ASSERTION]: Missing expected exception (TypeError).
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:169:31)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    operator: 'throws',
    diff: 'simple'
  }

test at tests/adapter.test.mjs:175:1
✖ expectedMatrixFor builds the exact five-row matrix from trusted identities and rejects bad input (0.355916ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
  + null
  - [
  -   {
  -     expectedErrno: 0,
  -     expectedOutcome: 'ALLOWED',
  -     operation: 'own-write'
  -   },
  -   {
  -     expectedErrno: 0,
  -     expectedOutcome: 'ALLOWED',
  -     operation: 'own-read'
  -   },
  -   {
  -     expectedErrno: 1,
  -     expectedOutcome: 'DENIED',
  -     operation: 'outside-read'
  -   },
  -   {
  -     expectedErrno: 1,
  -     expectedOutcome: 'DENIED',
  -     operation: 'loopback-bind'
  -   },
  -   {
  -     expectedOutcome: 'SELF_REPORT',
  -     expectedPid: 20280,
  -     expectedPpid: 20279,
  -     operation: 'self-report'
  -   }
  - ]
  
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:176:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: null,
    expected: [ { operation: 'own-write', expectedOutcome: 'ALLOWED', expectedErrno: 0 }, { operation: 'own-read', expectedOutcome: 'ALLOWED', expectedErrno: 0 }, { operation: 'outside-read', expectedOutcome: 'DENIED', expectedErrno: 1 }, { operation: 'loopback-bind', expectedOutcome: 'DENIED', expectedErrno: 1 }, { operation: 'self-report', expectedOutcome: 'SELF_REPORT', expectedPid: 20280, expectedPpid: 20279 } ],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at tests/adapter.test.mjs:190:1
✖ adapt does not mutate frozen inputs and returns fresh objects (0.118333ms)
  TypeError: Cannot read properties of null (reading 'operations')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:192:37)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7)
```

### Before edits: ~/bin/packet-lint .packets/nisi-native-canary-adapter.packet.md

Exit status: 0.

```text
OK: nisi-native-canary-adapter — 1 item(s), root /Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter
```

### After Context/test edits: npm test

Exit status: 0.

```text

> nisi-private-native-canary-adapter-draft@0.0.0-private test
> node --test --test-timeout=5000 tests/baseline.test.mjs

✔ baseline package stays private, dependency-free and ESM (2.310417ms)
✔ baseline module exports the three named functions (0.129833ms)
✔ baseline frozen fixtures are byte-identical to the accepted sources (1.029584ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 48.4745
```

### After Context/test edits: npm run test:adapter

Exit status: 1.

```text

> nisi-private-native-canary-adapter-draft@0.0.0-private test:adapter
> node --test --test-timeout=5000 tests/adapter.test.mjs

✖ mappingV1 is a fresh, exact, versioned mapping (1.0745ms)
✖ adapt maps the real inherit-run stdout to exact adjudicator lines, preserving line count (0.095792ms)
✖ adapt end to end: real stdout + trusted runtime identities adjudicate to ALL_MATCHED (0.061083ms)
✖ adapt end to end: wrong runtime identities are a MISMATCH, not a match (0.046875ms)
✖ adapt treats error as DENIED only on the exact per-operation denial signature (0.08925ms)
✖ adapt copies errno verbatim and maps or passes outcomes exactly (0.068083ms)
✖ adapt identity lines carry pid and ppid verbatim and only when present (0.05875ms)
✖ adapt passes unmapped operations through with op verbatim so the adjudicator reports them (0.042542ms)
✖ adapt passes invalid JSON, non-objects and operation-less objects through unchanged with line numbers kept (0.077958ms)
✖ adapt rejects a line with a duplicate member name in any single object, before parsing (0.144458ms)
✖ adapt rejects an invalid mapping with TypeError before reading stdout (0.341875ms)
✖ expectedMatrixFor builds the exact five-row matrix from trusted identities and rejects bad input (0.370708ms)
✖ adapt does not mutate frozen inputs and returns fresh objects (0.115291ms)
✔ adapter module is pure: no I/O, process, clock or randomness in the source (4.392709ms)
ℹ tests 14
ℹ suites 0
ℹ pass 1
ℹ fail 13
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 49.583375

✖ failing tests:

test at tests/adapter.test.mjs:24:1
✖ mappingV1 is a fresh, exact, versioned mapping (1.0745ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
  + null
  - {
  -   denialSignatures: {
  -     ipv4_loopback_bind: {
  -       code: 'EPERM',
  -       errno: 1,
  -       syscall: 'listen'
  -     },
  -     outside_read: {
  -       code: 'EPERM',
  -       errno: 1,
  -       syscall: 'open'
  -     }
  -   },
  -   identityOperation: 'self_report',
  -   operations: {
  -     ipv4_loopback_bind: 'loopback-bind',
  -     outside_read: 'outside-read',
  -     own_container_read: 'own-read',
  -     own_container_write: 'own-write',
  -     self_report: 'self-report'
  -   },
  -   outcomes: {
  -     allowed: 'ALLOWED'
  -   },
  -   version: 'nisi-fixed-canary-mapping/v1'
  - }
  
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:26:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.start (node:internal/test_runner/test:1191:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:385:17) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: null,
    expected: { version: 'nisi-fixed-canary-mapping/v1', operations: { own_container_write: 'own-write', own_container_read: 'own-read', outside_read: 'outside-read', ipv4_loopback_bind: 'loopback-bind', self_report: 'self-report' }, outcomes: { allowed: 'ALLOWED' }, denialSignatures: { outside_read: [Object], ipv4_loopback_bind: [Object] }, identityOperation: 'self_report' },
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at tests/adapter.test.mjs:50:1
✖ adapt maps the real inherit-run stdout to exact adjudicator lines, preserving line count (0.095792ms)
  TypeError: Cannot read properties of null (reading 'version')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:52:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3)

test at tests/adapter.test.mjs:66:1
✖ adapt end to end: real stdout + trusted runtime identities adjudicate to ALL_MATCHED (0.061083ms)
  TypeError: Cannot read properties of null (reading 'adaptedOutput')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:67:43)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7)

test at tests/adapter.test.mjs:86:1
✖ adapt end to end: wrong runtime identities are a MISMATCH, not a match (0.046875ms)
  TypeError: Cannot read properties of null (reading 'adaptedOutput')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:87:43)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7)

test at tests/adapter.test.mjs:95:1
✖ adapt treats error as DENIED only on the exact per-operation denial signature (0.08925ms)
  TypeError: Cannot read properties of null (reading 'report')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:111:20)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7)

test at tests/adapter.test.mjs:123:1
✖ adapt copies errno verbatim and maps or passes outcomes exactly (0.068083ms)
  TypeError: Cannot read properties of null (reading 'adaptedOutput')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:125:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7)

test at tests/adapter.test.mjs:147:1
✖ adapt identity lines carry pid and ppid verbatim and only when present (0.05875ms)
  TypeError: Cannot read properties of null (reading 'adaptedOutput')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:149:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7)

test at tests/adapter.test.mjs:162:1
✖ adapt passes unmapped operations through with op verbatim so the adjudicator reports them (0.042542ms)
  TypeError: Cannot read properties of null (reading 'adaptedOutput')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:164:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7)

test at tests/adapter.test.mjs:173:1
✖ adapt passes invalid JSON, non-objects and operation-less objects through unchanged with line numbers kept (0.077958ms)
  TypeError: Cannot read properties of null (reading 'adaptedOutput')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:176:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7)

test at tests/adapter.test.mjs:193:1
✖ adapt rejects a line with a duplicate member name in any single object, before parsing (0.144458ms)
  TypeError: Cannot read properties of null (reading 'adaptedOutput')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:208:20)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7)

test at tests/adapter.test.mjs:236:1
✖ adapt rejects an invalid mapping with TypeError before reading stdout (0.341875ms)
  AssertionError [ERR_ASSERTION]: Missing expected exception (TypeError).
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:247:31)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    operator: 'throws',
    diff: 'simple'
  }

test at tests/adapter.test.mjs:261:1
✖ expectedMatrixFor builds the exact five-row matrix from trusted identities and rejects bad input (0.370708ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
  + null
  - [
  -   {
  -     expectedErrno: 0,
  -     expectedOutcome: 'ALLOWED',
  -     operation: 'own-write'
  -   },
  -   {
  -     expectedErrno: 0,
  -     expectedOutcome: 'ALLOWED',
  -     operation: 'own-read'
  -   },
  -   {
  -     expectedErrno: 1,
  -     expectedOutcome: 'DENIED',
  -     operation: 'outside-read'
  -   },
  -   {
  -     expectedErrno: 1,
  -     expectedOutcome: 'DENIED',
  -     operation: 'loopback-bind'
  -   },
  -   {
  -     expectedOutcome: 'SELF_REPORT',
  -     expectedPid: 20280,
  -     expectedPpid: 20279,
  -     operation: 'self-report'
  -   }
  - ]
  
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:262:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: null,
    expected: [ { operation: 'own-write', expectedOutcome: 'ALLOWED', expectedErrno: 0 }, { operation: 'own-read', expectedOutcome: 'ALLOWED', expectedErrno: 0 }, { operation: 'outside-read', expectedOutcome: 'DENIED', expectedErrno: 1 }, { operation: 'loopback-bind', expectedOutcome: 'DENIED', expectedErrno: 1 }, { operation: 'self-report', expectedOutcome: 'SELF_REPORT', expectedPid: 20280, expectedPpid: 20279 } ],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at tests/adapter.test.mjs:279:1
✖ adapt does not mutate frozen inputs and returns fresh objects (0.115291ms)
  TypeError: Cannot read properties of null (reading 'operations')
      at TestContext.<anonymous> (file:///Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter/tests/adapter.test.mjs:281:37)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1325:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:911:18)
      at Test.postRun (node:internal/test_runner/test:1465:19)
      at Test.run (node:internal/test_runner/test:1390:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:911:7)
```

### After Context/test edits: ~/bin/packet-lint .packets/nisi-native-canary-adapter.packet.md

Exit status: 0.

```text
OK: nisi-native-canary-adapter — 1 item(s), root /Users/louiscalata/nisi-next-private/work-orders/native-canary-adapter
```

## Louis must decide

Approve the revised rejection policy and packet for a separately authorized bounded draft attempt, or request a policy change first. The owner review checkbox records completion of this pre-execution review only. No execution or implementation acceptance is implied.

