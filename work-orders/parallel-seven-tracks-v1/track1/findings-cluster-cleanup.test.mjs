// C03 oracle (Fable 5.1, 2026-09-20) — cross-review findings 2, 5, 7 and 8 (README).
// Independent of repository-fixture-runner.test.mjs and findings-cluster-receipt
// .test.mjs; graded with them by `npm run test:c03`. Finding 2: `cleaned` was a
// constant and a removal failure was swallowed. Finding 5: a SETTLED host with a
// CANCELLED report was COMPLETED with a receipt. Finding 7: mkdtemp/chmod sat
// outside the controlled error path. Finding 8: the adverse reason was never
// asserted and cancel reported REPOSITORY_HOST_ERROR instead of ABORTED.
// Every case here captures residue INSIDE the observation window (before the
// test's own finally cleanup) and removes only its own exclusive parent. The
// removal-failure and read-only-parent cases are real filesystem behaviour
// (skipped under euid 0, where permission bits do not refuse) and each has an
// injected twin that runs everywhere; the injected faults go through the same
// module seam the C02 oracle uses, so the runner is never told it is under
// test. Cleanup contract asserted throughout: cleaned:true means the removal
// resolved AND the post-removal lstat was ENOENT, and it never coexists with a
// cleanup error or residue; a rejected removal is never cleaned even when the
// root is gone afterwards. Model-free: the reviewed host runs inert.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runnerUrl = pathToFileURL(path.join(here, 'repository-fixture-runner.mjs'));
const coded = code => Object.assign(new Error(code), { code });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const RETAINED = Object.freeze(['preflight.json', 'engine-report.json', 'host-result.json', 'runner-receipt.json']);
const RETAINED_WITHOUT_RECEIPT = Object.freeze(RETAINED.slice(0, 3));
const parentRoot = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-fixture-parent-')));
// Permission bits do not refuse root; the two real-filesystem cases are skipped there.
const privileged = typeof process.getuid === 'function' && process.getuid() === 0;
// The runner's CANCELLED/UNCONFIRMED/REFUSED results must never carry a receipt.
const ADVERSE = new Set(['CANCELLED', 'TIMED_OUT', 'UNCONFIRMED', 'REFUSED']);

// What is physically inside a directory right now, read with the UNPATCHED
// sync API: names (files and directories) plus each regular file's digest.
function snapshot(dir) {
  const names = fs.readdirSync(dir).sort(), digests = {};
  for (const name of names) {
    const target = path.join(dir, name);
    if (fs.lstatSync(target).isFile()) digests[name] = sha256(fs.readFileSync(target));
  }
  return Object.freeze({ names: Object.freeze(names), digests: Object.freeze(digests) });
}

// Observation window. The runner is loaded INSIDE the patch window; patches
// live on the module objects and are re-synced so named imports see them.
//   plant(owned)   runs at the moment the runner's owned root is created
//   fault          { mkdtemp: code }  reject the owned-root mkdtemp
//                  { chmod: code }    reject the chmod of the owned root
//                  { chmodMode: m }   resolve that chmod but apply mode m instead
//                  { rm: code }       reject the runner's rm of the owned root
//                  { rm: 'skip' }     resolve that rm WITHOUT removing anything
//                  { rmThen: code }   really remove the owned root, THEN reject
//                  { rmPartial: code } remove only the receipt bytes, THEN reject
//                  { lstat: code }    reject the post-removal lstat of the owned root
// `atRemoval` is the owned root's content when the runner's own rm is called;
// `residue` is what is still inside it after the runner returned, read before
// the test's finally cleanup; `parentLeft` is what the caller's parent holds.
async function observe(run, { plant = null, fault = {} } = {}) {
  const journal = [], restores = []; let owned = null, atRemoval = null, removalSeen = false;
  const replace = (object, key, make) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    restores.push(() => Object.defineProperty(object, key, descriptor));
    Object.defineProperty(object, key, { ...descriptor, value: make(descriptor.value) });
  };
  const isOwned = target => owned !== null && String(target) === owned;
  try {
    replace(fsp, 'mkdtemp', original => async function (prefix, options) {
      const ownedTemplate = path.basename(String(prefix)) === 'nisi-fixture-' && owned === null;
      if (ownedTemplate && fault.mkdtemp) { journal.push(['mkdtemp', String(prefix)]); throw coded(fault.mkdtemp); }
      const created = await original.call(this, prefix, options);
      journal.push(['mkdtemp', created]);
      if (ownedTemplate) { owned = created; if (plant) plant(created); }
      return created;
    });
    replace(fsp, 'chmod', original => function (target, mode) {
      journal.push(['chmod', String(target)]);
      if (isOwned(target) && fault.chmod) return Promise.reject(coded(fault.chmod));
      if (isOwned(target) && fault.chmodMode !== undefined) return original.call(this, target, fault.chmodMode);
      return original.call(this, target, mode);
    });
    replace(fsp, 'writeFile', original => function (target, data, options) {
      journal.push(['writeFile', String(target)]);
      return original.call(this, target, data, options);
    });
    replace(fsp, 'rm', original => function (target, options) {
      journal.push(['rm', String(target)]);
      if (isOwned(target)) {
        removalSeen = true;
        if (atRemoval === null) atRemoval = snapshot(owned);
        if (fault.rm === 'skip') return Promise.resolve();
        if (fault.rm) return Promise.reject(coded(fault.rm));
        if (fault.rmThen) return original.call(this, target, options).then(() => { throw coded(fault.rmThen); });
        if (fault.rmPartial) { fs.rmSync(path.join(owned, 'runner-receipt.json')); return Promise.reject(coded(fault.rmPartial)); }
      }
      return original.call(this, target, options);
    });
    replace(fsp, 'lstat', original => function (target, options) {
      if (isOwned(target) && removalSeen && fault.lstat) { journal.push(['lstat', String(target)]); return Promise.reject(coded(fault.lstat)); }
      return original.call(this, target, options);
    });
    syncBuiltinESMExports();
    const mod = await import(runnerUrl);
    const value = await run(mod);
    const ownedExisted = owned === null ? null : fs.existsSync(owned);
    const residue = ownedExisted ? snapshot(owned) : null;
    const parentLeft = owned === null ? null : fs.readdirSync(path.dirname(owned)).sort();
    return { value, journal, owned, atRemoval, ownedExisted, residue, parentLeft };
  } finally { for (const restore of restores.reverse()) restore(); syncBuiltinESMExports(); }
}
const runDefault = (parent, extra = {}, options = {}) => observe(mod =>
  mod.runRepositoryFixtureAcceptanceV1({ parentRoot: parent, profile: mod.REPOSITORY_FIXTURE_RUNNER_PROFILE, ...extra }), options);
// A parent whose planted subtree cannot be removed by an unprivileged user.
const plantLocked = owned => {
  const locked = path.join(owned, 'locked');
  fs.mkdirSync(locked); fs.writeFileSync(path.join(locked, 'inner.txt'), 'planted\n'); fs.chmodSync(locked, 0o000);
};
const unlock = owned => { try { fs.chmodSync(path.join(owned, 'locked'), 0o700); } catch { /* already gone */ } };
// Between mkdtemp and chmod the owned root is swapped for a symlink to the
// caller's parent: anything the runner then did "inside its root" would land
// in the parent, and its rm would follow nothing but unlink the link.
const plantSwap = owned => { fs.rmdirSync(owned); fs.symlinkSync(path.dirname(owned), owned); };
const SENTINEL = 'sentinel.txt';
// Trusted test-only timing seam. C05 refuses caller-owned signal accessors.
// Keep the original cancellation sweep by hooking the prototype only for one
// exact genuine signal, preserving all other receivers and restoring per row.
function flippingSignal(n) {
  const signal = new AbortController().signal; let reads = 0;
  const original = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted');
  const restore = () => {
    Object.defineProperty(AbortSignal.prototype, 'aborted', original);
    assert.deepEqual(Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted'), original);
  };
  Object.defineProperty(AbortSignal.prototype, 'aborted', { ...original, get() {
    if (this === signal) { reads++; return reads > n; }
    return original.get.call(this);
  } });
  try {
    const other = new AbortController();
    assert.equal(other.signal.aborted, false);
    other.abort();
    assert.equal(other.signal.aborted, true);
    assert.equal(reads, 0, 'other signals never advance this row');
    assert.equal(Object.hasOwn(signal, 'aborted'), false, 'no caller-owned override');
  } catch (error) { restore(); throw error; }
  return Object.freeze({ signal, reads: () => reads, restore });
}
const receiptWritten = (outcome, root) => outcome.journal.some(([api, target]) => api === 'writeFile' && target === path.join(root, 'runner-receipt.json'));
const oneRemoval = (outcome, root) => assert.deepEqual(outcome.journal.filter(([api]) => api === 'rm').map(([, t]) => t), [root], 'exactly one rm, of the owned root, is ever attempted');

// Adverse results never carry a receipt or promise a clean root they did not verify.
function assertAdverse(result) {
  assert.ok(ADVERSE.has(result.status), `adverse status expected, got ${result.status}`);
  assert.equal(result.receipt, null, 'an unconfirmed run never returns an accepted completion receipt');
  assert.equal(typeof result.reason, 'string');
  assert.ok(Object.isFrozen(result));
  if (result.cleanupError !== null) { assert.ok(Object.isFrozen(result.cleanupError)); assert.deepEqual(Object.keys(result.cleanupError).sort(), ['code', 'lstatCode', 'systemCode']); }
  if (result.residue !== null) assert.ok(Object.isFrozen(result.residue));
  // The cleanup contract, on every adverse result: cleaned:true is exactly
  // "no cleanup error", and a root with no cleanup error has no residue.
  assert.equal(result.cleaned, result.cleanupError === null, 'cleaned:true admits no cleanup error; a cleanup error admits no cleaned:true');
  if (result.cleanupError === null) assert.equal(result.residue, null, 'no cleanup error means no residue');
  if (result.cleanupError !== null) assert.equal(result.status === 'COMPLETED', false);
}

test('control: the default run is COMPLETED only with a verified removal: cleaned from the post-removal lstat, no cleanup error, no residue', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent); } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.reason, null);
  assert.equal(result.reasonDetail, null);
  assert.equal(result.workflowOutcome, 'COMPLETED');
  assert.equal(result.hostResult.report.outcome, 'COMPLETED');
  assert.equal(result.hostResult.state, 'SETTLED');
  assert.equal(result.hostResult.bundleError, null);
  assert.notEqual(result.hostResult.proposedChanges, null);
  assert.notEqual(result.receipt, null);
  assert.deepEqual(result.retained.map(r => r.path), RETAINED);
  assert.equal(result.cleaned, true);
  assert.equal(result.cleanupError, null);
  assert.equal(result.residue, null);
  assert.equal(result.ownedRoot, outcome.owned);
  assert.equal(outcome.ownedExisted, false);
  assert.deepEqual(outcome.parentLeft, []);
  assert.deepEqual(outcome.atRemoval.names.filter(n => !n.startsWith('nisi-task-')), [...RETAINED].sort(), 'the receipt bytes existed at removal time');
  oneRemoval(outcome, result.ownedRoot);
  assert.ok(Object.isFrozen(result));
});

test('finding 2: a real removal failure (unremovable planted subtree) is never COMPLETED: cleaned false, the rm error preserved, residue captured, receipt withdrawn', { skip: privileged && 'permission bits do not refuse root' }, async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, {}, { plant: plantLocked }); }
  finally { if (outcome?.owned) unlock(outcome.owned); fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'UNCONFIRMED');
  assert.equal(result.reason, 'OWNED_ROOT_REMOVE_FAILED');
  assert.equal(result.reasonDetail, 'EACCES');
  assert.deepEqual(result.cleanupError, { code: 'OWNED_ROOT_REMOVE_FAILED', systemCode: 'EACCES', lstatCode: null });
  assert.equal(result.cleaned, false);
  // The run itself was observed complete; only the removal failed. That evidence stays.
  assert.equal(result.hostResult.state, 'SETTLED');
  assert.equal(result.workflowOutcome, 'COMPLETED');
  assert.equal(result.settledBeforeReceipt, true);
  assert.deepEqual(result.retained.map(r => r.path), RETAINED, 'records written before the failed removal remain retained evidence');
  assert.equal(receiptWritten(outcome, result.ownedRoot), true, 'the receipt bytes were written before the removal failed');
  assert.equal(result.receipt, null, 'a receipt over an unremoved root is no receipt');
  // Residue is what is REALLY left, captured before this test's own cleanup.
  assert.equal(outcome.ownedExisted, true);
  assert.deepEqual(result.residue, outcome.residue.names);
  assert.ok(result.residue.includes('locked'));
  assert.deepEqual(outcome.parentLeft, [path.basename(result.ownedRoot)], 'the unremoved owned root is the only thing left in the caller parent');
  oneRemoval(outcome, result.ownedRoot);
  assertAdverse(result);
});

test('finding 2: an injected removal rejection keeps every retained byte on disk and reports the receipt among the residue', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, {}, { fault: { rm: 'EBUSY' } }); } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'UNCONFIRMED');
  assert.equal(result.reason, 'OWNED_ROOT_REMOVE_FAILED');
  assert.equal(result.reasonDetail, 'EBUSY');
  assert.deepEqual(result.cleanupError, { code: 'OWNED_ROOT_REMOVE_FAILED', systemCode: 'EBUSY', lstatCode: null });
  assert.equal(result.cleaned, false);
  assert.equal(result.receipt, null);
  assert.equal(result.workflowOutcome, 'COMPLETED');
  assert.deepEqual(result.retained.map(r => r.path), RETAINED);
  assert.equal(outcome.ownedExisted, true);
  assert.deepEqual(result.residue, outcome.residue.names);
  assert.ok(result.residue.includes('runner-receipt.json'), 'the receipt bytes are reported as adverse retained evidence');
  assert.equal(result.residue.filter(n => n.startsWith('nisi-task-')).length, 1, 'the materialized workspace is part of the residue');
  for (const record of result.retained) assert.equal(outcome.residue.digests[record.path], record.sha256, `${record.path} residue bytes are the retained bytes`);
  oneRemoval(outcome, result.ownedRoot);
  assertAdverse(result);
});

test('finding 2: a removal that is REJECTED after it emptied the root is never cleaned: the rm code and the lstat ENOENT are both preserved, the receipt withdrawn', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, {}, { fault: { rmThen: 'EIO' } }); } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'UNCONFIRMED');
  assert.equal(result.reason, 'OWNED_ROOT_REMOVE_FAILED');
  assert.equal(result.reasonDetail, 'EIO');
  assert.deepEqual(result.cleanupError, { code: 'OWNED_ROOT_REMOVE_FAILED', systemCode: 'EIO', lstatCode: 'ENOENT' });
  assert.equal(result.cleaned, false, 'a rejected removal is never reported cleaned, even when the root is gone afterwards');
  assert.equal(result.residue, null, 'nothing is left to list');
  assert.equal(result.receipt, null);
  assert.equal(result.workflowOutcome, 'COMPLETED');
  assert.equal(result.hostResult.state, 'SETTLED');
  assert.deepEqual(result.retained.map(r => r.path), RETAINED, 'the receipt bytes that existed before the failed removal stay listed as retained evidence');
  assert.equal(receiptWritten(outcome, result.ownedRoot), true);
  assert.equal(outcome.ownedExisted, false, 'the root really is gone');
  assert.deepEqual(outcome.parentLeft, []);
  oneRemoval(outcome, result.ownedRoot);
  assertAdverse(result);
});

test('finding 2: a removal rejected part-way (the receipt bytes gone, the rest present) lists what is REALLY left after the rm, not what was there before it', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, {}, { fault: { rmPartial: 'EIO' } }); } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'UNCONFIRMED');
  assert.equal(result.reason, 'OWNED_ROOT_REMOVE_FAILED');
  assert.equal(result.reasonDetail, 'EIO');
  assert.deepEqual(result.cleanupError, { code: 'OWNED_ROOT_REMOVE_FAILED', systemCode: 'EIO', lstatCode: null });
  assert.equal(result.cleaned, false);
  assert.equal(result.receipt, null);
  assert.equal(outcome.ownedExisted, true);
  assert.ok(outcome.atRemoval.names.includes('runner-receipt.json'), 'the receipt bytes existed when the rm was called');
  assert.deepEqual(result.retained.map(r => r.path), RETAINED, 'retained records are pre-cleanup observations: the receipt WAS written');
  assert.deepEqual(result.residue, outcome.residue.names, 'residue is what is physically left after the failed rm');
  assert.equal(result.residue.includes('runner-receipt.json'), false, 'the receipt bytes the rm did remove are not promised as residue');
  assert.deepEqual(result.residue, outcome.atRemoval.names.filter(n => n !== 'runner-receipt.json'));
  oneRemoval(outcome, result.ownedRoot);
  assertAdverse(result);
});

test('finding 2: a post-removal lstat error other than ENOENT never establishes cleaned:true, even when the root is gone', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, {}, { fault: { lstat: 'EACCES' } }); } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'UNCONFIRMED');
  assert.equal(result.reason, 'OWNED_ROOT_UNVERIFIED');
  assert.equal(result.reasonDetail, 'EACCES');
  assert.deepEqual(result.cleanupError, { code: 'OWNED_ROOT_UNVERIFIED', systemCode: 'EACCES', lstatCode: 'EACCES' });
  assert.equal(result.cleaned, false, 'only an ENOENT lstat establishes cleaned:true');
  assert.equal(result.residue, null, 'residue is unknown when the root cannot be inspected');
  assert.equal(result.receipt, null);
  assert.equal(outcome.ownedExisted, false, 'the removal itself succeeded; the verification did not');
  assert.ok(outcome.journal.some(([api, t]) => api === 'lstat' && t === result.ownedRoot), 'the runner verified the removal by lstat of the exact owned root');
  oneRemoval(outcome, result.ownedRoot);
  assertAdverse(result);
});

test('finding 2: a removal that resolves without removing anything is OWNED_ROOT_RETAINED, not cleaned', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, {}, { fault: { rm: 'skip' } }); } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'UNCONFIRMED');
  assert.equal(result.reason, 'OWNED_ROOT_RETAINED');
  assert.equal(result.reasonDetail, null);
  assert.deepEqual(result.cleanupError, { code: 'OWNED_ROOT_RETAINED', systemCode: null, lstatCode: null });
  assert.equal(result.cleaned, false);
  assert.equal(result.receipt, null);
  assert.equal(outcome.ownedExisted, true);
  assert.deepEqual(result.residue, outcome.residue.names);
  assert.ok(result.residue.includes('runner-receipt.json'));
  assertAdverse(result);
});

test('finding 2: cleanup failure on an already adverse run preserves the primary adverse status and reason beside the cleanup error', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, { signal: AbortSignal.abort() }, { fault: { rm: 'EPERM' } }); }
  finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'CANCELLED');
  assert.equal(result.reason, 'ABORTED', 'the cancellation stays the primary reason');
  assert.deepEqual(result.cleanupError, { code: 'OWNED_ROOT_REMOVE_FAILED', systemCode: 'EPERM', lstatCode: null });
  assert.equal(result.cleaned, false);
  assert.deepEqual(result.residue, outcome.residue.names);
  assert.deepEqual(result.retained.map(r => r.path), RETAINED_WITHOUT_RECEIPT);
  assert.equal(result.residue.includes('runner-receipt.json'), false, 'no receipt bytes were ever written for a cancelled run');
  assertAdverse(result);
});

test('finding 7: a parent that refuses mkdtemp is REFUSED OWNED_ROOT_UNAVAILABLE with the OS code, no root, no writes, nothing left behind', { skip: privileged && 'permission bits do not refuse root' }, async () => {
  const parent = parentRoot(); let outcome, left;
  try {
    fs.chmodSync(parent, 0o500);
    outcome = await runDefault(parent);
    left = fs.readdirSync(parent);
  } finally { fs.chmodSync(parent, 0o700); fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'REFUSED');
  assert.equal(result.reason, 'OWNED_ROOT_UNAVAILABLE');
  assert.equal(result.reasonDetail, 'EACCES');
  assert.equal(result.ownedRoot, null);
  assert.equal(result.hostResult, null);
  assert.equal(result.preflight, null);
  assert.deepEqual(result.retained, []);
  // No root was ever created: cleaned:true here means nothing to remove, not a verified removal (documented in the runner).
  assert.equal(result.cleaned, true);
  assert.equal(result.cleanupError, null);
  assert.equal(result.residue, null);
  assert.equal(outcome.owned, null);
  assert.deepEqual(outcome.journal.filter(([api]) => api !== 'mkdtemp'), [], 'nothing but the refused mkdtemp was attempted');
  assert.deepEqual(left, []);
  assertAdverse(result);
});

test('finding 7: an injected mkdtemp rejection (runs under any euid) is REFUSED OWNED_ROOT_UNAVAILABLE with the injected code, no root, no writes, nothing left behind', async () => {
  const parent = parentRoot(); let outcome, left;
  try { outcome = await runDefault(parent, {}, { fault: { mkdtemp: 'EACCES' } }); left = fs.readdirSync(parent); }
  finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'REFUSED');
  assert.equal(result.reason, 'OWNED_ROOT_UNAVAILABLE');
  assert.equal(result.reasonDetail, 'EACCES');
  assert.equal(result.ownedRoot, null);
  assert.equal(result.hostResult, null);
  assert.equal(result.preflight, null);
  assert.deepEqual(result.retained, []);
  assert.equal(result.cleaned, true);
  assert.equal(result.cleanupError, null);
  assert.equal(result.residue, null);
  assert.equal(outcome.owned, null);
  assert.deepEqual(outcome.journal, [['mkdtemp', path.join(parent, 'nisi-fixture-')]], 'exactly one refused mkdtemp of the owned-root template under the caller parent, nothing else');
  assert.deepEqual(left, []);
  assertAdverse(result);
});

test('finding 7: a chmod failure after mkdtemp is REFUSED OWNED_ROOT_UNAVAILABLE, retains the exact owned root, and still removes it', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, {}, { fault: { chmod: 'EPERM' } }); } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'REFUSED');
  assert.equal(result.reason, 'OWNED_ROOT_UNAVAILABLE');
  assert.equal(result.reasonDetail, 'EPERM');
  assert.equal(result.ownedRoot, outcome.owned, 'the exact owned root is reported on partial failure');
  assert.equal(typeof result.ownedRoot, 'string');
  assert.equal(result.hostResult, null);
  assert.equal(result.preflight, null);
  assert.deepEqual(result.retained, []);
  assert.equal(outcome.journal.some(([api]) => api === 'writeFile'), false, 'no record is written into a root whose permissions were not established');
  assert.equal(result.cleaned, true);
  assert.equal(result.cleanupError, null);
  assert.equal(outcome.ownedExisted, false);
  assert.deepEqual(outcome.parentLeft, []);
  oneRemoval(outcome, result.ownedRoot);
  assertAdverse(result);
});

test('finding 7: a chmod that resolves but leaves the root at another mode is REFUSED OWNED_ROOT_UNAVAILABLE cause OWNED_ROOT_MODE: nothing is written into a root the runner alone cannot enter', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, {}, { fault: { chmodMode: 0o755 } }); } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'REFUSED');
  assert.equal(result.reason, 'OWNED_ROOT_UNAVAILABLE');
  assert.equal(result.reasonDetail, 'OWNED_ROOT_MODE');
  assert.equal(result.ownedRoot, outcome.owned);
  assert.equal(result.hostResult, null);
  assert.equal(result.preflight, null);
  assert.deepEqual(result.retained, []);
  assert.equal(result.receipt, null);
  assert.equal(outcome.journal.some(([api]) => api === 'writeFile'), false, 'no record is written into a root whose mode was not established');
  assert.deepEqual(outcome.journal.filter(([api]) => api === 'chmod').map(([, t]) => t), [outcome.owned]);
  assert.equal(result.cleaned, true);
  assert.equal(result.cleanupError, null);
  assert.equal(outcome.ownedExisted, false);
  assert.deepEqual(outcome.parentLeft, []);
  oneRemoval(outcome, result.ownedRoot);
  assertAdverse(result);
});

test('finding 7: an owned root swapped for a symlink to the caller parent before chmod is REFUSED cause OWNED_ROOT_NOT_DIRECTORY: nothing is written through it, only the link is removed, the parent is untouched', async () => {
  const parent = parentRoot(); let outcome, parentModeAfter, sentinelAfter;
  fs.writeFileSync(path.join(parent, SENTINEL), 'caller data\n');
  const sentinelBefore = sha256(fs.readFileSync(path.join(parent, SENTINEL)));
  try {
    outcome = await runDefault(parent, {}, { plant: plantSwap });
    parentModeAfter = fs.lstatSync(parent).mode & 0o777; sentinelAfter = sha256(fs.readFileSync(path.join(parent, SENTINEL)));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'REFUSED');
  assert.equal(result.reason, 'OWNED_ROOT_UNAVAILABLE');
  assert.equal(result.reasonDetail, 'OWNED_ROOT_NOT_DIRECTORY');
  assert.equal(result.ownedRoot, outcome.owned);
  assert.equal(result.hostResult, null);
  assert.equal(result.preflight, null);
  assert.deepEqual(result.retained, []);
  assert.equal(result.receipt, null);
  assert.equal(outcome.journal.some(([api]) => api === 'writeFile'), false, 'nothing was written through the swapped root');
  assert.equal(outcome.journal.some(([api, t]) => api === 'mkdtemp' && path.basename(t).startsWith('nisi-task-')), false, 'no workspace was materialized through the swapped root');
  oneRemoval(outcome, result.ownedRoot);
  assert.equal(result.cleaned, true, 'the link itself was removed and verified gone');
  assert.equal(result.cleanupError, null);
  assert.equal(outcome.ownedExisted, false);
  assert.deepEqual(outcome.parentLeft, [SENTINEL], 'the caller parent kept exactly its own file; the link is gone and nothing of the parent was removed');
  assert.equal(sentinelAfter, sentinelBefore, 'the caller file is byte-identical');
  assert.equal(parentModeAfter, 0o700);
  assertAdverse(result);
});

test('finding 8: a pre-aborted signal is CANCELLED with reason ABORTED (the engine code, not the host bundle error), no receipt, verified clean root', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, { signal: AbortSignal.abort() }); } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'CANCELLED');
  assert.equal(result.reason, 'ABORTED');
  assert.equal(result.reasonDetail, null);
  assert.equal(result.hostResult.report.code, 'ABORTED');
  assert.equal(result.hostResult.report.outcome, 'CANCELLED');
  assert.equal(result.workflowOutcome, 'CANCELLED');
  assert.equal(result.hostResult.state, 'QUARANTINED');
  assert.notEqual(result.hostResult.bundleError, null, 'the host bundle error is still surfaced in hostResult, just not as the reason');
  assert.equal(result.settledBeforeReceipt, false);
  assert.deepEqual(result.retained.map(r => r.path), RETAINED_WITHOUT_RECEIPT);
  assert.equal(receiptWritten(outcome, result.ownedRoot), false);
  assert.equal(result.cleaned, true);
  assert.equal(result.cleanupError, null);
  assert.equal(result.residue, null);
  assert.equal(outcome.ownedExisted, false);
  assert.deepEqual(outcome.parentLeft, []);
  assertAdverse(result);
});

test('finding 5: cancellation timing sweep — COMPLETED, workflowOutcome COMPLETED, a receipt and a retained receipt are one and the same fact at every abort point', async () => {
  const rows = [];
  for (const n of [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 64]) {
    const parent = parentRoot(); const flip = flippingSignal(n); let outcome;
    try { outcome = await runDefault(parent, { signal: flip.signal }); }
    finally {
      try { flip.restore(); }
      finally { fs.rmSync(parent, { recursive: true, force: true }); }
    }
    const result = outcome.value, report = result.hostResult.report;
    const completed = result.status === 'COMPLETED';
    assert.equal(completed, report.workflowOutcome === 'COMPLETED', `n=${n}: status COMPLETED iff the engine finished COMPLETED`);
    assert.equal(completed, report.outcome === 'COMPLETED', `n=${n}: status COMPLETED iff report.outcome COMPLETED`);
    assert.equal(completed, result.receipt !== null, `n=${n}: a receipt exists iff COMPLETED`);
    assert.equal(completed, result.retained.some(r => r.path === 'runner-receipt.json'), `n=${n}: a receipt is retained iff COMPLETED`);
    assert.equal(completed, receiptWritten(outcome, result.ownedRoot), `n=${n}: receipt bytes are written iff COMPLETED`);
    assert.equal(completed, result.hostResult.proposedChanges !== null, `n=${n}: a proposal exists iff COMPLETED`);
    if (completed) { assert.equal(result.reason, null); assert.equal(result.hostResult.state, 'SETTLED'); }
    else {
      assert.equal(result.status, 'CANCELLED', `n=${n}: an aborted engine run is CANCELLED`);
      assert.equal(result.reason, 'ABORTED', `n=${n}: the engine's own code is the reason`);
      assert.equal(report.outcome, 'CANCELLED');
      assert.equal(result.receipt, null);
    }
    assert.equal(result.cleaned, true, `n=${n}: cleaned by verified removal`);
    assert.equal(result.cleanupError, null);
    assert.equal(outcome.ownedExisted, false, `n=${n}: the owned root is gone`);
    assert.deepEqual(outcome.parentLeft, []);
    rows.push({ n, reads: flip.reads(), status: result.status, host: result.hostResult.state, outcome: report.outcome });
  }
  // The sweep must actually exercise the interrupted-but-SETTLED window
  // (finding 5's mislabel) as well as both ends.
  assert.ok(rows.some(r => r.status === 'CANCELLED' && r.host === 'SETTLED'), `no abort point settled the host with a CANCELLED report: ${JSON.stringify(rows)}`);
  assert.ok(rows.some(r => r.status === 'CANCELLED' && r.host === 'QUARANTINED'), 'some abort point left the host quarantined');
  assert.ok(rows.some(r => r.status === 'COMPLETED'), 'an abort point past the last guard read completes');
  assert.equal(rows[0].status, 'CANCELLED', 'n=0 aborts before any stage');
});

test('finding 5: a settlement rejection is UNCONFIRMED with the owner\'s own code, no receipt, verified clean root', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent, { inject: { testsOwner: { settled: async () => { throw coded('SYNTHETIC_SETTLEMENT'); } } } }); }
  finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const result = outcome.value;
  assert.equal(result.status, 'UNCONFIRMED');
  assert.equal(result.reason, 'SYNTHETIC_SETTLEMENT');
  assert.equal(result.reasonDetail, null);
  assert.equal(result.hostResult.state, 'QUARANTINED');
  assert.ok(result.hostResult.settlementErrors.some(e => e?.code === 'SYNTHETIC_SETTLEMENT'));
  assert.equal(result.workflowOutcome, 'COMPLETED', 'the engine finished; the host did not settle');
  assert.equal(result.settledBeforeReceipt, false);
  assert.equal(result.receipt, null);
  assert.deepEqual(result.retained.map(r => r.path), RETAINED_WITHOUT_RECEIPT);
  assert.equal(result.cleaned, true);
  assert.equal(result.cleanupError, null);
  assert.equal(result.residue, null);
  assert.equal(outcome.ownedExisted, false);
  assertAdverse(result);
});

test('finding 5: each clause of the completion predicate refuses on its own and names itself; only all five together complete', async () => {
  const parent = parentRoot(); let outcome;
  try { outcome = await runDefault(parent); } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  const mod = await import(runnerUrl);
  const h = outcome.value.hostResult, derive = mod.deriveFixtureCompletionV1;
  assert.equal(typeof derive, 'function', 'the predicate the runner uses must be inspectable');
  const whole = derive(h);
  assert.ok(Object.isFrozen(whole) && Object.isFrozen(whole.clauses));
  assert.deepEqual(whole, { completed: true, status: 'COMPLETED', reason: null,
    clauses: { settled: true, outcomeCompleted: true, workflowCompleted: true, bundleClean: true, proposalPresent: true } });
  const withReport = patch => ({ ...h, report: { ...h.report, ...patch } });
  const cases = [
    ['settled', { ...h, state: 'QUARANTINED' }, 'UNCONFIRMED', 'HOST_NOT_SETTLED'],
    ['outcomeCompleted', withReport({ outcome: 'CANCELLED', code: 'ABORTED' }), 'CANCELLED', 'ABORTED'],
    ['outcomeCompleted', withReport({ outcome: 'TIMED_OUT', code: 'DEADLINE_EXCEEDED' }), 'TIMED_OUT', 'DEADLINE_EXCEEDED'],
    ['outcomeCompleted', withReport({ outcome: 'FAILED', workflowOutcome: 'FAILED', code: 'STATIC_CHECKS_FAILED' }), 'UNCONFIRMED', 'STATIC_CHECKS_FAILED'],
    ['workflowCompleted', withReport({ workflowOutcome: 'CANCELLED' }), 'UNCONFIRMED', 'COMPLETION_UNOBSERVED'],
    ['bundleClean', { ...h, bundleError: Object.freeze({ code: 'REPOSITORY_RUN_MISMATCH', root: null, priorCode: null, systemCode: null }) }, 'UNCONFIRMED', 'REPOSITORY_RUN_MISMATCH'],
    ['proposalPresent', { ...h, proposedChanges: null }, 'UNCONFIRMED', 'REPOSITORY_PROPOSAL_MISSING'],
    // Unknown and absent values: an allowlist refuses them; a denylist of the
    // known-bad values would let them through.
    ['settled', { ...h, state: 'RUNNING' }, 'UNCONFIRMED', 'HOST_NOT_SETTLED'],
    ['settled', { ...h, state: undefined }, 'UNCONFIRMED', 'HOST_NOT_SETTLED'],
    ['settled', (({ state, ...rest }) => rest)(h), 'UNCONFIRMED', 'HOST_NOT_SETTLED'],
    ['outcomeCompleted', withReport({ outcome: 'PENDING' }), 'UNCONFIRMED', 'COMPLETION_UNOBSERVED'],
    ['outcomeCompleted', withReport({ outcome: '' }), 'UNCONFIRMED', 'COMPLETION_UNOBSERVED'],
    ['outcomeCompleted', withReport({ outcome: undefined }), 'UNCONFIRMED', 'COMPLETION_UNOBSERVED'],
    ['workflowCompleted', withReport({ workflowOutcome: 'PENDING' }), 'UNCONFIRMED', 'COMPLETION_UNOBSERVED'],
    ['workflowCompleted', withReport({ workflowOutcome: undefined }), 'UNCONFIRMED', 'COMPLETION_UNOBSERVED'],
    ['bundleClean', { ...h, bundleError: undefined }, 'UNCONFIRMED', 'COMPLETION_UNOBSERVED'],
    ['bundleClean', (({ bundleError, ...rest }) => rest)(h), 'UNCONFIRMED', 'COMPLETION_UNOBSERVED'],
    ['bundleClean', { ...h, bundleError: false }, 'UNCONFIRMED', 'COMPLETION_UNOBSERVED'],
    ['proposalPresent', { ...h, proposedChanges: undefined }, 'UNCONFIRMED', 'REPOSITORY_PROPOSAL_MISSING'],
    ['proposalPresent', (({ proposedChanges, ...rest }) => rest)(h), 'UNCONFIRMED', 'REPOSITORY_PROPOSAL_MISSING'],
    // Closed reader: evidence that is inherited or produced by an accessor is
    // not own data and reads as absent.
    ['settled', Object.defineProperty({ ...h }, 'state', { enumerable: true, configurable: true, get: () => 'SETTLED' }), 'UNCONFIRMED', 'HOST_NOT_SETTLED'],
    ['settled', Object.assign(Object.create({ state: 'SETTLED' }), (({ state, ...rest }) => rest)(h)), 'UNCONFIRMED', 'HOST_NOT_SETTLED'],
    ['outcomeCompleted', { ...h, report: Object.defineProperty({ ...h.report }, 'outcome', { enumerable: true, configurable: true, get: () => 'COMPLETED' }) }, 'UNCONFIRMED', 'COMPLETION_UNOBSERVED'],
    ['workflowCompleted', { ...h, report: Object.assign(Object.create({ workflowOutcome: 'COMPLETED' }), (({ workflowOutcome, ...rest }) => rest)(h.report)) }, 'UNCONFIRMED', 'COMPLETION_UNOBSERVED'],
    ['bundleClean', Object.defineProperty({ ...h }, 'bundleError', { enumerable: true, configurable: true, get: () => null }), 'UNCONFIRMED', 'COMPLETION_UNOBSERVED'],
    ['proposalPresent', Object.defineProperty({ ...h }, 'proposedChanges', { enumerable: true, configurable: true, get: () => h.proposedChanges }), 'UNCONFIRMED', 'REPOSITORY_PROPOSAL_MISSING'],
  ];
  for (const [clause, hostResult, status, reason] of cases) {
    const derived = derive(hostResult);
    assert.equal(derived.completed, false, `${clause} false must not complete`);
    assert.equal(derived.clauses[clause], false, `${clause} names itself`);
    assert.equal(Object.values(derived.clauses).filter(v => v === false).length, clause === 'outcomeCompleted' && hostResult.report.workflowOutcome !== 'COMPLETED' ? 2 : 1, `${clause}: exactly the flipped clause(s) are false`);
    assert.equal(Object.isFrozen(derived) && Object.isFrozen(derived.clauses), true);
    assert.equal(derived.status, status, `${clause}: status`);
    assert.equal(derived.reason, reason, `${clause}: exact adverse reason`);
  }
  // An interrupted report (CANCELLED and TIMED_OUT alike) prefers the engine
  // code even when the host recorded a competing bundle error; without an
  // engine code the bundle code is next, then the generic INTERRUPTED.
  const hostError = Object.freeze({ code: 'REPOSITORY_HOST_ERROR', root: null, priorCode: null, systemCode: null });
  const interrupted = (outcome, code) => derive({ ...withReport({ outcome, workflowOutcome: outcome, code }), state: 'QUARANTINED', bundleError: hostError, proposedChanges: null });
  assert.deepEqual([interrupted('CANCELLED', 'ABORTED').status, interrupted('CANCELLED', 'ABORTED').reason], ['CANCELLED', 'ABORTED']);
  assert.deepEqual([interrupted('TIMED_OUT', 'DEADLINE_EXCEEDED').status, interrupted('TIMED_OUT', 'DEADLINE_EXCEEDED').reason], ['TIMED_OUT', 'DEADLINE_EXCEEDED'], 'TIMED_OUT keeps the engine code ahead of the host bundle error, exactly like CANCELLED');
  assert.deepEqual([interrupted('TIMED_OUT', null).status, interrupted('TIMED_OUT', null).reason], ['TIMED_OUT', 'REPOSITORY_HOST_ERROR']);
  assert.deepEqual([interrupted('CANCELLED', '').status, interrupted('CANCELLED', '').reason], ['CANCELLED', 'REPOSITORY_HOST_ERROR'], 'an empty engine code is no code');
  const bare = derive({ ...withReport({ outcome: 'TIMED_OUT', workflowOutcome: 'TIMED_OUT', code: null }), state: 'QUARANTINED', bundleError: null, proposedChanges: null });
  assert.deepEqual([bare.status, bare.reason], ['TIMED_OUT', 'INTERRUPTED']);
  // Missing or foreign shapes never complete. A host result with NO own keys
  // whose every completion field is inherited has no own evidence at all:
  // every clause is false.
  const inherited = Object.create(h);
  assert.deepEqual(Object.keys(inherited), []);
  assert.deepEqual(derive(inherited), { completed: false, status: 'UNCONFIRMED', reason: 'HOST_NOT_SETTLED',
    clauses: { settled: false, outcomeCompleted: false, workflowCompleted: false, bundleClean: false, proposalPresent: false } });
  for (const foreign of [null, undefined, 0, '', 'SETTLED', true, [], [h], () => h, new Map(), Object.create(null), {}, { state: 'SETTLED' },
    { state: 'SETTLED', report: null, bundleError: null, proposedChanges: {} },
    { ...h, report: [h.report] }, { ...h, report: Object.create(h.report) }, { ...h, report: JSON.stringify(h.report) },
    new Proxy((({ state, ...rest }) => rest)(h), { get: (target, key) => key === 'state' ? 'SETTLED' : target[key] }),
    Object.freeze({ ...h, state: 'SETTLED ' }), { ...h, state: 'settled' }, withReport({ outcome: 'completed' })]) {
    const derived = derive(foreign);
    assert.equal(derived.completed, false, `foreign shape must not complete: ${Object.prototype.toString.call(foreign)}`);
    assert.equal(typeof derived.reason, 'string');
    assert.ok(ADVERSE.has(derived.status));
    assert.ok(Object.isFrozen(derived));
  }
});

test('finding 7: refusals before any root exists (PROFILE_REQUIRED, SOURCE_DRIFT) allocate nothing: no mkdtemp, no write, no removal, the caller parent untouched, ownedRoot null', async () => {
  const cases = [['PROFILE_REQUIRED', { profile: 'not-the-runner-profile' }], ['SOURCE_DRIFT', { sources: {} }]];
  for (const [reason, extra] of cases) {
    const parent = parentRoot(); let outcome, left;
    fs.writeFileSync(path.join(parent, SENTINEL), 'caller data\n');
    try { outcome = await runDefault(parent, extra); left = fs.readdirSync(parent).sort(); }
    finally { fs.rmSync(parent, { recursive: true, force: true }); }
    const result = outcome.value;
    assert.equal(result.status, 'REFUSED', reason);
    assert.equal(result.reason, reason);
    assert.equal(result.reasonDetail, null);
    assert.equal(result.ownedRoot, null);
    assert.equal(outcome.owned, null);
    assert.deepEqual(outcome.journal, [], `${reason}: nothing was allocated, written or removed`);
    assert.deepEqual(left, [SENTINEL], `${reason}: the caller parent holds exactly what it held before`);
    assert.deepEqual(result.retained, []);
    assert.equal(result.receipt, null);
    assert.equal(result.hostResult, null);
    // No root was ever created: cleaned:true means nothing to remove, not a verified removal.
    assert.equal(result.cleaned, true);
    assert.equal(result.cleanupError, null);
    assert.equal(result.residue, null);
    assertAdverse(result);
  }
});

test('finding 2: the result is built after cleanup — the cleanup verdict, not a constant, is what the frozen result carries', async () => {
  // Two runs, identical inputs, one with the removal refused: the ONLY
  // differences in the cleanup projection are the verified fields.
  const project = r => ({ status: r.status, reason: r.reason, reasonDetail: r.reasonDetail, cleaned: r.cleaned, cleanupError: r.cleanupError, residueKind: r.residue === null ? null : 'list', receipt: r.receipt !== null });
  const parentA = parentRoot(), parentB = parentRoot(); let a, b;
  try { a = await runDefault(parentA); b = await runDefault(parentB, {}, { fault: { rm: 'EROFS' } }); }
  finally { fs.rmSync(parentA, { recursive: true, force: true }); fs.rmSync(parentB, { recursive: true, force: true }); }
  assert.deepEqual(project(a.value), { status: 'COMPLETED', reason: null, reasonDetail: null, cleaned: true, cleanupError: null, residueKind: null, receipt: true });
  assert.deepEqual(project(b.value), { status: 'UNCONFIRMED', reason: 'OWNED_ROOT_REMOVE_FAILED', reasonDetail: 'EROFS', cleaned: false,
    cleanupError: { code: 'OWNED_ROOT_REMOVE_FAILED', systemCode: 'EROFS', lstatCode: null }, residueKind: 'list', receipt: false });
  assert.equal(b.value.hostResult.state, 'SETTLED');
  assert.equal(b.value.workflowOutcome, 'COMPLETED');
  assert.deepEqual(b.value.retained.map(r => r.path), RETAINED);
  assert.deepEqual(b.value.residue, b.residue.names);
});
