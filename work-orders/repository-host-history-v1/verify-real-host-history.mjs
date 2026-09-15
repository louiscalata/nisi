// Private actual-host history oracle. No native launch, model/provider call or
// live store: the workflow owners are trusted synthetic adapters and the journal
// is an actual temporary POSIX file owned by this verification run.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { context } from '../../tests/helpers/node-repository-fixture.mjs';
import { fixedOptions } from '../../tests/helpers/repository-run-fixture.mjs';
import { createRepositoryWorkflowOwnerV1 } from '../../hosts/repository/reviewed-workflow-v1.mjs';
import { openJournalOwner } from '../../history/journal-owner-v2.mjs';
import { stableStringify, sha256Text } from '../../workflow/contracts.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const acceptanceName = process.argv[2];
assert.match(acceptanceName ?? '', /^\.build\/repository-host-history-verification-[A-Za-z0-9]+\/verification\.json$/);
const acceptance = JSON.parse(fs.readFileSync(path.join(root, acceptanceName), 'utf8'));
assert.equal(acceptance.status, 'PASS_SCOPED');
assert(acceptance.before && acceptance.after && typeof acceptance.before === 'object' && typeof acceptance.after === 'object');
const pinNames = Object.keys(acceptance.before).sort();
assert(pinNames.length > 0);
assert.deepEqual(pinNames, Object.keys(acceptance.after).sort());
const hash = value => createHash('sha256').update(value).digest('hex');
const actualPins = Object.fromEntries(pinNames.map(name => [name,
  hash(fs.readFileSync(path.join(root, name)))]));
assert.equal(pinNames.length, acceptance.checkedFiles);
for (const name of pinNames) {
  assert.match(acceptance.before[name], /^[0-9a-f]{64}$/); assert.match(acceptance.after[name], /^[0-9a-f]{64}$/);
  assert.equal(acceptance.before[name], acceptance.after[name], name);
  assert.equal(actualPins[name], acceptance.after[name], name);
}
const sourcePinsBefore = Object.fromEntries(pinNames.map(name => [name, acceptance.before[name]]));

const freezeOwner = ({ check, run, state = 'IDLE', history = [] }) => {
  const owner = { check, run, settled: async () => Object.freeze(history.slice()),
    observations: () => Object.freeze(history.slice()), status: () => state,
    lateObservations: () => Object.freeze([]), registrationFingerprint: 'a'.repeat(64) };
  return owner;
};
const reviewer = p => ({ status: 'PASS', evidence: { ...p.binding, reviewerId: 'reviewer.synthetic', findings: [],
  summary: 'synthetic reviewer', reason: '' } });
function openActualJournal(c, name) {
  const directory = fs.mkdtempSync(path.join(root, '.build/repository-host-history-real-'));
  const journalPath = path.join(directory, name + '.jsonl');
  const config = { projectId: 'repository-host-history-v1', maxEntries: 16, heartbeatTtlMs: 10,
    redactPaths: [] };
  const opened = openJournalOwner({ path: journalPath, fs, config, now: 1000 });
  assert.equal(opened.status, 'OPENED');
  return { directory, journalPath, config, owner: opened.owner };
}

function childReopen(journalPath, config, expectedId, expectedDigest, expectedBody, expectedCandidateId, expectedDeclarationDigest) {
  const ownerUrl = pathToFileURL(path.join(root, 'history/journal-owner-v2.mjs')).href;
  const code = `import fs from 'node:fs'; import assert from 'node:assert/strict';
    import {openJournalOwner} from ${JSON.stringify(ownerUrl)};
    const x=JSON.parse(process.argv[1]);
    const r=openJournalOwner({path:x.path,fs,config:x.config,now:2000});
    assert.equal(r.status,'OPENED'); assert.equal(r.snapshot.recovery.status,'COMPLETE');
    assert.deepEqual(r.snapshot.recovery.recoveredIds,[x.id]);
    assert.equal(r.snapshot.entries.length,1); assert.equal(r.snapshot.entries[0].entry.id,x.id);
    assert.deepEqual(r.snapshot.entries[0].entry.payload.preview,x.body);
    assert.equal(r.snapshot.entries[0].entry.payload.sourceDigest,x.digest);
    assert.equal(r.snapshot.entries[0].entry.payload.declarationDigest,x.declarationDigest);
    assert.equal(r.snapshot.entries[0].entry.candidateId,x.candidateId);
    assert.equal(r.snapshot.entries[0].authorizing,false);
    console.log(JSON.stringify({status:'REOPENED',id:r.snapshot.entries[0].entry.id,digest:r.snapshot.entries[0].entry.payload.sourceDigest,candidateId:r.snapshot.entries[0].entry.candidateId,authorizing:false}));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code,
    JSON.stringify({ path: journalPath, config, id: expectedId, digest: expectedDigest, body: expectedBody,
      candidateId: expectedCandidateId, declarationDigest: expectedDeclarationDigest })],
    { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 1048576 });
  assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

function noLeak(value, canaries) {
  const text = JSON.stringify(value);
  for (const canary of canaries) assert.equal(text.includes(canary), false, canary);
}

async function runCase(c, { name, authorize, state = 'IDLE', candidateExpected }) {
  const staticCheck = p => ({ status: 'PASS', evidence: { ...p.binding, findings: [], reason: '' } });
  const testRun = p => ({ status: 'PASS', evidence: { ...p.binding, assertionsExecuted: 1, assertionsPassed: 1, failures: [], reason: '' } });
  const host = createRepositoryWorkflowOwnerV1({ suite: c.suite,
    staticOwner: freezeOwner({ check: staticCheck, run: staticCheck, state }),
    testsOwner: freezeOwner({ check: testRun, run: testRun, state }) });
  const runOptions = fixedOptions(c); runOptions.authorizeContext = { authorize };
  const report = await host.run(runOptions);
  const settled = await host.settled();
  if (!candidateExpected) assert.equal(report.code, 'AUTHORIZE_CONTEXT_FAILED');
  const preview = host.historyPreview();
  assert.equal(preview.status, 'PREVIEW'); assert.equal(preview.reason, null);
  assert.equal(preview.preview.candidatePresent, candidateExpected);
  assert.equal(preview.preview.candidateFingerprint === null, !candidateExpected);
  assert.match(preview.sha256, /^[0-9a-f]{64}$/);
  assert.equal(preview.authorizing, false);
  assert.equal(settled.report, report);
  assert.equal(report.reportStored, false);
  const reportBeforeCapture = JSON.stringify(report), settledBeforeCapture = JSON.stringify(settled);
  const clock = () => 1100;
  const journal = openActualJournal(c, name);
  const declaration = { schemaVersion: 'nisi-repository-history-declaration/v1', declarationId: 'decl-' + name,
    projectId: journal.config.projectId, sourceDigest: preview.sha256, issuedAt: 1000, expiresAt: 2000,
    createdAt: 1000, retentionMs: 86400000, consentClass: 'WRITTEN_DECLARATION',
    destination: 'LOCAL_OBSERVATION_JOURNAL_ONLY', rawContentPersisted: false, networkEgress: false, learningInfluence: false };
  const captured = host.captureHistory({ owner: journal.owner, declaration, clock });
  assert.equal(captured.status, 'STORED'); assert.equal(captured.reason, null);
  assert.equal(captured.recordAttempted, true); assert.equal(captured.consumed, true);
  assert.equal(captured.authorizing, false); assert(captured.journal);
  assert.match(captured.sourceDigest, /^[0-9a-f]{64}$/); assert.match(captured.declarationDigest, /^[0-9a-f]{64}$/);
  assert.equal(captured.journal.status, 'RECORDED');
  assert.equal(captured.journal.store.status, 'WRITTEN'); assert.equal(captured.journal.store.verified, true);
  assert.equal(captured.journal.store.durable, true); assert.equal(captured.journal.store.committed, true);
  assert.deepEqual(captured.journal.store.fsync, { file: true, directory: true });
  assert.equal(captured.journal.snapshot.entries.length, 1);
  const row = captured.journal.snapshot.entries[0];
  assert.match(row.entry.id, /^rh1\.[0-9a-f]{64}$/);
  if (candidateExpected) assert.match(row.entry.candidateId, /^cand:[0-9a-f]{64}$/);
  else assert.equal(row.entry.candidateId, 'none:' + report.runId);
  assert.equal(row.entry.stage, 'REPOSITORY_SETTLEMENT');
  // Persistence preserves canonical data, not the caller's null-object prototype.
  assert.equal(stableStringify(row.entry.payload.preview), stableStringify(preview.preview));
  assert.equal(row.entry.payload.sourceDigest, preview.sha256); assert.equal(row.entry.payload.declarationDigest, captured.declarationDigest);
  assert.equal(row.authorizing, false);
  assert.equal(host.historyPreview().sha256, preview.sha256);
  const expectedDeclarationDigest = sha256Text('nisi/repository-history-declaration/v1\0' + stableStringify(declaration));
  const expectedEntryId = 'rh1.' + sha256Text('nisi/repository-history-id/v1\0' + preview.sha256);
  assert.equal(captured.declarationDigest, expectedDeclarationDigest); assert.equal(row.entry.id, expectedEntryId);
  assert.equal(row.entry.candidateId, candidateExpected ? 'cand:' + preview.preview.candidateFingerprint : 'none:' + report.runId);
  const diskBeforeRepeat = fs.readFileSync(journal.journalPath);
  const repeated = host.captureHistory({ owner: journal.owner, declaration, clock });
  assert.equal(repeated.reason, 'ALREADY_CAPTURED'); assert.equal(repeated.consumed, true);
  assert.deepEqual(fs.readFileSync(journal.journalPath), diskBeforeRepeat);
  assert.equal(diskBeforeRepeat.toString('utf8').includes('SYNTHETIC_PRIVATE_ERROR'), false);
  assert.equal(JSON.stringify(report), reportBeforeCapture); assert.equal(JSON.stringify(settled), settledBeforeCapture);
  const reopened = childReopen(journal.journalPath, journal.config, row.entry.id, preview.sha256, preview.preview, row.entry.candidateId, captured.declarationDigest);
  noLeak({ preview, capture: captured }, [journal.directory, journal.journalPath, c.parent, 'SYNTHETIC_PRIVATE_ERROR']);
  return { name, reportOutcome: report.outcome, reportCandidatePresent: report.candidate !== null,
    hostState: settled.state, previewStatus: preview.status, previewSha256: preview.sha256,
    captureStatus: captured.status, captureReason: captured.reason, consumed: captured.consumed,
    entryId: row.entry.id, declarationDigest: captured.declarationDigest, reopened, store: {
      status: captured.journal.store.status, committed: captured.journal.store.committed,
      durable: captured.journal.store.durable, fsync: captured.journal.store.fsync,
    }, authorizing: false };
}

const evidenceDirectory = fs.mkdtempSync(path.join(root, '.build/repository-host-history-verification-real-'));
const report = { schemaVersion: 1, status: 'INCOMPLETE', sourcePinsBefore, acceptanceName,
  scope: 'ACTUAL_REPOSITORY_WORKFLOW_OWNER_HISTORY_PREVIEW_CAPTURE', nativeLaunch: false,
  providerCalls: false, liveStore: false, authorizing: false, cases: [] };
let fixture;
try {
  fixture = await context({ after() {} });
  const refused = await runCase(fixture, { name: 'candidate-less', authorize: p => ({ status: 'FAIL',
    evidence: { ...p.binding, reason: 'SYNTHETIC_PRIVATE_ERROR' } }), candidateExpected: false });
  report.cases.push(refused);
  const quarantined = await runCase(fixture, { name: 'candidate-present-quarantined',
    authorize: p => ({ status: 'PASS', evidence: { ...p.binding, reason: '' } }), state: 'QUARANTINED', candidateExpected: true });
  report.cases.push(quarantined);
  report.status = 'PASS_REAL_HOST_HISTORY';
} catch (error) {
  report.status = 'FAIL'; report.failureCode = typeof error?.code === 'string' ? error.code : 'VERIFICATION_FAILED';
  report.failureMessage = typeof error?.message === 'string' ? error.message : 'verification assertion failed';
} finally {
  const sourcePinsAfter = Object.fromEntries(pinNames.map(name => [name,
    hash(fs.readFileSync(path.join(root, name)))]));
  report.sourcePinsAfter = sourcePinsAfter;
  report.sourcePinsUnchanged = pinNames.every(name => sourcePinsAfter[name] === acceptance.after[name]);
  if (!report.sourcePinsUnchanged && report.status === 'PASS_REAL_HOST_HISTORY') {
    report.status = 'FAIL'; report.failureCode = 'SOURCE_PINS_CHANGED';
    report.failureMessage = 'source pins changed during verification';
  }
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidenceDirectory, 'verification.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, evidence: evidenceDirectory, cases: report.cases,
    sourcePinsUnchanged: report.sourcePinsUnchanged, authorizing: false, failureCode: report.failureCode ?? null }));
  if (report.status !== 'PASS_REAL_HOST_HISTORY') process.exitCode = 1;
}
