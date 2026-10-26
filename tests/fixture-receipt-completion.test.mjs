// Owner regression for C02. Dependency faults run in fresh bounded Node test
// processes; the product fixture remains inert (no model/native checker).
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runnerURL = pathToFileURL(join(root, 'work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.mjs')).href;
const hostURL = pathToFileURL(join(root, 'hosts/repository/reviewed-workflow-v1.mjs')).href;
const bundleURL = pathToFileURL(join(root, 'receipts/repository-run-v1.mjs')).href;
const fixtureURL = pathToFileURL(join(root, 'examples/repository-task/reviewed-live-fixture-v1.mjs')).href;

function exercise(t, fault) {
  const parentRoot = realpathSync(mkdtempSync(join(tmpdir(), 'nisi-c02-completion-')));
  t.after(() => rmSync(parentRoot, {recursive: true, force: true}));
  // Import the real host first, then substitute only the runner's dependency.
  // This preserves actual issuance identities, plans, executions and workflow.
  const script = `
    import {mock} from 'node:test';
    const hostModule = await import(${JSON.stringify(hostURL)});
    const bundleModule = await import(${JSON.stringify(bundleURL)});
    const fixtureModule = await import(${JSON.stringify(fixtureURL)});
    const fixture = await fixtureModule.createReviewedLiveFixtureV1();
    const fault = ${JSON.stringify(fault)};
    const controller = new AbortController();
    let actualState = null, actualOutcome = null, readerCalls = 0;
    mock.module(${JSON.stringify(hostURL)}, {namedExports: {
      ...hostModule,
      createRepositoryWorkflowOwnerV1(config) {
        const host = hostModule.createRepositoryWorkflowOwnerV1(config);
        return {...host,
          run(options) {
            if (fault === 'cancel-after-tests') {
              options = {...options, reviewers: options.reviewers.map(reviewer => ({...reviewer,
                async review(payload) {
                  const result = await reviewer.review(payload);
                  controller.abort();
                  return result;
                }
              }))};
            }
            return host.run(options);
          },
          async settled() {
            const result = await host.settled();
            actualState = result.state; actualOutcome = result.report.outcome;
            if (fault === 'report-wrong-run') return {...result, report: {...result.report, runId: 'wrong-run-id'}};
            if (fault === 'report-stale-candidate') return {...result, report: {...result.report, candidateFingerprint: fixture.preparations[0].candidateFingerprint}};
            if (fault === 'report-not-completed') return {...result, report: {...result.report, outcome: 'CANCELLED', workflowOutcome: 'CANCELLED'}};
            if (fault === 'fabricated-bundle') return {...result, bundle: {fingerprint: result.bundle.fingerprint}};
            return result;
          }
        };
      }
    }});
    mock.module(${JSON.stringify(bundleURL)}, {namedExports: {
      ...bundleModule,
      readRepositoryRunBundleV1(...args) {
        readerCalls++;
        const summary = bundleModule.readRepositoryRunBundleV1(...args);
        if (fault === 'summary-final-checks-false') return {...summary, finalChecksRecordedPass: false};
        if (fault === 'summary-wrong-run') return {...summary, runId: 'wrong-run-id'};
        if (fault === 'summary-stale-candidate') return {...summary, candidateFingerprint: fixture.preparations[0].candidateFingerprint};
        return summary;
      }
    }});
    const {runRepositoryFixtureAcceptanceV1, REPOSITORY_FIXTURE_RUNNER_PROFILE} = await import(${JSON.stringify(runnerURL)});
    const result = await runRepositoryFixtureAcceptanceV1({parentRoot: ${JSON.stringify(parentRoot)}, profile: REPOSITORY_FIXTURE_RUNNER_PROFILE, signal: controller.signal});
    console.log(JSON.stringify({fault, actualState, actualOutcome, readerCalls,
      status: result.status, reason: result.reason, receipt: result.receipt,
      records: result.retained.map(record => record.path), settled: result.settledBeforeReceipt,
      modelContacted: result.modelContacted, authorizing: result.authorizing,
      publishingAllowed: result.publishingAllowed}));
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

test('C02 completion dependency seam preserves a real successful product run', t => {
  const result = exercise(t, 'none');
  assert.equal(result.actualState, 'SETTLED');
  assert.equal(result.actualOutcome, 'COMPLETED');
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.readerCalls, 1);
  assert.equal(result.records.at(-1), 'runner-receipt.json');
  assert.equal(result.receipt.workflowOutcome, 'COMPLETED');
});

for (const fault of ['cancel-after-tests', 'report-not-completed', 'report-wrong-run',
  'report-stale-candidate', 'fabricated-bundle', 'summary-final-checks-false',
  'summary-wrong-run', 'summary-stale-candidate']) {
  test('C02 completion refuses ' + fault + ' after owner settlement', t => {
    const result = exercise(t, fault);
    assert.equal(result.actualState, 'SETTLED', 'fault must exercise a settled owner, not an unrelated quarantine');
    if (fault === 'cancel-after-tests') assert.equal(result.actualOutcome, 'CANCELLED');
    else assert.equal(result.actualOutcome, 'COMPLETED');
    assert.equal(result.settled, true);
    assert.notEqual(result.status, 'COMPLETED', 'settlement must not manufacture task completion');
    assert.equal(result.receipt, null, 'ineligible result must not publish a completion receipt');
    assert.deepEqual(result.records, ['preflight.json', 'engine-report.json', 'host-result.json']);
  });
}
