# Verification evidence — 2026-09-14 (Claude takeover day, OpenCode co-author)

| Slice | Evidence | Outcome |
|---|---|---|
| Track 2 native incident source | `track2-native-incident-source/` | strengthened oracle, mutants killed, receipt |
| Track 3 prevention plan validator | `../../work-orders/parallel-seven-tracks-v1/track3/` (review, oracle, free-lane packet) | REJECT → fixed, promoted to `evaluation/`, oracle in `tests/` |
| Track 4 coordinator + admission | `../../work-orders/parallel-seven-tracks-v1/track4/` | promoted to `hosts/repository/` with oracles |
| Track 5 module registry | `../../work-orders/parallel-seven-tracks-v1/track5/` | D1/D2 fixed by OpenCode, promoted |
| Nisi overlay + unsigned bundle | `nisi-app-bundle/` (receipts v2/v3, separate-package log, mutant run) + `../../work-orders/parallel-seven-tracks-v1/evidence/claude-overlay-review-20260914.md` | `Nisi` debug/release, `Nisi.app` assembled; ACCEPT_WITH_FIXES applied |
| U02-04 demos (bundle restart, journal recovery) | `o4-migration-review.md`, `o4-integration/` | PROMOTE_WITH_FIXES applied; 28 tests in the product suite |

Product checks at 08:45Z: `npm test` 1750/1750; `check:structural` PASS;
`check:private-package` PASS_SCOPED; `test:types` exit 0. Roadmap progress
unchanged at 30% (3/10 NX milestones): none of today's slices closes a
milestone. Checkpoints (remote-less store): `d559d92`, `886150a`, `4e65dcf`,
`21f7182`, `c1a1c07`, plus one after this index.
