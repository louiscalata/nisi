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
expected_sdk="${VERITAS_EXPECTED_BUILD_SDK:-26.5}"
expected_test_count=470
expected_suite_count=37
case "${expected_sdk}" in
  26.5)
    expected_xcode="26.6"
    expected_xcode_build="17F113"
    expected_swift="6.3.3"
    expected_developer_dir="/Applications/Xcode.app/Contents/Developer"
    expected_sdk_path="/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.5.sdk"
    expected_test_breakdown="470/37"
    lane_id="xcode-26.6_swift-6.3.3_sdk-26.5"
    ;;
  27.0)
    expected_xcode="27.0"
    expected_xcode_build="27A5228h"
    expected_swift="6.4"
    expected_developer_dir="/Applications/Xcode-27.0.app/Contents/Developer"
    expected_sdk_path="/Applications/Xcode-27.0.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX27.0.sdk"
    expected_test_breakdown="347/30,26/2,97/5"
    lane_id="xcode-27.0_swift-6.4_sdk-27.0"
    ;;
  *)
    print -u2 "Unsupported Veritas platform lane: ${expected_sdk}"
    exit 1
    ;;
esac
expected_binary_sdk="27.0"
comparison_batch_id="${VERITAS_PLATFORM_COMPARISON_BATCH_ID:?Set one fresh 32-character lowercase hexadecimal comparison batch ID.}"
grep -Eq '^[0-9a-f]{32}$' <<< "${comparison_batch_id}"
batch_root="${scratch_root}/runs/${comparison_batch_id}"
batch_contract="${batch_root}/batch-contract.json"
batch_source_manifest="${batch_root}/source-manifest.sha256"
lane_root="${batch_root}/${lane_id}"
lane26_id="xcode-26.6_swift-6.3.3_sdk-26.5"
lane27_id="xcode-27.0_swift-6.4_sdk-27.0"
source_manifest_algorithm="${VERITAS_SOURCE_MANIFEST_ALGORITHM}"

[[ -d "${batch_root}" ]]
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

preflight_source_manifest="$(mktemp /private/tmp/veritas-platform-source-manifest.XXXXXX)"
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
swiftc_tool="$("${xcrun_tool}" --find swiftc)"
expected_swift_tool="${developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift"
expected_swiftc_tool="${developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc"
[[ "${swift_tool}" == "${expected_swift_tool}" ]]
[[ "${swiftc_tool}" == "${expected_swiftc_tool}" ]]
[[ -L "${swift_tool}" ]]
[[ -L "${swiftc_tool}" ]]
swift_tool_symlink_target="$(/usr/bin/readlink "${swift_tool}")"
swiftc_tool_symlink_target="$(/usr/bin/readlink "${swiftc_tool}")"
[[ "${swift_tool_symlink_target}" == "swift-frontend" ]]
[[ "${swiftc_tool_symlink_target}" == "swift-frontend" ]]
swift_tool_resolved_path="${swift_tool:A}"
swiftc_tool_resolved_path="${swiftc_tool:A}"
expected_swift_tool_resolved_path="${developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-frontend"
expected_swiftc_tool_resolved_path="${developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-frontend"
[[ "${swift_tool_resolved_path}" == "${expected_swift_tool_resolved_path}" ]]
[[ "${swiftc_tool_resolved_path}" == "${expected_swiftc_tool_resolved_path}" ]]
[[ -f "${swift_tool_resolved_path}" && ! -L "${swift_tool_resolved_path}" ]]
[[ -f "${swiftc_tool_resolved_path}" && ! -L "${swiftc_tool_resolved_path}" ]]
xcodebuild_tool_sha256="$(shasum -a 256 "${xcodebuild_tool}" | awk '{print $1}')"
xcrun_tool_sha256="$(shasum -a 256 "${xcrun_tool}" | awk '{print $1}')"
swift_tool_sha256="$(shasum -a 256 "${swift_tool}" | awk '{print $1}')"
swiftc_tool_sha256="$(shasum -a 256 "${swiftc_tool}" | awk '{print $1}')"

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

[[ ! -e "${lane_root}" ]]
mkdir "${lane_root}"
test_scratch="${lane_root}/swift-test"
release_scratch="${lane_root}/swift-release"
evidence_dir="${lane_root}/evidence"

mkdir "${test_scratch}" "${release_scratch}" "${evidence_dir}"

manifest_json="${evidence_dir}/dump-package.json"
test_log="${evidence_dir}/swift-test.log"
machine_evidence="${evidence_dir}/machine-evidence.log"
parser_receipt="${evidence_dir}/cr09-parser-negative.receipt"
test_transport="${evidence_dir}/test-transport.json"
for transport_file in "${test_log}" "${machine_evidence}" "${parser_receipt}"; do
  [[ ! -e "${transport_file}" && ! -L "${transport_file}" ]]
  (set -o noclobber; : > "${transport_file}")
  [[ "$(/usr/bin/stat -f '%HT|%u|%Lp|%l|%z' "${transport_file}")" \
       == "Regular File|$(/usr/bin/id -u)|600|1|0" ]]
done
test_log_identity="$(/usr/bin/stat -f '%d:%i' "${test_log}")"
machine_evidence_identity="$(/usr/bin/stat -f '%d:%i' "${machine_evidence}")"
parser_receipt_identity="$(/usr/bin/stat -f '%d:%i' "${parser_receipt}")"
crash_probe_build_log="${evidence_dir}/ledger-crash-probe-build.log"
fi08_evidence_json="${evidence_dir}/fi08-evidence.json"
fi08_canonical_json="${evidence_dir}/fi08-evidence.canonical.json"
fi09_evidence_json="${evidence_dir}/fi09-evidence.json"
fi09_canonical_json="${evidence_dir}/fi09-evidence.canonical.json"
result_json="${evidence_dir}/platform-verifier-result.json"
result_pending="${evidence_dir}/platform-verifier-result.json.pending"
release_build_log="${evidence_dir}/swift-release-build.log"
x86_log="${evidence_dir}/x86_64-negative-compile.log"
nonmac_log="${evidence_dir}/non-macos-negative-compile.log"
source_manifest="${evidence_dir}/source-manifest.sha256"
source_manifest_post="${evidence_dir}/source-manifest.post.sha256"

build_source_manifest > "${source_manifest}"
cmp -s "${batch_source_manifest}" "${source_manifest}"
source_manifest_sha256="$(shasum -a 256 "${source_manifest}" | awk '{print $1}')"
[[ "${source_manifest_sha256}" == "${batch_source_manifest_sha256}" ]]

"${swift_tool}" package --package-path "${package_dir}" dump-package > "${manifest_json}"
grep -Fq '"platformName" : "macos"' "${manifest_json}"
grep -Fq '"version" : "27.0"' "${manifest_json}"

"${swift_tool}" build \
  --package-path "${package_dir}" \
  --disable-sandbox \
  --scratch-path "${test_scratch}" \
  --product VeritasLedgerCrashProbe > "${crash_probe_build_log}" 2>&1
[[ -s "${crash_probe_build_log}" ]]
test_bin_path="$("${swift_tool}" build \
  --package-path "${package_dir}" \
  --disable-sandbox \
  --scratch-path "${test_scratch}" \
  --show-bin-path)"
test_bin_path="${test_bin_path:A}"
crash_probe_binary="${test_bin_path}/VeritasLedgerCrashProbe"
[[ "${test_bin_path}" == "${test_scratch}/"* \
   && -f "${crash_probe_binary}" && ! -L "${crash_probe_binary}" \
   && -x "${crash_probe_binary}" \
   && "$(/usr/bin/stat -f '%u' "${crash_probe_binary}")" == "$(/usr/bin/id -u)" \
   && "$(/usr/bin/stat -f '%l' "${crash_probe_binary}")" == "1" \
   && "$(( 8#$(/usr/bin/stat -f '%Lp' "${crash_probe_binary}") & 8#022 ))" == "0" \
   && "$(( 8#$(/usr/bin/stat -f '%Lp' "${crash_probe_binary}") & 8#100 ))" != "0" \
   && "$(/usr/bin/stat -f '%z' "${crash_probe_binary}")" -gt 8 \
   && "$(/usr/bin/stat -f '%z' "${crash_probe_binary}")" -le 67108864 \
   && "$(/usr/bin/file -b "${crash_probe_binary}")" == *Mach-O* \
   && "$(/usr/bin/file -b "${crash_probe_binary}")" == *executable* \
   && "$(/usr/bin/file -b "${crash_probe_binary}")" == *arm64* \
   && "$("${xcrun_tool}" lipo -archs "${crash_probe_binary}")" == 'arm64' ]]
crash_probe_binary_identity="$(/usr/bin/stat -f '%d:%i' "${crash_probe_binary}")"
crash_probe_binary_sha256="$(shasum -a 256 "${crash_probe_binary}" | awk '{print $1}')"
grep -Eq '^[0-9a-f]{64}$' <<< "${crash_probe_binary_sha256}"
cp "${crash_probe_build_log}" "${test_log}"
[[ "$(/usr/bin/stat -f '%d:%i' "${test_log}")" == "${test_log_identity}" ]]
VERITAS_LEDGER_CRASH_PROBE_PATH="${crash_probe_binary}" \
VERITAS_LEDGER_CRASH_PROBE_SHA256="${crash_probe_binary_sha256}" \
VERITAS_TEST_EVIDENCE_PATH="${machine_evidence}" \
VERITAS_TEST_EVIDENCE_DEVICE="${machine_evidence_identity%%:*}" \
VERITAS_TEST_EVIDENCE_INODE="${machine_evidence_identity#*:}" \
"${swift_tool}" test \
  --package-path "${package_dir}" \
  --scratch-path "${test_scratch}" >> "${test_log}" 2>&1
[[ "$(shasum -a 256 "${crash_probe_binary}" | awk '{print $1}')" \
   == "${crash_probe_binary_sha256}" ]]
test_totals="$(awk '
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
' "${test_log}")"
IFS=$'\t' read -r observed_test_count observed_suite_count test_summary_count observed_test_breakdown <<< "${test_totals}"
[[ "${observed_test_count}" == "${expected_test_count}" ]]
[[ "${observed_suite_count}" == "${expected_suite_count}" ]]
[[ "${observed_test_breakdown}" == "${expected_test_breakdown}" ]]
abrupt_restart_title='Abrupt helper termination preserves only complete observation transactions'
abrupt_restart_summary_count="$(awk -v title="${abrupt_restart_title}" '
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
  [[ "$(awk -v expected="${abrupt_restart_case_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${test_log}")" == "1" ]]
done
veritas_transport_file_record "${test_log}" 4194304 "${test_log_identity}" > /dev/null
veritas_transport_file_record "${machine_evidence}" 4194304 "${machine_evidence_identity}" > /dev/null
veritas_validate_checkpoint_control_log "${test_log}" "${machine_evidence}"
veritas_validate_baseline_b_log "${test_log}" "${machine_evidence}" "${crash_probe_binary_sha256}"
[[ "$(veritas_cr09_binding_helper_sha256 "${machine_evidence}")" \
   == "${crash_probe_binary_sha256}" ]]
cr09_binding_frame_sha256="$(veritas_cr09_binding_frame_sha256 "${machine_evidence}")"
grep -Eq '^[0-9a-f]{64}$' <<< "${cr09_binding_frame_sha256}"
parser_negative_result="$(/bin/zsh "${parser_negative_helper}" \
  "${test_log}" "${machine_evidence}" "${crash_probe_binary_sha256}")"
print -r -- "${parser_negative_result}" > "${parser_receipt}"
veritas_validate_cr09_parser_negative_receipt \
  "${parser_receipt}" "${test_log}" "${machine_evidence}" \
  "${checkpoint_control_helper}" "${parser_negative_helper}"
veritas_build_test_transport_record "${evidence_dir}" "${test_log_identity}" \
  "${machine_evidence_identity}" "${parser_receipt_identity}" > "${test_transport}"
veritas_validate_test_transport_record "${test_transport}" "${evidence_dir}"
if [[ "${test_summary_count}" == "1" ]]; then
  test_summary="${observed_test_count} tests in ${observed_suite_count} suites passed across 1 terminal test-run summary"
else
  test_summary="${observed_test_count} tests in ${observed_suite_count} suites passed across ${test_summary_count} terminal test-run summaries"
fi

fi08_marker='VERITAS_FI08_EVIDENCE_JSON '
fi08_evidence_count="$(awk -v marker="${fi08_marker}" '
  index($0, marker) { count += 1 }
  END { print count + 0 }
' "${machine_evidence}")"
[[ "${fi08_evidence_count}" == "1" ]]
awk -v marker="${fi08_marker}" '
  index($0, marker) {
    print substr($0, index($0, marker) + length(marker))
  }
' "${machine_evidence}" > "${fi08_evidence_json}"
[[ "$(wc -l < "${fi08_evidence_json}" | tr -d ' ')" == "1" ]]
/usr/bin/jq -cS . "${fi08_evidence_json}" > "${fi08_canonical_json}"
cmp -s "${fi08_evidence_json}" "${fi08_canonical_json}"
/usr/bin/jq -e '
  type == "object" and
  keys == [
    "actorAuthoritySupported",
    "authorizing",
    "bindingRefusalCount",
    "canonicalRoundTrip",
    "certificationInfluence",
    "digestMismatchRefused",
    "duplicateKeyRefused",
    "durableRunProvenance",
    "envelopeDigest",
    "fi04Accepted",
    "fi08Accepted",
    "finalPrimaryLedgerEventCount",
    "finalSubstitutedLedgerEventCount",
    "forkReconciliationSupported",
    "highWatermarkSupported",
    "independentCertification",
    "malformedEnvelopeRefusalCount",
    "mutatedBindings",
    "physicalDiskFullTested",
    "positiveAppendCount",
    "productIntegratedRawEnvelope",
    "profile",
    "promotionInfluence",
    "promptInfluence",
    "protectedAuthoritySupported",
    "publicUnvalidatedLedgerWriteExposed",
    "rawEnvelopeEntryPointReached",
    "repairInfluence",
    "resultEvidenceDigest",
    "schemaVersion",
    "scopeRefusalCount",
    "snapshotterAdmissionUsed",
    "status",
    "unsupportedCapabilityRefusalCount"
  ] and
  .schemaVersion == 1 and
  .profile == "veritas-fi08-transient-core-admission-v1" and
  .status == "PASS_PRIVATE_FI08_TRANSIENT_CORE_ADMISSION_AND_UNSUPPORTED_REFUSAL_SLICE_ONLY" and
  ([.envelopeDigest, .resultEvidenceDigest] | all(type == "string" and test("^[0-9a-f]{64}$"))) and
  .snapshotterAdmissionUsed == true and
  .rawEnvelopeEntryPointReached == true and
  .canonicalRoundTrip == true and
  .positiveAppendCount == 1 and
  .finalPrimaryLedgerEventCount == 1 and
  .finalSubstitutedLedgerEventCount == 0 and
  .bindingRefusalCount == 8 and
  .scopeRefusalCount == 4 and
  .unsupportedCapabilityRefusalCount == 8 and
  .malformedEnvelopeRefusalCount == 7 and
  .digestMismatchRefused == true and
  .duplicateKeyRefused == true and
  .mutatedBindings == [
    "ACCESS_POLICY",
    "ACTOR_AUTHORITY_STATUS",
    "FORK_RECONCILIATION_STATUS",
    "HIGH_WATERMARK_STATUS",
    "MODE",
    "OBSERVED_AT",
    "PROFILE_ID_AND_FINGERPRINT",
    "PROJECT",
    "PROTECTED_AUTHORITY_STATUS",
    "RESULT_AND_EVIDENCE_SET",
    "RETENTION_POLICY",
    "RETENTION_REVIEW_AT",
    "RUN",
    "SUBJECT_CONTENT_AND_ID",
    "SUBJECT_TYPE_AND_ID"
  ] and
  .actorAuthoritySupported == false and
  .protectedAuthoritySupported == false and
  .highWatermarkSupported == false and
  .forkReconciliationSupported == false and
  .durableRunProvenance == false and
  .productIntegratedRawEnvelope == false and
  .publicUnvalidatedLedgerWriteExposed == false and
  .physicalDiskFullTested == false and
  .authorizing == false and
  .promptInfluence == false and
  .repairInfluence == false and
  .promotionInfluence == false and
  .certificationInfluence == false and
  .independentCertification == false and
  .fi08Accepted == false and
  .fi04Accepted == false
' "${fi08_evidence_json}" > /dev/null

fi09_marker='VERITAS_FI09_EVIDENCE_JSON '
fi09_evidence_count="$(awk -v marker="${fi09_marker}" '
  index($0, marker) { count += 1 }
  END { print count + 0 }
' "${machine_evidence}")"
[[ "${fi09_evidence_count}" == "1" ]]
awk -v marker="${fi09_marker}" '
  index($0, marker) {
    print substr($0, index($0, marker) + length(marker))
  }
' "${machine_evidence}" > "${fi09_evidence_json}"
[[ "$(wc -l < "${fi09_evidence_json}" | tr -d ' ')" == "1" ]]
/usr/bin/jq -cS . "${fi09_evidence_json}" > "${fi09_canonical_json}"
cmp -s "${fi09_evidence_json}" "${fi09_canonical_json}"

/usr/bin/jq -e '
  type == "object" and
  keys == [
    "allInfluenceFlagsFalse",
    "allOutageEvidenceIdentical",
    "artifactDigest",
    "authorizing",
    "certifiedStatusPossible",
    "corruptInventoryUnchanged",
    "independentCertification",
    "negativeControlChanged",
    "negativeControlDigest",
    "outageScenarioReceipts",
    "positiveControlEvidenceIdentical",
    "positiveControlPersistedEventCount",
    "positiveControlReceipt",
    "productionUncertifiedRecordProducerPresent",
    "profile",
    "resultEvidenceDigest",
    "scenarioCount",
    "scenarioIDs",
    "schemaVersion",
    "slowLateOpenEventCount",
    "slowLateOpenedLedgerClosed",
    "slowLateOpenedLedgerObserved",
    "status",
    "storeFullFaultCallbackCount",
    "storeFullInjectedFaultCount",
    "storeFullRollbackEventCount",
    "storeFullRollbackStateRestored",
    "uncertifiedRecordDigest"
  ] and
  .schemaVersion == 1 and
  .profile == "veritas-fi09-native-baseline-invariance-v1" and
  .status == "PASS_PRIVATE_NATIVE_BASELINE_INVARIANCE_ONLY" and
  .scenarioCount == 8 and
  .scenarioIDs == [
    "DISABLED_HISTORY",
    "ABSENT_CONFIGURATION",
    "MALFORMED_CONFIGURATION",
    "CORRUPT_DATABASE",
    "SLOW_BUDGET_EXCEEDED",
    "UNAVAILABLE_STORAGE",
    "STORE_FULL",
    "UNEXPECTED_THROW"
  ] and
  .outageScenarioReceipts == [
    {
      "availability":"DISABLED",
      "faultCallbackCount":0,
      "historyCount":0,
      "influenceFlagsAllFalse":true,
      "injectedFaultCount":0,
      "openerCallCount":0,
      "reason":"INCIDENT_HISTORY_USER_DISABLED",
      "scenarioID":"DISABLED_HISTORY"
    },
    {
      "availability":"REFUSED",
      "faultCallbackCount":0,
      "historyCount":0,
      "influenceFlagsAllFalse":true,
      "injectedFaultCount":0,
      "openerCallCount":0,
      "reason":"INCIDENT_HISTORY_CONFIGURATION_INVALID",
      "scenarioID":"ABSENT_CONFIGURATION"
    },
    {
      "availability":"REFUSED",
      "faultCallbackCount":0,
      "historyCount":0,
      "influenceFlagsAllFalse":true,
      "injectedFaultCount":0,
      "openerCallCount":0,
      "reason":"INCIDENT_HISTORY_CONFIGURATION_INVALID",
      "scenarioID":"MALFORMED_CONFIGURATION"
    },
    {
      "availability":"REFUSED",
      "faultCallbackCount":0,
      "historyCount":0,
      "influenceFlagsAllFalse":true,
      "injectedFaultCount":0,
      "openerCallCount":1,
      "reason":"INCIDENT_HISTORY_INTEGRITY_REFUSED",
      "scenarioID":"CORRUPT_DATABASE"
    },
    {
      "availability":"UNAVAILABLE",
      "faultCallbackCount":0,
      "historyCount":0,
      "influenceFlagsAllFalse":true,
      "injectedFaultCount":0,
      "openerCallCount":1,
      "reason":"INCIDENT_HISTORY_OPEN_UNCERTAIN",
      "scenarioID":"SLOW_BUDGET_EXCEEDED"
    },
    {
      "availability":"UNAVAILABLE",
      "faultCallbackCount":0,
      "historyCount":0,
      "influenceFlagsAllFalse":true,
      "injectedFaultCount":0,
      "openerCallCount":1,
      "reason":"INCIDENT_HISTORY_STORAGE_UNAVAILABLE",
      "scenarioID":"UNAVAILABLE_STORAGE"
    },
    {
      "availability":"UNAVAILABLE",
      "captureReason":"INCIDENT_LEDGER_WRITE_FAILED",
      "captureStatus":"UNAVAILABLE",
      "faultCallbackCount":2,
      "historyCount":0,
      "influenceFlagsAllFalse":true,
      "injectedFaultCount":1,
      "openerCallCount":1,
      "reason":"INCIDENT_HISTORY_STORAGE_UNAVAILABLE",
      "scenarioID":"STORE_FULL"
    },
    {
      "availability":"UNAVAILABLE",
      "faultCallbackCount":0,
      "historyCount":0,
      "influenceFlagsAllFalse":true,
      "injectedFaultCount":0,
      "openerCallCount":1,
      "reason":"INCIDENT_HISTORY_STORAGE_UNAVAILABLE",
      "scenarioID":"UNEXPECTED_THROW"
    }
  ] and
  .positiveControlReceipt == {
    "availability":"AVAILABLE — LOCAL ONLY",
    "captureStatus":"APPENDED",
    "faultCallbackCount":0,
    "historyCount":1,
    "influenceFlagsAllFalse":true,
    "injectedFaultCount":0,
    "openerCallCount":1,
    "scenarioID":"POSITIVE_CAPTURE_CONTROL"
  } and
  (.artifactDigest | test("^[0-9a-f]{64}$")) and
  (.resultEvidenceDigest | test("^[0-9a-f]{64}$")) and
  (.uncertifiedRecordDigest | test("^[0-9a-f]{64}$")) and
  (.negativeControlDigest | test("^[0-9a-f]{64}$")) and
  .negativeControlDigest != .uncertifiedRecordDigest and
  .allOutageEvidenceIdentical == true and
  .positiveControlEvidenceIdentical == true and
  .negativeControlChanged == true and
  .slowLateOpenEventCount == 0 and
  .slowLateOpenedLedgerObserved == true and
  .slowLateOpenedLedgerClosed == true and
  .storeFullFaultCallbackCount == 2 and
  .storeFullInjectedFaultCount == 1 and
  .storeFullRollbackEventCount == 0 and
  .storeFullRollbackStateRestored == true and
  .corruptInventoryUnchanged == true and
  .positiveControlPersistedEventCount == 1 and
  .allInfluenceFlagsFalse == true and
  .productionUncertifiedRecordProducerPresent == true and
  .certifiedStatusPossible == false and
  .independentCertification == false and
  .authorizing == false
' "${fi09_evidence_json}" > /dev/null

"${swift_tool}" build -c release \
  --product "Codename Veritas Framework" \
  --package-path "${package_dir}" \
  --scratch-path "${release_scratch}" > "${release_build_log}" 2>&1
"${swift_tool}" build -c release \
  --product "Veritas AFM Functional Probe" \
  --package-path "${package_dir}" \
  --scratch-path "${release_scratch}" >> "${release_build_log}" 2>&1

release_bin_path="$("${swift_tool}" build -c release \
  --product "Codename Veritas Framework" \
  --package-path "${package_dir}" \
  --scratch-path "${release_scratch}" \
  --show-bin-path)"
release_bin_relative="${release_bin_path#${release_scratch}/}"
[[ "${release_bin_relative}" != "${release_bin_path}" ]]
case "${release_bin_relative}" in
  arm64-apple-macosx/release) release_bin_layout="SWIFTPM_TRIPLE_RELEASE" ;;
  out/Products/Release) release_bin_layout="SWIFTPM_XCBUILD_PRODUCTS_RELEASE" ;;
  *) exit 1 ;;
esac
product_binary="${release_bin_path}/Codename Veritas Framework"
afm_probe_binary="${release_bin_path}/Veritas AFM Functional Probe"
release_symlink_count="$(
  /usr/bin/find "${release_bin_path}" -type l \
    -exec /usr/bin/printf x \; \
    | /usr/bin/wc -c \
    | /usr/bin/tr -d '[:space:]'
)"
[[ "${release_symlink_count}" == "0" ]]
release_special_count="$(
  /usr/bin/find "${release_bin_path}" \
    ! -type d ! -type f ! -type l \
    -exec /usr/bin/printf x \; \
    | /usr/bin/wc -c \
    | /usr/bin/tr -d '[:space:]'
)"
[[ "${release_special_count}" == "0" ]]
release_executable_names=()
while IFS= read -r -d $'\0' candidate; do
  [[ -f "${candidate}" && ! -L "${candidate}" ]]
  if [[ -x "${candidate}" ]]; then
    candidate_relative="${candidate#${release_bin_path}/}"
    [[ "${candidate_relative}" != "${candidate}" && "${candidate_relative}" != /* ]]
    file_description="$(/usr/bin/file -b "${candidate}")"
    [[ "${file_description}" == *Mach-O* && "${file_description}" == *executable* ]]
    release_executable_names+=("${candidate_relative}")
  fi
done < <(/usr/bin/find "${release_bin_path}" -type f -print0)
release_executable_names=("${(@o)release_executable_names}")
[[ "${(j:|:)release_executable_names}" == "Codename Veritas Framework|Veritas AFM Functional Probe" ]]
release_executable_count="${#release_executable_names}"
[[ "${release_executable_count}" == "2" ]]
for binary in "${product_binary}" "${afm_probe_binary}"; do
  [[ -f "${binary}" ]]
  [[ "$("${xcrun_tool}" lipo -archs "${binary}")" == "arm64" ]]
  load_commands="$("${xcrun_tool}" otool -l "${binary}")"
  grep -Fq '    minos 27.0' <<< "${load_commands}"
  grep -Fq "      sdk ${expected_binary_sdk}" <<< "${load_commands}"
done

VERITAS_PLATFORM_SCRATCH_PATH="${scratch_root}" \
VERITAS_PLATFORM_COMPARISON_BATCH_ID="${comparison_batch_id}" \
VERITAS_EXPECTED_BUILD_SDK="${expected_sdk}" \
VERITAS_AFM_PROBE_BINARY="${afm_probe_binary}" \
  "${script_dir}/verify-afm-orchestration.zsh" > /dev/null

afm_evidence_dir="${lane_root}/afm"
afm_probe_json="${afm_evidence_dir}/afm-functional-probe.json"
afm_probe_stderr="${afm_evidence_dir}/afm-functional-probe.stderr.log"
afm_source_manifest="${afm_evidence_dir}/source-manifest.sha256"
afm_verifier_result="${afm_evidence_dir}/afm-verifier-result.json"
[[ -f "${afm_probe_json}" ]]
[[ -f "${afm_probe_stderr}" ]]
[[ -f "${afm_source_manifest}" ]]
[[ -f "${afm_verifier_result}" ]]
[[ "$(/usr/bin/jq -s 'length' "${afm_verifier_result}")" == "1" ]]
cmp -s "${afm_verifier_result}" <(/usr/bin/jq -cS . "${afm_verifier_result}")
/usr/bin/jq -e \
  --arg batch "${comparison_batch_id}" \
  --arg lane "${lane_id}" \
  --arg contract_sha256 "${batch_contract_sha256}" \
  --arg source_sha256 "${source_manifest_sha256}" \
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
  --arg expected_xcode_build "${expected_xcode_build}" \
  --arg expected_swift "${expected_swift}" \
  --arg expected_sdk "${expected_sdk}" '
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
  .lane_id == $lane and
  .batch_contract_sha256 == $contract_sha256 and
  .source_manifest_sha256 == $source_sha256 and
  .developer_dir == $developer_dir and
  .swift_tool_path == $swift_tool_path and
  .swift_tool_resolved_path == $swift_tool_resolved_path and
  .swift_tool_sha256 == $swift_tool_sha256 and
  .swift_tool_symlink_target == $swift_tool_symlink_target and
  .sdk_path == $sdk_path and
  .sdk_resolved_path == $sdk_resolved_path and
  .sdk_settings_sha256 == $sdk_settings_sha256 and
  .sdk_symlink_target == $sdk_symlink_target and
  .xcodebuild_tool_sha256 == $xcodebuild_tool_sha256 and
  .xcrun_tool_sha256 == $xcrun_tool_sha256 and
  .expected_xcode == $expected_xcode and .observed_xcode == $expected_xcode and
  .expected_xcode_build == $expected_xcode_build and .observed_xcode_build == $expected_xcode_build and
  .expected_swift == $expected_swift and .observed_swift == $expected_swift and
  .expected_sdk == $expected_sdk and .observed_sdk == $expected_sdk and
  .probe_binary_sdk == "27.0" and
  .probe_exit_code == 0 and
  ([
    .probe_binary_sha256,
    .probe_output_sha256,
    .probe_stderr_sha256,
    .subject_digest,
    .profile_fingerprint,
    .advisory_receipt_digest,
    .runtime_fingerprint
  ] | all(type == "string" and test("^[0-9a-f]{64}$"))) and
  .model_identity_status == "MODEL_ID_NOT_EXPOSED_BY_API" and
  .raw_artifact_persisted == false and
  .transcript_persisted == false and
  .external_tools_enabled == false and
  .acceptance_authority_granted == false and
  .independent_certification == false and
  .authorizing == false
' "${afm_verifier_result}" > /dev/null
[[ "$(/usr/bin/jq -r '.probe_binary_sha256' "${afm_verifier_result}")" == "$(shasum -a 256 "${afm_probe_binary}" | awk '{print $1}')" ]]
[[ "$(/usr/bin/jq -r '.probe_output_sha256' "${afm_verifier_result}")" == "$(shasum -a 256 "${afm_probe_json}" | awk '{print $1}')" ]]
[[ "$(/usr/bin/jq -r '.probe_stderr_sha256' "${afm_verifier_result}")" == "$(shasum -a 256 "${afm_probe_stderr}" | awk '{print $1}')" ]]
[[ ! -s "${afm_probe_stderr}" ]]
cmp -s "${batch_source_manifest}" "${afm_source_manifest}"

macos_sdk="$("${xcrun_tool}" --sdk macosx --show-sdk-path)"
platform_source="${package_dir}/Sources/VeritasCore/PlatformRequirements.swift"

set +e
"${swiftc_tool}" -typecheck \
  -target x86_64-apple-macosx27.0 \
  -sdk "${macos_sdk}" \
  "${platform_source}" > "${x86_log}" 2>&1
x86_status=$?
set -e
[[ ${x86_status} -ne 0 ]]
grep -Fq 'VERITAS_REQUIRES_APPLE_SILICON_ARM64' "${x86_log}"

ios_sdk="$("${xcrun_tool}" --sdk iphoneos --show-sdk-path)"
set +e
"${swiftc_tool}" -typecheck \
  -target arm64-apple-ios27.0 \
  -sdk "${ios_sdk}" \
  "${platform_source}" > "${nonmac_log}" 2>&1
nonmac_status=$?
set -e
[[ ${nonmac_status} -ne 0 ]]
grep -Fq 'VERITAS_REQUIRES_MACOS' "${nonmac_log}"

build_source_manifest > "${source_manifest_post}"
cmp -s "${source_manifest}" "${source_manifest_post}"
[[ "$(shasum -a 256 "${source_manifest_post}" | awk '{print $1}')" == "${source_manifest_sha256}" ]]
[[ -f "${crash_probe_binary}" && ! -L "${crash_probe_binary}" \
   && -x "${crash_probe_binary}" \
   && "$(/usr/bin/stat -f '%d:%i' "${crash_probe_binary}")" \
        == "${crash_probe_binary_identity}" \
   && "$(shasum -a 256 "${crash_probe_binary}" | awk '{print $1}')" \
        == "${crash_probe_binary_sha256}" ]]
product_binary_sha256="$(shasum -a 256 "${product_binary}" | awk '{print $1}')"
afm_probe_binary_sha256="$(shasum -a 256 "${afm_probe_binary}" | awk '{print $1}')"
afm_verifier_result_sha256="$(shasum -a 256 "${afm_verifier_result}" | awk '{print $1}')"
afm_probe_output_sha256="$(/usr/bin/jq -r '.probe_output_sha256' "${afm_verifier_result}")"
afm_probe_stderr_sha256="$(/usr/bin/jq -r '.probe_stderr_sha256' "${afm_verifier_result}")"
afm_probe_binary_sdk="$(/usr/bin/jq -r '.probe_binary_sdk' "${afm_verifier_result}")"
afm_subject_digest="$(/usr/bin/jq -r '.subject_digest' "${afm_verifier_result}")"
afm_profile_fingerprint="$(/usr/bin/jq -r '.profile_fingerprint' "${afm_verifier_result}")"
afm_advisory_receipt_digest="$(/usr/bin/jq -r '.advisory_receipt_digest' "${afm_verifier_result}")"
afm_runtime_fingerprint="$(/usr/bin/jq -r '.runtime_fingerprint' "${afm_verifier_result}")"
test_log_sha256="$(shasum -a 256 "${test_log}" | awk '{print $1}')"
veritas_validate_test_transport_record "${test_transport}" "${evidence_dir}"
test_transport_sha256="$(shasum -a 256 "${test_transport}" | awk '{print $1}')"
fi08_evidence_sha256="$(shasum -a 256 "${fi08_evidence_json}" | awk '{print $1}')"
fi08_envelope_digest="$(/usr/bin/jq -r '.envelopeDigest' "${fi08_evidence_json}")"
fi08_result_evidence_digest="$(/usr/bin/jq -r '.resultEvidenceDigest' "${fi08_evidence_json}")"
fi09_evidence_sha256="$(shasum -a 256 "${fi09_evidence_json}" | awk '{print $1}')"
fi09_artifact_digest="$(/usr/bin/jq -r '.artifactDigest' "${fi09_evidence_json}")"
fi09_result_evidence_digest="$(/usr/bin/jq -r '.resultEvidenceDigest' "${fi09_evidence_json}")"
fi09_uncertified_record_digest="$(/usr/bin/jq -r '.uncertifiedRecordDigest' "${fi09_evidence_json}")"
release_build_log_sha256="$(shasum -a 256 "${release_build_log}" | awk '{print $1}')"
x86_log_sha256="$(shasum -a 256 "${x86_log}" | awk '{print $1}')"
nonmac_log_sha256="$(shasum -a 256 "${nonmac_log}" | awk '{print $1}')"
actual_sdk="$("${xcrun_tool}" --sdk macosx --show-sdk-version)"
[[ "${actual_sdk}" == "${expected_sdk}" ]]
[[ ! -e "${result_pending}" && ! -e "${result_json}" ]]

/usr/bin/jq -cS -n \
  --arg comparison_batch_id "${comparison_batch_id}" \
  --arg lane_id "${lane_id}" \
  --arg declared_sdk "${expected_sdk}" \
  --arg observed_sdk "${actual_sdk}" \
  --arg expected_xcode "${expected_xcode}" \
  --arg observed_xcode "${observed_xcode}" \
  --arg expected_xcode_build "${expected_xcode_build}" \
  --arg observed_xcode_build "${observed_xcode_build}" \
  --arg expected_swift "${expected_swift}" \
  --arg observed_swift "${observed_swift}" \
  --arg sdk_path "${sdk_path}" \
  --arg sdk_resolved_path "${sdk_resolved_path}" \
  --arg sdk_settings_sha256 "${sdk_settings_sha256}" \
  --arg sdk_symlink_target "${sdk_symlink_target}" \
  --arg expected_binary_sdk "${expected_binary_sdk}" \
  --arg developer_dir "${developer_dir}" \
  --arg swift_tool_path "${swift_tool}" \
  --arg swift_tool_resolved_path "${swift_tool_resolved_path}" \
  --arg swift_tool_sha256 "${swift_tool_sha256}" \
  --arg swift_tool_symlink_target "${swift_tool_symlink_target}" \
  --arg swiftc_tool_path "${swiftc_tool}" \
  --arg swiftc_tool_resolved_path "${swiftc_tool_resolved_path}" \
  --arg swiftc_tool_sha256 "${swiftc_tool_sha256}" \
  --arg swiftc_tool_symlink_target "${swiftc_tool_symlink_target}" \
  --arg xcodebuild_tool_sha256 "${xcodebuild_tool_sha256}" \
  --arg xcrun_tool_sha256 "${xcrun_tool_sha256}" \
  --arg test_summary "${test_summary}" \
  --argjson expected_test_count "${expected_test_count}" \
  --argjson observed_test_count "${observed_test_count}" \
  --argjson expected_suite_count "${expected_suite_count}" \
  --argjson observed_suite_count "${observed_suite_count}" \
  --argjson terminal_test_run_summaries "${test_summary_count}" \
  --arg expected_test_breakdown "${expected_test_breakdown}" \
  --arg observed_test_breakdown "${observed_test_breakdown}" \
  --arg release_bin_layout "${release_bin_layout}" \
  --argjson release_executable_count "${release_executable_count}" \
  --arg batch_contract_sha256 "${batch_contract_sha256}" \
  --arg source_manifest_algorithm "${source_manifest_algorithm}" \
  --arg source_manifest_sha256 "${source_manifest_sha256}" \
  --arg product_binary_sha256 "${product_binary_sha256}" \
  --arg afm_probe_binary_sha256 "${afm_probe_binary_sha256}" \
  --arg afm_verifier_result_sha256 "${afm_verifier_result_sha256}" \
  --arg afm_probe_output_sha256 "${afm_probe_output_sha256}" \
  --arg afm_probe_stderr_sha256 "${afm_probe_stderr_sha256}" \
  --arg afm_probe_binary_sdk "${afm_probe_binary_sdk}" \
  --arg afm_subject_digest "${afm_subject_digest}" \
  --arg afm_profile_fingerprint "${afm_profile_fingerprint}" \
  --arg afm_advisory_receipt_digest "${afm_advisory_receipt_digest}" \
  --arg afm_runtime_fingerprint "${afm_runtime_fingerprint}" \
  --arg cr09_binding_frame_sha256 "${cr09_binding_frame_sha256}" \
  --arg crash_probe_binary_path "${crash_probe_binary}" \
  --arg crash_probe_binary_sha256 "${crash_probe_binary_sha256}" \
  --arg test_log_sha256 "${test_log_sha256}" \
  --arg test_transport_sha256 "${test_transport_sha256}" \
  --arg fi08_evidence_sha256 "${fi08_evidence_sha256}" \
  --arg fi08_envelope_digest "${fi08_envelope_digest}" \
  --arg fi08_result_evidence_digest "${fi08_result_evidence_digest}" \
  --arg fi09_evidence_sha256 "${fi09_evidence_sha256}" \
  --arg fi09_artifact_digest "${fi09_artifact_digest}" \
  --arg fi09_result_evidence_digest "${fi09_result_evidence_digest}" \
  --arg fi09_uncertified_record_digest "${fi09_uncertified_record_digest}" \
  --arg release_build_log_sha256 "${release_build_log_sha256}" \
  --argjson x86_status "${x86_status}" \
  --arg x86_log_sha256 "${x86_log_sha256}" \
  --argjson nonmac_status "${nonmac_status}" \
  --arg nonmac_log_sha256 "${nonmac_log_sha256}" \
  --arg evidence_dir "${evidence_dir}" \
  '{
    schema_version: 4,
    status: "PASS_PRIVATE_PLATFORM_CONTRACT_ONLY",
    independent_certification: false,
    authorizing: false,
    comparison_batch_id: $comparison_batch_id,
    lane_id: $lane_id,
    target: "macOS 27.0+ Apple Silicon arm64 only",
    declared_sdk: $declared_sdk,
    observed_sdk: $observed_sdk,
    expected_xcode: $expected_xcode,
    observed_xcode: $observed_xcode,
    expected_xcode_build: $expected_xcode_build,
    observed_xcode_build: $observed_xcode_build,
    expected_swift: $expected_swift,
    observed_swift: $observed_swift,
    sdk_path: $sdk_path,
    sdk_resolved_path: $sdk_resolved_path,
    sdk_settings_sha256: $sdk_settings_sha256,
    sdk_symlink_target: $sdk_symlink_target,
    developer_dir: $developer_dir,
    swift_tool_path: $swift_tool_path,
    swift_tool_resolved_path: $swift_tool_resolved_path,
    swift_tool_sha256: $swift_tool_sha256,
    swift_tool_symlink_target: $swift_tool_symlink_target,
    swiftc_tool_path: $swiftc_tool_path,
    swiftc_tool_resolved_path: $swiftc_tool_resolved_path,
    swiftc_tool_sha256: $swiftc_tool_sha256,
    swiftc_tool_symlink_target: $swiftc_tool_symlink_target,
    xcodebuild_tool_sha256: $xcodebuild_tool_sha256,
    xcrun_tool_sha256: $xcrun_tool_sha256,
    test_summary: $test_summary,
    expected_test_count: $expected_test_count,
    observed_test_count: $observed_test_count,
    expected_suite_count: $expected_suite_count,
    observed_suite_count: $observed_suite_count,
    terminal_test_run_summaries: $terminal_test_run_summaries,
    expected_test_breakdown: $expected_test_breakdown,
    observed_test_breakdown: $observed_test_breakdown,
    release_bin_layout: $release_bin_layout,
    batch_contract_sha256: $batch_contract_sha256,
    source_manifest_algorithm: $source_manifest_algorithm,
    source_manifest_sha256: $source_manifest_sha256,
    release_executable_count: $release_executable_count,
    release_executable_names: ["Codename Veritas Framework", "Veritas AFM Functional Probe"],
    product_binary_sha256: $product_binary_sha256,
    afm_probe_binary_sha256: $afm_probe_binary_sha256,
    afm_evidence: {
      status: "PASS_PRIVATE_SELF_ADMINISTERED_NATIVE_AFM_FUNCTIONAL_PROBE_ONLY",
      verifier_result_sha256: $afm_verifier_result_sha256,
      probe_binary_sdk: $afm_probe_binary_sdk,
      probe_output_sha256: $afm_probe_output_sha256,
      probe_stderr_sha256: $afm_probe_stderr_sha256,
      subject_digest: $afm_subject_digest,
      profile_fingerprint: $afm_profile_fingerprint,
      advisory_receipt_digest: $afm_advisory_receipt_digest,
      runtime_fingerprint: $afm_runtime_fingerprint,
      canonical_result: true,
      model_identity_status: "MODEL_ID_NOT_EXPOSED_BY_API",
      raw_artifact_persisted: false,
      transcript_persisted: false,
      external_tools_enabled: false,
      acceptance_authority_granted: false,
      independent_certification: false,
      authorizing: false
    },
    all_release_executables_arm64: true,
    all_release_executables_minos: "27.0",
    all_release_executables_sdk: $expected_binary_sdk,
    cr09_binding_frame_sha256: $cr09_binding_frame_sha256,
    crash_probe_binary_path: $crash_probe_binary_path,
    crash_probe_binary_sha256: $crash_probe_binary_sha256,
    test_log_sha256: $test_log_sha256,
    test_transport_sha256: $test_transport_sha256,
    fi08_evidence: {
      status: "PASS_PRIVATE_FI08_TRANSIENT_CORE_ADMISSION_AND_UNSUPPORTED_REFUSAL_SLICE_ONLY",
      report_sha256: $fi08_evidence_sha256,
      envelope_digest: $fi08_envelope_digest,
      result_evidence_digest: $fi08_result_evidence_digest,
      canonical_report: true,
      fi08_accepted: false,
      fi04_accepted: false,
      independent_certification: false,
      authorizing: false
    },
    fi09_evidence: {
      status: "PASS_PRIVATE_NATIVE_BASELINE_INVARIANCE_ONLY",
      report_sha256: $fi09_evidence_sha256,
      artifact_digest: $fi09_artifact_digest,
      result_evidence_digest: $fi09_result_evidence_digest,
      internal_uncertified_record_digest: $fi09_uncertified_record_digest,
      canonical_report: true,
      independent_certification: false,
      authorizing: false
    },
    release_build_log_sha256: $release_build_log_sha256,
    x86_negative_compile: {
      exit_code: $x86_status,
      log_sha256: $x86_log_sha256,
      required_diagnostic: "VERITAS_REQUIRES_APPLE_SILICON_ARM64"
    },
    non_macos_negative_compile: {
      exit_code: $nonmac_status,
      log_sha256: $nonmac_log_sha256,
      required_diagnostic: "VERITAS_REQUIRES_MACOS"
    },
    evidence_dir: $evidence_dir
  }' > "${result_pending}"

[[ "$(/usr/bin/jq -s 'length' "${result_pending}")" == "1" ]]
cmp -s "${result_pending}" <(/usr/bin/jq -cS . "${result_pending}")
/usr/bin/jq -e \
  --arg batch "${comparison_batch_id}" \
  --arg lane "${lane_id}" \
  --arg contract_sha256 "${batch_contract_sha256}" \
  --arg source_algorithm "${source_manifest_algorithm}" \
  --arg source_sha256 "${source_manifest_sha256}" \
  --arg frame_sha256 "${cr09_binding_frame_sha256}" \
  --arg helper_path "${crash_probe_binary}" \
  --arg helper_sha256 "${crash_probe_binary_sha256}" \
  --arg test_log_sha256 "${test_log_sha256}" \
  --arg test_transport_sha256 "${test_transport_sha256}" \
  --arg evidence_dir "${evidence_dir}" \
  --arg declared_sdk "${expected_sdk}" \
  --arg observed_sdk "${actual_sdk}" \
  --arg expected_xcode "${expected_xcode}" \
  --arg observed_xcode "${observed_xcode}" \
  --arg expected_xcode_build "${expected_xcode_build}" \
  --arg observed_xcode_build "${observed_xcode_build}" \
  --arg expected_swift "${expected_swift}" \
  --arg observed_swift "${observed_swift}" \
  --arg sdk_path "${sdk_path}" \
  --arg sdk_resolved_path "${sdk_resolved_path}" \
  --arg sdk_settings_sha256 "${sdk_settings_sha256}" \
  --arg sdk_symlink_target "${sdk_symlink_target}" \
  --arg developer_dir "${developer_dir}" \
  --arg swift_tool_path "${swift_tool}" \
  --arg swift_tool_resolved_path "${swift_tool_resolved_path}" \
  --arg swift_tool_sha256 "${swift_tool_sha256}" \
  --arg swift_tool_symlink_target "${swift_tool_symlink_target}" \
  --arg swiftc_tool_path "${swiftc_tool}" \
  --arg swiftc_tool_resolved_path "${swiftc_tool_resolved_path}" \
  --arg swiftc_tool_sha256 "${swiftc_tool_sha256}" \
  --arg swiftc_tool_symlink_target "${swiftc_tool_symlink_target}" \
  --arg xcodebuild_tool_sha256 "${xcodebuild_tool_sha256}" \
  --arg xcrun_tool_sha256 "${xcrun_tool_sha256}" \
  --arg test_summary "${test_summary}" \
  --arg expected_test_breakdown "${expected_test_breakdown}" \
  --arg observed_test_breakdown "${observed_test_breakdown}" \
  --argjson terminal_test_run_summaries "${test_summary_count}" \
  --arg release_bin_layout "${release_bin_layout}" \
  --arg product_binary_sha256 "${product_binary_sha256}" \
  --arg afm_probe_binary_sha256 "${afm_probe_binary_sha256}" \
  --arg afm_verifier_result_sha256 "${afm_verifier_result_sha256}" \
  --arg afm_probe_output_sha256 "${afm_probe_output_sha256}" \
  --arg afm_probe_stderr_sha256 "${afm_probe_stderr_sha256}" \
  --arg afm_subject_digest "${afm_subject_digest}" \
  --arg afm_profile_fingerprint "${afm_profile_fingerprint}" \
  --arg afm_advisory_receipt_digest "${afm_advisory_receipt_digest}" \
  --arg afm_runtime_fingerprint "${afm_runtime_fingerprint}" \
  --arg fi08_evidence_sha256 "${fi08_evidence_sha256}" \
  --arg fi08_envelope_digest "${fi08_envelope_digest}" \
  --arg fi08_result_evidence_digest "${fi08_result_evidence_digest}" \
  --arg fi09_evidence_sha256 "${fi09_evidence_sha256}" \
  --arg fi09_artifact_digest "${fi09_artifact_digest}" \
  --arg fi09_result_evidence_digest "${fi09_result_evidence_digest}" \
  --arg fi09_uncertified_record_digest "${fi09_uncertified_record_digest}" \
  --arg release_build_log_sha256 "${release_build_log_sha256}" \
  --argjson x86_status "${x86_status}" \
  --arg x86_log_sha256 "${x86_log_sha256}" \
  --argjson nonmac_status "${nonmac_status}" \
  --arg nonmac_log_sha256 "${nonmac_log_sha256}" '
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
  .comparison_batch_id == $batch and
  .lane_id == $lane and
  .batch_contract_sha256 == $contract_sha256 and
  .source_manifest_algorithm == $source_algorithm and
  .source_manifest_sha256 == $source_sha256 and
  .cr09_binding_frame_sha256 == $frame_sha256 and
  .crash_probe_binary_path == $helper_path and
  .crash_probe_binary_sha256 == $helper_sha256 and
  .test_log_sha256 == $test_log_sha256 and
  .test_transport_sha256 == $test_transport_sha256 and
  .evidence_dir == $evidence_dir and
  .declared_sdk == $declared_sdk and
  .observed_sdk == $observed_sdk and
  .expected_xcode == $expected_xcode and
  .observed_xcode == $observed_xcode and
  .expected_xcode_build == $expected_xcode_build and
  .observed_xcode_build == $observed_xcode_build and
  .expected_swift == $expected_swift and
  .observed_swift == $observed_swift and
  .sdk_path == $sdk_path and
  .sdk_resolved_path == $sdk_resolved_path and
  .sdk_settings_sha256 == $sdk_settings_sha256 and
  .sdk_symlink_target == $sdk_symlink_target and
  .developer_dir == $developer_dir and
  .swift_tool_path == $swift_tool_path and
  .swift_tool_resolved_path == $swift_tool_resolved_path and
  .swift_tool_sha256 == $swift_tool_sha256 and
  .swift_tool_symlink_target == $swift_tool_symlink_target and
  .swiftc_tool_path == $swiftc_tool_path and
  .swiftc_tool_resolved_path == $swiftc_tool_resolved_path and
  .swiftc_tool_sha256 == $swiftc_tool_sha256 and
  .swiftc_tool_symlink_target == $swiftc_tool_symlink_target and
  .xcodebuild_tool_sha256 == $xcodebuild_tool_sha256 and
  .xcrun_tool_sha256 == $xcrun_tool_sha256 and
  .test_summary == $test_summary and
  .expected_test_breakdown == $expected_test_breakdown and
  .observed_test_breakdown == $observed_test_breakdown and
  .terminal_test_run_summaries == $terminal_test_run_summaries and
  .release_bin_layout == $release_bin_layout and
  .product_binary_sha256 == $product_binary_sha256 and
  .afm_probe_binary_sha256 == $afm_probe_binary_sha256 and
  .afm_evidence.verifier_result_sha256 == $afm_verifier_result_sha256 and
  .afm_evidence.probe_output_sha256 == $afm_probe_output_sha256 and
  .afm_evidence.probe_stderr_sha256 == $afm_probe_stderr_sha256 and
  .afm_evidence.subject_digest == $afm_subject_digest and
  .afm_evidence.profile_fingerprint == $afm_profile_fingerprint and
  .afm_evidence.advisory_receipt_digest == $afm_advisory_receipt_digest and
  .afm_evidence.runtime_fingerprint == $afm_runtime_fingerprint and
  .fi08_evidence.report_sha256 == $fi08_evidence_sha256 and
  .fi08_evidence.envelope_digest == $fi08_envelope_digest and
  .fi08_evidence.result_evidence_digest == $fi08_result_evidence_digest and
  .fi09_evidence.report_sha256 == $fi09_evidence_sha256 and
  .fi09_evidence.artifact_digest == $fi09_artifact_digest and
  .fi09_evidence.result_evidence_digest == $fi09_result_evidence_digest and
  .fi09_evidence.internal_uncertified_record_digest == $fi09_uncertified_record_digest and
  .release_build_log_sha256 == $release_build_log_sha256 and
  .x86_negative_compile.exit_code == $x86_status and
  .x86_negative_compile.log_sha256 == $x86_log_sha256 and
  .non_macos_negative_compile.exit_code == $nonmac_status and
  .non_macos_negative_compile.log_sha256 == $nonmac_log_sha256 and
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
  ([$frame_sha256, $helper_sha256, $test_log_sha256, $test_transport_sha256] |
    all(type == "string" and test("^[0-9a-f]{64}$"))) and
  ([
    .product_binary_sha256,
    .afm_probe_binary_sha256,
    .release_build_log_sha256,
    .sdk_settings_sha256,
    .swift_tool_sha256,
    .swiftc_tool_sha256,
    .xcodebuild_tool_sha256,
    .xcrun_tool_sha256,
    .fi08_evidence.report_sha256,
    .fi08_evidence.envelope_digest,
    .fi08_evidence.result_evidence_digest,
    .fi09_evidence.report_sha256,
    .fi09_evidence.artifact_digest,
    .fi09_evidence.result_evidence_digest,
    .fi09_evidence.internal_uncertified_record_digest,
    .x86_negative_compile.log_sha256,
    .non_macos_negative_compile.log_sha256,
    .afm_evidence.verifier_result_sha256,
    .afm_evidence.probe_output_sha256,
    .afm_evidence.probe_stderr_sha256,
    .afm_evidence.subject_digest,
    .afm_evidence.profile_fingerprint,
    .afm_evidence.advisory_receipt_digest,
    .afm_evidence.runtime_fingerprint
  ] | all(type == "string" and test("^[0-9a-f]{64}$"))) and
  .afm_evidence.status == "PASS_PRIVATE_SELF_ADMINISTERED_NATIVE_AFM_FUNCTIONAL_PROBE_ONLY" and
  .afm_evidence.probe_binary_sdk == "27.0" and
  .afm_evidence.canonical_result == true and
  .afm_evidence.model_identity_status == "MODEL_ID_NOT_EXPOSED_BY_API" and
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
  .non_macos_negative_compile.required_diagnostic == "VERITAS_REQUIRES_MACOS" and
  .independent_certification == false and
  .authorizing == false
' "${result_pending}" > /dev/null

# Bind the validated pending JSON, then close every referenced artifact before
# no-clobber publication. A PASS result must never outlive the bytes it names.
[[ -f "${result_pending}" && ! -L "${result_pending}" \
   && "$(( 8#$(/usr/bin/stat -f '%Lp' "${result_pending}") & 8#022 ))" == '0' \
   && "$(/usr/bin/stat -f '%u' "${result_pending}")" == "$(/usr/bin/id -u)" \
   && "$(/usr/bin/stat -f '%l' "${result_pending}")" == '1' ]]
result_pending_identity="$(/usr/bin/stat -f '%d:%i' "${result_pending}")"
result_pending_sha256="$(shasum -a 256 "${result_pending}" | awk '{print $1}')"

build_source_manifest > "${source_manifest_post}"
cmp -s "${batch_source_manifest}" "${source_manifest_post}"
[[ "$(shasum -a 256 "${source_manifest_post}" | awk '{print $1}')" \
     == "${source_manifest_sha256}" ]]

[[ -f "${crash_probe_binary}" && ! -L "${crash_probe_binary}" \
   && -x "${crash_probe_binary}" \
   && "$(/usr/bin/stat -f '%u' "${crash_probe_binary}")" == "$(/usr/bin/id -u)" \
   && "$(/usr/bin/stat -f '%l' "${crash_probe_binary}")" == '1' \
   && "$(/usr/bin/stat -f '%d:%i' "${crash_probe_binary}")" \
        == "${crash_probe_binary_identity}" \
   && "$(( 8#$(/usr/bin/stat -f '%Lp' "${crash_probe_binary}") & 8#022 ))" == '0' \
   && "$(( 8#$(/usr/bin/stat -f '%Lp' "${crash_probe_binary}") & 8#100 ))" != '0' \
   && "$(/usr/bin/stat -f '%z' "${crash_probe_binary}")" -gt 8 \
   && "$(/usr/bin/stat -f '%z' "${crash_probe_binary}")" -le 67108864 \
   && "$(/usr/bin/file -b "${crash_probe_binary}")" == *Mach-O* \
   && "$(/usr/bin/file -b "${crash_probe_binary}")" == *executable* \
   && "$(/usr/bin/file -b "${crash_probe_binary}")" == *arm64* \
   && "$("${xcrun_tool}" lipo -archs "${crash_probe_binary}")" == 'arm64' \
   && "$(shasum -a 256 "${crash_probe_binary}" | awk '{print $1}')" \
        == "${crash_probe_binary_sha256}" ]]

for close_binary in "${product_binary}" "${afm_probe_binary}"; do
  [[ -f "${close_binary}" && ! -L "${close_binary}" && -x "${close_binary}" ]]
  [[ "$("${xcrun_tool}" lipo -archs "${close_binary}")" == 'arm64' ]]
done
[[ "$(shasum -a 256 "${product_binary}" | awk '{print $1}')" \
     == "${product_binary_sha256}" \
   && "$(shasum -a 256 "${afm_probe_binary}" | awk '{print $1}')" \
     == "${afm_probe_binary_sha256}" \
   && "$(shasum -a 256 "${afm_verifier_result}" | awk '{print $1}')" \
     == "${afm_verifier_result_sha256}" \
   && "$(shasum -a 256 "${afm_probe_json}" | awk '{print $1}')" \
     == "${afm_probe_output_sha256}" \
   && "$(shasum -a 256 "${afm_probe_stderr}" | awk '{print $1}')" \
     == "${afm_probe_stderr_sha256}" \
   && "$(shasum -a 256 "${test_log}" | awk '{print $1}')" \
     == "${test_log_sha256}" \
   && "$(shasum -a 256 "${fi08_evidence_json}" | awk '{print $1}')" \
     == "${fi08_evidence_sha256}" \
   && "$(shasum -a 256 "${fi09_evidence_json}" | awk '{print $1}')" \
     == "${fi09_evidence_sha256}" \
   && "$(shasum -a 256 "${release_build_log}" | awk '{print $1}')" \
     == "${release_build_log_sha256}" \
   && "$(shasum -a 256 "${x86_log}" | awk '{print $1}')" \
     == "${x86_log_sha256}" \
   && "$(shasum -a 256 "${nonmac_log}" | awk '{print $1}')" \
     == "${nonmac_log_sha256}" ]]
[[ "$(shasum -a 256 "${xcodebuild_tool}" | awk '{print $1}')" \
     == "${xcodebuild_tool_sha256}" \
   && "$(shasum -a 256 "${xcrun_tool}" | awk '{print $1}')" \
     == "${xcrun_tool_sha256}" \
   && "$(shasum -a 256 "${swift_tool}" | awk '{print $1}')" \
     == "${swift_tool_sha256}" \
   && "$(shasum -a 256 "${swiftc_tool}" | awk '{print $1}')" \
     == "${swiftc_tool_sha256}" \
   && "$(shasum -a 256 "${sdk_settings}" | awk '{print $1}')" \
     == "${sdk_settings_sha256}" ]]
veritas_validate_test_transport_record "${test_transport}" "${evidence_dir}"
[[ "$(shasum -a 256 "${test_transport}" | awk '{print $1}')" == "${test_transport_sha256}" ]]
veritas_validate_baseline_b_log "${test_log}" "${machine_evidence}" "${crash_probe_binary_sha256}"
veritas_validate_cr09_parser_negative_receipt \
  "${parser_receipt}" "${test_log}" "${machine_evidence}" \
  "${checkpoint_control_helper}" "${parser_negative_helper}"
[[ "$(veritas_cr09_binding_frame_sha256 "${machine_evidence}")" \
     == "${cr09_binding_frame_sha256}" ]]

# Rebuild the source manifest last, then prove the pending bytes and inode are
# unchanged immediately before atomic hard-link publication.
veritas_validate_test_transport_record "${test_transport}" "${evidence_dir}"
[[ "$(shasum -a 256 "${test_transport}" | awk '{print $1}')" == "${test_transport_sha256}" ]]
build_source_manifest > "${source_manifest_post}"
for close_manifest in \
  "${batch_source_manifest}" "${source_manifest}" \
  "${source_manifest_post}" "${afm_source_manifest}"; do
  [[ -f "${close_manifest}" && ! -L "${close_manifest}" ]]
  cmp -s "${batch_source_manifest}" "${close_manifest}"
  [[ "$(shasum -a 256 "${close_manifest}" | awk '{print $1}')" \
       == "${source_manifest_sha256}" ]]
done
[[ -f "${batch_contract}" && ! -L "${batch_contract}" \
   && "$(shasum -a 256 "${batch_contract}" | awk '{print $1}')" \
     == "${batch_contract_sha256}" \
   && "$(/usr/bin/stat -f '%d:%i' "${result_pending}")" \
     == "${result_pending_identity}" \
   && "$(shasum -a 256 "${result_pending}" | awk '{print $1}')" \
     == "${result_pending_sha256}" \
   && ! -e "${result_json}" ]]
/bin/ln "${result_pending}" "${result_json}"
if [[ "$(/usr/bin/stat -f '%d:%i' "${result_json}")" \
         == "${result_pending_identity}" \
      && "$(shasum -a 256 "${result_json}" | awk '{print $1}')" \
         == "${result_pending_sha256}" \
      && "$(/usr/bin/stat -f '%l' "${result_json}")" == '2' \
      && "$(/usr/bin/jq -s 'length' "${result_json}")" == '1' ]] \
   && cmp -s "${result_json}" <(/usr/bin/jq -cS . "${result_json}"); then
  :
else
  /bin/rm -f -- "${result_json}"
  exit 1
fi
/bin/rm -f -- "${result_pending}"
if [[ "$(/usr/bin/stat -f '%d:%i' "${result_json}")" \
         == "${result_pending_identity}" \
      && "$(shasum -a 256 "${result_json}" | awk '{print $1}')" \
         == "${result_pending_sha256}" \
      && "$(/usr/bin/stat -f '%l' "${result_json}")" == '1' ]] \
   && cmp -s "${result_json}" <(/usr/bin/jq -cS . "${result_json}"); then
  :
else
  /bin/rm -f -- "${result_json}"
  exit 1
fi
/usr/bin/jq -cS . "${result_json}"
