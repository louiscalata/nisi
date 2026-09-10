// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
//
// A/B: the deterministic structural checker vs. a language model reading the
// same code. Same 16 fixtures from contracts/structural-fixtures.json, same
// question, nothing simulated. Backs the "With Nisi, versus asking a model"
// table in the README.
//
// Requires the `afm` CLI (macOS 26+ with Apple Intelligence), so this is not
// part of `npm run check` and CI does not run it.
//
//   node scripts/ab-purity.mjs contracts/structural-fixtures.json "$HOME/bin/afm"

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const fixtures = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const AFM = process.argv[3];

const cases = [
  ...fixtures.mutations.map(m => ({ id: m.id, source: m.source, truth: 'IMPURE', rule: m.expectedRule })),
  ...fixtures.allowed.map(a => ({ id: a.id, source: a.source, truth: 'PURE', rule: null })),
];

const PROMPT = `You are checking whether a JavaScript snippet performs any of these side effects:
process spawn, filesystem write, network call, dynamic code evaluation, module load, or process mutation.

Answer with exactly one word: IMPURE if the snippet performs any of them, PURE if it does not.
A word that merely appears as a variable name, property name, string, or substring is NOT a side effect.

Snippet:
`;

const rows = [];
for (const c of cases) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(AFM, ['--mode', 'text'], {
    input: PROMPT + c.source + '\n\nAnswer:',
    encoding: 'utf8',
    timeout: 60_000,
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const out = (r.stdout || '').toUpperCase();
  // First verdict token wins; anything else is unusable.
  const m = out.match(/\b(IMPURE|PURE)\b/);
  const answer = m ? m[1] : 'UNPARSEABLE';
  rows.push({ ...c, answer, ms: Number(ms.toFixed(0)), correct: answer === c.truth });
  process.stderr.write(`  ${c.id.padEnd(34)} truth=${c.truth.padEnd(7)} model=${answer.padEnd(12)} ${ms.toFixed(0)}ms\n`);
}

const fn = rows.filter(r => r.truth === 'IMPURE' && r.answer !== 'IMPURE');   // missed a real effect
const fp = rows.filter(r => r.truth === 'PURE' && r.answer !== 'PURE');       // flagged clean code
const correct = rows.filter(r => r.correct).length;
const totalMs = rows.reduce((a, r) => a + r.ms, 0);

console.log(JSON.stringify({
  cases: rows.length,
  correct,
  accuracy: Number((correct / rows.length).toFixed(3)),
  falseNegatives: fn.map(r => r.id),
  falsePositives: fp.map(r => r.id),
  totalMs,
  medianMs: rows.map(r => r.ms).sort((a, b) => a - b)[rows.length >> 1],
  rows,
}, null, 2));
