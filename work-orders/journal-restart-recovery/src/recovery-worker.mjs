// src/recovery-worker.mjs — Nisi real-process journal restart recovery adapter.
// Synchronous, never throws for ordinary JSON input or represented fs/journal errors.
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunJournal, reopen } from '../frozen/run-journal-v1.mjs';
import { writeSerializedJournal, readSerializedJournal } from '../frozen/run-journal-store-v1.mjs';

const SCRATCH_ROOT = fileURLToPath(new URL('../.scratch/', import.meta.url));
const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const TARGET_NAME = 'journal.jsonl';
const KEYS = {
  write: ['command', 'path', 'config', 'entries', 'now'],
  inspect: ['command', 'path', 'projectId', 'now'],
  replay: ['command', 'path', 'projectId', 'entry', 'now'],
};

function result(status, reason, extra = {}) {
  return {
    status,
    reason: reason ?? null,
    store: extra.store ?? null,
    recovery: extra.recovery ?? null,
    rows: Array.isArray(extra.rows) ? extra.rows : [],
    append: Array.isArray(extra.append) ? extra.append : [],
    sha256: extra.sha256 ?? null,
    bytes: extra.bytes ?? null,
    authorizing: false,
    isolationAccepted: false,
    generatedCodeExecuted: false,
  };
}

const refuse = (reason, extra) => result('REFUSED', reason, extra);
const errCode = (err, fallback) => (err && typeof err.code === 'string' && err.code ? err.code : fallback);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function hasExactKeys(obj, keys) {
  const own = Object.keys(obj);
  if (own.length !== keys.length) return false;
  return keys.every((k) => Object.prototype.hasOwnProperty.call(obj, k));
}

function validNow(now) {
  return typeof now === 'number' && Number.isSafeInteger(now) && now >= 0 && !Object.is(now, -0);
}

// Validates the request path per request; returns { ok, path } or { ok:false }.
function resolveTargetPath(requested) {
  if (typeof requested !== 'string' || requested.length === 0) return { ok: false };
  if (requested.includes('\0') || !path.isAbsolute(requested)) return { ok: false };
  if (path.basename(requested) !== TARGET_NAME) return { ok: false };
  let rootReal;
  try {
    rootReal = fs.realpathSync(SCRATCH_ROOT);
  } catch {
    return { ok: false };
  }
  let parentReal;
  try {
    parentReal = fs.realpathSync(path.dirname(requested));
  } catch {
    return { ok: false };
  }
  const rel = path.relative(rootReal, parentReal);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return { ok: false };
  const target = path.join(parentReal, TARGET_NAME);
  try {
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink() || !st.isFile()) return { ok: false };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, path: target };
    return { ok: false };
  }
  return { ok: true, path: target };
}

function validateCommon(input) {
  if (!isPlainObject(input)) return null;
  if (typeof input.command !== 'string' || !Object.hasOwn(KEYS, input.command)) return null;
  const keys = KEYS[input.command];
  if (!keys || !hasExactKeys(input, keys)) return null;
  if (!validNow(input.now)) return null;
  if (input.command !== 'write' && (typeof input.projectId !== 'string' || !PROJECT_ID_RE.test(input.projectId))) return null;
  const target = resolveTargetPath(input.path);
  if (!target.ok) return null;
  return target.path;
}

function runWrite(input, target) {
  if (!isPlainObject(input.config)) return refuse('INVALID_INPUT');
  if (!Array.isArray(input.entries) || input.entries.length > 100) return refuse('INVALID_INPUT');
  let journal;
  try {
    journal = createRunJournal(input.config);
  } catch (err) {
    return refuse(errCode(err, 'CONFIG'));
  }
  const append = [];
  try {
    for (const entry of input.entries) {
      const r = journal.append(entry, input.now);
      append.push(r);
      if (!r || r.status !== 'APPENDED') return refuse((r && (r.reason || r.status)) || 'APPEND_FAILED');
    }
  } catch (err) {
    return refuse(errCode(err, 'ENTRY'));
  }
  const serialized = journal.serialize();
  const store = writeSerializedJournal({ path: target, serialized, fs });
  if (!store || (store.status !== 'WRITTEN' && store.status !== 'UNCHANGED')) {
    return refuse((store && store.reason) || 'WRITE_FAILED', { store: store ?? null });
  }
  let rows;
  try {
    rows = journal.list(input.now);
  } catch (err) {
    return refuse(errCode(err, 'TIME'), { store });
  }
  return result(store.status, null, { store, rows, append, sha256: store.sha256 ?? null, bytes: store.bytes ?? null });
}

// Shared read/decode/project/semantic path for inspect and replay.
function recover(input, target) {
  const store = readSerializedJournal({ path: target, fs });
  let serialized;
  if (store && store.status === 'READ') {
    serialized = store.serialized;
  } else if (store && store.status === 'REFUSED' && store.reason === 'INVALID_JOURNAL') {
    let buffer;
    try {
      buffer = fs.readFileSync(target);
    } catch {
      return { done: refuse('READ_FAILED', { store }) };
    }
    const text = buffer.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(buffer)) {
      const recovery = { status: 'INVALID', recoveredIds: [], rejectedLine: 1, reason: 'UTF8', authorizing: false };
      return { done: result('SEALED', 'INVALID_UTF8', { store, recovery }) };
    }
    serialized = text;
  } else {
    return { done: refuse((store && store.reason) || 'READ_FAILED', { store: store ?? null }) };
  }
  let reopened;
  try {
    reopened = reopen(serialized);
  } catch (err) {
    return { done: refuse(errCode(err, 'IO_ERROR'), { store }) };
  }
  const journal = reopened ? reopened.journal : null;
  const report = reopened ? reopened.report : null;
  if (journal) {
    let headerProjectId;
    try {
      const header = JSON.parse(serialized.split('\n')[0]);
      headerProjectId = header && header.config ? header.config.projectId : undefined;
    } catch {
      headerProjectId = undefined;
    }
    if (headerProjectId !== input.projectId) return { done: refuse('PROJECT_MISMATCH', { store }) };
  }
  let rows = [];
  if (journal) {
    try {
      rows = journal.list(input.now);
    } catch (err) {
      return { done: refuse(errCode(err, 'TIME'), { store }) };
    }
  }
  const fromRead = store.status === 'READ';
  const extra = {
    store,
    recovery: report,
    rows,
    sha256: fromRead ? store.sha256 ?? null : null,
    bytes: fromRead ? store.bytes ?? null : null,
  };
  const complete = report && report.status === 'COMPLETE';
  const res = complete
    ? result('OPEN', null, extra)
    : result('SEALED', (report && report.reason) || (report ? report.status : 'INVALID'), extra);
  return { done: res, journal, extra };
}

function runInspect(input, target) {
  return recover(input, target).done;
}

function runReplay(input, target) {
  const { done, journal, extra } = recover(input, target);
  if (done.status === 'REFUSED') return done;
  if (done.status !== 'OPEN' || !journal) {
    return refuse('SEALED', { store: done.store, recovery: done.recovery });
  }
  const keep = { store: extra.store, recovery: extra.recovery, sha256: extra.sha256, bytes: extra.bytes };
  let r;
  try {
    r = journal.append(input.entry, input.now);
  } catch (err) {
    return refuse(errCode(err, 'IO_ERROR'), keep);
  }
  if (r && (r.status === 'DUPLICATE' || r.status === 'CONFLICT')) {
    let rows;
    try {
      rows = journal.list(input.now);
    } catch (err) {
      return refuse(errCode(err, 'TIME'), keep);
    }
    return result(r.status, r.reason ?? null, { ...keep, rows, append: [r] });
  }
  return refuse('UNEXPECTED_APPEND', keep);
}

export function runRecoveryRequest(input) {
  try {
    const target = validateCommon(input);
    if (!target) return refuse('INVALID_INPUT');
    if (input.command === 'write') return runWrite(input, target);
    if (input.command === 'inspect') return runInspect(input, target);
    return runReplay(input, target);
  } catch (err) {
    return refuse(errCode(err, 'IO_ERROR'));
  }
}

export default runRecoveryRequest;
