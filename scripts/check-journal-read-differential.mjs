// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const worktree = fileURLToPath(new URL('../', import.meta.url));
const outputRoot = fs.mkdtempSync(path.join(tmpdir(), 'journal-read-differential-'));
const root = path.join(outputRoot, 'differential');
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_CONFIG_')));
try {
  fs.mkdirSync(path.join(root, 'baseline', 'history'), { recursive: true });
  const base = execFileSync('git', ['-C', worktree, 'rev-parse', process.argv[2] ?? 'HEAD'], { encoding: 'utf8', env: gitEnv }).trim();
  for (const file of ['run-journal-v1.mjs', 'run-journal-store-v1.mjs']) {
    fs.writeFileSync(path.join(root, 'baseline', 'history', file), execFileSync('git', ['-C', worktree, 'show', `${base}:history/${file}`], { env: gitEnv }));
  }
  const current = await import(pathToFileURL(path.join(worktree, 'history', 'run-journal-store-v1.mjs')));
  const baseline = await import(pathToFileURL(path.join(root, 'baseline', 'history', 'run-journal-store-v1.mjs')));
  const { createRunJournal } = await import(pathToFileURL(path.join(worktree, 'history', 'run-journal-v1.mjs')));
  const file = path.join(root, 'input.jsonl');
  const unicode = ['plain', 'café', '日本語', '🪻🧭', 'e\u0301', 'line\nquote"slash\\'];
  const stats = { base, sourceSha256: createHash('sha256').update(fs.readFileSync(path.join(worktree, 'history/run-journal-store-v1.mjs'))).digest('hex'), baselineSha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'baseline', 'history', 'run-journal-store-v1.mjs'))).digest('hex'), generatedJournals: 0, generatedInputs: 0, comparisons: 0, mismatches: 0, currentRead: 0, currentRefused: 0, inputBytes: 0, inputSha256: null, modes: {} };
  const inputDigest = createHash('sha256');
  const compare = (name, a, b) => {
    stats.comparisons++;
    stats.modes[name] = (stats.modes[name] || 0) + 1;
    try { assert.deepEqual(a, b); }
    catch (error) { stats.mismatches++; throw Object.assign(error, { input: stats.generatedInputs, mode: name }); }
  };
  for (let i = 0; i < 512; i++) {
    const projectId = `project-${i}`;
    const journal = createRunJournal({ projectId, maxEntries: 4 + i % 8, heartbeatTtlMs: 50 + i % 31, redactPaths: i % 3 === 0 ? ['payload.secret'] : [] });
    for (let k = 0; k < i % 7; k++) {
      assert.equal(journal.append({ id: `entry-${i}-${k}`, projectId, runId: `run-${i}`, attempt: 0, candidateId: `candidate-${k}`, stage: 'test', receiptId: `receipt-${k}`, createdAt: 100 + k, ttlMs: 500 + i, state: 'SUCCEEDED', heartbeatAt: null, retryOf: null, revokes: null, payload: { note: unicode[(i + k) % unicode.length], secret: `private-${i}`, n: i * 11 + k, flag: k % 2 === 0, nested: { a: null, b: [k, unicode[k % unicode.length]] } } }, 100 + k).status, 'APPENDED');
    }
    const text = journal.serialize(110);
    const bytes = Buffer.from(text);
    stats.generatedJournals++;
    const middle = Math.floor(bytes.length / 2);
    const flipped = Buffer.from(bytes); flipped[middle] ^= 1;
    const damagedUtf8 = Buffer.from(bytes); damagedUtf8[middle] = 0xff;
    const inputs = [
      bytes,
      bytes.subarray(0, bytes.length - 1),
      bytes.subarray(0, middle),
      bytes.subarray(1),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
      Buffer.from(text.replaceAll('\n', '\r\n')),
      Buffer.concat([bytes, Buffer.from('\n')]),
      flipped,
      damagedUtf8,
      Buffer.from(text.replace('"count":', '"count":9999,"discarded":')),
      Buffer.concat([bytes, Buffer.from('trailing')]),
      Buffer.from(text.replace('nisi-run-journal-v1', 'nisi-run-journal-v0')),
    ];
    for (const input of inputs) {
      stats.generatedInputs++; stats.inputBytes += input.length;
      inputDigest.update(String(input.length) + ':').update(input);
      fs.writeFileSync(file, input);
      const ordinary = current.readSerializedJournal({ path: file, fs });
      compare('default-descriptor', ordinary, baseline.readSerializedJournal({ path: file, fs }));
      if (ordinary.status === 'READ') stats.currentRead++; else stats.currentRefused++;
      const shortFs = { ...fs, readSync: (fd, buffer, offset, length, position) => fs.readSync(fd, buffer, offset, Math.min(length, 1 + i % 19), position) };
      compare('short-reads', current.readSerializedJournal({ path: file, fs: shortFs }), baseline.readSerializedJournal({ path: file, fs: shortFs }));
      const minimal = { readFileSync: () => input };
      compare('readFileSync-fallback', current.readSerializedJournal({ path: file, fs: minimal }), baseline.readSerializedJournal({ path: file, fs: minimal }));
      for (const maxBytes of [input.length, Math.max(0, input.length - 1), input.length - 0.5, Infinity]) {
        compare('explicit-limit-descriptor', current.readSerializedJournal({ path: file, fs, maxBytes }), baseline.readSerializedJournal({ path: file, fs, maxBytes }));
        compare('explicit-limit-fallback', current.readSerializedJournal({ path: file, fs: minimal, maxBytes }), baseline.readSerializedJournal({ path: file, fs: minimal, maxBytes }));
      }
    }
  }
  stats.inputSha256 = inputDigest.digest('hex');
  fs.writeFileSync(path.join(outputRoot, 'differential-result.json'), JSON.stringify(stats, null, 2) + '\n');
  console.log(JSON.stringify(stats, null, 2));

} finally { fs.rmSync(outputRoot, { recursive: true, force: true }); }
