import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, readdirSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { MAX_INPUT_CODE_UNITS, planActivationImprovement } from "./activation-improvement.ts";
import { STORE_VERSION } from "./activation-receipt-store.ts";

// Private same-user local lifecycle component. NOT an installed launcher,
// protected authority, durable rejected-attempt ledger or learning executor.
export const OWNER_VERSION = "activation-owner-v1";
export const MAX_INVOCATIONS = 32;
export const MAX_SOURCE_BYTES = 131_072;
export const MAX_WORKER_OUTPUT_BYTES = 220_000;
export const MAX_WORKER_ERROR_BYTES = 65_536;
const sourceNames = ["activation-improvement.ts", "activation-owner-worker.mjs", "activation-owner.ts", "activation-receipt-store.ts"];
const ownDirectory = dirname(fileURLToPath(import.meta.url));
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const isHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isUUID = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
function check(value: unknown, reason: string): asserts value { if (!value) throw new Error(reason); }
function shape(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === "object" && !Array.isArray(value), "SHAPE_INVALID");
  check(Object.keys(value).sort().join("\0") === [...fields].sort().join("\0"), "SHAPE_INVALID");
}
function decode(text: unknown, bound: number): unknown {
  check(typeof text === "string" && text.length <= bound, "TEXT_BOUND_INVALID");
  try { return JSON.parse(text); } catch { throw new Error("JSON_INVALID"); }
}
function localDirectory(path: unknown, privateOnly: boolean): string {
  check(process.platform === "darwin" && process.arch === "arm64", "HOST_UNSUPPORTED");
  check(typeof path === "string" && path.length > 1 && path.length <= 1024 && isAbsolute(path) && normalize(path) === path && realpathSync(path) === path, "DIRECTORY_NOT_CANONICAL");
  const info = lstatSync(path);
  check(info.isDirectory() && info.uid === process.getuid?.() && (info.mode & (privateOnly ? 0o777 : 0o022)) === (privateOnly ? 0o700 : 0), "DIRECTORY_MODE_REFUSED");
  check(statfsSync(path).type === 26, "FILESYSTEM_UNSUPPORTED");
  return path;
}
function captureRuntime(directory: string) {
  localDirectory(directory, false);
  const files = sourceNames.map(name => {
    const path = join(directory, name);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(fd, { bigint: true });
      check(before.isFile() && before.nlink === 1n && before.uid === BigInt(process.getuid!()) && (before.mode & 0o022n) === 0n && before.size > 0n && before.size <= BigInt(MAX_SOURCE_BYTES), "SOURCE_FILE_REFUSED");
      const bytes = Buffer.alloc(Number(before.size) + 1);
      let used = 0, n: number;
      while (used < bytes.length && (n = readSync(fd, bytes, used, bytes.length - used, used)) > 0) used += n;
      const after = fstatSync(fd, { bigint: true }), named = lstatSync(path, { bigint: true });
      for (const field of ["dev", "ino", "size", "mtimeNs", "ctimeNs", "mode", "nlink", "uid"] as const) check(before[field] === after[field] && after[field] === named[field], "SOURCE_CHANGED");
      check(used === Number(before.size), "SOURCE_CHANGED");
      return { name, bytes: bytes.subarray(0, used) };
    } finally { closeSync(fd); }
  });
  const entries = files.map(({ name, bytes }) => ({ name, bytes: bytes.length, sha256: hash(bytes) }));
  return { files, entries, digest: hash("veritas:activation-runtime:v1\0" + JSON.stringify(entries)) };
}
/** Observed bytes only. The bootstrap must independently approve the expected
 * digest; measuring a runtime does not authorize it or establish protected custody. */
export function measureActivationRuntime(directory = ownDirectory) {
  const { entries, digest } = captureRuntime(directory);
  return Object.freeze({ entries, digest, authorizing: false });
}

type Configuration = {
  schemaVersion: 1; ownerVersion: string; ownerId: string; projectDigest: string;
  storeDirectory: string; runtimeDirectory: string; runtimeDigest: string;
  nodeExecutable: string; nodeVersion: string; platform: string; arch: string;
  deadlineMs: number; maxInvocations: number;
};
function configuration(text: unknown): Configuration {
  const value = decode(text, 8192);
  shape(value, ["schemaVersion", "ownerVersion", "ownerId", "projectDigest", "storeDirectory", "runtimeDirectory", "runtimeDigest", "nodeExecutable", "nodeVersion", "platform", "arch", "deadlineMs", "maxInvocations"]);
  check(value.schemaVersion === 1 && value.ownerVersion === OWNER_VERSION && isUUID(value.ownerId) && isHash(value.projectDigest) && isHash(value.runtimeDigest), "CONFIGURATION_BINDING_INVALID");
  for (const field of ["storeDirectory", "runtimeDirectory", "nodeExecutable"]) check(typeof value[field] === "string" && (value[field] as string).length <= 1024 && isAbsolute(value[field] as string), "CONFIGURATION_PATH_INVALID");
  check(value.nodeExecutable === realpathSync(process.execPath) && value.nodeVersion === process.version && value.platform === process.platform && value.arch === process.arch, "NODE_IDENTITY_MISMATCH");
  check(Number.isInteger(value.deadlineMs) && (value.deadlineMs as number) >= 50 && (value.deadlineMs as number) <= 30_000 && value.maxInvocations === MAX_INVOCATIONS, "CONFIGURATION_LIMIT_INVALID");
  const result = value as unknown as Configuration;
  check(JSON.stringify(result) === text, "CONFIGURATION_NONCANONICAL");
  return result;
}
const configDigest = (text: string) => hash("veritas:activation-owner-configuration:v1\0" + text);
const requestDigest = (text: string) => hash("veritas:activation-receipt-request:v1\0" + text);

/** Fixed protocol used only by the owned local subprocess. No callback, command,
 * environment override, plugin URL, shell or model-provider field is accepted. */
export function admitActivationWorkerTask(text: unknown) {
  const task = decode(text, 100_000);
  shape(task, ["schemaVersion", "configurationText", "generation", "activationId", "requestText"]);
  check(task.schemaVersion === 1 && typeof task.configurationText === "string" && isUUID(task.activationId) && Number.isSafeInteger(task.generation) && (task.generation as number) > 0, "WORKER_TASK_INVALID");
  const config = configuration(task.configurationText);
  check(config.runtimeDirectory === ownDirectory, "WORKER_LOCATION_MISMATCH");
  localDirectory(config.storeDirectory, true);
  check(measureActivationRuntime().digest === config.runtimeDigest, "WORKER_SOURCE_MISMATCH");
  const req = decode(task.requestText, 70_000);
  shape(req, ["schemaVersion", "sourceDigest", "configurationDigest", "plannerInputText"]);
  check(req.schemaVersion === 1 && req.sourceDigest === config.runtimeDigest && req.configurationDigest === configDigest(task.configurationText) && typeof req.plannerInputText === "string", "WORKER_REQUEST_BINDING_INVALID");
  const plan = planActivationImprovement(req.plannerInputText);
  check(plan.status !== "ERROR" && plan.activationId === task.activationId && plan.projectDigest === config.projectDigest && JSON.stringify(req) === task.requestText, "WORKER_PLAN_BINDING_INVALID");
  return { config, generation: task.generation as number, activationId: task.activationId, requestText: task.requestText as string, configurationDigest: configDigest(task.configurationText) };
}
type LocalResult = { status: string; reason: string; receiptText: string | null };
function validateStoreResult(value: unknown, requestText: string, config: Configuration): LocalResult {
  shape(value, ["storeVersion", "status", "reason", "receiptText", "evidenceStatus", "measuredGain", "authorizing", "executionAllowed", "networkAllowed", "modelCallsAllowed", "promotionAllowed", "activeBaselineChanged"]);
  check(value.storeVersion === STORE_VERSION && ["RECORDED", "REPLAYED", "CONFLICT", "REFUSED", "ERROR", "INCONCLUSIVE"].includes(value.status as string) && typeof value.reason === "string" && /^[A-Z0-9_]{1,96}$/.test(value.reason), "STORE_RESULT_INVALID");
  check(value.evidenceStatus === "LOCAL_METADATA_ONLY" && value.measuredGain === null, "STORE_EVIDENCE_INVALID");
  for (const field of ["authorizing", "executionAllowed", "networkAllowed", "modelCallsAllowed", "promotionAllowed", "activeBaselineChanged"]) check(value[field] === false, "STORE_AUTHORITY_INVALID");
  if (!["RECORDED", "REPLAYED"].includes(value.status as string)) { check(value.receiptText === null, "REFUSAL_LEAKS_RECEIPT"); return value as unknown as LocalResult; }
  check(typeof value.receiptText === "string" && Buffer.byteLength(value.receiptText) <= 100_000, "RECEIPT_BOUND_INVALID");
  const row = decode(value.receiptText, 100_000);
  shape(row, ["storeVersion", "storeId", "projectDigest", "requestDigest", "requestText", "createdAt", "clock", "plan", "receiptDigest"]);
  const req = JSON.parse(requestText);
  const plan = planActivationImprovement(req.plannerInputText);
  check(row.storeVersion === STORE_VERSION && isUUID(row.storeId) && row.projectDigest === config.projectDigest && row.requestText === requestText && row.requestDigest === requestDigest(requestText) && row.clock === "LOCAL_WALL_CLOCK_NOT_TRUSTED", "RECEIPT_BINDING_INVALID");
  check(typeof row.createdAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.createdAt) && Number.isFinite(Date.parse(row.createdAt)) && new Date(row.createdAt).toISOString() === row.createdAt, "RECEIPT_CLOCK_INVALID");
  const body = { storeVersion: STORE_VERSION, storeId: row.storeId, projectDigest: config.projectDigest, requestDigest: requestDigest(requestText), requestText, createdAt: row.createdAt, clock: "LOCAL_WALL_CLOCK_NOT_TRUSTED", plan };
  check(JSON.stringify({ ...body, receiptDigest: hash("veritas:activation-receipt:v1\0" + JSON.stringify(body)) }) === value.receiptText, "RECEIPT_RECONSTRUCTION_INVALID");
  return value as unknown as LocalResult;
}
type Ticket = Readonly<{ activationId: string }>;
type State = {
  handle: Ticket; generation: number; deadline: number; requestText: string;
  cancelled: boolean; consumed: boolean; child: ChildProcessWithoutNullStreams | null;
  promise: Promise<ReturnType<typeof outcome>> | null; prepared: LocalResult | null;
};
function outcome(status: string, reason: string, ticket: Ticket | null = null, receiptText: string | null = null) {
  return Object.freeze({ ownerVersion: OWNER_VERSION, status, reason, ticket, receiptText,
    evidenceStatus: "LOCAL_METADATA_ONLY", measuredGain: null, authorizing: false,
    executionAllowed: false, networkAllowed: false, modelCallsAllowed: false,
    promotionAllowed: false, activeBaselineChanged: false,
    rejectedAttemptLedger: "NOT_IMPLEMENTED",
    persistenceObservation: ["PREPARED", "DELIVERED_LOCAL_METADATA"].includes(status) ? "LOCAL_RECEIPT_OBSERVED" : status === "CONFLICT" ? "LOCAL_CONFLICT_OBSERVED" : ["INCONCLUSIVE", "REVOKED", "CANCELLED", "TIMED_OUT"].includes(status) ? "UNKNOWN" : "NOT_INSPECTED" });
}

/** Creates one bounded OFF owner and an exclusive local runtime copy. Trusted
 * bootstrap supplies project scope and expected code digest; there is no launcher
 * or consent bridge. Setup/identity reads are synchronous, not hard I/O deadlines. */
export function createActivationImprovementOwner(optionsText: unknown) {
  const options = decode(optionsText, 8192);
  shape(options, ["schemaVersion", "projectDigest", "storeDirectory", "ownerDirectory", "expectedRuntimeDigest", "deadlineMs"]);
  check(JSON.stringify(options) === optionsText && options.schemaVersion === 1 && isHash(options.projectDigest) && isHash(options.expectedRuntimeDigest), "OWNER_OPTIONS_INVALID");
  check(Number.isInteger(options.deadlineMs) && (options.deadlineMs as number) >= 50 && (options.deadlineMs as number) <= 30_000, "DEADLINE_INVALID");
  const storeDirectory = localDirectory(options.storeDirectory, true), ownerDirectory = localDirectory(options.ownerDirectory, true);
  check(storeDirectory !== ownerDirectory && readdirSync(ownerDirectory).length === 0, "OWNER_DIRECTORY_NOT_EMPTY");
  const source = captureRuntime(ownDirectory);
  check(source.digest === options.expectedRuntimeDigest, "EXPECTED_SOURCE_MISMATCH");
  const runtimeDirectory = join(ownerDirectory, "runtime");
  mkdirSync(runtimeDirectory, { mode: 0o700 });
  for (const file of source.files) writeFileSync(join(runtimeDirectory, file.name), file.bytes, { flag: "wx", mode: 0o600 });
  check(measureActivationRuntime(runtimeDirectory).digest === source.digest, "RUNTIME_COPY_MISMATCH");
  const config: Configuration = { schemaVersion: 1, ownerVersion: OWNER_VERSION, ownerId: randomUUID(), projectDigest: options.projectDigest, storeDirectory, runtimeDirectory, runtimeDigest: source.digest, nodeExecutable: realpathSync(process.execPath), nodeVersion: process.version, platform: process.platform, arch: process.arch, deadlineMs: options.deadlineMs as number, maxInvocations: MAX_INVOCATIONS };
  const configurationText = JSON.stringify(config), configurationDigest = configDigest(configurationText);
  let mode: "OFF" | "ON" | "CLOSED" = "OFF", generation = 0, active: State | null = null, spawnCount = 0;
  const invocations = new Map<Ticket, State>(), deliveries = new WeakMap<Ticket, State>();
  const stale = (state: State) => mode !== "ON" || state.generation !== generation ? outcome("REVOKED", "OWNER_OFF_OR_GENERATION_CHANGED") : state.cancelled ? outcome("CANCELLED", "INVOCATION_CANCELLED") : performance.now() >= state.deadline ? outcome("TIMED_OUT", "INVOCATION_DEADLINE_EXPIRED") : null;
  const lookup = (handle: unknown): State | undefined => typeof handle === "object" && handle !== null ? invocations.get(handle as Ticket) : undefined;
  const stop = async (closed = false) => {
    if (mode !== "CLOSED") { mode = closed ? "CLOSED" : "OFF"; generation++; }
    for (const state of invocations.values()) state.prepared = null;
    const running = active;
    if (running?.child) running.child.kill("SIGKILL");
    if (running?.promise) await running.promise;
    return outcome("STOPPED", closed ? "OWNER_CLOSED" : "OWNER_OFF");
  };
  return Object.freeze({
    enable() {
      if (mode === "CLOSED") return outcome("REFUSED", "OWNER_CLOSED");
      if (active) return outcome("REFUSED", "OWNER_DRAINING");
      if (mode !== "ON") { mode = "ON"; generation++; }
      return outcome("ENABLED", "LOCAL_METADATA_CHECKS_ONLY");
    },
    off: () => stop(false), close: () => stop(true),
    inspect() { return Object.freeze({ mode, generation, activePid: active?.child?.pid ?? null, spawnCount, invocationCount: invocations.size, runtimeDigest: config.runtimeDigest, configurationDigest, runtimeDirectory, rejectedAttemptLedger: "NOT_IMPLEMENTED", authorizing: false }); },
    begin(templateText: unknown) {
      if (mode !== "ON") return outcome("REFUSED", "OWNER_NOT_ON");
      if (invocations.size >= MAX_INVOCATIONS) return outcome("REFUSED", "INVOCATION_CAPACITY_EXHAUSTED");
      try {
        const template = decode(templateText, MAX_INPUT_CODE_UNITS);
        shape(template, ["schemaVersion", "mode", "environmentDigest", "baselineDigest", "heldoutDigest", "baselineHealth", "budget", "feedback"]);
        const handle = Object.freeze({ activationId: randomUUID() });
        const input = { schemaVersion: template.schemaVersion, activationId: handle.activationId, mode: template.mode, projectDigest: config.projectDigest, environmentDigest: template.environmentDigest, baselineDigest: template.baselineDigest, heldoutDigest: template.heldoutDigest, baselineHealth: template.baselineHealth, budget: template.budget, feedback: template.feedback };
        const inputText = JSON.stringify(input), plan = planActivationImprovement(inputText);
        check(plan.status !== "ERROR" && JSON.stringify(template) === templateText, "TEMPLATE_INVALID");
        const requestText = JSON.stringify({ schemaVersion: 1, sourceDigest: config.runtimeDigest, configurationDigest, plannerInputText: inputText });
        invocations.set(handle, { handle, generation, deadline: performance.now() + config.deadlineMs, requestText, cancelled: false, consumed: false, child: null, promise: null, prepared: null });
        return outcome("ADMITTED", "OWNER_ISSUED_LOCAL_INVOCATION", handle);
      } catch { return outcome("REFUSED", "TEMPLATE_INVALID"); }
    },
    async cancel(handle: unknown) {
      const state = lookup(handle);
      if (!state) return outcome("REFUSED", "UNKNOWN_INVOCATION");
      state.cancelled = true; state.prepared = null;
      if (state.child) state.child.kill("SIGKILL");
      if (state.promise) await state.promise;
      return outcome("CANCELLED", "INVOCATION_CANCELLED");
    },
    run(handle: unknown): Promise<ReturnType<typeof outcome>> {
      const state = lookup(handle);
      if (!state) return Promise.resolve(outcome("REFUSED", "UNKNOWN_INVOCATION"));
      const refused = stale(state);
      if (refused) return Promise.resolve(refused);
      if (state.promise) return state.promise;
      if (active) return Promise.resolve(outcome("BUSY", "ONE_ACTIVE_NO_QUEUE"));
      try { check(measureActivationRuntime(runtimeDirectory).digest === config.runtimeDigest, "SOURCE_CHANGED"); }
      catch { return Promise.resolve(outcome("REFUSED", "RUNTIME_SOURCE_CHANGED")); }
      const expired = stale(state); if (expired) return Promise.resolve(expired);
      active = state;
      let resolve!: (value: ReturnType<typeof outcome>) => void;
      state.promise = new Promise(done => { resolve = done; });
      let stdout = Buffer.alloc(0), stderrBytes = 0, fault: string | null = null, timedOut = false;
      const kill = (reason: string) => { fault ??= reason; state.child?.kill("SIGKILL"); };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const child = spawn(config.nodeExecutable, [join(runtimeDirectory, "activation-owner-worker.mjs")], { cwd: runtimeDirectory, shell: false, detached: false, stdio: ["pipe", "pipe", "pipe"], env: { LANG: "C", LC_ALL: "C", TZ: "UTC" } });
        state.child = child; spawnCount++;
        timer = setTimeout(() => { timedOut = true; kill("WORKER_DEADLINE"); }, Math.max(1, state.deadline - performance.now()));
        child.stdout.on("data", (bytes: Buffer) => { if (fault) return; if (stdout.length + bytes.length > MAX_WORKER_OUTPUT_BYTES) { kill("WORKER_STDOUT_LIMIT"); return; } stdout = Buffer.concat([stdout, bytes]); });
        child.stderr.on("data", (bytes: Buffer) => { stderrBytes += bytes.length; if (stderrBytes > MAX_WORKER_ERROR_BYTES) kill("WORKER_STDERR_LIMIT"); });
        child.on("error", () => kill("WORKER_PROCESS_ERROR"));
        child.stdin.on("error", () => kill("WORKER_INPUT_ERROR"));
        child.on("close", (code, signal) => {
          if (timer) clearTimeout(timer);
          state.child = null;
          let result: ReturnType<typeof outcome>;
          const revoked = stale(state);
          if (revoked) result = revoked;
          else if (timedOut) result = outcome("TIMED_OUT", "WORKER_DEADLINE");
          else if (fault || code !== 0 || signal !== null || stderrBytes !== 0) result = outcome("INCONCLUSIVE", fault ?? "WORKER_EXIT_OR_STDERR_UNCONFIRMED");
          else {
            try {
              check(measureActivationRuntime(runtimeDirectory).digest === config.runtimeDigest, "SOURCE_CHANGED");
              const text = stdout.toString("utf8");
              check(Buffer.from(text).equals(stdout) && text.endsWith("\n") && text.indexOf("\n") === text.length - 1, "WORKER_FRAMING_INVALID");
              const value = decode(text.slice(0, -1), MAX_WORKER_OUTPUT_BYTES);
              shape(value, ["schemaVersion", "ownerId", "generation", "activationId", "requestDigest", "sourceDigest", "configurationDigest", "result"]);
              check(JSON.stringify(value) + "\n" === text && value.schemaVersion === 1 && value.ownerId === config.ownerId && value.generation === state.generation && value.activationId === state.handle.activationId && value.requestDigest === requestDigest(state.requestText) && value.sourceDigest === config.runtimeDigest && value.configurationDigest === configurationDigest, "WORKER_RESULT_BINDING_INVALID");
              const local = validateStoreResult(value.result, state.requestText, config);
              const finalRefusal = stale(state);
              if (finalRefusal) result = finalRefusal;
              else if (["RECORDED", "REPLAYED"].includes(local.status)) {
                const ticket = Object.freeze({ activationId: state.handle.activationId });
                state.prepared = local; deliveries.set(ticket, state);
                result = outcome("PREPARED", "EXPLICIT_DELIVERY_REQUIRED", ticket);
              } else result = outcome(local.status, local.reason);
            } catch { result = outcome("INCONCLUSIVE", "WORKER_RESULT_UNCONFIRMED"); }
          }
          if (active === state) active = null;
          resolve(result);
        });
        child.stdin.end(JSON.stringify({ schemaVersion: 1, configurationText, generation: state.generation, activationId: state.handle.activationId, requestText: state.requestText }));
      } catch {
        if (timer) clearTimeout(timer);
        // spawn normally reports errors via events. No retry if launch is uncertain.
        if (state.child) kill("WORKER_LAUNCH_UNCONFIRMED");
        else { if (active === state) active = null; resolve(outcome("INCONCLUSIVE", "WORKER_LAUNCH_UNCONFIRMED")); }
      }
      return state.promise;
    },
    takeResult(ticket: unknown) {
      const state = typeof ticket === "object" && ticket !== null ? deliveries.get(ticket as Ticket) : undefined;
      if (!state) return outcome("REFUSED", "UNKNOWN_DELIVERY_TICKET");
      const refused = stale(state); if (refused) { state.prepared = null; return refused; }
      if (state.consumed || !state.prepared) return outcome("REFUSED", "DELIVERY_ALREADY_CONSUMED");
      try { check(measureActivationRuntime(runtimeDirectory).digest === config.runtimeDigest, "SOURCE_CHANGED"); }
      catch { state.prepared = null; state.consumed = true; return outcome("INCONCLUSIVE", "DELIVERY_RUNTIME_SOURCE_CHANGED"); }
      const expired = stale(state); if (expired) { state.prepared = null; return expired; }
      state.consumed = true;
      const text = state.prepared.receiptText; state.prepared = null;
      return outcome("DELIVERED_LOCAL_METADATA", "NOT_PERMISSION_OR_MEASURED_GAIN", null, text);
    }
  });
}
