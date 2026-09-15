# handoff-claude-20260914 — nisi-render-receipt-v1

Build step 3b of the Nisi Render Engine: the `nisi/render-receipt/v1` closed
reader and digest — one receipt per verify or replay of one tile attempt,
carrying per-check `{checkId, kind, outcome, measured, threshold, scope, code}`
as the 2026-09-14 panel asked, with the author ≠ reviewer rule and the
verdict/check consistency rules enforced by the reader. New files only;
nothing outside this folder touched; no commit, no checkpoint.

## Pattern

Claude wrote CONTRACT.md and the protected oracle (13 tests, 116 assertion
lines including two pinned digests computed independently in Python). The PC
worker drafted `src/render-receipt-v1.mjs` from the contract alone (job
`mac-20260914-034214-b329d6b301408bb1b3569ff08ac544f7`, model
`Qwen3-Coder-Next 80B-A3B Q4_K_M`, 213.4 s; as received in
`evidence/draft-as-received.mjs`). First run: 12/13.

## Integrator repair (Claude), one

The draft enforced the source kind/id pairing during member validation
(code SOURCE); the contract places it in the consistency phase (code
CONSISTENCY, rule 1). Member level now accepts ID-or-null; the pairing is
checked with the other consistency rules. 13/13 after.

## Evidence

- `evidence/oracle-final.log` — 13 tests passing (Node 24).
- `evidence/structural-check.json` — PASS, zero findings.
- `evidence/mutants.json` — 7 deliberate mutants: 6 caught (author reviews
  own PASS, fail without code, REPLAY with checks, duplicate checkId, PASS
  without a quality check, Date accepted as plain); 1 equivalent (digest over
  input vs read copy — identical for schema-exact input).
- Digests pinned: PASS receipt `8fd3552f…`, REPLAY receipt `35de9571…`.

## Not done, on purpose

- Not integrated (directory, export, files entry, private-package allowlist,
  test relocation). Proposed directory: `render/` beside `render-tile-v1.mjs`.
- No independent review yet; the render-tile-v1 review workflow's record is
  the template (`../nisi-render-tile-v1/evidence/claude-review.json` once it
  lands).
- A receipt has no `supersedes`/tombstone field: reopen is a journal event,
  not a verify; if a reopen receipt is wanted it is a separate profile.

## Revision 2 (same day) — after the adversarial review: REJECT → fixed

`evidence/claude-review.json` (claude-workflow review-render-receipt-v1, 65
agents) returned REJECT with two blockers, both real:

1. **Digest domain.** `measured`/`threshold` accepted any finite number and
   any string, but canonical-json-v1 digests only safe integers and
   well-formed strings, so `digestRenderReceiptV1` threw a foreign
   `CanonicalJSONErrorV1` for receipts the reader accepted — including the
   oracle's own `-1.5` fixture, which was never digested. Contract decision:
   MEASURE = null | safe integer (not -0) | well-formed TEXT; models
   well-formed. Every `ok()` fixture is now digested and re-read.
2. **`input.checks.map` on the caller's array** — a hijacked `map`, an Array
   subclass or Symbol.species could inject content into an ok:true receipt or
   throw. Replaced with the same descriptor-walk snapshot as render-tile-v1;
   output built by index from the snapshot.
Also: re-reads between validation and copy gone; export list moved outside
the PURE-REGION markers; the structural-check evidence regenerated against
this module (the earlier file was the codec's — see the tile handoff); the
author ≠ reviewer rule documented as a string comparison that is vacuous for
`assemble`/`journal` sources (design note in the contract); rules 6 and 8 now
state their sub-order with "then".

Oracle: 15 tests (revision 2), all passing; pinned digests unchanged.
Mutants: 13/13 caught, including float measures, surrogates, accessor
acceptance, exotic arrays, CODE length, model boundary, rule-1-before-rule-2.
Not integrated; re-review requested.

## Revision 3 (same day) — after the re-review: ACCEPT_WITH_DEFECTS → fixed

`evidence/claude-rereview.json` confirmed both first-review blockers fixed
and found three defects: the snapshot never released its visited mark, so a
shared non-cyclic reference was refused as NOT_OBJECT where the contract
names only cycles (revision 2's handoff had overstated the mirroring of
render-tile-v1); the ordering clause was only partially pinned (fourteen
reorder mutants survived); getter and Proxy vectors were root-only.

Fixed: the snapshot is now the same as render-tile-v1's — a path stack that
releases on exit (shared sub-objects are copied again), a node budget, an
8,000,000-unit payload budget and a 4,096-character key cap, depth 64 with
the root at depth 0 (64 nested containers walk, 65 refuse). Contract states
the units (UTF-16 code units) and that non-object values, functions included,
fall through to the member rule.

Oracle revision 3: 16 tests — fourteen two-fault ordering vectors, nested
throwing and two-phase getters on `source.id`, `checks[0].measured` and
`reviewer.id`, a descriptor-trap Proxy (refused) and a get-trap Proxy
(reads transparently: the reader never uses `[[Get]]`), shared check object
(→ duplicate checkId), shared empty array in `checks` and `tokens` (→ TOKENS),
depth 64/65, a function at `tokens`, astral-plane lengths for TEXT and model,
the 10 KB-string DAG. Mutants: 24/24 caught, including the named boundary
set (idlen-127, text code points, model off-by-one, code length, block
non-string, kinds unfrozen), seen-never-released, depth 63 and 65,
nested-accessor-below-root, rule-4 reviewer-first and rule-1-after-rule-2.
Structural check regenerated for the new `sourceDigest`. Not integrated.
