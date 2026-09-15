import { createHash } from "node:crypto";
import { writeSync } from "node:fs";
import { admitActivationWorkerTask } from "./activation-owner.ts";
import { recordActivationReceipt } from "./activation-receipt-store.ts";

// Closed worker protocol. No model, shell, network, plugin or test-fault hooks.
let input = Buffer.alloc(0);
try {
  for await (const bytes of process.stdin) {
    if (input.length + bytes.length > 100_000) throw new Error("INPUT_BOUND");
    input = Buffer.concat([input, bytes]);
  }
  const text = input.toString("utf8");
  if (!Buffer.from(text).equals(input)) throw new Error("INPUT_ENCODING");
  const task = admitActivationWorkerTask(text);
  const result = recordActivationReceipt(task.config.storeDirectory, task.config.projectDigest, task.requestText);
  const envelope = { schemaVersion: 1, ownerId: task.config.ownerId, generation: task.generation, activationId: task.activationId,
    requestDigest: createHash("sha256").update("veritas:activation-receipt-request:v1\0" + task.requestText).digest("hex"),
    sourceDigest: task.config.runtimeDigest, configurationDigest: task.configurationDigest, result };
  writeSync(1, JSON.stringify(envelope) + "\n");
} catch {
  // Parent treats an absent/nonzero result as unknown publication, not absence.
  process.exitCode = 2;
}
