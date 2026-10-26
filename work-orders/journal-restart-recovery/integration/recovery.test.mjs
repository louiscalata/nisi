import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRunJournal } from './scratch/history/run-journal-v1.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'integration/scratch/fixtures/worker-cli.mjs');
const scratch = join(root, 'integration/scratch/.scratch');
fs.mkdirSync(scratch, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const config = patch => ({ projectId: 'recovery-a', maxEntries: 8, heartbeatTtlMs: 10, redactPaths: [], ...patch });
const entry = (id = 'entry-a', patch = {}) => ({
  id, projectId: 'recovery-a', runId: 'run-a', attempt: 0, candidateId: 'candidate-a', stage: 'test',
  receiptId: 'receipt-a', createdAt: 100, ttlMs: 1000, state: 'SUCCEEDED', heartbeatAt: null,
  retryOf: null, revokes: null, payload: { note: 'synthetic café 🌱' }, ...patch
});
function area() {
  const dir = fs.mkdtempSync(join(scratch, 'recovery-'));
  return { dir, path: join(dir, 'journal.jsonl') };
}
const snapshots = path => fs.readFileSync(path);
function child(request) {
  const run = spawnSync(process.execPath, [cli], {
    input: JSON.stringify(request), encoding: 'utf8', timeout: 3000,
    killSignal: 'SIGKILL', maxBuffer: 131072, cwd: root,
    env: { PATH: process.env.PATH ?? '', LANG: 'C', LC_ALL: 'C' }, shell: false
  });
  assert.equal(run.error, undefined, run.error?.message);
  assert.equal(run.status, 0, run.stderr); assert.equal(run.signal, null);
  assert.equal(run.stderr, '');
  assert.match(run.stdout, /^[^\n]+\n$/);
  const envelope = JSON.parse(run.stdout);
  assert.deepEqual(Object.keys(envelope), ['schema', 'pid', 'result']);
  assert.equal(envelope.schema, 'nisi-recovery-child/v1');
  assert.equal(envelope.pid, run.pid); assert.ok(Number.isSafeInteger(run.pid) && run.pid > 0);
  assert.notEqual(run.pid, process.pid);
  const r = envelope.result;
  assert.deepEqual(Object.keys(r), ['status', 'reason', 'store', 'recovery', 'rows', 'append', 'sha256', 'bytes', 'authorizing', 'isolationAccepted', 'generatedCodeExecuted']);
  assert.equal(r.authorizing, false); assert.equal(r.isolationAccepted, false); assert.equal(r.generatedCodeExecuted, false);
  assert.ok(Array.isArray(r.rows)); assert.ok(Array.isArray(r.append));
  for (const row of r.rows) assert.equal(row.authorizing, false);
  if (r.recovery) assert.equal(r.recovery.authorizing, false);
  return { pid: run.pid, r };
}
function write(f, entries = [entry()], cfg = config(), now = 100) {
  const run = child({ command: 'write', path: f.path, config: cfg, entries, now });
  assert.equal(run.r.status, 'WRITTEN'); assert.equal(run.r.reason, null);
  assert.equal(run.r.store.status, 'WRITTEN'); assert.equal(run.r.store.committed, true);
  assert.equal(run.r.store.verified, true); assert.equal(run.r.store.durable, true);
  assert.deepEqual(run.r.store.fsync, { file: true, directory: true });
  assert.equal(run.r.sha256, hash(snapshots(f.path)));
  assert.equal(run.r.bytes, snapshots(f.path).length);
  return run;
}
function inspect(f, now = 100, projectId = 'recovery-a') {
  return child({ command: 'inspect', path: f.path, projectId, now });
}
function diskUnchanged(f, fn) {
  const before = snapshots(f.path), stat = fs.statSync(f.path, { bigint: true });
  const value = fn();
  assert.deepEqual(snapshots(f.path), before);
  assert.equal(fs.statSync(f.path, { bigint: true }).mtimeNs, stat.mtimeNs);
  return value;
}
function canonical(v) {
  return Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']'
    : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v);
}
function rehash(values) {
  let previousHash = hash('nisi-run-journal/header/v1\n' + canonical(values[0]));
  for (let i = 1; i < values.length - 1; i++) {
    values[i].seq = i; values[i].previousHash = previousHash;
    previousHash = hash('nisi-run-journal/record/v1\n' + canonical({ seq: i, previousHash, record: values[i].record }));
    values[i].hash = previousHash;
  }
  values.at(-1).count = values.length - 2; values.at(-1).lastHash = previousHash;
  return values.map(canonical).join('\n') + '\n';
}

test('writer exits then a new reader recovers exact ordered observations and bytes', () => {
  const f = area(), entries = [entry(), entry('entry-b', { attempt: 1, receiptId: 'receipt-b', state: 'FAILED' })];
  const a = write(f, entries), b = diskUnchanged(f, () => inspect(f));
  assert.notEqual(a.pid, b.pid); assert.equal(b.r.status, 'OPEN');
  assert.equal(b.r.recovery.status, 'COMPLETE');
  assert.deepEqual(b.r.recovery.recoveredIds, ['entry-a', 'entry-b']);
  assert.deepEqual(b.r.rows.map(x => x.entry), entries);
  assert.ok(b.r.rows.every(x => x.historical === true));
  assert.equal(b.r.sha256, a.r.sha256); assert.equal(b.r.bytes, a.r.bytes);
  assert.equal(b.r.store.durable, false);
});
test('an empty serialized journal survives a fresh process without invented observations', () => {
  const f = area(); const a = write(f, []), b = inspect(f);
  assert.notEqual(a.pid, b.pid); assert.equal(b.r.status, 'OPEN');
  assert.deepEqual(b.r.rows, []); assert.deepEqual(b.r.recovery.recoveredIds, []);
});
test('fresh-process replay is duplicate/conflict only and never updates persisted bytes', () => {
  const f = area(); write(f);
  for (const [e, status] of [[entry(), 'DUPLICATE'], [entry('entry-a', { payload: { changed: true } }), 'CONFLICT']]) {
    const { r } = diskUnchanged(f, () => child({ command: 'replay', path: f.path, projectId: 'recovery-a', entry: e, now: 100 }));
    assert.equal(r.status, status); assert.equal(r.append[0].status, status); assert.equal(r.store.status, 'READ');
  }
  const { r } = diskUnchanged(f, () => child({ command: 'replay', path: f.path, projectId: 'recovery-a', entry: entry('new-id'), now: 100 }));
  assert.equal(r.status, 'REFUSED'); assert.equal(r.reason, 'UNEXPECTED_APPEND'); assert.deepEqual(r.rows, []);
});
test('wrong-project complete and truncated streams expose no rows and are not rewritten', () => {
  const f = area(); write(f);
  for (const truncate of [false, true]) {
    if (truncate) fs.writeFileSync(f.path, snapshots(f.path).toString().split('\n').slice(0, 2).join('\n') + '\n');
    const { r } = diskUnchanged(f, () => inspect(f, 100, 'recovery-b'));
    assert.equal(r.status, 'REFUSED'); assert.equal(r.reason, 'PROJECT_MISMATCH');
    assert.deepEqual(r.rows, []); assert.equal(r.recovery, null);
  }
});
test('fresh processes classify RUNNING as fresh, then UNKNOWN, then expired without retrying', () => {
  const f = area(); write(f, [entry('running', { state: 'RUNNING', heartbeatAt: 100, ttlMs: 50 })]);
  for (const [now, expected] of [[100, 'RUNNING'], [111, 'UNKNOWN'], [150, 'EXPIRED']]) {
    const { r } = diskUnchanged(f, () => inspect(f, now));
    assert.equal(r.status, 'OPEN'); assert.equal(r.rows[0].liveness, expected); assert.equal(r.rows[0].historical, true);
  }
});
test('redaction and revocation persist across process boundaries without disclosing original payload', () => {
  const f = area(), first = entry('first', { payload: { secret: 'private-original' } });
  const revoke = entry('revoke', { state: 'REVOKED', revokes: 'first', payload: { secret: 'also-private' } });
  write(f, [first, revoke], config({ redactPaths: ['payload.secret'] }));
  const { r } = inspect(f);
  assert.equal(r.rows[0].revoked, true); assert.equal(r.rows[0].liveness, 'REVOKED');
  assert.ok(r.rows.every(x => x.entry.payload.secret === '[REDACTED]'));
  assert.doesNotMatch(snapshots(f.path).toString(), /private-original|also-private/);
});
test('truncated verified prefixes stay sealed and cannot be replayed or replaced', () => {
  const f = area(); write(f, [entry(), entry('entry-b')]);
  const full = snapshots(f.path).toString(), lines = full.trimEnd().split('\n');
  for (const damaged of [lines[0] + '\n', lines.slice(0, 2).join('\n') + '\n', full.slice(0, -2)]) {
    const copy = area(); fs.writeFileSync(copy.path, damaged);
    const { r } = diskUnchanged(copy, () => inspect(copy));
    assert.equal(r.status, 'SEALED'); assert.equal(r.recovery.status, 'INCOMPLETE');
    assert.ok(r.rows.every(x => x.historical));
    const replay = diskUnchanged(copy, () => child({ command: 'replay', path: copy.path, projectId: 'recovery-a', entry: entry(), now: 100 }));
    assert.equal(replay.r.status, 'REFUSED'); assert.equal(replay.r.reason, 'SEALED');
  }
});
test('corrupt chain and malformed UTF8 are not treated as absent or accepted', () => {
  const f = area(); write(f);
  for (const damage of [Buffer.from(snapshots(f.path).toString().replace('synthetic', 'tampered')), Buffer.from([0xc3, 0x28])]) {
    const copy = area(); fs.writeFileSync(copy.path, damage);
    const { r } = diskUnchanged(copy, () => inspect(copy));
    assert.equal(r.status, 'SEALED'); assert.equal(r.recovery.status, 'INVALID');
    if (damage[0] === 0xc3) { assert.equal(r.reason, 'INVALID_UTF8'); assert.deepEqual(r.rows, []); }
  }
});
test('structurally rehashed but semantically invalid journals are sealed by authoritative reopen', () => {
  const f = area(); write(f);
  for (const change of [
    v => { v[1].record.entry.projectId = 'wrong-project'; },
    v => { v[1].record.entry.state = 'INVENTED_PASS'; },
    v => { v[0].config.maxEntries = 0; },
    v => { v[1].record.retained = false; },
    v => { v[1].record.entry.retryOf = 'missing-id'; v[1].record.entry.state = 'QUEUED'; }
  ]) {
    const values = snapshots(f.path).toString().trimEnd().split('\n').map(JSON.parse);
    change(values);
    const copy = area(); fs.writeFileSync(copy.path, rehash(values));
    const { r } = diskUnchanged(copy, () => inspect(copy));
    assert.equal(r.store.status, 'READ'); assert.equal(r.status, 'SEALED'); assert.equal(r.recovery.status, 'INVALID');
  }
});
test('missing path, malformed requests and backwards time refuse without fabricated recovery', () => {
  const missing = area(); const { r } = inspect(missing);
  assert.equal(r.status, 'REFUSED'); assert.equal(r.reason, 'NOT_FOUND'); assert.equal(r.recovery, null);
  for (const request of [null, {}, { command: 'invented' }, { command: 'inspect', path: missing.path, projectId: 'recovery-a', now: -1 }]) {
    const response = child(request).r; assert.equal(response.status, 'REFUSED'); assert.equal(response.reason, 'INVALID_INPUT');
  }
  const f = area(); write(f);
  const back = diskUnchanged(f, () => inspect(f, 99));
  assert.equal(back.r.status, 'REFUSED'); assert.equal(back.r.reason, 'TIME');
});