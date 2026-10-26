// Child-only controlled race. Parent owns fixture and imposes a 10-second kill
// deadline: removing O_NONBLOCK must fail, not hang the overall test harness.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { inspectPairedTrialEventStoreV1 } from '../../history/paired-trial-event-store-v1.mjs';
assert.equal(process.argv.length, 3);
const directory = process.argv[2], file = path.join(directory, 'events.jsonl');
assert(path.isAbsolute(directory)); assert(fs.lstatSync(file).isFile());
fs.copyFileSync(file, path.join(directory, 'expected-original.jsonl'), fs.constants.COPYFILE_EXCL);
const original = fs.openSync;
let opens = 0, nonblocking = false;
fs.openSync = function (name, flags, ...rest) {
  if (name === file) {
    opens++; nonblocking = (flags & fs.constants.O_NONBLOCK) !== 0;
    fs.renameSync(file, path.join(directory, 'retained-original.jsonl'));
    execFileSync('/usr/bin/mkfifo', ['-m', '600', file], { timeout: 2000, stdio: 'pipe' });
  }
  return original.call(fs, name, flags, ...rest);
};
try {
  const result = inspectPairedTrialEventStoreV1({ directory });
  console.log(JSON.stringify({ status: result.status, opens, nonblocking }));
} finally { fs.openSync = original; }
