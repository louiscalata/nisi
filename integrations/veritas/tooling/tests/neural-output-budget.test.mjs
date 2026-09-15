// Frozen declaration-budget regression corpus. No model loading or execution.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validateBn01Bytes } from "../neural/bn01.mjs";
import { fakeDigest, fixtureBytes, fixtureDigest, makeBn01Fixture, resealFixture } from "../neural/bn01-fixture.mjs";

const PASS = "PASS_BN01_OFFLINE_NEURAL_PLUGIN_CONTRACT_FIXTURE_ONLY";
const OUTPUT = "DECLARED_OUTPUT_UNDERSTATEMENT";
const AGGREGATE = "AGGREGATE_BUDGET_EXCEEDED";
const cases = [];
const add = (id, expected, change, reseal = true) => cases.push({ id, expected, bytes() {
  const bundle = makeBn01Fixture();
  change(bundle);
  return fixtureBytes(reseal ? resealFixture(bundle) : bundle);
} });

// Fixture construction only: independent one-input/one-hidden shapes avoid
// testing an earlier resident/operation refusal instead of the output boundary.
function independent(bundle, widths, ceilings, aggregate) {
  bundle.graph.record.edges = [];
  for (let n = 0; n < 2; n++) {
    const p = bundle.plugins[n].record;
    p.input.width = 1;
    p.operator.hiddenWidth = 1;
    p.output.width = widths[n];
    p.resources.residentBytes = 4 * (2 + 2 * widths[n]);
    p.resources.operations = 3 + 2 * widths[n];
    p.resources.maxOutputBytes = ceilings[n];
  }
  bundle.run.record.inputBindings.push({ ...bundle.run.record.inputBindings[0], nodeId: "node.1" });
  bundle.graph.record.budgets.maxResidentBytes = 100000;
  bundle.graph.record.budgets.maxOperations = 100000;
  bundle.graph.record.budgets.maxOutputBytes = aggregate;
}

function predecessor(bundle, ceiling) {
  for (const p of bundle.plugins) p.record.resources.maxOutputBytes = 16;
  bundle.graph.record.budgets.maxOutputBytes = 32;
  const parent = structuredClone(bundle.plugins[0]);
  parent.record.resources.maxOutputBytes = ceiling;
  parent.sha256 = fixtureDigest(parent.record);
  bundle.predecessors.push(parent);
  bundle.plugins[0].record.revision = 2;
  bundle.plugins[0].record.parentSha256 = parent.sha256;
}

add("baseline-surplus", PASS, () => {});
add("two-four-float-exact", PASS, (b) => {
  for (const p of b.plugins) p.record.resources.maxOutputBytes = 16;
  b.graph.record.budgets.maxOutputBytes = 32;
});
add("first-one-byte", OUTPUT, (b) => { b.plugins[0].record.resources.maxOutputBytes = 1; });
add("first-one-under", OUTPUT, (b) => { b.plugins[0].record.resources.maxOutputBytes = 15; });
add("second-one-under", OUTPUT, (b) => { b.plugins[1].record.resources.maxOutputBytes = 15; });
add("width-one-exact", PASS, (b) => { independent(b, [1, 1], [4, 4], 8); });
add("width-one-under", OUTPUT, (b) => { independent(b, [1, 1], [3, 4], 8); });
add("width-max-exact", PASS, (b) => { independent(b, [4096, 1], [16384, 4], 16388); });
add("width-max-under", OUTPUT, (b) => { independent(b, [4096, 1], [16383, 4], 16388); });
add("aggregate-mixed-exact", PASS, (b) => { independent(b, [1, 4], [4, 16], 20); });
add("aggregate-mixed-under", AGGREGATE, (b) => { independent(b, [1, 4], [4, 16], 19); });
add("aggregate-reserved-exact", PASS, (b) => { independent(b, [1, 1], [8, 12], 20); });
add("aggregate-reserved-under", AGGREGATE, (b) => { independent(b, [1, 1], [8, 12], 19); });
add("predecessor-exact-not-aggregated", PASS, (b) => { predecessor(b, 16); });
add("predecessor-under", OUTPUT, (b) => { predecessor(b, 15); });
add("schema-zero-budget", "SCHEMA_INVALID", (b) => { b.plugins[0].record.resources.maxOutputBytes = 0; });
add("schema-over-budget", "SCHEMA_INVALID", (b) => { b.plugins[0].record.resources.maxOutputBytes = 16385; });
add("stale-plugin-before-output", "PLUGIN_DIGEST_MISMATCH", (b) => { b.plugins[0].record.resources.maxOutputBytes = 1; }, false);
add("stale-graph-before-output", "GRAPH_DIGEST_MISMATCH", (b) => {
  b.plugins[0].record.resources.maxOutputBytes = 1;
  resealFixture(b);
  b.graph.record.router.configSha256 = fakeDigest("replacement");
}, false);
add("resident-before-output", "DECLARED_RESOURCE_UNDERSTATEMENT", (b) => {
  b.plugins[0].record.resources.residentBytes = 1;
  b.plugins[0].record.resources.maxOutputBytes = 1;
});
add("operations-before-output", "DECLARED_RESOURCE_UNDERSTATEMENT", (b) => {
  b.plugins[0].record.resources.operations = 1;
  b.plugins[0].record.resources.maxOutputBytes = 1;
});
add("output-before-revoked-lifecycle", OUTPUT, (b) => {
  b.plugins[0].record.lifecycle = "REVOKED";
  b.plugins[0].record.resources.maxOutputBytes = 1;
});
add("valid-output-still-revoked", "LIFECYCLE_REFUSED", (b) => { b.plugins[0].record.lifecycle = "REVOKED"; });
add("admitted-declaration-still-under", OUTPUT, (b) => {
  b.graph.record.mode = "ASSIST";
  for (const p of b.plugins) {
    p.record.lifecycle = "ADMITTED";
    p.record.admittedQualitySha256 = fakeDigest("unresolved-quality");
    p.record.training.holdoutManifestSha256 = fakeDigest("unresolved-holdout");
  }
  b.plugins[0].record.resources.maxOutputBytes = 1;
});

export const OUTPUT_BUDGET_CASE_VECTOR = Object.freeze(cases.map((c) => Object.freeze([c.id, c.expected])));
const VECTOR_SHA256 = "d3540384b53f8ff559f7137f8b584e6d6353688fe093a27164533a97d2e9ea6f";
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

for (const c of cases) test(`BN01 output budget ${c.id}`, () => {
  const bytes = c.bytes();
  const before = Buffer.from(bytes);
  const result = validateBn01Bytes(bytes);
  assert.equal(result.code, c.expected);
  assert.equal(result.ok, c.expected === PASS);
  assert.deepEqual(bytes, before);
  for (const flag of ["modelTrained", "modelExecuted", "weightsEvaluated", "runtimeObserved", "qualityMeasured", "continualImprovementObserved", "authorizing", "certificationGranted", "promotionGranted"]) assert.equal(result[flag], false);
  assert.equal(result.neuralRoadmapCredit, 0);
  assert.equal(Object.isFrozen(result), true);
});

test("BN01 output budget exact frozen inventory", () => {
  assert.equal(cases.length, 24);
  assert.equal(new Set(cases.map((c) => c.id)).size, 24);
  assert.equal(cases.filter((c) => c.expected === PASS).length, 7);
  assert.equal(digest(OUTPUT_BUDGET_CASE_VECTOR), VECTOR_SHA256);
});

test("BN01 output budget frozen inventory rejects dropped extra changed and reordered cases", () => {
  const changed = structuredClone(OUTPUT_BUDGET_CASE_VECTOR);
  changed[2][1] = PASS;
  for (const vector of [[], OUTPUT_BUDGET_CASE_VECTOR.slice(1), [...OUTPUT_BUDGET_CASE_VECTOR, OUTPUT_BUDGET_CASE_VECTOR[0]], [...OUTPUT_BUDGET_CASE_VECTOR, ["extra", PASS]], [...OUTPUT_BUDGET_CASE_VECTOR].reverse(), changed]) {
    assert.notEqual(digest(vector), VECTOR_SHA256);
  }
});

test("BN01 output budget repeated results are deterministic", () => {
  assert.deepEqual(cases.map((c) => validateBn01Bytes(c.bytes())), cases.map((c) => validateBn01Bytes(c.bytes())));
});
