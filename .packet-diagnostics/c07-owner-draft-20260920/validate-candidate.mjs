// Owner-only deterministic Nisi check. No model, test execution, or application.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const base = path.dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const paths = ['hosts/repository/native-incident-source-v1.mjs', 'hosts/repository/native-incident-admission-v1.mjs',
  'work-orders/v02-finish-cluster-v1/native-incident/admission-integration.test.mjs',
  'work-orders/v02-finish-cluster-v1/native-incident/native-incident-source-v1.test.mjs'];
const candidate = { files: paths.map(file => ({ path: file, content: fs.readFileSync(path.join(base, 'candidate', file), 'utf8') })) };
const sourceHashes = Object.fromEntries(candidate.files.map(file => [file.path, hash(file.content)]));
const task = { taskId: 'nisi.c07.native-incident-binding', mode: 'edit', language: 'javascript',
  allowedFiles: paths, protectedFiles: [], protectedSnapshots: {},
  acceptanceCriteria: ['Bind the existing issued original source to a single-use, time-bounded non-authorizing admission; compare exact original expectation, request, artifact, profile and executable identities; validate descriptor-only caller data and raw stream/report consistency; preserve original/fresh digest records, cancellation and unknown drain, exact v1 source compatibility, and caller-supplied NOT_RUN provenance. No native execution, persistence, inference, permission or publication.'],
  policy: { repairBudget: 0, totalDeadlineMs: 120000, requiredReviewers: 1, requireReportStore: false } };
const input = JSON.stringify({ task, candidate });
assert(Buffer.byteLength(input) <= 262144);
const output = fs.mkdtempSync(path.join(base, 'nisi-validation-'));
const result = spawnSync('/Users/louiscalata/bin/initiate-online-code-mode', ['--nisi', 'validate'], {
  input, encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024
});
const log = (result.stdout ?? '') + (result.stderr ?? '');
fs.writeFileSync(path.join(output, 'nisi-validation.log'), log, { flag: 'wx' });
let response = null;
try { response = JSON.parse(result.stdout); } catch { /* malformed response stays failed */ }
const unchanged = Object.entries(sourceHashes).every(([file, sha]) => hash(fs.readFileSync(path.join(base, 'candidate', file))) === sha);
const ok = result.status === 0 && !result.error && !result.signal && unchanged &&
  response?.status === 'VALIDATED' && response.accepted === false && response.checks.contract.status === 'PASS' &&
  response.checks.syntax.status === 'PASS' && response.checks.syntax.checkedFiles.length === paths.length;
const receipt = { sourceHashes, exitCode: result.status, error: result.error?.code ?? null, signal: result.signal,
  unchanged, ok, binding: response?.binding ?? null, logSha256: hash(log), inference: 'NOT_RUN', implementationAccepted: false };
fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, ...receipt }));
if (!ok) process.exitCode = 1;
