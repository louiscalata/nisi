// Fixed test fixture only. No network, models, generated code or descendants.
// The parent owns the one external directory and kills only this child.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPairedTrialRunnerV1 } from '../../evaluation/paired-trial-runner-v1.mjs';
import { createPairedTrialEventStoreV1 } from '../../history/paired-trial-event-store-v1.mjs';
import { pairedTrialFixtureInputs } from './paired-trial-fixture.mjs';
const [parentDirectory, boundary, nonce] = process.argv.slice(2);
assert.equal(process.argv.length, 5);
assert.match(nonce, /^[a-f0-9]{32}$/);
assert(['SCHEDULE', 'EXECUTOR_INTENT', 'EXECUTOR_RESULT', 'ORACLE_RESULT', 'FINAL',
  'PARTIAL_SCHEDULE', 'PARTIAL_INTENT', 'PARTIAL_FINAL', 'BAD_READY', 'NO_READY', 'EARLY_EXIT', 'FLOOD'].includes(boundary));
const block = () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); throw Error('UNEXPECTED_WAKE'); };
const hash = value => createHash('sha256').update(value).digest('hex');
function write(bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.writeSync(1, bytes, offset, bytes.length - offset);
    assert(count > 0 && count <= bytes.length - offset); offset += count;
  }
}
function ready(snapshot, partial = null) {
  // Synchronous bounded frame: works even inside the partial-write seam. No
  // async IPC callback must run before blocking the fixture's JS event loop.
  write(Buffer.from(JSON.stringify({ type: 'READY', nonce: boundary === 'BAD_READY' ? '0'.repeat(32) : nonce,
    boundary, pid: process.pid, directory: snapshot.directory, retainedEvents: snapshot.retainedEvents,
    byteLength: snapshot.byteLength, lastSha256: snapshot.lastSha256, partial }) + '\n'));
  block();
}
if (boundary === 'EARLY_EXIT') process.exit(7);
if (boundary === 'NO_READY') block();
if (boundary === 'FLOOD') { write(Buffer.alloc(16384, 65)); block(); }
const { plan, profile } = pairedTrialFixtureInputs();
let store, writes = 0;
const io = { ...fs, writeSync(fd, bytes, offset, length, position) {
  writes++;
  if ((boundary === 'PARTIAL_SCHEDULE' && writes === 1) || (boundary === 'PARTIAL_INTENT' && writes === 2) ||
      (boundary === 'PARTIAL_FINAL' && writes === 18)) {
    // Crash inside an actual record append, before store fsync/readback/ack.
    const snapshot = store.inspect(), envelope = JSON.parse(bytes.toString('utf8'));
    assert.equal(offset, 0); assert.equal(envelope.ordinal, snapshot.retainedEvents);
    const count = fs.writeSync(fd, bytes, offset, Math.min(7, length), position);
    assert(count > 0 && count < length);
    ready(snapshot, { ordinal: envelope.ordinal, type: envelope.event.type, phase: envelope.event.phase ?? null,
      writtenBytes: count, recordBytes: length, tailSha256: hash(bytes.subarray(0, count)) });
  }
  return fs.writeSync(fd, bytes, offset, length, position);
} };
store = createPairedTrialEventStoreV1({ parentDirectory }, { io });
if (boundary === 'BAD_READY') ready(store.inspect());
const operation = result => ({ result: Promise.resolve(result), settled: Promise.resolve(), status: () => 'IDLE', cancel() {} });
const runner = createPairedTrialRunnerV1({ plan, profile, host: {
  verifyInputs: () => true,
  retain: async event => {
    await store.retain(event);
    const label = event.type === 'START_INTENT' && event.phase === 'EXECUTOR' ? 'EXECUTOR_INTENT'
      : event.type === 'PHASE_RESULT' ? event.phase + '_RESULT' : event.type;
    if (label === boundary) ready(store.inspect());
  },
  startExecutor: intent => operation({ requestId: intent.requestId, profileSha256: intent.profileSha256,
    candidateText: 'PRIVATE_CRASH_FIXTURE', candidateSha256: hash('PRIVATE_CRASH_FIXTURE'), completionClaim: true,
    tokenUsage: { input: 0, output: 0 }, durationMs: null, repairAttempts: 0, modelCalls: 0 }),
  startOracle: request => operation({ requestId: request.requestId, oracleSha256: request.oracleSha256,
    oracleCandidateSha256: request.candidateSha256, outcome: 'PASS' }),
} });
await runner.run();
throw Error('CRASH_BOUNDARY_NOT_REACHED');
