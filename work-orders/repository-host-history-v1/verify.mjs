// Bounded repository-host history verification. All relocated modules, mutants,
// and evidence live in one newly owned .build directory; product inputs stay read-only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const priorName = '.build/journal-maintenance-verification-qbLBtS/verification.json';
const hostName = 'hosts/repository/reviewed-workflow-v1.mjs';
const helperName = 'history/repository-host-history-v1.mjs';
const testName = 'tests/repository-host-history.test.mjs';
const expected = {
  [hostName]: '6b53aa8d6d88039c7905baebc2621402ad7cce4ecc23d5fa5574e4b32d881079',
  [helperName]: 'e74aa40389a1c132ec535c77a90b0e56a61b91aa20126b48546b5942091d5418',
  [testName]: '4defe3061e7b8620c7bd4744af067da9a770b4e81a2c519e124a1b7b4562ca06'
};
const hash = value => createHash('sha256').update(value).digest('hex');
const bytes = name => fs.readFileSync(path.join(root, name));
const hostSource = bytes(hostName).toString('utf8'), helperSource = bytes(helperName).toString('utf8');
const prior = JSON.parse(bytes(priorName));
assert.equal(prior.status, 'PASS_SCOPED'); assert.equal(Object.keys(prior.after).length, 240);
for (const [name, expectedHash] of Object.entries(prior.after)) {
  if (name === hostName) assert.notEqual(hash(bytes(name)), expectedHash, 'sole intentional prior change');
  else assert.equal(hash(bytes(name)), expectedHash, name);
}
assert.equal(Object.keys(prior.after).filter(name => name !== hostName).length, 239);
for (const [name, expectedHash] of Object.entries(expected)) assert.equal(hash(bytes(name)), expectedHash, name);
const names = [...Object.keys(prior.after), helperName, testName].sort();
assert.equal(names.length, 242); assert.equal(new Set(names).size, 242);
const pins = () => Object.fromEntries(names.map(name => [name, hash(bytes(name))]));
const before = pins();
const evidence = fs.mkdtempSync(path.join(root, '.build/repository-host-history-verification-'));
const record = {schemaVersion: 1, status: 'INCOMPLETE', startedAt: new Date().toISOString(), evidence,
  node: process.version, priorVerification: priorName, priorPinCount: 240, unchangedPriorPins: 239,
  intentionalPriorChange: hostName, checkedFiles: 242, before, targeted: null, relocatedControl: null,
  variants: [], product: null, authorizing: false,
  scope: 'Actual repository host metadata-only history capture; no native execution, consent authentication, learning, or release acceptance'};

function replaceOnce(input, old, next) {
  assert.equal(input.split(old).length, 2, 'exact one-site mutation target: ' + old.slice(0, 100));
  return input.replace(old, next);
}
function relocate(text, origin, destinations) {
  return text.replace(/from '([^']+)'/g, (whole, specifier) => {
    if (!specifier.startsWith('.')) return whole;
    const resolved = path.resolve(path.dirname(path.join(root, origin)), specifier);
    const relative = path.relative(root, resolved);
    return "from '" + pathToFileURL(destinations[relative] ?? resolved).href + "'";
  });
}
function counters(stdout) {
  return Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(key => {
    const found = [...stdout.matchAll(new RegExp('^(?:# |ℹ )' + key + ' (\\d+)$', 'gm'))];
    assert.equal(found.length, 1, 'one terminal ' + key + ' count');
    return [key, Number(found[0][1])];
  }));
}
function execute(command, args, dir, timeout) {
  const child = spawnSync(command, args, {cwd: root, encoding: 'utf8', timeout, maxBuffer: 16_777_216});
  fs.writeFileSync(path.join(dir, 'stdout.txt'), child.stdout ?? '', {flag: 'wx'});
  fs.writeFileSync(path.join(dir, 'stderr.txt'), child.stderr ?? '', {flag: 'wx'});
  assert.equal(child.error, undefined, 'finite child completion'); assert.equal(child.signal, null);
  const measured = counters(child.stdout); assert.equal(measured.cancelled + measured.skipped + measured.todo, 0);
  const codes = [...child.stdout.matchAll(/^\s+code: '([^']+)'$/gm)].map(match => match[1]);
  assert.equal(codes.length, measured.fail, 'one node:test code per failed test');
  const assertionFailures = codes.filter(code => code === 'ERR_ASSERTION').length;
  return {exitCode: child.status, ...measured, assertionFailures,
    nonAssertionFailures: codes.length - assertionFailures,
    failureCodes: Object.fromEntries([...new Set(codes)].sort().map(code => [code, codes.filter(x => x === code).length]))};
}
const passing = count => ({exitCode: 0, tests: count, pass: count, fail: 0, cancelled: 0,
  skipped: 0, todo: 0, assertionFailures: 0, nonAssertionFailures: 0, failureCodes: {}});

const variants = [
  ['relocated-control', value => value],
  ['drop-preview-digest-domain', value => replaceOnce(value,
    "sha256: preview === null ? null : hash(PREVIEW_DOMAIN, preview)",
    "sha256: preview === null ? null : sha256Text(stableStringify(preview))")],
  ['claim-busy-after-first-clock', value => replaceOnce(value,
    "busy = true;\n    try {\n      const initial = readClock(req.clock, d);",
    "try {\n      const initial = readClock(req.clock, d);\n      busy = true;")],
  ['consume-after-record-callback', value => replaceOnce(value,
    "consumed = true; recordAttempted = true;\n      const journal = recordJournalObservation({owner:req.owner, entry, now:final.now});",
    "recordAttempted = true;\n      const journal = recordJournalObservation({owner:req.owner, entry, now:final.now});\n      consumed = true;")],
  ['refund-refused-record-attempt', value => replaceOnce(value,
    "const journal = recordJournalObservation({owner:req.owner, entry, now:final.now});\n      let status;",
    "const journal = recordJournalObservation({owner:req.owner, entry, now:final.now});\n      if (journal.status === 'REFUSED') consumed = false;\n      let status;")],
  ['skip-final-clock', value => replaceOnce(value,
    'const final = readClock(req.clock, d, initial.now);',
    'const final = initial;')],
  ['ignore-task-binding', value => replaceOnce(value,
    "if (report.taskFingerprint !== taskFingerprint) return previewResult('TASK_IDENTITY_MISMATCH');",
    "if (false) return previewResult('TASK_IDENTITY_MISMATCH');")],
  ['leak-raw-diagnostic-code', value => replaceOnce(value,
    "return sha256Text(CODE_DOMAIN + '\\0' + value);",
    'return value;')],
  ['fabricate-candidate-namespace', value => replaceOnce(value,
    "candidateId:body.candidatePresent ? 'cand:' + body.candidateFingerprint : 'none:' + body.runId,",
    "candidateId:'cand:' + body.candidateFingerprint,")]
];

try {
  const targetDir = path.join(evidence, 'targeted'); fs.mkdirSync(targetDir);
  record.targeted = execute(process.execPath, ['--test', '--test-reporter=tap', testName], targetDir, 20_000);
  assert.deepEqual(record.targeted, passing(30));

  for (const [name, transform] of variants) {
    const dir = path.join(evidence, name); fs.mkdirSync(dir);
    const hostPath = path.join(dir, 'reviewed-workflow-v1.mjs');
    const helperPath = path.join(dir, 'repository-host-history-v1.mjs');
    const testPath = path.join(dir, 'repository-host-history.test.mjs');
    const destinations = {[hostName]: hostPath, [helperName]: helperPath};
    const alteredHelper = transform(helperSource);
    fs.writeFileSync(helperPath, relocate(alteredHelper, helperName, destinations), {flag: 'wx'});
    fs.writeFileSync(hostPath, relocate(hostSource, hostName, destinations), {flag: 'wx'});
    fs.writeFileSync(testPath, relocate(bytes(testName).toString('utf8'), testName, destinations), {flag: 'wx'});
    const outcome = execute(process.execPath, ['--test', '--test-reporter=tap', testPath], dir, 20_000);
    const item = {name, canonicalHostSha256: hash(hostSource), canonicalHelperSha256: hash(helperSource),
      semanticHelperSha256: hash(alteredHelper), ...outcome};
    if (name === 'relocated-control') {
      record.relocatedControl = item; assert.deepEqual(outcome, passing(30));
    } else {
      record.variants.push(item); assert.equal(outcome.tests, 30); assert.equal(outcome.pass + outcome.fail, 30);
      assert.equal(outcome.exitCode, 1, name + ' must be killed');
      assert.ok(outcome.assertionFailures > 0, name + ' requires semantic assertions; runtime-only failure is not a kill');
    }
  }

  const productDir = path.join(evidence, 'product'); fs.mkdirSync(productDir);
  record.product = execute('npm', ['run', 'check'], productDir, 120_000);
  assert.deepEqual(record.product, passing(1472));
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
