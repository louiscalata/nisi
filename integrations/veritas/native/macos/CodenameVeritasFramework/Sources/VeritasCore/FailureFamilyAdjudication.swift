import Foundation

// Experimental pattern observation, NOT official FI0.5 historical import or
// protected adjudication. Original V1 and contrary tests are retained privately.
@available(*, unavailable, message: "Experimental V1 retired; a pattern observation cannot establish severity or root cause.")
public enum FailureFamilySeverityV1 {}
@available(*, unavailable, message: "Caller-asserted verification retired. Use ledger.observeFailurePattern(selections:).")
public struct FailureFamilyAdjudicationV1 {}
@available(*, unavailable, message: "Experimental V1 retired; no adjudication or acceptance is performed by pattern observation.")
public enum FamilyAdjudicationResultV1 {}
@available(*, unavailable, message: "Experimental V1 retired. Use LocalIncidentLedgerV1.observeFailurePattern(selections:).")
public actor FailureFamilyAdjudicatorV1 {}

public enum FailurePatternRefusalV2: String, Error, Equatable, Sendable {
    case invalidMemberCount = "PATTERN_INVALID_MEMBER_COUNT"
    case invalidScope = "PATTERN_INVALID_SCOPE"
    case invalidSelection = "PATTERN_INVALID_SELECTION"
    case invalidMember = "PATTERN_INVALID_MEMBER"
    case inactiveMember = "PATTERN_INACTIVE_MEMBER"
    case duplicateMember = "PATTERN_DUPLICATE_MEMBER"
    case invalidCodes = "PATTERN_INVALID_CODES"
    case invalidTime = "PATTERN_INVALID_TIME"
    case invalidSnapshot = "PATTERN_INVALID_SNAPSHOT"
    case noSharedPattern = "PATTERN_NO_SHARED_CODES"
}

public enum FailurePatternKindV2: String, Encodable, Sendable {
    case failureOnly = "SHARED_FAILURE_CODES"
    case symptomOnly = "SHARED_SYMPTOM_CODES"
    case failureAndSymptom = "SHARED_FAILURE_AND_SYMPTOM_CODES"
}

/// Exact digest-only observation membership, not independently verified causes.
/// Construction belongs to the reducer; external clients can only inspect/encode.
public struct FailurePatternMemberV2: Equatable, Encodable, Sendable {
    public let ordinal: Int64
    public let eventID: String
    public let incidentID: String
    public let incidentDigest: String
    public let observationKey: String
    public let subjectIDDigest: String
    public let subjectContentDigest: String
    public let evidenceSetDigest: String
    public let eventDigest: String
    public let observedAtMilliseconds: Int64
    public let retentionReviewAtMilliseconds: Int64?
    public let failureCodes: [String]
    public let symptomCodes: [String]

    fileprivate init(summary: IncidentSummaryV1, observed: Int64, retention: Int64?,
                     failures: [String], symptoms: [String]) {
        ordinal = summary.ordinal; eventID = summary.eventID
        incidentID = summary.incidentID; incidentDigest = summary.incidentDigest
        observationKey = summary.observationKey; subjectIDDigest = summary.subjectIDDigest
        subjectContentDigest = summary.subjectContentDigest; evidenceSetDigest = summary.evidenceSetDigest
        eventDigest = summary.eventDigest; observedAtMilliseconds = observed
        retentionReviewAtMilliseconds = retention; failureCodes = failures; symptomCodes = symptoms
    }

    fileprivate var fields: [String] {
        [String(ordinal), eventID, incidentID, incidentDigest, observationKey,
         subjectIDDigest, subjectContentDigest, evidenceSetDigest, eventDigest,
         String(observedAtMilliseconds), retentionReviewAtMilliseconds.map(String.init) ?? "NONE",
         String(failureCodes.count)] + failureCodes + [String(symptomCodes.count)] + symptomCodes
    }
}

/// A single ledger-read-transaction observation. No public initializer/decoder.
/// Its head binding describes the historical read, not protected currentness.
public struct FailurePatternObservationV2: Equatable, Encodable, Sendable {
    public static let maximumMembers = 64
    public let scope: IncidentLedgerScopeV1
    public let ledgerProfile: String
    public let ledgerHeadDigest: String
    public let ledgerEventCount: Int64
    public let ledgerObservationCount: Int64
    public let ledgerTombstoneCount: Int64
    public let members: [FailurePatternMemberV2]
    public let sharedFailureCodes: [String]
    public let sharedSymptomCodes: [String]
    public let patternDigest: String
    public let membershipDigest: String
    public let observationDigest: String

    public var schemaVersion: Int { 2 }
    public var status: String { "PATTERN_OBSERVED" }
    public var adjudication: String { "NOT_PERFORMED" }
    public var rootCause: String { "NOT_ESTABLISHED" }
    public var authorizing: Bool { false }
    public var observationID: String { "pattern-observation/" + observationDigest }
    public var memberCount: Int { members.count }
    public var distinctSubjectContentCount: Int { Set(members.map(\.subjectContentDigest)).count }
    public var firstObservedAtMilliseconds: Int64 { members.map(\.observedAtMilliseconds).min()! }
    public var lastObservedAtMilliseconds: Int64 { members.map(\.observedAtMilliseconds).max()! }
    public var kind: FailurePatternKindV2 {
        sharedFailureCodes.isEmpty ? .symptomOnly : (sharedSymptomCodes.isEmpty ? .failureOnly : .failureAndSymptom)
    }
    public var limitationCodes: [String] {
        ["PATTERN_OBSERVATION_NOT_ADJUDICATION", "NO_ROOT_CAUSE_ESTABLISHED",
         "MEMBER_COUNT_NOT_INDEPENDENT_OCCURRENCES", "SAME_USER_LEDGER_NOT_PROTECTED_AUTHORITY",
         "SINGLE_READ_TRANSACTION_NOT_LIVE_AUTHORITY", "SNAPSHOT_MAY_BECOME_STALE",
         "RETENTION_REVIEW_DEADLINE_NOT_AUTOMATIC_EXPIRY", "RETENTION_NOT_RECHECKED_AFTER_OBSERVATION",
         "NO_AUTOMATIC_LEARNING_OR_PROMOTION", "NO_RAW_CONTENT"]
    }

    fileprivate init(scope: IncidentLedgerScopeV1, verification: IncidentLedgerVerificationV1,
                     members: [FailurePatternMemberV2], failures: [String], symptoms: [String]) {
        self.scope = scope; ledgerProfile = verification.profile
        ledgerHeadDigest = verification.headDigest; ledgerEventCount = verification.eventCount
        ledgerObservationCount = verification.observationCount; ledgerTombstoneCount = verification.tombstoneCount
        self.members = members; sharedFailureCodes = failures; sharedSymptomCodes = symptoms
        patternDigest = VeritasDigestFrameV1.digest(domain: "veritas-failure-pattern-v2", fields:
            [scope.scopeID, scope.projectDigest, scope.accessPolicyDigest, scope.retentionPolicyDigest,
             String(failures.count)] + failures + [String(symptoms.count)] + symptoms)
        membershipDigest = VeritasDigestFrameV1.digest(domain: "veritas-failure-pattern-membership-v2",
            fields: [patternDigest, String(members.count)] + members.flatMap(\.fields))
        observationDigest = VeritasDigestFrameV1.digest(domain: "veritas-failure-pattern-observation-v2",
            fields: [membershipDigest, ledgerProfile, ledgerHeadDigest, String(ledgerEventCount),
                     String(ledgerObservationCount), String(ledgerTombstoneCount)])
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, status, adjudication, rootCause, authorizing, observationID
        case scope, ledgerProfile, ledgerHeadDigest, ledgerEventCount, ledgerObservationCount, ledgerTombstoneCount
        case members, memberCount, distinctSubjectContentCount, firstObservedAtMilliseconds, lastObservedAtMilliseconds
        case sharedFailureCodes, sharedSymptomCodes, kind, patternDigest, membershipDigest, observationDigest, limitationCodes
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(schemaVersion, forKey: .schemaVersion); try c.encode(status, forKey: .status)
        try c.encode(adjudication, forKey: .adjudication); try c.encode(rootCause, forKey: .rootCause)
        try c.encode(authorizing, forKey: .authorizing); try c.encode(observationID, forKey: .observationID)
        try c.encode(["scopeID": scope.scopeID, "projectDigest": scope.projectDigest,
                      "accessPolicyDigest": scope.accessPolicyDigest, "retentionPolicyDigest": scope.retentionPolicyDigest], forKey: .scope)
        try c.encode(ledgerProfile, forKey: .ledgerProfile); try c.encode(ledgerHeadDigest, forKey: .ledgerHeadDigest)
        try c.encode(ledgerEventCount, forKey: .ledgerEventCount); try c.encode(ledgerObservationCount, forKey: .ledgerObservationCount)
        try c.encode(ledgerTombstoneCount, forKey: .ledgerTombstoneCount); try c.encode(members, forKey: .members)
        try c.encode(memberCount, forKey: .memberCount); try c.encode(distinctSubjectContentCount, forKey: .distinctSubjectContentCount)
        try c.encode(firstObservedAtMilliseconds, forKey: .firstObservedAtMilliseconds)
        try c.encode(lastObservedAtMilliseconds, forKey: .lastObservedAtMilliseconds)
        try c.encode(sharedFailureCodes, forKey: .sharedFailureCodes); try c.encode(sharedSymptomCodes, forKey: .sharedSymptomCodes)
        try c.encode(kind, forKey: .kind); try c.encode(patternDigest, forKey: .patternDigest)
        try c.encode(membershipDigest, forKey: .membershipDigest); try c.encode(observationDigest, forKey: .observationDigest)
        try c.encode(limitationCodes, forKey: .limitationCodes)
    }
}

/// Internal reducer only: the public route captures all views in one verified
/// ledger transaction. Testable input seams are not an external authority API.
/// No state, model invocation, clock, persistence, filtering or policy promotion.
enum FailurePatternReducerV2 {
    static func observe(scope: IncidentLedgerScopeV1, verification: IncidentLedgerVerificationV1,
                        views: [IncidentViewV1]) throws -> FailurePatternObservationV2 {
        guard (2...FailurePatternObservationV2.maximumMembers).contains(views.count) else {
            throw FailurePatternRefusalV2.invalidMemberCount
        }
        guard scope.scopeID == "scope/veritas-private",
              isDigest(scope.projectDigest), isDigest(scope.accessPolicyDigest), isDigest(scope.retentionPolicyDigest)
        else { throw FailurePatternRefusalV2.invalidScope }
        guard verification.profile == LocalIncidentLedgerV1.profile, isDigest(verification.headDigest),
              verification.eventCount >= 2, verification.eventCount <= LocalIncidentLedgerV1.maximumEventsPerProject,
              verification.observationCount >= Int64(views.count), verification.tombstoneCount >= 0,
              verification.observationCount <= verification.eventCount,
              verification.tombstoneCount == verification.eventCount - verification.observationCount,
              !verification.authorizing, !verification.protectedAuthorityVerified, !verification.rawContentStored
        else { throw FailurePatternRefusalV2.invalidSnapshot }
        var members: [FailurePatternMemberV2] = []
        var ids = Set<String>(), keys = Set<String>(), events = Set<String>(), ordinals = Set<Int64>()
        for view in views {
            guard view.scope == scope, view.summary.projectDigest == scope.projectDigest else {
                throw FailurePatternRefusalV2.invalidScope
            }
            guard view.lifecycleState == .active, view.tombstone == nil else { throw FailurePatternRefusalV2.inactiveMember }
            let s = view.summary
            guard isIncidentID(s.incidentID), isDigest(s.incidentDigest), isDigest(s.observationKey),
                  isDigest(s.subjectIDDigest), isDigest(s.subjectContentDigest), s.subjectIDDigest != s.subjectContentDigest,
                  isDigest(s.evidenceSetDigest), isDigest(s.eventDigest),
                  s.ordinal > 0, s.ordinal <= verification.eventCount,
                  s.eventID == "event/\(String(format: "%012lld", s.ordinal))-\(s.incidentDigest.prefix(16))",
                  !s.authorizing, !s.protectedAuthorityVerified, !s.rawContentStored
            else { throw FailurePatternRefusalV2.invalidMember }
            guard ids.insert(s.incidentID).inserted, keys.insert(s.observationKey).inserted,
                  events.insert(s.eventDigest).inserted, ordinals.insert(s.ordinal).inserted
            else { throw FailurePatternRefusalV2.duplicateMember }
            guard let observed = milliseconds(s.observedAt) else { throw FailurePatternRefusalV2.invalidTime }
            var retention: Int64?
            if let time = s.retentionReviewAt {
                guard let value = milliseconds(time), value > observed else { throw FailurePatternRefusalV2.invalidTime }
                retention = value
            }
            let failures = try codes(s.failureCodes), symptoms = try codes(s.symptomCodes)
            members.append(.init(summary: s, observed: observed, retention: retention, failures: failures, symptoms: symptoms))
        }
        // incident IDs are unique bounded ASCII, so one key suffices for total order.
        members.sort { $0.incidentID.utf8.lexicographicallyPrecedes($1.incidentID.utf8) }
        var failures = Set(members[0].failureCodes), symptoms = Set(members[0].symptomCodes)
        for member in members.dropFirst() {
            failures.formIntersection(member.failureCodes); symptoms.formIntersection(member.symptomCodes)
        }
        guard !failures.isEmpty || !symptoms.isEmpty else { throw FailurePatternRefusalV2.noSharedPattern }
        return FailurePatternObservationV2(scope: scope, verification: verification, members: members,
            failures: failures.sorted(), symptoms: symptoms.sorted())
    }

    static func validSelection(_ selection: IncidentSelectionV1) -> Bool {
        isDigest(selection.projectDigest) && isIncidentID(selection.incidentID)
            && isDigest(selection.incidentDigest) && isDigest(selection.subjectIDDigest)
            && isDigest(selection.subjectContentDigest) && selection.subjectIDDigest != selection.subjectContentDigest
            && isDigest(selection.observationEventDigest)
    }
    private static func isDigest(_ value: String) -> Bool {
        let bytes = value.utf8.prefix(65)
        return bytes.count == 64 && bytes.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
    private static func isIncidentID(_ value: String) -> Bool {
        value.utf8.prefix(74).count == 73 && value.hasPrefix("incident/") && isDigest(String(value.dropFirst(9)))
    }
    private static func milliseconds(_ date: Date) -> Int64? {
        let value = (date.timeIntervalSince1970 * 1_000).rounded(.towardZero)
        guard value.isFinite, value >= 0, value <= 253_402_300_799_999 else { return nil }
        return Int64(value)
    }
    private static func codes<C: RawRepresentable & Hashable>(_ values: [C]) throws -> [String] where C.RawValue == String {
        guard !values.isEmpty, values.count <= 32, Set(values).count == values.count else {
            throw FailurePatternRefusalV2.invalidCodes
        }
        return values.map(\.rawValue).sorted()
    }
}
