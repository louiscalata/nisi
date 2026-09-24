// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import { semanticOracle, expectedTrace } from './fixtures.mjs';

export function scoreRun(specimen, arm, report, fixture) {
  const accepted = report.outcome === 'COMPLETED';
  const oracleCorrect = semanticOracle(report.candidate);
  const expectedOutcome = arm === 'checked-one-shot' ? specimen.oneShot ?? specimen.expected : specimen.expected;
  const counts = Object.fromEntries(['authorize', 'draft', 'repair', 'static', 'test', 'review', 'store'].map(name =>
    [name, Object.fromEntries(['started', 'settled'].map(phase => [phase,
      fixture.events.filter(event => event.name === name && event.phase === phase).length]))]));
  const callbacksSettled = Object.values(counts).every(count => count.started === count.settled);
  const trace = expectedTrace(specimen.id, arm);
  const invocationTraceMatches = JSON.stringify(fixture.events.map(({ name, phase, attempt }) => ({ name, phase, attempt }))) === JSON.stringify(trace);
  const expectedRepairs = trace.filter(event => event.name === 'repair' && event.phase === 'started').length;
  const budgetCompliant = counts.draft.started <= 1 && counts.repair.started <= fixture.task.policy.repairBudget &&
    report.repairAttempts === counts.repair.started && report.repairAttempts === expectedRepairs;
  const reportBound = typeof report.runId === 'string' && /^[a-f0-9]{64}$/u.test(report.taskFingerprint ?? '') &&
    report.stages.length > 0 && report.stages.every(stage => stage.evidence.runId === report.runId &&
      stage.evidence.taskFingerprint === report.taskFingerprint);
  const terminalAttempt = report.repairAttempts;
  const fresh = stage => report.stages.some(item => item.stage === stage && item.status === 'PASS' &&
    item.evidence.attempt === terminalAttempt && item.evidence.candidateFingerprint === report.candidateFingerprint);
  const completedEvidence = !accepted || ['staticChecks', 'tests', 'review'].every(fresh);
  const storeSatisfied = !accepted || !fixture.task.policy.requireReportStore || report.reportStored === true;
  const expectedStop = ['cancel-before-call', 'authorization-denied', 'deadline-after-call'].includes(specimen.id)
    ? counts.draft.started === 0 : true;
  const expectedStages = specimen.id === 'cancel-before-call'
    ? fixture.events.length === 0 : true;
  const assertions = {
    expectedOutcome: report.outcome === expectedOutcome, invocationTraceMatches, budgetCompliant, callbacksSettled,
    reportBound, completedEvidence, storeSatisfied, noWorkAfterEarlyStop: expectedStop && expectedStages,
    // This limit case must remain visible even when the control-path check passes.
    expectedSemanticResult: specimen.id === 'dishonest-pass' ? accepted && oracleCorrect === false
      : !accepted || oracleCorrect === true,
  };
  return { accepted, oracleCorrect, correctAcceptance: accepted && oracleCorrect === true,
    incorrectAcceptance: accepted && oracleCorrect === false,
    validFirstPassRefused: specimen.id === 'valid-first' && !accepted,
    expectedOutcome, observedOutcome: report.outcome, code: report.code,
    repairAttempts: report.repairAttempts, counts, assertions,
    scenarioConforms: Object.values(assertions).every(Boolean) };
}
