// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

// Contract tests for the consented-content executor. No model runs here: every
// case uses a stand-in binary that produces the probe's evidence shape, so the
// suite is hermetic and runs on any platform. The real probe under probes/ needs
// macOS 26 and is exercised by hand.
//
// What these tests are really defending is the order of operations: the consent
// grant decides, and only then does anything spawn. A packet the grant refuses
// must never reach a process at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalizeJSONV1 } from '../canonical/canonical-json-v1.mjs';
import { createContentConsent } from '../neural/content-consent.mjs';
import { createAFMContentExecutor } from '../neural/afm-content-executor.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const packet = Buffer.from('{"kind":"nisi-request-v1"}', 'utf8');

function tempRoot() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'afm-content-')));
}

function grantBytes(scopeRoot, overrides = {}) {
  const value = {
    kind: 'nisi-content-consent-v1', schemaVersion: 1, generation: 1,
    grantId: 'test.grant', consentClass: 'WRITTEN_DECLARATION',
    scopeRoot, allowedKinds: ['json', 'text'], maxContentBytes: 4096,
    maxAdvisoryChars: 256, lifetimeMs: 60000,
    destination: 'ON_DEVICE_APPLE_FOUNDATION_MODELS_ONLY',
    networkEgress: false, contentPersisted: false, transcriptPersisted: false,
    ...overrides,
  };
  return Buffer.from(canonicalizeJSONV1(Buffer.from(JSON.stringify(value), 'utf8')).canonical, 'utf8');
}

function consent(scopeRoot, overrides) {
  const made = createContentConsent(grantBytes(scopeRoot, overrides), { clock: () => Date.now() });
  assert.equal(made.ok, true, made.code);
  return made;
}

/** A stand-in for the probe: same framing, same evidence shape. `mutate` is a
 *  JavaScript expression applied to the evidence object before it is emitted,
 *  which is how the negative cases forge dishonest evidence. */
function stubProbe(mutate = '', { marker = null, extra = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afm-stub-'));
  const file = path.join(dir, 'stub');
  const body = `#!${process.execPath}
const fs = require('fs'), crypto = require('crypto');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const all = fs.readFileSync(0);
const nl = all.indexOf(10);
const header = JSON.parse(all.subarray(0, nl).toString('utf8'));
const content = all.subarray(nl + 1);
${marker ? `fs.writeFileSync(${JSON.stringify(marker)}, 'spawned');` : ''}
${extra}
let advisory = 'A bounded advisory reading of ' + header.kind + ' content.';
const evidence = {
  schemaVersion: 1, status: 'PASS', evidenceClass: 'CONSENTED_CONTENT_ADVISORY_READING',
  consentDigest: header.consentDigest, contentSha256: sha(content),
  contentBytes: content.length, kind: header.kind,
  promptSha256: sha(Buffer.from('prompt', 'utf8')),
  advisory, advisoryChars: advisory.length,
  advisorySha256: sha(Buffer.from(advisory, 'utf8')),
  modelParticipation: 'PARTICIPATED', modelIdentityStatus: 'MODEL_ID_NOT_EXPOSED_BY_API',
  route: 'system-on-device-requested', quiescent: true,
  contentPersisted: false, transcriptPersisted: false, networkEgress: false,
  externalToolsEnabled: false, acceptanceAuthorityGranted: false,
  limitationCodes: ['ADVISORY_READING_NON_AUTHORIZING'],
};
${mutate}
process.stdout.write(JSON.stringify(evidence));
`;
  fs.writeFileSync(file, body, { mode: 0o755 });
  return { file, sha: sha(fs.readFileSync(file)), dir };
}

function shellProbe(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afm-stub-'));
  const file = path.join(dir, 'stub');
  fs.writeFileSync(file, `#!/bin/sh\ncat >/dev/null\n${script}\n`, { mode: 0o755 });
  return { file, sha: sha(fs.readFileSync(file)), dir };
}

function write(root, name, text) {
  const file = path.join(root, name);
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

function build(stub, grant, items, timeoutMs = 10000) {
  return createAFMContentExecutor({ binary: stub.file, binarySHA256: stub.sha, grant, items, timeoutMs });
}

test('construction refuses anything outside the closed option set', () => {
  const root = tempRoot();
  const { grant } = consent(root);
  const stub = stubProbe();
  const items = { 't.1': { filePath: write(root, 'a.json', '{}'), kind: 'json' } };
  assert.equal(createAFMContentExecutor('nope').code, 'CONFIGURATION_REFUSED');
  assert.equal(createAFMContentExecutor({ binary: stub.file, binarySHA256: stub.sha, grant, items, model: 'x' }).code,
    'CONFIGURATION_REFUSED');
  assert.equal(createAFMContentExecutor({ binary: 'relative', binarySHA256: stub.sha, grant, items }).code,
    'BINARY_ARGUMENTS');
  assert.equal(createAFMContentExecutor({ binary: stub.file, binarySHA256: 'nothex', grant, items }).code,
    'BINARY_ARGUMENTS');
  assert.equal(createAFMContentExecutor({ binary: stub.file, binarySHA256: stub.sha, grant, items, timeoutMs: 5 }).code,
    'DEADLINE_ARGUMENT');
  assert.equal(createAFMContentExecutor({ binary: stub.file, binarySHA256: 'a'.repeat(64), grant, items }).code,
    'BINARY_DIGEST_MISMATCH');
});

test('no grant is refusal, not a permissive default', () => {
  const root = tempRoot();
  const stub = stubProbe();
  const items = { 't.1': { filePath: write(root, 'a.json', '{}'), kind: 'json' } };
  assert.equal(createAFMContentExecutor({ binary: stub.file, binarySHA256: stub.sha, items }).code, 'CONSENT_REQUIRED');
  assert.equal(createAFMContentExecutor({ binary: stub.file, binarySHA256: stub.sha, grant: {}, items }).code,
    'CONSENT_REQUIRED');
  const { grant } = consent(root);
  assert.equal(createAFMContentExecutor({ binary: stub.file, binarySHA256: stub.sha, grant, items: {} }).code,
    'ITEMS_REFUSED');
});

test('a consented item is read and answered, and only digests come back', async () => {
  const root = tempRoot();
  const { grant, consentDigest } = consent(root);
  const stub = stubProbe();
  const file = write(root, 'a.json', '{"hello":"world"}');
  const made = build(stub, grant, { 't.1': { filePath: file, kind: 'json' } });
  assert.equal(made.ok, true);
  assert.equal(made.code, 'READY_PRIVATE_AFM_CONTENT_EXECUTOR_ONLY');

  const out = await made.execute(packet, { taskId: 't.1' });
  assert.equal(out.ok, true);
  assert.equal(out.code, 'AFM_PACKET_ANSWERED');
  // The answer is exactly three fields, and no more; content must not ride back
  // inside it.
  assert.deepEqual(Object.keys(out).sort(), ['code', 'ok', 'payloadSha256']);
  assert.match(out.payloadSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(made.refusals(), []);

  const [reading] = made.readings();
  assert.equal(reading.taskId, 't.1');
  assert.equal(reading.contentSha256, sha(fs.readFileSync(file)));
  assert.equal(reading.advisoryChars, reading.advisory.length);
  assert.equal(grant.status().admittedItems, 1);
  assert.equal(grant.status().consentDigest, consentDigest);
});

test('the same content under the same grant answers with the same digest', async () => {
  const root = tempRoot();
  const { grant } = consent(root);
  const stub = stubProbe();
  const items = {
    't.1': { filePath: write(root, 'a.json', '{"same":1}'), kind: 'json' },
    't.2': { filePath: write(root, 'b.json', '{"same":1}'), kind: 'json' },
    't.3': { filePath: write(root, 'c.json', '{"other":2}'), kind: 'json' },
  };
  const made = build(stub, grant, items);
  const a = await made.execute(packet, { taskId: 't.1' });
  const b = await made.execute(packet, { taskId: 't.2' });
  const c = await made.execute(packet, { taskId: 't.3' });
  assert.equal(a.payloadSha256, b.payloadSha256);
  assert.notEqual(a.payloadSha256, c.payloadSha256);
});

test('a request with no declared content never reaches a process', async () => {
  const root = tempRoot();
  const marker = path.join(root, 'spawned.marker');
  const { grant } = consent(root);
  const stub = stubProbe('', { marker });
  const made = build(stub, grant, { 't.1': { filePath: write(root, 'a.json', '{}'), kind: 'json' } });
  const out = await made.execute(packet, { taskId: 't.unknown' });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'AFM_PACKET_UNAVAILABLE');
  assert.deepEqual(made.refusals(), [{ taskId: 't.unknown', cause: 'NO_CONTENT_FOR_REQUEST' }]);
  assert.equal(fs.existsSync(marker), false);
});

test('content the grant refuses never reaches a process', async () => {
  const root = tempRoot();
  const outside = tempRoot();
  const marker = path.join(root, 'spawned.marker');
  const { grant } = consent(root);
  const stub = stubProbe('', { marker });
  const link = path.join(root, 'escape.json');
  fs.symlinkSync(write(outside, 'secret.json', '{"secret":true}'), link);
  const made = build(stub, grant, {
    'out.of.scope': { filePath: path.join(outside, 'secret.json'), kind: 'json' },
    'symlink.escape': { filePath: link, kind: 'json' },
    'wrong.kind': { filePath: write(root, 'a.md', '# hi'), kind: 'markdown' },
    'too.big': { filePath: write(root, 'big.json', 'x'.repeat(5000)), kind: 'json' },
    'missing': { filePath: path.join(root, 'nothing.json'), kind: 'json' },
  });
  for (const taskId of ['out.of.scope', 'symlink.escape', 'wrong.kind', 'too.big', 'missing']) {
    const out = await made.execute(packet, { taskId });
    assert.equal(out.ok, false, taskId);
  }
  assert.deepEqual(made.refusals().map(r => `${r.taskId}=${r.cause}`), [
    'out.of.scope=CONSENT_CONTENT_OUT_OF_SCOPE',
    'symlink.escape=CONSENT_CONTENT_OUT_OF_SCOPE',
    'wrong.kind=CONSENT_CONTENT_KIND_REFUSED',
    'too.big=CONSENT_CONTENT_BYTE_LIMIT',
    'missing=CONSENT_CONTENT_PATH_UNRESOLVABLE',
  ]);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(grant.status().admittedItems, 0);
});

test('revocation stops the executor immediately and terminally', async () => {
  const root = tempRoot();
  const marker = path.join(root, 'spawned.marker');
  const { grant } = consent(root);
  const stub = stubProbe('', { marker });
  const made = build(stub, grant, { 't.1': { filePath: write(root, 'a.json', '{}'), kind: 'json' } });
  assert.equal((await made.execute(packet, { taskId: 't.1' })).ok, true);
  assert.equal(fs.existsSync(marker), true);
  fs.rmSync(marker);

  grant.revoke();
  const out = await made.execute(packet, { taskId: 't.1' });
  assert.equal(out.ok, false);
  assert.equal(made.refusals().at(-1).cause, 'CONSENT_CONSENT_REVOKED');
  assert.equal(fs.existsSync(marker), false);
});

test('evidence that claims authority is refused rather than interpreted', async () => {
  const root = tempRoot();
  const file = write(root, 'a.json', '{"a":1}');
  const cases = [
    ['evidence.acceptanceAuthorityGranted = true;', 'BOUNDARY_VIOLATED'],
    ['evidence.networkEgress = true;', 'BOUNDARY_VIOLATED'],
    ['evidence.contentPersisted = true;', 'BOUNDARY_VIOLATED'],
    ['evidence.transcriptPersisted = true;', 'BOUNDARY_VIOLATED'],
    ['evidence.externalToolsEnabled = true;', 'BOUNDARY_VIOLATED'],
    ['evidence.route = "private-cloud-compute";', 'ROUTE_REFUSED'],
    ['evidence.modelParticipation = "SKIPPED";', 'MODEL_DID_NOT_PARTICIPATE'],
    ['evidence.quiescent = false;', 'MODEL_NOT_QUIESCENT'],
    ['evidence.evidenceClass = "CERTIFICATION";', 'EVIDENCE_CLASS'],
    ['evidence.status = "FAIL";', 'EVIDENCE_STATUS'],
    ['evidence.limitationCodes = [];', 'EVIDENCE_LIMITATIONS'],
    ['delete evidence.route;', 'EVIDENCE_SCHEMA'],
    ['evidence.extra = 1;', 'EVIDENCE_SCHEMA'],
  ];
  for (const [mutate, cause] of cases) {
    const { grant } = consent(root);
    const stub = stubProbe(mutate);
    const made = build(stub, grant, { 't.1': { filePath: file, kind: 'json' } });
    const out = await made.execute(packet, { taskId: 't.1' });
    assert.equal(out.ok, false, mutate);
    assert.equal(made.refusals()[0].cause, cause, mutate);
    assert.deepEqual(made.readings(), [], mutate);
  }
});

test('evidence about different content, or a different grant, is refused', async () => {
  const root = tempRoot();
  const file = write(root, 'a.json', '{"a":1}');
  const cases = [
    ['evidence.contentSha256 = sha(Buffer.from("other","utf8"));', 'CONTENT_DIGEST_MISMATCH'],
    ['evidence.consentDigest = "b".repeat(64);', 'CONSENT_DIGEST_MISMATCH'],
    ['evidence.contentBytes = content.length + 1;', 'CONTENT_BYTES_MISMATCH'],
    ['evidence.kind = "text";', 'CONTENT_KIND_MISMATCH'],
  ];
  for (const [mutate, cause] of cases) {
    const { grant } = consent(root);
    const stub = stubProbe(mutate);
    const made = build(stub, grant, { 't.1': { filePath: file, kind: 'json' } });
    assert.equal((await made.execute(packet, { taskId: 't.1' })).ok, false, mutate);
    assert.equal(made.refusals()[0].cause, cause, mutate);
  }
});

test('an advisory over the granted cap, or one that does not match its digest, is refused', async () => {
  const root = tempRoot();
  const file = write(root, 'a.json', '{"a":1}');
  const cases = [
    ['evidence.advisory = "y".repeat(300); evidence.advisoryChars = 300; evidence.advisorySha256 = sha(Buffer.from(evidence.advisory,"utf8"));',
      'ADVISORY_OVER_CAP'],
    ['evidence.advisory = "tampered";', 'EVIDENCE_ADVISORY'],
    ['evidence.advisorySha256 = "c".repeat(64);', 'ADVISORY_DIGEST'],
    ['evidence.advisoryChars = 3;', 'EVIDENCE_ADVISORY'],
  ];
  for (const [mutate, cause] of cases) {
    const { grant } = consent(root);
    const stub = stubProbe(mutate);
    const made = build(stub, grant, { 't.1': { filePath: file, kind: 'json' } });
    assert.equal((await made.execute(packet, { taskId: 't.1' })).ok, false, mutate);
    assert.equal(made.refusals()[0].cause, cause, mutate);
  }
});

test('the binary is re-verified before every launch', async () => {
  const root = tempRoot();
  const { grant } = consent(root);
  const stub = stubProbe();
  const made = build(stub, grant, { 't.1': { filePath: write(root, 'a.json', '{}'), kind: 'json' } });
  assert.equal((await made.execute(packet, { taskId: 't.1' })).ok, true);
  fs.appendFileSync(stub.file, '\n// swapped after review\n');
  const out = await made.execute(packet, { taskId: 't.1' });
  assert.equal(out.ok, false);
  assert.equal(made.refusals().at(-1).cause, 'BINARY_DIGEST_MISMATCH');
});

test('child failures are refused with their own causes, never as evidence', async () => {
  const root = tempRoot();
  const file = write(root, 'a.json', '{}');
  const cases = [
    [shellProbe('exit 3'), 10000, 'CHILD_EXIT_NONZERO'],
    [shellProbe('echo not-json'), 10000, 'EVIDENCE_REFUSED'],
    [shellProbe('exec sleep 30'), 150, 'DEADLINE_EXCEEDED'],
    [shellProbe('yes 0123456789abcdef | head -c 40000'), 10000, 'EVIDENCE_OVERFLOW'],
  ];
  for (const [stub, timeoutMs, cause] of cases) {
    const { grant } = consent(root);
    const made = build(stub, grant, { 't.1': { filePath: file, kind: 'json' } }, timeoutMs);
    assert.equal((await made.execute(packet, { taskId: 't.1' })).ok, false, cause);
    assert.equal(made.refusals()[0].cause, cause);
  }
});

test('an aborted run is refused and leaves no reading behind', async () => {
  const root = tempRoot();
  const { grant } = consent(root);
  const stub = shellProbe('exec sleep 30');
  const made = build(stub, grant, { 't.1': { filePath: write(root, 'a.json', '{}'), kind: 'json' } });
  const controller = new AbortController();
  const running = made.execute(packet, { taskId: 't.1', signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  const out = await running;
  assert.equal(out.ok, false);
  assert.equal(made.refusals()[0].cause, 'ABORTED');
  assert.deepEqual(made.readings(), []);
});

test('a request that is not bytes is refused before the grant is consulted', async () => {
  const root = tempRoot();
  const { grant } = consent(root);
  const stub = stubProbe();
  const made = build(stub, grant, { 't.1': { filePath: write(root, 'a.json', '{}'), kind: 'json' } });
  assert.equal((await made.execute('not bytes', { taskId: 't.1' })).ok, false);
  assert.equal((await made.execute(Buffer.alloc(0), { taskId: 't.1' })).ok, false);
  assert.deepEqual(made.refusals().map(r => r.cause), ['REQUEST_BYTES', 'REQUEST_BYTES']);
  assert.equal(grant.status().admittedItems, 0);
});

test('every field of the evidence reader is load-bearing, not decorative', async () => {
  const root = tempRoot();
  const file = write(root, 'a.json', '{"a":1}');
  // Each mutation removes exactly one check's reason to exist. If any of these
  // passed, the corresponding line in readEvidence could be deleted unnoticed.
  const cases = [
    ['evidence.modelIdentityStatus = "MODEL_ID_KNOWN";', 'MODEL_IDENTITY'],
    ['evidence.schemaVersion = 2;', 'EVIDENCE_STATUS'],
    ['evidence.promptSha256 = "not-a-digest";', 'EVIDENCE_DIGESTS'],
  ];
  for (const [mutate, cause] of cases) {
    const { grant } = consent(root);
    const made = build(stubProbe(mutate), grant, { 't.1': { filePath: file, kind: 'json' } });
    assert.equal((await made.execute(packet, { taskId: 't.1' })).ok, false, mutate);
    assert.equal(made.refusals()[0].cause, cause, mutate);
  }
});

test('the answer digest binds the request bytes, not only the content', async () => {
  const root = tempRoot();
  const { grant } = consent(root);
  const made = build(stubProbe(), grant, { 't.1': { filePath: write(root, 'a.json', '{"a":1}'), kind: 'json' } });
  const a = await made.execute(Buffer.from('request-one', 'utf8'), { taskId: 't.1' });
  const b = await made.execute(Buffer.from('request-two', 'utf8'), { taskId: 't.1' });
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  // Same grant, same file, same advisory: only the request differs. If the
  // request digest were dropped from the composition these would collide.
  assert.notEqual(a.payloadSha256, b.payloadSha256);
});
