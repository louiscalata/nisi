# Track 7 — release-readiness validator

**Overall roadmap progress: 30% — 3/10 NX milestones accepted.**

2026-09-13 22:57 PDT — OpenCode (co-author, go tier / kimi-k2.7-code, 11 min)
implemented Claude's binding contract: every platform entry must bind a
receipt file by path + sha256 and takes that receipt's own status; approvals
are exactly six keys and always REQUIRES_AUTHORITY; the retained
`current-readiness.json` keeps its placeholder pins and is therefore honestly
NOT ready. Receipt: `.packets/nisi-track7-release-readiness-binding.result.md`
(DONE). Independent rerun by Claude: hardening 10/10, author 2/2.

| file | sha256 |
|---|---|
| check-release-readiness.mjs | 7f2694c23dc5c5205df81069cdc7b4574c0bf3667f6b06d4f20144086b5a4931 |
| release-readiness-schema.json | 557c3ffc994f6875a513ee4ddd5c3253c65955b0ebeed11f951c4ca2a936520c |
| check-release-readiness.test.mjs | 9216fddd6f4acb24ed057b66343530d6098db34afd67ab9d3c0429194ee596ff |
| current-readiness.json | 6b6c62a980fb5b3392d216ab26132d14fb7324bd52e46eeabe6a59c9f318d1ea |
| check-release-readiness.hardening.test.mjs (Claude, oracle) | 0e222dcdffdadab857f4242935074a64189c3ee7f76f573d17aa4f08c8247588 |

Not claimed: any platform actually ready; any approval; publication.

STATUS: DONE — 2026-09-13
