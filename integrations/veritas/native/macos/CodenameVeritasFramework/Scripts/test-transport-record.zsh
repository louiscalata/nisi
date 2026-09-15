#!/bin/zsh

# Private byte/identity bindings for two raw test channels and their separate
# parser receipt. This is not protected custody or proof of test chronology.
veritas_transport_sha256() {
    /usr/bin/shasum -a 256 "${1}" | /usr/bin/awk '{print $1}'
}

veritas_transport_file_record() {
    emulate -L zsh
    set -euo pipefail
    (( $# == 3 )) || return 2
    local file="${1}" maximum_bytes="${2}" expected_identity="${3}"
    [[ "${file}" == /* && "${file}" == "${file:A}" \
       && -f "${file}" && ! -L "${file}" && -s "${file}" \
       && "${maximum_bytes}" == <-> ]] || return 2
    local before after digest device inode bytes
    before="$(/usr/bin/stat -f '%HT|%u|%Lp|%l|%d:%i|%z|%Fm|%Fc' "${file}")"
    [[ "${before}" == "Regular File|$(/usr/bin/id -u)|600|1|${expected_identity}|"* ]] || return 1
    device="$(/usr/bin/stat -f '%d' "${file}")"
    inode="$(/usr/bin/stat -f '%i' "${file}")"
    bytes="$(/usr/bin/stat -f '%z' "${file}")"
    [[ "${device}" == <-> && "${inode}" == <-> && ${inode} -gt 0 \
       && "${bytes}" == <-> && ${bytes} -gt 0 && ${bytes} -le ${maximum_bytes} ]] || return 1
    digest="$(veritas_transport_sha256 "${file}")"
    /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${digest}" || return 1
    [[ "$(veritas_transport_sha256 "${file}")" == "${digest}" ]] || return 1
    after="$(/usr/bin/stat -f '%HT|%u|%Lp|%l|%d:%i|%z|%Fm|%Fc' "${file}")"
    [[ "${before}" == "${after}" && "${file}" == "${file:A}" && ! -L "${file}" ]] || return 1
    /usr/bin/jq -cnS --arg path "${file}" --arg device "${device}" --arg inode "${inode}" \
        --argjson bytes "${bytes}" --arg sha256 "${digest}" \
        '{path:$path,device:$device,inode:$inode,bytes:$bytes,sha256:$sha256}'
}

veritas_build_test_transport_record() {
    emulate -L zsh
    set -euo pipefail
    (( $# == 4 )) || return 2
    local evidence_dir="${1}" transcript machine receipt
    transcript="$(veritas_transport_file_record "${evidence_dir}/swift-test.log" 4194304 "${2}")" || return 1
    machine="$(veritas_transport_file_record "${evidence_dir}/machine-evidence.log" 4194304 "${3}")" || return 1
    receipt="$(veritas_transport_file_record "${evidence_dir}/cr09-parser-negative.receipt" 8192 "${4}")" || return 1
    # Revisit earlier files after all three records exist. These observations
    # refuse detected drift; they are not an atomic multi-file snapshot.
    [[ "${transcript}" == "$(veritas_transport_file_record "${evidence_dir}/swift-test.log" 4194304 "${2}")" \
       && "${machine}" == "$(veritas_transport_file_record "${evidence_dir}/machine-evidence.log" 4194304 "${3}")" \
       && "${receipt}" == "$(veritas_transport_file_record "${evidence_dir}/cr09-parser-negative.receipt" 8192 "${4}")" ]] || return 1
    /usr/bin/jq -cnS --argjson transcript "${transcript}" --argjson machine "${machine}" \
        --argjson receipt "${receipt}" \
        '{schema_version:1,authorizing:false,files:{transcript:$transcript,machine:$machine,parser_receipt:$receipt}}'
}

veritas_validate_test_transport_record() {
    emulate -L zsh
    set -euo pipefail
    (( $# == 2 )) || return 2
    local record="${1}" evidence_dir="${2}" record_before transcript_id machine_id receipt_id rebuilt
    [[ "${record}" == "${evidence_dir}/test-transport.json" \
       && -f "${record}" && ! -L "${record}" && -s "${record}" \
       && "$(/usr/bin/stat -f '%z' "${record}")" -le 8192 ]] || return 2
    record_before="$(veritas_transport_file_record "${record}" 8192 "$(/usr/bin/stat -f '%d:%i' "${record}")")" || return 1
    [[ "$(/usr/bin/jq -s 'length' "${record}")" == 1 ]] || return 1
    /usr/bin/cmp -s "${record}" <(/usr/bin/jq -cS . "${record}") || return 1
    /usr/bin/jq -e '
      type == "object" and keys == ["authorizing","files","schema_version"] and
      .schema_version == 1 and .authorizing == false and
      (.files | type == "object" and keys == ["machine","parser_receipt","transcript"]) and
      ([.files[]] | all(type == "object" and keys == ["bytes","device","inode","path","sha256"] and
        (.path | type == "string") and (.device | type == "string" and test("^(0|[1-9][0-9]*)$")) and
        (.inode | type == "string" and test("^[1-9][0-9]*$")) and
        (.bytes | type == "number" and . > 0 and floor == .) and
        (.sha256 | type == "string" and test("^[0-9a-f]{64}$"))))
    ' "${record}" > /dev/null || return 1
    transcript_id="$(/usr/bin/jq -r '.files.transcript | .device + ":" + .inode' "${record}")"
    machine_id="$(/usr/bin/jq -r '.files.machine | .device + ":" + .inode' "${record}")"
    receipt_id="$(/usr/bin/jq -r '.files.parser_receipt | .device + ":" + .inode' "${record}")"
    rebuilt="$(veritas_build_test_transport_record "${evidence_dir}" "${transcript_id}" "${machine_id}" "${receipt_id}")" || return 1
    /usr/bin/cmp -s "${record}" <(print -r -- "${rebuilt}") || return 1
    [[ "${record_before}" == "$(veritas_transport_file_record "${record}" 8192 "$(/usr/bin/stat -f '%d:%i' "${record}")")" ]]
}
