# Live-model re-measure check — 10 November 2026

Machine: Louis-M5-Pro-MacBook-Pro.local. Source checked: `origin/main` at `280abd5` (merge of PR #43). Nothing was tagged, released, or published. No process was stopped, including the existing `http.server` on port 4173. No model was downloaded, and no credit was purchased.

**Verdict: NOT_RUN.** This is not a pass. The harder-task re-measure and the local-model end-to-end example were not executed.

## What was checked

LM Studio was installed, and `lms ls` listed four already-downloaded chat models on disk (43.26 GB with two embedding models): `lfm3-1.7b` (1.85 GB), `qwen/qwen3-4b` (2.28 GB), `qwen3.8-27b` (21.98 GB), and `meta-models/muse-glimmer-30b-gguf/muse-glimmer-30b-kquant-17gb-q4_k_m.gguf` (16.76 GB). No model was loaded by this check.

Nisi's local-chat adapter only calls an unauthenticated HTTP loopback chat-completions endpoint. These listeners were probed:

| Endpoint | Result |
|---|---|
| `http://127.0.0.1:1240/v1/models` (the LM Studio port used on 9 November 2026) | Not listening |
| `http://127.0.0.1:1234/v1/models` | HTTP 503, `model inventory unavailable` |
| `http://127.0.0.1:11434/api/tags` and `/v1/models` | Empty model list, or 503 |
| `http://127.0.0.1:11435/api/tags` and `/v1/models` | Empty model list |
| `http://127.0.0.1:8080/v1/models` and `http://127.0.0.1:8081/v1/models` | Empty model list |

`lms server start` and `lms load` were not run. On 9 November 2026, loads of `qwen3.8-27b`, `qwen/qwen3-4b`, and `lfm3-1.7b` on port 1240 crashed the LM Studio service under memory pressure. LM Studio `llama-server` child processes from earlier sessions were still running on this machine and were left running, so a new load was not started.

`benchmarks/harder/run.mjs` and `examples/local-model-workflow.mjs` were therefore not invoked. The 2026-11-07 harder-task result files were not regenerated.

## Other open items, still not run

- The two nx05 revoke-scratch journals were not copied in and were not re-checked in this pass. They remain outside the repository. The earlier read-only check and the `LEGACY_UNRETAINED_FINGERPRINT` reason in the run journal guide still stand. The files stay rejected.
- The one-PC Windows note in `docs/verification-v0.3-windows.md` is still the v0.3.0 check. It was not repeated.
