// Oracle for Track 1 repository-fixture-runner (OpenCode, 2026-09-14 rev 2).
// Contract prose: ./README.md. Reviewed adversarially by Claude before the
// implementation is written. Model-free: draws sources from the product
// reviewed fixture, runs the reviewed host with INERT owners/adapters.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createReviewedLiveFixtureV1 } from '../../../examples/repository-task/reviewed-live-fixture-v1.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runnerUrl = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'repository-fixture-runner.mjs'));
const coded = code => Object.assign(new Error(code), { code });
const sha256 = value => createHash('sha256').update(value).digest('hex');

// Self-contained side-effect guard: network, child processes and process.exit
// are forbidden. Reads are open (module loading + pinned fixture reads). Writes
// are allowed ONLY under the provided allowWritesUnder root (the runner's
// caller-supplied parentRoot); anything else is a forbidden side effect. Both
// the async fs/promises API and the sync fs API are patched, and two-path
// operations (rename/copyFile/cp/symlink/link) check BOTH path arguments.
async function guardSideEffects(run, allowWritesUnder) {
  // macOS: /var → /private/var symlink causes path mismatches between
  // fs.mkdtempSync (symlink path) and fsp.mkdtemp (realpath). Canonicalize
  // so the write boundary is the realpath tree.
  allowWritesUnder = fs.realpathSync(allowWritesUnder);
  const restores = [], forbidden = [], writes = [];
  const originalExitCode = process.exitCode;
  const originalListeners = ['SIGINT', 'SIGTERM'].map(signal => [signal, process.listeners(signal)]);
  const twoPath = new Set(['rename', 'copyFile', 'cp', 'symlink', 'link']);
  function replace(object, key, replacement, guard = () => {}) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !('value' in descriptor)) { guard(); return; }
    restores.push(() => Object.defineProperty(object, key, descriptor));
    Object.defineProperty(object, key, { ...descriptor, value: replacement });
  }
  function deny(label) {
    return () => { forbidden.push(label); throw coded(`TEST_FORBIDDEN_SIDE_EFFECT:${label}`); };
  }
  const inside = target => {
    const absolute = target instanceof URL ? fileURLToPath(target) : path.resolve(String(target));
    return absolute === allowWritesUnder || absolute.startsWith(allowWritesUnder + path.sep);
  };
  const guardedWrite = (label, name, fn) => function guarded(target, ...rest) {
    writes.push([`${label}.${name}`, String(target), ...(twoPath.has(name) && rest.length > 0 ? [String(rest[0])] : [])]);
    if (!inside(target) || (twoPath.has(name) && rest.length > 0 && !inside(rest[0]))) return deny(`${label} outside owned root`)(target);
    return fn.call(this, target, ...rest);
  };
  try {
    replace(globalThis, 'fetch', deny('fetch'));
    replace(process, 'exit', deny('process.exit'));
    for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) replace(childProcess, key, deny(`child_process.${key}`));
    for (const [label, object, key] of [['http', http, 'request'], ['http', http, 'get'], ['https', https, 'request'], ['https', https, 'get'], ['net', net, 'connect'], ['net', net, 'createConnection'], ['tls', tls, 'connect']]) replace(object, key, deny(`${label}.${key}`));
    for (const key of ['writeFile', 'appendFile', 'rename', 'copyFile', 'cp', 'chmod', 'symlink', 'link', 'mkdir', 'mkdtemp', 'rm', 'unlink']) {
      replace(fsp, key, guardedWrite('fsp', key, fsp[key]));
    }
    for (const key of ['writeFileSync', 'appendFileSync', 'renameSync', 'copyFileSync', 'cpSync', 'chmodSync', 'symlinkSync', 'linkSync', 'mkdirSync', 'mkdtempSync', 'rmSync', 'unlinkSync']) {
      replace(fs, key, guardedWrite('fs', key.replace(/Sync$/, ''), fs[key]));
    }
    replace(fs, 'createWriteStream', deny('fs.createWriteStream'));
    syncBuiltinESMExports();
    const outcome = await run({ writes });
    // Callbacks may return {value, ...extras} or the result directly.
    const hasValue = outcome != null && typeof outcome === 'object' && 'value' in outcome;
    const value = hasValue ? outcome.value : outcome;
    // Forward any callback extras (e.g. ownedExisted, retainedNames) so tests
    // can destructure them from the guard return.
    const extras = hasValue ? Object.fromEntries(Object.entries(outcome).filter(([k]) => k !== 'value')) : {};
    return { value, forbidden, writes, ...extras };
  } finally {
    for (const restore of restores.reverse()) restore();
    syncBuiltinESMExports();
    assert.deepEqual(forbidden, [], 'Runner must not touch network, child processes, process.exit, or write outside the owned parent root');
    assert.equal(process.exitCode, originalExitCode, 'Runner must not alter process.exitCode');
    for (const [signal, listeners] of originalListeners) assert.deepEqual(process.listeners(signal), listeners, `Runner must preserve ${signal} listeners`);
  }
}

// macOS: /var → /private/var symlink; canonicalize at creation so guard and
// runner see the same realpath for write-boundary checks.
const parentRoot = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-fixture-parent-')));
const prepared = {}; let fixture = null;
test.before(async () => {
  fixture = await createReviewedLiveFixtureV1();
  prepared.baseline = fixture.preparations[0];
  prepared.repaired = fixture.preparations[1];
});

test('default run completes with repair, exact manifest, settled host before receipt, and cleaned owned root', async () => {
  const parent = parentRoot(); let outcome;
  try {
    outcome = await guardSideEffects(async ({ writes }) => {
      const mod = await import(runnerUrl);
      const result = await mod.runRepositoryFixtureAcceptanceV1({ parentRoot: parent, profile: mod.REPOSITORY_FIXTURE_RUNNER_PROFILE });
      const ownedExisted = result.ownedRoot === null ? null : fs.existsSync(result.ownedRoot);
      return { value: result, ownedExisted, writes: [...writes], manifest: result.revealedSourceManifest, fingerprints: result.preparationFingerprints };
    }, parent);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.workflowOutcome, 'COMPLETED');
  assert.ok(result.repairAttempts >= 1, 'workflow must have repaired the failing baseline');
  // Defect 4 (rev): candidate fingerprint is the engine field, not the preparation digest.
  assert.equal(result.candidateFingerprint, prepared.repaired.candidateFingerprint);
  assert.equal(result.candidateFingerprint, result.hostResult.report.candidateFingerprint);
  assert.deepEqual(result.preparationFingerprints, [prepared.baseline.fingerprint, prepared.repaired.fingerprint]);
  // Exact source manifest: identical to the product fixture's five pins.
  assert.deepEqual(result.revealedSourceManifest, fixture.reviewedSourceManifest);
  assert.equal(result.reviewedSourceFingerprint, fixture.reviewedSourceFingerprint);
  assert.equal(result.modelContacted, false);
  assert.equal(result.authorizing, false);
  assert.equal(result.publishingAllowed, false);
  // Settled host precedes receipt.
  assert.equal(result.settledBeforeReceipt, true);
  assert.equal(result.hostResult.state, 'SETTLED');
  assert.notEqual(result.hostResult.bundle, null);
  assert.notEqual(result.hostResult.proposedChanges, null);
  assert.equal(result.receipt.hostResultState, 'SETTLED');
  // Defect 5(a): host identity + consistency of surfaced fields.
  assert.equal(result.hostResult.schemaVersion, 'nisi-reviewed-repository-host-v1');
  assert.equal(result.hostResult.bundleError, null);
  assert.equal(result.hostResult.report.workflowOutcome, result.workflowOutcome);
  // The journal must show the failing baseline THEN the repaired candidate.
  const journal = result.hostResult.invocations;
  const baselineStatic = journal.findIndex(e => e.stage === 'staticChecks' &&
    e.preparation?.fingerprint === prepared.baseline.fingerprint && e.adapterResult?.status === 'FAIL');
  assert.ok(baselineStatic !== -1, 'baseline static check must FAIL and be journaled');
  const repairedStatic = journal.findIndex(e => e.stage === 'staticChecks' &&
    e.preparation?.fingerprint === prepared.repaired.fingerprint && e.adapterResult?.status === 'PASS');
  assert.ok(baselineStatic < repairedStatic, 'baseline FAIL must precede repaired PASS');
  // Defect 2 (rev): repair evidence lives in the ENGINE REPORT stages, not the host journal.
  const report = result.hostResult.report;
  assert.ok(report.stages.some(s => s.stage === 'repair' && s.status === 'REPAIRED'), 'engine report must record the repaired repair stage');
  assert.ok(report.stages.some(s => s.stage === 'staticChecks' && s.status === 'FAIL' && s.candidateFingerprint === prepared.baseline.candidateFingerprint));
  assert.ok(report.stages.some(s => s.stage === 'staticChecks' && s.status === 'PASS' && s.candidateFingerprint === prepared.repaired.candidateFingerprint));
  assert.ok(report.stages.some(s => s.stage === 'tests' && s.status === 'PASS' && s.candidateFingerprint === prepared.repaired.candidateFingerprint));
  // No review summaries by default.
  assert.equal(Object.hasOwn(result, 'historyReview'), false);
  assert.equal(Object.hasOwn(result, 'incidentReview'), false);
  // Owned root: under parentRoot with the nisi-fixture- prefix; cleaned on success.
  assert.equal(typeof result.ownedRoot, 'string');
  assert.equal(path.dirname(result.ownedRoot), parent);
  assert.match(path.basename(result.ownedRoot), /^nisi-fixture-/);
  assert.equal(outcome.ownedExisted, false, 'owned root must not exist after the runner cleans it');
  assert.equal(fs.existsSync(result.ownedRoot), false, 'owned temp root must be removed on success');
  assert.equal(result.cleaned, true);
  // Defect 6 (rev): the write journal proves mkdtemp under parent then rm of the exact owned root.
  // The guard captures the mkdtemp ARGUMENT (template path); the owned root is the RETURN value
  // (with random suffix), so use prefix matching for mkdtemp entries.
  const mkdtempEntries = outcome.writes.filter(w => w[0] === 'fsp.mkdtemp');
  assert.ok(mkdtempEntries.some(w => result.ownedRoot.startsWith(w[1])), 'journal must show mkdtemp of the owned root');
  const rmIndex = outcome.writes.findIndex(w => w[0] === 'fsp.rm' && w[1] === result.ownedRoot);
  const mkdtempIndex = outcome.writes.findIndex(w => w[0] === 'fsp.mkdtemp' && result.ownedRoot.startsWith(w[1]));
  assert.ok(mkdtempIndex !== -1 && rmIndex !== -1 && rmIndex > mkdtempIndex, 'journal must show mkdtemp then rm of the owned root');
  // Defect 5(a): retained host-result.json byte-for-byte matches the surfaced hostResult.
  const retainedHost = result.retained.find(r => r.path === 'host-result.json');
  const expectedText = JSON.stringify(result.hostResult, null, 2) + '\n';
  assert.equal(retainedHost.byteLength, Buffer.byteLength(expectedText));
  assert.equal(retainedHost.sha256, sha256(expectedText));
});

test('result and receipt are deeply frozen and repeatable up to the random runId', async () => {
  const parent = parentRoot(); let a, b;
  try {
    ({ value: a } = await guardSideEffects(async () => {
      const mod = await import(runnerUrl);
      return mod.runRepositoryFixtureAcceptanceV1({ parentRoot: parent, profile: mod.REPOSITORY_FIXTURE_RUNNER_PROFILE });
    }, parent));
    ({ value: b } = await guardSideEffects(async () => {
      const mod = await import(runnerUrl);
      return mod.runRepositoryFixtureAcceptanceV1({ parentRoot: parent, profile: mod.REPOSITORY_FIXTURE_RUNNER_PROFILE });
    }, parent));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  assert.ok(Object.isFrozen(a));
  assert.ok(Object.isFrozen(a.receipt));
  assert.ok(Object.isFrozen(a.revealedSourceManifest));
  // Defect 3 (rev): two real runs happened; compare a projection, not random runIds.
  assert.notEqual(a.hostResult.report.runId, b.hostResult.report.runId);
  const projection = value => ({
    status: value.status, workflowOutcome: value.workflowOutcome, repairAttempts: value.repairAttempts,
    candidateFingerprint: value.candidateFingerprint, preparationFingerprints: [...value.preparationFingerprints],
    revealedSourceManifest: [...value.revealedSourceManifest], reviewedSourceFingerprint: value.reviewedSourceFingerprint,
    modelContacted: value.modelContacted, authorizing: value.authorizing, publishingAllowed: value.publishingAllowed,
    settledBeforeReceipt: value.settledBeforeReceipt, hostState: value.hostResult.state,
    hostSchema: value.hostResult.schemaVersion, bundleNonNull: value.hostResult.bundle !== null,
    proposedNonNull: value.hostResult.proposedChanges !== null, bundleError: value.hostResult.bundleError,
    ownerStates: { ...value.hostResult.ownerStates },
    stageStatuses: value.hostResult.report.stages.map(s => [s.stage, s.status, s.candidateFingerprint]),
    manifestFingerprint: value.revealedSourceManifest.map(e => e.sha256),
    receiptHostState: value.receipt.hostResultState,
    retainedNames: value.retained.map(r => r.path), cleaned: value.cleaned,
  });
  assert.deepEqual(projection(a), projection(b), 'identical inputs must produce identical projections');
  assert.equal(a.retained.some(r => r.path === 'engine-report.json'), true);
  assert.equal(a.retained.some(r => r.path === 'host-result.json'), true);
  assert.equal(a.retained.some(r => r.path === 'runner-receipt.json'), true);
  for (const r of a.retained) { assert.ok(Number.isSafeInteger(r.byteLength) && r.byteLength > 0); assert.match(r.sha256, /^[a-f0-9]{64}$/); }
});

test('cancelled signal yields an adverse CANCELLED result with no receipt and cleaned root', async () => {
  const parent = parentRoot(); let result;
  try {
    ({ value: result } = await guardSideEffects(async () => {
      const mod = await import(runnerUrl);
      return mod.runRepositoryFixtureAcceptanceV1({ parentRoot: parent, profile: mod.REPOSITORY_FIXTURE_RUNNER_PROFILE, signal: AbortSignal.abort() });
    }, parent));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  assert.equal(result.status, 'CANCELLED');
  assert.equal(result.settledBeforeReceipt, false);
  assert.equal(result.receipt, null);
  assert.equal(result.cleaned, true);
  assert.equal(typeof result.ownedRoot, 'string');
  assert.equal(fs.existsSync(result.ownedRoot), false);
});

test('wrong profile is refused before any run, with no owned root', async () => {
  const parent = parentRoot(); let result;
  try {
    ({ value: result } = await guardSideEffects(async () => {
      const mod = await import(runnerUrl);
      return mod.runRepositoryFixtureAcceptanceV1({ parentRoot: parent, profile: 'nope-not-the-runner-profile' });
    }, parent));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  assert.equal(result.status, 'REFUSED');
  assert.equal(result.reason, 'PROFILE_REQUIRED');
  assert.equal(result.ownedRoot, null);
  assert.equal(result.cleaned, true);
  assert.equal(result.settledBeforeReceipt, false);
  assert.equal(result.receipt, null);
});

test('a host that refuses to settle is UNCONFIRMED: no receipt, cleaned root, QUARANTINED host result', async () => {
  const parent = parentRoot(); let outcome, retainedNames;
  try {
    outcome = await guardSideEffects(async () => {
      const mod = await import(runnerUrl);
      // The runner's INERT tests-owner settled() is replaced; every other method
      // (run/observations/status/lateObservations) stays inert.
      const value = await mod.runRepositoryFixtureAcceptanceV1({
        parentRoot: parent, profile: mod.REPOSITORY_FIXTURE_RUNNER_PROFILE,
        inject: { testsOwner: { settled: async () => { throw coded('SYNTHETIC_SETTLEMENT'); } } },
      });
      return { value, retainedNames: value.retained.map(r => r.path) };
    }, parent);
    retainedNames = outcome.retainedNames;
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'UNCONFIRMED');
  assert.equal(result.receipt, null);
  assert.equal(result.settledBeforeReceipt, false);
  assert.equal(result.cleaned, true);
  assert.equal(typeof result.ownedRoot, 'string');
  assert.equal(fs.existsSync(result.ownedRoot), false);
  // Defect 5(c): the reviewed host resolves QUARANTINED, never rejects.
  assert.equal(result.hostResult.state, 'QUARANTINED');
  assert.ok(result.hostResult.settlementErrors.some(e => e?.code === 'SYNTHETIC_SETTLEMENT'));
  assert.equal(retainedNames.includes('engine-report.json'), true, 'engine report survives a settlement failure');
  assert.equal(retainedNames.includes('runner-receipt.json'), false, 'no receipt may be retained without a settled host');
});

test('source-pin drift: a tampered pinned source refuses before any run', async () => {
  const parent = parentRoot(); let result;
  const sources = {};
  for (const entry of fixture.reviewedSourceManifest) {
    const p = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/repository-task', entry.path);
    sources[entry.path] = fs.readFileSync(p);
  }
  const tampered = Buffer.from(sources['fixtures/live-baseline/retry-settings.mjs']);
  tampered[0] = tampered[0] === 0x2f ? 0x2e : 0x2f; // flip a byte while staying valid UTF-8-ish
  sources['fixtures/live-baseline/retry-settings.mjs'] = tampered;
  try {
    ({ value: result } = await guardSideEffects(async () => {
      const mod = await import(runnerUrl);
      return mod.runRepositoryFixtureAcceptanceV1({ parentRoot: parent, profile: mod.REPOSITORY_FIXTURE_RUNNER_PROFILE, sources });
    }, parent));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  assert.equal(result.status, 'REFUSED');
  assert.equal(result.reason, 'SOURCE_DRIFT');
  assert.equal(result.ownedRoot, null);
  assert.equal(result.cleaned, true);
  assert.equal(result.settledBeforeReceipt, false);
});

test('source-pin drift: five exact entries plus one unknown entry refuses before any run', async () => {
  const parent = parentRoot(); let result;
  const sources = {};
  for (const entry of fixture.reviewedSourceManifest) {
    const p = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/repository-task', entry.path);
    sources[entry.path] = fs.readFileSync(p);
  }
  sources['fixtures/extra/not-pinned.mjs'] = Buffer.from('nope');
  try {
    ({ value: result } = await guardSideEffects(async () => {
      const mod = await import(runnerUrl);
      return mod.runRepositoryFixtureAcceptanceV1({ parentRoot: parent, profile: mod.REPOSITORY_FIXTURE_RUNNER_PROFILE, sources });
    }, parent));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  assert.equal(result.status, 'REFUSED');
  assert.equal(result.reason, 'SOURCE_DRIFT');
  assert.equal(result.ownedRoot, null);
  assert.equal(result.cleaned, true);
});

// Defect 5(b): a positive sources control — the exact five buffers must be accepted.
test('positive sources control: the exact five pinned buffers complete with the same manifest', async () => {
  const parent = parentRoot(); let result;
  const sources = {};
  for (const entry of fixture.reviewedSourceManifest) {
    const p = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/repository-task', entry.path);
    sources[entry.path] = fs.readFileSync(p);
  }
  try {
    ({ value: result } = await guardSideEffects(async () => {
      const mod = await import(runnerUrl);
      return mod.runRepositoryFixtureAcceptanceV1({ parentRoot: parent, profile: mod.REPOSITORY_FIXTURE_RUNNER_PROFILE, sources });
    }, parent));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(result.revealedSourceManifest, fixture.reviewedSourceManifest);
  assert.equal(result.reviewedSourceFingerprint, fixture.reviewedSourceFingerprint);
  assert.equal(result.hostResult.state, 'SETTLED');
});

// Defect 7 (rev): argument-shape errors MUST throw RUNNER_ARGS per shape, before
// any write, and the temp parent must still be removed.
test('argument shape errors throw RUNNER_ARGS before any side effect', async () => {
  const parent = parentRoot(); let writes = null; let observedForbidden = [];
  try {
    await guardSideEffects(async ({ writes: journal }) => {
      const mod = await import(runnerUrl);
      for (const bad of [
        undefined, null, {}, { parentRoot: 'relative/path', profile: mod.REPOSITORY_FIXTURE_RUNNER_PROFILE },
        { parentRoot: path.join(parent, 'missing-dir'), profile: mod.REPOSITORY_FIXTURE_RUNNER_PROFILE },
        { parentRoot: parent }, { parentRoot: parent, profile: '' },
        { parentRoot: parent, profile: mod.REPOSITORY_FIXTURE_RUNNER_PROFILE, signal: 'not-a-signal' },
        { parentRoot: parent, profile: mod.REPOSITORY_FIXTURE_RUNNER_PROFILE, inject: { testsOwner: 'not-an-object' } },
        { parentRoot: parent, profile: mod.REPOSITORY_FIXTURE_RUNNER_PROFILE, sources: { 'x.mjs': 'not-a-buffer' } },
      ]) {
        await assert.rejects(() => mod.runRepositoryFixtureAcceptanceV1(bad), e => e?.code === 'RUNNER_ARGS', `must throw RUNNER_ARGS for ${JSON.stringify(bad)}`);
      }
      writes = [...journal];
      return null;
    }, parent);
  } catch (e) { observedForbidden.push(e); }
  finally { fs.rmSync(parent, { recursive: true, force: true }); }
  assert.deepEqual(observedForbidden, []);
  assert.deepEqual(writes, [], 'the guard must observe zero writes from the bad-shape loop');
});

// Defect 8 (rev): static import allowlist + no forbidden lane/http/net/tls/child
// imports; the runner is loaded dynamically INSIDE the guard in every test above.
test('runner imports only the allowed allowlist and never a model lane or network module', async () => {
  const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'repository-fixture-runner.mjs'), 'utf8');
  const specifiers = [...source.matchAll(/^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]\s*;?\s*$/gmu)].map(m => m[1]);
  assert.ok(specifiers.length >= 8, `expected a bounded import set, got ${specifiers.length}`);
  const allowlist = new Set([
    'node:events', 'node:fs', 'node:fs/promises', 'node:path', 'node:crypto', 'node:url',
    '../../../workflow/contracts.mjs',
    '../../../workflow/engine.mjs',
    '../../../integrity/record-utils.mjs',
    '../../../examples/repository-task/reviewed-live-fixture-v1.mjs',
    '../../../hosts/repository/reviewed-workflow-v1.mjs',
    '../../../hosts/repository/node-executor-v1.mjs',
    '../../../hosts/repository/node-suite-v1.mjs',
    '../../../hosts/repository/snapshot-contract.mjs',
    '../../../hosts/repository/task-workspace-v1.mjs',
    '../../../hosts/swift-verifier/check-plan-v1.mjs',
    '../../../hosts/swift-verifier/group-contract-utils.mjs',
    '../../../hosts/swift-verifier/protocol.mjs',
    '../../../receipts/swift-static-group-v1.mjs',
    '../../../receipts/swift-static-run-v1.mjs',
    '../../../receipts/repository-execution-v1.mjs',
    '../../../receipts/repository-run-v1.mjs',
  ]);
  for (const specifier of specifiers) {
    assert.ok(allowlist.has(specifier), `import not in allowlist: ${specifier}`);
    assert.ok(!specifier.includes('live-model'), `forbidden lane import: ${specifier}`);
    assert.ok(!/node:(?:http|https|net|tls|child_process|http2|dgram|worker_threads)/.test(specifier), `forbidden network/process import: ${specifier}`);
  }
});