// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// Exploratory, opt-in local inference pilot. The frozen oracle is outside the workflow.
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createLocalChatAuthorAdapter, strictJSON } from '../../adapters/local-chat.mjs';
import { createCandidate, sha256Text, stableStringify } from '../../workflow/contracts.mjs';
import { runWorkflow } from '../../workflow/engine.mjs';
import { runCheckedLoop } from './checked-loop.mjs';

export const FROZEN_DATASET_SHA256 = 'cef0921e2104650b4c7f1f5f0612379d35bbe393c6152811f9236543a8a20a40';
const fixturePath = fileURLToPath(new URL('./fixtures/live-pilot-v1.json', import.meta.url));
const arms = Object.freeze(['A', 'B', 'C']);
const finding = (code, message) => ({ code, message });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function loadFrozenDataset() {
  const bytes = await fs.readFile(fixturePath);
  if (sha256(bytes) !== FROZEN_DATASET_SHA256) throw new Error('FROZEN_DATASET_CHANGED');
  const dataset = JSON.parse(bytes.toString('utf8'));
  if (dataset.tasks.length !== 12 || new Set(dataset.tasks.map(task => task.id)).size !== 12 ||
      dataset.tasks.some(task => !task.id || !task.prompt || !Object.hasOwn(task, 'expectedAnswer'))) {
    throw new Error('FROZEN_DATASET_INVALID');
  }
  return dataset;
}

export function assertRouterClear(status) {
  if (!status || status.schemaVersion !== 1 || !Object.hasOwn(status, 'active') || status.active !== null ||
      status.recoveryRequired === true) throw new Error('SHARED_ROUTER_NOT_CLEAR');
}

function readRouterStatus(command) {
  const raw = execFileSync(command, ['--route', 'status'],
    { encoding: 'utf8', timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(raw);
}

function candidateShape(candidate) {
  try {
    if (!candidate || candidate.files.length !== 1 || candidate.files[0].path !== 'answer.json') return false;
    const answer = strictJSON(candidate.files[0].content);
    return answer && typeof answer === 'object' && !Array.isArray(answer) &&
      Object.keys(answer).length === 1 && Object.hasOwn(answer, 'answer');
  } catch { return false; }
}

function oracle(candidate, expectedAnswer) {
  if (!candidateShape(candidate)) return false;
  try { return stableStringify(strictJSON(candidate.files[0].content).answer) === stableStringify(expectedAnswer); }
  catch { return false; }
}

function makeTask(specimen, deadlineMs) {
  return { taskId: `pilot.${specimen.id}`, mode: 'edit', language: 'json', allowedFiles: ['answer.json'],
    protectedFiles: [], protectedSnapshots: {},
    acceptanceCriteria: [specimen.prompt,
      'Return exactly one answer.json file containing a JSON object with only the answer key.'],
    policy: { repairBudget: 1, totalDeadlineMs: deadlineMs, requiredReviewers: 1, requireReportStore: false } };
}

function makeChecks(author) {
  // Both schedulers receive the same repair message for the same structural
  // failure. Their native stage reports remain in the retained workflow report.
  const comparableAuthor = { id: author.id, draft: payload => author.draft(payload),
    repair: payload => {
      if (candidateShape(payload.candidate)) throw new Error('PILOT_UNEXPECTED_REPAIR');
      return author.repair({ ...payload, stages: [{ stage: 'staticChecks', status: 'FAIL',
        findings: [finding('ANSWER_SHAPE', 'answer.json must contain exactly one answer key.')] }] });
    } };
  const staticChecks = { check: async ({ candidate, binding }) => {
    const findings = candidateShape(candidate) ? [] : [finding('ANSWER_SHAPE', 'Expected one answer.json file with one answer key.')];
    return { status: findings.length ? 'FAIL' : 'PASS', evidence: { ...binding, findings,
      reason: findings.length ? 'Answer shape failed.' : '' } };
  } };
  const tests = { run: async ({ candidate, binding }) => {
    const valid = candidateShape(candidate);
    return { status: valid ? 'PASS' : 'FAIL', evidence: { ...binding, assertionsExecuted: 1,
      assertionsPassed: valid ? 1 : 0,
      failures: valid ? [] : [finding('ANSWER_SHAPE', 'Answer file failed the structural assertion.')],
      reason: valid ? '' : 'Answer file failed the structural assertion.' } };
  } };
  const reviewers = [{ id: 'pilot.structural_reviewer', review: async ({ candidate, binding, reviewerId }) => {
    const findings = candidateShape(candidate) ? [] : [finding('ANSWER_SHAPE', 'Answer file is malformed.')];
    return { status: findings.length ? 'FAIL' : 'PASS', evidence: { ...binding, reviewerId, findings,
      summary: 'Deterministic shape review only; semantic answer unverified.',
      reason: findings.length ? 'Answer file is malformed.' : '' } };
  } }];
  return { authorizeContext: { authorize: async ({ binding }) => ({ status: 'PASS', evidence: { ...binding, reason: '' } }) },
    author: comparableAuthor, staticChecks, tests, reviewers };
}

export function orderedArms(taskIndex) {
  if (!Number.isSafeInteger(taskIndex) || taskIndex < 0) throw new Error('TASK_INDEX_INVALID');
  return [...arms.slice(taskIndex % 3), ...arms.slice(0, taskIndex % 3)];
}

export async function runPilot({ endpoint, model, fetch, dataset, routerStatus, routerStatusCheck, deadlineMs = 90_000,
  maxOutputTokens = 1024, selectedTaskIds, onRow } = {}) {
  if (routerStatus !== undefined) assertRouterClear(routerStatus);
  if (!dataset || !Array.isArray(dataset.tasks) || !Number.isSafeInteger(deadlineMs) || deadlineMs < 1000 ||
      !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) throw new Error('PILOT_CONFIG_INVALID');
  const selected = selectedTaskIds ? dataset.tasks.filter(task => selectedTaskIds.includes(task.id)) : dataset.tasks;
  if (!selected.length || (selectedTaskIds && selected.length !== new Set(selectedTaskIds).size)) throw new Error('PILOT_SELECTION_INVALID');
  const rows = [];
  for (const specimen of selected) {
    const task = makeTask(specimen, deadlineMs);
    const index = dataset.tasks.findIndex(item => item.id === specimen.id);
    for (const arm of orderedArms(index)) {
      if (routerStatusCheck) assertRouterClear(await routerStatusCheck());
      const author = createLocalChatAuthorAdapter({ endpoint, destination: 'LOOPBACK_HTTP', model,
        id: 'pilot.author', timeoutMs: deadlineMs, maxOutputTokens, ...(fetch ? { fetch } : {}) });
      const started = performance.now();
      let report = null, candidate = null, code = null, outcome = null, directRunId = null;
      try {
        if (arm === 'A') {
          const taskFingerprint = sha256Text(`nisi/workflow-task/v1\0${stableStringify(task)}`);
          directRunId = randomUUID();
          const binding = { schemaVersion: 1, runId: directRunId, taskFingerprint, attempt: 0, candidateFingerprint: null };
          const result = await author.draft({ task, candidate: null, acceptanceCriteria: task.acceptanceCriteria, binding });
          candidate = createCandidate(result.candidate, { authorId: author.id });
          outcome = 'DRAFTED';
        } else {
          const adapters = makeChecks(author);
          report = arm === 'B' ? await runCheckedLoop(task, { adapters }) : await runWorkflow(task, { adapters });
          candidate = report.candidate;
          outcome = report.outcome;
          code = report.code;
        }
      } catch (error) { outcome = 'ERROR'; code = typeof error?.code === 'string' ? error.code : 'PILOT_ERROR'; }
      const receipts = author.receipts();
      const row = { taskId: specimen.id, category: specimen.category, arm, order: orderedArms(index),
        outcome, code, elapsedMs: Math.round(performance.now() - started),
        runId: directRunId ?? report?.runId ?? null,
        armCompleted: arm === 'A' ? outcome === 'DRAFTED' : outcome === 'COMPLETED',
        oracleCorrect: oracle(candidate, specimen.expectedAnswer),
        candidateFingerprint: candidate?.fingerprint ?? null, candidate, report,
        repairAttempts: report?.repairAttempts ?? 0, reportStages: report?.stages.map(stage => ({ stage: stage.stage,
          status: stage.status, code: stage.code })) ?? [], receipts };
      rows.push(row);
      if (onRow) await onRow(row);
    }
  }
  return { schemaVersion: 1, study: 'exploratory-structured-output-pilot', datasetId: dataset.datasetId,
    datasetSha256: FROZEN_DATASET_SHA256, model, endpoint,
    routerGate: routerStatus === undefined ? 'NOT_CONFIGURED' : 'CHECKED_BETWEEN_ARMS',
    settings: { temperature: 0, maxOutputTokens,
      deadlineMs, repairBudget: 1 }, rows };
}

async function replaceReserved(handle, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await handle.truncate(0);
  for (let offset = 0; offset < bytes.length;) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
    if (bytesWritten < 1) throw new Error('OUTPUT_WRITE_INCOMPLETE');
    offset += bytesWritten;
  }
  await handle.sync();
}

export async function main(argv = process.argv.slice(2), { fetch, routerCommand = process.env.NISI_ROUTER_COMMAND,
  routerStatusCheck } = {}) {
  if (argv.length !== 5 || argv[0] !== '--allow-live') throw new Error('USAGE: --allow-live <loopback-endpoint> <model> <output-file> <task-id|all>');
  const [, endpoint, model, outputFile, taskId] = argv;
  const dataset = await loadFrozenDataset();
  const selectedTaskIds = taskId === 'all' ? undefined : [taskId];
  const selectedCount = selectedTaskIds ? dataset.tasks.filter(task => selectedTaskIds.includes(task.id)).length : dataset.tasks.length;
  if (!selectedCount) throw new Error('PILOT_SELECTION_INVALID');
  // A host with shared code-mode ownership can supply its CLI. Other hosts need
  // no private routing tool; they still opt into real loopback inference.
  const statusCheck = routerStatusCheck ?? (routerCommand ? () => readRouterStatus(routerCommand) : undefined);
  const routerStatus = statusCheck?.();
  if (routerStatus !== undefined) assertRouterClear(routerStatus);
  // Reserve the output before inference. The sidecar records each completed arm
  // so an interruption does not erase calls already made.
  const output = await fs.open(outputFile, 'wx', 0o600);
  let progress = null, rowCount = 0;
  const progressFile = `${outputFile}.rows.jsonl`;
  try {
    await replaceReserved(output, { status: 'IN_PROGRESS', datasetSha256: FROZEN_DATASET_SHA256,
      plannedRows: selectedCount * 3, rowsCompleted: 0, progressFile });
    progress = await fs.open(progressFile, 'wx', 0o600);
    const result = await runPilot({ endpoint, model, fetch, dataset, routerStatus,
      routerStatusCheck: statusCheck, selectedTaskIds,
      onRow: async row => { await progress.writeFile(`${JSON.stringify(row)}\n`); await progress.sync(); rowCount += 1; } });
    await replaceReserved(output, result);
    return result;
  } catch (error) {
    await replaceReserved(output, { status: 'PARTIAL', code: typeof error?.message === 'string' ? error.message : 'PILOT_INTERRUPTED',
      datasetSha256: FROZEN_DATASET_SHA256, plannedRows: selectedCount * 3,
      rowsCompleted: rowCount, notRunRows: selectedCount * 3 - rowCount, progressFile });
    throw error;
  } finally {
    await progress?.close();
    await output.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(result => console.log(JSON.stringify({ rows: result.rows.length, model: result.model })),
    error => { console.error(error.message); process.exitCode = 1; });
}
