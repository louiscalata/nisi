# Nisi V1-01 — installed-SDK evaluation (2026-09-21)

Scope boundary: documentation + deterministic groundwork only. No live inference
ran to produce this document; streaming is verified *statically* against the
installed SDK, and the roadmap's explicit live-streaming verification step is a
separate, later action.

## Host and toolchain

| Item | Value (observed) |
|---|---|
| macOS | 27.0 (BuildVersion 26A428) |
| Xcode | 27.0 (`/Applications/Xcode-27.0.app`) |
| Swift | 6.4 (`swiftlang-6.4.0.27.1`), target `arm64-apple-macosx27.0.0` |
| SDK | `MacOSX27.0.sdk` (also `MacOSX.sdk` / `MacOSX27.sdk` aliases) |
| `afm` helper CLI | installed at `~/bin/afm` (text/triage/requirements/failure-memory/tags) |

## Apple Foundation Models framework

The correct module name is **`FoundationModels`** (not `AppleFoundationModels`).
Present in the installed SDK at
`.../MacOSX27.0.sdk/System/Library/Frameworks/FoundationModels.framework`,
with the platform support frameworks:

- `_FoundationModels_AppKit.framework`
- `_FoundationModels_SwiftUI.framework`
- `_FoundationModels_CoreSpotlight.framework`
- `_Vision_FoundationModels.framework`

SwiftUI/AppKit support frameworks exist on-device → a native chat window surface
has a local framework path; nothing remote is required for the UI.

## Verified API surface (arm64e-apple-macos.swiftinterface)

| Capability | Installed interface | Notes |
|---|---|---|
| On-device model | `SystemLanguageModel.default`; `availability` with `.available` case | `PrivateCloudComputeLanguageModel` is never constructed (no egress) |
| Session | `LanguageModelSession(model:tools:instructions:)` | tools must be `[]` for V1-01 |
| Single response | `respond(to:options:)` | used by the owned `probes/afm-content-probe.swift` |
| **Streaming** | `streamResponse(to:options:)` → `LanguageModelSession.ResponseStream<Content>` | `ResponseStream` iterates `Snapshot` elements; `Snapshot.content` is the `String` chunk (`String: Generable`, `PartiallyGenerated == Self`) |
| Generation | `GenerationOptions(samplingMode: .greedy, maximumResponseTokens:)` | `#if compiler(>=6.4)` branch is the active one on Swift 6.4 |
| macOS 27 extras | `ContextOptions`, `metadata`, `transcriptEntries`, `Usage` on `Snapshot` | newer overloads are `macOS 27.0+` only |

## Decisions

1. **Reuse `LanguageModelSession` + `streamResponse`, do not duplicate session
   infrastructure.** The owned AFM probes already prove the session construction
   pattern compiles under this exact toolchain.
2. **V1-01 seam keeps the honesty contract of the probes:** on-device model
   only, no transcript persistence, no network egress, no tools, all authority
   flags false.
3. **Live streaming verify — DONE (2026-09-21, later same day).** Evidence below
   replaces "remains open".

## Live streaming verification (real on-device turns, 2026-09-21)

Runtime finding discovered on the actual Mac: **`snapshot.content` is the
CUMULATIVE partial response** — each snapshot extends the previous one and the
final snapshot is the complete reply. Joining snapshots duplicates prefixes. On
macOS 27 the transport delivered e.g. 11 snapshots / 225 UTF-16 while the final
reply was only 35 chars. Consumption rule implemented as
`TurnController.finalContent(from:)` (last non-empty snapshot wins) with
deterministic tests.

Turn 1 — `{"user":"In one sentence, describe what kind of assistant you are.",
"maxContextUtf16":1024,"maxTokens":200}`:
- Reply: *"I am a private on-device assistant."* (35 chars)
- `requestSha256 c0a606596a4f01d91d64ec226022c8e1671fbc9160eae39ba9db85b2ec9b01f4`,
  `replySha256 cafe33021d45be3afcdae3779d14848142603bc2c9aac4e8f3b11617c7d0c69a`
- Evidence: status PASS, model availability available, 11 chunks, 225 streamed
  UTF-16, contentPersisted/networkEgress/externalToolsEnabled/
  acceptanceAuthorityGranted all false. Exit 0.

Turn 2 (multi-turn context proof) — prior seeded with the turn-1 exchange
(`"prior":[{"role":"user","text":"In one sentence, describe what kind of
assistant you are."},{"role":"assistant","text":"I am a private on-device
assistant."}]`), then user `"What did I just ask you to do? Answer in one
sentence."`:
- Reply: *"You asked me to describe what kind of assistant I am in one
  sentence."* — context carried across turns.
- `requestSha256 3cff198987a9170ccd04375e5a18239d9e86d3d073759c7c44765a08e293fe72`,
  `replySha256 4a738b9a7e6294d4ee89a8ffdab44f751042df87cb5d1441c4ec6160a1efd23b`
- Evidence: status PASS, PRIOR_ENTRIES 2, requestChars 387 (prior included),
  15 chunks, 690 streamed UTF-16 vs 69 reply chars (cumulative shape again),
  all honesty flags false. Exit 0.

The `nisi-chat --turn` contract (stdin JSON): `{"user" (1..4096 UTF-16),
"maxContextUtf16" (256..16384, default 4096), "maxTokens" (64..2048, default
640), "prior" (≤16 entries {role: user|assistant, text 1..4096})}`. Prints
REQUEST_SHA256 / PRIOR_ENTRIES / REPLY_START..REPLY_END / evidence JSON.

## Deterministic evidence (groundwork)

- Seam multi-file typecheck: `swiftc -parse-as-library -target
  arm64-apple-macos26.0 -typecheck NisiChatLog.swift NisiTurnController.swift
  NisiChatSession.swift NisiChatWindow.swift NisiChatApp.swift`
  → exit 0 (all sources).
- In-process suite (`nisi-chat --selftest`): **47/47 checks, exit 0**, no
  model, no I/O. Selftest output sha256 `4cbbf311…91fd`.
- `nisi-chat` binary sha256 `e9a3ceda…611b`; window app binary sha256
  `ec13bdce…a81` (launched live, process verified running).
- Sources: `NisiChatLog d348bacf…`, `NisiTurnController 884bedd4…`,
  `NisiChatSession fc20d548…`, `NisiChatCLI d7fd716e…`,
  `NisiChatWindow c386da1c…`, `NisiChatApp fd54dd20…`.
## Addendum — quality increment API surface (2026-09-21, verified against the same installed SDK)

The chat-quality increment exercised additional FoundationModels surface, all
verified by typecheck at `-target arm64-apple-macos26.0`:

- **Native transcript seeding:** `LanguageModelSession.init(model:tools:transcript:)`
  accepts a `Transcript(entries:)` built from `Transcript.Entry` cases
  `.instructions(Instructions)`, `.prompt(Prompt)`, `.response(Response)` with
  text segments `Segment.text(TextSegment(content:))`. Restoring history this
  way carries prior turns into the session's own transcript WITHOUT replaying
  generation (the seam's `NisiChatSession` keeps one session per
  conversation and streams only the new user text per turn).
- **Sampling family:** `GenerationOptions(samplingMode:temperature:maximumResponseTokens:)`.
  macOS-26-compatible random sampling is the static constructors
  `SamplingMode.random(top:seed:)` and `.random(probabilityThreshold:seed:)`;
  the enum-case spellings `.randomTopK`/`.randomProbabilityThreshold` and the
  `Kind` property are macOS 27.0-only (a 26-target build must use the static
  constructors). `Transcript.Response` on the 26 target takes the
  `init(id:assetIDs:segments:)` form (`init(metadata:segments:)` is 27.0-only);
  `Transcript.Instructions` requires explicit `toolDefinitions: []`.
- **Loopback local route:** LM Studio resident `google/gemma-4-26b-a4b-qat`
  served `http://127.0.0.1:1234/v1/chat/completions` (OpenAI-compatible SSE,
  `data: {…delta.content…}` lines, `data: [DONE]` terminator) with no ATS
  block from a CLI binary; `request.timeoutInterval = 120` bounds hung servers.
- Deterministic tests cover the pure parts (transcript entry ordering + tuning
  values; loopback request body fields/order; SSE extraction/DONE), while live
  turns verified both backends end-to-end (AFM 296-char reply, local 607-char
  structured reply — see `../v1-02-lifecycle/before-after-20260921.md`).
