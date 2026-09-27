// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

// Contract tests for the consent boundary itself.
//
// The gate is the only thing standing between caller-supplied files and a
// model, so these tests are written against the failure modes that would make
// it useless: a grant that is not what it appears to be, a path that leaves the
// approved root by a route other than its own name, and a grant that outlives
// its own declaration.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalizeJSONV1 } from '../canonical/canonical-json-v1.mjs';
import { createContentConsent, CONTENT_CONSENT_LIMITS, ALLOWED_CONTENT_KINDS } from '../gate/content-consent.mjs';
import { createFileAccessPolicy } from 'nisi/policy';
import { canonicalizeJsonV1 } from 'nisi/serialization';

const sha = b => createHash('sha256').update(b).digest('hex');
// Every scratch directory is removed after this file's tests; a locked file
// (for example under a Windows scanner) must not fail the suite.
const made = [];
const tempRoot = () => { const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'consent-'))); made.push(dir); return dir; };
test.after(() => { for (const dir of made) { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); } catch {} } });
// Creating a symlink on Windows needs elevated rights or Developer Mode; a test
// that swaps one in mid-read is skipped, with the reason, where that is refused.
const SYMLINKS = (() => {
  const dir = tempRoot(), target = path.join(dir, 'target');
  fs.writeFileSync(target, 'x');
  try { fs.symlinkSync(target, path.join(dir, 'link')); return false; }
  catch (error) { return `symlink creation is unavailable here (${error.code})`; }
})();

function declaration(scopeRoot, overrides = {}) {
  return {
    kind: 'nisi-content-consent-v1', schemaVersion: 1, generation: 1,
    grantId: 'test.grant', consentClass: 'WRITTEN_DECLARATION',
    scopeRoot, allowedKinds: ['json', 'text'], maxContentBytes: 4096,
    maxAdvisoryChars: 256, lifetimeMs: 60000,
    destination: 'ON_DEVICE_APPLE_FOUNDATION_MODELS_ONLY',
    networkEgress: false, contentPersisted: false, transcriptPersisted: false,
    ...overrides,
  };
}

const bytesOf = value =>
  Buffer.from(canonicalizeJSONV1(Buffer.from(JSON.stringify(value), 'utf8')).canonical, 'utf8');

function make(scopeRoot, overrides, clock = () => Date.now()) {
  return createContentConsent(bytesOf(declaration(scopeRoot, overrides)), { clock });
}

function grantOf(scopeRoot, overrides, clock) {
  const made = make(scopeRoot, overrides, clock);
  assert.equal(made.ok, true, made.code);
  return made.grant;
}

function write(root, name, contents) {
  const file = path.join(root, name);
  fs.writeFileSync(file, contents);
  return file;
}

test('a grant must be presented as canonical bytes', () => {
  const root = tempRoot();
  const value = declaration(root);
  assert.equal(createContentConsent(JSON.stringify(value), { clock: () => 0 }).code, 'CONSENT_BYTES_REFUSED');
  assert.equal(createContentConsent(Buffer.alloc(0), { clock: () => 0 }).code, 'CONSENT_BYTES_REFUSED');
  assert.equal(createContentConsent(Buffer.alloc(9000, 0x20), { clock: () => 0 }).code, 'CONSENT_BYTES_REFUSED');
  // valid JSON, valid declaration, but not canonical: spacing and key order
  const spaced = Buffer.from(JSON.stringify(value, null, 2), 'utf8');
  assert.equal(createContentConsent(spaced, { clock: () => 0 }).code, 'CONSENT_NONCANONICAL');
  const reordered = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(value).reverse())), 'utf8');
  assert.equal(createContentConsent(reordered, { clock: () => 0 }).code, 'CONSENT_NONCANONICAL');
  assert.equal(createContentConsent(Buffer.from('not json', 'utf8'), { clock: () => 0 }).code, 'CONSENT_NONCANONICAL');
});

test('a grant is refused unless every declared boundary is the boundary', () => {
  const root = tempRoot();
  const refusals = [
    { destination: 'PRIVATE_CLOUD_COMPUTE' },
    { networkEgress: true },
    { contentPersisted: true },
    { transcriptPersisted: true },
    // reserved: nothing in this project can witness a real user-interface action
    { consentClass: 'CAPTURED_USER_INTERFACE_ACTION' },
    { lifetimeMs: CONTENT_CONSENT_LIMITS.maxLifetimeMs + 1 },
    { maxContentBytes: CONTENT_CONSENT_LIMITS.maxContentBytes + 1 },
    { maxAdvisoryChars: CONTENT_CONSENT_LIMITS.maxAdvisoryChars + 1 },
    { allowedKinds: [] },
    { allowedKinds: ['json', 'json'] },
    { allowedKinds: ['executable'] },
    { scopeRoot: 'relative/path' },
    { generation: 0 },
    { grantId: 'Not An ID' },
    { schemaVersion: 2 },
    { kind: 'nisi-content-consent-v2' },
  ];
  for (const override of refusals) {
    const made = make(root, override);
    assert.equal(made.ok, false, JSON.stringify(override));
    assert.equal(made.code, 'CONSENT_DECLARATION_REFUSED', JSON.stringify(override));
  }
  // a missing key and an unexpected key are both refusals
  const short = { ...declaration(root) }; delete short.lifetimeMs;
  assert.equal(createContentConsent(bytesOf(short), { clock: () => 0 }).code, 'CONSENT_DECLARATION_REFUSED');
  const long = { ...declaration(root), alsoAllowed: 'everything' };
  assert.equal(createContentConsent(bytesOf(long), { clock: () => 0 }).code, 'CONSENT_DECLARATION_REFUSED');
});

test('a valid grant admits content inside its scope and returns the file, not the caller claim', () => {
  const root = tempRoot();
  const grant = grantOf(root);
  const file = write(root, 'a.json', '{"hello":"world"}');
  const out = grant.admitContent({ filePath: file, kind: 'json' });
  assert.equal(out.ok, true, out.code);
  assert.equal(out.code, 'CONTENT_ADMITTED');
  assert.equal(out.bytes.toString('utf8'), '{"hello":"world"}');
  assert.equal(out.contentSha256, sha(fs.readFileSync(file)));
  assert.equal(out.contentBytes, 17);
  assert.equal(out.maxAdvisoryChars, 256);
  assert.equal(out.consentDigest, grant.digest);
  // no authority is implied by admitting content
  assert.equal(out.authorizing, false);
  assert.equal(out.certificationGranted, false);
  assert.equal(grant.status().admittedItems, 1);
});

test('scope is a path boundary, not a string prefix', () => {
  const root = tempRoot();
  const sibling = `${root}-evil`;
  fs.mkdirSync(sibling);
  made.push(sibling);
  const grant = grantOf(root);
  const smuggled = write(sibling, 'a.json', '{"secret":true}');
  assert.equal(grant.admitContent({ filePath: smuggled, kind: 'json' }).code, 'CONTENT_OUT_OF_SCOPE');
});

test('a symlink cannot carry content across the boundary', () => {
  const root = tempRoot();
  const outside = tempRoot();
  const grant = grantOf(root);
  const target = write(outside, 'secret.json', '{"secret":true}');
  const link = path.join(root, 'innocent.json');
  fs.symlinkSync(target, link);
  assert.equal(grant.admitContent({ filePath: link, kind: 'json' }).code, 'CONTENT_OUT_OF_SCOPE');
  // and the same through a linked directory
  const linkedDir = path.join(root, 'linked');
  fs.symlinkSync(outside, linkedDir);
  assert.equal(grant.admitContent({ filePath: path.join(linkedDir, 'secret.json'), kind: 'json' }).code,
    'CONTENT_OUT_OF_SCOPE');
  assert.equal(grant.status().admittedItems, 0);
});

test("'..' after a linked directory is resolved as the OS resolves it, for items and the root", {
  skip: process.platform === 'win32' &&
    'Windows collapses .. as text before following links, so the path names the in-scope file',
}, () => {
  const root = tempRoot(), outside = tempRoot();
  fs.mkdirSync(path.join(outside, 'dir'));
  fs.symlinkSync(path.join(outside, 'dir'), path.join(root, 'linked'));
  const inside = write(root, 'a.txt', 'IN-SCOPE'), beyond = write(outside, 'a.txt', 'OUTSIDE');
  // Concatenated, because path.join would collapse the '..' away as text.
  const dotted = `${root}${path.sep}linked${path.sep}..`, filePath = `${dotted}${path.sep}a.txt`;
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'OUTSIDE');
  const grant = grantOf(root);
  const refused = grant.admitContent({ filePath, kind: 'text' });
  assert.equal(refused.code, 'CONTENT_OUT_OF_SCOPE');
  assert.equal('bytes' in refused, false);
  assert.equal(grant.status().admittedItems, 0);
  // A declared root is the directory the OS names, not its lexical parent.
  const rooted = grantOf(dotted);
  assert.equal(rooted.admitContent({ filePath: inside, kind: 'text' }).code, 'CONTENT_OUT_OF_SCOPE');
  const admitted = rooted.admitContent({ filePath: beyond, kind: 'text' });
  assert.equal(admitted.code, 'CONTENT_ADMITTED');
  assert.equal(admitted.bytes.toString('utf8'), 'OUTSIDE');
});

test("'..' after a missing directory is unresolvable, for items and the root, though its text names a file", {
  skip: process.platform === 'win32' &&
    'Windows collapses .. as text before resolving, so the path names the existing file',
}, () => {
  const root = tempRoot();
  const inside = write(root, 'a.txt', 'IN-SCOPE');
  const dotted = `${root}${path.sep}missing${path.sep}..`, filePath = `${dotted}${path.sep}a.txt`;
  assert.throws(() => fs.readFileSync(filePath), { code: 'ENOENT' });
  const grant = grantOf(root);
  const refused = grant.admitContent({ filePath, kind: 'text' });
  assert.equal(refused.code, 'CONTENT_PATH_UNRESOLVABLE');
  assert.equal('bytes' in refused, false);
  // A root written that way leaves no file admissible.
  assert.equal(grantOf(dotted).admitContent({ filePath: inside, kind: 'text' }).code, 'CONTENT_PATH_UNRESOLVABLE');
  assert.equal(grant.status().admittedItems, 0);
});

test('a trailing slash after a file name is unresolvable on Linux, where the OS refuses it', {
  skip: process.platform !== 'linux' &&
    'other realpath(3) implementations, such as macOS, may strip the slash and name the file',
}, () => {
  const root = tempRoot();
  const file = write(root, 'a.txt', 'IN-SCOPE');
  const grant = grantOf(root);
  for (const filePath of [`${file}/`, `${file}/.`]) {
    assert.throws(() => fs.readFileSync(filePath), { code: 'ENOTDIR' }, filePath);
    const refused = grant.admitContent({ filePath, kind: 'text' });
    assert.equal(refused.code, 'CONTENT_PATH_UNRESOLVABLE', filePath);
    assert.equal('bytes' in refused, false, filePath);
  }
  assert.equal(grant.status().admittedItems, 0);
});

test('each item is checked on its own terms', () => {
  const root = tempRoot();
  const grant = grantOf(root);
  const cases = [
    [{ filePath: write(root, 'a.md', '# hi'), kind: 'markdown' }, 'CONTENT_KIND_REFUSED'],
    [{ filePath: write(root, 'a.json', '{}'), kind: 'binary' }, 'CONTENT_KIND_REFUSED'],
    [{ filePath: 'relative.json', kind: 'json' }, 'CONTENT_PATH_INVALID'],
    [{ filePath: path.join(root, 'absent.json'), kind: 'json' }, 'CONTENT_PATH_UNRESOLVABLE'],
    [{ filePath: root, kind: 'json' }, 'CONTENT_OUT_OF_SCOPE'],
    [{ filePath: write(root, 'empty.json', ''), kind: 'json' }, 'CONTENT_EMPTY'],
    [{ filePath: write(root, 'big.json', 'x'.repeat(4097)), kind: 'json' }, 'CONTENT_BYTE_LIMIT'],
    [{ filePath: write(root, 'bad.txt', Buffer.from([0xff, 0xfe, 0x00])), kind: 'text' }, 'CONTENT_NOT_UTF8'],
    [{ filePath: write(root, 'a.json', '{}') }, 'CONTENT_ITEM_INVALID'],
    [{ filePath: write(root, 'a.json', '{}'), kind: 'json', extra: 1 }, 'CONTENT_ITEM_INVALID'],
    ['not an item', 'CONTENT_ITEM_INVALID'],
    [null, 'CONTENT_ITEM_INVALID'],
    [[], 'CONTENT_ITEM_INVALID'],
  ];
  for (const [item, code] of cases) {
    assert.equal(grant.admitContent(item).code, code, JSON.stringify(item));
  }
  // a directory inside the scope is refused as a non-file, not read
  const inner = path.join(root, 'inner');
  fs.mkdirSync(inner);
  assert.equal(grant.admitContent({ filePath: inner, kind: 'json' }).code, 'CONTENT_NOT_REGULAR_FILE');
  assert.equal(grant.status().admittedItems, 0);
});

test('a grant does not outlive its declared lifetime', () => {
  const root = tempRoot();
  let now = 1000;
  const grant = grantOf(root, { lifetimeMs: 500 }, () => now);
  const item = { filePath: write(root, 'a.json', '{}'), kind: 'json' };
  assert.equal(grant.admitContent(item).ok, true);
  now = 1499;
  assert.equal(grant.admitContent(item).ok, true);
  now = 1500;
  assert.equal(grant.admitContent(item).code, 'CONSENT_EXPIRED');
  assert.equal(grant.status().live, false);
  assert.equal(grant.status().refusalIfNotLive, 'CONSENT_EXPIRED');
});

test('a clock that moves backwards is refused, not trusted', () => {
  const root = tempRoot();
  let now = 5000;
  const grant = grantOf(root, {}, () => now);
  const item = { filePath: write(root, 'a.json', '{}'), kind: 'json' };
  now = 4999;
  assert.equal(grant.admitContent(item).code, 'CONSENT_CLOCK_REGRESSION');
  now = -1;
  assert.equal(grant.admitContent(item).code, 'CONSENT_CLOCK_INVALID');
});

test('revocation is immediate and terminal', () => {
  const root = tempRoot();
  const grant = grantOf(root);
  const item = { filePath: write(root, 'a.json', '{}'), kind: 'json' };
  assert.equal(grant.admitContent(item).ok, true);
  assert.equal(grant.revoke().code, 'CONSENT_REVOKED_BY_HOLDER');
  assert.equal(grant.admitContent(item).code, 'CONSENT_REVOKED');
  grant.revoke();
  assert.equal(grant.admitContent(item).code, 'CONSENT_REVOKED');
  assert.equal(grant.status().live, false);
});

test('a grant reports what it is and claims nothing more', () => {
  const root = tempRoot();
  const made = make(root);
  const status = made.grant.status();
  assert.equal(status.consentClass, 'WRITTEN_DECLARATION');
  assert.equal(status.destination, 'ON_DEVICE_APPLE_FOUNDATION_MODELS_ONLY');
  assert.equal(status.networkEgress, false);
  assert.equal(status.consentDigest, made.consentDigest);
  assert.match(made.consentDigest, /^[0-9a-f]{64}$/);
  for (const flag of ['authorizing', 'modelExecuted', 'promotionGranted', 'certificationGranted']) {
    assert.equal(status[flag], false, flag);
    assert.equal(made[flag], false, flag);
  }
  // two identical declarations digest identically; one changed field does not
  assert.equal(make(root).consentDigest, made.consentDigest);
  assert.notEqual(make(root, { maxContentBytes: 4095 }).consentDigest, made.consentDigest);
});

test('the declared limits are the module constants, not per-call opinions', () => {
  assert.deepEqual(ALLOWED_CONTENT_KINDS, ['json', 'markdown', 'text']);
  assert.equal(Object.isFrozen(ALLOWED_CONTENT_KINDS), true);
  assert.equal(Object.isFrozen(CONTENT_CONSENT_LIMITS), true);
  const root = tempRoot();
  assert.equal(createContentConsent(bytesOf(declaration(root)), { clock: () => 0, extra: 1 }).code,
    'CONFIGURATION_REFUSED');
  assert.equal(createContentConsent(bytesOf(declaration(root)), { clock: 'noon' }).code, 'CONFIGURATION_REFUSED');
  assert.equal(createContentConsent(bytesOf(declaration(root)), null).code, 'CONFIGURATION_REFUSED');
  assert.equal(createContentConsent(bytesOf(declaration(root)), { clock: () => -1 }).code, 'CONSENT_CLOCK_INVALID');
  assert.equal(createContentConsent(bytesOf(declaration(root)), { clock: () => { throw new Error('x'); } }).code,
    'CONSENT_CLOCK_INVALID');
});

test('the consent digest is pinned to its v1 domain string', () => {
  const root = tempRoot();
  const grantBytes = bytesOf(declaration(root));
  const made = createContentConsent(grantBytes, { clock: () => 0 });
  // The digest is sha256("nisi/content-consent/v1" NUL canonical-grant-bytes).
  // Pinning it here means a silent change to the domain string fails a test
  // instead of quietly re-keying every grant in existence.
  const expected = sha(Buffer.concat([Buffer.from('nisi/content-consent/v1\0', 'utf8'), grantBytes]));
  assert.equal(made.consentDigest, expected);
});

test('later clock failures are named refusals and status samples the clock once', () => {
  const root = tempRoot(), filePath = write(root, 'clock.txt', 'clock');
  for (const operation of ['admitContent', 'status']) {
    let calls = 0;
    const grant = grantOf(root, {}, () => { if (calls++ === 0) return 0; throw new Error('clock exploded'); });
    const result = operation === 'status' ? grant.status() : grant.admitContent({ filePath, kind: 'text' });
    if (operation === 'status') {
      assert.equal(result.live, false);
      assert.equal(result.refusalIfNotLive, 'CONSENT_CLOCK_INVALID');
    } else assert.equal(result.code, 'CONSENT_CLOCK_INVALID');
    assert.equal(calls, 2, 'one construction sample and one operation sample');
  }
  let calls = 0;
  const grant = grantOf(root, { lifetimeMs: 2 }, () => calls++);
  const status = grant.status();
  assert.equal(calls, 2);
  assert.equal(status.live, true);
  assert.equal(status.refusalIfNotLive, null);
  assert.equal(grant.status().refusalIfNotLive, 'CONSENT_EXPIRED');
});

// The race tests below swap the file at one step of admission. The gate works
// on the OS-resolved path, whose spelling can differ from the caller's (8.3
// names on Windows), so each wrapper matches that path.

test('a final-component replacement after validation is refused before content is returned', { skip: SYMLINKS }, () => {
  const root = tempRoot(), outside = tempRoot();
  const filePath = write(root, 'safe.txt', 'PUBLIC'), resolved = fs.realpathSync.native(filePath);
  const secret = write(outside, 'secret.txt', 'SECRET');
  const grant = grantOf(root);
  const original = fs.lstatSync;
  let replaced = false;
  fs.lstatSync = function(target, ...args) {
    const result = original.call(fs, target, ...args);
    if (target === resolved && !replaced) { replaced = true; fs.unlinkSync(filePath); fs.symlinkSync(secret, filePath); }
    return result;
  };
  try {
    const result = grant.admitContent({ filePath, kind: 'text' });
    assert.equal(replaced, true);
    assert.equal(result.ok, false);
    // O_NOFOLLOW refuses the link where it exists; elsewhere the opened
    // object's identity differs. Either way it is this one named refusal.
    assert.equal(result.code, 'CONTENT_CHANGED_DURING_READ');
    assert.equal('bytes' in result, false);
    assert.equal(grant.status().admittedItems, 0);
  } finally { fs.lstatSync = original; }
});

test('a different regular file renamed over the path between lstat and open is refused', () => {
  const root = tempRoot();
  // Without the opened-identity check the empty file would bypass
  // CONTENT_EMPTY and the same-size one would be admitted as the original.
  for (const replacement of ['', 'SECRET']) {
    const filePath = write(root, 'safe.txt', 'PUBLIC'), resolved = fs.realpathSync.native(filePath);
    const other = write(root, 'other.txt', replacement), grant = grantOf(root);
    const original = fs.openSync;
    let replaced = false;
    fs.openSync = function(target, ...args) {
      if (target === resolved && !replaced) { replaced = true; fs.renameSync(other, filePath); }
      return original.call(fs, target, ...args);
    };
    try {
      const result = grant.admitContent({ filePath, kind: 'text' });
      assert.equal(replaced, true);
      assert.equal(result.code, 'CONTENT_CHANGED_DURING_READ', JSON.stringify(replacement));
      assert.equal('bytes' in result, false);
      assert.equal(grant.status().admittedItems, 0);
    } finally { fs.openSync = original; }
  }
});

test('a directory swapped in between lstat and open is refused at the opened descriptor', {
  skip: process.platform === 'win32' && 'relies on POSIX open(2) accepting a directory for reading',
}, () => {
  const root = tempRoot();
  const filePath = write(root, 'safe.txt', 'PUBLIC'), resolved = fs.realpathSync.native(filePath);
  const grant = grantOf(root);
  const original = fs.openSync;
  let replaced = false;
  fs.openSync = function(target, ...args) {
    if (target === resolved && !replaced) { replaced = true; fs.unlinkSync(filePath); fs.mkdirSync(filePath); }
    return original.call(fs, target, ...args);
  };
  try {
    const result = grant.admitContent({ filePath, kind: 'text' });
    assert.equal(replaced, true);
    assert.equal(result.code, 'CONTENT_NOT_REGULAR_FILE');
    assert.equal(grant.status().admittedItems, 0);
  } finally { fs.openSync = original; }
});

test('a file that grows during the bounded read stops at the byte cap', () => {
  const root = tempRoot(), filePath = write(root, 'grows.txt', 'PUBLIC'), grant = grantOf(root);
  const original = fs.readSync;
  let grown = false;
  fs.readSync = (...args) => {
    if (!grown) { grown = true; fs.appendFileSync(filePath, 'x'.repeat(5000)); }
    return original(...args);
  };
  try {
    const result = grant.admitContent({ filePath, kind: 'text' });
    assert.equal(grown, true);
    assert.equal(result.code, 'CONTENT_BYTE_LIMIT');
    assert.equal(result.bytes, 4097);
    assert.equal(result.maximum, 4096);
    assert.equal(grant.status().admittedItems, 0);
  } finally { fs.readSync = original; }
});

test('a read that ends before the size the descriptor reported is refused', () => {
  const root = tempRoot(), filePath = write(root, 'short.txt', 'PUBLIC'), grant = grantOf(root);
  const original = fs.readSync;
  let calls = 0;
  // End of file after two bytes while the metadata stays unchanged: only the
  // byte count can see this torn read.
  fs.readSync = (descriptor, buffer, offset, length, position) =>
    calls++ === 0 ? original(descriptor, buffer, offset, 2, position) : 0;
  try {
    const result = grant.admitContent({ filePath, kind: 'text' });
    assert.equal(calls, 2);
    assert.equal(result.code, 'CONTENT_CHANGED_DURING_READ');
    assert.equal('bytes' in result, false);
    assert.equal(grant.status().admittedItems, 0);
  } finally { fs.readSync = original; }
});

test('the declaration-bytes recipe in docs/file-policy.md builds a ready policy', () => {
  const doc = fs.readFileSync(new URL('../docs/file-policy.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  const recipe = /Build those bytes with `([^`]+)`/.exec(doc)?.[1];
  assert.equal(typeof recipe, 'string', 'docs/file-policy.md no longer states the recipe');
  const bytesFor = new Function('canonicalizeJsonV1', 'declaration', `return ${recipe};`);
  const root = tempRoot();
  const made = createFileAccessPolicy(bytesFor(canonicalizeJsonV1, declaration(root)), { clock: () => 0 });
  assert.equal(made.code, 'READY_PRIVATE_CONTENT_CONSENT_ONLY');
  assert.equal(made.consentDigest, make(root).consentDigest);
  // The codec returns a result record, not bytes; the record itself is refused.
  const record = canonicalizeJsonV1(Buffer.from(JSON.stringify(declaration(root))));
  assert.equal(createFileAccessPolicy(record, { clock: () => 0 }).code, 'CONSENT_BYTES_REFUSED');
});

test('file kind is a declared label; the v1 policy does not parse JSON content', () => {
  const root = tempRoot();
  const filePath = write(root, 'label.txt', 'plain UTF-8, not JSON');
  const result = grantOf(root).admitContent({ filePath, kind: 'json' });
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'json');
  assert.equal(result.bytes.toString(), 'plain UTF-8, not JSON');
});
