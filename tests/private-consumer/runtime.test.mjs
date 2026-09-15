// PRIVATE fixed import/runtime rehearsal; no native execution or model requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as root from 'nisi';
import * as workflow from 'nisi/workflow';
import * as policy from 'nisi/policy';
import * as serialization from 'nisi/serialization';
import * as apple from 'nisi/adapters/apple-foundation-models';
import * as local from 'nisi/adapters/local-chat';
import { createContentConsent } from 'nisi/gate/content-consent.mjs';
import { canonicalizeJSONV1 } from 'nisi/canonical/canonical-json-v1.mjs';
import { createAFMContentExecutor } from 'nisi/gate/afm-content-executor.mjs';
import { createCandidate as deepCandidate } from 'nisi/workflow/contracts.mjs';

test('named entries and established deep aliases retain factory identity', async () => {
  assert.equal(root.runWorkflow, workflow.runWorkflow);
  assert.equal(root.createFileAccessPolicy, policy.createFileAccessPolicy);
  assert.equal(root.canonicalizeJsonV1, serialization.canonicalizeJsonV1);
  assert.equal(root.createAppleFoundationModelsAdapter, apple.createAppleFoundationModelsAdapter);
  assert.equal(root.createLocalChatAuthorAdapter, local.createLocalChatAuthorAdapter);
  assert.equal(root.createLocalChatReviewerAdapter, local.createLocalChatReviewerAdapter);
  assert.equal(root.createFileAccessPolicy, createContentConsent);
  assert.equal(root.canonicalizeJsonV1, canonicalizeJSONV1);
  assert.equal(root.createAppleFoundationModelsAdapter, createAFMContentExecutor);
  assert.equal(root.createCandidate, deepCandidate);
  assert.equal(Object.hasOwn(root, 'createLocalChatTransportOwner'), false);
  assert.equal(Object.hasOwn(root, 'strictJSON'), false);
  for (const [specifier, expected] of [
    ['nisi/index.mjs', root], ['nisi/workflow/engine.mjs', workflow],
    ['nisi/policy/file-access.mjs', policy], ['nisi/serialization/canonical-json-v1.mjs', serialization],
    ['nisi/adapters/apple-foundation-models.mjs', apple], ['nisi/adapters/local-chat.mjs', local],
  ]) assert.equal(await import(specifier), expected);
  // An export wildcard does not make excluded archive files appear.
  if (process.env.NISI_INSTALLED_ARCHIVE_CHECK === '1')
    for (const specifier of ['nisi/roadmap.md', 'nisi/README.md'])
      await assert.rejects(import(specifier), {code: 'ERR_MODULE_NOT_FOUND'});
});

test('pure canonicalization and refusal paths need no grant native executable or transport', () => {
  assert.equal(root.canonicalizeJsonV1(Buffer.from('{"b":2,"a":1}')).canonical, '{"a":1,"b":2}');
  assert.equal(root.createFileAccessPolicy(Buffer.alloc(0), { clock: () => 0 }).code, 'CONSENT_BYTES_REFUSED');
  assert.equal(root.createAppleFoundationModelsAdapter({}).code, 'BINARY_ARGUMENTS');
  const owner = local.createLocalChatTransportOwner();
  assert.equal(owner.status().state, 'IDLE');
  assert.equal(owner.status().remoteInferenceStopped, 'NOT_OBSERVED');
});

test('fixed in-memory consumer preserves immutable report and candidate semantics', async () => {
  const raw = { files: [{ path: 'a.mjs', content: 'export const a = 1;' }] };
  const prepared = root.createCandidate(raw, { authorId: 'author.one' });
  const task = { taskId: 'consumer.one', mode: 'edit', language: 'javascript', allowedFiles: ['a.mjs'], protectedFiles: [], protectedSnapshots: {}, acceptanceCriteria: ['fixed supplied oracle'], policy: { repairBudget: 0, totalDeadlineMs: 1000, requiredReviewers: 1, requireReportStore: false } };
  const report = await workflow.runWorkflow(task, { adapters: {
    authorizeContext: { authorize: p => ({ status: 'PASS', evidence: { ...p.binding, reason: '' } }) },
    author: { id: 'author.one', draft: p => ({ candidate: raw, evidence: { ...p.binding, candidateFingerprint: prepared.fingerprint, note: 'fixed consumer candidate' } }) },
    staticChecks: { check: p => ({ status: 'PASS', evidence: { ...p.binding, findings: [], reason: '' } }) },
    tests: { run: p => ({ status: 'PASS', evidence: { ...p.binding, assertionsExecuted: 1, assertionsPassed: 1, failures: [], reason: '' } }) },
    reviewers: [{ id: 'reviewer.one', review: p => ({ status: 'PASS', evidence: { ...p.binding, reviewerId: p.reviewerId, findings: [], summary: 'fixed consumer review', reason: '' } }) }]
  } });
  assert.equal(report.outcome, 'COMPLETED');
  assert.equal(report.candidateFingerprint, prepared.fingerprint);
  assert.equal(report.reportStored, false);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.candidate.files), true);
});
