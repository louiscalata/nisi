# Private Nisi — selected failure review

**Status: accepted in the bounded private operator scope. Overall merger: 30% (3/10 NX milestones).**

## Operator contract

The optional `--review-incidents` flag requests a terminal interaction after the
existing repository workflow settles. It does not approve storage. The default
parser and summary remain unchanged when the flag is absent. When both history
and incident review are requested, each gets a separate decision; history is first.

1. Display original-issued failure candidates, ten per page. Exact `SELECT <rowId>`
   selects only a row on the displayed page. `NEXT`, `PREV` and `PAGE <positive
   integer>` navigate. Empty input, `n` or `no` declines.
2. Display the selected metadata, row fingerprint, preview digest, task namespace,
   local destination and retention/disclosure warnings. Require exact
   `STORE <rowFingerprint> <previewDigest>`; selection alone never authorizes storage.
3. Recheck cancellation, the shared wall deadline and original preview identity
   around callbacks. Read/open only after confirmation. Create a short-lived
   substrate permit; revoke unused permits and preserve consumed outcomes.
4. Preserve the exact valid capture result and its actual journal evidence.
   Malformed or thrown capture returns are uncertain, not fictitious success.
   A preadmission clock refusal remains a refusal even when capture was called.

Maximum 32 total prompt interactions and 120 seconds, including both steps. No
normalization, implicit/bulk approval or automatic retry. Invalid selection is
`SELECTION_MISMATCH`; a syntactically valid but unavailable page is `PAGE_INVALID`.
`PAGE 0` is syntactically invalid. `expectedAnswer` in prompt metadata is a string
required by the reused terminal reader, not a submitted or default approval.

> [!WARNING]
> **This is a trusted operator interface, not authenticated consent.** Host,
> prompt, clock and filesystem are trusted dependencies. Hashes provide linkage,
> not authenticity. Observations grant no learning, native execution or release
> authority. Preexisting raw demo evidence is unaffected by this storage choice.

> [!CAUTION]
> **Retention is declared, not automatically enforced by a sweeper.** No secure
> erasure or cross-process locking guarantee is added. A consumed attempt cannot
> be retried simply because storage was uncertain or refused.

## Review adjudication

The bounded Opus design response is retained in `claude-design-response.json`.
Its useful requests—explicit preview binding, result coherence, bounded prompts,
cleanup and default-CLI compatibility—are incorporated. Several inferred API
details were incorrect and are not adopted: preview digest is `sha256`; the
preview stays the same original object, not a replaced equal hash; capture can
refuse after journal admission; journal is a structured outcome, not a path;
and a capture clock exception before admission yields REFUSED/INVALID_CLOCK,
not an uncertain write. Permit creation uses the host closure, not a public
preview parameter. Source review will include the actual substrate code.

## Acceptance required

- [x] Independent behavior tests, corrected fixture assumptions, and regressions.
- [x] Additive source-checkout types with positive and nine negative controls.
- [x] CLI default/order/refusal tests and real terminal approve/decline proof.
- [x] Source review and final cleanup-change review: Opus PASS, no findings.
- [x] 1598 portable checks, seven semantic fault variants and 280 unchanged pins.
- [x] Canonical roadmap and human system equation updated with evidence.

See [verification and adverse evidence](roadmap.md). Completion is limited to
this interface; it does not close NX-05 or the full product/release roadmap.

No package exports, journal formats, native formats or publication guards change.
