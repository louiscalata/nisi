import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { fork } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import * as standard from "../learning/journaled-activation-owner.ts";
import { initializeActivationJournal, JOURNAL_FILE } from "../learning/activation-journal.ts";
import { initializeActivationReceiptStore, STORE_FILE } from "../learning/activation-receipt-store.ts";

const evidence = mkdtempSync("/private/tmp/veritas-journal-owner-tests.");
console.log("# retained journaled-owner-test evidence: " + evidence);
const hash = x => createHash("sha256").update(x).digest("hex"), project = hash("project"), key = hash("outer");
const template = overrides => JSON.stringify({ schemaVersion: 1, mode: "online", environmentDigest: hash("environment"), baselineDigest: hash("baseline"), heldoutDigest: hash("heldout"), baselineHealth: "PASS", budget: { maxCandidates: 1, maxFeedback: 32 }, feedback: [], ...overrides });
const owners = new Set(), children = new Map();
const trace = (name, value) => { appendFileSync(join(evidence, "observations.jsonl"), JSON.stringify({ name, value }) + "\n", { mode: 0o600 }); return value; };
function safe(result, local = true) { for (const flag of ["authorizing", "executionAllowed", "networkAllowed", "modelCallsAllowed", "promotionAllowed", "activeBaselineChanged"]) assert.equal(result[flag], false, flag); assert.equal(result.measuredGain, null); if (local) assert.ok(Object.isFrozen(result)); }
function sql(directory, file, action) { const db = new DatabaseSync(join(directory, file)); try { return action(db); } finally { db.close(); } }
// SQL assertions deliberately do not call the production recovery classifier.
const events = journal => sql(journal, JOURNAL_FILE, db => db.prepare("SELECT outer_key,seq,json FROM events ORDER BY outer_key,seq").all().map(row => ({ ...row, event: JSON.parse(row.json).event })));
const attempts = journal => sql(journal, JOURNAL_FILE, db => db.prepare("SELECT json FROM attempts ORDER BY outer_key").all().map(x => JSON.parse(x.json)));
const receipts = store => sql(store, STORE_FILE, db => db.prepare("SELECT receipt_json FROM activation_receipts").all().map(x => JSON.parse(x.receipt_json)));
const dead = pid => assert.throws(() => process.kill(pid, 0), error => error.code === "ESRCH");
afterEach(async () => {
  await Promise.all([...owners].map(async owner => { await owner.close(); assert.equal(owner.inspect().activePid, null); trace("closed", owner.inspect()); })); owners.clear();
  await Promise.all([...children].map(async ([child, done]) => { child.kill("SIGKILL"); await done.catch(() => {}); })); assert.equal(children.size, 0);
});
const committedGate = text => text.replace('  const envelope =', '  await import("node:fs").then(fs => fs.writeFileSync(task.config.runtimeDirectory + "/../committed.marker", "committed"));\n  await new Promise(() => setInterval(() => {}, 1000));\n  const envelope =');
async function setup({ gate = false, isolated = false, deadlineMs = 5000, initializeJournal = true } = {}) {
  const root = mkdtempSync(join(evidence, "case-")), store = join(root, "store"), journal = join(root, "journal"), directory = join(root, "owner");
  for (const path of [store, journal, directory]) mkdirSync(path, { mode: 0o700 });
  assert.equal(initializeActivationReceiptStore(store, project).status, "INITIALIZED"); if (initializeJournal) assert.equal(initializeActivationJournal(journal, project).status, "INITIALIZED");
  let module = standard, source = null;
  if (gate || isolated) {
    source = join(root, "synthetic-source"); mkdirSync(source, { mode: 0o700 });
    for (const name of ["activation-improvement.ts", "activation-receipt-store.ts", "activation-owner.ts", "activation-owner-worker.mjs", "activation-journal.ts", "journaled-activation-owner.ts"]) copyFileSync(new URL("../learning/" + name, import.meta.url), join(source, name));
    if (gate) { const path = join(source, "activation-owner-worker.mjs"), before = readFileSync(path, "utf8"), after = committedGate(before); assert.notEqual(before, after); writeFileSync(path, after, { mode: 0o600 }); }
    module = await import(pathToFileURL(join(source, "journaled-activation-owner.ts")));
  }
  const options = { schemaVersion: 1, projectDigest: project, storeDirectory: store, ownerDirectory: directory, journalDirectory: journal, expectedAdapterDigest: module.measureJournaledActivationRuntime().digest, deadlineMs };
  if (!initializeJournal) return { root, store, journal, directory, module, options };
  const owner = module.createJournaledActivationOwner(JSON.stringify(options)); owners.add(owner); trace("setup", { root, options, gate, source });
  return { root, store, journal, directory, source, module, options, owner };
}
async function admitted(owner, outerKey = key, text = template()) { const out = await owner.begin(outerKey, text); safe(out); assert.equal(out.status, "ADMITTED"); return out.ticket; }
async function prepared(owner, token) { const out = await owner.run(token); safe(out); assert.equal(out.status, "PREPARED"); assert.equal(out.receiptText, null); return out.ticket; }
async function waitMarker(owner, directory) {
  const deadline = performance.now() + 3000;
  while (!existsSync(join(directory, "committed.marker"))) { assert.ok(performance.now() < deadline, "child did not reach actual post-COMMIT gate"); assert.ok(owner.inspect().activePid); await delay(10); }
  const pid = owner.inspect().activePid; assert.ok(pid); process.kill(pid, 0); return pid;
}
function restart(setup) { const directory = join(setup.root, "owner-" + randomUUID()); mkdirSync(directory, { mode: 0o700 }); const owner = setup.module.createJournaledActivationOwner(JSON.stringify({ ...setup.options, ownerDirectory: directory })); owners.add(owner); return owner; }
async function processOwner(setup, { phase = "none", outerKey = key, text = template() } = {}) {
  const directory = join(setup.root, "process-" + randomUUID()); mkdirSync(directory, { mode: 0o700 });
  const child = fork(new URL("./fixtures/activation-journal-worker.mjs", import.meta.url), [], { stdio: ["pipe", "pipe", "pipe", "ipc"], execArgv: ["--disable-warning=ExperimentalWarning"] });
  let stdout = "", stderr = "", buffer = "", failure, seenReady = false, seenPhase = false, readyResolve, readyReject, phaseResolve, phaseReject, doneResolve, doneReject;
  const ready = new Promise((a, b) => { readyResolve = a; readyReject = b; }), reached = new Promise((a, b) => { phaseResolve = a; phaseReject = b; }), done = new Promise((a, b) => { doneResolve = a; doneReject = b; });
  for (const promise of [ready, reached, done]) promise.catch(() => {}); children.set(child, done);
  const all = [], fail = e => { failure ??= e; readyReject(e); phaseReject(e); child.kill("SIGKILL"); };
  const timer = setTimeout(() => fail(new Error("owner subprocess timeout")), 12000);
  child.stdout.on("data", bytes => { if (failure) return; if (Buffer.byteLength(stdout) + bytes.length > 100000) return fail(new Error("stdout bound")); stdout += bytes; buffer += bytes;
    while (buffer.includes("\n")) { const i = buffer.indexOf("\n"), line = buffer.slice(0, i); buffer = buffer.slice(i + 1); try { const value = JSON.parse(line); all.push(value); if (value.event === "ready") { seenReady = true; readyResolve(); } if (value.event === "phase") { seenPhase = true; phaseResolve(value); } } catch (e) { fail(e); } }
  });
  child.stderr.on("data", bytes => { if (failure) return; if (Buffer.byteLength(stderr) + bytes.length > 65536) return fail(new Error("stderr bound")); stderr += bytes; }); child.on("error", fail); child.stdin.on("error", fail);
  child.on("close", (code, signal) => { clearTimeout(timer); children.delete(child); if (!seenReady) readyReject(new Error("closed before ready")); if (!seenPhase) phaseReject(new Error("closed before phase"));
    try { const value = trace("owner-child", { pid: child.pid, phase, code, signal, stdout, stderr, error: failure?.message ?? null }); if (failure) doneReject(failure); else doneResolve({ ...value, events: all }); } catch (e) { doneReject(e); }
  });
  await ready;
  return { child, reached, done, start: () => child.send({ mode: "owner", phase, outerKey, text, options: { ...setup.options, ownerDirectory: directory } }, e => { if (e) fail(e); }) };
}
async function completed(job) { const out = await job.done; assert.equal(out.code, 0); assert.equal(out.signal, null); assert.equal(out.stderr, ""); const results = out.events.filter(x => x.event === "result"); assert.equal(results.length, 1); safe(results[0].result, false); return results[0]; }

test("construction starts OFF; known-key refusal is retained without spawning", async () => {
  const { owner, journal, store } = await setup(); const out = await owner.begin(key, template()); safe(out); assert.equal(out.status, "REFUSED"); assert.equal(out.journalStatus, "RECORDED"); assert.equal(owner.inspect().spawnCount, 0); assert.equal(receipts(store).length, 0); assert.deepEqual(events(journal).map(x => x.event.type), ["REJECTED"]);
  await owner.enable(); const repeat = await owner.begin(key, template()); assert.equal(repeat.status, "HISTORICAL_ONLY"); assert.equal(repeat.ticket, null); assert.equal(owner.inspect().spawnCount, 0);
});
test("actual local result requires return intent then a separate one-use acknowledgment", async () => {
  const { owner, journal, store } = await setup(); await owner.enable(); const h = await admitted(owner), ticket = await prepared(owner, h), out = trace("return", await owner.takeResult(ticket)); safe(out); assert.equal(out.status, "RETURNED_LOCAL_METADATA");
  assert.equal(out.history.callerAcknowledged, false); assert.equal(out.history.recoveryState, "RETURN_ATTEMPTED_ACK_UNKNOWN"); assert.deepEqual(events(journal).map(x => x.event.type), ["ADMITTED", "RUN_INTENT", "PREPARED", "RETURN_INTENT"]);
  assert.equal(events(journal).at(-1).event.receiptDigest, JSON.parse(out.receiptText).receiptDigest); assert.equal(receipts(store).length, 1);
  for (const forged of [null, h, ticket, { ...out.acknowledgment }]) assert.equal((await owner.acknowledge(forged)).status, "REFUSED");
  const ack = await owner.acknowledge(out.acknowledgment); safe(ack); assert.equal(ack.status, "CALLER_ACKNOWLEDGED"); assert.equal((await owner.acknowledge(out.acknowledgment)).status, "REFUSED"); assert.equal(events(journal).filter(x => x.event.type === "CALLER_ACKNOWLEDGED").length, 1);
});
test("current same-handle calls share one promise and same-key repeat never issues a handle", async () => {
  const { owner, journal, store } = await setup(); await owner.enable(); const h = await admitted(owner), a = owner.run(h), b = owner.run(h); assert.equal(a, b);
  const repeat = await owner.begin(key, template()); assert.equal(repeat.status, "HISTORICAL_ONLY"); assert.equal(repeat.ticket, null); await a; assert.equal(owner.inspect().spawnCount, 1); assert.equal(receipts(store).length, 1); assert.equal(attempts(journal).length, 1);
});
for (const action of ["off", "cancel", "returned", "acknowledged"]) test(`cached PREPARED cannot reappear after ${action}`, async () => {
  const { owner, store } = await setup(); await owner.enable(); const h = await admitted(owner), ticket = await prepared(owner, h);
  if (action === "off") { await owner.off(); await owner.enable(); }
  if (action === "cancel") await owner.cancel(h);
  if (action === "returned" || action === "acknowledged") { const delivered = await owner.takeResult(ticket); assert.equal(delivered.status, "RETURNED_LOCAL_METADATA"); if (action === "acknowledged") await owner.acknowledge(delivered.acknowledgment); }
  const again = trace("cached-" + action, await owner.run(h)); assert.equal(again.status, "REFUSED"); assert.equal(again.reason, "INVOCATION_NOT_CURRENT"); assert.equal(again.journalStatus, "RECORDED"); assert.equal(again.ticket, null); assert.equal(again.receiptText, null); assert.equal((await owner.takeResult(ticket)).status, "REFUSED"); assert.equal(receipts(store).length, 1); assert.equal(owner.inspect().spawnCount, 1);
});
for (const text of [null, "PRIVATE_RAW_SENTINEL{", "PRIVATE_RAW_SENTINEL".repeat(2000), template().replace('"schemaVersion":1', '"raw":"PRIVATE_RAW_SENTINEL","schemaVersion":1')]) test(`malformed template class ${typeof text === "string" ? text.length : "null"} is retained without raw bytes`, async () => {
  const { owner, journal, store } = await setup(); await owner.enable(); const out = await owner.begin(key, text); assert.equal(out.status, "REFUSED"); assert.equal(out.journalStatus, "RECORDED"); assert.equal(attempts(journal)[0].binding.templateKind, "INVALID_UNIDENTIFIED"); assert.equal(attempts(journal)[0].binding.templateDigest, null);
  for (const file of readdirSync(journal)) assert.equal(readFileSync(join(journal, file)).includes(Buffer.from("PRIVATE_RAW_SENTINEL")), false);
  assert.equal(receipts(store).length, 0); assert.equal(owner.inspect().spawnCount, 0);
});
test("different invalid raw templates share an explicitly unidentified rejection class", async () => { const { owner } = await setup(); await owner.enable(); await owner.begin(key, "RAW_ONE{"); const out = await owner.begin(key, "RAW_TWO{"); assert.equal(out.status, "HISTORICAL_ONLY"); assert.equal(out.reason, "HISTORICAL_REJECTION_CLASS_NOT_RAW_INPUT_IDENTITY"); assert.equal(out.ticket, null); });
test("invalid outer keys are explicitly unjournaled with no fabricated identity", async () => { const { owner, journal } = await setup(); await owner.enable(); for (const k of [null, "raw task", "A".repeat(64), ""]) { const out = await owner.begin(k, template()); assert.equal(out.status, "REJECTED_UNJOURNALED"); assert.equal(out.journalStatus, "NOT_RECORDED"); } assert.equal(attempts(journal).length, 0); });
test("new owner can inspect/repeat only, not reconstruct handles or rerun a prepared attempt", async () => {
  const s = await setup(); await s.owner.enable(); const h = await admitted(s.owner); await prepared(s.owner, h); const second = restart(s); await second.enable();
  const out = await second.begin(key, template()); assert.equal(out.status, "HISTORICAL_ONLY"); assert.equal(out.history.recoveryState, "PREPARED_HISTORICAL_ONLY"); assert.equal(out.ticket, null); assert.equal((await second.run({ ...h })).status, "REFUSED"); assert.equal(second.inspect().spawnCount, 0); assert.equal(receipts(s.store).length, 1);
});
for (const change of ["template", "policy", "source"]) test(`same outer key with changed ${change} conflicts without another spawn`, async () => {
  const s = await setup({ isolated: change === "source" }); await s.owner.enable(); await admitted(s.owner); let second;
  if (change === "policy") s.options.deadlineMs += 1;
  if (change === "source") { appendFileSync(join(s.source, "activation-journal.ts"), "\n// changed source identity\n"); s.options.expectedAdapterDigest = s.module.measureJournaledActivationRuntime().digest; }
  second = restart(s); await second.enable(); const out = await second.begin(key, change === "template" ? template({ baselineHealth: "FAIL" }) : template()); assert.equal(out.status, "CONFLICT"); assert.equal(out.ticket, null); assert.equal(second.inspect().spawnCount, 0);
});
test("no journal initialization or source approval is fabricated by constructor", async () => {
  const s = await setup({ initializeJournal: false }); assert.throws(() => s.module.createJournaledActivationOwner(JSON.stringify(s.options)), /JOURNAL_NOT_AVAILABLE/); assert.deepEqual(readdirSync(s.journal), []); assert.deepEqual(readdirSync(s.directory), []);
  assert.throws(() => s.module.createJournaledActivationOwner(JSON.stringify({ ...s.options, expectedAdapterDigest: hash("wrong") })), /EXPECTED_ADAPTER_SOURCE_MISMATCH/);
});
test("failed RUN_INTENT append prevents spawning and requires explicit recovery", async () => {
  const { owner, journal, store } = await setup(); await owner.enable(); const h = await admitted(owner), db = new DatabaseSync(join(journal, JOURNAL_FILE)); db.exec("BEGIN IMMEDIATE");
  try { const out = await owner.run(h); assert.equal(out.status, "INCONCLUSIVE"); assert.equal(out.ticket, null); assert.equal(owner.inspect().spawnCount, 0); } finally { db.exec("ROLLBACK"); db.close(); }
  assert.equal(receipts(store).length, 0); assert.deepEqual(events(journal).map(x => x.event.type), ["ADMITTED"]); assert.equal((await owner.enable()).status, "INCONCLUSIVE");
});
for (const phase of ["PREPARED", "RETURN_INTENT"]) test(`uncertain ${phase} append suppresses receipt and never retries automatically`, async () => {
  const { owner, journal, store } = await setup(); await owner.enable(); const h = await admitted(owner); let ticket;
  if (phase === "RETURN_INTENT") ticket = await prepared(owner, h);
  const original = DatabaseSync.prototype.exec; let hits = 0;
  DatabaseSync.prototype.exec = function(sql) { const value = original.call(this, sql); if (sql === "COMMIT") { const last = this.prepare("SELECT json FROM events ORDER BY seq DESC LIMIT 1").get(); if (last && JSON.parse(last.json).event.type === phase) { hits++; throw new Error("injected post-commit ambiguity"); } } return value; };
  let out; try { out = phase === "PREPARED" ? await owner.run(h) : await owner.takeResult(ticket); } finally { DatabaseSync.prototype.exec = original; }
  trace("uncertain-" + phase, out); assert.equal(hits, 1); assert.equal(out.status, "INCONCLUSIVE"); assert.equal(out.ticket, null); assert.equal(out.receiptText, null); assert.equal(receipts(store).length, 1); assert.equal(events(journal).at(-1).event.type, phase); assert.equal(owner.inspect().activePid, null);
});
for (const action of ["off", "cancel", "close"]) test(`${action} invalidates before journaling and joins a real committed child`, async () => {
  const { owner, journal, directory, store } = await setup({ gate: true }); await owner.enable(); const h = await admitted(owner), work = owner.run(h), pid = await waitMarker(owner, directory);
  const stopping = action === "cancel" ? owner.cancel(h) : owner[action](); const out = await work; await stopping; safe(out); assert.equal(out.receiptText, null); assert.equal(out.ticket, null); assert.equal(owner.inspect().activePid, null); dead(pid); assert.equal(receipts(store).length, 1); assert.equal(events(journal).at(-1).event.type, "REVOCATION_OBSERVED");
});
test("source failure during concurrent enable/begin waits for one live-child shutdown", async () => {
  const { owner, source, directory } = await setup({ gate: true }); await owner.enable(); const h = await admitted(owner), work = owner.run(h), pid = await waitMarker(owner, directory);
  appendFileSync(join(source, "activation-journal.ts"), "\n// observed source failure\n");
  const assertStopped = async promise => { const out = await promise; assert.equal(out.status, "INCONCLUSIVE"); assert.equal(owner.inspect().activePid, null); dead(pid); return out; };
  await Promise.all([assertStopped(owner.enable()), assertStopped(owner.begin(hash("second"), template()))]); const out = await work; assert.equal(out.status, "INCONCLUSIVE"); assert.equal(out.receiptText, null);
});
test("OFF closes admission immediately even when revocation journaling subsequently fails", async () => {
  const { owner, journal, directory, store } = await setup({ gate: true }); await owner.enable(); const h = await admitted(owner), work = owner.run(h), pid = await waitMarker(owner, directory);
  const db = new DatabaseSync(join(journal, JOURNAL_FILE)); db.exec("BEGIN IMMEDIATE");
  try { const stopping = owner.off(); assert.notEqual(owner.inspect().mode, "ON"); const enabling = await owner.enable(); assert.notEqual(enabling.status, "ENABLED"); const out = await stopping; assert.equal(out.status, "INCONCLUSIVE"); assert.equal(owner.inspect().activePid, null); dead(pid); assert.equal((await work).receiptText, null); }
  finally { db.exec("ROLLBACK"); db.close(); }
  assert.equal(receipts(store).length, 1); assert.equal(events(journal).at(-1).event.type, "RUN_INTENT");
});
test("second invocation can run while first awaits acknowledgment; OFF revokes both", async () => {
  const { owner } = await setup(); await owner.enable(); const a = await admitted(owner), aTicket = await prepared(owner, a), first = await owner.takeResult(aTicket), b = await admitted(owner, hash("second")); await prepared(owner, b); await owner.off();
  assert.equal((await owner.acknowledge(first.acknowledgment)).status, "REFUSED"); for (const h of [a, b]) { const result = await owner.run(h); assert.equal(result.status, "REFUSED"); assert.equal(result.reason, "INVOCATION_NOT_CURRENT"); } assert.equal(owner.inspect().spawnCount, 2);
});
test("completed run never reissues its prepared ticket even while delivery remains current", async () => {
  const { owner } = await setup(); await owner.enable(); const h = await admitted(owner), ticket = await prepared(owner, h);
  const repeated = await owner.run(h); assert.equal(repeated.status, "REFUSED"); assert.equal(repeated.reason, "PREPARED_TICKET_ALREADY_ISSUED"); assert.equal(repeated.ticket, null); assert.equal((await owner.takeResult(ticket)).status, "RETURNED_LOCAL_METADATA");
});
test("deadline between preparation and delivery records revocation without handing out the receipt", async () => {
  const { owner, journal, store } = await setup({ deadlineMs: 500 }); await owner.enable(); const h = await admitted(owner), ticket = await prepared(owner, h); await delay(520);
  const out = await owner.takeResult(ticket); assert.equal(out.status, "TIMED_OUT"); assert.equal(out.receiptText, null); assert.equal(out.ticket, null); assert.equal(events(journal).at(-1).event.outcome, "TIMED_OUT"); assert.equal(receipts(store).length, 1);
});
test("source change after preparation invalidates cached run and pending delivery", async () => {
  const { owner, source } = await setup({ isolated: true }); await owner.enable(); const h = await admitted(owner), ticket = await prepared(owner, h); appendFileSync(join(source, "activation-journal.ts"), "\n// changed after prepare\n");
  const out = await owner.run(h); assert.equal(out.status, "INCONCLUSIVE"); assert.equal(out.receiptText, null); assert.equal(out.ticket, null); assert.equal((await owner.takeResult(ticket)).status, "REFUSED"); assert.equal(owner.inspect().spawnCount, 1);
});
test("busy distinct invocation is recorded without queueing", async () => {
  const { owner, directory, journal } = await setup({ gate: true }); await owner.enable(); const a = await admitted(owner), b = await admitted(owner, hash("second")), work = owner.run(a); await waitMarker(owner, directory);
  const out = await owner.run(b); assert.equal(out.status, "BUSY"); assert.equal(owner.inspect().spawnCount, 1); assert.ok(events(journal).some(x => x.event.type === "UNCONFIRMED" && x.event.outcome === "BUSY")); await owner.cancel(a); await work;
});
for (const changed of [false, true]) test(`two actual owner processes ${changed ? "conflict" : "repeat"} same key with one worker`, async () => {
  const s = await setup(), a = await processOwner(s), b = await processOwner(s, { text: changed ? template({ baselineHealth: "FAIL" }) : template() }); a.start(); b.start(); const all = await Promise.all([completed(a), completed(b)]);
  assert.deepEqual(all.map(x => x.result.status).sort(), ["CALLER_ACKNOWLEDGED", changed ? "CONFLICT" : "HISTORICAL_ONLY"].sort()); assert.equal(all.reduce((n, x) => n + x.spawnCount, 0), 1); assert.equal(receipts(s.store).length, 1); assert.equal(events(s.journal).filter(x => x.event.type === "RUN_INTENT").length, 1);
});
for (const phase of ["after-owner-claim", "after-owner-run-intent", "after-prepare", "after-return", "after-acknowledged"]) test(`owner killed ${phase} cannot be resumed by another process`, async () => {
  const s = await setup(), first = await processOwner(s, { phase }); first.start(); const reached = await first.reached; assert.equal(reached.phase, phase); assert.equal(reached.activePid, null); first.child.kill("SIGKILL"); assert.equal((await first.done).signal, "SIGKILL");
  const second = await processOwner(s); second.start(); const out = await completed(second); assert.equal(out.result.status, "HISTORICAL_ONLY"); assert.equal(out.spawnCount, 0); assert.equal(out.result.ticket, null); assert.equal(out.result.receiptText, null); assert.equal(out.result.history.callerAcknowledged, phase === "after-acknowledged");
  const expected = { "after-owner-claim": ["CLAIMED_NOT_ADMITTED", 0, []], "after-owner-run-intent": ["ACTIVE_OR_INTERRUPTED", 0, ["ADMITTED", "RUN_INTENT"]], "after-prepare": ["PREPARED_HISTORICAL_ONLY", 1, ["ADMITTED", "RUN_INTENT", "PREPARED"]], "after-return": ["RETURN_ATTEMPTED_ACK_UNKNOWN", 1, ["ADMITTED", "RUN_INTENT", "PREPARED", "RETURN_INTENT"]], "after-acknowledged": ["CALLER_ACKNOWLEDGED", 1, ["ADMITTED", "RUN_INTENT", "PREPARED", "RETURN_INTENT", "CALLER_ACKNOWLEDGED"]] }[phase];
  assert.equal(out.result.history.recoveryState, expected[0]); assert.equal(receipts(s.store).length, expected[1]); assert.deepEqual(events(s.journal).map(x => x.event.type), expected[2]);
});
for (const phase of ["after-owner-claim", "after-owner-run-intent", "after-return"]) for (const reverse of [false, true]) test(`concurrent observer at ${phase}, reverse order ${reverse}, cannot start duplicate work`, async () => {
  const s = await setup(), definitions = [{ phase }, {}]; if (reverse) definitions.reverse(); const jobs = await Promise.all(definitions.map(d => processOwner(s, d))), active = jobs[reverse ? 1 : 0], observer = jobs[reverse ? 0 : 1];
  active.start(); assert.equal((await active.reached).activePid, null); observer.start(); const observed = await completed(observer); assert.equal(observed.result.status, "HISTORICAL_ONLY"); assert.equal(observed.spawnCount, 0); assert.equal(observed.result.ticket, null);
  active.child.stdin.write("G"); const finished = await completed(active); assert.equal(finished.result.status, "CALLER_ACKNOWLEDGED"); assert.equal(finished.spawnCount, 1); assert.equal(events(s.journal).filter(x => x.event.type === "RUN_INTENT").length, 1); assert.equal(receipts(s.store).length, 1);
});
