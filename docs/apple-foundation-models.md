# Apple Foundation Models advisory adapter

`createAppleFoundationModelsAdapter` is the descriptive alias of
`createAFMContentExecutor`. It connects an admitted UTF-8 file to the bundled
Swift helper and checks its structured advisory response. It is separate from
the local-chat coding author/reviewer adapters.

The helper needs an Apple Silicon Mac with compatible Apple Intelligence and
Foundation Models availability. The retained native checks ran on macOS 27
with Swift 6.4. The source targets macOS 26 or later. Build it locally:

```bash
swiftc -O -parse-as-library -target arm64-apple-macos26.0 \
  probes/afm-content-probe.swift -o /tmp/nisi-afm-content-probe
shasum -a 256 /tmp/nisi-afm-content-probe
```

Provide the resulting absolute binary path and its actual SHA-256, a ready
File Access Policy grant, a task-to-file map, and an optional timeout:

```js
const adapter = createAppleFoundationModelsAdapter({
  binary: '/tmp/nisi-afm-content-probe',
  binarySHA256: actualBinaryDigest,
  grant,
  items: { 'task.read': { filePath: absoluteDocumentPath, kind: 'markdown' } },
  timeoutMs: 60_000,
});
if (!adapter.ok) throw new Error(adapter.code);
const result = await adapter.execute(Buffer.from('request identifier'), {
  taskId: 'task.read', signal: abortController.signal,
});
```

The request must be a nonempty Buffer and serves as an opaque digest-bound
identifier. It is not a model prompt. `taskId` selects one file from the map
captured at construction. File admission precedes binary verification and
launch. The helper receives a header and admitted bytes through stdin, no
arguments, and a fixed PATH environment. The timeout range is 50–120,000 ms;
evidence output is capped at 16,384 bytes.

The adapter requires strict UTF-8 and unambiguous JSON, the exact native evidence
schema, matching consent/content/kind/byte count, expected prompt digest, exact
limitation codes and a matching capped advisory digest. Native unavailable or
malformed output cannot produce `AFM_PACKET_ANSWERED`.

`readings()` returns frozen records with the full validated evidence, prompt
version, binary digest and an execution digest binding task ID, request, helper,
prompt version and evidence. The original `payloadSha256` formula is preserved
for compatibility. `refusals()` reports named causes. Neither result grants
publication, promotion or certification authority.

Binary hashing and pathname launch remain separate operations and require a
stable trusted binary directory. The native report's no-egress/persistence/tool
flags are validated self-reports, not an independent network or storage audit.
Abort requests kill the helper and refuse the response; they cannot reverse
already-consumed input or guarantee cleanup by every underlying service. The
API does not expose the exact on-device model ID.

See [verification](verification.md) for real native calls, separately from the
stand-in process tests used by the portable test suite.
