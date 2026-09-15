# AFM adapter — Apple Foundation Models 3 Core on-device lane (Nisi)

Wire-in point for the reverse-engineered AFM 3 Core lane (macOS 27.0,
26A428). Everything referenced below lives in
`work-orders/afm-reverse-engineering-v1/` (full report, evidence, sources).

## Two lanes (how this fits the existing repo)

Nisi already had one AFM integration; the conversational lane added here sits
*beside* it and must not blur its boundaries:

- **Guarded content lane (pre-existing, authoritative for consented reads):**
  `adapters/apple-foundation-models.mjs` →
  `gate/afm-content-executor.mjs` + `probes/afm-content-probe.swift`.
  Consent gate admits exactly one item per request; a hash-pinned probe reads
  it (route `system-on-device-requested`) and returns digest-verified evidence
  with hard boundary flags (`contentPersisted`, `transcriptPersisted`,
  `networkEgress`, `externalToolsEnabled`, `acceptanceAuthorityGranted` all
  false). Tests: `tests/afm-content-executor.test.mjs` (+ 6 related files);
  native verification 2026-09-11 (`docs/verification/2026-09-11/native-apple.json`).
- **Conversational lane (this adapter):** `fm serve` OpenAI-compatible chat
  endpoint, opencode provider `afm/system`, and the Swift bridges with the
  proven tool loop. General chat and tool-augmented agents only — it never
  performs consented content reads and grants no acceptance/certification.

Boundary flags in the guarded lane stay false regardless of the conversational
lane's capabilities; the lanes share only the on-device model tier.

## Health check

`adapters/afm/check [--bridge]` — read-only probe of the LaunchAgent,
`/v1/models`, a live completion, and (with `--bridge`) the v2 Swift bridge.
Exit 0 only when the lane serves.

## Tool agent CLI

`adapters/afm/agent "<question>"` — on-device tool-augmented answer
(get_time + count_words), manifest loop identical to the proven v6 bridge;
auto-builds on first run. Example
(`evidence/afm-agent-demo.txt` in the work order):

```
$ adapters/afm/agent "What time is it in UTC and how many words are in 'hello world this is a test'?"
The current time in UTC is 2026-09-15 06:57:53 GMT. The text 'hello world this is a test' contains 6 words.
```

## Tool agent with MCP + LSP

`adapters/afm/agent-tools "<question>"` — extended agent with real MCP and LSP
tool bridges, plus file operations and shell execution. Auto-builds on first
run. Six tools: `run_command`, `read_file`, `write_file`, `lsp_diagnostics`,
`mcp_list_tools`, `mcp_call`.

**Standalone modes:**

```
$ adapters/afm/agent-tools mcp-list "python3 /Users/louiscalata/bin/bionic-code-mode-mcp"
# Lists all tools from the codemode MCP server (pipeline_status, initiate_online_code_mode, etc.)

$ adapters/afm/agent-tools lsp-diag /path/to/file.py
# Returns LSP diagnostics from basedpyright (errors, warnings with line numbers)
```

**Full agent round** (AFM calls tools via `LanguageModelSession(tools:)`):

```
$ adapters/afm/agent-tools "Run the command 'date -u' and tell me the current UTC time."
The tool output shows the current UTC time as **Tue Sep 15 07:21:49 UTC 2026**.
```

Evidence: `evidence/afm-mcp-list.json`, `evidence/afm-lsp-diag.json`,
`evidence/afm-tools-agent-round.json`, `evidence/afm-tools-fm-probe.json`.

## Planner/executor mode (`--brain`)

AFM is the executor; a capable local model plans. The Qwen 35B model served at
`http://127.0.0.1:1234/v1` (Bionic/lmstudio, `qwen/qwen3.6-35b-a3b`) emits
OpenAI-format `tool_calls`; this Swift layer executes them natively
(bash/file/LSP/MCP — no LLM inference in the executor, so it is fast), feeds
results back as `role:tool` messages, and repeats until the brain answers.
Verifier `openai/gpt-oss-20b` and any other served model work as the brain too:

```
$ adapters/afm/agent-tools --brain [<model-id>] "<question>"
$ adapters/afm/agent-tools --brain "Run 'date -u' and report the current UTC time."
  [round 1] brain -> run_command {"command":"date -u"}
[executor: afm (on-device tool layer) | brain: qwen/qwen3.6-35b-a3b]
The current UTC time is:
**Tue Sep 15 07:38:37 UTC 2026**
```

The brain reuses the same six tools (same executor + same schemas as the
`LanguageModelSession` lane). Tool calls print to stderr as provenance; the
header + final answer go to stdout. Evidence: `evidence/afm-brain-executor-round.json`,
`evidence/afm-brain-mcp-round.json` (Qwen → `mcp_list_tools` → 7 codemode
tools, grounded answer).

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
  Ops note: `fm serve` ignores SIGTERM — recycle with
  `kill -9 <pid>` then `launchctl kickstart -k gui/$(id -u)/com.louiscalata.afm.serve`
  (observed when replacing a manually-started instance; the agent otherwise
  crash-retries while the old process holds the port).
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
- v6: two-tool agent round in one turn (get_time + count_words both called,
  decoded, executed, results grounded in the final answer —
  `evidence/afm-two-tool.json`).

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