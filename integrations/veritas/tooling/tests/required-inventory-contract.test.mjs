import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { representRequiredInventoryV1, REQUIRED_INVENTORY_LIMITS } from "../policy/required-inventory-contract.ts";

// Synthetic fixtures only. These expected bindings do not come from the evidence.
const SUBJECT = "a".repeat(64);
const POLICY = "b".repeat(64);
const OTHER = "c".repeat(64);
const slots = ["gate.json", "test.unit"];
const canonical = value => JSON.stringify(value, function (_key, item) {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  }
  return item;
});
const digest = text => createHash("sha256").update("veritas/inert-required-inventory-v1\0").update(text).digest("hex");
const inventory = (requiredSlots = slots, policyDigest = POLICY) => ({ schemaVersion: 1, policyDigest, requiredSlots });
const record = (slotId, status = "PASS", participated = true) => ({ slotId, status, participated, subjectDigest: SUBJECT, policyDigest: POLICY });
const evidence = records => ({ schemaVersion: 1, records });
const invoke = (inv = inventory(), records = slots.map(id => record(id)), overrides = {}) => {
  const inventoryJSON = canonical(inv);
  const input = {
    subject: SUBJECT, policy: POLICY, inventoryDigest: digest(inventoryJSON),
    inventoryJSON, evidenceJSON: canonical(evidence(records)), ...overrides,
  };
  return representRequiredInventoryV1(input.subject, input.policy, input.inventoryDigest, input.inventoryJSON, input.evidenceJSON);
};
const issueCodes = result => result.issues.map(issue => issue.code);
const assertInert = result => {
  assert.equal(result.verdict, "NOT_EVALUATED");
  for (const key of ["authoritative", "mayAccept", "mayCertify", "mayExecute", "mayPublish", "mayRepair", "mayPromote"]) assert.equal(result[key], false, key);
  assert.deepEqual(result.remainingObligations, [
    "POLICY_PROVENANCE_AND_COMPLETENESS", "PROFILE_AND_INVARIANT_BINDING", "POSITIVE_GAP_CURRENTNESS",
    "ISSUER_ADAPTER_RUNTIME_AUTHORITY", "EVIDENCE_ROOT_BINDING", "DEPENDENCY_DESTINATION_BINDING",
    "TIME_FRESHNESS_REVOCATION", "PRODUCTION_INTEGRATION",
  ]);
};
const refuses = (result, code, expectedSlots = []) => {
  assert.equal(result.contractStatus, "INPUT_REFUSED");
  assert.ok(issueCodes(result).includes(code), JSON.stringify(result.issues));
  assert.deepEqual(result.slots.map(slot => slot.slotId), expectedSlots);
  assertInert(result);
};

test("complete reported PASS is only an inert representation, never a favorable decision", () => {
  const result = invoke();
  assert.equal(result.contractStatus, "ACCOUNTED");
  assert.equal(result.inventoryState, "BOUND_DECLARATION");
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.slots.map(slot => [slot.slotId, slot.state, slot.reportedState, slot.participated, slot.issues]), [
    ["gate.json", "PASS", "PASS", true, []], ["test.unit", "PASS", "PASS", true, []],
  ]);
  assert.equal(result.subjectDigest, SUBJECT);
  assert.equal(result.policyDigest, POLICY);
  assert.equal(result.observedInventoryDigest, digest(canonical(inventory())));
  assertInert(result);
});

for (const [name, inv, code] of [
  ["empty", inventory([]), "INVENTORY_EMPTY"],
  ["missing slots", { schemaVersion: 1, policyDigest: POLICY }, "INVENTORY_SHAPE_INVALID"],
  ["null slots", inventory(null), "INVENTORY_SHAPE_INVALID"],
  ["wrong schema", { ...inventory(), schemaVersion: 2 }, "INVENTORY_SHAPE_INVALID"],
  ["extra field", { ...inventory(), mayAccept: true }, "INVENTORY_SHAPE_INVALID"],
  ["duplicate slot", inventory(["a", "a"]), "INVENTORY_DUPLICATE"],
  ["reordered slots", inventory(["b", "a"]), "INVENTORY_REORDERED"],
  ["too many slots", inventory(Array.from({ length: 65 }, (_, i) => `a${String(i).padStart(2, "0")}`)), "INVENTORY_SHAPE_INVALID"],
  ["uppercase policy digest", inventory(slots, "B".repeat(64)), "INVENTORY_SHAPE_INVALID"],
  ["wrong policy binding", inventory(slots, OTHER), "INVENTORY_POLICY_MISMATCH"],
]) test(`inventory ${name}`, () => refuses(invoke(inv), code));

for (const id of ["", "a\n", "a\r", "a\u2028", "a\u0000", "a/b", "../a", " café", "aé", "A", "a".repeat(65), 1, null, {}]) {
  test(`slot ID refuses ${JSON.stringify(id)}`, () => refuses(invoke(inventory([id])), "INVENTORY_SLOT_INVALID"));
}

for (const [name, raw, code] of [
  ["unreadable", null, "INVENTORY_UNREADABLE"],
  ["not text", {}, "INVENTORY_UNREADABLE"],
  ["zero length", "", "INVENTORY_SIZE"],
  ["oversized", " ".repeat(65_537), "INVENTORY_SIZE"],
  ["invalid JSON", "{", "INVENTORY_JSON_INVALID"],
  ["scalar", "null", "INVENTORY_SHAPE_INVALID"],
  ["deep array", "[".repeat(1000) + "0" + "]".repeat(1000), "INVENTORY_SHAPE_INVALID"],
  ["duplicate JSON key", canonical(inventory()).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'), "INVENTORY_NONCANONICAL"],
  ["duplicate overwritten slots", canonical(inventory()).replace('"requiredSlots":', '"requiredSlots":[],"requiredSlots":'), "INVENTORY_NONCANONICAL"],
  ["noncanonical number", canonical(inventory()).replace('"schemaVersion":1', '"schemaVersion":1.0'), "INVENTORY_NONCANONICAL"],
  ["trailing newline", canonical(inventory()) + "\n", "INVENTORY_NONCANONICAL"],
  ["key order", JSON.stringify(inventory()), "INVENTORY_NONCANONICAL"],
]) test(`inventory text ${name}`, () => refuses(invoke(inventory(), [], { inventoryJSON: raw }), code));

for (const field of ["subject", "policy", "inventoryDigest"]) {
  for (const value of [null, "", "A".repeat(64), "a".repeat(63) + "\n", "a".repeat(65)]) {
    test(`external ${field} binding refuses ${JSON.stringify(value)}`, () => refuses(invoke(inventory(), [], { [field]: value }), "EXPECTED_BINDING_INVALID"));
  }
}
test("independent inventory digest mismatch refuses a coherently resealed substitute", () => {
  refuses(invoke(inventory(["gate.json"]), [record("gate.json")], { inventoryDigest: digest(canonical(inventory())) }), "INVENTORY_DIGEST_MISMATCH");
});
test("wrong digest domain refuses", () => {
  refuses(invoke(inventory(), [], { inventoryDigest: createHash("sha256").update(canonical(inventory())).digest("hex") }), "INVENTORY_DIGEST_MISMATCH");
});

for (const [name, raw, code] of [
  ["unreadable", null, "EVIDENCE_UNREADABLE"],
  ["zero length", "", "EVIDENCE_SIZE"],
  ["oversized", " ".repeat(65_537), "EVIDENCE_SIZE"],
  ["invalid JSON", "[", "EVIDENCE_JSON_INVALID"],
  ["wrong envelope", "[]", "EVIDENCE_SHAPE_INVALID"],
  ["too many records", canonical(evidence(Array.from({ length: 129 }, () => record("gate.json")))), "EVIDENCE_SHAPE_INVALID"],
  ["duplicate JSON key", canonical(evidence(slots.map(id => record(id)))).replace('"status":"PASS"', '"status":"FAIL","status":"PASS"'), "EVIDENCE_NONCANONICAL"],
  ["trailing newline", canonical(evidence(slots.map(id => record(id)))) + "\n", "EVIDENCE_NONCANONICAL"],
]) test(`evidence ${name} keeps every declared slot`, () => {
  const result = invoke(inventory(), [], { evidenceJSON: raw });
  refuses(result, code, slots);
  for (const slot of result.slots) assert.deepEqual([slot.state, slot.reportedState, slot.participated, slot.issues], ["NOT_RUN", null, false, [code]]);
});

for (const change of [
  record => { record.status = "CERTIFIED"; }, record => { record.status = "UNAVAILABLE"; },
  record => { record.participated = "true"; }, record => { delete record.subjectDigest; },
  record => { record.policyDigest = "B".repeat(64); }, record => { record.slotId = "a\n"; },
  record => { record.authoritative = true; },
]) test(`malformed evidence record: ${change.toString()}`, () => {
  const row = record("gate.json"); change(row);
  refuses(invoke(inventory(), [row]), "EVIDENCE_SHAPE_INVALID", slots);
});

test("missing evidence cannot choose its own denominator", () => {
  const result = invoke(inventory(), [record("gate.json")]);
  assert.equal(result.contractStatus, "ACCOUNTED");
  assert.deepEqual(result.slots[1], { slotId: "test.unit", reportedState: null, state: "NOT_RUN", participated: false, issues: ["EVIDENCE_MISSING"] });
  assert.deepEqual(result.issues, [{ code: "EVIDENCE_MISSING", slotId: "test.unit" }]);
  assertInert(result);
});
test("zero evidence still represents all nonempty declared slots as missing", () => {
  const result = invoke(inventory(), []);
  assert.deepEqual(result.slots.map(slot => [slot.slotId, slot.state]), slots.map(id => [id, "NOT_RUN"]));
  assert.equal(result.issues.length, 2);
  assertInert(result);
});
test("extra evidence cannot replace a missing required slot", () => {
  const result = invoke(inventory(), [record("gate.json"), record("other")]);
  refuses(result, "EVIDENCE_EXTRA", slots);
  assert.ok(issueCodes(result).includes("EVIDENCE_MISSING"));
});
test("reordered evidence refuses rather than repairing witness order silently", () => {
  refuses(invoke(inventory(), slots.toReversed().map(id => record(id))), "EVIDENCE_REORDERED", slots);
});
for (const pair of [["PASS", "PASS"], ["PASS", "FAIL"], ["FAIL", "PASS"]]) test(`duplicate ${pair.join("/")} is never last-wins`, () => {
  const result = invoke(inventory(), [record("gate.json", pair[0]), record("gate.json", pair[1]), record("test.unit")]);
  refuses(result, "EVIDENCE_DUPLICATE", slots);
  assert.deepEqual(result.slots[0], { slotId: "gate.json", reportedState: null, state: "UNKNOWN", participated: false, issues: ["EVIDENCE_DUPLICATE"] });
});
for (const [field, code] of [["subjectDigest", "EVIDENCE_SUBJECT_MISMATCH"], ["policyDigest", "EVIDENCE_POLICY_MISMATCH"]]) {
  test(`otherwise PASS ${field} substitution refuses`, () => {
    const rows = slots.map(id => record(id)); rows[1][field] = OTHER;
    const result = invoke(inventory(), rows);
    refuses(result, code, slots);
    assert.deepEqual(result.slots[1].issues, [code]);
    assert.equal(result.slots[1].reportedState, "PASS");
  });
}
for (const state of ["FAIL", "NOT_RUN", "ERROR", "INCONCLUSIVE", "UNKNOWN"]) test(`retains exact ${state}, never upgrades to PASS`, () => {
  const result = invoke(inventory(), [record("gate.json", state, !["NOT_RUN", "UNKNOWN"].includes(state)), record("test.unit")]);
  assert.equal(result.contractStatus, "ACCOUNTED");
  assert.equal(result.slots[0].state, state);
  assert.equal(result.slots[0].reportedState, state);
  assert.deepEqual(result.slots[0].issues, ["EVIDENCE_NONPASS"]);
  assertInert(result);
});
test("nonparticipating PASS is explicitly non-favorable data", () => {
  const result = invoke(inventory(), [record("gate.json", "PASS", false), record("test.unit")]);
  assert.deepEqual(result.slots[0].issues, ["EVIDENCE_PARTICIPATION_MISSING"]);
  assertInert(result);
});
for (const state of ["NOT_RUN", "UNKNOWN"]) test(`contradictory ${state} participation refuses`, () => {
  refuses(invoke(inventory(), [record("gate.json", state, true)]), "EVIDENCE_PARTICIPATION_CONTRADICTION", slots);
});
test("64-slot short circuit preserves early failure plus every unexecuted slot", () => {
  const ids = Array.from({ length: 64 }, (_, i) => `slot.${String(i).padStart(2, "0")}`);
  const result = invoke(inventory(ids), [record(ids[0], "FAIL")]);
  assert.deepEqual(result.slots.map(slot => slot.slotId), ids);
  assert.equal(result.slots[0].state, "FAIL");
  assert.equal(result.slots.slice(1).filter(slot => slot.state === "NOT_RUN" && slot.issues[0] === "EVIDENCE_MISSING").length, 63);
  assertInert(result);
});
test("exact slot-ID and slot-count bounds can be represented", () => {
  const ids = Array.from({ length: 64 }, (_, i) => `a${String(i).padStart(2, "0")}${"x".repeat(61)}`);
  const result = invoke(inventory(ids), ids.map(id => record(id)));
  assert.equal(result.contractStatus, "ACCOUNTED");
  assert.equal(result.slots.length, 64);
  assert.deepEqual(result.issues, []);
  assertInert(result);
});
test("exact 128-record boundary reaches duplicate accounting, not size rejection", () => {
  const ids = Array.from({ length: 64 }, (_, i) => `slot.${String(i).padStart(2, "0")}`);
  // A valid 64-slot policy cannot have 128 distinct in-policy observations. The
  // input bound permits diagnosis, never a favorable exception for duplicates.
  const result = invoke(inventory(ids), ids.flatMap(id => [record(id), record(id)]));
  refuses(result, "EVIDENCE_DUPLICATE", ids);
  assert.equal(result.issues.length, 64);
  assert.equal(issueCodes(result).includes("EVIDENCE_SHAPE_INVALID"), false);
});
for (const kind of ["inventory", "evidence"]) test(`exact 65536-code-unit ${kind} bound reaches canonical validation`, () => {
  const text = kind === "inventory" ? canonical(inventory()) : canonical(evidence(slots.map(id => record(id))));
  const result = invoke(inventory(), [], { [`${kind}JSON`]: text.padEnd(65_536, " ") });
  refuses(result, kind === "inventory" ? "INVENTORY_NONCANONICAL" : "EVIDENCE_NONCANONICAL", kind === "inventory" ? [] : slots);
});
test("repeated exact input gives byte-identical inert output and JSON roundtrip", () => {
  const first = invoke();
  for (let index = 0; index < 8; index++) assert.equal(JSON.stringify(invoke()), JSON.stringify(first));
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assertInert(first);
});
test("all returned arrays and records are frozen, including refusal paths", () => {
  for (const result of [invoke(), invoke(inventory(), []), invoke(inventory(), [], { evidenceJSON: null }), invoke(inventory([]))]) {
    assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.slots));
    assert.ok(Object.isFrozen(result.issues)); assert.ok(Object.isFrozen(result.remainingObligations));
    for (const issue of result.issues) assert.ok(Object.isFrozen(issue));
    for (const slot of result.slots) { assert.ok(Object.isFrozen(slot)); assert.ok(Object.isFrozen(slot.issues)); }
    assert.throws(() => { result.mayAccept = true; }, TypeError);
  }
  assert.ok(Object.isFrozen(REQUIRED_INVENTORY_LIMITS));
});
