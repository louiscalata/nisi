Confidential bounded coauthor request. No tools, no file edits, no external research. You are the working Opus fallback in a task where Fable credits were previously exhausted; do not claim Fable participation.
Draft only the open/inspect half and shared helpers of src/index.mjs for the owner-adjudicated contract below. Return the entire source text as deliverable (no fences, under 12000 characters). Leave export function recordJournalObservation(request) returning refusal('UNIMPLEMENTED'); Codex will implement that half. Exactly three exports. Need readable code, not golf.
Provide private WeakMap owners; private state fields path,fs,config,phase,busy,serialized,sha256,snapshot. Include utilities exact envelope validation without property getters; safe time; strict plain-data deep copy+freeze; snapshot(state,recovery,hash,bytes,entries) with interrupted; digest. Build new/opened state and opaque frozen owner. Prepare fallback uncertainty snapshot constant for Codex's write path. Imports permitted by contract. In open catch input vs read vs invalid journals correctly. Config canonical private clone from new journal serialize header. NEW list(now) once so its private serialized basis carries open time. OPEN disk hash binds captured raw bytes while memory serialized after list(now). SEALED journal serialize would throw; do not serialize SEALED. Reject wrong project/config even for INVALID prefix BEFORE any list/publication. Use only validated header.now. No test commands. Evidence structs must be plain copies with no hidden/symbol/accessor/Buffer conversion. Dependencies below are trusted and pinned; output helpers must not weaken them.
Include any residual concerns in risks, not in executable code.

CONTRACT:
# Journal owner v2 — private correction contract

Status: OWNER-ADJUDICATED CONTRACT; implementation acceptance pending. Overall Nisi progress: 30% (3/10).
This explicitly versioned successor addresses four reproduced host-bundle defects.
Do not edit canonical history/host-journal-bundle.mjs or Claude's v1 work order.
The v1 shape remains historical; the new opaque-owner API is not a drop-in silent change.
It composes the unchanged journal/store v1 formats; it does not invent another disk format.

## Scope and purpose

Reliable single-owner observation persistence for NX-05. Accept journal entries,
including the current fixed-XPC observation projector output; do not treat the
older five-canary summary and actual current runner record as interchangeable.
No native launch, permission grant, incident admission, policy influence, cross-process
lock, crash/power-loss guarantee, exactly-once execution or public release.

Only implementation target src/index.mjs. Allowed imports:
node:crypto, ./run-journal-v1.mjs (createRunJournal,reopen),
./run-journal-store-v1.mjs (writeSerializedJournal).
Dependencies are exact frozen copies. No hidden IO: only injected trusted synchronous
fs methods are called. No timers, processes, network or automatic retries.

## API / exact outer shapes

Exports exactly openJournalOwner, inspectJournalOwner, recordJournalObservation.
All returned values carry schemaVersion:'nisi-journal-owner/v2', authorizing:false.
Input object key sets are exact own enumerable string data properties. Reject
accessors, hidden/symbol keys, arrays, exotic prototypes and missing/extra fields.
Do not invoke property getters to validate these request envelopes. JS proxy traps
and injected fs implementations are outside the security guarantee.

openJournalOwner({path,fs,config,now})
- path nonempty well-formed string without NUL.
- fs trusted object with readFileSync,openSync,writeSync,closeSync,renameSync,unlinkSync
  functions; fsyncSync optional (absence/non-success means not durable).
- config exactly the unchanged journal config; validate via createRunJournal and retain
  a canonical private copy of projectId,maxEntries,heartbeatTtlMs,redactPaths.
- now a nonnegative safe integer, never -0.
- Refusal exact {schemaVersion,status:'REFUSED',reason,authorizing:false}.
- Success exact {schemaVersion,status:'OPENED',owner,snapshot,authorizing:false}.
- owner is an empty, frozen, unique object registered in a private WeakMap.
  Copied/JSON-roundtripped/manufactured handles never access state.
- snapshot is a deeply frozen value, with no journal API or fs/path/config exposed.

inspectJournalOwner({owner})
- Exact {schemaVersion,status:'SNAPSHOT',snapshot,authorizing:false}, or refusal
  INVALID_INPUT for envelope/handle mismatch.
- Snapshot describes the latest accepted in-memory publication, not a fresh disk read
  or live process observation. Inspection is nonmutating and does not advance time.
- Repeated inspection may return the same immutable snapshot reference.

recordJournalObservation({owner,entry,now})
- Validate request/handle and safe now; malformed outer input -> REFUSED INVALID_INPUT.
- Sealed owner -> REFUSED OWNER_SEALED; uncertainty owner -> REFUSED COMMIT_UNCERTAIN.
- Reentrant record while a write is pending -> REFUSED OWNER_BUSY, with no extra FS IO.
- Entry admission uses the unchanged journal append validation (project, exact entry
  schema, monotonic time, redaction, duplicate/conflict rules). Catch errors and
  return their string code; no exception should escape for admitted request envelopes.
- Record result exact {schemaVersion,status,reason,entryId,append,store,snapshot,authorizing:false}.
  status in RECORDED,DUPLICATE,CONFLICT,REFUSED,STORE_CONFLICT,STORE_FAILED.
  reason null unless refusal/conflict; entryId null if unavailable; append is frozen
  actual staged append response or null; store frozen actual store response or null.
- For invalid envelope/handle/time, use the simple refusal shape (as open).
- OWNER_SEALED, COMMIT_UNCERTAIN and OWNER_BUSY also use that simple refusal shape.
- Source entry is never used for execution or classified as independently verified.
  SUCCEEDED in an observation is not a product/task correctness certificate.

## Snapshot

Exact keys schemaVersion, state, recovery, sha256, bytes, entries, interrupted,
meaning, authorizing.
- state OPEN | SEALED | COMMIT_UNCERTAIN.
- recovery exact {status,recoveredIds,rejectedLine,reason,authorizing:false}.
  statuses NEW | COMPLETE | INCOMPLETE | INVALID | COMMIT_UNCERTAIN.
  Original reopen diagnostics preserved. NEW:[],null,null.
- sha256 and bytes are the last accepted serialized observation or null.
  NEW uses sha256:null,bytes:0; SEALED or COMMIT_UNCERTAIN uses both null.
- entries are the unchanged journal's list(now) snapshots, copied and deeply frozen.
- interrupted contains {id,runId,attempt,stage,liveness,heartbeatAt,createdAt}
  for entries RUNNING with liveness UNKNOWN, neither revoked nor expired.
- meaning:'HISTORY_OBSERVATIONS_ONLY'. authorizing:false always.

## Opening: strict bytes, project/config binding, damaged prefixes

Read the path once using fs.readFileSync. ENOENT -> NEW owner; other read exception
or non-Buffer -> REFUSED READ_FAILED. Copy raw bytes before processing.
Maximum serialized UTF-8 byte count is 16 MiB: larger -> REFUSED SIZE_LIMIT.
This limit is checked after capture, so it is not a bound on initial fs allocation.

Require Buffer.from(raw.toString('utf8'),'utf8').equals(raw). Otherwise refuse
INVALID_UTF8 with no owner, prefix rows or recovered IDs; no replacement decoding.
Call reopen only after that guard. If reopen returns no journal -> REFUSED INVALID_JOURNAL.
Whenever reopen returns a journal (COMPLETE,INCOMPLETE or INVALID), parse the already
validated header and compare expected project before exposing any rows or IDs:
wrong project -> PROJECT_MISMATCH. Other persisted config difference -> CONFIG_MISMATCH
(canonical compare, including ordered redactPaths) to prevent policy drift.
now earlier than persisted journal watermark -> CLOCK_BEHIND_JOURNAL, not INVALID_INPUT.
The watermark is the validated persisted header's `now`; the API does not expose it.
All four config fields are actually persisted by the frozen journal, and ordered
redactPaths are preserved. Compare canonical JSON of the validated persisted config
with the header config from createRunJournal(config).serialize(), not caller objects.
After input validation, open precedence is read, size, UTF-8, invalid journal, project,
config, clock. Call list(now) once on the reopened journal, including a sealed prefix
for display only. It can discard expired payloads but does not erase recovered IDs.
Record at a time below the accepted memory watermark returns the journal's TIME code.
COMPLETE -> OPEN, hash exact raw bytes, bytes raw length, keep journal serialization
after list(now) as the accepted memory staging basis (disk CAS hash remains raw hash).
INCOMPLETE/INVALID with validated matching header -> SEALED; expose only verified
prefix through frozen snapshot, keep original diagnostic, no appends or writes.

## Staging and write outcome

Never expose the mutable journal instance or CAS digest as writable authority.
All mutable state, owner phase and predecessor hash live only in the WeakMap.
Stage every record against a separate journal reconstructed from last accepted memory
serialization (or new journal for a NEW owner). Live owner stays unchanged until outcome.
Reconstruction can mark prior rows historical; this is reconstruction, not execution proof.

Append REFUSED/DUPLICATE/CONFLICT returns that actual result without storage;
do not publish staged mutation/time/pruning. Duplicate returns original accepted snapshot.
For APPENDED, call staged list(now) once, serialize after listing, enforce the 16 MiB
cap, and prepare the immutable success publication before calling the unchanged store.
Append/store results are copied as strict plain data and deeply frozen; never share
mutable response objects. Do not silently drop accessors, fields or functions, or invent
a Buffer representation. The pinned journal/store emit plain JSON-compatible data;
an unexpected/unrepresentable store response is STORE_RESPONSE_INVALID and uncertain.
Use only the private prior raw-disk digest as expectedPreviousSha256; never caller mirrors.
For a NEW owner pass no expected digest: the unchanged store refuses a different existing
file rather than overwriting it. No loop retries and no automatic reopen on conflict.

WRITTEN/UNCHANGED -> RECORDED, publish the prepared staged snapshot, interrupted derived consistently,
new stored digest/byte count, recovery COMPLETE and recoveredIds from accepted entries.
Durability flags remain exactly as returned; UNCHANGED is not new fsync proof.
Validate the actual store response's known status, boolean committed/durable/verified,
fsync diagnostics, and exact staged digest/byte count before success. WRITTEN is
committed:true; UNCHANGED is committed:false. Identical first writes from two NEW
owners may return UNCHANGED; different bytes conflict. Only a refusal whose reason is
CONFLICT maps to STORE_CONFLICT, not every NEW-owner refusal.
Before rename (committed:false) refusal -> STORE_CONFLICT for CONFLICT else STORE_FAILED;
preserve old live snapshot/serialized state/hash exactly. No stale live mutation to undo.
After rename (committed:true) refusal -> STORE_FAILED with original diagnostic;
seal as COMMIT_UNCERTAIN, clear entries/interrupted/recoveredIds and current hash/bytes,
rejectedLine:null, recovery.reason=store.reason. Reject all future records for that owner.
Previously returned frozen snapshots remain historical values, not current disk claims.
Only a NEW open call can reconcile current actual bytes, yielding old/new/sealed/refused;
never assume either rollback or success after commit uncertainty.
Unexpected exception while invoking write store -> COMMIT_UNCERTAIN too unless proven
pre-store, because commit stage cannot be safely inferred from the thrown error.
Define pre-store structurally: local storeEntered=false until it is set true as the
last statement before writeSerializedJournal. Never infer this boundary from an error
message. A pre-store preparation failure returns STORE_FAILED without changing live
state; an append validation error returns REFUSED with its journal code. Any exception
after storeEntered, or malformed response, clears the authoritative state and seals it
before constructing the outward result. A prebuilt cleared uncertainty snapshot is a
fallback if diagnostic construction itself fails. Out-of-memory/global intrinsic
tampering are not guarantees of this JavaScript API.
Always clear internal busy flag in finally; no exception leaves phantom running state.

## Required evidence

Original four fault paths must be rejected/reconciled in successor tests:
1. Post-rename mismatch AND exception -> no stale old-state publication; fresh reopen.
2. Wrong-project COMPLETE, INCOMPLETE and INVALID prefix all refused before exposure.
3. Bad UTF-8 suffix after valid prefix refused without recovering a lossy row.
4. Public-handle/snapshot attempts cannot replace journal, hash or status or erase an
   intervening writer; genuine stale owner detects STORE_CONFLICT.
Also: NEW and COMPLETE writes, exact replay/conflict, expiry/pruning on failed write,
non-durable store success, config mismatch, lower clock, reentrancy and getter traps.
Retain baseline/source hashes and targeted mutants; no existing tests weakened.
Add real temporary-filesystem and fresh-process recovery evidence, without native app
execution. Connect one current fixed-XPC projected entry to this owner in a test.
Final integration of a successor is a separate explicit owner action, not copying over v1.


FROZEN JOURNAL (reference only, do not edit):
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


