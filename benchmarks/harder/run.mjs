// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// Opt-in harder-task benchmark: 16 frozen tasks whose answers make_tasks.py computes.
// Arm A drafts once with no checks. Arm C runs the Nisi workflow with a shape
// check, tests and a repair budget of 2. Test failures say WHICH parts are
// wrong, never the expected values.
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { createLocalChatAuthorAdapter, strictJSON, LOCAL_CHAT_REASONING_EFFORTS } from '../../adapters/local-chat.mjs';
import { planWithJev, createJevReviewer } from '../../adapters/jev-advisor.mjs';
import { createCandidate, sha256Text, stableStringify } from '../../workflow/contracts.mjs';
import { runWorkflow } from '../../workflow/engine.mjs';

export const TASKS_SHA256 = 'c7a521d443d9fff5a1244a1773d7cfa91c132e999a03de96b4239fa889c0a99a';
// Frozen task sets. v1 has 16 tasks; v2 has 42 harder tasks in six categories.
export const TASK_SETS = Object.freeze({
  v1: Object.freeze({ file: 'tasks-v1.json', sha256: TASKS_SHA256, count: 16 }),
  v2: Object.freeze({ file: 'tasks-v2.json', sha256: '63007882ea7bb02195abdf6b5eb8c1a09e87829ce26391fd4c4d2cde70350f5c', count: 42 }),
});

export async function loadTasks(version = 'v1') {
  const set = TASK_SETS[version];
  if (!set) throw new Error('HARDER_TASK_SET_INVALID');
  const bytes = await fs.readFile(new URL(`./${set.file}`, import.meta.url));
  if (createHash('sha256').update(bytes).digest('hex') !== set.sha256) throw new Error('HARDER_TASKS_CHANGED');
  return { ...JSON.parse(bytes), taskSetSha256: set.sha256 };
}

const finding = (code, message) => ({ code, message });
const same = (a, b) => stableStringify(a) === stableStringify(b);

export function parseAnswer(candidate) {
  try {
    if (!candidate || candidate.files.length !== 1 || candidate.files[0].path !== 'answer.json') return { ok: false, why: 'Expected exactly one file, answer.json.' };
    const value = strictJSON(candidate.files[0].content);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'answer')) {
      return { ok: false, why: 'answer.json must be a JSON object with exactly one key, "answer".' };
    }
    return { ok: true, answer: value.answer };
  } catch { return { ok: false, why: 'answer.json is not valid JSON.' }; }
}

// Describes what is wrong without revealing the expected answer.
export function diffAnswer(got, want) {
  if (same(got, want)) return [];
  if (Array.isArray(want)) {
    if (!Array.isArray(got)) return [finding('TYPE', `answer must be an array, got ${got === null ? 'null' : typeof got}.`)];
    if (got.length !== want.length) return [finding('LENGTH', `answer has ${got.length} elements; the task requires ${want.length}.`)];
    const bad = want.map((w, i) => same(got[i], w) ? null : i).filter(i => i !== null);
    // With at most two distinct values the wrong positions determine the answer, so report only the count.
    if (new Set(want.map(stableStringify)).size <= 2) return [finding('ELEMENTS', `${bad.length} of ${want.length} elements are incorrect.`)];
    return [finding('ELEMENTS', `${bad.length} of ${want.length} elements are incorrect, at positions ${bad.join(', ')} (0-based).`)];
  }
  if (want && typeof want === 'object') {
    if (!got || typeof got !== 'object' || Array.isArray(got)) return [finding('TYPE', 'answer must be an object.')];
    const missing = Object.keys(want).filter(k => !Object.hasOwn(got, k));
    const extra = Object.keys(got).filter(k => !Object.hasOwn(want, k));
    const wrong = Object.keys(want).filter(k => Object.hasOwn(got, k) && !same(got[k], want[k]));
    const out = [];
    if (missing.length) out.push(finding('MISSING_KEYS', `missing keys: ${missing.join(', ')}.`));
    if (extra.length) out.push(finding('EXTRA_KEYS', `unexpected keys: ${extra.join(', ')}.`));
    if (wrong.length) out.push(finding('WRONG_VALUES', `incorrect values for keys: ${wrong.join(', ')}.`));
    return out.length ? out : [finding('ORDER', 'object keys or nesting do not match the required form.')];
  }
  return [finding('VALUE', `answer ${JSON.stringify(got)} is incorrect.`)];
}

function taskFor(t, jevReview) {
  return { taskId: `harder.${t.id}`, mode: 'edit', language: 'json', allowedFiles: ['answer.json'], protectedFiles: [], protectedSnapshots: {},
    acceptanceCriteria: [t.prompt, 'Return exactly one answer.json file containing a JSON object with only the answer key.'],
    policy: { repairBudget: 2, totalDeadlineMs: 600_000, requiredReviewers: jevReview ? 2 : 1, requireReportStore: false } };
}

function adaptersFor(t, author, { shapeOnly, jevReview, judge }) {
  return {
    authorizeContext: { authorize: async ({ binding }) => ({ status: 'PASS', evidence: { ...binding, reason: '' } }) },
    author,
    staticChecks: { check: async ({ candidate, binding }) => {
      const p = parseAnswer(candidate); const findings = p.ok ? [] : [finding('ANSWER_SHAPE', p.why)];
      return { status: findings.length ? 'FAIL' : 'PASS', evidence: { ...binding, findings, reason: findings.length ? p.why : '' } };
    } },
    tests: { run: async ({ candidate, binding }) => {
      const p = parseAnswer(candidate);
      const failures = p.ok ? (shapeOnly ? [] : diffAnswer(p.answer, t.expectedAnswer)) : [finding('ANSWER_SHAPE', p.why)];
      return { status: failures.length ? 'FAIL' : 'PASS', evidence: { ...binding, assertionsExecuted: 1, assertionsPassed: failures.length ? 0 : 1,
        failures, reason: failures.length ? failures.map(x => x.message).join(' ') : '' } };
    } },
    reviewers: [
      { id: 'harder.reviewer', review: async ({ binding, reviewerId }) => ({ status: 'PASS',
        evidence: { ...binding, reviewerId, findings: [], summary: 'Structural review; tests decide correctness.', reason: '' } }) },
      ...(jevReview ? [createJevReviewer({ id: 'harder.jev', judge })] : []),
    ],
  };
}

// Builds the author adapter once so a bad endpoint, token cap, timeout or reasoning
// effort is refused before any output file is created or any task starts.
export function preflight({ endpoint, model, maxOutputTokens = 4096, timeoutMs = 120_000, reasoningEffort } = {}) {
  createLocalChatAuthorAdapter({ endpoint, destination: 'LOOPBACK_HTTP', model, id: 'harder.author', timeoutMs, maxOutputTokens,
    ...(reasoningEffort ? { reasoningEffort } : {}) });
}

export async function runHarder({ endpoint, model, fetch, dataset, maxOutputTokens = 4096, timeoutMs = 120_000, reasoningEffort, judge,
  plan = false, jevReview = false, shapeOnly = false, arms = ['A', 'C'], selectedTaskIds, onRow } = {}) {
  if ((plan || jevReview) && typeof judge !== 'function') throw new Error('HARDER_JUDGE_REQUIRED');
  if (reasoningEffort !== undefined && !LOCAL_CHAT_REASONING_EFFORTS.includes(reasoningEffort)) throw new Error('HARDER_REASONING_INVALID');
  if (endpoint !== undefined) preflight({ endpoint, model, maxOutputTokens, timeoutMs, reasoningEffort });
  if (selectedTaskIds && !selectedTaskIds.every(id => dataset.tasks.some(t => t.id === id))) throw new Error('HARDER_SELECTION_INVALID');
  const tasks = dataset.tasks.filter(t => !selectedTaskIds || selectedTaskIds.includes(t.id));
  const rows = [];
  for (const t of tasks) {
    const task = taskFor(t, jevReview);
    const planned = plan ? await planWithJev(task, { judge }) : null;
    for (const arm of arms) {
      const author = createLocalChatAuthorAdapter({ endpoint, destination: 'LOOPBACK_HTTP', model, id: 'harder.author', timeoutMs,
        maxOutputTokens, ...(reasoningEffort ? { reasoningEffort } : {}), ...(planned ? planned.settings : {}), ...(fetch ? { fetch } : {}) });
      const started = Date.now(); let candidate = null, outcome = null, code = null, report = null;
      try {
        if (arm === 'A') {
          const binding = { schemaVersion: 1, runId: randomUUID(), taskFingerprint: sha256Text(`nisi/workflow-task/v1\0${stableStringify(task)}`), attempt: 0, candidateFingerprint: null };
          const r = await author.draft({ task, candidate: null, acceptanceCriteria: task.acceptanceCriteria, binding });
          candidate = createCandidate(r.candidate, { authorId: author.id }); outcome = 'DRAFTED';
        } else {
          report = await runWorkflow(task, { adapters: adaptersFor(t, author, { shapeOnly, jevReview, judge }) });
          candidate = report.candidate; outcome = report.outcome; code = report.code;
        }
      } catch (error) { outcome = 'ERROR'; code = error?.code ?? 'ERROR'; }
      const p = parseAnswer(candidate);
      const receipts = author.receipts();
      const row = { task: t.id, arm, plan: planned?.plan ?? null, outcome, code, correct: p.ok && same(p.answer, t.expectedAnswer),
        repairs: report?.repairAttempts ?? 0, ms: Date.now() - started, calls: receipts.length,
        tokens: receipts.reduce((s, x) => s + (x.usage?.totalTokens ?? 0), 0) };
      rows.push(row);
      await onRow?.(row);
    }
  }
  const summary = Object.fromEntries(arms.map(arm => {
    const mine = rows.filter(r => r.arm === arm);
    return [arm, { correct: mine.filter(r => r.correct).length, of: mine.length, ms: mine.reduce((s, r) => s + r.ms, 0) }];
  }));
  return { datasetId: dataset.datasetId, datasetSha256: dataset.taskSetSha256 ?? TASKS_SHA256, model,
    settings: { maxOutputTokens, timeoutMs, reasoningEffort: reasoningEffort ?? null, plan, jevReview, tests: shapeOnly ? 'shape' : 'semantic' }, summary, rows };
}

const USAGE = 'USAGE: --allow-live <loopback-endpoint> <model> <output-file> [--tasks v1|v2] [--max-tokens N] [--timeout-ms N] [--reasoning EFFORT] [--tests shape] [--judge MODULE] [--plan] [--jev-review] [--task ID]';

export function parseArgs(argv) {
  if (argv[0] !== '--allow-live' || argv.length < 4) throw new Error(USAGE);
  const [, endpoint, model, outputFile, ...rest] = argv;
  const options = { endpoint, model, outputFile, taskSet: 'v1', maxOutputTokens: 4096, timeoutMs: 120_000, plan: false, jevReview: false, shapeOnly: false };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i], value = () => { if (rest[i + 1] === undefined) throw new Error(USAGE); return rest[++i]; };
    if (flag === '--tasks') { options.taskSet = value(); if (!Object.hasOwn(TASK_SETS, options.taskSet)) throw new Error(USAGE); }
    else if (flag === '--max-tokens') { options.maxOutputTokens = Number(value()); if (!Number.isSafeInteger(options.maxOutputTokens) || options.maxOutputTokens < 1) throw new Error(USAGE); }
    else if (flag === '--timeout-ms') { options.timeoutMs = Number(value()); if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1000) throw new Error(USAGE); }
    else if (flag === '--reasoning') options.reasoningEffort = value();
    else if (flag === '--tests') { if (value() !== 'shape') throw new Error(USAGE); options.shapeOnly = true; }
    else if (flag === '--judge') options.judgeModule = value();
    else if (flag === '--plan') options.plan = true;
    else if (flag === '--jev-review') options.jevReview = true;
    else if (flag === '--task') options.selectedTaskIds = [...(options.selectedTaskIds ?? []), value()];
    else throw new Error(USAGE);
  }
  if ((options.plan || options.jevReview) && !options.judgeModule) throw new Error('HARDER_JUDGE_REQUIRED');
  return options;
}

export async function main(argv = process.argv.slice(2), { fetch } = {}) {
  const options = parseArgs(argv);
  const dataset = await loadTasks(options.taskSet);
  // The judge module exports judge({ state, questions }) -> { model, answers }; the key and transport stay with it.
  const judge = options.judgeModule ? (await import(pathToFileURL(path.resolve(options.judgeModule)).href)).judge : undefined;
  // Refuse bad input before the output file exists, so a rejected run leaves nothing behind.
  if ((options.plan || options.jevReview) && typeof judge !== 'function') throw new Error('HARDER_JUDGE_REQUIRED');
  if (options.reasoningEffort !== undefined && !LOCAL_CHAT_REASONING_EFFORTS.includes(options.reasoningEffort)) throw new Error('HARDER_REASONING_INVALID');
  if (options.selectedTaskIds && !options.selectedTaskIds.every(id => dataset.tasks.some(t => t.id === id))) throw new Error('HARDER_SELECTION_INVALID');
  preflight(options);
  const output = await fs.open(options.outputFile, 'wx', 0o600);
  const rows = [];
  try {
    const result = await runHarder({ ...options, fetch, dataset, judge,
      onRow: row => { rows.push(row); console.log(JSON.stringify({ task: row.task, arm: row.arm, outcome: row.outcome, correct: row.correct, repairs: row.repairs, ms: row.ms })); } });
    await output.writeFile(`${JSON.stringify(result, null, 1)}\n`);
    return result;
  } catch (error) {
    // An interrupted run keeps the rows it finished.
    await output.writeFile(`${JSON.stringify({ status: 'PARTIAL', code: error?.code ?? error?.message ?? 'HARDER_INTERRUPTED',
      datasetSha256: TASKS_SHA256, model: options.model, rows }, null, 1)}\n`);
    throw error;
  } finally { await output.close(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(result => console.log(JSON.stringify(result.summary)), error => { console.error(error.message); process.exitCode = 1; });
}
