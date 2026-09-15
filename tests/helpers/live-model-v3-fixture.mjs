// Synthetic model responses/checks only; no native source execution or inference.
import { runWorkflow } from '../../workflow/engine.mjs';
import { createReviewedLiveFixtureV1 } from '../../examples/repository-task/reviewed-live-fixture-v1.mjs';
import { createReviewedLiveModelLaneWithTransportV3 } from '../../hosts/repository/reviewed-live-model-v3.mjs';
export { payload, seed, deferred, tick, reply } from './reviewed-live-model-fixture.mjs';

export function selection(role, api = role === 'author' ? 'NATIVE_API' : 'CHAT_COMPLETIONS') {
  return { api, endpoint: 'http://127.0.0.1:1234/' + (api === 'NATIVE_API' ? 'api/v1/chat' : 'v1/chat/completions'),
    model: 'synthetic.' + role, ...(api === 'NATIVE_API' ? { expectedModelInstance: 'synthetic.' + role + '.instance',
      profile: 'nisi-native-chat-content-v1', reasoning: 'off' } : { outputMode: 'json_schema' }) };
}
export const configuration = fixture => ({ suite: fixture.suite, reviewedSourceFingerprint: fixture.reviewedSourceFingerprint,
  author: selection('author'), reviewer: selection('reviewer'), timeoutMs: 1000, maxOutputTokens: 512,
  approval: { id: 'synthetic.approval', expiresAtMs: 10000 } });
export async function context({ configure = () => {}, onRequest, now = () => 100 } = {}) {
  const fixture = await createReviewedLiveFixtureV1(), input = configuration(fixture), requests = [], checks = [], tests = [];
  configure(input); let lane;
  const transport = role => async (url, request) => {
    const body = JSON.parse(request.body), native = Object.hasOwn(body, 'input');
    const modelPayload = JSON.parse(native ? body.input : body.messages[1].content), operation = modelPayload.operation;
    const content = operation === 'repair'
      ? { status: 'REPAIRED', candidate: { files: fixture.preparations[1].candidate.files }, note: 'Synthetic exact registered repair' }
      : { findings: [], summary: 'Synthetic review of supplied candidate and checks' };
    const p = role === 'author' ? 40 : 30, c = role === 'author' ? 10 : 5;
    const envelope = native ? { model_instance_id: input[role].expectedModelInstance, output: [{ type: 'message', content: JSON.stringify(content) }],
      stats: { input_tokens: p, total_output_tokens: c, reasoning_output_tokens: 0, tokens_per_second: 10, time_to_first_token_seconds: 0.1 } }
      : { model: body.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
        usage: { prompt_tokens: p, completion_tokens: c, total_tokens: p + c } };
    const call = { role, url, request, body, native, modelPayload, operation, envelope }; requests.push(call);
    return onRequest ? onRequest(call, () => lane) : new Response(JSON.stringify(envelope));
  };
  lane = createReviewedLiveModelLaneWithTransportV3(input, { author: transport('author'), reviewer: transport('reviewer') }, now);
  const run = ({ signal, beforeCheck } = {}) => runWorkflow(fixture.task, { ...(signal ? { signal } : {}), adapters: {
    authorizeContext: lane.authorizeContext, author: lane.author, reviewers: lane.reviewers,
    staticChecks: { check(p) { checks.push(p.binding); beforeCheck?.(p); return { status: 'PASS', evidence: { ...p.binding, findings: [], reason: '' } }; } },
    tests: { run(p) {
      tests.push(p.binding); const baseline = p.binding.candidateFingerprint === fixture.preparations[0].candidateFingerprint;
      return { status: baseline ? 'FAIL' : 'PASS', evidence: { ...p.binding, assertionsExecuted: 10,
        assertionsPassed: baseline ? 9 : 10, failures: baseline ? [{ code: 'SYNTHETIC_ZERO', message: 'Synthetic baseline failure' }] : [],
        reason: baseline ? 'Synthetic failure' : '' } };
    } },
  } });
  return { fixture, input, lane, requests, checks, tests, run };
}
