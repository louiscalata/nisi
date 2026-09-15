# AFM adapter — Apple Foundation Models 3 Core on-device lane (Nisi)

Wire-in point for the reverse-engineered AFM 3 Core lane (macOS 27.0,
26A428). Everything referenced below lives in
`work-orders/afm-reverse-engineering-v1/` (full report, evidence, sources).

## Registered provider (opencode)

- `~/.config/opencode/opencode.jsonc` — provider `afm` (OpenAI-compatible
  SDK, baseURL `http://127.0.0.1:1977/v1`, model `system` =
  "AFM 3 Core — On-Device", context 8192, output 4096).
- Select as `afm/system`. Requires an opencode restart (config is
  read at startup only).

## Serving

- Autostarted via LaunchAgent `com.louiscalata.afm.serve`
  (`~/Library/LaunchAgents/com.louiscalata.afm.serve.plist`,
  KeepAlive + RunAtLoad; logs `/tmp/fm-serve.log`, `/tmp/fm-serve.err`).
  Quirk: the launched process exits 1 from launchd's view while the server
  child keeps serving (port-race at bootstrap resolved by KeepAlive);
  the endpoint stays up.
- Manual alternative: `scripts/afm-serve.sh` (or the original commit's pid-tracked run).
- Endpoint: `GET /v1/models` → `{"id":"system","owned_by":"Apple"}`;
  streaming SSE and non-streaming JSON chat completions with real usage.

## Verified capabilities (runtime, `SystemLanguageModel.default`)

| Capability | Result |
|---|---|
| toolCalling | true (full manual loop proven, see below) |
| vision | true at runtime; public prompt-composition boundary — see Limits |
| guidedGeneration | true |
| reasoning | false (Core tier; Core Advanced carries it) |
| isAvailable | true |

## Bridges (source + build)

```
cd work-orders/afm-reverse-engineering-v1/src
xcrun swiftc -parse-as-library -O -o afm-bridge afm-bridge.swift     # capability report
xcrun swiftc -parse-as-library -O -o afm-bridge-v2 afm-bridge-v2.swift   # one-shot generation
xcrun swiftc -parse-as-library -O -o afm-bridge-v4 afm-bridge-v4.swift   # tool-calling loop
```

- v2: `LanguageModelSession.respond(to:)` → real on-device content + usage.
- v4: complete agent loop — respond → transcript `.toolCalls` → structured
  arg decode (`GeneratedContent.value(_:)`) → `Tool.call` → `.toolOutput`
  entry → transcript-back session → final answer (evidence
  `evidence/afm-tool-loop.json`).

## Use from Nisi / opencode

- Chat/fast tasks: `afm/system` via opencode (restart first).
- Programmatic: any OpenAI-compatible client against `http://127.0.0.1:1977/v1`.
- Tool-augmented on-device agents: replicate the v4 loop (public API).
- ~10× faster than `lmstudio/openai/gpt-oss-20b` on identical completions.

## Limits (documented, not worked around)

- Context window 8,192 tokens; `ToolCallingMode.required` adds heavy internal
  scaffolding that overflows it — prefer default `.allowed` + explicit
  instruction cues.
- Weights/assets are SIP-protected; no extraction (by design — supported
  surface only).
- Chat endpoint (`fm serve`) rejects tools; tools go through the Swift bridge.
- Vision: `capability.vision=true` and `ImageAttachment`/`AttachmentSegment`
  construct, but the advertised `Attachment: PromptRepresentable` conformance
  is rejected by the compiler in this SDK build — image-attached prompts are
  not expressible via the public API yet (evidence `evidence/afm-vision-probe.swift`).

Evidence: `evidence/endpoint-probes.txt`, `evidence/afm-capabilities.json`,
`evidence/afm-session-generation.json`, `evidence/afm-tool-demo.json`,
`evidence/afm-tool-loop.json`, `evidence/afm-vision-probe.swift`.