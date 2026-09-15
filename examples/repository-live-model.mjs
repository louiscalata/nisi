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
import { reviewRepositoryIncidentsV1 } from '../hosts/history/review-repository-incidents-v1.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const help = 'PRIVATE ONLY: node examples/repository-live-model.mjs --approved-reviewed-fixture --endpoint http://127.0.0.1:1234/v1/chat/completions --author-model EXISTING_MODEL --reviewer-model DIFFERENT_EXISTING_MODEL [--author-output-mode json_schema|json_instruction --reviewer-output-mode json_schema|json_instruction]. Both mode flags are required together; omitted flags preserve v1 strict-schema behavior. V3 instead requires both --author-api and --reviewer-api (NATIVE_API|CHAT_COMPLETIONS), both per-role --endpoint and --model flags, and no legacy --endpoint. Native roles also require --ROLE-instance, --ROLE-profile nisi-native-chat-content-v1, --ROLE-reasoning off; chat roles require --ROLE-output-mode. Native termination remains NOT_REPORTED. No automatic fallback or admission of unregistered code.';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const safeCode = e => typeof e?.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/u.exec(e.code)?.[0] === e.code ? e.code : 'LIVE_DEMO_ERROR';

export function parseLiveDemoInvocation(args) {
  if(!Array.isArray(args)) fail('LIVE_DEMO_ARGUMENTS');
  const rest=[]; let reviewHistory=false,reviewIncidents=false;
  for(let i=0;i<args.length;i++) {
    const d=Object.getOwnPropertyDescriptor(args,String(i));
    if(!d || !Object.hasOwn(d,'value') || typeof d.value!=='string') fail('LIVE_DEMO_ARGUMENTS');
    if(d.value==='--review-history') { if(reviewHistory) fail('LIVE_DEMO_ARGUMENTS'); reviewHistory=true; }
    else if(d.value==='--review-incidents') { if(reviewIncidents) fail('LIVE_DEMO_ARGUMENTS'); reviewIncidents=true; }
    else rest.push(d.value);
  }
  if((reviewHistory || reviewIncidents) && rest.includes('--help')) fail('LIVE_DEMO_ARGUMENTS');
  return Object.freeze({selected:parseLiveDemoArguments(rest),reviewHistory,...(reviewIncidents?{reviewIncidents:true}:{})});
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
  const {selected,reviewHistory,reviewIncidents=false} = parseLiveDemoInvocation(args);
  if (selected === null) return { help: help+' Optional --review-history asks for a separate interactive metadata-storage decision after settlement; --review-incidents separately selects and confirms one failure observation. Neither flag approves storage itself. Both require stdin and stdout TTY. Existing demo evidence retention is unchanged.', exitCode: 0 };
  if(reviewHistory && (process.stdin.isTTY!==true || process.stdout.isTTY!==true)) fail('LIVE_HISTORY_TTY_REQUIRED');
  if(reviewIncidents && (process.stdin.isTTY!==true || process.stdout.isTTY!==true)) fail('LIVE_INCIDENT_TTY_REQUIRED');
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
  let incidentReview = null;
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
    if(reviewIncidents) incidentReview=await reviewRepositoryIncidentsV1({host,runDirectory:directory,
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
    ...(reviewIncidents ? {incidentReview} : {}),
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
