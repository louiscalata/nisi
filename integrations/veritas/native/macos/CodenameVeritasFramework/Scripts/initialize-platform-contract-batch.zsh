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
comparison_batch_id="${VERITAS_PLATFORM_COMPARISON_BATCH_ID:?Set one fresh 32-character lowercase hexadecimal comparison batch ID.}"
grep -Eq '^[0-9a-f]{32}$' <<< "${comparison_batch_id}"

runs_root="${scratch_root}/runs"
batch_root="${runs_root}/${comparison_batch_id}"
batch_contract="${batch_root}/batch-contract.json"
batch_contract_pending="${batch_root}/batch-contract.json.pending"
batch_source_manifest="${batch_root}/source-manifest.sha256"
lane26_id="xcode-26.6_swift-6.3.3_sdk-26.5"
lane27_id="xcode-27.0_swift-6.4_sdk-27.0"
source_manifest_algorithm="${VERITAS_SOURCE_MANIFEST_ALGORITHM}"

mkdir -p "${runs_root}"
mkdir "${batch_root}"

veritas_build_source_manifest "${package_dir}" > "${batch_source_manifest}"

source_manifest_sha256="$(shasum -a 256 "${batch_source_manifest}" | awk '{print $1}')"
/usr/bin/jq -cn \
  --arg comparison_batch_id "${comparison_batch_id}" \
  --arg lane26_id "${lane26_id}" \
  --arg lane27_id "${lane27_id}" \
  --arg source_manifest_algorithm "${source_manifest_algorithm}" \
  --arg source_manifest_sha256 "${source_manifest_sha256}" \
  '{
    schema_version: 2,
    status: "OPEN_PRIVATE_TWO_LANE_BATCH",
    comparison_batch_id: $comparison_batch_id,
    platform_result_schema_version: 4,
    comparison_result_schema_version: 4,
    lane_ids: [$lane26_id, $lane27_id],
    expected_test_count_per_lane: 470,
    expected_suite_count_per_lane: 37,
    source_manifest_algorithm: $source_manifest_algorithm,
    source_manifest_sha256: $source_manifest_sha256,
    independent_certification: false,
    authorizing: false
  }' | /usr/bin/jq -cS . > "${batch_contract_pending}"

mv "${batch_contract_pending}" "${batch_contract}"
/usr/bin/jq . "${batch_contract}"
