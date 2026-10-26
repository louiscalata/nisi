import assert from 'node:assert/strict';
import { assertC07BaselineV3, C07_BASELINE_DEPENDENCY_TRANSITIONS, C07_ORIGINAL_PACKET_PATH } from './check-c07-baseline-v3.mjs';
import fs from 'node:fs';
import path from 'node:path';

// Owner-pinned additive acceptance gate. No native or dispatch authority.
export const C07_SCOPE = 'CALLER_SUPPLIED_NATIVE_INCIDENT_EVIDENCE_NODE_ONLY';
export const C07_EVIDENCE = '.packet-diagnostics/c07-owner-draft-20260920/final-evidence.json';
export const C07_EVIDENCE_SHA256 = '7909ceae8efe9290c63163834f31485894458fef3faa79506db3c5ede592ea10';
export const C07_CANDIDATE_CHECKPOINT_SHA256 = 'ad8107429139a026435009404b49edbb7ab5b43136d95ef753e47a74e32af8ef';
export const C07_CANONICAL_CHECKS_SHA256 = 'adf573d2aaf0740d8f6eff26091100186ef4c875d47f1c3167f6bcf69f908093';
export const C07_INTEGRATION_REVIEW_SHA256 = '10dc3c81db7b283aa1eaaeb5c272ccd2f96ec09a7770c6005a90a513255db655';
export const C07_PACKET = '.packets/nisi-v02-c07-native-incident-oracle.packet.md';
export const C06_EVIDENCE_SHA256 = '922cfd9585df6ad86eaf252fd17c9b3b94d1f7e681a7d824625e2cbfea3af4ce';
export const C07_SOURCE_HASHES = Object.freeze({
  'hosts/repository/native-incident-source-v1.mjs': '6a1ddf192be45ff14e4471e08470429a6fcea300642e4f681d10f187b7540e74',
  'hosts/repository/native-incident-admission-v1.mjs': 'fd333e82263b1fa7953880d592dc73615f98bca615ebc95ffcf6432692e82fdf',
  'work-orders/v02-finish-cluster-v1/native-incident/admission-integration.test.mjs': 'de732e0241db59e7f4f4a7e75d473add44dd0a47bdff32c9b5716c2d6ab321cb',
  'work-orders/v02-finish-cluster-v1/native-incident/native-incident-source-v1.test.mjs': 'b59e4880e742a07ed9d883024c173dd1d30ba94bdc253b4a5446c2abb3df2a51',
  'work-orders/v02-finish-cluster-v1/native-incident/README.md': '8bb2cb2835aff33f658e50e921a1e0b87d61e53e23af3f2d9fab49a194209f75',
});
export const C07_EXECUTION_SOURCE_HASHES = Object.freeze(Object.fromEntries(Object.entries(C07_SOURCE_HASHES).filter(([file]) => !file.endsWith('/README.md'))));
export const C07_DEPENDENCY_MAP_SHA256 = 'd368f5e3935324445f544b4eab081f66763b8149a9c8438a0bb94a2effc23461';
export const C07_DEPENDENCY_SUPERSESSION = Object.freeze({
  by: 'C07',
  affectedAcceptances: Object.freeze(['C04', 'C05', 'C06']),
  path: 'hosts/repository/native-incident-source-v1.mjs',
  oldSha256: 'ab08ed666126011f3e57f7d3975dce8602a1d570f81c8c544f1c58a2f0616a26',
  newSha256: C07_SOURCE_HASHES['hosts/repository/native-incident-source-v1.mjs'],
});
export const C07_MUTANTS = Object.freeze([
  'alias-digest', 'reuse-handle', 'reverse-clock', 'raw-stream-hash',
  'paired-request', 'grant-executable',
]);
export const C07_CHECK_NAMES = Object.freeze(['source-regressions', 'c07-candidate', 'source-identity']);
const HEX = /^[0-9a-f]{64}$/u;
const FORBIDDEN = Object.freeze([
  'openCodeExecuted', 'nativeBuildAccepted', 'publicationAuthorized',
  'sourceAuthenticityAttested', 'nativeExecutionAttested', 'resumeGranted',
]);

function record(value, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} record`);
  return value;
}
function relative(file, label) {
  assert.equal(typeof file, 'string', `${label} path type`);
  assert(file && !path.isAbsolute(file) && !file.includes('\\') && !file.split('/').includes('..'), `${label} relative path`);
  return file;
}
function contained(root, file, label) {
  relative(file, label);
  const filename = path.join(root, file);
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink(), `${label} regular file`);
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(filename);
  assert(realFile.startsWith(`${realRoot}${path.sep}`), `${label} containment`);
  return fs.readFileSync(filename);
}
function digest(bytes, sha) { return sha(bytes); }
function assertNoAuthority(value, label) {
  record(value, label);
  for (const key of FORBIDDEN) if (Object.hasOwn(value, key)) assert.equal(value[key], false, `${label} forbidden credit: ${key}`);
  if (Object.hasOwn(value, 'inference')) assert.equal(value.inference, 'NOT_RUN', `${label} inference credit`);
}
function exactDigestMap(actual, expected, label) {
  assert.deepEqual(actual, expected, `${label} source map`);
  for (const [file, value] of Object.entries(expected)) {
    assert.match(value, HEX, `${label} unresolved ROOT_TO_FREEZE pin: ${file}`);
  }
}
function normalizedPacket(bytes) {
  const text = bytes.toString('utf8');
  assert.equal((text.match(/^project_root: .+$/gm) ?? []).length, 1, 'C07 packet project_root inventory');
  return Buffer.from(text.replace(/^project_root: .+$/m, 'project_root: <PROJECT_ROOT>'));
}
function readRef(root, ref, label, sha) {
  record(ref, `${label} reference`);
  relative(ref.path, `${label} reference`);
  const bytes = contained(root, ref.path, label);
  assert.match(ref.sha256, HEX, `${label} digest`);
  assert.equal(digest(bytes, sha), ref.sha256, `${label} digest mismatch`);
  return JSON.parse(bytes);
}
function assertCheck(row, name, root, sha) {
  record(row, `C07 ${name} check`);
  assert.equal(row.name, name, `C07 ${name} name`);
  assert.equal(row.ok, true, `C07 ${name} failed`);
  assert.equal(row.exitCode, 0); assert.equal(row.error, null); assert.equal(row.signal, null);
  assert.equal(row.timedOut, false); assert.equal(row.skipped ?? 0, 0); assert.equal(row.cancelled ?? 0, 0);
  assert(Number.isSafeInteger(row.counts?.tests) && row.counts.tests > 0, `C07 ${name} count missing`);
  assert.deepEqual(row.counts, { tests: row.counts.tests, pass: row.counts.tests,
    fail: 0, skipped: 0, cancelled: 0, todo: 0 }, `C07 ${name} counts`);
  assert.match(row.logSha256, HEX, `C07 ${name} log digest`);
  const log = contained(root, row.logPath, `C07 ${name} log`);
  assert.equal(digest(log, sha), row.logSha256, `C07 ${name} log identity`);
  assertRawCounts(log, row.counts, `C07 ${name}`);
}
function assertRawCounts(log, expected, label) {
  const actual = Object.fromEntries(['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo'].map(key => {
    const matches = [...log.toString('utf8').matchAll(new RegExp('^# ' + key + ' (\\d+)$', 'gm'))];
    assert.equal(matches.length, 1, label + ' raw count inventory');
    return [key, Number(matches[0][1])];
  }));
  assert.deepEqual(actual, expected, label + ' raw counts');
}
function assertRawValidation(root, ref, sourceHashes, sha) {
  const raw = readRef(root, ref, 'C07 validation', sha);
  assert.equal(raw.kind, 'nisi.scratch-validation.v1');
  assert.equal(raw.status, 'VALIDATED');
  assert.equal(raw.advisoryOnly, true); assert.equal(raw.accepted, false); assert.equal(raw.authorizing, false);
  assertNoAuthority(raw, 'C07 validation');
  assert.equal(raw.checks?.contract?.status, 'PASS');
  assert.equal(raw.checks?.syntax?.status, 'PASS');
  assert.deepEqual(raw.checks?.syntax?.checkedFiles?.map(row => row.path).sort(), Object.keys(sourceHashes).sort());
  assert(raw.checks.syntax.checkedFiles.every(row => row.status === 'PASS' && row.evidence?.exitCode === 0 &&
    row.evidence?.signal === null && row.evidence?.timedOut === false));
  assert.equal(raw.checks?.tests?.status, 'NOT_RUN');
  return raw;
}

// An additive correction, not a rewrite of C04-C07 historical receipts. Only
// these two exact predecessor identities may resolve to reviewed current bytes.
export const HISTORY_EVIDENCE = '.packet-diagnostics/history-proxy-owner-20260920/integration/evidence.json';
export const HISTORY_EVIDENCE_SHA256 = '1c66ba2186e2d488c36c3ec22f1d221e5f79957cd81a4b053a3d1991661217b9';
export const HISTORY_TRANSITIONS = Object.freeze([
  Object.freeze({path:'history/journal-owner-v2.mjs', oldSha256:'b64e21ae717870faf220baf3f0ddc9c44841f0492415805f7b75b812828e7184', newSha256:'2120bf0c75d9aa6122c06a2b34d55b3256a08f024d0e5fa43d8877e4eb67e44f'}),
  Object.freeze({path:'history/run-journal-v1.mjs', oldSha256:'dee9f490c091000b2560cd9464d945885e7f341091b87dde9ae4f2b7cdbd359e', newSha256:'0164f10da27f6d12cfd1f3d443bd8e0f7c237b46363353570ae4a759a97f749b'}),
]);
export function assertHistoryHardening({root, cluster, sha}) {
  if (!Object.hasOwn(cluster, 'historyHardening')) return (_file, digest) => digest;
  const baselineV3 = assertC07BaselineV3({root, cluster, sha});
  const expected = {scope:'NODE_HISTORY_PROXY_BOUNDARIES', evidence:HISTORY_EVIDENCE,
    evidenceSha256:HISTORY_EVIDENCE_SHA256, transitions:HISTORY_TRANSITIONS,
    affectedAcceptances:['C04','C05','C06','C07']};
  assert.deepEqual(cluster.historyHardening, expected, 'history exact transition record');
  for (const id of expected.affectedAcceptances)
    assert.equal(cluster.packets?.find(row=>row.id===id)?.implementationAccepted, true, 'history affected acceptance: '+id);
  const bytes=contained(root,HISTORY_EVIDENCE,'history evidence');
  assert.equal(sha(bytes),HISTORY_EVIDENCE_SHA256,'history immutable evidence identity');
  const evidence=JSON.parse(bytes);
  assert.equal(evidence.schema,'nisi.history-hardening-evidence/v1');
  assert.equal(evidence.scope,expected.scope);
  assert.deepEqual(evidence.transitions,HISTORY_TRANSITIONS);
  assert.deepEqual(evidence.affectedAcceptances,expected.affectedAcceptances);
  assertNoAuthority(evidence,'history evidence');
  assert.equal(evidence.implementationAccepted,false);
  for (const [file,hash] of Object.entries(evidence.bindings))
    assert.equal(sha(contained(root,file,'history retained evidence')),hash,'history retained identity: '+file);
  const canonical=JSON.parse(contained(root,evidence.canonical,'history canonical'));
  assert.equal(canonical.schema,'nisi.history-hardening-canonical/v1');
  assert.equal(canonical.scope,expected.scope); assert.equal(canonical.ok,true);
  assert.equal(canonical.unchanged,true); assert.deepEqual(canonical.before,canonical.after);
  assertNoAuthority(canonical,'history canonical'); assert.equal(canonical.implementationAccepted,false);
  // Also check unmodified importing dependencies and test oracles; the new
  // evidence does not grant a generic source-drift exception.
  for (const [file,hash] of Object.entries(canonical.before)) {
    const transition = baselineV3.dependencyTransitions.find(row => row.path === file);
    if (transition) assert.equal(hash, transition.oldSha256, 'history exact predecessor: '+file);
    assert.equal(sha(contained(root,file,'history dependency')),transition?.newSha256 ?? hash,'history dependency drift: '+file);
  }
  for (const row of HISTORY_TRANSITIONS) {
    assert.equal(canonical.sourceHashes[row.path],row.newSha256);
    assert.equal(sha(contained(root,'.packet-diagnostics/history-proxy-owner-20260920/before/'+row.path,'history predecessor')),row.oldSha256);
  }
  assert.deepEqual(canonical.checks.map(row=>[row.name,row.counts.tests]),
    [['history',154],['host-history',50],['c05',111],['c06',52],['c07',54]],'history importing suite inventory');
  assert.equal(sha(Buffer.from(JSON.stringify(canonical.checks.map(row=>({name:row.name,command:row.command,relativeCwd:row.relativeCwd}))))),
    '526b8498af31cecfc3ac99b54443c997131f624bd8d277cc6af6e0c0c74a2187','history exact commands and working directories');
  for (const row of canonical.checks) {
    assert.equal(row.ok,true); assert.equal(row.exitCode,0);
    assert.equal(row.error,null); assert.equal(row.signal,null);
    assert.deepEqual(row.counts,{tests:row.counts.tests,pass:row.counts.tests,fail:0,skipped:0,cancelled:0,todo:0});
    const prefix=path.posix.join(path.posix.dirname(evidence.canonical),row.name);
    const raw=contained(root,prefix+'.stdout.log','history test log');
    assert.equal(sha(raw),row.stdoutSha256); assertRawCounts(raw,row.counts,'history '+row.name);
    assert.equal(sha(contained(root,prefix+'.stderr.log','history stderr')),row.stderrSha256);
  }
  const isolated=JSON.parse(contained(root,evidence.isolated,'history isolated'));
  assert.equal(isolated.passed,true); assert.equal(isolated.unchanged,true);
  assert.deepEqual(isolated.initial,isolated.final,'history isolated snapshots');
  assert.deepEqual(isolated.results.map(row=>[row.name,row.counts.tests,row.counts.pass,row.counts.fail]),
    [['before-existing',95,95,0],['before-new-regressions',41,11,30],
      ['candidate-existing',95,95,0],['candidate-new-regressions',41,41,0]],'history before/after coverage');
  const validation=JSON.parse(contained(root,evidence.validation,'history validation'));
  assert.equal(validation.exitCode,0); assert.equal(validation.error,null); assert.equal(validation.signal,null);
  assert.equal(validation.unchanged,true); assert.equal(validation.modelInference,'NOT_RUN');
  const reviewedHashes=Object.fromEntries(HISTORY_TRANSITIONS.map(row=>[row.path,row.newSha256]));
  reviewedHashes['tests/journal-proxy-boundaries.test.mjs']='4608d36de36c91b0318889b712e78f4971d7a2ea5c6093112e9975553ce8a1cb';
  assert.deepEqual(validation.sourceHashes,reviewedHashes,'history exact Nisi source inventory');
  for (const [file,hash] of Object.entries(validation.sourceHashes)) assert.equal(canonical.sourceHashes[file],hash);
  const rawValidation=JSON.parse(contained(root,path.posix.join(path.posix.dirname(evidence.validation),'stdout.log'),'history validation result'));
  assert.equal(rawValidation.status,'VALIDATED'); assert.equal(rawValidation.accepted,false);
  assert.equal(rawValidation.authorizing,false); assert.equal(rawValidation.advisoryOnly,true);
  assert.equal(rawValidation.checks.contract.status,'PASS'); assert.equal(rawValidation.checks.syntax.status,'PASS');
  assert.equal(rawValidation.checks.tests.status,'NOT_RUN');
  assert.deepEqual(rawValidation.checks.syntax.skippedFiles,[]);
  assert.deepEqual(rawValidation.checks.syntax.checkedFiles.map(row=>row.path),Object.keys(reviewedHashes));
  for (const row of rawValidation.checks.syntax.checkedFiles) {
    assert.equal(row.status,'PASS'); assert.equal(row.code,null);
    assert.deepEqual(row.evidence.argv,['--check','./'+row.path]);
    assert.equal(row.evidence.exitCode,0); assert.equal(row.evidence.signal,null);
    assert.equal(row.evidence.timedOut,false); assert.equal(row.evidence.outputExceeded,false);
    assert.equal(row.evidence.closeObserved,true); assert.equal(row.evidence.errorCode,null);
  }
  const review=JSON.parse(contained(root,evidence.sourceReview,'history source review'));
  assert.equal(review.schema,'nisi.history-source-review/v1'); assert.equal(review.scope,expected.scope);
  assert.equal(review.verdict,'PASS'); assert.equal(review.reviewerTask,'/root/sharedchami_cleanup_daybreak_review');
  assert.equal(review.modelRequested,'gpt-daybreak-blue-latest'); assert.equal(review.modelActuallyServed,'UNKNOWN');
  assert.equal(review.reviewerExecutedTests,false); assert.deepEqual(review.sourceHashes,reviewedHashes);
  assertNoAuthority(review,'history source review'); assert.equal(review.authorizing,false);
  assert.equal(review.implementationAccepted,false);
  return (file,digest) => {
    const transition=HISTORY_TRANSITIONS.find(row=>row.path===file);
    if (!transition) return digest;
    assert.equal(digest,transition.oldSha256,'history predecessor digest: '+file);
    return transition.newSha256;
  };
}

export function assertC07Acceptance({ root, cluster, sha }) {
  assert.equal(typeof root, 'string', 'C07 root');
  record(cluster, 'C07 cluster'); assert.equal(typeof sha, 'function', 'C07 sha');
  const row = cluster.packets?.find(candidate => candidate?.id === 'C07');
  const c06 = cluster.packets?.find(candidate => candidate?.id === 'C06');
  assert(row?.implementationAccepted === true, 'C07 accepted state missing');
  assertNoAuthority(row, 'C07 ledger');
  assert.deepEqual(row.dependencies, ['C01', 'C06'], 'C07 prerequisite inventory');
  assert.equal(row.state, 'NODE_IMPLEMENTATION_ACCEPTED', 'C07 accepted-state mismatch');
  assert.equal(row.ownerAcceptance?.scope, C07_SCOPE, 'C07 scope mismatch');
  assert.equal(row.ownerAcceptance?.acceptedBy, 'codex', 'C07 owner mismatch');
  assert.equal(row.ownerAcceptance?.integrationRoute, 'OWNER_IMPLEMENTATION_WITH_LUNA_TESTS_DAYBREAK_REVIEW', 'C07 provenance mismatch');
  assert.equal(row.ownerAcceptance?.evidence, C07_EVIDENCE, 'C07 evidence path mismatch');
  assert.equal(row.ownerAcceptance?.evidenceSha256, C07_EVIDENCE_SHA256, 'C07 evidence digest pin');
  for (const key of FORBIDDEN) if (Object.hasOwn(row.ownerAcceptance, key)) assert.equal(row.ownerAcceptance[key], false, `C07 forbidden credit: ${key}`);
  assert.equal(row.ownerAcceptance?.inference, 'NOT_RUN', 'C07 inference credit');
  assert.deepEqual(row.allowedFiles, Object.keys(C07_SOURCE_HASHES), 'C07 exact five-file scope');
  exactDigestMap(row.ownerAcceptance.sourceHashes, C07_SOURCE_HASHES, 'C07 accepted');
  for (const [file, hash] of Object.entries(C07_SOURCE_HASHES))
    assert.equal(sha(contained(root, file, 'C07 source')), hash, 'C07 source drift: ' + file);

  assert(c06?.implementationAccepted === true, 'C07 requires accepted C06');
  assert.equal(c06.ownerAcceptance?.evidenceSha256, C06_EVIDENCE_SHA256, 'C06 historical evidence changed');
  assert.equal(c06.ownerAcceptance?.scope, 'CALLER_SUPPLIED_HOST_OBSERVATION_NODE_ONLY', 'C06 scope changed');
  assert.equal(c06.ownerAcceptance?.sourceHashes?.['history/host-journal-bundle.mjs'], 'e2954caeaa987993fd17e1904d4222e5b030b29e7f028c816809fe83ae0ace6b', 'C06 source history changed');
  assert.equal(c06.ownerAcceptance?.sourceHashes?.['work-orders/v02-finish-cluster-v1/restart/host-bundle-integration.test.mjs'], 'b24f8c1d8599fd91b636e960fb2dc841d646ca0347b3be075457ab7195e03817', 'C06 oracle history changed');
  const c06EvidenceBytes = contained(root, '.packet-diagnostics/c06-owner-draft-20260920/final-evidence.json', 'C06 immutable evidence');
  assert.equal(sha(c06EvidenceBytes), C06_EVIDENCE_SHA256, 'C06 historical evidence drift');
  const c06Evidence = JSON.parse(c06EvidenceBytes);
  assert.deepEqual(c06.ownerAcceptance.sourceHashes, c06Evidence.sourceHashes, 'C06 historical source map');
  assert.equal(c06.ownerAcceptance.evidence, '.packet-diagnostics/c06-owner-draft-20260920/final-evidence.json', 'C06 evidence path');
  assert.equal(c06Evidence.dependencyHashes[C07_DEPENDENCY_SUPERSESSION.path], C07_DEPENDENCY_SUPERSESSION.oldSha256, 'C06 historical dependency');
  const supersessions = cluster.dependencySupersessions ?? [];
  assert.deepEqual(supersessions, [{ ...C07_DEPENDENCY_SUPERSESSION, evidence: C07_EVIDENCE,
    evidenceSha256: C07_EVIDENCE_SHA256 }], 'C07 dependency supersession binding');

  const evidenceBytes = contained(root, C07_EVIDENCE, 'C07 evidence');
  assert.equal(digest(evidenceBytes, sha), row.ownerAcceptance.evidenceSha256, 'C07 evidence digest mismatch');
  assert.equal(digest(evidenceBytes, sha), C07_EVIDENCE_SHA256, 'C07 immutable evidence identity');
  const evidence = JSON.parse(evidenceBytes);
  assert.equal(evidence.schema, 'nisi.c07.evidence-binding.v1', 'C07 evidence schema');
  assert.equal(evidence.scope, C07_SCOPE, 'C07 evidence scope');
  assertNoAuthority(evidence, 'C07 evidence');
  assert.equal(evidence.implementationAccepted, false, 'C07 evidence self-authorized');
  exactDigestMap(evidence.sourceHashes, C07_SOURCE_HASHES, 'C07 evidence');
  assert.deepEqual(evidence.sourceHashes, row.ownerAcceptance.sourceHashes, 'C07 evidence/source mismatch');
  assert.deepEqual(evidence.documentationFiles, ['work-orders/v02-finish-cluster-v1/native-incident/README.md'], 'C07 documentation inventory');
  assert.equal(Object.keys(evidence.dependencyHashes ?? {}).length, 97, 'C07 evidence dependency map size');
  assert.match(evidence.dependencyClosureSha256 ?? '', HEX, 'C07 evidence dependency closure');
  assert.equal(digest(Buffer.from(JSON.stringify(evidence.dependencyHashes)), sha), evidence.dependencyClosureSha256, 'C07 evidence dependency digest');
  assert.equal(evidence.dependencyClosureSha256, C07_DEPENDENCY_MAP_SHA256, 'C07 dependency map pin');
  const historyDigest=assertHistoryHardening({root,cluster,sha});
  const baselineV3 = assertC07BaselineV3({root,cluster,sha});
  for (const [file, hash] of Object.entries(evidence.dependencyHashes)) {
    const transition = baselineV3.dependencyTransitions.find(row => row.path === file);
    if (transition) assert.equal(hash, transition.oldSha256, 'C07 exact predecessor: '+file);
    assert.equal(sha(contained(root, file, 'C07 dependency')), transition?.newSha256 ?? historyDigest(file,hash), 'C07 dependency drift: ' + file);
  }
  assert.deepEqual(evidence.prerequisite, { id: 'C06', evidence: '.packet-diagnostics/c06-owner-draft-20260920/final-evidence.json', evidenceSha256: C06_EVIDENCE_SHA256 }, 'C07 evidence prerequisite');
  assert.deepEqual(evidence.dependencySupersession, C07_DEPENDENCY_SUPERSESSION, 'C07 evidence dependency transition');

  const packet = evidence.packet;
  assert.equal(packet?.path, C07_PACKET, 'C07 packet path');
  assert.equal(packet?.normalization, 'PROJECT_ROOT_PLACEHOLDER_V1', 'C07 packet normalization');
  // Historical v1 contract stays bound to its exact preserved original bytes.
  // assertC07BaselineV3 separately proves the selected amended active packet.
  const packetBytes = contained(root, C07_ORIGINAL_PACKET_PATH, 'C07 preserved original packet');
  assert.equal(digest(normalizedPacket(packetBytes), sha), packet.sha256, 'C07 packet digest mismatch');
  const packetText = contained(root, packet.path, 'C07 current amended packet').toString('utf8');
  assert.equal((packetText.match(/^status: blocked$/gm) ?? []).length, 1, 'C07 packet must remain blocked');
  assert.equal((packetText.match(/^write_owner: opencode$/gm) ?? []).length, 1, 'C07 packet owner');

  const checkpoint = readRef(root, evidence.checkpoint, 'C07 checkpoint', sha);
  assert.equal(checkpoint.schema, 'nisi-c07-isolated-verifier/v1');
  assert.equal(checkpoint.ok, true); assert.equal(checkpoint.candidateUnchanged, true);
  assert.equal(checkpoint.canonicalUnchanged, true); assert.equal(checkpoint.baselineStageUnchanged, true);
  assert.equal(checkpoint.candidateOverlayUnchanged, true); assert.equal(checkpoint.dependenciesUnchanged, true);
  assert.equal(checkpoint.callerSuppliedFixtureOnly, true);
  assert.equal(checkpoint.implementationAccepted, false); assert.equal(checkpoint.nativeExecutionAttested, false);
  assert.equal(checkpoint.inference, 'NOT_RUN');
  assert.deepEqual(checkpoint.candidateHashes, C07_EXECUTION_SOURCE_HASHES, 'C07 checkpoint candidate identity');
  assert.deepEqual(checkpoint.checks?.map(check => check.name), [...C07_CHECK_NAMES], 'C07 check inventory');
  for (const check of checkpoint.checks) assertCheck({ ...check,
    logPath: path.posix.join(path.posix.dirname(evidence.checkpoint.path), check.name + '.log') }, check.name, root, sha);
  const candidateCheckpoint = readRef(root, evidence.candidateCheckpoint, 'C07 immutable candidate checkpoint', sha);
  assert.equal(evidence.candidateCheckpoint.path, '.packet-diagnostics/c07-owner-draft-20260920/candidate-checkpoint.json');
  assert.equal(evidence.candidateCheckpoint.sha256, C07_CANDIDATE_CHECKPOINT_SHA256);
  assert.deepEqual(candidateCheckpoint.sourceHashes, C07_EXECUTION_SOURCE_HASHES, 'C07 immutable candidate source identity');
  assert.equal(candidateCheckpoint.implementationAccepted, false); assert.equal(candidateCheckpoint.inference, 'NOT_RUN');

  const validation = readRef(root, evidence.validation, 'C07 validation receipt', sha);
  assert.equal(validation.exitCode, 0); assert.equal(validation.error, null); assert.equal(validation.signal, null);
  assert.equal(validation.unchanged, true); assert.equal(validation.implementationAccepted, false);
  assertRawValidation(root, { path: evidence.validation.logPath, sha256: evidence.validation.logSha256 }, C07_EXECUTION_SOURCE_HASHES, sha);

  const canonical = readRef(root, evidence.canonical, 'C07 canonical checks', sha);
  assert.equal(evidence.canonical.path, '.packet-diagnostics/c07-owner-draft-20260920/canonical-MybG74/checks.json');
  assert.equal(evidence.canonical.sha256, C07_CANONICAL_CHECKS_SHA256);
  assert.equal(canonical.schema, 'nisi.c07.canonical-checks.v1');
  assert.equal(canonical.ok, true); assert.equal(canonical.sourceUnchanged, true);
  assert.equal(canonical.dependenciesUnchanged, true); assert.equal(canonical.inference, 'NOT_RUN');
  assertNoAuthority(canonical, 'C07 canonical checks');
  exactDigestMap(canonical.sourceHashes, C07_SOURCE_HASHES, 'C07 canonical checks');
  assert.equal(Object.keys(canonical.dependencyHashes ?? {}).length, 97, 'C07 exact canonical dependency map size');
  assert.match(C07_DEPENDENCY_MAP_SHA256, HEX, 'C07 dependency closure pin');
  assert.equal(digest(Buffer.from(JSON.stringify(canonical.dependencyHashes)), sha), C07_DEPENDENCY_MAP_SHA256, 'C07 dependency closure digest');
  assert.deepEqual(canonical.dependencyHashes, evidence.dependencyHashes, 'C07 canonical/evidence dependency map');
  assert.equal(Object.hasOwn(canonical.dependencyHashes, C07_DEPENDENCY_SUPERSESSION.path), false, 'C07 old dependency duplicated as accepted source');
  for (const file of Object.keys(C07_SOURCE_HASHES)) assert.equal(Object.hasOwn(canonical.dependencyHashes, file), false, `C07 accepted source duplicated as dependency: ${file}`);
  assert.deepEqual(canonical.prerequisite, {
    id: 'C06', evidence: '.packet-diagnostics/c06-owner-draft-20260920/final-evidence.json', evidenceSha256: C06_EVIDENCE_SHA256,
  }, 'C07 C06 canonical prerequisite');
  const canonicalChecks = [
    ['c07', 54], ['c06', 52], ['c05', 111], ['journal-regressions', 80],
  ];
  assert.deepEqual(canonical.checks?.map(row => [row.name, row.counts?.tests]), canonicalChecks, 'C07 canonical check inventory');
  for (const [name, count] of canonicalChecks) {
    const check = canonical.checks.find(row => row.name === name);
    assert.equal(check.ok, true, `C07 canonical ${name}`); assert.equal(check.exitCode, 0);
    assert.equal(check.error, null); assert.equal(check.signal, null);
    assert.deepEqual(check.counts, { tests: count, pass: count, fail: 0, skipped: 0, cancelled: 0, todo: 0 }, `C07 canonical ${name} counts`);
    assert.match(check.logSha256, HEX); contained(root, check.logPath, `C07 canonical ${name} log`);
    const raw = contained(root, check.logPath, `C07 canonical ${name} log`);
    assert.equal(digest(raw, sha), check.logSha256);
    assertRawCounts(raw, check.counts, `C07 canonical ${name}`);
  }

  const mutations = readRef(root, evidence.mutations, 'C07 mutation receipt', sha);
  assert.equal(mutations.checkpointSha256, evidence.checkpoint.sha256);
  assert.equal(mutations.restored, true); assert.equal(mutations.candidateUnchanged, true);
  assert.equal(mutations.implementationAccepted, false); assert.equal(mutations.inference, 'NOT_RUN');
  const mutationRows = mutations.checks;
  assert.deepEqual(mutationRows?.map(row => row.name), ['control-before', ...C07_MUTANTS, 'control-after'], 'C07 mutation inventory');
  for (const result of mutationRows) {
    assert.equal(result.error, null); assert.equal(result.signal, null); assert.equal(result.ok, true);
    assert.equal(result.shouldPass, result.name === 'control-before' || result.name === 'control-after');
    assert.equal(result.counts.skipped, 0); assert.equal(result.counts.cancelled, 0);
    const rawMutationLog = contained(root, path.posix.join(path.posix.dirname(evidence.mutations.path), result.name + '.log'), `C07 ${result.name} mutation log`);
    assert.equal(digest(rawMutationLog, sha), result.logSha256);
    assertRawCounts(rawMutationLog, result.counts, 'C07 mutant ' + result.name);
    assert.equal(result.counts.tests, 23); assert.equal(result.counts.todo, 0);
    if (result.shouldPass) {
      assert.equal(result.exitCode, 0); assert.equal(result.counts.fail, 0); assert.equal(result.counts.pass, result.counts.tests);
    } else {
      assert.equal(result.exitCode, 1); assert(result.counts.fail > 0, `C07 mutant escaped: ${result.name}`);
      assert.match(rawMutationLog.toString('utf8'), /ERR_ASSERTION/, `C07 mutant lacked assertion failure: ${result.name}`);
      assert.match(result.sourceSha256, HEX); assert.notEqual(result.sourceSha256, C07_SOURCE_HASHES['hosts/repository/native-incident-admission-v1.mjs']);
    }
  }

  const review = readRef(root, evidence.review, 'C07 review', sha);
  assert.equal(review.schema, 'nisi.c07.owner-retained-source-review.v1');
  assert.equal(review.verdict, 'PASS'); assert.equal(review.modelActuallyServed, 'UNKNOWN');
  assert.equal(review.reviewerExecutedTests, false); assertNoAuthority(review, 'C07 review');
  exactDigestMap(Object.fromEntries(Object.entries(review.sourceHashes ?? {}).map(([key, value]) => [key.replace(/^candidate\//, ''), value])), C07_EXECUTION_SOURCE_HASHES, 'C07 review');
  const integrationReview = readRef(root, evidence.integrationReview, 'C07 integration review', sha);
  assert.equal(evidence.integrationReview.path, '.packet-diagnostics/c07-owner-draft-20260920/daybreak-integration-review-v2.json');
  assert.equal(evidence.integrationReview.sha256, C07_INTEGRATION_REVIEW_SHA256);
  assertNoAuthority(integrationReview, 'C07 integration review');
  assert.equal(integrationReview.schema, 'nisi.c07.integration-source-review.v1');
  assert.equal(integrationReview.verdict, 'PASS');
  assert.equal(integrationReview.reviewerTask, '/root/sharedchami_cleanup_daybreak_review');
  assert.equal(integrationReview.modelActuallyServed, 'UNKNOWN');
  assert.equal(integrationReview.reviewerExecutedTests, false);
  assert.equal(integrationReview.sourceHashes['work-orders/v02-finish-cluster-v1/native-incident/README.md'], C07_SOURCE_HASHES['work-orders/v02-finish-cluster-v1/native-incident/README.md']);
  assert.equal((cluster.acceptanceSupersessions ?? []).some(value => value.by === 'C07'), false, 'C07 must not append acceptance history');
  return true;
}
