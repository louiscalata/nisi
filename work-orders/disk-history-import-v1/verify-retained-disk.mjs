// Three specifically selected, already-retained engineering records. No native launch.
// Writes only a new owned private evidence directory and its observation journal.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {openJournalOwner} from '../../history/journal-owner-v2.mjs';
import {importFixedXpcHistoryFromDisk} from '../../hosts/history/import-fixed-xpc-from-disk-v1.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const records = [
  {folder: 'fixed-private-xpc-K75OFq', sourceSha256: '9a886498d7350beb977c3c53b8b164277bc7fe1291fe27b2b9c744417bc78ea5',
    bytes: 14704, runId: '7765f8c48716e7bba4877c2eedceb46f', createdAt: 1789283408280, caseName: 'malformed-request'},
  {folder: 'fixed-private-xpc-lC04p1', sourceSha256: '31d7f13e69af1f506efe151388ba9b44e309d51a1d5d79f42f8ba3f89ad52e1b',
    bytes: 14688, runId: '0fd7ea3c745c5b91b9a47b6593716c79', createdAt: 1789283414155, caseName: 'no-reply'},
  {folder: 'fixed-private-xpc-eMTZbH', sourceSha256: '9456043a973c26ed55fbe00bf4482e6e255167a5e2773d1a9c2bf0d8bc76dec1',
    bytes: 18005, runId: 'f666fd6b57f67782e7855d9ce551910f', createdAt: 1789283399752, caseName: 'valid'}
];
const prior = JSON.parse(fs.readFileSync(path.join(root, '.build/history-capture-verification-LWb99c/verification.json')));
assert.equal(prior.status, 'PASS_SCOPED');
assert.equal(Object.keys(prior.after).length, 234);
const sourceNames = [...Object.keys(prior.after), 'hosts/history/import-fixed-xpc-from-disk-v1.mjs',
  'tests/disk-history-import-v1.test.mjs', 'tests/disk-history-import-boundaries.test.mjs'];
const pins = Object.fromEntries(sourceNames.map(name => [name, sha(fs.readFileSync(path.join(root, name)))]));
for (const [name, expected] of Object.entries(prior.after)) assert.equal(pins[name], expected, name);
assert.equal(pins['hosts/history/import-fixed-xpc-from-disk-v1.mjs'],
  'e0982d129bf635b33ce53b46d1155b7c0182b9f7875053f540071dfffa4070cd');

function checkInputs() {
  for (const record of records) {
    const file = path.join(root, '.build', record.folder, 'terminal.json');
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      assert.ok(stat.isFile()); assert.equal(stat.nlink, 1); assert.equal(stat.size, record.bytes);
      const bytes = fs.readFileSync(fd); assert.equal(sha(bytes), record.sourceSha256);
    } finally { fs.closeSync(fd); }
  }
  for (const [name, expected] of Object.entries(pins)) assert.equal(sha(fs.readFileSync(path.join(root, name))), expected, name);
}
checkInputs();
const evidence = fs.mkdtempSync(path.join(root, '.build/disk-history-retained-'));
const target = path.join(evidence, 'observations.jsonl');
const config = {projectId: 'nisi-private', maxEntries: 8, heartbeatTtlMs: 1000, redactPaths: []};
const now = Date.now();
const report = {schemaVersion: 1, status: 'INCOMPLETE', evidence, inputKind: 'THREE_RETAINED_FIXED_XPC_RECORDS',
  authorizing: false, nativeExecutionPerformed: false, consentAuthenticityAttested: false,
  sourceAuthenticityAttested: false, declaredBy: 'ENGINEERING_TEST_HOST', sourcePins: pins, rows: []};
try {
  const opened = openJournalOwner({path: target, fs, config, now});
  assert.equal(opened.status, 'OPENED'); assert.equal(opened.snapshot.recovery.status, 'NEW');
  for (const record of records) {
    const declaration = {schemaVersion: 'nisi-fixed-xpc-history-declaration/v1',
      declarationId: 'retained-disk-' + record.caseName, projectId: config.projectId,
      candidateId: 'fixed-probe', receiptId: record.runId, consentClass: 'WRITTEN_DECLARATION',
      sourceSha256: record.sourceSha256, issuedAt: now, expiresAt: now + 60000,
      createdAt: record.createdAt, retentionMs: 86400000, destination: 'LOCAL_OBSERVATION_JOURNAL_ONLY',
      rawContentPersisted: false, networkEgress: false, learningInfluence: false};
    const source = {schemaVersion: 'nisi-history-source-selection/v1', consentClass: 'WRITTEN_DECLARATION',
      root: path.join(root, '.build', record.folder), relativePath: 'terminal.json',
      profile: 'operator-trusted-static-local-v1', rawContentPersisted: false, networkEgress: false};
    // The product wrapper performs the actual capture read. No serialized input shortcut.
    const result = await importFixedXpcHistoryFromDisk({owner: opened.owner, declaration, source, clock: Date.now, signal: null});
    report.rows.push({caseName: record.caseName, sourceSha256: record.sourceSha256,
      entryId: record.runId + ':0:fixed-xpc', sourceSelectionDigest: result.sourceSelectionDigest,
      declarationDigest: result.declarationDigest, result});
    assert.equal(result.status, 'IMPORTED'); assert.equal(result.sourceReadAttempted, true);
    assert.equal(result.captureAttempted, true); assert.equal(result.sourceFailure, null);
    assert.equal(result.sourceEvidence.sourceSha256, record.sourceSha256);
    assert.equal(result.sourceEvidence.sourceBytes, record.bytes); assert.equal(result.sourceEvidence.handlesClosed, true);
    assert.equal(result.sourceEvidence.atomicSnapshot, false); assert.equal(result.authorizing, false);
    assert.match(result.sourceSelectionDigest, /^[0-9a-f]{64}$/);
    assert.match(result.declarationDigest, /^[0-9a-f]{64}$/);
    const store = result.capture.journal.store;
    assert.equal(store.status, 'WRITTEN'); assert.equal(store.verified, true); assert.equal(store.committed, true);
    assert.deepEqual(store.fsync, {file: true, directory: true});
    const output = JSON.stringify(result);
    assert.equal(output.includes(source.root), false); assert.equal(output.includes('terminal.json'), false);
  }
  const expected = report.rows.map(row => ({id: row.entryId, sourceSha256: row.sourceSha256, declarationDigest: row.declarationDigest}));
  const moduleUrl = pathToFileURL(path.join(root, 'history/journal-owner-v2.mjs')).href;
  const childCode = `import fs from 'node:fs'; import assert from 'node:assert/strict';
    import {openJournalOwner} from ${JSON.stringify(moduleUrl)};
    const input=JSON.parse(process.argv[1]);
    const r=openJournalOwner({path:input.path,fs,config:input.config,now:Date.now()});
    assert.equal(r.status,'OPENED'); assert.equal(r.snapshot.recovery.status,'COMPLETE');
    assert.equal(r.snapshot.entries.length,3);
    assert.deepEqual([...r.snapshot.recovery.recoveredIds].sort(),input.expected.map(e=>e.id).sort());
    const rows=r.snapshot.entries.map(row=>{
      assert.equal(row.authorizing,false); assert.equal(row.historical,true); assert.equal(row.retained,true);
      const e=row.entry, expected=input.expected.find(v=>v.id===e.id); assert.ok(expected);
      assert.equal(e.payload.recordDigest,expected.sourceSha256);
      const h=e.payload.historyCapture;
      assert.equal(h.declarationDigest,expected.declarationDigest);
      assert.equal(h.consentAuthenticityAttested,false); assert.equal(h.sourceAuthenticityAttested,false);
      assert.equal(h.executionAttested,false); assert.equal(e.payload.sourceManifestVerified,false);
      assert.equal(e.payload.nativeProductAccepted,false);
      return {id:e.id,sourceSha256:e.payload.recordDigest,declarationDigest:h.declarationDigest,authorizing:false};
    });
    console.log(JSON.stringify({status:'REOPENED_EXACTLY',rows,authorizing:false}));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childCode,
    JSON.stringify({path: target, config, expected})], {cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 1048576});
  report.child = {status: child.status, signal: child.signal, errorCode: child.error?.code ?? null};
  assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
  report.reopen = JSON.parse(child.stdout);
  const stored = fs.readFileSync(target, 'utf8');
  assert.equal(stored.includes('terminal.json'), false);
  for (const record of records) assert.equal(stored.includes(record.folder), false);
  report.file = {sha256: sha(stored), bytes: fs.statSync(target).size};
  checkInputs(); report.originalInputsUnchanged = true; report.sourcePinsUnchanged = true;
  report.status = 'PASS_RETAINED_DISK_TO_REAL_STORE';
} catch (error) {
  report.status = 'FAIL'; report.failure = String(error.message); process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({status: report.status, evidence, importedRows: report.rows.length,
    reopen: report.reopen ?? null, failure: report.failure ?? null}));
}
