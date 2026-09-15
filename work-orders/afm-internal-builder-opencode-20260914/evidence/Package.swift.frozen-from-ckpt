// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "Codename Veritas Framework",
    platforms: [
        .macOS("27.0"),
    ],
    products: [
        .library(name: "VeritasCore", targets: ["VeritasCore"]),
        .library(name: "VeritasAppleFoundation", targets: ["VeritasAppleFoundation"]),
        .executable(name: "Codename Veritas Framework", targets: ["CodenameVeritasApp"]),
        .executable(name: "Veritas AFM Functional Probe", targets: ["VeritasAFMFunctionalProbe"]),
    ],
    targets: [
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
        .executableTarget(
            name: "CodenameVeritasApp",
            dependencies: ["VeritasCore", "VeritasAppleFoundation"]
        ),
        .executableTarget(
            name: "VeritasAFMFunctionalProbe",
            dependencies: ["VeritasCore", "VeritasAppleFoundation"]
        ),
        // This target is intentionally not a product. Private fault tests build it
        // explicitly; release builds and shipped executable inventories exclude it.
        .executableTarget(
            name: "VeritasLedgerCrashProbe",
            dependencies: ["VeritasCore", "VeritasSQLiteSupport"]
        ),
        // Private DEBUG build-identity experiment; no product or production issuer.
        .executableTarget(
            name: "VeritasNativeBuildProbe",
            dependencies: ["VeritasCore"]
        ),
        // Fixed-input DEBUG scheduler integration only; never a shipped product.
        .executableTarget(
            name: "VeritasScheduledReferenceProbe",
            dependencies: ["VeritasCore"]
        ),
        // Shared private test transport, deliberately absent from all products
        // and shipped targets. SwiftPM's human output is not a machine channel.
        .target(
            name: "VeritasTestEvidenceSupport",
            path: "Tests/VeritasTestEvidenceSupport"
        ),
        .testTarget(
            name: "VeritasCoreTests",
            dependencies: ["VeritasCore", "VeritasTestEvidenceSupport"],
            resources: [.copy("Fixtures")]
        ),
        .testTarget(
            name: "VeritasAppleFoundationTests",
            dependencies: ["VeritasCore", "VeritasAppleFoundation"]
        ),
        .testTarget(
            name: "CodenameVeritasAppTests",
            dependencies: ["CodenameVeritasApp", "VeritasCore", "VeritasTestEvidenceSupport"]
        ),
    ]
)
