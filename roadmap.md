# Nisi roadmap

> [!IMPORTANT]
> **Codex development paused; Louis authorized Claude to take over.**
> Overall progress remains **30% (3/10 accepted NX milestones)**. The existing
> Claude follow-up automation is PAUSED; the original Windows window is closed.
> Codex will not start new coding, packets, model calls or native launches.
> Claude may continue the authorized private development from the handoff below.
> [Exact pause handoff](work-orders/parallel-seven-tracks-v1/PAUSED-HANDOFF.md).

Native state as of 2026-09-14 08:35Z (Claude, co-author): the frozen Veritas app
target compiles in debug and release, and a Nisi-owned mirror package
(`native/macos/Nisi/`) builds a `Nisi`-branded executable and assembles an
unsigned `Nisi.app` (receipts under `docs/verification/2026-09-14/nisi-app-bundle/`).
Do not call this an accepted macOS build: no icon/asset catalog, no shipped-app
entitlements, no identity signing or notarization, nothing launched or installed,
and no connection between the app and the repository host (separately
authorized). The 225 frozen imported files verify before and after every build.


**Overall roadmap progress: 30% — 3 of 10 major NX milestones closed.**
This is an equal-weight milestone count, not an estimate of effort, time remaining,
model accuracy or release readiness. NX-01–03 are closed; NX-04–10 remain open.
The combined Swift/Node host has passed fixed-fixture acceptance; the paired
OFF/ON data reader is now accepted in its pure-data scope. Partial work is
described below but does not silently count as a closed milestone.
Include this progress measure in every future development update and recompute it
from the canonical NX checklist whenever a milestone is accepted or reopened.

## September 13 — operator-selected failure review in the private CLI

**Overall progress: 30% (3/10 NX milestones). This bounded slice: 6/6 complete.**
The private repository demo now accepts optional `--review-incidents`. It first
shows eligible failures, then separately displays one selected observation and
requires exact storage confirmation. This makes the accepted capture capability
usable from the terminal without enabling automatic collection or learning.

- [x] Add a two-step selection/confirmation interface: ten rows per page, a shared
  32-interaction/120-second limit, exact full identifiers and no implicit approval.
- [x] Bind the original preview across callbacks; preserve cancellation, one-shot
  permits and actual journal outcomes. Release returned handles even when their
  surrounding response is malformed. Keep admitted refusal distinct from no attempt.
- [x] Wire `--review-incidents` after host settlement, preserving default parser,
  receipt and summary behavior. Non-TTY requests refuse before setup. If both
  review flags are requested, history and incidents get separate decisions.
- [x] Add source-checkout TypeScript declarations and nine negative compiler
  controls, including opaque permits and status-based query/refusal narrowing.
- [x] Complete Opus final-source review (PASS, no findings), **31/31 focused**,
  **23/23 relocated control** and **1598/1598 portable checks**. All seven
  deliberate faults fail through assertions: **1, 1, 1, 2, 1, 1, 1** detections.
- [x] Exercise real terminal decline and exact SELECT/STORE approval with synthetic
  repository data. Decline never opens the journal; approval writes a new journal
  and a fresh Node process reads back the exact IDs, row fingerprint and preview
  digest. Both terminal runs release stdin and exit normally with code 0.

[Source acceptance](.build/repository-incident-review-verification-HXHnMK/verification.json)
binds **280 selected source/test/script files**, unchanged during verification
and both [decline](.build/repository-incident-review-v1-pty-cfEnP2/verification.json)
and [approval](.build/repository-incident-review-v1-pty-vIiobU/verification.json)
terminal proofs. Of the previous 267 pins, **266 remain exact**; only the intended
CLI integration changed, with 13 new files. This is not an all-tree audit or
native/live-model/product acceptance. No skipped, cancelled, todo or runtime-only
failure received acceptance credit. Existing journal/native formats and package
exports/allowlist are unchanged; the new types are for the private source checkout.

> [!WARNING]
> **A terminal answer is not authenticated identity or permission to learn.**
> The prompt, host, clock and filesystem remain trusted dependencies. The tests
> use explicitly supplied synthetic answers, not the user's approval to capture
> real data. A stored observation cannot upgrade a failed workflow or grant
> native execution, policy influence or publication permission.

> [!CAUTION]
> **Storage choices have separate boundaries.** Selection is not confirmation;
> this option does not change raw evidence already retained by the demo. Fourteen
> days is declared retention, not an automatic sweeper or secure-erasure promise.
> A consumed refusal/uncertain write is not safely retryable. Metadata is linkable.

Retained adverse evidence includes the original three oracle/fixture failures,
the transient preview-change regression, malformed success/journal regression,
and malformed-permit cleanup regression. Test assumptions were corrected without
weakening production gates. Draft verification scripts were corrected before use:
wrong type-file inventory, improper automatic PTY invocation, missing real after
hashing, and incomplete decline/child evidence. CLI fixtures now clean their own
exclusive temporary roots. [Detailed work order](work-orders/repository-incident-review-v1/roadmap.md).

Opus supplied design and two source reviews; Daybreak supplied independent review
tests and verifier drafts; Luna supplied types and the terminal-proof draft;
another Codex helper supplied CLI tests. Codex integrated and corrected the work.
The three Claude calls report **USD 0.8618215**, including auxiliary Haiku, not
all-model cost or measured savings. No new Fable/OpenCode/Windows-review attempt
was made on the held routes. Claude's separate restart-demo result is still
collaborator-reported, not integrated acceptance in this tree.

**Next:** define and verify a source-bound static-row selector and reviewed native
profile mapping, then build a separately versioned native reconstruction/rerun
bridge into the retained incident ledger. Node test failures must remain explicitly
unsupported by that first native bridge, not converted into invented Swift results.
Keep broader test-incident support, recovery, native hosting, evaluated prevention,
modular features and product acceptance in the full roadmap. NX-05 remains open.
No commit, push, publication, installation, authentication/service change or
native app/model launch occurred. The existing Windows window is not extended.

## September 13 — explicit failure-observation storage and fresh lifecycle queries

**Overall progress: 30% (3/10 NX milestones). This bounded slice: 7/7 complete.**
The real repository owner now exposes `createIncidentPermit`, `captureIncident`
and `revokeIncidentPermit`. A selected source-bound failure candidate can be
stored as a separately declared, metadata-only observation. A fresh query reopens
the actual journal and reports whether that observation is currently available,
revoked, expired, no longer retained, missing or refused. It is not automatic
learning, native incident admission or an authenticated operator interface.

- [x] Implement exact selected-row declarations and process-local permits;
  refuse cloned previews, nonfailure rows, wrong identities and invalid owners.
- [x] Wire the actual workflow owner while preserving run, proposal, prior
  history, imported native formats and package boundaries.
- [x] Enforce initial/final clock checks, callback re-entry protection, revocation
  and one admitted attempt per row. Preserve actual uncertainty after admission.
- [x] Reopen on every query; validate exact metadata fields and hashes, with
  revocation before expiry before retention pruning and no query writes.
- [x] Complete Opus source review (PASS, no findings), independent Daybreak/Luna
  test work and Codex boundary tests: **32/32 focused checks**.
- [x] Pass **1567/1567 portable checks**, **32/32 relocated controls** and seven
  semantic fault variants with assertion detections **1, 1, 1, 2, 8, 1, 1**.
  No runtime-only failure, skip, cancellation or todo received acceptance credit.
- [x] Perform a separately source-bound real-filesystem capture and fresh Node
  process query; verify exact entry/row IDs, row fingerprint and preview digest.

[Source acceptance](.build/repository-incident-capture-verification-IC2zRR/verification.json)
and [real-disk/fresh-process proof](.build/repository-incident-capture-v1-75xHwM/verification.json)
bind **267 selected source/test/script files**, unchanged in both runs. Of the
prior 260 pins, **258 remain exact**: only the projector's issuance registry and
actual host API deliberately changed, with seven new files added. This is not
an all-tree audit or installation/release acceptance. The existing journal owner,
journal formats, CLI storage prompt, package allowlist and exports are unchanged.

> [!WARNING]
> **A saved observation is not an approved learning input.** Its declaration and
> clock are trusted-host inputs, not authenticated identity. Hashes establish
> consistency, not truth, causal resolution, independent recurrence or native
> execution. Learning, authority and execution-attestation flags remain false.

> [!CAUTION]
> **STORED does not always mean new bytes were written.** Two empty journal owners
> proposing identical bytes can yield store UNCHANGED, owner RECORDED and capture
> STORED with durable:false. The exact underlying result is preserved. Duplicate
> results may use cached state; use the fresh query for current availability.
> An uncertain write consumes its attempt and cannot be automatically retried.

> [!CAUTION]
> **Single-writer storage is not a cross-process lock or secure erasure.** The
> existing disk comparisons around rename are optimistic. Concurrent/crash
> qualification, scheduled retention, authenticated host controls and native
> admission remain open. Querying expiry does not delete old disclosures or
> promise automatic secure deletion. Metadata hashes remain linkable.

Test/proof drafts needed corrections, all retained: identical bytes incorrectly
treated as a conflict; querying at exact expiry incorrectly expected availability;
clock rollback misclassified as not-yet-valid; a root test callback omitted its
return; relocated tests initially kept an invalid relative import/root. Production
validation was not relaxed. The first disk exercise also checked unrelated Windows
packet pins. It is not accepted as this feature's source proof; the replacement
requires the actual implementation inventory, rehashes all selected files and
cleans owned fixtures on failure. [Detailed work order and adverse evidence](work-orders/repository-incident-capture-v1/roadmap.md).

Opus provided design and source review; Daybreak supplied the capture oracle and
acceptance runner; Luna supplied query tests and the disk-proof draft; Codex
implemented, integrated and corrected test/proof assumptions. Two Claude calls
report **USD 0.5078615 including auxiliary Haiku**, not all-model cost or measured
savings. Held Fable/OpenCode/Windows-review routes were not blindly retried.
Claude's separate `bundle-restart-demo` session now reports its own terminal
result at 8:46 p.m. Pacific; that is not yet acceptance into this canonical tree.
Its work order was not edited or executed here.

**Next:** carry selected-observation controls into a reviewed operator interface
and additive source-checkout types, then implement a separately versioned native
bridge that reconstructs/reruns native evidence before ledger admission. Continue
native hosting and independently evaluated prevention. NX-05, the broader merger
and release gates remain open. Last Windows accounting remains20/24 terminal
requests, six candidates95/95 local checks and0/6 required independent reviews;
no new Windows dispatch or review-capacity claim was made in this slice.
No commit, push, installation, authentication change, native app/model launch or
publication occurred.

## September 13 — prior checkpoint: source-bound failure candidates in the real repository host

**Overall progress: 30% (3/10 NX milestones). This bounded slice: 5/5 complete.**
The actual repository host now exposes `incidentPreview()` after settlement.
It projects individual static checks and Node test-suite outcomes from the
original issued plans/executions and revalidated repository bundle. It does not
upgrade the existing aggregate history record into evidence it never contained.

| Observed situation | New preview behavior |
| --- | --- |
| Recorded deterministic FAIL with valid stage evidence | Failure candidate tied to the exact attempt, candidate, check and source digests |
| Raw FAIL within an unavailable static group | Operational observation; not a failure candidate |
| Result arrives after engine interruption | Interrupted observation, even when the raw result says PASS |
| Attempt 0 fails, attempt 1 passes, final run completes | Both retained; different row IDs, shared run/profile-family occurrence group |
| Same row identity but different bound report content | Different conflict fingerprint; no silent equivalence |
| Host still draining, quarantined, or projection fails | Explicit refusal; original report, proposal and history behavior remain unchanged |

- [x] Implement the versioned, metadata-only projector with original-issued
  source validation, fixed failure IDs, no raw source/paths/messages, and no
  truncation that could silently drop earlier failures.
- [x] Connect the capability to the real workflow owner; preserve existing
  history v1, report/bundle/proposal meanings and settled-owner requirements.
- [x] Verify **25/25** focused checks: 19 projection, five actual-host, one
  injected projector failure. The real host uses synthetic process/native
  observations in these tests; no native launch or model inference is claimed.
- [x] Complete Opus source review (**PASS**, no findings), independent Daybreak
  oracle/native-boundary analysis, Luna host fixture and root integration review.
- [x] Pass **1535/1535** portable checks, **19/19** relocated controls and all
  six semantic fault variants. Assertion detections: **2, 1, 1, 3, 2, 1**;
  no runtime-only, skipped or cancelled result counted as success.

[Final acceptance](.build/repository-incident-candidates-verification-9Hh64Z/verification.json)
binds **260 selected source/test/script files**, unchanged during verification.
Of the prior 252 pins, **251 remain exact**; the real repository host is the only
intentional prior-source change. Eight new files extend the selected inventory.
The frozen Veritas import, existing journal formats, CLI storage prompt, package
allowlist and exports are unchanged. This is not an all-tree or release audit.

> [!WARNING]
> **A failure candidate is not a proven cause or approved learning input.**
> Source-bound adapter statements remain unauthenticated. A passing repair does
> not prove causal resolution, and occurrence grouping does not prove independent
> recurrence. Every row explicitly keeps execution, learning and authority false.

> [!CAUTION]
> **This preview is transient, not native incident storage.** It has no storage
> permission, revocation/retention authority or current capture permit. Hashes are
> linkable and can be guessed for short values; they are not anonymization.
> The native v1 adapter requires its own exact source reconstruction and rerun;
> Node observations are not silently converted to native PipelineResult values.

The first test drafts assumed a skipped Node stage had an issued receipt, a
storage-failure fixture included a prior failed attempt, and a PASS-to-PASS edit
was a mutation. Those assumptions were corrected. Original-issued fixture rows
also needed the exact preparation and error field; mixed static failure fixtures
must stop dispatch after an operational error. No production validation was
relaxed. Root added cleanup, exact host FAIL→PASS assertions, unchanged capture
behavior, optional-projection fault isolation, and a content-conflict test.
The first mutant run [failed its own evidence gate](.build/repository-incident-candidates-verification-Zd4mTd/verification.json)
because one variant only threw a runtime refusal. Its replacement directly
emits the wrong classification; the oracle detects it semantically. Both records
remain retained. [Work-order details](work-orders/repository-incident-candidates-v1/roadmap.md).

Two bounded Claude calls report **USD 0.3487395** including auxiliary Haiku
usage; this is not total development cost or measured savings. Fable/OpenCode
and the held Windows reviewer route were not blindly retried. Claude's separate
restart-demo review was observed waiting on its own workflow at 8:34 p.m. Pacific;
that work order and session remain untouched. Windows accounting is unchanged:
20 terminal requests, six candidates passing 95 local checks, zero of six
required independent Windows reviews accepted; original window unchanged.

**Next:** explicit scoped persistence/admission of selected candidate observations,
fresh revocation/retention checks, and a separately versioned native bridge that
reconstructs and reruns native evidence before ledger admission. Continue native
host integration and evaluated prevention afterward. NX-05 remains open; the
full merger and all publication gates remain in force. No commit, push, model
service/authentication change, native app launch or publication occurred here.

## September 13 — prior checkpoint: operator-facing history review in the actual private CLI

**Overall progress: 30% (3/10 NX milestones). This bounded slice: 5/5 complete.**
The existing private repository demo now accepts optional `--review-history`.
It requests a separate interactive storage decision after host settlement; it is
not itself approval. Default runs retain their existing parser/summary/receipt
behavior, and history outcomes cannot upgrade the model or workflow verdict.

- [x] Wire review into the actual CLI, after settlement and before the unchanged
  live receipt. Refuse non-TTY review before fixture/model/compiler startup.
- [x] Display fixed metadata, exact digest, destination, retention limits and
  privacy warnings. Require exact `STORE <full digest>`; no trimming, automatic
  approval, implicit learning or reuse of model/execution consent.
- [x] Add source-checkout history types, including candidate absence and a repeat
  refusal that is already consumed but makes no new record attempt. Positive
  compiler control passes; seven intended negative errors are verified explicitly.
- [x] Pass **1510/1510** portable checks, up from 1472: 36 new review/terminal/CLI
  tests and two type checks. Relocated controls pass16/16 and15/15; six deliberate
  faults are caught by **5, 1, 1, 1, 1, 1** assertion failures. The fourth variant
  also causes one later fixture runtime error, recorded but not counted as detection.
- [x] Exercise the real terminal adapter in owned PTYs using synthetic workflow
  execution adapters. Decline creates no journal; exact approval writes/syncs one
  observation and reopens it in a fresh process with matching ID and digests.
  Both PTY processes actually exit0 without a forced-exit workaround.

All **252 selected source/test/type/script hashes** remained unchanged during
verification and both terminal proofs. All **242 prior pins** remain exact. The
prior set omitted the CLI example, so this slice adds its reviewed hash alongside
nine new files; it does not invent a previously pinned CLI revision or an all-tree
audit. [Final acceptance](.build/repository-history-cli-verification-zl56OG/verification.json),
[decline proof](.build/repository-history-cli-v1-pty-HbnOjJ/verification.json),
[approve/reopen proof](.build/repository-history-cli-v1-pty-6Fz27d/verification.json),
and [work order](work-orders/repository-history-cli-v1/roadmap.md).

> [!WARNING]
> **A real terminal cleanup defect was found and fixed.** Fresh stdin can have
> `readableFlowing:null` while `isPaused()` is false. The first implementation could
> leave its own input handle active after showing the result. Opus found this;
> a new regression fails before the fix and passes after it. Nisi now releases
> input it started, while preserving an already-flowing stream and unrelated listeners.

> [!CAUTION]
> **The extra history choice does not undo existing evidence retention.** This
> private demo already retains its run evidence. The new prompt explicitly says
> that its decision governs only the additional metadata journal. Fourteen days
> is declared retention, with no automatic sweeper or secure-erasure guarantee;
> hashes remain linkable. Terminal confirmation is not authenticated identity.

Cancelled, expired, declined and malformed decisions do not open the additional
journal. After capture begins, the exact capture outcome remains visible even if
cancellation arrives; a capture-call attempt is not automatically a record attempt.
Learning, source/execution attestation and authorization remain false.

Opus5 coauthored the design, reviewed full selected source and confirmed the
bounded terminal fix. Daybreak supplied independent oracles/verifier; Luna supplied
types, CLI-wiring tests and the PTY proof draft. Codex implemented/integrated,
corrected schema/type/test/proof gaps and ran acceptance. Three Claude calls report
**USD0.4503705 combined**, including Haiku auxiliary—not total development cost
or measured token/time savings. Held Fable/OpenCode/Windows-review routes were
not blindly retried. Claude's separate working copy remains untouched.

**Next:** source-bound incident eligibility and history lifecycle integration;
then carry the proven operator controls into the macOS host and run separately
approved native/live-model acceptance. The actual CLI wiring was tested with
relocated trusted dependencies, and its terminal/storage path with real PTYs;
this was not a fresh end-to-end model/Swift run or authenticated native approval.
New modules/types remain outside the staged-package allowlist. NX-05 stays open.

Windows stays20/24 terminal requests,95/95 local module checks,0/6 required
independent reviews accepted, no outstanding job. Original9:48/9:58p.m. Pacific
cutoff/end are unchanged; no duplicate work was issued. All work remains private;
no publication, commit/push, new Swift/app launch, live-store operation, install,
model-service, authentication or security change occurred.

## September 13 — prior checkpoint: actual repository workflow connected to private history

**Overall progress: 30% (3/10 NX milestones). This bounded slice: 5/5 complete.**
The actual reviewed repository host now exposes `historyPreview()` and explicit
`captureHistory(...)` after settlement. Existing report, proposal, state and run
methods keep their prior semantics. This is source-checkout integration, not an
automatic collector, native application acceptance or NX-05 closure.

- [x] Add metadata-only preview to the real workflow owner; keep internal
  publication off the public host API and refuse capture while drains are pending.
- [x] Require an exact separate storage declaration, matching preview digest,
  valid owner and two clock checks. Claim busy before callbacks and consume the
  single attempt before entering storage, including refused or failed writes.
- [x] Keep absent candidates explicit, hash diagnostic strings and preserve
  quarantined operational outcomes without labeling them as model failures.
- [x] Pass **1472/1472** portable checks, up from 1442; **30/30** focused tests
  and relocated control. Eight deliberate defects produce **1, 1, 1, 1, 2, 1, 1, 1**
  assertion failures, with no runtime-only failures counted as detection.
- [x] Write two synthetic histories to a real private filesystem journal, sync
  file/directory and reopen both in fresh Node processes. Verify candidate absence,
  quarantined candidate presence, exact IDs/digests and no extra write on retry.

All **242 selected source/test/type/script hashes** stayed unchanged during
acceptance. Of the prior 240 pins, **239 remain exact**; only the deliberate
repository-host wiring changed, with the new helper and oracle added. The current
journal owner and existing journal/store formats are unchanged. Five separate
dependency-substitution regression checks also pass; they are **not added to the
1472 product-test count**. [Source acceptance](.build/repository-host-history-verification-HzMJM7/verification.json),
[real-disk proof](.build/repository-host-history-verification-real-MYiulo/verification.json),
and [bounded work order](work-orders/repository-host-history-v1/roadmap.md).

> [!WARNING]
> **A storage attempt can have an uncertain outcome.** Opus flagged an ambiguous
> `REFUSED` classification after an unexpected record dependency failure. The old
> contract explicitly allowed it; we revised both contract and implementation to
> return `UNCERTAIN / INTERNAL_ERROR`, with the attempt consumed and no malformed
> dependency result echoed. Five tests fail on the old source and pass after the
> fix. This does not assert that a real journal write was lost or rolled back.

> [!CAUTION]
> **A preview and written declaration are not authenticated consent or learning.**
> Hashes bind metadata; they do not anonymize it or attest source/execution honesty.
> This trusted-host integration keeps all attestation, learning and authorization
> flags false. No raw content is captured and no new Swift/app launch occurred here.
> UI approval collection, types/package exposure, native acceptance and versioned
> incident admission remain separate tasks.

Opus 5 coauthored the contract, reviewed the initial exact source and reviewed the
bounded correction; the original FAIL is retained beside its resolved PASS.
Daybreak supplied the independent oracle, mutation verifier and fault-regression
draft; Luna supplied the real-filesystem proof draft. Codex implemented/integrated,
corrected test/verifier details and ran all final checks. Three Claude calls report
**USD 0.570267 combined**, including Haiku auxiliary usage—not total development
cost, a coding benchmark or measured token savings. Fable/OpenCode held routes
were not retried, and Claude's separate working copy remains untouched.

**Next:** carry this exact optional history API into a bounded host-facing approval
flow and additive types; preserve observed outcomes independently of success claims.
Run separately approved native acceptance, then specify incident eligibility and
evaluated prevention. A stored operational record does not itself close NX-05.

The Windows window remains **20/24 terminal requests**, six test-ready modules,
**95/95** local checks and **0/6** required independent reviews accepted. The
read-only queue audit found no new review-recovery evidence and no outstanding job.
Its six modules plus four concrete test extensions finished early; there is no
useful prepared packet left to dispatch solely to fill the remaining time. Original
cutoff/end stay **9:48 / 9:58 p.m. Pacific September 13**. No continuous six-hour
computation, independent Windows acceptance or automatic integration is claimed.

Everything remains private. No commit/push, publication, new Swift/app launch, live-store
write, install, authentication, model-service or security change occurred.

## September 13 — prior checkpoint: explicit durable history maintenance and revocation verified

**Overall progress: 30% (3/10 NX milestones). This bounded slice: 5/5 complete.**
Canonical `npm run check`: **1442/1442**, up from 1408; zero failures, skips,
cancellations or todos. All **240 selected source/test/type/script files** stayed
unchanged during verification. Four previously pinned owner/type/fixture files
changed deliberately; the other **233 prior pins** remain exact. Three new test/
type files complete the selected set. This is not an all-tree or release audit.
[Exact acceptance receipt](.build/journal-maintenance-verification-qbLBtS/verification.json).

- [x] Add `maintainJournalOwner({owner, now})` to the current private owner, using
  the same registry and busy guard as observation recording. Preserve all existing
  record/open/inspect API behavior and the unchanged journal/store file formats.
- [x] Share prepare/write/validate/publish logic. Persist open-time private pruning;
  verify actual disk before UNCHANGED; preserve prior state on precommit failure;
  quarantine an uncertain committed write. Report non-durable success honestly.
- [x] Preserve every accepted ID, serialized fingerprint and revocation relation
  when TTL or capacity removes payloads. Revocation changes liveness; it does not
  immediately erase its target's payload or authenticate a user decision.
- [x] Pass 32 lifecycle groups and two additive type checks. Original stub:
  2/32 pass, 30 fail. The final canonical and relocated controls each pass 32/32.
  Six deliberately broken variants produce **11, 1, 2, 5, 1, 2 semantic assertion
  failures**; the first also causes two fixture runtime errors, separately recorded
  and excluded from defect-detection credit. No predicted failure count is evidence.
- [x] Write/sync/read back a synthetic target and revocation on the real filesystem.
  Reopen in fresh Node processes before and after target TTL expiry; verify exact
  IDs, revocation links and unchanged bytes after duplicate/conflicting replay.
  A post-rename readback fault quarantines the old owner; a fresh owner reconciles.
  [Actual filesystem receipt](.build/journal-maintenance-real-BTcSPr/verification.json).

> [!WARNING]
> **Payload removal is not secure erasure or authenticated revocation.** This
> changes current journal bytes in an explicitly invoked operation. Previously
> returned immutable snapshots, backups and storage remnants are not wiped. Only
> owned synthetic fixtures were exercised; no live history was altered.

> [!CAUTION]
> **Maintenance is not automatically scheduled or safe against hostile writers.**
> The current synchronous trusted filesystem detects cooperative disk drift; it is
> not a cross-process lock or atomic compare-and-swap guarantee. Non-durable fsync
> outcomes stay non-durable, and uncertain owners refuse more writes until reopened.
> Tombstone identities remain, so payload-count retention does not bound total
> metadata growth. UI approval, retention scheduling and crash qualification remain open.

Opus 5 coauthored the contract and reviewed exact owner SHA `b64e21ae…` with no
findings; Daybreak supplied the oracle/verifier draft and independently reviewed
the corrected real-disk proof. Luna supplied types. Codex implemented/integrated,
corrected fingerprint/type/verifier gaps and ran final acceptance. The two Claude
calls report **USD 0.3692925 combined**, including Haiku auxiliary usage—not total
development cost or measured savings. Fable/OpenCode held routes were not retried.
[Bounded work order and corrections](work-orders/journal-maintenance-v1/roadmap.md).

**Next:** reviewed host/UI collection of separate source/storage declarations;
explicit retention-policy invocation; then version native incident admission.
The current caller audit found **no non-test caller of the legacy history bundle**:
do not invent a live migration or silently alias its exposed state to the opaque
v2 owner. The reviewed repository workflow still lacks a history connection;
design one explicit optional host integration instead of another unused wrapper.
Any compatibility adapter needs its own contract and must preserve Claude's work. Automatic
learning, native incident eligibility, staged-package inclusion and NX-05 closure
are not established by this history lifecycle check.

Windows remains **20/24 requests**, six candidate modules with **95/95** local
checks, **0/6** required independent Windows reviews accepted, and no outstanding
job. Its original new-work cutoff is 9:48 p.m. Pacific and coordination ends
9:58 p.m. Pacific September 13. No new dispatch or blind timeout retry occurred.
Everything remains private: no native launch, commit/push, publication, live-store
cleanup, installs, authentication, model-service or security changes.

## September 13 — prior checkpoint: selected disk source connected to one-use history admission

**Overall progress: 30% (3/10 NX milestones). This bounded slice: 5/5 complete.**
Canonical `npm run check`: **1408/1408**, up from 1368; zero failures, skips,
cancellations or todos. All **237 selected source/test/type/script files** stayed
unchanged during acceptance; all 234 previous pins matched before execution.
Source-checkout acceptance only; no native app, package or release acceptance.
[Exact acceptance receipt](.build/disk-history-import-verification-cTQCH7/verification.json).

- [x] Add `hosts/history/import-fixed-xpc-from-disk-v1.mjs`, reusing the current
  disk reader and history permit without changing either. Require an explicit
  one-file source selection and a separate written storage declaration.
- [x] Copy and validate scope before clock/I/O; bind selection and declaration
  digests. Read only that selected path and retain bounded fingerprints/byte counts,
  not its path or raw source in the returned history result.
- [x] Preserve real cancellation, cleanup errors and admitted write outcomes.
  A cancelled read still waits for reader cleanup; a late abort cannot hide an
  already-attempted journal write. No retry or caller-visible reusable permit.
- [x] Pass 40 independent test groups. The initial stub failed all 32 original
  groups; eight boundary groups cover native AbortSignal overrides, suppressed
  events, source spelling, expiry, close failure and contradictory reader output.
  Six deliberate single-site faults are caught with 1, 1, 2, 1, 3, 1 failing assertions.
  The relocated unmodified control passes 40/40; import/hash failures do not count
  as mutation detection. [Test accounting](work-orders/disk-history-import-v1/evidence/adjudication.md).
- [x] Read **3/3 already-retained fixed-XPC records through this new host API**,
  write/fsync/read back a new private observation journal and reopen all three
  exact IDs/source/declaration digests in a fresh Node process. Original inputs
  and 237 selected sources stayed unchanged. No new native execution occurred.
  [Actual filesystem receipt](.build/disk-history-retained-2QE4qV/verification.json).

> [!WARNING]
> **A selected path and written declaration do not authenticate consent or source.**
> This is a trusted-host, operator-trusted-static-file boundary, not a hostile
> filesystem sandbox, verified local-mount detector or protected approval screen.
> All authenticity/execution-attestation flags remain false. A source hash binds
> bytes; it does not establish who created or approved them.

> [!CAUTION]
> **Cancellation has no hard disk-I/O deadline or undo guarantee.** The wrapper
> waits for the same read to finish its cleanup. It retains `sourceFailure` even
> if cancellation wins, especially `DISK_CAPTURE_CLOSE_UNCONFIRMED`. After record
> admission it returns the actual stored/conflict/failed/uncertain result. It does
> not retract stored rows, physically erase expired data or feed failure learning.

Opus 5 critiqued the contract and reviewed the exact final e0982d12… source with
no findings. Daybreak authored 40 test groups and the verification-script draft;
Luna checked compatibility. Codex implemented/integrated, corrected the synthetic
event-test ordering and stale test pin after reviewing the final test, added the
relocated control/assertion-only mutation checks, and ran acceptance/real-store
verification. Fable's retained same-task credit failure was not retried.

**Next safe implementation:** a reviewed host/UI path for collecting separate
source and storage declarations; stored-row revocation/retention; explicit migration
of old v1 callers; and a versioned native incident bridge. These remain open.
Do not reuse Apple-model consent for storage, claim authenticated consent, or
coerce operational/provider observations into the deterministic-only native incident
ledger. New host code remains outside the staged-package allowlist.

**Windows six-hour queue:** 20/24 requests, six test-ready modules, 95/95 retained
checks, 0/6 independent acceptances and no outstanding task. A fresh read-only audit
matched all six source hashes and terminal IDs; 19/20 retained responses are raw
byte-exact copies, with the original catalog fetch error explicitly owner-annotated.
The queue labels and checklist were corrected; no worker retries or limit changes.
Original cutoff remains **9:48 p.m. Pacific for new submissions**, with the
coordination window ending **9:58 p.m. Pacific September 13 (04:58Z September 14)**.
Prepared work finished early; six hours of continuous computation is not claimed.
[Six-hour work queue](work-orders/windows-future-20260913/roadmap.md).

Everything remains private. No native launch, commit/push, publication, installs,
signing, authentication, model-service or security changes.

## September 13 — prior checkpoint: one-use, source-bound history admission integrated

**Overall progress: 30% (3/10 NX milestones). This bounded slice: 5/5 complete.**
Canonical `npm run check`: **1368/1368**, up from 1331; zero failures, skips,
cancellations or todos. All **234 selected source/test/type/script files** stayed
unchanged during acceptance; the previous 231 pins also matched before execution.
This is source-checkout acceptance, not package, native app or release acceptance.
[Verification and seven mutation results](.build/history-capture-verification-LWb99c/verification.json).

- [x] Define a separate written history-persistence declaration. Do not reuse
  Apple-model content consent, which expressly forbids persistence.
- [x] Implement `history/history-capture-permit-v1.mjs`: privately bind an opaque
  one-use permit to the actual owner, exact source SHA-256, project/candidate/receipt,
  declaration digest, expiry and retention interval. Validate before admission;
  check the trusted clock again immediately before calling the owner.
- [x] Consume the permit on every actual record attempt, including duplicate,
  conflict or failure. Preserve adverse observations, redaction and uncertain-write
  outcomes. No automatic retries, native incident writes or learning influence.
- [x] Pass 37 independent test groups and catch seven deliberate regressions.
  Initial stub: 0/31. The deeper six-test review exposed one revoke-then-throw
  reporting defect (5/6); fix and regression are retained. Final: 37/37.
- [x] Store one **synthetic** fixed-XPC observation on the actual private filesystem,
  verify file/directory fsync and readback, then reopen in a new Node process with
  exact source/declaration digests. No new native execution occurred. Post-capture
  revocation blocks reuse; source-only poison is absent from stored bytes.
  [Real-store test receipt](.build/history-permit-real-store-9GFtBT/verification.json).

> [!WARNING]
> **A written declaration is not authenticated consent.** This permit records a
> trusted host assertion; it does not prove who approved it or where source bytes
> originated. All consent/source/execution attestation flags remain false. The
> earlier Apple-model grant cannot authorize this storage, and neither this permit
> nor an access-policy digest may be advertised as protected user approval.

> [!CAUTION]
> **Revocation stops future admissions, not an already-admitted write.** The actual
> write result must still be returned. TTL is logical journal retention, not a
> background erasure service. Native consent capture, stored-row revocation and
> retention sweeps remain open; tests do not erase those requirements.

Opus 5 critiqued the contract and reviewed the pre-fix source. Daybreak authored
31+6 tests, found the additional reporting defect and reviewed the final SHA.
Codex implemented/adjudicated/integrated and ran acceptance; Luna checked API
compatibility and concurrent-work status. Claude's earlier PASS is NOT relabeled
as review of the later fix. [Exact accounting](work-orders/history-capture-permit-v1/evidence/adjudication.md).

**Next work, still on the full merger:** acquire history declarations through a
reviewed host/UI boundary; capture source files with separately approved scope and
identity checks; explicitly migrate old v1 callers; implement stored-row revocation/
retention; then design the versioned native incident bridge. Retained native
`PipelineIncidentAdapterV1` requires deterministic assist/needsAttention failures
with model participation NOT_RUN. Do not disguise model/provider or fixed-XPC
operational errors as that branch or bypass its internal ledger write admission.

Windows remains **20/24 requests**, **95/95 tests**, **0/6 independent module
acceptances**, no outstanding jobs; the two timed-out GPT-OSS reviews remain held.
Six source hashes were freshly checked, and queue accounting agrees. No new
dispatch/retry/model reload; the original window still ends September 13 at
9:58pm Pacific (September 14 04:58Z). Prepared work finished early; continuous
six-hour computation is not claimed. The separate Claude working-copy session
has no newer end-turn than 23:07:55Z. Private-only; no publication, commit/push,
native launch, signing, installs or authentication/security changes.

## September 13 — prior checkpoint: journal-owner v2 and first observation importer integrated

**Overall progress: 30% (3/10 NX milestones). This integration slice: 5/5 complete.**
The exact canonical `npm run check` now passes **1331/1331**, up from 1257/1257:
56 relocated owner checks + 16 observation-import checks + 2 type-contract checks.
No failures, skips, cancellations or todos. All **231 selected source/test/type/
script files** stayed unchanged during the run; all 218 previous pins and both
old v1 host copies still match. This is a defined file selection, not an all-tree audit.
See [canonical acceptance](.build/journal-owner-integration-tnBa5H/verification.json).

- [x] Preserve one writer per target; recheck Claude's separate working copy and
  the 14 reviewed successor pins before relocation.
- [x] Add the exact reviewed source as `history/journal-owner-v2.mjs`, preserving
  existing disk formats and leaving the old host API unchanged.
- [x] Add the source-checkout TypeScript contract and actual Node filesystem
  compatibility fixture. Eight intended misuse sites yield nine exact diagnostics;
  rejected store responses cannot be treated as validated results.
- [x] Wire `history/import-fixed-xpc-observation-v1.mjs` to the current projector
  and opaque owner, with explicit conflict, refusal, duplicate and uncertainty
  handling. Sixteen regression groups pass; four deliberately broken variants
  are caught. Never echo pre-journal payloads that bypass host redaction.
- [x] Import **3/3 already-retained** fixed-XPC records into an owned private history
  file and reopen their exact IDs. Actual file/directory fsync and readback succeeded
  on this host. No new native launch occurred and original records are unchanged.
  [Retained-record receipt](.build/retained-xpc-history-5MIIv9/verification.json).

> [!WARNING]
> **OpenCode did not complete this copy.** Its local Qwen route read the approved
> files but timed out after 900.021 seconds with zero edits. Confirmed child/group
> termination allowed Codex to perform the exact mechanical copy afterward. The
> blocked packet and timeout evidence remain separate from owner acceptance; no
> OpenCode success receipt was fabricated and the stalled route was not retried.

Opus 5 critiqued the consumer contract and reviewed its source; Daybreak drafted the
type contract and consumer tests. Codex adjudicated the redaction/test-shape issues,
implemented the importer, completed the relocation and ran final verification.
Windows Qwen's four previous integration tests are now included in the canonical
suite. Detailed provenance and corrections:
[integration accounting](work-orders/journal-owner-v2/evidence/integration-accounting.md).

> [!CAUTION]
> **Stored observations are not accepted incidents or task success.** `IMPORTED`
> means an observation was recorded; its source can still be `FAILED`. The new API
> is not yet called automatically by the native runner/UI, does not migrate old
> v1 callers, and is not in the private staged-package allowlist. Those are explicit
> follow-up gates, not implied by passing portable tests or this successful import.

Next: define the consent/source-bound host history adapter and trusted incident
admission; verify redaction, retention and revocation before automatic learning.
Keep native application acceptance, cross-process ownership, matched value evaluation,
and exact legal/release gates open. No publication, commit/push, signing, installs,
security/authentication changes or manual model/service reconfiguration occurred.
The Windows queue remains 20/24 requests, 95/95 original checks, 0/6 independent
module acceptances and no outstanding jobs; its original six-hour cutoff is unchanged.
The final queue audit corrected a stale18-request top-level counter to match the20
actual job IDs and summary. A readonly accounting check now enforces both counters
and the existing24-request cap. All30 Windows protected pins and six source hashes
remain unchanged; no extra job was submitted.

## September 13 — prior checkpoint: journal-owner successor verified privately; Windows extension completed

**Overall progress remains 30% (3/10 NX milestones).** The isolated
[journal-owner v2 correction](work-orders/journal-owner-v2/roadmap.md) now passes
**56/56** checks with no skips/failures/cancellations/todos. All nine deliberate
source variants were caught. Its six-item correction/handoff checklist is 100%,
but product integration and NX-05 completion are not claimed.

The successor uses opaque handles and immutable snapshots, preserves the raw-disk
predecessor hash independently of pruned memory, rejects foreign damaged prefixes
and invalid UTF-8, and seals uncertain writes before exposing a result. It corrects
the four retained fault paths in the new API, **not in the unchanged v1 bundle**.
See [the explicit integration handoff](work-orders/journal-owner-v2/INTEGRATION-HANDOFF.md)
and [source-bound verification](work-orders/journal-owner-v2/evidence/owner-verification.json).

Opus critiqued the contract and drafted open/inspect/helpers; Codex adjudicated the
contract and implemented the write path. Daybreak authored the independent owner
and error-boundary checks and reviewed the exact source. SharedChami Qwen drafted
four additional current-XPC integration tests; owner correction took its revision
from 0/4 to 4/4 without weakening expectations. They use actual canonical parser/
projector code with synthetic data, not fresh native execution.

The Windows six-hour queue has now used **20/24 bounded requests**, with no jobs
outstanding. The original six modules remain **95/95 test-ready, 0/6 independently
accepted**; the new four tests live in the separate owner work order and are not
part of that 95 total. The timeout audit found no cause supporting another GPT-OSS
retry, so its review hold remains. Original cutoff/end times and quiet coordination
continue; continuous six-hour remote computation is not claimed.

All **218 selected canonical files** and both v1 host copies were rechecked unchanged.
The latest retained product suite remains **1257/1257** from the prior run, not a
new run or a total including this isolated successor. No canonical source edits,
native launch, permission/model/service change, commit, push or publication occurred.

## September 13 — current XPC observation format integrated; Windows queue continues

**Overall progress remains 30% (3/10).** The latest source-bound `npm run check`
passed **1257/1257**, with no failures, skipped, cancelled or todo tests. All
**218 selected source/test/type/script files** were unchanged during that run;
the 213 files pinned immediately before this integration also remain unchanged.
This is a defined file selection, not an all-repository integrity claim.
See the [post-integration receipt](.build/xpc-history-projection-h918xQ/product-post-integration.json).

The [fixed XPC journal observation work order](work-orders/fixed-xpc-journal-observation/roadmap.md)
adds a pure projector for the current runner's actual serialized format. It
checks bounded input, stream digests, protocol rows, case outcomes and supplied
postconditions before emitting a non-authorizing observation. It does not launch
the runner, persist data, independently attest evidence or wire the host store.
An expected negative test case can be observed successfully without implying
that a user task or generated code succeeded.

The scoped implementation passed **27/27** checks, all **six targeted mutant
variants** were caught, and three retained runner records projected successfully
without fresh native execution. Opus 5 critiqued the contract; Daybreak authored
and reviewed bounded checks; OpenCode performed the five-file relocation; Luna
independently checked exact bytes. OpenCode omitted five final LF bytes, which
were corrected before acceptance. The immediate product baseline was 1230/1230;
the new five files add 27 checks. Earlier 1170 counts below are historical.

> [!WARNING]
> **The four host-journal findings remain open despite an existing integration record.**
> Both current copies still have SHA-256
> `97b2554b7fe50812fcb0065197964967d2beefc0c8cb322a38154ec16ebb9894`.
> The new observation projector does not repair committed-refusal stale state,
> cross-project damaged-prefix exposure, lossy UTF-8 decoding or caller-mutable
> journal/CAS authority. Claude retains that correction lane.
>
> **Why this matters:** a green general suite cannot overrule source-bound
> counterexamples. Acceptance of those affected host behaviors remains provisional.

The [Windows six-hour queue](work-orders/windows-future-20260913/roadmap.md) remains
separate, private future-module work with its own test/review progress. Its
`queue.json` owns live status, exact outstanding IDs and dispatch limits. A small
GPT-OSS health response was not a full review: the later 180-second review timed
out. The single complete smaller-source review also timed out after 180 seconds;
that exception is exhausted and the lane stays held. Independent Qwen work continues
on three useful boundary-test packets. No model reload, cloud fallback or automatic
acceptance is implied. No publication or native/authentication action occurred.

**Windows checkpoint:** all six isolated modules are test-ready with **95/95**
source-bound local checks; **0/6** are independently accepted. All 30 original
protected packet/request/package/test pins match. A provenance audit corrected
five receipts: four implementations are Qwen-informed owner refactors rather
than exact extracted copies; the status-card implementation was restored to its
actual worker source. Earlier source and receipt variants remain retained.
See [the batch provenance audit](work-orders/windows-future-20260913/evidence/provenance-audit.md).
Usage, history and catalog boundary-test packets added 14 passing tests and caught
three deliberate isolated defects. The planned drafting/test work finished early;
no remote request is outstanding. The six-hour coordinator still owns the review
hold and cutoff; continuous busy time is not claimed. These tests do not substitute
for independent code review or full product integration.

## September 13 — private parallel recovery and six-hour Windows queue

**Overall progress remains 30% (3/10).** Codex's fresh `npm run check` passed
**1170/1170** with all **395 captured source/test files unchanged during that
run**. See the [source-bound check receipt](.build/parallel-recovery-review-AwybUV/root-check-verified.json).
The disjoint [restart-recovery work order](work-orders/journal-restart-recovery/roadmap.md)
now passes **17/17** checks: ten fresh-process cases, two baselines and five
owner boundary checks. Opus drafted the adapter; Codex corrected two command
validation failures. This is lower-layer acceptance, not NX-05/host integration.

The [six-hour Windows work queue](work-orders/windows-future-20260913/roadmap.md)
contains six future presentation/accounting modules with 65 protected acceptance
tests and 12 baselines. Window: **September 13, 3:58–9:58 p.m. Pacific**;
new dispatches stop at 9:48 p.m. It uses the registered Qwen/GPT-OSS chat worker,
not an assumed remote OpenCode executor. Drafting/review happens on Windows;
source installation and tests remain isolated and owner-reviewed on Mac.
Exact active IDs/status live in its queue.json. Nothing is integrated or published
by that unattended queue, and it stops early if useful bounded work is exhausted.

> [!WARNING]
> **Four source-bound host-journal findings remain open for Claude's owner lane.**
> Synthetic reproductions show stale memory/hash after a committed refusal,
> cross-project damaged-prefix exposure, lossy UTF-8 recovery and caller-mutable
> CAS authority. See the [correction handoff](.build/parallel-recovery-review-AwybUV/CLAUDE-HOST-CORRECTIONS.md).
>
> **Why this matters:** passing the portable suite or isolated recovery tests
> does not make the unfinished host bundle safe to integrate. Codex did not edit
> Claude's live source. Recheck the handoff's exact hash against any successor.

The existing Claude watcher also coordinates the Windows queue, with disjoint
write ownership and no duplicate scheduler. The worker lacks cancellation/TTL;
an unresolved ID is retained, not silently retried or declared stopped.

**September 13 — five accepted work orders integrated as partial U02-02/03/04
checkpoints.** Louis authorized Astra as the sole product writer (~12:00 PDT,
"Go for it", in the Claude session). The formatter, canary adjudicator, vocabulary
adapter, native-chat declarations and pure run journal now have product paths.
The dated work-order acceptance/integration records supersede the unfinished
formatter status from the earlier attempt below. The product milestone count
is unchanged; Claude Fable 5.1's post-integration review remains pending.
See [integration evidence](docs/verification/2026-09-13/five-work-order-integration/receipt.json)
and the scoped U02 checkpoints below.

**Executed September 13: [OpenCode native-summary packet](work-orders/native-probe-summary/.packets/nisi-native-probe-summary.packet.md)
— BLOCKED: the selected local model returned `Model is unloaded.`** One exact
wrapper attempt finished in 17.942 seconds with exit 1. The local route's model
listing was reachable, but that did not establish inference readiness. The actual
session reports `lmstudio/qwen/qwen3.8-27b`, an error, and no completed inference
or code-editing tool call. Zero-filled usage fields are not a complete usage claim.

The formatter remains the exact empty-string placeholder. Independent reruns
confirm **baseline 2/2 PASS; formatter 0/13 PASS (13 expected unfinished failures)**,
with no skipped/cancelled tests. During the wrapper attempt, tests, package and
workspace roadmap stayed unchanged; only packet status/terminal whitespace and
the new receipt changed. All 141 previously pinned canonical sources still match.
Codex subsequently updates only owner status documentation. There was no retry,
provider switch, model loading/replacement, runtime integration or publication.
2026-09-13 follow-up: The formatter was later completed (13/13 PASS; SHA256 `c048df362405ffbd3053de93aedd05a0b51ec5c64417d19c9ee5ea22a6d90056`) and integrated at `hosts/macos-xpc/native-probe-summary.mjs`.

This is plain-text status presentation, not native execution, receipt validation,
service settlement or the complete UI. The earlier timed-out attempt and Fable
5.1 source-free display review are preserved. Luna independently audited this
failed attempt; no fresh Claude invocation was needed for the unchanged placeholder.
See the [wrapper receipt](work-orders/native-probe-summary/.packets/nisi-native-probe-summary.result.md)
and [owner verification](.build/native-summary-execution-Y8FVUs/verification.json).

- [x] Prepare explicit source scope, protected assertions and private-release limits.
- [x] Validate the packet's green baseline and discriminating unfinished-work checks.
- [x] Execute one requested local attempt and retain its BLOCKED receipt and empty source diff.
- [ ] Resolve local model availability, then obtain direction before another attempt.
- [x] Review implementation and protected hashes before separate product integration.
  September 13: accepted formatter integrated at `hosts/macos-xpc/native-probe-summary.mjs`;
  13/13 relocated formatter tests pass with unchanged assertions.
- [x] Mirror this handoff and failed execution in the existing `SYSTEM-EQUATION.md`.

> [!CAUTION]
> **Reachable model listings do not prove a loaded, usable model.** Preparation
> used verified cached guidance while SharedChami was unavailable; the reference
> share was readable again for execution. The local model endpoint also listed
> Qwen, but the actual request failed because the model was unloaded.
>
> **Why this matters:** route readiness cannot be counted as successful inference
> or implementation. No automatic remount, model change, Windows dispatch,
> authentication/trust change or remote-provider fallback was performed.

**Latest private checkpoint: FIXED PRIVATE XPC PROTOTYPE — 2/2 fresh app/service
experiments; 972/972 portable tests rerun and passing.** The containing app and
embedded service build and communicate on this Mac with exactly App Sandbox-only
entitlements. Each returned the expected fixed 15-operation record. The client,
launcher and service-observed caller PIDs match; the service PID is self-reported.
This prototype remains in private `.build` evidence, not the integrated app or
an isolated generated-code executor. All 134 canonical source pins and 225 imported
files remain unchanged. See the [private XPC checkpoint](#september-12-private-xpc-prototype--two-fresh-native-experiments).

**Previous private checkpoint: REPEATABLE FIXED NATIVE PROBE — 2/2 fresh experiments;
972/972 portable tests passing. Full generated-code isolation remains NOT ACCEPTED.**
The new private runner, fixed native source and closed parser are now in the
canonical tree. Each fresh run binds its source/dependencies, signed artifacts,
unique container, same-target control and launcher-observed PID. Both sandbox
runs permitted socket creation, denied IPv4 loopback binding with `EPERM`, and
closed the socket. Neither executed a generated task candidate. All 130 previous
source pins and 225 imported files remain unchanged; four new files extend the
current checkpoint to 134 source pins. See the
[repeatable native checkpoint](#september-12-repeatable-fixed-native-probe--two-fresh-runs).

**Previous private checkpoint: FIXED APP SANDBOX PROBE OBSERVED; 951/951 portable
tests rerun and passing. Overall generated-code isolation is still NOT ACCEPTED.**
A separate fixed Objective-C app was compiled, locally ad-hoc signed and launched
on this Apple-silicon Mac. With only the App Sandbox entitlement, it could read
and write its own fixture file, while the selected outside-file read/create and
IPv4 loopback socket/bind probe returned permission denials. The unsandboxed comparison allowed
those operation classes. The fixed `/usr/bin/true` child was allowed in both.
This is a narrow native experiment, not an isolated Node executor, private XPC
service, native product acceptance or permission to run generated candidates.
All 130 canonical source pins and 225 imported Veritas files remain unchanged.
See the [fixed App Sandbox checkpoint](#september-12-fixed-app-sandbox-probe--native-capability-observation).

**Previous private checkpoint: PASS SCOPED — 951/951 portable tests;
122/122 focused handoff/approval checks; generated-code isolation NOT ACCEPTED.**
The new 88 fixed-data tests exercise single-process, one-use approval assertions,
identity, exact bindings, expiry, revocation and callback races. The focused total
includes the earlier 34 review tests; do not add them twice. Of 128 preceding pins,
127 remain unchanged; the changed review module plus a new approval module and test
extend current pins to 130. All 225 imported Veritas files remain unchanged.
The exact 24-file private Node 24 archive was rebuilt/installed with the same hash;
the new private approval modules are not included in that portable archive.
**Retained warning:** the earlier working Node sandbox experiment needed broad file-read access.
Specific denials do not establish protection of unrelated private files. Generated
execution stays closed; an integrated isolated helper, live owner and native app remain pending.
See the [approval/isolation checkpoint](#september-12-one-use-approval-assertions--isolation-capability-decision).

**Previous private-package checkpoint: 863/863 portable tests; private
Node 24 archive/installed-consumer acceptance; 3/3 selected package faults detected.**
Ten declarations, five compile-only consumers, seven fixed runtime checks and the
staged-archive checker are now integrated. All 16 declared typed alias/deep-import
paths resolve in installed-package checks; 29 unsuppressed negative diagnostics
are detected. This is private portable-library acceptance, not the native product.
Of the preceding 100 pinned files, 98 remain byte-identical; only package metadata
and its development lock changed. Twenty-one new files plus seven existing portable
entry modules now explicitly pinned extend the manifest to 128. All 225 imported
Veritas files remain unchanged. The previous 2/2 real Swift/Node combined-host
tests are historical evidence, **not rerun at this checkpoint**; neither was the
entire earlier 25-test native selection. Four native/chat pairings remain covered
by synthetic contracts; **the V3 live workflow remains NOT_RUN**.
The archive contains exactly 24 files and was freshly installed offline with
lifecycle scripts disabled. Its seven runtime tests also run in the canonical
portable suite; do not add them twice. Node 22, native artifact packaging and
full consumer/product acceptance remain pending.
**Latest live demonstration: INCOMPLETE.** Explicit JSON-instruction mode reached
the 90-second author timeout. The earlier strict-schema attempt returned empty
final content. Neither attempt reached review or executed a repaired candidate.
**Latest native repair operation: OUTPUT VALIDATED in 12.1 seconds.** The new
native adapter returned a task-bound repair candidate (748 input / 186 output
tokens). Its exact bytes now have a non-authorizing review/data-handoff record,
but differ from the preapproved repair, were not executed or applied, and have not
passed a complete host workflow or independent live review. No new inference was
performed for this candidate-review checkpoint.
Native application acceptance remains NOT_RUN. The portable contract acceptance
does not relabel the unsuccessful live attempt as a successful demonstration.
These are verification results, not an overall completion or coding-accuracy percentage.
See the [private-package integration checkpoint](#september-12-private-package-integration--node-24-consumer-acceptance),
[candidate-review checkpoint](#september-12-candidate-review-staging--private-non-authorizing-acceptance),
[V3 integration checkpoint](#september-12-v3-protocol-integration--private-contract-acceptance),
[native-adapter checkpoint](#september-12-native-runtime-adapter--first-task-sized-response),
[output-mode checkpoint](#september-12-explicit-output-modes--compatibility-and-runtime-results),
[live-contract checkpoint](#september-12-live-repair-contracts--first-private-runtime-attempt),
[paired accounting checkpoint](#september-12-paired-offon-accounting--private-acceptance),
[combined host checkpoint](#september-12-combined-swiftnode-host--private-acceptance),
[asynchronous Node host checkpoint](#september-12-asynchronous-node-behavior-host--private-acceptance),
[workspace and OpenCode checkpoint](#september-12-task-workspace-and-opencode-fixture--private-acceptance),
[multi-file checkpoint](#september-12-multi-file-static-checks--private-acceptance),
[development acceleration plan](#development-acceleration--same-full-merger-scope),
[two-layer outcome checkpoint](#september-12-two-layer-nativeworkflow-outcomes--v2-checkpoint),
[preceding repair scope](#september-12-private-integrity-and-lifecycle-repairs)
and [product usefulness and comparison report](#september-12-private-product-usefulness-and-comparison-report).

**September 12 pre-repair code checkup: 100% scoped line-reading coverage — ACTION REQUIRED.**
246 code files / 137,518 lines reviewed in that snapshot; this is not a product-completion,
test-coverage or defect-free percentage. See the
[audit findings and repair gates](#september-12-whole-code-checkup--findings-and-repair-gates).

**Latest Nisi OFF/ON pilot: INCOMPLETE — local reviewer warm-up timed out.**
No live token-saving, speedup or task-accuracy percentage is established. The
separate controlled evidence-refusal comparison completed; see the
[private benchmark checkpoint](#september-12-nisi-offon-comparison--incomplete-live-pilot).

## Next version — private Veritas-to-Nisi integration

**Updated:** September 12, 2026. **Development identifier:** `0.2.0-private.0`.
**Status:** source freeze complete; repository snapshot/preparation, versioned
execution-receipt and host-bundle consistency contracts implemented and locally
tested. Real disk capture feeds the snapshot seam for trusted, static local
fixtures. An owned async adapter now runs the retained Swift deterministic checker
inside Nisi for every file in a declared materialized snapshot, with separate
child receipts and bounded cleanup observations. The explicit operator-exclusive
local lane is tested. One-artifact v2 bundles and separately versioned grouped
static-check records are locally tested, including a three-file disk fixture and
one-file fixture repair. A new static-local materializer creates task-owned trees
and rechecks exact inventory/bytes/identity before and after work. A source-reviewed
Node fixture now executes through an owned asynchronous test adapter inside the
real Nisi engine, with fresh trees/receipts and a strict structured-result reader.
The combined Swift/Node repository host now retains an in-process consistency
bundle and exact proposed changes after a complete fixed-fixture repair cycle.
A separate pure paired-trial reader validates supplied comparison records,
preserves adverse/unknown outcomes and computes complete matched-arm totals.
It performs no inference, measurement, persistence or statistical adjudication.
The separately pinned live fixture, one-shot model lane, live consistency receipt
and explicit private CLI are now tested. Versioned per-role output modes preserve
the legacy strict-schema route and strict client validation. Real author attempts
in the combined host ended in empty final content or timeout. A separate native
adapter now passes strict response/lifecycle tests and one real repair-operation
output check, with completion uncertainty preserved. V3 per-role transport,
issued-lane receipt and explicit CLI integration are now contract-tested with
synthetic responses. Non-authorizing candidate-review staging now binds exact
changed bytes and the full protected tree to a one-process review session. It is
not wired into the live CLI and does not register or execute new source. Separate
isolation/execution approval and its consumer, a complete live demonstration, durable/reopened
evidence, native-app and cross-product acceptance remain pending.
This is partial host progress, not a release.
A private portable package now has integrated TypeScript declarations and a
staged, exact-inventory offline install/type/runtime rehearsal on Node 24.18.0.
It deliberately excludes the native product, private history and design files.
A separate registered-runtime model inventory client is now fixture-tested; native
discovery UI, model eligibility/control and approved downloads/upgrades remain pending.

Louis selected Nisi as the product name and explicitly requested merging Veritas
into Nisi for the next version. This is a product and engineering merger, not
only a rename or navigation change. This private copy started from Nisi `0.1.0`
commit `02a0b39146596da6abaf279316ff7086cd70ec52`. Public Nisi subsequently advanced
to `df321f8676f1da6b21885ad0781c7bd0549e1f32`. Its focused deadline correction and
workflow regression test have now been carried into this private copy without
replacing the private version, imported source or historical comparison baseline.

This file is the canonical next-version roadmap in the private working copy.
The public checkout's roadmap continues to describe its own released foundation.
The original private Veritas design and evidence remain retained at their source;
their historical acceptance counts do not become Nisi completion percentages.

**Repository decision — September 12:** Louis confirmed that **Nisi is the sole
active product and repository after merger acceptance; Veritas becomes obsolete
as a separate product.** Preserve its source/evidence as migration history, not a
second active development line. This decision is conditional on completing the
merger; it does not authorize deleting history or publishing private work now.

**Before and after:** [Nisi v0.1 → v0.2 comparison](docs/nisi-v0.1-v0.2-before-after.md)
shows the retained foundation, intended merged product, staged source and remaining
acceptance work. It is a private design companion, not a merged release announcement.

**System equation:** the [retained private equation with the Nisi transition checkpoint](</Volumes/SharedChami/Veritas Local Repository/SYSTEM-EQUATION.md>)
keeps the historical Veritas design intact and labels the current integration state.

> [!IMPORTANT]
> **Private development may continue. Public release is on hold.** Coding,
> merging, local tests and private documentation are allowed within the existing
> task scope. Do not publish this next-version code, design, invention material,
> integration results, public README content, demos, packages, issues or hosted
> artifacts until the release checklist below is satisfied for the exact artifact.
> Earlier public Nisi push approval does not authorize publishing this private tree.
>
> **What this means:** This is Louis's release-control policy—not a runtime error,
> a finding of illegality, or a statement that a patent is mandatory. Renaming the
> project does not clear the existing disclosure, provenance and release decisions.

#### How to clear the publication hold

The September 12 request to “fix” this notice clarifies the hold; it does not
authorize publication or allow a document edit to substitute for clearance.
No legal clearance or filing decision is newly established by this checkpoint.

| Release requirement | Owner | Evidence needed to mark it complete | Current status |
|---|---|---|---|
| Classify the disclosure history and source/licensing provenance | Louis and the IP/patent counsel he chooses | A dated decision record covering the actual Veritas/Nisi scope and prior disclosures | **Not verified here** |
| Decide whether to file, defer, or not pursue patent protection | Louis, with counsel's advice | The recorded decision and any resulting pre-release conditions | **Not verified here** |
| Accept the exact release artifact technically | Engineering owner with independent review | Named source/artifact hashes, resolved release-blocking findings, relevant integration/platform tests and inspected package inventory | **Pending; merger incomplete** |
| Authorize the actual publication action | Louis | Approval naming the artifact/revision, destination and action after the preceding conditions are satisfied | **Not granted for this private version** |

Here, **counsel means an IP/patent lawyer Louis engages**, not Codex, Claude or a
model-generated review. This table records the project's chosen release process;
it is not a legal opinion or proof that a particular filing is necessary.
Private source reviews use only already-approved bounded collaborator scope;
“private” does not mean new providers or unrestricted confidential transmission.

**Work that is not blocked:** finish NX-04–09 privately, repair audit findings,
improve verification/reporting, and prepare an inspectable local release candidate.
The next-version package remains `private: true`; that guards npm publication,
not Git pushes, screenshots, copied text, or every other disclosure route. Keep
the public checkout and frozen historical evidence unchanged. Clearing technical
findings alone does not clear the other rows above.

### September 13 fixed XPC embedded-Node prerequisite — result

**Accepted as measured by Louis — 2026-09-13 (~11:10 PDT, Claude session).**
Verbatim decision: "Approve both, have Astra run the retention pass".
"Both" accepts the September 13 `FIXED_EMBEDDED_NODE_OBSERVED` prerequisite
under Node entitlements exactly {app-sandbox, inherit}, host/service app-sandbox
only, and approves this files-only retention/documentation pass. Generated-code
isolation acceptance remains open as a separate decision. The one open item for
that later review: node[20280] performed a mach-lookup of
`com.apple.SystemConfiguration.DNSConfiguration` at 10:41:58.473 PDT;
loopback listen itself was EPERM. No isolation checkbox or product-progress line
changes. [Claude verification and retention record](work-orders/decisions/2026-09-13-xpc-embedded-node.fable-verification.md).

**Measured status: `FIXED_EMBEDDED_NODE_START_FAILED`.** One native launch;
no retry. Louis approved only brief steps 1–5 in the Claude session, September 13
~10:00 PDT: "Approve the fixed-script prerequisite, have Astra run it".
The approved brief hash was `cb8615b905c1e7153ef22a09f537078524517d453f6a5d86a5a2554a9543f609`.

- Native host PID 9910 and service PID 9916 reached the fixed spawn. The measured
  basis for excluding nested Claude-shell sandbox confounding is each receiving
  its own App Sandbox per secinitd lines reported by Claude Fable, plus retained
  ancestry showing harness 8972 under Codex parent PID 6148. Astra's fresh
  first-attempt log capture was blocked by the current session's sandbox.
- The arm64 Node slice was embedded, ad-hoc signed and hashed after signing.
  Host, service and Node each had only `com.apple.security.app-sandbox=true`;
  strict nested signature verification succeeded. No entitlement was widened.
- `posix_spawn` returned 0, errno snapshot 0, child PID/PGID 9917. `waitpid`
  returned that child with raw status 5: SIGTRAP, no normal exit code, no core dump.
  Exit was observed about 24.08 ms after spawn. Node stdout/stderr were both
  empty with EOF and no read errors. Script entry and all canaries were NOT_OBSERVED.
- The pre-run frozen checker returned `INCOMPLETE`: four derived boxed-int fields
  were `waitObserved=1`, `drainObserved=1`, `cleanupUncertain=0` and
  `coreDumped=0`; Python's wait/drain identity checks required `True`.
  The rerun's existing `harness-correction.diff` normalizes all four non-null
  fields. The first checker and raw evidence remain unchanged.
  The START_FAILED owner finding derives from raw wait status and EOF evidence.
- D1/D2 correction: `experiment.py:146` passed a UTC-labelled start that
  `log show` parsed as local time, selecting a window seven hours in the future.
  The original `[]` results are a harness-window bug, not absence of diagnostics.
  The retained OS crash report identifies missing `kCFBundleIdentifierKey`
  during container-identity derivation and `brk 1` in
  `_libsecinit_appsandbox.cold.6`, through `_libsecinit_appsandbox`,
  `_os_activity_initiate_impl`, `_libsecinit_initializer`,
  `libSystem_initializer` and dyld initializer frames before main.
  Claude's verification records secinitd's
  `registration request failed: (0x10, 0x0)`.
  The verbatim crash report is now in `69qhvao1/logs/`; Astra's exact corrected
  local-window capture failed with exit 64, `log: Cannot run while sandboxed`.
  That failed command is retained and does not establish event absence.
- D4 known limitation: the pre-freeze build retry overwrote
  `container-before.json` and `native-context.json` because `save()` lacks an
  attempt suffix. Separate command receipts retain the failed compile and
  successful retry; the overwritten snapshots are not reconstructed.
- No timeout, cancellation or output overflow occurred. Post-exit direct/group
  `pgrep` had no matches; internal/external group checks returned ESRCH. Service
  PID was absent from one `ps` snapshot; independent lifecycle settlement and
  escaped/reparented descendant absence remain unproven. Both containers remain.
- The 1,707-byte fixed script was copied once to its predetermined service-container
  path and hash-verified. The outside canary (`~/.zshrc`) was read-only and unchanged.
- `generatedCodeExecuted: false`, `completeIsolation: false`, `authorizing: false`.
  Runtime work stopped after startup failure. Isolation-acceptance gates remain open.
- Fable's independent receipt verification is complete: ACCEPT WITH DEFECTS for
  documentation and retention gaps. Louis accepted the later prerequisite as
  measured and approved this retention pass. No further runtime, entitlement
  change, generated-source execution or isolation acceptance is authorized.

[Checkpoint](docs/verification/2026-09-13/u02-xpc-embedded-node-checkpoint.json) ·
[Exact inputs and raw receipts](.build/xpc-embedded-node-69qhvao1/) ·
[Approved brief](work-orders/decisions/2026-09-13-xpc-embedded-node.md).

#### Second attempt (inherit)

**Measured status: `FIXED_EMBEDDED_NODE_OBSERVED`.** One additional native launch,
September 13, 10:41:57 PDT; no retry and no remaining launch authorization.
Louis's ~10:40 PDT Claude-session approval:
"Approve the inherit entitlement, have Astra rerun it". Claude relayed that
approval: "YES. The relocation is a mechanical consequence of that approval, not
a scope change." The first archived checkpoint's createdAt was
`2026-09-13T17:32:37.898145+00:00` (10:32:37 PDT); the earlier creation
timestamp and approximate 10:40 approval time are retained without inventing
a reconciled time.

- The retained secinitd excerpt records separate successful App Sandbox requests
  for host 20276 (10:41:58.332) and service 20279 (10:41:58.425); Node 20280's
  request succeeded at 10:41:58.445. Retained ancestry shows harness 19791 under
  Codex parent 18588. This is the measured basis for excluding nested Claude-shell
  confounding. Node has exactly app-sandbox and inherit; host/service have only
  app-sandbox. Strict deep verification returned 0.
- Exact staged relocation applied; fixed operations, spawn construction, 20-second
  child deadline and 64-KiB cap unchanged. The existing two-line Boolean fix for
  waitObserved, drainObserved, cleanupUncertain and coreDumped is retained.
- Host 20276, service 20279, child PID/PGID 20280. Spawn returned 0, errno snapshot 0;
  raw wait status 0, normal exit 0, no signal. Wait observed about 59.776 ms after spawn.
- Node stdout 781 bytes, stderr 0; both EOFs and drain observed with no read errors.
  No timeout, cancellation, cap overflow, settlement expiry or cleanup signal.
- Own-container write/read allowed; outside `.zshrc` open and IPv4 loopback listen
  denied EPERM/errno 1. Node self-reported PID 20280 and service PPID 20279.
- Unchanged protected checker: `FIXED_EMBEDDED_NODE_OBSERVED`, errors `[]`.
  Re-adjudication of the same retained evidence returned the identical result.
- Post-run direct/group pgrep had no matches; group checks returned ESRCH. Service
  PID was absent in one ps snapshot. Escaped/reparented descendants and broader
  XPC-service lifecycle settlement remain unproven. Both new containers are retained.
- Original receipts from both attempts remain unchanged; new correction sidecars
  and evidence copies are retained. Fixed script copy is 1,724 bytes, own canary
  32 bytes. Outside `.zshrc` hash is unchanged. Fable receipt verification is
  complete (ACCEPT WITH DEFECTS).
- Claude's 58-line pid-20280 unified-log excerpt is copied verbatim into
  `9u2lavy_/logs/`, hash
  `3fae005fe14cdaf35af092ba38d6ac1aa613e1b84c15f1a4588ee246fd13cf5e`.
  Current read-only listings found no `node-*.ips` newer than 10:12:27
  (2026-09-13, report filename/header time) and no
  `~/Library/Containers/node-*` entry. Exact commands, successful exit codes and
  measurement time are in `logs/retention-filesystem-measurement.json`.
- `generatedCodeExecuted: false`, `completeIsolation: false`, `authorizing: false`.
  No isolation-acceptance checkbox or product-progress line changed.

[Inherit checkpoint](docs/verification/2026-09-13/u02-xpc-embedded-node-inherit-checkpoint.json) ·
[Frozen inputs and raw evidence](.build/xpc-embedded-node-9u2lavy_/README.md).

### September 12 private XPC prototype — two fresh native experiments

**Overall roadmap: 30% (3/10). NX-04/U02-02 advances; no additional major
milestone, generated-code permission or release gate is closed.**

The native prototype now has an actual process boundary: a containing application
and one embedded private XPC service. The client sends one fixed binary request;
the service checks that request against the operating-system-reported caller PID
before performing its fixed file/socket checks. Neither receives task source,
commands, paths, environment overrides or model output. Both bundles are locally
ad-hoc signed and strictly verified, using only `com.apple.security.app-sandbox`.

| Evidence | First fresh run | Second fresh run |
|---|---:|---:|
| Launcher/client/service-observed caller PID | 30941 | 31222 |
| Service self-reported PID — not runtime identity attestation | 30943 | 31223 |
| Client process observation | 309 ms; exit 0 | 355 ms; exit 0 |
| Output close/drain, stderr | Confirmed; empty stderr | Confirmed; empty stderr |
| Service own-file write/read | Exact 17-byte payload | Exact 17-byte payload |
| Fixed outside-file open/read and create/write | Opens denied with EPERM; dependent I/O not run | Same |
| IPv4 loopback test | Socket allowed; bind denied with EPERM; close allowed | Same |
| Signed permission dictionaries | App Sandbox-only on both bundles | Same |

The 309/355 ms numbers cover the direct client observation, not compilation,
model inference, task completion, Nisi OFF/ON improvement or a speed benchmark.
The prior standalone unsandboxed controls are historical context; these XPC runs
do not include a new unsandboxed XPC control.

**Verification and retained evidence**

- **972/972 portable tests rerun PASS; 134/134 canonical source pins unchanged.**
  All 225 imported files still match their retained freeze; original location was
  not rechecked. Package, combined Swift/Node and live-model acceptance were not rerun.
- **2/2 fixed native XPC experiments observed.** The owner rechecked both complete
  nested bundle inventories, copied sources, inputs, known files and raw client
  records after execution. A separate isolated binary reader agreed with both
  225-byte native reply frames. These are local, mutable evidence files, not
  independently timestamped or cryptographically certified execution records.
- **9/9 isolated parser tests; 3/3 selected faults detected**, one failed test
  each for bypassed caller-PID matching, invalid permission errno and removed
  prerequisite validation. Codex reran the control and variants independently.
  These nine tests are not added to the 972 canonical suite total. Tests for
  byte aliases, UTF-8/BOM and close status do not establish exhaustive coverage.
- The owner evidence checker initially expected TAP while Node selected its
  human-readable reporter. It refused the unparseable counts, not the passing
  tests. That record remains; the correction explicitly selects TAP and retains
  fresh control/mutant receipts. No missing count was accepted as zero or PASS.
- Source review corrected a signed-length comparison, invalid-peer slot handling,
  stale reply bytes after failure, byte-exact identity comparison and UTF-8
  round-trip checking. The separate parser and phase-helper drafts remain isolated;
  none has silently replaced the canonical native runner.

Sources and evidence: [owner/native prototype](.build/private-xpc-owner-6Ao5Gh/),
[first experiment](.build/private-xpc-native-guyf6f/terminal.json),
[second experiment](.build/private-xpc-native-oGIVMQ/terminal.json),
[independent owner recheck](.build/private-xpc-owner-6Ao5Gh/recheck.json), and
[checkpoint receipt](docs/verification/2026-09-12/u02-private-xpc-prototype-checkpoint.json).

> [!WARNING]
> **XPC communication is observed; integrated execution and service settlement
> are not accepted.** Connection invalidation/client exit do not independently
> prove service termination. The service's PID is not kill authority. In-memory
> one-use flags do not persist across service restart, and the fixed fixture does
> not contain task-generated code, descendants or resource exhaustion.
>
> **Why this matters:** a successful isolated experiment must not turn on a more
> powerful executor or be described as a completed native product.

> [!CAUTION]
> **Four new sandbox containers were created and retained; none was deleted.**
> Under `/Users/louiscalata/Library/Containers/`, their exact identifiers are:
> `local.nisi.xpcprobe.host.r5f1bd0f791cce1e0c31072fb80e81fdd`,
> `local.nisi.xpcprobe.service.r5f1bd0f791cce1e0c31072fb80e81fdd`,
> `local.nisi.xpcprobe.host.r08f40a53b204cec2bc68eca9324a030b`, and
> `local.nisi.xpcprobe.service.r08f40a53b204cec2bc68eca9324a030b`.
>
> **Why this matters:** fixed tests still create persistent device data. Retaining
> exact identities makes any later user-approved cleanup narrowly targetable.

**Next engineering order**

- [x] Establish actual embedded private-service discovery, fixed exchange and
  separate container behavior on this macOS 27/Apple-silicon host.
- [ ] Move the reviewed prototype into canonical host modules with portable
  parser/owner tests, explicit opt-in and source/configuration bindings.
- [ ] Exercise native malformed requests, duplicate invocation, timeout, crash,
  interruption and invalidation without conflating client closure with service settlement.
- [ ] Add tested runner phase/persistence failure seams; the isolated helper
  proposal alone does not test the real runner's terminal-write failure path.
- [ ] Integrate a protected checker and actually isolated runtime, then bind the
  live owner to exact action-time authority before any generated candidate runs.
- [ ] Complete a real repository workflow and native app acceptance; retain all
  legal, publication and exact-artifact release gates.

**Collaboration:** Fable → Sonnet → Opus each timed out under the bounded ladder;
no Claude review returned. The one SharedChami Qwen task completed in 77.3 seconds,
but its source-free review was malformed and used incorrect offsets for its own
proposed format; it was rejected without execution. That proposal's 17-row format
is not this prototype's 15-row protocol. Luna drafted isolated tests/readers,
Daybreak reviewed platform/source/native evidence, and Codex implemented, ran and
adjudicated the fixed prototype. Tokens/cost are unknown where not reported.
No new OpenCode packet, publication, Developer ID, credential change or saved
server-trust edit occurred. The approved SharedChami hostname was task-only.

### September 12 repeatable fixed native probe — two fresh runs

**Overall roadmap: 30% (3/10). This advances NX-04/U02-02; it does not close
the real repository workflow, generated-code isolation or native product gates.**

Three private host files and one portable test file now implement a repeatable
fixed App Sandbox experiment. The source, runner and parser are under
`hosts/macos-sandbox/`; they are not added to the portable distribution archive.
This is actual canonical engineering work, not just a retained one-off script.

| Before | Now | Still not established |
|---|---|---|
| Hardcoded one-time root/container | Fresh exclusive root and 128-bit run ID each invocation; two fresh runs completed | Cross-machine/OS repeatability |
| Different outside-write basenames | Sandbox first; same exact absent target, then control only after sandbox leaves it absent | Hostile filesystem-writer protection |
| Combined socket/bind label | Separate creation, bind and close results | Connect, DNS, IPv6 or external-network restrictions |
| Child self-reported PID only | Launcher PID matched to parsed self-report in all four fixture processes | OS executable-path attestation, descendant identity |
| Loosely interpreted output | Exact metadata + 17 ordered rows, valid errno and dependency combinations, bounded output | Independent raw syscall/child-wait telemetry |
| Postconditions checked afterward by another script | Known-byte file checks and input/source stability integrated into each run | Atomic adversarial snapshots |

The opt-in entry point is deliberately separate from `npm test`:

```sh
node hosts/macos-sandbox/fixed-probe-runner.mjs --run-fixed-app-sandbox-probe
```

It builds, ad-hoc signs and runs only the reviewed fixed native fixture. No path,
command, model output, entitlement or environment override selects work. Missing
or extra arguments refuse before build/launch/root creation. This opt-in is an
engineering guard, not an authenticated user grant or generated-code permission.

#### Actual acceptance and preservation

- **972/972 portable tests PASS:** previous 951 + 21 parser/opt-in/adjudication
  checks. There are no new native launches in the ordinary portable test lane.
- **2/2 fresh native experiments:** four fixture processes, each with a matching
  parent/self PID, exit 0, direct-child close/drain observed and no timeout,
  cancellation or stderr. Sandbox wall observations were 211 and 193 ms; controls
  were 114 and 118 ms. These are not Nisi OFF/ON speed or accuracy measurements.
- **Both sandbox runs:** own file read/write succeeded; outside read/create were
  `DENIED/EPERM`; socket creation succeeded, bind was `DENIED/EPERM`, close
  succeeded; fixed `/usr/bin/true` spawn/wait succeeded. Both controls succeeded
  in all 17 operations. Denied operations' dependent rows correctly say NOT_RUN.
- **Signing:** exact App Sandbox-only dictionary on each bundled sandbox app;
  exact empty dictionary on each bare control executable. Both use ad-hoc identity
  and strict signature verification. Source/header and external operations match;
  compilation mode, bundle layout, signature and entitlements differ explicitly.
- **Four selected parser faults detected:** invalid-denial errno, missing PID
  equality, removed prerequisite validation and removed duplicate-key guard.
  Their failed-test counts were 1, 1, 4 and 1 with a passing 21-test control.
  The parser/tests match current bytes; the copied runner predates the later
  pre-root/source-binding/signing corrections. This is parser evidence, not a
  mutation claim about the final runner or exhaustive security coverage.
  **Evidence correction:** the collaborator's claimed passing control log was
  actually an earlier missing-import failure, and its linked hash-list file did
  not exist. Codex retained that adverse log, checked the eight-file copied
  dependencies and exact one-site changes, then independently reran the control
  (21/21 PASS) and all four variants (1/1/4/1 failures). Only these fresh owner
  receipts support the accepted mutation result; the collaborator acknowledged
  the unsupported earlier claim.
- **Preservation:** 130 prior pins unchanged; four new files → 134 current source
  pins. All 225 imported files match the retained freeze; origin not rechecked.
  Prior package/consumer and combined Swift/Node acceptance were not rerun.

#### Corrections found before native execution

The isolated parser draft had misleading tests: a callback parameter shadowed the
mutation closure, so an unrelated TypeError could satisfy a broad throws assertion.
The repaired tests require reader-specific errors. Dependency handling now covers
failed spawn correctly, rejects top-level skips and preserves genuine close errors.
The initial red receipt includes test-authoring and parser defects, not exclusively
production-code failures. No rejected parser version was integrated.

Daybreak found setup paths that could leave a root without a terminal record and
missing source bindings for the lifecycle observer/dependencies. Before launch,
fallible source/identity preparation moved ahead of root creation, post-root work
gained terminal handling, and eight consumed sources gained stability checks.
Terminal persistence failure stays INCONCLUSIVE and reports its root. Control
signing and the distinction between interpreted fixture labels and raw telemetry
were made explicit. The native source also refuses a sandbox-home mismatch before
explicit file/socket/child operations, preventing accidental own-file writes to
the real home if container resolution is wrong.

#### Actual collaboration

- **Claude:** one tool-disabled Fable → Sonnet → Opus ladder, 120-second overall
  bound. Fable/Sonnet exceeded 45 seconds; Opus exceeded the remaining ~29.96
  seconds. No usable deliverable; usage/served identity/cost unknown.
- **SharedChami:** one task-only approved-host job,
  `mac-20260912-231443-a6295d469d8fa45f97e4ed2528252c0b`. Returned source from
  `Qwen3-Coder-Next 80B-A3B Q4_K_M` after 125.3 reported worker seconds.
  **Draft rejected without compilation:** invalid JSON formatting, incorrect
  permission-error labels, omitted control read, weak exact-byte checking and
  incorrect spawn-error handling. Transport success did not become source acceptance.
- **Luna:** isolated parser/test drafting, repairs and selected fault variants.
  **Daybreak:** runner design/source review and final fixed-native static review.
  **Codex:** final source integration, expanded tests, inspected native implementation,
  signing/execution and acceptance. Review GO wording is advisory, not user authority.
- **OpenCode:** no new packet was launched for this security-sensitive boundary.
  The preceding mechanical formatter attempt remains BLOCKED, not delivered.

> [!WARNING]
> **Repeatable fixed probes are not a generated-code sandbox.** The fixture reports
> interpreted per-syscall outcomes, not independently measured return/count/child-wait
> telemetry. Its exact fixed child remains allowed; no arbitrary descendants were tested.
>
> **Why this matters:** the native XPC service, protected checker, actual live owner,
> user-action binding and adversarial resource/cancellation/cleanup tests remain
> required before accepting generated-candidate execution. `waitpid` interruptions
> currently produce an adverse result, not retried reaping or settled descendants.

> [!CAUTION]
> **Two new test containers are retained**, in addition to the earlier one:
> `local.nisi.fixedprobe.rb7e545b820ea64fa416cfd9c15be9c64` and
> `local.nisi.fixedprobe.r15c275f5f51910a526c51d956f4331f2`, beneath
> `/Users/louiscalata/Library/Containers/`.
>
> **Why this matters:** fixed tests still create persistent data. Only their known
> task-owned files were checked; nothing was deleted or broadly inspected.

#### Next implementation order

- [x] Integrate a repeatable fixed fixture, same-target control and separate
  socket observations; verify two fresh runs on this Mac.
- [x] Bind the direct launcher PID and consumed lifecycle sources; retain adverse
  parser/model drafts and meaningful fault controls.
- [ ] Add targeted runner/setup/persistence/cancellation fault tests. Existing
  observer tests do not establish every new runner failure path or native cleanup.
- [ ] Build the containing fixed test app and private embedded XPC service;
  observe actual rights, service identity, paths and lifecycle. Keep inputs fixed.
- [ ] Integrate isolated runtime and protected checking, actual live-owner/user
  authorization, then a fresh complete repository workflow with independent review.

**Evidence:** [repeatable native checkpoint](docs/verification/2026-09-12/u02-repeatable-app-sandbox-checkpoint.json).
Everything remains private; no commits, pushes, publication, Developer ID use,
model installations or persistent trust changes occurred.

### September 12 fixed App Sandbox probe — native capability observation

**Overall roadmap: 30% (3/10). Native capability observed; NX-04/U02-02 and
generated-code execution remain open.**

The earlier broad-read Node profile remains unsuitable. A new, separate fixed
Objective-C `.app` was compiled using the installed Xcode 27 toolchain and run on
macOS 27.0 / Apple silicon. Its verified signed entitlement dictionary contains
exactly `com.apple.security.app-sandbox: true`. Local ad-hoc signing used no
Developer ID credential, provisioning, notarization or installation workflow.
Signature verification is integrity evidence for this local fixture, not Apple
distribution approval or complete isolation acceptance.

| Fixed operation | Unsandboxed comparison | App Sandbox fixture | Evidence limit |
|---|---|---|---|
| Write/read own known file | ALLOWED | ALLOWED | Three resulting task-owned files now match the exact expected 17 bytes |
| Read known outside canary | ALLOWED | DENIED, `EPERM` | Same known canary; unchanged before/after hash |
| Create outside fixture file | ALLOWED | DENIED, `EPERM` | Same directory, **different basenames**; sandbox marker absent |
| IPv4 loopback socket/bind probe, port 0 | ALLOWED | DENIED, `EPERM` | One label covers socket creation and bind; failing syscall is not distinguished |
| Spawn/reap fixed `/usr/bin/true` | ALLOWED | ALLOWED | No arbitrary child, inherited-rights or descendant-cleanup proof |

Both processes exited 0 with no signal, timeout, launcher error or stderr.
No connect, listen, DNS, IPv6 or external-network test was performed.
Observed elapsed times were 187 ms for the comparison and 253 ms for the sandbox
fixture. These are individual fixture observations, not Nisi OFF/ON performance
or accuracy measurements. Reported PIDs are child self-reports; the launcher did
not independently retain parent-observed PIDs. CPU/core limits were requested;
exhaustion, process-group shutdown and adversarial resource behavior were not tested.

The source and scripts remain private experiment artifacts under
`.build/app-sandbox-native-tiy7rN`, not an integrated production host. Hardcoded
fixture paths, exclusive creation and an absent-container precondition make this
run intentionally non-repeatable in place. Keep the original observation intact;
a reusable test must create a new scoped fixture identity.

#### Corrections and remaining cautions

- The first entitlement reader expected XML from `codesign`'s default output and
  failed after compilation/signing. The corrected reader explicitly requests
  `--xml`, converts the plist to JSON and checks exact typed dictionary equality.
  The failed script/receipt remain retained. This was a test-reader format
  assumption, not evidence that the initial signature was invalid.
- A retained build command label says “unsigned-comparison.” The correct term is
  **unsandboxed comparison**: the Apple-silicon compiler may ad-hoc sign executables.
  That historical label is not being rewritten or used as a security assertion.
- The installed Node executable has broader development entitlements. They were
  inspected read-only and were not copied, modified or added to this fixture.
- The network row is named `loopback-bind` but the source also emits that label
  when socket creation fails. The recorded denial therefore describes the combined
  socket/bind probe, not proof that `bind()` specifically was denied. Preserve the
  raw label and separate those syscall observations in the repeatable fixture.

> [!WARNING]
> **Three targeted denials do not make generated-code execution safe.** The fixed
> child still launched; private XPC separation, Node/runtime integration, protected
> result checking, live ownership and descendant/resource containment remain pending.
>
> **Why this matters:** an experiment can demonstrate selected restrictions without
> protecting every file, process or resource a future untrusted candidate may reach.
> Keep automatic generated-candidate execution closed until its exact gates pass.

> [!CAUTION]
> **The fixture created a persistent test container.**
> `/Users/louiscalata/Library/Containers/local.nisi.sandbox-probe.tiy7rn`
> did not exist before launch and is retained with its known fixture data.
>
> **Why this matters:** app launch has filesystem effects even when no product is
> installed. Nothing was deleted; future cleanup must target only this exact owned
> container. The postcheck read only the exact known task file, not other containers.

#### Actual collaborators and verification

- **Claude:** Fable first, then Sonnet and Opus, each bounded to 45 seconds; all
  timed out with no usable draft. Status **NOT_RUN**, not completed participation.
  Served-model identity, token use and cost are unknown for these attempts.
- **SharedChami:** one completed source-free design review, job
  `mac-20260912-225023-a8972fc9a1785f97acd251291e8ce99d`; requested
  `qwen3-coder-next`, reported `Qwen3-Coder-Next 80B-A3B Q4_K_M`, 48.2 worker seconds.
  Result **DESIGN_NEEDS_REPAIR**. Exact-byte postchecks and semantic entitlement
  checks were adopted. Identical outside-write targets, independent process identity
  and further network/descendant checks remain unimplemented. This is not Windows
  native acceptance. Only the approved task-local `louisaurorar12` override was used.
- **OpenCode:** one isolated mechanical formatter packet on the requested local
  `lmstudio/qwen/qwen3.8-27b` route. Lint passed; the 180-second edit phase timed out,
  produced no formatter source, and ended **BLOCKED**. No source was integrated or
  generated code executed; the route label is not proof of served-model inference.
- **Daybreak:** primary Apple/installed-SDK architecture review. **Luna:** read-only
  source and retained-result review. **Codex:** fixture implementation, local
  compilation/signing/execution, exact-file postchecks, integration and acceptance.
- **Regression:** 951/951 portable tests freshly passed with all 130 source pins
  unchanged before/after; 225/225 imported files match the retained freeze manifest.
  The original source location was not rechecked. Package/consumer and earlier
  combined Swift/Node acceptance remain historical, not rerun at this checkpoint.
- **Online activation:** shared policy 5.3.2 verified; share mounted, recent worker
  heartbeat, 31 pinned guards OK. Advertised models are inventory only; this
  activation made no new inference or cloud-provider call.

#### Next native work order

- [x] Build, sign and run a minimal fixed App Sandbox app and unsandboxed comparison.
- [x] Retain raw build/run results, failed reader evidence and exact-file postconditions.
- [x] Turn this into a repeatable, per-run fixed fixture with exact control targets,
  interpreted per-syscall outcomes and parent/self PID matching; see the newer checkpoint.
- [ ] Complete new runner failure/cleanup fault tests and native descendant checks.
- [ ] Build a containing test app plus private embedded XPC service using only
  reviewed fixed requests. Verify actual service rights and container paths;
  do not assume a standalone Node CLI can directly use this private service.
- [ ] Test descendant inheritance, bounded cancellation/drain, resource exhaustion,
  output limits and cleanup uncertainty before attaching Node or generated source.
- [ ] Integrate exact live-owner/user-action bindings and a protected result checker;
  run generated candidates only after separate isolation acceptance and approval.

Apple's private XPC-service design is a direction for the next fixture, not an
already implemented Nisi capability.
[Apple XPC service documentation](https://developer.apple.com/documentation/xpc/creating-xpc-services).

**Evidence:** [private native checkpoint](docs/verification/2026-09-12/u02-app-sandbox-probe-checkpoint.json).
No canonical runtime source changed in this checkpoint. No commits, pushes,
publication, Developer ID use, model installations, authentication or saved trust
changes. The native experiment used local ad-hoc signing only; legal/release gates
remain unchanged.

### September 12 one-use approval assertions — isolation capability decision

**Overall roadmap: 30% (3/10). Private data-contract slice accepted;
U02-02/NX-04 and complete generated-code execution remain open.**

The original handoff now has live issuer-owned identity and one-way claim state.
A separate approval owner reserves one scope per original handoff, even if a
second caller changes the execution ID. This is a trusted-host assertion contract,
not an authenticated user grant, durable/distributed capability or launcher.

```text
Original review → live exact handoff → reserve one approval owner
    → bind run/task/attempt/candidate/tree/preparation/suite/harness
    → bind requested runtime / launcher / profile hashes + execution ID
    → host records approve-one or reject assertion
    → fresh clocks, identity, expiry, revocation and scope checks
    → burn original handoff once
    → final clock + no-callback source-state validation
    → immutable NON-AUTHORIZING consumption data
    → actual live owner, user action, isolation and launch [PENDING]

Failure after claim → keep claim burned; no success record or refund
```

Require `approval.expiresAtMs <= review.expiresAtMs`; equal configured expiries
are allowed, but `now >= either expiry` refuses use. Clocks are nondecreasing
Unix-millisecond observations. The final callback-free check reads known source
state and requires the final approval observation to cover the source's last
observation; it cannot detect independently changed clocks that were never sampled.
A consumption timestamp is a post-claim observation, not a process-start time.
Serialized records are inert; identity is scoped to one process/module instance.

| Current check | Result | Boundary |
|---|---|---|
| Portable regression | **951/951 PASS** | 863 previous + 88 fixed-data approval/handoff tests |
| Focused review/approval | **122/122 PASS** | 34 existing + 88 new, already included above |
| Source preservation | **225/225 unchanged; 130 current pins** | Imported origin not rechecked; 127/128 prior pins unchanged |
| Archive/consumer | **PASS SCOPED; identical 24-file archive** | Five type consumers, 29 negative diagnostics, seven installed runtime checks |
| Structural check | **PASS** | Existing canonicalizer scope, not whole-project purity |
| Selected fault variants | **5/7 detected; 2 survived; control 122/122 PASS** | Later checks still protected exercised paths; not exhaustive mutation coverage |
| Mac isolation | **PARTIAL_CAPABILITY_ONLY** | Fixed control and six targeted denials; complete isolation unproven |
| Live/native application | **NOT_RUN this checkpoint** | No generated candidate or new complete workflow executed |

#### Corrections and actual collaboration

- Retained red/green runs demonstrate fixes for expiry during final claim,
  unexpected nested source-session operations, revocation after claim, and expiry
  crossing during issuance/decision. Failed source/test snapshots were preserved.
  One intermediate test incorrectly expected an early-revoked handoff to be
  consumed; correcting it still left the genuine post-claim defect failing before
  the implementation fix. This test-authoring error is not a production defect.
- Fable was attempted first and timed out at 45 seconds. Sonnet returned a usable
  source-free **FAIL** review with `claude-sonnet-5` and Haiku telemetry. Useful
  reservation/reentrancy checks were adopted; claims must not be refunded, and
  plain scope records need not have issuance identity. Raw FAIL prose stays retained.
  Successful-attempt cost was about $0.0533; timed-out Fable cost/usage is unknown.
- SharedChami completed one separate Qwen adverse-design job,
  `mac-20260912-222614-e00c308efa2773498242bcb76e140e15`, reported
  `Qwen3-Coder-Next 80B-A3B Q4_K_M`, 115.9 worker seconds. It used the approved
  task-only `louisaurorar12` override. Useful binding/lifecycle tests were adopted.
  Runtime/harness paths are distinct and hashes cannot replace issuance identity.
  The source-free request and initial authored adjudication contained a reversed
  expiry premise; the adjudication now corrects it against the tested rule above.
  Original request/response remain unchanged. Worker success is not native Windows acceptance.
- Luna reviewed lifecycle code. Its initial two-successful-handoffs claim was too
  broad: the outer guard already rejected the changed state. Unexpected nested
  operations were reproduced and bounded. Daybreak ran fixed Mac isolation probes.
  Codex owns canonical fixes and acceptance. Earlier OpenCode work is historical;
  no new OpenCode execution is claimed for this slice.
- Luna's isolated fault work had a passing 122-test control, five detected faults
  and two survivors. Its initial current-hash statement was stale; direct hash
  comparison showed the tested control actually matched current canonical bytes.
  Codex independently checked all 16 copied dependency files, inspected each
  one-file mutation and reran all eight cases. The same 5/7 result was retained.
  Survival is not proof of equivalence: downstream guards protected the exercised
  paths, but direct-helper call paths deserve additional discriminator tests.

> [!WARNING]
> **The experimental Mac profile is unsuitable for generated code.** Narrow launch
> profiles exited 134; the only working Node profile found needed `file-read*`.
>
> **Why this matters:** blocking a particular canary or network operation does not
> protect unrelated private files. Keep unregistered-code execution closed; do not
> connect this broad-read profile to automatic execution.

> [!CAUTION]
> **Approval assertions are not actual authority or verified isolation.** Records
> keep execution, source-execution, isolation, user/current-run/model attestation
> and authorizing flags false where defined.
>
> **Why this matters:** labels, hashes and a synthetic CURRENT_RUN value do not
> prove actual user approval, model provenance, live ownership or safe launching.

#### Next engineering work order

- [x] Implement and regress original-identity, one-use approval assertions.
- [x] Run fixed capability probes and preserve the adverse outcome.
- [x] Prototype a separate ad-hoc-signed fixed App Sandbox app; see the newer native
  checkpoint for observed denials and remaining limits.
- [ ] Build a repeatable containing-app/private-XPC fixture and prove its required
  rights/ownership before adding Node or generated source.
- [ ] Bind actual live-run ownership, exact runtime/profile/harness bytes and the
  scoped user action. Metadata-only assertions must not enable launching.
- [ ] Verify descendants, resource limits, cancellation, output bounds and cleanup
  uncertainty. A direct-child exit does not prove process-group cleanup.
- [ ] Protect the harness and an outcome oracle the candidate cannot rewrite or
  spoof; immutable harness files alone do not establish independent checking.
- [ ] After isolation/owner acceptance and exact action-time approval, start a fresh
  live run with fresh Swift/Node checks and independent live review. Do not resume
  or relabel the earlier incomplete run.

Apple documents that Process children inherit the parent's sandbox and recommends
XPC services when helper entitlements must differ. This supports investigating a
separate helper; it does not establish that Nisi's unbuilt helper is safe.
[Apple Process documentation](https://developer.apple.com/documentation/Foundation/Process).
The installed manual marks `sandbox-exec` deprecated.

**Evidence:** [source-bound checkpoint](docs/verification/2026-09-12/u02-generated-approval-checkpoint.json),
with raw checks, source pins, collaborator receipts and adverse isolation results.
Everything stays private: no commits, pushes, publication, model installations,
authentication or saved trust changes. Legal/release gates remain unchanged.

### September 12 private-package integration — Node 24 consumer acceptance

**Overall roadmap: 30% (3/10). Portable consumer slice accepted; U02-03/NX-09
remain open for the supported-platform/native artifact and complete-product scope.**

The reviewed isolated declaration proposal is now integrated, with the existing
runtime modules unchanged. Nisi provides ten declaration files with readonly
reports, candidate-bound adapter inputs, literal outcomes and V1/V2 local-chat
receipt narrowing. TypeScript helps callers; it cannot prove runtime evidence,
numeric bounds, path safety, model participation or acceptance authority.

The private build route is now executable and repeatable:

```text
Canonical package metadata + 13 runtime modules + 10 declarations
    → exact typed export and source inventory contract
    → fresh staging tree; project scripts/dev dependencies deliberately omitted
    → offline npm pack with lifecycle scripts disabled
    → exact 24 tar members + each member's expected bytes
    → offline install into a fresh private consumer
    → compare all installed bytes and recheck source/archive identity
    → five TypeScript consumers + 29 required negative diagnostics
    → seven injected runtime tests, including all declared import paths
    → private scoped receipt, archive and raw checks retained
```

**Commands, from the canonical private checkout:**

```sh
npm run test:types
npm run check:private-package
```

The second command writes its exact private archive and receipt under a new
`.build/private-package-*` directory. It does not publish anything. Its compiler
and Node types must already be installed; missing tools/dependencies produce FAIL
with a retained cause rather than silently fetching dependencies. The project
development lock now includes `@types/node` 24.13.3 and its `undici-types` 7.18.2
dependency, installed from the local cache with `--offline --ignore-scripts`.
TypeScript remains 6.0.3. No model download or credential/configuration change occurred.

| Acceptance evidence | Result | Boundary |
|---|---|---|
| Canonical portable suite | **863/863 PASS** | 851 previous + 5 package-contract + 7 consumer tests; no native-app run |
| Structural check | **PASS** | Existing canonicalizer check, not a new whole-repository purity claim |
| Installed archive | **24/24 exact files** | 13 runtime + 10 declarations + projected private metadata; no README/design/history/native binary |
| Installed TypeScript | **5/5 consumers; all 29 expected negative locations detected** | Node 24.18.0 / TypeScript 6.0.3 / Node types 24.13.3 |
| Installed runtime | **7/7 PASS** | Fixed supplied data/injected responses; no real model or native execution |
| Selected package fault probes | **3/3 detected, passing control** | Automatic README inclusion, staged-byte drift, suppressed negative control; not exhaustive |
| Preservation | **98/100 prior pins unchanged; 128 current pins; 225 imported files unchanged** | 21 new implementation/test/type files + 7 existing portable entry modules added to the manifest; only prior package.json/package-lock.json changed |

The exact typed surface is six aliases (`.`, `workflow`, `policy`, `serialization`,
`adapters/apple-foundation-models`, `adapters/local-chat`) plus ten legacy paths:
`index.mjs`, `workflow/engine.mjs`, `workflow/contracts.mjs`,
`policy/file-access.mjs`, `serialization/canonical-json-v1.mjs`,
`adapters/apple-foundation-models.mjs`, `adapters/local-chat.mjs`,
`canonical/canonical-json-v1.mjs`, `gate/content-consent.mjs`, and
`gate/afm-content-executor.mjs`. Every mapping specifies its exact `types` and
runtime target in `scripts/private-package-contract.mjs`. The old wildcard is
retained for checkout compatibility; it does not include extra archive files or
promise typed support for every internal path. Installed imports of excluded
`README.md` and `roadmap.md` are explicitly refused.

> [!WARNING]
> **Use the staged private-package command, not `npm pack` at the full checkout.**
> This acceptance applies to the exact staged assembly route and private archive.
> It does not authorize disclosure through any route.
>
> **Why this matters:** package managers can automatically include README-like
> files. The fresh stage omits them, and both the actual tar inventory and installed
> bytes are checked. Direct-checkout packing is unsupported for this private tree.

#### Review, corrections and retained failures

- Three initial package-contract tests failed before declarations/export metadata
  were integrated. A separate missing/widened-engine discriminator failed before
  the helper required exactly `{ node: '>=22' }`; it now passes.
- Luna reviewed all ten declaration files and the package contract. An initial
  repeated engine finding was stale after correction; the actual current test
  and source evidence supersede that statement.
- Claude Fable, Sonnet and Opus each timed out under one bounded ladder. Their
  review is **NOT_RUN**, with unknown served identity/usage/cost.
- SharedChami performed one fallback package-plan review: job
  `mac-20260912-220402-62998483d374e3bbe2b57263ee2729a3`, requested
  `qwen3-coder-next`, reported `Qwen3-Coder-Next 80B-A3B Q4_K_M`, 62 worker seconds.
  Its FAIL prose is retained. The assertions that staged dev dependencies are
  mandatory and an export wildcard requires packing extra files are not supported
  by the inspected artifact. No suggested wildcard was added to `files`. Its
  useful request for explicit legacy paths led to all-16-path consumer checks.
  The exact server override remains task-only; this is not Windows-native acceptance.
- OpenCode's earlier actual type draft and its BLOCKED receipt remain historical
  inputs to this integration; no new OpenCode execution is claimed for this slice.
- Early isolated fault work retained an incomplete-copy failure and a suppression
  probe that failed earlier than intended. Codex reran three precisely targeted
  probes against the final source; each fails at its intended check. No failed
  receipt was edited into a PASS. Offline fixture archive installs did occur;
  these are not provider/model installations.

**Evidence:** [private-package checkpoint](docs/verification/2026-09-12/u02-private-package-checkpoint.json),
with source pins, final archive hash, raw install/compiler/runtime results, before/
after regressions, targeted faults and actual review receipts. Build-tool commands
run against a trusted static checkout; hashes detect drift, not hostile-writer isolation.

**Next critical dependency:** separate exact-run execution grants, tested generated-
code isolation and process-group cleanup, followed by fresh Swift/Node/live-review
execution. Daybreak's bounded local inventory/design is retained in
`.build/isolation-design-2XJ9Xu/PLAN.md`; it is a proposal, not accepted isolation.
It identified deprecated `sandbox-exec` as a possible private developer probe,
not a shipping solution. Profiles/cleanup were untested at that earlier checkpoint.
The later experiment above found an unsuitable broad-read profile. Product
isolation still needs a separately accepted helper; neither artifact permits
generated-source execution.
History, evaluated prevention, native app, modular extensions and complete merger
remain in scope. Release/legal gates remain unchanged.

### September 12 candidate-review staging — private non-authorizing acceptance

**Overall roadmap: 30% (3/10). Review staging accepted; NX-04/U02-02 remains open.**

Nisi can now prepare an inspectable review packet for a model-returned candidate
without treating a model response, a hash or a review label as permission to run
it. This is a trusted-host, single-process component, not a sandbox or durable
authorization service. The existing live CLI still refuses unregistered source.

```text
Original reviewed suite + task + baseline + returned candidate
    → validate run / task / attempt / base / candidate bindings
    → materialize the complete tree as DATA; protect the acceptance harness
    → show exact before/after bytes + hashes + full file inventory
    → unique in-process review session, explicit reviewer label and expiry
    → APPROVE_FOR_ISOLATION_REVIEW or REJECT
    → one exact-bound data handoff [NO execution permission]
    → separate isolation + execution approval/consumer [STILL PENDING]
    → future fresh checks and independent live review [STILL PENDING]
```

Implemented in `hosts/repository/candidate-review-v1.mjs` with
`createCandidateReviewSessionV1()` and `readIssuedCandidateReviewV1()`.
The original session exposes immutable packet/snapshot data, `decide()`,
`handoff()` and `revoke()`. Copied/serialized sessions are not issued sessions.
Identical decisions are idempotent only before expiry/revocation/handoff;
conflicting decisions are terminal. Every owner has a distinct issuance identity.
The explicit Unix-millisecond clock must not go backwards. Clock exceptions,
expiration and revocation cannot revive an old approval or erase a terminal cause.
This does not claim global/cross-process nonce coordination or crash recovery.

| Verified evidence | Result | Limit |
|---|---|---|
| Candidate-review tests | **34/34 PASS** | Included in 851; no generated source execution |
| Canonical portable tests | **851/851 PASS** | Zero failures, cancellations, skips or todos |
| Selected broken variants | **8/8 detected** | 34-test passing control; assertion failures, not import errors or timeouts; not exhaustive |
| Source preservation | **98 previous files unchanged; 100 current pins; 225 imported files match** | No previous receipt rewritten |
| Retained real candidate | **HISTORICAL_CANDIDATE_REVIEWED_NOT_EXECUTED** | Exact null-default expression inspected; no original-run resume, registration or new inference |
| Native integration/application | **Not rerun / NOT_RUN** | Previous 2/2 fixed-host result remains historical; full live workflow and app acceptance still open |

The first 27-test draft was followed by three reproduced design regressions:
non-idempotent decision retry, identical issuance across owners, and clock-error
revival. After correction, defensive review produced four more failing cases:
expired rejected retries, revocation masking expiry, revocation missing clock
failure, and an unbounded construction-time clock exception. All seven new
discriminators pass after correction. Original failures and drafts are retained.

The historical candidate changes only `retry-settings.mjs` to use an explicit
null/undefined default instead of the original truthy default. It is not silently
replaced with the existing preapproved `??` repair. The reviewed packet preserves
its actual bytes and `RETAINED_OBSERVATION` origin; the original suite still refuses
to run that new preparation. Provider/reviewer identity fields are host assertions,
not independent attestations.

> [!CAUTION]
> **Approval for isolation review is not approval to execute.** Every output says
> `sourceExecuted: false`, `isolationVerified: false`, `executionAuthorized: false`
> and `authorizing: false`. This session performs no filesystem/process/model work.
>
> **Why this matters:** code that looks reasonable can still access files, spawn
> processes or alter tests. The separate execution boundary must be accepted before
> any new candidate runs. Serialized review records remain inspection data.

#### Actual collaborators and parallel package work

- **Claude:** Fable first, then Sonnet, each timed out at 45 seconds; Opus returned
  a usable, tool-disabled design review. Receipt reports `claude-opus-5` and an
  auxiliary Haiku entry. The ladder took 133.549 seconds; reported successful-attempt
  cost was $0.0955115. Failed-attempt usage/cost is unknown, not zero.
- **Daybreak Blue:** defensive source review and final bounded resolution review.
  Clock/retry corrections above were applied and tested by Codex; source review
  is not an additional test run or certification.
- **Luna + OpenCode free:** isolated declaration/package work. One real
  `opencode/big-pickle` packet reached a failing protected TypeScript check because
  its V1 receipt type allowed an extra `outputMode`. The raw packet remains
  **BLOCKED / P1 FAILED**. After inspection, Luna added `outputMode?: never` to the
  V1 branch. Initial generated pre-fix bytes were not retained; do not claim a
  complete original diff. No second packet silently replaces the failed receipt.
- **Codex:** canonical implementation, independent verification and integration
  ownership. No SharedChami request was needed in this slice; earlier actual
  worker contributions remain historical, not newly claimed participation.

The corrected isolated archive contains exactly **24 files: 13 canonical-matching
runtime modules, 10 declaration files and private package metadata**. Codex checked
every installed file against the pinned tarball and reran **five strict TypeScript
consumers and 7/7 fixed injected runtime tests** using installed TypeScript 6.0.3.
These checks performed no installation, model inference or native execution.
Three manually transcribed hashes in the collaborator record were incorrect;
that record is preserved and superseded for acceptance by computed owner evidence.
The later staging `package.json` has a dependency on its own local archive; the
archive's actual metadata does **not**. Do not copy the dirty staging metadata.
This rehearsal does not establish every supported Node version or final package
exports, scripts, native inventory and install behavior. **U02-03 is not integrated
or closed.** Canonical package/type files were not changed by this slice.

**Evidence:** [candidate-review checkpoint](docs/verification/2026-09-12/u02-candidate-review-checkpoint.json).
Raw checks, adverse regressions, all eight mutants, Claude/Daybreak reviews and
the historical packet are in `.build/candidate-admission-DLlc7y/`.
`package-owner-verification.json` there binds the isolated archive, installed bytes,
actual commands and the three incorrect original hash assertions. The immutable
preceding V3 checkpoint remains the baseline for its 98 unchanged files.

**Next critical path:** accept the separate isolation/execution consumer, then
run one exact-byte approved candidate through fresh Swift/Node checks and live
review. In parallel, selectively integrate the reviewed package proposal with
fresh canonical tests; do not copy its entire working directory. Durable history,
evaluated prevention, native app/scheduler, modular extensions and final private
consumer acceptance remain NX-05–09. Legal/publication gates remain NX-10.

### September 12 paired OFF/ON accounting — private acceptance

**Overall roadmap: 30% (3/10). Pure-data accounting checkpoint: PASS SCOPED.**

This is the data-accounting foundation for U02-08 / EV-03, not the live trial
runner or an evaluation of Nisi's product benefit. It does not close NX-04, NX-06,
NX-09 or EV-01–03. The incomplete live pilot below remains incomplete.

```text
Host supplies all paired OFF/ON rows [not independently authenticated]
    → exact record/array shapes; bounded identities and numeric values
    → matching task/baseline/oracle context and paired model/tool/budget settings
    → each arm's outcome names that arm's exact candidate
    → any unknown measurement or incomplete outcome?
        YES → INCOMPLETE; keep every row/reason; metrics = null
        NO  → separate OFF/ON totals; ON-minus-OFF deltas; defined savings
    → deeply frozen independent copies
      measurementVerified = false; causalClaim = false; authorizing = false
```

**Implemented:** `evaluation/intake-v1.mjs`, `evaluation/metrics-v1.mjs`,
`evaluation/paired-trial-v1.mjs`, one explicitly synthetic fixture and two test
files. The entry point is `validatePairedTrialV1(input)`; schema versions are
`nisi-paired-trial-v1` and `nisi-paired-trial-analysis-v1`.

| Verified check | Result | Evidence boundary |
|---|---|---|
| Focused intake/accounting tests | **27/27 PASS** | Included in the portable total; no inference or native app |
| Structural + portable tests | **506/506 PASS**, up from 479 | Zero failed, skipped or cancelled |
| Original collaborator defects | **2/2 expected failing tests reproduced** | Both original drafts retained; not counted as passing product tests |
| Selected broken variants | **13/13 detected** | 27/27 passing control; every variant exited 1 with the same 27-test inventory and named assertion failures; no syntax/import failures, skips, cancellations or timeouts |
| Frozen source | **225 imported files matched; prior 55 checkpoint files unchanged** | No native host or historical source rewrite |
| Source reviews | Fable 5.1 arithmetic review **PASS**; independent six-file review found no concrete defect | Source inspection, not additional test runs or certification |

Important behavior and limits:

- Exact enumerable own data fields only: ordinary record/array getters, sparse
  arrays, custom iterators, extra keys and array subclasses are refused without
  invoking their accessors. Hostile Proxies and altered JS intrinsics are outside
  this boundary. Nested copied output is frozen; caller-owned data is not frozen.
- Up to 256 pairs; case IDs and all run IDs must be unique. Matching fingerprints
  check consistency, not whether the stated tests actually ran or models served.
  Different pairs may use different matched models; that does not make them
  statistically interchangeable or independent tasks.
- PASS/FAIL are observed outcomes supplied by the host. A claimed completion
  followed by FAIL stays an incorrect-completion count, not a discarded row.
  NOT_RUN/ERROR/INCONCLUSIVE and unknown usage/time/repairs suppress all metrics.
- Counts and complete sums must be safe nonnegative integers (not `-0`). No sums
  are computed for incomplete records; individually valid known values remain
  inspectable even if an uncomputed combined total would overflow.
- Deltas are **ON minus OFF**. Token/time savings are **100 × (OFF − ON) / OFF**;
  OFF = 0 gives `null`. Negative and fractional results stay visible. This v1
  reader supplies raw counts, not accuracy rates, confidence intervals, policy
  effect estimates, verified telemetry or a promotion decision.

#### Actual parallel contributions in this slice

| Resource | Delivered work | What Codex accepted or corrected |
|---|---|---|
| **Fable 5.1** | Descriptor-safe intake draft; separate corrected-arithmetic review | Intake integrated after inspection; review PASS/no issues. Both responses report `claude-fable-5-1`, with auxiliary Haiku usage |
| **SharedChami Qwen** | Metrics implementation, job `mac-20260912-181432-bb59385e0bacf67fbfb1901aad8237fd` | Reused the reason/metric structure; corrected wrong-arm accumulation, truncated percentages and partial aggregation before acceptance. Worker reports 46.1 seconds, not native Windows acceptance |
| **OpenCode free** | Fixture-only isolated packet, `opencode/big-pickle` route | Wrapper's syntax/baseline checks passed, but source inspection found nonhex digest placeholders. Reproduced failure, then corrected those placeholders and added one terminal newline in the canonical copy |
| **Independent Codex reviewers** | Six-file source review; isolated targeted mutation work | No shared canonical writers; final integration remains with Codex |

The original larger worker/packet failures remain retained in the preceding host
checkpoint. Smaller successful assignments do not relabel those attempts as PASS.
The new two-call Claude reported cost subtotal is **$0.31243375**; OpenCode and
SharedChami tokens/cost are unknown. This is not whole-development spend or savings.
The exact `louisaurorar12` approval is supplied through the dispatch process's
environment for this task only; no persistent trusted-server setting was changed.

> [!CAUTION]
> **A correct calculator is not a successful benchmark.** The fixture's apparent
> 50% token and 25% time savings are invented test inputs, not Nisi measurements.
>
> **Why this matters:** a live comparison must collect every attempted run, use
> matched predeclared conditions and independently assess the exact candidates.
> Valid hashes, schema checks and a reviewer PASS cannot establish those facts.

**Source-bound evidence:** [paired accounting checkpoint](docs/verification/2026-09-12/u02-paired-accounting-checkpoint.json)
records 61 exact source/test/package hashes, all tests, source-review/model
receipts and the preserved system-equation tail. Raw evidence and untouched
collaborator outputs are retained under `.build/evaluation-contract-l5NSvq/`;
the original OpenCode work copy is `.build/opencode-evaluation-fixture-Jwhi7L/`.
The targeted harness and all copied variants are retained under the former path;
none writes canonical source. These selected mutants are not exhaustive coverage.

### September 12 V3 protocol integration — private contract acceptance

**Overall roadmap progress: 30% (3/10). This transport-integration slice is
accepted; NX-04/U02-02 and the full merger remain open.**

Nisi can now explicitly select a native local API or chat-completions API for
each author/reviewer role, without pretending the protocols provide identical
evidence. This implements the preceding V3 work order, not new-candidate
execution permission or a completed live demonstration.

```text
Explicit author + reviewer selections
    → exact per-protocol fields; frozen task/configuration/approval identity
    → separate native or chat owner for each role
    → host-seeded baseline → checks → model repair response
    → returned bytes match the existing registered repair?
        NO  → retain response; INCOMPLETE; no new execution/reviewer
        YES → fresh checks → bound review → consistency receipt
    → separately retain each owner's lifecycle and unknown completion/usage

All four role pairings above: synthetic contract tests PASS
Real V3 workflow: NOT_RUN at this checkpoint
```

| Implemented component | Tested responsibility |
|---|---|
| `hosts/repository/live-model-selection-v3.mjs` | Pure exact role validation, numeric loopback endpoints, explicit native instance/profile/reasoning or chat output mode; no automatic protocol inference |
| `hosts/repository/reviewed-live-model-v3.mjs` | Separate V3 issuance, configuration/approval domains, captured request bindings, per-role owners, cancellation/expiry/overlap refusal and exact registered-candidate admission |
| `receipts/repository-live-model-run-v3.mjs` | Protocol chosen from consent-bound configuration; exact counters/provenance, native completion uncertainty, aggregate lifecycle and host/task/candidate/proposal consistency |
| `examples/repository-live-model.mjs` | Paired API selectors and per-role options; invalid combinations refused before effects; omitted selectors keep the legacy route |
| Three new test files + fixtures/helpers | 27 lane/engine tests, 25 receipt tests and 19 CLI/data tests, including all sixteen inspected OpenCode cases against the actual parser |

The new pure `inspectLiveModelCallV3()` seam validates data consistency only.
It does not create issued execution evidence. Configuration, approval and outer
live-run domains are V3-specific; the final-report digest keeps the established
V1 domain for the unchanged repository report contract. V1/V2 production
modules were not rewritten; their existing regression tests still pass.

**Final checks:** 817/817 portable tests, including the 71 focused V3 tests;
2/2 real fixed-fixture Swift/Node host tests; 225 imported files match the frozen
manifest. No skips, cancellations or todos in these test runs. Eight selected
faults are detected by assertion failures after a 71/71 control. This is targeted
discrimination, not exhaustive mutation coverage or native-app acceptance.

**Corrections and adverse evidence retained:**

- The first integrated receipt draft failed cancellation/lifecycle validation
  (32/33). Direct semantic tests then exposed zero-output, cap-hit and
  negative-zero-reasoning defects (48/52). Corrected result: 52/52.
- CLI integration began with three prescribed positive cases failing against
  the old parser (68/71); explicit V3 parsing corrected all three.
- Daybreak found a reporting gap: unknown aggregate tokens still carried a
  computed-total provenance label. The new regression failed (70/71); the
  correction keeps both total and provenance `null`. Complete controls preserve
  the derived-counter label and per-role sources.
- The first fault-harness setup stopped at an ambiguous eighth mutation target.
  After targeting the exact assignment, seven faults met the assertion criterion;
  the eighth produced a specific runtime test failure. An explicit `doesNotThrow`
  assertion now states that cancelled lanes must retain readable incomplete
  receipts. All eight then meet the strict assertion-based criterion. Neither
  earlier run was relabeled as complete acceptance; no product guard was weakened.

| Parallel resource | Actual contribution and boundary |
|---|---|
| **Claude first: Fable → Sonnet → Opus** | All three bounded design attempts timed out; no usable review. Receipt is NOT_RUN, not PASS; actual usage and served identity are unknown |
| **SharedChami Qwen** | One completed source-excerpt review, job `mac-20260912-204425-050747a40984690b9f5e39713cda8031`; reported `Qwen3-Coder-Next 80B-A3B Q4_K_M`, 31.1 s worker time. No concrete issue found in the provided excerpts, not full-source or Windows native acceptance |
| **Daybreak** | Isolated receipt draft, reviewed before integration; later found the null-provenance defect and reviewed its correction. Codex owns fixes and verification |
| **OpenCode** | One successful isolated explicit free-route packet (`opencode/big-pickle`, requested identity), 43,197 ms including wrapper work; sixteen JSON cases, protected expected arrays and 17/17 owner fixture checks. Only the data and expected arrays were adopted after inspection; all sixteen now pass against the production parser |
| **Independent Codex review** | Final bounded CLI/selector/data review found no concrete issue; no extra model or test runs claimed |

SharedChami's exact `louisaurorar12` trust override was task-only. No saved
settings, credentials, model installations or public artifacts changed. Worker
source copies match the current selection/lane files, but the request included
only selection lines 6–36 and lane lines 25–137 plus contract context. Returned
advice is not execution authority. A separate local reviewer's proposed
trailing-newline regex concern was disproved by literal JavaScript probes and
withdrawn; it is retained as a false positive, not a product defect or fix.
Collaborator usage/cost is unknown unless explicitly present in its receipt.

> [!WARNING]
> **A tested transport contract does not authorize executing new model code.**
> The previously observed native candidate still differs from the registered
> repair. No new V3 inference, source execution, live review or application of
> that candidate occurred in this slice.
>
> **Why this matters:** valid JSON and matching fingerprints do not prove code
> is safe or correct. The next boundary must bind inspected bytes, containment,
> execution permissions and fresh results without substituting a known repair.

> [!CAUTION]
> **Unknown measurements and completion remain unknown.** Native termination
> remains `NOT_REPORTED`, server completion is not attested, remote inference
> stop is `NOT_OBSERVED`, and incomplete token totals/provenance remain `null`.
>
> **Why this matters:** readable results and settled client transports cannot
> establish server termination, real model identity, savings or coding accuracy.

**Next dependency:** separately define and test candidate admission/isolation,
then attempt one explicitly approved combined Swift/Node/live-review workflow on
the exact admitted bytes. Continue durable history, evaluated prevention, native
app/scheduler, modular extensions and private consumer acceptance in NX-05–09;
the release-control gate remains NX-10. Do not narrow the merger to this slice.

**Source-bound evidence:** [V3 checkpoint](docs/verification/2026-09-12/u02-live-v3-checkpoint.json).
It pins 98 source/test/package files, the unchanged previous checkpoint, final
checks, original adverse outputs and actual collaborator receipts. Raw work is
retained under `.build/live-v3-8SuLKU/`; the original OpenCode packet is
`.build/v3-cli-cases-edGNs9/`. Only one terminal newline was added to its JSON;
the expected-case helper is byte-identical. The historical equation tail remains
unchanged. No publication or completion claim is implied.

### September 12 native runtime adapter — first task-sized response

**Overall roadmap progress: 30% (3/10 NX milestones).** NX-04 and the complete
Veritas merger remain open. This slice connects a real native model operation to
Nisi's task/candidate contracts; it is not a released product or completed repair.
Evidence: [native-adapter checkpoint](docs/verification/2026-09-12/u02-native-chat-checkpoint.json).

| Component | Accepted scope |
|---|---|
| `adapters/native-chat-protocol-v1.mjs` | Separate exact native response profile; one message, exact expected instance, valid reported counters, no storage/tool/reasoning output |
| `adapters/native-chat-v1.mjs` | Loopback-only `/api/v1/chat`; explicit reasoning OFF, storage OFF and no integrations; immutable task/candidate binding; bounded requests and owned cancellation/quarantine |
| Engine compatibility | Real Nisi engine with injected responses completes draft → failed synthetic check → repair → fresh synthetic checks → review; no real inference in this test |
| OpenCode dataset | Twenty inspected envelope cases, now run against the actual native reader; static owner oracle remains separately retained |
| Compatibility | All previous 82 source files unchanged; no legacy receipt, parser or lane contract rewritten |

**Final verification:** 746 portable tests passed, including 72 focused checks
(51 adapter/engine tests + 21 dataset/reader tests). Two real Swift/Node host tests
passed again. Eight selected mutants were detected after a 72-test passing control.
No skips, cancellations or todos. The entire earlier native-app/native test matrix
was not rerun. The 225-file import still matches its retained freeze.

**Adverse evidence kept:** the first 50-test run had six failures: four null
configuration limits incorrectly selected defaults; negative-zero usage was
accepted; an overlapping call was mislabeled as quarantine instead of busy.
All were corrected. An initial mutation run detected 6/8 faults: tests did not
explicitly attempt reuse after late settlement or assert that remote inference
stop remains unobserved. Those assertions were added; final detection is 8/8.
Original drafts, failing results and copied mutants remain in `.build/native-chat-uGeaKs/`.

**Actual operation:** `9d21cc3d-a741-4107-97c9-4d4c6f6d674b`, retained in
`.build/native-chat-uGeaKs/operation-lwyKbD/`. One Qwen request returned
`REPAIRED` in **12,093 ms**, with reported **748 input / 186 output / 0 reasoning**
tokens. The total **934** is explicitly derived from the two reported counters.
The model replaced the falsy-default expression with an explicit null/undefined
check. Its candidate fingerprint is
`a3a713ec43002762c434692e43dff8aed858a5c8fba650d32b6352d0422580c4`.
It differs from the preapproved reference using `??`; this run did not register,
execute, review or apply that new candidate. The baseline was not reexecuted in
this operation probe and no old stage results were fabricated as fresh evidence.
The local owner settled to IDLE with zero pending transports; remote inference
stop remains NOT_OBSERVED.

> [!WARNING]
> **Valid structured output is not verified repair or server completion.**
> The native API does not document the legacy `finish_reason` field. This profile
> records `termination: NOT_REPORTED` and `serverCompletionAttested: false`.
>
> **Why this matters:** complete JSON below a reported token cap can pass shape
> checks without proving correctness, natural model termination or stopped remote
> inference. The next host must retain this distinction and separately admit/test
> the exact candidate; it must not forge a legacy `stop` value or replace the
> returned candidate with a known passing repair.

The request profile follows the current [LM Studio native API documentation](https://lmstudio.ai/docs/developer/rest/chat).
Model-instance equality is a reported identity check, not authenticity attestation.
Storage OFF requests no chat continuation storage; it does not claim all server
logging is disabled. No token/time savings or comparative accuracy is established.

**Actual parallel collaboration:** Fable, Sonnet and Opus design attempts all
timed out; no usable Claude design response or known usage was returned. The
approved SharedChami fallback returned `NO_CONCRETE_ISSUES` on a pinned early
protocol draft via `Qwen3-Coder-Next 80B-A3B Q4_K_M` (10.6 seconds reported worker
time). That draft predates the negative-zero correction and usage-source labels;
its review was not relabeled as a final-source review. Daybreak independently
reviewed the corrected production modules. OpenCode's first explicit free-route
packet (`opencode/big-pickle`, requested identity) completed in 47,080 ms including
wrapper work. Its served identity, usage and measured cost remain unknown.
Codex inspected, integrated and verified the exact final source. No publication,
credential change, restart, download or persistent trust-setting change occurred.

**Next implementation, without narrowing the merger:**

- [x] Separate native response, ownership and workflow-adapter contracts.
- [x] Negative/regression checks, independent review, targeted faults and actual-reader dataset.
- [x] One task-sized native repair response, retained without executing its source.
- [x] V3 live lane/receipt/CLI: explicit per-role transport, expected instance,
  profile/usage provenance and approval identity; preserve V1/V2 behavior exactly.
- [ ] Preserve refusal of unregistered returned bytes; implement a separate explicit
  candidate-admission/isolation path before testing a new model-produced variant.
- [ ] Complete one combined Swift/Node/live-review workflow on the exact admitted
  candidate; no automatic substitution, after-the-fact success or guessed stop state.
- [ ] Continue history, evaluated prevention, native app, modular extensions,
  package/consumer and full-product acceptance in NX-05–09. Legal/release gates remain NX-10.

#### V3 integration work order — keep protocol differences explicit

The independent contract review identified this bounded implementation sequence.
The first seven items are now contract-tested in the newer V3 checkpoint above;
new-candidate admission remains separate and open. Codex owns
canonical integration; bounded collaborators can review the independent contracts
and draft synthetic data in isolated copies.

- [x] Add separately issued V3 live-lane and receipt readers with new configuration,
  approval and run-fingerprint domains. Preserve V1/V2 request bytes, fingerprints,
  readers and receipts; reject cross-version issuance.
- [x] Require exact per-role `NATIVE_API` or `CHAT_COMPLETIONS` configurations.
  Native roles explicitly bind endpoint, requested model, expected instance,
  supported profile and reasoning OFF. Chat roles explicitly bind output mode.
  Reject inapplicable fields and duplicate requested models; two native roles
  must also use different expected instances. Names still do not attest identity.
- [x] Freeze both role selections before dispatch. Bind complete selections,
  storage/integration requests, receipt versions, budgets, transport provenance
  and task/suite/source identities into approval. Changed settings require a
  different approval identity; getters or caller mutation cannot alter dispatch.
- [x] Give each role its protocol-appropriate transport owner. Check both before
  dispatch; revoke both on cancellation/expiry. Preserve one-shot lane state,
  run binding, post-result guards and retained refusals. Report each lifecycle
  and the aggregate pending count without claiming remote inference stopped.
- [x] Validate each model receipt against the consent-bound role protocol, not
  a self-selected receipt schema. Keep exact success/refusal shapes and native
  `NOT_REPORTED` termination. Recompute native totals from reported counters;
  refuse provenance/counter tampering, negative zero, fractions and overflow.
- [x] Extend the CLI with paired explicit API selectors and per-role parameters.
  No selectors retains legacy behavior. Reject mixed/incomplete configuration
  before build, materialization or network. Injected role transports label the
  whole V3 run synthetic, including mixed-protocol tests.
- [x] Add discriminating regressions for compatibility, consent changes, wrong
  instance/profile, cap hits, reasoning/tool output, cancellation in either role,
  replay/concurrency, receipt downgrade/role swaps, usage provenance and inert
  CLI preflight. Keep existing exact registered-candidate execution checks.
- [ ] Separately define/review the candidate-admission and isolation boundary.
  V3 transport integration alone must not permit arbitrary model-returned code
  to execute or enlarge the existing approved fixture scope.

### September 12 explicit output modes — compatibility and runtime results

**Overall roadmap progress: 30% (3/10 NX milestones); NX-04/U02-02 remains open.**
This implements the prior compatibility follow-up without relaxing accepted
response shapes, candidate pins, consent, budgets or model independence.
Evidence: [output-mode checkpoint](docs/verification/2026-09-12/u02-output-mode-checkpoint.json).

| Change | Implemented behavior |
|---|---|
| Legacy calls | Omitted `outputMode` keeps original strict-schema request bytes and schema-1 adapter receipts |
| Explicit adapter mode | `json_schema` or `json_instruction`; either explicit choice produces schema-2 receipts with its mode on success and refusal |
| Instruction mode | Omits only `response_format`; same JSON instructions, exact-key/duplicate-key parsing, model/finish/usage checks; no reasoning extraction or fallback |
| Versioned live lane | V2 requires author and reviewer modes separately; both are frozen and included in configuration/approval identities |
| Versioned evidence | V1 and V2 original-issued readers are distinct; V2 binds each receipt to its own role's mode and rejects downgrade/tampering |
| CLI | Both `--author-output-mode` and `--reviewer-output-mode` must be supplied together; no flags retains V1 behavior |
| OpenCode contribution | Exact 12-case JSON response matrix integrated after inspection; 26 fresh canonical checks cover both modes |

**Verification:** 674 portable checks passed (71 added since the 603 checkpoint),
including 149 focused checks; two real Swift/Node host checks passed. No test skips,
cancellations or todos. Eight selected faulty implementations were detected after
a 71-test passing control. This is targeted, not exhaustive, mutation coverage.
Retained raw results live in `.build/output-mode-snv3qc/`.

An independent reviewer found a new accessor edge case: reading `outputMode`
repeatedly could select instruction-mode requests but label their receipts as
legacy schema 1. The new option is now captured exactly once. The focused getter
regression failed before correction and passed afterward. Separate golden hashes
from the retained pre-change adapter verify draft/repair/review wire compatibility.
The first mutation receipt classified 7/8 as assertion-backed; the remaining
wrong-reviewer-mode variant was refused by a binding error. An explicit valid-pair
assertion now makes that failure discriminating too; the final run records 8/8.
Both results remain retained. One new test initially read a stage's attempt from
the wrong location; it was corrected to the existing `stage.evidence.attempt`.

**Second real repository attempt:** run `05a7f3d6-f2e3-461d-bdd8-481fa0724330`,
`.build/repository-live-demo-q33F3l/`. Both modes were explicitly
`json_instruction`; author `qwen/qwen3.8-27b`, reviewer `openai/gpt-oss-20b`.
The baseline ran and failed as expected. The sole author call timed out at
90,002 ms; total workflow 90,316 ms, setup 2,577 ms. Result **INCOMPLETE**,
engine **BLOCKED**, no reviewer request, accepted repair or applied changes.
Token usage is unknown. Native execution owners settled and returned IDLE;
the model transport owner remained QUARANTINED with zero pending local transports.
Later runtime inventory reported the model IDLE; this does not rewrite the failed
run or turn `remoteInferenceStopped: NOT_OBSERVED` into an attestation.

> [!WARNING]
> **Full-task model compatibility is unresolved.** The successful tiny
> JSON-instruction diagnostic did not establish a successful repository repair.
>
> **Why this matters:** a runtime can answer a small prompt yet spend the full
> task budget without an accepted final answer. Keep both failed attempts, do not
> substitute the known repair, reset quarantine or claim token/time savings.

**Bounded next-route investigation:** official [LM Studio native chat API
documentation](https://lmstudio.ai/docs/developer/rest/chat) defines per-request
`reasoning` and `store` controls. One synthetic loopback-only probe selected
`reasoning: "off"`, `store: false`, `integrations: []`, 128 output tokens and a
30-second timeout. It returned only the requested `{"ready":true}` message in
660 ms; reported 34 input, 6 output and 0 reasoning tokens, no response ID.
No repository data, runtime-setting edit, model restart/download or tool call was
involved. This is **PASS_TINY_DIAGNOSTIC**, not an integrated native transport.
The native API has a different response contract: do not synthesize a successful
chat-completions `finish_reason` or promote reasoning text to bridge that gap.

**Actual collaborators this pass:** Fable was attempted first but exceeded its
45-second cap (no usable result). Sonnet supplied a design response and passed the
implementation review; known reported subtotal **$0.121433**, excluding unknown
failed-call/other-provider usage. Independent Codex review found the accessor bug.
OpenCode's explicit free route (`opencode/big-pickle`, requested identity) finished
its first packet in 25,627 ms including wrapper work. Its exact data and owner
checks were inspected and rerun on the final canonical source. Served-model
identity, token usage and measured OpenCode cost were not exposed. No publication.

**Next private implementation order:**

- [x] Explicit immutable output modes, V2 lane/receipt/CLI and legacy wire checks.
- [x] Canonical response matrix, lifecycle parity, fresh native checks and targeted faults.
- [ ] Specify a separate native-runtime adapter: documented reasoning control,
  response termination/truncation semantics, actual instance binding, usage,
  no storage/integrations, timeout/drain and no fabricated compatibility fields.
- [ ] Test that adapter with strict negative controls and an operation-sized
  response before another bounded full repository demonstration.
- [ ] Add the new option to the isolated TypeScript/package proposal and rerun
  an exact-source consumer; prior archive results remain historical, not current.
- [ ] Continue NX-05's per-stage history bridge: distinguish execution-qualified
  test failures from model-transport diagnostics, preserve fixture provenance,
  stable source-slot replay/conflicts and project isolation. Retained-ledger
  integration is planning input only; do not change the frozen 225-file import.

### September 12 live repair contracts — first private runtime attempt

**Overall roadmap progress remains 30% (3/10 NX milestones).** This closes a
bounded implementation/testing slice, not NX-04/U02-02 or general generated-code
execution. Exact source-bound evidence is in the
[live-contract checkpoint](docs/verification/2026-09-12/u02-live-contract-checkpoint.json).

| Area | Before this slice | Current verified state |
|---|---|---|
| Reviewed live fixture | Planned | Five raw source pins checked before issuance; neutral A/B comments, exact one-operator correction; old fixtures preserved |
| Model participation | Fixed callbacks only in repository host | One-shot host seed, repair and different-model review interfaces; original-issued lane identity, budgets, consent and exact candidate bindings |
| Refused output | No dedicated live lane | Valid but late/unregistered output retained as data; never registered or executed to manufacture success |
| Live receipt | Planned | Exact report topology, task/seed/result bindings, model receipt inventories, original execution contexts and fully recomputed proposal |
| Explicit private command | Planned | Opt-in CLI, pinned fixture only, no apply-back; independent evidence retention and bounded settlement observation |
| Verification | 506 portable tests | 603 portable tests; 97 focused; 2 real combined-host tests; 12 selected mutants detected after an 85-test passing control |
| Real model demonstration | NOT_RUN | INCOMPLETE: one Qwen repair request; empty final content refused; reviewer NOT_RUN |

**Observed live attempt — not a benchmark:** run
`4061a9a8-9656-470c-ac85-defad52e7aee`, retained privately under
`.build/repository-live-demo-pxIdpE/`.

```text
Host-seeded reviewed A [NOT model drafting]
  → 4 real Swift checks PASS
  → real Node behavior checks FAIL as expected: 8/10 assertions passed
  → local Qwen repair request
  → LOCAL_CHAT_EMPTY_RESPONSE
  → BLOCKED engine report + INCOMPLETE live receipt
  → host settled; both execution owners IDLE
  → no new source executed, no reviewer call, no proposed change
```

Selected author: `qwen/qwen3.8-27b`; selected reviewer:
`openai/gpt-oss-20b`. Only the author was called. Observed setup duration was
2,540 ms; workflow duration 10,002 ms; author adapter duration 9,616 ms. These are
one-run observations, not matched OFF/ON speed measurements. The failed adapter's
usage is **unknown**, not zero. A supplemental runtime-log entry shows empty final
content and a reasoning field, but its reconstructed request hash does not match
the retained request hash. Do not merge that log's token counts into this run or
promote reasoning-channel text into an accepted answer. The exact backend cause
and compatible final-output configuration remain to be established.

**Bounded compatibility follow-up:** two tiny local requests used the same Qwen
model, fixed prompt, temperature and 128-output-token cap. Strict `json_schema`
mode returned empty final content; the plain JSON-instruction request returned
the requested `{"ready":true}` object. The responses and requests have separately
retained hashes/metadata in `.build/live-repository-Gvvfft/channel-probe-RLe5A5/`.
No repository content, tools, model load/restart or runtime-setting change was
involved. This narrows the suspected issue to the structured-output request path
for this observed model/backend pairing; it is not a successful repository repair
or proof about every provider. The next implementation should explicitly bind the
selected request-output mode while retaining the same strict client-side parser,
schemas, candidate admission and evidence checks. No silent fallback is approved.

#### Warnings found, corrections and verification limits

- **Overlapping calls could revive a failed lane.** A failing-before regression
  demonstrated the earlier pending response restoring `REPAIRED`. The post-result
  phase guard now keeps failure terminal while preserving the returned data.
- **Rehashed reports could reorder verification or disguise task/seed identity.**
  Nine negative cases demonstrated three defect families: stage topology, seed
  evidence bindings and task metadata. Exact checks now refuse them. Identical
  tests changed from 39 pass/12 fail to 51/51 pass; the 12 include three parent
  table failures, not 12 distinct bugs.
- **Evidence-write failure could skip host settlement.** Collection now attempts
  settlement independently of report-file retention and preserves separate
  diagnostic failures. Portable inert-owner tests cover write errors, rejected
  settlement and an owner that never resolves.
- **Unknown shutdown must not become success.** A bounded observation timeout
  records `LIVE_DEMO_HOST_SETTLEMENT_UNCONFIRMED`, never a fake closed worker.
  Candidate workspaces remain retained; there is no forced `process.exit`.
- **Final diagnostic errors and interruption.** Final writes are independently
  guarded; failed summary persistence returns an adverse in-memory result. Checks
  after awaited preflight/build retention prevent subsequent work after an
  observed interrupt. Sonnet reviewed these fixes; full main-command interruption
  and summary-write fault injection are still NOT_RUN, not covered by the 12
  preflight/inert-owner tests.
- **Mutation coverage initially missed a late-expiry error.** The first reviewed
  harness detected 11/12 selected faults. The missing assertion now verifies that
  expired repairs cannot reach fresh checks; the unchanged implementation passes
  and all 12 faults are detected. Keep both attempts.

> [!WARNING]
> **The runtime compatibility gate is still open.** Empty final content is a
> refused answer, not an accepted repair. The real reviewer, repaired-candidate
> checks and completed live-model proposal have not run in this attempt.
>
> **Why this matters:** passing contract tests proves the tested refusal and
> accounting behavior, not that the selected local model/backend combination can
> complete this workflow. Diagnose the final-answer protocol before another
> bounded attempt; do not weaken validation or substitute the known repair.

#### Actual parallel participation

- **Fable 5.1** supplied the usage-accounting draft. A separate larger Fable
  review exceeded its 45-second cap and produced no usable review.
- **Sonnet 5** reviewed the private CLI, raised three issues, then reviewed the
  corrections with PASS. Known reported cost across the successful Claude calls
  is **$0.31371825**; the timed-out review and other lanes do not have complete
  token/cost accounting. This is not whole-development cost or savings.
- **SharedChami Qwen** completed a bounded review in a reported 54.1 seconds,
  job `mac-20260912-184642-fb06c0d36942971899ff4a80ba6b1bd4`. Its suggested removal
  of post-response consent checks was rejected because it would admit expired
  work and lose refused data. Completed participation is not an accepted finding.
  `louisaurorar12` was supplied only through this task's dispatch environment;
  persistent trust/security settings were not changed. No Windows native
  acceptance is claimed.
- **OpenCode free** attempted an isolated typed-consumer packet through
  `opencode/big-pickle`; it reached its 240-second cap without creating the
  requested file. Its receipt remains BLOCKED/P1 FAILED. The later consumer has a
  different filename and is Codex-authored; served-model identity/usage are unknown.
- **Independent Codex lanes** drafted fixture/lane/receipt/CLI tests and an
  isolated package proposal. Luna found the three receipt defects above. Luna's
  first mutation harness ran before integration-owner review, used the wrong
  scratch root for receipt tests, lacked a passing control and retained no result
  file; its claimed detections are excluded. The reviewed replacement retains
  the control, each exact variant and full outputs inside the canonical private
  checkout. Codex remains the sole canonical writer/acceptance owner.

#### Parallel private packaging proposal — not yet integrated

The isolated proposal at `.build/private-consumer-proposal-9gT8nc/PROPOSAL.md`
contains ten declaration files and strict consumer examples. Review found and
corrected three proposal-only mismatches: candidate-bound nullability, normalized
candidate metadata accepted as raw input, and a transport type that excluded
synchronous injected responses. Two declaration files changed; runtime code did
not. The original archive remains retained, and an unchanged-regression-fixture
compile against it exposes the nine new expected-error cases.

The corrected isolated rehearsal at
`.build/private-consumer-proposal-9gT8nc/declaration-fixes-vxxpC4/rehearsal-result.json`
reports **four strict compile consumers, 26 expected negative diagnostics and
7/7 fixed/injected runtime tests**. It produced a separate 24-file local archive
and installed it offline with lifecycle scripts disabled. These are separate
from the canonical 603-test suite. No package was published and no
canonical exports or declarations were changed by this proposal.

Before integration: review declaration accuracy; inventory supported wildcard
deep imports; preserve the Apple adapter's current three-host-module dependency
closure; establish clean type-dependency provisioning and Node 22 verification.
Keeping `./*` in exports does not preserve a deep import if the archive omits its
file. U02-03 remains open.

#### Next critical-path slice: complete the bounded live demonstration

The read-only host analysis found the existing local-chat adapters reusable; no
new model transport is needed. Implement the following in order, with independent
package/history work remaining parallel-ready:

- [x] Prepare a separately inspected A/B fixture with identical neutral comments
  and only the intended `||` → `??` correction. Preserve existing accepted fixtures.
  Freeze the whole tree's review manifest **before** inference and registration.
- [ ] Use a clearly labeled host-seeded draft A, then real Swift + Node failure,
  live author **repair**, fresh checks and a distinct live reviewer. Edit mode
  always calls `draft`; passing an options candidate does not seed that mode.
  Do not call this live drafting or count the fixed seed as a model call.
- [x] Reject every unregistered returned byte sequence before executing it; never
  normalize, replace or auto-register model output to force it into approved B.
  General generated-code isolation remains a separate required product gate.
- [x] Freeze exact source/task/preparation identities and bind call budgets,
  model selection and consent before any generation, compilation or execution;
  recheck approved scope immediately before each dispatch. Reuse existing scoped
  consent. No model downloads, runtime restart, cloud fallback or expanded access.
- [x] Add a separately versioned live-model receipt binding stage provenance,
  run/task/attempt/candidate, request/response identity, configuration, approval,
  model receipts, exact report and final repository bundle. Reject missing, extra,
  stale, duplicate or reordered participation; keep existing bundle v1 unchanged.
- [ ] Retain every attempted call and unknown usage. Separate setup, workflow,
  model and settlement timing. Settle both process owners and the transport owner;
  HTTP settlement is not proof of remote inference stopping. Failed persistence
  blocks a reproducibility claim. Emit a proposal only—no apply-back or publication.
- [ ] Diagnose the empty-final-content compatibility result using bounded,
  source-attributed protocol evidence. Add explicit supported provider behavior
  and regression tests if needed; never accept hidden reasoning as final output,
  change shared runtime settings silently, auto-register B or erase the failed run.
  The tiny two-mode probe above now provides a concrete next implementation:
  explicit output-mode configuration with unchanged post-response validation,
  followed by one separately recorded repository attempt if its tests pass.
- [ ] Finish main-command interruption/storage fault injection; retain any
  unresolved worker/transport state separately from the final engine report.

Expected bounded sequence: **host-seeded A → real FAIL → live repair B → fresh
real PASS → separate live review → evidence bundle + unapplied proposal**.
Even successful execution of that allowlisted slice does not close U02-02/NX-04's
general isolation requirement, native app acceptance or the matched live benchmark.

### September 12 combined Swift/Node host — private acceptance

**Overall roadmap: 30% (NX-01–03 of 10 closed). This bounded host checkpoint is
accepted; NX-04 and U02-02 remain open for the complete repository demonstration.**

The first combined host now runs the retained fixed Swift checker over all four
declared fixture files, then executes the source-reviewed Node behavior harness.
A baseline with the known zero-retry defect fails 2 of 10 assertions. One fixed
repair produces a new task-owned tree, four fresh Swift checks, and 10/10 Node
assertions passing. Fixed author/reviewer callbacks complete the workflow; they
are not independent model inference or a live coding benchmark.

```text
Registered baseline/candidate + fixed test suite and runtime configuration
    → 4 real Swift checks → real Node FAIL (8/10)
    → one fixed repair → fresh tree
    → 4 fresh Swift checks → real Node PASS (10/10)
    → fixed review → immutable engine report
    → wait independently for BOTH execution owners
    → original-issued evidence + exact configuration/binding checks
    → inspectable bundle + one-file proposed change [NOT APPLIED]
```

| Acceptance lane | Current result | What it establishes |
|---|---|---|
| Portable structural/test command | **479/479 PASS** | Up from 446; zero failed, skipped or cancelled |
| New combined-host/bundle/proposal tests | **33/33 PASS** | Included in 479; lifecycle, traceability, refusals and synthetic interruption cases |
| Fixed Swift + combined repository native suite | **25/25 PASS** | Includes two combined real-process tests; not the macOS app |
| Selected broken variants | **12/12 detected** | Passing control; exact named failures; no syntax/import false passes, cancellations or skipped tests |
| Retained Veritas import | **225 files matched** | Frozen imported bytes unchanged |
| Prior 47-file Node checkpoint | **46 unchanged + one additive field** | Node adapter exposes its configured registration fingerprint; exact remaining bytes unchanged |
| Live models / native app / durable reopen | **NOT_RUN / NOT_RUN / NOT_IMPLEMENTED** | These still block the full demonstration, not private development |

Implementation and fixes:

- `createReviewedRepositoryHostV1` constructs real, fixed Swift and Node owners.
  The internal injected-owner seam is only a trusted test seam, never execution
  proof. A one-shot run cannot admit unregistered candidate code.
- Original preparations, plans and Node executions bind run, task, attempt,
  candidate, baseline and full materialized tree. The bundle also binds the
  host-selected Node suite and executor registration, including when tests never
  dispatch. Serialized objects do not become original-issued evidence.
- A synchronous settlement failure no longer prevents waiting for the other owner.
  Invalid history or a throwing diagnostic cannot erase the other owner's partial
  evidence. Separate settlement/history/state errors quarantine the host and
  suppress a complete bundle/proposal. Failing-before-fix runs are retained.
- Raw check outcomes, host readiness and final engine outcome remain distinct.
  Real checks can pass while a later review times out; that run produces no
  accepted proposed change. Storage failure also remains distinct from workflow
  completion. Unknown drain is not converted into successful cleanup.
- Fable's proposed-change implementation was integrated with exact identities and
  outcome gates. Its follow-up linkage helper/tests bind the precise bundle and
  report digest into the proposal fingerprint. Byte contents, additions and
  modifications are preserved; no checkout changes are applied.

**Source-bound evidence:** [combined host receipt](docs/verification/2026-09-12/u02-combined-host-checkpoint.json).
Raw checks, regression failures, mutations, prompts and model responses are retained
under `.build/combined-host-eVIeM7/`. A complete-source control and native rerun match
the same 55-file checkpoint. The receipt is engineering evidence, not certification.

#### Parallel collaborators and next assignments

| Resource | Substantial assignment | Actual result / boundary |
|---|---|---|
| Fable 5.1 | Host design, proposed-change implementation, lifecycle test design, report-link helper and tests | **Four usable deliverables**; reported `claude-fable-5-1`. Three larger/review attempts timed out and remain NOT_RUN |
| Claude Sonnet | Matched-evaluation arithmetic and failure-case critique | Returned; useful tests retained, incorrect suggestions rejected |
| Claude Opus | Host settlement source review | Returned; partial-evidence weakness reproduced and fixed |
| Internal reviewers | Evidence/configuration review, bounded mutation harness and final scope review | Findings incorporated; final review found no concrete remaining defect in its four-file scope. A later Daybreak call was unavailable, not silently counted as a review |
| OpenCode local / free | Three-file isolated evaluation packet | Both 300-second edit attempts timed out; no target source created, no force/replay or acceptance claimed |
| SharedChami Qwen | Complete pure OFF/ON evaluation-validator draft | **Returned**, job `mac-20260912-180044-af354c36bb3f80b2d9f3281bc80a6356`, 220.7 seconds reported. Draft rejected by inspection pending corrections |
| SharedChami GPT-OSS | Separate evaluation fixture and adversarial tests | **ERROR/TIMEOUT**, job `mac-20260912-180418-745a31d9d018c8141fd3263e27e16f26`, 300 seconds reported; no test deliverable or acceptance |
| Codex / Mac | Canonical integration, safety fixes, native execution, deterministic acceptance and documentation | Sole canonical writer; accepts collaborator output only after inspection and tests |

SharedChami receipts are retained as `sharedchami-paired-validator.json` and
`sharedchami-evaluation-tests.json` in the checkpoint directory. The current
worker transport validates the requested model alias and exact job ID. It does
not provide token telemetry, cryptographic model attestation or native test proof.
Do not resend an unresolved job. Both jobs above now have terminal responses.

The successful Claude calls report a known subtotal of **$0.7884465**; failed-call
usage is unavailable, and this is not total project cost, a weekly allowance
measurement or evidence of savings. SharedChami's response does not report tokens.

> [!CAUTION]
> **SharedChami's validator draft is not accepted production code.** Inspection
> found incomplete descriptor checks, missing `.code` errors, acceptance of `-0`,
> incomplete Unicode/overflow checks and a shallow-freeze defect. Correct and test
> those before importing it; do not convert successful inference into code acceptance.
>
> **Why this matters:** the comparison must preserve adverse and unknown results;
> a faulty validator could manufacture a misleading token/time/quality report.

The smaller evaluation assignments have since returned and been integrated with
corrections; see the newer paired-accounting checkpoint above. Fable supplied the
intake, SharedChami supplied the metrics draft, and OpenCode supplied the fixture;
the earlier GPT-OSS timeout was not silently retried or counted as contribution.
Private API/package declarations, durable history and the approved live-model
repository demonstration remain the next independent work on the same full merger.
No live generated code, native app, sandbox, descendant containment, durable resume,
policy effectiveness, public release, patent clearance or full merger is established.

### September 12 asynchronous Node behavior host — private acceptance

**Historical checkpoint:** superseded by the combined-host acceptance above;
retain its original scope and evidence counts below.

**Before:** the inspected repository behavior fixture ran only through a test
helper. **Now:** a bounded async executor and Nisi test adapter run that same
fixture through the real workflow. This is a tested implementation slice of
**NX-04 / U02-02**, not complete repository-product or merger acceptance.

```text
Trusted host registers exact reviewed trees, protected checker and assertion names
    → Nisi drafts the fixed baseline candidate
    → static-check fixture passes [not the Swift bridge in this demonstration]
    → new task tree → PRE + Node binary identity → owned direct child
    → observed close → strict result reader → POST + binary identity
    → baseline FAIL: 8/10 assertions, bound to this run/task/attempt/candidate
    → fixed one-file repair → a NEW tree and fresh execution
    → repaired PASS: 10/10 → fixed reviewer callback → engine COMPLETED

Missing/invalid execution or adverse outer host state → UNAVAILABLE, not quality PASS
```

- [Suite registration and report reader](/Users/louiscalata/nisi-next-private/hosts/repository/node-suite-v1.mjs)
  bind original preparations, protected checker bytes and a closed assertion
  inventory. The reader rejects duplicate JSON keys, malformed UTF-8/framing,
  extra fields, mismatched schema, unknown/duplicate failures and contradictory
  counts. Setup `ERROR` has zero assertions. Registration records a trusted host's
  source-review assertion; it neither performs that review nor grants permission.
- [Owned Node executor](/Users/louiscalata/nisi-next-private/hosts/repository/node-executor-v1.mjs)
  fixes the real Node path, argv, minimal environment and empty stdin. It observes
  workspace and Node-binary identity, caps output, uses the existing direct-child
  deadline/cancellation/close owner, prevents workspace/attempt reuse and retains
  late observations. Unknown close quarantines the owner and prevents POST while
  work might still be active. Raw child evidence is never rewritten into success.
- [Nisi test adapter](/Users/louiscalata/nisi-next-private/hosts/repository/node-adapter-v1.mjs)
  admits only exactly registered candidates, creates a fresh task tree per test
  attempt and binds real results to the engine. Only an original issued execution
  result can be converted; raw PASS plus an unavailable outer host becomes
  `UNAVAILABLE`. In-memory partial history and a settlement promise are retained.
  This is not a serialized restart or durable report API.

**Two production defects were reproduced before repair.** Caller-owned arrays
could change meaning through custom iteration/accessors; eight regressions first
failed, then passed after descriptor-based closed-list capture. Separately, the
adapter incorrectly required consecutive test attempts. Static failures can skip
the test stage, so two genuine workflow/adapter regressions failed before the
fix. Attempts now strictly increase within the repair budget and remain bound to
one run; gaps are permitted, replay is not. All adverse test outputs are retained.
Early test-fixture expectation/author-evidence mistakes were also corrected and
kept separate from these production defects.

| Fresh evidence | Result | Scope |
|---|---:|---|
| Full portable check/test command | **446/446 PASS** | Up from 399; zero failed, skipped or cancelled |
| New report/executor/adapter tests | **47/47 PASS** | Included in 446; four use real Node on inspected fixture code |
| Selected single-site fault mutations | **23/23 detected** | All finish with expected test failures; not exhaustive fault coverage |
| Accepted source manifest | **47 files stable** | Prior 41 unchanged, plus six new source/test/helper files |
| Frozen Veritas import | **225 files / 8,027,242 bytes unchanged** | Import integrity; origin not freshly rechecked |
| Fixed Swift native / native app | **NOT_RERUN / NOT_RUN** | Prior 23/23 native evidence remains historical on unchanged source |

The full command took **8,048 ms**, focused tests **2,615 ms**. These are local
verification timings, not an OFF/ON benchmark, token-saving or accuracy claim.
The real workflow uses fixed author, static-check and reviewer callbacks; only
the behavior execution is real Node in that demonstration. A separate real test
confirms that an initial static failure may skip tests and enter them at attempt 1.

**Actual collaboration:** Fable was attempted first and Sonnet second; both
bounded requests timed out with no usable review (`NOT_RUN`, usage unknown).
A smaller tool-disabled **Claude Opus 5 scope review** completed, with reported
cost **$0.0770545**, including auxiliary Haiku usage; it was not a source review.
Daybreak's independent source review identified both repaired defects and checked
the resulting source. Luna supplied an initial read-only test/design review;
its later additional review failed because authentication refresh was revoked.
No authentication changes or retries followed. Codex owned integration and tests.
OpenCode's prior accepted fixture is reused; no new OpenCode packet ran here.

> [!WARNING]
> **This runner is not permission to execute arbitrary generated code.** It is
> accepted only for the inspected, static-local, no-descendant fixture. Direct-child
> observation does not enforce process-tree or network containment. macOS was
> tested; Linux is an allowed code path, not a fresh platform result. Windows
> workspace execution remains unsupported by this materializer.
>
> **Why this matters:** a private folder, source fingerprint or suite registration
> does not sandbox code. Node binary checks do not attest OS/shared libraries.
> Filesystem/registration work is not hard-preempted; the executor checks its soft
> total deadline at phase settlement, and adapter materialization occurs before
> that timer. Preserve the independent engine deadline, unknown-close quarantine
> and outer host disposition. No auto-cleanup, apply-back, durable recovery,
> live-model execution, certification or release authority is added.

**Windows refresh after Louis's update:** bounded read-only observation now sees a
fresh `running` worker advertising Qwen3-Coder-Next and GPT-OSS. That supersedes
the earlier empty/degraded inventory. The ordinary Mac dispatcher still rejects
the hostname-mounted share (`louisaurorar12`) because its trust list matches
literal IP mount names. **No Windows job or inference was run.** Do not call the
PC down; record the Mac dispatch trust failure separately. No bypass, remount,
service restart or trust-setting change was performed.

**Next engineering dependency:** combine the accepted Swift static and Node
behavior lanes under one repository host; retain their distinct outcomes in the
complete final report/bundle and proposed diff. Then run separate native acceptance
and the approved model/isolation gates. Durable history, evaluated prevention,
native app, modular/traveler scope and packaging remain open. No publication.

Evidence: [checkpoint summary](/Users/louiscalata/nisi-next-private/docs/verification/2026-09-12/u02-node-behavior-checkpoint.json),
[final acceptance receipt](/Users/louiscalata/nisi-next-private/.build/node-behavior-PC8y5c/final-receipt.json),
[test receipt](/Users/louiscalata/nisi-next-private/.build/node-behavior-PC8y5c/check-7oZTc4/result.json),
[mutation results](/Users/louiscalata/nisi-next-private/.build/node-behavior-PC8y5c/mutations-VVn1XB/result.json),
[source hashes](/Users/louiscalata/nisi-next-private/.build/node-behavior-PC8y5c/check-7oZTc4/source-after.json),
[Claude scope review](/Users/louiscalata/nisi-next-private/.build/node-behavior-PC8y5c/opus-scope.json).

### September 12 task workspace and OpenCode fixture — private acceptance

**Before:** repository preparations were immutable in-memory data; the existing
Swift group checked declared artifact structure. There was no accepted task-tree
materializer or source-reviewed Node behavior fixture in this host slice.
**Now:** an issued preparation can create a new private, task-owned tree, and an
inspected fixed Node program demonstrates a genuine behavior failure and repair.
This advances **NX-04 / U02-02**, which remain open.

```text
Issued baseline + candidate + protected file digests
    → non-root operator selects a static local POSIX parent
    → exclusive task tree; private permissions; exact bytes and inventory
    → PRE checkpoint
    → inspected fixed Node fixture executes [test helper only]
    → POST checkpoint; any detected drift or close uncertainty refuses

Baseline: FAIL, 8/10 assertions   →   one-file correction: PASS, 10/10
Both exit 0: quality comes from validated structured results, not exit alone.
```

Implemented and checked:

- [Task workspace materializer](/Users/louiscalata/nisi-next-private/hosts/repository/task-workspace-v1.mjs)
  accepts original issued preparations only. It refuses root execution, broad
  parent roots and their existing canonical aliases, symlinked parents and
  non-owned/group-writable/other-writable parents. Task directories use `0700`;
  files use exclusive no-follow creation and `0600`. Short writes/reads, exact
  raw bytes, metadata and complete inventory are checked; close uncertainty is
  not silently discarded. Failed partial roots remain for manual reconciliation.
- The workspace has ordered `MATERIALIZED → PRECHECKED → POSTCHECKED` observations.
  Inspection failures quarantine it. These are discrete filesystem observations,
  **not execution receipts, a sandbox or permission to run a command**.
- [Five fixed fixture files](/Users/louiscalata/nisi-next-private/examples/repository-task/fixtures/baseline/README.md)
  include the intentionally broken retry setting, its `||` → `??` correction,
  zero-retry configuration, private instructions and a protected ten-check harness.
  Real execution catches both zero-value failures. Setup errors return `ERROR`,
  exit 2 and zero assertions instead of invented passing counts.
- [Workspace tests](/Users/louiscalata/nisi-next-private/tests/task-workspace.test.mjs)
  cover drift, extra/missing/substituted files, hardlinks, symlinks, permissions,
  metadata-only changes, partial I/O, uncertain close and lifecycle refusal.
  [Fixture tests](/Users/louiscalata/nisi-next-private/tests/repository-fixture.test.mjs)
  execute only the inspected fixed modules in separately materialized roots and
  verify unchanged harness/workspace bytes at the checkpoints.

| Fresh evidence | Result | Meaning |
|---|---:|---|
| Full portable check/test command | **399/399 PASS** | Up from 371; includes all 28 new tests |
| Workspace plus real fixed-fixture tests | **28/28 PASS** | 26 workspace + 2 fixture tests; not additional to 399 |
| Selected single-site workspace mutations | **19/19 detected** | Each has retained failing-test counts; not exhaustive mutation coverage |
| Frozen Veritas import | **225 files / 8,027,242 bytes unchanged** | Import integrity only; origin was not freshly rechecked |
| Prior accepted source hashes | **33/33 unchanged** | Earlier native evidence remains historical, not freshly rerun |
| Fixed Swift native suite / native app | **NOT_RERUN / NOT_RUN** | No new native or UI acceptance claimed |

The final portable command took **7,806 ms** and focused command **485 ms**.
These are local test timings, not a speedup, token-saving or coding-accuracy study.
The first extra-verification run stopped when a mutation rule matched two source
sites. Its output is retained; the corrected single-site run completed all 19.
No failed result was promoted to success.

**OpenCode was actually used.** The packet ran in an isolated copy, not the
canonical tree. The local route (`lmstudio/qwen/qwen3.8-27b`) reached its 180-second
edit limit without fixture source changes; the terminal blocked receipt is kept.
The explicitly selected free/Zen route (`opencode/big-pickle`) then completed
**four packet items**, producing exactly the five allowed fixture files plus
wrapper metadata. Those are requested routes; served-model identity and token
usage were not retained and remain unknown. Packet checks were static/syntax plus
the existing suite, not permission to execute unchecked generated programs.

Codex inspected the complete diff, corrected the README's two-failure description,
tightened missing-function/outer setup-error handling, and normalized formatting
before integrating the fixture. The author-owned packet acceptance script and
package changes stayed in the isolated copy. Luna independently reviewed the
fixture; Codex then ran its inspected programs in the real local tests above.

**Fable 5.1 also participated:** two bounded, tool-disabled planning/scope reviews
completed, with `claude-fable-5-1` reported by the CLI. They guided root/alias/close
handling and the honest static-local scope; they were not source acceptance.
Their combined reported cost was **$0.22443150**, including auxiliary Haiku usage,
not the whole session cost. Daybreak reviewed the final workspace source and ran
26/26 focused tests without a concrete blocker. Codex remained integration owner.

> [!WARNING]
> **A task-owned folder is not an execution sandbox.** This first materializer
> requires a non-root, operator-controlled static local POSIX parent without a
> concurrent writer. Path-based checks do not contain hostile trees, same-account
> races or arbitrary imported code. macOS was tested; Linux is an allowed code
> path, not a separately verified platform result. Windows is unsupported here.
>
> **Why this matters:** execute only the exact inspected fixture in this lane.
> Do not enable live-generated code, automatic apply-back or background execution
> on the strength of these checkpoint records. Their authority/certification and
> cleanup flags remain false; file observations do not prove a process drained.

**Next implementation at that checkpoint:** the owned asynchronous behavior-test runner, with fixed
command identity, bounded output/deadline, cancellation and observed close/drain;
strict structured-result validation tied to the exact workspace and protected
harness; then the complete engine repair/review/report integration. Keep the
separate live-model/isolation, native app, history, prevention and modular gates.
The other three parallel-ready packets below remain queued, not performed here.

Evidence: [checkpoint summary](/Users/louiscalata/nisi-next-private/docs/verification/2026-09-12/u02-workspace-opencode-checkpoint.json),
[final acceptance](/Users/louiscalata/nisi-next-private/.build/repository-host-V5Taf5/verified-oP6vgX/final-receipt.json),
[mutation results](/Users/louiscalata/nisi-next-private/.build/repository-host-V5Taf5/verified-oP6vgX/mutations.json),
[source hashes](/Users/louiscalata/nisi-next-private/.build/repository-host-V5Taf5/verified-oP6vgX/source-after.json),
[OpenCode completed packet](/Users/louiscalata/nisi-next-private/.build/opencode-fixture-MgiuEj/.packets/retry-repository-fixture.result.md),
[retained local blocked packet](/Users/louiscalata/nisi-next-private/.build/repository-host-V5Taf5/local-attempt.result.md).
No commit, push, publication, authentication/device change or Windows job occurred.

### September 12 multi-file static checks — private acceptance

**Before:** the accepted Nisi adapter checked one selected artifact per attempt.
**Now:** an issued plan covers every file in the **declared materialized snapshot**,
up to 64 files. Each path has a separately bound fixed Swift execution and raw
receipt. A repaired candidate creates a fresh plan and fresh checks, including
files whose content did not change. This is meaningful NX-04/U02-01/U02-02 progress,
not completion of those packages or the full repository host.

```text
Admitted disk snapshot + candidate patch
    → complete declared-file plan, bound to candidate/attempt/checker
    → one fixed Swift child per path → one raw receipt per dispatched child
    → native-byte, identity, full-inventory and cleanup checks
    → grouped static result → exact final-engine-report linkage

Clean quality FAIL → targeted fixture repair → fresh complete plan and checks
Abort / operational failure → stop dispatch → explicit undispatched suffix
Unrecorded execution failure → partial evidence only → quarantine, no retry
```

Implemented private components:

- [Issued check plan](/Users/louiscalata/nisi-next-private/hosts/swift-verifier/check-plan-v1.mjs)
  binds path, profile, prepared bytes, run and attempt. Same-profile files cannot
  share an execution identity; missing, duplicate and extra targets refuse.
- [Grouped adapter and owner](/Users/louiscalata/nisi-next-private/hosts/swift-verifier/group-adapter-v1.mjs)
  dispatch sequentially through the fixed executor. The internal trusted-executor
  seam supports deterministic lifecycle faults; it grants no execution authority.
- [Grouped static evidence](/Users/louiscalata/nisi-next-private/receipts/swift-static-group-v1.mjs)
  revalidates every raw receipt and the actual output bytes. A fixed Swift quality
  PASS/FAIL requires exit zero and empty stderr. Operational problems cannot be
  relabeled as ordinary document-quality failures. Known findings remain recorded.
- [Grouped run linkage](/Users/louiscalata/nisi-next-private/receipts/swift-static-run-v1.mjs)
  binds all static groups to the complete final report. Raw passing checks remain
  visible after an engine timeout/abort, but receive no recorded-pass credit.
  Final storage failure stays separate from workflow completion.

**Actual native fixture:** three files are created on disk and captured through
the real repository reader: two JSON files and one Markdown file missing Rollback.
Attempt 0 produces two native PASS results and one native FAIL. The deterministic
fixture author repairs only the Markdown file; attempt 1 launches three fresh
checks, all PASS. Six executor observations are bound to six fixed-child launches
by the executor implementation—not a separate OS process census. Tests verify
all paths, unique child identities, native headers, observed close/drain and
reservation release. The original disk files remain unchanged. Author, behavior
assertions and reviewer are explicitly fixtures; no model-generated code runs.

Final source acceptance:

| Evidence | Result | Limit |
|---|---:|---|
| Full portable suite | **371/371** | Local tested behavior, not code-quality accuracy |
| Focused group/owner/run plus legacy v1/v2 suite | **64/64** | Included in the 371, not additional tests |
| Separate fixed Swift kernel/adapter suite | **23/23** | Includes five grouped native tests; not native app acceptance |
| Single-site broken reader/owner/plan variants | **30/30 detected** | Selected safeguards and stable refusal diagnostics only |
| Frozen imported source | **225 files / 8,027,242 bytes unchanged** | Source equality, not integration or release |

The full portable suite took **7,003 ms** and serial native suite **9,036 ms** in
this final run. These are observed local verification timings, not a comparison
of Nisi ON/OFF or proof of reduced total development time. Selected source/test
hashes were unchanged during verification. The prior v1 receipt, engine, legacy
adapter and old focused tests match retained hashes; the v2 reader body matches
after removing only the new shared-validator export/comment.

**Adverse evidence retained:** the first acceptance run passed 369 portable and
23 native tests but detected only **23/30** mutants, so it stayed ACTION_REQUIRED.
The seven survivors led to explicit coverage, duplicate/argument-schema, truncated
inventory, raw-process contradiction, surplus-plan and stage-binding regressions.
Some guards already refused through later validation; their new tests additionally
check the intended error code. No test was weakened and no survivor was hidden.
The earlier four pre-correction failing regressions are also retained.

**Actual collaboration:** Fable was tried first, followed by Sonnet and Opus;
all three bounded current-packet calls timed out without usable deliverables.
They are NOT_RUN, not reviews; their usage is unknown. Daybreak reviewed the
production delta and ran 29/29 then-current pure tests without a blocker. Luna
reviewed the native fixture and identified lifecycle/path assertion gaps, now
covered. Codex integrated the changes and ran the final 31 new pure tests plus
full acceptance. Later test additions do not imply a new Claude review.

> [!CAUTION]
> **This is a complete declared static-check group, not a complete coding host.**
> JSON/Markdown structure checks and fixture assertions do not prove arbitrary
> program behavior, genuine model review, adversarial isolation, crash recovery,
> native application integration, or failure prevention. Original in-process
> issued plans are still required; a saved group is not trusted after restart.
>
> **Why this matters:** keep the ordinary v1/v2 meanings unchanged, do not run
> untrusted candidate programs in this lane, and do not promote these records
> into execution authority, certification or public performance claims.

Evidence: [final acceptance receipt](/Users/louiscalata/nisi-next-private/.build/group-integration-yWWJZY/verified-oDFROk/final-receipt.json),
[source hashes](/Users/louiscalata/nisi-next-private/.build/group-integration-yWWJZY/verified-oDFROk/source-after.json),
[native observations and artifact locations](/Users/louiscalata/nisi-next-private/.build/group-integration-yWWJZY/verified-oDFROk/native.json),
[mutation outcomes with failing-test counts](/Users/louiscalata/nisi-next-private/.build/group-integration-yWWJZY/verified-oDFROk/mutations.json),
[adverse acceptance](/Users/louiscalata/nisi-next-private/.build/group-integration-yWWJZY/verified-0pezWT/final-receipt.json),
[pre-correction regressions](/Users/louiscalata/nisi-next-private/.build/group-integration-yWWJZY/before-regressions.json).
Native build/fixture output is intentionally retained in unique private `.build`
directories. Cleanup requires exact-path scope; repeated tests must not broadly
delete evidence or clear uncertain reservations.

**Next at this earlier checkpoint:** a task-owned materialized repository with a protected,
source-reviewed behavior-test harness and exact per-test execution receipts, then
a complete final report/diff. This remains separate from the later approved
live-model demonstration. NX-04, U02-02 and full merger remain open. No commit,
push, publication, model-server restart or authentication/device action occurred.

### Development acceleration — same full merger scope

Louis requested faster development and authorized use of the Windows worker when
useful. Keep the full merger intact; shorten the critical path through independent
work, small interfaces, deterministic feedback and fewer repeated reviews.

1. **One integration writer, parallel bounded collaborators.** Codex owns the
   canonical source and acceptance. Daybreak handles high-risk ownership/receipt
   review; Luna handles focused test/design gaps. Fable is the first Claude review
   choice, with a short packet and explicit time/token cap. After unavailable
   attempts, continue deterministic work; do not keep resending the same large
   review or report a timeout as participation.
2. **Mac owns the current native critical path.** Build and test fixed Swift
   programs here. Native suites sharing the reservation namespace run serially;
   source/test design reviews can run alongside them. Preserve safe cancellation,
   drain, provenance and release gates.
3. **Windows is independent capacity, not the Mac native acceptance lane.** The earlier check found
   SharedChami mounted as `louisaurorar12`, an active SMB connection to already
   allowlisted `10.0.0.71`, and a dispatcher that accepts only literal-IP mount
   names. The first registered state was **degraded** with empty inventories;
   after Louis restored the worker, a fresh read shows **running**, Qwen3-Coder-Next
   and GPT-OSS advertised. Louis subsequently approved the exact mounted server
   name `louisaurorar12` for this task only. The SMB connection was independently
   matched to `10.0.0.71`; the documented per-command server selection now passes
   the registered dispatcher checks. No saved settings, mounts or services changed.
   Qwen returned a bounded code draft; a separate GPT-OSS test request timed out.
   Do not generalize this task approval to new servers or future tasks. The current
   queue contract is model review/inference, not arbitrary Windows test execution.
4. **Use focused tests during edits, full suites at coherent checkpoints.** Run
   the three grouped pure files for local feedback; batch portable, serial native,
   freeze and mutation verification on a stable snapshot. Reuse unchanged
   accepted interfaces and source digests; do not repeat a full-repository audit
   or warm every model for every small patch.
5. **Give each packet an interface and a completion test.** Keep implementation,
   independent review and native acceptance distinct. Parallel packets may draft
   in isolated scratch paths, never race to edit the same canonical files.
6. **Update roadmap and equation once per accepted task.** Retain concise source-
   bound receipts; avoid duplicate plans or competing progress percentages. The
   test counts are separate from the 3/10 closed-NX progress measure. No measured
   token-saving or overall development-speed percentage is available yet.

> [!WARNING]
> **Worker inference is not Windows native acceptance.** The task-approved
> dispatcher now works and Qwen returned code, but that code still needs acceptance.
> Model inventory and inference do not establish native execution or source parity.
>
> **Why this matters:** dispatch only after the ordinary trust/readiness checks
> succeed and use only the registered capability. Retain the task-only server
> approval and exact response IDs; do not invent a remote-shell or native-test lane.

#### Parallel-ready private work packets

The package/history packets remain **queued, not executed**; the evaluation
reader is now implemented and checked, but its live runner remains queued. These
work orders were refined by the read-only Luna review. They can develop against
the frozen contracts while Codex owns U02-02's
materialized repository/process host. Each implementer must first inspect current
source, preserve dirty work and use a separate scratch copy or an agreed file
ownership boundary. No packet may edit `workflow/engine.mjs`, the Swift executor,
the frozen import or another packet's files. Codex integrates and accepts results.

| Packet | Owned proposed changes | Required output and dependencies |
|---|---|---|
| **U02-03: private consumer/package** | `types/`, `tests/private-consumer.test.mjs`, `scripts/check-private-package.mjs`; propose reviewed `package.json`/`index.mjs` changes | Declarations matching existing APIs, explicit supported export/inclusion inventories, backwards-import check and lifecycle-disabled local archive/consumer rehearsal. Keep `.build`, confidential history, native source and test-only evidence out of the portable archive. No registry or publication. |
| **U02-04: history contract** | `history/run-journal-v1.mjs`, `tests/run-journal.test.mjs`, `scripts/test-history-mutants.mjs` | Consume unchanged integrity/receipt contracts. Define project/run/attempt/candidate attribution, duplicate-versus-conflict rules, redaction/retention/revocation and partial-write reconciliation. Test persisted reopen separately; serialized old plans never become fresh issued execution evidence. Actual host integration waits for U02-02. |
| **U02-08: matched evaluation protocol** | Implemented: `evaluation/paired-trial-v1.mjs`, intake/metrics helpers, fixture and two test files. Pending: actual trial collection/protocol runner | The pure accounting slice now has 27 passing tests. Fixed assignment/order, setup accounting, independently sourced oracle results and complete live usage collection are still required. Real trials wait for the frozen host and verified approved models. |

Planned acceptance commands, **after the named files exist and are reviewed**:

```sh
# Private API/package packet; inspect dry-run inventory before making any archive.
node --test tests/public-api.test.mjs tests/example.test.mjs tests/workflow-example.test.mjs tests/private-consumer.test.mjs
npm pack --dry-run --ignore-scripts --json

# Journal packet: contract/partial-write tests, then selected broken variants.
node --test tests/integrity-successors.test.mjs tests/host-run-bundle-v2.test.mjs tests/run-journal.test.mjs
node scripts/test-history-mutants.mjs

# Implemented evaluation reader: no inference, networking or public benchmark output.
node --test tests/paired-trial.test.mjs tests/trial-intake.test.mjs
```

Each handoff must name changed files, exact hashes, commands, terminal exit codes,
adverse cases and unresolved limits. An API rehearsal is not a released package;
a journal callback is not power-loss durability or validated resume; a stub trial
is not a measured product benefit. No packet's local PASS closes the full merger.

### September 12 two-layer native/workflow outcomes — v2 checkpoint

**Implemented and accepted in the bounded one-artifact seam:** a new
[v2 host bundle reader](/Users/louiscalata/nisi-next-private/receipts/host-run-bundle-v2.mjs)
keeps actual process observations separate from the engine's outcome. Existing v1
receipt/bundle meanings and the engine itself are unchanged from the preceding
accepted source hashes. This advances NX-04/U02-01/U02-02 without completing them.

| Situation | Retained process fact | Derived v2 disposition | Workflow meaning |
|---|---|---|---|
| Ordinary check returns matching evidence | Valid raw PASS, FAIL, NOT_RUN, ERROR or INCONCLUSIVE | `RESULT_RECORDED` | Preserve the ordinary engine status; recording an adverse result is not accepting the candidate |
| Engine aborts or reaches its deadline | Any independently valid raw outcome, including a clean PASS | `ENGINE_INTERRUPTED` | Do not count raw PASS as recorded PASS; preserve the exact stop and final workflow outcome |
| Another engine error has an exactly matching host error | Raw ERROR with matching error code/reason | `ENGINE_ERROR_RECORDED` | Error remains an error; arbitrary mismatches still refuse |
| Report storage fails after the workflow | Existing check receipts remain unchanged | Existing per-check dispositions remain unchanged | Surface `workflowOutcome`, final `outcome`, `code` and `reportStoreCode` separately |

The real Swift fixture now demonstrates native PASS alongside Nisi TIMED_OUT:
v1 still refuses the pair, while v2 binds both records and returns
`recordedPassCount: 0`, `unrecordedRawPassCount: 1`. The raw receipt is not
rewritten to claim cancellation. The reader infers no timing order between raw
closure and engine interruption. Fake late-completion fixtures separately
exercise cancellation before a result is collected.

V2 requires the complete ordered check-stage expectation/receipt inventory,
factory-issued expectations, exact run/task/attempt/candidate/snapshot/profile
bindings, closed schemas, a full final-report digest and derived dispositions.
Caller-supplied disposition changes fail even with a recomputed outer hash.
The final candidate must match the last checked candidate, including when repair
ends with NO_CHANGE/FAIL/NOT_RUN/UNAVAILABLE before any new checks occur.

> [!CAUTION]
> **A consistent bundle is not authenticated execution or resumable storage.**
> The reader requires trusted caller-supplied final reports and the original
> in-process issued expectations. It grants no authority or certification.
>
> **Why this matters:** saving this JSON does not make its expectations trusted
> after a restart, prove every descendant stopped, or establish that an honest
> host ran the claimed program. Persistent admission/recovery and complete
> repository execution remain separate work. Missing receipts refuse; they are
> not silently omitted or converted into NOT_RUN placeholders.

Verification of the final source:

- **340/340 portable tests**; **33/33 focused v1/v2 tests**, included in that total.
- **18/18 separate fixed-kernel/native-adapter tests**, with the actual Swift
  timeout pairing and retained v2 bundle. No full native app or model inference.
- **19/19 targeted broken variants detected**; restoration of the erroneous
  terminal-repair candidate branch fails its new regression.
- Source snapshots match before/after verification; prior accepted v1 receipt,
  engine and supporting production files match their retained hashes.
- Frozen import remains **225 files / 8,027,242 bytes**; `git diff --check` passes.

Adverse evidence was retained. The first run passed ordinary suites but detected
only **16/18** selected mutants, so it remained ACTION_REQUIRED. Added correlated
stop/outcome and storage-outcome regressions catch both survivors. Daybreak also
found the terminal-repair candidate-linkage defect; the correction is covered by
five real engine terminal-repair shapes and a targeted broken variant. The final
run has 19 selected mutants because it adds that distinct repair regression.

**Actual collaboration:** Fable was attempted first; its bounded attempt ended
at the configured per-attempt budget limit with no deliverable. Sonnet 5 supplied
the design review and reviewed the initial implementation. Codex corrected its
overly restrictive interpretation of ordinary adverse v1 results against source.
Luna supplied source-grounded test design. Daybreak found the linkage defect,
accepted the correction, ran 14/14 v2 tests and independently matched legacy
source hashes. Sonnet's earlier PASS is not a claim that it reviewed the later
Daybreak correction. The successful Sonnet planning/review calls reported
approximately $0.1052 combined; failed Fable usage and total session usage remain
unknown. No savings claim is made.

Evidence: [final acceptance receipt](/Users/louiscalata/nisi-next-private/.build/two-layer-disposition-IkWGaZ/verified-LVtctk/final-receipt.json),
[mutation outcomes](/Users/louiscalata/nisi-next-private/.build/two-layer-disposition-IkWGaZ/verified-LVtctk/mutations.json),
[actual native observations](/Users/louiscalata/nisi-next-private/.build/two-layer-disposition-IkWGaZ/verified-LVtctk/native.json),
[first adverse run](/Users/louiscalata/nisi-next-private/.build/two-layer-disposition-IkWGaZ/verified-XNAqKU/final-receipt.json),
and [Claude planning receipt](/Users/louiscalata/nisi-next-private/.build/two-layer-disposition-IkWGaZ/claude-plan.json).

**Next at that checkpoint:** connect disk capture to multi-file execution using
explicit per-child receipts and a complete host-selected inventory. The newer
grouped checkpoint above now covers that fixed-checker fixture; a real behavior
repair and model review remain pending. Do not make a one-artifact v1
receipt stand in for multiple executions. Full host admission/isolation, native
shutdown, protected-envelope migration, history/prevention, modular integration
and exact-artifact release gates remain open. No commit, push, publication,
model-server restart, authentication action or protected-root mutation occurred.

### September 12 private product usefulness and comparison report

**Assessment date:** September 12, 2026. **Package inspected:** the private
`nisi@0.2.0-private.0` working copy, not the public v0.1 checkout.
**Decision:** continue developing the narrow reliability component and prove one
complete repository workflow before expanding autonomous features.

**Bottom line:** Nisi is a more credible reliability component after these repairs.
It is not yet a finished automatic macOS coding assistant, and its coding quality,
token savings and speed relative to alternatives remain unmeasured. The merger
adds useful mechanisms, but source presence is not the same as a connected product.

#### Who can benefit from this package today?

| User or job | Current usefulness | Evidence and limitation |
|---|---|---|
| Developer who already has model and test integrations | **Useful experimental building block** | The executable workflow binds checks/reviews to a task, attempt and candidate, bounds repairs and rejects inconsistent records. The host still has to perform the work truthfully. |
| Operator debugging a failed local model or checker call | **More useful after this batch** | Local-chat and AFM owners expose cancellation/settlement distinctions. Uncertain work blocks automatic reuse within that owner; this is not control of every provider or process on the machine. |
| Developer building traceable failure history | **Promising, staged primitives** | New versioned evidence and immutable event modules are tested in memory. They are not yet wired into the workflow, durable storage, protected authority or prevention learning. |
| Louis using a menu-bar switch to code without managing infrastructure | **Not ready as a turnkey daily tool** | Native source and a fixed Swift checking path exist, but full app integration, automatic model eligibility/control, reliable whole-app shutdown and end-to-end acceptance remain pending. |
| Someone choosing the fastest or most token-efficient coding tool | **Insufficient evidence** | The previous live OFF/ON pilot completed zero of 24 scored trials. No savings, speedup or task-accuracy difference can be calculated from that attempt. |

The concrete benefit is consistency under failure. If tests belong to candidate A
but the proposed change is candidate B, Nisi should not silently accept A's result.
If a request times out while transport remains unresolved, Nisi should not call the
slot free. If duplicate evidence contradicts itself, its input order should not
decide whether a policy is satisfied. These are inspectable behaviors, not claims
that the model became more intelligent.

The earlier synthetic OFF/ON comparison supports only a narrow observation:
Nisi refused **4/4 injected invalid-evidence cases**, while the deliberately simpler
baseline refused **0/4**; both accepted **1/1 healthy case**. The baseline did not
implement all Nisi readers. This is not a comparison with the products below, nor
proof of better generated code. See the retained [pilot](#september-12-nisi-offon-comparison--incomplete-live-pilot).

#### Comparison with current alternatives

Method: inspect current public primary documentation and repositories, then
compare documented scope with this private package's source and retained tests.
No competitor was installed or benchmarked in this assessment. Judgments in the
right column are engineering assessments, not measured performance rankings.
Only public project URLs were sent to web research; no private code/design was uploaded.

| Alternative | What its public documentation provides | Where that leaves Nisi |
|---|---|---|
| **LangGraph.js** | Stateful orchestration, persistence, durable execution, streaming and human intervention. [Official overview](https://docs.langchain.com/oss/javascript/langgraph/overview) | A stronger general execution foundation. Nisi offers a narrower prescribed coding/evidence contract, not a substitute for that infrastructure. A future adapter could combine them; none is claimed implemented. |
| **Mastra** | Structured workflow steps with input/output schemas, suspension/resumption and streaming. [Workflow documentation](https://mastra.ai/docs/workflows/overview) | Broader TypeScript application infrastructure and workflow tooling. Nisi must earn adoption by making its specific checks easy to integrate, not merely by having stages or schemas. |
| **OpenHands / Software Agent SDK** | Runnable coding-agent infrastructure, Python/REST interfaces, file-editing and shell tools, and local or remote execution options. [Official SDK documentation](https://docs.openhands.dev/sdk) | More complete when the immediate job is to run a coding agent. Nisi's repository host is still partial; its opportunity is governing how results are accepted, not claiming equivalent tool coverage today. |
| **mini-swe-agent** | A deliberately small runnable coding agent with a linear history and shell-based execution. [Official repository](https://github.com/SWE-agent/mini-swe-agent) | A valuable simple baseline. Nisi needs to show that its extra checking and integration effort prevents meaningful mistakes at an acceptable cost. Published benchmark results from a different model/harness cannot be compared directly with our unit tests. |
| **Superpowers** | A skills-based development methodology covering design, planning, test-driven work and review. [Official repository](https://github.com/obra/superpowers) | Overlaps with the online-code-mode process. Nisi makes specific workflow/evidence rules executable in a library; skills and Nisi could complement each other. This is not proof of better outcomes. |
| **Loop Engineer** | Executable loop contracts, typed terminal states, verification-gated completion, bounded repair and repository-local records. [Official repository](https://github.com/SollanSystems/loop-engineer) | A close conceptual comparison. Bounded repair and explicit completion gates are not unique differentiators by themselves. We have no matched evidence that either implementation is more reliable. |

**Strategic conclusion:** do not position Nisi as another general agent framework,
or claim that competing systems always forget failures. The current LangGraph
overview also describes trace-based issue detection and proposed fixes in its
LangSmith ecosystem. Nisi must demonstrate a specific benefit rather than rely
on a blanket claim that the rest of the market lacks a feedback loop.
[LangGraph ecosystem overview](https://docs.langchain.com/oss/javascript/langgraph/overview)

#### The product promise worth proving

> Nisi coordinates AI-assisted coding with evidence tied to the exact candidate,
> bounded repairs, and explicit reporting of completion and execution uncertainty.

This is a defensible description of intended product value, not a uniqueness or
patent opinion. The latest changes are important correctness work, but expected
correctness alone is not a durable competitive advantage.

The strongest potential differentiation is the combination of three things:

1. **Candidate-bound acceptance:** inspect which exact change each check/review supports.
2. **Honest execution state:** distinguish workflow outcome, actual process/transport
   settlement, and what remains unknown; do not turn a timeout into a clean shutdown claim.
3. **Evaluated prevention, later:** admit only qualified failure records, propose a
   versioned policy, test it on held-out tasks, and promote it only when it helps
   without weakening checks. This third element is not yet demonstrated in Nisi.

Avoid claims such as “first,” “certified correct,” “always improving,” “automatic
token savings,” or “lossless learning.” No meaningful uniqueness percentage or
overall product-quality score was established by this bounded comparison.

#### Next proof of value — same roadmap, no new feature expansion

- [ ] Complete the remaining high-priority integrity/lifecycle integration and
  native test-harness repairs listed below; keep protected-envelope V1 gated.
- [ ] Produce one private, reproducible repository task: approved scope → actual
  model draft → inspectable file changes → real checks/tests → fresh review →
  bounded repair → exact final evidence → user approval before applying beyond scope.
- [x] Add a coherent two-layer outcome record so a workflow deadline can coexist
  with a truthful raw process result. The bounded one-artifact v2 reader and real
  Swift pairing are accepted above; complete multi-file host integration remains open.
- [ ] Complete safe host recovery and a native app acceptance session before
  representing the menu-bar switch as unattended operation.
- [ ] Correct the retained benchmark harness, then compare against a simple loop
  using identical tasks, models, tests and budgets. Report answer correctness,
  incorrect completion claims, execution failures, usage, time and repair counts separately.
- [ ] Observe a private, appropriately authorized independent developer trial:
  measure setup time, integration code required and confusing concepts. Do not
  disclose private material to a new participant without approval.

**What would change this assessment:** a repeatable real-repository workflow,
evidence that another developer can set it up, and a fair benchmark showing a
useful tradeoff. More modules or more passing unit tests alone would not establish
that Nisi is the better product. Existing publication gates remain unchanged.

### September 12 private integrity and lifecycle repairs

**Scope accepted:** a further bounded prerequisite batch, not all audit findings
or the full merger. Codex remained the source write owner.

| Area | Before | Current result and remaining boundary |
|---|---|---|
| **AUD-09 — editor intake** | Supplied section IDs and initial state could reach attribute markup without the same validation as restored state | Validate shape/IDs before DOM/storage; set attributes as DOM properties; builder guards survive Python `-O`. Source tests pass. Existing standalone HTML copies were not overwritten or regenerated; they do not automatically receive this fix. |
| **AUD-02/03 — integrity successors** | Retained helpers had order-dependent duplicate acceptance and shallow event capture | New Nisi v1 evidence policy refuses duplicates/conflicts and binds subject/scope/issuer; append-only events are deep-frozen, versioned and capacity-bounded. Tested standalone only, not integrated history/certification. |
| **AUD-01/07 — migration direction** | Frozen source has canonical-key and pathname-read defects | Reuse Nisi's existing canonical codec and descriptor-bound consent reader instead of importing the defective helpers. This batch does not rewrite legacy records or claim every retained caller migrated. |
| **GAP-01 — local-chat owner** | A timeout could be followed by a second request while the first transport was unresolved | Track actual transport separately, expose lifecycle/stop, and quarantine transmitted failures. Shared ownership is explicit opt-in; no global governor, remote stop attestation or automatic recovery is provided. |
| **GAP-01 — AFM child owner** | Kill-request handling could settle before observing child closure | Use the owned child observer with bounded close grace, quarantine and STOP semantics. Failed-kill/no-close is exercised using deterministic fake children. This is per executor, not whole-app or model-server governance. |
| **AUD-12 — test-owned fixtures** | Consent/probe temporary roots could survive later setup failures without registered cleanup | Register exact owned-root cleanup immediately. Guards retain fixtures and fail teardown when child drain is uncertain. Other native fixture/harness findings are not thereby fixed. |

The shared child observer now permits the existing AFM 120-second timeout range
with explicit stderr-ignore behavior; the Swift verifier separately retains its
60-second ceiling and refusal precedence. Native tests exercise that boundary.

New evidence/profile helpers do not grant authority or certification. They use
in-memory storage and logical canonical-byte accounting, not measured RAM limits,
durability, crash recovery or automatic compaction. **AUD-21 protected Swift V1
envelopes remain gated pending a complete versioned replacement and native tests.**

Verification after review corrections:

- **326/326 portable tests** through `npm run check`, including structural checks;
  zero failed, canceled or skipped tests. The previous checkpoint was 301 tests;
  the added 25 tests cover this batch, not 25 percentage points of completion.
- **25/25 focused tests**; these are included in the 326, not additional coverage.
- **18/18 separate fixed-kernel/native-adapter tests**, including actual Swift
  compilation and process execution; no full native application or authentication session.
- **5/5 tests fail on retained pre-change editor/local-chat copies**, then pass
  on current source. This is regression evidence, not a count of distinct product defects.
- **19/19 selected broken variants detected** after a passing control. This is
  targeted mutation evidence, not an exhaustive score for the whole codebase.
- **34 selected source/test files unchanged during verification**; ordinary
  structural digest unchanged; frozen import remains **225 files / 8,027,242 bytes**.

Review found and corrected an exact-key delimiter ambiguity and ambiguous digest
profile labels in the new helpers. Canonicalization now captures inputs itself,
and policy/evidence-set identities are pinned in regression tests. Mutation work
also exposed a missing retry-after-late-settlement assertion; that assertion now
catches removal of permanent quarantine. An initial receipt parser expected TAP
but Node emitted its spec reporter; the corrected reader requires actual suite
counts. The first adverse run is retained, not converted into a passing receipt.

**Review participation:** Fable first, then Sonnet and Opus planning attempts
timed out without usable output. A separate bounded Opus source-review attempt
also timed out. These are NOT_RUN reviews with unknown usage. Daybreak Blue
reviewed the integrity fixes and ran 11/11 tests; Luna reviewed lifecycle changes
and ran scoped suites. Codex integrated corrections and ran final acceptance.
No successful Claude review is claimed for this batch; earlier Opus acceptance
belongs only to the preceding reporting batch.

The online-code-mode preflight reported degraded Mac-local operation and an
unavailable share/PC-worker lane. Advertised models were not inference-tested in
this batch. No model unload/restart, live inference, native app UI, device/auth
change, commit, push or publication was performed.

Evidence: [final scoped receipt](/Users/louiscalata/nisi-next-private/.build/approved-repairs-Hue9K1/verified-wZWhuY/final-receipt.json),
[mutation results](/Users/louiscalata/nisi-next-private/.build/approved-repairs-Hue9K1/verified-wZWhuY/mutations.json),
[pre-change regressions](/Users/louiscalata/nisi-next-private/.build/approved-repairs-Hue9K1/verified-wZWhuY/original-source-red.json),
and [native fixture evidence](/Users/louiscalata/nisi-next-private/.build/approved-repairs-Hue9K1/verified-wZWhuY/native-fixed-kernel.json).
Outstanding work includes protected-envelope migration, whole-app cancellation/
shutdown, NT-01/02/03 and AUD-26 harness repairs, successor integration, coherent
two-layer reports, complete repository execution and separate native app acceptance.

### September 12 private reporting repairs — preceding checkpoint

**Implemented locally:** AUD-04, AUD-10, AUD-13 and newly identified AUD-29.
These repairs improve the existing Nisi foundation that will receive the merger;
they do not replace NX-04–09's remaining native, history, prevention and modular work.

| Finding | Before | After |
|---|---|---|
| **AUD-04 — repair receipt** | Malformed REPAIRED could receive RESPONSE_VALIDATED before the engine blocked it | Require a candidate object and complete candidate normalization first; invalid output gets UNAVAILABLE, no repaired fingerprint, and no reviewer dispatch |
| **AUD-10 — CLI evaluation reporting** | A missing process or prose containing a verdict could become an ordinary accuracy result | Exact successful CLI answers only; unavailable, invalid-output and NOT_RUN rows stay separate. Any missing answer suppresses overall accuracy and exits nonzero |
| **AUD-13 — codec benchmark** | Expected refusal codes were discarded; accepting broken code could be timed as though it refused | Every warm-up and measured refusal must throw the exact expected code; a mismatch aborts the report |
| **AUD-29 — structural-report helper** | An own `__proto__` field disappeared in a private object accumulator | Preserve own fields with a null-prototype internal accumulator; ordinary structural report digest remains unchanged |

The benchmark reports now use **schema 2**. Purity results distinguish complete
accuracy, valid-answer-only decision accuracy and correct-per-attempt coverage.
Absent token/model telemetry stays null. These are reporting-schema changes,
not evidence of improved model performance; older reports remain historical.
The current Nisi candidate codec and the frozen Veritas hash formats were not changed.

Verification: **301/301 portable tests**, **30/30 focused tests**, and **10/10
targeted broken variants detected** after a passing control. The original source
copies still reproduce **four failing regression tests**. Mutation failed-check
counts are retained per variant; these are not exhaustive mutation coverage.
Structural checks pass, their ordinary fixture result digest is unchanged, and
the **225-file / 8,027,242-byte frozen import** still verifies.

Two adverse intermediate results were resolved, not discarded: the CLI initially
referenced variables moved inside a function (now protected by a direct CLI smoke
test), and a legacy-migration test used the mutable current helper as its old
oracle. That test now pins the two historical serialized strings and checks both
byte and digest differences; it does not silently redefine historical records.

Fable was attempted first for bounded design assistance, then Sonnet for source
review; both timed out without usable output. A smaller **Claude Opus 5** review
passed, and **Daybreak Blue** independently reviewed the actual diff, found the
CLI issue, and accepted the correction and legacy test. Fable's earlier benchmark
method participation remains a separate record, not sign-off on these repairs.
Failed-call usage is unknown; no total token-saving claim is made.

Evidence: [scoped repair receipt](/Users/louiscalata/nisi-next-private/.build/audit-repairs-jWoZnV/final-receipt.json),
[original-source regressions](/Users/louiscalata/nisi-next-private/.build/audit-repairs-jWoZnV/red-original-source.json),
[targeted mutations](/Users/louiscalata/nisi-next-private/.build/audit-repairs-jWoZnV/mutations.json),
and [Claude review](/Users/louiscalata/nisi-next-private/.build/audit-repairs-jWoZnV/opus-contract-review.json).
No live model test, native app test, model unload/restart, package publication or
Git push was performed in this repair step. The earlier live OFF/ON test remains
incomplete; these fixes do not retroactively complete it. At this preceding
checkpoint AUD-09 and GAP-01 were still open; the newer scoped batch above records
their partial disposition without claiming the other audit work complete.

### September 12 Nisi OFF/ON comparison — incomplete live pilot

**Request:** measure tokens, time and accuracy before/after Nisi. **Result:**
controlled local comparison completed; live matched-model comparison blocked
before scored trials. Keep this failed attempt, not just a future successful run.

OFF means a small handwritten draft/check/test/review/one-repair loop. ON calls
the actual Nisi `runWorkflow`. Both share the existing author/reviewer adapters,
task normalization, checks, model pair and limits. This isolates workflow
orchestration; it does not turn off every Nisi utility or test the proposed macOS
menu-bar switch. The planned private pilot has six unique JSON-configuration tasks,
two repetitions, alternating OFF/ON order: **12 scheduled runs per arm**. Generated
contents are parsed as data, never executed or applied to the repository.

Measured host before execution: **Apple M5 Pro, 64 GiB RAM, macOS 27.0 build
26A428, Node 24.18.0**. Requested author: `google/gemma-4-26b-a4b-qat`;
reviewer: `openai/gpt-oss-20b`; local loopback endpoint only, temperature 0,
8,192 output-token cap per request, 180-second request deadline, one repair.
Server cache state and competing workload are not controlled or attested.

#### Results that actually ran

| Controlled measurement | OFF: simple matched loop | ON: Nisi workflow |
|---|---:|---:|
| Healthy synthetic evidence accepted | 1/1 | 1/1 |
| Deliberately invalid evidence refused | 0/4 | 4/4 |
| Median synthetic-callback run time, 200 measurements per arm after 20 warm-up pairs | 0.0338 ms | 0.1067 ms |
| Model tokens in those synthetic runs | 0 — no inference | 0 — no inference |

The four injected faults are stale candidate-bound test evidence, contradictory
test counts, PASS with findings, and a wrong reviewer identity. The baseline
trusts returned stage statuses and does not implement Nisi's full evidence
readers. This demonstrates those specific safeguards, **not a 100% coding-accuracy
claim or superiority over every handwritten workflow**. Added measured synthetic
overhead was approximately **0.0728 ms**; this is not end-to-end model latency.
The harness passed **46 deterministic self-test groups**, including successful
answers, required repairs, malformed layout and the evidence-admission cases.

| Live warm-up observation | Result | Time | Provider-reported tokens |
|---|---|---:|---:|
| Gemma draft | Valid response; returned model matched requested ID | 10.023 s | 206 input + 41 output = 247 |
| GPT-OSS review | Request timed out; no usable response | 180.003 s | Unknown, not zero |
| Complete warm-up workflow | BLOCKED / ADAPTER_EXCEPTION; reviewer receipt retains LOCAL_CHAT_TIMEOUT | 190.029 s | Incomplete accounting |
| Scored OFF / ON trials | NOT_RUN / NOT_RUN | Not measured | Not measured |

**Live token saving: unknown. Live speedup: unknown. Live task-accuracy difference:
unknown.** Zero scored trials is not 0% accuracy. Warm-up is not an OFF/ON pair.
Six task identities repeated twice would still not be twelve independent tasks.

> [!WARNING]
> **The client stopped waiting, but model-level work still appeared active.**
> At 2026-09-12 21:04:13 UTC, the read-only `lms ps` command continued to report
> GPT-OSS as `PROCESSINGPROMPT` after the timeout. This is model-level state,
> not task-specific proof of which request is active or whether it was canceled.
>
> **Why this matters:** Queuing another model or unloading/restarting a shared
> runtime could overlap uncertain work or disrupt other sessions. No retry,
> model switch, unload, kill or server restart was performed. This supports the
> need for explicit execution-drain observations in the existing GAP-01 work.

Fable 5.1 actually participated in two bounded tool-disabled method reviews:
initial FAIL with five corrections, followed by PASS on the corrected proposal.
Luna separately reviewed the implementation and identified harness work before
rerunning: independent final oracle, measurement outside disk logging, explicit
unknown/protocol outcomes, aligned cancellation handling, unconditional source
checks and narrower semantic prompt hashes. **Method PASS is not harness acceptance.**
The first harness remains frozen with these limitations and must not be reused
for a performance claim unchanged. The two Claude calls reported about **$0.1986**
including their auxiliary usage; this is setup-review telemetry, not local-model
cost or complete session cost. Codex/Luna conversation usage is not included in
the benchmark and is not claimed to be zero.

Private receipts: [summary](/Users/louiscalata/nisi-next-private/.build/on-off-comparison-CDotEa/summary.json),
[controlled self-tests](/Users/louiscalata/nisi-next-private/.build/on-off-comparison-CDotEa/selftest.json),
[runtime observation](/Users/louiscalata/nisi-next-private/.build/on-off-comparison-CDotEa/runtime-after-stop.json),
and [harness follow-up](/Users/louiscalata/nisi-next-private/.build/on-off-comparison-CDotEa/harness-review-followup.md).
Request/response hashes verify; the tested engine/contracts/adapters match their
pre-run hashes. No existing production code, tests, packages or frozen imports
were changed. No benchmark result was published.

Next work:

- [ ] Resolve the model's active state through its owner; obtain approval before
  a model-wide unload/restart that could interrupt other work.
- [ ] Apply and self-test the benchmark-harness corrections in a new version,
  preserving this first failed warm-up and its unknown usage.
- [ ] Freeze a fresh cohort and verify both selected models before scored runs.
- [ ] Run complete matched pairs; retain errors, missing usage and any NOT_RUN
  slots. Report accepted correct outputs, false completion claims, tokens and
  elapsed time separately. Do not claim savings if telemetry is incomplete.

### September 12 whole-code checkup — findings and repair gates

**Audit reading: COMPLETE — 246/246 code files, 137,518/137,518 physical lines
(100% of the specified source scope). Review outcome: ACTION REQUIRED.**
No existing code fixes were applied during the original audit. The subsequent
[private reporting repair checkpoint](#september-12-private-reporting-repairs--merger-prerequisites)
records the fixes now implemented; findings below otherwise describe the audit
before-state. Source reading, automated
checks, runtime tests and repair completion are different measures. This is not
a proof of defect freedom or exhaustive execution of every path. A passing test
count must not be presented as a percentage of product readiness.

> [!WARNING]
> **Passing tests do not clear the merger.** The audit reproduced defects in
> current adapter/tooling code and in retained Veritas components. Keep affected
> retained components out of active integration until their repair gates pass.
>
> **Why this matters:** A hash can describe the wrong data, a later PASS can hide
> a prior failure, and a returned timeout can leave work running. Those defects
> directly undermine the reliability records Nisi is intended to preserve.

#### Scope and evidence rules

- Canonical audited tree: `/Users/louiscalata/nisi-next-private`.
- Starting inventory: **383 files**, including **246 code files / 137,518
  physical lines**. This includes comments, tests, generated editor HTML and
  embedded fixture programs; it is not a count of production statements.
- Active Nisi: **71 code files / 9,042 lines**. Retained Veritas: **175 code
  files / 128,476 lines**, including the 58,128-line teaching kernel.
- All **225 frozen manifest entries** matched the original canonical Veritas
  source. The source freeze is preserved, not silently repaired in place.
- Excluded: installed third-party dependencies, `.git`, `.build`, caches and
  the original `work/` historical/generated working copies. Those archives are
  not the current Nisi product and are not represented as reviewed source.
- Reproduction fixtures use synthetic data and mocked transports/processes or
  exact extracted pure declarations. They do not run the full retained CLI,
  launch a model, operate the app UI, or exercise authentication/YubiKey hardware.
- **The original checkup authorized an audit, not source fixes.** Source, tests,
  frozen imports and package definitions remained unchanged by that audit. Later
  authorized private merger work is recorded in the two repair checkpoints above.
  Neither changes the frozen import nor closes all remaining findings.

Raw local evidence is retained in
`.build/code-checkup-QIES1Z/`. It is private, ignored build/audit material, not a
release artifact. The [final source-reading ledger](/Users/louiscalata/nisi-next-private/.build/code-checkup-QIES1Z/semantic-review.json)
names every file, range, reviewer attribution and source hash; the
[audit receipt](/Users/louiscalata/nisi-next-private/.build/code-checkup-QIES1Z/audit-summary.json)
records zero unread scoped code ranges and zero existing code changes. Its
source-set digest is `6fa58231596bc7027147262d3ddc88bd772855dfb04196a8c5fefb18c3e6645e`.
Parser results are not counted as semantic reading. Large non-code fixture
payloads were schema/outcome inspected and parsed, not claimed as literal
character-by-character semantic reading of every encoded data byte.

#### Fresh checks — what they actually establish

| Lane | Result | Evidence ceiling |
|---|---|---|
| Whole-tree applicable parsers | 337 initial file checks PASS; 46 inventory-only; the three C/header files subsequently passed Clang syntax checks | JS/TS/Swift/Python/shell/JSON and embedded HTML script syntax, not all runtime behavior; CSS has manual review, not parser acceptance |
| Active portable structural gate and tests | **284/284 PASS**, zero failed/skipped | Host/provider fixtures; not live model inference or a real repository coding benchmark |
| Fixed Nisi Swift native tests | **18/18 PASS**, zero failed/skipped | Fixed artifact kernel and owned adapter only; not the full native app |
| Full retained Swift package plus test targets | **BUILD PASS** | Compiled and linked; these retained test targets and application were not executed |
| Retained TypeScript kernel typecheck | **PASS with existing original pinned Node types** | Default private-checkout invocation first blocked on missing `@types/node`; no dependency installation or clean-install claim |
| Targeted mutations, all seven existing lanes | **35/35 caught** after passing controls | Import 4; snapshot 4; receipt 5; disk 4; Swift kernel/reader 6; Swift owner 6; discovery 6. These are targeted mutations, not an exhaustive mutation score |
| Portable coverage rerun | Same **284 tests PASS** | Aggregate includes generated stub programs and omits unloaded native adapters; do not advertise it as whole-project coverage |
| Frozen/original source comparison | **225/225 MATCH** | Source identity only, not semantic correctness or acceptance |

No native UI, authentication, YubiKey enrollment, real AFM/local-model inference,
Windows acceptance, dependency-vulnerability audit, signing, notarization,
installer, TestFlight, publication or release check was performed. No performance
or token-saving claim is derived from the audit's synthetic reproductions.

#### Current Nisi — confirmed defects and qualification

| ID / priority | Location | Finding and required regression |
|---|---|---|
| **AUD-04 · P2** | `adapters/local-chat.mjs:220` | `REPAIRED` with `candidate: null` is accepted by the adapter and receives `RESPONSE_VALIDATED` using the old candidate fingerprint. The workflow then correctly blocks with `CANDIDATE_SCHEMA`; no false completed run was reproduced. Require status/candidate consistency before issuing the adapter receipt, and test both adapter rejection and engine refusal. |
| **AUD-09 · P2** | `docs/editor/build-editor.py:39`; `docs/editor/editor.js:161` | Supplied initial-state section IDs are not grammar-validated before interpolation into HTML attributes. A synthetic ID containing markup survives the builder and reaches `buildSections` HTML. No browser script or exfiltration was executed. Validate initial IDs/shape and construct safe DOM attributes; test initial state as well as restored local storage. |
| **AUD-10 · P2** | `scripts/ab-purity.mjs:37` | Process errors/status are ignored and any first verdict token is accepted. A missing model executable produced 16 unparseable rows, a normal accuracy report and exit 0. Separate unavailable/error runs from model mistakes; require successful process participation and an exact response, with explicit valid denominators. |
| **AUD-13 · P2** | `scripts/bench.mjs:62` | Expected refusal codes are discarded and refusal is never asserted. The unchanged benchmark control flow completed with an always-accept test double. Validate every refusal and its expected code before measuring; the reproduction used a synthetic clock and is not performance evidence. |
| **AUD-12 · P3** | `tests/content-consent.test.mjs:21`; `tests/afm-content-executor.test.mjs:25` | Temporary consent/probe fixture directories have no test-owned cleanup. Register cleanup for each owned fixture, while retaining explicitly selected failure evidence. Do not delete unrelated existing temporary directories. |

**GAP-01 · P2 — reconcile cancellation with actual drain before autonomous host
integration.** The active AFM executor returns after requesting kill, before child
`close` (`gate/afm-content-executor.mjs:107`). The local-chat timeout can return while
an abort-ignoring transport remains unsettled (`adapters/local-chat.mjs:160`). Two
sequential synthetic timeouts started two still-pending transports. This is an
existing integration boundary, not a demonstrated false PASS. Extend the owned
child/quarantine pattern: distinguish caller completion, direct-child/transport
settlement and any unproven descendant effects; keep affected capacity unavailable
until reconciled. Never treat an HTTP abort as proof remote inference stopped.

#### Retained Veritas — do not reintroduce these defects

Locations in this table are relative to `integrations/veritas/`. **Retained does
not mean active Nisi.** In particular, the current Nisi canonical codec and file
consent reader already avoid the older `__proto__` and final-component symlink
bugs below; their old versions must not replace the improved implementations.

| ID / priority | Location | Finding and required regression |
|---|---|---|
| **AUD-01 · P1** | `veritas.ts:2200`; `veritas.ts:3083` | Canonicalization assigns into `{}`; an own `__proto__` property is omitted through the prototype setter. Two different JSON records receive the same digest, and a generic envelope returns the additional raw field as verified. Preserve or explicitly reject every supported key. Version any changed canonical/hash profile; never silently rewrite historical digests. |
| **AUD-02 · P1** | `veritas.ts:1429` | Certification uses last-wins records per scope: FAIL then PASS becomes `CERTIFIED`, but reversing them does not. Define a closed duplicate/conflict policy and exact required subject/scope binding; add both-order adverse tests. This is a retained helper defect, not proof of a false Nisi workflow completion. |
| **AUD-07 · P1** | `tooling/neural/content-consent.mjs:109` | Path validation and later pathname read are separated. A synthetic same-size symlink substitution admitted outside-scope bytes. Migrate the descriptor-bound, no-follow reader and exercise the race; preserve its documented ancestor/concurrent-writer limits. |
| **AUD-03 · P2** | `veritas.ts:1439` | Append/replay shallow copies retain the caller's nested payload. Mutating input or returned payload changes stored events after hashing; materialization subsequently refuses the corrupted digest. Store independent immutable snapshots and use the same exact field projection for append and replay. |
| **AUD-05 · P2** | `tooling/neural/afm-dispatcher.mjs:103`; `:164` | Pending synthetic work returns `AFM_DISPATCH_COMPLETE` after stop/abort; stop does not abort the owned executor. Add owned cancellation, final currentness checks and joined/quarantined shutdown before successful delivery. |
| **AUD-06 · P2** | `tooling/neural/afm-dispatcher.mjs:90`; `:134` | Admission validates a copy but execution receives the caller-owned mutable packet and later hashes it. Mutating it during the await changes what is executed and receipted. Snapshot bytes once and bind admission, execution and receipt to that snapshot. |
| **AUD-08 · P2** | `tooling/neural/afm-executor.mjs:55`; `afm-content-executor.mjs:101` | Both retained executors spawn with an already-aborted signal because they only register a future abort listener. Mocked processes reproduced one spawn each. Reject pre-abort before spawn and recheck boundaries. Current Nisi already has the initial-abort check. |
| **AUD-11 · P2** | `tooling/neural/task-response-combiner.mjs:188` | The float-vector branch accepts a 16-byte response under `maxPayloadBytes: 1`. Enforce the actual byte ceiling in every payload branch; prefer the stricter typed successor and retain boundary regressions. |
| **AUD-14 · P2** | `veritas.ts:4227` | The deterministic protected-principal fixture accepts a caller-computed request before enrollment; dispatch does not bind enrollment/generation. Reproduced `APPLIED` on a fresh fixture. This is false fixture-gate evidence, **not a production privileged-authority bypass**. Add exact runtime request and enrollment validation plus negative fixture controls. |
| **AUD-15 · P2** | `veritas.ts:1470` | Evidence with an establishment date one year in the future is accepted as current. Require a valid current time and `establishedAt <= now < expiresAt` where expiry exists; test temporal boundaries explicitly. |
| **AUD-16 · P3** | `veritas.ts:3266` | A selected witness accepts an empty `recordedAt`; only the type is checked. Require a canonical instant and consistent withdrawal timing. This is malformed temporal evidence, not a demonstrated authority mutation bypass. |
| **AUD-17 · P2, source-verified** | `native/macos/CodenameVeritasFramework/Sources/CodenameVeritasApp/PrivateVerifiedFileWriter.swift:226` | After publication, a throwing readback skips identity-checked destination cleanup because `published` is already true. Preserve possible-write/cleanup uncertainty in the result and UI; never remove a replacement file. Add post-publication I/O and identity-race tests. No native fault injection was performed here. |
| **AUD-18 · P2, source-verified** | `native/macos/CodenameVeritasFramework/Sources/CodenameVeritasApp/AppModel.swift:1601` | OFF quiescence checks omit `retiredTasks`, including canceled acceptance tasks. Acceptance can already have entered an actor mutation. Join or quarantine that work before confirmed OFF and test a delayed acceptance, not only delayed analysis. Native runtime reproduction remains pending. |
| **AUD-19 · P3, source-verified** | `native/macos/CodenameVeritasFramework/Sources/CodenameVeritasApp/AppModel.swift:1641` | Canceled general task handles accumulate in `retiredTasks` until shutdown or a test-only drain. Bound/drain completed retired work in production. Array growth is visible in source; retained snapshot bytes and memory impact were not measured. |
| **AUD-20 · P2 / input hardening** | `veritas.ts:17982`; `:18014`; `:19780` | Alpha profiles admit 128 arguments or NUL-bearing arguments that downstream capsules cannot represent after prepending the executable. File reads also buffer without pre-read limits. Align intake and downstream count/byte/NUL rules and bound reads before allocation; test exact limits. This is a self-administered local lane, not a remote authorization bypass. |
| **AUD-21 · P1 before protected-envelope integration** | `native/macos/CodenameVeritasFramework/Sources/VeritasCore/ProtectedAuthorityCaptureEnvelope.swift:555` | The digest omits actual actor/authority/high-watermark/fork-head claim values. An isolated harness linked against the already-built core changed actor identity, role and authority-verification flag without changing `envelopeDigest`; both canonical envelopes decoded successfully. Bind every value and explicit absence under a versioned full-envelope digest. The current production adapter rejects protected claims; no live authority bypass was demonstrated. |
| **AUD-22 · P2** | `native/macos/CodenameVeritasFramework/Sources/VeritasCore/PipelineIncidentCaptureEnvelope.swift:353`; `ProtectedAuthorityCaptureEnvelope.swift:491` | Both decoders accept timestamp `253402300800000`, one millisecond above the constructors' declared maximum. Reproduced against the actual compiled core with synthetic canonical input. Apply identical timestamp bounds to construction and decoding, including retention timestamps. Normal capture rebinding still has its own date check. |
| **AUD-23 · P2, source-verified** | `native/macos/CodenameVeritasFramework/Sources/VeritasCore/PlatformRequirements.swift:94` | Support metadata lists x86_64 even though compile-time and runtime admission require macOS arm64. Make the emitted support matrix reflect the buildable target; planned portability must remain explicitly planned. No Intel or Windows execution was performed. |
| **AUD-24 · P2, concurrency-limited** | `veritas.ts:34844`; `:34861` | Two stale-lock recovery contenders can both read the old lock; the second then deletes the first contender's newly acquired live lock by pathname. Exact extracted code with in-memory I/O reproduced removal of the successor. Reclamation needs identity/generation-safe ownership, or an enforced external exclusive-owner gate. This is not clearance for unsupported concurrent writers. |
| **AUD-25 · P2, telemetry correctness** | `veritas.ts:34290`; `:57845` | Non-numeric token/duration fields become NaN and serialize as null, while telemetry remains `ok: true` with zero failures. Validate finite bounded numeric fields and explicit outcome types before aggregation; distinguish malformed/unavailable evidence from a zero-failure run. |
| **AUD-26 · P2, manual-gate availability** | `tooling/scripts/run-stage5.mjs:54`; `e16-implementation-runner.mjs:160`; native `Scripts/verify-platform-contract.zsh:246` | Stage5/E16 subprocesses and native test/build/probe gate calls have no end-to-end timeout. A hung stage can prevent any terminal receipt. Add bounded ownership, termination/drain accounting and an explicit non-PASS terminal record; do not merely add a timer that forgets the process. Manual/private tooling, not active Nisi runtime. |
| **AUD-27 · P3, source-verified** | `tooling/harness/chain-harness.mjs:216` | Wiring validation checks required edge values but accepts undeclared top-level edges. Require the exact own-key set if the frozen wiring contract is intended, and test an extra edge. Advisory harness only; an extra entry is not shown to create execution authority. |
| **AUD-28 · P3, source-verified** | `tooling/neural/afm-executor.mjs:124`; `tooling/tests/afm-executor.test.mjs:86` | A pre-launch binary digest mismatch is collapsed into `EVIDENCE_REFUSED`, despite the exact-cause promise; its test codifies the less precise cause. Preserve typed refusal provenance. The binary remains refused and is not launched. |

**Retained instances of GAP-01:** both AFM executors settle after a kill request
before `close`; `runBoundedHostCommand` (`veritas.ts:16585`) does the same for
host-storage commands. A mocked child whose kill returned false still produced a
completed timeout rejection. The older project-test adapter (`veritas.ts:34296`)
also needs drain and executable-pinning work, but its CLI execution routes remain
explicitly disabled; do not describe this as currently enabled arbitrary execution.

#### Additional cautions and evidence-quality work

- **Structural-check scope:** both direct-pattern inspectors miss computed and
  aliased calls. A parsing-only reproduction confirms this; no unsafe snippet
  was executed. Active `SECURITY.md:47` explicitly limits the promise to direct
  syntax, so this is a documented limitation, not a new active side-effect bug.
  Never elevate its PASS into a general purity, dependency or inertness proof.
- **Native close uncertainty:** `PrivateVerifiedFileWriter.swift:194` can retry
  an indeterminate descriptor close through its defer. Treat descriptor ownership
  after a failed close explicitly; native failure semantics were not reproduced.
- **Probe input allocation:** both active and retained content probes use
  `readToEnd()` before the size check. The ordinary executor supplies bounded
  input; direct invocation still needs an incremental bound. No probe was run.
- **Replay evidence wording:** retained `veritas.ts:53171` compares the reducer
  with itself on the same input but labels the result duplicate-event replay.
  Add a real duplicate/replay case or narrow the label. Its enclosing result
  already says `replayAttempted: false`; this is not a demonstrated replay exploit.
- **Foundation inventory:** the M3.7/M3.6 foundations at `veritas.ts:56717` and
  `:57131` compare repeated generated case lists without a frozen exact ID/count
  denominator. Add omission/duplicate/substitution controls before relying on
  these reports as complete coverage.
- **CLI intake:** retained explain/import-evidence/telemetry/record-run commands
  parse whole selected files before size checks. Apply the AUD-20 bounded-input
  discipline before accepting untrusted or automatically selected documents.
- **Dormant native SIGPIPE:** the embedded B1 supervisor writes its socket at
  `veritas.ts:27240` without a demonstrated supervisor SIGPIPE policy. With a
  default inherited disposition, a peer close could terminate it before exact
  child waiting. This is build-only fixture source, not a native runtime finding;
  verify signal handling before any activation.
- **CR-09 inventory scope:** the crash probe's file hashing checks at
  `VeritasLedgerCrashProbe.swift:593` do not detect every same-size same-owner
  mutation between reading and post-read metadata checks. Keep its exactness
  claim restricted to the stable owner-only fixture lane unless concurrent
  mutation is explicitly excluded or a stronger mechanism is tested. This does
  not demonstrate corruption of the production ledger.
- **CI hardening:** the checked-in workflow covers Linux/Node lanes, not native
  acceptance. Review action SHA pinning, least-privilege permissions and job
  timeouts; this source observation is not a dependency compromise finding.
- **Packaging/provenance:** old Apache-licensed material and private unlicensed
  additions are distinct. Do not normalize their licenses or broaden exports as
  an audit “fix.” Public packaging remains a separate approved work package.

**Native test-harness repair work — source-verified, runtime faults NOT_RUN:**

| ID / priority | Location within retained native `Tests/` | Finding and correction |
|---|---|---|
| **NT-01 · P2** | `VeritasCoreTests/LocalIncidentLedgerTests.swift:1607`; `CodenameVeritasAppTests/AppModelTests.swift:1975` | An expected hook/stream arrival can be awaited forever if the operation exits first. Race arrival against operation completion and a deadline; always release gates and join or explicitly retain uncertain work. Newer tests already demonstrate bounded waits. |
| **NT-02 · P2** | `VeritasCoreTests/LocalIncidentLedgerCoherentReplacementB2Tests.swift:936`; `:1147` | Compound close guards clear ownership only after later fallible operations; errors can double-close an already-reused descriptor. Other helpers omit cleanup after later open failures. Clear ownership immediately and use independent per-handle cleanup. This is a fixture issue, not a reproduced product-ledger failure. |
| **NT-03 · P2** | `CodenameVeritasAppTests/AppModelTests.swift:725`; `:1640` | FI0.9 evidence collection releases a blocked opener and shuts down the model only on success. A throwing requirement can skip both while scratch cleanup proceeds. Make release/shutdown unconditional and preserve the original failure. |

Test evidence must also retain these qualifications: injected `SQLITE_FULL` is
not a physically full disk; fixed PASS marker strings require actual passing
test outcomes; canaries not supplied to a scenario prove only literal absence,
not end-to-end redaction; intentional B2 fixture retention is not a cleanup bug.
Residual post-child pipe reads in that harness belong to GAP-01 and need bounded
drain if nonconforming descendants can keep the descriptors open.
The missing-observer refusal test also lacks explicit terminal cleanup evidence;
however, `IncidentSQLiteHandleBox.deinit` provides emergency observer stop and
SQLite close. A resource leak was not established, so this is not an additional
confirmed product defect. Native test effects include owned files/descriptors,
fixed child processes and evidence sinks; code reading is read-only, test execution
is not. No full retained Swift test target was executed in this audit.

#### Repair order and completion criteria

1. **Current correctness:** AUD-04/10/13/29 and AUD-09 source now have scoped
   repair evidence. Existing generated editor copies still need a separately
   verified rebuild if they will be used. Do not overwrite user text or frozen history.
2. **Integrity before merger:** AUD-01/02/03/07/21 and exact versioned compatibility
   decisions. Preserve the frozen import and place reviewed successors in Nisi;
   no blanket textual rewrite of retained data or hashes. AUD-02/03 Nisi successors
   are tested standalone; AUD-01/07 reuse and all caller migration must be verified.
   AUD-21 remains gated, not fixed by the JavaScript successors.
3. **Owned lifecycle:** GAP-01, AUD-05/06/08/18/19. Test pre-abort, late completion,
   failed kill, non-closing pipes, canceled acceptance and capacity quarantine.
   Current local-chat/AFM seams have bounded repair evidence; whole-host wiring,
   recovery and native shutdown remain pending.
4. **Contracts and private export:** AUD-11/14/15/16/17/20/22/23/24/25/27/28, then failure-injected
   native evidence and the supplemental test-evidence cautions above.
5. **Bounded, hygienic verification:** AUD-12 targeted consent/AFM fixtures now
   have guarded cleanup. AUD-26 and NT-01/02/03 remain; the test harness must
   terminate and preserve failure/cleanup uncertainty when the product fails.
6. **Re-audit the exact changed revision.** A repair is closed only with the
   reproduced failure, passing regression, affected-suite result and scoped
   reviewer acceptance. The legal/release/native-auth gates remain independent.

**Collaboration:** Fable 5.1 was tried first for a bounded source review, then
Sonnet; both timed out without usable review. A smaller tool-disabled Opus 5
review completed and corroborated the three retained canonical/certification/event
defects. Daybreak and Luna performed read-only source review; Codex owns the
reproductions, checks, integration judgment and project-record edits. No Fable
success, whole-repository Claude review or complete usage/savings figure is claimed.

### The merged product

Nisi will combine a bounded workflow foundation with verification, traceable
failure observations, evaluated prevention and an optional native Mac experience.
The table distinguishes intended destinations from capabilities already integrated.

| Product area | Foundation to carry forward | Next-version work and evidence ceiling |
|---|---|---|
| Workflow core | Existing Nisi author/check/test/review/repair/report contracts | Preserve compatibility; completion still describes supplied evidence, not universal correctness |
| Local-model coding (experimental) | Implemented local author/repair/reviewer adapters and candidate-bound workflow | Expose this supported capability in the feature inventory; private/offline coding mode is not yet verified or available in an integrated native UI |
| Verification | Veritas deterministic artifact/profile checks and explicit refusal states | Add a versioned Nisi host adapter; no generic conversion of degraded/unknown evidence into PASS |
| Failure intelligence | Veritas incident ledger, explanations, pattern observations and prevention candidates | Adapt Nisi run observations with explicit scope and retention; a pattern is not a proven cause or independent occurrence |
| Prevention | Retained private paired-trial and candidate-policy work | Test improvement on matched tasks before any controlled promotion; no automatic learning claim |
| Execution and providers | Nisi local-chat/Apple adapters; Veritas scheduler and native run-owner work | Reconcile cancellation, actual drain, budgets, consent and trust boundaries; do not substitute configured slots for hardware capacity |
| Local Model Steward | Existing local-chat author/reviewer seam; new registered-runtime inventory | Discover first, verify eligibility, manage only approved/owned resources, and evaluate reversible additions/upgrades; full host integration remains pending |
| Hardware-key approval (planned) | Existing authorization callbacks, not hardware authentication | Add optional YubiKey/FIDO2 approval at protected host actions; no device integration, enrollment or protection is implemented yet |
| Native experience | Veritas macOS 27 / Apple Silicon prototype | Integrate as an optional Nisi host; preserve the portable library and unresolved native/UI gates |
| Modular research | JEPA-inspired plugins, versioned strengths, traveling task roles, overlapping-node visual design | Retain in the merged long-term scope; no claim of integrated learning, lossless compaction or speedup before evaluation |

### Feature: Local-Model Coding Workflows — experimental

**Feature decision — September 12:** Louis requested exposing private coding
capabilities **only if true**. The supported present feature is an experimental
local-model coding workflow. “Private Coding Mode” is a planned stronger capability,
not a current guarantee. This is a private product-specification update, not a
public feature announcement or a new native UI implementation.

**User approval recorded — September 12:** Louis approved the qualified
**Local-Model Coding Workflows · Experimental** feature description and the
distinction from the planned Private Coding Mode. This approves the private
product definition; it does not assert completed privacy/native acceptance or
authorize publication, model installation, runtime changes or cloud fallback.

**Feature-card wording supported by the implementation:**

> **Local-Model Coding Workflows · Experimental**
>
> Connect a compatible local model server to draft and repair proposed file
> changes, obtain model-assisted review, and run host-supplied checks through a
> bounded workflow. Check and review records are tied to the exact candidate.
> The host controls project access and supplies the checks; results depend on
> the configured model and trusted host integrations.

**Privacy qualification must appear beside the feature, not only in a footnote:**
Nisi's adapter calls a configured local endpoint. It does not establish that the
server runs inference on-device, forwards nothing, keeps no prompt logs, or has
an authenticated model identity. No “100% private,” “fully offline,” “zero data
leaves your Mac,” “no API cost,” or autonomous repository-agent claim is authorized
by this feature entry. Private source development is not proof of private inference.

| Capability | Current implementation / evidence | Boundary |
|---|---|---|
| Draft and repair proposed file candidates | `createLocalChatAuthorAdapter` implements `draft` and `repair`; the workflow validates task/file/candidate bindings and bounded repairs | Depends on compatible configured models; not autonomous application of edits to arbitrary repositories |
| Model-assisted review | `createLocalChatReviewerAdapter` produces structured findings for the candidate and supplied check/test records | A model review is not an executed test, independently attested identity, or proof of correctness |
| Checks before acceptance and after repair | The workflow calls host-supplied static-check/test adapters and requires fresh candidate-bound evidence | The host must actually perform the claimed checks; Nisi validates their records |
| Local-endpoint transport | Literal loopback HTTP, explicit endpoint/model IDs, response validation, byte/token/time limits, digested receipts | Endpoint restrictions do not prove server locality, egress isolation, log retention policy or license permission |
| Installed-runtime model inventory | LM-01 lists registered runtime metadata without inference or permission to use it | Discovery does not activate the coding feature or establish privacy |
| Full private coding mode and native feature control | Planned below and under LM-02/03 + U02-06 | Not implemented/accepted; no working menu-bar switch is claimed |

**Evidence checked for this feature:** the current local-chat/onboarding/workflow
tests pass **38/38** using controlled test inputs and mocked inference. This is a
focused rerun, not 38 successful real coding tasks and not a new full-suite run.
The inspected September 11 retained live-model record completed one constrained
JSON configuration task with Gemma 3 author, four deterministic assertions and
Gemma 4 review. Other retained runs failed or timed out. It is a historical example,
not a current live probe, general code-quality benchmark or multi-file repository
demonstration. The source-file array contract is broader than this one-file demo;
do not claim either demonstrated repository-scale performance or an artificial
single-file API restriction.

**Before exposing a native “Private Coding” switch:**

- [ ] Define the exact privacy boundary: approved project data, model runtime,
  Nisi host/helpers, tool execution, local storage/log retention and allowed output.
  Keep cloud Claude/Codex collaboration an explicitly separate online mode.
- [ ] Integrate and verify the selected local runtime/model revision; don't infer
  runtime identity or readiness from a port, model name, digest report or list.
- [ ] Enforce the defined network-egress policy for the complete execution path,
  including model runtime and allowed tools, rather than simply observing an idle
  machine or matching `127.0.0.1`. Test deliberate cloud/proxy attempts, provider
  changes, dependencies, cancellation and refusal. Capture scoped evidence; a
  single traffic trace cannot prove absence of all future disclosures.
- [ ] Enforce project/file permissions and explicit retention/cleanup controls for
  prompts, responses, temporary artifacts, reports and model-server logs. Do not
  claim “no logs” merely because Nisi's adapter receipts contain digests.
- [ ] Demonstrate a useful private repository workflow under those controls with
  actual checks and a reviewable proposed diff. Keep model-generated execution
  behind its separate isolation/approval gate; a temporary folder is not a sandbox.
- [ ] Wire a native control to actual eligibility and run state. Display unavailable
  or unverified privacy explicitly, stop new work on OFF, and never fall back to
  cloud or a changed runtime without a separately approved mode transition.

> [!WARNING]
> **Local-model coding exists; guaranteed private coding is not established.**
> Neither a successful loopback request nor a source-private repository proves
> that code, prompts or logs remain on the device throughout a workflow.
>
> **Why this matters:** users may entrust confidential code to a privacy label.
> Keep the experimental transport claim separate from the unaccepted end-to-end
> privacy mode; publication still requires the existing exact-artifact gates.

**Review:** Fable 5.1 and Luna both supported the narrower local-model workflow
claim and rejected an unqualified private/offline claim. Codex checked source and
retained evidence and ran the 38 focused tests. Fable's proposed single-source-file
restriction was not adopted as an API claim: the contract accepts file arrays;
the historical live demonstration is the part limited to one JSON file.

**Source/evidence:** [adapter](adapters/local-chat.mjs),
[workflow](workflow/engine.mjs), [example](examples/local-model-workflow.mjs),
[local integration boundaries](docs/local-models.md),
[retained live-model example](docs/verification/2026-09-11/local-model-completed.json).
No runtime behavior, model configuration, installed app UI or public README was
changed for this feature-description task.

### Feature: Hardware-Key Approval — YubiKey integration (planned)

**User direction — September 12:** add YubiKey integration to Nisi. This entry
defines the private feature and its engineering gates. It does not enroll a key,
install a library, change macOS login, or claim a working security control.
The user's key model and supported interface are not yet confirmed.

**Proposed feature card — not yet available:**

> **Hardware-Key Approval · Planned**
>
> Use a compatible YubiKey/FIDO2 security key to approve a protected Nisi action.
> Approval is tied to that action's scope and expires. Project permissions,
> verification, resource limits and release restrictions still apply.

The feature is optional until explicitly configured. Once an enrolled user's
policy requires it, unavailable or failed key verification **blocks the protected
action**; it must not silently fall back to a weaker method. Start with one-use
approvals. Scoped session grants are a later, separately tested convenience.

| Proposed protected action | What the approval must identify |
|---|---|
| Apply a reviewed code change | Exact candidate/diff, project, destination and allowed file operations; a pre-draft approval cannot approve a later unknown diff |
| Change project access or enable a cloud mode | Exact scope, provider/destination, data boundary and limits; no implicit local-to-cloud fallback |
| Install or promote a model upgrade | Exact artifact/version, destination and approved operation; download and promotion remain separate decisions |
| Change key protection or enroll/revoke another key | Exact security-policy change and explicitly authorized enrollment/recovery procedure |
| Start a bounded coding session (later) | Project, allowed models/tools/operations, destinations, budgets, action count and hard expiry; no unrestricted agent session |

**OFF, cancel and redacted status must remain available without a key.** Stopping
work does not disable the security policy. No key ceremony overrides macOS
permissions, model licenses, candidate checks, or the separate publication gates.
This feature is not API-key storage, disk encryption, macOS login/smart-card
pairing, code signing, or a way around system permission prompts.

#### Integration route and authority boundary

- **Local-first candidate:** a narrow native helper using Yubico's `libfido2`
  and reviewed protocol verification. The library documents macOS support and
  assertion verification, but it is not a complete action-authorization system.
  Dependency pinning, licensing, packaging and authenticated helper IPC are pending.
- **Apple-native alternative:** AuthenticationServices supports physical security
  keys, but its app flow requires a legitimate associated `webcredentials` domain
  matching the relying-party identity. Do not invent a domain, register one, or
  use a browser-only entitlement to avoid this requirement. The Xcode 27 SDK header
  exposes the provider from macOS 12; symbol availability is not device acceptance.
- **Compatibility:** target an explicitly approved USB-connected FIDO2 key first.
  Probe supported capabilities after device-use approval. Touch/user presence is
  not PIN/biometric user verification. Require user verification for the proposed
  sensitive-action policy; an incapable key must not trigger silent U2F/non-UV
  downgrade. Do not promise NFC, PIV or OATH across all models.
- **Enforcement point:** introduce a hardware-neutral action-approval contract at
  the native host's single capability broker, immediately before protected effects.
  Current `authorizeContext` runs before the draft; AFM written content consent is
  explicitly non-authorizing. Neither is a replacement for this action gate.
  Every Nisi-managed file/configuration/process effect in the protected scope must
  use the broker; arbitrary external CLI/app actions do not become protected.

#### Engineering checklist — hardware-key lane

- [ ] **YK-01 · Threat model and protocol choice.** Confirm the user's key model,
  interface and UV support; select the local helper or associated-domain route;
  define a stable, legitimate relying-party identity, credential policy, trusted
  host boundary and OS/device test matrix. A device name/AAGUID is not by itself
  proof of hardware provenance. Do not market touch alone as multi-factor security.
- [ ] **YK-02 · Explicit enrollment and backup.** Register only a Nisi credential
  following a visible user-initiated flow. Protect public-key/credential metadata
  and policy against unauthorized replacement; keep private keys on the authenticator.
  Never send PINs, credential material or recovery secrets to models or logs.
  No unrelated credential enumeration/deletion, PIN reset or OS login changes.
  Offer a separately enrolled backup before the user enables strict enforcement.
- [ ] **YK-03 · Exact, one-use approval.** The trusted host creates a canonical,
  versioned intent covering project, candidate/content digest, operation, destination,
  limits and policy digest. Bind it to a cryptographically random nonce and expiry
  through the selected standard protocol. Independently verify the enrolled key,
  expected challenge/client-data hash, RP/origin where applicable, signature and
  required UP/UV; never trust model-returned `approved: true`. Handle supported
  counter semantics, including zero counters, without treating a counter as replay
  protection. Atomically consume the approval and reject concurrent reuse.
- [ ] **YK-04 · Enforce at the effect.** Recheck current intent, policy, candidate
  bytes and authority immediately before dispatch/apply/configuration changes.
  Authenticate helper IPC and reject cross-project, stale or widened requests.
  Revoke outstanding grants on lock, sleep, restart, key revocation or policy
  change. Journal consume/dispatch outcomes; an uncertain crash outcome must not
  automatically replay a destructive action. This does not establish exactly-once
  execution or eliminate the existing filesystem/host-compromise limitations.
- [ ] **YK-05 · Revocation and recovery.** Design a pre-enrolled backup or separately
  approved recovery procedure before strict enforcement. Lost/unavailable keys
  block protected work unless that procedure succeeds. Recovery authorizes only
  its defined re-enrollment/revocation scope, not arbitrary work or publication.
  No silent emergency bypass; stopping work remains possible throughout.
- [ ] **YK-06 · Negative tests and actual device acceptance.** Test wrong credentials,
  challenge/RP/origin/signature/UP/UV, malformed responses, every mutated intent
  field, expiry, revocation, concurrent replay, crash/resume and scope widening.
  Verify OFF/cancel without a key, backup recovery, exact final-diff approval and
  bounded cancellation. Then test an approved real key on the selected macOS 27
  host; do not exhaust PIN retries or reset existing credentials. Fixtures alone
  cannot establish USB compatibility, prompts, UV or hardware enforcement.
- [ ] **YK-07 · Optional bounded session grants.** Only after one-use approvals
  pass: explicit project/model/tool/destination scope, hard TTL, action/budget limits,
  no sliding renewal and immediate policy revocation. Check each action at the
  broker; sensitive out-of-scope actions need fresh approval. Removing a key does
  not retroactively undo an assertion or prove continuous user presence.

> [!WARNING]
> **Specification only: Nisi does not yet enforce hardware-key approval.** The
> existing workflow callbacks cannot protect every proposed native action.
>
> **Why this matters:** a connected key or successful authentication demo would
> not prove the final file/configuration operation passed the required broker.

> [!CAUTION]
> **A key approves authentication, not code correctness or a trustworthy host.**
> An ordinary touch key has no trusted display of the proposed Nisi transaction.
>
> **Why this matters:** compromised host software can misrepresent the approval
> screen or bypass host-controlled checks. Preserve this threat-model limitation;
> neither a touch nor a verified signature certifies the generated artifact.

> [!CAUTION]
> **Strict key enforcement needs recovery planning.** An unavailable key may
> intentionally prevent protected work until an approved recovery path succeeds.
>
> **Why this matters:** convenient silent fallback would defeat the policy, while
> missing recovery can lock out legitimate work. Backup and revocation are part
> of acceptance, not optional claims added after launch.

**Review and evidence ceiling:** Fable 5.1 provided a bounded, tool-disabled design
review; Daybreak audited the current authority seams; Codex incorporated the
one-use-first, exact-action and non-authorizing-consent findings. This task changes
private documentation only. No YubiKey runtime, hardware, enrollment, authentication
or recovery test ran. All YK implementation gates remain open.

**Primary references:** [Yubico libfido2](https://developers.yubico.com/libfido2/),
[assertion verification](https://developers.yubico.com/libfido2/Manuals/fido_assert_verify.html),
[Apple physical security-key authentication](https://developer.apple.com/documentation/authenticationservices/supporting-security-key-authentication-using-physical-keys),
[Yubico WebAuthn guide](https://developers.yubico.com/WebAuthn/WebAuthn_Developer_Guide/).

### Local Model Steward — discover, use and improve the local model toolkit

**User direction — September 12:** after the hardware/readiness check, Nisi should
find suitable AI models already on the device, recommend settings, control approved
model resources and use them for tasks. It should expand capability by adding or
upgrading models under an explicit user policy. This complements Claude/Codex
connections; it does not require sending local tasks to those cloud providers.

**Definition:** “free local inference” means no per-token provider charge when
execution is actually on-device. It does not mean zero electricity/storage cost,
an open-source license, permission to redistribute weights, or that a cloud-backed
entry is local. No specific model is promoted merely because it is newer/larger.

```text
Hardware/readiness check [native integration pending]
    → registered runtime inventory [first implementation below]
    → verify local execution, license, compatibility and a bounded readiness probe
    → recommend task roles + settings + memory/storage/concurrency limits
    → user approves the project and operating policy
    → acquire model/runtime ownership or a cooperative lease
    → use existing author/reviewer adapter seams + deterministic checks
    → observe outcomes and resource pressure
    → propose a specific addition/upgrade if it fills a measured gap
    → approve download → stage candidate → matched evaluation
    → separate promotion decision → retain rollback → future tasks only
```

#### LM-01 — registered-runtime discovery (implemented first slice)

- [x] Add `hosts/local-models/discovery.mjs`: inert construction; explicit
  `discover()` makes only fixed list GETs to host-registered literal loopback
  origins. No full-disk scan, port scan, runtime startup, credentials, model load,
  inference or download. At most eight runtimes, serial per-instance discovery.
- [x] Normalize LM Studio native v1 `/api/v1/models` and Ollama `/api/tags` into
  immutable inventory. Preserve runtime/model/instance identity, reported size,
  provider digest when available, per-call response digest and observation time.
  LM Studio reports loaded instances; Ollama tags do not establish residency.
- [x] Keep discovery-only authority explicit: every entry has `useAuthorization:
  NONE`, `locality: NOT_VERIFIED`, `providerFee: UNKNOWN`, `license: NOT_REVIEWED`
  and `inference: NOT_TESTED`. The model list cannot authorize the existing adapter.
- [x] Bound body bytes, entries and time; reject duplicates/malformed responses,
  invalid origins and redirects. Auth failures are reported without automatic
  dialogs/retries. Partial runtime failure is not an empty successful discovery.
- [ ] Accept live provider compatibility and native UI integration: verify exact
  installed versions, shared-runtime behavior and protocol/auth support in an
  approved session. No actual installed model catalog was queried for this slice.

Usage for an explicitly registered endpoint (not a startup auto-scan):

```js
import { createLocalModelDiscovery } from './hosts/local-models/discovery.mjs';
const discovery = createLocalModelDiscovery({
  runtimes: [{ id: 'mac.models', provider: 'lmstudio-v1', origin: 'http://127.0.0.1:1234' }],
});
const inventory = await discovery.discover(); // metadata only; never starts inference
```

Defaults: 2-second deadline per runtime, 256 KiB response cap, 256 entries per
runtime; configurable ceilings 10 seconds, 1 MiB and 1,024 entries. The inventory
is an observation, not a persistent registry, file digest verification, hardware
benchmark, authenticated runtime identity or freshness/authorization token.
Additional provider metadata is projected away, never used as executable guidance.
An injected transport is host-trusted. Unknown model license/locality stays unknown.
Timeout/cancellation does not imply the transport settled: later requests are
refused/skipped while its promise is unresolved. The host must retain that client
rather than construct replacements to evade quarantine. This is per-client safety,
not a machine-wide connection limit; injected transports must return control
promptly because JavaScript cannot preempt a synchronously blocked implementation.

**Verified scope:** 23/23 discovery tests, including a real ephemeral loopback HTTP
fixture (not a model service); the complete portable suite passes 284/284 and the
existing scoped structural gate passes. Six deliberately broken discovery copies
are caught, with failed-test counts `[1, 3, 1, 2, 2, 1]` for origin, authority,
body cap, final deadline, unsettled-transport quarantine and duplicate-model guards.
These results do not establish actual installed-provider, native UI or inference
compatibility. Fable 5.1 reviewed the design; Luna audited reusable seams; Daybreak
reviewed the implementation and the fixes for three concrete findings. Codex is
the sole integration/test owner. No runtime/model installation or configuration
was changed. All published-checkout and frozen-import material stays untouched.

#### LM-02 — task-fit recommendations and consent (pending)

- [ ] Native host supplies fresh memory pressure, thermal/power state, available
  storage and runtime availability. Recheck before heavy tasks; avoid hourly
  maximum-load stress tests and do not treat model file size as resident RAM.
- [ ] Rank only compatible, permission-eligible candidates for draft, review,
  summarization, embeddings and other demonstrated roles. Support Apple Foundation
  Models through its own availability/consent contract and approved MLX/llama.cpp
  runtimes later; don't scrape protected app storage or import arbitrary model code.
- [ ] Separate installed/listed, loaded, inference-tested, locally executing,
  license-permitted and Nisi-managed states. Check structured output and served
  identity with bounded, non-sensitive probes under approved local resource limits.
- [ ] Show a recommended configuration with reasons and uncertainty, explicit
  data destinations, concurrency/token limits and local-only default. Save an
  approved policy so ordinary jobs need not repeatedly ask the same question.
  Permission expansion, runtime changes and model revision changes invalidate the
  relevant approval and require revalidation; no silent paid/cloud fallback.

#### LM-03 — owned runtime control and task use (pending)

- [ ] Bind approved runtime/model/revision/role to existing local-chat adapters;
  treat factory creation as configuration, not permission to send project data.
  Enforce current task/project consent and resource admission at each dispatch.
- [ ] Load/unload only instances Nisi owns or holds an explicit cooperative lease
  for. Do not evict another app's active model, kill shared servers or silently
  change global auto-eviction/configuration. Unsupported control remains read-only.
- [ ] Serialize incompatible loads, prioritize foreground work, limit idle work,
  and reconcile cancellation/drain before releasing capacity. OFF stops new work
  immediately; uncertain cleanup is visible, never shown as safely stopped.
- [ ] Test model mismatch, busy external owner, memory-pressure changes, process
  restart, lost lease, partial load and cancellation. A local queue is not a global
  hardware governor; the native host must enforce and demonstrate its actual scope.

#### LM-04 — approved additions and upgrades (pending)

- [ ] Recommend additions only for a stated capability gap. Present exact source,
  model revision/quantization, license, download size, peak storage needs, estimated
  working memory and compatibility; unsupported claims are visibly unknown.
- [ ] Stage approved downloads in Nisi-managed storage using trusted sources and
  pinned identities/digests. Resume/cancel safely; inspect integrity and license
  metadata before loading. No arbitrary model repository scripts, auto-installers,
  sudo, secret extraction, redistribution or automatic acceptance of new terms.
- [ ] Keep the working version intact. Evaluate candidates on the same held-out
  tasks, validators, budgets and documented settings; compare quality/refusals,
  latency, memory and actual reported usage. Larger/newer is not automatically
  better; record adverse and inconclusive results without promotion.
- [ ] Separate download, evaluation and promotion approval. A user may opt into
  bounded maintenance for pre-approved sources/licenses/budgets, but it cannot
  widen permissions or weaken checks. Finish current runs on their pinned versions.
- [ ] Test insufficient disk, interrupted/corrupt download, changed upstream bytes,
  license change, incompatible runtime, failed evaluation and rollback. Retain old
  weights and records; deleting material requires a separate retention decision.

> [!WARNING]
> **A local endpoint is not proof of local inference or free use.** Ollama can
> expose cloud-offloaded models through its local server, and any local process
> can impersonate a service on a port. Inventory reports cannot establish either
> network behavior or license permission. This implementation authorizes no use.
>
> **Why this matters:** automatically selecting a listed model could send private
> data off-device, incur costs or disrupt another app. Native runtime verification,
> project consent, resource ownership and compatibility tests are separate gates.

> [!CAUTION]
> **An upgrade is a candidate, not an improvement.** Do not overwrite the current
> model or auto-promote based on name, size, popularity or a self-reported score.
>
> **Why this matters:** a replacement may be slower or less reliable on this Mac.
> Keep the old version and promote only after scoped evaluation and authorization.

**Engineering handoff:** LM-01's callable metadata client is the only implemented
addition here. LM-02–04, authenticated runtime connectors, native UI, automatic
selection/lifecycle and model downloads/upgrades remain open under NX-07/U02-06.
Preserve the prior 261-test/native-checkpoint record as history; the new discovery
checks extend the portable suite, not native or live-model acceptance. Source-bound
results are retained in `docs/verification/2026-09-12/local-model-discovery-checkpoint.json`.

**Primary references checked September 12:**
[LM Studio native model list](https://lmstudio.ai/docs/developer/rest/list),
[LM Studio model-management API](https://lmstudio.ai/docs/developer/rest),
[Ollama model list](https://docs.ollama.com/api/tags),
[Ollama cloud offloading](https://docs.ollama.com/cloud).

### Ordered merge work

- [x] **NX-01 — Protect the baseline.** Create a detached private next-version
  working copy from exact Nisi commit `02a0b39`; leave the current checkout and
  package identity unchanged. Set the private working copy's development version
  and package publication guard. Coordinate write ownership with the other task.
- [x] **NX-02 — Reconcile the product direction.** Record the full merger under
  Nisi, separate current implementation from research, and preserve private
  release restrictions and historical evidence. This is planning acceptance only.
- [x] **NX-03 — Freeze the imported source.** Stage the selected Veritas source,
  contracts and tests with per-file digests. Exclude generated builds, dependencies,
  credentials, live incident stores, raw historical runs and protected evidence
  roots. Record missing dependencies rather than silently trimming functionality.
  **Source-freeze acceptance only:** 225 byte-matched files, including the four
  root files omitted by the initial subtree copy. The retained historical test
  fixture is explicitly inventoried. Runtime dependencies are recorded, not
  provisioned; imported code and native integration are not accepted by this check.
  See the [NX-03 evidence and dependency review](docs/verification/2026-09-12/veritas-import-review.md).
- [ ] **NX-04 — Integrate deterministic verification.** Run one real Nisi
  candidate through a fixed Veritas check profile using the host adapter seam.
  Bind exact bytes, task/candidate identities, profile, source and returned record.
  Preserve unavailable, malformed and contradictory evidence as incomplete/refused.
  Include negative controls and targeted broken implementations before acceptance.
  Then demonstrate the adapter inside the complete repository workflow specified
  below; a successful native probe alone is not that demonstration.
  **Partial checkpoint:** a three-file captured disk fixture now runs through
  separate fixed Swift children inside the real Nisi engine. A one-file fixture
  repair triggers three fresh checks; lifecycle faults and exact final-report
  linkage are tested. Separate group schemas preserve legacy v1/v2 meanings.
  The subsequent workspace slice materializes exact trees and executes an inspected
  Node fixture: baseline FAIL 8/10, corrected PASS 10/10, protected harness unchanged.
  The latest slice runs that inspected fixture through an owned async Node adapter
  in the real engine, with fresh trees and receipts across repair. Static-check,
  author and reviewer callbacks in that demonstration remain fixtures. Combined
  Swift/Node fixed-fixture host/report acceptance is now complete. The live-model
  repository demonstration and general host isolation remain open, so NX-04 is
  not closed by that bounded acceptance.
- [ ] **NX-05 — Integrate failure observations and history.** Specify and test
  the report-to-incident mapping, trust source, redaction, project isolation,
  idempotent replay versus conflicting input, revocation, retention and write
  uncertainty. Nisi's report-store acknowledgement is not durable ledger proof.
  The current owner now has explicit persisted maintenance and tested logical
  revocation across fresh-process reopen (1442-check checkpoint). Authenticated
  host controls, scheduled retention, old-caller migration, crash qualification
  and incident eligibility remain open; this milestone is not closed.
  Current caller checkpoint: the legacy bundle has test-only callers; the real
  repository host now has explicit metadata preview/capture (1472-check checkpoint),
  and the private CLI separately collects an operator decision (1510-check checkpoint).
  Terminal approve/decline paths are tested in real PTYs. This is not authenticated
  identity, a native app run, incident eligibility or automatic failure learning.
  New candidate checkpoint: source-bound per-check `incidentPreview()` is wired
  into the real host and covered by the 1535-check acceptance. It separates
  recorded failures from operational/interrupted evidence and preserves repair
  history. Transient candidates are not persisted/native-admitted incidents;
  independent execution attestation, current admission and learning remain open.
  Selected-storage checkpoint: the actual host now admits one explicitly declared
  failure observation per row and provides fresh disk queries for revocation,
  expiry and pruning (1567-check checkpoint,267 selected pins). Real filesystem
  capture/fresh-process reopen passed separately. These are unauthenticated
  metadata observations, not native incident admission or learned policy input.
  Operator selection and source-checkout types now have 1598-check acceptance,
  plus separately pinned real terminal approve/decline and fresh-child proofs.
  Native reconstruction, authenticated controls and broader milestone gates remain open.
- [ ] **NX-06 — Integrate evaluated prevention.** Carry forward policy candidates,
  explanations and paired trials; retain adverse results and require independent
  adjudication before influence or promotion. Keep optional learning OFF by default.
- [ ] **NX-07 — Integrate execution and native host.** Reconcile the scheduler,
  provider adapters, actual cancellation/drain and user approval under one owner;
  then connect the optional macOS 27 app. Retain existing native failures and
  untouched protected roots. Do not retry unresolved authentication automatically.
  Specify interrupted-run behavior explicitly: refuse stale state and distinguish
  safe restart from validated resume. A stored report is not a checkpoint API.
- [ ] **NX-08 — Integrate modular extensions.** Bring the neural/plugin/traveler
  interfaces and visual graph into Nisi as explicitly experimental modules, with
  versioned capability contracts, resource limits, reversible state changes and
  evidence-based activation. Expanded scope remains part of the merger, not a
  prerequisite invented for the first deterministic adapter.
- [ ] **NX-09 — Verify the complete next-version product.** Run the existing Nisi
  checks, relevant imported checks and cross-component end-to-end tests on exact
  source snapshots. Test refusal and rollback as well as successful paths; audit
  every retained feature's integrated status. Measure real-task usefulness and
  regression against the retained baseline; test counts alone are not product value.
  Include a clean TypeScript consumer and the matched evaluation below. Keep
  contract fault-injection results separate from real-task outcome measurements.
- [ ] **NX-10 — Decide release.** Select the release version after compatibility
  review, resolve exact artifact/legal requirements, test installation and the
  supported platform matrix, and obtain scoped release authorization. A private
  branch, filename, hash or successful test is never permission to publish.

### Repository cutover — Nisi replaces Veritas after the merger

Local configuration inspected on September 12:

- `/Users/louiscalata/nisi` already targets `github.com/louiscalata/nisi.git`.
  The private next-version worktree shares that existing Git repository. Do not
  create a competing Nisi repository or overwrite its public v0.1 history.
- `/Volumes/SharedChami/Veritas Local Repository` has no configured `origin`.
  This is a local configuration observation, not a search proving that no other
  Veritas repository exists. No remote was renamed, archived or deleted here.

After engineering merger acceptance, perform the local cutover as one verified
migration. Public changes still wait for NX-10's exact-artifact disclosure and
release approval:

- [ ] Reconcile the complete retained feature inventory and exact accepted Nisi
  tree, including required native, failure-history, prevention and module work.
- [ ] Make the accepted Nisi workspace the sole active checkout/project target.
  Reconcile any later Veritas or public Nisi changes before switching ownership;
  preserve dirty work and coordinate any remaining tasks or handoffs.
- [ ] Update active product names, project navigation, local runner paths,
  package/build configuration and development instructions to Nisi. Validate
  links, commands and tests after any local folder move; no blind path replacement.
- [ ] Retire the old Veritas working directory from active development. Preserve
  a verified source/evidence archive and a clear successor pointer; do not delete
  source, adverse results, disclosure history or protected incident records.
- [ ] Keep historical `veritas-*` receipt IDs, hash domains, source manifests and
  already-issued schema meanings intact. New current product presentation is
  Nisi; historical identity is not cosmetic branding to rewrite.
- [ ] After applicable release gates and scoped authorization, land the accepted
  merger in the existing Nisi repository and report the exact commit and CI
  separately. Only if another remote actually needs retirement, resolve its
  identity and action explicitly before renaming, archiving or changing it.

**Completion criterion:** one active Nisi product/repository, a verified retained
Veritas history, working updated paths and a reconciled feature/evidence inventory.
Retiring the name is not a substitute for integrating the software.

**Immediate engineering task:** connect disk capture and all required artifacts
to the repository process host; represent
each child explicitly rather than hiding multiple executions in a v1 receipt.
The new v2 bundle now preserves the tested one-artifact native PASS/engine-timeout
pair without changing either fact. Existing v1 refusal remains a compatibility
test. Expand the inventory/aggregate contract explicitly for multi-child stages;
do not quietly broaden v1 or claim all files were checked by the one-artifact adapter.
General admission, isolation and the full repository runner remain open.
No whole-product percentage is assigned while feature-level acceptance is still
being reconciled. The entire merger remains active; completing one bridge does
not finish failure intelligence, the native host or experimental modules.

### v0.2 implementation plan — September 12 upgrade decision

**Purpose:** turn the comparison feedback into executable engineering work, not a
larger feature checklist. U02 work packages refine the existing NX/RP/DX/EV items;
they are not a second completion counter. Full U02 implementation gates remain
open; the snapshot, receipt and trusted-static capture slices have the narrower
acceptance recorded below.

**What the analysis changes:** prioritize the missing repository host, honest
execution evidence, safe interruption and usable package contracts before adding
more orchestration features. Keep the full Veritas merger; prove its benefit in
successive private milestones instead of presenting imported code as a product.

**Source findings driving this plan:**

- `workflow/engine.mjs` and `docs/workflow-api.md` define a changed-file snapshot,
  not a checkout or patch applier. Omitted files are unchanged; deletion and binary
  editing are not represented. Repository and unchanged-test identity therefore
  need a host-level binding in addition to the candidate fingerprint.
- `package.json` has no declaration entry or explicit `files` allowlist and still
  exports `./*`. The private development tree contains confidential imports.
- The imported `VeritasCore/DeterministicChecks.swift` validates JSON, Markdown and
  text structure. It is not a compiler, unit-test runner or code-correctness oracle.
- `VeritasCore/PreventionPolicyEvaluation.swift` explicitly makes its V2 registry
  process-local proposal metadata only. Experiment execution, durable retention,
  policy authority and pipeline integration must be built, not inferred from its name.
- The frozen native `Package.swift` targets macOS 27. Earlier 26.x discussion is
  not native compatibility evidence. The portable Node library must remain usable
  without the Swift executable or Apple Foundation Models.

> [!WARNING]
> **Package and execution boundaries must be designed before the demonstration.**
> A wildcard export is not an intended private/public API boundary, a temporary
> directory is not a sandbox, and `private: true` does not prevent a Git push.
>
> **Why this matters:** a convenient demo or local archive can accidentally include
> confidential files or execute candidate-controlled code with host permissions.
> U02-00/U02-03 must establish exact scope; no package or execution authorization
> is granted by writing this plan. No leak is established by this finding.

#### Delivery order and dependency map

| Work package | Existing milestone | Depends on | Deliverable and acceptance label |
|---|---|---|---|
| **U02-00 · Host and evidence contract** | NX-04, RP-01/02/03, DX-03 | NX-03 | Reviewed versioned contract, scope and refusal fixtures; `CONTRACT_READY`, not runtime acceptance |
| **U02-01 · Real Swift verifier bridge** | NX-04 | U02-00 | Exact candidate reaches the actual native gate; `NATIVE_BRIDGE_VERIFIED` on the tested platform only |
| **U02-02 · Repository execution host** | RP-01–05, NX-04/09 | U02-00 for host fixtures; U02-01 for merged demo | `FIXTURE_HOST_VERIFIED` is useful partial acceptance; combined `REPOSITORY_DEMO_VERIFIED` also requires the Swift bridge and approved live-model lane |
| **U02-03 · TypeScript and private packaging** | DX-01/02, NX-09 | U02-00; final artifact waits for included implementations | Typed supported imports and inspected local archive/consumer; `PRIVATE_CONSUMER_VERIFIED` |
| **U02-04 · Recovery and failure history** | DX-03, NX-05 | U02-02 execution receipts | Durable run observations, safe restart, incident admission and replay/refusal tests; `FAILURE_HISTORY_VERIFIED` |
| **U02-05 · Evaluated prevention** | NX-06, EV-01–03 | U02-04 and independent trial protocol | Candidate → experiment → adjudication → reversible approved influence; `PREVENTION_EVALUATED` only with actual retained trials |
| **U02-06 · Scheduler, providers and native host** | NX-07 | U02-02/04 host and recovery contracts | One execution owner, truthful drain, scoped model consent, working Mac UI; each platform/provider has its own result |
| **U02-07 · Experimental modules** | NX-08 | U02-06 owner/capacity contract; U02-05 for learned influence | Versioned plugin/traveler interfaces and graph with reversible activation; experimental capability evidence, not a general learning claim |
| **U02-08 · Complete-product acceptance** | NX-09, then NX-10 | All required preceding gates | Exact-tree regression, matched evaluation, compatibility and private installation; release remains a separate decision |

**Parallel work:** after U02-00, the native bridge, process runner and declaration
drafts can be developed independently with bounded file ownership. The benchmark
protocol can be prepared early, but outcome runs wait for a frozen executable
candidate. Durable history follows real execution receipts; prevention must not
learn from fabricated demo records. Native/module design can proceed alongside
history work, but integrated acceptance waits for the shared owner contracts.
The repository process host can be fixture-verified before the Swift bridge is
ready. Only the combined NX-04 repository demonstration depends on both, and a
live-model outage does not invalidate the separately recorded fixture acceptance.

#### U02-00 — define the smallest trustworthy host contract

Snapshot/preparation and execution-receipt/bundle APIs are now implemented under
`hosts/repository/` and `receipts/`, with focused fixtures under `tests/` as detailed
in the two checkpoints below. Other host targets remain proposed. Keep the frozen `integrations/veritas` source
unchanged; add bridge code outside it or use an explicitly versioned build overlay.

- Freeze an admitted full input manifest, including unchanged dependencies and
  protected test/harness bytes. Specify UTF-8 paths, case/Unicode collisions,
  symlink refusal, byte/count limits and allowed changed files. Start with a
  trusted, dependency-free fixture; refuse deletion, binary edits and unreviewed
  package installation rather than inventing support in the v1 candidate schema.
- Use fixed executable identity plus an argv array, never a generated shell
  string. Pin the allowed runner, cwd, environment allowlist and test harness;
  arguments cannot choose arbitrary scripts. Do not copy secrets or complete
  environment dumps into a receipt.
- Define a host-owned versioned receipt containing run/task/attempt/candidate
  bindings, initial manifest, per-file bytes/digests, profile/ruleset/source/build
  identity, command/tool/environment identity, process outcome, output digests
  and explicit truncation, deadline/cancellation/drain states. Metadata and hashes
  remain statements from the trusted host, not cryptographic proof of honest execution.
- Keep Nisi v1 stage schemas unchanged. Store richer receipts separately and add
  a versioned host run bundle linking the exact existing report digest to the
  receipt inventory. A bundle reader must reject missing, extra-authority,
  contradictory or cross-linked records; do not stuff new fields into closed v1
  evidence or make `COMPLETED` imply host verification.
- Separate requesting cancellation, rejecting a late answer, actual child closure,
  provider drain, workspace retention and durable recording. Unknown drain blocks
  reuse of affected execution capacity. Safe restart uses a fresh run ID and
  original snapshot; resume is unsupported until separately implemented and tested.

**Exit:** source-reviewed schemas, clear trust boundaries and failing/passing
contract fixtures exist before adapters are implemented. Include mismatched
baseline/test/profile/candidate, out-of-root/symlink paths, forged PASS,
unavailable runner, duplicate result, unknown schema and interruption cases.

#### U02-00 checkpoint — captured repository text and candidate preparation

**Implemented privately:**
[snapshot contract](hosts/repository/snapshot-contract.mjs),
[focused tests](tests/repository-snapshot.test.mjs), and
[bounded mutant harness](scripts/test-repository-snapshot-mutants.mjs).

- `createRepositorySnapshot({ files })` captures immutable well-formed text,
  sorted paths, UTF-8 lengths/digests and a domain-separated repository identity.
  It admits 1–1,024 files, at most 1 MiB UTF-8 per file and 8 MiB total. Its initial
  ASCII path profile rejects case aliases, inconsistent directory spelling,
  file/directory-prefix collisions, traversal and unsupported path spellings.
- `prepareRepositoryCandidate({ baseline, task, candidate, authorId })` preserves
  existing Nisi v1 validators and fingerprints. It also validates the full task
  path scope, checks every protected baseline digest, combines allowed changed
  files with unchanged dependencies, and binds baseline/task/candidate/resulting
  full-snapshot identities. Omitted files are preserved; deletion/binary edits
  remain unsupported. Final combined paths and resource limits are rechecked.
- Factory-issued in-process baseline handles reject serialized/forged substitutes.
  This is a shape/identity safeguard, not authenticated source provenance or
  permission. The new helper returns `executionStatus: NOT_RUN` and
  `authorizing: false`; it neither changes v1 report semantics nor performs work
  on the user's filesystem.

**Checked on Node 24.18.0 / macOS arm64:** 17 focused tests pass; `npm run check`
passes its structural check and all 201 local tests; all four targeted mutants
fail exactly their one expected test after a passing control. The import checker
still matches 225 files against the retained manifest, with no original-root
recheck or native-runtime acceptance. Existing AFM/provider suites use stubs or
injected transports, not live-model inference.

**Corrections retained:** the first focused run was 14/15 because a test helper
replaced intentionally invalid `undefined` with a default value. The input was
corrected, not the validator weakened. Defensive review then found the repository
profile missing from the task's full allowed-path list; that was fixed and is
covered by a targeted mutant. A later review incorrectly classified an existing
configurable property's descriptor update as illegal; direct Node evidence and
the passing test resolved that false positive without a spurious code change.

The first full check stopped at missing TypeScript. The exact locked 6.0.3 package
was installed from the local cache with `npm ci --offline --ignore-scripts
--no-audit --no-fund`; the unchanged check then passed. This provisions the Nisi
root dependency only, not the imported Veritas tooling/runtime dependencies.

**Evidence:** [source-bound checkpoint and retained adverse results](docs/verification/2026-09-12/u02-snapshot-checkpoint.json).
Luna provided negative-test design and Daybreak a bounded defensive review.
Claude requests and their actual outcomes are retained separately in that record.
The first ladder failed OAuth; after Louis reported login ready, a full-source
Fable request timed out at its 45-second cap. A smaller identity/trust-boundary
request then completed with PASS and no issues, explicitly reporting
`claude-fable-5-1` (plus auxiliary Haiku usage). This confirms Fable 5.1's bounded
review, not a completed full-source audit. Unknown earlier-attempt usage is not zero.

> [!IMPORTANT]
> **This helper binds captured text, not observed execution.** At this snapshot
> checkpoint, file admission, symlink checks, secret screening, disk materialization,
> execution receipts and report-bundle validation were separate pending work.
> The following checkpoint adds receipt/bundle consistency; real execution was
> pending at that historical snapshot and is partially implemented further below.
>
> **Why this matters:** a snapshot digest changes when an untouched dependency
> changes, but only the future host and receipt reader can use that binding to
> refuse stale execution evidence. No standalone snapshot is a PASS, certificate,
> durable checkpoint, sandbox or permission to apply/publish changes.

U02-00, NX-04 and the full merger remain open. At this earlier checkpoint the next
slice was the receipt/bundle contract, now recorded below. Richer fields must not
be silently added to v1 reports.

#### U02-00 checkpoint — execution receipt and final-report links

**Implemented privately:**
[execution contract](receipts/repository-execution-v1.mjs),
[19 focused tests](tests/repository-execution-receipt.test.mjs), and
[five-mutation harness](scripts/test-repository-receipt-mutants.mjs).

| Seam | Implemented behavior | Explicit limit |
|---|---|---|
| `createExecutionExpectation(...)` | Uses an issued immutable preparation; binds run, task, attempt, candidate, baseline, materialized snapshot, check and versioned profile | Caller selects the fixed executable digest, argv, environment-profile digest, workspace-root cwd, platform and bounds; creating the expectation is not approval to run them |
| `readExecutionReceipt(record, expected)` | Closed object reader; exact binding, process/drain states, output byte/digest/truncation summaries and result consistency | Validates host statements only; no wire parser, subprocess, native gate or independent output-byte verification |
| `createHostRunBundle(context, receipts)` | Links the exact final engine report to the complete ordered static-check/test receipt inventory, including earlier repair attempts | Trusted caller supplies the actual engine report and independent expectations; these are not inferred from the untrusted bundle |
| `readHostRunBundle(bundle, context)` | Rejects stale report digests, missing/extra/duplicate/cross-linked receipts, mixed snapshots, conflicting statuses and substituted stop reasons/codes | Returns `CONSISTENT`, `executionVerified: false`, `authorizing: false`; not a replay of the full v1 state machine or authenticated execution proof |

The profile uses fixed argv data, never a generated shell string. The first cwd
profile is only `.` (the admitted workspace root); disk admission and process
allowlisting are still future host work. No raw environment dump or output text
is placed in these receipts. Hashes do not automatically redact secrets: real
capture/retention still needs its own screening and access policy.

**Status mapping:** `PASS → PASS`, `FAIL → FAIL`, `NOT_RUN → NOT_RUN`, and
`ERROR / INCONCLUSIVE → UNAVAILABLE`. PASS and ordinary FAIL require a started,
closed, drained process, no signal, interruption, host error or truncated output,
and duration within the profile bound. PASS additionally requires exit zero and
an empty reason. FAIL needs a nonblank reason and can describe a semantic failure
with exit zero. ERROR requires an explicit host error code; INCONCLUSIVE retains
uncertainty. Missing required metadata is refused, not defaulted into success.

Engine stop records and rich receipts stay separate. An exception stop requires
matching ERROR/code/reason. An `ABORTED` or `DEADLINE_EXCEEDED` stop requires
INCONCLUSIVE, the matching reason, cancellation requested and no host error code;
the drain field still says whether closure is known. A v1 binding-plus-reason
record alone cannot fabricate a complete execution receipt.

The new `nisi/host-final-report/v1` digest covers the **final returned report**.
Existing `storedReportSha256` continues to cover the **preliminary stored report**.
No v1 schema, fingerprint domain or completion meaning was changed. A bundle's
`allChecksReportedPass` refers to all retained check receipts, not workflow/review
success: it stays false after a successful repair if an earlier check failed,
and may be true when a later reviewer rejects the candidate.

**Verification:** `npm run check` passes the existing scoped structural check and
all **220 local tests**. The new focused suite passes **19/19**. Its five targeted
mutants each fail exactly the intended test after a passing control. All four
snapshot mutants also still fail their intended tests; the imported manifest
still matches **225 files**, without rechecking the original source directory.
Provider suites remain stub/injected-transport checks; receipt fixtures call the
real Nisi engine with synthetic callbacks, not candidate programs or live models.

**Review and correction:** Fable 5.1 reviewed the bounded status proposal and
returned FAIL with ambiguity findings, then PASS on the explicit resolutions.
The CLI reported `claude-fable-5-1` and auxiliary Haiku usage for both successful
calls. A larger first packet timed out; its review is NOT_RUN and usage unknown.
Luna supplied negative-test design. Daybreak found a real missing reason/error-code
link: a stop could otherwise be reclassified through generic UNAVAILABLE. The
added regression failed before the fix and passes after it; Daybreak's focused
recheck found the issue resolved. Fable's review is not a full-source audit.

**Evidence:** [source-bound receipt checkpoint](docs/verification/2026-09-12/u02-receipt-checkpoint.json)
retains the failing regression, before-change files, final checks, mutation records
and collaborator dispositions. Older checkpoints remain historical, not silently
rebound to current source hashes. No public checkout edit, commit or push occurred.

> [!WARNING]
> **A consistent receipt is still a statement from its host.** This slice does
> not establish that a command ran, that descendants drained, that permissions
> were enforced or that a report was durably stored. Issued handles also cannot
> be restored from JSON as authenticated resumable work.
>
> **Why this matters:** the next host must capture real outcomes from a bounded,
> authorized runner and retain the matching report/manifests. Never generate
> production PASS evidence by copying these synthetic fixtures. Unknown drain
> must prevent reuse of affected execution capacity once that scheduler is wired.

**Still open in U02-00:** filesystem admission/symlink and containment rules,
secret screening, executable/harness allowlisting, explicit process isolation,
receipt transport and durable retention/restart contracts. The receipt slice is
tested; U02-00 is not yet globally CONTRACT_READY. Next finish these boundaries
and implement U02-01/U02-02 against the seams. Failure history, evaluated
prevention, the native host and experimental modules remain in the full merger.

#### Capture lane — retained pre-implementation scope review

The first real disk-capture increment will accept an **operator-selected trusted,
static, local fixture directory before any generated code runs**. It will capture
only an explicit finite path manifest into the existing immutable snapshot seam.
Directory traversal is not recursive discovery of everything in a user's project.

- Reuse the tested path/text/count/byte profile; reject unsupported symlinks,
  nonregular and hardlinked files, invalid UTF-8 and size/count overflow.
- Bound reads and close every owned handle on success and failure. Record drift
  checks and refuse detected changes. Do not log raw content or absolute personal
  paths in error messages unnecessarily.
- Treat a static, trusted local tree as an explicit precondition. Network shares,
  concurrent writers and adversarial directory replacement are unsupported in
  this first fixture lane. Parent-component checks and a no-follow leaf open do
  not establish atomic capture or hostile-tree containment.
- Keep secret screening and execution isolation separate. Capture is not a
  permission grant, proof of secret-free input or enforceable wall-clock bound
  on arbitrary filesystem I/O. Future execution uses separately materialized
  retained bytes in a host-owned workspace and a reviewed runner/isolation profile.
- Acceptance must use real task-owned filesystem fixtures, including refusal
  cases and handle cleanup; pure metadata fixtures do not prove disk behavior.

Fable 5.1 returned PASS on this bounded **scope-only** review, with its exact
model ID reported by the CLI. Its preceding broader draft request timed out and
remains NOT_RUN. No disk-capture implementation or test was produced by either
request; the subsequent implementation is recorded below. This reviewed first
increment does not narrow the full Nisi merger.
The [repository-transition checkpoint](docs/verification/2026-09-12/u02-repository-transition-checkpoint.json)
retains these outcomes and Louis's sole-repository decision.

#### U02-00 checkpoint — real trusted-static disk capture

**Implemented privately:**
[disk reader](hosts/repository/disk-capture.mjs),
[15 real-filesystem tests](tests/repository-disk-capture.test.mjs), and
[four-mutation harness](scripts/test-repository-disk-mutants.mjs).

```js
await captureRepositoryFromDisk({
  root: operatorSelectedAbsoluteDirectory,
  paths: explicitManifestPaths,
  profile: 'operator-trusted-static-local-v1',
});
```

The required profile explicitly acknowledges the **caller precondition**. It is
not evidence of user consent, verified local mount type or writer exclusion.
The module supports POSIX flags on Darwin/Linux; only macOS arm64 was tested.
It is separate from, and not imported by, the portable workflow core.

- Reuses the snapshot path grammar and collision checks before any filesystem
  I/O. Reads only the explicit manifest; no recursive discovery or Git hooks.
- Observes the full manifest before the first content open. Refuses symlinks,
  nonregular files/FIFOs, hardlinks, files on a different device from the root,
  more than 1,024 files, over 1 MiB per file or over 8 MiB total.
- Uses read-only, no-follow, nonblocking leaf opens; bounded `size + 1` buffers
  and explicit-position partial reads. Early EOF, growth and observed identity/
  metadata changes cause refusal. A final path sweep checks previously read files
  and observed directories, without claiming atomicity or hostile-race protection.
- Decodes fatal UTF-8, preserves BOM bytes, checks byte-for-byte re-encoding and
  refuses NUL-bearing binary data. This is an explicit text-only runtime profile,
  not a general binary repository importer.
- Closes each owned handle before admitting its content. If closure cannot be
  confirmed, returns `DISK_CAPTURE_CLOSE_UNCONFIRMED` and retains the prior refusal
  code; it does not emit a successful snapshot or silently retry a possibly
  already-closed descriptor. Filesystem error messages are reduced to bounded
  codes, not copied with source contents or personal absolute paths.
- Returns a factory-issued immutable snapshot that the existing preparation
  contract accepts, plus a digest-bound capture observation. Its status is
  `CAPTURED_TRUSTED_STATIC_INPUT`, with `executionStatus: NOT_RUN`,
  `atomicSnapshot: false` and `authorizing: false`.

**Evidence:** 15/15 focused tests use actual generated local files, including
valid 1,024-file and 8-MiB inputs. Narrow test-only wrappers exercise short reads,
in-place changes, final-pass drift, read errors and uncertain close outcomes.
No production injection API was added. Tests remove only their generated temporary
fixtures and verify removal; original source, mutation variants and raw results
are retained in the [source-bound checkpoint](docs/verification/2026-09-12/u02-disk-capture-checkpoint.json).

`npm run check` passes its existing scoped structural check and **235/235 local
tests**. All four disk-reader mutants fail exactly their expected test after a
passing control. The imported **225-file** source freeze still matches; original
root recheck and native runtime acceptance are not implied.

Fable 5.1 returned PASS on the bounded read/UTF-8/close source review, with exact
model ID and auxiliary Haiku usage recorded. One preceding local command used
the wrong packet filename and returned NOT_RUN before model invocation; it was
corrected and retained. Daybreak reviewed the full reader within its stated
boundary, found no concrete issue and ran the 15-test suite. Luna supplied
negative-test design; Codex wrote and accepted the implementation.

The API choices were checked against the official Node [filesystem documentation](https://nodejs.org/docs/latest-v24.x/api/fs.html)
and [TextDecoder documentation](https://nodejs.org/api/util.html#new-textdecoderencoding-options).
The latter confirms that `ignoreBOM: true` retains the mark; this behavior is also
tested on the actual Node 24.18.0 runtime. Documentation discovery is not native
Linux/Windows or application integration evidence.

> [!WARNING]
> **Trusted-static capture is not hostile-filesystem isolation.** This reader
> cannot prove there are no concurrent writers or that a mount is local. A parent
> directory replaced concurrently can defeat path-based prechecks. Metadata checks
> do not make the capture atomic; `O_NONBLOCK` is not a deadline for arbitrary I/O.
>
> **Why this matters:** use this first lane only for its stated operator-trusted,
> static local input. It does not clear arbitrary repositories or generated code
> for execution. Secret screening, real workspace isolation, command allowlisting,
> process/drain ownership and durable records remain distinct implementation gates.

**Next:** a real fixed-profile Swift bridge using the retained native verifier,
then actual repository runner integration. Keep the full history/prevention/native/
modular merger and Nisi-only repository cutover in scope; this reader does not
complete U02-00 globally or the whole product.

#### U02-01 — connect the actual Veritas deterministic gate

**Partial implementation — standalone native kernel now executed.** Full U02-01
and NX-04 remain open until owned process execution, multi-file inventory and the
workflow/static-check projection are connected and tested.

- Build a private Swift command using the retained `ArtifactSnapshot`,
  `StrictJSONDocumentValidator` and `DeterministicGateRunner`. Inspect dependency
  closure and retain a source/build manifest; do not replace it with a JS imitation
  or use a historical fixture oracle as the production checker.
- Use an explicit bounded request/response frame. Verify every expected file and
  fixed profile, all required outcomes, exit status and output bounds; a zero exit
  or a line containing PASS is insufficient. Keep richer native evidence in the
  U02-00 receipt, with a separately validated Nisi static-check projection.
- Preserve native statuses. Explicit native FAIL may become Nisi FAIL;
  `NOT_RUN`, `ERROR`, `INCONCLUSIVE`, transport errors or missing checks never
  become PASS. Declare the unavailable/refusal mapping and retain the native cause.
- Test UTF-8 byte-limit differences between Nisi and Veritas, malformed/duplicate
  JSON, missing sections, reordered/missing file results, stale builds, wrong
  profiles, extra output, crash, deadline and cancellation. Targeted mutants must
  each fail a named expected test with a passing unmodified control.

**Exit:** a real subprocess verifies valid and invalid artifacts, closes cleanly,
and produces correctly bound evidence on the exact tested Mac toolchain. This
accepts the bridge, not code correctness, AFM behavior or a whole-repository run.

##### September 12 checkpoint — real Swift artifact kernel

Implemented outside the frozen import:

- `hosts/swift-verifier/main.swift`: a standalone fixed-profile command linking
  the unchanged `ArtifactSnapshot`, `StrictJSONDocumentValidator` and
  `DeterministicGateRunner` source. No app, UI, model service, file chooser,
  candidate compilation or candidate-code execution is involved.
- `hosts/swift-verifier/protocol.mjs`: an immutable request for one file in an
  issued Nisi preparation and a closed native-report reader. The frame binds the
  preparation, path, raw artifact digest, opaque host expectation, fixed profile,
  original rules fingerprint, source fingerprint and complete request bytes.
- `hosts/swift-verifier/build.mjs`: a developer-only build from byte-checked
  source copies in a unique local `.build` directory. It retains commands,
  compiler/SDK observations, source and executable digests. Imported sources and
  their historical names/digest domains remain unchanged.

The input is a four-byte big-endian header length, an exact all-string JSON
header of at most 4,096 bytes, and one raw artifact of at most 1,048,576 bytes.
The read loop bounds the whole frame with a one-byte overflow sentinel; after
parsing the header, a separate guard enforces the artifact cap. It is synchronous
and requires the external host to enforce elapsed time and interruption.

The fixed profiles are JSON object/array structure, Markdown `Testing`/`Rollback`
markers, and UTF-8 text with no mandatory sections. Completed native FAIL is a
valid record with exit zero; a protocol refusal exits two. A nonzero exit or zero
exit alone is not a verdict. Native invalid UTF-8 preserves the actual FAIL and
NOT_RUN checks and aggregates to INCONCLUSIVE. The current pure reader refuses
that result because an issued Nisi text preparation must be valid UTF-8; the
adapter must retain its cause as unavailable, never grant PASS.

**Verified on this Mac:** Xcode 27 selected, Apple Swift 6.4, macOS 27 arm64.
Seven actual native tests and six pure protocol tests pass (**13/13**), with
**53** native fixture subprocess observations in the final unmodified control.
The portable structural check and **241/241** tests pass separately. Existing
provider tests remain stub/injected-transport evidence, not fresh model inference.
Three compiled Swift mutants and three JS reader mutants are each caught by
exactly one named test, with a passing control. Raw source copies and adverse
outputs remain in `.build/swift-kernel-mutants-CQsFQP/`.

**Collaboration:** Fable 5.1 returned the focused bounded-read draft, with the CLI
also reporting auxiliary Haiku usage. The larger first request timed out and is
retained as NOT_RUN. Codex integrated the source and ran acceptance. Luna supplied
read-only negative-control guidance. Daybreak reviewed the complete kernel seam,
reported no actionable findings and independently ran the six pure tests; it did
not run native builds. The last added marker-limit test changes no reviewed code.

The first native compile failed on a missing `try` in the new wrapper; the original
failed build is retained at `.build/nisi-swift-kernel-5NyZK7/`. After that fix, six
native tests passed but one pure test compared ordinary and null-prototype objects;
the test comparison was corrected, not the contract. The pre-correction test and
native outputs remain at `.build/nisi-swift-kernel-nae8ch/`.

> [!WARNING]
> **Structure checks do not establish document completeness or code correctness.**
> The retained Markdown implementation counts heading-marker lines even inside a
> fenced example, and does not assess section content. A dedicated native test
> records that limitation rather than treating it as a completeness guarantee.
>
> **Why this matters:** These profiles may contribute narrow checks; meaningful
> requirements coverage needs an additional versioned verifier before such a claim.

> [!CAUTION]
> **The standalone kernel is not a complete Nisi repository host.** At this
> historical checkpoint, async cancellation/drain ownership and receipt projection
> were pending. The following checkpoint adds that one-artifact adapter; multi-file
> integration and full native-host acceptance remain open.
> The source fingerprint and executable digest are observations, not attestation.
>
> **Why this matters:** A valid report or a passed fixed fixture cannot authorize
> another run, prove an honest host, or support whole-app/release acceptance.

The next checkpoint adds bounded adapter deadline/cancellation and selected
cleanup-fault tests. Native EINTR/EPIPE fault injection, actual host-kill/power-loss
recovery, multi-file selection/order, hostile build-tree protection and complete
repository execution remain unverified. Do not add the
native suite to portable installation or npm lifecycle scripts. The supported
private developer commands are `node --test tests/native/swift-kernel.test.mjs`
and `node scripts/test-swift-kernel-mutants.mjs` on the stated Mac toolchain.

See the source-bound [kernel checkpoint](docs/verification/2026-09-12/u02-swift-kernel-checkpoint.json).

#### U02-01 checkpoint — owned one-artifact Swift adapter

**Implemented privately:** `owned-child.mjs`, `reservation.mjs`, `executor.mjs`
and `adapter.mjs` under `hosts/swift-verifier/`. The build factory now issues
deeply frozen identity-checked manifests. No imported Swift source or Nisi v1
workflow/evidence schema was changed by this slice.

```text
Issued Nisi preparation + fixed artifact/profile + actual issued build
    → inspect fixed source/binary → exclusive durable reservation
    → spawn ONLY reviewed Swift kernel [fixed argv, environment and cwd]
    → bound output capture + cancellation/deadline + observe actual close
    → validate exact native bytes/report + recheck build observations
    → immutable execution receipt → existing Nisi static-check schema

Workflow may stop waiting before process cleanup completes
    → adapter.settled() collects bounded cleanup records separately
    → unknown closure keeps lane quarantined and reservation retained
    → lateObservations() exposes late-spawn containment without rewriting receipts
```

**Operational scope:** `operator-exclusive-static-local-v1` is mandatory. This is
one selected artifact and one direct child per receipt, not an arbitrary command
runner, multi-file verification, descendant scheduler or execution sandbox.
Candidate bytes are data; only the reviewed checker executes. Current native tests
use issued in-memory preparations, not the previously implemented disk reader.

The owner preserves the first cause, keeps draining/counting after its retained
output cap, distinguishes exit from close, and never infers closure from a kill
request. Late spawn after grace receives a best-effort kill without changing the
published record or clearing quarantine. Executor and adapter expose a frozen
snapshot of up to 16 late entries, keyed to `rawObservation.lifecycle.operation`;
this in-memory list is not a durable audit journal. Per-executor run/attempt replay
and conflicting reuse are refused; this is not cross-restart idempotency.

The final immutable answer is built in two parts: freeze the larger prepared
payload, sample the last abort/monotonic guard, then create new small frozen
metadata copies with that final duration/cause. The prepared object is never
mutated. “No launch” means the launch function was **never called**; absence of a
spawn event alone cannot release the marker. A timeout-before-spawn retains it
unless actual close was observed. Existing markers are not reclaimed by PID or
age; explicit manual reconciliation is the only current recovery path. There is
no clear-marker API, automatic resume or power-loss guarantee.

**Verified on Node 24.18.0 / macOS 27 arm64, Xcode 27 / Swift 6.4:**

| Check | Actual result | Evidence ceiling |
|---|---|---|
| Portable `npm run check` | Scoped structural PASS; **261/261** tests | Includes provider stubs/injected transports, not live AI |
| Lifecycle and reservation checks | **20/20**, included in 261 | 14 lifecycle-double tests and six real local-filesystem fixtures |
| Real Swift executor/adapter suite | **11/11**; 12 retained operation observations | Nine started children; three refusals/pre-cancel outcomes; one selected artifact per operation |
| Owner/reservation broken variants | **6/6 caught** after passing control | Four lifecycle-double and two local-reservation mutations; one mutant trips two expected tests |
| Kernel/protocol regression mutations | **6/6 caught**, exactly one expected failure each | Three compiled Swift and three reader mutations; control **13/13** (seven native, six pure) |

The native suite demonstrates actual PASS/FAIL, refusal of changed build copies,
overlap/replay rejection, reservation exclusion and cancellation. Its completed
workflow uses fixture authorization/reviewer callbacks and one real JSON behavior
assertion. It is **not** a live-model repository repair or independent review.
The first adapter integration run was **7/8**: an extra `path` field violated the
closed Nisi finding schema. It was removed and the path included in the permitted
message; the engine contract was not weakened. The adverse source/output is retained.

**Review:** Fable 5.1 provided the initial bounded design review and follow-up,
both FAIL with concrete safeguards/wording concerns; they remain retained.
Codex implemented the owner/reservation guards and clarified no-launch, final-copy
ordering and manual recovery. Luna supplied negative-case design. Daybreak's
read-only source review found the late-spawn, final-duration and inaccessible
late-evidence defects; these were corrected and tested. It verified the final
copy and no-launch predicates by inspection, not a native test run. Fable's final
bounded wording/source-excerpt clarification returned **PASS with no issues**;
this does not close the explicitly OPEN host findings or replace source/runtime
acceptance. All three calls reported `claude-fable-5-1` plus auxiliary Haiku usage;
the checkpoint retains their actual usage rather than claiming total token savings.

> [!WARNING]
> **An exclusive-directory assumption is not hostile-filesystem protection.**
> Pre/post source and executable hashes do not attest which image the OS executed.
> Path-based reservation release does not contain a same-account actor replacing
> entries between checks. Both findings remain OPEN for a general-purpose host.
>
> **Why this matters:** use only the stated operator-controlled lane. Do not run
> untrusted generated programs, claim adversarial isolation, or automatically
> clear a crash marker while earlier work might still exist.

> [!CAUTION]
> **Native outcome and workflow acceptance are different facts.** A tested case
> produces genuine native PASS, then Nisi TIMED_OUT. The current v1 bundle refuses
> that pair with `HOST_STAGE_STATUS_MISMATCH`; neither underlying record is altered.
>
> **Why this matters:** both facts must remain intact, not become invented native
> cancellation or late-output workflow success. The newer v2 checkpoint above
> now handles this tested one-artifact pairing; v1 remains unchanged. Complete
> multi-file host integration is still open.

**Next acceptance items:** disk-backed multi-file
host with explicit per-child receipts; actual baseline failure/repair/fresh checks;
selected native I/O/crash faults; complete source isolation and live-model gates.
Event-loop timers do not preempt synchronous work; the owner budget starts after
bounded build preflight, while Nisi retains its independent workflow deadline.

Private commands: `node --test tests/native/swift-executor.test.mjs` and
`node scripts/test-swift-owner-mutants.mjs`. They are deliberately not npm install
or portable lifecycle hooks. NX-04/U02-01/U02-02 and full merger remain open.
See [source-bound adapter checkpoint](docs/verification/2026-09-12/u02-swift-owner-checkpoint.json).

#### U02-02 — make one repository change end to end

**September 13 partial integration checkpoint — native display and canary data.**
Accepted modules were copied byte-for-byte, with source SHA256 checked before and
after placement. Only module/read-fixture paths changed in relocated tests:

| Product module | SHA256 before = after | Relocated tests passing |
|---|---|---|
| `hosts/macos-xpc/native-probe-summary.mjs` | `c048df362405ffbd3053de93aedd05a0b51ec5c64417d19c9ee5ea22a6d90056` | 13/13 |
| `hosts/macos-xpc/native-canary-adjudicator.mjs` | `cf875eaa7adf335ceab49ae16f9941e2d9b5b9780f5ca15c22eea4c97405de00` | 19/19 (11 adjudication + 6 table + 2 baseline) |
| 2026-09-13 display-escape correction · `hosts/macos-xpc/native-canary-adjudicator.mjs` | Correction: `cf875eaa7adf335ceab49ae16f9941e2d9b5b9780f5ca15c22eea4c97405de00` → `444acc75db292d69c62ce0360f536ea73292317f78b36409acc619774b44e9eb` | Added 7 display regression tests; verification pending. Display hardening only; U02-02 remains open. |
| `hosts/macos-xpc/native-canary-adapter.mjs` | `ac9c9cfaacfad91a27f08d2daee461b1f0580892509dc76693ccd36bd35a5c8f` | 17/17 (14 adapter + 3 baseline) |

- [x] **Pure native display/canary modules in the product tree:** the reviewed
  exports and 49 relocated tests pass. Frozen stdout is retained at
  `tests/fixtures/native-canary/inherit-run-node.stdout` (781 bytes; SHA256
  `51612e7ba818bfe7dd2a42d46e8c0cf8e84332d63f2562132842e9879bc3dddc`).
  Two unchanged work-order package fixtures preserve baseline test assertions.
  The adapter/adjudicator tests exercise the product sibling modules together.

This is module placement and fixed-data verification. No native launcher/UI was
wired or executed. Future host wiring must retain raw stdout and the mapping
report, supply trusted same-run identities, use the complete fixed v1 matrix and
preserve `isolationAccepted: false`. Extra metadata remains outside adjudication.
Generated-code isolation, service/descendant settlement and U02-02 acceptance
remain open. Exact test path substitutions and before/after hashes are retained
in the [placement manifest](docs/verification/2026-09-13/five-work-order-integration/placement-manifest.json).

The first inspected example now exists: a dependency-free Node retry-setting
project with configuration, source, Markdown instructions and ten fixed behavior
checks. The one-file correction preserves configured zero retries; configuration,
instructions and test harness remain protected. The Swift gate's structural lane
and Node behavior lane now run together under the reviewed-fixture host.

- [x] **Static-local materialization slice:** original preparation creates an exact
  task-owned tree; PRE/POST observations reject detected inventory/identity/byte
  drift and close uncertainty. Scope excludes hostile writers and sandboxing.
- [x] **Reviewed behavior fixture slice:** separate baseline and repaired trees
  execute with real Node, yielding FAIL 8/10 and PASS 10/10. Setup ERROR cannot
  claim assertions. The fixture helper is synchronous and not a product runner.
- [x] **Reviewed-fixture asynchronous runner and execution receipts:** fixed Node,
  argv/environment, bounded direct-child lifecycle, strict result reader, PRE/POST
  and runtime observations, two-layer refusal and original-issued adapter conversion.
  This is a static-local fixture lane, not descendant containment or a sandbox.
- [x] **Real Node fixture in the Nisi engine:** baseline FAIL 8/10 → one-file
  repair → new tree and fresh PASS 10/10 → fixed reviewer → COMPLETED. Static
  stage skipping is tested; author/static/reviewer callbacks remain fixtures.
- [x] **Combined reviewed-fixture host and inspectable evidence:** real Swift gate
  plus Node behavior tests, both-owner settlement, original-issued configuration/
  candidate-bound bundle and exact report-linked proposed changes. Fixed native
  suite passes 25/25. Serialized bundles remain data, not durable replay authority.
- [ ] **Complete repository demonstration:** approved live-model author/review,
  accepted generated-code isolation and reproducible user-facing evidence flow.
  The checked fixture slices do not close U02-02 or grant general execution authority.
- [x] **Non-authorizing review staging:** exact before/after bytes and protected
  materialized inventory; original per-owner session, expiry/revocation, bound
  decision and one-time data handoff. 34 tests; no execution or suite registration.
- [ ] **New-candidate execution boundary:** reviewed isolation and execution
  approval/consumer, exact issued preparation, truthful cleanup and fresh checks.
  Connect the staging seam to the live CLI without reviving a completed old run.
- [x] **One-use approval assertion slice:** exact bindings, original identity,
  no-refund claim and clock/revocation/callback checks; 88 new fixed-data tests,
  122 focused with earlier review tests. No actual grant, isolation or live owner.
- [x] **Bounded Mac isolation investigation:** targeted denials observed, but the
  working profile needed broad reads. PARTIAL_CAPABILITY_ONLY is not an accepted
  generated-code execution boundary.

- Materialize the admitted baseline plus candidate in a task-owned workspace.
  Protect the baseline and acceptance harness; verify candidate/output file scope
  after execution. For the first example, execute only source-reviewed fixture
  programs. Live generated code requires explicit approval and an accepted isolation
  boundary; output inspection alone does not sandbox its execution.
- Implement an asynchronous process runner with fixed argv, output caps, deadline,
  cancellation, observed exit/close and platform-appropriate child tracking.
  Test descendants/late output and refuse successful cleanup while drain is unknown.
- Bind code tests to the materialized tree and protected harness, not just changed
  files. Use a machine-readable test result with a defined assertion unit; do not
  turn exit 0, test names or human console text into invented assertion counts.
- Demonstrate baseline failure → candidate A → failing check → repaired candidate B
  → fresh complete checks/tests/review. A prior A PASS, changed untouched dependency,
  altered harness, missing reviewer or forged identity must not complete B.
- Emit a proposed diff and inspectable report/bundle. Do not apply to the user's
  checkout, commit or publish. Keep the current small examples as tutorials,
  not evidence of this new repository host.
- Document separate deterministic and approved live-model commands with actual
  dependencies, identities and usage coverage. Distinct reviewer IDs alone do not
  establish independence; keep author and acceptance-tool control separated.

**Exit:** another local reader can rerun both lanes and validate their retained
evidence. If live access is unavailable, record fixture acceptance and live
`NOT_RUN`; do not grant the complete repository-demonstration label.


- **2026-09-13 integrated checkpoint — fixed-run summary:** `hosts/macos-xpc/native-canary-summary.mjs`, SHA256 `92590f11d91071fb7d5c1a0208958ef7c094d06a723fd38c5827fc63e6fb9c41`; **13/13 tests** (10 functional + 3 baseline), included in the product **1230/1230** check with zero failed/skipped/cancelled/todo. Not closed: host wiring of the bundle to the XPC runner, real-filesystem durability, cross-process locking, crash qualification, or incident admission. U02-02/U02-04 and overall milestone acceptance remain open; progress stays **30% — 3 of 10**. [Integration receipt](docs/verification/2026-09-13/evidence-chain-integration/receipt.json).

#### U02-03 — make the implemented library usable and packageable privately

- [x] **Portable typed-consumer slice, Node 24:** eleven integrated declarations,
  explicit 18-path mapping, exact staged private archive, offline script-disabled
  install, positive/negative TypeScript and fixed runtime checks with source pins.
- [x] **September 13 native-chat typed package slice:** accepted
  `types/native-chat.d.ts` copied unchanged; SHA256 before/after
  `4513f9e6e75f94b34f6216fae05a5f22e2c7c7baf8aa7dfd51f43fedcfbfbf51`.
  Both `./adapters/native-chat` and `./adapters/native-chat-v1.mjs` have matching
  type/default exports. The runtime, protocol dependency and declaration are in
  the exact package/contract allowlists. The unchanged consumer oracle uses
  package self-reference imports; a new synthetic alias/lifecycle runtime check
  runs in the checkout and installed package without model/native execution.
  `npm run test:types` passes six consumers; `npm run check:private-package`
  passes with 27 archive files, 39/39 negative controls and 8/8 runtime tests.
  The archive inventory and receipt were inspected and hashes match installed
  bytes. This is still a portable Node 24 partial checkpoint.

The product suite's existing exact-inventory test expects 24 files; the required
three native-chat files make 27. Initial integrated `npm run check` reports
1,159/1,160 passing, solely this stale cardinality assertion. A narrow Louis
decision is pending for the two literal changes `24` to `27`; no protected
work-order assertion changed. Baseline was 1,092/1,092; 67 work-order tests and
one new package runtime test were added. Structural verification passed 8/8
mutation fixtures and 8/8 allowed fixtures, with zero source findings.

**2026-09-13 follow-up (Astra):** The `24` → `27` literal change was applied ([closing corrections](docs/verification/2026-09-13/five-work-order-integration/closing-corrections.md)); the suite is **1170/1170** per the [formatter/display escape receipt](docs/verification/2026-09-13/formatter-display-escape/receipt.json). This supersedes the pending decision and failing-suite status retained above.

- [ ] **Remaining complete consumer scope:** supported Node 22 lane, intentional
  native artifact inventory/installation, complete merged feature exports and
  cold-start product rehearsal. The portable package is not the native Nisi app.

- Inventory current entry points and supported deep imports before replacing the
  wildcard. Define explicit exports, runtime `files` allowlist and an intentional
  private native-artifact inventory. Record any breaking import change for version
  review; do not silently remove established supported paths.
- Prefer bounded `.d.ts` additions for implemented JS APIs over a whole-language
  rewrite. Test readonly data, literal status unions, async adapter signatures,
  required fields and invalid extra fields in positive/negative consumers. Types
  assist developers; runtime evidence readers remain authoritative.
- Rehearse a lifecycle-script-disabled local archive inventory, then install the
  inspected tarball in a clean private consumer. Cover documented Node 22/24 lanes
  when those runtimes are actually available; missing lanes stay NOT_RUN.
- Explicitly exclude raw imports, confidential design, historical/live evidence,
  credentials, test-only native probes and build caches from the portable artifact.
  Optional native files get a separately reviewed private bundle. Verify both the
  archive contents and import accessibility; `exports` alone does not exclude files.

**Exit:** JavaScript and TypeScript consumers use the inspected supported exports;
negative consumers fail as expected; the exact private package inventory is known.
No registry or Git publication is part of this work package.

#### U02-04 — persist trustworthy history and recover honestly

**Latest September 13 checkpoint:** [journal maintenance](work-orders/journal-maintenance-v1/roadmap.md)
adds explicit durable TTL maintenance to current owner v2, preserving IDs,
fingerprints and revocation links. Thirty-two lifecycle groups/two type checks
join the 1442/1442 portable check. Actual filesystem writes and two fresh-process
reopens verify payload removal and replay byte stability; an injected committed
readback failure remains quarantined until a new owner reconciles. This supersedes
earlier claims that no persisted lifecycle has been exercised, but does not close
authenticated consent, scheduling, native incidents, crash/power-loss acceptance
or U02-04. Older checkpoints below retain their historical scope.

**September 13 disk-store work-order checkpoint:** [run-journal-store](work-orders/run-journal-store/roadmap.md) passes 16/16 protected store tests and 2/2 baselines after local packet installation; raw-byte readback and file/directory fsync reporting verified in temporary-directory tests, with same-process product serializer/reopen compatibility; host integration, writer locking, power-loss acceptance and U02-04 closure remain open.

- [x] **September 13 pure run-journal contract checkpoint:**
  `history/run-journal-v1.mjs` is the reviewed reference copied unchanged,
  SHA256 before/after
  `dee9f490c091000b2560cd9464d945885e7f341091b87dde9ae4f2b7cdbd359e`.
  `tests/run-journal.test.mjs` passes 18/18; only its module import changed.
  The prepared runner is now `scripts/test-history-mutants.mjs`, adapted for
  the product source/oracle paths, relocated oracle hash and `.build` evidence.
  `node scripts/test-history-mutants.mjs` caught 8/8 one-site mutants against
  18 tests each. Failed-test counts by mutant, in runner order: 6, 3, 1, 5,
  1, 1, 1, 1; zero skipped or cancelled. Accepted source and oracle remain intact.

This checkpoint covers pure observations, duplicate/conflict handling,
retention/redaction/revocation and serialized-prefix refusal. Host integration,
filesystem storage, read-back/locking/fsync durability, fresh-process persisted
reopen, crash qualification and incident admission remain open. Payload-count
retention does not bound permanent identity metadata or payload byte/depth cost.
Serialized history is non-authorizing; this does not close U02-04/NX-05.
Measured mutation evidence is retained in
`.build/history-mutants-dee9f490c091/summary.json` and the integration receipt.

- Build the host journal/bundle storage and adapt qualified observations to the
  retained incident-ledger contract. Specify atomicity, read-back, locking,
  capacity, retention and crash behavior; a callback acknowledgement is not proof
  of durability under every power-loss or filesystem condition.
- Record bare reports, authorization failures, missing evidence and cancelled runs
  as explicitly unverified/operational diagnostics where appropriate. Only
  execution-qualified observations may feed failure-family evaluation. Unknown
  outcomes are not confirmed model failures and must not be silently discarded.
- Bind project, run, attempt, stage, candidate and receipt identity. Identical
  replay is idempotent; the same identity with different content is a conflict.
  Test cross-project leakage, redaction, expired/revoked observations, corrupt
  records and interrupted writes. Keep uncertain writes uncertain until reconciled.
- On restart, identify interrupted work, refuse stale PASS reuse and reconcile
  prior effects before issuing a new run. Test crashes before/after each durable
  boundary. Do not promise universal exactly-once execution or auto-resume.

**Exit:** actual persisted incidents can be read after process restart, correctly
attributed and revoked, without duplicate eligible occurrences or silent success
on an uncertain write. Loss of optional history may reduce capability, never
manufacture history or a required acceptance result.


- **2026-09-13 integrated checkpoint — fixed-run entry builder:** `history/fixed-run-journal-entry.mjs`, SHA256 `ba888a4f4d5b1b78f799045e44fbdfe79b75545847ab9b3ed2673fd7b353585c`; **11/11 tests** (8 functional + 3 baseline), included in the product **1230/1230** check with zero failed/skipped/cancelled/todo. Not closed: host wiring of the bundle to the XPC runner, real-filesystem durability, cross-process locking, crash qualification, or incident admission. U02-02/U02-04 and overall milestone acceptance remain open; progress stays **30% — 3 of 10**. [Integration receipt](docs/verification/2026-09-13/evidence-chain-integration/receipt.json).
- **2026-09-13 integrated checkpoint — disk store:** `history/run-journal-store-v1.mjs`, SHA256 `1356028b65f9f8b96e3b9ec8ba3bfbb4968092af53d00e8b5dfdb11b161f4792`; **19/19 tests** (17 functional + 2 baseline), included in the product **1230/1230** check with zero failed/skipped/cancelled/todo. Not closed: host wiring of the bundle to the XPC runner, real-filesystem durability, cross-process locking, crash qualification, or incident admission. U02-02/U02-04 and overall milestone acceptance remain open; progress stays **30% — 3 of 10**. [Integration receipt](docs/verification/2026-09-13/evidence-chain-integration/receipt.json).
- **2026-09-13 integrated checkpoint — host bundle:** `history/host-journal-bundle.mjs`, SHA256 `97b2554b7fe50812fcb0065197964967d2beefc0c8cb322a38154ec16ebb9894`; **17/17 tests** (14 functional + 3 baseline), included in the product **1230/1230** check with zero failed/skipped/cancelled/todo. Not closed: host wiring of the bundle to the XPC runner, real-filesystem durability, cross-process locking, crash qualification, or incident admission. U02-02/U02-04 and overall milestone acceptance remain open; progress stays **30% — 3 of 10**. [Integration receipt](docs/verification/2026-09-13/evidence-chain-integration/receipt.json).

#### U02-05 — implement the part that can earn differentiation

- Keep proposal registration, evidence-qualified family classification, experiment
  execution, adjudication and promotion as separate contracts. The imported V2
  registry is reusable metadata, not an implementation of those later steps.
- Implement a private paired-trial runner using EV-01–03 below. Separate the tasks
  used to suggest a policy from held-out evaluation; bind the policy definition,
  runner, task set, model/tool settings, baseline and adverse/null results.
- Add an independent review record and scoped promotion authority. Expired,
  revoked, under-evidenced or harmful candidates cannot influence tasks. Keep
  policy use OFF by default; the model that proposes a policy cannot approve it.
- Apply an approved safeguard only before a future task's criteria are frozen.
  It may not weaken immutable checks or expand file/provider permissions. Record
  which version influenced the task, measure regressions and support rollback.

**Exit:** a retained experiment—not a score or occurrence threshold alone—supports
an adjudicated decision. An inconclusive result can validate the evaluation
machinery but cannot earn policy promotion or a claimed prevention improvement.

#### U02-06 / U02-07 — preserve the native and modular direction

- Reconcile existing provider/scheduler/run-owner implementations with the host
  cancellation and journal contracts; do not build competing owners. Foreground
  priority, reservation, consent expiry, OFF and actual drain get cross-component
  tests. Configured slots are not measured hardware capability.
- Connect the native UI to real run, evidence, incident and policy state. Empty,
  failed, cancelled, interrupted and learning-OFF states must be visible. Inventory
  provider requirements and avoid automatic authentication dialogs or retries.
- Inventory every retained module: plugins, traveler contributions, versioned
  strengths, capacity calibration, compaction, idle research and visual graph.
  Give each its own compatibility/state/budget/consent tests and evidence status.
  Plugin installation is not authority to execute arbitrary tools or change policy.
- Preserve original data/digest identities through any naming/storage migration.
  Test reversible migration and historical reads before renaming app paths or stores.
- Keep learned strength updates behind U02-05. Compaction retains originals and
  tests reconstruction/quality before replacement; neither losslessness nor
  non-regression is assumed. Idle research remains opt-in, bounded and cannot
  rewrite active rules. Visual overlap/dichroic connections describe UI, not
  measured computational speed or a literal extra hardware dimension.

**Exit:** separate native, provider, scheduler and experimental-module receipts.
No fixture-only module becomes a trained model claim. Unfinished retained features
remain open; a scope deferral requires an explicit product decision, not a quiet
deletion from the full-merger acceptance list.

#### U02-08 — acceptance, blockers and handoff discipline

The first repository demo, failure history, prevention, native host and experimental
modules each have their own gate. Developer adoption has a separate DX-04–06
validation path below; internal rehearsal is not an independent human trial.
NX-09 requires the conjunction of all required
feature gates and an exact feature inventory; passing one does not complete v0.2.
NX-10 additionally requires compatibility/version review, the exact installable
artifact and existing legal/engineering authorization. No gate grants publication.

| Blocker / risk | Resolution owner and next action | What can proceed now |
|---|---|---|
| Host/receipt schema absent | Codex drafts U02-00; bounded independent reviewer challenges bindings/refusals | Contract and fixture design, no model execution needed |
| Native gate not connected; imported tooling dependencies unprovisioned | Prepare a reviewed private build overlay/runtime; preserve freeze and dependency pins | Host runner and declaration work can proceed independently |
| Candidate execution isolation unresolved | Define trusted fixture scope first; obtain an exact approval/isolation decision before executing generated code; integrated formatter/canary data modules do not grant isolation | Product fixed-data tests pass; host wiring, trusted same-run identities, raw evidence retention and complete execution boundary remain open |
| Claude previously failed OAuth; local fallback previously timed out | User resolves authentication normally if desired; a fresh bounded successful call is required for participation | Codex/Luna planning review; no fabricated Claude sign-off or blocking every coding task on it |
| No integrated prevention evidence; durable history and incident admission remain open | Pure journal module and 18/18 tests plus 8/8 mutants are integrated; implement U02-04 host storage/durability/incident qualification, then U02-05 held-out trials | Exercise the non-authorizing journal contract and record diagnostics/proposals with influence OFF |
| Native-chat archive inventory count needs an explicit test update | Louis decides the narrow existing test change from 24 to 27 files; product suite currently 1,159/1,160, with this sole failure | Types and exact 27-file private archive rehearsal pass; all 67 relocated tests pass |
| 2026-09-13 follow-up (Astra): preceding inventory status superseded | The `24` → `27` literal change was applied ([closing corrections](docs/verification/2026-09-13/five-work-order-integration/closing-corrections.md)) | The suite is **1170/1170** per the [formatter/display escape receipt](docs/verification/2026-09-13/formatter-display-escape/receipt.json) |
| Native OS support and release gates unresolved | Native owner tests exact SDK/OS lanes; Louis/counsel handle retained disclosure/filing decisions | Private engineering only; no promise of macOS 26.x support from a 27-target manifest |
| Prerequisite accepted as measured; generated-code isolation acceptance remains open (separate decision) | Louis, 2026-09-13 ~11:10 PDT: "Approve both, have Astra run the retention pass". Fable reviewed the retained receipts; FIXED_EMBEDDED_NODE_OBSERVED under Node exactly app-sandbox + inherit, host/service app-sandbox only. [Measured inherit checkpoint with corrections](docs/verification/2026-09-13/u02-xpc-embedded-node-inherit-checkpoint.json) | Files-only retention/documentation pass authorized; fresh first-attempt unified-log capture blocked by session sandbox. Launch authorization consumed. Generated-code suitability, DNSConfiguration mach-lookup review, broader XPC-service/escaped-descendant settlement and isolation acceptance remain open |

For each implementation handoff, retain **one objective, allowed files, immutable
inputs, schema/dependency versions, explicit forbidden actions, executable
acceptance commands, required negative tests and output locations**. Commands
listed for a future feature are proposed until the test file actually exists.
OpenCode/local model drafts stay bounded; Codex integrates and independently
checks the diff. Reviewers do not write the same checkout concurrently.

Advance a package only with source-bound checks and a review of adverse cases.
Run existing Nisi checks plus relevant imported/native suites at integration, not
just the newly written tests. No total duration or percentage is inferred from
task count: native process behavior and real-model acceptance remain uncertainties.

**This planning task:** canonical roadmap expanded and system equation synchronized;
no runtime, package behavior, dependency installation or model execution changed.
The earlier 35-test result remains historical evidence for its engine/test snapshot.
Its receipt's old roadmap digest refers to the pre-plan document retained in the
[plan-change record](docs/verification/2026-09-12/v02-upgrade-plan-update.json),
not this expanded roadmap. The later DX-04–06 adoption-planning addition is recorded
in its own [update record](docs/verification/2026-09-12/v02-adoption-plan-update.json);
earlier document hashes remain historical. Implementation sources must be rechecked
when changed.

### September 12 comparison feedback — make the benefit demonstrable

Louis supplied a public-project comparison centered on Nisi `df321f8`. Its useful
engineering conclusion is that a precise workflow contract needs a complete host
example and a measured benefit. This does not replace the full Veritas merger or
turn every feature of a competing framework into a new requirement.

**Current promise:** a bounded coding workflow whose results are tied to the
current task and candidate. **Merged product hypothesis:** those execution-linked
records can support reliable failure observations and evaluated safeguards for
later tasks. Neither statement establishes superior code quality, speed, cost,
unique invention or a completed prevention system.

The selected public documentation was checked again; competitor code was not
executed or comprehensively audited. LangGraph supplies stateful/durable workflow
infrastructure, while Superpowers supplies a skills-based development process.
These are different product layers, not evidence that either lacks mechanisms
that could implement Nisi's rules. [LangGraph.js](https://github.com/langchain-ai/langgraphjs),
[Superpowers](https://github.com/obra/superpowers).

Loop Engineer documents bounded completion plus event-sourced runtime state,
verifier identity/digests and failure-derived evaluation work. Those are meaningful
overlaps to track. Nisi must not describe these broad ingredients as exclusive to
it or infer performance from their presence. [Loop Engineer](https://github.com/SollanSystems/loop-engineer).

**Completed compatibility maintenance:** the public `df321f8` deadline fix was
reproduced against the older private engine, then applied exactly. The newly added
regression failed before the change; all 21 workflow tests and 14 import tests
passed afterward on local Node 24.18.0. This 35-test check is not a rerun of the
public 170-test suite or a merged-runtime benchmark.
[Upstream correction](https://github.com/louiscalata/nisi/commit/df321f8676f1da6b21885ad0781c7bd0549e1f32).

#### First complete repository workflow — NX-04 / NX-09 acceptance

- [ ] **RP-01 — Fix the repository and task.** Retain a small, sanitized multi-file
  repository snapshot with a real defect, immutable requirements and protected
  acceptance tests. Separate this from the existing hard-coded `answer = 42`
  demonstration. No arbitrary user repository or external model input is implied.
- [ ] **RP-02 — Supply the host implementation.** Admit exact allowed file bytes;
  materialize a candidate in an isolated task-owned workspace; run reviewed,
  allowlisted check/test commands with bounded output and deadlines. A directory
  alone is not an untrusted-code sandbox. Candidate execution requires the agreed
  isolation/approval boundary; no model-generated shell command is auto-executed.
- [ ] **RP-03 — Retain execution-linked evidence.** Record the initial repository
  snapshot, candidate, tool/profile versions, exact command and environment
  identity, process result and output digest. Bind the report to these records.
  Candidate hashes stop mix-ups but do not independently authenticate the host.
- [ ] **RP-04 — Demonstrate repair and refusal.** Exercise an actual failing test,
  a changed candidate, fresh tests and review, plus stale prior PASS evidence,
  wrong profile, unavailable verifier, out-of-scope write and cancellation. Emit
  inspectable final proposed changes; applying to the user's checkout remains a
  separate approval. Do not convert missing evidence into success.
- [ ] **RP-05 — Make it reproducible.** One documented private command runs the
  host example with explicit dependencies and reports. Distinguish deterministic
  fixture execution from an authorized live-model repository run. Both are needed
  before claiming a demonstrated AI-assisted repository workflow.

#### Adoption and execution contracts — NX-07 / NX-09 acceptance

- [ ] **DX-01 — TypeScript declarations.** Cover the implemented exported workflow,
  policy, serialization and adapter interfaces; compile positive and negative
  consumer examples against actual package exports. Do not type proposed features
  as implemented APIs. A TypeScript development dependency is not this deliverable.
- [ ] **DX-02 — Private installation rehearsal.** Inspect a local package inventory
  and a clean private consumer install, without registry publication. No invention
  files, live data, credentials or test receipts enter a later public artifact
  without the existing exact artifact review and authorization.
- [ ] **DX-03 — Interruption contract.** Persist enough authorized state to explain
  interruption; define safe restart first. If resume is implemented, version its
  checkpoint, revalidate source/profile/consent and prevent duplicate side effects.
  Do not silently restore stale PASS records. General graph orchestration and
  distributed execution are not added merely to match another product's list.

**September 14 Track 4 checkpoint (Claude, co-author, takeover):** the execution
coordinator draft's three containment defects (owner-callback `this` leak, unobserved
`cancel()` rejection that crashed the process, live owners container) are fixed in
`hosts/repository/execution-coordinator-v1.mjs` (SHA256 `0a70d4c7a515f2e1dbf3e179bb0d035feb2392def45718bf1dfd906ba1b14f8f`) with the independent
oracle `tests/execution-coordinator-containment.test.mjs` (10) beside the author's 12. The
admission decision the draft omitted is a separate pure module,
`hosts/repository/execution-admission-v1.mjs` (SHA256 `5a9d94e141dd06d5d3492b355134a13c795d8750e4523c5277bf0da0b6ec2dd6`), oracle
`tests/execution-admission.test.mjs` (10): consent → scheduler freshness/decision →
measured capacity → host state, fixed order, first failure is the reason; ADMIT / REFUSE /
DRAIN_UNCONFIRMED only; priority never consulted; `executionGranted` always false. Suite
1677/1677. Reviews and receipts under `work-orders/parallel-seven-tracks-v1/track4/`.
Not closed: wiring either module to a real provider, process owner or macOS UI; NX-07 remains open.

**September 14 Track 5 checkpoint (Claude promotes OpenCode's fix):** the experimental
module registry's two containment defects from Claude's adversarial review
(`work-orders/parallel-seven-tracks-v1/track5/evidence/claude-review-20260914.md`) are
fixed in `experimental/module-registry-v1.mjs` (SHA256
`567622623bb274cdf233b83bce5b202413ae8c6e230a00bdc7fbb50cefcde326`, was `b52ed60c…`):
D1 `inspect()`/`disable()` now validate `moduleId`/`versionId` before the Map-key
concatenation (non-string or NUL-padded ids are `INVALID_*_ID`, not misreported as
`MODULE_NOT_REGISTERED`); D2 record cloning counts `Reflect.ownKeys` so hidden and Symbol
keys are `UNEXPECTED_FIELDS`. OpenCode authored the fix and the 20-test containment oracle
in `track5/`; Claude verified the diff is exactly those three hunks, ran the oracle against
the unmodified product (10/20 fail) and the fixed one (20/20), and promoted the oracle as
`tests/experimental-module-registry-containment.test.mjs` (three path edits). Author's 7
tests still green. Suite 1697/1697. Not closed: the registry stays experimental and outside
the staged-package allowlist; NX-05 remains open.

**September 14 native checkpoint — Nisi-branded executable and unsigned bundle (Claude):**
`native/macos/Nisi/` is a Nisi-owned SwiftPM mirror package: the frozen Veritas library
sources reach it through directory symlinks (never copies; the import still verifies
225/225 before and after every build), the app target carries two branded copies that
differ from the frozen originals on exactly three product-name lines, and four file
symlinks. Product `Nisi` compiles in debug and release
(`docs/verification/2026-09-14/nisi-app-bundle/`), and `build-nisi-macos.mjs` assembles an
unsigned `Nisi.app` (Info.plist for a menu-bar agent app, placeholder identifier
`com.louiscalata.nisi`, no icon) and records the linker's ad-hoc signature as exactly
that. A local package dependency was measured and rejected: `VeritasCore`'s
`package`-scoped API is unreachable from a second package identity under Xcode 27.
`tests/nisi-native-overlay.test.mjs` (7) pins the symlink identity, the manifest mirror,
the branding diff and the plist; suite 1704/1704. Not an accepted macOS build: icon,
confirmed identifier, entitlements, signing, notarization, launch, install,
repository-host connectivity and the four frozen app files' wording remain open.

**September 14 Track 3 checkpoint (Claude review, OpenCode free-lane edit, Claude promotion):**
the prevention experiment-plan validator `evaluation/prevention-experiment-plan-v1.mjs`
(now sha256 `470443df194876c39e74444860dd1f376ffbead27bb83a61f498c2f942a9a0d1`, was
`185b6550…`) had two containment defects found by adversarial review
(`work-orders/parallel-seven-tracks-v1/track3/evidence/claude-review-20260914.md`): a
length-lying Proxy defeated every inventory bound because `list()` re-read `length`, and
only the task digest was checked against `trainingDigests`, so a held-out oracle or
baseline that was a training example was DECLARED. Both fixed (length snapshotted once;
all three per-task digests must be disjoint from training). Independent oracle
`tests/prevention-experiment-plan-containment.test.mjs` (17: 10/17 before, 17/17 after)
also pins two-sided bounds, sentinels, echo fidelity, validators at every site and the
golden plan digest `b2ef61ef…`. Author's 9 tests unchanged and green. Suite 1721/1721.
Still a declaration contract only: no trial runs, no measured uplift, no policy influence,
no promotion; NX-06/EV-01–03 remain open.

**September 14 U02-04 integration checkpoint (OpenCode rehearsal, Claude review + install):**
the restart demo and journal-recovery work orders are in the product suite:
`history/bundle-restart-demo.mjs`, `history/recovery-worker.mjs`, their fixed child CLIs under
`tests/fixtures/`, and five tests (28) that spawn a NEW Node process per request against the
live `history/` modules — replay DUPLICATE, conflict CONFLICT with the file untouched,
interrupted RUNNING work persisting across processes, truncated files opening SEALED, foreign
project files never adopted, fsync outcomes exposed. Two review-driven strengthenings: temp
directories are now removed after each run (0 residue; `.scratch/` gitignored) and the demo's
scratch boundary gained the probes that its original oracle lacked (a widened boundary now
fails 8/9). Suite 1749/1749; structural check PASS. Evidence
`docs/verification/2026-09-14/o4-integration/`. Not power-loss durability, not cross-process
locking, not NX-05/U02-04 closure.

**September 14 native follow-up (Louis: "confirm"):** bundle identifier `com.louiscalata.nisi`
confirmed; the remaining app wording rebranded in owned copies of `ShellTruthV1.swift`,
`PrivateVerifiedFileWriter.swift` and `MenuBarView.swift` (exact one-line transforms, pinned),
while the identity-bearing strings were inspected and kept verbatim: the platform-message
prefix (a `hasPrefix` match against the frozen library), the Application Support path
components, the `veritas.*` accessibility ids, the scope id and the project digest seed.
Rebuilt debug and release; the binary's three remaining old-name literals are exactly those
identity strings plus the frozen library's own message. Overlay adversarial review filed at
`work-orders/parallel-seven-tracks-v1/evidence/claude-overlay-review-20260914.md`.

**September 14 NX-07 interruption-contract checkpoint (Claude; Louis: "accept"):** a pure,
deterministic decision over persisted run-journal state answers NX-07's "specify interrupted-run
behavior explicitly: refuse stale state and distinguish safe restart from validated resume; a stored
report is not a checkpoint API": `hosts/repository/interrupted-run-decision-v1.mjs` (sha256
`89f8a08dc5e00078339374062ae667e7ab3573e746ef0e366d7ff6c1600ff5a2`; zero imports, no clock, never
throws) returns only SAFE_RESTART / REFUSE_STALE / RESUME_ELIGIBLE with a fixed seven-cell check
order (journal, project, entries, consent, checkpoint, identity, stages), 25 closed reason codes,
the bundle's own `interrupted` list, and `authorizing`/`executionGranted`/`resumeGranted` always
false. A crashed RUNNING row must be reconciled by a later terminal sibling or a revocation before a
restart is called safe; a versioned v1 checkpoint may make the run RESUME_ELIGIBLE only when it
binds the same project, source pins, profile and consent grant, cites the newest interrupted row,
and every claimed PASS is a confirmed, unrevoked, unexpired SUCCEEDED row created before it, with
no PASS unclaimed. Oracles: `tests/interrupted-run-decision.test.mjs` (18, written before the
code) and `tests/interrupted-run-decision-integration.test.mjs` (4, against the real `history/`
modules through the bundle). Both packet lanes returned no edit (receipts retained); the module is
Claude's integrator fix. Adversarial review (47 agents): ACCEPT_WITH_DEFECTS — the module decided
correctly on every probe; six oracle gaps closed (24 tests), 13/14 review mutants killed, the last
proven equivalent. Design
provenance `work-orders/interrupted-run-decision-v1/`. Suite 1772/1772. Not closed: wiring to a real
owner or the app, drain confirmation (needs live host observations), exactly-once, NX-07 itself.
Same day: OpenCode wrote a target into the frozen Veritas import and built in place (10:22Z);
restored by moves and recorded in `work-orders/afm-internal-builder-opencode-20260914/`.

#### Developer-value validation — DX-04–06 / U02-03 and U02-08

The follow-up assessment adds a missing product question: can another developer
use the library without the authors supplying the integration? The target user is
a developer who already has coding/model tools and needs consistent check/review/
repair coordination. This is a target-user hypothesis, not demonstrated demand.
The full Veritas merger remains in scope; validate adoption before adding optional
breadth simply to match a competitor's feature list.

- [ ] **DX-04 — Private cold-start rehearsal.** After U02-02/03, freeze the exact
  private package, quickstart, dependency requirements, sanitized repository task
  and acceptance oracle. Begin from a clean supported consumer environment using
  only declared resources. Run the useful example, then configure a second
  comparable task without changing Nisi's core. Record confusing terms, missing
  steps and every workaround. An author or AI rehearsal checks the instructions;
  it does not count as an independent human usability result.
- [ ] **DX-05 — Independent developer pilot, approval-gated.** Prepare a protocol
  for a developer who did not implement the feature. Define experience, allowed
  tools/docs, environment eligibility, time limits and observer behavior before
  the trial. Observe without leading; required safety intervention always wins
  over keeping a run unaided. Record help and interruptions rather than silently
  rescuing the result. Do not recruit, invite or send private material until the
  existing exact-artifact legal/engineering gates and scoped disclosure approval
  permit that participant and packet. No such approval or completed trial is
  established here. Lack of a tester leaves adoption validation open, not all
  private implementation blocked.
- [ ] **DX-06 — Compare integration effort with a basic script.** Extend EV-01–03
  to include initial setup and a second-task adaptation, using the same task
  requirements, acceptance oracle, tools, models and runtime budgets. The script
  baseline must satisfy the same required guarantees; missing guarantees count
  as unmet requirements, not free integration savings. Record reusable scaffold
  supplied to each lane and work performed by the participant. Predeclare order
  and use matched task variants or counterbalancing where possible; disclose
  familiarity/carryover when the same person tries both. One pilot finds friction,
  not a population-wide effort or performance advantage.

**Adoption measurement — proposed, no trials or measured targets yet:**

| Measure | Operational definition and source | What the result changes |
|---|---|---|
| **Primary: unaided useful-task completion** | Eligible started participant/task sessions that finish within the declared cap, whose final candidate passes the fixed oracle and whose participant correctly explains the report, without out-of-protocol help. Retain raw numerator/denominator and unique participant/task counts; show assisted completions separately. | Failure or misunderstanding directs work toward onboarding, defaults, API or report design before broader adoption claims. |
| **Driver: effort to first useful result** | Wall time starts when the participant receives access to the frozen instructions/artifact and ends at independently checked completion or the recorded stop. Also record hands-on reading/setup/debugging time, waiting and pauses separately. Timed-out or unfinished trials have an observed duration and stop reason, not a fabricated completion time. | Shows whether dependencies, setup, concepts or execution dominate effort; do not average only successful trials. |
| **Driver: assistance and remaining integration work** | Log observer hints/fixes and participant-written configuration/adapter changes. Record hands-on time for the initial integration and second task, files/interfaces touched and unresolved requirements. Reading allowed documentation is not assistance; undeclared hints or code supplied by the author are. | Finds which integration belongs in a reusable adapter/template. Lines of code alone are not value: fewer lines can hide missing behavior. |

Preserve the EV quality and incorrect-completion guardrails: easier setup does not
justify weaker checks, hidden errors, extra permissions or unreported model work.
Select these measures over star counts, test counts, raw lines of code and general
satisfaction scores because they connect directly to completing the user's task.
Qualitative comments still explain friction; they are not numerical proof of value.

Eligibility and stop categories are fixed before starting. Setup/dependency
failures after an eligible start, abandonment, timeout, assistance and oracle
failure stay in the recorded trial population. Pre-start exclusions and protocol
invalidations are reported separately with reasons, never silently dropped.
Freeze the report-comprehension questions and permitted aids; do not confuse a
tester selecting a displayed PASS with understanding what was actually verified.

Codex prepares the artifact and records the protocol; an observer logs the trial,
an acceptance reviewer checks outcomes, and Louis reviews the evidence and next
product decision. Keep participant data minimal and private. Review results after
each pilot; a revised package/docs version needs a fresh, separately identified
trial. Set numerical acceptance targets only after a baseline, before a subsequent
confirmatory evaluation—not after seeing the result to be promoted.

> [!WARNING]
> **A tester request is not disclosure clearance.** Public v0.1 material and the
> private v0.2 merger have different boundaries. The suggested phrase
> “experimental developer library” can accurately limit a claim, but does not
> authorize a public edit or sharing confidential implementations.
>
> **Why this matters:** product feedback must not bypass the existing private
> development and exact-artifact release gates. Prepare the trial privately now;
> keep external participation and publication explicitly pending.

**Decision rule:** if developers cannot complete the task without author rescue,
fix adoption before adding optional breadth. If Nisi does not justify its added
integration/runtime overhead on matched tasks, simplify or reconsider that layer.
If it helps, state the specific measured benefit and scope. No result, positive
or negative, is predetermined by the decision to keep developing it.

#### Matched evaluation — NX-06 / NX-09 acceptance

**Decision:** does adding Nisi, and then the Veritas layers, improve independently
verified task outcomes enough to justify their integration cost? This is a future
evaluation design; no controlled comparison has been run and no target uplift is
assigned without a baseline. Unit-test count and repository stars were considered
and rejected as product-benefit KPIs; a composite FII would hide the tradeoffs.

- [ ] **EV-01 — Freeze the comparison protocol.** Use the same authorized repository
  tasks, initial snapshots, model identities/settings, tests, review requirements,
  environment and budgets. Compare a basic host using the same tools against Nisi;
  then compare Nisi against Nisi plus the integrated Veritas layer. Isolate policy
  influence in a separate ablation. Do not manufacture a weak no-tests baseline.
- [ ] **EV-02 — Protect evaluation independence.** Keep held-out acceptance tests
  and policy-evaluation tasks separate from drafting and policy-training examples.
  Predeclare eligibility, trial order/repetitions and exclusions. Retain failed,
  cancelled, timed-out, unavailable and null-result runs rather than selecting
  only successes. Repeated runs of one task are not independent tasks.
- [ ] **EV-03 — Capture and report the following measures.** Keep source manifests,
  reports and raw execution records so a second reader can recompute the counts.
  The implementation owner records evidence; the acceptance reviewer adjudicates
  discrepancies. Louis reviews the paired report before promotion or a claim.

| Measure | Definition and evidence | Decision / limitation |
|---|---|---|
| **Primary: independently accepted solutions** | Runs whose final candidate passes the fixed independent acceptance oracle, divided by all eligible started runs; also show raw counts and unique tasks. | Measures task value. Incomplete oracle evaluation is not a verified success; test coverage still limits what correctness means. |
| **Primary guardrail: incorrect completion claims** | Runs labeled `COMPLETED` whose final candidate fails the independent oracle. Show count / all completion claims and count / all started runs; separately show completion claims with unknown oracle results. | Measures misleading success. Refusing every task must not look good: report alongside accepted solutions and blocked outcomes. Unknown is neither correct nor proven incorrect. |
| **Diagnostic: repair attempts** | Total repair invocations across all eligible runs, with per-run distribution and outcomes, from execution records. | Explains overhead; fewer repairs are not useful if more tasks fail or stop early. |
| **Diagnostic: elapsed time** | Monotonic start-to-final-outcome duration per run, including relevant startup, waiting and repair; identify cold/warm conditions. | Compare on the same environment and show spread, not just a fastest run. |
| **Resource guardrail: model usage** | Observed input/output usage for author, reviewer, repair and auxiliary model calls, including failures when reported; report coverage and unknowns. | Unknown usage is not zero. Report cost only with known pricing/accounting; compare spend across all attempts, not successful runs alone. |

For prevention, measure the difference in observed failure rates on matched held-out
tasks with and without the policy. Do not count an unobserved individual failure
as definitely prevented. Report sample size, task-family split and uncertainty;
a small pilot is not a market-wide superiority result. Numeric promotion thresholds
must be fixed before running the promotion evaluation, not selected afterward.

All new RP/DX/EV items remain open. They sharpen the existing engineering milestones;
they do not certify the imported source, resolve release gates, or remove the
native/modular development direction.

### Compatibility rules

- Preserve existing `nisi/workflow` imports and v1 report contracts; add explicit
  new adapters/schema versions instead of silently changing old meanings.
- Preserve `veritas-*` historical digest domains, identifiers and receipts.
  Product naming does not justify rewriting bytes that historical evidence binds.
- Never equate Nisi `COMPLETED` with Veritas acceptance, certification, protected
  authority, actual independent review or permission to apply/publish files.
- The first bridge is private and deterministic, with model participation not run.
  Later provider integration requires its own checks and exact execution authority.
- Teaching follows the code actually integrated. The private system-equation
  companion distinguishes design diagrams from executed behavior.

---

## Retained Nisi 0.1.0 roadmap and implementation record

Canonical project roadmap. Updated September 12, 2026. Product name: Nisi.
Version: 0.1.0. The September 12 documentation and onboarding revision starts
from public commit `fc8bf1b`. Louis authorized applying the review changes and
pushing them to GitHub. Package registry publication remains separate.

## September 12 review plan

- [x] Put purpose, checkout instructions, runnable usage and expected output first.
- [x] Use Workflow Orchestrator in prose; retain public imports and API contracts.
- [x] Define architecture, workflow, pipeline, run, stage, status, outcome and state.
- [x] Keep the kitchen brigade chart and move technical detail into linked guides.
- [x] Move brief neutral background to the end; remove the defensive aside.
- [x] Add Node-version preflight and actionable local-model argument errors.
- [x] Rebuild the editable manuscript without changing the typing behavior.
- [x] Verify the changed source, examples, links, editor and before/after record.
- [x] Complete the GitHub push review and apply its concrete findings.

Publication and hosted verification are tracked per commit in
[GitHub history](https://github.com/louiscalata/nisi/commits/main/) and
[GitHub Actions](https://github.com/louiscalata/nisi/actions/workflows/ci.yml).

## Direction

Put the portable operating rules of **initiate online code mode** into a usable
JavaScript Workflow Orchestrator: fixed scope and acceptance criteria, one author,
separate reviewers, deterministic checking tools, bounded repair, and outcomes
supported by records tied to the exact task and candidate. The assistant skill
remains operating instructions; the library can run without installing it.

Use the kitchen brigade to explain the process, with conventional developer
terms alongside each role. Louis owns the editorial voice and release decisions.
The editable draft is the current README manuscript. The current authorized update includes the September 12 review changes.
Later unrequested editorial work remains local until publication is requested.

## September 11 implementation record

- [x] Public package entrypoint and conventional component names: Workflow Orchestrator,
  File Access Policy, JSON Canonicalizer, Apple Foundation Models Adapter,
  Local Chat Author/Reviewer Adapters, and Static Analysis Check.
- [x] Retain legacy component imports, factories, v1 refusal codes and digest
  domains through additive aliases and compatibility checks.
- [x] Immutable task, policy, changed-file candidate, stage and report contracts.
- [x] Sequential edit and review modes; fixed adapter identities; scope and
  protected-file checks; evidence bound to run, task, attempt and candidate.
- [x] Validate actual assertion counts and stage invariants; refuse missing,
  stale, malformed or contradictory evidence.
- [x] Bounded repairs, repeated-candidate termination, monotonic total deadlines,
  cancellation and distinct incomplete outcomes.
- [x] Optional report-store contract, including required-store failure behavior
  and a report digest. Storage acknowledgements remain trusted host reports.
- [x] Runnable deterministic example with real Node syntax checks, failing then
  passing assertions, one repair, separate callback review and a report written,
  synced and verified by reading it back.
- [x] Restricted integer-only JSON canonicalizer and digest, with scoped static
  analysis and eight forbidden/eight allowed fixtures.
- [x] File-admission checks with captured file identity, bounded reads, UTF-8
  validation, scope, expiry and revocation. Stable parent paths remain required.
- [x] Native Apple advisory adapter with strict returned-evidence validation,
  helper and prompt digests, bounded output and execution. Two real helper calls
  passed on the tested Mac, with advisory caps 128 and 0.
- [x] Experimental loopback HTTP author/reviewer adapters with closed JSON-schema
  requests, strict response validation, size/deadline limits and retained receipts.
- [x] Full automated checks: 165/165 tests passed on each of Node 22.23.2 and
  Node 24.18.0 on macOS arm64. Published GitHub Actions also passed both Linux
  Node 22/24 jobs with 165 tests each at implementation commit `ec12fcb`.
  Native Windows was not run.

Detailed evidence, source hashes and retained outcomes are in
[docs/verification.md](docs/verification.md). Passing checks apply to the recorded
source and environment; they are not a universal correctness claim.

## Local-model compatibility status

- [x] Retain an earlier completed Qwen-author/GPT-OSS-reviewer configuration run,
  including four passing acceptance assertions. It predates JSON-schema requests
  and has no exact source manifest; do not credit it to the current implementation.
- [x] Retain current-schema failures honestly: Qwen returned empty final content
  and was refused; Gemma authored a valid configuration with four passing
  assertions, but GPT-OSS review exceeded the total deadline.
- [x] Complete a current-schema run with Gemma 3 as author and Gemma 4 as
  reviewer: all four acceptance assertions passed; both responses validated.
  Retain source hashes, configured model names, deadline and request receipts.
- [ ] Measure matched tasks before claiming gains in quality, tokens, cost or speed.

The HTTP integration does not invoke the LM Studio CLI, load models, or choose
models automatically. A trusted compatible local server and configured model
names are supplied by the host application.

## September 11 editorial record

- [x] Explain what Nisi is, what it does, its intended value and current limits.
- [x] Map brigade roles to developer terms and render **The Path of One Plate**
  with checks, review, repair and early stopping branches.
- [x] Provide 17 editable sections and an editable About description, Markdown
  export and a standalone editable HTML download.
- [x] Keep typing fields and layout unchanged while typing; update previews on
  blur. Louis confirmed the fix. Isolated Chrome character-entry, Enter/Backspace,
  export byte-parity and standalone HTML reopening checks also passed.
- [x] Remove the editorial Next steps section, add LLM Orchestration, and polish
  the entire draft against the implemented source. This roadmap retains future work.
- [x] Preserve section IDs and original baselines while merging editorial changes.
- [x] Louis authorizes updating GitHub with the current reviewed wording and code.
- [x] Replace development-only status wording for the GitHub update and retain
  an exact source manifest with the verification record.

## Integration and release work still outside the verified prototype

- [ ] Host-specific integration for applying candidates, actual independent
  author/reviewer isolation and durable production report storage.
- [ ] Broader model/server compatibility and real project workflow evaluation.
- [x] Hosted Linux CI passed for the published implementation.
- [ ] Native Windows validation and a supported-platform matrix.
- [ ] Distribution, installation and release checks before package publication.
- [x] Source-update approval received for commit/push.
- [ ] Versioned package publication and distribution release, if requested.

## Boundaries

The engine validates adapter reports; it cannot prove callbacks are honest.
Candidate paths are logical snapshot names, not filesystem capabilities. The
file policy must mediate relevant reads, kind labels are caller declarations,
and revocation cannot recall bytes already returned. Native helper behavior
flags are self-reports. A loopback address does not prove local-only inference
or absence of forwarding and logging. Cancellation requires cooperative adapters
and cannot forcibly interrupt synchronous JavaScript or undo external effects.

Machine paths, credentials, model-service setup, private project architecture,
network-share routing and automatic model selection remain host responsibilities.
