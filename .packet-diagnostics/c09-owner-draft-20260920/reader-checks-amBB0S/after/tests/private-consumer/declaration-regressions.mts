// PRIVATE compile-only regressions. Never execute this file or its exported function.
import {
  createCandidate, type CandidateInput, type CheckPayload, type RepairPayload,
  type ReviewPayload, type TaskSpecification, type WorkflowAdapters, type WorkflowOptions,
} from 'nisi';
import { validateCandidateForTask } from 'nisi/workflow/contracts.mjs';
import { createLocalChatAuthorAdapter, createLocalChatReviewerAdapter, type LocalChatOptions } from 'nisi/adapters/local-chat';

export function compileOnlyRegressions(task: TaskSpecification, adapters: WorkflowAdapters, repair: RepairPayload, review: ReviewPayload) {
  const raw = { files: [{ path: 'a.mjs', content: 'export default 1;' }] } satisfies CandidateInput;
  const normalized = createCandidate(raw, { authorId: 'author.one' });
  const rawAgain = { files: normalized.files } satisfies CandidateInput;
  createCandidate(rawAgain, { authorId: 'author.one' });
  validateCandidateForTask(rawAgain, task, 'author.one');
  // @ts-expect-error Normalized metadata is forbidden on raw normalization inputs.
  const incorrectRaw: CandidateInput = normalized;
  // @ts-expect-error Passing the library's normalized output back as raw input fails at runtime.
  createCandidate(normalized, { authorId: 'author.one' });
  // @ts-expect-error Task validation normalizes raw files, not an already-normalized candidate.
  validateCandidateForTask(normalized, task, 'author.one');
  // @ts-expect-error Review-mode candidate input is raw, even through a typed variable.
  const incorrectOptions: WorkflowOptions = { adapters, candidate: normalized, candidateAuthorId: 'author.one' };

  const nullBinding = { ...repair.binding, candidateFingerprint: null };
  // @ts-expect-error Candidate-bound checks require a non-null fingerprint.
  const badCheck: CheckPayload = { ...repair, binding: nullBinding };
  // @ts-expect-error Candidate-bound repairs require a non-null fingerprint.
  const badRepair: RepairPayload = { ...repair, binding: nullBinding };
  // @ts-expect-error Candidate-bound reviews require a non-null fingerprint.
  const badReview: ReviewPayload = { ...review, binding: nullBinding };

  const common = { endpoint: 'http://127.0.0.1:1/v1/chat/completions', destination: 'LOOPBACK_HTTP', model: 'injected-only', id: 'author.one' } satisfies LocalChatOptions;
  const synchronous: LocalChatOptions = { ...common, fetch: (endpoint, request) => {
    const url: string = endpoint;
    const body: string = request.body;
    const method: 'POST' = request.method;
    const signal: AbortSignal = request.signal;
    void [url, body, method, signal];
    return new Response('{}');
  } };
  const asynchronous: LocalChatOptions = { ...common, fetch: async () => new Response('{}') };
  const standardFetch: LocalChatOptions = { ...common, fetch: globalThis.fetch };
  const author = createLocalChatAuthorAdapter(synchronous);
  const reviewer = createLocalChatReviewerAdapter({ ...asynchronous, id: 'reviewer.one' });
  // @ts-expect-error Direct local-chat repair cannot bypass the candidate-bound input type.
  author.repair({ ...repair, binding: nullBinding });
  // @ts-expect-error Direct local-chat review cannot bypass the candidate-bound input type.
  reviewer.review({ ...review, binding: nullBinding });
  const currentFingerprint: string = repair.binding.candidateFingerprint;
  author.repair(repair).then(result => {
    const baseFingerprint: string = result.evidence.baseCandidateFingerprint;
    void baseFingerprint;
  });
  void [incorrectRaw, incorrectOptions, badCheck, badRepair, badReview, standardFetch, currentFingerprint];
}
