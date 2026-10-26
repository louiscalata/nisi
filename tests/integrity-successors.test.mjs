import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAppendOnlyEventStoreV1, readEventRecordV1} from '../integrity/event-store-v1.mjs';
import {createEvidencePolicyV1} from '../integrity/evidence-policy-v1.mjs';
import {exact,canonical} from '../integrity/record-utils.mjs';
const bytes = value => Buffer.from(JSON.stringify(value));
const event = (id='e.1',payload={nested:{value:1}}) => ({schemaVersion:1,eventId:id,eventType:'task.observed',payload});
const subject='a'.repeat(64);
const policy=()=>createEvidencePolicyV1(bytes({schemaVersion:1,subjectDigest:subject,requirements:[{scope:'tests',issuer:'runner'},{scope:'review',issuer:'reviewer'}]}));
const record=(scope='tests',issuer='runner',status='PASS')=>({schemaVersion:1,subjectDigest:subject,scope,issuer,status,participated:status!=='NOT_RUN'});
const good=()=>[record(),record('review','reviewer')];

test('Nisi event snapshots survive caller mutation and all returned mutation attempts',()=>{
  const store=createAppendOnlyEventStoreV1();const input=bytes(event());const output=store.append(input);
  const before=store.materialize();input.fill(0);
  assert.throws(()=>{output.payload.nested.value=2;},TypeError);
  assert.throws(()=>{store.replay()[0].payload.nested.value=3;},TypeError);
  assert.throws(()=>{store.replay().push(output);},TypeError);
  assert.equal(store.replay()[0].payload.nested.value,1);
  assert.deepEqual(store.materialize(),before);
  assert.deepEqual(readEventRecordV1(bytes(output)),output);
  assert.ok(Object.isFrozen(readEventRecordV1(bytes(output)).payload.nested));
});
test('event duplicate ID is idempotent only for identical content; order matters for distinct events',()=>{
  const store=createAppendOnlyEventStoreV1();const first=store.append(bytes(event()));
  assert.deepEqual(store.append(bytes(event())),first);assert.equal(store.replay().length,1);
  assert.throws(()=>store.append(bytes(event('e.1',{different:true}))),{code:'EVENT_ID_CONFLICT'});
  store.append(bytes(event('e.2')));const reverse=createAppendOnlyEventStoreV1();reverse.append(bytes(event('e.2')));reverse.append(bytes(event()));
  assert.notEqual(store.materialize().stateDigest,reverse.materialize().stateDigest);
  const conflicting=createAppendOnlyEventStoreV1();conflicting.append(bytes(event('e.1',{different:true})));
  assert.throws(()=>conflicting.append(bytes(event())),{code:'EVENT_ID_CONFLICT'});
});
test('event payload prototype names survive real hashing and ambiguous raw input is refused',()=>{
  const store=createAppendOnlyEventStoreV1();
  const original=event('e.1',JSON.parse('{"__proto__":{"x":1}}'));
  const out=store.append(bytes(original));assert.equal(Object.hasOwn(out.payload,'__proto__'),true);
  const other=createAppendOnlyEventStoreV1().append(bytes(event('e.1',{})));
  assert.notEqual(out.eventDigest,other.eventDigest);
  for(const raw of ['{"schemaVersion":1,"eventId":"e.2","eventType":"x","payload":{"__proto__":1,"__proto__":2}}','{"schemaVersion":1,"eventId":"e.2","eventType":"x","payload":1.0}'])assert.throws(()=>store.append(Buffer.from(raw)));
  assert.throws(()=>store.append(event()),{code:'INVALID_JSON_INPUT'});
  assert.equal(store.replay().length,1);
});
test('new event profile has a pinned golden digest, no legacy migration or stale-digest acceptance',()=>{
  const out=createAppendOnlyEventStoreV1().append(bytes(event('e.1',{})));
  const canonical='{"canonicalProfile":"nisi-canonical-json-v1","digestProfile":"nisi-event-record-v1","eventId":"e.1","eventType":"task.observed","payload":{},"schemaVersion":1}';
  assert.equal(out.eventDigest,createHash('sha256').update('nisi/event-record/v1\0'+canonical).digest('hex'));
  for(const change of [{payload:{changed:true}},{digestProfile:'veritas-v1'},{schemaVersion:2},{eventDigest:'0'.repeat(64)},{extra:true}])assert.throws(()=>readEventRecordV1(bytes({...out,...change})));
});
test('event store bounds retention without silently pruning accepted history',()=>{
  const store=createAppendOnlyEventStoreV1({maxEvents:1,maxBytes:4096});store.append(bytes(event()));
  assert.throws(()=>store.append(bytes(event('e.2'))),{code:'EVENT_STORE_CAPACITY'});
  assert.equal(store.replay().length,1);assert.equal(store.append(bytes(event())).eventId,'e.1');
  const size=store.materialize().storedBytes;
  assert.equal(createAppendOnlyEventStoreV1({maxBytes:size}).append(bytes(event())).eventId,'e.1');
  assert.throws(()=>createAppendOnlyEventStoreV1({maxBytes:size-1}).append(bytes(event())),{code:'EVENT_STORE_CAPACITY'});
  assert.throws(()=>createAppendOnlyEventStoreV1({maxEvents:0}),{code:'EVENT_STORE_CONFIG'});
  assert.throws(()=>createAppendOnlyEventStoreV1({extra:true}),{code:'EVENT_STORE_CONFIG'});
});
test('evidence policy binds exact subject, scope and issuer without granting authority',()=>{
  const p=policy();const rows=good();const result=p.evaluate(bytes(rows));
  assert.equal(result.policyDigestProfile,'nisi-evidence-policy-v1');assert.equal(result.evidenceSetDigestProfile,'nisi-evidence-set-v1');assert.equal(result.canonicalProfile,'nisi-canonical-json-v1');
  // Pin the reviewed v1 identities; changing a profile/domain requires a new format.
  assert.equal(result.policyFingerprint,'4257a7dafa724e5e8534a146d1893d7b8d80b1344da0c4580ea8bb8eb65c1bc7');
  assert.equal(result.evidenceSetDigest,'cec8684231f26f832e4464f4163ed83bdb185421c1c79ce68668b8cdd6881717');
  assert.equal(result.state,'SATISFIED');assert.equal(result.certificationGranted,false);assert.equal(result.authorizing,false);
  assert.deepEqual(p.evaluate(bytes([...rows].reverse())),result);
  for(const change of [{subjectDigest:'b'.repeat(64)},{scope:'other'},{issuer:'other'}])assert.equal(p.evaluate(bytes([{...record(),...change},rows[1]])).cause,'EVIDENCE_BINDING');
  rows[0].status='FAIL';assert.equal(result.state,'SATISFIED');assert.ok(Object.isFrozen(result));
});
test('duplicate evidence always refuses, including both conflict orders and duplicate PASS',()=>{
  const p=policy();
  assert.deepEqual(p.evaluate(bytes([record('tests','runner','FAIL'),record()])),p.evaluate(bytes([record(),record('tests','runner','FAIL')])));
  for(const rows of [[record('tests','runner','FAIL'),record()], [record(),record('tests','runner','FAIL')],[record(),record()]]){
    const result=p.evaluate(bytes([...rows,record('review','reviewer')]));assert.equal(result.state,'REFUSED');assert.equal(result.cause,'EVIDENCE_DUPLICATE');
  }
});
test('exact-key comparison has no delimiter collision and captured helpers reject accessors',()=>{
  assert.throws(()=>exact({'a|b':1},['a','b'],'SCHEMA'),{code:'SCHEMA'});
  assert.throws(()=>exact(Object.defineProperty({},'a',{value:1}),['a'],'SCHEMA'),{code:'SCHEMA'});
  let calls=0;assert.throws(()=>canonical({get x(){calls++;return 1;}}));assert.equal(calls,0);
  const out=createAppendOnlyEventStoreV1().append(bytes(event()));
  assert.throws(()=>readEventRecordV1(bytes({[Object.keys(out).sort().join('|')]:1})),{code:'EVENT_RECORD_SCHEMA'});
});
test('event chain includes the history prefix, not only the final event',()=>{
  const a=createAppendOnlyEventStoreV1(),b=createAppendOnlyEventStoreV1();
  a.append(bytes(event('e.1',{a:1})));b.append(bytes(event('e.1',{b:1})));
  a.append(bytes(event('e.2')));b.append(bytes(event('e.2')));
  assert.notEqual(a.materialize().stateDigest,b.materialize().stateDigest);
});
test('missing or incomplete evidence never satisfies and malformed evidence never coerces',()=>{
  const p=policy();assert.equal(p.evaluate(bytes([])).state,'UNSATISFIED');
  for(const status of ['FAIL','NOT_RUN','ERROR','INCONCLUSIVE'])assert.equal(p.evaluate(bytes([record('tests','runner',status),good()[1]])).state,'UNSATISFIED');
  for(const change of [{status:'UNKNOWN'},{participated:'true'},{status:'NOT_RUN',participated:true},{extra:true}])assert.equal(p.evaluate(bytes([{...record(),...change},good()[1]])).state,'REFUSED');
  assert.equal(p.evaluate(Buffer.from('bad json')).state,'REFUSED');
  assert.equal(p.evaluate(bytes([{...record(),participated:false},good()[1]])).state,'UNSATISFIED');
});
test('policy refuses duplicate/empty requirements and records use exact closed schemas',()=>{
  for(const requirements of [[],[{scope:'tests',issuer:'runner'},{scope:'tests',issuer:'runner'}],[{scope:'tests',issuer:'runner',extra:true}]])assert.throws(()=>createEvidencePolicyV1(bytes({schemaVersion:1,subjectDigest:subject,requirements})));
  assert.throws(()=>createEvidencePolicyV1(bytes({schemaVersion:1,subjectDigest:subject,requirements:[{scope:'tests',issuer:'runner'}],extra:true})));
  const a=createEvidencePolicyV1(bytes({schemaVersion:1,subjectDigest:subject,requirements:[{scope:'tests',issuer:'runner'},{scope:'review',issuer:'reviewer'}]}));
  const b=createEvidencePolicyV1(bytes({schemaVersion:1,subjectDigest:subject,requirements:[{scope:'review',issuer:'reviewer'},{scope:'tests',issuer:'runner'}]}));
  assert.equal(a.policyFingerprint,b.policyFingerprint);
});
