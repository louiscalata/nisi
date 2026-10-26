import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseNisiArguments } from '../cli/arguments.mjs';
import { createPairedTrialRunnerV1 } from '../evaluation/paired-trial-runner-v1.mjs';
import { createPairedTrialEventStoreV1 } from '../history/paired-trial-event-store-v1.mjs';
import { pairedTrialFixtureInputs, pairedTrialFixtureEvents, retainPairedTrialFixture } from './helpers/paired-trial-fixture.mjs';
const root = fs.realpathSync(path.resolve(import.meta.dirname, '..'));
const guard = path.join(root, 'tests/helpers/nisi-cli-no-effects.mjs');
const within = (parent, child) => { const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
function temporary(t) {
  const base = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(within(root, base) ? path.dirname(root) : base, 'nisi-trial-cli-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert(!within(root, directory) && !within(directory, root)); return directory;
}
function cli(directory, args, expected, extraEnv = {}) {
  const result = spawnSync(process.execPath, ['--import', guard, path.join(root, 'bin/nisi.mjs'), ...args], {
    cwd: directory, env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory,
      NISI_CLI_TEST_ALLOW_TRIAL: '1', NISI_CLI_TEST_PACKAGE_ROOT: root, ...extraEnv },
    encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 65536,
  });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, expected, result.stderr); return result;
}
const fields = ['schemaVersion', 'status', 'exitCode', 'byteStatus', 'semanticStatus', 'counts', 'runnerId',
  'planSha256', 'profileSha256', 'finalStopReason', 'actualDispatchCount', 'sourceTrust',
  'creationAcknowledgement', 'durabilityAcknowledgement', 'remoteExecutionStopped',
  'durationBudgetReconciliation', 'drainSemantics', 'candidateBytesRevalidated', 'measurementVerified',
  'causalClaim', 'authorizing', 'resumable', 'promotionEligible'].sort();
function report(result, selectedDirectory) {
  assert.equal(result.stderr, ''); assert(result.stdout.length < 4096);
  const value = JSON.parse(result.stdout); assert.deepEqual(Object.keys(value).sort(), fields);
  assert.equal(value.schemaVersion, 'nisi-cli-trial-inspection-v1'); assert.equal(value.exitCode, result.status);
  assert.equal(value.actualDispatchCount, null); assert.equal(value.sourceTrust, 'UNAUTHENTICATED_HOST_STATEMENTS');
  for (const key of ['creationAcknowledgement', 'durabilityAcknowledgement', 'remoteExecutionStopped']) assert.equal(value[key], 'UNKNOWN');
  for (const key of ['candidateBytesRevalidated', 'measurementVerified', 'causalClaim', 'authorizing', 'resumable', 'promotionEligible']) assert.equal(value[key], false);
  assert.equal(value.durationBudgetReconciliation, 'NOT_RECONCILABLE_FROM_RETAINED_EVENTS');
  assert.equal(value.drainSemantics, 'NOT_VALIDATED');
  assert(!result.stdout.includes(selectedDirectory)); assert(!result.stdout.includes('PRIVATE_'));
  return value;
}

test('inspect-trial parser snapshots exactly one bounded absolute operand', () => {
  const input = ['inspect-trial', path.join(root, 'not-opened')], parsed = parseNisiArguments(input);
  assert.equal(parsed.command, 'inspect-trial'); assert.deepEqual(parsed.args, input.slice(1));
  assert(Object.isFrozen(parsed) && Object.isFrozen(parsed.args)); input[1] = 'changed'; assert.notEqual(parsed.args[0], input[1]);
  for (const args of [['inspect-trial'], ['inspect-trial', ''], ['inspect-trial', 'relative'],
    ['inspect-trial', '/' + 'a'.repeat(4096)], ['inspect-trial', '/a\0b'], ['inspect-trial', root, 'extra']])
    assert.throws(() => parseNisiArguments(args), { code: 'NISI_CLI_ARGUMENTS' });
});

test('inspect-trial malformed usage emits only sanitized stderr without loading inspection', t => {
  const directory = temporary(t);
  for (const args of [['inspect-trial'], ['inspect-trial', 'PRIVATE_RELATIVE'], ['inspect-trial', root, 'extra']]) {
    const result = cli(directory, args, 2); assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).code, 'NISI_CLI_ARGUMENTS'); assert(!result.stderr.includes('PRIVATE_RELATIVE'));
  }
});

test('real CLI observes final trial metadata only, even when all oracle outcomes failed', async t => {
  const parent = temporary(t), events = await pairedTrialFixtureEvents(), store = await retainPairedTrialFixture(parent, events);
  const before = fs.readFileSync(store.file), beforeStat = fs.statSync(store.file);
  const value = report(cli(parent, ['inspect-trial', store.directory], 0, { NISI_CLI_TEST_SINGLE_CAPTURE: '1' }), store.directory);
  assert.equal(value.status, 'OBSERVED'); assert.equal(value.byteStatus, 'FINAL_PRESENT'); assert.equal(value.semanticStatus, 'FINAL_CONSISTENT');
  assert.deepEqual(value.counts, { planned: 4, uniqueTasks: 1, repetitions: 2, startIntents: 4, completePhaseRecords: 4, incompletePhaseRecords: 0 });
  assert.equal(value.runnerId, events[0].runnerId); assert.equal(value.planSha256, events[0].plan.planSha256);
  assert.equal(value.profileSha256, events[0].profile.profileSha256); assert.equal(value.finalStopReason, null);
  assert.deepEqual(fs.readFileSync(store.file), before);
  for (const key of ['mode', 'ctimeMs', 'mtimeMs', 'nlink', 'size', 'ino', 'dev']) assert.equal(fs.statSync(store.file)[key], beforeStat[key]);
  assert.deepEqual(fs.readdirSync(store.directory), ['events.jsonl']);
  assert(!JSON.stringify(value).includes(events[2].result.candidateSha256));
  assert(!JSON.stringify(value).includes(events[0].profile.model));
});

test('trial test allowance remains lazy, URL-exact and cannot load neighboring execution modules', t => {
  const parent = temporary(t);
  for (const relative of ['history/run-journal-store-v1.mjs', 'hosts/repository/node-executor-v1.mjs',
    'examples/repository-live-model.mjs', 'adapters/local-chat.mjs']) {
    const result = spawnSync(process.execPath, ['--import', guard, '--input-type=module', '-e',
      `await import(${JSON.stringify(path.join(root, relative))})`], {
      cwd: parent, env: { PATH: process.env.PATH, HOME: parent, NISI_CLI_TEST_ALLOW_TRIAL: '1', NISI_CLI_TEST_PACKAGE_ROOT: root },
      encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 65536,
    });
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 1);
    assert.match(result.stderr, /CLI_TEST_HEAVY_IMPORT/);
  }
  const store = path.join(parent, 'missing');
  const denied = cli(parent, ['inspect-trial', store], 2, { NISI_CLI_TEST_ALLOW_TRIAL: '0' });
  assert.equal(denied.stdout, ''); assert.equal(JSON.parse(denied.stderr).code, 'NISI_CLI_ERROR');
});

test('child guard detects descriptor mutation and alternate whole-file evidence reads even if caught', async t => {
  const parent = temporary(t), store = await retainPairedTrialFixture(parent, await pairedTrialFixtureEvents());
  const prefix = `import fs from 'node:fs'; import fsp from 'node:fs/promises'; import {pathToFileURL} from 'node:url'; const file=${JSON.stringify(store.file)};`;
  for (const probe of [
    `const fd=fs.openSync(file,'r'); try{fs.fchmodSync(fd,0o644)}catch{}finally{fs.closeSync(fd)}`,
    `const fh=await fsp.open(file,'r'); try{await fh.chmod(0o644)}catch{}finally{await fh.close()}`,
    `try{fs.readFileSync(pathToFileURL(file))}catch{}`,
    `try{await fsp.readFile(Buffer.from(file))}catch{}`,
    `const fd=fs.openSync(file,'r'); try{fs.readFileSync(fd)}catch{}finally{fs.closeSync(fd)}`,
    `const fh=await fsp.open(file,'r'); try{await fh.readFile()}catch{}finally{await fh.close()}`,
    `const fh=await fsp.open(file,'r'); try{await fsp.readFile(fh)}catch{}finally{await fh.close()}`,
  ]) {
    const result = spawnSync(process.execPath, ['--import', guard, '--input-type=module', '-e', prefix + probe], {
      cwd: parent, env: { PATH: process.env.PATH, HOME: parent, NISI_CLI_TEST_ALLOW_TRIAL: '1', NISI_CLI_TEST_PACKAGE_ROOT: root },
      encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 65536,
    });
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 99, result.stderr);
    assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
  }
});

test('inspector opens once with nonblocking flags and refuses a FIFO swapped after lstat', async t => {
  if (process.platform === 'win32') return t.skip('POSIX FIFO race fixture; separate Windows lane remains required');
  const parent = temporary(t), store = await retainPairedTrialFixture(parent, await pairedTrialFixtureEvents());
  const result = spawnSync(process.execPath, [path.join(root, 'tests/helpers/paired-trial-fifo-race.mjs'), store.directory], {
    cwd: parent, env: { PATH: process.env.PATH, HOME: parent }, encoding: 'utf8', timeout: 10000,
    killSignal: 'SIGKILL', maxBuffer: 65536,
  });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout); assert.equal(value.status, 'UNAVAILABLE'); assert.equal(value.opens, 1);
  assert.equal(value.nonblocking, true);
  assert.deepEqual(fs.readFileSync(path.join(store.directory, 'retained-original.jsonl')),
    fs.readFileSync(path.join(store.directory, 'expected-original.jsonl')));
});

test('empty, intent-only, partial-tail and corrupt-tail stores never become complete', async t => {
  const parent = temporary(t), events = await pairedTrialFixtureEvents();
  for (const [selected, tail, byteStatus, semanticStatus] of [
    [[], '', 'EMPTY', 'NOT_PERFORMED'], [events.slice(0, 2), '', 'INCOMPLETE', 'INTERRUPTED'],
    [events.slice(0, 2), 'PRIVATE_PARTIAL', 'PARTIAL_TAIL', 'INTERRUPTED'],
    [events, 'PRIVATE_CORRUPT\n', 'CORRUPT', 'INTERRUPTED'],
  ]) {
    const store = await retainPairedTrialFixture(parent, selected); if (tail) fs.appendFileSync(store.file, tail);
    const before = fs.readFileSync(store.file), value = report(cli(parent, ['inspect-trial', store.directory], 1,
      { NISI_CLI_TEST_SINGLE_CAPTURE: '1' }), store.directory);
    assert.equal(value.status, 'INCOMPLETE'); assert.equal(value.byteStatus, byteStatus); assert.equal(value.semanticStatus, semanticStatus);
    if (!selected.length) { assert.equal(value.counts, null); assert.equal(value.runnerId, null); }
    else {
      assert.deepEqual(value.counts, { planned: 4, uniqueTasks: 1, repetitions: 2,
        startIntents: selected.length === 2 ? 1 : 4, completePhaseRecords: selected.length === 2 ? 0 : 4,
        incompletePhaseRecords: selected.length === 2 ? 1 : 0 });
      assert.equal(value.runnerId, events[0].runnerId); assert.equal(value.planSha256, events[0].plan.planSha256);
      assert.equal(value.profileSha256, events[0].profile.profileSha256);
    }
    assert.equal(value.finalStopReason, null);
    assert.deepEqual(fs.readFileSync(store.file), before);
  }
});

test('semantically forged or missing stores refuse as bounded stdout reports', async t => {
  const parent = temporary(t), events = await pairedTrialFixtureEvents();
  events[4].result.oracleCandidateSha256 = '0'.repeat(64);
  const store = await retainPairedTrialFixture(parent, events), before = fs.readFileSync(store.file);
  const forged = report(cli(parent, ['inspect-trial', store.directory], 2, { NISI_CLI_TEST_SINGLE_CAPTURE: '1' }), store.directory);
  assert.equal(forged.status, 'REFUSED'); assert.equal(forged.byteStatus, 'FINAL_PRESENT'); assert.equal(forged.semanticStatus, 'REFUSED');
  assert.equal(forged.counts, null); assert.equal(forged.runnerId, null); assert.equal(forged.planSha256, null);
  assert.deepEqual(fs.readFileSync(store.file), before);
  const missing = path.join(parent, 'PRIVATE_MISSING');
  const absent = report(cli(parent, ['inspect-trial', missing], 2), missing);
  assert.equal(absent.byteStatus, 'UNAVAILABLE'); assert.equal(absent.semanticStatus, 'NOT_PERFORMED'); assert.equal(absent.counts, null);
});

test('adverse final is observable without being labeled successful or verified', async t => {
  const parent = temporary(t), events = await pairedTrialFixtureEvents({ unknownUsage: true });
  const store = await retainPairedTrialFixture(parent, events);
  const value = report(cli(parent, ['inspect-trial', store.directory], 0, { NISI_CLI_TEST_SINGLE_CAPTURE: '1' }), store.directory);
  assert.equal(value.status, 'OBSERVED'); assert.equal(value.finalStopReason, events.at(-1).stopReason);
  assert.notEqual(value.finalStopReason, null); assert.equal(value.counts.completePhaseRecords, 1); assert.equal(value.counts.planned, 4);
});

test('user-stop travels through actual store acknowledgments and separate read-only CLI processes', async t => {
  const parent = temporary(t), hash = value => createHash('sha256').update(value).digest('hex');
  const op = value => ({ result: Promise.resolve(value), settled: Promise.resolve(), status: () => 'IDLE', cancel() {} });
  for (const boundary of ['SCHEDULE', 'ORACLE_RESULT']) {
    const writer = createPairedTrialEventStoreV1({ parentDirectory: parent }); let runner;
    const { plan, profile } = pairedTrialFixtureInputs();
    runner = createPairedTrialRunnerV1({ plan, profile, host: {
      retain: async event => {
        await writer.retain(event);
        if (event.type === boundary || (boundary === 'ORACLE_RESULT' && event.type === 'PHASE_RESULT' && event.phase === 'ORACLE'))
          assert.equal(runner.requestStop().status, 'REQUESTED');
      }, verifyInputs: () => true,
      startExecutor: intent => op({ requestId: intent.requestId, profileSha256: intent.profileSha256,
        candidateText: 'PRIVATE_STOP_FIXTURE', candidateSha256: hash('PRIVATE_STOP_FIXTURE'), completionClaim: true,
        tokenUsage: { input: 0, output: 0 }, durationMs: null, repairAttempts: 0, modelCalls: 0 }),
      startOracle: request => op({ requestId: request.requestId, oracleSha256: request.oracleSha256,
        oracleCandidateSha256: request.candidateSha256, outcome: 'PASS' }),
    } });
    let run;
    try { run = await runner.run(); } finally { writer.close(); }
    assert.equal(run.status, 'STOPPED'); assert.equal(run.stopReason, 'RUNNER_USER_STOP_REQUESTED');
    assert.equal(run.retentionStatus, 'CONFIRMED'); const store = writer.inspect();
    assert.equal(store.state, 'CLOSED'); assert.equal(store.finalSeen, true);
    const before = fs.readFileSync(store.file), beforeStat = fs.statSync(store.file);
    const observed = report(cli(parent, ['inspect-trial', store.directory], 0, { NISI_CLI_TEST_SINGLE_CAPTURE: '1' }), store.directory);
    assert.equal(observed.status, 'OBSERVED'); assert.equal(observed.byteStatus, 'FINAL_PRESENT');
    assert.equal(observed.semanticStatus, 'FINAL_CONSISTENT'); assert.equal(observed.finalStopReason, run.stopReason);
    assert.equal(observed.runnerId, run.runnerId);
    const completed = boundary === 'SCHEDULE' ? 0 : 1;
    assert.equal(run.counts.completed, completed); assert.equal(run.counts.executorStarted, completed);
    assert.deepEqual(observed.counts, { planned: 4, uniqueTasks: 1, repetitions: 2, startIntents: completed,
      completePhaseRecords: completed, incompletePhaseRecords: 0 });
    assert.deepEqual(report(cli(parent, ['inspect-trial', store.directory], 0), store.directory), observed);
    assert.deepEqual(fs.readFileSync(store.file), before);
    for (const key of ['mode', 'ctimeMs', 'mtimeMs', 'nlink', 'size', 'ino', 'dev']) assert.equal(fs.statSync(store.file)[key], beforeStat[key]);
    assert.deepEqual(fs.readdirSync(store.directory), ['events.jsonl']);
  }
});

test('private readonly archive is inspectable; directory symlink spellings refuse', async t => {
  const parent = temporary(t), events = await pairedTrialFixtureEvents(), store = await retainPairedTrialFixture(parent, events);
  fs.chmodSync(store.directory, 0o500);
  try { assert.equal(report(cli(parent, ['inspect-trial', store.directory], 0,
    { NISI_CLI_TEST_SINGLE_CAPTURE: '1' }), store.directory).status, 'OBSERVED'); }
  finally { fs.chmodSync(store.directory, 0o700); }
  const link = path.join(parent, 'link'); fs.symlinkSync(store.directory, link);
  for (const target of [link, link + '/', link + '/.']) {
    const value = report(cli(parent, ['inspect-trial', target], 2), target); assert.equal(value.byteStatus, 'UNAVAILABLE');
  }
});

test('readable valid bytes still refuse public modes, hard links, file symlinks and source-contained stores', async t => {
  const parent = temporary(t), events = await pairedTrialFixtureEvents();
  for (const kind of ['public-file', 'public-directory', 'hard-link', 'file-symlink', 'source-contained']) {
    const store = await retainPairedTrialFixture(parent, events), original = fs.readFileSync(store.file);
    let selected = store.directory, bytesTarget = store.file;
    if (kind === 'public-file') fs.chmodSync(store.file, 0o644);
    if (kind === 'public-directory') fs.chmodSync(store.directory, 0o755);
    if (kind === 'hard-link') fs.linkSync(store.file, path.join(parent, 'extra-link'));
    if (kind === 'file-symlink') {
      bytesTarget = path.join(parent, 'symlink-target'); fs.renameSync(store.file, bytesTarget); fs.symlinkSync(bytesTarget, store.file);
    }
    if (kind === 'source-contained') {
      selected = fs.mkdtempSync(path.join(root, '.trial-inside-test-'));
      t.after(() => fs.rmSync(selected, { recursive: true, force: true }));
      fs.writeFileSync(path.join(selected, 'events.jsonl'), original, { flag: 'wx', mode: 0o600 });
    }
    const value = report(cli(parent, ['inspect-trial', selected], 2), selected);
    assert.equal(value.byteStatus, 'UNAVAILABLE', kind); assert.equal(value.semanticStatus, 'NOT_PERFORMED');
    assert.deepEqual(fs.readFileSync(bytesTarget), original);
  }
});
