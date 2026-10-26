// Reviewed deterministic filesystem fixtures; no provider or generated code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPairedArmSidecarStoreV1, inspectPairedArmSidecarStoreV1 } from '../history/paired-arm-sidecar-store-v1.mjs';
import { encodeArmSidecarRecordV1 } from '../history/paired-arm-sidecar-codec-v1.mjs';
function ownedTemp(t,prefix){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),prefix));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;
}

const D = '0'.repeat(64);
const UUID = '12345678-1234-4abc-8def-1234567890ab';
const main = sequence => ({ sequence, sha256: D });
const header = () => ({ kind: 'HEADER', main: main(0), runnerId: UUID, planSha256: D, profileSha256: D, intentsSha256: D });
const final = () => ({ kind: 'FINAL', main: main(3), rows: [{ requestId: D, state: 'COMPLETE' }], failure: null });
const fileOf = directory => path.join(directory, 'arm-sidecar.jsonl');
const ownIo = overrides => {
  const keys = ['openSync', 'closeSync', 'writeSync', 'readSync', 'fstatSync', 'fsyncSync'];
  return Object.fromEntries(keys.map(key => [key, overrides[key] ?? fs[key].bind(fs)]));
};
const create = directory => createPairedArmSidecarStoreV1({ directory });
const code = error => error && typeof error === 'object' && Object.hasOwn(error, 'code') ? error.code : null;
const rejectCode = async (promise, expected) => assert.rejects(promise, error => code(error) === expected);
const inspectStatus = (directory, status) => assert.equal(inspectPairedArmSidecarStoreV1({ directory }).status, status);

test('missing sidecar is unavailable while an empty created sidecar is empty', t => {
  const directory = ownedTemp(t, 'nisi-sidecar-store-');
  inspectStatus(directory, 'UNAVAILABLE');
  const store = create(directory);
  inspectStatus(directory, 'EMPTY');
  store.close();
});

test('exclusive private creation, header/final round-trip, and readonly reopen boundary', async t => {
  const directory = ownedTemp(t, 'nisi-sidecar-store-');
  const store = create(directory);
  assert.equal(fs.statSync(fileOf(directory)).mode & 0o077, 0);
  await store.retain(header());
  await store.retain(final());
  assert.deepEqual(store.inspect().state, 'CLOSED');
  const result = inspectPairedArmSidecarStoreV1({ directory });
  assert.equal(result.status, 'FINAL_PRESENT');
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].record.kind, 'HEADER');
  assert.equal(result.records[1].record.kind, 'FINAL');
  assert.throws(() => create(directory), { code: 'SIDECAR_CREATE_UNCONFIRMED' });
  fs.chmodSync(directory,0o500);
  try{inspectStatus(directory,'FINAL_PRESENT');}finally{fs.chmodSync(directory,0o700);}
});

test('descriptor-bound injected IO completes short writes and rejects zero progress', async t => {
  const directory = ownedTemp(t, 'nisi-sidecar-store-');
  let writes = 0;
  const shortIo = ownIo({ writeSync(fd, bytes, offset, length, position) {
    writes += 1; return fs.writeSync(fd, bytes, offset, Math.min(length, 3), position);
  } });
  const store = createPairedArmSidecarStoreV1({ directory }, { io: shortIo });
  await store.retain(header());
  assert(writes > 1);
  store.close();
  const zeroDirectory = ownedTemp(t, 'nisi-sidecar-store-');
  const zeroIo = ownIo({ writeSync() { return 0; } });
  const zero = createPairedArmSidecarStoreV1({ directory: zeroDirectory }, { io: zeroIo });
  await rejectCode(zero.retain(header()), 'SIDECAR_COMMIT_UNCONFIRMED');
  assert.equal(zero.inspect().state, 'COMMIT_UNCERTAIN');
  await rejectCode(zero.retain(header()), 'SIDECAR_NOT_WRITABLE');
});

test('fsync-after-write failure is uncertain and sticky', async t => {
  const directory = ownedTemp(t, 'nisi-sidecar-store-');
  let syncs = 0;
  const io = ownIo({ fsyncSync(fd) { syncs += 1; if (syncs === 2) throw Error('fault'); return fs.fsyncSync(fd); } });
  const store = createPairedArmSidecarStoreV1({ directory }, { io });
  await rejectCode(store.retain(header()), 'SIDECAR_COMMIT_UNCONFIRMED');
  assert.equal(store.inspect().state, 'COMMIT_UNCERTAIN');
  await rejectCode(store.retain(header()), 'SIDECAR_NOT_WRITABLE');
});

test('readback corruption and premature EOF are uncertain and sticky', async t => {
  for (const mode of ['corrupt', 'eof']) {
    const directory = ownedTemp(t, `nisi-sidecar-${mode}-`);
    let reads = 0;
    const io = ownIo({ readSync(fd, bytes, offset, length, position) {
      reads += 1;
      if (mode === 'eof') return 0;
      const n = fs.readSync(fd, bytes, offset, length, position);
      if (n > 0) bytes[offset] ^= 1;
      return n;
    } });
    const store = createPairedArmSidecarStoreV1({ directory }, { io });
    await rejectCode(store.retain(header()), 'SIDECAR_COMMIT_UNCONFIRMED');
    assert(reads > 0);
    assert.equal(store.inspect().state, 'COMMIT_UNCERTAIN');
    await rejectCode(store.retain(header()), 'SIDECAR_NOT_WRITABLE');
  }
});

test('FINAL close failure rejects without acknowledging record or finalSeen', async t => {
  const directory = ownedTemp(t, 'nisi-sidecar-store-');
  let closes = 0;
  const io = ownIo({ closeSync(fd) { closes += 1; fs.closeSync(fd); if (closes === 2) throw Error('close fault'); } });
  const store = createPairedArmSidecarStoreV1({ directory }, { io });
  await store.retain(header());
  await rejectCode(store.retain(final()), 'SIDECAR_COMMIT_UNCONFIRMED');
  const snapshot = store.inspect();
  assert.equal(snapshot.retainedRecords, 1);
  assert.equal(snapshot.finalSeen, false);
  assert.equal(snapshot.state, 'COMMIT_UNCERTAIN');
  assert.equal(snapshot.failureCause,'SIDECAR_CLOSE_UNCONFIRMED');
  inspectStatus(directory,'FINAL_PRESENT'); // Retained bytes do not prove delivery of the acknowledgement.
  await rejectCode(store.retain(final()), 'SIDECAR_NOT_WRITABLE');
});

test('codec rejects Proxy/getter retain inputs without invoking traps', async t => {
  const directory = ownedTemp(t, 'nisi-sidecar-store-');
  const store = create(directory);
  let traps = 0;
  const proxy = new Proxy(header(), { get() { traps += 1; throw Error('get'); }, ownKeys() { traps += 1; throw Error('keys'); } });
  await rejectCode(store.retain(proxy), 'SIDECAR_PREWRITE_REFUSED');
  assert.equal(traps, 0);
  const getter = header();
  Object.defineProperty(getter, 'runnerId', { enumerable: true, get() { traps += 1; throw Error('getter'); } });
  const second=create(ownedTemp(t,'nisi-sidecar-getter-'));
  await rejectCode(second.retain(getter), 'SIDECAR_PREWRITE_REFUSED');
  assert.equal(traps, 0);
});

test('corrupt, partial-tail, and post-FINAL extra bytes are non-authorizing inspection results', async t => {
  const directory = ownedTemp(t, 'nisi-sidecar-store-');
  const store = create(directory);
  await store.retain(header());
  await store.retain(final());
  fs.appendFileSync(fileOf(directory), Buffer.from('{partial'));
  assert.equal(inspectPairedArmSidecarStoreV1({ directory }).status, 'PARTIAL_TAIL');

  const extraDirectory = ownedTemp(t, 'nisi-sidecar-store-');
  const extra = create(extraDirectory);
  await extra.retain(header());
  await extra.retain(final());
  const finalInspection = inspectPairedArmSidecarStoreV1({ directory: extraDirectory });
  const extraRecord = encodeArmSidecarRecordV1(final(), 2, finalInspection.records[1].sha256);
  fs.appendFileSync(fileOf(extraDirectory), extraRecord.bytes);
  assert.equal(inspectPairedArmSidecarStoreV1({ directory: extraDirectory }).status, 'CORRUPT');

  const corruptDirectory = ownedTemp(t, 'nisi-sidecar-store-');
  const corrupt = create(corruptDirectory);
  await corrupt.retain(header());
  corrupt.close();
  const bytes = fs.readFileSync(fileOf(corruptDirectory));
  bytes[bytes.length - 3] ^= 1;
  fs.writeFileSync(fileOf(corruptDirectory), bytes, { mode: 0o600 });
  assert.equal(inspectPairedArmSidecarStoreV1({ directory: corruptDirectory }).status, 'CORRUPT');
});

test('symlink, hardlink, and non-private directory/file modes are refused', t => {
  const symlinkDirectory = ownedTemp(t, 'nisi-sidecar-store-');
  fs.symlinkSync(path.join(symlinkDirectory, 'missing'), fileOf(symlinkDirectory));
  assert.throws(() => create(symlinkDirectory), { code: 'SIDECAR_CREATE_UNCONFIRMED' });

  const hardlinkDirectory = ownedTemp(t, 'nisi-sidecar-store-');
  const other = path.join(hardlinkDirectory, 'other');
  fs.writeFileSync(other, '', { mode: 0o600 });
  fs.linkSync(other, fileOf(hardlinkDirectory));
  assert.throws(() => create(hardlinkDirectory), { code: 'SIDECAR_CREATE_UNCONFIRMED' });

  const openDirectory = ownedTemp(t, 'nisi-sidecar-store-');
  fs.chmodSync(openDirectory, 0o750);
  assert.throws(() => create(openDirectory), { code: 'NISI_STATE_DIRECTORY_INVALID' });
});
