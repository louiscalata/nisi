import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Source/data verification only. Root's actual acceptance receipt is external.
// This control neither accepts itself nor calls C06/C07/history validators.
const PROPOSAL_PATH = "work-orders/v02-finish-cluster-v1/c07-baseline-v3/proposed-transition-v3.json";
const PROPOSAL_SHA256 = "55c552bb4c064b16aa1050efc9e5c46674b57176d11520228b6248410935f1f3";
const MAP_PATH = "work-orders/v02-finish-cluster-v1/c07-baseline-v3/dependency-map-v3.json";
const MAP_SHA256 = "a9d3e998a73d57573f83d101fc2204ab5a30b3e36b5a9c7a3ebdef4d5cc79178";
const MAP_COUNT = 129;
const CANONICAL_ROOT = '/Users/louiscalata/nisi';
const BASELINE = 'tests/run-journal-baseline.test.mjs';
const PARSER = 'tests/parse-static-imports-child.mjs';
const JOURNAL = 'history/run-journal-v1.mjs';
const PACKAGE = 'work-orders/v02-finish-cluster-v1/package.json';
const ACTIVE_PACKET = '.packets/nisi-v02-c07-native-incident-oracle.packet.md';
export const C07_ORIGINAL_PACKET_PATH = "work-orders/v02-finish-cluster-v1/c07-baseline-v3/history/c07-packet-v1.packet.md";
const ORIGINAL_PACKAGE_PATH = "work-orders/v02-finish-cluster-v1/c07-baseline-v3/history/finish-package-v1.json";
const HISTORICAL_BASELINE_PATH = "work-orders/v02-finish-cluster-v1/c07-baseline-v3/history/run-journal-baseline-v1.test.mjs";
const BASELINE_SHA256 = 'e5003eb51c32eaa988b6aa9313b9863bc60579b3f7d5739c56d4b9aa95bb5f86';
const PARSER_SHA256 = '0405808adc77b2f4e2b166bbab96213b881d9d3090711e3bc39dc8bebdbc1aa5';
const JOURNAL_SHA256 = '0164f10da27f6d12cfd1f3d443bd8e0f7c237b46363353570ae4a759a97f749b';
const OLD_BASELINE_SHA256 = '17a8de142999f7ebdbe164336d81ce5c0a7ef27b00e105ff7bf7a1113ea37e7f';
const OLD_PACKAGE_SHA256 = '5a648d3057b70061e6947c895981df7ce9308b4a01c578e4e3abd31aff85f935';
const OLD_PACKET_RAW_SHA256 = '872ce897b91cb3b0e93338e80060a7cb7787c97e1e15e27babf043a9c73e9af4';
const OLD_PACKET_NORMALIZED_SHA256 = 'c01e53f7925a83c0d7d1b620bd8ef3f8c27054241b6a326b71e38436c4757930';
const OLD_MAP_SHA256 = 'd368f5e3935324445f544b4eab081f66763b8149a9c8438a0bb94a2effc23461';
const TRANSITIONS = Object.freeze([{"by":"C07_BASELINE_ORACLE_V3","path":"tests/run-journal-baseline.test.mjs","oldSha256":"17a8de142999f7ebdbe164336d81ce5c0a7ef27b00e105ff7bf7a1113ea37e7f","newSha256":"e5003eb51c32eaa988b6aa9313b9863bc60579b3f7d5739c56d4b9aa95bb5f86","record":"work-orders/v02-finish-cluster-v1/c07-baseline-v3/proposed-transition-v3.json"},{"by":"C07_BASELINE_ORACLE_V3","path":"work-orders/v02-finish-cluster-v1/package.json","oldSha256":"5a648d3057b70061e6947c895981df7ce9308b4a01c578e4e3abd31aff85f935","newSha256":"ca463f3c1e23901fd687b98c43b0cd5198470a9ee6cfe09a443f5049a544dfea","record":"work-orders/v02-finish-cluster-v1/c07-baseline-v3/proposed-transition-v3.json"},{"by":"C07_BASELINE_ORACLE_V3","path":".packets/nisi-v02-c07-native-incident-oracle.packet.md","oldSha256":"872ce897b91cb3b0e93338e80060a7cb7787c97e1e15e27babf043a9c73e9af4","newSha256":"43c24dee53f6906799f256c913e6497e0fa3ac8cdf8f770e80316d5015e06a6c","record":"work-orders/v02-finish-cluster-v1/c07-baseline-v3/proposed-transition-v3.json"}].map(row => Object.freeze(row)));
export const C07_BASELINE_DEPENDENCY_TRANSITIONS = Object.freeze(TRANSITIONS.slice(0,2));
const SELECTION = Object.freeze({"version":3,"currentTest":"tests/run-journal-baseline.test.mjs","historicalV1Test":"work-orders/v02-finish-cluster-v1/c07-baseline-v3/history/run-journal-baseline-v1.test.mjs","proposalRecord":"work-orders/v02-finish-cluster-v1/c07-baseline-v3/proposed-transition-v3.json","currentCommand":"npm run test:c07:v3 --prefix work-orders/v02-finish-cluster-v1","fullSuiteCommand":"npm test","selectionPolicy":"V1_PRESERVED_HISTORICAL_V3_SOURCE_SELECTION","ownerAcceptance":"SEPARATE_EXTERNAL_RECEIPT_REQUIRED"});
const ALLOWED_PATHS = Object.freeze([".packets/nisi-v02-c07-native-incident-oracle.packet.md","tests/finish-cluster-c06.test.mjs","tests/finish-cluster-c07-baseline-v3.test.mjs","tests/finish-cluster-c07.test.mjs","tests/finish-cluster-history.test.mjs","tests/finish-cluster-inventory.test.mjs","tests/parse-static-imports-child.mjs","tests/run-journal-baseline.test.mjs","work-orders/v02-finish-cluster-v1/c07-baseline-v3/dependency-map-v3.json","work-orders/v02-finish-cluster-v1/c07-baseline-v3/history/c07-packet-v1.packet.md","work-orders/v02-finish-cluster-v1/c07-baseline-v3/history/check-c06.mjs","work-orders/v02-finish-cluster-v1/c07-baseline-v3/history/check-c07.mjs","work-orders/v02-finish-cluster-v1/c07-baseline-v3/history/check-cluster.mjs","work-orders/v02-finish-cluster-v1/c07-baseline-v3/history/finish-package-v1.json","work-orders/v02-finish-cluster-v1/c07-baseline-v3/history/run-journal-baseline-v1.test.mjs","work-orders/v02-finish-cluster-v1/c07-baseline-v3/proposed-transition-v3.json","work-orders/v02-finish-cluster-v1/check-c06.mjs","work-orders/v02-finish-cluster-v1/check-c07-baseline-v3.mjs","work-orders/v02-finish-cluster-v1/check-c07.mjs","work-orders/v02-finish-cluster-v1/check-cluster.mjs","work-orders/v02-finish-cluster-v1/cluster.json","work-orders/v02-finish-cluster-v1/package.json"]);
const PROTECTED_PATHS = Object.freeze(["history/run-journal-v1.mjs","history/journal-owner-v2.mjs","tests/journal-proxy-boundaries.test.mjs","package.json","package-lock.json","roadmap.md","work-orders/v02-finish-cluster-v1/c06-c07-owner-decisions-20260920.md",".packet-diagnostics/","integrations/veritas/"]);
const PACKET_BINDING = Object.freeze({"path":".packets/nisi-v02-c07-native-incident-oracle.packet.md","normalization":"PROJECT_ROOT_PLACEHOLDER_V1","canonicalRoot":"/Users/louiscalata/nisi","canonicalRawSha256":"43c24dee53f6906799f256c913e6497e0fa3ac8cdf8f770e80316d5015e06a6c","normalizedSha256":"0b1803926209cc9be49a588bea18ccd682eee9c59729928039b78d9aca735e13","rootRewriteOnly":true});
const PACKAGE_COMMAND = "node --test ../../tests/finish-cluster-c07-baseline-v3.test.mjs ../../tests/run-journal-baseline.test.mjs ../../work-orders/v02-finish-cluster-v1/native-incident/admission-integration.test.mjs ../../tests/native-incident-source.test.mjs ../../tests/native-incident-source-host.test.mjs ../../tests/native-incident-source-boundaries.test.mjs";
const PREDECESSOR_REFS = Object.freeze([[".packet-diagnostics/c07-owner-draft-20260920/final-evidence.json","7909ceae8efe9290c63163834f31485894458fef3faa79506db3c5ede592ea10"],[".packet-diagnostics/c07-owner-draft-20260920/canonical-MybG74/checks.json","adf573d2aaf0740d8f6eff26091100186ef4c875d47f1c3167f6bcf69f908093"],["work-orders/run-journal-store/evidence/task1-initial-hashes.json","48fb527f84180df69341224e1502e9fbceb158691ac78f3b3a00937a2d95db40"],["work-orders/run-journal-store/evidence/verification.json","9a97934ca8a0534216061632876d6cc063de1b1534b52f033e83b2b3c9f93f16"]]);
const ORIGINAL_CONTROLS = Object.freeze({"work-orders/v02-finish-cluster-v1/c07-baseline-v3/history/check-c06.mjs":"19c6dfa1ab67f7b764a9a60e36edd18dc92545ed059e9c96c569e382a89dad4a","work-orders/v02-finish-cluster-v1/c07-baseline-v3/history/check-c07.mjs":"3ad5fc05d81a81ac4039c27dfc58c412271b3ea96f6712614871659f8ff75f97","work-orders/v02-finish-cluster-v1/c07-baseline-v3/history/check-cluster.mjs":"4a13a3d36170419baec4b9251ecd80d9f8542e023de746c3d3689233dbb42347"});
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const metadata = s => [s.dev,s.ino,s.mode,s.nlink,s.uid,s.gid,s.rdev,s.size,s.blksize,s.blocks,s.mtimeNs,s.ctimeNs,s.birthtimeNs];
function safeBytes(root, relative) {
  assert.equal(typeof relative,'string');
  assert(relative && !path.isAbsolute(relative) && !relative.includes('\\') && !relative.split('/').some(x=>x==='..'||x==='.'||x===''));
  const file=path.join(root,relative), realRoot=fs.realpathSync(root);
  assert.equal(fs.realpathSync(root),path.resolve(root),'C07 v3 root must have an explicit real identity');
  let current=root;
  for(const part of relative.split('/').slice(0,-1)){
    current=path.join(current,part);const stat=fs.lstatSync(current);
    assert(stat.isDirectory()&&!stat.isSymbolicLink(),'C07 v3 parent must be a real directory');
  }
  const before=fs.lstatSync(file,{bigint:true});
  assert(before.isFile()&&!before.isSymbolicLink(),'C07 v3 regular file required: '+relative);
  assert(before.size<=16777216n,'C07 v3 source read bound');
  assert(fs.realpathSync(file).startsWith(realRoot+path.sep),'C07 v3 file escaped root');
  assert(Number.isInteger(fs.constants.O_NOFOLLOW),'C07 v3 no-follow capability required');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const opened=fs.fstatSync(fd,{bigint:true});assert.deepEqual(metadata(opened),metadata(before),'C07 v3 opened source drift');
    const buffer=Buffer.alloc(Number(before.size)+1);let length=0;
    while(length<buffer.length){const n=fs.readSync(fd,buffer,length,buffer.length-length,length);if(!n)break;length+=n;}
    assert.equal(BigInt(length),before.size,'C07 v3 full source length');
    assert.deepEqual(metadata(fs.fstatSync(fd,{bigint:true})),metadata(before),'C07 v3 source drift during read');
    assert.deepEqual(metadata(fs.lstatSync(file,{bigint:true})),metadata(before),'C07 v3 named source drift');
    return buffer.subarray(0,length);
  }finally{fs.closeSync(fd);}
}
function packetNormalized(bytes) {
  const text=bytes.toString('utf8');
  assert.equal((text.match(/^project_root: .+$/gm)??[]).length,1,'C07 v3 packet root row');
  return Buffer.from(text.replace(/^project_root: .+$/m,'project_root: <PROJECT_ROOT>'));
}
function assertActivePacket(root, bytes, proposal, sha) {
  const text=bytes.toString('utf8');packetNormalized(bytes);
  assert(text.includes('\nproject_root: '+root+'\n'),'C07 v3 active packet root differs from selected root');
  assert.equal(sha(packetNormalized(bytes)),PACKET_BINDING.normalizedSha256,'C07 v3 active packet normalized identity');
  if(path.resolve(root)===CANONICAL_ROOT)
    assert.equal(sha(bytes),PACKET_BINDING.canonicalRawSha256,'C07 v3 active packet canonical raw identity');
  const original=safeBytes(root,C07_ORIGINAL_PACKET_PATH);
  assert.equal(sha(original),OLD_PACKET_RAW_SHA256,'C07 v3 predecessor original packet identity');
  assert.equal(sha(packetNormalized(original)),OLD_PACKET_NORMALIZED_SHA256,'C07 v3 predecessor normalized packet identity');
  const amendment=proposal.packetAmendment;
  assert.equal(amendment.insertBefore,'## Packet acceptance\n');
  assert.equal(original.toString('utf8').split(amendment.insertBefore).length,2,'C07 v3 packet amendment marker');
  const expected=Buffer.from(original.toString('utf8').replace(amendment.insertBefore,amendment.text+amendment.insertBefore));
  assert.equal(sha(packetNormalized(expected)),sha(packetNormalized(bytes)),'C07 v3 packet amendment changed unrelated bytes');
  assert.equal(sha(Buffer.from(amendment.text)),amendment.textSha256,'C07 v3 packet amendment text identity');
  assert.deepEqual(amendment.allowedPaths,ALLOWED_PATHS,'C07 v3 exact P3 allowed paths');
  assert.deepEqual(amendment.protectedPaths,PROTECTED_PATHS,'C07 v3 exact P3 protected paths');
  assert.equal(amendment.acceptCommand,SELECTION.currentCommand);
  const files=[...amendment.text.matchAll(/^- \*\*files\*\*: (.+)$/gm)];
  assert.equal(files.length,1,'C07 v3 exact P3 files row');
  assert.deepEqual(files[0][1].split(',').map(x=>x.trim()).sort(),[...ALLOWED_PATHS],'C07 v3 exact P3 item scope');
  const accepts=[...amendment.text.matchAll(/^- \*\*accept\*\*: (.+)$/gm)];
  assert.equal(accepts.length,1);assert.equal(accepts[0][1],SELECTION.currentCommand);
  assert.equal((text.match(/^status: blocked$/gm)??[]).length,1,'C07 v3 active packet remains blocked');
  assert.equal((text.match(/^write_owner: opencode$/gm)??[]).length,1,'C07 v3 packet executor owner unchanged');
}
export function assertC07BaselineV3({root,cluster,sha=digest}) {
  assert.equal(typeof root,'string');assert.equal(typeof sha,'function');assert(cluster&&typeof cluster==='object');
  const proposalBytes=safeBytes(root,PROPOSAL_PATH);
  assert.equal(sha(proposalBytes),PROPOSAL_SHA256,'C07 v3 immutable proposal identity');
  const proposal=JSON.parse(proposalBytes);
  assert.equal(proposal.schema,'nisi.c07.baseline-transition.v3');
  assert.equal(proposal.status,'IMMUTABLE_PROPOSED_SOURCE_TRANSITION_NOT_ACCEPTANCE');
  assert.equal(proposal.ownerAcceptance,'SEPARATE_EXTERNAL_ACTUAL_RECEIPT_REQUIRED');
  assert.equal(proposal.acceptanceBoundary.immutableRecordNeverUpdated,true);
  assert.equal(proposal.acceptanceBoundary.nativeOrDispatchAcceptance,false);
  assert.deepEqual(proposal.transitions,TRANSITIONS);
  assert.equal(proposal.predecessor.dependencyMapSha256,OLD_MAP_SHA256);
  for(const [file,hash] of [...PREDECESSOR_REFS,...Object.entries(ORIGINAL_CONTROLS)])
    assert.equal(sha(safeBytes(root,file)),hash,'C07 v3 predecessor identity: '+file);
  assert.equal(sha(safeBytes(root,HISTORICAL_BASELINE_PATH)),OLD_BASELINE_SHA256,'C07 v3 predecessor baseline');
  assert.equal(sha(safeBytes(root,ORIGINAL_PACKAGE_PATH)),OLD_PACKAGE_SHA256,'C07 v3 predecessor package');
  const oldEvidence=JSON.parse(safeBytes(root,PREDECESSOR_REFS[0][0]));
  const oldChecks=JSON.parse(safeBytes(root,PREDECESSOR_REFS[1][0]));
  assert.equal(Object.keys(oldEvidence.dependencyHashes).length,97);
  assert.equal(sha(Buffer.from(JSON.stringify(oldEvidence.dependencyHashes))),OLD_MAP_SHA256,'C07 v3 predecessor map');
  assert.deepEqual(oldEvidence.dependencyHashes,oldChecks.dependencyHashes);
  assert.equal(oldEvidence.dependencyHashes[BASELINE],OLD_BASELINE_SHA256);
  assert.equal(oldEvidence.dependencyHashes[PACKAGE],OLD_PACKAGE_SHA256);
  assert.equal(oldEvidence.packet.normalization,'PROJECT_ROOT_PLACEHOLDER_V1');
  assert.equal(oldEvidence.packet.sha256,OLD_PACKET_NORMALIZED_SHA256);
  const initial=JSON.parse(safeBytes(root,PREDECESSOR_REFS[2][0]));
  assert.equal(initial[BASELINE],OLD_BASELINE_SHA256);
  const map=JSON.parse(safeBytes(root,MAP_PATH));
  assert.equal(map.schema,'nisi.c07.dependency-map.v3');
  assert.equal(map.sha256,MAP_SHA256);
  assert.equal(sha(Buffer.from(JSON.stringify(map.entries))),MAP_SHA256,'C07 v3 map digest');
  const entries=Object.entries(map.entries);
  assert.equal(entries.length,MAP_COUNT,'C07 v3 map count');assert.equal(map.entryCount,MAP_COUNT);
  assert.deepEqual(entries.map(([file])=>file),entries.map(([file])=>file).slice().sort(),'C07 v3 map ordering');
  assert.deepEqual(map.namedPortablePacketBinding,PACKET_BINDING,'C07 v3 named packet digest domain');
  assert.deepEqual(proposal.successor.packetBinding,PACKET_BINDING);
  for(const oldPath of Object.keys(oldEvidence.dependencyHashes))assert(Object.hasOwn(map.entries,oldPath),'C07 v3 predecessor path omitted: '+oldPath);
  for(const [file,expected] of entries){
    assert.match(expected,/^[a-f0-9]{64}$/u);const bytes=safeBytes(root,file);
    if(file===ACTIVE_PACKET){
      assert.equal(expected,PACKET_BINDING.canonicalRawSha256,'C07 v3 active packet raw map pin');
      assertActivePacket(root,bytes,proposal,sha);
    }else assert.equal(sha(bytes),expected,'C07 v3 dependency drift: '+file);
  }
  assert.equal(map.entries[BASELINE],BASELINE_SHA256);assert.equal(map.entries[PARSER],PARSER_SHA256);assert.equal(map.entries[JOURNAL],JOURNAL_SHA256);
  assert.deepEqual(cluster.c07BaselineControl,SELECTION,'C07 v3 selected generation');
  assert.deepEqual(cluster.baselineSupersessions,TRANSITIONS,'C07 v3 exact transitions');
  const diskCluster=JSON.parse(safeBytes(root,'work-orders/v02-finish-cluster-v1/cluster.json'));
  assert.deepEqual(diskCluster.c07BaselineControl,SELECTION,'C07 v3 on-disk selected generation');
  assert.deepEqual(diskCluster.baselineSupersessions,TRANSITIONS,'C07 v3 on-disk exact transitions');
  const pkg=JSON.parse(safeBytes(root,PACKAGE)),oldPkg=JSON.parse(safeBytes(root,ORIGINAL_PACKAGE_PATH));
  assert.equal(pkg.scripts['test:c07:v3'],PACKAGE_COMMAND,'C07 v3 exact current graded command');
  const expectedPackage={...oldPkg,scripts:{...oldPkg.scripts,'test:c07:v3':PACKAGE_COMMAND}};
  assert.deepEqual(pkg,expectedPackage,'C07 v3 package changed outside one added script');
  const rootPackage=JSON.parse(safeBytes(root,'package.json'));
  assert.equal(rootPackage.engines.node,'>=22');
  assert.match(rootPackage.scripts.test,/node --test tests\/\*\.test\.mjs/u);
  assert.equal(proposal.successor.dependencyMapSha256,MAP_SHA256);assert.equal(proposal.successor.dependencyCount,MAP_COUNT);
  assert.equal(proposal.selection.currentCommand,SELECTION.currentCommand);
  return Object.freeze({currentVersion:3,historicalVersion:1,dependencyMapSha256:MAP_SHA256,
    dependencyTransitions:C07_BASELINE_DEPENDENCY_TRANSITIONS,allowedPaths:ALLOWED_PATHS,
    packetAcceptCommand:SELECTION.currentCommand,ownerAcceptanceEstablished:false,nativeOrDispatchAuthorized:false});
}
