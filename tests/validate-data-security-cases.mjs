// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';

const stage = (stage, status) => ({ stage, status });
const report = (outcome, stages, extra = {}) => ({ schemaVersion: 1, outcome, stages, ...extra });

// Exercise the public reader with synthetic bytes and no working journal data.
export function validateReport(validateData, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  const file = 'report.json';
  let offset = 0;
  const stat = { size: bytes.length, isSymbolicLink: () => false,
    isFile: () => true, isDirectory: () => true };
  return validateData({ dataDir: '.', fs: {
    lstatSync: () => stat, readdirSync: () => [file], openSync: () => 1,
    fstatSync: () => stat, closeSync() {},
    readSync(_fd, target, start, length) {
      const count = bytes.copy(target, start, offset, offset + length);
      offset += count;
      return count;
    },
  } });
}

const statuses = {
  intake: ['PASS'], authorizeContext: ['PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE'],
  draft: ['PASS', 'UNAVAILABLE'], staticChecks: ['PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE'],
  tests: ['PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE'], review: ['PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE'],
  repair: ['REPAIRED', 'NO_CHANGE', 'FAIL', 'NOT_RUN', 'UNAVAILABLE'], completion: ['UNAVAILABLE'],
};

export const invalidReports = [
  ...Object.keys(statuses).map(name => ['unsupported status for ' + name,
    report(name === 'authorizeContext' ? 'BLOCKED' : 'FAILED', [stage(name, 'invented')])]),
  ['unknown stage', report('COMPLETED', [stage('invented', 'PASS')])],
  ['prototype stage', report('COMPLETED', [stage('constructor', 'PASS')])],
  ['prototype member', report('COMPLETED', [stage('__proto__', 'PASS')])],
  ['unknown status', report('COMPLETED', [stage('review', 'invented')])],
  ['cross-stage status', report('COMPLETED', [stage('review', 'REPAIRED')])],
  ['draft failure status', report('FAILED', [stage('draft', 'FAIL')])],
  ['intake unavailable status', report('BLOCKED', [stage('intake', 'UNAVAILABLE')])],
  ['completion passing status', report('COMPLETED', [stage('completion', 'PASS')])],
  ['repair passing status', report('COMPLETED', [stage('repair', 'PASS')])],
  ['completed failing review', report('COMPLETED', [stage('review', 'FAIL')])],
  ['completed skipped tests', report('COMPLETED', [stage('tests', 'NOT_RUN')])],
  ['empty completion', report('COMPLETED', [])],
  ['failed passing review', report('FAILED', [stage('review', 'PASS')])],
  ['completed unfinished checks', report('COMPLETED', [stage('staticChecks', 'PASS')])],
  ['failure hidden by pass', report('COMPLETED', [stage('tests', 'FAIL'), stage('review', 'PASS')])],
  ['refused authorization hidden by repair', report('COMPLETED', [stage('authorizeContext', 'FAIL'), stage('repair', 'REPAIRED'), stage('review', 'PASS')])],
  ['failed repair hidden by another repair', report('COMPLETED', [stage('tests', 'FAIL'), stage('repair', 'FAIL'), stage('repair', 'REPAIRED'), stage('review', 'PASS')])],
  ['unavailable hidden by repair', report('COMPLETED', [stage('tests', 'UNAVAILABLE'), stage('repair', 'REPAIRED'), stage('review', 'PASS')])],
  ['unfinished repair', report('COMPLETED', [stage('tests', 'FAIL'), stage('repair', 'REPAIRED')])],
  ['limit without repair', report('REPAIR_LIMIT', [stage('tests', 'FAIL')])],
  ['failed authorization outcome', report('FAILED', [stage('authorizeContext', 'FAIL')])],
  ['unknown outcome', report('invented', [stage('review', 'PASS')])],
  ['unknown workflow outcome', report('BLOCKED', [], { workflowOutcome: 'invented' })],
  ['storage override missing receipt code', report('BLOCKED', [stage('review', 'PASS')], { workflowOutcome: 'COMPLETED' })],
  ['storage override empty receipt code', report('BLOCKED', [stage('review', 'PASS')], { workflowOutcome: 'COMPLETED', reportStoreCode: '' })],
  ['storage override nonstring receipt code', report('BLOCKED', [stage('review', 'PASS')], { workflowOutcome: 'COMPLETED', reportStoreCode: 1 })],
  ['successful storage override', report('BLOCKED', [stage('review', 'PASS')], { workflowOutcome: 'COMPLETED', reportStoreCode: 'STORE_FAILURE', reportStored: true })],
  ['failure storage override', report('FAILED', [stage('review', 'PASS')], { workflowOutcome: 'COMPLETED', reportStoreCode: 'STORE_FAILURE' })],
  ['repair attempts negative', report('COMPLETED', [stage('review', 'PASS')], { repairAttempts: -1 })],
  ['repair attempts fractional', report('COMPLETED', [stage('review', 'PASS')], { repairAttempts: 0.5 })],
  ['repair attempts string', report('COMPLETED', [stage('review', 'PASS')], { repairAttempts: '1' })],
  ['repair attempts unsafe', report('COMPLETED', [stage('review', 'PASS')], { repairAttempts: Number.MAX_SAFE_INTEGER + 1 })],
  ['invalid code type', report('COMPLETED', [stage('review', 'PASS')], { code: {} })],
  ['oversize code', report('COMPLETED', [stage('review', 'PASS')], { code: 'x'.repeat(129) })],
  ...[null, [], 'review'].map(value => ['nonobject stage', report('COMPLETED', [value])]),
];

export const validReports = [
  ...['staticChecks', 'tests', 'review'].map(name => ['repaired ' + name,
    report('COMPLETED', [stage(name, 'FAIL'), stage('repair', 'REPAIRED'), stage('review', 'PASS')], { repairAttempts: 1 })]),
  ['complete modern stage names', report('COMPLETED', ['intake', 'authorizeContext', 'draft', 'staticChecks', 'tests', 'review'].map(name => stage(name, 'PASS')))],
  ['repair not run', report('BLOCKED', [stage('tests', 'FAIL'), stage('repair', 'NOT_RUN')])],
  ['minimal legacy completion', report('COMPLETED', [stage('review', 'PASS')])],
  ['legacy metadata', report('COMPLETED', [stage('review', 'PASS')], { code: null, repairAttempts: 0, extension: { retained: true } })],
  ['empty setup refusal', report('BLOCKED', [])],
  ['no progress repeated candidate', report('NO_PROGRESS', [stage('tests', 'FAIL'), stage('repair', 'REPAIRED')])],
  ['no progress unchanged', report('NO_PROGRESS', [stage('review', 'FAIL'), stage('repair', 'NO_CHANGE')])],
  ['failed repair', report('FAILED', [stage('tests', 'FAIL'), stage('repair', 'FAIL')])],
  ['repair limit', report('REPAIR_LIMIT', [stage('tests', 'FAIL')], { repairAttempts: 1 })],
  ['repaired completion', report('COMPLETED', [stage('tests', 'FAIL'), stage('repair', 'REPAIRED'), stage('staticChecks', 'PASS'), stage('tests', 'PASS'), stage('review', 'PASS')], { repairAttempts: 1 })],
  ...['FAIL', 'NOT_RUN', 'UNAVAILABLE'].map(status => ['authorization refusal', report('BLOCKED', [stage('authorizeContext', status)])]),
  ...['staticChecks', 'tests', 'review'].flatMap(name => [
    ['failed work', report('FAILED', [stage(name, 'FAIL')])],
    ['skipped work', report('BLOCKED', [stage(name, 'NOT_RUN')])],
  ]),
  ...['BLOCKED', 'CANCELLED', 'TIMED_OUT'].flatMap(outcome => [
    ...['authorizeContext', 'draft', 'staticChecks', 'tests', 'review', 'repair', 'completion'].map(name =>
      ['unavailable work', report(outcome, [stage(name, 'UNAVAILABLE')])]),
    ['storage override', report(outcome, [stage('review', 'PASS')], { workflowOutcome: 'COMPLETED', reportStoreCode: 'STORE_FAILURE', reportStored: false })],
  ]),
  ['optional storage failure', report('COMPLETED', [stage('review', 'PASS')], { workflowOutcome: 'COMPLETED', reportStoreCode: 'STORE_FAILURE', reportStored: false })],
];

export function assertReportCases(validateData) {
  for (const [name, report] of invalidReports) {
    const summary = validateReport(validateData, report);
    assert.equal(summary.status, 'FAIL', name);
    assert.equal(summary.failed, 1, name);
    assert.equal(summary.files[0].reason, 'REPORT_SHAPE', name);
  }
  for (const [name, report] of validReports) {
    assert.equal(validateReport(validateData, report).status, 'PASS', name);
  }
  return { invalid: invalidReports.length, valid: validReports.length };
}
