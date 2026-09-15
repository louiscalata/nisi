import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'examples/repository-live-model.mjs');
const baseArgs = ['--approved-reviewed-fixture', '--endpoint', 'http://127.0.0.1:1234', '--author-model', 'author', '--reviewer-model', 'reviewer'];

const stubSource = `
export const events=[];
const report=Object.freeze({runId:'run-1',workflowOutcome:'FAILED',outcome:'FAILED',stages:[],candidateFingerprint:null});
const hostResult=Object.freeze({schemaVersion:'nisi-reviewed-repository-host-v1',state:'SETTLED',report,applied:false,sandboxed:false,authorizing:false,certificationGranted:false});
const lane=()=>({authorizeContext:{},author:{},reviewers:{},revoke(){events.push('revoke')},snapshot:()=>({phase:'DONE',lifecycle:{pendingTransports:0}})});
export async function createReviewedLiveFixtureV1(){events.push('fixture');return {suite:{},reviewedSourceFingerprint:'a'.repeat(64),task:{},targets:[],preparations:[]};}
export function createReviewedLiveModelLaneV1(){events.push('lane');return lane();}
export function createReviewedLiveModelLaneV2(){events.push('lane');return lane();}
export function createReviewedLiveModelLaneV3(){events.push('lane');return lane();}
export function readLiveModelSelectionV3(value){return value;}
export function buildNativeArtifactKernel(){events.push('build');return {};}
export function createReviewedRepositoryHostV1(){events.push('host');return {run:async()=>{events.push('run');return report;},settled:async()=>{events.push('settled');return hostResult;},historyPreview:()=>({}),captureHistory:()=>({}),incidentPreview:()=>({}),captureIncident:()=>({}),lateObservations:()=>({})};}
const receipt=()=>({status:'INCOMPLETE',fingerprint:'f'.repeat(64),usage:null});
export function createRepositoryLiveModelRunV1(){events.push('receipt');return receipt();}
export function readRepositoryLiveModelRunV1(){return true;}
export function createRepositoryLiveModelRunV2(){events.push('receipt');return receipt();}
export function readRepositoryLiveModelRunV2(){return true;}
export function createRepositoryLiveModelRunV3(){events.push('receipt');return receipt();}
export function readRepositoryLiveModelRunV3(){return true;}
export function sha256Text(){return 'd'.repeat(64);}
const stored=Object.freeze({schemaVersion:'nisi-repository-history-review/v1',status:'STORED',reason:null,sourceDigest:'d'.repeat(64),ownerOpenAttempted:true,captureCallAttempted:true,capture:{status:'STORED'},cancelledAfterCaptureCall:false,authorizing:false});
export async function reviewRepositoryHistoryV1(){events.push('history');return stored;}
export async function reviewRepositoryIncidentsV1(){events.push('incident');return stored;}
export async function promptRepositoryHistoryV1(){return {kind:'answer',text:'STORE d'};}
export function openJournalOwner(){return {};}
`;

async function relocatedCli(t){
  const directory=await fs.mkdtemp(path.join(root,'.build/repository-incident-cli-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const stubPath=path.join(directory,'stubs.mjs');
  await fs.writeFile(stubPath,stubSource,{flag:'wx'});
  let source=await fs.readFile(sourcePath,'utf8');
  const imports=/^import\s+(.+?)\s+from\s+(['"])(?!node:)([^'\"]+)\2;\s*$/gm;
  source=source.replace(imports,(_whole,clause)=>{
    if(!clause.startsWith('{'))throw new Error(`unexpected project import: ${clause}`);
    const names=clause.slice(1,-1).split(',').map(part=>part.trim()).filter(Boolean)
      .map(part=>part.includes(' as ')?part.replace(/\s+as\s+/,': '):part).join(', ');
    return `const {${names}} = stubs;`;
  });
  const originalRoot="const root = fileURLToPath(new URL('../', import.meta.url));";
  assert.equal(source.split(originalRoot).length-1,1);
  source=source.replace(originalRoot,`const root = ${JSON.stringify(directory+path.sep)};`);
  source=`import * as stubs from './stubs.mjs';\n${source}`;
  const cliPath=path.join(directory,'repository-live-model.mjs');
  await fs.writeFile(cliPath,source,{flag:'wx'});
  const cli=await import(`${pathToFileURL(cliPath).href}?test=${Date.now()}-${Math.random()}`);
  return {cli,events:(await import(pathToFileURL(stubPath).href)).events};
}

function withTtyState(isTTY,fn){
  const stdin=process.stdin,stdout=process.stdout;
  const oldIn=Object.getOwnPropertyDescriptor(stdin,'isTTY'),oldOut=Object.getOwnPropertyDescriptor(stdout,'isTTY');
  Object.defineProperty(stdin,'isTTY',{configurable:true,value:isTTY});
  Object.defineProperty(stdout,'isTTY',{configurable:true,value:isTTY});
  return Promise.resolve().then(fn).finally(()=>{
    if(oldIn)Object.defineProperty(stdin,'isTTY',oldIn);else delete stdin.isTTY;
    if(oldOut)Object.defineProperty(stdout,'isTTY',oldOut);else delete stdout.isTTY;
  });
}

function withTty(fn){
  return withTtyState(true,fn);
}

test('absent incident flag preserves the exact legacy invocation result',async t=>{
  const {cli}=await relocatedCli(t);
  assert.deepEqual(cli.parseLiveDemoInvocation(baseArgs),{selected:cli.parseLiveDemoArguments(baseArgs),reviewHistory:false});
});

test('incident duplicates and help combinations are rejected',async t=>{
  const {cli}=await relocatedCli(t);
  assert.throws(()=>cli.parseLiveDemoInvocation([...baseArgs,'--review-incidents','--review-incidents']),{code:'LIVE_DEMO_ARGUMENTS'});
  assert.throws(()=>cli.parseLiveDemoInvocation(['--help','--review-incidents']),{code:'LIVE_DEMO_ARGUMENTS'});
});

test('non-TTY incident review refuses before fixture, compiler, model, or workspace setup',async t=>{
  const {cli,events}=await relocatedCli(t);
  await withTtyState(false,()=>assert.rejects(cli.runPrivateLiveDemo([...baseArgs,'--review-incidents']),{code:'LIVE_INCIDENT_TTY_REQUIRED'}));
  assert.deepEqual(events,[]);
});

test('both reviews run in flag-independent order after settled host',async t=>{
  for(const flags of [['--review-incidents','--review-history'],['--review-history','--review-incidents']]){
    const {cli,events}=await relocatedCli(t);
    await withTty(()=>cli.runPrivateLiveDemo([...baseArgs,...flags]));
    assert.deepEqual(events.slice(-4),['settled','history','incident','receipt']);
  }
});

test('stored incident observation cannot upgrade the original failed run verdict',async t=>{
  const {cli}=await relocatedCli(t);
  const result=await withTty(()=>cli.runPrivateLiveDemo([...baseArgs,'--review-incidents']));
  assert.equal(result.incidentReview.status,'STORED');
  assert.equal(result.workflowOutcome,'FAILED');
  assert.equal(result.status,'INCOMPLETE');
  assert.equal(result.exitCode,1);
});

test('incident summary property is present only when explicitly selected',async t=>{
  let relocated=await relocatedCli(t);
  const ordinary=await relocated.cli.runPrivateLiveDemo(baseArgs);
  assert.equal(Object.hasOwn(ordinary,'incidentReview'),false);
  relocated=await relocatedCli(t);
  const historyOnly=await withTty(()=>relocated.cli.runPrivateLiveDemo([...baseArgs,'--review-history']));
  assert.equal(Object.hasOwn(historyOnly,'incidentReview'),false);
  relocated=await relocatedCli(t);
  const opted=await withTty(()=>relocated.cli.runPrivateLiveDemo([...baseArgs,'--review-incidents']));
  assert.equal(Object.hasOwn(opted,'incidentReview'),true);
});
