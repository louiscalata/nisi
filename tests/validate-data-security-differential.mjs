// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// Run with: node tests/validate-data-security-differential.mjs
// The workflow engine is the oracle; all adapters return synthetic data in memory.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCandidate, runWorkflow } from '../workflow/engine.mjs';
import { validateData } from '../history/validate-data.mjs';
import { validateReport } from './validate-data-security-cases.mjs';

const adapterCases = ['authorizeContext', 'staticChecks', 'tests', 'review'].flatMap(stage =>
  ['PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE', 'throw', 'malformed', 'cancel', 'deadline'].map(action =>
    ({ name: `${stage}-${action}`, stage, action })));
const scenarios = [
  ...adapterCases,
  ...['throw', 'malformed', 'cancel', 'deadline'].map(action => ({ name: `draft-${action}`, stage: 'draft', action, mode: 'edit' })),
  ...['REPAIRED', 'repeat', 'cycle', 'NO_CHANGE', 'FAIL', 'NOT_RUN', 'UNAVAILABLE', 'throw', 'malformed', 'cancel', 'deadline']
    .map(action => ({ name: `repair-${action}`, stage: 'repair', action, mode: 'edit' })),
  { name: 'completion-deadline', stage: 'completion', action: 'deadline' },
  ...['missing-adapter', 'invalid-task', 'invalid-store-budget', 'missing-store'].map(action => ({ name: `setup-${action}`, stage: 'setup', action })),
];
const storageModes = ['none', 'PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE', 'throw', 'malformed', 'cancel', 'deadline'];
const failedFinding = { code: 'SYNTHETIC_FAILURE', message: 'Synthetic contract case' };

function standIns(spec, seed) {
  const mode = spec.mode ?? (seed % 2 === 0 ? 'edit' : 'review');
  const required = seed % 2 === 0;
  const reviewers = seed % 3 + 1;
  const storeMode = storageModes[seed % storageModes.length];
  const initialText = `export const answer = ${seed};\n// ${spec.name}\n`;
  const files = text => [{ path: 'src/value.js', content: text }];
  const makeCandidate = text => createCandidate({ files: files(text) }, { authorId: 'author.synthetic' });
  const task = {
    taskId: `task.synthetic.${spec.name.toLowerCase()}.${seed}`, mode, language: 'javascript',
    allowedFiles: ['src/value.js'], protectedFiles: [], protectedSnapshots: {},
    acceptanceCriteria: [`Return synthetic value ${seed}`, `Preserve ${spec.name}`],
    policy: { repairBudget: spec.stage === 'repair' ? 3 : seed % 3, totalDeadlineMs: 10_000,
      requiredReviewers: reviewers, requireReportStore: required && storeMode !== 'none' },
  };
  const controller = new AbortController();
  let now = 0, completionSamples = 0;
  const clock = () => {
    if (completionSamples > 0 && --completionSamples === 0) now = task.policy.totalDeadlineMs;
    return now;
  };
  const actionAt = (stage, binding) => {
    if (spec.stage === 'repair' && stage === 'staticChecks') {
      // Cycle/repeat and non-repaired responses need a failure before repair.
      if (spec.action === 'REPAIRED' && binding.attempt > 0) return 'PASS';
      return 'FAIL';
    }
    if (spec.stage !== stage) return 'PASS';
    // Some failed runs recover; others exhaust their allowed attempts.
    if (spec.action === 'FAIL' && binding.attempt > 0 && seed % 4 === 1) return 'PASS';
    return spec.action;
  };
  const interrupt = action => {
    if (action === 'throw') throw Error('Synthetic adapter exception');
    if (action === 'cancel') controller.abort();
    if (action === 'deadline') now = task.policy.totalDeadlineMs;
    return action === 'malformed';
  };
  const adapterResult = (stage, { binding, reviewerId }) => {
    const action = actionAt(stage, binding);
    if (interrupt(action)) return { status: 'PASS' };
    const status = ['PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE'].includes(action) ? action : 'PASS';
    const reason = status === 'PASS' ? '' : 'Synthetic non-passing result';
    const findings = status === 'FAIL' ? [failedFinding] : [];
    const evidence = stage === 'authorizeContext' ? { ...binding, reason }
      : stage === 'tests' ? { ...binding, assertionsExecuted: ['PASS', 'FAIL'].includes(status) ? seed % 7 + 1 : 0,
        assertionsPassed: status === 'PASS' ? seed % 7 + 1 : 0, failures: findings, reason }
        : stage === 'review' ? { ...binding, reviewerId, findings, summary: 'Synthetic review result', reason }
          : { ...binding, findings, reason };
    if (stage === 'review' && spec.stage === 'completion' && reviewerId === `reviewer.synthetic.${reviewers - 1}`) {
      // Two post-result clock samples pass; the next completion guard expires.
      completionSamples = 3;
    }
    return { status, evidence };
  };
  const adapters = {
    authorizeContext: { authorize: args => adapterResult('authorizeContext', args) },
    author: {
      id: 'author.synthetic',
      draft({ binding }) {
        if (spec.stage === 'draft' && interrupt(spec.action)) return { candidate: null };
        return { candidate: { files: files(initialText) }, evidence: {
          ...binding, candidateFingerprint: makeCandidate(initialText).fingerprint, note: 'Synthetic draft',
        } };
      },
      repair({ binding, candidate }) {
        const action = spec.stage === 'repair' ? spec.action : 'REPAIRED';
        if (interrupt(action)) return { status: 'REPAIRED' };
        const status = ['repeat', 'cycle'].includes(action) || !['REPAIRED', 'NO_CHANGE', 'FAIL', 'NOT_RUN', 'UNAVAILABLE'].includes(action)
          ? 'REPAIRED' : action;
        const text = action === 'repeat' ? candidate.files[0].content
          : action === 'cycle' && binding.attempt > 1 ? initialText
            : `${initialText}// repair ${binding.attempt}\n`;
        const next = status === 'REPAIRED' ? makeCandidate(text) : null;
        return { status, candidate: next ? { files: next.files } : null, evidence: {
          ...binding, candidateFingerprint: next?.fingerprint ?? candidate.fingerprint,
          baseCandidateFingerprint: candidate.fingerprint, note: 'Synthetic repair result',
        } };
      },
    },
    staticChecks: { check: args => adapterResult('staticChecks', args) },
    tests: { run: args => adapterResult('tests', args) },
    reviewers: Array.from({ length: reviewers }, (_, index) => ({ id: `reviewer.synthetic.${index}`,
      review: args => adapterResult('review', args) })),
  };
  const options = { adapters, signal: controller.signal, clock };
  if (mode === 'review') Object.assign(options, { candidate: { files: files(initialText) }, candidateAuthorId: 'author.synthetic' });
  if (storeMode !== 'none') options.reportStore = { store({ binding, report, reportSha256 }) {
    if (interrupt(storeMode)) return { status: 'PASS' };
    const status = ['PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE'].includes(storeMode) ? storeMode : 'PASS';
    return { status, evidence: { ...binding, outcome: report.outcome, reportSha256 } };
  } };
  if (spec.stage === 'setup') {
    if (spec.action === 'missing-adapter') delete adapters.tests;
    if (spec.action === 'invalid-task') task.allowedFiles = [];
    if (spec.action === 'invalid-store-budget') options.storeTimeoutMs = 0;
    if (spec.action === 'missing-store') { task.policy.requireReportStore = true; delete options.reportStore; }
  }
  return { task, options };
}

export async function runDifferential() {
  let accepted = 0, rejected = 0;
  const outcomes = {}, workflowOutcomes = {}, stageStatuses = new Set(), taskInputs = new Set();
  for (let seed = 0; seed < 48; seed += 1) {
    for (const spec of scenarios) {
      const { task, options } = standIns(spec, seed);
      const label = `${spec.name}/${seed}`;
      taskInputs.add(JSON.stringify(task));
      const report = await runWorkflow(task, options);
      const valid = validateReport(validateData, report);
      assert.equal(valid.status, 'PASS', `${label}: engine report rejected: ${JSON.stringify(valid)}`);
      accepted += 1;
      outcomes[report.outcome] = (outcomes[report.outcome] ?? 0) + 1;
      workflowOutcomes[report.workflowOutcome] = (workflowOutcomes[report.workflowOutcome] ?? 0) + 1;
      for (const stage of report.stages) stageStatuses.add(`${stage.stage}/${stage.status}`);
      for (const alteration of ['unknown-stage', 'unknown-status', 'contradictory-completion']) {
        const changed = JSON.parse(JSON.stringify(report));
        if (alteration === 'unknown-stage') changed.stages.push({ stage: `unknown-${seed}`, status: 'PASS' });
        if (alteration === 'unknown-status') changed.stages.push({ stage: 'review', status: `unknown-${seed}` });
        if (alteration === 'contradictory-completion') {
          changed.outcome = 'COMPLETED'; changed.workflowOutcome = 'COMPLETED';
          changed.stages.push({ stage: 'tests', status: 'NOT_RUN' });
        }
        const invalid = validateReport(validateData, changed);
        assert.equal(invalid.status, 'FAIL', `${label}/${alteration}: contradictory report accepted`);
        assert.equal(invalid.files[0]?.reason, 'REPORT_SHAPE', `${label}/${alteration}: invalid record skipped`);
        rejected += 1;
      }
    }
  }
  assert.equal(taskInputs.size, accepted, 'generated task inputs must be distinct');
  for (const outcome of ['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED', 'TIMED_OUT', 'REPAIR_LIMIT', 'NO_PROGRESS']) {
    assert.ok(outcomes[outcome] > 0, `missing final outcome ${outcome}`);
    assert.ok(workflowOutcomes[outcome] > 0, `missing workflow outcome ${outcome}`);
  }
  return { status: 'PASS', generatedInputs: taskInputs.size, acceptedEngineReports: accepted,
    rejectedAlteredReports: rejected, comparisons: accepted + rejected,
    outcomes, workflowOutcomes, stageStatuses: [...stageStatuses].sort() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runDifferential(), null, 2));
}
