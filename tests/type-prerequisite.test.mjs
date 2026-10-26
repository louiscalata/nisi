// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// Type-prerequisite gate. Verifies that the missing @types/node prerequisite is
// declared and actionable, and that it is wired into `npm run preflight` so the
// red tsc suite fails closed with the exact MISSING_TYPES_NODE state instead of
// an opaque TS2688 compiler error. No network, no install.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
const defaultTypesNodeDir = path.join(here, '..', 'node_modules', '@types', 'node');

// The check reads the declared pin from package.json rather than hard-coding a version.
export function checkTypesPrerequisite({ typesDir = defaultTypesNodeDir } = {}) {
  const declared = packageJson.devDependencies && packageJson.devDependencies['@types/node'];
  if (typeof declared !== 'string' || declared.length === 0) {
    return { ok: false, state: 'MISSING_TYPES_NODE', version: null, remediation: 'npm install' };
  }
  if (!existsSync(typesDir)) {
    return { ok: false, state: 'MISSING_TYPES_NODE', version: declared, remediation: 'npm install' };
  }
  return { ok: true, state: 'PRESENT', version: declared };
}

test('(a) package.json declares a pinned devDependencies["@types/node"] and the check reads that pin', () => {
  const declared = packageJson.devDependencies && packageJson.devDependencies['@types/node'];
  assert.equal(typeof declared, 'string');
  assert.match(declared, /^\d+\.\d+\.\d+$/);
  const missing = checkTypesPrerequisite({ typesDir: path.join(here, '..', 'node_modules', '@types', 'definitely-absent') });
  assert.equal(missing.version, declared, 'the reported version must be the declared pin read from package.json, never hard-coded');
});

test('(b) the check reports MISSING_TYPES_NODE with the declared version and the exact remediation line when @types/node is absent, and PRESENT when it exists', () => {
  const declared = packageJson.devDependencies['@types/node'];
  const missing = checkTypesPrerequisite({ typesDir: path.join(here, '..', 'node_modules', '@types', 'definitely-absent') });
  assert.equal(missing.ok, false);
  assert.equal(missing.state, 'MISSING_TYPES_NODE');
  assert.equal(missing.version, declared);
  assert.equal(missing.remediation, 'npm install');
  const present = checkTypesPrerequisite({ typesDir: here });
  assert.equal(present.ok, true);
  assert.equal(present.state, 'PRESENT');
  assert.equal(present.version, declared);
});

test('(c) the check is wired into the preflight script so it runs before any type test', () => {
  assert.equal(packageJson.scripts['test:type-prerequisite'], 'node --test tests/type-prerequisite.test.mjs');
  const preflight = packageJson.scripts.preflight;
  assert.equal(typeof preflight, 'string');
  assert.ok(preflight.includes('tests/type-prerequisite.test.mjs'), 'preflight must run the prerequisite check');
  assert.ok(preflight.includes('--check-types-prerequisite'), 'preflight must run the check in gate mode');
  assert.ok(
    preflight.indexOf('tests/type-prerequisite.test.mjs') > preflight.indexOf('node scripts/require-node.cjs'),
    'the prerequisite check must run after the Node preflight and before any type test',
  );
});

test('(d) test:types is byte-identical to its pre-packet value, proving the red suite was not edited into passing', () => {
  assert.equal(
    packageJson.scripts['test:types'],
    'tsc --noEmit --ignoreConfig --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --module NodeNext --target ES2022 --types node tests/private-consumer/*.mts',
  );
});

// Gate mode: when preflight invokes this file directly, run the prerequisite
// check and exit nonzero with MISSING_TYPES_NODE and the declared version when
// the types package is absent. Under `node --test` this flag is never passed,
// so the assertions above are the only thing that runs.
if (process.argv.includes('--check-types-prerequisite')) {
  const result = checkTypesPrerequisite();
  if (!result.ok) {
    console.error(`${result.state} @types/node@${result.version} is not installed; run: ${result.remediation}`);
    process.exit(1);
  }
  console.log(`PRESENT @types/node@${result.version}`);
  process.exit(0);
}