# Journal restart recovery — private work-order roadmap

**Overall Nisi roadmap progress: 30% — 3/10 major NX milestones accepted.**
The [product roadmap](../../roadmap.md) remains canonical.

This is a disjoint lower-layer U02-04 recovery acceptance task. Another Claude/
OpenCode lane owns host-journal-bundle. This work imports no host-bundle code and
does not change its packet, sources, tests or fixtures.

- [x] Verify current frozen journal/store identities and independent scope.
- [x] Obtain Daybreak review and bounded Claude design review.
- [x] Author fixed child CLI, protected tests, private package and placeholder.
- [x] Confirm baseline 2/2 green and all 10 recovery tests discriminate unfinished work.
- [x] Lint the complete packet and record protected hashes.
- [x] Execute one bounded OpenCode implementation attempt on the explicitly selected free lane (BLOCKED, no source edit).
- [x] Inspect actual source, rerun tests and check all protected files.
- [x] Retain concrete fresh-process evidence and required negative cases.
- [x] Integrated into the product suite 2026-09-14 (Claude, after OpenCode's O4 rehearsal and adversarial
  review): `history/recovery-worker.mjs`, `tests/fixtures/journal-restart-recovery-cli.mjs`,
  `tests/journal-restart-recovery{,-baseline,-boundaries}.test.mjs` (10 + 1 + 5; temp-dir cleanup added,
  frozen pins dropped). Wiring to the host bundle itself is still a separately owned slice.

**Owner acceptance: 17/17 checks PASS in this isolated work order.** Opus drafted
the worker after OpenCode produced no implementation. Codex added a string/own-key
command guard after supplemental tests reproduced malformed-command routing.
Original recovery 10/10; supplemental red 3/5 then green 5/5; baseline 2/2.
See [owner receipt](evidence/owner-acceptance.json). The original OpenCode BLOCKED
receipt remains historical and is not rewritten to credit Opus work to OpenCode.

Claude CLI evidence: Fable returned out-of-usage credits. The Sonnet fallback
returned placeholder text and was rejected as unusable despite wrapper status.
Pinned Opus reported claude-opus-5 and supplied design findings. Adopted: explicit
write durability fields, distinct store/UTF8/reopen diagnostics, expected-project
checks on damaged prefixes and read-only replay. Corrected: the accepted journal
DOES already classify heartbeat liveness; no parallel implementation is needed.
BOM handling stays with exact canonical reopen rather than transforming bytes.
No fabricated generic persisted boolean or broad recovery authority is added.
Daybreak independently confirmed scope and supplied semantic-corruption cases.

> [!CAUTION]
> **Process restart is not power-loss durability.**
> A successful write must expose file/directory fsync outcomes, and a new Node
> process must read identical bytes. This does not prove reboot/crash-point,
> hostile-directory or concurrent-writer safety.
>
> **Why this matters:** the store assumes a trusted directory and serial writers;
> stronger native and host acceptance remain separate.

> [!WARNING]
> **Fable is unavailable and Sonnet did not produce usable work.**
> Usage-limit and placeholder receipts are retained under
> ../../.build/parallel-recovery-review-AwybUV/.
>
> **Why this matters:** an account, model name or successful helper envelope does
> not establish a task-relevant contribution.

Private operation policy: Louis preapproved normal use/reauthentication of
existing Claude/Codex/OpenCode accounts for this private project. Passwords,
MFA/passkeys/YubiKey touches remain user steps. No new scope grants, purchases,
publication or signing/checkpoint guard bypass is authorized.

Parallel continuation policy: work on disjoint authorized tasks when a lane is
blocked; revisit it on new evidence. Never overwrite a live writer, duplicate a
job, infer failure from an observation timeout, or inflate milestone completion.
