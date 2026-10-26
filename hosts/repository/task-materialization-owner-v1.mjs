// PRIVATE one-shot outward boundary for cooperative workspace materialization.
// It owns late settlement; it does not preempt I/O, clean roots or grant authority.
import { cloneFreeze } from '../../workflow/contracts.mjs';
import { exact } from '../../integrity/record-utils.mjs';
import { materializeRepositoryCandidateV1, quarantineTaskWorkspaceCheckpointV1, issuedTaskWorkspaceV1 } from './task-workspace-v1.mjs';
import { isIssuedRepositoryPreparation } from './snapshot-contract.mjs';

const int = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const refuse = code => { throw Object.assign(new Error(code), { code }); };
const text = value => typeof value === 'string' && value.isWellFormed() && !value.includes('\0') && value.length <= 4096 ? value : null;
const codeText = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(value) ? value : null;
const BOUNDARY = Object.freeze({ abort: 'WORKSPACE_ABORTED', deadline: 'WORKSPACE_MATERIALIZATION_DEADLINE', clock: 'WORKSPACE_MATERIALIZATION_CLOCK_INVALID' });
const QUARANTINE = Object.freeze({ abort: 'ABORTED', deadline: 'DEADLINE_EXCEEDED', clock: 'NODE_HOST_CLOCK_INVALID' });

export class TaskMaterializationError extends Error {
  constructor(code, binding, underlyingSettlement, fields = {}) {
    super(code); this.name = 'TaskMaterializationError'; this.code = code;
    this.binding = binding; this.root = fields.root ?? null; this.priorCode = fields.priorCode ?? null; this.systemCode = fields.systemCode ?? null;
    this.underlyingSettlement = underlyingSettlement; Object.freeze(this);
  }
}

function bindingOf(value, preparation) {
  exact(value, ['runId', 'attempt', 'taskFingerprint', 'candidateFingerprint', 'preparationFingerprint'], 'MATERIALIZATION_BINDING');
  if (!isIssuedRepositoryPreparation(preparation) || typeof value.runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value.runId) ||
      !Number.isSafeInteger(value.attempt) || value.attempt < 0 || value.taskFingerprint !== preparation?.taskFingerprint ||
      value.attempt > preparation.task.policy.repairBudget || value.candidateFingerprint !== preparation?.candidateFingerprint || value.preparationFingerprint !== preparation?.fingerprint)
    refuse('MATERIALIZATION_BINDING');
  return cloneFreeze(value);
}
function errorFields(error) {
  // Error objects are diagnostic data. Never invoke their getters while settling
  // the owned operation: a throwing getter must not orphan the outward promise.
  const field = key => {
    try { const descriptor = Object.getOwnPropertyDescriptor(error, key);
      return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
    } catch { return null; }
  };
  return cloneFreeze({ code: codeText(field('code')) ?? 'WORKSPACE_MATERIALIZATION_ERROR', root: text(field('root')),
    priorCode: codeText(field('priorCode')), systemCode: codeText(field('systemCode')) });
}

// Trusted dependencies are a lifecycle-test seam, not evidence of disk work.
export function createTaskMaterializationOwnerV1(dependencies = {}) {
  const dependencyKeys = ['materialize', 'now', 'setTimer', 'clearTimer'];
  const present = dependencyKeys.filter(key => !!dependencies && typeof dependencies === 'object' && Object.hasOwn(dependencies, key));
  exact(dependencies, present, 'MATERIALIZATION_OWNER_CONFIG');
  const materialize = present.includes('materialize') ? dependencies.materialize : materializeRepositoryCandidateV1;
  const now = present.includes('now') ? dependencies.now : () => Math.floor(performance.now());
  const setTimer = present.includes('setTimer') ? dependencies.setTimer : setTimeout;
  const clearTimer = present.includes('clearTimer') ? dependencies.clearTimer : clearTimeout;
  if (typeof materialize !== 'function' || typeof now !== 'function' || typeof setTimer !== 'function' || typeof clearTimer !== 'function')
    refuse('MATERIALIZATION_OWNER_CONFIG');
  let state = 'NEW', binding = null, start = null, previous = null, boundaryKind = null;
  let timer = null, controller = null, terminal = null, observations = [], cancelCurrent = null;
  const record = value => observations.push(cloneFreeze({ schemaVersion: 'nisi-task-materialization-observation/v1',
    binding, authorizing: false, ...value }));
  const sample = () => {
    let value; try { value = now(); } catch { value = NaN; }
    if (!int(value, 0, Number.MAX_SAFE_INTEGER) || (previous !== null && value < previous)) return null;
    previous = value; return value;
  };
  const elapsed = () => previous === null || start === null ? null : previous - start;
  const status = () => state === 'RUNNING' ? 'BUSY' : state === 'FULFILLED' ? 'IDLE' : state === 'NEW' ? 'IDLE' : 'QUARANTINED';

  function run(input) {
    if (state !== 'NEW') refuse('MATERIALIZATION_OWNER_CONSUMED');
    const hasSignal = !!input && typeof input === 'object' && Object.hasOwn(input, 'signal');
    exact(input, ['preparation', 'parentRoot', 'profile', 'binding', 'deadlineMs', ...(hasSignal ? ['signal'] : [])], 'MATERIALIZATION_INPUT');
    if (hasSignal && !(input.signal instanceof AbortSignal)) refuse('MATERIALIZATION_INPUT');
    if (!int(input.deadlineMs, 1, 60000)) refuse('MATERIALIZATION_INPUT');
    binding = bindingOf(input.binding, input.preparation);
    // Preserve issued object identities but capture the caller's scalar options
    // before asynchronous continuations. Later input edits cannot extend a budget.
    input = Object.freeze({ preparation: input.preparation, parentRoot: input.parentRoot,
      profile: input.profile, binding, deadlineMs: input.deadlineMs, ...(hasSignal ? { signal: input.signal } : {}) });
    state = 'RUNNING';
    const first = sample(); start = first;
    let outwardResolve, outwardReject, outwardDone = false, invoked = false;
    const outward = new Promise((resolve, reject) => { outwardResolve = resolve; outwardReject = reject; });
    const cleanup = () => {
      if (timer !== null) { try { clearTimer(timer); } catch {} timer = null; }
      try { input.signal?.removeEventListener('abort', onAbort); } catch {}
    };
    const setupFailure = code => {
      if (state !== 'RUNNING') return;
      state = 'REJECTED'; cleanup();
      record({ event: 'SETTLED', outcome: 'EVIDENCE_UNAVAILABLE', code, elapsedMs: elapsed(),
        underlyingSettlement: 'NOT_STARTED', root: null, priorCode: null, systemCode: null,
        workspaceState: null, rootFingerprint: null, handleClosure: 'NOT_ASSERTED' });
      outwardDone = true; outwardReject(new TaskMaterializationError(code, binding, 'NOT_STARTED'));
    };
    const interrupt = (kind, settlement) => {
      if (state !== 'RUNNING') return false;
      state = 'INTERRUPTED_PENDING'; boundaryKind = kind; cleanup(); controller?.abort();
      record({ event: 'INTERRUPTED', outcome: kind.toUpperCase(), code: BOUNDARY[kind], elapsedMs: elapsed(),
        underlyingSettlement: settlement, root: null, priorCode: null, systemCode: null,
        workspaceState: null, rootFingerprint: null, handleClosure: 'NOT_ASSERTED' });
      if (!outwardDone) { outwardDone = true; outwardReject(new TaskMaterializationError(BOUNDARY[kind], binding, settlement)); }
      return true;
    };
    const onAbort = () => interrupt('abort', invoked ? 'PENDING' : 'NOT_STARTED');
    const signalAborted = () => {
      try { return input.signal?.aborted === true; }
      catch { refuse('WORKSPACE_MATERIALIZATION_SIGNAL_UNAVAILABLE'); }
    };
    const beforeStartSignal = () => {
      try { if (signalAborted()) { onAbort(); return false; } return true; }
      catch { setupFailure('WORKSPACE_MATERIALIZATION_SIGNAL_UNAVAILABLE'); return false; }
    };
    cancelCurrent = onAbort;
    if (first === null || first > Number.MAX_SAFE_INTEGER - input.deadlineMs) { interrupt('clock', 'NOT_STARTED'); terminal = Promise.resolve(); return outward; }
    if (!beforeStartSignal()) { terminal = Promise.resolve(); return outward; }
    controller = new AbortController();
    try { input.signal?.addEventListener('abort', onAbort, { once: true }); }
    catch { setupFailure('WORKSPACE_MATERIALIZATION_SIGNAL_UNAVAILABLE'); terminal = Promise.resolve(); return outward; }
    if (!beforeStartSignal()) { terminal = Promise.resolve(); return outward; }
    const beforeCall = sample(), spent = elapsed();
    if (beforeCall === null) { interrupt('clock', 'NOT_STARTED'); terminal = Promise.resolve(); return outward; }
    if (spent >= input.deadlineMs) { interrupt('deadline', 'NOT_STARTED'); terminal = Promise.resolve(); return outward; }
    try { timer = setTimer(() => interrupt('deadline', invoked ? 'PENDING' : 'NOT_STARTED'), input.deadlineMs - spent); }
    catch { setupFailure('WORKSPACE_MATERIALIZATION_TIMER_UNAVAILABLE'); terminal = Promise.resolve(); return outward; }
    if (state !== 'RUNNING') { cleanup(); terminal = Promise.resolve(); return outward; }
    let raw; invoked = true;
    try { raw = Promise.resolve(materialize({ preparation: input.preparation, parentRoot: input.parentRoot,
      profile: input.profile, signal: controller.signal })); }
    catch (error) { raw = Promise.reject(error); }
    const rejectUnderlying = error => {
      const value = sample(), fields = errorFields(error), closure = [fields.code, fields.priorCode].includes('WORKSPACE_CLOSE_UNCONFIRMED') ? 'UNCONFIRMED' : 'NOT_ASSERTED';
      if (state === 'RUNNING') {
        state = 'REJECTED'; cleanup(); outwardDone = true;
        record({ event: 'SETTLED', outcome: 'REJECTED', elapsedMs: value === null ? null : elapsed(), underlyingSettlement: 'REJECTED',
          ...fields, workspaceState: null, rootFingerprint: null, handleClosure: closure });
        outwardReject(new TaskMaterializationError(fields.code, binding, 'REJECTED', fields)); return;
      }
      state = 'INTERRUPTED_REJECTED_LATE';
      record({ event: 'LATE_SETTLEMENT', outcome: 'REJECTED', elapsedMs: value === null ? null : elapsed(), underlyingSettlement: 'REJECTED',
        ...fields, workspaceState: null, rootFingerprint: null, handleClosure: closure });
    };
    terminal = raw.then(workspace => {
      try {
        const value = sample(), duration = elapsed();
        if (state === 'RUNNING') {
          if (signalAborted()) interrupt('abort', 'FULFILLED');
          else if (value === null) interrupt('clock', 'FULFILLED');
          else if (duration >= input.deadlineMs) interrupt('deadline', 'FULFILLED');
          else {
            const issued = issuedTaskWorkspaceV1(workspace);
            if (issued.preparation !== input.preparation || issued.state !== 'MATERIALIZED') refuse('WORKSPACE_MATERIALIZATION_IDENTITY');
            const root = text(issued.root), rootFingerprint = text(issued.manifest.rootFingerprint), workspaceState = issued.state;
            cleanup();
            if (state === 'RUNNING') {
              record({ event: 'SETTLED', outcome: 'FULFILLED', code: null, elapsedMs: duration,
                underlyingSettlement: 'FULFILLED', root, priorCode: null, systemCode: null,
                workspaceState, rootFingerprint, handleClosure: 'REPORTED_BY_MATERIALIZER' });
              state = 'FULFILLED'; outwardDone = true;
              outwardResolve(workspace); return;
            }
          }
        }
        let workspaceState = 'QUARANTINE_UNCONFIRMED';
        try { quarantineTaskWorkspaceCheckpointV1(workspace, 'PRE', QUARANTINE[boundaryKind]); workspaceState = workspace.status(); } catch {}
        let root = null, rootFingerprint = null;
        try { root = text(workspace.root); rootFingerprint = text(workspace.manifest.rootFingerprint); } catch {}
        state = 'INTERRUPTED_FULFILLED_LATE';
        record({ event: 'LATE_SETTLEMENT', outcome: 'FULFILLED', code: null, elapsedMs: duration,
          underlyingSettlement: 'FULFILLED', root, priorCode: null, systemCode: null,
          workspaceState, rootFingerprint, handleClosure: 'REPORTED_BY_MATERIALIZER' });
      } catch (error) {
        const fields = errorFields(error), value = sample(); cleanup();
        if (state === 'RUNNING') {
          state = 'REJECTED'; outwardDone = true;
          record({ event: 'SETTLED', outcome: 'EVIDENCE_UNAVAILABLE', elapsedMs: value === null ? null : elapsed(),
            underlyingSettlement: 'FULFILLED', ...fields, workspaceState: 'QUARANTINE_UNCONFIRMED',
            rootFingerprint: null, handleClosure: 'NOT_ASSERTED' });
          outwardReject(new TaskMaterializationError('WORKSPACE_MATERIALIZATION_EVIDENCE_UNAVAILABLE', binding, 'FULFILLED'));
        } else {
          state = 'INTERRUPTED_FULFILLED_LATE';
          record({ event: 'LATE_SETTLEMENT', outcome: 'EVIDENCE_UNAVAILABLE', elapsedMs: value === null ? null : elapsed(),
            underlyingSettlement: 'FULFILLED', ...fields, workspaceState: 'QUARANTINE_UNCONFIRMED',
            rootFingerprint: null, handleClosure: 'NOT_ASSERTED' });
        }
      }
    }, rejectUnderlying);
    return outward;
  }
  async function settled() { if (terminal) await terminal; return Object.freeze([...observations]); }
  function cancel() {
    if (state === 'RUNNING') cancelCurrent?.();
    return cloneFreeze({ status: status(), authorizing: false });
  }
  return Object.freeze({ run, cancel, settled, status, observations: () => Object.freeze([...observations]) });
}
