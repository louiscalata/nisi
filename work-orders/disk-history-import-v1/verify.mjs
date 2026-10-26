// Bounded private disk-history verification. All copies, mutants, and evidence
// are created under one newly owned .build directory. No native app/model runs.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceName = 'hosts/history/import-fixed-xpc-from-disk-v1.mjs';
const testNames = ['tests/disk-history-import-v1.test.mjs', 'tests/disk-history-import-boundaries.test.mjs'];
const expectedNew = {
  [sourceName]: 'e0982d129bf635b33ce53b46d1155b7c0182b9f7875053f540071dfffa4070cd',
  // Root-reviewed correction moves synthetic abort dispatch after listener setup.
  [testNames[0]]: '343ca4fc19d154c9654be1db28a96253462bbc20390d2dd8ff888ab40281c1b0',
  [testNames[1]]: '05303beecd92a08334894b9e7f0beafc6aba7e1c3d2b3dbd5406253fa0fd076c'
};
const priorName = '.build/history-capture-verification-LWb99c/verification.json';
const hash = value => createHash('sha256').update(value).digest('hex');
const bytes = name => fs.readFileSync(path.join(root, name));
const source = bytes(sourceName).toString('utf8');

const prior = JSON.parse(bytes(priorName));
assert.equal(prior.status, 'PASS_SCOPED');
assert.equal(Object.keys(prior.after).length, 234);
for (const [name, expected] of Object.entries(prior.after)) assert.equal(hash(bytes(name)), expected, name);
for (const [name, expected] of Object.entries(expectedNew)) assert.equal(hash(bytes(name)), expected, name);
const names = [...Object.keys(prior.after), sourceName, ...testNames].sort();
assert.equal(names.length, 237); assert.equal(new Set(names).size, 237);
const pins = () => Object.fromEntries(names.map(name => [name, hash(bytes(name))]));
const before = pins();
const evidence = fs.mkdtempSync(path.join(root, '.build/disk-history-import-verification-'));
const record = {schemaVersion: 1, status: 'INCOMPLETE', startedAt: new Date().toISOString(),
  evidence, node: process.version, priorVerification: priorName, priorPinCount: 234,
  checkedFiles: names.length, before, targeted: null, variants: [], product: null,
  authorizing: false, scope: 'POSIX trusted-static disk observation import; no native incident, consent-auth, hostile-tree, or release acceptance'};

function replaceOnce(input, old, next) {
  assert.equal(input.split(old).length, 2, 'exact mutation target: ' + old.slice(0, 80));
  return input.replace(old, next);
}
function imports(text, origin, variantSource) {
  return text.replace(/from '([^']+)'/g, (whole, specifier) => {
    if (!specifier.startsWith('.')) return whole;
    const resolved = path.resolve(path.dirname(path.join(root, origin)), specifier);
    const target = resolved === path.join(root, sourceName) ? variantSource : resolved;
    return "from '" + pathToFileURL(target).href + "'";
  });
}
function relocatedTest(text, origin, variantSource, variantRawHash) {
  let output = imports(text, origin, variantSource);
  if (origin.endsWith('disk-history-import-boundaries.test.mjs')) {
    output = output.replace("new URL('../hosts/history/import-fixed-xpc-from-disk-v1.mjs', import.meta.url)",
      `new URL('${pathToFileURL(variantSource).href}')`)
      .replace("new URL('../hosts/repository/snapshot-contract.mjs', import.meta.url).href",
        `new URL('${pathToFileURL(path.join(root, 'hosts/repository/snapshot-contract.mjs')).href}').href`)
      .replace("new URL('../history/history-capture-permit-v1.mjs', import.meta.url).href",
        `new URL('${pathToFileURL(path.join(root, 'history/history-capture-permit-v1.mjs')).href}').href`)
      .replace('original.replace("../repository/disk-capture.mjs", pathToFileURL(fakePath).href)',
        `original.replace('${pathToFileURL(path.join(root, 'hosts/repository/disk-capture.mjs')).href}', pathToFileURL(fakePath).href)`)
      .replace(/const IMPORT_SOURCE_SHA = '[0-9a-f]{64}';/,
        `const IMPORT_SOURCE_SHA = '${variantRawHash}';`);
  }
  return output;
}
function counts(stdout) {
  return Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => {
    const found = [...stdout.matchAll(new RegExp('^(?:# |ℹ )' + key + ' (\\d+)$', 'gm'))];
    assert.equal(found.length, 1, 'one terminal ' + key + ' count');
    return [key, Number(found[0][1])];
  }));
}
function execute(command, args, dir, timeout) {
  const child = spawnSync(command, args, {cwd: root, encoding: 'utf8', timeout, maxBuffer: 16_777_216});
  fs.writeFileSync(path.join(dir, 'stdout.txt'), child.stdout ?? '', {flag: 'wx'});
  fs.writeFileSync(path.join(dir, 'stderr.txt'), child.stderr ?? '', {flag: 'wx'});
  assert.equal(child.error, undefined, 'bounded child completed'); assert.equal(child.signal, null);
  const measured = counts(child.stdout);
  assert.equal(measured.cancelled + measured.skipped + measured.todo, 0);
  if (measured.fail > 0) {
    // Meaningful mutant failures must be assertions, not import/syntax/runtime failures.
    const codes = [...child.stdout.matchAll(/^\s+code: '([^']+)'$/gm)].map(match => match[1]);
    assert.equal(codes.length, measured.fail, 'one assertion code per failing mutant test');
    assert.ok(codes.every(code => code === 'ERR_ASSERTION'), 'no runtime failure may count as a mutant kill');
  }
  return {exitCode: child.status, ...measured};
}

const mutants = [
  ['skip-post-clock-native-abort', value => replaceOnce(value,
    "const clock = () => { try { return req.clock(); } finally { onAbort(); } };",
    "const clock = () => { try { return req.clock(); } finally { /* mutant */ } };")],
  ['accept-unknown-reader-class', value => replaceOnce(value,
    "return 'SOURCE_CAPTURE_FAILED';", "return typeof error?.code === 'string' ? error.code : 'SOURCE_CAPTURE_FAILED';")],
  ['hide-reader-failure-on-cancel', value => replaceOnce(value,
    "if (aborted()) return result('CANCELLED', 'ABORTED');\n    if (sourceFailure !== null)",
    "if (aborted()) { sourceFailure = null; return result('CANCELLED', 'ABORTED'); }\n    if (sourceFailure !== null)")],
  ['bypass-closed-handle-shape', value => replaceOnce(value,
    "c.status !== 'CAPTURED_TRUSTED_STATIC_INPUT' || c.handlesClosed !== true ||",
    "c.status !== 'CAPTURED_TRUSTED_STATIC_INPUT' || /* mutant accepts open handles */ false ||")],
  ['post-admission-cancel-masks-capture', value => replaceOnce(value,
    "retainedCapture = capture;\n    // A post-admission abort",
    "retainedCapture = capture;\n    if (aborted()) return result('CANCELLED', 'ABORTED');\n    // A post-admission abort")],
  ['retain-live-source-selection', value => replaceOnce(value,
    'return Object.freeze(value);', 'return input;')]
];

try {
  const targetedDir = path.join(evidence, 'targeted'); fs.mkdirSync(targetedDir);
  record.targeted = execute(process.execPath, ['--test', '--test-reporter=tap', ...testNames], targetedDir, 120_000);
  assert.deepEqual(record.targeted, {exitCode: 0, tests: 40, pass: 40, fail: 0, cancelled: 0, skipped: 0, todo: 0});

  // Prove the relocated harness itself passes before asking it to catch mutants.
  for (const [name, transform] of [['relocated-control', value => value], ...mutants]) {
    const dir = path.join(evidence, name); fs.mkdirSync(dir);
    const altered = transform(source); const variantSource = path.join(dir, 'source.mjs');
    // Write relocated imports, but pin the boundary harness to the raw semantic
    // variant hash so its source-drift guard cannot count as the mutant kill.
    fs.writeFileSync(variantSource, imports(altered, sourceName, variantSource), {flag: 'wx'});
    const tests = testNames.map((origin, index) => {
      const destination = path.join(dir, 'case-' + index + '.test.mjs');
      fs.writeFileSync(destination, relocatedTest(bytes(origin).toString('utf8'), origin,
        variantSource, hash(imports(altered, sourceName, variantSource))), {flag: 'wx'});
      return destination;
    });
    const outcome = execute(process.execPath, ['--test', '--test-reporter=tap', ...tests], dir, 120_000);
    if (name === 'relocated-control') {
      record.relocatedControl = outcome;
      assert.deepEqual(outcome, {exitCode: 0, tests: 40, pass: 40, fail: 0, cancelled: 0, skipped: 0, todo: 0});
      continue;
    }
    record.variants.push({name, canonicalSourceSha256: hash(source), semanticVariantSha256: hash(altered), ...outcome});
    assert.equal(outcome.tests, 40); assert.equal(outcome.pass + outcome.fail, 40);
    assert.equal(outcome.exitCode, 1, name + ' must be killed'); assert.ok(outcome.fail > 0, name + ' semantic failure');
  }

  const productDir = path.join(evidence, 'product'); fs.mkdirSync(productDir);
  record.product = execute('npm', ['run', 'check'], productDir, 120_000);
  assert.deepEqual(record.product, {exitCode: 0, tests: 1408, pass: 1408, fail: 0, cancelled: 0, skipped: 0, todo: 0});
  record.after = pins(); record.changed = names.filter(name => before[name] !== record.after[name]);
  assert.deepEqual(record.changed, []); record.status = 'PASS_SCOPED';
} catch (error) {
  record.status = 'FAIL'; record.failure = String(error?.message ?? error); process.exitCode = 1;
} finally {
  record.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(record, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({status: record.status, evidence, priorPinCount: record.priorPinCount,
    checkedFiles: record.checkedFiles, targeted: record.targeted, variants: record.variants,
    product: record.product, changed: record.changed ?? null, failure: record.failure ?? null}));
}
