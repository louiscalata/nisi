# Fable → Codex — PAUSE handoff, 2026-09-20 (Claude usage cap; Codex resumes)

Louis: "prepare to pause development as usage cap hits, we'll move back to codex."
Everything Fable holds is on disk, hashed and journaled; nothing is half-written in `~/nisi`.

## State of the cluster (canonical, your ledger)
- C01 `NODE_IMPLEMENTATION_ACCEPTED` (revision 4 pinned + your build-proof correction). C02 `NODE_IMPLEMENTATION_ACCEPTED` (`INERT_FIXTURE_RECEIPT_NODE_ONLY`). Cluster 2/10; NX 3/10; native/publication held.
- Fable's canonical footprint since your acceptances: none beyond `fable-*` records in this folder.

## Candidates and evidence on the share — `/Users/Shared/SharedChami/Nisi/v0.2/finish-cluster-20260920/`
| Packet | Where | State | Reviews attached |
|---|---|---|---|
| C01 rev-5 | `drafts/C01-rev5-candidate/` (+SHA256SUMS) | proposed; not in `~/nisi`; Nisi `--nisi validate` VALIDATED | Daybreak rev-3 report; **Daybreak rev-5 verdict still running** (Codex-side `codex exec`, writes `daybreak-C01/daybreak-review-rev5.md` when done — read it before deciding) |
| C03 (pre-re-base) | `mirror-C03`, `drafts/C03/` | green in mirror on the OLD C02 runner; **superseded** | Astra FAIL with 6 findings + 11 mutants (`drafts/C03/ASTRA-REVIEW-2026-09-20.md`); Nisi validate VALIDATED; Jev triage of the oracle (in scope 0.99, quality 1.93/2) |
| C03 re-base | `mirror-C03b` (partial — the agent was stopped at the pause; check for `drafts/C03b/REBASE-NOTE.md`) | **your next-writer instruction applies**: rebase onto runner `07020b77…`, keep completion tests wired into c03–c05, do not restore settled-only gate / memory-only hashes; fold Astra's six findings as graded cases | — |
| C08 reader | `mirror-C08`, `drafts/C08/` | green in mirror; envelope schema PROVISIONAL; headless capture produced no session (`drafts/C08/capture/NOTE.md`) | Fable adversarial reviews (repair round done) |
| C09 matrix | `mirror-C09`, `drafts/C09/` | green in mirror; Node22 row NOT_RUN | Fable reviews; Nisi validate + review (consistent with P2; one `HOLD_VIOLATION` flag: the named test exists while your hold stands) |
| C06 / C07 | `drafts/C06`, `drafts/C07` `CONTRACT-PROPOSAL.md` + oracle skeletons | open design gates — decisions listed for the owner | — |
| C04 / C05 / C10 | not drafted (chain stopped at the pause) | — | — |

## Lanes and receipts
`astra-C01/`, `daybreak-C01/`, `luna-C01/`, `nisi-review-C01/`, `astra-C03/`, `nisi-C03-C09/` (README explains the three Nisi passes), `jev/` (analyzeTask for all ten packets), `jev-triage-C03/` (EGRESS-NOTE.md: the one file sent to TypeSafe), `route-chat-C01/` (the router refusal evidence).

## Open items that are yours
1. Decide revision 5 for C01 (re-freeze or keep rev 4 with documented limits) after Daybreak's rev-5 verdict lands.
2. C03: finish the re-base per your instruction (or hand it back to Fable on resume), then release.
3. The shared router's unresolved run `claude-c01-latch-advisory-20260920` (`~/.local/state/codemode-router`, stage incomplete): `pipeline_router.py:272-275` records the checkpoint but never archives; only you can resolve it — `--route work` is blocked for all three clients until then.
4. Lifecycle-vocabulary disposition for C03 (mkdtemp ENOSPC → `ownedRoot:null, cleaned:true` vs P2's literal wording).
5. From the share audit (`from-claude-mac/share-audit-2026-09-20-actions.md`): manifest entries, superseded placeholders, hold re-journal, counters, sync direction.

## Open items that are Louis's
Rotate the TypeSafe key; commit `Nisi/v0.2/nisi-linux-llm` (33 staged + 7 edited, zero commits); empty the Trash (specs rescued); decide C06/C07; Node 22 for C09; a live OpenCode capture for C08.

## Resuming Claude later
Read `codex-reply-20260920.md`, this file, and the ledger first; Claude's memory carries the protocol (`nisi-v02-finish-cluster-2026-09-20`). Never touch accepted files or owner controls; land only what you release. Progress page: https://claude.ai/artifact/EABSMpK2k9C3GTrAraGouw

## Addendum at the pause (02:4x) — C03 re-base stopped cleanly; two C03 candidates exist

- `drafts/C03b/` — the re-base agent's **PARTIAL** result: merged runner `529bcdaa…` (your accepted `07020b77…` + the C03 delta, six-clause completion predicate with `receiptEligible`), oracle `4e96dd7c…` copied unadjusted, `node --check` clean on both, **graded tests and mutants NOT run**; `REBASE-NOTE.md` lists the exact remaining sequence (§8), Astra's eleven mutants for re-expression, and the planned oracle cases. Baselines reproduced in `mirror-C03b` before edits: 45/45 · 33/33 · 40/40 after re-syncing your 02:19 wiring.
- `drafts/C03/` — the Fable workflow's **repair round overwrote it at 02:24:12** (runner `6e440f53…`, oracle `d52b38e9…`) after its mirror had been re-synced with canonical bytes at 02:12 — so this second candidate may already sit on your corrected runner; it was reviewed by the workflow's adversarial lenses, not by Astra (Astra reviewed the earlier bytes, preserved under `mirror-C03/.owner-review-c03/reviewed-candidate/`).
- **Owner pick required:** run `test:c03`/`test:c02`/baseline against each, then choose one as the live C03 draft; neither is in `~/nisi`.


## Addendum — Daybreak revision-5 verdict landed (`daybreak-C01/daybreak-review-rev5.md`)

FAIL for defensive acceptance, but: the iterator bypass ADDRESSED; the symlink-above-root case **ADDRESSED under the physical-identity trust model, which Daybreak accepts as such**; finding 3 is your build-proof correction; growth and resource limits PARTIAL. Two new items for whoever writes revision 6: (HIGH) index assignment into a fresh array (`out[i] = …`) runs an inherited `Array.prototype[0]` setter — define own indices with a captured `Object.defineProperty` for every internal array; (MEDIUM) the bounded read must establish EOF, not just count === size. Recorded in `fable-c01-integration-20260920.json` → `revision5Candidate.daybreakRevision5`. No revision 6 exists; your decision stands between revision 4 (accepted) and a revision 6 that folds these two in.
