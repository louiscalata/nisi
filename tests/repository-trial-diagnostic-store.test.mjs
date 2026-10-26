import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { observedTrial } from './helpers/observed-repository-trial-fixture.mjs';
import { deferred, reply, tick } from './helpers/live-model-v3-fixture.mjs';
import { retainRepositoryTrialDiagnosticV1 as retain, inspectRepositoryTrialDiagnosticV1 as inspect } from '../history/repository-trial-diagnostic-store-v1.mjs';
import { encodeRepositoryTrialDiagnosticV1 } from '../history/repository-trial-diagnostic-v1.mjs';
async function ready(t, options) { const c = await observedTrial(t, options); await c.runner.run(); return { ...c, diagnostic: c.observed().captureDiagnostics(), directory: c.store.inspect().directory }; }
const write = (c, io = fs) => retain({ directory: c.directory, diagnostic: c.diagnostic }, { io });
test('success snapshot is exclusively retained and read without changing ledger or inventing acknowledgement', async t => {
  const c = await ready(t), file = c.store.inspect().file, before = fs.readFileSync(file), result = write(c);
  assert.equal(result.status, 'RETAINED'); assert.equal(fs.statSync(result.file).mode & 0o777, 0o600);
  const found = inspect(result.file); assert.equal(found.status, 'OBSERVED'); assert.equal(found.sha256, result.sha256);
  assert.deepEqual(found.diagnostic, c.diagnostic); assert.equal(found.pastAcknowledgement, 'UNKNOWN');
  assert.equal(found.sourceTrust, 'UNAUTHENTICATED_LOCAL_BYTES'); assert.equal(found.authorizing, false); assert.equal(found.rawEvidenceRetained, false);
  assert.deepEqual(found.linkage.ledgerBoundFields, ['requestId', 'profileSha256', 'model', 'modelSettingsSha256', 'taskSha256', 'baselineSha256']);
  assert.deepEqual(found.linkage.observerOnlyFields, ['suiteFingerprint', 'reviewedSourceFingerprint']);
  assert.equal(found.linkage.executionVerified, false);
  assert.equal(write(c).status, 'NOT_RETAINED'); assert.deepEqual(fs.readFileSync(file), before);
});
test('no-candidate terminal error gets durable diagnostic data not fabricated candidate or usage', async t => {
  const c = await ready(t, { configure(i) { i.approval.expiresAtMs = 1; } }), result = write(c), found = inspect(result.file);
  assert.equal(result.status, 'RETAINED'); assert.equal(found.diagnostic.host.candidateFingerprint, null);
  assert.equal(found.diagnostic.projection.completionClaim, null); assert.equal(found.diagnostic.projection.modelCalls, null);
  assert.equal(found.diagnostic.host.collectionState, 'QUARANTINED'); assert.equal(found.diagnostic.channels.operationResult.state, 'REJECTED');
});
test('partial on-disk capture cannot be upgraded or rewritten by late operation completion', async t => {
  const started = deferred(), response = deferred();
  const c = await observedTrial(t, { onRequest(call) { started.resolve(call); return response.promise; } });
  const running = c.runner.run(), call = await started.promise, directory = c.store.inspect().directory;
  let saved, before;
  try {
    const partial = c.observed().captureDiagnostics(); saved = retain({ directory, diagnostic: partial }); before = fs.readFileSync(saved.file);
    assert.equal(saved.status, 'RETAINED'); assert.equal(partial.kind, 'PARTIAL_CHANNELS');
    assert.equal(inspect(saved.file).diagnostic.kind, 'PARTIAL_CHANNELS');
    c.runner.requestStop(); await tick();
  } finally {
    response.resolve(reply(call.envelope));
    await running; await Promise.allSettled([c.observed().operation.result, c.observed().operation.settled]);
  }
  const terminal = c.observed().captureDiagnostics(); assert.equal(terminal.kind, 'TERMINAL_CHANNELS');
  assert.equal(retain({ directory, diagnostic: terminal }).status, 'NOT_RETAINED');
  assert.deepEqual(fs.readFileSync(saved.file), before); assert.equal(inspect(saved.file).diagnostic.kind, 'PARTIAL_CHANNELS');
});
test('ledger mismatches refuse before file creation and observer-only hashes remain explicitly unconfirmed', async t => {
  const c = await ready(t);
  for (const key of ['requestId', 'profileSha256', 'taskSha256', 'baselineSha256']) {
    const diagnostic = structuredClone(c.diagnostic); diagnostic.binding[key] = '0'.repeat(64);
    assert.throws(() => retain({ directory: c.directory, diagnostic }), { code: 'TRIAL_DIAGNOSTIC_BINDING' });
  }
  assert.deepEqual(fs.readdirSync(c.directory), ['events.jsonl']);
  const diagnostic = structuredClone(c.diagnostic); diagnostic.binding.suiteFingerprint = '0'.repeat(64); diagnostic.binding.reviewedSourceFingerprint = '1'.repeat(64);
  const saved = retain({ directory: c.directory, diagnostic });
  assert.equal(saved.status, 'RETAINED'); assert.deepEqual(saved.linkage.observerOnlyFields, ['suiteFingerprint', 'reviewedSourceFingerprint']);
  assert.deepEqual(inspect(saved.file).linkage.observerOnlyFields, saved.linkage.observerOnlyFields);
});
test('short writes and reads are completed before acknowledged retention', async t => {
  const c = await ready(t); let writes = 0, reads = 0;
  const saved = write(c, { ...fs, writeSync(fd, b, o, n, p) { writes++; return fs.writeSync(fd, b, o, Math.min(n, 13), p); },
    readSync(fd, b, o, n, p) { reads++; return fs.readSync(fd, b, o, Math.min(n, 17), p); } });
  assert.equal(saved.status, 'RETAINED'); assert(writes > 1); assert(reads > 1); assert.equal(inspect(saved.file).status, 'OBSERVED');
});
test('acknowledgement requires data-file fsync then directory fsync independently', async t => {
  const c = await ready(t), syncs = [];
  const saved = write(c, { ...fs, fsyncSync(fd) {
    const stat = fs.fstatSync(fd); syncs.push(stat.isFile() ? 'FILE' : stat.isDirectory() ? 'DIRECTORY' : 'OTHER');
    return fs.fsyncSync(fd);
  } });
  assert.deepEqual(syncs, ['FILE', 'DIRECTORY']);
  assert.equal(saved.status, 'RETAINED'); assert.equal(inspect(saved.file).status, 'OBSERVED');
});
for (const fault of ['write', 'partial-write', 'fsync', 'readback', 'close-after-close', 'directory-fsync', 'identity-change'])
test(`storage ${fault} remains uncertain and does not change the event ledger`, async t => {
  const c = await ready(t), ledger = fs.readFileSync(c.store.inspect().file); let writes = 0, fsyncs = 0, closes = 0;
  const io = { ...fs,
    writeSync(fd, b, o, n, p) {
      writes++; if (fault === 'write' || (fault === 'partial-write' && writes > 1)) throw Error('PRIVATE_WRITE');
      return fs.writeSync(fd, b, o, fault === 'partial-write' ? Math.min(n, 7) : n, p);
    },
    fsyncSync(fd) { fsyncs++; if (fault === 'fsync' || (fault === 'directory-fsync' && fsyncs === 2)) throw Error('PRIVATE_FSYNC'); return fs.fsyncSync(fd); },
    readSync(fd, b, o, n, p) { const amount = fs.readSync(fd, b, o, n, p); if (fault === 'readback') b[o] ^= 1; return amount; },
    closeSync(fd) { fs.closeSync(fd); closes++; if (fault === 'close-after-close' && closes === 1) throw Error('PRIVATE_CLOSE'); },
    fstatSync(fd) { const stat = fs.fstatSync(fd); if (fault === 'identity-change' && writes) stat.ino++; return stat; },
  };
  const saved = write(c, io); assert.equal(saved.status, 'COMMIT_UNCERTAIN'); assert.equal(saved.durability, 'UNCONFIRMED');
  assert.equal(write(c).status, 'NOT_RETAINED'); assert.deepEqual(fs.readFileSync(c.store.inspect().file), ledger);
  assert(!JSON.stringify(saved).includes('PRIVATE_')); assert.equal(saved.authorizing, false);
  const reopened = inspect(saved.file); assert.equal(reopened.pastAcknowledgement, 'UNKNOWN');
  assert.equal(reopened.authorizing, false); // readable full bytes do not recover a failed acknowledgement.
});
test('reader rejects corruption unsafe links modes locations and wrong filename without side effects', async t => {
  const c = await ready(t), saved = write(c), original = fs.readFileSync(saved.file);
  for (const replacement of [Buffer.from('{'), Buffer.concat([original, Buffer.from('\n')]), Buffer.alloc(65537)]) {
    fs.writeFileSync(saved.file, replacement); assert.equal(inspect(saved.file).status, 'UNAVAILABLE');
  }
  fs.writeFileSync(saved.file, original); fs.chmodSync(saved.file, 0o644); assert.equal(inspect(saved.file).status, 'UNAVAILABLE'); fs.chmodSync(saved.file, 0o600);
  const link = path.join(c.directory, 'repository-diagnostic-' + 'f'.repeat(64) + '.json');
  fs.linkSync(saved.file, link); assert.equal(inspect(saved.file).status, 'UNAVAILABLE'); fs.unlinkSync(link);
  fs.symlinkSync(saved.file, link); assert.equal(inspect(link).status, 'UNAVAILABLE'); fs.unlinkSync(link);
  fs.writeFileSync(link, original, { mode: 0o600 }); assert.equal(inspect(link).status, 'UNAVAILABLE');
  assert.equal(inspect('relative').status, 'UNAVAILABLE'); assert.equal(inspect(saved.file + '\n').status, 'UNAVAILABLE');
  assert.equal(inspect(saved.file).status, 'OBSERVED');
});
test('corrupted or mismatched ledger cannot establish diagnostic linkage', async t => {
  const c = await ready(t), saved = write(c), ledger = c.store.inspect().file, before = fs.readFileSync(ledger);
  fs.appendFileSync(ledger, 'not a valid event\n'); assert.equal(inspect(saved.file).status, 'UNAVAILABLE');
  fs.writeFileSync(ledger, before); assert.equal(inspect(saved.file).status, 'OBSERVED');
  const diagnostic = structuredClone(c.diagnostic); diagnostic.binding.profileSha256 = '0'.repeat(64);
  fs.writeFileSync(saved.file, encodeRepositoryTrialDiagnosticV1(diagnostic).bytes);
  assert.equal(inspect(saved.file).status, 'UNAVAILABLE');
});
