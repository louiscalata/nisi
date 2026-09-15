import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, linkSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fork } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { JOURNAL_FILE, MAX_ATTEMPTS, MAX_OBSERVATIONS, initializeActivationJournal as initialize, inspectActivationJournal as inspect, inspectActivationAttempt as recover, claimActivationAttempt as claim, appendActivationEvent as append } from "../learning/activation-journal.ts";

const evidence = mkdtempSync("/private/tmp/veritas-journal-tests.");
console.log("# retained journal-test evidence: " + evidence);
const hash = x => createHash("sha256").update(x).digest("hex"), project = hash("project"), session = randomUUID();
const trace = (name, value) => { appendFileSync(join(evidence, "observations.jsonl"), JSON.stringify({ name, value }) + "\n", { mode: 0o600 }); return value; };
const input = (outerKey = hash("outer"), changes = {}) => JSON.stringify({ schemaVersion: 1, outerKey, ownerSessionId: session, binding: { sourceDigest: hash("source"), policyDigest: hash("policy"), templateDigest: hash("template"), templateKind: "VALID_METADATA" }, ...changes });
const safe = (result, local = true) => {
  for (const flag of ["authorizing", "executionAllowed", "networkAllowed", "modelCallsAllowed", "promotionAllowed", "activeBaselineChanged"]) assert.equal(result[flag], false, flag);
  assert.equal(result.measuredGain, null); assert.equal(result.evidenceStatus, "LOCAL_METADATA_ONLY"); if (local) assert.ok(Object.isFrozen(result));
  if (local && result.history) { assert.ok(Object.isFrozen(result.history)); assert.ok(Object.isFrozen(result.history.events)); }
};
function root(ready = true) { const p = mkdtempSync(join(evidence, "case-")); if (ready) { const out = initialize(p, project); safe(out); assert.equal(out.status, "INITIALIZED"); } return p; }
function edit(p, fn) { const db = new DatabaseSync(join(p, JOURNAL_FILE)); try { return fn(db); } finally { db.close(); } }
// Independent SQL reader: do not ask the production parser to certify itself.
function rows(p) { return edit(p, db => Object.fromEntries(["journal_meta", "attempts", "events", "observations"].map(table => [table, db.prepare(`SELECT * FROM ${table}`).all().map(row => ({ ...row }))]))); }
function eventText(created, type, expectedSequence, { outcome, activationId = "11111111-1111-4111-8111-111111111111", receiptDigest = null, ...changes } = {}) {
  const h = JSON.parse(created.history.headerText);
  const outcomes = { ADMITTED: "ADMITTED", RUN_INTENT: "PENDING", PREPARED: "PREPARED", REJECTED: "REFUSED", RETURN_INTENT: "RETURN_ATTEMPTED_ACK_UNKNOWN", CALLER_ACKNOWLEDGED: "CALLER_ACKNOWLEDGED", REVOCATION_OBSERVED: "REVOKED", UNCONFIRMED: "INCONCLUSIVE" };
  return JSON.stringify({ schemaVersion: 1, outerKey: h.outerKey, attemptId: h.attemptId, ownerSessionId: h.ownerSessionId, expectedSequence, event: { type, activationId: type === "REJECTED" ? null : activationId, outcome: outcome ?? outcomes[type], receiptDigest }, ...changes });
}
function chain(p, created, types) { return types.map((type, sequence) => { const out = append(p, project, eventText(created, type, sequence, { receiptDigest: ["RETURN_INTENT", "CALLER_ACKNOWLEDGED"].includes(type) ? hash("receipt") : null })); safe(out); assert.equal(out.status, "APPENDED"); return out; }).at(-1); }
function independentChain(p) {
  const stored = rows(p), headers = new Map(stored.attempts.map(row => [row.outer_key, JSON.parse(row.json)]));
  for (const [table, domain] of [["journal_meta", "meta"], ["attempts", "attempt"], ["events", "event"], ["observations", "observation"]]) for (const row of stored[table]) {
    const { digest, ...body } = JSON.parse(row.json);
    assert.equal(digest, hash("veritas:activation-journal-" + domain + ":v1\0" + JSON.stringify(body)));
  }
  const prior = new Map(), activations = new Map();
  const allowed = { CLAIMED: ["ADMITTED", "REJECTED"], ADMITTED: ["RUN_INTENT", "UNCONFIRMED", "REVOCATION_OBSERVED"], RUN_INTENT: ["PREPARED", "UNCONFIRMED", "REVOCATION_OBSERVED"], PREPARED: ["RETURN_INTENT", "UNCONFIRMED", "REVOCATION_OBSERVED"], RETURN_INTENT: ["CALLER_ACKNOWLEDGED", "REVOCATION_OBSERVED", "UNCONFIRMED"] };
  const expectedOutcomes = { ADMITTED: ["ADMITTED"], REJECTED: ["REFUSED"], RUN_INTENT: ["PENDING"], PREPARED: ["PREPARED"], RETURN_INTENT: ["RETURN_ATTEMPTED_ACK_UNKNOWN"], CALLER_ACKNOWLEDGED: ["CALLER_ACKNOWLEDGED"], UNCONFIRMED: ["ERROR", "REFUSED", "INCONCLUSIVE", "CONFLICT", "BUSY"], REVOCATION_OBSERVED: ["REVOKED", "CANCELLED", "TIMED_OUT"] };
  for (const row of stored.events.sort((a, b) => a.outer_key.localeCompare(b.outer_key) || a.seq - b.seq)) {
    const e = JSON.parse(row.json), before = prior.get(row.outer_key);
    assert.equal(row.seq, (before?.sequence ?? 0) + 1); assert.equal(e.sequence, row.seq);
    const header = headers.get(row.outer_key); assert.equal(e.outerKey, row.outer_key); assert.equal(e.attemptId, header.attemptId); assert.equal(e.projectDigest, project); assert.equal(e.journalId, header.journalId);
    assert.equal(e.priorDigest, before?.digest ?? header.digest);
    assert.ok(allowed[before?.event.type ?? "CLAIMED"]?.includes(e.event.type), "independent lifecycle transition"); assert.ok(expectedOutcomes[e.event.type]?.includes(e.event.outcome));
    if (e.event.type === "ADMITTED") activations.set(row.outer_key, e.event.activationId);
    assert.equal(e.event.activationId, e.event.type === "REJECTED" ? null : activations.get(row.outer_key));
    if (["RETURN_INTENT", "CALLER_ACKNOWLEDGED"].includes(e.event.type)) { assert.match(e.event.receiptDigest, /^[a-f0-9]{64}$/); if (e.event.type === "CALLER_ACKNOWLEDGED") assert.equal(e.event.receiptDigest, before.event.receiptDigest); }
    else assert.equal(e.event.receiptDigest, null);
    prior.set(row.outer_key, e);
  }
  for (const row of stored.observations) { const o = JSON.parse(row.json), h = headers.get(o.outerKey); assert.ok(h); assert.equal(o.observationId, row.id); assert.equal(o.attemptId, h.attemptId); assert.equal(o.projectDigest, project); assert.equal(o.journalId, h.journalId); assert.equal(o.kind, JSON.stringify(o.binding) === JSON.stringify(h.binding) ? "REPEAT" : "CONFLICT"); }
  return stored;
}
const children = new Map();
afterEach(async () => { await Promise.all([...children].map(async ([child, done]) => { child.kill("SIGKILL"); await done.catch(() => {}); })); assert.equal(children.size, 0); });
async function worker(p, text, options = {}) {
  const child = fork(new URL("./fixtures/activation-journal-worker.mjs", import.meta.url), [], { stdio: ["pipe", "pipe", "pipe", "ipc"], execArgv: ["--disable-warning=ExperimentalWarning"] });
  let stdout = "", stderr = "", buffer = "", failed, seenReady = false, seenPhase = false;
  let readyResolve, readyReject, phaseResolve, phaseReject, doneResolve, doneReject;
  const ready = new Promise((a, b) => { readyResolve = a; readyReject = b; });
  const phase = new Promise((a, b) => { phaseResolve = a; phaseReject = b; });
  const done = new Promise((a, b) => { doneResolve = a; doneReject = b; });
  for (const promise of [ready, phase, done]) promise.catch(() => {});
  const events = [], fail = e => { failed ??= e; readyReject(e); phaseReject(e); child.kill("SIGKILL"); };
  const timer = setTimeout(() => fail(new Error("journal worker timeout")), 10000); children.set(child, done);
  child.stdout.on("data", bytes => { if (failed) return; if (Buffer.byteLength(stdout) + bytes.length > 100000) return fail(new Error("stdout bound")); stdout += bytes; buffer += bytes;
    while (buffer.includes("\n")) { const i = buffer.indexOf("\n"), line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      try { const event = JSON.parse(line); events.push(event); if (event.event === "ready") { seenReady = true; readyResolve(); } if (event.event === "phase") { seenPhase = true; phaseResolve(event.phase); } } catch (e) { fail(e); }
    }
  });
  child.stderr.on("data", bytes => { if (failed) return; if (Buffer.byteLength(stderr) + bytes.length > 65536) return fail(new Error("stderr bound")); stderr += bytes; });
  child.on("error", fail); child.stdin.on("error", fail);
  child.on("close", (code, signal) => { clearTimeout(timer); children.delete(child); if (!seenReady) readyReject(new Error("closed before ready")); if (!seenPhase) phaseReject(new Error("closed before phase"));
    try { const value = trace("child", { pid: child.pid, code, signal, stdout, stderr, options, failed: failed?.message ?? null }); if (failed) doneReject(failed); else doneResolve({ ...value, events }); } catch (e) { doneReject(e); }
  });
  await ready;
  return { child, phase, done, start: () => child.send({ root: p, project, text, ...options }, e => { if (e) fail(e); }) };
}
async function finished(job) { const value = await job.done; assert.equal(value.code, 0); assert.equal(value.signal, null); assert.equal(value.stderr, ""); const results = value.events.filter(x => x.event === "result"); assert.equal(results.length, 1); safe(results[0].result, false); return results[0].result; }

test("explicit initialization only; missing stores are not created and existing files survive", () => {
  const p = root(false); assert.equal(inspect(p, project).status, "ERROR"); assert.deepEqual(readdirSync(p), []);
  assert.equal(initialize(p, project).status, "INITIALIZED"); assert.equal(inspect(p, project).status, "AVAILABLE");
  const before = readFileSync(join(p, JOURNAL_FILE)); assert.equal(initialize(p, project).reason, "INITIALIZATION_REQUIRES_EMPTY_DIRECTORY"); assert.deepEqual(readFileSync(join(p, JOURNAL_FILE)), before);
});
test("claim and exact repeat/conflict preserve lifecycle head and record separate observations", () => {
  const p = root(), first = claim(p, project, input()); safe(first); assert.equal(first.status, "CREATED"); assert.equal(first.history.recoveryState, "CLAIMED_NOT_ADMITTED");
  const repeat = claim(p, project, input(undefined, { ownerSessionId: randomUUID() })); assert.equal(repeat.status, "HISTORICAL_ONLY"); assert.deepEqual(repeat.history, first.history);
  const changed = JSON.parse(input()); changed.binding.templateDigest = hash("other"); const conflict = claim(p, project, JSON.stringify(changed)); assert.equal(conflict.status, "CONFLICT"); assert.deepEqual(conflict.history, first.history);
  const stored = independentChain(p); assert.equal(stored.attempts.length, 1); assert.equal(stored.events.length, 0); assert.deepEqual(stored.observations.map(x => JSON.parse(x.json).kind).sort(), ["CONFLICT", "REPEAT"]);
});
test("return intent and caller acknowledgment are different append-only events", () => {
  const p = root(), created = claim(p, project, input());
  const returned = chain(p, created, ["ADMITTED", "RUN_INTENT", "PREPARED", "RETURN_INTENT"]);
  assert.equal(returned.history.recoveryState, "RETURN_ATTEMPTED_ACK_UNKNOWN"); assert.equal(returned.history.callerAcknowledged, false); assert.equal(returned.history.returnIntentObserved, true);
  const wrong = append(p, project, eventText(created, "CALLER_ACKNOWLEDGED", 4, { receiptDigest: hash("wrong") })); assert.equal(wrong.reason, "ACK_RECEIPT_MISMATCH");
  const ack = append(p, project, eventText(created, "CALLER_ACKNOWLEDGED", 4, { receiptDigest: hash("receipt") })); assert.equal(ack.history.callerAcknowledged, true);
  assert.equal(append(p, project, eventText(created, "REVOCATION_OBSERVED", 5)).reason, "LIFECYCLE_TRANSITION_INVALID"); assert.equal(independentChain(p).events.length, 5);
});
test("revocation after return intent cannot erase the attempted handoff observation", () => {
  const p = root(), created = claim(p, project, input()); chain(p, created, ["ADMITTED", "RUN_INTENT", "PREPARED", "RETURN_INTENT"]);
  const out = append(p, project, eventText(created, "REVOCATION_OBSERVED", 4)); assert.equal(out.history.returnIntentObserved, true); assert.equal(out.history.callerAcknowledged, false); assert.equal(out.history.recoveryState, "REVOCATION_OBSERVED"); independentChain(p);
});
test("exact event replay is idempotent but altered payload at same sequence conflicts", () => {
  const p = root(), created = claim(p, project, input()), text = eventText(created, "ADMITTED", 0); assert.equal(append(p, project, text).status, "APPENDED");
  assert.equal(append(p, project, text).status, "REPLAYED"); assert.equal(append(p, project, eventText(created, "REJECTED", 0)).status, "CONFLICT"); assert.equal(rows(p).events.length, 1);
});
for (const [name, change, reason] of [
  ["owner", { ownerSessionId: randomUUID() }, "APPEND_OWNER_BINDING_INVALID"], ["attempt", { attemptId: randomUUID() }, "APPEND_OWNER_BINDING_INVALID"],
  ["key", { outerKey: hash("different") }, "APPEND_OWNER_BINDING_INVALID"], ["sequence gap", { expectedSequence: 2 }, "EVENT_SEQUENCE_OR_CAPACITY_REFUSED"]
]) test(`append refuses changed ${name} without rows`, () => { const p = root(), c = claim(p, project, input()); assert.equal(append(p, project, eventText(c, "ADMITTED", 0, change)).reason, reason); assert.equal(rows(p).events.length, 0); });
for (const type of ["RUN_INTENT", "PREPARED", "RETURN_INTENT", "CALLER_ACKNOWLEDGED", "REVOCATION_OBSERVED", "UNCONFIRMED"]) test(`claimed attempt cannot skip directly to ${type}`, () => {
  const p = root(), c = claim(p, project, input()); const out = append(p, project, eventText(c, type, 0, { receiptDigest: ["RETURN_INTENT", "CALLER_ACKNOWLEDGED"].includes(type) ? hash("receipt") : null })); assert.equal(out.reason, "LIFECYCLE_TRANSITION_INVALID"); assert.equal(rows(p).events.length, 0);
});
test("later event cannot substitute activation identity", () => { const p = root(), c = claim(p, project, input()); chain(p, c, ["ADMITTED"]); assert.equal(append(p, project, eventText(c, "RUN_INTENT", 1, { activationId: randomUUID() })).reason, "LIFECYCLE_ACTIVATION_CHANGED"); });
test("rejected attempt stays terminal and retains no task body", () => { const p = root(), c = claim(p, project, input()); const out = chain(p, c, ["REJECTED"]); assert.equal(out.history.recoveryState, "REJECTION_RECORDED"); assert.equal(append(p, project, eventText(c, "ADMITTED", 1)).reason, "LIFECYCLE_TRANSITION_INVALID"); independentChain(p); });
for (const [name, text] of [["nontext", null], ["malformed", "PRIVATE_RAW_SENTINEL{"], ["oversize", "PRIVATE_RAW_SENTINEL".repeat(500)], ["duplicate key", input().replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')], ["extra field", input().replace('"schemaVersion":1', '"raw":"PRIVATE_RAW_SENTINEL","schemaVersion":1')]]) test(`bad ${name} claim never retains raw input`, () => {
  const p = root(); assert.equal(claim(p, project, text).status, "REFUSED"); assert.equal(rows(p).attempts.length, 0); assert.equal(readFileSync(join(p, JOURNAL_FILE)).includes(Buffer.from("PRIVATE_RAW_SENTINEL")), false);
});
test("cross-project inspect, claim and recovery refuse without altering scope", () => { const p = root(); for (const fn of [() => inspect(p, hash("other")), () => claim(p, hash("other"), input()), () => recover(p, hash("other"), hash("outer"))]) assert.equal(fn().reason, "JOURNAL_PROJECT_INVALID"); assert.equal(rows(p).attempts.length, 0); });
for (const mode of ["directory mode", "file mode", "hardlink", "symlink"]) test(`unsafe ${mode} is refused`, () => {
  const p = root(), file = join(p, JOURNAL_FILE);
  if (mode === "directory mode") chmodSync(p, 0o755);
  if (mode === "file mode") chmodSync(file, 0o644);
  if (mode === "hardlink") linkSync(file, join(p, "alias"));
  if (mode === "symlink") { const link = join(evidence, randomUUID()); symlinkSync(p, link); assert.equal(inspect(link, project).status, "REFUSED"); return; }
  assert.equal(inspect(p, project).status, "REFUSED");
});
test("each table rejects UPDATE and DELETE through actual SQLite triggers", () => {
  const p = root(), c = claim(p, project, input()); chain(p, c, ["ADMITTED"]); claim(p, project, input());
  edit(p, db => { for (const table of ["journal_meta", "attempts", "events", "observations"]) for (const sql of [`UPDATE ${table} SET json=json`, `DELETE FROM ${table}`]) assert.throws(() => db.exec(sql), /APPEND_ONLY/); });
  assert.equal(inspect(p, project).status, "AVAILABLE"); independentChain(p);
});
for (const mode of ["schema", "digest", "chain", "sequence", "version", "scope", "truncated"]) test(`independent ${mode} corruption cannot recover favorable history`, () => {
  const p = root(), c = claim(p, project, input()); chain(p, c, ["ADMITTED", "RUN_INTENT"]);
  edit(p, db => {
    if (mode === "schema") { db.exec("CREATE TABLE extra(value TEXT)"); return; }
    const trigger = db.prepare("SELECT sql FROM sqlite_schema WHERE name='events_no_update'").get().sql;
    db.exec("DROP TRIGGER events_no_update"); const row = db.prepare("SELECT json FROM events WHERE seq=2").get(); let text = row.json;
    if (mode === "truncated") text = text.slice(0, -1);
    else { const { digest, ...body } = JSON.parse(text); if (mode === "digest") text = JSON.stringify({ ...body, digest: hash("wrong") });
      else { if (mode === "chain") body.priorDigest = hash("wrong"); if (mode === "sequence") body.sequence = 7; if (mode === "version") body.schemaVersion = 2; if (mode === "scope") body.projectDigest = hash("other"); text = JSON.stringify({ ...body, digest: hash("veritas:activation-journal-event:v1\0" + JSON.stringify(body)) }); }
    }
    db.prepare("UPDATE events SET json=? WHERE seq=2").run(text); db.exec(trigger);
  });
  const out = recover(p, project, hash("outer")); trace(mode, out); assert.equal(out.status, "REFUSED"); assert.equal(out.history, null);
});
test("held writer lock prevents a new claim with no automatic retry", () => { const p = root(); edit(p, db => { db.exec("BEGIN IMMEDIATE"); try { const out = claim(p, project, input()); assert.equal(out.status, "ERROR"); assert.equal(out.history, null); } finally { db.exec("ROLLBACK"); } }); assert.equal(rows(p).attempts.length, 0); });
for (const fault of ["commit before", "commit after", "readback", "rollback", "close"]) test(`${fault} ambiguity withholds history; inspection is explicit`, () => {
  const p = root(), originalExec = DatabaseSync.prototype.exec, originalClose = DatabaseSync.prototype.close; let commits = 0, tripped = false;
  DatabaseSync.prototype.exec = function(sql) {
    if (sql === "COMMIT") { commits++; if (fault === "commit before") throw new Error("injected commit before"); const value = originalExec.call(this, sql); if (fault === "commit after") throw new Error("injected commit after"); return value; }
    if (fault === "readback" && commits && sql === "BEGIN") throw new Error("injected readback");
    if (fault === "rollback" && sql === "ROLLBACK") { originalExec.call(this, sql); throw new Error("injected rollback"); }
    return originalExec.call(this, sql);
  };
  if (fault === "close") DatabaseSync.prototype.close = function() { originalClose.call(this); tripped = true; throw new Error("injected close"); };
  let out; try { out = claim(p, project, input()); } finally { DatabaseSync.prototype.exec = originalExec; DatabaseSync.prototype.close = originalClose; }
  trace(fault, out); assert.equal(out.status, "INCONCLUSIVE"); assert.equal(out.history, null); assert.equal(commits, 1); if (fault === "close") assert.equal(tripped, true);
  assert.equal(rows(p).attempts.length, fault === "commit before" ? 0 : 1); assert.equal(recover(p, project, hash("outer")).status, fault === "commit before" ? "MISSING" : "HISTORICAL_ONLY");
});
for (const conflict of [false, true]) test(`two processes ${conflict ? "conflict" : "repeat"} one stable outer key without duplicate claim`, async () => {
  const p = root(), other = JSON.parse(input()); other.ownerSessionId = randomUUID(); if (conflict) other.binding.policyDigest = hash("different");
  const a = await worker(p, input()), b = await worker(p, JSON.stringify(other)); a.start(); b.start(); const outcomes = await Promise.all([finished(a), finished(b)]);
  assert.deepEqual(outcomes.map(x => x.status).sort(), ["CREATED", conflict ? "CONFLICT" : "HISTORICAL_ONLY"].sort()); const stored = independentChain(p); assert.equal(stored.attempts.length, 1); assert.equal(stored.observations.length, 1);
});
for (const phase of ["before-commit", "after-commit", "after-claim", "after-run-intent"]) test(`killed process at ${phase} leaves only observed history and never resumes`, async () => {
  const p = root(), job = await worker(p, input(), { phase }); job.start(); assert.equal(await job.phase, phase); process.kill(job.child.pid, 0); job.child.kill("SIGKILL"); const stopped = await job.done; assert.equal(stopped.signal, "SIGKILL");
  const read = await worker(p, hash("outer"), { mode: "inspect" }); read.start(); const result = await finished(read);
  assert.equal(result.status, phase === "before-commit" ? "MISSING" : "HISTORICAL_ONLY"); if (result.history) assert.equal(result.history.recoveryState, phase === "after-run-intent" ? "ACTIVE_OR_INTERRUPTED" : "CLAIMED_NOT_ADMITTED");
  const stored = independentChain(p); assert.equal(stored.attempts.length, phase === "before-commit" ? 0 : 1); assert.equal(stored.events.length, phase === "after-run-intent" ? 2 : 0);
});
test("attempt capacity refuses without pruning or overwriting older attempts", () => {
  const p = root(); for (let i = 0; i < MAX_ATTEMPTS; i++) assert.equal(claim(p, project, input(hash("key" + i))).status, "CREATED");
  const before = rows(p); assert.equal(claim(p, project, input(hash("overflow"))).reason, "ATTEMPT_CAPACITY_EXHAUSTED"); assert.deepEqual(rows(p), before);
});
test("repeat observation capacity refuses without altering lifecycle or deleting evidence", () => {
  const p = root(); claim(p, project, input()); for (let i = 0; i < MAX_OBSERVATIONS; i++) assert.equal(claim(p, project, input()).status, "HISTORICAL_ONLY");
  assert.equal(claim(p, project, input()).reason, "OBSERVATION_CAPACITY_EXHAUSTED"); const stored = independentChain(p); assert.equal(stored.attempts.length, 1); assert.equal(stored.events.length, 0); assert.equal(stored.observations.length, MAX_OBSERVATIONS);
});
