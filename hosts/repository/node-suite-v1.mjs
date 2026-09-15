// PRIVATE trusted-host registration and closed result reader. Registration records
// the host's review decision; it neither performs review nor grants user authority.
import { exact, read, digest, isId } from '../../integrity/record-utils.mjs';
import { cloneFreeze } from '../../workflow/contracts.mjs';
import { isIssuedRepositoryPreparation } from './snapshot-contract.mjs';
import { closedList } from '../swift-verifier/group-contract-utils.mjs';

export const REVIEWED_NODE_SCOPE = 'source-reviewed-no-descendants-static-local-v1';
export const NODE_REPORT_CAP = 65536;
const issued = new WeakMap();
const refuse = code => { throw Object.assign(new Error(code), { code }); };
const text = (v, max) => typeof v === 'string' && v.isWellFormed() && v.trim().length > 0 &&
  !v.includes('\0') && Buffer.byteLength(v) <= max;
export function registerReviewedNodeSuiteV1(input) {
  exact(input, ['id', 'scope', 'preparations', 'entryPath', 'reportSchema', 'assertionNames', 'setupReason'], 'NODE_SUITE_SCHEMA');
  if (!isId(input.id) || input.scope !== REVIEWED_NODE_SCOPE || !isId(input.reportSchema)) refuse('NODE_SUITE_PROFILE');
  const preparations = closedList(input.preparations, 101, 'NODE_SUITE_PREPARATIONS');
  if (preparations.length < 1 || preparations.some(p => !isIssuedRepositoryPreparation(p))) refuse('NODE_SUITE_PREPARATIONS');
  const first = preparations[0];
  const entries = preparations.map(p => p.materialized.files.find(f => f.path === input.entryPath));
  if (typeof input.entryPath !== 'string' || !input.entryPath.endsWith('.mjs') || entries.some(e => !e) ||
      preparations.some(p => !p.task.protectedFiles.includes(input.entryPath)) ||
      entries.some(e => e.sha256 !== entries[0].sha256)) refuse('NODE_SUITE_ENTRY');
  if (new Set(preparations.map(p => p.fingerprint)).size !== preparations.length ||
      preparations.some(p => p.taskFingerprint !== first.taskFingerprint || p.baselineFingerprint !== first.baselineFingerprint)) refuse('NODE_SUITE_IDENTITY');
  const names = closedList(input.assertionNames, 256, 'NODE_SUITE_ASSERTIONS');
  if (names.length < 1 || names.some(n => !text(n, 128)) || new Set(names).size !== names.length ||
      typeof input.setupReason !== 'string' || !/^[A-Z][A-Z0-9_]{0,95}$/.test(input.setupReason)) refuse('NODE_SUITE_ASSERTIONS');
  const identity = { schemaVersion: 'nisi-reviewed-node-suite-v1', id: input.id, scope: input.scope,
    preparationFingerprints: preparations.map(p => p.fingerprint), entryPath: input.entryPath,
    entrySha256: entries[0].sha256, reportSchema: input.reportSchema, assertionNames: names,
    setupReason: input.setupReason, argvProfile: 'entry-and-workspace-root-v1',
    noDescendantsEnforced: false, sandboxed: false, authorizing: false };
  const suite = cloneFreeze({ ...identity, fingerprint: digest('nisi/reviewed-node-suite/v1', identity) });
  issued.set(suite, new Set(preparations)); return suite;
}
export function requireReviewedNodeSuiteV1(suite, preparation) {
  const preparations = issued.get(suite); if (!preparations) refuse('NODE_SUITE_NOT_ISSUED');
  if (preparation !== undefined && !preparations.has(preparation)) refuse('NODE_SUITE_PREPARATION_NOT_REGISTERED');
  return suite;
}
// Original in-process identities only; serialized registrations never resume work.
export function reviewedNodePreparationsV1(suite) {
  requireReviewedNodeSuiteV1(suite); return Object.freeze([...issued.get(suite)]);
}

export function readNodeTestReportV1(bytes, suite) {
  requireReviewedNodeSuiteV1(suite);
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > NODE_REPORT_CAP) refuse('NODE_REPORT_BYTES');
  // Exactly one JSON line, with one optional trailing LF. The canonical byte
  // reader below independently refuses invalid UTF8, duplicate keys and numbers.
  const line = bytes.at(-1) === 10 ? bytes.subarray(0, -1) : bytes;
  if (line.length === 0 || line.includes(10) || line.includes(13)) refuse('NODE_REPORT_FRAME');
  const value = read(line), error = value?.status === 'ERROR';
  exact(value, ['schemaVersion', 'status', 'assertionsExecuted', 'assertionsPassed', 'failures', ...(error ? ['reason'] : [])], 'NODE_REPORT_SCHEMA');
  if (value.schemaVersion !== suite.reportSchema || !['PASS', 'FAIL', 'ERROR'].includes(value.status)) refuse('NODE_REPORT_IDENTITY');
  if (!Array.isArray(value.failures) || value.failures.length > suite.assertionNames.length) refuse('NODE_REPORT_FAILURES');
  const seen = new Set();
  for (const failure of value.failures) {
    exact(failure, ['name', 'message'], 'NODE_REPORT_FAILURE_SCHEMA');
    if (!suite.assertionNames.includes(failure.name) || seen.has(failure.name) || !text(failure.message, 512)) refuse('NODE_REPORT_FAILURE_INVALID');
    seen.add(failure.name);
  }
  if (error) {
    if (value.assertionsExecuted !== 0 || value.assertionsPassed !== 0 || value.failures.length !== 0 || value.reason !== suite.setupReason) refuse('NODE_REPORT_SETUP');
  } else if (value.assertionsExecuted !== suite.assertionNames.length || !Number.isSafeInteger(value.assertionsPassed) ||
      value.assertionsPassed < 0 || value.assertionsPassed > value.assertionsExecuted ||
      value.failures.length !== value.assertionsExecuted - value.assertionsPassed ||
      (value.status === 'PASS') !== (value.failures.length === 0)) refuse('NODE_REPORT_COUNTS');
  return value;
}
