# OpenCode local orchestration — private engineering receipt

**September 18, 2026 · Nisi v0.2 private · Overall roadmap: 30% (3/10 NX milestones)**

> [!WARNING]
> **Private development evidence, not release clearance.** This work does not
> authorize public code, design, benchmarks, hosted artifacts or invention
> disclosures. It does not close an NX milestone or certify generated code.

## Outcome

OpenCode's online-code-mode route now has two installed custom tools:
`nisi_local_status` and `nisi_local_work`. They reuse Nisi's existing strict
local-model adapters and task/candidate contracts. The new work result contains
candidate files, review findings, identity bindings, hashes and measured usage
instead of treating free-form prose or a process exit as proof of success.

The route is usable for bounded private drafting/review. It is not yet an
accepted complete OpenCode agent/repository workflow or unattended service.

| Before | After |
|---|---|
| OpenCode inherited host-inappropriate online-mode instructions | A native OpenCode skill, dispatched from both discovered shared entry points |
| Local helpers existed without this closed orchestration interface | A fixed-loopback, serial draft/review interface with strict Nisi-shaped output |
| Old prompt text misstated the online agent's shell permissions | Instructions describe actual resolved permissions and require task-scoped checks |
| A failed packet could remain ambiguous without a distinct execution record | Private, unique attempt records preserve terminality and requested/observed routes |
| Concurrent preflight edits could be overwritten | Cooperating owner lock and pre-transition byte/hash comparison refuse detected edits |
| Some queue failures could return success | Unreachable, failed, missing and non-ready requested work produce nonzero outcomes |

## What changed

- Nisi source: `hosts/local-models/opencode-orchestration-v1.mjs` and its focused
  test file. Existing workflow/adapters were reused without changing their
  formats, exports or acceptance rules.
- Installed tool: `~/.config/opencode/tools/nisi_local.ts`.
- OpenCode config: online agent uses `lmstudio/qwen/qwen3.8-27b`; the two local
  tools are enabled there and denied to the headless packet agent. Existing
  unrelated agents, credentials and permission settings were preserved.
- OpenCode native skill, online command and online/offline dispatch text;
  narrowly scoped OpenCode dispatch additions in the existing `.agents` and
  `.claude` online-code-mode skills. Other host workflows remain intact.
- Installed Mac packet runner and queue failure/ownership reporting. The pinned
  bounded-execution helper itself remains unchanged. No old packet was reset.
- A synthetic live smoke, a durable fake-executor regression harness, and a
  selected-source verification script under
  `work-orders/opencode-local-orchestration-v1/`.

## Deterministic verification of the final implementation

[Machine-readable receipt](../../.build/opencode-local-verification-zEKbjx/verification.json)
records **28 selected file hashes before and after**, unchanged during the
verification run. This selection includes the new host/tool/tests, reused core
dependencies, installed routing files, runner, queue and pinned helper. It is
not a complete transitive-dependency or repository audit.

| Check | Actual result |
|---|---|
| New orchestration + existing adapter/discovery/workflow tests | **141/141 PASS**, zero failures/skips/cancellations; 19 are new orchestration tests |
| Packet runner/queue fake-executor tests | **10/10 PASS**, including preflight mutation, malformed routes, uncertain terminality, missing packets and removed queue entries |
| Installed tool and live-smoke syntax checks | PASS |
| Selected files unchanged during the deterministic run | **28/28** |
| OpenCode skill discovery and resolved online/packet configuration | Observed: native skill found; online tools enabled; packet tools disabled |
| Skill frontmatter | Parsed with installed YAML parser; standard skill validator could not run because its Python lacked PyYAML |
| Full repository suite / native application acceptance | **NOT_RUN** in this slice |

Reproduce the deterministic checks on this configured Mac:

```sh
cd ~/nisi
node work-orders/opencode-local-orchestration-v1/verify-local.mjs
```

The existing [September 17 baseline](known-red-baseline-2026-09-17.md) records
two native-overlay failures after the type prerequisite was fixed. Those are
not cleared by these focused checks. Existing changes from Claude/OpenCode in
package metadata, verification notes and other work orders were preserved.

## Live local use and development data

The smoke imports and invokes the **actual installed OpenCode custom tool**.
It asks for one small JSON configuration, validates the exact keys/values and
records output identity and limits. Generated programs are not executed.

| Run | Model participation | Result | Elapsed | Reported tokens |
|---|---|---|---:|---:|
| Initial synthetic smoke | Qwen `qwen/qwen3.8-27b`, one draft and one review | **6/6 PASS** | **63.646 s** | **1,979** = 625 draft + 1,354 review |
| Final-code synthetic smoke | Same Qwen model, one draft and one review; strict resident-only request | **6/6 PASS** | **87.062 s** | **2,450** = 757 draft + 1,693 review |

[Initial raw evidence](../../.build/opencode-local-smoke-WcQwmv/evidence.json)
retains the task, six assertions, candidate, inventories and transport receipts.
The initial run preceded the pre-transport cancellation usability fix; the
deterministic receipt above binds the final revised implementation. The
[second raw receipt](../../.build/opencode-local-smoke-t5VYpN/evidence.json)
records another six passing checks against the revised code, with no cold-start
opt-in. Both results are retained; the second used more tokens and took longer.
That variation is not a controlled speed comparison.

This is a direct tool test, **not a full OpenCode headless agent task**. Both
roles use the same model: self-review, not independent verification. Token
counts are response-reported and exclude Claude development review, other
processes and unavailable telemetry. No equal-budget OFF/ON baseline was run;
there is no measured savings, comparative accuracy or speedup claim.

The data is retained for engineering decisions. No automatic failure-memory
promotion, policy influence, training, hardware recalibration or background
research was enabled.

## Fable collaboration and adjudication

Fable 5.1 completed a bounded design review and a bounded core source review
through the Claude CLI, with tools disabled and Codex retaining write ownership.
The CLI also reports auxiliary Haiku participation. Artifacts are retained in
the work order as `claude-plan.json` and `claude-core-review.json`.

The larger four-file source review did **not** complete: Fable hit its assigned
budget and the fallback Sonnet attempt timed out. Its NOT_RUN result is retained
as `claude-source-review.json`, not presented as a successful review. The later
core-only review covered less source, not the whole integration.

Adjudication of the completed core review:

1. **Pre-transport cancellation disabling an unused owner — fixed.** A cancelled
   or already-expired request before any discovery/transport leaves the owner
   reusable. Tests demonstrate a subsequent valid request on the same owner.
   Failure after discovery begins still quarantines it; no automatic reset exists.
2. **Missing reported identity allegedly yielding a different-model success —
   not reproducible through the actual adapters.** Exact requested/reported model
   equality is required before the one success receipt. An explicit omitted-model
   regression now proves refusal. Independent reviewer credit is always zero.
3. **Draft hash / minimal HTTP-response concerns — checked against dependencies.**
   The author recomputes the produced candidate hash; consumers use the supported
   bounded body-reader interface. HTTP failure bodies are destroyed.
4. **Output-size and residency limitations — not overstated.** The proposed
   catch-path overflow was not reproduced under the configured caps. Inventory
   plus reported model identity does not attest weights or acquire a server lease.

Fable did not issue final all-source acceptance after the cancellation change;
Codex integrated the finding and ran the retained regression suite. Luna supplied
bounded packet changes and tests; another Codex collaborator supplied the host
module and tests. No Windows worker contribution is claimed for this slice.

## Operational boundaries

The host uses direct HTTP to literal `127.0.0.1:1234`, ignores proxy environment
variables, follows no redirects and exposes no destination input. It refreshes
inventory before each completion. Strict residency is default; explicit cold
start is allowed only when no other LLM is reported resident. It sends no model
load/unload commands and performs no automatic model swap or cloud fallback.

Every success envelope remains `advisoryOnly:true`, `accepted:false`, with
checks/tests/certification `NOT_RUN`. A response being schema-valid does not
establish that its code works. Advisory IDs are separately namespaced and cannot
replace actual Nisi workflow evidence.

> [!CAUTION]
> **The local server and host remain trusted.** Loopback does not prove offline
> inference, model weights, server routing or absence of server-side eviction.
> Residency is a fresh observation, not a machine-wide reservation. Abort does
> not establish that remote inference stopped. Uncertain owners stay quarantined.

Packet ownership uses an advisory lock plus detected-change checks, not an atomic
compare-and-swap against arbitrary editors. The queue's edit phase is bounded;
preflight, receipt generation and the entire queue are not globally qualified
for unattended windows. Success-looking historical receipt text is not newly
source-validated here. No live packet/provider run was used to qualify those fixes.

## Daybreak and YubiKey

The earlier attempted Daybreak reviewer was rejected with:

```text
The Daybreak Blue model requires access_programs.cyber=daybreak_blue.
```

Codex login and model catalog visibility were observed, but neither establishes
execution entitlement. The failed request did not produce a Daybreak review.
No alternative model was labeled Daybreak or used to bypass that requirement.

A YubiKey can satisfy an actual configured authentication challenge; it cannot
grant program approval or the account/workspace entitlement. Approval must match
the relevant identity, workspace and product surface. See the official
[Trusted Access guidance](https://learn.chatgpt.com/docs/cyber-safety).

**No YubiKey touch prompt was observed.** Prompt Louis only when an actual
legitimate challenge appears, identify the service and action, and do not approve
unrelated requests. No login or credential changes occurred during the original
local-orchestration implementation; the subsequent access follow-up below did
complete an ordinary Codex sign-in.

### Access follow-up — September 18, 23:37 UTC

The browser now reports verified identity and active Daybreak access. A documented
token-refresh request did not establish working access in the running desktop
session. A subsequent ordinary `codex login` completed successfully using the
existing personal account. No security policy or hardware-key enrollment changed.

A fresh ephemeral, read-only Codex CLI request to `gpt-daybreak-blue-latest`, in
an empty temporary directory with no project input, then returned
`DAYBREAK_ACCESS_OK` and exited 0. No tool-call items were emitted. The CLI reports
15,702 input tokens, 15,699 cache-write input tokens and 8 output tokens; the input
includes CLI context, not just the short probe. This is not a savings measurement.
The [sanitized access receipt](../../work-orders/opencode-local-orchestration-v1/daybreak-access-20260918.json)
retains the result without authentication URLs, account identifiers or credentials.

**CLI access is verified. Desktop subagent access is not.** Its last attempt
still returned the earlier entitlement error. No later successful subagent test
is claimed, no default model was changed, and no repository review occurred in
this access-only probe. Bounded future work can use the verified CLI route.

The successful CLI probe also logged a model-cache schema error (`base_instructions`
missing) and session-index fallback warnings. These were non-blocking here, were
not repaired, and do not establish the cause of the earlier access rejection.

## Next bounded work

- Start a new explicitly selected OpenCode online session so it loads the updated
  definitions; do not interrupt a concurrently running agent to force a reload.
- Qualify one small complete OpenCode agent task using the local tools and actual
  deterministic checks, with final exact-byte acceptance and a single writer.
- Keep draft, check and independent-review phases distinct when moving into the
  real repository host; never upgrade this self-review into a reviewer quorum.
- Run a paired OFF/ON study only after that path is reproducible. Preserve failures,
  cancellation, cache state, total costs and unknown usage alongside successes.
- Use the verified Daybreak CLI route for scoped defensive review. Requalify the
  desktop subagent surface separately; do not replace its failed record with the
  CLI result or assume a restart will necessarily fix it.

No commit, push, package publication, native launch, installation of dependencies,
automatic learning, historical packet rewrite or security bypass occurred.
