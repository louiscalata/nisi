import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { appendFileSync, chmodSync, linkSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { STORE_FILE, MAX_RECORDS, MAX_PAYLOAD_BYTES, MAX_REQUEST_CODE_UNITS, initializeActivationReceiptStore as initialize, inspectActivationReceipt as inspect, recordActivationReceipt as record } from "../learning/activation-receipt-store.ts";

const evidence = mkdtempSync("/private/tmp/veritas-receipt-tests.");
console.log("# retained receipt-test evidence: " + evidence);
const hash = x => x.repeat(64);
const project = hash("a");
const fixture = (id = "activation-1") => ({ schemaVersion: 1, activationId: id, mode: "online", projectDigest: project, environmentDigest: hash("b"), baselineDigest: hash("c"), heldoutDigest: hash("d"), baselineHealth: "PASS", budget: { maxCandidates: 1, maxFeedback: 32 }, feedback: [{ id: "f1", sourceDigest: hash("1"), surface: "lesson", priority: 2, eligibility: "VALIDATED" }] });
const envelope = input => ({ schemaVersion: 1, sourceDigest: hash("e"), configurationDigest: hash("f"), plannerInputText: JSON.stringify(input) });
const request = (input = fixture()) => JSON.stringify(envelope(input));
function safe(result) {
  for (const name of ["authorizing", "executionAllowed", "networkAllowed", "modelCallsAllowed", "promotionAllowed", "activeBaselineChanged"]) assert.equal(result[name], false, name);
  assert.equal(result.measuredGain, null);
  assert.equal(result.evidenceStatus, "LOCAL_METADATA_ONLY");
  assert.ok(Object.isFrozen(result));
  if (result.receiptText) {
    const receipt = JSON.parse(result.receiptText);
    assert.equal(receipt.clock, "LOCAL_WALL_CLOCK_NOT_TRUSTED");
    assert.equal(receipt.plan.measuredGain, null);
    for (const name of ["authorizing", "executionAllowed", "networkAllowed", "modelCallsAllowed", "promotionAllowed", "activeBaselineChanged"]) assert.equal(receipt.plan[name], false, name);
  }
}
function root(ready = true) {
  const path = mkdtempSync(join(evidence, "case-"));
  if (ready) { const result = initialize(path, project); safe(result); assert.equal(result.status, "INITIALIZED"); }
  return path;
}
function rows(path) {
  const db = new DatabaseSync(join(path, STORE_FILE), { readOnly: true });
  try { return db.prepare("SELECT activation_id, receipt_json FROM activation_receipts ORDER BY activation_id").all().map(x => ({ ...x })); }
  finally { db.close(); }
}
function edit(path, fn) { const db = new DatabaseSync(join(path, STORE_FILE)); try { fn(db); } finally { db.close(); } }
const ownedWorkers = new Map();
afterEach(async () => {
  // Tests run serially. Even a failed assertion must stop and reap every child
  // owned by that test; completed settles only after the close event is traced.
  await Promise.all([...ownedWorkers].map(async ([child, completed]) => {
    child.kill("SIGKILL"); await completed.catch(() => {});
  }));
  assert.equal(ownedWorkers.size, 0);
});
async function worker(path, text, { phase = "none", mode = "record", startup = "normal" } = {}) {
  const child = fork(new URL("./fixtures/activation-receipt-worker.mjs", import.meta.url), [startup], { stdio: ["pipe", "pipe", "pipe", "ipc"], execArgv: [] });
  let stdout = "", stderr = "", buffer = "", readyResolve, readyReject, phaseResolve, phaseReject, completedResolve, completedReject, failure;
  let readySeen = false, phaseSeen = false;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const reachedPhase = new Promise((resolve, reject) => { phaseResolve = resolve; phaseReject = reject; });
  const completed = new Promise((resolve, reject) => { completedResolve = resolve; completedReject = reject; });
  ownedWorkers.set(child, completed);
  // Waiters may be unused (no phase requested), or reject before the caller
  // receives the controller. Mark handled without changing awaited rejection.
  for (const promise of [ready, reachedPhase, completed]) promise.catch(() => {});
  const events = [];
  const fail = error => { failure ??= error; readyReject(error); phaseReject(error); child.kill("SIGKILL"); };
  const timer = setTimeout(() => fail(new Error("owned receipt worker timeout")), 10_000);
  child.stdout.on("data", chunk => {
    if (failure) return;
    if (Buffer.byteLength(stdout) + chunk.length > 300_000) { fail(new Error("worker output bound")); return; }
    stdout += chunk; buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      try { const event = JSON.parse(line); events.push(event); if (event.event === "ready") { readySeen = true; readyResolve(); } if (event.event === "phase") { phaseSeen = true; phaseResolve(event.phase); } }
      catch (error) { fail(error); return; }
    }
  });
  child.stderr.on("data", chunk => { if (failure) return; if (Buffer.byteLength(stderr) + chunk.length > 65_536) { fail(new Error("worker stderr bound")); return; } stderr += chunk; });
  child.stdin.on("error", fail);
  child.on("error", fail);
  child.on("close", (code, signal) => {
    clearTimeout(timer);
    ownedWorkers.delete(child);
    if (!readySeen) readyReject(new Error("worker exited before ready"));
    if (!phaseSeen) phaseReject(new Error("worker exited before requested phase"));
    const trace = { phase, mode, startup, pid: child.pid, code, signal, stdout, stderr, failure: failure?.message ?? null };
    try { appendFileSync(join(evidence, "child-processes.jsonl"), JSON.stringify(trace) + "\n", { mode: 0o600 }); }
    catch (error) { completedReject(error); return; }
    if (failure) completedReject(failure); else completedResolve({ ...trace, events });
  });
  await ready;
  return { child, reachedPhase, completed,
    start: () => child.send({ root: path, projectDigest: project, requestText: text, phase, mode }, error => { if (error) fail(error); }),
    release: () => child.stdin.write("G") };
}
async function finished(job) {
  const trace = await job.completed;
  assert.equal(trace.code, 0); assert.equal(trace.signal, null); assert.equal(trace.stderr, "");
  const results = trace.events.filter(event => event.event === "result");
  assert.equal(results.length, 1);
  const result = results[0].result;
  assert.equal(result.measuredGain, null); assert.equal(result.authorizing, false); assert.equal(result.promotionAllowed, false);
  return result;
}

test("test harness rejects premature readiness and phase exits without hanging", async () => {
  const path = root();
  await assert.rejects(worker(path, request(), { startup: "exit-before-ready" }), /before ready/);
  const job = await worker(path, request(), { phase: "exit-before-phase" }); job.start();
  await assert.rejects(job.reachedPhase, /before requested phase/);
  const trace = await job.completed; assert.equal(trace.code, 13); assert.equal(trace.events.filter(x => x.event === "result").length, 0);
  assert.equal(rows(path).length, 0);
});
test("test harness refuses excessive stderr and retains a bounded diagnostic", async () => {
  await assert.rejects(worker(root(), request(), { startup: "stderr-overflow" }), /stderr bound/);
});

test("explicit initialization and exact local record/replay/inspect", () => {
  const path = root(); const first = record(path, project, request()); safe(first);
  assert.equal(first.status, "RECORDED");
  for (const api of [record, inspect]) { const again = api(path, project, request()); safe(again); assert.equal(again.receiptText, first.receiptText); }
  assert.equal(rows(path).length, 1);
  assert.equal(initialize(path, project).reason, "INITIALIZATION_REQUIRES_EMPTY_DIRECTORY");
});
test("missing storage is not implicitly initialized; inspection does not insert", () => {
  const absent = root(false); assert.equal(record(absent, project, request()).status, "ERROR"); assert.deepEqual(readdirSync(absent), []);
  const path = root(); assert.equal(inspect(path, project, request()).status, "MISSING"); assert.equal(rows(path).length, 0);
});
for (const [name, mutate] of [
  ["source", x => { x.sourceDigest = hash("2"); }],
  ["configuration", x => { x.configurationDigest = hash("2"); }],
  ...["environmentDigest", "baselineDigest", "heldoutDigest"].map(field => [field, x => { const input = JSON.parse(x.plannerInputText); input[field] = hash("2"); x.plannerInputText = JSON.stringify(input); }]),
  ["budget", x => { const input = JSON.parse(x.plannerInputText); input.budget.maxCandidates = 0; x.plannerInputText = JSON.stringify(input); }],
  ["feedback", x => { const input = JSON.parse(x.plannerInputText); input.feedback = []; x.plannerInputText = JSON.stringify(input); }]
]) test(`same activation with changed ${name} conflicts without logical mutation`, () => {
  const path = root(); record(path, project, request()); const before = rows(path);
  const next = envelope(fixture()); mutate(next);
  const result = record(path, project, JSON.stringify(next)); safe(result);
  assert.equal(result.status, "CONFLICT"); assert.equal(result.reason, "ACTIVATION_REPLAY_CONFLICT"); assert.equal(result.receiptText, null);
  assert.deepEqual(rows(path), before);
});
test("cross-project request or store binding refuses before receipt mutation", () => {
  const path = root(), input = fixture(); record(path, project, request()); const before = rows(path); input.projectDigest = hash("3");
  assert.equal(record(path, project, request(input)).reason, "PROJECT_BINDING_MISMATCH");
  assert.equal(record(path, hash("3"), request(input)).reason, "STORE_PROJECT_OR_VERSION_MISMATCH");
  assert.deepEqual(rows(path), before);
});
for (const [name, mutate, expected] of [
  ["missing baseline", x => { x.baselineDigest = null; }, "BLOCKED"],
  ["missing heldout", x => { x.heldoutDigest = null; }, "BLOCKED"],
  ["offline declaration", x => { x.mode = "offline"; }, "BLOCKED"],
  ["no feedback", x => { x.feedback = []; }, "NO_CANDIDATE"],
  ["proposal", () => {}, "CANDIDATE_PROPOSED"]
]) test(`records ${name} as metadata, never an improvement`, () => {
  const path = root(), input = fixture(); mutate(input); const result = record(path, project, request(input)); safe(result);
  assert.equal(result.status, "RECORDED"); assert.equal(JSON.parse(result.receiptText).plan.status, expected);
});
for (const [name, text] of [
  ["nontext", null], ["array", "[]"], ["broken", "{"], ["whitespace", request() + "\n"],
  ["oversize", " ".repeat(MAX_REQUEST_CODE_UNITS + 1)],
  ["unknown", JSON.stringify({ ...envelope(fixture()), instructions: "SENTINEL_RAW_TASK_DO_NOT_STORE" })],
  ["duplicate", request().replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')],
  ["invalid planner", JSON.stringify({ ...envelope(fixture()), plannerInputText: '{"private":"SENTINEL_RAW_TASK_DO_NOT_STORE"}' })]
]) test(`rejects ${name} input without storing raw rejected content`, () => {
  const path = root(); const result = record(path, project, text); safe(result);
  assert.equal(result.status, "REFUSED"); assert.equal(result.receiptText, null); assert.equal(rows(path).length, 0);
  assert.ok(!readFileSync(join(path, STORE_FILE)).includes(Buffer.from("SENTINEL_RAW_TASK_DO_NOT_STORE")));
});
for (const [name, mutate] of [
  ["JSON", () => "{"], ["unknown version", x => ({ ...x, storeVersion: "other" })],
  ["digest", x => ({ ...x, receiptDigest: hash("0") })], ["store identity", x => ({ ...x, storeId: "00000000-0000-4000-8000-000000000000" })],
  ["plan gain", x => ({ ...x, plan: { ...x.plan, measuredGain: 1 } })],
  ["clock", x => ({ ...x, createdAt: "2026-13-01T00:00:00.000Z" })],
  ["unknown field", x => ({ ...x, extra: true })]
]) test(`corrupt ${name} receipt is retained and refuses reuse`, () => {
  const path = root(); const first = record(path, project, request()); const mutated = mutate(JSON.parse(first.receiptText));
  const corrupt = typeof mutated === "string" ? mutated : JSON.stringify(mutated);
  edit(path, db => db.prepare("UPDATE activation_receipts SET receipt_json=?").run(corrupt)); const before = rows(path);
  const result = record(path, project, request()); safe(result); assert.equal(result.status, "REFUSED"); assert.equal(result.receiptText, null); assert.deepEqual(rows(path), before);
});
for (const [name, mutate] of [
  ["malformed", () => "{"], ["unknown version", x => JSON.stringify({ ...x, schemaVersion: 2 })],
  ["invalid identity", x => JSON.stringify({ ...x, storeId: "invalid" })],
  ["duplicate key", x => JSON.stringify(x).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')]
]) test(`corrupt ${name} metadata is retained without a favorable receipt`, () => {
  const path = root(); record(path, project, request()); const before = rows(path);
  let corrupt;
  edit(path, db => { corrupt = mutate(JSON.parse(db.prepare("SELECT metadata FROM owner_metadata").get().metadata)); db.prepare("UPDATE owner_metadata SET metadata=?").run(corrupt); });
  const result = record(path, project, request()); safe(result); assert.equal(result.status, "REFUSED"); assert.equal(result.receiptText, null); assert.deepEqual(rows(path), before);
  edit(path, db => assert.equal(db.prepare("SELECT metadata FROM owner_metadata").get().metadata, corrupt));
});
test("receipt activation row identity must match its canonical request", () => {
  const path = root(); record(path, project, request()); edit(path, db => db.exec("UPDATE activation_receipts SET activation_id='wrong-id'"));
  const before = rows(path); const result = inspect(path, project, request()); safe(result);
  assert.equal(result.reason, "RECEIPT_BINDING_INVALID"); assert.equal(result.receiptText, null); assert.deepEqual(rows(path), before);
});
test("extra schema/trigger refuses before insert", () => {
  const path = root(); edit(path, db => db.exec("CREATE TABLE extra(x TEXT); CREATE TRIGGER extra_write AFTER INSERT ON activation_receipts BEGIN INSERT INTO extra VALUES ('bad'); END"));
  assert.equal(record(path, project, request()).reason, "STORE_SCHEMA_INVALID"); assert.equal(rows(path).length, 0);
});
test("truncated database remains unchanged and unconfirmed", () => {
  const path = root(); truncateSync(join(path, STORE_FILE), 100);
  const before = readFileSync(join(path, STORE_FILE)); const result = record(path, project, request());
  assert.equal(result.status, "REFUSED"); assert.equal(result.receiptText, null); assert.deepEqual(readFileSync(join(path, STORE_FILE)), before);
});
test("private paths, modes, symlinks and hardlinks are checked before use", () => {
  const path = root(); chmodSync(path, 0o755); assert.equal(record(path, project, request()).reason, "STORE_DIRECTORY_NOT_PRIVATE"); chmodSync(path, 0o700);
  chmodSync(join(path, STORE_FILE), 0o644); assert.equal(record(path, project, request()).reason, "STORE_FILE_NOT_PRIVATE_REGULAR"); chmodSync(join(path, STORE_FILE), 0o600);
  const alias = join(evidence, "root-alias"); symlinkSync(path, alias); assert.equal(record(alias, project, request()).reason, "STORE_PATH_NOT_CANONICAL");
  const linked = root(false); symlinkSync(join(path, STORE_FILE), join(linked, STORE_FILE)); assert.equal(record(linked, project, request()).reason, "STORE_FILE_NOT_PRIVATE_REGULAR");
  linkSync(join(path, STORE_FILE), join(evidence, "hardlink.sqlite3")); assert.equal(record(path, project, request()).reason, "STORE_FILE_NOT_PRIVATE_REGULAR");
});
test("initialize refuses nonempty directories without modifying their files", () => {
  const path = root(false); writeFileSync(join(path, "retained.txt"), "retain", { mode: 0o600 });
  assert.equal(initialize(path, project).status, "REFUSED"); assert.deepEqual(readdirSync(path), ["retained.txt"]); assert.equal(readFileSync(join(path, "retained.txt"), "utf8"), "retain");
});
test("fresh processes record and replay identical persisted bytes", async () => {
  const path = root(); const a = await worker(path, request()); a.start(); const first = await finished(a);
  const b = await worker(path, request()); b.start(); const second = await finished(b);
  assert.equal(first.status, "RECORDED"); assert.equal(second.status, "REPLAYED"); assert.equal(second.receiptText, first.receiptText); assert.equal(rows(path).length, 1);
});
for (const conflict of [false, true]) test(`two live writers ${conflict ? "conflict" : "replay"} with one committed row`, async () => {
  const path = root(), changed = envelope(fixture()); changed.configurationDigest = hash("4");
  const [a, b] = await Promise.all([worker(path, request(), { phase: "before-commit" }), worker(path, conflict ? JSON.stringify(changed) : request())]);
  a.start(); assert.equal(await a.reachedPhase, "before-commit"); b.start(); a.release();
  const [first, second] = await Promise.all([finished(a), finished(b)]);
  assert.equal(first.status, "RECORDED"); assert.equal(second.status, conflict ? "CONFLICT" : "REPLAYED");
  if (!conflict) assert.equal(first.receiptText, second.receiptText); assert.equal(rows(path).length, 1);
});
for (const phase of ["before-begin", "after-begin", "before-commit", "after-commit"]) test(`SIGKILL at ${phase} preserves exact commit boundary`, async () => {
  const path = root(); const job = await worker(path, request(), { phase }); job.start(); assert.equal(await job.reachedPhase, phase);
  assert.equal(job.child.kill("SIGKILL"), true); const trace = await job.completed; assert.equal(trace.signal, "SIGKILL"); assert.equal(trace.code, null); assert.equal(trace.events.filter(x => x.event === "result").length, 0);
  const probe = await worker(path, request(), { mode: "inspect" }); probe.start(); const found = await finished(probe);
  assert.equal(found.status, phase === "after-commit" ? "FOUND" : "MISSING");
  assert.equal(rows(path).length, phase === "after-commit" ? 1 : 0);
  const retried = record(path, project, request()); assert.equal(retried.status, phase === "after-commit" ? "REPLAYED" : "RECORDED"); assert.equal(rows(path).length, 1);
});
test("ambiguous API error after actual COMMIT is not reported as stored or retried", async () => {
  const path = root(); const job = await worker(path, request(), { phase: "throw-after-commit" }); job.start(); const result = await finished(job);
  assert.equal(result.status, "INCONCLUSIVE"); assert.equal(result.reason, "PUBLICATION_OUTCOME_UNCONFIRMED"); assert.equal(result.receiptText, null);
  assert.equal(rows(path).length, 1); assert.equal(inspect(path, project, request()).status, "FOUND");
});
test("real SQLite denial rolls back and emits no receipt", async () => {
  const path = root(); const job = await worker(path, request(), { phase: "deny-insert" }); job.start(); const result = await finished(job);
  assert.equal(result.status, "ERROR"); assert.equal(result.receiptText, null); assert.equal(rows(path).length, 0);
});
test("rollback uncertainty cannot leak a previously selected replay receipt", async () => {
  const path = root(); record(path, project, request()); const before = rows(path);
  const job = await worker(path, request(), { phase: "throw-after-rollback" }); job.start(); const result = await finished(job);
  assert.equal(result.status, "INCONCLUSIVE"); assert.equal(result.receiptText, null); assert.deepEqual(rows(path), before);
});
test("close uncertainty cannot leak a previously selected replay receipt", async () => {
  const path = root(); record(path, project, request()); const before = rows(path);
  const job = await worker(path, request(), { phase: "throw-after-close" }); job.start(); const result = await finished(job);
  assert.equal(result.status, "INCONCLUSIVE"); assert.equal(result.reason, "CLOSE_UNCONFIRMED"); assert.equal(result.receiptText, null); assert.deepEqual(rows(path), before);
});
test("real competing write lock is bounded and cannot produce a receipt", async () => {
  const path = root(), holder = new DatabaseSync(join(path, STORE_FILE)); holder.exec("BEGIN IMMEDIATE");
  try { const job = await worker(path, request()); job.start(); const result = await finished(job); assert.equal(result.status, "ERROR"); assert.equal(result.receiptText, null); }
  finally { holder.exec("ROLLBACK"); holder.close(); }
  assert.equal(rows(path).length, 0); assert.equal(record(path, project, request()).status, "RECORDED");
});
test("record-count capacity refuses the next row and still permits exact replay", () => {
  const path = root();
  for (let i = 0; i < MAX_RECORDS; i++) assert.equal(record(path, project, request(fixture("small-" + i))).status, "RECORDED");
  const before = rows(path); const result = record(path, project, request(fixture("one-too-many")));
  assert.equal(result.reason, "STORE_CAPACITY_EXHAUSTED"); assert.equal(rows(path).length, MAX_RECORDS); assert.deepEqual(rows(path), before);
  assert.equal(record(path, project, request(fixture("small-0"))).status, "REPLAYED");
});
test("reachable maximum-shaped input obeys aggregate capacity and remains readable", () => {
  const path = root(); let last, accepted = 0;
  const large = i => { const input = fixture(("large-" + String(i).padStart(4, "0")).padEnd(64, "x")); input.feedback = Array.from({ length: 32 }, (_, k) => ({ id: ("feedback-" + k).padEnd(64, "x"), sourceDigest: createHash("sha256").update(String(k)).digest("hex"), surface: "workflow", priority: 3, eligibility: "VALIDATED" })); return request(input); };
  for (let i = 0; i < MAX_RECORDS + 1; i++) { const result = record(path, project, large(i)); if (result.status !== "RECORDED") { last = result; break; } accepted++; }
  assert.ok(accepted > 0); assert.ok(last); assert.ok(["STORE_PAYLOAD_EXHAUSTED", "STORE_CAPACITY_EXHAUSTED"].includes(last.reason));
  const all = rows(path); assert.equal(all.length, accepted); assert.ok(all.reduce((n, row) => n + Buffer.byteLength(row.receipt_json), 0) <= MAX_PAYLOAD_BYTES);
  assert.equal(inspect(path, project, large(0)).status, "FOUND"); assert.equal(record(path, project, large(0)).status, "REPLAYED");
  assert.deepEqual(rows(path), all);
});
