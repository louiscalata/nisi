# macOS build reconnaissance — 2026-09-13

## Canonical build surface

The only buildable macOS application source currently present is the imported
Swift package at
`integrations/veritas/native/macos/CodenameVeritasFramework`. It has a
`Package.swift`, not an `.xcodeproj` or `.xcworkspace`. The package requires
macOS 27.0 and Swift tools 6.2. Its executable product `Codename Veritas
Framework` consists of target `CodenameVeritasApp`, which depends on
`VeritasCore` and `VeritasAppleFoundation`; `VeritasCore` depends on the local C
target `VeritasSQLiteSupport` and the system `sqlite3` library. `swift package
describe --type json` reports no remote package dependencies.

The selected developer directory is
`/Applications/Xcode-27.0.app/Contents/Developer`. Observed tools are Xcode 27.0
(build 27A5228h) and Apple Swift 6.4 targeting arm64-apple-macosx27.0.0. These
meet the manifest's declared tool and platform floors on this arm64 host.

The authoritative imported-source allowlist is
`integrations/veritas/native/macos/contracts/native-required-paths-v1.json`.
The import identity is separately pinned in
`integrations/veritas/import-manifest.json`. A build owner must verify both
before compiling and must not edit or regenerate imported sources as part of a
build.

## Next build command

From `/Users/louiscalata/nisi-next-private`, after the root owner has reviewed
the manifest and current imported-source pins, the first complete product build
should be:

```sh
DEVELOPER_DIR=/Applications/Xcode-27.0.app/Contents/Developer \
CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
/usr/bin/xcrun swift build \
  --package-path integrations/veritas/native/macos/CodenameVeritasFramework \
  --product 'Codename Veritas Framework' \
  --configuration debug \
  --scratch-path .build/nisi-codename-veritas-debug
```

SwiftPM produces an unsigned executable, not a distributable `.app` bundle;
the signing variables state the non-signing intent but do not convert the
product into an app bundle. Use `debug` first because several retained contracts
and probes are explicitly DEBUG-scoped. Do not run the resulting executable as
part of compilation. On success, perform a separate release compilation with a
different scratch path and `--configuration release`; that is compilation
evidence only, not installation, launch, signing, notarization, or product
acceptance.

## Evidence ceiling and prerequisites

The newest retained native compiler receipt is
`.build/nisi-swift-kernel-adXfXG/build-manifest.json`, generated
2026-09-13T09:04:24.529Z. It proves only `COMPILED_FIXED_KERNEL_ONLY`: three
VeritasCore files plus `hosts/swift-verifier/main.swift` compiled with Swift 6.4
and the macOS 27 SDK. It is not evidence that the Swift package, app target,
Apple Foundation integration, or UI compiles.

No terminal full-package or `CodenameVeritasApp` build receipt was found. No
`.xcodeproj`, `.xcworkspace`, `Info.plist`, asset catalog/app icon, entitlements,
bundle identifier, archive/export configuration, signing identity, or notarizing
configuration exists in the retained package. Those are prerequisites for a
branded installable `.app`, but not for the initial unsigned SwiftPM compile.
The system `sqlite3` library and macOS 27 SDK are the only non-source build
dependencies declared by the package; actual link success remains unverified
until the build runs.

## Exact first-build source boundary

The executable build should admit only `Package.swift` and the files SwiftPM
resolves for these targets:

- `Sources/CodenameVeritasApp/`: `AppModel.swift`,
  `CodenameVeritasApp.swift`, `IncidentHistoryCoordinator.swift`,
  `MenuBarView.swift`, `PrivateVerifiedFileWriter.swift`, `ShellTruthV1.swift`
- `Sources/VeritasAppleFoundation/`: `AppleFoundationOrchestrator.swift`,
  `ApplePreventionTrial.swift`
- all currently declared files in `Sources/VeritasCore/`
- `Sources/VeritasSQLiteSupport/VeritasSQLiteSupport.c` and
  `Sources/VeritasSQLiteSupport/include/VeritasSQLiteSupport.h`

The three probe executable targets and every test target are outside this
product build. Scripts under `Scripts/` are verification helpers, not compiler
inputs. The future build receipt should retain the command, tool versions,
resolved source paths and pre/post SHA-256 values, exit status, stdout/stderr,
and resulting executable hash in a newly owned evidence directory.

## Nisi branding and connectivity gap

The current UI and product are still named `Codename Veritas Framework` in
`Package.swift`, `Sources/CodenameVeritasApp/CodenameVeritasApp.swift`, and
`Sources/CodenameVeritasApp/MenuBarView.swift`. A minimal Nisi-branded source
change therefore requires those three files plus branding tests. Creating a
real app bundle additionally requires new, Nisi-owned packaging files (at
minimum `Info.plist` and an asset catalog/icon); those files do not yet exist.

There is no Nisi repository-host or XPC connectivity in the Swift app target.
The repository-side work under `work-orders/native-incident-source-v1` prepares
an original, private source payload only and explicitly leaves the Swift bridge
unproven. `hosts/macos-xpc` is a separate fixed probe, not an app integration.
The smallest real connectivity implementation therefore needs a new
versioned Swift bridge source in `Sources/CodenameVeritasApp` or a new local
target declared in `Package.swift`, a closed transport/input contract shared
with the repository host, AppModel ownership and cancellation/drain wiring,
MenuBarView status/consent presentation, and corresponding app/core tests.
That bridge must remain separately authorized and must not reuse probe success
as app-connectivity evidence.

This reconnaissance does not authorize edits to the frozen import, Claude's
working copy, native execution, installation, signing, model access, or service
launch.

## 2026-09-14 — first terminal full-app compile receipts (Claude, co-author, under Louis's takeover authorization)

The retained FAIL receipt `.build/nisi-full-native-build-bD8zYH` was a lookup
defect, not a compile failure: its stdout shows `Build complete! (10.09 sec)`
and the product existed at `swift-build/out/Products/Debug/Codename Veritas
Framework` (Xcode 27's build system emits to `<scratch>/out/Products/<Config>`,
not `arm64-apple-macosx/<config>`). `build-macos.mjs` now asks SwiftPM for the
directory with `--show-bin-path` (recorded as `binPath` in the receipt) and
takes the configuration as `argv[2]` (`debug` default, `release`). Both
compile from the byte-identical frozen import (verifyImportedTree before ==
after, manifest sha unchanged):

| configuration | evidence dir | exit | artifact sha256 | bytes |
|---|---|---:|---|---:|
| debug | `.build/nisi-full-native-build-SW1LT0` | 0 | `5a9816d45aa5de0c55fd8e4e2187b96d193364504d5c0153b9627110bb5e6ec8` | 6648800 |
| release | `.build/nisi-full-native-build-release-FuiYbe` | 0 | `87ef43c78a90ad2077…` (see receipt) | 4246728 |

Linked against system `libsqlite3`, `SwiftUI` and `FoundationModels` (otool -L on
the debug artifact). Status `COMPILED_APP_TARGET_ONLY`: the product is an
unsigned SwiftPM executable, not an app bundle. Nothing was launched, signed,
notarized, installed or branded; Nisi branding and the app bundle files remain
the next native slice, separately authorized.

## 2026-09-14 — Nisi overlay package: branded executable and unsigned bundle (Claude, co-author)

Louis's "go for it" on the overlay proposal. The frozen import is unchanged
(225 files verify before and after every build; `.build/CACHEDIR.TAG` under the
frozen package predates this work). What exists now:

- `native/macos/Nisi/` — a Nisi-owned SwiftPM **mirror** package. The three
  library targets are directory symlinks into the frozen `Sources/`; their
  declarations mirror the frozen manifest byte-for-byte after whitespace
  folding (pinned by `tests/nisi-native-overlay.test.mjs`). The app target
  `NisiApp` holds two branded copies (`NisiApp.swift`: type `NisiMenuBarApp`,
  `MenuBarExtra("Nisi", …)`; `MenuBarView.swift`: `Text("Nisi")`) and four
  file symlinks to the unchanged app files. Product: `Nisi`.
- Why a mirror and not a local package dependency: `VeritasCore` exposes
  `package`-scoped API (75 declarations; the app uses e.g.
  `ReferenceArtifactShadowRunOwner`). A separate package fails to compile
  against it, and Xcode 27's build system drops a second `-package-name`
  whether passed by `unsafeFlags` or `-Xswiftc` (both measured; the frontend
  command carried only `-package-name nisi`). One package identity is the only
  route that leaves the import frozen.
- `native/macos/Nisi/Info.plist` — agent app (`LSUIElement`), `CFBundleName`
  `Nisi`, `CFBundleIdentifier` `com.louiscalata.nisi` (placeholder from the
  public repository owner; confirm before any signing identity), no icon.
- `build-nisi-macos.mjs [debug|release]` — builds product `Nisi` with
  `--scratch-path` under a fresh `.build/nisi-app-bundle-<config>-*/`,
  refuses symlink escapes and overlay drift during the build, assembles
  `Nisi.app/Contents/{MacOS/Nisi,Info.plist,PkgInfo}` (plutil-linted), records
  the codesign state and refuses anything other than the linker's ad-hoc
  signature, and counts residual "Codename Veritas Framework" strings.

Receipts (retained copies in `docs/verification/2026-09-14/nisi-app-bundle/`):

| Config | Evidence dir | Status | `Nisi` sha256 | Bytes | codesign |
|---|---|---|---|---|---|
| debug | `.build/nisi-app-bundle-debug-vzfBHR` | `ASSEMBLED_UNSIGNED_BUNDLE` | `3aaf7d4e7b2960c910ebe4acff173ede1ceff84b6d920db16aa0ab29a4909348` | 6,605,824 | `Signature=adhoc`, `TeamIdentifier=not set`, no Authority |
| release | `.build/nisi-app-bundle-release-hgBfPt` | `ASSEMBLED_UNSIGNED_BUNDLE` | `8f03b012273c18c3…` (see receipt) | 4,218,056 | same |

The executable hash is output-path dependent (LC_UUID), so two builds of
identical sources differ; the receipt's `overlayInventory` hashes are the
stable identity. Residual old-name strings in the binary: 4 per build, all from
the four frozen app files (`ShellTruthV1.swift` platform message and
client-coverage text, `IncidentHistoryCoordinator.swift` history names,
`PrivateVerifiedFileWriter.swift` refusal). Suite 1704/1704 with the new test.

Still not done: icon/asset catalog, confirmed bundle identifier, entitlements,
any signing or notarization, launch, install, repository-host connectivity,
rebranding the four frozen app files (a separate authorized edit of owned
copies that must keep identity-bearing values unchanged). Nothing was
launched, signed with an identity, notarized or installed.

### Correction after the adversarial review (same day)

Claude's review of the overlay (workflow wf_44eef069-f25; report at
`evidence/claude-overlay-review-20260914.md`) found four claims above that were
wrong or unmeasured. Corrections, each re-measured:

1. **Signature.** "The linker's ad-hoc signature" is true only for release.
   The debug executable is ad-hoc signed by Xcode's build-system codesign
   step (`flags=adhoc`, not `linker-signed`) and carries debugging
   entitlements `com.apple.security.get-task-allow` and
   `com.apple.application-identifier` = `nisi.Nisi`; release is
   `adhoc,linker-signed` with no entitlements. The v2 receipt script records
   `flags`, `linkerSigned`, `identifier` and `entitlementKeys`, and refuses
   any signature that is not ad-hoc or that carries an authority or team.
   The script itself never invokes `codesign` except to describe.
2. **Residual strings.** Of the four "Codename Veritas Framework" literals,
   three come from the app files (`ShellTruthV1.swift:218`, `:573`,
   `IncidentHistoryCoordinator.swift:60`) and one from the frozen library
   `VeritasCore/PlatformRequirements.swift:58`; `PrivateVerifiedFileWriter.swift`
   contributes none of those four but, like the owned `MenuBarView.swift:360`,
   carries a bare "Veritas" sentence. The receipt now also counts bare
   `Veritas` words (6) and how many times the build root path is embedded in
   the binary (72 debug / 69 release, N_OSO stabs and string table), so
   nothing is shared blind.
3. **Hash variance.** Beyond `LC_UUID`, the executable embeds the scratch path
   and object file paths (string table) and the ad-hoc CodeDirectory re-hashes
   every page, so two builds of identical sources differ in ~25 KB. The stable
   identity is the receipt's `overlayInventory` (sha256 of every owned file and
   the resolved target of every symlink).
4. **The `-package-name` claim** was observed during development but only one
   log was retained: `docs/verification/2026-09-14/nisi-app-bundle/separate-package-attempt-20260914T0756Z.log`
   is the separate-package build with BOTH `unsafeFlags(["-package-name", …])`
   in the manifest and `-Xswiftc -package-name -Xswiftc codenameveritasframework`
   on the command line; its frontend command carries only `-package-name nisi`
   and the compile fails on `ReferenceArtifactShadowRunOwner`. The
   unsafeFlags-only attempt has no retained log.

Also fixed from the review: a build without `--scratch-path` had written
`.build/{CACHEDIR.TAG,.buildSystem_debug}` into the frozen package on
2026-09-14T05:02Z (before any retained receipt). The v2 script snapshots every
entry under the frozen package that the manifest does not cover before and
after the build and fails on any difference (`FROZEN_HIDDEN_ENTRY_DRIFT`); the
product test pins the frozen package's hidden listing to exactly those two
stale markers. The script also refuses a frozen app file the overlay does not
cover (`FROZEN_APP_TARGET_NOT_COVERED`), a bin path outside its scratch, and
records the build env and cwd. The product test now asserts the branded files
are the exact product-name transform of the originals (a sabotaged line no
longer passes), lists products/targets exhaustively, pins the twelve plist keys,
and audits the script's subprocess surface; nine review mutants are all caught.

Receipts v2 (retained in `docs/verification/2026-09-14/nisi-app-bundle/`; the v1
receipts were superseded and removed):

| Config | Evidence dir | `Nisi` sha256 | Bytes | codesign flags | entitlements |
|---|---|---|---|---|---|
| debug | `.build/nisi-app-bundle-debug-srvl8J` | `a69ae90354a1be44083878e8de8cf11f565b0125f369dfa3cd2040726fbfcb40` | 6,605,824 | `adhoc` | get-task-allow, application-identifier |
| release | `.build/nisi-app-bundle-release-3OgEmF` | `3f650c26250fae7e163719af5810cfd57e31fd87f08f49cc1a5318faa5869c3f` | 4,218,056 | `adhoc,linker-signed` | none |

Both `ASSEMBLED_UNSIGNED_BUNDLE`; frozen import 225/225 and hidden entries
unchanged before and after; overlay inventory unchanged during the build.

### Wording rebrand of the remaining app strings (Louis: "confirm", 2026-09-14)

Louis confirmed the bundle identifier `com.louiscalata.nisi` and the wording
rebrand. Each remaining old-name string was inspected for what it does before
touching it:

| String | Verdict | Action |
|---|---|---|
| `ShellTruthV1.swift:218` coverage statement | display wording | owned copy, one-line transform → "the Nisi menu bar, the only covered client" |
| `PrivateVerifiedFileWriter.swift:74` export refusal | display wording | owned copy, one-line transform → "Nisi will not replace it." |
| `MenuBarView.swift:360` save-panel message | display wording | second transform in the existing owned copy |
| `ShellTruthV1.swift:573` platform-message prefix | matched with `hasPrefix` against frozen `VeritasCore/PlatformRequirements.swift:58` | **kept**; pinned verbatim by the test |
| `IncidentHistoryCoordinator.swift:60` names | Application Support path components (storage identity) | **kept**, file stays a symlink; pinned verbatim |
| `veritas.*` accessibility ids, `scope/veritas-private`, project digest seed | identifiers | **kept**; pinned verbatim |

The app target is now four owned copies (each the exact frozen original plus
its listed replacements, enforced by `tests/nisi-native-overlay.test.mjs`) and
two symlinks. Receipts v2 after the rebrand (retained beside the earlier pair):

| Config | Evidence dir | `Nisi` sha256 | Bytes | codesign | residual full-name / bare "Veritas" |
|---|---|---|---|---|---|
| debug | `.build/nisi-app-bundle-debug-GKiX5y` | `d66a8301b1140b8f…` (see receipt) | 6,605,824 | `adhoc` + get-task-allow | 3 / 3 |
| release | `.build/nisi-app-bundle-release-44JGQe` | `490559addf5e2cc7…` (see receipt) | 4,218,056 | `adhoc,linker-signed` | 3 / 3 |

All three remaining literals are the identity-bearing ones in the table.
Still open: icon/asset catalog, entitlements for a shipped app, signing,
notarization, launch, install, repository-host connectivity.

### Second correction — overlay review synthesis (ACCEPT_WITH_FIXES, wf_44eef069-f25)

Report and disposition: `evidence/claude-overlay-review-20260914.md`. What changed:

1. **Compile surface vs verifier surface.** `scripts/verify-veritas-import.mjs`
   skips `node_modules/`, `DerivedData/` and `*.xcresult` without traversing
   them, but SwiftPM compiles any non-hidden `.swift` under a target directory,
   so a source dropped under such a name inside a mirrored tree compiled into
   `Nisi` while every gate stayed green (reviewer's R1 probe). The v3 receipt
   script and the product test now walk through the mirrored symlinks the way
   the compiler does and require every reachable source to be a manifest entry
   with an equal sha256; the verifier's exclusion list is pinned to exactly the
   stale `.build`, and its hidden entries to the two known markers. The earlier
   sentence "the product test pins the frozen package's hidden listing" was
   accurate only for `.build/`; it now pins the frozen top level, `.build/`,
   and the full compiled surface.
2. **Build identity.** The receipt's `overlayInventory` is split into
   `buildInputs` (Package.swift, Info.plist, Sources/**) and `docs`
   (README.md), plus `compiledSources` (36 files: 32 frozen by manifest path,
   4 owned transforms). A README edit no longer changes what a build was.
3. **`CODE_SIGNING_ALLOWED/REQUIRED=NO`** are passed and recorded but measured
   ineffective for `swift build`: the debug product is still ad-hoc codesigned
   with default debug entitlements by the build system. The codesign fields in
   the receipt are the truth; the variables disable nothing.
4. **The retained `-package-name` log** shows the frontend command (only
   `-package-name nisi`) and the `ReferenceArtifactShadowRunOwner` failure; the
   manifest and `swift build` command line of that attempt were not retained.
5. **Mutant evidence** is retained at
   `docs/verification/2026-09-14/nisi-app-bundle/overlay-test-mutants.txt`
   (13 single-change mutants against the current test in complete scratch
   copies, all caught; the receipt script refuses R1 before any build).
   Suite counts in this file are per their timestamp; other tracks landed tests
   concurrently.

Receipts v3 (final for this slice):

| Config | Evidence dir | `Nisi` sha256 | Bytes | codesign | residual full-name / bare "Veritas" |
|---|---|---|---|---|---|
| debug | `.build/nisi-app-bundle-debug-pSElar` | `727b4ad124919ee9…` (see receipt) | 6,605,824 | `adhoc` + get-task-allow | 3 / 3 |
| release | `.build/nisi-app-bundle-release-wycviJ` | `e6bafd03e89340b4…` (see receipt) | 4,218,056 | `adhoc,linker-signed` | 3 / 3 |
