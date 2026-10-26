import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runtime = resolve(process.env.NISI_TEST_RUNTIME ?? fileURLToPath(new URL('..', import.meta.url)));
const { createLocalChatReviewerAdapter, createLocalChatAuthorAdapter } = await import(pathToFileURL(`${runtime}/adapters/local-chat.mjs`));
const { createOpenCodeLocalOrchestrator } = await import(pathToFileURL(`${runtime}/hosts/local-models/opencode-orchestration-v1.mjs`));
const summaryFixture = readFileSync(new URL('./fixtures/reviewer-summary-refusal-20260929/public-pages-summary.txt', import.meta.url), 'utf8');
const refusal = 'LOCAL_CHAT_REVIEW_SUMMARY_REPETITIVE';
const task = mode => ({ taskId: 'repetition.fixture', mode, language: 'javascript', allowedFiles: ['src/a.js'],
  protectedFiles: [], protectedSnapshots: {}, acceptanceCriteria: ['Export the number 1.'],
  policy: { repairBudget: 0, totalDeadlineMs: 10000, requiredReviewers: 1, requireReportStore: false } });
const candidate = { files: [{ path: 'src/a.js', content: 'export default 1;' }] };
const payload = { task: task('review'), candidate, acceptanceCriteria: ['Export the number 1.'],
  binding: { schemaVersion: 1, runId: 'repetition.fixture', taskFingerprint: 'a'.repeat(64), attempt: 0, candidateFingerprint: 'b'.repeat(64) } };
const json = value => new Response(JSON.stringify(value), { status: 200 });
const complete = (model, content) => json({ model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });
function reviewer(summary, findings = []) {
  let calls = 0;
  const adapter = createLocalChatReviewerAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    id: 'fixture.reviewer', model: 'fixture/reviewer', outputMode: 'json_schema',
    fetch: async (_url, options) => { calls += 1; return complete(JSON.parse(options.body).model, { summary, findings }); } });
  return { adapter, calls: () => calls };
}
async function rejected(summary, findings = []) {
  const { adapter, calls } = reviewer(summary, findings);
  await assert.rejects(adapter.review(payload), error => error.code === refusal);
  assert.equal(calls(), 1, 'no automatic retry');
  assert.equal(adapter.receipts().length, 1);
  assert.equal(adapter.receipts()[0].status, 'UNAVAILABLE');
  assert.equal(adapter.receipts()[0].code, refusal);
}
async function admitted(summary, findings = []) {
  const { adapter } = reviewer(summary, findings);
  const result = await adapter.review(payload);
  assert.equal(result.status, findings.length ? 'FAIL' : 'PASS');
  assert.equal(result.evidence.summary, summary);
  assert.deepEqual(result.evidence.findings.map(({ code, message }) => ({ code, message })), findings);
}

test('exact saved public-pages summary is refused despite stop reason and valid schema', async () => {
  assert.equal(summaryFixture.length, 4096);
  assert.equal((summaryFixture.match(/Prompt\//g) ?? []).length, 481);
  assert.equal(summaryFixture.includes('@'), false);
  await rejected(summaryFixture);
});
test('normal no-findings review still passes', () => admitted('Inspected the export and its literal value; no issue found.'));
test('normal findings remain FAIL with original evidence', () => admitted('The export has the wrong value.', [{ code: 'WRONG_VALUE', message: 'Expected 1, found 2.' }]));
test('ordinary repeated terminology and short quoted repetition are admitted', () => admitted('The request validates input; the response validates output. Input and output remain distinct. The fixture quotes Prompt/Prompt/Prompt/ as data.'));
test('repetitive summary with findings is unavailable, not a trustworthy FAIL', () => rejected(summaryFixture, [{ code: 'BUG', message: 'Inspect the export.' }]));
test('single-character degeneration and repeated punctuation are refused', async () => {
  await rejected('x'.repeat(256));
  await rejected('?!'.repeat(128));
});
test('Unicode periodic degeneration is detected by code points', () => rejected('λ🙂'.repeat(128)));
test('255 repeated characters remain below the minimum run', () => admitted('x'.repeat(255)));
test('256-character run is refused above half but admitted at exactly half', async () => {
  const distinct = Array.from({ length: 256 }, (_, i) => String.fromCodePoint(0x400 + i)).join('');
  await admitted('x'.repeat(256) + distinct);
  await rejected('x'.repeat(256) + distinct.slice(0, 255));
});
test('16 repetitions of a 32-character unit refuse; 15 do not', async () => {
  const unit = 'abcdefghijklmnopqrstuvwxyz012345';
  await admitted(unit.repeat(15));
  await rejected(unit.repeat(16));
});
test('33-character periodic unit is now refused', () => rejected('abcdefghijklmnopqrstuvwxyz0123456'.repeat(16)));
test('candidate code and author note are not subject to reviewer-prose guard', async () => {
  const output = { candidate: { files: [{ path: 'src/a.js', content: '// x\n'.repeat(400) }] }, note: 'Prompt/'.repeat(100) };
  const adapter = createLocalChatAuthorAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    model: 'fixture/author', id: 'fixture.author', fetch: async () => complete('fixture/author', output) });
  const result = await adapter.draft({ ...payload, task: task('edit'), candidate: null });
  assert.equal(result.evidence.note, output.note);
  assert.equal(result.candidate.files[0].content, output.candidate.files[0].content);
});
test('orchestrator propagates named summary refusal and preserves recovery without retry', async () => {
  const calls = [];
  const host = createOpenCodeLocalOrchestrator({ fetch: async (url, options) => {
    calls.push(options.method);
    if (url.endsWith('/api/v1/models')) return json({ models: [{ key: 'fixture/reviewer', display_name: 'Fixture reviewer', type: 'llm', loaded_instances: [{ id: 'fixture/reviewer' }] }] });
    assert.equal(url, 'http://127.0.0.1:1234/v1/chat/completions');
    return complete('fixture/reviewer', { findings: [], summary: summaryFixture });
  } });
  const result = await host.work({ runId: 'repetition.fixture', task: task('review'), mode: 'review', reviewerModel: 'fixture/reviewer', candidate, outputMode: 'json_schema' });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.code, refusal);
  assert.equal(result.review, null);
  assert.equal(result.accepted, false);
  assert.equal(result.independentReviewerCount, 0);
  assert.equal(result.recoveryRequired, true);
  assert.equal(result.receipts[0].code, refusal);
  assert.deepEqual(calls, ['GET', 'POST']);
});

const liveSummary = readFileSync(new URL('./fixtures/reviewer-summary-refusal-20260929/live-review-summary.txt', import.meta.url), 'utf8');
test('exact live sentence repetition is refused over the installed 44f1 baseline', async () => {
  assert.equal(liveSummary.length, 4096);
  assert.equal(liveSummary.includes('@'), false);
  const unit = liveSummary.slice(2025, 2094);
  assert.equal(unit.length, 69);
  assert.equal(liveSummary.slice(2025, 4095), unit.repeat(30));
  await rejected(liveSummary);
});
test('maximum feasible 256-character unit refuses 16 repeats but admits 15', async () => {
  const unit = Array.from({ length: 256 }, (_, i) => String.fromCodePoint(0x400 + i)).join('');
  await admitted(unit.repeat(15));
  await rejected(unit.repeat(16));
});
