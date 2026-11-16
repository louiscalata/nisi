// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const lane = fileURLToPath(new URL('../', import.meta.url));
const main = fs.mkdtempSync(join(tmpdir(), 'journal-anchor-reference-'));
fs.mkdirSync(join(main, 'history'));
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_CONFIG_')));
fs.writeFileSync(join(main, 'history/run-journal-v1.mjs'), execFileSync('git', ['-C', lane, 'show', 'HEAD:history/run-journal-v1.mjs'], { env: gitEnv }));
const A = await import(pathToFileURL(join(lane, 'history/run-journal-anchor-v1.mjs')));
const current = await import(pathToFileURL(join(lane, 'history/run-journal-v1.mjs')));
const reference = await import(pathToFileURL(join(main, 'history/run-journal-v1.mjs')));
const store = await import(pathToFileURL(join(lane, 'history/run-journal-store-v1.mjs')));
const H = x => createHash('sha256').update(x).digest('hex');
const C = x => Array.isArray(x) ? `[${x.map(C).join(',')}]`
  : x && typeof x === 'object' ? `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${C(x[k])}`).join(',')}}` : JSON.stringify(x);
const entry = (id, patch = {}) => ({ id, projectId: 'project-a', runId: 'run-a', attempt: 0, candidateId: 'candidate-a', stage: 'test', receiptId: 'receipt-a', createdAt: 100, ttlMs: 1000, state: 'SUCCEEDED', heartbeatAt: null, retryOf: null, revokes: null, payload: { note: 'safe-note' }, ...patch });
const cfg = patch => ({ projectId: 'project-a', maxEntries: 8, heartbeatTtlMs: 10, redactPaths: [], ...patch });
const root = fs.mkdtempSync(join(tmpdir(), 'golden-differential-'));
let assertions = 0;
const equal = (a, b) => { assert.deepEqual(a, b); assertions++; };
const makeFixture = name => {
  const folder = join(root, name); fs.mkdirSync(folder);
  const journalDir = join(folder, 'journal'); const anchorDir = join(folder, 'anchors');
  fs.mkdirSync(journalDir); fs.mkdirSync(anchorDir);
  return { journalPath: join(journalDir, 'journal.jsonl'), anchorDir, key: name, fs };
};
try {
  const journal = current.createRunJournal(cfg({ maxEntries: 2 }));
  journal.append(entry('golden-a', { createdAt: 100, payload: { note: 'one' } }), 100);
  journal.append(entry('golden-b', { createdAt: 200, payload: { note: 'two' }, state: 'RUNNING', heartbeatAt: 200 }), 200);
  journal.append(entry('golden-c', { createdAt: 300, payload: { note: 'three' }, retryOf: 'golden-a', attempt: 1, state: 'QUEUED' }), 300);
  const serialized = journal.serialize(300);
  const parsed = serialized.trimEnd().split('\n').map(JSON.parse);
  const seed = H('nisi-journal-anchor/seed/v1\n' + C({ projectId: parsed[0].config.projectId }));
  const stems = parsed.slice(1, -1).map(row => H('nisi-journal-anchor/stem/v1\n' + C({ ...row.record.entry, payload: null })));
  const chain = [seed];
  for (const stem of stems) chain.push(H('nisi-journal-anchor/step/v1\n' + chain.at(-1) + '\n' + stem));
  const derived = { seed, stems, chain, fileSha256: H(serialized), lastHash: parsed.at(-1).lastHash };
  const description = A.describeJournal(serialized);
  for (const key of Object.keys(derived)) equal(description[key], derived[key]);
  equal(description.stemTip, chain.at(-1));
  equal(description.count, parsed.at(-1).count);
  equal(derived.fileSha256, 'dfab7a6842821e0a6e2cddaf1899ba6c1df8f91e25d6ab7a737b1eec4b7b9dab');
  const golden = makeFixture('golden');
  const result = A.writeAnchoredJournal({ ...golden, serialized });
  equal(result.status, 'WRITTEN'); equal(result.generation, 2);
  const state = { count: stems.length, fileSha256: H(serialized), generation: result.generation, journalSchema: parsed[0].schema, lastHash: parsed.at(-1).lastHash, projectId: parsed[0].config.projectId, stemTip: chain.at(-1) };
  const expectedBytes = C({ current: state, pending: null, schema: 'nisi-journal-anchor-v1' }) + '\n';
  equal(fs.readFileSync(join(golden.anchorDir, A.anchorFileName(golden.key)), 'utf8'), expectedBytes);
  const goldenResult = { status: 'PASS', vectors: { seed, stems, chain, lastHash: derived.lastHash, fileSha256: derived.fileSha256, anchorBytes: Buffer.byteLength(expectedBytes) }, assertions };

  let cases = 0;
  for (const maxEntries of [1, 2, 8]) {
    for (const size of [0, 1, 2, 5, 10]) {
      for (const now of [100, 500]) {
        const left = reference.createRunJournal(cfg({ maxEntries }));
        const right = current.createRunJournal(cfg({ maxEntries }));
        for (let i = 0; i < size; i++) {
          const row = entry('e' + i, { payload: { index: i, text: 'fixture-' + size } });
          equal(right.append(row, 100), left.append(row, 100));
        }
        const before = left.serialize(now); const after = right.serialize(now);
        equal(after, before);
        equal(current.reopen(after).report, reference.reopen(before).report);
        const f = makeFixture('case-' + cases);
        const anchored = A.writeAnchoredJournal({ ...f, serialized: after });
        equal(anchored.status, 'WRITTEN');
        equal(fs.readFileSync(f.journalPath, 'utf8'), before);
        equal(store.readSerializedJournal({ path: f.journalPath, fs }).serialized, before);
        equal(A.verifyAnchoredJournal(f).status, 'OK');
        cases++;
      }
    }
  }
  const output = { golden: goldenResult, differential: { status: 'PASS', cases, totalAssertions: assertions }, runtime: process.version, platform: process.platform, arch: process.arch };
  console.log(JSON.stringify(output, null, 2));
} finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(main, { recursive: true, force: true }); }
