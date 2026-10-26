# JEV integration — TypeSafe System One, side by side with Nisi

Private integration staged under `integrations/jev/`, mirroring the
`integrations/veritas/` pattern. It runs **side-by-side** with the Nisi v0.1
core: it does not modify the root `package.json`, core exports, `adapters/`,
or any in-flight packet/work-order files.

## Scope

- Install the official TypeSafe client SDK for Node: `@typesafe-ai/sdk`
  (currently `0.6.0`, MIT, Node >= 20), pinned in this package's own
  `package.json` / `package-lock.json` (`node_modules/` is git-ignored).
- Expose a Nisi-shaped advisory evaluator for Jev (System One) questions:
  `choice`, `score`, and `noul`.

## Status (be honest about this)

- SDK **installed** and imported by `src/jev-adapter.mjs`.
- Adapter + offline deterministic tests **present**.
- **Live pipeline smoke verified 2026-09-19** through the explicit online-code-mode bridge: task analysis and candidate triage returned `jev-1.13.0` with model/usage/hash receipts. The separate Python task-classification route also returned `jev-1.13.0`. These are scoped smoke checks, not model-quality calibration or Nisi acceptance.
- Evidence and command guide: `~/Documents/ChatGPT/Initiate Online Code Mode/nisi-jev-integration-20260919/RESULT.md` and `~/.codex/skills/local-llm-orchestrator/references/nisi-jev.md`. Calls remain explicit and respect the existing opt-in; candidate transmission additionally requires scoped egress authorization.

## Environment contract

| Variable | Meaning |
|---|---|
| `TYPESAFE_API_KEY` | API key. Read **only** from the process environment at evaluate time (the OpenCode launcher populates it from the private 0600 `chami-intake.env`). The adapter never accepts a pasted key, never stores it, never logs it, and never writes it to any file in this repo. |
| `TYPESAFE_BASE_URL` | Optional API root; SDK default `https://api.typesafe.ai`. |
| `TYPESAFE_DEFAULT_MODEL` | Optional default model; adapter default `jev-1.14.0`. |

Never echo or paste the key into chat, files, or receipts. If a key is pasted
into chat, rotate it at console.typesafe.ai.

## API

```js
import { createJevEvaluator, noul, choice } from './src/jev-adapter.mjs';

const evaluator = createJevEvaluator({ id: 'jev-sys1' }); // key from env
const result = await evaluator.evaluate({
  state: { document: 'I was charged twice.' },
  questions: {
    overdue: noul('Is this about billing?'),
    category: choice('Which category?', { billing: null, technical: null, other: null }),
  },
});
// result: frozen { model, answers, usage, evidence: { requestedModel, requestSha256, responseSha256, elapsedMs } }
```

- `createJevEvaluator({ id, model?, timeoutMs?, apiKey?, fetch? })`
  - `apiKey` is an explicit-config escape hatch; the env lane is preferred and
    `fetch` exists only for offline/injected transports (tests).
  - Strict validation; every failure carries a `JEV_*` error `code`
    (`JEV_CONFIG_INVALID`, `JEV_ID_INVALID`, `JEV_MODEL_INVALID`,
    `JEV_TIMEOUT_INVALID`, `JEV_FETCH_INVALID`, `JEV_API_KEY_INVALID`,
    `JEV_API_KEY_MISSING`, `JEV_PAYLOAD_INVALID`, `JEV_STATE_INVALID`,
    `JEV_QUESTIONS_INVALID`, `JEV_RESPONSE_INVALID`, `JEV_USAGE_INVALID`,
    `JEV_UNAVAILABLE`, `JEV_OWNER_STOPPED`).
- `evaluator.evaluate({ state, questions })` — one System One request.
- `evaluator.receipts()` — immutable advisory receipts (status
  `RESPONSE_VALIDATED` or `UNAVAILABLE`, `requestSha256`, `reportedModel`,
  `responseSha256`, `usage`, `elapsedMs`).
- `evaluator.lifecycle()` / `evaluator.stop()`.
- Re-exports the SDK question builders `choice`, `noul`, `score`.

## Bounded advisory capabilities

`src/jev-capabilities.mjs` provides `analyzeTask({ evaluator, task })`,
`triageCandidate({ evaluator, task, candidate })`, and
`proposeRouting({ evaluator, task, routes })`. A reusable
`createJevCapabilities(evaluator)` factory exposes all three methods.

Both methods return frozen `kind: "nisi.jev.advisory.v1"` records with
`status: "RESPONSE_VALIDATED"` and `taskSha256`; triage also returns the exact
`candidateSha256`. Answer coverage, choice probabilities, score ranges, and
Noul ranges are validated before a result is returned. The records always state
`accepted: false` and
`checks/tests/certification: NOT_RUN`; these helpers do not create Nisi
workflow bindings or acceptance evidence.

Task text and candidate contents are sent only as evaluator request state and
are omitted from returned records. Task text is capped at 16 KiB; candidates
are capped at 64 relative files, 64 KiB per file, and 256 KiB total. Candidate
triage requires a separate caller-side operator authorization for repository
content egress; task analysis does not authorize candidate egress.

`proposeRouting` accepts a closed route registry (`id`, Codex task UUID,
`mac`/`windows` host, client, and short scope). Jev returns a bounded
`routing` proposal with a route ID, priority, review flag, confidence, and a
hash of the registry. The proposal is advisory data only. Nisi's
`workflow/routing-queue-v1.mjs` recomputes the task hash, checks the Jev
receipt and route binding, and converts the result to a payload for the
existing durable Canary ledger. Jev cannot enqueue, claim, dispatch, retry,
or accept a job; the deterministic host retains those responsibilities.

## Advisory semantics

`RESPONSE_VALIDATED` means the SDK response passed this adapter's schema — not
that the code works, that tests pass, or that acceptance is implied. Same-model
self-review is never independent. `remoteInferenceStopped` is always
`NOT_OBSERVED`. Jev results must not be copied into a Nisi acceptance path
without the exact task/candidate bindings required by the Nisi workflow core.

## Checks (offline, no network, no real key)

```sh
npm run check            # in integrations/jev/
# → node --check src/jev-adapter.mjs && node --test test/*.test.mjs

cd ~/nisi && npm run check:structural   # root regression; root is untouched
```

## Do not

- Weaken Nisi v0.1 receipts, task bindings, repair bounds, or cancellation
  behavior to accommodate this integration.
- Publish or share this integration, the SDK, or the key.
- Treat a stub transport result as a live-model result.
