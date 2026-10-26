// Private Mac verification only: deterministic tests, no model or provider calls.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const directory = mkdtempSync(path.join(root, '.build/opencode-local-verification-'));
const tests = ['opencode-orchestration-v1', 'local-chat', 'local-chat-output-mode',
  'local-chat-gap-regression', 'local-chat-lifecycle', 'local-chat-extra',
  'local-chat-response-matrix', 'local-model-discovery', 'workflow']
  .map(name => `tests/${name}.test.mjs`);
const selected = [
  ...tests, 'hosts/local-models/opencode-orchestration-v1.mjs',
  'hosts/local-models/discovery.mjs', 'adapters/local-chat.mjs',
  'workflow/contracts.mjs', 'workflow/engine.mjs',
  'work-orders/opencode-local-orchestration-v1/live-smoke.mjs',
  'work-orders/opencode-local-orchestration-v1/verify-local.mjs',
  'work-orders/opencode-local-orchestration-v1/test_packet_runner_queue.py',
  '~/.config/opencode/tools/nisi_local.ts',
  '~/.config/opencode/opencode.jsonc',
  '~/.config/opencode/skills/opencode-online-code-mode/SKILL.md',
  '~/.config/opencode/commands/initiate-online-code-mode.md',
  '~/.config/opencode/prompts/online.txt',
  '~/.config/opencode/prompts/offline.txt',
  '~/.agents/skills/initiate-online-code-mode/SKILL.md',
  '~/.claude/skills/initiate-online-code-mode/SKILL.md',
  '~/bin/chami-packet/releases/20260913-audit-v1/packet_run.py',
  '~/bin/chami-packet/releases/20260913-audit-v1/bounded_exec.py',
  '~/bin/packet-queue-run',
];
const snapshot = () => selected.map(file => {
  const bytes = readFileSync(path.resolve(root, file));
  return { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
});
const before = snapshot();
const commands = [
  [process.execPath, ['--test', ...tests]],
  ['python3', [path.join(here, 'test_packet_runner_queue.py')]],
  [process.execPath, ['--check', '~/.config/opencode/tools/nisi_local.ts']],
  [process.execPath, ['--check', path.join(here, 'live-smoke.mjs')]],
];
const results = commands.map(([program, args]) => {
  const started = performance.now();
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8',
    timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  return { program, args, status: result.status === 0 && !result.error && !result.signal ? 'PASS' : 'FAIL',
    exitCode: result.status, signal: result.signal, errorCode: result.error?.code ?? null,
    elapsedMs: Math.round(performance.now() - started), stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
});
const after = snapshot();
const unchanged = JSON.stringify(before) === JSON.stringify(after);
const report = { kind: 'nisi.opencode.selected-verification.v1', createdAt: new Date().toISOString(),
  status: unchanged && results.every(result => result.status === 'PASS') ? 'PASS' : 'FAIL',
  selectedFilesUnchanged: unchanged, before, after, results,
  fullSuite: 'NOT_RUN', liveInference: 'NOT_RUN', publication: 'NOT_AUTHORIZED' };
const receipt = path.join(directory, 'verification.json');
writeFileSync(receipt, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ status: report.status, receipt, selectedFileCount: before.length,
  selectedFilesUnchanged: unchanged, commands: results.map(({ program, status, exitCode }) => ({ program, status, exitCode })) }, null, 2));
if (report.status !== 'PASS') process.exitCode = 1;
