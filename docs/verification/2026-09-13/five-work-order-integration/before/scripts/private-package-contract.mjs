// Private artifact contract. This is a trusted-checkout build tool, not a sandbox.
import assert from 'node:assert/strict';
export const PRIVATE_RUNTIME_FILES = Object.freeze([
  'adapters/apple-foundation-models.mjs', 'adapters/local-chat.mjs',
  'canonical/canonical-json-v1.mjs', 'gate/afm-content-executor.mjs', 'gate/content-consent.mjs',
  'hosts/repository/snapshot-contract.mjs', 'hosts/swift-verifier/owned-child.mjs', 'hosts/swift-verifier/protocol.mjs',
  'index.mjs', 'policy/file-access.mjs', 'serialization/canonical-json-v1.mjs',
  'workflow/contracts.mjs', 'workflow/engine.mjs',
]);
export const PRIVATE_TYPE_FILES = Object.freeze([
  'types/afm-content-executor.d.ts', 'types/apple-foundation-models.d.ts', 'types/canonical.d.ts',
  'types/content-consent.d.ts', 'types/contracts.d.ts', 'types/index.d.ts', 'types/local-chat.d.ts',
  'types/policy.d.ts', 'types/serialization.d.ts', 'types/workflow.d.ts',
]);
const entries = [
  ['.', 'index.mjs', 'index'], ['workflow', 'workflow/engine.mjs', 'workflow'],
  ['policy', 'policy/file-access.mjs', 'policy'], ['serialization', 'serialization/canonical-json-v1.mjs', 'serialization'],
  ['adapters/apple-foundation-models', 'adapters/apple-foundation-models.mjs', 'apple-foundation-models'],
  ['adapters/local-chat', 'adapters/local-chat.mjs', 'local-chat'],
  ['index.mjs', 'index.mjs', 'index'], ['workflow/engine.mjs', 'workflow/engine.mjs', 'workflow'],
  ['workflow/contracts.mjs', 'workflow/contracts.mjs', 'contracts'],
  ['policy/file-access.mjs', 'policy/file-access.mjs', 'policy'],
  ['serialization/canonical-json-v1.mjs', 'serialization/canonical-json-v1.mjs', 'serialization'],
  ['adapters/apple-foundation-models.mjs', 'adapters/apple-foundation-models.mjs', 'apple-foundation-models'],
  ['adapters/local-chat.mjs', 'adapters/local-chat.mjs', 'local-chat'],
  ['canonical/canonical-json-v1.mjs', 'canonical/canonical-json-v1.mjs', 'canonical'],
  ['gate/content-consent.mjs', 'gate/content-consent.mjs', 'content-consent'],
  ['gate/afm-content-executor.mjs', 'gate/afm-content-executor.mjs', 'afm-content-executor'],
];
export const PRIVATE_TYPED_EXPORTS = Object.freeze(Object.fromEntries(entries.map(([key, runtime, type]) =>
  [key === '.' ? key : './' + key, Object.freeze({types: './types/' + type + '.d.ts', default: './' + runtime})])));
export const PRIVATE_PACKAGE_FILES = Object.freeze(['package.json', ...PRIVATE_RUNTIME_FILES, ...PRIVATE_TYPE_FILES].sort());
export function createPrivatePackageMetadata(source) {
  assert.equal(source.name, 'nisi'); assert.equal(source.version, '0.2.0-private.0');
  assert.equal(source.private, true); assert.equal(source.license, 'UNLICENSED');
  assert.equal(source.type, 'module'); assert.equal(source.main, './index.mjs'); assert.equal(source.types, './types/index.d.ts');
  assert.deepEqual(source.engines, {node: '>=22'});
  assert.deepEqual(source.exports, {...PRIVATE_TYPED_EXPORTS, './*': './*'});
  assert.deepEqual(source.files, [...PRIVATE_RUNTIME_FILES, ...PRIVATE_TYPE_FILES]);
  for (const field of ['dependencies', 'optionalDependencies', 'bundledDependencies', 'bundleDependencies', 'peerDependencies'])
    assert(!source[field] || Object.keys(source[field]).length === 0, 'unreviewed ' + field);
  // Deliberate allowlist: checkout-only scripts, dev dependencies and private docs
  // are not package payload. Pack only this staged tree, never the whole checkout.
  return {
    name: source.name, version: source.version, private: true, license: 'UNLICENSED',
    description: source.description, author: source.author, type: 'module',
    engines: {node: source.engines.node}, main: source.main, types: source.types,
    exports: {...PRIVATE_TYPED_EXPORTS, './*': './*'}, files: [...PRIVATE_RUNTIME_FILES, ...PRIVATE_TYPE_FILES],
  };
}
