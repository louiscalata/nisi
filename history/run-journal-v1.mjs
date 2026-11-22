// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import {createHash} from 'node:crypto';
import {types as nodeTypes} from 'node:util';

const TERMINAL_STATES = new Set(['SUCCEEDED','FAILED','CANCELLED','REVOKED']);
const STATES = new Set(['QUEUED','RUNNING',...TERMINAL_STATES]);
const ENTRY_KEYS = ['id','projectId','runId','attempt','candidateId','stage','receiptId','createdAt','ttlMs','state','heartbeatAt','retryOf','revokes','payload'];
const RECORD_KEYS = ['entry','fingerprint','retained'];
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SEG = /^(?:[A-Za-z_][A-Za-z0-9_]*|0|[1-9][0-9]*)$/;
const BAD = new Set(['__proto__','prototype','constructor']);
const MARK = '[REDACTED]';
const MAX_RECORDS = 10000;

const err = (code, message = code) => { const e = new Error(message); e.code = code; return e; };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) &&
  Object.keys(o).length === keys.length && keys.every(k => own(o, k));
const safe = n => Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0);

// Bounds the copied tree. An object reached by two paths is copied and hashed
// twice, so shared references can otherwise grow the work exponentially. Count
// string length too: one large string reached by many paths is small in memory
// but is scanned and serialized once per path.
const MAX_COPY_VALUES = 1000000;
const MAX_COPY_STRING_UNITS = 64 * 1024 * 1024;

function copy(x, stack = new Set(), budget = { values: 0, units: 0 }) {
  if (stack.size > 64) throw err('ENTRY');
  if (++budget.values > MAX_COPY_VALUES) throw err('ENTRY');
  if (typeof x === 'string' && (budget.units += x.length) > MAX_COPY_STRING_UNITS) throw err('ENTRY');
  if (nodeTypes.isProxy(x)) throw err('ENTRY');
  if (x === null || typeof x === 'boolean') return x;
  if (typeof x === 'string') {
    if (!x.isWellFormed()) throw err('ENTRY');
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
      out.push(copy(d.value, stack, budget));
    }
  } else {
    const names = Object.getOwnPropertyNames(x), keys = Object.keys(x);
    if (names.length !== keys.length || Reflect.ownKeys(x).length !== keys.length) throw err('ENTRY');
    out = {};
    for (const k of keys) {
      if (BAD.has(k) || !k.isWellFormed()) throw err('ENTRY');
      const d = Object.getOwnPropertyDescriptor(x, k);
      if (!d || !d.enumerable || !('value' in d)) throw err('ENTRY');
      out[k] = copy(d.value, stack, budget);
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
      !Number.isSafeInteger(c.heartbeatTtlMs) || c.heartbeatTtlMs < 1) throw err('CONFIG');
  c._paths = pathsOf(c.redactPaths, 'CONFIG'); c.redactPaths = c.redactPaths.slice(); return c;
}
function pathsOf(list, code) {
  if (!Array.isArray(list)) throw err(code);
  const paths = [];
  for (const path of list) {
    if (typeof path !== 'string' || !path.startsWith('payload.') || path.length < 9) throw err(code);
    const segments = path.split('.');
    if (segments.some(segment => !SEG.test(segment) || BAD.has(segment))) throw err(code);
    paths.push(segments);
  }
  const sorted = list.slice().sort();
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (current === previous || current.startsWith(previous + '.')) throw err(code);
  }
  return paths;
}
// Host-supplied values for reopen. All three keys are required.
function expectationsOf(input) {
  let x; try { x = copy(input); } catch (_) { throw err('EXPECTATIONS'); }
  if (!exact(x, ['projectId','redactPaths','maxNow']) || !id(x.projectId) || !safe(x.maxNow)) throw err('EXPECTATIONS');
  pathsOf(x.redactPaths, 'EXPECTATIONS'); return x;
}
// redactPaths compare as a set. pathsOf rejects duplicates, so sorted lists suffice.
function expectationProblem(c, now, x) {
  if (c.projectId !== x.projectId) return 'PROJECT_MISMATCH';
  const a = c.redactPaths.slice().sort(), b = x.redactPaths.slice().sort();
  if (a.length !== b.length || a.some((p,i) => p !== b[i])) return 'REDACTION_MISMATCH';
  if (now > x.maxNow) return 'CLOCK_AHEAD';
  return null;
}
function entryOf(input, now, budget) {
  let e; try { e = copy(input, undefined, budget); } catch (_) { throw err('ENTRY'); }
  if (!exact(e, ENTRY_KEYS) || !id(e.id) || !id(e.projectId) || !id(e.runId) || !id(e.candidateId) || !id(e.stage) ||
      !Number.isSafeInteger(e.attempt) || e.attempt < 0 || !safe(e.createdAt) || !Number.isSafeInteger(e.ttlMs) || e.ttlMs < 1 ||
      !safe(e.createdAt + e.ttlMs) || !STATES.has(e.state) || (e.heartbeatAt !== null && !safe(e.heartbeatAt)) ||
      (e.heartbeatAt !== null && e.heartbeatAt > e.createdAt) || (e.receiptId !== null && !id(e.receiptId)) ||
      (e.retryOf !== null && !id(e.retryOf)) || (e.revokes !== null && !id(e.revokes)) ||
      (e.state === 'REVOKED' ? e.revokes === null || e.retryOf !== null : e.revokes !== null) ||
      (now !== undefined && e.createdAt > now)) throw err('ENTRY');
  return e;
}
function stringUnits(value) {
  if (typeof value === 'string') return value.length;
  if (value === null || typeof value !== 'object') return 0;
  return Object.values(value).reduce((units, child) => units + stringUnits(child), 0);
}
function redact(e, paths, budget) {
  let changed = false;
  for (const path of paths) {
    let cur = e;
    for (let index = 0; index < path.length; index += 1) {
      const k = path[index];
      if (!cur || typeof cur !== 'object' || !own(cur,k) || (Array.isArray(cur) && k === 'length')) break;
      if (index === path.length - 1) {
        const value = cur[k];
        if (value !== MARK) {
          if (budget !== undefined) budget.units += MARK.length - stringUnits(value);
          cur[k] = MARK;
          changed = true;
        }
      } else cur = cur[k];
    }
  }
  return changed;
}
const fingerprint = e => H('nisi-run-journal/input/v1\n'+C(e));
const retryKey = e => e.retryOf+'\0'+e.attempt;
function expired(r, now) { return now >= r.entry.createdAt + r.entry.ttlMs; }

function referenceProblem(entry, byId, retries, revoked, now) {
  if (entry.retryOf !== null) {
    if (retries.has(retryKey(entry))) return 'RETRY_DUPLICATE';
    const target = byId.get(entry.retryOf);
    if (!target || entry.state !== 'QUEUED' || target.entry.runId !== entry.runId ||
        entry.attempt <= target.entry.attempt || entry.createdAt < target.entry.createdAt ||
        (!TERMINAL_STATES.has(target.entry.state) && !expired(target, now) && !revoked.has(target.entry.id))) return 'RETRY';
  }
  if (entry.revokes !== null) {
    const target = byId.get(entry.revokes);
    if (!target || target.entry.runId !== entry.runId || target.entry.attempt !== entry.attempt ||
        target.entry.candidateId !== entry.candidateId || target.entry.createdAt > entry.createdAt) return 'REVOCATION';
  }
  return null;
}

function build(config, watermark = 0, initial = [], sealed = false) {
  const records = initial.slice(), byId = new Map(), revoked = new Set(), active = new Map(), retries = new Set();
  for (const r of records) { byId.set(r.entry.id, r); if (r.retained) active.set(r.entry.id,r); if (r.entry.retryOf!==null) retries.add(retryKey(r.entry)); if (r.entry.revokes !== null) revoked.add(r.entry.revokes); }
  let mark = watermark;
  const prune = now => {
    const retained = [...active.values()];
    const retire = r => { r.retained=false; r.entry.payload=null; r.fingerprint=fingerprint(r.entry); active.delete(r.entry.id); };
    for (const r of retained) if (expired(r,now)) retire(r);
    for (const r of active.values()) { if (active.size<=config.maxEntries) break; retire(r); }
    return retained.filter(r=>!r.retained).map(r=>r.entry.id);
  };
  const time = now => { if (!safe(now) || now < mark) throw err('TIME'); mark=now; };
  const view = (r, now) => {
    const isRevoked = revoked.has(r.entry.id);
    const isExpired = expired(r, now);
    let liveness = r.entry.state;
    if (isRevoked) liveness = 'REVOKED';
    else if (!TERMINAL_STATES.has(liveness)) {
      if (isExpired) liveness = 'EXPIRED';
      else if (liveness === 'RUNNING' && (r.entry.heartbeatAt === null || now-r.entry.heartbeatAt > config.heartbeatTtlMs)) liveness = 'UNKNOWN';
    }
    return freeze({entry:copy(r.entry), historical:r.historical, retained:r.retained, revoked:isRevoked, expired:isExpired, liveness, authorizing:false});
  };
  const append = (input, now) => {
    if (!safe(now) || now < mark) throw err('TIME');
    const budget = { values: 0, units: 0 };
    const e=entryOf(input,now,budget);
    if (sealed) return freeze({status:'REFUSED',id:e.id,reason:'SEALED'});
    if (e.projectId !== config.projectId) return freeze({status:'REFUSED',id:e.id,reason:'PROJECT'});
    const redactionBudget = budget.units + config._paths.length * MARK.length > MAX_COPY_STRING_UNITS && !expired({entry:e},now)
      ? budget : undefined;
    redact(e,config._paths,redactionBudget);
    const old=byId.get(e.id);
    if (old) return freeze(old.fingerprint===fingerprint(e) ? {status:'DUPLICATE',id:e.id} : {status:'CONFLICT',id:e.id,reason:'ID_CONTENT_MISMATCH'});
    if (records.length>=MAX_RECORDS) return freeze({status:'REFUSED',id:e.id,reason:'HISTORY_LIMIT'});
    const problem = referenceProblem(e, byId, retries, revoked, now);
    if (problem !== null) return freeze({status:'REFUSED',id:e.id,reason:problem});
    if (budget.units > MAX_COPY_STRING_UNITS) throw err('ENTRY');
    const r={entry:e,fingerprint:fingerprint(e),retained:true,historical:false}; records.push(r); byId.set(e.id,r); active.set(e.id,r); if(e.retryOf!==null) retries.add(retryKey(e)); if (e.revokes!==null) revoked.add(e.revokes);
    mark=now; prune(now); return freeze({status:'APPENDED',id:e.id});
  };
  const list = now => { time(now); prune(now); return freeze(records.map(r=>view(r,now))); };
  const retain = now => { time(now); return freeze(prune(now)); };
  const serialize = (now = mark) => {
    if (sealed) throw err('SEALED');
    time(now); prune(now);
    const header={type:'header',schema:'nisi-run-journal-v1',config:{projectId:config.projectId,maxEntries:config.maxEntries,heartbeatTtlMs:config.heartbeatTtlMs,redactPaths:config.redactPaths.slice()},now:mark};
    let prev=H('nisi-run-journal/header/v1\n'+C(header)), lines=[C(header)];
    records.forEach((r,i)=>{ const record={entry:r.entry,fingerprint:r.fingerprint,retained:r.retained}, env={type:'entry',seq:i+1,previousHash:prev,record,hash:H('nisi-run-journal/record/v1\n'+C({seq:i+1,previousHash:prev,record}))}; lines.push(C(env)); prev=env.hash; });
    lines.push(C({type:'footer',count:records.length,lastHash:prev})); return lines.join('\n')+'\n';
  };
  return {api:freeze({append,list,retain,serialize}), records, byId, revoked, active, retries, get watermark(){return mark;}};
}

function parseLine(raw) {
  try { const v=JSON.parse(raw); return C(v)===raw ? v : null; } catch (_) { return null; }
}
function report(status, ids, line, reason) { return freeze({status,recoveredIds:ids,rejectedLine:line,reason,authorizing:false}); }

export function createRunJournal(input) { const c=configOf(input), b=build(c); return b.api; }

function reopenData(serialized, expected) {
  if (typeof serialized !== 'string' || !serialized.includes('\n')) return {journal:null,report:report('INVALID',[],1,'HEADER')};
  const trailing=!serialized.endsWith('\n'); let ls=serialized.split('\n'); let tail=null; if (trailing) tail=ls.pop(); else ls.pop();
  const h=parseLine(ls[0]);
  if (!h || !exact(h,['type','schema','config','now']) || h.type!=='header' || h.schema!=='nisi-run-journal-v1' || !safe(h.now)) return {journal:null,report:report('INVALID',[],1,'HEADER')};
  let c; try { c=configOf(h.config); } catch (_) { return {journal:null,report:report('INVALID',[],1,'HEADER')}; }
  if (expected) { const problem=expectationProblem(c,h.now,expected); if (problem) return {journal:null,report:report('INVALID',[],1,problem)}; }
  const b=build(c,h.now), ids=[]; let prev=H('nisi-run-journal/header/v1\n'+C(h)), footer=false, bad=null, retained=0, legacy=null;
  const failAt=(line,reason='RECORD',status='INVALID')=>{bad={line,reason,status};};
  for(let n=1;n<ls.length&&!bad;n++) {
    const v=parseLine(ls[n]); if (!v) { failAt(n+1); break; }
    if (v.type==='footer') {
      if (!exact(v,['type','count','lastHash']) || !Number.isSafeInteger(v.count) || v.count!==ids.length || v.lastHash!==prev) failAt(n+1,'FOOTER'); else footer=true;
      if (footer && (n+1<ls.length || trailing)) failAt(n+1<ls.length ? n+2 : ls.length+1,'TRAILING_DATA');
      break;
    }
    if (!exact(v,['type','seq','previousHash','record','hash']) || v.type!=='entry' || v.seq!==n || v.previousHash!==prev || typeof v.hash!=='string' || !/^[0-9a-f]{64}$/.test(v.hash) ||
        H('nisi-run-journal/record/v1\n'+C({seq:v.seq,previousHash:v.previousHash,record:v.record}))!==v.hash || !exact(v.record,RECORD_KEYS) || typeof v.record.fingerprint!=='string' || !/^[0-9a-f]{64}$/.test(v.record.fingerprint) || typeof v.record.retained!=='boolean') { failAt(n+1); break; }
    let e; try { e=entryOf(v.record.entry,h.now); } catch (_) { failAt(n+1); break; }
    if (ids.length>=MAX_RECORDS || e.projectId!==c.projectId || b.byId.has(e.id) || (!v.record.retained && e.payload!==null)) { failAt(n+1); break; }
    // A writer before 4fc09e7 cleared a retired payload and left the old fingerprint.
    // The record hash still matches. That file stays unauthorized. A retained-row
    // mismatch, or any other failure in the same file, stays a generic RECORD.
    if (v.record.fingerprint!==fingerprint(e)) {
      if (v.record.retained) { failAt(n+1); break; }
      if (!legacy) legacy={line:n+1,prefix:ids.length};
    }
    if (v.record.retained) {
      if (redact(e,c._paths) || expired({entry:e},h.now)) { failAt(n+1); break; }
      retained++; if(retained>c.maxEntries){failAt(n+1);break;} }
    if (referenceProblem(e, b.byId, b.retries, b.revoked, h.now) !== null) { failAt(n+1); break; }
    const r={entry:e,fingerprint:v.record.fingerprint,retained:v.record.retained,historical:true}; b.records.push(r); b.byId.set(e.id,r); if(r.retained)b.active.set(e.id,r); if(e.retryOf!==null)b.retries.add(retryKey(e)); if(e.revokes!==null)b.revoked.add(e.revokes); prev=v.hash; ids.push(e.id);
  }
  if (!bad && !footer) bad={line:ls.length+1,reason:trailing?'TRUNCATED':'MISSING_FOOTER',status:'INCOMPLETE'};
  if (bad) { const sealed=build(c,h.now,b.records,true); return {journal:sealed.api,report:report(bad.status,ids,bad.line,bad.reason)}; }
  if (legacy) { const prefix=b.records.slice(0,legacy.prefix), sealed=build(c,h.now,prefix,true); return {journal:sealed.api,report:report('INVALID',ids.slice(0,legacy.prefix),legacy.line,'LEGACY_UNRETAINED_FINGERPRINT')}; }
  return {journal:b.api,report:report('COMPLETE',ids,null,null)};
}

// expectations, when given, is {projectId, redactPaths, maxNow}. A header that differs
// is refused before any record is read. Omitting it keeps the one-argument behaviour.
export function reopen(serialized, expectations = undefined) {
  const expected = expectations === undefined ? null : expectationsOf(expectations);
  return freeze(reopenData(serialized, expected));
}
