// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow } from '../workflow/engine.mjs';
import { makeFixture, scenarios, semanticOracle } from '../benchmarks/value/fixtures.mjs';
import { scoreRun } from '../benchmarks/value/score.mjs';
import { runControls } from '../benchmarks/value/run.mjs';
import { runOverhead, verifyMatchedPair } from '../benchmarks/value/overhead.mjs';

test('external oracle checks values independently from workflow success', () => {
  assert.equal(semanticOracle(null), null);
  assert.equal(semanticOracle({ files: [{ path: 'answer.json', content: '{"answer":42}' }] }), true);
  for (const content of ['{"answer":41}', '{"answer":"42"}', 'invalid']) {
    assert.equal(semanticOracle({ files: [{ path: 'answer.json', content }] }), false);
  }
});

test('reject-everything and accept-everything controls cannot pass the scorer', async () => {
  const valid = scenarios.find(row => row.id === 'valid-first');
  const fixture = makeFixture(valid.id);
  const report = await runWorkflow(fixture.task, fixture.options);
  assert.equal(scoreRun(valid, 'nisi', report, fixture).scenarioConforms, true);
  assert.equal(scoreRun(valid, 'nisi', { ...report, outcome: 'BLOCKED' }, fixture).scenarioConforms, false);
  const invalid = scenarios.find(row => row.id === 'stale-run');
  assert.equal(scoreRun(invalid, 'nisi', report, fixture).scenarioConforms, false);
});

test('dishonest PASS is reported as incorrect acceptance, not semantic success', async () => {
  const specimen = scenarios.find(row => row.id === 'dishonest-pass');
  const fixture = makeFixture(specimen.id);
  const report = await runWorkflow(fixture.task, fixture.options);
  const score = scoreRun(specimen, 'nisi', report, fixture);
  assert.equal(score.scenarioConforms, true);
  assert.equal(score.incorrectAcceptance, true);
  assert.equal(score.correctAcceptance, false);
});

test('missing invocations, invented repairs and calls after a stop fail independent trace checks', async () => {
  const valid = scenarios[0];
  const fixture = makeFixture(valid.id);
  const report = await runWorkflow(fixture.task, fixture.options);
  assert.equal(scoreRun(valid, 'nisi', report, { ...fixture, events: [] }).scenarioConforms, false);
  const inventedRepair = { ...report, repairAttempts: 1, stages: report.stages.map(stage => ({ ...stage,
    evidence: { ...stage.evidence, attempt: 1 } })) };
  assert.equal(scoreRun(valid, 'nisi', inventedRepair, fixture).scenarioConforms, false);
  const stale = scenarios.find(row => row.id === 'stale-run');
  const stopped = makeFixture(stale.id);
  const refused = await runWorkflow(stopped.task, stopped.options);
  stopped.events.push(...['started', 'settled'].map(phase => ({ name: 'review', phase, attempt: 0 })));
  assert.equal(scoreRun(stale, 'nisi', refused, stopped).scenarioConforms, false);
});

test('all predeclared control specimens meet separately declared outcome and evidence checks', async () => {
  const rows = await runControls();
  assert.equal(rows.length, scenarios.length * 3);
  for (const row of rows) assert.equal(row.score.scenarioConforms, true,
    `${row.arm}/${row.scenario}: ${JSON.stringify(row.score)}`);
});

test('timing refuses unmatched callback traces; smoke samples retain paired results', async () => {
  const fixture = makeFixture('valid-first');
  const report = await runWorkflow(fixture.task, fixture.options);
  const value = { fixture, report };
  assert.throws(() => verifyMatchedPair(value, { ...value, fixture: { ...fixture, events: [] } }, scenarios[0]));
  const result = await runOverhead({ warmupPairs: 1, measuredPairs: 2,
    scenarios: ['valid-first', 'repair-test'], payloads: [{ fileCount: 1, paddingBytes: 0 }] });
  assert.equal(result.rows.length, 4);
  assert.equal(result.summaries.length, 2);
  for (const row of result.rows) assert.equal(Number.isFinite(row.deltaMs), true);
});
