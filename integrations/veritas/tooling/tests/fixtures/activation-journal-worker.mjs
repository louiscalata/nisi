// Test-only subprocess. No production imports select these fault modes.
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { writeSync, readSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { claimActivationAttempt, appendActivationEvent, inspectActivationAttempt } from "../../learning/activation-journal.ts";

const emit = value => { if (value.result) { assert.ok(Object.isFrozen(value.result)); if (value.result.history) { assert.ok(Object.isFrozen(value.result.history)); assert.ok(Object.isFrozen(value.result.history.events)); } } writeSync(1, JSON.stringify(value) + "\n"); };
process.once("message", async message => {
  const { root, project, text, mode = "claim", phase = "none" } = message;
  if (mode === "owner") {
    const { createJournaledActivationOwner } = await import("../../learning/journaled-activation-owner.ts");
    const owner = createJournaledActivationOwner(JSON.stringify(message.options));
    const actualExec = DatabaseSync.prototype.exec; let gated = false;
    // Interpose real SQLite COMMIT in this test process only, after the owner
    // itself wrote the event and before its next operation can spawn a worker.
    if (["after-owner-claim", "after-owner-run-intent"].includes(phase)) DatabaseSync.prototype.exec = function(sql) {
      const value = actualExec.call(this, sql);
      if (sql === "COMMIT" && !gated) {
        const last = this.prepare("SELECT json FROM events ORDER BY seq DESC LIMIT 1").get();
        if ((phase === "after-owner-claim" && !last) || (phase === "after-owner-run-intent" && last && JSON.parse(last.json).event.type === "RUN_INTENT")) {
          gated = true; emit({ event: "phase", phase, activePid: owner.inspect().activePid }); readSync(0, Buffer.alloc(1), 0, 1, null);
        }
      }
      return value;
    };
    try {
      await owner.enable(); let result = await owner.begin(message.outerKey, text);
      if (result.status === "ADMITTED") {
        result = await owner.run(result.ticket);
        if (phase === "after-prepare") { emit({ event: "phase", phase, activePid: owner.inspect().activePid }); readSync(0, Buffer.alloc(1), 0, 1, null); }
        if (result.status === "PREPARED") result = await owner.takeResult(result.ticket);
        if (phase === "after-return") { emit({ event: "phase", phase, activePid: owner.inspect().activePid }); readSync(0, Buffer.alloc(1), 0, 1, null); }
        if (result.status === "RETURNED_LOCAL_METADATA") result = await owner.acknowledge(result.acknowledgment);
        if (phase === "after-acknowledged") { emit({ event: "phase", phase, activePid: owner.inspect().activePid }); readSync(0, Buffer.alloc(1), 0, 1, null); }
      }
      emit({ event: "result", result, spawnCount: owner.inspect().spawnCount });
    } finally { DatabaseSync.prototype.exec = actualExec; await owner.close(); }
    process.disconnect(); return;
  }
  const original = DatabaseSync.prototype.exec;
  let commitSeen = false;
  DatabaseSync.prototype.exec = function(sql) {
    if (sql === "COMMIT" && !commitSeen) {
      commitSeen = true;
      if (phase === "before-commit") { emit({ event: "phase", phase }); readSync(0, Buffer.alloc(1), 0, 1, null); }
      const value = original.call(this, sql);
      if (phase === "after-commit") { emit({ event: "phase", phase }); readSync(0, Buffer.alloc(1), 0, 1, null); }
      return value;
    }
    return original.call(this, sql);
  };
  const result = mode === "inspect" ? inspectActivationAttempt(root, project, text) : claimActivationAttempt(root, project, text);
  if (phase === "after-claim" || phase === "after-run-intent") {
    if (result.status !== "CREATED") throw new Error("fixture claim not created");
    if (phase === "after-run-intent") {
      const header = JSON.parse(result.history.headerText), activationId = randomUUID();
      for (const [expectedSequence, type, outcome] of [[0, "ADMITTED", "ADMITTED"], [1, "RUN_INTENT", "PENDING"]]) {
        const appended = appendActivationEvent(root, project, JSON.stringify({ schemaVersion: 1, outerKey: header.outerKey, attemptId: header.attemptId, ownerSessionId: header.ownerSessionId, expectedSequence, event: { type, activationId, outcome, receiptDigest: null } }));
        if (appended.status !== "APPENDED") throw new Error("fixture append not confirmed");
      }
    }
    emit({ event: "phase", phase }); readSync(0, Buffer.alloc(1), 0, 1, null);
  }
  emit({ event: "result", result }); process.disconnect();
});
emit({ event: "ready" });
