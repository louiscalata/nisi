import { createCandidate, createTaskSpecification, sha256Text, stableStringify } from '../../workflow/contracts.mjs';
export const task = createTaskSpecification({ taskId: 'native.fixture', mode: 'edit', language: 'javascript',
  allowedFiles: ['src/a.mjs'], protectedFiles: [], protectedSnapshots: {}, acceptanceCriteria: ['Return zero unchanged'],
  policy: { repairBudget: 1, totalDeadlineMs: 1000, requiredReviewers: 1, requireReportStore: false } });
export const taskFingerprint = sha256Text(`nisi/workflow-task/v1\0${stableStringify(task)}`);
export const candidate = createCandidate({ files: [{ path: 'src/a.mjs', content: 'export const x=1;' }] }, { authorId: 'synthetic.author' });
export const payload = (operation = 'repair') => ({ task, acceptanceCriteria: task.acceptanceCriteria,
  candidate: operation === 'draft' ? null : candidate,
  binding: { schemaVersion: 1, runId: 'native-fixture-run', taskFingerprint, attempt: operation === 'draft' ? 0 : 1,
    candidateFingerprint: operation === 'draft' ? null : candidate.fingerprint } });
export const output = operation => operation === 'review' ? { findings: [], summary: 'Reviewed the supplied source' }
  : { ...(operation === 'repair' ? { status: 'REPAIRED' } : {}),
    candidate: { files: [{ path: 'src/a.mjs', content: 'export const x=0;' }] }, note: 'Preserve zero' };
export const envelope = (content = JSON.stringify(output('repair'))) => ({ model_instance_id: 'synthetic.instance',
  output: [{ type: 'message', content }], stats: { input_tokens: 10, total_output_tokens: 5, reasoning_output_tokens: 0,
    tokens_per_second: 10, time_to_first_token_seconds: 0.1 } });
export const config = (fetch, extra = {}) => ({ destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:1234/api/v1/chat',
  model: 'synthetic.model', expectedModelInstance: 'synthetic.instance', id: 'synthetic.adapter', reasoning: 'off',
  maxOutputTokens: 128, timeoutMs: 1000, fetch, ...extra });
export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
export const tick = () => new Promise(resolve => setImmediate(resolve));
