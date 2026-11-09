// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadTasks, diffAnswer, runHarder, parseArgs, main, TASK_SETS } from '../benchmarks/harder/run.mjs';

const ENDPOINT = 'http://127.0.0.1:9999/v1/chat/completions';

function fakeFetch(answerFor) {
  const wires = [];
  const fetch = async (url, request) => {
    assert.equal(url, ENDPOINT);
    const wire = JSON.parse(request.body);
    wires.push(wire);
    const operation = JSON.parse(wire.messages[1].content).operation;
    const file = { path: 'answer.json', content: JSON.stringify({ answer: answerFor(wires.length, operation) }) };
    const content = operation === 'repair'
      ? { status: 'REPAIRED', candidate: { files: [file] }, note: 'repair' }
      : { candidate: { files: [file] }, note: 'draft' };
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

const jevAnswer = values => async ({ questions }) => ({ model: 'jev-test',
  answers: Object.fromEntries(Object.keys(questions).map(k => [k, values[k]])) });

test('the task set is frozen and test feedback never reveals the expected answer', async () => {
  const dataset = await loadTasks();
  assert.equal(dataset.tasks.length, 16);
  assert.equal(new Set(dataset.tasks.map(t => t.id)).size, 16);
  const sort = dataset.tasks.find(t => t.id === 't02-multikey-sort');
  const wrong = [...sort.expectedAnswer].reverse();
  const [failure] = diffAnswer(wrong, sort.expectedAnswer);
  assert.equal(failure.code, 'ELEMENTS');
  for (const name of sort.expectedAnswer) assert.doesNotMatch(failure.message, new RegExp(`\\b${name}\\b`, 'u'));
  assert.deepEqual(diffAnswer(sort.expectedAnswer, sort.expectedAnswer), []);
  const fraction = dataset.tasks.find(t => t.id === 't14-fraction');
  assert.deepEqual(diffAnswer({ numerator: fraction.expectedAnswer.numerator }, fraction.expectedAnswer).map(f => f.code), ['MISSING_KEYS']);
  assert.deepEqual(diffAnswer({ numerator: 1, denominator: 1 }, fraction.expectedAnswer).map(f => f.code), ['WRONG_VALUES']);
});

test('the one-shot arm keeps a wrong draft; the Nisi arm repairs it from test feedback', async () => {
  const dataset = await loadTasks();
  const sort = dataset.tasks.find(t => t.id === 't02-multikey-sort');
  const fixture = fakeFetch(n => n === 3 ? sort.expectedAnswer : ['kai']);
  const result = await runHarder({ endpoint: ENDPOINT, model: 'synthetic.model', fetch: fixture.fetch, dataset,
    selectedTaskIds: [sort.id], maxOutputTokens: 256 });
  const [a, c] = result.rows;
  assert.deepEqual([a.arm, a.correct, a.outcome], ['A', false, 'DRAFTED']);
  assert.deepEqual([c.arm, c.correct, c.outcome, c.repairs], ['C', true, 'COMPLETED', 1]);
  assert.deepEqual(result.summary, { A: { correct: 0, of: 1, ms: a.ms }, C: { correct: 1, of: 1, ms: c.ms } });
  assert.equal(fixture.wires.length, 3);
  assert.ok(fixture.wires.every(w => w.max_tokens === 256 && !Object.hasOwn(w, 'reasoning_effort')));
  const repairRequest = fixture.wires[2].messages[1].content;
  assert.match(repairRequest, /the task requires 6/u);
  assert.doesNotMatch(repairRequest, /"abe"/u);
});

test('a Jev plan sets the wire settings and the Jev reviewer stays advisory', async () => {
  const dataset = await loadTasks();
  const t = dataset.tasks[0];
  const fixture = fakeFetch(() => t.expectedAnswer);
  const asked = [];
  const judge = async request => Object.hasOwn(request.questions, 'plan')
    ? jevAnswer({ plan: { choice: 'direct', confidence: 0.8 }, underspecified: { noul: 0.05 } })(request)
    : (asked.push(Object.keys(request.questions)), jevAnswer({ satisfies: { noul: 0.1 } })(request));
  const result = await runHarder({ endpoint: ENDPOINT, model: 'synthetic.model', fetch: fixture.fetch, dataset,
    selectedTaskIds: [t.id], arms: ['C'], plan: true, jevReview: true, judge });
  assert.deepEqual([result.rows[0].plan, result.rows[0].correct, result.rows[0].outcome], ['direct', true, 'COMPLETED']);
  assert.deepEqual(asked, [['satisfies']]);
  assert.equal(fixture.wires.length, 1);
  assert.equal(fixture.wires[0].reasoning_effort, 'none');
  assert.equal(fixture.wires[0].max_tokens, 1024);
  await assert.rejects(() => runHarder({ dataset, plan: true }), /HARDER_JUDGE_REQUIRED/u);
});

test('the CLI needs explicit opt-in, a judge module for Jev, and a new output file', async () => {
  assert.throws(() => parseArgs([ENDPOINT, 'm', 'out.json']), /USAGE/u);
  assert.throws(() => parseArgs(['--allow-live', ENDPOINT, 'm', 'out.json', '--tests', 'all']), /USAGE/u);
  assert.throws(() => parseArgs(['--allow-live', ENDPOINT, 'm', 'out.json', '--timeout-ms', '10']), /USAGE/u);
  assert.equal(parseArgs(['--allow-live', ENDPOINT, 'm', 'out.json', '--timeout-ms', '300000']).timeoutMs, 300000);
  assert.throws(() => parseArgs(['--allow-live', ENDPOINT, 'm', 'out.json', '--plan']), /HARDER_JUDGE_REQUIRED/u);
  assert.deepEqual(parseArgs(['--allow-live', ENDPOINT, 'm', 'o', '--max-tokens', '4096', '--reasoning', 'none', '--task', 'x']),
    { endpoint: ENDPOINT, model: 'm', outputFile: 'o', taskSet: 'v1', maxOutputTokens: 4096, timeoutMs: 120000, plan: false, jevReview: false, shapeOnly: false,
      reasoningEffort: 'none', selectedTaskIds: ['x'] });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nisi-harder-'));
  try {
    const dataset = await loadTasks();
    const out = path.join(dir, 'result.json');
    const fixture = fakeFetch(() => dataset.tasks[0].expectedAnswer);
    const log = console.log; console.log = () => {};
    try { await main(['--allow-live', ENDPOINT, 'synthetic.model', out, '--task', dataset.tasks[0].id], { fetch: fixture.fetch }); }
    finally { console.log = log; }
    const saved = JSON.parse(await fs.readFile(out, 'utf8'));
    assert.deepEqual(saved.summary.A.correct + saved.summary.C.correct, 2);
    await assert.rejects(() => main(['--allow-live', ENDPOINT, 'synthetic.model', out, '--task', dataset.tasks[0].id], { fetch: fixture.fetch }), { code: 'EEXIST' });
    await assert.rejects(() => main(['--allow-live', ENDPOINT, 'synthetic.model', path.join(dir, 'n.json'), '--task', 'nope']), /HARDER_SELECTION_INVALID/u);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('bad input is refused before any output file exists, and an interrupted run keeps its finished rows', async () => {
  const dataset = await loadTasks();
  const t = dataset.tasks[0];
  await assert.rejects(() => runHarder({ dataset, selectedTaskIds: [t.id, 'nope'] }), /HARDER_SELECTION_INVALID/u);
  await assert.rejects(() => runHarder({ dataset, reasoningEffort: 'maximum' }), /HARDER_REASONING_INVALID/u);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nisi-harder-'));
  try {
    const out = path.join(dir, 'bad.json');
    for (const args of [['--task', t.id, '--task', 'nope'], ['--reasoning', 'maximum']]) {
      await assert.rejects(() => main(['--allow-live', ENDPOINT, 'm', out, ...args]), /HARDER_(SELECTION|REASONING)_INVALID/u);
      await assert.rejects(() => fs.access(out), { code: 'ENOENT' });
    }
    for (const args of [['--max-tokens', '99999'], ['--timeout-ms', '999999999']]) {
      await assert.rejects(() => main(['--allow-live', ENDPOINT, 'm', out, ...args]), { code: /^LOCAL_CHAT_(TOKEN_CAP|TIMEOUT)_INVALID$/u });
      await assert.rejects(() => fs.access(out), { code: 'ENOENT' });
    }
    await assert.rejects(() => main(['--allow-live', 'http://example.com/v1/chat/completions', 'm', out]), { code: 'LOCAL_CHAT_DESTINATION_REFUSED' });
    await assert.rejects(() => fs.access(out), { code: 'ENOENT' });
    const noJudge = path.join(dir, 'no-judge.mjs');
    await fs.writeFile(noJudge, 'export const other = 1;\n');
    await assert.rejects(() => main(['--allow-live', ENDPOINT, 'm', out, '--plan', '--judge', noJudge]), /HARDER_JUDGE_REQUIRED/u);
    await assert.rejects(() => fs.access(out), { code: 'ENOENT' });
    // The Jev judge fails when planning the second task: the first task's two rows survive in the partial file.
    const judgeFile = path.join(dir, 'judge.mjs');
    await fs.writeFile(judgeFile, `let n = 0;
export async function judge({ questions }) {
  n += 1;
  if (n > 1) throw new Error('offline');
  return { model: 'jev-test', answers: Object.fromEntries(Object.keys(questions).map(k => [k, k === 'plan' ? { choice: 'direct' } : { noul: 0.1 }])) };
}
`);
    const partial = path.join(dir, 'partial.json');
    const fixture = fakeFetch(() => t.expectedAnswer);
    const log = console.log; console.log = () => {};
    try { await assert.rejects(() => main(['--allow-live', ENDPOINT, 'synthetic.model', partial, '--plan', '--judge', judgeFile, '--task', t.id, '--task', dataset.tasks[1].id], { fetch: fixture.fetch }), { code: 'JEV_UNAVAILABLE' }); }
    finally { console.log = log; }
    const saved = JSON.parse(await fs.readFile(partial, 'utf8'));
    assert.equal(saved.status, 'PARTIAL');
    assert.equal(saved.code, 'JEV_UNAVAILABLE');
    assert.equal(saved.datasetSha256, dataset.taskSetSha256);
    assert.deepEqual(saved.rows.map(r => [r.task, r.arm, r.correct]), [[t.id, 'A', true], [t.id, 'C', true]]);
    const v2 = await loadTasks('v2');
    const throwJudge = path.join(dir, 'throw.mjs');
    await fs.writeFile(throwJudge, 'export async function judge() { const error = new Error("offline"); error.code = "JEV_UNAVAILABLE"; throw error; }\n');
    const partialV2 = path.join(dir, 'partial-v2.json');
    const logAgain = console.log; console.log = () => {};
    try {
      await assert.rejects(() => main(['--allow-live', ENDPOINT, 'synthetic.model', partialV2, '--tasks', 'v2', '--plan', '--judge', throwJudge, '--task', v2.tasks[0].id], { fetch: fixture.fetch }), { code: 'JEV_UNAVAILABLE' });
    } finally { console.log = logAgain; }
    const savedV2 = JSON.parse(await fs.readFile(partialV2, 'utf8'));
    assert.equal(savedV2.datasetSha256, v2.taskSetSha256);
    assert.notEqual(savedV2.datasetSha256, dataset.taskSetSha256);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('repair feedback never lets a two-valued answer be rebuilt from positions', async () => {
  const dataset = await loadTasks('v2');
  const t = dataset.tasks.find(x => x.id === 'algorithms-03');
  assert.ok(t.expectedAnswer.every(x => typeof x === 'boolean'));
  const flipped = t.expectedAnswer.map((x, i) => i % 3 === 0 ? !x : x);
  const [finding] = diffAnswer(flipped, t.expectedAnswer);
  assert.equal(finding.code, 'ELEMENTS');
  assert.doesNotMatch(finding.message, /positions|\d+, \d+/u);
  assert.match(finding.message, /^\d+ of 17 elements are incorrect\.$/u);
  // A wide answer still names its wrong positions.
  const names = dataset.tasks.find(x => x.id === 't02-multikey-sort') ?? (await loadTasks('v1')).tasks.find(x => x.id === 't02-multikey-sort');
  assert.match(diffAnswer([...names.expectedAnswer].reverse(), names.expectedAnswer)[0].message, /positions/u);
});

test('the semantic-version task is computed, not typed', async () => {
  const dataset = await loadTasks();
  const t = dataset.tasks.find(x => x.id === 't16-semver-sort');
  const key = v => { const [core, pre] = v.split(/-(.*)/u); const nums = core.split('.').map(Number);
    return { nums, pre: pre === undefined ? null : pre.split('.').map(x => /^\d+$/u.test(x) ? [0, Number(x), ''] : [1, 0, x]) }; };
  const cmpArr = (a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i += 1) for (let j = 0; j < a[i].length; j += 1) if (a[i][j] !== b[i][j]) return a[i][j] < b[i][j] ? -1 : 1; return a.length - b.length; };
  const cmp = (a, b) => { const x = key(a), y = key(b); for (let i = 0; i < 3; i += 1) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
    if (x.pre === null || y.pre === null) return (x.pre === null) - (y.pre === null); return cmpArr(x.pre, y.pre); };
  const listed = JSON.parse(t.prompt.slice(t.prompt.indexOf('['), t.prompt.lastIndexOf(']') + 1));
  assert.deepEqual([...listed].sort(cmp), t.expectedAnswer);
});

test('the v2 task set is frozen, varied, well-formed and runs through the runner', async () => {
  const dataset = await loadTasks('v2');
  assert.equal(dataset.datasetId, 'nisi-harder-v2');
  assert.equal(dataset.tasks.length, TASK_SETS.v2.count);
  assert.equal(new Set(dataset.tasks.map(t => t.id)).size, 42);
  const categories = new Map();
  for (const t of dataset.tasks) {
    assert.deepEqual(Object.keys(t).sort(), ['category', 'expectedAnswer', 'id', 'prompt', 'tier']);
    assert.ok(t.id.startsWith(`${t.category}-`));
    assert.ok(['medium', 'hard'].includes(t.tier));
    assert.match(t.prompt, /Return answer as /u);
    assert.ok(t.prompt.length >= 300 && t.prompt.length <= 1800, t.id);
    assert.deepEqual(JSON.parse(JSON.stringify(t.expectedAnswer)), t.expectedAnswer);
    categories.set(t.category, (categories.get(t.category) ?? 0) + 1);
  }
  assert.deepEqual([...categories.values()], [7, 7, 7, 7, 7, 7]);
  assert.equal(categories.size, 6);
  await assert.rejects(() => loadTasks('v3'), /HARDER_TASK_SET_INVALID/u);
  const t = dataset.tasks[0];
  const fixture = fakeFetch(() => t.expectedAnswer);
  const result = await runHarder({ endpoint: ENDPOINT, model: 'synthetic.model', fetch: fixture.fetch, dataset, selectedTaskIds: [t.id], arms: ['A', 'C'] });
  assert.equal(result.datasetSha256, TASK_SETS.v2.sha256);
  assert.deepEqual(result.rows.map(r => [r.arm, r.correct]), [['A', true], ['C', true]]);
  assert.equal(parseArgs(['--allow-live', ENDPOINT, 'm', 'o', '--tasks', 'v2']).taskSet, 'v2');
  assert.throws(() => parseArgs(['--allow-live', ENDPOINT, 'm', 'o', '--tasks', 'v9']), /USAGE/u);
});
