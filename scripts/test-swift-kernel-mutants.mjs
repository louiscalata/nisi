// PRIVATE, fixed reviewed kernel only. Retains copied sources and adverse output.
// Not arbitrary candidate execution; no edits to the imported/canonical source.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { hashBytes } from '../hosts/swift-verifier/protocol.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const native = 'hosts/swift-verifier/main.swift', protocol = 'hosts/swift-verifier/protocol.mjs';
const nativeTests = 'tests/native/swift-kernel.test.mjs', pureTests = 'tests/swift-kernel-protocol.test.mjs';
const prefix = 'integrations/veritas/native/macos/CodenameVeritasFramework/Sources/VeritasCore/';
const files = [native, protocol, 'hosts/swift-verifier/build.mjs', nativeTests, pureTests,
  'hosts/repository/snapshot-contract.mjs', 'workflow/contracts.mjs', 'canonical/canonical-json-v1.mjs',
  'integrations/veritas/import-manifest.json', ...['ArtifactSnapshot.swift', 'StrictJSONDocumentValidator.swift',
    'DeterministicChecks.swift'].map(n => prefix + n)];
const sources = new Map(files.map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')]));
const variants = [
  ['N01-artifact-digest', native, 'try field("artifactSha256") == ArtifactSnapshot.digest(artifact)', 'true',
    'real native header rejects ambiguous schema values and stale source rules or artifact identities'],
  ['N02-source-identity', native, 'try field("sourceFingerprint") == NisiBuildIdentity.sourceFingerprint', 'true',
    'real native header rejects ambiguous schema values and stale source rules or artifact identities'],
  ['N03-artifact-limit', native, 'guard artifact.count <= artifactCap,', 'guard true,',
    'real native input cap uses UTF8 bytes and keeps exact boundary artifacts'],
  ['J01-bound-identity', protocol, "if (report[key] !== value) refuse('SWIFT_RESPONSE_IDENTITY');", 'void value;',
    'Swift report reader rejects every substituted header identity and request byte count'],
  ['J02-outcome-inventory', protocol,
    "if (outcomes[0].id !== 'DET-001-NONEMPTY' || outcomes[1].id !== 'DET-002-UTF8' ||\n      outcomes[2].id !== structure)", 'if (false)',
    'Swift report reader requires the exact ordered complete check inventory'],
  ['J03-aggregate', protocol, "if (report.status !== derived) refuse('SWIFT_AGGREGATE_STATUS');", 'void derived;',
    'Swift unknown incomplete and contradictory statuses cannot become PASS'],
];
fs.mkdirSync(path.join(root, '.build'), { recursive: true });
const directory = fs.mkdtempSync(path.join(root, '.build/swift-kernel-mutants-'));
function run(cwd, selected, output) {
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...selected], {
    cwd, encoding: 'utf8', timeout: 45_000, killSignal: 'SIGKILL', maxBuffer: 2 * 1_048_576 });
  fs.writeFileSync(path.join(output, 'stdout.txt'), result.stdout ?? '');
  fs.writeFileSync(path.join(output, 'stderr.txt'), result.stderr ?? '');
  return result;
}
const control = run(root, [nativeTests, pureTests], directory);
assert(!control.error && control.status === 0 && /^# fail 0$/m.test(control.stdout), 'Unmodified control must pass');
const results = [];
for (const [id, subject, before, after, expectedFailure] of variants) {
  assert.equal(sources.get(subject).split(before).length, 2, `${id}: exactly one site required`);
  const copy = path.join(directory, id);
  for (const [file, content] of sources) {
    const target = path.join(copy, file); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file === subject ? content.replace(before, after) : content);
  }
  const result = run(copy, [subject === native ? nativeTests : pureTests], copy);
  const failed = Number(result.stdout?.match(/^# fail (\d+)$/m)?.[1] ?? NaN);
  const failures = [...(result.stdout ?? '').matchAll(/^not ok \d+ - (.+)$/gm)].map(m => m[1]);
  results.push({ id, expectedFailure, exitCode: result.status, signal: result.signal,
    errorCode: result.error?.code ?? null, failedChecks: Number.isFinite(failed) ? failed : null, failures,
    caught: !result.error && result.signal === null && result.status === 1 && failed === 1 &&
      failures.length === 1 && failures[0] === expectedFailure });
}
const report = { schemaVersion: 1, scope: 'THREE_COMPILED_KERNEL_AND_THREE_READER_MUTANTS_ONLY',
  controlExitCode: control.status, evidenceDirectory: directory,
  sourceHashes: [...sources].map(([file, value]) => ({ file, sha256: hashBytes(Buffer.from(value)) })),
  results, platform: process.platform, architecture: process.arch, nodeVersion: process.version,
  wholeHostVerified: false, authorizing: false };
fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (results.some(r => !r.caught)) process.exitCode = 1;
