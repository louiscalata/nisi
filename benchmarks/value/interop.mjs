// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// Synthetic inference-interface adaptation specimens. No provider is contacted.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runWorkflow } from '../../workflow/engine.mjs';
import { createCandidate } from '../../workflow/contracts.mjs';
import { createLocalChatAuthorAdapter, createLocalChatReviewerAdapter } from '../../adapters/local-chat.mjs';
import { makeFixture, scenarios, semanticOracle } from './fixtures.mjs';
import { scoreRun } from './score.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sourceFiles = [
  'benchmarks/value/interop.mjs', 'tests/value-interop.test.mjs',
  'benchmarks/value/fixtures.mjs', 'benchmarks/value/score.mjs',
  'benchmarks/value/PROTOCOL.md',
  'workflow/engine.mjs', 'workflow/contracts.mjs', 'adapters/local-chat.mjs',
];
const answer = value => ({ files: [{ path: 'answer.json', content: JSON.stringify({ answer: value }) }] });
const answerFor = (scenario, operation) => scenario === 'repair-test' && operation === 'draft' ? 41 : 42;
const produced = (scenario, operation) => operation === 'review'
  ? { findings: [], summary: 'Synthetic review of supplied host evidence.' }
  : operation === 'repair'
    ? { status: 'REPAIRED', candidate: answer(answerFor(scenario, operation)), note: 'Synthetic repair transcript.' }
    : { candidate: answer(answerFor(scenario, operation)), note: 'Synthetic draft transcript.' };

function authorFromText(id, getText) {
  const parse = async (operation, payload) => {
    const output = JSON.parse(await getText(operation, payload));
    if (!output || typeof output !== 'object') throw new Error('Synthetic output must be an object.');
    if (operation === 'draft') {
      const candidate = output.candidate;
      return { candidate, evidence: { ...payload.binding,
        candidateFingerprint: createCandidate(candidate, { authorId: id }).fingerprint,
        note: output.note } };
    }
    const candidate = output.candidate;
    return { status: output.status, candidate, evidence: { ...payload.binding,
      candidateFingerprint: candidate ? createCandidate(candidate, { authorId: id }).fingerprint : payload.binding.candidateFingerprint,
      baseCandidateFingerprint: payload.binding.candidateFingerprint, note: output.note } };
  };
  return { id, draft: payload => parse('draft', payload), repair: payload => parse('repair', payload) };
}

async function aggregateText(stream) {
  let value = '';
  for await (const chunk of stream) {
    if (typeof chunk !== 'string') throw new Error('Synthetic stream chunk is not text.');
    value += chunk;
    if (value.length > 1_048_576) throw new Error('Synthetic stream exceeded host cap.');
  }
  return value;
}

function fakeChatFetch(scenario, requests) {
  return async (url, request) => {
    if (url !== 'http://127.0.0.1:9999/v1/chat/completions' || request.method !== 'POST' ||
        request.redirect !== 'error' || request.headers?.['content-type'] !== 'application/json') {
      throw new Error('Unexpected synthetic Chat Completions request.');
    }
    const wire = JSON.parse(request.body);
    const user = JSON.parse(wire.messages?.[1]?.content ?? 'null');
    const operation = user?.operation;
    if (!['draft', 'repair', 'review'].includes(operation) || wire.stream !== false || wire.temperature !== 0 ||
        wire.response_format?.type !== 'json_schema' || wire.response_format.json_schema?.name !== `nisi_${operation}` ||
        wire.response_format.json_schema?.strict !== true ||
        wire.model !== (operation === 'review' ? 'synthetic.reviewer' : 'synthetic.author') ||
        !Number.isSafeInteger(wire.max_tokens) || wire.max_tokens < 1) {
      throw new Error('Unexpected synthetic Chat Completions wire body.');
    }
    requests.push({ operation, model: wire.model, stream: wire.stream,
      format: wire.response_format.type, schemaName: wire.response_format.json_schema.name });
    const envelope = { model: wire.model, choices: [{ finish_reason: 'stop',
      message: { content: JSON.stringify(produced(scenario, operation)) } }] };
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    return { ok: true, body: { getReader() {
      let sent = false;
      return { async read() { if (sent) return { done: true }; sent = true; return { done: false, value: bytes }; },
        async cancel() {}, releaseLock() {} };
    } } };
  };
}

function instrument(fixture, name, fn) {
  return async payload => {
    const event = phase => fixture.events.push({ name, phase, attempt: payload.binding.attempt,
      candidateFingerprint: payload.binding.candidateFingerprint });
    event('started');
    try { return await fn(payload); }
    finally { event('settled'); }
  };
}

function instrumentAuthor(fixture, author) {
  return { id: author.id,
    draft: instrument(fixture, 'draft', author.draft.bind(author)),
    repair: instrument(fixture, 'repair', author.repair.bind(author)) };
}

function makeAdapters(interfaceName, scenario, fixture, requests) {
  const adapters = fixture.options.adapters;
  if (interfaceName === 'callback-json') {
    // An existing synchronous callback supplies JSON text to the host wrapper.
    const callback = operation => JSON.stringify(produced(scenario, operation));
    adapters.author = authorFromText('benchmark.author', (operation, payload) => callback(operation, payload));
  } else if (interfaceName === 'promise-text') {
    // Injected inference service, represented only by a fulfilled Promise.
    const inferenceService = { complete: operation => Promise.resolve(JSON.stringify(produced(scenario, operation))) };
    adapters.author = authorFromText('benchmark.author', operation => inferenceService.complete(operation));
  } else if (interfaceName === 'host-text-stream') {
    // The host, not the released chat adapter, aggregates an async text iterable.
    const service = { async *stream(operation) {
      const text = JSON.stringify(produced(scenario, operation));
      const middle = Math.floor(text.length / 2);
      yield text.slice(0, middle);
      yield text.slice(middle);
    } };
    adapters.author = authorFromText('benchmark.author', operation => aggregateText(service.stream(operation)));
  } else if (interfaceName === 'local-chat-fake-fetch') {
    const fetch = fakeChatFetch(scenario, requests);
    adapters.author = createLocalChatAuthorAdapter({ destination: 'LOOPBACK_HTTP',
      endpoint: 'http://127.0.0.1:9999/v1/chat/completions', model: 'synthetic.author',
      id: 'benchmark.author', fetch });
    const reviewer = createLocalChatReviewerAdapter({ destination: 'LOOPBACK_HTTP',
      endpoint: 'http://127.0.0.1:9999/v1/chat/completions', model: 'synthetic.reviewer',
      id: 'benchmark.reviewer', fetch });
    adapters.reviewers = [{ id: reviewer.id, review: instrument(fixture, 'review', reviewer.review.bind(reviewer)) }];
  } else throw new Error(`Unknown interface: ${interfaceName}`);
  adapters.author = instrumentAuthor(fixture, adapters.author);
  return adapters;
}

const interfaces = Object.freeze(['callback-json', 'promise-text', 'host-text-stream', 'local-chat-fake-fetch']);

const traceSteps = entries => entries.flatMap(name => [{ name, phase: 'started' }, { name, phase: 'settled' }]);
const expectedNegativeTrace = traceSteps(['authorize', 'draft']);
const expectedPositiveTrace = scenario => traceSteps(scenario === 'repair-test'
  ? ['authorize', 'draft', 'static', 'test', 'repair', 'static', 'test', 'review']
  : ['authorize', 'draft', 'static', 'test', 'review']);
const actualTraceSteps = fixture => fixture.events.map(({ name, phase }) => ({ name, phase }));

export function scoreInteropCase(caseId, interfaceName, scenario, report, requests, fixture) {
  const negative = caseId.startsWith('negative-');
  const expectedOutcome = negative ? 'BLOCKED' : 'COMPLETED';
  const expectedRepairs = scenario === 'repair-test' && !negative ? 1 : 0;
  const terminal = report.repairAttempts;
  const fresh = stage => report.stages.some(item => item.stage === stage && item.status === 'PASS' &&
    item.evidence.attempt === terminal && item.evidence.candidateFingerprint === report.candidateFingerprint);
  const oracleCorrect = semanticOracle(report.candidate);
  const hasFreshGates = ['staticChecks', 'tests', 'review'].every(fresh);
  const expectedWireOperations = scenario === 'repair-test' ? ['draft', 'repair', 'review'] : ['draft', 'review'];
  const wireValid = interfaceName !== 'local-chat-fake-fetch' ||
    JSON.stringify(requests.map(item => item.operation)) === JSON.stringify(expectedWireOperations);
  const specimen = scenarios.find(item => item.id === scenario);
  const independentScore = negative ? null : scoreRun(specimen, 'nisi', report, fixture);
  const traceValid = JSON.stringify(actualTraceSteps(fixture)) === JSON.stringify(negative
    ? expectedNegativeTrace : expectedPositiveTrace(scenario));
  const compatible = report.outcome === expectedOutcome && report.repairAttempts === expectedRepairs &&
    traceValid && (negative
      ? report.candidate === null && report.candidateFingerprint === null && !hasFreshGates &&
        JSON.stringify(report.stages.map(stage => stage.stage)) === JSON.stringify(['intake', 'authorizeContext', 'draft'])
      : oracleCorrect === true && hasFreshGates && wireValid && independentScore.scenarioConforms);
  return { caseId, interface: interfaceName, scenario, transport: 'mock', modelCalls: 0,
    modelOrProviderCompatibility: 'UNVERIFIED', streamIntegration: interfaceName === 'host-text-stream' ? 'HOST_AGGREGATED' : 'NONE',
    expectedOutcome, observedOutcome: report.outcome, code: report.code,
    repairAttempts: report.repairAttempts, candidateFingerprint: report.candidateFingerprint,
    oracleCorrect, freshCompletionEvidence: hasFreshGates, wireRequests: requests,
    traceValid, independentScore, trace: fixture.events.map(event => ({ ...event })), report,
    compatibilityStatus: compatible ? (negative ? 'REJECTED_AS_EXPECTED' : 'ADAPTED_IN_SYNTHETIC_TEST') : 'FAILED_CONTROL',
    conforms: compatible };
}

async function runCase(interfaceName, scenario) {
  const fixture = makeFixture(scenario, { repairBudget: 1 });
  const requests = [];
  makeAdapters(interfaceName, scenario, fixture, requests);
  const report = await runWorkflow(fixture.task, fixture.options);
  return scoreInteropCase(`${interfaceName}/${scenario}`, interfaceName, scenario, report, requests, fixture);
}

async function runNegative(kind) {
  const fixture = makeFixture('valid-first', { repairBudget: 1 });
  const service = kind === 'malformed-json'
    ? { complete: () => Promise.resolve('{"candidate":') }
    : { async *stream() { yield '{"candidate":{"files":['; } };
  fixture.options.adapters.author = authorFromText('benchmark.author', () => kind === 'malformed-json'
    ? service.complete() : aggregateText(service.stream()));
  fixture.options.adapters.author = instrumentAuthor(fixture, fixture.options.adapters.author);
  const report = await runWorkflow(fixture.task, fixture.options);
  return scoreInteropCase(`negative-${kind}`, kind === 'malformed-json' ? 'promise-text' : 'host-text-stream',
    'valid-first', report, [], fixture);
}

export async function runInteropMatrix() {
  const rows = [];
  for (const interfaceName of interfaces) for (const scenario of ['valid-first', 'repair-test']) {
    rows.push(await runCase(interfaceName, scenario));
  }
  rows.push(await runNegative('malformed-json'));
  rows.push(await runNegative('truncated-json-stream'));
  return rows;
}

export async function interopSourceManifest() {
  return Object.fromEntries(await Promise.all(sourceFiles.map(async name => [name,
    createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex')])));
}

export function interopMarkdown(result) {
  const rows = result.rows.map(row => `| ${row.caseId} | ${row.observedOutcome} | ${row.repairAttempts} | ${row.compatibilityStatus} |`);
  return `# Nisi inference-interface adaptation matrix\n\nGenerated ${result.createdAt}.\n\n` +
    `All rows invoke the same released runWorkflow with the same authored JSON-answer task family and host acceptance oracle. ` +
    `These are synthetic protocol simulations: transport is mock, model calls are zero, and no named vendor or provider is certified. ` +
    `The async iterable is aggregated and parsed by a custom host adapter; the released local chat adapter is not claimed to accept streams.\n\n` +
    `The truncated-json-stream case checks refusal of incomplete JSON text; it does not test a streaming protocol's completion marker.\n\n` +
    `| Case | Outcome | Repairs | Compatibility status |\n|---|---|---:|---|\n${rows.join('\n')}\n\n` +
    `A COMPLETED result means the injected host checks passed for an authored answer. It does not measure model accuracy. ` +
    `The fake fetch checks the released local chat adapters' Chat Completions request fields and returns a matching synthetic response. ` +
    `Provider delivery, authentication, live inference, usage, and vendor compatibility remain unverified.\n`;
}

export async function main(output) {
  if (!output) throw new Error('Usage: node benchmarks/value/interop.mjs <new-output-directory>');
  await fs.mkdir(output, { recursive: false });
  const createdAt = new Date().toISOString();
  const manifest = { createdAt, environment: { node: process.version, platform: process.platform,
    arch: process.arch, cpu: os.cpus()[0]?.model ?? null, release: os.release() },
    transport: 'mock', modelCalls: 0, sources: await interopSourceManifest() };
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  const result = { createdAt, rows: await runInteropMatrix() };
  await fs.writeFile(path.join(output, 'interop.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  await fs.writeFile(path.join(output, 'REPORT.md'), interopMarkdown(result), { flag: 'wx' });
  const failures = result.rows.filter(row => !row.conforms);
  console.log(JSON.stringify({ output, rows: result.rows.length, modelCalls: 0,
    conformanceFailures: failures.map(row => ({ caseId: row.caseId, code: row.code })) }, null, 2));
  if (failures.length) process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main(process.argv[2]);
