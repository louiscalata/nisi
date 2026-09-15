// Test-only preparation of the already inspected fixed retry fixture.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { sha256Text } from '../../workflow/contracts.mjs';
import { createRepositorySnapshot, prepareRepositoryCandidate } from '../../hosts/repository/snapshot-contract.mjs';
import { registerReviewedNodeSuiteV1, REVIEWED_NODE_SCOPE } from '../../hosts/repository/node-suite-v1.mjs';
import { materializeRepositoryCandidateV1, TASK_WORKSPACE_PROFILE } from '../../hosts/repository/task-workspace-v1.mjs';
export const names = Object.freeze(['omitted input defaults to 3', 'empty object defaults to 3', 'null retryLimit defaults to 3',
  'explicit zero retries stays 0', 'retryLimit 2 stays 2', 'retryLimit 10 stays 10', 'negative retryLimit throws RangeError',
  'retryLimit above 10 throws RangeError', 'non-integer retryLimit throws RangeError', 'loaded config object returns 0']);
const fixture = fileURLToPath(new URL('../../examples/repository-task/fixtures/', import.meta.url));
export const passing = () => ({ schemaVersion: 'nisi-retry-fixture-v1', status: 'PASS', assertionsExecuted: 10, assertionsPassed: 10, failures: [] });
export const failing = () => ({ ...passing(), status: 'FAIL', assertionsPassed: 8,
  failures: [names[3], names[9]].map(name => ({ name, message: 'expected 0 but got 3' })) });
export const setup = () => ({ ...passing(), status: 'ERROR', assertionsExecuted: 0, assertionsPassed: 0, reason: 'FIXTURE_SETUP_FAILED' });
export const wire = value => Buffer.from(JSON.stringify(value) + '\n');
export async function context(t, { repairBudget = 1 } = {}) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'nisi-node-host-test-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const files = await Promise.all(['retry-settings.mjs', 'config.json', 'README.md'].map(async p => ({ path: p, content: await fs.readFile(path.join(fixture, 'baseline', p), 'utf8') })));
  files.push({ path: 'checks/check-retry-settings.mjs', content: await fs.readFile(path.join(fixture, 'harness/check-retry-settings.mjs'), 'utf8') });
  const baseline = createRepositorySnapshot({ files }), protectedFiles = files.filter(f => f.path !== 'retry-settings.mjs');
  const task = { taskId: 'retry.repository.host', mode: 'edit', language: 'javascript', allowedFiles: files.map(f => f.path),
    protectedFiles: protectedFiles.map(f => f.path), protectedSnapshots: Object.fromEntries(protectedFiles.map(f => [f.path, sha256Text(f.content)])),
    acceptanceCriteria: ['Preserve zero retries'], policy: { repairBudget, totalDeadlineMs: 20000, requiredReviewers: 1, requireReportStore: false } };
  const preparations = await Promise.all(['baseline', 'repair'].map(async variant => prepareRepositoryCandidate({ baseline, task,
    candidate: { files: [{ path: 'retry-settings.mjs', content: await fs.readFile(path.join(fixture, variant, 'retry-settings.mjs'), 'utf8') }] }, authorId: 'author.fixed-fixture' })));
  const registration = { id: 'nisi.node.retry', scope: REVIEWED_NODE_SCOPE, preparations, entryPath: 'checks/check-retry-settings.mjs',
    reportSchema: 'nisi-retry-fixture-v1', assertionNames: names, setupReason: 'FIXTURE_SETUP_FAILED' };
  const suite = registerReviewedNodeSuiteV1(registration);
  const workspace = async (n = 1) => materializeRepositoryCandidateV1({ preparation: preparations[n], parentRoot: parent, profile: TASK_WORKSPACE_PROFILE });
  return { parent, baseline, task, preparations, registration, suite, workspace };
}
