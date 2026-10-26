---
packet: nisi-native-probe-summary
project_root: /Users/louiscalata/nisi-next-private/work-orders/native-probe-summary
created_by: codex
created: 2026-09-13T01:11:28-07:00
write_owner: opencode
status: blocked
---

# Nisi — readable native-process summary

## Context

This is an isolated private work-order workspace, NOT the Nisi runtime or an
execution sandbox. Implement a display-only function for a future status window.
The canonical product roadmap is `/Users/louiscalata/nisi-next-private/roadmap.md`;
do not read or edit that parent tree. Overall milestone progress remains 30% (3/10).

Node 24 is installed; this ESM package has no dependencies. `npm test` passed its
two baseline checks. `npm run test:formatter` fails all thirteen real assertions
against the existing empty-string placeholder; no tests were skipped or cancelled.
Those failures are expected unfinished work, not permission to edit the tests.

The earlier isolated OpenCode attempt timed out without edits. Its packet and
receipt remain unchanged elsewhere. This stable work order reuses the inspected
contract and tests; it has NOT been executed and does not solve that model timeout.
Fable 5.1's retained review covered the display wording, not implementation safety.

The only implementation target is `src/native-probe-summary.mjs`. It exports
`formatNativeProbeSummary(view)` returning a string synchronously. Input is a
trusted, already-prepared display view, NOT a receipt, model answer or authority.
Missing/null view means an empty view. Fields:

| Field | Render rule |
|---|---|
| `runId`, `statusText`, row `operation`, row `outcome` | Nonempty string verbatim; otherwise `Unknown`. Do not trim or coerce. |
| `clientPid`, `servicePid` | Positive safe integer in decimal; otherwise `Unknown`. |
| `clientDurationMs` | Nonnegative safe integer plus ` ms`; otherwise `Not measured`. Zero is `0 ms`, not missing. |
| Row `errno` | Nonnegative safe integer in decimal; otherwise `Unknown`. |
| `operations` | Render supplied array entries in order, preserving duplicates and outcomes. A missing/null row has unknown fields. Missing/nonarray/empty collection renders one `- Unknown` line. |

Never derive PASS/FAIL, recompute risk, infer service termination, sort rows,
deduplicate, filter, read a clock, or substitute absent measurements with zero.
Do not mutate the view/rows or remember values between calls. Plain text is for
a text widget; it is not escaped HTML and must never be treated as trusted markup.

Exact output shape (one blank line before the two literal caveats, final newline):

```text
Nisi fixed native probe
Run ID: abc123
Observed client PID: 1234
Self-reported service PID: 9876
Client duration: 42 ms
Status: INCOMPLETE — service settlement unconfirmed
Operations:
- own-write: ALLOWED (errno 0)
- outside-open-read: DENIED (errno 1)
- own-close-write: ERROR (errno 5)

Fixed experiment only. Generated-code execution remains disabled.
Client closure does not establish service termination.
```

All labels and caveats are literal. Replace example values using the rules above.
No imports or helpers are needed. Do not use `import`, `require`, `process`,
`fetch`, `XMLHttpRequest`, `eval`, `Function`, `setTimeout`, or `setInterval`
anywhere in the implementation, including comments. Do not use clocks or random
values (`Date`, `performance`, `Math.random`). The protected static check
is a limited source check, not a security proof.

## Constraints

- Write ONLY `src/native-probe-summary.mjs`. Everything else is read-only,
  including `package.json`, `roadmap.md`, tests and `.packets`. No parent-tree exploration.
- OpenCode owns only this draft. Codex owns source review, integration, roadmap
  acceptance and the final decision; packet completion is not product completion.
- No dependencies, installs, network/model calls, filesystem/process APIs, native
  builds/launches/signing, sandbox/permission/authentication changes, service kills,
  generated-task execution, or changes to the actual Nisi runtime.
- Keep all work private. No commits, pushes, packages, public README/demo/benchmark,
  issues, sales material or disclosures. Existing legal and engineering release
  gates remain unchanged. Nothing in this packet grants publication permission.
- Do not run commands, tests or nested packets yourself. The installed wrapper
  runs the inspected acceptance checks and writes the execution receipt.
- Do not alter tests, acceptance commands, order or receipt to obtain DONE. If
  required context/tooling is missing, leave a concrete blocker, not an invented result.
- Default routing is LOCAL. No silent provider change, force-run, automatic retry,
  model replacement, saved settings change or worker dispatch is part of this order.

## Items

### P1 — Implement the exact pure-text display formatter
- **files**: src/native-probe-summary.mjs
- **do**: Replace the empty-string placeholder with the synchronous named export formatNativeProbeSummary(view), following the complete rendering, layout, unknown-value, ordering, nonmutation and caveat contract above. Keep it dependency-free and presentation-only. Leave every protected file unchanged.
- **accept**: npm run test:formatter

## Owner handoff — not executor items

After a requested execution, Codex must inspect the actual diff and wrapper receipt,
verify protected hashes against the retained authoring record, and rerun both
commands. A green baseline alone is not DONE: P1 must also pass all formatter tests.
Code review is required before anything is copied into the Nisi product or wired
to actual records. UI/native integration, evidence parsing and process authority
are outside this packet. Keep failures and unknown usage in the handoff.

Prepared launch command, to be used only when execution is requested:

```sh
CHAMI_PACKET_TIER=local PACKET_EDIT_TIMEOUT=180 /Users/louiscalata/bin/packet-run /Users/louiscalata/nisi-next-private/work-orders/native-probe-summary/.packets/nisi-native-probe-summary.packet.md
```

The 180-second cap bounds this attempt; it is not a promise the local model will
finish. The wrapper preflights the configured route. Failure means inspect and
report, not switch tiers or retry automatically. This packet is Mac-path-specific;
it is not a Windows worker request.

## Packet acceptance
npm test
