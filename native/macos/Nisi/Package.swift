// swift-tools-version: 6.2
// Nisi-owned mirror package. It compiles the frozen Veritas library sources
// (integrations/veritas/…) THROUGH directory symlinks so every module shares one
// package identity — VeritasCore exposes `package`-scoped API that the app target
// consumes — and owns only the branded app entry points plus packaging. The
// imported tree is never edited from here; a symlink is not a copy.
import PackageDescription

let package = Package(
    name: "Nisi",
    platforms: [
        .macOS("27.0"),
    ],
    products: [
        .library(name: "VeritasCore", targets: ["VeritasCore"]),
        .library(name: "VeritasAppleFoundation", targets: ["VeritasAppleFoundation"]),
        .executable(name: "Nisi", targets: ["NisiApp"]),
    ],
    targets: [
        // Frozen sources, mirrored by symlink from the import. Declarations mirror
        // the frozen Package.swift exactly (dependencies and sqlite3 linkage).
        .target(
            name: "VeritasSQLiteSupport",
            linkerSettings: [
                .linkedLibrary("sqlite3"),
            ]
        ),
        .target(
            name: "VeritasCore",
            dependencies: ["VeritasSQLiteSupport"],
            linkerSettings: [
                .linkedLibrary("sqlite3"),
            ]
        ),
        .target(
            name: "VeritasAppleFoundation",
            dependencies: ["VeritasCore"]
        ),
        // Nisi-owned: two branded copies of the frozen app entry files and four
        // symlinks to the unchanged ones.
        .executableTarget(
            name: "NisiApp",
            dependencies: ["VeritasCore", "VeritasAppleFoundation"]
        ),
    ]
)
