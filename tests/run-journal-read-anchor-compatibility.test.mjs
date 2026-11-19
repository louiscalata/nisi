// SPDX-License-Identifier: Apache-2.0
// The anchor consumes the store's bounded reads and conversion refusals.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as realFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunJournal } from '../history/run-journal-v1.mjs';
import {
  adoptJournal, anchorFileName, reanchorJournal, verifyAnchoredJournal, writeAnchoredJournal,
} from '../history/run-journal-anchor-v1.mjs';

function build(ids) {
  const journal = createRunJournal({ projectId: 'compatibility', maxEntries: 8, heartbeatTtlMs: 10, redactPaths: [] });
  for (const id of ids) {
    assert.equal(journal.append({
      id, projectId: 'compatibility', runId: 'run-a', attempt: 0, candidateId: 'candidate-a',
      stage: 'test', receiptId: 'receipt-a', createdAt: 100, ttlMs: 1000,
      state: 'SUCCEEDED', heartbeatAt: null, retryOf: null, revokes: null,
      payload: { note: 'small synthetic fixture' },
    }, 100).status, 'APPENDED');
  }
  return journal.serialize(100);
}

const beforeText = build(['entry-a']);
const afterText = build(['entry-a', 'entry-b']);
const consumers = {
  verify: options => verifyAnchoredJournal(options),
  adopt: options => adoptJournal(options),
  reanchor: options => reanchorJournal(options),
  write: options => writeAnchoredJournal({ ...options, serialized: afterText }),
};
const refusedRead = (consumer, cause) => consumer === 'verify'
  ? { status: 'JOURNAL_NOT_COMPLETE', ok: false, cause }
  : { status: 'REFUSED', reason: 'JOURNAL_NOT_COMPLETE', cause };

function fixture(t, consumer) {
  const root = realFs.mkdtempSync(join(tmpdir(), 'nisi-read-anchor-'));
  t.after(() => realFs.rmSync(root, { recursive: true, force: true }));
  const journalDir = join(root, 'journal');
  const anchorDir = join(root, 'anchor');
  realFs.mkdirSync(journalDir);
  realFs.mkdirSync(anchorDir);
  const journalPath = join(journalDir, 'journal.jsonl');
  const key = 'compatibility-key';
  const anchorPath = join(anchorDir, anchorFileName(key));
  const options = { journalPath, anchorDir, key, fs: realFs };
  assert.equal(writeAnchoredJournal({ ...options, serialized: beforeText }).status, 'WRITTEN');
  assert.equal(verifyAnchoredJournal(options).status, 'OK');
  if (consumer === 'adopt') realFs.unlinkSync(anchorPath);
  return { journalPath, anchorPath, options };
}

function observedFs(f, { sizeDelta = 0, existingBytes, failClear = false } = {}) {
  const descriptors = new Map();
  const evidence = { journalCloses: 0, journalMutations: 0, anchorAttempts: [] };
  const journalFile = path => typeof path === 'string' && (path === f.journalPath || path.startsWith(f.journalPath + '.'));
  const fs = {
    ...realFs,
    openSync(path, flags, ...args) {
      if (journalFile(path) && typeof flags === 'string' && /[wax+]/.test(flags)) evidence.journalMutations++;
      const fd = realFs.openSync(path, flags, ...args);
      descriptors.set(fd, path);
      return fd;
    },
    fstatSync(fd, ...args) {
      const stat = realFs.fstatSync(fd, ...args);
      return descriptors.get(fd) === f.journalPath && sizeDelta !== 0
        ? { isFile: () => stat.isFile(), size: stat.size + sizeDelta }
        : stat;
    },
    closeSync(fd) {
      if (descriptors.get(fd) === f.journalPath) evidence.journalCloses++;
      try { return realFs.closeSync(fd); }
      finally { descriptors.delete(fd); }
    },
    readFileSync(path, ...args) {
      return path === f.journalPath && existingBytes !== undefined
        ? existingBytes
        : realFs.readFileSync(path, ...args);
    },
    writeSync(fd, ...args) {
      if (journalFile(descriptors.get(fd))) evidence.journalMutations++;
      return realFs.writeSync(fd, ...args);
    },
    renameSync(source, destination) {
      if (journalFile(source) || journalFile(destination)) evidence.journalMutations++;
      if (destination === f.anchorPath) {
        evidence.anchorAttempts.push(JSON.parse(realFs.readFileSync(source, 'utf8')));
        if (failClear && evidence.anchorAttempts.length === 2) throw Object.assign(new Error('synthetic rename failure'), { code: 'EIO' });
      }
      return realFs.renameSync(source, destination);
    },
    unlinkSync(path) {
      if (journalFile(path)) evidence.journalMutations++;
      return realFs.unlinkSync(path);
    },
  };
  return { fs, evidence };
}

const snapshotAnchor = f => realFs.existsSync(f.anchorPath) ? realFs.readFileSync(f.anchorPath) : null;
function unchanged(f, journal, anchor) {
  assert.deepEqual(realFs.readFileSync(f.journalPath), journal);
  assert.deepEqual(snapshotAnchor(f), anchor);
}

test('anchor consumers preserve exact store shrink and growth refusals', async t => {
  for (const [change, sizeDelta] of [['shrink', 1], ['growth', -1]]) {
    for (const [consumer, run] of Object.entries(consumers)) {
      await t.test(`${consumer}: ${change}`, t => {
        const f = fixture(t, consumer);
        const journal = realFs.readFileSync(f.journalPath);
        const anchor = snapshotAnchor(f);
        const { fs, evidence } = observedFs(f, { sizeDelta });
        // The disk bytes remain a complete journal. Only the descriptor's observed
        // size differs, so accepting a valid prefix would lose FILE_CHANGED.
        assert.deepEqual(run({ ...f.options, fs }), refusedRead(consumer, 'FILE_CHANGED'));
        assert.equal(evidence.journalCloses, 1);
        assert.equal(evidence.journalMutations, 0);
        assert.deepEqual(evidence.anchorAttempts, []);
        unchanged(f, journal, anchor);
      });
    }
  }
});

test('anchor consumers preserve store UTF-8 conversion failures as READ_FAILED', async t => {
  for (const conversion of ['toString', 'from']) {
    for (const [consumer, run] of Object.entries(consumers)) {
      await t.test(`${consumer}: ${conversion}`, t => {
        const f = fixture(t, consumer);
        const journal = realFs.readFileSync(f.journalPath);
        const anchor = snapshotAnchor(f);
        const { fs, evidence } = observedFs(f);
        const fail = () => { throw Object.assign(new RangeError('synthetic conversion failure'), { code: 'ERR_STRING_TOO_LONG' }); };
        let mock;
        if (conversion === 'toString') {
          const original = Buffer.prototype.toString;
          mock = t.mock.method(Buffer.prototype, 'toString', function (encoding, ...args) {
            return encoding === 'utf8' && this.equals(journal) ? fail() : original.call(this, encoding, ...args);
          });
        } else {
          const original = Buffer.from;
          mock = t.mock.method(Buffer, 'from', function (value, encoding, ...args) {
            return value === beforeText && encoding === 'utf8' ? fail() : original.call(this, value, encoding, ...args);
          });
        }
        try {
          assert.deepEqual(run({ ...f.options, fs }), refusedRead(consumer, 'READ_FAILED'));
        } finally { mock.mock.restore(); }
        assert.equal(evidence.journalCloses, 1);
        assert.equal(evidence.journalMutations, 0);
        assert.deepEqual(evidence.anchorAttempts, []);
        unchanged(f, journal, anchor);
      });
    }
  }
});

test('an existing destination conversion fault refuses before journal writes and reports pending cleanup', async t => {
  for (const failClear of [false, true]) {
    await t.test(failClear ? 'pending clear fails' : 'pending clear succeeds', t => {
      const f = fixture(t, 'write');
      const journal = realFs.readFileSync(f.journalPath);
      const anchorBytes = realFs.readFileSync(f.anchorPath);
      const anchor = JSON.parse(anchorBytes);
      const failing = Buffer.from(journal);
      Object.defineProperty(failing, 'toString', {
        value() { throw Object.assign(new RangeError('synthetic conversion failure'), { code: 'ERR_STRING_TOO_LONG' }); },
      });
      // The anchor's descriptor pre-read succeeds. The store alone receives this
      // Buffer from its later readFileSync of the existing destination.
      const { fs, evidence } = observedFs(f, { existingBytes: failing, failClear });
      assert.deepEqual(writeAnchoredJournal({ ...f.options, fs, serialized: afterText }), {
        status: 'REFUSED', reason: 'EXISTING_INVALID', committed: false, durable: false, cleared: !failClear,
      });
      assert.equal(evidence.journalCloses, 1);
      assert.equal(evidence.journalMutations, 0);
      assert.deepEqual(realFs.readFileSync(f.journalPath), journal);
      assert.equal(evidence.anchorAttempts.length, 2);
      const [pending, cleared] = evidence.anchorAttempts;
      assert.deepEqual(pending.current, anchor.current);
      assert.equal(pending.pending.generation, anchor.current.generation + 1);
      assert.deepEqual(cleared, anchor);
      if (failClear) {
        assert.deepEqual(JSON.parse(realFs.readFileSync(f.anchorPath)), pending);
      } else {
        assert.deepEqual(realFs.readFileSync(f.anchorPath), anchorBytes);
      }
    });
  }
});
