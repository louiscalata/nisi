import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fsyncSync, lstatSync, openSync, readSync, realpathSync, readdirSync, statfsSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Local append-only metadata, not protected custody or execution permission.
// Missing/uncertain records never authorize retry or prove an owner is dead.
export const JOURNAL_VERSION = "activation-attempt-journal-v1";
export const JOURNAL_FILE = "activation-attempts.sqlite3";
export const MAX_ATTEMPTS = 256, MAX_EVENTS = 2048, MAX_OBSERVATIONS = 512;
export const MAX_EVENTS_PER_ATTEMPT = 8, MAX_JOURNAL_PAYLOAD_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 32 * 1024 * 1024, MAX_ROW_BYTES = 4096, APP_ID = 0x56414a31;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const isSha = (x: unknown): x is string => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const uuid = (x: unknown): x is string => typeof x === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
class Refusal extends Error {}
function check(value: unknown, reason: string): asserts value { if (!value) throw new Refusal(reason); }
function shape(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === "object" && !Array.isArray(value), "SHAPE_INVALID");
  check(Object.keys(value).sort().join("\0") === [...fields].sort().join("\0"), "SHAPE_INVALID");
}
function parse(text: unknown, bound = MAX_ROW_BYTES): unknown {
  check(typeof text === "string" && text.length <= bound, "TEXT_BOUND_INVALID");
  try { return JSON.parse(text); } catch { throw new Refusal("JSON_INVALID"); }
}
function timestamp(value: unknown): asserts value is string {
  check(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, "CLOCK_INVALID");
}
const clock = "LOCAL_WALL_CLOCK_NOT_TRUSTED";
type Binding = { sourceDigest: string; policyDigest: string; templateDigest: string | null; templateKind: "VALID_METADATA" | "INVALID_UNIDENTIFIED" };
function binding(value: unknown): Binding {
  shape(value, ["sourceDigest", "policyDigest", "templateDigest", "templateKind"]);
  check(isSha(value.sourceDigest) && isSha(value.policyDigest) && ["VALID_METADATA", "INVALID_UNIDENTIFIED"].includes(value.templateKind as string), "BINDING_INVALID");
  check(value.templateKind === "VALID_METADATA" ? isSha(value.templateDigest) : value.templateDigest === null, "TEMPLATE_BINDING_INVALID");
  return { sourceDigest: value.sourceDigest, policyDigest: value.policyDigest, templateDigest: value.templateDigest as string | null, templateKind: value.templateKind as Binding["templateKind"] };
}
function claimInput(text: unknown) {
  const x = parse(text); shape(x, ["schemaVersion", "outerKey", "ownerSessionId", "binding"]);
  check(x.schemaVersion === 1 && isSha(x.outerKey) && uuid(x.ownerSessionId), "CLAIM_FIELDS_INVALID");
  const result = { schemaVersion: 1, outerKey: x.outerKey, ownerSessionId: x.ownerSessionId, binding: binding(x.binding) };
  check(JSON.stringify(result) === text, "CLAIM_NONCANONICAL"); return result;
}
type Event = { type: "ADMITTED" | "REJECTED" | "RUN_INTENT" | "PREPARED" | "UNCONFIRMED" | "REVOCATION_OBSERVED" | "RETURN_INTENT" | "CALLER_ACKNOWLEDGED"; activationId: string | null; outcome: string; receiptDigest: string | null };
const outcomes: Record<Event["type"], string[]> = {
  ADMITTED: ["ADMITTED"], REJECTED: ["REFUSED"], RUN_INTENT: ["PENDING"], PREPARED: ["PREPARED"],
  UNCONFIRMED: ["ERROR", "REFUSED", "INCONCLUSIVE", "CONFLICT", "BUSY"],
  REVOCATION_OBSERVED: ["REVOKED", "CANCELLED", "TIMED_OUT"],
  RETURN_INTENT: ["RETURN_ATTEMPTED_ACK_UNKNOWN"], CALLER_ACKNOWLEDGED: ["CALLER_ACKNOWLEDGED"]
};
function eventInput(value: unknown): Event {
  shape(value, ["type", "activationId", "outcome", "receiptDigest"]);
  check(typeof value.type === "string" && Object.hasOwn(outcomes, value.type) && typeof value.outcome === "string" && outcomes[value.type as Event["type"]].includes(value.outcome), "EVENT_TYPE_INVALID");
  check(value.activationId === null || uuid(value.activationId), "ACTIVATION_ID_INVALID");
  const carriesDigest = ["RETURN_INTENT", "CALLER_ACKNOWLEDGED"].includes(value.type);
  check(carriesDigest ? isSha(value.receiptDigest) : value.receiptDigest === null, "EVENT_RECEIPT_INVALID");
  check(value.type === "REJECTED" ? value.activationId === null : uuid(value.activationId), "EVENT_ACTIVATION_INVALID");
  return { type: value.type as Event["type"], activationId: value.activationId as string | null, outcome: value.outcome, receiptDigest: value.receiptDigest as string | null };
}
function transition(prior: Event[], next: Event) {
  const last = prior.at(-1), admitted = prior.find(x => x.type === "ADMITTED");
  const allowed: Record<string, string[]> = {
    CLAIMED: ["ADMITTED", "REJECTED"], ADMITTED: ["RUN_INTENT", "REVOCATION_OBSERVED", "UNCONFIRMED"],
    RUN_INTENT: ["PREPARED", "UNCONFIRMED", "REVOCATION_OBSERVED"], PREPARED: ["RETURN_INTENT", "UNCONFIRMED", "REVOCATION_OBSERVED"],
    RETURN_INTENT: ["CALLER_ACKNOWLEDGED", "REVOCATION_OBSERVED", "UNCONFIRMED"]
  };
  check(allowed[last?.type ?? "CLAIMED"]?.includes(next.type), "LIFECYCLE_TRANSITION_INVALID");
  if (admitted) check(next.activationId === admitted.activationId, "LIFECYCLE_ACTIVATION_CHANGED");
  if (next.type === "CALLER_ACKNOWLEDGED") check(next.receiptDigest === last?.receiptDigest, "ACK_RECEIPT_MISMATCH");
}
const schema = [
  { name: "journal_meta", type: "table", sql: "CREATE TABLE journal_meta (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL) STRICT" },
  { name: "attempts", type: "table", sql: "CREATE TABLE attempts (outer_key TEXT PRIMARY KEY, json TEXT NOT NULL) STRICT, WITHOUT ROWID" },
  { name: "events", type: "table", sql: "CREATE TABLE events (outer_key TEXT NOT NULL, seq INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (outer_key, seq), FOREIGN KEY (outer_key) REFERENCES attempts(outer_key)) STRICT, WITHOUT ROWID" },
  { name: "observations", type: "table", sql: "CREATE TABLE observations (id TEXT PRIMARY KEY, json TEXT NOT NULL) STRICT, WITHOUT ROWID" }
];
for (const table of ["journal_meta", "attempts", "events", "observations"]) for (const op of ["UPDATE", "DELETE"]) {
  const name = table + "_no_" + op.toLowerCase();
  schema.push({ name, type: "trigger", sql: `CREATE TRIGGER ${name} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END` });
}
schema.sort((a, b) => a.name < b.name ? -1 : 1);
function directory(path: unknown): string {
  check(process.platform === "darwin" && process.arch === "arm64", "HOST_UNSUPPORTED");
  check(typeof path === "string" && path.length > 1 && path.length <= 1024 && isAbsolute(path) && normalize(path) === path && realpathSync(path) === path, "DIRECTORY_INVALID");
  const info = lstatSync(path);
  check(info.isDirectory() && info.uid === process.getuid?.() && (info.mode & 0o777) === 0o700 && statfsSync(path).type === 26, "DIRECTORY_NOT_PRIVATE_APFS"); return path;
}
function files(root: string, empty = false) {
  const path = join(root, JOURNAL_FILE), info = lstatSync(path);
  check(info.isFile() && info.nlink === 1 && info.uid === process.getuid?.() && (info.mode & 0o777) === 0o600 && info.size <= MAX_FILE_BYTES && (empty || info.size >= 4096), "JOURNAL_FILE_INVALID");
  if (!empty) { const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { const bytes = Buffer.alloc(16); check(readSync(fd, bytes, 0, 16, 0) === 16 && bytes.toString() === "SQLite format 3\0", "JOURNAL_HEADER_INVALID"); } finally { closeSync(fd); } }
  for (const suffix of ["-wal", "-shm"]) { let side; try { side = lstatSync(path + suffix); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    check(side.isFile() && side.nlink === 1 && side.uid === process.getuid?.() && (side.mode & 0o777) === 0o600 && side.size <= MAX_FILE_BYTES, "JOURNAL_SIDECAR_INVALID"); }
  return { path, dev: info.dev, ino: info.ino };
}
function connect(path: string, readOnly: boolean) {
  const db = new DatabaseSync(path, { readOnly, timeout: 250, allowExtension: false, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false });
  try { db.exec("PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;"); return db; }
  catch (error) { try { db.close(); } catch {} throw error; }
}
// Unsigned content hash only; this is not a signature or custody proof.
function hashedBody(domain: string, body: object) { return JSON.stringify({ ...body, digest: sha("veritas:" + domain + ":v1\0" + JSON.stringify(body)) }); }
function checkedRecord(text: unknown, domain: string, fields: string[]) {
  const row = parse(text); shape(row, [...fields, "digest"]); timestamp(row.createdAt); check(row.clock === clock, "CLOCK_CLASS_INVALID");
  const body = Object.fromEntries(fields.map(field => [field, row[field]]));
  check(hashedBody(domain, body) === text, "RECORD_DIGEST_OR_ENCODING_INVALID"); return row;
}
const headerFields = ["schemaVersion", "journalId", "projectDigest", "attemptId", "outerKey", "ownerSessionId", "binding", "createdAt", "clock"];
const eventFields = ["schemaVersion", "journalId", "projectDigest", "attemptId", "outerKey", "sequence", "priorDigest", "event", "createdAt", "clock"];
const observationFields = ["schemaVersion", "journalId", "projectDigest", "observationId", "outerKey", "attemptId", "observerSessionId", "binding", "kind", "createdAt", "clock"];
type History = { headerText: string; events: string[]; sequence: number; recoveryState: string; returnIntentObserved: boolean; callerAcknowledged: boolean };
type LoadedAttempt = { header: Record<string, unknown>; headerText: string; events: Record<string, unknown>[]; eventTexts: string[]; payloads: Event[] };
function historical(a: LoadedAttempt): History {
  const last = a.payloads.at(-1)?.type;
  const states: Record<string, string> = { ADMITTED: "ADMITTED_NOT_STARTED", REJECTED: "REJECTION_RECORDED", RUN_INTENT: "ACTIVE_OR_INTERRUPTED", PREPARED: "PREPARED_HISTORICAL_ONLY", UNCONFIRMED: "OUTCOME_UNCONFIRMED", REVOCATION_OBSERVED: "REVOCATION_OBSERVED", RETURN_INTENT: "RETURN_ATTEMPTED_ACK_UNKNOWN", CALLER_ACKNOWLEDGED: "CALLER_ACKNOWLEDGED" };
  return { headerText: a.headerText, events: [...a.eventTexts], sequence: a.events.length, recoveryState: last ? states[last] : "CLAIMED_NOT_ADMITTED", returnIntentObserved: a.payloads.some(x => x.type === "RETURN_INTENT"), callerAcknowledged: last === "CALLER_ACKNOWLEDGED" };
}
function load(db: DatabaseSync, projectDigest: string) {
  check(db.prepare("PRAGMA application_id").get()?.application_id === APP_ID && db.prepare("PRAGMA user_version").get()?.user_version === 1 && db.prepare("PRAGMA journal_mode").get()?.journal_mode === "wal" && db.prepare("PRAGMA synchronous").get()?.synchronous === 2, "JOURNAL_VERSION_OR_MODE_INVALID");
  check(JSON.stringify(db.prepare("SELECT name, type, sql FROM sqlite_schema ORDER BY name").all()) === JSON.stringify(schema), "JOURNAL_SCHEMA_INVALID");
  const metaRows = db.prepare("SELECT id, json FROM journal_meta LIMIT 2").all(); check(metaRows.length === 1 && metaRows[0].id === 1, "JOURNAL_META_INVALID");
  const meta = checkedRecord(metaRows[0].json, "activation-journal-meta", ["schemaVersion", "journalVersion", "journalId", "projectDigest", "createdAt", "clock"]);
  check(meta.schemaVersion === 1 && meta.journalVersion === JOURNAL_VERSION && uuid(meta.journalId) && meta.projectDigest === projectDigest, "JOURNAL_PROJECT_INVALID");
  let bytes = 0;
  for (const [table, cap] of [["attempts", MAX_ATTEMPTS], ["events", MAX_EVENTS], ["observations", MAX_OBSERVATIONS]] as const) {
    const size = db.prepare(`SELECT count(*) AS n, coalesce(max(length(CAST(json AS BLOB))),0) AS mx, coalesce(sum(length(CAST(json AS BLOB))),0) AS bytes FROM ${table}`).get();
    check(typeof size?.n === "number" && size.n <= cap && typeof size.mx === "number" && size.mx <= MAX_ROW_BYTES && typeof size.bytes === "number" && Number.isSafeInteger(size.bytes), "JOURNAL_CAPACITY_INVALID"); bytes += size.bytes;
  }
  check(bytes <= MAX_JOURNAL_PAYLOAD_BYTES && db.prepare("PRAGMA quick_check(1)").get()?.quick_check === "ok" && db.prepare("PRAGMA foreign_key_check").all().length === 0, "JOURNAL_INTEGRITY_OR_PAYLOAD_INVALID");
  const attempts = new Map<string, LoadedAttempt>(), ids = new Set<string>();
  const common = (r: Record<string, unknown>) => check(r.schemaVersion === 1 && r.journalId === meta.journalId && r.projectDigest === projectDigest, "RECORD_SCOPE_INVALID");
  for (const row of db.prepare("SELECT outer_key, json FROM attempts ORDER BY outer_key LIMIT 257").all()) {
    const h = checkedRecord(row.json, "activation-journal-attempt", headerFields); common(h);
    check(isSha(h.outerKey) && h.outerKey === row.outer_key && uuid(h.attemptId) && !ids.has(h.attemptId) && uuid(h.ownerSessionId), "ATTEMPT_IDENTITY_INVALID");
    check(JSON.stringify(binding(h.binding)) === JSON.stringify(h.binding), "ATTEMPT_BINDING_INVALID"); ids.add(h.attemptId);
    attempts.set(h.outerKey, { header: h, headerText: row.json as string, events: [], eventTexts: [], payloads: [] });
  }
  for (const row of db.prepare("SELECT outer_key, seq, json FROM events ORDER BY outer_key, seq LIMIT 2049").all()) {
    const e = checkedRecord(row.json, "activation-journal-event", eventFields); common(e); const a = attempts.get(row.outer_key as string);
    check(a && e.outerKey === row.outer_key && e.attemptId === a.header.attemptId && e.sequence === row.seq && row.seq === a.events.length + 1 && a.events.length < MAX_EVENTS_PER_ATTEMPT, "EVENT_SEQUENCE_INVALID");
    check(e.priorDigest === (a.events.at(-1)?.digest ?? a.header.digest), "EVENT_CHAIN_INVALID");
    const next = eventInput(e.event); check(JSON.stringify(next) === JSON.stringify(e.event), "EVENT_ENCODING_INVALID"); transition(a.payloads, next);
    a.events.push(e); a.eventTexts.push(row.json as string); a.payloads.push(next);
  }
  const observationRows = db.prepare("SELECT id, json FROM observations ORDER BY id LIMIT 513").all();
  for (const row of observationRows) {
    const o = checkedRecord(row.json, "activation-journal-observation", observationFields); common(o); const a = attempts.get(o.outerKey as string);
    check(a && uuid(o.observationId) && o.observationId === row.id && o.attemptId === a.header.attemptId && uuid(o.observerSessionId), "OBSERVATION_IDENTITY_INVALID");
    const b = binding(o.binding); check(JSON.stringify(b) === JSON.stringify(o.binding), "OBSERVATION_BINDING_INVALID");
    check(o.kind === (JSON.stringify(b) === JSON.stringify(a.header.binding) ? "REPEAT" : "CONFLICT"), "OBSERVATION_KIND_INVALID");
  }
  return { meta, attempts, bytes, eventCount: [...attempts.values()].reduce((n, a) => n + a.events.length, 0), observationCount: observationRows.length,
    observationRows: observationRows.map(row => ({ id: row.id as string, text: row.json as string })) };
}
function result(status: string, reason: string, history: History | null = null) {
  if (history) { Object.freeze(history.events); Object.freeze(history); }
  return Object.freeze({ journalVersion: JOURNAL_VERSION, status, reason, history, evidenceStatus: "LOCAL_METADATA_ONLY", authorizing: false, executionAllowed: false, modelCallsAllowed: false, networkAllowed: false, promotionAllowed: false, activeBaselineChanged: false, measuredGain: null });
}
type Loaded = ReturnType<typeof load>;
type Operation = (db: DatabaseSync, state: Loaded, commit: () => void) => ReturnType<typeof result>;
function transaction(rootInput: unknown, project: unknown, write: boolean, operation: Operation) {
  let db: DatabaseSync | undefined, committed = false, out = result("ERROR", "JOURNAL_UNAVAILABLE");
  try {
    check(isSha(project), "PROJECT_DIGEST_INVALID"); const root = directory(rootInput), first = files(root); db = connect(first.path, !write); db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    out = operation(db, load(db, project), () => { committed = true; db!.exec("COMMIT"); db!.exec("BEGIN"); });
    const last = files(root); check(last.ino === first.ino && last.dev === first.dev && directory(root) === root, "JOURNAL_PATH_CHANGED");
  } catch (error) { out = result(committed ? "INCONCLUSIVE" : error instanceof Refusal ? "REFUSED" : "ERROR", committed ? "JOURNAL_WRITE_OUTCOME_UNCONFIRMED" : error instanceof Refusal ? error.message : "JOURNAL_UNAVAILABLE"); }
  finally { if (db) { try { if (db.isTransaction) db.exec("ROLLBACK"); } catch { out = result("INCONCLUSIVE", "JOURNAL_ROLLBACK_UNCONFIRMED"); } try { db.close(); } catch { out = result("INCONCLUSIVE", "JOURNAL_CLOSE_UNCONFIRMED"); } } }
  return out;
}
function payloadBudget(state: Loaded, text: string) { check(Buffer.byteLength(text) <= MAX_ROW_BYTES && state.bytes + Buffer.byteLength(text) <= MAX_JOURNAL_PAYLOAD_BYTES, "JOURNAL_PAYLOAD_EXHAUSTED"); }
export function initializeActivationJournal(rootInput: unknown, project: unknown) {
  let db: DatabaseSync | undefined, committed = false, out = result("ERROR", "JOURNAL_INITIALIZATION_FAILED");
  try {
    check(isSha(project), "PROJECT_DIGEST_INVALID"); const root = directory(rootInput); check(readdirSync(root).length === 0, "INITIALIZATION_REQUIRES_EMPTY_DIRECTORY");
    const path = join(root, JOURNAL_FILE), fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); closeSync(fd); files(root, true);
    db = connect(path, false); db.exec("PRAGMA journal_mode=WAL; BEGIN IMMEDIATE;");
    for (const item of schema.filter(x => x.type === "table")) db.exec(item.sql);
    for (const item of schema.filter(x => x.type === "trigger")) db.exec(item.sql);
    db.exec("PRAGMA application_id=" + APP_ID + "; PRAGMA user_version=1;");
    const text = hashedBody("activation-journal-meta", { schemaVersion: 1, journalVersion: JOURNAL_VERSION, journalId: randomUUID(), projectDigest: project, createdAt: new Date().toISOString(), clock });
    db.prepare("INSERT INTO journal_meta(id,json) VALUES(1,?)").run(text); load(db, project);
    committed = true; db.exec("COMMIT"); db.exec("BEGIN"); load(db, project);
    const dirfd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { fsyncSync(dirfd); } finally { closeSync(dirfd); }
    out = result("INITIALIZED", "LOCAL_JOURNAL_INITIALIZED");
  } catch (error) { out = result(committed ? "INCONCLUSIVE" : error instanceof Refusal ? "REFUSED" : "ERROR", committed ? "JOURNAL_INITIALIZATION_UNCONFIRMED" : error instanceof Refusal ? error.message : "JOURNAL_INITIALIZATION_FAILED"); }
  finally { if (db) { try { if (db.isTransaction) db.exec("ROLLBACK"); } catch { out = result("INCONCLUSIVE", "JOURNAL_ROLLBACK_UNCONFIRMED"); } try { db.close(); } catch { out = result("INCONCLUSIVE", "JOURNAL_CLOSE_UNCONFIRMED"); } } }
  return out;
}
export function inspectActivationJournal(root: unknown, project: unknown) { return transaction(root, project, false, () => result("AVAILABLE", "LOCAL_JOURNAL_INSPECTED")); }
export function inspectActivationAttempt(root: unknown, project: unknown, outerKey: unknown) {
  if (!isSha(outerKey)) return result("REFUSED", "OUTER_KEY_INVALID");
  return transaction(root, project, false, (_db, state) => { const a = state.attempts.get(outerKey); return a ? result("HISTORICAL_ONLY", "NO_HANDLE_OR_REEXECUTION", historical(a)) : result("MISSING", "NO_LOCAL_ATTEMPT_OBSERVED"); });
}

export const DIAGNOSTIC_VERSION = "activation-journal-diagnostic-v1";
export const MAX_DIAGNOSTIC_PAGE = 32, MAX_DIAGNOSTIC_BYTES = 192 * 1024;
type DiagnosticPage = Readonly<{
  diagnosticVersion: string; journalId: string; projectDigest: string; outerKey: string; attemptId: string;
  snapshotDigest: string; snapshotScope: "ENTIRE_VALIDATED_JOURNAL_AT_READ_TRANSACTION";
  ordering: "OBSERVATION_UUID_LEXICAL_NOT_CHRONOLOGICAL"; coverage: "OBSERVATION_PAGE_ONLY";
  journalCounts: Readonly<{ attempts: number; events: number; observations: number }>;
  observationCounts: Readonly<{ repeats: number; conflicts: number }>;
  totalObservations: number; pageStart: number; pageLimit: number; observationTexts: ReadonlyArray<string>; nextCursor: string | null;
}>;
const diagnosticResult = (out: ReturnType<typeof result>, page: DiagnosticPage | null = null) => Object.freeze({ ...out, diagnostic: page });
function diagnosticQuery(text: unknown) {
  const value = parse(text); shape(value, ["schemaVersion", "outerKey", "limit", "cursor"]);
  check(value.schemaVersion === 1 && isSha(value.outerKey) && Number.isInteger(value.limit) && (value.limit as number) >= 1 && (value.limit as number) <= MAX_DIAGNOSTIC_PAGE, "DIAGNOSTIC_QUERY_INVALID");
  check(value.cursor === null || (typeof value.cursor === "string" && value.cursor.length > 0 && value.cursor.length <= 2048), "DIAGNOSTIC_CURSOR_BOUND");
  const out = { schemaVersion: 1, outerKey: value.outerKey, limit: value.limit as number, cursor: value.cursor as string | null };
  check(JSON.stringify(out) === text, "DIAGNOSTIC_QUERY_NONCANONICAL"); return out;
}
function diagnosticCursor(text: string) {
  const x = parse(text, 2048); const fields = ["schemaVersion", "diagnosticVersion", "journalId", "projectDigest", "outerKey", "attemptId", "snapshotDigest", "limit", "offset", "afterObservationId"];
  shape(x, fields);
  check(x.schemaVersion === 1 && x.diagnosticVersion === DIAGNOSTIC_VERSION && uuid(x.journalId) && uuid(x.attemptId) && isSha(x.projectDigest) && isSha(x.outerKey) && isSha(x.snapshotDigest) && uuid(x.afterObservationId), "DIAGNOSTIC_CURSOR_INVALID");
  check(Number.isInteger(x.limit) && (x.limit as number) >= 1 && (x.limit as number) <= MAX_DIAGNOSTIC_PAGE && Number.isInteger(x.offset) && (x.offset as number) > 0 && (x.offset as number) < MAX_OBSERVATIONS && (x.offset as number) % (x.limit as number) === 0, "DIAGNOSTIC_CURSOR_POSITION_INVALID");
  check(JSON.stringify(Object.fromEntries(fields.map(field => [field, x[field]]))) === text, "DIAGNOSTIC_CURSOR_NONCANONICAL"); return x;
}
/** Read-only diagnostic page plus full lifecycle history. The cursor is an
 * unsigned consistency locator, NOT a secret/capability or whole-audit proof.
 * UUID order is deterministic pagination, never chronological event order. */
export function diagnoseActivationAttempt(root: unknown, project: unknown, inputText: unknown) {
  let query: ReturnType<typeof diagnosticQuery>;
  try { query = diagnosticQuery(inputText); } catch { return diagnosticResult(result("REFUSED", "DIAGNOSTIC_QUERY_INVALID")); }
  let page: DiagnosticPage | null = null;
  const out = transaction(root, project, false, (_db, state) => {
    const attempt = state.attempts.get(query.outerKey);
    if (!attempt) return result("MISSING", "NO_LOCAL_ATTEMPT_OBSERVED");
    const observations = state.observationRows.filter(row => JSON.parse(row.text).outerKey === query.outerKey);
    const snapshotDigest = sha("veritas:activation-journal-diagnostic-snapshot:v1\0" + JSON.stringify({
      meta: state.meta.digest, attempts: [...state.attempts.values()].map(a => [a.header.digest, ...a.events.map(e => e.digest)]),
      observations: state.observationRows.map(row => [row.id, sha(row.text)])
    }));
    let offset = 0;
    if (query.cursor !== null) {
      const cursor = diagnosticCursor(query.cursor);
      check(cursor.journalId === state.meta.journalId && cursor.projectDigest === project && cursor.outerKey === query.outerKey && cursor.attemptId === attempt.header.attemptId && cursor.limit === query.limit, "DIAGNOSTIC_CURSOR_SCOPE_MISMATCH");
      check(cursor.snapshotDigest === snapshotDigest, "DIAGNOSTIC_CURSOR_STALE");
      offset = cursor.offset as number;
      check(offset < observations.length && observations[offset - 1]?.id === cursor.afterObservationId, "DIAGNOSTIC_CURSOR_POSITION_INVALID");
    }
    const selected = observations.slice(offset, offset + query.limit), nextOffset = offset + selected.length;
    const nextCursor = nextOffset < observations.length ? JSON.stringify({ schemaVersion: 1, diagnosticVersion: DIAGNOSTIC_VERSION, journalId: state.meta.journalId, projectDigest: project, outerKey: query.outerKey, attemptId: attempt.header.attemptId, snapshotDigest, limit: query.limit, offset: nextOffset, afterObservationId: selected.at(-1)!.id }) : null;
    page = Object.freeze({ diagnosticVersion: DIAGNOSTIC_VERSION, journalId: state.meta.journalId as string, projectDigest: project as string, outerKey: query.outerKey, attemptId: attempt.header.attemptId as string,
      snapshotDigest, snapshotScope: "ENTIRE_VALIDATED_JOURNAL_AT_READ_TRANSACTION", ordering: "OBSERVATION_UUID_LEXICAL_NOT_CHRONOLOGICAL", coverage: "OBSERVATION_PAGE_ONLY",
      journalCounts: Object.freeze({ attempts: state.attempts.size, events: state.eventCount, observations: state.observationCount }),
      observationCounts: Object.freeze({ repeats: observations.filter(row => JSON.parse(row.text).kind === "REPEAT").length, conflicts: observations.filter(row => JSON.parse(row.text).kind === "CONFLICT").length }),
      totalObservations: observations.length, pageStart: offset, pageLimit: query.limit,
      observationTexts: Object.freeze(selected.map(row => row.text)), nextCursor });
    const observed = result("HISTORICAL_ONLY", "DIAGNOSTIC_SNAPSHOT_PAGE", historical(attempt));
    check(Buffer.byteLength(JSON.stringify(diagnosticResult(observed, page))) <= MAX_DIAGNOSTIC_BYTES, "DIAGNOSTIC_OUTPUT_BOUND"); return observed;
  });
  // A failed final path/rollback/close check must discard a page built earlier
  // in the transaction. An observed partial page is never a successful read.
  return diagnosticResult(out, out.status === "HISTORICAL_ONLY" && out.reason === "DIAGNOSTIC_SNAPSHOT_PAGE" ? page : null);
}
export function claimActivationAttempt(root: unknown, project: unknown, inputText: unknown) {
  let input: ReturnType<typeof claimInput>; try { input = claimInput(inputText); } catch { return result("REFUSED", "CLAIM_INPUT_INVALID"); }
  return transaction(root, project, true, (db, state, commit) => {
    const prior = state.attempts.get(input.outerKey);
    if (prior) {
      check(state.observationCount < MAX_OBSERVATIONS, "OBSERVATION_CAPACITY_EXHAUSTED");
      const kind = JSON.stringify(prior.header.binding) === JSON.stringify(input.binding) ? "REPEAT" : "CONFLICT", observationId = randomUUID();
      const text = hashedBody("activation-journal-observation", { schemaVersion: 1, journalId: state.meta.journalId, projectDigest: project, observationId, outerKey: input.outerKey, attemptId: prior.header.attemptId, observerSessionId: input.ownerSessionId, binding: input.binding, kind, createdAt: new Date().toISOString(), clock });
      payloadBudget(state, text); db.prepare("INSERT INTO observations(id,json) VALUES(?,?)").run(observationId, text); commit();
      const after = load(db, project as string); check(db.prepare("SELECT json FROM observations WHERE id=?").get(observationId)?.json === text, "OBSERVATION_READBACK_FAILED");
      return result(kind === "REPEAT" ? "HISTORICAL_ONLY" : "CONFLICT", kind === "REPEAT" ? "REPEAT_RECORDED_NO_REEXECUTION" : "OUTER_KEY_CONFLICT_RECORDED", historical(after.attempts.get(input.outerKey)!));
    }
    check(state.attempts.size < MAX_ATTEMPTS, "ATTEMPT_CAPACITY_EXHAUSTED");
    const attemptId = randomUUID(); check(![...state.attempts.values()].some(x => x.header.attemptId === attemptId), "ATTEMPT_ID_COLLISION");
    const text = hashedBody("activation-journal-attempt", { schemaVersion: 1, journalId: state.meta.journalId, projectDigest: project, attemptId, outerKey: input.outerKey, ownerSessionId: input.ownerSessionId, binding: input.binding, createdAt: new Date().toISOString(), clock });
    payloadBudget(state, text); db.prepare("INSERT INTO attempts(outer_key,json) VALUES(?,?)").run(input.outerKey, text); commit();
    const a = load(db, project as string).attempts.get(input.outerKey); check(a?.headerText === text, "ATTEMPT_READBACK_FAILED");
    return result("CREATED", "LOCAL_ATTEMPT_CLAIM_OBSERVED", historical(a));
  });
}
export function appendActivationEvent(root: unknown, project: unknown, inputText: unknown) {
  let input: { outerKey: string; attemptId: string; ownerSessionId: string; expectedSequence: number; event: Event };
  try {
    const x = parse(inputText); shape(x, ["schemaVersion", "outerKey", "attemptId", "ownerSessionId", "expectedSequence", "event"]);
    check(x.schemaVersion === 1 && isSha(x.outerKey) && uuid(x.attemptId) && uuid(x.ownerSessionId) && Number.isInteger(x.expectedSequence) && (x.expectedSequence as number) >= 0 && (x.expectedSequence as number) < MAX_EVENTS_PER_ATTEMPT, "APPEND_INPUT_INVALID");
    const e = eventInput(x.event); check(JSON.stringify({ schemaVersion: 1, outerKey: x.outerKey, attemptId: x.attemptId, ownerSessionId: x.ownerSessionId, expectedSequence: x.expectedSequence, event: e }) === inputText, "APPEND_NONCANONICAL");
    input = { outerKey: x.outerKey, attemptId: x.attemptId, ownerSessionId: x.ownerSessionId, expectedSequence: x.expectedSequence as number, event: e };
  } catch { return result("REFUSED", "APPEND_INPUT_INVALID"); }
  return transaction(root, project, true, (db, state, commit) => {
    const a = state.attempts.get(input.outerKey); check(a && a.header.attemptId === input.attemptId && a.header.ownerSessionId === input.ownerSessionId, "APPEND_OWNER_BINDING_INVALID");
    const existing = a.payloads[input.expectedSequence];
    if (existing) return JSON.stringify(existing) === JSON.stringify(input.event) ? result("REPLAYED", "EXACT_EVENT_ALREADY_RECORDED", historical(a)) : result("CONFLICT", "EVENT_SEQUENCE_CONFLICT", historical(a));
    check(a.events.length === input.expectedSequence && a.events.length < MAX_EVENTS_PER_ATTEMPT && state.eventCount < MAX_EVENTS, "EVENT_SEQUENCE_OR_CAPACITY_REFUSED"); transition(a.payloads, input.event);
    const text = hashedBody("activation-journal-event", { schemaVersion: 1, journalId: state.meta.journalId, projectDigest: project, attemptId: input.attemptId, outerKey: input.outerKey, sequence: input.expectedSequence + 1, priorDigest: a.events.at(-1)?.digest ?? a.header.digest, event: input.event, createdAt: new Date().toISOString(), clock });
    payloadBudget(state, text); db.prepare("INSERT INTO events(outer_key,seq,json) VALUES(?,?,?)").run(input.outerKey, input.expectedSequence + 1, text); commit();
    const after = load(db, project as string).attempts.get(input.outerKey)!; check(after.eventTexts[input.expectedSequence] === text, "EVENT_READBACK_FAILED");
    return result("APPENDED", "LOCAL_EVENT_COMMIT_AND_READBACK", historical(after));
  });
}
