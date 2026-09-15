import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixedRunJournalEntry as build } from '../history/fixed-run-journal-entry.mjs';
import { createRunJournal, reopen } from '../history/run-journal-v1.mjs';

const load = async (name) => JSON.parse(await readFile(new URL(`./fixtures/fixed-run/${name}.json`, import.meta.url), 'utf8'));
const OBSERVED = await load('summary-observed');
const NOT_MATCHED = await load('summary-canaries-not-matched');
const TIMEOUT = await load('summary-timeout');
const NO_IDENTITY = await load('summary-identity-unavailable');
const clone = (x) => JSON.parse(JSON.stringify(x));
const input = (patch = {}) => ({ summary: clone(OBSERVED), projectId: 'project-a', runId: 'run-a', attempt: 0,
  candidateId: 'candidate-a', receiptId: 'receipt-a', createdAt: 100, ttlMs: 1000, ...patch });
const withSummary = (mutate, base = OBSERVED, patch = {}) => { const s = clone(base); mutate(s); return input({ summary: s, ...patch }); };
const ENTRY_KEYS = ['id', 'projectId', 'runId', 'attempt', 'candidateId', 'stage', 'receiptId', 'createdAt', 'ttlMs', 'state', 'heartbeatAt', 'retryOf', 'revokes', 'payload'];
const PAYLOAD_KEYS = ['schemaVersion', 'summarySchema', 'overall', 'gate', 'reasons', 'identity', 'lifecycle', 'adaptation', 'adjudication', 'table', 'isolationAccepted', 'generatedCodeExecuted', 'authorizing'];
const config = (patch = {}) => ({ projectId: 'project-a', maxEntries: 8, heartbeatTtlMs: 10, redactPaths: [], ...patch });
const refused = (result, reason, label = '') => {
  assert.equal(result && result.status, 'REFUSED', `${label} ${JSON.stringify(result)}`);
  assert.equal(result.reason, reason, label);
  assert.equal(result.authorizing, false, label);
  assert.deepEqual(Object.keys(result), ['status', 'reason', 'authorizing'], label);
};

test('the observed run becomes a SUCCEEDED fixed-run entry with the exact shape', () => {
  const r = build(input());
  assert.deepEqual(Object.keys(r), ['status', 'entry', 'authorizing']);
  assert.equal(r.status, 'ENTRY');
  assert.equal(r.authorizing, false);
  const e = r.entry;
  assert.deepEqual(Object.keys(e), ENTRY_KEYS);
  assert.equal(e.id, 'run-a:0:fixed-run');
  assert.equal(e.projectId, 'project-a');
  assert.equal(e.runId, 'run-a');
  assert.equal(e.attempt, 0);
  assert.equal(e.candidateId, 'candidate-a');
  assert.equal(e.stage, 'fixed-run');
  assert.equal(e.receiptId, 'receipt-a');
  assert.equal(e.createdAt, 100);
  assert.equal(e.ttlMs, 1000);
  assert.equal(e.state, 'SUCCEEDED');
  assert.equal(e.heartbeatAt, null);
  assert.equal(e.retryOf, null);
  assert.equal(e.revokes, null);
  const p = e.payload;
  assert.deepEqual(Object.keys(p), PAYLOAD_KEYS);
  assert.equal(p.schemaVersion, 'nisi-fixed-run-entry/v1');
  assert.equal(p.summarySchema, 'nisi-fixed-run-summary/v1');
  assert.equal(p.overall, 'OBSERVED');
  assert.equal(p.gate, 'RUN_COMPLETE');
  assert.deepEqual(p.reasons, []);
  assert.deepEqual(p.identity, OBSERVED.identity);
  assert.deepEqual(Object.keys(p.identity), ['childPid', 'servicePid', 'waitObservedPid']);
  assert.deepEqual(p.lifecycle, OBSERVED.lifecycle);
  assert.deepEqual(Object.keys(p.lifecycle), Object.keys(OBSERVED.lifecycle));
  assert.deepEqual(Object.keys(p.adaptation), ['version', 'counts', 'report']);
  assert.deepEqual(p.adaptation, { version: OBSERVED.adaptation.version, counts: OBSERVED.adaptation.counts, report: OBSERVED.adaptation.report });
  assert.deepEqual(Object.keys(p.adjudication), ['overall', 'counts', 'malformedLines', 'unexpectedOperations']);
  assert.deepEqual(p.adjudication, { overall: 'ALL_MATCHED', counts: OBSERVED.adjudication.counts,
    malformedLines: OBSERVED.adjudication.malformedLines, unexpectedOperations: OBSERVED.adjudication.unexpectedOperations });
  assert.equal(p.table, OBSERVED.table);
  assert.equal(p.isolationAccepted, false);
  assert.equal(p.generatedCodeExecuted, false);
  assert.equal(p.authorizing, false);
});

test('every NOT_ACCEPTED summary becomes a FAILED entry that keeps its reasons and table', () => {
  const nm = build(input({ summary: clone(NOT_MATCHED) })).entry;
  assert.equal(nm.state, 'FAILED');
  assert.deepEqual(nm.payload.reasons, ['CANARIES_NOT_MATCHED']);
  assert.equal(nm.payload.gate, 'RUN_COMPLETE');
  assert.equal(nm.payload.overall, 'NOT_ACCEPTED');
  assert.equal(nm.payload.adjudication.overall, 'NOT_ACCEPTED');
  assert.equal(nm.payload.table, NOT_MATCHED.table);
  assert.match(nm.payload.table, /^- outside-read: expected DENIED errno 1, observed ALLOWED \(errno 0\) -> MISMATCH$/m);
  const to = build(input({ summary: clone(TIMEOUT) })).entry;
  assert.equal(to.state, 'FAILED');
  assert.deepEqual(to.payload.reasons, ['SIGNALED', 'NONZERO_EXIT', 'STDOUT_NOT_DRAINED', 'TIMEOUT']);
  assert.equal(to.payload.gate, 'RUN_INCOMPLETE');
  assert.equal(to.payload.lifecycle.signal, 'SIGKILL');
  assert.equal(to.payload.lifecycle.exitCode, null);
  assert.equal(to.payload.table, TIMEOUT.table);
  assert.equal(to.payload.adjudication.overall, 'ALL_MATCHED');
  const ni = build(input({ summary: clone(NO_IDENTITY) })).entry;
  assert.equal(ni.state, 'FAILED');
  assert.deepEqual(ni.payload.reasons, ['IDENTITY_UNAVAILABLE']);
  assert.deepEqual(ni.payload.identity, { childPid: null, servicePid: 20279, waitObservedPid: 20280 });
  assert.equal(ni.payload.adaptation, null);
  assert.equal(ni.payload.adjudication, null);
  assert.equal(ni.payload.table, null);
});

test('the entry is accepted by the accepted run journal: append, duplicate, conflict, reopen and redaction', () => {
  const j = createRunJournal(config());
  assert.deepEqual(j.append(build(input()).entry, 100), { status: 'APPENDED', id: 'run-a:0:fixed-run' });
  assert.deepEqual(j.append(build(input()).entry, 100), { status: 'DUPLICATE', id: 'run-a:0:fixed-run' });
  assert.deepEqual(j.append(build(input({ summary: clone(NOT_MATCHED) })).entry, 100),
    { status: 'CONFLICT', id: 'run-a:0:fixed-run', reason: 'ID_CONTENT_MISMATCH' });
  assert.deepEqual(j.append(build(input({ summary: clone(TIMEOUT), attempt: 1, candidateId: 'candidate-b' })).entry, 200),
    { status: 'APPENDED', id: 'run-a:1:fixed-run' });
  const rows = j.list(200);
  assert.deepEqual(rows.map(r => [r.entry.id, r.entry.state, r.liveness, r.retained, r.authorizing]),
    [['run-a:0:fixed-run', 'SUCCEEDED', 'SUCCEEDED', true, false], ['run-a:1:fixed-run', 'FAILED', 'FAILED', true, false]]);
  assert.equal(rows[0].entry.payload.table, OBSERVED.table);
  assert.deepEqual(rows[1].entry.payload.reasons, TIMEOUT.reasons);
  const reopened = reopen(j.serialize());
  assert.deepEqual(reopened.report, { status: 'COMPLETE', recoveredIds: ['run-a:0:fixed-run', 'run-a:1:fixed-run'], rejectedLine: null, reason: null, authorizing: false });
  assert.equal(reopened.journal.serialize(), j.serialize());
  const redacting = createRunJournal(config({ redactPaths: ['payload.table', 'payload.adaptation.report'] }));
  assert.equal(redacting.append(build(input()).entry, 100).status, 'APPENDED');
  const view = redacting.list(100)[0].entry.payload;
  assert.equal(view.table, '[REDACTED]');
  assert.equal(view.adaptation.report, '[REDACTED]');
  assert.deepEqual(view.adjudication.counts, OBSERVED.adjudication.counts);
});

test('non-object input throws TypeError; every field is checked in a fixed order with a named refusal', () => {
  for (const bad of [undefined, null, [], 'input', 42, () => {}]) assert.throws(() => build(bad), TypeError, JSON.stringify(bad));
  refused(build({}), 'INVALID_INPUT', 'empty');
  refused(build(input({ extra: true })), 'INVALID_INPUT', 'extra key');
  refused(build(Object.create(input())), 'INVALID_INPUT', 'inherited only');
  const { receiptId, ...missingReceipt } = input();
  refused(build(missingReceipt), 'INVALID_INPUT', 'missing key');
  for (const bad of [null, [], 'summary', 42]) refused(build(input({ summary: bad })), 'INVALID_SUMMARY', JSON.stringify(bad));
  for (const projectId of ['', 'bad id!', 7, undefined, null, '-leading']) refused(build(input({ projectId })), 'INVALID_PROJECT', String(projectId));
  for (const runId of ['', 7, undefined, 'a/b']) refused(build(input({ runId })), 'INVALID_RUN', String(runId));
  for (const candidateId of ['', null, ' x']) refused(build(input({ candidateId })), 'INVALID_CANDIDATE', String(candidateId));
  for (const receiptId of [7, undefined, '', 'bad id!']) refused(build(input({ receiptId })), 'INVALID_RECEIPT', String(receiptId));
  assert.equal(build(input({ receiptId: null })).entry.receiptId, null);
  for (const attempt of [-1, 1.5, '0', undefined, null, -0]) refused(build(input({ attempt })), 'INVALID_ATTEMPT', String(attempt));
  for (const patch of [{ createdAt: -1 }, { createdAt: 1.5 }, { createdAt: '100' }, { createdAt: -0 }, { ttlMs: 0 }, { ttlMs: 1.5 },
    { ttlMs: '1000' }, { createdAt: Number.MAX_SAFE_INTEGER, ttlMs: 2 }]) refused(build(input(patch)), 'INVALID_TIME', JSON.stringify(patch));
  assert.equal(build(input({ createdAt: 0, ttlMs: 1 })).entry.id, 'run-a:0:fixed-run');
  assert.equal(build(input({ runId: 'r'.repeat(116) })).entry.id, 'r'.repeat(116) + ':0:fixed-run');
  refused(build(input({ runId: 'r'.repeat(117) })), 'ID_TOO_LONG', '117 + 12 > 128');
  assert.equal(build(input({ runId: 'r'.repeat(101), attempt: 9007199254740991 })).entry.id, 'r'.repeat(101) + ':9007199254740991:fixed-run');
  refused(build(input({ runId: 'r'.repeat(102), attempt: 9007199254740991 })), 'ID_TOO_LONG', 'attempt digits count');
  refused(build(input({ summary: null, projectId: '' })), 'INVALID_SUMMARY', 'summary before project');
  refused(build(input({ projectId: '', runId: '' })), 'INVALID_PROJECT', 'project before run');
  refused(build(input({ runId: '', candidateId: '' })), 'INVALID_RUN', 'run before candidate');
  refused(build(input({ candidateId: '', receiptId: 7 })), 'INVALID_CANDIDATE', 'candidate before receipt');
  refused(build(input({ receiptId: 7, attempt: -1 })), 'INVALID_RECEIPT', 'receipt before attempt');
  refused(build(input({ attempt: -1, ttlMs: 0 })), 'INVALID_ATTEMPT', 'attempt before time');
  refused(build(input({ ttlMs: 0, runId: 'r'.repeat(120) })), 'INVALID_TIME', 'time before id length');
  refused(build({ ...input({ summary: null }), extra: 1 }), 'INVALID_INPUT', 'input before summary');
  const hidden = input(); Object.defineProperty(hidden, 'receiptId', { value: 'receipt-a', enumerable: false, configurable: true, writable: true }); hidden.extra = 1;
  refused(build(hidden), 'INVALID_INPUT', 'a non-enumerable required key does not stand in for an extra enumerable one');
  const throwing = () => { throw new Error('getter invoked'); };
  const throwingProject = input({ summary: null }); Object.defineProperty(throwingProject, 'projectId', { get: throwing, enumerable: true, configurable: true });
  refused(build(throwingProject), 'INVALID_SUMMARY', 'later fields are not read before the summary refusal');
  const accessorProject = input(); Object.defineProperty(accessorProject, 'projectId', { get: throwing, enumerable: true, configurable: true });
  refused(build(accessorProject), 'INVALID_PROJECT', 'an accessor field refuses at its own stage without invoking the getter');
  const accessorTtl = input(); Object.defineProperty(accessorTtl, 'ttlMs', { get: throwing, enumerable: true, configurable: true });
  refused(build(accessorTtl), 'INVALID_TIME', 'an accessor time field refuses at its own stage');
  refused(build(withSummary(s => { s.lifecycle.signal = 1.5; }, OBSERVED, { runId: 'r'.repeat(120) })), 'ID_TOO_LONG', 'id length before representability');
});

test('a summary that does not satisfy the v1 contract is refused before anything is built', () => {
  const observedCases = [
    s => { delete s.table; },
    s => { s.extra = 1; },
    s => { s.schemaVersion = 'nisi-fixed-run-summary/v2'; },
    s => { s.gate = 'DONE'; },
    s => { s.reasons = 'none'; },
    s => { s.reasons = ['MYSTERY']; },
    s => { s.overall = 'NOT_ACCEPTED'; },
    s => { s.overall = 'ACCEPTED'; },
    s => { s.isolationAccepted = true; },
    s => { s.generatedCodeExecuted = 0; },
    s => { s.authorizing = 'no'; },
    s => { s.identity.childPid = 0; },
    s => { s.identity.extra = 1; },
    s => { delete s.identity.waitObservedPid; },
    s => { s.lifecycle.spawnReturn = '0'; },
    s => { s.lifecycle.stdoutEOF = 'true'; },
    s => { delete s.lifecycle.timeout; },
    s => { s.lifecycle.extra = null; },
    s => { s.adaptation = null; },
    s => { s.adaptation = 'mapped'; },
    s => { delete s.adaptation.report; },
    s => { s.adjudication = null; },
    s => { s.adjudication.overall = 'NOT_ACCEPTED'; },
    s => { s.adjudication.overall = 'MATCHED'; },
    s => { s.adjudication.isolationAccepted = true; },
    s => { delete s.adjudication.counts; },
    s => { s.table = 7; },
    s => { s.table = null; }
  ];
  for (const [i, mutate] of observedCases.entries()) refused(build(withSummary(mutate)), 'INVALID_SUMMARY', `observed case ${i}`);
  const reordered = Object.fromEntries(Object.entries(clone(OBSERVED)).reverse());
  refused(build(input({ summary: reordered })), 'INVALID_SUMMARY', 'reordered keys');
  const timeoutCases = [
    s => { s.reasons = ['NONZERO_EXIT', 'SIGNALED', 'STDOUT_NOT_DRAINED', 'TIMEOUT']; },
    s => { s.reasons = ['SIGNALED', 'SIGNALED', 'NONZERO_EXIT', 'STDOUT_NOT_DRAINED', 'TIMEOUT']; },
    s => { s.gate = 'RUN_COMPLETE'; },
    s => { s.overall = 'OBSERVED'; },
    s => { s.lifecycle.signal = true; },
    s => { s.lifecycle.signal = {}; }
  ];
  for (const [i, mutate] of timeoutCases.entries()) refused(build(withSummary(mutate, TIMEOUT)), 'INVALID_SUMMARY', `timeout case ${i}`);
  refused(build(withSummary(s => { s.adjudication.overall = 'ALL_MATCHED'; }, NOT_MATCHED)), 'INVALID_SUMMARY', 'reasons say not matched');
  refused(build(withSummary(s => { s.reasons = []; s.overall = 'OBSERVED'; }, NOT_MATCHED)), 'INVALID_SUMMARY', 'adjudication says not matched');
  refused(build(withSummary(s => { s.table = 'x'; }, NO_IDENTITY)), 'INVALID_SUMMARY', 'table without identity');
  refused(build(withSummary(s => { s.adjudication = clone(OBSERVED.adjudication); }, NO_IDENTITY)), 'INVALID_SUMMARY', 'adjudication without identity');
  refused(build(withSummary(s => { s.reasons = []; s.overall = 'OBSERVED'; s.gate = 'RUN_COMPLETE'; }, NO_IDENTITY)), 'INVALID_SUMMARY', 'identity missing but not reported');
  refused(build(withSummary(s => { s.reasons = ['IDENTITY_UNAVAILABLE', 'CANARIES_NOT_MATCHED']; }, NO_IDENTITY)), 'INVALID_SUMMARY', 'canary reason without adjudication');
  refused(build(withSummary(s => { s.identity = { waitObservedPid: 20280, servicePid: 20279, childPid: 20280 }; })), 'INVALID_SUMMARY', 'identity keys out of order');
  const boom = () => { throw new Error('getter invoked'); };
  refused(build(withSummary(s => { Object.defineProperty(s, 'table', { get: boom, enumerable: true, configurable: true }); })), 'INVALID_SUMMARY', 'an accessor summary field refuses without invoking the getter');
  refused(build(withSummary(s => { Object.defineProperty(s.identity, 'childPid', { get: boom, enumerable: true, configurable: true }); })), 'INVALID_SUMMARY', 'an accessor identity field refuses without invoking the getter');
  refused(build(withSummary(s => { s.reasons = [, 'TIMEOUT']; }, TIMEOUT)), 'INVALID_SUMMARY', 'a hole is not a reason code');
  assert.equal(build(withSummary(s => { s.adaptation.adaptedOutput = 'ignored'; s.adjudication.rows = []; })).status, 'ENTRY', 'extra adapter/adjudicator fields are not copied and not refused');
});

test('a summary the journal cannot hold is refused as PAYLOAD_UNREPRESENTABLE, never coerced', () => {
  const cases = [
    s => { s.lifecycle.signal = 1.5; },
    s => { s.lifecycle.signal = Number.NaN; },
    s => { s.lifecycle.rawWaitStatus = -0; },
    s => { s.adaptation.counts.mapped = 2.5; },
    s => { s.adaptation.report[0].extra = undefined; },
    s => { s.adaptation.report.push(Symbol('x')); },
    s => { s.adjudication.counts.matched = 5n; },
    s => { s.adjudication.unexpectedOperations = new Map(); },
    s => { s.table = '\ud800'; },
    s => { Object.setPrototypeOf(s.adaptation.report[0], { polluted: true }); },
    s => { Object.defineProperty(s.adaptation.counts, '__proto__', { value: 1, enumerable: true, configurable: true, writable: true }); },
    s => { s.adjudication.malformedLines = () => 0; },
    s => { s.reasons.some = 0; },
    s => { s.reasons.includes = 0; },
    s => { Object.setPrototypeOf(s.reasons, null); },
    s => { Object.defineProperty(s.adaptation.counts, 'lazy', { get() { return 1; }, enumerable: true, configurable: true }); },
    s => { s.adaptation.counts[Symbol('k')] = 1; },
    s => { s.adaptation.report[0].self = s.adaptation.report[0]; },
    s => { s.adaptation.counts.mapped = 2 ** 53; },
    s => { s.adaptation.counts['\ud800'] = 1; },
    s => { s.adaptation.counts.prototype = 1; },
    s => { s.adaptation.counts.constructor = 1; },
    s => { s.adaptation.report = [s.adaptation.report[0], , s.adaptation.report[1]]; },
    s => { s.adaptation.report.extra = 1; },
    s => { class Report extends Array {} s.adaptation.report = Report.from(s.adaptation.report); },
    s => { Object.defineProperty(s.adaptation.counts, 'hidden', { value: 1, enumerable: false }); }
  ];
  for (const [i, mutate] of cases.entries()) refused(build(withSummary(mutate)), 'PAYLOAD_UNREPRESENTABLE', `case ${i}`);
  refused(build(withSummary(s => { s.reasons.some = 0; s.reasons.includes = 0; }, TIMEOUT)), 'PAYLOAD_UNREPRESENTABLE', 'input array methods are never called');
  refused(build(withSummary(s => { Object.setPrototypeOf(s.reasons, null); }, TIMEOUT)), 'PAYLOAD_UNREPRESENTABLE', 'a null-prototype reasons array is validated by index, then refused as unrepresentable');
  const r = build(withSummary(s => { s.lifecycle.signal = 9; }));
  assert.equal(r.status, 'ENTRY');
  assert.equal(r.entry.payload.lifecycle.signal, 9);
  const nullProto = build(withSummary(s => { const c = Object.create(null); Object.assign(c, s.adaptation.counts); s.adaptation.counts = c; }));
  assert.equal(nullProto.status, 'ENTRY', 'null-prototype objects are representable');
  assert.deepEqual(nullProto.entry.payload.adaptation.counts, OBSERVED.adaptation.counts);
  assert.equal(Object.getPrototypeOf(nullProto.entry.payload.adaptation.counts), Object.prototype);
  const shared = build(withSummary(s => { s.adaptation.report[1] = s.adaptation.report[0]; }));
  assert.equal(shared.status, 'ENTRY', 'shared acyclic references are representable');
  assert.notEqual(shared.entry.payload.adaptation.report[0], shared.entry.payload.adaptation.report[1]);
  assert.deepEqual(shared.entry.payload.adaptation.report[0], shared.entry.payload.adaptation.report[1]);
  const ignored = build(withSummary(s => { s.adaptation.adaptedOutput = Symbol('ignored'); s.adjudication.rows = [1.5, undefined]; s.adjudication.extra = () => {}; }));
  assert.equal(ignored.status, 'ENTRY', 'unrepresentable values in ignored fields are never inspected');
});

test('inputs are never mutated, results are fresh and identical across calls', () => {
  const deepFreeze = (x) => { if (x && typeof x === 'object') { Object.freeze(x); for (const v of Object.values(x)) deepFreeze(v); } return x; };
  const frozen = deepFreeze(input());
  const before = JSON.stringify(frozen);
  const a = build(frozen);
  const b = build(frozen);
  assert.notEqual(a, b);
  assert.notEqual(a.entry, b.entry);
  assert.notEqual(a.entry.payload, b.entry.payload);
  assert.deepEqual(a, b);
  assert.notEqual(a.entry.payload.identity, frozen.summary.identity);
  assert.notEqual(a.entry.payload.lifecycle, frozen.summary.lifecycle);
  assert.notEqual(a.entry.payload.reasons, frozen.summary.reasons);
  assert.notEqual(a.entry.payload.adaptation.report, frozen.summary.adaptation.report);
  assert.notEqual(a.entry.payload.adaptation.counts, frozen.summary.adaptation.counts);
  assert.notEqual(a.entry.payload.adjudication.counts, frozen.summary.adjudication.counts);
  assert.notEqual(a.entry.payload.adaptation.report[0], frozen.summary.adaptation.report[0]);
  assert.notEqual(a.entry.payload.adaptation.report[0], b.entry.payload.adaptation.report[0]);
  assert.notEqual(a.entry.payload.adjudication.unexpectedOperations, frozen.summary.adjudication.unexpectedOperations);
  a.entry.payload.adaptation.report[0].line = 999;
  assert.equal(b.entry.payload.adaptation.report[0].line, frozen.summary.adaptation.report[0].line);
  assert.equal(JSON.stringify(frozen), before);
  a.entry.payload.reasons.push('TAMPERED');
  a.entry.state = 'REVOKED';
  a.entry.payload.adaptation.report.length = 0;
  assert.deepEqual(build(frozen), b);
  const j = createRunJournal(config());
  assert.equal(j.append(build(frozen).entry, 100).status, 'APPENDED');
  assert.equal(j.append(build(frozen).entry, 100).status, 'DUPLICATE');
});

test('entry module has no imports, exports only the builder and stays pure', async () => {
  const source = await readFile(new URL('../history/fixed-run-journal-entry.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\b/);
  assert.doesNotMatch(source, /\b(?:require|process|fetch|XMLHttpRequest|eval|Function|setTimeout|setInterval|globalThis|structuredClone)\b/);
  assert.doesNotMatch(source, /\b(?:Date|performance)\b|Math\s*\.\s*random\b/);
  const namespace = await import('../history/fixed-run-journal-entry.mjs');
  assert.deepEqual(Object.keys(namespace), ['fixedRunJournalEntry']);
  assert.equal(typeof namespace.fixedRunJournalEntry, 'function');
});
