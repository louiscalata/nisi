// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import { createCandidate, sha256Text } from '../../workflow/contracts.mjs';

// Authored specimens, not independent samples of real tasks or model outputs.
export const scenarios = Object.freeze([
  { id: 'valid-first', family: 'acceptance', expected: 'COMPLETED' },
  { id: 'repair-test', family: 'repair', expected: 'COMPLETED', oneShot: 'FAILED' },
  { id: 'repair-static', family: 'repair', expected: 'COMPLETED', oneShot: 'FAILED' },
  { id: 'repair-review', family: 'repair', expected: 'COMPLETED', oneShot: 'FAILED' },
  { id: 'repair-limit', family: 'repair', expected: 'REPAIR_LIMIT', oneShot: 'FAILED' },
  { id: 'unchanged-repair', family: 'repair', expected: 'NO_PROGRESS', oneShot: 'FAILED' },
  { id: 'repeated-candidate', family: 'repair', expected: 'NO_PROGRESS', oneShot: 'FAILED' },
  { id: 'stale-run', family: 'binding', expected: 'BLOCKED' },
  { id: 'stale-task', family: 'binding', expected: 'BLOCKED' },
  { id: 'stale-candidate', family: 'binding', expected: 'BLOCKED' },
  { id: 'stale-attempt', family: 'binding', expected: 'BLOCKED', oneShot: 'FAILED' },
  { id: 'wrong-reviewer', family: 'binding', expected: 'BLOCKED' },
  { id: 'zero-assertions', family: 'evidence', expected: 'BLOCKED' },
  { id: 'pass-with-finding', family: 'evidence', expected: 'BLOCKED' },
  { id: 'extra-evidence-field', family: 'evidence', expected: 'BLOCKED' },
  { id: 'test-unavailable', family: 'availability', expected: 'BLOCKED' },
  { id: 'review-throws', family: 'availability', expected: 'BLOCKED' },
  { id: 'authorization-denied', family: 'authority', expected: 'BLOCKED' },
  { id: 'out-of-scope', family: 'authority', expected: 'BLOCKED' },
  { id: 'protected-change', family: 'authority', expected: 'BLOCKED' },
  { id: 'deadline-after-call', family: 'lifecycle', expected: 'TIMED_OUT' },
  { id: 'cancel-before-call', family: 'lifecycle', expected: 'CANCELLED' },
  { id: 'store-ack-valid', family: 'storage-ack', expected: 'COMPLETED' },
  { id: 'store-ack-stale', family: 'storage-ack', expected: 'BLOCKED' },
  { id: 'dishonest-pass', family: 'trust-boundary', expected: 'COMPLETED' },
].map(Object.freeze));

// Independent, authored invocation expectations. These are not derived from
// either scheduler's report, so omitted work and work after a stop are visible.
const expectedCalls = Object.freeze({
  'valid-first': 'authorize draft static test review',
  'repair-test': 'authorize draft static test repair static test review',
  'repair-static': 'authorize draft static repair static test review',
  'repair-review': 'authorize draft static test review repair static test review',
  'repair-limit': 'authorize draft static test repair static test repair static test',
  'unchanged-repair': 'authorize draft static test repair',
  'repeated-candidate': 'authorize draft static test repair static test repair',
  'stale-run': 'authorize draft static',
  'stale-task': 'authorize draft static',
  'stale-candidate': 'authorize draft static',
  'stale-attempt': 'authorize draft static test repair static test',
  'wrong-reviewer': 'authorize draft static test review',
  'zero-assertions': 'authorize draft static test',
  'pass-with-finding': 'authorize draft static',
  'extra-evidence-field': 'authorize draft static',
  'test-unavailable': 'authorize draft static test',
  'review-throws': 'authorize draft static test review',
  'authorization-denied': 'authorize',
  'out-of-scope': 'authorize draft',
  'protected-change': 'authorize draft',
  'deadline-after-call': 'authorize',
  'cancel-before-call': '',
  'store-ack-valid': 'authorize draft static test review store',
  'store-ack-stale': 'authorize draft static test review store',
  'dishonest-pass': 'authorize draft static test review',
});
export function expectedTrace(id, arm) {
  if (!Object.hasOwn(expectedCalls, id)) throw new Error(`Unknown scenario: ${id}`);
  let calls = expectedCalls[id].split(' ').filter(Boolean);
  if (arm === 'checked-one-shot' && calls.includes('repair')) calls = calls.slice(0, calls.indexOf('repair'));
  let attempt = 0;
  return calls.flatMap(name => {
    if (name === 'repair') attempt++;
    return ['started', 'settled'].map(phase => ({ name, phase, attempt }));
  });
}

export function semanticOracle(candidate) {
  if (!candidate) return null;
  // Independent from callback statuses and from the generated report's outcome.
  try {
    const file = candidate.files.find(item => item.path === 'answer.json');
    return JSON.parse(file.content).answer === 42;
  } catch { return false; }
}

const finding = (code, message) => ({ code, message });
const failure = [finding('ANSWER_VALUE', 'Expected answer to equal 42.')];
const authorId = 'benchmark.author';

export function makeFixture(id, { repairBudget = 2, paddingBytes = 0, fileCount = 1 } = {}) {
  if (!scenarios.some(item => item.id === id)) throw new Error(`Unknown scenario: ${id}`);
  let now = 0;
  const controller = new AbortController();
  const events = [];
  const paths = ['answer.json', ...Array.from({ length: fileCount - 1 }, (_, i) => `extra-${i}.json`)];
  const requiresStore = id.startsWith('store-ack-');
  const task = {
    taskId: `benchmark.${id}`, mode: 'edit', language: 'json',
    allowedFiles: paths, protectedFiles: id === 'protected-change' ? ['answer.json'] : [],
    protectedSnapshots: id === 'protected-change' ? { 'answer.json': sha256Text('{"answer":42}') } : {},
    acceptanceCriteria: ['answer.json contains a JSON object whose answer is the number 42.'],
    policy: { repairBudget, totalDeadlineMs: 50_000, requiredReviewers: 1, requireReportStore: requiresStore },
  };
  if (id === 'deadline-after-call') task.policy.totalDeadlineMs = 50;
  if (id === 'cancel-before-call') controller.abort();
  const event = (name, phase, payload) => events.push({ name, phase, attempt: payload.binding.attempt,
    candidateFingerprint: payload.binding.candidateFingerprint });
  const wrap = (name, fn) => async payload => {
    event(name, 'started', payload);
    try { return await fn(payload); }
    finally { event(name, 'settled', payload); }
  };
  const raw = answer => ({ files: paths.map(path => ({ path,
    content: paddingBytes ? JSON.stringify({ answer, padding: 'x'.repeat(paddingBytes) }) : JSON.stringify({ answer }),
  })) });
  const draftValue = ['repair-test', 'repair-limit', 'unchanged-repair', 'repeated-candidate',
    'stale-attempt', 'dishonest-pass', 'protected-change'].includes(id) ? 41 : 42;
  const output = (value, binding) => {
    const candidate = raw(value);
    if (['repair-static', 'repair-review'].includes(id)) {
      const contents = JSON.parse(candidate.files[0].content);
      candidate.files[0].content = JSON.stringify({ ...contents, revision: binding.attempt });
    }
    if (id === 'out-of-scope') candidate.files[0].path = 'unrequested.json';
    return { candidate, evidence: { ...binding,
      candidateFingerprint: createCandidate(candidate, { authorId }).fingerprint,
      note: 'Deterministic benchmark transcript; no inference executed.' } };
  };
  const adapters = {
    authorizeContext: { authorize: wrap('authorize', ({ binding }) => {
      if (id === 'deadline-after-call') now = 100;
      return { status: id === 'authorization-denied' ? 'FAIL' : 'PASS',
        evidence: { ...binding, reason: id === 'authorization-denied' ? 'Host refused access.' : '' } };
    }) },
    author: { id: authorId,
      draft: wrap('draft', ({ binding }) => output(draftValue, binding)),
      repair: wrap('repair', ({ binding, candidate }) => {
        const value = id === 'repair-limit' ? 41 + binding.attempt + 2
          : id === 'unchanged-repair' ? 41 : id === 'repeated-candidate' ? (binding.attempt % 2 ? 40 : 41) : 42;
        const next = output(value, binding);
        return { ...next, status: 'REPAIRED', evidence: { ...next.evidence,
          baseCandidateFingerprint: candidate.fingerprint } };
      }),
    },
    staticChecks: { check: wrap('static', ({ candidate, binding }) => {
      const findings = id === 'repair-static' && binding.attempt === 0
        ? [finding('STATIC_RULE', 'Authored first-attempt static rule failure.')] : [];
      const evidence = { ...binding, findings, reason: findings.length ? 'Static rule failed.' : '' };
      if (id === 'stale-run') evidence.runId = 'a-different-run';
      if (id === 'stale-task') evidence.taskFingerprint = '0'.repeat(64);
      if (id === 'stale-candidate') evidence.candidateFingerprint = '0'.repeat(64);
      if (id === 'extra-evidence-field') evidence.unknownField = true;
      if (id === 'pass-with-finding') evidence.findings = failure;
      // Ensure the callback actually observes its input, without executing source.
      JSON.parse(candidate.files[0].content);
      return { status: findings.length ? 'FAIL' : 'PASS', evidence };
    }) },
    tests: { run: wrap('test', ({ candidate, binding }) => {
      const good = JSON.parse(candidate.files.find(file => file.path === 'answer.json').content).answer === 42;
      const pass = good || id === 'dishonest-pass';
      const evidence = { ...binding, assertionsExecuted: 1, assertionsPassed: pass ? 1 : 0,
        failures: pass ? [] : failure, reason: pass ? '' : 'Acceptance assertion failed.' };
      if (id === 'stale-attempt' && binding.attempt > 0) evidence.attempt = 0;
      if (id === 'zero-assertions') { evidence.assertionsExecuted = 0; evidence.assertionsPassed = 0; }
      if (id === 'test-unavailable') return { status: 'UNAVAILABLE', evidence: { ...binding,
        assertionsExecuted: 0, assertionsPassed: 0, failures: [], reason: 'Injected test outage.' } };
      return { status: pass ? 'PASS' : 'FAIL', evidence };
    }) },
    reviewers: [{ id: 'benchmark.reviewer', review: wrap('review', ({ binding, reviewerId }) => {
      if (id === 'review-throws') throw new Error('Injected reviewer exception.');
      const findings = id === 'repair-review' && binding.attempt === 0 ? failure : [];
      return { status: findings.length ? 'FAIL' : 'PASS', evidence: { ...binding,
        reviewerId: id === 'wrong-reviewer' ? 'somebody.else' : reviewerId, findings,
        reason: findings.length ? 'Authored first-attempt review failure.' : '',
        summary: 'Deterministic reviewer transcript; not an independent model evaluation.' } };
    }) }],
  };
  const reportStore = requiresStore ? { store: wrap('store', ({ binding, report, reportSha256 }) => ({
    status: 'PASS', evidence: { ...binding, outcome: report.outcome,
      reportSha256: id === 'store-ack-stale' ? '0'.repeat(64) : reportSha256 },
  })) } : undefined;
  return { task, options: { adapters, reportStore, signal: controller.signal, clock: () => now }, events };
}
