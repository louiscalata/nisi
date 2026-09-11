// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
//
// Run:  node examples/allow-a-file.mjs
//
// The whole idea in one file: say which files an AI may read, then ask.
// Inside the allowed folder → you get the bytes and a hash.
// Outside it, or a refused kind label, or too big → you get a named refusal. Nothing else.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalizeJSONV1 } from '../serialization/canonical-json-v1.mjs';
import { createFileAccessPolicy } from '../policy/file-access.mjs';

// A scratch folder with one file inside it and one file outside it.
const allowed = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-allowed-'));
const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-elsewhere-'));
fs.writeFileSync(path.join(allowed, 'notes.json'), '{"topic":"release notes","z":1,"a":2}');
fs.writeFileSync(path.join(elsewhere, 'secrets.json'), '{"token":"do-not-send"}');

// 1. Say what the AI may read. This is the whole permission, and every field is required.
const rules = {
  kind: 'nisi-content-consent-v1', schemaVersion: 1, generation: 1,
  grantId: 'demo', consentClass: 'WRITTEN_DECLARATION',
  scopeRoot: allowed,                 // only files under this folder
  allowedKinds: ['json', 'text'],     // permitted caller-declared labels
  maxContentBytes: 4096,              // only this big
  maxAdvisoryChars: 256, lifetimeMs: 60_000,
  destination: 'ON_DEVICE_APPLE_FOUNDATION_MODELS_ONLY',
  networkEgress: false, contentPersisted: false, transcriptPersisted: false,
};

// The rules are hashed, so the permission you granted is the permission that runs.
const rulesBytes = Buffer.from(canonicalizeJSONV1(Buffer.from(JSON.stringify(rules))).canonical);
const { grant } = createFileAccessPolicy(rulesBytes, { clock: () => Date.now() });

// 2. Ask for files. Each answer is either the bytes or a named reason.
const ask = (file, kind = 'json') => {
  const r = grant.admitContent({ filePath: file, kind });
  console.log(r.ok ? `ALLOWED  ${path.basename(file)}  sha256=${r.contentSha256.slice(0, 12)}…`
                   : `REFUSED  ${path.basename(file)}  ${r.code}`);
};

ask(path.join(allowed, 'notes.json'));            // ALLOWED
ask(path.join(elsewhere, 'secrets.json'));        // REFUSED  CONTENT_OUT_OF_SCOPE
ask(path.join(allowed, 'notes.json'), 'markdown'); // REFUSED  CONTENT_KIND_REFUSED
ask(path.join(allowed, 'missing.json'));          // REFUSED  CONTENT_PATH_UNRESOLVABLE

// A symlink inside the allowed folder that points outside it is still outside.
fs.symlinkSync(path.join(elsewhere, 'secrets.json'), path.join(allowed, 'looks-safe.json'));
ask(path.join(allowed, 'looks-safe.json'));       // REFUSED  CONTENT_OUT_OF_SCOPE

// 3. Revoke, and nothing is allowed any more.
grant.revoke();
ask(path.join(allowed, 'notes.json'));            // REFUSED  CONSENT_REVOKED

// Bonus: the same JSON always hashes the same, whatever the key order.
const a = canonicalizeJSONV1(Buffer.from('{"z":1,"a":2}')).sha256;
const b = canonicalizeJSONV1(Buffer.from('{ "a": 2, "z": 1 }')).sha256;
console.log(a === b ? 'same hash for same meaning' : 'BUG');

// These directories were created by this demonstration.
fs.rmSync(allowed, { recursive: true, force: true });
fs.rmSync(elsewhere, { recursive: true, force: true });
