// Private, deliberately broken inventory copies; never touches canonical source.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const subject = 'hosts/local-models/discovery.mjs';
const testFile = 'tests/local-model-discovery.test.mjs';
const files = [subject, testFile, 'adapters/local-chat.mjs', 'workflow/contracts.mjs'];
const sources = new Map(files.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
const source = sources.get(subject);
const originGuard = source.split('\n').find(line => line.includes("fail('INVENTORY_ORIGIN_REFUSED');") && line.includes('typeof value'));
const variants = [
  ['D01-origin', originGuard, '  // origin guard deliberately removed', 'bad origin/config is refused before any transport'],
  ['D02-authority', "useAuthorization: 'NONE'", "useAuthorization: 'APPROVED'", 'inventory never grants use, local-only, free, licensed or inference-ready status'],
  ['D03-bytes', 'if (accounting.bytesRead > cap)', 'if (false)', 'oversized response is refused and its body cancelled'],
  ['D04-deadline', "if (stopCode || performance.now() - started >= config.timeoutMs) fail(stopCode ?? 'INVENTORY_TIMEOUT');",
    '// final deadline deliberately removed', 'final hashing delay cannot turn a late inventory into LISTED'],
  ['D05-quarantine', "if (pendingTransports.size) fail('INVENTORY_TRANSPORT_UNSETTLED');",
    '// transport quarantine deliberately removed', 'unsettled timeout prevents later runtimes and repeated discovery until actual settlement'],
  ['D06-duplicates', "if (ids.has(modelId)) fail('INVENTORY_DUPLICATE_MODEL');",
    '// duplicate model guard deliberately removed', 'malformed provider shape, entries, duplicate IDs and oversized model count refuse the entire runtime'],
];
fs.mkdirSync(path.join(root, '.build'), { recursive: true });
const directory = fs.mkdtempSync(path.join(root, '.build/local-model-discovery-mutants-'));
function run(cwd, output) {
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', testFile], {
    cwd, encoding: 'utf8', timeout: 15_000, maxBuffer: 1_048_576 });
  fs.writeFileSync(path.join(output, 'stdout.txt'), result.stdout ?? '');
  fs.writeFileSync(path.join(output, 'stderr.txt'), result.stderr ?? '');
  return result;
}
const control = run(root, directory);
assert(!control.error && control.status === 0 && /^# fail 0$/m.test(control.stdout), 'Control must pass');
const results = [];
for (const [id, before, after, expectedFailure] of variants) {
  assert(before && source.split(before).length === 2, `${id}: exactly one site`);
  const copy = path.join(directory, id);
  for (const [file, content] of sources) {
    const target = path.join(copy, file); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file === subject ? content.replace(before, after) : content);
  }
  const result = run(copy, copy);
  const failures = [...(result.stdout ?? '').matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]);
  const failedChecks = Number(result.stdout?.match(/^# fail (\d+)$/m)?.[1] ?? NaN);
  results.push({ id, expectedFailure, exitCode: result.status, error: result.error?.code ?? null,
    failedChecks: Number.isFinite(failedChecks) ? failedChecks : null, failures,
    caught: !result.error && result.status === 1 && failures.includes(expectedFailure) && failedChecks === failures.length });
}
const report = { schemaVersion: 1, scope: 'REGISTERED_RUNTIME_INVENTORY_ONLY', evidenceDirectory: directory,
  controlExitCode: control.status, controlTests: Number(control.stdout.match(/^# tests (\d+)$/m)[1]),
  sources: Object.fromEntries([...sources].map(([file, content]) => [file, createHash('sha256').update(content).digest('hex')])),
  results, liveModelsTested: false, authorizing: false };
fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (results.some(result => !result.caught)) process.exitCode = 1;
