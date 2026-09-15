// Private in-memory Nisi successor, not durable storage, certification or a
// migration of retained Veritas history. Input is restricted canonical-profile JSON.
import {cloneFreeze} from '../workflow/contracts.mjs';
import {CANONICAL_JSON_PROFILE_V1} from '../canonical/canonical-json-v1.mjs';
import {refuse,isId,isDigest,exact,read,canonical,digest} from './record-utils.mjs';

export const EVENT_DIGEST_PROFILE_V1 = 'nisi-event-record-v1';
const inputKeys=['schemaVersion','eventId','eventType','payload'];
const recordKeys=[...inputKeys,'canonicalProfile','digestProfile','eventDigest'];
function identity(event) {
  if(event.schemaVersion!==1 || !isId(event.eventId) || !isId(event.eventType)) refuse('EVENT_SCHEMA');
  return {schemaVersion:1,canonicalProfile:CANONICAL_JSON_PROFILE_V1,digestProfile:EVENT_DIGEST_PROFILE_V1,
    eventId:event.eventId,eventType:event.eventType,payload:event.payload};
}
function verify(record) {
  exact(record,recordKeys,'EVENT_RECORD_SCHEMA');
  if(record.canonicalProfile!==CANONICAL_JSON_PROFILE_V1 || record.digestProfile!==EVENT_DIGEST_PROFILE_V1) refuse('EVENT_PROFILE');
  if(!isDigest(record.eventDigest) || record.eventDigest!==digest('nisi/event-record/v1',identity(record))) refuse('EVENT_DIGEST_MISMATCH');
  return record;
}
export const readEventRecordV1 = bytes => verify(read(bytes));
export function createAppendOnlyEventStoreV1(options={}) {
  const config=cloneFreeze(options);
  if(!config || typeof config!=='object' || Array.isArray(config) || Object.keys(config).some(key=>!['maxEvents','maxBytes'].includes(key))) refuse('EVENT_STORE_CONFIG');
  const {maxEvents=1024,maxBytes=16_777_216}=config;
  if(!Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>10000||!Number.isSafeInteger(maxBytes)||maxBytes<256||maxBytes>67_108_864)refuse('EVENT_STORE_CONFIG');
  const events=new Map();let storedBytes=0;
  return Object.freeze({
    append(bytes) {
      const input=read(bytes);exact(input,inputKeys,'EVENT_SCHEMA');
      const body=identity(input);const record=cloneFreeze({...body,eventDigest:digest('nisi/event-record/v1',body)});
      const encodedBytes=Buffer.byteLength(canonical(record));
      const prior=events.get(record.eventId);
      if(prior){if(prior.eventDigest!==record.eventDigest)refuse('EVENT_ID_CONFLICT');return prior;}
      if(events.size>=maxEvents || storedBytes+encodedBytes>maxBytes)refuse('EVENT_STORE_CAPACITY');
      events.set(record.eventId,record);storedBytes+=encodedBytes;return record;
    },
    replay(){return Object.freeze([...events.values()]);},
    materialize(){
      let stateDigest=digest('nisi/event-chain/v1',{genesis:true});
      for(const event of events.values()){
        verify(event);
        stateDigest=digest('nisi/event-chain/v1',{prior:stateDigest,eventDigest:event.eventDigest});
      }
      return Object.freeze({schemaVersion:1,digestProfile:'nisi-event-chain-v1',eventCount:events.size,storedBytes,stateDigest,authorizing:false,certificationGranted:false});
    }
  });
}
