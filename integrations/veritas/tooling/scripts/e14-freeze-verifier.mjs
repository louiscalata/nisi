import Ajv2020 from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  canonicalJson,
  emitDeterministic,
  exactKeys,
  sha256Canonical,
  sha256File,
  toolingRoot,
} from "./common.mjs";

const profile = "veritas-e14-assurance-continuity-displacement-v1";
const statusCeiling = "FROZEN_E14_SCENARIO_ONLY";
const evidenceClass = "SELF_ADMINISTERED_SCENARIO_FREEZE";
const manifestPath = resolve(toolingRoot, "contracts/e14-displacement-manifest.json");
const schemaPath = resolve(toolingRoot, "schemas/e14-displacement-case.schema.json");
const verifierPath = resolve(toolingRoot, "scripts/e14-freeze-verifier.mjs");

const expectedSteps = Object.freeze([
  ["S01", "CLEAN", [
    "E14-S01-C01-CLEAN-ACCEPT-READBACK",
    "E14-S01-C02-CLEAN-CURRENT-REUSE",
  ]],
  ["S02", "SUBJECT_NONINHERITANCE", [
    "E14-S02-C01-RESPONSE-SUBSTITUTION",
    "E14-S02-C02-DECLARED-OUTPUT-SUBSTITUTION",
    "E14-S02-C03-CANDIDATE-SUBSTITUTION",
    "E14-S02-C04-ACCEPTED-ARTIFACT-SUBSTITUTION",
    "E14-S02-C05-DESTINATION-RESULT-SUBSTITUTION",
  ]],
  ["S03", "AUTHORITY_MUTATION", [
    "E14-S03-C01-POLICY-DIGEST-MUTATION",
    "E14-S03-C02-VERIFIER-SET-DIGEST-MUTATION",
    "E14-S03-C03-HOOK-SET-DIGEST-MUTATION",
    "E14-S03-C04-APPROVAL-BINDING-MUTATION",
    "E14-S03-C05-ADAPTER-SET-DIGEST-MUTATION",
    "E14-S03-C06-AUTHORITY-REFERENCE-MUTATION",
  ]],
  ["S04", "DESTINATION_SUBSTITUTION", [
    "E14-S04-C01-PREPARED-OBJECT-BYTES-SUBSTITUTION",
    "E14-S04-C02-ACCEPTED-REFERENCE-SUBSTITUTION",
    "E14-S04-C03-DESTINATION-BEFORE-READBACK-SUBSTITUTION",
    "E14-S04-C04-DESTINATION-AFTER-READBACK-SUBSTITUTION",
    "E14-S04-C05-SAME-PATH-EXECUTABLE-SUBSTITUTION",
  ]],
  ["S05", "CRASH_CONVERGENCE", [
    "E14-S05-C01-CRASH-AFTER-OBJECT-WRITE",
    "E14-S05-C02-CRASH-AFTER-REFERENCE-SWAP",
    "E14-S05-C03-CRASH-AFTER-READBACK-BEFORE-RECEIPT",
  ]],
  ["S06", "AFFECTING_RECALL", [
    "E14-S06-C01-DEPENDENCY-CORRECTION-CONCURRENT-REUSE",
    "E14-S06-C02-DEPENDENCY-REVOCATION-CONCURRENT-REUSE",
  ]],
  ["S07", "KNOWN_REPLAY", [
    "E14-S07-C01-KNOWN-GRAPH-MINIMUM-REPLAY-ORACLE",
  ]],
  ["S08", "UNRESOLVED_REPLAY", [
    "E14-S08-C01-AMBIGUOUS-GRAPH-EXHAUSTIVE-FALLBACK",
    "E14-S08-C02-MISSING-ORACLE-EXHAUSTIVE-FALLBACK",
  ]],
  ["S09", "UNRELATED_CHANGE", [
    "E14-S09-C01-UNRELATED-DEPENDENCY-CONTENT-CHANGE",
    "E14-S09-C02-UNRELATED-DEPENDENCY-REVOCATION",
  ]],
  ["S10", "ONE_USE_AND_CUSTODY", [
    "E14-S10-C01-DUPLICATE-PROMOTION-RETRY",
    "E14-S10-C02-LOST-SUCCESS-RETRY",
    "E14-S10-C03-CONCURRENT-RECEIPT-REUSE",
    "E14-S10-C04-WRONG-SUBJECT-CAPABILITY",
    "E14-S10-C05-WRONG-DESTINATION-CAPABILITY",
    "E14-S10-C06-REVOKED-OR-EXPIRED-CAPABILITY",
  ]],
  ["S11", "EVIDENCE_AND_REPLAY", [
    "E14-S11-C01-MISSING-REQUIRED-EVIDENCE",
    "E14-S11-C02-NOT-RUN-REQUIRED-EVIDENCE",
    "E14-S11-C03-MALFORMED-REQUIRED-EVIDENCE",
    "E14-S11-C04-STALE-OR-EXPIRED-EVIDENCE",
    "E14-S11-C05-WRONG-SUBJECT-EVIDENCE",
    "E14-S11-C06-CORRECTED-EVIDENCE-EXHAUSTIVE-REPLAY",
  ]],
  ["S12", "CLEAN_UNAFFECTED", [
    "E14-S12-C01-CLEAN-TWIN-AFTER-ADVERSARIAL-CASE",
    "E14-S12-C02-UNAFFECTED-RECEIPT-CURRENT-AFTER-CHANGE",
  ]],
]);

const expectedStepIds = expectedSteps.map(([stepId]) => stepId);
const expectedStepDenominators = Object.fromEntries(
  expectedSteps.map(([stepId, _family, caseIds]) => [stepId, caseIds.length]),
);
const expectedCaseIds = expectedSteps.flatMap(([_stepId, _family, caseIds]) => caseIds);
const expectedComparisonClasses = Object.freeze([
  "local-code-change-gate",
  "supply-chain-attestation",
  "agent-action-policy",
  "failure-to-policy",
  "policy-replay",
  "reviewed-strong-composite",
]);
const expectedControls = Object.freeze([
  ["EMPTY", "REFUSE_EMPTY_CASE_SET"],
  ["MISSING", "REFUSE_MISSING_CASE"],
  ["DUPLICATE", "REFUSE_DUPLICATE_CASE_ID"],
  ["EXTRA", "REFUSE_EXTRA_CASE"],
  ["REORDERED", "REFUSE_REORDERED_CASE_SET"],
]);
const creditKeys = Object.freeze([
  "technicalE14", "adoptionE14", "comparison", "m4", "uniqueness",
  "patent", "production", "signing", "release",
]);
const expectedLimitations = Object.freeze([
  "NO_E14_CASE_EXECUTION",
  "NO_COMPARISON_RUN",
  "NO_FAIRNESS_ASSESSMENT",
  "NO_OBSERVED_COMPETITIVE_ADVANTAGE",
  "NO_USER_ADOPTION_EVIDENCE",
  "NO_M4_UNIQUENESS_PATENT_PRODUCTION_SIGNING_OR_RELEASE_CREDIT",
]);

const manifestTextFirst = await readFile(manifestPath, "utf8");
const manifestTextSecond = await readFile(manifestPath, "utf8");
const parsedFirst = JSON.parse(manifestTextFirst);
const parsedSecond = JSON.parse(manifestTextSecond);
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
if (
  schema.$id !== "https://veritas.invalid/private/schemas/stage5/e14-displacement-case.v1.json" ||
  schema.additionalProperties !== false
) {
  throw new Error("E14 case schema identity or unknown-field policy differs.");
}
const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
const validateCaseSchema = ajv.compile(schema);

function flattenCases(manifest) {
  return manifest.steps.flatMap((step) => step.cases);
}

function classifyCaseSet(cases) {
  if (cases.length === 0) return "REFUSE_EMPTY_CASE_SET";
  const ids = cases.map((item) => item.caseId);
  if (new Set(ids).size !== ids.length) return "REFUSE_DUPLICATE_CASE_ID";
  if (cases.length < expectedCaseIds.length) return "REFUSE_MISSING_CASE";
  if (cases.length > expectedCaseIds.length) return "REFUSE_EXTRA_CASE";
  const observedSet = new Set(ids);
  if (expectedCaseIds.some((id) => !observedSet.has(id))) return "REFUSE_MISSING_CASE";
  if (ids.some((id) => !expectedCaseIds.includes(id))) return "REFUSE_EXTRA_CASE";
  if (canonicalJson(ids) !== canonicalJson(expectedCaseIds)) return "REFUSE_REORDERED_CASE_SET";
  return "ACCEPT_FROZEN_CASE_SET";
}

function validateManifest(manifest) {
  exactKeys(
    manifest,
    [
      "schemaVersion", "experimentId", "profile", "statusCeiling", "runStatus",
      "evidenceClass", "caseSlotsPerFreshStoreRepetition",
      "repetitionsPerComparisonPair", "pairedCaseSlotsPerComparisonPair",
      "laneResultSlotsPerComparisonPair", "e14ExecutedCases", "comparisonRuns",
      "orderedStepIds", "stepDenominators", "comparisonClasses", "fairnessStatus",
      "freshStorePolicy", "barrierProtocol", "steps", "denominatorControls",
      "payloadBindingProbe", "primaryMetrics", "secondaryMeasurements",
      "decisionRules", "limitations", "credits",
    ],
    "E14 displacement manifest",
  );
  if (
    manifest.schemaVersion !== 1 || manifest.experimentId !== "E14" ||
    manifest.profile !== profile || manifest.statusCeiling !== statusCeiling ||
    manifest.runStatus !== "NOT_RUN" || manifest.evidenceClass !== evidenceClass ||
    manifest.caseSlotsPerFreshStoreRepetition !== 42 ||
    manifest.repetitionsPerComparisonPair !== 2 ||
    manifest.pairedCaseSlotsPerComparisonPair !== 84 ||
    manifest.laneResultSlotsPerComparisonPair !== 168 ||
    manifest.e14ExecutedCases !== 0 || manifest.comparisonRuns !== 0 ||
    manifest.fairnessStatus !== "NOT_ASSESSED" ||
    canonicalJson(manifest.orderedStepIds) !== canonicalJson(expectedStepIds) ||
    canonicalJson(manifest.stepDenominators) !== canonicalJson(expectedStepDenominators) ||
    canonicalJson(manifest.comparisonClasses) !== canonicalJson(expectedComparisonClasses)
  ) {
    throw new Error("E14 identity, denominator, status, or comparison class differs.");
  }
  exactKeys(
    manifest.freshStorePolicy,
    [
      "eachCaseEachLane", "eachRepetition", "immutableStartingCheckpoint",
      "namedBarriersRequired", "sleepSynchronizationAllowed", "crossCaseStateReuseAllowed",
    ],
    "E14 fresh-store policy",
  );
  if (
    manifest.freshStorePolicy.eachCaseEachLane !== true ||
    manifest.freshStorePolicy.eachRepetition !== true ||
    manifest.freshStorePolicy.immutableStartingCheckpoint !== "CHECKPOINT/CLEAN-BASELINE-V1" ||
    manifest.freshStorePolicy.namedBarriersRequired !== true ||
    manifest.freshStorePolicy.sleepSynchronizationAllowed !== false ||
    manifest.freshStorePolicy.crossCaseStateReuseAllowed !== false
  ) {
    throw new Error("E14 fresh-store isolation policy differs.");
  }
  exactKeys(
    manifest.barrierProtocol,
    [
      "startBarrierTemplate", "mutationBarrierTemplate", "decisionBarrierTemplate",
      "sleepSynchronizationAllowed",
    ],
    "E14 barrier protocol",
  );
  if (
    manifest.barrierProtocol.startBarrierTemplate !== "BARRIER/{caseId}/START" ||
    manifest.barrierProtocol.mutationBarrierTemplate !== "BARRIER/{caseId}/MUTATION" ||
    manifest.barrierProtocol.decisionBarrierTemplate !== "BARRIER/{caseId}/DECISION" ||
    manifest.barrierProtocol.sleepSynchronizationAllowed !== false
  ) {
    throw new Error("E14 named-barrier protocol differs.");
  }
  if (manifest.steps.length !== expectedSteps.length) {
    throw new Error("E14 ordered step denominator differs.");
  }
  for (let index = 0; index < expectedSteps.length; index += 1) {
    const [stepId, family, caseIds] = expectedSteps[index];
    const step = manifest.steps[index];
    exactKeys(step, ["stepId", "family", "caseCount", "cases"], `E14 step ${stepId}`);
    if (
      step.stepId !== stepId || step.family !== family || step.caseCount !== caseIds.length ||
      canonicalJson(step.cases.map((item) => item.caseId)) !== canonicalJson(caseIds)
    ) {
      throw new Error(`E14 step partition differs for ${stepId}.`);
    }
    for (const fixture of step.cases) {
      const before = canonicalJson(fixture);
      if (!validateCaseSchema(fixture)) {
        throw new Error(`E14 case failed schema ${fixture.caseId}: ${canonicalJson(validateCaseSchema.errors)}`);
      }
      if (canonicalJson(fixture) !== before) {
        throw new Error(`E14 schema validation mutated ${fixture.caseId}.`);
      }
      exactKeys(fixture.credits, creditKeys, `E14 case credits ${fixture.caseId}`);
      if (
        fixture.stepId !== stepId || fixture.family !== family ||
        fixture.startingCheckpoint !== manifest.freshStorePolicy.immutableStartingCheckpoint ||
        fixture.freshStoreRequired !== true || fixture.runStatus !== "NOT_RUN" ||
        fixture.evidenceClass !== evidenceClass ||
        Object.values(fixture.credits).some((value) => value !== false)
      ) {
        throw new Error(`E14 case binding or zero-credit ceiling differs for ${fixture.caseId}.`);
      }
    }
  }
  const cases = flattenCases(manifest);
  if (
    cases.length !== 42 || classifyCaseSet(cases) !== "ACCEPT_FROZEN_CASE_SET" ||
    cases.some((fixture) => fixture.runStatus !== "NOT_RUN")
  ) {
    throw new Error("E14 case set is incomplete, reordered, duplicated, or no longer NOT_RUN.");
  }
  const declaredControls = manifest.denominatorControls.map((control) => {
    exactKeys(control, ["id", "expectedRefusal"], `E14 denominator control ${control.id}`);
    return [control.id, control.expectedRefusal];
  });
  if (canonicalJson(declaredControls) !== canonicalJson(expectedControls)) {
    throw new Error("E14 denominator controls differ from the frozen five-control contract.");
  }
  exactKeys(
    manifest.payloadBindingProbe,
    ["probeId", "method", "requiredObservation", "evidenceClass"],
    "E14 payload-binding probe",
  );
  if (
    manifest.payloadBindingProbe.probeId !== "E14-PAYLOAD-BINDING-01" ||
    manifest.payloadBindingProbe.method !== "MUTATE_CASE_CONTENT_WITH_IDS_UNCHANGED" ||
    manifest.payloadBindingProbe.requiredObservation !== "CASE_SET_DIGEST_CHANGES" ||
    manifest.payloadBindingProbe.evidenceClass !== "SELF_ADMINISTERED_STRUCTURAL_PROBE"
  ) {
    throw new Error("E14 payload-binding probe differs.");
  }
  const metricKeys = [
    "criticalFalseAccepts", "cleanFalseRejects", "crossSubjectInheritanceAccepts",
    "authorityMutationAccepts", "verifiedPromotedReadbackMismatches",
    "staleReceiptReuseAccepts", "affectedRecallRate", "unrelatedRecallRate",
    "exhaustiveOracleReplayMisses", "crashNonconvergence", "manualSafetyInterventions",
  ];
  exactKeys(manifest.primaryMetrics, metricKeys, "E14 primary metrics");
  if (
    manifest.primaryMetrics.criticalFalseAccepts.target !== 0 ||
    manifest.primaryMetrics.cleanFalseRejects.target !== 0 ||
    manifest.primaryMetrics.crossSubjectInheritanceAccepts.target !== 0 ||
    manifest.primaryMetrics.authorityMutationAccepts.target !== 0 ||
    manifest.primaryMetrics.verifiedPromotedReadbackMismatches.target !== 0 ||
    manifest.primaryMetrics.staleReceiptReuseAccepts.target !== 0 ||
    manifest.primaryMetrics.affectedRecallRate.targetPercent !== 100 ||
    manifest.primaryMetrics.unrelatedRecallRate.targetPercent !== 0 ||
    manifest.primaryMetrics.exhaustiveOracleReplayMisses.target !== 0 ||
    manifest.primaryMetrics.crashNonconvergence.target !== 0 ||
    manifest.primaryMetrics.manualSafetyInterventions.target !== 0 ||
    Object.values(manifest.primaryMetrics).some(
      (metric) => typeof metric.denominator !== "string" || !metric.denominator.endsWith("NONEMPTY"),
    )
  ) {
    throw new Error("E14 frozen primary targets or nonempty denominator rules differ.");
  }
  if (
    manifest.decisionRules.length !== 5 ||
    canonicalJson(manifest.decisionRules.map((rule) => rule.decision)) !== canonicalJson([
      "KILL_IMPLEMENTATION", "KILL_E14_DIFFERENTIATION_HYPOTHESIS",
      "PRODUCTIZATION_ONLY", "CONTINUE_NARROW", "INCONCLUSIVE",
    ])
  ) {
    throw new Error("E14 pre-committed decision rules differ.");
  }
  for (const rule of manifest.decisionRules) {
    exactKeys(rule, ["decision", "condition"], `E14 decision rule ${rule.decision}`);
    if (rule.condition.length < 40) throw new Error(`E14 decision condition is too weak for ${rule.decision}.`);
  }
  if (
    canonicalJson(manifest.limitations) !== canonicalJson(expectedLimitations) ||
    manifest.secondaryMeasurements.length !== 9
  ) {
    throw new Error("E14 limitations or secondary measurement denominator differs.");
  }
  exactKeys(manifest.credits, creditKeys, "E14 manifest credits");
  if (Object.values(manifest.credits).some((value) => value !== false)) {
    throw new Error("E14 scenario freeze cannot claim comparison, milestone, legal, or release credit.");
  }
  return {
    profile: manifest.profile,
    statusCeiling: manifest.statusCeiling,
    runStatus: manifest.runStatus,
    orderedStepIds: manifest.orderedStepIds,
    stepDenominators: manifest.stepDenominators,
    comparisonClasses: manifest.comparisonClasses,
    fairnessStatus: manifest.fairnessStatus,
    cases,
    limitations: manifest.limitations,
    credits: manifest.credits,
  };
}

const first = validateManifest(parsedFirst);
const second = validateManifest(parsedSecond);
const firstCaseSetDigest = sha256Canonical(first.cases);
const secondCaseSetDigest = sha256Canonical(second.cases);
const normalizedFirst = canonicalJson(first);
const normalizedSecond = canonicalJson(second);
if (normalizedFirst !== normalizedSecond || firstCaseSetDigest !== secondCaseSetDigest) {
  throw new Error("E14 sequential same-process structural passes are not byte-identical.");
}

const cases = first.cases;
const extraCase = {
  ...cases[0],
  caseId: "E14-S12-C03-EXTRA-FROZEN-CASE",
  stepId: "S12",
  family: "CLEAN_UNAFFECTED",
};
const reorderedCases = [...cases];
[reorderedCases[0], reorderedCases[1]] = [reorderedCases[1], reorderedCases[0]];
const controlInputs = new Map([
  ["EMPTY", []],
  ["MISSING", cases.slice(0, -1)],
  ["DUPLICATE", [...cases, cases[0]]],
  ["EXTRA", [...cases, extraCase]],
  ["REORDERED", reorderedCases],
]);
const denominatorControlResults = expectedControls.map(([id, expectedRefusal]) => {
  const refusalCode = classifyCaseSet(controlInputs.get(id));
  if (refusalCode !== expectedRefusal) {
    throw new Error(`E14 denominator control ${id} produced ${refusalCode}.`);
  }
  return { id, status: "PASS_CONTROL", refusalCode };
});

const mutatedCases = structuredClone(cases);
mutatedCases[0].condition = `${mutatedCases[0].condition} Payload-binding mutation.`;
if (canonicalJson(mutatedCases.map((item) => item.caseId)) !== canonicalJson(expectedCaseIds)) {
  throw new Error("E14 payload-binding probe changed case identities.");
}
const mutatedCaseSetDigest = sha256Canonical(mutatedCases);
if (mutatedCaseSetDigest === firstCaseSetDigest) {
  throw new Error("E14 payload mutation did not change the case-set digest.");
}

const evidence = {
  schemaVersion: 1,
  recordType: "M07_E14_SCENARIO_FREEZE_VALIDATION",
  status: "PASS_M07_E14_SCENARIO_FREEZE_ONLY",
  statusCeiling,
  profile,
  evidenceClass,
  manifestSha256: await sha256File(manifestPath),
  caseSetDigest: firstCaseSetDigest,
  verifierSourceSha256: await sha256File(verifierPath),
  orderedStepIds: expectedStepIds,
  stepDenominators: expectedStepDenominators,
  caseIds: expectedCaseIds,
  caseSlotsPerFreshStoreRepetition: 42,
  repeatedStructuralPasses: 2,
  structuralCaseSlotChecks: 84,
  pairedCaseSlotsPerComparisonPair: 84,
  laneResultSlotsPerComparisonPair: 168,
  deterministicRepeat: true,
  comparisonClasses: expectedComparisonClasses,
  denominatorControlResults,
  contentBindingProbe: {
    id: "MUTATED_PAYLOAD_DIGEST_CHANGES",
    status: "PASS_CONTROL",
    originalCaseSetDigest: firstCaseSetDigest,
    mutatedCaseSetDigest,
    changed: true,
  },
  runStatus: "NOT_RUN",
  freshStoreRunsObserved: 0,
  e14ExecutedCases: 0,
  e14PassedCases: 0,
  e14FailedCases: 0,
  comparisonRuns: 0,
  comparisonFairness: "NOT_ASSESSED",
  m07ScenarioFreezeValidated: true,
  limitations: expectedLimitations,
  credits: Object.fromEntries(creditKeys.map((key) => [key, false])),
};
emitDeterministic({ ...evidence, resultDigest: sha256Canonical(evidence) });
