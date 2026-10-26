---
packet: nisi-local-chat-effort-type-fixture
project_root: ~/nisi
created_by: codex
created: 2026-09-19T13:05:22-0700
write_owner: opencode
status: blocked
---

# Test the local-chat reasoning-effort TypeScript contract

## Context

This is private Nisi v0.2 engineering. Codex has inspected the runtime and
applied Fable's reviewed declaration design. OpenCode writes ONLY the new
compile-only fixture specified below; public API decisions remain with Codex.
The existing `npm run test:types` command passes on this Mac before the packet.
It runs installed TypeScript with no emit, strict, exactOptionalPropertyTypes,
noUncheckedIndexedAccess, NodeNext modules, ES2022 target and Node types against
every `tests/private-consumer/*.mts`. Its `--ignoreConfig` flag works on the
installed compiler; do not change the command or install anything.

The public package import is `nisi/adapters/local-chat`. Available exports:
`LocalChatOptions`, `LocalChatReceipt`, `LocalChatReceiptBase`,
`LocalChatOutputMode`, `LocalChatReasoningEffort`,
`createLocalChatAuthorAdapter`, and `createLocalChatReviewerAdapter`.
The two factories take LocalChatOptions and return adapters whose `receipts()`
returns `readonly LocalChatReceipt[]`. Use `typeof`, `Parameters`, `ReturnType`
and declared values to test these signatures without calling either factory.

Options require endpoint:string, destination:'LOOPBACK_HTTP', model:string,
id:string. Optional outputMode is 'json_schema' | 'json_instruction'. Optional
reasoningEffort is the exported literal alias 'none'. Preserve strict optional
semantics: omit the option or supply 'none'; explicit undefined is rejected
under exactOptionalPropertyTypes, even though JS treats undefined as omission.

LocalChatReceipt is an intersection of common base, one version shape, and
one status shape. Common base fields:
- operation:'draft'|'repair'|'review', adapterId:string, requestedModel:string;
- runId:string|null, taskFingerprint:string|null, attempt:number|null,
  inputCandidateFingerprint:string|null;
- requestedMaxOutputTokens:number, requestSha256:string|null, elapsedMs:number;
- lifecycle:{transportSettlement:'NOT_STARTED'|'CONFIRMED'|'UNKNOWN',
  remoteInferenceStopped:'NOT_OBSERVED',
  ownerState:'STOPPED_DRAINING'|'STOPPED'|'QUARANTINED'|'BUSY'|'DRAINING'|'IDLE'}.
All declared fields are readonly. Use `declare const base: LocalChatReceiptBase`
for receipt constructions and an explicit small base options object.

Version shapes:
- v1: schemaVersion:1; outputMode?:never; reasoningEffort?:never.
- v2: schemaVersion:2; required outputMode; reasoningEffort?:never.
- v3: schemaVersion:3; required outputMode AND reasoningEffort:'none'.
The JS runtime emits v3 for explicit 'none', including default json_schema
when mode was omitted. Omitted effort preserves v1/v2 behavior.

Status shapes:
- RESPONSE_VALIDATED: reportedModel, candidateFingerprint,
  resultCandidateFingerprint, responseSha256 and contentSha256 are strings;
  usage is null or {promptTokens:number,completionTokens:number,totalTokens:number}.
- UNAVAILABLE: code:string, reportedModel:null,
  resultCandidateFingerprint:null, usage:null.
The version shape applies to BOTH statuses.

No runtime JS, package, other test, declaration or configuration edits belong
to this packet. Root's subsequent regression proof will compile your completed
fixture against the retained old declarations, then check the current ones and
mutate the effort alias in an in-memory compiler view. Packet syntax acceptance
alone does not establish that the fixture covers the contract.

## Constraints

- Sole allowed write: tests/private-consumer/local-chat-reasoning-effort.mts.
- No edits to types/local-chat.d.ts, adapters, package.json, lockfiles, other
  tests, roadmap, integrations, frozen Veritas, packets or configuration.
- Never touch other authors' dirty work. No network, model, shell, factory,
  draft/review/repair or transport execution from the fixture.
- Compile-only declarations and object literals; no any, broad casts, string
  widening, ts-ignore, ts-nocheck, stubs or unsafe coercions. Use narrow
  `@ts-expect-error` comments immediately before intentional invalid assignments.
- Use real public imports, not internal relative paths. Do not inspect unrelated
  source. No installation, commit, push, publication, deletion or auth changes.
- Do not run acceptance yourself or claim pass; wrapper creates final receipt.

## Items

### P1 — Create the compile-only consumer regression fixture
- **files**: tests/private-consumer/local-chat-reasoning-effort.mts
- **do**: Create the fixture using the contract above. Positive cases: exported literal alias; options with omitted effort, explicit none with omitted mode, none with each explicit output mode; options assignable to BOTH factory parameter types; BOTH adapters' receipts readonly-assignable to readonly LocalChatReceipt[]. Construct v1, v2 and v3 receipts for BOTH statuses with correctly typed common fields (six combinations), exercise both v3 output modes and validated usage null/numeric fields. Verify narrowing by schemaVersion then status yields literal none, required outputMode, success string fields or unavailable null/code; legacy absent fields narrow to undefined. Negative cases, each a separate exact expect-error: option effort high, empty string, null, number, explicit undefined; bad effort through EACH factory's parameter type; v3 completely OMITTED effort, completely OMITTED outputMode, explicit undefined effort/mode, high effort, invalid outputMode and invalid schema version; v1/v2 carrying reasoningEffort:none; v1 carrying outputMode; v2 missing outputMode; validated status missing a required success field; unavailable with numeric usage; success with reportedModel:null; unavailable with reportedModel:string; assignment to readonly receipt effort and push to BOTH readonly receipt arrays. For completely absent-field cases build an explicit object or omit via destructuring, not an undefined property disguised as omission. Keep negatives independent so unrelated missing fields do not mask the intended error. Do not execute factories or methods: use ReturnType of receipts methods to declare returned arrays. Add a short header stating compile-only/not for runtime execution and export {} if needed. Do not write any other file.
- **accept**: node --check tests/private-consumer/local-chat-reasoning-effort.mts

## Packet acceptance
npm run test:types
