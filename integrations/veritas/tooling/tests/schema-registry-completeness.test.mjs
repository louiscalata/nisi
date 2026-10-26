import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { assertSchemaRegistryClosure, assertSchemaCorpusClosure } from '../scripts/schema-corpus-closure.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolingRoot = path.resolve(here, '..');
const repoRoot = path.resolve(toolingRoot, '..');
const schemasDir = path.join(toolingRoot, 'schemas');
const registryPath = path.join(toolingRoot, 'contracts', 'schema-registry.json');

function loadRegistry() {
  return JSON.parse(readFileSync(registryPath, 'utf8'));
}

const corpusPath = path.join(toolingRoot, 'contracts', 'schema-corpus.json');
const diskPaths = () => readdirSync(schemasDir).filter(f => f.endsWith('.schema.json')).map(f => `tooling/schemas/${f}`).sort();
const loadCorpus = () => JSON.parse(readFileSync(corpusPath, 'utf8'));
const schemaId = name => `https://veritas.invalid/private/schemas/stage5/${name}.v1.json`;
function small() {
  return {
    registry: { schemaVersion: 1, profile: 'veritas-stage5-self-administered-schema-registry-v1', statusCeiling: 'SELF_ADMINISTERED_STRUCTURAL_PREPARATION', schemas: ['a', 'b'].map(name => ({ id: schemaId(name), path: `tooling/schemas/${name}.schema.json` })) },
    corpus: { schemaVersion: 1, corpus: ['a', 'b'].map(name => ({ schemaId: schemaId(name), valid: [{ value: 1 }], invalid: [{ id: `INVALID-${name.toUpperCase()}`, value: {} }] })) },
    disk: ['tooling/schemas/a.schema.json', 'tooling/schemas/b.schema.json'],
  };
}
function check(value) {
  assertSchemaRegistryClosure(value.registry, value.disk);
  return assertSchemaCorpusClosure(value.registry, value.corpus);
}

test('registered schemas, on-disk schema identities and corpus groups form exact bijections', () => {
  const registry = loadRegistry(), corpus = loadCorpus(), before = JSON.stringify({ registry, corpus });
  assertSchemaRegistryClosure(registry, diskPaths());
  const result = assertSchemaCorpusClosure(registry, corpus);
  assert.deepEqual(result, { schemaCount: 23, validCases: 28, invalidCases: 63, statusCeiling: 'SELF_ADMINISTERED_STRUCTURAL_PREPARATION' });
  assert.equal(JSON.stringify({ registry, corpus }), before);
  assert.ok(Object.isFrozen(result));
});
test('balanced duplicate replaces missing schema without changing aggregate counts: refuses', () => {
  const value = small();
  const before = value.corpus.corpus.reduce((sum, group) => sum + group.valid.length + group.invalid.length, 0);
  value.corpus.corpus[1] = structuredClone(value.corpus.corpus[0]);
  value.corpus.corpus[1].invalid[0].id = 'INVALID-UNIQUE';
  assert.equal(value.corpus.corpus.reduce((sum, group) => sum + group.valid.length + group.invalid.length, 0), before);
  assert.throws(() => check(value), { code: 'CORPUS_DUPLICATE_SCHEMA' });
});

const invalids = [
  ['registry unknown field', x => { x.registry.extra = true; }, 'REGISTRY_SHAPE'],
  ['registry version', x => { x.registry.schemaVersion = 2; }, 'REGISTRY_HEADER'],
  ['registry profile', x => { x.registry.profile = 'other'; }, 'REGISTRY_HEADER'],
  ['registry authority ceiling', x => { x.registry.statusCeiling = 'CERTIFIED'; }, 'REGISTRY_HEADER'],
  ['empty registry', x => { x.registry.schemas = []; }, 'REGISTRY_LIMIT'],
  ['oversized registry', x => { x.registry.schemas = Array(129).fill(x.registry.schemas[0]); }, 'REGISTRY_LIMIT'],
  ['extra registry entry field', x => { x.registry.schemas[0].execute = true; }, 'REGISTRY_ENTRY_SHAPE'],
  ['absolute path', x => { x.registry.schemas[0].path = '/tmp/a.schema.json'; }, 'REGISTRY_PATH'],
  ['path traversal', x => { x.registry.schemas[0].path = 'tooling/schemas/../a.schema.json'; }, 'REGISTRY_PATH'],
  ['backslash', x => { x.registry.schemas[0].path = 'tooling\\schemas\\a.schema.json'; }, 'REGISTRY_PATH'],
  ['nested path', x => { x.registry.schemas[0].path = 'tooling/schemas/child/a.schema.json'; }, 'REGISTRY_PATH'],
  ['dot alias', x => { x.registry.schemas[0].path = './tooling/schemas/a.schema.json'; }, 'REGISTRY_PATH'],
  ['identity path disagreement', x => { x.registry.schemas[0].id = schemaId('b'); }, 'REGISTRY_ID_PATH_BINDING'],
  ['duplicate registry identity and path', x => { x.registry.schemas[1] = structuredClone(x.registry.schemas[0]); }, 'REGISTRY_DUPLICATE_ID'],
  ['registry order', x => { x.registry.schemas.reverse(); }, 'REGISTRY_ORDER'],
  ['missing disk file', x => { x.disk.pop(); }, 'REGISTRY_DISK_COVERAGE'],
  ['extra disk file', x => { x.disk.push('tooling/schemas/c.schema.json'); }, 'REGISTRY_DISK_COVERAGE'],
  ['disk path alias', x => { x.disk[0] = '/tmp/a.schema.json'; }, 'SCHEMA_DISK_PATHS'],
  ['duplicate disk entry', x => { x.disk[1] = x.disk[0]; }, 'SCHEMA_DISK_DUPLICATE'],
  ['disk order', x => { x.disk.reverse(); }, 'SCHEMA_DISK_ORDER'],
  ['corpus unknown field', x => { x.corpus.credit = true; }, 'CORPUS_SHAPE'],
  ['corpus version', x => { x.corpus.schemaVersion = 2; }, 'CORPUS_HEADER'],
  ['empty corpus', x => { x.corpus.corpus = []; }, 'CORPUS_LIMIT'],
  ['oversized corpus', x => { x.corpus.corpus = Array(129).fill(x.corpus.corpus[0]); }, 'CORPUS_LIMIT'],
  ['missing group', x => { x.corpus.corpus.pop(); }, 'CORPUS_SCHEMA_COVERAGE'],
  ['unknown group', x => { x.corpus.corpus[0].schemaId = schemaId('z'); }, 'CORPUS_UNKNOWN_SCHEMA'],
  ['corpus group order', x => { x.corpus.corpus.reverse(); }, 'CORPUS_ORDER'],
  ['group extra field', x => { x.corpus.corpus[0].approve = true; }, 'CORPUS_GROUP_SHAPE'],
  ['empty positive list', x => { x.corpus.corpus[0].valid = []; }, 'CORPUS_CASE_LIMIT'],
  ['empty negative list', x => { x.corpus.corpus[0].invalid = []; }, 'CORPUS_CASE_LIMIT'],
  ['oversized positive list', x => { x.corpus.corpus[0].valid = Array(129).fill({}); }, 'CORPUS_CASE_LIMIT'],
  ['oversized negative list', x => { x.corpus.corpus[0].invalid = Array(129).fill({}); }, 'CORPUS_CASE_LIMIT'],
  ['invalid case shape', x => { x.corpus.corpus[0].invalid[0].allow = true; }, 'CORPUS_INVALID_SHAPE'],
  ['empty invalid id', x => { x.corpus.corpus[0].invalid[0].id = ''; }, 'CORPUS_INVALID_ID'],
  ['non-string invalid id', x => { x.corpus.corpus[0].invalid[0].id = { toString: 'bad' }; }, 'CORPUS_INVALID_ID'],
  ['duplicate invalid id across groups', x => { x.corpus.corpus[1].invalid[0].id = x.corpus.corpus[0].invalid[0].id; }, 'CORPUS_DUPLICATE_INVALID_ID'],
];
for (const [name, mutate, code] of invalids) test(`closure refuses ${name}`, () => {
  const value = small(); mutate(value); const before = JSON.stringify(value);
  assert.throws(() => check(value), { code }); assert.equal(JSON.stringify(value), before);
});

const ajv = new Ajv2020({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false, validateFormats: true });
ajv.addFormat('veritas-canonical-iso-instant', { type: 'string', validate: value => { const d = new Date(value); return Number.isFinite(d.valueOf()) && d.toISOString() === value; } });
for (const group of loadCorpus().corpus) {
  const entry = loadRegistry().schemas.find(entry => entry.id === group.schemaId);
  const schema = JSON.parse(readFileSync(path.resolve(repoRoot, entry.path), 'utf8'));
  const validate = ajv.compile(schema);
  for (const [index, value] of group.valid.entries()) test(`schema-shaped example only: ${group.schemaId} positive ${index + 1}`, () => {
    const before = JSON.stringify(value); assert.equal(validate(value), true, JSON.stringify(validate.errors)); assert.equal(JSON.stringify(value), before);
  });
  for (const fixture of group.invalid) test(`schema refusal: ${fixture.id}`, () => {
    const before = JSON.stringify(fixture.value); assert.equal(validate(fixture.value), false); assert.equal(JSON.stringify(fixture.value), before);
  });
}

test('every *.schema.json file on disk has a schema-registry.json entry', () => {
  const onDisk = readdirSync(schemasDir).filter((f) => f.endsWith('.schema.json')).sort();
  const registry = loadRegistry();
  const registeredFiles = registry.schemas.map((s) => path.basename(s.path)).sort();
  const missing = onDisk.filter((f) => !registeredFiles.includes(f));
  assert.deepEqual(missing, [], `schema files missing from registry: ${missing.join(', ')}`);
});

test('every schema-registry.json entry points at a file that exists and whose $id matches', () => {
  const registry = loadRegistry();
  for (const entry of registry.schemas) {
    const abs = path.resolve(repoRoot, entry.path);
    let schema;
    assert.doesNotThrow(() => {
      schema = JSON.parse(readFileSync(abs, 'utf8'));
    }, `registry path does not exist or is not valid JSON: ${entry.path}`);
    assert.equal(schema.$id, entry.id, `registry id mismatch for ${entry.path}`);
  }
});
