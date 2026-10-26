// C06 restart integration oracle — SKELETON (Fable co-author draft, 2026-09-20).
// Written against drafts/C06/CONTRACT-PROPOSAL.md. Imports ONLY exports that exist
// today plus the isolated owner candidate's real issued-bundle observation seam.
// Each test names the owner decision it depends on.
// Target path: work-orders/v02-finish-cluster-v1/restart/host-bundle-integration.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openJournalBundle, recordFixedRun, recordHostObservationV1 } from '../../../history/host-journal-bundle.mjs';
import { writeSerializedJournal, readSerializedJournal } from '../../../history/run-journal-store-v1.mjs';
import { reopen } from '../../../history/run-journal-v1.mjs';
import { decideInterruptedRunV1 as decide } from '../../../hosts/repository/interrupted-run-decision-v1.mjs';
import { runRepositoryFixtureAcceptanceV1, REPOSITORY_FIXTURE_RUNNER_PROFILE } from '../../parallel-seven-tracks-v1/track1/repository-fixture-runner.mjs';
import { memfs } from '../../../tests/helpers/memfs.mjs';

const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
// Both existing fresh-process readers refuse any parent outside <repo>/.scratch
// (bundle-restart-demo.mjs:25-28, recovery-worker.mjs:56-69); that boundary is
// theirs, not a storage default of the seam (proposal section 4).
const scratch = join(root, '.scratch');
fs.mkdirSync(scratch, { recursive: true });
const demoCli = join(root, 'tests/fixtures/bundle-restart-demo-cli.mjs');
const recoveryCli = join(root, 'tests/fixtures/journal-restart-recovery-cli.mjs');
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const made = [];
const dir = () => { const d = fs.mkdtempSync(join(scratch, 'c06-')); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const SCHEMA = 'nisi-host-restart-observation/v1';
const STAGE = 'repository-host';
const CONFIG = { projectId: 'project-c06', maxEntries: 8, heartbeatTtlMs: 10, redactPaths: [] };
const NOW = 1000, TTL = 100000;
const hex = c => { assert.match(c, /^[a-f0-9]{1,2}$/); return c.repeat(64 / c.length); };
// Closed key sets copied from the read-only sources (decision D10).
const STATE_OF = { COMPLETED: 'SUCCEEDED', CANCELLED: 'CANCELLED', TIMED_OUT: 'CANCELLED', FAILED: 'FAILED', BLOCKED: 'FAILED', REPAIR_LIMIT: 'FAILED', NO_PROGRESS: 'FAILED' };
const PAYLOAD_KEYS = ['schemaVersion', 'hostSchema', 'hostState', 'runId', 'taskFingerprint', 'candidateFingerprint', 'preparationFingerprint', 'repairAttempts', 'outcome', 'workflowOutcome', 'code', 'bundleFingerprint', 'reportSha256', 'nodeSuiteFingerprint', 'nodeRegistrationFingerprint', 'finalChecksRecordedPass', 'invocationCount', 'executionVerified', 'applied', 'sandboxed', 'certificationGranted', 'learningEligible', 'consentRestored', 'resumeGranted', 'sourceAuthenticityAttested', 'authorizing'];

// Convenience: open explicit storage, then invoke the real issued-bundle seam.
function observe(storage, settled, now = NOW, ttlMs = TTL) {
  const bundle = openJournalBundle({ path: storage.path, fs: storage.fs, config: storage.config, now });
  if (bundle.status === 'REFUSED') return { bundle, result: { status: 'REFUSED', reason: bundle.reason } };
  return { bundle, result: recordHostObservationV1({ bundle, settled, now, ttlMs }) };
}
// Data-only projection of an opened bundle into the classifier's journal input
// (tests/interrupted-run-decision-integration.test.mjs:27-31).
function project(bundle, now) {
  const clone = v => JSON.parse(JSON.stringify(v));
  return { projectId: bundle.recovery.reason === 'HEADER' ? null : CONFIG.projectId, observedAtMs: now,
    recovery: clone(bundle.recovery), sha256: bundle.sha256 ?? null, bytes: bundle.bytes ?? null, entries: clone(bundle.entries) };
}
const expected = (over = {}) => ({ projectId: CONFIG.projectId, runId: 'run-fresh', attempt: 0,
  sourcePins: [{ id: 'candidateFingerprint', sha256: hex('ab') }], profile: { id: 'nisi-json-structure-v1', version: 1, rulesetSha256: hex('ef') },
  consent: { grantedAtMs: 0, expiresAtMs: 10_000_000, revoked: false, scope: 'execute' }, ...over });
function child(cli, request, schema) {
  const run = spawnSync(process.execPath, [cli], { input: JSON.stringify(request), encoding: 'utf8', timeout: 20000, cwd: root });
  assert.equal(run.status, 0, `child exit ${run.status}: ${run.stderr}`);
  assert.equal(run.stderr, '', 'successful child emits no stderr');
  const lines = run.stdout.trim().split('\n');
  assert.equal(lines.length, 1, 'exactly one response line');
  const env = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(env).sort(), ['pid', 'result', 'schema'], 'closed child envelope');
  assert.equal(env.schema, schema);
  assert.notEqual(env.pid, process.pid, 'a genuinely different process');
  return env;
}
const demoInspect = (path, now = NOW) => child(demoCli, { command: 'inspect', path, config: CONFIG, now }, 'nisi-bundle-demo-child/v1');
const recoveryInspect = (path, now = NOW) => child(recoveryCli, { command: 'inspect', path, projectId: CONFIG.projectId, now }, 'nisi-recovery-child/v1');
const realStorage = () => ({ path: join(dir(), 'journal.jsonl'), fs, config: CONFIG });
const memStorage = m => ({ path: '/j/journal.jsonl', fs: m.fs, config: CONFIG });
const LEGACY_SUMMARY = JSON.parse(fs.readFileSync(join(root, 'tests/fixtures/fixed-run/summary-observed.json'), 'utf8'));
const legacyRun = (patch = {}) => ({ summary: structuredClone(LEGACY_SUMMARY), runId: 'legacy-run', attempt: 0,
  candidateId: 'legacy-candidate', receiptId: 'legacy-receipt', createdAt: NOW, ttlMs: TTL, ...patch });

// Decision D2/D8: one real settled host per run of this file, produced by the
// track1 inert runner; the oracle reads only status, hostResult, receipt.runId, cleaned.
let settledPromise = null;
function settledHost() {
  settledPromise ??= (async () => {
    const outcome = await runRepositoryFixtureAcceptanceV1({ parentRoot: dir(), profile: REPOSITORY_FIXTURE_RUNNER_PROFILE });
    assert.equal(outcome.status, 'COMPLETED', `runner: ${outcome.status} ${outcome.reason}`);
    assert.equal(outcome.cleaned, true);
    assert.equal(outcome.hostResult.state, 'SETTLED');
    assert.equal(outcome.receipt.runId, outcome.hostResult.report.runId);
    return outcome;
  })();
  return settledPromise;
}

test('T1 exact settled run/bundle identity: the observation binds runId, attempt, candidate, bundle fingerprint and reportSha256 from the settled record and nothing else', async () => {
  // Depends on D2 (identity source), D3 (journal-entry representation), D5 (id shape).
  const { hostResult } = await settledHost();
  const storage = realStorage();
  const { bundle, result } = observe(storage, hostResult);
  assert.equal(bundle.recovery.status, 'NEW', 'storage was empty before the observation');
  assert.equal(result.status, 'OBSERVED', JSON.stringify(result).slice(0, 300));
  assert.equal(result.reason, null);
  assert.equal(result.store.status, 'WRITTEN');
  assert.equal(result.store.committed, true);
  assert.equal(result.entryId, `${hostResult.report.runId}:${hostResult.report.repairAttempts}:${STAGE}`);
  const onDisk = fs.readFileSync(storage.path);
  assert.equal(sha256(onDisk), result.sha256, 'the reported hash is the on-disk hash');
  assert.equal(onDisk.length, result.bytes);
  assert.deepEqual(fs.readdirSync(dirname(storage.path)), ['journal.jsonl'], 'no temp file remains');
  const back = reopen(onDisk.toString('utf8'));
  assert.equal(back.report.status, 'COMPLETE');
  assert.deepEqual(back.report.recoveredIds, [result.entryId]);
  const [row] = back.journal.list(NOW);
  assert.equal(row.historical, true);
  assert.equal(row.entry.stage, STAGE);
  assert.equal(row.entry.runId, hostResult.report.runId);
  assert.equal(row.entry.attempt, hostResult.report.repairAttempts);
  assert.equal(row.entry.candidateId, hostResult.report.candidateFingerprint);
  assert.equal(row.entry.receiptId, hostResult.bundle.fingerprint);
  assert.equal(row.entry.receiptId, hostResult.bundleSummary.fingerprint, 'bundle and summary agree on the settled fingerprint');
  assert.equal(row.entry.state, STATE_OF[hostResult.report.workflowOutcome]);
  assert.equal(row.liveness, row.entry.state, 'an observation is terminal at birth');
  // On disk the journal is canonical JSON (sorted keys, run-journal-v1.mjs:50-53): compare the closed key SET.
  assert.deepEqual(Object.keys(row.entry.payload).sort(), [...PAYLOAD_KEYS].sort());
  assert.equal(row.entry.payload.schemaVersion, SCHEMA);
  const read = readSerializedJournal({ path: storage.path, fs });
  assert.equal(read.status, 'READ'); assert.equal(read.sha256, result.sha256); assert.equal(read.bytes, result.bytes);
  assert.equal(row.entry.payload.bundleFingerprint, hostResult.bundle.fingerprint);
  assert.equal(row.entry.payload.reportSha256, hostResult.bundle.reportSha256);
  assert.equal(row.entry.payload.reportSha256, hostResult.bundleSummary.reportSha256);
  assert.equal(row.entry.payload.invocationCount, hostResult.invocations.length);
  assert.equal(row.entry.payload.sourceAuthenticityAttested, false);
  assert.doesNotMatch(onDisk.toString('utf8'), /"candidate":\{|"files":/, 'candidate file contents are never copied into the journal');
  for (const flag of ['executionVerified', 'applied', 'sandboxed', 'certificationGranted', 'learningEligible', 'consentRestored', 'resumeGranted', 'authorizing']) {
    assert.equal(row.entry.payload[flag], false, flag);
  }
  for (const flag of ['authorizing', 'executionGranted', 'resumeGranted', 'consentRestored', 'learningPromoted', 'generatedCodeExecuted', 'sourceAuthenticityAttested']) {
    assert.equal(result[flag], false, flag);
  }
  // Re-observing at the same timestamp is DUPLICATE and rewrites nothing.
  const again = observe(storage, hostResult, NOW);
  assert.equal(again.result.status, 'DUPLICATE');
  assert.equal(again.result.store, null);
  assert.deepEqual(fs.readFileSync(storage.path), onDisk, 'a duplicate never rewrites the file');
  const changedTimestamp = observe(storage, hostResult, NOW + 1);
  assert.equal(changedTimestamp.result.status, 'CONFLICT', 'same id with a different createdAt is not a duplicate');
  assert.equal(changedTimestamp.result.reason, 'ID_CONTENT_MISMATCH');
  assert.equal(changedTimestamp.result.store, null);
  assert.deepEqual(fs.readFileSync(storage.path), onDisk, 'an identity/content conflict never rewrites the file');
});

test('T2 an unsettled, mismatched, flagged or mis-shaped host record is refused with a named code and nothing is written', async () => {
  // Depends on D1 (refusal codes live in the seam), D10 (closed key sets).
  const { hostResult } = await settledHost();
  const s = hostResult, sum = s.bundleSummary, rep = s.report;
  let proxyReads = 0;
  const trappedProxy = new Proxy(s, { ownKeys() { proxyReads += 1; throw new Error('MUST_NOT_RUN'); } });
  const revoked = Proxy.revocable(s, {}); revoked.revoke();
  let outcomeCoercions = 0;
  const hostileOutcome = { toString() { outcomeCoercions += 1; throw new Error('MUST_NOT_COERCE'); } };
  const hostileReport = { ...rep, outcome: hostileOutcome, workflowOutcome: hostileOutcome };
  const hostileOutcomeRecord = { ...s, report: hostileReport,
    bundle: { ...s.bundle, report: { ...s.bundle.report, outcome: hostileOutcome, workflowOutcome: hostileOutcome } },
    bundleSummary: { ...sum, outcome: hostileOutcome, workflowOutcome: hostileOutcome } };
  const cases = [
    ['quarantined', { ...s, state: 'QUARANTINED' }, 'HOST_NOT_SETTLED'],
    ['no bundle', { ...s, bundle: null }, 'HOST_NOT_SETTLED'],
    ['no summary', { ...s, bundleSummary: null }, 'HOST_NOT_SETTLED'],
    ['bundle error', { ...s, bundleError: { code: 'REPOSITORY_HISTORY_INVENTORY', root: null, priorCode: null, systemCode: null } }, 'HOST_NOT_SETTLED'],
    ['applied', { ...s, applied: true }, 'HOST_AUTHORITY_FLAGS'],
    ['certified', { ...s, certificationGranted: true }, 'HOST_AUTHORITY_FLAGS'],
    ['summary fingerprint', { ...s, bundleSummary: { ...sum, fingerprint: hex('f') } }, 'HOST_IDENTITY_MISMATCH'],
    ['summary reportSha256', { ...s, bundleSummary: { ...sum, reportSha256: hex('e') } }, 'HOST_IDENTITY_MISMATCH'],
    ['summary runId', { ...s, bundleSummary: { ...sum, runId: 'run-other' } }, 'HOST_IDENTITY_MISMATCH'],
    ['summary not CONSISTENT', { ...s, bundleSummary: { ...sum, status: 'INCONSISTENT' } }, 'HOST_IDENTITY_MISMATCH'],
    ['report runId', { ...s, report: { ...rep, runId: 'run-other' } }, 'HOST_IDENTITY_MISMATCH'],
    ['report outcome', { ...s, report: { ...rep, outcome: 'FAILED', workflowOutcome: 'FAILED' } }, 'HOST_IDENTITY_MISMATCH'],
    ['nonprimitive outcomes', hostileOutcomeRecord, 'HOST_IDENTITY_MISMATCH'],
    ['extra key', { ...s, extra: 1 }, 'HOST_SCHEMA'],
    ['missing key', (() => { const { proposedChanges, ...rest } = s; return rest; })(), 'HOST_SCHEMA'],
    ['wrong schema', { ...s, schemaVersion: 'nisi-reviewed-repository-host-v2' }, 'HOST_SCHEMA'],
    ['accessor key', Object.defineProperty({ ...s }, 'state', { get: () => 'SETTLED', enumerable: true, configurable: true }), 'HOST_SCHEMA'],
    ['trapped proxy', trappedProxy, 'HOST_SCHEMA'],
    ['revoked proxy', revoked.proxy, 'HOST_SCHEMA'],
    ['class instance', Object.assign(Object.create({ inherited: true }), s), 'HOST_SCHEMA'],
    ['null', null, 'HOST_SCHEMA'],
    ['array', [], 'HOST_SCHEMA']
  ];
  for (const [label, forged, code] of cases) {
    const m = memfs();
    const { bundle, result } = observe(memStorage(m), forged);
    assert.equal(bundle.status, 'OPEN', label);
    assert.equal(result.status, 'REFUSED', `${label}: ${JSON.stringify(result).slice(0, 200)}`);
    assert.equal(result.reason, code, label);
    assert.equal(result.store, null, label);
    assert.deepEqual(m.names(), [], `${label}: nothing written`);
    assert.deepEqual(m.events.map(e => e.name), ['readFileSync'], `${label}: only the open read touched the fs`);
    assert.equal(bundle.journal.list(NOW).length, 0, `${label}: nothing appended in memory either`);
  }
  assert.equal(proxyReads, 0, 'proxy detection occurs before any caller trap');
  assert.equal(outcomeCoercions, 0, 'outcome membership never coerces caller values');
});

test('T3 storage is an explicit choice: the seam accepts only bundle/settled/now/ttlMs, never adopts another project, and time cannot run backwards', async () => {
  // Depends on D6: path/fs/project are captured by the private issued bundle, never supplied to this seam.
  const { hostResult } = await settledHost();
  const m = memfs();
  const bundle = openJournalBundle({ path: '/j/journal.jsonl', fs: m.fs, config: CONFIG, now: NOW });
  for (const [label, input, code] of [
    ['no bundle', { bundle: null, settled: hostResult, now: NOW, ttlMs: TTL }, 'INVALID_INPUT'],
    ['bundle-shaped string', { bundle: 'journal.jsonl', settled: hostResult, now: NOW, ttlMs: TTL }, 'INVALID_INPUT'],
    ['missing ttl key', { bundle, settled: hostResult, now: NOW }, 'INVALID_INPUT'],
    ['negative now', { bundle, settled: hostResult, now: -1, ttlMs: TTL }, 'INVALID_TIME'],
    ['zero ttl', { bundle, settled: hostResult, now: NOW, ttlMs: 0 }, 'INVALID_TIME'],
    ['extra storage key', { bundle, settled: hostResult, now: NOW, ttlMs: TTL, path: '/elsewhere/journal.jsonl' }, 'INVALID_INPUT'],
    ['extra project key', { bundle, settled: hostResult, now: NOW, ttlMs: TTL, projectId: CONFIG.projectId }, 'INVALID_INPUT']
  ]) {
    const result = recordHostObservationV1(input);
    assert.equal(result.status, 'REFUSED', label);
    assert.equal(result.reason, code, label);
  }
  assert.deepEqual(m.names(), [], 'no refusal wrote anything');
  // Another project's journal at the chosen path is refused at open and never adopted.
  const other = realStorage();
  const otherCfg = { ...CONFIG, projectId: 'project-other' };
  const seeded = observe({ ...other, config: otherCfg }, hostResult);
  assert.equal(seeded.result.status, 'OBSERVED');
  const before = fs.readFileSync(other.path);
  const adopted = observe(other, hostResult);
  assert.equal(adopted.bundle.status, 'REFUSED'); assert.equal(adopted.bundle.reason, 'PROJECT_MISMATCH');
  assert.equal(adopted.result.status, 'REFUSED'); assert.equal(adopted.result.reason, 'PROJECT_MISMATCH');
  assert.deepEqual(fs.readFileSync(other.path), before);
  // Backwards time against the persisted watermark is a TIME refusal, not a rewrite.
  const own = realStorage();
  assert.equal(observe(own, hostResult, NOW).result.status, 'OBSERVED');
  const back = openJournalBundle({ path: own.path, fs, config: CONFIG, now: NOW - 1 });
  assert.equal(back.status, 'REFUSED'); assert.equal(back.reason, 'INVALID_INPUT', 'openJournalBundle maps a TIME throw to INVALID_INPUT (host-journal-bundle.mjs:86)');
  assert.deepEqual(fs.readdirSync(scratch).filter(n => n === 'journal.jsonl'), [], 'nothing was written at a default location');
});

test('T3a issued identity does not make mutable public bundle fields authoritative', async () => {
  const { hostResult } = await settledHost();
  let getterReads = 0;
  const mutations = [
    ['status', bundle => { bundle.status = 'SEALED'; }],
    ['journal', bundle => { bundle.journal = {}; }],
    ['sha256', bundle => { bundle.sha256 = hex('9'); }],
    ['bytes', bundle => { bundle.bytes = 1; }],
    ['entries', bundle => { bundle.entries = []; }],
    ['accessor', bundle => { Object.defineProperty(bundle, 'journal', { enumerable: true, configurable: true,
      get() { getterReads += 1; throw new Error('MUST_NOT_READ'); } }); }],
  ];
  for (const [label, mutate] of mutations) {
    const m = memfs(), bundle = openJournalBundle({ path: '/j/journal.jsonl', fs: m.fs, config: CONFIG, now: NOW });
    mutate(bundle);
    const result = recordHostObservationV1({ bundle, settled: hostResult, now: NOW, ttlMs: TTL });
    assert.equal(result.status, 'REFUSED', label);
    assert.equal(result.reason, 'BUNDLE_TAMPERED', label);
    assert.equal(result.store, null, label);
    assert.deepEqual(m.names(), [], `${label}: no write`);
  }
  assert.equal(getterReads, 0, 'tamper check uses descriptors without invoking replacement accessors');
});

test('T3b every valid workflow terminal outcome maps behaviorally to one terminal journal state', async () => {
  const { hostResult: source } = await settledHost();
  const matrix = [
    ['COMPLETED', 'SUCCEEDED'], ['CANCELLED', 'CANCELLED'], ['TIMED_OUT', 'CANCELLED'],
    ['FAILED', 'FAILED'], ['BLOCKED', 'FAILED'], ['REPAIR_LIMIT', 'FAILED'], ['NO_PROGRESS', 'FAILED'],
  ];
  for (const [outcome, state] of matrix) {
    const code = outcome === 'COMPLETED' ? null : `SYNTHETIC_${outcome}`;
    const report = { ...source.report, outcome, workflowOutcome: outcome, code };
    const settled = { ...source, report,
      bundle: { ...source.bundle, report: { ...source.bundle.report, outcome, workflowOutcome: outcome, code } },
      bundleSummary: { ...source.bundleSummary, outcome, workflowOutcome: outcome, code } };
    const m = memfs(), { bundle, result } = observe(memStorage(m), settled);
    assert.equal(result.status, 'OBSERVED', outcome);
    const rows = bundle.journal.list(NOW);
    assert.equal(rows.length, 1, outcome);
    assert.equal(rows[0].entry.state, state, outcome);
    assert.equal(rows[0].liveness, state, outcome);
    assert.equal(rows[0].entry.payload.workflowOutcome, outcome, outcome);
  }
});

test('T4 fresh-process reread: two existing readers in different processes recover the observation as historical with the same bytes and hash', async () => {
  // Depends on D7 (both CLIs), D3 (existing format is what they read).
  const { hostResult } = await settledHost();
  const storage = realStorage();
  const { result } = observe(storage, hostResult);
  assert.equal(result.status, 'OBSERVED');
  const onDisk = fs.readFileSync(storage.path);
  const demo = demoInspect(storage.path, NOW + 5);
  assert.deepEqual(Object.keys(demo.result).sort(), ['authorizing', 'bundle', 'bytes', 'generatedCodeExecuted', 'isolationAccepted', 'pid', 'reason', 'record', 'sha256', 'status']);
  assert.equal(demo.result.status, 'INSPECTED');
  assert.equal(demo.result.bundle.status, 'OPEN');
  assert.equal(demo.result.bundle.recovery.status, 'COMPLETE');
  assert.deepEqual(demo.result.bundle.recovery.recoveredIds, [result.entryId]);
  assert.equal(demo.result.bundle.sha256, result.sha256);
  assert.equal(demo.result.bytes, result.bytes);
  assert.equal(demo.result.bundle.entries.length, 1);
  const row = demo.result.bundle.entries[0];
  assert.deepEqual(Object.keys(demo.result.bundle).sort(), ['authorizing', 'bytes', 'entries', 'interrupted', 'recovery', 'sha256', 'status']);
  assert.deepEqual(Object.keys(row).sort(), ['authorizing', 'entry', 'expired', 'historical', 'liveness', 'retained', 'revoked']);
  assert.equal(row.historical, true, 'read from disk, not from memory');
  assert.equal(row.entry.stage, STAGE);
  assert.equal(row.entry.payload.bundleFingerprint, hostResult.bundle.fingerprint);
  assert.equal(row.liveness, STATE_OF[hostResult.report.workflowOutcome]);
  assert.deepEqual(demo.result.bundle.interrupted, [], 'an observation is never interrupted work');
  assert.equal(demo.result.authorizing, false); assert.equal(demo.result.bundle.authorizing, false); assert.equal(row.authorizing, false);
  assert.equal(demo.result.isolationAccepted, false); assert.equal(demo.result.generatedCodeExecuted, false);
  const rec = recoveryInspect(storage.path, NOW + 5);
  assert.deepEqual(Object.keys(rec.result).sort(), ['append', 'authorizing', 'bytes', 'generatedCodeExecuted', 'isolationAccepted', 'reason', 'recovery', 'rows', 'sha256', 'status', 'store']);
  assert.equal(rec.result.status, 'OPEN');
  assert.equal(rec.result.recovery.status, 'COMPLETE');
  assert.equal(rec.result.sha256, result.sha256);
  assert.equal(rec.result.bytes, result.bytes);
  assert.deepEqual(rec.result.rows.map(x => x.entry), demo.result.bundle.entries.map(x => x.entry), 'both readers agree on the exact row');
  assert.notEqual(rec.pid, demo.pid);
  assert.equal(rec.result.authorizing, false); assert.equal(rec.result.isolationAccepted, false); assert.equal(rec.result.generatedCodeExecuted, false);
  assert.equal(rec.result.rows[0].authorizing, false);
  assert.deepEqual(fs.readFileSync(storage.path), onDisk, 'inspection changed nothing on disk');
  // Fresh-process replay of the same observation is DUPLICATE only.
  const replay = child(recoveryCli, { command: 'replay', path: storage.path, projectId: CONFIG.projectId, entry: row.entry, now: NOW + 5 }, 'nisi-recovery-child/v1');
  assert.equal(replay.result.status, 'DUPLICATE');
  assert.deepEqual(fs.readFileSync(storage.path), onDisk);
});

test('T5 an interrupted or truncated write remains adverse: truncated file seals, leftover temp is never adopted, stale expectation conflicts, nothing is repaired', async () => {
  // Depends on D9 (simulated crash; real SIGKILL fixture held for owner command approval).
  const { hostResult } = await settledHost();
  const storage = realStorage();
  const first = observe(storage, hostResult);
  assert.equal(first.result.status, 'OBSERVED');
  const full = fs.readFileSync(storage.path);
  // (1) truncated main file: the recovered prefix is reported, the bundle is SEALED, a new observation is refused, bytes untouched.
  const lines = full.toString('utf8').split('\n');
  fs.writeFileSync(storage.path, lines.slice(0, 2).join('\n') + '\n');
  const damaged = fs.readFileSync(storage.path);
  const sealed = observe(storage, hostResult, NOW + 1);
  assert.equal(sealed.bundle.status, 'SEALED');
  assert.equal(sealed.bundle.recovery.status, 'INCOMPLETE');
  assert.equal(sealed.bundle.recovery.reason, 'MISSING_FOOTER');
  assert.deepEqual(sealed.bundle.recovery.recoveredIds, [first.result.entryId]);
  assert.equal(sealed.result.status, 'REFUSED'); assert.equal(sealed.result.reason, 'BUNDLE_SEALED');
  assert.deepEqual(fs.readFileSync(storage.path), damaged, 'a sealed bundle never rewrites the damaged file');
  const decision = decide({ now: NOW + 1, expected: expected(), journal: project(sealed.bundle, NOW + 1), checkpoint: null });
  assert.equal(decision.status, 'REFUSE_STALE'); assert.equal(decision.reason, 'JOURNAL_SEALED'); assert.equal(decision.checks.journal, 'MISSING_FOOTER');
  assert.equal(decision.resumeGranted, false);
  const demoSealed = demoInspect(storage.path, NOW + 1);
  assert.equal(demoSealed.result.bundle.status, 'SEALED');
  assert.deepEqual(fs.readFileSync(storage.path), damaged, 'a fresh process does not repair it either');
  // (2) hard truncation mid-line: TRUNCATED, still sealed, still refused.
  fs.writeFileSync(storage.path, full.subarray(0, full.length - 7));
  const cut = observe(storage, hostResult, NOW + 2);
  assert.equal(cut.bundle.status, 'SEALED'); assert.equal(cut.bundle.recovery.reason, 'TRUNCATED');
  assert.equal(cut.result.reason, 'BUNDLE_SEALED');
  // (3) leftover temp beside an intact file (a crash between write and rename): never adopted, never cleaned by a reader.
  fs.writeFileSync(storage.path, full);
  const temp = storage.path + '.' + hex('d') + '.tmp';
  fs.writeFileSync(temp, 'garbage that is not a journal\n');
  const intact = openJournalBundle({ path: storage.path, fs, config: CONFIG, now: NOW + 3 });
  assert.equal(intact.status, 'OPEN'); assert.equal(intact.recovery.status, 'COMPLETE');
  assert.equal(intact.sha256, first.result.sha256);
  assert.equal(intact.entries.length, 1);
  assert.deepEqual(fs.readdirSync(dirname(storage.path)).sort(), ['journal.jsonl', temp.slice(dirname(storage.path).length + 1)].sort());
  const demoIntact = demoInspect(storage.path, NOW + 3);
  assert.equal(demoIntact.result.bundle.sha256, first.result.sha256, 'the reader reads journal.jsonl, not the temp');
  fs.rmSync(temp);
  // (4) stale expectation: the exact store call the seam makes (host-journal-bundle.mjs:154-157) with a hash
  // that no longer matches the file is CONFLICT; identical bytes are UNCHANGED; the file is never rewritten.
  const stale = openJournalBundle({ path: storage.path, fs, config: CONFIG, now: NOW + 4 });
  assert.equal(stale.status, 'OPEN'); assert.equal(stale.sha256, first.result.sha256);
  // list(now) during open advances the in-memory watermark. Use the actual
  // original disk bytes to test UNCHANGED, not a newer serialization.
  assert.notEqual(stale.journal.serialize(), full.toString('utf8'));
  const same = writeSerializedJournal({ path: storage.path, fs, serialized: full.toString('utf8'), expectedPreviousSha256: stale.sha256 });
  assert.equal(same.status, 'UNCHANGED', 'identical bytes are compared before anything is touched');
  const conflicting = writeSerializedJournal({ path: storage.path, fs, serialized: stale.journal.serialize(), expectedPreviousSha256: hex('9') });
  assert.equal(conflicting.status, 'REFUSED'); assert.equal(conflicting.reason, 'CONFLICT');
  assert.equal(conflicting.committed, false);
  assert.deepEqual(fs.readFileSync(storage.path), full, 'a stale expectation never rewrites the file');
  assert.deepEqual(fs.readdirSync(dirname(storage.path)), ['journal.jsonl'], 'no temp file survives a refused write');

  // (5) The product seam rolls its in-memory append back when a valid but
  // unexpected file appears after bundle acquisition.
  const conflictFs = memfs();
  const conflictBundle = openJournalBundle({ path: '/j/journal.jsonl', fs: conflictFs.fs, config: CONFIG, now: NOW + 5 });
  const conflictBefore = { sha256: conflictBundle.sha256, bytes: conflictBundle.bytes,
    entries: structuredClone(conflictBundle.entries), journal: conflictBundle.journal.serialize() };
  conflictFs.seed('/j/journal.jsonl', full);
  const conflict = recordHostObservationV1({ bundle: conflictBundle, settled: hostResult, now: NOW + 5, ttlMs: TTL });
  assert.equal(conflict.status, 'STORE_CONFLICT'); assert.equal(conflict.reason, 'CONFLICT');
  assert.equal(conflict.store.reason, 'CONFLICT');
  assert.equal(conflictBundle.journal.serialize(), conflictBefore.journal, 'rollback preserves the pre-append watermark before any reader advances it');
  assert.equal(conflictBundle.journal.list(NOW + 5).length, 0, 'conflicting write rolls back the private journal');
  assert.equal(conflictBundle.sha256, conflictBefore.sha256);
  assert.equal(conflictBundle.bytes, conflictBefore.bytes);
  assert.deepEqual(conflictBundle.entries, conflictBefore.entries);
  assert.equal(conflictBundle.journal.serialize(), conflictBefore.journal);
  assert.deepEqual(conflictFs.bytes('/j/journal.jsonl'), full, 'conflicting durable bytes are untouched');
  conflictFs.files.delete('/j/journal.jsonl');
  const afterConflict = recordFixedRun({ bundle: conflictBundle, run: legacyRun(), now: NOW + 5 });
  assert.equal(afterConflict.status, 'RECORDED', 'legacy recording remains usable after conflict rollback once the external conflict is removed');
  assert.equal(reopen(conflictFs.bytes('/j/journal.jsonl').toString('utf8')).report.status, 'COMPLETE');

  // (6) A write-path failure also rolls back memory and leaves no accepted
  // observation. Failed temporary output is cleaned rather than adopted.
  const ioError = Object.assign(new Error('synthetic rename failure'), { code: 'EIO' });
  let renameArmed = true;
  const failedFs = memfs({ renameSync: () => renameArmed ? ioError : null });
  const failedBundle = openJournalBundle({ path: '/j/journal.jsonl', fs: failedFs.fs, config: CONFIG, now: NOW + 6 });
  const failedBefore = { sha256: failedBundle.sha256, bytes: failedBundle.bytes,
    entries: structuredClone(failedBundle.entries), journal: failedBundle.journal.serialize() };
  const failed = recordHostObservationV1({ bundle: failedBundle, settled: hostResult, now: NOW + 6, ttlMs: TTL });
  assert.equal(failed.status, 'STORE_FAILED'); assert.equal(failed.reason, 'RENAME_FAILED');
  assert.equal(failed.store.reason, 'RENAME_FAILED');
  assert.equal(failedBundle.journal.serialize(), failedBefore.journal, 'rollback preserves the pre-append watermark before any reader advances it');
  assert.equal(failedBundle.journal.list(NOW + 6).length, 0, 'failed write rolls back the private journal');
  assert.equal(failedBundle.sha256, failedBefore.sha256);
  assert.equal(failedBundle.bytes, failedBefore.bytes);
  assert.deepEqual(failedBundle.entries, failedBefore.entries);
  assert.equal(failedBundle.journal.serialize(), failedBefore.journal);
  assert.deepEqual(failedFs.names(), [], 'failed temporary output is removed');
  renameArmed = false;
  const afterFailure = recordFixedRun({ bundle: failedBundle, run: legacyRun(), now: NOW + 6 });
  assert.equal(afterFailure.status, 'RECORDED', 'legacy recording remains usable after the write fault clears');
  assert.equal(reopen(failedFs.bytes('/j/journal.jsonl').toString('utf8')).report.status, 'COMPLETE');
});

test('T6 no rerun, no restored consent, no promoted learning: the settled record is read as data, the classifier refuses consent it was never given and never grants resume', async () => {
  // Depends on D4 (terminal state mapping) and the authority boundary in proposal section 4.
  const outcome = await settledHost();
  const { hostResult } = outcome;
  const invocationsBefore = hostResult.invocations.length;
  const storage = realStorage();
  const { result } = observe(storage, hostResult);
  assert.equal(result.status, 'OBSERVED');
  demoInspect(storage.path, NOW + 1); recoveryInspect(storage.path, NOW + 1);
  assert.equal(hostResult.invocations.length, invocationsBefore, 'observing and rereading never invoke the host again');
  assert.equal(Object.isFrozen(hostResult), true, 'the settled record is immutable data');
  assert.equal(hostResult.bundleSummary.executionVerified, false);
  assert.equal(hostResult.bundleSummary.certificationGranted, false);
  assert.equal(hostResult.applied, false); assert.equal(hostResult.sandboxed, false);
  const bundle = openJournalBundle({ path: storage.path, fs, config: CONFIG, now: NOW + 2 });
  const journal = project(bundle, NOW + 2);
  assert.deepEqual(bundle.interrupted, []);
  // Consent is the caller's: without it the classifier refuses; the observation restores nothing.
  const noConsent = decide({ now: NOW + 2, expected: expected({ consent: null }), journal, checkpoint: null });
  assert.equal(noConsent.status, 'REFUSE_STALE'); assert.equal(noConsent.reason, 'CONSENT_MISSING');
  assert.equal(noConsent.checks.entries, 'OK', 'the observation row is settled, not unreconciled');
  // With the caller's own consent a FRESH run id is a safe restart; every grant flag stays false.
  const fresh = decide({ now: NOW + 2, expected: expected(), journal, checkpoint: null });
  assert.equal(fresh.status, 'SAFE_RESTART');
  assert.equal(fresh.resumeGranted, false); assert.equal(fresh.executionGranted, false); assert.equal(fresh.authorizing, false);
  assert.equal(fresh.journalSha256, result.sha256);
  // Reusing the observed run id is refused: an observation never re-opens its run.
  const reused = decide({ now: NOW + 2, expected: expected({ runId: hostResult.report.runId }), journal, checkpoint: null });
  assert.equal(reused.reason, 'RUN_ID_REUSED');
  // A checkpoint citing the observation cannot make it resumable: it is not interrupted work.
  const ck = { schemaVersion: 'nisi-interrupted-run-checkpoint/v1', projectId: CONFIG.projectId, sourcePins: expected().sourcePins, profile: expected().profile,
    consentGrantedAtMs: 0, entryId: result.entryId, takenAtMs: NOW + 1, completedStages: [] };
  const cited = decide({ now: NOW + 2, expected: expected({ runId: hostResult.report.runId, attempt: hostResult.report.repairAttempts + 1 }), journal, checkpoint: ck });
  assert.equal(cited.status, 'REFUSE_STALE'); assert.equal(cited.reason, 'CHECKPOINT_TARGET');
  assert.equal(cited.checks.checkpoint, STATE_OF[hostResult.report.workflowOutcome]);
  assert.equal(cited.resumeGranted, false);
  // Learning is never promoted by an observation: the flags are constant on disk.
  const text = fs.readFileSync(storage.path, 'utf8');
  assert.match(text, /"learningEligible":false/); assert.match(text, /"consentRestored":false/); assert.match(text, /"resumeGranted":false/);
  assert.doesNotMatch(text, /"learningEligible":true|"executionVerified":true|"resumeGranted":true/);
  // The synthetic mapping table is total over RUN_OUTCOMES and never yields RUNNING/QUEUED.
  for (const state of Object.values(STATE_OF)) assert.ok(['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(state));
});

test('T7 a bundle-shaped object that openJournalBundle did not issue is refused', async () => {
  // Depends on D1: only the module-private WeakMap can grant bundle identity.
  const { hostResult } = await settledHost();
  const m = memfs();
  const issued = openJournalBundle({ path: '/j/journal.jsonl', fs: m.fs, config: CONFIG, now: NOW });
  const forged = { ...issued };
  const result = recordHostObservationV1({ bundle: forged, settled: hostResult, now: NOW, ttlMs: TTL });
  assert.equal(result.status, 'REFUSED', 'a shallow copy is not an issued bundle');
  assert.equal(result.reason, 'INVALID_INPUT');
  assert.deepEqual(m.names(), []);
});
