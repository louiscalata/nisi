# Apple Foundation Models advisory adapter

`createAppleFoundationModelsAdapter` is the descriptive alias of
`createAFMContentExecutor`. Import it from `nisi/adapters/apple-foundation-models`
or the package root. It connects an admitted UTF-8 file to a Swift helper that
you build and pin, and checks its structured advisory response. It is separate
from the local-chat coding author/reviewer adapters.

The helper's source, `probes/afm-content-probe.swift`, is in the repository. It
is not included in the npm-format archive, so build it from a source checkout
of the tag you installed. The helper needs an Apple Silicon Mac with compatible
Apple Intelligence and Foundation Models availability. The retained native
checks ran on macOS 27 with Swift 6.4. The source targets macOS 26 or later.
Build it into a stable directory you own, not a shared or cleaned one such as
`/tmp`:

```bash
mkdir -p "$HOME/Library/Application Support/nisi"
swiftc -O -parse-as-library -target arm64-apple-macos26.0 \
  probes/afm-content-probe.swift \
  -o "$HOME/Library/Application Support/nisi/afm-content-probe"
shasum -a 256 "$HOME/Library/Application Support/nisi/afm-content-probe"
```

Provide the resulting absolute binary path and its actual SHA-256, a ready
File Access Policy grant, a task-to-file map, and an optional timeout:

```js
import os from 'node:os';
import path from 'node:path';
import { createAppleFoundationModelsAdapter } from 'nisi/adapters/apple-foundation-models';

const adapter = createAppleFoundationModelsAdapter({
  binary: path.join(os.homedir(), 'Library/Application Support/nisi/afm-content-probe'),
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
for compatibility. `refusals()` reports named causes as `{ taskId, cause }`
records. Neither result grants publication, promotion or certification authority.

A helper binary that is missing or cannot be read is `BINARY_UNREADABLE`: the
construction code, or the refusal cause when the file disappears later. Nothing
is launched. A helper that exits with a nonzero status is `CHILD_EXIT_NONZERO`.
The helper refuses by writing one code and a newline to stderr and exiting 65.
When stderr held exactly that line with one of its codes (`PLATFORM`,
`MODEL_UNAVAILABLE`, `MODEL_REFUSED`, `STDIN_BYTES`, `STDIN_FRAMING`,
`HEADER_INVALID`, `HEADER_BOUNDS`, `CONTENT_DIGEST_MISMATCH` or
`CONTENT_NOT_UTF8`), the refusal record also has `helperCode` set to that code.
For example, `MODEL_UNAVAILABLE` means the helper found the on-device model
unavailable, and `PLATFORM` means macOS is earlier than 26. The cause and the
refusal's `payloadSha256` remain those of `CHILD_EXIT_NONZERO`. No other stderr
output is surfaced, and at most 64 bytes of it are held.

Binary hashing and pathname launch remain separate operations and require a
stable trusted binary directory. The native report's no-egress/persistence/tool
flags are validated self-reports, not an independent network or storage audit.
Abort requests kill the helper and refuse the response; they cannot reverse
already-consumed input or guarantee cleanup by every underlying service. The
API does not expose the exact on-device model ID.

See [verification](verification.md) for real native calls, separately from the
stand-in process tests used by the portable test suite.
