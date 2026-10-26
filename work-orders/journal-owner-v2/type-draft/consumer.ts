import type {
  JournalConfig,
  JournalEntry,
  JournalOwner,
  JournalOwnerFs,
  JournalSnapshot,
  RecordJournalObservationResult
} from './index.js';
import { inspectJournalOwner, openJournalOwner, recordJournalObservation } from './index.js';

declare const fs: JournalOwnerFs;

const config = {
  projectId: 'project-a',
  maxEntries: 8,
  heartbeatTtlMs: 10,
  redactPaths: ['payload.secret']
} as const satisfies JournalConfig;

const entry = {
  id: 'entry-a', projectId: 'project-a', runId: 'run-a', attempt: 0,
  candidateId: 'candidate-a', stage: 'observe', receiptId: null,
  createdAt: 100, ttlMs: 1000, state: 'SUCCEEDED', heartbeatAt: null,
  retryOf: null, revokes: null,
  payload: { secret: '/synthetic/private', observation: { status: 'OBSERVED', authorizing: false } }
} as const satisfies JournalEntry;

const opened = openJournalOwner({ path: '/synthetic/journal.jsonl', fs, config, now: 100 });

if (opened.status === 'OPENED') {
  const owner: JournalOwner = opened.owner;
  const snapshot: JournalSnapshot = opened.snapshot;
  const inspected = inspectJournalOwner({ owner });
  const recorded: RecordJournalObservationResult = recordJournalObservation({ owner, entry, now: 100 });

  if (inspected.status === 'SNAPSHOT' && inspected.snapshot.state === 'COMMIT_UNCERTAIN') {
    const noDigest: null = inspected.snapshot.sha256;
    const noEntries: readonly [] = inspected.snapshot.entries;
    void noDigest; void noEntries;
  }

  if (recorded.status === 'RECORDED') {
    const id: string = recorded.entryId;
    const verified: true = recorded.store.verified;
    const noAuthority: false = recorded.authorizing;
    void id; void verified; void noAuthority;
  } else if (recorded.status === 'STORE_CONFLICT') {
    const knownRefusal: 'REFUSED' = recorded.store.status;
    const committed: boolean = recorded.store.committed;
    void knownRefusal; void committed;
  } else if (recorded.status === 'STORE_FAILED') {
    // A representable malformed response can be retained as opaque PlainData.
    // @ts-expect-error STORE_FAILED does not prove a validated store result
    recorded.store.verified;
  } else if (recorded.status === 'REFUSED' && 'snapshot' in recorded) {
    const journalReason: string = recorded.reason;
    void journalReason;
  }

  // Returned observations and nested data are immutable to consumers.
  // @ts-expect-error readonly snapshot state
  snapshot.state = 'SEALED';
  // @ts-expect-error readonly entry array
  snapshot.entries.push(snapshot.entries[0]);
  // @ts-expect-error authorizing is the literal false
  opened.authorizing = true;
}

// The nominal owner cannot be manufactured from the runtime's visible empty shape.
// @ts-expect-error opaque owner brand is private to the declaration
const fabricated: JournalOwner = {};
void fabricated;

// All three request envelopes have required exact API fields at compile time.
// @ts-expect-error missing now
openJournalOwner({ path: '/synthetic/journal.jsonl', fs, config });
// @ts-expect-error ordinary object is not an opaque owner
inspectJournalOwner({ owner: {} });
// @ts-expect-error entry state is outside the journal protocol
recordJournalObservation({ owner: {} as JournalOwner, entry: { ...entry, state: 'PARTIAL' }, now: 100 });
