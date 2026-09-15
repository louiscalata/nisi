---
packet: nisi-run-journal
project_root: /Users/louiscalata/nisi-next-private/work-orders/run-journal
created_by: codex
created: 2026-09-13T10:58:48-07:00
write_owner: opencode
status: done
---

# Nisi U02-04 — pure observational run journal v1

## Context

FINAL AUTHORIZED LOCAL ATTEMPT — MECHANICAL INSTALLATION ONLY.
The prior two attempts each exhausted 7,999 reasoning tokens and wrote nothing.
Their receipts and unchanged source snapshots are retained. The owner has now
resolved implementation as well as design: copy the EXACT JavaScript text in
"Owner-reviewed installation reference" into src/run-journal-v1.mjs using the
write tool. Do not redesign it, re-derive algorithms, run commands, or explore.
Read the placeholder once if the write tool needs that precondition; then WRITE
THE PROVIDED CONTENT. Do not read the test tree for this mechanical operation.
Do not spend a response reasoning through the tests. The owner separately read
and validated this reference against all 18 unchanged protected tests and seven
supplemental probes; the actual source is still a placeholder. The outer wrapper
will run the actual source acceptance after your write. Do not claim acceptance.
If one write call would be too large, write the first half then use edit to append
the second half. No new design or code is requested in this final install step.

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
A line that does not parse as canonical JSON is RECORD; its intended type is
unknown. FOOTER applies only to a recognized canonical object with type footer.
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

## Owner-reviewed installation reference

Install the following content verbatim (without the fence lines), including its
final newline. Expected source SHA-256: `dee9f490c091000b2560cd9464d945885e7f341091b87dde9ae4f2b7cdbd359e`. The reference
was drafted by Luna and corrected, read and tested by Astra/Codex; this final
OpenCode role is mechanical source installation, not independent code authorship.

```javascript
import {createHash} from 'node:crypto';

const STATES = new Set(['QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','REVOKED']);
const ENTRY_KEYS = ['id','projectId','runId','attempt','candidateId','stage','receiptId','createdAt','ttlMs','state','heartbeatAt','retryOf','revokes','payload'];
const RECORD_KEYS = ['entry','fingerprint','retained'];
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SEG = /^(?:[A-Za-z_][A-Za-z0-9_]*|0|[1-9][0-9]*)$/;
const BAD = new Set(['__proto__','prototype','constructor']);
const MARK = '[REDACTED]';

const err = (code, message = code) => { const e = new Error(message); e.code = code; return e; };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) &&
  Object.keys(o).length === keys.length && keys.every(k => own(o, k));
const safe = n => Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0);

function copy(x, stack = new Set()) {
  if (x === null || typeof x === 'string' || typeof x === 'boolean') {
    if (typeof x === 'string') for (let i=0;i<x.length;i++) { const n=x.charCodeAt(i); if (n>=0xd800&&n<=0xdbff) { const m=x.charCodeAt(++i); if (!(m>=0xdc00&&m<=0xdfff)) throw err('ENTRY'); } else if (n>=0xdc00&&n<=0xdfff) throw err('ENTRY'); }
    return x;
  }
  if (typeof x === 'number') { if (!Number.isSafeInteger(x) || Object.is(x, -0)) throw err('ENTRY'); return x; }
  if (!x || typeof x !== 'object' || stack.has(x)) throw err('ENTRY');
  const proto = Object.getPrototypeOf(x); if (Array.isArray(x) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw err('ENTRY');
  stack.add(x);
  let out;
  if (Array.isArray(x)) {
    const names = Object.getOwnPropertyNames(x);
    if (names.length !== x.length + 1 || !names.includes('length') || Reflect.ownKeys(x).length !== names.length) throw err('ENTRY');
    out = [];
    for (let i=0;i<x.length;i++) {
      const d = Object.getOwnPropertyDescriptor(x, String(i));
      if (!d || !d.enumerable || !('value' in d)) throw err('ENTRY');
      out.push(copy(d.value, stack));
    }
  } else {
    const names = Object.getOwnPropertyNames(x), keys = Object.keys(x);
    if (names.length !== keys.length || Reflect.ownKeys(x).length !== keys.length) throw err('ENTRY');
    out = {};
    for (const k of keys) {
      if (BAD.has(k) || !k.isWellFormed()) throw err('ENTRY');
      const d = Object.getOwnPropertyDescriptor(x, k);
      if (!d || !d.enumerable || !('value' in d)) throw err('ENTRY');
      out[k] = copy(d.value, stack);
    }
  }
  stack.delete(x); return out;
}

function C(x) {
  if (Array.isArray(x)) return '[' + x.map(C).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k)+':'+C(x[k])).join(',') + '}';
  return JSON.stringify(x);
}
function H(x) { return createHash('sha256').update(x).digest('hex'); }
function freeze(x, seen = new Set()) {
  if (x && typeof x === 'object' && !seen.has(x)) { seen.add(x); for (const v of Object.values(x)) freeze(v, seen); Object.freeze(x); }
  return x;
}
function id(x) { return typeof x === 'string' && ID.test(x); }
function configOf(input) {
  let c; try { c = copy(input); } catch (_) { throw err('CONFIG'); }
  if (!exact(c, ['projectId','maxEntries','heartbeatTtlMs','redactPaths']) || !id(c.projectId) ||
      !Number.isSafeInteger(c.maxEntries) || c.maxEntries < 1 || c.maxEntries > 10000 ||
      !Number.isSafeInteger(c.heartbeatTtlMs) || c.heartbeatTtlMs < 1 || !Array.isArray(c.redactPaths)) throw err('CONFIG');
  const paths = []; for (const p of c.redactPaths) {
    if (typeof p !== 'string' || !p.startsWith('payload.') || p.length < 9) throw err('CONFIG');
    const a = p.split('.'); if (a.some(s => !SEG.test(s) || BAD.has(s))) throw err('CONFIG');
    for (const q of paths) if (a.length === q.length ? a.every((s,i)=>s===q[i]) :
      (a.length < q.length ? a.every((s,i)=>s===q[i]) : q.every((s,i)=>s===a[i]))) throw err('CONFIG');
    paths.push(a);
  }
  c.redactPaths = c.redactPaths.slice(); c._paths = paths; return c;
}
function entryOf(input, now) {
  let e; try { e = copy(input); } catch (_) { throw err('ENTRY'); }
  if (!exact(e, ENTRY_KEYS) || !id(e.id) || !id(e.projectId) || !id(e.runId) || !id(e.candidateId) || !id(e.stage) ||
      !Number.isSafeInteger(e.attempt) || e.attempt < 0 || !safe(e.createdAt) || !Number.isSafeInteger(e.ttlMs) || e.ttlMs < 1 ||
      !safe(e.createdAt + e.ttlMs) || !STATES.has(e.state) || (e.heartbeatAt !== null && !safe(e.heartbeatAt)) ||
      (e.heartbeatAt !== null && e.heartbeatAt > e.createdAt) || (e.receiptId !== null && !id(e.receiptId)) ||
      (e.retryOf !== null && !id(e.retryOf)) || (e.revokes !== null && !id(e.revokes)) ||
      (e.state === 'REVOKED' ? e.revokes === null || e.retryOf !== null : e.revokes !== null) ||
      (now !== undefined && e.createdAt > now)) throw err('ENTRY');
  return e;
}
function redact(e, paths) {
  for (const path of paths) {
    let cur = e; for (let i=0;i<path.length-1;i++) { const k=path[i]; if (!cur || typeof cur !== 'object' || !own(cur,k) || Array.isArray(cur) && !/^(0|[1-9][0-9]*)$/.test(k)) throw err('REDACTION'); cur=cur[k]; }
    const k=path.at(-1); if (!cur || typeof cur !== 'object' || !own(cur,k) || Array.isArray(cur) && !/^(0|[1-9][0-9]*)$/.test(k)) throw err('REDACTION'); cur[k]=MARK;
  }
}
function expired(r, now) { return now >= r.entry.createdAt + r.entry.ttlMs; }

function build(config, watermark = 0, initial = [], sealed = false) {
  const records = initial.slice(), byId = new Map(), revoked = new Set();
  for (const r of records) { byId.set(r.entry.id, r); if (r.entry.revokes !== null) revoked.add(r.entry.revokes); }
  let mark = watermark;
  const prune = now => {
    const out=[]; for (const r of records) if (r.retained && expired(r,now)) { r.retained=false; r.entry.payload=null; out.push(r.entry.id); }
    let n=records.filter(r=>r.retained).length;
    for (const r of records) if (n>config.maxEntries && r.retained) { r.retained=false; r.entry.payload=null; n--; out.push(r.entry.id); }
    const pruned = new Set(out); return records.filter(r=>pruned.has(r.entry.id)).map(r=>r.entry.id);
  };
  const time = now => { if (!safe(now) || now < mark) throw err('TIME'); mark=now; };
  const view = (r, now) => {
    const terminal = new Set(['SUCCEEDED','FAILED','CANCELLED','REVOKED']);
    let l = revoked.has(r.entry.id) ? 'REVOKED' : terminal.has(r.entry.state) ? r.entry.state : expired(r,now) ? 'EXPIRED' :
      r.entry.state === 'RUNNING' && (r.entry.heartbeatAt === null || now-r.entry.heartbeatAt > config.heartbeatTtlMs) ? 'UNKNOWN' : r.entry.state;
    return freeze({entry:copy(r.entry), historical:r.historical, retained:r.retained, revoked:revoked.has(r.entry.id), expired:expired(r,now), liveness:l, authorizing:false});
  };
  const append = (input, now) => {
    if (!safe(now) || now < mark) throw err('TIME');
    const e=entryOf(input,now);
    if (sealed) return freeze({status:'REFUSED',id:e.id,reason:'SEALED'});
    if (e.projectId !== config.projectId) return freeze({status:'REFUSED',id:e.id,reason:'PROJECT'});
    const fp=H('nisi-run-journal/input/v1\n'+C(e)), old=byId.get(e.id);
    if (old) return freeze(old.fingerprint===fp ? {status:'DUPLICATE',id:e.id} : {status:'CONFLICT',id:e.id,reason:'ID_CONTENT_MISMATCH'});
    if (e.retryOf !== null) {
      const t=byId.get(e.retryOf); if (!t || e.state!=='QUEUED' || t.entry.runId!==e.runId || e.attempt<=t.entry.attempt || e.createdAt<t.entry.createdAt ||
        !(new Set(['SUCCEEDED','FAILED','CANCELLED','REVOKED'])).has(t.entry.state) && !expired(t,now) && !revoked.has(t.entry.id)) return freeze({status:'REFUSED',id:e.id,reason:'RETRY'});
    }
    if (e.revokes !== null) { const t=byId.get(e.revokes); if (!t || t.entry.runId!==e.runId || t.entry.attempt!==e.attempt || t.entry.candidateId!==e.candidateId || t.entry.createdAt>e.createdAt) return freeze({status:'REFUSED',id:e.id,reason:'REVOCATION'}); }
    redact(e,config._paths);
    const r={entry:e,fingerprint:fp,retained:true,historical:false}; records.push(r); byId.set(e.id,r); if (e.revokes!==null) revoked.add(e.revokes);
    mark=now; prune(now); return freeze({status:'APPENDED',id:e.id});
  };
  const list = now => { time(now); prune(now); return freeze(records.map(r=>view(r,now))); };
  const retain = now => { time(now); return freeze(prune(now)); };
  const serialize = () => {
    if (sealed) throw err('SEALED');
    const header={type:'header',schema:'nisi-run-journal-v1',config:{projectId:config.projectId,maxEntries:config.maxEntries,heartbeatTtlMs:config.heartbeatTtlMs,redactPaths:config.redactPaths.slice()},now:mark};
    let prev=H('nisi-run-journal/header/v1\n'+C(header)), lines=[C(header)];
    records.forEach((r,i)=>{ const record={entry:r.entry,fingerprint:r.fingerprint,retained:r.retained}, env={type:'entry',seq:i+1,previousHash:prev,record,hash:H('nisi-run-journal/record/v1\n'+C({seq:i+1,previousHash:prev,record}))}; lines.push(C(env)); prev=env.hash; });
    lines.push(C({type:'footer',count:records.length,lastHash:prev})); return lines.join('\n')+'\n';
  };
  return {api:freeze({append,list,retain,serialize}), records, byId, revoked, get watermark(){return mark;}};
}

function parseLine(raw) {
  try { const v=JSON.parse(raw); return C(v)===raw ? v : null; } catch (_) { return null; }
}
function report(status, ids, line, reason) { return freeze({status,recoveredIds:ids,rejectedLine:line,reason,authorizing:false}); }

export function createRunJournal(input) { const c=configOf(input), b=build(c); return b.api; }

function reopenData(serialized) {
  if (typeof serialized !== 'string' || !serialized.includes('\n')) return {journal:null,report:report('INVALID',[],1,'HEADER')};
  const trailing=!serialized.endsWith('\n'); let ls=serialized.split('\n'); let tail=null; if (trailing) tail=ls.pop(); else ls.pop();
  const h=parseLine(ls[0]);
  if (!h || !exact(h,['type','schema','config','now']) || h.type!=='header' || h.schema!=='nisi-run-journal-v1' || !safe(h.now)) return {journal:null,report:report('INVALID',[],1,'HEADER')};
  let c; try { c=configOf(h.config); } catch (_) { return {journal:null,report:report('INVALID',[],1,'HEADER')}; }
  const b=build(c,h.now), ids=[]; let prev=H('nisi-run-journal/header/v1\n'+C(h)), footer=false, bad=null, retained=0;
  const failAt=(line,reason='RECORD',status='INVALID')=>{bad={line,reason,status};};
  for(let n=1;n<ls.length&&!bad;n++) {
    const v=parseLine(ls[n]); if (!v) { failAt(n+1); break; }
    if (v.type==='footer') {
      if (!exact(v,['type','count','lastHash']) || v.type!=='footer' || !Number.isSafeInteger(v.count) || v.count!==ids.length || v.lastHash!==prev) failAt(n+1,'FOOTER'); else footer=true;
      if (footer && (n+1<ls.length || trailing)) failAt(n+1<ls.length ? n+2 : ls.length+1,'TRAILING_DATA');
      break;
    }
    if (!exact(v,['type','seq','previousHash','record','hash']) || v.type!=='entry' || v.seq!==n || v.previousHash!==prev || typeof v.hash!=='string' || !/^[0-9a-f]{64}$/.test(v.hash) ||
        H('nisi-run-journal/record/v1\n'+C({seq:v.seq,previousHash:v.previousHash,record:v.record}))!==v.hash || !exact(v.record,RECORD_KEYS) || typeof v.record.fingerprint!=='string' || !/^[0-9a-f]{64}$/.test(v.record.fingerprint) || typeof v.record.retained!=='boolean') { failAt(n+1); break; }
    let e; try { e=entryOf(v.record.entry,h.now); } catch (_) { failAt(n+1); break; }
    if (e.projectId!==c.projectId || b.byId.has(e.id) || (!v.record.retained && e.payload!==null)) { failAt(n+1); break; }
    if (v.record.retained) { try { for(const p of c._paths){let x=e;for(const k of p){if(!x||typeof x!=='object'||!own(x,k)||Array.isArray(x)&&!/^(0|[1-9][0-9]*)$/.test(k))throw 0;x=x[k];}if(x!==MARK)throw 0;} } catch (_) { failAt(n+1); break; } if (expired({entry:e},h.now)) { failAt(n+1); break; } retained++; if(retained>c.maxEntries){failAt(n+1);break;} }
    if (e.retryOf!==null) { const t=b.byId.get(e.retryOf); if(!t || e.state!=='QUEUED' || t.entry.runId!==e.runId || e.attempt<=t.entry.attempt || e.createdAt<t.entry.createdAt || !(new Set(['SUCCEEDED','FAILED','CANCELLED','REVOKED'])).has(t.entry.state) && !expired(t,h.now) && !b.revoked.has(t.entry.id)) { failAt(n+1); break; } }
    if (e.revokes!==null) { const t=b.byId.get(e.revokes); if(!t || t.entry.runId!==e.runId || t.entry.attempt!==e.attempt || t.entry.candidateId!==e.candidateId || t.entry.createdAt>e.createdAt){failAt(n+1);break;} }
    const r={entry:e,fingerprint:v.record.fingerprint,retained:v.record.retained,historical:true}; b.records.push(r); b.byId.set(e.id,r); if(e.revokes!==null)b.revoked.add(e.revokes); prev=v.hash; ids.push(e.id);
  }
  if (!bad && !footer) bad={line:ls.length+1,reason:trailing?'TRUNCATED':'MISSING_FOOTER',status:'INCOMPLETE'};
  if (bad) { const sealed=build(c,h.now,b.records,true); return {journal:sealed.api,report:report(bad.status,ids,bad.line,bad.reason)}; }
  return {journal:b.api,report:report('COMPLETE',ids,null,null)};
}

export function reopen(serialized) { return freeze(reopenData(serialized)); }
```

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
- **do**: Mechanically replace src/run-journal-v1.mjs with the exact JavaScript in Owner-reviewed installation reference. Preserve its bytes and final newline. Do not redesign, change tests, run commands or write any other file. The wrapper independently executes the unchanged protected contract tests and baseline.
- **accept**: npm run test:journal

## Packet acceptance
npm test
