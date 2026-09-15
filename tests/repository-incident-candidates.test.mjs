// Real repository identity/readers with synthetic Swift and Node process observations.
// These fixtures do not establish native execution or independent incident evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {stableStringify,sha256Text} from '../workflow/contracts.mjs';
import {createRepositoryIncidentPreviewV1} from '../history/repository-incident-candidates-v1.mjs';
import {createRepositoryRunBundleV1,readRepositoryRunBundleV1} from '../receipts/repository-run-v1.mjs';
import {createRepositoryWorkflowOwnerV1} from '../hosts/repository/reviewed-workflow-v1.mjs';
import {issuedSwiftChecksV1} from '../hosts/swift-verifier/check-plan-v1.mjs';
import {context} from './helpers/node-repository-fixture.mjs';
import {combinedFixture,fixedOptions} from './helpers/repository-run-fixture.mjs';
import {incidentStorageFailureFixture,mixedStaticOperationalFixture} from './helpers/incident-candidate-fixture.mjs';

const ENVELOPE_KEYS=['schemaVersion','status','reason','reportSha256','bundleFingerprint','rows','sha256','sourceTrust','freshness','persistable','learningEligible','authorizing'];
const ROW_KEYS=['schemaVersion','rowId','occurrenceGroupId','familyId','binding','stageIndex','classification','reason','rawStatus','stageStatus','disposition','source','subject','failureCodes','sourceTrust','persistable','executionVerified','learningEligible','independentOccurrence','authorizing','certificationGranted','fingerprint'];
const BINDING_KEYS=['runId','taskFingerprint','baselineFingerprint','attempt','stage','checkIndex','candidateFingerprint','subjectKey'];
const SOURCE_KEYS=['reportSha256','bundleFingerprint','planFingerprint','groupFingerprint','expectationFingerprint','profileFingerprint','verifierSourceSha256','verifierBuildSha256','executableSha256','rulesetSha256','preparationFingerprint','materializedFingerprint','receiptSha256','evidenceSha256'];
const SUBJECT_KEYS=['kind','pathSha256','contentSha256'];
const DOMAIN='nisi/repository-incident-preview/v1';
const h=(domain,value)=>sha256Text(domain+'\0'+stableStringify(value));
const rehash=b=>{const {fingerprint,...body}=b;return{...body,fingerprint:h('nisi/repository-run/v1',body)};};
const project=async t=>{const fixture=await combinedFixture(t),bundle=createRepositoryRunBundleV1(fixture.context);return{fixture,bundle,preview:createRepositoryIncidentPreviewV1({bundle,context:fixture.context})};};
function assertFrozen(value,seen=new Set()){if(value&&typeof value==='object'&&!seen.has(value)){seen.add(value);assert.equal(Object.isFrozen(value),true);for(const v of Object.values(value))assertFrozen(v,seen);}}
function assertPreview(p){assert.deepEqual(Object.keys(p).sort(),[...ENVELOPE_KEYS].sort());assert.equal(p.schemaVersion,'nisi-repository-incident-preview/v1');assert.equal(p.status,'PREVIEW');assert.equal(p.reason,null);assert.match(p.reportSha256,/^[a-f0-9]{64}$/);assert.match(p.bundleFingerprint,/^[a-f0-9]{64}$/);assert.equal(p.sourceTrust,'TRUSTED_HOST_STATEMENTS_NOT_ATTESTED');assert.equal(p.freshness,'SETTLED_SNAPSHOT_ONLY');for(const k of ['persistable','learningEligible','authorizing'])assert.equal(p[k],false);const{sha256,...body}=p;assert.equal(sha256,h(DOMAIN,body));assertFrozen(p);}
function assertRow(r){assert.deepEqual(Object.keys(r).sort(),[...ROW_KEYS].sort());assert.deepEqual(Object.keys(r.binding).sort(),[...BINDING_KEYS].sort());assert.deepEqual(Object.keys(r.source).sort(),[...SOURCE_KEYS].sort());assert.deepEqual(Object.keys(r.subject).sort(),[...SUBJECT_KEYS].sort());assert.equal(r.schemaVersion,'nisi-repository-incident-row/v1');assert.equal(r.sourceTrust,'TRUSTED_HOST_STATEMENTS_NOT_ATTESTED');for(const k of ['persistable','executionVerified','learningEligible','independentOccurrence','authorizing','certificationGranted'])assert.equal(r[k],false);const{fingerprint,...body}=r;assert.equal(fingerprint,h('nisi/repository-incident-row/v1',body));assert.equal(r.rowId,h('nisi/repository-incident-row-id/v1',r.binding));assert.deepEqual(r.failureCodes,[...new Set(r.failureCodes)].sort());assertFrozen(r);}

test('failing then passing Node repair emits both attempts in report order',async t=>{const{fixture,preview}=await project(t);assertPreview(preview);const node=preview.rows.filter(r=>r.binding.stage==='tests');assert.equal(fixture.context.report.outcome,'COMPLETED');assert.deepEqual(node.map(r=>[r.binding.attempt,r.classification,r.reason,r.rawStatus]),[[0,'FAILURE_CANDIDATE','RECORDED_FAILURE','FAIL'],[1,'PASS','RECORDED_PASS','PASS']]);assert.ok(node[0].stageIndex<node[1].stageIndex);preview.rows.forEach(assertRow);});

test('repair attempts have distinct row identity but share run-family occurrence group',async t=>{const{preview}=await project(t),rows=preview.rows.filter(r=>r.binding.stage==='tests');assert.equal(rows.length,2);assert.notEqual(rows[0].rowId,rows[1].rowId);assert.equal(rows[0].familyId,rows[1].familyId);assert.equal(rows[0].occurrenceGroupId,rows[1].occurrenceGroupId);assert.notEqual(rows[0].binding.candidateFingerprint,rows[1].binding.candidateFingerprint);});

test('occurrence group and family domains match the closed definitions',async t=>{const{fixture,preview}=await project(t);for(const r of preview.rows){const b=r.binding;let profile;if(b.stage==='tests')profile=fixture.context.executions.find(x=>x.expected.binding.attempt===b.attempt).expected.profile;else{const plan=fixture.context.plans.find(x=>x.binding.attempt===b.attempt);profile=issuedSwiftChecksV1(plan)[b.checkIndex].expected.profile;}assert.equal(r.familyId,h('nisi/repository-incident-family/v1',{stage:b.stage,profileId:profile.id,profileVersion:profile.version,rulesetSha256:profile.rulesetSha256}));assert.equal(r.occurrenceGroupId,h('nisi/repository-incident-occurrence/v1',{taskFingerprint:b.taskFingerprint,baselineFingerprint:b.baselineFingerprint,runId:b.runId,familyId:r.familyId}));}});

test('static deterministic failure emits candidates and does not invent an unissued Node row',async t=>{const fixture=await combinedFixture(t,{staticOnly:true}),bundle=createRepositoryRunBundleV1(fixture.context),p=createRepositoryIncidentPreviewV1({bundle,context:fixture.context});assertPreview(p);assert.ok(p.rows.some(r=>r.binding.stage==='staticChecks'&&r.classification==='FAILURE_CANDIDATE'&&r.rawStatus==='FAIL'));assert.equal(p.rows.some(r=>r.binding.stage==='tests'),false);});

test('completed and report-store-failed repaired runs preserve every earlier failure row',async t=>{for(const f of [await combinedFixture(t),await incidentStorageFailureFixture(t)]){const b=createRepositoryRunBundleV1(f.context),p=createRepositoryIncidentPreviewV1({bundle:b,context:f.context});assert.ok(p.rows.some(r=>r.classification==='FAILURE_CANDIDATE'));assert.ok(p.rows.some(r=>r.classification==='PASS'));if(f.context.reportStoreFailureExpected){assert.equal(f.context.report.workflowOutcome,'COMPLETED');assert.equal(f.context.report.outcome,'BLOCKED');}}});

test('raw static FAIL in an unavailable mixed group stays operational with closed codes',async t=>{const f=await mixedStaticOperationalFixture(t),p=createRepositoryIncidentPreviewV1({bundle:createRepositoryRunBundleV1(f.context),context:f.context}),row=p.rows.find(r=>r.binding.stage==='staticChecks'&&r.rawStatus==='FAIL');assert.ok(row);assert.equal(row.stageStatus,'UNAVAILABLE');assert.equal(row.classification,'OPERATIONAL');assert.equal(row.reason,'STAGE_UNAVAILABLE');assert.ok(row.failureCodes.length>0);});

test('outer host failure and unavailable stages are operational, never failure candidates',async t=>{const f=await combinedFixture(t,{outerFailure:true}),p=createRepositoryIncidentPreviewV1({bundle:createRepositoryRunBundleV1(f.context),context:f.context});const affected=p.rows.filter(r=>r.stageStatus==='UNAVAILABLE');assert.ok(affected.length>0);for(const r of affected){assert.equal(r.classification,'OPERATIONAL');assert.equal(r.reason,'STAGE_UNAVAILABLE');}assert.ok(affected.some(r=>r.rawStatus==='PASS'));});

test('engine interruption wins over a late raw PASS',async t=>{for(const interrupt of ['abort','deadline']){const f=await combinedFixture(t,{interrupt}),p=createRepositoryIncidentPreviewV1({bundle:createRepositoryRunBundleV1(f.context),context:f.context});const row=p.rows.find(r=>r.binding.stage==='tests');assert.equal(row.disposition,'ENGINE_INTERRUPTED');assert.equal(row.rawStatus,'PASS');assert.equal(row.classification,'INTERRUPTED');assert.equal(row.reason,'ENGINE_INTERRUPTED');}});

test('Node suite rows describe the materialized tree and never invent a file subject',async t=>{const{fixture,preview}=await project(t);for(const r of preview.rows.filter(r=>r.binding.stage==='tests')){assert.deepEqual({...r.subject},{kind:'MATERIALIZED_TREE',pathSha256:null,contentSha256:null});assert.equal(r.binding.subjectKey,h('nisi/repository-incident-suite/v1',fixture.context.suite.fingerprint));assert.equal(r.source.planFingerprint,null);assert.equal(r.source.groupFingerprint,null);}});

test('static subjects expose only linkable hashes, never raw path or content',async t=>{const{fixture,preview}=await project(t),serialized=JSON.stringify(preview);for(const r of preview.rows.filter(r=>r.binding.stage==='staticChecks')){assert.equal(r.subject.kind,'FILE');assert.match(r.subject.pathSha256,/^[a-f0-9]{64}$/);assert.match(r.subject.contentSha256,/^[a-f0-9]{64}$/);}for(const file of fixture.context.preparation.materialized.files){assert.equal(serialized.includes(file.path),false);assert.equal(serialized.includes(file.content),false);}});

test('rows omit messages, stdout, argv, task text, and explanations',async t=>{const{preview}=await project(t),text=JSON.stringify(preview);for(const secret of ['expected 0 but got 3','Inspected fixed fixture','retry-settings.mjs','--test','stdout','stderr','acceptanceCriteria'])assert.equal(text.includes(secret),false);});

test('receipt and evidence hashes are domain-bound; absent execution stays null',async t=>{const{fixture,preview}=await project(t);for(const r of preview.rows){if(r.binding.stage==='tests'&&r.rawStatus!=='NOT_DISPATCHED'){const x=fixture.context.executions.find(e=>e.expected.binding.attempt===r.binding.attempt);assert.equal(r.source.receiptSha256,h('nisi/repository-incident-receipt/v1',x.receipt));assert.equal(r.source.evidenceSha256,h('nisi/repository-incident-evidence/v1',x));}else if(r.rawStatus==='NOT_DISPATCHED')assert.equal(r.source.receiptSha256,null);}});

test('projection is deterministic and does not mutate bundle, context, or reader result',async t=>{const{fixture,bundle,preview}=await project(t),before=stableStringify(bundle),summary=readRepositoryRunBundleV1(bundle,fixture.context),again=createRepositoryIncidentPreviewV1({bundle,context:fixture.context});assert.deepEqual(again,preview);assert.equal(stableStringify(bundle),before);assert.deepEqual(readRepositoryRunBundleV1(bundle,fixture.context),summary);});

test('cloned issued context and cloned issued members cannot become projection authority',async t=>{const{fixture,bundle}=await project(t);for(const context of [structuredClone(fixture.context),{...fixture.context,preparation:structuredClone(fixture.context.preparation)},{...fixture.context,plans:structuredClone(fixture.context.plans)},{...fixture.context,executions:structuredClone(fixture.context.executions)}])assert.throws(()=>createRepositoryIncidentPreviewV1({bundle,context}));});

test('missing, changed, and fully rehashed bundle evidence is rejected',async t=>{const{fixture,bundle}=await project(t);for(const mutate of [b=>b.testEntries.pop(),b=>{b.testEntries[0].execution.receipt.result.status='PASS';},b=>{b.testEntries[0].disposition.stageIndex++;},b=>{b.report.stages[0].status='FAIL';}]){const bad=structuredClone(bundle),before=stableStringify(bad);mutate(bad);assert.notEqual(stableStringify(bad),before);assert.throws(()=>createRepositoryIncidentPreviewV1({bundle:rehash(bad),context:fixture.context}));}});

test('row order is stageIndex then checkIndex with no identity collisions',async t=>{const{preview}=await project(t);for(let i=1;i<preview.rows.length;i++){const a=preview.rows[i-1],b=preview.rows[i];assert.ok(a.stageIndex<b.stageIndex||a.stageIndex===b.stageIndex&&a.binding.checkIndex<b.binding.checkIndex);}assert.equal(new Set(preview.rows.map(r=>r.rowId)).size,preview.rows.length);});

test('same row identity with changed bound report content has a different conflict fingerprint',async t=>{
  const {fixture,preview}=await project(t),report=structuredClone(fixture.context.report);
  const review=report.stages.find(s=>s.stage==='review');
  assert(review);assert.equal(typeof review.evidence.summary,'string');
  review.evidence.summary+=' Changed trusted review statement, not a new execution.';
  assert.notEqual(stableStringify(report),stableStringify(fixture.context.report));
  const changedContext={...fixture.context,report};
  const changed=createRepositoryIncidentPreviewV1({bundle:createRepositoryRunBundleV1(changedContext),context:changedContext});
  assert.equal(changed.rows.length,preview.rows.length);
  assert.notEqual(changed.reportSha256,preview.reportSha256);
  for(let i=0;i<preview.rows.length;i++){
    assert.equal(changed.rows[i].rowId,preview.rows[i].rowId);
    assert.equal(changed.rows[i].occurrenceGroupId,preview.rows[i].occurrenceGroupId);
    assert.notEqual(changed.rows[i].fingerprint,preview.rows[i].fingerprint);
  }
  assert(!JSON.stringify(changed).includes('Changed trusted review statement'));
});

test('different runs change row and occurrence identity without changing profile family',async t=>{const a=await project(t),b=await project(t);const ar=a.preview.rows.find(r=>r.binding.stage==='staticChecks'),br=b.preview.rows.find(r=>r.binding.stage==='staticChecks');assert.equal(ar.familyId,br.familyId);assert.notEqual(ar.binding.runId,br.binding.runId);assert.notEqual(ar.rowId,br.rowId);assert.notEqual(ar.occurrenceGroupId,br.occurrenceGroupId);});

test('actual host refuses before settlement and quarantined collection without changing old history',async t=>{const c=await context(t),owner={registrationFingerprint:'a'.repeat(64),run:async()=>({status:'PASS',evidence:{}}),check:async()=>({status:'PASS',evidence:{}}),settled:async()=>[],observations:()=>[],status:()=> 'IDLE',lateObservations:()=>[]};const host=createRepositoryWorkflowOwnerV1({suite:c.suite,staticOwner:owner,testsOwner:owner});let p=host.incidentPreview();assert.equal(p.status,'REFUSED');assert.equal(p.reason,'NO_SETTLED_RESULT');assert.equal(host.historyPreview().reason,'NO_SETTLED_RESULT');await host.run(fixedOptions(c));await host.settled();p=host.incidentPreview();assert.equal(host.status(),'QUARANTINED');assert.equal(p.status,'REFUSED');assert.equal(p.reason,'HOST_NOT_SETTLED');assert.equal(host.historyPreview().status,'PREVIEW');});
