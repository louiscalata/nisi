// Genuine issued repository-host evidence built entirely from synthetic adapter
// observations. This helper launches no native process, child process, or model.
import {createRepositorySnapshot, prepareRepositoryCandidate} from '../../hosts/repository/snapshot-contract.mjs';
import {registerReviewedNodeSuiteV1, REVIEWED_NODE_SCOPE} from '../../hosts/repository/node-suite-v1.mjs';
import {createRepositoryWorkflowOwnerV1} from '../../hosts/repository/reviewed-workflow-v1.mjs';
import {createSwiftCheckPlanV1} from '../../hosts/swift-verifier/check-plan-v1.mjs';
import {createSwiftStaticGroupV1} from '../../receipts/swift-static-group-v1.mjs';
import {sha256Text} from '../../workflow/contracts.mjs';
import {entry, profile} from './swift-group-fixture.mjs';

const ENTRY='checks/check.mjs';
const contents=[{path:ENTRY,content:'// protected synthetic fixture entry\n'},
  ...Array.from({length:12},(_,i)=>({path:`sources/failure-${String(i+1).padStart(2,'0')}.json`,content:`{"index":${i+1}}\n`}))];

export async function createPagedIncidentHostFixture(){
  const baseline=createRepositorySnapshot({files:contents});
  const protectedSnapshots={[ENTRY]:sha256Text(contents[0].content)};
  const task={taskId:'incident.review.paging',mode:'edit',language:'javascript',
    allowedFiles:contents.map(x=>x.path),protectedFiles:[ENTRY],protectedSnapshots,
    acceptanceCriteria:['Retain every synthetic static failure candidate'],
    policy:{repairBudget:0,totalDeadlineMs:20000,requiredReviewers:1,requireReportStore:false}};
  const preparation=prepareRepositoryCandidate({baseline,task,
    candidate:{files:[{path:contents[1].path,content:'{"index":101}\n'}]},authorId:'author.incident-review-fixture'});
  const suite=registerReviewedNodeSuiteV1({id:'nisi.node.incident.review.paging',scope:REVIEWED_NODE_SCOPE,
    preparations:[preparation],entryPath:ENTRY,reportSchema:'nisi-incident-review-fixture-v1',
    assertionNames:['synthetic paging fixture'],setupReason:'FIXTURE_SETUP_FAILED'});
  const plans=[],groups=[];
  const staticOwner={registrationFingerprint:'a'.repeat(64),async check(payload){
    const plan=createSwiftCheckPlanV1({preparation,runId:payload.binding.runId,attempt:payload.binding.attempt,
      targets:preparation.materialized.files.map(file=>({path:file.path,profileId:file.path.endsWith('.json')?'nisi-json-structure-v1':'nisi-text-structure-v1'})),executionProfile:profile});
    const group=createSwiftStaticGroupV1(plan,plan.targets.map((_,i)=>entry(plan,i,'FAIL')));
    plans.push(plan);groups.push(group);return group.adapterResult;
  },async settled(){return this.observations();},observations(){return plans.map((plan,i)=>({plan,group:groups[i],error:null}));},status(){return'IDLE';},lateObservations(){return[];}};
  const testsOwner={registrationFingerprint:'b'.repeat(64),async run(){throw Error('TESTS_MUST_NOT_DISPATCH');},
    async settled(){return[];},observations(){return[];},status(){return'IDLE';},lateObservations(){return[];}};
  const host=createRepositoryWorkflowOwnerV1({suite,staticOwner,testsOwner});
  const options={authorizeContext:{authorize:p=>({status:'PASS',evidence:{...p.binding,reason:''}})},
    author:{id:'author.incident-review-fixture',draft:p=>({candidate:{files:preparation.candidate.files.map(x=>({path:x.path,content:x.content}))},
      evidence:{...p.binding,candidateFingerprint:preparation.candidateFingerprint,note:'Synthetic fixed paging candidate'}})},
    reviewers:[{id:'reviewer.incident-review-fixture',review:p=>({status:'PASS',evidence:{...p.binding,
      reviewerId:'reviewer.incident-review-fixture',findings:[],summary:'Synthetic callback, not independent review',reason:''}})}]};
  await host.run(options);await host.settled();
  const preview=host.incidentPreview();
  const eligible=preview.rows.filter(row=>row.classification==='FAILURE_CANDIDATE'&&row.reason==='RECORDED_FAILURE');
  if(eligible.length<11)throw Error(`PAGING_FIXTURE_TOO_SMALL:${eligible.length}`);
  return{host,preview,eligible};
}
