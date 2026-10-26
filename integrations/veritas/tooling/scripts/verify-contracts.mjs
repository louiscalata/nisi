import Ajv2020 from "ajv/dist/2020.js";
import { spawnSync } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  canonicalJson,
  emitDeterministic,
  exactKeys,
  readJson,
  repositoryRoot,
  sha256Canonical,
  sha256File,
  toolingRoot,
} from "./common.mjs";
import { assertSchemaRegistryClosure, assertSchemaCorpusClosure } from "./schema-corpus-closure.mjs";

const manifestPath = resolve(toolingRoot, "contracts/stage5-manifest.json");
const digestPath = resolve(toolingRoot, "contracts/digests.json");
const rootPath = resolve(toolingRoot, "contracts/stage5-root.json");
const stage5Root = await readJson(rootPath);
exactKeys(
  stage5Root,
  ["schemaVersion", "profile", "stage5ManifestSha256", "digestManifestSha256"],
  "stage5 external digest root",
);
if (
  stage5Root.schemaVersion !== 1 ||
  stage5Root.profile !== "veritas-stage5-private-git-root-v1" ||
  !/^[0-9a-f]{64}$/u.test(stage5Root.stage5ManifestSha256) ||
  !/^[0-9a-f]{64}$/u.test(stage5Root.digestManifestSha256)
) {
  throw new Error("Stage 5 external digest-root identity or digest fields differ.");
}
const observedStage5ManifestSha256 = await sha256File(manifestPath);
const observedDigestManifestSha256 = await sha256File(digestPath);
if (
  observedStage5ManifestSha256 !== stage5Root.stage5ManifestSha256 ||
  observedDigestManifestSha256 !== stage5Root.digestManifestSha256
) {
  throw new Error("Stage 5 manifest chain differs from the private-Git digest root.");
}
const manifest = await readJson(manifestPath);
exactKeys(
  manifest,
  ["schemaVersion", "profile", "statusCeiling", "digestManifestSha256", "installationContract", "toolchain", "rootContract", "commands", "hashedFiles", "acceptance", "boundaries"],
  "stage5 manifest",
);
if (manifest.schemaVersion !== 1 || manifest.statusCeiling !== "PASS_STAGE5_STRUCTURAL_PREPARATION_ONLY") {
  throw new Error("Stage 5 manifest version or status ceiling differs.");
}
if (new Set(manifest.hashedFiles).size !== manifest.hashedFiles.length) {
  throw new Error("Stage 5 hashed file list contains duplicates.");
}
if (canonicalJson(manifest.hashedFiles) !== canonicalJson([...manifest.hashedFiles].sort())) {
  throw new Error("Stage 5 hashed file list must be sorted.");
}
if (Object.values(manifest.boundaries).some((value) => value !== false)) {
  throw new Error("Stage 5 cannot claim protected, runtime, E16, M4, legal, or release credit.");
}
if (!/^[0-9a-f]{64}$/u.test(manifest.digestManifestSha256)) {
  throw new Error("Stage 5 digest-manifest root is not a lowercase SHA-256 digest.");
}

const expectedToolchain = {
  node: "v24.18.0",
  npm: "11.16.0",
  eslintJs: "10.0.1",
  typescript: "6.0.3",
  nodeTypes: "24.13.3",
  eslint: "10.9.1",
  typescriptEslint: "8.68.0",
  ajv: "8.20.0",
};
if (canonicalJson(manifest.toolchain) !== canonicalJson(expectedToolchain)) {
  throw new Error("Stage 5 toolchain versions differ from the frozen contract.");
}

const toolingPackage = await readJson(resolve(toolingRoot, "package.json"));
const expectedDevDependencies = {
  "@eslint/js": manifest.toolchain.eslintJs,
  "@types/node": manifest.toolchain.nodeTypes,
  ajv: manifest.toolchain.ajv,
  eslint: manifest.toolchain.eslint,
  typescript: manifest.toolchain.typescript,
  "typescript-eslint": manifest.toolchain.typescriptEslint,
};
if (canonicalJson(toolingPackage.devDependencies) !== canonicalJson(expectedDevDependencies)) {
  throw new Error("Tooling package dependencies differ from the frozen toolchain.");
}
if (toolingPackage.engines.node !== "24.18.0" || toolingPackage.engines.npm !== "11.16.0") {
  throw new Error("Tooling package engines differ from the root runtime contract.");
}

const toolingLock = await readJson(resolve(toolingRoot, "package-lock.json"));
const toolingLockRoot = toolingLock.packages?.[""];
if (!toolingLockRoot || canonicalJson(toolingLockRoot.devDependencies) !== canonicalJson(expectedDevDependencies)) {
  throw new Error("Tooling lock root does not bind the exact declared dev dependencies.");
}

const rootDigests = {
  sourceSha256: await sha256File(resolve(repositoryRoot, "veritas.ts")),
  packageSha256: await sha256File(resolve(repositoryRoot, "package.json")),
  packageLockSha256: await sha256File(resolve(repositoryRoot, "package-lock.json")),
  npmrcSha256: await sha256File(resolve(repositoryRoot, ".npmrc")),
  rootRuntimeDependencies: Object.keys((await readJson(resolve(repositoryRoot, "package.json"))).dependencies ?? {}).length,
};
if (canonicalJson(rootDigests) !== canonicalJson(manifest.rootContract)) {
  throw new Error(`Root package/source contract drifted: ${canonicalJson(rootDigests)}`);
}

const sourceText = await readFile(resolve(repositoryRoot, "veritas.ts"), "utf8");
function frozenSourceStringArray(constantName) {
  const startToken = `const ${constantName} = Object.freeze([`;
  const start = sourceText.indexOf(startToken);
  const end = start < 0 ? -1 : sourceText.indexOf("] as const);", start + startToken.length);
  if (start < 0 || end < 0) {
    throw new Error(`Frozen source array ${constantName} is missing.`);
  }
  return [...sourceText.slice(start + startToken.length, end).matchAll(/"([A-Z0-9_-]+)"/gu)]
    .map((match) => match[1]);
}
function frozenSourceStringConstant(constantName) {
  const match = sourceText.match(
    new RegExp(`const ${constantName} =\\s*"([^"]+)"(?: as const)?;`, "u"),
  );
  if (!match) {
    throw new Error(`Frozen source string ${constantName} is missing.`);
  }
  return match[1];
}
const m37GitBaseManifestCaseIds = frozenSourceStringArray(
  "M37_GIT_BASE_MANIFEST_CASE_IDS",
);
const m37GitBaseManifestDenominatorNegativeControlIds = frozenSourceStringArray(
  "M37_GIT_BASE_MANIFEST_DENOMINATOR_NEGATIVE_CONTROL_IDS",
);
const m37RepeatedRunsMatch = sourceText.match(
  /const M37_GIT_BASE_MANIFEST_REPEATED_RUNS = ([0-9]+) as const;/u,
);
const m37GitBaseManifestRepeatedRuns = Number(m37RepeatedRunsMatch?.[1]);
if (
  canonicalJson(m37GitBaseManifestCaseIds) !==
    canonicalJson(manifest.acceptance.m37GitBaseManifestCaseIds) ||
  m37GitBaseManifestCaseIds.length !== manifest.acceptance.m37GitBaseManifestCases ||
  m37GitBaseManifestRepeatedRuns !== manifest.acceptance.m37GitBaseManifestRepeatedRuns ||
  m37GitBaseManifestDenominatorNegativeControlIds.length !==
    manifest.acceptance.m37GitBaseManifestDenominatorNegativeControls
) {
  throw new Error("M3.7 Git-base source denominator differs from the Stage 5 acceptance manifest.");
}
const m37GitTreeDeltaAtomicCheckIds = frozenSourceStringArray(
  "M37_GIT_TREE_DELTA_ATOMIC_CHECK_IDS",
);
const m37GitTreeDeltaDenominatorNegativeControlIds = frozenSourceStringArray(
  "M37_GIT_TREE_DELTA_DENOMINATOR_NEGATIVE_CONTROL_IDS",
);
const m37TreeDeltaRepeatedRunsMatch = sourceText.match(
  /const M37_GIT_TREE_DELTA_REPEATED_RUNS = ([0-9]+) as const;/u,
);
const m37GitTreeDeltaRepeatedRuns = Number(m37TreeDeltaRepeatedRunsMatch?.[1]);
if (
  canonicalJson(m37GitTreeDeltaAtomicCheckIds) !==
    canonicalJson(manifest.acceptance.m37GitTreeDeltaAtomicCheckIds) ||
  m37GitTreeDeltaAtomicCheckIds.length !== manifest.acceptance.m37GitTreeDeltaAtomicChecks ||
  m37GitTreeDeltaRepeatedRuns !== manifest.acceptance.m37GitTreeDeltaRepeatedRuns ||
  m37GitTreeDeltaDenominatorNegativeControlIds.length !==
    manifest.acceptance.m37GitTreeDeltaDenominatorNegativeControls
) {
  throw new Error("M3.7 structured Git tree-delta source denominator differs from the Stage 5 acceptance manifest.");
}
const m46DependencyClosureAtomicCheckIds = frozenSourceStringArray(
  "M46_DEPENDENCY_CLOSURE_ATOMIC_CHECK_IDS",
);
const m46DependencyClosureDenominatorNegativeControlIds = frozenSourceStringArray(
  "M46_DEPENDENCY_CLOSURE_DENOMINATOR_NEGATIVE_CONTROL_IDS",
);
const m46RepeatedRunsMatch = sourceText.match(
  /const M46_DEPENDENCY_CLOSURE_REPEATED_RUNS = ([0-9]+) as const;/u,
);
const m46DependencyClosureRepeatedRuns = Number(m46RepeatedRunsMatch?.[1]);
const m46DependencyClosureProfile = frozenSourceStringConstant(
  "M46_DEPENDENCY_CLOSURE_PROFILE",
);
const m46DependencyNodeDigestDomain = frozenSourceStringConstant(
  "M46_DEPENDENCY_NODE_DIGEST_DOMAIN",
);
const m46DependencyEdgeDigestDomain = frozenSourceStringConstant(
  "M46_DEPENDENCY_EDGE_DIGEST_DOMAIN",
);
const m46DependencyGraphDigestDomain = frozenSourceStringConstant(
  "M46_DEPENDENCY_GRAPH_DIGEST_DOMAIN",
);
const m46MinimumFixtureSubjectDigest = frozenSourceStringConstant(
  "M46_MINIMUM_FIXTURE_SUBJECT_DIGEST",
);
const m46MinimumFixtureGraphDigest = frozenSourceStringConstant(
  "M46_MINIMUM_FIXTURE_GRAPH_DIGEST",
);
if (
  m46DependencyClosureProfile !== manifest.acceptance.m46DependencyClosureProfile ||
  m46DependencyNodeDigestDomain !== manifest.acceptance.m46DependencyNodeDigestDomain ||
  m46DependencyEdgeDigestDomain !== manifest.acceptance.m46DependencyEdgeDigestDomain ||
  m46DependencyGraphDigestDomain !== manifest.acceptance.m46DependencyGraphDigestDomain ||
  m46MinimumFixtureSubjectDigest !== manifest.acceptance.m46MinimumFixtureSubjectDigest ||
  m46MinimumFixtureGraphDigest !== manifest.acceptance.m46MinimumFixtureGraphDigest ||
  canonicalJson(m46DependencyClosureAtomicCheckIds) !==
    canonicalJson(manifest.acceptance.m46DependencyClosureAtomicCheckIds) ||
  m46DependencyClosureAtomicCheckIds.length !==
    manifest.acceptance.m46DependencyClosureAtomicChecks ||
  m46DependencyClosureRepeatedRuns !==
    manifest.acceptance.m46DependencyClosureRepeatedRuns ||
  canonicalJson(m46DependencyClosureDenominatorNegativeControlIds) !==
    canonicalJson(manifest.acceptance.m46DependencyClosureDenominatorNegativeControlIds) ||
  m46DependencyClosureDenominatorNegativeControlIds.length !==
    manifest.acceptance.m46DependencyClosureDenominatorNegativeControls
) {
  throw new Error("M4.6 dependency-closure source denominator differs from the Stage 5 acceptance manifest.");
}
const m46RecallAtomicCheckIds = frozenSourceStringArray(
  "M46_RECALL_ATOMIC_CHECK_IDS",
);
const m46RecallDenominatorNegativeControlIds = frozenSourceStringArray(
  "M46_RECALL_DENOMINATOR_NEGATIVE_CONTROL_IDS",
);
const m46RecallRepeatedRunsMatch = sourceText.match(
  /const M46_RECALL_REPEATED_RUNS = ([0-9]+) as const;/u,
);
const m46RecallRepeatedRuns = Number(m46RecallRepeatedRunsMatch?.[1]);
const m46RecallProfile = frozenSourceStringConstant("M46_RECALL_PROFILE");
const m46RecallScopeDigestDomain = frozenSourceStringConstant(
  "M46_RECALL_SCOPE_DIGEST_DOMAIN",
);
const m46RecallReceiptDigestDomain = frozenSourceStringConstant(
  "M46_RECALL_RECEIPT_DIGEST_DOMAIN",
);
const m46RecallReceiptSetDigestDomain = frozenSourceStringConstant(
  "M46_RECALL_RECEIPT_SET_DIGEST_DOMAIN",
);
const m46RecallEventDigestDomain = frozenSourceStringConstant(
  "M46_RECALL_EVENT_DIGEST_DOMAIN",
);
const m46RecallStateDigestDomain = frozenSourceStringConstant(
  "M46_RECALL_STATE_DIGEST_DOMAIN",
);
const m46RecallResultDigestDomain = frozenSourceStringConstant(
  "M46_RECALL_RESULT_DIGEST_DOMAIN",
);
const m46RecallExpectedReceiptSetDigest = frozenSourceStringConstant(
  "M46_RECALL_EXPECTED_RECEIPT_SET_DIGEST",
);
const m46RecallExpectedBeforeStateDigest = frozenSourceStringConstant(
  "M46_RECALL_EXPECTED_BEFORE_STATE_DIGEST",
);
const m46RecallExpectedEventDigest = frozenSourceStringConstant(
  "M46_RECALL_EXPECTED_EVENT_DIGEST",
);
const m46RecallExpectedBarrierStateDigest = frozenSourceStringConstant(
  "M46_RECALL_EXPECTED_BARRIER_STATE_DIGEST",
);
const m46RecallExpectedAfterStateDigest = frozenSourceStringConstant(
  "M46_RECALL_EXPECTED_AFTER_STATE_DIGEST",
);
const m46RecallExpectedResultDigest = frozenSourceStringConstant(
  "M46_RECALL_EXPECTED_RESULT_DIGEST",
);
const m46RecallSubjectDigest = m46MinimumFixtureSubjectDigest;
const m46RecallGraphDigest = m46MinimumFixtureGraphDigest;
if (
  m46RecallProfile !== manifest.acceptance.m46RecallProfile ||
  m46RecallScopeDigestDomain !== manifest.acceptance.m46RecallScopeDigestDomain ||
  m46RecallReceiptDigestDomain !== manifest.acceptance.m46RecallReceiptDigestDomain ||
  m46RecallReceiptSetDigestDomain !== manifest.acceptance.m46RecallReceiptSetDigestDomain ||
  m46RecallEventDigestDomain !== manifest.acceptance.m46RecallEventDigestDomain ||
  m46RecallStateDigestDomain !== manifest.acceptance.m46RecallStateDigestDomain ||
  m46RecallResultDigestDomain !== manifest.acceptance.m46RecallResultDigestDomain ||
  m46RecallSubjectDigest !== manifest.acceptance.m46RecallSubjectDigest ||
  m46RecallGraphDigest !== manifest.acceptance.m46RecallGraphDigest ||
  m46RecallExpectedReceiptSetDigest !== manifest.acceptance.m46RecallExpectedReceiptSetDigest ||
  m46RecallExpectedBeforeStateDigest !== manifest.acceptance.m46RecallExpectedBeforeStateDigest ||
  m46RecallExpectedEventDigest !== manifest.acceptance.m46RecallExpectedEventDigest ||
  m46RecallExpectedBarrierStateDigest !== manifest.acceptance.m46RecallExpectedBarrierStateDigest ||
  m46RecallExpectedAfterStateDigest !== manifest.acceptance.m46RecallExpectedAfterStateDigest ||
  m46RecallExpectedResultDigest !== manifest.acceptance.m46RecallExpectedResultDigest ||
  canonicalJson(m46RecallAtomicCheckIds) !==
    canonicalJson(manifest.acceptance.m46RecallAtomicCheckIds) ||
  m46RecallAtomicCheckIds.length !== manifest.acceptance.m46RecallAtomicChecks ||
  m46RecallRepeatedRuns !== manifest.acceptance.m46RecallRepeatedRuns ||
  canonicalJson(m46RecallDenominatorNegativeControlIds) !==
    canonicalJson(manifest.acceptance.m46RecallDenominatorNegativeControlIds) ||
  m46RecallDenominatorNegativeControlIds.length !==
    manifest.acceptance.m46RecallDenominatorNegativeControls
) {
  throw new Error("M4.6 scoped-recall source contract differs from the Stage 5 acceptance manifest.");
}
const m47OracleAtomicCheckIds = frozenSourceStringArray(
  "M47_ORACLE_ATOMIC_CHECK_IDS",
);
const m47OracleDenominatorNegativeControlIds = frozenSourceStringArray(
  "M47_ORACLE_DENOMINATOR_NEGATIVE_CONTROL_IDS",
);
const m47OracleRepeatedRunsMatch = sourceText.match(
  /const M47_ORACLE_REPEATED_RUNS = ([0-9]+) as const;/u,
);
const m47OracleRepeatedRuns = Number(m47OracleRepeatedRunsMatch?.[1]);
const m47OracleProfile = frozenSourceStringConstant("M47_ORACLE_PROFILE");
const m47OracleUniverseDigestDomain = frozenSourceStringConstant(
  "M47_ORACLE_UNIVERSE_DIGEST_DOMAIN",
);
const m47OracleRecordDigestDomain = frozenSourceStringConstant(
  "M47_ORACLE_RECORD_DIGEST_DOMAIN",
);
const m47OracleCheckDigestDomain = frozenSourceStringConstant(
  "M47_ORACLE_CHECK_DIGEST_DOMAIN",
);
const m47OracleCheckSetDigestDomain = frozenSourceStringConstant(
  "M47_ORACLE_CHECK_SET_DIGEST_DOMAIN",
);
const m47OracleChangeDigestDomain = frozenSourceStringConstant(
  "M47_ORACLE_CHANGE_DIGEST_DOMAIN",
);
const m47OracleFreezeDigestDomain = frozenSourceStringConstant(
  "M47_ORACLE_FREEZE_DIGEST_DOMAIN",
);
const m47OraclePlanDigestDomain = frozenSourceStringConstant(
  "M47_ORACLE_PLAN_DIGEST_DOMAIN",
);
const m47OracleResultDigestDomain = frozenSourceStringConstant(
  "M47_ORACLE_RESULT_DIGEST_DOMAIN",
);
const m47OracleExpectedUniverseDigest = frozenSourceStringConstant(
  "M47_ORACLE_EXPECTED_UNIVERSE_DIGEST",
);
const m47OracleExpectedCheckSetDigest = frozenSourceStringConstant(
  "M47_ORACLE_EXPECTED_CHECK_SET_DIGEST",
);
const m47OracleExpectedFreezeDigest = frozenSourceStringConstant(
  "M47_ORACLE_EXPECTED_FREEZE_DIGEST",
);
const m47OracleExpectedKnownChangeDigest = frozenSourceStringConstant(
  "M47_ORACLE_EXPECTED_KNOWN_CHANGE_DIGEST",
);
const m47OracleExpectedUnresolvedChangeDigest = frozenSourceStringConstant(
  "M47_ORACLE_EXPECTED_UNRESOLVED_CHANGE_DIGEST",
);
const m47OracleExpectedKnownPlanDigest = frozenSourceStringConstant(
  "M47_ORACLE_EXPECTED_KNOWN_PLAN_DIGEST",
);
const m47OracleExpectedUnresolvedPlanDigest = frozenSourceStringConstant(
  "M47_ORACLE_EXPECTED_UNRESOLVED_PLAN_DIGEST",
);
const m47OracleExpectedResultDigest = frozenSourceStringConstant(
  "M47_ORACLE_EXPECTED_RESULT_DIGEST",
);
const m47OracleGraphDigest = m46MinimumFixtureGraphDigest;
// Structural separation (roadmap M4.7): the planner region may not reference the frozen
// oracle-ID constant. Enforced from source bytes, not from any claim in the fixture.
function exactMarkerRegion(beginMarker, endMarker, label) {
  const begin = sourceText.indexOf(beginMarker);
  const end = sourceText.indexOf(endMarker);
  if (
    begin < 0 || end < 0 || begin >= end ||
    begin !== sourceText.lastIndexOf(beginMarker) || end !== sourceText.lastIndexOf(endMarker)
  ) {
    throw new Error(`${label} structural markers must exist exactly once, in order.`);
  }
  return sourceText.slice(begin + beginMarker.length, end);
}
const m47FrozenOracleRegion = exactMarkerRegion(
  "// M47_FROZEN_ORACLE_BEGIN", "// M47_FROZEN_ORACLE_END", "M4.7 frozen oracle",
);
const m47PlannerRegion = exactMarkerRegion(
  "// M47_PLANNER_BEGIN", "// M47_PLANNER_END", "M4.7 planner",
);
// Every top-level constant declared inside the frozen region is protected, whatever shape its
// initializer takes; any constant anywhere in the source whose initializer references a protected
// name becomes protected too (aliases cannot launder the array out of the region); and the planner
// may not mention the universe at all, since its only admitted inputs are the graph, the registered
// check set, and the change vector.
const topLevelDeclaration = /^(?:const|let|function|async function|type|class|interface|enum) /gmu;
function topLevelConstChunks(text) {
  const starts = [...text.matchAll(topLevelDeclaration)].map((match) => match.index);
  const chunks = new Map();
  for (const [index, start] of starts.entries()) {
    const end = index + 1 < starts.length ? starts[index + 1] : text.length;
    const chunk = text.slice(start, end);
    const named = chunk.match(/^const ([A-Za-z0-9_$]+) =/u);
    if (named) chunks.set(named[1], chunk);
  }
  return chunks;
}
const m47FrozenOracleConstants = new Set(
  [...m47FrozenOracleRegion.matchAll(/^const (M47_[A-Z0-9_]+) =/gmu)].map((match) => match[1]),
);
if (m47FrozenOracleConstants.size === 0) {
  throw new Error("M4.7 frozen oracle region declares no constant.");
}
const m47SourceConstChunks = topLevelConstChunks(sourceText);
for (let changed = true; changed;) {
  changed = false;
  for (const [name, chunk] of m47SourceConstChunks) {
    if (m47FrozenOracleConstants.has(name)) continue;
    for (const protectedName of m47FrozenOracleConstants) {
      if (new RegExp(`\\b${protectedName}\\b`, "u").test(chunk)) {
        m47FrozenOracleConstants.add(name);
        changed = true;
        break;
      }
    }
  }
}
for (const constantName of m47FrozenOracleConstants) {
  if (new RegExp(`\\b${constantName}\\b`, "u").test(m47PlannerRegion)) {
    throw new Error(`M4.7 planner region references frozen oracle constant ${constantName}.`);
  }
}
if (/universe/iu.test(m47PlannerRegion)) {
  throw new Error("M4.7 planner region references the oracle universe.");
}
const m47OraclePlannerIsolated = true;
if (
  m47OracleProfile !== manifest.acceptance.m47OracleProfile ||
  m47OracleUniverseDigestDomain !== manifest.acceptance.m47OracleUniverseDigestDomain ||
  m47OracleRecordDigestDomain !== manifest.acceptance.m47OracleRecordDigestDomain ||
  m47OracleCheckDigestDomain !== manifest.acceptance.m47OracleCheckDigestDomain ||
  m47OracleCheckSetDigestDomain !== manifest.acceptance.m47OracleCheckSetDigestDomain ||
  m47OracleChangeDigestDomain !== manifest.acceptance.m47OracleChangeDigestDomain ||
  m47OracleFreezeDigestDomain !== manifest.acceptance.m47OracleFreezeDigestDomain ||
  m47OraclePlanDigestDomain !== manifest.acceptance.m47OraclePlanDigestDomain ||
  m47OracleResultDigestDomain !== manifest.acceptance.m47OracleResultDigestDomain ||
  m47OracleGraphDigest !== manifest.acceptance.m47OracleGraphDigest ||
  m47OracleExpectedUniverseDigest !== manifest.acceptance.m47OracleExpectedUniverseDigest ||
  m47OracleExpectedCheckSetDigest !== manifest.acceptance.m47OracleExpectedCheckSetDigest ||
  m47OracleExpectedFreezeDigest !== manifest.acceptance.m47OracleExpectedFreezeDigest ||
  m47OracleExpectedKnownChangeDigest !== manifest.acceptance.m47OracleExpectedKnownChangeDigest ||
  m47OracleExpectedUnresolvedChangeDigest !== manifest.acceptance.m47OracleExpectedUnresolvedChangeDigest ||
  m47OracleExpectedKnownPlanDigest !== manifest.acceptance.m47OracleExpectedKnownPlanDigest ||
  m47OracleExpectedUnresolvedPlanDigest !== manifest.acceptance.m47OracleExpectedUnresolvedPlanDigest ||
  m47OracleExpectedResultDigest !== manifest.acceptance.m47OracleExpectedResultDigest ||
  canonicalJson(m47OracleAtomicCheckIds) !==
    canonicalJson(manifest.acceptance.m47OracleAtomicCheckIds) ||
  m47OracleAtomicCheckIds.length !== manifest.acceptance.m47OracleAtomicChecks ||
  m47OracleRepeatedRuns !== manifest.acceptance.m47OracleRepeatedRuns ||
  canonicalJson(m47OracleDenominatorNegativeControlIds) !==
    canonicalJson(manifest.acceptance.m47OracleDenominatorNegativeControlIds) ||
  m47OracleDenominatorNegativeControlIds.length !==
    manifest.acceptance.m47OracleDenominatorNegativeControls ||
  m47OraclePlannerIsolated !== manifest.acceptance.m47OraclePlannerIsolated
) {
  throw new Error("M4.7 frozen-set oracle source contract differs from the Stage 5 acceptance manifest.");
}
const m47bReducerAtomicCheckIds = frozenSourceStringArray(
  "M47B_REDUCER_ATOMIC_CHECK_IDS",
);
const m47bReducerDenominatorNegativeControlIds = frozenSourceStringArray(
  "M47B_REDUCER_DENOMINATOR_NEGATIVE_CONTROL_IDS",
);
const m47bReducerRepeatedRunsMatch = sourceText.match(
  /const M47B_REDUCER_REPEATED_RUNS = ([0-9]+) as const;/u,
);
const m47bReducerRepeatedRuns = Number(m47bReducerRepeatedRunsMatch?.[1]);
const m47bReducerProfile = frozenSourceStringConstant("M47B_REDUCER_PROFILE");
const m47bReducerEventDigestDomain = frozenSourceStringConstant(
  "M47B_REDUCER_EVENT_DIGEST_DOMAIN",
);
const m47bReducerChainDigestDomain = frozenSourceStringConstant(
  "M47B_REDUCER_CHAIN_DIGEST_DOMAIN",
);
const m47bReducerTerminalStateDigestDomain = frozenSourceStringConstant(
  "M47B_REDUCER_TERMINAL_STATE_DIGEST_DOMAIN",
);
const m47bReducerReceiptDigestDomain = frozenSourceStringConstant(
  "M47B_REDUCER_RECEIPT_DIGEST_DOMAIN",
);
const m47bReducerResultDigestDomain = frozenSourceStringConstant(
  "M47B_REDUCER_RESULT_DIGEST_DOMAIN",
);
const m47bReducerExpectedGenesisDigest = frozenSourceStringConstant(
  "M47B_REDUCER_EXPECTED_GENESIS_DIGEST",
);
const m47bReducerExpectedEventChainDigest = frozenSourceStringConstant(
  "M47B_REDUCER_EXPECTED_EVENT_CHAIN_DIGEST",
);
const m47bReducerExpectedTerminalStateDigest = frozenSourceStringConstant(
  "M47B_REDUCER_EXPECTED_TERMINAL_STATE_DIGEST",
);
const m47bReducerExpectedReceiptDigest = frozenSourceStringConstant(
  "M47B_REDUCER_EXPECTED_RECEIPT_DIGEST",
);
const m47bReducerExpectedResultDigest = frozenSourceStringConstant(
  "M47B_REDUCER_EXPECTED_RESULT_DIGEST",
);
// Structural separation (roadmap M4.7 Phase B): the isolated pure-reducer region may never
// reference the caller-supplied terminal-state hint, under its exact name or any renamed
// parameter — the hint may influence only the post-hoc diagnostic fields assembled outside
// this region. Enforced from source bytes, not from any claim in the fixture.
const m47bReducerOuterRegion = exactMarkerRegion(
  "// M47B_INERT_GENESIS_EVENT_REDUCER_BEGIN",
  "// M47B_INERT_GENESIS_EVENT_REDUCER_END",
  "M4.7 Phase B genesis-event reducer",
);
const m47bReducerInnerRegion = exactMarkerRegion(
  "// M47B_REDUCER_BEGIN", "// M47B_REDUCER_END", "M4.7 Phase B pure reducer",
);
if (!m47bReducerOuterRegion.includes(m47bReducerInnerRegion)) {
  throw new Error("M4.7 Phase B pure reducer region must nest inside the outer genesis-event reducer region.");
}
if (/\bcallerSuppliedTerminalStateHint\b/u.test(m47bReducerInnerRegion)) {
  throw new Error("M4.7 Phase B pure reducer region references the caller-supplied terminal-state hint.");
}
if (/hint/iu.test(m47bReducerInnerRegion)) {
  throw new Error("M4.7 Phase B pure reducer region references a hint under any name.");
}
const m47bReducerHintIsolated = true;
if (
  m47bReducerProfile !== manifest.acceptance.m47bReducerProfile ||
  m47bReducerEventDigestDomain !== manifest.acceptance.m47bReducerEventDigestDomain ||
  m47bReducerChainDigestDomain !== manifest.acceptance.m47bReducerChainDigestDomain ||
  m47bReducerTerminalStateDigestDomain !== manifest.acceptance.m47bReducerTerminalStateDigestDomain ||
  m47bReducerReceiptDigestDomain !== manifest.acceptance.m47bReducerReceiptDigestDomain ||
  m47bReducerResultDigestDomain !== manifest.acceptance.m47bReducerResultDigestDomain ||
  m47bReducerExpectedGenesisDigest !== manifest.acceptance.m47bReducerExpectedGenesisDigest ||
  m47bReducerExpectedEventChainDigest !== manifest.acceptance.m47bReducerExpectedEventChainDigest ||
  m47bReducerExpectedTerminalStateDigest !== manifest.acceptance.m47bReducerExpectedTerminalStateDigest ||
  m47bReducerExpectedReceiptDigest !== manifest.acceptance.m47bReducerExpectedReceiptDigest ||
  m47bReducerExpectedResultDigest !== manifest.acceptance.m47bReducerExpectedResultDigest ||
  canonicalJson(m47bReducerAtomicCheckIds) !==
    canonicalJson(manifest.acceptance.m47bReducerAtomicCheckIds) ||
  m47bReducerAtomicCheckIds.length !== manifest.acceptance.m47bReducerAtomicChecks ||
  m47bReducerRepeatedRuns !== manifest.acceptance.m47bReducerRepeatedRuns ||
  canonicalJson(m47bReducerDenominatorNegativeControlIds) !==
    canonicalJson(manifest.acceptance.m47bReducerDenominatorNegativeControlIds) ||
  m47bReducerDenominatorNegativeControlIds.length !==
    manifest.acceptance.m47bReducerDenominatorNegativeControls ||
  m47bReducerHintIsolated !== manifest.acceptance.m47bReducerHintIsolated
) {
  throw new Error("M4.7 Phase B genesis-event reducer source contract differs from the Stage 5 acceptance manifest.");
}
const m4jJourneyAtomicCheckIds = frozenSourceStringArray(
  "M4J_JOURNEY_ATOMIC_CHECK_IDS",
);
const m4jJourneyDenominatorNegativeControlIds = frozenSourceStringArray(
  "M4J_JOURNEY_DENOMINATOR_NEGATIVE_CONTROL_IDS",
);
const m4jJourneyLimitations = frozenSourceStringArray("M4J_JOURNEY_LIMITATIONS");
const m4jJourneyRepeatedRunsMatch = sourceText.match(
  /const M4J_JOURNEY_REPEATED_RUNS = ([0-9]+) as const;/u,
);
const m4jJourneyRepeatedRuns = Number(m4jJourneyRepeatedRunsMatch?.[1]);
const m4jJourneyProfile = frozenSourceStringConstant("M4J_JOURNEY_PROFILE");
const m4jStageDigestDomain = frozenSourceStringConstant("M4J_STAGE_DIGEST_DOMAIN");
const m4jCheckDigestDomain = frozenSourceStringConstant("M4J_CHECK_DIGEST_DOMAIN");
const m4jExplainDigestDomain = frozenSourceStringConstant("M4J_EXPLAIN_DIGEST_DOMAIN");
const m4jPromoteDigestDomain = frozenSourceStringConstant("M4J_PROMOTE_DIGEST_DOMAIN");
const m4jDependencyEventDigestDomain = frozenSourceStringConstant(
  "M4J_DEPENDENCY_EVENT_DIGEST_DOMAIN",
);
const m4jRecallDigestDomain = frozenSourceStringConstant("M4J_RECALL_DIGEST_DOMAIN");
const m4jReplayDigestDomain = frozenSourceStringConstant("M4J_REPLAY_DIGEST_DOMAIN");
const m4jResultDigestDomain = frozenSourceStringConstant("M4J_RESULT_DIGEST_DOMAIN");
const m4jStageExpectedDigest = frozenSourceStringConstant("M4J_STAGE_EXPECTED_DIGEST");
const m4jCheckExpectedDigest = frozenSourceStringConstant("M4J_CHECK_EXPECTED_DIGEST");
const m4jExplainExpectedDigest = frozenSourceStringConstant("M4J_EXPLAIN_EXPECTED_DIGEST");
const m4jPromoteExpectedDigest = frozenSourceStringConstant("M4J_PROMOTE_EXPECTED_DIGEST");
const m4jDependencyEventExpectedDigest = frozenSourceStringConstant(
  "M4J_DEPENDENCY_EVENT_EXPECTED_DIGEST",
);
const m4jRecallExpectedDigest = frozenSourceStringConstant("M4J_RECALL_EXPECTED_DIGEST");
const m4jReplayExpectedDigest = frozenSourceStringConstant("M4J_REPLAY_EXPECTED_DIGEST");
const m4jResultExpectedDigest = frozenSourceStringConstant("M4J_RESULT_EXPECTED_DIGEST");
// M4J binds, and never owns, the two frozen M4.6 external inputs. Enforced from source bytes:
// the aliases must be plain re-bindings of the already extracted M4.6 constants.
const m4jExpectedSubjectDigest = m46MinimumFixtureSubjectDigest;
const m4jExpectedGraphDigest = m46MinimumFixtureGraphDigest;
if (
  !/const M4J_EXPECTED_SUBJECT_DIGEST = M46_MINIMUM_FIXTURE_SUBJECT_DIGEST;/u.test(sourceText) ||
  !/const M4J_EXPECTED_GRAPH_DIGEST = M46_MINIMUM_FIXTURE_GRAPH_DIGEST;/u.test(sourceText)
) {
  throw new Error("M4J must bind the frozen M4.6 subject and graph digests, not restate them.");
}
// Structural separation (roadmap M4J): the isolated replay region derives entirely from the
// already validated recall record. It may never reference any of the five upstream journey
// record types, nor any of their frozen expected digests, so replay cannot shortcut the six
// joints by peeking at the raw upstream records. Enforced from source bytes, not from any
// claim in the fixture.
const m4jJourneyOuterRegion = exactMarkerRegion(
  "// M4J_INERT_PRODUCT_JOURNEY_BEGIN",
  "// M4J_INERT_PRODUCT_JOURNEY_END",
  "M4J inert no-execution product journey",
);
const m4jReplayRegion = exactMarkerRegion(
  "// M4J_REPLAY_BEGIN", "// M4J_REPLAY_END", "M4J replay",
);
if (!m4jJourneyOuterRegion.includes(m4jReplayRegion)) {
  throw new Error("M4J replay region must nest inside the outer product journey region.");
}
const m4jReplayForbiddenNames = new Set([
  "M4JStageFixtureV1",
  "M4JCheckFixtureV1",
  "M4JExplainFixtureV1",
  "M4JPromoteFixtureV1",
  "M4JDependencyEventFixtureV1",
  "M4J_STAGE_EXPECTED_DIGEST",
  "M4J_CHECK_EXPECTED_DIGEST",
  "M4J_EXPLAIN_EXPECTED_DIGEST",
  "M4J_PROMOTE_EXPECTED_DIGEST",
  "M4J_DEPENDENCY_EVENT_EXPECTED_DIGEST",
  // Replay's own expectation and the whole-journey expectation are forbidden too: a region that
  // consulted the digest it is supposed to produce would be self-fulfilling.
  "M4J_REPLAY_EXPECTED_DIGEST",
  "M4J_RESULT_EXPECTED_DIGEST",
]);
// Non-vacuity, in the direction the scan itself cannot supply: each forbidden name must actually
// exist in the source outside the replay region. Without this, renaming or deleting an upstream
// type silently turns the absence test into a tautology while the gate stays green.
const m4jSourceOutsideReplayRegion = sourceText.split(m4jReplayRegion).join("\n");
for (const upstreamName of m4jReplayForbiddenNames) {
  if (!new RegExp(`\\b${upstreamName}\\b`, "u").test(m4jSourceOutsideReplayRegion)) {
    throw new Error(
      `M4J replay isolation is vacuous: ${upstreamName} does not exist outside the replay region.`,
    );
  }
}
// Alias laundering, closed exactly as M4.7A closes it: any top-level constant whose initializer
// reaches a forbidden name becomes forbidden too, to fixpoint. A flat name scan alone is defeated
// by `const M4J_UPSTREAM_ORACLE = M4J_STAGE_EXPECTED_DIGEST;` declared outside and read inside.
const m4jSourceConstChunks = topLevelConstChunks(sourceText);
for (let changed = true; changed;) {
  changed = false;
  for (const [name, chunk] of m4jSourceConstChunks) {
    if (m4jReplayForbiddenNames.has(name)) continue;
    for (const protectedName of m4jReplayForbiddenNames) {
      if (new RegExp(`\\b${protectedName}\\b`, "u").test(chunk)) {
        m4jReplayForbiddenNames.add(name);
        changed = true;
        break;
      }
    }
  }
}
for (const upstreamName of m4jReplayForbiddenNames) {
  if (new RegExp(`\\b${upstreamName}\\b`, "u").test(m4jReplayRegion)) {
    throw new Error(`M4J replay region references upstream journey record ${upstreamName}.`);
  }
}
// Name-independent layers, for the smuggling channels no name list can enumerate. A mutable
// module-level carrier written during upstream construction and read here, or an extra parameter
// on the replay entry point, would both make replay a function of something other than the
// validated recall while passing every name scan.
const m4jTopLevelMutableBindings = [
  ...sourceText.matchAll(/^(?:let|var) ([A-Za-z0-9_$]+)/gmu),
].map((match) => match[1]);
for (const mutableName of m4jTopLevelMutableBindings) {
  if (new RegExp(`\\b${mutableName}\\b`, "u").test(m4jReplayRegion)) {
    throw new Error(`M4J replay region reads module-level mutable binding ${mutableName}.`);
  }
}
const m4jReplayEntrySignature =
  "function createM4JReplayFixture(recall: M4JRecallFixtureV1): M4JReplayFixtureV1 {";
if (
  m4jReplayRegion.indexOf(m4jReplayEntrySignature) < 0 ||
  m4jReplayRegion.indexOf(m4jReplayEntrySignature) !==
    m4jReplayRegion.lastIndexOf(m4jReplayEntrySignature) ||
  [...m4jReplayRegion.matchAll(/function createM4JReplayFixture\(/gu)].length !== 1
) {
  throw new Error("M4J replay entry point must take exactly the validated recall record.");
}
const m4jReplayUpstreamIsolated = true;
if (
  m4jJourneyProfile !== manifest.acceptance.m4jJourneyProfile ||
  m4jStageDigestDomain !== manifest.acceptance.m4jStageDigestDomain ||
  m4jCheckDigestDomain !== manifest.acceptance.m4jCheckDigestDomain ||
  m4jExplainDigestDomain !== manifest.acceptance.m4jExplainDigestDomain ||
  m4jPromoteDigestDomain !== manifest.acceptance.m4jPromoteDigestDomain ||
  m4jDependencyEventDigestDomain !== manifest.acceptance.m4jDependencyEventDigestDomain ||
  m4jRecallDigestDomain !== manifest.acceptance.m4jRecallDigestDomain ||
  m4jReplayDigestDomain !== manifest.acceptance.m4jReplayDigestDomain ||
  m4jResultDigestDomain !== manifest.acceptance.m4jResultDigestDomain ||
  m4jExpectedSubjectDigest !== manifest.acceptance.m4jExpectedSubjectDigest ||
  m4jExpectedGraphDigest !== manifest.acceptance.m4jExpectedGraphDigest ||
  m4jStageExpectedDigest !== manifest.acceptance.m4jStageExpectedDigest ||
  m4jCheckExpectedDigest !== manifest.acceptance.m4jCheckExpectedDigest ||
  m4jExplainExpectedDigest !== manifest.acceptance.m4jExplainExpectedDigest ||
  m4jPromoteExpectedDigest !== manifest.acceptance.m4jPromoteExpectedDigest ||
  m4jDependencyEventExpectedDigest !== manifest.acceptance.m4jDependencyEventExpectedDigest ||
  m4jRecallExpectedDigest !== manifest.acceptance.m4jRecallExpectedDigest ||
  m4jReplayExpectedDigest !== manifest.acceptance.m4jReplayExpectedDigest ||
  m4jResultExpectedDigest !== manifest.acceptance.m4jResultExpectedDigest ||
  canonicalJson(m4jJourneyAtomicCheckIds) !==
    canonicalJson(manifest.acceptance.m4jJourneyAtomicCheckIds) ||
  m4jJourneyAtomicCheckIds.length !== manifest.acceptance.m4jJourneyAtomicChecks ||
  m4jJourneyRepeatedRuns !== manifest.acceptance.m4jJourneyRepeatedRuns ||
  canonicalJson(m4jJourneyDenominatorNegativeControlIds) !==
    canonicalJson(manifest.acceptance.m4jJourneyDenominatorNegativeControlIds) ||
  m4jJourneyDenominatorNegativeControlIds.length !==
    manifest.acceptance.m4jJourneyDenominatorNegativeControls ||
  canonicalJson(m4jJourneyLimitations) !==
    canonicalJson(manifest.acceptance.m4jJourneyLimitations) ||
  m4jReplayUpstreamIsolated !== manifest.acceptance.m4jReplayUpstreamIsolated
) {
  throw new Error("M4J inert no-execution product journey source contract differs from the Stage 5 acceptance manifest.");
}
const fi0Profile = frozenSourceStringConstant("FI0_INCIDENT_PROFILE");
const fi0DigestDomains = {
  context: frozenSourceStringConstant("FI0_CONTEXT_DIGEST_DOMAIN"),
  subjectId: frozenSourceStringConstant("FI0_SUBJECT_ID_DIGEST_DOMAIN"),
  subjectContent: frozenSourceStringConstant("FI0_SUBJECT_CONTENT_DIGEST_DOMAIN"),
  subjectLineage: frozenSourceStringConstant("FI0_SUBJECT_LINEAGE_DIGEST_DOMAIN"),
  evidenceLocator: frozenSourceStringConstant("FI0_EVIDENCE_LOCATOR_DIGEST_DOMAIN"),
  evidenceContent: frozenSourceStringConstant("FI0_EVIDENCE_CONTENT_DIGEST_DOMAIN"),
  evidenceRef: frozenSourceStringConstant("FI0_EVIDENCE_REF_DIGEST_DOMAIN"),
  evidenceSet: frozenSourceStringConstant("FI0_EVIDENCE_SET_DIGEST_DOMAIN"),
  evidenceManifest: frozenSourceStringConstant("FI0_EVIDENCE_MANIFEST_DIGEST_DOMAIN"),
  observationKey: frozenSourceStringConstant("FI0_OBSERVATION_KEY_DIGEST_DOMAIN"),
  incident: frozenSourceStringConstant("FI0_INCIDENT_DIGEST_DOMAIN"),
  event: frozenSourceStringConstant("FI0_EVENT_DIGEST_DOMAIN"),
  externalGenesis: frozenSourceStringConstant("FI0_EXTERNAL_GENESIS_DIGEST_DOMAIN"),
  chainHead: frozenSourceStringConstant("FI0_CHAIN_HEAD_DIGEST_DOMAIN"),
  provenance: frozenSourceStringConstant("FI0_PROVENANCE_DIGEST_DOMAIN"),
  importEnvelope: frozenSourceStringConstant("FI0_IMPORT_ENVELOPE_DIGEST_DOMAIN"),
  view: frozenSourceStringConstant("FI0_VIEW_DIGEST_DOMAIN"),
  baselineBundle: frozenSourceStringConstant("FI0_BASELINE_BUNDLE_DIGEST_DOMAIN"),
};
const fi0ExpectedDigests = {
  externalGenesis: frozenSourceStringConstant("FI0_EXPECTED_EXTERNAL_GENESIS_DIGEST"),
  evidenceManifest: frozenSourceStringConstant("FI0_EXPECTED_EVIDENCE_MANIFEST_DIGEST"),
  incident: frozenSourceStringConstant("FI0_EXPECTED_INCIDENT_DIGEST"),
  eventChainHead: frozenSourceStringConstant("FI0_EXPECTED_EVENT_ROOT_DIGEST"),
  importEnvelope: frozenSourceStringConstant("FI0_EXPECTED_IMPORT_ENVELOPE_DIGEST"),
  view: frozenSourceStringConstant("FI0_EXPECTED_VIEW_DIGEST"),
  baselineBundle: frozenSourceStringConstant("FI0_EXPECTED_BASELINE_BUNDLE_DIGEST"),
};
const fi0BaselineFailureModes = frozenSourceStringArray("FI0_BASELINE_FAILURE_MODES");
const fi0AtomicCheckIds = frozenSourceStringArray("FI0_ATOMIC_CHECK_IDS");
const fi0DenominatorNegativeControlIds = frozenSourceStringArray(
  "FI0_DENOMINATOR_NEGATIVE_CONTROL_IDS",
);
const fi0RepeatedRunsMatch = sourceText.match(
  /const FI0_REPEATED_RUNS = ([0-9]+) as const;/u,
);
const fi0RepeatedRuns = Number(fi0RepeatedRunsMatch?.[1]);
if (
  fi0Profile !== manifest.acceptance.fi0Profile ||
  canonicalJson(fi0DigestDomains) !== canonicalJson(manifest.acceptance.fi0DigestDomains) ||
  canonicalJson(fi0ExpectedDigests) !== canonicalJson(manifest.acceptance.fi0ExpectedDigests) ||
  canonicalJson(fi0BaselineFailureModes) !==
    canonicalJson(manifest.acceptance.fi0BaselineFailureModes) ||
  canonicalJson(fi0AtomicCheckIds) !== canonicalJson(manifest.acceptance.fi0AtomicCheckIds) ||
  fi0AtomicCheckIds.length !== manifest.acceptance.fi0AtomicChecks ||
  fi0RepeatedRuns !== manifest.acceptance.fi0RepeatedRuns ||
  canonicalJson(fi0DenominatorNegativeControlIds) !==
    canonicalJson(manifest.acceptance.fi0DenominatorNegativeControlIds) ||
  fi0DenominatorNegativeControlIds.length !==
    manifest.acceptance.fi0DenominatorNegativeControls
) {
  throw new Error("FI-0 source contract differs from the Stage 5 acceptance manifest.");
}
const fi03Profile = frozenSourceStringConstant("FI03_PROFILE");
const fi03CanonicalVectorId = frozenSourceStringConstant("FI03_CANONICAL_VECTOR_ID");
const fi03ExpectedCanonicalVectorSha256 = frozenSourceStringConstant(
  "FI03_EXPECTED_CANONICAL_VECTOR_SHA256",
);
const fi03ExpectedSemanticSummarySha256 = frozenSourceStringConstant(
  "FI03_EXPECTED_SEMANTIC_SUMMARY_SHA256",
);
const fi03CaseIds = frozenSourceStringArray("FI03_CASE_IDS");
const fi03DenominatorNegativeControlIds = frozenSourceStringArray(
  "FI03_DENOMINATOR_NEGATIVE_CONTROL_IDS",
);
const fi03RepeatedRunsMatch = sourceText.match(
  /const FI03_REPEATED_RUNS = ([0-9]+) as const;/u,
);
const fi03RepeatedRuns = Number(fi03RepeatedRunsMatch?.[1]);
if (
  fi03Profile !== manifest.acceptance.fi03Profile ||
  fi03CanonicalVectorId !== manifest.acceptance.fi03CanonicalVectorId ||
  fi03ExpectedCanonicalVectorSha256 !==
    manifest.acceptance.fi03ExpectedCanonicalVectorSha256 ||
  fi03ExpectedSemanticSummarySha256 !==
    manifest.acceptance.fi03ExpectedSemanticSummarySha256 ||
  canonicalJson(fi03CaseIds) !== canonicalJson(manifest.acceptance.fi03CaseIds) ||
  fi03RepeatedRuns !== manifest.acceptance.fi03RepeatedRuns ||
  canonicalJson(fi03DenominatorNegativeControlIds) !==
    canonicalJson(manifest.acceptance.fi03DenominatorNegativeControlIds) ||
  fi03DenominatorNegativeControlIds.length !==
    manifest.acceptance.fi03DenominatorNegativeControls
) {
  throw new Error("FI0.3 source contract differs from the Stage 5 acceptance manifest.");
}

if (
  observedDigestManifestSha256 !== manifest.digestManifestSha256 ||
  manifest.digestManifestSha256 !== stage5Root.digestManifestSha256
) {
  throw new Error("Stage 5 digest manifest differs from the root-manifest binding.");
}
const digests = await readJson(digestPath);
exactKeys(digests, ["schemaVersion", "profile", "files"], "stage5 digest manifest");
if (digests.schemaVersion !== 1 || digests.profile !== "veritas-stage5-hashed-files-v1") {
  throw new Error("Stage 5 digest manifest header differs.");
}
const digestFiles = Object.keys(digests.files).sort();
if (canonicalJson(digestFiles) !== canonicalJson(manifest.hashedFiles)) {
  throw new Error("Stage 5 digest paths differ from the frozen file manifest.");
}
const digestMismatches = [];
for (const path of manifest.hashedFiles) {
  const observed = await sha256File(resolve(repositoryRoot, path));
  if (digests.files[path] !== observed) {
    digestMismatches.push({ path, expected: digests.files[path], observed });
  }
}
if (digestMismatches.length > 0) {
  throw new Error(`Stage 5 file digest mismatch: ${canonicalJson(digestMismatches)}`);
}

const registry = await readJson(resolve(toolingRoot, "contracts/schema-registry.json"));
const schemaDirectory = resolve(toolingRoot, "schemas");
if (!(await lstat(schemaDirectory)).isDirectory()) throw new Error("SCHEMA_DIRECTORY_NOT_REGULAR");
const diskSchemas = (await readdir(schemaDirectory)).filter(name => name.endsWith(".schema.json"))
  .map(name => `tooling/schemas/${name}`).sort();
assertSchemaRegistryClosure(registry, diskSchemas);
const corpus = await readJson(resolve(toolingRoot, "contracts/schema-corpus.json"));
const closure = assertSchemaCorpusClosure(registry, corpus);
const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
  validateFormats: true,
});
ajv.addFormat("veritas-canonical-iso-instant", {
  type: "string",
  validate: (value) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
  },
});
const validators = new Map();
for (const entry of registry.schemas) {
  const schemaPath = resolve(repositoryRoot, entry.path);
  if (!(await lstat(schemaPath)).isFile()) throw new Error("SCHEMA_FILE_NOT_REGULAR");
  const schema = await readJson(schemaPath);
  if (schema.$id !== entry.id || schema.additionalProperties !== false) {
    throw new Error(`Schema identity or unknown-field policy differs for ${entry.id}.`);
  }
  validators.set(entry.id, ajv.compile(schema));
}

let validCases = 0;
let invalidCases = 0;
for (const group of corpus.corpus) {
  const validate = validators.get(group.schemaId);
  if (!validate) throw new Error(`Corpus references unknown schema ${group.schemaId}.`);
  for (const value of group.valid) {
    const before = canonicalJson(value);
    if (!validate(value)) throw new Error(`Valid schema fixture failed for ${group.schemaId}: ${canonicalJson(validate.errors)}`);
    if (canonicalJson(value) !== before) throw new Error(`Schema validator mutated valid input for ${group.schemaId}.`);
    validCases += 1;
  }
  for (const fixture of group.invalid) {
    const before = canonicalJson(fixture.value);
    if (validate(fixture.value)) throw new Error(`Invalid schema fixture passed: ${fixture.id}.`);
    if (canonicalJson(fixture.value) !== before) throw new Error(`Schema validator mutated invalid input ${fixture.id}.`);
    invalidCases += 1;
  }
}
if (validCases !== closure.validCases || invalidCases !== closure.invalidCases) {
  throw new Error("SCHEMA_CORPUS_EXECUTION_DENOMINATOR");
}
// Execute the identity/denominator regression suite in the normal contract gate.
// A successful standalone run must not be inferred from a listed package script.
const closureTests = spawnSync(process.execPath, [
  "--test", "--test-reporter=tap", resolve(toolingRoot, "tests/schema-registry-completeness.test.mjs"),
], { cwd: repositoryRoot, encoding: "utf8", timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
const closureTestCount = Number(closureTests.stdout?.match(/^# tests (\d+)$/mu)?.[1]);
const closurePassCount = Number(closureTests.stdout?.match(/^# pass (\d+)$/mu)?.[1]);
if (closureTests.error || closureTests.status !== 0 || closureTests.signal !== null ||
    closureTests.stderr !== "" || !Number.isSafeInteger(closureTestCount) ||
    closureTestCount !== manifest.acceptance.schemaClosureTests || closurePassCount !== closureTestCount ||
    !/^# fail 0$/mu.test(closureTests.stdout) || !/^# skipped 0$/mu.test(closureTests.stdout) ||
    !/^# cancelled 0$/mu.test(closureTests.stdout) || !/^# todo 0$/mu.test(closureTests.stdout)) {
  throw new Error("SCHEMA_CLOSURE_TEST_GATE_FAILED");
}
const m46CorpusGroup = corpus.corpus.find(
  (group) => group.schemaId ===
    "https://veritas.invalid/private/schemas/stage5/assurance-dependency-closure.v1.json",
);
const m46CorpusFixture = m46CorpusGroup?.valid?.[0];
if (
  m46CorpusGroup === undefined ||
  m46CorpusGroup.valid.length !== 1 ||
  m46CorpusFixture?.profile !== m46DependencyClosureProfile ||
  m46CorpusFixture?.subjectDigest !== m46MinimumFixtureSubjectDigest ||
  m46CorpusFixture?.graphDigest !== m46MinimumFixtureGraphDigest
) {
  throw new Error("M4.6 source constants differ from the Stage 5 dependency-closure corpus fixture.");
}
const m46RecallCorpusGroup = corpus.corpus.find(
  (group) => group.schemaId ===
    "https://veritas.invalid/private/schemas/stage5/assurance-recall-before-reuse.v1.json",
);
const m46RecallCorpusFixture = m46RecallCorpusGroup?.valid?.[0];
if (
  m46RecallCorpusGroup === undefined ||
  m46RecallCorpusGroup.valid.length !== 1 ||
  m46RecallCorpusFixture?.profile !== m46RecallProfile ||
  m46RecallCorpusFixture?.graphDigest !== m46RecallGraphDigest ||
  m46RecallCorpusFixture?.receiptSetDigest !== m46RecallExpectedReceiptSetDigest ||
  m46RecallCorpusFixture?.beforeStateDigest !== m46RecallExpectedBeforeStateDigest ||
  m46RecallCorpusFixture?.eventDigest !== m46RecallExpectedEventDigest ||
  m46RecallCorpusFixture?.barrierStateDigest !== m46RecallExpectedBarrierStateDigest ||
  m46RecallCorpusFixture?.afterStateDigest !== m46RecallExpectedAfterStateDigest ||
  m46RecallCorpusFixture?.resultDigest !== m46RecallExpectedResultDigest ||
  m46RecallCorpusFixture?.authorizing !== false ||
  m46RecallCorpusFixture?.mayConsume !== false ||
  m46RecallCorpusFixture?.mayRecall !== false ||
  m46RecallCorpusFixture?.actualRecallPerformed !== false ||
  m46RecallCorpusFixture?.receiptConsumed !== false ||
  m46RecallCorpusFixture?.mayCreateDecision !== false ||
  m46RecallCorpusFixture?.mayPromote !== false ||
  m46RecallCorpusFixture?.mayReplay !== false ||
  m46RecallCorpusFixture?.mayInstall !== false ||
  m46RecallCorpusFixture?.mayExecute !== false ||
  m46RecallCorpusFixture?.filesystemMutated !== false ||
  m46RecallCorpusFixture?.networkRequested !== false ||
  m46RecallCorpusFixture?.subprocessStarted !== false ||
  m46RecallCorpusFixture?.dynamicLoadAttempted !== false ||
  m46RecallCorpusFixture?.coordinatorMutated !== false
) {
  throw new Error("M4.6 scoped-recall source constants differ from the Stage 5 corpus fixture.");
}
function oneValidCorpusFixture(schemaId) {
  const group = corpus.corpus.find((entry) => entry.schemaId === schemaId);
  if (group === undefined || group.valid.length !== 1 || group.invalid.length !== 2) {
    throw new Error(`FI-0 corpus denominator differs for ${schemaId}.`);
  }
  return group.valid[0];
}
const fi0EvidenceRefCorpusGroup = corpus.corpus.find(
  (entry) => entry.schemaId ===
    "https://veritas.invalid/private/schemas/stage5/fi0-evidence-ref.v1.json",
);
if (
  fi0EvidenceRefCorpusGroup === undefined ||
  fi0EvidenceRefCorpusGroup.valid.length !== 2 ||
  fi0EvidenceRefCorpusGroup.invalid.length !== 2
) {
  throw new Error("FI-0 evidence-reference corpus denominator differs.");
}
const fi0EvidenceRefCorpusFixtures = fi0EvidenceRefCorpusGroup.valid;
const fi0EvidenceManifestCorpusFixture = oneValidCorpusFixture(
  "https://veritas.invalid/private/schemas/stage5/fi0-evidence-manifest.v1.json",
);
const fi0IncidentCorpusFixture = oneValidCorpusFixture(
  "https://veritas.invalid/private/schemas/stage5/fi0-incident.v1.json",
);
const fi0EventCorpusFixture = oneValidCorpusFixture(
  "https://veritas.invalid/private/schemas/stage5/fi0-event.v1.json",
);
const fi0ImportCorpusFixture = oneValidCorpusFixture(
  "https://veritas.invalid/private/schemas/stage5/fi0-historical-import-envelope.v1.json",
);
const fi0ViewCorpusFixture = oneValidCorpusFixture(
  "https://veritas.invalid/private/schemas/stage5/fi0-view.v1.json",
);
const fi0ViewFalseFields = [
  "authorizing", "protectedAuthorityVerified", "mayCapture", "mayImport",
  "mayAdjudicate", "mayConfirm", "mayPromote", "mayRetrieve", "mayInjectContext",
  "mayRepair", "mayChangePolicy", "mayCertify", "mayRecall", "mayReplay",
  "mayInstall", "mayExecute", "filesystemMutated", "networkRequested",
  "subprocessStarted", "dynamicLoadAttempted", "coordinatorMutated",
  "generatedArtifactExecuted", "crossProjectRead", "baselineMutated",
];
if (
  fi0EvidenceRefCorpusFixtures.some((fixture) =>
    fixture.profile !== fi0Profile ||
    fixture.scopeId !== fi0IncidentCorpusFixture.scopeId ||
    fixture.projectIdDigest !== fi0IncidentCorpusFixture.projectIdDigest ||
    !/^[0-9a-f]{64}$/u.test(fixture.issuerIdDigest) ||
    fixture.subjectType !== fi0IncidentCorpusFixture.subjectType ||
    fixture.subjectIdDigest !== fi0IncidentCorpusFixture.subjectIdDigest ||
    fixture.subjectContentDigest !== fi0IncidentCorpusFixture.subjectContentDigest ||
    fixture.evidenceOutcome !== "FAIL"
  ) ||
  new Set(fi0EvidenceRefCorpusFixtures.map((fixture) => fixture.refId)).size !== 2 ||
  new Set(fi0EvidenceRefCorpusFixtures.map((fixture) => fixture.refDigest)).size !== 2 ||
  fi0EvidenceManifestCorpusFixture.profile !== fi0Profile ||
  fi0EvidenceManifestCorpusFixture.scopeId !== fi0IncidentCorpusFixture.scopeId ||
  fi0EvidenceManifestCorpusFixture.projectIdDigest !== fi0IncidentCorpusFixture.projectIdDigest ||
  fi0EvidenceManifestCorpusFixture.sourceStreamId !== fi0IncidentCorpusFixture.sourceStreamId ||
  fi0EvidenceManifestCorpusFixture.sourceStreamHeadDigest !==
    fi0IncidentCorpusFixture.sourceStreamHeadDigest ||
  fi0EvidenceManifestCorpusFixture.expectedRefCount !== 2 ||
  canonicalJson(fi0EvidenceManifestCorpusFixture.evidenceRefDigests) !==
    canonicalJson(fi0EvidenceRefCorpusFixtures.map((fixture) => fixture.refDigest)) ||
  fi0EvidenceManifestCorpusFixture.evidenceSetDigest !==
    fi0IncidentCorpusFixture.evidenceSetDigest ||
  fi0EvidenceManifestCorpusFixture.manifestDigest !== fi0ExpectedDigests.evidenceManifest ||
  fi0IncidentCorpusFixture.profile !== fi0Profile ||
  fi0IncidentCorpusFixture.evidenceManifestDigest !== fi0ExpectedDigests.evidenceManifest ||
  fi0IncidentCorpusFixture.incidentDigest !== fi0ExpectedDigests.incident ||
  fi0IncidentCorpusFixture.adjudicationState !== "CANDIDATE" ||
  fi0IncidentCorpusFixture.foundationOnly !== true ||
  fi0IncidentCorpusFixture.authorizing !== false ||
  fi0EventCorpusFixture.profile !== fi0Profile ||
  fi0EventCorpusFixture.incidentDigest !== fi0ExpectedDigests.incident ||
  fi0EventCorpusFixture.predecessorDigest !== fi0ExpectedDigests.externalGenesis ||
  fi0EventCorpusFixture.nextState !== "INCONCLUSIVE" ||
  fi0EventCorpusFixture.protectedAuthorityVerified !== false ||
  fi0EventCorpusFixture.authorizing !== false ||
  fi0ImportCorpusFixture.profile !== fi0Profile ||
  fi0ImportCorpusFixture.incidentDigest !== fi0ExpectedDigests.incident ||
  fi0ImportCorpusFixture.eventChainHeadDigest !== fi0ExpectedDigests.eventChainHead ||
  fi0ImportCorpusFixture.envelopeDigest !== fi0ExpectedDigests.importEnvelope ||
  fi0ImportCorpusFixture.importPerformed !== false ||
  fi0ImportCorpusFixture.historicalFactsVerified !== false ||
  fi0ImportCorpusFixture.mayImport !== false ||
  fi0ViewCorpusFixture.profile !== fi0Profile ||
  fi0ViewCorpusFixture.incidentDigest !== fi0ExpectedDigests.incident ||
  fi0ViewCorpusFixture.evidenceManifestDigest !== fi0ExpectedDigests.evidenceManifest ||
  fi0ViewCorpusFixture.eventChainHeadDigest !== fi0ExpectedDigests.eventChainHead ||
  fi0ViewCorpusFixture.historicalImportEnvelopeDigest !== fi0ExpectedDigests.importEnvelope ||
  fi0ViewCorpusFixture.baselineBundleDigest !== fi0ExpectedDigests.baselineBundle ||
  fi0ViewCorpusFixture.viewDigest !== fi0ExpectedDigests.view ||
  fi0ViewCorpusFixture.adjudicationState !== "INCONCLUSIVE" ||
  fi0ViewCorpusFixture.historyEventCount !== 3 ||
  fi0ViewFalseFields.some((field) => fi0ViewCorpusFixture[field] !== false)
) {
  throw new Error("FI-0 source constants differ from the six Stage 5 corpus fixture groups.");
}

const e16 = await readJson(resolve(toolingRoot, "contracts/e16-manifest.json"));
exactKeys(
  e16,
  ["schemaVersion", "experimentId", "manifestVersion", "status", "evidenceClass", "denominator", "familyDenominators", "cases", "credits"],
  "E16 preparation manifest",
);
if (
  e16.schemaVersion !== 1 ||
  e16.experimentId !== "E16" ||
  e16.manifestVersion !== "stage5-preparation-v1" ||
  e16.evidenceClass !== "SELF_ADMINISTERED_STRUCTURAL_PREPARATION"
) {
  throw new Error("E16 preparation manifest identity or evidence class differs.");
}
const e16CreditKeys = [
  "protectedAuthority", "nativeRuntime", "t164ThroughT183", "m4",
  "e16", "patent", "production", "release",
];
exactKeys(e16.credits, e16CreditKeys, "E16 preparation credits");
const validateE16 = validators.get("https://veritas.invalid/private/schemas/stage5/e16-case.v1.json");
if (!validateE16) throw new Error("E16 schema is missing from the registry.");
if (e16.status !== "NOT_RUN" || e16.denominator !== e16.cases.length || e16.denominator !== manifest.acceptance.e16PreparedCases) {
  throw new Error("E16 manifest denominator or NOT_RUN status differs.");
}
const caseIds = new Set();
const familyCounts = {};
for (const fixture of e16.cases) {
  if (!validateE16(fixture)) throw new Error(`E16 fixture failed schema ${fixture.caseId}: ${canonicalJson(validateE16.errors)}`);
  if (caseIds.has(fixture.caseId)) throw new Error(`Duplicate E16 case ${fixture.caseId}.`);
  caseIds.add(fixture.caseId);
  familyCounts[fixture.family] = (familyCounts[fixture.family] ?? 0) + 1;
}
if (canonicalJson(familyCounts) !== canonicalJson(e16.familyDenominators)) {
  throw new Error(`E16 family denominators differ: ${canonicalJson(familyCounts)}.`);
}
if (Object.values(e16.credits).some((value) => value !== false)) {
  throw new Error("E16 preparation cannot claim experiment or product credit.");
}

const e16ReferenceScenarioPath = resolve(toolingRoot, "contracts/e16-reference-scenarios.json");
const e16ReferenceScenarios = await readJson(e16ReferenceScenarioPath);
exactKeys(
  e16ReferenceScenarios,
  [
    "schemaVersion", "profile", "manifestSha256", "evidenceClass", "caseDenominator",
    "familyDenominators", "scenarios", "credits",
  ],
  "E16 pure-reference scenario set",
);
if (
  e16ReferenceScenarios.schemaVersion !== 1 ||
  e16ReferenceScenarios.profile !== "veritas-e16-stage5-pure-reference-model-v1" ||
  e16ReferenceScenarios.evidenceClass !== "SELF_ADMINISTERED_PURE_REFERENCE_MODEL" ||
  e16ReferenceScenarios.manifestSha256 !== await sha256File(resolve(toolingRoot, "contracts/e16-manifest.json")) ||
  e16ReferenceScenarios.caseDenominator !== 24 ||
  canonicalJson(e16ReferenceScenarios.familyDenominators) !== canonicalJson(e16.familyDenominators)
) {
  throw new Error("E16 pure-reference scenario identity, manifest binding, or denominator differs.");
}
exactKeys(e16ReferenceScenarios.credits, e16CreditKeys, "E16 pure-reference scenario credits");
if (Object.values(e16ReferenceScenarios.credits).some((value) => value !== false)) {
  throw new Error("E16 pure-reference scenarios cannot claim experiment or product credit.");
}
const e16ById = new Map(e16.cases.map((fixture) => [fixture.caseId, fixture]));
const validateE16ReferenceScenario = validators.get(
  "https://veritas.invalid/private/schemas/stage5/e16-reference-scenario.v1.json",
);
if (!validateE16ReferenceScenario) throw new Error("E16 pure-reference scenario schema is missing from the registry.");
const referenceScenarioIds = new Set();
const referenceMutationKinds = new Set();
const referenceFamilyCounts = {};
for (const scenario of e16ReferenceScenarios.scenarios) {
  if (!validateE16ReferenceScenario(scenario)) {
    throw new Error(
      `E16 pure-reference scenario failed schema ${scenario.caseId}: ${canonicalJson(validateE16ReferenceScenario.errors)}`,
    );
  }
  exactKeys(
    scenario,
    ["caseId", "family", "mutationKind", "injectionPoint", "modelAssumption"],
    `E16 pure-reference scenario ${scenario.caseId}`,
  );
  const manifestCase = e16ById.get(scenario.caseId);
  if (
    manifestCase === undefined ||
    manifestCase.family !== scenario.family ||
    typeof scenario.mutationKind !== "string" ||
    scenario.mutationKind.length < 8 ||
    typeof scenario.injectionPoint !== "string" ||
    scenario.injectionPoint.length < 8 ||
    typeof scenario.modelAssumption !== "string" ||
    scenario.modelAssumption.length < 24
  ) {
    throw new Error(`E16 pure-reference scenario is invalid for ${scenario.caseId}.`);
  }
  if (referenceScenarioIds.has(scenario.caseId)) throw new Error(`Duplicate E16 pure-reference case ${scenario.caseId}.`);
  if (referenceMutationKinds.has(scenario.mutationKind)) throw new Error(`Duplicate E16 pure-reference mutation ${scenario.mutationKind}.`);
  referenceScenarioIds.add(scenario.caseId);
  referenceMutationKinds.add(scenario.mutationKind);
  referenceFamilyCounts[scenario.family] = (referenceFamilyCounts[scenario.family] ?? 0) + 1;
}
if (
  e16ReferenceScenarios.scenarios.length !== e16ReferenceScenarios.caseDenominator ||
  canonicalJson([...referenceScenarioIds].sort()) !== canonicalJson([...caseIds].sort()) ||
  canonicalJson(referenceFamilyCounts) !== canonicalJson(e16.familyDenominators)
) {
  throw new Error("E16 pure-reference scenario set or family counts differ from the frozen manifest.");
}

const e16ImplementationContract = await readJson(
  resolve(toolingRoot, "contracts/e16-implementation-subset.json"),
);
exactKeys(
  e16ImplementationContract,
  [
    "schemaVersion", "profile", "status", "evidenceClass", "officialE16ManifestSha256",
    "officialE16ManifestStatus", "officialE16CaseDenominator",
    "localImplementationFixtureSelectedCases", "expectedCounters",
    "localFixtureNegativeControlIds", "limitations", "credits",
  ],
  "E16 implementation-subset contract",
);
exactKeys(
  e16ImplementationContract.expectedCounters,
  [
    "officialE16NotRunCases", "officialE16ExecutedCases", "officialE16PassedCases",
    "officialE16CreditedCases", "localImplementationFixtureSelectedUniqueCases",
    "localImplementationFixtureExecutedUniqueCases",
    "localImplementationFixturePassedUniqueCases", "localImplementationFixtureRunsPerCase",
    "localImplementationFixtureCaseRunExecutions",
    "officialCaseIdentitiesNotSelectedForLocalFixture", "localFixtureOfficialE16CreditCases",
  ],
  "E16 implementation-subset counters",
);
exactKeys(e16ImplementationContract.credits, e16CreditKeys, "E16 implementation-subset credits");
const e16ImplementationSchema = await readJson(
  resolve(toolingRoot, "schemas/e16-implementation-result.schema.json"),
);
const e16ImplementationEnvironmentDiagnosticSchema = await readJson(
  resolve(toolingRoot, "schemas/e16-implementation-environment-diagnostic.schema.json"),
);
if (
  e16ImplementationSchema.$id !==
    "https://veritas.invalid/private/schemas/stage5/e16-implementation-result.v1.json" ||
  e16ImplementationSchema.additionalProperties !== false ||
  e16ImplementationEnvironmentDiagnosticSchema.$id !==
    "https://veritas.invalid/private/schemas/stage5/e16-implementation-environment-diagnostic.v1.json" ||
  e16ImplementationEnvironmentDiagnosticSchema.additionalProperties !== false
) {
  throw new Error("E16 implementation schema identity or unknown-field policy differs.");
}
// Both schemas are also registered in schema-registry.json (as of the
// 2026-09-03 completeness fix) and already compiled once by the registry
// loop above into the same shared `ajv` instance; compiling them again here
// throws ("schema with key or id ... already exists"). The identity/policy
// pinning above stays -- it is a stronger, literal-string check than the
// registry loop's entry.id comparison -- only the redundant compile is gone.
const implementationCaseIds =
  e16ImplementationContract.localImplementationFixtureSelectedCases.map((selected) => {
    exactKeys(
      selected,
      ["caseId", "family", "injectionPoint", "expectedOutcome"],
      `E16 implementation-subset case ${selected.caseId}`,
    );
    const frozen = e16ById.get(selected.caseId);
    if (
      frozen === undefined ||
      frozen.family !== selected.family ||
      frozen.expectedOutcome !== selected.expectedOutcome ||
      frozen.runStatus !== "NOT_RUN" ||
      typeof selected.injectionPoint !== "string" ||
      selected.injectionPoint.length < 8
    ) {
      throw new Error(
        `E16 implementation-subset case ${selected.caseId} differs from the frozen manifest.`,
      );
    }
    return selected.caseId;
  });
if (
  e16ImplementationContract.schemaVersion !== 1 ||
  e16ImplementationContract.profile !== "veritas-e16-local-apfs-process-subset-v1" ||
  e16ImplementationContract.status !== "PREPARED_E16_IMPLEMENTATION_LOCAL_APFS_PROCESS_SUBSET" ||
  e16ImplementationContract.evidenceClass !==
    "SELF_ADMINISTERED_IMPLEMENTATION_LOCAL_APFS_PROCESS_FIXTURE" ||
  e16ImplementationContract.officialE16ManifestSha256 !== await sha256File(
    resolve(toolingRoot, "contracts/e16-manifest.json"),
  ) ||
  e16ImplementationContract.officialE16ManifestStatus !== "NOT_RUN" ||
  e16ImplementationContract.officialE16CaseDenominator !== e16.denominator ||
  implementationCaseIds.length !== 4 ||
  new Set(implementationCaseIds).size !== implementationCaseIds.length ||
  e16ImplementationContract.expectedCounters.officialE16NotRunCases !== 24 ||
  e16ImplementationContract.expectedCounters.officialE16ExecutedCases !== 0 ||
  e16ImplementationContract.expectedCounters.officialE16PassedCases !== 0 ||
  e16ImplementationContract.expectedCounters.officialE16CreditedCases !== 0 ||
  e16ImplementationContract.expectedCounters.localImplementationFixtureSelectedUniqueCases !== 4 ||
  e16ImplementationContract.expectedCounters.localImplementationFixtureExecutedUniqueCases !== 4 ||
  e16ImplementationContract.expectedCounters.localImplementationFixturePassedUniqueCases !== 4 ||
  e16ImplementationContract.expectedCounters.localImplementationFixtureRunsPerCase !== 2 ||
  e16ImplementationContract.expectedCounters.localImplementationFixtureCaseRunExecutions !== 8 ||
  e16ImplementationContract.expectedCounters.officialCaseIdentitiesNotSelectedForLocalFixture !== 20 ||
  e16ImplementationContract.expectedCounters.localFixtureOfficialE16CreditCases !== 0 ||
  e16ImplementationContract.expectedCounters.officialE16NotRunCases !==
    e16.cases.filter((fixture) => fixture.runStatus === "NOT_RUN").length ||
  e16ImplementationContract.expectedCounters.localImplementationFixtureCaseRunExecutions !==
    implementationCaseIds.length *
      e16ImplementationContract.expectedCounters.localImplementationFixtureRunsPerCase ||
  e16ImplementationContract.expectedCounters.localImplementationFixturePassedUniqueCases >
    e16ImplementationContract.expectedCounters.localImplementationFixtureExecutedUniqueCases ||
  e16ImplementationContract.expectedCounters.officialCaseIdentitiesNotSelectedForLocalFixture !==
    e16.denominator - implementationCaseIds.length ||
  e16ImplementationContract.localFixtureNegativeControlIds.length !== 2 ||
  new Set(e16ImplementationContract.localFixtureNegativeControlIds).size !== 2 ||
  e16ImplementationContract.limitations.length !== 9 ||
  Object.values(e16ImplementationContract.credits).some((value) => value !== false)
) {
  throw new Error("E16 implementation-subset contract identity, counts, or evidence ceiling differs.");
}

const e14ManifestPath = resolve(toolingRoot, "contracts/e14-displacement-manifest.json");
const e14FreezeVerifierPath = resolve(toolingRoot, "scripts/e14-freeze-verifier.mjs");
const e14Manifest = await readJson(e14ManifestPath);
const e14Cases = e14Manifest.steps.flatMap((step) => step.cases);
const e14CaseIds = e14Cases.map((fixture) => fixture.caseId);
const e14CaseSetDigest = sha256Canonical(e14Cases);
const e14ManifestSha256 = await sha256File(e14ManifestPath);
const e14VerifierSourceSha256 = await sha256File(e14FreezeVerifierPath);
const e14ExpectedStepIds = [
  "S01", "S02", "S03", "S04", "S05", "S06",
  "S07", "S08", "S09", "S10", "S11", "S12",
];
const e14ExpectedStepDenominators = {
  S01: 2, S02: 5, S03: 6, S04: 5, S05: 3, S06: 2,
  S07: 1, S08: 2, S09: 2, S10: 6, S11: 6, S12: 2,
};
const e14ExpectedComparisonClasses = [
  "local-code-change-gate",
  "supply-chain-attestation",
  "agent-action-policy",
  "failure-to-policy",
  "policy-replay",
  "reviewed-strong-composite",
];
const e14ExpectedControlIds = ["EMPTY", "MISSING", "DUPLICATE", "EXTRA", "REORDERED"];
const e14ValidateCase = validators.get(
  "https://veritas.invalid/private/schemas/stage5/e14-displacement-case.v1.json",
);
if (!e14ValidateCase) throw new Error("E14 displacement case schema is missing from the registry.");
if (
  e14Manifest.schemaVersion !== 1 || e14Manifest.experimentId !== "E14" ||
  e14Manifest.profile !== "veritas-e14-assurance-continuity-displacement-v1" ||
  e14Manifest.statusCeiling !== "FROZEN_E14_SCENARIO_ONLY" ||
  e14Manifest.evidenceClass !== "SELF_ADMINISTERED_SCENARIO_FREEZE" ||
  e14Manifest.runStatus !== "NOT_RUN" || e14Manifest.e14ExecutedCases !== 0 ||
  e14Manifest.comparisonRuns !== 0 || e14Manifest.fairnessStatus !== "NOT_ASSESSED" ||
  canonicalJson(e14Manifest.orderedStepIds) !== canonicalJson(e14ExpectedStepIds) ||
  canonicalJson(e14Manifest.stepDenominators) !== canonicalJson(e14ExpectedStepDenominators) ||
  canonicalJson(e14Manifest.comparisonClasses) !== canonicalJson(e14ExpectedComparisonClasses) ||
  e14Cases.length !== 42 || new Set(e14CaseIds).size !== 42 ||
  e14Cases.some((fixture) => !e14ValidateCase(fixture) || fixture.runStatus !== "NOT_RUN") ||
  canonicalJson(e14Manifest.denominatorControls.map((control) => control.id)) !==
    canonicalJson(e14ExpectedControlIds) ||
  e14Manifest.caseSlotsPerFreshStoreRepetition !== 42 ||
  e14Manifest.repetitionsPerComparisonPair !== 2 ||
  e14Manifest.pairedCaseSlotsPerComparisonPair !== 84 ||
  e14Manifest.laneResultSlotsPerComparisonPair !== 168 ||
  Object.values(e14Manifest.credits).some((value) => value !== false)
) {
  throw new Error("E14 scenario freeze identity, denominator, NOT_RUN ceiling, or zero-credit boundary differs.");
}
const m07E14Freeze = {
  profile: e14Manifest.profile,
  statusCeiling: e14Manifest.statusCeiling,
  manifestSha256: e14ManifestSha256,
  caseSetDigest: e14CaseSetDigest,
  verifierSourceSha256: e14VerifierSourceSha256,
  orderedStepIds: e14Manifest.orderedStepIds,
  stepDenominators: e14Manifest.stepDenominators,
  caseIds: e14CaseIds,
  caseSlotsPerFreshStoreRepetition: e14Manifest.caseSlotsPerFreshStoreRepetition,
  repetitionsPerComparisonPair: e14Manifest.repetitionsPerComparisonPair,
  pairedCaseSlotsPerComparisonPair: e14Manifest.pairedCaseSlotsPerComparisonPair,
  laneResultSlotsPerComparisonPair: e14Manifest.laneResultSlotsPerComparisonPair,
  structuralCaseSlotChecks:
    e14Manifest.caseSlotsPerFreshStoreRepetition * e14Manifest.repetitionsPerComparisonPair,
  comparisonClasses: e14Manifest.comparisonClasses,
  denominatorNegativeControlIds: e14ExpectedControlIds,
  denominatorNegativeControls: e14ExpectedControlIds.length,
  runStatus: e14Manifest.runStatus,
  e14ExecutedCases: e14Manifest.e14ExecutedCases,
  comparisonRuns: e14Manifest.comparisonRuns,
  comparisonFairness: e14Manifest.fairnessStatus,
};
if (canonicalJson(manifest.acceptance.m07E14Freeze) !== canonicalJson(m07E14Freeze)) {
  throw new Error("M0.7 E14 scenario freeze differs from the Stage 5 acceptance binding.");
}

const vectors = await readJson(resolve(toolingRoot, "contracts/canonical-vectors.json"));
const vectorResults = vectors.vectors.map((vector) => {
  const canonical = canonicalJson(vector.value);
  const sha256 = sha256Canonical(vector.value);
  return {
    id: vector.id,
    canonicalMatches: canonical === vector.canonical,
    digestMatches: sha256 === vector.sha256,
    sha256,
  };
});
if (vectorResults.some((result) => !result.canonicalMatches || !result.digestMatches)) {
  throw new Error(`Canonical vectors differ: ${canonicalJson(vectorResults)}.`);
}
const m46CanonicalVector = vectors.vectors.find(
  (vector) => vector.id === "CANON-S5-007-M46-DEPENDENCY-CLOSURE-INERT",
);
if (
  m46CanonicalVector?.value?.profile !== m46DependencyClosureProfile ||
  m46CanonicalVector?.value?.referenceSubjectDigest !== m46MinimumFixtureSubjectDigest ||
  m46CanonicalVector?.value?.referenceGraphDigest !== m46MinimumFixtureGraphDigest
) {
  throw new Error("M4.6 source constants differ from the Stage 5 canonical vector.");
}
const m46RecallCanonicalVector = vectors.vectors.find(
  (vector) => vector.id === "CANON-S5-008-M46-RECALL-BEFORE-REUSE-INERT",
);
if (
  m46RecallCanonicalVector?.value?.status !== "DERIVED_INERT" ||
  m46RecallCanonicalVector?.value?.profile !== m46RecallProfile ||
  m46RecallCanonicalVector?.value?.subjectDigest !== m46RecallSubjectDigest ||
  m46RecallCanonicalVector?.value?.graphDigest !== m46RecallGraphDigest ||
  m46RecallCanonicalVector?.value?.receiptSetDigest !== m46RecallExpectedReceiptSetDigest ||
  m46RecallCanonicalVector?.value?.beforeStateDigest !== m46RecallExpectedBeforeStateDigest ||
  m46RecallCanonicalVector?.value?.eventDigest !== m46RecallExpectedEventDigest ||
  m46RecallCanonicalVector?.value?.barrierStateDigest !== m46RecallExpectedBarrierStateDigest ||
  m46RecallCanonicalVector?.value?.afterStateDigest !== m46RecallExpectedAfterStateDigest ||
  m46RecallCanonicalVector?.value?.resultDigest !== m46RecallExpectedResultDigest ||
  canonicalJson(m46RecallCanonicalVector?.value?.ledgerRevisions) !== canonicalJson([7, 8]) ||
  m46RecallCanonicalVector?.value?.affectedDisposition !== "REFUSED_RECALL_REQUIRED" ||
  m46RecallCanonicalVector?.value?.unrelatedDisposition !==
    "MEASURED_UNAFFECTED_NONAUTHORIZING" ||
  m46RecallCanonicalVector?.value?.externalCompletenessVerified !== false ||
  m46RecallCanonicalVector?.value?.realEventObserved !== false ||
  m46RecallCanonicalVector?.value?.protectedMonotonicStateVerified !== false ||
  m46RecallCanonicalVector?.value?.mayConsume !== false ||
  m46RecallCanonicalVector?.value?.mayRecall !== false ||
  m46RecallCanonicalVector?.value?.actualRecallPerformed !== false ||
  m46RecallCanonicalVector?.value?.receiptConsumed !== false ||
  m46RecallCanonicalVector?.value?.mayReplay !== false ||
  m46RecallCanonicalVector?.value?.mayExecute !== false ||
  m46RecallCanonicalVector?.value?.filesystemMutated !== false ||
  m46RecallCanonicalVector?.value?.networkRequested !== false ||
  m46RecallCanonicalVector?.value?.subprocessStarted !== false ||
  m46RecallCanonicalVector?.value?.dynamicLoadAttempted !== false ||
  m46RecallCanonicalVector?.value?.coordinatorMutated !== false
) {
  throw new Error("M4.6 scoped-recall source constants differ from the Stage 5 canonical vector.");
}
const fi0CanonicalVector = vectors.vectors.find(
  (vector) => vector.id === "CANON-S5-009-FI0-INERT-INCIDENT-CONTRACT",
);
const fi0CanonicalFalseFields = [
  "authorizing", "protectedAuthorityVerified", "importPerformed",
  "historicalFactsVerified", "mayCapture", "mayImport", "mayAdjudicate",
  "mayConfirm", "mayPromote", "mayRetrieve", "mayInjectContext", "mayRepair",
  "mayCertify", "mayExecute", "baselineMutated",
];
if (
  fi0CanonicalVector?.value?.status !== "DERIVED_INERT" ||
  fi0CanonicalVector?.value?.profile !== fi0Profile ||
  fi0CanonicalVector?.value?.externalGenesisDigest !== fi0ExpectedDigests.externalGenesis ||
  fi0CanonicalVector?.value?.evidenceManifestDigest !== fi0ExpectedDigests.evidenceManifest ||
  fi0CanonicalVector?.value?.incidentDigest !== fi0ExpectedDigests.incident ||
  fi0CanonicalVector?.value?.eventChainHeadDigest !== fi0ExpectedDigests.eventChainHead ||
  fi0CanonicalVector?.value?.importEnvelopeDigest !== fi0ExpectedDigests.importEnvelope ||
  fi0CanonicalVector?.value?.viewDigest !== fi0ExpectedDigests.view ||
  fi0CanonicalVector?.value?.baselineBundleDigest !== fi0ExpectedDigests.baselineBundle ||
  fi0CanonicalVector?.value?.incidentState !== "CANDIDATE" ||
  fi0CanonicalVector?.value?.viewState !== "INCONCLUSIVE" ||
  fi0CanonicalVector?.value?.eventCount !== 3 ||
  canonicalJson(fi0CanonicalVector?.value?.baselineFailureModes) !==
    canonicalJson(fi0BaselineFailureModes) ||
  fi0CanonicalFalseFields.some((field) => fi0CanonicalVector?.value?.[field] !== false)
) {
  throw new Error("FI-0 source constants differ from the Stage 5 canonical vector.");
}
const e14CanonicalVector = vectors.vectors.find(
  (vector) => vector.id === "CANON-S5-010-M07-E14-FROZEN-SCENARIO",
);
if (
  e14CanonicalVector?.value?.status !== "FROZEN_E14_SCENARIO_ONLY" ||
  e14CanonicalVector?.value?.profile !== m07E14Freeze.profile ||
  e14CanonicalVector?.value?.evidenceClass !== "SELF_ADMINISTERED_SCENARIO_FREEZE" ||
  e14CanonicalVector?.value?.manifestSha256 !== m07E14Freeze.manifestSha256 ||
  e14CanonicalVector?.value?.caseSetDigest !== m07E14Freeze.caseSetDigest ||
  e14CanonicalVector?.value?.verifierSourceSha256 !== m07E14Freeze.verifierSourceSha256 ||
  e14CanonicalVector?.value?.caseSlotsPerFreshStoreRepetition !== 42 ||
  e14CanonicalVector?.value?.repeatedStructuralPasses !== 2 ||
  e14CanonicalVector?.value?.structuralCaseSlotChecks !== 84 ||
  e14CanonicalVector?.value?.pairedCaseSlotsPerComparisonPair !== 84 ||
  e14CanonicalVector?.value?.laneResultSlotsPerComparisonPair !== 168 ||
  e14CanonicalVector?.value?.runStatus !== "NOT_RUN" ||
  e14CanonicalVector?.value?.e14ExecutedCases !== 0 ||
  e14CanonicalVector?.value?.comparisonRuns !== 0 ||
  e14CanonicalVector?.value?.comparisonFairness !== "NOT_ASSESSED" ||
  e14CanonicalVector?.value?.m07ScenarioFreezeValidated !== true ||
  Object.entries(e14CanonicalVector?.value ?? {})
    .filter(([key]) => key.endsWith("Credited"))
    .some(([_key, value]) => value !== false)
) {
  throw new Error("M0.7 E14 scenario canonical vector differs from the frozen zero-credit contract.");
}

const fi03WorkerPath = resolve(toolingRoot, "scripts/fi0-canonical-vector-worker.mjs");
const fi03WorkerVersion = "fi03-independent-canonicalizer-v1";
const fi03ProcessStatus = "PASS_PRIVATE_CROSS_PROCESS_CANONICAL_VECTOR_FIXTURE_ONLY";
const fi03NegativeControls = [
  ["FI0-XP-N01-VALUE-SUBSTITUTION", "REFUSE_CANONICAL_MISMATCH"],
  ["FI0-XP-N02-COHERENT-MUTATION-REDIGEST", "REFUSE_FROZEN_DIGEST_MISMATCH"],
  ["FI0-XP-N03-PROFILE-VERSION-MISMATCH", "REFUSE_PROFILE_MISMATCH"],
  ["FI0-XP-N04-OUTER-KEY-ORDER", "REFUSE_NONCANONICAL_ENVELOPE"],
  ["FI0-XP-N05-OUTER-WHITESPACE", "REFUSE_NONCANONICAL_ENVELOPE"],
  ["FI0-XP-N06-DUPLICATE-KEY", "REFUSE_NONCANONICAL_ENVELOPE"],
  ["FI0-XP-N07-CRLF", "REFUSE_NONCANONICAL_ENVELOPE"],
  ["FI0-XP-N08-INVALID-UTF8", "REFUSE_INVALID_UTF8"],
];

function parseFi03WorkerOutput(bytes) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("FI0.3 worker output is not strict UTF-8.");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("FI0.3 worker output is not one JSON record.");
  }
  if (text !== `${canonicalJson(parsed)}\n`) {
    throw new Error("FI0.3 worker output is not canonical JSON plus one newline.");
  }
  return parsed;
}

function verifyFi03ResultDigest(parsed) {
  const body = { ...parsed };
  const resultDigest = body.resultDigest;
  delete body.resultDigest;
  if (!/^[0-9a-f]{64}$/u.test(resultDigest) || resultDigest !== sha256Canonical(body)) {
    throw new Error("FI0.3 worker result digest differs.");
  }
}

function runFi03Worker(input, expectedStatus, expectedRefusalCode = null) {
  const result = spawnSync(process.execPath, [fi03WorkerPath], {
    cwd: toolingRoot,
    env: { LANG: "C", LC_ALL: "C" },
    input,
    timeout: 5_000,
    maxBuffer: 64 * 1024,
    killSignal: "SIGKILL",
    windowsHide: true,
    shell: false,
  });
  if (
    result.error !== undefined ||
    result.signal !== null ||
    !Buffer.isBuffer(result.stdout) ||
    !Buffer.isBuffer(result.stderr) ||
    result.stderr.length !== 0 ||
    result.stdout.length === 0
  ) {
    throw new Error("FI0.3 worker process violated its bounded transport contract.");
  }
  const parsed = parseFi03WorkerOutput(result.stdout);
  verifyFi03ResultDigest(parsed);
  if (expectedStatus === "PASS") {
    exactKeys(
      parsed,
      [
        "schemaVersion", "recordType", "profile", "workerVersion", "status", "vectorId",
        "canonicalSha256", "rawEnvelopeCanonical", "canonicalMatches", "digestMatches",
        "frozenDigestMatches", "processBoundaryObserved", "independentToolchainVerified",
        "authorizing", "protectedAuthorityVerified", "productIntegrationVerified",
        "resultDigest",
      ],
      "FI0.3 worker success result",
    );
    if (
      result.status !== 0 ||
      parsed.schemaVersion !== 1 ||
      parsed.recordType !== "FI03_CANONICAL_VECTOR_PROCESS_RESULT" ||
      parsed.profile !== fi03Profile ||
      parsed.workerVersion !== fi03WorkerVersion ||
      parsed.status !== fi03ProcessStatus ||
      parsed.vectorId !== fi03CanonicalVectorId ||
      parsed.canonicalSha256 !== fi03ExpectedCanonicalVectorSha256 ||
      parsed.rawEnvelopeCanonical !== true ||
      parsed.canonicalMatches !== true ||
      parsed.digestMatches !== true ||
      parsed.frozenDigestMatches !== true ||
      parsed.processBoundaryObserved !== true ||
      parsed.independentToolchainVerified !== false ||
      parsed.authorizing !== false ||
      parsed.protectedAuthorityVerified !== false ||
      parsed.productIntegrationVerified !== false
    ) {
      throw new Error("FI0.3 worker success result differs from its exact contract.");
    }
  } else {
    exactKeys(
      parsed,
      [
        "schemaVersion", "recordType", "profile", "workerVersion", "status",
        "refusalCode", "authorizing", "protectedAuthorityVerified",
        "productIntegrationVerified", "resultDigest",
      ],
      "FI0.3 worker refusal result",
    );
    if (
      result.status !== 2 ||
      parsed.schemaVersion !== 1 ||
      parsed.recordType !== "FI03_CANONICAL_VECTOR_PROCESS_REFUSAL" ||
      parsed.profile !== fi03Profile ||
      parsed.workerVersion !== fi03WorkerVersion ||
      parsed.status !== "REFUSED_EXPECTED" ||
      parsed.refusalCode !== expectedRefusalCode ||
      parsed.authorizing !== false ||
      parsed.protectedAuthorityVerified !== false ||
      parsed.productIntegrationVerified !== false
    ) {
      throw new Error(`FI0.3 worker refusal differs for ${String(expectedRefusalCode)}.`);
    }
  }
  return { parsed, stdout: result.stdout };
}

const fi03ValidEnvelope = {
  schemaVersion: 1,
  profile: fi03Profile,
  vectorId: fi03CanonicalVectorId,
  value: fi0CanonicalVector.value,
  canonical: fi0CanonicalVector.canonical,
  sha256: fi0CanonicalVector.sha256,
};
const fi03ValidEnvelopeBytes = Buffer.from(`${canonicalJson(fi03ValidEnvelope)}\n`, "utf8");
const fi03FirstProcess = runFi03Worker(fi03ValidEnvelopeBytes, "PASS");
const fi03SecondProcess = runFi03Worker(fi03ValidEnvelopeBytes, "PASS");
if (!fi03FirstProcess.stdout.equals(fi03SecondProcess.stdout)) {
  throw new Error("FI0.3 repeated valid process outputs are not byte-identical.");
}
const fi03ProcessCorpusFixture = oneValidCorpusFixture(
  "https://veritas.invalid/private/schemas/stage5/fi0-canonical-vector-process-result.v1.json",
);
if (canonicalJson(fi03ProcessCorpusFixture) !== canonicalJson(fi03FirstProcess.parsed)) {
  throw new Error("FI0.3 worker result differs from the registered valid schema fixture.");
}

const fi03SubstitutedValue = structuredClone(fi0CanonicalVector.value);
fi03SubstitutedValue.status = "MUTATED_INERT";
const fi03CoherentValue = structuredClone(fi0CanonicalVector.value);
fi03CoherentValue.status = "COHERENTLY_MUTATED_INERT";
const fi03CoherentCanonical = canonicalJson(fi03CoherentValue);
const fi03ProfileMismatchEnvelope = { ...fi03ValidEnvelope, profile: `${fi03Profile}-mismatch` };
const fi03RawInputs = [
  Buffer.from(`${canonicalJson({ ...fi03ValidEnvelope, value: fi03SubstitutedValue })}\n`, "utf8"),
  Buffer.from(`${canonicalJson({
    ...fi03ValidEnvelope,
    value: fi03CoherentValue,
    canonical: fi03CoherentCanonical,
    sha256: sha256Canonical(fi03CoherentValue),
  })}\n`, "utf8"),
  Buffer.from(`${canonicalJson(fi03ProfileMismatchEnvelope)}\n`, "utf8"),
  Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    profile: fi03Profile,
    vectorId: fi03CanonicalVectorId,
    value: fi0CanonicalVector.value,
    canonical: fi0CanonicalVector.canonical,
    sha256: fi0CanonicalVector.sha256,
  })}\n`, "utf8"),
  Buffer.concat([Buffer.from(" ", "utf8"), fi03ValidEnvelopeBytes]),
  Buffer.from(`{"schemaVersion":1,${fi03ValidEnvelopeBytes.toString("utf8").slice(1)}`, "utf8"),
  Buffer.concat([fi03ValidEnvelopeBytes.subarray(0, fi03ValidEnvelopeBytes.length - 1), Buffer.from("\r\n", "utf8")]),
  Buffer.from([0xc3, 0x28]),
];
if (fi03RawInputs.length !== fi03NegativeControls.length) {
  throw new Error("FI0.3 negative-control input denominator differs.");
}
const fi03NegativeControlResults = fi03NegativeControls.map(([id, refusalCode], index) => {
  const observed = runFi03Worker(fi03RawInputs[index], "REFUSAL", refusalCode).parsed;
  return {
    id,
    refusalCode,
    status: "REFUSED_EXPECTED",
    resultDigest: observed.resultDigest,
  };
});
const fi03CanonicalVectorProcessBody = {
  profile: fi03Profile,
  workerVersion: fi03WorkerVersion,
  workerSourceSha256: await sha256File(fi03WorkerPath),
  status: fi03ProcessStatus,
  vectorId: fi03CanonicalVectorId,
  vectorSha256: fi03ExpectedCanonicalVectorSha256,
  validProcessRuns: 2,
  deterministicRepeat: true,
  negativeControlIds: fi03NegativeControls.map(([id]) => id),
  negativeControls: fi03NegativeControls.length,
  negativeControlResults: fi03NegativeControlResults,
  processBoundaryObserved: true,
  sameHostSameOwnerOnly: true,
  independentToolchainVerified: false,
  authorizing: false,
  protectedAuthorityVerified: false,
  productIntegrationVerified: false,
};
const fi03CanonicalVectorProcess = {
  ...fi03CanonicalVectorProcessBody,
  resultDigest: sha256Canonical(fi03CanonicalVectorProcessBody),
};

const adrs = await readJson(resolve(toolingRoot, "contracts/architecture-decisions.json"));
if (adrs.statusCeiling !== "SELF_ADMINISTERED_STRUCTURAL_PREPARATION" || adrs.decisions.length !== manifest.acceptance.architectureDecisions) {
  throw new Error("Architecture decision count or status ceiling differs.");
}
const adrIds = new Set(adrs.decisions.map((decision) => decision.id));
if (adrIds.size !== adrs.decisions.length || adrs.decisions.some((decision) => decision.status !== "ACCEPTED_PRIVATE_FIXTURE")) {
  throw new Error("Architecture decisions must be unique accepted private-fixture records.");
}
if (!adrIds.has("ADR-S5-017") || !adrIds.has("ADR-S5-018") || !adrIds.has("ADR-S5-019")) {
  throw new Error("FI-0, FI0.3, or M0.7 E14 architecture decision is missing from the accepted private-fixture set.");
}

const observedCounts = {
  schemaClosureTests: closureTestCount,
  schemaValidCases: validCases,
  schemaInvalidCases: invalidCases,
  canonicalVectors: vectorResults.length,
  architectureDecisions: adrs.decisions.length,
  m37GitBaseManifestCaseIds,
  m37GitBaseManifestCases: m37GitBaseManifestCaseIds.length,
  m37GitBaseManifestRepeatedRuns,
  m37GitBaseManifestDenominatorNegativeControls:
    m37GitBaseManifestDenominatorNegativeControlIds.length,
  m37GitTreeDeltaAtomicCheckIds,
  m37GitTreeDeltaAtomicChecks: m37GitTreeDeltaAtomicCheckIds.length,
  m37GitTreeDeltaRepeatedRuns,
  m37GitTreeDeltaDenominatorNegativeControls:
    m37GitTreeDeltaDenominatorNegativeControlIds.length,
  m46DependencyClosureAtomicCheckIds,
  m46DependencyClosureAtomicChecks: m46DependencyClosureAtomicCheckIds.length,
  m46DependencyClosureRepeatedRuns,
  m46DependencyClosureProfile,
  m46DependencyNodeDigestDomain,
  m46DependencyEdgeDigestDomain,
  m46DependencyGraphDigestDomain,
  m46MinimumFixtureSubjectDigest,
  m46MinimumFixtureGraphDigest,
  m46DependencyClosureDenominatorNegativeControlIds,
  m46DependencyClosureDenominatorNegativeControls:
    m46DependencyClosureDenominatorNegativeControlIds.length,
  m46RecallProfile,
  m46RecallScopeDigestDomain,
  m46RecallReceiptDigestDomain,
  m46RecallReceiptSetDigestDomain,
  m46RecallEventDigestDomain,
  m46RecallStateDigestDomain,
  m46RecallResultDigestDomain,
  m46RecallSubjectDigest,
  m46RecallGraphDigest,
  m46RecallExpectedReceiptSetDigest,
  m46RecallExpectedBeforeStateDigest,
  m46RecallExpectedEventDigest,
  m46RecallExpectedBarrierStateDigest,
  m46RecallExpectedAfterStateDigest,
  m46RecallExpectedResultDigest,
  m46RecallAtomicCheckIds,
  m46RecallAtomicChecks: m46RecallAtomicCheckIds.length,
  m46RecallRepeatedRuns,
  m46RecallDenominatorNegativeControlIds,
  m46RecallDenominatorNegativeControls:
    m46RecallDenominatorNegativeControlIds.length,
  m47OracleProfile,
  m47OracleUniverseDigestDomain,
  m47OracleRecordDigestDomain,
  m47OracleCheckDigestDomain,
  m47OracleCheckSetDigestDomain,
  m47OracleChangeDigestDomain,
  m47OracleFreezeDigestDomain,
  m47OraclePlanDigestDomain,
  m47OracleResultDigestDomain,
  m47OracleGraphDigest,
  m47OracleExpectedUniverseDigest,
  m47OracleExpectedCheckSetDigest,
  m47OracleExpectedFreezeDigest,
  m47OracleExpectedKnownChangeDigest,
  m47OracleExpectedUnresolvedChangeDigest,
  m47OracleExpectedKnownPlanDigest,
  m47OracleExpectedUnresolvedPlanDigest,
  m47OracleExpectedResultDigest,
  m47OracleAtomicCheckIds,
  m47OracleAtomicChecks: m47OracleAtomicCheckIds.length,
  m47OracleRepeatedRuns,
  m47OracleDenominatorNegativeControlIds,
  m47OracleDenominatorNegativeControls:
    m47OracleDenominatorNegativeControlIds.length,
  m47OraclePlannerIsolated,
  fi0Profile,
  fi0DigestDomains,
  fi0ExpectedDigests,
  fi0BaselineFailureModes,
  fi0AtomicCheckIds,
  fi0AtomicChecks: fi0AtomicCheckIds.length,
  fi0RepeatedRuns,
  fi0DenominatorNegativeControlIds,
  fi0DenominatorNegativeControls: fi0DenominatorNegativeControlIds.length,
  fi03Profile,
  fi03CanonicalVectorId,
  fi03ExpectedCanonicalVectorSha256,
  fi03ExpectedSemanticSummarySha256,
  fi03CaseIds,
  fi03RepeatedRuns,
  fi03DenominatorNegativeControlIds,
  fi03DenominatorNegativeControls: fi03DenominatorNegativeControlIds.length,
  fi03CanonicalVectorProcess,
  m07E14Freeze,
  e16PreparedCases: e16.cases.length,
  e16ExecutedCases: e16.cases.filter((fixture) => fixture.runStatus !== "NOT_RUN").length,
  e16ReferenceModelCases: e16ReferenceScenarios.scenarios.length,
  e16ImplementationPreparedCases:
    e16ImplementationContract.localImplementationFixtureSelectedCases.length,
  e16ImplementationExecutedCases: 0,
  e16ImplementationCreditedCases:
    e16ImplementationContract.expectedCounters.localFixtureOfficialE16CreditCases,
  e16ImplementationNegativeControlsPrepared:
    e16ImplementationContract.localFixtureNegativeControlIds.length,
};
for (const [key, value] of Object.entries(observedCounts)) {
  if (canonicalJson(manifest.acceptance[key]) !== canonicalJson(value)) {
    throw new Error(`Stage 5 acceptance count ${key} expected ${manifest.acceptance[key]}, observed ${value}.`);
  }
}

const stage5RootDigest = await sha256File(rootPath);
const manifestDigest = observedStage5ManifestSha256;
const digestManifestDigest = observedDigestManifestSha256;
const result = {
  schemaVersion: 1,
  status: "PASS",
  stage5RootDigest,
  rootDigests,
  hashedFileCount: manifest.hashedFiles.length,
  manifestDigest,
  digestManifestDigest,
  schemaCount: registry.schemas.length,
  ...observedCounts,
  e16FamilyCounts: familyCounts,
  vectorResults,
  resultDigest: sha256Canonical({
    stage5RootDigest,
    manifestDigest,
    digestManifestDigest,
    rootDigests,
    digestFiles,
    observedCounts,
    familyCounts,
    vectorResults,
  }),
};
emitDeterministic(result);
