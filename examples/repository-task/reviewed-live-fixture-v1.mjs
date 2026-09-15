// PRIVATE exact reviewed-fixture registration only. Reads five fixed source files;
// creates no workspace and executes no source, process, model or network operation.
// Hash admission is not general generated-code isolation or execution authority.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cloneFreeze, createTaskSpecification } from '../../workflow/contracts.mjs';
import { digest, exact } from '../../integrity/record-utils.mjs';
import { createRepositorySnapshot, prepareRepositoryCandidate } from '../../hosts/repository/snapshot-contract.mjs';
import { registerReviewedNodeSuiteV1, REVIEWED_NODE_SCOPE } from '../../hosts/repository/node-suite-v1.mjs';

// Pinned after complete source inspection. These are exact raw-byte SHA256 values;
// the live model cannot replace the manifest or register a new revision.
const reviewedSourceManifest = cloneFreeze([
  { path: 'fixtures/live-baseline/retry-settings.mjs', byteLength: 275,
    sha256: '65525edd21e81c5de1791c6f47fa404ffea10f7ea332545a8e295afdd6270254' },
  { path: 'fixtures/live-repair/retry-settings.mjs', byteLength: 275,
    sha256: '73369f8d0cc0cefbb082c65388c3652c7602254ab5b6fbab138e08078b568112' },
  { path: 'fixtures/baseline/config.json', byteLength: 17,
    sha256: 'fc2001f12401983fa2632ee17e9879b6a1595f0de616e6e1484083c0c3324f04' },
  { path: 'fixtures/baseline/README.md', byteLength: 1225,
    sha256: 'b6ce54912db6b4605d19e4e0fdce5cc1e680de4a57bb1af82ca7b737ff578011' },
  { path: 'fixtures/harness/check-retry-settings.mjs', byteLength: 3168,
    sha256: 'e07a9bd6a63a52ac6977734c61ea0a210c71ec2c331951f4d94b44159c8245c5' },
]);
const sourcePaths = Object.freeze(reviewedSourceManifest.map(entry => entry.path));
const reviewedSourceFingerprint = digest('nisi-reviewed-live-source-v1', reviewedSourceManifest);
const assertionNames = Object.freeze(['omitted input defaults to 3', 'empty object defaults to 3', 'null retryLimit defaults to 3',
  'explicit zero retries stays 0', 'retryLimit 2 stays 2', 'retryLimit 10 stays 10', 'negative retryLimit throws RangeError',
  'retryLimit above 10 throws RangeError', 'non-integer retryLimit throws RangeError', 'loaded config object returns 0']);
const fail = (code, sourcePath = null) => { throw Object.assign(new Error(code), { code, sourcePath }); };

// Internal trusted, pure source-map seam for deterministic refusal tests. Values
// must be raw Buffers under the exact fixed paths; callers cannot supply hashes,
// tasks, registration decisions or I/O callbacks. Hostile Proxy/intrinsic changes
// are outside this seam. All five byte snapshots are checked before any issuance.
export function createReviewedLiveFixtureFromSourcesV1(sourceMap) {
  exact(sourceMap, sourcePaths, 'LIVE_FIXTURE_SOURCE_SCHEMA');
  const content = Object.create(null);
  for (const entry of reviewedSourceManifest) {
    const supplied = sourceMap[entry.path];
    if (!Buffer.isBuffer(supplied)) fail('LIVE_FIXTURE_SOURCE_BYTES', entry.path);
    if (supplied.length !== entry.byteLength) fail('LIVE_FIXTURE_SOURCE_HASH', entry.path);
    const bytes = Buffer.from(supplied);
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) fail('LIVE_FIXTURE_SOURCE_HASH', entry.path);
    // The fixed reviewed files are valid UTF8; decode only the hash-admitted copy.
    content[entry.path] = bytes.toString('utf8');
  }
  const baseline = createRepositorySnapshot({ files: [
    { path: 'retry-settings.mjs', content: content[sourcePaths[0]] },
    { path: 'config.json', content: content[sourcePaths[2]] },
    { path: 'README.md', content: content[sourcePaths[3]] },
    { path: 'checks/check-retry-settings.mjs', content: content[sourcePaths[4]] },
  ] });
  const protectedFiles = baseline.files.filter(file => file.path !== 'retry-settings.mjs');
  const task = createTaskSpecification({ taskId: 'retry.repository.live', mode: 'edit', language: 'javascript',
    allowedFiles: baseline.files.map(file => file.path), protectedFiles: protectedFiles.map(file => file.path),
    protectedSnapshots: Object.fromEntries(protectedFiles.map(file => [file.path, file.sha256])),
    acceptanceCriteria: [
      'Preserve an explicit retryLimit of 0. Omitted or null retryLimit defaults to 3; retain existing integer and range validation.',
      'Change only retry-settings.mjs and return exactly that one changed file. Preserve ALL unrelated bytes, including the neutral comment, whitespace, indentation and final newline. Make only the smallest correction needed for the failing zero-retry behavior.',
      'Do not change the protected configuration, README, acceptance harness or task requirements.',
    ],
    policy: { repairBudget: 1, totalDeadlineMs: 240000, requiredReviewers: 1, requireReportStore: false } });
  const preparations = Object.freeze([sourcePaths[0], sourcePaths[1]].map(sourcePath => prepareRepositoryCandidate({ baseline, task,
    candidate: { files: [{ path: 'retry-settings.mjs', content: content[sourcePath] }] }, authorId: 'author.live-model' })));
  const suite = registerReviewedNodeSuiteV1({ id: 'nisi.node.live-retry', scope: REVIEWED_NODE_SCOPE, preparations,
    entryPath: 'checks/check-retry-settings.mjs', reportSchema: 'nisi-retry-fixture-v1', assertionNames, setupReason: 'FIXTURE_SETUP_FAILED' });
  const targets = cloneFreeze(baseline.files.map(file => ({ path: file.path, profileId: file.path.endsWith('.json')
    ? 'nisi-json-structure-v1' : file.path.endsWith('.md') ? 'nisi-markdown-sections-v1' : 'nisi-text-structure-v1' })));
  // Preserve original-issued suite/preparation identities; do not clone this graph.
  return Object.freeze({ baseline, task, preparations, suite, reviewedSourceManifest, reviewedSourceFingerprint, targets });
}

export async function createReviewedLiveFixtureV1() {
  const entries = await Promise.all(sourcePaths.map(async sourcePath => {
    let bytes;
    try { bytes = await readFile(new URL(sourcePath, import.meta.url)); }
    catch { fail('LIVE_FIXTURE_SOURCE_UNAVAILABLE', sourcePath); }
    return [sourcePath, bytes];
  }));
  return createReviewedLiveFixtureFromSourcesV1(Object.fromEntries(entries));
}
