import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const cleanupGuards = new WeakMap();

// Guards are evaluated at teardown, regardless of their registration order.
// An uncertain live child retains its fixtures and fails cleanup explicitly.
export function guardTempCleanup(t, isSafe) {
  if (!t || typeof t.after !== 'function' || typeof isSafe !== 'function') throw new Error('TEST_TEMP_ARGUMENT');
  const guards=cleanupGuards.get(t) ?? [];guards.push(isSafe);cleanupGuards.set(t,guards);
}

// A test may remove only the exact new directory it owns. Register before
// realpath or any subsequent setup can fail. Cleanup errors fail the test.
export function ownedTemp(t, prefix) {
  if (!t || typeof t.after !== 'function' || !/^[a-z0-9-]+-$/.test(prefix)) throw new Error('TEST_TEMP_ARGUMENT');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    if ((cleanupGuards.get(t) ?? []).some(guard => guard() !== true)) {
      t.diagnostic?.(`Retained test-owned fixture because child drain is uncertain: ${root}`);
      throw new Error('TEST_CLEANUP_QUARANTINED');
    }
    fs.rmSync(root, {recursive:true, force:true});
  });
  return fs.realpathSync(root);
}
