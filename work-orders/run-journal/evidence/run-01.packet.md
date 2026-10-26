---
packet: nisi-run-journal
project_root: /Users/louiscalata/nisi-next-private/work-orders/run-journal
created_by: codex
created: 2026-09-13T10:58:48-07:00
write_owner: opencode
status: ready
---

# Nisi U02-04 — pure observational run journal v1

## Context

This isolated private ESM work order has Node v24.18.0 / npm 11.16.0 and no
dependencies. The owner authored and protected 18 node:test/assert-strict contract
tests. The measured placeholder pre-state is baseline `npm test` PASS 2/2 and
`npm run test:journal` FAIL 18/18, zero skipped/cancelled. This is
test-first-satisfied: tests already exist; the one item implements the contract.
Read only this packet and the listed source/protected tests, never the parent tree.

The only source is `src/run-journal-v1.mjs`. Export exactly the two synchronous
functions `createRunJournal(config)` and `reopen(serialized)`. Return deeply frozen
snapshots and a frozen journal API with exactly `append`, `list`, `retain`,
`serialize`. There is no execution/issuance/queue dispatch method. An entry is an
immutable OBSERVATION identity, not a mutable job. States describe submitted data;
new observation ids never authorize or execute work. This deliberately does not
implement a job state machine or classify execution-qualified incidents. Nisi
integrity and receipt contracts remain unchanged, opaque payload data here; no
receipt reader, canonical profile or issued-plan WeakSet is copied or replaced.

### Closed input and time rules

Config has exactly `{projectId,maxEntries,heartbeatTtlMs,redactPaths}`. IDs (all
id fields and stage) match `/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/`. `maxEntries`
is a positive safe integer <=10000, `heartbeatTtlMs` a positive safe integer.
`redactPaths` is an array of distinct dot paths starting `payload.` with at least
one subsequent segment, each segment ASCII identifier `[A-Za-z_][A-Za-z0-9_]*`
or canonical nonnegative array index `0|[1-9][0-9]*`. No `__proto__`, `prototype`,
or `constructor` segments, duplicate paths or ancestor/descendant overlap.
Retain their input order. Invalid config throws Error with `.code === 'CONFIG'`.

Every entry has exactly these keys, all mandatory:

```text
id, projectId, runId, attempt, candidateId, stage, receiptId,
createdAt, ttlMs, state, heartbeatAt, retryOf, revokes, payload
```

`attempt` is a nonnegative safe integer. `receiptId`, `retryOf`, `revokes` are
nullable IDs. `state` is one of QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED/REVOKED.
`createdAt` is a nonnegative safe integer in caller-defined milliseconds, `ttlMs`
positive safe integer, and their sum must also be safe. `heartbeatAt` is null
or nonnegative safe integer <=createdAt. It can be supplied on any state;
only RUNNING uses it for liveness. REVOKED requires non-null `revokes` and null
`retryOf`; every other state requires null `revokes`. Non-null retryOf requires
QUEUED (a syntactically valid other state returns REFUSED RETRY below).

Inputs are ordinary trusted data objects, not hostile Proxies. Clone without
executing accessors: reject accessors, symbols, non-enumerable fields, extra array
properties/holes, cycles, non-plain objects, undefined/functions/bigints, non-safe
integer numbers, malformed Unicode strings, negative zero, and dangerous object
keys `__proto__`, `prototype`, `constructor` anywhere. JSON payload may otherwise
be any JSON value. Plain Object.prototype or null-prototype records and dense
arrays are supported. Invalid entry or createdAt > append now throws code ENTRY.

`append(entry, now)`, `list(now)` and `retain(now)` require a nonnegative safe
integer `now` >= the journal watermark (starts 0). Invalid/backwards now throws
code TIME, without mutation. The watermark advances only on a successful append,
list or retain. DUPLICATE, CONFLICT, REFUSED and thrown calls do not advance time
or change stored records. `serialize()` reads no time. No clock/random/fs/network.

### Identity, observations and relationships

Append first checks time, snapshots/validates the entry and createdAt<=now. A
sealed journal then returns REFUSED SEALED. A projectId different from the config
returns REFUSED PROJECT. Compute original fingerprint H(`nisi-run-journal/input/v1`
+ newline + C(entire original entry)), before redaction. If id already exists,
matching fingerprint returns exactly `{status:'DUPLICATE',id}`; differing returns
`{status:'CONFLICT',id,reason:'ID_CONTENT_MISMATCH'}`. Check seen identity BEFORE
redaction path resolution, relationships or retention. Never replace, renew,
un-revoke or resurrect an existing entry, including historical/tombstone entries.

For an unseen id with retryOf: require QUEUED, earlier target in this journal,
same runId, strictly greater attempt, createdAt>=target.createdAt, and target
terminal (SUCCEEDED/FAILED/CANCELLED/REVOKED), expired at supplied now, or revoked
by a prior entry. Candidate may change on retry. Otherwise REFUSED RETRY.
Stale/missing heartbeat alone is never sufficient. For an unseen revocation:
target must already exist, match runId/attempt/candidateId and have
target.createdAt<=entry.createdAt; otherwise REFUSED REVOCATION. Revoke effects
are monotonic; another revocation may cite an already revoked target, including
a revoking entry, but cannot undo its old effect. All relationship fields stay
in identity metadata when payloads are pruned. There is no deletion operation.

Every refusal is exactly `{status:'REFUSED',id,reason}`. Otherwise redact/capture,
insert in arrival order, advance watermark, enforce retention, then return
exactly `{status:'APPENDED',id}`. Earlier entries are never modified except for
payload retention. Successful appends can record already-expired observations;
these lose their payload immediately and confer no authority.

### Redaction and retention

For NEW input, every configured redaction path must resolve via own data fields
in that entry; otherwise throw code REDACTION, without mutation. Replace its
entire value (scalar/object/array) by literal `[REDACTED]`. Arrays use canonical
index segments only, and traversal through a primitive is invalid. Capture only
the REDACTED entry plus its original fingerprint; do not retain raw secret
payloads or canonical original strings in the journal closure. Caller objects
are not mutated. Thus getter snapshots AND serialized records are redacted.
Config is fixed for the lifetime and serialized with the journal; it is not part
of entry identity and cannot be edited via API. Fingerprints are equality aids,
not secret protection against guessing or authentication. This isolated sorted
JSON digest profile is NOT the Nisi canonical/integrity/receipt profile.

Retention prunes only payloads: mark `retained:false`, set `entry.payload:null`,
keep ALL identity/attribution/state/time/links/fingerprint metadata forever.
First prune each retained entry whose `now >= createdAt+ttlMs`; then prune oldest
remaining retained entries by insertion order until retained count<=maxEntries.
Never delete ids; total identity metadata is explicitly unbounded in this v1.
`retain(now)` applies that rule, advances watermark, returns frozen newly-pruned
ids in original insertion order. `list(now)` does the same retention/time work,
then returns a frozen ordered array of exactly these per-entry views:

```text
{entry, historical, retained, revoked, expired, liveness, authorizing:false}
```

`historical` is false for this instance's fresh appends, true for EVERY reopened
entry, permanently, including DUPLICATE replay. `revoked` means any accepted
entry cites this id via revokes; a REVOKED state's own target does not revoke
itself. `expired` is now>=createdAt+ttlMs even on terminal entries. `liveness`
precedence: revoked -> REVOKED; terminal state -> original state; expired ->
EXPIRED; RUNNING with null heartbeat or now-heartbeatAt>heartbeatTtlMs -> UNKNOWN;
otherwise original state. Equality at heartbeat window is still RUNNING.
No liveness classification grants issuance, retry, or execution authority.

### Canonical serialization and prefix reconciliation

C(value) is compact JSON with recursively sorted object keys (JS default lexical
sort), original array order and JSON escaping; no whitespace, trailing spaces or
raw embedded line breaks. H(text) is lowercase SHA-256 of UTF-8 text. The only
allowed import is `{createHash}` from `node:crypto`, used for deterministic H.
No other export/import or side effects are needed. Checksums detect accidental
damage and ordering errors, not malicious rewriting with recomputed hashes.

`serialize()` emits canonical newline-delimited JSON, with final newline required
after EVERY line. Exactly one header, all entry records, one footer. Shapes:

```text
header = {type:'header',schema:'nisi-run-journal-v1',config,now:watermark}
record = {entry:redactedOrPrunedEntry,fingerprint:originalFingerprint,retained:boolean}
envelope = {type:'entry',seq,previousHash,record,hash}
footer = {type:'footer',count:entryCount,lastHash}
```

Initial previousHash=H(`nisi-run-journal/header/v1` + newline + C(header)).
Sequence starts at 1. Envelope hash=H(`nisi-run-journal/record/v1` + newline +
C({seq,previousHash,record})), and becomes next previousHash. Footer lastHash
is final envelope hash (header hash if empty). Store neither historical nor
authority flags in serialized records. Complete reopen then serialize without
mutation MUST return identical bytes. Capture ownership, not serialized input,
sets historical=true. An input payload claiming issued/PASS is still data.

`reopen(serialized)` takes a string (other types treated as invalid header) and
never throws on malformed serialized data. It returns `{journal,report}`. Report
has exactly `{status,recoveredIds,rejectedLine,reason,authorizing:false}` with
status COMPLETE/INCOMPLETE/INVALID. recoveredIds is the exact valid prefix in
order. No guessed lost count. rejectedLine is 1-based physical line or null.

Require canonical bytes and exact keys on all parsed objects. JSON duplicate
keys, extra fields, unknown version/status or pretty printing fail the canonical
roundtrip check. Header invalid, missing or not newline-terminated: INVALID,
reason HEADER, rejectedLine 1, recoveredIds [], journal null. A valid header
creates a journal with that config/watermark. Validate each NEWLINE-TERMINATED
record before recovering it: exact schema, entry schema and same project, entry
createdAt<=header.now, fingerprint and hashes lowercase 64-hex, next seq/chain,
unique id, valid earlier retry/revocation target, retained boolean, null payload
if !retained. Retained payload must have all redaction paths already equal to
the marker; pruned payload skips path checks. Retained expired entries and count
beyond maxEntries are invalid. On reopen, fingerprint is opaque original-input
equality metadata: do not recompute it from redacted/pruned payload. Link validity
is checked against prefix using header.now; target metadata and revocation links
are available even after payload pruning. Never recover an offending record.

Stop at first bad record: INVALID/RECORD at its line, ignore all later lines.
Missing footer after last complete newline: INCOMPLETE/MISSING_FOOTER at next
line. A non-newline-terminated tail after header: INCOMPLETE/TRUNCATED at that
line; even a parseable JSON record without newline is NOT recovered. Footer
shape/count/lastHash mismatch: INVALID/FOOTER at that line. Any bytes after a
valid footer (even another newline or incomplete tail): INVALID/TRAILING_DATA
at the immediately next physical line. Valid footer and end: COMPLETE, null
reason/rejectedLine. All recovered records are historical, including on damage.

If report is not COMPLETE but header was valid, return the recovered journal
SEALED. It permits list/retain (time still validated) but every syntactically
valid append, even an identical replay, returns REFUSED SEALED. serialize throws
code SEALED. No API clears this seal: absence of a missing id cannot be proven.
Sealing errors and reports never claim file persistence, original authenticity,
reconciled external effects or fresh issued execution evidence.

## Constraints

- Write ONLY `src/run-journal-v1.mjs`; all tests, package.json, roadmap.md,
  evidence and .packets files are protected read-only. No parent/sibling access.
- The protected tests may be read; do not edit, disable, mock or bypass them.
  Do not modify the packet or write a receipt. The outer wrapper owns receipts.
- No dependencies, installation, shell commands/tests from the executor, nested
  packets, filesystem/network/process APIs, clock/random, dynamic code evaluation,
  native processes, generated-task execution, auth/config changes, commit or push.
- Do not include `process`, `require`, `fetch`, `XMLHttpRequest`, `eval`, `Function`,
  `Date`, `performance`, `setTimeout`, `setInterval`, `Math.random`, randomUUID or
  randomBytes in source or comments. The baseline source scan is bounded, not a
  security proof. Exactly the optional deterministic node:crypto import above.
- LOCAL tier only. Never switch provider/model or dispatch a worker from inside
  the packet. Codex owns review/acceptance and may fix authoring between at most
  two authorized reruns after inspecting failures. Only OpenCode writes the source.
- This implements pure data serialization, not durable host storage, queue
  scheduling, state transition enforcement or qualified failure-family evaluation.
  Actual host integration remains dependent on U02-02; this cannot close U02-04.

## Items

### P1 — Implement the frozen observational journal and strict historical reopen
- **files**: src/run-journal-v1.mjs
- **do**: Replace the placeholder exports with the complete API above, preserving all closed schemas, original fingerprint identity, pure caller-time semantics, monotonic revocation, redaction, payload-only retention, historical reopen and exact prefix recovery/sealing. Keep this one dependency-free source readable and small. Existing protected tests are the owner's oracle; implement the contract without changing any protected file.
- **accept**: npm run test:journal

## Packet acceptance
npm test
