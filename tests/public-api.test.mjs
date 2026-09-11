// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFileAccessPolicy, canonicalizeJsonV1, createAppleFoundationModelsAdapter } from 'nisi';
import { createContentConsent } from 'nisi/gate/content-consent.mjs';
import { canonicalizeJSONV1 } from 'nisi/canonical/canonical-json-v1.mjs';
import { createAFMContentExecutor } from 'nisi/gate/afm-content-executor.mjs';
import * as policy from 'nisi/policy';
import * as serialization from 'nisi/serialization';
import * as apple from 'nisi/adapters/apple-foundation-models';

test('descriptive public names preserve the original v1 factories and imports', () => {
  assert.equal(createFileAccessPolicy, createContentConsent);
  assert.equal(canonicalizeJsonV1, canonicalizeJSONV1);
  assert.equal(createAppleFoundationModelsAdapter, createAFMContentExecutor);
  assert.equal(policy.createFileAccessPolicy, createContentConsent);
  assert.equal(serialization.canonicalizeJsonV1, canonicalizeJSONV1);
  assert.equal(apple.createAppleFoundationModelsAdapter, createAFMContentExecutor);
  assert.equal(createFileAccessPolicy(Buffer.alloc(0), { clock: () => 0 }).code, 'CONSENT_BYTES_REFUSED');
  assert.deepEqual(canonicalizeJsonV1(Buffer.from('{"b":2,"a":1}')), canonicalizeJSONV1(Buffer.from('{"a":1,"b":2}')));
  assert.equal(createAppleFoundationModelsAdapter({}).code, 'BINARY_ARGUMENTS');
});
