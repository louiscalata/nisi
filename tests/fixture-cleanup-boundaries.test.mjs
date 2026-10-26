// C03 owner boundary oracle. This file is staged into the candidate's tests/
// directory by the owner before execution. It deliberately runs each case in
// a fresh Node process: the real reviewed host is imported first, then only
// its settled result and the product bundle reader are wrapped. The runner's
// actual receipt-write boundary is observed through node:fs/promises.
// Model/native/network free; no source or production API seam is added here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The owner stages this file into repository/tests before execution.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runnerURL = pathToFileURL(join(root, 'work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.mjs')).href;
const hostURL = pathToFileURL(join(root, 'hosts/repository/reviewed-workflow-v1.mjs')).href;
const bundleURL = pathToFileURL(join(root, 'receipts/repository-run-v1.mjs')).href;
const fixtureURL = pathToFileURL(join(root, 'examples/repository-task/reviewed-live-fixture-v1.mjs')).href;

const EXPECTED = Object.freeze({
  positive: { status: 'COMPLETED', reason: null, hostState: 'SETTLED', reportOutcome: 'COMPLETED', records: 4, receiptWrites: 1, readerCalls: 1 },
  state: { status: 'UNCONFIRMED', reason: 'HOST_NOT_SETTLED', hostState: 'BUSY', reportOutcome: 'COMPLETED', records: 3, receiptWrites: 0, readerCalls: 0 },
  outcome: { status: 'UNCONFIRMED', reason: 'COMPLETION_UNOBSERVED', hostState: 'SETTLED', reportOutcome: 'FAILED', records: 3, receiptWrites: 0, readerCalls: 0 },
  workflow: { status: 'UNCONFIRMED', reason: 'COMPLETION_UNOBSERVED', hostState: 'SETTLED', reportOutcome: 'COMPLETED', records: 3, receiptWrites: 0, readerCalls: 0 },
  bundle: { status: 'UNCONFIRMED', reason: 'SYNTHETIC_BUNDLE_ERROR', hostState: 'SETTLED', reportOutcome: 'COMPLETED', records: 3, receiptWrites: 0, readerCalls: 0 },
  proposalNull: { status: 'UNCONFIRMED', reason: 'REPOSITORY_PROPOSAL_MISSING', hostState: 'SETTLED', reportOutcome: 'COMPLETED', records: 3, receiptWrites: 0, readerCalls: 0 },
  proposalUndefined: { status: 'UNCONFIRMED', reason: 'REPOSITORY_PROPOSAL_MISSING', hostState: 'SETTLED', reportOutcome: 'COMPLETED', records: 3, receiptWrites: 0, readerCalls: 0 },
  timeout: { status: 'TIMED_OUT', reason: 'DEADLINE_EXCEEDED', hostState: 'SETTLED', reportOutcome: 'TIMED_OUT', records: 3, receiptWrites: 0, readerCalls: 0 },
  cancel: { status: 'CANCELLED', reason: 'ABORTED', hostState: 'SETTLED', reportOutcome: 'CANCELLED', records: 3, receiptWrites: 0, readerCalls: 0 },
  cancelRm: { status: 'CANCELLED', reason: 'ABORTED', hostState: 'SETTLED', reportOutcome: 'CANCELLED', records: 3, receiptWrites: 0, readerCalls: 0, cleanupState: 'PRESENT', cleanupError: { code: 'OWNED_ROOT_REMOVE_FAILED', systemCode: 'EBUSY', lstatCode: null } },
  timeoutLstat: { status: 'TIMED_OUT', reason: 'DEADLINE_EXCEEDED', hostState: 'SETTLED', reportOutcome: 'TIMED_OUT', records: 3, receiptWrites: 0, readerCalls: 0, cleanupState: 'UNKNOWN', cleanupError: { code: 'OWNED_ROOT_UNVERIFIED', systemCode: 'EIO', lstatCode: 'EIO' } },
});

function exercise(t, fault) {
  const parentRoot = realpathSync(mkdtempSync(join(tmpdir(), 'nisi-c03-boundary-')));
  t.after(() => rmSync(parentRoot, { recursive: true, force: true }));
  const script = `
    import { mock } from 'node:test';
    import realFsPromises from 'node:fs/promises';
    const hostModule = await import(${JSON.stringify(hostURL)});
    const bundleModule = await import(${JSON.stringify(bundleURL)});
    const fixtureModule = await import(${JSON.stringify(fixtureURL)});
    const fault = ${JSON.stringify(fault)};
    const controller = new AbortController();
    let runnerFixture = null, actualState = null, actualOutcome = null, returnedHost = null, readerCalls = 0;
    let actualRegistration = null, ownedRoot = null, removalSeen = false;
    let readerIdentity = null, receiptWriteAttempts = [];
    const fsProxy = new Proxy(realFsPromises, {
      get(target, key, receiver) {
        if (key === 'mkdtemp') return async (...args) => {
          const created = await Reflect.apply(target.mkdtemp, target, args);
          if (String(args[0]).endsWith('/nisi-fixture-')) ownedRoot = String(created);
          return created;
        };
        if (key === 'rm') return async (...args) => {
          if (ownedRoot !== null && String(args[0]) === ownedRoot && fault === 'cancelRm') {
            throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
          }
          const out = await Reflect.apply(target.rm, target, args);
          if (ownedRoot !== null && String(args[0]) === ownedRoot) removalSeen = true;
          return out;
        };
        if (key === 'lstat') return async (...args) => {
          if (ownedRoot !== null && String(args[0]) === ownedRoot && removalSeen && fault === 'timeoutLstat') {
            throw Object.assign(new Error('EIO'), { code: 'EIO' });
          }
          return Reflect.apply(target.lstat, target, args);
        };
        if (key !== 'writeFile') return Reflect.get(target, key, receiver);
        return async (...args) => {
          if (String(args[0]).endsWith('/runner-receipt.json')) receiptWriteAttempts.push(String(args[0]));
          return Reflect.apply(target.writeFile, target, args);
        };
      }
    });
    mock.module('node:fs/promises', { defaultExport: fsProxy });
    mock.module(${JSON.stringify(fixtureURL)}, { namedExports: {
      ...fixtureModule,
      async createReviewedLiveFixtureV1(...args) {
        runnerFixture = await fixtureModule.createReviewedLiveFixtureV1(...args);
        return runnerFixture;
      }
    }});
    mock.module(${JSON.stringify(hostURL)}, { namedExports: {
      ...hostModule,
      createRepositoryWorkflowOwnerV1(config) {
        actualRegistration = config.testsOwner?.registrationFingerprint ?? null;
        const host = hostModule.createRepositoryWorkflowOwnerV1(config);
        return { ...host,
          run(options) {
            if (fault === 'cancel' || fault === 'cancelRm') {
              options = { ...options, reviewers: options.reviewers.map(reviewer => ({ ...reviewer,
                async review(payload) {
                  const result = await reviewer.review(payload);
                  controller.abort();
                  return result;
                }
              })) };
            }
            return host.run(options);
          },
          async settled() {
            const result = await host.settled();
            actualState = result.state; actualOutcome = result.report.outcome; returnedHost = result;
            if (fault === 'state') return { ...result, state: 'BUSY' };
            if (fault === 'outcome') return { ...result, report: { ...result.report, outcome: 'FAILED' } };
            if (fault === 'workflow') return { ...result, report: { ...result.report, workflowOutcome: 'FAILED' } };
            if (fault === 'bundle') return { ...result, bundleError: { code: 'SYNTHETIC_BUNDLE_ERROR' } };
            if (fault === 'proposalNull') return { ...result, proposedChanges: null };
            if (fault === 'proposalUndefined') return { ...result, proposedChanges: undefined };
            if (fault === 'timeout' || fault === 'timeoutLstat') return { ...result, report: { ...result.report, outcome: 'TIMED_OUT', workflowOutcome: 'TIMED_OUT', code: 'DEADLINE_EXCEEDED' }, bundleError: { code: 'REPOSITORY_HOST_ERROR' } };
            return result;
          }
        };
      }
    }});
    mock.module(${JSON.stringify(bundleURL)}, { namedExports: {
      ...bundleModule,
      readRepositoryRunBundleV1(...args) {
        readerCalls++;
        const [bundle, context] = args;
        readerIdentity = {
          originalBundle: returnedHost !== null && bundle === returnedHost.bundle,
          originalPreparation: runnerFixture !== null && context?.preparation === runnerFixture.preparations[1],
          originalPlans: returnedHost !== null && context?.plans?.every((value, i) => value === returnedHost.staticHistory[i]?.plan),
          originalGroups: returnedHost !== null && context?.groups?.every((value, i) => value === returnedHost.staticHistory[i]?.group),
          originalExecutions: returnedHost !== null && context?.executions?.every((value, i) => value === returnedHost.testHistory[i]?.execution),
          registrationMatchesOwner: context?.nodeRegistrationFingerprint === actualRegistration,
        };
        return bundleModule.readRepositoryRunBundleV1(...args);
      }
    }});
    const { runRepositoryFixtureAcceptanceV1, REPOSITORY_FIXTURE_RUNNER_PROFILE } = await import(${JSON.stringify(runnerURL)});
    const result = await runRepositoryFixtureAcceptanceV1({ parentRoot: ${JSON.stringify(parentRoot)}, profile: REPOSITORY_FIXTURE_RUNNER_PROFILE, ...(['cancel', 'cancelRm'].includes(fault) ? { signal: controller.signal } : {}) });
    console.log(JSON.stringify({
      actualState, actualOutcome, hostState: result.hostResult?.state ?? null,
      reportOutcome: result.hostResult?.report?.outcome ?? null,
      status: result.status, reason: result.reason, readerCalls,
      readerIdentity, receiptWriteAttempts: receiptWriteAttempts.length,
      records: result.retained.map(record => record.path), receipt: result.receipt,
      cleanupState: result.cleanupState ?? null, cleanupError: result.cleanupError ?? null,
      settled: result.settledBeforeReceipt, modelContacted: result.modelContacted,
      authorizing: result.authorizing, publishingAllowed: result.publishingAllowed
    }));
  `;
  const child = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', script], {
    cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout.trim());
  assert.equal(result.modelContacted, false);
  assert.equal(result.authorizing, false);
  assert.equal(result.publishingAllowed, false);
  return result;
}

function assertBoundary(t, fault, expected) {
  const result = exercise(t, fault);
  assert.equal(result.status, expected.status);
  assert.equal(result.reason, expected.reason);
  assert.equal(result.hostState, expected.hostState);
  assert.equal(result.reportOutcome, expected.reportOutcome);
  assert.equal(result.records.length, expected.records);
  assert.equal(result.receiptWriteAttempts, expected.receiptWrites, 'receipt write attempts must reflect the actual runner boundary');
  assert.equal(result.readerCalls, expected.readerCalls);
  if (expected.receiptWrites) {
    assert.notEqual(result.receipt, null, 'the positive control must surface the receipt whose write was observed');
    assert.equal(result.receipt.workflowOutcome, 'COMPLETED');
    assert.deepEqual(result.readerIdentity, {
      originalBundle: true, originalPreparation: true, originalPlans: true,
      originalGroups: true, originalExecutions: true, registrationMatchesOwner: true,
    });
  } else {
    assert.equal(result.receipt, null);
  }
  return result;
}

test('C03 boundary control: actual runner preserves the C02 original-evidence receipt gate', t => {
  assertBoundary(t, 'none', EXPECTED.positive);
});

test('C03 boundary rejects every false completion clause at the actual runner', t => {
  for (const [fault, expected] of [
    ['state', EXPECTED.state],
    ['outcome', EXPECTED.outcome],
    ['workflow', EXPECTED.workflow],
    ['bundle', EXPECTED.bundle],
    ['proposalNull', EXPECTED.proposalNull],
    ['proposalUndefined', EXPECTED.proposalUndefined],
  ]) assertBoundary(t, fault, expected);
});

test('C03 boundary prefers DEADLINE_EXCEEDED over a conflicting bundle error', t => {
  assertBoundary(t, 'timeout', EXPECTED.timeout);
});

test('C03 boundary preserves genuine cancellation after the real tests phase', t => {
  const result = assertBoundary(t, 'cancel', EXPECTED.cancel);
  assert.equal(result.actualState, 'SETTLED');
  assert.equal(result.actualOutcome, 'CANCELLED');
  assert.equal(result.settled, true);
});

test('C03 boundary preserves cancellation plus a failed removal as adverse cleanup evidence', t => {
  const result = assertBoundary(t, 'cancelRm', EXPECTED.cancelRm);
  assert.equal(result.cleanupState, EXPECTED.cancelRm.cleanupState);
  assert.deepEqual(result.cleanupError, EXPECTED.cancelRm.cleanupError);
});

test('C03 boundary preserves timeout precedence plus an unverifiable post-removal lstat', t => {
  const result = assertBoundary(t, 'timeoutLstat', EXPECTED.timeoutLstat);
  assert.equal(result.cleanupState, EXPECTED.timeoutLstat.cleanupState);
  assert.deepEqual(result.cleanupError, EXPECTED.timeoutLstat.cleanupError);
});
