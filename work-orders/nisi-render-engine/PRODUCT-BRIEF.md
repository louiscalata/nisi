# Nisi Render Engine — product brief (v0, 2026-09-14)

Decision (Louis, 2026-09-14): the render engine is a **future Nisi product**,
released as an **Unreal Engine plugin** and a **Unity component plugin**.
This brief records the decision and the design as it stands; it is not
publication approval, and nothing here changes the private-tree rules.

## What it is

A verified, layered render and generation queue that lives inside Unreal
Engine and Unity. It takes render work from the editor — Movie Render Graph
jobs in Unreal, Recorder/Timeline jobs in Unity, and layered generative jobs —
runs it on local hardware directed like a system-on-chip (the engine's own
renderer plus on-device and local models), and returns outputs that are
promoted only after deterministic checks, each with provenance. Verdicts never
come from a model; models draft and review, closed readers decide.

It is Nisi because it is built from Nisi's parts: canonical JSON digests for
identity, the read-policy gate for what the engine may read from a project,
closed readers with exact codes, author ≠ reviewer, on-device models, a
zero-dependency portable core with adapters for everything machine-specific.

## Release shape

| surface | form | role |
|---|---|---|
| Unreal Engine | `NisiRenderEngine.uplugin`: Editor module (queue panel), Runtime module (submit API, Blueprint nodes), Movie Render Graph executor, pass export (depth, normal, albedo…) as layer inputs | thin client |
| Unity | UPM package `com.nisi.render-engine`: `NisiRenderQueue` component, Editor window, Recorder/Timeline submit, URP Render Graph pass for layer export, outputs into Assets with a provenance sidecar | thin client |
| core | Nisi Render Engine host: portable core, canonical-JSON protocol over a local socket, one host serves both engines | the product |

Core packaging is an open decision: (a) an embedded, sandboxed Node host (the
XPC embedded-Node prerequisite accepted 2026-09-13 is exactly this shape on
macOS); (b) a native core with a C ABI bound from C++ and C#; (c) two ports.
Recommendation: (a) first, (b) if the sidecar becomes a distribution problem,
never (c).

Release 1 (recommended): both plugins + queue + engine-renderer worker +
verification + provenance + queue panel + pass export. Release 2: model lanes,
the layered workload, the row line check. Louis decides the split.

## Design state

Design, decisions, research and the first unit live in
`~/pending-review/nisi/render-engine/` (a review-artifact folder):
`DECISIONS.md` (14 decisions), `SPEC.md` v0.1 (state tensor, row state
machine, virtual-SoC capability, mapping onto the Forged Render Engine),
`RESEARCH.html` (published: https://claude.ai/code/artifact/0985034f-a4e4-4e04-9736-96e4aaad776f),
`unit-01-well/` (row state machine: Python reference, 19 owner tests / 88
assertion sites all passing, structural gate PASS, model review unavailable →
UNCERTIFIED).

The Forged Render Engine (`~/Library/CloudStorage/OneDrive-Personal/Playground
Mac/Forged Render Engine`, Codex-owned) is the reference for the durable queue:
leases, expiry recovery, late-result rejection, uncertain-capacity holds,
verified atomic promotion, interactive reserve. The Nisi product extracts the
portable shape of those, as the V5 core extraction did; it does not depend on
that checkout or ship its machine-specific parts.

## Open for Louis

1. Release 1/2 split as recommended, or generative lanes in release 1.
2. Core packaging: (a) embedded Node host or (b) native core.
3. Source visibility: private core with public plugins, or public.
4. Distribution: Fab (Unreal) and Asset Store / UPM git URL (Unity); bundle
   and package identifiers (`com.louiscalata.nisi` is still a placeholder).
5. Engine versions to certify against (Unreal 5.6+ per current 5.8 docs;
   Unity 6.x with URP + Render Graph, 6.5 current).
