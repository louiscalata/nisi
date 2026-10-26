# Nisi macOS overlay package

Nisi-owned SwiftPM package that produces the `Nisi` menu-bar executable and an
unsigned `Nisi.app` bundle from the frozen Veritas import without editing it.

- `Package.swift` — one package identity. The three library targets
  (`VeritasSQLiteSupport`, `VeritasCore`, `VeritasAppleFoundation`) are directory
  symlinks into `integrations/veritas/native/macos/CodenameVeritasFramework/Sources/`
  and their declarations mirror the frozen manifest (dependencies, `sqlite3`
  linkage). A separate package could not be used: `VeritasCore` exposes
  `package`-scoped API to the app target, and Xcode 27's build system ignores
  every attempt to give a second package the same `-package-name`.
- `Sources/NisiApp/` — the app target. Four owned copies that are EXACT
  product-wording transforms of the frozen files (pinned line by line by the
  product test): `NisiApp.swift` (type `NisiMenuBarApp`, menu-bar title),
  `MenuBarView.swift` (header text, save-panel message), `ShellTruthV1.swift`
  (coverage statement only), `PrivateVerifiedFileWriter.swift` (export refusal
  text). Two file symlinks to the frozen originals: `AppModel.swift` (no product
  wording) and `IncidentHistoryCoordinator.swift` (its product-name strings are
  Application Support path components, i.e. storage identity, not wording).
- `Info.plist` — bundle metadata for an agent (menu-bar-only) app.
  `CFBundleIdentifier` is `com.louiscalata.nisi`, confirmed by Louis on
  2026-09-14. No icon or asset catalog exists yet.
- Build + assemble: `node work-orders/parallel-seven-tracks-v1/build-nisi-macos.mjs [debug|release]`
  (never launches, signs, notarizes or installs; writes a receipt under `.build/`).
- Product test: `tests/nisi-native-overlay.test.mjs` pins the symlink identity,
  the exact three-line branding transform (two lines in `NisiApp.swift`, one in
  `MenuBarView.swift`), the frozen app-file coverage, the exhaustive manifest
  product/target lists, the twelve plist keys, and the receipt script's
  subprocess surface (three absolute system tools, `codesign` describe-only).

Known residue (measured on the built binary, string table included): three
"Codename Veritas Framework" literals, every one identity-bearing or
library-owned — `IncidentHistoryCoordinator.swift:60` (Application Support
path components; changing them would orphan existing private history),
`ShellTruthV1.swift:573` (a `hasPrefix` match against the frozen library's
platform message), and `VeritasCore/PlatformRequirements.swift:58` itself. The
`veritas.*` accessibility identifiers, `scope/veritas-private` and the project
digest seed are identifiers, not wording, and stay. No other "Veritas" word
remains in the binary.

Signature state, as measured by the receipt script (never applied by it): the
debug executable is ad-hoc signed by Xcode's build system codesign step with
debugging entitlements (`com.apple.security.get-task-allow`,
`com.apple.application-identifier` = `nisi.Nisi`); the release executable is
linker-signed ad-hoc with no entitlements. Neither carries an identity, team or
authority. The receipt refuses anything else.
