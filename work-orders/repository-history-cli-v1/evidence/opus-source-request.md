Private Nisi source review. Tools disabled. Return PASS or at most THREE concrete findings, at most350 words total. Do not repeat the architecture. Selected exact source below; do not assume you executed tests. Boundaries: trusted host/prompter/fs callbacks, actual CLI; not a hostile-JS sandbox or authenticated user identity. No native/model run this slice.

Your earlier contract included wrong API examples: existing owner has no close(), clock epochinteger not Date, thirteen-field declaration not invented actor/text/ISO fields; preview status is PREVIEW. We retained your recommendations for explicit additional approval, warning that existing raw evidence was already retained, retention14days with NO automatic sweep, linkable hashes, and expiration minted AFTER positive answer. Answer now strict exact no trim. Actual unchanged host consumes BEFORE underlying record, including failures; its output has independent recordAttempted and consumed flags. Outer captureCallAttempted cannot imply a record attempt. The current code must preserve actual outputs on late cancellation, no retries. Prompt timer races callback; arbitrary non-cooperating trusted callback code may finish later but cannot open/capture here. Actual native abort getters are used; a suppressed abort event may only be noticed by native check at data/deadline but cannot authorize storage.

Root observed29/29 independent focused tests, originally2pass27fail againststubs. Two type compiler checks pass after root correcting repeat refusal consumedbool and candidate discriminatedunion. Existing full product check and realTTY manual acceptance still pending. Request type declarations not in scope for this source review. Caller/parser/default summary/receipt must stay compatible when flag absent; --review-history only requests review and TTYpreflight occurs before fixture/build/model. Review writes only extra metadatajournal after exacttypedanswer and matchingpreview. Existing model-lane receipt/exit criteria unchanged, history outcome separately visible.

Review for real errors in approval, time/cancel, data exposure, terminal cleanup and actual CLI wiring. Avoid manufacturing authority guarantees beyond this trusted local prototype. Source files and exact hashes:

## hosts/history/review-repository-history-v1.mjs SHA256 a1042e1913e468edb322df493454f91f88f8c58231791b77c7c2eb1b00b5a090
```js
// PRIVATE trusted-host UI boundary. A terminal answer is not authenticated consent.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {cloneFreeze,stableStringify,sha256Text} from '../../workflow/contracts.mjs';
import {exact} from '../../integrity/record-utils.mjs';

const active = new WeakSet();
const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const listen = EventTarget.prototype.addEventListener, unlisten = EventTarget.prototype.removeEventListener;
const safeTime = v => Number.isSafeInteger(v) && v >= 0 && !Object.is(v,-0);
const hex = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const bodyKeys = ['schemaVersion','taskFingerprint','baselineFingerprint','runId','attempt',
  'candidateFingerprint','candidatePresent','outcome','workflowOutcome','hostState','ownerStates',
  'stageCounts','stageTotal','diagnostics','bundleFingerprint','sourceAuthenticityAttested',
  'executionAttested','learningEligible','authorizing'];
const escaped = v => JSON.stringify(v,null,2).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
  c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
function readPreview(call) {
  let raw;
  try { raw = call(); } catch { return {reason:'PREVIEW_UNAVAILABLE'}; }
  try {
    exact(raw,['schemaVersion','status','reason','preview','sha256','authorizing'],'PREVIEW_INVALID');
    if (raw.schemaVersion !== 'nisi-repository-history-preview/v1' || raw.authorizing !== false) throw Error();
    if (raw.status === 'REFUSED') return {reason:'PREVIEW_UNAVAILABLE'};
    if (raw.status !== 'PREVIEW' || raw.reason !== null || !hex(raw.sha256)) throw Error();
    exact(raw.preview,bodyKeys,'PREVIEW_INVALID');
    const p = cloneFreeze(raw);
    if (p.preview.schemaVersion !== 'nisi-repository-history-observation/v1' || !hex(p.preview.taskFingerprint) ||
        ['sourceAuthenticityAttested','executionAttested','learningEligible','authorizing'].some(k=>p.preview[k]!==false)) throw Error();
    const canonical = stableStringify(p.preview);
    if (Buffer.byteLength(canonical)>16384 || sha256Text('nisi/repository-history-preview/v1\0'+canonical)!==p.sha256) throw Error();
    return {reason:null,p};
  } catch { return {reason:'PREVIEW_INVALID'}; }
}
function captureShape(c) {
  try {
    exact(c,['schemaVersion','status','reason','recordAttempted','consumed','sourceDigest','declarationDigest','journal','authorizing'],'CAPTURE_INVALID');
    return Object.isFrozen(c) && c.schemaVersion==='nisi-repository-history-capture/v1' && c.authorizing===false &&
      ['STORED','DUPLICATE','CONFLICT','REFUSED','STORE_FAILED','UNCERTAIN'].includes(c.status) &&
      (c.reason===null || typeof c.reason==='string') && typeof c.recordAttempted==='boolean' && typeof c.consumed==='boolean';
  } catch { return false; }
}

export async function reviewRepositoryHistoryV1(input) {
  let req, host, previewCall, captureCall, signal=null, guarded=false, sourceDigest=null;
  let ownerOpenAttempted=false, captureCallAttempted=false, capture=null;
  const aborted = () => signal!==null && abortedGetter.call(signal);
  const result = (status,reason) => Object.freeze({schemaVersion:'nisi-repository-history-review/v1',
    status,reason,sourceDigest,ownerOpenAttempted,captureCallAttempted,capture,
    cancelledAfterCaptureCall:captureCallAttempted && aborted(),authorizing:false});
  const refused = reason => result('NOT_STORED',reason);
  try {
    try {
      exact(input,['host','runDirectory','clock','prompt','openOwner','signal','promptTimeoutMs'],'INVALID_INPUT');
      req = {...input}; host = req.host;
      if (!host || typeof host!=='object' || Array.isArray(host)) throw Error();
      const a=Object.getOwnPropertyDescriptor(host,'historyPreview'), b=Object.getOwnPropertyDescriptor(host,'captureHistory');
      if (typeof a?.value!=='function' || typeof b?.value!=='function') throw Error();
      previewCall=a.value.bind(host); captureCall=b.value.bind(host);
      if (typeof req.clock!=='function' || typeof req.prompt!=='function' || typeof req.openOwner!=='function' ||
          typeof req.runDirectory!=='string' || !req.runDirectory.isWellFormed() || req.runDirectory.length>4096 ||
          req.runDirectory.includes('\0') || !path.isAbsolute(req.runDirectory) ||
          path.resolve(req.runDirectory)===path.parse(req.runDirectory).root ||
          !Number.isSafeInteger(req.promptTimeoutMs) || req.promptTimeoutMs<1 || req.promptTimeoutMs>120000) throw Error();
      if (req.signal!==null) abortedGetter.call(req.signal);
      signal=req.signal;
    } catch { return refused('INVALID_INPUT'); }
    if (active.has(host)) return refused('REVIEW_BUSY');
    active.add(host); guarded=true;
    if (aborted()) return refused('ABORTED');
    const first=readPreview(previewCall);
    if (aborted()) return refused('ABORTED');
    if (first.reason) return refused(first.reason);
    const shown=first.p; sourceDigest=shown.sha256;
    const destination=path.join(req.runDirectory,'history-journal.jsonl');
    const expectedAnswer='STORE '+sourceDigest;
    const text=['PRIVATE Nisi history review — not authenticated consent.',
      'Existing demo raw run evidence is already retained; this choice controls ONLY an additional metadata journal.',
      'Declared retention: 14 days. NO automatic sweeper or secure erasure. Hashes are linkable, not anonymous.',
      'No learning, execution authority or publication is enabled.',
      'Destination: '+escaped(destination),'Metadata:',escaped(shown.preview),
      'Digest: '+sourceDigest,'To store, enter exactly: '+expectedAnswer,'Anything else declines.\n'].join('\n');
    const controller=new AbortController(); let timer, onAbort, answer;
    try {
      const cancelled=new Promise(resolve=>{
        onAbort=()=>{if(aborted()) resolve({kind:'signal'});};
        if(signal!==null) listen.call(signal,'abort',onAbort);
        timer=setTimeout(()=>resolve({kind:aborted()?'signal':'timeout'}),req.promptTimeoutMs);
      });
      const requested=Promise.resolve().then(()=>aborted()?{kind:'signal'}:
        req.prompt(Object.freeze({text,expectedAnswer,signal:controller.signal,timeoutMs:req.promptTimeoutMs})))
        .catch(()=>({kind:'error'}));
      answer=await Promise.race([requested,cancelled]);
    } finally {
      clearTimeout(timer); if(signal!==null && onAbort) unlisten.call(signal,'abort',onAbort);
      controller.abort();
    }
    if (aborted()) return refused('ABORTED');
    try {
      if(answer?.kind==='answer') {
        exact(answer,['kind','text'],'PROMPT_ERROR');
        if(typeof answer.text!=='string') throw Error();
        if(answer.text!==expectedAnswer) return refused(['','no','n'].includes(answer.text)?'DECLINED':'ANSWER_MISMATCH');
      } else {
        exact(answer,['kind'],'PROMPT_ERROR');
        return refused(({eof:'EOF',timeout:'TIMEOUT','no-tty':'NO_TTY',signal:'ABORTED',error:'PROMPT_ERROR'})[answer.kind]??'PROMPT_ERROR');
      }
    } catch { return refused('PROMPT_ERROR'); }
    const rechecked=readPreview(previewCall);
    if (aborted()) return refused('ABORTED');
    if (rechecked.reason || rechecked.p.sha256!==sourceDigest) return refused('DIGEST_CHANGED');
    let now;
    try { now=req.clock(); } catch { return refused(aborted()?'ABORTED':'INVALID_CLOCK'); }
    if(aborted()) return refused('ABORTED');
    if(!safeTime(now) || !safeTime(now+1209600000)) return refused('INVALID_CLOCK');
    const projectId='task:'+shown.preview.taskFingerprint;
    const declaration=Object.freeze({schemaVersion:'nisi-repository-history-declaration/v1',
      declarationId:'cli-history.'+randomUUID(),projectId,sourceDigest,issuedAt:now,expiresAt:now+60000,
      createdAt:now,retentionMs:1209600000,consentClass:'WRITTEN_DECLARATION',
      destination:'LOCAL_OBSERVATION_JOURNAL_ONLY',rawContentPersisted:false,networkEgress:false,learningInfluence:false});
    let opened; ownerOpenAttempted=true;
    try { opened=req.openOwner(Object.freeze({path:destination,config:Object.freeze({projectId,maxEntries:32,
      heartbeatTtlMs:30000,redactPaths:Object.freeze([])}),now})); }
    catch { return refused(aborted()?'ABORTED':'OPEN_FAILED'); }
    if(aborted()) return refused('ABORTED');
    if(opened?.status!=='OPENED') return refused('OPEN_FAILED');
    const clock=()=>{
      if(aborted()) throw Error('ABORTED');
      const value=req.clock();
      if(aborted()) throw Error('ABORTED');
      return value;
    };
    captureCallAttempted=true;
    try {
      const c=captureCall({owner:opened.owner,declaration,clock});
      if(!captureShape(c)) return result('UNCERTAIN','CAPTURE_UNCONFIRMED');
      capture=c; return result(c.status,c.reason);
    } catch { return result('UNCERTAIN','CAPTURE_UNCONFIRMED'); }
  } catch { return captureCallAttempted?result('UNCERTAIN','CAPTURE_UNCONFIRMED'):refused('INTERNAL_ERROR'); }
  finally { if(guarded) active.delete(host); }
}

```

## hosts/history/terminal-history-prompt-v1.mjs SHA256 c50aa12893b30dafef712383283869171a0d796dba2bb2093787f5316a943e36
```js
// Bounded trusted terminal adapter. It returns raw outcomes, never approval.
const getter=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const listen=EventTarget.prototype.addEventListener, unlisten=EventTarget.prototype.removeEventListener;
export async function promptRepositoryHistoryV1({text,expectedAnswer,signal,timeoutMs,input,output}) {
  if(input?.isTTY!==true || output?.isTTY!==true) return Object.freeze({kind:'no-tty'});
  const aborted=()=>signal!==null && getter.call(signal);
  if(aborted()) return Object.freeze({kind:'signal'});
  if(typeof text!=='string' || typeof expectedAnswer!=='string' || !Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>120000)
    return Object.freeze({kind:'error'});
  return new Promise(resolve=>{
    let done=false,timer,buffer=Buffer.alloc(0); const paused=input.isPaused();
    const finish=kind=>{
      if(done) return; done=true;
      clearTimeout(timer);
      input.removeListener('data',onData); input.removeListener('end',onEnd); input.removeListener('error',onError);
      output.removeListener('error',onError);
      if(signal!==null) unlisten.call(signal,'abort',onAbort);
      if(paused) input.pause();
      buffer=Buffer.alloc(0); resolve(Object.freeze(kind));
    };
    const onAbort=()=>{if(aborted()) finish({kind:'signal'});};
    const onEnd=()=>finish({kind:aborted()?'signal':'eof'});
    const onError=()=>finish({kind:aborted()?'signal':'error'});
    const onData=chunk=>{
      if(aborted()) return finish({kind:'signal'});
      if(typeof chunk!=='string' && !Buffer.isBuffer(chunk)) return finish({kind:'error'});
      const bytes=typeof chunk==='string'?Buffer.from(chunk):chunk;
      if(bytes.includes(3)) return finish({kind:'signal'});
      if(buffer.length+bytes.length>1026) return finish({kind:'error'});
      buffer=Buffer.concat([buffer,bytes]); const end=buffer.indexOf(10);
      if(end<0) { if(buffer.length>1025) finish({kind:'error'}); return; }
      if(end!==buffer.length-1) return finish({kind:'error'});
      const content=buffer.subarray(0,end>0&&buffer[end-1]===13?end-1:end);
      if(content.length>1024) return finish({kind:'error'});
      let value; try {value=new TextDecoder('utf-8',{fatal:true}).decode(content);} catch {return finish({kind:'error'});}
      finish({kind:'answer',text:value});
    };
    input.on('data',onData); input.on('end',onEnd); input.on('error',onError); output.on('error',onError);
    if(signal!==null) listen.call(signal,'abort',onAbort);
    timer=setTimeout(()=>finish({kind:aborted()?'signal':'timeout'}),timeoutMs);
    try {output.write(text); if(!done) input.resume();} catch {onError();}
  });
}

```

## examples/repository-live-model.mjs SHA256 c7b81ab3d563af66fa96fd0a9d1d60f69222c4869027f5436afd753e9598a19b
```js
// PRIVATE, explicit opt-in demonstration. Only the pinned source-reviewed A/B
// fixture may execute; a different model repair is retained as data and refused.
// Not a sandbox, blind benchmark, application acceptance or release command.
import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { createReviewedLiveFixtureV1 } from './repository-task/reviewed-live-fixture-v1.mjs';
import { createReviewedLiveModelLaneV1, createReviewedLiveModelLaneV2 } from '../hosts/repository/reviewed-live-model-v1.mjs';
import { createReviewedLiveModelLaneV3 } from '../hosts/repository/reviewed-live-model-v3.mjs';
import { readLiveModelSelectionV3 } from '../hosts/repository/live-model-selection-v3.mjs';
import { createReviewedRepositoryHostV1 } from '../hosts/repository/reviewed-workflow-v1.mjs';
import { buildNativeArtifactKernel } from '../hosts/swift-verifier/build.mjs';
import { createRepositoryLiveModelRunV1, readRepositoryLiveModelRunV1, createRepositoryLiveModelRunV2, readRepositoryLiveModelRunV2 } from '../receipts/repository-live-model-run-v1.mjs';
import { createRepositoryLiveModelRunV3, readRepositoryLiveModelRunV3 } from '../receipts/repository-live-model-run-v3.mjs';
import { sha256Text } from '../workflow/contracts.mjs';
import { reviewRepositoryHistoryV1 } from '../hosts/history/review-repository-history-v1.mjs';
import { promptRepositoryHistoryV1 } from '../hosts/history/terminal-history-prompt-v1.mjs';
import { openJournalOwner } from '../history/journal-owner-v2.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const help = 'PRIVATE ONLY: node examples/repository-live-model.mjs --approved-reviewed-fixture --endpoint http://127.0.0.1:1234/v1/chat/completions --author-model EXISTING_MODEL --reviewer-model DIFFERENT_EXISTING_MODEL [--author-output-mode json_schema|json_instruction --reviewer-output-mode json_schema|json_instruction]. Both mode flags are required together; omitted flags preserve v1 strict-schema behavior. V3 instead requires both --author-api and --reviewer-api (NATIVE_API|CHAT_COMPLETIONS), both per-role --endpoint and --model flags, and no legacy --endpoint. Native roles also require --ROLE-instance, --ROLE-profile nisi-native-chat-content-v1, --ROLE-reasoning off; chat roles require --ROLE-output-mode. Native termination remains NOT_REPORTED. No automatic fallback or admission of unregistered code.';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const safeCode = e => typeof e?.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/u.exec(e.code)?.[0] === e.code ? e.code : 'LIVE_DEMO_ERROR';

export function parseLiveDemoInvocation(args) {
  if(!Array.isArray(args)) fail('LIVE_DEMO_ARGUMENTS');
  const rest=[]; let reviewHistory=false;
  for(let i=0;i<args.length;i++) {
    const d=Object.getOwnPropertyDescriptor(args,String(i));
    if(!d || !Object.hasOwn(d,'value') || typeof d.value!=='string') fail('LIVE_DEMO_ARGUMENTS');
    if(d.value==='--review-history') { if(reviewHistory) fail('LIVE_DEMO_ARGUMENTS'); reviewHistory=true; }
    else rest.push(d.value);
  }
  if(reviewHistory && rest.includes('--help')) fail('LIVE_DEMO_ARGUMENTS');
  return Object.freeze({selected:parseLiveDemoArguments(rest),reviewHistory});
}

export function parseLiveDemoArguments(args) {
  if (!Array.isArray(args) || args.some(x => typeof x !== 'string')) fail('LIVE_DEMO_ARGUMENTS');
  if (args.length === 1 && args[0] === '--help') return null;
  const values = new Map();
  const roleFields = ['api', 'endpoint', 'model', 'instance', 'profile', 'reasoning', 'output-mode'];
  const roleFlags = ['author', 'reviewer'].flatMap(role => roleFields.map(field => `--${role}-${field}`));
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--approved-reviewed-fixture','--endpoint', ...roleFlags].includes(key) || values.has(key)) fail('LIVE_DEMO_ARGUMENTS');
    if (key === '--approved-reviewed-fixture') values.set(key, true);
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) fail('LIVE_DEMO_ARGUMENTS');
      values.set(key, value);
    }
  }
  const apiAware = values.has('--author-api') || values.has('--reviewer-api');
  if (apiAware) {
    if (values.get('--approved-reviewed-fixture') !== true) fail('LIVE_DEMO_EXPLICIT_APPROVAL_REQUIRED');
    if (!values.has('--author-api') || !values.has('--reviewer-api') || values.has('--endpoint')) fail('LIVE_DEMO_API_SELECTION');
    const selected = {};
    for (const role of ['author', 'reviewer']) {
      const value = {};
      for (const field of roleFields) if (values.has(`--${role}-${field}`))
        value[field === 'instance' ? 'expectedModelInstance' : field === 'output-mode' ? 'outputMode' : field] = values.get(`--${role}-${field}`);
      selected[role] = value;
    }
    return readLiveModelSelectionV3(selected);
  }
  if (roleFlags.filter(flag => !['--author-model', '--reviewer-model', '--author-output-mode', '--reviewer-output-mode'].includes(flag))
    .some(flag => values.has(flag))) fail('LIVE_DEMO_API_SELECTION');
  if (values.get('--approved-reviewed-fixture') !== true || ['--endpoint','--author-model','--reviewer-model'].some(k => !values.has(k))) fail('LIVE_DEMO_EXPLICIT_APPROVAL_REQUIRED');
  const modeKeys = ['--author-output-mode', '--reviewer-output-mode'], modeAware = modeKeys.some(k => values.has(k));
  if (modeAware && modeKeys.some(k => !values.has(k) || !['json_schema', 'json_instruction'].includes(values.get(k)))) fail('LIVE_DEMO_OUTPUT_MODE');
  return Object.freeze({ endpoint: values.get('--endpoint'), authorModel: values.get('--author-model'), reviewerModel: values.get('--reviewer-model'),
    ...(modeAware ? { authorOutputMode: values.get(modeKeys[0]), reviewerOutputMode: values.get(modeKeys[1]) } : {}) });
}

// Trusted orchestration seam, also used with inert owners in portable tests.
// Evidence storage failure must never bypass separately awaited host settlement.
export async function collectLiveHostEvidenceV1(host, report, retain, { settlementTimeoutMs = 30000 } = {}) {
  if (!Number.isSafeInteger(settlementTimeoutMs) || settlementTimeoutMs < 1 || settlementTimeoutMs > 30000) fail('LIVE_DEMO_SETTLEMENT_BUDGET');
  const errors = []; let hostResult = null;
  try { await retain('engine-report.json', report); }
  catch (e) { errors.push({ stage: 'engine-report.json', code: safeCode(e) }); }
  let timer;
  try {
    const observed = await Promise.race([
      Promise.resolve().then(() => host.settled()).then(value => ({ status: 'SETTLED', value }),
        error => ({ status: 'ERROR', error })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ status: 'UNCONFIRMED' }), settlementTimeoutMs); }),
    ]);
    if (observed.status === 'SETTLED') hostResult = observed.value;
    else errors.push({ stage: 'host.settled', code: observed.status === 'ERROR' ? safeCode(observed.error) : 'LIVE_DEMO_HOST_SETTLEMENT_UNCONFIRMED' });
  } finally { clearTimeout(timer); }
  if (hostResult !== null) {
    try { await retain('host-result.json', hostResult); }
    catch (e) { errors.push({ stage: 'host-result.json', code: safeCode(e) }); }
  }
  return { hostResult, errors };
}

export async function runPrivateLiveDemo(args) {
  const {selected,reviewHistory} = parseLiveDemoInvocation(args);
  if (selected === null) return { help: help+' Optional --review-history asks for a separate interactive metadata-storage decision after settlement; it never approves storage itself. Requires stdin and stdout TTY. Existing demo evidence retention is unchanged.', exitCode: 0 };
  if(reviewHistory && (process.stdin.isTTY!==true || process.stdout.isTTY!==true)) fail('LIVE_HISTORY_TTY_REQUIRED');
  // Reject modified sources and invalid transport/model configuration before
  // starting any compiler, child, HTTP request or materialized fixture workspace.
  const fixture = await createReviewedLiveFixtureV1(), createdAtMs = Date.now();
  const apiAware = Object.hasOwn(selected, 'author'), modeAware = Object.hasOwn(selected, 'authorOutputMode');
  const lane = (apiAware ? createReviewedLiveModelLaneV3 : modeAware ? createReviewedLiveModelLaneV2 : createReviewedLiveModelLaneV1)({ suite: fixture.suite, reviewedSourceFingerprint: fixture.reviewedSourceFingerprint,
    ...selected, timeoutMs: 90000, maxOutputTokens: 2048,
    approval: { id: 'private.reviewed-fixture.opt-in', expiresAtMs: createdAtMs + 360000 } });
  const buildRoot = path.join(root, '.build'); await fs.mkdir(buildRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(buildRoot, 'repository-live-demo-'));
  const retained = [], controller = new AbortController(); let build = null, host = null, report = null, hostResult = null, receipt = null;
  let failure = null, setupDurationMs = null, workflowDurationMs = null;
  let historyReview = null;
  const diagnosticErrors = [];
  async function retain(name, value) {
    const content = JSON.stringify(value, null, 2) + '\n';
    await fs.writeFile(path.join(directory, name), content, { flag: 'wx', mode: 0o600 });
    retained.push({ path: name, byteLength: Buffer.byteLength(content), sha256: sha256Text(content) });
  }
  const interrupt = () => { controller.abort(); lane.revoke(); };
  const checkInterrupted = () => { if (controller.signal.aborted) fail('ABORTED'); };
  async function retainDiagnostic(name, value) {
    try { await retain(name, value); }
    catch (e) { diagnosticErrors.push({ stage: name, code: safeCode(e) }); }
  }
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    await retain('preflight.json', { createdAt: new Date(createdAtMs).toISOString(), node: process.version,
      platform: process.platform, architecture: process.arch, scope: 'EXACT_REVIEWED_FIXTURE_REPAIR_REVIEW',
      fixture: { task: fixture.task, reviewedSourceManifest: fixture.reviewedSourceManifest,
        reviewedSourceFingerprint: fixture.reviewedSourceFingerprint, suite: fixture.suite,
        preparationFingerprints: fixture.preparations.map(p => p.fingerprint) }, modelLane: lane.snapshot(),
      disclosure: 'PRIVATE_LOCAL_ONLY', maximumModelCalls: 2, hostSeedInference: false, arbitraryCodeExecution: false });
    checkInterrupted();
    const setupStart = performance.now(); build = buildNativeArtifactKernel();
    setupDurationMs = Math.ceil(performance.now() - setupStart); await retain('native-build.json', build);
    checkInterrupted();
    const parentRoot = path.join(directory, 'workspaces'); await fs.mkdir(parentRoot, { mode: 0o700 });
    host = createReviewedRepositoryHostV1({ suite: fixture.suite, build, scope: 'operator-exclusive-static-local-v1',
      targets: fixture.targets, parentRoot, staticTimeoutMs: 5000, totalTestTimeoutMs: 10000, testTimeoutMs: 5000, closeGraceMs: 500 });
    const workflowStart = performance.now();
    report = await host.run({ authorizeContext: lane.authorizeContext, author: lane.author, reviewers: lane.reviewers, signal: controller.signal });
    workflowDurationMs = Math.ceil(performance.now() - workflowStart);
    const collected = await collectLiveHostEvidenceV1(host, report, retain);
    hostResult = collected.hostResult; diagnosticErrors.push(...collected.errors);
    if (hostResult === null) fail('LIVE_DEMO_HOST_COLLECTION_FAILED');
    if(reviewHistory) historyReview=await reviewRepositoryHistoryV1({host,runDirectory:directory,
      clock:Date.now,signal:controller.signal,promptTimeoutMs:120000,
      prompt:p=>promptRepositoryHistoryV1({...p,input:process.stdin,output:process.stdout}),
      openOwner:req=>openJournalOwner({...req,fs:syncFs})});
    // Bounded observation is NOT a forced idle transition or a server-stop claim.
    const observationEnd = performance.now() + 2000;
    while (!controller.signal.aborted && lane.snapshot().lifecycle.pendingTransports > 0 && performance.now() < observationEnd) await delay(20);
    const context = { lane, hostResult };
    receipt = (apiAware ? createRepositoryLiveModelRunV3 : modeAware ? createRepositoryLiveModelRunV2 : createRepositoryLiveModelRunV1)(context);
    (apiAware ? readRepositoryLiveModelRunV3 : modeAware ? readRepositoryLiveModelRunV2 : readRepositoryLiveModelRunV1)(receipt, context);
    await retain('live-run-receipt.json', receipt);
  } catch (e) { failure = safeCode(e); }
  finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    // Snapshots preserve validated but refused normalized model output; transport
    // receipts retain hashes, not raw HTTP bodies. Do not claim raw-response replay.
    try { await retainDiagnostic('model-lane-final.json', lane.snapshot()); }
    catch (e) { diagnosticErrors.push({ stage: 'model-lane.snapshot', code: safeCode(e) }); }
    if (host) {
      try { await retainDiagnostic('host-late-observations.json', host.lateObservations()); }
      catch (e) { diagnosticErrors.push({ stage: 'host.lateObservations', code: safeCode(e) }); }
    }
  }
  const summary = { schemaVersion: apiAware ? 'nisi-private-live-demo-summary-v3' : 'nisi-private-live-demo-summary-v1',
    status: failure === null && diagnosticErrors.length === 0 && receipt?.status === 'SCOPED_LIVE_REPAIR_REVIEW_PASS' ? 'SCOPED_LIVE_REPAIR_REVIEW_PASS' : 'INCOMPLETE',
    errorCode: failure, diagnosticErrors, directory, receiptFingerprint: receipt?.fingerprint ?? null,
    setupDurationMs, workflowDurationMs, usage: receipt?.usage ?? null,
    ...(apiAware ? { modelProtocols: { author: selected.author.api, reviewer: selected.reviewer.api },
      usageProvenance: receipt?.usageProvenance ?? null,
      nativeCompletion: { roles: ['author', 'reviewer'].filter(role => selected[role].api === 'NATIVE_API'),
        termination: 'NOT_REPORTED', serverCompletionAttested: false } } : {}),
    workflowOutcome: report?.workflowOutcome ?? null, hostState: hostResult?.state ?? host?.status() ?? 'NOT_STARTED',
    ...(reviewHistory ? {historyReview} : {}),
    modelPhase: lane.snapshot().phase, remoteInferenceStopped: 'NOT_OBSERVED', retained: [...retained],
    baselineFailureExpected: true, blindBenchmark: false, comparativeBenefitMeasured: false,
    rawHttpBodyRetained: false, applied: false, nativeAppAccepted: false, publicationAuthorized: false };
  let summaryRetained = false;
  try { await retain('summary.json', summary); summaryRetained = true; }
  catch (e) {
    summary.status = 'INCOMPLETE'; diagnosticErrors.push({ stage: 'summary.json', code: safeCode(e) });
  }
  // If disk retention fails, the caller still receives the adverse in-memory
  // summary. It cannot claim a durable/reproducible successful run.
  return { ...summary, summaryRetained, exitCode: summary.status === 'SCOPED_LIVE_REPAIR_REVIEW_PASS' ? 0 : 1 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runPrivateLiveDemo(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2)); process.exitCode = result.exitCode;
  } catch (e) { console.error(JSON.stringify({ status: 'INCOMPLETE', code: safeCode(e), help })); process.exitCode = 2; }
}

```
