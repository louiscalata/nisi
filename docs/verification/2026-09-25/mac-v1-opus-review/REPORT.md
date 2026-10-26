# Mac Nisi v1 Opus 5.5 review — 2026-09-25

Louis asked Claude Opus 5.5 to check the September 24 Mac Nisi and Mac AGIW
improvements. Windows development was outside this review. Codex remained the
write and verification owner.

## Reviewer participation and scope

The bounded, tool-free Claude CLI reviewer received
[the initial packet](initial-packet.md) and returned
[a PASS with no issues](initial-review.json). Its receipt reports the actual
model `claude-opus-5-5`, one attempt, 22.971 seconds, and no tools. This is a
review of supplied excerpts, not an independent repository read or test run.

A separate local source audit then reproduced two issues the initial packet
did not expose fully:

1. `ConversationStore.save` writes JSONL and its digest sidecar separately. A
   sidecar install failure after the JSONL replacement can make the pair fail
   verification while the window still displays the old saved digest.
2. The routing payload rounds its deadline down to whole seconds. A job with
   `expiresAtMs = 31_001` was admitted at `nowMs = 31_000` even though the
   ledger's `expiresAt = 31` seconds had arrived.

The window now labels the badge **last verified save** and rechecks the disk
pair after any failed save. It clears the badge and reports an unverified
on-disk conversation when that recheck fails. This removes the misleading
badge; it does not make the two-file save transaction atomic. A format or
recovery change needs separate migration and crash tests.

The Mac routing adapter now refuses enqueue when either the exact millisecond
deadline or its conservative ledger-second deadline has arrived.
`routingJobExpired` uses the same rule. A new regression failed on the prior
source (6/7 passing) and passes after the repair (7/7).

Claude Opus 5.5 then received [the repaired excerpts](followup-packet.md) and
returned [PASS with no issues](followup-review.json). The second receipt reports
`claude-opus-5-5`, one attempt, 16.112 seconds, and no tools. Both PASS results
are advisory review results, not product acceptance.

## Host verification after repair

| Check | Result |
| --- | --- |
| Temporary context CLI | 56/56 |
| Session CLI | 77/77 |
| Chat CLI | 48/48 |
| Mac routing queue | 7/7 |
| Full SwiftUI window source build | Passed, `arm64-apple-macos26.0` |
| Signed app | Strict verification passed; executable SHA-256 `a9679069e90f00ccf82591ad863eba74d1c74c852c5e7dfd46d826a6a248d4c5` |
| Relaunched app | Accessibility showed **last verified save d0dc303d**, an empty composer, and no selected project files |
| Existing conversation | 16 messages; current sidecar matches the JSONL digest; both files mode `0600`; user content unchanged by these checks |

The temporary cache directory was empty on the final check. No new live model
turn was sent through this build. The full repository check was not rerun in
this review; its separately documented pinned journal import-policy failure
remains outside this Mac slice. Nisi v1 acceptance stays **1/8**. No GitHub
push or release occurred.
