import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createActivationImprovementOwner, measureActivationRuntime, MAX_SOURCE_BYTES } from "./activation-owner.ts";
import { MAX_INPUT_CODE_UNITS, planActivationImprovement } from "./activation-improvement.ts";
import { JOURNAL_VERSION, appendActivationEvent, claimActivationAttempt, inspectActivationAttempt, inspectActivationJournal, diagnoseActivationAttempt } from "./activation-journal.ts";

export const JOURNALED_OWNER_VERSION = "journaled-activation-owner-v1";
const directory = dirname(fileURLToPath(import.meta.url));
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const sha = (x: unknown): x is string => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
function requireThat(value: unknown, reason: string): asserts value { if (!value) throw new Error(reason); }
function shape(value: unknown, names: string[]): asserts value is Record<string, unknown> {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), "SHAPE_INVALID");
  requireThat(Object.keys(value).sort().join("\0") === [...names].sort().join("\0"), "SHAPE_INVALID");
}
/** A measurement, never approval. Adds the journal/adapter source identities to
 * the independently measured four-file core without changing that core API. */
export function measureJournaledActivationRuntime() {
  const core = measureActivationRuntime();
  const extra = ["activation-journal.ts", "journaled-activation-owner.ts"].map(name => {
    const path = join(directory, name), fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(fd, { bigint: true });
      requireThat(before.isFile() && before.nlink === 1n && before.uid === BigInt(process.getuid!()) && (before.mode & 0o022n) === 0n && before.size > 0n && before.size <= BigInt(MAX_SOURCE_BYTES), "ADAPTER_SOURCE_REFUSED");
      const bytes = Buffer.alloc(Number(before.size) + 1); let used = 0, n: number;
      while (used < bytes.length && (n = readSync(fd, bytes, used, bytes.length - used, used)) > 0) used += n;
      const after = fstatSync(fd, { bigint: true }), named = lstatSync(path, { bigint: true });
      for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs", "mode", "nlink", "uid"] as const) requireThat(before[key] === after[key] && after[key] === named[key], "ADAPTER_SOURCE_CHANGED");
      requireThat(used === Number(before.size), "ADAPTER_SOURCE_CHANGED"); return { name, bytes: used, sha256: hash(bytes.subarray(0, used)) };
    } finally { closeSync(fd); }
  });
  const entries = [...core.entries, ...extra].sort((a, b) => a.name < b.name ? -1 : 1);
  return Object.freeze({ digest: hash("veritas:journaled-activation-runtime:v1\0" + JSON.stringify(entries)), coreDigest: core.digest, entries, authorizing: false });
}
type Base = ReturnType<typeof createActivationImprovementOwner>;
type BaseTicket = NonNullable<ReturnType<Base["begin"]>["ticket"]>;
type JournalResult = ReturnType<typeof appendActivationEvent>;
type Token = Readonly<{ attemptId: string }>;
type State = {
  outerKey: string; attemptId: string; activationId: string; baseHandle: BaseTicket;
  sequence: number; terminal: boolean; revoked: boolean; consumed: boolean;
  baseTicket: BaseTicket | null; history: JournalResult["history"];
  runPromise: Promise<ReturnType<typeof finish>> | null; receiptDigest: string | null;
};
function finish(status: string, reason: string, journalStatus: "RECORDED" | "HISTORICAL" | "NOT_RECORDED" | "UNCONFIRMED", ticket: Token | null = null, receiptText: string | null = null, history: JournalResult["history"] = null, acknowledgment: Token | null = null) {
  return Object.freeze({ ownerVersion: JOURNALED_OWNER_VERSION, status, reason, journalStatus, ticket, acknowledgment, receiptText, history,
    measuredGain: null, authorizing: false, executionAllowed: false, modelCallsAllowed: false, networkAllowed: false, promotionAllowed: false, activeBaselineChanged: false,
    recoveryAuthority: "HISTORICAL_ONLY_NO_RESUME_OR_HANDLE_RECONSTRUCTION" });
}

/** Trusted private bootstrap only. Synchronous local journal I/O is not a hard
 * deadline. No launcher, raw-input logging, migration, automatic retry or resume. */
export function createJournaledActivationOwner(optionsText: unknown) {
  requireThat(typeof optionsText === "string" && optionsText.length <= 8192, "OPTIONS_BOUND_INVALID");
  const options = JSON.parse(optionsText);
  shape(options, ["schemaVersion", "projectDigest", "storeDirectory", "ownerDirectory", "journalDirectory", "expectedAdapterDigest", "deadlineMs"]);
  requireThat(options.schemaVersion === 1 && sha(options.projectDigest) && sha(options.expectedAdapterDigest) && JSON.stringify(options) === optionsText, "OPTIONS_INVALID");
  requireThat(typeof options.journalDirectory === "string" && options.journalDirectory.length <= 1024 && realpathSync(options.journalDirectory) === options.journalDirectory, "JOURNAL_DIRECTORY_INVALID");
  const measured = measureJournaledActivationRuntime(); requireThat(measured.digest === options.expectedAdapterDigest, "EXPECTED_ADAPTER_SOURCE_MISMATCH");
  requireThat(inspectActivationJournal(options.journalDirectory, options.projectDigest).status === "AVAILABLE", "JOURNAL_NOT_AVAILABLE");
  const base = createActivationImprovementOwner(JSON.stringify({ schemaVersion: 1, projectDigest: options.projectDigest, storeDirectory: options.storeDirectory, ownerDirectory: options.ownerDirectory, expectedRuntimeDigest: measured.coreDigest, deadlineMs: options.deadlineMs }));
  const project = options.projectDigest, journal = options.journalDirectory, ownerSessionId = randomUUID();
  // Transient owner/runtime-copy directories and session IDs deliberately do not
  // enter this stable comparison frame. Their observed core binding remains in
  // the underlying receipt; source, policy and valid template must still match.
  const policyDigest = hash("veritas:activation-journal-policy:v1\0" + JSON.stringify({ schemaVersion: 1, ownerVersion: JOURNALED_OWNER_VERSION, journalVersion: JOURNAL_VERSION, projectDigest: project, sourceDigest: measured.digest, storeDirectory: options.storeDirectory, journalDirectory: journal, deadlineMs: options.deadlineMs, nodeExecutable: realpathSync(process.execPath), nodeVersion: process.version, platform: process.platform, arch: process.arch }));
  let broken = false;
  let shutdown: ReturnType<Base["off"]> | null = null;
  const states = new Map<Token, State>(), deliveryTickets = new WeakMap<Token, State>(), acknowledgments = new WeakMap<Token, State>();
  const known = (token: unknown) => typeof token === "object" && token !== null ? states.get(token as Token) : undefined;
  const guarded = () => !broken && measureJournaledActivationRuntime().digest === measured.digest;
  const stopOnJournalFailure = () => {
    if (!shutdown) {
      broken = true;
      for (const state of states.values()) { state.revoked = true; state.baseTicket = null; }
      shutdown = base.off(); // All failure callers await this same kill-and-join.
    }
    return shutdown;
  };
  function binding(templateText: unknown) {
    let templateDigest: string | null = null;
    try {
      requireThat(typeof templateText === "string" && templateText.length <= MAX_INPUT_CODE_UNITS, "TEMPLATE_BOUND"); const t = JSON.parse(templateText);
      shape(t, ["schemaVersion", "mode", "environmentDigest", "baselineDigest", "heldoutDigest", "baselineHealth", "budget", "feedback"]);
      requireThat(JSON.stringify(t) === templateText, "TEMPLATE_ENCODING");
      const plan = planActivationImprovement(JSON.stringify({ schemaVersion: t.schemaVersion, activationId: "00000000-0000-4000-8000-000000000000", mode: t.mode, projectDigest: project, environmentDigest: t.environmentDigest, baselineDigest: t.baselineDigest, heldoutDigest: t.heldoutDigest, baselineHealth: t.baselineHealth, budget: t.budget, feedback: t.feedback }));
      requireThat(plan.status !== "ERROR", "TEMPLATE_INVALID"); templateDigest = hash(templateText);
    } catch { /* No raw invalid text, not even its digest, is retained. */ }
    return { sourceDigest: measured.digest, policyDigest, templateDigest, templateKind: templateDigest ? "VALID_METADATA" : "INVALID_UNIDENTIFIED" };
  }
  function append(state: State, type: string, outcome: string, receiptDigest: string | null = null) {
    const result = appendActivationEvent(journal, project, JSON.stringify({ schemaVersion: 1, outerKey: state.outerKey, attemptId: state.attemptId, ownerSessionId, expectedSequence: state.sequence, event: { type, activationId: type === "REJECTED" ? null : state.activationId, outcome, receiptDigest } }));
    if (["APPENDED", "REPLAYED"].includes(result.status) && result.history) { state.sequence = result.history.sequence; state.history = result.history; return true; }
    void stopOnJournalFailure(); return false;
  }
  const unknownJournal = () => finish("INCONCLUSIVE", "JOURNAL_OUTCOME_UNCONFIRMED_NO_RETRY", "UNCONFIRMED");
  async function revoke(closed: boolean) {
    const stopping = closed ? base.close() : base.off(); // revoke synchronously first
    for (const state of states.values()) { state.revoked = true; state.baseTicket = null; }
    await stopping;
    let logged = !broken;
    for (const state of states.values()) if (!state.terminal) {
      if (!broken) logged = append(state, "REVOCATION_OBSERVED", "REVOKED") && logged;
      state.terminal = true;
    }
    return logged ? finish("STOPPED", closed ? "OWNER_CLOSED" : "OWNER_OFF", "RECORDED") : unknownJournal();
  }
  return Object.freeze({
    async enable() { try { if (!guarded()) throw new Error(); const out = base.enable(); return finish(out.status, out.reason, "NOT_RECORDED"); } catch { await stopOnJournalFailure(); return unknownJournal(); } },
    off: () => revoke(false), close: () => revoke(true),
    inspect() { return Object.freeze({ ...base.inspect(), journalVersion: JOURNAL_VERSION, journalBroken: broken, ownerSessionId, adapterDigest: measured.digest, policyDigest, rejectedAttemptLedger: "VALID_OUTER_KEY_ONLY_NO_RAW_INVALID_INPUT", recovery: "HISTORICAL_ONLY_NO_RESUME" }); },
    diagnose: (inputText: unknown) => diagnoseActivationAttempt(journal, project, inputText),
    recover(outerKey: unknown) {
      const observed = inspectActivationAttempt(journal, project, outerKey);
      return observed.status === "HISTORICAL_ONLY" ? finish("HISTORICAL_ONLY", "NO_RESUME_OR_DELIVERY", "HISTORICAL", null, null, observed.history)
        : finish(observed.status, observed.reason, ["MISSING", "REFUSED"].includes(observed.status) ? "NOT_RECORDED" : "UNCONFIRMED");
    },
    async begin(outerKey: unknown, templateText: unknown) {
      if (!sha(outerKey)) return finish("REJECTED_UNJOURNALED", "NO_VALID_OUTER_KEY", "NOT_RECORDED");
      try { requireThat(guarded(), "ADAPTER_SOURCE_CHANGED"); } catch { await stopOnJournalFailure(); return unknownJournal(); }
      const bound = binding(templateText);
      const claim = claimActivationAttempt(journal, project, JSON.stringify({ schemaVersion: 1, outerKey, ownerSessionId, binding: bound }));
      if (["HISTORICAL_ONLY", "CONFLICT"].includes(claim.status)) return finish(claim.status, bound.templateKind === "INVALID_UNIDENTIFIED" ? "HISTORICAL_REJECTION_CLASS_NOT_RAW_INPUT_IDENTITY" : claim.reason, "RECORDED", null, null, claim.history);
      if (claim.status !== "CREATED" || !claim.history) { await stopOnJournalFailure(); return unknownJournal(); }
      const header = JSON.parse(claim.history.headerText), admitted = base.begin(templateText);
      const state: State = { outerKey, attemptId: header.attemptId, activationId: admitted.ticket?.activationId ?? "00000000-0000-4000-8000-000000000000", baseHandle: admitted.ticket!, sequence: 0, terminal: false, revoked: false, consumed: false, baseTicket: null, history: claim.history, runPromise: null, receiptDigest: null };
      if (admitted.status !== "ADMITTED" || !admitted.ticket) {
        if (!append(state, "REJECTED", "REFUSED")) { await stopOnJournalFailure(); return unknownJournal(); }
        return finish("REFUSED", admitted.reason, "RECORDED", null, null, state.history);
      }
      if (!append(state, "ADMITTED", "ADMITTED")) { await stopOnJournalFailure(); return unknownJournal(); }
      const token = Object.freeze({ attemptId: state.attemptId }); states.set(token, state);
      return finish("ADMITTED", "JOURNALED_LOCAL_INVOCATION", "RECORDED", token, null, state.history);
    },
    run(token: unknown): Promise<ReturnType<typeof finish>> {
      const state = known(token);
      if (!state) return Promise.resolve(finish("REFUSED", "UNKNOWN_INVOCATION", "NOT_RECORDED"));
      // A cached promise is deduplication for current RUNNING work only. Never
      // re-expose a prepared token after revocation, consumption or completion.
      if (broken) return stopOnJournalFailure().then(unknownJournal);
      if (state.terminal || state.revoked || state.consumed) return Promise.resolve(finish("REFUSED", "INVOCATION_NOT_CURRENT", "RECORDED"));
      try { requireThat(guarded(), "ADAPTER_SOURCE_CHANGED"); } catch { return stopOnJournalFailure().then(unknownJournal); }
      if (state.baseTicket) return Promise.resolve(finish("REFUSED", "PREPARED_TICKET_ALREADY_ISSUED", "RECORDED"));
      if (state.runPromise) return state.runPromise;
      state.runPromise = (async () => {
        try { requireThat(guarded(), "ADAPTER_SOURCE_CHANGED"); } catch { await stopOnJournalFailure(); return unknownJournal(); }
        if (!append(state, "RUN_INTENT", "PENDING")) { await stopOnJournalFailure(); return unknownJournal(); }
        const observed = await base.run(state.baseHandle);
        if (broken) return unknownJournal();
        const revoked = state.revoked || ["REVOKED", "CANCELLED", "TIMED_OUT"].includes(observed.status);
        if (revoked) {
          const code = ["CANCELLED", "TIMED_OUT"].includes(observed.status) ? observed.status : "REVOKED";
          if (!state.terminal && !append(state, "REVOCATION_OBSERVED", code)) { await stopOnJournalFailure(); return unknownJournal(); } state.terminal = true;
          return finish(code, "NO_PENDING_DELIVERY", "RECORDED", null, null, state.history);
        }
        if (observed.status !== "PREPARED" || !observed.ticket) {
          const code = ["ERROR", "REFUSED", "INCONCLUSIVE", "CONFLICT", "BUSY"].includes(observed.status) ? observed.status : "INCONCLUSIVE";
          if (!append(state, "UNCONFIRMED", code)) { await stopOnJournalFailure(); return unknownJournal(); } state.terminal = true;
          return finish(code, "BASE_RESULT_WITHOUT_DELIVERY", "RECORDED", null, null, state.history);
        }
        if (!append(state, "PREPARED", "PREPARED")) { await stopOnJournalFailure(); return unknownJournal(); }
        state.baseTicket = observed.ticket; const ticket = Object.freeze({ attemptId: state.attemptId }); deliveryTickets.set(ticket, state);
        return finish("PREPARED", "ONE_USE_DELIVERY_REQUIRED", "RECORDED", ticket, null, state.history);
      })();
      return state.runPromise;
    },
    async takeResult(ticket: unknown) {
      const state = typeof ticket === "object" && ticket !== null ? deliveryTickets.get(ticket as Token) : undefined;
      if (!state || state.consumed || state.revoked || state.terminal || broken || !state.baseTicket) return finish("REFUSED", "DELIVERY_NOT_CURRENT", broken ? "UNCONFIRMED" : "NOT_RECORDED");
      state.consumed = true;
      try { requireThat(guarded(), "ADAPTER_SOURCE_CHANGED"); } catch { await stopOnJournalFailure(); return unknownJournal(); }
      const observed = base.takeResult(state.baseTicket); state.baseTicket = null;
      if (observed.status !== "DELIVERED_LOCAL_METADATA" || !observed.receiptText) {
        const revoked = ["REVOKED", "CANCELLED", "TIMED_OUT"].includes(observed.status);
        if (!append(state, revoked ? "REVOCATION_OBSERVED" : "UNCONFIRMED", revoked ? observed.status : "INCONCLUSIVE")) { await stopOnJournalFailure(); return unknownJournal(); } state.terminal = true;
        return finish(observed.status, "BASE_REFUSED_FINAL_DELIVERY", "RECORDED", null, null, state.history);
      }
      state.receiptDigest = JSON.parse(observed.receiptText).receiptDigest;
      if (!append(state, "RETURN_INTENT", "RETURN_ATTEMPTED_ACK_UNKNOWN", state.receiptDigest)) { await stopOnJournalFailure(); return unknownJournal(); }
      // Reuse never spawns: the underlying handle already has a completed promise.
      // Its public run guard rechecks its actual deadline/generation after journal I/O.
      const stillCurrent = await base.run(state.baseHandle);
      if (broken) return unknownJournal();
      try { requireThat(guarded(), "ADAPTER_SOURCE_CHANGED"); } catch { await stopOnJournalFailure(); return unknownJournal(); }
      if (state.revoked || stillCurrent.status !== "PREPARED" || base.inspect().mode !== "ON") {
        if (!state.terminal && !append(state, "REVOCATION_OBSERVED", ["CANCELLED", "TIMED_OUT"].includes(stillCurrent.status) ? stillCurrent.status : "REVOKED")) { await stopOnJournalFailure(); return unknownJournal(); } state.terminal = true;
        return finish("REVOKED", "RETURN_INTENT_IS_NOT_DELIVERY", "RECORDED", null, null, state.history);
      }
      const acknowledgment = Object.freeze({ attemptId: state.attemptId }); acknowledgments.set(acknowledgment, state);
      return finish("RETURNED_LOCAL_METADATA", "CALLER_ACKNOWLEDGMENT_NOT_YET_OBSERVED", "RECORDED", null, observed.receiptText, state.history, acknowledgment);
    },
    async acknowledge(token: unknown) {
      const state = typeof token === "object" && token !== null ? acknowledgments.get(token as Token) : undefined;
      if (!state || state.terminal || state.revoked || broken || !state.receiptDigest) return finish("REFUSED", "ACKNOWLEDGMENT_NOT_CURRENT", broken ? "UNCONFIRMED" : "NOT_RECORDED");
      try { requireThat(guarded(), "ADAPTER_SOURCE_CHANGED"); } catch { await stopOnJournalFailure(); return unknownJournal(); }
      acknowledgments.delete(token as Token);
      if (!append(state, "CALLER_ACKNOWLEDGED", "CALLER_ACKNOWLEDGED", state.receiptDigest)) { await stopOnJournalFailure(); return unknownJournal(); } state.terminal = true;
      return finish("CALLER_ACKNOWLEDGED", "CALLER_SIGNAL_NOT_PROOF_OF_HUMAN_RECEIPT_OR_GAIN", "RECORDED", null, null, state.history);
    },
    async cancel(token: unknown) {
      const state = known(token); if (!state) return finish("REFUSED", "UNKNOWN_INVOCATION", "NOT_RECORDED");
      state.revoked = true; state.baseTicket = null; const stopping = base.cancel(state.baseHandle); await stopping;
      if (broken) return unknownJournal();
      if (!state.terminal && !append(state, "REVOCATION_OBSERVED", "CANCELLED")) { await stopOnJournalFailure(); return unknownJournal(); } state.terminal = true;
      return finish("CANCELLED", "BASE_CANCELLED_BEFORE_JOURNAL", "RECORDED", null, null, state.history);
    }
  });
}
