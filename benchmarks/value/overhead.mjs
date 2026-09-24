// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { runWorkflow } from '../../workflow/engine.mjs';
import { runCheckedLoop } from './checked-loop.mjs';
import { makeFixture, scenarios } from './fixtures.mjs';
import { scoreRun } from './score.mjs';
import { environment, sourceManifest } from './run.mjs';

export const timingPlan = Object.freeze({ warmupPairs: 30, measuredPairs: 200,
  scenarios: ['valid-first', 'repair-test'],
  payloads: [{ fileCount: 1, paddingBytes: 0 }, { fileCount: 1, paddingBytes: 8192 },
    { fileCount: 8, paddingBytes: 8192 }], order: 'Even pairs checked-loop first; odd pairs nisi first.' });
export function quantile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  return sorted[Math.floor(index)] + (sorted[Math.ceil(index)] - sorted[Math.floor(index)]) * (index % 1);
}
export function verifyMatchedPair(a, b, specimen) {
  assert.equal(a.report.outcome, 'COMPLETED');
  assert.equal(b.report.outcome, 'COMPLETED');
  assert.equal(a.report.candidateFingerprint, b.report.candidateFingerprint);
  assert.deepEqual(a.fixture.events, b.fixture.events);
  for (const [arm, value] of [['checked-loop', a], ['nisi', b]]) {
    assert.equal(scoreRun(specimen, arm, value.report, value.fixture).scenarioConforms, true);
  }
}
export async function runOverhead(plan = timingPlan) {
  const rows = [];
  const clock = () => Math.floor(performance.now());
  for (const scenario of plan.scenarios) for (const payload of plan.payloads) {
    const specimen = scenarios.find(item => item.id === scenario);
    for (let pair = -plan.warmupPairs; pair < plan.measuredPairs; pair++) {
      const values = {};
      const order = Math.abs(pair) % 2 ? ['nisi', 'checked-loop'] : ['checked-loop', 'nisi'];
      for (const arm of order) {
        const fixture = makeFixture(scenario, payload);
        fixture.options.clock = clock;
        const run = arm === 'nisi' ? runWorkflow : runCheckedLoop;
        const started = performance.now();
        const report = await run(fixture.task, fixture.options);
        const milliseconds = performance.now() - started;
        values[arm] = { report, fixture, milliseconds };
      }
      // Output, scoring, trace comparison and fixture construction are untimed.
      verifyMatchedPair(values['checked-loop'], values.nisi, specimen);
      if (pair >= 0) rows.push({ scenario, ...payload, pair, order,
        candidateBytes: values.nisi.report.candidate.files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0),
        trace: values.nisi.fixture.events, baselineMs: values['checked-loop'].milliseconds,
        nisiMs: values.nisi.milliseconds, deltaMs: values.nisi.milliseconds - values['checked-loop'].milliseconds });
    }
  }
  const summaries = plan.scenarios.flatMap(scenario => plan.payloads.map(payload => {
    const subset = rows.filter(row => row.scenario === scenario && row.fileCount === payload.fileCount && row.paddingBytes === payload.paddingBytes);
    return { scenario, ...payload, candidateBytes: subset[0].candidateBytes, pairs: subset.length,
      baselineMedianMs: quantile(subset.map(row => row.baselineMs), .5),
      baselineP95Ms: quantile(subset.map(row => row.baselineMs), .95),
      nisiMedianMs: quantile(subset.map(row => row.nisiMs), .5),
      nisiP95Ms: quantile(subset.map(row => row.nisiMs), .95),
      pairedDeltaMedianMs: quantile(subset.map(row => row.deltaMs), .5),
      pairedDeltaP95Ms: quantile(subset.map(row => row.deltaMs), .95) };
  }));
  return { rows, summaries };
}
export function overheadMarkdown(result) {
  return '# Warm inert-callback overhead\n\n' +
    'Single-process technical timing samples on this host; no inference, journal, network, subprocess or report-store I/O. ' +
    'The reference loop shares Nisi contracts. This measures scheduling/validation/report overhead, not end-to-end model speed or real-user productivity.\n\n' +
    '| Path | Candidate bytes / files | Pairs | Reference median / p95 ms | Nisi median / p95 ms | Paired delta median ms |\n|---|---:|---:|---:|---:|---:|\n' +
    result.summaries.map(row => `| ${row.scenario} | ${row.candidateBytes} / ${row.fileCount} | ${row.pairs} | ${row.baselineMedianMs.toFixed(3)} / ${row.baselineP95Ms.toFixed(3)} | ${row.nisiMedianMs.toFixed(3)} / ${row.nisiP95Ms.toFixed(3)} | ${row.pairedDeltaMedianMs.toFixed(3)} |`).join('\n') +
    '\n\nEach pair passed matching callback-trace, candidate-fingerprint and completed-evidence checks. ' +
    'Order alternates within each condition after 30 warmup pairs; 200 measured pairs per condition. ' +
    'Small differences are sensitive to runtime scheduling, garbage collection, JIT and background load; no statistical speedup claim is made.\n';
}
export async function main() {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: node benchmarks/value/overhead.mjs <new-output-directory>');
  await fs.mkdir(output, { recursive: false });
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(),
    environment: environment(), sources: await sourceManifest(), plan: timingPlan }, null, 2) + '\n', { flag: 'wx' });
  const result = await runOverhead();
  await fs.writeFile(path.join(output, 'overhead.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  await fs.writeFile(path.join(output, 'REPORT.md'), overheadMarkdown(result), { flag: 'wx' });
  console.log(JSON.stringify({ output, measuredPairs: result.rows.length,
    measuredWorkflowExecutions: result.rows.length * 2, modelCalls: 0, summaries: result.summaries }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
