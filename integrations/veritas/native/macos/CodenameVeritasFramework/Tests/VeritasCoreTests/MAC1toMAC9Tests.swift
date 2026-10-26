import Foundation
import Testing
@testable import VeritasCore

// MARK: - MAC1–MAC9 Product Phases Tests

/// Targeted tests for the broader type/support matrix: desktop/laptop/server
/// types, arm64/x86_64 architectures, macOS operating system, and minimum
/// macOS 27 requirement.
@Suite("MAC1–MAC9 — Broader type/support matrix")
struct MAC1toMAC9Tests {

    @Test("Platform support matrix supports desktop, laptop, and server types")
    func platformSupportMatrixSupportsTypes() async throws {
        #expect(PlatformRequirements.supportsType(.desktop))
        #expect(PlatformRequirements.supportsType(.laptop))
        #expect(PlatformRequirements.supportsType(.server))
        #expect(!PlatformRequirements.supportsType(.unknown))
    }

    @Test("Platform support matrix supports arm64 and x86_64 architectures")
    func platformSupportMatrixSupportsArchitectures() async throws {
        #expect(PlatformRequirements.supportsArchitecture(.arm64))
        #expect(PlatformRequirements.supportsArchitecture(.x86_64))
        #expect(!PlatformRequirements.supportsArchitecture(.unknown))
    }

    @Test("Platform support matrix supports macOS operating system")
    func platformSupportMatrixSupportsOperatingSystem() async throws {
        #expect(PlatformRequirements.supportsOperatingSystem(.macOS))
        #expect(!PlatformRequirements.supportsOperatingSystem(.unsupported))
        #expect(!PlatformRequirements.supportsOperatingSystem(.unknown))
    }

    @Test("Platform support matrix enforces minimum macOS 27")
    func platformSupportMatrixEnforcesMinimumMacOS() async throws {
        #expect(PlatformRequirements.supportMatrix.minimumMacOSMajor == 27)

        // macOS 26 should be refused.
        let facts26 = PlatformFacts(
            operatingSystem: .macOS,
            macOSMajor: 26,
            macOSMinor: 0,
            macOSPatch: 0,
            architecture: .arm64
        )
        let admission26 = PlatformRequirements.evaluate(facts26)
        #expect(!admission26.allowed)
        #expect(admission26.limitationCodes.contains("PLATFORM_MACOS_27_REQUIRED"))

        // macOS 27 should be admitted.
        let facts27 = PlatformFacts(
            operatingSystem: .macOS,
            macOSMajor: 27,
            macOSMinor: 0,
            macOSPatch: 0,
            architecture: .arm64
        )
        let admission27 = PlatformRequirements.evaluate(facts27)
        #expect(admission27.allowed)
        #expect(admission27.limitationCodes.isEmpty)

        // macOS 28 should be admitted.
        let facts28 = PlatformFacts(
            operatingSystem: .macOS,
            macOSMajor: 28,
            macOSMinor: 0,
            macOSPatch: 0,
            architecture: .arm64
        )
        let admission28 = PlatformRequirements.evaluate(facts28)
        #expect(admission28.allowed)
        #expect(admission28.limitationCodes.isEmpty)
    }

    @Test("Platform support matrix handles x86_64 architecture")
    func platformSupportMatrixHandlesX86_64() async throws {
        let factsX86_64 = PlatformFacts(
            operatingSystem: .macOS,
            macOSMajor: 27,
            macOSMinor: 0,
            macOSPatch: 0,
            architecture: .x86_64
        )
        let admissionX86_64 = PlatformRequirements.evaluate(factsX86_64)
        #expect(!admissionX86_64.allowed)
        #expect(admissionX86_64.limitationCodes.contains("PLATFORM_APPLE_SILICON_ARM64_REQUIRED"))
    }

    @Test("Platform support matrix handles unknown architecture")
    func platformSupportMatrixHandlesUnknownArchitecture() async throws {
        let factsUnknown = PlatformFacts(
            operatingSystem: .macOS,
            macOSMajor: 27,
            macOSMinor: 0,
            macOSPatch: 0,
            architecture: .unknown
        )
        let admissionUnknown = PlatformRequirements.evaluate(factsUnknown)
        #expect(!admissionUnknown.allowed)
        #expect(admissionUnknown.limitationCodes.contains("PLATFORM_APPLE_SILICON_ARM64_REQUIRED"))
    }

    @Test("Platform support matrix handles unsupported operating system")
    func platformSupportMatrixHandlesUnsupportedOperatingSystem() async throws {
        let factsUnsupported = PlatformFacts(
            operatingSystem: .unsupported,
            macOSMajor: 27,
            macOSMinor: 0,
            macOSPatch: 0,
            architecture: .arm64
        )
        let admissionUnsupported = PlatformRequirements.evaluate(factsUnsupported)
        #expect(!admissionUnsupported.allowed)
        #expect(admissionUnsupported.limitationCodes.contains("PLATFORM_MACOS_REQUIRED"))
    }

    @Test("Platform support matrix handles unknown operating system")
    func platformSupportMatrixHandlesUnknownOperatingSystem() async throws {
        let factsUnknownOS = PlatformFacts(
            operatingSystem: .unknown,
            macOSMajor: 27,
            macOSMinor: 0,
            macOSPatch: 0,
            architecture: .arm64
        )
        let admissionUnknownOS = PlatformRequirements.evaluate(factsUnknownOS)
        #expect(!admissionUnknownOS.allowed)
        #expect(admissionUnknownOS.limitationCodes.contains("PLATFORM_MACOS_REQUIRED"))
    }

    @Test("Platform support matrix produces user message for refused admission")
    func platformSupportMatrixProducesUserMessage() async throws {
        let facts26 = PlatformFacts(
            operatingSystem: .macOS,
            macOSMajor: 26,
            macOSMinor: 0,
            macOSPatch: 0,
            architecture: .arm64
        )
        let admission26 = PlatformRequirements.evaluate(facts26)
        #expect(admission26.userMessage != nil)
        #expect(admission26.userMessage!.contains("macOS 27"))
        #expect(admission26.userMessage!.contains("arm64"))

        let factsUnknown = PlatformFacts(
            operatingSystem: .macOS,
            macOSMajor: 27,
            macOSMinor: 0,
            macOSPatch: 0,
            architecture: .x86_64
        )
        let admissionUnknown = PlatformRequirements.evaluate(factsUnknown)
        #expect(admissionUnknown.userMessage != nil)
        #expect(admissionUnknown.userMessage!.contains("macOS 27"))
        #expect(admissionUnknown.userMessage!.contains("arm64"))
    }

    @Test("Platform support matrix produces nil user message for admitted admission")
    func platformSupportMatrixProducesNilUserMessage() async throws {
        let facts27 = PlatformFacts(
            operatingSystem: .macOS,
            macOSMajor: 27,
            macOSMinor: 0,
            macOSPatch: 0,
            architecture: .arm64
        )
        let admission27 = PlatformRequirements.evaluate(facts27)
        #expect(admission27.userMessage == nil)
    }

    @Test("Platform support matrix supports current platform")
    func platformSupportMatrixSupportsCurrentPlatform() async throws {
        let currentFacts = PlatformRequirements.currentFacts()
        let currentAdmission = PlatformRequirements.currentAdmission()

        #expect(currentFacts.operatingSystem == .macOS)
        #expect(currentFacts.architecture == .arm64)
        #expect(currentAdmission.allowed)
        #expect(currentAdmission.limitationCodes.isEmpty)
    }

    @Test("Platform support matrix supports all current platform features")
    func platformSupportMatrixSupportsAllCurrentPlatformFeatures() async throws {
        let currentFacts = PlatformRequirements.currentFacts()

        #expect(PlatformRequirements.supportsType(.desktop))
        #expect(PlatformRequirements.supportsType(.laptop))
        #expect(PlatformRequirements.supportsType(.server))
        #expect(PlatformRequirements.supportsArchitecture(currentFacts.architecture))
        #expect(PlatformRequirements.supportsOperatingSystem(currentFacts.operatingSystem))
    }
}
