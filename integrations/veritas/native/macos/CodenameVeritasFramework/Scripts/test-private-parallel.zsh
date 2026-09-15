#!/bin/zsh

# Fast private developer loop only.
#
# This runs the same package tests under the admitted Xcode 27 and Xcode 26.6
# toolchains concurrently, with separate scratch directories and logs. It does
# not upload a build, contact TestFlight/App Store Connect, seal evidence, or
# grant any roadmap/acceptance/release credit. Formal evidence still uses the
# one-shot batch verifiers and comparator.

emulate -L zsh
set -euo pipefail
setopt noclobber
umask 077
PATH='/usr/bin:/bin:/usr/sbin:/sbin'
export PATH
zmodload zsh/parameter || {
    print -u2 -- "PARALLEL_TEST_REFUSED: zsh job-state ownership is unavailable"
    exit 2
}

script_dir="${0:A:h}"
package_root="${script_dir:h}"
checkpoint_control_helper="${script_dir}/checkpoint-control-log.zsh"
parser_negative_helper="${script_dir}/test-cr09-parser-negatives.zsh"
[[ -f "${checkpoint_control_helper}" && ! -L "${checkpoint_control_helper}" ]] || {
    print -u2 -- "PARALLEL_TEST_REFUSED: checkpoint-control parser is unavailable"
    exit 2
}
[[ -f "${parser_negative_helper}" && ! -L "${parser_negative_helper}" ]] || {
    print -u2 -- "PARALLEL_TEST_REFUSED: CR-09 parser-negative harness is unavailable"
    exit 2
}
source "${checkpoint_control_helper}"
if (( $# != 0 )); then
    print -u2 -- "PARALLEL_TEST_REFUSED: caller-supplied output roots are not admitted"
    exit 2
fi
run_root="$(/usr/bin/mktemp -d /private/tmp/veritas-private-parallel.XXXXXX)"
if [[ ! -d "${run_root}" || -L "${run_root}" \
      || "$(/usr/bin/stat -f '%u' "${run_root}")" != "$(/usr/bin/id -u)" \
      || "$(/usr/bin/stat -f '%Lp' "${run_root}")" != "700" \
      || -n "$(/usr/bin/find "${run_root}" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    print -u2 -- "PARALLEL_TEST_REFUSED: mktemp did not produce one private empty directory"
    exit 2
fi

typeset -a lane_names developer_dirs expected_xcodes expected_xcode_builds
typeset -a expected_swifts expected_sdks expected_sdk_paths
typeset -a swift_bins sdk_roots lane_roots log_paths machine_paths machine_devices
typeset -a machine_inodes parser_receipt_paths helper_receipt_paths pids
lane_names=(xcode-27 xcode-26.6)
developer_dirs=(
    /Applications/Xcode-27.0.app/Contents/Developer
    /Applications/Xcode.app/Contents/Developer
)
expected_xcodes=(27.0 26.6)
expected_xcode_builds=(27A5228h 17F113)
expected_swifts=(6.4 6.3.3)
expected_sdks=(27.0 26.5)
expected_sdk_paths=(
    /Applications/Xcode-27.0.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX27.0.sdk
    /Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.5.sdk
)
swift_bins=()
sdk_roots=()
lane_roots=()
log_paths=()
machine_paths=()
machine_devices=()
machine_inodes=()
parser_receipt_paths=()
helper_receipt_paths=()
pids=()

# Validate both complete toolchain lanes and allocate every private output target
# before starting either child. A setup failure therefore cannot strand the
# other lane as an untracked background process.
for index in {1..2}; do
    lane="${lane_names[index]}"
    developer_dir="${developer_dirs[index]}"
    developer_dir="${developer_dir:A}"
    expected_developer_dir="${developer_dirs[index]}"
    [[ "${developer_dir}" == "${expected_developer_dir}" \
       && -d "${developer_dir}" && ! -L "${developer_dir}" ]] || {
        print -u2 -- "PARALLEL_TEST_REFUSED: invalid Developer directory for ${lane}"
        exit 2
    }

    xcode_version_output="$(/usr/bin/env -u SDKROOT -u TOOLCHAINS \
        DEVELOPER_DIR="${developer_dir}" /usr/bin/xcodebuild -version)"
    observed_xcode="$(/usr/bin/awk 'NR == 1 { print $2 }' <<< "${xcode_version_output}")"
    observed_xcode_build="$(/usr/bin/awk 'NR == 2 { print $3 }' <<< "${xcode_version_output}")"
    [[ "${observed_xcode}" == "${expected_xcodes[index]}" \
       && "${observed_xcode_build}" == "${expected_xcode_builds[index]}" ]] || {
        print -u2 -- "PARALLEL_TEST_REFUSED: Xcode identity mismatch for ${lane}"
        exit 2
    }

    swift_bin="$(/usr/bin/env -u SDKROOT -u TOOLCHAINS \
        DEVELOPER_DIR="${developer_dir}" /usr/bin/xcrun --find swift)"
    expected_swift_bin="${developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift"
    [[ "${swift_bin}" == "${expected_swift_bin}" && -L "${swift_bin}" \
       && "$(/usr/bin/readlink "${swift_bin}")" == "swift-frontend" \
       && "${swift_bin:A}" == "${developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-frontend" \
       && -f "${swift_bin:A}" && ! -L "${swift_bin:A}" ]] || {
        print -u2 -- "PARALLEL_TEST_REFUSED: Swift executable identity mismatch for ${lane}"
        exit 2
    }
    observed_swift="$(/usr/bin/env -u SDKROOT -u TOOLCHAINS \
        DEVELOPER_DIR="${developer_dir}" "${swift_bin}" --version 2>/dev/null \
        | /usr/bin/sed -nE 's/.*Apple Swift version ([^ ]+).*/\1/p' \
        | /usr/bin/head -1)"
    [[ "${observed_swift}" == "${expected_swifts[index]}" ]] || {
        print -u2 -- "PARALLEL_TEST_REFUSED: Swift version mismatch for ${lane}"
        exit 2
    }

    sdk_path="$(/usr/bin/env -u SDKROOT -u TOOLCHAINS \
        DEVELOPER_DIR="${developer_dir}" /usr/bin/xcrun --sdk macosx --show-sdk-path)"
    [[ "${sdk_path}" == "${expected_sdk_paths[index]}" && -L "${sdk_path}" \
       && "$(/usr/bin/readlink "${sdk_path}")" == "MacOSX.sdk" ]] || {
        print -u2 -- "PARALLEL_TEST_REFUSED: SDK alias identity mismatch for ${lane}"
        exit 2
    }
    sdk_root="${sdk_path:A}"
    expected_sdk_root="${developer_dir}/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk"
    sdk_settings="${sdk_root}/SDKSettings.json"
    observed_sdk="$(/usr/bin/env -u SDKROOT -u TOOLCHAINS \
        DEVELOPER_DIR="${developer_dir}" /usr/bin/xcrun --sdk macosx --show-sdk-version)"
    [[ "${sdk_root}" == "${expected_sdk_root}" && -d "${sdk_root}" && ! -L "${sdk_root}" \
       && -f "${sdk_settings}" && ! -L "${sdk_settings}" \
       && "${observed_sdk}" == "${expected_sdks[index]}" ]] || {
        print -u2 -- "PARALLEL_TEST_REFUSED: resolved SDK identity mismatch for ${lane}"
        exit 2
    }
    /usr/bin/jq -e --arg expected_sdk "${expected_sdks[index]}" \
        '.Version == $expected_sdk' "${sdk_settings}" > /dev/null || {
        print -u2 -- "PARALLEL_TEST_REFUSED: SDKSettings identity mismatch for ${lane}"
        exit 2
    }

    lane_root="${run_root}/${lane}"
    /bin/mkdir "${lane_root}"
    scratch_root="${lane_root}/scratch"
    module_cache="${lane_root}/module-cache"
    log_path="${lane_root}/test.log"
    machine_path="${lane_root}/machine-evidence.log"
    parser_receipt_path="${lane_root}/cr09-parser-negative.receipt"
    helper_receipt_path="${lane_root}/crash-helper.receipt"
    /bin/mkdir "${scratch_root}" "${module_cache}"
    : > "${log_path}"
    : > "${machine_path}"
    : > "${parser_receipt_path}"
    : > "${helper_receipt_path}"
    [[ -d "${lane_root}" && ! -L "${lane_root}" \
       && -d "${scratch_root}" && ! -L "${scratch_root}" \
       && -d "${module_cache}" && ! -L "${module_cache}" \
       && -f "${log_path}" && ! -L "${log_path}" \
       && -f "${machine_path}" && ! -L "${machine_path}" \
       && -f "${parser_receipt_path}" && ! -L "${parser_receipt_path}" \
       && -f "${helper_receipt_path}" && ! -L "${helper_receipt_path}" \
       && "$(/usr/bin/stat -f '%u' "${log_path}")" == "$(/usr/bin/id -u)" \
       && "$(/usr/bin/stat -f '%Lp' "${log_path}")" == "600" \
       && "$(/usr/bin/stat -f '%l' "${log_path}")" == "1" \
       && "$(/usr/bin/stat -f '%u' "${machine_path}")" == "$(/usr/bin/id -u)" \
       && "$(/usr/bin/stat -f '%Lp' "${machine_path}")" == "600" \
       && "$(/usr/bin/stat -f '%l' "${machine_path}")" == "1" \
       && "$(/usr/bin/stat -f '%z' "${machine_path}")" == "0" \
       && "$(/usr/bin/stat -f '%u' "${parser_receipt_path}")" == "$(/usr/bin/id -u)" \
       && "$(/usr/bin/stat -f '%Lp' "${parser_receipt_path}")" == "600" \
       && "$(/usr/bin/stat -f '%l' "${parser_receipt_path}")" == "1" \
       && "$(/usr/bin/stat -f '%z' "${parser_receipt_path}")" == "0" \
       && "$(/usr/bin/stat -f '%u' "${helper_receipt_path}")" == "$(/usr/bin/id -u)" \
       && "$(/usr/bin/stat -f '%Lp' "${helper_receipt_path}")" == "600" \
       && "$(/usr/bin/stat -f '%l' "${helper_receipt_path}")" == "1" ]] || {
        print -u2 -- "PARALLEL_TEST_REFUSED: invalid private output targets for ${lane}"
        exit 2
    }

    swift_bins+=("${swift_bin}")
    sdk_roots+=("${sdk_root}")
    lane_roots+=("${lane_root}")
    log_paths+=("${log_path}")
    machine_device="$(/usr/bin/stat -f '%d' "${machine_path}")"
    machine_inode="$(/usr/bin/stat -f '%i' "${machine_path}")"
    [[ "${machine_device}" == '0' || "${machine_device}" == [1-9]* ]] \
        && [[ "${machine_device}" != *[^0-9]* \
           && "${machine_inode}" == [1-9]* && "${machine_inode}" != *[^0-9]* ]] || {
        print -u2 -- "PARALLEL_TEST_REFUSED: noncanonical machine-evidence identity for ${lane}"
        exit 2
    }
    machine_paths+=("${machine_path}")
    machine_devices+=("${machine_device}")
    machine_inodes+=("${machine_inode}")
    parser_receipt_paths+=("${parser_receipt_path}")
    helper_receipt_paths+=("${helper_receipt_path}")
done

cleanup_children() {
    prior_status=$?
    trap - EXIT INT TERM HUP
    for child_pid in "${pids[@]}"; do
        (( child_pid > 0 )) || continue
        child_is_owned=false
        for owned_job_state in "${(@v)jobstates}"; do
            if [[ "${owned_job_state}" == *":${child_pid}="* ]]; then
                child_is_owned=true
                break
            fi
        done
        if [[ "${child_is_owned}" == true ]] \
           && /bin/kill -0 "${child_pid}" 2>/dev/null; then
            /bin/kill -TERM "${child_pid}" 2>/dev/null || true
        fi
    done
    for child_pid in "${pids[@]}"; do
        (( child_pid > 0 )) || continue
        wait "${child_pid}" 2>/dev/null || true
    done
    pids=()
    exit "${prior_status}"
}

trap cleanup_children EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

for index in {1..2}; do
    lane="${lane_names[index]}"
    swift_bin="${swift_bins[index]}"
    developer_dir="${developer_dirs[index]}"
    sdk_root="${sdk_roots[index]}"
    lane_root="${lane_roots[index]}"
    log_path="${log_paths[index]}"
    command=(
        "${swift_bin}" test
        --package-path "${package_root}"
        --disable-sandbox
        --scratch-path "${lane_root}/scratch"
    )
    if [[ -n "${VERITAS_TEST_FILTER:-}" ]]; then
        command+=(--filter "${VERITAS_TEST_FILTER}")
    fi
    (
        /usr/bin/env \
            -u DEVELOPER_DIR -u SDKROOT -u TOOLCHAINS \
            -u SWIFT_EXEC -u SWIFT_EXEC_MANIFEST -u SWIFT_DRIVER_SWIFT_FRONTEND_EXEC \
            -u CC -u CXX -u LD -u AR -u AS -u NM -u RANLIB \
            -u CPATH -u C_INCLUDE_PATH -u CPLUS_INCLUDE_PATH -u OBJC_INCLUDE_PATH \
            -u LIBRARY_PATH -u MACOSX_DEPLOYMENT_TARGET \
            PATH="${PATH}" \
            TMPDIR=/private/tmp \
            DEVELOPER_DIR="${developer_dir}" \
            SDKROOT="${sdk_root}" \
            CLANG_MODULE_CACHE_PATH="${lane_root}/module-cache" \
            SWIFTPM_MODULECACHE_OVERRIDE="${lane_root}/module-cache" \
            "${swift_bin}" build \
                --package-path "${package_root}" \
                --disable-sandbox \
                --scratch-path "${lane_root}/scratch" \
                --product VeritasLedgerCrashProbe
        helper_bin_path="$(/usr/bin/env \
            -u DEVELOPER_DIR -u SDKROOT -u TOOLCHAINS \
            PATH="${PATH}" TMPDIR=/private/tmp \
            DEVELOPER_DIR="${developer_dir}" SDKROOT="${sdk_root}" \
            "${swift_bin}" build \
                --package-path "${package_root}" \
                --disable-sandbox \
                --scratch-path "${lane_root}/scratch" \
                --show-bin-path)"
        helper_bin_path="${helper_bin_path:A}"
        helper_binary="${helper_bin_path}/VeritasLedgerCrashProbe"
        [[ "${helper_bin_path}" == "${lane_root}/scratch/"* \
           && -f "${helper_binary}" && ! -L "${helper_binary}" \
           && -x "${helper_binary}" \
           && "$(/usr/bin/stat -f '%u' "${helper_binary}")" == "$(/usr/bin/id -u)" \
           && "$(/usr/bin/stat -f '%l' "${helper_binary}")" == "1" \
           && "$(/usr/bin/file -b "${helper_binary}")" == *Mach-O*executable* ]] || {
            print -u2 -- "PARALLEL_TEST_REFUSED: invalid crash helper for ${lane}"
            exit 2
        }
        helper_binary_sha256="$(/usr/bin/shasum -a 256 "${helper_binary}" | /usr/bin/awk '{print $1}')"
        /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${helper_binary_sha256}" || {
            print -u2 -- "PARALLEL_TEST_REFUSED: invalid crash helper digest for ${lane}"
            exit 2
        }
        print -r -- "${helper_binary}|${helper_binary_sha256}" \
            >| "${helper_receipt_paths[index]}"
        /usr/bin/env \
            -u DEVELOPER_DIR -u SDKROOT -u TOOLCHAINS \
            -u SWIFT_EXEC -u SWIFT_EXEC_MANIFEST -u SWIFT_DRIVER_SWIFT_FRONTEND_EXEC \
            -u CC -u CXX -u LD -u AR -u AS -u NM -u RANLIB \
            -u CPATH -u C_INCLUDE_PATH -u CPLUS_INCLUDE_PATH -u OBJC_INCLUDE_PATH \
            -u LIBRARY_PATH -u MACOSX_DEPLOYMENT_TARGET \
            PATH="${PATH}" \
            TMPDIR=/private/tmp \
            DEVELOPER_DIR="${developer_dir}" \
            SDKROOT="${sdk_root}" \
            CLANG_MODULE_CACHE_PATH="${lane_root}/module-cache" \
            SWIFTPM_MODULECACHE_OVERRIDE="${lane_root}/module-cache" \
            VERITAS_LEDGER_CRASH_PROBE_PATH="${helper_binary}" \
            VERITAS_LEDGER_CRASH_PROBE_SHA256="${helper_binary_sha256}" \
            VERITAS_TEST_EVIDENCE_PATH="${machine_paths[index]}" \
            VERITAS_TEST_EVIDENCE_DEVICE="${machine_devices[index]}" \
            VERITAS_TEST_EVIDENCE_INODE="${machine_inodes[index]}" \
            "${command[@]}"
    ) >>"${log_path}" 2>&1 &
    pids+=("$!")
done

overall=0
for index in {1..2}; do
    lane="${lane_names[index]}"
    pid="${pids[index]}"
    if wait "${pid}"; then
        pids[index]=0
        if [[ ! -f "${machine_paths[index]}" || -L "${machine_paths[index]}" ]]; then
            print -u2 -- "${lane}: FAIL (machine-evidence sink disappeared or changed type)"
            overall=1
            continue
        fi
        machine_bytes="$(/usr/bin/stat -f '%z' "${machine_paths[index]}")"
        machine_sha256="$(/usr/bin/shasum -a 256 "${machine_paths[index]}" \
            | /usr/bin/awk '{print $1}')"
        if [[ "$(/usr/bin/stat -f '%u' "${machine_paths[index]}")" != "$(/usr/bin/id -u)" \
           || "$(/usr/bin/stat -f '%Lp' "${machine_paths[index]}")" != '600' \
           || "$(/usr/bin/stat -f '%l' "${machine_paths[index]}")" != '1' \
           || "$(/usr/bin/stat -f '%d' "${machine_paths[index]}")" != "${machine_devices[index]}" \
           || "$(/usr/bin/stat -f '%i' "${machine_paths[index]}")" != "${machine_inodes[index]}" \
           || "${machine_bytes}" != <-> || ${machine_bytes} -gt 4194304 ]] \
           || ! /usr/bin/grep -Eq '^[0-9a-f]{64}$' <<< "${machine_sha256}"; then
            print -u2 -- "${lane}: FAIL (machine-evidence sink identity or digest invalid)"
            overall=1
            continue
        fi
        # SwiftPM's transcript is never an admitted machine channel, including
        # filtered runs whose admitted machine evidence is empty.
        if /usr/bin/env LC_ALL=C /usr/bin/grep -Eq 'VERITAS_[A-Z0-9_]' \
            "${log_paths[index]}"; then
            print -u2 -- "${lane}: FAIL (machine evidence leaked into SwiftPM transcript)"
            overall=1
            continue
        fi
        helper_receipt_line="$(<"${helper_receipt_paths[index]}")"
        helper_receipt_fields=("${(@s:|:)helper_receipt_line}")
        if (( ${#helper_receipt_fields[@]} != 2 )); then
            print -u2 -- "${lane}: FAIL (crash helper receipt malformed)"
            overall=1
            continue
        fi
        helper_binary="${helper_receipt_fields[1]:A}"
        helper_binary_sha256="${helper_receipt_fields[2]}"
        if [[ "${helper_binary}" != "${lane_roots[index]}/scratch/"* \
           || "${helper_binary:t}" != 'VeritasLedgerCrashProbe' \
           || ! -f "${helper_binary}" || -L "${helper_binary}" \
           || ! -x "${helper_binary}" \
           || "$(/usr/bin/stat -f '%u' "${helper_binary}")" != "$(/usr/bin/id -u)" \
           || "$(/usr/bin/stat -f '%l' "${helper_binary}")" != '1' \
           || "$(/usr/bin/file -b "${helper_binary}")" != *Mach-O*executable* \
           || "$(/usr/bin/shasum -a 256 "${helper_binary}" | /usr/bin/awk '{print $1}')" \
                != "${helper_binary_sha256}" ]]; then
            print -u2 -- "${lane}: FAIL (crash helper receipt did not bind the retained binary)"
            overall=1
            continue
        fi
        successful_run_summary_count="$(/usr/bin/awk '
            $0 ~ /^✔ Test run with [1-9][0-9]* tests? in [1-9][0-9]* suites? passed after [0-9]+([.][0-9]+)? seconds[.]$/ {
                count += 1
            }
            END { print count + 0 }
        ' "${log_paths[index]}")"
        if (( successful_run_summary_count < 1 )); then
            print -u2 -- "${lane}: FAIL (nonzero successful test-run summary missing)"
            overall=1
            continue
        fi
        if [[ -z "${VERITAS_TEST_FILTER:-}" ]]; then
            if ! observed_full_breakdown="$(/usr/bin/awk '
            $0 ~ /^✔ Test run with [1-9][0-9]* tests? in [1-9][0-9]* suites? passed after [0-9]+([.][0-9]+)? seconds[.]$/ {
                tests += $5
                suites += $8
                summaries += 1
                if (breakdown != "") breakdown = breakdown ","
                breakdown = breakdown $5 "/" $8
            }
            END {
                if (summaries < 1 || tests != 470 || suites != 37) exit 1
                print breakdown
            }
            ' "${log_paths[index]}")"; then
                print -u2 -- "${lane}: FAIL (full-run aggregate was not exactly 470 tests in 37 suites)"
                overall=1
                continue
            fi
            expected_full_breakdown='470/37'
            [[ "${lane}" == 'xcode-27' ]] && expected_full_breakdown='347/30,26/2,97/5'
            if [[ "${observed_full_breakdown}" != "${expected_full_breakdown}" ]]; then
                print -u2 -- "${lane}: FAIL (full-run lane breakdown did not match ${expected_full_breakdown})"
                overall=1
                continue
            fi
        fi
        if [[ -z "${VERITAS_TEST_FILTER:-}" \
           || "${VERITAS_TEST_FILTER}" == *Abrupt* \
           || "${VERITAS_TEST_FILTER}" == *abrupt* ]]; then
            abrupt_restart_title='Abrupt helper termination preserves only complete observation transactions'
            abrupt_restart_summary_count="$(/usr/bin/awk -v title="${abrupt_restart_title}" '
                $0 ~ ("^✔ Test \"" title "\" with 4 test cases passed after [0-9]+([.][0-9]+)? seconds[.]$") {
                    count += 1
                }
                END { print count + 0 }
            ' "${log_paths[index]}")"
            if [[ "${abrupt_restart_summary_count}" != "1" ]]; then
                print -u2 -- "${lane}: FAIL (abrupt-restart case summary missing or duplicated)"
                overall=1
                continue
            fi
            for abrupt_restart_point in \
                '.beforeObservationBegin' \
                '.afterObservationBeginBeforeWrite' \
                '.beforeObservationCommit' \
                '.afterObservationCommitBeforeReturn'; do
                abrupt_restart_case_line="◇ Test case passing 1 argument point → ${abrupt_restart_point} to \"${abrupt_restart_title}\" started."
                if [[ "$(/usr/bin/awk -v expected="${abrupt_restart_case_line}" '$0 == expected { count += 1 } END { print count + 0 }' "${log_paths[index]}")" != "1" ]]; then
                    print -u2 -- "${lane}: FAIL (abrupt-restart point evidence missing or duplicated)"
                    overall=1
                    continue 2
                fi
            done
        fi
        if [[ -z "${VERITAS_TEST_FILTER:-}" \
           || ( "${VERITAS_TEST_FILTER}" == *CoherentReplacementBaseline* \
                && "${VERITAS_TEST_FILTER}" != *BaselineB* ) \
           || ( "${VERITAS_TEST_FILTER}" == *coherentreplacementbaseline* \
                && "${VERITAS_TEST_FILTER}" != *baselineb* ) ]]; then
            if ! veritas_validate_checkpoint_control_log \
                "${log_paths[index]}" "${machine_paths[index]}"; then
                print -u2 -- "${lane}: FAIL (checkpoint-control evidence invalid, missing, or duplicated)"
                overall=1
                continue
            fi
        fi
        baseline_b1_suite_start_count="$(/usr/bin/awk '
            $0 == "◇ Suite \"Founder Alpha coherent replacement Baseline B\" started." {
                count += 1
            }
            END { print count + 0 }
        ' "${log_paths[index]}")"
        baseline_b2_suite_start_count="$(/usr/bin/awk '
            $0 == "◇ Suite \"Founder Alpha coherent replacement Baseline B2 isolated process\" started." {
                count += 1
            }
            END { print count + 0 }
        ' "${log_paths[index]}")"
        baseline_b3_suite_start_count="$(/usr/bin/awk '
            $0 == "◇ Suite \"Founder Alpha coherent replacement Baseline B3 dormant WAL identity\" started." {
                count += 1
            }
            END { print count + 0 }
        ' "${log_paths[index]}")"
        baseline_b3c_suite_start_count="$(/usr/bin/awk '
            $0 == "◇ Suite \"Founder Alpha coherent replacement Baseline B3C closed sibling fork\" started." {
                count += 1
            }
            END { print count + 0 }
        ' "${log_paths[index]}")"
        baseline_b_marker_count="$(/usr/bin/awk '
            index($0, "VERITAS_BASELINE_B_") == 1 { count += 1 }
            END { print count + 0 }
        ' "${machine_paths[index]}")"
        if [[ -z "${VERITAS_TEST_FILTER:-}" \
           || "${VERITAS_TEST_FILTER}" == *BaselineB* \
           || "${VERITAS_TEST_FILTER}" == *baselineb* \
           || "${baseline_b1_suite_start_count}" != "0" \
           || "${baseline_b2_suite_start_count}" != "0" \
           || "${baseline_b3_suite_start_count}" != "0" \
           || "${baseline_b3c_suite_start_count}" != "0" \
           || "${baseline_b_marker_count}" != "0" ]]; then
            if [[ "${baseline_b1_suite_start_count}" != "1" \
               || "${baseline_b2_suite_start_count}" != "1" \
               || "${baseline_b3_suite_start_count}" != "1" \
               || "${baseline_b3c_suite_start_count}" != "1" ]]; then
                print -u2 -- "${lane}: FAIL (focused Baseline B acceptance requires all four complete serialized suites)"
                overall=1
                continue
            fi
            if ! veritas_validate_baseline_b_log \
                "${log_paths[index]}" "${machine_paths[index]}" \
                "${helper_binary_sha256}"; then
                print -u2 -- "${lane}: FAIL (Baseline B evidence invalid, missing, or duplicated)"
                overall=1
                continue
            fi
            parser_negative_result="$(/bin/zsh "${parser_negative_helper}" \
                "${log_paths[index]}" "${machine_paths[index]}" \
                "${helper_binary_sha256}")" || {
                print -u2 -- "${lane}: FAIL (CR-09 parser-negative harness failed)"
                overall=1
                continue
            }
            print -r -- "${parser_negative_result}" >| "${parser_receipt_paths[index]}"
            # v4 receipt validator: standalone receipt, transcript, sink,
            # parser, mutation harness.
            if ! veritas_validate_cr09_parser_negative_receipt \
                "${parser_receipt_paths[index]}" "${log_paths[index]}" \
                "${machine_paths[index]}" "${checkpoint_control_helper}" \
                "${parser_negative_helper}"; then
                print -u2 -- "${lane}: FAIL (CR-09 parser-negative receipt invalid)"
                overall=1
                continue
            fi
        fi
        print -- "${lane}: PASS"
    else
        pids[index]=0
        print -- "${lane}: FAIL"
        overall=1
    fi
done

# No historical PID remains eligible for cleanup after both children have been
# reaped. Disable the traps before printing the non-authoritative result.
pids=()
trap - EXIT INT TERM HUP
print -- "private_parallel_run_root=${run_root}"
print -- "authoritative=false"
print -- "testflight_uploaded=false"
exit "${overall}"
