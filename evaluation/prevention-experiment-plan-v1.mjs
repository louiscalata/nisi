// PRIVATE declaration contract for a future matched prevention experiment.
// It freezes inputs before any run exists; it neither executes nor promotes a
// policy. Measured telemetry belongs to paired-trial results, never this plan.
import { createHash } from 'node:crypto';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const topKeys = ['schemaVersion','planId','policy','proposer','acceptanceReviewer','trainingDigests','tasks','repetitions','exclusions','budget','measuredTelemetry'];
const policyKeys = ['version','sha256','influenceEnabled'];
const taskKeys = ['caseId','taskSha256','baselineSha256','oracleSha256','armOrder'];
const exclusionKeys = ['code','description'];
const budgetKeys = ['maxDurationMs','maxModelCalls','maxInputTokens','maxOutputTokens'];
// Bounded declaration inventory, not permission to spend this many runs.
const MAX_REPETITIONS = 32;

function record(value, keys) {
  if (value === null || typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail('PLAN_RECORD');
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string') || keys.some(key => !own.includes(key))) fail('PLAN_FIELDS');
  const out = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) fail('PLAN_DESCRIPTOR');
    out[key] = descriptor.value;
  }
  return out;
}
function list(value, min, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('PLAN_LIST');
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < min || length > max) fail('PLAN_LIST');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || keys.at(-1) !== 'length') fail('PLAN_LIST_SHAPE');
  const out = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) fail('PLAN_DESCRIPTOR');
    out.push(descriptor.value);
  }
  return out;
}
function identifier(value) {
  if (typeof value !== 'string' || /^[a-z][a-z0-9_.-]{0,95}$/u.exec(value)?.[0] !== value) fail('PLAN_IDENTIFIER');
  return value;
}
function text(value) {
  if (typeof value !== 'string' || !value.isWellFormed() || value.length < 1 || value.length > 256 || value.trim() !== value || value.includes('\0')) fail('PLAN_TEXT');
  return value;
}
function digest(value) {
  if (typeof value !== 'string' || value.length !== 64 || !/^[a-f0-9]{64}$/u.test(value)) fail('PLAN_DIGEST');
  return value;
}
function natural(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || Object.is(value, -0)) fail('PLAN_NATURAL');
  return value;
}
function freezeOwned(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeOwned(child);
    Object.freeze(value);
  }
  return value;
}

export function readPreventionExperimentPlanV1(input) {
  const top = record(input, topKeys);
  if (top.schemaVersion !== 'nisi-prevention-experiment-plan-v1') fail('PLAN_SCHEMA');
  const planId = identifier(top.planId), proposer = identifier(top.proposer), acceptanceReviewer = identifier(top.acceptanceReviewer);
  if (proposer === acceptanceReviewer) fail('PLAN_REVIEW_INDEPENDENCE');
  const repetitions = natural(top.repetitions, 2);
  if (repetitions > MAX_REPETITIONS) fail('PLAN_REPETITION_LIMIT');
  if (repetitions % 2 !== 0) fail('PLAN_COUNTERBALANCE');

  const policy = record(top.policy, policyKeys);
  policy.version = identifier(policy.version); policy.sha256 = digest(policy.sha256);
  if (policy.influenceEnabled !== false) fail('PLAN_INFLUENCE_MUST_BE_OFF');

  const trainingDigests = list(top.trainingDigests, 0, 256).map(digest);
  if (new Set(trainingDigests).size !== trainingDigests.length) fail('PLAN_DUPLICATE_TRAINING');
  const taskIds = new Set(), evaluationDigests = new Set();
  const tasks = list(top.tasks, 1, 256).map(value => {
    const task = record(value, taskKeys);
    task.caseId = identifier(task.caseId);
    if (taskIds.has(task.caseId)) fail('PLAN_DUPLICATE_TASK'); taskIds.add(task.caseId);
    for (const key of ['taskSha256','baselineSha256','oracleSha256']) {
      task[key] = digest(task[key]);
      if (trainingDigests.includes(task[key])) fail('PLAN_TRAINING_EVALUATION_OVERLAP');
    }
    if (evaluationDigests.has(task.taskSha256)) fail('PLAN_DUPLICATE_EVALUATION'); evaluationDigests.add(task.taskSha256);
    task.armOrder = list(task.armOrder, repetitions, repetitions).map(order => {
      if (!['OFF_ON','ON_OFF'].includes(order)) fail('PLAN_ARM_ORDER');
      return order;
    });
    const offFirst = task.armOrder.filter(order => order === 'OFF_ON').length;
    if (offFirst * 2 !== repetitions) fail('PLAN_COUNTERBALANCE');
    return task;
  });

  const exclusionCodes = new Set();
  const exclusions = list(top.exclusions, 0, 64).map(value => {
    const exclusion = record(value, exclusionKeys);
    exclusion.code = identifier(exclusion.code); exclusion.description = text(exclusion.description);
    if (exclusionCodes.has(exclusion.code)) fail('PLAN_DUPLICATE_EXCLUSION'); exclusionCodes.add(exclusion.code);
    return exclusion;
  });
  const budget = record(top.budget, budgetKeys);
  for (const key of budgetKeys) budget[key] = natural(budget[key], 1);
  if (top.measuredTelemetry !== 'UNKNOWN_UNTIL_RUN') fail('PLAN_TELEMETRY_BOUNDARY');

  const declared = { schemaVersion: top.schemaVersion, planId, policy, proposer, acceptanceReviewer,
    trainingDigests, tasks, repetitions, exclusions, budget, measuredTelemetry: top.measuredTelemetry };
  const planSha256 = createHash('sha256').update(JSON.stringify(declared)).digest('hex');
  return freezeOwned({ ...declared, planSha256, status: 'DECLARED', preventionResult: null,
    promotionEligible: false, influenceEnabled: false, authorizing: false });
}
