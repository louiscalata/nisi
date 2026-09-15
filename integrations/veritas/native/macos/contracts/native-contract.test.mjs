// Private macOS contract checks. No Swift builds, model calls or release actions.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = process.env.VERITAS_CONTRACT_TEST_PACKAGE || path.resolve(here, '../CodenameVeritasFramework');
const required = JSON.parse(fs.readFileSync(path.join(here, 'native-required-paths-v1.json'), 'utf8'));
const helper = path.join(packageRoot, 'Scripts/source-manifest.zsh');
const readScript = name => fs.readFileSync(path.join(packageRoot, 'Scripts', name), 'utf8');
const run = (command, args, input) => spawnSync(command, args, { encoding: 'utf8', input, timeout: 30000, maxBuffer: 2 ** 22, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C' } });
const digest = value => createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const dir = fs.mkdtempSync('/private/tmp/veritas-native-contract-test-');
  // Only this generated fixture tree is removed; evidence logs stay outside it.
  t.after(() => fs.rmSync(dir, { recursive: true }));
  for (const relative of required) {
    const dest = path.join(dir, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, 'private test fixture\n', { flag: 'wx' });
  }
  return dir;
}
function manifest(dir) {
  return run('/bin/zsh', ['-c', 'source "$1"; veritas_build_source_manifest "$2"', 'contract-test', helper, dir]);
}
function refused(result) {
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0, result.stderr);
  assert.equal(result.stdout, '', 'inventory must fail before emitting partial evidence');
}

test('closed native inventory matches the independently retained 93-path fixture', t => {
  assert.equal(required.length, 93);
  assert.equal(new Set(required).size, 93);
  assert.deepEqual(required, [...required].sort());
  const result = manifest(fixture(t));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n').map(line => JSON.parse(line).path), required);
});
for (const relative of required) {
  test(`refuses missing required path: ${relative}`, t => {
    const dir = fixture(t);
    fs.unlinkSync(path.join(dir, relative));
    refused(manifest(dir));
  });
}
test('same-count omit-and-decoy substitution is refused', t => {
  const dir = fixture(t);
  fs.unlinkSync(path.join(dir, 'Tests/VeritasCoreTests/EngineEvidenceParityTests.swift'));
  fs.writeFileSync(path.join(dir, 'Tests/VeritasCoreTests/Decoy.swift'), 'decoy');
  refused(manifest(dir));
});
test('inventory still refuses when invoked in a shell conditional', t => {
  const dir = fixture(t);
  fs.unlinkSync(path.join(dir, 'Tests/VeritasCoreTests/EngineEvidenceParityTests.swift'));
  fs.writeFileSync(path.join(dir, 'Tests/VeritasCoreTests/Decoy.swift'), 'decoy');
  const result = run('/bin/zsh', ['-c', 'source "$1"; if veritas_build_source_manifest "$2"; then exit 99; else exit 0; fi', 'test', helper, dir]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});
for (const root of ['Sources', 'Tests', 'Scripts']) {
  test(`extra ${root} entry is refused`, t => {
    const dir = fixture(t);
    fs.writeFileSync(path.join(dir, root, 'extra'), 'extra');
    refused(manifest(dir));
  });
}
for (const kind of ['symlink', 'fifo']) {
  test(`${kind} is refused before hashing`, t => {
    const dir = fixture(t);
    const dest = path.join(dir, 'Tests/VeritasCoreTests/Fixtures/reference-mlp-v1.json');
    fs.unlinkSync(dest);
    if (kind === 'symlink') fs.symlinkSync('prepared-mlp-v1.json', dest);
    else assert.equal(run('/usr/bin/mkfifo', [dest]).status, 0);
    refused(manifest(dir));
  });
}
test('byte changes still change the manifest with identical path membership', t => {
  const dir = fixture(t);
  const before = manifest(dir);
  assert.equal(before.status, 0, before.stderr);
  fs.appendFileSync(path.join(dir, 'Sources/VeritasCore/ReferenceMLP.swift'), 'changed');
  const after = manifest(dir);
  assert.equal(after.status, 0, after.stderr);
  assert.notEqual(digest(before.stdout), digest(after.stdout));
});
test('out-of-scope private packets do not change the required native inventory', t => {
  const dir = fixture(t);
  fs.mkdirSync(path.join(dir, '.packets'));
  fs.writeFileSync(path.join(dir, '.packets/private.md'), 'private');
  const result = manifest(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim().split('\n').length, 93);
});

const lane26 = 'xcode-26.6_swift-6.3.3_sdk-26.5';
const lane27 = 'xcode-27.0_swift-6.4_sdk-27.0';
const algorithm = run('/bin/zsh', ['-c', 'source "$1"; print -r -- "$VERITAS_SOURCE_MANIFEST_ALGORITHM"', 'contract-test', helper]).stdout.trim();
const batch = { schema_version: 2, status: 'OPEN_PRIVATE_TWO_LANE_BATCH', comparison_batch_id: 'a'.repeat(32), platform_result_schema_version: 4, comparison_result_schema_version: 4, lane_ids: [lane26, lane27], expected_test_count_per_lane: 470, expected_suite_count_per_lane: 37, source_manifest_algorithm: algorithm, source_manifest_sha256: 'b'.repeat(64), independent_certification: false, authorizing: false };
for (const name of ['verify-platform-contract.zsh', 'compare-platform-contract-lanes.zsh', 'verify-afm-orchestration.zsh']) {
  test(`${name}: real closed batch filter accepts current counts and rejects stale/malformed evidence`, () => {
    const source = readScript(name);
    const match = source.match(/--arg algorithm "\$\{source_manifest_algorithm\}" '([\s\S]*?)' "\$\{batch_contract\}"/);
    assert.ok(match, 'real batch reader must be found, not replaced by a test oracle');
    const check = value => run('/usr/bin/jq', ['-e', '--arg', 'batch', batch.comparison_batch_id, '--arg', 'lane26', lane26, '--arg', 'lane27', lane27, '--arg', 'algorithm', algorithm, match[1]], JSON.stringify(value));
    assert.equal(check(batch).status, 0);
    for (const delta of [{ expected_test_count_per_lane: 462 }, { expected_test_count_per_lane: 454 }, { expected_test_count_per_lane: 446 }, { expected_suite_count_per_lane: 36 }, { expected_test_count_per_lane: 438 }, { expected_test_count_per_lane: 430 }, { expected_suite_count_per_lane: 35 }, { expected_test_count_per_lane: 420 }, { expected_suite_count_per_lane: 34 }, { expected_test_count_per_lane: '430' }, { expected_test_count_per_lane: 297 }, { expected_suite_count_per_lane: 25 }, { expected_test_count_per_lane: 332 }, { expected_test_count_per_lane: 333 }, { expected_test_count_per_lane: 338 }, { expected_test_count_per_lane: 339 }, { expected_test_count_per_lane: 341 }, { expected_test_count_per_lane: 353 }, { expected_test_count_per_lane: 369 }, { expected_test_count_per_lane: 371 }, { expected_test_count_per_lane: 384 }, { expected_test_count_per_lane: 386 }, { expected_test_count_per_lane: 398 }, { expected_test_count_per_lane: 400 }, { expected_test_count_per_lane: 402 }, { expected_test_count_per_lane: 410 }, { expected_suite_count_per_lane: 33 }, { expected_suite_count_per_lane: 32 }, { expected_suite_count_per_lane: 31 }, { expected_suite_count_per_lane: 30 }, { expected_suite_count_per_lane: 29 }, { expected_test_count_per_lane: '420' }, { authorizing: true }, { independent_certification: true }, { extra: false }, { schema_version: 3 }]) {
      assert.notEqual(check({ ...batch, ...delta }).status, 0, JSON.stringify(delta));
    }
  });
}

test('batch initializer emits source-bound current contract without authorizing', t => {
  const scratch = fs.mkdtempSync('/private/tmp/veritas-native-batch-test-');
  t.after(() => fs.rmSync(scratch, { recursive: true }));
  const result = run('/usr/bin/env', [`VERITAS_PLATFORM_SCRATCH_PATH=${scratch}`, `VERITAS_PLATFORM_COMPARISON_BATCH_ID=${batch.comparison_batch_id}`, '/bin/zsh', path.join(packageRoot, 'Scripts/initialize-platform-contract-batch.zsh')]);
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  assert.deepEqual(actual, { ...batch, source_manifest_sha256: actual.source_manifest_sha256 });
  const stored = fs.readFileSync(path.join(scratch, 'runs', batch.comparison_batch_id, 'source-manifest.sha256'));
  assert.equal(actual.source_manifest_sha256, digest(stored));
});

// Evaluate the exact existing verifier/comparator parser and lane assertion
// blocks, not a second reimplementation of those acceptance rules.
function parserShell(name, lane) {
  const source = readScript(name);
  if (name === 'verify-platform-contract.zsh') {
    const constants = source.slice(source.indexOf('expected_test_count='), source.indexOf('expected_binary_sdk='));
    const parser = source.slice(source.indexOf('test_totals="$('), source.indexOf("abrupt_restart_title=", source.indexOf('test_totals="$(')));
    assert.ok(parser.includes('observed_test_breakdown'));
    return `emulate -L zsh\nset -euo pipefail\nexpected_sdk=$1\ntest_log=$2\n${constants}\n${parser}`;
  }
  const fn = source.slice(source.indexOf('parse_test_totals() {'), source.indexOf('\n[[ -f "${batch_contract}"'));
  const matches = [...source.matchAll(/\.expected_test_breakdown == "([^"]+)" and\s+\.observed_test_breakdown == "([^"]+)"/g)];
  assert.equal(matches.length, 2);
  const expected = matches[lane === '26.5' ? 0 : 1][1];
  assert.equal(expected, matches[lane === '26.5' ? 0 : 1][2]);
  return `emulate -L zsh\nset -euo pipefail\n${fn}\nIFS=$'\\t' read -r tests suites summaries breakdown <<< "$(parse_test_totals "$2")"\n[[ "$breakdown" == "${expected}" ]]`;
}
const summary = (tests, suites) => `✔ Test run with ${tests} tests in ${suites} suites passed after 1.0 seconds.\n`;
test('CR09 retained quota inspects only matching directories and preserves its limit', t => {
  const source = readScript('test-cr09-parser-negatives.zsh');
  const start = source.indexOf('typeset -a retained_roots');
  const end = source.indexOf('\nfixture_root=', start);
  assert.ok(start > 0 && end > start);
  const block = source.slice(start, end);
  assert.ok(block.includes('retained_root_count') && block.includes('-lt 32'));
  const dir = fs.mkdtempSync('/private/tmp/veritas-native-quota-test-');
  t.after(() => fs.rmSync(dir, { recursive: true }));
  // Relocate only the constant test root; run the actual production quota code.
  const scoped = block.replaceAll('/private/tmp/', `${dir}/`);
  const script = `emulate -L zsh\nset -euo pipefail\n${scoped}\nprint -r -- "$retained_root_count"`;
  const check = () => run('/bin/zsh', ['-c', script]);
  fs.mkdirSync(path.join(dir, 'unrelated'));
  fs.writeFileSync(path.join(dir, 'veritas-cr09-parser-negatives.file'), 'not a directory');
  fs.symlinkSync('unrelated', path.join(dir, 'veritas-cr09-parser-negatives.link'));
  assert.equal(check().stdout.trim(), '0');
  for (let i = 0; i < 31; i++) fs.mkdirSync(path.join(dir, `veritas-cr09-parser-negatives.${i}`));
  assert.equal(check().status, 0);
  assert.equal(check().stdout.trim(), '31');
  fs.mkdirSync(path.join(dir, 'veritas-cr09-parser-negatives.31'));
  const result = check();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /retained-root quota reached/);
});
for (const name of ['verify-platform-contract.zsh', 'compare-platform-contract-lanes.zsh']) {
  for (const lane of ['26.5', '27.0']) {
    test(`${name}: lane ${lane} exact terminal summary contract`, t => {
      const dir = fs.mkdtempSync('/private/tmp/veritas-native-summary-test-');
      t.after(() => fs.rmSync(dir, { recursive: true }));
      const log = path.join(dir, 'summary.log');
      const script = parserShell(name, lane);
      const good = lane === '26.5' ? summary(470, 37) : summary(347, 30) + summary(26, 2) + summary(97, 5);
      const check = value => { fs.writeFileSync(log, value); return run('/bin/zsh', ['-c', script, 'test', lane, log]); };
      const result = check(good);
      assert.equal(result.status, 0, result.stderr);
      for (const bad of ['', summary(462, 37), summary(347, 30) + summary(18, 2) + summary(97, 5), summary(454, 37), summary(342, 30) + summary(18, 2) + summary(94, 5), summary(446, 36), summary(334, 29) + summary(18, 2) + summary(94, 5), summary(444, 36), summary(332, 29) + summary(18, 2) + summary(94, 5), summary(438, 36), summary(332, 29) + summary(18, 2) + summary(88, 5), summary(430, 35), summary(332, 29) + summary(10, 1) + summary(94, 5), summary(420, 34), summary(322, 28) + summary(10, 1) + summary(94, 5), summary(444, 36).repeat(2), summary(410, 33), summary(312, 27) + summary(10, 1) + summary(94, 5), summary(297, 25), summary(332, 27), summary(333, 26), summary(333, 27), summary(338, 28), summary(339, 28), summary(341, 28), summary(353, 29), summary(369, 30), summary(371, 30), summary(384, 31), summary(386, 31), summary(398, 32), summary(400, 33), summary(302, 27) + summary(10, 1) + summary(94, 5), summary(402, 33), summary(302, 27) + summary(10, 1) + summary(90, 5), summary(302, 27) + summary(10, 1) + summary(86, 4), summary(302, 27) + summary(10, 1) + summary(74, 3), summary(386, 28), summary(341, 27), good + good, good.replace('passed after', 'failed after'), summary(268, 25) + summary(11, 1) + summary(74, 3)]) {
        assert.notEqual(check(bad).status, 0, bad);
      }
    });
  }
}

test('parallel full-run aggregate independently rejects wrong totals', () => {
  const source = readScript('test-private-parallel.zsh');
  const match = source.match(/observed_full_breakdown="\$\(\/usr\/bin\/awk '([\s\S]*?)' "\$\{log_paths\[index\]\}"\)/);
  assert.ok(match);
  const check = value => run('/usr/bin/awk', [match[1]], value);
  assert.equal(check(summary(470, 37)).status, 0);
  assert.equal(check(summary(347, 30) + summary(26, 2) + summary(97, 5)).status, 0);
  for (const bad of ['', summary(462, 37), summary(347, 30) + summary(18, 2) + summary(97, 5), summary(454, 37), summary(342, 30) + summary(18, 2) + summary(94, 5), summary(446, 36), summary(334, 29) + summary(18, 2) + summary(94, 5), summary(444, 36), summary(332, 29) + summary(18, 2) + summary(94, 5), summary(438, 36), summary(332, 29) + summary(18, 2) + summary(88, 5), summary(430, 35), summary(332, 29) + summary(10, 1) + summary(94, 5), summary(420, 34), summary(322, 28) + summary(10, 1) + summary(94, 5), summary(444, 36).repeat(2), summary(410, 33), summary(312, 27) + summary(10, 1) + summary(94, 5), summary(297, 25), summary(332, 27), summary(333, 26), summary(333, 27), summary(338, 28), summary(339, 28), summary(341, 28), summary(353, 29), summary(369, 30), summary(371, 30), summary(384, 31), summary(386, 31), summary(398, 32), summary(400, 33), summary(302, 27) + summary(10, 1) + summary(94, 5), summary(402, 33), summary(302, 27) + summary(10, 1) + summary(90, 5), summary(302, 27) + summary(10, 1) + summary(86, 4), summary(302, 27) + summary(10, 1) + summary(74, 3), summary(386, 28), summary(341, 27), summary(420, 34).repeat(2)]) assert.notEqual(check(bad).status, 0);
});
for (const lane of ['xcode-26.6', 'xcode-27']) {
  test(`parallel full-run ${lane}: execute actual lane choice and refusal`, t => {
    const source = readScript('test-private-parallel.zsh');
    const start = source.indexOf('        if [[ -z "${VERITAS_TEST_FILTER:-}" ]]; then');
    const end = source.indexOf('        if [[ -z "${VERITAS_TEST_FILTER:-}"', start + 1);
    assert.ok(start > 0 && end > start);
    const block = source.slice(start, end);
    assert.ok(block.includes('observed_full_breakdown') && block.includes('overall=1'));
    const dir = fs.mkdtempSync('/private/tmp/veritas-native-parallel-test-');
    t.after(() => fs.rmSync(dir, { recursive: true }));
    const log = path.join(dir, 'summary.log');
    const script = `emulate -L zsh\nset -euo pipefail\nlane=$1\nlog_paths=("$2")\noverall=0\nfor index in 1; do\n${block}\ndone\nexit "$overall"`;
    const check = value => { fs.writeFileSync(log, value); return run('/bin/zsh', ['-c', script, 'test', lane, log]); };
    const one = summary(470, 37);
    const three = summary(347, 30) + summary(26, 2) + summary(97, 5);
    const good = lane === 'xcode-27' ? three : one;
    assert.equal(check(good).status, 0);
    for (const bad of ['', summary(462, 37), summary(347, 30) + summary(18, 2) + summary(97, 5), summary(454, 37), summary(342, 30) + summary(18, 2) + summary(94, 5), summary(446, 36), summary(334, 29) + summary(18, 2) + summary(94, 5), summary(444, 36), summary(332, 29) + summary(18, 2) + summary(94, 5), summary(438, 36), summary(332, 29) + summary(18, 2) + summary(88, 5), summary(430, 35), summary(332, 29) + summary(10, 1) + summary(94, 5), summary(420, 34), summary(322, 28) + summary(10, 1) + summary(94, 5), summary(444, 36).repeat(2), summary(410, 33), summary(312, 27) + summary(10, 1) + summary(94, 5), summary(297, 25), summary(332, 27), summary(333, 26), summary(333, 27), summary(338, 28), summary(339, 28), summary(341, 28), summary(353, 29), summary(369, 30), summary(371, 30), summary(384, 31), summary(386, 31), summary(398, 32), summary(400, 33), summary(302, 27) + summary(10, 1) + summary(94, 5), summary(402, 33), summary(302, 27) + summary(10, 1) + summary(90, 5), summary(302, 27) + summary(10, 1) + summary(86, 4), summary(302, 27) + summary(10, 1) + summary(74, 3), summary(386, 28), summary(341, 27), good + good, lane === 'xcode-27' ? one : three, summary(268, 25) + summary(11, 1) + summary(74, 3)]) {
      assert.notEqual(check(bad).status, 0, bad);
    }
  });
}
