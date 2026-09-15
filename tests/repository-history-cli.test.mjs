import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'examples/repository-live-model.mjs');
const baseArgs = ['--approved-reviewed-fixture', '--endpoint', 'http://127.0.0.1:1234', '--author-model', 'author', '--reviewer-model', 'reviewer'];

const stubSource = `
export const events = [];
const report = Object.freeze({runId:'run-1', workflowOutcome:'COMPLETED', outcome:'COMPLETED', stages:[], candidateFingerprint:null});
const hostResult = Object.freeze({schemaVersion:'nisi-reviewed-repository-host-v1', state:'SETTLED', report, applied:false, sandboxed:false, authorizing:false, certificationGranted:false});
const lane = () => ({authorizeContext:{}, author:{}, reviewers:{}, revoke(){events.push('revoke')}, snapshot:()=>({phase:'DONE', lifecycle:{pendingTransports:0}})});
export async function createReviewedLiveFixtureV1(){ events.push('fixture'); return {suite:{}, reviewedSourceFingerprint:'a'.repeat(64), task:{}, targets:[], preparations:[]}; }
export function createReviewedLiveModelLaneV1(){ events.push('lane'); return lane(); }
export function createReviewedLiveModelLaneV2(){ events.push('lane'); return lane(); }
export function createReviewedLiveModelLaneV3(){ events.push('lane'); return lane(); }
export function readLiveModelSelectionV3(value){ return value; }
export function buildNativeArtifactKernel(){ events.push('build'); return {}; }
export function createReviewedRepositoryHostV1(){ events.push('host'); return {run:async()=>{events.push('run'); return report;}, settled:async()=>{events.push('settled'); return hostResult;}, historyPreview:()=>({}), captureHistory:()=>({}), lateObservations:()=>({})}; }
export function createRepositoryLiveModelRunV1(){ events.push('receipt'); return {status:'SCOPED_LIVE_REPAIR_REVIEW_PASS', fingerprint:'f'.repeat(64), usage:null}; }
export function readRepositoryLiveModelRunV1(){ return true; }
export function createRepositoryLiveModelRunV2(){ return {status:'SCOPED_LIVE_REPAIR_REVIEW_PASS', fingerprint:'f'.repeat(64), usage:null}; }
export function readRepositoryLiveModelRunV2(){ return true; }
export function createRepositoryLiveModelRunV3(){ return {status:'SCOPED_LIVE_REPAIR_REVIEW_PASS', fingerprint:'f'.repeat(64), usage:null}; }
export function readRepositoryLiveModelRunV3(){ return true; }
export function sha256Text(value){ return 'd'.repeat(64); }
export async function reviewRepositoryHistoryV1(){ events.push('review'); return Object.freeze({schemaVersion:'nisi-repository-history-review/v1',status:'STORED',reason:null,sourceDigest:'d'.repeat(64),ownerOpenAttempted:true,captureCallAttempted:true,capture:{status:'STORED'},cancelledAfterCaptureCall:false,authorizing:false}); }
`;

async function relocatedCli() {
  const directory = await fs.mkdtemp(path.join(root, '.build/repository-history-cli-test-'));
  const stubPath = path.join(directory, 'stubs.mjs');
  await fs.writeFile(stubPath, stubSource, {flag:'wx'});
  let source = await fs.readFile(sourcePath, 'utf8');
  const imports = /^import\s+(.+?)\s+from\s+(['"])(?!node:)([^'\"]+)\2;\s*$/gm;
  source = source.replace(imports, (_whole, clause) => {
    if (!clause.startsWith('{')) throw new Error(`unexpected project import: ${clause}`);
    const names = clause.slice(1, -1).split(',').map(part => part.trim()).filter(Boolean)
      .map(part => part.includes(' as ') ? part.replace(/\s+as\s+/, ': ') : part).join(', ');
    return `const {${names}} = stubs;`;
  });
  source = `import * as stubs from './stubs.mjs';\n${source}`;
  const cliPath = path.join(directory, 'repository-live-model.mjs');
  await fs.writeFile(cliPath, source, {flag:'wx'});
  const cli = await import(`${pathToFileURL(cliPath).href}?test=${Date.now()}-${Math.random()}`);
  return {cli, events: (await import(pathToFileURL(stubPath).href)).events};
}

function withTty(fn) {
  const stdin = process.stdin, stdout = process.stdout;
  const oldIn = Object.getOwnPropertyDescriptor(stdin, 'isTTY');
  const oldOut = Object.getOwnPropertyDescriptor(stdout, 'isTTY');
  Object.defineProperty(stdin, 'isTTY', {configurable:true, value:true});
  Object.defineProperty(stdout, 'isTTY', {configurable:true, value:true});
  return Promise.resolve().then(fn).finally(() => {
    if (oldIn) Object.defineProperty(stdin, 'isTTY', oldIn); else delete stdin.isTTY;
    if (oldOut) Object.defineProperty(stdout, 'isTTY', oldOut); else delete stdout.isTTY;
  });
}

test('new parser strips one review request and preserves legacy selection', async () => {
  const {cli} = await relocatedCli();
  assert.deepEqual(cli.parseLiveDemoInvocation([...baseArgs, '--review-history']), {selected: cli.parseLiveDemoArguments(baseArgs), reviewHistory: true});
  assert.throws(() => cli.parseLiveDemoInvocation([...baseArgs, '--review-history', '--review-history']), {code:'LIVE_DEMO_ARGUMENTS'});
  assert.throws(() => cli.parseLiveDemoInvocation(['--help', '--review-history']), {code:'LIVE_DEMO_ARGUMENTS'});
});

test('help remains standalone and inert', async () => {
  const {cli, events} = await relocatedCli();
  const result = await cli.runPrivateLiveDemo(['--help']);
  assert.equal(result.exitCode, 0); assert.equal(typeof result.help, 'string'); assert.deepEqual(events, []);
});

test('non-TTY review refuses before fixture, build, or model startup', async () => {
  const {cli, events} = await relocatedCli();
  await assert.rejects(cli.runPrivateLiveDemo([...baseArgs, '--review-history']), {code:'LIVE_HISTORY_TTY_REQUIRED'});
  assert.deepEqual(events, []);
});

test('requested history review occurs after host settlement and receipt remains original', async () => {
  const {cli, events} = await relocatedCli();
  const result = await withTty(() => cli.runPrivateLiveDemo([...baseArgs, '--review-history']));
  assert.deepEqual(events.slice(-3), ['settled', 'review', 'receipt']);
  assert.equal(result.historyReview.status, 'STORED');
  assert.equal(result.receiptFingerprint, 'f'.repeat(64));
});

test('default invocation does not add historyReview or invoke review', async () => {
  const {cli, events} = await relocatedCli();
  const result = await cli.runPrivateLiveDemo(baseArgs);
  assert.equal(Object.hasOwn(result, 'historyReview'), false);
  assert.equal(events.includes('review'), false);
  assert.equal(result.receiptFingerprint, 'f'.repeat(64));
});
