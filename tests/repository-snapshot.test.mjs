// Private contract tests. No candidate program, native tool or model is executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCandidate, sha256Text } from '../workflow/contracts.mjs';
import { runWorkflow } from '../workflow/engine.mjs';
import {
  createRepositorySnapshot, prepareRepositoryCandidate, REPOSITORY_SNAPSHOT_LIMITS,
} from '../hosts/repository/snapshot-contract.mjs';

const MIB = 1_048_576;
const file = (path, content = 'text') => ({ path, content });
const snapshot = files => createRepositorySnapshot({ files });
const rawCandidate = () => ({ files: [file('src/main.mjs', 'export const answer = 42;')] });
const task = (overrides = {}) => ({
  taskId: 'fixture.change', mode: 'edit', language: 'javascript',
  allowedFiles: ['src/main.mjs', 'tests/check.mjs', 'src/new.mjs'],
  protectedFiles: ['tests/check.mjs'],
  protectedSnapshots: { 'tests/check.mjs': sha256Text('protected tests') },
  acceptanceCriteria: ['Satisfy fixed requirements'],
  policy: { repairBudget: 1, totalDeadlineMs: 1000, requiredReviewers: 1, requireReportStore: false },
  ...overrides,
});
const baseline = (dependency = 'unchanged dependency', tests = 'protected tests') => snapshot([
  file('src/main.mjs', 'export const answer = 0;'),
  file('tests/check.mjs', tests), file('vendor/input.txt', dependency),
]);
const prepare = (overrides = {}) => prepareRepositoryCandidate({
  baseline: baseline(), task: task(), candidate: rawCandidate(), authorId: 'author.primary', ...overrides,
});
const rejects = (fn, code) => assert.throws(fn, error => error.code === code);

test('snapshot sorts and binds UTF-8 encoding of captured text with a domain-separated identity', () => {
  const a = snapshot([file('z.txt', 'é'), file('a.txt', '')]);
  const b = snapshot([file('a.txt', ''), file('z.txt', 'é')]);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.deepEqual(a.files.map(f => f.path), ['a.txt', 'z.txt']);
  assert.equal(a.totalBytes, 2);
  assert.equal(a.files[1].byteLength, 2);
  assert.equal(a.files[1].sha256, createHash('sha256').update(Buffer.from([0xc3, 0xa9])).digest('hex'));
  assert.match(a.fingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(a.fingerprint, a.files[1].sha256);
  assert.notEqual(a.fingerprint, snapshot([file('a.txt', ''), file('z.txt', 'e\u0301')]).fingerprint);
});

test('captured input and returned snapshots cannot mutate identity or file content', () => {
  const input = { files: [file('a.txt', 'original')] };
  const out = createRepositorySnapshot(input);
  const before = out.fingerprint;
  input.files[0].content = 'edited'; input.files.push(file('b.txt'));
  assert.equal(out.files[0].content, 'original');
  assert.equal(out.files.length, 1);
  assert.equal(out.fingerprint, before);
  assert.throws(() => { out.files[0].content = 'mutate'; }, TypeError);
  assert.throws(() => { out.fingerprint = 'forged'; }, TypeError);
  assert.throws(() => out.files.push(file('c.txt')), TypeError);
  assert(Object.isFrozen(REPOSITORY_SNAPSHOT_LIMITS));
});

test('snapshot objects reject unknown keys, accessors and prototypes without invoking getters', () => {
  let reads = 0;
  const getter = { get files() { reads += 1; return [file('a')]; } };
  const hidden = { files: [file('a')] }; Object.defineProperty(hidden, 'authority', { value: true });
  const symbol = { files: [file('a')], [Symbol('authority')]: true };
  for (const input of [null, [], { files: [file('a')], authorizing: true }, getter, hidden, symbol,
    Object.create({ files: [file('a')] }), new (class { files = [file('a')]; })()]) {
    rejects(() => createRepositorySnapshot(input), 'REPOSITORY_SNAPSHOT_SCHEMA');
  }
  const badFile = { path: 'a', get content() { reads += 1; return 'x'; } };
  for (const f of [badFile, { ...file('a'), type: 'symlink' }, Object.create(file('a'))]) {
    rejects(() => snapshot([f]), 'REPOSITORY_FILE_SCHEMA');
  }
  assert.equal(reads, 0);
  const plainNull = Object.assign(Object.create(null), { files: [Object.assign(Object.create(null), file('a'))] });
  assert.equal(createRepositorySnapshot(plainNull).files.length, 1);
});

test('file arrays reject sparse, decorated and accessor entries and enforce file-count bounds', () => {
  let reads = 0;
  const sparse = Array(1);
  const decorated = [file('a')]; decorated.extra = true;
  const symbol = [file('a')]; symbol[Symbol('x')] = true;
  const accessor = [file('a')]; Object.defineProperty(accessor, '0', { get() { reads += 1; return file('b'); } });
  for (const files of [sparse, decorated, symbol, accessor, new (class extends Array {})(file('a'))]) {
    rejects(() => snapshot(files), 'REPOSITORY_FILES_SCHEMA');
  }
  for (const files of [[], Array.from({ length: 1025 }, (_, i) => file(`f${i}`))]) {
    rejects(() => snapshot(files), 'REPOSITORY_FILES_LIMIT');
  }
  assert.equal(reads, 0);
  assert.equal(snapshot(Array.from({ length: 1024 }, (_, i) => file(`f${i}`, ''))).files.length, 1024);
});

test('initial path profile refuses unsupported spellings and ambiguous platform paths', () => {
  const invalid = ['', '.', '..', '/a', 'a/', 'a//b', 'a/../b', 'a/./b', 'a\\b', 'C:a', 'C:/a',
    'a\0b', 'a b', 'a\nb', 'é.txt', '😀', 'a.', 'dir./file', 'CON', 'con.txt', 'AUX/ok', 'COM9.txt',
    'LPT1', 'nul.log', 'a'.repeat(256), `${'a'.repeat(255)}/${'b'.repeat(255)}/c`];
  for (const p of invalid) rejects(() => snapshot([file(p)]), 'REPOSITORY_PATH_INVALID');
  assert.equal(snapshot([file('a'), file('ab'), file('conifer.txt'), file('.config/x-y_1.txt')]).files.length, 4);
  assert.equal(snapshot([file('a'.repeat(255))]).files[0].path.length, 255);
});

test('case-folded duplicate and prefix paths are refused in either order', () => {
  for (const names of [['a', 'a'], ['A', 'a'], ['SRC/a.txt', 'src/A.TXT']]) {
    rejects(() => snapshot(names.map(p => file(p))), 'REPOSITORY_PATH_COLLISION');
  }
  for (const names of [['a', 'a/b'], ['a/b', 'a'], ['A', 'A/b']]) {
    rejects(() => snapshot(names.map(p => file(p))), 'REPOSITORY_PATH_PREFIX_COLLISION');
  }
  for (const names of [['SRC/a', 'src/b'], ['a', 'A/b']]) {
    rejects(() => snapshot(names.map(p => file(p))), 'REPOSITORY_PATH_CASE_COLLISION');
  }
});

test('content is well-formed text only, never binary or deletion markers', () => {
  for (const value of [null, undefined, 5, Buffer.from('x'), new Uint8Array([1]), new String('x')]) {
    rejects(() => snapshot([{ path: 'a', content: value }]), 'REPOSITORY_CONTENT_LIMIT');
  }
  for (const value of ['\ud800', '\udc00', 'ok\ud800end', '\ud800\ud800']) {
    rejects(() => snapshot([file('a', value)]), 'REPOSITORY_CONTENT_UNICODE');
  }
  assert.equal(snapshot([file('a', '😀')]).files[0].byteLength, 4);
  rejects(() => snapshot([{ path: 'a' }]), 'REPOSITORY_FILE_SCHEMA');
});

test('UTF-8 accounting admits exact byte bounds and rejects multibyte overflow', () => {
  assert.equal(snapshot([file('a', '😀'.repeat(MIB / 4))]).totalBytes, MIB);
  rejects(() => snapshot([file('a', '😀'.repeat(MIB / 4 + 1))]), 'REPOSITORY_CONTENT_LIMIT');
  rejects(() => snapshot([file('a', 'a'.repeat(MIB + 1))]), 'REPOSITORY_CONTENT_LIMIT');
  const full = Array.from({ length: 8 }, (_, i) => file(`f${i}`, 'a'.repeat(MIB)));
  assert.equal(snapshot(full).totalBytes, 8 * MIB);
  rejects(() => snapshot([...full, file('extra', 'x')]), 'REPOSITORY_TOTAL_LIMIT');
});

test('preparation overlays only changed files and preserves omitted dependencies and tests', () => {
  const b = baseline(); const out = prepare({ baseline: b });
  const files = new Map(out.materialized.files.map(f => [f.path, f.content]));
  assert.equal(files.get('src/main.mjs'), 'export const answer = 42;');
  assert.equal(files.get('vendor/input.txt'), 'unchanged dependency');
  assert.equal(files.get('tests/check.mjs'), 'protected tests');
  assert.equal(b.files.find(f => f.path === 'src/main.mjs').content, 'export const answer = 0;');
  const added = prepare({ candidate: { files: [file('src/new.mjs', 'new')] } });
  assert.equal(added.materialized.files.length, 4);
  assert(Object.isFrozen(out)); assert(Object.isFrozen(out.task));
  assert.equal(out.executionStatus, 'NOT_RUN'); assert.equal(out.authorizing, false);
});

test('unchanged dependency changes preparation identity despite the same task and candidate', () => {
  const a = prepare({ baseline: baseline('dependency A') });
  const b = prepare({ baseline: baseline('dependency B') });
  assert.equal(a.taskFingerprint, b.taskFingerprint);
  assert.equal(a.candidateFingerprint, b.candidateFingerprint);
  assert.notEqual(a.baselineFingerprint, b.baselineFingerprint);
  assert.notEqual(a.materializedFingerprint, b.materializedFingerprint);
  assert.notEqual(a.fingerprint, b.fingerprint);
  assert.equal(a.fingerprint, prepare({ baseline: baseline('dependency A') }).fingerprint);
});

test('serialized or forged baselines cannot impersonate factory-issued snapshots', () => {
  const b = baseline();
  for (const fake of [{ ...b }, JSON.parse(JSON.stringify(b)), {}, null]) {
    rejects(() => prepare({ baseline: fake }), 'REPOSITORY_BASELINE_NOT_ISSUED');
  }
});

test('all protected baseline files must exist with their fixed digests even if omitted by candidate', () => {
  rejects(() => prepare({ baseline: baseline('dependency', 'tampered tests') }), 'REPOSITORY_PROTECTED_BASELINE_MISMATCH');
  rejects(() => prepare({ baseline: snapshot([file('src/main.mjs')]) }), 'REPOSITORY_PROTECTED_BASELINE_MISMATCH');
  rejects(() => prepare({ candidate: { files: [file('tests/check.mjs', 'changed')] } }), 'PROTECTED_FILE_CHANGED');
  assert.equal(prepare({ candidate: { files: [file('tests/check.mjs', 'protected tests')] } }).materialized.files.length, 3);
});

test('existing task, author, candidate scope and schemas remain enforced', () => {
  rejects(() => prepare({ candidate: { files: [file('vendor/input.txt', 'changed')] } }), 'CANDIDATE_FILE_OUT_OF_SCOPE');
  rejects(() => prepare({ authorId: 'INVALID' }), 'AUTHOR_ID_INVALID');
  rejects(() => prepare({ task: { ...task(), approved: true } }), 'TASK_SCHEMA');
  rejects(() => prepare({ candidate: { ...rawCandidate(), approved: true } }), 'REPOSITORY_CANDIDATE_SCHEMA');
  rejects(() => prepareRepositoryCandidate({ baseline: baseline(), task: task(), candidate: rawCandidate(), authorId: 'a', approved: true }), 'REPOSITORY_PREPARATION_SCHEMA');
  rejects(() => prepare({ candidate: { files: [{ path: 'src/main.mjs', delete: true }] } }), 'REPOSITORY_FILE_SCHEMA');
});

test('overlay rechecks combined path collisions and final resource bounds', () => {
  const scoped = path => task({ allowedFiles: [path], protectedFiles: [], protectedSnapshots: {} });
  const t = scoped('src/new.mjs');
  rejects(() => prepare({ task: scoped('src'), candidate: { files: [file('src')] } }), 'REPOSITORY_PATH_PREFIX_COLLISION');
  rejects(() => prepare({ task: scoped('SRC/other.mjs'), candidate: { files: [file('SRC/other.mjs')] } }), 'REPOSITORY_PATH_CASE_COLLISION');
  const full = snapshot(Array.from({ length: 8 }, (_, i) => file(`f${i}`, 'a'.repeat(MIB))));
  rejects(() => prepare({ baseline: full, task: t, candidate: { files: [file('src/new.mjs', 'x')] } }), 'REPOSITORY_TOTAL_LIMIT');
  const many = snapshot(Array.from({ length: 1024 }, (_, i) => file(`f${i}`, '')));
  rejects(() => prepare({ baseline: many, task: t, candidate: { files: [file('src/new.mjs', '')] } }), 'REPOSITORY_FILES_LIMIT');
});

test('repository scope refuses ambiguous or unsupported allowed and protected paths', () => {
  const inputs = [
    [['src/main.mjs', 'A', 'a'], 'REPOSITORY_PATH_COLLISION'],
    [['src/main.mjs', 'a', 'a/b'], 'REPOSITORY_PATH_PREFIX_COLLISION'],
    [['src/main.mjs', 'é.txt'], 'REPOSITORY_PATH_INVALID'],
    [['src/main.mjs', 'SRC/new.mjs'], 'REPOSITORY_PATH_CASE_COLLISION'],
  ];
  for (const [allowedFiles, code] of inputs) {
    rejects(() => prepare({ task: task({ allowedFiles, protectedFiles: [], protectedSnapshots: {} }) }), code);
  }
  const t = task(); t.allowedFiles.push('TESTS/check.mjs');
  rejects(() => prepare({ task: t }), 'REPOSITORY_PATH_COLLISION');
});

test('preparation descriptors reject getters and hidden fields without reading them', () => {
  let reads = 0;
  for (const name of ['baseline', 'task', 'candidate', 'authorId']) {
    const input = { baseline: baseline(), task: task(), candidate: rawCandidate(), authorId: 'author.primary' };
    Object.defineProperty(input, name, { get() { reads += 1; return null; }, enumerable: true });
    rejects(() => prepareRepositoryCandidate(input), 'REPOSITORY_PREPARATION_SCHEMA');
    Object.defineProperty(input, name, { value: null, enumerable: false });
    rejects(() => prepareRepositoryCandidate(input), 'REPOSITORY_PREPARATION_SCHEMA');
  }
  const hiddenTask = task(); Object.defineProperty(hiddenTask, 'language', { enumerable: false });
  rejects(() => prepare({ task: hiddenTask }), 'INPUT_PROPERTY_INVALID');
  const getterTask = task(); Object.defineProperty(getterTask, 'language', { get() { reads += 1; return 'js'; } });
  rejects(() => prepare({ task: getterTask }), 'INPUT_PROPERTY_INVALID');
  const hiddenCandidate = rawCandidate(); Object.defineProperty(hiddenCandidate, 'files', { enumerable: false });
  rejects(() => prepare({ candidate: hiddenCandidate }), 'REPOSITORY_CANDIDATE_SCHEMA');
  assert.equal(reads, 0);
});

test('preparation identities agree with the unchanged workflow candidate and run binding', async () => {
  const prepared = prepare();
  const candidate = createCandidate(rawCandidate(), { authorId: 'author.primary' });
  assert.equal(prepared.candidateFingerprint, candidate.fingerprint);
  const result = await runWorkflow(task(), { adapters: {
    authorizeContext: { authorize: ({ binding }) => ({ status: 'PASS', evidence: { ...binding, reason: '' } }) },
    author: { id: 'author.primary', draft: ({ binding }) => ({ candidate: rawCandidate(), evidence: { ...binding, candidateFingerprint: candidate.fingerprint, note: 'Fixed fixture candidate, no model call.' } }), repair() { throw Error('unexpected repair'); } },
    staticChecks: { check: ({ binding }) => ({ status: 'PASS', evidence: { ...binding, findings: [], reason: '' } }) },
    tests: { run: ({ binding }) => ({ status: 'PASS', evidence: { ...binding, assertionsExecuted: 1, assertionsPassed: 1, failures: [], reason: '' } }) },
    reviewers: [{ id: 'reviewer.fixture', review: ({ binding }) => ({ status: 'PASS', evidence: { ...binding, reviewerId: 'reviewer.fixture', findings: [], summary: 'Synthetic contract fixture only.', reason: '' } }) }],
  } });
  assert.equal(result.outcome, 'COMPLETED');
  assert.equal(result.taskFingerprint, prepared.taskFingerprint);
  assert.equal(result.candidateFingerprint, prepared.candidateFingerprint);
  // A callback fixture proving ID compatibility is NOT an execution receipt.
  assert.equal(prepared.executionStatus, 'NOT_RUN');
});
