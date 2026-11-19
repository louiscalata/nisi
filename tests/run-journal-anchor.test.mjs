// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// The 20 tests of section 9 of docs/design/journal-anchor.md. Temp directories only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as realFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAnchorWithPaths, loadWindowsAnchor, windowsFixture } from './helpers/anchor-win32-fs.mjs';
import { createRunJournal, reopen } from '../history/run-journal-v1.mjs';
import { readSerializedJournal, writeSerializedJournal } from '../history/run-journal-store-v1.mjs';
import {
  ANCHOR_SCHEMA, MAX_ANCHOR_BYTES, RENAME_ATTEMPTS, RENAME_RETRY_DELAYS_MS,
  adoptJournal, anchorFileName, describeJournal, reanchorJournal, verifyAnchoredJournal, writeAnchoredJournal,
} from '../history/run-journal-anchor-v1.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
    : JSON.stringify(value);

const config = patch => ({ projectId: 'project-a', maxEntries: 8, heartbeatTtlMs: 10, redactPaths: [], ...patch });
const entry = (id, patch) => ({
  id, projectId: 'project-a', runId: 'run-a', attempt: 0, candidateId: 'candidate-a', stage: 'test', receiptId: 'receipt-a',
  createdAt: 100, ttlMs: 1000, state: 'SUCCEEDED', heartbeatAt: null, retryOf: null, revokes: null,
  payload: { note: 'safe-note' }, ...patch,
});

// Serialized journal with the given ids, all appended at one clock value.
function build(ids, { cfg, now = 100, patch } = {}) {
  const journal = createRunJournal(config(cfg));
  for (const id of ids) assert.equal(journal.append(entry(id, patch), now).status, 'APPENDED');
  return journal.serialize(now);
}

// Rewrites rows and rebuilds every hash, the way an attacker with the format can.
function rebuild(serialized, edit, { keepFingerprints = false } = {}) {
  const lines = serialized.trimEnd().split('\n').map(line => JSON.parse(line));
  const header = lines[0];
  const rows = lines.slice(1, -1).map(line => line.record);
  edit(rows, header);
  let previous = hash('nisi-run-journal/header/v1\n' + canonical(header));
  const out = [canonical(header)];
  rows.forEach((record, index) => {
    if (!keepFingerprints) record.fingerprint = hash('nisi-run-journal/input/v1\n' + canonical(record.entry));
    const body = { seq: index + 1, previousHash: previous, record };
    previous = hash('nisi-run-journal/record/v1\n' + canonical(body));
    out.push(canonical({ type: 'entry', ...body, hash: previous }));
  });
  out.push(canonical({ type: 'footer', count: rows.length, lastHash: previous }));
  return out.join('\n') + '\n';
}

const NAMES = ['lstatSync', 'openSync', 'fstatSync', 'readSync', 'writeSync', 'fsyncSync', 'closeSync', 'readFileSync', 'renameSync', 'unlinkSync', 'realpathSync', 'readlinkSync'];
function makeFs(hooks = {}) {
  const fs = { constants: realFs.constants };
  const descriptors = new Map();
  for (const name of NAMES) {
    fs[name] = (...args) => {
      const event = { name, args, descriptor: descriptors.get(args[0]) };
      const invoke = () => realFs[name](...args);
      const value = hooks[name] ? hooks[name](event, invoke) : invoke();
      if (name === 'openSync') descriptors.set(value, { path: args[0], flags: args[1] });
      if (name === 'closeSync') descriptors.delete(args[0]);
      return value;
    };
  }
  return fs;
}

// After the Nth rename lands, every later call fails: the process is gone.
function crashingFs(crashAfterRenames) {
  let renames = 0;
  let dead = false;
  const fs = { constants: realFs.constants };
  for (const name of NAMES) {
    fs[name] = (...args) => {
      if (dead) throw Object.assign(new Error('process gone'), { code: 'EIO' });
      const value = realFs[name](...args);
      if (name === 'renameSync' && ++renames === crashAfterRenames) dead = true;
      return value;
    };
  }
  return fs;
}

function fixture(t, hooks, key = 'host-journal-key') {
  const root = realFs.mkdtempSync(join(tmpdir(), 'nisi-anchor-'));
  t.after(() => realFs.rmSync(root, { recursive: true, force: true }));
  const journalDir = join(root, 'journal');
  const anchorDir = join(root, 'anchor');
  realFs.mkdirSync(journalDir);
  realFs.mkdirSync(anchorDir);
  const journalPath = join(journalDir, 'journal.jsonl');
  return {
    root, journalDir, anchorDir, journalPath, key,
    anchorPath: join(anchorDir, anchorFileName(key)),
    ctx: { journalPath, anchorDir, key, fs: makeFs(hooks) },
  };
}
const put = (f, serialized, extra = {}) => writeAnchoredJournal({ ...f.ctx, serialized, ...extra });
const check = (f, extra = {}) => verifyAnchoredJournal({ ...f.ctx, ...extra });
const anchorOf = f => JSON.parse(realFs.readFileSync(f.anchorPath, 'utf8'));
const journalText = f => realFs.readFileSync(f.journalPath, 'utf8');
const overwrite = (f, serialized) => realFs.writeFileSync(f.journalPath, serialized);

function wrote(result) {
  assert.equal(result.status, 'WRITTEN', JSON.stringify(result));
  assert.equal(result.committed, true);
  return result;
}
function verdict(result, status) {
  assert.equal(result.status, status, JSON.stringify(result));
  assert.equal(result.ok, status === 'OK' || status === 'OK_PENDING');
  return result;
}

// Two entries (older) and three entries (current) of one journal at one clock value.
function twoStates() {
  const journal = createRunJournal(config());
  for (const id of ['entry-a', 'entry-b']) journal.append(entry(id), 100);
  const older = journal.serialize(100);
  journal.append(entry('entry-c'), 100);
  return { older, current: journal.serialize(100) };
}

const eio = () => Object.assign(new Error('refused'), { code: 'EIO' });
const isTemp = (f, path) => String(path).startsWith(f.anchorPath + '.') && String(path).endsWith('.tmp');
const writeCanonical = (f, document) => realFs.writeFileSync(f.anchorPath, canonical(document) + '\n');

// The journal of `current` is in place and the promotion of its anchor failed, so the anchor
// holds current = older and pending = current (OK_PENDING). Fresh fs objects follow the setup.
function pendingFixture(t) {
  const { older, current } = twoStates();
  let renames = 0;
  const f = fixture(t, { renameSync: (event, invoke) => { if (event.args[1] === f.anchorPath && ++renames === 4) throw eio(); return invoke(); } });
  wrote(put(f, older));
  const half = put(f, current);
  assert.equal(half.reason, 'ANCHOR_WRITE_FAILED', JSON.stringify(half));
  assert.equal(half.committed, true);
  assert.equal(half.durable, false);
  verdict(check(f), 'OK_PENDING');
  return { f, older, current };
}
const withFs = (f, hooks) => ({ ...f.ctx, fs: makeFs(hooks) });

test('01 rollback to an older complete copy is ROLLED_BACK and the store alone still reads it', t => {
  const f = fixture(t);
  const { older, current } = twoStates();
  wrote(put(f, older));
  wrote(put(f, current));
  verdict(check(f), 'OK');
  const replaced = writeSerializedJournal({ path: f.journalPath, serialized: older, fs: realFs, expectedPreviousSha256: hash(current) });
  assert.equal(replaced.status, 'WRITTEN');
  const read = readSerializedJournal({ path: f.journalPath, fs: realFs });
  assert.equal(read.status, 'READ');
  assert.equal(read.verified, true);
  const result = verdict(check(f), 'ROLLED_BACK');
  assert.equal(result.anchorCount, 3);
  assert.equal(result.journalCount, 2);
});

test('02 truncate and re-footer is ROLLED_BACK, and without an anchor nothing detects it', t => {
  const f = fixture(t);
  const { older, current } = twoStates();
  wrote(put(f, older));
  wrote(put(f, current));
  const lines = current.slice(0, -1).split('\n');
  const dropped = JSON.parse(lines[3]);
  const rolledBack = lines.slice(0, 3).join('\n') + '\n' + canonical({ type: 'footer', count: 2, lastHash: dropped.previousHash }) + '\n';
  overwrite(f, rolledBack);
  assert.equal(reopen(rolledBack).report.status, 'COMPLETE');
  assert.equal(readSerializedJournal({ path: f.journalPath, fs: realFs }).verified, true);
  verdict(check(f), 'ROLLED_BACK');
  // A host that holds no anchor for this key sees a file that reads as fine and is labelled unanchored.
  verdict(check(f, { key: 'another-key', policy: 'unanchored-ok' }), 'UNANCHORED');
});

test('03 the store replays an older copy; the anchored writer refuses it and changes nothing', t => {
  const f = fixture(t);
  const { older, current } = twoStates();
  wrote(put(f, older));
  wrote(put(f, current));
  const journalBefore = journalText(f);
  const anchorBefore = realFs.readFileSync(f.anchorPath, 'utf8');
  const plain = join(f.journalDir, 'plain.jsonl');
  realFs.writeFileSync(plain, current);
  assert.equal(writeSerializedJournal({ path: plain, serialized: older, fs: realFs, expectedPreviousSha256: hash(current) }).status, 'WRITTEN');
  const refused = put(f, older);
  assert.equal(refused.status, 'REFUSED');
  assert.equal(refused.reason, 'NOT_EXTENSION');
  assert.equal(journalText(f), journalBefore);
  assert.equal(realFs.readFileSync(f.anchorPath, 'utf8'), anchorBefore);
  assert.deepEqual(realFs.readdirSync(f.anchorDir), [anchorFileName(f.key)]);
  // A retired row cannot be made retained again, even with every hash recomputed.
  const g = fixture(t);
  const retired = build(['entry-a', 'entry-b'], { cfg: { maxEntries: 1 } });
  wrote(put(g, retired));
  const swapped = rebuild(retired, rows => {
    rows[0].retained = true; rows[0].entry.payload = { note: 'brought back' };
    rows[1].retained = false; rows[1].entry.payload = null;
  });
  assert.equal(reopen(swapped).report.status, 'COMPLETE');
  assert.equal(describeJournal(swapped).stemTip, describeJournal(retired).stemTip);
  assert.equal(put(g, swapped).reason, 'NOT_EXTENSION');
  const rewrittenRetired = rebuild(retired, rows => { rows[0].entry.state = 'CANCELLED'; });
  assert.equal(reopen(rewrittenRetired).report.status, 'COMPLETE');
  assert.equal(put(g, rewrittenRetired).reason, 'NOT_EXTENSION');
  assert.equal(journalText(g), retired);
});

test('04 delete and start again is ROLLED_BACK against an anchor of count 3', t => {
  const f = fixture(t);
  wrote(put(f, build(['entry-a', 'entry-b', 'entry-c'])));
  realFs.unlinkSync(f.journalPath);
  const missing = verdict(check(f), 'JOURNAL_NOT_COMPLETE');
  assert.equal(missing.cause, 'NOT_FOUND');
  const fresh = createRunJournal(config()).serialize(100);
  assert.equal(writeSerializedJournal({ path: f.journalPath, serialized: fresh, fs: realFs }).status, 'WRITTEN');
  assert.equal(reopen(fresh).report.status, 'COMPLETE');
  const result = verdict(check(f), 'ROLLED_BACK');
  assert.equal(result.anchorCount, 3);
  assert.equal(result.journalCount, 0);
  // The anchored writer will not start the same key again over a count-3 anchor either.
  realFs.unlinkSync(f.journalPath);
  assert.equal(put(f, fresh).reason, 'JOURNAL_NOT_COMPLETE');
});

test('05 a full rewrite with every hash recomputed is DIVERGED (F2)', t => {
  const f = fixture(t);
  const original = build(['entry-a', 'entry-b', 'entry-c']);
  wrote(put(f, original));
  const forged = rebuild(original, rows => { rows[2].entry.state = 'CANCELLED'; rows[2].entry.payload = { note: 'forged' }; });
  assert.notEqual(forged, original);
  overwrite(f, forged);
  assert.equal(reopen(forged).report.status, 'COMPLETE');
  verdict(check(f), 'DIVERGED');
});

test('06 a payload-only rewrite keeps the stems and is CONTENT_DIFFERS', t => {
  const f = fixture(t);
  const original = build(['entry-a', 'entry-b', 'entry-c']);
  wrote(put(f, original));
  const forged = rebuild(original, rows => { rows[1].entry.payload = { note: 'forged' }; });
  overwrite(f, forged);
  assert.equal(reopen(forged).report.status, 'COMPLETE');
  assert.equal(describeJournal(forged).stemTip, describeJournal(original).stemTip);
  assert.notEqual(describeJournal(forged).fileSha256, describeJournal(original).fileSha256);
  verdict(check(f), 'CONTENT_DIFFERS');
  // The anchored writer refuses the same rewrite from a host that is handed it.
  const g = fixture(t);
  wrote(put(g, original));
  assert.equal(put(g, forged).reason, 'NOT_EXTENSION');
  assert.equal(journalText(g), original);
});

test('07 a missing anchor is never OK, and the default policy is require', t => {
  const f = fixture(t);
  const serialized = build(['entry-a', 'entry-b']);
  assert.equal(writeSerializedJournal({ path: f.journalPath, serialized, fs: realFs }).status, 'WRITTEN');
  verdict(check(f), 'ANCHOR_MISSING');
  verdict(check(f, { policy: 'require' }), 'ANCHOR_MISSING');
  verdict(check(f, { policy: 'unanchored-ok' }), 'UNANCHORED');
  assert.equal(check(f, { policy: 'maybe' }).status, 'INVALID_INPUT');
  // An unanchored journal is not extended by the anchored writer: it must be adopted first.
  const refused = put(f, build(['entry-a', 'entry-b', 'entry-c']));
  assert.equal(refused.status, 'REFUSED');
  assert.equal(refused.reason, 'ANCHOR_MISSING');
  // An anchor deleted after use is ANCHOR_MISSING under require.
  const g = fixture(t);
  wrote(put(g, serialized));
  verdict(check(g), 'OK');
  realFs.unlinkSync(g.anchorPath);
  verdict(check(g), 'ANCHOR_MISSING');
  verdict(check(g, { policy: 'unanchored-ok' }), 'UNANCHORED');
});

test('08 an anchor ahead of the journal is ROLLED_BACK; unrelated entries of the same project are DIVERGED', t => {
  const f = fixture(t);
  const { older, current } = twoStates();
  wrote(put(f, current));
  overwrite(f, older);
  verdict(check(f), 'ROLLED_BACK');
  overwrite(f, build(['other-1', 'other-2', 'other-3', 'other-4']));
  verdict(check(f), 'DIVERGED');
});

test('09 a journal ahead of the anchor is AHEAD until an explicit re-anchor', t => {
  const f = fixture(t);
  const { older, current } = twoStates();
  wrote(put(f, older));
  const base = verdict(check(f), 'OK');
  overwrite(f, current);
  const first = verdict(check(f), 'AHEAD');
  assert.equal(first.anchorCount, 2);
  assert.equal(first.journalCount, 3);
  verdict(check(f), 'AHEAD');
  assert.equal(anchorOf(f).current.generation, base.generation);
  // The anchored writer does not extend over an AHEAD journal either.
  assert.equal(put(f, build(['entry-a', 'entry-b', 'entry-c', 'entry-d'])).reason, 'AHEAD');
  assert.equal(reanchorJournal({ ...f.ctx, expectedGeneration: base.generation + 5 }).reason, 'CONFLICT');
  verdict(check(f), 'AHEAD');
  const done = reanchorJournal({ ...f.ctx, expectedGeneration: base.generation });
  assert.equal(done.status, 'REANCHORED', JSON.stringify(done));
  assert.equal(done.generation, base.generation + 1);
  const after = verdict(check(f), 'OK');
  assert.equal(after.generation, base.generation + 1);
  assert.equal(anchorOf(f).pending, null);
  // Nothing else may be re-anchored: an OK or a rolled-back journal is refused.
  assert.equal(reanchorJournal(f.ctx).reason, 'NOT_AHEAD');
  overwrite(f, older);
  verdict(check(f), 'ROLLED_BACK');
  assert.equal(reanchorJournal(f.ctx).reason, 'NOT_AHEAD');

  // A rewritten payload at the same count is CONTENT_DIFFERS, not AHEAD: the re-anchor refuses it. No anchor is ANCHOR_MISSING.
  const c = fixture(t);
  assert.equal(reanchorJournal(c.ctx).reason, 'ANCHOR_MISSING');
  wrote(put(c, older));
  const anchorC = realFs.readFileSync(c.anchorPath, 'utf8');
  overwrite(c, rebuild(older, rows => { rows[1].entry.payload = { note: 'forged' }; }));
  verdict(check(c), 'CONTENT_DIFFERS');
  const notAhead = reanchorJournal(c.ctx);
  assert.equal(notAhead.status, 'REFUSED');
  assert.equal(notAhead.reason, 'NOT_AHEAD');
  assert.equal(notAhead.observed, 'CONTENT_DIFFERS');
  assert.equal(realFs.readFileSync(c.anchorPath, 'utf8'), anchorC);

  // The limit that AHEAD does not remove (docs, F2): a rewritten payload plus one appended entry is AHEAD,
  // and a re-anchor accepts the rewritten payload as it is.
  const d = fixture(t);
  wrote(put(d, older));
  overwrite(d, rebuild(current, rows => { rows[1].entry.payload = { note: 'forged' }; }));
  verdict(check(d), 'AHEAD');
  assert.equal(reanchorJournal(d.ctx).status, 'REANCHORED');
  verdict(check(d), 'OK');
  assert.ok(journalText(d).includes('forged'));

  // A rival that writes the anchor while the temp file is read back wins: CONFLICT, and its bytes stay.
  const rivalText = 'rival\n';
  let adoptRival = false;
  const e = fixture(t, {
    readFileSync: (event, invoke) => { if (isTemp(e, event.args[0]) && !adoptRival) { adoptRival = true; realFs.writeFileSync(e.anchorPath, rivalText); } return invoke(); },
  });
  overwrite(e, older);
  const lostAdopt = adoptJournal(e.ctx);
  assert.equal(lostAdopt.reason, 'CONFLICT', JSON.stringify(lostAdopt));
  assert.equal(adoptRival, true);
  assert.equal(realFs.readFileSync(e.anchorPath, 'utf8'), rivalText);
  assert.deepEqual(realFs.readdirSync(e.anchorDir), [anchorFileName(e.key)]);
  let reanchorRival = false;
  const g = fixture(t, {
    readFileSync: (event, invoke) => { if (reanchorRival && isTemp(g, event.args[0])) { reanchorRival = false; realFs.writeFileSync(g.anchorPath, rivalText); } return invoke(); },
  });
  wrote(writeAnchoredJournal({ ...g.ctx, fs: makeFs(), serialized: older }));
  overwrite(g, current);
  verdict(verifyAnchoredJournal({ ...g.ctx, fs: makeFs() }), 'AHEAD');
  reanchorRival = true;
  const lostReanchor = reanchorJournal(g.ctx);
  assert.equal(lostReanchor.reason, 'CONFLICT', JSON.stringify(lostReanchor));
  assert.equal(reanchorRival, false);
  assert.equal(realFs.readFileSync(g.anchorPath, 'utf8'), rivalText);
  assert.deepEqual(realFs.readdirSync(g.anchorDir), [anchorFileName(g.key)]);
  // Re-anchoring a missing or damaged journal refuses without changing its anchor.
  const unreadable = fixture(t);
  wrote(put(unreadable, older));
  const held = realFs.readFileSync(unreadable.anchorPath);
  realFs.unlinkSync(unreadable.journalPath);
  assert.deepEqual(reanchorJournal(unreadable.ctx), { status: 'REFUSED', reason: 'JOURNAL_NOT_COMPLETE', cause: 'NOT_FOUND' });
  overwrite(unreadable, 'damaged\n');
  assert.deepEqual(reanchorJournal(unreadable.ctx), { status: 'REFUSED', reason: 'JOURNAL_NOT_COMPLETE', cause: 'INVALID_JOURNAL' });
  assert.deepEqual(realFs.readFileSync(unreadable.anchorPath), held);

  // The last safe increment is allowed for both a normal write and an explicit re-anchor.
  for (const action of ['write', 'reanchor']) {
    const edge = fixture(t);
    wrote(put(edge, older));
    const document = anchorOf(edge);
    document.current.generation = Number.MAX_SAFE_INTEGER - 1;
    writeCanonical(edge, document);
    let result;
    if (action === 'write') result = wrote(put(edge, current));
    else { overwrite(edge, current); result = reanchorJournal(edge.ctx); assert.equal(result.status, 'REANCHORED'); }
    assert.equal(result.generation, Number.MAX_SAFE_INTEGER);
    assert.equal(anchorOf(edge).current.generation, Number.MAX_SAFE_INTEGER);
    assert.equal(anchorOf(edge).pending, null);
    verdict(check(edge), 'OK');
  }

});

test('10 crash windows end as OK or OK_PENDING, and the next write settles', t => {
  const { older, current } = twoStates();
  const next = build(['entry-a', 'entry-b', 'entry-c', 'entry-d']);
  const expected = [['OK'], ['OK_PENDING'], ['OK']];
  for (const [index, [status]] of expected.entries()) {
    const f = fixture(t);
    wrote(put(f, older));
    try { put({ ...f, ctx: { ...f.ctx, fs: crashingFs(index + 1) } }, current); } catch { /* the process is gone */ }
    assert.equal(anchorOf(f).pending !== null, index < 2);
    verdict(check(f), status);
    wrote(put(f, next));
    const settled = anchorOf(f);
    assert.equal(settled.pending, null);
    assert.equal(settled.current.fileSha256, hash(next));
    assert.equal(settled.current.count, 4);
    verdict(check(f), 'OK');
  }
  // A refused store write clears the pending slot.
  let sawPending = false;
  const g = fixture(t, {
    renameSync: (event, invoke) => {
      if (event.args[1] === g.journalPath) {
        sawPending = anchorOf(g).pending !== null;
        throw Object.assign(new Error('rename refused'), { code: 'EIO' });
      }
      return invoke();
    },
  });
  const clean = { ...g.ctx, fs: makeFs() };
  wrote(writeAnchoredJournal({ ...clean, serialized: older }));
  const before = anchorOf(g);
  const refused = put(g, current);
  assert.equal(refused.status, 'REFUSED');
  assert.equal(refused.reason, 'RENAME_FAILED');
  assert.equal(refused.committed, false);
  assert.equal(refused.durable, false);
  assert.equal(refused.cleared, true);
  assert.equal(sawPending, true);
  assert.deepEqual(anchorOf(g), { ...before, pending: null });
  verdict(check(g), 'OK');
  // A committed write that fails its read-back keeps the pending slot.
  let landed = false;
  const q = fixture(t, {
    renameSync: (event, invoke) => { const value = invoke(); if (event.args[1] === q.journalPath) landed = true; return value; },
    readFileSync: (event, invoke) => (landed && event.args[0] === q.journalPath ? Buffer.from('changed') : invoke()),
  });
  wrote(writeAnchoredJournal({ ...q.ctx, fs: makeFs(), serialized: older }));
  const mismatch = put(q, current);
  assert.equal(mismatch.reason, 'READBACK_MISMATCH');
  assert.equal(mismatch.committed, true);
  assert.equal(mismatch.durable, false);
  assert.notEqual(anchorOf(q).pending, null);
  verdict(verifyAnchoredJournal({ ...q.ctx, fs: makeFs() }), 'OK_PENDING');
  // A failed promotion leaves a committed journal that matches the pending slot.
  let anchorRenames = 0;
  const h = fixture(t, {
    renameSync: (event, invoke) => {
      if (event.args[1] === h.anchorPath && ++anchorRenames === 4) throw Object.assign(new Error('rename refused'), { code: 'EIO' });
      return invoke();
    },
  });
  wrote(put(h, older));
  assert.equal(anchorRenames, 2);
  const half = put(h, current);
  assert.equal(half.status, 'REFUSED');
  assert.equal(half.reason, 'ANCHOR_WRITE_FAILED');
  assert.equal(half.committed, true);
  assert.equal(half.durable, false);
  verdict(check(h), 'OK_PENDING');

  // verify of OK_PENDING reports the generation of the anchored state, not the pending one.
  const pendingGeneration = anchorOf(h).pending.generation;
  assert.equal(verdict(check(h), 'OK_PENDING').generation, anchorOf(h).current.generation);
  assert.equal(check(h).generation, pendingGeneration - 1);

  // The promotion of an OK_PENDING anchor (step 1) writes the pending state as the current one.
  const promote = pendingFixture(t);
  const promoted = anchorOf(promote.f);
  let anchorWrites = 0;
  const failNext = withFs(promote.f, { renameSync: (event, invoke) => { if (event.args[1] === promote.f.anchorPath && ++anchorWrites === 2) throw eio(); return invoke(); } });
  const afterPromotion = writeAnchoredJournal({ ...failNext, serialized: next });
  assert.equal(afterPromotion.status, 'REFUSED');
  assert.equal(afterPromotion.reason, 'ANCHOR_WRITE_FAILED');
  assert.deepEqual(anchorOf(promote.f), { current: promoted.pending, pending: null, schema: ANCHOR_SCHEMA });
  verdict(check(promote.f), 'OK');

  // A promotion that cannot be written refuses the write and leaves the anchor as it was.
  const stuck = pendingFixture(t);
  const stuckBytes = realFs.readFileSync(stuck.f.anchorPath, 'utf8');
  let firstOnly = 0;
  const stuckWrite = writeAnchoredJournal({
    ...withFs(stuck.f, { renameSync: (event, invoke) => { if (event.args[1] === stuck.f.anchorPath && ++firstOnly === 1) throw eio(); return invoke(); } }),
    serialized: next,
  });
  assert.equal(stuckWrite.status, 'REFUSED');
  assert.equal(stuckWrite.reason, 'ANCHOR_WRITE_FAILED');
  assert.equal(realFs.readFileSync(stuck.f.anchorPath, 'utf8'), stuckBytes);
  assert.equal(journalText(stuck.f), stuck.current);
  verdict(check(stuck.f), 'OK_PENDING');

  // A rival that rewrites the anchor while the promotion is read back wins.
  const rivalled = pendingFixture(t);
  const rivalText = canonical({ ...anchorOf(rivalled.f), pending: null }) + '\n';
  let rivalWrites = 0;
  const lost = writeAnchoredJournal({
    ...withFs(rivalled.f, { readFileSync: (event, invoke) => { if (isTemp(rivalled.f, event.args[0]) && ++rivalWrites === 1) realFs.writeFileSync(rivalled.f.anchorPath, rivalText); return invoke(); } }),
    serialized: next,
  });
  assert.equal(lost.reason, 'CONFLICT', JSON.stringify(lost));
  assert.equal(rivalWrites, 1);
  assert.equal(realFs.readFileSync(rivalled.f.anchorPath, 'utf8'), rivalText);

  // A directory sync that fails on the promotion makes the whole result not durable.
  const weak = pendingFixture(t);
  let dirSyncs = 0;
  const unsynced = writeAnchoredJournal({
    ...withFs(weak.f, { fsyncSync: (event, invoke) => { if (event.descriptor?.path === weak.f.anchorDir && ++dirSyncs === 1) throw eio(); return invoke(); } }),
    serialized: next,
  });
  assert.equal(unsynced.status, 'WRITTEN', JSON.stringify(unsynced));
  assert.equal(unsynced.durable, false);
  assert.ok(dirSyncs >= 1);

  // The window the docs name (F3): while the pending slot is set, a one-write rollback still verifies OK.
  const window = pendingFixture(t);
  assert.notEqual(anchorOf(window.f).pending, null);
  overwrite(window.f, window.older);
  const rolled = verdict(check(window.f), 'OK');
  assert.equal(rolled.journalCount, 2);
  assert.notEqual(anchorOf(window.f).pending, null);
});

test('11 concurrent writers: a changed generation is CONFLICT and an interleaving is never OK', t => {
  const f = fixture(t);
  const a = build(['entry-a', 'entry-b', 'entry-c']);
  const b = build(['entry-a', 'entry-b', 'entry-d']);
  wrote(put(f, build(['entry-a', 'entry-b'])));
  const generation = check(f).generation;
  wrote(put(f, a, { expectedGeneration: generation }));
  const anchorBefore = realFs.readFileSync(f.anchorPath, 'utf8');
  const lost = put(f, b, { expectedGeneration: generation });
  assert.equal(lost.status, 'REFUSED');
  assert.equal(lost.reason, 'CONFLICT');
  assert.equal(journalText(f), a);
  assert.equal(realFs.readFileSync(f.anchorPath, 'utf8'), anchorBefore);
  verdict(check(f), 'OK');

  // The rival lands between the second writer's read and its rename.
  let armed = false;
  const g = fixture(t, {
    renameSync: (event, invoke) => {
      if (armed && event.args[1] === g.anchorPath) {
        armed = false;
        wrote(writeAnchoredJournal({ ...g.ctx, fs: makeFs(), serialized: a }));
      }
      return invoke();
    },
  });
  wrote(writeAnchoredJournal({ ...g.ctx, fs: makeFs(), serialized: build(['entry-a', 'entry-b']) }));
  armed = true;
  const raced = put(g, b);
  assert.equal(raced.status, 'REFUSED');
  assert.equal(raced.reason, 'CONFLICT');
  assert.equal(journalText(g), a);
  const later = check(g);
  assert.notEqual(later.status, 'OK');
  assert.equal(later.ok, false);
  assert.equal(later.status, 'AHEAD');

  // A change that lands before the anchor's guard is caught, and the second writer renames nothing.
  let early = false;
  const h = fixture(t, {
    openSync: (event, invoke) => {
      if (early && String(event.args[0]).startsWith(h.anchorPath) && event.args[1] === 'wx') {
        early = false;
        wrote(writeAnchoredJournal({ ...h.ctx, fs: makeFs(), serialized: a }));
      }
      return invoke();
    },
  });
  wrote(writeAnchoredJournal({ ...h.ctx, fs: makeFs(), serialized: build(['entry-a', 'entry-b']) }));
  early = true;
  const beaten = put(h, b);
  assert.equal(beaten.reason, 'CONFLICT');
  assert.equal(journalText(h), a);
  verdict(check(h), 'OK');
  assert.deepEqual(realFs.readdirSync(h.anchorDir), [anchorFileName(h.key)]);

  // The anchor changes after the journal landed: the promotion is refused, the journal stays committed.
  const stale = realFs.readFileSync(h.anchorPath, 'utf8');
  let late = false;
  const k = fixture(t, {
    renameSync: (event, invoke) => {
      const value = invoke();
      if (late && event.args[1] === k.journalPath) { late = false; realFs.writeFileSync(k.anchorPath, stale); }
      return value;
    },
  });
  wrote(writeAnchoredJournal({ ...k.ctx, fs: makeFs(), serialized: build(['entry-a', 'entry-b']) }));
  const before = realFs.readFileSync(k.anchorPath, 'utf8');
  late = true;
  const promotion = put(k, a);
  assert.equal(promotion.reason, 'ANCHOR_WRITE_FAILED');
  assert.equal(promotion.committed, true);
  assert.equal(promotion.durable, false);
  assert.equal(realFs.readFileSync(k.anchorPath, 'utf8'), stale);
  assert.notEqual(stale, before);

  // The anchor changes while a refused store write clears its pending slot: it is left alone.
  let meddle = false;
  const m = fixture(t, {
    renameSync: (event, invoke) => {
      if (meddle && event.args[1] === m.journalPath) { meddle = false; realFs.writeFileSync(m.anchorPath, stale); throw Object.assign(new Error('refused'), { code: 'EIO' }); }
      return invoke();
    },
  });
  wrote(writeAnchoredJournal({ ...m.ctx, fs: makeFs(), serialized: build(['entry-a', 'entry-b']) }));
  meddle = true;
  const cleared = put(m, a);
  assert.equal(cleared.reason, 'RENAME_FAILED');
  assert.equal(cleared.cleared, false);
  assert.equal(realFs.readFileSync(m.anchorPath, 'utf8'), stale);

  // The continuity loop reaches every anchored row, the last one and the first one.
  const { older, current } = twoStates();
  for (const row of [0, 1]) {
    const loop = fixture(t);
    wrote(put(loop, older));
    const changed = rebuild(current, rows => { rows[row].entry.payload = { note: 'forged' }; });
    assert.equal(reopen(changed).report.status, 'COMPLETE');
    assert.equal(put(loop, changed).reason, 'NOT_EXTENSION', 'row ' + row);
    assert.equal(journalText(loop), older);
  }

  // A read that straddles a complete anchored write is AHEAD (a false alarm), never OK (docs, F7).
  let straddle = false;
  const s = fixture(t, {
    openSync: (event, invoke) => {
      if (straddle && String(event.args[0]) === s.journalPath) { straddle = false; wrote(writeAnchoredJournal({ ...s.ctx, fs: makeFs(), serialized: current })); }
      return invoke();
    },
  });
  wrote(writeAnchoredJournal({ ...s.ctx, fs: makeFs(), serialized: older }));
  straddle = true;
  const racing = verifyAnchoredJournal(s.ctx);
  assert.equal(straddle, false);
  assert.equal(racing.status, 'AHEAD');
  assert.equal(racing.ok, false);
  verdict(check(s), 'OK');

  // Without an anchor there is no generation to expect.
  const n = fixture(t);
  assert.equal(put(n, a, { expectedGeneration: 1 }).reason, 'CONFLICT');
  assert.equal(realFs.existsSync(n.journalPath), false);
  // A valid rival on the first-write path must not be overwritten by the genesis guard.
  const rival = fixture(t);
  wrote(put(rival, a));
  const rivalBytes = realFs.readFileSync(rival.anchorPath);
  let appeared = false;
  const firstWrite = fixture(t, {
    readFileSync: (event, invoke) => {
      if (!appeared && isTemp(firstWrite, event.args[0])) {
        appeared = true;
        realFs.writeFileSync(firstWrite.anchorPath, rivalBytes);
      }
      return invoke();
    },
  });
  assert.deepEqual(put(firstWrite, a), { status: 'REFUSED', reason: 'CONFLICT' });
  assert.equal(appeared, true);
  assert.equal(realFs.existsSync(firstWrite.journalPath), false);
  assert.deepEqual(realFs.readFileSync(firstWrite.anchorPath), rivalBytes);
  assert.deepEqual(realFs.readdirSync(firstWrite.anchorDir), [anchorFileName(firstWrite.key)]);

  // Another writer may land the exact intended journal after the pending anchor is in place.
  let copied = false;
  const sameWrite = fixture(t, { renameSync: (event, invoke) => {
    const value = invoke();
    if (!copied && event.args[1] === sameWrite.anchorPath) { copied = true; overwrite(sameWrite, a); }
    return value;
  } });
  assert.deepEqual(put(sameWrite, a), { status: 'UNCHANGED', committed: true, durable: false, generation: 2, sha256: hash(a), bytes: Buffer.byteLength(a) });
  verdict(check(sameWrite), 'OK');

});

test('12 legitimate churn stays OK and the stem chain does not change under it', t => {
  const f = fixture(t);
  const journal = createRunJournal(config({ maxEntries: 2 }));
  const seen = [];
  for (let step = 1; step <= 5; step++) {
    const now = 100 * step;
    assert.equal(journal.append(entry('entry-' + step, { createdAt: now }), now).status, 'APPENDED');
    const serialized = journal.serialize(now);
    wrote(put(f, serialized));
    const result = verdict(check(f), 'OK');
    assert.equal(result.generation, step + 1);
    seen.push(describeJournal(serialized));
  }
  const retired = journal.list(500).filter(row => !row.retained).length;
  assert.equal(retired, 3);
  for (let i = 0; i < seen.length; i++) {
    for (let j = i + 1; j < seen.length; j++) {
      assert.deepEqual(seen[j].chain.slice(0, seen[i].count + 1), seen[i].chain, `stem prefix ${i} ${j}`);
      assert.notEqual(seen[j].lastHash, seen[i].lastHash);
    }
  }
  const again = put(f, journal.serialize(500));
  assert.equal(again.status, 'UNCHANGED', JSON.stringify(again));
  assert.equal(again.generation, 6);
  assert.equal(anchorOf(f).current.generation, 6);
  assert.equal(anchorOf(f).pending, null);
  // A later watermark retires every row without adding one: same count, new bytes, still an extension.
  const expired = wrote(put(f, journal.serialize(5000)));
  assert.equal(expired.generation, 7);
  assert.equal(anchorOf(f).current.count, 5);
  verdict(check(f), 'OK');
  // The footer lastHash of an earlier file is not in the later file (the review's wording does not hold).
  assert.ok(!journalText(f).includes(seen[0].lastHash));

  // At the safe-integer ceiling a write is refused before anything changes (F6).
  const { older, current } = twoStates();
  const top = fixture(t);
  wrote(put(top, older));
  const topDocument = anchorOf(top);
  topDocument.current.generation = Number.MAX_SAFE_INTEGER;
  writeCanonical(top, topDocument);
  verdict(check(top), 'OK');
  const topBytes = realFs.readFileSync(top.anchorPath, 'utf8');
  const exhausted = put(top, current);
  assert.equal(exhausted.status, 'REFUSED');
  assert.equal(exhausted.reason, 'GENERATION_EXHAUSTED');
  assert.equal(realFs.readFileSync(top.anchorPath, 'utf8'), topBytes);
  assert.equal(journalText(top), older);
  assert.equal(put(top, older).status, 'UNCHANGED');
  assert.deepEqual(realFs.readdirSync(top.anchorDir), [anchorFileName(top.key)]);
  // The same with a pending slot: the promotion is not written either.
  const pend = pendingFixture(t);
  const pendDocument = anchorOf(pend.f);
  pendDocument.current.generation = Number.MAX_SAFE_INTEGER - 1;
  pendDocument.pending.generation = Number.MAX_SAFE_INTEGER;
  writeCanonical(pend.f, pendDocument);
  verdict(check(pend.f), 'OK_PENDING');
  const pendBytes = realFs.readFileSync(pend.f.anchorPath, 'utf8');
  const pendRefused = put(pend.f, build(['entry-a', 'entry-b', 'entry-c', 'entry-d']));
  assert.equal(pendRefused.reason, 'GENERATION_EXHAUSTED', JSON.stringify(pendRefused));
  assert.equal(realFs.readFileSync(pend.f.anchorPath, 'utf8'), pendBytes);
  // A genesis anchor at the ceiling (a first write that stopped) refuses as well, and no journal appears.
  const gen = fixture(t, { renameSync: (event, invoke) => { if (event.args[1] === gen.journalPath) throw eio(); return invoke(); } });
  assert.equal(put(gen, older).status, 'REFUSED');
  const genDocument = anchorOf(gen);
  assert.equal(genDocument.current.count, 0);
  genDocument.current.generation = Number.MAX_SAFE_INTEGER;
  writeCanonical(gen, genDocument);
  const genBytes = realFs.readFileSync(gen.anchorPath, 'utf8');
  assert.equal(writeAnchoredJournal({ ...gen.ctx, fs: makeFs(), serialized: older }).reason, 'GENERATION_EXHAUSTED');
  assert.equal(realFs.readFileSync(gen.anchorPath, 'utf8'), genBytes);
  assert.equal(realFs.existsSync(gen.journalPath), false);
  // And the re-anchor.
  const ahead = fixture(t);
  wrote(put(ahead, older));
  const aheadDocument = anchorOf(ahead);
  aheadDocument.current.generation = Number.MAX_SAFE_INTEGER;
  writeCanonical(ahead, aheadDocument);
  overwrite(ahead, current);
  verdict(check(ahead), 'AHEAD');
  const aheadBytes = realFs.readFileSync(ahead.anchorPath, 'utf8');
  assert.equal(reanchorJournal(ahead.ctx).reason, 'GENERATION_EXHAUSTED');
  assert.equal(realFs.readFileSync(ahead.anchorPath, 'utf8'), aheadBytes);
});

test('13 another project or another key', t => {
  const f = fixture(t);
  wrote(put(f, build(['entry-a', 'entry-b'])));
  const other = createRunJournal(config({ projectId: 'project-b' }));
  other.append(entry('entry-a', { projectId: 'project-b' }), 100);
  overwrite(f, other.serialize(100));
  verdict(check(f), 'ANCHOR_PROJECT');
  overwrite(f, build(['entry-a', 'entry-b']));
  verdict(check(f), 'OK');
  const refused = put(f, other.serialize(100));
  assert.equal(refused.reason, 'NOT_EXTENSION');
  verdict(check(f, { key: 'a-different-key' }), 'ANCHOR_MISSING');
  assert.notEqual(anchorFileName('a-different-key'), anchorFileName(f.key));
  assert.deepEqual(realFs.readdirSync(f.anchorDir), [anchorFileName(f.key)]);
});

test('14 a damaged, oversized, linked or misplaced anchor is refused without leaking', t => {
  const f = fixture(t);
  const serialized = build(['entry-a', 'entry-b'], { patch: { payload: { note: 'PAYLOAD-MARKER-14' } } });
  wrote(put(f, serialized));
  const good = realFs.readFileSync(f.anchorPath, 'utf8');
  const parsed = JSON.parse(good);
  const variants = {
    truncated: good.slice(0, 40),
    noNewline: good.slice(0, -1),
    spaced: good.replace(',"pending"', ', "pending"'),
    reordered: JSON.stringify({ schema: parsed.schema, pending: null, current: parsed.current }) + '\n',
    extraTop: canonical({ ...parsed, extra: 1 }) + '\n',
    extraState: canonical({ ...parsed, current: { ...parsed.current, extra: 1 } }) + '\n',
    missingState: canonical({ ...parsed, current: (({ stemTip, ...rest }) => rest)(parsed.current) }) + '\n',
    unknownSchema: canonical({ ...parsed, schema: 'nisi-journal-anchor-v2' }) + '\n',
    zeroGeneration: canonical({ ...parsed, current: { ...parsed.current, generation: 0 } }) + '\n',
    badHex: canonical({ ...parsed, current: { ...parsed.current, fileSha256: parsed.current.fileSha256.toUpperCase() } }) + '\n',
    badProject: canonical({ ...parsed, current: { ...parsed.current, projectId: '../x' } }) + '\n',
    badJournalSchema: canonical({ ...parsed, current: { ...parsed.current, journalSchema: 'x' } }) + '\n',
    badPendingGeneration: canonical({ ...parsed, pending: { ...parsed.current, generation: parsed.current.generation + 2 } }) + '\n',
    badPendingProject: canonical({ ...parsed, pending: { ...parsed.current, projectId: 'other', generation: parsed.current.generation + 1 } }) + '\n',
    countTooBig: canonical({ ...parsed, current: { ...parsed.current, count: 10001 } }) + '\n',
    countNegative: canonical({ ...parsed, current: { ...parsed.current, count: -1 } }) + '\n',
    badLastHash: canonical({ ...parsed, current: { ...parsed.current, lastHash: 'abc' } }) + '\n',
    badStemTip: canonical({ ...parsed, current: { ...parsed.current, stemTip: parsed.current.stemTip + '0' } }) + '\n',
    badPendingHash: canonical({ ...parsed, pending: { ...parsed.current, generation: parsed.current.generation + 1, fileSha256: 'zz' } }) + '\n',
    notJson: 'not json\n',
    empty: '',
    oversized: ' '.repeat(MAX_ANCHOR_BYTES + 1),
    atTheCap: ' '.repeat(MAX_ANCHOR_BYTES),
  };
  assert.equal(ANCHOR_SCHEMA, parsed.schema);
  assert.equal(MAX_ANCHOR_BYTES, 4096);
  for (const [name, text] of Object.entries(variants)) {
    realFs.writeFileSync(f.anchorPath, text);
    const result = verdict(check(f), 'ANCHOR_INVALID');
    assert.equal(typeof result.cause, 'string', name);
    const dump = JSON.stringify(result);
    for (const secret of ['PAYLOAD-MARKER-14', f.root, 'journal.jsonl']) assert.ok(!dump.includes(secret), name);
    const writeResult = put(f, serialized);
    assert.equal(writeResult.reason, 'ANCHOR_INVALID', name);
    assert.equal(realFs.readFileSync(f.anchorPath, 'utf8'), text, name);
  }
  // Schema values are compared without coercion, even when a parsed object cannot become a primitive.
  const noPrimitive = { toString: null, valueOf: null };
  for (const document of [
    { ...parsed, schema: noPrimitive },
    { ...parsed, current: { ...parsed.current, journalSchema: noPrimitive } },
    { ...parsed, pending: { ...parsed.current, generation: parsed.current.generation + 1, journalSchema: noPrimitive } },
  ]) {
    realFs.writeFileSync(f.anchorPath, canonical(document) + '\n');
    assert.deepEqual(check(f), { status: 'ANCHOR_INVALID', ok: false, cause: 'ANCHOR_FORMAT' });
    assert.deepEqual(put(f, serialized), { status: 'REFUSED', reason: 'ANCHOR_INVALID', cause: 'ANCHOR_FORMAT' });
    assert.deepEqual(reanchorJournal(f.ctx), { status: 'REFUSED', reason: 'ANCHOR_INVALID', cause: 'ANCHOR_FORMAT' });
    assert.deepEqual(adoptJournal(f.ctx), { status: 'REFUSED', reason: 'ANCHOR_EXISTS' });
  }
  // Digest fields are strings, never values that merely coerce to a valid hex digest.
  for (const slot of ['current', 'pending']) {
    const state = slot === 'current' ? parsed.current : { ...parsed.current, generation: parsed.current.generation + 1 };
    for (const field of ['fileSha256', 'lastHash', 'stemTip']) {
      for (const value of [[state[field]], {}, null, 7, noPrimitive]) {
        const document = { ...parsed, [slot]: { ...state, [field]: value } };
        const text = canonical(document) + '\n';
        realFs.writeFileSync(f.anchorPath, text);
        assert.deepEqual(check(f), { status: 'ANCHOR_INVALID', ok: false, cause: 'ANCHOR_FORMAT' });
        assert.deepEqual(put(f, serialized), { status: 'REFUSED', reason: 'ANCHOR_INVALID', cause: 'ANCHOR_FORMAT' });
        assert.deepEqual(reanchorJournal(f.ctx), { status: 'REFUSED', reason: 'ANCHOR_INVALID', cause: 'ANCHOR_FORMAT' });
        assert.deepEqual(adoptJournal(f.ctx), { status: 'REFUSED', reason: 'ANCHOR_EXISTS' });
        assert.equal(realFs.readFileSync(f.anchorPath, 'utf8'), text);
      }
    }
  }
  // An invalid anchor is never adopted over, and re-anchoring reports it.
  realFs.writeFileSync(f.anchorPath, 'not json\n');
  assert.equal(adoptJournal(f.ctx).reason, 'ANCHOR_EXISTS');
  assert.equal(reanchorJournal(f.ctx).reason, 'ANCHOR_INVALID');
  assert.equal(realFs.readFileSync(f.anchorPath, 'utf8'), 'not json\n');
  // A file that grew while it was read.
  realFs.writeFileSync(f.anchorPath, good);
  const grown = { ...f.ctx, fs: makeFs({ fstatSync: (event, invoke) => { const real = invoke(); return event.descriptor?.path === f.anchorPath ? { isFile: () => true, size: real.size - 1 } : real; } }) };
  assert.equal(verifyAnchoredJournal(grown).cause, 'FILE_CHANGED');
  // A path that turns into something else between the checks.
  const notFileByLstat = { ...f.ctx, fs: makeFs({ lstatSync: (event, invoke) => { const real = invoke(); return event.args[0] === f.anchorPath ? { isSymbolicLink: () => false, isFile: () => false } : real; } }) };
  assert.equal(verifyAnchoredJournal(notFileByLstat).cause, 'NOT_A_FILE');
  const notFileByFstat = { ...f.ctx, fs: makeFs({ fstatSync: (event, invoke) => { const real = invoke(); return event.descriptor?.path === f.anchorPath ? { isFile: () => false, size: real.size } : real; } }) };
  assert.equal(verifyAnchoredJournal(notFileByFstat).cause, 'NOT_A_FILE');
  // The parent of the journal's directory is not inside it.
  assert.equal(check(f, { anchorDir: f.root }).status, 'ANCHOR_MISSING');
  // A pending slot that is valid is accepted.
  realFs.writeFileSync(f.anchorPath, canonical({ ...parsed, pending: { ...parsed.current, generation: parsed.current.generation + 1 } }) + '\n');
  assert.notEqual(check(f).status, 'ANCHOR_INVALID');
  realFs.writeFileSync(f.anchorPath, good);
  // Exactly the cap is read (and is not an anchor), one byte more is refused as too large.
  realFs.writeFileSync(f.anchorPath, variants.atTheCap);
  assert.equal(check(f).cause, 'ANCHOR_FORMAT');
  realFs.writeFileSync(f.anchorPath, variants.oversized);
  assert.equal(check(f).cause, 'FILE_TOO_LARGE');
  realFs.writeFileSync(f.anchorPath, good);
  verdict(check(f), 'OK');
  assert.ok(good.length < MAX_ANCHOR_BYTES);
  if (process.platform !== 'win32') assert.equal(realFs.statSync(f.anchorPath).mode & 0o777, 0o600, 'mode kept');

  // A symlinked anchor and a directory in its place.
  realFs.rmSync(f.anchorPath);
  const copy = join(f.root, 'anchor-copy.json');
  realFs.writeFileSync(copy, good);
  let linked = true;
  try { realFs.symlinkSync(copy, f.anchorPath); } catch { linked = false; }
  if (linked) {
    assert.equal(check(f).cause, 'SYMLINK');
    verdict(check(f), 'ANCHOR_INVALID');
    realFs.unlinkSync(f.anchorPath);
  }
  realFs.mkdirSync(f.anchorPath);
  assert.equal(check(f).cause, 'NOT_A_FILE');
  realFs.rmdirSync(f.anchorPath);
  realFs.writeFileSync(f.anchorPath, good);

  // The reader opens with O_NOFOLLOW and O_NONBLOCK, and a link swapped in after the lstat is refused by the open (F5).
  const { O_NOFOLLOW, O_NONBLOCK } = realFs.constants;
  if (O_NOFOLLOW !== undefined) {
    const flags = [];
    const recorded = { ...f.ctx, fs: makeFs({ openSync: (event, invoke) => { if (event.args[0] === f.anchorPath) flags.push(event.args[1]); return invoke(); } }) };
    verdict(verifyAnchoredJournal(recorded), 'OK');
    assert.ok(flags.length >= 1);
    for (const flag of flags) {
      assert.equal(typeof flag, 'number');
      assert.notEqual(flag & O_NOFOLLOW, 0, 'O_NOFOLLOW');
      assert.notEqual(flag & O_NONBLOCK, 0, 'O_NONBLOCK');
    }
    const target = join(f.root, 'swap-target.json');
    realFs.writeFileSync(target, good);
    let swapped = false;
    const swapping = { ...f.ctx, fs: makeFs({
      lstatSync: (event, invoke) => {
        const real = invoke();
        if (event.args[0] === f.anchorPath && !swapped) {
          swapped = true;
          realFs.unlinkSync(f.anchorPath);
          realFs.symlinkSync(target, f.anchorPath);
        }
        return real;
      },
    }) };
    if (process.platform !== 'win32') {
      const swappedResult = verdict(verifyAnchoredJournal(swapping), 'ANCHOR_INVALID');
      assert.equal(swapped, true);
      assert.equal(swappedResult.cause, 'SYMLINK');
      realFs.unlinkSync(f.anchorPath);
      realFs.writeFileSync(f.anchorPath, good);
    }
    // An lstat that lies about a link is caught by the open as well.
    const real = f.anchorPath + '.real';
    realFs.renameSync(f.anchorPath, real);
    let liar = true;
    try { realFs.symlinkSync(real, f.anchorPath); } catch { liar = false; }
    if (liar) {
      const lying = { ...f.ctx, fs: makeFs({ lstatSync: (event, invoke) => (event.args[0] === f.anchorPath ? realFs.lstatSync(real) : invoke()) }) };
      assert.equal(verdict(verifyAnchoredJournal(lying), 'ANCHOR_INVALID').cause, 'SYMLINK');
      realFs.unlinkSync(f.anchorPath);
    }
    realFs.renameSync(real, f.anchorPath);
    realFs.unlinkSync(target);
  }
  realFs.rmSync(f.anchorPath);

  // The anchor directory may not be, or sit inside, the journal's directory.
  const inside = join(f.journalDir, 'anchors');
  realFs.mkdirSync(inside);
  for (const anchorDir of [f.journalDir, inside]) {
    verdict(check(f, { anchorDir }), 'ANCHOR_INSIDE_JOURNAL_DIR');
    assert.equal(put(f, serialized, { anchorDir }).reason, 'ANCHOR_INSIDE_JOURNAL_DIR');
    assert.equal(adoptJournal({ ...f.ctx, anchorDir }).reason, 'ANCHOR_INSIDE_JOURNAL_DIR');
    assert.equal(reanchorJournal({ ...f.ctx, anchorDir }).reason, 'ANCHOR_INSIDE_JOURNAL_DIR');
    assert.deepEqual(realFs.readdirSync(anchorDir).filter(name => name.endsWith('.anchor.json')), []);
  }
  const alias = join(f.root, 'alias');
  let aliased = true;
  try { realFs.symlinkSync(f.journalDir, alias); } catch { aliased = false; }
  if (aliased) verdict(check(f, { anchorDir: alias }), 'ANCHOR_INSIDE_JOURNAL_DIR');

  // A directory that does not exist yet is judged by its nearest existing ancestor (F1b), through a link too.
  const missing = [join(f.journalDir, 'not-yet'), join(f.journalDir, 'not-yet', 'deeper'), join(f.journalDir, 'anchors', 'not-yet')];
  if (aliased) missing.push(join(alias, 'not-yet'));
  for (const anchorDir of missing) {
    verdict(check(f, { anchorDir }), 'ANCHOR_INSIDE_JOURNAL_DIR');
    assert.equal(put(f, serialized, { anchorDir }).reason, 'ANCHOR_INSIDE_JOURNAL_DIR');
    assert.equal(adoptJournal({ ...f.ctx, anchorDir }).reason, 'ANCHOR_INSIDE_JOURNAL_DIR');
    assert.equal(reanchorJournal({ ...f.ctx, anchorDir }).reason, 'ANCHOR_INSIDE_JOURNAL_DIR');
    assert.equal(realFs.existsSync(anchorDir), false);
  }
  assert.equal(check(f, { anchorDir: join(f.root, 'not-yet') }).status, 'ANCHOR_MISSING');
  assert.equal(check(f, { anchorDir: join(f.root, 'not-yet', 'deeper') }).status, 'ANCHOR_MISSING');
  assert.equal(realFs.existsSync(join(f.root, 'not-yet')), false);

  // A spelling of the journal's directory that differs only in case (F1). A fake file system that folds the
  // segment JOURNAL onto journal answers every path as a case-insensitive volume would, and keeps the spelling it was given.
  const fold = path => (typeof path === 'string' ? path.replace(/([\\/])JOURNAL(?=[\\/]|$)/g, '$1journal') : path);
  const caseless = () => makeFs({
    lstatSync: (event, invoke) => realFs.lstatSync(fold(event.args[0]), event.args[1]),
    realpathSync: event => { realFs.lstatSync(fold(event.args[0])); return event.args[0]; },
  });
  const shouting = join(f.root, 'JOURNAL');
  for (const anchorDir of [shouting, join(shouting, 'anchors'), join(shouting, 'not-yet'), join(shouting, 'not-yet', 'deeper')]) {
    const view = { ...f.ctx, fs: caseless(), anchorDir };
    verdict(verifyAnchoredJournal(view), 'ANCHOR_INSIDE_JOURNAL_DIR');
    assert.equal(writeAnchoredJournal({ ...view, serialized }).reason, 'ANCHOR_INSIDE_JOURNAL_DIR', anchorDir);
    assert.equal(adoptJournal(view).reason, 'ANCHOR_INSIDE_JOURNAL_DIR');
    assert.equal(reanchorJournal(view).reason, 'ANCHOR_INSIDE_JOURNAL_DIR');
  }
  // The journal path spelled the other way round.
  const respelled = { ...f.ctx, fs: caseless(), journalPath: join(shouting, 'journal.jsonl'), anchorDir: f.journalDir };
  verdict(verifyAnchoredJournal(respelled), 'ANCHOR_INSIDE_JOURNAL_DIR');
  // Controls: a sibling directory, and a name that merely starts with the folded one, are outside.
  assert.equal(verifyAnchoredJournal({ ...f.ctx, fs: caseless(), anchorDir: f.anchorDir }).status, 'ANCHOR_MISSING');
  assert.equal(verifyAnchoredJournal({ ...f.ctx, fs: caseless(), anchorDir: join(f.root, 'JOURNALS') }).status, 'ANCHOR_MISSING');
  // A file system that reports no inode cannot tell spellings apart; the spelled comparison still applies.
  const blind = { ...f.ctx, fs: makeFs({ lstatSync: (event, invoke) => { const real = invoke(); return { isDirectory: () => true, isSymbolicLink: real.isSymbolicLink.bind(real), isFile: real.isFile.bind(real), ino: 0, dev: 0 }; } }), anchorDir: f.journalDir };
  verdict(verifyAnchoredJournal(blind), 'ANCHOR_INSIDE_JOURNAL_DIR');
  // Identity is device plus inode, compared exactly (bigint), and only for directories that report one.
  const jd = realFs.realpathSync(f.journalDir);
  const ad = realFs.realpathSync(f.anchorDir);
  const reporting = (journal, anchor, directory = true) => ({ ...f.ctx, fs: makeFs({
    lstatSync: (event, invoke) => {
      const real = invoke();
      const pick = event.args[0] === jd ? journal : event.args[0] === ad ? anchor : null;
      if (pick === null) return real;
      const exact = event.args[1]?.bigint === true;
      return { isDirectory: () => directory, isSymbolicLink: () => false, isFile: () => false, dev: exact ? BigInt(pick.dev) : Number(pick.dev), ino: exact ? BigInt(pick.ino) : Number(pick.ino) };
    },
  }) });
  const BIG = 2n ** 60n;
  assert.equal(verifyAnchoredJournal(reporting({ dev: 7, ino: BIG + 1n }, { dev: 7, ino: BIG + 1n })).status, 'ANCHOR_INSIDE_JOURNAL_DIR');
  assert.equal(verifyAnchoredJournal(reporting({ dev: 7, ino: BIG + 1n }, { dev: 8, ino: BIG + 1n })).status, 'ANCHOR_MISSING');
  assert.equal(verifyAnchoredJournal(reporting({ dev: 7, ino: BIG + 1n }, { dev: 7, ino: BIG + 2n })).status, 'ANCHOR_MISSING');
  assert.equal(verifyAnchoredJournal(reporting({ dev: 7, ino: 5 }, { dev: 7, ino: 5 }, false)).status, 'ANCHOR_MISSING');
  assert.equal(verifyAnchoredJournal(reporting({ dev: 7, ino: 0 }, { dev: 7, ino: 0 })).status, 'ANCHOR_MISSING');
  // Directories that do not exist at all are compared by the spelled path of what is missing.
  const ghost = join(f.root, 'ghost');
  const ghostly = { ...f.ctx, journalPath: join(ghost, 'journal.jsonl') };
  assert.equal(verifyAnchoredJournal({ ...ghostly, anchorDir: join(ghost, 'anchors') }).status, 'ANCHOR_INSIDE_JOURNAL_DIR');
  assert.equal(verifyAnchoredJournal({ ...ghostly, anchorDir: join(f.root, 'ghost2') }).status, 'ANCHOR_MISSING');
  assert.equal(verifyAnchoredJournal({ ...ghostly, journalPath: join(ghost, 'deep', 'journal.jsonl'), anchorDir: join(ghost, 'deep', 'anchors') }).status, 'ANCHOR_INSIDE_JOURNAL_DIR');
  assert.equal(verifyAnchoredJournal({ ...ghostly, journalPath: join(ghost, 'deep', 'journal.jsonl'), anchorDir: join(ghost, 'other') }).status, 'ANCHOR_MISSING');
  assert.equal(realFs.existsSync(ghost), false);
  // On a volume that really is case-insensitive (the default on macOS and Windows) the real call must agree.
  if (realFs.existsSync(shouting)) {
    for (const anchorDir of [shouting, join(shouting, 'anchors'), join(shouting, 'not-yet')]) {
      verdict(check(f, { anchorDir }), 'ANCHOR_INSIDE_JOURNAL_DIR');
      assert.equal(put(f, serialized, { anchorDir }).reason, 'ANCHOR_INSIDE_JOURNAL_DIR');
    }
    verdict(check(f, { journalPath: join(shouting, 'journal.jsonl'), anchorDir: f.journalDir }), 'ANCHOR_INSIDE_JOURNAL_DIR');
  }
  // Anchor-state boundaries are inclusive: 10,000 records and 128 ID characters.
  const boundaries = fixture(t);
  wrote(put(boundaries, serialized));
  const boundaryAnchor = anchorOf(boundaries);
  writeCanonical(boundaries, { ...boundaryAnchor, current: { ...boundaryAnchor.current, count: 10000, fileSha256: '0'.repeat(64) } });
  verdict(check(boundaries), 'ROLLED_BACK');
  for (const projectId of ['2-project', '9-project', 'p'.repeat(128)]) {
    writeCanonical(boundaries, { ...boundaryAnchor, current: { ...boundaryAnchor.current, projectId } });
    verdict(check(boundaries), 'ANCHOR_PROJECT');
  }
  writeCanonical(boundaries, { ...boundaryAnchor, current: { ...boundaryAnchor.current, projectId: 'p'.repeat(129) } });
  assert.deepEqual(check(boundaries), { status: 'ANCHOR_INVALID', ok: false, cause: 'ANCHOR_FORMAT' });

  // Open failures after a successful lstat retain their distinct reason codes.
  for (const [error, expected] of [
    [Object.assign(new Error('gone'), { code: 'ENOENT' }), { status: 'ANCHOR_MISSING', ok: false }],
    [Object.assign(new Error('denied'), { code: 'EACCES' }), { status: 'ANCHOR_INVALID', ok: false, cause: 'READ_FAILED' }],
    [Object.assign(new Error('link'), { code: 'ELOOP' }), { status: 'ANCHOR_INVALID', ok: false, cause: 'SYMLINK' }],
    [Object.assign(new Error('refused'), { code: noPrimitive }), { status: 'ANCHOR_INVALID', ok: false, cause: 'READ_FAILED' }],
    [null, { status: 'ANCHOR_INVALID', ok: false, cause: 'READ_FAILED' }],
  ]) {
    const broken = { ...boundaries.ctx, fs: makeFs({ openSync: (event, invoke) => { if (event.args[0] === boundaries.anchorPath) throw error; return invoke(); } }) };
    assert.deepEqual(verifyAnchoredJournal(broken), expected);
  }
  for (const error of [eio(), null, Object.assign(new Error('refused'), { code: noPrimitive })]) {
    const broken = { ...boundaries.ctx, fs: makeFs({ lstatSync: (event, invoke) => { if (event.args[0] === boundaries.anchorPath) throw error; return invoke(); } }) };
    assert.deepEqual(verifyAnchoredJournal(broken), { status: 'ANCHOR_INVALID', ok: false, cause: 'READ_FAILED' });
  }
  const journalCodeObject = fixture(t, { lstatSync: (event, invoke) => {
    if (event.args[0] === journalCodeObject.journalPath) throw Object.assign(new Error('refused'), { code: noPrimitive });
    return invoke();
  } });
  assert.deepEqual(put(journalCodeObject, serialized), { status: 'REFUSED', reason: 'JOURNAL_NOT_COMPLETE', cause: 'READ_FAILED' });
  assert.equal(realFs.existsSync(journalCodeObject.journalPath), false);
  // Malformed caller fs stat shapes fail closed with the documented cause.
  for (const stat of [null, undefined, {}, { isFile: () => true }, { isSymbolicLink: () => false },
    { isSymbolicLink: () => false, isFile: 'yes' }]) {
    const broken = { ...boundaries.ctx, fs: makeFs({ lstatSync: (event, invoke) => event.args[0] === boundaries.anchorPath ? stat : invoke() }) };
    assert.deepEqual(verifyAnchoredJournal(broken), { status: 'ANCHOR_INVALID', ok: false, cause: 'READ_FAILED' });
  }
  for (const stat of [null, undefined, {}, { size: 1 }, { isFile: () => true, size: NaN }, { isFile: () => true, size: 1.5 }]) {
    const broken = { ...boundaries.ctx, fs: makeFs({ fstatSync: (event, invoke) => event.descriptor?.path === boundaries.anchorPath ? stat : invoke() }) };
    assert.deepEqual(verifyAnchoredJournal(broken), { status: 'ANCHOR_INVALID', ok: false, cause: 'READ_FAILED' });
  }
  const failedRead = { ...boundaries.ctx, fs: makeFs({ readSync: (event, invoke) => { if (event.descriptor?.path === boundaries.anchorPath) throw eio(); return invoke(); } }) };
  assert.deepEqual(verifyAnchoredJournal(failedRead), { status: 'ANCHOR_INVALID', ok: false, cause: 'READ_FAILED' });

  // A growing anchor is read at most one byte beyond its observed size, with no zero-length read.
  writeCanonical(boundaries, boundaryAnchor);
  const size = realFs.statSync(boundaries.anchorPath).size - 1;
  const bounded = { ...boundaries.ctx, fs: makeFs({
    fstatSync: (event, invoke) => event.descriptor?.path === boundaries.anchorPath ? { isFile: () => true, size } : invoke(),
    readSync: (event, invoke) => {
      if (event.descriptor?.path === boundaries.anchorPath) {
        assert.ok(event.args[3] > 0);
        assert.equal(event.args[1].length, size + 1);
      }
      return invoke();
    },
  }) };
  assert.deepEqual(verifyAnchoredJournal(bounded), { status: 'ANCHOR_INVALID', ok: false, cause: 'FILE_CHANGED' });
  // The fallback to string open flags works for fs objects without constants.
  const noConstants = makeFs();
  delete noConstants.constants;
  verdict(verifyAnchoredJournal({ ...boundaries.ctx, fs: noConstants }), 'OK');

  // A symlink followed by '..' names the physical parent, not its spelled parent.
  const physical = fixture(t);
  const aDir = join(physical.root, 'a');
  const subDir = join(physical.anchorDir, 'sub');
  realFs.mkdirSync(aDir);
  realFs.mkdirSync(subDir);
  let linkedParent = false;
  try { realFs.symlinkSync(subDir, join(aDir, 'link'), 'dir'); linkedParent = true; } catch { /* symlinks unavailable */ }
  if (linkedParent) {
    const journalPath = aDir + '/link/../journal.jsonl';
    const view = { ...physical.ctx, journalPath };
    assert.deepEqual(writeAnchoredJournal({ ...view, serialized }), { status: 'REFUSED', reason: 'ANCHOR_INSIDE_JOURNAL_DIR' });
    verdict(verifyAnchoredJournal(view), 'ANCHOR_INSIDE_JOURNAL_DIR');
    assert.equal(realFs.existsSync(join(physical.anchorDir, 'journal.jsonl')), false);
    assert.deepEqual(realFs.readdirSync(physical.anchorDir), ['sub']);
    // A legitimate sibling anchor uses the same resolved journal for every operation.
    const outside = join(physical.root, 'outside');
    realFs.mkdirSync(outside);
    const journalPaths = [];
    const recordJournalPath = (event, invoke) => {
      for (const argument of event.args) {
        if (typeof argument === 'string' && /[\\/]journal\.jsonl$/.test(argument)) journalPaths.push(argument);
      }
      return invoke();
    };
    const observedFs = makeFs(Object.fromEntries(['lstatSync', 'openSync', 'readFileSync', 'renameSync'].map(name => [name, recordJournalPath])));
    const legitimate = { ...view, anchorDir: outside, fs: observedFs };
    wrote(writeAnchoredJournal({ ...legitimate, serialized }));
    assert.equal(realFs.readFileSync(join(physical.anchorDir, 'journal.jsonl'), 'utf8'), serialized);
    assert.equal(realFs.existsSync(join(aDir, 'journal.jsonl')), false);
    verdict(verifyAnchoredJournal(legitimate), 'OK');
    assert.ok(journalPaths.length > 0);
    assert.deepEqual([...new Set(journalPaths)], [join(realFs.realpathSync(physical.anchorDir), 'journal.jsonl')]);

    // The anchor path also keeps the physical meaning of a symlink followed by '..'.
    const physicalAnchors = join(physical.anchorDir, 'anchors');
    const spelledAnchors = join(aDir, 'anchors');
    realFs.mkdirSync(physicalAnchors);
    realFs.mkdirSync(spelledAnchors);
    const anchorSpelling = { ...physical.ctx, journalPath: join(aDir, 'journal.jsonl'), anchorDir: aDir + '/link/../anchors' };
    wrote(writeAnchoredJournal({ ...anchorSpelling, serialized }));
    verdict(verifyAnchoredJournal(anchorSpelling), 'OK');
    assert.deepEqual(realFs.readdirSync(physicalAnchors), [anchorFileName(physical.key)]);
    assert.deepEqual(realFs.readdirSync(spelledAnchors), []);
  }
  // macOS volfs names can resolve by identity even when realpath rejects the spelling.
  if (process.platform === 'darwin') {
    const stat = realFs.statSync(inside);
    const volfs = '/.vol/' + stat.dev + '/' + stat.ino;
    if (realFs.existsSync(volfs)) {
      const view = { ...f.ctx, anchorDir: volfs };
      verdict(verifyAnchoredJournal(view), 'ANCHOR_INSIDE_JOURNAL_DIR');
      assert.equal(writeAnchoredJournal({ ...view, serialized }).reason, 'ANCHOR_INSIDE_JOURNAL_DIR');
      assert.equal(adoptJournal(view).reason, 'ANCHOR_INSIDE_JOURNAL_DIR');
      assert.equal(reanchorJournal(view).reason, 'ANCHOR_INSIDE_JOURNAL_DIR');
    }
  }

  // A usable volfs alias stays short when redundant dot components follow it.
  if (process.platform === 'darwin') {
    const stat = realFs.statSync(boundaries.anchorDir);
    const outsideVolfs = '/.vol/' + stat.dev + '/' + stat.ino;
    if (realFs.existsSync(outsideVolfs)) {
      const dotted = { ...boundaries.ctx, anchorDir: outsideVolfs + '/.'.repeat(3000) };
      verdict(verifyAnchoredJournal(dotted), 'OK');
      const unchanged = writeAnchoredJournal({ ...dotted, serialized });
      assert.equal(unchanged.status, 'UNCHANGED');
      assert.equal(unchanged.committed, false);
    }
  }

  // Incomplete directory identities cannot be used to infer that two directories are the same.
  for (const missing of ['dev', 'ino']) {
    const view = { ...boundaries.ctx, fs: makeFs({ lstatSync: (event, invoke) => {
      const stat = invoke();
      if (event.args[1]?.bigint === true) {
        return { isDirectory: stat.isDirectory.bind(stat), isSymbolicLink: stat.isSymbolicLink.bind(stat), [missing === 'dev' ? 'ino' : 'dev']: 7n };
      }
      return stat;
    } }) };
    verdict(verifyAnchoredJournal(view), 'OK');
  }


  // The two host paths may both be relative to the caller's working directory.
  const relativePaths = fixture(t);
  const relativeView = {
    ...relativePaths.ctx,
    journalPath: relative(process.cwd(), relativePaths.journalPath),
    anchorDir: relative(process.cwd(), relativePaths.anchorDir),
  };
  wrote(writeAnchoredJournal({ ...relativeView, serialized }));
  verdict(verifyAnchoredJournal(relativeView), 'OK');
  assert.equal(journalText(relativePaths), serialized);
  assert.deepEqual(realFs.readdirSync(relativePaths.anchorDir), [anchorFileName(relativePaths.key)]);

  // A journal path spelled under the anchor directory can physically name its sibling.
  const mirrored = fixture(t);
  const mirroredSub = join(mirrored.journalDir, 'sub');
  realFs.mkdirSync(mirroredSub);
  let mirrorLink = false;
  try { realFs.symlinkSync(mirroredSub, join(mirrored.anchorDir, 'link'), 'dir'); mirrorLink = true; } catch { /* symlinks unavailable */ }
  if (mirrorLink) {
    const mirrorView = { ...mirrored.ctx, journalPath: mirrored.anchorDir + '/link/../journal.jsonl' };
    wrote(writeAnchoredJournal({ ...mirrorView, serialized }));
    verdict(verifyAnchoredJournal(mirrorView), 'OK');
    assert.equal(journalText(mirrored), serialized);
    assert.equal(realFs.existsSync(join(mirrored.anchorDir, 'journal.jsonl')), false);
    assert.deepEqual(realFs.readdirSync(mirrored.anchorDir).sort(), [anchorFileName(mirrored.key), 'link'].sort());
  }

  // A backslash is an ordinary component character on POSIX, for either directory.
  if (process.platform !== 'win32') {
    const literal = fixture(t);
    const literalJournalDir = join(literal.root, 'journal\\name');
    const literalAnchorDir = join(literal.root, 'anchor\\name');
    realFs.mkdirSync(literalJournalDir);
    realFs.mkdirSync(literalAnchorDir);
    const view = { ...literal.ctx, journalPath: join(literalJournalDir, 'journal.jsonl'), anchorDir: literalAnchorDir };
    wrote(writeAnchoredJournal({ ...view, serialized }));
    verdict(verifyAnchoredJournal(view), 'OK');
    assert.equal(realFs.readFileSync(view.journalPath, 'utf8'), serialized);
    assert.deepEqual(realFs.readdirSync(literalAnchorDir), [anchorFileName(literal.key)]);
    assert.equal(realFs.existsSync(join(literal.root, 'journal', 'name')), false);
  }

  // Removing redundant separators must keep a usable anchor path within the native length limit.
  if (process.platform === 'darwin') {
    const boundary = fixture(t);
    const leaf = anchorFileName(boundary.key);
    const directoryBytes = 1024 - 2 - Buffer.byteLength(leaf);
    let deep = boundary.root;
    while (Buffer.byteLength(deep) < directoryBytes) {
      const remaining = directoryBytes - Buffer.byteLength(deep) - 1;
      const width = remaining === 241 ? 239 : Math.min(240, remaining);
      assert.ok(width > 0);
      deep = join(deep, 'x'.repeat(width));
      realFs.mkdirSync(deep);
    }
    assert.equal(Buffer.byteLength(deep), directoryBytes);
    const nativeCode = path => {
      try { realFs.lstatSync(path); return 'EXISTS'; }
      catch (error) { return error.code; }
    };
    if (nativeCode(deep + '/' + leaf) === 'ENOENT' && nativeCode(deep + '//' + leaf) === 'ENAMETOOLONG') {
      const fs = makeFs();
      delete fs.realpathSync;
      verdict(verifyAnchoredJournal({ ...boundary.ctx, fs, anchorDir: deep + '//' }), 'ANCHOR_MISSING');
    } else t.diagnostic('NOT_RUN: native path-length boundary unavailable');
  }

  // Optional realpath support must not hide the identity of a directory symlink.
  for (const realpathMode of ['absent', 'throws']) {
    const fallback = fixture(t);
    const nested = join(fallback.journalDir, 'anchors');
    const anchorAlias = join(fallback.root, 'linked-anchors');
    const journalAlias = join(fallback.root, 'linked-journal');
    realFs.mkdirSync(nested);
    let links = false;
    try {
      realFs.symlinkSync(nested, anchorAlias, 'dir');
      realFs.symlinkSync(fallback.journalDir, journalAlias, 'dir');
      links = true;
    } catch { /* symlinks unavailable */ }
    const fs = makeFs();
    if (realpathMode === 'absent') delete fs.realpathSync;
    else fs.realpathSync = () => { throw eio(); };
    // Redundant dot components stay usable even without a path-canonicalization method.
    const dotted = { ...fallback.ctx, fs, anchorDir: fallback.anchorDir + '/.'.repeat(3000) };
    verdict(verifyAnchoredJournal(dotted), 'ANCHOR_MISSING');
    wrote(writeAnchoredJournal({ ...dotted, serialized }));
    verdict(verifyAnchoredJournal(dotted), 'OK');
    assert.deepEqual(realFs.readdirSync(fallback.anchorDir), [anchorFileName(fallback.key)]);
    if (links) {
      const unsafe = { ...fallback.ctx, fs, anchorDir: anchorAlias };
      verdict(verifyAnchoredJournal(unsafe), 'ANCHOR_INSIDE_JOURNAL_DIR');
      for (const call of [writeAnchoredJournal, adoptJournal, reanchorJournal]) {
        assert.equal(call({ ...unsafe, serialized }).reason, 'ANCHOR_INSIDE_JOURNAL_DIR');
      }
      // A journal-directory alias with a sibling anchor is still a legitimate layout.
      const legitimate = { ...fallback.ctx, fs, journalPath: join(journalAlias, 'journal.jsonl') };
      verdict(verifyAnchoredJournal(legitimate), 'OK');
      assert.equal(writeAnchoredJournal({ ...legitimate, serialized }).status, 'UNCHANGED');
      assert.deepEqual(realFs.readdirSync(nested), []);
    }
  }

  // Symlink-directory identities keep integer precision when realpath is unavailable.
  const precise = fixture(t);
  const preciseJournal = join(precise.root, 'journal-alias');
  const preciseAnchor = join(precise.root, 'anchor-alias');
  let preciseLinks = false;
  try {
    realFs.symlinkSync(precise.journalDir, preciseJournal, 'dir');
    realFs.symlinkSync(precise.anchorDir, preciseAnchor, 'dir');
    preciseLinks = true;
  } catch { /* symlinks unavailable */ }
  if (preciseLinks) {
    const identityHits = new Set();
    const fs = makeFs({ lstatSync: (event, invoke) => {
      const stat = invoke();
      const inode = event.args[0] === precise.journalDir ? BIG + 1n : event.args[0] === precise.anchorDir ? BIG + 2n : null;
      if (inode === null) return stat;
      const exact = event.args[1]?.bigint === true;
      assert.equal(exact, true);
      identityHits.add(event.args[0]);
      return { isDirectory: () => true, isSymbolicLink: () => false, isFile: () => false, dev: exact ? 7n : 7, ino: exact ? inode : Number(inode) };
    } });
    delete fs.realpathSync;
    const view = { ...precise.ctx, fs, journalPath: join(preciseJournal, 'journal.jsonl'), anchorDir: preciseAnchor };
    verdict(verifyAnchoredJournal(view), 'ANCHOR_MISSING');
    wrote(writeAnchoredJournal({ ...view, serialized }));
    verdict(verifyAnchoredJournal(view), 'OK');
    assert.deepEqual([...identityHits].sort(), [precise.journalDir, precise.anchorDir].sort());
  }

  // The identity fallback permits a sibling on a filesystem with no usable ancestor IDs.
  const partial = fixture(t);
  const knownJournalDir = realFs.realpathSync(partial.journalDir);
  const partialFs = makeFs({ lstatSync: (event, invoke) => {
    const stat = invoke();
    if (!stat.isDirectory() || event.args[0] === knownJournalDir) return stat;
    return { isDirectory: () => true, isSymbolicLink: () => false, isFile: () => false, ino: 0, dev: stat.dev };
  } });
  const partialView = { ...partial.ctx, fs: partialFs };
  verdict(verifyAnchoredJournal(partialView), 'ANCHOR_MISSING');
  wrote(writeAnchoredJournal({ ...partialView, serialized }));
  verdict(verifyAnchoredJournal(partialView), 'OK');

  // A missing component before '..' remains kernel-invalid; it is never lexically rescued.
  const absent = fixture(t);
  const invalidPath = absent.journalDir + '/absent/../journal.jsonl';
  const missingParent = writeAnchoredJournal({ ...absent.ctx, journalPath: invalidPath, serialized });
  assert.equal(missingParent.status, 'REFUSED');
  assert.equal(realFs.existsSync(absent.journalPath), false);
  assert.equal(realFs.existsSync(join(absent.journalDir, 'absent')), false);

  // A trailing separator on a regular journal file must not be stripped into a valid file.
  const trailing = fixture(t);
  wrote(put(trailing, serialized));
  const heldJournal = realFs.readFileSync(trailing.journalPath);
  const heldAnchor = realFs.readFileSync(trailing.anchorPath);
  const trailingView = { ...trailing.ctx, journalPath: trailing.journalPath + '/' };
  const trailingRead = verifyAnchoredJournal(trailingView);
  assert.equal(trailingRead.status, 'JOURNAL_NOT_COMPLETE');
  assert.equal(trailingRead.ok, false);
  for (const call of [writeAnchoredJournal, reanchorJournal]) {
    const result = call({ ...trailingView, serialized });
    assert.equal(result.status, 'REFUSED');
    assert.equal(result.reason, 'JOURNAL_NOT_COMPLETE');
    assert.equal(result.cause, trailingRead.cause);
  }
  assert.deepEqual(realFs.readFileSync(trailing.journalPath), heldJournal);
  assert.deepEqual(realFs.readFileSync(trailing.anchorPath), heldAnchor);

});

test('15 legacy and incomplete journals cannot be adopted; a complete one can, once', t => {
  const f = fixture(t);
  const retiring = build(['entry-a', 'entry-b'], { cfg: { maxEntries: 1 } });
  const legacy = rebuild(retiring, rows => {
    assert.equal(rows[0].retained, false);
    rows[0].fingerprint = hash('nisi-run-journal/input/v1\n' + canonical({ ...rows[0].entry, payload: { note: 'safe-note' } }));
  }, { keepFingerprints: true });
  assert.equal(reopen(legacy).report.reason, 'LEGACY_UNRETAINED_FINGERPRINT');
  overwrite(f, legacy);
  const refusedLegacy = adoptJournal(f.ctx);
  assert.equal(refusedLegacy.status, 'REFUSED');
  assert.equal(refusedLegacy.reason, 'JOURNAL_NOT_COMPLETE');
  assert.equal(refusedLegacy.cause, 'LEGACY_UNRETAINED_FINGERPRINT');
  verdict(check(f), 'ANCHOR_MISSING');

  const complete = build(['entry-a', 'entry-b']);
  const lines = complete.slice(0, -1).split('\n');
  overwrite(f, lines.slice(0, -1).join('\n') + '\n');
  assert.equal(reopen(lines.slice(0, -1).join('\n') + '\n').report.status, 'INCOMPLETE');
  const refusedIncomplete = adoptJournal(f.ctx);
  assert.equal(refusedIncomplete.reason, 'JOURNAL_NOT_COMPLETE');
  assert.equal(refusedIncomplete.cause, 'INVALID_JOURNAL');
  assert.equal(realFs.existsSync(f.anchorPath), false);

  overwrite(f, '');
  assert.equal(adoptJournal(f.ctx).reason, 'JOURNAL_NOT_COMPLETE');
  realFs.unlinkSync(f.journalPath);
  assert.equal(adoptJournal(f.ctx).cause, 'NOT_FOUND');

  overwrite(f, complete);
  const adopted = adoptJournal(f.ctx);
  assert.equal(adopted.status, 'ADOPTED', JSON.stringify(adopted));
  assert.equal(adopted.generation, 1);
  assert.equal(verdict(check(f), 'OK').generation, 1);
  assert.equal(anchorOf(f).pending, null);
  assert.equal(adoptJournal(f.ctx).reason, 'ANCHOR_EXISTS');
  // Expectations of the host are enforced on adoption.
  const g = fixture(t);
  overwrite(g, complete);
  const wrong = { projectId: 'project-z', redactPaths: [], maxNow: 1000 };
  assert.equal(adoptJournal({ ...g.ctx, expectations: wrong }).cause, 'PROJECT_MISMATCH');
  assert.equal(adoptJournal({ ...g.ctx, expectations: { projectId: 'project-a', redactPaths: [], maxNow: 50 } }).cause, 'CLOCK_AHEAD');
  assert.equal(adoptJournal({ ...g.ctx, expectations: { projectId: 'project-a' } }).reason, 'INVALID_INPUT');
  assert.equal(adoptJournal({ ...g.ctx, expectations: { projectId: 'project-a', redactPaths: [], maxNow: 1000 } }).status, 'ADOPTED');

  // An adopted empty journal that is then deleted is not restarted by the writer: only the genesis state may start a file.
  const e = fixture(t);
  overwrite(e, createRunJournal(config()).serialize(100));
  assert.equal(adoptJournal(e.ctx).status, 'ADOPTED');
  realFs.unlinkSync(e.journalPath);
  const restarted = put(e, build(['entry-a']));
  assert.equal(restarted.status, 'REFUSED', JSON.stringify(restarted));
  assert.equal(restarted.reason, 'JOURNAL_NOT_COMPLETE');
  assert.equal(realFs.existsSync(e.journalPath), false);

  // A journal that parses but whose rows were edited without their hashes is refused before anything is written, and describeJournal throws.
  const tampered = build(['entry-a']).replace('"state":"SUCCEEDED"', '"state":"RUNNING"');
  assert.notEqual(tampered, build(['entry-a']));
  assert.notEqual(reopen(tampered).report.status, 'COMPLETE');
  assert.throws(() => describeJournal(tampered), { code: 'JOURNAL_NOT_COMPLETE' });
  assert.throws(() => describeJournal('not a journal\n'), { code: 'JOURNAL_NOT_COMPLETE' });
  for (const bad of [null, 7, 'no final line feed']) assert.throws(() => describeJournal(bad), { code: 'INVALID_JOURNAL' });
  const t2 = fixture(t);
  const refusedTampered = put(t2, tampered);
  assert.equal(refusedTampered.status, 'REFUSED');
  assert.equal(refusedTampered.reason, 'JOURNAL_NOT_COMPLETE');
  assert.deepEqual(realFs.readdirSync(t2.anchorDir), []);
  assert.equal(realFs.existsSync(t2.journalPath), false);

  // A first write that stopped leaves a genesis anchor. A damaged file at the journal path is refused and kept.
  const stopped = fixture(t, { renameSync: (event, invoke) => { if (event.args[1] === stopped.journalPath) throw eio(); return invoke(); } });
  const first = put(stopped, complete);
  assert.equal(first.status, 'REFUSED');
  assert.equal(first.committed, false);
  assert.equal(anchorOf(stopped).current.generation, 1);
  realFs.writeFileSync(stopped.journalPath, 'garbage\n');
  const damaged = writeAnchoredJournal({ ...stopped.ctx, fs: makeFs(), serialized: complete });
  assert.equal(damaged.reason, 'JOURNAL_NOT_COMPLETE', JSON.stringify(damaged));
  assert.equal(journalText(stopped), 'garbage\n');
  assert.equal(anchorOf(stopped).current.generation, 1);
  realFs.unlinkSync(stopped.journalPath);
  wrote(writeAnchoredJournal({ ...stopped.ctx, fs: makeFs(), serialized: complete }));

  // With no anchor, an lstat of the journal path that fails for any reason but ENOENT refuses and writes nothing.
  let probes = 0;
  const blocked = fixture(t, { lstatSync: (event, invoke) => { if (event.args[0] === blocked.journalPath && ++probes === 1) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return invoke(); } });
  const denied = put(blocked, complete);
  assert.equal(denied.status, 'REFUSED', JSON.stringify(denied));
  assert.equal(denied.reason, 'JOURNAL_NOT_COMPLETE');
  assert.equal(denied.cause, 'READ_FAILED');
  assert.equal(probes, 1);
  assert.equal(realFs.existsSync(blocked.journalPath), false);
  assert.deepEqual(realFs.readdirSync(blocked.anchorDir), []);
});

// Values below were produced by history/run-journal-anchor-v1.mjs and re-derived by an
// independent script written from section 3 of the design (see the pull request).
const GOLDEN = {
  seed: '28601728f02035ffee91e8e5f9653fedacb28cf13b4e7814eb3a27b2ae72deb3',
  stems: [
    '0ff8a8a5756fe93a2c39f5ca95740e279ed695184d1137055e06749ad9a18887',
    '8dd7bfb8dd09fc9aa13c85b84a9cb14eaf968d812c222be01d54d8cce9f478e5',
    '30fc38619dac68e14a9c0342c55d9cdd407e4cd14e6d8d7c7213e29824f54592',
  ],
  chain: [
    '28601728f02035ffee91e8e5f9653fedacb28cf13b4e7814eb3a27b2ae72deb3',
    '2e72ff5d1c228061f9efa926751e85adebbcad342d41708dca0da368d5a57fed',
    '7f29395486a717ae716e499a28597b820fc9ee8d5dec678a8904b5c90fec7e24',
    'adf322f6fdb7e615ede471a08b972a30cebec886cbd73afabc969554a18b828d',
  ],
  lastHash: '7a193d7b19fc9b384dbffd9bf28e5742b714c0dbb42bd3352cfc1b88a75a51ce',
  fileSha256: 'dfab7a6842821e0a6e2cddaf1899ba6c1df8f91e25d6ab7a737b1eec4b7b9dab',
  anchorText: '{"current":{"count":3,"fileSha256":"dfab7a6842821e0a6e2cddaf1899ba6c1df8f91e25d6ab7a737b1eec4b7b9dab","generation":2,"journalSchema":"nisi-run-journal-v1","lastHash":"7a193d7b19fc9b384dbffd9bf28e5742b714c0dbb42bd3352cfc1b88a75a51ce","projectId":"project-a","stemTip":"adf322f6fdb7e615ede471a08b972a30cebec886cbd73afabc969554a18b828d"},"pending":null,"schema":"nisi-journal-anchor-v1"}\n',
};
function goldenJournal() {
  const journal = createRunJournal(config({ maxEntries: 2 }));
  journal.append(entry('golden-a', { createdAt: 100, payload: { note: 'one' } }), 100);
  journal.append(entry('golden-b', { createdAt: 200, payload: { note: 'two' }, state: 'RUNNING', heartbeatAt: 200 }), 200);
  journal.append(entry('golden-c', { createdAt: 300, payload: { note: 'three' }, retryOf: 'golden-a', attempt: 1, state: 'QUEUED' }), 300);
  return journal.serialize(300);
}

test('16 golden vectors pin the hash strings and the anchor bytes', t => {
  const serialized = goldenJournal();
  const d = describeJournal(serialized);
  assert.equal(d.projectId, 'project-a');
  assert.equal(d.count, 3);
  assert.equal(d.seed, GOLDEN.seed);
  assert.deepEqual(d.stems, GOLDEN.stems);
  assert.deepEqual(d.chain, GOLDEN.chain);
  assert.equal(d.stemTip, GOLDEN.chain.at(-1));
  assert.equal(d.lastHash, GOLDEN.lastHash);
  assert.equal(d.fileSha256, GOLDEN.fileSha256);
  const f = fixture(t, undefined, 'golden-key');
  wrote(put(f, serialized));
  assert.equal(realFs.readFileSync(f.anchorPath, 'utf8'), GOLDEN.anchorText);
  assert.equal(f.anchorPath.endsWith(hash('golden-key') + '.anchor.json'), true);
});

test('17 no format change: serialize and reopen are byte-identical and the anchored path writes the same bytes', t => {
  const serialized = goldenJournal();
  assert.equal(hash(serialized), FORMAT_PIN.serializedSha256);
  const reopened = reopen(serialized);
  assert.deepEqual(reopened.report, { status: 'COMPLETE', recoveredIds: ['golden-a', 'golden-b', 'golden-c'], rejectedLine: null, reason: null, authorizing: false });
  assert.equal(reopened.journal.serialize(300), serialized);
  assert.equal(JSON.stringify(reopened.journal.list(300).map(row => [row.entry.id, row.retained, row.liveness])),
    JSON.stringify([['golden-a', false, 'SUCCEEDED'], ['golden-b', true, 'UNKNOWN'], ['golden-c', true, 'QUEUED']]));
  const f = fixture(t);
  wrote(put(f, serialized));
  assert.equal(journalText(f), serialized);
  const g = fixture(t);
  wrote(writeSerializedJournal({ path: g.journalPath, serialized, fs: realFs }));
  assert.equal(journalText(g), journalText(f));
  assert.equal(readSerializedJournal({ path: f.journalPath, fs: realFs }).sha256, FORMAT_PIN.serializedSha256);
});

// Digest of the serialized golden journal, taken from main before the anchor module existed.
const FORMAT_PIN = { serializedSha256: 'dfab7a6842821e0a6e2cddaf1899ba6c1df8f91e25d6ab7a737b1eec4b7b9dab' };

test('18 file names are lowercase hex, the rename retry works and a failed directory sync is durable: false', t => {
  const keys = ['project:alpha', 'UPPER-Case-Key', 'CON', 'x'.repeat(128), 'x'.repeat(1024), 'é-ключ-🌱'];
  for (const key of keys) {
    const name = anchorFileName(key);
    assert.match(name, /^[0-9a-f]{64}\.anchor\.json$/);
    assert.equal(name, hash(key) + '.anchor.json');
    const f = fixture(t, undefined, key);
    wrote(put(f, build(['entry-a'])));
    assert.deepEqual(realFs.readdirSync(f.anchorDir), [name]);
  }
  assert.equal(new Set(keys.map(anchorFileName)).size, keys.length);
  for (const bad of ['', 7, null, undefined, 'a\ud800b']) assert.throws(() => anchorFileName(bad), { code: 'INVALID_INPUT' });

  // EPERM on the anchor rename is retried with the documented delays.
  assert.equal(RENAME_ATTEMPTS, 5);
  assert.deepEqual(RENAME_RETRY_DELAYS_MS, [10, 20, 40, 80]);
  let failures = 2;
  let renames = 0;
  const f = fixture(t, {
    renameSync: (event, invoke) => {
      if (event.args[1] === f.anchorPath) { renames++; if (failures-- > 0) throw Object.assign(new Error('busy'), { code: 'EPERM' }); }
      return invoke();
    },
  });
  const delays = [];
  wrote(put(f, build(['entry-a']), { sleep: ms => delays.push(ms) }));
  assert.deepEqual(delays, [10, 20]);
  assert.equal(renames, 4);
  assert.equal(check(f).status, 'OK');

  // It gives up after five attempts, leaves no temp file and reports it.
  let always = 0;
  const g = fixture(t, {
    renameSync: (event, invoke) => {
      if (event.args[1] === g.anchorPath) { always++; throw Object.assign(new Error('busy'), { code: 'EBUSY' }); }
      return invoke();
    },
  });
  const slept = [];
  const gave = put(g, build(['entry-a']), { sleep: ms => slept.push(ms) });
  assert.equal(gave.status, 'REFUSED');
  assert.equal(gave.reason, 'ANCHOR_WRITE_FAILED');
  assert.equal(always, 5);
  assert.deepEqual(slept, [10, 20, 40, 80]);
  assert.deepEqual(realFs.readdirSync(g.anchorDir), []);
  assert.equal(realFs.existsSync(g.journalPath), false);

  // A code that is not a sharing violation is not retried.
  let once = 0;
  const h = fixture(t, {
    renameSync: (event, invoke) => {
      if (event.args[1] === h.anchorPath) { once++; throw Object.assign(new Error('full'), { code: 'ENOSPC' }); }
      return invoke();
    },
  });
  const noRetry = [];
  assert.equal(put(h, build(['entry-a']), { sleep: ms => noRetry.push(ms) }).reason, 'ANCHOR_WRITE_FAILED');
  assert.equal(once, 1);
  assert.deepEqual(noRetry, []);

  // EACCES is a sharing violation too.
  let denied = 1;
  const e = fixture(t, {
    renameSync: (event, invoke) => {
      if (event.args[1] === e.anchorPath && denied-- > 0) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return invoke();
    },
  });
  const eaccesDelays = [];
  wrote(put(e, build(['entry-a']), { sleep: ms => eaccesDelays.push(ms) }));
  assert.deepEqual(eaccesDelays, [10]);

  // The order of the anchor write: exclusive temp, write, fsync the file, close, rename, fsync the directory.
  const log = [];
  const o = fixture(t, {
    openSync: (event, invoke) => { const fd = invoke(); log.push(['open', String(event.args[0]), event.args[1], event.args[2]]); return fd; },
    writeSync: (event, invoke) => { log.push(['write', event.descriptor?.path]); return invoke(); },
    fsyncSync: (event, invoke) => { log.push(['fsync', event.descriptor?.path]); return invoke(); },
    closeSync: (event, invoke) => { log.push(['close', event.descriptor?.path]); return invoke(); },
    renameSync: (event, invoke) => { log.push(['rename', String(event.args[0]), String(event.args[1])]); return invoke(); },
  });
  wrote(put(o, build(['entry-a'])));
  const anchorEvents = log.filter(row => (row[1] ?? '').startsWith(o.anchorDir) || (row[1] ?? '') === o.anchorDir || row[2] === o.anchorPath);
  const firstTemp = anchorEvents.find(row => row[0] === 'open')[1];
  assert.ok(firstTemp.startsWith(o.anchorPath + '.') && firstTemp.endsWith('.tmp'));
  assert.deepEqual(anchorEvents.slice(0, 8).map(row => row[0]), ['open', 'write', 'fsync', 'close', 'rename', 'open', 'fsync', 'close']);
  assert.equal(anchorEvents[0][2], 'wx');
  assert.equal(anchorEvents[0][3], 0o600);
  assert.equal(anchorEvents[2][1], firstTemp);
  assert.equal(anchorEvents[4][1], firstTemp);
  assert.equal(anchorEvents[4][2], o.anchorPath);
  assert.equal(anchorEvents[5][1], o.anchorDir);
  assert.equal(anchorEvents[6][1], o.anchorDir);
  const pendingFirst = log.findIndex(row => row[0] === 'rename' && row[2] === o.anchorPath);
  const journalRename = log.findIndex(row => row[0] === 'rename' && row[2] === o.journalPath);
  const promotion = log.findLastIndex(row => row[0] === 'rename' && row[2] === o.anchorPath);
  assert.ok(pendingFirst < journalRename && journalRename < promotion, 'pending, journal, promotion');

  // A temp file that reads back differently is not renamed into place.
  const r = fixture(t, {
    readFileSync: (event, invoke) => String(event.args[0]).endsWith('.tmp') && String(event.args[0]).startsWith(r.anchorPath) ? Buffer.from('changed') : invoke(),
  });
  assert.equal(put(r, build(['entry-a'])).reason, 'ANCHOR_WRITE_FAILED');
  assert.deepEqual(realFs.readdirSync(r.anchorDir), []);

  // A link swapped in at the destination after the last check is refused.
  let armed = false;
  let lstats = 0;
  let swapped = false;
  const copyPath = join(tmpdir(), 'nisi-anchor-link-target-' + process.pid);
  const w = fixture(t, {
    openSync: (event, invoke) => { if (event.args[1] === 'wx' && String(event.args[0]).startsWith(w.anchorPath)) { armed = true; lstats = 0; } return invoke(); },
    lstatSync: (event, invoke) => {
      if (armed && event.args[0] === w.anchorPath && ++lstats === 2) {
        armed = false;
        realFs.writeFileSync(copyPath, 'target');
        try { realFs.rmSync(w.anchorPath, { force: true }); realFs.symlinkSync(copyPath, w.anchorPath); swapped = true; } catch { /* no links here */ }
      }
      return invoke();
    },
  });
  t.after(() => realFs.rmSync(copyPath, { force: true }));
  wrote(writeAnchoredJournal({ ...w.ctx, fs: makeFs(), serialized: build(['entry-a']) }));
  armed = false;
  const linked = put(w, build(['entry-a', 'entry-b']));
  if (process.platform !== 'win32') assert.equal(swapped, true, 'the swap ran');
  if (swapped) {
    assert.equal(linked.reason, 'ANCHOR_WRITE_FAILED');
    assert.equal(realFs.readFileSync(copyPath, 'utf8'), 'target');
  }

  // A failed directory sync is reported, never hidden.
  const syncs = fixture(t, {
    fsyncSync: (event, invoke) => {
      if (event.descriptor && [syncs.anchorDir, syncs.journalDir].includes(event.descriptor.path)) throw Object.assign(new Error('no dir sync'), { code: 'EINVAL' });
      return invoke();
    },
  });
  const weak = put(syncs, build(['entry-a']));
  assert.equal(weak.status, 'WRITTEN');
  assert.equal(weak.durable, false);
  assert.equal(check(syncs).status, 'OK');
  if (process.platform !== 'win32') {
    const strong = fixture(t);
    assert.equal(wrote(put(strong, build(['entry-a']))).durable, true);
  }
  // Each sync that fails on its own makes the result not durable.
  for (const [where, nth] of [['anchorDir', 1], ['anchorDir', 2], ['journalDir', 1]]) {
    let seen = 0;
    const z = fixture(t, {
      fsyncSync: (event, invoke) => {
        if (event.descriptor && event.descriptor.path === z[where] && ++seen === nth) throw Object.assign(new Error('no dir sync'), { code: 'EINVAL' });
        return invoke();
      },
    });
    const partial = put(z, build(['entry-a']));
    assert.equal(partial.status, 'WRITTEN', where + nth);
    assert.equal(partial.durable, false, where + nth);
    assert.ok(seen >= nth);
  }
  const anchorOnly = fixture(t, {
    fsyncSync: (event, invoke) => {
      if (event.descriptor && event.descriptor.path === anchorOnly.anchorDir) throw Object.assign(new Error('no dir sync'), { code: 'EINVAL' });
      return invoke();
    },
  });
  assert.equal(wrote(put(anchorOnly, build(['entry-a']))).durable, false);

  // A failed fsync of the anchor file is reported as durable: false, and the write still commits.
  let fileSyncs = 0;
  const fsyncFail = fixture(t, { fsyncSync: (event, invoke) => { if (++fileSyncs === 1) throw eio(); return invoke(); } });
  const unsynced = put(fsyncFail, build(['entry-a']));
  assert.equal(unsynced.status, 'WRITTEN');
  assert.equal(unsynced.durable, false);
  verdict(check(fsyncFail), 'OK');

  // Short writes are completed.
  const short = fixture(t, { writeSync: (event, invoke) => (isTemp(short, event.descriptor?.path) ? realFs.writeSync(event.args[0], event.args[1], event.args[2], Math.min(7, event.args[3]), null) : invoke()) });
  wrote(put(short, build(['entry-a'])));
  verdict(check(short), 'OK');
  assert.equal(realFs.readFileSync(short.anchorPath, 'utf8').endsWith('}\n'), true);

  // A write that reports nothing written, or more than it was given, is a failure and leaves no temp file.
  for (const lie of [() => 0, event => event.args[3] + 5]) {
    const liar = fixture(t, { writeSync: (event, invoke) => { if (isTemp(liar, event.descriptor?.path)) { const count = lie(event); if (count) invoke(); return count; } return invoke(); } });
    const result = put(liar, build(['entry-a']));
    assert.equal(result.status, 'REFUSED');
    assert.equal(result.reason, 'ANCHOR_WRITE_FAILED');
    assert.deepEqual(realFs.readdirSync(liar.anchorDir), []);
    assert.equal(realFs.existsSync(liar.journalPath), false);
  }

  // An lstat of the anchor path that fails just before the rename refuses the write; the third lstat of that path is that one.
  let anchorStats = 0;
  const statFail = fixture(t, { lstatSync: (event, invoke) => { if (event.args[0] === statFail.anchorPath && ++anchorStats >= 3) throw eio(); return invoke(); } });
  const unstatted = put(statFail, build(['entry-a']));
  assert.equal(unstatted.reason, 'ANCHOR_WRITE_FAILED', JSON.stringify(unstatted));
  assert.equal(realFs.existsSync(statFail.anchorPath), false);
  assert.deepEqual(realFs.readdirSync(statFail.anchorDir), []);

  // A directory descriptor that fails to close makes the result not durable, after the anchor is in place.
  const dirClose = fixture(t, { closeSync: (event, invoke) => { if (event.descriptor?.path === dirClose.anchorDir) { invoke(); throw eio(); } return invoke(); } });
  const closed = put(dirClose, build(['entry-a']));
  assert.equal(closed.status, 'WRITTEN');
  assert.equal(closed.durable, false);

  // A failed write closes its descriptor and removes its temp file.
  const opened = [];
  const shut = [];
  const broken = fixture(t, {
    openSync: (event, invoke) => { const fd = invoke(); if (isTemp(broken, event.args[0])) opened.push(fd); return fd; },
    closeSync: (event, invoke) => { shut.push(event.args[0]); return invoke(); },
    writeSync: (event, invoke) => { if (isTemp(broken, event.descriptor?.path)) throw eio(); return invoke(); },
  });
  assert.equal(put(broken, build(['entry-a'])).reason, 'ANCHOR_WRITE_FAILED');
  assert.equal(opened.length, 1);
  assert.ok(shut.includes(opened[0]));
  assert.deepEqual(realFs.readdirSync(broken.anchorDir), []);
  // The built-in retry sleep executes once when no sleep callback is provided.
  let defaultBusy = 1;
  const defaultRetry = fixture(t, { renameSync: (event, invoke) => {
    if (event.args[1] === defaultRetry.anchorPath && defaultBusy-- > 0) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    return invoke();
  } });
  wrote(put(defaultRetry, build(['entry-a'])));
  assert.equal(defaultBusy, -2);
  verdict(check(defaultRetry), 'OK');

  // A throwing retry callback refuses before the journal changes and removes its temp.
  const badSleep = fixture(t, { renameSync: (event, invoke) => {
    if (event.args[1] === badSleep.anchorPath) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    return invoke();
  } });
  assert.deepEqual(put(badSleep, build(['entry-a']), { sleep: () => { throw eio(); } }), { status: 'REFUSED', reason: 'ANCHOR_WRITE_FAILED' });
  assert.equal(realFs.existsSync(badSleep.journalPath), false);
  assert.deepEqual(realFs.readdirSync(badSleep.anchorDir), []);

  // Cleanup must never unlink an exclusive temp file owned by someone else.
  let unowned;
  const collision = fixture(t, { openSync: (event, invoke) => {
    if (isTemp(collision, event.args[0])) {
      unowned = event.args[0];
      realFs.writeFileSync(unowned, 'keep');
      throw Object.assign(new Error('exists'), { code: 'EEXIST' });
    }
    return invoke();
  } });
  assert.deepEqual(put(collision, build(['entry-a'])), { status: 'REFUSED', reason: 'ANCHOR_WRITE_FAILED' });
  assert.equal(realFs.readFileSync(unowned, 'utf8'), 'keep');
  assert.equal(realFs.existsSync(collision.journalPath), false);

  // A malformed write count is rejected even if the injected fs wrote the complete bytes.
  for (const count of [NaN, -1, Infinity]) {
    const malformed = fixture(t, { writeSync: (event, invoke) => {
      const value = invoke();
      return isTemp(malformed, event.descriptor?.path) ? count : value;
    } });
    assert.deepEqual(put(malformed, build(['entry-a'])), { status: 'REFUSED', reason: 'ANCHOR_WRITE_FAILED' });
    assert.deepEqual(realFs.readdirSync(malformed.anchorDir), []);
    assert.equal(realFs.existsSync(malformed.journalPath), false);
  }
  const fakeBuffer = fixture(t, { readFileSync: (event, invoke) => isTemp(fakeBuffer, event.args[0]) ? { equals: () => true } : invoke() });
  assert.deepEqual(put(fakeBuffer, build(['entry-a'])), { status: 'REFUSED', reason: 'ANCHOR_WRITE_FAILED' });
  assert.deepEqual(realFs.readdirSync(fakeBuffer.anchorDir), []);

});

test('19 no payload, path or error text appears in the anchor or in any result', t => {
  const MARKER = 'PAYLOAD-MARKER-19';
  const LEAK = 'LEAK-MARKER-19';
  const serialized = build(['entry-a', 'entry-b'], { patch: { payload: { note: MARKER } } });
  const next = build(['entry-a', 'entry-b', 'entry-c'], { patch: { payload: { note: MARKER } } });
  const f = fixture(t);
  const results = [];
  results.push(put(f, serialized), put(f, next), check(f), adoptJournal(f.ctx), reanchorJournal(f.ctx));
  const anchorText = realFs.readFileSync(f.anchorPath, 'utf8');
  assert.ok(!anchorText.includes(MARKER));
  assert.ok(!anchorText.includes('entry-a'));
  assert.ok(!anchorText.includes(f.root));
  assert.ok(anchorText.length < 800);

  const boom = event => { throw Object.assign(new Error(LEAK + ' ' + event.args[0]), { code: LEAK }); };
  for (const name of ['lstatSync', 'openSync', 'fstatSync', 'readSync', 'writeSync', 'closeSync', 'readFileSync', 'renameSync', 'unlinkSync', 'fsyncSync', 'realpathSync']) {
    const g = fixture(t, { [name]: boom });
    for (const run of [
      () => put(g, serialized), () => check(g), () => adoptJournal(g.ctx), () => reanchorJournal(g.ctx),
    ]) {
      let result;
      assert.doesNotThrow(() => { result = run(); }, name);
      results.push(result);
    }
    // And once more with a good anchor on disk so that the later stages run.
    const h = fixture(t);
    wrote(put(h, serialized));
    const broken = { ...h.ctx, fs: makeFs({ [name]: boom }) };
    for (const run of [
      () => writeAnchoredJournal({ ...broken, serialized: next }), () => verifyAnchoredJournal(broken), () => reanchorJournal(broken),
    ]) {
      let result;
      assert.doesNotThrow(() => { result = run(); }, name);
      results.push(result);
    }
    results.push(h.root, g.root);
  }
  for (const result of results) {
    const dump = typeof result === 'string' ? '' : JSON.stringify(result);
    for (const secret of [MARKER, LEAK, 'entry-a', f.root, 'journal.jsonl', '.anchor.json']) assert.ok(!dump.includes(secret), dump);
  }
  const base = fixture(t);
  for (const patch of [{ journalPath: '' }, { journalPath: 'a\0b' }, { anchorDir: 7 }, { key: '' }, { key: 'x'.repeat(1025) }, { fs: {} }, { fs: null },
    { policy: 'maybe' }, { policy: null }, { maxBytes: -1 }, { maxBytes: '5' }, { maxBytes: null },
    { expectedGeneration: 0 }, { expectedGeneration: 1.5 }, { expectedGeneration: null }, { sleep: 'now' }, { sleep: null },
    { expectations: null }, { expectations: { projectId: 'project-a' } }]) {
    for (const call of [verifyAnchoredJournal, writeAnchoredJournal, adoptJournal, reanchorJournal]) {
      const result = call({ ...base.ctx, serialized: serialized, ...patch });
      assert.ok(result.status === 'INVALID_INPUT' || result.reason === 'INVALID_INPUT', JSON.stringify([patch, result]));
    }
  }
  for (const call of [verifyAnchoredJournal, writeAnchoredJournal, adoptJournal, reanchorJournal]) {
    for (const options of [undefined, null, 7, [], 'options']) {
      assert.deepEqual(call(options), call === verifyAnchoredJournal ? { status: 'INVALID_INPUT', ok: false } : { status: 'REFUSED', reason: 'INVALID_INPUT' });
    }
  }
  const refusedWrite = put(base, 'not a journal');
  assert.equal(refusedWrite.reason, 'JOURNAL_NOT_COMPLETE');
  assert.equal(refusedWrite.cause, 'INVALID_JOURNAL');
  assert.equal(put(base, 7).cause, 'INVALID_JOURNAL');
  assert.deepEqual(put(base, serialized, { expectations: { projectId: 'project-z', redactPaths: [], maxNow: 1000 } }), { status: 'REFUSED', reason: 'JOURNAL_NOT_COMPLETE', cause: 'PROJECT_MISMATCH' });
  assert.equal(realFs.existsSync(base.journalPath), false);
  wrote(put(base, serialized, { expectations: { projectId: 'project-a', redactPaths: [], maxNow: 1000 } }));
  assert.equal(check(base, { maxBytes: 10 }).cause, 'FILE_TOO_LARGE');
  verdict(check(base, { maxBytes: 100000 }), 'OK');
  assert.equal(check(base, { expectations: { projectId: 'project-z', redactPaths: [], maxNow: 1000 } }).cause, 'PROJECT_MISMATCH');
  verdict(check(base, { expectations: { projectId: 'project-a', redactPaths: [], maxNow: 1000 } }), 'OK');
  // Options that throw while they are read are reported by code, never thrown or echoed.
  const hostile = { get journalPath() { throw new Error(LEAK); }, anchorDir: 'a', key: 'k', fs: realFs };
  for (const call of [writeAnchoredJournal, adoptJournal, reanchorJournal]) assert.equal(call(hostile).reason, 'IO_ERROR');
  assert.deepEqual(verifyAnchoredJournal(hostile), { status: 'REFUSED', ok: false, reason: 'IO_ERROR' });
  // Refusals of the arguments themselves never echo them either.
  for (const result of [
    verifyAnchoredJournal({ journalPath: LEAK, anchorDir: LEAK, key: LEAK, fs: {} }),
    verifyAnchoredJournal(null),
    writeAnchoredJournal({ ...f.ctx, serialized: LEAK }),
  ]) assert.ok(!JSON.stringify(result).includes(LEAK));
  assert.deepEqual(check(base, { maxBytes: 0 }), { status: 'JOURNAL_NOT_COMPLETE', ok: false, cause: 'FILE_TOO_LARGE' });
  const unchanged = put(base, serialized);
  assert.deepEqual(unchanged, { status: 'UNCHANGED', committed: false, durable: true, generation: 2, sha256: hash(serialized), bytes: Buffer.byteLength(serialized) });
  // A missing anchor followed by a non-Error journal lstat failure still reports READ_FAILED.
  const nullStat = fixture(t, { lstatSync: (event, invoke) => { if (event.args[0] === nullStat.journalPath) throw null; return invoke(); } });
  assert.deepEqual(put(nullStat, serialized), { status: 'REFUSED', reason: 'JOURNAL_NOT_COMPLETE', cause: 'READ_FAILED' });

  // The journal-description error boundary accepts only short uppercase reason codes.
  const originalWellFormed = String.prototype.isWellFormed;
  for (const [error, cause] of [
    [{ code: '' }, 'IO_ERROR'], [{ code: 'X' }, 'X'], [{ code: 'X'.repeat(32) }, 'X'.repeat(32)],
    [{ code: 'X'.repeat(33) }, 'IO_ERROR'], [{ code: 'private-path' }, 'IO_ERROR'],
    [{ code: 7 }, 'IO_ERROR'], [null, 'IO_ERROR'], [undefined, 'IO_ERROR'],
  ]) {
    try {
      String.prototype.isWellFormed = function () {
        if (String(this) === serialized) throw error;
        return originalWellFormed.call(this);
      };
      assert.deepEqual(put(base, serialized), { status: 'REFUSED', reason: 'JOURNAL_NOT_COMPLETE', cause });
    } finally { String.prototype.isWellFormed = originalWellFormed; }
  }
  // A platform failure after the store read is still a journal-completeness refusal.
  let completeReads = 0;
  try {
    String.prototype.isWellFormed = function () {
      if (String(this) === serialized && ++completeReads === 2) throw eio();
      return originalWellFormed.call(this);
    };
    assert.deepEqual(reanchorJournal(base.ctx), { status: 'REFUSED', reason: 'JOURNAL_NOT_COMPLETE', cause: 'INVALID_JOURNAL' });
  } finally { String.prototype.isWellFormed = originalWellFormed; }
  assert.equal(completeReads, 2);

});

test('20 docs say what an unanchored and an anchored read do not detect, and the links resolve', () => {
  const read = file => realFs.readFileSync(join(ROOT, file), 'utf8');
  const guide = read('docs/run-journal.md');
  const security = read('SECURITY.md');
  const must = (text, pattern, label) => assert.match(text, pattern, label);
  must(guide, /unanchored read does not detect/i, 'guide: unanchored heading');
  must(guide, /An anchored read detects/i, 'guide: anchored detects');
  must(guide, /An anchored read does not detect/i, 'guide: anchored does not detect');
  for (const phrase of [
    /attacker who can write the anchor as well as the journal/,
    /attacker who runs the host's own code/,
    /restore of the journal and the anchor together/,
    /Anything written before adoption/,
    /deleted anchor under `unanchored-ok`/,
    /Appends by anyone who can also write the anchor/,
    /Denial of service/,
    /Older copies that still hold retired payloads/,
    /two copies of a journal on two machines/,
    /A rewrite of a retained payload together with an appended entry/,
    /A one-write rollback while the pending slot is set/,
    /`anchorFileName` throws an error with `code` `INVALID_INPUT`/,
    /`describeJournal` throws `INVALID_JOURNAL`[\s\S]{0,200}`JOURNAL_NOT_COMPLETE`/,
    /device and inode of the journal's directory/,
    /`readlinkSync`/,
    /`ANCHOR_PATH_UNRESOLVED`/,
    /unknown ancestry is never treated as outside/,
    /`GENERATION_EXHAUSTED`/,
    /verify again[\s\S]{0,120}before acting on `AHEAD`/,
    /a false alarm and never a false `OK`/,
    /`AHEAD` does not mean that the anchored entries are unchanged/,
  ]) must(guide, phrase, String(phrase));
  assert.doesNotMatch(guide, /None of them throws/);
  const design = read('docs/design/journal-anchor.md');
  for (const phrase of [/A rewrite of a retained payload that comes with an appended entry/, /A one-write rollback while the pending slot is set/, /A verify that straddles a legitimate write/, /\*\*Generation ceiling\.\*\*/, /\*\*Anchor directory check\.\*\*/]) must(design, phrase, String(phrase));
  must(security, /one-write\s+rollback\s+while\s+a\s+pending\s+slot\s+is\s+set/, 'security: pending-slot window');
  must(security, /unanchored\s+read\s+of\s+a\s+journal[\s\S]{0,120}does\s+not\s+detect/i, 'security: unanchored');
  must(security, /An\s+anchored\s+read[\s\S]{0,120}\)\s+detects/i, 'security: anchored');
  must(security, /It\s+does\s+not\s+detect\s+an\s+attacker\s+who\s+writes\s+the\s+anchor\s+as\s+well/i, 'security: limits');
  must(security, /authenticates\s+no\s+writer/i, 'security: authentication');
  for (const text of [guide, security]) assert.doesNotMatch(text, /R1 is not implemented/);

  const slug = heading => heading.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, '').replace(/ /g, '-');
  for (const file of ['docs/run-journal.md', 'SECURITY.md', 'docs/README.md', 'roadmap.md', 'docs/design/journal-anchor.md']) {
    const text = read(file);
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const [target, fragment] = match[1].split('#');
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const resolved = target === '' ? join(ROOT, file) : resolve(dirname(join(ROOT, file)), target);
      assert.ok(realFs.existsSync(resolved), `${file}: ${match[1]}`);
      if (fragment && resolved.endsWith('.md')) {
        const slugs = [...realFs.readFileSync(resolved, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => slug(m[1]));
        assert.ok(slugs.includes(fragment), `${file}: ${match[1]}`);
      }
    }
  }
});


// These controls run the production module with win32 path bindings and an
// independent tiny filesystem graph. They do not replace native Windows CI.
const windowsAnchor = await loadWindowsAnchor();
function refusesWithoutIO(api, fixture, options, status) {
  const before = fixture.snapshot();
  const calls = fixture.calls.length;
  assert.deepEqual(api.verifyAnchoredJournal(options), { status, ok: false });
  for (const call of [api.writeAnchoredJournal, api.adoptJournal, api.reanchorJournal]) {
    assert.deepEqual(call({ ...options, serialized: build(['entry-a']) }), { status: 'REFUSED', reason: status });
  }
  assert.deepEqual(fixture.snapshot(), before);
  assert.deepEqual(fixture.writes, []);
  assert.equal(fixture.openDescriptors(), 0);
  assert.ok(fixture.calls.slice(calls).every(event => ['lstatSync', 'realpathSync', 'readlinkSync'].includes(event.name)));
}

for (const realpath of ['absent', 'throws']) {
  test(`win32 ${realpath} realpath resolves direct and ancestor directory aliases`, () => {
    for (const targetName of ['journal', 'journal\\anchors']) {
      for (const relative of [false, true]) {
        const f = windowsFixture({ realpath });
        f.directory(f.journalDir + '\\anchors');
        f.directory(f.journalDir + '\\anchors\\deeper');
        const alias = f.root + '\\alias';
        f.link(alias, relative ? targetName : f.root + '\\' + targetName);
        for (const anchorDir of [alias, alias + '\\anchors', alias + '\\not-yet\\deeper']) {
          refusesWithoutIO(windowsAnchor, f, { ...f.options, anchorDir }, 'ANCHOR_INSIDE_JOURNAL_DIR');
        }
      }
    }
    // An alias in an ancestor, rather than at the final component, is resolved too.
    const f = windowsFixture({ realpath });
    f.directory(f.journalDir + '\\anchors');
    f.link(f.root + '\\ancestor', 'journal');
    refusesWithoutIO(windowsAnchor, f, { ...f.options, anchorDir: f.root + '\\ancestor\\anchors' }, 'ANCHOR_INSIDE_JOURNAL_DIR');
  });

  test(`win32 ${realpath} realpath preserves sibling I/O and link parent semantics`, () => {
    const f = windowsFixture({ realpath });
    f.directory(f.journalDir + '\\sub');
    const alias = f.root + '\\journal-alias';
    f.link(alias, 'journal\\sub');
    const journalPath = alias + '\\..\\journal.jsonl';
    const options = { ...f.options, journalPath };
    const serialized = build(['entry-a']);
    wrote(windowsAnchor.writeAnchoredJournal({ ...options, serialized }));
    verdict(windowsAnchor.verifyAnchoredJournal(options), 'OK');
    assert.equal(windowsAnchor.writeAnchoredJournal({ ...options, serialized }).status, 'UNCHANGED');
    const journalCalls = f.calls.filter(event => event.path.endsWith('journal.jsonl') && !['realpathSync', 'readlinkSync'].includes(event.name));
    assert.ok(journalCalls.length > 0);
    assert.deepEqual([...new Set(journalCalls.map(event => event.path))], [f.journalPath]);
    assert.equal(f.openDescriptors(), 0);
    const inside = windowsFixture({ realpath });
    inside.directory(inside.journalDir + '\\sub');
    inside.link(inside.root + '\\alias', 'journal\\sub');
    refusesWithoutIO(windowsAnchor, inside, { ...inside.options, anchorDir: inside.root + '\\alias\\..' }, 'ANCHOR_INSIDE_JOURNAL_DIR');
  });
}

test('win32 unresolved link capabilities fail closed before reads or writes', () => {
  for (const realpath of ['absent', 'throws']) {
    for (const readlink of ['absent', 'throws', 'empty', 'nul', 'buffer', 'drive-relative']) {
      const f = windowsFixture({ realpath, readlink });
      const alias = f.root + '\\alias';
      f.link(alias, 'journal');
      if (readlink === 'empty') f.fs.readlinkSync = () => '';
      if (readlink === 'nul') f.fs.readlinkSync = () => '\0';
      if (readlink === 'buffer') f.fs.readlinkSync = () => Buffer.from('journal');
      if (readlink === 'drive-relative') f.fs.readlinkSync = () => 'C:journal';
      refusesWithoutIO(windowsAnchor, f, { ...f.options, anchorDir: alias }, 'ANCHOR_PATH_UNRESOLVED');
      refusesWithoutIO(windowsAnchor, f, { ...f.options, journalPath: alias + '\\journal.jsonl' }, 'ANCHOR_PATH_UNRESOLVED');
    }
  }
  // Neither a following stat capability nor working realpath requires readlink.
  const canonical = windowsFixture({ realpath: 'present', readlink: 'absent', stat: 'absent' });
  canonical.link(canonical.root + '\\alias', 'journal');
  refusesWithoutIO(windowsAnchor, canonical, { ...canonical.options, anchorDir: canonical.root + '\\alias' }, 'ANCHOR_INSIDE_JOURNAL_DIR');
  const ordinary = windowsFixture({ readlink: 'absent', stat: 'absent' });
  wrote(windowsAnchor.writeAnchoredJournal({ ...ordinary.options, serialized: build(['entry-a']) }));
  verdict(windowsAnchor.verifyAnchoredJournal(ordinary.options), 'OK');
  assert.equal(ordinary.openDescriptors(), 0);
});

// Node on Windows strips a trailing separator before the call (path.toNamespacedPath);
// the path model's normalize-then-lookup does the same, so this reproduces that host.
test('win32 a trailing separator on the journal path is not stripped into the journal file', () => {
  const serialized = build(['entry-a']);
  const longer = build(['entry-a', 'entry-b']);
  const journalKey = path => path.toLowerCase();
  for (const separator of ['\\', '/']) {
    // A regular journal file: refused as POSIX refuses it (ENOTDIR), and nothing changes.
    const f = windowsFixture();
    wrote(windowsAnchor.writeAnchoredJournal({ ...f.options, serialized }));
    verdict(windowsAnchor.verifyAnchoredJournal(f.options), 'OK');
    const before = f.snapshot();
    const writes = f.writes.length;
    const options = { ...f.options, journalPath: f.journalPath + separator };
    assert.deepEqual(windowsAnchor.verifyAnchoredJournal(options), { status: 'JOURNAL_NOT_COMPLETE', ok: false, cause: 'READ_FAILED' });
    for (const call of [windowsAnchor.writeAnchoredJournal, windowsAnchor.reanchorJournal]) {
      assert.deepEqual(call({ ...options, serialized: longer }), { status: 'REFUSED', reason: 'JOURNAL_NOT_COMPLETE', cause: 'READ_FAILED' });
    }
    assert.deepEqual(windowsAnchor.adoptJournal(options), { status: 'REFUSED', reason: 'ANCHOR_EXISTS' });
    assert.deepEqual(f.snapshot(), before);
    assert.equal(f.writes.length, writes);
    assert.equal(f.openDescriptors(), 0);
    verdict(windowsAnchor.verifyAnchoredJournal(f.options), 'OK');

    // No anchor yet: an existing journal is still refused before the anchor is written.
    const unanchored = windowsFixture();
    unanchored.file(unanchored.journalPath, serialized);
    const unanchoredOptions = { ...unanchored.options, journalPath: unanchored.journalPath + separator };
    assert.deepEqual(windowsAnchor.writeAnchoredJournal({ ...unanchoredOptions, serialized: longer }), { status: 'REFUSED', reason: 'JOURNAL_NOT_COMPLETE', cause: 'READ_FAILED' });
    assert.deepEqual(windowsAnchor.adoptJournal(unanchoredOptions), { status: 'REFUSED', reason: 'JOURNAL_NOT_COMPLETE', cause: 'READ_FAILED' });
    assert.deepEqual(unanchored.writes, []);

    // No journal and no anchor: a write must not create the stripped journal file.
    const fresh = windowsFixture();
    const created = windowsAnchor.writeAnchoredJournal({ ...fresh.options, journalPath: fresh.journalPath + separator, serialized });
    assert.equal(created.status, 'REFUSED');
    assert.equal(created.committed, false);
    assert.ok(!fresh.snapshot().some(([name]) => name === journalKey(fresh.journalPath)));
    assert.equal(fresh.openDescriptors(), 0);

    // A directory at the path is still a directory and not a file, as on POSIX.
    const folder = windowsFixture();
    wrote(windowsAnchor.writeAnchoredJournal({ ...folder.options, serialized }));
    const folderPath = folder.journalDir + '\\folder';
    folder.directory(folderPath);
    assert.deepEqual(windowsAnchor.verifyAnchoredJournal({ ...folder.options, journalPath: folderPath + separator }), { status: 'JOURNAL_NOT_COMPLETE', ok: false, cause: 'NOT_A_FILE' });
  }
});

test('win32 link cycles, component limits and unproven root are refused', () => {
  for (const kind of ['self', 'mutual', 'too-deep']) {
    const f = windowsFixture();
    const alias = f.root + '\\link-0';
    if (kind === 'self') f.link(alias, 'link-0');
    if (kind === 'mutual') { f.link(alias, 'link-1'); f.link(f.root + '\\link-1', 'link-0'); }
    if (kind === 'too-deep') {
      for (let index = 0; index < 41; index++) f.link(f.root + '\\link-' + index, index === 40 ? 'anchor' : 'link-' + (index + 1));
    }
    refusesWithoutIO(windowsAnchor, f, { ...f.options, anchorDir: alias }, 'ANCHOR_PATH_UNRESOLVED');
    assert.ok(f.calls.filter(event => event.name === 'readlinkSync').length <= 4 * 40);
  }
  const boundary = windowsFixture();
  for (let index = 0; index < 40; index++) boundary.link(boundary.root + '\\link-' + index, index === 39 ? 'anchor' : 'link-' + (index + 1));
  wrote(windowsAnchor.writeAnchoredJournal({ ...boundary.options, anchorDir: boundary.root + '\\link-0', serialized: build(['entry-a']) }));
  const components = windowsFixture();
  refusesWithoutIO(windowsAnchor, components, { ...components.options, anchorDir: components.anchorDir + '\\x'.repeat(4097) }, 'ANCHOR_PATH_UNRESOLVED');
  // Refusal must come from bounded component work, not a later ancestry bound.
  assert.ok(components.calls.filter(event => event.name === 'lstatSync').length <= 4 * (4096 + 2));
  // IDs that never repeat, including at root, cannot turn an unbounded walk into permission.
  const ancestry = windowsFixture();
  const lstat = ancestry.fs.lstatSync;
  let inode = 2n ** 61n;
  ancestry.fs.lstatSync = (...args) => ({ ...lstat(...args), ino: ++inode });
  refusesWithoutIO(windowsAnchor, ancestry, ancestry.options, 'ANCHOR_PATH_UNRESOLVED');
});

test('win32 unknown ancestry and broken directory metadata are refused', () => {
  for (const field of ['dev', 'ino']) for (const identity of [null, undefined, Number.MAX_SAFE_INTEGER + 1, {}, -1n, ...(field === 'ino' ? [0n] : [])]) {
    const f = windowsFixture();
    const lstat = f.fs.lstatSync;
    f.fs.lstatSync = (...args) => {
      const stat = lstat(...args);
      return { ...stat, [field]: identity };
    };
    refusesWithoutIO(windowsAnchor, f, f.options, 'ANCHOR_PATH_UNRESOLVED');
  }
  for (const capability of ['error', 'shape', 'not-directory']) {
    const f = windowsFixture();
    const lstat = f.fs.lstatSync;
    f.fs.lstatSync = (...args) => {
      if (args[0] !== f.anchorDir) return lstat(...args);
      if (capability === 'error') throw eio();
      if (capability === 'shape') return {};
      return { isSymbolicLink: () => false, isDirectory: () => false };
    };
    refusesWithoutIO(windowsAnchor, f, f.options, 'ANCHOR_PATH_UNRESOLVED');
  }
  const missing = windowsFixture();
  refusesWithoutIO(windowsAnchor, missing, { ...missing.options, anchorDir: missing.anchorDir + '\\absent\\..' }, 'ANCHOR_PATH_UNRESOLVED');
  verdict(windowsAnchor.verifyAnchoredJournal({ ...missing.options, anchorDir: missing.anchorDir + '\\absent' }), 'ANCHOR_MISSING');
});

test('native optional realpath fallback keeps physical parent and refusal semantics', t => {
  const f = fixture(t);
  const sub = join(f.journalDir, 'sub');
  const alias = join(f.root, 'alias');
  realFs.mkdirSync(sub);
  // Keep the cross-platform graph controls above even on hosts without symlink privilege.
  try { realFs.symlinkSync(sub, alias, 'dir'); }
  catch { t.diagnostic('NOT_RUN: native directory symlink creation unavailable'); return; }
  for (const mode of ['absent', 'throws']) {
    const fs = makeFs();
    if (mode === 'absent') delete fs.realpathSync;
    else fs.realpathSync = () => { throw eio(); };
    const options = { ...f.ctx, fs, journalPath: alias + '/..//journal.jsonl' };
    wrote(writeAnchoredJournal({ ...options, serialized: build(['entry-a']) }));
    verdict(verifyAnchoredJournal(options), 'OK');
    const inside = { ...options, anchorDir: alias + '/..' };
    verdict(verifyAnchoredJournal(inside), 'ANCHOR_INSIDE_JOURNAL_DIR');
    for (const call of [writeAnchoredJournal, adoptJournal, reanchorJournal]) {
      assert.equal(call({ ...inside, serialized: build(['entry-a']) }).reason, 'ANCHOR_INSIDE_JOURNAL_DIR');
    }
    // Make the next pass create a fresh journal/anchor pair.
    realFs.unlinkSync(f.journalPath);
    realFs.unlinkSync(f.anchorPath);
  }
});


test('win32 link targets retain relative parents and current-volume roots', () => {
  for (const target of ['journal\\sub\\..\\anchors', '\\fixture\\journal\\anchors']) {
    const f = windowsFixture();
    f.directory(f.journalDir + '\\sub');
    f.directory(f.journalDir + '\\anchors');
    f.link(f.root + '\\alias', target);
    refusesWithoutIO(windowsAnchor, f, { ...f.options, anchorDir: f.root + '\\alias' }, 'ANCHOR_INSIDE_JOURNAL_DIR');
  }
});

test('POSIX physical identity traversal stops at its work limit', async () => {
  const api = await loadAnchorWithPaths('posix');
  let inode = 100n;
  let stats = 0;
  let opens = 0;
  const fs = Object.fromEntries(NAMES.map(name => [name, () => { opens++; throw eio(); }]));
  delete fs.realpathSync;
  fs.lstatSync = path => {
    stats++;
    return { isDirectory: () => true, isSymbolicLink: () => false, dev: 7n, ino: path === '/journal' ? 2n : ++inode };
  };
  assert.deepEqual(api.verifyAnchoredJournal({ journalPath: '/journal/input.jsonl', anchorDir: '/anchor', key: 'bounded-key', fs }),
    { status: 'ANCHOR_PATH_UNRESOLVED', ok: false });
  // Two directory components, journal/root identities, then the capped parent walk.
  assert.equal(stats, 2 + 2 + 4096);
  assert.equal(opens, 0);
});

test('native broken optional link capabilities preserve journal and anchor bytes', t => {
  const f = fixture(t);
  wrote(put(f, build(['entry-a'])));
  const heldJournal = realFs.readFileSync(f.journalPath);
  const heldAnchor = realFs.readFileSync(f.anchorPath);
  const alias = join(f.root, 'alias');
  try { realFs.symlinkSync(f.journalDir, alias, 'dir'); }
  catch { t.diagnostic('NOT_RUN: native directory symlink creation unavailable'); return; }
  for (const realpath of ['absent', 'throws']) for (const readlink of ['absent', 'throws']) {
    let io = 0;
    const fs = makeFs(Object.fromEntries(['openSync', 'readFileSync', 'writeSync', 'renameSync', 'unlinkSync'].map(name => [name, () => { io++; throw eio(); }])));
    if (realpath === 'absent') delete fs.realpathSync;
    else fs.realpathSync = () => { throw eio(); };
    if (readlink === 'absent') delete fs.readlinkSync;
    else fs.readlinkSync = () => { throw eio(); };
    for (const options of [{ ...f.ctx, fs, anchorDir: alias }, { ...f.ctx, fs, journalPath: join(alias, 'journal.jsonl') }]) {
      assert.deepEqual(verifyAnchoredJournal(options), { status: 'ANCHOR_PATH_UNRESOLVED', ok: false });
      for (const call of [writeAnchoredJournal, adoptJournal, reanchorJournal]) {
        assert.deepEqual(call({ ...options, serialized: build(['entry-a']) }), { status: 'REFUSED', reason: 'ANCHOR_PATH_UNRESOLVED' });
      }
    }
    assert.equal(io, 0);
    assert.deepEqual(realFs.readFileSync(f.journalPath), heldJournal);
    assert.deepEqual(realFs.readFileSync(f.anchorPath), heldAnchor);
  }
});


test('POSIX fallback never retries realpath on a physical alias parent', async () => {
  const api = await loadAnchorWithPaths('posix');
  const directories = new Map([['/', 1n], ['/spelled', 2n], ['/journal', 3n], ['/journal/sub', 4n]]);
  const physical = path => posix.normalize(path.replace(/^\/spelled\/alias(?=\/|$)/, '/journal/sub').replace(/^\/virtual\/volume\/alias(?=\/|$)/, '/journal/sub'));
  const canonicalCalls = [];
  let io = 0;
  const fs = Object.fromEntries(NAMES.map(name => [name, () => { io++; throw eio(); }]));
  fs.lstatSync = path => {
    const inode = directories.get(physical(path));
    if (inode === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return { isDirectory: () => true, isSymbolicLink: () => false, dev: 7n, ino: inode };
  };
  fs.realpathSync = path => {
    canonicalCalls.push(path);
    if (path === '/spelled/alias') throw eio();
    const lexical = posix.normalize(path);
    if (!directories.has(lexical)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return lexical;
  };
  const options = { journalPath: '/spelled/alias/../journal.jsonl', anchorDir: '/journal', key: 'physical-alias-key', fs };
  assert.deepEqual(api.verifyAnchoredJournal(options), { status: 'ANCHOR_INSIDE_JOURNAL_DIR', ok: false });
  for (const call of [api.writeAnchoredJournal, api.adoptJournal, api.reanchorJournal]) {
    assert.equal(call({ ...options, serialized: build(['entry-a']) }).reason, 'ANCHOR_INSIDE_JOURNAL_DIR');
  }
  assert.equal(canonicalCalls.some(path => path.startsWith('/spelled/alias/')), false);
  const virtual = { ...options, journalPath: '/virtual/volume/alias/../journal.jsonl' };
  assert.deepEqual(api.verifyAnchoredJournal(virtual), { status: 'ANCHOR_INSIDE_JOURNAL_DIR', ok: false });
  assert.equal(io, 0);
});


test('POSIX virtual symlinks require a proven parent for relative targets', async () => {
  const api = await loadAnchorWithPaths('posix');
  const directories = new Map([['/', 1n], ['/virtual', 2n], ['/journal', 3n], ['/anchor', 4n]]);
  let target = 'sibling';
  let io = 0;
  const fs = Object.fromEntries(NAMES.map(name => [name, () => { io++; throw eio(); }]));
  delete fs.realpathSync;
  fs.lstatSync = path => {
    const symlink = path === '/virtual/volume/link';
    const physical = posix.normalize(path.replace(/^\/virtual\/volume\/sibling(?=\/|$)/, '/anchor'));
    const inode = symlink ? 5n : directories.get(physical);
    if (inode === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return { isDirectory: () => !symlink, isSymbolicLink: () => symlink, dev: 7n, ino: inode };
  };
  fs.readlinkSync = () => target;
  const options = { journalPath: '/journal/input.jsonl', anchorDir: '/virtual/volume/link', key: 'virtual-link-key', fs };
  assert.deepEqual(api.verifyAnchoredJournal(options), { status: 'ANCHOR_PATH_UNRESOLVED', ok: false });
  for (const call of [api.writeAnchoredJournal, api.adoptJournal, api.reanchorJournal]) {
    assert.deepEqual(call({ ...options, serialized: build(['entry-a']) }), { status: 'REFUSED', reason: 'ANCHOR_PATH_UNRESOLVED' });
  }
  target = '/anchor';
  verdict(api.verifyAnchoredJournal(options), 'ANCHOR_MISSING');
  assert.equal(io, 0);
});
