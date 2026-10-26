#!/bin/zsh

emulate -L zsh
set -euo pipefail
umask 077
PATH='/usr/bin:/bin:/usr/sbin:/sbin'
export PATH

script_dir="${0:A:h}"
package_dir="${script_dir:h}"
manifest_helper="${script_dir}/source-manifest.zsh"
[[ -f "${manifest_helper}" && ! -L "${manifest_helper}" ]]
source "${manifest_helper}"
scratch_root="${VERITAS_PLATFORM_SCRATCH_PATH:-/private/tmp/codename-veritas-platform-contract}"
comparison_batch_id="${VERITAS_PLATFORM_COMPARISON_BATCH_ID:?Set the fresh platform comparison batch ID.}"
expected_sdk="${VERITAS_EXPECTED_BUILD_SDK:?Set the exact admitted SDK for this lane.}"
probe_binary="${VERITAS_AFM_PROBE_BINARY:?Set the exact release AFM probe binary built by the platform verifier.}"

grep -Eq '^[0-9a-f]{32}$' <<< "${comparison_batch_id}"
case "${expected_sdk}" in
  26.5)
    expected_xcode="26.6"
    expected_xcode_build="17F113"
    expected_swift="6.3.3"
    expected_developer_dir="/Applications/Xcode.app/Contents/Developer"
    expected_sdk_path="/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.5.sdk"
    lane_id="xcode-26.6_swift-6.3.3_sdk-26.5"
    ;;
  27.0)
    expected_xcode="27.0"
    expected_xcode_build="27A5228h"
    expected_swift="6.4"
    expected_developer_dir="/Applications/Xcode-27.0.app/Contents/Developer"
    expected_sdk_path="/Applications/Xcode-27.0.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX27.0.sdk"
    lane_id="xcode-27.0_swift-6.4_sdk-27.0"
    ;;
  *)
    print -u2 "Unsupported Veritas AFM evidence lane: ${expected_sdk}"
    exit 1
    ;;
esac
expected_binary_sdk="27.0"

batch_root="${scratch_root}/runs/${comparison_batch_id}"
batch_contract="${batch_root}/batch-contract.json"
batch_source_manifest="${batch_root}/source-manifest.sha256"
lane_root="${batch_root}/${lane_id}"
release_scratch="${lane_root}/swift-release"
afm_root="${lane_root}/afm"
source_manifest_algorithm="${VERITAS_SOURCE_MANIFEST_ALGORITHM}"
lane26_id="xcode-26.6_swift-6.3.3_sdk-26.5"
lane27_id="xcode-27.0_swift-6.4_sdk-27.0"

[[ -d "${batch_root}" ]]
[[ -d "${lane_root}" ]]
[[ -d "${release_scratch}" ]]
[[ -f "${batch_contract}" ]]
[[ -f "${batch_source_manifest}" ]]
[[ "$(/usr/bin/jq -s 'length' "${batch_contract}")" == "1" ]]
cmp -s "${batch_contract}" <(/usr/bin/jq -cS . "${batch_contract}")
/usr/bin/jq -e \
  --arg batch "${comparison_batch_id}" \
  --arg lane26 "${lane26_id}" \
  --arg lane27 "${lane27_id}" \
  --arg algorithm "${source_manifest_algorithm}" '
  type == "object" and
  keys == [
    "authorizing",
    "comparison_batch_id",
    "comparison_result_schema_version",
    "expected_suite_count_per_lane",
    "expected_test_count_per_lane",
    "independent_certification",
    "lane_ids",
    "platform_result_schema_version",
    "schema_version",
    "source_manifest_algorithm",
    "source_manifest_sha256",
    "status"
  ] and
  .schema_version == 2 and
  .platform_result_schema_version == 4 and
  .comparison_result_schema_version == 4 and
  .status == "OPEN_PRIVATE_TWO_LANE_BATCH" and
  .comparison_batch_id == $batch and
  .lane_ids == [$lane26, $lane27] and
  .expected_test_count_per_lane == 470 and
  .expected_suite_count_per_lane == 37 and
  .source_manifest_algorithm == $algorithm and
  (.source_manifest_sha256 | type == "string" and test("^[0-9a-f]{64}$")) and
  .independent_certification == false and
  .authorizing == false
' "${batch_contract}" > /dev/null

batch_contract_sha256="$(shasum -a 256 "${batch_contract}" | awk '{print $1}')"
batch_source_manifest_sha256="$(shasum -a 256 "${batch_source_manifest}" | awk '{print $1}')"
[[ "${batch_source_manifest_sha256}" == "$(/usr/bin/jq -r '.source_manifest_sha256' "${batch_contract}")" ]]

build_source_manifest() {
  veritas_build_source_manifest "${package_dir}"
}

preflight_source_manifest="$(mktemp /private/tmp/veritas-afm-source-manifest.XXXXXX)"
trap 'rm -f -- "${preflight_source_manifest}"' EXIT
build_source_manifest > "${preflight_source_manifest}"
cmp -s "${batch_source_manifest}" "${preflight_source_manifest}"

developer_dir="${DEVELOPER_DIR:?Set the exact admitted Xcode Developer directory.}"
developer_dir="${developer_dir:A}"
[[ "${developer_dir}" == "${expected_developer_dir}" ]]
export DEVELOPER_DIR="${developer_dir}"
xcodebuild_tool="/usr/bin/xcodebuild"
xcrun_tool="/usr/bin/xcrun"
swift_tool="$("${xcrun_tool}" --find swift)"
expected_swift_tool="${developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift"
[[ "${swift_tool}" == "${expected_swift_tool}" ]]
[[ -L "${swift_tool}" ]]
swift_tool_symlink_target="$(/usr/bin/readlink "${swift_tool}")"
[[ "${swift_tool_symlink_target}" == "swift-frontend" ]]
swift_tool_resolved_path="${swift_tool:A}"
expected_swift_tool_resolved_path="${developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-frontend"
[[ "${swift_tool_resolved_path}" == "${expected_swift_tool_resolved_path}" ]]
[[ -f "${swift_tool_resolved_path}" && ! -L "${swift_tool_resolved_path}" ]]
xcodebuild_tool_sha256="$(shasum -a 256 "${xcodebuild_tool}" | awk '{print $1}')"
xcrun_tool_sha256="$(shasum -a 256 "${xcrun_tool}" | awk '{print $1}')"
swift_tool_sha256="$(shasum -a 256 "${swift_tool}" | awk '{print $1}')"

xcode_version_output="$("${xcodebuild_tool}" -version)"
observed_xcode="$(awk 'NR == 1 { print $2 }' <<< "${xcode_version_output}")"
observed_xcode_build="$(awk 'NR == 2 { print $3 }' <<< "${xcode_version_output}")"
observed_swift="$("${swift_tool}" --version 2>/dev/null | sed -nE 's/.*Apple Swift version ([^ ]+).*/\1/p' | head -1)"
[[ "${observed_xcode}" == "${expected_xcode}" ]]
[[ "${observed_xcode_build}" == "${expected_xcode_build}" ]]
[[ "${observed_swift}" == "${expected_swift}" ]]
sdk_path="$("${xcrun_tool}" --sdk macosx --show-sdk-path)"
[[ "${sdk_path}" == "${expected_sdk_path}" ]]
[[ -L "${sdk_path}" ]]
sdk_symlink_target="$(/usr/bin/readlink "${sdk_path}")"
[[ "${sdk_symlink_target}" == "MacOSX.sdk" ]]
sdk_resolved_path="${sdk_path:A}"
expected_sdk_resolved_path="${developer_dir}/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk"
[[ "${sdk_resolved_path}" == "${expected_sdk_resolved_path}" ]]
[[ -d "${sdk_resolved_path}" && ! -L "${sdk_resolved_path}" ]]
sdk_settings="${sdk_resolved_path}/SDKSettings.json"
[[ -f "${sdk_settings}" && ! -L "${sdk_settings}" ]]
/usr/bin/jq -e --arg expected_sdk "${expected_sdk}" '.Version == $expected_sdk' "${sdk_settings}" > /dev/null
sdk_settings_sha256="$(shasum -a 256 "${sdk_settings}" | awk '{print $1}')"
observed_sdk="$("${xcrun_tool}" --sdk macosx --show-sdk-version)"
[[ "${observed_sdk}" == "${expected_sdk}" ]]

probe_binary="${probe_binary:A}"
[[ -f "${probe_binary}" ]]
[[ "${probe_binary:t}" == "Veritas AFM Functional Probe" ]]
case "${probe_binary}" in
  "${release_scratch}"/*) ;;
  *)
    print -u2 "AFM probe binary is outside the frozen lane release root."
    exit 1
    ;;
esac
[[ "$("${xcrun_tool}" lipo -archs "${probe_binary}")" == "arm64" ]]
probe_load_commands="$("${xcrun_tool}" otool -l "${probe_binary}")"
grep -Fq '    minos 27.0' <<< "${probe_load_commands}"
grep -Fq "      sdk ${expected_binary_sdk}" <<< "${probe_load_commands}"
probe_binary_sha256="$(shasum -a 256 "${probe_binary}" | awk '{print $1}')"

[[ ! -e "${afm_root}" ]]
mkdir "${afm_root}"
probe_pending="${afm_root}/afm-functional-probe.json.pending"
probe_json="${afm_root}/afm-functional-probe.json"
probe_stderr="${afm_root}/afm-functional-probe.stderr.log"
source_manifest="${afm_root}/source-manifest.sha256"
source_manifest_post="${afm_root}/source-manifest.post.sha256"
result_pending="${afm_root}/afm-verifier-result.json.pending"
result_json="${afm_root}/afm-verifier-result.json"

build_source_manifest > "${source_manifest}"
cmp -s "${batch_source_manifest}" "${source_manifest}"

set +e
"${probe_binary}" > "${probe_pending}" 2> "${probe_stderr}"
probe_exit_code=$?
set -e
[[ ${probe_exit_code} -eq 0 ]]
[[ ! -s "${probe_stderr}" ]]
[[ "$(wc -l < "${probe_pending}" | tr -d ' ')" == "1" ]]
[[ "$(/usr/bin/jq -s 'length' "${probe_pending}")" == "1" ]]
cmp -s "${probe_pending}" <(/usr/bin/jq -cS . "${probe_pending}")
mv "${probe_pending}" "${probe_json}"

/usr/bin/jq -e '
  type == "object" and
  keys == [
    "acceptanceAuthorityGranted",
    "advisoryReceipt",
    "advisoryReceiptDigest",
    "deterministicChecks",
    "deterministicPassed",
    "disposition",
    "evidenceClass",
    "externalToolsEnabled",
    "limitationCodes",
    "modelParticipation",
    "profileFingerprint",
    "quiescent",
    "rawArtifactPersisted",
    "schemaVersion",
    "status",
    "subjectDigest",
    "target",
    "transcriptPersisted"
  ] and
  .schemaVersion == 1 and
  .status == "PASS" and
  .evidenceClass == "SELF_ADMINISTERED_NATIVE_AFM_FUNCTIONAL_PROBE" and
  .target == "macOS 27.0+ · Apple Silicon · arm64 only" and
  .deterministicPassed == true and
  .modelParticipation == "PARTICIPATED" and
  .disposition == "READY" and
  .quiescent == true and
  .limitationCodes == [
    "MODEL_FINDINGS_NON_AUTHORIZING",
    "PROTOTYPE_IN_MEMORY_ACCEPTANCE_ONLY"
  ] and
  .rawArtifactPersisted == false and
  .transcriptPersisted == false and
  .externalToolsEnabled == false and
  .acceptanceAuthorityGranted == false and
  ([.subjectDigest, .profileFingerprint, .advisoryReceiptDigest] |
    all(type == "string" and test("^[0-9a-f]{64}$"))) and
  .deterministicChecks == [
    {
      "explanation":"The artifact contains bytes.",
      "id":"DET-001-NONEMPTY",
      "status":"PASS"
    },
    {
      "explanation":"The complete snapshot decodes as UTF-8.",
      "id":"DET-002-UTF8",
      "status":"PASS"
    },
    {
      "explanation":"The snapshot is a JSON object or array.",
      "id":"DET-003-JSON-STRUCTURE",
      "status":"PASS"
    }
  ] and
  (.advisoryReceipt | type == "object" and keys == [
    "adapterContractVersion",
    "artifactKind",
    "modelIdentityStatus",
    "nonAuthorizing",
    "outcome",
    "profileFingerprint",
    "provider",
    "route",
    "runtimeFingerprint",
    "schemaVersion",
    "stages",
    "subjectDigest"
  ]) and
  .advisoryReceipt.schemaVersion == 1 and
  .advisoryReceipt.adapterContractVersion == "apple-foundation-advisory-v1" and
  .advisoryReceipt.artifactKind == "json" and
  .advisoryReceipt.modelIdentityStatus == "MODEL_ID_NOT_EXPOSED_BY_API" and
  .advisoryReceipt.nonAuthorizing == true and
  .advisoryReceipt.outcome == "COMPLETED" and
  .advisoryReceipt.provider == "apple-foundation-models" and
  .advisoryReceipt.route == "system-on-device-requested" and
  .advisoryReceipt.profileFingerprint == .profileFingerprint and
  .advisoryReceipt.subjectDigest == .subjectDigest and
  (.advisoryReceipt.runtimeFingerprint |
    type == "string" and test("^[0-9a-f]{64}$")) and
  (.advisoryReceipt.stages | type == "array" and length == 3) and
  ([.advisoryReceipt.stages[] | keys] |
    all(. == ["ordinal", "outcome", "requestDigest", "responseDigest", "stage"])) and
  [.advisoryReceipt.stages[].ordinal] == [0, 1, 2] and
  [.advisoryReceipt.stages[].stage] == ["PROBE", "PLAN", "FINDING"] and
  ([.advisoryReceipt.stages[].outcome] | all(. == "OBSERVED")) and
  ([.advisoryReceipt.stages[].requestDigest,
    .advisoryReceipt.stages[].responseDigest] |
    all(type == "string" and test("^[0-9a-f]{64}$")))
' "${probe_json}" > /dev/null

build_source_manifest > "${source_manifest_post}"
cmp -s "${source_manifest}" "${source_manifest_post}"
cmp -s "${batch_source_manifest}" "${source_manifest_post}"

probe_output_sha256="$(shasum -a 256 "${probe_json}" | awk '{print $1}')"
probe_stderr_sha256="$(shasum -a 256 "${probe_stderr}" | awk '{print $1}')"
source_manifest_sha256="$(shasum -a 256 "${source_manifest}" | awk '{print $1}')"
subject_digest="$(/usr/bin/jq -r '.subjectDigest' "${probe_json}")"
profile_fingerprint="$(/usr/bin/jq -r '.profileFingerprint' "${probe_json}")"
advisory_receipt_digest="$(/usr/bin/jq -r '.advisoryReceiptDigest' "${probe_json}")"
runtime_fingerprint="$(/usr/bin/jq -r '.advisoryReceipt.runtimeFingerprint' "${probe_json}")"

/usr/bin/jq -cS -n \
  --arg comparison_batch_id "${comparison_batch_id}" \
  --arg lane_id "${lane_id}" \
  --arg batch_contract_sha256 "${batch_contract_sha256}" \
  --arg source_manifest_sha256 "${source_manifest_sha256}" \
  --arg developer_dir "${developer_dir}" \
  --arg swift_tool_path "${swift_tool}" \
  --arg swift_tool_resolved_path "${swift_tool_resolved_path}" \
  --arg swift_tool_sha256 "${swift_tool_sha256}" \
  --arg swift_tool_symlink_target "${swift_tool_symlink_target}" \
  --arg sdk_path "${sdk_path}" \
  --arg sdk_resolved_path "${sdk_resolved_path}" \
  --arg sdk_settings_sha256 "${sdk_settings_sha256}" \
  --arg sdk_symlink_target "${sdk_symlink_target}" \
  --arg xcodebuild_tool_sha256 "${xcodebuild_tool_sha256}" \
  --arg xcrun_tool_sha256 "${xcrun_tool_sha256}" \
  --arg expected_xcode "${expected_xcode}" \
  --arg observed_xcode "${observed_xcode}" \
  --arg expected_xcode_build "${expected_xcode_build}" \
  --arg observed_xcode_build "${observed_xcode_build}" \
  --arg expected_swift "${expected_swift}" \
  --arg observed_swift "${observed_swift}" \
  --arg expected_sdk "${expected_sdk}" \
  --arg observed_sdk "${observed_sdk}" \
  --arg probe_binary_sha256 "${probe_binary_sha256}" \
  --arg probe_binary_sdk "${expected_binary_sdk}" \
  --arg probe_output_sha256 "${probe_output_sha256}" \
  --arg probe_stderr_sha256 "${probe_stderr_sha256}" \
  --arg subject_digest "${subject_digest}" \
  --arg profile_fingerprint "${profile_fingerprint}" \
  --arg advisory_receipt_digest "${advisory_receipt_digest}" \
  --arg runtime_fingerprint "${runtime_fingerprint}" \
  '{
    schema_version: 1,
    status: "PASS_PRIVATE_SELF_ADMINISTERED_NATIVE_AFM_FUNCTIONAL_PROBE_ONLY",
    evidence_class: "SELF_ADMINISTERED_NATIVE_AFM_FUNCTIONAL_PROBE",
    comparison_batch_id: $comparison_batch_id,
    lane_id: $lane_id,
    batch_contract_sha256: $batch_contract_sha256,
    source_manifest_sha256: $source_manifest_sha256,
    developer_dir: $developer_dir,
    swift_tool_path: $swift_tool_path,
    swift_tool_resolved_path: $swift_tool_resolved_path,
    swift_tool_sha256: $swift_tool_sha256,
    swift_tool_symlink_target: $swift_tool_symlink_target,
    sdk_path: $sdk_path,
    sdk_resolved_path: $sdk_resolved_path,
    sdk_settings_sha256: $sdk_settings_sha256,
    sdk_symlink_target: $sdk_symlink_target,
    xcodebuild_tool_sha256: $xcodebuild_tool_sha256,
    xcrun_tool_sha256: $xcrun_tool_sha256,
    expected_xcode: $expected_xcode,
    observed_xcode: $observed_xcode,
    expected_xcode_build: $expected_xcode_build,
    observed_xcode_build: $observed_xcode_build,
    expected_swift: $expected_swift,
    observed_swift: $observed_swift,
    expected_sdk: $expected_sdk,
    observed_sdk: $observed_sdk,
    probe_exit_code: 0,
    probe_binary_sha256: $probe_binary_sha256,
    probe_binary_sdk: $probe_binary_sdk,
    probe_output_sha256: $probe_output_sha256,
    probe_stderr_sha256: $probe_stderr_sha256,
    subject_digest: $subject_digest,
    profile_fingerprint: $profile_fingerprint,
    advisory_receipt_digest: $advisory_receipt_digest,
    runtime_fingerprint: $runtime_fingerprint,
    model_identity_status: "MODEL_ID_NOT_EXPOSED_BY_API",
    raw_artifact_persisted: false,
    transcript_persisted: false,
    external_tools_enabled: false,
    acceptance_authority_granted: false,
    independent_certification: false,
    authorizing: false
  }' > "${result_pending}"

[[ "$(/usr/bin/jq -s 'length' "${result_pending}")" == "1" ]]
cmp -s "${result_pending}" <(/usr/bin/jq -cS . "${result_pending}")
mv "${result_pending}" "${result_json}"
/usr/bin/jq . "${result_json}"
