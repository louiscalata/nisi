// tests/nisi-inspect-reader.test.mjs
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readStoredDemoSummaryBytesV1, inspectNisiRunDirectoryV1 } from '../cli/inspect.mjs';

const MAX = 262144;
const D = 'NISI_INSPECT_DIRECTORY_INVALID';
const R = 'NISI_INSPECT_READ_FAILED';
const C = 'NISI_INSPECT_CHANGED';
const L = 'NISI_INSPECT_TOO_LARGE';
const SUMMARY = {
  schemaVersion: 'nisi-private-live-demo-summary-v1',
  status: 'INCOMPLETE',
  workflowOutcome: null,
  errorCode: null,
  diagnosticErrors: [],
  retained: [],
  receiptFingerprint: null,
  setupDurationMs: null,
  workflowDurationMs: null,
  remoteInferenceStopped: 'NOT_OBSERVED',
  blindBenchmark: false,
  comparativeBenefitMeasured: false,
  rawHttpBodyRetained: false,
  applied: false,
  nativeAppAccepted: false,
  publicationAuthorized: false,
};
const enc = (v) => Buffer.from(JSON.stringify(v, null, 2) + '\n', 'utf8');
const BYTES = enc(SUMMARY);
const SHA = createHash('sha256').update(BYTES).digest('hex');
const LEAK = 'nisi-private-live-demo';

function makeRoot(bytes = BYTES) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-reader-'));
  fs.chmodSync(root, 0o700);
  if (bytes !== null) fs.writeFileSync(path.join(root, 'summary.json'), bytes, { mode: 0o600 });
  return root;
}
function cleanup(...dirs) {
  for (const d of dirs) {
    try { fs.chmodSync(d, 0o700); } catch {}
    fs.rmSync(d, { recursive: true, force: true });
  }
}
function expectCode(fn, codes, ...forbidden) {
  let err;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err instanceof Error, 'expected an Error');
  assert.ok([].concat(codes).includes(err.code), `code ${err.code}`);
  for (const s of forbidden) assert.ok(!String(err.message).includes(s), 'leak: ' + s);
  return err;
}
const bump = (v, d) => (typeof v === 'bigint' ? v + BigInt(d) : v + d);
function patchStat(s, patch) {
  return Object.assign(Object.create(Object.getPrototypeOf(s)), s, patch);
}
function mockFstat(fn) {
  const orig = fs.fstatSync;
  let n = 0;
  return mock.method(fs, 'fstatSync', function (...a) { return fn(orig.apply(fs, a), ++n); });
}

test('read-only success returns frozen observation', () => {
  const root = makeRoot();
  try {
    const bytes = readStoredDemoSummaryBytesV1(root);
    assert.ok(Buffer.isBuffer(bytes));
    assert.equal(Buffer.compare(bytes, BYTES), 0);
    const out = inspectNisiRunDirectoryV1(root);
    assert.deepEqual(out, {
      schemaVersion: 'nisi-cli-inspection/v1', status: 'OBSERVED', scope: 'STORED_SUMMARY_ONLY',
      summarySha256: SHA, producerSchema: SUMMARY.schemaVersion,
      reportedStatus: 'INCOMPLETE', reportedOutcome: null, reportedErrorCode: null,
      diagnosticCount: 0, declaredArtifactCount: 0, receiptFingerprint: null,
      timings: { setupDurationMs: null, workflowDurationMs: null },
      sourceTrust: 'UNVERIFIED', integrity: 'SUMMARY_BYTES_HASHED_ONLY',
      bundleValidation: 'NOT_RUN', lateSettlement: 'NOT_ASSESSED', currentRunState: 'UNKNOWN',
      remoteInferenceStopped: 'NOT_OBSERVED', authorizing: false, accepted: false, applied: false,
    });
    assert.ok(Object.isFrozen(out) && Object.isFrozen(out.timings));
    assert.equal(Buffer.compare(fs.readFileSync(path.join(root, 'summary.json')), BYTES), 0);
  } finally { cleanup(root); }
});

test('invalid directory arguments refuse', () => {
  const root = makeRoot();
  try {
    for (const bad of ['', 'relative/dir', root + '\0', '/' + 'x'.repeat(4096), 42, null, undefined, {}]) {
      expectCode(() => inspectNisiRunDirectoryV1(bad), D, root, LEAK);
    }
    expectCode(() => inspectNisiRunDirectoryV1(path.join(root, 'missing')), D, root, LEAK);
    expectCode(() => inspectNisiRunDirectoryV1(path.join(root, 'summary.json')), D, root, LEAK);
  } finally { cleanup(root); }
});

test('non-private root refuses', () => {
  const root = makeRoot();
  try {
    for (const mode of [0o750, 0o705, 0o777]) {
      fs.chmodSync(root, mode);
      expectCode(() => inspectNisiRunDirectoryV1(root), D, root, LEAK);
    }
  } finally { cleanup(root); }
});
test('absolute private root with spaces is accepted and actual NUL is refused', () => {
  const root = makeRoot(), spaced = root + ' with spaces';
  fs.renameSync(root,spaced);
  try {
    assert.equal(inspectNisiRunDirectoryV1(spaced).summarySha256,SHA);
    expectCode(() => inspectNisiRunDirectoryV1(spaced+'\0'),D);
  } finally { cleanup(spaced); }
});

test('root symlink refuses incl. trailing slash and dot; parent alias canonicalizes', () => {
  const root = makeRoot();
  const other = makeRoot(null);
  try {
    const link = path.join(other, 'link');
    fs.symlinkSync(root, link);
    for (const p of [link, link + '/', link + '/.']) {
      expectCode(() => inspectNisiRunDirectoryV1(p), D, root, LEAK);
    }
    const plink = path.join(other, 'plink');
    fs.symlinkSync(path.dirname(root), plink);
    const out = inspectNisiRunDirectoryV1(path.join(plink, path.basename(root)));
    assert.equal(out.summarySha256, SHA);
  } finally { cleanup(root, other); }
});

test('summary symlink, hardlink and non-regular refuse', () => {
  const other = makeRoot(null);
  const real = path.join(other, 'real.json');
  fs.writeFileSync(real, BYTES, { mode: 0o600 });
  const r1 = makeRoot(null); fs.symlinkSync(real, path.join(r1, 'summary.json'));
  const r2 = makeRoot(null); fs.linkSync(real, path.join(r2, 'summary.json'));
  const r3 = makeRoot(null); fs.mkdirSync(path.join(r3, 'summary.json'));
  try {
    for (const r of [r1, r2, r3]) expectCode(() => inspectNisiRunDirectoryV1(r), R, r, other, LEAK);
  } finally { cleanup(r1, r2, r3, other); }
});

test('size limits: empty, oversize, exact max', () => {
  const empty = makeRoot(Buffer.alloc(0));
  const big = makeRoot(Buffer.alloc(MAX + 1, 0x20));
  const exact = makeRoot(Buffer.alloc(MAX, 0x78));
  try {
    expectCode(() => readStoredDemoSummaryBytesV1(empty), R, empty, LEAK);
    expectCode(() => readStoredDemoSummaryBytesV1(big), L, big, LEAK);
    assert.equal(readStoredDemoSummaryBytesV1(exact).length, MAX);
  } finally { cleanup(empty, big, exact); }
});

test('no sibling traversal or directory enumeration', () => {
  const s = { ...SUMMARY, retained: [{ path: 'other.json', byteLength: 0, sha256: '0'.repeat(64) }] };
  const root = makeRoot(enc(s));
  fs.symlinkSync('/nonexistent-nisi-target', path.join(root, 'other.json'));
  const boom = () => { throw new Error('enumeration forbidden'); };
  const rd = mock.method(fs, 'readdirSync', boom);
  const od = mock.method(fs, 'opendirSync', boom);
  const op = mock.method(fs, 'openSync');
  try {
    const out = inspectNisiRunDirectoryV1(root);
    assert.equal(out.declaredArtifactCount, 1);
    assert.equal(rd.mock.callCount(), 0);
    assert.equal(od.mock.callCount(), 0);
    assert.equal(op.mock.callCount(), 1);
    for (const c of op.mock.calls) assert.equal(path.basename(String(c.arguments[0])), 'summary.json');
  } finally { mock.restoreAll(); cleanup(root); }
});

for (const [name, patch] of [
  ['shrunk', (s) => ({ size: bump(s.size, -1) })],
  ['grown', (s) => ({ size: bump(s.size, 1) })],
  ['zero length', () => ({ size: 0n })],
  ['above cap', () => ({ size: BigInt(MAX + 1) })],
  ['new hardlink', () => ({ nlink: 2n })],
  ['changed (ctime)', (s) => ({ ctimeNs: bump(s.ctimeNs ?? 0n, 1), ctimeMs: bump(s.ctimeMs, 1) })],
]) {
  test(`fd identity ${name} after open is refused`, () => {
    const root = makeRoot();
    mockFstat((s, n) => (n >= 2 ? patchStat(s, patch(s)) : s));
    try {
      expectCode(() => inspectNisiRunDirectoryV1(root), C, root, LEAK);
    } finally { mock.restoreAll(); cleanup(root); }
  });
}

test('fd identity mismatching named file is refused', () => {
  const root = makeRoot();
  mockFstat((s) => patchStat(s, { ino: bump(s.ino, 1) }));
  try {
    expectCode(() => inspectNisiRunDirectoryV1(root), C, root, LEAK);
  } finally { mock.restoreAll(); cleanup(root); }
});

test('read failure maps to READ_FAILED and fd is closed', () => {
  const root = makeRoot();
  const op = mock.method(fs, 'openSync');
  const cl = mock.method(fs, 'closeSync');
  mock.method(fs, 'readSync', () => { const e = new Error('io'); e.code = 'EIO'; throw e; });
  try {
    expectCode(() => inspectNisiRunDirectoryV1(root), R, root, LEAK);
    assert.ok(op.mock.callCount() >= 1);
    assert.equal(cl.mock.callCount(), op.mock.callCount());
  } finally { mock.restoreAll(); cleanup(root); }
});

test('close failure is preserved, not swallowed', () => {
  const root = makeRoot();
  const orig = fs.closeSync;
  mock.method(fs, 'closeSync', function (fd) { orig.call(fs, fd); const e = new Error('close'); e.code = 'EIO'; throw e; });
  try {
    expectCode(() => inspectNisiRunDirectoryV1(root), R, root, LEAK);
  } finally { mock.restoreAll(); cleanup(root); }
});

test('simultaneous identity and close failure surfaces READ_FAILED with fixed prior code', () => {
  const root = makeRoot(), original = fs.closeSync;
  mockFstat((s, n) => n >= 2 ? patchStat(s, {size: 0n}) : s);
  mock.method(fs, 'closeSync', fd => { original(fd); throw Error('PRIVATE_CLOSE'); });
  try {
    const error = expectCode(() => inspectNisiRunDirectoryV1(root), R, root, 'PRIVATE_CLOSE');
    assert.equal(error.priorCode, C); assert.equal(error.cause, undefined);
  } finally { mock.restoreAll(); cleanup(root); }
});

for (const mode of ['shrink', 'grow']) test(`bounded read detects actual ${mode}`, () => {
  const root = makeRoot(), original = fs.readSync;
  mock.method(fs, 'readSync', (...args) => mode === 'shrink' ? 0 : args[3] === 1 ? 1 : original(...args));
  try { expectCode(() => inspectNisiRunDirectoryV1(root), C); }
  finally { mock.restoreAll(); cleanup(root); }
});

for (const change of ['mode', 'root', 'file']) test(`post-read ${change} replacement is CHANGED`, () => {
  const root = makeRoot(), backup = root + '-moved', original = fs.readSync;
  let changed = false;
  mock.method(fs, 'readSync', (...args) => {
    const count = original(...args);
    if (!changed) {
      changed = true;
      if (change === 'mode') fs.chmodSync(root, 0o755);
      if (change === 'file') {
        fs.renameSync(path.join(root,'summary.json'),path.join(root,'old.json'));
        fs.writeFileSync(path.join(root,'summary.json'),BYTES,{mode:0o600});
      }
      if (change === 'root') {
        fs.renameSync(root,backup); fs.mkdirSync(root,{mode:0o700});
        // Preserve the admitted file identity; isolate the root-identity check.
        fs.renameSync(path.join(backup,'summary.json'),path.join(root,'summary.json'));
      }
    }
    return count;
  });
  try { expectCode(() => inspectNisiRunDirectoryV1(root), C); }
  finally { mock.restoreAll(); cleanup(root); if (fs.existsSync(backup)) cleanup(backup); }
});

test('missing summary and malformed summary are distinct fixed refusals', () => {
  const root = makeRoot(null);
  try {
    expectCode(() => inspectNisiRunDirectoryV1(root), R);
    fs.writeFileSync(path.join(root,'summary.json'),'PRIVATE_INVALID');
    expectCode(() => inspectNisiRunDirectoryV1(root),'NISI_INSPECT_SUMMARY_INVALID', 'PRIVATE_INVALID');
  } finally { cleanup(root); }
});
