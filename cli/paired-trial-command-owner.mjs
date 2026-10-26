// PRIVATE command/session lifecycle, not a CLI command or execution admission.
// Caller supplies exclusive, already-admitted execution owners and a fixed local
// oracle. The runner alone owns cancellation and sequential event retention.
// Signal source and synchronous filesystem methods are trusted implementation
// seams. No process exit, signal forwarding, retries or writable recovery.
import fs from 'node:fs';
import { isAbsolute } from 'node:path';
import { record } from '../evaluation/intake-v1.mjs';
import { cloneFreeze } from '../workflow/contracts.mjs';
import { createPairedTrialRunnerV1 } from '../evaluation/paired-trial-runner-v1.mjs';
import { createPairedTrialEventStoreV1 } from '../history/paired-trial-event-store-v1.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };
const ioKeys = ['openSync', 'closeSync', 'writeSync', 'readSync', 'fstatSync', 'fsyncSync'];
export function createPairedTrialCommandOwnerV1(input, dependencies = { signalSource: process, io: fs }) {
  const top = record(input, ['plan', 'profile', 'host', 'parentDirectory']);
  const host = record(top.host, ['verifyInputs', 'startExecutor', 'startOracle']);
  if (Object.values(host).some(fn => typeof fn !== 'function')) fail('TRIAL_COMMAND_HOST');
  const parentDirectory = top.parentDirectory;
  if (typeof parentDirectory !== 'string' || !parentDirectory || parentDirectory.length > 4096 ||
      parentDirectory.includes('\0') || !isAbsolute(parentDirectory)) fail('TRIAL_COMMAND_DIRECTORY');
  const { signalSource, io } = record(dependencies, ['signalSource', 'io']);
  const signalMethods = Object.fromEntries(['on', 'removeListener', 'rawListeners'].map(key => {
    const fn = signalSource?.[key];
    if (typeof fn !== 'function') fail('TRIAL_COMMAND_SIGNALS');
    return [key, fn.bind(signalSource)];
  }));
  const capturedIo = Object.fromEntries(ioKeys.map(key => {
    const fn = io && Object.getOwnPropertyDescriptor(io, key)?.value;
    if (typeof fn !== 'function') fail('TRIAL_COMMAND_IO');
    return [key, fn.bind(io)];
  }));
  let state = 'READY', finalReport = null, store = null, ledger = null, runnerStarted = false;
  let setup = 'NOT_RUN', reason = null, firstSignal = null, setupStop = false, signalFailure = false;
  let lastStopRequest = null, storeAttempted = false, creationDirectory = null;
  let pendingRetentions = 0, signalCleanup = 'NOT_INSTALLED', storeCleanup = 'NOT_OPENED';
  const runner = createPairedTrialRunnerV1({ plan: top.plan, profile: top.profile, host: { ...host,
    retain(event) {
      // The real store performs synchronous I/O and returns a native Promise.
      // Observe that exact acknowledgement; never close under pending retention.
      pendingRetentions++;
      let promise;
      try { promise = store.retain(event); }
      catch (error) { pendingRetentions--; throw error; }
      Promise.prototype.then.call(promise, () => { pendingRetentions--; }, () => { pendingRetentions--; });
      return promise;
    },
  } });
  function requestStop(...args) {
    if (args.length) fail('TRIAL_COMMAND_ARGUMENTS');
    if (state !== 'RUNNING') return Object.freeze({ status: 'REFUSED', reason: 'TRIAL_COMMAND_NOT_STOPPABLE', authorizing: false });
    if (runnerStarted) {
      const response = runner.requestStop(); lastStopRequest = { phase: 'RUNNER', status: response.status }; return response;
    }
    const status = setupStop ? 'ALREADY_REQUESTED' : 'REQUESTED'; setupStop = true;
    lastStopRequest = { phase: 'SETUP', status };
    return Object.freeze({ status, authorizing: false });
  }
  const listeners = ['SIGINT', 'SIGTERM'].map(signal => [signal, () => {
    if (state !== 'RUNNING') return;
    firstSignal ??= signal;
    try { requestStop(); } catch { signalFailure = true; }
  }]);
  function inspect() {
    if (finalReport) return finalReport;
    return cloneFreeze({ schemaVersion: 'nisi-trial-command-owner-v1', state, setup, reason,
      firstSignal, setupStop, lastStopRequest, signalFailure, ledger, storage: store?.inspect() ?? null, creationDirectory,
      cleanup: { signals: signalCleanup, storage: storeCleanup }, pendingRetentions,
      recorded: false, authorizing: false, resumable: false, measurementVerified: false,
      causalClaim: false, promotionEligible: false, remoteExecutionStopped: 'UNKNOWN' });
  }
  async function run(...args) {
    if (args.length) fail('TRIAL_COMMAND_ARGUMENTS');
    if (state !== 'READY') fail('TRIAL_COMMAND_ALREADY_RAN');
    state = 'RUNNING'; let installing = false;
    try {
      installing = true;
      for (const [signal, listener] of listeners) {
        signalMethods.on(signal, listener);
        if (!signalMethods.rawListeners(signal).includes(listener)) fail('TRIAL_COMMAND_SIGNAL_INSTALL');
      }
      installing = false;
      storeAttempted = true;
      store = createPairedTrialEventStoreV1({ parentDirectory }, { io: capturedIo });
      setup = 'COMPLETE'; runnerStarted = true;
      const running = runner.run();
      // run() starts synchronously and awaits SCHEDULE retention before dispatch.
      // Replay setup signals here, never discard a pre-run REFUSED response.
      if (setupStop) requestStop();
      ledger = await running;
    } catch (error) {
      setup = ledger === null && !runnerStarted ? 'REFUSED' : setup;
      reason = installing ? 'TRIAL_COMMAND_SIGNAL_INSTALL' : !store ? 'TRIAL_COMMAND_STORE_CREATE' : 'TRIAL_COMMAND_RUN_UNCONFIRMED';
      // Preserve a partial evidence location only from the store's known error;
      // never copy arbitrary callback messages into the observation.
      if (!store && error && typeof error === 'object' &&
          Object.getOwnPropertyDescriptor(error, 'code')?.value === 'TRIAL_STORE_CREATE_UNCONFIRMED') {
        const directory = Object.getOwnPropertyDescriptor(error, 'directory')?.value;
        if (typeof directory === 'string' && directory.length <= 4096 && !directory.includes('\0') && isAbsolute(directory)) creationDirectory = directory;
      }
    } finally {
      // Original runner has returned; no racing timeout or handler can get here.
      // Keep handlers installed through close. Do not synthesize another FINAL.
      if (!store && storeAttempted) storeCleanup = 'CREATE_UNCONFIRMED';
      if (store) {
        if (pendingRetentions) storeCleanup = 'DEFERRED_PENDING_RETENTION';
        else {
          try { storeCleanup = store.close().state === 'CLOSED' ? 'CLOSED' : 'UNCONFIRMED'; }
          catch { storeCleanup = 'UNCONFIRMED'; }
        }
      }
      signalCleanup = 'REMOVED';
      // Both exact identities, including install-then-throw. Never all listeners.
      for (const [signal, listener] of listeners) {
        try {
          signalMethods.removeListener(signal, listener);
          if (signalMethods.rawListeners(signal).includes(listener)) signalCleanup = 'UNCONFIRMED';
        } catch { signalCleanup = 'UNCONFIRMED'; }
      }
      state = 'FINISHED';
    }
    const observation = inspect();
    const recorded = !reason && !signalFailure && setup === 'COMPLETE' && signalCleanup === 'REMOVED' &&
      storeCleanup === 'CLOSED' && observation.storage.finalSeen && ledger?.retentionStatus === 'CONFIRMED';
    finalReport = cloneFreeze({ ...observation, recorded });
    return finalReport; // Immutable observation, not task success or authority.
  }
  return Object.freeze({ run, requestStop, inspect });
}
