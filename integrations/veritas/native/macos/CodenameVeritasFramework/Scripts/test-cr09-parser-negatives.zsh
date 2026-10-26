#!/bin/zsh

# Private non-authorizing falsification harness for the CR-09 shell evidence
# parser. It accepts one already-valid complete Baseline-B log, creates bounded
# mutated copies beneath a fresh 0700 /private/tmp root, and proves every copy is
# rejected. The mutation root is intentionally retained for audit.

emulate -L zsh
set -euo pipefail
umask 077
PATH='/usr/bin:/bin:/usr/sbin:/sbin'
export PATH

(( $# >= 2 && $# <= 3 )) || {
    print -u2 -- 'CR09_PARSER_NEGATIVES_REFUSED: expected transcript, machine sink, and optional helper digest'
    exit 2
}

script_dir="${0:A:h}"
parser_helper="${script_dir}/checkpoint-control-log.zsh"
base_transcript="${1:A}"
base_machine="${2:A}"
expected_helper_sha256="${3:-}"
[[ -f "${parser_helper}" && ! -L "${parser_helper}" \
   && -f "${base_transcript}" && ! -L "${base_transcript}" && -s "${base_transcript}" \
   && -f "${base_machine}" && ! -L "${base_machine}" && -s "${base_machine}" ]] || {
    print -u2 -- 'CR09_PARSER_NEGATIVES_REFUSED: invalid parser or base log'
    exit 2
}
source "${parser_helper}"
base_helper_sha256="$(veritas_cr09_binding_helper_sha256 "${base_machine}")" || {
    print -u2 -- 'CR09_PARSER_NEGATIVES_REFUSED: binding helper digest was unavailable'
    exit 2
}
if [[ -n "${expected_helper_sha256}" ]]; then
    /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${expected_helper_sha256}" \
        && [[ "${expected_helper_sha256}" == "${base_helper_sha256}" ]] || {
        print -u2 -- 'CR09_PARSER_NEGATIVES_REFUSED: expected helper digest mismatch'
        exit 2
    }
else
    expected_helper_sha256="${base_helper_sha256}"
fi
veritas_validate_baseline_b_log "${base_transcript}" "${base_machine}" "${expected_helper_sha256}" || {
    print -u2 -- 'CR09_PARSER_NEGATIVES_REFUSED: base log was not valid'
    exit 2
}

transcript_bytes="$(/usr/bin/stat -f '%z' "${base_transcript}")"
transcript_sha256="$(/usr/bin/shasum -a 256 "${base_transcript}" | /usr/bin/awk '{print $1}')"
machine_bytes="$(/usr/bin/stat -f '%z' "${base_machine}")"
machine_sha256="$(/usr/bin/shasum -a 256 "${base_machine}" | /usr/bin/awk '{print $1}')"
parser_sha256="$(/usr/bin/shasum -a 256 "${parser_helper}" | /usr/bin/awk '{print $1}')"
harness_sha256="$(/usr/bin/shasum -a 256 "${0:A}" | /usr/bin/awk '{print $1}')"
[[ "${transcript_bytes}" == <-> && ${transcript_bytes} -gt 0 && ${transcript_bytes} -le 4194304 \
    && "${machine_bytes}" == <-> && ${machine_bytes} -gt 0 && ${machine_bytes} -le 4194304 ]] \
    && /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${transcript_sha256}" \
    && /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${machine_sha256}" \
    && /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${parser_sha256}" \
    && /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${harness_sha256}" || {
    print -u2 -- 'CR09_PARSER_NEGATIVES_REFUSED: base or tool identity was invalid'
    exit 2
}
# Enumerate only our retained roots. A find over all of /private/tmp can fail
# when an unrelated concurrent process removes its own temporary directory.
# N admits an empty match; / restricts membership to actual directories. This
# keeps the existing 32-root refusal without touching or deleting any evidence.
typeset -a retained_roots
retained_roots=(/private/tmp/veritas-cr09-parser-negatives.*(N/))
retained_root_count="${#retained_roots}"
[[ "${retained_root_count}" == <-> && ${retained_root_count} -lt 32 ]] || {
    print -u2 -- 'CR09_PARSER_NEGATIVES_REFUSED: retained-root quota reached'
    exit 2
}

fixture_root="$(/usr/bin/mktemp -d /private/tmp/veritas-cr09-parser-negatives.XXXXXX)"
[[ -d "${fixture_root}" && ! -L "${fixture_root}" \
   && "$(/usr/bin/stat -f '%u' "${fixture_root}")" == "$(/usr/bin/id -u)" \
   && "$(/usr/bin/stat -f '%Lp' "${fixture_root}")" == '700' \
   && -z "$(/usr/bin/find "${fixture_root}" -mindepth 1 -maxdepth 1 -print -quit)" ]] || {
    print -u2 -- 'CR09_PARSER_NEGATIVES_REFUSED: invalid private mutation root'
    exit 2
}
fixture_root_identity="$(/usr/bin/stat -f '%d:%i' "${fixture_root}")"

pristine_transcript="${fixture_root}/pristine-transcript.log"
pristine_machine="${fixture_root}/pristine-machine.log"
/bin/cp -c -p -- "${base_transcript}" "${pristine_transcript}"
/bin/cp -c -p -- "${base_machine}" "${pristine_machine}"
manifest_path="${fixture_root}/mutation-manifest.tsv"
: > "${manifest_path}"
[[ -f "${manifest_path}" && ! -L "${manifest_path}" \
   && "$(/usr/bin/stat -f '%Lp' "${manifest_path}")" == '600' ]] || {
    print -u2 -- 'CR09_PARSER_NEGATIVES_REFUSED: manifest allocation failed'
    exit 2
}

typeset -i rejected_count=0 accepted_control_count=0 evaluation_count=0
typeset -A label_seen after_sha_seen fixture_identity_seen

evaluate_mutation() {
    emulate -L zsh
    set -euo pipefail
    (( $# == 5 )) || return 2
    local label="${1}"
    local validator="${2}"
    local expectation="${3}"
    local channel="${4}"
    local mutation="${5}"
    /usr/bin/grep -Eq '^[a-z0-9_]+$' <<< "${label}" || return 2
    [[ "${expectation}" == 'REJECT' || "${expectation}" == 'ACCEPT' ]] || return 2
    [[ "${validator}" == 'BASELINE' || "${validator}" == 'ASCII_1024' ]] || return 2
    [[ "${channel}" == 'TRANSCRIPT' || "${channel}" == 'MACHINE' ]] || return 2
    [[ -z "${label_seen[${label}]:-}" ]] || return 2
    label_seen[${label}]=1
    local fixture="${fixture_root}/${label}.${(L)channel}.log"
    local candidate_transcript="${pristine_transcript}"
    local candidate_machine="${pristine_machine}"
    if [[ "${channel}" == 'TRANSCRIPT' ]]; then
        /bin/cp -c -p -- "${base_transcript}" "${fixture}"
        candidate_transcript="${fixture}"
    else
        /bin/cp -c -p -- "${base_machine}" "${fixture}"
        candidate_machine="${fixture}"
    fi
    [[ -f "${fixture}" && ! -L "${fixture}" \
       && "$(/usr/bin/stat -f '%u' "${fixture}")" == "$(/usr/bin/id -u)" \
       && "$(/usr/bin/stat -f '%Lp' "${fixture}")" == '600' \
       && "$(/usr/bin/stat -f '%l' "${fixture}")" == '1' ]] || return 2
    local before_sha256 after_sha256 expected_source_sha256 source_bytes
    if [[ "${channel}" == 'TRANSCRIPT' ]]; then
        expected_source_sha256="${transcript_sha256}"
        source_bytes="${transcript_bytes}"
    else
        expected_source_sha256="${machine_sha256}"
        source_bytes="${machine_bytes}"
    fi
    before_sha256="$(/usr/bin/shasum -a 256 "${fixture}" | /usr/bin/awk '{print $1}')"
    [[ "${before_sha256}" == "${expected_source_sha256}" ]] || return 2
    /usr/bin/perl -0pi -e "${mutation}" -- "${fixture}"
    after_sha256="$(/usr/bin/shasum -a 256 "${fixture}" | /usr/bin/awk '{print $1}')"
    [[ "${before_sha256}" != "${after_sha256}" ]] || {
        print -u2 -- "CR09_PARSER_NEGATIVES_REFUSED: mutation ${label} made no byte change"
        return 2
    }
    [[ -z "${after_sha_seen[${after_sha256}]:-}" ]] || {
        print -u2 -- "CR09_PARSER_NEGATIVES_REFUSED: duplicate fixture digest for ${label}"
        return 2
    }
    after_sha_seen[${after_sha256}]=1
    local after_bytes fixture_identity
    after_bytes="$(/usr/bin/stat -f '%z' "${fixture}")"
    fixture_identity="$(/usr/bin/stat -f '%d:%i' "${fixture}")"
    [[ "${after_bytes}" == <-> && ${after_bytes} -le $(( source_bytes + 8192 )) \
       && -z "${fixture_identity_seen[${fixture_identity}]:-}" \
       && "$(/usr/bin/stat -f '%u' "${fixture}")" == "$(/usr/bin/id -u)" \
       && "$(/usr/bin/stat -f '%Lp' "${fixture}")" == '600' \
       && "$(/usr/bin/stat -f '%l' "${fixture}")" == '1' ]] || return 2
    fixture_identity_seen[${fixture_identity}]=1

    local observed
    if [[ "${validator}" == 'BASELINE' ]] \
       && veritas_validate_baseline_b_log \
            "${candidate_transcript}" "${candidate_machine}" "${expected_helper_sha256}" 2>/dev/null; then
        observed='ACCEPT'
    elif [[ "${validator}" == 'ASCII_1024' ]] \
       && veritas_validate_cr09_ascii_line_limit "${candidate_machine}" 1024; then
        observed='ACCEPT'
    else
        observed='REJECT'
    fi
    [[ "${observed}" == "${expectation}" ]] || {
        print -u2 -- "CR09_PARSER_NEGATIVES_FAILED_${observed}: ${label} expected ${expectation}"
        return 1
    }
    if [[ "${expectation}" == 'REJECT' ]]; then
        rejected_count+=1
    else
        accepted_control_count+=1
    fi
    evaluation_count+=1
    local manifest_record
    manifest_record="${label}"$'\t'"${validator}"$'\t'"${expectation}"$'\t'"${channel}"$'\t'"${transcript_sha256}"$'\t'"${transcript_bytes}"$'\t'"${machine_sha256}"$'\t'"${machine_bytes}"$'\t'"${after_sha256}"$'\t'"${after_bytes}"$'\t'"${observed}"
    print -r -- "${manifest_record}" >> "${manifest_path}"
}

reject_mutation() {
    (( $# == 2 )) || return 2
    evaluate_mutation "${1}" BASELINE REJECT MACHINE "${2}"
}

reject_transcript_mutation() {
    (( $# == 2 )) || return 2
    evaluate_mutation "${1}" BASELINE REJECT TRANSCRIPT "${2}"
}

accept_limit_mutation() {
    (( $# == 2 )) || return 2
    evaluate_mutation "${1}" ASCII_1024 ACCEPT MACHINE "${2}"
}

reject_limit_mutation() {
    (( $# == 2 )) || return 2
    evaluate_mutation "${1}" ASCII_1024 REJECT MACHINE "${2}"
}

reject_transcript_mutation missing_suite \
    's/^◇ Suite "Founder Alpha coherent replacement Baseline B3C closed sibling fork" started[.]\n//m == 1 or die "mutation";'
reject_transcript_mutation duplicate_suite \
    's/(^◇ Suite "Founder Alpha coherent replacement Baseline B3C closed sibling fork" started[.]\n)/$1$1/m == 1 or die "mutation";'
reject_transcript_mutation missing_summary \
    's/^✔ Test "CR-09 exact closed sibling successors are admitted in AB and BA order" passed after [0-9]+(?:[.][0-9]+)? seconds[.]\n//m == 1 or die "mutation";'
reject_transcript_mutation duplicate_summary \
    's/(^✔ Test "CR-09 exact closed sibling successors are admitted in AB and BA order" passed after [0-9]+(?:[.][0-9]+)? seconds[.]\n)/$1$1/m == 1 or die "mutation";'
reject_mutation missing_child \
    's/^VERITAS_B3_CHILD\|v1\|request=cr09-[0-9a-f]{32}-build-p-[0-9a-f]{32}\|case=CR-09\|[^\n]*\n//m == 1 or die "mutation";'
reject_mutation duplicate_child \
    's/(^VERITAS_B3_CHILD\|v1\|request=cr09-[0-9a-f]{32}-build-p-[0-9a-f]{32}\|case=CR-09\|[^\n]*\n)/$1$1/m == 1 or die "mutation";'
reject_mutation wrong_child_role \
    's/(^VERITAS_B3_CHILD\|v1\|request=cr09-[0-9a-f]{32})-build-p-/$1-build-z-/m == 1 or die "mutation";'
reject_mutation wrong_child_family \
    's/(^VERITAS_B3_CHILD\|v1\|request=cr09-)[0-9a-f]{32}(-build-p-)/$1 . ("f" x 32) . $2/me == 1 or die "mutation";'
reject_mutation wrong_child_variant \
    's/(^VERITAS_B3_CHILD\|v1\|request=cr09-[^\n]*\|case=CR-09\|)variant=FORK_BUILD/$1variant=FORK_UNKNOWN/m == 1 or die "mutation";'
reject_mutation extra_child_field \
    's/(^VERITAS_B3_CHILD\|v1\|request=cr09-[0-9a-f]{32}-build-p-[^\n]*)(\n)/$1 . "|extra=true" . $2/me == 1 or die "mutation";'
reject_mutation oversized_child \
    's/(^VERITAS_B3_CHILD\|v1\|request=cr09-[0-9a-f]{32}-build-p-[^\n]*)(\n)/$1 . ("A" x 1100) . $2/me == 1 or die "mutation";'
reject_mutation crlf_child \
    's/(^VERITAS_B3_CHILD\|v1\|request=cr09-[0-9a-f]{32}-build-p-[^\n]*)\n/$1 . "\r\n"/me == 1 or die "mutation";'
reject_mutation nul_child \
    's/(^VERITAS_B3_CHILD\|v1\|request=cr09-[0-9a-f]{32}-build-p-[^\n]*)(\n)/$1 . "\x00" . $2/me == 1 or die "mutation";'
reject_mutation invalid_utf8_child \
    's/(^VERITAS_B3_CHILD\|v1\|request=cr09-[0-9a-f]{32}-build-p-[^\n]*)(\n)/$1 . "\xFF" . $2/me == 1 or die "mutation";'
reject_mutation missing_custody \
    's/^VERITAS_CR09_CUSTODY\|[^\n]*\n//m == 1 or die "mutation";'
reject_mutation duplicate_custody \
    's/(^VERITAS_CR09_CUSTODY\|[^\n]*\n)/$1$1/m == 1 or die "mutation";'
reject_mutation malformed_custody_family \
    's/(^VERITAS_CR09_CUSTODY\|v1\|family=)[0-9a-f]{32}/$1 . ("z" x 32)/me == 1 or die "mutation";'
reject_mutation invalid_custody_path \
    's/(^VERITAS_CR09_CUSTODY\|[^\n]*\|p_source=)[^|\n]+/$1 . "\/private\/tmp\/not-admitted"/me == 1 or die "mutation";'
reject_mutation oversized_custody \
    's/(^VERITAS_CR09_CUSTODY\|[^\n]*)(\n)/$1 . ("A" x 4096) . $2/me == 1 or die "mutation";'
reject_mutation missing_ab_parent \
    's/^VERITAS_BASELINE_B_RESULT\|case=CR-09\|[^\n]*\|order=AB\|[^\n]*\n//m == 1 or die "mutation";'
reject_mutation noncanonical_repetition \
    's/(^VERITAS_BASELINE_B_RESULT\|case=CR-09\|target=closed-sibling-fork\|)repetition=0/$1 . "repetition=+0"/me == 1 or die "mutation";'
reject_mutation authorizing_parent \
    's/(^VERITAS_BASELINE_B_RESULT\|case=CR-09\|[^\n]*\|)authorizing=false$/$1 . "authorizing=true"/me == 1 or die "mutation";'
reject_mutation cross_order_digest_disagreement \
    's/(^VERITAS_BASELINE_B_RESULT\|case=CR-09\|[^\n]*\|order=BA\|)h0=[0-9a-f]{64}/$1 . "h0=" . ("0" x 64)/me == 1 or die "mutation";'
reject_mutation oversized_parent \
    's/(^VERITAS_BASELINE_B_RESULT\|case=CR-09\|[^\n]*)(\n)/$1 . ("A" x 2048) . $2/me == 1 or die "mutation";'
reject_mutation adverse_transcript \
    '$_ .= "VERITAS_CR09_ADVERSE_TRANSCRIPT|case=CR-09|authorizing=false\n";'
reject_mutation unknown_baseline_marker \
    '$_ .= "VERITAS_BASELINE_B_RESULT|case=CR-99|authorizing=false\n";'
reject_mutation old_twenty_frame_log \
    's/^VERITAS_BASELINE_B_RESULT\|case=CR-09\|[^\n]*\n//mg == 2 or die "mutation";'

reject_mutation extra_child_version \
    's{^(VERITAS_B3_CHILD\|v1\|request=cr09-[0-9a-f]{32}-build-p-[0-9a-f]{32}\|case=CR-09\|[^\n]*)\n}{my $original = $1; my $extra = $original; $extra =~ s/\|v1\|/\|v2\|/; "$original\n$extra\n"}me == 1 or die "mutation";'
reject_mutation extra_child_reordered_case \
    's{^(VERITAS_B3_CHILD\|v1\|request=cr09-[0-9a-f]{32}-build-p-[0-9a-f]{32}\|case=CR-09\|variant=FORK_BUILD\|[^\n]*)\n}{my $original = $1; my $extra = $original; $extra =~ s/\|case=CR-09\|variant=FORK_BUILD\|/\|variant=FORK_BUILD\|case=CR-09\|/; "$original\n$extra\n"}me == 1 or die "mutation";'
reject_mutation extra_child_leading_marker \
    's{^(VERITAS_B3_CHILD\|v1\|request=cr09-[0-9a-f]{32}-build-p-[0-9a-f]{32}\|case=CR-09\|[^\n]*)\n}{my $original = $1; "$original\nX$original\n"}me == 1 or die "mutation";'
reject_mutation missing_binding \
    's/^VERITAS_CR09_BINDING\|[^\n]*\n//m == 1 or die "mutation";'
reject_mutation duplicate_binding \
    's/(^VERITAS_CR09_BINDING\|[^\n]*\n)/$1$1/m == 1 or die "mutation";'
reject_mutation extra_malformed_binding \
    's{^(VERITAS_CR09_BINDING\|v1\|[^\n]*)\n}{my $original = $1; my $extra = $original; $extra =~ s/\|v1\|/\|v2\|/; "$original\n$extra\n"}me == 1 or die "mutation";'
reject_mutation wrong_binding_helper \
    's/(^VERITAS_CR09_BINDING\|v1\|[^\n]*\|helper_binary_sha256=)[0-9a-f]{64}/$1 . ("0" x 64)/me == 1 or die "mutation";'
reject_mutation duplicate_binding_pid \
    'my ($builder_pid) = /^VERITAS_CR09_BINDING\|v1\|[^\n]*\|p_builder_pid=([1-9][0-9]*)\|p_control_pid=/m or die "mutation"; s{(^VERITAS_CR09_BINDING\|v1\|[^\n]*\|p_control_pid=)[1-9][0-9]*}{$1 . $builder_pid}me == 1 or die "mutation"; s{(^VERITAS_B3_CHILD\|v1\|request=cr09-[0-9a-f]{32}-control-p-[0-9a-f]{32}\|case=CR-09\|[^\n]*\|pid=)[1-9][0-9]*$}{$1 . $builder_pid}me == 1 or die "mutation";'
reject_mutation wrong_binding_identity \
    's/(^VERITAS_CR09_BINDING\|v1\|[^\n]*\|p_builder_identity=)[0-9]+:[0-9]+/$1 . "0:1"/me == 1 or die "mutation";'
reject_mutation wrong_binding_source_a \
    's/(^VERITAS_CR09_BINDING\|v1\|[^\n]*\|a_source_main_digest=)[0-9a-f]{64}/$1 . ("0" x 64)/me == 1 or die "mutation";'
reject_mutation p_control_source_disagreement \
    's/(^VERITAS_B3_CHILD\|v1\|request=cr09-[0-9a-f]{32}-control-p-[^\n]*\|installed_source_main_digest=)[0-9a-f]{64}/$1 . ("0" x 64)/me == 1 or die "mutation";'
reject_mutation nonexistent_custody_path \
    's{(^VERITAS_CR09_CUSTODY\|v1\|[^\n]*\|p_source=/private/tmp/veritas-coherent-replacement-b3b-cr09-[0-9a-f]{32}-p-source-)[0-9A-Fa-f-]{36}}{$1 . "00000000-0000-0000-0000-000000000001"}me == 1 or die "mutation";'

accept_limit_mutation line_exact_swift_limit \
    'use bytes; $_ = ("A" x 1023) . "\n";'
reject_limit_mutation line_one_byte_over_swift_limit \
    'use bytes; $_ = ("B" x 1024) . "\n";'

[[ ${rejected_count} -eq 40 && ${accepted_control_count} -eq 1 \
   && ${evaluation_count} -eq 41 ]] || {
    print -u2 -- "CR09_PARSER_NEGATIVES_REFUSED: expected 40 rejections and 1 control, observed ${rejected_count}/${accepted_control_count}"
    exit 1
}

/usr/bin/env LC_ALL=C /usr/bin/sort -o "${manifest_path}" "${manifest_path}"
veritas_validate_cr09_mutation_manifest "${manifest_path}" "${transcript_sha256}" "${machine_sha256}" || {
    print -u2 -- 'CR09_PARSER_NEGATIVES_REFUSED: manifest validation failed'
    exit 2
}
manifest_bytes="$(/usr/bin/stat -f '%z' "${manifest_path}")"
manifest_sha256="$(/usr/bin/shasum -a 256 "${manifest_path}" | /usr/bin/awk '{print $1}')"
root_regular_files="$(/usr/bin/find "${fixture_root}" -type f -print | /usr/bin/wc -l \
    | /usr/bin/tr -d '[:space:]')"
root_logical_bytes="$(/usr/bin/find "${fixture_root}" -type f -exec /usr/bin/stat -f '%z' {} + \
    | /usr/bin/awk '{ total += $1 } END { print total + 0 }')"
root_quota_bytes=$(( 41 * (transcript_bytes + machine_bytes + 8192) + 131072 ))
[[ "${manifest_bytes}" == <-> && ${manifest_bytes} -gt 0 && ${manifest_bytes} -le 131072 \
   && "${root_regular_files}" == '44' \
   && "${root_logical_bytes}" == <-> && ${root_logical_bytes} -le ${root_quota_bytes} \
   && -z "$(/usr/bin/find "${fixture_root}" -mindepth 1 \
       \( -type d -o -type l -o ! -type f \) -print -quit)" ]] || {
    print -u2 -- 'CR09_PARSER_NEGATIVES_REFUSED: retained evidence exceeded its exact quota'
    exit 2
}
/usr/bin/find "${fixture_root}" -type f -exec /bin/chmod 400 {} +
/bin/chmod 500 "${fixture_root}"
[[ "$(( $(/usr/bin/find "${fixture_root}" -type f -perm 400 -print | /usr/bin/wc -l) ))" -eq 44 \
   && "$(/usr/bin/stat -f '%Lp' "${fixture_root}")" == '500' \
   && "$(/usr/bin/stat -f '%d:%i' "${fixture_root}")" == "${fixture_root_identity}" ]] || {
    print -u2 -- 'CR09_PARSER_NEGATIVES_REFUSED: retained evidence freeze failed'
    exit 2
}
veritas_validate_baseline_b_log "${base_transcript}" "${base_machine}" "${expected_helper_sha256}" 2>/dev/null || {
    print -u2 -- 'CR09_PARSER_NEGATIVES_REFUSED: base log lost positive-control validity during replay'
    exit 2
}
[[ "$(/usr/bin/shasum -a 256 "${parser_helper}" | /usr/bin/awk '{print $1}')" \
      == "${parser_sha256}" \
   && "$(/usr/bin/shasum -a 256 "${0:A}" | /usr/bin/awk '{print $1}')" \
      == "${harness_sha256}" \
   && "$(/usr/bin/stat -f '%z' "${base_transcript}")" == "${transcript_bytes}" \
   && "$(/usr/bin/shasum -a 256 "${base_transcript}" | /usr/bin/awk '{print $1}')" == "${transcript_sha256}" \
   && "$(/usr/bin/stat -f '%z' "${base_machine}")" == "${machine_bytes}" \
   && "$(/usr/bin/shasum -a 256 "${base_machine}" | /usr/bin/awk '{print $1}')" == "${machine_sha256}" ]] || {
    print -u2 -- 'CR09_PARSER_NEGATIVES_REFUSED: base or tool bytes changed during replay'
    exit 2
}

print -- "VERITAS_CR09_PARSER_NEGATIVE_RESULT|v4|rejection_cases=40|acceptance_controls=1|evaluations=41|transcript_bytes=${transcript_bytes}|transcript_sha256=${transcript_sha256}|machine_bytes=${machine_bytes}|machine_sha256=${machine_sha256}|parser_sha256=${parser_sha256}|harness_sha256=${harness_sha256}|manifest_bytes=${manifest_bytes}|mutation_manifest_sha256=${manifest_sha256}|root_regular_files=44|root_logical_bytes=${root_logical_bytes}|root_quota_bytes=${root_quota_bytes}|fixture_root_identity=${fixture_root_identity}|all_rejected=true|all_controls_passed=true|authorizing=false|channel_contract=transcript+machine|fixture_root=${fixture_root}"
