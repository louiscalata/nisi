// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// Run with: node tests/validate-data-security-mutations.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertReportCases } from './validate-data-security-cases.mjs';

const location = new URL('../history/validate-data.mjs', import.meta.url);
const source = fs.readFileSync(location, 'utf8');
const mutations = [];
function replace(name, from, to) {
  assert.ok(source.includes(from), `missing mutation anchor: ${name}`);
  mutations.push({ name, source: source.replace(from, to) });
}
const table = {
  intake: "['PASS']", authorizeContext: 'ADAPTER_STATUSES',
  draft: "['PASS', 'UNAVAILABLE']", staticChecks: 'ADAPTER_STATUSES',
  tests: 'ADAPTER_STATUSES', review: 'ADAPTER_STATUSES',
  repair: 'REPAIR_STATUSES', completion: "['UNAVAILABLE']",
};
const statuses = {
  intake: ['PASS'], authorizeContext: ['PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE'],
  draft: ['PASS', 'UNAVAILABLE'], staticChecks: ['PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE'],
  tests: ['PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE'], review: ['PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE'],
  repair: ['REPAIRED', 'NO_CHANGE', 'FAIL', 'NOT_RUN', 'UNAVAILABLE'], completion: ['UNAVAILABLE'],
};
for (const [stage, expression] of Object.entries(table)) {
  const entry = `${stage}: ${expression}`;
  replace(`allow-unknown-${stage}`, entry, `${stage}: [...${expression}, 'invented']`);
  for (const status of statuses[stage]) {
    replace(`reject-supported-${stage}-${status}`, entry,
      `${stage}: ${expression}.filter(status => status !== '${status}')`);
  }
}
for (const [name, from, to] of [
  ['omit-consistency', 'if (!reportOutcomeConsistent(value))', 'if (false)'],
  ['ignore-workflow-outcome', 'value.workflowOutcome === undefined ? value.outcome : value.workflowOutcome', 'value.outcome'],
  ['allow-any-storage-outcome', "!['BLOCKED', 'CANCELLED', 'TIMED_OUT'].includes(value.outcome)", 'false'],
  ['ignore-storage-code-type', "typeof value.reportStoreCode !== 'string'", 'false'],
  ['ignore-empty-storage-code', 'value.reportStoreCode.length === 0', 'false'],
  ['ignore-successful-storage', 'value.reportStored === true', 'false'],
  ['continue-after-stopped', "if (stopped && !(repairable && stage === 'repair')) return false;", ''],
  ['allow-any-repair-after-stop', "repairable && stage === 'repair'", "stage === 'repair'"],
  ['all-passes-complete', "stage === 'review' ? ['COMPLETED'] : []", "['COMPLETED']"],
  ['no-pass-completes', "stage === 'review' ? ['COMPLETED'] : []", '[]'],
  ['reject-repeated-candidate', "endings = ['NO_PROGRESS'];", 'endings = [];'],
  ['no-setup-refusal', "let endings = ['BLOCKED'];", 'let endings = [];'],
  ['ignore-repair-attempts', 'if (repairable && value.repairAttempts > 0)', 'if (repairable)'],
  ['no-repair-limit', "endings.push('REPAIR_LIMIT')", "endings.push('FAILED')"],
  ['authorization-failure-is-failed', "status === 'NOT_RUN' || stage === 'authorizeContext'", "status === 'NOT_RUN'"],
  ['not-run-is-failed', "status === 'NOT_RUN' || stage === 'authorizeContext'", "stage === 'authorizeContext'"],
  ['no-no-change', "status === 'NO_CHANGE' ? ['NO_PROGRESS']", "status === 'NO_CHANGE' ? ['COMPLETED']"],
  ['unknown-outcome-skipped', 'if (!RUN_OUTCOMES.includes(value.outcome) || !Array.isArray(value.stages)) return { malformed: true };', 'if (!RUN_OUTCOMES.includes(value.outcome) || !Array.isArray(value.stages)) return null;'],
  ['ignore-status-map', 'STAGE_STATUSES[stage.stage].includes(stage.status)', 'true'],
  ['negative-attempts', 'value.repairAttempts < 0', 'false'],
  ['unsafe-attempts', '!Number.isSafeInteger(value.repairAttempts)', "typeof value.repairAttempts !== 'number'"],
  ['invalid-code-type', "typeof value.code !== 'string'", 'false'],
  ['unbounded-code', 'value.code.length > 128', 'false'],
]) replace(name, from, to);
for (const outcome of ['BLOCKED', 'CANCELLED', 'TIMED_OUT']) {
  replace(`unavailable-loses-${outcome}`, "? ['BLOCKED', 'CANCELLED', 'TIMED_OUT']", `? ${JSON.stringify(['BLOCKED', 'CANCELLED', 'TIMED_OUT'].filter(value => value !== outcome))}`);
}
for (const stage of ['staticChecks', 'tests', 'review']) {
  replace(`no-repair-after-${stage}`, "['staticChecks', 'tests', 'review'].includes(stage)", `${JSON.stringify(['staticChecks', 'tests', 'review'].filter(value => value !== stage))}.includes(stage)`);
}

async function load(text, key) {
  const resolved = text.replace(/from '(\.[^']+)'/g,
    (_match, specifier) => `from '${new URL(specifier, location).href}'`);
  return import(`data:text/javascript;base64,${Buffer.from(resolved).toString('base64')}#${key}`);
}
const baseline = await load(source, 'baseline');
const cases = assertReportCases(baseline.validateData);
const results = [];
for (const mutation of mutations) {
  // Import errors are harness defects, not killed mutations.
  const module = await load(mutation.source, mutation.name);
  let killed = false, witness = null;
  try { assertReportCases(module.validateData); }
  catch (error) { killed = true; witness = error.message.split('\n')[0]; }
  results.push({ name: mutation.name, killed, witness });
}
const survivors = results.filter(result => !result.killed).map(result => result.name);
console.log(JSON.stringify({ baselineCases: cases, mutants: results.length,
  killed: results.filter(result => result.killed).length, survived: survivors.length, survivors, results }, null, 2));
assert.equal(survivors.length, 0, `surviving mutations: ${survivors.join(', ')}`);
assert.ok(results.length >= 40);
