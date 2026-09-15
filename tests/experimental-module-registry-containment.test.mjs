import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createExperimentalModuleRegistryV1, SUPPORTED_EXPERIMENTAL_INTERFACES_V1 } from '../experimental/module-registry-v1.mjs';

const fixture = JSON.parse(readFileSync(new URL('../work-orders/parallel-seven-tracks-v1/track5/retained-bn01-module.json', import.meta.url), 'utf8'));
const BUDGET = Object.freeze({ residentBytes: 67108864, operations: 100000000, maxInferenceMs: 10000, maxOutputBytes: 16384 });
const registry = () => createExperimentalModuleRegistryV1({
  schemaVersion: 'nisi-experimental-module-registry-v1',
  hostContractId: 'nisi-local-evaluation-host-v1',
  budget: { ...BUDGET }
});
const activation = (m, patch = {}) => ({
  moduleId: m.moduleId,
  versionId: m.versionId,
  sourceSha256: m.sourceSha256,
  hostContractId: 'nisi-local-evaluation-host-v1',
  resources: { ...m.resources },
  consent: 'DECLARE_ACTIVE_ONLY',
  ...patch
});

/* ------------------------------------------------------------------ */
/*  D1: identifier validation on inspect() and disable()              */
/* ------------------------------------------------------------------ */
test('D1 — inspect rejects a non-string moduleId with INVALID_MODULE_ID', () => {
  assert.equal(registry().inspect({ moduleId: 123, versionId: 'v' }).code, 'INVALID_MODULE_ID');
});
test('D1 — inspect rejects a NUL-padded moduleId with INVALID_MODULE_ID', () => {
  assert.equal(registry().inspect({ moduleId: 'a\0b', versionId: 'v' }).code, 'INVALID_MODULE_ID');
});
test('D1 — inspect rejects a non-string versionId with INVALID_VERSION_ID', () => {
  assert.equal(registry().inspect({ moduleId: 'a.b', versionId: null }).code, 'INVALID_VERSION_ID');
});
test('D1 — disable rejects a non-string moduleId with INVALID_MODULE_ID', () => {
  const r = registry();
  assert.equal(r.disable({ moduleId: {}, versionId: 'v', sourceSha256: '0'.repeat(64) }).code, 'INVALID_MODULE_ID');
});
test('D1 — disable rejects a NUL-padded moduleId with INVALID_MODULE_ID', () => {
  const r = registry();
  assert.equal(r.disable({ moduleId: 'a\0x', versionId: 'v', sourceSha256: '0'.repeat(64) }).code, 'INVALID_MODULE_ID');
});
test('D1 — disable rejects a non-string versionId with INVALID_VERSION_ID', () => {
  const r = registry();
  assert.equal(r.disable({ moduleId: 'a.b', versionId: 0, sourceSha256: '0'.repeat(64) }).code, 'INVALID_VERSION_ID');
});
test('D1 — valid inspect lookup still resolves to MODULE_NOT_REGISTERED when absent', () => {
  assert.equal(registry().inspect({ moduleId: 'unregistered.a', versionId: 'v1' }).code, 'MODULE_NOT_REGISTERED');
});

/* ------------------------------------------------------------------ */
/*  D2: cloneRecord must refuse non-enumerable and Symbol keys        */
/* ------------------------------------------------------------------ */
test('D2 — register refuses a non-enumerable hidden manifest key', () => {
  const m = { ...fixture };
  Object.defineProperty(m, 'hiddenField', { value: 'secret', enumerable: false });
  const out = registry().register(m);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'UNEXPECTED_FIELDS');
});
test('D2 — register refuses a Symbol manifest key', () => {
  const m = { ...fixture };
  m[Symbol('hidden')] = 'secret';
  const out = registry().register(m);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'UNEXPECTED_FIELDS');
});
test('D2 — requestActivation refuses a non-enumerable hidden request key', () => {
  const subject = registry();
  subject.register(fixture);
  const a = activation(fixture);
  Object.defineProperty(a, 'elevated', { value: true, enumerable: false });
  assert.equal(subject.requestActivation(a).code, 'UNEXPECTED_FIELDS');
});
test('D2 — disable refuses a non-enumerable hidden request key', () => {
  const subject = registry();
  subject.register(fixture);
  const d = { moduleId: fixture.moduleId, versionId: fixture.versionId, sourceSha256: fixture.sourceSha256 };
  Object.defineProperty(d, 'force', { value: true, enumerable: false });
  assert.equal(subject.disable(d).code, 'UNEXPECTED_FIELDS');
});

/* ------------------------------------------------------------------ */
/*  Missing oracle rows: exact schema, duplicate identity, expansion  */
/* ------------------------------------------------------------------ */
test('exact schema version is required', () => {
  assert.equal(registry().register({ ...fixture, schemaVersion: 'nisi-other-v1' }).code, 'INVALID_MANIFEST_SCHEMA');
});
test('duplicate module version and conflicting identity are refused', () => {
  const subject = registry();
  assert.equal(subject.register(fixture).ok, true);
  assert.equal(subject.register(fixture).code, 'DUPLICATE_MODULE_VERSION');
  assert.equal(subject.register({ ...fixture, versionId: 'veritas-bn01-offline-contract-v2' }).code, 'CONFLICTING_MODULE_IDENTITY');
});
test('unknown modules are MODULE_NOT_REGISTERED on every verb', () => {
  const subject = registry();
  assert.equal(subject.inspect({ moduleId: 'ghost', versionId: 'v1' }).code, 'MODULE_NOT_REGISTERED');
  assert.equal(subject.disable({ moduleId: 'ghost', versionId: 'v1', sourceSha256: '0'.repeat(64) }).code, 'MODULE_NOT_REGISTERED');
  assert.equal(subject.requestActivation({ ...activation(fixture, { moduleId: 'ghost' }) }).code, 'MODULE_NOT_REGISTERED');
});
test('no providers/files/tools/policy/rawCode/url expansion', () => {
  for (const extra of [{ providers: { evil: true } }, { files: ['/etc/passwd'] }, { tools: ['exec'] },
    { policy: { escalate: true } }, { rawCode: 'run()' }, { url: 'https://example.invalid' }]) {
    const out = registry().register({ ...fixture, ...extra });
    assert.equal(out.ok, false, JSON.stringify(extra));
    assert.equal(out.code, 'UNEXPECTED_FIELDS', JSON.stringify(extra));
  }
});
test('implicit consent is refused', () => {
  const subject = registry();
  subject.register(fixture);
  assert.equal(subject.requestActivation(activation(fixture, { consent: 'IMPLICIT' })).code, 'EXPLICIT_DECLARATION_CONSENT_REQUIRED');
});

/* ------------------------------------------------------------------ */
/*  Identity stability and ordered history (disable reversibility)    */
/* ------------------------------------------------------------------ */
test('disable and re-enable keep one identity and monotonic ordered history', () => {
  const subject = registry();
  const registered = subject.register(fixture);
  subject.requestActivation(activation(fixture));
  subject.disable({ moduleId: fixture.moduleId, versionId: fixture.versionId, sourceSha256: fixture.sourceSha256 });
  const reenabled = subject.requestActivation(activation(fixture));
  assert.deepEqual(reenabled.history.map(({ state }) => state), ['REGISTERED_INERT', 'DECLARED_ACTIVE', 'DISABLED', 'DECLARED_ACTIVE']);
  assert.deepEqual(reenabled.history.map(({ sequence }) => sequence), [1, 2, 3, 4]);
  assert.equal(new Set(reenabled.history.map(({ identitySha256 }) => identitySha256)).size, 1);
  assert.equal(reenabled.history[0].identitySha256, registered.history[0].identitySha256);
});

/* ------------------------------------------------------------------ */
/*  Static import surface and containment                              */
/* ------------------------------------------------------------------ */
test('module imports only node:crypto and never a dynamic import', () => {
  const source = readFileSync(new URL('../experimental/module-registry-v1.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((x) => x[1]);
  assert.deepEqual(imports, ['node:crypto']);
  assert.doesNotMatch(source, /import\s*\(|\brequire\s*\(|\beval\s*\(|\bFunction\s*\(|\bchild_process\b|\bexec\b|\bspawn\b|\bnpm\b/);
});
test('supported interface map pins the retained BN01 source identity', () => {
  assert.equal(SUPPORTED_EXPERIMENTAL_INTERFACES_V1[fixture.interfaceId].sourceSha256, fixture.sourceSha256);
});

/* ------------------------------------------------------------------ */
/*  Never-throws envelope contract                                    */
/* ------------------------------------------------------------------ */
test('every public entry returns a frozen record instead of throwing', () => {
  const subject = registry();
  const junk = [null, undefined, 0, 'x', [], {}];
  for (const input of junk) {
    for (const call of [() => subject.register(input), () => subject.requestActivation(input), () => subject.inspect(input), () => subject.disable(input)]) {
      let record;
      assert.doesNotThrow(() => { record = call(); });
      assert.ok(record && typeof record === 'object' && Object.isFrozen(record), JSON.stringify(input));
      assert.equal(typeof record.code, 'string');
      assert.equal(record.authorizing, false);
      assert.equal(record.installed, false);
      assert.equal(record.loaded, false);
      assert.equal(record.running, false);
    }
  }
});