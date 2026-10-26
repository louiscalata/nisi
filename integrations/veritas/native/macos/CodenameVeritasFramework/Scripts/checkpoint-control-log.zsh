#!/bin/zsh

# Shared strict parser for private Checkpoint Control B test evidence.
# Source this file, then call veritas_validate_checkpoint_control_log with the
# nonempty human transcript and separate machine sink. It emits nothing and returns nonzero on any missing,
# duplicated, malformed, or contradictory required frame.

# Strict parser for CR-09/B3C evidence shared by both the complete checkpoint
# gate and the focused Baseline-B gate. Keeping this as one function prevents a
# focused run from receiving weaker custody, child-frame, or AB/BA validation.
veritas_validate_test_evidence_channels() {
    emulate -L zsh
    set -euo pipefail

    (( $# == 2 )) || return 2
    local transcript_path="${1}"
    local evidence_path="${2}"
    [[ -f "${transcript_path}" && ! -L "${transcript_path}" \
       && -s "${transcript_path}" \
       && -f "${evidence_path}" && ! -L "${evidence_path}" \
       && -s "${evidence_path}" ]] || return 2

    local evidence_bytes stripped_bytes utf8_bytes last_byte transcript_bytes
    # Preserve the original transcript byte checks after separating the channels.
    # Human Unicode is allowed, but binary corruption or a torn final line is not.
    transcript_bytes="$(/usr/bin/stat -f '%z' "${transcript_path}")"
    [[ "${transcript_bytes}" == <-> && ${transcript_bytes} -le 4194304 ]] || return 1
    stripped_bytes="$(/usr/bin/env LC_ALL=C /usr/bin/tr -d '\000' < "${transcript_path}" \
        | /usr/bin/wc -c | /usr/bin/tr -d '[:space:]')"
    utf8_bytes="$(/usr/bin/iconv -f UTF-8 -t UTF-8 < "${transcript_path}" 2>/dev/null \
        | /usr/bin/wc -c | /usr/bin/tr -d '[:space:]')" || return 1
    last_byte="$(/usr/bin/tail -c 1 "${transcript_path}" | /usr/bin/od -An -tu1 \
        | /usr/bin/tr -d '[:space:]')"
    [[ "${stripped_bytes}" == "${transcript_bytes}" \
       && "${utf8_bytes}" == "${transcript_bytes}" \
       && "${last_byte}" == '10' ]] || return 1
    evidence_bytes="$(/usr/bin/stat -f '%z' "${evidence_path}")"
    [[ "${evidence_bytes}" == <-> && ${evidence_bytes} -le 4194304 ]] || return 1
    stripped_bytes="$(/usr/bin/env LC_ALL=C /usr/bin/tr -d '\000' < "${evidence_path}" \
        | /usr/bin/wc -c | /usr/bin/tr -d '[:space:]')"
    utf8_bytes="$(/usr/bin/iconv -f UTF-8 -t UTF-8 < "${evidence_path}" 2>/dev/null \
        | /usr/bin/wc -c | /usr/bin/tr -d '[:space:]')" || return 1
    last_byte="$(/usr/bin/tail -c 1 "${evidence_path}" | /usr/bin/od -An -tu1 \
        | /usr/bin/tr -d '[:space:]')"
    [[ "${stripped_bytes}" == "${evidence_bytes}" \
       && "${utf8_bytes}" == "${evidence_bytes}" \
       && "${last_byte}" == '10' ]] || return 1

    /usr/bin/env LC_ALL=C /usr/bin/awk '
        length($0) + 1 > 262144 { invalid += 1 }
        $0 ~ /[[:cntrl:]]/ { invalid += 1 }
        !($0 ~ /^(VERITAS_BASELINE_A_RESULT\||VERITAS_BASELINE_B_RESULT\||VERITAS_CHECKPOINT_CONTROL_RESULT\||VERITAS_B3_CHILD\||VERITAS_CR09_CUSTODY\||VERITAS_CR09_BINDING\||VERITAS_CR09_ADVERSE_TRANSCRIPT\||VERITAS_FI08_EVIDENCE_JSON |VERITAS_FI09_EVIDENCE_JSON )/) { invalid += 1 }
        $0 !~ /^(VERITAS_FI08_EVIDENCE_JSON |VERITAS_FI09_EVIDENCE_JSON )/ \
            && $0 ~ /[^ -~]/ { invalid += 1 }
        END { if (NR == 0 || invalid != 0) exit 1 }
    ' "${evidence_path}" || return 1

    # A machine-looking fragment in the SwiftPM transcript is always refused;
    # the sink is the sole acceptance channel when these validators run.
    ! /usr/bin/env LC_ALL=C /usr/bin/grep -Eq 'VERITAS_[A-Z0-9_]' \
        "${transcript_path}"
}

veritas_validate_cr09_log() {
    emulate -L zsh
    set -euo pipefail

    (( $# >= 2 && $# <= 3 )) || return 2
    local test_log_path="${1}"
    local machine_evidence_path="${2}"
    local expected_helper_sha256="${3:-}"
    [[ -f "${test_log_path}" && ! -L "${test_log_path}" && -s "${test_log_path}" ]] \
        || return 2
    veritas_validate_test_evidence_channels \
        "${test_log_path}" "${machine_evidence_path}" || return 1
    if [[ -n "${expected_helper_sha256}" ]]; then
        /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${expected_helper_sha256}" || return 2
    fi

    local raw_byte_count nul_stripped_byte_count utf8_roundtrip_byte_count
    raw_byte_count="$(/usr/bin/wc -c < "${machine_evidence_path}" | /usr/bin/tr -d '[:space:]')"
    nul_stripped_byte_count="$(/usr/bin/env LC_ALL=C /usr/bin/tr -d '\000' < "${machine_evidence_path}" \
        | /usr/bin/wc -c | /usr/bin/tr -d '[:space:]')"
    [[ "${raw_byte_count}" == "${nul_stripped_byte_count}" ]] || return 1
    utf8_roundtrip_byte_count="$(/usr/bin/iconv -f UTF-8 -t UTF-8 < "${machine_evidence_path}" 2>/dev/null \
        | /usr/bin/wc -c | /usr/bin/tr -d '[:space:]')" || return 1
    [[ "${utf8_roundtrip_byte_count}" == "${raw_byte_count}" ]] || return 1

    # Refuse malformed or prefixed copies of every CR-09 marker even when the
    # admitted exact records are also present. Exact-prefix-only discovery
    # would otherwise ignore an extra versioned, reordered, or leading marker.
    /usr/bin/env LC_ALL=C /usr/bin/awk '
        index($0, "VERITAS_B3_CHILD") > 0 \
            && (index($0, "request=cr09-") > 0 || index($0, "CR-09") > 0) {
            count = split($0, fields, "|")
            if (index($0, "VERITAS_B3_CHILD|v1|") != 1 \
                || count < 4 || fields[4] != "case=CR-09") invalid += 1
        }
        index($0, "VERITAS_CR09_CUSTODY") > 0 {
            if (index($0, "VERITAS_CR09_CUSTODY|v1|") != 1) invalid += 1
        }
        index($0, "VERITAS_CR09_BINDING") > 0 {
            if (index($0, "VERITAS_CR09_BINDING|v1|") != 1) invalid += 1
        }
        index($0, "VERITAS_CR09_ADVERSE_TRANSCRIPT") > 0 { invalid += 1 }
        index($0, "VERITAS_BASELINE_B_RESULT") > 0 && index($0, "case=CR-09") > 0 {
            if (index($0, "VERITAS_BASELINE_B_RESULT|case=CR-09|") != 1) invalid += 1
        }
        END { if (invalid != 0) exit 1 }
    ' "${machine_evidence_path}" || return 1

    local title summary_count suite_start_count
    suite_start_count="$(/usr/bin/awk '
        $0 == "◇ Suite \"Founder Alpha coherent replacement Baseline B3C closed sibling fork\" started." {
            count += 1
        }
        END { print count + 0 }
    ' "${test_log_path}")"
    [[ "${suite_start_count}" == "1" ]] || return 1

    title='CR-09 exact closed sibling successors are admitted in AB and BA order'
    summary_count="$(/usr/bin/awk -v title="${title}" '
        $0 ~ ("^✔ Test \"" title "\" passed after [0-9]+([.][0-9]+)? seconds[.]$") {
            count += 1
        }
        END { print count + 0 }
    ' "${test_log_path}")"
    [[ "${summary_count}" == "1" ]] || return 1

    /usr/bin/awk '
        function field_value(field, prefix) {
            if (index(field, prefix) != 1) return ""
            return substr(field, length(prefix) + 1)
        }
        function digest(value) {
            return length(value) == 64 && value !~ /[^0-9a-f]/
        }
        function uuid(value, compact) {
            if (length(value) != 36) return 0
            if (substr(value, 9, 1) != "-" || substr(value, 14, 1) != "-" \
                || substr(value, 19, 1) != "-" || substr(value, 24, 1) != "-") return 0
            compact = value
            gsub(/-/, "", compact)
            return length(compact) == 32 && compact !~ /[^0-9A-Fa-f]/
        }
        BEGIN {
            role_key[1] = "p_builder"; role_name[1] = "p-builder"
            role_key[2] = "p_source"; role_name[2] = "p-source"
            role_key[3] = "p_control"; role_name[3] = "p-control"
            role_key[4] = "a_builder"; role_name[4] = "a-builder"
            role_key[5] = "b_builder"; role_name[5] = "b-builder"
            role_key[6] = "a_source"; role_name[6] = "a-source"
            role_key[7] = "b_source"; role_name[7] = "b-source"
            role_key[8] = "a_control"; role_name[8] = "a-control"
            role_key[9] = "b_control"; role_name[9] = "b-control"
            role_key[10] = "order_ab"; role_name[10] = "order-ab"
            role_key[11] = "order_ba"; role_name[11] = "order-ba"
        }
        index($0, "VERITAS_CR09_ADVERSE_TRANSCRIPT|") == 1 { adverse += 1 }
        index($0, "VERITAS_B3_CHILD|v1|") == 1 {
            split($0, child_fields, "|")
            if (child_fields[4] == "case=CR-09") {
                request = field_value(child_fields[3], "request=")
                if (length(request) < 39 || substr(request, 1, 5) != "cr09-" \
                    || substr(request, 38, 1) != "-") invalid += 1
                child_family[request] = substr(request, 6, 32)
                child_total += 1
            }
        }
        index($0, "VERITAS_CR09_CUSTODY|") == 1 {
            custody_total += 1
            count = split($0, fields, "|")
            family = field_value(fields[3], "family=")
            valid = count == 15 && fields[1] == "VERITAS_CR09_CUSTODY" \
                && fields[2] == "v1" && length(family) == 32 \
                && family !~ /[^0-9a-f]/ && fields[15] == "authorizing=false"
            for (i = 1; i <= 11; i += 1) {
                path = field_value(fields[i + 3], role_key[i] "=")
                prefix = "/private/tmp/veritas-coherent-replacement-b3b-cr09-" \
                    family "-" role_name[i] "-"
                suffix = substr(path, length(prefix) + 1)
                if (index(path, prefix) != 1 || !uuid(suffix) || path_seen[path] != 0) {
                    valid = 0
                }
                path_seen[path] += 1
            }
            if (!valid) invalid += 1
            custody_family = family
        }
        index($0, "VERITAS_BASELINE_B_RESULT|case=CR-09|") == 1 {
            parent_total += 1
            count = split($0, fields, "|")
            repetition = field_value(fields[4], "repetition=")
            order = field_value(fields[7], "order=")
            h0 = field_value(fields[8], "h0=")
            ha = field_value(fields[9], "ha=")
            hb = field_value(fields[10], "hb=")
            pa = field_value(fields[11], "stored_predecessor_a=")
            pb = field_value(fields[12], "stored_predecessor_b=")
            sa = field_value(fields[13], "pristine_source_main_a_digest=")
            sb = field_value(fields[14], "pristine_source_main_b_digest=")
            first = field_value(fields[15], "first_head=")
            second = field_value(fields[16], "second_head=")
            valid = count == 32 && fields[1] == "VERITAS_BASELINE_B_RESULT" \
                && fields[2] == "case=CR-09" && fields[3] == "target=closed-sibling-fork" \
                && fields[5] == "classification=LIMITATION_REPRODUCED" \
                && fields[6] == "outcome=BOTH_CLOSED_SIBLING_SUCCESSORS_ADMITTED_SEQUENTIALLY_WITHOUT_PROTECTED_FORK_CHOICE" \
                && ((repetition == "0" && order == "AB") || (repetition == "1" && order == "BA")) \
                && digest(h0) && digest(ha) && digest(hb) && digest(pa) && digest(pb) \
                && digest(sa) && digest(sb) && digest(first) && digest(second) \
                && pa == h0 && pb == h0 && h0 != ha && h0 != hb && ha != hb && sa != sb \
                && fields[17] == "shared_predecessor=true" \
                && fields[18] == "distinct_heads=true" \
                && fields[19] == "distinct_source_main_digests=true" \
                && fields[20] == "branch_a_exact=true" \
                && fields[21] == "branch_b_exact=true" \
                && fields[22] == "same_scope=true" \
                && fields[23] == "same_canonical_project_path_within_order=true" \
                && fields[24] == "same_relative_path_shape_across_orders=true" \
                && fields[25] == "all_children_reaped=true" \
                && fields[26] == "pristine_main_only_before_each_open=true" \
                && fields[27] == "no_live_handles_at_namespace_switches=true" \
                && fields[28] == "closed_projects_retired_intact=true" \
                && fields[29] == "pristine_sources_unchanged=true" \
                && fields[30] == "parent_roots_retained_no_recursive_delete=true" \
                && fields[31] == "protected_authority_verified=false" \
                && fields[32] == "authorizing=false"
            if (!valid || parent_seen[order] != 0) invalid += 1
            parent_seen[order] += 1
            ph0[order] = h0; pha[order] = ha; phb[order] = hb
            psa[order] = sa; psb[order] = sb
            pfirst[order] = first; psecond[order] = second
        }
        END {
            if (custody_total != 1 || child_total != 10 || parent_total != 2 \
                || parent_seen["AB"] != 1 || parent_seen["BA"] != 1 || adverse != 0) invalid += 1
            for (request in child_family) {
                if (child_family[request] != custody_family) invalid += 1
            }
            if (ph0["AB"] != ph0["BA"] || pha["AB"] != pha["BA"] \
                || phb["AB"] != phb["BA"] || psa["AB"] != psa["BA"] \
                || psb["AB"] != psb["BA"] || pfirst["AB"] != pha["AB"] \
                || psecond["AB"] != phb["AB"] || pfirst["BA"] != phb["BA"] \
                || psecond["BA"] != pha["BA"]) invalid += 1
            if (invalid != 0) exit 1
        }
    ' "${machine_evidence_path}" || return 1

    # The first pass validates custody and the parent oracle. This second pass
    # binds every emitted child to its exact request role, field grammar, family,
    # chain head, source digest, and AB/BA presentation position. It also applies
    # the frozen ASCII and byte bounds used by the in-test parser.
    /usr/bin/env LC_ALL=C /usr/bin/awk '
        function field_value(field, prefix) {
            if (index(field, prefix) != 1) return ""
            return substr(field, length(prefix) + 1)
        }
        function digest(value) {
            return length(value) == 64 && value !~ /[^0-9a-f]/
        }
        function compact_uuid(value) {
            return length(value) == 32 && value !~ /[^0-9a-f]/
        }
        function positive_decimal(value) {
            return value ~ /^[1-9][0-9]*$/
        }
        function positive_int32(value) {
            return positive_decimal(value) \
                && (length(value) < 10 || (length(value) == 10 && value + 0 <= 2147483647))
        }
        function identity(value, parts) {
            return split(value, parts, ":") == 2 \
                && parts[1] ~ /^(0|[1-9][0-9]*)$/ \
                && parts[2] ~ /^(0|[1-9][0-9]*)$/
        }
        function printable_bounded(value, limit) {
            return length(value) + 1 <= limit && value !~ /[^ -~]/
        }
        index($0, "VERITAS_B3_CHILD") > 0 \
            && (index($0, "request=cr09-") > 0 || index($0, "CR-09") > 0) {
            if (index($0, "VERITAS_B3_CHILD|v1|") != 1) {
                invalid += 1
                next
            }
            field_count = split($0, probe, "|")
            if (probe[4] != "case=CR-09") {
                invalid += 1
                next
            }
            child_total += 1
            if (!printable_bounded($0, 1024)) invalid += 1
            request = field_value(probe[3], "request=")
            family = substr(request, 6, 32)
            suffix = substr(request, 39)
            nonce = substr(suffix, length(suffix) - 31)
            role = substr(suffix, 1, length(suffix) - 32)
            if (substr(request, 1, 5) != "cr09-" || substr(request, 38, 1) != "-" \
                || !compact_uuid(family) || !compact_uuid(nonce) \
                || child_request_seen[request] != 0) invalid += 1
            child_request_seen[request] += 1
            child_family[request] = family

            variant = field_value(probe[5], "variant=")
            if (variant == "FORK_BUILD") {
                node = field_value(probe[6], "node=")
                expected_role = "build-" tolower(node) "-"
                events = node == "P" ? "1" : "2"
                predecessor = field_value(probe[9], "stored_predecessor_digest=")
                head = field_value(probe[10], "head_digest=")
                pid = field_value(probe[13], "pid=")
                valid = field_count == 13 && (node == "P" || node == "A" || node == "B") \
                    && role == expected_role && probe[7] == "phase=CLOSED_AND_INSPECTED_EXACT" \
                    && probe[8] == "events=" events && digest(predecessor) && digest(head) \
                    && probe[11] == "post_close_inventory_admitted=true" \
                    && probe[12] == "authorizing=false" \
                    && positive_int32(pid)
                if (!valid || build_seen[node] != 0) invalid += 1
                build_seen[node] += 1
                build_predecessor[node] = predecessor
                build_head[node] = head
                build_pid[node] = pid
            } else if (variant == "FORK_SOURCE_CONTROL") {
                node = field_value(probe[6], "node=")
                expected_role = "control-" tolower(node) "-"
                events = node == "P" ? "1" : "2"
                baseline = field_value(probe[9], "baseline_event_digest=")
                predecessor = field_value(probe[10], "stored_predecessor_digest=")
                head = field_value(probe[11], "head_digest=")
                source = field_value(probe[12], "installed_source_main_digest=")
                pid = field_value(probe[15], "pid=")
                valid = field_count == 15 && (node == "P" || node == "A" || node == "B") \
                    && role == expected_role && probe[7] == "phase=ADMITTED_EXACT" \
                    && probe[8] == "events=" events && digest(baseline) \
                    && digest(predecessor) && digest(head) && digest(source) \
                    && probe[13] == "post_close_inventory_admitted=true" \
                    && probe[14] == "authorizing=false" \
                    && positive_int32(pid)
                if (!valid || control_seen[node] != 0) invalid += 1
                control_seen[node] += 1
                control_baseline[node] = baseline
                control_predecessor[node] = predecessor
                control_head[node] = head
                control_source[node] = source
                control_pid[node] = pid
            } else if (variant == "FORK_PRESENTATION") {
                repetition = field_value(probe[6], "repetition=")
                order = field_value(probe[7], "order=")
                position = field_value(probe[8], "position=")
                branch = field_value(probe[9], "branch=")
                key = order ":" position
                expected_role = "present-" tolower(order) "-" tolower(position) "-"
                expected_branch = (key == "AB:FIRST" || key == "BA:SECOND") ? "A" : "B"
                expected_repetition = order == "AB" ? "0" : "1"
                baseline = field_value(probe[12], "baseline_event_digest=")
                predecessor = field_value(probe[13], "stored_predecessor_digest=")
                branch_head = field_value(probe[14], "branch_event_digest=")
                head = field_value(probe[15], "head_digest=")
                source = field_value(probe[16], "installed_source_main_digest=")
                pid = field_value(probe[25], "pid=")
                valid = field_count == 25 \
                    && (key == "AB:FIRST" || key == "AB:SECOND" \
                        || key == "BA:FIRST" || key == "BA:SECOND") \
                    && repetition == expected_repetition && branch == expected_branch \
                    && role == expected_role && probe[10] == "phase=ADMITTED_EXACT" \
                    && probe[11] == "events=2" && digest(baseline) \
                    && digest(predecessor) && digest(branch_head) && digest(head) \
                    && digest(source) && baseline == predecessor \
                    && branch_head == head && probe[17] == "baseline_present=true" \
                    && probe[18] == "expected_branch_present=true" \
                    && probe[19] == "opposite_branch_present=false" \
                    && probe[20] == "pristine_main_only_before_open=true" \
                    && probe[21] == "closed_project_inventory_exact=true" \
                    && probe[22] == "post_close_inventory_admitted=true" \
                    && probe[23] == "protected_authority_verified=false" \
                    && probe[24] == "authorizing=false" \
                    && positive_int32(pid)
                if (!valid || presentation_seen[key] != 0) invalid += 1
                presentation_seen[key] += 1
                presentation_baseline[key] = baseline
                presentation_head[key] = head
                presentation_source[key] = source
                presentation_branch[key] = branch
                presentation_pid[key] = pid
            } else {
                invalid += 1
            }
        }
        index($0, "VERITAS_CR09_BINDING") > 0 {
            binding_total += 1
            if (index($0, "VERITAS_CR09_BINDING|v1|") != 1 \
                || !printable_bounded($0, 4096)) {
                invalid += 1
                next
            }
            field_count = split($0, binding, "|")
            binding_family = field_value(binding[3], "family=")
            binding_helper = field_value(binding[4], "helper_binary_sha256=")
            binding_source["P"] = field_value(binding[5], "p_source_main_digest=")
            binding_source["A"] = field_value(binding[6], "a_source_main_digest=")
            binding_source["B"] = field_value(binding[7], "b_source_main_digest=")
            binding_pid["p_builder"] = field_value(binding[8], "p_builder_pid=")
            binding_pid["p_control"] = field_value(binding[9], "p_control_pid=")
            binding_pid["a_builder"] = field_value(binding[10], "a_builder_pid=")
            binding_pid["b_builder"] = field_value(binding[11], "b_builder_pid=")
            binding_pid["a_control"] = field_value(binding[12], "a_control_pid=")
            binding_pid["b_control"] = field_value(binding[13], "b_control_pid=")
            binding_pid["ab_first"] = field_value(binding[14], "ab_first_pid=")
            binding_pid["ab_second"] = field_value(binding[15], "ab_second_pid=")
            binding_pid["ba_first"] = field_value(binding[16], "ba_first_pid=")
            binding_pid["ba_second"] = field_value(binding[17], "ba_second_pid=")
            binding_identity["p_builder"] = field_value(binding[18], "p_builder_identity=")
            binding_identity["p_source"] = field_value(binding[19], "p_source_identity=")
            binding_identity["p_control"] = field_value(binding[20], "p_control_identity=")
            binding_identity["a_builder"] = field_value(binding[21], "a_builder_identity=")
            binding_identity["b_builder"] = field_value(binding[22], "b_builder_identity=")
            binding_identity["a_source"] = field_value(binding[23], "a_source_identity=")
            binding_identity["b_source"] = field_value(binding[24], "b_source_identity=")
            binding_identity["a_control"] = field_value(binding[25], "a_control_identity=")
            binding_identity["b_control"] = field_value(binding[26], "b_control_identity=")
            binding_identity["order_ab"] = field_value(binding[27], "order_ab_identity=")
            binding_identity["order_ba"] = field_value(binding[28], "order_ba_identity=")
            valid = field_count == 29 && compact_uuid(binding_family) \
                && digest(binding_helper) && digest(binding_source["P"]) \
                && digest(binding_source["A"]) && digest(binding_source["B"]) \
                && binding[29] == "authorizing=false"
            pid_count = 0
            for (pid_role in binding_pid) {
                pid_count += 1
                candidate_pid = binding_pid[pid_role]
                if (!positive_int32(candidate_pid) || binding_pid_seen[candidate_pid] != 0) {
                    valid = 0
                }
                binding_pid_seen[candidate_pid] += 1
            }
            identity_count = 0
            for (identity_role in binding_identity) {
                identity_count += 1
                candidate_identity = binding_identity[identity_role]
                if (!identity(candidate_identity) \
                    || binding_identity_seen[candidate_identity] != 0) valid = 0
                binding_identity_seen[candidate_identity] += 1
            }
            if (pid_count != 10 || identity_count != 11) valid = 0
            if (!valid) invalid += 1
        }
        index($0, "VERITAS_CR09_CUSTODY|") == 1 {
            if (!printable_bounded($0, 4096)) invalid += 1
            split($0, custody_fields, "|")
            custody_family = field_value(custody_fields[3], "family=")
        }
        index($0, "VERITAS_BASELINE_B_RESULT|case=CR-09|") == 1 {
            if (!printable_bounded($0, 2048)) invalid += 1
            split($0, parent, "|")
            order = field_value(parent[7], "order=")
            parent_h0[order] = field_value(parent[8], "h0=")
            parent_ha[order] = field_value(parent[9], "ha=")
            parent_hb[order] = field_value(parent[10], "hb=")
            parent_source_a[order] = field_value(parent[13], "pristine_source_main_a_digest=")
            parent_source_b[order] = field_value(parent[14], "pristine_source_main_b_digest=")
        }
        END {
            genesis = "d1aa6e848bafc99c0a9789496990747ffc9d0e738328511832dcc0ecc7557866"
            if (child_total != 10 || binding_total != 1 \
                || build_seen["P"] != 1 || build_seen["A"] != 1 \
                || build_seen["B"] != 1 || control_seen["P"] != 1 \
                || control_seen["A"] != 1 || control_seen["B"] != 1 \
                || presentation_seen["AB:FIRST"] != 1 \
                || presentation_seen["AB:SECOND"] != 1 \
                || presentation_seen["BA:FIRST"] != 1 \
                || presentation_seen["BA:SECOND"] != 1) invalid += 1
            for (request in child_family) {
                if (child_family[request] != custody_family \
                    || child_family[request] != binding_family) invalid += 1
            }
            h0 = parent_h0["AB"]; ha = parent_ha["AB"]; hb = parent_hb["AB"]
            source_a = parent_source_a["AB"]; source_b = parent_source_b["AB"]
            if (binding_family != custody_family \
                || binding_source["A"] != source_a \
                || binding_source["B"] != source_b) invalid += 1
            if (build_predecessor["P"] != genesis || build_head["P"] != h0 \
                || build_predecessor["A"] != h0 || build_predecessor["B"] != h0 \
                || build_head["A"] != ha || build_head["B"] != hb) invalid += 1
            if (control_baseline["P"] != h0 || control_predecessor["P"] != genesis \
                || control_head["P"] != h0 || control_baseline["A"] != h0 \
                || control_predecessor["A"] != h0 || control_head["A"] != ha \
                || control_baseline["B"] != h0 || control_predecessor["B"] != h0 \
                || control_head["B"] != hb \
                || control_source["P"] != binding_source["P"] \
                || control_source["A"] != source_a \
                || control_source["B"] != source_b) invalid += 1
            if (build_pid["P"] != binding_pid["p_builder"] \
                || control_pid["P"] != binding_pid["p_control"] \
                || build_pid["A"] != binding_pid["a_builder"] \
                || build_pid["B"] != binding_pid["b_builder"] \
                || control_pid["A"] != binding_pid["a_control"] \
                || control_pid["B"] != binding_pid["b_control"] \
                || presentation_pid["AB:FIRST"] != binding_pid["ab_first"] \
                || presentation_pid["AB:SECOND"] != binding_pid["ab_second"] \
                || presentation_pid["BA:FIRST"] != binding_pid["ba_first"] \
                || presentation_pid["BA:SECOND"] != binding_pid["ba_second"]) invalid += 1
            for (key in presentation_seen) {
                expected_head = presentation_branch[key] == "A" ? ha : hb
                expected_source = presentation_branch[key] == "A" ? source_a : source_b
                if (presentation_baseline[key] != h0 \
                    || presentation_head[key] != expected_head \
                    || presentation_source[key] != expected_source) invalid += 1
            }
            if (invalid != 0) exit 1
        }
    ' "${machine_evidence_path}" || return 1

    local custody_line binding_line observed_helper_sha256
    custody_line="$(/usr/bin/awk '
        index($0, "VERITAS_CR09_CUSTODY|v1|") == 1 { print }
    ' "${machine_evidence_path}")"
    binding_line="$(/usr/bin/awk '
        index($0, "VERITAS_CR09_BINDING|v1|") == 1 { print }
    ' "${machine_evidence_path}")"
    [[ -n "${custody_line}" && -n "${binding_line}" ]] || return 1
    local -a custody_fields binding_fields
    custody_fields=("${(@s:|:)custody_line}")
    binding_fields=("${(@s:|:)binding_line}")
    (( ${#custody_fields[@]} == 15 && ${#binding_fields[@]} == 29 )) || return 1
    observed_helper_sha256="${binding_fields[4]#helper_binary_sha256=}"
    [[ -z "${expected_helper_sha256}" \
       || "${observed_helper_sha256}" == "${expected_helper_sha256}" ]] || return 1

    # Re-stat every intentionally retained root and bind the live directory
    # identity to both the custody path and the exact binding frame. Syntax-only
    # paths are insufficient because a valid-looking nonexistent replacement
    # must fail closed.
    local -a custody_roles
    custody_roles=(
        p_builder p_source p_control a_builder b_builder a_source b_source
        a_control b_control order_ab order_ba
    )
    local index role path identity stat_record
    local -a stat_fields
    for index in {1..11}; do
        role="${custody_roles[index]}"
        path="${custody_fields[index + 3]#${role}=}"
        identity="${binding_fields[index + 17]#${role}_identity=}"
        stat_record="$(/usr/bin/stat -f '%HT|%u|%Lp|%d:%i' "${path}")" || return 1
        stat_fields=("${(@s:|:)stat_record}")
        [[ ${#stat_fields[@]} -eq 4 \
           && "${stat_fields[1]}" == 'Directory' \
           && "${stat_fields[2]}" == "$(/usr/bin/id -u)" \
           && "${stat_fields[3]}" == '700' \
           && "${stat_fields[4]}" == "${identity}" ]] || return 1
    done
}

veritas_cr09_binding_helper_sha256() {
    emulate -L zsh
    set -euo pipefail

    (( $# == 1 )) || return 2
    local test_log_path="${1}"
    [[ -f "${test_log_path}" && ! -L "${test_log_path}" && -s "${test_log_path}" ]] \
        || return 2
    /usr/bin/env LC_ALL=C /usr/bin/awk -F '|' '
        index($0, "VERITAS_CR09_BINDING|v1|") == 1 {
            count += 1
            if ($4 !~ /^helper_binary_sha256=[0-9a-f]{64}$/) invalid += 1
            value = substr($4, length("helper_binary_sha256=") + 1)
        }
        END {
            if (count != 1 || invalid != 0) exit 1
            print value
        }
    ' "${test_log_path}"
}

veritas_cr09_binding_frame_sha256() {
    emulate -L zsh
    set -euo pipefail

    (( $# == 1 )) || return 2
    local test_log_path="${1}"
    [[ -f "${test_log_path}" && ! -L "${test_log_path}" && -s "${test_log_path}" ]] \
        || return 2
    local frame_count
    frame_count="$(/usr/bin/awk '
        index($0, "VERITAS_CR09_BINDING|v1|") == 1 { count += 1 }
        END { print count + 0 }
    ' "${test_log_path}")"
    [[ "${frame_count}" == "1" ]] || return 1
    /usr/bin/awk '
        index($0, "VERITAS_CR09_BINDING|v1|") == 1 { print }
    ' "${test_log_path}" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}'
}

# Exact primitive used by the parser-negative harness to prove the same
# newline-inclusive ASCII byte boundary as Swift without inventing a PID that
# Swift could not represent. The file must contain exactly one printable-ASCII
# record and exactly one trailing LF.
veritas_validate_cr09_ascii_line_limit() {
    emulate -L zsh
    set -euo pipefail

    (( $# == 2 )) || return 2
    local input_path="${1}"
    local byte_limit="${2}"
    [[ -f "${input_path}" && ! -L "${input_path}" && -s "${input_path}" \
       && "${byte_limit}" == <-> && ${byte_limit} -gt 0 \
       && ${byte_limit} -le 4096 ]] || return 2
    local metrics line_count content_bytes printable raw_bytes
    metrics="$(/usr/bin/env LC_ALL=C /usr/bin/awk '
        NR == 1 {
            content_bytes = length($0)
            printable = $0 !~ /[^ -~]/
        }
        END { printf "%d\t%d\t%d", NR, content_bytes + 0, printable + 0 }
    ' "${input_path}")"
    IFS=$'\t' read -r line_count content_bytes printable <<< "${metrics}"
    raw_bytes="$(/usr/bin/wc -c < "${input_path}" | /usr/bin/tr -d '[:space:]')"
    [[ "${line_count}" == '1' && "${printable}" == '1' \
       && ${raw_bytes} -eq $(( content_bytes + 1 )) \
       && ${raw_bytes} -le ${byte_limit} ]]
}

veritas_validate_cr09_mutation_manifest() {
    emulate -L zsh
    set -euo pipefail

    (( $# == 3 )) || return 2
    local manifest_path="${1}"
    local transcript_sha256="${2}"
    local machine_sha256="${3}"
    [[ -f "${manifest_path}" && ! -L "${manifest_path}" && -s "${manifest_path}" ]] \
        || return 2
    /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${transcript_sha256}" || return 2
    /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${machine_sha256}" || return 2
    /usr/bin/cmp -s "${manifest_path}" \
        <(/usr/bin/env LC_ALL=C /usr/bin/sort "${manifest_path}") || return 1
    /usr/bin/env LC_ALL=C /usr/bin/awk -F '\t' -v transcript="${transcript_sha256}" -v machine="${machine_sha256}" '
        BEGIN {
            split("adverse_transcript authorizing_parent crlf_child cross_order_digest_disagreement duplicate_binding duplicate_binding_pid duplicate_child duplicate_custody duplicate_suite duplicate_summary extra_child_field extra_child_leading_marker extra_child_reordered_case extra_child_version extra_malformed_binding invalid_custody_path invalid_utf8_child malformed_custody_family missing_ab_parent missing_binding missing_child missing_custody missing_suite missing_summary nonexistent_custody_path noncanonical_repetition nul_child old_twenty_frame_log oversized_child oversized_custody oversized_parent p_control_source_disagreement unknown_baseline_marker wrong_binding_helper wrong_binding_identity wrong_binding_source_a wrong_child_family wrong_child_role wrong_child_variant", baseline_rejections, " ")
            for (i in baseline_rejections) {
                label = baseline_rejections[i]
                expected_validator[label] = "BASELINE"
                expected_outcome[label] = "REJECT"
                expected_channel[label] = "MACHINE"
                expected_count += 1
            }
            expected_channel["missing_suite"] = "TRANSCRIPT"
            expected_channel["duplicate_suite"] = "TRANSCRIPT"
            expected_channel["missing_summary"] = "TRANSCRIPT"
            expected_channel["duplicate_summary"] = "TRANSCRIPT"
            expected_validator["line_exact_swift_limit"] = "ASCII_1024"
            expected_outcome["line_exact_swift_limit"] = "ACCEPT"
            expected_channel["line_exact_swift_limit"] = "MACHINE"
            expected_validator["line_one_byte_over_swift_limit"] = "ASCII_1024"
            expected_outcome["line_one_byte_over_swift_limit"] = "REJECT"
            expected_channel["line_one_byte_over_swift_limit"] = "MACHINE"
            expected_count += 2
        }
        NF != 11 { invalid += 1; next }
        {
            label = $1
            validator = $2
            outcome = $3
            channel = $4
            after = $9
            if (!(label in expected_validator) \
                || validator != expected_validator[label] \
                || outcome != expected_outcome[label] \
                || channel != expected_channel[label] \
                || $5 != transcript || $6 !~ /^[1-9][0-9]*$/ \
                || $7 != machine || $8 !~ /^[1-9][0-9]*$/ \
                || length(after) != 64 || after ~ /[^0-9a-f]/ \
                || after == (channel == "TRANSCRIPT" ? transcript : machine) \
                || $10 !~ /^[1-9][0-9]*$/ \
                || $10 > ((channel == "TRANSCRIPT" ? $6 : $8) + 8192) \
                || $11 != outcome \
                || label_seen[label]++ != 0 || digest_seen[after]++ != 0) invalid += 1
            if (outcome == "REJECT") rejected += 1
            if (outcome == "ACCEPT") accepted += 1
        }
        END {
            for (label in expected_validator) {
                if (label_seen[label] != 1) invalid += 1
            }
            if (expected_count != 41 || NR != 41 || rejected != 40 \
                || accepted != 1 || invalid != 0) exit 1
        }
    ' "${manifest_path}"
}

veritas_validate_cr09_parser_negative_receipt() {
    emulate -L zsh
    set -euo pipefail

    (( $# == 5 )) || return 2
    local test_log_path="${1}"
    local transcript_path="${2}"
    local machine_path="${3}"
    local parser_helper_path="${4}"
    local harness_path="${5}"
    [[ -f "${test_log_path}" && ! -L "${test_log_path}" && -s "${test_log_path}" \
       && -f "${transcript_path}" && ! -L "${transcript_path}" && -s "${transcript_path}" \
       && -f "${machine_path}" && ! -L "${machine_path}" && -s "${machine_path}" \
       && -f "${parser_helper_path}" && ! -L "${parser_helper_path}" \
       && -f "${harness_path}" && ! -L "${harness_path}" ]] \
        || return 2
    local receipt_snapshot raw_transcript_bytes raw_machine_bytes
    receipt_snapshot="$(/usr/bin/stat -f '%HT|%u|%Lp|%l|%z' "${test_log_path}")" || return 2
    [[ "${receipt_snapshot}" == "Regular File|$(/usr/bin/id -u)|600|1|"* ]] || return 2
    local receipt_size
    receipt_size="$(/usr/bin/stat -f '%z' "${test_log_path}")"
    [[ "${receipt_size}" == <-> && ${receipt_size} -gt 0 && ${receipt_size} -le 8192 ]] || return 2
    [[ "$(/usr/bin/tail -c 1 "${test_log_path}" | /usr/bin/od -An -t x1 | /usr/bin/tr -d '[:space:]')" == '0a' ]] || return 2
    /usr/bin/env LC_ALL=C /usr/bin/awk '
        NR != 1 || $0 !~ /^[ -~]+$/ { invalid = 1 }
        END { exit (NR == 1 && invalid == 0) ? 0 : 1 }
    ' "${test_log_path}" || return 2
    raw_transcript_bytes="$(/usr/bin/stat -f '%z' "${transcript_path}")" || return 2
    raw_machine_bytes="$(/usr/bin/stat -f '%z' "${machine_path}")" || return 2
    [[ "${raw_transcript_bytes}" == <-> && ${raw_transcript_bytes} -gt 0 \
       && ${raw_transcript_bytes} -le 4194304 \
       && "${raw_machine_bytes}" == <-> && ${raw_machine_bytes} -gt 0 \
       && ${raw_machine_bytes} -le 4194304 ]] || return 2

    # Refuse every hidden, prefixed, stale-version, or duplicate receipt marker
    # before interpreting the exact final v4 record. Transcript and machine
    # bytes are independently bound; this validator never reconstructs a
    # merged view.
    /usr/bin/env LC_ALL=C /usr/bin/awk '
        index($0, "VERITAS_CR09_PARSER_NEGATIVE_RESULT") > 0 {
            broad_count += 1
            if (index($0, "VERITAS_CR09_PARSER_NEGATIVE_RESULT|v4|") != 1) invalid += 1
        }
        index($0, "VERITAS_CR09_PARSER_NEGATIVE_RESULT|v4|") == 1 {
            exact_count += 1
        }
        END {
            if (broad_count != 1 || exact_count != 1 || invalid != 0) exit 1
        }
    ' "${test_log_path}" || return 1

    local receipt_line
    receipt_line="$(/usr/bin/tail -n 1 "${test_log_path}")"
    [[ "${receipt_line}" == VERITAS_CR09_PARSER_NEGATIVE_RESULT\|v4\|* \
       && "${receipt_line}" != *$'\r'* ]] || return 1

    local -a receipt_fields
    receipt_fields=("${(@s:|:)receipt_line}")
    (( ${#receipt_fields[@]} == 22 )) || return 1
    [[ "${receipt_fields[1]}" == 'VERITAS_CR09_PARSER_NEGATIVE_RESULT' \
       && "${receipt_fields[2]}" == 'v4' \
       && "${receipt_fields[3]}" == 'rejection_cases=40' \
       && "${receipt_fields[4]}" == 'acceptance_controls=1' \
       && "${receipt_fields[5]}" == 'evaluations=41' \
       && "${receipt_fields[14]}" == 'root_regular_files=44' \
       && "${receipt_fields[18]}" == 'all_rejected=true' \
       && "${receipt_fields[19]}" == 'all_controls_passed=true' \
       && "${receipt_fields[20]}" == 'authorizing=false' \
       && "${receipt_fields[21]}" == 'channel_contract=transcript+machine' ]] || return 1

    local transcript_bytes="${receipt_fields[6]#transcript_bytes=}"
    local transcript_sha256="${receipt_fields[7]#transcript_sha256=}"
    local machine_bytes="${receipt_fields[8]#machine_bytes=}"
    local machine_sha256="${receipt_fields[9]#machine_sha256=}"
    local parser_sha256="${receipt_fields[10]#parser_sha256=}"
    local harness_sha256="${receipt_fields[11]#harness_sha256=}"
    local manifest_bytes="${receipt_fields[12]#manifest_bytes=}"
    local manifest_sha256="${receipt_fields[13]#mutation_manifest_sha256=}"
    local root_logical_bytes="${receipt_fields[15]#root_logical_bytes=}"
    local root_quota_bytes="${receipt_fields[16]#root_quota_bytes=}"
    local fixture_root_identity="${receipt_fields[17]#fixture_root_identity=}"
    local fixture_root="${receipt_fields[22]#fixture_root=}"
    [[ "${receipt_fields[6]}" == "transcript_bytes=${transcript_bytes}" \
       && "${receipt_fields[7]}" == "transcript_sha256=${transcript_sha256}" \
       && "${receipt_fields[8]}" == "machine_bytes=${machine_bytes}" \
       && "${receipt_fields[9]}" == "machine_sha256=${machine_sha256}" \
       && "${receipt_fields[10]}" == "parser_sha256=${parser_sha256}" \
       && "${receipt_fields[11]}" == "harness_sha256=${harness_sha256}" \
       && "${receipt_fields[12]}" == "manifest_bytes=${manifest_bytes}" \
       && "${receipt_fields[13]}" == "mutation_manifest_sha256=${manifest_sha256}" \
       && "${receipt_fields[15]}" == "root_logical_bytes=${root_logical_bytes}" \
       && "${receipt_fields[16]}" == "root_quota_bytes=${root_quota_bytes}" \
       && "${receipt_fields[17]}" == "fixture_root_identity=${fixture_root_identity}" \
       && "${receipt_fields[22]}" == "fixture_root=${fixture_root}" ]] || return 1
    local numeric_value
    for numeric_value in \
        "${transcript_bytes}" "${machine_bytes}" "${manifest_bytes}" \
        "${root_logical_bytes}" "${root_quota_bytes}"; do
        # The largest possible quota under the two 4 MiB input caps is
        # 344399872 bytes. Bound decimal width BEFORE shell arithmetic so
        # oversized receipt integers cannot wrap into an admitted value.
        /usr/bin/grep -Eq '^[1-9][0-9]{0,8}$' <<< "${numeric_value}" || return 1
    done
    (( transcript_bytes <= 4194304 && machine_bytes <= 4194304 && manifest_bytes <= 131072 )) || return 1
    /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${transcript_sha256}" || return 1
    /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${machine_sha256}" || return 1
    /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${parser_sha256}" || return 1
    /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${harness_sha256}" || return 1
    /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${manifest_sha256}" || return 1
    /usr/bin/grep -Eq '^[0-9]+:[1-9][0-9]*$' <<< "${fixture_root_identity}" || return 1
    /usr/bin/grep -Eq '^/private/tmp/veritas-cr09-parser-negatives[.][A-Za-z0-9]{6}$' \
        <<< "${fixture_root}" || return 1
    [[ "$(/usr/bin/stat -f '%HT|%u|%Lp|%l|%z' "${transcript_path}")" \
          == "Regular File|$(/usr/bin/id -u)|600|1|${transcript_bytes}" \
       && "$(/usr/bin/stat -f '%HT|%u|%Lp|%l|%z' "${machine_path}")" \
          == "Regular File|$(/usr/bin/id -u)|600|1|${machine_bytes}" \
       && "$(/usr/bin/shasum -a 256 "${transcript_path}" | /usr/bin/awk '{print $1}')" \
          == "${transcript_sha256}" \
       && "$(/usr/bin/shasum -a 256 "${machine_path}" | /usr/bin/awk '{print $1}')" \
          == "${machine_sha256}" ]] || return 1

    local current_parser_sha256 current_harness_sha256
    current_parser_sha256="$(/usr/bin/shasum -a 256 "${parser_helper_path}" \
        | /usr/bin/awk '{print $1}')"
    current_harness_sha256="$(/usr/bin/shasum -a 256 "${harness_path}" \
        | /usr/bin/awk '{print $1}')"
    [[ "${parser_sha256}" == "${current_parser_sha256}" \
       && "${harness_sha256}" == "${current_harness_sha256}" ]] || return 1

    local -i expected_root_quota_bytes=$(( 41 * (transcript_bytes + machine_bytes + 8192) + 131072 ))
    (( root_quota_bytes == expected_root_quota_bytes \
       && root_logical_bytes <= root_quota_bytes )) || return 1

    local manifest_path="${fixture_root}/mutation-manifest.tsv"
    local current_uid root_snapshot manifest_snapshot
    current_uid="$(/usr/bin/id -u)"
    root_snapshot="$(/usr/bin/stat -f '%HT|%u|%Lp|%d:%i' "${fixture_root}")" \
        || return 1
    manifest_snapshot="$(/usr/bin/stat -f '%HT|%u|%Lp|%l|%z' "${manifest_path}")" \
        || return 1
    [[ "${root_snapshot}" == "Directory|${current_uid}|500|${fixture_root_identity}" \
       && "${manifest_snapshot}" == "Regular File|${current_uid}|400|1|${manifest_bytes}" \
       && "$(/usr/bin/shasum -a 256 "${manifest_path}" | /usr/bin/awk '{print $1}')" \
            == "${manifest_sha256}" ]] || return 1

    local root_regular_files observed_root_logical_bytes
    root_regular_files="$(/usr/bin/find "${fixture_root}" -type f -print \
        | /usr/bin/wc -l | /usr/bin/tr -d '[:space:]')"
    observed_root_logical_bytes="$(/usr/bin/find "${fixture_root}" -type f \
        -exec /usr/bin/stat -f '%z' {} + \
        | /usr/bin/awk '{ total += $1 } END { print total + 0 }')"
    [[ "${root_regular_files}" == '44' \
       && "${observed_root_logical_bytes}" == "${root_logical_bytes}" \
       && ${root_logical_bytes} -le ${root_quota_bytes} \
       && -z "$(/usr/bin/find "${fixture_root}" -mindepth 1 \
           \( -type d -o -type l -o ! -type f \) -print -quit)" ]] || return 1

    local expected_helper_sha256
    local pristine_transcript="${fixture_root}/pristine-transcript.log"
    local pristine_machine="${fixture_root}/pristine-machine.log"
    expected_helper_sha256="$(veritas_cr09_binding_helper_sha256 "${machine_path}")" || return 1
    veritas_validate_baseline_b_log \
        "${transcript_path}" "${machine_path}" "${expected_helper_sha256}" 2>/dev/null || return 1
    veritas_validate_cr09_mutation_manifest "${manifest_path}" "${transcript_sha256}" "${machine_sha256}" \
        || return 1
    local label validator expectation channel row_transcript_sha256 row_transcript_bytes
    local row_machine_sha256 row_machine_bytes after_sha256 after_bytes observed fixture
    local fixture_snapshot replay_accepted
    local -i manifest_rows=0 rejection_rows=0 acceptance_rows=0
    while IFS=$'\t' read -r label validator expectation channel row_transcript_sha256 row_transcript_bytes \
        row_machine_sha256 row_machine_bytes after_sha256 after_bytes observed; do
        /usr/bin/grep -Eq '^[a-z0-9_]+$' <<< "${label}" || return 1
        /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${after_sha256}" || return 1
        [[ "${after_bytes}" == <-> \
           && ${after_bytes} -gt 0 \
           && ( "${validator}" == 'BASELINE' || "${validator}" == 'ASCII_1024' ) \
           && ( "${expectation}" == 'REJECT' || "${expectation}" == 'ACCEPT' ) \
           && ( "${channel}" == 'TRANSCRIPT' || "${channel}" == 'MACHINE' ) \
           && "${row_transcript_sha256}" == "${transcript_sha256}" \
           && "${row_transcript_bytes}" == "${transcript_bytes}" \
           && "${row_machine_sha256}" == "${machine_sha256}" \
           && "${row_machine_bytes}" == "${machine_bytes}" \
           && "${observed}" == "${expectation}" ]] || return 1
        fixture="${fixture_root}/${label}.${(L)channel}.log"
        fixture_snapshot="$(/usr/bin/stat -f '%HT|%u|%Lp|%l|%z' "${fixture}")" \
            || return 1
        [[ "${fixture_snapshot}" == "Regular File|${current_uid}|400|1|${after_bytes}" \
           && "$(/usr/bin/shasum -a 256 "${fixture}" | /usr/bin/awk '{print $1}')" \
                == "${after_sha256}" ]] || return 1
        replay_accepted=false
        local candidate_transcript="${pristine_transcript}"
        local candidate_machine="${pristine_machine}"
        if [[ "${channel}" == 'TRANSCRIPT' ]]; then
            candidate_transcript="${fixture}"
        else
            candidate_machine="${fixture}"
        fi
        if [[ "${validator}" == 'BASELINE' ]] \
           && veritas_validate_baseline_b_log \
                "${candidate_transcript}" "${candidate_machine}" "${expected_helper_sha256}" 2>/dev/null; then
            replay_accepted=true
        elif [[ "${validator}" == 'ASCII_1024' ]] \
             && veritas_validate_cr09_ascii_line_limit "${candidate_machine}" 1024; then
            replay_accepted=true
        fi
        if [[ "${replay_accepted}" == true ]]; then
            [[ "${expectation}" == 'ACCEPT' ]] || return 1
            acceptance_rows+=1
        else
            [[ "${expectation}" == 'REJECT' ]] || return 1
            rejection_rows+=1
        fi
        manifest_rows+=1
    done < "${manifest_path}"
    (( manifest_rows == 41 && rejection_rows == 40 && acceptance_rows == 1 )) || return 1

    # Close both the positive base control and the retained mutation replay
    # against the same live custody roots and frozen manifest snapshots.
    veritas_validate_baseline_b_log \
        "${transcript_path}" "${machine_path}" "${expected_helper_sha256}" 2>/dev/null || return 1
    [[ "$(/usr/bin/stat -f '%HT|%u|%Lp|%d:%i' "${fixture_root}")" \
            == "${root_snapshot}" \
       && "$(/usr/bin/stat -f '%HT|%u|%Lp|%l|%z' "${manifest_path}")" \
            == "${manifest_snapshot}" \
       && "$(/usr/bin/shasum -a 256 "${manifest_path}" | /usr/bin/awk '{print $1}')" \
            == "${manifest_sha256}" ]] || return 1

    local close_parser_sha256 close_harness_sha256 close_fixture_snapshot
    local -i close_fixture_rows=0
    close_parser_sha256="$(/usr/bin/shasum -a 256 "${parser_helper_path}" \
        | /usr/bin/awk '{print $1}')"
    close_harness_sha256="$(/usr/bin/shasum -a 256 "${harness_path}" \
        | /usr/bin/awk '{print $1}')"
    [[ "${close_parser_sha256}" == "${parser_sha256}" \
       && "${close_harness_sha256}" == "${harness_sha256}" \
       && "$(/usr/bin/stat -f '%HT|%u|%Lp|%l|%z' "${test_log_path}")" == "${receipt_snapshot}" \
       && "$(/usr/bin/shasum -a 256 "${transcript_path}" | /usr/bin/awk '{print $1}')" \
            == "${transcript_sha256}" \
       && "$(/usr/bin/stat -f '%z' "${transcript_path}")" == "${transcript_bytes}" \
       && "$(/usr/bin/shasum -a 256 "${machine_path}" | /usr/bin/awk '{print $1}')" \
            == "${machine_sha256}" \
       && "$(/usr/bin/stat -f '%z' "${machine_path}")" == "${machine_bytes}" ]] || return 1
    while IFS=$'\t' read -r label validator expectation channel row_transcript_sha256 row_transcript_bytes \
        row_machine_sha256 row_machine_bytes after_sha256 after_bytes observed; do
        fixture="${fixture_root}/${label}.${(L)channel}.log"
        close_fixture_snapshot="$(/usr/bin/stat -f '%HT|%u|%Lp|%l|%z' "${fixture}")" \
            || return 1
        [[ "${close_fixture_snapshot}" \
              == "Regular File|${current_uid}|400|1|${after_bytes}" \
           && "$(/usr/bin/shasum -a 256 "${fixture}" | /usr/bin/awk '{print $1}')" \
              == "${after_sha256}" ]] || return 1
        close_fixture_rows+=1
    done < "${manifest_path}"
    (( close_fixture_rows == 41 )) || return 1
    [[ "$(/usr/bin/stat -f '%HT|%u|%Lp|%l|%z' "${pristine_transcript}")" \
            == "Regular File|${current_uid}|400|1|${transcript_bytes}" \
       && "$(/usr/bin/stat -f '%HT|%u|%Lp|%l|%z' "${pristine_machine}")" \
            == "Regular File|${current_uid}|400|1|${machine_bytes}" \
       && "$(/usr/bin/shasum -a 256 "${pristine_transcript}" | /usr/bin/awk '{print $1}')" \
            == "${transcript_sha256}" \
       && "$(/usr/bin/shasum -a 256 "${pristine_machine}" | /usr/bin/awk '{print $1}')" \
            == "${machine_sha256}" ]] || return 1
    root_regular_files="$(/usr/bin/find "${fixture_root}" -type f -print \
        | /usr/bin/wc -l | /usr/bin/tr -d '[:space:]')"
    observed_root_logical_bytes="$(/usr/bin/find "${fixture_root}" -type f \
        -exec /usr/bin/stat -f '%z' {} + \
        | /usr/bin/awk '{ total += $1 } END { print total + 0 }')"
    [[ "$(/usr/bin/stat -f '%HT|%u|%Lp|%d:%i' "${fixture_root}")" \
            == "${root_snapshot}" \
       && "$(/usr/bin/stat -f '%HT|%u|%Lp|%l|%z' "${manifest_path}")" \
            == "${manifest_snapshot}" \
       && "$(/usr/bin/shasum -a 256 "${manifest_path}" | /usr/bin/awk '{print $1}')" \
            == "${manifest_sha256}" \
       && "${root_regular_files}" == '44' \
       && "${observed_root_logical_bytes}" == "${root_logical_bytes}" \
       && -z "$(/usr/bin/find "${fixture_root}" -mindepth 1 \
           \( -type d -o -type l -o ! -type f \) -print -quit)" ]] || return 1
}

veritas_validate_checkpoint_control_log() {
    emulate -L zsh
    set -euo pipefail

    (( $# == 2 )) || return 2
    local test_log_path="${1}"
    local machine_evidence_path="${2}"
    [[ -f "${test_log_path}" && ! -L "${test_log_path}" && -s "${test_log_path}" ]] \
        || return 2
    veritas_validate_test_evidence_channels \
        "${test_log_path}" "${machine_evidence_path}" || return 1

    local title summary_count case_line result_line repetition failure_case
    local -a repeated_titles
    repeated_titles=(
        'CR-12 normal control preserves exact event accounting across close and reopen'
        'CR-06 same-handle control prevents primary advancement before named-main close'
        'CR-08 accepts a coherent older closed store after live advancement'
    )
    for title in "${repeated_titles[@]}"; do
        summary_count="$(/usr/bin/awk -v title="${title}" '
            $0 ~ ("^✔ Test \"" title "\" with 2 test cases passed after [0-9]+([.][0-9]+)? seconds[.]$") {
                count += 1
            }
            END { print count + 0 }
        ' "${test_log_path}")"
        [[ "${summary_count}" == "1" ]] || return 1
        for repetition in 0 1; do
            case_line="◇ Test case passing 1 argument repetition → ${repetition} to \"${title}\" started."
            [[ "$(/usr/bin/awk -v expected="${case_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${test_log_path}")" == "1" ]] \
                || return 1
        done
    done

    title='Checkpoint policy readback mismatch refuses first open and cleans the new store'
    summary_count="$(/usr/bin/awk -v title="${title}" '
        $0 ~ ("^✔ Test \"" title "\" passed after [0-9]+([.][0-9]+)? seconds[.]$") {
            count += 1
        }
        END { print count + 0 }
    ' "${test_log_path}")"
    [[ "${summary_count}" == "1" ]] || return 1

    title='Synthetic non-success and incomplete checkpoint accounting refuse but remain retryable'
    summary_count="$(/usr/bin/awk -v title="${title}" '
        $0 ~ ("^✔ Test \"" title "\" with 2 test cases passed after [0-9]+([.][0-9]+)? seconds[.]$") {
            count += 1
        }
        END { print count + 0 }
    ' "${test_log_path}")"
    [[ "${summary_count}" == "1" ]] || return 1
    for failure_case in '.nonSuccess' '.incompleteAccounting'; do
        case_line="◇ Test case passing 1 argument failure → ${failure_case} to \"${title}\" started."
        [[ "$(/usr/bin/awk -v expected="${case_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${test_log_path}")" == "1" ]] \
            || return 1
    done

    for repetition in 0 1; do
        result_line="VERITAS_BASELINE_A_RESULT|case=CR-12|repetition=${repetition}|classification=NORMAL_CONTROL_COMPLETE|events=2"
        [[ "$(/usr/bin/awk -v expected="${result_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${machine_evidence_path}")" == "1" ]] \
            || return 1
        result_line="VERITAS_BASELINE_A_RESULT|case=CR-08|repetition=${repetition}|classification=ADMITTED_OLDER_STATE|older_events=1|advanced_events=2|rolled_back_events=1"
        [[ "$(/usr/bin/awk -v expected="${result_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${machine_evidence_path}")" == "1" ]] \
            || return 1
    done

    /usr/bin/awk '
        function numeric_value(field, prefix) {
            if (index(field, prefix) != 1) return -1
            value = substr(field, length(prefix) + 1)
            if (value !~ /^[0-9][0-9]*$/) return -1
            return value + 0
        }
        index($0, "VERITAS_BASELINE_A_RESULT|case=CR-06|") == 1 {
            field_count = split($0, fields, "|")
            repetition = numeric_value(fields[3], "repetition=")
            threshold = numeric_value(fields[5], "same_handle_threshold=")
            former_threshold = numeric_value(fields[6], "former_default_threshold=")
            frames = numeric_value(fields[7], "physical_frames=")
            primary = numeric_value(fields[8], "primary_event_count_before_close=")
            live = numeric_value(fields[9], "live_event_count=")
            sqlite_version = numeric_value(fields[10], "sqlite_version_number=")
            digest = substr(fields[11], length("sqlite_source_id_digest=") + 1)
            valid = field_count == 11 \
                && fields[2] == "case=CR-06" \
                && (repetition == 0 || repetition == 1) \
                && fields[4] == "classification=CHECKPOINT_CONTROLLED_BEFORE_CLOSE" \
                && threshold == 0 \
                && former_threshold > 0 \
                && frames > former_threshold \
                && primary == 1 \
                && live > primary \
                && sqlite_version > 0 \
                && index(fields[11], "sqlite_source_id_digest=") == 1 \
                && length(digest) == 64 \
                && digest !~ /[^0-9a-f]/
            if (!valid) invalid += 1
            live_by_repetition[repetition] = live
            baseline_seen[repetition] += 1
            baseline_total += 1
        }
        index($0, "VERITAS_CHECKPOINT_CONTROL_RESULT|case=CR-06|") == 1 {
            field_count = split($0, fields, "|")
            repetition = numeric_value(fields[3], "repetition=")
            result = numeric_value(fields[5], "result=")
            log_frames = numeric_value(fields[6], "log_frames=")
            checkpointed_frames = numeric_value(fields[7], "checkpointed_frames=")
            post_close_events = numeric_value(fields[8], "post_close_primary_events=")
            valid = field_count == 8 \
                && fields[2] == "case=CR-06" \
                && (repetition == 0 || repetition == 1) \
                && fields[4] == "classification=NAMED_MAIN_FULL_CHECKPOINT_COMPLETE" \
                && result == 0 \
                && log_frames > 0 \
                && checkpointed_frames == log_frames \
                && post_close_events > 1
            if (!valid) invalid += 1
            post_by_repetition[repetition] = post_close_events
            checkpoint_seen[repetition] += 1
            checkpoint_total += 1
        }
        END {
            if (invalid != 0 \
                || baseline_total != 2 \
                || baseline_seen[0] != 1 || baseline_seen[1] != 1 \
                || checkpoint_total != 2 \
                || checkpoint_seen[0] != 1 || checkpoint_seen[1] != 1 \
                || post_by_repetition[0] != live_by_repetition[0] \
                || post_by_repetition[1] != live_by_repetition[1]) exit 1
        }
    ' "${machine_evidence_path}" || return 1

    result_line='VERITAS_CHECKPOINT_CONTROL_RESULT|case=POLICY_READBACK_REFUSAL|classification=TEST_ONLY_SYNTHETIC_REFUSAL|synthetic_readback_override=1'
    [[ "$(/usr/bin/awk -v expected="${result_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${machine_evidence_path}")" == "1" ]] \
        || return 1
    result_line='VERITAS_CHECKPOINT_CONTROL_RESULT|case=nonSuccess|classification=TEST_ONLY_SYNTHETIC_REFUSAL_THEN_REAL_RETRY|synthetic_result=5|synthetic_log_frames=12|synthetic_checkpointed_frames=4|retry_result=0'
    [[ "$(/usr/bin/awk -v expected="${result_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${machine_evidence_path}")" == "1" ]] \
        || return 1
    result_line='VERITAS_CHECKPOINT_CONTROL_RESULT|case=incompleteAccounting|classification=TEST_ONLY_SYNTHETIC_REFUSAL_THEN_REAL_RETRY|synthetic_result=0|synthetic_log_frames=12|synthetic_checkpointed_frames=11|retry_result=0'
    [[ "$(/usr/bin/awk -v expected="${result_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${machine_evidence_path}")" == "1" ]] \
        || return 1

    /usr/bin/awk '
        index($0, "VERITAS_BASELINE_A_") == 1 { baseline_a += 1 }
        index($0, "VERITAS_CHECKPOINT_CONTROL_") == 1 { checkpoint_control += 1 }
        END {
            if (baseline_a != 6 || checkpoint_control != 5) exit 1
        }
    ' "${machine_evidence_path}" || return 1
}

# Strict parser for the tests-first coherent-replacement Baseline B slice. A
# green fixture may mean either an exact safe refusal or a reproduced limitation;
# the classification and outcome are therefore part of the required frame.
veritas_validate_baseline_b_log() {
    emulate -L zsh
    set -euo pipefail

    (( $# >= 2 && $# <= 3 )) || return 2
    local test_log_path="${1}"
    local machine_evidence_path="${2}"
    local expected_helper_sha256="${3:-}"
    [[ -f "${test_log_path}" && ! -L "${test_log_path}" && -s "${test_log_path}" ]] \
        || return 2

    veritas_validate_cr09_log "${test_log_path}" "${machine_evidence_path}" \
        "${expected_helper_sha256}" || return 1

    local title summary_count case_line result_line repetition
    local -a titles
    titles=(
        'CR-02 replacement directory is mutated before the first public integrity refusal'
        'CR-03 main A-B-A publishes durably while COMMIT reports failure and rollback poisons'
        'CR-03 directory A-B-A after the final check remains invisible to COMMIT'
        'CR-07 restored main-WAL ABA is refused by named-main checkpoint before test-only abort recovery'
        'CR-10 same-UID child writes while the project-directory flock is held'
    )
    for title in "${titles[@]}"; do
        summary_count="$(/usr/bin/awk -v title="${title}" '
            $0 ~ ("^✔ Test \"" title "\" with 2 test cases passed after [0-9]+([.][0-9]+)? seconds[.]$") {
                count += 1
            }
            END { print count + 0 }
        ' "${test_log_path}")"
        [[ "${summary_count}" == "1" ]] || return 1
        for repetition in 0 1; do
            case_line="◇ Test case passing 1 argument repetition → ${repetition} to \"${title}\" started."
            [[ "$(/usr/bin/awk -v expected="${case_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${test_log_path}")" == "1" ]] \
                || return 1
        done
    done

    for repetition in 0 1; do
        result_line="VERITAS_BASELINE_B_RESULT|case=CR-02|target=directory|repetition=${repetition}|classification=LIMITATION_REPRODUCED|outcome=BOOTSTRAP_MUTATED_REPLACEMENT_BEFORE_PUBLIC_REFUSAL|authorizing=false"
        [[ "$(/usr/bin/awk -v expected="${result_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${machine_evidence_path}")" == "1" ]] \
            || return 1
        result_line="VERITAS_BASELINE_B_RESULT|case=CR-03|target=main|repetition=${repetition}|classification=LIMITATION_REPRODUCED|outcome=COMMIT_PUBLISHED_DESPITE_REPORTED_ROLLBACK_FAILURE|authorizing=false"
        [[ "$(/usr/bin/awk -v expected="${result_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${machine_evidence_path}")" == "1" ]] \
            || return 1
        result_line="VERITAS_BASELINE_B_RESULT|case=CR-03|target=directory|repetition=${repetition}|classification=LIMITATION_REPRODUCED|outcome=COMMIT_SUCCEEDED_AFTER_UNOBSERVED_ABA|authorizing=false"
        [[ "$(/usr/bin/awk -v expected="${result_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${machine_evidence_path}")" == "1" ]] \
            || return 1
        result_line="VERITAS_BASELINE_B_RESULT|case=CR-07|target=main-wal|repetition=${repetition}|classification=SAFE_REFUSAL|outcome=CHECKPOINT_REFUSED_TEST_ABORT_REOPEN_PRESERVED|authorizing=false"
        [[ "$(/usr/bin/awk -v expected="${result_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${machine_evidence_path}")" == "1" ]] \
            || return 1
        result_line="VERITAS_BASELINE_B_RESULT|case=CR-10|target=project-directory|repetition=${repetition}|classification=LIMITATION_REPRODUCED|outcome=NONCONFORMING_CHILD_WRITE_SUCCEEDED_WHILE_FLOCK_HELD|authorizing=false"
        [[ "$(/usr/bin/awk -v expected="${result_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${machine_evidence_path}")" == "1" ]] \
            || return 1
    done

    local -a b2_titles
    b2_titles=(
        'CR-01 isolated child admits alternate main across restored A-B-A around sqlite3_open_v2'
        'CR-05 post-kill removed SHM reaches one bounded restart disposition'
        'CR-05 post-kill corrupted SHM reaches one bounded restart disposition'
    )
    for title in "${b2_titles[@]}"; do
        summary_count="$(/usr/bin/awk -v title="${title}" '
            $0 ~ ("^✔ Test \"" title "\" with 2 test cases passed after [0-9]+([.][0-9]+)? seconds[.]$") {
                count += 1
            }
            END { print count + 0 }
        ' "${test_log_path}")"
        [[ "${summary_count}" == "1" ]] || return 1
        for repetition in 0 1; do
            case_line="◇ Test case passing 1 argument repetition → ${repetition} to \"${title}\" started."
            [[ "$(/usr/bin/awk -v expected="${case_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${test_log_path}")" == "1" ]] \
                || return 1
        done
    done

    for repetition in 0 1; do
        result_line="VERITAS_BASELINE_B_RESULT|case=CR-01|target=main-open|repetition=${repetition}|classification=RUNTIME_REFUSAL|outcome=SQLITE_OPEN_ADMITTED_B_BOOTSTRAP_REFUSED_IOERR_A_RECOVERY_UNCHANGED|sqlite_code=10|kill_signal=9|reaped=true|main_a_events=1|baseline_head_verified=true|authorizing=false"
        [[ "$(/usr/bin/awk -v expected="${result_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${machine_evidence_path}")" == "1" ]] \
            || return 1
        result_line="VERITAS_BASELINE_B_RESULT|case=CR-05|target=post-kill-shm-remove|repetition=${repetition}|classification=SAFE_RECOVERY|outcome=VALID_WAL_EXACT_STATE_RECOVERED_WITH_ADMISSIBLE_SHM_REBUILD|kill_signal=9|reaped=true|main_only_events=1|wal_control_events=2|recovered_events=2|recovery_head_matches_wal_control=true|shm_admitted=true|authorizing=false"
        [[ "$(/usr/bin/awk -v expected="${result_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${machine_evidence_path}")" == "1" ]] \
            || return 1
        result_line="VERITAS_BASELINE_B_RESULT|case=CR-05|target=post-kill-shm-corrupt|repetition=${repetition}|classification=SAFE_RECOVERY|outcome=VALID_WAL_EXACT_STATE_RECOVERED_WITH_ADMISSIBLE_SHM_REBUILD|kill_signal=9|reaped=true|main_only_events=1|wal_control_events=2|recovered_events=2|recovery_head_matches_wal_control=true|shm_admitted=true|authorizing=false"
        [[ "$(/usr/bin/awk -v expected="${result_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${machine_evidence_path}")" == "1" ]] \
            || return 1
    done

    local b3_title
    b3_title='CR-04 post-reap byte-identical WAL identity replacement recovers the exact control head'
    summary_count="$(/usr/bin/awk -v title="${b3_title}" '
        $0 ~ ("^✔ Test \"" title "\" with 2 test cases passed after [0-9]+([.][0-9]+)? seconds[.]$") {
            count += 1
        }
        END { print count + 0 }
    ' "${test_log_path}")"
    [[ "${summary_count}" == "1" ]] || return 1
    for repetition in 0 1; do
        case_line="◇ Test case passing 1 argument repetition → ${repetition} to \"${b3_title}\" started."
        [[ "$(/usr/bin/awk -v expected="${case_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${test_log_path}")" == "1" ]] \
            || return 1
        result_line="VERITAS_BASELINE_B_RESULT|case=CR-04|target=post-reap-wal-identity|repetition=${repetition}|classification=LIMITATION_REPRODUCED|outcome=BYTE_IDENTICAL_DORMANT_WAL_REPLACEMENT_ADMITTED_EXACT_CONTROL_HEAD|kill_signal=9|reaped=true|main_only_events=1|wal_control_events=2|recovered_events=2|replacement_identity_distinct=true|wal_bytes_equal=true|recovery_head_matches_wal_control=true|no_shm_at_mutation=true|authorizing=false"
        [[ "$(/usr/bin/awk -v expected="${result_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${machine_evidence_path}")" == "1" ]] \
            || return 1
    done

    local b3b_title
    b3b_title='CR-04 post-reap divergent valid dormant WAL branch substitution recovers exact branch B'
    summary_count="$(/usr/bin/awk -v title="${b3b_title}" '
        $0 ~ ("^✔ Test \"" title "\" with 2 test cases passed after [0-9]+([.][0-9]+)? seconds[.]$") {
            count += 1
        }
        END { print count + 0 }
    ' "${test_log_path}")"
    [[ "${summary_count}" == "1" ]] || return 1
    for repetition in 0 1; do
        case_line="◇ Test case passing 1 argument repetition → ${repetition} to \"${b3b_title}\" started."
        [[ "$(/usr/bin/awk -v expected="${case_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${test_log_path}")" == "1" ]] \
            || return 1
        result_line="VERITAS_BASELINE_B_RESULT|case=CR-04|target=post-reap-wal-divergent|repetition=${repetition}|classification=LIMITATION_REPRODUCED|outcome=DIVERGENT_VALID_DORMANT_WAL_B_ADMITTED_EXACT_BRANCH_B_HEAD|branch_a_kill_signal=9|branch_b_kill_signal=9|all_children_reaped=true|main_only_events=1|branch_a_control_events=2|branch_b_control_events=2|recovered_events=2|branch_a_present=false|branch_b_present=true|branch_heads_distinct=true|branch_wal_bytes_distinct=true|branch_wal_digests_distinct=true|main_unchanged_through_swap=true|canonical_wal_pre_recovery_is_branch_b=true|alternate_wal_pre_recovery_is_branch_a=true|recovery_head_matches_branch_b_control=true|no_shm_at_mutation_pre_recovery=true|parent_roots_retained_no_recursive_delete=true|authorizing=false"
        [[ "$(/usr/bin/awk -v expected="${result_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${machine_evidence_path}")" == "1" ]] \
            || return 1
    done

    /usr/bin/awk '
        index($0, "VERITAS_BASELINE_B_") == 1 {
            total += 1
            if (index($0, "VERITAS_BASELINE_B_RESULT|") != 1) invalid += 1
            if (NF != 1) invalid += 1
            split($0, fields, "|")
            if (fields[2] == "case=CR-02" \
                || fields[2] == "case=CR-03" \
                || fields[2] == "case=CR-07" \
                || fields[2] == "case=CR-10") {
                b1_total += 1
            } else if (fields[2] == "case=CR-01" || fields[2] == "case=CR-05") {
                b2_total += 1
            } else if (fields[2] == "case=CR-04" \
                && fields[3] == "target=post-reap-wal-identity") {
                b3a_total += 1
            } else if (fields[2] == "case=CR-04" \
                && fields[3] == "target=post-reap-wal-divergent") {
                b3b_total += 1
            } else if (fields[2] == "case=CR-09" \
                && fields[3] == "target=closed-sibling-fork") {
                b3c_total += 1
            } else {
                invalid += 1
            }
        }
        END {
            if (invalid != 0 || b1_total != 10 || b2_total != 6 \
                || b3a_total != 2 || b3b_total != 2 || b3c_total != 2 \
                || total != 22) exit 1
        }
    ' "${machine_evidence_path}" || return 1
}
