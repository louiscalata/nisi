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
checkpoint_control_helper="${script_dir}/checkpoint-control-log.zsh"
[[ -f "${checkpoint_control_helper}" && ! -L "${checkpoint_control_helper}" ]]
source "${checkpoint_control_helper}"
transport_helper="${script_dir}/test-transport-record.zsh"
[[ -f "${transport_helper}" && ! -L "${transport_helper}" ]]
source "${transport_helper}"
parser_negative_helper="${script_dir}/test-cr09-parser-negatives.zsh"
[[ -f "${parser_negative_helper}" && ! -L "${parser_negative_helper}" ]]
scratch_root="${VERITAS_PLATFORM_SCRATCH_PATH:-/private/tmp/codename-veritas-platform-contract}"
comparison_batch_id="${VERITAS_PLATFORM_COMPARISON_BATCH_ID:?Set the same 32-character lowercase hexadecimal comparison batch ID used by both lanes.}"
grep -Eq '^[0-9a-f]{32}$' <<< "${comparison_batch_id}"

batch_root="${scratch_root}/runs/${comparison_batch_id}"
batch_contract="${batch_root}/batch-contract.json"
batch_source_manifest="${batch_root}/source-manifest.sha256"
lane26_id="xcode-26.6_swift-6.3.3_sdk-26.5"
lane27_id="xcode-27.0_swift-6.4_sdk-27.0"
source_manifest_algorithm="${VERITAS_SOURCE_MANIFEST_ALGORITHM}"
lane26="${batch_root}/${lane26_id}/evidence"
lane27="${batch_root}/${lane27_id}/evidence"
afm26="${batch_root}/${lane26_id}/afm"
afm27="${batch_root}/${lane27_id}/afm"
comparison_result="${batch_root}/dual-toolchain-comparison.json"
legacy_comparison_pending="${batch_root}/dual-toolchain-comparison.json.pending"
comparison_attempt_dir="${batch_root}/comparison-attempt"

[[ -d "${batch_root}" ]]
[[ "$(/usr/bin/stat -f '%u' "${batch_root}")" == "$(/usr/bin/id -u)" ]]
[[ "$(/usr/bin/stat -f '%Lp' "${batch_root}")" == "700" ]]
[[ ! -e "${comparison_result}" ]]
[[ ! -e "${legacy_comparison_pending}" ]]
[[ ! -e "${comparison_attempt_dir}" ]]
/bin/mkdir "${comparison_attempt_dir}"
comparison_result_pending="$(/usr/bin/mktemp "${comparison_attempt_dir}/dual-toolchain-comparison.XXXXXX")"

comparison_developer_dir="/Applications/Xcode-27.0.app/Contents/Developer"
comparison_developer_dir="${comparison_developer_dir:A}"
[[ "${comparison_developer_dir}" == "/Applications/Xcode-27.0.app/Contents/Developer" ]]
[[ -d "${comparison_developer_dir}" && ! -L "${comparison_developer_dir}" ]]
export DEVELOPER_DIR="${comparison_developer_dir}"
comparison_xcode_version_output="$(/usr/bin/xcodebuild -version)"
comparison_xcode="$(/usr/bin/awk 'NR == 1 { print $2 }' <<< "${comparison_xcode_version_output}")"
comparison_xcode_build="$(/usr/bin/awk 'NR == 2 { print $3 }' <<< "${comparison_xcode_version_output}")"
[[ "${comparison_xcode}" == "27.0" ]]
[[ "${comparison_xcode_build}" == "27A5228h" ]]
comparison_xcodebuild_sha256="$(/usr/bin/shasum -a 256 /usr/bin/xcodebuild | /usr/bin/awk '{print $1}')"
comparison_xcrun_sha256="$(/usr/bin/shasum -a 256 /usr/bin/xcrun | /usr/bin/awk '{print $1}')"
comparison_lipo_tool="$(/usr/bin/xcrun --find lipo)"
comparison_otool_tool="$(/usr/bin/xcrun --find otool)"
expected_comparison_lipo_tool="${comparison_developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/bin/lipo"
expected_comparison_otool_tool="${comparison_developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/bin/otool"
[[ "${comparison_lipo_tool}" == "${expected_comparison_lipo_tool}" ]]
[[ "${comparison_otool_tool}" == "${expected_comparison_otool_tool}" ]]
[[ -f "${comparison_lipo_tool}" && ! -L "${comparison_lipo_tool}" ]]
comparison_lipo_tool_resolved_path="${comparison_lipo_tool:A}"
[[ "${comparison_lipo_tool_resolved_path}" == "${expected_comparison_lipo_tool}" ]]
[[ -L "${comparison_otool_tool}" ]]
comparison_otool_tool_symlink_target="$(/usr/bin/readlink "${comparison_otool_tool}")"
[[ "${comparison_otool_tool_symlink_target}" == "llvm-otool" ]]
comparison_otool_tool_resolved_path="${comparison_otool_tool:A}"
expected_comparison_otool_tool_resolved_path="${comparison_developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/bin/llvm-otool"
[[ "${comparison_otool_tool_resolved_path}" == "${expected_comparison_otool_tool_resolved_path}" ]]
[[ -f "${comparison_otool_tool_resolved_path}" && ! -L "${comparison_otool_tool_resolved_path}" ]]
comparison_lipo_tool_sha256="$(/usr/bin/shasum -a 256 "${comparison_lipo_tool}" | /usr/bin/awk '{print $1}')"
comparison_otool_tool_sha256="$(/usr/bin/shasum -a 256 "${comparison_otool_tool_resolved_path}" | /usr/bin/awk '{print $1}')"

parse_test_totals() {
  emulate -L zsh
  set -euo pipefail
  local test_log_path="${1}"
  /usr/bin/awk '
    /^✔ Test run with [0-9]+ tests in [0-9]+ suite(s)? passed after [0-9]+([.][0-9]+)? seconds[.]$/ {
      line_tests = ""
      line_suites = ""
      for (field_index = 1; field_index <= NF - 5; field_index += 1) {
        if ($field_index == "with" && $(field_index + 2) == "tests" && $(field_index + 3) == "in" && $(field_index + 5) ~ /^suites?$/) {
          if ($(field_index + 1) !~ /^[0-9]+$/ || $(field_index + 4) !~ /^[0-9]+$/) exit 2
          line_tests = $(field_index + 1) + 0
          line_suites = $(field_index + 4) + 0
          break
        }
      }
      if (line_tests == "" || line_suites == "") exit 3
      tests += line_tests
      suites += line_suites
      summaries += 1
      if (breakdown != "") breakdown = breakdown ","
      breakdown = breakdown line_tests "/" line_suites
    }
    END {
      if (summaries == 0) exit 1
      printf "%d\t%d\t%d\t%s", tests, suites, summaries, breakdown
    }
  ' "${test_log_path}"
}

[[ -f "${batch_contract}" && ! -L "${batch_contract}" ]]
[[ -f "${batch_source_manifest}" && ! -L "${batch_source_manifest}" ]]
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

preflight_source_manifest="$(mktemp /private/tmp/veritas-platform-comparison-source-manifest.XXXXXX)"
trap 'rm -f -- "${preflight_source_manifest}"' EXIT
veritas_build_source_manifest "${package_dir}" > "${preflight_source_manifest}"
cmp -s "${batch_source_manifest}" "${preflight_source_manifest}"

lane26_platform_result_sha256=""
lane26_cr09_binding_frame_sha256=""
lane26_crash_probe_binary_path=""
lane26_crash_probe_binary_sha256=""
lane26_product_binary_path=""
lane26_afm_probe_binary_path=""
lane26_test_log_sha256=""
lane26_test_transport_sha256=""
lane26_release_build_log_sha256=""
lane26_x86_log_sha256=""
lane26_nonmac_log_sha256=""
lane26_product_binary_sha256=""
lane26_afm_probe_binary_sha256=""
lane27_platform_result_sha256=""
lane27_cr09_binding_frame_sha256=""
lane27_crash_probe_binary_path=""
lane27_crash_probe_binary_sha256=""
lane27_product_binary_path=""
lane27_afm_probe_binary_path=""
lane27_test_log_sha256=""
lane27_test_transport_sha256=""
lane27_release_build_log_sha256=""
lane27_x86_log_sha256=""
lane27_nonmac_log_sha256=""
lane27_product_binary_sha256=""
lane27_afm_probe_binary_sha256=""

for evidence in "${lane26}" "${lane27}"; do
  lane_root="${evidence:h}"
  [[ -d "${lane_root}" && ! -L "${lane_root}" ]]
  [[ -d "${evidence}" && ! -L "${evidence}" ]]
  [[ -d "${lane_root}/swift-release" && ! -L "${lane_root}/swift-release" ]]
  for file in \
    platform-verifier-result.json \
    fi08-evidence.json \
    fi09-evidence.json \
    source-manifest.sha256; do
    [[ -f "${evidence}/${file}" ]]
  done
  lane_result="${evidence}/platform-verifier-result.json"
  [[ "$(wc -l < "${lane_result}" | tr -d ' ')" == "1" ]]
  cmp -s "${lane_result}" <(/usr/bin/jq -cS . "${lane_result}")
  lane_result_validation_sha256="$(/usr/bin/shasum -a 256 "${lane_result}" \
    | /usr/bin/awk '{print $1}')"
  /usr/bin/jq -e \
    --arg batch "${comparison_batch_id}" \
    --arg contract_sha256 "${batch_contract_sha256}" \
    --arg source_algorithm "${source_manifest_algorithm}" '
    type == "object" and
    keys == [
      "afm_evidence",
      "afm_probe_binary_sha256",
      "all_release_executables_arm64",
      "all_release_executables_minos",
      "all_release_executables_sdk",
      "authorizing",
      "batch_contract_sha256",
      "comparison_batch_id",
      "cr09_binding_frame_sha256",
      "crash_probe_binary_path",
      "crash_probe_binary_sha256",
      "declared_sdk",
      "developer_dir",
      "evidence_dir",
      "expected_suite_count",
      "expected_swift",
      "expected_test_breakdown",
      "expected_test_count",
      "expected_xcode",
      "expected_xcode_build",
      "fi08_evidence",
      "fi09_evidence",
      "independent_certification",
      "lane_id",
      "non_macos_negative_compile",
      "observed_sdk",
      "observed_suite_count",
      "observed_swift",
      "observed_test_breakdown",
      "observed_test_count",
      "observed_xcode",
      "observed_xcode_build",
      "product_binary_sha256",
      "release_bin_layout",
      "release_build_log_sha256",
      "release_executable_count",
      "release_executable_names",
      "schema_version",
      "sdk_path",
      "sdk_resolved_path",
      "sdk_settings_sha256",
      "sdk_symlink_target",
      "source_manifest_algorithm",
      "source_manifest_sha256",
      "status",
      "swift_tool_path",
      "swift_tool_resolved_path",
      "swift_tool_sha256",
      "swift_tool_symlink_target",
      "swiftc_tool_path",
      "swiftc_tool_resolved_path",
      "swiftc_tool_sha256",
      "swiftc_tool_symlink_target",
      "target",
      "terminal_test_run_summaries",
      "test_log_sha256",
      "test_summary",
      "test_transport_sha256",
      "x86_negative_compile",
      "xcodebuild_tool_sha256",
      "xcrun_tool_sha256"
    ] and
    (.afm_evidence | type == "object" and keys == [
      "acceptance_authority_granted",
      "advisory_receipt_digest",
      "authorizing",
      "canonical_result",
      "external_tools_enabled",
      "independent_certification",
      "model_identity_status",
      "probe_binary_sdk",
      "probe_output_sha256",
      "probe_stderr_sha256",
      "profile_fingerprint",
      "raw_artifact_persisted",
      "runtime_fingerprint",
      "status",
      "subject_digest",
      "transcript_persisted",
      "verifier_result_sha256"
    ]) and
    (.fi08_evidence | type == "object" and keys == [
      "authorizing",
      "canonical_report",
      "envelope_digest",
      "fi04_accepted",
      "fi08_accepted",
      "independent_certification",
      "report_sha256",
      "result_evidence_digest",
      "status"
    ]) and
    (.fi09_evidence | type == "object" and keys == [
      "artifact_digest",
      "authorizing",
      "canonical_report",
      "independent_certification",
      "internal_uncertified_record_digest",
      "report_sha256",
      "result_evidence_digest",
      "status"
    ]) and
    (.x86_negative_compile | type == "object" and keys == [
      "exit_code",
      "log_sha256",
      "required_diagnostic"
    ]) and
    (.non_macos_negative_compile | type == "object" and keys == [
      "exit_code",
      "log_sha256",
      "required_diagnostic"
    ]) and
    .schema_version == 4 and
    .status == "PASS_PRIVATE_PLATFORM_CONTRACT_ONLY" and
    .independent_certification == false and
    .authorizing == false and
    .comparison_batch_id == $batch and
    .batch_contract_sha256 == $contract_sha256 and
    .source_manifest_algorithm == $source_algorithm and
    .expected_test_count == 470 and
    .observed_test_count == 470 and
    .expected_suite_count == 37 and
    .observed_suite_count == 37 and
    .release_executable_count == 2 and
    .release_executable_names == ["Codename Veritas Framework", "Veritas AFM Functional Probe"] and
    .target == "macOS 27.0+ Apple Silicon arm64 only" and
    .all_release_executables_arm64 == true and
    .all_release_executables_minos == "27.0" and
    .all_release_executables_sdk == "27.0" and
    (.cr09_binding_frame_sha256 | type == "string" and test("^[0-9a-f]{64}$")) and
    (.crash_probe_binary_path | type == "string" and length > 0) and
    (.crash_probe_binary_sha256 | type == "string" and test("^[0-9a-f]{64}$")) and
    (.evidence_dir | type == "string" and length > 0) and
    (.release_bin_layout == "SWIFTPM_TRIPLE_RELEASE" or
      .release_bin_layout == "SWIFTPM_XCBUILD_PRODUCTS_RELEASE") and
    (.swift_tool_path | type == "string" and length > 0) and
    (.swift_tool_resolved_path | type == "string" and length > 0) and
    .swift_tool_symlink_target == "swift-frontend" and
    (.swiftc_tool_path | type == "string" and length > 0) and
    (.swiftc_tool_resolved_path | type == "string" and length > 0) and
    .swiftc_tool_symlink_target == "swift-frontend" and
    (.sdk_path | type == "string" and length > 0) and
    (.sdk_resolved_path | type == "string" and length > 0) and
    (.sdk_settings_sha256 | type == "string" and test("^[0-9a-f]{64}$")) and
    .sdk_symlink_target == "MacOSX.sdk" and
    ([
      .swift_tool_sha256,
      .swiftc_tool_sha256,
      .xcodebuild_tool_sha256,
      .xcrun_tool_sha256
    ] | all(type == "string" and test("^[0-9a-f]{64}$"))) and
    .afm_evidence.status == "PASS_PRIVATE_SELF_ADMINISTERED_NATIVE_AFM_FUNCTIONAL_PROBE_ONLY" and
    .afm_evidence.probe_binary_sdk == "27.0" and
    .afm_evidence.canonical_result == true and
    .afm_evidence.model_identity_status == "MODEL_ID_NOT_EXPOSED_BY_API" and
    ([
      .afm_evidence.verifier_result_sha256,
      .afm_evidence.probe_output_sha256,
      .afm_evidence.probe_stderr_sha256,
      .afm_evidence.subject_digest,
      .afm_evidence.profile_fingerprint,
      .afm_evidence.advisory_receipt_digest,
      .afm_evidence.runtime_fingerprint
    ] | all(type == "string" and test("^[0-9a-f]{64}$"))) and
    .afm_evidence.raw_artifact_persisted == false and
    .afm_evidence.transcript_persisted == false and
    .afm_evidence.external_tools_enabled == false and
    .afm_evidence.acceptance_authority_granted == false and
    .afm_evidence.independent_certification == false and
    .afm_evidence.authorizing == false and
    .fi08_evidence.status == "PASS_PRIVATE_FI08_TRANSIENT_CORE_ADMISSION_AND_UNSUPPORTED_REFUSAL_SLICE_ONLY" and
    .fi08_evidence.canonical_report == true and
    .fi08_evidence.fi08_accepted == false and
    .fi08_evidence.fi04_accepted == false and
    .fi08_evidence.independent_certification == false and
    .fi08_evidence.authorizing == false and
    .fi09_evidence.status == "PASS_PRIVATE_NATIVE_BASELINE_INVARIANCE_ONLY" and
    .fi09_evidence.canonical_report == true and
    .fi09_evidence.independent_certification == false and
    .fi09_evidence.authorizing == false and
    .x86_negative_compile.exit_code != 0 and
    .x86_negative_compile.required_diagnostic == "VERITAS_REQUIRES_APPLE_SILICON_ARM64" and
    .non_macos_negative_compile.exit_code != 0 and
    .non_macos_negative_compile.required_diagnostic == "VERITAS_REQUIRES_MACOS"
  ' "${lane_result}" > /dev/null
  [[ "$(/usr/bin/shasum -a 256 "${lane_result}" | /usr/bin/awk '{print $1}')" \
       == "${lane_result_validation_sha256}" ]]

  test_log="${evidence}/swift-test.log"
  machine_evidence="${evidence}/machine-evidence.log"
  parser_receipt="${evidence}/cr09-parser-negative.receipt"
  test_transport="${evidence}/test-transport.json"
  release_build_log="${evidence}/swift-release-build.log"
  x86_log="${evidence}/x86_64-negative-compile.log"
  nonmac_log="${evidence}/non-macos-negative-compile.log"
  fi08_report="${evidence}/fi08-evidence.json"
  fi09_report="${evidence}/fi09-evidence.json"
  lane_source_manifest="${evidence}/source-manifest.sha256"
  crash_probe_binary="$(/usr/bin/jq -r '.crash_probe_binary_path' "${lane_result}")"
  [[ "${crash_probe_binary}" == "${crash_probe_binary:A}" \
     && "${crash_probe_binary}" == "${lane_root}/swift-test/"* \
     && "${crash_probe_binary:t}" == 'VeritasLedgerCrashProbe' \
     && -d "${lane_root}/swift-test" && ! -L "${lane_root}/swift-test" ]]
  for direct_file in \
    "${lane_result}" \
    "${crash_probe_binary}" \
    "${test_log}" \
    "${machine_evidence}" \
    "${parser_receipt}" \
    "${test_transport}" \
    "${release_build_log}" \
    "${x86_log}" \
    "${nonmac_log}" \
    "${fi08_report}" \
    "${fi09_report}" \
    "${lane_source_manifest}"; do
    [[ -f "${direct_file}" && ! -L "${direct_file}" ]]
  done
  [[ -s "${test_log}" ]]
  [[ -s "${release_build_log}" ]]
  [[ -f "${crash_probe_binary}" && ! -L "${crash_probe_binary}" \
     && -x "${crash_probe_binary}" \
     && "$(/usr/bin/stat -f '%u' "${crash_probe_binary}")" == "$(/usr/bin/id -u)" \
     && "$(/usr/bin/stat -f '%l' "${crash_probe_binary}")" == '1' \
     && "$(( 8#$(/usr/bin/stat -f '%Lp' "${crash_probe_binary}") & 8#022 ))" == '0' \
     && "$(( 8#$(/usr/bin/stat -f '%Lp' "${crash_probe_binary}") & 8#100 ))" != '0' \
     && "$(/usr/bin/stat -f '%z' "${crash_probe_binary}")" -gt 8 \
     && "$(/usr/bin/stat -f '%z' "${crash_probe_binary}")" -le 67108864 \
     && "$(/usr/bin/file -b "${crash_probe_binary}")" == *Mach-O* \
     && "$(/usr/bin/file -b "${crash_probe_binary}")" == *executable* \
     && "$(/usr/bin/file -b "${crash_probe_binary}")" == *arm64* \
     && "$("${comparison_lipo_tool}" -archs "${crash_probe_binary}")" == 'arm64' ]]
  [[ "$(/usr/bin/jq -r '.evidence_dir' "${lane_result}")" == "${evidence}" ]]
  direct_platform_result_sha256="$(/usr/bin/shasum -a 256 "${lane_result}" | /usr/bin/awk '{print $1}')"
  direct_crash_probe_binary_sha256="$(/usr/bin/shasum -a 256 "${crash_probe_binary}" | /usr/bin/awk '{print $1}')"
  direct_test_log_sha256="$(/usr/bin/shasum -a 256 "${test_log}" | /usr/bin/awk '{print $1}')"
  direct_test_transport_sha256="$(/usr/bin/shasum -a 256 "${test_transport}" | /usr/bin/awk '{print $1}')"
  /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${direct_test_transport_sha256}"
  [[ "${direct_test_transport_sha256}" == "$(/usr/bin/jq -r '.test_transport_sha256' "${lane_result}")" ]]
  veritas_validate_test_transport_record "${test_transport}" "${evidence}"
  direct_release_build_log_sha256="$(/usr/bin/shasum -a 256 "${release_build_log}" | /usr/bin/awk '{print $1}')"
  direct_x86_log_sha256="$(/usr/bin/shasum -a 256 "${x86_log}" | /usr/bin/awk '{print $1}')"
  direct_nonmac_log_sha256="$(/usr/bin/shasum -a 256 "${nonmac_log}" | /usr/bin/awk '{print $1}')"
  [[ "${direct_platform_result_sha256}" == "${lane_result_validation_sha256}" ]]
  [[ "${direct_crash_probe_binary_sha256}" \
       == "$(/usr/bin/jq -r '.crash_probe_binary_sha256' "${lane_result}")" ]]
  [[ "${direct_test_log_sha256}" == "$(/usr/bin/jq -r '.test_log_sha256' "${lane_result}")" ]]
  [[ "${direct_release_build_log_sha256}" == "$(/usr/bin/jq -r '.release_build_log_sha256' "${lane_result}")" ]]
  [[ "${direct_x86_log_sha256}" == "$(/usr/bin/jq -r '.x86_negative_compile.log_sha256' "${lane_result}")" ]]
  [[ "${direct_nonmac_log_sha256}" == "$(/usr/bin/jq -r '.non_macos_negative_compile.log_sha256' "${lane_result}")" ]]
  [[ "$(/usr/bin/shasum -a 256 "${fi08_report}" | /usr/bin/awk '{print $1}')" == "$(/usr/bin/jq -r '.fi08_evidence.report_sha256' "${lane_result}")" ]]
  [[ "$(/usr/bin/shasum -a 256 "${fi09_report}" | /usr/bin/awk '{print $1}')" == "$(/usr/bin/jq -r '.fi09_evidence.report_sha256' "${lane_result}")" ]]
  [[ "$(/usr/bin/shasum -a 256 "${lane_source_manifest}" | /usr/bin/awk '{print $1}')" == "$(/usr/bin/jq -r '.source_manifest_sha256' "${lane_result}")" ]]
  /usr/bin/grep -Fq 'VERITAS_REQUIRES_APPLE_SILICON_ARM64' "${x86_log}"
  /usr/bin/grep -Fq 'VERITAS_REQUIRES_MACOS' "${nonmac_log}"

  direct_test_totals="$(parse_test_totals "${test_log}")"
  IFS=$'\t' read -r direct_test_count direct_suite_count direct_summary_count direct_test_breakdown <<< "${direct_test_totals}"
  [[ "${direct_test_count}" == "$(/usr/bin/jq -r '.observed_test_count' "${lane_result}")" ]]
  [[ "${direct_suite_count}" == "$(/usr/bin/jq -r '.observed_suite_count' "${lane_result}")" ]]
  [[ "${direct_summary_count}" == "$(/usr/bin/jq -r '.terminal_test_run_summaries' "${lane_result}")" ]]
  [[ "${direct_test_breakdown}" == "$(/usr/bin/jq -r '.observed_test_breakdown' "${lane_result}")" ]]
  abrupt_restart_title='Abrupt helper termination preserves only complete observation transactions'
  abrupt_restart_summary_count="$(/usr/bin/awk -v title="${abrupt_restart_title}" '
    $0 ~ ("^✔ Test \"" title "\" with 4 test cases passed after [0-9]+([.][0-9]+)? seconds[.]$") {
      count += 1
    }
    END { print count + 0 }
  ' "${test_log}")"
  [[ "${abrupt_restart_summary_count}" == "1" ]]
  for abrupt_restart_point in \
    '.beforeObservationBegin' \
    '.afterObservationBeginBeforeWrite' \
    '.beforeObservationCommit' \
    '.afterObservationCommitBeforeReturn'; do
    abrupt_restart_case_line="◇ Test case passing 1 argument point → ${abrupt_restart_point} to \"${abrupt_restart_title}\" started."
    [[ "$(/usr/bin/awk -v expected="${abrupt_restart_case_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${test_log}")" == "1" ]]
  done
  veritas_validate_checkpoint_control_log "${test_log}" "${machine_evidence}"
  veritas_validate_baseline_b_log "${test_log}" "${machine_evidence}" "${direct_crash_probe_binary_sha256}"
  direct_binding_helper_sha256="$(veritas_cr09_binding_helper_sha256 "${machine_evidence}")"
  direct_cr09_binding_frame_sha256="$(veritas_cr09_binding_frame_sha256 "${machine_evidence}")"
  [[ "${direct_binding_helper_sha256}" == "${direct_crash_probe_binary_sha256}" \
     && "${direct_cr09_binding_frame_sha256}" \
          == "$(/usr/bin/jq -r '.cr09_binding_frame_sha256' "${lane_result}")" ]]
  veritas_validate_cr09_parser_negative_receipt \
    "${parser_receipt}" "${test_log}" "${machine_evidence}" \
    "${checkpoint_control_helper}" "${parser_negative_helper}"
  if [[ "${direct_summary_count}" == "1" ]]; then
    direct_test_summary="${direct_test_count} tests in ${direct_suite_count} suites passed across 1 terminal test-run summary"
  else
    direct_test_summary="${direct_test_count} tests in ${direct_suite_count} suites passed across ${direct_summary_count} terminal test-run summaries"
  fi
  [[ "${direct_test_summary}" == "$(/usr/bin/jq -r '.test_summary' "${lane_result}")" ]]
  [[ "$(/usr/bin/shasum -a 256 "${test_log}" | /usr/bin/awk '{print $1}')" \
       == "${direct_test_log_sha256}" ]]

  swift_tool_path="$(/usr/bin/jq -r '.swift_tool_path' "${lane_result}")"
  swift_tool_resolved_path="$(/usr/bin/jq -r '.swift_tool_resolved_path' "${lane_result}")"
  swiftc_tool_path="$(/usr/bin/jq -r '.swiftc_tool_path' "${lane_result}")"
  swiftc_tool_resolved_path="$(/usr/bin/jq -r '.swiftc_tool_resolved_path' "${lane_result}")"
  [[ -L "${swift_tool_path}" ]]
  [[ -L "${swiftc_tool_path}" ]]
  [[ "$(/usr/bin/readlink "${swift_tool_path}")" == "$(/usr/bin/jq -r '.swift_tool_symlink_target' "${lane_result}")" ]]
  [[ "$(/usr/bin/readlink "${swiftc_tool_path}")" == "$(/usr/bin/jq -r '.swiftc_tool_symlink_target' "${lane_result}")" ]]
  [[ "${swift_tool_path:A}" == "${swift_tool_resolved_path}" ]]
  [[ "${swiftc_tool_path:A}" == "${swiftc_tool_resolved_path}" ]]
  [[ -f "${swift_tool_resolved_path}" && ! -L "${swift_tool_resolved_path}" ]]
  [[ -f "${swiftc_tool_resolved_path}" && ! -L "${swiftc_tool_resolved_path}" ]]
  [[ "$(/usr/bin/shasum -a 256 "${swift_tool_resolved_path}" | /usr/bin/awk '{print $1}')" == "$(/usr/bin/jq -r '.swift_tool_sha256' "${lane_result}")" ]]
  [[ "$(/usr/bin/shasum -a 256 "${swiftc_tool_resolved_path}" | /usr/bin/awk '{print $1}')" == "$(/usr/bin/jq -r '.swiftc_tool_sha256' "${lane_result}")" ]]
  sdk_path="$(/usr/bin/jq -r '.sdk_path' "${lane_result}")"
  sdk_resolved_path="$(/usr/bin/jq -r '.sdk_resolved_path' "${lane_result}")"
  [[ -L "${sdk_path}" ]]
  [[ "$(/usr/bin/readlink "${sdk_path}")" == "$(/usr/bin/jq -r '.sdk_symlink_target' "${lane_result}")" ]]
  [[ "${sdk_path:A}" == "${sdk_resolved_path}" ]]
  [[ -d "${sdk_resolved_path}" && ! -L "${sdk_resolved_path}" ]]
  sdk_settings="${sdk_resolved_path}/SDKSettings.json"
  [[ -f "${sdk_settings}" && ! -L "${sdk_settings}" ]]
  [[ "$(/usr/bin/shasum -a 256 "${sdk_settings}" | /usr/bin/awk '{print $1}')" == "$(/usr/bin/jq -r '.sdk_settings_sha256' "${lane_result}")" ]]
  /usr/bin/jq -e --arg expected_sdk "$(/usr/bin/jq -r '.observed_sdk' "${lane_result}")" '.Version == $expected_sdk' "${sdk_settings}" > /dev/null
  [[ "$(/usr/bin/jq -r '.xcodebuild_tool_sha256' "${lane_result}")" == "${comparison_xcodebuild_sha256}" ]]
  [[ "$(/usr/bin/jq -r '.xcrun_tool_sha256' "${lane_result}")" == "${comparison_xcrun_sha256}" ]]

  release_bin_layout="$(/usr/bin/jq -r '.release_bin_layout' "${lane_result}")"
  case "${release_bin_layout}" in
    SWIFTPM_TRIPLE_RELEASE)
      release_bin_path="${lane_root}/swift-release/arm64-apple-macosx/release"
      ;;
    SWIFTPM_XCBUILD_PRODUCTS_RELEASE)
      release_bin_path="${lane_root}/swift-release/out/Products/Release"
      ;;
    *)
      exit 1
      ;;
  esac
  [[ -d "${release_bin_path}" && ! -L "${release_bin_path}" ]]
  direct_release_symlink_count="$(
    /usr/bin/find "${release_bin_path}" -type l \
      -exec /usr/bin/printf x \; \
      | /usr/bin/wc -c \
      | /usr/bin/tr -d '[:space:]'
  )"
  [[ "${direct_release_symlink_count}" == "0" ]]
  direct_release_special_count="$(
    /usr/bin/find "${release_bin_path}" \
      ! -type d ! -type f ! -type l \
      -exec /usr/bin/printf x \; \
      | /usr/bin/wc -c \
      | /usr/bin/tr -d '[:space:]'
  )"
  [[ "${direct_release_special_count}" == "0" ]]
  direct_release_executable_names=()
  while IFS= read -r -d $'\0' candidate; do
    [[ -f "${candidate}" && ! -L "${candidate}" ]]
    if [[ -x "${candidate}" ]]; then
      candidate_relative="${candidate#${release_bin_path}/}"
      [[ "${candidate_relative}" != "${candidate}" && "${candidate_relative}" != /* ]]
      file_description="$(/usr/bin/file -b "${candidate}")"
      [[ "${file_description}" == *Mach-O* && "${file_description}" == *executable* ]]
      direct_release_executable_names+=("${candidate_relative}")
    fi
  done < <(/usr/bin/find "${release_bin_path}" -type f -print0)
  direct_release_executable_names=("${(@o)direct_release_executable_names}")
  [[ "${(j:|:)direct_release_executable_names}" == "Codename Veritas Framework|Veritas AFM Functional Probe" ]]
  [[ "${#direct_release_executable_names}" == "$(/usr/bin/jq -r '.release_executable_count' "${lane_result}")" ]]
  product_binary="${release_bin_path}/Codename Veritas Framework"
  afm_probe_binary="${release_bin_path}/Veritas AFM Functional Probe"
  direct_product_binary_sha256="$(/usr/bin/shasum -a 256 "${product_binary}" | /usr/bin/awk '{print $1}')"
  direct_afm_probe_binary_sha256="$(/usr/bin/shasum -a 256 "${afm_probe_binary}" | /usr/bin/awk '{print $1}')"
  [[ "${direct_product_binary_sha256}" == "$(/usr/bin/jq -r '.product_binary_sha256' "${lane_result}")" ]]
  [[ "${direct_afm_probe_binary_sha256}" == "$(/usr/bin/jq -r '.afm_probe_binary_sha256' "${lane_result}")" ]]
  direct_binary_sdk="$(/usr/bin/jq -r '.all_release_executables_sdk' "${lane_result}")"
  for binary in "${product_binary}" "${afm_probe_binary}"; do
    [[ -f "${binary}" && ! -L "${binary}" ]]
    [[ "$("${comparison_lipo_tool}" -archs "${binary}")" == "arm64" ]]
    direct_load_commands="$("${comparison_otool_tool}" -l "${binary}")"
    /usr/bin/grep -Fq '    minos 27.0' <<< "${direct_load_commands}"
    /usr/bin/grep -Fq "      sdk ${direct_binary_sdk}" <<< "${direct_load_commands}"
  done
  [[ "$(/usr/bin/shasum -a 256 "${lane_result}" | /usr/bin/awk '{print $1}')" \
       == "${lane_result_validation_sha256}" \
     && "${direct_platform_result_sha256}" == "${lane_result_validation_sha256}" ]]
  case "${evidence}" in
    "${lane26}")
      lane26_platform_result_sha256="${direct_platform_result_sha256}"
      lane26_cr09_binding_frame_sha256="${direct_cr09_binding_frame_sha256}"
      lane26_crash_probe_binary_path="${crash_probe_binary}"
      lane26_crash_probe_binary_sha256="${direct_crash_probe_binary_sha256}"
      lane26_product_binary_path="${product_binary}"
      lane26_afm_probe_binary_path="${afm_probe_binary}"
      lane26_test_log_sha256="${direct_test_log_sha256}"
      lane26_test_transport_sha256="${direct_test_transport_sha256}"
      lane26_release_build_log_sha256="${direct_release_build_log_sha256}"
      lane26_x86_log_sha256="${direct_x86_log_sha256}"
      lane26_nonmac_log_sha256="${direct_nonmac_log_sha256}"
      lane26_product_binary_sha256="${direct_product_binary_sha256}"
      lane26_afm_probe_binary_sha256="${direct_afm_probe_binary_sha256}"
      ;;
    "${lane27}")
      lane27_platform_result_sha256="${direct_platform_result_sha256}"
      lane27_cr09_binding_frame_sha256="${direct_cr09_binding_frame_sha256}"
      lane27_crash_probe_binary_path="${crash_probe_binary}"
      lane27_crash_probe_binary_sha256="${direct_crash_probe_binary_sha256}"
      lane27_product_binary_path="${product_binary}"
      lane27_afm_probe_binary_path="${afm_probe_binary}"
      lane27_test_log_sha256="${direct_test_log_sha256}"
      lane27_test_transport_sha256="${direct_test_transport_sha256}"
      lane27_release_build_log_sha256="${direct_release_build_log_sha256}"
      lane27_x86_log_sha256="${direct_x86_log_sha256}"
      lane27_nonmac_log_sha256="${direct_nonmac_log_sha256}"
      lane27_product_binary_sha256="${direct_product_binary_sha256}"
      lane27_afm_probe_binary_sha256="${direct_afm_probe_binary_sha256}"
      ;;
    *) exit 1 ;;
  esac
done

for afm_evidence in "${afm26}" "${afm27}"; do
  [[ -d "${afm_evidence}" && ! -L "${afm_evidence}" ]]
  afm_result="${afm_evidence}/afm-verifier-result.json"
  afm_probe="${afm_evidence}/afm-functional-probe.json"
  afm_stderr="${afm_evidence}/afm-functional-probe.stderr.log"
  afm_source_manifest="${afm_evidence}/source-manifest.sha256"
  platform_result="${afm_evidence:h}/evidence/platform-verifier-result.json"
  [[ -f "${afm_result}" && ! -L "${afm_result}" ]]
  [[ -f "${afm_probe}" && ! -L "${afm_probe}" ]]
  [[ -f "${afm_stderr}" && ! -L "${afm_stderr}" ]]
  [[ -f "${afm_source_manifest}" && ! -L "${afm_source_manifest}" ]]
  [[ -f "${platform_result}" && ! -L "${platform_result}" ]]
  [[ "$(/usr/bin/jq -s 'length' "${afm_result}")" == "1" ]]
  [[ "$(/usr/bin/jq -s 'length' "${afm_probe}")" == "1" ]]
  cmp -s "${afm_result}" <(/usr/bin/jq -cS . "${afm_result}")
  cmp -s "${afm_probe}" <(/usr/bin/jq -cS . "${afm_probe}")
  cmp -s "${batch_source_manifest}" "${afm_source_manifest}"
  [[ "$(shasum -a 256 "${afm_result}" | awk '{print $1}')" == "$(/usr/bin/jq -r '.afm_evidence.verifier_result_sha256' "${platform_result}")" ]]
  [[ "$(shasum -a 256 "${afm_probe}" | awk '{print $1}')" == "$(/usr/bin/jq -r '.afm_evidence.probe_output_sha256' "${platform_result}")" ]]
  [[ "$(shasum -a 256 "${afm_stderr}" | awk '{print $1}')" == "$(/usr/bin/jq -r '.afm_evidence.probe_stderr_sha256' "${platform_result}")" ]]
  [[ ! -s "${afm_stderr}" ]]
  /usr/bin/jq -e \
    --arg batch "${comparison_batch_id}" \
    --arg contract_sha256 "${batch_contract_sha256}" \
    --arg source_sha256 "${batch_source_manifest_sha256}" \
    --slurpfile platform "${platform_result}" '
    type == "object" and
    keys == [
      "acceptance_authority_granted",
      "advisory_receipt_digest",
      "authorizing",
      "batch_contract_sha256",
      "comparison_batch_id",
      "developer_dir",
      "evidence_class",
      "expected_sdk",
      "expected_swift",
      "expected_xcode",
      "expected_xcode_build",
      "external_tools_enabled",
      "independent_certification",
      "lane_id",
      "model_identity_status",
      "observed_sdk",
      "observed_swift",
      "observed_xcode",
      "observed_xcode_build",
      "probe_binary_sdk",
      "probe_binary_sha256",
      "probe_exit_code",
      "probe_output_sha256",
      "probe_stderr_sha256",
      "profile_fingerprint",
      "raw_artifact_persisted",
      "runtime_fingerprint",
      "schema_version",
      "sdk_path",
      "sdk_resolved_path",
      "sdk_settings_sha256",
      "sdk_symlink_target",
      "source_manifest_sha256",
      "status",
      "subject_digest",
      "swift_tool_path",
      "swift_tool_resolved_path",
      "swift_tool_sha256",
      "swift_tool_symlink_target",
      "transcript_persisted",
      "xcodebuild_tool_sha256",
      "xcrun_tool_sha256"
    ] and
    .schema_version == 1 and
    .status == "PASS_PRIVATE_SELF_ADMINISTERED_NATIVE_AFM_FUNCTIONAL_PROBE_ONLY" and
    .evidence_class == "SELF_ADMINISTERED_NATIVE_AFM_FUNCTIONAL_PROBE" and
    .comparison_batch_id == $batch and
    .batch_contract_sha256 == $contract_sha256 and
    .source_manifest_sha256 == $source_sha256 and
    .lane_id == $platform[0].lane_id and
    .developer_dir == $platform[0].developer_dir and
    .swift_tool_path == $platform[0].swift_tool_path and
    .swift_tool_resolved_path == $platform[0].swift_tool_resolved_path and
    .swift_tool_sha256 == $platform[0].swift_tool_sha256 and
    .swift_tool_symlink_target == $platform[0].swift_tool_symlink_target and
    .sdk_path == $platform[0].sdk_path and
    .sdk_resolved_path == $platform[0].sdk_resolved_path and
    .sdk_settings_sha256 == $platform[0].sdk_settings_sha256 and
    .sdk_symlink_target == $platform[0].sdk_symlink_target and
    .xcodebuild_tool_sha256 == $platform[0].xcodebuild_tool_sha256 and
    .xcrun_tool_sha256 == $platform[0].xcrun_tool_sha256 and
    .expected_xcode == $platform[0].expected_xcode and
    .observed_xcode == $platform[0].observed_xcode and
    .expected_xcode_build == $platform[0].expected_xcode_build and
    .observed_xcode_build == $platform[0].observed_xcode_build and
    .expected_swift == $platform[0].expected_swift and
    .observed_swift == $platform[0].observed_swift and
    .expected_sdk == $platform[0].declared_sdk and
    .observed_sdk == $platform[0].observed_sdk and
    .probe_binary_sdk == $platform[0].afm_evidence.probe_binary_sdk and
    .probe_binary_sha256 == $platform[0].afm_probe_binary_sha256 and
    .probe_output_sha256 == $platform[0].afm_evidence.probe_output_sha256 and
    .probe_stderr_sha256 == $platform[0].afm_evidence.probe_stderr_sha256 and
    .subject_digest == $platform[0].afm_evidence.subject_digest and
    .profile_fingerprint == $platform[0].afm_evidence.profile_fingerprint and
    .advisory_receipt_digest == $platform[0].afm_evidence.advisory_receipt_digest and
    .runtime_fingerprint == $platform[0].afm_evidence.runtime_fingerprint and
    .probe_exit_code == 0 and
    ([
      .swift_tool_sha256,
      .xcodebuild_tool_sha256,
      .xcrun_tool_sha256
    ] | all(type == "string" and test("^[0-9a-f]{64}$"))) and
    .model_identity_status == "MODEL_ID_NOT_EXPOSED_BY_API" and
    .raw_artifact_persisted == false and
    .transcript_persisted == false and
    .external_tools_enabled == false and
    .acceptance_authority_granted == false and
    .independent_certification == false and
    .authorizing == false
  ' "${afm_result}" > /dev/null
done

/usr/bin/jq -e \
  --arg lane "${lane26_id}" \
  --arg developer_dir "/Applications/Xcode.app/Contents/Developer" \
  --arg swift_tool_path "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift" \
  --arg swift_tool_resolved_path "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-frontend" \
  --arg swiftc_tool_path "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc" \
  --arg swiftc_tool_resolved_path "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-frontend" \
  --arg sdk_path "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.5.sdk" \
  --arg sdk_resolved_path "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk" \
  --arg xcodebuild_sha256 "${comparison_xcodebuild_sha256}" \
  --arg xcrun_sha256 "${comparison_xcrun_sha256}" '
  .lane_id == $lane and
  .developer_dir == $developer_dir and
  .swift_tool_path == $swift_tool_path and
  .swift_tool_resolved_path == $swift_tool_resolved_path and
  .swift_tool_symlink_target == "swift-frontend" and
  .swiftc_tool_path == $swiftc_tool_path and
  .swiftc_tool_resolved_path == $swiftc_tool_resolved_path and
  .swiftc_tool_symlink_target == "swift-frontend" and
  .sdk_path == $sdk_path and
  .sdk_resolved_path == $sdk_resolved_path and
  .sdk_symlink_target == "MacOSX.sdk" and
  .xcodebuild_tool_sha256 == $xcodebuild_sha256 and
  .xcrun_tool_sha256 == $xcrun_sha256 and
  .expected_xcode == "26.6" and .observed_xcode == "26.6" and
  .expected_xcode_build == "17F113" and .observed_xcode_build == "17F113" and
  .expected_swift == "6.3.3" and .observed_swift == "6.3.3" and
  .declared_sdk == "26.5" and .observed_sdk == "26.5" and
  .all_release_executables_sdk == "27.0" and
  .expected_test_breakdown == "470/37" and
  .observed_test_breakdown == "470/37"
' "${lane26}/platform-verifier-result.json" > /dev/null

/usr/bin/jq -e \
  --arg lane "${lane27_id}" \
  --arg developer_dir "/Applications/Xcode-27.0.app/Contents/Developer" \
  --arg swift_tool_path "/Applications/Xcode-27.0.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift" \
  --arg swift_tool_resolved_path "/Applications/Xcode-27.0.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-frontend" \
  --arg swiftc_tool_path "/Applications/Xcode-27.0.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc" \
  --arg swiftc_tool_resolved_path "/Applications/Xcode-27.0.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-frontend" \
  --arg sdk_path "/Applications/Xcode-27.0.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX27.0.sdk" \
  --arg sdk_resolved_path "/Applications/Xcode-27.0.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk" \
  --arg xcodebuild_sha256 "${comparison_xcodebuild_sha256}" \
  --arg xcrun_sha256 "${comparison_xcrun_sha256}" '
  .lane_id == $lane and
  .developer_dir == $developer_dir and
  .swift_tool_path == $swift_tool_path and
  .swift_tool_resolved_path == $swift_tool_resolved_path and
  .swift_tool_symlink_target == "swift-frontend" and
  .swiftc_tool_path == $swiftc_tool_path and
  .swiftc_tool_resolved_path == $swiftc_tool_resolved_path and
  .swiftc_tool_symlink_target == "swift-frontend" and
  .sdk_path == $sdk_path and
  .sdk_resolved_path == $sdk_resolved_path and
  .sdk_symlink_target == "MacOSX.sdk" and
  .xcodebuild_tool_sha256 == $xcodebuild_sha256 and
  .xcrun_tool_sha256 == $xcrun_sha256 and
  .expected_xcode == "27.0" and .observed_xcode == "27.0" and
  .expected_xcode_build == "27A5228h" and .observed_xcode_build == "27A5228h" and
  .expected_swift == "6.4" and .observed_swift == "6.4" and
  .declared_sdk == "27.0" and .observed_sdk == "27.0" and
  .all_release_executables_sdk == "27.0" and
  .expected_test_breakdown == "347/30,26/2,97/5" and
  .observed_test_breakdown == "347/30,26/2,97/5"
' "${lane27}/platform-verifier-result.json" > /dev/null

cmp -s "${batch_source_manifest}" "${lane26}/source-manifest.sha256"
cmp -s "${batch_source_manifest}" "${lane27}/source-manifest.sha256"
cmp -s "${lane26}/source-manifest.sha256" "${lane27}/source-manifest.sha256"
cmp -s "${lane26}/fi08-evidence.json" "${lane27}/fi08-evidence.json"
cmp -s "${lane26}/fi09-evidence.json" "${lane27}/fi09-evidence.json"
cmp -s "${afm26}/afm-functional-probe.json" "${afm27}/afm-functional-probe.json"

source26="$(/usr/bin/jq -r '.source_manifest_sha256' "${lane26}/platform-verifier-result.json")"
source27="$(/usr/bin/jq -r '.source_manifest_sha256' "${lane27}/platform-verifier-result.json")"
fi08_report26="$(/usr/bin/jq -r '.fi08_evidence.report_sha256' "${lane26}/platform-verifier-result.json")"
fi08_report27="$(/usr/bin/jq -r '.fi08_evidence.report_sha256' "${lane27}/platform-verifier-result.json")"
fi09_report26="$(/usr/bin/jq -r '.fi09_evidence.report_sha256' "${lane26}/platform-verifier-result.json")"
fi09_report27="$(/usr/bin/jq -r '.fi09_evidence.report_sha256' "${lane27}/platform-verifier-result.json")"
afm_probe_output26="$(/usr/bin/jq -r '.afm_evidence.probe_output_sha256' "${lane26}/platform-verifier-result.json")"
afm_probe_output27="$(/usr/bin/jq -r '.afm_evidence.probe_output_sha256' "${lane27}/platform-verifier-result.json")"
afm_subject26="$(/usr/bin/jq -r '.afm_evidence.subject_digest' "${lane26}/platform-verifier-result.json")"
afm_subject27="$(/usr/bin/jq -r '.afm_evidence.subject_digest' "${lane27}/platform-verifier-result.json")"
afm_profile26="$(/usr/bin/jq -r '.afm_evidence.profile_fingerprint' "${lane26}/platform-verifier-result.json")"
afm_profile27="$(/usr/bin/jq -r '.afm_evidence.profile_fingerprint' "${lane27}/platform-verifier-result.json")"
afm_receipt26="$(/usr/bin/jq -r '.afm_evidence.advisory_receipt_digest' "${lane26}/platform-verifier-result.json")"
afm_receipt27="$(/usr/bin/jq -r '.afm_evidence.advisory_receipt_digest' "${lane27}/platform-verifier-result.json")"
afm_runtime26="$(/usr/bin/jq -r '.afm_evidence.runtime_fingerprint' "${lane26}/platform-verifier-result.json")"
afm_runtime27="$(/usr/bin/jq -r '.afm_evidence.runtime_fingerprint' "${lane27}/platform-verifier-result.json")"

[[ "${source26}" == "${source27}" ]]
[[ "${source26}" == "${batch_source_manifest_sha256}" ]]
[[ "${fi08_report26}" == "${fi08_report27}" ]]
[[ "${fi09_report26}" == "${fi09_report27}" ]]
[[ "${afm_probe_output26}" == "${afm_probe_output27}" ]]
[[ "${afm_subject26}" == "${afm_subject27}" ]]
[[ "${afm_profile26}" == "${afm_profile27}" ]]
[[ "${afm_receipt26}" == "${afm_receipt27}" ]]
[[ "${afm_runtime26}" == "${afm_runtime27}" ]]
[[ "${source26}" == "$(shasum -a 256 "${lane26}/source-manifest.sha256" | awk '{print $1}')" ]]
[[ "${fi08_report26}" == "$(shasum -a 256 "${lane26}/fi08-evidence.json" | awk '{print $1}')" ]]
[[ "${fi09_report26}" == "$(shasum -a 256 "${lane26}/fi09-evidence.json" | awk '{print $1}')" ]]
[[ "${afm_probe_output26}" == "$(shasum -a 256 "${afm26}/afm-functional-probe.json" | awk '{print $1}')" ]]
for bound_digest in \
  "${lane26_platform_result_sha256}" \
  "${lane26_cr09_binding_frame_sha256}" \
  "${lane26_crash_probe_binary_sha256}" \
  "${lane26_test_log_sha256}" \
  "${lane26_release_build_log_sha256}" \
  "${lane26_x86_log_sha256}" \
  "${lane26_nonmac_log_sha256}" \
  "${lane26_product_binary_sha256}" \
  "${lane26_afm_probe_binary_sha256}" \
  "${lane27_platform_result_sha256}" \
  "${lane27_cr09_binding_frame_sha256}" \
  "${lane27_crash_probe_binary_sha256}" \
  "${lane27_test_log_sha256}" \
  "${lane27_release_build_log_sha256}" \
  "${lane27_x86_log_sha256}" \
  "${lane27_nonmac_log_sha256}" \
  "${lane27_product_binary_sha256}" \
  "${lane27_afm_probe_binary_sha256}"; do
  /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${bound_digest}"
done
[[ ! -e "${comparison_result}" ]]

/usr/bin/jq -cS -n \
  --arg comparison_batch_id "${comparison_batch_id}" \
  --arg lane26_id "${lane26_id}" \
  --arg lane27_id "${lane27_id}" \
  --arg batch_contract_sha256 "${batch_contract_sha256}" \
  --arg source_manifest_sha256 "${source26}" \
  --arg fi08_report_sha256 "${fi08_report26}" \
  --arg fi09_report_sha256 "${fi09_report26}" \
  --arg afm_probe_output_sha256 "${afm_probe_output26}" \
  --arg afm_subject_digest "${afm_subject26}" \
  --arg afm_profile_fingerprint "${afm_profile26}" \
  --arg afm_advisory_receipt_digest "${afm_receipt26}" \
  --arg afm_runtime_fingerprint "${afm_runtime26}" \
  --arg comparison_developer_dir "${comparison_developer_dir}" \
  --arg comparison_xcode "${comparison_xcode}" \
  --arg comparison_xcode_build "${comparison_xcode_build}" \
  --arg comparison_xcodebuild_tool_sha256 "${comparison_xcodebuild_sha256}" \
  --arg comparison_xcrun_tool_sha256 "${comparison_xcrun_sha256}" \
  --arg comparison_lipo_tool_path "${comparison_lipo_tool}" \
  --arg comparison_lipo_tool_resolved_path "${comparison_lipo_tool_resolved_path}" \
  --arg comparison_lipo_tool_sha256 "${comparison_lipo_tool_sha256}" \
  --arg comparison_otool_tool_path "${comparison_otool_tool}" \
  --arg comparison_otool_tool_resolved_path "${comparison_otool_tool_resolved_path}" \
  --arg comparison_otool_tool_symlink_target "${comparison_otool_tool_symlink_target}" \
  --arg comparison_otool_tool_sha256 "${comparison_otool_tool_sha256}" \
  --arg lane26_platform_result_sha256 "${lane26_platform_result_sha256}" \
  --arg lane26_cr09_binding_frame_sha256 "${lane26_cr09_binding_frame_sha256}" \
  --arg lane26_crash_probe_binary_sha256 "${lane26_crash_probe_binary_sha256}" \
  --arg lane26_test_log_sha256 "${lane26_test_log_sha256}" \
  --arg lane26_test_transport_sha256 "${lane26_test_transport_sha256}" \
  --arg lane26_release_build_log_sha256 "${lane26_release_build_log_sha256}" \
  --arg lane26_x86_log_sha256 "${lane26_x86_log_sha256}" \
  --arg lane26_nonmac_log_sha256 "${lane26_nonmac_log_sha256}" \
  --arg lane26_product_binary_sha256 "${lane26_product_binary_sha256}" \
  --arg lane26_afm_probe_binary_sha256 "${lane26_afm_probe_binary_sha256}" \
  --arg lane27_platform_result_sha256 "${lane27_platform_result_sha256}" \
  --arg lane27_cr09_binding_frame_sha256 "${lane27_cr09_binding_frame_sha256}" \
  --arg lane27_crash_probe_binary_sha256 "${lane27_crash_probe_binary_sha256}" \
  --arg lane27_test_log_sha256 "${lane27_test_log_sha256}" \
  --arg lane27_test_transport_sha256 "${lane27_test_transport_sha256}" \
  --arg lane27_release_build_log_sha256 "${lane27_release_build_log_sha256}" \
  --arg lane27_x86_log_sha256 "${lane27_x86_log_sha256}" \
  --arg lane27_nonmac_log_sha256 "${lane27_nonmac_log_sha256}" \
  --arg lane27_product_binary_sha256 "${lane27_product_binary_sha256}" \
  --arg lane27_afm_probe_binary_sha256 "${lane27_afm_probe_binary_sha256}" \
  '{
    schema_version: 4,
    status: "PASS_PRIVATE_DUAL_TOOLCHAIN_FI08_FI09_AND_AFM_BYTE_INVARIANCE_ONLY",
    comparison_batch_id: $comparison_batch_id,
    lane_count: 2,
    lane_ids: [$lane26_id, $lane27_id],
    expected_test_count_per_lane: 470,
    expected_suite_count_per_lane: 37,
    admitted_sdk_versions: ["26.5", "27.0"],
    release_binary_sdk: "27.0",
    batch_contract_sha256: $batch_contract_sha256,
    source_manifest_sha256: $source_manifest_sha256,
    final_source_manifest_sha256: $source_manifest_sha256,
    source_manifest_rechecked_before_publish: true,
    source_manifests_byte_identical: true,
    lane_artifact_bindings: [
      {
        lane_id: $lane26_id,
        platform_result_sha256: $lane26_platform_result_sha256,
        cr09_binding_frame_sha256: $lane26_cr09_binding_frame_sha256,
        crash_probe_binary_sha256: $lane26_crash_probe_binary_sha256,
        test_log_sha256: $lane26_test_log_sha256,
        test_transport_sha256: $lane26_test_transport_sha256,
        release_build_log_sha256: $lane26_release_build_log_sha256,
        x86_negative_compile_log_sha256: $lane26_x86_log_sha256,
        non_macos_negative_compile_log_sha256: $lane26_nonmac_log_sha256,
        product_binary_sha256: $lane26_product_binary_sha256,
        afm_probe_binary_sha256: $lane26_afm_probe_binary_sha256
      },
      {
        lane_id: $lane27_id,
        platform_result_sha256: $lane27_platform_result_sha256,
        cr09_binding_frame_sha256: $lane27_cr09_binding_frame_sha256,
        crash_probe_binary_sha256: $lane27_crash_probe_binary_sha256,
        test_log_sha256: $lane27_test_log_sha256,
        test_transport_sha256: $lane27_test_transport_sha256,
        release_build_log_sha256: $lane27_release_build_log_sha256,
        x86_negative_compile_log_sha256: $lane27_x86_log_sha256,
        non_macos_negative_compile_log_sha256: $lane27_nonmac_log_sha256,
        product_binary_sha256: $lane27_product_binary_sha256,
        afm_probe_binary_sha256: $lane27_afm_probe_binary_sha256
      }
    ],
    fi08_report_sha256: $fi08_report_sha256,
    fi08_reports_byte_identical: true,
    fi08_accepted: false,
    fi04_accepted: false,
    fi09_report_sha256: $fi09_report_sha256,
    fi09_reports_byte_identical: true,
    afm_probe_output_sha256: $afm_probe_output_sha256,
    afm_probe_outputs_byte_identical: true,
    afm_subject_digest: $afm_subject_digest,
    afm_profile_fingerprint: $afm_profile_fingerprint,
    afm_advisory_receipt_digest: $afm_advisory_receipt_digest,
    afm_runtime_fingerprint: $afm_runtime_fingerprint,
    afm_verifier_results_canonical: true,
    afm_model_identity_status: "MODEL_ID_NOT_EXPOSED_BY_API",
    comparison_developer_dir: $comparison_developer_dir,
    comparison_xcode: $comparison_xcode,
    comparison_xcode_build: $comparison_xcode_build,
    comparison_xcodebuild_tool_sha256: $comparison_xcodebuild_tool_sha256,
    comparison_xcrun_tool_sha256: $comparison_xcrun_tool_sha256,
    comparison_lipo_tool_path: $comparison_lipo_tool_path,
    comparison_lipo_tool_resolved_path: $comparison_lipo_tool_resolved_path,
    comparison_lipo_tool_sha256: $comparison_lipo_tool_sha256,
    comparison_otool_tool_path: $comparison_otool_tool_path,
    comparison_otool_tool_resolved_path: $comparison_otool_tool_resolved_path,
    comparison_otool_tool_symlink_target: $comparison_otool_tool_symlink_target,
    comparison_otool_tool_sha256: $comparison_otool_tool_sha256,
    release_artifacts_directly_revalidated: true,
    test_logs_directly_reparsed: true,
    negative_compile_logs_directly_revalidated: true,
    mac5_accepted: false,
    independent_certification: false,
    authorizing: false
  }' > "${comparison_result_pending}"

[[ "$(/usr/bin/jq -s 'length' "${comparison_result_pending}")" == "1" ]]
cmp -s "${comparison_result_pending}" <(/usr/bin/jq -cS . "${comparison_result_pending}")
final_source_manifest="${comparison_attempt_dir}/source-manifest.final.sha256"
veritas_build_source_manifest "${package_dir}" > "${final_source_manifest}"
cmp -s "${batch_source_manifest}" "${final_source_manifest}"
[[ "$(/usr/bin/shasum -a 256 "${final_source_manifest}" | /usr/bin/awk '{print $1}')" == "${source26}" ]]

# Validate the complete schema-4 comparison object and bind both positional
# lane records to the evidence digests captured by this comparator.
/usr/bin/jq -e \
  --arg comparison_batch_id "${comparison_batch_id}" \
  --arg lane26_id "${lane26_id}" \
  --arg lane27_id "${lane27_id}" \
  --arg batch_contract_sha256 "${batch_contract_sha256}" \
  --arg source_manifest_sha256 "${source26}" \
  --arg fi08_report_sha256 "${fi08_report26}" \
  --arg fi09_report_sha256 "${fi09_report26}" \
  --arg afm_probe_output_sha256 "${afm_probe_output26}" \
  --arg afm_subject_digest "${afm_subject26}" \
  --arg afm_profile_fingerprint "${afm_profile26}" \
  --arg afm_advisory_receipt_digest "${afm_receipt26}" \
  --arg afm_runtime_fingerprint "${afm_runtime26}" \
  --arg comparison_developer_dir "${comparison_developer_dir}" \
  --arg comparison_xcode "${comparison_xcode}" \
  --arg comparison_xcode_build "${comparison_xcode_build}" \
  --arg comparison_xcodebuild_tool_sha256 "${comparison_xcodebuild_sha256}" \
  --arg comparison_xcrun_tool_sha256 "${comparison_xcrun_sha256}" \
  --arg comparison_lipo_tool_path "${comparison_lipo_tool}" \
  --arg comparison_lipo_tool_resolved_path "${comparison_lipo_tool_resolved_path}" \
  --arg comparison_lipo_tool_sha256 "${comparison_lipo_tool_sha256}" \
  --arg comparison_otool_tool_path "${comparison_otool_tool}" \
  --arg comparison_otool_tool_resolved_path "${comparison_otool_tool_resolved_path}" \
  --arg comparison_otool_tool_symlink_target "${comparison_otool_tool_symlink_target}" \
  --arg comparison_otool_tool_sha256 "${comparison_otool_tool_sha256}" \
  --arg lane26_platform_result_sha256 "${lane26_platform_result_sha256}" \
  --arg lane26_cr09_binding_frame_sha256 "${lane26_cr09_binding_frame_sha256}" \
  --arg lane26_crash_probe_binary_sha256 "${lane26_crash_probe_binary_sha256}" \
  --arg lane26_test_log_sha256 "${lane26_test_log_sha256}" \
  --arg lane26_test_transport_sha256 "${lane26_test_transport_sha256}" \
  --arg lane26_release_build_log_sha256 "${lane26_release_build_log_sha256}" \
  --arg lane26_x86_log_sha256 "${lane26_x86_log_sha256}" \
  --arg lane26_nonmac_log_sha256 "${lane26_nonmac_log_sha256}" \
  --arg lane26_product_binary_sha256 "${lane26_product_binary_sha256}" \
  --arg lane26_afm_probe_binary_sha256 "${lane26_afm_probe_binary_sha256}" \
  --arg lane27_platform_result_sha256 "${lane27_platform_result_sha256}" \
  --arg lane27_cr09_binding_frame_sha256 "${lane27_cr09_binding_frame_sha256}" \
  --arg lane27_crash_probe_binary_sha256 "${lane27_crash_probe_binary_sha256}" \
  --arg lane27_test_log_sha256 "${lane27_test_log_sha256}" \
  --arg lane27_test_transport_sha256 "${lane27_test_transport_sha256}" \
  --arg lane27_release_build_log_sha256 "${lane27_release_build_log_sha256}" \
  --arg lane27_x86_log_sha256 "${lane27_x86_log_sha256}" \
  --arg lane27_nonmac_log_sha256 "${lane27_nonmac_log_sha256}" \
  --arg lane27_product_binary_sha256 "${lane27_product_binary_sha256}" \
  --arg lane27_afm_probe_binary_sha256 "${lane27_afm_probe_binary_sha256}" '
  type == "object" and
  keys == [
    "admitted_sdk_versions",
    "afm_advisory_receipt_digest",
    "afm_model_identity_status",
    "afm_probe_output_sha256",
    "afm_probe_outputs_byte_identical",
    "afm_profile_fingerprint",
    "afm_runtime_fingerprint",
    "afm_subject_digest",
    "afm_verifier_results_canonical",
    "authorizing",
    "batch_contract_sha256",
    "comparison_batch_id",
    "comparison_developer_dir",
    "comparison_lipo_tool_path",
    "comparison_lipo_tool_resolved_path",
    "comparison_lipo_tool_sha256",
    "comparison_otool_tool_path",
    "comparison_otool_tool_resolved_path",
    "comparison_otool_tool_sha256",
    "comparison_otool_tool_symlink_target",
    "comparison_xcode",
    "comparison_xcode_build",
    "comparison_xcodebuild_tool_sha256",
    "comparison_xcrun_tool_sha256",
    "expected_suite_count_per_lane",
    "expected_test_count_per_lane",
    "fi04_accepted",
    "fi08_accepted",
    "fi08_report_sha256",
    "fi08_reports_byte_identical",
    "fi09_report_sha256",
    "fi09_reports_byte_identical",
    "final_source_manifest_sha256",
    "independent_certification",
    "lane_artifact_bindings",
    "lane_count",
    "lane_ids",
    "mac5_accepted",
    "negative_compile_logs_directly_revalidated",
    "release_artifacts_directly_revalidated",
    "release_binary_sdk",
    "schema_version",
    "source_manifest_rechecked_before_publish",
    "source_manifest_sha256",
    "source_manifests_byte_identical",
    "status",
    "test_logs_directly_reparsed"
  ] and
  (.lane_artifact_bindings | type == "array" and length == 2) and
  ([.lane_artifact_bindings[] |
    type == "object" and
    keys == [
      "afm_probe_binary_sha256",
      "cr09_binding_frame_sha256",
      "crash_probe_binary_sha256",
      "lane_id",
      "non_macos_negative_compile_log_sha256",
      "platform_result_sha256",
      "product_binary_sha256",
      "release_build_log_sha256",
      "test_log_sha256",
      "test_transport_sha256",
      "x86_negative_compile_log_sha256"
    ]
  ] | all) and
  .schema_version == 4 and
  .status == "PASS_PRIVATE_DUAL_TOOLCHAIN_FI08_FI09_AND_AFM_BYTE_INVARIANCE_ONLY" and
  .comparison_batch_id == $comparison_batch_id and
  .lane_count == 2 and
  .lane_ids == [$lane26_id, $lane27_id] and
  .expected_test_count_per_lane == 470 and
  .expected_suite_count_per_lane == 37 and
  .admitted_sdk_versions == ["26.5", "27.0"] and
  .release_binary_sdk == "27.0" and
  .batch_contract_sha256 == $batch_contract_sha256 and
  .source_manifest_sha256 == $source_manifest_sha256 and
  .final_source_manifest_sha256 == $source_manifest_sha256 and
  .fi08_report_sha256 == $fi08_report_sha256 and
  .fi09_report_sha256 == $fi09_report_sha256 and
  .afm_probe_output_sha256 == $afm_probe_output_sha256 and
  .afm_subject_digest == $afm_subject_digest and
  .afm_profile_fingerprint == $afm_profile_fingerprint and
  .afm_advisory_receipt_digest == $afm_advisory_receipt_digest and
  .afm_runtime_fingerprint == $afm_runtime_fingerprint and
  .comparison_developer_dir == $comparison_developer_dir and
  .comparison_xcode == $comparison_xcode and
  .comparison_xcode_build == $comparison_xcode_build and
  .comparison_xcodebuild_tool_sha256 == $comparison_xcodebuild_tool_sha256 and
  .comparison_xcrun_tool_sha256 == $comparison_xcrun_tool_sha256 and
  .comparison_lipo_tool_path == $comparison_lipo_tool_path and
  .comparison_lipo_tool_resolved_path == $comparison_lipo_tool_resolved_path and
  .comparison_lipo_tool_sha256 == $comparison_lipo_tool_sha256 and
  .comparison_otool_tool_path == $comparison_otool_tool_path and
  .comparison_otool_tool_resolved_path == $comparison_otool_tool_resolved_path and
  .comparison_otool_tool_symlink_target == $comparison_otool_tool_symlink_target and
  .comparison_otool_tool_sha256 == $comparison_otool_tool_sha256 and
  .lane_artifact_bindings == [
    {
      lane_id: $lane26_id,
      platform_result_sha256: $lane26_platform_result_sha256,
      cr09_binding_frame_sha256: $lane26_cr09_binding_frame_sha256,
      crash_probe_binary_sha256: $lane26_crash_probe_binary_sha256,
      test_log_sha256: $lane26_test_log_sha256,
      test_transport_sha256: $lane26_test_transport_sha256,
      release_build_log_sha256: $lane26_release_build_log_sha256,
      x86_negative_compile_log_sha256: $lane26_x86_log_sha256,
      non_macos_negative_compile_log_sha256: $lane26_nonmac_log_sha256,
      product_binary_sha256: $lane26_product_binary_sha256,
      afm_probe_binary_sha256: $lane26_afm_probe_binary_sha256
    },
    {
      lane_id: $lane27_id,
      platform_result_sha256: $lane27_platform_result_sha256,
      cr09_binding_frame_sha256: $lane27_cr09_binding_frame_sha256,
      crash_probe_binary_sha256: $lane27_crash_probe_binary_sha256,
      test_log_sha256: $lane27_test_log_sha256,
      test_transport_sha256: $lane27_test_transport_sha256,
      release_build_log_sha256: $lane27_release_build_log_sha256,
      x86_negative_compile_log_sha256: $lane27_x86_log_sha256,
      non_macos_negative_compile_log_sha256: $lane27_nonmac_log_sha256,
      product_binary_sha256: $lane27_product_binary_sha256,
      afm_probe_binary_sha256: $lane27_afm_probe_binary_sha256
    }
  ] and
  ([$batch_contract_sha256, $source_manifest_sha256, $fi08_report_sha256,
    $fi09_report_sha256, $afm_probe_output_sha256, $afm_subject_digest,
    $afm_profile_fingerprint, $afm_advisory_receipt_digest,
    $afm_runtime_fingerprint, $comparison_xcodebuild_tool_sha256,
    $comparison_xcrun_tool_sha256, $comparison_lipo_tool_sha256,
    $comparison_otool_tool_sha256] +
    [.lane_artifact_bindings[] |
      .platform_result_sha256,
      .cr09_binding_frame_sha256,
      .crash_probe_binary_sha256,
      .test_log_sha256,
      .test_transport_sha256,
      .release_build_log_sha256,
      .x86_negative_compile_log_sha256,
      .non_macos_negative_compile_log_sha256,
      .product_binary_sha256,
      .afm_probe_binary_sha256] |
    all(type == "string" and test("^[0-9a-f]{64}$"))) and
  .afm_model_identity_status == "MODEL_ID_NOT_EXPOSED_BY_API" and
  .source_manifest_rechecked_before_publish == true and
  .source_manifests_byte_identical == true and
  .fi08_reports_byte_identical == true and
  .fi08_accepted == false and
  .fi04_accepted == false and
  .fi09_reports_byte_identical == true and
  .afm_probe_outputs_byte_identical == true and
  .afm_verifier_results_canonical == true and
  .release_artifacts_directly_revalidated == true and
  .test_logs_directly_reparsed == true and
  .negative_compile_logs_directly_revalidated == true and
  .mac5_accepted == false and
  .independent_certification == false and
  .authorizing == false
' "${comparison_result_pending}" > /dev/null

[[ -f "${comparison_result_pending}" && ! -L "${comparison_result_pending}" \
   && "$(/usr/bin/stat -f '%u' "${comparison_result_pending}")" == "$(/usr/bin/id -u)" \
   && "$(/usr/bin/stat -f '%l' "${comparison_result_pending}")" == '1' \
   && "$(( 8#$(/usr/bin/stat -f '%Lp' "${comparison_result_pending}") & 8#022 ))" == '0' ]]
comparison_result_pending_identity="$(/usr/bin/stat -f '%d:%i' "${comparison_result_pending}")"
comparison_result_pending_sha256="$(/usr/bin/shasum -a 256 "${comparison_result_pending}" \
  | /usr/bin/awk '{print $1}')"

# Acceptance-close rehash: no stale artifact named by either lane binding may
# survive the interval between direct validation and atomic publication.
for close_file in \
  "${lane26}/platform-verifier-result.json" \
  "${lane26}/swift-test.log" \
  "${lane26}/swift-release-build.log" \
  "${lane26}/x86_64-negative-compile.log" \
  "${lane26}/non-macos-negative-compile.log" \
  "${lane26_crash_probe_binary_path}" \
  "${lane26_product_binary_path}" \
  "${lane26_afm_probe_binary_path}" \
  "${lane26}/fi08-evidence.json" \
  "${lane26}/fi09-evidence.json" \
  "${afm26}/afm-functional-probe.json" \
  "${afm26}/afm-functional-probe.stderr.log" \
  "${afm26}/afm-verifier-result.json" \
  "${lane27}/platform-verifier-result.json" \
  "${lane27}/swift-test.log" \
  "${lane27}/swift-release-build.log" \
  "${lane27}/x86_64-negative-compile.log" \
  "${lane27}/non-macos-negative-compile.log" \
  "${lane27_crash_probe_binary_path}" \
  "${lane27_product_binary_path}" \
  "${lane27_afm_probe_binary_path}" \
  "${lane27}/fi08-evidence.json" \
  "${lane27}/fi09-evidence.json" \
  "${afm27}/afm-functional-probe.json" \
  "${afm27}/afm-functional-probe.stderr.log" \
  "${afm27}/afm-verifier-result.json"; do
  [[ -f "${close_file}" && ! -L "${close_file}" ]]
done
[[ "$(/usr/bin/shasum -a 256 "${lane26}/platform-verifier-result.json" | /usr/bin/awk '{print $1}')" \
      == "${lane26_platform_result_sha256}" ]]
[[ "$(/usr/bin/shasum -a 256 "${lane26}/swift-test.log" | /usr/bin/awk '{print $1}')" \
      == "${lane26_test_log_sha256}" ]]
[[ "$(/usr/bin/shasum -a 256 "${lane26_crash_probe_binary_path}" | /usr/bin/awk '{print $1}')" \
      == "${lane26_crash_probe_binary_sha256}" ]]
[[ "$(/usr/bin/shasum -a 256 "${lane26}/swift-release-build.log" | /usr/bin/awk '{print $1}')" \
      == "${lane26_release_build_log_sha256}" \
   && "$(/usr/bin/shasum -a 256 "${lane26}/x86_64-negative-compile.log" | /usr/bin/awk '{print $1}')" \
      == "${lane26_x86_log_sha256}" \
   && "$(/usr/bin/shasum -a 256 "${lane26}/non-macos-negative-compile.log" | /usr/bin/awk '{print $1}')" \
      == "${lane26_nonmac_log_sha256}" \
   && "$(/usr/bin/shasum -a 256 "${lane26_product_binary_path}" | /usr/bin/awk '{print $1}')" \
      == "${lane26_product_binary_sha256}" \
   && "$(/usr/bin/shasum -a 256 "${lane26_afm_probe_binary_path}" | /usr/bin/awk '{print $1}')" \
      == "${lane26_afm_probe_binary_sha256}" ]]
[[ "$(/usr/bin/shasum -a 256 "${lane27}/platform-verifier-result.json" | /usr/bin/awk '{print $1}')" \
      == "${lane27_platform_result_sha256}" ]]
[[ "$(/usr/bin/shasum -a 256 "${lane27}/swift-test.log" | /usr/bin/awk '{print $1}')" \
      == "${lane27_test_log_sha256}" ]]
[[ "$(/usr/bin/shasum -a 256 "${lane27_crash_probe_binary_path}" | /usr/bin/awk '{print $1}')" \
      == "${lane27_crash_probe_binary_sha256}" ]]
[[ "$(/usr/bin/shasum -a 256 "${lane27}/swift-release-build.log" | /usr/bin/awk '{print $1}')" \
      == "${lane27_release_build_log_sha256}" \
   && "$(/usr/bin/shasum -a 256 "${lane27}/x86_64-negative-compile.log" | /usr/bin/awk '{print $1}')" \
      == "${lane27_x86_log_sha256}" \
   && "$(/usr/bin/shasum -a 256 "${lane27}/non-macos-negative-compile.log" | /usr/bin/awk '{print $1}')" \
      == "${lane27_nonmac_log_sha256}" \
   && "$(/usr/bin/shasum -a 256 "${lane27_product_binary_path}" | /usr/bin/awk '{print $1}')" \
      == "${lane27_product_binary_sha256}" \
   && "$(/usr/bin/shasum -a 256 "${lane27_afm_probe_binary_path}" | /usr/bin/awk '{print $1}')" \
      == "${lane27_afm_probe_binary_sha256}" ]]

for close_helper in "${lane26_crash_probe_binary_path}" "${lane27_crash_probe_binary_path}"; do
  [[ -x "${close_helper}" \
     && "$(/usr/bin/stat -f '%u' "${close_helper}")" == "$(/usr/bin/id -u)" \
     && "$(/usr/bin/stat -f '%l' "${close_helper}")" == '1' \
     && "$(( 8#$(/usr/bin/stat -f '%Lp' "${close_helper}") & 8#022 ))" == '0' \
     && "$(( 8#$(/usr/bin/stat -f '%Lp' "${close_helper}") & 8#100 ))" != '0' \
     && "$(/usr/bin/stat -f '%z' "${close_helper}")" -gt 8 \
     && "$(/usr/bin/stat -f '%z' "${close_helper}")" -le 67108864 \
     && "$(/usr/bin/file -b "${close_helper}")" == *Mach-O* \
     && "$(/usr/bin/file -b "${close_helper}")" == *executable* \
     && "$(/usr/bin/file -b "${close_helper}")" == *arm64* \
     && "$("${comparison_lipo_tool}" -archs "${close_helper}")" == 'arm64' ]]
done
for close_release_binary in \
  "${lane26_product_binary_path}" "${lane26_afm_probe_binary_path}" \
  "${lane27_product_binary_path}" "${lane27_afm_probe_binary_path}"; do
  [[ -x "${close_release_binary}" \
     && "$("${comparison_lipo_tool}" -archs "${close_release_binary}")" == 'arm64' ]]
done
[[ "$(veritas_cr09_binding_helper_sha256 "${lane26}/machine-evidence.log")" \
      == "${lane26_crash_probe_binary_sha256}" \
   && "$(veritas_cr09_binding_frame_sha256 "${lane26}/machine-evidence.log")" \
      == "${lane26_cr09_binding_frame_sha256}" \
   && "$(/usr/bin/jq -r '.crash_probe_binary_path' \
      "${lane26}/platform-verifier-result.json")" \
      == "${lane26_crash_probe_binary_path}" ]]
[[ "$(veritas_cr09_binding_helper_sha256 "${lane27}/machine-evidence.log")" \
      == "${lane27_crash_probe_binary_sha256}" \
   && "$(veritas_cr09_binding_frame_sha256 "${lane27}/machine-evidence.log")" \
      == "${lane27_cr09_binding_frame_sha256}" \
   && "$(/usr/bin/jq -r '.crash_probe_binary_path' \
      "${lane27}/platform-verifier-result.json")" \
      == "${lane27_crash_probe_binary_path}" ]]
veritas_validate_baseline_b_log \
  "${lane26}/swift-test.log" "${lane26}/machine-evidence.log" "${lane26_crash_probe_binary_sha256}"
veritas_validate_cr09_parser_negative_receipt \
  "${lane26}/cr09-parser-negative.receipt" "${lane26}/swift-test.log" "${lane26}/machine-evidence.log" \
  "${checkpoint_control_helper}" "${parser_negative_helper}"
veritas_validate_baseline_b_log \
  "${lane27}/swift-test.log" "${lane27}/machine-evidence.log" "${lane27_crash_probe_binary_sha256}"
veritas_validate_cr09_parser_negative_receipt \
  "${lane27}/cr09-parser-negative.receipt" "${lane27}/swift-test.log" "${lane27}/machine-evidence.log" \
  "${checkpoint_control_helper}" "${parser_negative_helper}"
veritas_validate_test_transport_record "${lane26}/test-transport.json" "${lane26}"
veritas_validate_test_transport_record "${lane27}/test-transport.json" "${lane27}"
[[ "$(/usr/bin/shasum -a 256 "${lane26}/test-transport.json" | /usr/bin/awk '{print $1}')" == "${lane26_test_transport_sha256}" \
   && "$(/usr/bin/shasum -a 256 "${lane27}/test-transport.json" | /usr/bin/awk '{print $1}')" == "${lane27_test_transport_sha256}" ]]
[[ "$(/usr/bin/shasum -a 256 "${lane26}/swift-test.log" | /usr/bin/awk '{print $1}')" \
      == "${lane26_test_log_sha256}" \
   && "$(/usr/bin/shasum -a 256 "${lane27}/swift-test.log" | /usr/bin/awk '{print $1}')" \
      == "${lane27_test_log_sha256}" ]]

[[ "$(/usr/bin/shasum -a 256 "${lane26}/fi08-evidence.json" | /usr/bin/awk '{print $1}')" \
      == "${fi08_report26}" \
   && "$(/usr/bin/shasum -a 256 "${lane27}/fi08-evidence.json" | /usr/bin/awk '{print $1}')" \
      == "${fi08_report27}" \
   && "$(/usr/bin/shasum -a 256 "${lane26}/fi09-evidence.json" | /usr/bin/awk '{print $1}')" \
      == "${fi09_report26}" \
   && "$(/usr/bin/shasum -a 256 "${lane27}/fi09-evidence.json" | /usr/bin/awk '{print $1}')" \
      == "${fi09_report27}" \
   && "$(/usr/bin/shasum -a 256 "${afm26}/afm-functional-probe.json" | /usr/bin/awk '{print $1}')" \
      == "${afm_probe_output26}" \
   && "$(/usr/bin/shasum -a 256 "${afm27}/afm-functional-probe.json" | /usr/bin/awk '{print $1}')" \
      == "${afm_probe_output27}" ]]
[[ "$(/usr/bin/shasum -a 256 "${afm26}/afm-verifier-result.json" | /usr/bin/awk '{print $1}')" \
      == "$(/usr/bin/jq -r '.afm_evidence.verifier_result_sha256' \
        "${lane26}/platform-verifier-result.json")" \
   && "$(/usr/bin/shasum -a 256 "${afm27}/afm-verifier-result.json" | /usr/bin/awk '{print $1}')" \
      == "$(/usr/bin/jq -r '.afm_evidence.verifier_result_sha256' \
        "${lane27}/platform-verifier-result.json")" \
   && "$(/usr/bin/shasum -a 256 "${afm26}/afm-functional-probe.stderr.log" | /usr/bin/awk '{print $1}')" \
      == "$(/usr/bin/jq -r '.afm_evidence.probe_stderr_sha256' \
        "${lane26}/platform-verifier-result.json")" \
   && "$(/usr/bin/shasum -a 256 "${afm27}/afm-functional-probe.stderr.log" | /usr/bin/awk '{print $1}')" \
      == "$(/usr/bin/jq -r '.afm_evidence.probe_stderr_sha256' \
        "${lane27}/platform-verifier-result.json")" ]]
[[ "$(/usr/bin/shasum -a 256 /usr/bin/xcodebuild | /usr/bin/awk '{print $1}')" \
      == "${comparison_xcodebuild_sha256}" \
   && "$(/usr/bin/shasum -a 256 /usr/bin/xcrun | /usr/bin/awk '{print $1}')" \
      == "${comparison_xcrun_sha256}" \
   && "$(/usr/bin/shasum -a 256 "${comparison_lipo_tool}" | /usr/bin/awk '{print $1}')" \
      == "${comparison_lipo_tool_sha256}" \
   && "$(/usr/bin/shasum -a 256 "${comparison_otool_tool_resolved_path}" | /usr/bin/awk '{print $1}')" \
      == "${comparison_otool_tool_sha256}" ]]

# The source tree and pending comparison bytes close last. The final hard link
# is no-clobber and preserves exactly the validated pending inode.
veritas_build_source_manifest "${package_dir}" > "${final_source_manifest}"
for close_manifest in \
  "${batch_source_manifest}" "${final_source_manifest}" \
  "${lane26}/source-manifest.sha256" "${lane27}/source-manifest.sha256" \
  "${afm26}/source-manifest.sha256" "${afm27}/source-manifest.sha256"; do
  [[ -f "${close_manifest}" && ! -L "${close_manifest}" ]]
  cmp -s "${batch_source_manifest}" "${close_manifest}"
  [[ "$(/usr/bin/shasum -a 256 "${close_manifest}" | /usr/bin/awk '{print $1}')" \
       == "${source26}" ]]
done
[[ -f "${batch_contract}" && ! -L "${batch_contract}" \
   && "$(/usr/bin/shasum -a 256 "${batch_contract}" | /usr/bin/awk '{print $1}')" \
      == "${batch_contract_sha256}" \
   && "$(/usr/bin/stat -f '%d:%i' "${comparison_result_pending}")" \
      == "${comparison_result_pending_identity}" \
   && "$(/usr/bin/shasum -a 256 "${comparison_result_pending}" | /usr/bin/awk '{print $1}')" \
      == "${comparison_result_pending_sha256}" \
   && ! -e "${comparison_result}" ]]
/bin/ln "${comparison_result_pending}" "${comparison_result}"
if [[ "$(/usr/bin/stat -f '%d:%i' "${comparison_result}")" \
         == "${comparison_result_pending_identity}" \
      && "$(/usr/bin/shasum -a 256 "${comparison_result}" | /usr/bin/awk '{print $1}')" \
         == "${comparison_result_pending_sha256}" \
      && "$(/usr/bin/stat -f '%l' "${comparison_result}")" == '2' \
      && "$(/usr/bin/jq -s 'length' "${comparison_result}")" == '1' ]] \
   && cmp -s "${comparison_result}" <(/usr/bin/jq -cS . "${comparison_result}"); then
  :
else
  /bin/rm -f -- "${comparison_result}"
  exit 1
fi
/bin/rm -f -- "${comparison_result_pending}"
if [[ "$(/usr/bin/stat -f '%d:%i' "${comparison_result}")" \
         == "${comparison_result_pending_identity}" \
      && "$(/usr/bin/shasum -a 256 "${comparison_result}" | /usr/bin/awk '{print $1}')" \
         == "${comparison_result_pending_sha256}" \
      && "$(/usr/bin/stat -f '%l' "${comparison_result}")" == '1' ]] \
   && cmp -s "${comparison_result}" <(/usr/bin/jq -cS . "${comparison_result}"); then
  :
else
  /bin/rm -f -- "${comparison_result}"
  exit 1
fi
/usr/bin/jq -cS . "${comparison_result}"
