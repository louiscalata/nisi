// PRIVATE fixed lifecycle/reservation mutants. No kernel or candidate execution.
// Retains generated copies, adverse output and exact expected failures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { hashBytes } from '../hosts/swift-verifier/protocol.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const owner = 'hosts/swift-verifier/owned-child.mjs', reservation = 'hosts/swift-verifier/reservation.mjs';
const ownerTests = 'tests/swift-owned-child.test.mjs', reservationTests = 'tests/swift-reservation.test.mjs';
const files = [owner, reservation, ownerTests, reservationTests, 'hosts/swift-verifier/protocol.mjs',
  'hosts/repository/snapshot-contract.mjs', 'workflow/contracts.mjs', 'canonical/canonical-json-v1.mjs'];
const sources = new Map(files.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
const variants = [
  ['O01-late-spawn-containment', owner,
    'try { returned = child.kill(\'SIGKILL\') === true; } catch { returned = false; }', 'returned = false;',
    ['spawn arriving after grace finalization is contained without rewriting the old observation']],
  ['O02-final-duration', owner,
    'durationMs: started ? elapsed() : 0 }) });', 'durationMs: prepared.process.durationMs }) });',
    ['published duration includes the final monotonic sample rather than a previous sample']],
  ['O03-unknown-close-quarantine', owner,
    "state = reusable ? 'IDLE' : 'QUARANTINED';", "state = 'IDLE';",
    ['unknown close after abort quarantines even after a late close or additional output',
      'spawn arriving after grace finalization is contained without rewriting the old observation']],
  ['O04-output-retention-cap', owner,
    'const count = Math.min(chunk.length, maximumOutputBytes - stream.captured);', 'const count = chunk.length;',
    ['output overflow retains bounded bytes and continues counting until close']],
  ['R01-parent-sync', reservation, '    syncDirectory(file);', '    void file;',
    ['parent directory sync failure leaves an uncertain marker before any launch']],
  ['R02-marker-content-identity', reservation,
    'offset !== ticket.byteLength || hashBytes(bytes.subarray(0, offset)) !== ticket.sha256',
    'offset !== ticket.byteLength',
    ['same-length marker corruption is detected by content identity before release']],
];
fs.mkdirSync(path.join(root, '.build'), { recursive: true });
const directory = fs.mkdtempSync(path.join(root, '.build/swift-owner-mutants-'));
function run(cwd, tests, output) {
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...tests], {
    cwd, encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 2 * 1_048_576 });
  fs.writeFileSync(path.join(output, 'stdout.txt'), result.stdout ?? '');
  fs.writeFileSync(path.join(output, 'stderr.txt'), result.stderr ?? '');
  return result;
}
const control = run(root, [ownerTests, reservationTests], directory);
assert(!control.error && control.status === 0 && /^# fail 0$/m.test(control.stdout), 'Unmodified control must pass');
const results = [];
for (const [id, subject, before, after, expectedFailures] of variants) {
  assert.equal(sources.get(subject).split(before).length, 2, `${id}: exactly one site required`);
  const copy = path.join(directory, id);
  for (const [file, content] of sources) {
    const target = path.join(copy, file); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file === subject ? content.replace(before, after) : content);
  }
  const result = run(copy, [subject === owner ? ownerTests : reservationTests], copy);
  const failed = Number(result.stdout?.match(/^# fail (\d+)$/m)?.[1] ?? NaN);
  const failures = [...(result.stdout ?? '').matchAll(/^not ok \d+ - (.+)$/gm)].map(m => m[1]);
  results.push({ id, expectedFailures, exitCode: result.status, signal: result.signal,
    errorCode: result.error?.code ?? null, failedChecks: Number.isFinite(failed) ? failed : null, failures,
    caught: !result.error && result.signal === null && result.status === 1 && failed === expectedFailures.length &&
      JSON.stringify(failures) === JSON.stringify(expectedFailures) });
}
const report = { schemaVersion: 1, scope: 'FOUR_LIFECYCLE_DOUBLE_AND_TWO_REAL_LOCAL_RESERVATION_MUTANTS_ONLY',
  controlExitCode: control.status, evidenceDirectory: directory,
  sourceHashes: [...sources].map(([file, value]) => ({ file, sha256: hashBytes(Buffer.from(value)) })),
  results, platform: process.platform, architecture: process.arch, nodeVersion: process.version,
  nativeProcessExecuted: false, wholeHostVerified: false, authorizing: false };
fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (results.some(result => !result.caught)) process.exitCode = 1;
