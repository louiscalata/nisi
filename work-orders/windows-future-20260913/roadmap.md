# Windows future implementation — six-hour private work queue

**Window closed at its original deadline, September 14, 04:58:04 UTC.**
Twenty submitted requests have terminal evidence; no request is outstanding in
the retained accounting. Six modules have 95 passing local checks, but zero have
the required independent Windows review. This closes coordination, not module
acceptance or a remote service. No new jobs, retries, cancellation or extension
were issued. The accounting-only checker passed again at window closure; it does
not establish current worker health or that a remote model process has shut down.

**Overall Nisi roadmap progress: 30% — 3/10 NX milestones closed.**
**This batch: 0/6 modules accepted (0%).** Batch completion is not product/release completion.
**Test-ready: 6/6 (100%), 95/95 source-bound local checks passed.** This is not independent acceptance.
**Boundary-test extensions: 3/3 accepted in test-only scope; 14 added checks.** Read `queue.json` for live status.
**Concrete successor extension: 4/4 current-XPC integration tests pass.**
The four tests remain preserved in the journal-owner-v2 work order and now have
exact relocated copies in the canonical1331-test suite. They are not included
in the original 95-check batch. Total worker requests: 20/24; no job outstanding.
One new integration need justified this extension after the initial batch finished;
it does not authorize more duplicate tasks or lift the GPT-OSS review hold.
The planned drafting/test work finished ahead of the six-hour window. No request
is currently outstanding; the independent-review lane is held. Continuous remote
computation for all six hours is not claimed or forced with duplicate requests.
The [canonical product roadmap](../../roadmap.md) remains authoritative.

Final accounting refresh: the top-level request counter was stale at18 while
20 unique submitted IDs and the summary already agreed on20. It is corrected to20;
`node check-queue-accounting.mjs` now validates both counters against actual job
records and the24-request cap. No jobs, limits or window dates changed. All30
original protected pins and all six source hashes were rechecked unchanged.

Latest read-only refresh: all six source hashes still match the final95-check
receipt. All20 registered request IDs have terminal evidence; no new recovery
evidence exists. Nineteen retained responses are byte-exact outbox copies. The
catalog's original fetch-error file includes owner annotations, so it is now
explicitly labeled **owner-annotated terminal error**, not an untouched raw receipt.
Its original id/error/status/duration still match. The old READY smoke-test record
is labeled historical, not recovered capacity. No request, source, limit or
window was changed. ACTIVE means the coordination window is open, not that a
model is currently generating code.

## Work window and execution boundary

Started 2026-09-13T22:58:04.000Z; stop issuing new work by 2026-09-14T04:48:04.000Z;
end the six-hour coordination window at 2026-09-14T04:58:04.000Z.
Use the existing registered SharedChami chat worker: Qwen3-Coder-Next drafting
and GPT-OSS review. The catalog initially used GPT-OSS for drafting, but that
request failed; its explicitly recorded Qwen alternate now passes local checks.
The GPT-OSS lane remains held; its one recorded smaller-source review also failed.
Maximum one
outstanding request per model and two total. Per-request cap 600 seconds;
maximum 24 requests total and two evidence-driven repairs per packet.
No filling time with duplicate work. If all useful bounded work finishes early,
stop and report that result. If a lane is blocked, progress a disjoint task and
revisit the original ID when evidence changes. Unknown terminality is not retry
permission. Do not add another worker service or change model residency/settings.

The registered bridge returns source text. It has no OpenCode/file-edit/test
executor, cancellation primitive or request TTL. This queue does not pretend
otherwise. No six-hour backlog is deposited remotely; returned drafts remain
untrusted until read, independently reviewed and tested on Mac. A queued request
could outlast the window; report it and do not invent remote cancellation.

| Packet | Future use | Status |
|---|---|---|
| usage-table | Explicit known/unknown token and time accounting; no reasoning double count | 23/23 PASS including five new boundaries; independent review pending |
| history-timeline | Ordered stage/attempt observations without inferred success | 18/18 PASS including five new boundaries; owner-refactored source; review pending |
| model-catalog | Model availability/location presentation, no probing or loading | 17/17 PASS including four new boundaries; owner-refactored source; review pending |
| progress-checklist | Honest milestone percentages, no effort or release claims | 13/13 PASS; smaller GPT-OSS review also timed out |
| comparison-table | Neutral before/after numeric table; no invented savings or accuracy | 12/12 PASS after explicit owner extraction of identical source fragments; review pending |
| markdown-status-card | Stable escaped status text for a future local preview | Actual Qwen source restored and root-verified 12/12 PASS; review pending |

Each pack contains its full worker-packet.md, self-contained worker-request.md,
a source placeholder, private dependency-free package, two baseline tests and
protected acceptance tests. Together: 65 acceptance tests and 12 baselines.
All six item acceptance commands failed against placeholders, while baselines
passed. Counts and protected hashes are retained in preflight.json.

Four owner regression tests were subsequently added separately for usage-table;
the original 65 acceptance tests and all package/baseline pins remain unchanged.
The first Qwen response was malformed and unusable. Revision 1 was read and
installed only in its isolated folder, then failed five of 18 combined checks.
It is not accepted or integrated. Its retained evidence and final permitted
revision request are in that pack's evidence/ directory and queue.json.
The final Qwen revision improved to 14/18 but regressed zero handling and closed
root-key validation. Codex corrected those two sites; all 18 now pass. Raw red
and green outputs are retained. Six of six modules are now test-ready; none is yet
owner-accepted because the required independent review remains open. Daybreak
completed its supplemental static review with no remaining findings at the final
source hash. This is not a substitute for the required Windows GPT-OSS review.
The queue continues independent drafting while that review is held.
For usage-table acceptance, also run its `additionalRequiredCommand` from
queue.json. Do not ignore these four regressions because baseline tests pass.

Some Qwen replies contained malformed outer envelopes despite useful source.
Where explicitly salvaged, a human-owned extraction record documents the exact
decoded source and defects. These responses remain protocol-noncompliant;
the extraction is not an automatically accepted worker result. All 30 original
package/test/packet/request pins were rechecked unchanged in the final 81-check batch.
The earlier 81-check batch remains retained. See the latest
[95-check source-bound verification](evidence/batch-verification-final.json).

> [!WARNING]
> **Five source-attribution records needed correction.** Four modules are
> Qwen-informed owner refactors, not exact decoded copies. The status-card
> reviewer rewrite was preserved and replaced with the actual worker source.
>
> **Why this matters:** passing tests do not establish who wrote which bytes.
> The [provenance audit](evidence/provenance-audit.md) and corrected per-pack records
> retain the original evidence and distinguish drafts, rewrites and logic fixes.

## Review-lane warning and bounded recovery

The original GPT-OSS catalog request failed with `fetch failed` after 303.1s.
A separate minimal inference returned `READY` in 4.3s, but the actual 8773-character
usage-table review then timed out after 180s. It remains unreviewed.

The one smaller attempt used the **complete progress-checklist source and contract**
in a 3286-character request and requested at most 1000 response characters.
It also timed out after 180s. Its original ID/error are retained in `queue.json`.
That exception is exhausted; do not submit further probes/reviews without a new
concrete diagnosis or user direction. No model reload/service/auth change occurred.

> [!WARNING]
> **A short inference smoke test did not establish review capacity.** The longer
> review failed despite the successful health response.
>
> **Why this matters:** neither a healthy worker heartbeat nor passing local tests
> supplies the independent source review required for this batch's acceptance.

## Remaining useful Windows coding packets

September 13 later checkpoint: the
[current-XPC to owner-v2 test packet](followups/journal-owner-xpc-integration/roadmap.md)
is also complete in test-only scope. Qwen supplied a draft and one revision;
owner correction produced 4/4 passing tests and one deliberately broken observation
variant was caught. It uses actual canonical projection code with synthetic data,
not fresh native runs. No original module source, test or packet was changed.
The independent review timeout audit found no new causal evidence, so that lane
remains held. Window/cutoff are unchanged, with quiet coordination only until new
concrete evidence or user direction warrants another useful task.

Daybreak read the six contracts and current oracles and identified three material
positive-boundary gaps. Existing sources and tests remain protected; the worker
may draft only the new `tests/windows-boundaries.test.mjs` in each named pack.

| Follow-up | Concrete value | Initial status |
| --- | --- | --- |
| [Usage arithmetic](followups/usage-table-boundaries/roadmap.md) | Maximum finite duration, derived-overflow unknowns, independent column totals, 200-row cap | Accepted test extension: 5/5 pass; arithmetic defect caught |
| [History boundaries](followups/history-timeline-boundaries/roadmap.md) | Stable ties at 200 events, maximum safe ordering keys, 128-character values, finite large durations | Accepted test extension: 5/5 pass; reversed ordering defect caught |
| [Catalog conservation](followups/model-catalog-boundaries/roadmap.md) | Exact 67/67/66 counts at 200 rows, independent enum axes, maximum-size copy isolation | Accepted test extension: 4/4 pass; incorrect count defect caught |

Owner must justify every expected value before executing, run the new and existing
tests, and demonstrate relevance against a deliberate isolated defect. These test
drafts are not a substitute for an independent model review of implementation.
The same six-hour cutoff, 24-request total and per-model concurrency limits apply.
After these three, do not manufacture more work unless a concrete new defect appears.

## Execution and handoff checklist

- [x] Read verified coding/packet guidance and registered Windows dispatch contract.
- [x] Inspect actual worker heartbeat, model inventory and empty inbox.
- [x] Author six exact contracts and independent oracles before draft dispatch.
- [x] Verify green baselines and red implementation suites on Mac.
- [x] Collect Qwen drafts for all six modules; retain the failed GPT-OSS attempt separately.
- [x] Read each full source, preserve protected hashes, and run scoped local tests.
- [ ] Obtain the other model's independent review; adjudicate findings.
- [x] Keep revision requests within two evidence-driven repairs per packet.
- [x] Retain Mac test/source receipts and Windows task/model evidence, including failures.
- [ ] Queue accepted artifacts for a separately owned product integration slice.

## Runbook

queue.json owns task/job identity and the six-hour window. Before any dispatch,
inspect it and the registered worker. Use only /Users/louiscalata/bin/chami-dispatch
enqueue/status/result; never manufacture inbox JSON, assume direct remote shell,
resend an unresolved request or change a packet during its active request.
The existing `nisi-claude-parallel-work-watch` heartbeat now coordinates this queue
every five minutes while preserving its separate read-only Claude watch. The app
permits one heartbeat per task; no duplicate or workaround scheduler was created.
Queue IDs and pending revisions are in queue.json, not inferred from a heartbeat.

CLI enqueue accepts the bounded worker-request.md text as its prompt and an exact
model plus --timeout 600. Retain the returned unique id immediately. Poll result
ID without --wait during heartbeat turns; never infer failure from pending.

A success envelope is only a draft/review response, not acceptance or model-authentication
proof. Parse returned JSON strictly; accept exactly one file at src/index.mjs.
Never execute imports, effects or arbitrary returned test commands. Read the whole
source first; any disallowed behavior blocks installation. Use apply_patch to
install only that source in the associated isolated pack. Check preflight pins.
Then run npm test and npm run test:acceptance separately in that pack, retaining
real exit/output and final source hash. Run any `additionalRequiredCommand` from
queue.json as well. A different Windows model reviews the contract plus exact
source in a new bounded request; request <=12000 characters. Check `laneHolds`
before any submission: GPT-OSS full-review failures prevent new
requests except the exact recorded bounded exception. Qwen may continue
drafting disjoint packs, but a missing independent review prevents owner acceptance.
Do not treat another successful heartbeat as successful inference or retry the
failed job silently. Already reported warning IDs are in queue.json.
If response exceeds scope, is malformed or truncated, retain it as unusable.
Do not rewrite tests to suit the model, auto-certify, or silently fallback to cloud.

> [!WARNING]
> **Drafts and passing presentation tests do not validate real execution evidence.**
> These modules only project supplied data and are not receipt validators, an
> authorization layer or accepted native app features.
>
> **Why this matters:** code can be useful for later integration without closing
> NX-05, accepting generated-code isolation or clearing private publication gates.

> [!CAUTION]
> **The bridge cannot enforce an exact six-hour remote cutoff.**
> Its existing request timeout is not queue expiry and it has no cancel command.
>
> **Why this matters:** this coordinator stops submitting early, retains any
> unresolved task ID and never reports that remote work stopped without evidence.

Everything stays private. No canonical/Claude-owned source writes, native builds,
model installs, credentials/auth changes, signing, commits, pushes or publication.
The existing Claude watch continues read-only on its separate lane.
