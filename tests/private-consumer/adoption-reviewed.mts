// Codex-authored after a BLOCKED OpenCode attempt. Never execute this file: it is a compile-only example.
import { Buffer } from 'node:buffer';
import { createCandidate, createTaskSpecification, type RunReport } from 'nisi';
import { runWorkflow, type WorkflowAdapters } from 'nisi/workflow';
import { createFileAccessPolicy } from 'nisi/policy';
import { canonicalizeJsonV1 } from 'nisi/serialization';
import { createAppleFoundationModelsAdapter } from 'nisi/adapters/apple-foundation-models';
import { createLocalChatTransportOwner, createLocalChatAuthorAdapter, createLocalChatReviewerAdapter } from 'nisi/adapters/local-chat';
import { canonicalizeJSONV1 } from 'nisi/canonical/canonical-json-v1.mjs';
import { createContentConsent } from 'nisi/gate/content-consent.mjs';
import { createAFMContentExecutor } from 'nisi/gate/afm-content-executor.mjs';
import { cloneFreeze, stableStringify } from 'nisi/workflow/contracts.mjs';
import * as legacyIndex from 'nisi/index.mjs';
import * as legacyWorkflow from 'nisi/workflow/engine.mjs';
import * as legacyPolicy from 'nisi/policy/file-access.mjs';
import * as legacySerialization from 'nisi/serialization/canonical-json-v1.mjs';
import * as legacyApple from 'nisi/adapters/apple-foundation-models.mjs';
import * as legacyChat from 'nisi/adapters/local-chat.mjs';
void [legacyIndex.runWorkflow, legacyWorkflow.runWorkflow, legacyPolicy.createFileAccessPolicy,
  legacySerialization.canonicalizeJsonV1, legacyApple.createAppleFoundationModelsAdapter,
  legacyChat.createLocalChatAuthorAdapter];

export async function compileOnlyExample(grantBytes: Buffer, binary: string, binarySHA256: string): Promise<RunReport> {
  const raw = { files: [{ path: 'a.mjs', content: 'export const a = 1;' }] };
  const candidate = createCandidate(raw, { authorId: 'author.one' });
  const task = createTaskSpecification({ taskId: 'consumer.one', mode: 'edit', language: 'javascript', allowedFiles: ['a.mjs'], protectedFiles: [], protectedSnapshots: {}, acceptanceCriteria: ['fixed supplied oracle'], policy: { repairBudget: 0, totalDeadlineMs: 1000, requiredReviewers: 1, requireReportStore: false } });
  const adapters: WorkflowAdapters = {
    authorizeContext: { authorize: p => ({ status: 'PASS', evidence: { ...p.binding, reason: '' } }) },
    author: { id: 'author.one', draft: async p => ({ candidate: raw, evidence: { ...p.binding, candidateFingerprint: candidate.fingerprint, note: 'fixed candidate' } }) },
    staticChecks: { check: p => ({ status: 'PASS', evidence: { ...p.binding, findings: [], reason: '' } }) },
    tests: { run: async p => ({ status: 'PASS', evidence: { ...p.binding, assertionsExecuted: 1, assertionsPassed: 1, failures: [], reason: '' } }) },
    reviewers: [{ id: 'reviewer.one', review: p => ({ status: 'PASS', evidence: { ...p.binding, reviewerId: p.reviewerId, findings: [], summary: 'fixed review', reason: '' } }) }]
  };
  const report = await runWorkflow(task, { adapters, signal: new AbortController().signal });
  const rendered: string = stableStringify(cloneFreeze(report));
  const normalized: string = canonicalizeJsonV1(Buffer.from('{"a":1}')).canonical;
  const policy = createFileAccessPolicy(grantBytes, { clock: () => 0 });
  if (policy.ok) {
    const executor = createAppleFoundationModelsAdapter({ binary, binarySHA256, grant: policy.grant, items: { 'consumer.one': { filePath: '/private/approved/a.mjs', kind: 'text' } } });
    if (executor.ok) {
      const observed: readonly unknown[] = executor.observations();
      const noAuthority: false = executor.authorizing;
      void [observed, noAuthority, executor.status()];
    }
  }
  const owner = createLocalChatTransportOwner();
  const common = { endpoint: 'http://127.0.0.1:1234/v1/chat/completions', destination: 'LOOPBACK_HTTP', model: 'fixture-model', transportOwner: owner } satisfies Omit<Parameters<typeof createLocalChatAuthorAdapter>[0], 'id'>;
  const author = createLocalChatAuthorAdapter({ ...common, id: 'model.author' });
  const reviewer = createLocalChatReviewerAdapter({ ...common, id: 'model.reviewer' });
  for (const receipt of author.receipts()) {
    if (receipt.status === 'RESPONSE_VALIDATED') {
      const model: string = receipt.reportedModel;
      const count: number | undefined = receipt.usage?.totalTokens;
      void [model, count];
    } else {
      const absent: null = receipt.usage;
      const cause: string = receipt.code;
      void [absent, cause];
    }
  }
  const legacyCodec: typeof canonicalizeJsonV1 = canonicalizeJSONV1;
  const legacyPolicy: typeof createFileAccessPolicy = createContentConsent;
  const legacyApple: typeof createAppleFoundationModelsAdapter = createAFMContentExecutor;
  void [rendered, normalized, reviewer, legacyCodec, legacyPolicy, legacyApple];
  return report;
}
