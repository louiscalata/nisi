// Authored fixture, not a retained model call. Fixed input request hashes were
// independently read back against the Swift producer's retained native result.
import {createHash} from 'node:crypto';
export const sortedJSON = v => JSON.stringify(v, function(_key,value) {
  return value && !Array.isArray(value) && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) : value;
});
export const syntheticDigest = v => createHash('sha256').update(sortedJSON(v)).digest('hex');
export function syntheticAFMEvidence() {
  const subjectDigest = 'b99f3f8572986c04adf3cff7789aa6474a4b92e6ae39b78b52ca6e1b6864cf2c';
  const profileFingerprint = 'ce08c15cd837e5b6b193ff5d0ddaf7e18d1f9fb1db24786c375adb8c3d93f85a';
  const advisoryReceipt = {schemaVersion:1,subjectDigest,profileFingerprint,artifactKind:'json',
    provider:'apple-foundation-models',route:'system-on-device-requested',adapterContractVersion:'apple-foundation-advisory-v1',
    modelIdentityStatus:'MODEL_ID_NOT_EXPOSED_BY_API',runtimeFingerprint:'b'.repeat(64),nonAuthorizing:true,
    outcome:'COMPLETED',reasonCode:null,stages:['PROBE','PLAN','FINDING'].map((stage,ordinal) => ({
      ordinal,stage,outcome:'OBSERVED',reasonCode:null,responseDigest:'a'.repeat(64),requestDigest:[
        'e9b680d3b11a5bf11e879d2bad908d03ec14c8d5c2db12bf1ff0a112cb94ac09',
        '81cec445fd68990b222ea3d483861c70425c9e5692ba0e037f19d3eb7f6254fe',
        '470959ea8b828b3cef7369c94ecf979462218542a568663558d7a14549b01e84'][ordinal]
    }))};
  return {schemaVersion:1,status:'PASS',evidenceClass:'SELF_ADMINISTERED_NATIVE_AFM_FUNCTIONAL_PROBE',
    target:'macOS 27.0+ · Apple Silicon · arm64 only',subjectDigest,profileFingerprint,advisoryReceipt,
    advisoryReceiptDigest:syntheticDigest(advisoryReceipt),deterministicChecks:[
      ['DET-001-NONEMPTY','The artifact contains bytes.'],['DET-002-UTF8','The complete snapshot decodes as UTF-8.'],
      ['DET-003-JSON-STRUCTURE','The snapshot is a JSON object or array.']
    ].map(([id,explanation]) => ({id,explanation,status:'PASS'})),deterministicPassed:true,
    modelParticipation:'PARTICIPATED',disposition:'READY',quiescent:true,
    limitationCodes:['MODEL_FINDINGS_NON_AUTHORIZING','PROTOTYPE_IN_MEMORY_ACCEPTANCE_ONLY'],
    rawArtifactPersisted:false,transcriptPersisted:false,externalToolsEnabled:false,acceptanceAuthorityGranted:false};
}
