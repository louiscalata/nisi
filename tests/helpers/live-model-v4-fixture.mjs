// Synthetic V4 model transport and workflow fixture. No server/native-code execution.
import { runWorkflow } from '../../workflow/engine.mjs';
import { createReviewedLiveFixtureV1 } from '../../examples/repository-task/reviewed-live-fixture-v1.mjs';
import { registerRepairGuidanceV1 } from '../../adapters/repair-guidance-v1.mjs';
import { createReviewedLiveModelLaneWithTransportV4 as create } from '../../hosts/repository/reviewed-live-model-v4.mjs';
import { selection } from './live-model-v3-fixture.mjs';

export async function context({ api = 'NATIVE_API', reviewerApi = api, arm = 'ON', variant = 'repair', now = () => 100, onRequest, configure = () => {} } = {}) {
  const fixture = await createReviewedLiveFixtureV1(), requests = [];
  const treatment = registerRepairGuidanceV1({ arm, api, binding: { taskFingerprint: fixture.preparations[0].taskFingerprint,
    baselineFingerprint: fixture.baseline.fingerprint, suiteFingerprint: fixture.suite.fingerprint,
    reviewedSourceFingerprint: fixture.reviewedSourceFingerprint } });
  const input = { suite: fixture.suite, reviewedSourceFingerprint: fixture.reviewedSourceFingerprint,
    author: selection('author', api), reviewer: selection('reviewer', reviewerApi), arm, treatment,
    timeoutMs: 1000, maxOutputTokens: 512, approval: { id: 'synthetic.approval', expiresAtMs: 10000 } };
  configure(input);
  const transport = role => async (_url, request) => {
    const body = JSON.parse(request.body), native = input[role].api === 'NATIVE_API', operation = role === 'author' ? 'repair' : 'review';
    const candidate = variant === 'third' ? { files: [{ path: 'retry-settings.mjs', content: 'throw Error("unreviewed")' }] }
      : { files: fixture.preparations[variant === 'baseline' ? 0 : 1].candidate.files };
    const output = role === 'reviewer' ? { findings: [], summary: 'Synthetic review' }
      : { status: variant === 'no-change' ? 'NO_CHANGE' : 'REPAIRED', candidate: variant === 'no-change' ? null : candidate, note: 'Synthetic response' };
    const result = native ? { model_instance_id: input[role].expectedModelInstance, output: [{ type: 'message', content: JSON.stringify(output) }],
      stats: { input_tokens: 10, total_output_tokens: 5, reasoning_output_tokens: 0, tokens_per_second: 10, time_to_first_token_seconds: 0.1 } }
      : { model: body.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    const captured = { role, body, request, operation }; requests.push(captured);
    return onRequest ? onRequest(captured, result) : new Response(JSON.stringify(result));
  };
  const transports = { author: transport('author'), reviewer: transport('reviewer') }, lane = create(input, transports, now);
  const run = () => runWorkflow(fixture.task, { adapters: { authorizeContext: lane.authorizeContext,
    author: lane.author, reviewers: lane.reviewers,
    staticChecks: { check: p => ({ status: 'PASS', evidence: { ...p.binding, findings: [], reason: '' } }) },
    tests: { run: p => {
      const pass = p.binding.candidateFingerprint === fixture.preparations[1].candidateFingerprint;
      return { status: pass ? 'PASS' : 'FAIL', evidence: { ...p.binding, assertionsExecuted: 1, assertionsPassed: pass ? 1 : 0,
        failures: pass ? [] : [{ code: 'SYNTHETIC', message: 'Synthetic baseline failure' }], reason: pass ? '' : 'Synthetic failure' } };
    } },
  } });
  return { fixture, input, treatment, requests, transports, lane, run };
}
