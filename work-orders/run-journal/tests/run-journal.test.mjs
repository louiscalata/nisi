// Protected owner-authored contract oracle. OpenCode must not edit this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRunJournal, reopen } from '../src/run-journal-v1.mjs';

const config = (patch = {}) => ({projectId: 'project-a', maxEntries: 8, heartbeatTtlMs: 10, redactPaths: [], ...patch});
const entry = (id = 'a', patch = {}) => ({id, projectId: 'project-a', runId: 'run-a', attempt: 0,
  candidateId: 'candidate-a', stage: 'tests', receiptId: 'receipt-a', createdAt: 100, ttlMs: 100,
  state: 'SUCCEEDED', heartbeatAt: null, retryOf: null, revokes: null, payload: {result: 'PASS'}, ...patch});
const make = (patch) => createRunJournal(config(patch));
const row = (j, id, now = 100) => j.list(now).find(x => x.entry.id === id);
const code = expected => e => e instanceof Error && e.code === expected;
const canon = value => JSON.stringify(value, function (_key, x) {
  return x && !Array.isArray(x) && typeof x === 'object'
    ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x;
});
const hash = text => createHash('sha256').update(text).digest('hex');
const lines = serialized => serialized.trimEnd().split('\n');
const fixture = () => {
  const j = make();
  for (const id of ['a', 'b', 'c']) j.append(entry(id), 100);
  return j.serialize();
};
function rewrite(serialized, mutate) {
  const values = lines(serialized).map(JSON.parse);
  mutate(values);
  let previousHash = hash('nisi-run-journal/header/v1\n' + canon(values[0]));
  for (let i = 1; i < values.length - 1; i++) {
    const v = values[i]; v.seq = i; v.previousHash = previousHash;
    v.hash = hash('nisi-run-journal/record/v1\n' + canon({seq: i, previousHash, record: v.record}));
    previousHash = v.hash;
  }
  values.at(-1).count = values.length - 2;
  values.at(-1).lastHash = previousHash;
  return values.map(canon).join('\n') + '\n';
}

test('01 exact synchronous API, empty complete framing and non-authority', () => {
  const j = make();
  assert.deepEqual(Object.keys(j).sort(), ['append', 'list', 'retain', 'serialize']);
  assert.ok(Object.isFrozen(j));
  assert.deepEqual(j.list(0), []);
  assert.deepEqual(j.retain(0), []);
  const result = reopen(j.serialize());
  assert.deepEqual(result.report, {status: 'COMPLETE', recoveredIds: [], rejectedLine: null, reason: null, authorizing: false});
  assert.equal(result.journal.serialize(), j.serialize());
  assert.deepEqual(lines(j.serialize()).map(x => JSON.parse(x).type), ['header', 'footer']);
});

test('02 closed configuration and entry schemas reject malformed data atomically', () => {
  for (const patch of [{maxEntries: 0}, {maxEntries: 1.5}, {heartbeatTtlMs: 0}, {projectId: ''}, {extra: true},
    {redactPaths: ['state']}, {redactPaths: ['payload.__proto__.x']}, {redactPaths: ['payload.a', 'payload.a.b']},
    {redactPaths: ['payload.a', 'payload.a']}]) assert.throws(() => createRunJournal(config(patch)), code('CONFIG'));
  const j = make();
  for (const patch of [{id: ''}, {attempt: -1}, {ttlMs: 0}, {ttlMs: 0.5}, {createdAt: 101},
    {createdAt: Number.MAX_SAFE_INTEGER, ttlMs: 2}, {heartbeatAt: 101}, {state: 'PASS'}, {extra: true},
    {receiptId: 7}, {payload: {x: undefined}}, {payload: {x: NaN}}, {payload: {x: 1.25}},
    {payload: {x: new Map()}}, {payload: JSON.parse('{"__proto__":{}}')}]) {
    assert.throws(() => j.append(entry('bad', patch), 100), code('ENTRY'));
  }
  assert.throws(() => j.append(entry(), -1), code('TIME'));
  assert.deepEqual(j.list(100), []);
});

test('03 full attribution retained and cross-project input refused', () => {
  const j = make(); const a = entry();
  assert.deepEqual(j.append(a, 100), {status: 'APPENDED', id: 'a'});
  const view = row(j, 'a');
  assert.deepEqual(view, {entry: a, historical: false, retained: true, revoked: false,
    expired: false, liveness: 'SUCCEEDED', authorizing: false});
  assert.deepEqual(j.append(entry('other', {projectId: 'project-b'}), 100), {status: 'REFUSED', id: 'other', reason: 'PROJECT'});
  const other = make({projectId: 'project-b'});
  assert.equal(other.append(entry('a', {projectId: 'project-b'}), 100).status, 'APPENDED');
  assert.equal(j.list(100).length, 1);
});

test('04 canonical exact replay is idempotent across object key order and capacity', () => {
  const j = make({maxEntries: 1});
  const a = entry('a', {payload: {z: [1, 2], a: {z: 2, a: 1}}});
  j.append(a, 100); j.append(entry('b'), 100);
  const before = j.serialize();
  const reversed = Object.fromEntries(Object.entries(a).reverse());
  reversed.payload = {a: {a: 1, z: 2}, z: [1, 2]};
  assert.deepEqual(j.append(reversed, 100), {status: 'DUPLICATE', id: 'a'});
  assert.equal(j.serialize(), before);
  assert.equal(j.list(100).length, 2);
});

test('05 same id with changed binding, lifecycle or redacted content is CONFLICT', () => {
  const j = make({redactPaths: ['payload.secret']});
  const a = entry('a', {payload: {secret: 'original'}}); j.append(a, 100);
  const before = j.serialize();
  for (const patch of [{runId: 'other'}, {attempt: 1}, {candidateId: 'other'}, {stage: 'other'},
    {receiptId: null}, {createdAt: 99}, {ttlMs: 200}, {state: 'QUEUED'},
    {payload: {secret: 'changed'}}, {payload: {secret: '[REDACTED]'}}]) {
    assert.deepEqual(j.append({...a, ...patch}, 100), {status: 'CONFLICT', id: 'a', reason: 'ID_CONTENT_MISMATCH'});
  }
  assert.equal(j.serialize(), before);
});

test('06 terminal replay never becomes new work; retries need new id and valid citation', () => {
  const j = make(); j.append(entry('a'), 100);
  assert.equal(j.append(entry('a'), 100).status, 'DUPLICATE');
  assert.equal(j.append(entry('a', {state: 'QUEUED'}), 100).status, 'CONFLICT');
  for (const patch of [{retryOf: 'missing', attempt: 1}, {retryOf: 'a', attempt: 0},
    {retryOf: 'a', attempt: 1, runId: 'other'}, {retryOf: 'a', attempt: 1, state: 'RUNNING'}]) {
    assert.deepEqual(j.append(entry('bad', patch), 100), {status: 'REFUSED', id: 'bad', reason: 'RETRY'});
  }
  assert.equal(j.append(entry('retry', {state: 'QUEUED', retryOf: 'a', attempt: 1, candidateId: 'candidate-b'}), 100).status, 'APPENDED');
  assert.equal(row(j, 'retry').authorizing, false);
});

test('07 TTL boundary, irreversible payload retention and caller time validation', () => {
  const j = make(); const a = entry('a', {state: 'QUEUED', ttlMs: 5}); j.append(a, 100);
  assert.equal(row(j, 'a', 104).expired, false);
  assert.deepEqual(j.retain(105), ['a']);
  const expired = row(j, 'a', 105);
  assert.equal(expired.expired, true); assert.equal(expired.liveness, 'EXPIRED');
  assert.equal(expired.retained, false); assert.equal(expired.entry.payload, null);
  assert.deepEqual(j.retain(105), []);
  assert.equal(j.append(a, 105).status, 'DUPLICATE');
  assert.equal(j.append({...a, ttlMs: 500}, 105).status, 'CONFLICT');
  assert.throws(() => j.list(104), code('TIME'));
  assert.throws(() => j.retain(NaN), code('TIME'));
  assert.equal(j.append(entry('retry', {createdAt: 105, retryOf: 'a', attempt: 1, state: 'QUEUED'}), 105).status, 'APPENDED');
});

test('08 stale heartbeat is UNKNOWN and never sufficient for retry', () => {
  const j = make(); j.append(entry('running', {state: 'RUNNING', heartbeatAt: 100}), 100);
  assert.equal(row(j, 'running', 110).liveness, 'RUNNING');
  assert.equal(row(j, 'running', 111).liveness, 'UNKNOWN');
  assert.deepEqual(j.append(entry('retry', {retryOf: 'running', attempt: 1, state: 'QUEUED'}), 111),
    {status: 'REFUSED', id: 'retry', reason: 'RETRY'});
  assert.equal(j.append(entry('running', {state: 'QUEUED'}), 111).status, 'CONFLICT');
  j.append(entry('missing-beat', {state: 'RUNNING'}), 111);
  assert.equal(row(j, 'missing-beat', 111).liveness, 'UNKNOWN');
  j.append(entry('terminal', {heartbeatAt: 90}), 111);
  assert.equal(row(j, 'terminal', 111).liveness, 'SUCCEEDED');
  assert.ok(j.list(111).every(x => x.authorizing === false));
});

test('09 maxEntries bounds retained payloads in insertion order but never forgets ids', () => {
  const j = make({maxEntries: 1}); const a = entry('a');
  j.append(a, 100); j.append(entry('b'), 100); j.append(entry('c'), 100);
  assert.deepEqual(j.list(100).map(x => [x.entry.id, x.retained]), [['a', false], ['b', false], ['c', true]]);
  assert.equal(j.append(a, 100).status, 'DUPLICATE');
  assert.equal(j.append({...a, payload: {different: true}}, 100).status, 'CONFLICT');
  const r = reopen(j.serialize());
  assert.equal(r.report.status, 'COMPLETE');
  assert.equal(r.journal.append(a, 100).status, 'DUPLICATE');
  assert.equal(row(r.journal, 'a').historical, true);
  assert.equal(row(r.journal, 'a').retained, false);
});

test('10 revocation cites an existing exact attempt and candidate without deleting it', () => {
  const j = make(); j.append(entry('a'), 100);
  for (const patch of [{revokes: 'missing'}, {revokes: 'a', runId: 'other'}, {revokes: 'a', attempt: 1},
    {revokes: 'a', candidateId: 'other'}, {revokes: 'a', createdAt: 99}]) {
    assert.deepEqual(j.append(entry('bad', {state: 'REVOKED', ...patch}), 100), {status: 'REFUSED', id: 'bad', reason: 'REVOCATION'});
  }
  assert.throws(() => j.append(entry('bad', {state: 'REVOKED'}), 100), code('ENTRY'));
  assert.throws(() => j.append(entry('bad', {revokes: 'a'}), 100), code('ENTRY'));
  assert.equal(j.append(entry('revoke', {state: 'REVOKED', revokes: 'a'}), 100).status, 'APPENDED');
  assert.equal(row(j, 'a').entry.state, 'SUCCEEDED');
  assert.equal(row(j, 'a').revoked, true); assert.equal(row(j, 'a').liveness, 'REVOKED');
  assert.equal(j.list(100).length, 2);
});

test('11 revocation survives tombstones, expiry, revoker revocation and reopen', () => {
  const j = make({maxEntries: 1}); j.append(entry('a', {state: 'RUNNING'}), 100);
  j.append(entry('revoke', {state: 'REVOKED', revokes: 'a', ttlMs: 1}), 100);
  j.append(entry('revoke-again', {state: 'REVOKED', revokes: 'revoke'}), 100);
  j.retain(101);
  const r = reopen(j.serialize());
  assert.equal(r.report.status, 'COMPLETE');
  assert.equal(row(r.journal, 'a', 101).revoked, true);
  assert.equal(row(r.journal, 'revoke', 101).retained, false);
  assert.equal(r.journal.append(entry('retry', {retryOf: 'a', attempt: 1, state: 'QUEUED', createdAt: 101}), 101).status, 'APPENDED');
});

test('12 declared payload paths redact nested values and arrays before exposure', () => {
  const j = make({redactPaths: ['payload.secret', 'payload.nested.token', 'payload.items.0.value']});
  const a = entry('a', {payload: {secret: {raw: 'HIDDEN-ONE'}, nested: {token: 'HIDDEN-TWO', safe: 7},
    items: [{value: 'HIDDEN-THREE'}, {value: 'visible'}]}});
  j.append(a, 100);
  const stored = row(j, 'a').entry.payload;
  assert.deepEqual(stored, {secret: '[REDACTED]', nested: {token: '[REDACTED]', safe: 7},
    items: [{value: '[REDACTED]'}, {value: 'visible'}]});
  assert.doesNotMatch(j.serialize(), /HIDDEN-/);
  assert.deepEqual(a.payload.secret, {raw: 'HIDDEN-ONE'});
  assert.equal(j.append(a, 100).status, 'DUPLICATE');
  const r = reopen(j.serialize());
  assert.equal(r.journal.append(a, 100).status, 'DUPLICATE');
  assert.equal(r.journal.append({...a, payload: stored}, 100).status, 'CONFLICT');
  const missing = entry('missing', {payload: {secret: 'safe'}});
  assert.throws(() => j.append(missing, 100), code('REDACTION'));
});

test('13 complete persisted reopen is historical through replay and serialization cycles', () => {
  const j = make(); const a = entry('a', {payload: {savedPlan: {issued: true}, receipt: {status: 'PASS'}}});
  j.append(a, 100); const serialized = j.serialize();
  const r = reopen(serialized);
  assert.deepEqual(r.report, {status: 'COMPLETE', recoveredIds: ['a'], rejectedLine: null, reason: null, authorizing: false});
  assert.equal(row(r.journal, 'a').historical, true);
  assert.equal(row(r.journal, 'a').authorizing, false);
  assert.equal(r.journal.serialize(), serialized);
  assert.equal(r.journal.append(a, 100).status, 'DUPLICATE');
  assert.equal(row(r.journal, 'a').historical, true);
  r.journal.append(entry('fresh'), 100);
  assert.equal(row(r.journal, 'fresh').historical, false);
  const r2 = reopen(r.journal.serialize());
  assert.ok(r2.journal.list(100).every(x => x.historical && !x.authorizing));
  assert.deepEqual(Object.keys(r2.journal).sort(), ['append', 'list', 'retain', 'serialize']);
});

test('14 truncation recovers only committed prefix and cannot be resealed or appended', () => {
  const all = lines(fixture());
  const truncated = all.slice(0, 3).join('\n') + '\n' + all[3].slice(0, -7);
  const r = reopen(truncated);
  assert.deepEqual(r.report, {status: 'INCOMPLETE', recoveredIds: ['a', 'b'], rejectedLine: 4, reason: 'TRUNCATED', authorizing: false});
  assert.deepEqual(r.journal.list(100).map(x => x.entry.id), ['a', 'b']);
  assert.ok(r.journal.list(100).every(x => x.historical));
  for (const id of ['a', 'unseen']) assert.deepEqual(r.journal.append(entry(id), 100), {status: 'REFUSED', id, reason: 'SEALED'});
  assert.throws(() => r.journal.serialize(), code('SEALED'));
  const missingFooter = reopen(all.slice(0, -1).join('\n') + '\n');
  assert.deepEqual(missingFooter.report, {status: 'INCOMPLETE', recoveredIds: ['a', 'b', 'c'], rejectedLine: 5, reason: 'MISSING_FOOTER', authorizing: false});
  const noDelimiter = reopen(all.slice(0, 2).join('\n'));
  assert.deepEqual(noDelimiter.report.recoveredIds, []);
  assert.equal(noDelimiter.report.rejectedLine, 2);
});

test('15 invalid line stops recovery; deletion or reordering cannot bless later entries', () => {
  const all = lines(fixture());
  for (const bad of ['{broken}', all[2].replace('candidate-a', 'candidate-x')]) {
    const r = reopen([all[0], all[1], bad, all[3], all[4]].join('\n') + '\n');
    assert.deepEqual(r.report, {status: 'INVALID', recoveredIds: ['a'], rejectedLine: 3, reason: 'RECORD', authorizing: false});
  }
  for (const changed of [[all[0], all[2], all[1], all[3], all[4]], [all[0], all[2], all[3], all[4]]]) {
    const r = reopen(changed.join('\n') + '\n');
    assert.equal(r.report.status, 'INVALID'); assert.deepEqual(r.report.recoveredIds, []);
    assert.equal(r.report.rejectedLine, 2);
  }
});

test('16 footer mismatches and data after footer report uncertainty without losing recovered ids', () => {
  const serialized = fixture(); const all = lines(serialized);
  const footer = JSON.parse(all.at(-1)); footer.count++;
  const r = reopen([...all.slice(0, -1), canon(footer)].join('\n') + '\n');
  assert.deepEqual(r.report, {status: 'INVALID', recoveredIds: ['a', 'b', 'c'], rejectedLine: 5, reason: 'FOOTER', authorizing: false});
  for (const extra of ['garbage', '\n', all[1] + '\n']) {
    const trailing = reopen(serialized + extra);
    assert.deepEqual(trailing.report, {status: 'INVALID', recoveredIds: ['a', 'b', 'c'], rejectedLine: 6, reason: 'TRAILING_DATA', authorizing: false});
  }
});

test('17 closed persisted schema rejects profiles, duplicate ids and semantically invalid records', () => {
  for (const bytes of ['', '{}\n', fixture().replace('nisi-run-journal-v1', 'nisi-run-journal-v2')]) {
    const r = reopen(bytes);
    assert.equal(r.journal, null);
    assert.deepEqual(r.report, {status: 'INVALID', recoveredIds: [], rejectedLine: 1, reason: 'HEADER', authorizing: false});
  }
  const mutations = [v => {v[2].record.entry.id = 'a';}, v => {v[2].record.entry.projectId = 'foreign';},
    v => {v[2].record.entry.state = 'MAGIC';}, v => {v[2].record.historical = false;},
    v => {v[2].record.retained = false;}, v => {v[2].record.entry.createdAt = 101;},
    v => {v[2].record.entry.revokes = 'missing'; v[2].record.entry.state = 'REVOKED';}];
  for (const mutate of mutations) {
    const r = reopen(rewrite(fixture(), mutate));
    assert.equal(r.report.status, 'INVALID');
    assert.deepEqual(r.report.recoveredIds, ['a']); assert.equal(r.report.rejectedLine, 3);
  }
});

test('18 snapshots are deeply frozen, caller-independent and serialization is deterministic', () => {
  const cfg = config(); const j = createRunJournal(cfg); cfg.maxEntries = 99;
  const a = entry('a', {payload: {nested: [1, {value: 2}]}}); j.append(a, 100);
  a.payload.nested[1].value = 99;
  const view = row(j, 'a');
  assert.equal(view.entry.payload.nested[1].value, 2);
  assert.ok(Object.isFrozen(j.list(100)) && Object.isFrozen(view) && Object.isFrozen(view.entry.payload.nested[1]));
  assert.throws(() => {view.entry.payload.nested[1].value = 8;}, TypeError);
  const twin = make(); twin.append(entry('a', {payload: {nested: [1, {value: 2}]}}), 100);
  assert.equal(j.serialize(), twin.serialize());
  const encoded = lines(j.serialize()).map(JSON.parse);
  assert.equal(encoded[1].record.fingerprint, hash('nisi-run-journal/input/v1\n' + canon(entry('a', {payload: {nested: [1, {value: 2}]}}))));
  assert.equal(encoded[1].seq, 1);
  assert.equal(encoded[1].previousHash, hash('nisi-run-journal/header/v1\n' + canon(encoded[0])));
});
