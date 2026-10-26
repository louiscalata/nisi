import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { summarizeFixedRun as summarize } from '../src/native-canary-summary.mjs';

const RECEIPT = JSON.parse(await readFile(new URL('../fixtures/inherit-run-service-raw.json', import.meta.url), 'utf8'));
const STDOUT = await readFile(new URL('../fixtures/inherit-run-node.stdout', import.meta.url), 'utf8');
const TABLE = 'Fixed canary adjudication\nOverall: ALL_MATCHED\nRows:\n'
  + '- own-write: expected ALLOWED errno 0, observed ALLOWED (errno 0) -> MATCH\n'
  + '- own-read: expected ALLOWED errno 0, observed ALLOWED (errno 0) -> MATCH\n'
  + '- outside-read: expected DENIED errno 1, observed DENIED (errno 1) -> MATCH\n'
  + '- loopback-bind: expected DENIED errno 1, observed DENIED (errno 1) -> MATCH\n'
  + '- self-report: expected SELF_REPORT, observed pid 20280 ppid 20279 -> MATCH\n'
  + 'Malformed lines: 0\nUnexpected operations: none\n\n'
  + 'Isolation acceptance is not established by this table.\n';
const LIFECYCLE_KEYS = ['spawnReturn', 'exitCode', 'signal', 'rawWaitStatus', 'stdoutEOF', 'stderrEOF', 'drainObserved', 'waitObserved', 'timeout', 'outputCapExceeded'];

test('summary of the real inherit run is OBSERVED with the exact adjudicated table', () => {
  const s = summarize(RECEIPT, STDOUT);
  assert.deepEqual(Object.keys(s), ['schemaVersion', 'identity', 'lifecycle', 'gate', 'reasons', 'adaptation', 'adjudication', 'table', 'overall', 'isolationAccepted', 'generatedCodeExecuted', 'authorizing']);
  assert.equal(s.schemaVersion, 'nisi-fixed-run-summary/v1');
  assert.deepEqual(s.identity, { childPid: 20280, servicePid: 20279, waitObservedPid: 20280 });
  assert.deepEqual(s.lifecycle, { spawnReturn: 0, exitCode: 0, signal: null, rawWaitStatus: 0, stdoutEOF: true, stderrEOF: true,
    drainObserved: true, waitObserved: true, timeout: false, outputCapExceeded: false });
  assert.equal(s.gate, 'RUN_COMPLETE');
  assert.deepEqual(s.reasons, []);
  assert.equal(s.adaptation.version, 'nisi-fixed-canary-mapping/v1');
  assert.deepEqual(s.adaptation.counts, { mapped: 5, passthrough: 0, rejected: 0, blank: 1 });
  assert.equal(s.adjudication.overall, 'ALL_MATCHED');
  assert.deepEqual(s.adjudication.counts, { matched: 5, mismatched: 0, notObserved: 0, ambiguous: 0 });
  assert.equal(s.table, TABLE);
  assert.equal(s.overall, 'OBSERVED');
  assert.equal(s.isolationAccepted, false);
  assert.equal(s.generatedCodeExecuted, false);
  assert.equal(s.authorizing, false);
});

test('a pid mismatch between the reaped child and the spawned child is never OBSERVED', () => {
  const s = summarize({ ...RECEIPT, waitObservedPid: 20281 }, STDOUT);
  assert.deepEqual(s.reasons, ['PID_MISMATCH']);
  assert.equal(s.gate, 'RUN_INCOMPLETE');
  assert.equal(s.overall, 'NOT_ACCEPTED');
  assert.equal(s.adjudication.overall, 'ALL_MATCHED');
  assert.equal(s.table, TABLE);
});

test('exit status faults are named in a fixed order and each alone is disqualifying', () => {
  assert.deepEqual(summarize({ ...RECEIPT, exitCode: 1 }, STDOUT).reasons, ['NONZERO_EXIT']);
  assert.deepEqual(summarize({ ...RECEIPT, exitCode: null, signal: 5, rawWaitStatus: 5 }, STDOUT).reasons, ['SIGNALED', 'NONZERO_EXIT']);
  assert.deepEqual(summarize({ ...RECEIPT, spawnReturn: -1 }, STDOUT).reasons, ['SPAWN_FAILED']);
  assert.deepEqual(summarize({ ...RECEIPT, waitObserved: false }, STDOUT).reasons, ['WAIT_NOT_OBSERVED']);
  assert.deepEqual(summarize({ ...RECEIPT, stdoutEOF: false }, STDOUT).reasons, ['STDOUT_NOT_DRAINED']);
  assert.deepEqual(summarize({ ...RECEIPT, stderrEOF: false }, STDOUT).reasons, ['STDERR_NOT_DRAINED']);
  assert.deepEqual(summarize({ ...RECEIPT, drainObserved: 1 }, STDOUT).reasons, ['DRAIN_NOT_OBSERVED']);
  assert.deepEqual(summarize({ ...RECEIPT, timeout: true }, STDOUT).reasons, ['TIMEOUT']);
  assert.deepEqual(summarize({ ...RECEIPT, outputCapExceeded: true }, STDOUT).reasons, ['OUTPUT_CAP_EXCEEDED']);
  for (const s of [summarize({ ...RECEIPT, exitCode: 1 }, STDOUT), summarize({ ...RECEIPT, timeout: true }, STDOUT)]) {
    assert.equal(s.gate, 'RUN_INCOMPLETE');
    assert.equal(s.overall, 'NOT_ACCEPTED');
  }
});

test('tampered canary output is CANARIES_NOT_MATCHED with the mismatch visible in the table', () => {
  const lines = STDOUT.split('\n');
  lines[3] = '{"operation":"outside_read","outcome":"allowed","errno":0,"generatedCodeExecuted":false,"completeIsolation":false,"authorizing":false}';
  const s = summarize(RECEIPT, lines.join('\n'));
  assert.deepEqual(s.reasons, ['CANARIES_NOT_MATCHED']);
  assert.equal(s.gate, 'RUN_COMPLETE');
  assert.equal(s.overall, 'NOT_ACCEPTED');
  assert.equal(s.adjudication.overall, 'NOT_ACCEPTED');
  assert.match(s.table, /^- outside-read: expected DENIED errno 1, observed ALLOWED \(errno 0\) -> MISMATCH$/m);
  const empty = summarize(RECEIPT, null);
  assert.deepEqual(empty.reasons, ['CANARIES_NOT_MATCHED']);
  assert.deepEqual(empty.adjudication.counts, { matched: 0, mismatched: 0, notObserved: 5, ambiguous: 0 });
});

test('unavailable identities skip adjudication entirely and are never OBSERVED', () => {
  for (const bad of [{ ...RECEIPT, childPid: '20280' }, { ...RECEIPT, servicePid: 0 }, { ...RECEIPT, childPid: undefined }]) {
    const s = summarize(bad, STDOUT);
    assert.deepEqual(s.reasons, ['IDENTITY_UNAVAILABLE'], JSON.stringify(bad.childPid));
    assert.equal(s.gate, 'RUN_INCOMPLETE');
    assert.equal(s.adaptation, null);
    assert.equal(s.adjudication, null);
    assert.equal(s.table, null);
    assert.equal(s.overall, 'NOT_ACCEPTED');
  }
  const s = summarize({ ...RECEIPT, childPid: 20280, waitObservedPid: 'x' }, STDOUT);
  assert.deepEqual(s.identity, { childPid: 20280, servicePid: 20279, waitObservedPid: null });
  assert.deepEqual(s.reasons, ['PID_MISMATCH']);
});

test('an empty receipt names every failed gate in order and reads all lifecycle fields as null', () => {
  const s = summarize({}, STDOUT);
  assert.deepEqual(s.reasons, ['SPAWN_FAILED', 'WAIT_NOT_OBSERVED', 'IDENTITY_UNAVAILABLE', 'NONZERO_EXIT',
    'STDOUT_NOT_DRAINED', 'STDERR_NOT_DRAINED', 'DRAIN_NOT_OBSERVED', 'TIMEOUT', 'OUTPUT_CAP_EXCEEDED']);
  assert.deepEqual(s.identity, { childPid: null, servicePid: null, waitObservedPid: null });
  assert.deepEqual(s.lifecycle, Object.fromEntries(LIFECYCLE_KEYS.map(k => [k, null])));
  assert.equal(s.gate, 'RUN_INCOMPLETE');
  assert.equal(s.overall, 'NOT_ACCEPTED');
});

test('lifecycle fields are typed reads: wrong types read as null, and inherited properties are ignored', () => {
  const odd = { ...RECEIPT, exitCode: '0', stdoutEOF: 'true', timeout: 0, signal: 'SIGTRAP', rawWaitStatus: 1.5 };
  const s = summarize(odd, STDOUT);
  assert.equal(s.lifecycle.exitCode, null);
  assert.equal(s.lifecycle.stdoutEOF, null);
  assert.equal(s.lifecycle.timeout, null);
  assert.equal(s.lifecycle.signal, 'SIGTRAP');
  assert.equal(s.lifecycle.rawWaitStatus, null);
  assert.deepEqual(s.reasons, ['SIGNALED', 'NONZERO_EXIT', 'STDOUT_NOT_DRAINED', 'TIMEOUT']);
  const inherited = Object.create(RECEIPT);
  assert.deepEqual(summarize(inherited, STDOUT).reasons.slice(0, 3), ['SPAWN_FAILED', 'WAIT_NOT_OBSERVED', 'IDENTITY_UNAVAILABLE']);
});

test('invalid receipt or stdout types throw TypeError before any adjudication', () => {
  for (const bad of [undefined, null, [], 'receipt', 42]) assert.throws(() => summarize(bad, STDOUT), TypeError);
  for (const bad of [42, {}, [], true]) assert.throws(() => summarize(RECEIPT, bad), TypeError);
  assert.equal(summarize(RECEIPT, undefined).overall, 'NOT_ACCEPTED');
});

test('summary does not mutate frozen inputs and returns fresh objects', () => {
  const receipt = JSON.parse(JSON.stringify(RECEIPT));
  Object.freeze(receipt);
  const before = JSON.stringify(receipt);
  const a = summarize(receipt, STDOUT);
  const b = summarize(receipt, STDOUT);
  assert.notEqual(a, b);
  assert.notEqual(a.adjudication, b.adjudication);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(receipt), before);
  a.reasons.push('TAMPERED');
  assert.deepEqual(summarize(receipt, STDOUT).reasons, []);
});

test('summary module imports only its two sibling modules and stays pure otherwise', async () => {
  const source = await readFile(new URL('../src/native-canary-summary.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^\s*import\b[^\n]*from\s+['"]([^'"]+)['"]/gm)].map(m => m[1]);
  assert.deepEqual([...new Set(imports)].sort(), ['./native-canary-adapter.mjs', './native-canary-adjudicator.mjs']);
  assert.doesNotMatch(source, /\b(?:require|process|fetch|XMLHttpRequest|eval|Function|setTimeout|setInterval)\b/);
  assert.doesNotMatch(source, /\b(?:Date|performance)\b|Math\s*\.\s*random\b/);
});
