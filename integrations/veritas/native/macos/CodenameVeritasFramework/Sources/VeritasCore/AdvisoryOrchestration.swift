import Foundation

public enum AnalyzerProbeState: String, Codable, Sendable {
    case ready = "READY"
    case degraded = "DEGRADED"
}

public struct AnalyzerProbe: Codable, Equatable, Sendable {
    public let state: AnalyzerProbeState
    public let provider: String
    public let route: String
    public let contextSize: Int?
    public let requestTokenCount: Int?
    public let reasonCode: String?
    public let adapterContractVersion: String
    public let modelIdentityStatus: String
    public let runtimeFingerprint: String?

    public init(
        state: AnalyzerProbeState,
        provider: String,
        route: String,
        contextSize: Int? = nil,
        requestTokenCount: Int? = nil,
        reasonCode: String? = nil,
        adapterContractVersion: String = "advisory-orchestrator-unknown",
        modelIdentityStatus: String = "MODEL_IDENTITY_UNKNOWN",
        runtimeFingerprint: String? = nil
    ) {
        self.state = state
        self.provider = provider
        self.route = route
        self.contextSize = contextSize
        self.requestTokenCount = requestTokenCount
        self.reasonCode = reasonCode
        self.adapterContractVersion = adapterContractVersion
        self.modelIdentityStatus = modelIdentityStatus
        self.runtimeFingerprint = runtimeFingerprint
    }

    private enum CodingKeys: String, CodingKey {
        case state, provider, route, contextSize, requestTokenCount, reasonCode, adapterContractVersion, modelIdentityStatus, runtimeFingerprint
    }

    /// Writes every declared key, including an explicit null for each absent
    /// optional. R5 of the MAC1 canonical contract holds a null value and an
    /// absent key to be distinct; Swift's synthesized encoder omits a nil key,
    /// collapsing `{"k":null}` and `{}` into the same bytes and the same digest.
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(state, forKey: .state)
        try container.encode(provider, forKey: .provider)
        try container.encode(route, forKey: .route)
        try container.encode(contextSize, forKey: .contextSize)
        try container.encode(requestTokenCount, forKey: .requestTokenCount)
        try container.encode(reasonCode, forKey: .reasonCode)
        try container.encode(adapterContractVersion, forKey: .adapterContractVersion)
        try container.encode(modelIdentityStatus, forKey: .modelIdentityStatus)
        try container.encode(runtimeFingerprint, forKey: .runtimeFingerprint)
    }
}

public struct OrchestrationRequest: Codable, Equatable, Sendable {
    public let subjectDigest: String
    public let artifactKind: ArtifactKind
    public let excerpt: String
    public let permittedDimensionNames: [String]
    public let minimumDimensions: Int
    public let maximumDimensions: Int

    public init(
        subjectDigest: String,
        artifactKind: ArtifactKind,
        excerpt: String,
        permittedDimensionNames: [String],
        minimumDimensions: Int = 0,
        maximumDimensions: Int
    ) {
        self.subjectDigest = subjectDigest
        self.artifactKind = artifactKind
        self.excerpt = excerpt
        self.permittedDimensionNames = permittedDimensionNames
        self.minimumDimensions = max(0, minimumDimensions)
        self.maximumDimensions = maximumDimensions
    }
}

public struct AdvisoryPlan: Codable, Equatable, Sendable {
    public let subjectDigest: String
    public let proposedDimensionNames: [String]
    public let rationale: String
    public let nonAuthorizing: Bool

    public init(
        subjectDigest: String,
        proposedDimensionNames: [String],
        rationale: String,
        nonAuthorizing: Bool = true
    ) {
        self.subjectDigest = subjectDigest
        self.proposedDimensionNames = proposedDimensionNames
        self.rationale = rationale
        self.nonAuthorizing = nonAuthorizing
    }
}

public struct DimensionAnalysisRequest: Codable, Equatable, Sendable {
    public let subjectDigest: String
    public let dimension: AdvisoryDimension
    public let excerpt: String

    public init(subjectDigest: String, dimension: AdvisoryDimension, excerpt: String) {
        self.subjectDigest = subjectDigest
        self.dimension = dimension
        self.excerpt = excerpt
    }
}

public enum FindingSeverity: String, Codable, Sendable {
    case note
    case warning
}

public struct AdvisoryFinding: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let subjectDigest: String
    public let dimension: AdvisoryDimension
    public let severity: FindingSeverity
    public let summary: String
    public let nonAuthorizing: Bool

    public init(
        id: String,
        subjectDigest: String,
        dimension: AdvisoryDimension,
        severity: FindingSeverity,
        summary: String,
        nonAuthorizing: Bool = true
    ) {
        self.id = id
        self.subjectDigest = subjectDigest
        self.dimension = dimension
        self.severity = severity
        self.summary = summary
        self.nonAuthorizing = nonAuthorizing
    }
}

/// The model remains advisory. This receipt records what the deterministic core
/// observed; it never grants authority, certification, or permission to write.
public enum AdvisoryReceiptStage: String, Codable, Sendable {
    case probe = "PROBE"
    case plan = "PLAN"
    case finding = "FINDING"
}

public enum AdvisoryReceiptStageOutcome: String, Codable, Sendable {
    case observed = "OBSERVED"
    case unavailable = "UNAVAILABLE"
    case failed = "FAILED"
    case cancelled = "CANCELLED"
}

public enum AdvisoryRunOutcome: String, Codable, Sendable {
    case completed = "COMPLETED"
    case unavailable = "UNAVAILABLE"
    case failed = "FAILED"
    case cancelled = "CANCELLED"
}

public struct AdvisoryStageReceipt: Codable, Equatable, Sendable {
    public let ordinal: Int
    public let stage: AdvisoryReceiptStage
    public let outcome: AdvisoryReceiptStageOutcome
    public let requestDigest: String
    public let responseDigest: String?
    public let reasonCode: String?

    public init(
        ordinal: Int,
        stage: AdvisoryReceiptStage,
        outcome: AdvisoryReceiptStageOutcome,
        requestDigest: String,
        responseDigest: String? = nil,
        reasonCode: String? = nil
    ) {
        self.ordinal = ordinal
        self.stage = stage
        self.outcome = outcome
        self.requestDigest = requestDigest
        self.responseDigest = responseDigest
        self.reasonCode = reasonCode
    }

    private enum CodingKeys: String, CodingKey {
        case ordinal, stage, outcome, requestDigest, responseDigest, reasonCode
    }

    /// Writes every declared key, including an explicit null for each absent
    /// optional. R5 of the MAC1 canonical contract holds a null value and an
    /// absent key to be distinct; Swift's synthesized encoder omits a nil key,
    /// collapsing `{"k":null}` and `{}` into the same bytes and the same digest.
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(ordinal, forKey: .ordinal)
        try container.encode(stage, forKey: .stage)
        try container.encode(outcome, forKey: .outcome)
        try container.encode(requestDigest, forKey: .requestDigest)
        try container.encode(responseDigest, forKey: .responseDigest)
        try container.encode(reasonCode, forKey: .reasonCode)
    }
}

public struct AdvisoryRunReceipt: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let subjectDigest: String
    public let artifactKind: ArtifactKind
    public let profileFingerprint: String
    public let provider: String
    public let route: String
    public let adapterContractVersion: String
    public let modelIdentityStatus: String
    public let runtimeFingerprint: String
    public let nonAuthorizing: Bool
    public let outcome: AdvisoryRunOutcome
    public let reasonCode: String?
    public let stages: [AdvisoryStageReceipt]

    public init(
        schemaVersion: Int = 1,
        subjectDigest: String,
        artifactKind: ArtifactKind,
        profileFingerprint: String,
        provider: String,
        route: String,
        adapterContractVersion: String,
        modelIdentityStatus: String,
        runtimeFingerprint: String,
        nonAuthorizing: Bool = true,
        outcome: AdvisoryRunOutcome,
        reasonCode: String? = nil,
        stages: [AdvisoryStageReceipt]
    ) {
        self.schemaVersion = schemaVersion
        self.subjectDigest = subjectDigest
        self.artifactKind = artifactKind
        self.profileFingerprint = profileFingerprint
        self.provider = provider
        self.route = route
        self.adapterContractVersion = adapterContractVersion
        self.modelIdentityStatus = modelIdentityStatus
        self.runtimeFingerprint = runtimeFingerprint
        self.nonAuthorizing = nonAuthorizing
        self.outcome = outcome
        self.reasonCode = reasonCode
        self.stages = stages
    }

    public var receiptDigest: String? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(self) else { return nil }
        return ArtifactSnapshot.digest(data)
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, subjectDigest, artifactKind, profileFingerprint, provider, route, adapterContractVersion, modelIdentityStatus, runtimeFingerprint, nonAuthorizing, outcome, reasonCode, stages
    }

    /// Writes every declared key, including an explicit null for each absent
    /// optional. R5 of the MAC1 canonical contract holds a null value and an
    /// absent key to be distinct; Swift's synthesized encoder omits a nil key,
    /// collapsing `{"k":null}` and `{}` into the same bytes and the same digest.
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(subjectDigest, forKey: .subjectDigest)
        try container.encode(artifactKind, forKey: .artifactKind)
        try container.encode(profileFingerprint, forKey: .profileFingerprint)
        try container.encode(provider, forKey: .provider)
        try container.encode(route, forKey: .route)
        try container.encode(adapterContractVersion, forKey: .adapterContractVersion)
        try container.encode(modelIdentityStatus, forKey: .modelIdentityStatus)
        try container.encode(runtimeFingerprint, forKey: .runtimeFingerprint)
        try container.encode(nonAuthorizing, forKey: .nonAuthorizing)
        try container.encode(outcome, forKey: .outcome)
        try container.encode(reasonCode, forKey: .reasonCode)
        try container.encode(stages, forKey: .stages)
    }
}

public protocol AdvisoryOrchestrator: Sendable {
    func probe() async -> AnalyzerProbe
    func proposePlan(for request: OrchestrationRequest) async throws -> AdvisoryPlan
    func analyze(_ request: DimensionAnalysisRequest) async throws -> AdvisoryFinding
    func isQuiescent() async -> Bool
}

public enum AdvisoryOrchestrationError: Error, Equatable, LocalizedError {
    case unavailable(String)
    case invalidPlan(String)
    case invalidFinding(String)
    case timeout

    public var errorDescription: String? {
        switch self {
        case let .unavailable(code): "Analyzer unavailable: \(code)."
        case let .invalidPlan(code): "Analyzer plan rejected: \(code)."
        case let .invalidFinding(code): "Analyzer finding rejected: \(code)."
        case .timeout: "Analyzer exceeded its local time budget."
        }
    }
}

public actor DeterministicOnlyOrchestrator: AdvisoryOrchestrator {
    private let reasonCode: String

    public init(reasonCode: String = "OPTIONAL_ANALYZER_UNAVAILABLE") {
        self.reasonCode = reasonCode
    }

    public func probe() async -> AnalyzerProbe {
        AnalyzerProbe(
            state: .degraded,
            provider: "none",
            route: "deterministic-only",
            reasonCode: reasonCode,
            adapterContractVersion: "deterministic-only-v1",
            modelIdentityStatus: "NO_MODEL",
            runtimeFingerprint: ArtifactSnapshot.digest(
                Data("deterministic-only-v1|\(reasonCode)".utf8)
            )
        )
    }

    public func proposePlan(for request: OrchestrationRequest) async throws -> AdvisoryPlan {
        throw AdvisoryOrchestrationError.unavailable(reasonCode)
    }

    public func analyze(_ request: DimensionAnalysisRequest) async throws -> AdvisoryFinding {
        throw AdvisoryOrchestrationError.unavailable(reasonCode)
    }

    public func isQuiescent() async -> Bool {
        true
    }
}
