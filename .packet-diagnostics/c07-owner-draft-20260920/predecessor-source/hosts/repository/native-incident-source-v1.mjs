// PRIVATE original-source preparation, not native execution or capture permission.
// Only the issued plan's in-memory accessor exposes raw source to trusted callers.
import {cloneFreeze,sha256Text,stableStringify} from '../../workflow/contracts.mjs';
import {exact} from '../../integrity/record-utils.mjs';
import {createRepositoryIncidentPreviewV1,isIssuedRepositoryIncidentPreviewV1} from '../../history/repository-incident-candidates-v1.mjs';
import {issuedSwiftChecksV1} from '../swift-verifier/check-plan-v1.mjs';
import {fixedProfile,hashBytes,KERNEL_ARTIFACT_CAP,readNativeArtifactReport} from '../swift-verifier/protocol.mjs';

const issued=new WeakMap();
const H=(part,value)=>sha256Text('nisi/native-incident-'+part+'/v1\0'+stableStringify(value));
const incidentHash=(part,value)=>sha256Text('nisi/repository-incident-'+part+'/v1\0'+stableStringify(value));
const same=(a,b)=>stableStringify(a)===stableStringify(b);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const codes=new Set(['INVALID_INPUT','INVALID_PREVIEW','PREVIEW_MISMATCH','ROW_MISSING','ROW_NOT_FAILURE',
  'UNSUPPORTED_STAGE','SOURCE_MISMATCH','INVALID_EVIDENCE','ARTIFACT_LIMIT','HOST_NOT_SETTLED']);
const envelope=(status,reason,selection=null,sourcePlanDigest=null)=>cloneFreeze({
  schemaVersion:'nisi-native-incident-source-plan/v1',status,reason,selection,sourcePlanDigest,
  rawContentIncluded:false,persistable:false,freshness:'ORIGINAL_SNAPSHOT_ONLY',requiresSeparateAdmission:true,
  nativeRerun:'NOT_RUN',executionVerified:false,learningEligible:false,authorizing:false});

export const nativeIncidentSourceRefusalV1=reason=>envelope('REFUSED',codes.has(reason)?reason:'INVALID_EVIDENCE');
export const isIssuedNativeIncidentSourcePlanV1=value=>issued.has(value);

export function createNativeIncidentSourcePlanV1(input){
  try{
    exact(input,['bundle','context','preview','rowId'],'INVALID_INPUT');
    const {bundle,context,preview,rowId}=input;
    if(!hex(rowId))fail('INVALID_INPUT');
    if(!isIssuedRepositoryIncidentPreviewV1(preview))fail('INVALID_PREVIEW');
    // Rebind the WHOLE preview to original-issued evidence. A selected row and
    // matching public digests alone cannot replace the original source context.
    const reconstructed=createRepositoryIncidentPreviewV1({bundle,context});
    if(!same(preview,reconstructed))fail('PREVIEW_MISMATCH');
    const row=preview.rows.find(r=>r.rowId===rowId);
    if(!row)fail('ROW_MISSING');
    if(row.binding.stage!=='staticChecks')fail('UNSUPPORTED_STAGE');
    if(row.classification!=='FAILURE_CANDIDATE'||row.reason!=='RECORDED_FAILURE'||
      row.rawStatus!=='FAIL'||row.stageStatus!=='FAIL'||row.disposition!=='RESULT_RECORDED')fail('ROW_NOT_FAILURE');
    const matching=context.plans.filter(p=>p.fingerprint===row.source.planFingerprint);
    if(matching.length!==1)fail('SOURCE_MISMATCH');
    const plan=matching[0],index=context.plans.indexOf(plan),check=issuedSwiftChecksV1(plan)[row.binding.checkIndex];
    const group=bundle.staticBundle.entries[index],child=group?.group.entries[row.binding.checkIndex];
    if(!check||!child||child.dispatch!=='OBSERVED')fail('SOURCE_MISMATCH');
    const b=check.expected.binding,p=check.preparation,header=check.request.header;
    for(const key of ['runId','taskFingerprint','baselineFingerprint','attempt','candidateFingerprint','stage'])
      if(b[key]!==row.binding[key])fail('SOURCE_MISMATCH');
    if(b.preparationFingerprint!==p.fingerprint||b.materializedFingerprint!==p.materializedFingerprint||
      row.source.preparationFingerprint!==p.fingerprint||row.source.materializedFingerprint!==p.materializedFingerprint||
      row.source.expectationFingerprint!==check.expected.fingerprint||
      row.source.groupFingerprint!==group.group.fingerprint)fail('SOURCE_MISMATCH');
    const file=p.materialized.files.find(f=>f.path===check.target.path);
    if(!file||!file.content.isWellFormed())fail('SOURCE_MISMATCH');
    const bytes=Buffer.from(file.content,'utf8');
    if(bytes.length>KERNEL_ARTIFACT_CAP)fail('ARTIFACT_LIMIT');
    if(file.byteLength!==bytes.length||file.sha256!==hashBytes(bytes)||
      row.subject.kind!=='FILE'||row.subject.pathSha256!==incidentHash('path',file.path)||
      row.binding.subjectKey!==row.subject.pathSha256||row.subject.contentSha256!==file.sha256||
      check.target.artifactSha256!==file.sha256||check.target.artifactByteLength!==bytes.length||
      header.path!==file.path||header.artifactSha256!==file.sha256||
      header.preparationFingerprint!==p.fingerprint||check.request.artifactByteLength!==bytes.length)fail('SOURCE_MISMATCH');
    const fixed=fixedProfile(check.target.profileId);
    if(!same(fixed,check.request.profile)||header.rulesFingerprint!==fixed.rulesFingerprint||
      row.source.rulesetSha256!==fixed.rulesFingerprint)fail('SOURCE_MISMATCH');
    const profile={...fixed,allowedAdvisoryDimensions:[],modelParticipationRequired:false,maximumAdvisoryDimensions:0};
    const priorReport=readNativeArtifactReport(Buffer.from(child.stdoutHex,'hex'),check.request).report;
    if(priorReport.status!=='FAIL')fail('SOURCE_MISMATCH');
    const priorTranscriptSha256=H('prior-transcript',priorReport.outcomes);
    const body={schemaVersion:'nisi-native-incident-source-input/v1',rowId:row.rowId,rowFingerprint:row.fingerprint,
      previewSha256:preview.sha256,binding:row.binding,source:row.source,
      artifact:{relativePath:file.path,content:file.content,sha256:file.sha256,byteLength:bytes.length},
      profile,priorReport,priorTranscriptSha256};
    const inputSha256=H('source-input',body);
    const selection={rowId:row.rowId,rowFingerprint:row.fingerprint,previewSha256:preview.sha256,
      binding:row.binding,source:row.source,profile,artifactByteLength:bytes.length,priorTranscriptSha256,inputSha256};
    const sourcePlanDigest=H('source-plan',selection),result=envelope('SOURCE_BOUND',null,selection,sourcePlanDigest);
    issued.set(result,cloneFreeze({...body,inputSha256,sourcePlanDigest}));
    return result;
  }catch(error){return nativeIncidentSourceRefusalV1(codes.has(error?.code)?error.code:'INVALID_EVIDENCE');}
}

export function readNativeIncidentSourceInputV1(input){
  exact(input,['plan'],'NATIVE_SOURCE_INPUT_SCHEMA');
  const payload=issued.get(input.plan);
  if(!payload)fail('NATIVE_SOURCE_NOT_ISSUED');
  return payload;
}
