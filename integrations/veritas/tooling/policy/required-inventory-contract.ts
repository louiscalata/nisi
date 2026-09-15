import { createHash } from "node:crypto";

// Private, inert representation only. No production caller and no verdict evaluator.
// Callers supply the expected bindings independently; a matching digest is not
// policy provenance, trusted time, authority, or proof that the policy is complete.
export const REQUIRED_INVENTORY_LIMITS = Object.freeze({ jsonCodeUnits: 65_536, slots: 64, records: 128 });

export type DeclaredEvidenceState = "PASS" | "FAIL" | "NOT_RUN" | "ERROR" | "INCONCLUSIVE" | "UNKNOWN";
export type RequiredInventoryIssue =
  | "EXPECTED_BINDING_INVALID" | "INVENTORY_UNREADABLE" | "INVENTORY_SIZE"
  | "INVENTORY_JSON_INVALID" | "INVENTORY_SHAPE_INVALID" | "INVENTORY_NONCANONICAL"
  | "INVENTORY_EMPTY" | "INVENTORY_SLOT_INVALID" | "INVENTORY_DUPLICATE"
  | "INVENTORY_REORDERED" | "INVENTORY_POLICY_MISMATCH" | "INVENTORY_DIGEST_MISMATCH"
  | "EVIDENCE_UNREADABLE" | "EVIDENCE_SIZE" | "EVIDENCE_JSON_INVALID"
  | "EVIDENCE_SHAPE_INVALID" | "EVIDENCE_NONCANONICAL" | "EVIDENCE_DUPLICATE"
  | "EVIDENCE_EXTRA" | "EVIDENCE_REORDERED" | "EVIDENCE_MISSING"
  | "EVIDENCE_SUBJECT_MISMATCH" | "EVIDENCE_POLICY_MISMATCH"
  | "EVIDENCE_PARTICIPATION_CONTRADICTION" | "EVIDENCE_PARTICIPATION_MISSING"
  | "EVIDENCE_NONPASS";

export type DeclaredSlot = Readonly<{
  slotId: string;
  // Reported state is data, not a verified check. Missing/ambiguous data has no
  // reported state and is explicitly NOT_RUN/UNKNOWN in the represented state.
  reportedState: DeclaredEvidenceState | null;
  state: DeclaredEvidenceState;
  participated: boolean;
  issues: readonly RequiredInventoryIssue[];
}>;

export type InertRequiredInventoryV1 = Readonly<{
  schemaVersion: 1;
  kind: "INERT_REQUIRED_INVENTORY";
  contractStatus: "ACCOUNTED" | "INPUT_REFUSED";
  verdict: "NOT_EVALUATED";
  subjectDigest: string | null;
  policyDigest: string | null;
  expectedInventoryDigest: string | null;
  observedInventoryDigest: string | null;
  inventoryState: "BOUND_DECLARATION" | "UNREADABLE" | "INVALID";
  issues: readonly Readonly<{ code: RequiredInventoryIssue; slotId: string | null }>[];
  slots: readonly DeclaredSlot[];
  remainingObligations: readonly string[];
  authoritative: false;
  mayAccept: false;
  mayCertify: false;
  mayExecute: false;
  mayPublish: false;
  mayRepair: false;
  mayPromote: false;
}>;

type Inventory = { policyDigest: string; requiredSlots: string[]; schemaVersion: 1 };
type RecordV1 = { participated: boolean; policyDigest: string; slotId: string; status: DeclaredEvidenceState; subjectDigest: string };
const states: readonly string[] = ["PASS", "FAIL", "NOT_RUN", "ERROR", "INCONCLUSIVE", "UNKNOWN"];
const digestPattern = /^[a-f0-9]{64}$/;
// Absolute end assertion: JavaScript '$' alone also matches before a final LF.
const slotPattern = /^[a-z][a-z0-9_.-]{0,63}(?![\s\S])/;
const obligations = Object.freeze([
  "POLICY_PROVENANCE_AND_COMPLETENESS", "PROFILE_AND_INVARIANT_BINDING",
  "POSITIVE_GAP_CURRENTNESS", "ISSUER_ADAPTER_RUNTIME_AUTHORITY", "EVIDENCE_ROOT_BINDING",
  "DEPENDENCY_DESTINATION_BINDING", "TIME_FRESHNESS_REVOCATION", "PRODUCTION_INTEGRATION",
]);

function isDigest(value: unknown): value is string {
  return typeof value === "string" && value.length === 64 && digestPattern.test(value);
}

function hasKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const found = Object.keys(value).sort();
  return found.length === keys.length && found.every((key, index) => key === keys[index]);
}

function parse(input: string | null, label: "INVENTORY" | "EVIDENCE"):
  { value: unknown; issue: null } | { value: null; issue: RequiredInventoryIssue } {
  if (typeof input !== "string") return { value: null, issue: `${label}_UNREADABLE` };
  // Bound before parsing. No recursive traversal/canonicalizer processes arbitrary
  // input. Accepted fields are ASCII; canonical reconstruction follows validation.
  if (input.length === 0 || input.length > REQUIRED_INVENTORY_LIMITS.jsonCodeUnits) {
    return { value: null, issue: `${label}_SIZE` };
  }
  try { return { value: JSON.parse(input) as unknown, issue: null }; }
  catch { return { value: null, issue: `${label}_JSON_INVALID` }; }
}

function canonicalInventory(value: Inventory): string {
  return JSON.stringify({ policyDigest: value.policyDigest, requiredSlots: value.requiredSlots, schemaVersion: 1 });
}

function canonicalEvidence(records: readonly RecordV1[]): string {
  return JSON.stringify({ records: records.map(record => ({
    participated: record.participated, policyDigest: record.policyDigest, slotId: record.slotId,
    status: record.status, subjectDigest: record.subjectDigest,
  })), schemaVersion: 1 });
}

/**
 * Account for a bounded, independently supplied required inventory and declared
 * evidence. Input is canonical JSON text, not a general JSON/UTF-8 file loader.
 * Null means unavailable to this caller, not proof of an actual storage outage.
 * Always returns NOT_EVALUATED with every authority flag false, even if every
 * reported state is PASS. It does not replace evaluateCertificationPolicy.
 */
export function representRequiredInventoryV1(
  expectedSubjectDigest: string,
  expectedPolicyDigest: string,
  expectedInventoryDigest: string,
  inventoryJSON: string | null,
  evidenceJSON: string | null,
): InertRequiredInventoryV1 {
  const issues: Array<Readonly<{ code: RequiredInventoryIssue; slotId: string | null }>> = [];
  let slots: DeclaredSlot[] = [];
  let inventoryState: InertRequiredInventoryV1["inventoryState"] = "INVALID";
  let observedInventoryDigest: string | null = null;
  const add = (code: RequiredInventoryIssue, slotId: string | null = null) => {
    issues.push(Object.freeze({ code, slotId }));
  };
  const finish = (contractStatus: InertRequiredInventoryV1["contractStatus"]): InertRequiredInventoryV1 => Object.freeze({
    schemaVersion: 1, kind: "INERT_REQUIRED_INVENTORY", contractStatus, verdict: "NOT_EVALUATED",
    subjectDigest: isDigest(expectedSubjectDigest) ? expectedSubjectDigest : null,
    policyDigest: isDigest(expectedPolicyDigest) ? expectedPolicyDigest : null,
    expectedInventoryDigest: isDigest(expectedInventoryDigest) ? expectedInventoryDigest : null,
    observedInventoryDigest, inventoryState, issues: Object.freeze(issues), slots: Object.freeze(slots),
    remainingObligations: obligations, authoritative: false, mayAccept: false, mayCertify: false,
    mayExecute: false, mayPublish: false, mayRepair: false, mayPromote: false,
  });
  const refuse = (code: RequiredInventoryIssue) => { add(code); return finish("INPUT_REFUSED"); };
  if (![expectedSubjectDigest, expectedPolicyDigest, expectedInventoryDigest].every(isDigest)) {
    return refuse("EXPECTED_BINDING_INVALID");
  }
  const parsedInventory = parse(inventoryJSON, "INVENTORY");
  if (parsedInventory.issue !== null) {
    if (parsedInventory.issue === "INVENTORY_UNREADABLE") inventoryState = "UNREADABLE";
    return refuse(parsedInventory.issue);
  }
  const inventory = parsedInventory.value;
  if (!hasKeys(inventory, ["policyDigest", "requiredSlots", "schemaVersion"]) || inventory.schemaVersion !== 1 ||
      !isDigest(inventory.policyDigest) || !Array.isArray(inventory.requiredSlots) ||
      inventory.requiredSlots.length > REQUIRED_INVENTORY_LIMITS.slots) return refuse("INVENTORY_SHAPE_INVALID");
  if (inventory.requiredSlots.length === 0) return refuse("INVENTORY_EMPTY");
  if (!inventory.requiredSlots.every(slot => typeof slot === "string" && slot.length <= 64 && slotPattern.test(slot))) {
    return refuse("INVENTORY_SLOT_INVALID");
  }
  const required = inventory.requiredSlots as string[];
  if (new Set(required).size !== required.length) return refuse("INVENTORY_DUPLICATE");
  if (required.some((slot, index) => index > 0 && required[index - 1]! >= slot)) return refuse("INVENTORY_REORDERED");
  if (canonicalInventory(inventory as Inventory) !== inventoryJSON) return refuse("INVENTORY_NONCANONICAL");
  observedInventoryDigest = createHash("sha256").update("veritas/inert-required-inventory-v1\0").update(inventoryJSON!).digest("hex");
  if (inventory.policyDigest !== expectedPolicyDigest) return refuse("INVENTORY_POLICY_MISMATCH");
  if (observedInventoryDigest !== expectedInventoryDigest) return refuse("INVENTORY_DIGEST_MISMATCH");
  inventoryState = "BOUND_DECLARATION";
  const unrun = (slotId: string, code: RequiredInventoryIssue): DeclaredSlot => Object.freeze({
    slotId, reportedState: null, state: "NOT_RUN", participated: false, issues: Object.freeze([code]),
  });
  // Once the independently bound set is known, every early refusal still accounts
  // for all its slots. Evidence never supplies the required denominator.
  slots = required.map(slotId => unrun(slotId, "EVIDENCE_MISSING"));
  const refuseEvidence = (code: RequiredInventoryIssue) => {
    slots = required.map(slotId => unrun(slotId, code));
    return refuse(code);
  };
  const parsedEvidence = parse(evidenceJSON, "EVIDENCE");
  if (parsedEvidence.issue !== null) return refuseEvidence(parsedEvidence.issue);
  const envelope = parsedEvidence.value;
  if (!hasKeys(envelope, ["records", "schemaVersion"]) || envelope.schemaVersion !== 1 ||
      !Array.isArray(envelope.records) || envelope.records.length > REQUIRED_INVENTORY_LIMITS.records) {
    return refuseEvidence("EVIDENCE_SHAPE_INVALID");
  }
  if (!envelope.records.every(record =>
    hasKeys(record, ["participated", "policyDigest", "slotId", "status", "subjectDigest"]) &&
    typeof record.participated === "boolean" && isDigest(record.policyDigest) && isDigest(record.subjectDigest) &&
    typeof record.slotId === "string" && record.slotId.length <= 64 && slotPattern.test(record.slotId) &&
    typeof record.status === "string" && states.includes(record.status))) return refuseEvidence("EVIDENCE_SHAPE_INVALID");
  const records = envelope.records as RecordV1[];
  if (canonicalEvidence(records) !== evidenceJSON) return refuseEvidence("EVIDENCE_NONCANONICAL");
  const bySlot = new Map<string, RecordV1[]>();
  let invalid = false;
  let previousId: string | null = null;
  for (const record of records) {
    if (!required.includes(record.slotId)) { add("EVIDENCE_EXTRA", record.slotId); invalid = true; }
    if (previousId !== null && previousId > record.slotId) { add("EVIDENCE_REORDERED", record.slotId); invalid = true; }
    previousId = record.slotId;
    const group = bySlot.get(record.slotId) ?? [];
    group.push(record);
    bySlot.set(record.slotId, group);
  }
  slots = required.map(slotId => {
    const group = bySlot.get(slotId) ?? [];
    if (group.length === 0) { add("EVIDENCE_MISSING", slotId); return unrun(slotId, "EVIDENCE_MISSING"); }
    if (group.length !== 1) {
      add("EVIDENCE_DUPLICATE", slotId); invalid = true;
      return Object.freeze({ slotId, reportedState: null, state: "UNKNOWN", participated: false, issues: Object.freeze(["EVIDENCE_DUPLICATE"] as const) });
    }
    const record = group[0]!;
    const slotIssues: RequiredInventoryIssue[] = [];
    const mark = (code: RequiredInventoryIssue, malformed = false) => {
      slotIssues.push(code); add(code, slotId); invalid ||= malformed;
    };
    if (record.subjectDigest !== expectedSubjectDigest) mark("EVIDENCE_SUBJECT_MISMATCH", true);
    if (record.policyDigest !== expectedPolicyDigest) mark("EVIDENCE_POLICY_MISMATCH", true);
    if (["NOT_RUN", "UNKNOWN"].includes(record.status) && record.participated) mark("EVIDENCE_PARTICIPATION_CONTRADICTION", true);
    if (record.status === "PASS" && !record.participated) mark("EVIDENCE_PARTICIPATION_MISSING");
    if (record.status !== "PASS") mark("EVIDENCE_NONPASS");
    return Object.freeze({ slotId, reportedState: record.status, state: record.status, participated: record.participated, issues: Object.freeze(slotIssues) });
  });
  return finish(invalid ? "INPUT_REFUSED" : "ACCOUNTED");
}
