# V1-03 Mac project context: temporary SSD cache

This Mac-only slice lets a user select up to eight individual UTF-8 text files
in the Nisi window, including source and config files with uncommon extensions.
The native picker accepts files; the cache checks the actual bytes before use.
Nisi accepts files no larger than 16 KiB and copies them into an
owner-only cache under `~/Library/Caches/Nisi/TemporaryContext`. There is no
directory crawl and no automatic project access. Selected source paths are
opened through no-follow directory descriptors; symlinks and nonregular or
oversized files are refused. Source paths are limited to 4,096 UTF-8 bytes.
The encoded cache cap permits eight full-sized files even when their text
expands substantially during JSON encoding.

The user chose a **24-hour lifetime** on 2026-09-24. A cache grant is bound to
the current conversation UUID. Reads after expiry are refused. Expired files
are removed during startup and later cache checks; the open app checks every
minute. If Nisi is closed when the deadline passes, ordinary file removal
occurs on the next launch. Clearing project files or deleting the conversation
also removes its cache. If a corrupt conversation has no trustworthy ID,
deleting it clears all temporary project grants. This is ordinary deletion,
not secure erasure.

For each question, the host reloads the current grant, ranks its captured
excerpts by lexical overlap, reserves passage space for each source it can
admit, and supplies at most 1,200 UTF-16 units to either
the on-device AFM request or the resident loopback model request. Citation
headers include a stable source ID, escaped path or bounded path suffix, included byte
range, capture time,
and content SHA-256. The excerpts are labelled untrusted data; they grant no
tool access or acceptance authority. The cache is a retrieval layer, **not**
an expansion of either model's active context window. A source file can change
after selection; the citation refers to the captured snapshot until the user
selects again. The UTF-16 cap is a host text bound, not a model-token guarantee.
A selected empty file supplies no reference text, and a tight request budget
may omit some selected files. The window reports the count actually supplied.

The selected excerpts are not stored in the JSONL conversation history.
Replies may quote source content and are stored under the existing V1-02
conversation policy. Source labels remain visible while the grant is active;
the user should use the stable source ID and hash in a saved reply to identify
the captured snapshot after the temporary cache expires. Citation metadata is
not yet separately retained with each saved reply, so historical source
resolution after expiry remains a V1-03 acceptance limitation.

## Source and checks

- `session-seam/TemporaryContextStore.swift`: private file cache, grants,
  no-follow reads, expiry/revocation, bounded retrieval and citations.
- `session-seam/TemporaryContextCLI.swift`: deterministic cache self-tests.
- `session-seam/ProjectContextLiveProbe.swift`: isolated synthetic selected-file
  request through AFM or the loopback model, with separate turn, fact and
  source-ID results.
- `../v1-chat-slice/session-seam/NisiChatWindow.swift`: explicit file picker,
  Clear control, status, and request-local retrieval.
- `../v1-chat-slice/session-seam/NisiChatSession.swift` and
  `../v1-02-lifecycle/session-seam/LocalModelBackend.swift`: AFM and local
  request wiring. Reference content is not appended to the chat log; native
  model session state is discarded after a referenced turn or revocation.

Compile and run the cache suite from `session-seam`:

```sh
swiftc -O -parse-as-library -target arm64-apple-macos26.0 \
  TemporaryContextStore.swift TemporaryContextCLI.swift \
  -o /tmp/nisi-context-selftest
/tmp/nisi-context-selftest --selftest
```

On 2026-09-24 the cache suite passed **56/56**, the session suite **77/77**,
and the chat suite **48/48**. The isolated probe used a fictional selected
file containing the phrase `blue lantern`. AFM and the resident loopback model
both returned that phrase and the same stable source ID at a 1,280-token
output cap. Two local probe turns at a 256-token cap returned `EMPTY_REPLY`;
they were classified as failures and not saved. These observations do not
establish general answer accuracy.

A mid-file full-passage regression reproduced a 1,202 UTF-16 prompt against
the 1,200-unit limit with the previous citation-header budget. The corrected
header reserves both byte-offset widths; the same fixture now stays within
the cap. The open app runs its minute cache sweep even during a long turn.
Further regressions cover eight full 16 KiB files with JSON-expanded content,
a selected file under an approximately 1,000-byte path, and clearing two grants
when a corrupt conversation ID is unavailable. The citation label abbreviates
long paths; the source ID still hashes the full path and captured content.

A separate 11.5 KiB synthetic file put the answer near its end. Both live
backends returned the answer and source ID from a bounded matching passage;
the cache suite reconstructs the cited UTF-8 byte range exactly, including
Unicode before the passage. The window rechecks a grant after its actor wait
and before submitting a referenced request.

A later two-file regression reproduced first-file starvation within the
1,200-unit prompt budget. The allocator now reserves passage space so both
long query-relevant files contribute their distinct cited facts. Further
checks cover an empty selected file, display paths containing a control and
Unicode line separator, and a tiny budget where a two-unit emoji cannot fit
but a later ASCII source can. The final prompt stays within the host bound.

The signed Mac GUI passed a selected-file AFM cited reply, clear, and relaunch
with a restored stable source ID. The final native picker revision accepted
JSON and YAML fixtures, showed the replacement source ID in both the window
and accessibility tree, and cleared the grant. The original conversation file
and digest were restored byte for byte after the synthetic GUI reply; the
rebuilt signed window reopened with the current conversation and the temporary
cache empty. A later build containing the allocator and citation repairs
compiled, passed the checks above, was signed and launched. A September 25
review build additionally repaired the failed-save digest badge and a Mac
routing expiry boundary; accessibility confirmed the existing conversation
and verified-save badge on that build. The cited-reply and picker evidence
above remains from the earlier signed revision. V1-03 still needs Louis's user review before
acceptance, and V1-02 acceptance remains separate. Windows development stays
with the Windows lane.
