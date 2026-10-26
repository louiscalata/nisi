# AGIW / Nisi Mac enhancement pass — 2026-09-23 to 2026-09-25

This record covers the Mac Nisi v1 inference seam and its Mac-side AGIW
boundary. Windows implementation stays with the Windows development lane.
The acceptance counter remains **1/8**: V1-01 was previously accepted; this
pass does not accept V1-02 or certify the suite.

## Implemented in source

| Area | Change |
| --- | --- |
| Context and turn ownership | AFM and local turns now carry an owner token from user append through commit or rollback. A second request cannot abort the active turn. Failed and empty turns restore the prior transcript, including entries displaced by the pending user. Model requests include the current user once. Native AFM context is rebuilt when retained history drops older turns. |
| Local stream integrity | A local SSE response must reach `[DONE]`; an incomplete stream fails instead of retaining partial text as `PASS`. Stream bytes, line bytes, and retained reply length are bounded. The configured target is loopback-only and redirects are refused. Whitespace-only replies are `EMPTY_REPLY` and are not saved. The response evidence says `loopback-responded`, without claiming verified residency. |
| Conversation files | Load uses an opened, no-follow regular-file descriptor with bounded reads and strict UTF-8. Manifest bounds and entry caps are checked. New files are created mode `0600` before atomic rename; the app-support directory and the existing live conversation are mode `0700` and `0600` respectively. The digest remains an integrity check, not encryption or authentication. |
| Window lifecycle | Sending waits for restore. Deleting the current conversation checks the shared session and clears in-memory/native context in the same actor operation as file removal. The app has one main conversation window. A corrupt history row can be explicitly deleted. Failed turns return the text to the composer; a completed reply with a failed save is labelled as a save failure. |
| Reply integrity | The retained assistant reply preserves its exact text instead of trimming it after hashing and display. |
| Status reporting | `nisi-status` now limits its loopback inventory request by time and bytes, refuses redirects, requires HTTP 200 and a valid inventory shape, and labels loaded models as provider reported rather than independently verified inference. Timeout, bad HTTP, redirect, oversize and malformed inventory have separate machine-readable states. |

The status JSON keeps its existing `local.state` value for consumers and adds
`stateScope: "inventory-server"` plus `generationObserved: false`. Thus
`running` means the inventory server responded, not that Gemma is generating.
An unavailable inventory uses `loadedEvidence: "not-observed"`.

## Verification on this Mac

- `nisi-chat --selftest`: **48/48** deterministic checks.
- At the initial enhancement checkpoint, `nisi-session --selftest` passed
  **67/67** deterministic checks, including
  owner-token isolation, pending-delete refusal, rollback, size/symlink/file
  modes, incomplete SSE refusal, and SSE byte caps.
- The `nisi-chat`, `nisi-session`, `nisi-status`, adaptive-depth probe, and SwiftUI window
  sources compiled for `arm64-apple-macos26.0` with the installed SDK.
- One isolated live AFM turn replied `OK`, status `PASS`, on-device transport,
  with no content persisted.
- One isolated local Gemma turn at 64 output tokens produced no visible reply;
  Nisi reported `EMPTY_REPLY` and did not save it. At 256 output tokens it
  produced a reply, reached `PASS`, and saved a verifiable conversation. The
  test conversation was then deleted.
- After the bounded SSE decoder change, a 256-token local turn again produced
  `EMPTY_REPLY`; a 512-token turn returned `OK`, reached `PASS`, and saved.
  That isolated test conversation was deleted. The status probe reported one
  provider-loaded Gemma instance and `inferenceVerified: false`.
- After redirect refusal, a 512-token isolated local turn returned a reply,
  reached `PASS`, and saved; that test conversation was deleted. The status
  probe returned the existing conversation and a provider-reported Gemma
  inventory on its healthy loopback path. The redirect and timeout paths were
  checked by source and compilation, not an injected HTTP fixture.
- The existing user conversation loaded read-only as schema 2 with 12
  messages. A synthetic GUI turn was removed afterward; the original JSONL
  file and digest were restored byte for byte.
- `npm run check` remains **red: 2891/2892 tests passed**. The sole failure is
  the pre-existing journal import test, which allows only `node:crypto` while
  its production module imports `node:util` for proxy refusal. The test is
  pinned by immutable historical dependency hashes. A test-only whitelist
  change caused those history gates to reject its changed hash, so the exact
  pinned test was restored; its original failure remains for the contract
  owner to resolve. The history transition suite passed 22/22 after restore.

## SSD context implementation (2026-09-24)

Nisi already stores bounded conversation history on the Mac SSD as a JSONL
file plus digest in Application Support. This is persistent history, not a
temporary cache and not model context offload. AFM or Gemma still receives a
bounded selected transcript in active model context. The current bound uses
UTF-16 character counts as an approximation; it is not a token counter.
[Apple's context-window guidance](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window)
describes trimming or rebuilding a model session when its token window fills;
[LM Studio's load guide](https://lmstudio.ai/docs/cli/local-models/load)
defines context length in tokens at model load. Neither describes SSD history
as automatically enlarging active model context.

Louis chose a 24-hour lifetime for explicitly selected project excerpts. The
Mac-only V1-03 cache is implemented separately from the conversation store at
`~/Library/Caches/Nisi/TemporaryContext`. It accepts at most eight individual
UTF-8 files of at most 16 KiB each, refuses symlink paths and nonregular files,
limits selected source paths to 4,096 UTF-8 bytes, keeps owner-only cache
permissions, and supplies at most 1,200 UTF-16 units
to a request. Stable source IDs, captured byte ranges and SHA-256 labels travel
with selected excerpts. User clear and conversation deletion revoke the grant;
expired files are removed on a cache check or the next launch. This is ordinary
deletion and the guarded content lane remains separate. The implementation
and acceptance limits are in `work-orders/v1-03-project-context/README.md`.

The V1-03 cache suite passed **56/56** checks, the current session suite
**77/77**, and the chat suite **48/48**. The focused Mac routing queue suite
passed **7/7** after the September 25 expiry-boundary repair. An isolated live selected-file probe
with a synthetic fact and source ID passed through both AFM and loopback Gemma
at the window's 1,280-token output cap. Two local turns at 256 tokens returned
`EMPTY_REPLY`, which Nisi did not treat as a successful response. A second
11.5 KiB selected file put the answer near its end; both live backends found
the answer in a query-matched passage and cited the source ID. The signed Mac
GUI selected a text fixture, produced an AFM reply with its source ID, cleared
the grant, and restored the same source ID after relaunch. The final native
picker revision accepted JSON and YAML fixtures; replacement source labels
updated in the window and accessibility tree. Clearing removed the cache files.
The signed bundle and user conversation were rechecked after those tests.
V1-03 user review remains open. Disk capacity does not enlarge the model
context window.

A final independent review caught a citation-header digit-width error: a
full mid-file passage could produce 1,202 UTF-16 units against the 1,200-unit
request cap. A new regression reproduced that failure on the old formula and
passed after the header budget was corrected. The window's minute expiry
sweep now also runs during long model turns. The Mac app was rebuilt and signed
again with these fixes.
The final double-check found and fixed three more edges: JSON escaping could
reject eight otherwise valid full-sized files; a long selected path could
consume the citation budget and leave no excerpt; and deletion of a corrupt
conversation lacked a trustworthy ID to revoke its cache. Focused regressions
reproduced the first two on the old source and pass on the repaired store.
Deletion with no trusted ID now clears all temporary grants, preserving
unrelated non-UUID files. The completion notice counts references actually
submitted, even if the grant expires during a long turn.

The September 24 follow-on review found that one long selected file could use
the entire request passage budget and starve another relevant file. Retrieval
now reserves bounded passage space per admitted source and reports how many of
the selected files were actually supplied. An empty selected file contributes
no reference prompt. Citation display paths escape controls and line
separators, and the small-budget fallback checks that a source can contribute
text before choosing it. The request retains the final 1,200-UTF-16 bound.
The window restores the digest of the verified saved conversation on launch.
After a failed save it now re-verifies the disk pair, keeps only a verified
digest, and clears the badge if the two files disagree. The
local SSE decoder accepts CRLF lines while counting the CR toward its byte
caps. The Mac routing queue adapter refuses an expired job before calling its
host store; that focused queue seam does not establish production dispatch.

On September 25 a separate source audit reproduced the failed-save badge and
the fractional-second mismatch between a millisecond job deadline and the
ledger's whole-second expiry. The queue now refuses at the earlier, conservative
ledger boundary, and its expiry helper agrees. Two bounded Claude CLI review
receipts identify **`claude-opus-5-5`**; the first excerpt review and a focused
follow-up after these repairs both returned PASS. The initial packet omitted
the save-write lines and did not expose the fractional boundary, so its PASS
alone would not have found these defects. The exact packets, receipts, repair
scope and host checks are in
[the September 25 review record](verification/2026-09-25/mac-v1-opus-review/REPORT.md).

## Remaining gates and risks

- The two-file JSONL plus digest update is atomic per file, not as a pair.
  A crash between replacements can leave a checksum mismatch. Recovery or a
  single-file generation format needs its own migration and crash test.
- The conversation remains plaintext. Owner-only permissions limit local
  access but do not provide encryption or secure deletion. Backup/snapshot
  behavior has not been evaluated.
- Selected excerpts are kept out of JSONL history, but a model reply may quote
  them and that reply follows the existing conversation persistence policy.
  Expired cache files are removed on the next launch if the app is closed when
  their deadline passes. Citation metadata is not separately retained with a
  saved reply after cache expiry.
- The updated, ad-hoc signed `Nisi.app` bundle is installed on disk at
  `work-orders/v1-chat-slice/build/Nisi.app` and verifies with
  `codesign --verify --deep --strict`; its executable SHA-256 is
  `a9679069e90f00ccf82591ad863eba74d1c74c852c5e7dfd46d826a6a248d4c5`.
  The current binary launched as a live Mac process. Accessibility showed
  the restored conversation and `last verified save d0dc303d`. The picker,
  cited reply, source-label accessibility, and Clear
  control were tested on preceding signed revisions; the additional cache
  bounds and revocation paths passed deterministic checks. User acceptance
  remains open.
- The original JSONL and digest matched their pre-test hashes immediately
  after the synthetic GUI turn was removed. Following an earlier relaunch,
  two further user/assistant turn pairs appeared in the live conversation;
  its current sidecar matches its content (16 messages, digest prefix
  `d0dc303d`, owner-only file and sidecar modes). Those turns were left intact.
- Model output quality was observed only on isolated short prompts. This does not
  establish broad quality, comparative accuracy, adaptive-depth acceptance,
  or release readiness.
- V1-03 needs user acceptance; V1-04 through V1-08, including governed
  actions, an end-to-end coding workflow, optional Jev, failure lessons, and
  build evaluation, remain open.
  The Windows worker has no implementation changes or acceptance claim here.
- Mac-side routing and gate audit found further unintegrated contract work:
  Jev's safe `hold` answer cannot form a queue decision; enqueue now checks
  expiry, but bound acknowledgement is still absent; the AFM content executor still
  has a hash-check-to-spawn path race. These require focused contract and
  adversarial tests before use as an authoritative AGIW dispatch path.

## Review and routing

At the earlier checkpoint, Claude Fable 5.1 was unavailable due to the route's
credit limit. A bounded
Claude Sonnet review identified the empty-reply, duplicate-context, and store
risks; an independent Codex review found cache security faults that were
repaired, while Luna implemented the bounded cache and Sol built its checks.
The Daybreak Blue route was denied and the Spark route returned a free-tier
refusal, so neither result is counted.
On September 25, the requested Opus 5.5 participated through two tool-free
Claude CLI reviews with actual `claude-opus-5-5` usage receipts. The PASS verdicts
are scoped to their supplied excerpts and do not certify the product.
Codex integrated the changes and verified the compiled Mac sources and
observed turns. No GitHub push or release was made.
