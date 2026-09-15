import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import * as standard from "../learning/activation-owner.ts";
import { STORE_FILE, initializeActivationReceiptStore, inspectActivationReceipt } from "../learning/activation-receipt-store.ts";

const evidence = mkdtempSync("/private/tmp/veritas-owner-tests.");
console.log("# retained owner-test evidence: " + evidence);
const project = "a".repeat(64), hash = x => createHash("sha256").update(x).digest("hex");
const template = overrides => JSON.stringify({ schemaVersion: 1, mode: "online", environmentDigest: "b".repeat(64), baselineDigest: "c".repeat(64), heldoutDigest: "d".repeat(64), baselineHealth: "PASS", budget: { maxCandidates: 1, maxFeedback: 32 }, feedback: [{ id: "f1", sourceDigest: "e".repeat(64), surface: "lesson", priority: 1, eligibility: "VALIDATED" }], ...overrides });
const owners = new Set();
const trace = (name, value) => { appendFileSync(join(evidence, "observations.jsonl"), JSON.stringify({ name, value }) + "\n", { mode: 0o600 }); return value; };
const safe = value => {
  for (const flag of ["authorizing", "executionAllowed", "networkAllowed", "modelCallsAllowed", "promotionAllowed", "activeBaselineChanged"]) assert.equal(value[flag], false, flag);
  assert.equal(value.measuredGain, null); assert.equal(value.rejectedAttemptLedger, "NOT_IMPLEMENTED"); assert.ok(Object.isFrozen(value));
  assert.ok(["LOCAL_RECEIPT_OBSERVED", "LOCAL_CONFLICT_OBSERVED", "UNKNOWN", "NOT_INSPECTED"].includes(value.persistenceObservation));
};
afterEach(async () => {
  await Promise.all([...owners].map(async owner => { await owner.close(); assert.equal(owner.inspect().activePid, null); trace("closed", owner.inspect()); }));
  owners.clear();
});
async function setup({ rewriteWorker, deadlineMs = 5000, initialize = true } = {}) {
  const root = mkdtempSync(join(evidence, "case-")), store = join(root, "store"), directory = join(root, "owner");
  mkdirSync(store, { mode: 0o700 }); mkdirSync(directory, { mode: 0o700 });
  if (initialize) assert.equal(initializeActivationReceiptStore(store, project).status, "INITIALIZED");
  let module = standard;
  if (rewriteWorker) {
    const source = join(root, "synthetic-source"); mkdirSync(source, { mode: 0o700 });
    for (const name of ["activation-improvement.ts", "activation-owner-worker.mjs", "activation-owner.ts", "activation-receipt-store.ts"]) copyFileSync(new URL("../learning/" + name, import.meta.url), join(source, name));
    const path = join(source, "activation-owner-worker.mjs");
    writeFileSync(path, rewriteWorker(readFileSync(path, "utf8")), { mode: 0o600 });
    module = await import(pathToFileURL(join(source, "activation-owner.ts")));
  }
  const expectedRuntimeDigest = module.measureActivationRuntime().digest;
  const options = { schemaVersion: 1, projectDigest: project, storeDirectory: store, ownerDirectory: directory, expectedRuntimeDigest, deadlineMs };
  const owner = module.createActivationImprovementOwner(JSON.stringify(options)); owners.add(owner);
  trace("setup", { root, syntheticWorker: Boolean(rewriteWorker), options, snapshot: owner.inspect() });
  return { root, store, directory, owner, module, options };
}
function begin(owner, text = template()) { const out = owner.begin(text); safe(out); assert.equal(out.status, "ADMITTED"); assert.ok(Object.isFrozen(out.ticket)); return out.ticket; }
function rows(store) { const db = new DatabaseSync(join(store, STORE_FILE), { readOnly: true }); try { return db.prepare("SELECT activation_id, receipt_json FROM activation_receipts ORDER BY activation_id").all().map(x => ({ ...x })); } finally { db.close(); } }
async function prepared(owner, handle) { const result = trace("run", await owner.run(handle)); safe(result); assert.equal(result.status, "PREPARED"); assert.equal(result.receiptText, null); assert.equal(result.persistenceObservation, "LOCAL_RECEIPT_OBSERVED"); return result.ticket; }
const committedGate = text => text.replace('  const envelope =', '  await import("node:fs").then(fs => fs.writeFileSync(task.config.runtimeDirectory + "/../committed.marker", "committed"));\n  await new Promise(() => setInterval(() => {}, 1000));\n  const envelope =');
async function waitMarker(owner, directory) {
  const deadline = performance.now() + 3000;
  while (!existsSync(join(directory, "committed.marker"))) {
    assert.ok(performance.now() < deadline, "actual child did not reach committed marker");
    const pid = owner.inspect().activePid; assert.ok(pid); process.kill(pid, 0);
    await delay(10);
  }
  const pid = owner.inspect().activePid; assert.ok(pid); process.kill(pid, 0); return pid;
}
const assertDead = pid => assert.throws(() => process.kill(pid, 0), error => error.code === "ESRCH");

test("owner starts OFF; no hook or process is activated by construction", async () => {
  const { owner, store } = await setup();
  const out = owner.begin(template()); safe(out); assert.equal(out.reason, "OWNER_NOT_ON"); assert.equal(out.persistenceObservation, "NOT_INSPECTED");
  assert.equal(owner.inspect().spawnCount, 0); assert.equal(rows(store).length, 0);
});
test("real worker prepares and explicitly delivers exactly bound metadata once", async () => {
  const { owner, store } = await setup(); owner.enable(); const handle = begin(owner), ticket = await prepared(owner, handle);
  const delivery = trace("delivery", owner.takeResult(ticket)); safe(delivery); assert.equal(delivery.status, "DELIVERED_LOCAL_METADATA"); assert.equal(delivery.persistenceObservation, "LOCAL_RECEIPT_OBSERVED");
  const receipt = JSON.parse(delivery.receiptText), req = JSON.parse(receipt.requestText), input = JSON.parse(req.plannerInputText);
  assert.equal(input.activationId, handle.activationId); assert.equal(input.projectDigest, project); assert.equal(req.sourceDigest, owner.inspect().runtimeDigest); assert.equal(req.configurationDigest, owner.inspect().configurationDigest);
  assert.equal(owner.takeResult(ticket).reason, "DELIVERY_ALREADY_CONSUMED"); assert.equal(rows(store).length, 1); assert.equal(owner.inspect().spawnCount, 1);
});
test("same in-flight handle deduplicates; repeated run never starts another child", async () => {
  const { owner, store } = await setup(); owner.enable(); const handle = begin(owner);
  const a = owner.run(handle), b = owner.run(handle); assert.equal(a, b);
  const [first, second] = await Promise.all([a, b]); assert.equal(first, second); safe(first);
  assert.equal(await owner.run(handle), first); assert.equal(owner.inspect().spawnCount, 1); assert.equal(rows(store).length, 1);
  assert.equal(owner.takeResult(first.ticket).status, "DELIVERED_LOCAL_METADATA"); assert.equal(owner.takeResult(second.ticket).status, "REFUSED");
});
test("forged, serialized and other-owner handles cannot run or deliver", async () => {
  const a = await setup(), b = await setup(); a.owner.enable(); b.owner.enable(); const h = begin(a.owner);
  for (const handle of [null, 1, {}, JSON.parse(JSON.stringify(h)), begin(b.owner)]) { const result = await a.owner.run(handle); safe(result); assert.equal(result.reason, "UNKNOWN_INVOCATION"); }
  const ticket = await prepared(a.owner, h);
  for (const forged of [h, { ...ticket }, null]) assert.equal(a.owner.takeResult(forged).reason, "UNKNOWN_DELIVERY_TICKET");
});
for (const [name, value] of [["nontext", null], ["malformed", "{"], ["oversized", "x".repeat(32769)], ["duplicate", template().replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')], ["extra authority", template({ activationId: "forged" })], ["invalid nested budget", template({ budget: { maxCandidates: 99, maxFeedback: 32 } })]]) test(`malformed ${name} template refuses without a subprocess`, async () => {
  const { owner, store } = await setup(); owner.enable(); const result = owner.begin(value); safe(result); assert.equal(result.reason, "TEMPLATE_INVALID"); assert.equal(owner.inspect().spawnCount, 0); assert.equal(rows(store).length, 0);
});
for (const [name, overrides, expected] of [["missing baseline", { baselineDigest: null }, "BLOCKED"], ["no feedback", { feedback: [] }, "NO_CANDIDATE"], ["offline", { mode: "offline" }, "BLOCKED"]]) test(`valid ${name} is stored as metadata without a gain`, async () => {
  const { owner } = await setup(); owner.enable(); const result = owner.takeResult(await prepared(owner, begin(owner, template(overrides)))); safe(result); assert.equal(JSON.parse(result.receiptText).plan.status, expected);
});
test("OFF after prepare but before delivery suppresses the existing receipt", async () => {
  const { owner, store } = await setup(); owner.enable(); const h = begin(owner), ticket = await prepared(owner, h); await owner.off();
  const result = owner.takeResult(ticket); safe(result); assert.equal(result.status, "REVOKED"); assert.equal(result.receiptText, null); assert.equal(rows(store).length, 1);
  owner.enable(); assert.equal(owner.takeResult(ticket).status, "REVOKED"); assert.equal((await owner.run(h)).status, "REVOKED");
  assert.equal(owner.takeResult(await prepared(owner, begin(owner))).status, "DELIVERED_LOCAL_METADATA"); assert.equal(rows(store).length, 2);
});
test("cancellation after prepare suppresses delivery without deleting history", async () => {
  const { owner, store } = await setup(); owner.enable(); const h = begin(owner), ticket = await prepared(owner, h); await owner.cancel(h);
  const result = owner.takeResult(ticket); safe(result); assert.equal(result.status, "CANCELLED"); assert.equal(result.receiptText, null); assert.equal(rows(store).length, 1);
});
test("expiry between prepare and delivery refuses a committed result", async () => {
  const { owner, store } = await setup({ deadlineMs: 500 }); owner.enable(); const h = begin(owner), ticket = await prepared(owner, h); await delay(520);
  const result = owner.takeResult(ticket); safe(result); assert.equal(result.status, "TIMED_OUT"); assert.equal(result.receiptText, null); assert.equal(rows(store).length, 1);
});
test("deadline before run starts refuses without spawning", async () => {
  const { owner } = await setup({ deadlineMs: 50 }); owner.enable(); const h = begin(owner); await delay(65);
  const result = await owner.run(h); safe(result); assert.equal(result.status, "TIMED_OUT"); assert.equal(owner.inspect().spawnCount, 0);
});
test("runtime snapshot changed before run is refused without execution", async () => {
  const { owner } = await setup(); owner.enable(); const h = begin(owner);
  appendFileSync(join(owner.inspect().runtimeDirectory, "activation-owner-worker.mjs"), "\n// changed\n");
  const result = await owner.run(h); safe(result); assert.equal(result.reason, "RUNTIME_SOURCE_CHANGED"); assert.equal(owner.inspect().spawnCount, 0);
});
test("runtime change after join but before delivery suppresses the result", async () => {
  const { owner, store } = await setup(); owner.enable(); const ticket = await prepared(owner, begin(owner));
  appendFileSync(join(owner.inspect().runtimeDirectory, "activation-owner-worker.mjs"), "\n// changed after join\n");
  const result = owner.takeResult(ticket); safe(result); assert.equal(result.reason, "DELIVERY_RUNTIME_SOURCE_CHANGED"); assert.equal(result.receiptText, null); assert.equal(rows(store).length, 1);
});
for (const action of ["off", "cancel", "close"]) test(`${action} kills and joins a real post-COMMIT gated child; no delivery`, async () => {
  const { owner, store, directory } = await setup({ rewriteWorker: committedGate }); owner.enable(); const h = begin(owner), work = owner.run(h);
  const pid = await waitMarker(owner, directory); assert.equal(rows(store).length, 1);
  const stopping = action === "cancel" ? owner.cancel(h) : owner[action]();
  if (action !== "cancel") assert.equal(owner.enable().reason, action === "close" ? "OWNER_CLOSED" : "OWNER_DRAINING");
  const result = trace(action + "-after-commit", await work); await stopping; safe(result); assert.equal(result.status, action === "cancel" ? "CANCELLED" : "REVOKED"); assert.equal(result.receiptText, null); assert.equal(result.ticket, null); assert.equal(result.persistenceObservation, "UNKNOWN");
  assert.equal(owner.inspect().activePid, null); assertDead(pid);
  const historical = rows(store)[0]; const raw = JSON.parse(historical.receipt_json);
  const inspected = inspectActivationReceipt(store, project, raw.requestText); assert.equal(inspected.status, "FOUND"); trace("historical-after-revocation", inspected);
});
test("deadline kills and joins a real post-COMMIT gated child", async () => {
  const { owner, directory, store } = await setup({ rewriteWorker: committedGate, deadlineMs: 500 }); owner.enable(); const work = owner.run(begin(owner)), pid = await waitMarker(owner, directory);
  const result = trace("deadline-after-commit", await work); safe(result); assert.equal(result.status, "TIMED_OUT"); assert.equal(result.receiptText, null); assert.equal(owner.inspect().activePid, null); assertDead(pid); assert.equal(rows(store).length, 1);
});
test("distinct invocations get BUSY while one child is active, with no queue", async () => {
  const { owner, directory } = await setup({ rewriteWorker: committedGate }); owner.enable(); const a = begin(owner), b = begin(owner), work = owner.run(a); await waitMarker(owner, directory);
  const result = await owner.run(b); safe(result); assert.equal(result.status, "BUSY"); assert.equal(owner.inspect().spawnCount, 1); await owner.cancel(a); await work; assert.equal(owner.inspect().activePid, null);
});
test("real SQLite lock failure is non-delivering and permits a later fresh invocation", async () => {
  const { owner, store } = await setup(); owner.enable(); const db = new DatabaseSync(join(store, STORE_FILE)); db.exec("BEGIN IMMEDIATE");
  try { const result = trace("database-lock", await owner.run(begin(owner))); safe(result); assert.equal(result.status, "ERROR"); assert.equal(result.receiptText, null); assert.equal(rows(store).length, 0); }
  finally { db.exec("ROLLBACK"); db.close(); }
  assert.equal(owner.takeResult(await prepared(owner, begin(owner))).status, "DELIVERED_LOCAL_METADATA");
});
test("missing receipt storage never creates a database implicitly", async () => {
  const { owner, store } = await setup({ initialize: false }); owner.enable(); const result = await owner.run(begin(owner)); safe(result); assert.equal(result.status, "ERROR"); assert.deepEqual(readdirSync(store), []);
});
test("constructor source approval, deadline and empty/private directory checks refuse", async () => {
  const { module, options, root } = await setup();
  const fresh = join(root, "fresh"); mkdirSync(fresh, { mode: 0o700 });
  assert.throws(() => module.createActivationImprovementOwner(JSON.stringify({ ...options, ownerDirectory: fresh, expectedRuntimeDigest: "0".repeat(64) })), /EXPECTED_SOURCE_MISMATCH/); assert.deepEqual(readdirSync(fresh), []);
  assert.throws(() => module.createActivationImprovementOwner(JSON.stringify({ ...options, deadlineMs: 0 })), /DEADLINE_INVALID/);
  assert.throws(() => module.createActivationImprovementOwner(JSON.stringify(options)), /OWNER_DIRECTORY_NOT_EMPTY/);
  chmodSync(fresh, 0o755); assert.throws(() => module.createActivationImprovementOwner(JSON.stringify({ ...options, ownerDirectory: fresh })), /DIRECTORY_MODE_REFUSED/);
});
test("invocation count is bounded across generations", async () => {
  const { owner } = await setup(); owner.enable(); for (let i = 0; i < standard.MAX_INVOCATIONS; i++) begin(owner);
  assert.equal(owner.begin(template()).reason, "INVOCATION_CAPACITY_EXHAUSTED"); await owner.off(); owner.enable(); assert.equal(owner.begin(template()).reason, "INVOCATION_CAPACITY_EXHAUSTED"); assert.equal(owner.inspect().spawnCount, 0);
});
for (const conflict of [false, true]) test(`persistence observation distinguishes ${conflict ? "a conflicting request" : "an exact replay"}`, async () => {
  const rewriteWorker = text => text.replace('  const result = recordActivationReceipt', conflict
    ? '  const changed=JSON.parse(task.requestText); changed.configurationDigest="0".repeat(64); recordActivationReceipt(task.config.storeDirectory, task.config.projectDigest, JSON.stringify(changed));\n  const result = recordActivationReceipt'
    : '  recordActivationReceipt(task.config.storeDirectory, task.config.projectDigest, task.requestText);\n  const result = recordActivationReceipt');
  const { owner, store } = await setup({ rewriteWorker }); owner.enable(); const result = trace("persistence-observation", await owner.run(begin(owner))); safe(result);
  assert.equal(result.status, conflict ? "CONFLICT" : "PREPARED"); assert.equal(result.persistenceObservation, conflict ? "LOCAL_CONFLICT_OBSERVED" : "LOCAL_RECEIPT_OBSERVED"); assert.equal(result.receiptText, null); assert.equal(rows(store).length, 1);
  if (!conflict) { const delivered = owner.takeResult(result.ticket); safe(delivered); assert.equal(delivered.persistenceObservation, "LOCAL_RECEIPT_OBSERVED"); }
});
test("source mutation inside an admitted worker is detected before preparing delivery", async () => {
  const rewriteWorker = text => text.replace('  const envelope =', '  await import("node:fs").then(fs => fs.appendFileSync(task.config.runtimeDirectory + "/activation-owner-worker.mjs", "\\n// changed while running\\n"));\n  const envelope =');
  const { owner, store } = await setup({ rewriteWorker }); owner.enable(); const result = await owner.run(begin(owner)); safe(result); assert.equal(result.status, "INCONCLUSIVE"); assert.equal(result.receiptText, null); assert.equal(rows(store).length, 1);
});
test("cancellation before run launches nothing and does not invalidate another handle", async () => {
  const { owner } = await setup(); owner.enable(); const a = begin(owner), b = begin(owner); await owner.cancel(a);
  assert.equal((await owner.run(a)).status, "CANCELLED"); assert.equal(owner.inspect().spawnCount, 0); assert.equal(owner.takeResult(await prepared(owner, b)).status, "DELIVERED_LOCAL_METADATA");
});
for (const [name, rewrite] of [
  ["empty", text => 'process.exit(0);\n' + text],
  ["malformed", text => text.replace('writeSync(1, JSON.stringify(envelope) + "\\n");', 'writeSync(1, "{\\n");')],
  ["duplicate frames", text => text.replace('writeSync(1, JSON.stringify(envelope) + "\\n");', 'writeSync(1, (JSON.stringify(envelope) + "\\n").repeat(2));')],
  ["wrong activation", text => text.replace('writeSync(1, JSON.stringify(envelope) + "\\n");', 'envelope.activationId = "00000000-0000-4000-8000-000000000000"; writeSync(1, JSON.stringify(envelope) + "\\n");')],
  ["claimed gain", text => text.replace('writeSync(1, JSON.stringify(envelope) + "\\n");', 'envelope.result = {...envelope.result, measuredGain:1}; writeSync(1, JSON.stringify(envelope) + "\\n");')],
  ["fabricated receipt digest", text => text.replace('writeSync(1, JSON.stringify(envelope) + "\\n");', 'const row=JSON.parse(envelope.result.receiptText); row.receiptDigest="0".repeat(64); envelope.result={...envelope.result,receiptText:JSON.stringify(row)}; writeSync(1, JSON.stringify(envelope) + "\\n");')],
  ["stderr", text => text.replace('writeSync(1, JSON.stringify(envelope) + "\\n");', 'writeSync(2,"unexpected"); writeSync(1, JSON.stringify(envelope) + "\\n");')],
  ["oversized stdout", text => 'import {writeSync as excess} from "node:fs"; excess(1,Buffer.alloc(240000,"x")); process.exit(0);\n' + text],
  ["oversized stderr", text => 'import {writeSync as excess} from "node:fs"; excess(2,Buffer.alloc(70000,"x")); process.exit(0);\n' + text]
]) test(`synthetic admitted worker with ${name} cannot deliver`, async () => {
  const { owner } = await setup({ rewriteWorker: rewrite }); owner.enable(); const result = trace(name, await owner.run(begin(owner))); safe(result); assert.equal(result.status, "INCONCLUSIVE"); assert.equal(result.receiptText, null); assert.equal(result.ticket, null); assert.equal(owner.inspect().activePid, null);
});
