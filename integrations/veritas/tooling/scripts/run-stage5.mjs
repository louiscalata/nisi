import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import {
  canonicalJson,
  emitDeterministic,
  exactKeys,
  readJson,
  sha256Canonical,
  sha256File,
  toolingRoot,
} from "./common.mjs";

const expectedNode = "v24.18.0";
const expectedNpmAgentPrefix = "npm/11.16.0 ";
const stages = [
  {
    id: "installation",
    command: process.execPath,
    args: [resolve(toolingRoot, "scripts/verify-installation.mjs")],
  },
  {
    id: "typescript",
    command: resolve(toolingRoot, "node_modules/typescript/bin/tsc"),
    args: ["--project", resolve(toolingRoot, "tsconfig.json"), "--pretty", "false"],
  },
  {
    id: "lint",
    command: process.execPath,
    args: [resolve(toolingRoot, "scripts/lint.mjs")],
  },
  {
    id: "structural",
    command: process.execPath,
    args: [resolve(toolingRoot, "scripts/structural-check.mjs")],
  },
  {
    id: "e14-freeze",
    command: process.execPath,
    args: [resolve(toolingRoot, "scripts/e14-freeze-verifier.mjs")],
  },
  {
    id: "e16-reference",
    command: process.execPath,
    args: [resolve(toolingRoot, "scripts/e16-reference-oracle.mjs")],
  },
  {
    id: "contracts",
    command: process.execPath,
    args: [resolve(toolingRoot, "scripts/verify-contracts.mjs")],
  },
];

function run(stage) {
  const result = spawnSync(stage.command, stage.args, {
    cwd: toolingRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  return {
    id: stage.id,
    exitCode: result.status,
    signal: result.signal,
    stdout,
    stderr,
    stdoutDigest: sha256Canonical(stdout),
    stderrDigest: sha256Canonical(stderr),
  };
}

const manifest = await readJson(resolve(toolingRoot, "contracts/stage5-manifest.json"));
const frozenE16Manifest = await readJson(resolve(toolingRoot, "contracts/e16-manifest.json"));
const frozenE16Scenarios = await readJson(resolve(toolingRoot, "contracts/e16-reference-scenarios.json"));
const frozenE16CaseById = new Map(frozenE16Manifest.cases.map((fixture) => [fixture.caseId, fixture]));
const frozenE16ScenarioById = new Map(frozenE16Scenarios.scenarios.map((scenario) => [scenario.caseId, scenario]));
const expectedE16ManifestSha256 = await sha256File(resolve(toolingRoot, "contracts/e16-manifest.json"));
const expectedE16ScenarioSetSha256 = await sha256File(resolve(toolingRoot, "contracts/e16-reference-scenarios.json"));
const expectedE16ModelSourceSha256 = await sha256File(resolve(toolingRoot, "scripts/e16-reference-oracle.mjs"));
const expectedE16FamilyCounts = {
  AUTHORITY_MUTATION: 8,
  DIGEST_SUBSTITUTION: 6,
  PROMOTION_CRASH_OR_RACE: 6,
  PRIOR_TARGET_RECOVERY: 4,
};
const expectedE16Limitations = [
  "SELF_ADMINISTERED_PURE_REFERENCE_MODEL_ONLY",
  "NO_CURRENT_COORDINATOR_E16_EXECUTION",
  "NO_PROTECTED_AUTHORITY_OR_DISTINCT_PRINCIPAL",
  "NO_PROCESS_CRASH_OR_POWER_LOSS_EVIDENCE",
  "NO_NATIVE_MULTI_WRITER_SCHEDULING",
  "NO_EXTERNAL_DESTINATION_OR_DEPENDENCY_OBSERVER",
  "NO_FILESYSTEM_DURABILITY_OR_ATOMICITY_CLAIM",
  "NO_T164_THROUGH_T183_M4_PATENT_PRODUCTION_OR_RELEASE_CREDIT",
];
const expectedE16ControlIds = [
  "FLIPPED_EXPECTED_OUTCOME_REJECTED",
  "NO_OP_MUTATOR_REJECTED",
  "CONTRADICTORY_ROLLBACK_READBACK_REJECTED",
  "MISSING_CASE_SET_REJECTED",
  "DISTINCT_OPERATION_REPLAY_REJECTED",
];
const expectedE14Limitations = [
  "NO_E14_CASE_EXECUTION",
  "NO_COMPARISON_RUN",
  "NO_FAIRNESS_ASSESSMENT",
  "NO_OBSERVED_COMPETITIVE_ADVANTAGE",
  "NO_USER_ADOPTION_EVIDENCE",
  "NO_M4_UNIQUENESS_PATENT_PRODUCTION_SIGNING_OR_RELEASE_CREDIT",
];
const expectedE14CreditKeys = [
  "technicalE14", "adoptionE14", "comparison", "m4", "uniqueness",
  "patent", "production", "signing", "release",
];
const e16CreditKeys = [
  "protectedAuthority", "nativeRuntime", "t164ThroughT183", "m4",
  "e16", "patent", "production", "release",
];
const expectedE16MutationDeltas = Object.freeze({
  POLICY_DIGEST_SUBSTITUTION: ["authorityObserved.policyDigest"],
  VERIFIER_SET_DIGEST_SUBSTITUTION: ["authorityObserved.verifierSetDigest"],
  ADAPTER_SET_DIGEST_SUBSTITUTION: ["authorityObserved.adapterSetDigest"],
  HOOK_SET_DIGEST_SUBSTITUTION: ["authorityObserved.hookSetDigest"],
  TRUSTED_COMMAND_SET_DIGEST_SUBSTITUTION: ["authorityObserved.trustedCommandSetDigest"],
  BASE_REVISION_SUBSTITUTION: ["authorityObserved.baseRevision"],
  WRITER_SELF_APPROVAL: ["observedApproverId"],
  DEPENDENCY_EPOCH_ADVANCE: ["authorityObserved.dependencyEpoch"],
  FINAL_CANDIDATE_SUBSTITUTION: ["observedCandidateDigest"],
  DECISION_SUBJECT_SUBSTITUTION: ["observedDecisionSubjectDigest"],
  MODEL_RESPONSE_AS_ACCEPTED_ARTIFACT: ["observedAcceptedArtifactDigest"],
  DESTINATION_BYTES_SUBSTITUTION: ["readbackDigest"],
  TRANSACTION_OWNED_UNVERIFIED_REFERENCE: ["destinationDigest", "flags", "readbackDigest"],
  DESTINATION_RECEIPT_REUSE: ["observedReceiptBindingDigest"],
  SYMBOLIC_INTERRUPT_BEFORE_OBJECT_WRITE: ["flags"],
  SYMBOLIC_INTERRUPT_AFTER_OBJECT_WRITE: ["flags"],
  SYMBOLIC_INTERRUPT_AFTER_REFERENCE_SWAP: ["flags"],
  LOST_SUCCESS_RESPONSE_RECOVERY_REPLAY: ["flags"],
  SYMBOLIC_UNORDERED_WRITER_RACE: ["flags"],
  DEPENDENCY_EVENT_AFTER_REFERENCE_ACCEPTANCE: ["flags"],
  PREPARED_OBJECT_CORRUPTION: ["flags"],
  ROLLBACK_CURRENT_TARGET_CORRUPTION: ["flags"],
  ROLLBACK_PRIOR_TARGET_UNAVAILABLE: ["flags"],
  ROLLBACK_STALE_READBACK: ["flags"],
});
const expectedE16UncertainTransitions = Object.freeze({
  SYMBOLIC_INTERRUPT_AFTER_REFERENCE_SWAP: 1,
  SYMBOLIC_UNORDERED_WRITER_RACE: 0,
  ROLLBACK_CURRENT_TARGET_CORRUPTION: 1,
  ROLLBACK_PRIOR_TARGET_UNAVAILABLE: 1,
  ROLLBACK_STALE_READBACK: 2,
});

function digestWithoutResultDigest(value) {
  const { resultDigest: _ignored, ...withoutDigest } = value;
  return sha256Canonical(withoutDigest);
}

function expectedReferencePreStateDigest(result) {
  return sha256Canonical({
    operationId: result.operationId,
    authorityDigest: result.authorityDigestBefore,
    candidateDigest: result.candidateDigest,
    priorTargetDigest: result.priorTargetDigest,
    destinationDigest: result.priorTargetDigest,
    readbackDigest: result.priorTargetDigest,
    phase: "INIT",
  });
}

function expectedReferencePostStateDigest(result) {
  return sha256Canonical({
    operationId: result.operationId,
    authorityDigestAfter: result.authorityDigestAfter,
    attemptedAuthorityDigest: result.attemptedAuthorityDigest,
    candidateDigest: result.candidateDigest,
    priorTargetDigest: result.priorTargetDigest,
    destinationDigest: result.destinationDigest,
    readbackDigest: result.readbackDigest,
    terminalPhase: result.terminalPhase,
    injectionPointObserved: result.injectionPointObserved,
    mutationApplied: result.mutationApplied,
    mutationDeltaPaths: result.mutationDeltaPaths,
    referenceTransitionCount: result.referenceTransitionCount,
    acceptedEffectCount: result.acceptedEffectCount,
    receiptCount: result.receiptCount,
    activeReceiptCount: result.activeReceiptCount,
    recallEventCount: result.recallEventCount,
    recoveryOrReplayCount: result.recoveryOrReplayCount,
    reusable: result.reusable,
    candidateProcessSpawned: result.candidateProcessSpawned,
    protectedAuthorityVerified: result.protectedAuthorityVerified,
    externalEvidenceObserved: result.externalEvidenceObserved,
    traceDigest: result.traceDigest,
  });
}

function validateCleanTwinRecord(cleanTwin, candidateDigest) {
  exactKeys(
    cleanTwin,
    [
      "status", "observedOutcome", "terminalPhase", "destinationDigest", "readbackDigest",
      "acceptedEffectCount", "receiptCount", "activeReceiptCount", "reusable",
      "candidateProcessSpawned", "protectedAuthorityVerified", "externalEvidenceObserved",
      "traceDigest", "semanticFindings", "resultDigest",
    ],
    "E16 clean-twin result",
  );
  return cleanTwin.status === "PASS_CLEAN_TWIN" &&
    cleanTwin.observedOutcome === "CLEAN_ACCEPTED" && cleanTwin.terminalPhase === "ACCEPTED" &&
    cleanTwin.destinationDigest === candidateDigest && cleanTwin.readbackDigest === candidateDigest &&
    cleanTwin.acceptedEffectCount === 1 && cleanTwin.receiptCount === 1 &&
    cleanTwin.activeReceiptCount === 1 && cleanTwin.reusable === true &&
    cleanTwin.candidateProcessSpawned === false && cleanTwin.protectedAuthorityVerified === false &&
    cleanTwin.externalEvidenceObserved === false && Array.isArray(cleanTwin.semanticFindings) &&
    cleanTwin.semanticFindings.length === 0 && /^[0-9a-f]{64}$/u.test(cleanTwin.traceDigest) &&
    cleanTwin.resultDigest === digestWithoutResultDigest(cleanTwin);
}

function validateReferenceOutcome(result) {
  const exactCandidate =
    result.destinationDigest === result.candidateDigest && result.readbackDigest === result.candidateDigest;
  const exactPrior =
    result.destinationDigest === result.priorTargetDigest && result.readbackDigest === result.priorTargetDigest;
  if (result.priorTargetPreserved !== exactPrior) return false;
  if (result.observedOutcome === "REFUSE_BEFORE_DECISION") {
    return result.terminalPhase === "REFUSED_BEFORE_DECISION" && exactPrior &&
      result.acceptedEffectCount === 0 && result.receiptCount === 0 && !result.reusable;
  }
  if (result.observedOutcome === "REFUSE_BEFORE_PROMOTION") {
    return result.terminalPhase === "REFUSED_BEFORE_PROMOTION" && exactPrior &&
      result.acceptedEffectCount === 0 && result.receiptCount === 0 && !result.reusable;
  }
  if (result.observedOutcome === "ROLL_BACK_TO_PRIOR_TARGET") {
    return result.terminalPhase === "ROLLED_BACK" && exactPrior &&
      result.acceptedEffectCount === 0 && result.receiptCount === 0 && !result.reusable;
  }
  if (result.observedOutcome === "CONVERGE_IDEMPOTENTLY") {
    const replayIdentityBound = result.trace
      .filter((entry) => entry.includes("RECOVERY_REPLAY:"))
      .every((entry) => entry.includes(result.operationId));
    return result.terminalPhase === "ACCEPTED" && exactCandidate &&
      result.acceptedEffectCount === 1 && result.receiptCount === 1 &&
      result.activeReceiptCount === 1 && result.recoveryOrReplayCount >= 1 &&
      replayIdentityBound && result.reusable;
  }
  if (result.observedOutcome === "WITHHOLD_AS_UNCERTAIN") {
    return result.terminalPhase === "UNCERTAIN" && result.activeReceiptCount === 0 &&
      result.acceptedEffectCount === 0 && result.receiptCount === 0 &&
      result.recallEventCount === 0 && !result.reusable;
  }
  if (result.observedOutcome === "RECALL_AFTER_ACCEPTANCE") {
    return result.terminalPhase === "RECALLED" && exactCandidate &&
      result.acceptedEffectCount === 1 && result.receiptCount === 1 &&
      result.activeReceiptCount === 0 && result.recallEventCount === 1 && !result.reusable;
  }
  return false;
}

function validateSemanticResult(result) {
  if (result.id === "typescript") {
    return {
      semanticStatus: result.stdout === "" ? "PASS_NO_DIAGNOSTICS" : "FAIL_OUTPUT_PRESENT",
      semanticValid: result.stdout === "",
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { semanticStatus: "FAIL_INVALID_JSON", semanticValid: false };
  }
  try {
    if (result.id === "installation") {
      exactKeys(parsed, ["schemaVersion", "status", "installation", "resultDigest"], "installation result");
      const valid =
        parsed.schemaVersion === 1 &&
        parsed.status === "PASS" &&
        canonicalJson(parsed.installation) === canonicalJson(manifest.installationContract) &&
        parsed.resultDigest === sha256Canonical(parsed.installation);
      return { semanticStatus: valid ? "PASS" : "FAIL_INSTALLATION_CONTRACT", semanticValid: valid };
    }
    if (result.id === "lint") {
      exactKeys(
        parsed,
        ["schemaVersion", "status", "files", "errorCount", "warningCount", "messages", "resultDigest"],
        "lint result",
      );
      const valid =
        parsed.schemaVersion === 1 &&
        parsed.status === "PASS" &&
        parsed.errorCount === 0 &&
        parsed.warningCount === 0 &&
        canonicalJson(parsed.files) === canonicalJson(["veritas.ts"]) &&
        Array.isArray(parsed.messages) &&
        parsed.messages.length === 0 &&
        parsed.resultDigest === sha256Canonical({
          errorCount: parsed.errorCount,
          warningCount: parsed.warningCount,
          messages: parsed.messages,
        });
      return { semanticStatus: valid ? "PASS" : "FAIL_LINT_CONTRACT", semanticValid: valid };
    }
    if (result.id === "structural") {
      exactKeys(
        parsed,
        ["schemaVersion", "status", "sourceDigest", "sourceFindings", "mutationResults", "positiveResults", "resultDigest"],
        "structural result",
      );
      const exactMutationEntries = parsed.mutationResults?.every((item) => {
        exactKeys(item, ["id", "expectedRule", "observedRules", "caught"], "structural mutation result");
        return Array.isArray(item.observedRules);
      });
      const exactPositiveEntries = parsed.positiveResults?.every((item) => {
        exactKeys(item, ["id", "findingCount"], "structural positive result");
        return true;
      });
      const valid =
        parsed.schemaVersion === 1 &&
        parsed.status === "PASS" &&
        parsed.sourceDigest === manifest.rootContract.sourceSha256 &&
        Array.isArray(parsed.sourceFindings) &&
        parsed.sourceFindings.length === 0 &&
        parsed.mutationResults?.length === manifest.acceptance.structuralMutationCases &&
        exactMutationEntries === true &&
        parsed.mutationResults.every((item) => item.caught === true) &&
        parsed.positiveResults?.length === manifest.acceptance.structuralAllowedCases &&
        exactPositiveEntries === true &&
        parsed.positiveResults.every((item) => item.findingCount === 0) &&
        parsed.resultDigest === sha256Canonical({
          sourceFindings: parsed.sourceFindings,
          mutationResults: parsed.mutationResults,
          positiveResults: parsed.positiveResults,
        });
      return { semanticStatus: valid ? "PASS" : "FAIL_STRUCTURAL_CONTRACT", semanticValid: valid };
    }
    if (result.id === "e14-freeze") {
      exactKeys(
        parsed,
        [
          "schemaVersion", "recordType", "status", "statusCeiling", "profile",
          "evidenceClass", "manifestSha256", "caseSetDigest", "verifierSourceSha256",
          "orderedStepIds", "stepDenominators", "caseIds",
          "caseSlotsPerFreshStoreRepetition", "repeatedStructuralPasses",
          "structuralCaseSlotChecks", "pairedCaseSlotsPerComparisonPair",
          "laneResultSlotsPerComparisonPair", "deterministicRepeat", "comparisonClasses",
          "denominatorControlResults", "contentBindingProbe", "runStatus",
          "freshStoreRunsObserved", "e14ExecutedCases", "e14PassedCases",
          "e14FailedCases", "comparisonRuns", "comparisonFairness",
          "m07ScenarioFreezeValidated", "limitations", "credits", "resultDigest",
        ],
        "M0.7 E14 scenario-freeze result",
      );
      exactKeys(parsed.credits, expectedE14CreditKeys, "M0.7 E14 scenario-freeze credits");
      exactKeys(
        parsed.contentBindingProbe,
        [
          "id", "status", "originalCaseSetDigest", "mutatedCaseSetDigest", "changed",
        ],
        "M0.7 E14 content-binding probe",
      );
      const expected = manifest.acceptance.m07E14Freeze;
      const expectedControlResults = [
        ["EMPTY", "REFUSE_EMPTY_CASE_SET"],
        ["MISSING", "REFUSE_MISSING_CASE"],
        ["DUPLICATE", "REFUSE_DUPLICATE_CASE_ID"],
        ["EXTRA", "REFUSE_EXTRA_CASE"],
        ["REORDERED", "REFUSE_REORDERED_CASE_SET"],
      ];
      const exactControls = parsed.denominatorControlResults?.every((control, index) => {
        exactKeys(
          control,
          ["id", "status", "refusalCode"],
          `M0.7 E14 denominator control ${index}`,
        );
        const expectedControl = expectedControlResults[index];
        return expectedControl !== undefined && control.id === expectedControl[0] &&
          control.refusalCode === expectedControl[1] && control.status === "PASS_CONTROL";
      });
      const valid =
        parsed.schemaVersion === 1 &&
        parsed.recordType === "M07_E14_SCENARIO_FREEZE_VALIDATION" &&
        parsed.status === "PASS_M07_E14_SCENARIO_FREEZE_ONLY" &&
        parsed.statusCeiling === expected.statusCeiling &&
        parsed.profile === expected.profile &&
        parsed.evidenceClass === "SELF_ADMINISTERED_SCENARIO_FREEZE" &&
        parsed.manifestSha256 === expected.manifestSha256 &&
        parsed.caseSetDigest === expected.caseSetDigest &&
        parsed.verifierSourceSha256 === expected.verifierSourceSha256 &&
        canonicalJson(parsed.orderedStepIds) === canonicalJson(expected.orderedStepIds) &&
        canonicalJson(parsed.stepDenominators) === canonicalJson(expected.stepDenominators) &&
        canonicalJson(parsed.caseIds) === canonicalJson(expected.caseIds) &&
        parsed.caseSlotsPerFreshStoreRepetition === expected.caseSlotsPerFreshStoreRepetition &&
        parsed.repeatedStructuralPasses === expected.repetitionsPerComparisonPair &&
        parsed.structuralCaseSlotChecks === expected.structuralCaseSlotChecks &&
        parsed.pairedCaseSlotsPerComparisonPair === expected.pairedCaseSlotsPerComparisonPair &&
        parsed.laneResultSlotsPerComparisonPair === expected.laneResultSlotsPerComparisonPair &&
        parsed.deterministicRepeat === true &&
        canonicalJson(parsed.comparisonClasses) === canonicalJson(expected.comparisonClasses) &&
        parsed.denominatorControlResults?.length === expected.denominatorNegativeControls &&
        exactControls === true &&
        parsed.contentBindingProbe.id === "MUTATED_PAYLOAD_DIGEST_CHANGES" &&
        parsed.contentBindingProbe.status === "PASS_CONTROL" &&
        parsed.contentBindingProbe.originalCaseSetDigest === expected.caseSetDigest &&
        parsed.contentBindingProbe.mutatedCaseSetDigest !== expected.caseSetDigest &&
        parsed.contentBindingProbe.changed === true &&
        parsed.runStatus === "NOT_RUN" && parsed.freshStoreRunsObserved === 0 &&
        parsed.e14ExecutedCases === 0 && parsed.e14PassedCases === 0 &&
        parsed.e14FailedCases === 0 && parsed.comparisonRuns === 0 &&
        parsed.comparisonFairness === "NOT_ASSESSED" &&
        parsed.m07ScenarioFreezeValidated === true &&
        canonicalJson(parsed.limitations) === canonicalJson(expectedE14Limitations) &&
        Object.values(parsed.credits).every((value) => value === false) &&
        parsed.resultDigest === digestWithoutResultDigest(parsed);
      return {
        semanticStatus: valid ? "PASS" : "FAIL_M07_E14_FREEZE_CONTRACT",
        semanticValid: valid,
      };
    }
    if (result.id === "e16-reference") {
      exactKeys(
        parsed,
        [
          "schemaVersion", "recordType", "status", "evidenceClass", "profile",
          "manifestSha256", "scenarioSetSha256", "modelSourceSha256", "manifestStatus",
          "caseDenominator", "referenceModelExecutedCases", "implementationExecutedCases",
          "e16ExecutedCases", "e16Complete", "repeatedRuns", "deterministicRepeat",
          "familyCounts", "negativeControls", "semanticFindings", "results", "limitations",
          "credits", "resultDigest",
        ],
        "E16 pure-reference result",
      );
      exactKeys(parsed.credits, e16CreditKeys, "E16 pure-reference result credits");
      const exactControls = parsed.negativeControls?.every((control, index) => {
        exactKeys(control, ["id", "detected", "status"], "E16 pure-reference negative control");
        return control.id === expectedE16ControlIds[index] &&
          control.detected === true && control.status === "PASS_CONTROL";
      });
      const digestPattern = /^[0-9a-f]{64}$/u;
      const exactCases = parsed.results?.every((item) => {
        exactKeys(
          item,
          [
            "schemaVersion", "profile", "evidenceClass", "caseId", "family", "scenarioDigest",
            "operationId", "preStateDigest", "postStateDigest", "injectionPointExpected", "injectionPointObserved",
            "mutationApplied", "mutationDeltaPaths", "observedOutcome", "terminalPhase", "diagnosticCode",
            "authorityDigestBefore", "authorityDigestAfter", "attemptedAuthorityDigest",
            "candidateDigest", "priorTargetDigest", "destinationDigest", "readbackDigest",
            "priorTargetPreserved", "referenceTransitionCount", "acceptedEffectCount",
            "receiptCount", "activeReceiptCount", "recallEventCount", "recoveryOrReplayCount",
            "reusable", "candidateProcessSpawned", "protectedAuthorityVerified",
            "externalEvidenceObserved", "trace", "traceDigest", "expectedOutcome",
            "cleanTwin", "semanticFindings", "status", "resultDigest",
          ],
          `E16 pure-reference case ${item.caseId}`,
        );
        const nullableDigestsValid = [item.destinationDigest, item.readbackDigest].every((value) =>
          value === null || digestPattern.test(value));
        const fixedDigestsValid = [
          item.scenarioDigest,
          item.preStateDigest,
          item.postStateDigest,
          item.authorityDigestBefore,
          item.authorityDigestAfter,
          item.attemptedAuthorityDigest,
          item.candidateDigest,
          item.priorTargetDigest,
          item.traceDigest,
          item.resultDigest,
        ].every((value) => typeof value === "string" && digestPattern.test(value));
        const traceCountsValid =
          Array.isArray(item.trace) &&
          item.trace.every((entry) => typeof entry === "string" && /^\d{2}:/u.test(entry)) &&
          item.referenceTransitionCount === item.trace.filter((entry) => entry.includes("REFERENCE_WRITE:")).length &&
          item.acceptedEffectCount === item.trace.filter((entry) => entry.includes("ACCEPTED_EFFECT:")).length &&
          item.receiptCount === item.trace.filter((entry) => entry.includes("RECEIPT_ISSUED:")).length &&
          item.recallEventCount === item.trace.filter((entry) => entry.includes("RECALL_EVENT:")).length &&
          item.recoveryOrReplayCount === item.trace.filter((entry) => entry.includes("RECOVERY_REPLAY:")).length &&
          item.activeReceiptCount === item.receiptCount - item.recallEventCount &&
          item.traceDigest === sha256Canonical(item.trace);
        const frozenCase = frozenE16CaseById.get(item.caseId);
        const frozenScenario = frozenE16ScenarioById.get(item.caseId);
        const exactFrozenBinding = frozenCase !== undefined && frozenScenario !== undefined &&
          item.family === frozenCase.family && item.family === frozenScenario.family &&
          item.expectedOutcome === frozenCase.expectedOutcome &&
          item.injectionPointExpected === frozenScenario.injectionPoint &&
          item.scenarioDigest === sha256Canonical(frozenScenario) &&
          item.operationId === `reference-model:${item.caseId}` &&
          canonicalJson(item.mutationDeltaPaths) ===
            canonicalJson(expectedE16MutationDeltas[frozenScenario.mutationKind]);
        const preSwapRaceValid = frozenScenario?.mutationKind !== "SYMBOLIC_UNORDERED_WRITER_RACE" ||
          (item.priorTargetPreserved === true && item.referenceTransitionCount === 0 &&
            item.acceptedEffectCount === 0 && item.receiptCount === 0);
        const uncertainTransitionValid = item.observedOutcome !== "WITHHOLD_AS_UNCERTAIN" ||
          item.referenceTransitionCount === expectedE16UncertainTransitions[frozenScenario?.mutationKind];
        return item.schemaVersion === 1 &&
          item.profile === "veritas-e16-stage5-pure-reference-model-v1" &&
          item.evidenceClass === "SELF_ADMINISTERED_PURE_REFERENCE_MODEL" &&
          item.status === "PASS_REFERENCE_MODEL_ONLY" &&
          Array.isArray(item.semanticFindings) && item.semanticFindings.length === 0 &&
          item.mutationApplied === true &&
          Array.isArray(item.mutationDeltaPaths) && item.mutationDeltaPaths.length >= 1 &&
          item.injectionPointExpected === item.injectionPointObserved &&
          item.expectedOutcome === item.observedOutcome &&
          item.authorityDigestBefore === item.authorityDigestAfter &&
          item.candidateProcessSpawned === false &&
          item.protectedAuthorityVerified === false &&
          item.externalEvidenceObserved === false &&
          item.acceptedEffectCount <= 1 && item.receiptCount <= 1 && item.activeReceiptCount <= 1 &&
          nullableDigestsValid && fixedDigestsValid && traceCountsValid &&
          exactFrozenBinding && preSwapRaceValid && uncertainTransitionValid &&
          item.preStateDigest === expectedReferencePreStateDigest(item) &&
          item.postStateDigest === expectedReferencePostStateDigest(item) &&
          validateCleanTwinRecord(item.cleanTwin, item.candidateDigest) &&
          validateReferenceOutcome(item) &&
          item.resultDigest === digestWithoutResultDigest(item);
      });
      const caseIds = parsed.results?.map((item) => item.caseId) ?? [];
      const valid =
        parsed.schemaVersion === 1 &&
        parsed.recordType === "E16_REFERENCE_MODEL_RUN_V1" &&
        parsed.status === "PASS_STAGE5_E16_REFERENCE_MODEL_SUBSET_ONLY" &&
        parsed.evidenceClass === "SELF_ADMINISTERED_PURE_REFERENCE_MODEL" &&
        parsed.profile === "veritas-e16-stage5-pure-reference-model-v1" &&
        parsed.manifestSha256 === expectedE16ManifestSha256 &&
        parsed.scenarioSetSha256 === expectedE16ScenarioSetSha256 &&
        parsed.modelSourceSha256 === expectedE16ModelSourceSha256 &&
        parsed.manifestStatus === "NOT_RUN" &&
        parsed.caseDenominator === manifest.acceptance.e16PreparedCases &&
        parsed.referenceModelExecutedCases === manifest.acceptance.e16ReferenceModelCases &&
        parsed.implementationExecutedCases === 0 &&
        parsed.e16ExecutedCases === 0 &&
        parsed.e16Complete === false &&
        parsed.repeatedRuns === 2 && parsed.deterministicRepeat === true &&
        canonicalJson(parsed.familyCounts) === canonicalJson(expectedE16FamilyCounts) &&
        parsed.negativeControls?.length === manifest.acceptance.e16ReferenceModelNegativeControls &&
        exactControls === true &&
        Array.isArray(parsed.semanticFindings) && parsed.semanticFindings.length === 0 &&
        parsed.results?.length === manifest.acceptance.e16ReferenceModelCases &&
        new Set(caseIds).size === manifest.acceptance.e16ReferenceModelCases &&
        canonicalJson([...caseIds].sort()) ===
          canonicalJson(frozenE16Manifest.cases.map((fixture) => fixture.caseId).sort()) &&
        exactCases === true &&
        canonicalJson(parsed.limitations) === canonicalJson(expectedE16Limitations) &&
        Object.values(parsed.credits).every((value) => value === false) &&
        parsed.resultDigest === digestWithoutResultDigest(parsed);
      return { semanticStatus: valid ? "PASS" : "FAIL_E16_REFERENCE_CONTRACT", semanticValid: valid };
    }
    if (result.id === "contracts") {
      exactKeys(
        parsed,
        [
          "schemaVersion", "status", "stage5RootDigest", "rootDigests", "hashedFileCount",
          "manifestDigest", "digestManifestDigest", "schemaCount", "schemaClosureTests", "schemaValidCases",
          "schemaInvalidCases", "canonicalVectors", "architectureDecisions", "m07E14Freeze",
          "e16PreparedCases",
          "m37GitBaseManifestCaseIds", "m37GitBaseManifestCases",
          "m37GitBaseManifestRepeatedRuns", "m37GitBaseManifestDenominatorNegativeControls",
          "m37GitTreeDeltaAtomicCheckIds", "m37GitTreeDeltaAtomicChecks",
          "m37GitTreeDeltaRepeatedRuns", "m37GitTreeDeltaDenominatorNegativeControls",
          "m46DependencyClosureAtomicCheckIds", "m46DependencyClosureAtomicChecks",
          "m46DependencyClosureRepeatedRuns",
          "m46DependencyClosureProfile", "m46DependencyNodeDigestDomain",
          "m46DependencyEdgeDigestDomain", "m46DependencyGraphDigestDomain",
          "m46MinimumFixtureSubjectDigest", "m46MinimumFixtureGraphDigest",
          "m46DependencyClosureDenominatorNegativeControlIds",
          "m46DependencyClosureDenominatorNegativeControls",
          "m46RecallProfile", "m46RecallScopeDigestDomain",
          "m46RecallReceiptDigestDomain", "m46RecallReceiptSetDigestDomain",
          "m46RecallEventDigestDomain", "m46RecallStateDigestDomain",
          "m46RecallResultDigestDomain", "m46RecallSubjectDigest", "m46RecallGraphDigest",
          "m46RecallExpectedReceiptSetDigest", "m46RecallExpectedBeforeStateDigest",
          "m46RecallExpectedEventDigest", "m46RecallExpectedBarrierStateDigest",
          "m46RecallExpectedAfterStateDigest", "m46RecallExpectedResultDigest",
          "m46RecallAtomicCheckIds", "m46RecallAtomicChecks", "m46RecallRepeatedRuns",
          "m46RecallDenominatorNegativeControlIds", "m46RecallDenominatorNegativeControls",
          "m47OracleProfile",
          "m47OracleUniverseDigestDomain",
          "m47OracleRecordDigestDomain",
          "m47OracleCheckDigestDomain",
          "m47OracleCheckSetDigestDomain",
          "m47OracleChangeDigestDomain",
          "m47OracleFreezeDigestDomain",
          "m47OraclePlanDigestDomain",
          "m47OracleResultDigestDomain",
          "m47OracleGraphDigest",
          "m47OracleExpectedUniverseDigest",
          "m47OracleExpectedCheckSetDigest",
          "m47OracleExpectedFreezeDigest",
          "m47OracleExpectedKnownChangeDigest",
          "m47OracleExpectedUnresolvedChangeDigest",
          "m47OracleExpectedKnownPlanDigest",
          "m47OracleExpectedUnresolvedPlanDigest",
          "m47OracleExpectedResultDigest",
          "m47OracleAtomicCheckIds",
          "m47OracleAtomicChecks",
          "m47OracleRepeatedRuns",
          "m47OracleDenominatorNegativeControlIds",
          "m47OracleDenominatorNegativeControls",
          "m47OraclePlannerIsolated",
          "fi0Profile", "fi0DigestDomains", "fi0ExpectedDigests",
          "fi0BaselineFailureModes", "fi0AtomicCheckIds", "fi0AtomicChecks",
          "fi0RepeatedRuns", "fi0DenominatorNegativeControlIds",
          "fi0DenominatorNegativeControls",
          "fi03Profile", "fi03CanonicalVectorId", "fi03ExpectedCanonicalVectorSha256",
          "fi03ExpectedSemanticSummarySha256", "fi03CaseIds", "fi03RepeatedRuns",
          "fi03DenominatorNegativeControlIds", "fi03DenominatorNegativeControls",
          "fi03CanonicalVectorProcess",
          "e16ExecutedCases", "e16ReferenceModelCases", "e16ImplementationPreparedCases",
          "e16ImplementationExecutedCases", "e16ImplementationCreditedCases",
          "e16ImplementationNegativeControlsPrepared",
          "e16FamilyCounts", "vectorResults", "resultDigest",
        ],
        "contract result",
      );
      exactKeys(
        parsed.rootDigests,
        ["sourceSha256", "packageSha256", "packageLockSha256", "npmrcSha256", "rootRuntimeDependencies"],
        "contract root digests",
      );
      const exactVectorEntries = parsed.vectorResults?.every((item) => {
        exactKeys(item, ["id", "canonicalMatches", "digestMatches", "sha256"], "canonical vector result");
        return item.canonicalMatches === true && item.digestMatches === true;
      });
      exactKeys(
        parsed.fi03CanonicalVectorProcess,
        [
          "profile", "workerVersion", "workerSourceSha256", "status", "vectorId",
          "vectorSha256", "validProcessRuns", "deterministicRepeat", "negativeControlIds",
          "negativeControls", "negativeControlResults", "processBoundaryObserved",
          "sameHostSameOwnerOnly", "independentToolchainVerified", "authorizing",
          "protectedAuthorityVerified", "productIntegrationVerified", "resultDigest",
        ],
        "FI0.3 canonical-vector process summary",
      );
      const exactFi03NegativeControls =
        Array.isArray(parsed.fi03CanonicalVectorProcess.negativeControlResults) &&
        parsed.fi03CanonicalVectorProcess.negativeControlResults.every((item) => {
          exactKeys(
            item,
            ["id", "refusalCode", "status", "resultDigest"],
            "FI0.3 canonical-vector process negative control",
          );
          return item.status === "REFUSED_EXPECTED" && /^[0-9a-f]{64}$/u.test(item.resultDigest);
        });
      const fi03ProcessBody = { ...parsed.fi03CanonicalVectorProcess };
      delete fi03ProcessBody.resultDigest;
      const exactFi03Process =
        exactFi03NegativeControls === true &&
        parsed.fi03CanonicalVectorProcess.validProcessRuns === 2 &&
        parsed.fi03CanonicalVectorProcess.deterministicRepeat === true &&
        parsed.fi03CanonicalVectorProcess.negativeControls === 8 &&
        parsed.fi03CanonicalVectorProcess.processBoundaryObserved === true &&
        parsed.fi03CanonicalVectorProcess.sameHostSameOwnerOnly === true &&
        parsed.fi03CanonicalVectorProcess.independentToolchainVerified === false &&
        parsed.fi03CanonicalVectorProcess.authorizing === false &&
        parsed.fi03CanonicalVectorProcess.protectedAuthorityVerified === false &&
        parsed.fi03CanonicalVectorProcess.productIntegrationVerified === false &&
        parsed.fi03CanonicalVectorProcess.resultDigest === sha256Canonical(fi03ProcessBody);
      const observedCounts = {
        schemaClosureTests: parsed.schemaClosureTests,
        schemaValidCases: parsed.schemaValidCases,
        schemaInvalidCases: parsed.schemaInvalidCases,
        canonicalVectors: parsed.canonicalVectors,
        architectureDecisions: parsed.architectureDecisions,
        m37GitBaseManifestCaseIds: parsed.m37GitBaseManifestCaseIds,
        m37GitBaseManifestCases: parsed.m37GitBaseManifestCases,
        m37GitBaseManifestRepeatedRuns: parsed.m37GitBaseManifestRepeatedRuns,
        m37GitBaseManifestDenominatorNegativeControls:
          parsed.m37GitBaseManifestDenominatorNegativeControls,
        m37GitTreeDeltaAtomicCheckIds: parsed.m37GitTreeDeltaAtomicCheckIds,
        m37GitTreeDeltaAtomicChecks: parsed.m37GitTreeDeltaAtomicChecks,
        m37GitTreeDeltaRepeatedRuns: parsed.m37GitTreeDeltaRepeatedRuns,
        m37GitTreeDeltaDenominatorNegativeControls:
          parsed.m37GitTreeDeltaDenominatorNegativeControls,
        m46DependencyClosureAtomicCheckIds: parsed.m46DependencyClosureAtomicCheckIds,
        m46DependencyClosureAtomicChecks: parsed.m46DependencyClosureAtomicChecks,
        m46DependencyClosureRepeatedRuns: parsed.m46DependencyClosureRepeatedRuns,
        m46DependencyClosureProfile: parsed.m46DependencyClosureProfile,
        m46DependencyNodeDigestDomain: parsed.m46DependencyNodeDigestDomain,
        m46DependencyEdgeDigestDomain: parsed.m46DependencyEdgeDigestDomain,
        m46DependencyGraphDigestDomain: parsed.m46DependencyGraphDigestDomain,
        m46MinimumFixtureSubjectDigest: parsed.m46MinimumFixtureSubjectDigest,
        m46MinimumFixtureGraphDigest: parsed.m46MinimumFixtureGraphDigest,
        m46DependencyClosureDenominatorNegativeControlIds:
          parsed.m46DependencyClosureDenominatorNegativeControlIds,
        m46DependencyClosureDenominatorNegativeControls:
          parsed.m46DependencyClosureDenominatorNegativeControls,
        m46RecallProfile: parsed.m46RecallProfile,
        m46RecallScopeDigestDomain: parsed.m46RecallScopeDigestDomain,
        m46RecallReceiptDigestDomain: parsed.m46RecallReceiptDigestDomain,
        m46RecallReceiptSetDigestDomain: parsed.m46RecallReceiptSetDigestDomain,
        m46RecallEventDigestDomain: parsed.m46RecallEventDigestDomain,
        m46RecallStateDigestDomain: parsed.m46RecallStateDigestDomain,
        m46RecallResultDigestDomain: parsed.m46RecallResultDigestDomain,
        m46RecallSubjectDigest: parsed.m46RecallSubjectDigest,
        m46RecallGraphDigest: parsed.m46RecallGraphDigest,
        m46RecallExpectedReceiptSetDigest: parsed.m46RecallExpectedReceiptSetDigest,
        m46RecallExpectedBeforeStateDigest: parsed.m46RecallExpectedBeforeStateDigest,
        m46RecallExpectedEventDigest: parsed.m46RecallExpectedEventDigest,
        m46RecallExpectedBarrierStateDigest: parsed.m46RecallExpectedBarrierStateDigest,
        m46RecallExpectedAfterStateDigest: parsed.m46RecallExpectedAfterStateDigest,
        m46RecallExpectedResultDigest: parsed.m46RecallExpectedResultDigest,
        m46RecallAtomicCheckIds: parsed.m46RecallAtomicCheckIds,
        m46RecallAtomicChecks: parsed.m46RecallAtomicChecks,
        m46RecallRepeatedRuns: parsed.m46RecallRepeatedRuns,
        m46RecallDenominatorNegativeControlIds:
          parsed.m46RecallDenominatorNegativeControlIds,
        m46RecallDenominatorNegativeControls:
          parsed.m46RecallDenominatorNegativeControls,
        m47OracleProfile: parsed.m47OracleProfile,
        m47OracleUniverseDigestDomain: parsed.m47OracleUniverseDigestDomain,
        m47OracleRecordDigestDomain: parsed.m47OracleRecordDigestDomain,
        m47OracleCheckDigestDomain: parsed.m47OracleCheckDigestDomain,
        m47OracleCheckSetDigestDomain: parsed.m47OracleCheckSetDigestDomain,
        m47OracleChangeDigestDomain: parsed.m47OracleChangeDigestDomain,
        m47OracleFreezeDigestDomain: parsed.m47OracleFreezeDigestDomain,
        m47OraclePlanDigestDomain: parsed.m47OraclePlanDigestDomain,
        m47OracleResultDigestDomain: parsed.m47OracleResultDigestDomain,
        m47OracleGraphDigest: parsed.m47OracleGraphDigest,
        m47OracleExpectedUniverseDigest: parsed.m47OracleExpectedUniverseDigest,
        m47OracleExpectedCheckSetDigest: parsed.m47OracleExpectedCheckSetDigest,
        m47OracleExpectedFreezeDigest: parsed.m47OracleExpectedFreezeDigest,
        m47OracleExpectedKnownChangeDigest: parsed.m47OracleExpectedKnownChangeDigest,
        m47OracleExpectedUnresolvedChangeDigest: parsed.m47OracleExpectedUnresolvedChangeDigest,
        m47OracleExpectedKnownPlanDigest: parsed.m47OracleExpectedKnownPlanDigest,
        m47OracleExpectedUnresolvedPlanDigest: parsed.m47OracleExpectedUnresolvedPlanDigest,
        m47OracleExpectedResultDigest: parsed.m47OracleExpectedResultDigest,
        m47OracleAtomicCheckIds: parsed.m47OracleAtomicCheckIds,
        m47OracleAtomicChecks: parsed.m47OracleAtomicChecks,
        m47OracleRepeatedRuns: parsed.m47OracleRepeatedRuns,
        m47OracleDenominatorNegativeControlIds: parsed.m47OracleDenominatorNegativeControlIds,
        m47OracleDenominatorNegativeControls: parsed.m47OracleDenominatorNegativeControls,
        m47OraclePlannerIsolated: parsed.m47OraclePlannerIsolated,
        fi0Profile: parsed.fi0Profile,
        fi0DigestDomains: parsed.fi0DigestDomains,
        fi0ExpectedDigests: parsed.fi0ExpectedDigests,
        fi0BaselineFailureModes: parsed.fi0BaselineFailureModes,
        fi0AtomicCheckIds: parsed.fi0AtomicCheckIds,
        fi0AtomicChecks: parsed.fi0AtomicChecks,
        fi0RepeatedRuns: parsed.fi0RepeatedRuns,
        fi0DenominatorNegativeControlIds: parsed.fi0DenominatorNegativeControlIds,
        fi0DenominatorNegativeControls: parsed.fi0DenominatorNegativeControls,
        fi03Profile: parsed.fi03Profile,
        fi03CanonicalVectorId: parsed.fi03CanonicalVectorId,
        fi03ExpectedCanonicalVectorSha256: parsed.fi03ExpectedCanonicalVectorSha256,
        fi03ExpectedSemanticSummarySha256: parsed.fi03ExpectedSemanticSummarySha256,
        fi03CaseIds: parsed.fi03CaseIds,
        fi03RepeatedRuns: parsed.fi03RepeatedRuns,
        fi03DenominatorNegativeControlIds: parsed.fi03DenominatorNegativeControlIds,
        fi03DenominatorNegativeControls: parsed.fi03DenominatorNegativeControls,
        fi03CanonicalVectorProcess: parsed.fi03CanonicalVectorProcess,
        m07E14Freeze: parsed.m07E14Freeze,
        e16PreparedCases: parsed.e16PreparedCases,
        e16ExecutedCases: parsed.e16ExecutedCases,
        e16ReferenceModelCases: parsed.e16ReferenceModelCases,
        e16ImplementationPreparedCases: parsed.e16ImplementationPreparedCases,
        e16ImplementationExecutedCases: parsed.e16ImplementationExecutedCases,
        e16ImplementationCreditedCases: parsed.e16ImplementationCreditedCases,
        e16ImplementationNegativeControlsPrepared: parsed.e16ImplementationNegativeControlsPrepared,
      };
      const expectedDigest = sha256Canonical({
        stage5RootDigest: parsed.stage5RootDigest,
        manifestDigest: parsed.manifestDigest,
        digestManifestDigest: parsed.digestManifestDigest,
        rootDigests: parsed.rootDigests,
        digestFiles: [...manifest.hashedFiles],
        observedCounts,
        familyCounts: parsed.e16FamilyCounts,
        vectorResults: parsed.vectorResults,
      });
      const valid =
        parsed.schemaVersion === 1 &&
        parsed.status === "PASS" &&
        canonicalJson(parsed.rootDigests) === canonicalJson(manifest.rootContract) &&
        parsed.hashedFileCount === manifest.hashedFiles.length &&
        parsed.schemaCount === manifest.acceptance.schemaCount &&
        parsed.schemaClosureTests === manifest.acceptance.schemaClosureTests &&
        parsed.schemaValidCases === manifest.acceptance.schemaValidCases &&
        parsed.schemaInvalidCases === manifest.acceptance.schemaInvalidCases &&
        parsed.canonicalVectors === manifest.acceptance.canonicalVectors &&
        parsed.e16PreparedCases === manifest.acceptance.e16PreparedCases &&
        parsed.e16ExecutedCases === 0 &&
        parsed.e16ReferenceModelCases === manifest.acceptance.e16ReferenceModelCases &&
        parsed.e16ImplementationPreparedCases === manifest.acceptance.e16ImplementationPreparedCases &&
        parsed.e16ImplementationExecutedCases === 0 &&
        parsed.e16ImplementationCreditedCases === 0 &&
        parsed.e16ImplementationNegativeControlsPrepared ===
          manifest.acceptance.e16ImplementationNegativeControlsPrepared &&
        parsed.architectureDecisions === manifest.acceptance.architectureDecisions &&
        canonicalJson(parsed.m37GitBaseManifestCaseIds) ===
          canonicalJson(manifest.acceptance.m37GitBaseManifestCaseIds) &&
        parsed.m37GitBaseManifestCases === manifest.acceptance.m37GitBaseManifestCases &&
        parsed.m37GitBaseManifestRepeatedRuns ===
          manifest.acceptance.m37GitBaseManifestRepeatedRuns &&
        parsed.m37GitBaseManifestDenominatorNegativeControls ===
          manifest.acceptance.m37GitBaseManifestDenominatorNegativeControls &&
        canonicalJson(parsed.m37GitTreeDeltaAtomicCheckIds) ===
          canonicalJson(manifest.acceptance.m37GitTreeDeltaAtomicCheckIds) &&
        parsed.m37GitTreeDeltaAtomicChecks ===
          manifest.acceptance.m37GitTreeDeltaAtomicChecks &&
        parsed.m37GitTreeDeltaRepeatedRuns ===
          manifest.acceptance.m37GitTreeDeltaRepeatedRuns &&
        parsed.m37GitTreeDeltaDenominatorNegativeControls ===
          manifest.acceptance.m37GitTreeDeltaDenominatorNegativeControls &&
        canonicalJson(parsed.m46DependencyClosureAtomicCheckIds) ===
          canonicalJson(manifest.acceptance.m46DependencyClosureAtomicCheckIds) &&
        parsed.m46DependencyClosureAtomicChecks ===
          manifest.acceptance.m46DependencyClosureAtomicChecks &&
        parsed.m46DependencyClosureRepeatedRuns ===
          manifest.acceptance.m46DependencyClosureRepeatedRuns &&
        parsed.m46DependencyClosureProfile ===
          manifest.acceptance.m46DependencyClosureProfile &&
        parsed.m46DependencyNodeDigestDomain ===
          manifest.acceptance.m46DependencyNodeDigestDomain &&
        parsed.m46DependencyEdgeDigestDomain ===
          manifest.acceptance.m46DependencyEdgeDigestDomain &&
        parsed.m46DependencyGraphDigestDomain ===
          manifest.acceptance.m46DependencyGraphDigestDomain &&
        parsed.m46MinimumFixtureSubjectDigest ===
          manifest.acceptance.m46MinimumFixtureSubjectDigest &&
        parsed.m46MinimumFixtureGraphDigest ===
          manifest.acceptance.m46MinimumFixtureGraphDigest &&
        canonicalJson(parsed.m46DependencyClosureDenominatorNegativeControlIds) ===
          canonicalJson(manifest.acceptance.m46DependencyClosureDenominatorNegativeControlIds) &&
        parsed.m46DependencyClosureDenominatorNegativeControls ===
          manifest.acceptance.m46DependencyClosureDenominatorNegativeControls &&
        parsed.m46RecallProfile === manifest.acceptance.m46RecallProfile &&
        parsed.m46RecallScopeDigestDomain === manifest.acceptance.m46RecallScopeDigestDomain &&
        parsed.m46RecallReceiptDigestDomain === manifest.acceptance.m46RecallReceiptDigestDomain &&
        parsed.m46RecallReceiptSetDigestDomain ===
          manifest.acceptance.m46RecallReceiptSetDigestDomain &&
        parsed.m46RecallEventDigestDomain === manifest.acceptance.m46RecallEventDigestDomain &&
        parsed.m46RecallStateDigestDomain === manifest.acceptance.m46RecallStateDigestDomain &&
        parsed.m46RecallResultDigestDomain === manifest.acceptance.m46RecallResultDigestDomain &&
        parsed.m46RecallSubjectDigest === manifest.acceptance.m46RecallSubjectDigest &&
        parsed.m46RecallGraphDigest === manifest.acceptance.m46RecallGraphDigest &&
        parsed.m46RecallExpectedReceiptSetDigest ===
          manifest.acceptance.m46RecallExpectedReceiptSetDigest &&
        parsed.m46RecallExpectedBeforeStateDigest ===
          manifest.acceptance.m46RecallExpectedBeforeStateDigest &&
        parsed.m46RecallExpectedEventDigest === manifest.acceptance.m46RecallExpectedEventDigest &&
        parsed.m46RecallExpectedBarrierStateDigest ===
          manifest.acceptance.m46RecallExpectedBarrierStateDigest &&
        parsed.m46RecallExpectedAfterStateDigest ===
          manifest.acceptance.m46RecallExpectedAfterStateDigest &&
        parsed.m46RecallExpectedResultDigest ===
          manifest.acceptance.m46RecallExpectedResultDigest &&
        canonicalJson(parsed.m46RecallAtomicCheckIds) ===
          canonicalJson(manifest.acceptance.m46RecallAtomicCheckIds) &&
        parsed.m46RecallAtomicChecks === manifest.acceptance.m46RecallAtomicChecks &&
        parsed.m46RecallRepeatedRuns === manifest.acceptance.m46RecallRepeatedRuns &&
        canonicalJson(parsed.m46RecallDenominatorNegativeControlIds) ===
          canonicalJson(manifest.acceptance.m46RecallDenominatorNegativeControlIds) &&
        parsed.m46RecallDenominatorNegativeControls ===
          manifest.acceptance.m46RecallDenominatorNegativeControls &&
        parsed.m47OracleProfile === manifest.acceptance.m47OracleProfile &&
        parsed.m47OracleUniverseDigestDomain === manifest.acceptance.m47OracleUniverseDigestDomain &&
        parsed.m47OracleRecordDigestDomain === manifest.acceptance.m47OracleRecordDigestDomain &&
        parsed.m47OracleCheckDigestDomain === manifest.acceptance.m47OracleCheckDigestDomain &&
        parsed.m47OracleCheckSetDigestDomain === manifest.acceptance.m47OracleCheckSetDigestDomain &&
        parsed.m47OracleChangeDigestDomain === manifest.acceptance.m47OracleChangeDigestDomain &&
        parsed.m47OracleFreezeDigestDomain === manifest.acceptance.m47OracleFreezeDigestDomain &&
        parsed.m47OraclePlanDigestDomain === manifest.acceptance.m47OraclePlanDigestDomain &&
        parsed.m47OracleResultDigestDomain === manifest.acceptance.m47OracleResultDigestDomain &&
        parsed.m47OracleGraphDigest === manifest.acceptance.m47OracleGraphDigest &&
        parsed.m47OracleExpectedUniverseDigest === manifest.acceptance.m47OracleExpectedUniverseDigest &&
        parsed.m47OracleExpectedCheckSetDigest === manifest.acceptance.m47OracleExpectedCheckSetDigest &&
        parsed.m47OracleExpectedFreezeDigest === manifest.acceptance.m47OracleExpectedFreezeDigest &&
        parsed.m47OracleExpectedKnownChangeDigest === manifest.acceptance.m47OracleExpectedKnownChangeDigest &&
        parsed.m47OracleExpectedUnresolvedChangeDigest === manifest.acceptance.m47OracleExpectedUnresolvedChangeDigest &&
        parsed.m47OracleExpectedKnownPlanDigest === manifest.acceptance.m47OracleExpectedKnownPlanDigest &&
        parsed.m47OracleExpectedUnresolvedPlanDigest === manifest.acceptance.m47OracleExpectedUnresolvedPlanDigest &&
        parsed.m47OracleExpectedResultDigest === manifest.acceptance.m47OracleExpectedResultDigest &&
        canonicalJson(parsed.m47OracleAtomicCheckIds) ===
          canonicalJson(manifest.acceptance.m47OracleAtomicCheckIds) &&
        parsed.m47OracleAtomicChecks === manifest.acceptance.m47OracleAtomicChecks &&
        parsed.m47OracleRepeatedRuns === manifest.acceptance.m47OracleRepeatedRuns &&
        canonicalJson(parsed.m47OracleDenominatorNegativeControlIds) ===
          canonicalJson(manifest.acceptance.m47OracleDenominatorNegativeControlIds) &&
        parsed.m47OracleDenominatorNegativeControls === manifest.acceptance.m47OracleDenominatorNegativeControls &&
        parsed.m47OraclePlannerIsolated === manifest.acceptance.m47OraclePlannerIsolated &&
        parsed.fi0Profile === manifest.acceptance.fi0Profile &&
        canonicalJson(parsed.fi0DigestDomains) ===
          canonicalJson(manifest.acceptance.fi0DigestDomains) &&
        canonicalJson(parsed.fi0ExpectedDigests) ===
          canonicalJson(manifest.acceptance.fi0ExpectedDigests) &&
        canonicalJson(parsed.fi0BaselineFailureModes) ===
          canonicalJson(manifest.acceptance.fi0BaselineFailureModes) &&
        canonicalJson(parsed.fi0AtomicCheckIds) ===
          canonicalJson(manifest.acceptance.fi0AtomicCheckIds) &&
        parsed.fi0AtomicChecks === manifest.acceptance.fi0AtomicChecks &&
        parsed.fi0RepeatedRuns === manifest.acceptance.fi0RepeatedRuns &&
        canonicalJson(parsed.fi0DenominatorNegativeControlIds) ===
          canonicalJson(manifest.acceptance.fi0DenominatorNegativeControlIds) &&
        parsed.fi0DenominatorNegativeControls ===
          manifest.acceptance.fi0DenominatorNegativeControls &&
        parsed.fi03Profile === manifest.acceptance.fi03Profile &&
        parsed.fi03CanonicalVectorId === manifest.acceptance.fi03CanonicalVectorId &&
        parsed.fi03ExpectedCanonicalVectorSha256 ===
          manifest.acceptance.fi03ExpectedCanonicalVectorSha256 &&
        parsed.fi03ExpectedSemanticSummarySha256 ===
          manifest.acceptance.fi03ExpectedSemanticSummarySha256 &&
        canonicalJson(parsed.fi03CaseIds) === canonicalJson(manifest.acceptance.fi03CaseIds) &&
        parsed.fi03RepeatedRuns === manifest.acceptance.fi03RepeatedRuns &&
        canonicalJson(parsed.fi03DenominatorNegativeControlIds) ===
          canonicalJson(manifest.acceptance.fi03DenominatorNegativeControlIds) &&
        parsed.fi03DenominatorNegativeControls ===
          manifest.acceptance.fi03DenominatorNegativeControls &&
        canonicalJson(parsed.fi03CanonicalVectorProcess) ===
          canonicalJson(manifest.acceptance.fi03CanonicalVectorProcess) &&
        exactFi03Process === true &&
        canonicalJson(parsed.m07E14Freeze) === canonicalJson(manifest.acceptance.m07E14Freeze) &&
        parsed.vectorResults?.length === manifest.acceptance.canonicalVectors &&
        exactVectorEntries === true &&
        parsed.resultDigest === expectedDigest;
      return { semanticStatus: valid ? "PASS" : "FAIL_CONTRACT_RESULT", semanticValid: valid };
    }
  } catch {
    return { semanticStatus: "FAIL_RESULT_SCHEMA", semanticValid: false };
  }
  return { semanticStatus: "FAIL_UNKNOWN_STAGE", semanticValid: false };
}

const results = stages.map(run).map((result) => ({
  ...result,
  ...validateSemanticResult(result),
}));
const npmAgent = process.env.npm_config_user_agent ?? "";
const status =
  process.version === expectedNode &&
  npmAgent.startsWith(expectedNpmAgentPrefix) &&
  results.every((result) =>
    result.exitCode === 0 &&
    result.signal === null &&
    result.stderr === "" &&
    result.semanticValid === true)
    ? "PASS_STAGE5_STRUCTURAL_PREPARATION_ONLY"
    : "UNVERIFIED";
const evidence = {
  schemaVersion: 1,
  status,
  node: process.version,
  npmUserAgent: npmAgent,
  stages: results,
  protectedWitnessVerified: false,
  distinctPrincipalAuthorityVerified: false,
  generatedHelperRuntimeObserved: false,
  e14ScenarioExecutionComplete: false,
  e14ComparisonAdvantageVerified: false,
  e14AdoptionComplete: false,
  t164ThroughT183Credited: false,
  m4Credited: false,
  e16Complete: false,
  patentCredit: false,
  signingCredit: false,
  productionCredit: false,
  releaseCredit: false,
};
const output = {
  ...evidence,
  resultDigest: sha256Canonical(evidence),
};
emitDeterministic(output);
if (status !== "PASS_STAGE5_STRUCTURAL_PREPARATION_ONLY") {
  process.stderr.write(`${canonicalJson({
    stage5Failure: results.filter((result) =>
      result.exitCode !== 0 || result.signal !== null || result.stderr !== "" || result.semanticValid !== true),
  })}\n`);
  process.exitCode = 1;
}
