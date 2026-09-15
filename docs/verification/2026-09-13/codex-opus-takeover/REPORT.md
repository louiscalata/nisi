# Nisi — Codex × Opus takeover

**Overall roadmap progress: 30% — 3/10 major NX milestones accepted.**  
**This work: isolated correction verified; canonical integration pending.**  
Private engineering · September 13, 2026 · Source snapshot: 20:53 UTC

**Approval update, 21:05 UTC:** Louis directly approved only the two package
inventory assertions changing from 24 to 27. The current file matches that exact
change and the focused package-contract suite passes **5/5**. The approval
question is resolved now; no other test change, publication or checkpoint bypass
is authorized. [Exact approval and hashes](inventory-approval.json).

> [!WARNING]
> **The current product formatter can display a forged success line.**
> Raw operation names and unexpected outcome strings can insert a second
> “Overall: ALL_MATCHED” line into the plain-text canary table. The structured
> result correctly remains NOT_ACCEPTED and isolationAccepted remains false.
> The tested correction exists only in an isolated candidate.
>
> **Why this matters:** a person reading the report could be misled even when
> the underlying decision is correct. Display text is not acceptance evidence.

## Ownership and actual collaboration

Louis explicitly instructed “you can start now.” Codex began independent
integration review with Opus as a substantive coauthor. No Fable usage-exhaustion
event was inferred or needed.

The old handoff heartbeat was deleted through the app and deletion confirmed.
Its ID was veritas-private-landscape-monitor; it had previously been repurposed
from landscape monitoring. Neither that watcher nor its former weekly scan
remains running from this automation.

The 50/50 arrangement means shared technical responsibility, not an asserted
50/50 split of tokens, time or lines:

| Owner | Actual contribution |
|---|---|
| Opus, via tool-disabled Claude CLI | Canary/formatter contract analysis, operation-name defect discovery, prevention and verification design, and candidate review. Both calls reported claude-opus-5; auxiliary Haiku usage is retained. |
| Codex | Journal/native-chat inspection, defect reproduction, discovery of the second outcome-string path, isolated implementation, red/green execution, reviewer adjudication and integration ownership. |
| Luna | Independent 16-row placement check, candidate/test-copy fidelity, receipt-drift finding and verification of review corrections. |
| Daybreak Blue | Independent journal contract/source/test inspection; no confirmed in-scope defect. Static review only. |

Two Opus calls succeeded. Combined provider-reported cost was approximately
$0.505725, not a quota reading, billed-cost guarantee or savings measurement.
No Fable call or Windows execution is claimed by this takeover.

## First correction

The exercised path is:

**Raw stdout → vocabulary adapter → adjudicator → plain-text table**

Opus identified unexpectedOperations. Codex confirmed the same defect in
row.observedOutcome. The candidate adds one private displayField helper and
wraps three render sites: row.operation, non-null row.observedOutcome, and
unexpectedOperations.

Adjudication, structured result shape and isolationAccepted:false are unchanged.
Ordinary text remains readable. Backslashes become literal \u005c so a literal
escape sequence cannot mimic an encoded control. C0/C1 controls, Unicode line
separators and the selected bidi controls are escaped. This is not HTML
sanitization, complete Unicode-spoofing protection or receipt authentication.

## Before and after — executed locally

| Check | Canonical baseline | Isolated candidate |
|---|---:|---:|
| New regression suite | 2 passed / 5 failed | 7 passed / 0 failed |
| Existing compatibility assertions | Not separately rerun as baseline here | 31 passed / 0 failed |
| Integration placement fidelity | 16/16 rows match | Unchanged |
| Compatibility-copy fidelity | — | 3/3 path-only transformations |
| Reviewed artifact hashes | — | 14/14 match receipt |
| Canonical integration | Not performed | Pending |

Executed suites had zero cancelled, skipped or TODO tests. The seven regressions
cover golden behavior, both injection paths, 79 control characters through both
raw-derived fields, escape distinguishability, ordinary Unicode, non-mutation
and defensive escaping of custom expected labels.

The 31 compatibility tests are isolated copies with unchanged assertions.
They are not a full canonical product-suite run. The retained fidelity checker
verifies that only declared module/fixture references changed.

### Reproduce without editing product source

Run from /Users/louiscalata/nisi-next-private:

~~~sh
node .build/codex-opus-takeover-ScjWha/verify-fidelity.mjs

# Expected red against the recorded, unchanged canonical source:
node --test .build/codex-opus-takeover-ScjWha/formatter-regression.test.mjs

# Candidate-only green:
NISI_CANARY_MODULE=./candidate-adjudicator.mjs node --test .build/codex-opus-takeover-ScjWha/formatter-regression.test.mjs

node --test .build/codex-opus-takeover-ScjWha/compat-native-canary-adjudicator.test.mjs .build/codex-opus-takeover-ScjWha/compat-native-canary-table.test.mjs .build/codex-opus-takeover-ScjWha/compat-native-canary-adapter.test.mjs
~~~

NISI_CANARY_MODULE is read only by this isolated regression harness. Setting it
for npm run check would NOT redirect canonical imports to the candidate.

## Review decisions and corrections

Opus returned **ACCEPT_SCOPED** for the isolated candidate. Luna confirmed
fidelity. The raw reviews are retained, including their mistakes:

1. Both initially claimed the forbidden-character test omitted TAB. This is
   refuted: the exact range \u0000–\u0009 includes TAB; direct execution returned
   tabDetected:true. No unnecessary test change was made.
2. The proposed full-suite gate using only NISI_CANARY_MODULE was incorrect:
   canonical imports are hard-coded. Integrate under the correct owner first,
   or construct an explicitly remapped isolated tree, then test that tree.
3. Opus's shorthand description of backslash output was imprecise. Actual
   output is the six-character literal \u005c, not two backslashes.

Luna independently confirmed these corrections and withdrew the two incorrect
recommendations. Raw Opus output is unmodified; no new Opus endorsement of
these editorial corrections is claimed.

The helper expects the strings produced by the adjudicator. Hand-built results
with non-string operation fields are outside that contract and may now throw
instead of being coerced. Ordinary fixture layout remains compatible.

Journal and native-chat inspection produced no additional confirmed defect in
this pass. That does not establish new full-suite, live inference, persistence,
native lifecycle or release acceptance.

## Existing work and warnings

> [!CAUTION]
> **Other writers remain active.**
> The prior Claude/Astra workstream owns canonical tests and the run-journal-store
> work order. Claude also owns the native-canary-summary packet. No final
> settlement report was available at the last ownership check.
>
> **Why this matters:** concurrent edits could invalidate their source bindings
> or overwrite work. Their source, tests and work orders were left untouched.

> [!CAUTION]
> **The integration receipt and addendum need reconciliation.**
> The retained closing receipt reports 1160/1160; the later optional-baseline
> addendum reports 1163/1163 after three tests were added. The receipt still says
> that optional item was omitted. These are historical results, not our fresh run.
>
> **Why this matters:** designate one current, revision-bound receipt and preserve
> earlier results as history instead of silently combining incompatible snapshots.

> [!NOTE]
> **Protected-test approval resolved by a direct user decision.**
> After the precise two-literal question, Louis replied “approved.” Current bytes
> differ from the retained baseline only in the two 24-to-27 count literals.
> No test edit was needed in this turn. The earlier approval gap remains in the
> historical record; this reply does not prove approval existed at the earlier edit.
>
> **Why this matters:** reviewer judgment, user authorization and green tests are
> separate facts. This closes only the exact test-exception question, not any
> checkpoint, ownership, engineering-acceptance or publication requirement.

> [!CAUTION]
> **The checkpoint refusal remains unresolved.**
> The earlier command refused because signing-related environment state was
> injected. No successful checkpoint is established here. No environment or
> guard was changed; no retry was attempted.
>
> **Why this matters:** green unit tests do not justify bypassing a safeguard
> distinguishing trusted checkpoint execution from delegated activity.

The earlier handoff's fail-open review-workflow warning and Windows repair-prompt
truncation warning also remain. Neither global workflow was executed or changed.

## Next bounded integration order

1. Obtain final worker reports and transfer the exact source/test ownership.
   Process disappearance alone is not settlement evidence.
2. Carry the exact user-approved inventory change forward with its approval
   addendum. Checkpoint handling remains a separate, unresolved decision.
3. Confirm the canonical adjudicator still has SHA256
   cf875eaa7adf335ceab49ae16f9941e2d9b5b9780f5ca15c22eea4c97405de00.
   Review/rebase if it drifted; never overwrite blindly.
4. Integrate the helper and three render substitutions plus new regressions.
   Preserve existing assertions and accepted work-order originals.
   Candidate SHA256:
   444acc75db292d69c62ce0360f536ea73292317f78b36409acc619774b44e9eb.
5. Run focused tests, canonical full check, TypeScript and private-package
   acceptance on the actual integrated revision. Do not infer totals by adding
   these seven tests to an old receipt.
6. Reconcile the current receipt, addendum, hashes, counts and review provenance.
   Preserve earlier failed and passing records as explicitly historical.
7. Update the canonical roadmap and retained system equation after shared-file
   ownership transfers. Keep 30% unless an NX milestone actually closes.

### Prepared roadmap / system-equation checkpoint

> September 13: Codex/Opus takeover review verified all 16 integrated placements
> and prepared display-only canary escaping. Isolated evidence: new regressions
> red at 2/7, candidate green at 7/7, 31 unchanged compatibility assertions green.
> Canonical integration, current full acceptance and receipt reconciliation await
> active-owner settlement. Overall NX progress remains 30% (3/10).
> Structured NOT_ACCEPTED decisions never changed.

This wording is prepared here, not written over the active owner's documents.

## Private evidence

- [Direct user approval](inventory-approval.json)
- [Focused package-contract verification](inventory-approval-test.log)
- [Receipt](../../../../.build/codex-opus-takeover-ScjWha/verification.json)
- [Candidate source](../../../../.build/codex-opus-takeover-ScjWha/candidate-adjudicator.mjs)
- [New regressions](../../../../.build/codex-opus-takeover-ScjWha/formatter-regression.test.mjs)
- [Red log](../../../../.build/codex-opus-takeover-ScjWha/red-baseline.log)
- [Green log](../../../../.build/codex-opus-takeover-ScjWha/green-candidate.log)
- [Compatibility log](../../../../.build/codex-opus-takeover-ScjWha/compatibility.log)
- [Fidelity checker](../../../../.build/codex-opus-takeover-ScjWha/verify-fidelity.mjs)
- [Fidelity log](../../../../.build/codex-opus-takeover-ScjWha/fidelity.log)
- [Opus analysis](../../../../.build/codex-opus-takeover-ScjWha/opus-canary-response.json)
- [Opus candidate review](../../../../.build/codex-opus-takeover-ScjWha/opus-candidate-review-response.json)
- [Earlier handoff](../../../../.build/orchestration-study-Y4xvJ1/HANDOFF.md)
- [Unapplied formatter patch](formatter.patch)

No production source, protected canonical test, current roadmap, system equation,
commit, push, release, model setting, authentication or device setting was changed
by this takeover. New isolated candidate/evidence files and this private report
were created; the prior handoff note was updated and its obsolete automation
deleted. Public Nisi and retained Veritas source history were untouched.
