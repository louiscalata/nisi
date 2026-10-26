// PRIVATE fixed injected-response tests. No HTTP server, real fetch, model, child or native process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandidate, createTaskSpecification } from 'nisi';
import { createLocalChatAuthorAdapter, createLocalChatReviewerAdapter } from 'nisi/adapters/local-chat';

const endpoint = 'http://127.0.0.1:1/v1/chat/completions';
const model = 'injected-only';
const raw = { files: [{ path: 'a.mjs', content: 'export default 1;' }] };
const candidate = createCandidate(raw, { authorId: 'author.one' });
const task = createTaskSpecification({ taskId: 'consumer.regression', mode: 'edit', language: 'javascript', allowedFiles: ['a.mjs'], protectedFiles: [], protectedSnapshots: {}, acceptanceCriteria: ['supplied fixture only'], policy: { repairBudget: 1, totalDeadlineMs: 1000, requiredReviewers: 1, requireReportStore: false } });
const noChange = { status: 'NO_CHANGE', candidate: null, note: 'fixed no-change response' };
function payload(fingerprint = candidate.fingerprint) {
  const binding = { schemaVersion: 1, runId: 'run.fixture', taskFingerprint: 'task.fixture', attempt: 1, candidateFingerprint: fingerprint };
  return { task, candidate, acceptanceCriteria: task.acceptanceCriteria, binding, signal: new AbortController().signal, stages: [], reviewerId: 'reviewer.one',
    checks: { status: 'PASS', evidence: { ...binding, findings: [], reason: '' } },
    tests: { status: 'PASS', evidence: { ...binding, assertionsExecuted: 1, assertionsPassed: 1, failures: [], reason: '' } },
  };
}
function fixtureAdapter(role, output) {
  const calls = [];
  const factory = role === 'author' ? createLocalChatAuthorAdapter : createLocalChatReviewerAdapter;
  const adapter = factory({ endpoint, destination: 'LOOPBACK_HTTP', model, id: role + '.one', timeoutMs: 1000,
    // Deliberately synchronous: no use of global fetch and no network fallback.
    fetch(url, request) {
      calls.push({ url, request });
      assert.equal(url, endpoint);
      assert.equal(request.method, 'POST');
      assert.equal(request.redirect, 'error');
      assert.equal(request.signal instanceof AbortSignal, true);
      assert.deepEqual(request.headers, { 'content-type': 'application/json', accept: 'application/json' });
      const body = JSON.parse(request.body);
      assert.equal(body.model, model);
      assert.equal(body.stream, false);
      return new Response(JSON.stringify({ model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }));
    },
  });
  return { adapter, calls };
}
function receiptFor(adapter, fingerprint) {
  const receipts = adapter.receipts();
  assert.equal(receipts.length, 1);
  const receipt = receipts[0];
  assert.equal(receipt.status, 'RESPONSE_VALIDATED');
  assert.equal(receipt.inputCandidateFingerprint, fingerprint);
  assert.equal(receipt.candidateFingerprint, fingerprint);
  assert.equal(receipt.resultCandidateFingerprint, fingerprint);
  assert.equal(receipt.usage, null);
  assert.equal(receipt.lifecycle.transportSettlement, 'CONFIRMED');
  assert.equal(receipt.lifecycle.remoteInferenceStopped, 'NOT_OBSERVED');
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(adapter.lifecycle().state, 'IDLE');
}

test('normalized candidate metadata is refused as raw input but explicit files reuse succeeds', () => {
  assert.throws(() => createCandidate(candidate, { authorId: 'author.one' }), { code: 'CANDIDATE_SCHEMA' });
  assert.equal(createCandidate({ files: candidate.files }, { authorId: 'author.one' }).fingerprint, candidate.fingerprint);
});

test('synchronous injected NO_CHANGE preserves a candidate-bound string fingerprint', async () => {
  const { adapter, calls } = fixtureAdapter('author', noChange);
  const result = await adapter.repair(payload());
  assert.equal(calls.length, 1);
  assert.equal(result.status, 'NO_CHANGE');
  assert.equal(result.candidate, null);
  assert.equal(result.evidence.baseCandidateFingerprint, candidate.fingerprint);
  assert.equal(result.evidence.candidateFingerprint, candidate.fingerprint);
  assert.equal(Object.isFrozen(result), true);
  receiptFor(adapter, candidate.fingerprint);
});

test('untyped null-bound NO_CHANGE documents unchanged runtime propagation, not a typed valid call', async () => {
  const { adapter, calls } = fixtureAdapter('author', noChange);
  const result = await adapter.repair(payload(null));
  assert.equal(calls.length, 1);
  assert.equal(result.status, 'NO_CHANGE');
  assert.equal(result.evidence.baseCandidateFingerprint, null);
  assert.equal(result.evidence.candidateFingerprint, null);
  receiptFor(adapter, null);
});

test('untyped null-bound review likewise documents runtime propagation outside the declaration boundary', async () => {
  const { adapter, calls } = fixtureAdapter('reviewer', { findings: [], summary: 'supplied response, not model participation' });
  const result = await adapter.review(payload(null));
  assert.equal(calls.length, 1);
  assert.equal(result.status, 'PASS');
  assert.equal(result.evidence.candidateFingerprint, null);
  receiptFor(adapter, null);
});
