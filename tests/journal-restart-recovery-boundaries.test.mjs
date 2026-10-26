// Codex-owned supplemental checks; original packet oracles remain unchanged.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRecoveryRequest } from '../history/recovery-worker.mjs';
const scratch = fileURLToPath(new URL('../.scratch/', import.meta.url));
fs.mkdirSync(scratch, { recursive: true });
// Product-suite addition: owned temp directories are removed after the run.
const made = [];
function area() { const d = fs.mkdtempSync(join(scratch, 'owner-boundary-')); made.push(d); return d; }
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const inspect = path => ({ command: 'inspect', path, projectId: 'recovery-a', now: 100 });
function refused(r) { assert.equal(r.status, 'REFUSED'); assert.equal(r.reason, 'INVALID_INPUT'); assert.deepEqual(r.rows, []); assert.equal(r.store, null); }
test('inherited command name is not a valid command or an I/O error', () => {
  refused(runRecoveryRequest({ command: 'constructor' }));
});
test('array-coerced command must not enter the inspect/replay route', () => {
  refused(runRecoveryRequest({ ...inspect(join(area(), 'journal.jsonl')), command: ['inspect'] }));
});
test('scratch root itself and missing parent are refused without creating a file', () => {
  const rootTarget = join(scratch, 'journal.jsonl');
  refused(runRecoveryRequest(inspect(rootTarget)));
  const parent = join(area(), 'missing');
  refused(runRecoveryRequest(inspect(join(parent, 'journal.jsonl'))));
  assert.equal(fs.existsSync(parent), false);
});
test('symbolic-link target and directory target are refused without changing bytes', () => {
  const dir = area(), real = join(dir, 'owned-data'), target = join(dir, 'journal.jsonl');
  fs.writeFileSync(real, 'owned synthetic bytes');
  fs.symlinkSync(real, target);
  refused(runRecoveryRequest(inspect(target)));
  assert.equal(fs.readFileSync(real, 'utf8'), 'owned synthetic bytes');
  const directory = join(area(), 'journal.jsonl'); fs.mkdirSync(directory);
  refused(runRecoveryRequest(inspect(directory)));
});
test('outside scratch and relative paths are refused without store access', () => {
  refused(runRecoveryRequest(inspect(fileURLToPath(new URL('../journal.jsonl', import.meta.url)))));
  refused(runRecoveryRequest(inspect('journal.jsonl')));
  refused(runRecoveryRequest(inspect(join(area(), 'journal.jsonl') + '\0')));
});
