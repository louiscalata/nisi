// Test-only subprocess driver. Real SQLite and production store are used.
// Phase gates and injected API failures exist only in this fixture, never in
// the storage implementation or a global launcher.
import { readSync, writeSync } from "node:fs";
import { DatabaseSync, constants } from "node:sqlite";
import { initializeActivationReceiptStore, inspectActivationReceipt, recordActivationReceipt } from "../../learning/activation-receipt-store.ts";

const emit = value => writeSync(1, JSON.stringify(value) + "\n");
if (process.argv[2] === "exit-before-ready") process.exit(12);
if (process.argv[2] === "stderr-overflow") { writeSync(2, Buffer.alloc(70_000, "x")); process.exit(14); }
process.once("message", task => {
  if (task.phase === "exit-before-phase") process.exit(13);
  const exec = DatabaseSync.prototype.exec;
  const prepare = DatabaseSync.prototype.prepare;
  const close = DatabaseSync.prototype.close;
  DatabaseSync.prototype.close = function () {
    const result = close.call(this);
    if (task.phase === "throw-after-close") throw new Error("injected API failure after real close");
    return result;
  };
  const gate = phase => {
    emit({ event: "phase", phase });
    const byte = Buffer.alloc(1);
    if (readSync(0, byte, 0, 1, null) !== 1) throw new Error("test gate closed without release");
  };
  DatabaseSync.prototype.exec = function (sql) {
    if (sql === "BEGIN IMMEDIATE" && task.phase === "before-begin") gate("before-begin");
    if (sql === "COMMIT" && task.phase === "before-commit") gate("before-commit");
    const result = exec.call(this, sql);
    if (sql === "BEGIN IMMEDIATE" && task.phase === "after-begin") gate("after-begin");
    if (sql === "COMMIT" && task.phase === "after-commit") gate("after-commit");
    if (sql === "COMMIT" && task.phase === "throw-after-commit") throw new Error("injected API failure after real COMMIT");
    if (sql === "ROLLBACK" && task.phase === "throw-after-rollback") throw new Error("injected API failure after real ROLLBACK");
    return result;
  };
  DatabaseSync.prototype.prepare = function (sql) {
    if (sql.startsWith("INSERT INTO activation_receipts") && task.phase === "deny-insert") {
      this.setAuthorizer(action => action === constants.SQLITE_INSERT ? constants.SQLITE_DENY : constants.SQLITE_OK);
    }
    return prepare.call(this, sql);
  };
  const api = task.mode === "inspect" ? inspectActivationReceipt : task.mode === "initialize" ? initializeActivationReceiptStore : recordActivationReceipt;
  emit({ event: "result", result: api(task.root, task.projectDigest, task.requestText) });
  process.disconnect();
});
emit({ event: "ready" });
