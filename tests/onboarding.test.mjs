import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNodeVersion } from '../scripts/require-node.cjs';
import { parseLocalModelCLI, runLocalModelExample } from '../examples/local-model-workflow.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const example = path.join(here, '../examples/local-model-workflow.mjs');

test('Node preflight validates actual process.version and rejects unsupported versions', () => {
  assert.equal(validateNodeVersion(process.version).ok, true);
  assert.equal(validateNodeVersion('v21.9.0').code, 'NODE_VERSION_TOO_OLD');
  for (const version of ['not-node', 'v22', 'v22.0', 'v22.x.0', 'v22.0.0-rc.1', null]) assert.equal(validateNodeVersion(version).code, 'NODE_VERSION_INVALID');
  for (const version of ['v22.0.0', 'v24.18.0']) assert.equal(validateNodeVersion(version).ok, true);
});

test('CLI parser is pure, requires exactly three arguments, and validates endpoint/model config', () => {
  let fetchCalls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error('must not fetch'); };
  try {
    assert.deepEqual(parseLocalModelCLI(['http://127.0.0.1:1234/v1/chat/completions', 'draft', 'review']), {
      endpoint: 'http://127.0.0.1:1234/v1/chat/completions', authorModel: 'draft', reviewerModel: 'review',
    });
    for (const args of [[], ['http://127.0.0.1/x'], ['http://127.0.0.1/x', 'draft'], ['http://127.0.0.1/x', 'a', 'b', 'extra']]) {
      assert.throws(() => parseLocalModelCLI(args), /Usage:/);
    }
    for (const args of [
      ['http://127.0.0.1/x', '', 'review'], ['http://127.0.0.1/x', 'draft', '  '],
      ['http://127.0.0.1/x', 'same', 'same'], ['https://127.0.0.1/x', 'draft', 'review'],
      ['http://localhost/x', 'draft', 'review'], ['bad-url', 'draft', 'review'],
      ['http://user:password@127.0.0.1/x', 'draft', 'review'], ['http://127.0.0.1/x?q=1', 'draft', 'review'],
      ['http://127.0.0.1/x#fragment', 'draft', 'review'], ['http://127.0.0.1/x', 'same', ' same '], ['http://10.0.0.2/x', 'draft', 'review'],
    ]) assert.throws(() => parseLocalModelCLI(args), /Usage:/);
  } finally { globalThis.fetch = original; }
  assert.equal(fetchCalls, 0);
  assert.deepEqual(parseLocalModelCLI(['http://[::1]:1234/x', ' author ', ' review ']), {endpoint:'http://[::1]:1234/x', authorModel:'author', reviewerModel:'review'});
});

test('programmatic example API remains callable with injected deterministic transport', async () => {
  let calls = 0;
  const fetch = async (_url, request) => {
    calls += 1;
    const body = JSON.parse(request.body);
    const content = body.model === 'author'
      ? { candidate: { files: [{ path: 'retry-config.json', content: '{"backoff":"exponential","maxRetries":3,"retryDelayMs":250}' }] }, note: 'draft' }
      : { findings: [], summary: 'checked the candidate and supplied evidence' };
    const envelope = { model: body.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] };
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    return { ok: true, body: { getReader() { let done = false; return { async read() { if (done) return { done: true }; done = true; return { done: false, value: bytes }; }, releaseLock() {} }; } } };
  };
  const result = await runLocalModelExample({ endpoint: 'http://127.0.0.1:1234/v1/chat/completions', authorModel: 'author', reviewerModel: 'review', fetch, timeoutMs: 5000 });
  assert.equal(result.report.outcome, 'COMPLETED');
  assert.equal(calls, 2);
});

test('real CLI exits 2 for invalid argument and never reaches inference', () => {
  const result = spawnSync(process.execPath, [example, 'https://127.0.0.1/x', 'draft', 'review'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Invalid local chat configuration/);
  assert.match(result.stderr, /Usage:/);
  assert.equal(result.stdout, '');
});
