import assert from 'node:assert/strict';
import { C07_BASELINE_DEPENDENCY_TRANSITIONS } from './check-c07-baseline-v3.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { assertC07Acceptance, C07_DEPENDENCY_SUPERSESSION, assertHistoryHardening } from './check-c07.mjs';

const SCOPE = 'CALLER_SUPPLIED_HOST_OBSERVATION_NODE_ONLY';
const EVIDENCE_PATH = '.packet-diagnostics/c06-owner-draft-20260920/final-evidence.json';
const CHECKPOINT_PATH = '.packet-diagnostics/c06-owner-draft-20260920/checks-AMHMeM/checks.json';
const REVIEW_PATH = '.packet-diagnostics/c06-owner-draft-20260920/luna-source-review.json';
const VALIDATION_PATH = '.packet-diagnostics/c06-owner-draft-20260920/nisi-validation-sokSNE/receipt.json';
const VALIDATION_LOG = '.packet-diagnostics/c06-owner-draft-20260920/nisi-validation-sokSNE/nisi-validation.log';
const CANONICAL_PATH = '.packet-diagnostics/c06-owner-draft-20260920/canonical-95VoGC/checks.json';
const PACKET_PATH = '.packets/nisi-v02-c06-restart-integration-oracle.packet.md';
const C05_EVIDENCE = '.packet-diagnostics/c05-owner-review-PeEuLA/final-evidence.json';
const C05_EVIDENCE_SHA256 = '64c4a986fde4787743365cb2e7352d95b535ed6fec6cff1be664313b0779db9f';
const TASK_FINGERPRINT = '8511e736f489998fdf02bcea16510bf54e9aca6fbb75b910777e2deb347501f0';
const CANDIDATE_FINGERPRINT = 'd97d4154937d0bf43e3fca1e5c465c6bfd4f7116417ebde206d24486cb958450';
const PACKET_SHA256 = 'e03873ed54c1f7c0263e7308e5eec8b657a6ed18765ae03e0110b882b6d7f591';
const DEPENDENCY_MAP_SHA256 = 'f828837374d2830e187bcb081f46df142860933657602f3d1b9871c5ee43c136';
const OWNER_EVIDENCE_SHA256 = '922cfd9585df6ad86eaf252fd17c9b3b94d1f7e681a7d824625e2cbfea3af4ce';
const RECORDED_NODE_PATH = '/usr/local/bin/node';
const RECORDED_NODE_VERSION = 'v24.18.0';
// This records the tested runtime, not binary attestation or host portability.
// The parent inventory checker validates all C01-C05 acceptance/history first;
// this helper adds C06 and binds C05's exact accepted closure, not a new authority.

export const C06_SOURCE_HASHES = Object.freeze({
  'history/host-journal-bundle.mjs': 'e2954caeaa987993fd17e1904d4222e5b030b29e7f028c816809fe83ae0ace6b',
  'work-orders/v02-finish-cluster-v1/restart/host-bundle-integration.test.mjs': 'b24f8c1d8599fd91b636e960fb2dc841d646ca0347b3be075457ab7195e03817',
  'tests/host-journal-bundle.test.mjs': '815556218a0ef5907f11acdf4de22259ca171e3725be977e08c2fa7001a3dabf',
  'work-orders/v02-finish-cluster-v1/restart/README.md': '588f548cdce3616d5c239d4d343bdf5693d3862ae3f53deb54468ac99ebee9f1'
});

const REVIEWED_THREE = Object.freeze(Object.fromEntries(Object.entries(C06_SOURCE_HASHES).slice(0, 3)));
const HEX = /^[0-9a-f]{64}$/;
const FORBIDDEN_TRUE = Object.freeze([
  'implementationAccepted', 'openCodeExecuted', 'nativeBuildAccepted', 'publicationAuthorized',
  'sourceAuthenticityAttested', 'resumeGranted'
]);
const EXPECTED_COMMANDS = Object.freeze({
  c06: Object.freeze([
    '--test-reporter=tap', '--test-concurrency=1', '--test',
    '../../work-orders/v02-finish-cluster-v1/restart/host-bundle-integration.test.mjs',
    '../../tests/bundle-restart-demo.test.mjs', '../../tests/journal-restart-recovery.test.mjs',
    '../../tests/interrupted-run-decision.test.mjs'
  ]),
  c05: Object.freeze([
    '--test-reporter=tap', '--test-concurrency=1', '--experimental-test-module-mocks', '--test',
    '../../work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.test.mjs',
    '../../work-orders/parallel-seven-tracks-v1/track1/findings-cluster-receipt.test.mjs',
    '../../work-orders/parallel-seven-tracks-v1/track1/findings-cluster-cleanup.test.mjs',
    '../../work-orders/parallel-seven-tracks-v1/track1/findings-cluster-containment.test.mjs',
    '../../work-orders/parallel-seven-tracks-v1/track1/findings-cluster-input-imports.test.mjs',
    '../../tests/fixture-receipt-completion.test.mjs', '../../tests/fixture-cleanup-boundaries.test.mjs',
    '../../tests/fixture-cleanup-state.test.mjs', '../../tests/fixture-completion-reader.test.mjs'
  ]),
  'journal-regressions': Object.freeze([
    '--test-reporter=tap', '--test-concurrency=1', '--test',
    'tests/host-journal-bundle.test.mjs', 'tests/host-journal-bundle-baseline.test.mjs',
    'tests/run-journal.test.mjs', 'tests/run-journal-baseline.test.mjs',
    'tests/run-journal-store.test.mjs', 'tests/run-journal-store-baseline.test.mjs',
    'tests/fixed-run-journal-entry.test.mjs', 'tests/fixed-run-journal-entry-baseline.test.mjs',
    'tests/journal-restart-recovery-boundaries.test.mjs', 'tests/journal-restart-recovery-baseline.test.mjs',
    'tests/bundle-restart-demo-baseline.test.mjs', 'tests/interrupted-run-decision-integration.test.mjs'
  ])
});

function ownRecord(value, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} record`);
  return value;
}

function safeRelative(file, label) {
  assert.equal(typeof file, 'string', `${label} path type`);
  assert(file.length > 0 && !path.isAbsolute(file) && !file.includes('\\') && !file.split('/').includes('..'), `${label} path`);
  return file;
}

function containedBytes(root, file, label) {
  const filename = path.join(root, safeRelative(file, label));
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink(), `${label} regular file`);
  const realRoot = fs.realpathSync(root), realFile = fs.realpathSync(filename);
  assert(realFile.startsWith(`${realRoot}${path.sep}`), `${label} containment`);
  return fs.readFileSync(filename);
}

function readBound(root, ref, expectedPath, sha, label) {
  ownRecord(ref, `${label} reference`);
  assert.equal(ref.path, expectedPath, `${label} path`);
  assert.match(ref.sha256, HEX, `${label} digest`);
  const bytes = containedBytes(root, ref.path, label);
  assert.equal(sha(bytes), ref.sha256, `${label} digest mismatch`);
  return { bytes, value: JSON.parse(bytes) };
}

function assertNoAuthority(record, label, required = FORBIDDEN_TRUE) {
  for (const key of FORBIDDEN_TRUE) {
    if (required.includes(key) || Object.hasOwn(record, key)) assert.equal(record[key], false, `${label} forbidden credit: ${key}`);
  }
  if (label !== 'C06 owner acceptance' || Object.hasOwn(record, 'inference'))
    assert.equal(record.inference, 'NOT_RUN', `${label} inference credit`);
}

function assertSourceMap(root, actual, expected, sha, label) {
  assert.deepEqual(actual, expected, `${label} source map`);
  for (const [file, digest] of Object.entries(expected)) {
    const bytes = containedBytes(root, file, `${label} source`);
    assert.equal(sha(bytes), digest, `${label} source drift: ${file}`);
  }
}

function normalizedPacket(bytes) {
  const text = bytes.toString('utf8');
  const matches = text.match(/^project_root: .+$/gm) ?? [];
  assert.equal(matches.length, 1, 'C06 packet project_root inventory');
  return Buffer.from(text.replace(/^project_root: .+$/m, 'project_root: <PROJECT_ROOT>'));
}

function assertCheck(row, name, count, cwdKey, cwdValue, root, sha, requireLog) {
  ownRecord(row, `C06 ${name} check`);
  assert.equal(row.name, name);
  assert.equal(row.exitCode, 0); assert.equal(row.error, null); assert.equal(row.signal, null);
  assert.equal(row.ok, true); assert.match(row.logSha256, HEX);
  assert.deepEqual(row.counts, { tests: count, pass: count, fail: 0, skipped: 0, cancelled: 0, todo: 0 }, `C06 ${name} counts`);
  assert(Array.isArray(row.command) && row.command.length > 1, `C06 ${name} command`);
  assert.equal(row.command[0], RECORDED_NODE_PATH, `C06 ${name} executable`);
  assert.deepEqual(row.command.slice(1), EXPECTED_COMMANDS[name], `C06 ${name} command scope`);
  assert.equal(row[cwdKey], cwdValue, `C06 ${name} cwd scope`);
  if (requireLog) {
    safeRelative(row.logPath, `C06 ${name} log`);
    const bytes = containedBytes(root, row.logPath, `C06 ${name} log`);
    assert.equal(sha(bytes), row.logSha256, `C06 ${name} log digest`);
    const text = bytes.toString('utf8');
    const counts = Object.fromEntries(['tests','pass','fail','skipped','cancelled','todo'].map(key => {
      const matches = [...text.matchAll(new RegExp('^# '+key+' (\\d+)$', 'gm'))];
      assert.equal(matches.length, 1, `C06 ${name} raw count inventory: ${key}`);
      return [key, Number(matches[0][1])];
    }));
    assert.deepEqual(counts, row.counts, `C06 ${name} raw log counts`);
  }
}

export function assertC06Acceptance({ root, cluster, sha }) {
  assert.equal(typeof root, 'string', 'C06 root');
  assert(cluster && typeof cluster === 'object', 'C06 cluster');
  assert.equal(typeof sha, 'function', 'C06 sha');
  const row = cluster.packets?.find(candidate => candidate?.id === 'C06');
  const c05 = cluster.packets?.find(candidate => candidate?.id === 'C05');
  assert(row && row.implementationAccepted === true, 'C06 acceptance not enabled');
  for (const key of FORBIDDEN_TRUE.filter(key => key !== 'implementationAccepted'))
    if (Object.hasOwn(row, key)) assert.equal(row[key], false, 'C06 ledger forbidden credit: '+key);
  if (Object.hasOwn(row, 'inference')) assert.equal(row.inference, 'NOT_RUN', 'C06 ledger inference credit');
  assert.equal(row.state, 'NODE_IMPLEMENTATION_ACCEPTED', 'C06 accepted state');
  assert.equal(c05?.implementationAccepted, true, 'C06 requires accepted C05');
  assert.equal(c05.ownerAcceptance?.evidence, C05_EVIDENCE, 'C06 C05 evidence path');
  assert.equal(c05.ownerAcceptance?.evidenceSha256, C05_EVIDENCE_SHA256, 'C06 C05 evidence identity');
  assert.equal(sha(containedBytes(root, C05_EVIDENCE, 'C06 C05 evidence')), C05_EVIDENCE_SHA256, 'C06 C05 evidence drift');

  const acceptance = ownRecord(row.ownerAcceptance, 'C06 owner acceptance');
  assert.equal(acceptance.scope, SCOPE, 'C06 scope');
  assert.equal(acceptance.acceptedBy, 'codex', 'C06 accepting owner');
  assert.equal(acceptance.integrationRoute, 'OWNER_FABLE_DESIGN_DAYBREAK_IMPLEMENTATION_LUNA_REVIEW', 'C06 integration route');
  assert.equal(acceptance.evidence, EVIDENCE_PATH, 'C06 evidence path');
  assert.match(acceptance.evidenceSha256, HEX, 'C06 evidence digest');
  assertNoAuthority(acceptance, 'C06 owner acceptance', ['openCodeExecuted', 'nativeBuildAccepted', 'publicationAuthorized']);
  assert.deepEqual(acceptance.sourceHashes, C06_SOURCE_HASHES, 'C06 owner source map');
  assert.deepEqual(row.allowedFiles, Object.keys(C06_SOURCE_HASHES), 'C06 accepted file inventory');

  const evidenceBytes = containedBytes(root, EVIDENCE_PATH, 'C06 evidence');
  assert.equal(sha(evidenceBytes), acceptance.evidenceSha256, 'C06 evidence digest mismatch');
  const evidence = JSON.parse(evidenceBytes);
  assert.equal(evidence.schema, 'nisi.c06.evidence-binding.v1', 'C06 evidence schema');
  assert.equal(evidence.scope, SCOPE, 'C06 evidence scope');
  assertNoAuthority(evidence, 'C06 evidence');
  assertSourceMap(root, evidence.sourceHashes, C06_SOURCE_HASHES, sha, 'C06 evidence');

  const dependencies = ownRecord(evidence.dependencyHashes, 'C06 dependency hashes');
  assert.equal(Object.keys(dependencies).length, 84, 'C06 dependency closure inventory');
  assert.equal(evidence.dependencyClosureSha256, DEPENDENCY_MAP_SHA256, 'C06 dependency closure receipt identity');
  assert.equal(sha(Buffer.from(JSON.stringify(dependencies))), DEPENDENCY_MAP_SHA256, 'C06 dependency map identity');
  // Historical C06 evidence is immutable. A complete C07 acceptance can replace
  // only the named live dependency; a flag or supplied overlay alone cannot.
  let transitions = [];
  if (cluster.packets?.find(candidate => candidate?.id === 'C07')?.implementationAccepted === true) {
    assertC07Acceptance({ root, cluster, sha });
    transitions = [C07_DEPENDENCY_SUPERSESSION, ...C07_BASELINE_DEPENDENCY_TRANSITIONS];
  } else assert.equal(cluster.dependencySupersessions, undefined, 'C06 dependency supersession without accepted C07');
  const historyDigest=assertHistoryHardening({root,cluster,sha});
  for (const [file, digest] of Object.entries(dependencies)) {
    assert(!Object.hasOwn(C06_SOURCE_HASHES, file), `C06 dependency duplicates accepted source: ${file}`);
    safeRelative(file, 'C06 dependency'); assert.match(digest, HEX, `C06 dependency digest: ${file}`);
    let liveDigest = historyDigest(file,digest);
    const transition = transitions.find(candidate => candidate.path === file);
    if (transition) {
      assert.equal(digest, transition.oldSha256, 'C06 historical transition digest');
      liveDigest = transition.newSha256;
    }
    assert.equal(sha(containedBytes(root, file, 'C06 dependency')), liveDigest, `C06 dependency drift: ${file}`);
  }

  ownRecord(evidence.packet, 'C06 packet');
  assert.equal(evidence.packet.path, PACKET_PATH, 'C06 packet path');
  assert.equal(evidence.packet.normalization, 'PROJECT_ROOT_PLACEHOLDER_V1', 'C06 packet normalization');
  assert.equal(evidence.packet.sha256, PACKET_SHA256, 'C06 packet identity');
  assert.equal(sha(normalizedPacket(containedBytes(root, PACKET_PATH, 'C06 packet'))), evidence.packet.sha256, 'C06 packet digest mismatch');

  const checkpoint = readBound(root, evidence.checkpoint, CHECKPOINT_PATH, sha, 'C06 checkpoint').value;
  assert.equal(checkpoint.ok, true); assert.equal(checkpoint.canonicalUnchanged, true);
  assert.equal(checkpoint.node, RECORDED_NODE_VERSION, 'C06 checkpoint runtime version');
  assert.equal(checkpoint.candidatesUnchanged, true); assert.equal(checkpoint.stageUnchanged, true);
  assertNoAuthority(checkpoint, 'C06 checkpoint', ['implementationAccepted', 'nativeBuildAccepted', 'publicationAuthorized']);
  assert.deepEqual(checkpoint.candidateHashes, REVIEWED_THREE, 'C06 checkpoint candidate identity');
  for (const [file, digest] of Object.entries(REVIEWED_THREE))
    assert.equal(checkpoint.stagedHashes?.[file], digest, `C06 checkpoint staged source mismatch: ${file}`);
  for (const [file, digest] of Object.entries(dependencies))
    assert.equal(checkpoint.stagedHashes?.[file], digest, `C06 checkpoint staged dependency mismatch: ${file}`);
  assert.equal(checkpoint.checks.length, 3, 'C06 checkpoint check inventory');
  const oldBase = '~/nisi/.packet-diagnostics/c06-owner-draft-20260920/checks-AMHMeM/source';
  const historicalLog = row => ({...row, logPath: path.posix.join(path.posix.dirname(CHECKPOINT_PATH),row.name+'.log')});
  assertCheck(historicalLog(checkpoint.checks[0]), 'c06', 52, 'cwd', `${oldBase}/work-orders/v02-finish-cluster-v1`, root, sha, true);
  assertCheck(historicalLog(checkpoint.checks[1]), 'c05', 111, 'cwd', `${oldBase}/work-orders/v02-finish-cluster-v1`, root, sha, true);
  assertCheck(historicalLog(checkpoint.checks[2]), 'journal-regressions', 80, 'cwd', oldBase, root, sha, true);

  const review = readBound(root, evidence.review, REVIEW_PATH, sha, 'C06 review').value;
  assert.equal(review.schema, 'nisi.c06.owner-retained-source-review.v1');
  assert.equal(review.reviewerTask, '/root/cli_acceptance_luna', 'C06 reviewer task');
  assert.equal(review.modelActuallyServed, 'UNKNOWN'); assert.equal(review.reviewerExecutedTests, false);
  assert.equal(review.verdict, 'NO_NEW_P1_P2_FINDINGS');
  for (const key of ['implementationAccepted', 'nativeBuildAccepted', 'publicationAuthorized'])
    assert.equal(review[key], false, `C06 review forbidden credit: ${key}`);
  assert.deepEqual(review.sourceHashes, REVIEWED_THREE, 'C06 review source identity');

  const validation = readBound(root, evidence.validation, VALIDATION_PATH, sha, 'C06 validation').value;
  assert.equal(evidence.validation.logPath, VALIDATION_LOG, 'C06 validation log path');
  const log = containedBytes(root, VALIDATION_LOG, 'C06 validation log');
  assert.equal(sha(log), evidence.validation.logSha256, 'C06 validation log digest mismatch');
  assert.equal(validation.logSha256, evidence.validation.logSha256, 'C06 validation/log receipt mismatch');
  assert.deepEqual(validation.sourceHashes, REVIEWED_THREE, 'C06 validation source identity');
  assert.equal(validation.exitCode, 0); assert.equal(validation.error, null); assert.equal(validation.signal, null);
  assert.equal(validation.ok, true); assert.equal(validation.unchanged, true); assert.equal(validation.inference, 'NOT_RUN');
  assert.equal(validation.implementationAccepted, false); assert.equal(validation.binding.taskFingerprint, TASK_FINGERPRINT, 'C06 validation taskFingerprint');
  assert.equal(validation.binding.candidateFingerprint, CANDIDATE_FINGERPRINT, 'C06 validation candidateFingerprint');
  assert.equal(validation.binding.reviewedCandidateSha256, null); assert.equal(validation.binding.reviewBindingMatches, false);
  const rawValidation = JSON.parse(log);
  assert.equal(rawValidation.kind, 'nisi.scratch-validation.v1'); assert.equal(rawValidation.status, 'VALIDATED');
  assert.equal(rawValidation.advisoryOnly, true); assert.equal(rawValidation.accepted, false);
  assert.equal(rawValidation.authorizing, false, 'C06 raw validation authorizing');
  assert.deepEqual(rawValidation.binding, validation.binding, 'C06 raw validation binding');
  assert.deepEqual(rawValidation.checks.contract, { status: 'PASS', code: null }, 'C06 validation contract');
  assert.equal(rawValidation.checks.syntax.status, 'PASS', 'C06 validation syntax status');
  assert.deepEqual(rawValidation.checks.syntax.checkedFiles.map(({ path, status, code }) => ({ path, status, code })), [
    { path: 'history/host-journal-bundle.mjs', status: 'PASS', code: null },
    { path: 'tests/host-journal-bundle.test.mjs', status: 'PASS', code: null },
    { path: 'work-orders/v02-finish-cluster-v1/restart/host-bundle-integration.test.mjs', status: 'PASS', code: null }
  ], 'C06 validation syntax inventory');
  for (const checked of rawValidation.checks.syntax.checkedFiles) {
    assert.deepEqual(checked.evidence.argv, ['--check', './'+checked.path], 'C06 syntax command');
    for (const [key, expected] of Object.entries({exitCode:0,signal:null,timedOut:false,outputExceeded:false,closeObserved:true,errorCode:null}))
      assert.equal(checked.evidence[key], expected, 'C06 syntax evidence: '+key);
  }
  assert.deepEqual(rawValidation.checks.syntax.skippedFiles, []); assert.equal(rawValidation.checks.tests.status, 'NOT_RUN');
  assert.equal(rawValidation.checks.tests.code, 'EXECUTION_NOT_REQUESTED');
  assert.equal(rawValidation.checks.tests.assertionsExecuted, 0); assert.equal(rawValidation.checks.tests.assertionsPassed, 0);

  const canonical = readBound(root, evidence.canonical, CANONICAL_PATH, sha, 'C06 canonical checks').value;
  assert.equal(canonical.schema, 'nisi.c06.canonical-checks.v1');
  assert.equal(canonical.node, RECORDED_NODE_VERSION, 'C06 canonical runtime version');
  assert.equal(canonical.ok, true); assert.equal(canonical.sourceUnchanged, true); assert.equal(canonical.dependenciesUnchanged, true);
  assertNoAuthority(canonical, 'C06 canonical checks');
  assert.deepEqual(canonical.sourceHashes, C06_SOURCE_HASHES, 'C06 canonical source identity');
  assert.deepEqual(canonical.dependencyHashes, dependencies, 'C06 canonical dependency identity');
  assert.deepEqual(canonical.prerequisite, {
    id: 'C05', evidence: C05_EVIDENCE, evidenceSha256: C05_EVIDENCE_SHA256,
    sourceHashes: c05.ownerAcceptance.sourceHashes
  }, 'C06 canonical C05 prerequisite');
  assert.deepEqual(evidence.prerequisite, canonical.prerequisite, 'C06 evidence C05 prerequisite');
  assert.equal(canonical.checks.length, 3, 'C06 canonical check inventory');
  assertCheck(canonical.checks[0], 'c06', 52, 'relativeCwd', 'work-orders/v02-finish-cluster-v1', root, sha, true);
  assertCheck(canonical.checks[1], 'c05', 111, 'relativeCwd', 'work-orders/v02-finish-cluster-v1', root, sha, true);
  assertCheck(canonical.checks[2], 'journal-regressions', 80, 'relativeCwd', '.', root, sha, true);
  // Semantic checks above explain a failure; this immutable owner pin also
  // rejects replacement receipts that happen to satisfy the same schema.
  assert.equal(acceptance.evidenceSha256, OWNER_EVIDENCE_SHA256, 'C06 immutable owner evidence identity');
  return true;
}
