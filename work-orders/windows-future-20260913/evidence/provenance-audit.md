# Windows source provenance correction

Private, read-only independent Daybreak audit followed by root record correction.
Passing tests do not imply an installed file is byte-identical to a worker draft.

| Module | Correct attribution |
| --- | --- |
| usage-table | Qwen source plus accurately reported owner key/negative-zero corrections; finite-helper spelling change also present |
| history-timeline | Qwen-informed broad owner refactor plus root-key and attempt/time/duration negative-zero fixes |
| model-catalog | Qwen-informed broad owner refactor plus exact root-key correction |
| progress-checklist | Qwen-informed broad owner refactor; no behavior delta identified in scoped comparison |
| comparison-table | Two worker fragments have identical decoded content; installed version is a broad owner refactor, not those exact bytes |
| markdown-status-card | Reviewer rewrite preserved; root restored actual worker source plus terminal LF and independently reran 12 checks |

The claim that history's returned duration validator already rejected -0 was false.
The claims of no implementation change/direct-only extraction for progress and
comparison were false. Model catalog understated its nonsemantic edits. Corrected
per-pack records retain the earlier documents with a -superseded suffix. Raw worker
responses and actual test outputs remain retained. No source changed in the first
five modules during this record correction; markdown's corrected final source is
9ea91d273de854cead45fe91c7a5a4580b02419b14398ce3ff3e392943fef4ae.

At that correction checkpoint: 81/81 checks; all 30 original protected pins matched.
This validates the installed versions only, not independent review or product acceptance.

## Later source-bound refresh

The final batch receipt adds the three14-check test extensions:95/95 checks.
All six current source hashes still match `batch-verification-final.json` and
queue.json;30 original protected pins remain matched. The separate four-test
current-XPC extension is not included in95. No new model calls or tests were
performed for this read-only refresh.

Nineteen of20 retained worker responses are byte-exact registered-outbox copies.
`packs/model-catalog/evidence/draft-1-error.json` is the exception: its id, error
status, `fetch failed` message and303.1s duration match, but ownerDecision and
authorizing fields were added. It is an **owner-annotated terminal error**, not a
raw byte-exact worker receipt. Keep the original failure and this qualification.
All20 IDs are terminal; no outstanding request or new review-recovery evidence.
