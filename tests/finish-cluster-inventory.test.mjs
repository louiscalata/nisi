import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
// Keep C06 adverse evidence controls in the existing graded inventory suite.
import './finish-cluster-c06.test.mjs';
import './finish-cluster-c07.test.mjs';
import './finish-cluster-history.test.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = 'work-orders/v02-finish-cluster-v1/check-cluster.mjs';
const CLUSTER = 'work-orders/v02-finish-cluster-v1/cluster.json';
const HISTORY = 'work-orders/v02-finish-cluster-v1/c07-baseline-v3/history';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function restoreHistoricalFiles(root, scratchRoot) {
  for (const [source, target, digest] of [
    ['run-journal-baseline-v1.test.mjs', 'tests/run-journal-baseline.test.mjs', '17a8de142999f7ebdbe164336d81ce5c0a7ef27b00e105ff7bf7a1113ea37e7f'],
    ['finish-package-v1.json', 'work-orders/v02-finish-cluster-v1/package.json', '5a648d3057b70061e6947c895981df7ce9308b4a01c578e4e3abd31aff85f935'],
    ['c07-packet-v1.packet.md', '.packets/nisi-v02-c07-native-incident-oracle.packet.md', '872ce897b91cb3b0e93338e80060a7cb7787c97e1e15e27babf043a9c73e9af4'],
  ]) {
    const bytes = readFileSync(join(ROOT, HISTORY, source));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, `retained historical fixture identity: ${target}`);
    const filename = join(root, target);
    mkdirSync(dirname(filename), {recursive: true});
    if (source === 'c07-packet-v1.packet.md') {
      const packet = bytes.toString('utf8');
      assert.equal((packet.match(/^project_root: .+$/gm) ?? []).length, 1, 'historical C07 packet root inventory');
      writeFileSync(filename, packet.replace(/^project_root: .+$/m, `project_root: ${scratchRoot}`));
    } else writeFileSync(filename, bytes);
  }
}

test('new C07 bytes without C07 acceptance fail the first historical dependency gate', t=>{
  const fixture=makeFixture(t,{c05Accepted:true});
  const file='hosts/repository/native-incident-source-v1.mjs';
  cpSync(join(ROOT,file),join(fixture.scratch,file));
  assertCheckerAssertion(runChecker(fixture),/C04 dependency drift/);
});

function makeFixture(t, { accepted = true, c05Accepted = false, c04Accepted = c05Accepted, c02Accepted = c04Accepted, c03Accepted = c04Accepted } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'nisi-finish-cluster-inventory-'));
  const scratchRoot = realpathSync(scratch);
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const cluster = JSON.parse(readFileSync(join(ROOT, CLUSTER), 'utf8'));
  delete cluster.historyHardening;
  // Historic precursor cases do not claim C06/C07 acceptance or their evidence.
  cluster.packets[6].state='OWNER_ACCEPTANCE_REQUIRED';
  cluster.packets[6].implementationAccepted=false;
  delete cluster.packets[6].ownerAcceptance;
  delete cluster.dependencySupersessions;
  delete cluster.c07BaselineControl;
  delete cluster.baselineSupersessions;
  cluster.packets[5].state='OWNER_ACCEPTANCE_REQUIRED';
  cluster.packets[5].implementationAccepted=false;
  delete cluster.packets[5].ownerAcceptance;
  if(['C01_C02_C03_C04_C05_C06_NODE_IMPLEMENTATION_ACCEPTED',
      'C01_C02_C03_C04_C05_C06_C07_NODE_IMPLEMENTATION_ACCEPTED'].includes(cluster.executionState))
    cluster.executionState='C01_C02_C03_C04_C05_NODE_IMPLEMENTATION_ACCEPTED';
  const checkerTarget = join(scratch, CHECKER);
  const clusterTarget = join(scratch, CLUSTER);
  mkdirSync(dirname(checkerTarget), { recursive: true });
  // Historical C01-C05 fixtures use the exact retained original controls.
  cpSync(join(ROOT, HISTORY, 'check-cluster.mjs'), checkerTarget);
  cpSync(join(ROOT, HISTORY, 'check-c06.mjs'),
    join(scratch,'work-orders/v02-finish-cluster-v1/check-c06.mjs'));
  cpSync(join(ROOT, HISTORY, 'check-c07.mjs'),
    join(scratch,'work-orders/v02-finish-cluster-v1/check-c07.mjs'));

  const files = new Set();
  for (const row of cluster.packets) {
    for (const file of [...row.allowedFiles, ...row.readOnlySources]) files.add(file);
    const sourcePacket = row.id === 'C07'
      ? join(ROOT, HISTORY, 'c07-packet-v1.packet.md') : join(ROOT, row.packet);
    const targetPacket = join(scratch, row.packet);
    mkdirSync(dirname(targetPacket), { recursive: true });
    const packet = readFileSync(sourcePacket, 'utf8');
    writeFileSync(targetPacket, packet.replace(/^project_root: .+$/m, `project_root: ${scratchRoot}`));
  }
  for (const file of files) {
    const source = join(ROOT, file);
    const isReadOnlySource = cluster.packets.some(row => row.readOnlySources.includes(file));
    const isC01AcceptedSource = cluster.packets.find(row => row.id === 'C01')?.allowedFiles.includes(file);
    if (!existsSync(source)) {
      assert.equal(isReadOnlySource || isC01AcceptedSource, false, `missing trusted fixture source: ${file}`);
      continue;
    }
    const target = join(scratch, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
  }

  if(c04Accepted){
    const evidence=cluster.packets[3].ownerAcceptance.evidence;
    const receipt=JSON.parse(readFileSync(join(ROOT,evidence),'utf8'));
    const mutationRecord=JSON.parse(readFileSync(join(ROOT,receipt.mutations.path),'utf8'));
    for(const file of [evidence,receipt.checkpoint.path,receipt.mutations.path,receipt.review.path,
      'work-orders/v02-finish-cluster-v1/package.json',...Object.keys(mutationRecord.sourceHashes)]){
      const target=join(scratch,file);mkdirSync(dirname(target),{recursive:true});
      cpSync(join(ROOT,file),target);
    }
  }else{
    // Synthetic precursor control states use today's bytes; these are not
    // replays of historic C02/C03 behavior or acceptance receipts.
    cluster.packets[3].state='SECURITY_REVIEW_REQUIRED';
    cluster.packets[3].implementationAccepted=false;
    delete cluster.packets[3].ownerAcceptance;
    delete cluster.acceptanceSupersessions;
    cluster.executionState='C01_C02_C03_NODE_IMPLEMENTATION_ACCEPTED';
  }

  if(c05Accepted){
    assert.equal(cluster.packets[4].implementationAccepted,true,'C05 fixture requires owner-integrated C05 ledger');
    const evidence=cluster.packets[4].ownerAcceptance.evidence;
    const receipt=JSON.parse(readFileSync(join(ROOT,evidence),'utf8'));
    const checkpoint=JSON.parse(readFileSync(join(ROOT,receipt.checkpoint.path),'utf8'));
    for(const file of [evidence,...['checkpoint','mutations','review','validation'].map(key=>receipt[key].path),
      ...Object.keys(checkpoint.sourceHashes)]){
      const target=join(scratch,file);mkdirSync(dirname(target),{recursive:true});cpSync(join(ROOT,file),target);
    }
  }else{
    cluster.packets[4].state='SECURITY_REVIEW_REQUIRED';
    cluster.packets[4].implementationAccepted=false;
    delete cluster.packets[4].ownerAcceptance;
    if(c04Accepted) {
      cluster.executionState='C01_C02_C03_C04_NODE_IMPLEMENTATION_ACCEPTED';
      cluster.acceptanceSupersessions=cluster.acceptanceSupersessions.slice(0,1);
    }
    // Immutable, hash-verified C04 bytes support real predecessor controls even
    // after the current checkout adopts C05. Do not invent new historical pins.
    const prefix='work-orders/parallel-seven-tracks-v1/track1/';
    const names=['repository-fixture-runner.mjs','repository-fixture-runner.test.mjs','fixture-write-guard.mjs','findings-cluster-cleanup.test.mjs'];
    for(const name of names){
      const file=prefix+name;
      const source=join(ROOT,'.packet-diagnostics/c05-owner-review-PeEuLA/predecessor-source',file);
      const bytes=readFileSync(source);
      const predecessor=cluster.packets.slice(1,4).map(row=>row.ownerAcceptance?.sourceHashes?.[file]).find(Boolean);
      // C04 may have been removed for a C01-only precursor; its original
      // source is still checked by C02/C03 when their metadata names the file.
      if(predecessor) assert.equal(createHash('sha256').update(bytes).digest('hex'),predecessor,'predecessor source digest');
      writeFileSync(join(scratch,file),bytes);
    }
  }

  // These fixtures represent pre-C07 states. Restore the actual retained old
  // dependency after copying C04/C05 closures rather than weakening their pins.
  const oldPath='hosts/repository/native-incident-source-v1.mjs';
  const oldBytes=readFileSync(join(ROOT,'.packet-diagnostics/c07-owner-draft-20260920/predecessor-source',oldPath));
  assert.equal(createHash('sha256').update(oldBytes).digest('hex'),'ab08ed666126011f3e57f7d3975dce8602a1d570f81c8c544f1c58a2f0616a26');
  mkdirSync(dirname(join(scratch,oldPath)),{recursive:true});
  writeFileSync(join(scratch,oldPath),oldBytes);
  // Historical acceptance fixtures retain their exact original history bytes.
  for (const [file, digest] of [["history/journal-owner-v2.mjs","b64e21ae717870faf220baf3f0ddc9c44841f0492415805f7b75b812828e7184"],["history/run-journal-v1.mjs","dee9f490c091000b2560cd9464d945885e7f341091b87dde9ae4f2b7cdbd359e"]]) {
    const bytes = readFileSync(join(ROOT,'.packet-diagnostics/history-proxy-owner-20260920/before',file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),digest,'retained history predecessor');
    writeFileSync(join(scratch,file),bytes);
  }
  restoreHistoricalFiles(scratch, scratchRoot);
  const c01 = cluster.packets.find(row => row.id === 'C01');
  assert(c01, 'cluster must contain C01');
  const c02 = cluster.packets.find(row => row.id === 'C02');
  assert(c02, 'cluster must contain C02');
  const c03 = cluster.packets.find(row => row.id === 'C03');
  assert(c03, 'cluster must contain C03');
  if(!c03Accepted){
    c03.state='DEPENDENCY_AND_LIFECYCLE_REVIEW'; c03.implementationAccepted=false;
    delete c02.ownerAcceptance.revalidation;
    cluster.executionState=c02Accepted?'C01_C02_NODE_IMPLEMENTATION_ACCEPTED':'C01_NODE_IMPLEMENTATION_ACCEPTED';
  }
  if(!c02Accepted){
    c02.state='ORACLE_REVIEW_REQUIRED'; c02.implementationAccepted=false;
    cluster.executionState='C01_NODE_IMPLEMENTATION_ACCEPTED';
  }
  if (!accepted) {
    cluster.executionState = 'DISPATCH_APPROVED_C01';
    c01.state = 'READY';
    c01.implementationAccepted = false;
  }
  writeFileSync(clusterTarget, JSON.stringify(cluster));
  return { scratch, cluster, clusterTarget, sourceFiles: [...files] };
}

function runChecker(fixture) {
  const child = spawnSync(process.execPath, [fixture.checker ?? join(fixture.scratch, CHECKER)], {
    cwd: fixture.scratch,
    encoding: 'utf8',
    timeout: 3000,
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.signal, null, child.stderr);
  return { exitCode: child.status, stdout: child.stdout, stderr: child.stderr };
}

function assertPass(result, accepted) {
  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, 'PASS_PACKET_INVENTORY_ONLY');
  assert.equal(payload.implementationAccepted, accepted ? 1 : 0);
  assert.equal(payload.nativeBuildAccepted, false);
}

function assertCheckerAssertion(result, guard) {
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.exitCode, 1, result.stderr);
  assert.match(result.stderr, /AssertionError/);
  assert.doesNotMatch(result.stderr, /SyntaxError|ERR_MODULE_NOT_FOUND|TypeError/);
  if (guard) assert.match(result.stderr, guard);
}

const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex');

function c05Receipt(fixture){
  const file=fixture.cluster.packets[4].ownerAcceptance.evidence;
  return {file,record:JSON.parse(readFileSync(join(fixture.scratch,file),'utf8'))};
}

// These negative controls recompute the containing digests deliberately. A
// rejected byte mismatch alone cannot prove the semantic evidence checks work.
function alterC05Evidence(fixture,kind,mutate){
  const {file,record}=c05Receipt(fixture);
  const cluster=clone(fixture.cluster);
  if(kind==='evidence') mutate(record);
  else{
    const target=join(fixture.scratch,record[kind].path);
    const nested=JSON.parse(readFileSync(target,'utf8'));mutate(nested);
    const bytes=JSON.stringify(nested);writeFileSync(target,bytes);
    record[kind].sha256=hashBytes(bytes);
    // Keep the mutation/checkpoint reference consistent, so a broken graded
    // row must fail its grade rather than only this outer reference.
    if(kind==='checkpoint'){
      const mutationPath=join(fixture.scratch,record.mutations.path);
      const mutations=JSON.parse(readFileSync(mutationPath,'utf8'));
      mutations.checkpointSha256=record.checkpoint.sha256;
      const changed=JSON.stringify(mutations);writeFileSync(mutationPath,changed);
      record.mutations.sha256=hashBytes(changed);
    }
    if(kind==='validation'){
      const checkpointPath=join(fixture.scratch,record.checkpoint.path);
      const checkpoint=JSON.parse(readFileSync(checkpointPath,'utf8'));
      checkpoint.validation.logSha256=record.validation.sha256;
      const bytes=JSON.stringify(checkpoint);writeFileSync(checkpointPath,bytes);
      record.checkpoint.sha256=hashBytes(bytes);
      const mutationPath=join(fixture.scratch,record.mutations.path);
      const mutations=JSON.parse(readFileSync(mutationPath,'utf8'));
      mutations.checkpointSha256=record.checkpoint.sha256;
      const changed=JSON.stringify(mutations);writeFileSync(mutationPath,changed);
      record.mutations.sha256=hashBytes(changed);
    }
  }
  const bytes=JSON.stringify(record);writeFileSync(join(fixture.scratch,file),bytes);
  cluster.packets[4].ownerAcceptance.evidenceSha256=hashBytes(bytes);
  writeFileSync(fixture.clusterTarget,JSON.stringify(cluster));
}

test('C05 accepts exact five-file evidence and predecessor overlay without native or dispatch credit',t=>{
  const fixture=makeFixture(t,{c05Accepted:true});
  const result=runChecker(fixture);assert.equal(result.exitCode,0,result.stderr);
  const value=JSON.parse(result.stdout);
  assert.equal(value.status,'PASS_PACKET_INVENTORY_ONLY');
  assert.equal(value.implementationAccepted,5);assert.equal(value.finishPacketPercent,50);
  assert.equal(value.fixtureInputImportsAccepted,true);assert.equal(value.overallMilestonePercent,30);
  assert.equal(value.nativeBuildAccepted,false);assert.equal(value.executedByThisCheck,0);
  assert.deepEqual(value.dispatchApproved,[]);
  assert.equal(fixture.cluster.acceptanceSupersessions.length,2);
  for(const [id,index] of [['C02',1],['C03',2],['C04',3]])
    assert.deepEqual(fixture.cluster.acceptanceSupersessions[1].previousAcceptances[id],fixture.cluster.packets[index].ownerAcceptance);
});

test('C05 rejects scope, provenance, authority, dependency, and predecessor-history changes',t=>{
  const fixture=makeFixture(t,{c05Accepted:true});
  const runner='work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.mjs';
  const cases=[
    [c=>{c.packets[4].state='READY';},/C05 accepted-state mismatch/],
    [c=>{c.packets[4].ownerAcceptance.scope='ALL_RUNTIME';},/C05 scope mismatch/],
    [c=>{c.packets[4].ownerAcceptance.acceptedBy='worker';},/C05 owner mismatch/],
    [c=>{c.packets[4].ownerAcceptance.integrationRoute='OPENCODE';},/C05 provenance mismatch/],
    ...['openCodeExecuted','nativeBuildAccepted','publicationAuthorized'].map(key=>[c=>{c.packets[4].ownerAcceptance[key]=true;},/C05 forbidden credit/]),
    [c=>{c.packets[3].implementationAccepted=false;},/C05 acceptance requires retained C04/],
    [c=>{c.executionState='C01_C02_C03_C04_NODE_IMPLEMENTATION_ACCEPTED';},/cluster accepted-state mismatch/],
    [c=>{c.packets[4].allowedFiles.pop();},/C05 .*inventory|C05 .*scope/],
    [c=>{c.packets[4].allowedFiles.push('extra.mjs');},/C05 .*inventory|C05 .*scope/],
    [c=>{c.acceptanceSupersessions.pop();},/C04 supersession history missing or changed/],
    [c=>{c.acceptanceSupersessions[0].scope='changed';},/C04 history\[0\] changed byte-for-byte/],
    [c=>{c.acceptanceSupersessions[1].previousAcceptances.C04.sourceHashes[runner]='0'.repeat(64);},/C05 .*predecessor|C05 .*history/],
    [c=>{c.acceptanceSupersessions[1].previousAcceptances.C02=c.acceptanceSupersessions[0].previousAcceptances.C02;},/C05 .*predecessor|C05 .*history/],
  ];
  for(const [mutate,guard] of cases){
    const candidate=clone(fixture.cluster);mutate(candidate);
    writeFileSync(fixture.clusterTarget,JSON.stringify(candidate));
    assertCheckerAssertion(runChecker(fixture),guard);
  }
});

test('C05 requires each artifact digest and actual current source bytes',t=>{
  const fixture=makeFixture(t,{c05Accepted:true});
  const {file,record}=c05Receipt(fixture);
  for(const [target,kind] of [[file,'evidence'],...['checkpoint','mutations','review','validation'].map(kind=>[record[kind].path,kind])]){
    const name=join(fixture.scratch,target),original=readFileSync(name);
    rmSync(name);assertCheckerAssertion(runChecker(fixture),new RegExp('C05 (Nisi )?'+kind+' (evidence )?missing'));
    writeFileSync(name,Buffer.concat([original,Buffer.from('\n')]));
    assertCheckerAssertion(runChecker(fixture),new RegExp('C05 (Nisi )?'+kind+' digest mismatch'));
    writeFileSync(name,original);
  }
  for(const file of Object.keys(record.sourceHashes)){
    const target=join(fixture.scratch,file),original=readFileSync(target);
    writeFileSync(target,Buffer.concat([original,Buffer.from('\n// source drift\n')]));
    assertCheckerAssertion(runChecker(fixture),/C05 .*source|C05 .*dependency/);
    writeFileSync(target,original);
  }
  // A non-C05 dependency must not receive the five-file live-source exception.
  const unrelated='tests/fixture-cleanup-state.test.mjs';
  writeFileSync(join(fixture.scratch,unrelated),readFileSync(join(fixture.scratch,unrelated),'utf8')+'\n// unrelated drift\n');
  assertCheckerAssertion(runChecker(fixture),/C0[45] dependency drift/);
});

test('C05 rejects semantically invalid receipts even with recomputed containing digests',t=>{
  const cases=[
    ['evidence',r=>{r.implementationAccepted=true;},/C05 .*authority|C05 .*self-authoriz|C05 .*acceptance/],
    ['checkpoint',r=>{r.checks.find(x=>x.name==='c05').counts.pass=110;},/C05 graded counts/],
    ['checkpoint',r=>{r.checks.find(x=>x.name==='c04').counts.skipped=1;},/C05 graded counts/],
    ['checkpoint',r=>{r.unchanged=false;},/C05 checkpoint source changed/],
    ['checkpoint',r=>{r.validation.exitCode=1;},/C05 Nisi validation/],
    ['checkpoint',r=>{r.implementationAccepted=true;},/C05 .*authority|C05 .*self-authoriz|C05 .*acceptance/],
    ['mutations',r=>{r.results[1].name=r.results[2].name;},/C05 .*mutation.*inventory|C05 .*duplicate/],
    ['mutations',r=>{r.results[1].name='unreviewed-mutant';},/C05 .*mutant.*inventory|C05 .*mutation.*inventory/],
    ['mutations',r=>{r.results[1].semanticOnly=false;},/C05 .*semantic|C05 .*runtime/],
    ['mutations',r=>{r.results[1].assertionFailures=0;},/C05 .*assertion/],
    ['mutations',r=>{r.results[1].signal='SIGTERM';},/C05 .*signal|C05 .*process|C05 .*mutation/],
    ['mutations',r=>{r.results[1].error='ETIMEDOUT';},/C05 .*error|C05 .*process|C05 .*mutation/],
    ['mutations',r=>{r.results[0].counts.pass=15;},/C05 .*control|C05 .*counts/],
    ['mutations',r=>{r.results[1].counts.skipped=1;},/C05 .*skipped|C05 .*counts/],
    ['review',r=>{r.verdict='FAIL';},/C05 review verdict/],
    ['review',r=>{r.reviewer.modelRequested='unverified';},/C05 review identity/],
    ['review',r=>{r.reviewer.modelActuallyServed='gpt-daybreak-blue-latest';},/C05 review served identity unestablished/],
    ['review',r=>{r.sourceHashes[Object.keys(r.sourceHashes)[0]]='0'.repeat(64);},/C05 reviewed source mismatch/],
    ['validation',r=>{r.status='INCONCLUSIVE';},/C05 .*validation.*status|C05 Nisi status/],
    ['validation',r=>{r.binding.candidateFingerprint='0'.repeat(64);},/C05 .*validation.*binding|C05 Nisi binding/],
    ['validation',r=>{r.checks.syntax.status='FAIL';},/C05 .*syntax/],
    ['validation',r=>{r.accepted=true;},/C05 .*authority|C05 .*accepted/],
  ];
  for(const [kind,mutate,guard] of cases){
    const fixture=makeFixture(t,{c05Accepted:true});
    const positive=runChecker(fixture);assert.equal(positive.exitCode,0,positive.stderr);
    alterC05Evidence(fixture,kind,mutate);
    assertCheckerAssertion(runChecker(fixture),guard);
  }
});

test('C05 binds the blocked packet contract even when edited evidence digests are recomputed',t=>{
  const fixture=makeFixture(t,{c05Accepted:true});
  const file=fixture.cluster.packets[4].packet,target=join(fixture.scratch,file),original=readFileSync(target);
  rmSync(target);assertCheckerAssertion(runChecker(fixture),/C05 packet missing/);
  writeFileSync(target,Buffer.concat([original,Buffer.from('\nA changed contract.\n')]));
  assertCheckerAssertion(runChecker(fixture),/C05 packet digest mismatch/);
  alterC05Evidence(fixture,'evidence',record=>{
    record.packet.sha256=hashBytes(readFileSync(target,'utf8').replace(/^project_root: .+$/m,'project_root: <PROJECT_ROOT>'));
  });
  assertCheckerAssertion(runChecker(fixture),/C05 reviewed packet contract changed/);
});

test('real checker accepts both trusted READY precursor and trusted Node-only accepted fixture', t => {
  assertPass(runChecker(makeFixture(t, { accepted: false })), false);
  assertPass(runChecker(makeFixture(t, { accepted: true })), true);
});

test('real checker rejects accepted-state, implementation, native, and publication mismatches', t => {
  const fixture = makeFixture(t, { accepted: true });
  assertPass(runChecker(fixture), true);
  const mutations = [
    [cluster => { cluster.executionState = 'C01_NODE_IMPLEMENTATION_ACCEPTED'; cluster.packets.find(row => row.id === 'C01').state = 'READY'; }, /C01 accepted-state mismatch/],
    [cluster => { cluster.packets.find(row => row.id === 'C01').implementationAccepted = false; }, /cluster accepted-state mismatch/],
    [cluster => { cluster.packets.find(row => row.id === 'C01').ownerAcceptance.nativeBuildAccepted = 'NATIVE_BAD'; }, /C01 native acceptance forbidden/],
    [cluster => { cluster.packets.find(row => row.id === 'C01').ownerAcceptance.publicationAuthorized = 'PUBLICATION_BAD'; }, /C01 publication forbidden/],
  ];
  for (const [mutate, guard] of mutations) {
    const candidate = clone(fixture.cluster);
    mutate(candidate);
    writeFileSync(fixture.clusterTarget, JSON.stringify(candidate));
    assertCheckerAssertion(runChecker(fixture), guard);
  }
});

test('real checker rejects wrong or missing accepted source hashes and copied-source drift', t => {
  const fixture = makeFixture(t, { accepted: true });
  assertPass(runChecker(fixture), true);
  const allowed = fixture.cluster.packets.find(row => row.id === 'C01').allowedFiles;
  assert.equal(allowed.length, 4);
  const cases = [
    [candidate => { candidate.packets.find(row => row.id === 'C01').ownerAcceptance.sourceHashes[allowed[0]] = '0'.repeat(64); }, /accepted C01 source drift/],
    [candidate => { delete candidate.packets.find(row => row.id === 'C01').ownerAcceptance.sourceHashes[allowed[1]]; }, /C01 source hash inventory/],
    [candidate => { writeFileSync(join(fixture.scratch, allowed[2]), `${readFileSync(join(fixture.scratch, allowed[2]), 'utf8')}\nsource-drift`); }, /accepted C01 source drift/],
  ];
  for (const [mutate, guard] of cases) {
    const candidate = clone(fixture.cluster);
    mutate(candidate);
    writeFileSync(fixture.clusterTarget, JSON.stringify(candidate));
    assertCheckerAssertion(runChecker(fixture), guard);
  }
});

test('real checker accepts source-bound C02 but rejects invented execution or wider acceptance', t => {
  const fixture=makeFixture(t,{c02Accepted:true});
  const positive=runChecker(fixture);
  assert.equal(positive.exitCode,0,positive.stderr);
  const payload=JSON.parse(positive.stdout);
  assert.equal(payload.implementationAccepted,2);
  assert.equal(payload.fixtureReceiptAccepted,true);
  assert.equal(payload.executedByThisCheck,0);
  const cases=[
    [row=>{row.state='READY';},/C02 accepted-state mismatch/],
    [row=>{row.ownerAcceptance.openCodeExecuted=true;},/C02 OpenCode execution not established/],
    [row=>{row.ownerAcceptance.nativeBuildAccepted=true;},/C02 native acceptance forbidden/],
    [row=>{row.ownerAcceptance.publicationAuthorized=true;},/C02 publication forbidden/],
    [row=>{row.ownerAcceptance.scope='PRODUCTION';},/C02 scope mismatch/],
    [row=>{row.ownerAcceptance.integrationRoute='OPENCODE';},/C02 provenance mismatch/],
  ];
  for(const [mutate,guard] of cases){
    const candidate=clone(fixture.cluster);mutate(candidate.packets.find(row=>row.id==='C02'));
    writeFileSync(fixture.clusterTarget,JSON.stringify(candidate));
    assertCheckerAssertion(runChecker(fixture),guard);
  }
});

test('real checker rejects C02 missing hashes, stale digests, and changed accepted bytes', t => {
  const fixture=makeFixture(t,{c02Accepted:true});
  const row=fixture.cluster.packets.find(row=>row.id==='C02');
  const [first,second]=row.allowedFiles;
  const cases=[
    [candidate=>{delete candidate.packets.find(row=>row.id==='C02').ownerAcceptance.sourceHashes[first];},/C02 source hash inventory/],
    [candidate=>{candidate.packets.find(row=>row.id==='C02').ownerAcceptance.sourceHashes[second]='0'.repeat(64);},/accepted C02 source drift/],
    [()=>{writeFileSync(join(fixture.scratch,first),readFileSync(join(fixture.scratch,first),'utf8')+'\nsource-drift');},/accepted C02 source drift/],
  ];
  for(const [mutate,guard] of cases){
    const candidate=clone(fixture.cluster);mutate(candidate);
    writeFileSync(fixture.clusterTarget,JSON.stringify(candidate));
    assertCheckerAssertion(runChecker(fixture),guard);
  }
});

test('real checker accepts C03 only with source-bound cleanup and C02 revalidation history', t => {
  const fixture=makeFixture(t,{c02Accepted:true,c03Accepted:true});
  const result=runChecker(fixture);
  assert.equal(result.exitCode,0,result.stderr);
  const payload=JSON.parse(result.stdout);
  assert.equal(payload.implementationAccepted,3);
  assert.equal(payload.fixtureCleanupAccepted,true);
  assert.equal(payload.fixtureReceiptAccepted,true);
  assert.equal(payload.executedByThisCheck,0);
  assert.deepEqual(payload.dispatchApproved,[]);
  const mutations=[
    [c=>{c.packets[2].state='READY';},/C03 accepted-state mismatch/],
    [c=>{c.packets[2].ownerAcceptance.scope='FULL_RELEASE';},/C03 scope mismatch/],
    [c=>{c.packets[2].ownerAcceptance.openCodeExecuted=true;},/C03 OpenCode execution not established/],
    [c=>{c.packets[2].ownerAcceptance.nativeBuildAccepted=true;},/C03 native acceptance forbidden/],
    [c=>{c.packets[2].ownerAcceptance.publicationAuthorized=true;},/C03 publication forbidden/],
    [c=>{delete c.packets[1].ownerAcceptance.revalidation;},/C03 requires C02 revalidation history/],
    [c=>{c.packets[1].ownerAcceptance.revalidation.previousEvidence='rewritten-history';},/C02 original evidence must remain identified/],
    [c=>{c.packets[1].ownerAcceptance.revalidation.previousSourceHashes['work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.mjs']='0'.repeat(64);},/C02 historical runner mismatch/],
    [c=>{c.packets[1].ownerAcceptance.evidence='unrelated';},/C02\/C03 revalidation evidence mismatch/],
    [c=>{delete c.packets[2].ownerAcceptance.sourceHashes['tests/fixture-cleanup-state.test.mjs'];},/C03 source hash inventory/],
  ];
  for(const [mutate,guard] of mutations){
    const candidate=clone(fixture.cluster);mutate(candidate);
    writeFileSync(fixture.clusterTarget,JSON.stringify(candidate));
    assertCheckerAssertion(runChecker(fixture),guard);
  }
});

test('real checker rejects C03 source drift and acceptance without C02', t => {
  const fixture=makeFixture(t,{c02Accepted:true,c03Accepted:true});
  const candidate=clone(fixture.cluster);candidate.packets[1].implementationAccepted=false;
  writeFileSync(fixture.clusterTarget,JSON.stringify(candidate));
  assertCheckerAssertion(runChecker(fixture),/C03 acceptance requires retained C02 acceptance/);
  writeFileSync(fixture.clusterTarget,JSON.stringify(fixture.cluster));
  const source=join(fixture.scratch,'tests/fixture-cleanup-state.test.mjs');
  writeFileSync(source,readFileSync(source,'utf8')+'\n// unexpected change\n');
  assertCheckerAssertion(runChecker(fixture),/accepted C03 source drift/);
});

test('C04 acceptance binds exact reviewed sources and evidence without advancing NX or dispatch',t=>{
  const fixture=makeFixture(t,{c04Accepted:true});
  const result=runChecker(fixture);assert.equal(result.exitCode,0,result.stderr);
  const payload=JSON.parse(result.stdout);
  assert.equal(payload.implementationAccepted,4);assert.equal(payload.finishPacketPercent,40);
  assert.equal(payload.overallMilestonePercent,30);assert.equal(payload.fixtureContainmentAccepted,true);
  assert.equal(payload.nativeBuildAccepted,false);assert.equal(payload.executedByThisCheck,0);
  assert.deepEqual(payload.dispatchApproved,[]);
});

test('C04 rejects acceptance, provenance, scope, shared-hash and append-only history mutations',t=>{
  const fixture=makeFixture(t,{c04Accepted:true});
  const runner='work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.mjs';
  const mutations=[
    [c=>{c.packets[3].state='READY';},/C04 accepted-state mismatch/],
    [c=>{c.packets[3].implementationAccepted=false;},/cluster accepted-state mismatch/],
    [c=>{c.packets[2].implementationAccepted=false;},/C04 acceptance requires retained C03/],
    [c=>{c.executionState='C01_C02_C03_NODE_IMPLEMENTATION_ACCEPTED';},/cluster accepted-state mismatch/],
    [c=>{c.overallMilestones={accepted:4,total:10,percent:40};},null],
    [c=>{c.packets[3].ownerAcceptance.scope='SANDBOX';},/C04 scope mismatch/],
    [c=>{c.packets[3].ownerAcceptance.acceptedBy='worker';},/C04 owner mismatch/],
    [c=>{c.packets[3].ownerAcceptance.integrationRoute='OPENCODE';},/C04 provenance mismatch/],
    ...['openCodeExecuted','nativeBuildAccepted','publicationAuthorized'].map(key=>[c=>{c.packets[3].ownerAcceptance[key]=true;},/C04 forbidden credit/]),
    [c=>{c.packets[3].ownerAcceptance.evidence='unbound.json';},/C04 evidence path mismatch/],
    [c=>{c.packets[3].ownerAcceptance.evidenceSha256='0'.repeat(64);},/C04 evidence digest mismatch/],
    [c=>{delete c.packets[3].ownerAcceptance.sourceHashes[runner];},/C04 evidence\/source mismatch/],
    [c=>{c.packets[1].ownerAcceptance.sourceHashes[runner]='0'.repeat(64);},/C04 shared source mismatch/],
    [c=>{delete c.acceptanceSupersessions;},/C04 supersession history missing/],
    [c=>{delete c.acceptanceSupersessions[0].previousAcceptances.C03;},/C04 predecessor inventory/],
    [c=>{c.acceptanceSupersessions[0].previousAcceptances.C03.sourceHashes[runner]='0'.repeat(64);},/C03 historical runner mismatch/],
    [c=>{c.acceptanceSupersessions[0].previousAcceptances.C02.revalidation.previousSourceHashes[runner]='0'.repeat(64);},/C04 predecessor metadata/],
    [c=>{c.packets[1].ownerAcceptance.revalidation.previousSourceHashes[runner]='0'.repeat(64);c.acceptanceSupersessions[0].previousAcceptances.C02.revalidation.previousSourceHashes[runner]='0'.repeat(64);},/C02 historical runner mismatch/],
    [c=>{c.acceptanceSupersessions[0].previousAcceptances.C03.evidence='rewritten';},/C04 predecessor evidence changed/],
    [c=>{c.packets[2].ownerAcceptance.evidence='unrelated';},/C04 current evidence mismatch/],
    [c=>{c.packets[4].implementationAccepted=true;},null],
  ];
  for(const [mutate,guard] of mutations){
    const candidate=clone(fixture.cluster);mutate(candidate);
    writeFileSync(fixture.clusterTarget,JSON.stringify(candidate));
    assertCheckerAssertion(runChecker(fixture),guard);
  }
});

test('C04 rejects missing or changed evidence files and live guard drift',t=>{
  const fixture=makeFixture(t,{c04Accepted:true});
  const evidence=fixture.cluster.packets[3].ownerAcceptance.evidence;
  const receipt=JSON.parse(readFileSync(join(fixture.scratch,evidence),'utf8'));
  for(const [file,kind] of [[evidence,'evidence'],[receipt.checkpoint.path,'checkpoint'],[receipt.mutations.path,'mutations'],[receipt.review.path,'review']]){
    const target=join(fixture.scratch,file),original=readFileSync(target);
    rmSync(target);
    assertCheckerAssertion(runChecker(fixture),new RegExp('C04 '+kind+' (evidence )?missing'));
    writeFileSync(target,Buffer.concat([original,Buffer.from('\n')]));
    assertCheckerAssertion(runChecker(fixture),new RegExp('C04 '+kind+' digest mismatch'));
    writeFileSync(target,original);
  }
  const guard=join(fixture.scratch,'work-orders/parallel-seven-tracks-v1/track1/fixture-write-guard.mjs');
  writeFileSync(guard,readFileSync(guard,'utf8')+'\n// drift\n');
  assertCheckerAssertion(runChecker(fixture),/C04 dependency drift/);
});

test('C04 evidence still needs semantic success when copied receipt digests are recomputed',t=>{
  const fixture=makeFixture(t,{c04Accepted:true});
  const evidence=fixture.cluster.packets[3].ownerAcceptance.evidence;
  const receipt=JSON.parse(readFileSync(join(fixture.scratch,evidence),'utf8'));
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const originalCheckpoint=readFileSync(join(fixture.scratch,receipt.checkpoint.path));
  const originalMutations=readFileSync(join(fixture.scratch,receipt.mutations.path));
  const cases=[
    ['checkpoint',r=>{r.checks[0].counts.pass=94;},/C04 graded counts/],
    ['checkpoint',r=>{r.checks[0].counts.skipped=1;},/C04 graded counts/],
    ['checkpoint',r=>{r.unchanged=false;},/C04 checkpoint source changed/],
    ['checkpoint',r=>{r.validationExitCode=1;},/C04 Nisi validation failed/],
    ['mutations',r=>{r.results[1].assertionCount=0;},/C04 missing assertion failure/],
    ['mutations',r=>{r.results[1].invalidFailure=true;},/C04 runtime failure/],
    ['mutations',r=>{r.results[0].pass=24;},null],
    ['mutations',r=>{r.results[1].name=r.results[2].name;},/C04 duplicate mutation results/],
    ['mutations',r=>{r.results[1].name='arbitrary-failing-case';},/C04 semantic mutant inventory/],
  ];
  for(const [kind,mutate,guard] of cases){
    writeFileSync(join(fixture.scratch,receipt.checkpoint.path),originalCheckpoint);
    writeFileSync(join(fixture.scratch,receipt.mutations.path),originalMutations);
    const altered=JSON.parse(kind==='checkpoint'?originalCheckpoint:originalMutations);mutate(altered);
    const bytes=JSON.stringify(altered),ref=clone(receipt);ref[kind].sha256=hash(bytes);
    writeFileSync(join(fixture.scratch,ref[kind].path),bytes);
    const receiptBytes=JSON.stringify(ref),cluster=clone(fixture.cluster);
    cluster.packets[3].ownerAcceptance.evidenceSha256=hash(receiptBytes);
    writeFileSync(join(fixture.scratch,evidence),receiptBytes);
    writeFileSync(fixture.clusterTarget,JSON.stringify(cluster));
    assertCheckerAssertion(runChecker(fixture),guard);
  }
});
