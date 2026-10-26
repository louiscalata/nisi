// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// Bounded advisory capabilities built on the Jev evaluator. These functions
// classify task/candidate data; they do not provide Nisi acceptance evidence.

import { choice, noul, score } from './jev-adapter.mjs';
import { cloneFreeze, sha256Text, stableStringify } from '../../../workflow/contracts.mjs';
import { normalizeRoutingRoutes } from '../../../workflow/routing-queue-v1.mjs';

const MAX_TASK_BYTES = 16 * 1024;
const MAX_ACCEPTANCE_CRITERIA = 32;
const MAX_CRITERION_BYTES = 2048;
const MAX_CANDIDATE_BYTES = 256 * 1024;
const MAX_CANDIDATE_FILES = 64;
const MAX_FILE_PATH_BYTES = 512;
const MAX_FILE_CONTENT_BYTES = 64 * 1024;

const fail = code => { const error = new Error(code); error.code = code; throw error; };
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ownKeys = value => Reflect.ownKeys(value);
const exactKeys = (value, allowed, required = allowed) => {
  if (!isRecord(value) || ownKeys(value).some(key => !allowed.includes(key)) ||
      required.some(key => !Object.hasOwn(value, key))) fail('JEV_CAPABILITY_INPUT_INVALID');
};
const utf8Bytes = value => Buffer.byteLength(value, 'utf8');
const finiteUnit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const canonicalHash = value => sha256Text(stableStringify(value));

const TASK_QUESTIONS = Object.freeze({
  route: choice('Which kind of work does this task request?', {
    code_change: null, review: null, diagnosis: null, planning: null, other: null,
  }),
  risk: score('How much operational risk does this task carry?', ['low', 'medium', 'high']),
  destructive: noul('Could carrying out this task delete, overwrite, publish, migrate, or otherwise make data difficult to recover?'),
  underspecified: noul('Is the task missing information needed to carry it out safely?'),
});

const CANDIDATE_QUESTIONS = Object.freeze({
  scope: choice('How does the candidate relate to the supplied task?', {
    in_scope: null, out_of_scope: null, unclear: null,
  }),
  quality: score('How well does the candidate appear to satisfy the task?', ['poor', 'mixed', 'strong']),
  securityConcern: noul('Does the candidate contain a security concern that needs human review?'),
  needsReview: noul('Should this candidate receive additional human review before use?'),
});

function routingQuestions(routes) {
  const routeCriteria = Object.fromEntries([...routes.map(route => [route.id, null]), ['hold', null]]);
  return Object.freeze({
    target: choice(
      'Which registered route should receive this task? Select hold when the task is ambiguous, unsafe, or no route is appropriate.',
      routeCriteria,
    ),
    priority: choice('What bounded queue priority should the host use?', {
      low: null, normal: null, high: null,
    }),
    needsReview: noul('Should the selected route receive an independent review before any acceptance decision?'),
  });
}

function normalizeTask(value) {
  let task;
  if (typeof value === 'string') task = { taskId: null, text: value };
  else {
    exactKeys(value, ['taskId', 'text', 'mode', 'language', 'acceptanceCriteria'], ['text']);
    task = { taskId: value.taskId ?? null, text: value.text };
    if (value.mode !== undefined) task.mode = value.mode;
    if (value.language !== undefined) task.language = value.language;
    if (value.acceptanceCriteria !== undefined) task.acceptanceCriteria = value.acceptanceCriteria;
  }
  if (typeof task.text !== 'string' || task.text.trim() === '' || utf8Bytes(task.text) > MAX_TASK_BYTES) {
    fail('JEV_TASK_INVALID');
  }
  if (task.taskId !== null && (typeof task.taskId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/u.test(task.taskId))) fail('JEV_TASK_INVALID');
  if (task.mode !== undefined && !['edit', 'review'].includes(task.mode)) fail('JEV_TASK_INVALID');
  if (task.language !== undefined && (typeof task.language !== 'string' || task.language.trim() === '' ||
      utf8Bytes(task.language) > 256)) fail('JEV_TASK_INVALID');
  if (task.acceptanceCriteria !== undefined) {
    if (!Array.isArray(task.acceptanceCriteria) || task.acceptanceCriteria.length > MAX_ACCEPTANCE_CRITERIA ||
        task.acceptanceCriteria.some(item => typeof item !== 'string' || item.trim() === '' ||
          utf8Bytes(item) > MAX_CRITERION_BYTES)) fail('JEV_TASK_INVALID');
  }
  if (utf8Bytes(stableStringify(task)) > MAX_TASK_BYTES) fail('JEV_TASK_TOO_LARGE');
  return cloneFreeze(task);
}

function normalizeCandidate(value) {
  exactKeys(value, ['schemaVersion', 'authorId', 'fingerprint', 'files'], ['files']);
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) fail('JEV_CANDIDATE_INVALID');
  if (value.authorId !== undefined && (typeof value.authorId !== 'string' ||
      !/^[a-z][a-z0-9_.-]{0,95}$/u.test(value.authorId))) fail('JEV_CANDIDATE_INVALID');
  if (value.fingerprint !== undefined && (typeof value.fingerprint !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(value.fingerprint))) fail('JEV_CANDIDATE_INVALID');
  if (!Array.isArray(value.files) || value.files.length === 0 || value.files.length > MAX_CANDIDATE_FILES) {
    fail('JEV_CANDIDATE_INVALID');
  }
  const paths = new Set();
  const files = value.files.map(file => {
    exactKeys(file, ['path', 'content']);
    if (typeof file.path !== 'string' || file.path.trim() === '' || utf8Bytes(file.path) > MAX_FILE_PATH_BYTES ||
        file.path.startsWith('/') || file.path.includes('\\') ||
        file.path.split('/').some(part => part === '' || part === '.' || part === '..') || paths.has(file.path)) {
      fail('JEV_CANDIDATE_INVALID');
    }
    if (typeof file.content !== 'string' || utf8Bytes(file.content) > MAX_FILE_CONTENT_BYTES) {
      fail('JEV_CANDIDATE_INVALID');
    }
    paths.add(file.path);
    return { path: file.path, content: file.content };
  });
  const candidate = { files };
  if (value.schemaVersion !== undefined) candidate.schemaVersion = value.schemaVersion;
  if (value.authorId !== undefined) candidate.authorId = value.authorId;
  if (value.fingerprint !== undefined) candidate.fingerprint = value.fingerprint;
  if (utf8Bytes(stableStringify(candidate)) > MAX_CANDIDATE_BYTES) fail('JEV_CANDIDATE_TOO_LARGE');
  return cloneFreeze(candidate);
}

function validateNoul(name, answer) {
  exactKeys(answer, ['type', 'noul']);
  if (answer.type !== 'noul' || !finiteUnit(answer.noul)) fail('JEV_ANSWER_INVALID');
  return { type: 'noul', noul: answer.noul };
}

function validateChoice(name, question, answer) {
  exactKeys(answer, ['type', 'choice', 'confidence', 'probabilities']);
  const labels = Object.keys(question.criteria);
  if (answer.type !== 'choice' || typeof answer.choice !== 'string' || !labels.includes(answer.choice) ||
      !finiteUnit(answer.confidence) || !isRecord(answer.probabilities) ||
      ownKeys(answer.probabilities).some(key => !labels.includes(key)) ||
      labels.some(label => !Object.hasOwn(answer.probabilities, label) || !finiteUnit(answer.probabilities[label]))) {
    fail('JEV_ANSWER_INVALID');
  }
  const total = labels.reduce((sum, label) => sum + answer.probabilities[label], 0);
  if (Math.abs(total - 1) > 1e-6) fail('JEV_ANSWER_INVALID');
  return { type: 'choice', choice: answer.choice, confidence: answer.confidence,
    probabilities: Object.fromEntries(labels.map(label => [label, answer.probabilities[label]])) };
}

function validateScore(name, question, answer) {
  exactKeys(answer, ['type', 'score', 'confidence', 'legend', 'probabilities']);
  const labels = question.criteria.map((_, index) => String(index));
  if (answer.type !== 'score' || typeof answer.score !== 'number' || !Number.isFinite(answer.score) ||
      answer.score < 0 || answer.score > labels.length - 1 || !finiteUnit(answer.confidence) ||
      !isRecord(answer.legend) || !isRecord(answer.probabilities) ||
      ownKeys(answer.legend).some(key => !labels.includes(key)) ||
      ownKeys(answer.probabilities).some(key => !labels.includes(key)) ||
      labels.some(label => !Object.hasOwn(answer.legend, label) || !Object.hasOwn(answer.probabilities, label) ||
        !finiteUnit(answer.probabilities[label]))) fail('JEV_ANSWER_INVALID');
  const total = labels.reduce((sum, label) => sum + answer.probabilities[label], 0);
  if (Math.abs(total - 1) > 1e-6) fail('JEV_ANSWER_INVALID');
  return { type: 'score', score: answer.score, confidence: answer.confidence,
    // Return the caller-owned rubric, never arbitrary model-supplied legend text.
    legend: Object.fromEntries(labels.map(label => [label, question.criteria[Number(label)]])),
    probabilities: Object.fromEntries(labels.map(label => [label, answer.probabilities[label]])) };
}

function validateAnswers(questions, answers) {
  if (!isRecord(answers) || ownKeys(answers).some(key => !Object.hasOwn(questions, key)) ||
      ownKeys(questions).some(key => !Object.hasOwn(answers, key))) fail('JEV_ANSWER_COVERAGE');
  return Object.fromEntries(Object.entries(questions).map(([name, question]) => {
    const answer = answers[name];
    if (question.type === 'noul') return [name, validateNoul(name, answer)];
    if (question.type === 'choice') return [name, validateChoice(name, question, answer)];
    if (question.type === 'score') return [name, validateScore(name, question, answer)];
    fail('JEV_QUESTION_INVALID');
  }));
}

function evaluatorFor(value) {
  if (!isRecord(value) || typeof value.evaluate !== 'function') fail('JEV_CAPABILITY_EVALUATOR_INVALID');
  return value;
}

async function runCapability(capability, input, questions, state, task, candidateSha256 = null, extraKeys = []) {
  exactKeys(input, ['evaluator', 'task', ...(candidateSha256 === null ? [] : ['candidate']), ...extraKeys]);
  const evaluator = evaluatorFor(input.evaluator);
  let response;
  try {
    response = await evaluator.evaluate({ state, questions });
  } catch (error) {
    const code = typeof error?.code === 'string' && /^JEV_[A-Z0-9_]+$/u.test(error.code)
      ? error.code : 'JEV_UNAVAILABLE';
    fail(code);
  }
  if (!isRecord(response) || typeof response.model !== 'string' || response.model.trim() === '') {
    fail('JEV_RESPONSE_INVALID');
  }
  const answers = validateAnswers(questions, response?.answers);
  const taskSha256 = canonicalHash(task);
  return cloneFreeze({
    kind: 'nisi.jev.advisory.v1', schemaVersion: 1, capability, status: 'RESPONSE_VALIDATED',
    advisoryOnly: true, accepted: false,
    checks: 'NOT_RUN', tests: 'NOT_RUN', certification: 'NOT_RUN',
    taskId: task.taskId, taskSha256, candidateSha256,
    model: response.model, answers, usage: response.usage,
    evidence: { ...response.evidence, taskSha256, candidateSha256 },
  });
}

export async function analyzeTask(input) {
  exactKeys(input, ['evaluator', 'task']);
  const task = normalizeTask(input.task);
  return runCapability('analyzeTask', input, TASK_QUESTIONS, { task }, task);
}

export async function triageCandidate(input) {
  exactKeys(input, ['evaluator', 'task', 'candidate'], ['evaluator', 'task', 'candidate']);
  const task = normalizeTask(input.task);
  const candidate = normalizeCandidate(input.candidate);
  const candidateSha256 = canonicalHash(candidate);
  return runCapability('triageCandidate', input, CANDIDATE_QUESTIONS, { task, candidate }, task, candidateSha256);
}

export async function proposeRouting(input) {
  exactKeys(input, ['evaluator', 'task', 'routes']);
  const task = normalizeTask(input.task);
  const routes = normalizeRoutingRoutes(input.routes);
  const result = await runCapability(
    'proposeRouting',
    input,
    routingQuestions(routes),
    { task, routes },
    task,
    null,
    ['routes'],
  );
  const target = result.answers.target;
  const priority = result.answers.priority;
  const needsReview = result.answers.needsReview;
  const confidence = Math.min(target.confidence, priority.confidence, Math.max(needsReview.noul, 1 - needsReview.noul));
  return cloneFreeze({
    ...result,
    routing: {
      routeId: target.choice,
      priority: priority.choice,
      needsReview: needsReview.noul >= 0.5,
      confidence,
    },
    routesSha256: canonicalHash(routes),
  });
}

export function createJevCapabilities(evaluator) {
  evaluatorFor(evaluator);
  return Object.freeze({
    analyzeTask: input => analyzeTask({ ...input, evaluator }),
    triageCandidate: input => triageCandidate({ ...input, evaluator }),
    proposeRouting: input => proposeRouting({ ...input, evaluator }),
  });
}

export const JEV_TASK_QUESTION_NAMES = Object.freeze(Object.keys(TASK_QUESTIONS));
export const JEV_CANDIDATE_QUESTION_NAMES = Object.freeze(Object.keys(CANDIDATE_QUESTIONS));
export const JEV_ROUTING_QUESTION_NAMES = Object.freeze(['target', 'priority', 'needsReview']);
