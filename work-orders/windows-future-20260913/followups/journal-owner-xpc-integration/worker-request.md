Private Windows TEST-ONLY coding work order. No file/test tools are available. Return source for exactly tests/windows-xpc-integration.test.mjs in the isolated journal-owner-v2 work order. Never claim execution or product acceptance.
Purpose: concrete current-XPC projection -> new owner history integration gap; no native app runs, execution approval or release claim. No dependencies, real FS, processes, network, timers, eval, dynamic imports or source modifications.
Allowed static imports exactly:
import test from 'node:test';
import assert from 'node:assert/strict';
import {openJournalOwner,inspectJournalOwner,recordJournalObservation} from '../src/index.mjs';
import {fixedXpcJournalObservation} from '../../../history/fixed-xpc-journal-observation-v1.mjs';
import {makeRecord} from '../../../tests/fixtures/fixed-xpc-journal-observation.mjs';
import {memfs} from './memfs.mjs';
No other imports. Actual canonical modules and existing memfs are supplied at these paths by owner, not yours to edit.

Contract facts:
makeRecord(caseName) returns a faithful SYNTHETIC current runner record, using the actual parser. caseName valid | malformed-request | no-reply. All represent EXPECTED fixed-case observations, not successful user tasks. runId='0123456789abcdef0123456789abcdef'. createdAt etc internally supplied. Root status='FIXED_XPC_CASE_OBSERVED'; changing only root status to 'INCONCLUSIVE' is structurally valid and must remain adverse.
fixedXpcJournalObservation({serializedRecord:JSON.stringify(record),projectId:'project-a',candidateId:'candidate-a',receiptId:'receipt-a',createdAt:100,ttlMs:1000})
returns {status:'ENTRY',entry,authorizing:false}.
entry.id=runId+':0:fixed-xpc', stage='fixed-xpc', state='SUCCEEDED' for all three EXPECTED cases. payload.meaning='FIXED_CASE_OBSERVATION_ONLY', payload.caseName exact case, payload.reasons=[]; payload.clientOutcome expected REPLY_RECEIVED | MALFORMED | TIMEOUT respectively.
If only root record status='INCONCLUSIVE', entry.state='FAILED', payload.reasons=['RUNNER_INCONCLUSIVE']; this must persist without promotion.
Payload flags ALL false: authorizing,generatedCodeExecuted,isolationAccepted,nativeProductAccepted,serviceIdentityAttested,serviceTerminationProven,sourceManifestVerified. These are observations, not authority.

memfs(): {fs,bytes(path),events}; fs trusted synchronous in-memory double; bytes(path) undefined if absent; can reopen same path/fs. Use path '/j/current-xpc.jsonl'. This is not real disk or Windows native evidence.
openJournalOwner({path,fs:m.fs,config:{projectId:'project-a',maxEntries:8,heartbeatTtlMs:10,redactPaths:[]},now:100})
returns {schemaVersion:'nisi-journal-owner/v2',status:'OPENED',owner,snapshot,authorizing:false}.
recordJournalObservation({owner:opened.owner,entry:projection.entry,now:100})
returns status RECORDED, append.status APPENDED, store.status WRITTEN, snapshot.state OPEN,recovery.status COMPLETE,recovery.recoveredIds [entry.id]. snapshot.meaning HISTORY_OBSERVATIONS_ONLY, authorizing false. snapshot.entries[0] = {entry,historical,retained,revoked,expired,liveness,authorizing:false}. Same projected source must remain unchanged.
New open with exact same request reads actual serialized memfs bytes and yields COMPLETE with row.historical true; exact projected entry preserved. Empty inspect operation returns latest immutable snapshot without IO.

Author exactly FOUR test groups, no conditional skips:
- one test each valid/malformed-request/no-reply: use fresh memfs, assert each explicit outcome + reasons[] + entrystateSUCCEEDED; capture serialized input entry; record it; inspect/reopen exact entry and identity; assert all payload authority flags false before/after; assert entry source unchanged. Test names explicitly say synthetic fixed-case observation, not native success.
- one test starting makeRecord('valid') with root status INCONCLUSIVE: assert entryFAILED, reasons exactly ['RUNNER_INCONCLUSIVE'], record/reopen remain FAILED and reasons preserved, authorityflags false.
Assert actual outputs, do not import or copy implementation comparators or rewrite existing tests. Keep <=140 readable lines.
Return ONLY closed JSON {"schemaVersion":1,"files":[{"path":"tests/windows-xpc-integration.test.mjs","content":"entire source"}],"notes":["Static test draft; owner must read and run. Synthetic observations only."]}. No markdown fences or repeated JSON.
