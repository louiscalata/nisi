# Private Nisi — operator-selected incident review

**Overall product progress: 30% (3/10 NX milestones). This work order: 6/6 complete.**

The optional CLI interface now turns the existing failure-observation capture
capability into an explicit two-step terminal decision. It does not turn saved
observations into learning inputs or authenticated evidence.

## Accepted deliverables

- [x] Original-issued preview selection with ten-row paging and full identifiers.
- [x] Separate confirmation, shared deadline/interaction cap and permit cleanup.
- [x] Additive CLI behavior and no workflow-verdict upgrade from stored history.
- [x] Readonly source-checkout declarations and nine negative compiler controls.
- [x] Independent review, 31 focused tests, full portable tests and semantic faults.
- [x] Real terminal decline/approve, source rehashes and fresh-child journal query.

## Evidence

| Check | Result | Retained evidence |
| --- | --- | --- |
| Portable suite | 1598/1598 | [Source acceptance](../../.build/repository-incident-review-verification-HXHnMK/verification.json) |
| Focused tests | 31/31: 18 review, 5 boundary, 6 CLI, 2 type | Same receipt |
| Relocated control | 23/23 | Same receipt |
| Semantic fault variants | 7/7 detected by assertions; counts 1,1,1,2,1,1,1 | Same receipt |
| Real terminal decline | NOT_STORED; no owner open/capture/journal | [Decline proof](../../.build/repository-incident-review-v1-pty-cfEnP2/verification.json) |
| Real terminal approval | STORED; actual WRITTEN/verified/committed/fsync file+directory | [Approval proof](../../.build/repository-incident-review-v1-pty-vIiobU/verification.json) |
| Fresh child | Exit 0; actual returned entry ID, row ID, row fingerprint and preview digest match | Approval proof |
| Source review | Opus PASS/no issues | [Initial source](claude-source-response.json), [final cleanup revision](claude-final-response.json) |

All **280 selected pins** remained unchanged during source verification and both
terminal proofs; a final rehash also found no drift. The source receipt hash is
`35239f0e5f965f686d4cf772a6602cf1acd7493ce6c86ae06c4a9eb70672aba1`.
Of the previous 267 selected files, 266 remain exact. The CLI is the only
intentional prior-file change; 13 new files include two declaration files,
three behavior/CLI test files, the type test/fixtures, helper and proof scripts.
All test processes were terminal. No skipped, cancelled, todo or runtime-only
failure received acceptance credit. PTY tests used synthetic inputs; no Swift
kernel, native application, model or network call was performed by these proofs.

## Corrections and adverse evidence

1. [Initial oracle](initial-red.tap): 13/16 pass. A paging fixture supplied an
   invalid top-level repair callback and used a nonexistent observation field.
   Invalid-command reason names and advisory `expectedAnswer` metadata needed
   explicit contract adjudication. The real terminal reader already requires
   that metadata string; it does not submit an answer or approve anything.
2. [Callback regression](callback-red.tap): a transient post-clock preview
   mismatch was lost by calling `current()` twice. Capture one result instead.
3. [Journal regression](boundary-red.tap): a claimed success with null or
   contradictory journal data was accepted. Validate the actual journal mapping
   and preserve admitted refusals rather than flattening all refusal states.
4. [Permit cleanup regression](permit-cleanup-red.tap): malformed issuance could
   conceal a returned live handle. Recover it for cleanup, but never capture with
   it before full validation. Match the release acknowledgement to the declaration.
5. Type review corrected the false assumption that REFUSED always means no
   journal attempt; query types now narrow by availability status.
6. Test-harness review corrected relocated CLI writes outside its owned temporary
   root. All generated CLI fixtures now register exact-root cleanup immediately.
7. Draft proof/runner review corrected nonexistent inventory, automatic non-TTY
   proof invocation, copied instead of measured after hashes, omitted decline
   receipts and copied rather than child-returned query identifiers. These drafts
   were not counted as successful evidence. Final proofs re-read every pin.

The final source review followed the cleanup correction. The earlier source
PASS did not excuse a later locally discovered defect. The original design
response contained API misunderstandings; see the [contract adjudication](CONTRACT.md).

## Collaboration and cost

Opus supplied a bounded design response and two source reviews. Daybreak supplied
independent oracle and verifier drafts. Luna supplied declarations, compiler
fixtures and the initial PTY proof. Another Codex helper supplied CLI tests.
Codex implemented, reviewed all delivered code and corrected implementation/test/
proof assumptions. Three Claude calls report **USD 0.8618215**, including auxiliary
Haiku; this is neither all-model cost nor a measured saving. Fable and OpenCode
remain held after earlier failures; no blind retries or service changes occurred.

> [!WARNING]
> **The answer and evidence remain unauthenticated.** Synthetic PTY answers are
> test inputs, not the user's real storage approval. Hashes prove consistency,
> not correctness, causation, independent recurrence or learning eligibility.

> [!CAUTION]
> **One-shot and retention limits remain.** Capture-call attempted is not the
> same as journal-record attempted. Consumed uncertainty/refusal is not permission
> to retry. Retention does not promise automatic pruning or secure erasure, and
> optimistic single-writer disk checks do not provide a cross-process lock.

## Next engineering boundary

Implement source-bound selection of an original static row and a reviewed mapping
to retained Veritas native check profiles. A separately versioned native bridge
must reconstruct actual snapshot bytes, run the real deterministic pipeline and
let PipelineIncidentAdapter rerun/check its transcript before ledger admission.
Reject unsupported Node-test, PASS, operational and interrupted rows explicitly;
never fabricate a native PipelineResult from persisted Nisi metadata. Node and
native storage outcomes stay independent. Native execution and fresh ledger
verification need their own evidence before claiming NX-05 integration.

The frozen import, native/journal formats, staged-package allowlist and existing
exports are unchanged. No publication, installation, authentication, model-service
change or modification of Claude's separate working copy occurred.
