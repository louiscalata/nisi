import { openJournalBundle, recordFixedRun } from '../history/host-journal-bundle.mjs';
import * as fs from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scratch = join(dirname(dirname(fileURLToPath(import.meta.url))), '.scratch');
const inspectKeys = ['command', 'path', 'config', 'now'];
const recordKeys = [...inspectKeys, 'run'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validRequest(input) {
  if (!object(input) || !['inspect', 'record'].includes(input.command)) return false;
  const expected = input.command === 'inspect' ? inspectKeys : recordKeys;
  const actual = Reflect.ownKeys(input);
  if (actual.length !== expected.length || !expected.every(key => actual.includes(key))) return false;
  if (!object(input.config) || (input.command === 'record' && !object(input.run))) return false;
  if (!Number.isSafeInteger(input.now) || input.now < 0 || Object.is(input.now, -0)) return false;

  const path = input.path;
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0')
    || !isAbsolute(path) || path !== normalize(path) || path.endsWith(sep) || basename(path) !== 'journal.jsonl') return false;

  const parent = dirname(path);
  if (!fs.lstatSync(parent).isDirectory()) return false;
  const owned = fs.realpathSync.native(scratch);
  const resolvedParent = fs.realpathSync.native(parent);
  const within = relative(owned, resolvedParent);
  if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) return false;

  // A missing target is allowed; other boundary errors are refused by the caller.
  const target = fs.lstatSync(path, { throwIfNoEntry: false });
  return target === undefined || (target.isFile() && !target.isSymbolicLink());
}

function plainBundle(bundle) {
  return JSON.parse(JSON.stringify({
    status: bundle.status,
    recovery: bundle.recovery,
    sha256: bundle.sha256,
    bytes: bundle.bytes,
    entries: bundle.entries.map(row => ({
      entry: row.entry,
      historical: row.historical,
      retained: row.retained,
      revoked: row.revoked,
      expired: row.expired,
      liveness: row.liveness,
      authorizing: row.authorizing
    })),
    interrupted: bundle.interrupted,
    authorizing: false
  }));
}

function response(status, reason = null, bundle = null, record = null) {
  const disk = record?.status === 'RECORDED' ? record : bundle;
  return {
    status,
    reason,
    bundle: bundle === null ? null : plainBundle(bundle),
    record,
    sha256: disk?.sha256 ?? null,
    bytes: disk?.bytes ?? 0,
    pid: process.pid,
    authorizing: false,
    isolationAccepted: false,
    generatedCodeExecuted: false
  };
}

export function runBundleDemoRequest(input) {
  try {
    if (!validRequest(input)) return response('REFUSED', 'INVALID_INPUT');
    const { path, config, now } = input;
    const bundle = openJournalBundle({ path, fs, config, now });
    if (bundle.status === 'REFUSED') return response('REFUSED', bundle.reason);
    if (input.command === 'inspect') return response('INSPECTED', null, bundle);

    const record = recordFixedRun({ bundle, run: input.run, now });
    return response(record.status, record.status === 'REFUSED' ? record.reason : null, bundle, record);
  } catch {
    return response('REFUSED', 'INVALID_INPUT');
  }
}
