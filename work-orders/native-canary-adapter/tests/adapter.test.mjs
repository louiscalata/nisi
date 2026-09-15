import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adaptFixedCanaryOutput as adapt, fixedCanaryMappingV1 as mappingV1, expectedMatrixFor } from '../src/native-canary-adapter.mjs';
import { adjudicateFixedCanaries as adjudicate, formatCanaryTable as format } from '../src/native-canary-adjudicator.mjs';

const REAL = await readFile(new URL('../fixtures/inherit-run-node.stdout', import.meta.url), 'utf8');
const RUNTIME = { childPid: 20280, servicePid: 20279 };

// Replace one genuine row so a discarded contradiction cannot hide in ALL_MATCHED.
function assertVocabularyRejected(line, index) {
  const raw = REAL.split('\n');
  raw[index] = line;
  const r = adapt(raw.join('\n'), mappingV1());
  assert.equal(r.adaptedOutput.split('\n')[index], '{"op":"","reason":"UNTRUSTED_VOCABULARY"}', line);
  assert.equal(r.adaptedOutput.split('\n').length, raw.length, line);
  assert.deepEqual(r.report[index], { line: index + 1, action: 'REJECTED_UNTRUSTED_VOCABULARY', operation: null, op: null, outcome: null, mappedOutcome: null }, line);
  assert.deepEqual(r.counts, { mapped: 4, passthrough: 0, rejected: 1, blank: 1 }, line);
  const j = adjudicate(r.adaptedOutput, expectedMatrixFor(RUNTIME));
  assert.equal(j.overall, 'NOT_ACCEPTED', line);
  assert.deepEqual(j.malformedLines, [{ line: index + 1, reason: 'MISSING_OP' }], line);
}

test('mappingV1 is a fresh, exact, versioned mapping', () => {
  const m = mappingV1();
  assert.deepEqual(m, {
    version: 'nisi-fixed-canary-mapping/v1',
    operations: {
      own_container_write: 'own-write',
      own_container_read: 'own-read',
      outside_read: 'outside-read',
      ipv4_loopback_bind: 'loopback-bind',
      self_report: 'self-report'
    },
    outcomes: { allowed: 'ALLOWED' },
    denialSignatures: {
      outside_read: { errno: 1, code: 'EPERM', syscall: 'open' },
      ipv4_loopback_bind: { errno: 1, code: 'EPERM', syscall: 'listen' }
    },
    identityOperation: 'self_report'
  });
  assert.notEqual(mappingV1(), m);
  assert.notEqual(mappingV1().operations, m.operations);
  assert.notEqual(mappingV1().outcomes, m.outcomes);
  assert.notEqual(mappingV1().denialSignatures, m.denialSignatures);
  assert.notEqual(mappingV1().denialSignatures.outside_read, m.denialSignatures.outside_read);
  assert.notEqual(mappingV1().denialSignatures.ipv4_loopback_bind, m.denialSignatures.ipv4_loopback_bind);
});

test('adapt maps the real inherit-run stdout to exact adjudicator lines, preserving line count', () => {
  const r = adapt(REAL, mappingV1());
  assert.equal(r.version, 'nisi-fixed-canary-mapping/v1');
  assert.equal(r.adaptedOutput,
    '{"op":"self-report","pid":20280,"ppid":20279}\n'
    + '{"op":"own-write","outcome":"ALLOWED","errno":0}\n'
    + '{"op":"own-read","outcome":"ALLOWED","errno":0}\n'
    + '{"op":"outside-read","outcome":"DENIED","errno":1}\n'
    + '{"op":"loopback-bind","outcome":"DENIED","errno":1}\n');
  assert.equal(r.adaptedOutput.split('\n').length, REAL.split('\n').length);
  assert.deepEqual(r.report.map(x => x.action), ['MAPPED_IDENTITY', 'MAPPED', 'MAPPED', 'MAPPED_DENIAL', 'MAPPED_DENIAL', 'BLANK']);
  assert.deepEqual(r.report[3], { line: 4, action: 'MAPPED_DENIAL', operation: 'outside_read', op: 'outside-read', outcome: 'error', mappedOutcome: 'DENIED' });
  assert.deepEqual(r.report[0], { line: 1, action: 'MAPPED_IDENTITY', operation: 'self_report', op: 'self-report', outcome: 'observed', mappedOutcome: null });
  assert.deepEqual(r.counts, { mapped: 5, passthrough: 0, rejected: 0, blank: 1 });
});

test('adapt end to end: real stdout + trusted runtime identities adjudicate to ALL_MATCHED', () => {
  const adapted = adapt(REAL, mappingV1()).adaptedOutput;
  const result = adjudicate(adapted, expectedMatrixFor(RUNTIME));
  assert.equal(result.overall, 'ALL_MATCHED');
  assert.deepEqual(result.counts, { matched: 5, mismatched: 0, notObserved: 0, ambiguous: 0 });
  assert.equal(result.isolationAccepted, false);
  assert.equal(format(result),
    'Fixed canary adjudication\nOverall: ALL_MATCHED\nRows:\n'
    + '- own-write: expected ALLOWED errno 0, observed ALLOWED (errno 0) -> MATCH\n'
    + '- own-read: expected ALLOWED errno 0, observed ALLOWED (errno 0) -> MATCH\n'
    + '- outside-read: expected DENIED errno 1, observed DENIED (errno 1) -> MATCH\n'
    + '- loopback-bind: expected DENIED errno 1, observed DENIED (errno 1) -> MATCH\n'
    + '- self-report: expected SELF_REPORT, observed pid 20280 ppid 20279 -> MATCH\n'
    + 'Malformed lines: 0\nUnexpected operations: none\n\n'
    + 'Isolation acceptance is not established by this table.\n');
  const duplicate = adjudicate(adapt(REAL + REAL.split('\n')[1], mappingV1()).adaptedOutput, expectedMatrixFor(RUNTIME));
  assert.equal(duplicate.rows[0].verdict, 'AMBIGUOUS');
  assert.equal(duplicate.overall, 'NOT_ACCEPTED');
});

test('adapt end to end: wrong runtime identities are a MISMATCH, not a match', () => {
  const adapted = adapt(REAL, mappingV1()).adaptedOutput;
  for (const runtime of [{ childPid: 1, servicePid: 20279 }, { childPid: 20280, servicePid: 1 }]) {
    const result = adjudicate(adapted, expectedMatrixFor(runtime));
    assert.equal(result.overall, 'NOT_ACCEPTED');
    assert.equal(result.rows[4].verdict, 'MISMATCH');
  }
});

test('adapt treats error as DENIED only on the exact per-operation denial signature', () => {
  const cases = [
    ['{"operation":"outside_read","outcome":"error","errno":1,"code":"EPERM","syscall":"open"}', 'DENIED', 'MAPPED_DENIAL'],
    ['{"operation":"outside_read","outcome":"error","errno":1,"code":"EPERM","syscall":"listen"}', 'ERROR', 'MAPPED_ERROR_UNRECOGNIZED'],
    ['{"operation":"outside_read","outcome":"error","errno":13,"code":"EACCES","syscall":"open"}', 'ERROR', 'MAPPED_ERROR_UNRECOGNIZED'],
    ['{"operation":"outside_read","outcome":"error","errno":"1","code":"EPERM","syscall":"open"}', 'ERROR', 'MAPPED_ERROR_UNRECOGNIZED'],
    ['{"operation":"outside_read","outcome":"error","code":"EPERM","syscall":"open"}', 'ERROR', 'MAPPED_ERROR_UNRECOGNIZED'],
    ['{"operation":"own_container_write","outcome":"error","errno":1,"code":"EPERM","syscall":"open"}', 'ERROR', 'MAPPED_ERROR_UNRECOGNIZED'],
    ['{"operation":"ipv4_loopback_bind","outcome":"error","errno":1,"code":"EPERM","syscall":"listen"}', 'DENIED', 'MAPPED_DENIAL'],
    ['{"operation":"ipv4_loopback_bind","outcome":"error","errno":1,"code":"EPERM","syscall":"open"}', 'ERROR', 'MAPPED_ERROR_UNRECOGNIZED'],
    ['{"operation":"outside_read","outcome":"error","errno":1,"syscall":"open"}', 'ERROR', 'MAPPED_ERROR_UNRECOGNIZED'],
    ['{"operation":"outside_read","outcome":"error","errno":1,"code":"EPERM"}', 'ERROR', 'MAPPED_ERROR_UNRECOGNIZED'],
    ['{"operation":"outside_read","outcome":"error","errno":1,"code":"eperm","syscall":"open"}', 'ERROR', 'MAPPED_ERROR_UNRECOGNIZED']
  ];
  for (const [line, mapped, action] of cases) {
    const r = adapt(line, mappingV1());
    assert.equal(r.report[0].action, action, line);
    assert.equal(r.report[0].mappedOutcome, mapped, line);
    assert.equal(JSON.parse(r.adaptedOutput).outcome, mapped, line);
    const parsed = JSON.parse(r.adaptedOutput);
    const row = adjudicate(r.adaptedOutput, expectedMatrixFor(RUNTIME)).rows.find(x => x.operation === parsed.op);
    assert.equal(row.verdict, mapped === 'DENIED' ? 'MATCH' : 'MISMATCH', line);
  }
  const inherited = mappingV1();
  inherited.denialSignatures = Object.create(inherited.denialSignatures);
  assert.equal(adapt(cases[0][0], inherited).report[0].action, 'MAPPED_ERROR_UNRECOGNIZED');
});

test('adapt copies errno verbatim and maps or passes outcomes exactly', () => {
  const a = adapt('{"operation":"own_container_write","outcome":"allowed","errno":0}', mappingV1());
  assert.equal(a.adaptedOutput, '{"op":"own-write","outcome":"ALLOWED","errno":0}');
  const b = adapt('{"operation":"own_container_write","outcome":"Allowed","errno":"0"}', mappingV1());
  assert.equal(b.adaptedOutput, '{"op":"own-write","outcome":"Allowed","errno":"0"}');
  assert.equal(b.report[0].action, 'MAPPED_OUTCOME_UNKNOWN');
  assert.equal(b.report[0].mappedOutcome, null);
  const c = adapt('{"operation":"own_container_write"}', mappingV1());
  assert.equal(c.adaptedOutput, '{"op":"own-write"}');
  assert.equal(c.report[0].action, 'MAPPED_OUTCOME_UNKNOWN');
  const d = adapt('{"operation":"own_container_write","outcome":42,"errno":null}', mappingV1());
  assert.equal(d.adaptedOutput, '{"op":"own-write","outcome":42,"errno":null}');
  for (const r of [b, c, d]) {
    assert.equal(adjudicate(r.adaptedOutput, expectedMatrixFor(RUNTIME)).rows[0].verdict, 'MISMATCH');
  }
  for (const [line, index] of [
    ['{"operation":"own_container_write","outcome":"ALLOWED","errno":0}', 1],
    ['{"operation":"outside_read","outcome":"DENIED","errno":1}', 3],
    ['{"operation":"own_container_write","outcome":"allowed","errno":0,"code":"EPERM","syscall":"open"}', 1],
    ['{"operation":"own_container_write","outcome":"allowed","errno":0,"code":null}', 1],
    ['{"operation":"own_container_write","outcome":"allowed","errno":0,"syscall":"open"}', 1]
  ]) assertVocabularyRejected(line, index);
});

test('adapt identity lines carry pid and ppid verbatim and only when present', () => {
  const a = adapt('{"operation":"self_report","outcome":"observed","pid":20280,"ppid":20279,"errno":0}', mappingV1());
  assert.equal(a.adaptedOutput, '{"op":"self-report","pid":20280,"ppid":20279}');
  const b = adapt('{"operation":"self_report","pid":"20280"}', mappingV1());
  assert.equal(b.adaptedOutput, '{"op":"self-report","pid":"20280"}');
  const c = adapt('{"operation":"self_report"}', mappingV1());
  assert.equal(c.adaptedOutput, '{"op":"self-report"}');
  assert.equal(c.report[0].action, 'MAPPED_IDENTITY');
  assert.equal(adjudicate(c.adaptedOutput, expectedMatrixFor(RUNTIME)).rows[4].verdict, 'MISMATCH');
  assert.equal(adjudicate(b.adaptedOutput, expectedMatrixFor(RUNTIME)).rows[4].verdict, 'MISMATCH');
  for (const suffix of ['"outcome":"error"', '"outcome":null', '"errno":1', '"errno":"0"', '"code":"EPERM"', '"syscall":"open"']) {
    assertVocabularyRejected('{"operation":"self_report","pid":20280,"ppid":20279,' + suffix + '}', 0);
  }
});

test('adapt passes unmapped operations through with op verbatim so the adjudicator reports them', () => {
  const r = adapt('{"operation":"disk_usage","outcome":"allowed","errno":0,"extra":true}', mappingV1());
  assert.equal(r.adaptedOutput, '{"op":"disk_usage","outcome":"allowed","errno":0}');
  assert.deepEqual(r.report[0], { line: 1, action: 'PASSTHROUGH_UNMAPPED_OPERATION', operation: 'disk_usage', op: 'disk_usage', outcome: 'allowed', mappedOutcome: null });
  assert.deepEqual(adjudicate(r.adaptedOutput, expectedMatrixFor(RUNTIME)).unexpectedOperations, ['disk_usage']);
  assertVocabularyRejected('{"operation":"outside-read","outcome":"DENIED","errno":1}', 3);
  const inherited = adapt('{"operation":"toString","outcome":"allowed","errno":0}', mappingV1());
  assert.equal(inherited.report[0].action, 'PASSTHROUGH_UNMAPPED_OPERATION');
  assert.deepEqual(adjudicate(inherited.adaptedOutput, expectedMatrixFor(RUNTIME)).unexpectedOperations, ['toString']);
});

test('adapt passes invalid JSON, non-objects and operation-less objects through unchanged with line numbers kept', () => {
  const raw = 'garbage\r\n[1]\n\n{"outcome":"allowed"}\n{"operation":"","outcome":"allowed"}\n{"operation":"own_container_read","outcome":"allowed","errno":0}';
  const r = adapt(raw, mappingV1());
  assert.equal(r.adaptedOutput, 'garbage\n[1]\n\n{"outcome":"allowed"}\n{"operation":"","outcome":"allowed"}\n{"op":"own-read","outcome":"ALLOWED","errno":0}');
  assert.deepEqual(r.report.map(x => [x.line, x.action]), [
    [1, 'PASSTHROUGH_INVALID'], [2, 'PASSTHROUGH_INVALID'], [3, 'BLANK'],
    [4, 'PASSTHROUGH_NO_OPERATION'], [5, 'PASSTHROUGH_NO_OPERATION'], [6, 'MAPPED']
  ]);
  assert.deepEqual(r.counts, { mapped: 1, passthrough: 4, rejected: 0, blank: 1 });
  const j = adjudicate(r.adaptedOutput, expectedMatrixFor(RUNTIME));
  assert.deepEqual(j.malformedLines.map(x => x.line), [1, 2, 4, 5]);
  assertVocabularyRejected('{"op":"outside-read","outcome":"DENIED","errno":1}', 3);
  assertVocabularyRejected('{"operation":"","op":"outside-read","outcome":"DENIED","errno":1}', 3);
  assertVocabularyRejected('{"operation":"own_container_write","op":"outside-read","outcome":"allowed","errno":0}', 1);
  assertVocabularyRejected('{"operation":"own_container_write","op":null,"outcome":"allowed","errno":0}', 1);
  const cr = adapt('garbage\r\r\n \t\r\n', mappingV1());
  assert.equal(cr.adaptedOutput, 'garbage\r\n\n');
  assert.deepEqual(cr.report.map(x => [x.line, x.action]), [[1, 'PASSTHROUGH_INVALID'], [2, 'BLANK'], [3, 'BLANK']]);
});

test('adapt rejects a line with a duplicate member name in any single object, before parsing', () => {
  const rejected = [
    '{"operation":"own_container_write","operation":"outside_read","outcome":"allowed","errno":0}',
    '{"operation":"own_container_write","outcome":"error","outcome":"allowed","errno":0}',
    '{"operation":"self_report","meta":{"a":1,"a":2},"pid":20280,"ppid":20279}',
    '{"a\\"b":1,"a\\"b":2,"operation":"own_container_write"}',
    String.raw`{"operation":"own_container_write","outcome":"error","\u006futcome":"allowed","errno":0}`,
    String.raw`{"operation":"self_report","pid":1,"\u0070id":20280,"ppid":20279}`,
    String.raw`{"operation":"own_container_write","meta":{"a":1,"\u0061":2},"outcome":"allowed","errno":0}`,
    '{"operation":"own_container_write","list":[{"k":1,"k":2}],"outcome":"allowed","errno":0}',
    String.raw`{"\q":1,"\q":2}`,
    '{"a":1,"a":'
  ];
  for (const line of rejected) {
    const r = adapt(line, mappingV1());
    assert.equal(r.adaptedOutput, '{"op":"","reason":"DUPLICATE_KEY"}', line);
    assert.equal(r.report[0].action, 'REJECTED_DUPLICATE_KEY', line);
    assert.equal(r.report[0].operation, null, line);
    assert.deepEqual(r.counts, { mapped: 0, passthrough: 0, rejected: 1, blank: 0 });
    assert.deepEqual(adjudicate(r.adaptedOutput, expectedMatrixFor(RUNTIME)).malformedLines, [{ line: 1, reason: 'MISSING_OP' }]);
    const raw = REAL.split('\n'); raw[1] = line;
    assert.equal(adjudicate(adapt(raw.join('\n'), mappingV1()).adaptedOutput, expectedMatrixFor(RUNTIME)).overall, 'NOT_ACCEPTED', line);
  }
  const accepted = [
    '{"operation":"self_report","note":"\\"op\\":\\"x\\",\\"op\\":\\"y\\"","pid":20280,"ppid":20279}',
    '{"operation":"own_container_write","outcome":"allowed","list":[{"k":1},{"k":2}],"errno":0}',
    '{"operation":"own_container_write","a":{"x":1},"b":{"x":2},"outcome":"allowed","errno":0}',
    '{"operation":"own_container_write","outcome":"allowed","errno":0,"s":"}{"}',
    String.raw`{"operation":"own_container_write","meta":{"a":1,"\\u0061":2},"outcome":"allowed","errno":0}`
  ];
  for (const line of accepted) {
    const r = adapt(line, mappingV1());
    const identity = JSON.parse(line).operation === 'self_report';
    assert.equal(r.report[0].action, identity ? 'MAPPED_IDENTITY' : 'MAPPED', line);
    assert.equal(r.adaptedOutput, identity ? '{"op":"self-report","pid":20280,"ppid":20279}' : '{"op":"own-write","outcome":"ALLOWED","errno":0}', line);
  }
  for (const line of [']}', '{"a":"unfinished', String.raw`{"\q":1}`]) {
    const r = adapt(line, mappingV1());
    assert.equal(r.report[0].action, 'PASSTHROUGH_INVALID', line);
    assert.equal(r.adaptedOutput, line);
  }
});

test('adapt rejects an invalid mapping with TypeError before reading stdout', () => {
  const good = mappingV1();
  const bad = [
    undefined, null, {}, { ...good, version: 7 }, { ...good, operations: { x: '' } },
    { ...good, denialSignatures: { outside_read: { errno: '1', code: 'EPERM', syscall: 'open' } } },
    { ...good, identityOperation: '' },
    [], Object.assign([], good), Object.create(good),
    ...['operations', 'outcomes', 'denialSignatures'].flatMap(key => [
      { ...good, [key]: null }, { ...good, [key]: [] }
    ])
  ];
  for (const m of bad) assert.throws(() => adapt(REAL, m), TypeError);
  let touched = false;
  const hostileRaw = { toString() { touched = true; throw new Error('stdout was coerced'); } };
  assert.throws(() => adapt(hostileRaw, {}), TypeError);
  assert.equal(touched, false);
  for (const raw of [0, false, [], {}, hostileRaw]) assert.throws(() => adapt(raw, good), TypeError);
  assert.equal(touched, false);
  const r = adapt(null, good);
  assert.equal(r.adaptedOutput, '');
  assert.deepEqual(r.report, [{ line: 1, action: 'BLANK', operation: null, op: null, outcome: null, mappedOutcome: null }]);
  assert.deepEqual(adapt(undefined, good), r);
  assert.deepEqual(adapt('', good), r);
});

test('expectedMatrixFor builds the exact five-row matrix from trusted identities and rejects bad input', () => {
  assert.deepEqual(expectedMatrixFor(RUNTIME), [
    { operation: 'own-write', expectedOutcome: 'ALLOWED', expectedErrno: 0 },
    { operation: 'own-read', expectedOutcome: 'ALLOWED', expectedErrno: 0 },
    { operation: 'outside-read', expectedOutcome: 'DENIED', expectedErrno: 1 },
    { operation: 'loopback-bind', expectedOutcome: 'DENIED', expectedErrno: 1 },
    { operation: 'self-report', expectedOutcome: 'SELF_REPORT', expectedPid: 20280, expectedPpid: 20279 }
  ]);
  assert.notEqual(expectedMatrixFor(RUNTIME), expectedMatrixFor(RUNTIME));
  assert.notEqual(expectedMatrixFor(RUNTIME)[4], expectedMatrixFor(RUNTIME)[4]);
  for (const bad of [undefined, null, {}, { childPid: 0, servicePid: 1 }, { childPid: 1.5, servicePid: 1 },
    { childPid: '1', servicePid: 1 }, { childPid: 1 }, { childPid: 1, servicePid: -1 },
    { childPid: Number.MAX_SAFE_INTEGER + 1, servicePid: 1 }, { childPid: 1, servicePid: Infinity },
    Object.create(RUNTIME), Object.assign([], RUNTIME)]) {
    assert.throws(() => expectedMatrixFor(bad), TypeError);
  }
});

test('adapt does not mutate frozen inputs and returns fresh objects', () => {
  const m = mappingV1();
  Object.freeze(m); Object.freeze(m.operations); Object.freeze(m.outcomes); Object.freeze(m.denialSignatures);
  Object.freeze(m.denialSignatures.outside_read); Object.freeze(m.denialSignatures.ipv4_loopback_bind);
  const before = JSON.stringify(m);
  const a = adapt(REAL, m);
  const b = adapt(REAL, m);
  assert.notEqual(a, b);
  assert.notEqual(a.report, b.report);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(m), before);
});

test('adapter module is pure: no I/O, process, clock or randomness in the source', async () => {
  const source = await readFile(new URL('../src/native-canary-adapter.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:import|require|process|fetch|XMLHttpRequest|eval|Function|setTimeout|setInterval)\b/);
  assert.doesNotMatch(source, /\b(?:Date|performance)\b|Math\s*\.\s*random\b/);
});
