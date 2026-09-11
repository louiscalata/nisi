# Component names and core design

Nisi keeps its product name. Component names describe their software responsibility; there is no universal standard that mandates a particular product vocabulary.

| Component | Public module/API | Legacy compatibility |
|---|---|---|
| Workflow Engine | `workflow/engine.mjs`, `runWorkflow` | New API |
| Task Specification and Candidate | `createTaskSpecification`, `createCandidate` | New contracts |
| File Access Policy | `policy/file-access.mjs`, `createFileAccessPolicy` | `createContentConsent` and `gate/content-consent.mjs` retained |
| JSON Canonicalizer | `serialization/canonical-json-v1.mjs`, `canonicalizeJsonV1` | `canonicalizeJSONV1`, legacy path and restricted v1 profile retained |
| Apple Foundation Models Adapter | `adapters/apple-foundation-models.mjs`, `createAppleFoundationModelsAdapter` | `createAFMContentExecutor` and old import path retained |
| Local Chat Author / Reviewer | `adapters/local-chat.mjs`, `createLocalChatAuthorAdapter`, `createLocalChatReviewerAdapter` | New explicit loopback destination |
| Static Analysis Check | `tools/check-side-effects.mjs`, `npm run check:static` | `npm run check:structural` and original CLI retained |
| Native Model Bridge | `probes/afm-content-probe.swift` | Source path retained; descriptive documentation added |
| Run Report / Report Store | Frozen engine result and injected `store` callback | New contract; sample store writes and verifies a report |

The package root exports the public APIs. Subpath exports cover workflow, policy, serialization, Apple and local chat adapters. Existing deep imports remain available. Result codes and v1 consent/observation digest formulas are preserved; the new execution-receipt digest has a separate versioned domain.

## How the skill becomes a core

The portable rules of initiate online code mode are implemented in the sequential engine: task authorization, one captured author, fixed criteria, static checks, tests with positive assertion evidence, distinct reviewer IDs, bounded repair, no-progress detection and inspectable outcomes. The implementation deliberately runs static checks before tests. It does not depend on private machine paths, credentials, network shares, provider accounts or a separate code-mode installation.

The engine coordinates host callbacks and returns candidate data. It cannot enforce one filesystem writer against other processes, prove a model's identity, or make arbitrary callbacks read-only. The host owns those boundaries. Its author and reviewer may be local-chat adapters, other trustworthy callbacks or a human-mediated integration. The Apple advisory adapter retains its separate Apple-only content contract.

## Implemented boundary repairs

File admission now checks the opened object and its before/after identity and metadata, reads with a hard byte ceiling, and refuses malformed item traps and clock failures. Stable trusted parent directories are still required. The Apple adapter captures the item map, handles pre-abort, validates strict evidence and prompt identity, and retains task-bound execution evidence. Its binary directory must remain stable. Kind labels are not format detection; revocation stops future admission only.

The static checker covers direct syntactic patterns in the codec's marked region. It is not a general purity proof; aliases, computed calls and unrelated methods with matching names are outside its claimed precision. Passing tests are scoped evidence, not a security certification.

See [Workflow API](workflow-api.md), [File Policy](file-policy.md), [Apple Adapter](apple-foundation-models.md), [Local Models](local-models.md), and [Verification](verification.md) for runnable behavior and its limits. The canonical [roadmap](../roadmap.md) tracks work that remains.
