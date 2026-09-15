// Retain the finite independent-oracle result before implementation.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = fs.readFileSync(new URL('../../history/journal-owner-v2.mjs', import.meta.url), 'utf8');
if (!source.includes("reason: 'NOT_IMPLEMENTED'")) throw Error('not the expected maintenance stub');
const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/journal-maintenance-v1.test.mjs'],
  {cwd: root, encoding: 'utf8', timeout: 20000, maxBuffer: 1048576});
fs.writeFileSync(new URL('evidence/red.txt', import.meta.url), run.stdout + run.stderr, {flag: 'wx'});
const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => {
  const match = run.stdout.match(new RegExp('^# ' + key + ' (\\d+)$', 'm'));
  return [key, match ? Number(match[1]) : null];
}));
const result = {status: 'RED_OBSERVED', sourceSha256: createHash('sha256').update(source).digest('hex'),
  exitCode: run.status, signal: run.signal, error: run.error?.code ?? null, ...counts};
fs.writeFileSync(new URL('evidence/red.json', import.meta.url), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify(result));
if (run.error || run.signal || run.status !== 1 || counts.tests !== 32 || counts.fail < 1 ||
  counts.cancelled !== 0 || counts.skipped !== 0 || counts.todo !== 0) process.exitCode = 1;
