// PRIVATE, explicit opt-in demonstration. Only the pinned source-reviewed A/B
// fixture may execute; a different model repair is retained as data and refused.
// Not a sandbox, blind benchmark, application acceptance or release command.
import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createReviewedLiveFixtureV1 } from './repository-task/reviewed-live-fixture-v1.mjs';
import { createReviewedLiveModelLaneV1, createReviewedLiveModelLaneV2 } from '../hosts/repository/reviewed-live-model-v1.mjs';
import { createReviewedLiveModelLaneV3 } from '../hosts/repository/reviewed-live-model-v3.mjs';
import { readLiveModelSelectionV3 } from '../hosts/repository/live-model-selection-v3.mjs';
import { createReviewedRepositoryHostV1 } from '../hosts/repository/reviewed-workflow-v1.mjs';
import { createLiveDemoExecutionV1 } from '../hosts/repository/live-demo-execution-v1.mjs';
import { buildNativeArtifactKernel } from '../hosts/swift-verifier/build.mjs';
import { createRepositoryLiveModelRunV1, readRepositoryLiveModelRunV1, createRepositoryLiveModelRunV2, readRepositoryLiveModelRunV2 } from '../receipts/repository-live-model-run-v1.mjs';
import { createRepositoryLiveModelRunV3, readRepositoryLiveModelRunV3 } from '../receipts/repository-live-model-run-v3.mjs';
import { sha256Text } from '../workflow/contracts.mjs';
import { reviewRepositoryHistoryV1 } from '../hosts/history/review-repository-history-v1.mjs';
import { promptRepositoryHistoryV1 } from '../hosts/history/terminal-history-prompt-v1.mjs';
import { openJournalOwner } from '../history/journal-owner-v2.mjs';
import { reviewRepositoryIncidentsV1 } from '../hosts/history/review-repository-incidents-v1.mjs';
import { resolveExternalDemoStateV1, recheckExternalDemoStateV1 } from '../hosts/repository/demo-state-v1.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const help = 'PRIVATE ONLY: node examples/repository-live-model.mjs --approved-reviewed-fixture --endpoint http://127.0.0.1:1234/v1/chat/completions --author-model EXISTING_MODEL --reviewer-model DIFFERENT_EXISTING_MODEL [--author-output-mode json_schema|json_instruction --reviewer-output-mode json_schema|json_instruction]. Both mode flags are required together; omitted flags preserve v1 strict-schema behavior. V3 instead requires both --author-api and --reviewer-api (NATIVE_API|CHAT_COMPLETIONS), both per-role --endpoint and --model flags, and no legacy --endpoint. Native roles also require --ROLE-instance, --ROLE-profile nisi-native-chat-content-v1, --ROLE-reasoning off; chat roles require --ROLE-output-mode. Native termination remains NOT_REPORTED. No automatic fallback or admission of unregistered code.';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const preflightHelp = ' Optional --preflight-only validates exact reviewed fixture sources and selected model/API configuration, then returns a read-only PREFLIGHT_VALIDATED report with deliberate exitCode 1 (non-acceptance). No model call, compiler, workspace, artifact write or signal listener; no result is stored by Nisi. This is not model availability, runtime admission or live-window clearance. Only with --preflight-only, --state-dir is optional; if supplied it is validated, never created.';
const safeCode = e => {
  try {
    const code = e?.code;
    return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/u.exec(code)?.[0] === code ? code : 'LIVE_DEMO_ERROR';
  } catch { return 'LIVE_DEMO_ERROR'; }
};

export function parseLiveDemoInvocation(args) {
  if(!Array.isArray(args)) fail('LIVE_DEMO_ARGUMENTS');
  const rest=[]; let reviewHistory=false,reviewIncidents=false,preflightOnly=false,stateDirectory;
  for(let i=0;i<args.length;i++) {
    const d=Object.getOwnPropertyDescriptor(args,String(i));
    if(!d || !Object.hasOwn(d,'value') || typeof d.value!=='string') fail('LIVE_DEMO_ARGUMENTS');
    if(d.value==='--review-history') { if(reviewHistory) fail('LIVE_DEMO_ARGUMENTS'); reviewHistory=true; }
    else if(d.value==='--review-incidents') { if(reviewIncidents) fail('LIVE_DEMO_ARGUMENTS'); reviewIncidents=true; }
    else if(d.value==='--preflight-only') { if(preflightOnly) fail('LIVE_DEMO_ARGUMENTS'); preflightOnly=true; }
    else if(d.value==='--state-dir') {
      if(stateDirectory!==undefined) fail('LIVE_DEMO_ARGUMENTS');
      const value=Object.getOwnPropertyDescriptor(args,String(++i));
      if(!value || !Object.hasOwn(value,'value') || typeof value.value!=='string' || !value.value || value.value.startsWith('--')) fail('LIVE_DEMO_ARGUMENTS');
      stateDirectory=value.value;
    }
    else rest.push(d.value);
  }
  if((reviewHistory || reviewIncidents || stateDirectory!==undefined) && rest.includes('--help')) fail('LIVE_DEMO_ARGUMENTS');
  if(preflightOnly && (reviewHistory || reviewIncidents || rest.includes('--help'))) fail('LIVE_DEMO_ARGUMENTS');
  return Object.freeze({selected:parseLiveDemoArguments(rest),reviewHistory,...(reviewIncidents?{reviewIncidents:true}:{}),
    ...(preflightOnly?{preflightOnly:true}:{}),...(stateDirectory!==undefined?{stateDirectory}:{})});
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
  if (report === null || report === undefined) errors.push({ stage: 'engine-report.json', code: 'LIVE_DEMO_ENGINE_REPORT_ABSENT' });
  else {
    try { await retain('engine-report.json', report); }
    catch (e) { errors.push({ stage: 'engine-report.json', code: safeCode(e) }); }
  }
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

export async function runPrivateLiveDemo(args, { requireExternalState = false } = {}) {
  const {selected,reviewHistory,reviewIncidents=false,preflightOnly=false,stateDirectory} = parseLiveDemoInvocation(args);
  if (selected === null) return { help: help+preflightHelp+' --state-dir ABSOLUTE_EXISTING_PRIVATE_DIRECTORY selects external run/build storage (required by bin/nisi.mjs for execution; optional for this legacy direct example and read-only preflight). Directory must be caller-owned, mode 0700, outside and not an ancestor of the package. Optional --review-history asks for a separate interactive metadata-storage decision after settlement; --review-incidents separately selects and confirms one failure observation. Neither flag approves storage itself. Both require stdin and stdout TTY. Existing demo evidence retention is unchanged.', exitCode: 0 };
  if(typeof requireExternalState!=='boolean') fail('LIVE_DEMO_ARGUMENTS');
  if(requireExternalState && stateDirectory===undefined && !preflightOnly) fail('NISI_STATE_DIRECTORY_REQUIRED');
  const externalState = stateDirectory === undefined ? null : resolveExternalDemoStateV1(stateDirectory, root);
  if(reviewHistory && (process.stdin.isTTY!==true || process.stdout.isTTY!==true)) fail('LIVE_HISTORY_TTY_REQUIRED');
  if(reviewIncidents && (process.stdin.isTTY!==true || process.stdout.isTTY!==true)) fail('LIVE_INCIDENT_TTY_REQUIRED');
  // Reject modified sources and invalid transport/model configuration before
  // starting any compiler, child, HTTP request or materialized fixture workspace.
  const fixture = await createReviewedLiveFixtureV1(), createdAtMs = Date.now();
  const apiAware = Object.hasOwn(selected, 'author'), modeAware = Object.hasOwn(selected, 'authorOutputMode');
  const lane = (apiAware ? createReviewedLiveModelLaneV3 : modeAware ? createReviewedLiveModelLaneV2 : createReviewedLiveModelLaneV1)({ suite: fixture.suite, reviewedSourceFingerprint: fixture.reviewedSourceFingerprint,
    ...selected, timeoutMs: 90000, maxOutputTokens: 2048,
    approval: { id: 'private.reviewed-fixture.opt-in', expiresAtMs: createdAtMs + 360000 } });
  if(preflightOnly) {
    // Constructors validate configuration without dispatch. Return no lane,
    // suite, approval or candidate capability, and perform no execution effects.
    return Object.freeze({ schemaVersion: 'nisi-live-demo-preflight/v1', status: 'PREFLIGHT_VALIDATED',
      scope: 'EXACT_REVIEWED_FIXTURE_CONFIGURATION_ONLY', reviewedSourceFingerprint: fixture.reviewedSourceFingerprint,
      sourceFileCount: fixture.reviewedSourceManifest.length, modelConfigurationValidated: true, runtimeAdmission: 'NOT_OBSERVED',
      serverIdleObserved: false, modelCalls: 0, compilerStarted: false, workspaceCreated: false, artifactWrites: 0,
      nx04Accepted: false, authorizing: false, publicationAuthorized: false, exitCode: 1 });
  }
  const buildRoot = externalState === null ? path.join(root, '.build') : recheckExternalDemoStateV1(externalState, root);
  if(externalState===null) await fs.mkdir(buildRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(buildRoot, 'repository-live-demo-'));
  const retained = [], controller = new AbortController(); let build = null, host = null, report = null, hostResult = null, receipt = null, execution = null;
  let failure = null, setupDurationMs = null, workflowDurationMs = null;
  let finalHostState = 'NOT_STARTED', finalModelPhase = 'UNKNOWN';
  let historyReview = null;
  let incidentReview = null;
  const diagnosticErrors = [];
  async function retain(name, value) {
    const content = JSON.stringify(value, null, 2) + '\n';
    await fs.writeFile(path.join(directory, name), content, { flag: 'wx', mode: 0o600 });
    retained.push({ path: name, byteLength: Buffer.byteLength(content), sha256: sha256Text(content) });
  }
  let earlyCancelled = false, earlyCancellationError = null;
  const interrupt = () => {
    if (execution) execution.interrupt();
    else if (!earlyCancelled) {
      earlyCancelled = true;
      try { controller.abort(); } catch (e) { earlyCancellationError = safeCode(e); }
      try { lane.revoke(); } catch (e) { earlyCancellationError ??= safeCode(e); }
    }
  };
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
    if(externalState!==null) await retain('storage.json', {schemaVersion:'nisi-demo-storage/v1',
      policy:'EXPLICIT_EXTERNAL_PRIVATE',stateRoot:externalState.directory,runDirectory:directory,
      reservationScope:'STATE_ROOT_ONLY',hostileWriterIsolation:false,authorizing:false});
    checkInterrupted();
    const setupStart = performance.now(); build = externalState===null ? buildNativeArtifactKernel() : buildNativeArtifactKernel({buildRoot});
    setupDurationMs = Math.ceil(performance.now() - setupStart); await retain('native-build.json', build);
    checkInterrupted();
    const parentRoot = path.join(directory, 'workspaces'); await fs.mkdir(parentRoot, { mode: 0o700 });
    checkInterrupted();
    host = createReviewedRepositoryHostV1({ suite: fixture.suite, build, scope: 'operator-exclusive-static-local-v1',
      targets: fixture.targets, parentRoot, staticTimeoutMs: 5000, totalTestTimeoutMs: 10000, testTimeoutMs: 5000, closeGraceMs: 500 });
    execution = createLiveDemoExecutionV1({ host, lane, controller, retain,
      binding: { directory, createdAt: new Date(createdAtMs).toISOString(), reviewedSourceFingerprint: fixture.reviewedSourceFingerprint },
      onLateError: row => { console.error(JSON.stringify({ status: 'EVIDENCE_RETENTION_OR_READ_FAILED', directory, ...row })); } });
    const workflowStart = performance.now();
    let runFailure = null;
    try { report = await host.run({ authorizeContext: lane.authorizeContext, author: lane.author, reviewers: lane.reviewers, signal: controller.signal }); }
    catch (e) { runFailure = safeCode(e); execution.interrupt(); }
    workflowDurationMs = Math.ceil(performance.now() - workflowStart);
    // One collection site on both success and rejection. Do not fabricate an
    // engine report, retry an exclusive write, or equate observation with drain.
    const collected = await collectLiveHostEvidenceV1({ settled: execution.hostSettled }, report, retain);
    hostResult = collected.hostResult; diagnosticErrors.push(...collected.errors);
    if (runFailure !== null) fail(runFailure);
    if (hostResult === null) fail('LIVE_DEMO_HOST_COLLECTION_FAILED');
    checkInterrupted();
    if(reviewHistory) historyReview=await reviewRepositoryHistoryV1({host,runDirectory:directory,
      clock:Date.now,signal:controller.signal,promptTimeoutMs:120000,
      prompt:p=>promptRepositoryHistoryV1({...p,input:process.stdin,output:process.stdout}),
      openOwner:req=>openJournalOwner({...req,fs:syncFs})});
    if(reviewIncidents) incidentReview=await reviewRepositoryIncidentsV1({host,runDirectory:directory,
      clock:Date.now,signal:controller.signal,promptTimeoutMs:120000,
      prompt:p=>promptRepositoryHistoryV1({...p,input:process.stdin,output:process.stdout}),
      openOwner:req=>openJournalOwner({...req,fs:syncFs})});
    checkInterrupted();
    // Bind the successful non-revoked receipt first. Finalization below joins
    // actual owners, not a polling approximation of pending transport counts.
    const context = { lane, hostResult };
    receipt = (apiAware ? createRepositoryLiveModelRunV3 : modeAware ? createRepositoryLiveModelRunV2 : createRepositoryLiveModelRunV1)(context);
    (apiAware ? readRepositoryLiveModelRunV3 : modeAware ? readRepositoryLiveModelRunV2 : readRepositoryLiveModelRunV1)(receipt, context);
    await retain('live-run-receipt.json', receipt);
  } catch (e) { failure = safeCode(e); interrupt(); }
  finally {
    if (execution) {
      try {
        if (failure !== null || diagnosticErrors.length > 0) execution.interrupt();
        const end = await execution.finish();
        diagnosticErrors.push(...end.late.errors);
        if (end.observation.status !== 'OFF') diagnosticErrors.push({ stage: 'execution.final', code: 'LIVE_DEMO_DRAIN_UNCONFIRMED' });
        if (end.late.state !== 'RETAINED') diagnosticErrors.push({ stage: 'execution.settlement', code: 'LIVE_DEMO_SETTLEMENT_EVIDENCE_INCOMPLETE' });
      } catch (e) { diagnosticErrors.push({ stage: 'execution.final', code: safeCode(e) }); }
    }
    // Snapshots preserve validated but refused normalized model output; transport
    // receipts retain hashes, not raw HTTP bodies. Do not claim raw-response replay.
    try {
      const snapshot = lane.snapshot(); finalModelPhase = snapshot.phase;
      await retainDiagnostic('model-lane-final.json', snapshot);
    }
    catch (e) { diagnosticErrors.push({ stage: 'model-lane.snapshot', code: safeCode(e) }); }
    if (host) {
      try { await retainDiagnostic('host-late-observations.json', host.lateObservations()); }
      catch (e) { diagnosticErrors.push({ stage: 'host.lateObservations', code: safeCode(e) }); }
      // Independent diagnostics: a failed late-history read/write cannot hide
      // partial roots or turn unavailable materialization evidence into empty.
      try {
        const observations = host.materializationObservations();
        await retainDiagnostic('host-materialization-observations.json', observations);
        if (observations?.schemaVersion !== 'nisi-repository-materialization-diagnostics/v1' ||
            observations.authorizing !== false || !Array.isArray(observations.rows) || observations.rows.length > 202)
          fail('LIVE_DEMO_MATERIALIZATION_SCHEMA');
        if (observations.availability !== 'AVAILABLE') fail('LIVE_DEMO_MATERIALIZATION_UNAVAILABLE');
        if (observations.reason !== null || observations.error !== null) fail('LIVE_DEMO_MATERIALIZATION_SCHEMA');
      } catch (e) { diagnosticErrors.push({ stage: 'host.materializationObservations', code: safeCode(e) }); }
      finalHostState = 'UNKNOWN';
      try {
        const state = hostResult === null ? host.status() : hostResult.state;
        if (!['NEW', 'RUNNING', 'SETTLING', 'SETTLED', 'QUARANTINED'].includes(state)) fail('LIVE_DEMO_HOST_STATE');
        finalHostState = state;
      } catch (e) { diagnosticErrors.push({ stage: hostResult === null ? 'host.status' : 'host-result.state', code: safeCode(e) }); }
    }
    if (controller.signal.aborted) failure ??= 'ABORTED';
    if (earlyCancellationError !== null) diagnosticErrors.push({ stage: 'early.cancel', code: earlyCancellationError });
    // Keep cancellation active throughout async owner/diagnostic finalization.
    // The summary below is an immutable point-in-time report, not a live view.
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  }
  const summary = { schemaVersion: apiAware ? 'nisi-private-live-demo-summary-v3' : 'nisi-private-live-demo-summary-v1',
    status: failure === null && diagnosticErrors.length === 0 && receipt?.status === 'SCOPED_LIVE_REPAIR_REVIEW_PASS' ? 'SCOPED_LIVE_REPAIR_REVIEW_PASS' : 'INCOMPLETE',
    errorCode: failure, diagnosticErrors: [...diagnosticErrors], directory, receiptFingerprint: receipt?.fingerprint ?? null,
    setupDurationMs, workflowDurationMs, usage: receipt?.usage ?? null,
    ...(apiAware ? { modelProtocols: { author: selected.author.api, reviewer: selected.reviewer.api },
      usageProvenance: receipt?.usageProvenance ?? null,
      nativeCompletion: { roles: ['author', 'reviewer'].filter(role => selected[role].api === 'NATIVE_API'),
        termination: 'NOT_REPORTED', serverCompletionAttested: false } } : {}),
    workflowOutcome: report?.workflowOutcome ?? null, hostState: finalHostState,
    ...(reviewHistory ? {historyReview} : {}),
    ...(reviewIncidents ? {incidentReview} : {}),
    modelPhase: finalModelPhase, remoteInferenceStopped: 'NOT_OBSERVED', retained: [...retained],
    baselineFailureExpected: true, blindBenchmark: false, comparativeBenefitMeasured: false,
    rawHttpBodyRetained: false, applied: false, nativeAppAccepted: false, publicationAuthorized: false };
  let summaryRetained = false;
  try { await retain('summary.json', summary); summaryRetained = true; }
  catch (e) {
    summary.status = 'INCOMPLETE'; summary.diagnosticErrors.push({ stage: 'summary.json', code: safeCode(e) });
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
