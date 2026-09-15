import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRunJournal, reopen } from '../../../history/run-journal-v1.mjs';
import { writeSerializedJournal, readSerializedJournal } from '../src/run-journal-store-v1.mjs';

const dir = fs.mkdtempSync(join(tmpdir(), 'nisi-store-owner-'));
try {
  const path = join(dir, 'journal.jsonl');
  const journal = createRunJournal({ projectId: 'owner', maxEntries: 2, heartbeatTtlMs: 10, redactPaths: [] });
  for (let n = 1; n <= 3; n++) {
    assert.equal(journal.append({ id: 'e' + n, projectId: 'owner', runId: 'run', attempt: 0, candidateId: 'candidate', stage: 'test', receiptId: null, createdAt: n, ttlMs: 100, state: 'SUCCEEDED', heartbeatAt: null, retryOf: null, revokes: null, payload: { text: 'café 🌱', n } }, n).status, 'APPENDED');
  }
  const serialized = journal.serialize();
  const stored = writeSerializedJournal({ path, serialized, fs });
  assert.equal(stored.status, 'WRITTEN');
  const loaded = readSerializedJournal({ path, fs });
  assert.equal(loaded.status, 'READ');
  assert.equal(loaded.serialized, serialized);
  assert.equal(loaded.durable, false);
  const result = reopen(loaded.serialized);
  assert.equal(result.report.status, 'COMPLETE');
  assert.equal(result.journal.serialize(), serialized);
  assert.ok(result.journal.list(3).every(view => view.historical && view.authorizing === false));
  assert.equal(result.journal.list(3)[0].retained, false);
  console.log(JSON.stringify({ status: 'PASS_SCOPED', observations: 3, retained: 2, reopened: 'COMPLETE', byteMatch: true, historical: true, authorizing: false, writeDurableObserved: stored.durable, readDurable: loaded.durable, sha256: createHash('sha256').update(serialized).digest('hex'), scope: 'same-process product serializer/store/reopen compatibility; no host integration or crash acceptance' }, null, 2));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
