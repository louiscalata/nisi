// Bounded journal-maintenance verification. Copies, mutants, and outputs are
// confined to a new owned .build directory; frozen journal/store stay untouched.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const priorName = '.build/disk-history-import-verification-cTQCH7/verification.json';
const sourceName = 'history/journal-owner-v2.mjs';
const targetTest = 'tests/journal-maintenance-v1.test.mjs';
const allowedOld = new Set([sourceName, 'history/journal-owner-v2.d.mts',
  'tests/journal-owner-v2-baseline.test.mjs', 'tests/journal-owner-v2-store.test.mjs']);
const newNames = [targetTest, 'tests/journal-maintenance-types.test.mjs', 'tests/typechecks/journal-maintenance-v1.mts'];
const expectedCurrent = {
  [sourceName]: 'b64e21ae717870faf220baf3f0ddc9c44841f0492415805f7b75b812828e7184',
  'history/journal-owner-v2.d.mts': 'b2dda3054e74912400a277430abd4e75565858210f2cf8c1c593fc923ccbec24',
  'tests/journal-owner-v2-baseline.test.mjs': 'bc5c2951ddd22ddbdc850a632119f5d11cb9a374ca3918f7b8ebc234b6f72029',
  'tests/journal-owner-v2-store.test.mjs': '216432ae044d4d7b57476f4f5a429e8a531e0bdcd5ff011a7f7bc365a999e994',
  [targetTest]: '98b273f0fe3afb2be177f2999a5356e549a29a142afb5946457666774d3451d2',
  'tests/journal-maintenance-types.test.mjs': 'ce53808b7753da69dd5525090b17908ab13bb977ef17c7eb76c0d51b1ee5ac37',
  'tests/typechecks/journal-maintenance-v1.mts': '6dc02b51d11329070f8ed274fcb761d27f95e51f46a4892cf5655870ef671808'
};
const hash = value => createHash('sha256').update(value).digest('hex');
const bytes = name => fs.readFileSync(path.join(root, name));
const source = bytes(sourceName).toString('utf8');
const prior = JSON.parse(bytes(priorName));
assert.equal(prior.status, 'PASS_SCOPED'); assert.equal(Object.keys(prior.after).length, 237);
for (const [name, expected] of Object.entries(prior.after)) {
  if (!allowedOld.has(name)) assert.equal(hash(bytes(name)), expected, name);
  else assert.notEqual(hash(bytes(name)), expected, name + ' must be the adjudicated changed input');
}
assert.equal(Object.keys(prior.after).filter(name => !allowedOld.has(name)).length, 233);
for (const [name, expected] of Object.entries(expectedCurrent)) assert.equal(hash(bytes(name)), expected, name);
const names = [...Object.keys(prior.after), ...newNames].sort();
assert.equal(names.length, 240); assert.equal(new Set(names).size, 240);
const pins = () => Object.fromEntries(names.map(name => [name, hash(bytes(name))]));
const before = pins();
const evidence = fs.mkdtempSync(path.join(root, '.build/journal-maintenance-verification-'));
const record = {schemaVersion: 1, status: 'INCOMPLETE', startedAt: new Date().toISOString(), evidence,
  node: process.version, priorVerification: priorName, priorPinCount: 237, unchangedPriorPins: 233,
  allowedChangedInputs: [...allowedOld].sort(), checkedFiles: 240, before, targeted: null,
  relocatedControl: null, variants: [], product: null, authorizing: false,
  scope: 'Explicit durable journal maintenance and tombstones; no automatic sweeper, secure erasure, consent auth, or release acceptance'};

function replaceOnce(input, old, next) {
  assert.equal(input.split(old).length, 2, 'exact single mutation target: ' + old.slice(0, 90));
  return input.replace(old, next);
}
function relocate(text, origin, variantSource) {
  return text.replace(/from '([^']+)'/g, (whole, specifier) => {
    if (!specifier.startsWith('.')) return whole;
    const resolved = path.resolve(path.dirname(path.join(root, origin)), specifier);
    return "from '" + pathToFileURL(resolved === path.join(root, sourceName) ? variantSource : resolved).href + "'";
  });
}
function counts(stdout) {
  return Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => {
    const found = [...stdout.matchAll(new RegExp('^(?:# |ℹ )' + key + ' (\\d+)$', 'gm'))];
    assert.equal(found.length, 1, 'one terminal ' + key + ' counter');
    return [key, Number(found[0][1])];
  }));
}
function execute(command, args, dir, timeout) {
  const child = spawnSync(command, args, {cwd: root, encoding: 'utf8', timeout, maxBuffer: 16_777_216});
  fs.writeFileSync(path.join(dir, 'stdout.txt'), child.stdout ?? '', {flag: 'wx'});
  fs.writeFileSync(path.join(dir, 'stderr.txt'), child.stderr ?? '', {flag: 'wx'});
  assert.equal(child.error, undefined, 'finite child completion'); assert.equal(child.signal, null);
  const measured = counts(child.stdout); assert.equal(measured.cancelled + measured.skipped + measured.todo, 0);
  const codes = [...child.stdout.matchAll(/^\s+code: '([^']+)'$/gm)].map(match => match[1]);
  assert.equal(codes.length, measured.fail, 'each failure has one node:test error code');
  const assertionFailures = codes.filter(code => code === 'ERR_ASSERTION').length;
  const nonAssertionFailures = codes.length - assertionFailures;
  // A defective variant can break later fixture setup as well as assertions.
  // Retain both counts, but NEVER use runtime/import/syntax errors as kills.
  return {exitCode: child.status, ...measured, assertionFailures, nonAssertionFailures,
    failureCodes: Object.fromEntries([...new Set(codes)].sort().map(code => [code, codes.filter(x => x === code).length]))};
}
const passing = count => ({exitCode: 0, tests: count, pass: count, fail: 0,
  cancelled: 0, skipped: 0, todo: 0, assertionFailures: 0, nonAssertionFailures: 0, failureCodes: {}});

const variants = [
  ['relocated-control', value => value],
  ['short-circuit-private-serialized', value => replaceOnce(value,
    '// disk contents and the previous hash before it can issue that outcome.\n    const committed = commitStaged(state, staged, req.now);',
    "// disk contents and the previous hash before it can issue that outcome.\n    if (staged.serialize() === state.serialized) return maintenanceResult(state, 'UNCHANGED', null, null);\n    const committed = commitStaged(state, staged, req.now);")],
  ['omit-shared-maintenance-busy', value => replaceOnce(value,
    "if (state.busy) return maintenanceResult(state, 'REFUSED', 'OWNER_BUSY');\n\n  state.busy = true;",
    "if (state.busy) return maintenanceResult(state, 'REFUSED', 'OWNER_BUSY');\n\n  /* mutant omits shared busy claim */")],
  ['suppress-committed-quarantine', value => replaceOnce(value,
    'if (store.committed) sealUncertain(state, store.reason);',
    'if (store.committed) { /* mutant suppresses quarantine */ }')],
  ['publish-before-store-validation', value => replaceOnce(value,
    'storeEntered = true;\n    const response = writeSerializedJournal(options);',
    'state.serialized = serialized; state.sha256 = sha256; state.snapshot = snapshot;\n    storeEntered = true;\n    const response = writeSerializedJournal(options);')],
  ['swallow-backward-time', value => replaceOnce(value,
    "if (error?.code === 'TIME') return maintenanceResult(state, 'REFUSED', 'TIME');",
    "if (error?.code === 'TIME') return maintenanceResult(state, 'UNCHANGED', null);")],
  ['misreport-nondurable-written', value => replaceOnce(value,
    "committed.status === 'WRITTEN' ? 'MAINTAINED' : committed.status,",
    "committed.status === 'WRITTEN' && committed.store?.durable === false ? 'STORE_FAILED' : committed.status === 'WRITTEN' ? 'MAINTAINED' : committed.status,")]
];

try {
  const targetDir = path.join(evidence, 'targeted'); fs.mkdirSync(targetDir);
  record.targeted = execute(process.execPath, ['--test', '--test-reporter=tap', targetTest], targetDir, 20_000);
  assert.deepEqual(record.targeted, passing(32));

  for (const [name, transform] of variants) {
    const dir = path.join(evidence, name); fs.mkdirSync(dir);
    const altered = transform(source); const variantSource = path.join(dir, 'journal-owner-v2.mjs');
    fs.writeFileSync(variantSource, relocate(altered, sourceName, variantSource), {flag: 'wx'});
    const variantTest = path.join(dir, 'maintenance.test.mjs');
    fs.writeFileSync(variantTest, relocate(bytes(targetTest).toString('utf8'), targetTest, variantSource), {flag: 'wx'});
    const outcome = execute(process.execPath, ['--test', '--test-reporter=tap', variantTest], dir, 20_000);
    const item = {name, canonicalSourceSha256: hash(source),
      semanticVariantSha256: hash(altered), ...outcome};
    if (name === 'relocated-control') {
      record.relocatedControl = item;
      assert.deepEqual(outcome, passing(32));
    } else {
      record.variants.push(item); assert.equal(outcome.tests, 32); assert.equal(outcome.pass + outcome.fail, 32);
      assert.equal(outcome.exitCode, 1, name + ' must be killed');
      assert.ok(outcome.assertionFailures > 0, name + ' requires actual semantic assertion failures, not runtime errors or a predicted count');
    }
  }

  const productDir = path.join(evidence, 'product'); fs.mkdirSync(productDir);
  record.product = execute('npm', ['run', 'check'], productDir, 120_000);
  assert.deepEqual(record.product, passing(1442));
  record.after = pins(); record.changedDuringVerification = names.filter(name => before[name] !== record.after[name]);
  assert.deepEqual(record.changedDuringVerification, []); record.status = 'PASS_SCOPED';
} catch (error) {
  record.status = 'FAIL'; record.failure = String(error?.message ?? error); process.exitCode = 1;
} finally {
  record.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(record, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({status: record.status, evidence, checkedFiles: record.checkedFiles,
    unchangedPriorPins: record.unchangedPriorPins, targeted: record.targeted, relocatedControl: record.relocatedControl,
    variants: record.variants, product: record.product, changedDuringVerification: record.changedDuringVerification ?? null,
    failure: record.failure ?? null}));
}
