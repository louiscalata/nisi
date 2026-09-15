// Private offline contract checker. Never a runtime loader or admission authority.
import Ajv2020 from "ajv/dist/2020.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const schema = JSON.parse(readFileSync(new URL("./bn01.schema.json", import.meta.url), "utf8"));
const checkSchema = new Ajv2020({ strict: true, allErrors: false, ownProperties: true }).compile(schema);
export const BN01_LIMITS = Object.freeze({ bytes: 262144, depth: 24, values: 12000 });
const ceiling = Object.freeze({
  modelTrained: false, modelExecuted: false, weightsEvaluated: false,
  runtimeObserved: false, qualityMeasured: false, continualImprovementObserved: false,
  authorizing: false, certificationGranted: false, promotionGranted: false,
  neuralRoadmapCredit: 0,
});

// This profile admits schema-constrained ASCII keys and bounded integer values.
// It is not advertised as RFC 8785/JCS. Arrays preserve exact declared order.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function treeWithinBounds(value) {
  const stack = [[value, 0]];
  let count = 0;
  while (stack.length) {
    const [item, depth] = stack.pop();
    if (++count > BN01_LIMITS.values || depth > BN01_LIMITS.depth) return false;
    if (typeof item === "string" && item.length > 1024) return false;
    if (item && typeof item === "object") {
      const values = Object.values(item);
      if (values.length > 1024) return false;
      for (const child of values) stack.push([child, depth + 1]);
    }
  }
  return true;
}

function digestRecord(record) {
  return createHash("sha256").update(`veritas/bn01/${record.kind}\0`).update(canonical(record)).digest("hex");
}

const failure = (code) => Object.freeze({ ok: false, code, ...ceiling });
const same = (a, b) => canonical(a) === canonical(b);

function validateSemantics(bundle) {
  const graph = bundle.graph.record;
  const run = bundle.run.record;
  const byDigest = new Map();
  const byIdentity = new Map();
  for (const envelope of [...bundle.plugins, ...bundle.predecessors]) {
    const p = envelope.record;
    const key = `${p.pluginId}:${p.revision}`;
    if (byIdentity.has(key)) {
      return byIdentity.get(key) === envelope.sha256 ? "PLUGIN_DUPLICATE" : "PLUGIN_ID_VERSION_EQUIVOCATION";
    }
    byIdentity.set(key, envelope.sha256);
    byDigest.set(envelope.sha256, p);
    if (p.family === "REFERENCE_MLP" && p.training.objective !== "FIXED_REFERENCE") return "TRAINING_FAMILY_MISMATCH";
    if (p.family === "JEPA_INSPIRED") {
      if (p.training.objective !== "JEPA_REPRESENTATION_PREDICTION") return "TRAINING_FAMILY_MISMATCH";
      if ([p.training.datasetManifestSha256, p.training.consentScopeSha256].includes(null)) return "TRAINING_LINEAGE_MISSING";
    }
    if (p.lifecycle === "ADMITTED" && p.admittedQualitySha256 === null) return "QUALITY_REFERENCE_MISSING";
    if (["EVALUATED", "ADMITTED"].includes(p.lifecycle) && (p.admittedQualitySha256 === null || p.training.holdoutManifestSha256 === null)) return "EVALUATION_REFERENCE_MISSING";
    // Bounds on declared f32 dense/relu/dense parameters and scalar operations.
    // These are minimum declared costs, not observed memory/time enforcement.
    const i = p.input.width, h = p.operator.hiddenWidth, o = p.output.width;
    const parameters = i * h + h + h * o + o;
    const operations = 2 * i * h + h + 2 * h * o;
    if (parameters > 16777216 || p.resources.residentBytes < 4 * parameters || p.resources.operations < operations) return "DECLARED_RESOURCE_UNDERSTATEMENT";
    // Raw f32 output tensor payload only, not envelope bytes or process memory.
    // Aggregate accounting below still reserves each declared ceiling in full.
    if (p.resources.maxOutputBytes < 4 * o) return "DECLARED_OUTPUT_UNDERSTATEMENT";
  }
  for (const p of byDigest.values()) {
    if (p.parentSha256 === null) continue;
    const parent = byDigest.get(p.parentSha256);
    if (!parent) return "PARENT_MISSING";
    if (parent.pluginId !== p.pluginId || parent.scopeId !== p.scopeId || parent.family !== p.family || parent.specialty !== p.specialty) return "PARENT_IDENTITY_MISMATCH";
    if (parent.revision >= p.revision) return "PARENT_REVISION_NOT_EARLIER";
  }
  const selectedDigests = new Set(bundle.plugins.map((p) => p.sha256));
  const nodes = new Map();
  const usedPlugins = new Set();
  const selectedIds = new Set();
  const total = { residentBytes: 0, operations: 0, maxInferenceMs: 0, maxOutputBytes: 0 };
  for (const node of graph.nodes) {
    if (nodes.has(node.nodeId)) return "NODE_DUPLICATE";
    const p = byDigest.get(node.revisionSha256);
    if (!p || !selectedDigests.has(node.revisionSha256) || p.pluginId !== node.pluginId) return "PLUGIN_REFERENCE_MISMATCH";
    if (selectedIds.has(p.pluginId)) return "MULTIPLE_PLUGIN_REVISIONS";
    selectedIds.add(p.pluginId);
    if (p.scopeId !== graph.scopeId) return "SCOPE_MISMATCH";
    const allowed = graph.mode === "ASSIST" ? ["ADMITTED"] : ["CANDIDATE", "EVALUATED", "ADMITTED"];
    if (!allowed.includes(p.lifecycle)) return "LIFECYCLE_REFUSED";
    nodes.set(node.nodeId, p);
    usedPlugins.add(node.revisionSha256);
    for (const key of Object.keys(total)) {
      total[key] += p.resources[key];
      if (!Number.isSafeInteger(total[key])) return "RESOURCE_OVERFLOW";
    }
  }
  if (usedPlugins.size !== selectedDigests.size) return "UNREFERENCED_PLUGIN";
  const ancestors = new Set();
  for (const p of nodes.values()) {
    let parent = p.parentSha256;
    // All parents resolved above and revisions strictly decrease, so at most 48 steps.
    while (parent !== null) { ancestors.add(parent); parent = byDigest.get(parent).parentSha256; }
  }
  if (bundle.predecessors.some((p) => !ancestors.has(p.sha256))) return "UNREFERENCED_PREDECESSOR";
  if (total.residentBytes > graph.budgets.maxResidentBytes || total.operations > graph.budgets.maxOperations || total.maxInferenceMs > graph.budgets.maxInferenceMs || total.maxOutputBytes > graph.budgets.maxOutputBytes) return "AGGREGATE_BUDGET_EXCEEDED";

  const positions = new Map();
  for (const [index, id] of graph.executionOrder.entries()) {
    if (positions.has(id) || !nodes.has(id)) return "EXECUTION_ORDER_MEMBERSHIP";
    positions.set(id, index);
  }
  if (positions.size !== nodes.size) return "EXECUTION_ORDER_MEMBERSHIP";
  const edges = new Set();
  const incoming = new Set();
  for (const edge of graph.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) return "EDGE_DANGLING";
    if (edge.from === edge.to) return "EDGE_SELF_LOOP";
    const key = JSON.stringify([edge.from, edge.to]);
    if (edges.has(key)) return "EDGE_DUPLICATE";
    edges.add(key);
    if (incoming.has(edge.to)) return "IMPLICIT_TENSOR_MERGE";
    incoming.add(edge.to);
    if (positions.get(edge.from) >= positions.get(edge.to)) return "ORDER_NOT_TOPOLOGICAL";
    if (!same(nodes.get(edge.from).output, nodes.get(edge.to).input)) return "TENSOR_SPACE_MISMATCH";
  }
  // A complete topological permutation plus strictly forward edges excludes cycles.
  // Roots receive explicit frozen feature bindings; other nodes receive one edge.
  const roots = new Set([...nodes.keys()].filter((id) => !incoming.has(id)));
  const inputs = new Set();
  for (const binding of run.inputBindings) {
    const p = nodes.get(binding.nodeId);
    if (!roots.has(binding.nodeId) || inputs.has(binding.nodeId)) return "ROOT_INPUT_MEMBERSHIP";
    inputs.add(binding.nodeId);
    if (p.featureSchemaSha256 !== binding.featureSchemaSha256 || p.preprocessingSha256 !== binding.preprocessingSha256) return "FEATURE_BINDING_MISMATCH";
    if (binding.observedThroughEvent > run.featureCutoffEvent) return "FUTURE_FEATURE";
  }
  if (inputs.size !== roots.size) return "ROOT_INPUT_MEMBERSHIP";
  if (run.scopeId !== graph.scopeId) return "SCOPE_MISMATCH";
  if (run.graphSha256 !== bundle.graph.sha256) return "RUN_GRAPH_MISMATCH";
  if (new Set(run.requiredCheckIds).size !== run.requiredCheckIds.length) return "REQUIRED_CHECK_DUPLICATE";
  return null;
}

/** Validate canonical raw bytes only. Does not read any caller-supplied path/URI,
 * resolve weight/data/code objects, load a model, run a check, or grant admission.
 * Result means declared metadata consistency, not authentic provenance/currentness.
 */
export function validateBn01Bytes(bytes) {
  if (!Buffer.isBuffer(bytes)) return failure("INPUT_TYPE");
  if (bytes.byteLength === 0 || bytes.byteLength > BN01_LIMITS.bytes) return failure("INPUT_SIZE");
  let text, bundle;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return failure("UTF8_INVALID"); }
  try { bundle = JSON.parse(text); }
  catch { return failure("JSON_INVALID"); }
  if (!treeWithinBounds(bundle)) return failure("TREE_LIMIT");
  if (!checkSchema(bundle)) return failure("SCHEMA_INVALID");
  if (canonical(bundle) !== text) return failure("NONCANONICAL_BYTES");
  for (const plugin of [...bundle.plugins, ...bundle.predecessors]) if (digestRecord(plugin.record) !== plugin.sha256) return failure("PLUGIN_DIGEST_MISMATCH");
  if (digestRecord(bundle.graph.record) !== bundle.graph.sha256) return failure("GRAPH_DIGEST_MISMATCH");
  if (digestRecord(bundle.run.record) !== bundle.run.sha256) return failure("RUN_DIGEST_MISMATCH");
  const problem = validateSemantics(bundle);
  if (problem) return failure(problem);
  return Object.freeze({ ok: true, code: "PASS_BN01_OFFLINE_NEURAL_PLUGIN_CONTRACT_FIXTURE_ONLY", graphSha256: bundle.graph.sha256, runSha256: bundle.run.sha256, ...ceiling });
}
