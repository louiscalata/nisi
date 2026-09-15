import { createHash } from 'node:crypto';

const SCHEMA = 'nisi-experimental-module-registry-v1';
const MANIFEST_SCHEMA = 'nisi-experimental-module-manifest-v1';
const STATES = Object.freeze({ INERT: 'REGISTERED_INERT', ACTIVE: 'DECLARED_ACTIVE', DISABLED: 'DISABLED' });
const MANIFEST_KEYS = Object.freeze(['schemaVersion', 'moduleId', 'versionId', 'interfaceId', 'capabilityKind', 'travelerRole', 'dataType', 'sourcePath', 'sourceSha256', 'resources']);
const RESOURCE_KEYS = Object.freeze(['residentBytes', 'operations', 'maxInferenceMs', 'maxOutputBytes']);
const REQUEST_KEYS = Object.freeze(['moduleId', 'versionId', 'sourceSha256', 'hostContractId', 'resources', 'consent']);
const IDENTITY_KEYS = Object.freeze(['moduleId', 'versionId', 'interfaceId', 'capabilityKind', 'travelerRole', 'dataType', 'sourcePath', 'sourceSha256']);

// These interface names and vocabularies are retained contract identifiers. This
// map declares metadata compatibility only; it is not an import or execution map.
export const SUPPORTED_EXPERIMENTAL_INTERFACES_V1 = deepFreeze({
  'veritas-bn01-offline-contract-v1': {
    capabilityKinds: ['BN01_PLUGIN_METADATA'],
    travelerRoles: ['PROTON', 'ELECTRON', 'NEUTRON'],
    dataTypes: ['F32'],
    sourcePath: 'integrations/veritas/tooling/neural/bn01.mjs',
    sourceSha256: '3c7b355e67a39c0f0f33a61329208fbfb4627bc1fef0c973d52a7e654957ee19'
  },
  'veritas-bn01-dual-face-v1': {
    capabilityKinds: ['DUAL_FACE_TOPOLOGY_METADATA'],
    travelerRoles: ['PROTON', 'ELECTRON', 'NEUTRON'],
    dataTypes: ['F32'],
    sourcePath: 'integrations/veritas/tooling/neural/dual-face.mjs',
    sourceSha256: '41e7363478ff1c8e5108c29967f7b638393b03418364f026c6a396ff3c197fba'
  },
  'veritas-typed-contribution-contributor-v1': {
    capabilityKinds: ['TYPED_CONTRIBUTION_METADATA'],
    travelerRoles: ['PROTON', 'ELECTRON', 'NEUTRON'],
    dataTypes: ['F32', 'F64', 'I64', 'BOOL', 'BYTES', 'STRING'],
    sourcePath: 'integrations/veritas/tooling/neural/typed-contribution-combiner.mjs',
    sourceSha256: '16d7fc151d31cc23b37eafa0626d4c6fc1dd5ded276cce8ae2def2f946253946'
  },
  'veritas-contribution-round-v1': {
    capabilityKinds: ['DEFAULT_CONTRIBUTION_ROUND_METADATA'],
    travelerRoles: ['PROTON', 'ELECTRON', 'NEUTRON'],
    dataTypes: ['F32', 'F64', 'I64', 'BOOL', 'BYTES', 'STRING'],
    sourcePath: 'integrations/veritas/tooling/neural/default-contribution-round.mjs',
    sourceSha256: '3fc26af9a3f5b83f341fb2d33f43e9cf7c9ddd83c06b7217377fc1c1d2cbd716'
  }
});

export function createExperimentalModuleRegistryV1(configuration) {
  const config = cloneRecord(configuration, ['schemaVersion', 'hostContractId', 'budget']);
  requireValue(config.schemaVersion === SCHEMA, 'INVALID_REGISTRY_SCHEMA');
  requireIdentifier(config.hostContractId, 'INVALID_HOST_CONTRACT');
  const hostBudget = readResources(config.budget, 'INVALID_HOST_BUDGET');
  const records = new Map();
  let sequence = 0;

  function reject(code) {
    return deepFreeze({ ok: false, code, authorizing: false, installed: false, loaded: false, running: false });
  }

  function register(input) {
    let manifest;
    try { manifest = readManifest(input); } catch (error) { return reject(error.message); }
    const key = `${manifest.moduleId}\0${manifest.versionId}`;
    if (records.has(key)) return reject('DUPLICATE_MODULE_VERSION');
    for (const record of records.values()) {
      if (record.manifest.moduleId === manifest.moduleId) return reject('CONFLICTING_MODULE_IDENTITY');
    }
    if (!within(manifest.resources, hostBudget)) return reject('MODULE_BUDGET_EXCEEDS_HOST');
    const record = { manifest, state: STATES.INERT, history: [] };
    append(record, STATES.INERT);
    records.set(key, record);
    return answer(record);
  }

  function requestActivation(input) {
    let request;
    try { request = readRequest(input); } catch (error) { return reject(error.message); }
    const record = records.get(`${request.moduleId}\0${request.versionId}`);
    if (!record) return reject('MODULE_NOT_REGISTERED');
    if (request.sourceSha256 !== record.manifest.sourceSha256) return reject('IDENTITY_REWRITE_REFUSED');
    if (request.hostContractId !== config.hostContractId) return reject('HOST_CONTRACT_NOT_ALLOWLISTED');
    if (request.consent !== 'DECLARE_ACTIVE_ONLY') return reject('EXPLICIT_DECLARATION_CONSENT_REQUIRED');
    if (!equalResources(request.resources, record.manifest.resources) || !within(request.resources, hostBudget)) return reject('BUDGET_WIDENING_REFUSED');
    if (record.state === STATES.ACTIVE) return reject('DUPLICATE_STATE_TRANSITION');
    record.state = STATES.ACTIVE;
    append(record, STATES.ACTIVE);
    return answer(record);
  }

  function disable(input) {
    let request;
    try {
      request = cloneRecord(input, ['moduleId', 'versionId', 'sourceSha256']);
      requireIdentifier(request.moduleId, 'INVALID_MODULE_ID');
      requireIdentifier(request.versionId, 'INVALID_VERSION_ID');
    } catch (error) { return reject(error.message); }
    const record = records.get(`${request.moduleId}\0${request.versionId}`);
    if (!record) return reject('MODULE_NOT_REGISTERED');
    if (request.sourceSha256 !== record.manifest.sourceSha256) return reject('IDENTITY_REWRITE_REFUSED');
    if (record.state === STATES.DISABLED) return reject('DUPLICATE_STATE_TRANSITION');
    record.state = STATES.DISABLED;
    append(record, STATES.DISABLED);
    return answer(record);
  }

  function inspect(input) {
    let request;
    try {
      request = cloneRecord(input, ['moduleId', 'versionId']);
      requireIdentifier(request.moduleId, 'INVALID_MODULE_ID');
      requireIdentifier(request.versionId, 'INVALID_VERSION_ID');
    } catch (error) { return reject(error.message); }
    const record = records.get(`${request.moduleId}\0${request.versionId}`);
    return record ? answer(record) : reject('MODULE_NOT_REGISTERED');
  }

  function append(record, state) {
    sequence += 1;
    record.history.push(deepFreeze({ sequence, state, identitySha256: identityHash(record.manifest) }));
  }

  return deepFreeze({ schemaVersion: SCHEMA, register, requestActivation, disable, inspect });
}

function readManifest(input) {
  const manifest = cloneRecord(input, MANIFEST_KEYS);
  requireValue(manifest.schemaVersion === MANIFEST_SCHEMA, 'INVALID_MANIFEST_SCHEMA');
  for (const key of ['moduleId', 'versionId', 'interfaceId', 'capabilityKind', 'travelerRole', 'dataType']) requireIdentifier(manifest[key], `INVALID_${key.toUpperCase()}`);
  requireValue(typeof manifest.sourcePath === 'string' && !manifest.sourcePath.includes('://') && !manifest.sourcePath.includes('..'), 'INVALID_SOURCE_PATH');
  requireValue(/^[a-f0-9]{64}$/.test(manifest.sourceSha256), 'INVALID_SOURCE_HASH');
  const supported = SUPPORTED_EXPERIMENTAL_INTERFACES_V1[manifest.interfaceId];
  requireValue(Boolean(supported), 'UNSUPPORTED_INTERFACE');
  requireValue(supported.capabilityKinds.includes(manifest.capabilityKind), 'INVENTED_CAPABILITY_REFUSED');
  requireValue(supported.travelerRoles.includes(manifest.travelerRole), 'UNSUPPORTED_TRAVELER_ROLE');
  requireValue(supported.dataTypes.includes(manifest.dataType), 'UNSUPPORTED_DATA_TYPE');
  requireValue(manifest.sourcePath === supported.sourcePath && manifest.sourceSha256 === supported.sourceSha256, 'RETAINED_SOURCE_IDENTITY_MISMATCH');
  manifest.resources = readResources(manifest.resources, 'INVALID_MODULE_BUDGET');
  return deepFreeze(manifest);
}

function readRequest(input) {
  const request = cloneRecord(input, REQUEST_KEYS);
  requireIdentifier(request.moduleId, 'INVALID_MODULE_ID');
  requireIdentifier(request.versionId, 'INVALID_VERSION_ID');
  requireValue(/^[a-f0-9]{64}$/.test(request.sourceSha256), 'INVALID_SOURCE_HASH');
  requireIdentifier(request.hostContractId, 'INVALID_HOST_CONTRACT');
  request.resources = readResources(request.resources, 'INVALID_ACTIVATION_BUDGET');
  requireValue(typeof request.consent === 'string', 'INVALID_CONSENT');
  return deepFreeze(request);
}

function readResources(input, code) {
  const value = cloneRecord(input, RESOURCE_KEYS);
  for (const key of RESOURCE_KEYS) requireValue(Number.isSafeInteger(value[key]) && value[key] >= 0, code);
  return deepFreeze(value);
}

function cloneRecord(input, keys) {
  requireValue(input !== null && typeof input === 'object' && !Array.isArray(input) && Object.getPrototypeOf(input) === Object.prototype, 'NON_PLAIN_RECORD');
  requireValue(Reflect.ownKeys(input).length === keys.length && keys.every((key) => Object.hasOwn(input, key)), 'UNEXPECTED_FIELDS');
  const output = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    requireValue(descriptor && Object.hasOwn(descriptor, 'value'), 'ACCESSOR_REFUSED');
    output[key] = descriptor.value;
  }
  return output;
}

function answer(record) {
  return deepFreeze({
    ok: true,
    code: record.state,
    state: record.state,
    manifest: { ...record.manifest, resources: { ...record.manifest.resources } },
    history: record.history.map((event) => ({ ...event })),
    authorizing: false,
    installed: false,
    loaded: false,
    running: false
  });
}

function identityHash(manifest) {
  return createHash('sha256').update(JSON.stringify(IDENTITY_KEYS.map((key) => manifest[key]))).digest('hex');
}

function within(candidate, ceiling) { return RESOURCE_KEYS.every((key) => candidate[key] <= ceiling[key]); }
function equalResources(left, right) { return RESOURCE_KEYS.every((key) => left[key] === right[key]); }
function requireIdentifier(value, code) { requireValue(typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value), code); }
function requireValue(condition, code) { if (!condition) throw new Error(code); }
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
