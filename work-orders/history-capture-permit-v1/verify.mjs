// Bounded private acceptance. Copies/mutants/evidence only in a newly owned dir.
// Never executes native apps/models, edits inputs, installs or publishes anything.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceName = 'history/history-capture-permit-v1.mjs';
const testNames = ['tests/history-capture-permit-v1.test.mjs', 'tests/history-capture-permit-adjudication.test.mjs'];
const hash = text => createHash('sha256').update(text).digest('hex');
const bytes = name => fs.readFileSync(path.join(root, name));
const source = bytes(sourceName).toString('utf8');
const previous = JSON.parse(bytes('.build/journal-owner-integration-tnBa5H/verification.json')).after;
assert.equal(Object.keys(previous).length, 231);
for (const [name, expected] of Object.entries(previous)) assert.equal(hash(bytes(name)), expected, name);
const names = [...Object.keys(previous), sourceName, ...testNames].sort();
assert.equal(new Set(names).size, 234);
const pins = () => Object.fromEntries(names.map(name => [name, hash(bytes(name))]));
const before = pins();
const evidence = fs.mkdtempSync(path.join(root, '.build/history-capture-verification-'));
const record = {schemaVersion: 1, status: 'INCOMPLETE', startedAt: new Date().toISOString(),
  evidence, node: process.version, before, variants: [], authorizing: false,
  scope: 'Source-checkout portable history admission; no native/consent-auth/release acceptance'};

function replaceOnce(input, old, next) {
  assert.equal(input.split(old).length, 2, 'exact mutation target');
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
function counts(stdout) {
  return Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => {
    const matches = [...stdout.matchAll(new RegExp('^(?:# |ℹ )' + key + ' (\\d+)$', 'gm'))];
    assert.equal(matches.length, 1, 'one terminal ' + key + ' count');
    return [key, Number(matches[0][1])];
  }));
}
function execute(command, args, dir, cap) {
  const result = spawnSync(command, args, {cwd: root, encoding: 'utf8', timeout: cap, maxBuffer: 16777216});
  fs.writeFileSync(path.join(dir, 'stdout.txt'), result.stdout ?? '', {flag: 'wx'});
  fs.writeFileSync(path.join(dir, 'stderr.txt'), result.stderr ?? '', {flag: 'wx'});
  assert.equal(result.error, undefined, 'finite child result');
  assert.equal(result.signal, null);
  const measured = counts(result.stdout);
  assert.equal(measured.cancelled + measured.skipped + measured.todo, 0);
  return {exitCode: result.status, ...measured};
}

const variants = [
  ['baseline', value => value],
  ['skip-source-binding', value => replaceOnce(value,
    "if (sha(Buffer.from(text, 'utf8')) !== d.sourceSha256)", 'if (false)')],
  ['skip-pre-record-clock', value => replaceOnce(value, 'const final = currentTime(state);', 'const final = initial;')],
  ['consume-after-record', value => replaceOnce(replaceOnce(value,
    'state.consumed = true; admitted = true;', 'admitted = true;'),
    'const journal = recordJournalObservation({owner: state.owner, entry, now: final.now});',
    'const journal = recordJournalObservation({owner: state.owner, entry, now: final.now}); state.consumed = true;')],
  ['ignore-clock-revocation', value => {
    const line = "if (state.revoked) return {reason: 'PERMIT_REVOKED'};";
    assert.equal(value.split(line).length, 3);
    return value.replaceAll(line, '// deliberately ignored revoke');
  }],
  ['hide-commit-uncertainty', value => replaceOnce(value,
    "? 'UNCERTAIN' : 'STORE_FAILED'", "? 'STORE_FAILED' : 'STORE_FAILED'")],
  ['attest-unauthenticated-consent', value => replaceOnce(value,
    "consentClass: 'WRITTEN_DECLARATION', consentAuthenticityAttested: false,",
    "consentClass: 'WRITTEN_DECLARATION', consentAuthenticityAttested: true,")],
  ['regress-revoke-then-throw', value => replaceOnce(value,
    "    if (state.revoked) return {reason: 'PERMIT_REVOKED'};\n    state.revoked = true;",
    '    state.revoked = true;')]
];
try {
  for (const [name, transform] of variants) {
    const dir = path.join(evidence, name); fs.mkdirSync(dir);
    const variantSource = path.join(dir, 'source.mjs');
    const altered = transform(source);
    fs.writeFileSync(variantSource, imports(altered, sourceName, variantSource), {flag: 'wx'});
    const tests = testNames.map((origin, index) => {
      const destination = path.join(dir, 'case-' + index + '.test.mjs');
      fs.writeFileSync(destination, imports(bytes(origin).toString('utf8'), origin, variantSource), {flag: 'wx'});
      return destination;
    });
    const outcome = execute(process.execPath, ['--test', '--test-reporter=tap', ...tests], dir, 20000);
    record.variants.push({name, originalSourceSha256: hash(source), variantSourceSha256: hash(altered), ...outcome});
    assert.equal(outcome.tests, 37);
    assert.equal(outcome.pass + outcome.fail, 37);
    if (name === 'baseline') { assert.equal(outcome.exitCode, 0); assert.equal(outcome.pass, 37); }
    else { assert.equal(outcome.exitCode, 1); assert.ok(outcome.fail > 0, name + ' must be killed'); }
  }
  const productDir = path.join(evidence, 'product'); fs.mkdirSync(productDir);
  record.product = execute('npm', ['run', 'check'], productDir, 120000);
  assert.deepEqual(record.product, {exitCode: 0, tests: 1368, pass: 1368, fail: 0, cancelled: 0, skipped: 0, todo: 0});
  record.after = pins();
  record.changed = names.filter(name => before[name] !== record.after[name]);
  assert.deepEqual(record.changed, []);
  record.status = 'PASS_SCOPED';
} catch (error) {
  record.status = 'FAIL'; record.failure = String(error.message); process.exitCode = 1;
} finally {
  record.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(record, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({status: record.status, evidence, checkedFiles: names.length,
    variants: record.variants, product: record.product ?? null, failure: record.failure ?? null}));
}
