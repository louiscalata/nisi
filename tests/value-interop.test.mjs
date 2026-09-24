// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInteropMatrix, interopSourceManifest, scoreInteropCase, main } from '../benchmarks/value/interop.mjs';
import { makeFixture } from '../benchmarks/value/fixtures.mjs';

test('same released workflow accepts four synthetic input seams and fresh repair evidence', async () => {
  const rows = await runInteropMatrix();
  assert.equal(rows.length, 10);
  for (const row of rows) assert.equal(row.conforms, true, JSON.stringify(row));
  for (const row of rows) {
    assert.equal(row.report.outcome, row.observedOutcome);
    assert.equal(row.traceValid, true);
    assert.ok(row.trace.length >= 4);
  }
  const successes = rows.filter(row => row.expectedOutcome === 'COMPLETED');
  assert.equal(successes.length, 8);
  assert.equal(new Set(successes.filter(row => row.scenario === 'valid-first').map(row => row.candidateFingerprint)).size, 1);
  assert.equal(new Set(successes.filter(row => row.scenario === 'repair-test').map(row => row.candidateFingerprint)).size, 1);
  for (const row of successes) {
    assert.equal(row.oracleCorrect, true);
    assert.equal(row.freshCompletionEvidence, true);
    assert.equal(row.transport, 'mock');
    assert.equal(row.modelCalls, 0);
    assert.equal(row.modelOrProviderCompatibility, 'UNVERIFIED');
  }
  assert.equal(successes.filter(row => row.scenario === 'repair-test').every(row => row.repairAttempts === 1), true);
  assert.equal(rows.filter(row => row.expectedOutcome === 'BLOCKED').every(row => row.compatibilityStatus === 'REJECTED_AS_EXPECTED'), true);
  const chat = successes.filter(row => row.interface === 'local-chat-fake-fetch');
  assert.deepEqual(chat.map(row => row.wireRequests.map(request => request.operation)),
    [['draft', 'review'], ['draft', 'repair', 'review']]);
  for (const row of successes) assert.equal(row.independentScore.scenarioConforms, true);
  for (const row of rows.filter(item => item.expectedOutcome === 'BLOCKED')) {
    assert.deepEqual(row.trace.map(event => `${event.name}:${event.phase}`),
      ['authorize:started', 'authorize:settled', 'draft:started', 'draft:settled']);
    assert.equal(row.report.candidate, null);
    assert.equal(row.repairAttempts, 0);
  }
  assert.ok(rows.some(row => row.caseId === 'negative-truncated-json-stream'));
});

test('extra fake wire request and report/trace disagreement fail compatibility scoring', async () => {
  const rows = await runInteropMatrix();
  const chat = rows.find(row => row.caseId === 'local-chat-fake-fetch/valid-first');
  const fixture = makeFixture('valid-first');
  fixture.events.push(...chat.trace);
  const extraWire = scoreInteropCase(chat.caseId, chat.interface, chat.scenario, chat.report,
    [...chat.wireRequests, { operation: 'review' }], fixture);
  assert.equal(extraWire.conforms, false);
  const callback = rows.find(row => row.caseId === 'callback-json/valid-first');
  const mismatched = scoreInteropCase(callback.caseId, callback.interface, callback.scenario,
    callback.report, callback.wireRequests, makeFixture('valid-first'));
  assert.equal(mismatched.conforms, false);
});

test('interop manifest hashes sources and CLI output requires a new directory', async () => {
  const sources = await interopSourceManifest();
  assert.match(sources['benchmarks/value/interop.mjs'], /^[0-9a-f]{64}$/u);
  assert.match(sources['adapters/local-chat.mjs'], /^[0-9a-f]{64}$/u);
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'nisi-interop-'));
  try {
    const output = path.join(parent, 'result');
    const originalLog = console.log;
    console.log = () => {};
    try { await main(output); }
    finally { console.log = originalLog; }
    const data = JSON.parse(await fs.readFile(path.join(output, 'interop.json'), 'utf8'));
    const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
    assert.equal(data.rows.length, 10);
    assert.equal(manifest.modelCalls, 0);
    assert.equal(typeof (await fs.readFile(path.join(output, 'REPORT.md'), 'utf8')), 'string');
    await assert.rejects(() => main(output), error => error.code === 'EEXIST');
  } finally { await fs.rm(parent, { recursive: true, force: true }); }
});
