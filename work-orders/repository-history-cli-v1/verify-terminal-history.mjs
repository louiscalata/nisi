// Bounded PTY proof for the operator-facing repository history review.
// Run this file from an actual TTY; the answer is supplied by the operator.
// No provider, Swift, network, model, or live-history process is launched.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRepositoryWorkflowOwnerV1} from '../../hosts/repository/reviewed-workflow-v1.mjs';
import {reviewRepositoryHistoryV1} from '../../hosts/history/review-repository-history-v1.mjs';
import {promptRepositoryHistoryV1} from '../../hosts/history/terminal-history-prompt-v1.mjs';
import {openJournalOwner} from '../../history/journal-owner-v2.mjs';
import {context} from '../../tests/helpers/node-repository-fixture.mjs';
import {fixedOptions} from '../../tests/helpers/repository-run-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const expectedMode = args[0];
const pinPath = args[1];
assert.ok(expectedMode === 'approve' || expectedMode === 'decline', 'usage: verify-terminal-history.mjs approve|decline /absolute/pin-receipt.json');
assert.ok(typeof pinPath === 'string' && path.isAbsolute(pinPath), 'pin receipt must be an absolute path');
const pinBefore = fs.readFileSync(pinPath);
const pinHashBefore = crypto.createHash('sha256').update(pinBefore).digest('hex');
const acceptance = JSON.parse(pinBefore);
assert.equal(acceptance.status,'PASS_SCOPED'); assert.equal(acceptance.checkedFiles,252);
const pinNames=Object.keys(acceptance.after);
assert.equal(pinNames.length,252); assert.deepEqual(acceptance.before,acceptance.after);
function actualPins() {
  return Object.fromEntries(pinNames.map(name=>{
    const p=path.resolve(root,name); assert.ok(p.startsWith(root+path.sep));
    return [name,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')];
  }));
}
const sourcePinsBefore=actualPins(); assert.deepEqual(sourcePinsBefore,acceptance.after);
const cleanups = [];
const testContext = {after(fn) { cleanups.push(fn); }};
const c = await context(testContext);
const buildRoot = await fsp.mkdtemp(path.join(root, '.build/repository-history-cli-v1-pty-'));
const runDirectory = path.join(buildRoot, 'run');
await fsp.mkdir(runDirectory, {recursive: true, mode: 0o700});

const staticOwner = {
  registrationFingerprint: 'a'.repeat(64),
  check: async p => ({status: 'PASS', evidence: {...p.binding, findings: [], reason: ''}}),
  settled: async () => [], observations: () => [], status: () => 'IDLE', lateObservations: () => [],
};
const testsOwner = {
  registrationFingerprint: 'b'.repeat(64),
  run: async p => ({status: 'PASS', evidence: {...p.binding, assertionsExecuted: 1, assertionsPassed: 1, failures: [], reason: ''}}),
  settled: async () => [], observations: () => [], status: () => 'IDLE', lateObservations: () => [],
};
const host = createRepositoryWorkflowOwnerV1({suite: c.suite, staticOwner, testsOwner});
const options = fixedOptions(c);
const report = await host.run(options);
const settled = await host.settled();
assert.equal(settled.report, report, 'host settlement must retain the original report identity');
const preview = host.historyPreview();
assert.equal(preview.status, 'PREVIEW', `expected settled preview, got ${preview.status}:${preview.reason}`);
assert.equal(host.status(), settled.state, 'history review must observe the already settled host');

const clock = () => Date.now();
const openOwner = request => openJournalOwner({path: request.path, fs, config: request.config, now: request.now});
const review = await reviewRepositoryHistoryV1({host, runDirectory, clock,
  prompt: request => promptRepositoryHistoryV1({...request, input: process.stdin, output: process.stdout}),
  openOwner, signal: null, promptTimeoutMs: 30000});
assert.equal(review.authorizing, false);
assert.equal(process.stdin.readableFlowing,false,'adapter-owned input is released without process.exit');
let reopened=null;
if (expectedMode === 'approve') {
  assert.equal(review.status, 'STORED', `approval PTY answer did not store: ${JSON.stringify(review)}`);
  assert.equal(review.capture?.status, 'STORED');
  assert.equal(review.capture?.consumed, true);
  assert.equal(review.capture?.recordAttempted, true);
  const journal = review.capture.journal;
  assert.ok(journal && journal.status === 'RECORDED');
  assert.equal(journal.store.status,'WRITTEN'); assert.equal(journal.store.verified,true);
  assert.equal(journal.store.committed,true); assert.equal(journal.store.durable,true);
  assert.deepEqual(journal.store.fsync,{file:true,directory:true});
  const entry = journal.snapshot.entries[0].entry;
  assert.equal(journal.snapshot.entries.length, 1);
  assert.equal(entry.id, `rh1.${review.sourceDigest && crypto.createHash('sha256').update('nisi/repository-history-id/v1\0' + review.sourceDigest).digest('hex')}`);
  assert.equal(entry.payload.sourceDigest, review.sourceDigest);
  assert.equal(entry.payload.declarationDigest, review.capture.declarationDigest);
  const journalPath = path.join(runDirectory, 'history-journal.jsonl');
  assert.equal(fs.existsSync(journalPath), true);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import {openJournalOwner} from ${JSON.stringify(pathToFileURL(path.join(root, 'history/journal-owner-v2.mjs')).href)};
    const result = openJournalOwner({path:${JSON.stringify(journalPath)},fs,config:${JSON.stringify({projectId:entry.projectId,maxEntries:32,heartbeatTtlMs:30000,redactPaths:[]})},now:Date.now()});
    if (result.status !== 'OPENED' || result.snapshot.entries.length !== 1 || result.snapshot.entries[0].entry.id !== ${JSON.stringify(entry.id)} || result.snapshot.entries[0].entry.payload.sourceDigest !== ${JSON.stringify(review.sourceDigest)} || result.snapshot.entries[0].entry.payload.declarationDigest !== ${JSON.stringify(review.capture.declarationDigest)}) process.exit(7);
    console.log(JSON.stringify({status:'REOPENED',id:result.snapshot.entries[0].entry.id,sourceDigest:result.snapshot.entries[0].entry.payload.sourceDigest,declarationDigest:result.snapshot.entries[0].entry.payload.declarationDigest}));
  `], {cwd: root, encoding: 'utf8', timeout: 15000});
  assert.equal(child.error,undefined); assert.equal(child.signal,null);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  reopened=JSON.parse(child.stdout);
} else {
  assert.equal(review.status, 'NOT_STORED', `decline PTY answer unexpectedly stored: ${JSON.stringify(review)}`);
  assert.equal(review.reason, 'DECLINED');
  assert.equal(review.ownerOpenAttempted, false);
  assert.equal(review.captureCallAttempted, false);
  assert.equal(review.capture, null);
  assert.equal(fs.existsSync(path.join(runDirectory, 'history-journal.jsonl')), false);
}
const pinAfter = fs.readFileSync(pinPath);
assert.equal(crypto.createHash('sha256').update(pinAfter).digest('hex'), pinHashBefore, 'source-pin receipt changed during PTY proof');
const sourcePinsAfter=actualPins(); assert.deepEqual(sourcePinsAfter,sourcePinsBefore);
assert.equal((await host.settled()),settled); assert.equal(settled.report,report);
const verification = {schemaVersion: 'nisi-repository-history-cli-pty-verification/v1',status:'PASS_PTY_SCOPED', mode: expectedMode,
  sourcePinsBefore,sourcePinsAfter,reopened,stdinReleased:process.stdin.readableFlowing===false,
  runDirectory, previewDigest: preview.sha256, review, historyJournalPresent: fs.existsSync(path.join(runDirectory, 'history-journal.jsonl')),
  sourcePin: {path: pinPath, sha256: pinHashBefore, bytes: pinBefore.length}, providerCalls: false, swiftLaunch: false,
  networkCalls: false, modelCalls: false};
const verificationPath = path.join(buildRoot, 'verification.json');
await fsp.writeFile(verificationPath, JSON.stringify(verification, null, 2) + '\n', {flag: 'wx', mode: 0o600});
for (const cleanup of cleanups.reverse()) await cleanup();
console.log(JSON.stringify({status: 'PASS', mode: expectedMode, verificationPath, previewDigest: preview.sha256}, null, 2));
