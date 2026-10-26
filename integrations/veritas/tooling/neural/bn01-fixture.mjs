// Synthetic declarations only. No files, training data, model or quality evidence.
// Independent test-side encoder: deliberately not imported from the checker.
import { createHash } from "node:crypto";

export const fakeDigest = (label) => createHash("sha256").update(`synthetic:${label}`).digest("hex");
export function fixtureBytes(value) {
  const ordered = (v) => v === null || typeof v !== "object" ? v
    : Array.isArray(v) ? v.map(ordered)
    : Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, child]) => [k, ordered(child)]));
  return Buffer.from(JSON.stringify(ordered(value)), "utf8");
}
export function fixtureDigest(record) {
  return createHash("sha256").update(`veritas/bn01/${record.kind}\0`).update(fixtureBytes(record)).digest("hex");
}
export function resealFixture(bundle) {
  for (const p of [...bundle.plugins, ...bundle.predecessors]) p.sha256 = fixtureDigest(p.record);
  for (const n of bundle.graph.record.nodes) {
    const match = bundle.plugins.find((p) => p.record.pluginId === n.pluginId);
    if (match) n.revisionSha256 = match.sha256;
  }
  bundle.graph.sha256 = fixtureDigest(bundle.graph.record);
  bundle.run.record.graphSha256 = bundle.graph.sha256;
  bundle.run.sha256 = fixtureDigest(bundle.run.record);
  return bundle;
}
export function makeBn01Fixture() {
  const authority = () => ({ accept: false, execute: false, promote: false, certify: false });
  const tensor = () => ({ dtype: "f32", width: 4, spaceSha256: fakeDigest("feature-space") });
  const plugin = (name, family, specialty) => ({
    kind: "neural-plugin-v1", pluginId: `local.veritas.${name}`, revision: 1,
    scopeId: "synthetic.project", family, specialty, lifecycle: "CANDIDATE",
    parentSha256: null, packageSha256: fakeDigest(`${name}-package`),
    weightsSha256: fakeDigest(`${name}-weights`),
    featureSchemaSha256: fakeDigest("feature-schema"), preprocessingSha256: fakeDigest("preprocess"),
    training: {
      objective: family === "JEPA_INSPIRED" ? "JEPA_REPRESENTATION_PREDICTION" : "FIXED_REFERENCE",
      recipeSha256: fakeDigest(`${name}-recipe`), datasetManifestSha256: family === "JEPA_INSPIRED" ? fakeDigest("dataset") : null,
      labelProvenanceSha256: null, holdoutManifestSha256: null,
      consentScopeSha256: family === "JEPA_INSPIRED" ? fakeDigest("consent") : null,
    },
    admittedQualitySha256: null, input: tensor(), output: tensor(),
    operator: { kind: "dense-relu-dense-v1", hiddenWidth: 8 },
    resources: { residentBytes: 4096, operations: 1000, maxInferenceMs: 50, maxOutputBytes: 512 },
    capabilities: { filesystem: "none", network: "none", subprocess: "none" }, authority: authority(),
  });
  const plugins = [plugin("intent", "REFERENCE_MLP", "INTENT"), plugin("evidence", "JEPA_INSPIRED", "EVIDENCE")].map((record) => ({ record, sha256: fakeDigest("pending") }));
  const graph = { kind: "neural-graph-v1", scopeId: "synthetic.project", mode: "SHADOW",
    router: { kind: "rules-v1", codeSha256: fakeDigest("router-code"), configSha256: fakeDigest("router-config") },
    nodes: plugins.map((p, i) => ({ nodeId: `node.${i}`, pluginId: p.record.pluginId, revisionSha256: p.sha256 })),
    edges: [{ from: "node.0", to: "node.1" }], executionOrder: ["node.0", "node.1"],
    budgets: { maxResidentBytes: 8192, maxOperations: 2000, maxInferenceMs: 100, maxOutputBytes: 1024 }, authority: authority(),
  };
  const run = { kind: "neural-run-v1", runId: "synthetic.run", scopeId: "synthetic.project",
    graphSha256: fakeDigest("pending"), subjectSha256: fakeDigest("subject"), evidenceSha256: fakeDigest("evidence"), policySha256: fakeDigest("policy"),
    featureCutoffEvent: 12,
    inputBindings: [{ nodeId: "node.0", featureSha256: fakeDigest("features"), featureSchemaSha256: plugins[0].record.featureSchemaSha256, preprocessingSha256: plugins[0].record.preprocessingSha256, observedThroughEvent: 12 }],
    requiredCheckIds: ["schema", "required-sections"],
    runtime: { backend: "swift-reference-f32-v1", binarySha256: fakeDigest("runtime"), numericPolicySha256: fakeDigest("numeric-policy"), seed: 7 }, authority: authority(),
  };
  return resealFixture({ schemaVersion: 1, profile: "veritas-bn01-offline-contract-v1", plugins, predecessors: [], graph: { record: graph, sha256: fakeDigest("pending") }, run: { record: run, sha256: fakeDigest("pending") } });
}
