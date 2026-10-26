// Isolated tests allow useful verification while a separate writer relocates the
// reviewed owner. All copies and deliberate variants stay in an owned directory.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const work = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(work, '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const mainName = 'history/import-fixed-xpc-observation-v1.mjs';
const testName = 'tests/import-fixed-xpc-observation.test.mjs';
const ownerPins = JSON.parse(fs.readFileSync(path.join(work, 'evidence/owner-verification.json'))).after.files;
const productPins = JSON.parse(fs.readFileSync(path.join(root, '.build/xpc-history-projection-h918xQ/product-post-integration.json'))).before;
const pins = {
  [mainName]: '8e3d35c462c90524ca8de4e191be9ac22b74fd498efe2e6dd76a7826ea483961',
  [testName]: 'b03e67317e0c39759d26977c21784b60e4881b8f0497eeb1d342feb39c97c3a9',
};
const mappings = [
  [mainName, mainName], [testName, testName],
  ['history/fixed-xpc-journal-observation-v1.mjs', 'history/fixed-xpc-journal-observation-v1.mjs'],
  ['hosts/macos-xpc/protocol.mjs', 'hosts/macos-xpc/protocol.mjs'],
  ['tests/fixtures/fixed-xpc-journal-observation.mjs', 'tests/fixtures/fixed-xpc-journal-observation.mjs'],
  ['work-orders/journal-owner-v2/src/index.mjs', 'history/journal-owner-v2.mjs'],
  ['work-orders/journal-owner-v2/src/run-journal-v1.mjs', 'history/run-journal-v1.mjs'],
  ['work-orders/journal-owner-v2/src/run-journal-store-v1.mjs', 'history/run-journal-store-v1.mjs'],
  ['work-orders/journal-owner-v2/tests/memfs.mjs', 'tests/journal-owner-v2.memfs.mjs'],
  ['work-orders/journal-owner-v2/tests/helper.mjs', 'tests/journal-owner-v2.helper.mjs'],
];
const files = mappings.map(([origin, destination]) => {
  const bytes = fs.readFileSync(path.join(root, origin));
  const hash = pins[origin] ?? productPins[origin] ?? ownerPins[origin.replace('work-orders/journal-owner-v2/', '')];
  assert.equal(sha(bytes), hash, origin);
  let text = bytes.toString('utf8');
  if (origin === testName) text = text
    .replace("'../work-orders/journal-owner-v2/src/index.mjs'", "'../history/journal-owner-v2.mjs'")
    .replace("'../work-orders/journal-owner-v2/tests/memfs.mjs'", "'./journal-owner-v2.memfs.mjs'")
    .replace("'../work-orders/journal-owner-v2/tests/helper.mjs'", "'./journal-owner-v2.helper.mjs'");
  if (destination.endsWith('.helper.mjs')) text = text.replace("'../src/run-journal-v1.mjs'", "'../history/run-journal-v1.mjs'");
  return {origin, destination, hash, text};
});
const source = files.find(item => item.origin === mainName).text;
const variants = [
  ['baseline', null, null],
  ['hide-uncertainty', "status = journal.snapshot.state === 'COMMIT_UNCERTAIN' ? 'UNCERTAIN' : 'STORE_FAILED';", "status = 'STORE_FAILED';"],
  ['promote-duplicate', "case 'DUPLICATE': status = 'DUPLICATE'; break;", "case 'DUPLICATE': status = 'IMPORTED'; break;"],
  ['bypass-host-redaction', 'true, summary, journal);', 'true, projected, journal);'],
  ['promote-failed-observation', 'entry: projected.entry, now: request.now', "entry: {...projected.entry, state: 'SUCCEEDED'}, now: request.now"],
];
const evidence = fs.mkdtempSync(path.join(work, 'evidence/consumer-variants-'));
const receipt = {schemaVersion: 1, status: 'INCOMPLETE', evidence, startedAt: new Date().toISOString(),
  sourceManifest: Object.fromEntries(files.map(item => [item.origin, item.hash])), runs: [], authorizing: false};
try {
  for (const [id, from, to] of variants) {
    if (from) assert.ok(source.includes(from), `mutation anchor ${id}`);
    const directory = path.join(evidence, id);
    for (const item of files) {
      const target = path.join(directory, item.destination);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, item.origin === mainName && from ? item.text.replaceAll(from, to) : item.text, {flag: 'wx'});
    }
    const syntax = spawnSync(process.execPath, ['--check', mainName], {cwd: directory, encoding: 'utf8', timeout: 5000});
    assert.equal(syntax.status, 0); assert.equal(syntax.error, undefined); assert.equal(syntax.signal, null);
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-timeout=10000', testName],
      {cwd: directory, encoding: 'utf8', timeout: 20000, maxBuffer: 1048576});
    fs.writeFileSync(path.join(directory, 'test-output.txt'), result.stdout + result.stderr, {flag: 'wx'});
    const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => {
      const match = result.stdout.match(new RegExp('^# ' + key + ' (\\d+)$', 'm'));
      assert.ok(match, `${id}: ${key}`); return [key, Number(match[1])];
    }));
    receipt.runs.push({id, exitCode: result.status, signal: result.signal, error: result.error?.code ?? null,
      sourceSha256: sha(fs.readFileSync(path.join(directory, mainName))), ...counts});
    assert.equal(result.error, undefined); assert.equal(result.signal, null);
    assert.equal(counts.tests, 16); assert.equal(counts.cancelled + counts.skipped + counts.todo, 0);
    assert.equal(counts.pass + counts.fail, 16);
    assert.equal(result.status, id === 'baseline' ? 0 : 1);
    if (id === 'baseline') assert.equal(counts.pass, 16);
    else assert.ok(counts.fail > 0, `surviving mutant: ${id}`);
  }
  for (const item of files) assert.equal(sha(fs.readFileSync(path.join(root, item.origin))), item.hash, `source changed: ${item.origin}`);
  receipt.status = 'PASS_SCOPED';
} catch (error) {
  receipt.status = 'FAIL'; receipt.failure = String(error.message); process.exitCode = 1;
} finally {
  receipt.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify(receipt, null, 2));
}
