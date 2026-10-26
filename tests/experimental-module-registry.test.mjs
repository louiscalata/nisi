import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createExperimentalModuleRegistryV1, SUPPORTED_EXPERIMENTAL_INTERFACES_V1 } from '../experimental/module-registry-v1.mjs';

const fixturePath = fileURLToPath(new URL('../work-orders/parallel-seven-tracks-v1/track5/retained-bn01-module.json', import.meta.url));
const HOST_BUDGET = Object.freeze({ residentBytes: 67108864, operations: 100000000, maxInferenceMs: 10000, maxOutputBytes: 16384 });

async function fixture() { return JSON.parse(await readFile(fixturePath, 'utf8')); }
function registry() {
  return createExperimentalModuleRegistryV1({
    schemaVersion: 'nisi-experimental-module-registry-v1',
    hostContractId: 'nisi-local-evaluation-host-v1',
    budget: { ...HOST_BUDGET }
  });
}
function activation(manifest) {
  return {
    moduleId: manifest.moduleId,
    versionId: manifest.versionId,
    sourceSha256: manifest.sourceSha256,
    hostContractId: 'nisi-local-evaluation-host-v1',
    resources: { ...manifest.resources },
    consent: 'DECLARE_ACTIVE_ONLY'
  };
}

test('retained BN01 manifest registers inert and never claims runtime effects', async () => {
  const manifest = await fixture();
  const result = registry().register(manifest);
  assert.equal(result.ok, true);
  assert.equal(result.state, 'REGISTERED_INERT');
  assert.deepEqual([result.authorizing, result.installed, result.loaded, result.running], [false, false, false, false]);
  assert.equal(result.manifest.sourceSha256, SUPPORTED_EXPERIMENTAL_INTERFACES_V1[manifest.interfaceId].sourceSha256);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.manifest.resources));
  assert.ok(Object.isFrozen(result.history));
});

test('activation is explicit, declarative only, host-bound, and budget-exact', async () => {
  const manifest = await fixture();
  const subject = registry();
  assert.equal(subject.register(manifest).state, 'REGISTERED_INERT');
  const active = subject.requestActivation(activation(manifest));
  assert.equal(active.state, 'DECLARED_ACTIVE');
  assert.deepEqual([active.authorizing, active.installed, active.loaded, active.running], [false, false, false, false]);

  const other = registry();
  other.register(manifest);
  assert.equal(other.requestActivation({ ...activation(manifest), consent: 'IMPLICIT' }).code, 'EXPLICIT_DECLARATION_CONSENT_REQUIRED');
  assert.equal(other.requestActivation({ ...activation(manifest), hostContractId: 'other-host-v1' }).code, 'HOST_CONTRACT_NOT_ALLOWLISTED');
  const widened = activation(manifest);
  widened.resources.operations += 1;
  assert.equal(other.requestActivation(widened).code, 'BUDGET_WIDENING_REFUSED');
});

test('disable and re-enable preserve immutable identity and ordered history', async () => {
  const manifest = await fixture();
  const subject = registry();
  const registered = subject.register(manifest);
  const active = subject.requestActivation(activation(manifest));
  const disabled = subject.disable({ moduleId: manifest.moduleId, versionId: manifest.versionId, sourceSha256: manifest.sourceSha256 });
  const reenabled = subject.requestActivation(activation(manifest));
  assert.deepEqual(reenabled.history.map(({ state }) => state), ['REGISTERED_INERT', 'DECLARED_ACTIVE', 'DISABLED', 'DECLARED_ACTIVE']);
  assert.equal(new Set(reenabled.history.map(({ identitySha256 }) => identitySha256)).size, 1);
  assert.equal(reenabled.history[0].identitySha256, registered.history[0].identitySha256);
  assert.equal(active.manifest.sourceSha256, disabled.manifest.sourceSha256);
  assert.equal(reenabled.loaded, false);
});

test('duplicate versions, conflicting module identity, and identity rewrite are refused', async () => {
  const manifest = await fixture();
  const subject = registry();
  assert.equal(subject.register(manifest).ok, true);
  assert.equal(subject.register(manifest).code, 'DUPLICATE_MODULE_VERSION');
  const changedVersion = { ...manifest, versionId: 'veritas-bn01-offline-contract-v2' };
  assert.equal(subject.register(changedVersion).code, 'CONFLICTING_MODULE_IDENTITY');
  assert.equal(subject.requestActivation({ ...activation(manifest), sourceSha256: '0'.repeat(64) }).code, 'IDENTITY_REWRITE_REFUSED');
});

test('invented capability, unsupported role/type, source identity drift, and implicit state are refused', async () => {
  const manifest = await fixture();
  assert.equal(registry().register({ ...manifest, capabilityKind: 'MODEL_EXECUTION' }).code, 'INVENTED_CAPABILITY_REFUSED');
  assert.equal(registry().register({ ...manifest, travelerRole: 'ADMIN' }).code, 'UNSUPPORTED_TRAVELER_ROLE');
  assert.equal(registry().register({ ...manifest, dataType: 'OBJECT' }).code, 'UNSUPPORTED_DATA_TYPE');
  assert.equal(registry().register({ ...manifest, sourceSha256: '0'.repeat(64) }).code, 'RETAINED_SOURCE_IDENTITY_MISMATCH');
  assert.equal(registry().register({ ...manifest, requestedState: 'DECLARED_ACTIVE' }).code, 'UNEXPECTED_FIELDS');
  assert.equal(registry().register({ ...manifest, rawCode: 'run()' }).code, 'UNEXPECTED_FIELDS');
  assert.equal(registry().register({ ...manifest, url: 'https://example.invalid' }).code, 'UNEXPECTED_FIELDS');
});

test('plain exact records reject accessors and prototype surprises without invoking them', async () => {
  const manifest = await fixture();
  let reads = 0;
  const accessor = { ...manifest };
  Object.defineProperty(accessor, 'moduleId', { enumerable: true, get() { reads += 1; return manifest.moduleId; } });
  assert.equal(registry().register(accessor).code, 'ACCESSOR_REFUSED');
  assert.equal(reads, 0);
  assert.equal(registry().register(Object.assign(Object.create({ elevated: true }), manifest)).code, 'NON_PLAIN_RECORD');
});

test('caller mutation after registration cannot alter captured manifest or history', async () => {
  const manifest = await fixture();
  const subject = registry();
  const registered = subject.register(manifest);
  manifest.resources.operations = 0;
  manifest.sourceSha256 = '0'.repeat(64);
  const inspected = subject.inspect({ moduleId: registered.manifest.moduleId, versionId: registered.manifest.versionId });
  assert.equal(inspected.manifest.resources.operations, 100000000);
  assert.equal(inspected.manifest.sourceSha256, '3c7b355e67a39c0f0f33a61329208fbfb4627bc1fef0c973d52a7e654957ee19');
  assert.equal(inspected.history.length, 1);
});
