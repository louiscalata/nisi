// Owner-authored acceptance. Executor output is read as JSON data, never imported/executed.
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandidate, createTaskSpecification } from '../workflow/contracts.mjs';
import { strictJSON, createLocalChatAuthorAdapter, createLocalChatReviewerAdapter } from '../adapters/local-chat.mjs';
import { expectedCases } from './helpers/local-chat-expected-cases.mjs';

const bytes = fs.readFileSync(new URL('./fixtures/local-chat-response-cases.json', import.meta.url));
assert.ok(bytes.byteLength > 0 && bytes.byteLength <= 65536, 'bounded fixture data');
const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
strictJSON(text); // Reject duplicate keys in the outer fixture file as well.
const cases = JSON.parse(text);
const task = createTaskSpecification({ taskId: 'output.fixture', mode: 'edit', language: 'javascript', allowedFiles: ['a.mjs'], protectedFiles: [], protectedSnapshots: {}, acceptanceCriteria: ['fixed output-shape fixture'], policy: { repairBudget: 1, totalDeadlineMs: 1000, requiredReviewers: 1, requireReportStore: false } });
const candidate = createCandidate({ files: [{ path: 'a.mjs', content: 'export const value = 1;' }] }, { authorId: 'fixture.author' });

test('JSON contains the exact twelve ordered closed records with no omitted or extra data', () => {
  assert.equal(Array.isArray(cases), true);
  assert.equal(cases.length, 12);
  assert.equal(new Set(cases.map(record => record.id)).size, 12);
  assert.deepEqual(cases, expectedCases);
  for (const record of cases) assert.deepEqual(Object.keys(record).sort(), ['content', 'expectedCode', 'id', 'operation', 'resultStatus']);
});
test('duplicate, malformed and empty cases retain their distinct final-content intent', () => {
  const duplicate = cases.find(record => record.id === 'repair-duplicate-key');
  assert.equal(JSON.parse(duplicate.content).note, 'two');
  assert.throws(() => strictJSON(duplicate.content), { code: 'LOCAL_CHAT_JSON_DUPLICATE_KEY' });
  assert.throws(() => JSON.parse(cases.find(record => record.id === 'repair-malformed-json').content), SyntaxError);
  assert.equal(cases.find(record => record.id === 'repair-empty-final').content, '');
});
for (const outputMode of ['json_schema', 'json_instruction']) for (const expected of expectedCases) test('injected final-content result: ' + outputMode + '/' + expected.id, async () => {
  const record = cases.find(item => item.id === expected.id);
  assert.deepEqual(record, expected);
  const binding = { schemaVersion: 1, runId: 'run.fixture', taskFingerprint: 'task.fixture', attempt: 1, candidateFingerprint: candidate.fingerprint };
  const payload = { task, candidate, acceptanceCriteria: task.acceptanceCriteria, binding, stages: [], signal: new AbortController().signal, reviewerId: 'fixture.reviewer',
    checks: { status: 'PASS', evidence: { ...binding, findings: [], reason: '' } },
    tests: { status: 'PASS', evidence: { ...binding, assertionsExecuted: 1, assertionsPassed: 1, failures: [], reason: '' } },
  };
  let requests = 0;
  const factory = record.operation === 'repair' ? createLocalChatAuthorAdapter : createLocalChatReviewerAdapter;
  const adapter = factory({ endpoint: 'http://127.0.0.1:1/v1/chat/completions', destination: 'LOOPBACK_HTTP', model: 'injected-fixture-only', id: record.operation === 'repair' ? 'fixture.author' : 'fixture.reviewer', timeoutMs: 1000, outputMode,
    fetch: (_url, request) => {
      requests += 1;
      const body = JSON.parse(request.body);
      assert.equal(body.model, 'injected-fixture-only');
      assert.equal(Object.hasOwn(body, 'response_format'), outputMode === 'json_schema');
      if (outputMode === 'json_schema') assert.equal(body.response_format.type, 'json_schema');
      return new Response(JSON.stringify({ model: 'injected-fixture-only', choices: [{ finish_reason: 'stop', message: { content: record.content } }] }));
    },
  });
  if (record.expectedCode === null) {
    const result = await adapter[record.operation](payload);
    assert.equal(result.status, record.resultStatus);
    assert.equal(adapter.receipts()[0].status, 'RESPONSE_VALIDATED');
  } else {
    await assert.rejects(adapter[record.operation](payload), { code: record.expectedCode });
    assert.equal(adapter.receipts()[0].status, 'UNAVAILABLE');
    assert.equal(adapter.receipts()[0].code, record.expectedCode);
  }
  assert.equal(requests, 1);
  assert.equal(adapter.receipts()[0].schemaVersion, 2);
  assert.equal(adapter.receipts()[0].outputMode, outputMode);
  assert.equal(adapter.receipts()[0].usage, null);
});
