import type {
  JournalConfig,
  JournalEntry,
  JournalOwner,
  JournalOwnerFs,
  MaintainJournalOwnerResult,
} from '../../history/journal-owner-v2.mjs';
import {maintainJournalOwner, openJournalOwner} from '../../history/journal-owner-v2.mjs';
import * as fs from 'node:fs';

const fsContract: JournalOwnerFs = fs;
void fsContract;

const config = {
  projectId: 'project-a', maxEntries: 8, heartbeatTtlMs: 10, redactPaths: ['payload.secret']
} as const satisfies JournalConfig;

const opened = openJournalOwner({path: '/synthetic/journal.jsonl', fs, config, now: 100});
if (opened.status === 'OPENED') {
  const owner: JournalOwner = opened.owner;
  const result: MaintainJournalOwnerResult = maintainJournalOwner({owner, now: 100});
  if (result.status === 'MAINTAINED') {
    const status: 'WRITTEN' = result.store.status;
    const verified: true = result.store.verified;
    void status; void verified;
  } else if (result.status === 'UNCHANGED') {
    const status: 'UNCHANGED' = result.store.status;
    const committed: false = result.store.committed;
    void status; void committed;
  } else if (result.status === 'STORE_CONFLICT') {
    const status: 'REFUSED' = result.store.status;
    void status;
  } else if (result.status === 'STORE_FAILED') {
    // A failed store response is opaque and may be null.
    // @ts-expect-error failed maintenance does not narrow to a validated store
    result.store.verified;
  }

  // The maintenance result and its nested snapshot are immutable.
  // @ts-expect-error readonly maintenance status
  result.status = 'REFUSED';
  // @ts-expect-error readonly snapshot
  result.snapshot = null;
}

// The nominal owner cannot be fabricated from the runtime's empty object.
// @ts-expect-error opaque owner brand is private to the declaration
const forged: JournalOwner = {};
void forged;

// The exact envelope requires both fields and a nominal owner.
// @ts-expect-error missing now
maintainJournalOwner({owner: {} as JournalOwner});
// @ts-expect-error ordinary object is not a JournalOwner
maintainJournalOwner({owner: {}, now: 100});

// A journal entry is unrelated to the maintenance envelope.
const entry = {} as JournalEntry;
// @ts-expect-error entry is not a maintenance request
maintainJournalOwner({owner: entry, now: 100});
