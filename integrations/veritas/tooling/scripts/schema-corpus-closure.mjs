// Repository-owned structural fixtures only. This checks coverage identities,
// not policy completeness, protected custody, runtime behavior or correctness.
const PREFIX = "https://veritas.invalid/private/schemas/stage5/";
const PATH = /^tooling\/schemas\/([a-z0-9]+(?:-[a-z0-9]+)*)\.schema\.json$/u;
const LIMIT = 128;

function refuse(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function exact(value, names, code) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) refuse(code);
  const keys = Object.keys(value).sort(), expected = [...names].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) refuse(code);
}
function orderedUnique(values, duplicateCode, orderCode) {
  if (new Set(values).size !== values.length) refuse(duplicateCode);
  if (values.some((value, index) => index > 0 && values[index - 1] >= value)) refuse(orderCode);
}

export function assertSchemaRegistryClosure(registry, diskPaths) {
  exact(registry, ["schemaVersion", "profile", "statusCeiling", "schemas"], "REGISTRY_SHAPE");
  if (registry.schemaVersion !== 1 || registry.profile !== "veritas-stage5-self-administered-schema-registry-v1" ||
      registry.statusCeiling !== "SELF_ADMINISTERED_STRUCTURAL_PREPARATION") refuse("REGISTRY_HEADER");
  if (!Array.isArray(registry.schemas) || registry.schemas.length < 1 || registry.schemas.length > LIMIT) refuse("REGISTRY_LIMIT");
  const ids = [], paths = [];
  for (const entry of registry.schemas) {
    exact(entry, ["id", "path"], "REGISTRY_ENTRY_SHAPE");
    if (typeof entry.path !== "string" || entry.path.length > 160 || !PATH.test(entry.path)) refuse("REGISTRY_PATH");
    if (typeof entry.id !== "string" || entry.id !== PREFIX + entry.path.match(PATH)[1] + ".v1.json") refuse("REGISTRY_ID_PATH_BINDING");
    ids.push(entry.id); paths.push(entry.path);
  }
  orderedUnique(ids, "REGISTRY_DUPLICATE_ID", "REGISTRY_ORDER");
  orderedUnique(paths, "REGISTRY_DUPLICATE_PATH", "REGISTRY_PATH_ORDER");
  if (!Array.isArray(diskPaths) || diskPaths.length > LIMIT || diskPaths.some(path => typeof path !== "string" || path.length > 160 || !PATH.test(path))) refuse("SCHEMA_DISK_PATHS");
  orderedUnique(diskPaths, "SCHEMA_DISK_DUPLICATE", "SCHEMA_DISK_ORDER");
  if (paths.length !== diskPaths.length || paths.some((path, index) => path !== diskPaths[index])) refuse("REGISTRY_DISK_COVERAGE");
  return Object.freeze({ schemaCount: ids.length });
}

export function assertSchemaCorpusClosure(registry, corpus) {
  // Registry validation must happen before path reads. Repeat shape/identity
  // checks here so independent callers cannot bypass them with a forged table.
  if (!Array.isArray(registry?.schemas)) refuse("REGISTRY_SHAPE");
  assertSchemaRegistryClosure(registry, registry.schemas.map(entry => entry?.path));
  exact(corpus, ["schemaVersion", "corpus"], "CORPUS_SHAPE");
  if (corpus.schemaVersion !== 1) refuse("CORPUS_HEADER");
  if (!Array.isArray(corpus.corpus) || corpus.corpus.length < 1 || corpus.corpus.length > LIMIT) refuse("CORPUS_LIMIT");
  const ids = [], invalidIds = new Set();
  let validCases = 0, invalidCases = 0;
  for (const group of corpus.corpus) {
    exact(group, ["schemaId", "valid", "invalid"], "CORPUS_GROUP_SHAPE");
    if (typeof group.schemaId !== "string" || !registry.schemas.some(entry => entry.id === group.schemaId)) refuse("CORPUS_UNKNOWN_SCHEMA");
    ids.push(group.schemaId);
    if (!Array.isArray(group.valid) || !Array.isArray(group.invalid) ||
        group.valid.length < 1 || group.invalid.length < 1 ||
        group.valid.length > LIMIT || group.invalid.length > LIMIT) refuse("CORPUS_CASE_LIMIT");
    for (const fixture of group.invalid) {
      exact(fixture, ["id", "value"], "CORPUS_INVALID_SHAPE");
      if (typeof fixture.id !== "string" || !/^[A-Z0-9][A-Z0-9_-]{0,127}$/u.test(fixture.id)) refuse("CORPUS_INVALID_ID");
      if (invalidIds.has(fixture.id)) refuse("CORPUS_DUPLICATE_INVALID_ID");
      invalidIds.add(fixture.id);
    }
    validCases += group.valid.length; invalidCases += group.invalid.length;
  }
  orderedUnique(ids, "CORPUS_DUPLICATE_SCHEMA", "CORPUS_ORDER");
  const expected = registry.schemas.map(entry => entry.id);
  if (ids.length !== expected.length || ids.some((id, index) => id !== expected[index])) refuse("CORPUS_SCHEMA_COVERAGE");
  return Object.freeze({ schemaCount: ids.length, validCases, invalidCases, statusCeiling: "SELF_ADMINISTERED_STRUCTURAL_PREPARATION" });
}
