// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadFrozenDataset, FROZEN_DATASET_SHA256, assertRouterClear,
  orderedArms, runPilot, main } from '../benchmarks/value/live-pilot.mjs';

function fakeFetch(answerFor) {
  const wires = [];
  const fetch = async (url, request) => {
    assert.equal(url, 'http://127.0.0.1:9999/v1/chat/completions');
    assert.equal(request.method, 'POST');
    const wire = JSON.parse(request.body);
    wires.push(wire);
    assert.equal(wire.model, 'synthetic.model');
    assert.equal(wire.temperature, 0);
    assert.equal(wire.stream, false);
    assert.equal(wire.max_tokens, 128);
    assert.equal(wire.response_format.json_schema.strict, true);
    const operation = JSON.parse(wire.messages[1].content).operation;
    const answer = answerFor(wires.length, operation);
    const fileContent = answer && typeof answer === 'object' && Object.hasOwn(answer, 'rawContent')
      ? answer.rawContent : JSON.stringify({ answer });
    const content = operation === 'repair'
      ? { status: 'REPAIRED', candidate: { files: [{ path: 'answer.json', content: fileContent }] }, note: 'repair' }
      : { candidate: { files: [{ path: 'answer.json', content: fileContent }] }, note: 'draft' };
    const bytes = new TextEncoder().encode(JSON.stringify({ model: 'synthetic.model',
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } }));
    return { ok: true, body: { getReader() {
      let done = false;
      return { async read() { if (done) return { done: true }; done = true; return { done: false, value: bytes }; },
        async cancel() {}, releaseLock() {} };
    } } };
  };
  return { fetch, wires };
}

test('fixture is frozen, arm order rotates, and active router fails closed', async () => {
  const dataset = await loadFrozenDataset();
  assert.equal(dataset.tasks.length, 12);
  assert.match(FROZEN_DATASET_SHA256, /^[a-f0-9]{64}$/u);
  assert.deepEqual([orderedArms(0), orderedArms(1), orderedArms(2)],
    [['A', 'B', 'C'], ['B', 'C', 'A'], ['C', 'A', 'B']]);
  assert.doesNotThrow(() => assertRouterClear({ schemaVersion: 1, active: null }));
  assert.throws(() => assertRouterClear({ schemaVersion: 1, active: { stage: 'incomplete' } }), /SHARED_ROUTER_NOT_CLEAR/u);
  assert.throws(() => assertRouterClear({ schemaVersion: 1 }), /SHARED_ROUTER_NOT_CLEAR/u);
  assert.throws(() => assertRouterClear({ schemaVersion: 1, active: null, recoveryRequired: true }), /SHARED_ROUTER_NOT_CLEAR/u);
  await assert.rejects(() => main([]), /USAGE/u);
});

test('three arms share the released author wire settings; an external oracle catches wrong accepted answers', async () => {
  const dataset = await loadFrozenDataset();
  const fixture = fakeFetch(() => 'wrong');
  const result = await runPilot({ endpoint: 'http://127.0.0.1:9999/v1/chat/completions',
    model: 'synthetic.model', fetch: fixture.fetch, dataset, routerStatus: { schemaVersion: 1, active: null },
    maxOutputTokens: 128, selectedTaskIds: ['class-01'] });
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows.map(row => row.arm), orderedArms(4));
  assert.deepEqual(result.rows.map(row => row.outcome), ['COMPLETED', 'COMPLETED', 'DRAFTED']);
  assert.ok(result.rows.every(row => row.armCompleted && !row.oracleCorrect && row.receipts.length === 1));
  assert.ok(result.rows.every(row => row.runId && row.candidate?.files[0]?.content === '{"answer":"wrong"}'));
  assert.ok(result.rows.every(row => row.receipts[0].status === 'RESPONSE_VALIDATED' &&
    row.receipts[0].usage.totalTokens === 18 && row.receipts[0].requestedModel === 'synthetic.model'));
  assert.ok(fixture.wires.every(wire => wire.messages[1].content === fixture.wires[0].messages[1].content));
  assert.ok(result.rows.filter(row => row.arm !== 'A').every(row => row.reportStages.some(stage => stage.stage === 'tests')));
});

test('structure failure can trigger the same one-repair budget in both checked arms', async () => {
  const dataset = await loadFrozenDataset();
  const fixture = fakeFetch((_number, operation) => operation === 'repair' ? 'few' : { rawContent: '{"other":"few"}' });
  const result = await runPilot({ endpoint: 'http://127.0.0.1:9999/v1/chat/completions',
    model: 'synthetic.model', fetch: fixture.fetch, dataset, routerStatus: { schemaVersion: 1, active: null },
    maxOutputTokens: 128, selectedTaskIds: ['class-01'] });
  assert.deepEqual(result.rows.map(row => row.repairAttempts), [1, 1, 0]);
  assert.deepEqual(result.rows.map(row => row.oracleCorrect), [true, true, false]);
  assert.deepEqual(result.rows.map(row => row.receipts.length), [2, 2, 1]);
  const repairs = fixture.wires.filter(wire => JSON.parse(wire.messages[1].content).operation === 'repair');
  assert.equal(repairs.length, 2);
  assert.equal(repairs[0].messages[1].content, repairs[1].messages[1].content);
});

test('frozen object answers compare by value and duplicate candidate keys are refused', async () => {
  const dataset = await loadFrozenDataset();
  const expected = dataset.tasks.find(task => task.id === 'config-01').expectedAnswer;
  const good = fakeFetch(() => expected);
  const goodResult = await runPilot({ endpoint: 'http://127.0.0.1:9999/v1/chat/completions',
    model: 'synthetic.model', fetch: good.fetch, dataset, routerStatus: { schemaVersion: 1, active: null },
    maxOutputTokens: 128, selectedTaskIds: ['config-01'] });
  assert.ok(goodResult.rows.every(row => row.oracleCorrect));
  const duplicate = fakeFetch(() => ({ rawContent: '{"answer":1,"answer":2}' }));
  const badResult = await runPilot({ endpoint: 'http://127.0.0.1:9999/v1/chat/completions',
    model: 'synthetic.model', fetch: duplicate.fetch, dataset, routerStatus: { schemaVersion: 1, active: null },
    maxOutputTokens: 128, selectedTaskIds: ['config-01'] });
  assert.ok(badResult.rows.every(row => !row.oracleCorrect));
  assert.ok(badResult.rows.filter(row => row.arm !== 'A').every(row => row.outcome !== 'COMPLETED'));
});

test('route gate prevents any fake request', async () => {
  const dataset = await loadFrozenDataset();
  let requests = 0;
  await assert.rejects(() => runPilot({ endpoint: 'http://127.0.0.1:9999/v1/chat/completions',
    model: 'synthetic.model', fetch: async () => { requests += 1; }, dataset,
    routerStatus: { schemaVersion: 1, active: { stage: 'incomplete' } }, selectedTaskIds: ['class-01'] }),
  /SHARED_ROUTER_NOT_CLEAR/u);
  assert.equal(requests, 0);
});

test('a newly active router stops the next arm', async () => {
  const dataset = await loadFrozenDataset();
  const fixture = fakeFetch(() => 'few');
  let checks = 0;
  await assert.rejects(() => runPilot({ endpoint: 'http://127.0.0.1:9999/v1/chat/completions',
    model: 'synthetic.model', fetch: fixture.fetch, dataset, routerStatus: { schemaVersion: 1, active: null },
    routerStatusCheck: () => (++checks === 1 ? { schemaVersion: 1, active: null }
      : { schemaVersion: 1, active: { stage: 'incomplete' } }),
    maxOutputTokens: 128, selectedTaskIds: ['class-01'] }), /SHARED_ROUTER_NOT_CLEAR/u);
  assert.equal(fixture.wires.length, 1);
});

test('an existing output refuses before any model request', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nisi-pilot-existing-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'result.json');
  await fs.writeFile(output, 'original');
  const fixture = fakeFetch(() => 'few');
  await assert.rejects(() => main(['--allow-live', 'http://127.0.0.1:9999/v1/chat/completions',
    'synthetic.model', output, 'class-01'], { fetch: fixture.fetch, routerCommand: null }),
  { code: 'EEXIST' });
  assert.equal(fixture.wires.length, 0);
  assert.equal(await fs.readFile(output, 'utf8'), 'original');
});

test('an interrupted pilot retains the first row and marks the rest not run', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nisi-pilot-partial-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'result.json');
  const fixture = fakeFetch(() => 'few');
  let checks = 0;
  await assert.rejects(() => main(['--allow-live', 'http://127.0.0.1:9999/v1/chat/completions',
    'synthetic.model', output, 'class-01'], { fetch: fixture.fetch, routerCommand: null,
    routerStatusCheck: () => (++checks < 3 ? { schemaVersion: 1, active: null }
      : { schemaVersion: 1, active: { stage: 'incomplete' } }) }), /SHARED_ROUTER_NOT_CLEAR/u);
  assert.equal(fixture.wires.length, 1);
  const marker = JSON.parse(await fs.readFile(output, 'utf8'));
  assert.deepEqual([marker.status, marker.rowsCompleted, marker.notRunRows], ['PARTIAL', 1, 2]);
  const rows = (await fs.readFile(`${output}.rows.jsonl`, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].taskId, 'class-01');
});
