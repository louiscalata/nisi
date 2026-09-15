#!/bin/zsh

# Shared, side-effect-free source-inventory contract for the private native gates.
# Callers must verify this file is a regular non-symlink before sourcing it.

typeset -gr VERITAS_SOURCE_MANIFEST_ALGORITHM='SHA-256 of canonical JSON-lines over sorted relative regular-file paths and byte SHA-256; symlinks and special files refused; roots Package.swift, Sources, Tests, Scripts'

# Frozen required membership, reviewed against the September 8 native inventory.
# Content hashes below still bind bytes. Intentional additions/removals require
# updating this list AND the independent contracts/native-required-paths-v1.json.
typeset -gra VERITAS_REQUIRED_SOURCE_PATHS=(
  'Package.swift'
  'Scripts/checkpoint-control-log.zsh'
  'Scripts/compare-platform-contract-lanes.zsh'
  'Scripts/initialize-platform-contract-batch.zsh'
  'Scripts/machine-evidence-process-probe.swift'
  'Scripts/source-manifest.zsh'
  'Scripts/test-cr09-parser-negatives.zsh'
  'Scripts/test-private-parallel.zsh'
  'Scripts/test-transport-record.zsh'
  'Scripts/verify-afm-orchestration.zsh'
  'Scripts/verify-platform-contract.zsh'
  'Sources/CodenameVeritasApp/AppModel.swift'
  'Sources/CodenameVeritasApp/CodenameVeritasApp.swift'
  'Sources/CodenameVeritasApp/IncidentHistoryCoordinator.swift'
  'Sources/CodenameVeritasApp/MenuBarView.swift'
  'Sources/CodenameVeritasApp/PrivateVerifiedFileWriter.swift'
  'Sources/CodenameVeritasApp/ShellTruthV1.swift'
  'Sources/VeritasAFMFunctionalProbe/main.swift'
    'Sources/VeritasAppleFoundation/AppleFoundationOrchestrator.swift'
    'Sources/VeritasAppleFoundation/ApplePreventionTrial.swift'
  'Sources/VeritasCore/AdvisoryOrchestration.swift'
  'Sources/VeritasCore/ArtifactSnapshot.swift'
  'Sources/VeritasCore/DeterministicChecks.swift'
  'Sources/VeritasCore/DigestFramingV1.swift'
  'Sources/VeritasCore/FailureFamilyAdjudication.swift'
  'Sources/VeritasCore/HistoricalGateImport.swift'
  'Sources/VeritasCore/IncidentExplanation.swift'
  'Sources/VeritasCore/IncidentNamespaceObserver.swift'
  'Sources/VeritasCore/LocalIncidentLedger.swift'
  'Sources/VeritasCore/MAC1JSONV1.swift'
  'Sources/VeritasCore/NativeBuildAdmission.swift'
  'Sources/VeritasCore/PairedPreventionTrial.swift'
  'Sources/VeritasCore/PipelineIncidentAdapter.swift'
  'Sources/VeritasCore/PipelineIncidentCaptureEnvelope.swift'
  'Sources/VeritasCore/PlatformRequirements.swift'
  'Sources/VeritasCore/PreparedReferenceMLPEvaluation.swift'
  'Sources/VeritasCore/PreventionPolicyEvaluation.swift'
  'Sources/VeritasCore/ProtectedAuthorityCaptureEnvelope.swift'
  'Sources/VeritasCore/ReferenceArtifactFeatureCapture.swift'
  'Sources/VeritasCore/ReferenceArtifactPlugin.swift'
  'Sources/VeritasCore/ReferenceArtifactShadowPreparation.swift'
  'Sources/VeritasCore/ReferenceArtifactShadowRunOwner.swift'
  'Sources/VeritasCore/ReferenceMLP.swift'
  'Sources/VeritasCore/ReferenceMLPShadowOwner.swift'
  'Sources/VeritasCore/StrictJSONDocumentValidator.swift'
  'Sources/VeritasCore/VeritasPipeline.swift'
  'Sources/VeritasLedgerCrashProbe/VeritasLedgerCrashProbe.swift'
  'Sources/VeritasNativeBuildProbe/main.swift'
  'Sources/VeritasSQLiteSupport/VeritasSQLiteSupport.c'
  'Sources/VeritasSQLiteSupport/include/VeritasSQLiteSupport.h'
  'Sources/VeritasScheduledReferenceProbe/main.swift'
  'Tests/CodenameVeritasAppTests/AppKitIntegrationTests.swift'
  'Tests/CodenameVeritasAppTests/AppModelTests.swift'
  'Tests/CodenameVeritasAppTests/PrivateVerifiedFileWriterTests.swift'
  'Tests/CodenameVeritasAppTests/ShellTruthV1Tests.swift'
    'Tests/VeritasAppleFoundationTests/AppleFoundationBoundaryTests.swift'
    'Tests/VeritasAppleFoundationTests/ApplePreventionTrialTests.swift'
  'Tests/VeritasCoreTests/ArtifactSnapshotterTests.swift'
  'Tests/VeritasCoreTests/AsyncTestCleanup.swift'
  'Tests/VeritasCoreTests/AsyncTestCleanupTests.swift'
  'Tests/VeritasCoreTests/DigestFramingV1Tests.swift'
  'Tests/VeritasCoreTests/EngineEvidenceParityTests.swift'
  'Tests/VeritasCoreTests/FI04RaceCaseTests.swift'
  'Tests/VeritasCoreTests/FI05FailureFamilyTests.swift'
  'Tests/VeritasCoreTests/FI06PreventionPolicyTests.swift'
  'Tests/VeritasCoreTests/FI08ProtectedAuthorityTests.swift'
  'Tests/VeritasCoreTests/Fixtures/engine-evidence-v1.json'
  'Tests/VeritasCoreTests/Fixtures/gate-events-mac-20260908.jsonl'
  'Tests/VeritasCoreTests/Fixtures/mac1-json-v1-corpus.json'
  'Tests/VeritasCoreTests/Fixtures/prepared-mlp-v1.json'
  'Tests/VeritasCoreTests/Fixtures/reference-artifact-package-v1.json'
  'Tests/VeritasCoreTests/Fixtures/reference-mlp-v1.json'
  'Tests/VeritasCoreTests/HistoricalGateImportTests.swift'
  'Tests/VeritasCoreTests/IncidentNamespaceObserverTests.swift'
  'Tests/VeritasCoreTests/LocalIncidentLedgerCoherentReplacementB2Tests.swift'
  'Tests/VeritasCoreTests/LocalIncidentLedgerCoherentReplacementBaselineTests.swift'
  'Tests/VeritasCoreTests/LocalIncidentLedgerTests.swift'
  'Tests/VeritasCoreTests/MAC1JSONV1Tests.swift'
  'Tests/VeritasCoreTests/MAC1toMAC9Tests.swift'
  'Tests/VeritasCoreTests/MachineEvidenceTransportTests.swift'
  'Tests/VeritasCoreTests/NativeBuildAdmissionTests.swift'
  'Tests/VeritasCoreTests/PairedPreventionTrialTests.swift'
  'Tests/VeritasCoreTests/PipelineIncidentAdapterTests.swift'
  'Tests/VeritasCoreTests/PlatformRequirementsTests.swift'
  'Tests/VeritasCoreTests/PreparedReferenceMLPEvaluationTests.swift'
  'Tests/VeritasCoreTests/ReferenceArtifactPluginTests.swift'
  'Tests/VeritasCoreTests/ReferenceArtifactShadowPreparationTests.swift'
  'Tests/VeritasCoreTests/ReferenceArtifactShadowRunOwnerTests.swift'
  'Tests/VeritasCoreTests/ReferenceMLPShadowOwnerTests.swift'
  'Tests/VeritasCoreTests/ReferenceMLPTests.swift'
  'Tests/VeritasCoreTests/VeritasPipelineTests.swift'
  'Tests/VeritasTestEvidenceSupport/MachineEvidence.swift'
  'Tests/VeritasTestEvidenceSupport/MachineEvidenceRecorder.swift'
)

veritas_build_source_manifest() {
  emulate -L zsh
  set -euo pipefail

  local package_dir="${1:A}"
  local LC_ALL=C
  local symlink_count special_count relative_path file_sha256 index previous_path=''
  local -a files

  [[ -d "${package_dir}" ]] || return 1
  # Do not depend on errexit: callers may invoke the helper in an if/! context.
  for relative_path in "${VERITAS_REQUIRED_SOURCE_PATHS[@]}"; do
    [[ "${relative_path}" =~ '^(Package[.]swift|(Sources|Tests|Scripts)/[A-Za-z0-9_./-]+)$' \
       && "${relative_path}" != *//* && "/${relative_path}/" != */../* \
       && "/${relative_path}/" != */./* \
       && ( -z "${previous_path}" || "${previous_path}" < "${relative_path}" ) ]] || return 1
    previous_path="${relative_path}"
  done
  (
    cd "${package_dir}" || return 1
    [[ -f Package.swift && ! -L Package.swift ]] || return 1
    for root in Sources Tests Scripts; do
      [[ -d "${root}" && ! -L "${root}" ]] || return 1
    done

    symlink_count="$(
      /usr/bin/find Package.swift Sources Tests Scripts -type l \
        -exec /usr/bin/printf x \; \
        | /usr/bin/wc -c \
        | /usr/bin/tr -d '[:space:]'
    )"
    [[ "${symlink_count}" == "0" ]] || return 1

    special_count="$(
      /usr/bin/find Package.swift Sources Tests Scripts \
        ! -type d ! -type f ! -type l \
        -exec /usr/bin/printf x \; \
        | /usr/bin/wc -c \
        | /usr/bin/tr -d '[:space:]'
    )"
    [[ "${special_count}" == "0" ]] || return 1

    files=()
    while IFS= read -r -d $'\0' relative_path; do
      [[ "${relative_path}" != /* ]] || return 1
      files+=("${relative_path}")
    done < <(
      /usr/bin/find Package.swift Sources Tests Scripts -type f -print0
    )
    (( ${#files} > 0 )) || return 1
    files=("${(@o)files}")

    (( ${#files} == ${#VERITAS_REQUIRED_SOURCE_PATHS} )) || return 1
    for (( index = 1; index <= ${#files}; index++ )); do
      [[ "${files[index]}" == "${VERITAS_REQUIRED_SOURCE_PATHS[index]}" ]] || return 1
    done

    for relative_path in "${files[@]}"; do
      file_sha256="$(
        /usr/bin/shasum -a 256 -- "${relative_path}" \
          | /usr/bin/awk 'NR == 1 { print $1 }'
      )" || return 1
      [[ ${#file_sha256} -eq 64 ]] || return 1
      /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${file_sha256}" || return 1
      /usr/bin/jq -cS -n \
        --arg path "${relative_path}" \
        --arg sha256 "${file_sha256}" \
        '{path: $path, sha256: $sha256}' || return 1
    done
  )
}
