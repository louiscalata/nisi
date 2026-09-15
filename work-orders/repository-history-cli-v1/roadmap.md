# Operator-facing history review — private work order

**Overall Nisi:30% (3/10 NX milestones). This slice:100% (5/5 deliverables).**
This is source-checkout CLI/terminal integration, not NX-05 closure, native-app
acceptance, authenticated identity, automatic retention or release approval.

## Accepted deliverables

- [x] Actual private CLI --review-history wiring after host settlement, preserving
  default parser/summary/model receipt and refusing nonTTY before execution setup.
- [x] Fixed metadata/digest prompt, explicit separate answer, bounded input/wait,
  independent declaration, cancellation/reentry/one-attempt outcome preservation.
- [x] Additive source-checkout history types; positive compiler fixture and seven
  exact negative compiler diagnostics. No package allowlist/exports changed.
- [x] Full1510/1510 portable check;36 focused tests,16/16 and15/15 relocated
  controls, six semantic fault variants;252 selected source/type/test/script pins.
- [x] Real PTY decline and exact-answer approval with actual temporary journals,
  file/directory sync, fresh-process reopen and natural exit0 from both PTYs.

| Evidence | Actual result |
| --- | --- |
| [Original stub](../../.build/repository-history-cli-focused-57ni1z/verification.json) | 2/29 pass,27 fail; default/help already worked |
| [Fresh-stdin red](../../.build/repository-history-cli-focused-RM1NRm/verification.json) | 34/35 pass, one assertion failure on old terminal source |
| [Fresh-stdin green](../../.build/repository-history-cli-focused-iMK0dx/verification.json) | 35/35 after correction |
| [Final acceptance](../../.build/repository-history-cli-verification-zl56OG/verification.json) | 1510/1510,36 focused;252 pins stable, all242 prior pins exact |
| [PTY decline](../../.build/repository-history-cli-v1-pty-HbnOjJ/verification.json) | No owner-open/capture, no journal, stdin released, actual process exit0 |
| [PTY approval](../../.build/repository-history-cli-v1-pty-6Fz27d/verification.json) | One stored/synced observation, exact ID/digests in fresh reopen, stdin released, actual process exit0 |
| [Original Opus finding](evidence/opus-source-response.json) | FAIL retained: fresh stdin may remain active |
| [Correction review](evidence/opus-resolution-response.json) | PASS for bounded terminal correction; not independent test execution |

Mutation assertion counts **5,1,1,1,1,1**. The post-capture-discard mutation also
causes one later ERR_TEST_FAILURE, retained and excluded from semantic credit.
An earlier verifier found the final-clock test gap at
`.build/repository-history-cli-verification-6MvPHu`: removing the final abort check
survived the old tests. The added last-clock regression now detects that defect;
production was not weakened and the mutant was not removed.

## Use and reproduce privately

The existing command's safe help is:

```sh
node examples/repository-live-model.mjs --help
```

Add `--review-history` only to an otherwise valid, separately approved existing
private live-demo invocation in an interactive terminal. It does not select models,
approve generated code or authorize the new journal. This turn did not execute a
fresh live-model/Swift demo; do not invent a proven invocation for that lane.

```sh
node work-orders/repository-history-cli-v1/verify.mjs
node work-orders/repository-history-cli-v1/verify-terminal-history.mjs decline /Users/louiscalata/nisi-next-private/.build/repository-history-cli-verification-zl56OG/verification.json
node work-orders/repository-history-cli-v1/verify-terminal-history.mjs approve /Users/louiscalata/nisi-next-private/.build/repository-history-cli-verification-zl56OG/verification.json
```

For a fresh proof, use the first command's emitted receipt in the PTY commands.
The case argument selects the expected test outcome; it never supplies an answer
or bypasses the actual terminal adapter. Codex supplied the synthetic test answers
through owned PTYs, not as a real user's authenticated storage approval. Prompt
timeout30seconds in the proof, at most120seconds in the CLI; fresh reopen15seconds.
The proof checks the actual252 source hashes before/after, not just receipt bytes.

## Corrections, ownership and limits

Opus's initial design invented incompatible declaration fields, Date/ISO clocks
and a nonexistent owner close method. Codex retained the existing thirteen-field
declaration/opaque owner API and exact raw-answer rule. Prompt expiry is minted
after answering; declared14day retention explicitly has no automatic sweeper.

Luna supplied types and the CLI/PTY test drafts. Codex corrected types for
consumed repeat refusals, candidate-present narrowing and refusal journal handling.
Daybreak supplied the independent review/terminal tests and mutation verifier.
Codex corrected a test that tried to deep-freeze a live AbortSignal and then a
test that incorrectly expected that owned signal to remain un-aborted after cleanup.
A fabricated post-capture result was replaced with an actual stored result.
Opening-request construction now returns the specified frozen plain object.

Opus found the real fresh-stdin cleanup bug. Codex's new before/after regression
models readableFlowing:null separately from an already-flowing stream. Final code
releases its own input, preserves unrelated listeners and passes real PTY exits.
Three Claude calls report USD0.4503705 total, including Haiku auxiliary; broader
cost and savings are unknown. No held Fable/OpenCode/Windows-review route retried.

The initial verifier incorrectly assumed the previous242-pin set included the CLI.
It did not. Codex checked that fact, kept all242 previous pins unchanged and added
the CLI plus nine new files, yielding252—not a silently repaired prior identity.
The initial PTY draft hashed only receipt bytes; Codex added actual source-pin
validation, actual durability and fresh-child declaration-digest checks. A missing
brace introduced during that proof correction was caught by node --check and fixed
before any PTY launch. Neither verifier draft alone is acceptance evidence.

> [!WARNING]
> **Declining extra history does not delete existing run evidence.** This private
> demo already retains run artifacts. The prompt identifies the additional journal
> separately, so this new decision is not advertised as control over all stored data.

> [!CAUTION]
> **A terminal answer is not authenticated identity or incident-learning permission.**
> Hashes remain linkable, and14day retention is declarative without a sweeper.
> Trusted callback/stream implementations are not a hostile-code sandbox. A
> suppressed abort listener may be observed at the next native state check or
> deadline; no arbitrary callback or remote inference stop is claimed.

Next: integrate source-bound incident eligibility and lifecycle, then carry proven
operator controls into the macOS host under separate native/live-model acceptance.
All code/design/evidence remains private; no publication, package inclusion,
commit/push, new Swift/app launch, live-store change, auth or service change.
