#if !arch(arm64)
#error("VERITAS_REQUIRES_APPLE_SILICON_ARM64")
#endif

#if !os(macOS)
#error("VERITAS_REQUIRES_MACOS")
#endif

import Foundation

public enum VeritasArchitecture: String, Codable, Equatable, Sendable {
    case arm64
    case x86_64
    case unknown
}

public enum VeritasOperatingSystem: String, Codable, Equatable, Sendable {
    case macOS
    case unsupported
    case unknown
}

public struct PlatformFacts: Codable, Equatable, Sendable {
    public let operatingSystem: VeritasOperatingSystem
    public let macOSMajor: Int
    public let macOSMinor: Int
    public let macOSPatch: Int
    public let architecture: VeritasArchitecture

    public init(
        operatingSystem: VeritasOperatingSystem,
        macOSMajor: Int,
        macOSMinor: Int = 0,
        macOSPatch: Int = 0,
        architecture: VeritasArchitecture
    ) {
        self.operatingSystem = operatingSystem
        self.macOSMajor = macOSMajor
        self.macOSMinor = macOSMinor
        self.macOSPatch = macOSPatch
        self.architecture = architecture
    }
}

public struct PlatformAdmission: Codable, Equatable, Sendable {
    public let allowed: Bool
    public let target: String
    public let limitationCodes: [String]

    public init(allowed: Bool, target: String, limitationCodes: [String]) {
        self.allowed = allowed
        self.target = target
        self.limitationCodes = limitationCodes
    }

    public var userMessage: String? {
        guard !allowed else { return nil }
        return "Codename Veritas Framework requires macOS 27 or later on Apple Silicon (arm64). [\(limitationCodes.joined(separator: ", "))]"
    }
}

public enum PlatformType: String, Codable, Equatable, Sendable {
    case desktop
    case laptop
    case server
    case unknown
}

public struct PlatformSupportMatrix: Codable, Equatable, Sendable {
    public let supportedTypes: [PlatformType]
    public let supportedArchitectures: [VeritasArchitecture]
    public let supportedOperatingSystems: [VeritasOperatingSystem]
    public let minimumMacOSMajor: Int
    public let limitationCodes: [String]

    public init(
        supportedTypes: [PlatformType],
        supportedArchitectures: [VeritasArchitecture],
        supportedOperatingSystems: [VeritasOperatingSystem],
        minimumMacOSMajor: Int
    ) {
        self.supportedTypes = supportedTypes
        self.supportedArchitectures = supportedArchitectures
        self.supportedOperatingSystems = supportedOperatingSystems
        self.minimumMacOSMajor = minimumMacOSMajor
        self.limitationCodes = [
            "PLATFORM_TYPE_DESKTOP_LAPTOP_SERVER_SUPPORTED",
            "PLATFORM_ARCHITECTURE_ARM64_X86_64_SUPPORTED",
            "PLATFORM_OPERATING_SYSTEM_MACOS_SUPPORTED",
            "PLATFORM_MINIMUM_MACOS_27_REQUIRED",
        ]
    }

    public static let current = PlatformSupportMatrix(
        supportedTypes: [.desktop, .laptop, .server],
        supportedArchitectures: [.arm64, .x86_64],
        supportedOperatingSystems: [.macOS],
        minimumMacOSMajor: 27
    )
}

public enum PlatformRequirements {
    public static let minimumMacOSMajor = 27
    public static let targetDescription = "macOS 27.0+ · Apple Silicon · arm64 only"
    public static let supportMatrix = PlatformSupportMatrix.current

    public static func evaluate(_ facts: PlatformFacts) -> PlatformAdmission {
        var limitations = [String]()
        if facts.operatingSystem != .macOS {
            limitations.append("PLATFORM_MACOS_REQUIRED")
        } else if facts.macOSMajor < minimumMacOSMajor {
            limitations.append("PLATFORM_MACOS_27_REQUIRED")
        }
        if facts.architecture != .arm64 {
            limitations.append("PLATFORM_APPLE_SILICON_ARM64_REQUIRED")
        }
        return PlatformAdmission(
            allowed: limitations.isEmpty,
            target: targetDescription,
            limitationCodes: limitations
        )
    }

    public static func currentFacts(
        processInfo: ProcessInfo = .processInfo
    ) -> PlatformFacts {
        let version = processInfo.operatingSystemVersion
        #if arch(arm64)
        let architecture = VeritasArchitecture.arm64
        #elseif arch(x86_64)
        let architecture = VeritasArchitecture.x86_64
        #else
        let architecture = VeritasArchitecture.unknown
        #endif
        return PlatformFacts(
            operatingSystem: .macOS,
            macOSMajor: version.majorVersion,
            macOSMinor: version.minorVersion,
            macOSPatch: version.patchVersion,
            architecture: architecture
        )
    }

    public static func currentAdmission(
        processInfo: ProcessInfo = .processInfo
    ) -> PlatformAdmission {
        evaluate(currentFacts(processInfo: processInfo))
    }

    public static func supportsType(_ type: PlatformType) -> Bool {
        supportMatrix.supportedTypes.contains(type)
    }

    public static func supportsArchitecture(_ architecture: VeritasArchitecture) -> Bool {
        supportMatrix.supportedArchitectures.contains(architecture)
    }

    public static func supportsOperatingSystem(_ operatingSystem: VeritasOperatingSystem) -> Bool {
        supportMatrix.supportedOperatingSystems.contains(operatingSystem)
    }
}
