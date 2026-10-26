# Private fixed-fixture paired-arm bootstrap

September 20, 2026 · scoped Node engineering accepted; native/provider acceptance open.

**Finish packets: 70% (7/10). Overall v0.2: 30% (3/10 NX). v1: 0% (0/8).**
This increment closes a missing integration component, not another major gate.
No publication, model inference, native build, installation or authentication change.

## Before and after

| Boundary | Before | Now |
| --- | --- | --- |
| Owner setup | Command lifecycle required a caller-supplied reservation implementation. | An in-process fixed-fixture bootstrap constructs fresh host, static/test, lane, two model owners and oracle per original scheduled intent. |
| Model/profile preflight | Describing the settings required constructing a lane. | Pure prospective validation shares the exact original settings projection without creating owners or requests. |
| Partial constructor failure | A transport owner could be allocated before a later adapter constructor threw. | V4 attempts to stop every created owner and checks its terminal status; uncertainty has a distinct fixed error. |
| Invalid factory output | A throwing, asynchronous or unissued factory result could escape conservative cleanup accounting. | The construction and issued-identity checks share a boundary; unreturned/rejected capability cleanup remains unconfirmed. |
| Final reporting | Retention and lane cleanup were separate responsibilities of callers. | Counts distinguish created, closed and unconfirmed lanes; constructor uncertainty prevents an overall recorded result even when retention was acknowledged. |

## Implemented scope

`hosts/repository/reviewed-paired-arm-bootstrap-v1.mjs` provides
`createReviewedPairedArmBootstrapV1(input)` and a separately labelled trusted
test-dependency constructor. The returned API is `run()`, `requestStop()` and
`inspect()`. It is one-use and preserves the original command/runner/controller.

Inputs are the exact plan/profile, explicit model selection and budgets, original
issued OFF/ON treatments, original reviewed oracle registration, issued native
build, existing private external state root, approval, clock and observation
callbacks. Production build identity and state-root binding are checked. The
bootstrap does not generate consent, hardware-capacity observations or approval.

Preflight validates both arms before resource construction. Every accepted intent
receives distinct ordinal workspace/oracle roots and fresh original owners.
There is no retry, deletion, model discovery/loading, arbitrary command execution,
new scheduler or durable resume. The fixed oracle still accepts only the two
source-reviewed candidates. Returned or stored model content grants no authority.

> [!WARNING]
> **This is not yet an executable paired-run shell command.** A real operator
> integration must supply genuine revocable approval and fresh measured host
> observations, along with the verified native/provider prerequisites. Synthetic
> observations in the test helper must never be used as production admission.

## Exact verification

Final current-source receipt: `checks-CZ4NtT/checks.json`.

- **573/573 selected tests passed** on Node v24.18.0, with zero failed, skipped,
  cancelled or TODO tests. This includes the **41 new focused tests**.
- **172 input hashes unchanged** across verification, including the fixed
  `oracle-only/check-retry-semantics.mjs` asset.
- Nisi contract/syntax validation: **VALIDATED** for all **nine** changed
  source/test files; no Nisi model call or behavioral-test mode was used.
- The original runner was exercised for OFF/ON across both supported API
  formats with synthetic transports and the real fixed Node oracle. Each run
  completes one arm, retains it, then stops with
  `RUNNER_REPORTED_BUDGET_UNCONFIRMED`; synthetic usage is not invented.
- A separate isolated construction-only harness observes original issued intents,
  stops the original runner before dispatch, constructs **four sets / 28 distinct
  owner identities / eight distinct workspace roots**, and closes all four lanes.
  It reports zero arm execution and no acceptance or provider measurement.
- Constructor faults cover author-adapter, second-owner and reviewer-adapter
  failures, plus stop-throw and nonterminal rollback. Original errors are preserved
  only when rollback is confirmed; otherwise uncertainty takes precedence.
- Additional tests cover invalid/async factories, copied/out-of-order/duplicate
  intents, root identity replacement, immutable inputs, setup signals, in-flight
  stops and downstream admission refusal.

Deliberate faults: `mutations-iBt2Jg/receipt.json`. Both unchanged controls pass
**38/38**. Hiding rollback uncertainty causes 2 failures; hiding construction
uncertainty causes 8; dropping unused-lane revocation causes 3; ignoring the
environment binding causes 2. Canonical sources remain unchanged.

The earlier `mutations-HBFce0` run is **not valid mutation evidence**: the copied
fixture omitted the oracle-only asset, and one mutation produced invalid syntax.
Its failed controls and diagnostics remain retained. The corrected run above is
the acceptance evidence; those failures have not been relabelled PASS.

## Parallel review and remaining gates

Daybreak's final exact-nine-file source review is scoped PASS, with no remaining
scoped P1/P2; see `daybreak-review.md`. Luna supplied preflight and constructor
fault-test drafts. Root integrated minimally, corrected the child import order
so instrumentation actually applied, and ran the checks. Requested model labels
are not independent served-model identity or usage receipts; those fields remain
unknown where the collaboration interface does not expose them.

Luna's separate read-only evidence audit (`luna-evidence-audit.md`) recomputes
all 172 current input hashes, confirms the final nine-file review bindings and
the two passing mutation controls. It is not another test run or model benchmark.

Fable's usage-cap pause handoff remains in force. Jev key rotation remains
unconfirmed. At 17:44:06Z the runtime reported Qwen3.8-27b loaded, inference
NOT_TESTED, and the shared router status was idle. This does not settle the
historical uncertain OpenCode request or authorize bypassing Jev intake. No Spark
tool name was exposed in the current tool inventory; no participation is claimed.

> [!CAUTION]
> **Recorded evidence is not task success, safe resumption or measured savings.**
> A cancellation can have acknowledged logs while lane recovery remains uncertain;
> the bootstrap then reports `recorded:false`. Remote stop, real dispatch counts,
> provider authenticity and token/time/accuracy improvements remain unproven.

Next: wire a real operator/admission session to this bootstrap, satisfy the
separately gated native/provider window, and expose a reviewed shell entry point.
C08 real tool-call export, C09 approved Node22 rehearsal, C10, remaining NX/native
acceptance and matched benefit evaluation remain open. Private release restrictions
and counsel/disclosure gates are unchanged.
