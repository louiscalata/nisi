// Contract tests for the real AFM executor. These run no model: every case uses
// a stand-in binary, so the suite is hermetic. The end-to-end run against the
// actual Apple model is a separate, manual step recorded in the evidence file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAFMExecutor } from '../neural/afm-executor.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const packet = Buffer.from('{"kind":"veritas-courier-f32-v1"}', 'utf8');

function stubBinary(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afm-exec-'));
  const file = path.join(dir, 'stub');
  fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return { file, sha: sha(fs.readFileSync(file)), dir };
}

test('a binary whose digest does not match the reviewed one is refused', () => {
  const { file } = stubBinary('echo hi');
  const made = createAFMExecutor({ binary: file, binarySHA256: 'a'.repeat(64), timeoutMs: 5000 });
  assert.equal(made.ok, false);
  assert.equal(made.code, 'BINARY_DIGEST_MISMATCH');
});

test('arguments outside the closed option set are refused', () => {
  const { file, sha: s } = stubBinary('echo hi');
  assert.equal(createAFMExecutor({ binary: 'relative/path', binarySHA256: s }).code, 'BINARY_ARGUMENTS');
  assert.equal(createAFMExecutor({ binary: file, binarySHA256: 'nothex' }).code, 'BINARY_ARGUMENTS');
  assert.equal(createAFMExecutor({ binary: file, binarySHA256: s, timeoutMs: 5 }).code, 'DEADLINE_ARGUMENT');
  assert.equal(createAFMExecutor({ binary: file, binarySHA256: s, model: 'other' }).code, 'CONFIGURATION_REFUSED');
  assert.equal(createAFMExecutor('nope').code, 'CONFIGURATION_REFUSED');
});

test('a binary that emits nothing usable refuses with an observable cause', async () => {
  const { file, sha: s } = stubBinary('echo not-json');
  const made = createAFMExecutor({ binary: file, binarySHA256: s, timeoutMs: 5000 });
  assert.equal(made.ok, true);
  const out = await made.execute(packet, { taskId: 't.1' });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'AFM_PACKET_UNAVAILABLE');
  // the cause must be recoverable, not buried in the digest
  assert.deepEqual(made.refusals(), [{ taskId: 't.1', cause: 'EVIDENCE_REFUSED' }]);
});

test('a nonzero exit is refused as a child failure, not as evidence', async () => {
  const { file, sha: s } = stubBinary('exit 3');
  const made = createAFMExecutor({ binary: file, binarySHA256: s, timeoutMs: 5000 });
  const out = await made.execute(packet, { taskId: 't.2' });
  assert.equal(out.ok, false);
  assert.equal(made.refusals()[0].cause, 'CHILD_EXIT_NONZERO');
});

test('a binary that runs past the deadline is killed and refused', async () => {
  const { file, sha: s } = stubBinary('sleep 30');
  const made = createAFMExecutor({ binary: file, binarySHA256: s, timeoutMs: 120 });
  const started = Date.now();
  const out = await made.execute(packet, { taskId: 't.3' });
  assert.equal(out.ok, false);
  assert.equal(made.refusals()[0].cause, 'DEADLINE_EXCEEDED');
  assert.ok(Date.now() - started < 5000, 'the deadline must actually fire');
});

test('an abort refuses promptly', async () => {
  const { file, sha: s } = stubBinary('sleep 30');
  const made = createAFMExecutor({ binary: file, binarySHA256: s, timeoutMs: 20000 });
  const controller = new AbortController();
  const pending = made.execute(packet, { taskId: 't.4', signal: controller.signal });
  setTimeout(() => controller.abort(), 40);
  const out = await pending;
  assert.equal(out.ok, false);
  assert.equal(made.refusals()[0].cause, 'ABORTED');
});

test('an oversized evidence stream is refused rather than buffered', async () => {
  const { file, sha: s } = stubBinary('for i in $(seq 1 200); do printf "%020000d" 1; done');
  const made = createAFMExecutor({ binary: file, binarySHA256: s, timeoutMs: 8000 });
  const out = await made.execute(packet, { taskId: 't.5' });
  assert.equal(out.ok, false);
  assert.ok(['EVIDENCE_OVERFLOW', 'CHILD_SIGNALLED'].includes(made.refusals()[0].cause));
});

test('a binary swapped after construction is refused before the next launch', async () => {
  const { file, sha: s } = stubBinary('echo not-json');
  const made = createAFMExecutor({ binary: file, binarySHA256: s, timeoutMs: 5000 });
  assert.equal(made.ok, true);
  fs.writeFileSync(file, '#!/bin/sh\necho swapped\n', { mode: 0o755 });
  const out = await made.execute(packet, { taskId: 't.6' });
  assert.equal(out.ok, false);
  assert.equal(made.refusals()[0].cause, 'EVIDENCE_REFUSED');
});

test('a refused packet still returns exactly the shape the dispatcher accepts', async () => {
  const { file, sha: s } = stubBinary('exit 1');
  const made = createAFMExecutor({ binary: file, binarySHA256: s, timeoutMs: 5000 });
  const out = await made.execute(packet, { taskId: 't.7' });
  assert.deepEqual(Object.keys(out).sort(), ['code', 'ok', 'payloadSha256']);
  assert.equal(/^[0-9a-f]{64}$/.test(out.payloadSha256), true);
});
