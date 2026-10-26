// PRIVATE adapter for already-admitted, one-shot repository/model owners.
// The paired runner remains the sole cancellation coordinator. This adapter
// grants no admission, code execution permission, oracle or policy treatment.
// Trusted callbacks must be bounded; hostile proxies/intrinsics are out of scope.
// Ownership is exclusive: the reviewed host dispatches all author/reviewer work
// before its run promise settles; no other caller may reuse this lane afterward.
import { types } from 'node:util';
import { record, list } from '../../evaluation/intake-v1.mjs';
import { cloneFreeze } from '../../workflow/contracts.mjs';
import { liveHostOwnerStatusV1 } from './live-owner-status-v1.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };
const error = code => Object.assign(Error(code), { code });
// JavaScript may reject/throw null, false or undefined. None means success.
const failure = reason => reason || error('TRIAL_OPERATION_CALLBACK_FAILED');
function value(source, key) {
  const d = source && Object.getOwnPropertyDescriptor(source, key);
  if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail('TRIAL_OPERATION_CAPABILITY');
  return d.value;
}
function method(source, key) {
  const fn = value(source, key);
  if (typeof fn !== 'function') fail('TRIAL_OPERATION_CAPABILITY');
  return fn.bind(source);
}
function nativeCall(fn) {
  try {
    const promise = fn();
    if (!types.isPromise(promise)) fail('TRIAL_OPERATION_NATIVE_PROMISE');
    return promise;
  } catch (reason) { return Promise.reject(reason); }
}
// Always-fulfilled observation, attached immediately to original native channels.
const observe = promise => Promise.prototype.then.call(promise,
  value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));
const terminal = state => state === 'IDLE' || state === 'OFF';

export function startRepositoryTrialOperationV1(input) {
  const { host, lane, projectResult } = record(input, ['host', 'lane', 'projectResult']);
  if (typeof projectResult !== 'function') fail('TRIAL_OPERATION_PROJECTOR');
  const run = method(host, 'run'), hostSettled = method(host, 'settled'), hostStatus = method(host, 'status');
  const revoke = method(lane, 'revoke'), executionOwners = method(lane, 'executionOwners');
  const context = value(lane, 'authorizeContext'), author = value(lane, 'author');
  const authorizeContext = Object.freeze({ authorize: method(context, 'authorize') });
  const capturedAuthor = Object.freeze({ id: value(author, 'id'), draft: method(author, 'draft'), repair: method(author, 'repair') });
  const reviewers = Object.freeze(list(value(lane, 'reviewers'), 1, 1).map(reviewer => Object.freeze({
    id: value(reviewer, 'id'), review: method(reviewer, 'review'),
  })));
  const models = list(executionOwners(), 2, 2).map(owner => Object.freeze({
    id: value(owner, 'id'), settled: method(owner, 'settled'), status: method(owner, 'status'),
  }));
  if (models.map(owner => owner.id).sort().join(',') !== 'model.author,model.reviewer') fail('TRIAL_OPERATION_OWNERS');
  const controller = new AbortController();
  let cancelled = false, revoked = false, cleanupDone = false, resultFinalized = false, cleanupError = null;
  function closeLaneOnce() {
    if (!revoked) {
      revoked = true;
      try {
        const returned = revoke();
        // Actual issued revoke is synchronous. A mistaken promise is observed,
        // but cannot silently become proof that dispatch was disabled in time.
        if (types.isPromise(returned)) { observe(returned); fail('TRIAL_OPERATION_ASYNC_REVOKE'); }
        if (returned !== undefined) fail('TRIAL_OPERATION_REVOKE_RESULT');
      } catch (reason) { cleanupError ??= failure(reason); }
    }
  }
  function cancel(...args) {
    if (args.length) fail('TRIAL_OPERATION_ARGUMENTS');
    // Preserve published history. cleanupDone alone is too early: cancellation
    // in the projection-to-publication microtask gap must still discard output.
    if (resultFinalized) { if (cleanupError) throw cleanupError; return; }
    if (!cancelled) {
      cancelled = true;
      try { controller.abort(); } catch (reason) { cleanupError ??= failure(reason); }
      closeLaneOnce();
    }
    if (cleanupError) throw cleanupError;
  }
  function statuses() {
    try {
      const states = [liveHostOwnerStatusV1(hostStatus()), ...models.map(owner => {
        const state = owner.status();
        if (!['IDLE', 'OFF', 'BUSY', 'QUARANTINED'].includes(state)) fail('TRIAL_OPERATION_OWNER_STATUS');
        return state;
      })];
      if (states.includes('QUARANTINED')) cleanupError ??= error('TRIAL_OPERATION_QUARANTINED');
      return states;
    } catch (reason) { cleanupError ??= failure(reason); return []; }
  }
  function status(...args) {
    if (args.length) fail('TRIAL_OPERATION_ARGUMENTS');
    const states = statuses();
    if (cleanupError) return 'QUARANTINED';
    if (!cleanupDone || !states.every(terminal)) return 'BUSY';
    return cancelled ? 'OFF' : 'IDLE';
  }

  // Synchronous start attempt; a thrown/invalid return never erases its effects.
  const outward = observe(nativeCall(() => run({ authorizeContext, author: capturedAuthor, reviewers, signal: controller.signal })));
  const completion = outward.then(async runOutcome => {
    if (runOutcome.status === 'rejected') {
      try { cancel(); } catch { /* Sticky cleanup error retained below. */ }
    }
    // Only now is future workflow dispatch terminal. Never cache idle model
    // joins before repair/review could start, even if the host currently is idle.
    const joined = await Promise.all([observe(nativeCall(hostSettled)),
      ...models.map(owner => observe(nativeCall(owner.settled)))]);
    for (const item of joined) if (item.status === 'rejected') cleanupError ??= failure(item.reason);
    if (!statuses().every(terminal)) cleanupError ??= error('TRIAL_OPERATION_NOT_TERMINAL');
    let projected, resultError = runOutcome.status === 'rejected' ? failure(runOutcome.reason) : null;
    if (!resultError && !cancelled && !cleanupError) {
      try {
        // Existing receipt validation needs original issued host/lane identities
        // and the unrevoked successful lane. Project synchronously before close.
        const candidate = Reflect.apply(projectResult, undefined, [runOutcome.value, joined[0].value]);
        if (types.isPromise(candidate)) { observe(candidate); fail('TRIAL_OPERATION_ASYNC_PROJECTOR'); }
        projected = cloneFreeze(candidate);
      } catch (reason) { resultError = failure(reason); }
    }
    closeLaneOnce();
    if (!statuses().every(terminal)) cleanupError ??= error('TRIAL_OPERATION_NOT_TERMINAL');
    cleanupDone = true;
    return { projected, resultError };
  });
  // Unexpected finalization errors are retained as cleanup failure, never an
  // unhandled background rejection or an invented terminal status.
  const finalized = completion.catch(reason => { cleanupError ??= failure(reason); closeLaneOnce(); cleanupDone = true; return { resultError: failure(reason) }; });
  const settled = finalized.then(() => { if (cleanupError) throw cleanupError; });
  const result = finalized.then(({ projected, resultError }) => {
    resultFinalized = true;
    if (resultError) throw resultError;
    if (cancelled) fail('TRIAL_OPERATION_CANCELLED');
    if (cleanupError) throw cleanupError;
    return projected;
  });
  // Both original outward-facing promises remain available to the runner.
  observe(result); observe(settled);
  return Object.freeze({ result, settled, status, cancel });
}
