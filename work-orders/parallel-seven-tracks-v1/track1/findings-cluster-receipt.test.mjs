// C02 oracle (Fable 5.1, 2026-09-20, rev 2) — cross-review findings 1 and 4 (README).
// Independent of repository-fixture-runner.test.mjs and graded with it by
// `npm run test:c02`. Finding 1: the surfaced bundle is re-read through the
// PRODUCT reader from this file's own fixture instance, so a fabricated bundle
// fails the reader's own schema/mismatch check, not a literal comparison.
// Finding 4: the receipt binds runId, repaired candidate, reviewed sources and
// the product bundle; every retained record is exclusive (`wx`), re-read, and
// its digest equals the bytes handed to the write API, the surfaced object AND
// the file on disk at cleanup time. Fault injection through the journal (torn
// read-back, truncated write, EACCES write, EIO read) proves the record is
// DERIVED from the re-read bytes and that each refusal reports its own cause.
// Model-free: no network, no child process; the reviewed host runs inert.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createReviewedLiveFixtureV1 } from '../../../examples/repository-task/reviewed-live-fixture-v1.mjs';
import { readRepositoryRunBundleV1 } from '../../../receipts/repository-run-v1.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const runnerUrl = pathToFileURL(path.join(here, 'repository-fixture-runner.mjs'));
const coded = code => Object.assign(new Error(code), { code });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const text = value => JSON.stringify(value, null, 2) + '\n';
// Exact retained set of a completed run, in retention order (preflight first,
// receipt last and completion-only).
const RETAINED = Object.freeze(['preflight.json', 'engine-report.json', 'host-result.json', 'runner-receipt.json']);
const RETAINED_WITHOUT_RECEIPT = Object.freeze(RETAINED.slice(0, 3));
const PLANTED = 'planted before the runner wrote\n';
const parentRoot = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-fixture-parent-')));
const rawWriteFileSync = fs.writeFileSync;
// APIs that put content into a file (as opposed to creating/removing/chmodding
// a path). The "exact written set" is compared against these only.
const CONTENT_WRITE_APIS = new Set(['fsp.writeFile', 'fsp.appendFile', 'fsp.open', 'fsp.copyFile', 'fsp.rename',
  'fs.writeFileSync', 'fs.appendFileSync', 'fs.openSync', 'fs.open', 'fs.createWriteStream']);
const readOnlyFlags = flags => flags === undefined || flags === 'r' || flags === fs.constants.O_RDONLY ||
  (typeof flags === 'number' && (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)) === 0);

// What is physically inside a directory: regular files with their byte length
// and digest (read with the UNPATCHED sync API), plus directory names.
function snapshotDir(dir) {
  const files = [], dirs = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) dirs.push(entry.name);
    else files.push(Object.freeze({ name: entry.name, byteLength: fs.statSync(target).size, sha256: sha256(fs.readFileSync(target)) }));
  }
  return Object.freeze({ files: Object.freeze(files.sort((a, b) => a.name.localeCompare(b.name))), dirs: Object.freeze(dirs.sort()) });
}

// File-system journal. Every write API the runner could reach is recorded with
// the digest of the bytes handed to it, so "retained" is compared with what was
// actually written, not with what the runner says it wrote. Reads of retained
// names are recorded too (the digest must come from re-read bytes), and so are
// path operations (mkdir/mkdtemp/chmod/rename/rm/...) so containment can be
// asserted over the FULL journal. `plant` pre-creates one file inside the owned
// root at the moment the runner creates that root: the EEXIST oracle. `fault`
// injects one failure on exactly one retained name through the same seam:
//   { api: 'writeFile', name, mode: 'reject', code }  the write rejects with code
//   { api: 'writeFile', name, mode: 'truncate' }      half the bytes reach disk
//   { api: 'readFile',  name, mode: 'reject', code }  the read-back rejects
//   { api: 'readFile',  name, mode: 'alter' }         one bit of the read-back flips
// At the runner's own fsp.rm of the owned root the directory is snapshotted, so
// the retained records can be compared with the files that really existed.
// Patches live on the module objects and are re-synced so named imports
// observe the same functions; the runner is loaded INSIDE the patch window.
async function journalWrites(run, { plant = null, fault = null } = {}) {
  const journal = [], restores = []; let owned = null, cleanupSnapshot = null;
  const replace = (object, key, make) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    restores.push(() => Object.defineProperty(object, key, descriptor));
    Object.defineProperty(object, key, { ...descriptor, value: make(descriptor.value) });
  };
  const record = (api, target, data, flag, to = null) => journal.push(Object.freeze({ api, target: String(target),
    sha256: data === null ? null : sha256(Buffer.isBuffer(data) ? data : Buffer.from(String(data))), flag, to: to === null ? null : String(to) }));
  const flagOf = options => typeof options === 'string' ? options : options?.flag ?? null;
  const hit = (api, target) => fault !== null && fault.api === api && owned !== null && String(target) === path.join(owned, fault.name);
  try {
    replace(fsp, 'writeFile', original => function (target, data, options) {
      record('fsp.writeFile', target, data, flagOf(options));
      if (hit('writeFile', target)) {
        if (fault.mode === 'reject') return Promise.reject(coded(fault.code));
        if (fault.mode === 'truncate') data = Buffer.from(data).subarray(0, Buffer.byteLength(data) >> 1);
      }
      return original.call(this, target, data, options);
    });
    replace(fsp, 'readFile', original => async function (target, ...rest) {
      record('fsp.readFile', target, null, null);
      if (hit('readFile', target)) {
        if (fault.mode === 'reject') throw coded(fault.code);
        const altered = Buffer.from(await original.call(this, target, ...rest));
        altered[0] ^= 0x01;
        return altered;
      }
      return original.call(this, target, ...rest);
    });
    replace(fsp, 'appendFile', original => function (target, data, options) { record('fsp.appendFile', target, data, flagOf(options)); return original.call(this, target, data, options); });
    replace(fsp, 'open', original => function (target, flags, ...rest) { if (!readOnlyFlags(flags)) record('fsp.open', target, null, String(flags)); return original.call(this, target, flags, ...rest); });
    for (const key of ['mkdir', 'chmod', 'unlink', 'truncate']) replace(fsp, key, original => function (target, ...rest) { record(`fsp.${key}`, target, null, null); return original.call(this, target, ...rest); });
    for (const key of ['rename', 'copyFile', 'symlink', 'link']) replace(fsp, key, original => function (from, to, ...rest) { record(`fsp.${key}`, from, null, null, to); return original.call(this, from, to, ...rest); });
    replace(fsp, 'rm', original => function (target, options) {
      record('fsp.rm', target, null, null);
      if (owned !== null && String(target) === owned && cleanupSnapshot === null) cleanupSnapshot = snapshotDir(owned);
      return original.call(this, target, options);
    });
    replace(fs, 'writeFileSync', original => function (target, data, options) { record('fs.writeFileSync', target, data, flagOf(options)); return original.call(this, target, data, options); });
    replace(fs, 'appendFileSync', original => function (target, data, options) { record('fs.appendFileSync', target, data, flagOf(options)); return original.call(this, target, data, options); });
    replace(fs, 'openSync', original => function (target, flags, ...rest) { if (!readOnlyFlags(flags)) record('fs.openSync', target, null, String(flags)); return original.call(this, target, flags, ...rest); });
    replace(fs, 'open', original => function (target, flags, ...rest) { if (typeof flags !== 'function' && !readOnlyFlags(flags)) record('fs.open', target, null, String(flags)); return original.call(this, target, flags, ...rest); });
    replace(fs, 'createWriteStream', original => function (target, options) { record('fs.createWriteStream', target, null, flagOf(options)); return original.call(this, target, options); });
    for (const key of ['mkdirSync', 'chmodSync', 'unlinkSync', 'rmSync', 'truncateSync']) replace(fs, key, original => function (target, ...rest) { record(`fs.${key}`, target, null, null); return original.call(this, target, ...rest); });
    for (const key of ['renameSync', 'copyFileSync', 'symlinkSync', 'linkSync']) replace(fs, key, original => function (from, to, ...rest) { record(`fs.${key}`, from, null, null, to); return original.call(this, from, to, ...rest); });
    replace(fsp, 'mkdtemp', original => async function (prefix, options) {
      const created = await original.call(this, prefix, options);
      record('fsp.mkdtemp', created, null, null);
      if (path.basename(String(prefix)) === 'nisi-fixture-' && owned === null) {
        owned = created;
        if (plant !== null) rawWriteFileSync(path.join(created, plant), PLANTED);
      }
      return created;
    });
    syncBuiltinESMExports();
    const mod = await import(runnerUrl);
    const value = await run(mod);
    const ownedExisted = typeof value?.ownedRoot === 'string' ? fs.existsSync(value.ownedRoot) : null;
    // What the runner left in the CALLER's parent, read before the test removes it.
    const parentLeft = owned === null ? null : fs.readdirSync(path.dirname(owned)).sort();
    return { value, journal, ownedExisted, cleanupSnapshot, parentLeft, owned };
  } finally { for (const restore of restores.reverse()) restore(); syncBuiltinESMExports(); }
}
const runDefault = (parent, extra = {}, options = {}) => journalWrites(mod =>
  mod.runRepositoryFixtureAcceptanceV1({ parentRoot: parent, profile: mod.REPOSITORY_FIXTURE_RUNNER_PROFILE, ...extra }), options);

// Finding 1: re-read the runner's bundle through the product reader with THIS
// file's fixture instance (preparation/suite are original-issued here, plans/
// groups/executions are the runner's original-issued evidence).
function rereadBundle(result, bundle) {
  const h = result.hostResult;
  return readRepositoryRunBundleV1(bundle, { report: h.report, preparation: prepared.repaired, suite: fixture.suite,
    nodeRegistrationFingerprint: bundle.nodeRegistrationFingerprint, plans: h.staticHistory.map(x => x.plan),
    groups: h.staticHistory.map(x => x.group), executions: h.testHistory.map(x => x.execution) });
}
function reread(result) { return rereadBundle(result, result.hostResult.bundle); }
// Content writes that landed directly in the owned root (retained records),
// excluding the nested nisi-task-* workspace the product materializes.
const ownedWrites = (outcome, result) => outcome.journal.filter(w => CONTENT_WRITE_APIS.has(w.api) && path.dirname(w.target) === result.ownedRoot);
const ownedReads = (outcome, result) => outcome.journal.filter(w => w.api === 'fsp.readFile' && path.dirname(w.target) === result.ownedRoot);
const inside = (root, target) => target === root || target.startsWith(root + path.sep);

// Containment over the FULL journal and the disk: the owned root is the only
// thing created in the caller's parent and it is gone before return; every
// path the runner touched (by any journaled API) is the owned root or inside
// it; at the runner's own cleanup the owned root held exactly `files` plus
// `workspaces` nisi-task-* directories; and each retained record describes
// the file that was really on disk at that moment (byteLength and sha256).
function assertContained(outcome, result, files, workspaces) {
  assert.equal(typeof result.ownedRoot, 'string');
  assert.equal(result.ownedRoot, outcome.owned, 'the surfaced ownedRoot is the nisi-fixture- root the journal saw created');
  assert.equal(outcome.ownedExisted, false, 'the owned root must not exist after return');
  assert.deepEqual(outcome.parentLeft, [], 'the runner leaves nothing in the caller parent');
  const outsideOwned = outcome.journal.filter(w => w.api !== 'fsp.readFile' && (!inside(result.ownedRoot, w.target) || (w.to !== null && !inside(result.ownedRoot, w.to))));
  assert.deepEqual(outsideOwned, [], 'every journaled path operation targets the owned root or something inside it');
  assert.deepEqual(outcome.journal.filter(w => w.api === 'fsp.rm').map(w => w.target), [result.ownedRoot], 'exactly one rm, of the owned root');
  const snapshot = outcome.cleanupSnapshot;
  assert.notEqual(snapshot, null, 'the owned root was snapshotted at the runner\'s own cleanup');
  assert.deepEqual(snapshot.files.map(f => f.name), [...files].sort(), 'the owned root held exactly the expected files at cleanup');
  assert.equal(snapshot.dirs.length, workspaces, `the owned root held exactly ${workspaces} workspace director${workspaces === 1 ? 'y' : 'ies'} at cleanup`);
  for (const dir of snapshot.dirs) assert.match(dir, /^nisi-task-/);
  for (const record of result.retained) {
    const onDisk = snapshot.files.find(f => f.name === record.path);
    assert.ok(onDisk !== undefined, `${record.path} must exist on disk at cleanup`);
    assert.equal(record.byteLength, onDisk.byteLength, `${record.path} byteLength must be the file's size on disk`);
    assert.equal(record.sha256, onDisk.sha256, `${record.path} sha256 must be the digest of the file on disk`);
  }
}
// Every retained record: exact name set, byteLength/sha256 of the surfaced
// object's canonical text, one exclusive fsp.writeFile of exactly those bytes,
// and a re-read of the file after that write.
function assertRetained(outcome, result, names, surfaced) {
  assert.deepEqual(result.retained.map(r => r.path), names, 'retained names must be exactly the written set, in retention order');
  for (const record of result.retained) {
    const expected = text(surfaced[record.path]);
    assert.equal(record.byteLength, Buffer.byteLength(expected), `${record.path} byteLength must be the retained bytes`);
    assert.equal(record.sha256, sha256(expected), `${record.path} sha256 must be the digest of the surfaced object as retained`);
  }
  const writes = ownedWrites(outcome, result);
  assert.deepEqual(writes.map(w => [w.api, path.basename(w.target), w.flag]), names.map(name => ['fsp.writeFile', name, 'wx']),
    'exactly the retained names are written, each once, via fsp.writeFile with the exclusive wx flag');
  assert.deepEqual(writes.map(w => w.sha256), result.retained.map(r => r.sha256), 'each retained sha256 must equal the digest of the bytes handed to the write API');
  for (const name of names) {
    const written = outcome.journal.findIndex(w => w.api === 'fsp.writeFile' && w.target === path.join(result.ownedRoot, name));
    const read = outcome.journal.findIndex((w, i) => i > written && w.api === 'fsp.readFile' && w.target === path.join(result.ownedRoot, name));
    assert.ok(written !== -1 && read !== -1, `${name} must be re-read after it is written (digest from actual bytes)`);
  }
  assert.equal(ownedReads(outcome, result).length, names.length, 'each retained record is re-read exactly once');
  assertContained(outcome, result, names, 1);
}
// A retention refusal after the host settled: never COMPLETED, no receipt, the
// host result and the records retained BEFORE the fault survive, the write set
// stops at `attempted` (the faulted name is the last write ever attempted),
// only `read` (default: every attempted name) is read back, and nothing after
// the fault is written or read.
function assertRetentionRefused(outcome, result, { reason, detail, retained, attempted, read = attempted }) {
  const h = result.hostResult;
  assert.equal(result.status, 'UNCONFIRMED');
  assert.equal(result.reason, reason);
  assert.equal(result.reasonDetail, detail, 'the refusal reports its own underlying cause');
  assert.equal(result.receipt, null, 'a receipt that could not be retained is no receipt');
  assert.equal(h.state, 'SETTLED');
  assert.equal(result.settledBeforeReceipt, true);
  assert.equal(result.workflowOutcome, 'COMPLETED');
  assert.deepEqual(result.retained.map(r => r.path), retained);
  assert.deepEqual(ownedWrites(outcome, result).map(w => [w.api, path.basename(w.target), w.flag]), attempted.map(name => ['fsp.writeFile', name, 'wx']),
    'writes stop at the faulted record; nothing after it is attempted');
  assert.deepEqual(ownedReads(outcome, result).map(w => path.basename(w.target)), read, 'each written record is re-read exactly once, in order; nothing else is read');
  for (const record of result.retained) assert.equal(record.sha256, ownedWrites(outcome, result).find(w => path.basename(w.target) === record.path).sha256);
  assert.equal(result.cleaned, true);
}

const prepared = {}; let fixture = null;
test.before(async () => {
  fixture = await createReviewedLiveFixtureV1();
  prepared.baseline = fixture.preparations[0];
  prepared.repaired = fixture.preparations[1];
});

test('F1: the surfaced bundle re-reads CONSISTENT through the product reader from an independent fixture instance', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent); } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value, h = result.hostResult;
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.reason, null);
  assert.equal(result.reasonDetail, null);
  assert.equal(h.state, 'SETTLED');
  assert.equal(h.bundleError, null);
  // A fabricated bundle throws REPOSITORY_RUN_SCHEMA / REPOSITORY_RUN_MISMATCH here.
  const summary = reread(result);
  assert.equal(summary.status, 'CONSISTENT');
  assert.equal(summary.finalChecksRecordedPass, true);
  assert.equal(summary.testCount, 1);
  assert.equal(summary.recordedTestPasses, 1);
  assert.equal(summary.fingerprint, h.bundleSummary.fingerprint);
  assert.equal(summary.fingerprint, h.bundle.fingerprint);
  assert.equal(summary.runId, h.report.runId);
  assert.equal(summary.candidateFingerprint, prepared.repaired.candidateFingerprint);
  assert.equal(summary.preparationFingerprint, prepared.repaired.fingerprint);
  // Exact proposed change: retry-settings.mjs MODIFY, baseline pin -> repair pin.
  const manifest = fixture.reviewedSourceManifest;
  assert.deepEqual(h.proposedChanges.changes.map(c => ({ path: c.path, kind: c.kind,
    before: [c.before.sha256, c.before.byteLength], after: [c.after.sha256, c.after.byteLength] })),
    [{ path: 'retry-settings.mjs', kind: 'MODIFY', before: [manifest[0].sha256, manifest[0].byteLength], after: [manifest[1].sha256, manifest[1].byteLength] }]);
  assert.equal(sha256(Buffer.from(h.proposedChanges.changes[0].before.content, 'utf8')), manifest[0].sha256);
  assert.equal(sha256(Buffer.from(h.proposedChanges.changes[0].after.content, 'utf8')), manifest[1].sha256);
  assert.equal(h.proposedChanges.bundleFingerprint, summary.fingerprint);
  assert.equal(h.proposedChanges.runId, h.report.runId);
  assert.equal(h.proposedChanges.applied, false);
  // Static history: attempt 0 FAILs the baseline, attempt 1 PASSes the repair; one test execution.
  assert.deepEqual(h.staticHistory.map(x => [x.plan.binding.attempt, x.group.adapterResult.status]), [[0, 'FAIL'], [1, 'PASS']]);
  assert.deepEqual(h.staticHistory.map(x => x.plan.binding.preparationFingerprint), [prepared.baseline.fingerprint, prepared.repaired.fingerprint]);
  assert.equal(h.testHistory.length, 1);
  assert.equal(h.testHistory[0].execution.expected.binding.attempt, 1);
  assert.ok(h.testHistory[0].workspace.root.startsWith(result.ownedRoot + path.sep + 'nisi-task-'), 'the test workspace is nested under the owned root');
  assert.ok(outcome.journal.some(w => w.api === 'fsp.mkdtemp' && w.target === h.testHistory[0].workspace.root), 'the workspace was really materialized under the owned root');
  assertContained(outcome, result, RETAINED, 1);
});

test('F1: a fabricated or tampered surfaced bundle is rejected by the product reader', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent); } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'COMPLETED');
  const tampered = structuredClone(result.hostResult.bundle);
  tampered.fingerprint = '0'.repeat(64);
  assert.throws(() => rereadBundle(result, tampered), error => error?.code === 'REPOSITORY_RUN_MISMATCH',
    'changing the product bundle fingerprint must not be accepted as a completed run');
  const fabricated = structuredClone(result.hostResult.bundle);
  delete fabricated.fingerprint;
  assert.throws(() => rereadBundle(result, fabricated), error => error?.code === 'REPOSITORY_RUN_SCHEMA',
    'a fabricated bundle missing a required field must fail the product schema reader');
});

test('F4: the receipt binds runId, the repaired candidate, the reviewed sources and the product bundle, with review defaults off', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent); } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value, h = result.hostResult, receipt = result.receipt, summary = reread(result);
  assert.equal(result.status, 'COMPLETED');
  assert.ok(Object.isFrozen(receipt));
  assert.equal(receipt.schemaVersion, 'nisi-repository-fixture-receipt-v1');
  assert.equal(receipt.hostResultState, 'SETTLED');
  assert.equal(receipt.workflowOutcome, 'COMPLETED');
  assert.equal(receipt.runId, h.report.runId, 'receipt runId must be the engine report runId of THIS run');
  assert.match(receipt.runId, /^[0-9a-f-]{36}$/);
  assert.equal(receipt.candidateFingerprint, prepared.repaired.candidateFingerprint, 'receipt must bind the REPAIRED candidate');
  assert.equal(receipt.candidateFingerprint, h.report.candidateFingerprint);
  assert.notEqual(receipt.candidateFingerprint, prepared.baseline.candidateFingerprint, 'a stale baseline candidate is adverse');
  assert.equal(receipt.reviewedSourceFingerprint, fixture.reviewedSourceFingerprint, 'receipt must bind the reviewed source fingerprint');
  assert.equal(receipt.bundleFingerprint, h.bundle.fingerprint, 'receipt must bind the product bundle fingerprint');
  assert.equal(receipt.bundleFingerprint, summary.fingerprint);
  assert.deepEqual(receipt.reviewDefaults, { history: false, incident: false });
  assert.ok(Object.isFrozen(receipt.reviewDefaults));
  assert.equal(receipt.modelContacted, false);
  assert.equal(receipt.authorizing, false);
  assert.equal(receipt.publishingAllowed, false);
  assert.equal(Object.hasOwn(result, 'historyReview'), false);
  assert.equal(Object.hasOwn(result, 'incidentReview'), false);
  assert.equal(result.reviewedSourceFingerprint, receipt.reviewedSourceFingerprint);
  assert.equal(result.candidateFingerprint, receipt.candidateFingerprint);
  assertContained(outcome, result, RETAINED, 1);
});

test('F4: a completed run retains exactly preflight, engine report, host result and receipt, exclusively, digests from the written bytes', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent); } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value, h = result.hostResult;
  assert.equal(result.status, 'COMPLETED');
  // preflight.json carries the exact manifest and reviewed source fingerprint.
  assert.ok(Object.isFrozen(result.preflight));
  assert.equal(result.preflight.schemaVersion, 'nisi-repository-fixture-preflight-v1');
  assert.deepEqual(result.preflight.reviewedSourceManifest, fixture.reviewedSourceManifest);
  assert.equal(result.preflight.reviewedSourceFingerprint, fixture.reviewedSourceFingerprint);
  assert.equal(result.preflight.sourceFileCount, fixture.reviewedSourceManifest.length);
  assertRetained(outcome, result, RETAINED, { 'preflight.json': result.preflight, 'engine-report.json': h.report, 'host-result.json': h, 'runner-receipt.json': result.receipt });
  // preflight.json is retained BEFORE any host work: before the workspace exists.
  const preflightIndex = outcome.journal.findIndex(w => w.api === 'fsp.writeFile' && w.target === path.join(result.ownedRoot, 'preflight.json'));
  const workspaceIndex = outcome.journal.findIndex(w => w.api === 'fsp.mkdtemp' && w.target === h.testHistory[0].workspace.root);
  assert.ok(preflightIndex !== -1 && workspaceIndex !== -1 && preflightIndex < workspaceIndex, 'preflight.json must be retained before the workspace is materialized');
  // The retained engine report is the same bytes the host result embeds.
  assert.equal(result.retained.find(r => r.path === 'engine-report.json').sha256, sha256(text(h.report)));
});

test('F4: a pre-existing runner-receipt.json is never overwritten: EEXIST is reported, no receipt, retained equals the written set', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, {}, { plant: 'runner-receipt.json' }); }
  finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value, h = result.hostResult;
  assert.equal(result.status, 'UNCONFIRMED');
  assert.equal(result.reason, 'RETAINED_EEXIST');
  assert.equal(result.reasonDetail, 'EEXIST');
  assert.equal(result.receipt, null, 'a receipt that could not be retained is no receipt');
  assert.equal(h.state, 'SETTLED');
  assert.equal(result.settledBeforeReceipt, true);
  assert.deepEqual(result.retained.map(r => r.path), RETAINED_WITHOUT_RECEIPT);
  const writes = ownedWrites(outcome, result);
  assert.deepEqual(writes.map(w => [w.api, path.basename(w.target), w.flag]), RETAINED.map(name => ['fsp.writeFile', name, 'wx']), 'the receipt write was attempted exclusively and refused');
  assert.deepEqual(writes.slice(0, 3).map(w => w.sha256), result.retained.map(r => r.sha256));
  assertContained(outcome, result, RETAINED, 1);
  assert.equal(outcome.cleanupSnapshot.files.find(f => f.name === 'runner-receipt.json').sha256, sha256(PLANTED), 'the planted receipt still holds the planted bytes');
  assert.equal(result.cleaned, true);
});

test('F4: a pre-existing preflight.json stops the run before any host work: nothing retained, no preflight, no workspace, no receipt', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, {}, { plant: 'preflight.json' }); }
  finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'UNCONFIRMED');
  assert.equal(result.reason, 'RETAINED_EEXIST');
  assert.equal(result.reasonDetail, 'EEXIST');
  assert.equal(result.receipt, null);
  assert.equal(result.preflight, null, 'a preflight record that could not be retained is no preflight');
  assert.equal(result.hostResult, null);
  assert.equal(result.settledBeforeReceipt, false);
  assert.deepEqual(result.retained, []);
  assert.deepEqual(ownedWrites(outcome, result).map(w => [w.api, path.basename(w.target), w.flag]), [['fsp.writeFile', 'preflight.json', 'wx']]);
  assert.equal(outcome.journal.some(w => w.api === 'fsp.mkdtemp' && path.basename(w.target).startsWith('nisi-task-')), false, 'no workspace may be materialized when preflight retention fails');
  assertContained(outcome, result, ['preflight.json'], 0);
  assert.equal(outcome.cleanupSnapshot.files[0].sha256, sha256(PLANTED), 'the planted preflight still holds the planted bytes');
  assert.equal(result.cleaned, true);
});

test('F4: a preflight read-back failure stops before host work and preserves only the physical file', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, {}, { fault: { api: 'readFile', name: 'preflight.json', mode: 'reject', code: 'EIO' } }); }
  finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'UNCONFIRMED');
  assert.equal(result.reason, 'RETAINED_READBACK');
  assert.equal(result.reasonDetail, 'EIO');
  assert.equal(result.preflight, null);
  assert.equal(result.hostResult, null);
  assert.equal(result.receipt, null);
  assert.equal(result.settledBeforeReceipt, false);
  assert.deepEqual(result.retained, []);
  assert.deepEqual(ownedWrites(outcome, result).map(w => [w.api, path.basename(w.target), w.flag]),
    [['fsp.writeFile', 'preflight.json', 'wx']]);
  assert.deepEqual(ownedReads(outcome, result).map(w => path.basename(w.target)), ['preflight.json']);
  assert.equal(outcome.journal.some(w => w.api === 'fsp.mkdtemp' && path.basename(w.target).startsWith('nisi-task-')), false,
    'preflight read-back failure must not materialize a workspace');
  assertContained(outcome, result, ['preflight.json'], 0);
  assert.equal(outcome.cleanupSnapshot.files[0].sha256, ownedWrites(outcome, result)[0].sha256,
    'the physically retained preflight bytes remain inspectable even though no record was accepted');
});

test('F4: a torn read-back of host-result.json is RETAINED_READBACK: the record is derived from re-read bytes, and the receipt is never written', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, {}, { fault: { api: 'readFile', name: 'host-result.json', mode: 'alter' } }); }
  finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assertRetentionRefused(outcome, result, { reason: 'RETAINED_READBACK', detail: 'RETAINED_BYTES_DIFFER',
    retained: RETAINED.slice(0, 2), attempted: RETAINED_WITHOUT_RECEIPT });
  // host-result.json was fully written (the fault is on the read-back only); it is on disk but not a record.
  assertContained(outcome, result, RETAINED_WITHOUT_RECEIPT, 1);
  const handed = ownedWrites(outcome, result).find(w => path.basename(w.target) === 'host-result.json').sha256;
  assert.equal(outcome.cleanupSnapshot.files.find(f => f.name === 'host-result.json').sha256, handed);
});

test('F4: a truncated write of engine-report.json is RETAINED_READBACK: retained stops at preflight.json and no later record is attempted', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, {}, { fault: { api: 'writeFile', name: 'engine-report.json', mode: 'truncate' } }); }
  finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assertRetentionRefused(outcome, result, { reason: 'RETAINED_READBACK', detail: 'RETAINED_BYTES_DIFFER',
    retained: RETAINED.slice(0, 1), attempted: RETAINED.slice(0, 2) });
  assertContained(outcome, result, RETAINED.slice(0, 2), 1);
  // The file on disk is the truncated half; its digest is NOT the digest of the bytes handed to the write.
  const handed = ownedWrites(outcome, result).find(w => path.basename(w.target) === 'engine-report.json');
  const onDisk = outcome.cleanupSnapshot.files.find(f => f.name === 'engine-report.json');
  assert.equal(onDisk.byteLength, Buffer.byteLength(text(result.hostResult.report)) >> 1);
  assert.notEqual(onDisk.sha256, handed.sha256);
});

test('F4: a non-EEXIST write failure is RETAINED_WRITE_FAILED with the OS code as reasonDetail, never mistaken for a planted file', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, {}, { fault: { api: 'writeFile', name: 'host-result.json', mode: 'reject', code: 'EACCES' } }); }
  finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  // The rejected write never reached disk, so it is not read back.
  assertRetentionRefused(outcome, result, { reason: 'RETAINED_WRITE_FAILED', detail: 'EACCES',
    retained: RETAINED.slice(0, 2), attempted: RETAINED_WITHOUT_RECEIPT, read: RETAINED.slice(0, 2) });
  assertContained(outcome, result, RETAINED.slice(0, 2), 1);
});

test('F4: a read-back failure is RETAINED_READBACK with the read error code, never mislabelled as a write failure', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, {}, { fault: { api: 'readFile', name: 'engine-report.json', mode: 'reject', code: 'EIO' } }); }
  finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assertRetentionRefused(outcome, result, { reason: 'RETAINED_READBACK', detail: 'EIO',
    retained: RETAINED.slice(0, 1), attempted: RETAINED.slice(0, 2) });
  assertContained(outcome, result, RETAINED.slice(0, 2), 1);
});

test('F4: a receipt read-back failure leaves the settled host diagnostic but never claims a receipt', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, {}, { fault: { api: 'readFile', name: 'runner-receipt.json', mode: 'reject', code: 'EIO' } }); }
  finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assertRetentionRefused(outcome, result, { reason: 'RETAINED_READBACK', detail: 'EIO',
    retained: RETAINED_WITHOUT_RECEIPT, attempted: RETAINED });
  assert.equal(result.workflowOutcome, 'COMPLETED');
  assert.equal(result.hostResult.bundleSummary.status, 'CONSISTENT');
  assertContained(outcome, result, RETAINED, 1);
  const receiptWrite = ownedWrites(outcome, result).find(w => path.basename(w.target) === 'runner-receipt.json');
  assert.equal(outcome.cleanupSnapshot.files.find(f => f.name === 'runner-receipt.json').sha256, receiptWrite.sha256,
    'the failed receipt read-back does not turn the on-disk bytes into a claimed receipt');
});

test('F4: a host that refuses to settle retains preflight, engine report and host result with true digests, and no receipt', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, { inject: { testsOwner: { settled: async () => { throw coded('SYNTHETIC_SETTLEMENT'); } } } }); }
  finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value, h = result.hostResult;
  assert.equal(result.status, 'UNCONFIRMED');
  assert.equal(result.reasonDetail, null);
  assert.equal(h.state, 'QUARANTINED');
  assert.equal(result.receipt, null);
  assertRetained(outcome, result, RETAINED_WITHOUT_RECEIPT, { 'preflight.json': result.preflight, 'engine-report.json': h.report, 'host-result.json': h });
});

test('F4: a cancelled run retains preflight, engine report and host result with true digests, and no receipt', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, { signal: AbortSignal.abort() }); }
  finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value, h = result.hostResult;
  assert.equal(result.status, 'CANCELLED');
  assert.equal(result.receipt, null);
  assert.equal(h.report.workflowOutcome, 'CANCELLED');
  assert.deepEqual(result.retained.map(r => r.path), RETAINED_WITHOUT_RECEIPT);
  for (const record of result.retained) {
    const surfaced = { 'preflight.json': result.preflight, 'engine-report.json': h.report, 'host-result.json': h }[record.path];
    assert.equal(record.byteLength, Buffer.byteLength(text(surfaced)));
    assert.equal(record.sha256, sha256(text(surfaced)));
  }
  assert.deepEqual(ownedWrites(outcome, result).map(w => [w.api, path.basename(w.target), w.flag]), RETAINED_WITHOUT_RECEIPT.map(name => ['fsp.writeFile', name, 'wx']));
  // A pre-aborted run never materializes a workspace.
  assertContained(outcome, result, RETAINED_WITHOUT_RECEIPT, 0);
});
