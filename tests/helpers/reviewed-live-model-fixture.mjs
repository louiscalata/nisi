// Synthetic checks and injected HTTP-shaped responses only. No fixture execution.
import { runWorkflow } from '../../workflow/engine.mjs';
import { createReviewedLiveFixtureV1 } from '../../examples/repository-task/reviewed-live-fixture-v1.mjs';
import { createReviewedLiveModelLaneWithTransportV1, createReviewedLiveModelLaneWithTransportV2 } from '../../hosts/repository/reviewed-live-model-v1.mjs';

export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
export const tick = () => new Promise(resolve => setImmediate(resolve));
export const reply = envelope => new Response(JSON.stringify(envelope));
export const fixedRunId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
export const configuration = fixture => ({ suite: fixture.suite, reviewedSourceFingerprint: fixture.reviewedSourceFingerprint,
  endpoint: 'http://127.0.0.1:1234/v1/chat/completions', authorModel: 'synthetic.author', reviewerModel: 'synthetic.reviewer',
  timeoutMs: 1000, maxOutputTokens: 512, approval: { id: 'synthetic.approval', expiresAtMs: 10000 } });
export function payload(fixture, { attempt = 1, candidate = fixture.preparations[0].candidate,
  runId = fixedRunId, signal, binding = {} } = {}) {
  return { task: fixture.task, candidate, acceptanceCriteria: fixture.task.acceptanceCriteria,
    binding: { schemaVersion: 1, runId, taskFingerprint: fixture.preparations[0].taskFingerprint,
      attempt, candidateFingerprint: candidate?.fingerprint ?? null, ...binding }, ...(signal ? { signal } : {}) };
}
export function seed(context) {
  const p = payload(context.fixture, { attempt: 0, candidate: null });
  context.lane.authorizeContext.authorize(p); context.lane.author.draft(p);
  return payload(context.fixture);
}
export async function context({ onRequest, now = () => 100, configure = () => {}, laneVersion = 1 } = {}) {
  const fixture = await createReviewedLiveFixtureV1(), input = configuration(fixture), requests = [], checks = [], tests = [];
  if (laneVersion === 2) Object.assign(input, { authorOutputMode: 'json_instruction', reviewerOutputMode: 'json_instruction' });
  configure(input); let lane;
  const transport = async (url, request) => {
    const body = JSON.parse(request.body), modelPayload = JSON.parse(body.messages[1].content), operation = modelPayload.operation;
    const content = operation === 'repair'
      ? { status: 'REPAIRED', candidate: { files: fixture.preparations[1].candidate.files }, note: 'Synthetic registered repair response' }
      : { findings: [], summary: 'Synthetic independent reviewer response' };
    const envelope = { model: body.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
      usage: operation === 'repair' ? { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 }
        : { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 } };
    const call = { url, request, body, modelPayload, operation, envelope };
    requests.push(call);
    return onRequest ? onRequest(call, () => lane) : reply(envelope);
  };
  lane = (laneVersion === 2 ? createReviewedLiveModelLaneWithTransportV2 : createReviewedLiveModelLaneWithTransportV1)(input, transport, now);
  const run = ({ signal, beforeCheck } = {}) => runWorkflow(fixture.task, { ...(signal ? { signal } : {}), adapters: {
    authorizeContext: lane.authorizeContext, author: lane.author, reviewers: lane.reviewers,
    staticChecks: { check(p) {
      checks.push(p.binding); beforeCheck?.(p);
      return { status: 'PASS', evidence: { ...p.binding, findings: [], reason: '' } };
    } },
    tests: { run(p) {
      tests.push(p.binding); const baseline = p.binding.candidateFingerprint === fixture.preparations[0].candidateFingerprint;
      const failures = baseline ? [{ code: 'SYNTHETIC_ZERO_RETRY', message: 'Synthetic zero-retry failure' },
        { code: 'SYNTHETIC_CONFIG_ZERO', message: 'Synthetic configured-zero failure' }] : [];
      return { status: baseline ? 'FAIL' : 'PASS', evidence: { ...p.binding, assertionsExecuted: 10,
        assertionsPassed: baseline ? 8 : 10, failures, reason: baseline ? 'Synthetic baseline behavior failure' : '' } };
    } },
  } });
  return { fixture, input, lane, requests, checks, tests, run };
}
