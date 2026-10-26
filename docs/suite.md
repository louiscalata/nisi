# AGIW suite — manifest (2026-09-23; historical update 2026-09-25)

> **Product direction update — September 25, 2026:** Louis abandoned the Nisi
> chat-app product and requested its removal from the active product surface.
> This manifest now records historical implementation only; the active project
> focus is the Nisi v0.2 Node.js CLI/library. See the current status at the top
> of `roadmap.md`.

**AGIW** (Filipino for *spiderweb*) is the whole connected suite. **Nisi
inference** was its first planned build: the Mac-side on-device + resident-local
chat inference layer, now retained as historical work. Recorded per Louis's naming directive (2026-09-21, see
`naming-and-core-design.md`). Artifact names are not renamed; the suite
identity is this manifest plus the roadmap/architecture heads.

## Builds (status as of September 25)

| Build | Status | Where |
|---|---|---|
| **1. Nisi inference** (former first build) | Retired as an active chat-app product on September 25; prior acceptance and implementation details are historical only | `work-orders/v1-chat-slice` and `work-orders/v1-02-lifecycle` (archive) |
| Workflow engine | Active v0.2 Node.js CLI/library focus; acceptance remains governed by `roadmap.md` | `workflow/engine.mjs`, `hosts/repository/reviewed-workflow-v1.mjs` |
| Adapters | Private modules remain; v0.2 coding-workflow adapters are active, while chat-app integration is retired | `adapters/` |
| Windows worker lane | delegated to Windows OpenCode (heterogeneous-inference design choice unchanged) | roadmap Direction |

## Nisi inference — historical components (not an active product surface)

- **`Nisi.app` / `nisi-chat-window`** — SwiftUI chat window: live streaming
  display (AFM + local deltas), backend toggle (AFM / resident local gemma,
  `@AppStorage`), History panel with confirm-delete, distinct error notices.
- **`nisi-chat`** — AFM turn CLI with pure-layer selftest (48 checks in the
  2026-09-23 Mac source pass).
- **`nisi-session`** — conversation CLI: turn/AFM/local, `--list`, `--delete`,
  store integrity (67 checks in the 2026-09-23 Mac source pass).
- **`nisi-status`** — one-command self-check: window process, AFM availability,
  store health, resident LM Studio models (`--json` for scripts).
- **Adaptive depth** — prompts ≥ 500 UTF-16 auto-upgrade to the experimental
  research tier (deep-thinking prompt + structured research answer) with
  autocontinue (up to 2 continuation legs, honest `budget-80pct` heuristic —
  macOS 26 exposes no stopReason; `ReasoningLevel`/tool calling are 27-only).
- **Conversation store** — `ConversationStore` + `ConversationListing` under
  the app-support `Nisi` directory; PASS-only writes, sidecar digest.

## Identity rules

- Suite-level documents say **AGIW**; member artifacts keep inference names
  (`nisi-*`, `Nisi.app`). Counter changes only via an explicit rename pass.
- Honesty contract unchanged: `networkEgress: false` (loopback HTTP is not
  egress, reported as `loopback-http`), no secure-erasure claim, no
  certification without a supported `run.json` manifest.

## Handoff

The 2026-09-23 development handoff for the bounded Claude/Codex delegates is
`docs/HANDOFF-2026-09-23.md` (current pins, SDK facts, build recipes, open
items, router state, conventions).
