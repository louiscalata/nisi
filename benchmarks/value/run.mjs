// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runWorkflow } from '../../workflow/engine.mjs';
import { runCheckedLoop } from './checked-loop.mjs';
import { scenarios, makeFixture } from './fixtures.mjs';
import { scoreRun } from './score.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const arms = Object.freeze({ 'checked-one-shot': runCheckedLoop, 'checked-loop': runCheckedLoop, nisi: runWorkflow });
export async function sourceManifest() {
  const names = ['workflow/engine.mjs', 'workflow/contracts.mjs', 'benchmarks/value/checked-loop.mjs',
    'benchmarks/value/fixtures.mjs', 'benchmarks/value/score.mjs', 'benchmarks/value/run.mjs',
    'benchmarks/value/overhead.mjs', 'benchmarks/value/PROTOCOL.md'];
  return Object.fromEntries(await Promise.all(names.map(async name => [name,
    createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex')])));
}
export async function runControls() {
  const rows = [];
  for (const specimen of scenarios) for (const [arm, run] of Object.entries(arms)) {
    const fixture = makeFixture(specimen.id, { repairBudget: arm === 'checked-one-shot' ? 0 : 2 });
    const report = await run(fixture.task, fixture.options);
    rows.push({ scenario: specimen.id, family: specimen.family, arm,
      score: scoreRun(specimen, arm, report, fixture), trace: fixture.events, report });
  }
  return rows;
}
export function controlsMarkdown(result) {
  const table = scenarios.map(specimen => {
    const rows = result.rows.filter(row => row.scenario === specimen.id);
    return `| ${specimen.id} | ${rows.map(row => `${row.score.observedOutcome}${row.score.incorrectAcceptance ? ' ⚠ incorrect answer' : ''}`).join(' | ')} |`;
  });
  return `# Nisi control-path benchmark\n\nGenerated ${result.createdAt}.\n\n` +
    `25 authored deterministic scenarios, three arms, no model calls. These are coverage specimens, not 25 independent real-world tasks.\n\n` +
    `| Scenario | Checked one-shot (0 repairs) | Handwritten checked loop (2 repairs) | Nisi v0.2.0 (2 repairs) |\n|---|---|---|---|\n${table.join('\n')}\n\n` +
    `Observed conforming scenarios: ${Object.keys(arms).map(arm => `${arm}: ${result.rows.filter(r => r.arm === arm && r.score.scenarioConforms).length}/${scenarios.length}`).join('; ')}. ` +
    `Conformance includes the disclosed dishonest-PASS failure case: it is not an accuracy score.\n\n` +
    `The one-shot arm has no repair budget; that comparison illustrates recovery opportunity, not a Nisi-specific advantage. ` +
    `The checked loop shares Nisi value-object validation and hashing. It is a scheduling reference, not a Nisi-free competing library. ` +
    `Different author/reviewer IDs do not establish independent model judgment. Storage scenarios check acknowledgement binding, not durability.\n\n` +
    `An internally consistent false PASS can accept an incorrect answer in every arm. Nisi validates the host's evidence contract; it cannot establish the truth of a dishonest callback.\n`;
}
export function environment() {
  return { node: process.version, platform: process.platform, arch: process.arch, cpus: os.cpus()[0]?.model,
    cpuCount: os.cpus().length, memoryBytes: os.totalmem(), release: os.release(),
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() };
}
export async function main() {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: node benchmarks/value/run.mjs <new-output-directory>');
  await fs.mkdir(output, { recursive: false });
  const manifest = await sourceManifest();
  // Persist design/source hashes before execution; directories cannot overwrite old runs.
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(),
    environment: environment(), sources: manifest, scenarios }, null, 2) + '\n', { flag: 'wx' });
  const result = { createdAt: new Date().toISOString(), rows: await runControls() };
  await fs.writeFile(path.join(output, 'controls.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  await fs.writeFile(path.join(output, 'REPORT.md'), controlsMarkdown(result), { flag: 'wx' });
  const failures = result.rows.filter(row => !row.score.scenarioConforms);
  console.log(JSON.stringify({ output, scenarios: scenarios.length, rows: result.rows.length,
    modelCalls: 0, conformanceFailures: failures.map(row => ({ scenario: row.scenario, arm: row.arm, score: row.score })) }, null, 2));
  if (failures.length) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
