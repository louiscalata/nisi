import Foundation

/// A deterministic reading of recorded codes, never a diagnosis or permission.
/// Constructed only by the ledger from one verified same-user read snapshot.
/// No decoder, raw artifact text, model output, policy action or approval handle.
public struct IncidentExplanationV1: Equatable, Encodable, Sendable {
    public struct Signal: Equatable, Encodable, Sendable {
        public let category: String
        public let code: String
        public let meaning: String
        public var identity: String { category + ":" + code }
        fileprivate init(_ category: String, _ code: String, _ meaning: String) {
            self.category = category; self.code = code; self.meaning = meaning
        }
    }

    public let schemaVersion = 1
    public let interpretation = "OBSERVED_CODES_ONLY"
    public let rootCause = "NOT_ESTABLISHED"
    public let adjudication = "NOT_PERFORMED"
    public let recommendedAction = "NONE"
    public let modelParticipation = "NOT_RUN"
    public let authorizing = false
    public let historicalFactsVerified = false
    public let projectDigest: String
    public let scopeDigest: String
    public let accessPolicyDigest: String
    public let retentionPolicyDigest: String
    public let incidentID: String
    public let incidentDigest: String
    public let subjectIDDigest: String
    public let subjectContentDigest: String
    public let observationEventDigest: String
    public let evidenceSetDigest: String
    public let lifecycle: String
    public let tombstoneEventDigest: String?
    public let asOfLedgerHeadDigest: String
    public let asOfLedgerEventCount: Int64
    public let signals: [Signal]
    public let limitationCodes = ["SAME_USER_SNAPSHOT_NOT_PROTECTED_CURRENTNESS",
        "RECORDED_CODES_NOT_CAUSAL_OR_INDEPENDENT_FAILURE_EVIDENCE",
        "DIGEST_ONLY_NOT_ANONYMITY", "LOGICAL_TOMBSTONE_NOT_PHYSICAL_ERASURE",
        "NO_LEARNING_POLICY_PROMOTION_OR_CERTIFICATION_EFFECT"]

    // Explicitly include the computed digest in diagnostic JSON. Synthesized
    // Encodable would silently omit it because it is not stored state.
    private struct Key: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }
        init(_ value: String) { stringValue = value }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        try c.encode(schemaVersion, forKey: Key("schemaVersion"))
        for (key, value) in ["interpretation": interpretation, "rootCause": rootCause,
            "adjudication": adjudication, "recommendedAction": recommendedAction,
            "modelParticipation": modelParticipation, "projectDigest": projectDigest,
            "scopeDigest": scopeDigest, "accessPolicyDigest": accessPolicyDigest,
            "retentionPolicyDigest": retentionPolicyDigest, "incidentID": incidentID,
            "incidentDigest": incidentDigest, "subjectIDDigest": subjectIDDigest,
            "subjectContentDigest": subjectContentDigest, "observationEventDigest": observationEventDigest,
            "evidenceSetDigest": evidenceSetDigest, "lifecycle": lifecycle,
            "asOfLedgerHeadDigest": asOfLedgerHeadDigest, "explanationDigest": explanationDigest] {
            try c.encode(value, forKey: Key(key))
        }
        try c.encode(tombstoneEventDigest, forKey: Key("tombstoneEventDigest"))
        try c.encode(asOfLedgerEventCount, forKey: Key("asOfLedgerEventCount"))
        try c.encode(signals, forKey: Key("signals"))
        try c.encode(limitationCodes, forKey: Key("limitationCodes"))
        try c.encode(authorizing, forKey: Key("authorizing"))
        try c.encode(historicalFactsVerified, forKey: Key("historicalFactsVerified"))
    }

    /// Binds the exact snapshot and all displayed semantics, not just an ID.
    /// This digest provides correspondence, not an authenticated authority.
    public var explanationDigest: String {
        VeritasDigestFrameV1.digest(domain: "veritas-incident-explanation-v1", fields:
            [String(schemaVersion), interpretation, rootCause, adjudication, recommendedAction,
             modelParticipation, String(authorizing), String(historicalFactsVerified),
             projectDigest, scopeDigest, accessPolicyDigest, retentionPolicyDigest,
             incidentID, incidentDigest, subjectIDDigest, subjectContentDigest,
             observationEventDigest, evidenceSetDigest, lifecycle,
             tombstoneEventDigest == nil ? "ABSENT" : "PRESENT", tombstoneEventDigest ?? "",
             asOfLedgerHeadDigest, String(asOfLedgerEventCount), String(signals.count)]
            + signals.flatMap { [$0.category, $0.code, $0.meaning] }
            + [String(limitationCodes.count)] + limitationCodes)
    }

    package init(view: IncidentViewV1, verification: IncidentLedgerVerificationV1) {
        projectDigest = view.scope.projectDigest
        scopeDigest = ArtifactSnapshot.digest(Data(view.scope.scopeID.utf8))
        accessPolicyDigest = view.scope.accessPolicyDigest
        retentionPolicyDigest = view.scope.retentionPolicyDigest
        incidentID = view.summary.incidentID; incidentDigest = view.summary.incidentDigest
        subjectIDDigest = view.summary.subjectIDDigest
        subjectContentDigest = view.summary.subjectContentDigest
        observationEventDigest = view.summary.eventDigest
        evidenceSetDigest = view.summary.evidenceSetDigest
        lifecycle = view.lifecycleState.rawValue; tombstoneEventDigest = view.tombstone?.eventDigest
        asOfLedgerHeadDigest = verification.headDigest; asOfLedgerEventCount = verification.eventCount
        signals = view.summary.failureCodes.sorted { $0.rawValue < $1.rawValue }.map {
            Signal("FAILURE_CODE", $0.rawValue, Self.meaning($0))
        } + view.summary.symptomCodes.sorted { $0.rawValue < $1.rawValue }.map {
            Signal("SYMPTOM_CODE", $0.rawValue, Self.meaning($0))
        }
    }

    private static func meaning(_ code: IncidentFailureCodeV1) -> String {
        switch code {
        case .deterministicCheckInconclusive: "The recorded check was inconclusive. It establishes neither a pass nor a failure."
        case .deterministicCheckFailed: "The recorded deterministic check returned FAIL. The cause is not established here."
        case .factEvidenceMissing: "The record reports missing factual support. This does not establish that a claim is false."
        case .requirementMissing: "The record reports an unmet requirement. Its cause and the requirement's correctness are not established here."
        case .schemaInvalid: "The record reports a schema mismatch. This is not a conclusion about every property of the artifact."
        case .testFailed: "The record reports a test failure. The test's correctness and the cause are not established here."
        }
    }
    private static func meaning(_ code: IncidentSymptomCodeV1) -> String {
        switch code {
        case .failingTest: "A failing test was recorded as a symptom, not a root cause."
        case .inconclusiveResult: "An inconclusive result was recorded; it must not be treated as PASS."
        case .invalidStructure: "An invalid structure was recorded as a symptom."
        case .missingCitation: "A missing citation was recorded; a citation's presence alone would not prove a claim."
        case .missingSection: "A missing section was recorded as a symptom, not an explanation of why it was omitted."
        }
    }
}
