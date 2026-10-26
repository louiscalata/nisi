import Foundation

/// Caller-declared cohorts; not verified untouched holdouts or independent tasks.
public enum PreventionTrialSplitV1: String, Encodable, Sendable { case development, evaluation }
public enum PreventionTrialArmV1: String, Encodable, Sendable { case baseline, treatment }
public enum PreventionTrialOutcomeV1: String, Encodable, Sendable {
    case structuralPass = "STRUCTURAL_PASS", structuralFail = "STRUCTURAL_FAIL", unavailable = "UNAVAILABLE"
}
public enum PreventionPairOutcomeV1: String, Encodable, Sendable {
    case improved, regressed, unchangedPass, unchangedFail, unavailable
}
public enum PreventionTrialRefusalV1: String, Error, Equatable, Sendable {
    case alreadyRunning, invalidCohort, duplicateCase, invalidProfile, invalidGuidance
    case invalidAdapterLabel, candidateUnavailable, unsupportedCandidate
}

public struct PreventionTrialCaseV1: Sendable {
    public let id: String
    public let prompt: String
    public let split: PreventionTrialSplitV1
    public let profile: CheckProfile
    public init(id: String, prompt: String, split: PreventionTrialSplitV1, profile: CheckProfile) {
        self.id = id; self.prompt = prompt; self.split = split; self.profile = profile
    }
}

/// A separate call per arm. The scoring profile is not supplied to the adapter.
/// Adapter/session independence, provenance and egress must be reviewed by the host.
public struct PreventionDraftRequestV1: Sendable {
    public let runID: String
    public let caseID: String
    public let prompt: String
    public let arm: PreventionTrialArmV1
    public let guidance: String?
    fileprivate init(runID: String, item: PreventionTrialCaseV1, arm: PreventionTrialArmV1, guidance: String) {
        self.runID = runID; caseID = item.id; prompt = item.prompt; self.arm = arm
        self.guidance = arm == .treatment ? guidance : nil
    }
}
public protocol PreventionDraftAdapterV1: Sendable {
    /// Write complete Markdown to the bounded sink. Implementations own their
    /// transport allocations and must join any workers before returning/throwing.
    func draft(_ request: PreventionDraftRequestV1, sink: PreventionDraftSinkV1) async throws
}

/// Runner-owned output accumulation. This bounds retained bytes, not allocations
/// made inside an arbitrary adapter or global process memory. No public constructor.
public actor PreventionDraftSinkV1 {
    public enum Refusal: Error { case closed, byteLimit }
    private enum State { case open, overflow, sealed }
    private var state = State.open
    private var buffer = Data()
    private let captureID = UUID().uuidString
    fileprivate init() {}
    public func append(_ chunk: Data) throws {
        guard state == .open else { throw Refusal.closed }
        guard chunk.count <= PairedPreventionTrialV1.maximumOutputBytes - buffer.count else {
            state = .overflow; buffer = Data()
            throw Refusal.byteLimit
        }
        buffer.append(chunk)
    }
    fileprivate func finish(adapterFailed: Bool) -> (id: String, bytes: Data?, reason: String?) {
        let overflow = state == .overflow
        let complete = state == .open && !adapterFailed
        let captured = complete ? buffer : nil
        buffer = Data(); state = .sealed
        return (captureID, captured, overflow ? "OUTPUT_CAPTURE_LIMIT" : (complete ? nil : "ADAPTER_ERROR"))
    }
    fileprivate func discard() { buffer = Data(); state = .sealed }
}

public struct PreventionTrialArmObservationV1: Equatable, Encodable, Sendable {
    public let arm: PreventionTrialArmV1
    public let captureID: String
    public let outcome: PreventionTrialOutcomeV1
    public let reasonCode: String
    public let outputDigest: String?
    public let outputByteCount: Int?
    public var outputIdentity: String { outputDigest == nil ? "NO_COMPLETE_OUTPUT_HASH" : "COMPLETE_CAPTURE_HASHED" }
    fileprivate init(arm: PreventionTrialArmV1, captureID: String, outcome: PreventionTrialOutcomeV1,
                     reason: String, digest: String? = nil, count: Int? = nil) {
        self.arm = arm; self.captureID = captureID; self.outcome = outcome; reasonCode = reason
        outputDigest = digest; outputByteCount = count
    }
    fileprivate var fields: [String] {
        [arm.rawValue, captureID, outcome.rawValue, reasonCode, outputIdentity, outputDigest ?? "NONE", outputByteCount.map(String.init) ?? "NONE"]
    }
}
public struct PreventionTrialPairV1: Equatable, Encodable, Sendable {
    public let caseID: String
    public let caseDigest: String
    public let split: PreventionTrialSplitV1
    public let firstArm: PreventionTrialArmV1
    public let baseline: PreventionTrialArmObservationV1
    public let treatment: PreventionTrialArmObservationV1
    public var outcome: PreventionPairOutcomeV1 {
        switch (baseline.outcome, treatment.outcome) {
        case (.structuralFail, .structuralPass): .improved
        case (.structuralPass, .structuralFail): .regressed
        case (.structuralPass, .structuralPass): .unchangedPass
        case (.structuralFail, .structuralFail): .unchangedFail
        default: .unavailable
        }
    }
    fileprivate init(item: PreventionTrialCaseV1, digest: String, first: PreventionTrialArmV1,
                     baseline: PreventionTrialArmObservationV1, treatment: PreventionTrialArmObservationV1) {
        caseID = item.id; caseDigest = digest; split = item.split; firstArm = first
        self.baseline = baseline; self.treatment = treatment
    }
}
public struct PreventionTrialCountsV1: Equatable, Encodable, Sendable {
    public let total: Int
    public let improved: Int
    public let regressed: Int
    public let unchangedPass: Int
    public let unchangedFail: Int
    public let unavailable: Int
    fileprivate init(_ pairs: [PreventionTrialPairV1]) {
        total = pairs.count
        improved = pairs.filter { $0.outcome == .improved }.count
        regressed = pairs.filter { $0.outcome == .regressed }.count
        unchangedPass = pairs.filter { $0.outcome == .unchangedPass }.count
        unchangedFail = pairs.filter { $0.outcome == .unchangedFail }.count
        unavailable = pairs.filter { $0.outcome == .unavailable }.count
    }
}

/// Generated only after actual paired calls and deterministic grading. Not Decodable.
/// Candidate metadata remains NOT_RUN: this is a separate observed trial record.
public struct PairedPreventionTrialResultV1: Encodable, Sendable {
    public let runID: String
    public let candidateDefinitionDigest: String
    public let candidateRecordDigestAtAdmission: String
    public let guidanceDigest: String
    public let cohortDigest: String
    public let adapterLabel: String
    public let trialDefinitionDigest: String
    public let resultDigest: String
    public let pairs: [PreventionTrialPairV1]
    public let development: PreventionTrialCountsV1
    public let evaluation: PreventionTrialCountsV1
    public let total: PreventionTrialCountsV1
    public let schemaVersion = 1
    public let status = "PAIRED_DRAFT_CALLS_OBSERVED"
    public let scoringRule = "ALL_THREE_MARKDOWN_CHECKS_PASS_V1"
    public let authorizing = false
    public let limitationCodes = ["STRUCTURAL_MARKERS_NOT_CONTENT_QUALITY", "NO_CAUSAL_OR_STATISTICAL_CONCLUSION",
        "CALLER_DECLARED_SPLITS_NOT_UNTOUCHED_HOLDOUTS", "ADAPTER_LABEL_AND_SESSION_ISOLATION_UNVERIFIED",
        "ALTERNATING_ORDER_NOT_RANDOMIZED", "GUIDANCE_TRIAL_BOUND_NOT_POLICY_IMPLEMENTATION_VERIFIED",
        "CANDIDATE_CHECKS_NOT_ATOMIC_WITH_EXTERNAL_ADAPTER", "COOPERATIVE_CANCELLATION_NOT_WALL_TIME_BOUND",
        "SINK_BOUNDS_RETAINED_BYTES_NOT_ADAPTER_ALLOCATIONS", "REJECTED_OUTPUT_IDENTITY_NOT_OBSERVED",
        "NO_AUTOMATIC_LEARNING_OR_PROMOTION", "GUARDRAIL_RATE_LABELS_NOT_EVALUATED", "NO_RAW_DRAFTS_RETAINED"]

    fileprivate init(runID: String, candidate: PreventionCandidateV2, guidanceDigest: String,
                     cohortDigest: String, adapterLabel: String, pairs: [PreventionTrialPairV1]) {
        self.runID = runID; candidateDefinitionDigest = candidate.definitionDigest
        candidateRecordDigestAtAdmission = candidate.recordDigest; self.guidanceDigest = guidanceDigest
        self.cohortDigest = cohortDigest; self.adapterLabel = adapterLabel; self.pairs = pairs
        development = .init(pairs.filter { $0.split == .development })
        evaluation = .init(pairs.filter { $0.split == .evaluation }); total = .init(pairs)
        trialDefinitionDigest = VeritasDigestFrameV1.digest(domain: "veritas-paired-drafting-definition-v1",
            fields: [candidate.definitionDigest, candidate.recordDigest, guidanceDigest, cohortDigest, adapterLabel,
                     "ALL_THREE_MARKDOWN_CHECKS_PASS_V1", "ALTERNATING_AB_BA_V1"])
        resultDigest = VeritasDigestFrameV1.digest(domain: "veritas-paired-drafting-result-v1",
            fields: [runID, trialDefinitionDigest, String(pairs.count)] + pairs.flatMap {
                [$0.caseID, $0.caseDigest, $0.split.rawValue, $0.firstArm.rawValue]
                    + $0.baseline.fields + $0.treatment.fields + [$0.outcome.rawValue]
            })
    }
}

/// Sequential explicit-use execution seam, not a global scheduler or model router.
/// No detached tasks, timeouts, retries, storage, promotions or default backend.
public actor PairedPreventionTrialV1 {
    public static let maximumCases = 16
    public static let maximumPromptBytes = 16_384
    public static let maximumGuidanceBytes = 4_096
    public static let maximumOutputBytes = 65_536
    private var running = false
    public init() {}

    public func run(registry: PreventionCandidateRegistryV2, candidate: PreventionCandidateV2,
                    guidance: String, cases: [PreventionTrialCaseV1], adapterLabel: String,
                    adapter: any PreventionDraftAdapterV1) async throws -> PairedPreventionTrialResultV1 {
        guard !running else { throw PreventionTrialRefusalV1.alreadyRunning }
        try Task.checkCancellation()
        guard candidate.controlType == "prompt-guidance" else { throw PreventionTrialRefusalV1.unsupportedCandidate }
        guard Self.validText(guidance, maximum: Self.maximumGuidanceBytes) else { throw PreventionTrialRefusalV1.invalidGuidance }
        guard Self.validID(adapterLabel) else { throw PreventionTrialRefusalV1.invalidAdapterLabel }
        guard (2...Self.maximumCases).contains(cases.count), cases.contains(where: { $0.split == .development }),
              cases.contains(where: { $0.split == .evaluation }) else { throw PreventionTrialRefusalV1.invalidCohort }
        var ids = Set<String>(), prompts = Set<String>(), caseDigests: [String] = []
        for item in cases {
            guard Self.validID(item.id), Self.validText(item.prompt, maximum: Self.maximumPromptBytes) else {
                throw PreventionTrialRefusalV1.invalidCohort
            }
            // Exact input identity retains original spelling; canonical equivalence
            // and surrounding whitespace cannot evade duplicate-prompt rejection.
            let normalized = item.prompt.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping
            guard ids.insert(item.id).inserted, prompts.insert(normalized).inserted else { throw PreventionTrialRefusalV1.duplicateCase }
            guard item.profile.resourceLimitsAdmitted, !item.profile.requiredSections.isEmpty,
                  !item.profile.modelParticipationRequired else { throw PreventionTrialRefusalV1.invalidProfile }
            caseDigests.append(VeritasDigestFrameV1.digest(domain: "veritas-paired-drafting-case-v1",
                fields: [item.id, ArtifactSnapshot.digest(Data(item.prompt.utf8)), item.split.rawValue,
                         ArtifactKind.markdown.rawValue, item.profile.rulesFingerprint]))
        }
        // Order is part of the protocol, not sorted away: it determines AB/BA.
        let cohort = VeritasDigestFrameV1.digest(domain: "veritas-paired-drafting-cohort-v1",
            fields: [String(cases.count)] + caseDigests)
        running = true
        defer { running = false } // Never clear while an awaited adapter still owns work.
        try await requireCurrent(registry, candidate)
        let runID = UUID().uuidString
        var pairs: [PreventionTrialPairV1] = []
        for (index, item) in cases.enumerated() {
            let order: [PreventionTrialArmV1] = index.isMultiple(of: 2) ? [.baseline, .treatment] : [.treatment, .baseline]
            var observations: [PreventionTrialArmObservationV1] = []
            for arm in order {
                try await requireCurrent(registry, candidate)
                let request = PreventionDraftRequestV1(runID: runID, item: item, arm: arm, guidance: guidance)
                let sink = PreventionDraftSinkV1()
                var adapterFailed = false
                do {
                    try await adapter.draft(request, sink: sink)
                    try Task.checkCancellation()
                } catch is CancellationError { await sink.discard(); throw CancellationError() }
                catch {
                    if Task.isCancelled { await sink.discard(); throw CancellationError() }
                    // Do not retain model output or transport-error text in metadata.
                    adapterFailed = true
                }
                let capture = await sink.finish(adapterFailed: adapterFailed)
                let observation = capture.bytes.map { Self.grade($0, arm: arm, captureID: capture.id, profile: item.profile) }
                    ?? .init(arm: arm, captureID: capture.id, outcome: .unavailable, reason: capture.reason ?? "CAPTURE_UNAVAILABLE")
                try await requireCurrent(registry, candidate)
                observations.append(observation)
            }
            let baseline = observations.first { $0.arm == .baseline }!
            let treatment = observations.first { $0.arm == .treatment }!
            pairs.append(.init(item: item, digest: caseDigests[index], first: order[0], baseline: baseline, treatment: treatment))
        }
        try await requireCurrent(registry, candidate)
        return .init(runID: runID, candidate: candidate, guidanceDigest: ArtifactSnapshot.digest(Data(guidance.utf8)),
                     cohortDigest: cohort, adapterLabel: adapterLabel, pairs: pairs)
    }

    private func requireCurrent(_ registry: PreventionCandidateRegistryV2, _ candidate: PreventionCandidateV2) async throws {
        try Task.checkCancellation()
        guard let live = await registry.candidate(policyID: candidate.policyID),
              live == candidate, live.status == .candidate else { throw PreventionTrialRefusalV1.candidateUnavailable }
        try Task.checkCancellation()
    }
    private static func grade(_ bytes: Data, arm: PreventionTrialArmV1, captureID: String, profile: CheckProfile) -> PreventionTrialArmObservationV1 {
        guard bytes.count <= maximumOutputBytes else {
            return .init(arm: arm, captureID: captureID, outcome: .unavailable, reason: "OUTPUT_CAPTURE_LIMIT")
        }
        let digest = ArtifactSnapshot.digest(bytes)
        guard !bytes.isEmpty, String(data: bytes, encoding: .utf8) != nil else {
            return .init(arm: arm, captureID: captureID, outcome: .unavailable, reason: "MISSING_OR_UNSUPPORTED_OUTPUT", digest: digest, count: bytes.count)
        }
        let checks = DeterministicGateRunner().run(snapshot: .init(displayName: "trial.md", kind: .markdown, bytes: bytes), profile: profile)
        guard checks.map(\.id) == ["DET-001-NONEMPTY", "DET-002-UTF8", "DET-003-REQUIRED-SECTIONS"],
              checks.allSatisfy({ $0.status == .pass || $0.status == .fail }) else {
            return .init(arm: arm, captureID: captureID, outcome: .unavailable, reason: "UNEXPECTED_CHECK_SET", digest: digest, count: bytes.count)
        }
        let passed = checks.allSatisfy { $0.status == .pass }
        return .init(arm: arm, captureID: captureID, outcome: passed ? .structuralPass : .structuralFail,
                     reason: passed ? "ALL_REQUIRED_CHECKS_PASS" : "REQUIRED_CHECK_FAILED", digest: digest, count: bytes.count)
    }
    private static func validID(_ value: String) -> Bool {
        let b = value.utf8.prefix(129)
        return !b.isEmpty && b.count <= 128 && b.allSatisfy { (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || [45,46,95].contains($0) }
    }
    private static func validText(_ value: String, maximum: Int) -> Bool {
        value.utf8.prefix(maximum + 1).count <= maximum && !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !value.utf8.contains(0)
    }
}
