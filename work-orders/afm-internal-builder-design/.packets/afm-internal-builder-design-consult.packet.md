---
packet: afm-internal-builder-design-consult
project_root: /Users/louiscalata/nisi-next-private/work-orders/afm-internal-builder-design
created_by: claude
created: 2026-09-14T10:40:00-0700
write_owner: opencode
status: done
---

# AFM internal-builder design: structured recommendation (Go-tier consult)

## Context

The project uses Apple Foundation Models on macOS 27 (Xcode 27, FoundationModels
framework, `SystemLanguageModel` / `LanguageModelSession`, `@Generable` guided
generation, `tokenCount`, greedy `GenerationOptions`). Today AFM is exposed only
through a consent-gated, hash-pinned, non-authorizing advisory content executor:
no tools, no writes, no network, no acceptance authority.

The goal is a safe "internal build agent": over time the on-device model helps
continue development of the project (oracle-first work orders, receipts from real
exit codes, one-writer-per-directory lanes). Capability grants are ordered
(read → deterministic test run → scoped staging write → staged Swift compile),
each manifest-pinned and consent-gated; the model never holds acceptance
authority; acceptance stays oracle/human from real exit codes.

An existing recommendation (from the session's Claude consult, already delivered)
proposes: no fine-tuning; a retained, hash-pinned Project Knowledge Base derived
from accepted receipts; per-turn context packs budgeted to the model window;
typed `Proposal` output that flows into normal work orders; receipts pinning
packHash/manifestHash/modelBuild/proposalHash/toolCalls.

## Constraints

- Edit only `evidence/afm-builder-design.mjs`.
- Do not touch tests, package metadata, configuration, gate/executor sources, or
  any file outside this work order's `evidence/` directory.
- Do not add dependencies or perform network, model, launcher, or native work.
- Do not claim acceptance, certification, publication, or policy authority.
- Return the recommendation as structured data; keep every string field under
  600 characters and every array to at most 12 items.

## Items

### P1 — write the structured design recommendation
- **files**: evidence/afm-builder-design.mjs
- **do**: Create a JS module exporting a default object with exactly these keys:
  `learningModel`, `contextPack`, `capabilityLadder`, `receiptIntegration`,
  `guardrails`, `firstIncrement`, `risks`. In prose grounded only in the
  Context above, answer: (1) what "learning internally" should mean on-device
  without fine-tuning, (2) what the model should be shown each turn and how that
  pack is hashed, (3) the ordered tool grants and their pinning, (4) how model
  output integrates with receipt/acceptance from real exit codes, (5) top
  failure modes and guardrails (no publication/signing/network/unbounded
  loops), (6) the smallest end-to-end first increment. Keep it exportable and
  syntactically valid JS: `export default { ... }`.
- **accept**: node --check evidence/afm-builder-design.mjs

## Packet acceptance

git status