# AFM 3 Core reverse engineering — integration report

Status: **INTEGRATED AND PROVEN ON THIS MAC** (macOS 27.0, build 26A428).

Goal: make Apple's on-device Foundation Model (AFM 3 Core, the 3B dense tier)
work like a regular local LLM — better quality-to-latency than the pipeline's
other models, fully OpenAI-compatible so any client can use it.

TL;DR: no weight extraction was needed and none is possible. The on-device
weights under `/System/Library/AssetsV2/com_apple_MobileAsset_UAF_FM_*` are
SIP-protected (`Operation not permitted` on read). Apple ships the **public
`FoundationModels.framework`** plus the **`/usr/bin/fm` CLI** that exposes the
exact same stack Siri/Apple Intelligence use. `fm serve` turns it into an
OpenAI Chat Completions server. That is the integration surface.

## What was confirmed on this machine

| Research item | Finding |
|---|---|
| OS | macOS 27.0 (26A428) |
| Assets | `com_apple_MobileAsset_UAF_FM_GenerativeModels` (core weights), `UAF_FM_CodeLM`, `UAF_FM_Visual`, plus full Apple Intelligence asset family — all present; weights SIP-protected, not readable |
| Frameworks | `FoundationModels.framework` (public), `CoreAI.framework`, `GenerativeModels.framework`, `TextGeneration(.Inference).framework` |
| CLI | `/usr/bin/fm` (Apple-signed, root:wheel, 3.4 MB) — commands: `available`, `chat`, `count-tokens`, `license`, `respond`, `schema`, `serve`, `system` |
| Availability | `fm available` → "System model available" |
| Tokenizer | `fm count-tokens "hello world this is a token count test"` → 9 |
| Live inference | `fm respond -g --no-stream "Reply with exactly one word: OK"` → `OK` in 0.578 s total (0.02 s user) |
| Server | `fm serve --host 127.0.0.1 --port 1977` — `GET /v1/models` returns `{"id":"system","owned_by":"Apple"}`; streaming SSE chat chunks and non-streaming chat completions both verified with real `usage` token accounting |

## The "works like a regular LLM" integration

`fm serve` is an OpenAI-compatible Chat Completions server (verified live):

```
GET  /v1/models
POST /v1/chat/completions   # stream:true (SSE) and stream:false both work
```

Live probe evidence (`evidence/endpoint-probes.txt`):

- `GET /v1/models` → `{"data":[{"id":"system","object":"model","created":1789450561,"owned_by":"Apple"}],"object":"list"}`
- streaming: `data: {"choices":[{"delta":{"content":"AF"}...` → `[DONE]`
- non-streaming: `{"object":"chat.completion","usage":{"prompt_tokens":61,"total_tokens":76,...},"choices":[{"message":{"role":"assistant","content":"1, 2, 3"}}]}`

opencode provider registration added to `~/.config/opencode/opencode.jsonc`
(`afm` provider, `@ai-sdk/openai-compatible`, baseURL `http://127.0.0.1:1977/v1`,
model `system` → selectable as **`afm/system`**). Requires opencode restart
(config is loaded at startup only).

## Benchmark (same prompt, max_tokens 24, wall time)

| Endpoint | Model | Latency |
|---|---|---|
| `http://127.0.0.1:1977/v1` | AFM 3 Core (`system`) | **0.73 s** |
| `http://127.0.0.1:1234/v1` | `openai/gpt-oss-20b` (pipeline verifier) | 7.26 s |

AFM 3 Core completed the same request ~10× faster than the pipeline's current
default local model on this Mac.

## Architecture notes (from Apple ML Research + teardown evidence)

- AFM 3 family (WWDC26): two on-device models — **AFM 3 Core** (3B dense,
  broadly compatible) and **AFM 3 Core Advanced** (20B sparse, IFP
  instruction-following pruning, 1–4B active, NAND-backed, M3+ Macs / 12 GB
  RAM). Server tiers: AFM 3 Cloud, AFM 3 Cloud (Image), AFM 3 Cloud Pro.
- `fm` pins one tier (`system` = on-device). Siri-side routing
  (`ORCHNLRouterBridge` → PCC) is a separate orchestration layer, gated by
  attestation — not part of `fm`.
- On-device catalog tiers: `instruct_9m/85m/300m/3b` + code/vision/speech
  families, with `.draft` speculative-decoding twins.
- Prior-gen AFMTextV7 (from 2025 analysis): 3.18B base + 48.77M draft,
  56 layers (35+21), 2048 hidden, 153.6k vocab, 2-bit QAT weights, ~1.0–1.1 GB
  production footprint via ANE.
- Developer tier: `SystemLanguageModel.default` (public Swift API) — observed
  on-device on iPhone (iOS 27) with contextSize 8192; `fm serve` is chat-only
  (requests with a `tools` array are rejected), so agent frameworks must omit
  tool definitions for this endpoint.

## Capability proof — Swift bridge (public FoundationModels framework)

`src/afm-bridge.swift` compiles against the public module and reports the
on-device model's real runtime capabilities over `SystemLanguageModel.default`
(compile: `xcrun swiftc -parse-as-library -O -o afm-bridge afm-bridge.swift`):

```json
{
  "capability.toolCalling" : true,
  "capability.guidedGeneration" : true,
  "capability.vision" : true,
  "capability.reasoning" : false,
  "isAvailable" : true,
  "model" : "SystemLanguageModel.default"
}
```

toolCalling / vision / guidedGeneration **true** on this exact build (macOS
27.0, 26A428) — the assistant-grade lane is architecturally proven; the
`LanguageModelSession(model: .default, tools: [any Tool])` and `Tool` protocol
symbols compile (verified from the SDK swiftinterface). reasoning is false on
AFM 3 Core (the 20B sparse AFM 3 Core Advanced tier carries it, per Apple's
third-gen whitepaper). Evidence: `evidence/afm-capabilities.json`.

## How to run

```
fm serve --host 127.0.0.1 --port 1977 &   # then any OpenAI client:
curl http://127.0.0.1:1977/v1/models
```

Restart after reboot is required (no launchd entry installed — see
`scripts/afm-serve.sh` for the manual wrapper). No installs, no network
egress, no weight extraction were used; everything runs on-device via the
public framework. The reverse-engineering path stops at the framework boundary
by design: the weights themselves are SIP-protected Apple assets and the
public API is the supported, superior surface.