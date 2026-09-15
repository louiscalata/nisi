import test from 'node:test';
import assert from 'node:assert/strict';
import {openJournalOwner,inspectJournalOwner,recordJournalObservation} from '../src/index.mjs';
import {fixedXpcJournalObservation} from "file:///Users/louiscalata/nisi-next-private/history/fixed-xpc-journal-observation-v1.mjs";
import {makeRecord} from "file:///Users/louiscalata/nisi-next-private/tests/fixtures/fixed-xpc-journal-observation.mjs";
import {memfs} from './memfs.mjs';

function runCase(caseName,clientOutcome,adverse=false){
  const m=memfs();
  const record=makeRecord(caseName);
  if(adverse) record.status='INCONCLUSIVE';
  const projection=fixedXpcJournalObservation({
    serializedRecord:JSON.stringify(record),
    projectId:'project-a',
    candidateId:'candidate-a',
    receiptId:'receipt-a',
    createdAt:100,
    ttlMs:1000
  });
  const expectedState=adverse?'FAILED':'SUCCEEDED';
  const expectedReasons=adverse?['RUNNER_INCONCLUSIVE']:[];
  const expectedClientOutcome=clientOutcome;
  assert.strictEqual(projection.status,'ENTRY');
  assert.strictEqual(projection.entry.id,'0123456789abcdef0123456789abcdef:0:fixed-xpc');
  assert.strictEqual(projection.entry.stage,'fixed-xpc');
  assert.strictEqual(projection.entry.state,expectedState);
  assert.strictEqual(projection.entry.payload.meaning,'FIXED_CASE_OBSERVATION_ONLY');
  assert.strictEqual(projection.entry.payload.caseName,caseName);
  assert.deepStrictEqual(projection.entry.payload.reasons,expectedReasons);
  assert.strictEqual(projection.entry.payload.clientOutcome,expectedClientOutcome);
  const flags=['authorizing','generatedCodeExecuted','isolationAccepted','nativeProductAccepted','serviceIdentityAttested','serviceTerminationProven','sourceManifestVerified'];
  for(const f of flags) assert.strictEqual(projection.entry.payload[f],false);
  const sourceBefore=JSON.stringify(projection.entry);
  const {owner}=openJournalOwner({path:'/j/current-xpc.jsonl',fs:m.fs,config:{projectId:'project-a',maxEntries:8,heartbeatTtlMs:10,redactPaths:[]},now:100});
  const result=recordJournalObservation({owner,entry:projection.entry,now:100});
  assert.strictEqual(result.status,'RECORDED');
  assert.strictEqual(result.entryId,projection.entry.id);
  assert.strictEqual(result.authorizing,false);
  assert.strictEqual(result.append.status,'APPENDED');
  assert.strictEqual(result.store.status,'WRITTEN');
  assert.strictEqual(result.snapshot.state,'OPEN');
  assert.strictEqual(result.snapshot.recovery.status,'COMPLETE');
  assert.deepStrictEqual(result.snapshot.recovery.recoveredIds,[projection.entry.id]);
  assert.strictEqual(result.snapshot.meaning,'HISTORY_OBSERVATIONS_ONLY');
  assert.strictEqual(result.snapshot.authorizing,false);
  const row=result.snapshot.entries[0];
  assert.deepStrictEqual(row.entry,projection.entry);
  assert.strictEqual(row.historical,false);
  assert.strictEqual(row.retained,true);
  assert.strictEqual(row.revoked,false);
  assert.strictEqual(row.expired,false);
  assert.strictEqual(row.authorizing,false);
  const {owner:owner2}=openJournalOwner({path:'/j/current-xpc.jsonl',fs:m.fs,config:{projectId:'project-a',maxEntries:8,heartbeatTtlMs:10,redactPaths:[]},now:200});
  const snapshot2=inspectJournalOwner({owner:owner2}).snapshot;
  assert.strictEqual(snapshot2.recovery.status,'COMPLETE');
  assert.deepStrictEqual(snapshot2.recovery.recoveredIds,[projection.entry.id]);
  assert.strictEqual(snapshot2.authorizing,false);
  const row2=snapshot2.entries[0];
  assert.deepStrictEqual(row2.entry,projection.entry);
  assert.strictEqual(row2.historical,true);
  assert.strictEqual(row2.retained,true);
  assert.strictEqual(row2.revoked,false);
  assert.strictEqual(row2.expired,false);
  assert.strictEqual(row2.authorizing,false);
  for(const f of flags) assert.strictEqual(row2.entry.payload[f],false);
  assert.strictEqual(JSON.stringify(projection.entry),sourceBefore);
}

test('windows-xpc-integration: valid synthetic fixed-case observation',()=>runCase('valid','REPLY_RECEIVED'));
test('windows-xpc-integration: malformed-request synthetic fixed-case observation',()=>runCase('malformed-request','MALFORMED'));
test('windows-xpc-integration: no-reply synthetic fixed-case observation',()=>runCase('no-reply','TIMEOUT'));
test('windows-xpc-integration: adverse INCONCLUSIVE synthetic fixed-case observation',()=>runCase('valid','REPLY_RECEIVED',true));
