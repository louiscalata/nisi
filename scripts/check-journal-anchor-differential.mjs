// SPDX-License-Identifier: Apache-2.0
// Deterministic, synthetic anchor differential. No filesystem writes or network I/O.
// Run from a source checkout: node scripts/check-journal-anchor-differential.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, normalize, resolve } from 'node:path';
import { createRunJournal } from '../history/run-journal-v1.mjs';
import { describeJournal, verifyAnchoredJournal } from '../history/run-journal-anchor-v1.mjs';

// Expected hashes and bytes come from the documented domains and parsed records,
// independently of the anchor's description, encoding, filename and judging code.
// Generated objects have nonnumeric property names, so sorted JSON properties
// retain their order when JSON.stringify emits the independently sorted tree.
const canonical = value => JSON.stringify(value, (_key, child) => {
  if (child === null || typeof child !== 'object' || Array.isArray(child)) return child;
  return Object.fromEntries(Object.entries(child).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
});
const sha256 = value => createHash('sha256').update(value).digest('hex');
const prefix = 'nisi-journal-anchor/';
const zero = '0'.repeat(64);
const changedHash = hash => (hash[0] === '0' ? '1' : '0') + hash.slice(1);
const totals = {
  generatedJournals: 0,
  descriptionComparisons: 0,
  independentFingerprints: 0,
  independentRecordHashes: 0,
  verificationComparisons: 0,
  malformedHashComparisons: 0,
  negativeControls: 0,
  statuses: {},
};

function independentDescription(serialized) {
  const parsed = serialized.trimEnd().split('\n').map(line => JSON.parse(line));
  const header = parsed.shift();
  const footer = parsed.pop();
  let previous = sha256('nisi-run-journal/header/v1\n' + canonical(header));
  const seed = sha256(prefix + 'seed/v1\n' + canonical({ projectId: header.config.projectId }));
  const stems = [];
  const chain = [seed];
  const rows = [];
  for (const [index, row] of parsed.entries()) {
    assert.equal(row.seq, index + 1);
    assert.equal(row.previousHash, previous);
    previous = sha256('nisi-run-journal/record/v1\n' + canonical({
      seq: row.seq, previousHash: previous, record: row.record,
    }));
    assert.equal(row.hash, previous);
    totals.independentRecordHashes++;
    const fingerprint = sha256('nisi-run-journal/input/v1\n' + canonical(row.record.entry));
    assert.equal(row.record.fingerprint, fingerprint);
    totals.independentFingerprints++;
    const entryWithoutPayload = { ...row.record.entry, payload: null };
    const stem = sha256(prefix + 'stem/v1\n' + canonical(entryWithoutPayload));
    stems.push(stem);
    chain.push(sha256(prefix + 'step/v1\n' + chain[chain.length - 1] + '\n' + stem));
    rows.push({ retained: row.record.retained, fingerprint });
  }
  assert.equal(footer.count, parsed.length);
  assert.equal(footer.lastHash, previous);
  return {
    projectId: header.config.projectId,
    count: parsed.length,
    lastHash: previous,
    seed,
    stems,
    chain,
    rows,
    stemTip: chain[chain.length - 1],
    fileSha256: sha256(Buffer.from(serialized, 'utf8')),
  };
}

function state(description, generation = 7) {
  return {
    count: description.count,
    fileSha256: description.fileSha256,
    generation,
    journalSchema: 'nisi-run-journal-v1',
    lastHash: description.lastHash,
    projectId: description.projectId,
    stemTip: description.stemTip,
  };
}

// A read-only filesystem stand-in. Files contain only generated journal/anchor
// bytes, descriptor reads use ordinary small Buffers, and mutation methods fail.
function memoryContext(serialized, document) {
  const root = resolve('journal-anchor-differential-memory');
  const journalDir = join(root, 'journals');
  const anchorDir = join(root, 'anchors');
  const journalPath = join(journalDir, 'input.jsonl');
  const key = 'synthetic-anchor-key';
  const anchorPath = join(anchorDir, sha256(Buffer.from(key, 'utf8')) + '.anchor.json');
  const files = new Map([[journalPath, Buffer.from(serialized, 'utf8')]]);
  if (document !== null) files.set(anchorPath, Buffer.from(canonical(document) + '\n', 'utf8'));
  const directories = new Map([[root, 11], [journalDir, 12], [anchorDir, 13]]);
  const descriptors = new Map();
  let nextDescriptor = 1;
  const missing = () => { throw Object.assign(new Error('synthetic missing file'), { code: 'ENOENT' }); };
  const mutation = () => { throw new Error('read-only synthetic filesystem'); };
  const stat = path => {
    const name = normalize(path);
    if (files.has(name)) return {
      size: files.get(name).length,
      isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false,
    };
    if (directories.has(name)) return {
      dev: 1n, ino: BigInt(directories.get(name)), size: 0,
      isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false,
    };
    return missing();
  };
  const filesystem = {
    realpathSync: path => normalize(path),
    lstatSync: stat,
    openSync(path, flags) {
      assert.equal(flags, 'r');
      const data = files.get(normalize(path));
      if (data === undefined) return missing();
      const fd = nextDescriptor++;
      descriptors.set(fd, { data, offset: 0 });
      return fd;
    },
    fstatSync(fd) {
      const descriptor = descriptors.get(fd);
      assert.ok(descriptor);
      return { size: descriptor.data.length, isFile: () => true };
    },
    readSync(fd, buffer, offset, length) {
      const descriptor = descriptors.get(fd);
      assert.ok(descriptor);
      const count = Math.min(length, descriptor.data.length - descriptor.offset);
      descriptor.data.copy(buffer, offset, descriptor.offset, descriptor.offset + count);
      descriptor.offset += count;
      return count;
    },
    readFileSync(path) {
      const bytes = files.get(normalize(path));
      return bytes === undefined ? missing() : Buffer.from(bytes);
    },
    closeSync(fd) { assert.equal(descriptors.delete(fd), true); },
    writeSync: mutation, renameSync: mutation, unlinkSync: mutation,
  };
  return {
    options: { journalPath, anchorDir, key, fs: filesystem },
    assertClosed() { assert.equal(descriptors.size, 0); },
  };
}

function checkVerdict(serialized, description, current, pending, status) {
  const document = { current, pending, schema: 'nisi-journal-anchor-v1' };
  const fixture = memoryContext(serialized, document);
  const expected = {
    status, ok: status === 'OK' || status === 'OK_PENDING',
    generation: current.generation, anchorCount: current.count,
    journalCount: description.count, sha256: description.fileSha256,
  };
  assert.deepEqual(verifyAnchoredJournal(fixture.options), expected);
  fixture.assertClosed();
  totals.verificationComparisons++;
  totals.statuses[status] = (totals.statuses[status] ?? 0) + 1;
}

const unicode = ['plain', 'caf\u00e9', '\u65e5\u672c\u8a9e', '\ud83e\udded\ud83c\udf3f', 'e\u0301', 'line\nquote"slash\\'];
const redactions = [[], ['payload.secret'], ['payload.nested.private'], ['payload.secret', 'payload.nested.private']];
const generationSeed = 0x1a63;
const inputHash = createHash('sha256');
for (let sample = 0; sample < 2048; sample++) {
  const index = generationSeed + sample;
  const projectId = 'project-' + index;
  const maxEntries = 1 + index % 7;
  const count = index % 12;
  const firstTime = 100 + index % 17;
  const journal = createRunJournal({
    projectId, maxEntries, heartbeatTtlMs: 1 + index % 31,
    redactPaths: redactions[index % redactions.length],
  });
  for (let entryIndex = 0; entryIndex < count; entryIndex++) {
    const createdAt = firstTime + entryIndex * 3;
    const entry = {
      id: 'entry-' + entryIndex, projectId,
      runId: 'run-' + index, attempt: entryIndex % 3,
      candidateId: 'candidate-' + entryIndex, stage: 'test', receiptId: 'receipt-' + entryIndex,
      createdAt, ttlMs: 10 + (index + entryIndex) % 29,
      state: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'QUEUED', 'RUNNING'][entryIndex % 5],
      heartbeatAt: entryIndex % 5 === 4 ? createdAt : null,
      retryOf: null, revokes: null,
      payload: {
        zeta: index, alpha: unicode[(index + entryIndex) % unicode.length],
        secret: 'synthetic-' + index,
        nested: { private: unicode[index % unicode.length], values: [null, true, entryIndex] },
      },
    };
    assert.equal(journal.append(entry, createdAt).status, 'APPENDED');
  }
  const now = firstTime + Math.max(0, count - 1) * 3 + index % 41;
  const serialized = journal.serialize(now);
  inputHash.update(String(Buffer.byteLength(serialized)) + ':').update(serialized);
  const description = independentDescription(serialized);
  assert.deepEqual(describeJournal(serialized), description);
  totals.generatedJournals++;
  totals.descriptionComparisons++;

  const current = state(description, 1 + index % 29);
  checkVerdict(serialized, description, current, null, 'OK');
  checkVerdict(serialized, description, {
    ...current, fileSha256: zero, count: 0, lastHash: zero, stemTip: description.seed,
  }, { ...current, generation: current.generation + 1 }, 'OK_PENDING');
  checkVerdict(serialized, description, { ...current, projectId: 'other-' + index }, null, 'ANCHOR_PROJECT');
  checkVerdict(serialized, description, {
    ...current, fileSha256: changedHash(current.fileSha256), count: current.count + 1,
  }, null, 'ROLLED_BACK');
  checkVerdict(serialized, description, {
    ...current, fileSha256: changedHash(current.fileSha256),
  }, null, 'CONTENT_DIFFERS');
  checkVerdict(serialized, description, {
    ...current, fileSha256: changedHash(current.fileSha256), stemTip: changedHash(current.stemTip),
  }, null, 'DIVERGED');
  if (description.count > 0) {
    checkVerdict(serialized, description, {
      ...current, fileSha256: changedHash(current.fileSha256), count: current.count - 1,
      stemTip: description.chain[current.count - 1],
    }, null, 'AHEAD');
  }

  for (const slot of ['current', 'pending']) {
    for (const field of ['fileSha256', 'lastHash', 'stemTip']) {
      const document = {
        current: { ...current },
        pending: slot === 'pending' ? { ...current, generation: current.generation + 1 } : null,
        schema: 'nisi-journal-anchor-v1',
      };
      document[slot][field] = [document[slot][field]];
      const fixture = memoryContext(serialized, document);
      assert.deepEqual(verifyAnchoredJournal(fixture.options), {
        status: 'ANCHOR_INVALID', ok: false, cause: 'ANCHOR_FORMAT',
      });
      fixture.assertClosed();
      totals.malformedHashComparisons++;
    }
  }

  // Controls prove that complete-result comparison distinguishes changed expected
  // fingerprints and changed stem tips, rather than accepting any description.
  if (sample % 128 === 0) {
    const incorrect = structuredClone(description);
    incorrect.stemTip = changedHash(incorrect.stemTip);
    assert.throws(() => assert.deepEqual(describeJournal(serialized), incorrect), { code: 'ERR_ASSERTION' });
    totals.negativeControls++;
    if (incorrect.rows.length > 0) {
      const wrongFingerprint = structuredClone(description);
      wrongFingerprint.rows[0].fingerprint = changedHash(wrongFingerprint.rows[0].fingerprint);
      assert.throws(() => assert.deepEqual(describeJournal(serialized), wrongFingerprint), { code: 'ERR_ASSERTION' });
      totals.negativeControls++;
    }
  }
}

console.log(JSON.stringify({
  status: 'PASS', generationSeed, generator: 'indexed fixtures', ...totals,
  inputSha256: inputHash.digest('hex'),
  runtime: process.version, platform: process.platform, arch: process.arch,
  scope: 'Generated journals and a read-only in-memory filesystem; no native filesystem or race guarantee.',
}, null, 2));
