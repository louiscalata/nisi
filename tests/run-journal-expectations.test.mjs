// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// reopen(serialized, expectations): host-supplied projectId, redactPaths and maxNow.
// See docs/reviews/2026-11-14-journal-auth-review.md, F4, F5 and R3.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunJournal, reopen } from '../history/run-journal-v1.mjs';

const config = patch => ({
  projectId: 'project-a',
  maxEntries: 8,
  heartbeatTtlMs: 10,
  redactPaths: ['payload.apiKey', 'payload.nested.token'],
  ...patch,
});

const entry = (id = 'entry-a', patch = {}) => ({
  id,
  projectId: 'project-a',
  runId: 'run-a',
  attempt: 0,
  candidateId: 'candidate-a',
  stage: 'test',
  receiptId: 'receipt-a',
  createdAt: 100,
  ttlMs: 1000,
  state: 'SUCCEEDED',
  heartbeatAt: null,
  retryOf: null,
  revokes: null,
  payload: { note: 'safe-note' },
  ...patch,
});

const expect = patch => ({
  projectId: 'project-a',
  redactPaths: ['payload.apiKey', 'payload.nested.token'],
  maxNow: 1000,
  ...patch,
});

const written = (configPatch = {}, entryPatch = {}, now = 200) => {
  const journal = createRunJournal(config(configPatch));
  assert.equal(journal.append(entry('entry-a', entryPatch), 100).status, 'APPENDED');
  return journal.serialize(now);
};

const refused = (result, reason) => {
  assert.equal(result.journal, null);
  assert.deepEqual({ ...result.report }, {
    status: 'INVALID', recoveredIds: [], rejectedLine: 1, reason, authorizing: false,
  });
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.report));
};

test('one-argument and undefined-expectation calls match the existing reopen result', () => {
  const serialized = written();
  const one = reopen(serialized);
  const undef = reopen(serialized, undefined);
  assert.equal(one.report.status, 'COMPLETE');
  assert.deepEqual(undef.report, one.report);
  assert.equal(undef.journal.serialize(), one.journal.serialize());
  assert.equal(reopen.length, 1);
  for (const bad of [undefined, 'no-newline', 'x\n']) {
    assert.deepEqual(reopen(bad, undefined), reopen(bad));
  }
});

test('matching expectations reopen COMPLETE, and redactPaths compare as a set', () => {
  const serialized = written();
  for (const redactPaths of [['payload.apiKey', 'payload.nested.token'], ['payload.nested.token', 'payload.apiKey']]) {
    const result = reopen(serialized, expect({ redactPaths }));
    assert.equal(result.report.status, 'COMPLETE');
    assert.deepEqual(result.report.recoveredIds, ['entry-a']);
    assert.equal(result.journal.serialize(), reopen(serialized).journal.serialize());
    assert.equal(result.journal.append(entry('entry-b'), 300).status, 'APPENDED');
  }
  const empty = written({ redactPaths: [] });
  assert.equal(reopen(empty, expect({ redactPaths: [] })).report.status, 'COMPLETE');
});

test('F4: a header without the host redaction paths is refused with REDACTION_MISMATCH', () => {
  const planted = written({ redactPaths: [] }, { payload: { apiKey: 'sk-planted' } });
  assert.match(planted, /sk-planted/);
  assert.equal(reopen(planted).report.status, 'COMPLETE');
  refused(reopen(planted, expect()), 'REDACTION_MISMATCH');
  // A subset, a superset and a different path are all mismatches.
  const one = written({ redactPaths: ['payload.apiKey'] });
  refused(reopen(one, expect()), 'REDACTION_MISMATCH');
  refused(reopen(written(), expect({ redactPaths: ['payload.apiKey'] })), 'REDACTION_MISMATCH');
  refused(reopen(written(), expect({ redactPaths: ['payload.apiKey', 'payload.other'] })), 'REDACTION_MISMATCH');
});

test('F4: a header with another projectId is refused with PROJECT_MISMATCH', () => {
  const other = written({ projectId: 'other' }, { projectId: 'other' });
  assert.equal(reopen(other).report.status, 'COMPLETE');
  refused(reopen(other, expect()), 'PROJECT_MISMATCH');
  // Project is checked first when several values differ.
  refused(reopen(other, expect({ redactPaths: [], maxNow: 0 })), 'PROJECT_MISMATCH');
});

test('F5: a header watermark past maxNow is refused with CLOCK_AHEAD', () => {
  const pinned = written({}, {}, Number.MAX_SAFE_INTEGER);
  const plain = reopen(pinned);
  assert.equal(plain.report.status, 'COMPLETE');
  assert.throws(() => plain.journal.list(1000), { code: 'TIME' });
  refused(reopen(pinned, expect()), 'CLOCK_AHEAD');
  refused(reopen(written({}, {}, 1001), expect()), 'CLOCK_AHEAD');
  // Redaction is checked before the clock.
  refused(reopen(pinned, expect({ redactPaths: [] })), 'REDACTION_MISMATCH');
  const atLimit = reopen(written({}, {}, 1000), expect());
  assert.equal(atLimit.report.status, 'COMPLETE');
  assert.equal(atLimit.journal.list(1000).length, 1);
});

test('header and body checks are unchanged when expectations match', () => {
  refused(reopen('not a journal\n', expect()), 'HEADER');
  refused(reopen('x', expect()), 'HEADER');
  const serialized = written();
  const lines = serialized.split('\n');
  lines[1] = lines[1].replace('safe-note', 'edited-note');
  const damaged = reopen(lines.join('\n'), expect());
  assert.deepEqual(damaged.report, reopen(lines.join('\n')).report);
  assert.equal(damaged.report.reason, 'RECORD');
  assert.throws(() => damaged.journal.serialize(), { code: 'SEALED' });
  const cut = reopen(serialized.slice(0, -1), expect());
  assert.equal(cut.report.status, 'INCOMPLETE');
});

test('malformed expectations throw EXPECTATIONS before the input is read', () => {
  const serialized = written();
  const getter = expect();
  Object.defineProperty(getter, 'maxNow', { get: () => 1000, enumerable: true });
  const bad = [
    null, 'project-a', [], 0,
    { projectId: 'project-a', redactPaths: [] },
    { ...expect(), extra: true },
    expect({ projectId: '' }), expect({ projectId: 'bad id' }), expect({ projectId: 7 }),
    expect({ maxNow: -1 }), expect({ maxNow: 1.5 }), expect({ maxNow: '1000' }), expect({ maxNow: Number.MAX_SAFE_INTEGER + 1 }),
    expect({ maxNow: -0 }), expect({ maxNow: null }),
    expect({ redactPaths: 'payload.apiKey' }), expect({ redactPaths: [7] }), expect({ redactPaths: ['apiKey'] }),
    expect({ redactPaths: ['payload.'] }), expect({ redactPaths: ['payload.__proto__'] }),
    expect({ redactPaths: ['payload.a', 'payload.a'] }), expect({ redactPaths: ['payload.a', 'payload.a.b'] }),
    new Proxy(expect(), {}), getter, Object.assign(Object.create({ inherited: 1 }), expect()),
  ];
  for (const value of bad) {
    assert.throws(() => reopen(serialized, value), { code: 'EXPECTATIONS' }, String(value && JSON.stringify(value)));
    assert.throws(() => reopen('not a journal', value), { code: 'EXPECTATIONS' });
  }
});

test('expectations are copied, so later changes by the caller have no effect', () => {
  const serialized = written();
  const value = expect();
  const result = reopen(serialized, value);
  value.redactPaths.push('payload.extra');
  value.projectId = 'changed';
  assert.equal(result.report.status, 'COMPLETE');
  assert.equal(result.journal.append(entry('entry-b'), 300).status, 'APPENDED');
});
