import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import {
  canonicalJson,
  emitDeterministic,
  exactKeys,
  repositoryRoot,
  sha256Bytes,
  sha256Canonical,
  toolingRoot,
} from "./common.mjs";

const contractPath = resolve(toolingRoot, "contracts/e16-implementation-subset.json");
const schemaPath = resolve(toolingRoot, "schemas/e16-implementation-result.schema.json");
const environmentDiagnosticSchemaPath = resolve(
  toolingRoot,
  "schemas/e16-implementation-environment-diagnostic.schema.json",
);
const manifestPath = resolve(toolingRoot, "contracts/e16-manifest.json");
const sourcePath = resolve(repositoryRoot, "veritas.ts");
const [
  contractBytes,
  schemaBytes,
  environmentDiagnosticSchemaBytes,
  officialManifestBytes,
  sourceBytes,
] = await Promise.all([
  readFile(contractPath),
  readFile(schemaPath),
  readFile(environmentDiagnosticSchemaPath),
  readFile(manifestPath),
  readFile(sourcePath),
]);

function parseCapturedJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

const contract = parseCapturedJson(contractBytes, "E16 implementation-subset contract");
const schema = parseCapturedJson(schemaBytes, "E16 implementation-result schema");
const environmentDiagnosticSchema = parseCapturedJson(
  environmentDiagnosticSchemaBytes,
  "E16 implementation-environment diagnostic schema",
);
const officialManifest = parseCapturedJson(officialManifestBytes, "Official E16 manifest");
const contractSha256 = sha256Bytes(contractBytes);
const schemaSha256 = sha256Bytes(schemaBytes);
const environmentDiagnosticSchemaSha256 = sha256Bytes(environmentDiagnosticSchemaBytes);
const observedOfficialManifestSha256 = sha256Bytes(officialManifestBytes);
const sourceSha256 = sha256Bytes(sourceBytes);
const source = sourceBytes.toString("utf8");
const disabledDeclaration =
  /^const TEST_HARNESS_BUILD_CAPABILITY = "VERITAS_TEST_HARNESS_DISABLED";$/m;
const matches = source.match(new RegExp(disabledDeclaration.source, "gm"));
if (matches === null || matches.length !== 1) {
  throw new Error("Canonical source lacks one exact dormant harness declaration.");
}
const capability = sha256Bytes(
  `veritas-test-harness-v1:exact-source+deterministic-capability\0${sourceSha256}`,
);
const derivedHarnessSha256 = sha256Bytes(source.replace(
  disabledDeclaration,
  `const TEST_HARNESS_BUILD_CAPABILITY = "${capability}";`,
));

exactKeys(
  contract,
  [
    "schemaVersion", "profile", "status", "evidenceClass", "officialE16ManifestSha256",
    "officialE16ManifestStatus", "officialE16CaseDenominator",
    "localImplementationFixtureSelectedCases", "expectedCounters",
    "localFixtureNegativeControlIds", "limitations", "credits",
  ],
  "E16 implementation-subset contract",
);
exactKeys(
  contract.expectedCounters,
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
const creditKeys = [
  "protectedAuthority", "nativeRuntime", "t164ThroughT183", "m4",
  "e16", "patent", "production", "release",
];
exactKeys(contract.credits, creditKeys, "E16 implementation-subset credits");
if (
  contract.schemaVersion !== 1 ||
  contract.profile !== "veritas-e16-local-apfs-process-subset-v1" ||
  contract.status !== "PREPARED_E16_IMPLEMENTATION_LOCAL_APFS_PROCESS_SUBSET" ||
  contract.evidenceClass !== "SELF_ADMINISTERED_IMPLEMENTATION_LOCAL_APFS_PROCESS_FIXTURE" ||
  contract.officialE16ManifestStatus !== "NOT_RUN" ||
  contract.officialE16CaseDenominator !== 24 ||
  Object.values(contract.credits).some((value) => value !== false)
) {
  throw new Error("E16 implementation-subset contract identity or evidence ceiling differs.");
}

if (
  observedOfficialManifestSha256 !== contract.officialE16ManifestSha256 ||
  officialManifest.status !== "NOT_RUN" ||
  officialManifest.denominator !== 24 ||
  officialManifest.cases.some((fixture) => fixture.runStatus !== "NOT_RUN") ||
  Object.values(officialManifest.credits).some((value) => value !== false)
) {
  throw new Error("The frozen official E16 manifest changed or acquired execution credit.");
}
const officialCaseById = new Map(officialManifest.cases.map((fixture) => [fixture.caseId, fixture]));
for (const selected of contract.localImplementationFixtureSelectedCases) {
  exactKeys(
    selected,
    ["caseId", "family", "injectionPoint", "expectedOutcome"],
    `E16 selected implementation case ${selected.caseId}`,
  );
  const frozen = officialCaseById.get(selected.caseId);
  if (
    frozen === undefined ||
    frozen.family !== selected.family ||
    frozen.expectedOutcome !== selected.expectedOutcome ||
    frozen.runStatus !== "NOT_RUN"
  ) {
    throw new Error(`Selected implementation case ${selected.caseId} differs from the frozen manifest.`);
  }
}

const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
  validateFormats: false,
});
if (
  schema.$id !==
    "https://veritas.invalid/private/schemas/stage5/e16-implementation-result.v1.json" ||
  schema.additionalProperties !== false ||
  environmentDiagnosticSchema.$id !==
    "https://veritas.invalid/private/schemas/stage5/e16-implementation-environment-diagnostic.v1.json" ||
  environmentDiagnosticSchema.additionalProperties !== false
) {
  throw new Error("E16 implementation schema identity or unknown-field policy differs.");
}
const validate = ajv.compile(schema);
const validateEnvironmentDiagnostic = ajv.compile(environmentDiagnosticSchema);
const execution = spawnSync(process.execPath, [sourcePath, "e16-implementation-subset"], {
  cwd: repositoryRoot,
  encoding: "utf8",
  env: { ...process.env, NO_COLOR: "1" },
  maxBuffer: 16 * 1024 * 1024,
});
for (const [path, expectedDigest, label] of [
  [contractPath, contractSha256, "E16 implementation-subset contract"],
  [schemaPath, schemaSha256, "E16 implementation-result schema"],
  [
    environmentDiagnosticSchemaPath,
    environmentDiagnosticSchemaSha256,
    "E16 implementation-environment diagnostic schema",
  ],
  [manifestPath, observedOfficialManifestSha256, "Official E16 manifest"],
  [sourcePath, sourceSha256, "Canonical Veritas source"],
]) {
  const observedDigest = sha256Bytes(await readFile(path));
  if (observedDigest !== expectedDigest) {
    throw new Error(`${label} changed while the implementation fixture was running.`);
  }
}

function classifyUnsupportedEnvironment(stderr) {
  const hasErrorCode = (code) =>
    new RegExp(`"code"\\s*:\\s*"${code}"`, "u").test(stderr);
  if (hasErrorCode("E16_IMPLEMENTATION_PLATFORM_UNSUPPORTED")) {
    return {
      limitationCode: "DARWIN_PLATFORM_REQUIRED",
      sourceCode: "E16_IMPLEMENTATION_PLATFORM_UNSUPPORTED",
    };
  }
  if (hasErrorCode("TOOLCHAIN_RUNTIME_MISMATCH")) {
    return {
      limitationCode: "PINNED_NODE_RUNTIME_REQUIRED",
      sourceCode: "TOOLCHAIN_RUNTIME_MISMATCH",
    };
  }
  if (hasErrorCode("STORAGE_FILESYSTEM_NOT_ADMITTED")) {
    return {
      limitationCode: "LOCAL_APFS_STORAGE_REQUIRED",
      sourceCode: "STORAGE_FILESYSTEM_NOT_ADMITTED",
    };
  }
  if (
    hasErrorCode("STORAGE_HOST_ATTESTATION_FAILED") &&
    stderr.includes("/usr/sbin/diskutil") &&
    stderr.toLowerCase().includes("unable to use the diskmanagement framework")
  ) {
    return {
      limitationCode: "DISKMANAGEMENT_FRAMEWORK_UNAVAILABLE",
      sourceCode: "STORAGE_HOST_ATTESTATION_FAILED",
    };
  }
  return null;
}

if (execution.status !== 0 || execution.signal !== null || execution.stderr.trim() !== "") {
  const unsupported = classifyUnsupportedEnvironment(execution.stderr);
  if (execution.signal === null && unsupported !== null) {
    const selectedCaseIds = contract.localImplementationFixtureSelectedCases.map(
      (entry) => entry.caseId,
    );
    const unsupportedResult = {
      schemaVersion: 1,
      recordType: "E16_IMPLEMENTATION_ENVIRONMENT_DIAGNOSTIC_V1",
      profile: contract.profile,
      status: "UNSUPPORTED_E16_IMPLEMENTATION_ENVIRONMENT",
      evidenceClass: contract.evidenceClass,
      contractSha256,
      successResultSchemaSha256: schemaSha256,
      environmentDiagnosticSchemaSha256,
      sourceSha256,
      derivedHarnessSha256,
      officialE16ManifestSha256: observedOfficialManifestSha256,
      officialE16ManifestStatus: "NOT_RUN",
      officialE16CaseDenominator: contract.officialE16CaseDenominator,
      officialE16NotRunCases: contract.expectedCounters.officialE16NotRunCases,
      officialE16ExecutedCases: 0,
      officialE16PassedCases: 0,
      officialE16CreditedCases: 0,
      officialE16Complete: false,
      localImplementationFixtureSelectedCaseIds: selectedCaseIds,
      localImplementationFixtureSelectedUniqueCases: selectedCaseIds.length,
      localImplementationFixtureExecutedUniqueCases: 0,
      localImplementationFixturePassedUniqueCases: 0,
      localImplementationFixturePlannedRunsPerCase:
        contract.expectedCounters.localImplementationFixtureRunsPerCase,
      localImplementationFixtureExecutedRunsPerCase: 0,
      localImplementationFixtureCaseRunExecutions: 0,
      officialCaseIdentitiesNotSelectedForLocalFixture:
        contract.expectedCounters.officialCaseIdentitiesNotSelectedForLocalFixture,
      localFixtureOfficialE16CreditCases: 0,
      localFixturePreparedNegativeControlIds: contract.localFixtureNegativeControlIds,
      localFixtureExecutedNegativeControls: 0,
      localImplementationFixtureCaseOutcomes: selectedCaseIds.map((caseId) => ({
        caseId,
        status: "NOT_RUN_UNSUPPORTED_ENVIRONMENT",
      })),
      limitationCode: unsupported.limitationCode,
      sourceCode: unsupported.sourceCode,
      limitations: [
        ...contract.limitations,
        "LOCAL_IMPLEMENTATION_FIXTURE_NOT_RUN_UNSUPPORTED_ENVIRONMENT",
      ],
      credits: contract.credits,
    };
    const unsupportedWithDigest = {
      ...unsupportedResult,
      resultDigest: sha256Canonical(unsupportedResult),
    };
    if (!validateEnvironmentDiagnostic(unsupportedWithDigest)) {
      throw new Error(
        `E16 unsupported-environment diagnostic failed schema: ${canonicalJson(
          validateEnvironmentDiagnostic.errors,
        )}`,
      );
    }
    emitDeterministic(unsupportedWithDigest);
    process.exit(2);
  }
  throw new Error(
    `E16 implementation fixture failed: ${canonicalJson({
      exitCode: execution.status,
      signal: execution.signal,
      stderr: execution.stderr.trim(),
    })}`,
  );
}
let result;
try {
  result = JSON.parse(execution.stdout);
} catch {
  throw new Error("E16 implementation fixture did not emit one JSON result.");
}
if (!validate(result)) {
  throw new Error(`E16 implementation result failed schema: ${canonicalJson(validate.errors)}`);
}

function digestWithoutResultDigest(value) {
  const { resultDigest: _ignored, ...withoutDigest } = value;
  return sha256Canonical(withoutDigest);
}

const selectedCaseIds = contract.localImplementationFixtureSelectedCases.map((entry) => entry.caseId);
const negativeControlIds = result.localFixtureNegativeControls.map((entry) => entry.id);
if (
  result.sourceSha256 !== sourceSha256 ||
  result.derivedHarnessSha256 !== derivedHarnessSha256 ||
  result.officialE16ManifestSha256 !== observedOfficialManifestSha256 ||
  result.officialE16ManifestStatus !== officialManifest.status ||
  canonicalJson(result.localImplementationFixtureSelectedCaseIds) !== canonicalJson(selectedCaseIds) ||
  canonicalJson(result.limitations) !== canonicalJson(contract.limitations) ||
  canonicalJson(result.credits) !== canonicalJson(contract.credits) ||
  canonicalJson(negativeControlIds) !== canonicalJson(contract.localFixtureNegativeControlIds) ||
  result.officialE16CaseDenominator !== contract.officialE16CaseDenominator ||
  result.officialE16NotRunCases !== contract.expectedCounters.officialE16NotRunCases ||
  result.officialE16ExecutedCases !== contract.expectedCounters.officialE16ExecutedCases ||
  result.officialE16PassedCases !== contract.expectedCounters.officialE16PassedCases ||
  result.officialE16CreditedCases !== contract.expectedCounters.officialE16CreditedCases ||
  result.officialE16Complete !== false ||
  result.localImplementationFixtureSelectedUniqueCases !==
    contract.expectedCounters.localImplementationFixtureSelectedUniqueCases ||
  result.localImplementationFixtureExecutedUniqueCases !==
    contract.expectedCounters.localImplementationFixtureExecutedUniqueCases ||
  result.localImplementationFixturePassedUniqueCases !==
    contract.expectedCounters.localImplementationFixturePassedUniqueCases ||
  result.localImplementationFixtureRunsPerCase !==
    contract.expectedCounters.localImplementationFixtureRunsPerCase ||
  result.localImplementationFixtureCaseRunExecutions !==
    contract.expectedCounters.localImplementationFixtureCaseRunExecutions ||
  result.localImplementationFixtureDeterministicRepeat !== true ||
  result.officialCaseIdentitiesNotSelectedForLocalFixture !==
    contract.expectedCounters.officialCaseIdentitiesNotSelectedForLocalFixture ||
  result.localFixtureOfficialE16CreditCases !==
    contract.expectedCounters.localFixtureOfficialE16CreditCases ||
  result.officialE16NotRunCases !==
    result.officialE16CaseDenominator - result.officialE16ExecutedCases ||
  result.localImplementationFixtureCaseRunExecutions !==
    result.localImplementationFixtureExecutedUniqueCases *
      result.localImplementationFixtureRunsPerCase ||
  result.officialCaseIdentitiesNotSelectedForLocalFixture !==
    result.officialE16CaseDenominator - result.localImplementationFixtureSelectedUniqueCases ||
  result.platform !== "darwin" ||
  result.storageProfile !== "LOCAL_APFS_PROCESS_CRASH_FIXTURE" ||
  result.semanticFindings.length !== 0 ||
  result.resultDigest !== digestWithoutResultDigest(result)
) {
  throw new Error("E16 implementation result differs from its exact independent contract.");
}
if (
  result.localFixtureNegativeControls.some(
    (control) =>
      control.detected !== true ||
      control.status !== "PASS_CONTROL" ||
      control.resultDigest !== digestWithoutResultDigest(control),
  )
) {
  throw new Error("E16 implementation negative controls are invalid or vacuous.");
}

const expectedSemantics = {
  "E16-S5-PROMO-001": {
    darwinKernelSigkillObserved: true,
    freshProcessRecoveryObserved: false,
    stalePreparationScavenged: true,
    priorReferenceState: "ABSENT",
    finalReferenceState: "CANDIDATE",
    receiptLifecycle: "ACTIVE",
    recoveryAction: "NONE",
    exactPriorReferenceRestored: false,
    priorObjectDigestReverified: false,
    sameTransactionIdPreserved: false,
    sameReceiptIdPreserved: false,
    sameReceiptRecordDigestPreserved: false,
    candidateAcceptedEffectCount: 1,
    caseReceiptCount: 1,
  },
  "E16-S5-PROMO-002": {
    darwinKernelSigkillObserved: true,
    freshProcessRecoveryObserved: true,
    stalePreparationScavenged: false,
    priorReferenceState: "ABSENT",
    finalReferenceState: "CANDIDATE",
    receiptLifecycle: "ACTIVE",
    recoveryAction: "FINALIZED_ACCEPTED",
    exactPriorReferenceRestored: false,
    priorObjectDigestReverified: false,
    sameTransactionIdPreserved: true,
    sameReceiptIdPreserved: true,
    sameReceiptRecordDigestPreserved: false,
    candidateAcceptedEffectCount: 1,
    caseReceiptCount: 1,
  },
  "E16-S5-DIGEST-004": {
    darwinKernelSigkillObserved: false,
    freshProcessRecoveryObserved: false,
    stalePreparationScavenged: false,
    priorReferenceState: "PRIOR",
    finalReferenceState: "PRIOR",
    receiptLifecycle: "INACTIVE",
    recoveryAction: "ROLLED_BACK",
    exactPriorReferenceRestored: true,
    priorObjectDigestReverified: true,
    sameTransactionIdPreserved: false,
    sameReceiptIdPreserved: false,
    sameReceiptRecordDigestPreserved: false,
    candidateAcceptedEffectCount: 0,
    caseReceiptCount: 1,
  },
  "E16-S5-PROMO-004": {
    darwinKernelSigkillObserved: true,
    freshProcessRecoveryObserved: true,
    stalePreparationScavenged: false,
    priorReferenceState: "ABSENT",
    finalReferenceState: "CANDIDATE",
    receiptLifecycle: "ACTIVE",
    recoveryAction: "FINALIZED_ACCEPTED",
    exactPriorReferenceRestored: false,
    priorObjectDigestReverified: false,
    sameTransactionIdPreserved: true,
    sameReceiptIdPreserved: true,
    sameReceiptRecordDigestPreserved: true,
    candidateAcceptedEffectCount: 1,
    caseReceiptCount: 1,
  },
};
for (let index = 0; index < result.localImplementationFixtureCases.length; index += 1) {
  const observed = result.localImplementationFixtureCases[index];
  const selected = contract.localImplementationFixtureSelectedCases[index];
  const semantics = expectedSemantics[observed.caseId];
  if (
    selected === undefined ||
    semantics === undefined ||
    observed.caseId !== selected.caseId ||
    observed.family !== selected.family ||
    observed.injectionPoint !== selected.injectionPoint ||
    observed.expectedOutcome !== selected.expectedOutcome ||
    observed.observedOutcome !== selected.expectedOutcome ||
    observed.status !== "PASS_IMPLEMENTATION_FIXTURE_ONLY" ||
    observed.secondRecoveryClean !== true ||
    observed.candidateProcessSpawned !== false ||
    observed.generatedArtifactExecuted !== false ||
    observed.protectedAuthorityVerified !== false ||
    observed.semanticFindings.length !== 0 ||
    observed.resultDigest !== digestWithoutResultDigest(observed)
  ) {
    throw new Error(`E16 implementation case ${observed.caseId} failed its frozen binding.`);
  }
  for (const [key, value] of Object.entries(semantics)) {
    if (observed[key] !== value) {
      throw new Error(`E16 implementation case ${observed.caseId} differs at ${key}.`);
    }
  }
}

const verified = {
  schemaVersion: 1,
  status: "PASS_E16_IMPLEMENTATION_VERIFIED_SUBSET_ONLY",
  evidenceClass: contract.evidenceClass,
  contractSha256,
  schemaSha256,
  sourceSha256,
  derivedHarnessSha256,
  officialE16ManifestSha256: observedOfficialManifestSha256,
  officialE16ManifestStatus: "NOT_RUN",
  officialE16CaseDenominator: result.officialE16CaseDenominator,
  officialE16NotRunCases: result.officialE16NotRunCases,
  officialE16ExecutedCases: result.officialE16ExecutedCases,
  officialE16PassedCases: result.officialE16PassedCases,
  officialE16CreditedCases: result.officialE16CreditedCases,
  officialE16Complete: false,
  localImplementationFixtureSelectedCaseIds: selectedCaseIds,
  localImplementationFixtureSelectedUniqueCases:
    result.localImplementationFixtureSelectedUniqueCases,
  localImplementationFixtureExecutedUniqueCases:
    result.localImplementationFixtureExecutedUniqueCases,
  localImplementationFixturePassedUniqueCases:
    result.localImplementationFixturePassedUniqueCases,
  localImplementationFixtureRunsPerCase: result.localImplementationFixtureRunsPerCase,
  localImplementationFixtureCaseRunExecutions:
    result.localImplementationFixtureCaseRunExecutions,
  localImplementationFixtureDeterministicRepeat:
    result.localImplementationFixtureDeterministicRepeat,
  officialCaseIdentitiesNotSelectedForLocalFixture:
    result.officialCaseIdentitiesNotSelectedForLocalFixture,
  localFixtureOfficialE16CreditCases: result.localFixtureOfficialE16CreditCases,
  localFixtureVerifiedNegativeControlIds: negativeControlIds,
  localImplementationFixtureResultDigest: result.resultDigest,
  limitations: result.limitations,
  credits: result.credits,
};
emitDeterministic({ ...verified, resultDigest: sha256Canonical(verified) });
