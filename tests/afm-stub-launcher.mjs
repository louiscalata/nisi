// Windows cannot execute the extensionless, shebang-based probe fixtures used
// by these contract tests. Launch only explicitly registered fixtures through
// Node there. The executor still verifies the fixture's bytes and requests its
// exact path with no arguments and no shell. Real native-helper launch remains
// a macOS-only gate.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const fixtures = new Set();
const redirected = new Map();
const passedThrough = new Map();
const contractViolations = [];
let originalSpawn = null;

export function registerAFMStub(file) {
  if (process.platform !== 'win32') return;
  fixtures.add(file);
  if (originalSpawn) return;

  originalSpawn = childProcess.spawn;
  childProcess.spawn = (command, args, options) => {
    if (!fixtures.has(command)) {
      passedThrough.set(command, (passedThrough.get(command) ?? 0) + 1);
      return originalSpawn(command, args, options);
    }
    // The executor catches synchronous spawn errors and turns them into a
    // refusal. Record a broken launch contract here so test.after can fail the
    // file even if an individual refusal assertion would otherwise pass.
    if (!Array.isArray(args) || args.length !== 0) contractViolations.push(`nonempty arguments: ${command}`);
    if ((options?.shell ?? false) !== false) contractViolations.push(`shell enabled: ${command}`);
    redirected.set(command, (redirected.get(command) ?? 0) + 1);
    return originalSpawn(process.execPath, [command], options);
  };
  syncBuiltinESMExports();
}

export function afmStubLaunches(file) {
  return Object.freeze({ redirected: redirected.get(file) ?? 0, passedThrough: passedThrough.get(file) ?? 0 });
}

export function restoreAFMStubLauncher() {
  fixtures.clear();
  if (originalSpawn) {
    childProcess.spawn = originalSpawn;
    originalSpawn = null;
    syncBuiltinESMExports();
  }
  redirected.clear();
  passedThrough.clear();
  assert.deepEqual(contractViolations.splice(0), [], 'AFM stub launcher observed a broken spawn contract');
}
