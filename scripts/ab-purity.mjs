// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// Opt-in CLI classification pilot, not an end-to-end Nisi performance test.
// Imports never invoke a model. CLI output does not attest served-model identity.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PURITY_PROMPT = [
  'You are checking whether a JavaScript snippet performs any of these side effects:',
  'process spawn, filesystem write, network call, dynamic code evaluation, module load, or process mutation.',
  '',
  'Answer with exactly one word: IMPURE if the snippet performs any of them, PURE if it does not.',
  'A word that merely appears as a variable name, property name, string, or substring is NOT a side effect.',
  '', 'Snippet:', '',
].join('\n');
const fail = code => { throw Object.assign(new Error(code), {code}); };
const digest = text => createHash('sha256').update(text).digest('hex');
const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function fixtureCases(fixtures) {
  if (fixtures?.schemaVersion !== 1 || !Array.isArray(fixtures.mutations) || !Array.isArray(fixtures.allowed) ||
      fixtures.mutations.length + fixtures.allowed.length === 0 || fixtures.mutations.length + fixtures.allowed.length > 256) fail('PURITY_FIXTURES_INVALID');
  const cases = [
    ...fixtures.mutations.map(m => ({id: m?.id, source: m?.source, truth: 'IMPURE', rule: m?.expectedRule})),
    ...fixtures.allowed.map(a => ({id: a?.id, source: a?.source, truth: 'PURE', rule: null})),
  ];
  const ids = new Set();
  for (const row of cases) {
    if (typeof row.id !== 'string' || !/^[A-Za-z0-9_.-]{1,96}$/u.test(row.id) || ids.has(row.id) ||
        typeof row.source !== 'string' || Buffer.byteLength(row.source) > 65536 ||
        (row.truth === 'IMPURE' && (typeof row.rule !== 'string' || row.rule.length === 0))) fail('PURITY_FIXTURES_INVALID');
    ids.add(row.id);
  }
  return cases;
}

export function classifyProcessResult(result) {
  if (!result || result.error || result.status !== 0 || result.signal != null) {
    return {status: 'UNAVAILABLE', answer: null, code: typeof result?.error?.code === 'string' ? result.error.code : 'PROCESS_FAILED'};
  }
  const answer = typeof result.stdout === 'string' ? result.stdout.trim() : null;
  if (answer !== 'PURE' && answer !== 'IMPURE') return {status: 'INVALID_OUTPUT', answer: null, code: 'EXACT_VERDICT_REQUIRED'};
  return {status: 'ANSWERED', answer, code: null};
}

export function runPurityComparison(fixtures, executable, {run = spawnSync, clock = () => performance.now()} = {}) {
  const cases = fixtureCases(fixtures);
  if (typeof executable !== 'string' || executable.trim() === '' || executable.includes('\0') || executable.length > 4096 ||
      typeof run !== 'function' || typeof clock !== 'function') fail('PURITY_CONFIG_INVALID');
  const rows = [];
  let stopped = false;
  for (const c of cases) {
    if (stopped) { rows.push({...c, status: 'NOT_RUN', answer: null, code: 'PRIOR_PROCESS_FAILURE', ms: null, correct: null, exitCode: null, signal: null, usage: null}); continue; }
    const t0 = clock(); let result;
    if (!Number.isFinite(t0) || t0 < 0) fail('PURITY_CLOCK_INVALID');
    try {
      result = run(executable, ['--mode', 'text'], {input: PURITY_PROMPT + c.source + '\n\nAnswer:', encoding: 'utf8',
        timeout: 60000, maxBuffer: 65536, killSignal: 'SIGKILL', shell: false});
    } catch (error) { result = {error}; }
    const end = clock();
    if (![t0, end].every(Number.isFinite) || t0 < 0 || end < t0) fail('PURITY_CLOCK_INVALID');
    const classified = classifyProcessResult(result);
    rows.push({...c, ...classified, ms: end - t0, correct: classified.status === 'ANSWERED' ? classified.answer === c.truth : null,
      exitCode: Number.isInteger(result?.status) ? result.status : null, signal: typeof result?.signal === 'string' ? result.signal : null, usage: null});
    if (classified.status === 'UNAVAILABLE') stopped = true;
  }
  const attempted = rows.filter(r => r.status !== 'NOT_RUN'), answered = rows.filter(r => r.status === 'ANSWERED');
  const correct = answered.filter(r => r.correct).length, complete = answered.length === rows.length;
  return {
    schemaVersion: 2, status: complete ? 'COMPLETE' : 'INCOMPLETE', evidenceScope: 'CLI_RESPONSE_ONLY_NO_MODEL_ATTESTATION',
    executableRequested: executable, reportedModel: null, usage: null, fixtureSha256: digest(JSON.stringify(cases)), promptSha256: digest(PURITY_PROMPT),
    cases: rows.length, attemptedCases: attempted.length, answeredCases: answered.length, correct,
    unavailableCases: rows.filter(r => r.status === 'UNAVAILABLE').length, invalidOutputCases: rows.filter(r => r.status === 'INVALID_OUTPUT').length,
    notRunCases: rows.filter(r => r.status === 'NOT_RUN').length,
    accuracy: complete ? correct / rows.length : null,
    answeredDecisionAccuracy: answered.length ? correct / answered.length : null,
    correctPerAttempt: attempted.length ? correct / attempted.length : null,
    falseNegatives: answered.filter(r => r.truth === 'IMPURE' && r.answer === 'PURE').map(r => r.id),
    falsePositives: answered.filter(r => r.truth === 'PURE' && r.answer === 'IMPURE').map(r => r.id),
    timings: {totalAttemptedMs: attempted.reduce((sum, r) => sum + r.ms, 0), medianAttemptedMs: median(attempted.map(r => r.ms)),
      medianAnsweredMs: median(answered.map(r => r.ms))}, rows,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) fail('PURITY_ARGUMENTS_INVALID');
    const report = runPurityComparison(JSON.parse(readFileSync(process.argv[2], 'utf8')), process.argv[3]);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'COMPLETE') process.exitCode = 2;
  } catch (error) {
    console.log(JSON.stringify({schemaVersion: 2, status: 'ERROR', code: typeof error?.code === 'string' ? error.code : 'PURITY_INPUT_INVALID', accuracy: null, usage: null}));
    process.exitCode = 2;
  }
}
