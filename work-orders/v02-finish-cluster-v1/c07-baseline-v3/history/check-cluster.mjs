// Read-only packet inventory check. Does not lint, execute accepts or dispatch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertC06Acceptance } from './check-c06.mjs';
import { assertC07Acceptance, C07_DEPENDENCY_SUPERSESSION, assertHistoryHardening } from './check-c07.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)), root=path.resolve(here,'../..');
const c=JSON.parse(fs.readFileSync(path.join(here,'cluster.json'),'utf8'));
assert.equal(c.schema,'nisi.v02.packet-cluster.v1');
assert.equal(c.private,true); assert.equal(c.publicationAuthorized,false);
const c01Accepted=c.packets?.find(p=>p.id==='C01')?.implementationAccepted===true;
const c02Accepted=c.packets?.find(p=>p.id==='C02')?.implementationAccepted===true;
const c03Accepted=c.packets?.find(p=>p.id==='C03')?.implementationAccepted===true;
const c04Accepted=c.packets?.find(p=>p.id==='C04')?.implementationAccepted===true;
const c05Accepted=c.packets?.find(p=>p.id==='C05')?.implementationAccepted===true;
const c06Accepted=c.packets?.find(p=>p.id==='C06')?.implementationAccepted===true;
const c07Accepted=c.packets?.find(p=>p.id==='C07')?.implementationAccepted===true;
assert(!c02Accepted||c01Accepted,'C02 acceptance requires retained C01 acceptance');
assert(!c03Accepted||c02Accepted,'C03 acceptance requires retained C02 acceptance');
assert(!c04Accepted||c03Accepted,'C04 acceptance requires retained C03 acceptance');
assert(!c05Accepted||c04Accepted,'C05 acceptance requires retained C04 acceptance');
assert(!c06Accepted||c05Accepted,'C06 acceptance requires retained C05 acceptance');
assert(!c07Accepted||c06Accepted,'C07 acceptance requires retained C06 acceptance');
assert.equal(c.executionState,c07Accepted?'C01_C02_C03_C04_C05_C06_C07_NODE_IMPLEMENTATION_ACCEPTED':c06Accepted?'C01_C02_C03_C04_C05_C06_NODE_IMPLEMENTATION_ACCEPTED':c05Accepted?'C01_C02_C03_C04_C05_NODE_IMPLEMENTATION_ACCEPTED':c04Accepted?'C01_C02_C03_C04_NODE_IMPLEMENTATION_ACCEPTED':c03Accepted?'C01_C02_C03_NODE_IMPLEMENTATION_ACCEPTED':c02Accepted?'C01_C02_NODE_IMPLEMENTATION_ACCEPTED':c01Accepted?'C01_NODE_IMPLEMENTATION_ACCEPTED':'DISPATCH_APPROVED_C01','cluster accepted-state mismatch');
assert.equal(c.packets.length,10);
assert.equal(new Set(c.packets.map(p=>p.id)).size,10);
assert.equal(new Set(c.packets.map(p=>p.packet)).size,10);
assert.equal(c.packets.filter(p=>p.coauthor==='Fable 5.1').length,7);
assert.deepEqual(c.overallMilestones,{accepted:3,total:10,percent:30});
// NX milestones above are separate from finish-packet acceptance below.
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const historyDigest=assertHistoryHardening({root,cluster:c,sha});
// Check the complete C07 evidence before permitting its one live dependency
// transition in any older closure. All predecessor acceptance checks still run.
const c07Transition=c07Accepted&&assertC07Acceptance({root,cluster:c,sha})?C07_DEPENDENCY_SUPERSESSION:null;
const c07Dependency=(file,oldDigest,label)=>{
  const live=sha(fs.readFileSync(path.join(root,file)));
  if(c07Transition?.path===file){
    assert.equal(oldDigest,c07Transition.oldSha256,label+' historical transition: '+file);
    assert.equal(live,c07Transition.newSha256,label+' current transition: '+file);
  }else assert.equal(live,historyDigest(file,oldDigest),label+': '+file);
};
const evidencePath='.packet-diagnostics/c04-owner-review-1lSoKr/final-evidence.json';
const oldC03Evidence='.packet-diagnostics/c03-owner-review-ChO55Q/final-graded-gates.json';
const track='work-orders/parallel-seven-tracks-v1/track1/';
const shared=[track+'repository-fixture-runner.mjs',track+'repository-fixture-runner.test.mjs'];
const c05Scope='INERT_FIXTURE_INPUT_IMPORTS_NODE_ONLY';
const c05EvidencePath='.packet-diagnostics/c05-owner-review-PeEuLA/final-evidence.json';
const c05Files=[track+'repository-fixture-runner.mjs',track+'repository-fixture-runner.test.mjs',track+'fixture-write-guard.mjs',track+'findings-cluster-input-imports.test.mjs',track+'findings-cluster-cleanup.test.mjs'];
const c05Mutants=['ignored-extra-key','getter-before-validation','io-before-validation','null-prototype-rejected','source-buffer-not-copied','late-injection-read','undefined-callback-not-normalized','dynamic-import-missed','reexport-missed','import-equals-missed','computed-require-missed','process-binding-missed','socket-method-missed','dns-promise-method-missed'];
const c02Record=c.packets.find(p=>p.id==='C02')?.ownerAcceptance;
const c03Record=c.packets.find(p=>p.id==='C03')?.ownerAcceptance;
const c04Record=c.packets.find(p=>p.id==='C04')?.ownerAcceptance;
const c05Record=c.packets.find(p=>p.id==='C05')?.ownerAcceptance;
const c05Overlay=(file,oldDigest,label)=>{
  const live=sha(fs.readFileSync(path.join(root,file)));
  if(live===oldDigest)return;
  if(historyDigest(file,oldDigest)!==oldDigest){c07Dependency(file,oldDigest,label);return;}
  if(c07Transition?.path===file){c07Dependency(file,oldDigest,label);return;}
  if(!c05Accepted||!c05Files.includes(file)){assert.equal(live,oldDigest,label+': '+file); return;}
  const preserved=[c02Record,c03Record,c04Record].some(r=>r?.sourceHashes?.[file]===oldDigest);
  assert(preserved,'C05 overlay old digest is not in preserved CURRENT predecessor metadata: '+file);
  assert.equal(c05Record?.sourceHashes?.[file],live,'C05 overlay live source/evidence mismatch: '+file);
};
if(c04Accepted){
  const acceptance=c.packets[3].ownerAcceptance;
  assert.equal(c.packets[3].state,'NODE_IMPLEMENTATION_ACCEPTED','C04 accepted-state mismatch');
  assert.equal(acceptance?.scope,'INERT_FIXTURE_WRITE_GUARD_NODE_ONLY','C04 scope mismatch');
  assert.equal(acceptance.acceptedBy,'codex','C04 owner mismatch');
  assert.equal(acceptance.integrationRoute,'OWNER_IMPLEMENTATION_WITH_LUNA_TESTS_DAYBREAK_REVIEW','C04 provenance mismatch');
  for(const key of ['openCodeExecuted','nativeBuildAccepted','publicationAuthorized'])
    assert.equal(acceptance[key],false,'C04 forbidden credit: '+key);
  assert.equal(acceptance.evidence,evidencePath,'C04 evidence path mismatch');
  assert(fs.existsSync(path.join(root,evidencePath)),'C04 evidence missing');
  const raw=fs.readFileSync(path.join(root,evidencePath));
  assert.equal(sha(raw),acceptance.evidenceSha256,'C04 evidence digest mismatch');
  const evidence=JSON.parse(raw);
  assert.equal(evidence.schema,'nisi.c04.evidence-binding.v1','C04 evidence schema');
  assert.equal(evidence.scope,acceptance.scope,'C04 evidence scope');
  assert.deepEqual(evidence.sourceHashes,acceptance.sourceHashes,'C04 evidence/source mismatch');
  const reviewRef=evidence.review;
  assert.equal(reviewRef?.path,'.packet-diagnostics/c04-owner-review-1lSoKr/daybreak-c04-source-review.json','C04 review path');
  assert(fs.existsSync(path.join(root,reviewRef.path)),'C04 review evidence missing');
  const reviewBytes=fs.readFileSync(path.join(root,reviewRef.path));
  assert.equal(sha(reviewBytes),reviewRef.sha256,'C04 review digest mismatch');
  const review=JSON.parse(reviewBytes);
  assert.equal(review.schema,'nisi.c04.independent-source-review.v1','C04 review schema');
  assert.equal(review.reviewer?.modelRequested,'gpt-daybreak-blue-latest','C04 review identity');
  assert.equal(review.reviewer.reviewerTask,'/root/sharedchami_cleanup_daybreak_review','C04 review task identity');
  assert.equal(review.scope,acceptance.scope,'C04 review scope');
  assert.equal(review.verdict,'PASS','C04 review verdict');
  assert.deepEqual(review.sourceHashes,acceptance.sourceHashes,'C04 reviewed source mismatch');
  for(const key of ['openCodeExecuted','nativeBuildAccepted','publicationAuthorized'])
    assert.equal(evidence[key],false,'C04 evidence forbidden credit: '+key);
  const bound={};
  for(const [kind,suffix] of [['checkpoint','checkpoint-UdmDjm/checkpoint.json'],['mutations','mutations-BXckZW/mutation-results.json']]){
    const ref=evidence[kind];
    assert.equal(ref?.path,'.packet-diagnostics/c04-owner-review-1lSoKr/'+suffix,'C04 '+kind+' path mismatch');
    assert(fs.existsSync(path.join(root,ref.path)),'C04 '+kind+' evidence missing');
    const bytes=fs.readFileSync(path.join(root,ref.path));
    assert.equal(sha(bytes),ref.sha256,'C04 '+kind+' digest mismatch');
    bound[kind]=JSON.parse(bytes);
    assert.equal(bound[kind].unchanged,true,'C04 '+kind+' source changed');
    for(const [file,digest] of Object.entries(acceptance.sourceHashes))
      assert.equal(bound[kind].sourceHashes?.[file],digest,'C04 '+kind+' source mismatch');
  }
  for(const [name,count] of [['c04',95],['c03',82],['c02',35]]){
    const checks=bound.checkpoint.checks.filter(row=>row.name===name);
    assert.equal(checks.length,1,'C04 graded check inventory');
    const check=checks[0];
    assert.equal(check.ok,true,'C04 graded check failed');
    assert.equal(check.exitCode,0); assert.equal(check.error,null); assert.equal(check.signal,null);
    assert.deepEqual(check.counts,{tests:count,pass:count,fail:0,skipped:0,cancelled:0},'C04 graded counts');
  }
  assert.equal(bound.checkpoint.validationExitCode,0,'C04 Nisi validation failed');
  assert.equal(bound.checkpoint.validationError,null,'C04 Nisi validation error');
  assert.equal(bound.checkpoint.validationSignal,null,'C04 Nisi validation signal');
  assert.equal(bound.checkpoint.sourceInspected,true,'C04 source inspection missing');
  assert.equal(bound.checkpoint.inference,'NOT_RUN','C04 unexpected inference credit');
  assert.equal(bound.checkpoint.nativeAcceptance,false,'C04 unexpected native credit');
  assert.equal(bound.checkpoint.publicationAuthorized,false,'C04 unexpected publication credit');
  const results=bound.mutations.results;
  assert.equal(sha(fs.readFileSync(path.join(here,'package.json'))),bound.checkpoint.packageSha256,'C04 graded command drift');
  for(const [file,digest] of Object.entries(bound.mutations.sourceHashes)){
    assert(!path.isAbsolute(file)&&!file.split('/').includes('..')&&!file.includes('\\'),'C04 dependency path');
    assert.match(digest,/^[0-9a-f]{64}$/,'C04 dependency digest');
    assert(fs.existsSync(path.join(root,file)),'C04 dependency missing: '+file);
    c05Overlay(file,digest,'C04 dependency drift');
  }
  assert.equal(results.length,11,'C04 mutation result inventory');
  assert.equal(new Set(results.map(row=>row.name)).size,11,'C04 duplicate mutation results');
  assert.equal(results.filter(row=>row.expectedFailure===true).length,9,'C04 mutant count');
  assert.equal(results.filter(row=>row.expectedFailure===false).length,2,'C04 control count');
  const expectedMutants=['parent-report','parent-workspace','prevalidation-allocation','promise-open-bypass',
    'callback-family-bypass','symlink-ancestor-lexical','symlink-dotdot-js-realpath',
    'final-symlink-bypass','workspace-return-check-bypass'];
  assert.deepEqual(results.filter(row=>row.expectedFailure).map(row=>row.name).sort(),expectedMutants.sort(),'C04 semantic mutant inventory');
  assert.deepEqual(results.filter(row=>!row.expectedFailure).map(row=>row.name).sort(),['control-after','control-before'],'C04 semantic control inventory');
  for(const result of results){
    assert.equal(result.valid,true,'C04 invalid mutation');
    assert.equal(result.error,null); assert.equal(result.signal,null);
    assert.equal(result.skipped,0); assert.equal(result.cancelled,0);
    if(result.expectedFailure){
      assert.equal(result.exitCode,1); assert(result.fail>0&&result.assertionCount>0,'C04 missing assertion failure');
      assert.equal(result.invalidFailure,false,'C04 runtime failure is not mutant credit');
    }else{
      assert.equal(result.exitCode,0); assert.equal(result.tests,25); assert.equal(result.pass,25); assert.equal(result.fail,0);
    }
  }
  assert.deepEqual(Object.keys(acceptance.sourceHashes).sort(),[...c.packets[3].allowedFiles].sort(),'C04 source hash inventory');
  for(const [file,digest] of Object.entries(acceptance.sourceHashes))
    c05Overlay(file,digest,'accepted C04 source drift');
  assert.equal(c.acceptanceSupersessions?.length,c05Accepted?2:1,'C04 supersession history missing or changed');
  const history=c.acceptanceSupersessions[0];
  if(c05Accepted)assert.equal(sha(Buffer.from(JSON.stringify(history))),'ded3f73c737cb44a046cf1efcf65d2cb20702a5c83381227adf7e23345dd8395','C04 history[0] changed byte-for-byte');
  assert.equal(history.by,'C04','C04 supersession identity');
  assert.equal(history.scope,acceptance.scope,'C04 supersession scope');
  assert.equal(history.evidence,acceptance.evidence,'C04 supersession evidence');
  assert.deepEqual(Object.keys(history.previousAcceptances??{}).sort(),['C02','C03'],'C04 predecessor inventory');
  for(const [id,index] of [['C02',1],['C03',2]]){
    const previous=history.previousAcceptances[id],current=c.packets[index].ownerAcceptance;
    assert.equal(previous.evidence,oldC03Evidence,'C04 predecessor evidence changed');
    assert.equal(current.evidence,acceptance.evidence,'C04 current evidence mismatch');
    assert.equal(previous.sourceHashes?.[shared[0]],'4e890614183b8a0cdd1ea6171907a1587f5f39b6f6d8d335221a99189b9e2c26','C03 historical runner mismatch');
    assert.equal(previous.sourceHashes?.[shared[1]],'72a8e7f474bb5ec6a13342bf1181d29b2852143a1dafd187f535d03ae89bdddc','C03 historical oracle mismatch');
    const expected={...previous, evidence:acceptance.evidence,sourceHashes:{...previous.sourceHashes}};
    for(const file of shared){
      expected.sourceHashes[file]=acceptance.sourceHashes[file];
      assert.equal(current.sourceHashes?.[file],acceptance.sourceHashes[file],'C04 shared source mismatch');
    }
    assert.deepEqual(current,expected,'C04 predecessor metadata or unrelated sources changed');
  }
}else assert.equal(c.acceptanceSupersessions,undefined,'C04 supersession without acceptance');
if(c05Accepted){
  const acceptance=c05Record;
  assert.equal(c.packets[4].state,'NODE_IMPLEMENTATION_ACCEPTED','C05 accepted-state mismatch');
  assert.equal(acceptance?.scope,c05Scope,'C05 scope mismatch');
  assert.equal(acceptance.acceptedBy,'codex','C05 owner mismatch');
  assert.equal(acceptance.integrationRoute,'OWNER_IMPLEMENTATION_WITH_LUNA_TESTS_DAYBREAK_REVIEW','C05 provenance mismatch');
  for(const key of ['openCodeExecuted','nativeBuildAccepted','publicationAuthorized'])assert.equal(acceptance[key],false,'C05 forbidden credit: '+key);
  assert.equal(acceptance.evidence,c05EvidencePath,'C05 evidence path mismatch');
  assert(fs.existsSync(path.join(root,c05EvidencePath)),'C05 evidence missing');
  const raw=fs.readFileSync(path.join(root,c05EvidencePath));
  assert.equal(sha(raw),acceptance.evidenceSha256,'C05 evidence digest mismatch');
  const evidence=JSON.parse(raw);
  assert.equal(evidence.schema,'nisi.c05.evidence-binding.v1','C05 evidence schema');
  assert.equal(evidence.scope,c05Scope,'C05 evidence scope');
  assert.equal(evidence.packet?.path,'.packets/nisi-v02-c05-fixture-input-imports.packet.md','C05 packet path');
  assert.equal(evidence.packet.normalization,'PROJECT_ROOT_PLACEHOLDER_V1','C05 packet normalization');
  assert(fs.existsSync(path.join(root,evidence.packet.path)),'C05 packet missing');
  const packetText=fs.readFileSync(path.join(root,evidence.packet.path),'utf8');
  assert.equal(sha(packetText.replace(/^project_root: .+$/m,'project_root: <PROJECT_ROOT>')),evidence.packet.sha256,'C05 packet digest mismatch');
  assert.equal(evidence.packet.sha256,'761abe6e180c3c95b86f852accb70d3443adb84e7e3fe0d2841110d6bc0a18cf','C05 reviewed packet contract changed');
  assert.deepEqual(c.packets[4].allowedFiles.slice().sort(),c05Files.slice().sort(),'C05 five-file scope mismatch');
  assert.deepEqual(Object.keys(acceptance.sourceHashes).sort(),c05Files.slice().sort(),'C05 source hash inventory');
  assert.deepEqual(evidence.sourceHashes,acceptance.sourceHashes,'C05 evidence/source mismatch');
  for(const file of c05Files){
    assert.match(acceptance.sourceHashes[file],/^[0-9a-f]{64}$/);
    assert.equal(sha(fs.readFileSync(path.join(root,file))),acceptance.sourceHashes[file],'accepted C05 source drift: '+file);
  }
  for(const key of ['openCodeExecuted','nativeBuildAccepted','publicationAuthorized'])assert.equal(evidence[key],false,'C05 evidence forbidden credit: '+key);
  assert.equal(evidence.implementationAccepted,false,'C05 subordinate evidence self-authorized');
  const bound={};
  for(const [kind,suffix] of [['checkpoint','checks-LmiUMS/checks.json'],['mutations','mutations-KQ7IzR/mutation-results.json']]){
    const ref=evidence[kind];
    assert.equal(ref?.path,'.packet-diagnostics/c05-owner-review-PeEuLA/'+suffix,'C05 '+kind+' path mismatch');
    assert(fs.existsSync(path.join(root,ref.path)),'C05 '+kind+' evidence missing');
    const bytes=fs.readFileSync(path.join(root,ref.path));
    assert.equal(sha(bytes),ref.sha256,'C05 '+kind+' digest mismatch');
    bound[kind]=JSON.parse(bytes);
    assert.equal(bound[kind].unchanged,true,'C05 '+kind+' source changed');
    assert.equal(bound[kind].implementationAccepted,false,'C05 '+kind+' self-authorized acceptance');
    assert.equal(bound[kind].nativeAcceptance,false,'C05 '+kind+' native authority');
    assert.equal(bound[kind].publicationAuthorized,false,'C05 '+kind+' publication authority');
    assert.equal(bound[kind].inference,'NOT_RUN','C05 '+kind+' inference credit');
    for(const [file,digest] of Object.entries(acceptance.sourceHashes))assert.equal(bound[kind].sourceHashes?.[file],digest,'C05 '+kind+' source mismatch');
  }
  assert.equal(bound.mutations.checkpointSha256,evidence.checkpoint.sha256,'C05 mutation checkpoint binding');
  assert.deepEqual(bound.mutations.sourceHashes,bound.checkpoint.sourceHashes,'C05 mutation dependency binding');
  assert.equal(sha(fs.readFileSync(path.join(here,'package.json'))),bound.checkpoint.packageSha256,'C05 graded command drift');
  for(const [file,digest] of Object.entries(bound.checkpoint.sourceHashes)){
    assert(!path.isAbsolute(file)&&!file.split('/').includes('..')&&!file.includes('\\'),'C05 dependency path');
    assert.match(digest,/^[0-9a-f]{64}$/,'C05 dependency digest');
    assert(fs.existsSync(path.join(root,file)),'C05 dependency missing: '+file);
    c07Dependency(file,digest,'C05 dependency drift');
  }
  for(const [name,count] of [['c05',111],['c04',95],['c03',82],['c02',35]]){
    const rows=bound.checkpoint.checks.filter(row=>row.name===name);
    assert.equal(rows.length,1,'C05 graded check inventory');
    const check=rows[0];
    assert.equal(check.ok,true,'C05 graded check failed');
    assert.equal(check.exitCode,0); assert.equal(check.error,null); assert.equal(check.signal,null);
    assert.deepEqual(check.counts,{tests:count,pass:count,fail:0,skipped:0,cancelled:0},'C05 graded counts');
  }
  assert.equal(bound.checkpoint.validation?.exitCode,0,'C05 Nisi validation failed');
  assert.equal(bound.checkpoint.validation?.error,null,'C05 Nisi validation error');
  assert.equal(bound.checkpoint.validation?.signal,null,'C05 Nisi validation signal');
  assert.equal(bound.checkpoint.sourceInspected,true,'C05 source inspection missing');
  assert.equal(bound.checkpoint.inference,'NOT_RUN','C05 unexpected inference credit');
  assert.equal(bound.checkpoint.nativeAcceptance,false,'C05 unexpected native credit');
  assert.equal(bound.checkpoint.publicationAuthorized,false,'C05 unexpected publication credit');
  const validation=evidence.validation;
  assert.equal(validation?.status,'VALIDATED','C05 Nisi validation status');
  assert.equal(validation.path,'.packet-diagnostics/c05-owner-review-PeEuLA/checks-LmiUMS/nisi-validation.log','C05 Nisi validation path');
  assert.equal(bound.checkpoint.validation.logSha256,validation.sha256,'C05 Nisi validation checkpoint binding');
  assert(fs.existsSync(path.join(root,validation.path)),'C05 Nisi validation evidence missing');
  const validationBytes=fs.readFileSync(path.join(root,validation.path));
  assert.equal(sha(validationBytes),validation.sha256,'C05 Nisi validation digest mismatch');
  const validationRecord=JSON.parse(validationBytes);
  assert.equal(validationRecord.kind,'nisi.scratch-validation.v1','C05 Nisi validation schema');
  assert.equal(validationRecord.status,'VALIDATED','C05 Nisi validation status');
  assert.equal(validationRecord.advisoryOnly,true,'C05 Nisi validation authority');
  assert.equal(validationRecord.accepted,false,'C05 Nisi validation accepted flag');
  assert.equal(validationRecord.authorizing,false,'C05 Nisi validation authorizing flag');
  assert.equal(validationRecord.checks?.contract?.status,'PASS','C05 Nisi contract validation');
  assert.equal(validationRecord.checks?.syntax?.status,'PASS','C05 Nisi syntax validation');
  assert.deepEqual(validationRecord.checks.syntax.checkedFiles.map(row=>row.path).sort(),c05Files.slice().sort(),'C05 Nisi syntax file inventory');
  assert(validationRecord.checks.syntax.checkedFiles.every(row=>row.status==='PASS'&&row.evidence?.exitCode===0&&row.evidence?.signal===null&&row.evidence?.timedOut===false&&row.evidence?.outputExceeded===false),'C05 Nisi syntax check evidence');
  assert.equal(validationRecord.checks.tests?.status,'NOT_RUN','C05 Nisi tests must remain unrun');
  assert.deepEqual(validationRecord.binding,validation.binding,'C05 Nisi binding changed');
  assert(validation.binding?.taskFingerprint&&validation.binding?.candidateFingerprint,'C05 Nisi fingerprints missing');
  assert.equal(validation.binding.reviewedCandidateSha256,null,'C05 Nisi candidate binding');
  assert.equal(validation.binding.reviewBindingMatches,false,'C05 Nisi review flag changed');
  const results=bound.mutations.results;
  assert.equal(results.length,16,'C05 mutation result inventory');
  assert.equal(new Set(results.map(row=>row.name)).size,16,'C05 duplicate mutation results');
  assert.deepEqual(results.filter(row=>row.name==='control-before'||row.name==='control-after').map(row=>row.name).sort(),['control-after','control-before'],'C05 semantic control inventory');
  assert.deepEqual(results.filter(row=>c05Mutants.includes(row.name)).map(row=>row.name).sort(),c05Mutants.slice().sort(),'C05 semantic mutant inventory');
  for(const result of results){
    assert.equal(result.error,null,'C05 mutation runtime error');
    assert.equal(result.signal,null,'C05 mutation signal');
    assert.equal(result.ok,true,'C05 mutation result not valid');
    assert.equal(result.semanticOnly,true,'C05 mutation not semantic-only');
    assert.equal(result.counts?.tests,16,'C05 mutation count');
    assert.equal(result.counts?.skipped,0,'C05 mutation skipped');
    assert.equal(result.counts?.cancelled,0,'C05 mutation cancelled');
    if(result.name==='control-before'||result.name==='control-after'){
      assert.equal(result.exitCode,0);
      assert.deepEqual(result.counts,{tests:16,pass:16,fail:0,skipped:0,cancelled:0},'C05 control counts');
      assert.equal(result.assertionFailures,0);
      assert.equal(result.file,null,'C05 control source');
      assert.equal(result.originalSha256,null,'C05 control original');
      assert.equal(result.mutatedSha256,null,'C05 control mutation');
    }else{
      assert.equal(result.exitCode,1);
      assert.equal(result.counts.fail>0,true,'C05 mutant did not fail tests');
      assert(Number.isInteger(result.assertionFailures)&&result.assertionFailures>0,'C05 missing assertion failure');
      assert.equal(result.assertionFailures,result.counts.fail,'C05 semantic assertion count');
      assert.equal(result.counts.pass+result.counts.fail,16,'C05 mutation counts');
      assert(c05Files.includes(result.file),'C05 mutant source inventory');
      assert.equal(result.originalSha256,acceptance.sourceHashes[result.file],'C05 mutant original source');
      assert.match(result.mutatedSha256,/^[0-9a-f]{64}$/,'C05 mutant changed source');
      assert.notEqual(result.mutatedSha256,result.originalSha256,'C05 mutant unchanged source');
    }
  }
  const reviewRef=evidence.review;
  assert.equal(reviewRef?.path,'.packet-diagnostics/c05-owner-review-PeEuLA/daybreak-c05-source-review.json','C05 review path');
  assert(fs.existsSync(path.join(root,reviewRef.path)),'C05 review evidence missing');
  const reviewBytes=fs.readFileSync(path.join(root,reviewRef.path));
  assert.equal(sha(reviewBytes),reviewRef.sha256,'C05 review digest mismatch');
  const review=JSON.parse(reviewBytes);
  assert.equal(review.schema,'nisi.c05.independent-source-review.v1','C05 review schema');
  assert.equal(review.reviewer?.modelRequested,'gpt-daybreak-blue-latest','C05 review identity');
  assert.equal(review.reviewer.modelActuallyServed,'UNKNOWN','C05 review served identity unestablished');
  assert.equal(review.reviewer.reviewerTask,'/root/sharedchami_cleanup_daybreak_review','C05 review task identity');
  assert.equal(review.scope,c05Scope,'C05 review scope');
  assert.equal(review.verdict,'PASS','C05 review verdict');
  assert.deepEqual(review.sourceHashes,acceptance.sourceHashes,'C05 reviewed source mismatch');
  for(const key of ['implementationAccepted','nativeBuildAccepted','publicationAuthorized'])assert.equal(review[key],false,'C05 review authority: '+key);
  const expectedPrevious={C02:c02Record,C03:c03Record,C04:c04Record};
  assert.equal(c.acceptanceSupersessions.length,2,'C05 supersession append count');
  const history=c.acceptanceSupersessions[0],c05History=c.acceptanceSupersessions[1];
  assert.equal(history.by,'C04','C04 history retained');
  assert.equal(c05History.by,'C05','C05 supersession identity');
  assert.equal(c05History.scope,c05Scope,'C05 supersession scope');
  assert.equal(c05History.evidence,c05EvidencePath,'C05 supersession evidence');
  assert.deepEqual(c05History.previousAcceptances,expectedPrevious,'C05 current predecessor metadata changed');
}else assert.equal(c.packets[4].ownerAcceptance,undefined,'C05 owner acceptance without implementation acceptance');

if(c06Accepted) assertC06Acceptance({root,cluster:c,sha});
else assert.equal(c.packets[5].ownerAcceptance,undefined,'C06 owner acceptance without implementation acceptance');
if(!c07Accepted){
  assert.equal(c.packets[6].ownerAcceptance,undefined,'C07 owner acceptance without implementation acceptance');
  assert.equal(c.dependencySupersessions,undefined,'C07 dependency supersession without acceptance');
}
const seen=new Set();
for(const [i,p] of c.packets.entries()){
  assert.equal(p.id,'C'+String(i+1).padStart(2,'0'));
  for(const d of p.dependencies)assert(seen.has(d),'dependency must precede '+p.id);
  seen.add(p.id);
  for(const f of [...p.allowedFiles,...p.readOnlySources]){
    assert(!path.isAbsolute(f)&&!f.split('/').includes('..')&&!f.includes('\\'),'relative path');
  }
  if(p.id==='C03'&&c03Accepted){
    assert.equal(p.state,'NODE_IMPLEMENTATION_ACCEPTED','C03 accepted-state mismatch');
    const acceptance=p.ownerAcceptance;
    assert.equal(acceptance?.scope,'INERT_FIXTURE_CLEANUP_NODE_ONLY','C03 scope mismatch');
    assert.equal(acceptance.acceptedBy,'codex','C03 owner mismatch');
    assert.equal(acceptance.integrationRoute,'FABLE_DRAFT_WITH_OWNER_CORRECTION','C03 provenance mismatch');
    assert.equal(acceptance.openCodeExecuted,false,'C03 OpenCode execution not established');
    assert.equal(acceptance.nativeBuildAccepted,false,'C03 native acceptance forbidden');
    assert.equal(acceptance.publicationAuthorized,false,'C03 publication forbidden');
    assert.deepEqual(Object.keys(acceptance.sourceHashes).sort(),[...p.allowedFiles].sort(),'C03 source hash inventory');
    for(const file of p.allowedFiles){
      assert.match(acceptance.sourceHashes[file],/^[0-9a-f]{64}$/);
      c05Overlay(file,acceptance.sourceHashes[file],'accepted C03 source drift');
    }
    const prior=c.packets.find(row=>row.id==='C02').ownerAcceptance;
    const history=prior.revalidation;
    assert.equal(history?.by,'C03','C03 requires C02 revalidation history');
    assert.equal(history.previousEvidence,'.packet-diagnostics/c02-owner-review-tfKOcX/final-graded-gates.json','C02 original evidence must remain identified');
    assert.equal(prior.evidence,acceptance.evidence,'C02/C03 revalidation evidence mismatch');
    assert.deepEqual(Object.keys(history.previousSourceHashes).sort(),Object.keys(prior.sourceHashes).sort(),'C02 historical source inventory');
    for(const [file,digest] of Object.entries(history.previousSourceHashes)){
      assert.match(digest,/^[0-9a-f]{64}$/);
      if(Object.hasOwn(acceptance.sourceHashes,file)) assert.equal(prior.sourceHashes[file],acceptance.sourceHashes[file],'C02/C03 shared source mismatch');
      else assert.equal(prior.sourceHashes[file],digest,'unrelated C02 source changed');
    }
    assert.equal(history.previousSourceHashes['work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.mjs'],'07020b778c9bb59b1ea354246977eb67a8854063c913c74888f1d9f525510ddb','C02 historical runner mismatch');
    assert.equal(history.previousSourceHashes['work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.test.mjs'],'f5e2886261ef4af77e08c6f7ff54d142aac7e03d64fde2fe92ba29d92958b119','C02 historical oracle mismatch');
  }
  assert(p.allowedFiles.every(f=>!f.startsWith('integrations/')&&!f.startsWith('.packets/')&&!['roadmap.md','package.json'].includes(f)));
  for(const f of p.readOnlySources)assert(fs.existsSync(path.join(root,f)),'missing reference '+f);
  const t=fs.readFileSync(path.join(root,p.packet),'utf8');
  assert(t.startsWith('---\npacket: '));
  assert(t.includes('\nproject_root: '+root+'\n'));
  const expectedStatus = p.id === 'C01' ? 'ready' : 'blocked';
  assert(t.includes('\nstatus: '+expectedStatus+'\n'));
  assert(t.includes('\nwrite_owner: opencode\n'));
  if((p.id==='C05'&&c05Accepted)||(p.id==='C06'&&c06Accepted)||(p.id==='C07'&&c07Accepted)){
    const packetFiles=[...new Set([...t.matchAll(/^- \*\*files\*\*: (.+)$/gm)].flatMap(match=>match[1].split(',').map(file=>file.trim())))];
    assert.deepEqual(packetFiles.sort(),p.allowedFiles.slice().sort(),p.id+' packet file inventory');
  }
  if (p.id === 'C01') {
    assert.equal(p.state, c01Accepted?'NODE_IMPLEMENTATION_ACCEPTED':'READY','C01 accepted-state mismatch');
    assert(p.ownerRelease && /^[0-9a-f]{64}$/.test(p.ownerRelease.contractSha256));
    assert(/^[0-9a-f]{64}$/.test(p.ownerRelease.oracleSha256));
    assert.equal(p.ownerRelease.writeOwner, 'opencode');
    if(c01Accepted){
      const acceptance=p.ownerAcceptance;
      assert.equal(acceptance?.scope,'TRUSTED_LOCAL_CHECKOUT_NODE_ONLY');
      assert.equal(acceptance.acceptedBy,'codex');
      assert.equal(acceptance.candidateRevision,4);
      assert.equal(acceptance.nativeBuildAccepted,false,'C01 native acceptance forbidden');
      assert.equal(acceptance.publicationAuthorized,false,'C01 publication forbidden');
      assert.deepEqual(Object.keys(acceptance.sourceHashes).sort(),[...p.allowedFiles].sort(),'C01 source hash inventory');
      for(const file of p.allowedFiles){
        assert.match(acceptance.sourceHashes[file],/^[0-9a-f]{64}$/);
        assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),
          acceptance.sourceHashes[file],'accepted C01 source drift: '+file);
      }
    }
  }
  if(p.id==='C02'&&c02Accepted){
    assert.equal(p.state,'NODE_IMPLEMENTATION_ACCEPTED','C02 accepted-state mismatch');
    const acceptance=p.ownerAcceptance;
    assert.equal(acceptance?.scope,'INERT_FIXTURE_RECEIPT_NODE_ONLY','C02 scope mismatch');
    assert.equal(acceptance.acceptedBy,'codex','C02 owner mismatch');
    assert.equal(acceptance.integrationRoute,'FABLE_DRAFT_WITH_OWNER_CORRECTION','C02 provenance mismatch');
    assert.equal(acceptance.openCodeExecuted,false,'C02 OpenCode execution not established');
    assert.equal(acceptance.nativeBuildAccepted,false,'C02 native acceptance forbidden');
    assert.equal(acceptance.publicationAuthorized,false,'C02 publication forbidden');
    assert.deepEqual(Object.keys(acceptance.sourceHashes).sort(),[...p.allowedFiles].sort(),'C02 source hash inventory');
    for(const file of p.allowedFiles){
      assert.match(acceptance.sourceHashes[file],/^[0-9a-f]{64}$/);
      c05Overlay(file,acceptance.sourceHashes[file],'accepted C02 source drift');
    }
  }
  for(const section of ['## Context','## Constraints','## Items','## Packet acceptance','## Owner release checklist'])assert(t.includes(section));
  const accepts=[...t.matchAll(/^- \*\*accept\*\*: (.+)$/gm)].map(m=>m[1]);
  assert.equal(accepts.length,2);
  for(const cmd of accepts){assert(!/[;&|\x60<>\n]|\$\(/.test(cmd));assert(/^(node --check |npm run test:)/.test(cmd));}
  assert(t.includes('npm run test:dispatch --prefix work-orders/v02-finish-cluster-v1 -- '+p.id));
  assert.equal(p.implementationAccepted,p.id==='C01'?c01Accepted:p.id==='C02'?c02Accepted:p.id==='C03'?c03Accepted:p.id==='C04'?c04Accepted:p.id==='C05'?c05Accepted:p.id==='C06'?c06Accepted:p.id==='C07'?c07Accepted:false);
}
console.log(JSON.stringify({status:'PASS_PACKET_INVENTORY_ONLY',authored:10,
  fableAssignments:7,released:['C01'],executedByThisCheck:0,implementationAccepted:Number(c01Accepted)+Number(c02Accepted)+Number(c03Accepted)+Number(c04Accepted)+Number(c05Accepted)+Number(c06Accepted)+Number(c07Accepted),
  fixtureReceiptAccepted:c02Accepted,
  fixtureCleanupAccepted:c03Accepted,
  fixtureContainmentAccepted:c04Accepted,fixtureInputImportsAccepted:c05Accepted,
  hostObservationAccepted:c06Accepted,nativeIncidentBindingAccepted:c07Accepted,
  finishPacketPercent:10*(Number(c01Accepted)+Number(c02Accepted)+Number(c03Accepted)+Number(c04Accepted)+Number(c05Accepted)+Number(c06Accepted)+Number(c07Accepted)),
  acceptedScopes:c.packets.filter(p=>p.implementationAccepted).map(p=>({id:p.id,scope:p.ownerAcceptance.scope})),
  acceptanceScope:c01Accepted?'TRUSTED_LOCAL_CHECKOUT_NODE_ONLY':null,nativeBuildAccepted:false,
  overallMilestonePercent:30,dispatchApproved:c01Accepted?[]:['C01']}));
