import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { BN01_LIMITS, validateBn01Bytes } from "../neural/bn01.mjs";
import { fakeDigest, fixtureBytes, fixtureDigest, makeBn01Fixture, resealFixture } from "../neural/bn01-fixture.mjs";

const PASS = "PASS_BN01_OFFLINE_NEURAL_PLUGIN_CONTRACT_FIXTURE_ONLY";
const code = (bundle) => validateBn01Bytes(fixtureBytes(bundle)).code;
const cases = [];
const mutation = (id, expected, change, reseal = true) => cases.push({ id, expected, bytes: () => {
  const b = makeBn01Fixture(); change(b); return fixtureBytes(reseal ? resealFixture(b) : b);
} });
const raw = (id, expected, bytes) => cases.push({ id, expected, bytes });
const withParent = (b, changeParent = () => {}) => {
  const parent = structuredClone(b.plugins[0]); changeParent(parent.record);
  parent.sha256 = fixtureDigest(parent.record); b.predecessors.push(parent);
  b.plugins[0].record.revision = 2; b.plugins[0].record.parentSha256 = parent.sha256;
};

raw("valid-chain", PASS, () => fixtureBytes(makeBn01Fixture()));
mutation("independent-nodes-valid-alternate-order", PASS, (b) => {
  b.graph.record.edges = []; b.graph.record.executionOrder.reverse();
  b.run.record.inputBindings.push({ ...b.run.record.inputBindings[0], nodeId: "node.1" });
});
mutation("assist-declarations-only-no-runtime-admission", PASS, (b) => {
  b.graph.record.mode = "ASSIST";
  for (const p of b.plugins) { p.record.lifecycle = "ADMITTED"; p.record.admittedQualitySha256 = fakeDigest("unresolved-quality-reference"); p.record.training.holdoutManifestSha256 = fakeDigest("holdout"); }
});
mutation("declared-child-with-exact-predecessor", PASS, (b) => { withParent(b); });
raw("wrong-input-type", "INPUT_TYPE", () => "{}");
raw("empty-bytes", "INPUT_SIZE", () => Buffer.alloc(0));
raw("bytes-over-limit-before-decode", "INPUT_SIZE", () => Buffer.alloc(BN01_LIMITS.bytes + 1, 0xff));
raw("invalid-utf8", "UTF8_INVALID", () => Buffer.from([0xff]));
raw("invalid-json", "JSON_INVALID", () => Buffer.from("{"));
raw("utf8-bom-not-ignored", "JSON_INVALID", () => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fixtureBytes(makeBn01Fixture())]));
raw("deep-tree-before-canonicalization", "TREE_LIMIT", () => Buffer.from("[".repeat(26) + "0" + "]".repeat(26)));
raw("oversized-tree-array", "TREE_LIMIT", () => Buffer.from(JSON.stringify(Array(1025).fill(0))));
raw("trailing-newline", "NONCANONICAL_BYTES", () => Buffer.concat([fixtureBytes(makeBn01Fixture()), Buffer.from("\n")]));
raw("duplicate-json-key", "NONCANONICAL_BYTES", () => Buffer.from(fixtureBytes(makeBn01Fixture()).toString().replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')));
raw("noncanonical-number", "NONCANONICAL_BYTES", () => Buffer.from(fixtureBytes(makeBn01Fixture()).toString().replace('"revision":1', '"revision":1.0')));
raw("noncanonical-key-order", "NONCANONICAL_BYTES", () => Buffer.from(JSON.stringify(makeBn01Fixture())));
mutation("unknown-root-field", "SCHEMA_INVALID", (b) => { b.publish = true; });
mutation("uppercase-digest", "SCHEMA_INVALID", (b) => { b.plugins[0].record.weightsSha256 = "A".repeat(64); });
mutation("path-instead-of-id", "SCHEMA_INVALID", (b) => { b.plugins[0].record.pluginId = "../../escape"; });
mutation("long-id", "SCHEMA_INVALID", (b) => { b.plugins[0].record.pluginId = "a".repeat(97); });
mutation("non-ascii-id", "SCHEMA_INVALID", (b) => { b.plugins[0].record.pluginId = "café"; });
mutation("trailing-newline-in-id", "SCHEMA_INVALID", (b) => { b.plugins[0].record.pluginId = "plugin\n"; });
mutation("zero-width", "SCHEMA_INVALID", (b) => { b.plugins[0].record.input.width = 0; });
mutation("width-over-limit", "SCHEMA_INVALID", (b) => { b.plugins[0].record.input.width = 4097; });
mutation("numeric-string", "SCHEMA_INVALID", (b) => { b.plugins[0].record.input.width = "4"; });
mutation("unknown-operator", "SCHEMA_INVALID", (b) => { b.plugins[0].record.operator.kind = "execute-script"; });
mutation("unknown-dtype", "SCHEMA_INVALID", (b) => { b.plugins[0].record.input.dtype = "f64"; });
mutation("unbounded-graph-budget", "SCHEMA_INVALID", (b) => { b.graph.record.budgets.maxResidentBytes = Number.MAX_SAFE_INTEGER; });
mutation("negative-budget", "SCHEMA_INVALID", (b) => { b.graph.record.budgets.maxInferenceMs = -1; });
mutation("max-nodes-plus-one", "SCHEMA_INVALID", (b) => { b.graph.record.nodes = Array(17).fill(b.graph.record.nodes[0]); });
mutation("max-edges-plus-one", "SCHEMA_INVALID", (b) => { b.graph.record.edges = Array(33).fill(b.graph.record.edges[0]); });
mutation("max-plugins-plus-one", "SCHEMA_INVALID", (b) => { b.plugins = Array(17).fill(b.plugins[0]); });
mutation("max-predecessors-plus-one", "SCHEMA_INVALID", (b) => { b.predecessors = Array(33).fill(b.plugins[0]); });
for (const field of ["accept", "execute", "promote", "certify"]) {
  for (const where of ["plugin", "graph", "run"]) mutation(`${where}-authority-${field}`, "SCHEMA_INVALID", (b) => {
    (where === "plugin" ? b.plugins[0].record : b[where].record).authority[field] = true;
  });
}
for (const capability of ["filesystem", "network", "subprocess"]) mutation(`forbidden-${capability}`, "SCHEMA_INVALID", (b) => { b.plugins[0].record.capabilities[capability] = "allow"; });
mutation("unknown-output-status", "SCHEMA_INVALID", (b) => { b.plugins[0].record.status = "CERTIFIED"; });
mutation("stale-weight-binding", "PLUGIN_DIGEST_MISMATCH", (b) => { b.plugins[0].record.weightsSha256 = fakeDigest("replacement"); }, false);
mutation("stale-router-binding", "GRAPH_DIGEST_MISMATCH", (b) => { b.graph.record.router.configSha256 = fakeDigest("replacement"); }, false);
mutation("stale-run-binding", "RUN_DIGEST_MISMATCH", (b) => { b.run.record.subjectSha256 = fakeDigest("replacement"); }, false);
mutation("wrong-domain-digest", "GRAPH_DIGEST_MISMATCH", (b) => {
  b.graph.sha256 = createHash("sha256").update("veritas/bn01/neural-run-v1\0").update(fixtureBytes(b.graph.record)).digest("hex");
}, false);
mutation("duplicate-plugin", "PLUGIN_DUPLICATE", (b) => { b.plugins.push(structuredClone(b.plugins[0])); });
mutation("same-id-revision-different-weights", "PLUGIN_ID_VERSION_EQUIVOCATION", (b) => {
  const p = structuredClone(b.plugins[0]); p.record.weightsSha256 = fakeDigest("different"); b.plugins.push(p);
});
mutation("training-family-mismatch", "TRAINING_FAMILY_MISMATCH", (b) => { b.plugins[1].record.training.objective = "FIXED_REFERENCE"; });
mutation("jepa-without-data-lineage", "TRAINING_LINEAGE_MISSING", (b) => { b.plugins[1].record.training.datasetManifestSha256 = null; });
mutation("jepa-without-consent-reference", "TRAINING_LINEAGE_MISSING", (b) => { b.plugins[1].record.training.consentScopeSha256 = null; });
mutation("admitted-without-quality-reference", "QUALITY_REFERENCE_MISSING", (b) => { b.plugins[0].record.lifecycle = "ADMITTED"; });
mutation("evaluated-without-evaluation-reference", "EVALUATION_REFERENCE_MISSING", (b) => { b.plugins[0].record.lifecycle = "EVALUATED"; });
mutation("admitted-without-holdout-reference", "EVALUATION_REFERENCE_MISSING", (b) => { b.plugins[0].record.lifecycle = "ADMITTED"; b.plugins[0].record.admittedQualitySha256 = fakeDigest("quality"); });
mutation("dangling-parent", "PARENT_MISSING", (b) => { b.plugins[0].record.parentSha256 = fakeDigest("unknown-parent"); });
mutation("parent-other-plugin", "PARENT_IDENTITY_MISMATCH", (b) => { withParent(b, (p) => { p.pluginId = "different.plugin"; }); });
mutation("parent-other-scope", "PARENT_IDENTITY_MISMATCH", (b) => { withParent(b, (p) => { p.scopeId = "different.scope"; }); });
mutation("parent-other-specialty", "PARENT_IDENTITY_MISMATCH", (b) => { withParent(b, (p) => { p.specialty = "CHANGE"; }); });
mutation("parent-higher-revision", "PARENT_REVISION_NOT_EARLIER", (b) => { withParent(b, (p) => { p.revision = 3; }); });
mutation("parent-same-revision-equivocation", "PLUGIN_ID_VERSION_EQUIVOCATION", (b) => { withParent(b, (p) => { p.revision = 2; }); });
mutation("unused-predecessor", "UNREFERENCED_PREDECESSOR", (b) => { withParent(b); b.plugins[0].record.parentSha256 = null; });
mutation("stale-predecessor-digest", "PLUGIN_DIGEST_MISMATCH", (b) => {
  withParent(b); resealFixture(b); b.predecessors[0].record.weightsSha256 = fakeDigest("altered");
}, false);
mutation("understated-memory", "DECLARED_RESOURCE_UNDERSTATEMENT", (b) => { b.plugins[0].record.resources.residentBytes = 1; });
mutation("understated-operations", "DECLARED_RESOURCE_UNDERSTATEMENT", (b) => { b.plugins[0].record.resources.operations = 1; });
mutation("oversized-parameter-product", "DECLARED_RESOURCE_UNDERSTATEMENT", (b) => { b.plugins[0].record.input.width = 4096; b.plugins[0].record.operator.hiddenWidth = 4096; });
mutation("duplicate-node", "NODE_DUPLICATE", (b) => { b.graph.record.nodes[1].nodeId = "node.0"; });
mutation("unresolved-plugin", "PLUGIN_REFERENCE_MISMATCH", (b) => { b.graph.record.nodes[0].pluginId = "unknown"; });
mutation("multiple-revisions-of-plugin-in-graph", "MULTIPLE_PLUGIN_REVISIONS", (b) => { b.graph.record.nodes[1].pluginId = b.graph.record.nodes[0].pluginId; });
mutation("cross-scope-plugin", "SCOPE_MISMATCH", (b) => { b.plugins[0].record.scopeId = "other.project"; });
mutation("candidate-cannot-serve-assist", "LIFECYCLE_REFUSED", (b) => { b.graph.record.mode = "ASSIST"; });
for (const state of ["REVOKED", "RETIRED", "QUARANTINED"]) mutation(`shadow-rejects-${state.toLowerCase()}`, "LIFECYCLE_REFUSED", (b) => { b.plugins[0].record.lifecycle = state; });
mutation("unreferenced-plugin", "UNREFERENCED_PLUGIN", (b) => { const p = structuredClone(b.plugins[0]); p.record.pluginId = "unused"; b.plugins.push(p); });
for (const key of ["maxResidentBytes", "maxOperations", "maxInferenceMs", "maxOutputBytes"]) mutation(`aggregate-${key}`, "AGGREGATE_BUDGET_EXCEEDED", (b) => { b.graph.record.budgets[key]--; });
mutation("execution-order-duplicate", "EXECUTION_ORDER_MEMBERSHIP", (b) => { b.graph.record.executionOrder[1] = "node.0"; });
mutation("execution-order-missing", "EXECUTION_ORDER_MEMBERSHIP", (b) => { b.graph.record.executionOrder.pop(); });
mutation("execution-order-unknown", "EXECUTION_ORDER_MEMBERSHIP", (b) => { b.graph.record.executionOrder[1] = "unknown"; });
mutation("edge-dangling", "EDGE_DANGLING", (b) => { b.graph.record.edges[0].to = "unknown"; });
mutation("edge-self-loop", "EDGE_SELF_LOOP", (b) => { b.graph.record.edges[0].to = "node.0"; });
mutation("edge-duplicate", "EDGE_DUPLICATE", (b) => { b.graph.record.edges.push({ ...b.graph.record.edges[0] }); });
mutation("two-node-cycle", "ORDER_NOT_TOPOLOGICAL", (b) => { b.graph.record.edges.push({ from: "node.1", to: "node.0" }); });
mutation("non-topological-order", "ORDER_NOT_TOPOLOGICAL", (b) => { b.graph.record.executionOrder.reverse(); });
mutation("incompatible-width", "TENSOR_SPACE_MISMATCH", (b) => { b.plugins[1].record.input.width = 5; });
mutation("equal-width-incompatible-latent-space", "TENSOR_SPACE_MISMATCH", (b) => { b.plugins[1].record.input.spaceSha256 = fakeDigest("other-space"); });
mutation("duplicate-root-input", "ROOT_INPUT_MEMBERSHIP", (b) => { b.run.record.inputBindings.push({ ...b.run.record.inputBindings[0] }); });
mutation("input-for-nonroot", "ROOT_INPUT_MEMBERSHIP", (b) => { b.run.record.inputBindings[0].nodeId = "node.1"; });
mutation("root-input-missing", "ROOT_INPUT_MEMBERSHIP", (b) => { b.graph.record.edges = []; });
mutation("feature-schema-substitution", "FEATURE_BINDING_MISMATCH", (b) => { b.run.record.inputBindings[0].featureSchemaSha256 = fakeDigest("other-schema"); });
mutation("preprocessing-substitution", "FEATURE_BINDING_MISMATCH", (b) => { b.run.record.inputBindings[0].preprocessingSha256 = fakeDigest("other-preprocess"); });
mutation("post-cutoff-feature", "FUTURE_FEATURE", (b) => { b.run.record.inputBindings[0].observedThroughEvent++; });
mutation("run-scope-substitution", "SCOPE_MISMATCH", (b) => { b.run.record.scopeId = "other.project"; });
mutation("run-graph-mix-and-match", "RUN_GRAPH_MISMATCH", (b) => {
  b.run.record.graphSha256 = fakeDigest("other-graph"); b.run.sha256 = fixtureDigest(b.run.record);
}, false);
mutation("duplicate-required-check", "REQUIRED_CHECK_DUPLICATE", (b) => { b.run.record.requiredCheckIds.push("schema"); });
mutation("empty-required-checks", "SCHEMA_INVALID", (b) => { b.run.record.requiredCheckIds = []; });

for (const c of cases) test(`BN01 ${c.id}`, () => {
  const input = c.bytes(); const before = Buffer.isBuffer(input) ? Buffer.from(input) : input;
  const result = validateBn01Bytes(input);
  assert.equal(result.code, c.expected);
  assert.equal(result.ok, c.expected === PASS);
  assert.deepEqual(input, before, "validation must not mutate caller bytes");
  for (const flag of ["modelTrained", "modelExecuted", "weightsEvaluated", "runtimeObserved", "qualityMeasured", "continualImprovementObserved", "authorizing", "certificationGranted", "promotionGranted"]) assert.equal(result[flag], false);
  assert.equal(result.neuralRoadmapCredit, 0);
  assert.equal(Object.isFrozen(result), true);
});

export const BN01_CASE_VECTOR = Object.freeze(cases.map((c) => Object.freeze([c.id, c.expected])));
const CASE_VECTOR_SHA256 = "704d909967f4612e348d847c94d4b1d04aff88cb1169cd0bd91842b28cf7948f";
const vectorDigest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

test("BN01 fixture corpus is nonvacuous and IDs are unique", () => {
  assert.equal(cases.length, 105);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  assert.equal(cases.filter((c) => c.expected === PASS).length, 4);
  assert.equal(vectorDigest(BN01_CASE_VECTOR), CASE_VECTOR_SHA256);
});

test("BN01 frozen inventory detects empty missing duplicate extra reordered and altered-outcome vectors", () => {
  const changedOutcome = structuredClone(BN01_CASE_VECTOR); changedOutcome[4][1] = PASS;
  for (const mutant of [[], BN01_CASE_VECTOR.slice(1), [...BN01_CASE_VECTOR, BN01_CASE_VECTOR[0]], [...BN01_CASE_VECTOR, ["extra", PASS]], [...BN01_CASE_VECTOR].reverse(), changedOutcome]) {
    assert.notEqual(vectorDigest(mutant), CASE_VECTOR_SHA256);
  }
});

test("BN01 repeated corpus results are byte-identical", () => {
  const first = cases.map((c) => [c.id, validateBn01Bytes(c.bytes())]);
  const second = cases.map((c) => [c.id, validateBn01Bytes(c.bytes())]);
  assert.deepEqual(fixtureBytes(first), fixtureBytes(second));
});

test("BN01 domain separation and array order are bound", () => {
  const b = makeBn01Fixture();
  assert.notEqual(fixtureDigest(b.graph.record), fixtureDigest({ ...b.graph.record, kind: "neural-run-v1" }));
  const changed = structuredClone(b); changed.run.record.requiredCheckIds.reverse();
  assert.equal(code(changed), "RUN_DIGEST_MISMATCH");
});

test("BN01 successful metadata consistency does not resolve referenced objects", () => {
  const b = makeBn01Fixture();
  b.plugins[0].record.weightsSha256 = fakeDigest("deliberately-absent-weight-file"); resealFixture(b);
  const result = validateBn01Bytes(fixtureBytes(b));
  assert.equal(result.code, PASS);
  assert.equal(result.weightsEvaluated, false);
  assert.equal(result.runtimeObserved, false);
});
