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
import { createContentConsent, CONTENT_CONSENT_LIMITS, ALLOWED_CONTENT_KINDS } from '../neural/content-consent.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const tempRoot = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'consent-')));

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
