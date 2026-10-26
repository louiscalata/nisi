import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { JOURNAL_FILE, MAX_DIAGNOSTIC_BYTES, MAX_OBSERVATIONS, initializeActivationJournal, claimActivationAttempt, appendActivationEvent, diagnoseActivationAttempt as diagnose } from "../learning/activation-journal.ts";
import { createJournaledActivationOwner, measureJournaledActivationRuntime } from "../learning/journaled-activation-owner.ts";
import { initializeActivationReceiptStore } from "../learning/activation-receipt-store.ts";

const evidence = mkdtempSync("/private/tmp/veritas-diagnostic-tests.");
console.log("# retained diagnostic-test evidence: " + evidence);
const hash = x => createHash("sha256").update(x).digest("hex"), project = hash("project"), key = hash("outer"), session = randomUUID();
const claimText = (outerKey = key, change = {}) => JSON.stringify({ schemaVersion: 1, outerKey, ownerSessionId: session, binding: { sourceDigest: hash("source"), policyDigest: hash("policy"), templateDigest: hash("template"), templateKind: "VALID_METADATA", ...change } });
const query = (cursor = null, limit = 2, outerKey = key) => JSON.stringify({ schemaVersion: 1, outerKey, limit, cursor });
const trace = (name, value) => { appendFileSync(join(evidence, "observations.jsonl"), JSON.stringify({ name, value }) + "\n", { mode: 0o600 }); return value; };
function edit(root, fn) { const db = new DatabaseSync(join(root, JOURNAL_FILE)); try { return fn(db); } finally { db.close(); } }
const stored = root => edit(root, db => Object.fromEntries(["journal_meta", "attempts", "events", "observations"].map(table => [table, db.prepare(`SELECT * FROM ${table}`).all().map(x => ({ ...x }))])));
function setup(observations = 0) {
  const root = mkdtempSync(join(evidence, "case-")); assert.equal(initializeActivationJournal(root, project).status, "INITIALIZED");
  const created = claimActivationAttempt(root, project, claimText()); assert.equal(created.status, "CREATED");
  for (let i = 0; i < observations; i++) assert.equal(claimActivationAttempt(root, project, claimText(key, i % 2 ? { policyDigest: hash("other") } : {})).status, i % 2 ? "CONFLICT" : "HISTORICAL_ONLY");
  return { root, created };
}
function safe(out) {
  assert.ok(Object.isFrozen(out)); for (const f of ["authorizing", "executionAllowed", "networkAllowed", "modelCallsAllowed", "promotionAllowed", "activeBaselineChanged"]) assert.equal(out[f], false); assert.equal(out.measuredGain, null);
  assert.ok(Buffer.byteLength(JSON.stringify(out)) <= MAX_DIAGNOSTIC_BYTES);
  if (out.diagnostic) { const d = out.diagnostic; assert.ok(Object.isFrozen(d)); assert.ok(Object.isFrozen(d.observationTexts)); assert.ok(Object.isFrozen(d.journalCounts)); assert.ok(Object.isFrozen(d.observationCounts)); assert.equal(d.coverage, "OBSERVATION_PAGE_ONLY"); assert.equal(d.ordering, "OBSERVATION_UUID_LEXICAL_NOT_CHRONOLOGICAL"); assert.equal(d.snapshotScope, "ENTIRE_VALIDATED_JOURNAL_AT_READ_TRANSACTION"); }
}
function admittedEvent(created) { const h = JSON.parse(created.history.headerText); return JSON.stringify({ schemaVersion: 1, outerKey: h.outerKey, attemptId: h.attemptId, ownerSessionId: h.ownerSessionId, expectedSequence: 0, event: { type: "ADMITTED", activationId: randomUUID(), outcome: "ADMITTED", receiptDigest: null } }); }
function page(root, cursor = null, limit = 2, outerKey = key) { const out = diagnose(root, project, query(cursor, limit, outerKey)); safe(out); assert.equal(out.status, "HISTORICAL_ONLY"); assert.equal(out.reason, "DIAGNOSTIC_SNAPSHOT_PAGE"); assert.ok(out.diagnostic); return out; }

test("empty observations still expose historical attempt, separate counts and no cursor", () => {
  const { root } = setup(); const before = stored(root), out = page(root); assert.deepEqual(out.diagnostic.observationTexts, []); assert.equal(out.diagnostic.totalObservations, 0); assert.equal(out.diagnostic.nextCursor, null); assert.equal(out.history.recoveryState, "CLAIMED_NOT_ADMITTED"); assert.deepEqual(out.diagnostic.journalCounts, { attempts: 1, events: 0, observations: 0 }); assert.deepEqual(stored(root), before);
});
test("all pages equal independent SQL snapshot exactly with no duplicates or omissions", () => {
  const { root, created } = setup(67); assert.equal(appendActivationEvent(root, project, admittedEvent(created)).status, "APPENDED");
  const before = stored(root), expected = edit(root, db => db.prepare("SELECT json FROM observations ORDER BY id").all().map(x => x.json));
  let cursor = null, collected = [], pages = 0, snapshot;
  do { const out = page(root, cursor, 32), d = out.diagnostic; snapshot ??= d.snapshotDigest; assert.equal(d.snapshotDigest, snapshot); assert.equal(d.totalObservations, 67); assert.equal(d.pageStart, collected.length); assert.equal(d.journalCounts.events, 1); assert.equal(out.history.events.length, 1); collected.push(...d.observationTexts); cursor = d.nextCursor; assert.ok(++pages <= 3); } while (cursor !== null);
  assert.equal(pages, 3); assert.deepEqual(collected, expected); assert.equal(new Set(collected.map(x => JSON.parse(x).observationId)).size, 67); assert.deepEqual(stored(root), before);
  assert.deepEqual(page(root).diagnostic.observationCounts, { repeats: 34, conflicts: 33 });
});
test("query performs no logical writes, mutations or COMMIT", () => {
  const { root } = setup(4), before = stored(root), exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare, commands = [];
  DatabaseSync.prototype.exec = function(sql) { commands.push(sql); assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|COMMIT|BEGIN IMMEDIATE)\b/i); return exec.call(this, sql); };
  DatabaseSync.prototype.prepare = function(sql) { commands.push(sql); assert.match(sql, /^(?:SELECT|PRAGMA)\b/); return prepare.call(this, sql); };
  try { const first = page(root); page(root, first.diagnostic.nextCursor); } finally { DatabaseSync.prototype.exec = exec; DatabaseSync.prototype.prepare = prepare; }
  trace("readonly-commands", commands); assert.deepEqual(stored(root), before);
});
for (const limit of [0, -1, 33, 1.5, "2", null, Number.MAX_SAFE_INTEGER]) test(`invalid page limit ${JSON.stringify(limit)} refuses before reading`, () => {
  const { root } = setup(); const out = diagnose(root, project, query(null, limit)); assert.equal(out.status, "REFUSED"); assert.equal(out.reason, "DIAGNOSTIC_QUERY_INVALID"); assert.equal(out.history, null); assert.equal(out.diagnostic, null);
});
for (const input of [null, "{PRIVATE_RAW_SENTINEL", "x".repeat(4097), query().replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'), query().replace('"schemaVersion":1', '"raw":"PRIVATE_RAW_SENTINEL","schemaVersion":1'), query("x".repeat(2049)), query(""), query(null, 2, "raw-task")]) test(`malformed query ${typeof input === "string" ? input.length : "null"} returns no data`, () => {
  const { root } = setup(); const before = stored(root), out = diagnose(root, project, input); safe(out); assert.equal(out.reason, "DIAGNOSTIC_QUERY_INVALID"); assert.equal(out.history, null); assert.equal(out.diagnostic, null); assert.deepEqual(stored(root), before);
  for (const file of readdirSync(root)) assert.equal(readFileSync(join(root, file)).includes(Buffer.from("PRIVATE_RAW_SENTINEL")), false);
});
test("unknown attempt and unavailable directory never fabricate rows or initialize storage", () => {
  const { root } = setup(), out = diagnose(root, project, query(null, 2, hash("missing"))); assert.equal(out.status, "MISSING"); assert.equal(out.diagnostic, null); assert.equal(out.history, null); assert.equal(stored(root).attempts.length, 1);
  const absent = mkdtempSync(join(evidence, "absent-")); assert.equal(diagnose(absent, project, query()).status, "ERROR"); assert.deepEqual(readdirSync(absent), []);
});
test("cross-project and noncanonical directory queries refuse", () => { const { root } = setup(); assert.equal(diagnose(root, hash("wrong"), query()).reason, "JOURNAL_PROJECT_INVALID"); const link = join(evidence, "link-" + randomUUID()); symlinkSync(root, link); assert.equal(diagnose(link, project, query()).status, "REFUSED"); });
for (const [name, value, expected] of [
  ["journalId", randomUUID(), "DIAGNOSTIC_CURSOR_SCOPE_MISMATCH"], ["projectDigest", hash("other"), "DIAGNOSTIC_CURSOR_SCOPE_MISMATCH"], ["outerKey", hash("other"), "DIAGNOSTIC_CURSOR_SCOPE_MISMATCH"], ["attemptId", randomUUID(), "DIAGNOSTIC_CURSOR_SCOPE_MISMATCH"],
  ["snapshotDigest", hash("wrong"), "DIAGNOSTIC_CURSOR_STALE"], ["limit", 1, "DIAGNOSTIC_CURSOR_SCOPE_MISMATCH"], ["offset", 0, "DIAGNOSTIC_CURSOR_POSITION_INVALID"], ["offset", 4, "DIAGNOSTIC_CURSOR_POSITION_INVALID"], ["afterObservationId", randomUUID(), "DIAGNOSTIC_CURSOR_POSITION_INVALID"], ["schemaVersion", 2, "DIAGNOSTIC_CURSOR_INVALID"]
]) test(`cursor changed ${name}=${value} refuses with exact category`, () => {
  const { root } = setup(4), first = page(root), c = JSON.parse(first.diagnostic.nextCursor); c[name] = value; const out = diagnose(root, project, query(JSON.stringify(c))); assert.equal(out.status, "REFUSED"); assert.equal(out.reason, expected); assert.equal(out.diagnostic, null); assert.equal(out.history, null);
});
test("cursor cannot be reused against another valid attempt or fresh journal", () => { const a = setup(4), b = setup(4), first = page(a.root); assert.equal(diagnose(b.root, project, query(first.diagnostic.nextCursor)).reason, "DIAGNOSTIC_CURSOR_SCOPE_MISMATCH"); claimActivationAttempt(a.root, project, claimText(hash("second"))); assert.equal(diagnose(a.root, project, query(first.diagnostic.nextCursor, 2, hash("second"))).reason, "DIAGNOSTIC_CURSOR_SCOPE_MISMATCH"); });
test("lifecycle append invalidates continuation even when observation order is unchanged", () => {
  const { root, created } = setup(4), first = page(root); assert.equal(appendActivationEvent(root, project, admittedEvent(created)).status, "APPENDED"); const out = diagnose(root, project, query(first.diagnostic.nextCursor)); assert.equal(out.status, "REFUSED"); assert.equal(out.reason, "DIAGNOSTIC_CURSOR_STALE"); assert.equal(out.diagnostic, null); assert.equal(out.history, null); assert.notEqual(page(root).diagnostic.snapshotDigest, first.diagnostic.snapshotDigest);
});
test("unrelated attempt append invalidates whole-journal cursor", () => { const { root } = setup(4), first = page(root); claimActivationAttempt(root, project, claimText(hash("second"))); const out = diagnose(root, project, query(first.diagnostic.nextCursor)); assert.equal(out.reason, "DIAGNOSTIC_CURSOR_STALE"); assert.equal(out.diagnostic, null); });
test("new repeat observation requires refresh rather than silently skipping a UUID", () => { const { root } = setup(4), first = page(root); claimActivationAttempt(root, project, claimText()); const out = diagnose(root, project, query(first.diagnostic.nextCursor)); assert.equal(out.reason, "DIAGNOSTIC_CURSOR_STALE"); assert.equal(out.diagnostic, null); assert.equal(page(root).diagnostic.totalObservations, 5); });
test("corrupt observation outside requested page is refused before any page is exposed", () => {
  const { root } = setup(4);
  edit(root, db => { const row = db.prepare("SELECT id,json FROM observations ORDER BY id DESC LIMIT 1").get(), trigger = db.prepare("SELECT sql FROM sqlite_schema WHERE name='observations_no_update'").get().sql;
    const { digest, ...body } = JSON.parse(row.json); body.kind = "FORGED_KIND"; const modified = JSON.stringify({ ...body, digest: hash("veritas:activation-journal-observation:v1\0" + JSON.stringify(body)) });
    db.exec("DROP TRIGGER observations_no_update"); db.prepare("UPDATE observations SET json=? WHERE id=?").run(modified, row.id); db.exec(trigger);
  });
  const out = diagnose(root, project, query(null, 1)); assert.equal(out.status, "REFUSED"); assert.equal(out.reason, "OBSERVATION_KIND_INVALID"); assert.equal(out.diagnostic, null); assert.equal(out.history, null);
});
test("corrupt different attempt prevents partial favorable diagnostics", () => {
  const { root } = setup(4), other = hash("second"); claimActivationAttempt(root, project, claimText(other));
  edit(root, db => { const trigger = db.prepare("SELECT sql FROM sqlite_schema WHERE name='attempts_no_update'").get().sql; db.exec("DROP TRIGGER attempts_no_update"); db.prepare("UPDATE attempts SET json=? WHERE outer_key=?").run("{", other); db.exec(trigger); });
  const out = diagnose(root, project, query()); assert.equal(out.status, "REFUSED"); assert.equal(out.history, null); assert.equal(out.diagnostic, null);
});
for (const fault of ["rollback", "close"]) test(`${fault} failure discards an already constructed diagnostic page`, () => {
  const { root } = setup(4), exec = DatabaseSync.prototype.exec, close = DatabaseSync.prototype.close; let trips = 0;
  if (fault === "rollback") DatabaseSync.prototype.exec = function(sql) { const value = exec.call(this, sql); if (sql === "ROLLBACK") { trips++; throw new Error("injected rollback"); } return value; };
  if (fault === "close") DatabaseSync.prototype.close = function() { close.call(this); trips++; throw new Error("injected close"); };
  let out; try { out = diagnose(root, project, query()); } finally { DatabaseSync.prototype.exec = exec; DatabaseSync.prototype.close = close; }
  trace(fault, out); assert.equal(trips, 1); assert.equal(out.status, "INCONCLUSIVE"); assert.equal(out.reason, fault === "rollback" ? "JOURNAL_ROLLBACK_UNCONFIRMED" : "JOURNAL_CLOSE_UNCONFIRMED"); assert.equal(out.diagnostic, null); assert.equal(out.history, null);
});
test("real concurrent writer does not mix rows into an already acquired read snapshot", () => {
  const { root } = setup(4), prepare = DatabaseSync.prototype.prepare, beforeRows = stored(root).observations; let writes = 0, out;
  DatabaseSync.prototype.prepare = function(sql) {
    const statement = prepare.call(this, sql);
    if (sql !== "SELECT id, json FROM observations ORDER BY id LIMIT 513") return statement;
    return new Proxy(statement, { get(target, prop) { if (prop !== "all") return Reflect.get(target, prop); return (...args) => {
      const value = target.all(...args);
      if (!writes++) { const run = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", fileURLToPath(new URL("./fixtures/activation-diagnostic-writer.mjs", import.meta.url))], { input: JSON.stringify({ root, project, requestText: claimText() }), encoding: "utf8", timeout: 5000, maxBuffer: 65536 });
        trace("concurrent-writer", { exitCode: run.status, signal: run.signal, error: run.error?.message ?? null, stdout: run.stdout, stderr: run.stderr }); assert.equal(run.status, 0); assert.equal(run.signal, null); assert.equal(run.error, undefined); assert.equal(run.stderr, ""); assert.equal(JSON.parse(run.stdout).status, "HISTORICAL_ONLY"); }
      return value;
    }; } });
  };
  try { out = page(root); } finally { DatabaseSync.prototype.prepare = prepare; }
  assert.equal(writes, 1); assert.equal(out.diagnostic.totalObservations, 4); const afterRows = stored(root).observations, previousIDs = new Set(beforeRows.map(x => x.id)), added = afterRows.filter(x => !previousIDs.has(x.id));
  assert.equal(afterRows.length, 5); assert.equal(added.length, 1); const row = JSON.parse(added[0].json); assert.equal(row.kind, "REPEAT"); assert.equal(row.outerKey, key); assert.equal(row.observationId, added[0].id); assert.deepEqual(row.binding, JSON.parse(claimText()).binding);
  assert.equal(diagnose(root, project, query(out.diagnostic.nextCursor)).reason, "DIAGNOSTIC_CURSOR_STALE");
});
test("held WAL writer exposes only committed rows to diagnostics", () => {
  const { root } = setup(4), before = stored(root); edit(root, db => { db.exec("BEGIN IMMEDIATE"); try { assert.equal(page(root).diagnostic.totalObservations, 4); } finally { db.exec("ROLLBACK"); } }); assert.deepEqual(stored(root), before);
});
test("full observation capacity can still be inspected without pruning", () => {
  const { root } = setup(MAX_OBSERVATIONS), before = stored(root), expected = edit(root, db => db.prepare("SELECT id FROM observations ORDER BY id").all().map(x => x.id)); let cursor = null, count = 0; const actual = [];
  do { const out = page(root, cursor, 32); assert.equal(out.diagnostic.pageStart, count); const ids = out.diagnostic.observationTexts.map(x => JSON.parse(x).observationId); assert.deepEqual(ids, expected.slice(count, count + 32)); actual.push(...ids); count += ids.length; cursor = out.diagnostic.nextCursor; assert.ok(count <= MAX_OBSERVATIONS); } while (cursor !== null);
  assert.equal(count, MAX_OBSERVATIONS); assert.deepEqual(actual, expected); assert.equal(new Set(actual).size, MAX_OBSERVATIONS); assert.deepEqual(stored(root), before);
});
for (const count of [1, 32, 33]) test(`boundary ${count} observation page coverage is exact`, () => { const { root } = setup(count), first = page(root, null, 32); assert.equal(first.diagnostic.observationTexts.length, Math.min(count, 32)); assert.equal(first.diagnostic.nextCursor === null, count <= 32); if (count > 32) { const last = page(root, first.diagnostic.nextCursor, 32); assert.equal(last.diagnostic.observationTexts.length, 1); assert.equal(last.diagnostic.nextCursor, null); } });
test("successful diagnostic exposes only closed metadata, not task/template/feedback text or authority", () => {
  const { root } = setup(4), raw = ["PRIVATE_TASK_BODY", "PRIVATE_TEMPLATE_BODY", "PRIVATE_FEEDBACK_BODY"], other = hash("metadata-only");
  const text = claimText(other, { sourceDigest: hash(raw[0]), policyDigest: hash(raw[1]), templateDigest: hash(raw[2]) }); claimActivationAttempt(root, project, text); claimActivationAttempt(root, project, text);
  const out = page(root, null, 2, other), serialized = JSON.stringify(out); for (const text of raw) assert.equal(serialized.includes(text), false);
  assert.deepEqual(Object.keys(out.diagnostic).sort(), ["diagnosticVersion", "journalId", "projectDigest", "outerKey", "attemptId", "snapshotDigest", "snapshotScope", "ordering", "coverage", "journalCounts", "observationCounts", "totalObservations", "pageStart", "pageLimit", "observationTexts", "nextCursor"].sort());
  for (const encoded of [out.history.headerText, ...out.diagnostic.observationTexts]) { const value = JSON.parse(encoded); assert.equal(Object.hasOwn(value, "raw"), false); assert.equal(Object.hasOwn(value, "task"), false); assert.equal(Object.hasOwn(value, "feedback"), false); assert.deepEqual(Object.keys(value.binding).sort(), ["policyDigest", "sourceDigest", "templateDigest", "templateKind"]); }
  assert.equal(out.evidenceStatus, "LOCAL_METADATA_ONLY"); safe(out);
});
test("final path replacement discards a page after the read completed", () => {
  const { root } = setup(4), prepare = DatabaseSync.prototype.prepare; let replaced = false, out;
  DatabaseSync.prototype.prepare = function(sql) { const statement = prepare.call(this, sql); if (sql !== "SELECT id, json FROM observations ORDER BY id LIMIT 513") return statement;
    return new Proxy(statement, { get(target, prop) { if (prop !== "all") return Reflect.get(target, prop); return (...args) => { const rows = target.all(...args); if (!replaced) { replaced = true; const original = join(root, JOURNAL_FILE), copy = join(root, "replacement.sqlite3"); copyFileSync(original, copy, 1); renameSync(original, join(root, "retained-original.sqlite3")); renameSync(copy, original); } return rows; }; } });
  };
  try { out = diagnose(root, project, query()); } finally { DatabaseSync.prototype.prepare = prepare; }
  trace("path-replacement", out); assert.equal(replaced, true); assert.equal(out.status, "REFUSED"); assert.equal(out.reason, "JOURNAL_PATH_CHANGED"); assert.equal(out.diagnostic, null); assert.equal(out.history, null);
});
test("journaled owner exposes the same diagnostic without enabling or spawning", async () => {
  const { root } = setup(4), base = mkdtempSync(join(evidence, "owner-")), store = join(base, "store"), directory = join(base, "owner"); for (const path of [store, directory]) mkdirSync(path, { mode: 0o700 }); assert.equal(initializeActivationReceiptStore(store, project).status, "INITIALIZED");
  const owner = createJournaledActivationOwner(JSON.stringify({ schemaVersion: 1, projectDigest: project, storeDirectory: store, ownerDirectory: directory, journalDirectory: root, expectedAdapterDigest: measureJournaledActivationRuntime().digest, deadlineMs: 5000 }));
  try { const before = stored(root), out = owner.diagnose(query()); safe(out); assert.equal(out.status, "HISTORICAL_ONLY"); assert.equal(owner.inspect().mode, "OFF"); assert.equal(owner.inspect().spawnCount, 0); assert.deepEqual(stored(root), before); } finally { await owner.close(); }
});
