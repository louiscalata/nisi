// PRIVATE — Nisi v0.2 integration work. Not part of a cleared public artifact.
// Pure in-memory text contracts; no filesystem admission, process execution,
// permissions, secret screening or proof of origin. A malicious JavaScript host
// (including Proxy traps) is outside this contract's trust boundary.
import {
  createTaskSpecification, sha256Text, stableStringify, validateCandidateForTask,
} from '../../workflow/contracts.mjs';

export const REPOSITORY_SNAPSHOT_LIMITS = Object.freeze({
  maximumFiles: 1024,
  maximumPathBytes: 512,
  maximumComponentBytes: 255,
  maximumFileBytes: 1_048_576,
  maximumTotalBytes: 8 * 1_048_576,
});
export const REPOSITORY_PATH_PROFILE = 'nisi/repository-path/ascii-casefold-v1';
const issuedSnapshots = new WeakSet();
const issuedPreparations = new WeakSet();

// Internal host seam: identity is not permission or authenticated provenance.
export const isIssuedRepositoryPreparation = value => issuedPreparations.has(value);

export class RepositorySnapshotError extends Error {
  constructor(code) { super(code); this.name = 'RepositorySnapshotError'; this.code = code; }
}
const refuse = code => { throw new RepositorySnapshotError(code); };
const digest = (domain, value) => sha256Text(`${domain}\0${stableStringify(value)}`);

// Inspect data descriptors, not getters. Arrays and objects are deliberately
// shallow and closed; strings below are captured before normalization/hashing.
function fields(value, names, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) refuse(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) refuse(code);
  const out = Object.create(null);
  for (const name of names) {
    const descriptor = descriptors[name];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) refuse(code);
    out[name] = descriptor.value;
  }
  return out;
}

function fileArray(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) refuse('REPOSITORY_FILES_SCHEMA');
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 1 || length > maximum) refuse('REPOSITORY_FILES_LIMIT');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== length + 1) refuse('REPOSITORY_FILES_SCHEMA');
  const files = [];
  for (let i = 0; i < length; i += 1) {
    const descriptor = descriptors[i];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) refuse('REPOSITORY_FILES_SCHEMA');
    files.push(fields(descriptor.value, ['path', 'content'], 'REPOSITORY_FILE_SCHEMA'));
  }
  return files;
}

function checkedPath(value) {
  if (typeof value !== 'string' || value.length < 1 ||
      value.length > REPOSITORY_SNAPSHOT_LIMITS.maximumPathBytes ||
      !/^[A-Za-z0-9._/-]+$/u.test(value)) refuse('REPOSITORY_PATH_INVALID');
  for (const part of value.split('/')) {
    if (part === '' || part === '.' || part === '..' || part.endsWith('.') ||
        part.length > REPOSITORY_SNAPSHOT_LIMITS.maximumComponentBytes ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)) refuse('REPOSITORY_PATH_INVALID');
  }
  return value;
}

function checkedContent(value) {
  if (typeof value !== 'string' || value.length > REPOSITORY_SNAPSHOT_LIMITS.maximumFileBytes) refuse('REPOSITORY_CONTENT_LIMIT');
  if (!value.isWellFormed()) refuse('REPOSITORY_CONTENT_UNICODE');
  const byteLength = Buffer.byteLength(value, 'utf8');
  if (byteLength > REPOSITORY_SNAPSHOT_LIMITS.maximumFileBytes) refuse('REPOSITORY_CONTENT_LIMIT');
  return byteLength;
}

function checkPaths(values) {
  const paths = new Set();
  const spellings = new Map();
  for (const value of values) {
    const path = checkedPath(value);
    const folded = path.toLowerCase();
    if (paths.has(folded)) refuse('REPOSITORY_PATH_COLLISION');
    paths.add(folded);
    const parts = path.split('/');
    for (let count = 1; count <= parts.length; count += 1) {
      const spelling = parts.slice(0, count).join('/');
      const key = spelling.toLowerCase();
      if (spellings.has(key) && spellings.get(key) !== spelling) refuse('REPOSITORY_PATH_CASE_COLLISION');
      spellings.set(key, spelling);
    }
  }
  for (const value of values) {
    const parts = value.toLowerCase().split('/');
    for (let count = 1; count < parts.length; count += 1) {
      if (paths.has(parts.slice(0, count).join('/'))) refuse('REPOSITORY_PATH_PREFIX_COLLISION');
    }
  }
}

function normalizeFiles(value, maximum = REPOSITORY_SNAPSHOT_LIMITS.maximumFiles) {
  const files = fileArray(value, maximum);
  checkPaths(files.map(file => file.path));
  let totalBytes = 0;
  const normalized = files.map(file => {
    const byteLength = checkedContent(file.content);
    totalBytes += byteLength;
    if (totalBytes > REPOSITORY_SNAPSHOT_LIMITS.maximumTotalBytes) refuse('REPOSITORY_TOTAL_LIMIT');
    return Object.freeze({ path: file.path, content: file.content, byteLength, sha256: sha256Text(file.content) });
  });
  normalized.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { files: Object.freeze(normalized), totalBytes };
}

export function createRepositorySnapshot(value) {
  const input = fields(value, ['files'], 'REPOSITORY_SNAPSHOT_SCHEMA');
  const { files, totalBytes } = normalizeFiles(input.files);
  const identity = {
    schemaVersion: 1, pathProfile: REPOSITORY_PATH_PROFILE,
    files: files.map(({ path, byteLength, sha256 }) => ({ path, byteLength, sha256 })),
  };
  const snapshot = Object.freeze({
    schemaVersion: 1, pathProfile: REPOSITORY_PATH_PROFILE, files, totalBytes,
    fingerprint: digest('nisi/repository-snapshot/v1', identity),
  });
  issuedSnapshots.add(snapshot);
  return snapshot;
}

export function prepareRepositoryCandidate(value) {
  const input = fields(value, ['baseline', 'task', 'candidate', 'authorId'], 'REPOSITORY_PREPARATION_SCHEMA');
  if (!issuedSnapshots.has(input.baseline)) refuse('REPOSITORY_BASELINE_NOT_ISSUED');
  const task = createTaskSpecification(input.task);
  // The repository profile is intentionally narrower than the portable v1 task
  // grammar. Validate the full declared scope, not just paths a candidate edits.
  checkPaths(task.allowedFiles);
  const candidateInput = fields(input.candidate, ['files'], 'REPOSITORY_CANDIDATE_SCHEMA');
  const candidateFiles = normalizeFiles(candidateInput.files, 256).files;
  const candidate = validateCandidateForTask({
    files: candidateFiles.map(({ path, content }) => ({ path, content })),
  }, task, input.authorId);
  const baseFiles = new Map(input.baseline.files.map(file => [file.path, file]));
  for (const path of task.protectedFiles) {
    const original = baseFiles.get(path);
    if (!original || original.sha256 !== task.protectedSnapshots[path]) refuse('REPOSITORY_PROTECTED_BASELINE_MISMATCH');
  }
  const nextFiles = new Map(baseFiles);
  for (const file of candidate.files) nextFiles.set(file.path, file);
  const materialized = createRepositorySnapshot({
    files: [...nextFiles.values()].map(({ path, content }) => ({ path, content })),
  });
  const identity = Object.freeze({
    schemaVersion: 1,
    baselineFingerprint: input.baseline.fingerprint,
    taskFingerprint: digest('nisi/workflow-task/v1', task),
    candidateFingerprint: candidate.fingerprint,
    materializedFingerprint: materialized.fingerprint,
  });
  const preparation = Object.freeze({
    ...identity, fingerprint: digest('nisi/repository-preparation/v1', identity),
    task, candidate, baseline: input.baseline, materialized,
    executionStatus: 'NOT_RUN', authorizing: false,
  });
  issuedPreparations.add(preparation);
  return preparation;
}
