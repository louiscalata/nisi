# AFM internal builder — OpenCode draft relocated out of the frozen import (2026-09-14)

STATUS: HELD FOR LOUIS — not a Nisi work order yet; nothing here is compiled or accepted.

What happened (measured from the OpenCode log and file mtimes, UTC):
- 10:22:34–10:23:27 OpenCode's app session wrote `Sources/VeritasAFMInternalBuilder/main.swift`
  (379 lines, an opt-in Foundation Models "internal-builder lane" evidence probe) INSIDE the
  frozen Veritas import `integrations/veritas/native/macos/CodenameVeritasFramework/` and
  edited that package's `Package.swift` to add the product/target.
- 10:24–10:26 it ran a `swift build` in place (no `--scratch-path`), populating the frozen
  package's `.build/` with the full product set including `*.xctest` bundles.
- Effect: `scripts/verify-veritas-import.mjs` threw `IMPORT_INVENTORY_DRIFT`; the import
  snapshot test and the overlay's compile-surface gate failed (3 suite failures at 10:36Z).
  The standing rule is that the frozen import is never edited; the Nisi overlay
  (`native/macos/Nisi/`) exists precisely so new Swift work lives outside it.

What Claude did at 10:39Z (moves only, nothing deleted):
- `src/VeritasAFMInternalBuilder/main.swift` — OpenCode's file, byte-identical, moved here.
- `evidence/Package.swift.as-modified-by-opencode` — its edited manifest (the +5-line diff adds
  `.executable(name: "Veritas AFM Internal Builder", …)` and an `.executableTarget` on VeritasCore).
- `evidence/Package.swift.frozen-from-ckpt` — the frozen file as restored from checkpoint `HEAD`
  of the remote-less store; copied back into the import (sha now matches the manifest again).
- The in-place build output moved to `.build/quarantine-frozen-build-opencode-20260914/frozen-dot-build/`
  (gitignored); the two pre-existing hidden markers were put back so the overlay pins hold.
- Verifier: `PASS_SOURCE_FREEZE_ONLY` 225/225; overlay + import tests 22/22.

Decision for Louis: if the AFM internal-builder probe is wanted, it becomes a Nisi-owned target
in the overlay package (`native/macos/Nisi/Package.swift` + `Sources/VeritasAFMInternalBuilder/`),
with the overlay test's exhaustive target list, the receipt script's compiled-surface walk and
`README.md` updated, and a contract + oracle before any build receipt. If not, this directory is
the retained record. Either way OpenCode must not write under `integrations/veritas/` again; its
handoff is updated to say so explicitly.
