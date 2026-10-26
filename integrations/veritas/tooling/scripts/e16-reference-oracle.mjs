import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  emitDeterministic,
  exactKeys,
  readJson,
  sha256Bytes,
  sha256Canonical,
  sha256File,
  toolingRoot,
} from "./common.mjs";

const PROFILE = "veritas-e16-stage5-pure-reference-model-v1";
const EVIDENCE_CLASS = "SELF_ADMINISTERED_PURE_REFERENCE_MODEL";
const PASS_STATUS = "PASS_STAGE5_E16_REFERENCE_MODEL_SUBSET_ONLY";
const FAIL_STATUS = "FAIL_STAGE5_E16_REFERENCE_MODEL_SUBSET";
const CASE_PASS_STATUS = "PASS_REFERENCE_MODEL_ONLY";
const CASE_FAIL_STATUS = "FAIL_REFERENCE_MODEL";
const CLEAN_OUTCOME = "CLEAN_ACCEPTED";
const MODEL_ERROR_OUTCOME = "MODEL_ERROR";

const creditKeys = [
  "protectedAuthority",
  "nativeRuntime",
  "t164ThroughT183",
  "m4",
  "e16",
  "patent",
  "production",
  "release",
];
const zeroCredits = Object.freeze(Object.fromEntries(creditKeys.map((key) => [key, false])));
const expectedFamilyDenominators = Object.freeze({
  AUTHORITY_MUTATION: 8,
  DIGEST_SUBSTITUTION: 6,
  PROMOTION_CRASH_OR_RACE: 6,
  PRIOR_TARGET_RECOVERY: 4,
});
const expectedOutcomes = new Set([
  "REFUSE_BEFORE_DECISION",
  "REFUSE_BEFORE_PROMOTION",
  "ROLL_BACK_TO_PRIOR_TARGET",
  "RECALL_AFTER_ACCEPTANCE",
  "CONVERGE_IDEMPOTENTLY",
  "WITHHOLD_AS_UNCERTAIN",
]);
const injectionPoints = new Set([
  "AFTER_AUTHORITY_FREEZE",
  "AFTER_DECISION_VERIFICATION",
  "BEFORE_OBJECT_WRITE",
  "AFTER_OBJECT_WRITE",
  "BEFORE_REFERENCE_SWAP",
  "AFTER_REFERENCE_SWAP",
  "AFTER_REFERENCE_ACCEPTANCE_BEFORE_READBACK",
  "BEFORE_READBACK",
  "DURING_ROLLBACK",
  "AFTER_ACCEPTANCE",
]);
const mutationKinds = new Set([
  "POLICY_DIGEST_SUBSTITUTION",
  "VERIFIER_SET_DIGEST_SUBSTITUTION",
  "ADAPTER_SET_DIGEST_SUBSTITUTION",
  "HOOK_SET_DIGEST_SUBSTITUTION",
  "TRUSTED_COMMAND_SET_DIGEST_SUBSTITUTION",
  "BASE_REVISION_SUBSTITUTION",
  "WRITER_SELF_APPROVAL",
  "DEPENDENCY_EPOCH_ADVANCE",
  "FINAL_CANDIDATE_SUBSTITUTION",
  "DECISION_SUBJECT_SUBSTITUTION",
  "MODEL_RESPONSE_AS_ACCEPTED_ARTIFACT",
  "DESTINATION_BYTES_SUBSTITUTION",
  "TRANSACTION_OWNED_UNVERIFIED_REFERENCE",
  "DESTINATION_RECEIPT_REUSE",
  "SYMBOLIC_INTERRUPT_BEFORE_OBJECT_WRITE",
  "SYMBOLIC_INTERRUPT_AFTER_OBJECT_WRITE",
  "SYMBOLIC_INTERRUPT_AFTER_REFERENCE_SWAP",
  "LOST_SUCCESS_RESPONSE_RECOVERY_REPLAY",
  "SYMBOLIC_UNORDERED_WRITER_RACE",
  "DEPENDENCY_EVENT_AFTER_REFERENCE_ACCEPTANCE",
  "PREPARED_OBJECT_CORRUPTION",
  "ROLLBACK_CURRENT_TARGET_CORRUPTION",
  "ROLLBACK_PRIOR_TARGET_UNAVAILABLE",
  "ROLLBACK_STALE_READBACK",
]);
const expectedMutationDeltaPaths = Object.freeze({
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
const expectedUncertainReferenceTransitions = Object.freeze({
  SYMBOLIC_INTERRUPT_AFTER_REFERENCE_SWAP: 1,
  SYMBOLIC_UNORDERED_WRITER_RACE: 0,
  ROLLBACK_CURRENT_TARGET_CORRUPTION: 1,
  ROLLBACK_PRIOR_TARGET_UNAVAILABLE: 1,
  ROLLBACK_STALE_READBACK: 2,
});

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function changedDigest(label) {
  return sha256Bytes(`veritas-reference-model:changed:${label}`);
}

function initialBindings(caseId) {
  return {
    operationId: `reference-model:${caseId}`,
    authority: {
      policyDigest: sha256Bytes("veritas-reference-model:authority:policy"),
      verifierSetDigest: sha256Bytes("veritas-reference-model:authority:verifiers"),
      adapterSetDigest: sha256Bytes("veritas-reference-model:authority:adapters"),
      hookSetDigest: sha256Bytes("veritas-reference-model:authority:hooks"),
      trustedCommandSetDigest: sha256Bytes("veritas-reference-model:authority:commands"),
      baseRevision: "base-revision-0001",
      dependencyEpoch: 7,
      requiredApprovalMode: "ROLE_SEPARATED",
    },
    writerId: "principal:writer",
    approverId: "principal:approver",
    candidateDigest: sha256Bytes(`veritas-reference-model:candidate:${caseId}`),
    modelResponseDigest: sha256Bytes(`veritas-reference-model:model-response:${caseId}`),
    priorTargetDigest: sha256Bytes(`veritas-reference-model:prior-target:${caseId}`),
  };
}

function initialState(caseId) {
  const bindings = initialBindings(caseId);
  return {
    ...bindings,
    authorityObserved: structuredClone(bindings.authority),
    observedApproverId: bindings.approverId,
    observedCandidateDigest: bindings.candidateDigest,
    observedDecisionSubjectDigest: bindings.candidateDigest,
    observedAcceptedArtifactDigest: bindings.candidateDigest,
    observedReceiptBindingDigest: null,
    preparedObjectDigest: bindings.candidateDigest,
    destinationDigest: bindings.priorTargetDigest,
    readbackDigest: bindings.priorTargetDigest,
    priorTargetAvailable: true,
    phase: "INIT",
    injectionPointObserved: null,
    mutationApplied: false,
    mutationDeltaPaths: [],
    flags: [],
    referenceTransitionCount: 0,
    acceptedEffectCount: 0,
    receiptCount: 0,
    activeReceiptCount: 0,
    recallEventCount: 0,
    recoveryOrReplayCount: 0,
    reusable: false,
    candidateProcessSpawned: false,
    protectedAuthorityVerified: false,
    externalEvidenceObserved: false,
    trace: [],
  };
}

function mutationProjection(state) {
  return {
    authorityObserved: state.authorityObserved,
    observedApproverId: state.observedApproverId,
    observedCandidateDigest: state.observedCandidateDigest,
    observedDecisionSubjectDigest: state.observedDecisionSubjectDigest,
    observedAcceptedArtifactDigest: state.observedAcceptedArtifactDigest,
    observedReceiptBindingDigest: state.observedReceiptBindingDigest,
    destinationDigest: state.destinationDigest,
    readbackDigest: state.readbackDigest,
    flags: [...state.flags],
  };
}

function changedPaths(before, after, prefix = "") {
  if (canonicalJson(before) === canonicalJson(after)) return [];
  if (
    before === null || after === null ||
    typeof before !== "object" || typeof after !== "object" ||
    Array.isArray(before) || Array.isArray(after)
  ) return [prefix];
  const paths = [];
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    paths.push(...changedPaths(before[key], after[key], path));
  }
  return paths.sort();
}

function trace(state, event) {
  state.trace.push(`${String(state.trace.length).padStart(2, "0")}:${event}`);
}

function setPhase(state, phase) {
  state.phase = phase;
  trace(state, `PHASE:${phase}`);
}

function addFlag(state, flag) {
  if (!state.flags.includes(flag)) state.flags.push(flag);
}

function hasFlag(state, flag) {
  return state.flags.includes(flag);
}

function applyInjection(state, scenario, point, mutationEnabled) {
  if (scenario.injectionPoint !== point) return;
  assertCondition(state.injectionPointObserved === null, `Scenario ${scenario.caseId} reached its injection point twice.`);
  state.injectionPointObserved = point;
  trace(state, `INJECTION_REACHED:${point}`);
  if (!mutationEnabled) {
    trace(state, "MUTATION_DISABLED:CLEAN_TWIN");
    return;
  }
  if (scenario.mutationKind === "NO_OP") {
    trace(state, "MUTATION_NO_OP:NEGATIVE_CONTROL");
    return;
  }
  const before = structuredClone(mutationProjection(state));
  switch (scenario.mutationKind) {
    case "POLICY_DIGEST_SUBSTITUTION":
      state.authorityObserved.policyDigest = changedDigest(scenario.mutationKind);
      break;
    case "VERIFIER_SET_DIGEST_SUBSTITUTION":
      state.authorityObserved.verifierSetDigest = changedDigest(scenario.mutationKind);
      break;
    case "ADAPTER_SET_DIGEST_SUBSTITUTION":
      state.authorityObserved.adapterSetDigest = changedDigest(scenario.mutationKind);
      break;
    case "HOOK_SET_DIGEST_SUBSTITUTION":
      state.authorityObserved.hookSetDigest = changedDigest(scenario.mutationKind);
      break;
    case "TRUSTED_COMMAND_SET_DIGEST_SUBSTITUTION":
      state.authorityObserved.trustedCommandSetDigest = changedDigest(scenario.mutationKind);
      break;
    case "BASE_REVISION_SUBSTITUTION":
      state.authorityObserved.baseRevision = "base-revision-0002";
      break;
    case "WRITER_SELF_APPROVAL":
      state.observedApproverId = state.writerId;
      break;
    case "DEPENDENCY_EPOCH_ADVANCE":
      state.authorityObserved.dependencyEpoch += 1;
      break;
    case "FINAL_CANDIDATE_SUBSTITUTION":
      state.observedCandidateDigest = changedDigest(scenario.mutationKind);
      break;
    case "DECISION_SUBJECT_SUBSTITUTION":
      state.observedDecisionSubjectDigest = changedDigest(scenario.mutationKind);
      break;
    case "MODEL_RESPONSE_AS_ACCEPTED_ARTIFACT":
      state.observedAcceptedArtifactDigest = state.modelResponseDigest;
      break;
    case "DESTINATION_RECEIPT_REUSE":
      state.observedReceiptBindingDigest = changedDigest(scenario.mutationKind);
      break;
    case "DESTINATION_BYTES_SUBSTITUTION":
      state.readbackDigest = changedDigest(scenario.mutationKind);
      break;
    case "TRANSACTION_OWNED_UNVERIFIED_REFERENCE":
      state.destinationDigest = changedDigest(scenario.mutationKind);
      state.readbackDigest = state.destinationDigest;
      addFlag(state, "TRANSACTION_OWNED_REFERENCE_FAULT");
      break;
    case "SYMBOLIC_INTERRUPT_BEFORE_OBJECT_WRITE":
    case "SYMBOLIC_INTERRUPT_AFTER_OBJECT_WRITE":
    case "SYMBOLIC_INTERRUPT_AFTER_REFERENCE_SWAP":
    case "LOST_SUCCESS_RESPONSE_RECOVERY_REPLAY":
    case "SYMBOLIC_UNORDERED_WRITER_RACE":
    case "DEPENDENCY_EVENT_AFTER_REFERENCE_ACCEPTANCE":
    case "PREPARED_OBJECT_CORRUPTION":
    case "ROLLBACK_CURRENT_TARGET_CORRUPTION":
    case "ROLLBACK_PRIOR_TARGET_UNAVAILABLE":
    case "ROLLBACK_STALE_READBACK":
      addFlag(state, scenario.mutationKind);
      break;
    default:
      throw new Error(`Unknown reference-model mutation ${scenario.mutationKind}.`);
  }
  state.mutationDeltaPaths = changedPaths(before, mutationProjection(state));
  const expectedDeltas = expectedMutationDeltaPaths[scenario.mutationKind];
  assertCondition(Array.isArray(expectedDeltas), `Missing exact mutation-delta contract for ${scenario.mutationKind}.`);
  state.mutationApplied = canonicalJson(state.mutationDeltaPaths) === canonicalJson(expectedDeltas);
  trace(
    state,
    state.mutationApplied
      ? `MUTATION_APPLIED:${scenario.mutationKind}`
      : `MUTATION_DELTA_INVALID:${scenario.mutationKind}`,
  );
}

function authorityGateMatches(state) {
  return canonicalJson(state.authorityObserved) === canonicalJson(state.authority) &&
    (state.authority.requiredApprovalMode !== "ROLE_SEPARATED" || state.observedApproverId !== state.writerId);
}

function promotionBindingsMatch(state) {
  return state.observedCandidateDigest === state.candidateDigest &&
    state.observedDecisionSubjectDigest === state.candidateDigest &&
    state.observedAcceptedArtifactDigest === state.candidateDigest &&
    state.observedReceiptBindingDigest === null;
}

function stateProjection(state) {
  return {
    operationId: state.operationId,
    authority: state.authority,
    writerId: state.writerId,
    approverId: state.approverId,
    candidateDigest: state.candidateDigest,
    modelResponseDigest: state.modelResponseDigest,
    priorTargetDigest: state.priorTargetDigest,
    authorityObserved: state.authorityObserved,
    observedApproverId: state.observedApproverId,
    observedCandidateDigest: state.observedCandidateDigest,
    observedDecisionSubjectDigest: state.observedDecisionSubjectDigest,
    observedAcceptedArtifactDigest: state.observedAcceptedArtifactDigest,
    observedReceiptBindingDigest: state.observedReceiptBindingDigest,
    preparedObjectDigest: state.preparedObjectDigest,
    destinationDigest: state.destinationDigest,
    readbackDigest: state.readbackDigest,
    priorTargetAvailable: state.priorTargetAvailable,
    phase: state.phase,
    injectionPointObserved: state.injectionPointObserved,
    mutationApplied: state.mutationApplied,
    mutationDeltaPaths: [...state.mutationDeltaPaths],
    flags: [...state.flags],
    referenceTransitionCount: state.referenceTransitionCount,
    acceptedEffectCount: state.acceptedEffectCount,
    receiptCount: state.receiptCount,
    activeReceiptCount: state.activeReceiptCount,
    recallEventCount: state.recallEventCount,
    recoveryOrReplayCount: state.recoveryOrReplayCount,
    reusable: state.reusable,
    candidateProcessSpawned: state.candidateProcessSpawned,
    protectedAuthorityVerified: state.protectedAuthorityVerified,
    externalEvidenceObserved: state.externalEvidenceObserved,
  };
}

function preStateProjection(state) {
  return {
    operationId: state.operationId,
    authorityDigest: sha256Canonical(state.authority),
    candidateDigest: state.candidateDigest,
    priorTargetDigest: state.priorTargetDigest,
    destinationDigest: state.priorTargetDigest,
    readbackDigest: state.priorTargetDigest,
    phase: "INIT",
  };
}

function postResultProjection(result) {
  return {
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
  };
}

function replaySerializedState(serializedState, suppliedOperationId) {
  const recovered = JSON.parse(serializedState);
  const before = stateProjection(recovered);
  if (suppliedOperationId !== recovered.operationId) {
    trace(recovered, `REPLAY_CONFLICT:OPERATION_ID:${suppliedOperationId}`);
    return {
      state: recovered,
      disposition: "REJECTED_DIFFERENT_OPERATION_ID",
      stateUnchanged: canonicalJson(stateProjection(recovered)) === canonicalJson(before),
    };
  }
  trace(recovered, `RECOVERY_REPLAY:SAME_OPERATION_ID:${suppliedOperationId}`);
  return {
    state: recovered,
    disposition: "RESUMED_SAME_OPERATION_ID",
    stateUnchanged: canonicalJson(stateProjection(recovered)) === canonicalJson(before),
  };
}

function buildRawResult(state, scenario, preStateDigest, observedOutcome, diagnosticCode) {
  const referenceTransitionCount = countTrace(state, "REFERENCE_WRITE:");
  const acceptedEffectCount = countTrace(state, "ACCEPTED_EFFECT:");
  const receiptCount = countTrace(state, "RECEIPT_ISSUED:");
  const recallEventCount = countTrace(state, "RECALL_EVENT:");
  const recoveryOrReplayCount = countTrace(state, "RECOVERY_REPLAY:");
  const result = {
    schemaVersion: 1,
    profile: PROFILE,
    evidenceClass: EVIDENCE_CLASS,
    caseId: scenario.caseId,
    family: scenario.family,
    operationId: state.operationId,
    scenarioDigest: sha256Canonical(scenario),
    preStateDigest,
    injectionPointExpected: scenario.injectionPoint,
    injectionPointObserved: state.injectionPointObserved,
    mutationApplied: state.mutationApplied,
    mutationDeltaPaths: [...state.mutationDeltaPaths],
    observedOutcome,
    terminalPhase: state.phase,
    diagnosticCode,
    authorityDigestBefore: sha256Canonical(state.authority),
    authorityDigestAfter: sha256Canonical(state.authority),
    attemptedAuthorityDigest: sha256Canonical(state.authorityObserved),
    candidateDigest: state.candidateDigest,
    priorTargetDigest: state.priorTargetDigest,
    destinationDigest: state.destinationDigest,
    readbackDigest: state.readbackDigest,
    priorTargetPreserved:
      state.destinationDigest === state.priorTargetDigest && state.readbackDigest === state.priorTargetDigest,
    referenceTransitionCount,
    acceptedEffectCount,
    receiptCount,
    activeReceiptCount: receiptCount - recallEventCount,
    recallEventCount,
    recoveryOrReplayCount,
    reusable: state.reusable,
    candidateProcessSpawned: state.candidateProcessSpawned,
    protectedAuthorityVerified: state.protectedAuthorityVerified,
    externalEvidenceObserved: state.externalEvidenceObserved,
    trace: [...state.trace],
    traceDigest: sha256Canonical(state.trace),
  };
  result.postStateDigest = sha256Canonical(postResultProjection(result));
  return result;
}

function finishUncertain(state, scenario, preStateDigest, diagnosticCode) {
  state.activeReceiptCount = 0;
  state.reusable = false;
  setPhase(state, "UNCERTAIN");
  return buildRawResult(
    state,
    scenario,
    preStateDigest,
    "WITHHOLD_AS_UNCERTAIN",
    diagnosticCode,
  );
}

function performRollback(state, scenario, preStateDigest, mutationEnabled) {
  setPhase(state, "ROLLBACK_IN_PROGRESS");
  applyInjection(state, scenario, "DURING_ROLLBACK", mutationEnabled);
  if (hasFlag(state, "ROLLBACK_CURRENT_TARGET_CORRUPTION")) {
    state.destinationDigest = changedDigest("ROLLBACK_CURRENT_TARGET_CORRUPTION");
    state.readbackDigest = null;
    trace(state, "ROLLBACK_WITHHELD:TARGET_OWNERSHIP_UNPROVABLE");
    return finishUncertain(state, scenario, preStateDigest, "REFERENCE_OWNERSHIP_UNPROVABLE");
  }
  if (hasFlag(state, "ROLLBACK_PRIOR_TARGET_UNAVAILABLE")) {
    state.priorTargetAvailable = false;
    state.readbackDigest = null;
    trace(state, "ROLLBACK_WITHHELD:PRIOR_TARGET_UNAVAILABLE");
    return finishUncertain(state, scenario, preStateDigest, "PRIOR_TARGET_UNAVAILABLE");
  }
  assertCondition(state.priorTargetDigest !== null, "Reference-model rollback requires a non-null prior target.");
  state.destinationDigest = state.priorTargetDigest;
  state.referenceTransitionCount += 1;
  trace(state, "REFERENCE_WRITE:ROLLBACK_TO_PRIOR_TARGET");
  state.readbackDigest = hasFlag(state, "ROLLBACK_STALE_READBACK")
    ? changedDigest("ROLLBACK_STALE_READBACK")
    : state.priorTargetDigest;
  trace(state, "READBACK:ROLLBACK_TARGET");
  if (state.readbackDigest !== state.priorTargetDigest) {
    trace(state, "ROLLBACK_WITHHELD:READBACK_MISMATCH");
    return finishUncertain(state, scenario, preStateDigest, "ROLLBACK_READBACK_UNCONFIRMED");
  }
  state.acceptedEffectCount = 0;
  state.receiptCount = 0;
  state.activeReceiptCount = 0;
  state.reusable = false;
  setPhase(state, "ROLLED_BACK");
  return buildRawResult(
    state,
    scenario,
    preStateDigest,
    "ROLL_BACK_TO_PRIOR_TARGET",
    "EXACT_PRIOR_TARGET_RESTORED",
  );
}

function simulateScenario(scenario, mutationEnabled = true) {
  let state = initialState(scenario.caseId);
  const preStateDigest = sha256Canonical(preStateProjection(state));
  setPhase(state, "AUTHORITY_FROZEN");
  applyInjection(state, scenario, "AFTER_AUTHORITY_FREEZE", mutationEnabled);
  if (!authorityGateMatches(state)) {
    trace(state, "GATE_REFUSAL:AUTHORITY_BINDING");
    setPhase(state, "REFUSED_BEFORE_DECISION");
    return buildRawResult(
      state,
      scenario,
      preStateDigest,
      "REFUSE_BEFORE_DECISION",
      "FROZEN_AUTHORITY_OR_ROLE_MISMATCH",
    );
  }

  setPhase(state, "DECISION_VERIFIED");
  applyInjection(state, scenario, "AFTER_DECISION_VERIFICATION", mutationEnabled);
  if (!promotionBindingsMatch(state)) {
    trace(state, "GATE_REFUSAL:PROMOTION_BINDING");
    setPhase(state, "REFUSED_BEFORE_PROMOTION");
    return buildRawResult(
      state,
      scenario,
      preStateDigest,
      "REFUSE_BEFORE_PROMOTION",
      "CANDIDATE_DECISION_OR_RECEIPT_BINDING_MISMATCH",
    );
  }

  applyInjection(state, scenario, "BEFORE_OBJECT_WRITE", mutationEnabled);
  if (hasFlag(state, "SYMBOLIC_INTERRUPT_BEFORE_OBJECT_WRITE")) {
    trace(state, "SYMBOLIC_INTERRUPTION:BEFORE_OBJECT_WRITE");
    const replay = replaySerializedState(canonicalJson(state), state.operationId);
    assertCondition(replay.disposition === "RESUMED_SAME_OPERATION_ID" && replay.stateUnchanged, "Same-operation recovery replay was not identity-preserving.");
    state = replay.state;
  }
  state.preparedObjectDigest = state.candidateDigest;
  trace(state, "OBJECT_WRITE:CANDIDATE_DIGEST");
  setPhase(state, "OBJECT_PREPARED");
  applyInjection(state, scenario, "AFTER_OBJECT_WRITE", mutationEnabled);
  if (hasFlag(state, "SYMBOLIC_INTERRUPT_AFTER_OBJECT_WRITE")) {
    trace(state, "SYMBOLIC_INTERRUPTION:AFTER_OBJECT_WRITE");
    const replay = replaySerializedState(canonicalJson(state), state.operationId);
    assertCondition(replay.disposition === "RESUMED_SAME_OPERATION_ID" && replay.stateUnchanged, "Same-operation recovery replay was not identity-preserving.");
    state = replay.state;
  }
  if (hasFlag(state, "PREPARED_OBJECT_CORRUPTION")) {
    state.preparedObjectDigest = changedDigest("PREPARED_OBJECT_CORRUPTION");
    trace(state, "PREPARED_OBJECT_REJECTED:DIGEST_MISMATCH");
    setPhase(state, "ROLLED_BACK");
    return buildRawResult(
      state,
      scenario,
      preStateDigest,
      "ROLL_BACK_TO_PRIOR_TARGET",
      "CORRUPT_PREPARED_OBJECT_NEVER_REFERENCED",
    );
  }

  applyInjection(state, scenario, "BEFORE_REFERENCE_SWAP", mutationEnabled);
  if (hasFlag(state, "SYMBOLIC_UNORDERED_WRITER_RACE")) {
    trace(state, "ORDERING_WITHHELD:SYMBOLIC_WRITER_RACE");
    return finishUncertain(state, scenario, preStateDigest, "WRITER_ORDERING_UNOBSERVED");
  }

  state.destinationDigest = state.candidateDigest;
  state.readbackDigest = state.candidateDigest;
  state.referenceTransitionCount += 1;
  trace(state, "REFERENCE_WRITE:CANDIDATE_DIGEST");
  setPhase(state, "REFERENCE_SWAPPED");
  applyInjection(state, scenario, "AFTER_REFERENCE_SWAP", mutationEnabled);
  if (hasFlag(state, "SYMBOLIC_INTERRUPT_AFTER_REFERENCE_SWAP")) {
    state.readbackDigest = null;
    trace(state, "SYMBOLIC_INTERRUPTION:AFTER_REFERENCE_SWAP_WITHOUT_READBACK");
    return finishUncertain(state, scenario, preStateDigest, "DESTINATION_READBACK_NOT_OBSERVED");
  }

  setPhase(state, "REFERENCE_ACCEPTED");
  applyInjection(state, scenario, "AFTER_REFERENCE_ACCEPTANCE_BEFORE_READBACK", mutationEnabled);
  applyInjection(state, scenario, "BEFORE_READBACK", mutationEnabled);
  if (
    hasFlag(state, "ROLLBACK_CURRENT_TARGET_CORRUPTION") ||
    hasFlag(state, "ROLLBACK_PRIOR_TARGET_UNAVAILABLE") ||
    hasFlag(state, "ROLLBACK_STALE_READBACK") ||
    (mutationEnabled && scenario.injectionPoint === "DURING_ROLLBACK")
  ) {
    state.readbackDigest = changedDigest("BASELINE_READBACK_MISMATCH");
    trace(state, "READBACK:BASELINE_MISMATCH_REQUIRING_ROLLBACK");
  } else {
    trace(state, "READBACK:DESTINATION_TARGET");
  }
  if (state.destinationDigest !== state.candidateDigest || state.readbackDigest !== state.candidateDigest) {
    return performRollback(state, scenario, preStateDigest, mutationEnabled);
  }

  setPhase(state, "READBACK_VERIFIED");
  state.acceptedEffectCount = 1;
  state.receiptCount = 1;
  state.activeReceiptCount = 1;
  state.reusable = true;
  trace(state, "ACCEPTED_EFFECT:EXACT_CANDIDATE_DIGEST");
  trace(state, "RECEIPT_ISSUED:ACTIVE");
  setPhase(state, "ACCEPTED");
  applyInjection(state, scenario, "AFTER_ACCEPTANCE", mutationEnabled);
  if (hasFlag(state, "LOST_SUCCESS_RESPONSE_RECOVERY_REPLAY")) {
    const replay = replaySerializedState(canonicalJson(state), state.operationId);
    assertCondition(replay.disposition === "RESUMED_SAME_OPERATION_ID" && replay.stateUnchanged, "Accepted-result recovery replay was not identity-preserving.");
    state = replay.state;
    trace(state, "REPLAY_RESULT:EXISTING_RECEIPT_NO_DUPLICATE_EFFECT");
    return buildRawResult(
      state,
      scenario,
      preStateDigest,
      "CONVERGE_IDEMPOTENTLY",
      "RECOVERY_REPLAY_RETURNED_EXISTING_RESULT",
    );
  }
  if (hasFlag(state, "DEPENDENCY_EVENT_AFTER_REFERENCE_ACCEPTANCE")) {
    state.recallEventCount = 1;
    state.activeReceiptCount = 0;
    state.reusable = false;
    trace(state, "RECALL_EVENT:DEPENDENCY_EPOCH_ADVANCED");
    setPhase(state, "RECALLED");
    return buildRawResult(
      state,
      scenario,
      preStateDigest,
      "RECALL_AFTER_ACCEPTANCE",
      "REFERENCE_ACCEPTED_THEN_TRUST_RECALLED",
    );
  }
  if (
    hasFlag(state, "SYMBOLIC_INTERRUPT_BEFORE_OBJECT_WRITE") ||
    hasFlag(state, "SYMBOLIC_INTERRUPT_AFTER_OBJECT_WRITE")
  ) {
    return buildRawResult(
      state,
      scenario,
      preStateDigest,
      "CONVERGE_IDEMPOTENTLY",
      "SYMBOLIC_RECOVERY_REPLAY_CONVERGED_ONCE",
    );
  }
  return buildRawResult(
    state,
    scenario,
    preStateDigest,
    mutationEnabled ? MODEL_ERROR_OUTCOME : CLEAN_OUTCOME,
    mutationEnabled ? "MUTATION_DID_NOT_DETERMINE_TERMINAL_OUTCOME" : "CLEAN_PATH_ACCEPTED",
  );
}

function countTrace(result, prefix) {
  return result.trace.filter((entry) => entry.includes(prefix)).length;
}

function validateTraceDerivedCounts(result, findings) {
  const derived = {
    referenceTransitionCount: countTrace(result, "REFERENCE_WRITE:"),
    acceptedEffectCount: countTrace(result, "ACCEPTED_EFFECT:"),
    receiptCount: countTrace(result, "RECEIPT_ISSUED:"),
    recallEventCount: countTrace(result, "RECALL_EVENT:"),
    recoveryOrReplayCount: countTrace(result, "RECOVERY_REPLAY:"),
  };
  for (const [key, value] of Object.entries(derived)) {
    if (result[key] !== value) findings.push(`${key}_NOT_TRACE_DERIVED`);
  }
  const expectedActiveReceipts = derived.receiptCount - derived.recallEventCount;
  if (result.activeReceiptCount !== expectedActiveReceipts) findings.push("ACTIVE_RECEIPT_COUNT_NOT_TRACE_DERIVED");
}

function validateOutcomeSemantics(result, findings) {
  const exactCandidateReadback =
    result.destinationDigest === result.candidateDigest && result.readbackDigest === result.candidateDigest;
  switch (result.observedOutcome) {
    case "REFUSE_BEFORE_DECISION":
      if (result.terminalPhase !== "REFUSED_BEFORE_DECISION") findings.push("REFUSAL_PHASE_INVALID");
      if (!result.priorTargetPreserved) findings.push("REFUSAL_CHANGED_PRIOR_TARGET");
      if (result.receiptCount !== 0 || result.acceptedEffectCount !== 0) findings.push("REFUSAL_EMITTED_EFFECT");
      break;
    case "REFUSE_BEFORE_PROMOTION":
      if (result.terminalPhase !== "REFUSED_BEFORE_PROMOTION") findings.push("REFUSAL_PHASE_INVALID");
      if (!result.priorTargetPreserved) findings.push("REFUSAL_CHANGED_PRIOR_TARGET");
      if (result.receiptCount !== 0 || result.acceptedEffectCount !== 0) findings.push("REFUSAL_EMITTED_EFFECT");
      break;
    case "ROLL_BACK_TO_PRIOR_TARGET":
      if (result.terminalPhase !== "ROLLED_BACK") findings.push("ROLLBACK_PHASE_INVALID");
      if (!result.priorTargetPreserved) findings.push("ROLLBACK_PRIOR_TARGET_NOT_PROVEN");
      if (result.receiptCount !== 0 || result.acceptedEffectCount !== 0) findings.push("ROLLBACK_EMITTED_ACCEPTANCE");
      break;
    case "CONVERGE_IDEMPOTENTLY":
      if (result.terminalPhase !== "ACCEPTED") findings.push("CONVERGENCE_PHASE_INVALID");
      if (!exactCandidateReadback) findings.push("CONVERGENCE_DIGEST_MISMATCH");
      if (result.receiptCount !== 1 || result.acceptedEffectCount !== 1) findings.push("CONVERGENCE_NOT_EXACTLY_ONCE");
      if (result.recoveryOrReplayCount < 1 || !result.reusable) findings.push("CONVERGENCE_REPLAY_OR_REUSE_INVALID");
      if (
        result.trace
          .filter((entry) => entry.includes("RECOVERY_REPLAY:"))
          .some((entry) => !entry.includes(result.operationId))
      ) findings.push("CONVERGENCE_OPERATION_ID_NOT_BOUND");
      break;
    case "WITHHOLD_AS_UNCERTAIN":
      if (result.terminalPhase !== "UNCERTAIN") findings.push("UNCERTAINTY_PHASE_INVALID");
      if (result.activeReceiptCount !== 0 || result.reusable) findings.push("UNCERTAINTY_BECAME_REUSABLE");
      if (result.acceptedEffectCount !== 0 || result.receiptCount !== 0 || result.recallEventCount !== 0) {
        findings.push("UNCERTAINTY_EMITTED_ACCEPTANCE_OR_RECEIPT");
      }
      break;
    case "RECALL_AFTER_ACCEPTANCE":
      if (result.terminalPhase !== "RECALLED") findings.push("RECALL_PHASE_INVALID");
      if (!exactCandidateReadback) findings.push("RECALL_ACCEPTANCE_DIGEST_MISMATCH");
      if (
        result.receiptCount !== 1 ||
        result.activeReceiptCount !== 0 ||
        result.recallEventCount !== 1 ||
        result.acceptedEffectCount !== 1 ||
        result.reusable
      ) findings.push("RECALL_LIFECYCLE_INVALID");
      break;
    default:
      findings.push("OBSERVED_OUTCOME_UNSUPPORTED");
  }
}

function validateCaseCore(result, manifestCase, scenario) {
  const findings = [];
  if (result.profile !== PROFILE || result.evidenceClass !== EVIDENCE_CLASS) findings.push("IDENTITY_MISMATCH");
  if (result.caseId !== manifestCase.caseId || result.caseId !== scenario.caseId) findings.push("CASE_ID_MISMATCH");
  if (result.family !== manifestCase.family || result.family !== scenario.family) findings.push("FAMILY_MISMATCH");
  if (result.scenarioDigest !== sha256Canonical(scenario)) findings.push("SCENARIO_DIGEST_MISMATCH");
  if (result.operationId !== `reference-model:${scenario.caseId}`) findings.push("OPERATION_ID_BINDING_MISMATCH");
  if (result.preStateDigest !== sha256Canonical(preStateProjection(initialState(scenario.caseId)))) findings.push("PRE_STATE_DIGEST_MISMATCH");
  if (result.postStateDigest !== sha256Canonical(postResultProjection(result))) findings.push("POST_STATE_DIGEST_MISMATCH");
  if (result.injectionPointExpected !== scenario.injectionPoint || result.injectionPointObserved !== scenario.injectionPoint) {
    findings.push("INJECTION_POINT_NOT_REACHED_EXACTLY");
  }
  if (!result.mutationApplied) findings.push("MUTATION_NOT_APPLIED");
  const expectedDeltas = expectedMutationDeltaPaths[scenario.mutationKind];
  if (!Array.isArray(expectedDeltas) || canonicalJson(result.mutationDeltaPaths) !== canonicalJson(expectedDeltas)) {
    findings.push("MUTATION_SPECIFIC_DELTA_MISMATCH");
  }
  if (result.expectedOutcome !== manifestCase.expectedOutcome) findings.push("EXPECTED_OUTCOME_BINDING_MISMATCH");
  if (result.observedOutcome !== manifestCase.expectedOutcome) findings.push("EXPECTED_OBSERVED_OUTCOME_DISAGREEMENT");
  if (result.authorityDigestBefore !== result.authorityDigestAfter) findings.push("FROZEN_AUTHORITY_CHANGED");
  const observedPriorTargetPreserved =
    result.destinationDigest === result.priorTargetDigest && result.readbackDigest === result.priorTargetDigest;
  if (result.priorTargetPreserved !== observedPriorTargetPreserved) {
    findings.push("PRIOR_TARGET_PRESERVATION_FLAG_INVALID");
  }
  if (result.candidateProcessSpawned) findings.push("CANDIDATE_PROCESS_SPAWNED");
  if (result.protectedAuthorityVerified) findings.push("PROTECTED_AUTHORITY_OVERCLAIM");
  if (result.externalEvidenceObserved) findings.push("EXTERNAL_EVIDENCE_OVERCLAIM");
  if (result.acceptedEffectCount > 1 || result.receiptCount > 1 || result.activeReceiptCount > 1) {
    findings.push("DUPLICATE_EFFECT_OR_RECEIPT");
  }
  if (result.traceDigest !== sha256Canonical(result.trace)) findings.push("TRACE_DIGEST_MISMATCH");
  if (new Set(result.trace).size !== result.trace.length) findings.push("TRACE_EVENT_DUPLICATE");
  if (countTrace(result, `INJECTION_REACHED:${scenario.injectionPoint}`) !== 1) findings.push("INJECTION_TRACE_COUNT_INVALID");
  if (countTrace(result, `MUTATION_APPLIED:${scenario.mutationKind}`) !== 1) findings.push("MUTATION_TRACE_COUNT_INVALID");
  validateTraceDerivedCounts(result, findings);
  validateOutcomeSemantics(result, findings);
  if (
    scenario.mutationKind === "SYMBOLIC_UNORDERED_WRITER_RACE" &&
    (!result.priorTargetPreserved || result.referenceTransitionCount !== 0 ||
      result.acceptedEffectCount !== 0 || result.receiptCount !== 0)
  ) findings.push("PRE_SWAP_RACE_DID_NOT_PRESERVE_PRIOR_TARGET");
  const expectedUncertainTransitions = expectedUncertainReferenceTransitions[scenario.mutationKind];
  if (
    result.observedOutcome === "WITHHOLD_AS_UNCERTAIN" &&
    (!Number.isInteger(expectedUncertainTransitions) ||
      result.referenceTransitionCount !== expectedUncertainTransitions)
  ) findings.push("UNCERTAINTY_REFERENCE_TRANSITION_COUNT_INVALID");
  return [...new Set(findings)].sort();
}

function validateCleanTwin(result, scenario) {
  const findings = [];
  if (result.observedOutcome !== CLEAN_OUTCOME || result.terminalPhase !== "ACCEPTED") findings.push("CLEAN_TWIN_DID_NOT_ACCEPT");
  if (result.mutationApplied) findings.push("CLEAN_TWIN_APPLIED_MUTATION");
  if (
    scenario.injectionPoint !== "DURING_ROLLBACK" &&
    result.injectionPointObserved !== scenario.injectionPoint
  ) findings.push("CLEAN_TWIN_SKIPPED_REACHABLE_INJECTION_POINT");
  if (result.destinationDigest !== result.candidateDigest || result.readbackDigest !== result.candidateDigest) {
    findings.push("CLEAN_TWIN_DIGEST_MISMATCH");
  }
  if (
    result.acceptedEffectCount !== 1 ||
    result.receiptCount !== 1 ||
    result.activeReceiptCount !== 1 ||
    !result.reusable
  ) findings.push("CLEAN_TWIN_ACCEPTANCE_INVALID");
  if (result.candidateProcessSpawned || result.protectedAuthorityVerified || result.externalEvidenceObserved) {
    findings.push("CLEAN_TWIN_BOUNDARY_VIOLATION");
  }
  if (result.traceDigest !== sha256Canonical(result.trace)) findings.push("CLEAN_TWIN_TRACE_DIGEST_MISMATCH");
  return [...new Set(findings)].sort();
}

function resultWithoutDigest(result) {
  const { resultDigest: _ignored, ...withoutDigest } = result;
  return withoutDigest;
}

function buildCleanTwinRecord(cleanTwin, findings) {
  const record = {
    status: findings.length === 0 ? "PASS_CLEAN_TWIN" : "FAIL_CLEAN_TWIN",
    observedOutcome: cleanTwin.observedOutcome,
    terminalPhase: cleanTwin.terminalPhase,
    destinationDigest: cleanTwin.destinationDigest,
    readbackDigest: cleanTwin.readbackDigest,
    acceptedEffectCount: cleanTwin.acceptedEffectCount,
    receiptCount: cleanTwin.receiptCount,
    activeReceiptCount: cleanTwin.activeReceiptCount,
    reusable: cleanTwin.reusable,
    candidateProcessSpawned: cleanTwin.candidateProcessSpawned,
    protectedAuthorityVerified: cleanTwin.protectedAuthorityVerified,
    externalEvidenceObserved: cleanTwin.externalEvidenceObserved,
    traceDigest: cleanTwin.traceDigest,
    semanticFindings: [...findings],
  };
  record.resultDigest = sha256Canonical(record);
  return record;
}

function finalizeCase(rawResult, manifestCase, scenario, cleanTwin) {
  const cleanTwinFindings = validateCleanTwin(cleanTwin, scenario);
  const cleanTwinRecord = buildCleanTwinRecord(cleanTwin, cleanTwinFindings);
  const candidate = {
    ...rawResult,
    expectedOutcome: manifestCase.expectedOutcome,
    cleanTwin: cleanTwinRecord,
    semanticFindings: [],
    status: CASE_PASS_STATUS,
  };
  candidate.semanticFindings = [
    ...validateCaseCore(candidate, manifestCase, scenario),
    ...cleanTwinFindings.map((finding) => `CLEAN_TWIN:${finding}`),
  ].sort();
  candidate.status = candidate.semanticFindings.length === 0 ? CASE_PASS_STATUS : CASE_FAIL_STATUS;
  candidate.resultDigest = sha256Canonical(resultWithoutDigest(candidate));
  return candidate;
}

function validateFinalCaseDigest(result) {
  return result.resultDigest === sha256Canonical(resultWithoutDigest(result));
}

function runNegativeControls(results, manifestCases, scenarios) {
  const firstResult = results[0];
  const firstManifest = manifestCases[0];
  const firstScenario = scenarios[0];
  const flippedOutcome = [...expectedOutcomes].find((outcome) => outcome !== firstManifest.expectedOutcome);
  const flippedFindings = validateCaseCore(
    firstResult,
    { ...firstManifest, expectedOutcome: flippedOutcome },
    firstScenario,
  );

  const noOpScenario = { ...firstScenario, mutationKind: "NO_OP" };
  const noOpRaw = simulateScenario(noOpScenario, true);
  const noOpCandidate = { ...noOpRaw, expectedOutcome: firstManifest.expectedOutcome };
  const noOpFindings = validateCaseCore(noOpCandidate, firstManifest, noOpScenario);

  const rollbackIndex = manifestCases.findIndex((fixture) => fixture.expectedOutcome === "ROLL_BACK_TO_PRIOR_TARGET");
  assertCondition(rollbackIndex >= 0, "Reference model requires a rollback negative-control case.");
  const contradictory = structuredClone(results[rollbackIndex]);
  contradictory.readbackDigest = contradictory.candidateDigest;
  contradictory.priorTargetPreserved = false;
  contradictory.postStateDigest = sha256Canonical(postResultProjection(contradictory));
  contradictory.resultDigest = sha256Canonical(resultWithoutDigest(contradictory));
  const contradictoryFindings = validateCaseCore(
    contradictory,
    manifestCases[rollbackIndex],
    scenarios[rollbackIndex],
  );

  const missingSet = results.slice(1);
  const missingDetected = missingSet.length !== manifestCases.length ||
    new Set(missingSet.map((result) => result.caseId)).size !== manifestCases.length;

  const replayBaseline = initialState("negative-distinct-operation");
  const distinctReplay = replaySerializedState(
    canonicalJson(replayBaseline),
    "reference-model:different-operation",
  );
  const distinctOperationDetected =
    distinctReplay.disposition === "REJECTED_DIFFERENT_OPERATION_ID" &&
    distinctReplay.stateUnchanged === true &&
    distinctReplay.state.destinationDigest === replayBaseline.priorTargetDigest &&
    distinctReplay.state.readbackDigest === replayBaseline.priorTargetDigest &&
    countTrace(distinctReplay.state, "REPLAY_CONFLICT:OPERATION_ID:") === 1 &&
    countTrace(distinctReplay.state, "RECOVERY_REPLAY:") === 0;

  return [
    {
      id: "FLIPPED_EXPECTED_OUTCOME_REJECTED",
      detected: flippedFindings.includes("EXPECTED_OUTCOME_BINDING_MISMATCH") ||
        flippedFindings.includes("EXPECTED_OBSERVED_OUTCOME_DISAGREEMENT"),
    },
    {
      id: "NO_OP_MUTATOR_REJECTED",
      detected: noOpFindings.includes("MUTATION_NOT_APPLIED") || noOpFindings.includes("MUTATION_TRACE_COUNT_INVALID"),
    },
    {
      id: "CONTRADICTORY_ROLLBACK_READBACK_REJECTED",
      detected: contradictoryFindings.includes("ROLLBACK_PRIOR_TARGET_NOT_PROVEN"),
    },
    {
      id: "MISSING_CASE_SET_REJECTED",
      detected: missingDetected,
    },
    {
      id: "DISTINCT_OPERATION_REPLAY_REJECTED",
      detected: distinctOperationDetected,
    },
  ].map((control) => ({
    ...control,
    status: control.detected ? "PASS_CONTROL" : "FAIL_CONTROL",
  }));
}

function validateScenarioSet(scenarioSet, manifest, observedManifestSha256) {
  exactKeys(
    scenarioSet,
    [
      "schemaVersion",
      "profile",
      "manifestSha256",
      "evidenceClass",
      "caseDenominator",
      "familyDenominators",
      "scenarios",
      "credits",
    ],
    "E16 reference scenario set",
  );
  assertCondition(scenarioSet.schemaVersion === 1, "Reference scenario schema version differs.");
  assertCondition(scenarioSet.profile === PROFILE, "Reference scenario profile differs.");
  assertCondition(scenarioSet.evidenceClass === EVIDENCE_CLASS, "Reference scenario evidence class differs.");
  assertCondition(scenarioSet.manifestSha256 === observedManifestSha256, "Reference scenarios do not bind the frozen E16 manifest bytes.");
  assertCondition(scenarioSet.caseDenominator === 24, "Reference scenario denominator differs.");
  assertCondition(canonicalJson(scenarioSet.familyDenominators) === canonicalJson(expectedFamilyDenominators), "Reference family denominators differ.");
  exactKeys(scenarioSet.credits, creditKeys, "E16 reference scenario credits");
  assertCondition(Object.values(scenarioSet.credits).every((value) => value === false), "Reference scenarios cannot claim product or experiment credit.");
  assertCondition(scenarioSet.scenarios.length === scenarioSet.caseDenominator, "Reference scenario count differs.");
  const manifestById = new Map(manifest.cases.map((fixture) => [fixture.caseId, fixture]));
  const seen = new Set();
  const familyCounts = {};
  for (const scenario of scenarioSet.scenarios) {
    exactKeys(
      scenario,
      ["caseId", "family", "mutationKind", "injectionPoint", "modelAssumption"],
      `E16 reference scenario ${scenario.caseId}`,
    );
    assertCondition(!seen.has(scenario.caseId), `Duplicate reference scenario ${scenario.caseId}.`);
    seen.add(scenario.caseId);
    const manifestCase = manifestById.get(scenario.caseId);
    assertCondition(manifestCase !== undefined, `Reference scenario ${scenario.caseId} is absent from the E16 manifest.`);
    assertCondition(scenario.family === manifestCase.family, `Reference scenario family differs for ${scenario.caseId}.`);
    assertCondition(mutationKinds.has(scenario.mutationKind), `Unknown mutation kind ${scenario.mutationKind}.`);
    assertCondition(injectionPoints.has(scenario.injectionPoint), `Unknown injection point ${scenario.injectionPoint}.`);
    assertCondition(typeof scenario.modelAssumption === "string" && scenario.modelAssumption.length >= 24, `Reference assumption is missing for ${scenario.caseId}.`);
    familyCounts[scenario.family] = (familyCounts[scenario.family] ?? 0) + 1;
  }
  assertCondition(canonicalJson([...seen].sort()) === canonicalJson([...manifestById.keys()].sort()), "Reference scenario IDs differ from the frozen E16 manifest.");
  assertCondition(canonicalJson(familyCounts) === canonicalJson(expectedFamilyDenominators), "Observed reference family counts differ.");
  return familyCounts;
}

function runModel(manifest, scenarioSet) {
  const manifestById = new Map(manifest.cases.map((fixture) => [fixture.caseId, fixture]));
  const results = scenarioSet.scenarios.map((scenario) => {
    const manifestCase = manifestById.get(scenario.caseId);
    assertCondition(manifestCase !== undefined, `Missing E16 manifest case ${scenario.caseId}.`);
    const rawResult = simulateScenario(scenario, true);
    const cleanTwin = simulateScenario(scenario, false);
    return finalizeCase(rawResult, manifestCase, scenario, cleanTwin);
  });
  return results;
}

const manifestPath = resolve(toolingRoot, "contracts/e16-manifest.json");
const scenarioPath = resolve(toolingRoot, "contracts/e16-reference-scenarios.json");
const manifest = await readJson(manifestPath);
const scenarioSet = await readJson(scenarioPath);
const manifestSha256 = await sha256File(manifestPath);
const scenarioSetSha256 = await sha256File(scenarioPath);
const modelSourceSha256 = sha256Bytes(await readFile(fileURLToPath(import.meta.url)));

assertCondition(manifest.status === "NOT_RUN", "The frozen E16 manifest must remain NOT_RUN.");
assertCondition(manifest.denominator === 24 && manifest.cases.length === 24, "The frozen E16 manifest denominator differs.");
assertCondition(manifest.cases.every((fixture) => fixture.runStatus === "NOT_RUN"), "A frozen E16 case was incorrectly relabeled as run.");
assertCondition(manifest.cases.every((fixture) => expectedOutcomes.has(fixture.expectedOutcome)), "The frozen E16 manifest has an unknown expected outcome.");
assertCondition(Object.values(manifest.credits).every((value) => value === false), "The frozen E16 manifest cannot claim experiment or product credit.");
const familyCounts = validateScenarioSet(scenarioSet, manifest, manifestSha256);

const first = runModel(manifest, scenarioSet);
const second = runModel(manifest, scenarioSet);
const deterministicRepeat = canonicalJson(first) === canonicalJson(second);
const negativeControls = runNegativeControls(first, manifest.cases, scenarioSet.scenarios);
const caseIds = first.map((result) => result.caseId);
const semanticFindings = [];
if (!deterministicRepeat) semanticFindings.push("REPEATED_REFERENCE_MODEL_RESULTS_DIFFER");
if (first.length !== 24 || new Set(caseIds).size !== 24) semanticFindings.push("REFERENCE_CASE_DENOMINATOR_INVALID");
if (canonicalJson([...caseIds].sort()) !== canonicalJson(manifest.cases.map((fixture) => fixture.caseId).sort())) {
  semanticFindings.push("REFERENCE_CASE_SET_DIFFERS_FROM_MANIFEST");
}
if (first.some((result) => result.status !== CASE_PASS_STATUS || result.semanticFindings.length !== 0)) {
  semanticFindings.push("REFERENCE_CASE_SEMANTIC_FAILURE");
}
if (first.some((result) => !validateFinalCaseDigest(result))) semanticFindings.push("REFERENCE_CASE_RESULT_DIGEST_MISMATCH");
if (negativeControls.some((control) => !control.detected || control.status !== "PASS_CONTROL")) {
  semanticFindings.push("REFERENCE_NEGATIVE_CONTROL_FAILED");
}

const evidence = {
  schemaVersion: 1,
  recordType: "E16_REFERENCE_MODEL_RUN_V1",
  status: semanticFindings.length === 0 ? PASS_STATUS : FAIL_STATUS,
  evidenceClass: EVIDENCE_CLASS,
  profile: PROFILE,
  manifestSha256,
  scenarioSetSha256,
  modelSourceSha256,
  manifestStatus: "NOT_RUN",
  caseDenominator: 24,
  referenceModelExecutedCases: first.length,
  implementationExecutedCases: 0,
  e16ExecutedCases: 0,
  e16Complete: false,
  repeatedRuns: 2,
  deterministicRepeat,
  familyCounts,
  negativeControls,
  semanticFindings,
  results: first,
  limitations: [
    "SELF_ADMINISTERED_PURE_REFERENCE_MODEL_ONLY",
    "NO_CURRENT_COORDINATOR_E16_EXECUTION",
    "NO_PROTECTED_AUTHORITY_OR_DISTINCT_PRINCIPAL",
    "NO_PROCESS_CRASH_OR_POWER_LOSS_EVIDENCE",
    "NO_NATIVE_MULTI_WRITER_SCHEDULING",
    "NO_EXTERNAL_DESTINATION_OR_DEPENDENCY_OBSERVER",
    "NO_FILESYSTEM_DURABILITY_OR_ATOMICITY_CLAIM",
    "NO_T164_THROUGH_T183_M4_PATENT_PRODUCTION_OR_RELEASE_CREDIT",
  ],
  credits: { ...zeroCredits },
};
const output = {
  ...evidence,
  resultDigest: sha256Canonical(evidence),
};
emitDeterministic(output);
if (output.status !== PASS_STATUS) process.exitCode = 1;
