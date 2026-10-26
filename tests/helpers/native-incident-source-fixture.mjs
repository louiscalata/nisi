// Genuine issued repository evidence with synthetic static-check observations.
// No Swift executable, child process, native service, or model is launched.
import {createRepositorySnapshot,prepareRepositoryCandidate} from '../../hosts/repository/snapshot-contract.mjs';
import {registerReviewedNodeSuiteV1,REVIEWED_NODE_SCOPE} from '../../hosts/repository/node-suite-v1.mjs';
import {createRepositoryWorkflowOwnerV1} from '../../hosts/repository/reviewed-workflow-v1.mjs';
import {createSwiftCheckPlanV1,issuedSwiftChecksV1} from '../../hosts/swift-verifier/check-plan-v1.mjs';
import {createSwiftStaticGroupV1} from '../../receipts/swift-static-group-v1.mjs';
import {hashBytes} from '../../hosts/swift-verifier/protocol.mjs';
import {sha256Text} from '../../workflow/contracts.mjs';
import {profile as executionProfile} from './swift-group-fixture.mjs';

const ENTRY='checks/check.mjs';
export const boundaryFiles=Object.freeze([
  {path:ENTRY,content:'// protected synthetic entry\n',profileId:'nisi-text-structure-v1'},
  {path:'sources/empty.txt',content:'',profileId:'nisi-text-structure-v1'},
  {path:'sources/multibyte.txt',content:'Nisi λ 雪 😀\n',profileId:'nisi-text-structure-v1'},
  {path:'sources/exact-cap.txt',content:'x'.repeat(1_048_576),profileId:'nisi-text-structure-v1'},
  {path:'sources/invalid.json',content:'{"synthetic":',profileId:'nisi-json-structure-v1'},
  {path:'sources/incomplete.md',content:'# Synthetic\n',profileId:'nisi-markdown-sections-v1'},
]);

function observed(check){
  const request=check.request,nonempty=request.artifactByteLength===0?'FAIL':'PASS';
  const structure=request.profile.kind==='json'?'DET-003-JSON-STRUCTURE':'DET-003-REQUIRED-SECTIONS';
  const report={...request.header,requestSha256:request.requestSha256,artifactByteLength:request.artifactByteLength,
    status:'FAIL',outcomes:[{id:'DET-001-NONEMPTY',status:nonempty,explanation:nonempty==='FAIL'?'Synthetic empty input':'Synthetic nonempty input'},
      {id:'DET-002-UTF8',status:'PASS',explanation:'Issued JavaScript string is well formed UTF8'},
      {id:structure,status:'FAIL',explanation:'Synthetic deterministic structure failure'}],authorizing:false};
  const stdout=Buffer.from(JSON.stringify(report)+'\n'),stream=bytes=>({capturedBytes:bytes.length,observedBytes:bytes.length,
    sha256:hashBytes(bytes),truncated:false});
  return{dispatch:'OBSERVED',receipt:{schemaVersion:1,expectationFingerprint:check.expected.fingerprint,binding:check.expected.binding,
    process:{started:true,closed:true,drain:'CONFIRMED',exitCode:0,signal:null,errorCode:null,deadlineExceeded:false,
      cancelRequested:false,durationMs:1},outputs:{stdout:stream(stdout),stderr:stream(Buffer.alloc(0))},
    result:{status:'FAIL',reason:'SWIFT_ARTIFACT_FAILED'}},stdoutHex:stdout.toString('hex'),stderrHex:''};
}

export async function createBoundaryNativeIncidentFixture(){
  const files=boundaryFiles.map(({path,content})=>({path,content})),baseline=createRepositorySnapshot({files});
  const protectedSnapshots={[ENTRY]:sha256Text(boundaryFiles[0].content)};
  const task={taskId:'native.incident.source.boundaries',mode:'edit',language:'javascript',allowedFiles:files.map(x=>x.path),
    protectedFiles:[ENTRY],protectedSnapshots,acceptanceCriteria:['Retain bounded synthetic source identities'],
    policy:{repairBudget:0,totalDeadlineMs:20000,requiredReviewers:1,requireReportStore:false}};
  const preparation=prepareRepositoryCandidate({baseline,task,candidate:{files:[{path:'sources/invalid.json',content:'{"changed":'}]},authorId:'author.native-source-boundary'});
  const suite=registerReviewedNodeSuiteV1({id:'nisi.node.native.source.boundary',scope:REVIEWED_NODE_SCOPE,preparations:[preparation],
    entryPath:ENTRY,reportSchema:'nisi-native-source-boundary-v1',assertionNames:['synthetic source boundary'],setupReason:'FIXTURE_SETUP_FAILED'});
  const plans=[],groups=[],staticOwner={registrationFingerprint:'a'.repeat(64),async check(payload){
    const plan=createSwiftCheckPlanV1({preparation,runId:payload.binding.runId,attempt:payload.binding.attempt,
      targets:boundaryFiles.map(({path,profileId})=>({path,profileId})),executionProfile});
    const checks=issuedSwiftChecksV1(plan);
    const group=createSwiftStaticGroupV1(plan,checks.map(observed));plans.push(plan);groups.push(group);return group.adapterResult;
  },async settled(){return this.observations();},observations(){return plans.map((plan,i)=>({plan,group:groups[i],error:null}));},status(){return'IDLE';},lateObservations(){return[];}},
  testsOwner={registrationFingerprint:'b'.repeat(64),async run(){throw Error('TESTS_MUST_NOT_DISPATCH');},async settled(){return[];},observations(){return[];},status(){return'IDLE';},lateObservations(){return[];}};
  const host=createRepositoryWorkflowOwnerV1({suite,staticOwner,testsOwner}),options={
    authorizeContext:{authorize:p=>({status:'PASS',evidence:{...p.binding,reason:''}})},
    author:{id:'author.native-source-boundary',draft:p=>({candidate:{files:preparation.candidate.files.map(x=>({path:x.path,content:x.content}))},evidence:{...p.binding,candidateFingerprint:preparation.candidateFingerprint,note:'Synthetic boundary candidate'}})},
    reviewers:[{id:'reviewer.native-source-boundary',review:p=>({status:'PASS',evidence:{...p.binding,reviewerId:'reviewer.native-source-boundary',findings:[],summary:'Synthetic callback only',reason:''}})}]};
  const report=await host.run(options);const collected=await host.settled();
  const context={report,plans,groups,executions:[],preparation,suite,nodeRegistrationFingerprint:testsOwner.registrationFingerprint};
  return{host,collected,preparation,plans,groups,context};
}
