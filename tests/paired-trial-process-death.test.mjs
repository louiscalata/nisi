// Real owned child termination on this POSIX host; not power-loss/provider proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createTrialCrashHarness } from './helpers/paired-trial-crash-parent.mjs';
import { decodeTrialEventV1 } from '../history/paired-trial-event-codec-v1.mjs';
const root = fs.realpathSync(path.resolve(import.meta.dirname, '..'));
const posix = process.platform !== 'win32';
function inspect(parent, directory, expectedExit) {
  const result = spawnSync(process.execPath, ['--import', path.join(root, 'tests/helpers/nisi-cli-no-effects.mjs'),
    path.join(root, 'bin/nisi.mjs'), 'inspect-trial', directory], {
    cwd: parent, env: { PATH: process.env.PATH, HOME: parent, TMPDIR: parent,
      NISI_CLI_TEST_ALLOW_TRIAL: '1', NISI_CLI_TEST_SINGLE_CAPTURE: '1', NISI_CLI_TEST_PACKAGE_ROOT: root },
    encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 8192,
  });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, expectedExit, result.stderr);
  assert.equal(result.stderr, ''); assert(result.stdout.length < 4096); const report = JSON.parse(result.stdout);
  assert.equal(report.actualDispatchCount, null);
  for (const key of ['creationAcknowledgement', 'durabilityAcknowledgement', 'remoteExecutionStopped']) assert.equal(report[key], 'UNKNOWN');
  for (const key of ['measurementVerified', 'authorizing', 'resumable', 'promotionEligible', 'candidateBytesRevalidated', 'causalClaim']) assert.equal(report[key], false);
  assert(!result.stdout.includes('PRIVATE_')); assert(!result.stdout.includes(parent)); return report;
}
for (const [boundary, byteStatus, semanticStatus, exit, starts, completed] of [
  ['SCHEDULE', 'INCOMPLETE', 'INTERRUPTED', 1, 0, 0],
  ['EXECUTOR_INTENT', 'INCOMPLETE', 'INTERRUPTED', 1, 1, 0],
  ['EXECUTOR_RESULT', 'INCOMPLETE', 'INTERRUPTED', 1, 1, 0],
  ['ORACLE_RESULT', 'INCOMPLETE', 'INTERRUPTED', 1, 1, 1],
  ['FINAL', 'FINAL_PRESENT', 'FINAL_CONSISTENT', 0, 4, 4],
  ['PARTIAL_SCHEDULE', 'PARTIAL_TAIL', 'REFUSED', 2, null, null],
  ['PARTIAL_INTENT', 'PARTIAL_TAIL', 'INTERRUPTED', 1, 0, 0],
  ['PARTIAL_FINAL', 'PARTIAL_TAIL', 'INTERRUPTED', 1, 4, 4],
]) test(`actual process death at ${boundary} preserves readable evidence without resume authority`, { skip: !posix }, async () => {
  const harness = createTrialCrashHarness(root);
  try {
    const ready = await harness.start(boundary), termination = await harness.kill();
    assert.equal(termination.closeObserved, true); assert.equal(termination.signal, 'SIGKILL');
    const file = path.join(ready.directory, 'events.jsonl'), before = fs.readFileSync(file), metadata = fs.statSync(file);
    assert.equal(before.length, ready.byteLength + (ready.partial?.writtenBytes ?? 0));
    const prefix = before.subarray(0, ready.byteLength), lines = prefix.toString('utf8').split('\n');
    assert.equal(lines.pop(), ''); assert.equal(lines.length, ready.retainedEvents);
    let lastSha256 = null;
    for (const [ordinal, line] of lines.entries()) lastSha256 = decodeTrialEventV1(Buffer.from(line + '\n'), ordinal, lastSha256).sha256;
    assert.equal(lastSha256, ready.lastSha256);
    if (ready.partial) {
      const tail = before.subarray(ready.byteLength);
      // Independently fixed canonical envelope header, not merely the child's hash.
      assert.deepEqual(tail, Buffer.from('{"event'));
      assert.equal(createHash('sha256').update(tail).digest('hex'), ready.partial.tailSha256);
    }
    const report = inspect(harness.parent, ready.directory, exit);
    assert.equal(report.byteStatus, byteStatus); assert.equal(report.semanticStatus, semanticStatus); assert.equal(report.finalStopReason, null);
    if (starts === null) assert.equal(report.counts, null);
    else { assert.equal(report.counts.planned, 4); assert.equal(report.counts.startIntents, starts); assert.equal(report.counts.completePhaseRecords, completed); }
    assert.deepEqual(inspect(harness.parent, ready.directory, exit), report);
    assert.deepEqual(fs.readFileSync(file), before);
    for (const key of ['ino', 'dev', 'size', 'mode', 'mtimeMs', 'ctimeMs', 'nlink']) assert.equal(fs.statSync(file)[key], metadata[key]);
    assert.deepEqual(fs.readdirSync(ready.directory), ['events.jsonl']);
  } finally { await harness.dispose(); }
  assert.equal(harness.inspect().removed, true); assert.equal(fs.existsSync(harness.parent), false);
});

test('parent cleanup runs after an assertion fails while the exact fixture child is still live', { skip: !posix }, async () => {
  const harness = createTrialCrashHarness(root);
  await assert.rejects(async () => {
    try { await harness.start('SCHEDULE'); assert.fail('EXPECTED_FIXTURE_ASSERTION'); }
    finally { await harness.dispose(); }
  }, { code: 'ERR_ASSERTION' });
  assert.equal(harness.inspect().closed, true); assert.equal(harness.inspect().removed, true);
  assert.equal(fs.existsSync(harness.parent), false);
});

for (const [boundary, code] of [['BAD_READY', 'CRASH_READY_INVALID'], ['NO_READY', 'CRASH_READY_TIMEOUT'],
  ['EARLY_EXIT', 'CRASH_CHILD_BEFORE_READY'], ['FLOOD', 'CRASH_CHILD_OUTPUT_LIMIT']])
test(`parent refuses ${boundary} and confirms closure before cleanup`, { skip: !posix }, async () => {
  const harness = createTrialCrashHarness(root);
  try { await assert.rejects(harness.start(boundary, boundary === 'NO_READY' ? 200 : 5000), { code }); }
  finally { await harness.dispose(); }
  assert.equal(harness.inspect().closed, true); assert.equal(fs.existsSync(harness.parent), false);
});
