import Foundation

public enum VeritasMode: String, Codable, CaseIterable, Sendable {
    case off = "OFF"
    case assist = "ASSIST"
    case enforce = "ENFORCE"
}

public enum PipelineDisposition: String, Codable, Sendable {
    case off = "OFF"
    case ready = "READY"
    case needsAttention = "NEEDS_ATTENTION"
    case degraded = "DEGRADED"
    case blocked = "BLOCKED"
}

public enum ModelParticipation: String, Codable, Sendable {
    case notRun = "NOT_RUN"
    case participated = "PARTICIPATED"
    case unavailable = "UNAVAILABLE"
    case failed = "FAILED"
}

public struct AdvisoryCoverage: Codable, Equatable, Sendable {
    public let artifactCharacters: Int
    public let analyzedCharacters: Int

    public var complete: Bool { analyzedCharacters == artifactCharacters }

    init(artifactCharacters: Int, analyzedCharacters: Int) {
        self.artifactCharacters = artifactCharacters
        self.analyzedCharacters = analyzedCharacters
    }
}

public struct PipelineResult: Equatable, Sendable {
    public let subjectDigest: String
    public let artifactKind: ArtifactKind
    public let profileID: String
    public let profileFingerprint: String
    public let mode: VeritasMode
    public let disposition: PipelineDisposition
    public let deterministicChecks: [CheckOutcome]
    public let deterministicPassed: Bool
    public let modelParticipation: ModelParticipation
    public let analyzerProbe: AnalyzerProbe?
    public let advisoryReceipt: AdvisoryRunReceipt?
    public let advisoryCoverage: AdvisoryCoverage?
    public let advisoryPlan: [AdvisoryDimension]
    public let findings: [AdvisoryFinding]
    public let canAcceptInsideVeritas: Bool
    public let limitationCodes: [String]

    init(
        subjectDigest: String,
        artifactKind: ArtifactKind,
        profileID: String,
        profileFingerprint: String,
        mode: VeritasMode,
        disposition: PipelineDisposition,
        deterministicChecks: [CheckOutcome],
        deterministicPassed: Bool,
        modelParticipation: ModelParticipation,
        analyzerProbe: AnalyzerProbe?,
        advisoryReceipt: AdvisoryRunReceipt? = nil,
        advisoryCoverage: AdvisoryCoverage?,
        advisoryPlan: [AdvisoryDimension],
        findings: [AdvisoryFinding],
        canAcceptInsideVeritas: Bool,
        limitationCodes: [String]
    ) {
        self.subjectDigest = subjectDigest
        self.artifactKind = artifactKind
        self.profileID = profileID
        self.profileFingerprint = profileFingerprint
        self.mode = mode
        self.disposition = disposition
        self.deterministicChecks = deterministicChecks
        self.deterministicPassed = deterministicPassed
        self.modelParticipation = modelParticipation
        self.analyzerProbe = analyzerProbe
        self.advisoryReceipt = advisoryReceipt
        self.advisoryCoverage = advisoryCoverage
        self.advisoryPlan = advisoryPlan
        self.findings = findings
        self.canAcceptInsideVeritas = canAcceptInsideVeritas
        self.limitationCodes = limitationCodes
    }

    /// Canonical bytes of the exact result envelope. These bytes are useful for
    /// replay and baseline-invariance checks; they are not a certificate and do
    /// not mean the result passed or was accepted.
    var resultEvidenceData: Data? {
        guard advisoryReceiptIsConsistent else { return nil }
        let envelope = AcceptanceEvidenceEnvelope(result: self)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try? encoder.encode(envelope)
    }

    /// Canonical digest of the exact result envelope. This binds evidence; it does
    /// not mean the result passed or was accepted.
    public var resultEvidenceDigest: String? {
        resultEvidenceData.map(ArtifactSnapshot.digest)
    }

    /// Compatibility alias only. A non-nil digest never means accepted; callers
    /// must still pass the independent acceptance predicates.
    @available(*, deprecated, message: "Use resultEvidenceDigest; acceptance is a separate gate.")
    public var acceptanceEvidenceDigest: String? {
        resultEvidenceDigest
    }

    public var advisoryReceiptDigest: String? {
        advisoryReceipt?.receiptDigest
    }

    private var advisoryReceiptIsConsistent: Bool {
        if modelParticipation != .participated {
            return advisoryReceipt == nil
        }
        guard let receipt = advisoryReceipt,
              let probe = analyzerProbe,
              probe.state == .ready,
              receipt.schemaVersion == 1,
              receipt.subjectDigest == subjectDigest,
              receipt.artifactKind == artifactKind,
              receipt.profileFingerprint == profileFingerprint,
              receipt.provider == probe.provider,
              receipt.route == probe.route,
              receipt.adapterContractVersion == probe.adapterContractVersion,
              receipt.modelIdentityStatus == probe.modelIdentityStatus,
              receipt.nonAuthorizing,
              receipt.outcome == .completed,
              receipt.reasonCode == nil,
              isSHA256(receipt.runtimeFingerprint),
              receipt.receiptDigest.map(isSHA256) == true,
              receipt.stages.count == findings.count + 2,
              receipt.stages.first?.stage == .probe,
              receipt.stages.dropFirst().first?.stage == .plan,
              receipt.stages.dropFirst(2).allSatisfy({ $0.stage == .finding }) else {
            return false
        }
        return receipt.stages.enumerated().allSatisfy { index, stage in
            stage.ordinal == index
                && stage.outcome == .observed
                && stage.reasonCode == nil
                && isSHA256(stage.requestDigest)
                && stage.responseDigest.map(isSHA256) == true
        }
    }
}

private func isSHA256(_ value: String) -> Bool {
    value.utf8.count == 64 && value.utf8.allSatisfy { byte in
        (0x30...0x39).contains(byte) || (0x61...0x66).contains(byte)
    }
}

private struct AcceptanceEvidenceEnvelope: Encodable {
    let subjectDigest: String
    let artifactKind: ArtifactKind
    let profileID: String
    let profileFingerprint: String
    let mode: VeritasMode
    let disposition: PipelineDisposition
    let deterministicChecks: [CheckOutcome]
    let deterministicPassed: Bool
    let modelParticipation: ModelParticipation
    let analyzerProbe: AnalyzerProbe?
    let advisoryReceipt: AdvisoryRunReceipt?
    let advisoryCoverage: AdvisoryCoverage?
    let advisoryPlan: [AdvisoryDimension]
    let findings: [AdvisoryFinding]
    let canAcceptInsideVeritas: Bool
    let limitationCodes: [String]

    init(result: PipelineResult) {
        subjectDigest = result.subjectDigest
        artifactKind = result.artifactKind
        profileID = result.profileID
        profileFingerprint = result.profileFingerprint
        mode = result.mode
        disposition = result.disposition
        deterministicChecks = result.deterministicChecks
        deterministicPassed = result.deterministicPassed
        modelParticipation = result.modelParticipation
        analyzerProbe = result.analyzerProbe
        advisoryReceipt = result.advisoryReceipt
        advisoryCoverage = result.advisoryCoverage
        advisoryPlan = result.advisoryPlan
        findings = result.findings
        canAcceptInsideVeritas = result.canAcceptInsideVeritas
        limitationCodes = result.limitationCodes
    }

    private enum CodingKeys: String, CodingKey {
        case subjectDigest, artifactKind, profileID, profileFingerprint, mode, disposition, deterministicChecks, deterministicPassed, modelParticipation, analyzerProbe, advisoryReceipt, advisoryCoverage, advisoryPlan, findings, canAcceptInsideVeritas, limitationCodes
    }

    /// Writes every declared key, including an explicit null for each absent
    /// optional. R5 of the MAC1 canonical contract holds a null value and an
    /// absent key to be distinct; Swift's synthesized encoder omits a nil key,
    /// collapsing `{"k":null}` and `{}` into the same bytes and the same digest.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(subjectDigest, forKey: .subjectDigest)
        try container.encode(artifactKind, forKey: .artifactKind)
        try container.encode(profileID, forKey: .profileID)
        try container.encode(profileFingerprint, forKey: .profileFingerprint)
        try container.encode(mode, forKey: .mode)
        try container.encode(disposition, forKey: .disposition)
        try container.encode(deterministicChecks, forKey: .deterministicChecks)
        try container.encode(deterministicPassed, forKey: .deterministicPassed)
        try container.encode(modelParticipation, forKey: .modelParticipation)
        try container.encode(analyzerProbe, forKey: .analyzerProbe)
        try container.encode(advisoryReceipt, forKey: .advisoryReceipt)
        try container.encode(advisoryCoverage, forKey: .advisoryCoverage)
        try container.encode(advisoryPlan, forKey: .advisoryPlan)
        try container.encode(findings, forKey: .findings)
        try container.encode(canAcceptInsideVeritas, forKey: .canAcceptInsideVeritas)
        try container.encode(limitationCodes, forKey: .limitationCodes)
    }
}

private struct AdvisoryProbeReceiptRequest: Encodable {
    let subjectDigest: String
    let artifactKind: ArtifactKind
    let profileFingerprint: String
}

private struct AdvisoryRuntimeFallback: Encodable {
    let provider: String
    let route: String
    let adapterContractVersion: String
    let modelIdentityStatus: String
    let contextSize: Int?
}

private func encodedDigest<T: Encodable>(_ value: T) -> String? {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    guard let data = try? encoder.encode(value) else { return nil }
    return ArtifactSnapshot.digest(data)
}

public actor VeritasPipeline {
    private let gateRunner: DeterministicGateRunner
    private let analyzer: any AdvisoryOrchestrator

    public init(
        gateRunner: DeterministicGateRunner = DeterministicGateRunner(),
        analyzer: any AdvisoryOrchestrator
    ) {
        self.gateRunner = gateRunner
        self.analyzer = analyzer
    }

    public func analyze(
        snapshot: ArtifactSnapshot,
        profile: CheckProfile,
        mode: VeritasMode
    ) async -> PipelineResult {
        guard mode != .off else {
            return PipelineResult(
                subjectDigest: snapshot.subjectDigest,
                artifactKind: snapshot.kind,
                profileID: profile.id,
                profileFingerprint: profile.rulesFingerprint,
                mode: mode,
                disposition: .off,
                deterministicChecks: [],
                deterministicPassed: false,
                modelParticipation: .notRun,
                analyzerProbe: nil,
                advisoryCoverage: nil,
                advisoryPlan: [],
                findings: [],
                canAcceptInsideVeritas: false,
                limitationCodes: ["MODE_OFF_NO_ANALYSIS"]
            )
        }


        guard mode != .enforce else {
            return PipelineResult(
                subjectDigest: snapshot.subjectDigest,
                artifactKind: snapshot.kind,
                profileID: profile.id,
                profileFingerprint: profile.rulesFingerprint,
                mode: mode,
                disposition: .blocked,
                deterministicChecks: [],
                deterministicPassed: false,
                modelParticipation: .notRun,
                analyzerProbe: nil,
                advisoryCoverage: nil,
                advisoryPlan: [],
                findings: [],
                canAcceptInsideVeritas: false,
                limitationCodes: [
                    "ENFORCE_ROUTE_NOT_IMPLEMENTED",
                    "NO_EXTERNAL_ACTION_WITHHELD",
                ]
            )
        }

        guard !Task.isCancelled else {
            return cancelledResult(snapshot: snapshot, profile: profile, mode: mode)
        }

        let checks = gateRunner.run(snapshot: snapshot, profile: profile)
        let deterministicPassed = checks.allSatisfy { $0.status == .pass }
        guard deterministicPassed else {
            return PipelineResult(
                subjectDigest: snapshot.subjectDigest,
                artifactKind: snapshot.kind,
                profileID: profile.id,
                profileFingerprint: profile.rulesFingerprint,
                mode: mode,
                disposition: .needsAttention,
                deterministicChecks: checks,
                deterministicPassed: false,
                modelParticipation: .notRun,
                analyzerProbe: nil,
                advisoryCoverage: nil,
                advisoryPlan: [],
                findings: [],
                canAcceptInsideVeritas: false,
                limitationCodes: ["DETERMINISTIC_GATE_FAILED_MODEL_SKIPPED"]
            )
        }

        guard !Task.isCancelled else {
            return cancelledResult(
                snapshot: snapshot,
                profile: profile,
                mode: mode,
                checks: checks
            )
        }

        let probe = await analyzer.probe()
        guard !Task.isCancelled else {
            return cancelledResult(
                snapshot: snapshot,
                profile: profile,
                mode: mode,
                checks: checks,
                probe: probe
            )
        }
        guard probe.state == .ready else {
            return degradedResult(
                snapshot: snapshot,
                profile: profile,
                checks: checks,
                probe: probe,
                mode: mode,
                modelParticipation: .unavailable,
                code: probe.reasonCode ?? "ANALYZER_PROBE_NOT_READY"
            )
        }
        if let runtimeFingerprint = probe.runtimeFingerprint,
           !isSHA256(runtimeFingerprint) {
            return PipelineResult(
                subjectDigest: snapshot.subjectDigest,
                artifactKind: snapshot.kind,
                profileID: profile.id,
                profileFingerprint: profile.rulesFingerprint,
                mode: mode,
                disposition: .blocked,
                deterministicChecks: checks,
                deterministicPassed: true,
                modelParticipation: .failed,
                analyzerProbe: probe,
                advisoryCoverage: nil,
                advisoryPlan: [],
                findings: [],
                canAcceptInsideVeritas: false,
                limitationCodes: [
                    "ANALYZER_RUNTIME_FINGERPRINT_INVALID",
                    "MODEL_PROVENANCE_INVALID",
                    "DETERMINISTIC_RESULT_PRESERVED",
                ]
            )
        }

        let artifactText = snapshot.text ?? ""
        let excerpt = String(artifactText.prefix(8_000))
        let coverage = AdvisoryCoverage(
            artifactCharacters: artifactText.count,
            analyzedCharacters: excerpt.count
        )
        let request = OrchestrationRequest(
            subjectDigest: snapshot.subjectDigest,
            artifactKind: snapshot.kind,
            excerpt: excerpt,
            permittedDimensionNames: profile.allowedAdvisoryDimensions.map(\.rawValue).sorted(),
            minimumDimensions: profile.modelParticipationRequired ? 1 : 0,
            maximumDimensions: profile.maximumAdvisoryDimensions
        )

        do {
            let probeRequest = AdvisoryProbeReceiptRequest(
                subjectDigest: snapshot.subjectDigest,
                artifactKind: snapshot.kind,
                profileFingerprint: profile.rulesFingerprint
            )
            guard let probeRequestDigest = encodedDigest(probeRequest),
                  let probeResponseDigest = encodedDigest(probe) else {
                throw AdvisoryOrchestrationError.invalidPlan("RECEIPT_ENCODING_FAILED")
            }
            var stageReceipts = [AdvisoryStageReceipt(
                ordinal: 0,
                stage: .probe,
                outcome: .observed,
                requestDigest: probeRequestDigest,
                responseDigest: probeResponseDigest
            )]

            let rawPlan = try await analyzer.proposePlan(for: request)
            guard !Task.isCancelled else {
                return cancelledResult(
                    snapshot: snapshot,
                    profile: profile,
                    mode: mode,
                    checks: checks,
                    probe: probe,
                    coverage: coverage
                )
            }
            let dimensions = try validate(plan: rawPlan, request: request, profile: profile)
            guard let planRequestDigest = encodedDigest(request),
                  let planResponseDigest = encodedDigest(rawPlan) else {
                throw AdvisoryOrchestrationError.invalidPlan("RECEIPT_ENCODING_FAILED")
            }
            stageReceipts.append(AdvisoryStageReceipt(
                ordinal: stageReceipts.count,
                stage: .plan,
                outcome: .observed,
                requestDigest: planRequestDigest,
                responseDigest: planResponseDigest
            ))
            var findings = [AdvisoryFinding]()
            for dimension in dimensions {
                guard !Task.isCancelled else {
                    return cancelledResult(
                        snapshot: snapshot,
                        profile: profile,
                        mode: mode,
                        checks: checks,
                        probe: probe,
                        coverage: coverage
                    )
                }
                let findingRequest = DimensionAnalysisRequest(
                    subjectDigest: snapshot.subjectDigest,
                    dimension: dimension,
                    excerpt: excerpt
                )
                let rawFinding = try await analyzer.analyze(findingRequest)
                guard !Task.isCancelled else {
                    return cancelledResult(
                        snapshot: snapshot,
                        profile: profile,
                        mode: mode,
                        checks: checks,
                        probe: probe,
                        coverage: coverage
                    )
                }
                let finding = try validate(
                    finding: rawFinding,
                    subjectDigest: snapshot.subjectDigest,
                    dimension: dimension
                )
                guard let findingRequestDigest = encodedDigest(findingRequest),
                      let findingResponseDigest = encodedDigest(finding) else {
                    throw AdvisoryOrchestrationError.invalidFinding("RECEIPT_ENCODING_FAILED")
                }
                stageReceipts.append(AdvisoryStageReceipt(
                    ordinal: stageReceipts.count,
                    stage: .finding,
                    outcome: .observed,
                    requestDigest: findingRequestDigest,
                    responseDigest: findingResponseDigest
                ))
                findings.append(finding)
            }

            let incompleteRequiredAnalysis = profile.modelParticipationRequired && !coverage.complete
            let runtimeFingerprint = probe.runtimeFingerprint
                ?? encodedDigest(AdvisoryRuntimeFallback(
                    provider: probe.provider,
                    route: probe.route,
                    adapterContractVersion: probe.adapterContractVersion,
                    modelIdentityStatus: probe.modelIdentityStatus,
                    contextSize: probe.contextSize
                ))
            guard let runtimeFingerprint else {
                throw AdvisoryOrchestrationError.invalidPlan("RECEIPT_ENCODING_FAILED")
            }
            let advisoryReceipt = AdvisoryRunReceipt(
                subjectDigest: snapshot.subjectDigest,
                artifactKind: snapshot.kind,
                profileFingerprint: profile.rulesFingerprint,
                provider: probe.provider,
                route: probe.route,
                adapterContractVersion: probe.adapterContractVersion,
                modelIdentityStatus: probe.modelIdentityStatus,
                runtimeFingerprint: runtimeFingerprint,
                outcome: .completed,
                stages: stageReceipts
            )
            return PipelineResult(
                subjectDigest: snapshot.subjectDigest,
                artifactKind: snapshot.kind,
                profileID: profile.id,
                profileFingerprint: profile.rulesFingerprint,
                mode: mode,
                disposition: incompleteRequiredAnalysis ? .blocked : (coverage.complete ? .ready : .degraded),
                deterministicChecks: checks,
                deterministicPassed: true,
                modelParticipation: .participated,
                analyzerProbe: probe,
                advisoryReceipt: advisoryReceipt,
                advisoryCoverage: coverage,
                advisoryPlan: dimensions,
                findings: findings,
                canAcceptInsideVeritas: !incompleteRequiredAnalysis,
                limitationCodes: [
                    "MODEL_FINDINGS_NON_AUTHORIZING",
                    "PROTOTYPE_IN_MEMORY_ACCEPTANCE_ONLY",
                ] + (coverage.complete ? [] : [
                    "PARTIAL_ADVISORY_COVERAGE",
                    incompleteRequiredAnalysis
                        ? "REQUIRED_MODEL_COVERAGE_INCOMPLETE"
                        : "OPTIONAL_MODEL_COVERAGE_INCOMPLETE",
                ])
            )
        } catch {
            if Task.isCancelled {
                return cancelledResult(
                    snapshot: snapshot,
                    profile: profile,
                    mode: mode,
                    checks: checks,
                    probe: probe,
                    coverage: coverage
                )
            }
            return degradedResult(
                snapshot: snapshot,
                profile: profile,
                checks: checks,
                probe: probe,
                mode: mode,
                coverage: coverage,
                modelParticipation: .failed,
                code: normalizedErrorCode(error)
            )
        }
    }

    private func cancelledResult(
        snapshot: ArtifactSnapshot,
        profile: CheckProfile,
        mode: VeritasMode,
        checks: [CheckOutcome] = [],
        probe: AnalyzerProbe? = nil,
        coverage: AdvisoryCoverage? = nil
    ) -> PipelineResult {
        PipelineResult(
            subjectDigest: snapshot.subjectDigest,
            artifactKind: snapshot.kind,
            profileID: profile.id,
            profileFingerprint: profile.rulesFingerprint,
            mode: mode,
            disposition: .blocked,
            deterministicChecks: checks,
            deterministicPassed: !checks.isEmpty && checks.allSatisfy { $0.status == .pass },
            modelParticipation: .notRun,
            analyzerProbe: probe,
            advisoryCoverage: coverage,
            advisoryPlan: [],
            findings: [],
            canAcceptInsideVeritas: false,
            limitationCodes: ["ANALYSIS_CANCELLED_NO_ACCEPTANCE"]
        )
    }

    private func degradedResult(
        snapshot: ArtifactSnapshot,
        profile: CheckProfile,
        checks: [CheckOutcome],
        probe: AnalyzerProbe,
        mode: VeritasMode,
        coverage: AdvisoryCoverage? = nil,
        modelParticipation: ModelParticipation,
        code: String
    ) -> PipelineResult {
        let required = profile.modelParticipationRequired
        return PipelineResult(
            subjectDigest: snapshot.subjectDigest,
            artifactKind: snapshot.kind,
            profileID: profile.id,
            profileFingerprint: profile.rulesFingerprint,
            mode: mode,
            disposition: required ? .blocked : .degraded,
            deterministicChecks: checks,
            deterministicPassed: true,
            modelParticipation: modelParticipation,
            analyzerProbe: probe,
            advisoryCoverage: coverage,
            advisoryPlan: [],
            findings: [],
            canAcceptInsideVeritas: !required,
            limitationCodes: [
                code,
                required ? "REQUIRED_MODEL_EVIDENCE_MISSING" : "OPTIONAL_MODEL_EVIDENCE_MISSING",
                "DETERMINISTIC_RESULT_PRESERVED",
            ]
        )
    }

    private func validate(
        plan: AdvisoryPlan,
        request: OrchestrationRequest,
        profile: CheckProfile
    ) throws -> [AdvisoryDimension] {
        guard plan.nonAuthorizing else {
            throw AdvisoryOrchestrationError.invalidPlan("PLAN_ATTEMPTED_AUTHORITY")
        }
        guard plan.subjectDigest == request.subjectDigest else {
            throw AdvisoryOrchestrationError.invalidPlan("PLAN_SUBJECT_MISMATCH")
        }
        guard plan.proposedDimensionNames.count <= request.maximumDimensions else {
            throw AdvisoryOrchestrationError.invalidPlan("PLAN_DIMENSION_LIMIT")
        }
        let normalizedRationale = plan.rationale.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedRationale.isEmpty,
              plan.rationale.utf8.count <= 512,
              normalizedRationale.utf8.count <= 512 else {
            throw AdvisoryOrchestrationError.invalidPlan("PLAN_RATIONALE_INVALID")
        }

        var dimensions = [AdvisoryDimension]()
        var seen = Set<AdvisoryDimension>()
        for name in plan.proposedDimensionNames {
            guard let dimension = AdvisoryDimension(rawValue: name) else {
                throw AdvisoryOrchestrationError.invalidPlan("PLAN_UNKNOWN_DIMENSION")
            }
            guard profile.allowedAdvisoryDimensions.contains(dimension) else {
                throw AdvisoryOrchestrationError.invalidPlan("PLAN_DISALLOWED_DIMENSION")
            }
            guard seen.insert(dimension).inserted else {
                throw AdvisoryOrchestrationError.invalidPlan("PLAN_DUPLICATE_DIMENSION")
            }
            dimensions.append(dimension)
        }
        if dimensions.count < request.minimumDimensions {
            throw AdvisoryOrchestrationError.invalidPlan("PLAN_REQUIRED_DIMENSION_MISSING")
        }
        return dimensions
    }

    private func validate(
        finding: AdvisoryFinding,
        subjectDigest: String,
        dimension: AdvisoryDimension
    ) throws -> AdvisoryFinding {
        guard finding.nonAuthorizing else {
            throw AdvisoryOrchestrationError.invalidFinding("FINDING_ATTEMPTED_AUTHORITY")
        }
        guard finding.subjectDigest == subjectDigest else {
            throw AdvisoryOrchestrationError.invalidFinding("FINDING_SUBJECT_MISMATCH")
        }
        guard finding.dimension == dimension else {
            throw AdvisoryOrchestrationError.invalidFinding("FINDING_DIMENSION_MISMATCH")
        }
        let normalizedID = finding.id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedID.isEmpty,
              finding.id.utf8.count <= 128,
              normalizedID.utf8.count <= 128 else {
            throw AdvisoryOrchestrationError.invalidFinding("FINDING_ID_INVALID")
        }
        let normalizedSummary = finding.summary.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedSummary.isEmpty,
              finding.summary.utf8.count <= 512,
              normalizedSummary.utf8.count <= 512 else {
            throw AdvisoryOrchestrationError.invalidFinding("FINDING_SUMMARY_INVALID")
        }
        return AdvisoryFinding(
            id: normalizedID,
            subjectDigest: finding.subjectDigest,
            dimension: finding.dimension,
            severity: finding.severity,
            summary: normalizedSummary,
            nonAuthorizing: finding.nonAuthorizing
        )
    }

    private func normalizedErrorCode(_ error: Error) -> String {
        if let orchestration = error as? AdvisoryOrchestrationError {
            switch orchestration {
            case let .unavailable(code): return code
            case let .invalidPlan(code): return code
            case let .invalidFinding(code): return code
            case .timeout: return "ANALYZER_TIMEOUT"
            }
        }
        return "ANALYZER_UNKNOWN_FAILURE"
    }

    public func analyzerIsQuiescent() async -> Bool {
        await analyzer.isQuiescent()
    }
}

public enum AcceptanceCurrentness: String, Equatable, Sendable {
    case none = "NOT_ACCEPTED"
    case current = "CURRENT"
    case stale = "STALE"
}

/// Canonical internal protocol record for a result that is explicitly not
/// certified. The only constructible status is `UNCERTIFIED`; this type cannot
/// mint acceptance, external certification, or Failure Intelligence authority.
package struct InternalUncertifiedRecordV1: Encodable, Equatable, Sendable {
    package let schemaVersion: Int
    package let recordType: String
    package let status: String
    package let subjectDigest: String
    package let resultEvidenceDigest: String
    package let disposition: String
    package let acceptanceCurrentness: String
    package let failureIntelligenceUsed: Bool
    package let authorizing: Bool
    package let independentCertification: Bool
    package let limitationCodes: [String]

    private init(
        subjectDigest: String,
        resultEvidenceDigest: String,
        disposition: String,
        acceptanceCurrentness: String
    ) {
        self.schemaVersion = 1
        self.recordType = "VERITAS_INTERNAL_UNCERTIFIED_RECORD_V1"
        self.status = "UNCERTIFIED"
        self.subjectDigest = subjectDigest
        self.resultEvidenceDigest = resultEvidenceDigest
        self.disposition = disposition
        self.acceptanceCurrentness = acceptanceCurrentness
        self.failureIntelligenceUsed = false
        self.authorizing = false
        self.independentCertification = false
        self.limitationCodes = [
            "FAILURE_INTELLIGENCE_NON_AUTHORIZING",
            "INTERNAL_PROTOCOL_RECORD_ONLY",
            "NOT_INDEPENDENT_CERTIFICATION",
        ]
    }

    package static func make(
        result: PipelineResult,
        currentness: AcceptanceCurrentness
    ) -> Self? {
        guard let resultEvidenceDigest = result.resultEvidenceDigest else { return nil }
        return Self(
            subjectDigest: result.subjectDigest,
            resultEvidenceDigest: resultEvidenceDigest,
            disposition: result.disposition.rawValue,
            acceptanceCurrentness: currentness.rawValue
        )
    }

    package var canonicalData: Data? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try? encoder.encode(self)
    }

    package var recordDigest: String? {
        canonicalData.map(ArtifactSnapshot.digest)
    }
}

public struct AcceptedVersion: Equatable, Sendable {
    public let subjectDigest: String
    public let artifactKind: ArtifactKind
    public let profileID: String
    public let profileFingerprint: String
    public let mode: VeritasMode
    public let evidenceDigest: String

    init(
        subjectDigest: String,
        artifactKind: ArtifactKind,
        profileID: String,
        profileFingerprint: String,
        mode: VeritasMode,
        evidenceDigest: String
    ) {
        self.subjectDigest = subjectDigest
        self.artifactKind = artifactKind
        self.profileID = profileID
        self.profileFingerprint = profileFingerprint
        self.mode = mode
        self.evidenceDigest = evidenceDigest
    }
}

public actor PrototypeAcceptanceLedger {
    private var accepted: AcceptedVersion?
    private var latestMutationSequence: UInt64 = 0

    public init() {}

    public func accept(
        snapshot: ArtifactSnapshot,
        profile: CheckProfile,
        mode: VeritasMode,
        mutationSequence: UInt64,
        result: PipelineResult
    ) throws -> AcceptedVersion {
        guard mutationSequence > latestMutationSequence else {
            throw AdvisoryOrchestrationError.invalidFinding("ACCEPT_MUTATION_SEQUENCE_STALE")
        }
        guard result.subjectDigest == snapshot.subjectDigest else {
            throw AdvisoryOrchestrationError.invalidFinding("ACCEPT_SUBJECT_MISMATCH")
        }
        guard result.artifactKind == snapshot.kind else {
            throw AdvisoryOrchestrationError.invalidFinding("ACCEPT_ARTIFACT_KIND_MISMATCH")
        }
        guard result.profileID == profile.id,
              result.profileFingerprint == profile.rulesFingerprint else {
            throw AdvisoryOrchestrationError.invalidFinding("ACCEPT_PROFILE_MISMATCH")
        }
        guard result.mode == mode, mode == .assist else {
            throw AdvisoryOrchestrationError.invalidFinding("ACCEPT_MODE_INVALID")
        }
        guard result.deterministicPassed,
              !result.deterministicChecks.isEmpty,
              result.deterministicChecks.allSatisfy({ $0.status == .pass }) else {
            throw AdvisoryOrchestrationError.invalidFinding("ACCEPT_DETERMINISTIC_EVIDENCE_INVALID")
        }
        guard result.disposition == .ready || result.disposition == .degraded else {
            throw AdvisoryOrchestrationError.invalidFinding("ACCEPT_DISPOSITION_INVALID")
        }
        guard result.canAcceptInsideVeritas else {
            throw AdvisoryOrchestrationError.invalidFinding("RESULT_NOT_ACCEPTABLE")
        }
        guard let evidenceDigest = result.resultEvidenceDigest else {
            throw AdvisoryOrchestrationError.invalidFinding("ACCEPT_EVIDENCE_DIGEST_UNAVAILABLE")
        }
        let version = AcceptedVersion(
            subjectDigest: snapshot.subjectDigest,
            artifactKind: snapshot.kind,
            profileID: result.profileID,
            profileFingerprint: result.profileFingerprint,
            mode: result.mode,
            evidenceDigest: evidenceDigest
        )
        latestMutationSequence = mutationSequence
        accepted = version
        return version
    }

    public func currentness(
        snapshot: ArtifactSnapshot,
        profile: CheckProfile,
        mode: VeritasMode,
        result: PipelineResult?
    ) -> AcceptanceCurrentness {
        guard let accepted else { return .none }
        guard let evidenceDigest = result?.resultEvidenceDigest else { return .stale }
        return accepted.subjectDigest == snapshot.subjectDigest
            && accepted.artifactKind == snapshot.kind
            && result?.artifactKind == snapshot.kind
            && accepted.profileID == profile.id
            && accepted.profileFingerprint == profile.rulesFingerprint
            && accepted.mode == mode
            && result?.mode == mode
            && accepted.evidenceDigest == evidenceDigest
            ? .current
            : .stale
    }

    @discardableResult
    public func clear(mutationSequence: UInt64) -> Bool {
        guard mutationSequence > latestMutationSequence else { return false }
        latestMutationSequence = mutationSequence
        accepted = nil
        return true
    }
}
