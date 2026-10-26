// Private evidence satisfaction, not certification. Adapter statements are not
// independent proof of tests, model participation, signatures or authority.
import {refuse,isId,isDigest,exact,read,digest} from './record-utils.mjs';
export const EVIDENCE_POLICY_PROFILE_V1='nisi-evidence-policy-v1';
export const EVIDENCE_SET_PROFILE_V1='nisi-evidence-set-v1';
const profiles=Object.freeze({canonicalProfile:'nisi-canonical-json-v1',policyDigestProfile:EVIDENCE_POLICY_PROFILE_V1,evidenceSetDigestProfile:EVIDENCE_SET_PROFILE_V1});
const tuple = value => JSON.stringify([value.scope,value.issuer]);
const compare=(a,b)=>tuple(a)<tuple(b)?-1:tuple(a)>tuple(b)?1:0;
const statuses=['PASS','FAIL','NOT_RUN','ERROR','INCONCLUSIVE'];
export function createEvidencePolicyV1(policyBytes){
  const policy=read(policyBytes);
  exact(policy,['schemaVersion','subjectDigest','requirements'],'EVIDENCE_POLICY_SCHEMA');
  if(policy.schemaVersion!==1||!isDigest(policy.subjectDigest)||!Array.isArray(policy.requirements)||policy.requirements.length<1||policy.requirements.length>256)refuse('EVIDENCE_POLICY_SCHEMA');
  const expected=new Set();
  for(const requirement of policy.requirements){
    exact(requirement,['scope','issuer'],'EVIDENCE_REQUIREMENT_SCHEMA');
    if(!isId(requirement.scope)||!isId(requirement.issuer))refuse('EVIDENCE_REQUIREMENT_SCHEMA');
    if(expected.has(tuple(requirement)))refuse('EVIDENCE_REQUIREMENT_DUPLICATE');
    expected.add(tuple(requirement));
  }
  const policyFingerprint=digest('nisi/evidence-policy/v1',{...profiles,...policy,requirements:[...policy.requirements].sort(compare)});
  const outcome=(state,cause,evidenceSetDigest=null)=>Object.freeze({schemaVersion:1,...profiles,
    policyFingerprint,subjectDigest:policy.subjectDigest,evidenceSetDigest,state,cause,authorizing:false,certificationGranted:false});
  return Object.freeze({policyFingerprint,subjectDigest:policy.subjectDigest,
    evaluate(recordBytes){
      let records;
      try{records=read(recordBytes);}catch{return outcome('REFUSED','EVIDENCE_BYTES_INVALID');}
      if(!Array.isArray(records)||records.length>256)return outcome('REFUSED','EVIDENCE_SCHEMA');
      const seen=new Set();let duplicate=false,unexpected=false;
      for(const record of records){
        try{exact(record,['schemaVersion','subjectDigest','scope','issuer','status','participated'],'EVIDENCE_SCHEMA');}
        catch{return outcome('REFUSED','EVIDENCE_SCHEMA');}
        if(record.schemaVersion!==1||!isDigest(record.subjectDigest)||!isId(record.scope)||!isId(record.issuer)||!statuses.includes(record.status)||typeof record.participated!=='boolean'||(record.status==='NOT_RUN'&&record.participated))return outcome('REFUSED','EVIDENCE_SCHEMA');
        const key=tuple(record);
        if(seen.has(key))duplicate=true;seen.add(key);
        if(record.subjectDigest!==policy.subjectDigest||!expected.has(key))unexpected=true;
      }
      if(duplicate)return outcome('REFUSED','EVIDENCE_DUPLICATE');
      if(unexpected)return outcome('REFUSED','EVIDENCE_BINDING');
      const evidenceSetDigest=digest('nisi/evidence-set/v1',{policyFingerprint,records:[...records].sort(compare)});
      if(seen.size!==expected.size)return outcome('UNSATISFIED','EVIDENCE_MISSING',evidenceSetDigest);
      if(records.some(record=>record.status!=='PASS'||record.participated!==true))return outcome('UNSATISFIED','EVIDENCE_NOT_PASS',evidenceSetDigest);
      return outcome('SATISFIED',null,evidenceSetDigest);
    }
  });
}
