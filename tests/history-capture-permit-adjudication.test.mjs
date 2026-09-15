import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createFixedXpcHistoryPermit,
  captureFixedXpcHistory,
  revokeFixedXpcHistoryPermit
} from '../history/history-capture-permit-v1.mjs';
import { openJournalOwner } from '../history/journal-owner-v2.mjs';
import { memfs } from './journal-owner-v2.memfs.mjs';
import { CONFIG as BASE_CONFIG, PATH } from './journal-owner-v2.helper.mjs';
import { makeRecord } from './fixtures/fixed-xpc-journal-observation.mjs';

const CONFIG = Object.freeze({ ...BASE_CONFIG, redactPaths: [] });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const SOURCE = JSON.stringify(makeRecord('valid'));
const declaration = (source = SOURCE, overrides = {}) => ({
  schemaVersion: 'nisi-fixed-xpc-history-declaration/v1', declarationId: 'declaration-a',
  projectId: 'project-a', candidateId: 'candidate-a', receiptId: 'receipt-a',
  consentClass: 'WRITTEN_DECLARATION', sourceSha256: sha256(source), issuedAt: 100,
  expiresAt: 200, createdAt: 100, retentionMs: 1000,
  destination: 'LOCAL_OBSERVATION_JOURNAL_ONLY', rawContentPersisted: false,
  networkEgress: false, learningInfluence: false, ...overrides
});
const open = m => openJournalOwner({ path: PATH, fs: m.fs, config: CONFIG, now: 100 });

test('revocation during the second clock check wins before record admission', () => {
  const m = memfs(); const owner = open(m).owner; let created; let calls = 0; let revoked;
  const clock = () => {
    calls++;
    if (calls === 3) revoked = revokeFixedXpcHistoryPermit({ permit: created.permit });
    return 100;
  };
  created = createFixedXpcHistoryPermit({ owner, declaration: declaration(), clock });
  const result = captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE });
  assert.equal(revoked.status, 'REVOKED');
  assert.equal(result.status, 'REFUSED');
  assert.equal(result.reason, 'PERMIT_REVOKED');
  assert.equal(result.recordAttempted, false);
  assert.equal(result.journal, null);
  assert.equal(m.bytes(PATH), undefined);
});

test('expiry arising only at the second clock check is precise once and permanently revokes', () => {
  const m = memfs(); const owner = open(m).owner; const times = [100, 149, 150]; let index = 0;
  const created = createFixedXpcHistoryPermit({
    owner, declaration: declaration(SOURCE, { expiresAt: 150 }),
    clock: () => times[Math.min(index++, times.length - 1)]
  });
  const first = captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE });
  assert.equal(first.status, 'REFUSED');
  assert.equal(first.reason, 'PERMIT_EXPIRED');
  assert.equal(first.recordAttempted, false);
  assert.equal(m.bytes(PATH), undefined);
  assert.equal(captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE }).reason, 'PERMIT_REVOKED');
});

test('reentrant capture from filesystem after admission sees CONSUMED rather than BUSY', () => {
  const m = memfs(); const owner = open(m).owner;
  const created = createFixedXpcHistoryPermit({ owner, declaration: declaration(), clock: () => 100 });
  const original = m.fs.openSync; let nested; let called = false;
  m.fs.openSync = (...args) => {
    if (!called) {
      called = true;
      nested = captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE });
    }
    return original(...args);
  };
  const outer = captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE });
  assert.equal(nested.status, 'REFUSED');
  assert.equal(nested.reason, 'PERMIT_CONSUMED');
  assert.equal(nested.recordAttempted, false);
  assert.equal(outer.status, 'IMPORTED');
  assert.equal(outer.journal.status, 'RECORDED');
});

test('a second permit with changed declaration identity conflicts through bound provenance', () => {
  const m = memfs(); const owner = open(m).owner;
  const first = createFixedXpcHistoryPermit({ owner, declaration: declaration(), clock: () => 100 });
  const second = createFixedXpcHistoryPermit({
    owner, declaration: declaration(SOURCE, { declarationId: 'declaration-b' }), clock: () => 100
  });
  assert.notEqual(first.declarationDigest, second.declarationDigest);
  assert.equal(captureFixedXpcHistory({ permit: first.permit, serializedRecord: SOURCE }).status, 'IMPORTED');
  const changed = captureFixedXpcHistory({ permit: second.permit, serializedRecord: SOURCE });
  assert.equal(changed.status, 'CONFLICT');
  assert.equal(changed.reason, 'ID_CONTENT_MISMATCH');
  assert.equal(changed.recordAttempted, true);
  assert.equal(changed.journal.status, 'CONFLICT');
});

test('source-only poison remains digest-bound input and is absent from result and stored bytes', () => {
  const record = makeRecord('valid');
  const poison = 'PRIVATE-SOURCE-ONLY-POISON-9f23';
  record.commands.push(poison);
  const source = JSON.stringify(record);
  const m = memfs(); const owner = open(m).owner;
  const created = createFixedXpcHistoryPermit({ owner, declaration: declaration(source), clock: () => 100 });
  const result = captureFixedXpcHistory({ permit: created.permit, serializedRecord: source });
  assert.equal(result.status, 'IMPORTED');
  assert.equal(JSON.stringify(result).includes(poison), false);
  assert.equal(m.bytes(PATH).includes(Buffer.from(poison)), false);
});

test('clock callback revocation takes precedence even when that callback also throws', () => {
  const m = memfs(); const owner = open(m).owner; let created; let calls = 0; let revoked;
  const clock = () => {
    calls++;
    if (calls === 2) {
      revoked = revokeFixedXpcHistoryPermit({ permit: created.permit });
      throw new Error('private clock failure');
    }
    return 100;
  };
  created = createFixedXpcHistoryPermit({ owner, declaration: declaration(), clock });
  const result = captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE });
  assert.equal(revoked.status, 'REVOKED');
  assert.equal(result.status, 'REFUSED');
  assert.equal(result.reason, 'PERMIT_REVOKED');
  assert.equal(result.recordAttempted, false);
  assert.equal(JSON.stringify(result).includes('private clock failure'), false);
});
