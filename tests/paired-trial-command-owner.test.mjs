import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createPairedTrialCommandOwnerV1 } from '../cli/paired-trial-command-owner.mjs';
import { inspectTrialDirectoryV1 } from '../cli/paired-trial-inspect.mjs';
import { inspectPairedTrialEventStoreV1 } from '../history/paired-trial-event-store-v1.mjs';
import { pairedTrialCommandFixture, deferredTrialValue } from './helpers/paired-trial-command-fixture.mjs';

const STOP = 'RUNNER_USER_STOP_REQUESTED';
const turn = () => new Promise(setImmediate);
const root = fs.realpathSync(path.resolve(import.meta.dirname, '..'));
const within = (parent, child) => { const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
function context(t) {
  const temp = fs.realpathSync(os.tmpdir());
  // Nisi scratch places TMPDIR in source; evidence must be a private sibling.
  const parentDirectory = fs.mkdtempSync(path.join(within(root, temp) ? path.dirname(root) : temp, 'nisi-command-test-'));
  t.after(() => fs.rmSync(parentDirectory, { recursive: true, force: false }));
  const f = pairedTrialCommandFixture(), signalSource = new EventEmitter(), io = { ...fs };
  return { f, parentDirectory, signalSource, io,
    create: () => createPairedTrialCommandOwnerV1({ plan: f.plan, profile: f.profile, host: f.host, parentDirectory }, { signalSource, io }) };
}
function recorded(report) {
  assert.equal(report.state, 'FINISHED'); assert.equal(report.recorded, true); assert.equal(report.reason, null);
  assert.equal(report.setup, 'COMPLETE'); assert.equal(report.storage.finalSeen, true);
  assert.deepEqual({ ...report.cleanup }, { signals: 'REMOVED', storage: 'CLOSED' });
  assert.equal(report.pendingRetentions, 0);
  for (const key of ['authorizing', 'resumable', 'measurementVerified', 'causalClaim', 'promotionEligible']) assert.equal(report[key], false);
  assert.equal(report.remoteExecutionStopped, 'UNKNOWN');
  const observed = inspectTrialDirectoryV1(report.storage.directory);
  assert.equal(observed.semanticStatus, 'FINAL_CONSISTENT'); assert.equal(observed.authorizing, false);
  const bytes = fs.readFileSync(report.storage.file);
  assert(!bytes.includes('FIXED_PRIVATE_TEST_CANDIDATE'));
  assert.equal(inspectPairedTrialEventStoreV1({ directory: report.storage.directory }).events.filter(e => e.type === 'FINAL').length, 1);
}

test('constructor validates before effects and captures inputs and methods once', async t => {
  const c = context(t), owner = c.create();
  assert.equal(owner.inspect().state, 'READY'); assert.deepEqual(fs.readdirSync(c.parentDirectory), []);
  assert.equal(c.signalSource.listenerCount('SIGINT'), 0); assert.equal(c.signalSource.listenerCount('SIGTERM'), 0);
  assert.deepEqual(c.f.calls, []); assert.equal(owner.requestStop().status, 'REFUSED');
  assert.throws(() => owner.requestStop('reason'), { code: 'TRIAL_COMMAND_ARGUMENTS' });
  await assert.rejects(owner.run('extra'), { code: 'TRIAL_COMMAND_ARGUMENTS' });
  c.f.plan.tasks[0].caseId = 'changed'; c.f.profile.model = 'changed'; c.f.host.startExecutor = () => { throw Error('changed'); };
  c.signalSource.on = c.signalSource.removeListener = c.io.writeSync = () => { throw Error('changed'); };
  const report = await owner.run(); recorded(report);
  assert.equal(report.ledger.status, 'COMPLETE'); assert.equal(report.ledger.records[0].intent.caseId, 'case.one');
  assert.equal(report.ledger.records[0].intent.model, 'fixed-test-host');
  assert.equal(report.ledger.counts.oracleFail, 4); // Recorded is not task success.
  assert.deepEqual(owner.inspect(), report); assert(Object.isFrozen(report));
  assert.equal(owner.requestStop().status, 'REFUSED');
  await assert.rejects(owner.run(), { code: 'TRIAL_COMMAND_ALREADY_RAN' });
  assert.equal(c.signalSource.listenerCount('SIGINT'), 0);
});

test('invalid input and accessors are refused without filesystem or signal effects', t => {
  const c = context(t); let getters = 0;
  Object.defineProperty(c.f.host, 'startExecutor', { get: () => { getters++; }, enumerable: true });
  assert.throws(c.create, { code: 'TRIAL_RECORD' }); assert.equal(getters, 0);
  assert.deepEqual(fs.readdirSync(c.parentDirectory), []); assert.equal(c.signalSource.eventNames().length, 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) test(`${signal} routes repeated stop to sole runner cancellation and preserves unrelated listeners`, async t => {
  const c = context(t), started = deferredTrialValue(), result = deferredTrialValue(), settled = deferredTrialValue();
  let cancels = 0, state = 'BUSY', others = 0;
  const unrelated = () => { others++; }; c.signalSource.on(signal, unrelated);
  c.f.host.startExecutor = () => { started.resolve(); return { result: result.promise, settled: settled.promise,
    status: () => state, cancel() { cancels++; result.reject(Error('stopped')); state = 'OFF'; settled.resolve(); } }; };
  const owner = c.create(), running = owner.run(); await started.promise;
  c.signalSource.emit(signal); c.signalSource.emit(signal); assert.equal(cancels, 0);
  const report = await running; recorded(report);
  assert.equal(report.ledger.stopReason, STOP); assert.equal(report.ledger.counts.completed, 0);
  assert.equal(report.ledger.counts.executorStarted, 1); assert.equal(report.ledger.counts.oracleStarted, 0);
  assert.equal(report.ledger.drain.status, 'OFF'); assert.equal(cancels, 1); assert.equal(others, 2);
  assert.equal(report.firstSignal, signal); assert.equal(report.ledger.events.filter(e => e.type === 'STOP_REQUESTED').length, 1);
  assert.equal(c.signalSource.listenerCount(signal), 1);
  assert.deepEqual(c.signalSource.rawListeners(signal), [unrelated]);
  const before = fs.readFileSync(report.storage.file); c.signalSource.emit(signal);
  assert.deepEqual(owner.inspect(), report); assert.deepEqual(fs.readFileSync(report.storage.file), before); assert.equal(cancels, 1);
});

test('setup signal latch survives either installation boundary without dispatch', async t => {
  for (const boundary of ['SIGINT', 'SIGTERM']) {
    const c = context(t);
    c.signalSource.on = function (signal, listener) {
      EventEmitter.prototype.on.call(this, signal, listener);
      if (signal === boundary) { this.emit('SIGINT'); this.emit('SIGINT'); }
      return this;
    };
    const report = await c.create().run(); recorded(report);
    assert.equal(report.setupStop, true); assert.equal(report.ledger.stopReason, STOP);
    assert.equal(report.ledger.counts.executorStarted, 0); assert.equal(report.firstSignal, 'SIGINT');
    assert.equal(report.ledger.events.filter(e => e.type === 'STOP_REQUESTED').length, 1);
    assert.deepEqual(c.f.calls, []);
  }
});

test('install then throw rolls back both exact identities without store creation', async t => {
  for (const boundary of ['SIGINT', 'SIGTERM']) {
    const c = context(t); const other = () => {}; c.signalSource.on('SIGINT', other);
    c.signalSource.on = function (signal, listener) {
      EventEmitter.prototype.on.call(this, signal, listener); if (signal === boundary) throw Error('PRIVATE_SETUP_ERROR'); return this;
    };
    const report = await c.create().run(); assert.equal(report.recorded, false);
    assert.equal(report.setup, 'REFUSED'); assert.equal(report.reason, 'TRIAL_COMMAND_SIGNAL_INSTALL');
    assert.deepEqual({ ...report.cleanup }, { signals: 'REMOVED', storage: 'NOT_OPENED' });
    assert.equal(report.ledger, null); assert.deepEqual(fs.readdirSync(c.parentDirectory), []);
    assert.deepEqual(c.signalSource.rawListeners('SIGINT'), [other]); assert.equal(c.signalSource.listenerCount('SIGTERM'), 0);
    assert(!JSON.stringify(report).includes('PRIVATE_SETUP_ERROR'));
  }
});

test('silent listener installation failure refuses the command', async t => {
  const c = context(t); c.signalSource.on = function () { return this; };
  const report = await c.create().run(); assert.equal(report.reason, 'TRIAL_COMMAND_SIGNAL_INSTALL');
  assert.equal(report.recorded, false); assert.equal(report.ledger, null); assert.deepEqual(fs.readdirSync(c.parentDirectory), []);
});

test('store creation failure does not dispatch and cleans signal ownership', async t => {
  const c = context(t); c.io.openSync = () => { throw Error('PRIVATE_IO_ERROR'); };
  const report = await c.create().run(); assert.equal(report.setup, 'REFUSED'); assert.equal(report.recorded, false);
  assert.equal(report.reason, 'TRIAL_COMMAND_STORE_CREATE'); assert.equal(report.ledger, null);
  assert.equal(report.cleanup.storage, 'CREATE_UNCONFIRMED');
  assert.equal(path.dirname(report.creationDirectory), c.parentDirectory);
  assert.equal(report.cleanup.signals, 'REMOVED'); assert.deepEqual(c.f.calls, []);
  assert.equal(fs.readdirSync(c.parentDirectory).length, 1); // Preserve partial evidence, do not delete/retry.
  assert(!JSON.stringify(report).includes('PRIVATE_IO_ERROR'));
});

test('signals within synchronous retention wait for acknowledgement and never overlap writes', async t => {
  for (const boundary of ['SCHEDULE', 'START_INTENT', 'PHASE_RESULT', 'FINAL']) {
    const c = context(t); let triggered = false, writing = false, overlappingClose = false;
    c.io.writeSync = (...args) => {
      writing = true;
      try {
        if (!triggered && JSON.parse(args[1].toString()).event.type === boundary) { triggered = true; c.signalSource.emit('SIGTERM'); }
        return fs.writeSync(...args);
      } finally { writing = false; }
    };
    c.io.closeSync = fd => { if (writing) overlappingClose = true; return fs.closeSync(fd); };
    const report = await c.create().run(); recorded(report); assert.equal(triggered, true); assert.equal(overlappingClose, false);
    assert.equal(report.ledger.stopReason, boundary === 'FINAL' ? null : STOP);
    assert.equal(report.ledger.counts.executorStarted, boundary === 'FINAL' ? 4 : boundary === 'PHASE_RESULT' ? 1 : 0);
  }
});

test('failed acknowledgement never becomes recorded or triggers a replacement FINAL', async t => {
  const c = context(t); let writes = 0;
  c.io.writeSync = (...args) => { writes++; return fs.writeSync(...args); };
  c.io.fsyncSync = fd => { if (writes) { c.signalSource.emit('SIGINT'); throw Error('private sync'); } return fs.fsyncSync(fd); };
  const report = await c.create().run(); assert.equal(report.recorded, false);
  assert.equal(report.ledger.stopReason, 'RUNNER_RETENTION_UNCONFIRMED'); assert.equal(report.ledger.retentionStatus, 'UNCONFIRMED');
  assert.equal(report.storage.state, 'COMMIT_UNCERTAIN'); assert.equal(report.storage.finalSeen, false);
  assert.equal(report.cleanup.storage, 'UNCONFIRMED'); assert.equal(report.cleanup.signals, 'REMOVED');
  assert.equal(report.storage.retainedEvents, 0); assert.equal(writes, 1); assert.deepEqual(c.f.calls, []);
});

test('listeners remain installed through final close; late signal cannot rewrite completed execution', async t => {
  const c = context(t); let fileFd, closeSeen = false;
  c.io.openSync = (...args) => { const fd = fs.openSync(...args); if (args[0].endsWith('events.jsonl')) fileFd = fd; return fd; };
  c.io.closeSync = fd => {
    if (fd === fileFd) {
      closeSeen = true; assert.equal(c.signalSource.listenerCount('SIGINT'), 1); assert.equal(c.signalSource.listenerCount('SIGTERM'), 1);
      c.signalSource.emit('SIGINT');
    }
    return fs.closeSync(fd);
  };
  const report = await c.create().run(); recorded(report); assert.equal(closeSeen, true);
  assert.equal(report.ledger.status, 'COMPLETE'); assert.equal(report.ledger.stopRequested, false); assert.equal(report.firstSignal, 'SIGINT');
  assert.deepEqual({ ...report.lastStopRequest }, { phase: 'RUNNER', status: 'REFUSED' });
});

test('close uncertainty and listener removal failures prevent a recorded result', async t => {
  for (const mode of ['close', 'remove-throw', 'remove-silent']) {
    const c = context(t); let fileFd;
    c.io.openSync = (...args) => { const fd = fs.openSync(...args); if (args[0].endsWith('events.jsonl')) fileFd = fd; return fd; };
    if (mode === 'close') c.io.closeSync = fd => { fs.closeSync(fd); if (fd === fileFd) throw Error('uncertain close'); };
    else c.signalSource.removeListener = function (signal, listener) {
      if (mode === 'remove-throw') { EventEmitter.prototype.removeListener.call(this, signal, listener); throw Error('uncertain remove'); }
      return this;
    };
    const owner = c.create(), report = await owner.run(); assert.equal(report.recorded, false);
    assert.equal(report.cleanup[mode === 'close' ? 'storage' : 'signals'], 'UNCONFIRMED');
    if (mode !== 'close') assert.equal(report.storage.finalSeen, true);
    c.signalSource.emit('SIGINT'); await turn(); assert.deepEqual(owner.inspect(), report);
    // Local fake emitter only. Remove the deliberately leaked test listeners.
    for (const signal of ['SIGINT', 'SIGTERM']) for (const fn of c.signalSource.rawListeners(signal)) EventEmitter.prototype.removeListener.call(c.signalSource, signal, fn);
  }
});

test('pending execution after stop stays unconfirmed even when late promises settle', async t => {
  const c = context(t), result = deferredTrialValue(), settled = deferredTrialValue(), started = deferredTrialValue(); let cancels = 0;
  c.f.host.startExecutor = () => { started.resolve(); return { result: result.promise, settled: settled.promise,
    status: () => 'BUSY', cancel() { cancels++; } }; };
  const owner = c.create(), running = owner.run(); await started.promise; owner.requestStop();
  const report = await running; recorded(report); assert.equal(report.ledger.drain.status, 'UNCONFIRMED');
  assert.equal(report.ledger.counts.completed, 0); assert.equal(cancels, 1);
  const before = fs.readFileSync(report.storage.file); result.reject(Error('late')); settled.resolve(); await turn();
  assert.strictEqual(owner.inspect(), report); assert.deepEqual(fs.readFileSync(report.storage.file), before);
});

test('throwing execution callback is retained as an adverse run not setup failure', async t => {
  const c = context(t); c.f.host.startExecutor = () => { throw Error('private host'); };
  const report = await c.create().run(); recorded(report);
  assert.equal(report.ledger.stopReason, 'RUNNER_CALLBACK_OR_CONTRACT_ERROR'); assert.equal(report.ledger.drain.status, 'UNCONFIRMED');
  assert.equal(report.ledger.counts.completed, 0); assert(!JSON.stringify(report).includes('private host'));
});
