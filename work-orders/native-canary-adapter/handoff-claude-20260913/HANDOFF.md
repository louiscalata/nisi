# Handoff — native-canary-adapter (2026-09-13T18:33Z)

Contract + tests: Claude (co-author). Pre-execution contract review: Astra (CHANGES MADE; see pre-execution-review-astra.md). Direction: Louis, 2026-09-13: "Draft the vocabulary adapter packet, have Astra review it"; "you and astra can both make and send opencode packets and execute"; "utilize sharedchami worker too. you can send opencode packets there".

## Route, measured
1. `packet-run-pc` (new: packet items → SharedChami PC worker jobs, deterministic receipt). Run 11:27:19–11:30:15 PDT: job `mac-20260913-112719-462a9929de5440a4bb9298ae7dcc235b` (Qwen3-Coder-Next 80B-A3B Q4_K_M, 172.7 s, prompt 11,504 chars with the oracle omitted for the 12,000-char cap) → draft **5/14**. The repair round was refused by the dispatcher: the repair prompt (draft + failing output + contract) was 42 KB, over the cap. Receipt then: `outcome=blocked · P1=FAILED`. Retained: `.packets/nisi-native-canary-adapter.pc-jobs/`.
2. Integrator rewrite (Claude) against the reviewed contract, after reading the draft: defects were (a) each output line serialized BEFORE the outcome was mapped, (b) a code comment containing the forbidden word "process", (c) a duplicate-member scanner that decoded the wrong slice and discarded the parent's key set on nested objects, (d) validation gaps for inherited/array inputs. Rewrite is 180 lines; `npm run test:adapter` **14/14**, `npm test` 3/3, forbidden-token grep none. Draft retained in the pc-jobs result JSON (sha in SHA256SUMS); final source sha256 in SHA256SUMS.
3. `packet-receipt` re-derived deterministically bound to the packet hash: P1 DONE, acceptance exit 0; `executed_by` names the worker draft AND the integrator rewrite. This is not an unattended-executor receipt.

## Author ≠ reviewer
Tests were authored before any draft (Claude) and strengthened by Astra's pre-execution review; the implementation is Claude's rewrite of a worker draft; Astra reviews the implementation next.

## Runner lesson (applied to ~/bin/packet-run-pc)
Repair prompts must be cap-aware: drop Context/Constraints, include the previous draft only if it fits, else send only the item `do` and the failing accept output. Items should be sized so draft + failing output fit under 12,000 chars; otherwise split into more items.
