// Owner lifecycle contract. Faults run only in fresh bounded Node processes;
// actual disk state is captured before the test removes its own exclusive root.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runnerURL = pathToFileURL(join(root, 'work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.mjs')).href;
const cases = [
  {fault:'none', state:'REMOVED', cleaned:true, status:'COMPLETED', error:null, exists:false},
  {fault:'wrong-profile', state:'NOT_CREATED', cleaned:true, status:'REFUSED', error:null, exists:null, reason:'PROFILE_REQUIRED'},
  {fault:'allocation', state:'NOT_CREATED', cleaned:true, status:'REFUSED', error:null, exists:null, reason:'OWNED_ROOT_UNAVAILABLE', detail:'ENOSPC'},
  {fault:'rm-reject', state:'PRESENT', cleaned:false, status:'UNCONFIRMED', error:'OWNED_ROOT_REMOVE_FAILED', exists:true, detail:'EBUSY'},
  {fault:'rm-noop', state:'PRESENT', cleaned:false, status:'UNCONFIRMED', error:'OWNED_ROOT_RETAINED', exists:true},
  {fault:'rm-then-reject', state:'REMOVED', cleaned:false, status:'UNCONFIRMED', error:'OWNED_ROOT_REMOVE_FAILED', exists:false, detail:'EBUSY'},
  {fault:'lstat-unverified', state:'UNKNOWN', cleaned:false, status:'UNCONFIRMED', error:'OWNED_ROOT_UNVERIFIED', exists:false, detail:'EIO'},
];
for (const expectation of cases) test('C03 lifecycle distinguishes ' + expectation.fault, t => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'nisi-c03-state-')));
  t.after(() => rmSync(parent, {recursive:true, force:true}));
  const script = `
    import fs from 'node:fs';
    import fsp from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const fault = ${JSON.stringify(expectation.fault)}, parent = ${JSON.stringify(parent)};
    const original = {mkdtemp:fsp.mkdtemp, rm:fsp.rm, lstat:fsp.lstat};
    let owned = null, allocationAttempts = 0, removalSeen = false, removals = [];
    const error = code => Object.assign(new Error(code), {code});
    fsp.mkdtemp = async (...args) => {
      if (String(args[0]) === parent + '/nisi-fixture-') {
        allocationAttempts++;
        if(fault === 'allocation') throw error('ENOSPC');
        owned = await original.mkdtemp(...args); return owned;
      }
      return original.mkdtemp(...args);
    };
    fsp.rm = async (target, options) => {
      if (owned !== null && target === owned) {
        removalSeen = true; removals.push(target);
        if(fault === 'rm-noop') return;
        if(fault === 'rm-reject') throw error('EBUSY');
        await original.rm(target, options);
        if(fault === 'rm-then-reject') throw error('EBUSY');
        return;
      }
      return original.rm(target, options);
    };
    fsp.lstat = async (...args) => {
      if(args[0] === owned && removalSeen && fault === 'lstat-unverified') throw error('EIO');
      return original.lstat(...args);
    };
    syncBuiltinESMExports();
    const mod = await import(${JSON.stringify(runnerURL)});
    const result = await mod.runRepositoryFixtureAcceptanceV1({parentRoot:parent,
      profile:fault === 'wrong-profile' ? 'wrong-profile' : mod.REPOSITORY_FIXTURE_RUNNER_PROFILE});
    const exists = owned === null ? null : fs.existsSync(owned);
    console.log(JSON.stringify({result, owned, exists, allocationAttempts, removals,
      parentEntries:fs.readdirSync(parent), frozen:Object.isFrozen(result),
      errorFrozen:result.cleanupError === null || Object.isFrozen(result.cleanupError)}));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module','-e',script], {
    cwd:root, encoding:'utf8', timeout:10000, maxBuffer:2 * 1024 * 1024,
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.status, 0, child.stderr);
  const observed = JSON.parse(child.stdout.trim()), result = observed.result;
  assert.equal(result.cleanupState, expectation.state);
  assert.equal(result.cleaned, expectation.cleaned);
  assert.equal(result.status, expectation.status);
  assert.equal(result.cleanupError?.code ?? null, expectation.error);
  const expectedErrors = {
    'rm-reject': {code:'OWNED_ROOT_REMOVE_FAILED', systemCode:'EBUSY', lstatCode:null},
    'rm-noop': {code:'OWNED_ROOT_RETAINED', systemCode:null, lstatCode:null},
    'rm-then-reject': {code:'OWNED_ROOT_REMOVE_FAILED', systemCode:'EBUSY', lstatCode:'ENOENT'},
    'lstat-unverified': {code:'OWNED_ROOT_UNVERIFIED', systemCode:'EIO', lstatCode:'EIO'},
  };
  assert.deepEqual(result.cleanupError, expectedErrors[expectation.fault] ?? null);
  assert.equal(observed.exists, expectation.exists);
  assert.equal(observed.frozen, true); assert.equal(observed.errorFrozen, true);
  assert.equal(result.ownedRoot, observed.owned);
  assert.equal(result.modelContacted, false); assert.equal(result.authorizing, false);
  if (expectation.reason) assert.equal(result.reason, expectation.reason);
  if (expectation.detail) assert.equal(result.reasonDetail, expectation.detail);
  if (expectation.state === 'NOT_CREATED') {
    assert.equal(result.ownedRoot, null); assert.deepEqual(observed.removals, []);
    assert.deepEqual(observed.parentEntries, []); assert.deepEqual(result.retained, []);
    assert.equal(observed.allocationAttempts, expectation.fault === 'allocation' ? 1 : 0);
  } else assert.deepEqual(observed.removals, [observed.owned]);
  if (expectation.error !== null) {
    assert.equal(result.reason, expectation.error); assert.equal(result.receipt, null);
    assert.equal(result.retained.at(-1).path, 'runner-receipt.json', 'previously written receipt remains diagnostic evidence');
    if (expectation.state === 'PRESENT') assert.ok(result.residue.includes('runner-receipt.json'));
    else assert.equal(result.residue, null);
  }
  if (expectation.fault === 'rm-then-reject') assert.equal(result.cleanupError.lstatCode, 'ENOENT');
  if (expectation.fault === 'lstat-unverified') assert.equal(result.cleanupError.lstatCode, 'EIO');
});
