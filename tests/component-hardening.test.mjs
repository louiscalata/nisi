// Regression tests for the file policy and Apple adapter. They target
// input traps, same-size mutation, item-map validation, and digest contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalizeJSONV1 } from '../canonical/canonical-json-v1.mjs';
import { createContentConsent } from '../gate/content-consent.mjs';
import { createAFMContentExecutor, APPLE_CONTENT_PROMPT_VERSION } from '../gate/afm-content-executor.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const directories = [];
const temporary = prefix => { const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))); directories.push(dir); return dir; };
test.afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const tempRoot = () => temporary('nisi-component-');

function grantBytes(scopeRoot, overrides = {}) {
  const value = {
    kind: 'nisi-content-consent-v1', schemaVersion: 1, generation: 1,
    grantId: 'candidate.grant', consentClass: 'WRITTEN_DECLARATION', scopeRoot,
    allowedKinds: ['json', 'text'], maxContentBytes: 4096, maxAdvisoryChars: 256,
    lifetimeMs: 60000, destination: 'ON_DEVICE_APPLE_FOUNDATION_MODELS_ONLY',
    networkEgress: false, contentPersisted: false, transcriptPersisted: false, ...overrides,
  };
  return Buffer.from(canonicalizeJSONV1(Buffer.from(JSON.stringify(value), 'utf8')).canonical, 'utf8');
}

function consent(scopeRoot, overrides) {
  const made = createContentConsent(grantBytes(scopeRoot, overrides), { clock: () => Date.now() });
  assert.equal(made.ok, true, made.code);
  return made;
}

function write(root, name, content) {
  const file = path.join(root, name);
  fs.writeFileSync(file, content);
  return file;
}

function stubProbe() {
  const dir = temporary('nisi-component-stub-');
  const file = path.join(dir, 'stub');
  const body = `#!${process.execPath}
const fs = require('fs'), crypto = require('crypto');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const all = fs.readFileSync(0); const nl = all.indexOf(10);
const header = JSON.parse(all.subarray(0, nl).toString('utf8'));
const content = all.subarray(nl + 1); const text = content.toString('utf8');
const prompt = Buffer.from('File kind: ' + header.kind + '\\n\\n' + text, 'utf8');
const advisory = 'bounded deterministic advisory';
const evidence = {
  schemaVersion: 1, status: 'PASS', evidenceClass: 'CONSENTED_CONTENT_ADVISORY_READING',
  consentDigest: header.consentDigest, contentSha256: sha(content), contentBytes: content.length,
  kind: header.kind, promptSha256: sha(prompt), advisory, advisoryChars: advisory.length,
  advisorySha256: sha(Buffer.from(advisory, 'utf8')), modelParticipation: 'PARTICIPATED',
  modelIdentityStatus: 'MODEL_ID_NOT_EXPOSED_BY_API', route: 'system-on-device-requested',
  quiescent: true, contentPersisted: false, transcriptPersisted: false, networkEgress: false,
  externalToolsEnabled: false, acceptanceAuthorityGranted: false,
  limitationCodes: ['ADVISORY_READING_NON_AUTHORIZING', 'NO_ACCEPTANCE_OR_CERTIFICATION']
};
process.stdout.write(JSON.stringify(evidence));
`;
  fs.writeFileSync(file, body, { mode: 0o755 });
  return { file, sha: sha(fs.readFileSync(file)) };
}

function build(root, file, taskId = 'task') {
  const { grant } = consent(root);
  const probe = stubProbe();
  const made = createAFMContentExecutor({
    binary: probe.file, binarySHA256: probe.sha, grant,
    items: { [taskId]: { filePath: file, kind: 'text' } }, timeoutMs: 10000,
  });
  assert.equal(made.ok, true, made.code);
  return { made, grant, probe };
}

test('content item traps and symbol extras are CONTENT_ITEM_INVALID before reads or admission count', () => {
  const root = tempRoot();
  const file = write(root, 'safe.txt', 'safe');
  for (const item of [
    new Proxy({ filePath: file, kind: 'text' }, { ownKeys() { throw new Error('trap'); } }),
    { get filePath() { throw new Error('trap'); }, kind: 'text' },
    { filePath: file, get kind() { throw new Error('trap'); } },
    { filePath: file, kind: 'text', [Symbol('unexpected')]: true },
  ]) {
    const { grant } = consent(root);
    const result = grant.admitContent(item);
    assert.equal(result.ok, false, String(result.code));
    assert.equal(result.code, 'CONTENT_ITEM_INVALID');
    assert.equal(grant.status().admittedItems, 0);
  }
});

test('same-size in-place mutation between read and final identity check is CONTENT_CHANGED_DURING_READ', () => {
  const root = tempRoot();
  const file = write(root, 'safe.txt', '0123456789');
  const { grant } = consent(root);
  const originalReadSync = fs.readSync;
  let mutated = false;
  fs.readSync = (...args) => {
    const count = originalReadSync(...args);
    if (!mutated) {
      mutated = true;
      const writer = fs.openSync(file, fs.constants.O_WRONLY);
      try { fs.writeSync(writer, Buffer.from('abcdefghij'), 0, 10, 0); } finally { fs.closeSync(writer); }
    }
    return count;
  };
  try {
    const result = grant.admitContent({ filePath: file, kind: 'text' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CONTENT_CHANGED_DURING_READ');
    assert.equal(grant.status().admittedItems, 0);
  } finally {
    fs.readSync = originalReadSync;
  }
});

test('executor rejects malformed item maps and snapshots valid mappings at construction', async () => {
  const root = tempRoot();
  const file = write(root, 'safe.txt', 'safe');
  const { grant } = consent(root);
  const malformedItems = [
    null, [], {}, {task: null}, {task: []}, {task: {filePath: file}},
    {task: {filePath: 1, kind: 'text'}}, {task: {filePath: file, kind: 1}},
    {task: {filePath: file, kind: 'text', extra: true}},
    {task: {get filePath() {throw new Error('trap');}, kind: 'text'}},
    {task: {filePath: file, get kind() {throw new Error('trap');}}},
    { task: { filePath: file, kind: 'text', [Symbol('unexpected')]: true } },
    new Proxy({ task: { filePath: file, kind: 'text' } }, { ownKeys() { throw new Error('trap'); } }),
  ];
  for (const items of malformedItems) {
    const probe = stubProbe();
    const result = createAFMContentExecutor({ binary: probe.file, binarySHA256: probe.sha, grant, items });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ITEMS_REFUSED');
  }

  const probe = stubProbe();
  const items = { task: { filePath: file, kind: 'text' } };
  const made = createAFMContentExecutor({ binary: probe.file, binarySHA256: probe.sha, grant, items });
  assert.equal(made.ok, true, made.code);
  items.task.filePath = path.join(root, 'missing.txt');
  delete items.task;
  const out = await made.execute(Buffer.from('request'), { taskId: 'task' });
  assert.equal(out.ok, true, out.code);
  assert.equal(made.readings()[0].contentSha256, sha(Buffer.from('safe')));
});

test('legacy payload digest remains exact while execution digest binds task identity', async () => {
  const root = tempRoot();
  const file = write(root, 'safe.txt', 'safe');
  const { made, grant, probe } = build(root, file, 'task.one');
  const packet = Buffer.from('request-bytes');
  const out = await made.execute(packet, { taskId: 'task.one' });
  assert.equal(out.ok, true, out.code);
  const reading = made.readings()[0];
  for (const value of [made.readings(), reading, reading.evidence, reading.evidence.limitationCodes]) assert.ok(Object.isFrozen(value));
  assert.throws(() => { reading.evidence.limitationCodes.push('extra'); }, TypeError);
  assert.equal(made.readings()[0].evidence.limitationCodes.length, 2);
  const expectedLegacyPayload = sha(Buffer.from(
    `nisi/content-observation/v1\0${sha(packet)}\0${reading.evidence.consentDigest}\0` +
    `${reading.evidence.contentSha256}\0${reading.evidence.advisorySha256}`, 'utf8'));
  assert.equal(out.payloadSha256, expectedLegacyPayload);

  const evidenceDigest = canonicalizeJSONV1(Buffer.from(JSON.stringify(reading.evidence), 'utf8')).sha256;
  const expectedExecution = sha(Buffer.from(
    `nisi/content-execution/v1\0${APPLE_CONTENT_PROMPT_VERSION}\0${sha('task.one')}\0` +
    `${probe.sha}\0${sha(packet)}\0${evidenceDigest}`, 'utf8'));
  assert.equal(reading.executionSha256, expectedExecution);
  assert.equal(reading.promptVersion, APPLE_CONTENT_PROMPT_VERSION);

  const second = createAFMContentExecutor({
    binary: probe.file, binarySHA256: probe.sha, grant,
    items: { 'task.one': { filePath: file, kind: 'text' }, 'task.two': { filePath: file, kind: 'text' } }, timeoutMs: 10000,
  });
  assert.equal((await second.execute(packet, { taskId: 'task.one' })).ok, true);
  assert.equal((await second.execute(packet, { taskId: 'task.two' })).ok, true);
  assert.notEqual(second.readings()[0].executionSha256, second.readings()[1].executionSha256);
});
