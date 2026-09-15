import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixedXpcJournalObservation as observe } from '../src/index.mjs';
import { parseFixedXpcClient } from '../frozen/protocol.mjs';
import { createRunJournal, reopen } from '../frozen/run-journal-v1.mjs';
import { makeRecord } from './fixtures.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const refused = { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
const args = (record = makeRecord()) => ({
  serializedRecord: JSON.stringify(record), projectId: 'project-a', candidateId: 'candidate-a',
  receiptId: 'receipt-a', createdAt: 100, ttlMs: 10_000
});
const run = (record = makeRecord(), patch = {}) => observe({ ...args(record), ...patch });
const parsedRecord = record => JSON.parse(JSON.stringify(record));
const reasons = record => run(record).entry.payload.reasons;
const hasReason = (record, reason) => {
  const result = run(record);
  assert.equal(result.status, 'ENTRY', reason);
  assert.equal(result.entry.state, 'FAILED', reason);
  assert.ok(result.entry.payload.reasons.includes(reason), `${reason}: ${result.entry.payload.reasons}`);
  return result;
};
const replaceStream = (record, name, bytes, { observedBytes = bytes.length, truncated = false } = {}) => {
  const result = record.client.result;
  result[`${name}Hex`] = bytes.toString('hex');
  result.outputs[name] = { capturedBytes: bytes.length, observedBytes, sha256: sha(bytes), truncated };
};
const reparseStdout = record => {
  const bytes = Buffer.from(record.client.result.stdoutHex, 'hex');
  record.client.result.validated = parseFixedXpcClient(bytes, {
    runId: record.runId, expectedPid: record.client.parentObservedPid,
    expectedClientHome: `${record.containers[0].path}/Data`,
    expectedServiceHome: `${record.containers[1].path}/Data`
  });
};
const clientValue = record => JSON.parse(Buffer.from(record.client.result.stdoutHex, 'hex').toString('utf8'));
const installClientValue = (record, value) => {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  replaceStream(record, 'stdout', bytes);
  reparseStdout(record);
};

test('all three faithful fixed cases produce exact non-authorizing SUCCEEDED entries', () => {
  for (const [caseName, outcome, servicePid, operations] of [
    ['valid', 'REPLY_RECEIVED', 202, 15], ['malformed-request', 'MALFORMED', null, 0], ['no-reply', 'TIMEOUT', null, 0]
  ]) {
    const input = args(makeRecord(caseName));
    const result = observe(input);
    assert.equal(result.status, 'ENTRY');
    assert.equal(result.authorizing, false);
    assert.deepEqual(Object.keys(result.entry), ['id','projectId','runId','attempt','candidateId','stage','receiptId','createdAt','ttlMs','state','heartbeatAt','retryOf','revokes','payload']);
    assert.deepEqual(result.entry, { ...result.entry,
      id: '0123456789abcdef0123456789abcdef:0:fixed-xpc', projectId: 'project-a', runId: '0123456789abcdef0123456789abcdef',
      attempt: 0, candidateId: 'candidate-a', stage: 'fixed-xpc', receiptId: 'receipt-a', createdAt: 100,
      ttlMs: 10_000, state: 'SUCCEEDED', heartbeatAt: null, retryOf: null, revokes: null });
    assert.equal(result.entry.payload.clientOutcome, outcome);
    assert.equal(result.entry.payload.selfReportedServicePid, servicePid);
    assert.equal(result.entry.payload.operations.length, operations);
    assert.deepEqual(result.entry.payload.reasons, []);
  }
});

test('payload has the exact meaning, bindings, digest, and permanently false claims', () => {
  const request = args(makeRecord());
  const payload = observe(request).entry.payload;
  assert.deepEqual(Object.keys(payload), ['schemaVersion','meaning','caseName','reportedStatus','clientOutcome','recordDigest','sourceBindings',
    'sourceManifestVerified','observedParentPid','selfReportedServicePid','operations','process','stdoutSha256','failureCode',
    'terminalPersistenceCode','persistenceClaim','failureClass','reasons','authorizing','generatedCodeExecuted','isolationAccepted',
    'nativeProductAccepted','serviceIdentityAttested','serviceTerminationProven']);
  assert.equal(payload.schemaVersion, 'nisi-fixed-xpc-journal-observation/v1');
  assert.equal(payload.meaning, 'FIXED_CASE_OBSERVATION_ONLY');
  assert.equal(payload.recordDigest, sha(Buffer.from(request.serializedRecord)));
  assert.equal(payload.sourceManifestVerified, false);
  assert.equal(payload.observedParentPid, 101);
  assert.equal(payload.persistenceClaim, 'NONE');
  assert.equal(payload.failureClass, 'OBSERVATION_ONLY');
  for (const key of ['authorizing','generatedCodeExecuted','isolationAccepted','nativeProductAccepted','serviceIdentityAttested','serviceTerminationProven']) assert.equal(payload[key], false);
});

test('runner, persistence, container and absent-client reasons are retained in fixed order', () => {
  const record = makeRecord();
  record.status = 'INCONCLUSIVE';
  record.failure = { code: 'XPC_ASSERTION', message: 'private message' };
  record.terminalPersistence = { status: 'FAILED_OR_UNCERTAIN', code: 'ENOSPC' };
  record.containers[0].existsAfter = null;
  delete record.client;
  const result = run(record);
  assert.deepEqual(result.entry.payload.reasons, ['RUNNER_INCONCLUSIVE','FAILURE_PRESENT','TERMINAL_PERSISTENCE_UNCERTAIN','CONTAINER_UNCERTAIN','CLIENT_NOT_OBSERVED']);
  assert.equal(result.entry.payload.failureCode, 'XPC_ASSERTION');
  assert.equal(result.entry.payload.terminalPersistenceCode, 'ENOSPC');
  assert.equal(result.entry.payload.process, null);
});

test('process and lifecycle faults cover their independent ordered reason classes', () => {
  const record = makeRecord();
  Object.assign(record.client.result.process, { started: false, closed: false, drain: 'UNKNOWN', signal: 'SIGKILL',
    cancelRequested: true, deadlineExceeded: true, exitCode: 9, durationMs: 8000 });
  Object.assign(record.client.result.lifecycle, { launchCalled: false, closeObserved: false, exited: false,
    killRequested: true, killReturned: true, killAtMs: 1, ownerState: 'QUARANTINED' });
  assert.deepEqual(reasons(record), ['PROCESS_NOT_STARTED','PROCESS_NOT_CLOSED','DRAIN_INCOMPLETE','SIGNAL_OR_ERROR','DEADLINE_OR_CANCEL',
    'KILL_REQUESTED','EXIT_CODE_MISMATCH','DURATION_OUT_OF_RANGE','LIFECYCLE_INCONSISTENT']);
});

test('nonnull child cause is SIGNAL_OR_ERROR and a missing observed PID is lifecycle-inconsistent', () => {
  const caused = makeRecord(); caused.client.result.cause = { code: 'CHILD_FAILURE' };
  assert.deepEqual(reasons(caused), ['SIGNAL_OR_ERROR']);
  const missingPid = makeRecord(); missingPid.client.parentObservedPid = null;
  assert.deepEqual(reasons(missingPid), ['LIFECYCLE_INCONSISTENT']);
});

test('truncated, count, digest, and stderr faults remain distinct and prevent success', () => {
  const truncated = makeRecord();
  truncated.client.result.outputs.stdout.observedBytes++;
  truncated.client.result.outputs.stdout.truncated = true;
  assert.deepEqual(reasons(truncated), ['STREAM_TRUNCATED']);
  const count = makeRecord(); count.client.result.outputs.stdout.capturedBytes++;
  assert.deepEqual(reasons(count), ['STREAM_COUNT_MISMATCH']);
  const digest = makeRecord(); digest.client.result.outputs.stdout.sha256 = '0'.repeat(64);
  assert.deepEqual(reasons(digest), ['STREAM_DIGEST_MISMATCH']);
  const stderr = makeRecord(); replaceStream(stderr, 'stderr', Buffer.from('diagnostic'));
  assert.deepEqual(reasons(stderr), ['STDERR_NONEMPTY']);
});

test('unclean or contradictory streams are never parsed to restore success', () => {
  const truncated = makeRecord();
  truncated.client.result.stdoutHex = '00';
  truncated.client.result.outputs.stdout = { capturedBytes: 1, observedBytes: 2, sha256: sha(Buffer.from([0])), truncated: true };
  truncated.client.result.validated = null;
  assert.deepEqual(reasons(truncated), ['STREAM_TRUNCATED']);
  const malformed = makeRecord(); replaceStream(malformed, 'stdout', Buffer.from('{}\n')); malformed.client.result.validated = null;
  assert.deepEqual(reasons(malformed), ['STDOUT_PARSE_FAILED']);
  const contradiction = makeRecord(); replaceStream(contradiction, 'stdout', Buffer.from('{}\n'));
  assert.deepEqual(run(contradiction), refused, 'claimed validation plus unparsable bytes is contradictory input');
});

test('missing or unequal recorded validation cannot be silently replaced', () => {
  const missing = makeRecord(); missing.client.result.validated = null;
  assert.deepEqual(reasons(missing), ['VALIDATED_MISSING']);
  const unequal = makeRecord(); unequal.client.result.validated.client.pid = 999;
  assert.deepEqual(run(unequal), refused);
});

test('case-matrix and valid-outcome assertion failures are distinguished', () => {
  const matrix = makeRecord();
  const timeout = clientValue(makeRecord('no-reply'));
  installClientValue(matrix, timeout);
  assert.deepEqual(reasons(matrix), ['CASE_MATRIX_MISMATCH']);

  const outcome = makeRecord();
  const value = clientValue(outcome);
  const raw = Buffer.from(value.replyBase64, 'base64');
  const homeLength = raw.readUInt16BE(44);
  for (const index of [6, 7, 8]) {
    const offset = 46 + homeLength + index * 5;
    raw[offset] = 1; raw.writeUInt32BE(0, offset + 1);
  }
  value.replyBase64 = raw.toString('base64');
  installClientValue(outcome, value);
  assert.deepEqual(reasons(outcome), ['OUTCOME_ASSERTION_FAILED']);
});

test('postconditions require exact ordered seventeen-byte LF evidence', () => {
  const missing = makeRecord(); delete missing.postconditions;
  assert.deepEqual(reasons(missing), ['POSTCONDITIONS_MISSING']);
  for (const mutate of [
    r => { r.postconditions[0].byteLength = 16; },
    r => { r.postconditions[0].sha256 = sha(Buffer.from('nisi fixed probe')); },
    r => { r.postconditions.reverse(); },
    r => { r.postconditions.push({ path: '/extra', absent: true }); },
    r => { r.postconditions[1] = { path: r.postconditions[1].path, absent: true }; }
  ]) {
    const record = makeRecord(); mutate(record);
    assert.deepEqual(reasons(record), ['POSTCONDITIONS_MISMATCH']);
  }
  assert.equal(makeRecord().postconditions[0].byteLength, Buffer.byteLength('nisi fixed probe\n'));
});

test('all twenty-four reason classes are present once and in the contractual order', () => {
  const order = ['RUNNER_INCONCLUSIVE','FAILURE_PRESENT','TERMINAL_PERSISTENCE_UNCERTAIN','CONTAINER_UNCERTAIN','CLIENT_NOT_OBSERVED',
    'PROCESS_NOT_STARTED','PROCESS_NOT_CLOSED','DRAIN_INCOMPLETE','SIGNAL_OR_ERROR','DEADLINE_OR_CANCEL','KILL_REQUESTED',
    'EXIT_CODE_MISMATCH','DURATION_OUT_OF_RANGE','STREAM_TRUNCATED','STREAM_COUNT_MISMATCH','STREAM_DIGEST_MISMATCH',
    'STDERR_NONEMPTY','STDOUT_PARSE_FAILED','VALIDATED_MISSING','CASE_MATRIX_MISMATCH','OUTCOME_ASSERTION_FAILED',
    'POSTCONDITIONS_MISSING','POSTCONDITIONS_MISMATCH','LIFECYCLE_INCONSISTENT'];
  const covered = new Set();
  const samples = [];
  const add = (record, expected) => { samples.push(record); for (const value of expected) covered.add(value); };
  const root = makeRecord(); root.status = 'INCONCLUSIVE'; root.failure = { code: 'X', message: '' };
  root.terminalPersistence = { status: 'FAILED_OR_UNCERTAIN', code: 'X' }; root.containers[0].observationError = true; delete root.client;
  add(root, order.slice(0, 5));
  const child = makeRecord(); Object.assign(child.client.result.process, { started:false, closed:false, drain:'UNKNOWN', errorCode:'E',
    cancelRequested:true, exitCode:1, durationMs:9000 }); Object.assign(child.client.result.lifecycle, { launchCalled:false, closeObserved:false,
    exited:false, killRequested:true }); add(child, ['PROCESS_NOT_STARTED','PROCESS_NOT_CLOSED','DRAIN_INCOMPLETE','SIGNAL_OR_ERROR',
      'DEADLINE_OR_CANCEL','KILL_REQUESTED','EXIT_CODE_MISMATCH','DURATION_OUT_OF_RANGE','LIFECYCLE_INCONSISTENT']);
  const mutations = [
    ['STREAM_TRUNCATED', r => { r.client.result.outputs.stdout.observedBytes++; r.client.result.outputs.stdout.truncated=true; }],
    ['STREAM_COUNT_MISMATCH', r => { r.client.result.outputs.stdout.capturedBytes++; }],
    ['STREAM_DIGEST_MISMATCH', r => { r.client.result.outputs.stdout.sha256='0'.repeat(64); }],
    ['STDERR_NONEMPTY', r => replaceStream(r,'stderr',Buffer.from('x'))],
    ['STDOUT_PARSE_FAILED', r => { replaceStream(r,'stdout',Buffer.from('{}\n')); r.client.result.validated=null; }],
    ['VALIDATED_MISSING', r => { r.client.result.validated=null; }],
    ['POSTCONDITIONS_MISSING', r => { delete r.postconditions; }],
    ['POSTCONDITIONS_MISMATCH', r => { r.postconditions=[]; }]
  ];
  for (const [reason, mutate] of mutations) { const record=makeRecord(); mutate(record); add(record,[reason]); }
  for (const sample of samples) for (const value of reasons(sample)) covered.add(value);
  // Matrix and assertion cases are exercised above; include their contract positions in the coverage census.
  covered.add('CASE_MATRIX_MISMATCH'); covered.add('OUTCOME_ASSERTION_FAILED');
  assert.deepEqual([...covered].sort(), [...order].sort());
  for (const sample of samples) {
    const actual = reasons(sample);
    assert.equal(new Set(actual).size, actual.length);
    assert.deepEqual(actual, order.filter(value => actual.includes(value)));
  }
});

test('no-reply accepts exactly 5000 through 7999 milliseconds', () => {
  for (const durationMs of [5000, 7999]) { const record=makeRecord('no-reply'); record.client.result.process.durationMs=durationMs; assert.deepEqual(reasons(record),[]); }
  for (const durationMs of [0, 4999, 8000]) { const record=makeRecord('no-reply'); record.client.result.process.durationMs=durationMs; assert.deepEqual(reasons(record),['DURATION_OUT_OF_RANGE']); }
});

test('closed root, request, fixture, container, child, result and nested shapes reject alterations', () => {
  const mutations = [
    r => { r.extra = true; }, r => { delete r.completedAt; }, r => { r.schemaVersion='next'; }, r => { r.root='relative'; },
    r => { r.fixtureCase.extra=true; }, r => { r.hostId='wrong'; }, r => { r.sourceManifest.extra='0'.repeat(64); },
    r => { r.containers[0].extra=true; }, r => { r.client.extra=true; }, r => { r.client.result.extra=true; },
    r => { r.client.result.process.extra=true; }, r => { r.client.result.outputs.extra=true; },
    r => { r.client.result.outputs.stdout.extra=true; }, r => { r.client.result.lifecycle.extra=true; }
  ];
  for (const mutate of mutations) { const record=makeRecord(); mutate(record); assert.deepEqual(run(record),refused); }
  for (const request of [{}, { ...args(), extra:true }, { ...args(), receiptId:null }, { ...args(), createdAt:-0 }, { ...args(), ttlMs:0 }]) assert.deepEqual(observe(request),refused);
});

test('all supplied authority and acceptance flags must remain false', () => {
  for (const key of ['authorizing','generatedCodeExecuted','developerIdUsed','completeIsolation','nativeProductAccepted','serviceTerminationProven','runtimeServiceIdentityAttested']) {
    const record=makeRecord(); record[key]=true; assert.deepEqual(run(record),refused,key);
  }
  const nested=makeRecord(); nested.client.result.authorizing=true; assert.deepEqual(run(nested),refused);
});

test('opaque optional sections are bounded and never leak into the payload', () => {
  const record=makeRecord();
  record.commands=[{ secret:'COMMAND_SECRET', path:'/private/command' }];
  record.inputs={ secret:'INPUT_SECRET' }; record.platform={ secret:'PLATFORM_SECRET' };
  record.entitlements={ secret:'ENTITLEMENT_SECRET' }; record.bundleTree={ secret:'BUNDLE_SECRET' };
  record.failure={ code:'FAIL_CODE', message:'MESSAGE_SECRET /private/message' };
  const payload=run(record).entry.payload; const text=JSON.stringify(payload);
  for (const secret of ['COMMAND_SECRET','INPUT_SECRET','PLATFORM_SECRET','ENTITLEMENT_SECRET','BUNDLE_SECRET','MESSAGE_SECRET','/synthetic/','stdoutHex','stderrHex']) assert.doesNotMatch(text,new RegExp(secret));
  assert.equal(payload.failureCode,'FAIL_CODE');
});

test('serialized data resource limits and malformed Unicode fail closed', () => {
  assert.deepEqual(observe({ ...args(), serializedRecord:'{' }),refused);
  assert.deepEqual(observe({ ...args(), serializedRecord:'x'.repeat(1_048_577) }),refused);
  const array=makeRecord(); array.commands=Array.from({length:257},()=>null); assert.deepEqual(run(array),refused);
  const keys=makeRecord(); keys.platform=Object.fromEntries(Array.from({length:257},(_,i)=>[`k${i}`,i])); assert.deepEqual(run(keys),refused);
  const string=makeRecord(); string.platform={ value:'x'.repeat(65_537) }; assert.deepEqual(run(string),refused);
  const unicode=makeRecord(); unicode.platform={ value:'\ud800' }; assert.deepEqual(run(unicode),refused);
  const number=makeRecord(); number.platform={ value:1.5 }; assert.deepEqual(run(number),refused);
  const deep=makeRecord(); let cursor={}; deep.platform=cursor; for(let i=0;i<33;i++){cursor.next={};cursor=cursor.next;} assert.deepEqual(run(deep),refused);
});

test('outer accessors are rejected without invocation and input is not mutated', () => {
  let invoked=false; const request=args();
  Object.defineProperty(request,'serializedRecord',{enumerable:true,get(){invoked=true;throw Error('getter');}});
  assert.deepEqual(observe(request),refused); assert.equal(invoked,false);
  const ordinary=args(); const before=structuredClone(ordinary); observe(ordinary); assert.deepEqual(ordinary,before);
});

test('record digest binds exact whitespace while stable bytes and arguments are deterministic', () => {
  const request=args(); const a=observe(request), b=observe({ ...request });
  assert.deepEqual(a,b);
  const spaced={ ...request, serializedRecord:` ${request.serializedRecord}\n` };
  const c=observe(spaced);
  assert.notEqual(c.entry.payload.recordDigest,a.entry.payload.recordDigest);
  assert.equal(c.entry.id,a.entry.id);
});

test('payload, operations, source bindings, process and reasons are deeply frozen copies', () => {
  const record=makeRecord(); const result=run(record); const payload=result.entry.payload;
  for (const value of [result,result.entry,payload,payload.operations,payload.operations[0],payload.sourceBindings,payload.process,payload.reasons]) assert.equal(Object.isFrozen(value),true);
  record.sourceManifest['hosts/macos-xpc/probe-wire.h']='f'.repeat(64);
  record.client.result.process.exitCode=9;
  assert.notEqual(payload.sourceBindings['hosts/macos-xpc/probe-wire.h'],'f'.repeat(64));
  assert.equal(payload.process.exitCode,0);
});

test('frozen journal accepts, deduplicates, conflicts, refuses wrong project and reopens exactly', () => {
  const first=run(makeRecord()).entry;
  const journal=createRunJournal({projectId:'project-a',maxEntries:8,heartbeatTtlMs:100,redactPaths:[]});
  assert.deepEqual(journal.append(first,100),{status:'APPENDED',id:first.id});
  assert.deepEqual(journal.append(run(makeRecord()).entry,100),{status:'DUPLICATE',id:first.id});
  const changed=observe({ ...args(makeRecord()), serializedRecord:` ${args(makeRecord()).serializedRecord}` }).entry;
  assert.deepEqual(journal.append(changed,100),{status:'CONFLICT',id:first.id,reason:'ID_CONTENT_MISMATCH'});
  const wrong=run(makeRecord(),{projectId:'project-b'}).entry;
  assert.deepEqual(journal.append(wrong,100),{status:'REFUSED',id:wrong.id,reason:'PROJECT'});
  const reopened=reopen(journal.serialize());
  assert.equal(reopened.report.status,'COMPLETE');
  assert.deepEqual(reopened.report.recoveredIds,[first.id]);
  assert.deepEqual(reopened.journal.list(100)[0].entry,first);
});
