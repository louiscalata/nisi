// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('the README example runs and prints what the README says it prints', () => {
  const out = execFileSync(process.execPath, ['examples/allow-a-file.mjs'], { encoding: 'utf8' });
  const lines = out.trim().split('\n');
  assert.match(lines[0], /^ALLOWED {2}notes\.json {2}sha256=[0-9a-f]{12}…$/);
  assert.equal(lines[1], 'REFUSED  secrets.json  CONTENT_OUT_OF_SCOPE');
  assert.equal(lines[2], 'REFUSED  notes.json  CONTENT_KIND_REFUSED');
  assert.equal(lines[3], 'REFUSED  missing.json  CONTENT_PATH_UNRESOLVABLE');
  assert.equal(lines[4], 'REFUSED  looks-safe.json  CONTENT_OUT_OF_SCOPE');
  assert.equal(lines[5], 'REFUSED  notes.json  CONSENT_REVOKED');
  assert.equal(lines[6], 'same hash for same meaning');
});
