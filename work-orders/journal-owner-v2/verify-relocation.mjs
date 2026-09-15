// Owner-controlled exact relocation audit. Never imports generated destinations.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const work = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(work, '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const owner = ["'../src/index.mjs'", "'../history/journal-owner-v2.mjs'"];
const journal = ["'../src/run-journal-v1.mjs'", "'../history/run-journal-v1.mjs'"];
const memfs = ["'./memfs.mjs'", "'./journal-owner-v2.memfs.mjs'"];
const helper = ["'./helper.mjs'", "'./journal-owner-v2.helper.mjs'"];
export const mapping = [
  ['src/index.mjs', 'history/journal-owner-v2.mjs', []],
  ['tests/memfs.mjs', 'tests/journal-owner-v2.memfs.mjs', []],
  ['tests/helper.mjs', 'tests/journal-owner-v2.helper.mjs', [journal]],
  ['tests/baseline.test.mjs', 'tests/journal-owner-v2-baseline.test.mjs', [owner, ["'../src/'", "'../history/'"]]],
  ['tests/owner.test.mjs', 'tests/journal-owner-v2.test.mjs', [owner, journal, memfs, helper]],
  ['tests/adjudication-boundaries.test.mjs', 'tests/journal-owner-v2-adjudication.test.mjs', [owner, journal, memfs, helper]],
  ['tests/store-boundary.test.mjs', 'tests/journal-owner-v2-store.test.mjs', [owner, journal,
    ["'../src/run-journal-store-v1.mjs'", "'../history/run-journal-store-v1.mjs'"], memfs, helper]],
  ['tests/windows-xpc-integration.test.mjs', 'tests/journal-owner-v2-xpc.test.mjs', [owner,
    ["'../../../history/fixed-xpc-journal-observation-v1.mjs'", "'../history/fixed-xpc-journal-observation-v1.mjs'"],
    ["'../../../tests/fixtures/fixed-xpc-journal-observation.mjs'", "'./fixtures/fixed-xpc-journal-observation.mjs'"], memfs]],
];

export function auditRelocation({requireCopies = true} = {}) {
  const protectedPins = JSON.parse(fs.readFileSync(path.join(root,
    '.build/xpc-history-projection-h918xQ/product-post-integration.json'))).before;
  const originalPins = JSON.parse(fs.readFileSync(path.join(work, 'evidence/owner-verification.json'))).after.files;
  for (const [name, hash] of Object.entries(protectedPins))
    assert.equal(sha(fs.readFileSync(path.join(root, name))), hash, `canonical drift: ${name}`);
  for (const [name, hash] of Object.entries(originalPins))
    assert.equal(sha(fs.readFileSync(path.join(work, name))), hash, `work-order drift: ${name}`);
  const files = mapping.map(([origin, destination, substitutions]) => {
    const original = fs.readFileSync(path.join(work, origin));
    assert.equal(sha(original), originalPins[origin], origin);
    let expected = original.toString('utf8');
    for (const [from, to] of substitutions) {
      assert.ok(expected.includes(from), `missing replacement ${origin}: ${from}`);
      expected = expected.replaceAll(from, to);
    }
    const expectedBytes = Buffer.from(expected);
    const exists = fs.existsSync(path.join(root, destination));
    const actual = exists ? fs.readFileSync(path.join(root, destination)) : null;
    if (requireCopies) assert.deepEqual(actual, expectedBytes, `non-exact relocation: ${destination}`);
    return {origin, destination, originSha256: sha(original), expectedSha256: sha(expectedBytes),
      actualSha256: actual === null ? null : sha(actual), exact: actual?.equals(expectedBytes) ?? false};
  });
  return {checkedAt: new Date().toISOString(), status: requireCopies ? 'EXACT_COPIES' : 'PROTECTED_BASELINE',
    protectedCanonicalFiles: Object.keys(protectedPins).length, protectedWorkOrderFiles: Object.keys(originalPins).length,
    files, authorizing: false};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv.length === 2 || process.argv.length === 3 && process.argv[2] === '--baseline');
  console.log(JSON.stringify(auditRelocation({requireCopies: process.argv[2] !== '--baseline'}), null, 2));
}
