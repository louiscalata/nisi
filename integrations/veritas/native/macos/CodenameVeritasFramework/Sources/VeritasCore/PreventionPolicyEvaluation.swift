import Foundation

// Experimental policy preparation, NOT the official FI0.6 product milestone.
// V1 falsely exposed promotion without experiments. Original source and adverse
// execution evidence are retained in work/2026-09-08-policy-candidate-truth/.
// Do not deserialize historical V1 output as current experiment evidence.
@available(*, unavailable, message: "Unsafe experimental V1 retired; use PreventionCandidateRegistryV2. No automatic migration or promotion.")
public enum PreventionPolicyStatusV1 {}
@available(*, unavailable, message: "Unsafe experimental V1 retired; use PreventionCandidateV2. Historical records are not verified evidence.")
public struct PreventionPolicyEvaluationV1 {}
@available(*, unavailable, message: "Unsafe experimental V1 retired; use PreventionCandidateRegistryV2.registerCandidate. It runs no experiments.")
public actor PreventionPolicyEvaluatorV1 {}

public enum PreventionCandidateStatusV2: String, Sendable {
    case candidate = "CANDIDATE", quarantined = "QUARANTINED"
    case expired = "EXPIRED", revoked = "REVOKED"
}

/// Restrictions are administrative, not evidence of adjudication or efficacy.
/// Expiry is explicit here; this registry does not implement an automatic TTL.
public enum PreventionCandidateRestrictionV2: String, Encodable, Sendable {
    case quarantine = "QUARANTINED", expire = "EXPIRED", revoke = "REVOKED"
}

public enum PreventionCandidateExperimentV2: String, Sendable {
    case notRun = "NOT_RUN"
}

public enum PreventionCandidateGuardrailsV2: String, Sendable {
    case notConfigured = "NOT_CONFIGURED", notEvaluated = "NOT_EVALUATED"
}

public enum PreventionCandidateRefusalV2: String, Error, Sendable {
    case invalidID = "POLICY_INVALID_ID"
    case invalidControl = "POLICY_INVALID_CONTROL_TYPE"
    case invalidFamily = "POLICY_INVALID_TARGET_FAMILY"
    case invalidRateName = "POLICY_INVALID_RATE_NAME"
    case invalidRateValue = "POLICY_INVALID_RATE_VALUE"
    case tooManyRates = "POLICY_TOO_MANY_RATES"
    case idConflict = "POLICY_ID_CONFLICT"
    case capacityExceeded = "POLICY_CAPACITY_EXCEEDED"
    case invalidCapacity = "POLICY_INVALID_CAPACITY"
    case notFound = "POLICY_NOT_FOUND"
    case terminalRestriction = "POLICY_TERMINAL_RESTRICTION"
}

/// A proposed maximum rate in [0, 1]. The name is an unverified label, not a
/// registered metric implementation. This is NOT a generic cost/latency bound.
public struct PreventionRateUpperBoundV2: Equatable, Sendable {
    public let name: String
    public let maximumRate: Double
    fileprivate init(name: String, maximumRate: Double) {
        self.name = name
        self.maximumRate = maximumRate
    }
    fileprivate var bits: Data {
        var value = maximumRate.bitPattern.bigEndian
        return withUnsafeBytes(of: &value) { Data($0) }
    }
}

/// Immutable metadata only. No public/memberwise initializer and no decoder.
/// Neither creation, serialization nor a digest grants any permission.
/// Real experiments must produce separate records bound to definitionDigest;
/// promotion needs a separate protected authority, neither implemented here.
public struct PreventionCandidateV2: Equatable, Encodable, Sendable {
    public let policyID: String
    public let controlType: String
    public let targetFailureFamily: String
    public let rateUpperBounds: [PreventionRateUpperBoundV2]
    public let restrictionHistory: [PreventionCandidateRestrictionV2]
    public let definitionDigest: String

    public var schemaVersion: Int { 2 }
    public var authorizing: Bool { false }
    public var experiment: PreventionCandidateExperimentV2 { .notRun }
    public var guardrails: PreventionCandidateGuardrailsV2 {
        rateUpperBounds.isEmpty ? .notConfigured : .notEvaluated
    }
    public var status: PreventionCandidateStatusV2 {
        switch restrictionHistory.last {
        case .none: return .candidate
        case .quarantine: return .quarantined
        case .expire: return .expired
        case .revoke: return .revoked
        }
    }
    public var limitationCodes: [String] {
        ["CANDIDATE_METADATA_ONLY", "NO_COUNTERFACTUAL_EXPERIMENT_RUN",
         "NO_PROMOTION_AUTHORITY", "NO_INDEPENDENT_CERTIFICATION",
         "CONTROL_FAMILY_AND_METRIC_REFERENCES_UNVERIFIED", "PROCESS_LOCAL_NOT_DURABLE",
         rateUpperBounds.isEmpty ? "NO_GUARDRAILS_CONFIGURED" : "GUARDRAILS_NOT_EVALUATED"]
    }
    /// Binary-framed digest, not a canonical-JSON or signature claim.
    /// Definition remains stable when restrictions change; record digest does not.
    public var recordDigest: String {
        VeritasDigestFrameV1.digest(domain: "veritas-prevention-candidate-record-v2",
            fields: [definitionDigest] + restrictionHistory.map(\.rawValue))
    }

    fileprivate init(policyID: String, controlType: String, targetFailureFamily: String,
                     rates: [PreventionRateUpperBoundV2], restrictions: [PreventionCandidateRestrictionV2] = []) {
        self.policyID = policyID
        self.controlType = controlType
        self.targetFailureFamily = targetFailureFamily
        self.rateUpperBounds = rates
        self.restrictionHistory = restrictions
        var frames = [Data(policyID.utf8), Data(controlType.utf8), Data(targetFailureFamily.utf8)]
        for rate in rates { frames.append(Data(rate.name.utf8)); frames.append(rate.bits) }
        self.definitionDigest = VeritasDigestFrameV1.digest(
            domain: "veritas-prevention-candidate-definition-v2", frames: frames)
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, policyID, controlType, targetFailureFamily, rateUpperBounds
        case restrictionHistory, definitionDigest, recordDigest, status, experiment
        case guardrails, authorizing, limitationCodes
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(schemaVersion, forKey: .schemaVersion)
        try c.encode(policyID, forKey: .policyID)
        try c.encode(controlType, forKey: .controlType)
        try c.encode(targetFailureFamily, forKey: .targetFailureFamily)
        // Canonical binary64 bits make the declared rate representation explicit.
        // This diagnostic JSON has no decoder and is not an authority envelope.
        let rates = rateUpperBounds.map { ["name": $0.name, "maximumRateBits": $0.bits.map { String(format: "%02x", $0) }.joined()] }
        try c.encode(rates, forKey: .rateUpperBounds)
        try c.encode(restrictionHistory, forKey: .restrictionHistory)
        try c.encode(definitionDigest, forKey: .definitionDigest)
        try c.encode(recordDigest, forKey: .recordDigest)
        try c.encode(status.rawValue, forKey: .status)
        try c.encode(experiment.rawValue, forKey: .experiment)
        try c.encode(guardrails.rawValue, forKey: .guardrails)
        try c.encode(authorizing, forKey: .authorizing)
        try c.encode(limitationCodes, forKey: .limitationCodes)
    }
}

/// Bounded, process-local registry for proposals, not an evaluation service.
/// No model calls, executable policy actions, family adjudication, persistence,
/// automatic retention, promotion, or integration with the current pipeline.
/// Actor methods contain no await: validation and insertion are one operation.
public actor PreventionCandidateRegistryV2 {
    public static let maximumCandidates = 256
    public static let maximumRates = 16
    private let capacity: Int
    private var candidates = [String: PreventionCandidateV2]()
    public var count: Int { candidates.count }

    public init() { capacity = Self.maximumCandidates }
    /// Smaller capacity only for package tests; never raises the public bound.
    package init(capacity: Int) throws {
        guard (1...Self.maximumCandidates).contains(capacity) else {
            throw PreventionCandidateRefusalV2.invalidCapacity
        }
        self.capacity = capacity
    }

    public func registerCandidate(policyID: String, controlType: String,
                                  targetFailureFamily: String, rateUpperBounds: [String: Double])
        -> Result<PreventionCandidateV2, PreventionCandidateRefusalV2> {
        guard Self.validIdentifier(policyID) else { return .failure(.invalidID) }
        guard Self.validIdentifier(controlType) else { return .failure(.invalidControl) }
        guard Self.validIdentifier(targetFailureFamily) else { return .failure(.invalidFamily) }
        guard rateUpperBounds.count <= Self.maximumRates else { return .failure(.tooManyRates) }
        var rates: [PreventionRateUpperBoundV2] = []
        for (name, value) in rateUpperBounds {
            // Inspect at most 129 input bytes before normalization/allocation.
            guard !name.isEmpty, name.utf8.prefix(129).count <= 128 else { return .failure(.invalidRateName) }
            let normalized = name.precomposedStringWithCanonicalMapping
            guard !normalized.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  normalized.utf8.prefix(129).count <= 128,
                  normalized.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
            else { return .failure(.invalidRateName) }
            guard value.isFinite, value >= 0, value <= 1 else { return .failure(.invalidRateValue) }
            // Swift Dictionary already treats canonically equivalent String keys
            // as equal. Normalize stored spelling and both signs of zero.
            rates.append(.init(name: normalized, maximumRate: value == 0 ? 0 : value))
        }
        rates.sort { $0.name.utf8.lexicographicallyPrecedes($1.name.utf8) }
        let candidate = PreventionCandidateV2(policyID: policyID, controlType: controlType,
            targetFailureFamily: targetFailureFamily, rates: rates)
        if let existing = candidates[policyID] {
            // Compare actual normalized content, not only a digest. Exact replay
            // returns the latest restricted record, even when capacity is full.
            guard existing.controlType == controlType,
                  existing.targetFailureFamily == targetFailureFamily,
                  existing.rateUpperBounds == rates else { return .failure(.idConflict) }
            return .success(existing)
        }
        guard candidates.count < capacity else { return .failure(.capacityExceeded) }
        candidates[policyID] = candidate
        return .success(candidate)
    }

    public func candidate(policyID: String) -> PreventionCandidateV2? {
        guard Self.validIdentifier(policyID) else { return nil }
        return candidates[policyID]
    }

    public func restrict(policyID: String, to restriction: PreventionCandidateRestrictionV2)
        -> Result<PreventionCandidateV2, PreventionCandidateRefusalV2> {
        guard Self.validIdentifier(policyID) else { return .failure(.invalidID) }
        guard let existing = candidates[policyID] else { return .failure(.notFound) }
        if existing.restrictionHistory.last == restriction { return .success(existing) }
        // Monotonic restrictions only. Retain at most three transitions and never
        // refund occupied entries; erasing IDs would permit silent resurrection.
        guard existing.status != .revoked,
              !(existing.status == .expired && restriction == .quarantine)
        else { return .failure(.terminalRestriction) }
        let updated = PreventionCandidateV2(policyID: existing.policyID, controlType: existing.controlType,
            targetFailureFamily: existing.targetFailureFamily, rates: existing.rateUpperBounds,
            restrictions: existing.restrictionHistory + [restriction])
        candidates[policyID] = updated
        return .success(updated)
    }

    private static func validIdentifier(_ value: String) -> Bool {
        let bytes = value.utf8.prefix(129)
        return !bytes.isEmpty && bytes.count <= 128 && bytes.allSatisfy {
            (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0)
                || [45, 46, 47, 58, 95].contains($0)
        }
    }
}
