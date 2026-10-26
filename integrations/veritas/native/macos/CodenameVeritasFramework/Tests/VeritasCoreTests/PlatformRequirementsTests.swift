import Testing
@testable import VeritasCore

@Suite("macOS 27 Apple Silicon platform contract")
struct PlatformRequirementsTests {
    @Test(
        "Only macOS 27 or later on arm64 is admitted",
        arguments: [
            (PlatformFacts(operatingSystem: .macOS, macOSMajor: 27, architecture: .arm64), true),
            (PlatformFacts(operatingSystem: .macOS, macOSMajor: 28, architecture: .arm64), true),
            (PlatformFacts(operatingSystem: .macOS, macOSMajor: 26, architecture: .arm64), false),
            (PlatformFacts(operatingSystem: .macOS, macOSMajor: 27, architecture: .x86_64), false),
            (PlatformFacts(operatingSystem: .macOS, macOSMajor: 27, architecture: .unknown), false),
            (PlatformFacts(operatingSystem: .unsupported, macOSMajor: 27, architecture: .arm64), false),
        ]
    )
    func admission(facts: PlatformFacts, expected: Bool) {
        let result = PlatformRequirements.evaluate(facts)

        #expect(result.allowed == expected)
        #expect(result.target == "macOS 27.0+ · Apple Silicon · arm64 only")
    }

    @Test("The current native lane is admitted")
    func currentPlatform() {
        let facts = PlatformRequirements.currentFacts()
        let admission = PlatformRequirements.currentAdmission()

        #expect(facts.operatingSystem == .macOS)
        #expect(facts.architecture == .arm64)
        #expect(admission.allowed == true)
        #expect(admission.limitationCodes.isEmpty)
        #expect(admission.userMessage == nil)
    }

    @Test(
        "Each unsupported platform axis returns exact refusal codes",
        arguments: [
            (
                PlatformFacts(operatingSystem: .macOS, macOSMajor: 26, architecture: .arm64),
                ["PLATFORM_MACOS_27_REQUIRED"]
            ),
            (
                PlatformFacts(operatingSystem: .macOS, macOSMajor: 27, architecture: .x86_64),
                ["PLATFORM_APPLE_SILICON_ARM64_REQUIRED"]
            ),
            (
                PlatformFacts(operatingSystem: .macOS, macOSMajor: 27, architecture: .unknown),
                ["PLATFORM_APPLE_SILICON_ARM64_REQUIRED"]
            ),
            (
                PlatformFacts(operatingSystem: .unsupported, macOSMajor: 27, architecture: .arm64),
                ["PLATFORM_MACOS_REQUIRED"]
            ),
        ]
    )
    func exactRefusalCodes(facts: PlatformFacts, expectedCodes: [String]) {
        let result = PlatformRequirements.evaluate(facts)

        #expect(result.allowed == false)
        #expect(result.limitationCodes == expectedCodes)
        #expect(result.userMessage != nil)
    }

    @Test("Combined unsupported facts preserve deterministic refusal order")
    func combinedRefusalCodes() {
        let result = PlatformRequirements.evaluate(
            PlatformFacts(
                operatingSystem: .macOS,
                macOSMajor: 26,
                architecture: .x86_64
            )
        )

        #expect(result.allowed == false)
        #expect(result.limitationCodes == [
            "PLATFORM_MACOS_27_REQUIRED",
            "PLATFORM_APPLE_SILICON_ARM64_REQUIRED",
        ])
        #expect(result.userMessage?.contains("macOS 27 or later") == true)
    }
}
