import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as api from '../history/journal-owner-v2.mjs';
test('explicit private dependency-free module and four named APIs', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.dependencies, undefined);
  assert.deepEqual(Object.keys(api).sort(), ['inspectJournalOwner', 'maintainJournalOwner', 'openJournalOwner', 'recordJournalObservation']);
  for (const fn of Object.values(api)) assert.equal(typeof fn, 'function');
});
test('unchanged frozen journal and store formats', () => {
  const pins = {"run-journal-v1.mjs":"dee9f490c091000b2560cd9464d945885e7f341091b87dde9ae4f2b7cdbd359e","run-journal-store-v1.mjs":"1356028b65f9f8b96e3b9ec8ba3bfbb4968092af53d00e8b5dfdb11b161f4792"};
  for (const [name, expected] of Object.entries(pins)) {
    const bytes = fs.readFileSync(new URL('../history/' + name, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
  }
});
