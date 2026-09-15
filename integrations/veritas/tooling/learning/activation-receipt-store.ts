import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fsyncSync, lstatSync, openSync, readSync, realpathSync, readdirSync, statfsSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MAX_INPUT_CODE_UNITS, planActivationImprovement } from "./activation-improvement.ts";

// Explicit local storage prerequisite, NOT an activation owner or launcher.
// Cooperating same-user macOS/arm64 APFS callers only. No protected custody,
// rollback/deletion detection, hostile path-swap defense or power-loss guarantee.
export const STORE_VERSION = "activation-receipt-store-v1";
export const STORE_FILE = "activation-receipts.sqlite3";
export const MAX_RECORDS = 256;
export const MAX_REQUEST_CODE_UNITS = 70_000;
export const MAX_RECEIPT_BYTES = 100_000;
export const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_DATABASE_BYTES = 16 * 1024 * 1024;
export const BUSY_TIMEOUT_MS = 250;
const APP_ID = 0x56524131;
const META_SQL = "CREATE TABLE owner_metadata (id INTEGER PRIMARY KEY CHECK (id = 1), metadata TEXT NOT NULL) STRICT";
const RECEIPT_SQL = "CREATE TABLE activation_receipts (activation_id TEXT PRIMARY KEY, receipt_json TEXT NOT NULL) STRICT, WITHOUT ROWID";
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const isSha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
class Refusal extends Error {}
function requireThat(value: unknown, reason: string): asserts value { if (!value) throw new Refusal(reason); }
function object(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), "SHAPE_INVALID");
  requireThat(Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"), "SHAPE_INVALID");
}
function decode(text: unknown, limit: number): unknown {
  requireThat(typeof text === "string" && text.length <= limit, "INPUT_BOUND_INVALID");
  try { return JSON.parse(text); } catch { throw new Refusal("JSON_INVALID"); }
}
function request(text: unknown, projectDigest: string) {
  const value = decode(text, MAX_REQUEST_CODE_UNITS);
  object(value, ["schemaVersion", "sourceDigest", "configurationDigest", "plannerInputText"]);
  requireThat(value.schemaVersion === 1 && isSha(value.sourceDigest) && isSha(value.configurationDigest), "REQUEST_BINDINGS_INVALID");
  requireThat(typeof value.plannerInputText === "string" && value.plannerInputText.length <= MAX_INPUT_CODE_UNITS, "PLANNER_INPUT_BOUND_INVALID");
  const canonical = JSON.stringify({ schemaVersion: 1, sourceDigest: value.sourceDigest, configurationDigest: value.configurationDigest, plannerInputText: value.plannerInputText });
  requireThat(canonical === text, "REQUEST_NONCANONICAL");
  const plan = planActivationImprovement(value.plannerInputText);
  // Invalid/raw input diagnostics belong to the future outer owner, not this
  // metadata store. Never persist rejected prose or fabricate its project/ID.
  requireThat(plan.status !== "ERROR" && plan.activationId !== null && plan.inputDigest !== null, "PLANNER_INPUT_INVALID");
  requireThat(plan.projectDigest === projectDigest, "PROJECT_BINDING_MISMATCH");
  return { text: canonical, digest: sha("veritas:activation-receipt-request:v1\0" + canonical), activationId: plan.activationId, plan };
}
type Request = ReturnType<typeof request>;
type Metadata = { schemaVersion: 1; storeVersion: string; storeId: string; projectDigest: string };
type Status = "INITIALIZED" | "RECORDED" | "REPLAYED" | "FOUND" | "MISSING" | "CONFLICT" | "REFUSED" | "ERROR" | "INCONCLUSIVE";
function outcome(status: Status, reason: string, receiptText: string | null = null) {
  return Object.freeze({ storeVersion: STORE_VERSION, status, reason, receiptText,
    evidenceStatus: "LOCAL_METADATA_ONLY", measuredGain: null,
    authorizing: false, executionAllowed: false, networkAllowed: false,
    modelCallsAllowed: false, promotionAllowed: false, activeBaselineChanged: false });
}
function rootPath(value: unknown): string {
  requireThat(process.platform === "darwin" && process.arch === "arm64", "HOST_UNSUPPORTED");
  requireThat(typeof value === "string" && value.length > 1 && value.length <= 1024 && isAbsolute(value) && normalize(value) === value, "STORE_PATH_INVALID");
  requireThat(realpathSync(value) === value, "STORE_PATH_NOT_CANONICAL");
  const info = lstatSync(value);
  requireThat(info.isDirectory() && info.uid === process.getuid?.() && (info.mode & 0o777) === 0o700, "STORE_DIRECTORY_NOT_PRIVATE");
  // 26 is the APFS VFS type observed on the admitted Darwin host. Other types
  // refuse; this check is not an ancestor lock or an atomic filesystem snapshot.
  requireThat(statfsSync(value).type === 26, "FILESYSTEM_UNSUPPORTED");
  return value;
}
function checkFiles(root: string, allowEmpty = false) {
  const path = join(root, STORE_FILE);
  const info = lstatSync(path);
  requireThat(info.isFile() && info.nlink === 1 && info.uid === process.getuid?.() && (info.mode & 0o777) === 0o600, "STORE_FILE_NOT_PRIVATE_REGULAR");
  requireThat(info.size <= MAX_DATABASE_BYTES && (allowEmpty || info.size >= 4096), "STORE_FILE_SIZE_INVALID");
  if (!allowEmpty) {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const bytes = Buffer.alloc(16); requireThat(readSync(fd, bytes, 0, 16, 0) === 16 && bytes.toString() === "SQLite format 3\0", "STORE_HEADER_INVALID"); }
    finally { closeSync(fd); }
  }
  for (const suffix of ["-wal", "-shm"]) {
    let side;
    try { side = lstatSync(path + suffix); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    requireThat(side.isFile() && side.nlink === 1 && side.uid === process.getuid?.() && (side.mode & 0o777) === 0o600 && side.size <= MAX_DATABASE_BYTES, "STORE_SIDECAR_INVALID");
  }
  return { path, dev: info.dev, ino: info.ino };
}
function connection(path: string, readOnly: boolean) {
  const db = new DatabaseSync(path, { readOnly, timeout: BUSY_TIMEOUT_MS, allowExtension: false, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false });
  try {
    db.exec("PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;");
    return db;
  } catch (error) { try { db.close(); } catch {} throw error; }
}
function metadata(db: DatabaseSync, projectDigest: string): Metadata {
  requireThat(db.prepare("PRAGMA application_id").get()?.application_id === APP_ID && db.prepare("PRAGMA user_version").get()?.user_version === 1, "STORE_VERSION_INVALID");
  requireThat(db.prepare("PRAGMA journal_mode").get()?.journal_mode === "wal" && db.prepare("PRAGMA synchronous").get()?.synchronous === 2, "STORE_JOURNAL_INVALID");
  const schema = db.prepare("SELECT name, type, sql FROM sqlite_schema ORDER BY name").all();
  requireThat(schema.length === 2 && schema[0]?.name === "activation_receipts" && schema[0]?.type === "table" && schema[0]?.sql === RECEIPT_SQL && schema[1]?.name === "owner_metadata" && schema[1]?.type === "table" && schema[1]?.sql === META_SQL, "STORE_SCHEMA_INVALID");
  const rows = db.prepare("SELECT id, metadata FROM owner_metadata LIMIT 2").all();
  requireThat(rows.length === 1 && rows[0]?.id === 1, "STORE_METADATA_INVALID");
  const raw = rows[0]?.metadata;
  const value = decode(raw, 1024);
  object(value, ["schemaVersion", "storeVersion", "storeId", "projectDigest"]);
  requireThat(value.schemaVersion === 1 && value.storeVersion === STORE_VERSION && uuid(value.storeId) && value.projectDigest === projectDigest, "STORE_PROJECT_OR_VERSION_MISMATCH");
  const result: Metadata = { schemaVersion: 1, storeVersion: STORE_VERSION, storeId: value.storeId, projectDigest };
  requireThat(JSON.stringify(result) === raw, "STORE_METADATA_NONCANONICAL");
  requireThat(db.prepare("PRAGMA quick_check(1)").get()?.quick_check === "ok", "STORE_INTEGRITY_REFUSED");
  return result;
}
function receipt(req: Request, meta: Metadata, createdAt: string): string {
  const body = { storeVersion: STORE_VERSION, storeId: meta.storeId, projectDigest: meta.projectDigest,
    requestDigest: req.digest, requestText: req.text, createdAt, clock: "LOCAL_WALL_CLOCK_NOT_TRUSTED",
    plan: req.plan };
  return JSON.stringify({ ...body, receiptDigest: sha("veritas:activation-receipt:v1\0" + JSON.stringify(body)) });
}
function records(db: DatabaseSync, meta: Metadata) {
  const size = db.prepare("SELECT count(*) AS n, coalesce(max(length(CAST(receipt_json AS BLOB))), 0) AS maxBytes, coalesce(sum(length(CAST(receipt_json AS BLOB))), 0) AS payloadBytes FROM activation_receipts").get();
  requireThat(typeof size?.n === "number" && Number.isSafeInteger(size.n) && size.n <= MAX_RECORDS && typeof size.maxBytes === "number" && size.maxBytes <= MAX_RECEIPT_BYTES && typeof size.payloadBytes === "number" && Number.isSafeInteger(size.payloadBytes) && size.payloadBytes <= MAX_PAYLOAD_BYTES, "STORE_CAPACITY_OR_RECORD_BOUND_INVALID");
  const result = new Map<string, { text: string; requestDigest: string }>();
  for (const row of db.prepare("SELECT activation_id, receipt_json FROM activation_receipts ORDER BY activation_id LIMIT 257").all()) {
    const raw = row.receipt_json;
    const value = decode(raw, MAX_RECEIPT_BYTES);
    object(value, ["storeVersion", "storeId", "projectDigest", "requestDigest", "requestText", "createdAt", "clock", "plan", "receiptDigest"]);
    requireThat(typeof value.createdAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) && Number.isFinite(Date.parse(value.createdAt)) && new Date(value.createdAt).toISOString() === value.createdAt, "RECEIPT_CLOCK_INVALID");
    const req = request(value.requestText, meta.projectDigest);
    requireThat(row.activation_id === req.activationId && receipt(req, meta, value.createdAt) === raw, "RECEIPT_BINDING_INVALID");
    result.set(req.activationId, { text: raw as string, requestDigest: req.digest });
  }
  return { entries: result, payloadBytes: size.payloadBytes };
}

/** Explicit initialization only; never creates directories or overwrites a file.
 * Failure preserves the partial store for manual diagnosis. */
export function initializeActivationReceiptStore(directory: unknown, expectedProjectDigest: unknown) {
  let db: DatabaseSync | undefined;
  let result = outcome("ERROR", "STORE_INITIALIZATION_FAILED");
  let commitAttempted = false;
  try {
    requireThat(isSha(expectedProjectDigest), "PROJECT_DIGEST_INVALID");
    const root = rootPath(directory);
    requireThat(readdirSync(root).length === 0, "INITIALIZATION_REQUIRES_EMPTY_DIRECTORY");
    const path = join(root, STORE_FILE);
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    closeSync(fd);
    checkFiles(root, true);
    db = connection(path, false);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=128; BEGIN IMMEDIATE;");
    db.exec(META_SQL + ";" + RECEIPT_SQL + "; PRAGMA application_id=" + APP_ID + "; PRAGMA user_version=1;");
    const value: Metadata = { schemaVersion: 1, storeVersion: STORE_VERSION, storeId: randomUUID(), projectDigest: expectedProjectDigest };
    db.prepare("INSERT INTO owner_metadata(id, metadata) VALUES (1, ?)").run(JSON.stringify(value));
    metadata(db, expectedProjectDigest);
    commitAttempted = true;
    db.exec("COMMIT");
    metadata(db, expectedProjectDigest);
    const dirfd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(dirfd); } finally { closeSync(dirfd); }
    result = outcome("INITIALIZED", "LOCAL_STORE_INITIALIZED");
  } catch (error) {
    result = outcome(commitAttempted ? "INCONCLUSIVE" : error instanceof Refusal ? "REFUSED" : "ERROR", commitAttempted ? "INITIALIZATION_OUTCOME_UNCONFIRMED" : error instanceof Refusal ? error.message : "STORE_INITIALIZATION_FAILED");
  } finally {
    if (db) {
      try { if (db.isTransaction) db.exec("ROLLBACK"); } catch { result = outcome("INCONCLUSIVE", "ROLLBACK_UNCONFIRMED"); }
      try { db.close(); } catch { result = outcome("INCONCLUSIVE", "CLOSE_UNCONFIRMED"); }
    }
  }
  return result;
}

function useStore(directory: unknown, expectedProjectDigest: unknown, requestText: unknown, write: boolean) {
  let db: DatabaseSync | undefined;
  let result = outcome("ERROR", "STORAGE_UNAVAILABLE");
  let commitAttempted = false;
  try {
    requireThat(isSha(expectedProjectDigest), "PROJECT_DIGEST_INVALID");
    const req = request(requestText, expectedProjectDigest);
    const root = rootPath(directory);
    const identity = checkFiles(root);
    db = connection(identity.path, !write);
    db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    const meta = metadata(db, expectedProjectDigest);
    const existing = records(db, meta);
    const prior = existing.entries.get(req.activationId);
    if (prior) result = prior.requestDigest === req.digest
      ? outcome(write ? "REPLAYED" : "FOUND", "EXISTING_LOCAL_RECEIPT", prior.text)
      : outcome("CONFLICT", "ACTIVATION_REPLAY_CONFLICT");
    else if (!write) result = outcome("MISSING", "NO_LOCAL_RECEIPT_OBSERVED");
    else {
      requireThat(existing.entries.size < MAX_RECORDS, "STORE_CAPACITY_EXHAUSTED");
      const text = receipt(req, meta, new Date().toISOString());
      requireThat(Buffer.byteLength(text) <= MAX_RECEIPT_BYTES, "RECEIPT_SIZE_INVALID");
      requireThat(existing.payloadBytes + Buffer.byteLength(text) <= MAX_PAYLOAD_BYTES, "STORE_PAYLOAD_EXHAUSTED");
      db.prepare("INSERT INTO activation_receipts(activation_id, receipt_json) VALUES (?, ?)").run(req.activationId, text);
      commitAttempted = true;
      db.exec("COMMIT");
      // A separate read transaction; no automatic reconnect/retry on ambiguity.
      db.exec("BEGIN");
      const seen = records(db, metadata(db, expectedProjectDigest)).entries.get(req.activationId);
      requireThat(seen?.text === text, "COMMITTED_RECEIPT_READBACK_FAILED");
      result = outcome("RECORDED", "COMMIT_AND_LOCAL_READBACK_OBSERVED", text);
    }
    const finalIdentity = checkFiles(root);
    requireThat(finalIdentity.dev === identity.dev && finalIdentity.ino === identity.ino, "STORE_PATH_IDENTITY_CHANGED");
    requireThat(rootPath(root) === root, "STORE_DIRECTORY_CHANGED");
  } catch (error) {
    result = outcome(commitAttempted ? "INCONCLUSIVE" : error instanceof Refusal ? "REFUSED" : "ERROR", commitAttempted ? "PUBLICATION_OUTCOME_UNCONFIRMED" : error instanceof Refusal ? error.message : "STORAGE_UNAVAILABLE");
  } finally {
    if (db) {
      try { if (db.isTransaction) db.exec("ROLLBACK"); } catch { result = outcome("INCONCLUSIVE", "ROLLBACK_UNCONFIRMED"); }
      try { db.close(); } catch { result = outcome("INCONCLUSIVE", "CLOSE_UNCONFIRMED"); }
    }
  }
  return result;
}

// All successful results describe historical local metadata, never permission
// to act. OFF/revocation, deadlines, admission and durable outer attempt logging
// belong to the future activation owner; busy timeout is NOT a hard I/O deadline.
export function recordActivationReceipt(directory: unknown, expectedProjectDigest: unknown, requestText: unknown) {
  return useStore(directory, expectedProjectDigest, requestText, true);
}
export function inspectActivationReceipt(directory: unknown, expectedProjectDigest: unknown, requestText: unknown) {
  return useStore(directory, expectedProjectDigest, requestText, false);
}
