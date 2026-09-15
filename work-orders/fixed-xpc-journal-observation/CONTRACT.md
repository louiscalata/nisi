# Fixed XPC journal observation — private contract v1

Overall Nisi milestone progress: 30% (3/10). This isolated pure-data bridge is not
integrated, not a native run, not a store, and not incident admission.

## API and scope

Export synchronous fixedXpcJournalObservation(input) from src/index.mjs.
Exact ordinary-data request keys: serializedRecord,projectId,candidateId,receiptId,createdAt,ttlMs.
serializedRecord is well-formed Unicode JSON text <=1048576 UTF-8 bytes.
IDs match /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/; receiptId must be an ID, not null.
createdAt is nonnegative safe integer excluding -0; ttlMs positive safe integer,
createdAt+ttlMs safe. No coercion, I/O, clocks, model calls or execution.
Reject non-data property descriptors at the outer request WITHOUT invoking getters.
Parse JSON then bound depth <=32, node count <=20000, every array <=256 (except
commands may still only256), object <=256 keys, string <=65536 code units,
all strings well-formed and all numbers safe integers excluding -0. These resource
limits also apply to opaque ignored metadata. Do not mutate request.
Any malformed/unsupported/binding-contradictory/flag-true input returns exactly
{status:'REFUSED',reason:'INVALID_INPUT',authorizing:false}. No throws.

Record root required fields:
schemaVersion,createdAt,status,root,runId,caseName,fixtureCase,hostId,serviceId,
sourceManifest,containers,commands,authorizing,generatedCodeExecuted,developerIdUsed,
completeIsolation,nativeProductAccepted,serviceTerminationProven,
runtimeServiceIdentityAttested,completedAt.
Optional ONLY inputs,platform,entitlements,bundleTree,client,postconditions,failure,terminalPersistence.
schemaVersion exactly nisi-fixed-private-xpc-run-v1; status only
FIXED_XPC_CASE_OBSERVED|INCONCLUSIVE. Record timestamps canonical ISO UTC strings,
created <= completed. runId exactly32lowercasehex.
All seven authority/acceptance fields MUST be false, not absent.
Root is absolute slash-separated nonempty well-formed text <=1024 bytes, no NUL,
trailing slash or dot/dotdot segment. Used ONLY for text binding, never filesystem.
hostId/serviceId exactly local.nisi.xpcprobe.host.rRUNID / .service.rRUNID.
fixtureCase exact {id,status,exitCode} and equal case table:
valid:0,REPLY_RECEIVED,0; malformed-request:1,MALFORMED,70; no-reply:2,TIMEOUT,70.
Unknown case refused, including inherited names.
sourceManifest exact10 keys from frozen sourceNames below, values lowercase64hex.
These bindings are supplied, not verified local source identity.

Containers exactly2 objects in host/service order with exact path,existedBefore,
existsAfter,removed, optional observationError. path absolute as above, final
component must equal corresponding hostId/serviceId; paths distinct.
existedBefore/removed exactlyfalse; existsAfter null|boolean; observationError
when present exactlytrue. Only uncertain observations (null or observationError)
add CONTAINER_UNCERTAIN; true/false existsAfter both allowed, no cleanup claim.
commands array bounded as above; inputs/platform/entitlements/bundleTree if
present are objects. Their contents are opaque bounded JSON, ignored and not
evidence of build, signing or authorization. Unknown root keys refused.
failure if present exact {code,message}, code /^[A-Za-z0-9_]{1,96}$/,
message bounded string; only code is emitted, never message.
terminalPersistence if present exact {status:'FAILED_OR_UNCERTAIN',code} with
same bounded code. Absence is NOT evidence of persistence: always NONE claim.

## Child evidence

If client absent, add CLIENT_NOT_OBSERVED, no child checks. Otherwise exact
{parentObservedPid,expectedExitCode,executableSha256,result}. PID null or integer
1..2147483647, expectedExitCode exactly the case table, executableSha25664hex.
result exact schemaVersion,process,outputs,stdoutHex,stderrHex,cause,validated,lifecycle,authorizing.
schemaVersion1 and authorizingfalse.
process exact started,closed,drain,exitCode,signal,errorCode,cancelRequested,deadlineExceeded,durationMs.
booleans required; drain CONFIRMED|UNKNOWN|NOT_APPLICABLE; exitCode null or
integer0..255; signal/errorCode null or bounded96-char code /^[A-Za-z0-9_]+$/;
durationMs nonnegative safe integer. cause null or bounded ordinary object
(opaque metadata, its details never copied).
lifecycle exact operation,launchCalled,closeObserved,exited,killRequested,killReturned,
killAtMs,ownerState,directChildOnly; operation positive safe integer; launchCalled,
closeObserved,exited,killRequested booleans; killReturned null|boolean;
killAtMs null or nonnegative safe integer; ownerState IDLE|QUARANTINED;
directChildOnly exactlytrue (this does not prove descendant/service termination).
outputs exact stdout/stderr. Each exact capturedBytes,observedBytes,sha256,truncated:
counts nonnegative safe integers, captured <=16384, digest64hex, truncated boolean.
Hex lowercase even-length <=32768 chars. Recompute hashes of actual decoded
bytes; STREAM_COUNT_MISMATCH means captured differs from actual byte length,
observed is less than captured, or truncated differs from observed > captured.
A consistent truncation adds only STREAM_TRUNCATED. Parsing requires both
counts equal actual length and truncated false, with matching digests.
Never parse truncated/digest-mismatched streams.
Nonempty stderr blocks success. validated null or {client,reply}; contents
ultimately must equal result of authoritative raw parser to support success.

When clean streams and positive PID available, call frozen parseFixedXpcClient
with raw stdout and expected runId, observedPID, container[0].path+'/Data',
container[1].path+'/Data'. If parse throws and recorded validated is nonnull,
REFUSE contradictory claimed validated data; otherwise STDOUT_PARSE_FAILED.
When parsing succeeds and recorded validated is nonnull but not deeply equal,
REFUSE. If recorded validated is null, add VALIDATED_MISSING (parsed client can
be copied as observation but cannot restore SUCCEEDED).
Check parsed client.status case matrix; valid case frozen assertFixedXpcOutcomes,
negative cases reply null + replyBase64 empty. Parser already validates run/PID/
home/15-row structure; do not reimplement the binary protocol.

## Postconditions

Absent postconditions -> POSTCONDITIONS_MISSING. Present must array; exact three
entries in runner order, compared against:
{path:root+'/outside-canary.txt',byteLength:17,sha256:hash('nisi fixed probe' + LF)}
valid second: {path:serviceHome+'/nisi-fixed-probe.txt',byteLength:17,same sha256}
negative second: {path:serviceHome+'/nisi-fixed-probe.txt',absent:true}
third: {path:root+'/outside-write.txt',absent:true}.
Any mismatch, extras/reordering/duplicates -> POSTCONDITIONS_MISMATCH.
No external stat/read, and never emit paths or claim these postconditions were
independently observed by this projector.

## Reasons in fixed order, all applicable checks, no duplicates

RUNNER_INCONCLUSIVE, FAILURE_PRESENT, TERMINAL_PERSISTENCE_UNCERTAIN,
CONTAINER_UNCERTAIN, CLIENT_NOT_OBSERVED, PROCESS_NOT_STARTED, PROCESS_NOT_CLOSED,
DRAIN_INCOMPLETE, SIGNAL_OR_ERROR, DEADLINE_OR_CANCEL, KILL_REQUESTED,
EXIT_CODE_MISMATCH, DURATION_OUT_OF_RANGE, STREAM_TRUNCATED,
STREAM_COUNT_MISMATCH, STREAM_DIGEST_MISMATCH, STDERR_NONEMPTY,
STDOUT_PARSE_FAILED, VALIDATED_MISSING, CASE_MATRIX_MISMATCH,
OUTCOME_ASSERTION_FAILED, POSTCONDITIONS_MISSING, POSTCONDITIONS_MISMATCH,
LIFECYCLE_INCONSISTENT.
SIGNAL_OR_ERROR includes any nonnull cause. Duration must0..7999 inclusive;
no-reply5000..7999. Client TIMEOUT is an expected negative observation; runner
deadline/cancel/kill is never accepted as that expected timeout.
LIFECYCLE_INCONSISTENT: launchCalled,closeObserved,exited not all true;
ownerState not IDLE; started but parentObservedPid null; process started differs
from launchCalled, or closed differs from closeObserved.
Check each reason independently when client present, but do not parse until
streams clean and PID positive. Missing child skips child-derived reasons.
No reason means journal SUCCEEDED; otherwise FAILED. FAILED is inability to
qualify the FIXED observation, NOT a proven task/model failure.

## Exact output

{status:'ENTRY',entry,authorizing:false}; entry exact:
{id:runId+':0:fixed-xpc',projectId,runId,attempt:0,candidateId,stage:'fixed-xpc',
receiptId,createdAt,ttlMs,state,heartbeatAt:null,retryOf:null,revokes:null,payload}.

Payload exact:
{schemaVersion:'nisi-fixed-xpc-journal-observation/v1',
meaning:'FIXED_CASE_OBSERVATION_ONLY',caseName,reportedStatus,
clientOutcome:parsed?.client.status??null,
recordDigest:sha256(exact serializedRecord UTF8),sourceBindings:copied sourceManifest,
sourceManifestVerified:false,observedParentPid:client?.parentObservedPid??null,
selfReportedServicePid:parsed?.reply?.servicePidSelfReported??null,
operations:parsed?.reply?.rows copied or [],
process:copied process object or null,stdoutSha256:actual recomputed digest or null,
failureCode:failure?.code??null,terminalPersistenceCode:terminalPersistence?.code??null,
persistenceClaim:'NONE',failureClass:'OBSERVATION_ONLY',reasons,
authorizing:false,generatedCodeExecuted:false,isolationAccepted:false,
nativeProductAccepted:false,serviceIdentityAttested:false,serviceTerminationProven:false}.
No root/home/container/raw streams/commands/arbitrary message leakage.
Nested output deeply frozen; no references to parsed input that callers can change.
Same serialized bytes+args produce same entry; changed metadata or whitespace
changes recordDigest and may cause journal CONFLICT under same ID. Projector
does not dedupe, persist, revoke, resume, authenticate evidence or infer eligibility.

Allowed source imports: node:crypto, node:util, ../frozen/protocol.mjs only.
Frozen run journal is for compatibility tests, not invoked by the projector.
Known source names (exact):
hosts/macos-xpc/probe-wire.h
hosts/macos-xpc/probe-service.m
hosts/macos-xpc/probe-client.m
hosts/macos-xpc/protocol.mjs
hosts/macos-xpc/fixed-xpc-runner.mjs
hosts/swift-verifier/owned-child.mjs
hosts/swift-verifier/protocol.mjs
workflow/contracts.mjs
canonical/canonical-json-v1.mjs
hosts/repository/snapshot-contract.mjs

## Required checks and integration gate

npm test: baseline; npm run test:observation: independent oracles.
Cover all three cases, every reason class, identity/false-flag rejection,
raw digest/count/truncation contradictions, limits, no getter invocation,
redaction/no path leakage, deep freeze, deterministic journal duplicate/conflict,
serialize/reopen and wrong-project refusal.
Before promotion target deliberate reader mutants and record failed-test counts.
A source-bound independent review is required. This new reader is risk-sensitive
and uses direct reviewed implementation, not an OpenCode-authorized correctness
decision. Mechanical packaging can be packetized later.
No native commands, storage writer, canonical bundle/runner or existing tests
are modified. Full merger, host correction, durability and release remain open.
