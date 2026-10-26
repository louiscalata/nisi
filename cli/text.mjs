// Private CLI. Keep version bound to package.json in tests.
export const CLI_VERSION = '0.2.0-private.0';
export const CLI_HELP = `Nisi ${CLI_VERSION} — private developer CLI

Usage: nisi [command]
  help, --help, -h       Show this help (also the default with no arguments)
  version, --version, -v Print the package version
  doctor                Read-only selected-asset inventory; no compiler/models
  inspect ABSOLUTE_DIR  Read only a stored summary.json in a private run directory
  inspect-trial ABSOLUTE_DIR
                        Read only a retained paired-trial store; metadata JSON
  inspect-arm-trial ABSOLUTE_DIR
                        Cross-check main/arm-sidecar stores; aggregate JSON only
  inspect-trial-diagnostic ABSOLUTE_FILE
                        Read one redacted diagnostic and check its trial linkage
  demo [flags...]       Run the explicitly approved, fixed repository fixture
                        Use "nisi demo --help" for its required flags
                        --preflight-only checks source/configuration read-only
                        (exits 1 deliberately; optional validated --state-dir)

This checkout supports: node /absolute/path/to/nisi/bin/nisi.mjs [command]
The private library archive does not contain this CLI. Its separate CLI archive
is for isolated private installation only; no public distribution is authorized.
Demo changes are proposals only. Arbitrary generated source is refused.
Demo execution requires --state-dir ABSOLUTE_EXISTING_PRIVATE_DIRECTORY (0700),
outside and not an ancestor of the package. No automatic directory creation.
Read-only --preflight-only may omit it; no inference/build/workspace is started.
Preflight validates fixture/configuration, not server idle or runtime admission.
Doctor, all inspectors and demo (including demo --help) emit JSON. Help is text.
Inspect reads producer-format summary v1/v3 only, not a full verified bundle.
Its exit 0 means observation succeeded, not run acceptance or current liveness.
It does not assess late settlement, verify retained artifacts or establish trust.
Inspect-trial captures bytes once and reconciles the same retained events.
It emits statuses, bounded counts, run/plan/profile bindings and a stop reason;
never raw events, candidates, model names or paths. These are unauthenticated
host statements, not verified measurements, candidate bytes or permission to act.
Inspect-trial exits: 0 OBSERVED (consistent final records, even an adverse final);
1 INCOMPLETE (empty or valid prefix, including a partial/corrupt tail);
2 REFUSED (unavailable bytes or invalid semantic evidence). A valid prefix does
not repair or clear corruption. All three emit JSON on stdout; bad usage uses
sanitized stderr. No result authorizes execution, resume or policy promotion.
Trial file limits: 256 MiB total, 32 MiB per event, 65,538 events. These are
admission limits, not a proven memory ceiling; the reader buffers the whole file.
Inspection requires an operator-exclusive static local filesystem; pathname
checks do not isolate hostile writers or bound stalled filesystem calls.
Inspect-arm-trial separately captures main/sidecar bytes and checks their links.
Exits: 0 OBSERVED for final cross-linked evidence, 1 INCOMPLETE for unfinished
evidence, 2 REFUSED for unavailable/corrupt/mismatched evidence. Counts are
retained row states, not successful tasks, verified dispatch or model usage.
No row identifiers, raw records, prompts, model names or paths are printed.
Main limits remain above; sidecar limits: 16 MiB, 1 MiB per record, 4096 records.
An empty paired store is incomplete; missing files refuse. Inspection does not
prove atomic two-file capture, past acknowledgement, remote stop or permission.
Inspect-trial-diagnostic reads one immutable capture (64 KiB maximum) and its
existing trial ledger. Exits: 0 terminal channels observed, 1 partial channels,
2 unavailable/corrupt/mismatched. Terminal means the recorded channels ended,
not that execution succeeded, cleanup was confirmed or remote inference stopped.
It never prints candidate/source text, model endpoints or exception messages.
Ledger-bound fields and observer-only source fingerprints are listed separately.
Local bytes cannot prove a past write acknowledgement or raw-evidence completeness.
No retry, overwrite or late upgrade of the diagnostic capture is provided.
Native checker target: arm64-apple-macosx27.0; compatibility is not inferred.
General exits: 0 information/scoped success; 1 incomplete trial/demo or preflight;
2 command failure
(invalid usage/setup, failed inspection, or output failure). Ordinary inspect
errors report INCOMPLETE on stderr; exit 0 never upgrades a stored run to PASS.
No automatic model selection, download, install, apply, resume or publication.
`;

export function safeNisiCode(error) {
  try { const code = error?.code;
    return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/u.test(code) ? code : 'NISI_CLI_ERROR';
  } catch { return 'NISI_CLI_ERROR'; }
}

export const errorOutput = error => ({ exitCode: 2, stdout: '',
  stderr: JSON.stringify({ status: 'INCOMPLETE', code: safeNisiCode(error), hint: 'Use nisi --help.' }) + '\n' });
