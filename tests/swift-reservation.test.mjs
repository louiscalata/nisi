// PRIVATE real local marker fixtures; no kernel or candidate execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireKernelReservation, releaseKernelReservation } from '../hosts/swift-verifier/reservation.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-reservation-test-'));
  t.after(() => { fs.rmSync(directory, { recursive: true }); assert.equal(fs.existsSync(directory), false); });
  return path.join(directory, 'owner.reservation');
}
test('durable reservation excludes a second owner and clears only its exact issued marker', t => {
  const file = fixture(t), ticket = acquireKernelReservation(file, { fixture: true });
  const contents = fs.readFileSync(file);
  assert.equal(JSON.parse(contents).recovery, 'EXPLICIT_RECONCILIATION_REQUIRED');
  assert.throws(() => acquireKernelReservation(file, {}), e => e.code === 'SWIFT_RESERVATION_PRESENT');
  assert.deepEqual(fs.readFileSync(file), contents);
  assert.throws(() => releaseKernelReservation({ ...ticket }), e => e.code === 'SWIFT_RESERVATION_NOT_ISSUED');
  releaseKernelReservation(ticket); assert.equal(fs.existsSync(file), false);
  assert.throws(() => releaseKernelReservation(ticket), e => e.code === 'SWIFT_RESERVATION_NOT_ISSUED');
});
test('a marker from an earlier host is not reclaimed based on an absent PID', t => {
  const file = fixture(t); fs.writeFileSync(file, JSON.stringify({ ownerPid: 2147483647, reason: 'prior host' }));
  assert.throws(() => acquireKernelReservation(file, {}), e => e.code === 'SWIFT_RESERVATION_PRESENT');
  assert.equal(JSON.parse(fs.readFileSync(file)).reason, 'prior host');
});
test('changed or replaced reservation is retained rather than deleting another owner state', t => {
  const file = fixture(t), ticket = acquireKernelReservation(file, {});
  fs.writeFileSync(file, 'changed');
  assert.throws(() => releaseKernelReservation(ticket), e => e.code === 'SWIFT_RESERVATION_RELEASE_UNCERTAIN');
  assert.equal(fs.readFileSync(file, 'utf8'), 'changed');
});
test('sync failure leaves an uncertain marker and no second acquisition is allowed', t => {
  const file = fixture(t);
  t.mock.method(fs, 'fsyncSync', () => { throw new Error('fixture sync failure'); });
  assert.throws(() => acquireKernelReservation(file, {}), e => e.code === 'SWIFT_RESERVATION_UNCERTAIN');
  assert.equal(fs.existsSync(file), true);
  assert.throws(() => acquireKernelReservation(file, {}), e => e.code === 'SWIFT_RESERVATION_PRESENT');
});
test('same-length marker corruption is detected by content identity before release', t => {
  const file = fixture(t), ticket = acquireKernelReservation(file, {});
  const altered = fs.readFileSync(file); altered[0] ^= 1;
  fs.writeFileSync(file, altered);
  assert.throws(() => releaseKernelReservation(ticket), e => e.code === 'SWIFT_RESERVATION_RELEASE_UNCERTAIN');
  assert.deepEqual(fs.readFileSync(file), altered);
});
test('parent directory sync failure leaves an uncertain marker before any launch', t => {
  const file = fixture(t), original = fs.fsyncSync; let syncCalls = 0;
  t.mock.method(fs, 'fsyncSync', fd => {
    syncCalls++;
    if (syncCalls === 2) throw new Error('fixture parent directory sync failure');
    return original(fd);
  });
  assert.throws(() => acquireKernelReservation(file, {}), e => e.code === 'SWIFT_RESERVATION_UNCERTAIN');
  assert.equal(syncCalls, 2); assert.equal(fs.existsSync(file), true);
  assert.throws(() => acquireKernelReservation(file, {}), e => e.code === 'SWIFT_RESERVATION_PRESENT');
});
