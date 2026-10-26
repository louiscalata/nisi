// PRIVATE per-run observation, not admission, persistence recovery or a scheduler.
// Original joins survive an outward timeout. A pending Promise alone does not
// keep Node alive: absent terminal evidence after process death remains UNKNOWN.
import { createExecutionCoordinatorV1 } from './execution-coordinator-v1.mjs';
import { liveHostOwnerStatusV1 } from './live-owner-status-v1.mjs';
import { createRepositoryHostEvidenceV1 } from './host-evidence-v1.mjs';
import { cloneFreeze, sha256Text } from '../../workflow/contracts.mjs';

const code = error => {
  try { const v = error?.code; return typeof v === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(v) ? v : 'LIVE_EXECUTION_ERROR'; }
  catch { return 'LIVE_EXECUTION_ERROR'; }
};
const digest = value => sha256Text(JSON.stringify(value, null, 2) + '\n');

export function createLiveDemoExecutionV1({ host, lane, controller, retain, binding, settleTimeoutMs = 2000, onLateError = () => {} }) {
  const identity = cloneFreeze(binding), errors = [];
  let hostJoin, finishPromise, latePromise, lateState = 'NOT_STARTED', cancelled = false, cancelError;
  let laneClosed = false, laneCloseError;
  function closeLaneOnce() {
    if (!laneClosed) {
      laneClosed = true;
      try { lane.revoke(); } catch (e) { laneCloseError = e; }
    }
    if (laneCloseError) throw laneCloseError;
  }
  function cancelOnce() {
    if (!cancelled) {
      cancelled = true;
      // Attempt both even if one fails; cancellation failure remains sticky.
      try { controller.abort(); } catch (e) { cancelError = e; }
      try { closeLaneOnce(); } catch (e) { cancelError ??= e; }
    }
    if (cancelError) throw cancelError;
  }
  const interrupt = () => { try { cancelOnce(); } catch { /* Report through coordinator, never throw from a signal listener. */ } };
  function hostSettled() {
    // Never call this before host.run has been attempted. Rejection stays a
    // rejection for both collection and coordinator; no synthesized host result.
    if (!hostJoin) { hostJoin = Promise.resolve().then(() => host.settled()); hostJoin.catch(() => {}); }
    return hostJoin;
  }
  const rawModels = lane.executionOwners();
  const owners = [Object.freeze({ id: 'repository.host', status: () => liveHostOwnerStatusV1(host.status()),
    settled: hostSettled, cancel: cancelOnce }), ...rawModels.map(owner => {
    let join;
    return Object.freeze({ id: owner.id, status: owner.status, cancel: cancelOnce,
      settled: () => { if (!join) { join = Promise.resolve().then(() => owner.settled()); join.catch(() => {}); } return join; } });
  })];
  const coordinator = createExecutionCoordinatorV1({ owners, settleTimeoutMs });
  function recordError(stage, error) {
    const row = Object.freeze({ stage, code: code(error) }); errors.push(row);
    try { onLateError(row); } catch { /* Diagnostic notification cannot defeat joins. */ }
  }
  const diagnostics = () => cloneFreeze({ state: lateState, errors, authorizing: false });
  async function write(name, value) {
    try { await retain(name, value); return true; }
    catch (e) { recordError(name, e); return false; }
  }
  function capture(stage, read, reportError = true) {
    try { return { availability: 'AVAILABLE', value: cloneFreeze(read()) }; }
    catch (e) { if (reportError) recordError(stage, e); return { availability: 'UNAVAILABLE', code: code(e) }; }
  }
  async function finish() {
    // Called after the outward run/collection returns. On interruption, prevent
    // any later stage dispatch BEFORE acquiring model joins (not cached at idle).
    if (controller.signal.aborted || cancelled) interrupt();
    let terminalReady = false;
    const terminals = Promise.allSettled(owners.map(o => o.settled())).then(rows => { terminalReady = true; return rows; });
    lateState = 'PENDING';
    const intent = cloneFreeze({ schemaVersion: 'nisi-live-execution-intent/v1', binding: identity,
      owners: owners.map(o => o.id), authorizing: false, remoteInferenceStopped: 'NOT_OBSERVED' });
    const intentRetained = await write('execution-intent.json', intent);
    // The CLI binds any successful receipt before finish(). Close the one-shot
    // approval without falsely reporting a user interruption or a remote stop.
    if (!cancelled) {
      try { closeLaneOnce(); } catch (e) { recordError('execution.close', e); }
    }
    let observation = await (cancelled ? coordinator.requestOff() : coordinator.recheck());
    // A signal can arrive during a normal recheck. Serialize the cancellation
    // observation; do not launch overlapping operations and lose one as BUSY.
    if (cancelled && !observation.snapshot.owners.every(o => o.cancelRequested)) observation = await coordinator.requestOff();
    const final = cloneFreeze({ schemaVersion: 'nisi-live-execution-observation/v1', binding: identity,
      intentSha256: intentRetained ? digest(intent) : null, observation, authorizing: false });
    const finalRetained = await write('execution-final.json', final);
    latePromise = terminals.then(async rows => {
      if (!intentRetained || !finalRetained) { lateState = 'UNRETAINED'; return diagnostics(); }
      const outcomes = rows.map((row, i) => ({ id: owners[i].id,
        settlement: row.status === 'fulfilled' ? 'FULFILLED' : 'REJECTED',
        error: row.status === 'fulfilled' ? null : code(row.reason),
        status: capture(`${owners[i].id}.status`, owners[i].status) }));
      const hostResult = rows[0].status === 'fulfilled'
        ? capture('late.host-result', () => rows[0].value, false)
        : { availability: 'UNAVAILABLE', code: code(rows[0].reason) };
      const hostEvidence = rows[0].status === 'fulfilled'
        ? capture('late.host-evidence', () => createRepositoryHostEvidenceV1(rows[0].value), false)
        : { availability: 'UNAVAILABLE', code: code(rows[0].reason) };
      // Full data records and capability-bearing issued hosts have different
      // representations. A verified projection is the expected fallback, not a
      // retention failure. If neither is capturable, preserve both diagnostics.
      if (rows[0].status === 'fulfilled' && hostResult.availability !== 'AVAILABLE' && hostEvidence.availability !== 'AVAILABLE') {
        recordError('late.host-result', hostResult); recordError('late.host-evidence', hostEvidence);
      }
      const terminal = cloneFreeze({ schemaVersion: 'nisi-live-execution-settlement/v2', binding: identity,
        intentSha256: digest(intent), observationSha256: digest(final), outcomes,
        // Keep the original full-object capture unchanged. Real workspace owners
        // contain capabilities, so retain their separately versioned data view.
        hostResult, hostEvidence,
        modelLane: capture('late.model-lane', () => lane.snapshot()),
        hostLate: capture('late.host-observations', () => host.lateObservations()),
        materialization: capture('late.materialization', () => host.materializationObservations()),
        authorizing: false, remoteInferenceStopped: 'NOT_OBSERVED', upgradesEarlierOutcome: false });
      lateState = await write('execution-settlement.json', terminal) ? 'RETAINED' : 'UNRETAINED';
      return diagnostics();
    }).catch(e => { recordError('execution-settlement', e); lateState = 'UNRETAINED'; return diagnostics(); });
    // Immediate completions must include retention failure in the outward result.
    // Genuinely late completion is separate evidence, never an upgraded summary.
    if (terminalReady) await latePromise;
    return cloneFreeze({ observation, intentRetained, finalRetained, late: diagnostics(), authorizing: false });
  }
  return Object.freeze({ hostSettled, interrupt,
    finish: () => finishPromise ??= finish(),
    lateStatus: diagnostics,
    lateSettled: () => finishPromise ? finishPromise.then(() => latePromise) : Promise.reject(Object.assign(Error('LIVE_EXECUTION_NOT_FINISHED'), { code: 'LIVE_EXECUTION_NOT_FINISHED' })) });
}
