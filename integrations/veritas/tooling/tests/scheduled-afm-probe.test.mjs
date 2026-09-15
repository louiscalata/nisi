import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateAFMProbeEvidence, runScheduledAFMProbe} from '../neural/scheduled-afm-probe.mjs';
import {syntheticAFMEvidence, syntheticDigest} from './fixtures/synthetic-afm-evidence.mjs';
const bytes = v => Buffer.from(JSON.stringify(v)+'\n');
const valid = () => bytes(syntheticAFMEvidence());
const sha = v => createHash('sha256').update(v).digest('hex');

test('closed reader accepts authored fixture without treating it as live inference', () => {
  assert.equal(validateAFMProbeEvidence(valid()).status,'PASS');
});
for (const [name, mutate] of [
  ['unknown root',v => {v.extra = true;}], ['schema',v => {v.schemaVersion = 2;}],
  ['status',v => {v.status = 'CERTIFIED';}], ['wrong input',v => {v.subjectDigest = 'a'.repeat(64);}],
  ['wrong profile',v => {v.profileFingerprint = 'a'.repeat(64);}], ['false completion',v => {v.quiescent = false;}],
  ['no participation',v => {v.modelParticipation = 'NOT_RUN';}], ['not ready',v => {v.disposition = 'FAILED';}],
  ['failed gate',v => {v.deterministicPassed = false;}], ['missing warning',v => {v.limitationCodes.pop();}],
  ['authority',v => {v.acceptanceAuthorityGranted = true;}], ['tools',v => {v.externalToolsEnabled = true;}],
  ['transcript',v => {v.transcriptPersisted = true;}], ['raw text',v => {v.rawArtifactPersisted = true;}],
  ['missing check',v => {v.deterministicChecks.pop();}], ['check fail',v => {v.deterministicChecks[0].status = 'FAIL';}],
  ['check meaning',v => {v.deterministicChecks[0].explanation = 'Certified';}],
  ['check extra',v => {v.deterministicChecks[0].extra = true;}],
  ['provider',v => {v.advisoryReceipt.provider = 'other';}],
  ['receipt permission',v => {v.advisoryReceipt.nonAuthorizing = false;}],
  ['receipt extra',v => {v.advisoryReceipt.extra = true;}],
  ['receipt cause',v => {v.advisoryReceipt.reasonCode = 'UNKNOWN';}],
  ['missing stage',v => {v.advisoryReceipt.stages.pop();}],
  ['duplicate stage',v => {v.advisoryReceipt.stages[1] = v.advisoryReceipt.stages[0];}],
  ['stage request',v => {v.advisoryReceipt.stages[1].requestDigest = 'b'.repeat(64);}],
  ['stage response',v => {v.advisoryReceipt.stages[1].responseDigest = null;}],
  ['stage authority',v => {v.advisoryReceipt.stages[1].authorizing = true;}],
  ['bad receipt digest',v => {v.advisoryReceiptDigest = '0'.repeat(64);}]
]) test('closed reader refuses '+name+' even with a freshly recomputed receipt digest', () => {
  const v = syntheticAFMEvidence(); mutate(v);
  if (name !== 'bad receipt digest') v.advisoryReceiptDigest = syntheticDigest(v.advisoryReceipt);
  assert.throws(() => validateAFMProbeEvidence(bytes(v)));
});
test('reader rejects missing top-level keys, duplicate keys, invalid bytes and concatenated output', () => {
  for (const key of Object.keys(syntheticAFMEvidence())) {
    const value = syntheticAFMEvidence(); delete value[key]; assert.throws(() => validateAFMProbeEvidence(bytes(value)));
  }
  for (const raw of [Buffer.alloc(0),Buffer.alloc(16385),Buffer.from('{"status":"FAIL","status":"PASS"}\n'),
    Buffer.concat([valid(),valid()]),valid().subarray(0,-1),Buffer.from([255,10]),'text']) {
    assert.throws(() => validateAFMProbeEvidence(raw));
  }
});
test('runner refuses unknown options and accessors without executing them', async () => {
  let called = false;
  await assert.rejects(runScheduledAFMProbe({get binary(){called = true; return '/tmp/no';}}),/ARGUMENTS/);
  assert.equal(called,false);
  await assert.rejects(runScheduledAFMProbe({executor:() => {called = true;}}),/ARGUMENTS/);
  assert.equal(called,false);
});

// Real subprocess lifecycle tests, but the executable is a compiled C fixture,
// NEVER Apple Foundation Models. Every retained temporary directory is private.
const supported = process.platform === 'darwin' && process.arch === 'arm64';
let fixtureRoot, executable, sequence = 0;
function fixture(mode = 'normal', payload = valid()) {
  if (!fixtureRoot) {
    fixtureRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'veritas-afm-synthetic-'));
    fs.chmodSync(fixtureRoot,0o700); executable = path.join(fixtureRoot,'fixture');
    const result = spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror',fileURLToPath(new URL('./fixtures/afm-probe-process.c',import.meta.url)),'-o',executable],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
  }
  const directory = path.join(fixtureRoot,String(sequence++)); fs.mkdirSync(directory,0o700);
  const binary = path.join(directory,'probe'); fs.copyFileSync(executable,binary,fs.constants.COPYFILE_EXCL); fs.chmodSync(binary,0o700);
  fs.writeFileSync(path.join(directory,'mode'),mode,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(directory,'payload.json'),payload,{flag:'wx',mode:0o600});
  return {directory,binary,binarySHA256:sha(fs.readFileSync(binary)),timeoutMs:5000};
}
const options = f => ({binary:f.binary,binarySHA256:f.binarySHA256,timeoutMs:f.timeoutMs});
const freshRunner = async () => (await import('../neural/scheduled-afm-probe.mjs?fixture='+sequence++)).runScheduledAFMProbe;
async function started(f) {
  const until = Date.now()+3000;
  while (!fs.existsSync(path.join(f.directory,'started'))) {
    assert(Date.now()<until,'fixture never started'); await new Promise(resolve => setTimeout(resolve,5));
  }
}
const stopped = r => {
  assert.equal(r.scheduler.stopped,true); assert.equal(r.scheduler.schedulerStopConfirmed,true);
  assert.equal(r.scheduler.scheduler.state,'OFF'); assert.equal(r.authorizing,false); assert.equal(r.globalGovernor,false);
};

test('real scheduler claims before compiled fixture starts and waits for exit before returning', {skip:!supported}, async () => {
  const run = await freshRunner(), f = fixture('wait'); let delivered = false;
  const pending = run(options(f)).then(r => {delivered = true; return r;});
  await started(f); assert.equal(delivered,false);
  fs.writeFileSync(path.join(f.directory,'release'),'release',{flag:'wx'});
  const result = await pending; stopped(result);
  assert.equal(result.status,'PASS_PRIVATE_SCHEDULED_AFM_REPORTED_COMPLETION_ONLY');
  assert.deepEqual(result.events.map(e => e.event),['BINARY_VERIFIED','SLOT_CLAIMED','CHILD_STARTED','CHILD_REAPED','EVIDENCE_VALIDATED']);
  assert.equal(result.slot.slot.slotClaimed,true); assert.equal(result.scheduler.chargedLifetimeSlots,1);
  assert.equal(result.childReaped,true); assert.equal(result.terminal.code,0);
  assert.equal(result.modelParticipation,'REPORTED_PARTICIPATED'); assert.equal(result.modelIdentityAttested,false);
  assert.equal(result.binaryIdentityScope,'PATHNAME_OBSERVATION_ONLY'); assert.equal(result.executedImageSHA256,null);
  assert.equal(Object.hasOwn(result,'binarySHA256'),false);
  const {resultSHA256,...body} = result;
  assert.equal(resultSHA256,sha(Buffer.concat([Buffer.from('veritas/scheduled-afm-observation/v1\0'),Buffer.from(
    JSON.stringify(body,function(_key,value){return value && !Array.isArray(value) && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) : value;}))])));
  assert.throws(() => {result.receipt.advisoryReceipt.stages[0].outcome = 'CERTIFIED';},TypeError);
  assert.throws(() => {result.events.push({event:'invented'});},TypeError);
});
test('same module cannot launch a second child while the first is alive', {skip:!supported}, async () => {
  const run = await freshRunner(), f = fixture('wait'), other = fixture();
  const pending = run(options(f)); await started(f);
  const denied = await run(options(other)); assert.equal(denied.reason,'MODULE_BUSY');
  assert.equal(fs.existsSync(path.join(other.directory,'started')),false);
  fs.writeFileSync(path.join(f.directory,'release'),'release',{flag:'wx'}); stopped(await pending);
});
for (const [mode,expected] of [['hang','DEADLINE'],['late','DEADLINE'],['stderr','UNEXPECTED_STDERR'],
  ['overflow','OUTPUT_LIMIT'],['nonzero','NATIVE_NOT_COMPLETED'],['tamper','BINARY_CHANGED']]) {
  test('compiled '+mode+' fixture refuses and fences unknown service completion', {skip:!supported}, async () => {
    const run = await freshRunner(), f = fixture(mode);
    if (mode === 'hang' || mode === 'late') f.timeoutMs = 300;
    const result = await run(options(f)); stopped(result);
    assert.equal(result.reason,expected); assert.equal(result.receipt,null); assert.equal(result.childReaped,true);
    assert.equal(result.modelServiceQuiescence,'UNKNOWN'); assert.equal(result.modelServiceCompletionFence,true);
    const other = fixture(); const refused = await run(options(other));
    assert.equal(refused.reason,'MODEL_SERVICE_COMPLETION_UNKNOWN');
    assert.equal(fs.existsSync(path.join(other.directory,'started')),false);
  });
}
test('canceling a confirmed live child waits for reap and withholds output', {skip:!supported}, async () => {
  const run = await freshRunner(), f = fixture('wait'), controller = new AbortController();
  const pending = run({...options(f),signal:controller.signal}); await started(f); controller.abort();
  const result = await pending; stopped(result);
  assert.equal(result.reason,'ABORTED'); assert.equal(result.terminal.signal,'SIGKILL');
  assert.equal(result.receipt,null); assert.equal(result.childReaped,true); assert.equal(result.modelServiceQuiescence,'UNKNOWN');
});
test('pre-cancel and changed binary cannot claim capacity or launch', {skip:!supported}, async () => {
  const run = await freshRunner(), f = fixture(), controller = new AbortController(); controller.abort();
  assert.equal((await run({...options(f),signal:controller.signal})).reason,'ABORTED');
  const result = await run({...options(f),binarySHA256:'0'.repeat(64)});
  assert.equal(result.reason,'BINARY_DIGEST'); assert.equal(result.childStarted,false); assert.equal(result.scheduler,null);
  assert.equal(fs.existsSync(path.join(f.directory,'started')),false);
});
test('a symlink cannot be used as the reviewed executable', {skip:!supported}, async () => {
  const run = await freshRunner(), f = fixture(), link = path.join(f.directory,'link'); fs.symlinkSync(f.binary,link);
  assert.equal((await run({...options(f),binary:link})).childStarted,false);
  assert.equal(fs.existsSync(path.join(f.directory,'started')),false);
});
for (const [label,payload] of [['missing newline',valid().subarray(0,-1)],['trailing record',Buffer.concat([valid(),valid()])],
  ['invalid UTF8',Buffer.from([255,10])],['plain PASS',Buffer.from('PASS\n')],['empty',Buffer.alloc(0)]]) {
  test('compiled fixture '+label+' cannot masquerade as completed AFM work', {skip:!supported}, async () => {
    const run = await freshRunner(), result = await run(options(fixture('normal',payload))); stopped(result);
    assert.equal(result.status,'REFUSED'); assert.equal(result.receipt,null); assert.equal(result.modelServiceQuiescence,'UNKNOWN');
  });
}
