import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createPairedTrialEventStoreV1, inspectPairedTrialEventStoreV1 } from '../history/paired-trial-event-store-v1.mjs';
import { TRIAL_EVENT_LIMITS, encodeTrialEventV1, decodeTrialEventV1 } from '../history/paired-trial-event-codec-v1.mjs';
import { createPairedTrialRunnerV1 } from '../evaluation/paired-trial-runner-v1.mjs';
import { readPreventionExperimentPlanV1 } from '../evaluation/prevention-experiment-plan-v1.mjs';
import { reconcilePairedTrialEventStoreV1 } from '../history/paired-trial-reconciliation-v1.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceRoot = fs.realpathSync(path.resolve(import.meta.dirname, '..'));
const within = (parent, child) => { const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
const temporary = (t, selectedBase = os.tmpdir()) => {
  // Nisi scratch intentionally sets TMPDIR to its source workspace. Storage
  // fixtures must instead be fresh private siblings, never inside that source.
  const base = fs.realpathSync(selectedBase);
  const externalBase = within(sourceRoot, base) ? path.dirname(sourceRoot) : base;
  const dir = fs.mkdtempSync(path.join(externalBase, 'nisi-event-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(within(sourceRoot, fs.realpathSync(dir)), false);
  assert.equal(within(fs.realpathSync(dir), sourceRoot), false);
  return dir;
};
const schedule = () => ({ sequence: 0, type: 'SCHEDULE', runnerId: 'fixture', plan: {}, profile: {}, intents: [] });
const start = () => ({ sequence: 1, type: 'START_INTENT', requestId: hash('request'), phase: 'EXECUTOR' });
const terminal = () => ({ sequence: 5, type: 'FINAL', stopReason: 'INTERRUPTED', states: [], drain: null });
const inspect = store => inspectPairedTrialEventStoreV1({ directory: store.inspect().directory });

test('real immutable hash-chain store, explicit OS fsync acknowledgement and final close', async t => {
  const parentDirectory = temporary(t), store = createPairedTrialEventStoreV1({ parentDirectory });
  await store.retain(schedule()); await store.retain(start()); await store.retain(terminal());
  assert.equal(store.inspect().state, 'CLOSED'); assert.equal(store.inspect().retainedEvents, 3);
  assert.equal(store.inspect().durability, 'OS_FSYNC_ACKNOWLEDGEMENT_ONLY');
  const read = inspect(store);
  assert.equal(read.status, 'FINAL_PRESENT'); assert.equal(read.events.length, 3);
  assert.deepEqual(read.events.map(e => e.sequence), [0, 1, 5]); // retained ordinal != runner sequence
  assert.equal(read.durabilityAcknowledgement, 'UNKNOWN'); assert.equal(read.semanticExecutionValidation, 'NOT_PERFORMED');
  assert.equal(read.resumable, false); assert.equal(read.authorizing, false);
  await assert.rejects(store.retain(terminal()));
  assert.equal(fs.statSync(store.inspect().file).mode & 0o077, 0);
});

test('actual paired runner awaits real store and emits a reopenable full experiment trace', async t => {
  const parentDirectory = temporary(t), store = createPairedTrialEventStoreV1({ parentDirectory }); t.after(() => store.close());
  const plan = { schemaVersion: 'nisi-prevention-experiment-plan-v1', planId: 'plan.store',
    policy: { version: 'policy.v1', sha256: hash('policy'), influenceEnabled: false }, proposer: 'author', acceptanceReviewer: 'reviewer',
    trainingDigests: [], tasks: [{ caseId: 'case.one', taskSha256: hash('task'), baselineSha256: hash('baseline'), oracleSha256: hash('oracle'),
      armOrder: ['OFF_ON', 'ON_OFF'] }], repetitions: 2, exclusions: [],
    budget: { maxDurationMs: 30000, maxModelCalls: 100, maxInputTokens: 1000, maxOutputTokens: 1000 }, measuredTelemetry: 'UNKNOWN_UNTIL_RUN' };
  const profile = { schemaVersion: 'nisi-prevention-execution-profile-v1', planSha256: readPreventionExperimentPlanV1(plan).planSha256,
    model: 'fixed-local-fixture', modelSettingsSha256: hash('settings'), toolchainSha256: hash('node'), resourceBudgetSha256: hash('budget'),
    trialPolicy: { version: plan.policy.version, sha256: plan.policy.sha256 }, executorTimeoutMs: 500,
    oracleTimeoutMs: 500, retentionTimeoutMs: 500, drainTimeoutMs: 10 };
  const op = result => ({ result: Promise.resolve(result), settled: Promise.resolve(), status: () => 'IDLE', cancel() {} });
  let calls = 0;
  const runner = createPairedTrialRunnerV1({ plan, profile, host: {
    retain: store.retain, verifyInputs: () => true,
    startExecutor: intent => {
      const before = inspect(store); assert.equal(before.events.at(-1).type, 'START_INTENT');
      assert.equal(before.events.at(-1).requestId, intent.requestId); calls++;
      const candidateText = intent.arm === 'ON' ? '{"correct":true}' : '{"correct":false}';
      return op({ requestId: intent.requestId, profileSha256: intent.profileSha256, candidateText, candidateSha256: hash(candidateText),
        completionClaim: true, tokenUsage: { input: 0, output: 0 }, modelCalls: 0, durationMs: null, repairAttempts: 0 });
    }, startOracle: request => op({ requestId: request.requestId, oracleSha256: request.oracleSha256,
      oracleCandidateSha256: hash(request.candidateText), outcome: JSON.parse(request.candidateText).correct ? 'PASS' : 'FAIL' })
  } });
  const result = await runner.run(), read = inspect(store);
  assert.equal(result.status, 'COMPLETE'); assert.equal(calls, 4); assert.equal(read.status, 'FINAL_PRESENT');
  assert.equal(read.events.length, 18); assert.equal(store.inspect().state, 'CLOSED');
  assert.equal(read.events.filter(e => e.type === 'PHASE_RESULT').length, 8);
  assert.equal(fs.readFileSync(store.inspect().file, 'utf8').includes('candidateText'), false);
  assert.equal(read.remoteExecutionStopped, 'UNKNOWN');
  const reconciled = reconcilePairedTrialEventStoreV1({ directory: store.inspect().directory });
  assert.equal(reconciled.status, 'FINAL_CONSISTENT'); assert.equal(reconciled.counts.completePhaseRecords, 4);
  assert.equal(reconciled.batches[0].pairedRows.pairs[0].off.outcome, 'FAIL');
  assert.equal(reconciled.batches[0].pairedRows.pairs[0].on.outcome, 'PASS');
});

test('file fsync failure seals writer; readable bytes are not proof of acknowledged durability', async t => {
  const parentDirectory = temporary(t); let armed = false;
  const store = createPairedTrialEventStoreV1({ parentDirectory }, { io: { ...fs, fsyncSync(fd) { if (armed) throw Error('EIO'); fs.fsyncSync(fd); } } });
  armed = true; await assert.rejects(store.retain(schedule()));
  assert.equal(store.inspect().state, 'COMMIT_UNCERTAIN'); assert.equal(store.inspect().retainedEvents, 0);
  const before = fs.readFileSync(store.inspect().file);
  await assert.rejects(store.retain(schedule())); assert.deepEqual(fs.readFileSync(store.inspect().file), before);
  assert.equal(inspect(store).durabilityAcknowledgement, 'UNKNOWN');
});

test('partial write preserves prior prefix, seals writer and never truncates or retries', async t => {
  const parentDirectory = temporary(t); let fault = false, partial = false;
  const store = createPairedTrialEventStoreV1({ parentDirectory }, { io: { ...fs, writeSync(fd, b, offset, length, position) {
    if (!fault) return fs.writeSync(fd, b, offset, length, position);
    if (partial) throw Error('EIO'); partial = true; return fs.writeSync(fd, b, offset, 7, position);
  } } });
  await store.retain(schedule()); fault = true; await assert.rejects(store.retain(start()));
  const read = inspect(store); assert.equal(read.status, 'PARTIAL_TAIL'); assert.equal(read.events.length, 1);
  assert.equal(store.inspect().state, 'COMMIT_UNCERTAIN');
  const before = fs.readFileSync(store.inspect().file); await assert.rejects(store.retain(start()));
  assert.deepEqual(fs.readFileSync(store.inspect().file), before);
});

test('replacement of named file is detected without writing to replacement or old descriptor', async t => {
  const parentDirectory = temporary(t), store = createPairedTrialEventStoreV1({ parentDirectory });
  await store.retain(schedule()); const file = store.inspect().file, old = `${file}.retained`;
  fs.renameSync(file, old); fs.writeFileSync(file, 'replacement', { mode: 0o600 });
  const before = fs.readFileSync(old); await assert.rejects(store.retain(start()));
  assert.equal(fs.readFileSync(file, 'utf8'), 'replacement'); assert.deepEqual(fs.readFileSync(old), before);
  assert.equal(store.inspect().state, 'SEALED');
});

test('renamed run directory and symlink inputs are rejected', async t => {
  const parentDirectory = temporary(t), store = createPairedTrialEventStoreV1({ parentDirectory });
  const directory = store.inspect().directory, moved = `${directory}.moved`;
  fs.renameSync(directory, moved); fs.symlinkSync(moved, directory, 'dir');
  await assert.rejects(store.retain(schedule())); assert.equal(inspect(store).status, 'UNAVAILABLE');
  const link = path.join(parentDirectory, 'link'); fs.symlinkSync(moved, link, 'dir');
  assert.throws(() => createPairedTrialEventStoreV1({ parentDirectory: link }));
});

test('raw candidate keys, illegal event shape and event order seal writer before extra bytes', async t => {
  for (const invalid of [{ ...start(), candidateText: 'private' }, { ...start(), phase: 'OTHER' }, { ...start(), type: 'UNKNOWN' }, { ...start(), sequence: 0 }]) {
    const parentDirectory = temporary(t), store = createPairedTrialEventStoreV1({ parentDirectory }); await store.retain(schedule());
    const before = fs.readFileSync(store.inspect().file); await assert.rejects(store.retain(invalid));
    assert.deepEqual(fs.readFileSync(store.inspect().file), before); assert.equal(store.inspect().state, 'SEALED');
  }
});

test('readback failure and final close uncertainty never fulfill retention', async t => {
  for (const kind of ['read', 'close']) {
    const parentDirectory = temporary(t); let armed = false;
    const store = createPairedTrialEventStoreV1({ parentDirectory }, { io: { ...fs,
      readSync(...args) { if (armed && kind === 'read') throw Error('read failed'); return fs.readSync(...args); },
      closeSync(fd) { fs.closeSync(fd); if (armed && kind === 'close') throw Error('close unconfirmed'); }
    } });
    await store.retain(schedule()); armed = true; await assert.rejects(store.retain(terminal()));
    assert.equal(store.inspect().state, 'COMMIT_UNCERTAIN'); assert.equal(store.inspect().finalSeen, false);
    assert.equal(store.inspect().retainedEvents, 1);
    assert.equal(store.inspect().retentionCountSemantics, 'FULLY_CONFIRMED_STORE_OPERATIONS');
    if (kind === 'close') assert.equal(store.inspect().failureCause, 'TRIAL_STORE_CLOSE_UNCONFIRMED');
  }
});

test('valid chain prefix retained when a later line is corrupted; read-only inspection leaves bytes unchanged', async t => {
  const parentDirectory = temporary(t), store = createPairedTrialEventStoreV1({ parentDirectory });
  await store.retain(schedule()); await store.retain(start()); store.close();
  const file = store.inspect().file, lines = fs.readFileSync(file, 'utf8').split('\n');
  lines[1] = lines[1].replace('START_INTENT', 'OTHER_INTENT'); fs.writeFileSync(file, lines.join('\n'));
  const before = fs.readFileSync(file), read = inspect(store);
  assert.equal(read.status, 'CORRUPT'); assert.equal(read.events.length, 1); assert.equal(read.resumable, false);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('retained ordinal bounds support full declared event count, sequence gaps are legal', () => {
  assert.equal(TRIAL_EVENT_LIMITS.maxEvents, 1 + 16384 * 4 + 1);
  const encoded = encodeTrialEventV1({ ...start(), sequence: 131072 }, 65537, hash('previous'));
  assert.equal(decodeTrialEventV1(encoded.bytes, 65537, hash('previous')).sha256, encoded.sha256);
  assert.throws(() => encodeTrialEventV1(start(), 65538, hash('previous')));
  assert.throws(() => decodeTrialEventV1(encoded.bytes, 65536, hash('previous')));
});

test('directory fsync failure refuses construction and preserves evidence without a writable owner', t => {
  const parentDirectory = temporary(t); let failure;
  try { createPairedTrialEventStoreV1({ parentDirectory }, { io: { ...fs, fsyncSync() { throw Error('directory EIO'); } } }); }
  catch (error) { failure = error; }
  assert.equal(failure?.code, 'TRIAL_STORE_CREATE_UNCONFIRMED');
  assert.equal(fs.readFileSync(path.join(failure.directory, 'events.jsonl')).length, 0);
  assert.equal(inspectPairedTrialEventStoreV1({ directory: failure.directory }).status, 'EMPTY');
  assert.equal(inspectPairedTrialEventStoreV1({ directory: failure.directory }).creationAcknowledgement, 'UNKNOWN');
});

test('two separate owners never share a file or overwrite an earlier run', async t => {
  const parentDirectory = temporary(t), a = createPairedTrialEventStoreV1({ parentDirectory }), b = createPairedTrialEventStoreV1({ parentDirectory });
  t.after(() => a.close()); t.after(() => b.close());
  assert.notEqual(a.inspect().directory, b.inspect().directory);
  await a.retain(schedule()); const before = fs.readFileSync(a.inspect().file); await b.retain(schedule());
  assert.deepEqual(fs.readFileSync(a.inspect().file), before);
  assert.equal(inspect(a).events.length, 1); assert.equal(inspect(b).events.length, 1);
});

test('bytes appended after FINAL are corruption, never a later successful outcome', async t => {
  const parentDirectory = temporary(t), store = createPairedTrialEventStoreV1({ parentDirectory });
  await store.retain(schedule()); await store.retain(terminal());
  fs.appendFileSync(store.inspect().file, encodeTrialEventV1({ ...start(), sequence: 9 }, 2, store.inspect().lastSha256).bytes);
  const read = inspect(store); assert.equal(read.status, 'CORRUPT'); assert.equal(read.events.length, 2);
  assert.equal(read.finalPresent, true); assert.equal(read.durabilityAcknowledgement, 'UNKNOWN');
});

test('SCHEDULE sequence must start at zero; intentional later diagnostic gaps remain valid', async t => {
  const parentDirectory = temporary(t), store = createPairedTrialEventStoreV1({ parentDirectory });
  await assert.rejects(store.retain({ ...schedule(), sequence: 1 }));
  assert.equal(store.inspect().state, 'SEALED'); assert.equal(fs.readFileSync(store.inspect().file).length, 0);
});

test('scratch-like temp base produces external private fixtures without weakening source refusal', t => {
  const parentDirectory = temporary(t, sourceRoot), store = createPairedTrialEventStoreV1({ parentDirectory });
  t.after(() => store.close());
  assert.equal(fs.statSync(parentDirectory).mode & 0o077, 0);
  assert.equal(path.dirname(parentDirectory), path.dirname(sourceRoot));
  const inside = fs.mkdtempSync(path.join(sourceRoot, '.nisi-event-refusal-'));
  t.after(() => fs.rmSync(inside, { recursive: true, force: true }));
  assert.throws(() => createPairedTrialEventStoreV1({ parentDirectory: inside }), { code: 'NISI_STATE_DIRECTORY_INVALID' });
  assert.deepEqual(fs.readdirSync(inside), []);
});

test('read-only private archive remains inspectable without write permission', async t => {
  const store = createPairedTrialEventStoreV1({ parentDirectory: temporary(t) });
  await store.retain(schedule()); await store.retain(terminal());
  const directory = store.inspect().directory;
  fs.chmodSync(directory, 0o500);
  try {
    const result = inspect(store);
    assert.equal(result.status, 'FINAL_PRESENT'); assert.equal(result.events.length, 2);
    assert.equal(result.creationAcknowledgement, 'UNKNOWN'); assert.equal(result.durabilityAcknowledgement, 'UNKNOWN');
    assert.equal(result.authorizing, false);
  } finally { fs.chmodSync(directory, 0o700); }
});

test('sealed writer retains bounded failure cause without reopening or copying thrown text', async t => {
  const store = createPairedTrialEventStoreV1({ parentDirectory: temporary(t) });
  await store.retain(schedule()); await assert.rejects(store.retain({ ...start(), sequence: 0 }));
  assert.equal(store.inspect().state, 'SEALED'); assert.equal(store.inspect().failureCause, 'TRIAL_STORE_EVENT_ORDER');
  assert.equal(store.inspect().retainedEvents, 1);
  await assert.rejects(store.retain(start()));
  let armed = false;
  const fault = createPairedTrialEventStoreV1({ parentDirectory: temporary(t) }, { io: { ...fs,
    writeSync(...args) { if (armed) throw Object.assign(Error('private text'), { code: 'secret-path' }); return fs.writeSync(...args); }
  } });
  armed = true; await assert.rejects(fault.retain(schedule()));
  assert.equal(fault.inspect().failureCause, 'TRIAL_STORE_IO_OR_INPUT_FAILURE');
  assert.equal(JSON.stringify(fault.inspect()).includes('private text'), false);
  assert.equal(JSON.stringify(fault.inspect()).includes('secret-path'), false);
});

test('read-only inspector still rejects public, symlinked and source-contained selections', async t => {
  const store = createPairedTrialEventStoreV1({ parentDirectory: temporary(t) });
  await store.retain(schedule()); store.close();
  const directory = store.inspect().directory;
  fs.chmodSync(directory, 0o755);
  try { assert.equal(inspect(store).status, 'UNAVAILABLE'); } finally { fs.chmodSync(directory, 0o700); }
  const link = path.join(path.dirname(directory), 'archive-link'); fs.symlinkSync(directory, link, 'dir');
  for (const selected of [link, link + '/', link + '/.', sourceRoot]) {
    const result = inspectPairedTrialEventStoreV1({ directory: selected });
    assert.equal(result.status, 'UNAVAILABLE'); assert.equal(result.authorizing, false);
  }
});
