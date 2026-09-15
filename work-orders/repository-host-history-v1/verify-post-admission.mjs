// Focused regression for exceptional results after journal admission. This uses
// a relocated helper plus a test-only journal dependency substitute; it adds no
// production injection seam and never touches a real journal file.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceName = 'history/repository-host-history-v1.mjs';
const sourcePath = path.join(root, sourceName);
const source = fs.readFileSync(sourcePath, 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
const expectedHash = process.argv[2] ?? 'e72b514e73ac3059a759b21c71341450e1e99d353352843b7e3ef4d13ea779c8';
assert.match(expectedHash, /^[0-9a-f]{64}$/); assert.equal(sha(source), expectedHash);
const evidence = fs.mkdtempSync(path.join(root, '.build/repository-host-history-post-admission-'));
const fakePath = path.join(evidence, 'journal-substitute.mjs');
const helperPath = path.join(evidence, 'repository-host-history-v1.mjs');
const testPath = path.join(evidence, 'post-admission.test.mjs');
const canonicalOwner = pathToFileURL(path.join(root, 'history/journal-owner-v2.mjs')).href;

fs.writeFileSync(fakePath, `
import {inspectJournalOwner as inspect} from ${JSON.stringify(canonicalOwner)};
export const inspectJournalOwner = inspect;
export function recordJournalObservation() {
  const calls=Symbol.for('nisi.repository.history.post-admission.calls');
  globalThis[calls]=(globalThis[calls]??0)+1;
  const mode=globalThis[Symbol.for('nisi.repository.history.post-admission')];
  if (mode === 'throw')
    throw new Error('PRIVATE_POST_ADMISSION_THROW');
  if (mode === 'null') return null;
  if (mode === 'missing-snapshot') return Object.freeze({status:'STORE_FAILED',reason:'SYNTHETIC',authorizing:false});
  if (mode === 'missing-state') return Object.freeze({status:'STORE_FAILED',reason:'SYNTHETIC',snapshot:Object.freeze({}),authorizing:false});
  return Object.freeze({status:'UNRECOGNIZED_RESULT', reason:null,
    snapshot:Object.freeze({state:'OPEN'}), authorizing:false});
}
`, {flag: 'wx'});

function relocate(text) {
  return text.replace(/from '([^']+)'/g, (whole, specifier) => {
    if (!specifier.startsWith('.')) return whole;
    const resolved = path.resolve(path.dirname(sourcePath), specifier);
    const target = resolved === path.join(root, 'history/journal-owner-v2.mjs') ? fakePath : resolved;
    return "from '" + pathToFileURL(target).href + "'";
  });
}
fs.writeFileSync(helperPath, relocate(source), {flag: 'wx'});

const code = `
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepositoryHistoryAccessV1} from ${JSON.stringify(pathToFileURL(helperPath).href)};
import {createRepositoryWorkflowOwnerV1} from ${JSON.stringify(pathToFileURL(path.join(root, 'hosts/repository/reviewed-workflow-v1.mjs')).href)};
import {openJournalOwner} from ${JSON.stringify(canonicalOwner)};
import {context} from ${JSON.stringify(pathToFileURL(path.join(root, 'tests/helpers/node-repository-fixture.mjs')).href)};
import {fixedOptions} from ${JSON.stringify(pathToFileURL(path.join(root, 'tests/helpers/repository-run-fixture.mjs')).href)};
import {memfs} from ${JSON.stringify(pathToFileURL(path.join(root, 'tests/journal-owner-v2.memfs.mjs')).href)};
import {CONFIG,PATH} from ${JSON.stringify(pathToFileURL(path.join(root, 'tests/journal-owner-v2.helper.mjs')).href)};

const stub=(key,fn)=>({[key]:fn,registrationFingerprint:'a'.repeat(64),settled:async()=>[],observations:()=>[],status:()=>'IDLE',lateObservations:()=>[]});
const stat=p=>({status:'PASS',evidence:{...p.binding,findings:[],reason:''}});
const node=p=>({status:'PASS',evidence:{...p.binding,assertionsExecuted:1,assertionsPassed:1,failures:[],reason:''}});
async function fixture(t) {
  const c=await context(t);
  const host=createRepositoryWorkflowOwnerV1({suite:c.suite,staticOwner:stub('check',stat),testsOwner:stub('run',node)});
  await host.run(fixedOptions(c)); const collected=await host.settled();
  const access=createRepositoryHistoryAccessV1({taskFingerprint:c.preparations[0].taskFingerprint,baselineFingerprint:c.preparations[0].baselineFingerprint});
  access.publish(collected); const preview=access.preview(); assert.equal(preview.status,'PREVIEW');
  const m=memfs(), config={...CONFIG,redactPaths:[]};
  const opened=openJournalOwner({path:PATH,fs:m.fs,config,now:100}); assert.equal(opened.status,'OPENED');
  const declaration={schemaVersion:'nisi-repository-history-declaration/v1',declarationId:'post-admission-a',projectId:'project-a',sourceDigest:preview.sha256,
    issuedAt:100,expiresAt:1000,createdAt:100,retentionMs:1000,consentClass:'WRITTEN_DECLARATION',destination:'LOCAL_OBSERVATION_JOURNAL_ONLY',
    rawContentPersisted:false,networkEgress:false,learningInfluence:false};
  return {access,owner:opened.owner,declaration};
}
for (const mode of ['throw','null','unknown-result','missing-snapshot','missing-state']) test('post-admission '+mode+' is uncertain and remains consumed', async t => {
  const f=await fixture(t); globalThis[Symbol.for('nisi.repository.history.post-admission')]=mode;
  globalThis[Symbol.for('nisi.repository.history.post-admission.calls')]=0;
  const result=f.access.capture({owner:f.owner,declaration:f.declaration,clock:()=>100});
  assert.equal(result.status,'UNCERTAIN'); assert.equal(result.reason,'INTERNAL_ERROR');
  assert.equal(result.recordAttempted,true); assert.equal(result.consumed,true);
  assert.equal(result.journal,null); assert.equal(result.authorizing,false);
  const retry=f.access.capture({owner:f.owner,declaration:f.declaration,clock:()=>100});
  assert.equal(retry.status,'REFUSED'); assert.equal(retry.reason,'ALREADY_CAPTURED');
  assert.equal(globalThis[Symbol.for('nisi.repository.history.post-admission.calls')],1);
  assert.equal(JSON.stringify(result).includes('PRIVATE_POST_ADMISSION_THROW'),false);
});
`;
fs.writeFileSync(testPath, code, {flag: 'wx'});

const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', testPath],
  {cwd: root, encoding: 'utf8', timeout: 20_000, maxBuffer: 4_194_304});
fs.writeFileSync(path.join(evidence, 'stdout.txt'), child.stdout ?? '', {flag: 'wx'});
fs.writeFileSync(path.join(evidence, 'stderr.txt'), child.stderr ?? '', {flag: 'wx'});
assert.equal(child.error, undefined); assert.equal(child.signal, null);
const summary = {schemaVersion:1, sourceName, sourceSha256:sha(source), evidence,
  exitCode:child.status, expectedStatus:'UNCERTAIN', authorizing:false};
summary.counts = Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(key => {
  const matches = [...child.stdout.matchAll(new RegExp('^# ' + key + ' (\\d+)$', 'gm'))];
  assert.equal(matches.length, 1); return [key, Number(matches[0][1])];
}));
assert.equal(summary.counts.tests, 5);
assert.equal(summary.counts.cancelled + summary.counts.skipped + summary.counts.todo, 0);
summary.failureCodes = [...child.stdout.matchAll(/^\s+code: '([^']+)'$/gm)].map(match => match[1]);
assert.equal(summary.failureCodes.length, summary.counts.fail);
summary.sourceUnchanged = sha(fs.readFileSync(sourcePath)) === expectedHash;
assert.equal(summary.sourceUnchanged, true);
fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(summary, null, 2) + '\n', {flag:'wx'});
if (child.status !== 0) process.exitCode = 1;
console.log(JSON.stringify(summary));
