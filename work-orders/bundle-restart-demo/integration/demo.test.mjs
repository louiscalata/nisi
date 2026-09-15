import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, symlinkSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunJournal, reopen } from './scratch/history/run-journal-v1.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'integration/scratch/fixtures/demo-cli.mjs');
const scratch = join(root, 'integration/scratch/.scratch');
mkdirSync(scratch, { recursive: true });
const OBSERVED = JSON.parse(readFileSync(join(root, 'integration/scratch/fixtures/summary-observed.json'), 'utf8'));
const TIMEOUT = JSON.parse(readFileSync(join(root, 'integration/scratch/fixtures/summary-timeout.json'), 'utf8'));
const CONFIG = { projectId: 'project-a', maxEntries: 8, heartbeatTtlMs: 10, redactPaths: [] };
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const RESULT_KEYS = ['status', 'reason', 'bundle', 'record', 'sha256', 'bytes', 'pid', 'authorizing', 'isolationAccepted', 'generatedCodeExecuted'];

function child(request) {
  const run = spawnSync(process.execPath, [cli], { input: JSON.stringify(request), encoding: 'utf8', timeout: 20000 });
  assert.equal(run.status, 0, `child exit ${run.status}: ${run.stderr}`);
  const lines = run.stdout.trim().split('\n');
  assert.equal(lines.length, 1, 'exactly one response line');
  const envelope = JSON.parse(lines[0]);
  assert.equal(envelope.schema, 'nisi-bundle-demo-child/v1');
  assert.equal(typeof envelope.pid, 'number');
  assert.equal(envelope.result.pid, envelope.pid, 'the result reports the pid of the process that produced it');
  return envelope;
}
const dir = () => mkdtempSync(join(scratch, 'demo-'));
const run = (patch = {}) => ({ summary: OBSERVED, runId: 'run-a', attempt: 0, candidateId: 'candidate-a', receiptId: 'receipt-a', createdAt: 100, ttlMs: 1000, ...patch });
const req = (command, path, patch = {}) => ({ command, path, config: CONFIG, now: 100, ...patch });

test('every response has the exact key set, and an inspect of an absent file is NEW from a fresh process', () => {
  const d = dir(); const path = join(d, 'journal.jsonl');
  const { result } = child(req('inspect', path));
  assert.deepEqual(Object.keys(result), RESULT_KEYS);
  assert.equal(result.status, 'INSPECTED');
  assert.equal(result.reason, null);
  assert.equal(result.bundle.status, 'OPEN');
  assert.equal(result.bundle.recovery.status, 'NEW');
  assert.deepEqual(result.bundle.entries, []);
  assert.deepEqual(result.bundle.interrupted, []);
  assert.equal(result.bundle.sha256, null);
  assert.equal(result.record, null);
  assert.equal(result.sha256, null);
  assert.equal(result.bytes, 0);
  assert.equal(result.authorizing, false);
  assert.equal(result.isolationAccepted, false);
  assert.equal(result.generatedCodeExecuted, false);
  assert.equal(existsSync(path), false, 'inspect never creates the file');
});

test('a record in one process is read back by a different process as historical, with the bytes and hash unchanged', () => {
  const d = dir(); const path = join(d, 'journal.jsonl');
  const first = child(req('record', path, { run: run() }));
  assert.equal(first.result.status, 'RECORDED');
  assert.equal(first.result.record.status, 'RECORDED');
  assert.equal(first.result.record.entryId, 'run-a:0:fixed-run');
  assert.equal(first.result.record.store.status, 'WRITTEN');
  assert.equal(first.result.record.store.durable, true, 'a real directory on this filesystem fsyncs both file and directory');
  assert.equal(first.result.record.store.committed, true);
  const onDisk = readFileSync(path);
  assert.equal(sha256(onDisk), first.result.sha256, 'the reported hash is the on-disk hash');
  assert.equal(onDisk.length, first.result.bytes);
  assert.deepEqual(readdirSync(d), ['journal.jsonl'], 'no temp file remains');
  const second = child(req('inspect', path, { now: 150 }));
  assert.notEqual(second.pid, first.pid, 'a genuinely different process');
  assert.equal(second.result.bundle.recovery.status, 'COMPLETE');
  assert.deepEqual(second.result.bundle.recovery.recoveredIds, ['run-a:0:fixed-run']);
  assert.equal(second.result.bundle.sha256, first.result.sha256);
  assert.equal(second.result.bundle.entries.length, 1);
  const row = second.result.bundle.entries[0];
  assert.equal(row.historical, true, 'read from disk, not from memory');
  assert.equal(row.entry.state, 'SUCCEEDED');
  assert.equal(row.liveness, 'SUCCEEDED');
  assert.equal(row.entry.payload.table, OBSERVED.table);
  assert.equal(row.entry.payload.overall, 'OBSERVED');
  assert.deepEqual(second.result.bundle.interrupted, []);
  assert.deepEqual(readFileSync(path), onDisk, 'inspect changed nothing on disk');
});

test('the same run replayed from a third process is DUPLICATE and touches nothing; different content under the same identity is CONFLICT', () => {
  const d = dir(); const path = join(d, 'journal.jsonl');
  const first = child(req('record', path, { run: run() }));
  const onDisk = readFileSync(path);
  const replay = child(req('record', path, { run: run(), now: 200 }));
  assert.equal(replay.result.status, 'DUPLICATE');
  assert.equal(replay.result.record.status, 'DUPLICATE');
  assert.deepEqual(replay.result.record.journal, { status: 'DUPLICATE', id: 'run-a:0:fixed-run' });
  assert.equal(replay.result.record.store, null);
  assert.equal(replay.result.sha256, first.result.sha256);
  assert.deepEqual(readFileSync(path), onDisk, 'a duplicate never rewrites the file');
  const conflict = child(req('record', path, { run: run({ summary: TIMEOUT }), now: 200 }));
  assert.equal(conflict.result.status, 'CONFLICT');
  assert.deepEqual(conflict.result.record.journal, { status: 'CONFLICT', id: 'run-a:0:fixed-run', reason: 'ID_CONTENT_MISMATCH' });
  assert.equal(conflict.result.record.store, null);
  assert.deepEqual(readFileSync(path), onDisk, 'a conflict never rewrites the file');
});

test('two records across three processes chain on disk; the third process sees both in order with the second FAILED', () => {
  const d = dir(); const path = join(d, 'journal.jsonl');
  const a = child(req('record', path, { run: run() }));
  const b = child(req('record', path, { run: run({ summary: TIMEOUT, attempt: 1, candidateId: 'candidate-b', createdAt: 150 }), now: 150 }));
  assert.equal(b.result.status, 'RECORDED');
  assert.notEqual(b.result.sha256, a.result.sha256);
  assert.equal(b.result.bundle.recovery.status, 'COMPLETE', 'the second process opened on the first process\'s bytes');
  assert.deepEqual(b.result.bundle.recovery.recoveredIds, ['run-a:0:fixed-run']);
  const c = child(req('inspect', path, { now: 200 }));
  assert.deepEqual(c.result.bundle.recovery.recoveredIds, ['run-a:0:fixed-run', 'run-a:1:fixed-run']);
  assert.deepEqual(c.result.bundle.entries.map(r => [r.entry.id, r.entry.state, r.historical]), [['run-a:0:fixed-run', 'SUCCEEDED', true], ['run-a:1:fixed-run', 'FAILED', true]]);
  assert.deepEqual(c.result.bundle.entries[1].entry.payload.reasons, TIMEOUT.reasons);
  const back = reopen(readFileSync(path, 'utf8'));
  assert.equal(back.report.status, 'COMPLETE');
  assert.equal(back.journal.serialize(), readFileSync(path, 'utf8'), 'the file is exactly what the accepted journal serializes');
});

test('interrupted work persisted by one process is reported by the next: a stale RUNNING row is interrupted, and a record can still be added beside it', () => {
  const d = dir(); const path = join(d, 'journal.jsonl');
  const j = createRunJournal(CONFIG);
  const running = { id: 'crashed-run', projectId: 'project-a', runId: 'run-x', attempt: 0, candidateId: 'candidate-x', stage: 'tests', receiptId: null,
    createdAt: 50, ttlMs: 100000, state: 'RUNNING', heartbeatAt: 50, retryOf: null, revokes: null, payload: { note: 'left running by a crashed process' } };
  assert.equal(j.append(running, 50).status, 'APPENDED');
  writeFileSync(path, j.serialize());
  const seen = child(req('inspect', path, { now: 100 }));
  assert.deepEqual(seen.result.bundle.interrupted.map(x => [x.id, x.liveness]), [['crashed-run', 'UNKNOWN']]);
  assert.deepEqual(Object.keys(seen.result.bundle.interrupted[0]), ['id', 'runId', 'attempt', 'stage', 'liveness', 'heartbeatAt', 'createdAt']);
  const rec = child(req('record', path, { run: run(), now: 100 }));
  assert.equal(rec.result.status, 'RECORDED');
  assert.deepEqual(rec.result.bundle.interrupted.map(x => x.id), ['crashed-run'], 'the record response reports the interrupted work it found at open');
  const after = child(req('inspect', path, { now: 120 }));
  assert.deepEqual(after.result.bundle.entries.map(r => r.entry.id), ['crashed-run', 'run-a:0:fixed-run']);
  assert.deepEqual(after.result.bundle.interrupted.map(x => x.id), ['crashed-run'], 'recording beside interrupted work does not resolve it');
});

test('a truncated file opens SEALED in a fresh process: the recovered prefix is reported, a record is refused, and nothing is rewritten', () => {
  const d = dir(); const path = join(d, 'journal.jsonl');
  child(req('record', path, { run: run() }));
  child(req('record', path, { run: run({ summary: TIMEOUT, attempt: 1, createdAt: 150 }), now: 150 }));
  const full = readFileSync(path, 'utf8'); const lines = full.split('\n');
  writeFileSync(path, lines.slice(0, 2).join('\n') + '\n');
  const damaged = readFileSync(path);
  const seen = child(req('inspect', path, { now: 200 }));
  assert.equal(seen.result.status, 'INSPECTED');
  assert.equal(seen.result.bundle.status, 'SEALED');
  assert.equal(seen.result.bundle.recovery.status, 'INCOMPLETE');
  assert.equal(seen.result.bundle.recovery.reason, 'MISSING_FOOTER');
  assert.deepEqual(seen.result.bundle.recovery.recoveredIds, ['run-a:0:fixed-run']);
  const rec = child(req('record', path, { run: run({ attempt: 2, createdAt: 200 }), now: 200 }));
  assert.equal(rec.result.status, 'REFUSED');
  assert.equal(rec.result.reason, 'BUNDLE_SEALED');
  assert.equal(rec.result.record.status, 'REFUSED');
  assert.equal(rec.result.record.reason, 'BUNDLE_SEALED');
  assert.deepEqual(readFileSync(path), damaged, 'a sealed bundle never rewrites the damaged file');
  assert.deepEqual(readdirSync(d), ['journal.jsonl']);
});

test('a journal for another project is refused at open by a fresh process and never adopted', () => {
  const d = dir(); const path = join(d, 'journal.jsonl');
  writeFileSync(path, createRunJournal({ ...CONFIG, projectId: 'project-b' }).serialize());
  const before = readFileSync(path);
  const seen = child(req('inspect', path));
  assert.equal(seen.result.status, 'REFUSED');
  assert.equal(seen.result.reason, 'PROJECT_MISMATCH');
  assert.equal(seen.result.bundle, null);
  const rec = child(req('record', path, { run: run() }));
  assert.equal(rec.result.status, 'REFUSED');
  assert.equal(rec.result.reason, 'PROJECT_MISMATCH');
  assert.deepEqual(readFileSync(path), before);
});

test('requests outside the owned scratch directory, through a symlink, or malformed are refused without touching the filesystem', () => {
  const d = dir(); const path = join(d, 'journal.jsonl');
  const outside = join(dirname(scratch), 'package.json');
  for (const [label, request] of [
    ['outside scratch', req('inspect', outside)],
    ['not journal.jsonl', req('inspect', join(d, 'other.jsonl'))],
    ['missing parent', req('inspect', join(d, 'nope', 'journal.jsonl'))],
    ['relative path', req('inspect', 'journal.jsonl')],
    ['bad command', req('delete', path)],
    ['extra key', { ...req('inspect', path), extra: 1 }],
    ['missing config', { command: 'inspect', path, now: 100 }],
    ['bad now', req('inspect', path, { now: -1 })],
    ['record without run', req('record', path)],
    ['record with non-object run', req('record', path, { run: 'x' })]
  ]) {
    const { result } = child(request);
    assert.equal(result.status, 'REFUSED', label);
    assert.equal(result.reason, 'INVALID_INPUT', label);
    assert.equal(result.bundle, null, label);
    assert.equal(result.record, null, label);
  }
  assert.equal(existsSync(path), false);
  const link = join(d, 'link'); mkdirSync(link); symlinkSync(outside, join(link, 'journal.jsonl'));
  // link/.. : the JS realpath collapses this to d (inside) while the kernel resolves the link first (elsewhere).
  mkdirSync(join(d, 'a', 'b'), { recursive: true }); symlinkSync(join(d, 'a', 'b'), join(d, 'lnk'));
  const dotdot = child(req('inspect', d + '/lnk/../journal.jsonl'));
  assert.equal(dotdot.result.status, 'REFUSED', 'a non-normalized path is refused');
  assert.equal(dotdot.result.reason, 'INVALID_INPUT');
  const dotdotRec = child(req('record', d + '/lnk/../journal.jsonl', { run: run() }));
  assert.equal(dotdotRec.result.status, 'REFUSED');
  assert.equal(existsSync(join(d, 'a', 'journal.jsonl')), false, 'nothing was written where the kernel would have put it');
  assert.equal(existsSync(join(d, 'journal.jsonl')), false);
  const trailing = child(req('inspect', path + '/'));
  assert.equal(trailing.result.status, 'REFUSED', 'a trailing slash is not normalized');
  const { result } = child(req('inspect', join(link, 'journal.jsonl')));
  assert.equal(result.status, 'REFUSED');
  assert.equal(result.reason, 'INVALID_INPUT');
  assert.deepEqual(readFileSync(outside), readFileSync(join(dirname(scratch), 'package.json')));
  for (const bad of ['not json', '[]', 'null', '42']) {
    const r = spawnSync(process.execPath, [cli], { input: bad, encoding: 'utf8', timeout: 20000 });
    if (bad === 'not json') { assert.equal(r.status, 2, 'unparsable stdin is a process-level error'); continue; }
    assert.equal(r.status, 0, bad);
    const env = JSON.parse(r.stdout.trim());
    assert.equal(env.result.status, 'REFUSED', bad);
    assert.equal(env.result.reason, 'INVALID_INPUT', bad);
  }
});

test('demo module imports only the frozen bundle plus node:path and node:url for the scratch boundary, and passes real node:fs to the bundle', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./scratch/src/bundle-restart-demo.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^\s*import\b[^\n]*from\s+['"]([^'"]+)['"]/gm)].map(m => m[1]);
  assert.deepEqual([...new Set(imports)].sort(), ['../history/host-journal-bundle.mjs', 'node:fs', 'node:path', 'node:url']);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|eval|Function|setTimeout|setInterval|child_process|Date)\b|Math\s*\.\s*random\b/);
  const ns = await import('./scratch/src/bundle-restart-demo.mjs');
  assert.deepEqual(Object.keys(ns).sort(), ['runBundleDemoRequest']);
});