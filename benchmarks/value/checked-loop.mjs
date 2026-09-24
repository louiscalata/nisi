// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// Handwritten reference scheduler for the benchmark. This deliberately shares
// Nisi's value-object contracts, but makes its own control-flow decisions.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  cloneFreeze, createTaskSpecification, validateCandidateForTask,
  sha256Text, stableStringify, validateAdapterIdentity, validateFindings,
} from '../../workflow/contracts.mjs';

const statuses = new Set(['PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE']);
const repairStatuses = new Set(['REPAIRED', 'NO_CHANGE', 'FAIL', 'NOT_RUN', 'UNAVAILABLE']);
const nonempty = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 4096;
const errorCode = error => typeof error?.code === 'string' ? error.code : 'ADAPTER_RESULT_INVALID';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const exact = (value, keys, code) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Reflect.ownKeys(value).some(key => typeof key !== 'string') ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(code);
};
const method = (object, key, code) => {
  const fn = object?.[key];
  if (typeof fn !== 'function') fail(code);
  return fn.bind(object);
};

function snapshotAdapters(task, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('ADAPTERS_INVALID');
  const authorize = method(source.authorizeContext, 'authorize', 'AUTHORIZATION_ADAPTER_REQUIRED');
  const check = method(source.staticChecks, 'check', 'STATIC_CHECK_ADAPTER_REQUIRED');
  const runTests = method(source.tests, 'run', 'TEST_ADAPTER_REQUIRED');
  if (!Array.isArray(source.reviewers) || source.reviewers.length !== task.policy.requiredReviewers) fail('REVIEW_ADAPTER_COUNT');
  const reviewers = source.reviewers.map(item => {
    const id = validateAdapterIdentity(item, 'reviewer');
    return Object.freeze({ id, review: method(item, 'review', 'REVIEW_ADAPTER_REQUIRED') });
  });
  if (new Set(reviewers.map(item => item.id)).size !== reviewers.length) fail('DUPLICATE_REVIEWER');
  const authorId = validateAdapterIdentity(source.author, 'author');
  if (reviewers.some(item => item.id === authorId)) fail('AUTHOR_REVIEWER_NOT_INDEPENDENT');
  const author = Object.freeze({
    id: authorId,
    draft: method(source.author, 'draft', 'AUTHOR_ADAPTER_REQUIRED'),
    repair: task.policy.repairBudget ? method(source.author, 'repair', 'REPAIR_ADAPTER_REQUIRED') : null,
  });
  return Object.freeze({ authorize, check, runTests, reviewers: Object.freeze(reviewers), author });
}

function boundEvidence(value, binding, extras, code) {
  exact(value, [...Object.keys(binding), ...extras], `${code}_EVIDENCE_SCHEMA`);
  for (const key of Object.keys(binding)) if (value[key] !== binding[key]) fail(`${code}_EVIDENCE_STALE`);
}

function checkEnvelope(raw, stage, binding, reviewerId) {
  const code = stage.replace(/[A-Z]/gu, letter => `_${letter}`).toUpperCase();
  exact(raw, ['status', 'evidence'], `${code}_RESULT_SCHEMA`);
  if (!statuses.has(raw.status)) fail(`${code}_STATUS_INVALID`);
  const extras = stage === 'authorizeContext' ? ['reason'] : stage === 'tests'
    ? ['assertionsExecuted', 'assertionsPassed', 'failures', 'reason']
    : stage === 'review' ? ['reviewerId', 'findings', 'summary', 'reason'] : ['findings', 'reason'];
  boundEvidence(raw.evidence, binding, extras, code);
  if (raw.status === 'PASS' ? raw.evidence.reason !== '' : !nonempty(raw.evidence.reason)) fail(`${code}_REASON_INVALID`);
  if (stage === 'authorizeContext') return raw;
  const findings = stage === 'tests' ? raw.evidence.failures : raw.evidence.findings;
  validateFindings(findings, code);
  if (raw.status === 'PASS' && findings.length) fail(`${code}_PASS_WITH_FINDINGS`);
  if (raw.status === 'FAIL' && !findings.length) fail(`${code}_FAIL_WITHOUT_FINDINGS`);
  if (['NOT_RUN', 'UNAVAILABLE'].includes(raw.status) && findings.length) fail(`${code}_NOT_RUN_WITH_FINDINGS`);
  if (stage === 'tests') {
    const { assertionsExecuted: executed, assertionsPassed: passed } = raw.evidence;
    if (!Number.isSafeInteger(executed) || !Number.isSafeInteger(passed) || executed < passed || passed < 0) fail('TEST_ASSERTION_COUNT_INVALID');
    if (raw.status === 'PASS' && (executed === 0 || executed !== passed)) fail('NO_TEST_ASSERTIONS_EXECUTED');
    if (raw.status === 'FAIL' && (executed === 0 || executed === passed)) fail('TEST_FAILURE_EVIDENCE_INVALID');
    if (['NOT_RUN', 'UNAVAILABLE'].includes(raw.status) && (executed !== 0 || passed !== 0)) fail('TEST_NOT_RUN_WITH_ASSERTIONS');
  }
  if (stage === 'review') {
    if (raw.evidence.reviewerId !== reviewerId) fail('REVIEWER_ID_MISMATCH');
    if (!nonempty(raw.evidence.summary)) fail('REVIEW_SUMMARY_INVALID');
  }
  return raw;
}

function makeInvoker(clock, signal, duration) {
  let last;
  try { last = clock(); } catch { fail('CLOCK_INVALID'); }
  if (!Number.isSafeInteger(last) || last < 0 || !Number.isSafeInteger(last + duration)) fail('CLOCK_INVALID');
  const deadline = last + duration;
  const guard = () => {
    if (signal?.aborted) return { kind: 'cancelled', code: 'ABORTED' };
    let now;
    try { now = clock(); } catch { return { kind: 'error', code: 'CLOCK_INVALID' }; }
    if (!Number.isSafeInteger(now) || now < last) return { kind: 'error', code: 'CLOCK_INVALID' };
    last = now;
    return now >= deadline ? { kind: 'timed_out', code: 'DEADLINE_EXCEEDED' } : null;
  };
  const invoke = async (fn, payload) => {
    const prior = guard();
    if (prior) return prior;
    return new Promise(resolve => {
      const controller = new AbortController();
      let timer, done = false;
      const finish = result => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { signal?.removeEventListener('abort', onAbort); } catch { /* signal cleanup must not block settlement */ }
        resolve(result);
      };
      const onAbort = () => { controller.abort(); finish({ kind: 'cancelled', code: 'ABORTED' }); };
      timer = setTimeout(() => { controller.abort(); finish({ kind: 'timed_out', code: 'DEADLINE_EXCEEDED' }); }, deadline - last);
      try { signal?.addEventListener('abort', onAbort, { once: true }); }
      catch { finish({ kind: 'error', code: 'SIGNAL_INVALID' }); return; }
      Promise.resolve().then(() => {
        if (done) return;
        const beforeCall = guard();
        if (beforeCall) { controller.abort(); finish(beforeCall); return; }
        return fn(Object.freeze({ ...payload, signal: controller.signal }));
      }).then(value => {
        if (done) return;
        const afterCall = guard();
        if (afterCall) { controller.abort(); finish(afterCall); return; }
        let snapshot;
        try { snapshot = cloneFreeze(value); }
        catch (error) { finish(guard() ?? { kind: 'error', code: errorCode(error) }); return; }
        finish(guard() ?? { kind: 'result', value: snapshot });
      }, () => finish(guard() ?? { kind: 'error', code: 'ADAPTER_EXCEPTION' }));
    });
  };
  return { guard, invoke };
}

function emptyReport(code, task = null) {
  return cloneFreeze({ schemaVersion: 1, runId: null, taskId: task?.taskId ?? null,
    taskFingerprint: task ? sha256Text(`nisi/workflow-task/v1\0${stableStringify(task)}`) : null,
    mode: task?.mode ?? null, outcome: 'BLOCKED', workflowOutcome: 'BLOCKED', code,
    candidate: null, candidateFingerprint: null, repairAttempts: 0, stages: [],
    reportStored: false, reportStoreCode: null, storedReportSha256: null, reportStoreEvidence: null });
}

export async function runCheckedLoop(rawTask, { adapters: rawAdapters, clock = () => Math.floor(performance.now()), signal, reportStore } = {}) {
  let task, adapters, invoker, store = null, storeInvalid = false;
  try {
    task = createTaskSpecification(rawTask);
    if (task.mode !== 'edit') fail('EDIT_MODE_REQUIRED');
    adapters = snapshotAdapters(task, rawAdapters);
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail('SIGNAL_INVALID');
    if (typeof clock !== 'function') fail('CLOCK_INVALID');
    invoker = makeInvoker(clock, signal, task.policy.totalDeadlineMs);
    if (reportStore !== undefined) {
      if (typeof reportStore?.store === 'function') store = method(reportStore, 'store', 'REPORT_STORE_REQUIRED');
      else storeInvalid = true;
    }
    if (task.policy.requireReportStore && !store) fail('REPORT_STORE_REQUIRED');
  } catch (error) { return emptyReport(errorCode(error), task); }

  const runId = randomUUID();
  const taskFingerprint = sha256Text(`nisi/workflow-task/v1\0${stableStringify(task)}`);
  let candidate = null, repairAttempts = 0, outcome = null, code = null;
  const stages = [], seen = new Set();
  const binding = fingerprint => Object.freeze({ schemaVersion: 1, runId, taskFingerprint,
    attempt: repairAttempts, candidateFingerprint: fingerprint === undefined ? candidate?.fingerprint ?? null : fingerprint });
  const record = (stage, status, evidence, failureCode = null) => stages.push(cloneFreeze({
    stage, status, candidateFingerprint: evidence.candidateFingerprint ?? null, code: failureCode, evidence }));
  const stop = (stage, result, bound) => {
    outcome = result.kind === 'cancelled' ? 'CANCELLED' : result.kind === 'timed_out' ? 'TIMED_OUT' : 'BLOCKED';
    code = result.code;
    record(stage, 'UNAVAILABLE', { ...bound, reason: code }, code);
  };
  const payload = bound => ({ task, candidate, acceptanceCriteria: task.acceptanceCriteria, binding: bound });
  const evaluate = async (stage, fn, extras = {}) => {
    const bound = binding();
    const call = await invoker.invoke(fn, { ...payload(bound), ...extras });
    if (call.kind !== 'result') { stop(stage, call, bound); return null; }
    try {
      const result = checkEnvelope(call.value, stage, bound, extras.reviewerId);
      record(stage, result.status, result.evidence);
      if (result.status !== 'PASS') {
        outcome = stage !== 'authorizeContext' && result.status === 'FAIL' ? 'FAILED' : 'BLOCKED';
        code = `${stage.toUpperCase()}_${result.status}`;
      }
      return result;
    } catch (error) { stop(stage, { kind: 'error', code: errorCode(error) }, bound); return null; }
  };

  record('intake', 'PASS', { ...binding(), taskId: task.taskId, mode: task.mode,
    acceptanceCriteriaCount: task.acceptanceCriteria.length });
  await evaluate('authorizeContext', adapters.authorize);
  if (!outcome) {
    const bound = binding(null);
    const call = await invoker.invoke(adapters.author.draft, payload(bound));
    if (call.kind !== 'result') stop('draft', call, bound);
    else try {
      exact(call.value, ['candidate', 'evidence'], 'DRAFT_RESULT_SCHEMA');
      const drafted = validateCandidateForTask(call.value.candidate, task, adapters.author.id);
      boundEvidence(call.value.evidence, { ...bound, candidateFingerprint: drafted.fingerprint }, ['note'], 'DRAFT');
      if (!nonempty(call.value.evidence.note)) fail('DRAFT_NOTE_INVALID');
      candidate = drafted;
      seen.add(drafted.fingerprint);
      record('draft', 'PASS', call.value.evidence);
    } catch (error) { stop('draft', { kind: 'error', code: errorCode(error) }, bound); }
  }

  while (!outcome) {
    const checks = await evaluate('staticChecks', adapters.check);
    const tests = !outcome ? await evaluate('tests', adapters.runTests, { checks }) : null;
    if (!outcome) for (const reviewer of adapters.reviewers) {
      await evaluate('review', reviewer.review, { reviewerId: reviewer.id, checks, tests });
      if (outcome) break;
    }
    if (!outcome) {
      const stopped = invoker.guard();
      if (stopped) stop('completion', stopped, binding());
      else outcome = 'COMPLETED';
      break;
    }
    if (outcome !== 'FAILED') break;
    if (repairAttempts >= task.policy.repairBudget) {
      if (task.policy.repairBudget > 0) outcome = 'REPAIR_LIMIT';
      break;
    }
    const base = candidate.fingerprint;
    const failedAttempt = cloneFreeze(stages.filter(item => item.evidence.attempt === repairAttempts));
    repairAttempts += 1;
    const bound = binding(base);
    const call = await invoker.invoke(adapters.author.repair, { ...payload(bound), stages: failedAttempt });
    if (call.kind !== 'result') { stop('repair', call, bound); break; }
    try {
      const repair = call.value;
      exact(repair, ['status', 'candidate', 'evidence'], 'REPAIR_RESULT_SCHEMA');
      if (!repairStatuses.has(repair.status)) fail('REPAIR_STATUS_INVALID');
      const next = repair.status === 'REPAIRED'
        ? validateCandidateForTask(repair.candidate, task, adapters.author.id) : null;
      if (!next && repair.candidate !== null) fail('REPAIR_UNUSED_CANDIDATE');
      boundEvidence(repair.evidence, { ...bound, candidateFingerprint: next?.fingerprint ?? base },
        ['baseCandidateFingerprint', 'note'], 'REPAIR');
      if (repair.evidence.baseCandidateFingerprint !== base) fail('REPAIR_BASE_STALE');
      if (!nonempty(repair.evidence.note)) fail('REPAIR_NOTE_INVALID');
      record('repair', repair.status, repair.evidence);
      if (repair.status === 'NO_CHANGE' || (next && seen.has(next.fingerprint))) {
        outcome = 'NO_PROGRESS'; code = 'NO_PROGRESS'; break;
      }
      if (!next) {
        outcome = repair.status === 'FAIL' ? 'FAILED' : 'BLOCKED'; code = `REPAIR_${repair.status}`; break;
      }
      candidate = next;
      seen.add(next.fingerprint);
      outcome = null;
      code = null;
    } catch (error) { stop('repair', { kind: 'error', code: errorCode(error) }, bound); break; }
  }

  const report = { schemaVersion: 1, runId, taskId: task.taskId, taskFingerprint, mode: task.mode,
    outcome, workflowOutcome: outcome, code, candidate, candidateFingerprint: candidate?.fingerprint ?? null,
    repairAttempts, stages, reportStored: false, reportStoreCode: storeInvalid ? 'REPORT_STORE_UNAVAILABLE' : null,
    storedReportSha256: null, reportStoreEvidence: null };
  if (store) {
    const preliminary = cloneFreeze(report);
    const reportSha256 = sha256Text(`nisi/run-report/v1\0${stableStringify(preliminary)}`);
    const bound = binding();
    const call = await invoker.invoke(store, { report: preliminary, reportSha256, binding: bound });
    let storeCode = null;
    if (call.kind !== 'result') storeCode = call.code;
    else try {
      exact(call.value, ['status', 'evidence'], 'REPORT_STORE_RESULT_SCHEMA');
      if (!statuses.has(call.value.status)) fail('REPORT_STORE_STATUS_INVALID');
      boundEvidence(call.value.evidence, bound, ['outcome', 'reportSha256'], 'REPORT_STORE');
      if (call.value.evidence.outcome !== preliminary.outcome || call.value.evidence.reportSha256 !== reportSha256) fail('REPORT_STORE_EVIDENCE_STALE');
      report.reportStoreEvidence = call.value;
      if (call.value.status === 'PASS') { report.reportStored = true; report.storedReportSha256 = reportSha256; }
      else storeCode = `REPORT_STORE_${call.value.status}`;
    } catch (error) { storeCode = errorCode(error); }
    if (storeCode) {
      report.reportStoreCode = storeCode;
      if (call.kind === 'cancelled' || call.kind === 'timed_out') {
        report.outcome = call.kind === 'cancelled' ? 'CANCELLED' : 'TIMED_OUT'; report.code = storeCode;
      } else if (task.policy.requireReportStore) { report.outcome = 'BLOCKED'; report.code = storeCode; }
    }
  }
  return cloneFreeze(report);
}
