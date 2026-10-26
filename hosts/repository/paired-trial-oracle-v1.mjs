// PRIVATE one-shot fixed-reviewed-candidate oracle. Reuses the existing Node
// adapter/materialization/executor; the paired runner still owns cancel/drain.
// No model calls, arbitrary candidate execution, file removal or admission grant.
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { types } from 'node:util';
import { record, list } from '../../evaluation/intake-v1.mjs';
import { cloneFreeze, stableStringify, sha256Text } from '../../workflow/contracts.mjs';
import { decodeRepositoryTrialCandidateV1 } from '../../evaluation/repository-trial-candidate-v1.mjs';
import { readIssuedRepositoryOracleV1 } from '../../examples/repository-task/reviewed-oracle-fixture-v1.mjs';
import { createReviewedNodeTestAdapterV1 } from './node-adapter-v1.mjs';
import { nodeTestAdapterResultV1 } from './node-executor-v1.mjs';
const fail = code => { throw Object.assign(Error(code), { code }); };
const issuedOwners = new WeakMap();
export function readIssuedRepositoryTrialOracleV1(owner) {
  const issued = issuedOwners.get(owner);
  if (!issued) fail('ORACLE_OWNER_NOT_ISSUED');
  return Object.freeze({ registration: issued.registration, binding: issued.binding, state: issued.state() });
}
const error = code => Object.assign(Error(code), { code });
const hash = x => { if (typeof x !== 'string' || x.length !== 64 || !/^[a-f0-9]{64}$/.test(x)) fail('ORACLE_BINDING'); };
const method = (owner, key) => {
  const d = owner && Object.getOwnPropertyDescriptor(owner, key);
  if (!d || !Object.hasOwn(d, 'value') || typeof d.value !== 'function') fail('ORACLE_CAPABILITY');
  return d.value.bind(owner);
};
const observe = promise => Promise.prototype.then.call(promise,
  value => ({ status: 'FULFILLED', value }), () => ({ status: 'REJECTED' }));
function nativeCall(fn) {
  try { const p = fn(); if (!types.isPromise(p)) fail('ORACLE_NATIVE_PROMISE'); return p; }
  catch { return Promise.reject(error('ORACLE_CALLBACK_FAILED')); }
}
export function createRepositoryTrialOracleV1(input) { return createRepositoryTrialOracleWithDependenciesV1(input); }

// Trusted lifecycle test seam; cannot manufacture original-issued Node evidence.
export function createRepositoryTrialOracleWithDependenciesV1(input, dependencies = { createAdapter: createReviewedNodeTestAdapterV1 }) {
  const x = record(input, ['registration', 'binding', 'parentRoot', 'materializationTimeoutMs', 'totalTimeoutMs', 'childTimeoutMs', 'closeGraceMs']);
  const owned = readIssuedRepositoryOracleV1(x.registration), registration = owned.registration;
  const binding = record(x.binding, ['requestId', 'profileSha256', 'taskSha256', 'baselineSha256', 'suiteFingerprint', 'reviewedSourceFingerprint', 'oracleSha256']);
  for (const v of Object.values(binding)) hash(v);
  for (const key of Object.keys(registration.workflow)) if (binding[key] !== registration.workflow[key]) fail('ORACLE_BINDING');
  if (binding.oracleSha256 !== registration.oracleSha256) fail('ORACLE_BINDING');
  const admitted = cloneFreeze(binding), { createAdapter } = record(dependencies, ['createAdapter']);
  if (typeof createAdapter !== 'function') fail('ORACLE_CAPABILITY');
  const options = Object.freeze(Object.fromEntries(['parentRoot', 'materializationTimeoutMs', 'totalTimeoutMs', 'childTimeoutMs', 'closeGraceMs'].map(key => [key, x[key]])));
  if (typeof options.parentRoot !== 'string' || !isAbsolute(options.parentRoot) || options.parentRoot.includes('\0') || options.parentRoot.length > 4096) fail('ORACLE_OPTIONS');
  for (const key of ['materializationTimeoutMs', 'totalTimeoutMs', 'childTimeoutMs', 'closeGraceMs'])
    if (!Number.isSafeInteger(options[key]) || options[key] < 1 || options[key] > (key === 'closeGraceMs' ? 2000 : 60000)) fail('ORACLE_OPTIONS');
  if (options.childTimeoutMs > options.totalTimeoutMs) fail('ORACLE_OPTIONS');
  let consumed = false, observation = null;
  function start(input) {
    if (consumed) fail('ORACLE_OWNER_CONSUMED');
    const request = cloneFreeze(record(input, ['requestId', 'oracleSha256', 'candidateSha256', 'candidateText']));
    if (request.requestId !== admitted.requestId || request.oracleSha256 !== admitted.oracleSha256) fail('ORACLE_REQUEST_BINDING');
    const decoded = decodeRepositoryTrialCandidateV1(request.candidateText, request.candidateSha256);
    const mapping = registration.mappings.find(row => row.candidateSha256 === decoded.candidateSha256 && row.candidateFingerprint === decoded.candidateFingerprint);
    if (!mapping) fail('ORACLE_CANDIDATE_NOT_REVIEWED');
    const preparation = owned.preparations.find(p => p.fingerprint === mapping.oraclePreparationFingerprint);
    if (!preparation || preparation.materializedFingerprint !== mapping.oracleMaterializedFingerprint ||
        stableStringify(preparation.candidate.files) !== stableStringify(decoded.files)) fail('ORACLE_MAPPING');
    consumed = true; // Before any trusted factory I/O or asynchronous work.
    const adapter = Reflect.apply(createAdapter, undefined, [{ suite: owned.suite, ...options }]);
    const run = method(adapter, 'run'), joined = method(adapter, 'settled'), ownerStatus = method(adapter, 'status');
    const controller = new AbortController(), runId = randomUUID();
    let cancelled = false, finalizedResult = false, cleanupDone = false, cleanupError = null, provisional = null;
    function cancel(...args) {
      if (args.length) fail('ORACLE_ARGUMENTS');
      if (finalizedResult) { if (cleanupError) throw cleanupError; return; }
      if (!cancelled) { cancelled = true; try { controller.abort(); } catch { cleanupError ??= error('ORACLE_ABORT_UNCONFIRMED'); } }
      if (cleanupError) throw cleanupError;
    }
    function status(...args) {
      if (args.length) fail('ORACLE_ARGUMENTS');
      let state; try { state = ownerStatus(); } catch { cleanupError ??= error('ORACLE_STATUS_UNAVAILABLE'); }
      if (!['IDLE', 'OFF', 'BUSY', 'QUARANTINED'].includes(state) || state === 'QUARANTINED') cleanupError ??= error('ORACLE_QUARANTINED');
      if (cleanupError) return 'QUARANTINED';
      if (!cleanupDone || !['IDLE', 'OFF'].includes(state)) return 'BUSY';
      return cancelled ? 'OFF' : 'IDLE';
    }
    const completion = Promise.resolve().then(async () => {
      const runOutcome = cancelled ? { status: 'NOT_STARTED' } : await observe(nativeCall(() => run({
        task: preparation.task, candidate: preparation.candidate,
        binding: { schemaVersion: 1, runId, attempt: 0, taskFingerprint: preparation.taskFingerprint,
          candidateFingerprint: preparation.candidateFingerprint }, signal: controller.signal })));
      // Join the original adapter once, including materialization's underlying
      // promise after an outward timeout. No timer can manufacture this join.
      const collection = await observe(nativeCall(joined));
      if (collection.status !== 'FULFILLED') cleanupError ??= error('ORACLE_SETTLEMENT_UNCONFIRMED');
      let state; try { state = ownerStatus(); } catch { cleanupError ??= error('ORACLE_STATUS_UNAVAILABLE'); }
      if (!['IDLE', 'OFF'].includes(state)) cleanupError ??= error('ORACLE_OWNER_NOT_TERMINAL');
      let resultError = runOutcome.status === 'REJECTED' ? error('ORACLE_RUN_FAILED') : null, value;
      if (!cancelled && !cleanupError && !resultError) {
        try {
          const entries = list(collection.value, 1, 1), entry = record(entries[0], ['preparation', 'workspace', 'execution', 'adapterResult', 'error']);
          if (entry.error !== null || entry.preparation !== preparation || entry.adapterResult !== runOutcome.value) fail('ORACLE_RESULT_CHANNEL');
          const checked = nodeTestAdapterResultV1(entry.execution), eb = entry.execution.expected.binding;
          if (stableStringify(checked) !== stableStringify(runOutcome.value) || eb.runId !== runId || eb.attempt !== 0 ||
              eb.preparationFingerprint !== preparation.fingerprint || eb.taskFingerprint !== preparation.taskFingerprint ||
              eb.candidateFingerprint !== decoded.candidateFingerprint || entry.execution.suiteFingerprint !== owned.suite.fingerprint ||
              entry.workspace.status() !== 'POSTCHECKED') fail('ORACLE_EXECUTION_BINDING');
          const outcome = ['PASS', 'FAIL'].includes(checked.status) ? checked.status : 'ERROR';
          value = cloneFreeze({ requestId: request.requestId, oracleSha256: registration.oracleSha256,
            oracleCandidateSha256: request.candidateSha256, outcome });
          provisional = cloneFreeze({ schemaVersion: 'nisi-repository-trial-oracle-observation-v1', binding: admitted, mapping,
            oracleRunId: runId, oracleSuiteFingerprint: owned.suite.fingerprint,
            executionRegistrationFingerprint: entry.execution.registrationFingerprint,
            expectationFingerprint: entry.execution.expected.fingerprint,
            receiptSha256: sha256Text(stableStringify(entry.execution.receipt)), outcome,
            assertionsExecuted: checked.evidence.assertionsExecuted, assertionsPassed: checked.evidence.assertionsPassed,
            candidatePopulation: registration.candidatePopulation, scope: registration.scope,
            independenceAttested: false, measurementVerified: false, authorizing: false, promotionEligible: false });
        } catch { resultError = error('ORACLE_RESULT_UNAVAILABLE'); }
      }
      cleanupDone = true;
      return { value, resultError };
    }).catch(() => { cleanupDone = true; cleanupError ??= error('ORACLE_FINALIZATION_FAILED'); return { resultError: cleanupError }; });
    const settled = completion.then(() => { if (cleanupError) throw cleanupError; });
    const result = completion.then(({ value, resultError }) => {
      finalizedResult = true;
      const captured = provisional; provisional = null;
      if (cancelled) fail('ORACLE_CANCELLED');
      if (resultError) throw resultError;
      if (cleanupError) throw cleanupError;
      observation = captured; return value;
    });
    observe(result); observe(settled);
    return Object.freeze({ result, settled, status, cancel });
  }
  const owner = Object.freeze({ start, inspect: () => cloneFreeze({ state: observation ? 'PUBLISHED' : consumed ? 'UNAVAILABLE_OR_PENDING' : 'NEW',
    observation, persisted: false, authorizing: false }) });
  issuedOwners.set(owner, Object.freeze({ registration, binding: admitted,
    state: () => observation ? 'PUBLISHED' : consumed ? 'UNAVAILABLE_OR_PENDING' : 'NEW' }));
  return owner;
}
