import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root = path.dirname(fileURLToPath(import.meta.url));
const names = ['history/journal-owner-v2.mjs', 'history/run-journal-v1.mjs', 'tests/journal-proxy-boundaries.test.mjs'];
const candidate = {files: names.map(file => ({path: file, content: fs.readFileSync(path.join(root, 'candidate', file), 'utf8')}))};
const expected = ['2120bf0c75d9aa6122c06a2b34d55b3256a08f024d0e5fa43d8877e4eb67e44f',
  '0164f10da27f6d12cfd1f3d443bd8e0f7c237b46363353570ae4a759a97f749b',
  '4608d36de36c91b0318889b712e78f4971d7a2ea5c6093112e9975553ce8a1cb'];
const sha = text => createHash('sha256').update(text).digest('hex');
for (let i = 0; i < names.length; i++) assert.equal(sha(candidate.files[i].content), expected[i]);
const input = {task: {taskId: 'nisi.history-proxy-boundaries.20260920', mode: 'edit', language: 'javascript',
  allowedFiles: names, protectedFiles: [], protectedSnapshots: {},
  acceptanceCriteria: ['Reject ordinary, transparent and revoked Proxies before traps at journal and owner input boundaries.',
    'Preserve existing valid plain-data behavior, TIME-before-ENTRY precedence and named structured refusals.',
    'Remain private; no inference, publication or native acceptance authority.'],
  policy: {repairBudget: 0, totalDeadlineMs: 60000, requiredReviewers: 1, requireReportStore: false}}, candidate};
const output = fs.mkdtempSync(path.join(root, 'nisi-validation-'));
const inputText = JSON.stringify(input);
fs.writeFileSync(path.join(output, 'input.json'), inputText + '\n', {flag: 'wx', mode: 0o600});
const command = ['/Users/louiscalata/bin/initiate-online-code-mode', '--nisi', 'validate'];
const result = spawnSync(command[0], command.slice(1), {input: inputText, encoding: 'utf8',
  timeout: 60000, maxBuffer: 2 * 1024 * 1024, cwd: path.resolve(root, '../..')});
for (const [kind, value] of [['stdout', result.stdout ?? ''], ['stderr', result.stderr ?? '']])
  fs.writeFileSync(path.join(output, kind + '.log'), value, {flag: 'wx', mode: 0o600});
const unchanged = names.every((file, i) => sha(fs.readFileSync(path.join(root, 'candidate', file))) === expected[i]);
const receipt = {command, exitCode: result.status, signal: result.signal, error: result.error?.message ?? null,
  inputSha256: sha(inputText), stdoutSha256: sha(result.stdout ?? ''), stderrSha256: sha(result.stderr ?? ''),
  unchanged, sourceHashes: Object.fromEntries(names.map((file, i) => [file, expected[i]])),
  behavioralTests: 'NOT_RUN_BY_THIS_HELPER', modelInference: 'NOT_RUN', implementationAccepted: false};
fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx', mode: 0o600});
console.log(JSON.stringify({output, ...receipt, result: result.stdout}, null, 2));
if (result.status !== 0 || result.signal !== null || result.error || !unchanged) process.exitCode = 1;
