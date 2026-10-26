import CryptoKit
import Darwin
import Foundation
import SQLite3
import VeritasSQLiteSupport

/// The Founder Alpha incident ledger is deliberately separate from acceptance.
///
/// It remembers that an exact subject encountered named deterministic failures. It
/// cannot accept, certify, repair, promote, recall, or inject anything into a prompt.
/// This narrow boundary makes durable history useful before protected authority is
/// available without turning same-user storage into a trust oracle.
public struct IncidentLedgerScopeV1: Equatable, Sendable {
    public let scopeID: String
    public let projectDigest: String
    public let accessPolicyDigest: String
    public let retentionPolicyDigest: String

    public init(
        scopeID: String,
        projectDigest: String,
        accessPolicyDigest: String,
        retentionPolicyDigest: String
    ) {
        self.scopeID = scopeID
        self.projectDigest = projectDigest
        self.accessPolicyDigest = accessPolicyDigest
        self.retentionPolicyDigest = retentionPolicyDigest
    }
}

/// Closed, non-authorizing failure codes admitted by the Founder Alpha ledger.
///
/// Callers cannot persist arbitrary text through this field. Adding a case is a
/// schema decision that requires a new review and deterministic fixtures.
public enum IncidentFailureCodeV1: String, CaseIterable, Sendable {
    case deterministicCheckInconclusive = "DETERMINISTIC_CHECK_INCONCLUSIVE"
    case deterministicCheckFailed = "DETERMINISTIC_CHECK_FAILED"
    case factEvidenceMissing = "FACT_EVIDENCE_MISSING"
    case requirementMissing = "REQUIREMENT_MISSING"
    case schemaInvalid = "SCHEMA_INVALID"
    case testFailed = "TEST_FAILED"
}

/// Closed symptom vocabulary admitted by the Founder Alpha ledger.
public enum IncidentSymptomCodeV1: String, CaseIterable, Sendable {
    case failingTest = "FAILING_TEST"
    case inconclusiveResult = "INCONCLUSIVE_RESULT"
    case invalidStructure = "INVALID_STRUCTURE"
    case missingCitation = "MISSING_CITATION"
    case missingSection = "MISSING_SECTION"
}

public struct IncidentObservationInputV1: Equatable, Sendable {
    /// Digest-derived identity in the exact form `incident/<lowercase SHA-256>`.
    public let incidentID: String
    public let observationKey: String
    public let subjectIDDigest: String
    public let subjectContentDigest: String
    public let evidenceSetDigest: String
    public let failureCodes: [IncidentFailureCodeV1]
    public let symptomCodes: [IncidentSymptomCodeV1]
    public let observedAt: Date
    /// Review deadline for a separately invoked bounded retention sweep. Storing
    /// this value alone never enforces expiry or performs physical erasure.
    public let retentionReviewAt: Date?

    public init(
        incidentID: String,
        observationKey: String,
        subjectIDDigest: String,
        subjectContentDigest: String,
        evidenceSetDigest: String,
        failureCodes: [IncidentFailureCodeV1],
        symptomCodes: [IncidentSymptomCodeV1],
        observedAt: Date,
        retentionReviewAt: Date?
    ) {
        self.incidentID = incidentID
        self.observationKey = observationKey
        self.subjectIDDigest = subjectIDDigest
        self.subjectContentDigest = subjectContentDigest
        self.evidenceSetDigest = evidenceSetDigest
        self.failureCodes = failureCodes
        self.symptomCodes = symptomCodes
        self.observedAt = observedAt
        self.retentionReviewAt = retentionReviewAt
    }
}

public struct IncidentSummaryV1: Equatable, Sendable {
    public let projectDigest: String
    public let ordinal: Int64
    public let eventID: String
    public let incidentID: String
    public let incidentDigest: String
    public let observationKey: String
    public let subjectIDDigest: String
    public let subjectContentDigest: String
    public let evidenceSetDigest: String
    public let failureCodes: [IncidentFailureCodeV1]
    public let symptomCodes: [IncidentSymptomCodeV1]
    public let observedAt: Date
    public let retentionReviewAt: Date?
    public let eventDigest: String
    public let authorizing: Bool
    public let protectedAuthorityVerified: Bool
    public let rawContentStored: Bool

    public var selection: IncidentSelectionV1 {
        IncidentSelectionV1(
            projectDigest: projectDigest,
            incidentID: incidentID,
            incidentDigest: incidentDigest,
            subjectIDDigest: subjectIDDigest,
            subjectContentDigest: subjectContentDigest,
            observationEventDigest: eventDigest
        )
    }
}

/// Exact immutable identity required for every incident-history read or mutation.
///
/// A short incident identifier alone is intentionally insufficient. The selection
/// binds the opened project plus the observation's incident, subject, and event
/// digests so a coherent-looking cross-project or stale-UI substitution is refused.
public struct IncidentSelectionV1: Equatable, Sendable {
    public let projectDigest: String
    public let incidentID: String
    public let incidentDigest: String
    public let subjectIDDigest: String
    public let subjectContentDigest: String
    public let observationEventDigest: String

    public init(
        projectDigest: String,
        incidentID: String,
        incidentDigest: String,
        subjectIDDigest: String,
        subjectContentDigest: String,
        observationEventDigest: String
    ) {
        self.projectDigest = projectDigest
        self.incidentID = incidentID
        self.incidentDigest = incidentDigest
        self.subjectIDDigest = subjectIDDigest
        self.subjectContentDigest = subjectContentDigest
        self.observationEventDigest = observationEventDigest
    }
}

public enum IncidentLifecycleStateV1: String, Sendable {
    case active = "ACTIVE"
    case tombstoned = "TOMBSTONED"
}

public enum IncidentTombstoneReasonV1: String, Sendable {
    /// An explicit user request under the project-bound retention policy.
    case userRequested = "USER_REQUESTED"
    /// Policy-driven deletion. This is admitted only when a stored review time is due.
    case retentionReviewDue = "RETENTION_REVIEW_DUE"
}

public struct IncidentTombstoneV1: Equatable, Sendable {
    public let ordinal: Int64
    public let eventID: String
    public let incidentID: String
    public let targetIncidentDigest: String
    public let targetEventDigest: String
    public let subjectIDDigest: String
    public let subjectContentDigest: String
    public let retentionPolicyDigest: String
    public let reason: IncidentTombstoneReasonV1
    public let tombstonedAt: Date
    public let predecessorDigest: String
    public let eventDigest: String
    public let authorizing: Bool
    public let protectedAuthorityVerified: Bool
    public let rawContentStored: Bool
    public let physicalErasurePerformed: Bool
}

public struct IncidentViewV1: Equatable, Sendable {
    public let scope: IncidentLedgerScopeV1
    public let summary: IncidentSummaryV1
    public let lifecycleState: IncidentLifecycleStateV1
    public let tombstone: IncidentTombstoneV1?
    public let limitationCodes: [String]
}

public enum IncidentAppendDispositionV1: Equatable, Sendable {
    case appended(IncidentSummaryV1)
    case idempotentDuplicate(IncidentSummaryV1)
}

public enum IncidentTombstoneDispositionV1: Equatable, Sendable {
    case appended(IncidentTombstoneV1)
    case idempotentDuplicate(IncidentTombstoneV1)
}

/// One bounded, deterministic JSON export of digest-only incident history.
///
/// This report is never an accepted artifact, certificate, or model input. Its
/// canonical bytes contain no raw artifact, path, prompt, transcript, or SQLite
/// diagnostic. `digest` is the SHA-256 of `canonicalData`.
public struct IncidentRedactedExportV1: Equatable, Sendable {
    public let canonicalData: Data
    public let digest: String
    public let incidentID: String
    public let lifecycleState: IncidentLifecycleStateV1
    public let authorizing: Bool
    public let certified: Bool
    public let rawContentStored: Bool
    public let physicalErasurePerformed: Bool
}

public struct IncidentLedgerVerificationV1: Equatable, Sendable {
    public let profile: String
    public let eventCount: Int64
    public let observationCount: Int64
    public let tombstoneCount: Int64
    public let headDigest: String
    public let authorizing: Bool
    public let protectedAuthorityVerified: Bool
    public let rawContentStored: Bool
}

/// Closed parser refusals for an opaque retention-sweep continuation.
/// No raw token or decoder diagnostic crosses this boundary.
public enum IncidentRetentionSweepContinuationRefusalV1:
    String,
    Error,
    Equatable,
    Sendable
{
    case oversized = "OVERSIZED"
    case unsupportedVersion = "UNSUPPORTED_VERSION"
    case malformed = "MALFORMED"
    case nonCanonical = "NON_CANONICAL"
    case sealMismatch = "SEAL_MISMATCH"
}

fileprivate struct IncidentRetentionSweepContinuationClaimsV1:
    Codable,
    Equatable,
    Sendable
{
    let schemaVersion: Int
    let recordType: String
    let ledgerProfile: String
    let scopeID: String
    let projectDigest: String
    let accessPolicyDigest: String
    let retentionPolicyDigest: String
    let databaseDeviceID: String
    let databaseInodeID: String
    let batchSize: String
    let cutoffAtMilliseconds: String
    let initialEventHighWatermark: String
    let lastRetentionReviewAtMilliseconds: String
    let lastObservationOrdinal: String

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case schemaVersion
        case recordType
        case ledgerProfile
        case scopeID
        case projectDigest
        case accessPolicyDigest
        case retentionPolicyDigest
        case databaseDeviceID
        case databaseInodeID
        case batchSize
        case cutoffAtMilliseconds
        case initialEventHighWatermark
        case lastRetentionReviewAtMilliseconds
        case lastObservationOrdinal
    }
}

/// Opaque, bounded continuation for a logical-retention sweep.
///
/// The token binds a stable retention ordering cursor, cutoff, event high-watermark,
/// batch size, exact scope/policy, and the primary database path identity observed by
/// one ledger open. Its domain-separated SHA-256 seal is deliberately unkeyed and
/// forgeable by same-user code. It detects only accidental, incomplete, or unsealed
/// modification; it is not a MAC, authentication, protected rollback authority,
/// SQLite-handle identity, or path-swap protection.
public struct IncidentRetentionSweepContinuationV1: Equatable, Sendable {
    public static let maximumSealedTokenUTF8Bytes = 2_048

    private static let tokenPrefix = "veritas-retention-sweep-continuation-v2"
    private static let recordType = "VERITAS_RETENTION_SWEEP_CONTINUATION"
    private static let maximumCanonicalPayloadBytes = 1_536
    private static let sealDomain =
        "veritas-founder-alpha-retention-sweep-continuation-seal-v2"

    public let sealedToken: String

    fileprivate let claims: IncidentRetentionSweepContinuationClaimsV1
    fileprivate let databaseDeviceID: UInt64
    fileprivate let databaseInodeID: UInt64
    fileprivate let batchSize: Int
    fileprivate let cutoffAtMilliseconds: Int64
    fileprivate let initialEventHighWatermark: Int64
    fileprivate let lastRetentionReviewAtMilliseconds: Int64
    fileprivate let lastObservationOrdinal: Int64

    /// Parses exactly one canonical v2 representation. Size is checked before
    /// splitting or decoding, and no partial claims are returned on refusal.
    /// The wire prefix is `-v2` because the seal moved to the shared
    /// `VeritasDigestFrameV1` framing; a `-v1` token (sealed under the retired
    /// private framing) refuses at the prefix guard as `unsupportedVersion`,
    /// never as a `sealMismatch`, so callers cannot mistake the format change
    /// for tampering. The claims schema itself is unchanged (still version 1).
    public init(
        sealedToken: String
    ) throws(IncidentRetentionSweepContinuationRefusalV1) {
        guard sealedToken.utf8.count <= Self.maximumSealedTokenUTF8Bytes else {
            throw .oversized
        }
        guard !sealedToken.isEmpty, sealedToken.utf8.allSatisfy(Self.isASCIIByte) else {
            throw .malformed
        }
        let components = sealedToken.split(
            separator: ".",
            omittingEmptySubsequences: false
        )
        guard components.count == 3 else { throw .malformed }
        guard components[0] == Substring(Self.tokenPrefix) else {
            throw .unsupportedVersion
        }

        let encodedPayload = String(components[1])
        let suppliedSeal = String(components[2])
        guard
            !encodedPayload.isEmpty,
            encodedPayload.utf8.allSatisfy(Self.isBase64URLByte),
            Self.isDigest(suppliedSeal),
            let payload = Self.decodeBase64URL(encodedPayload),
            !payload.isEmpty
        else {
            throw .malformed
        }
        guard payload.count <= Self.maximumCanonicalPayloadBytes else {
            throw .oversized
        }
        guard let decodedClaims = try? JSONDecoder().decode(
            IncidentRetentionSweepContinuationClaimsV1.self,
            from: payload
        ) else {
            throw .malformed
        }
        guard
            let canonicalPayload = Self.canonicalData(decodedClaims),
            canonicalPayload == payload,
            encodedPayload == Self.encodeBase64URL(canonicalPayload)
        else {
            throw .nonCanonical
        }
        guard decodedClaims.schemaVersion == 1,
              decodedClaims.recordType == Self.recordType,
              decodedClaims.ledgerProfile == LocalIncidentLedgerV1.profile else {
            throw .unsupportedVersion
        }

        guard
            decodedClaims.scopeID == "scope/veritas-private",
            Self.isDigest(decodedClaims.projectDigest),
            Self.isDigest(decodedClaims.accessPolicyDigest),
            Self.isDigest(decodedClaims.retentionPolicyDigest),
            let deviceID = Self.canonicalUInt64(decodedClaims.databaseDeviceID),
            let inodeID = Self.canonicalUInt64(decodedClaims.databaseInodeID),
            inodeID > 0,
            let admittedBatchSize = Self.canonicalInt(decodedClaims.batchSize),
            (1...LocalIncidentLedgerV1.maximumRetentionSweepPageSize)
                .contains(admittedBatchSize),
            let cutoff = Self.canonicalInt64(decodedClaims.cutoffAtMilliseconds),
            cutoff >= 0,
            cutoff <= LocalIncidentLedgerV1.maximumTimestampMilliseconds,
            let highWatermark = Self.canonicalInt64(
                decodedClaims.initialEventHighWatermark
            ),
            highWatermark > 0,
            highWatermark <= LocalIncidentLedgerV1.maximumEventsPerProject,
            let lastReview = Self.canonicalInt64(
                decodedClaims.lastRetentionReviewAtMilliseconds
            ),
            lastReview >= 0,
            lastReview <= cutoff,
            let lastOrdinal = Self.canonicalInt64(
                decodedClaims.lastObservationOrdinal
            ),
            lastOrdinal > 0,
            lastOrdinal <= highWatermark
        else {
            throw .malformed
        }

        guard Self.continuationSeal(canonicalPayload) == suppliedSeal else {
            throw .sealMismatch
        }
        let canonicalToken = [
            Self.tokenPrefix,
            Self.encodeBase64URL(canonicalPayload),
            suppliedSeal,
        ].joined(separator: ".")
        guard canonicalToken == sealedToken else { throw .nonCanonical }

        self.sealedToken = sealedToken
        self.claims = decodedClaims
        self.databaseDeviceID = deviceID
        self.databaseInodeID = inodeID
        self.batchSize = admittedBatchSize
        self.cutoffAtMilliseconds = cutoff
        self.initialEventHighWatermark = highWatermark
        self.lastRetentionReviewAtMilliseconds = lastReview
        self.lastObservationOrdinal = lastOrdinal
    }

    fileprivate init(
        claims: IncidentRetentionSweepContinuationClaimsV1
    ) throws(IncidentRetentionSweepContinuationRefusalV1) {
        guard let payload = Self.canonicalData(claims) else { throw .malformed }
        let token = [
            Self.tokenPrefix,
            Self.encodeBase64URL(payload),
            Self.continuationSeal(payload),
        ].joined(separator: ".")
        try self.init(sealedToken: token)
    }

    fileprivate static func make(
        scope: IncidentLedgerScopeV1,
        databaseFileIdentity: IncidentFileIdentityV1,
        batchSize: Int,
        cutoffAtMilliseconds: Int64,
        initialEventHighWatermark: Int64,
        lastRetentionReviewAtMilliseconds: Int64,
        lastObservationOrdinal: Int64
    ) throws(IncidentRetentionSweepContinuationRefusalV1) -> Self {
        try Self(claims: IncidentRetentionSweepContinuationClaimsV1(
            schemaVersion: 1,
            recordType: Self.recordType,
            ledgerProfile: LocalIncidentLedgerV1.profile,
            scopeID: scope.scopeID,
            projectDigest: scope.projectDigest,
            accessPolicyDigest: scope.accessPolicyDigest,
            retentionPolicyDigest: scope.retentionPolicyDigest,
            databaseDeviceID: String(databaseFileIdentity.canonicalDeviceID),
            databaseInodeID: String(databaseFileIdentity.canonicalInodeID),
            batchSize: String(batchSize),
            cutoffAtMilliseconds: String(cutoffAtMilliseconds),
            initialEventHighWatermark: String(initialEventHighWatermark),
            lastRetentionReviewAtMilliseconds: String(
                lastRetentionReviewAtMilliseconds
            ),
            lastObservationOrdinal: String(lastObservationOrdinal)
        ))
    }

    fileprivate func isBound(
        to scope: IncidentLedgerScopeV1,
        databaseFileIdentity: IncidentFileIdentityV1
    ) -> Bool {
        claims.scopeID == scope.scopeID
            && claims.projectDigest == scope.projectDigest
            && claims.accessPolicyDigest == scope.accessPolicyDigest
            && claims.retentionPolicyDigest == scope.retentionPolicyDigest
            && databaseDeviceID == databaseFileIdentity.canonicalDeviceID
            && databaseInodeID == databaseFileIdentity.canonicalInodeID
    }

    private static func canonicalData<Value: Encodable>(_ value: Value) -> Data? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try? encoder.encode(value)
    }

    private static func continuationSeal(_ payload: Data) -> String {
        VeritasDigestFrameV1.digest(domain: Self.sealDomain, payload: payload)
    }

    private static func canonicalUInt64(_ value: String) -> UInt64? {
        guard let parsed = UInt64(value), String(parsed) == value else { return nil }
        return parsed
    }

    private static func canonicalInt64(_ value: String) -> Int64? {
        guard let parsed = Int64(value), String(parsed) == value else { return nil }
        return parsed
    }

    private static func canonicalInt(_ value: String) -> Int? {
        guard let parsed = Int(value), String(parsed) == value else { return nil }
        return parsed
    }

    private static func isDigest(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy {
            ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
        }
    }

    private static func isASCIIByte(_ byte: UInt8) -> Bool {
        byte > 0 && byte <= 127
    }

    private static func isBase64URLByte(_ byte: UInt8) -> Bool {
        (byte >= 65 && byte <= 90)
            || (byte >= 97 && byte <= 122)
            || (byte >= 48 && byte <= 57)
            || byte == 45
            || byte == 95
    }

    private static func decodeBase64URL(_ value: String) -> Data? {
        var base64 = value.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        switch base64.utf8.count % 4 {
        case 0: break
        case 2: base64 += "=="
        case 3: base64 += "="
        default: return nil
        }
        return Data(base64Encoded: base64)
    }

    private static func encodeBase64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// One bounded logical-retention sweep page result.
///
/// This value exposes the exact scope, cutoff, event high-watermark, page bound,
/// counts, and logical tombstones. It cannot authorize, certify, physically erase,
/// authenticate a caller, or prove protected rollback.
public struct IncidentRetentionSweepPageV1: Equatable, Sendable {
    public static let limitationCodes = [
        "CONTINUATION_SEAL_IS_FORGEABLE_BY_SAME_USER",
        "CONTINUATION_SEAL_DETECTS_ONLY_ACCIDENTAL_INCOMPLETE_OR_UNSEALED_CHANGE",
        "CONTINUATION_SEAL_IS_NOT_AUTHENTICATION_OR_PROTECTED_AUTHORITY",
        "DATABASE_PATH_IDENTITY_IS_NOT_SQLITE_HANDLE_OR_PATH_SWAP_PROOF",
        "DATABASE_PATH_IDENTITY_IS_NOT_PROTECTED_ROLLBACK_AUTHORITY",
        "DATABASE_OPEN_LOCK_IS_COOPERATIVE_NOT_ADVERSARIAL_AUTHORITY",
        "LOGICAL_TOMBSTONE_IS_NOT_PHYSICAL_ERASURE",
        "RETENTION_SWEEP_IS_NOT_ACCEPTANCE_OR_CERTIFICATION",
    ]

    public let scope: IncidentLedgerScopeV1
    /// Exact frozen cutoff used for selection and every newly appended tombstone.
    public let cutoffAtMilliseconds: Int64
    /// Convenience view of `cutoffAtMilliseconds`; use the integer for canonical work.
    public let cutoffAt: Date
    public let initialEventHighWatermark: Int64
    public let batchSize: Int
    public let processedObservationCount: Int
    public let appendedTombstoneCount: Int
    public let replayedTombstoneCount: Int
    public let tombstones: [IncidentTombstoneV1]
    public let continuation: IncidentRetentionSweepContinuationV1?
    public let authorizing: Bool
    public let certified: Bool
    public let protectedAuthorityVerified: Bool
    public let rawContentStored: Bool
    public let physicalErasurePerformed: Bool
    public let limitationCodes: [String]

    fileprivate init(
        scope: IncidentLedgerScopeV1,
        cutoffAtMilliseconds: Int64,
        initialEventHighWatermark: Int64,
        batchSize: Int,
        processedObservationCount: Int,
        appendedTombstoneCount: Int,
        replayedTombstoneCount: Int,
        tombstones: [IncidentTombstoneV1],
        continuation: IncidentRetentionSweepContinuationV1?
    ) throws {
        guard cutoffAtMilliseconds >= 0,
              cutoffAtMilliseconds
                <= LocalIncidentLedgerV1.maximumTimestampMilliseconds else {
            throw IncidentLedgerErrorV1.invalidInput(
                "Retention-sweep cutoff is outside the admitted contract."
            )
        }
        let continuationMatchesPage = continuation.map {
            return $0.claims.scopeID == scope.scopeID
                && $0.claims.projectDigest == scope.projectDigest
                && $0.claims.accessPolicyDigest == scope.accessPolicyDigest
                && $0.claims.retentionPolicyDigest == scope.retentionPolicyDigest
                && $0.cutoffAtMilliseconds == cutoffAtMilliseconds
                && $0.initialEventHighWatermark == initialEventHighWatermark
                && $0.batchSize == batchSize
        } ?? true
        let tombstonesMatchSweep = tombstones.allSatisfy {
            $0.retentionPolicyDigest == scope.retentionPolicyDigest
                && $0.reason == .retentionReviewDue
                && !$0.authorizing
                && !$0.protectedAuthorityVerified
                && !$0.rawContentStored
                && !$0.physicalErasurePerformed
        }
        guard
            initialEventHighWatermark >= 0,
            initialEventHighWatermark <= LocalIncidentLedgerV1.maximumEventsPerProject,
            (1...LocalIncidentLedgerV1.maximumRetentionSweepPageSize).contains(batchSize),
            processedObservationCount >= 0,
            processedObservationCount <= batchSize,
            appendedTombstoneCount >= 0,
            appendedTombstoneCount <= processedObservationCount,
            replayedTombstoneCount >= 0,
            replayedTombstoneCount <= processedObservationCount,
            processedObservationCount == appendedTombstoneCount + replayedTombstoneCount,
            processedObservationCount == tombstones.count,
            continuation == nil || processedObservationCount == batchSize,
            continuationMatchesPage,
            tombstonesMatchSweep
        else {
            throw IncidentLedgerErrorV1.invalidInput(
                "Retention-sweep page fields are outside the admitted contract."
            )
        }
        self.scope = scope
        self.cutoffAtMilliseconds = cutoffAtMilliseconds
        self.cutoffAt = Date(
            timeIntervalSince1970: TimeInterval(cutoffAtMilliseconds) / 1_000
        )
        self.initialEventHighWatermark = initialEventHighWatermark
        self.batchSize = batchSize
        self.processedObservationCount = processedObservationCount
        self.appendedTombstoneCount = appendedTombstoneCount
        self.replayedTombstoneCount = replayedTombstoneCount
        self.tombstones = tombstones
        self.continuation = continuation
        self.authorizing = false
        self.certified = false
        self.protectedAuthorityVerified = false
        self.rawContentStored = false
        self.physicalErasurePerformed = false
        self.limitationCodes = Self.limitationCodes
    }
}

public enum IncidentLedgerErrorV1: Error, Equatable, LocalizedError, Sendable {
    case invalidInput(String)
    case unsupportedStorage
    case closed
    case sqlite(code: Int32, message: String)
    case integrity(String)
    case namespaceObservation(IncidentNamespaceRefusalV1)
    case observationConflict
    case incidentIDConflict
    case capacityExceeded
    case admissionRevoked
    case incidentNotFound
    case subjectMismatch
    case selectionMismatch
    case incidentTombstoned
    case tombstoneConflict
    case retentionNotDue
    case retentionDeadlineMissing
    case retentionPolicyMismatch
    case exportEncodingFailed

    public var isNamespaceOrIntegrityRefusal: Bool {
        switch self {
        case .integrity, .namespaceObservation: true
        default: false
        }
    }

    public var errorDescription: String? {
        switch self {
        case let .invalidInput(message): message
        case .unsupportedStorage:
            "Founder Alpha incident history requires a local writable volume."
        case .closed: "The incident ledger is closed."
        case let .sqlite(code, message): "SQLite error \(code): \(message)"
        case let .integrity(message): "Incident-ledger integrity failure: \(message)"
        case .namespaceObservation:
            "Incident history refused: its directory changed or namespace observation became unavailable. Reopen only after reviewing the store."
        case .observationConflict:
            "The observation identity is already bound to different canonical bytes."
        case .incidentIDConflict:
            "The incident identity is already bound to a different observation."
        case .capacityExceeded:
            "The bounded incident ledger has reached its per-project event capacity."
        case .admissionRevoked: "The incident write admission was revoked."
        case .incidentNotFound: "The requested incident does not exist."
        case .subjectMismatch: "The requested incident belongs to a different subject digest."
        case .selectionMismatch: "The requested incident selection does not match the stored event."
        case .incidentTombstoned: "The requested incident has already been logically deleted."
        case .tombstoneConflict: "The incident already has a different deletion tombstone."
        case .retentionNotDue: "The incident retention-review time is not due."
        case .retentionDeadlineMissing: "The incident has no retention-review time."
        case .retentionPolicyMismatch: "The deletion request does not match the ledger retention policy."
        case .exportEncodingFailed: "The redacted incident export could not be encoded canonically."
        }
    }
}

/// Revocable authority for one non-authorizing incident lifecycle mutation.
///
/// A coordinator invalidates this control synchronously before OFF, suspend,
/// shutdown, or quarantine. The ledger linearizes the final SQLite COMMIT under
/// the same lock, so lifecycle revocation cannot land between the last check and
/// publication of a tombstone.
public final class IncidentLifecycleMutationControlV1: @unchecked Sendable {
    private let lock = NSLock()
    private var generation: UInt64 = 0
    private var invalidationCount: UInt64 = 0

    public init() {}

    public func issueAdmission() -> IncidentLifecycleMutationAdmissionV1? {
        lock.withLock {
            guard generation < .max else { return nil }
            return IncidentLifecycleMutationAdmissionV1(
                control: self,
                generation: generation
            )
        }
    }

    public func invalidatePendingMutations() {
        lock.withLock {
            if invalidationCount < .max { invalidationCount += 1 }
            if generation < .max { generation += 1 }
        }
    }

    func invalidationCountForTesting() -> UInt64 {
        lock.withLock { invalidationCount }
    }

    fileprivate func isCurrent(generation expected: UInt64) -> Bool {
        lock.withLock { generation == expected && generation < .max }
    }

    fileprivate func commitIfCurrent(
        generation expected: UInt64,
        _ operation: () throws -> Void
    ) throws -> Bool {
        try lock.withLock {
            guard generation == expected, generation < .max else { return false }
            try operation()
            return true
        }
    }
}

public struct IncidentLifecycleMutationAdmissionV1: Sendable {
    private let control: IncidentLifecycleMutationControlV1
    private let generation: UInt64

    fileprivate init(
        control: IncidentLifecycleMutationControlV1,
        generation: UInt64
    ) {
        self.control = control
        self.generation = generation
    }

    fileprivate var isCurrent: Bool {
        control.isCurrent(generation: generation)
    }

    fileprivate func commitIfCurrent(
        _ operation: () throws -> Void
    ) throws -> Bool {
        try control.commitIfCurrent(generation: generation, operation)
    }
}

enum IncidentLedgerFaultPointV1: Sendable {
    case afterEventInsertBeforeMetadataUpdate
    case afterTombstoneInsertBeforeMetadataUpdate
    case beforeTombstoneCommit
    case beforeRollback
    case duringFirstOpenAfterSchemaInitialization
}

/// Exact synchronous lifecycle boundaries used only by coherent-replacement
/// limitation fixtures. Public and production opens always provide `nil`.
///
/// The callback receives no SQLite handle and cannot alter production policy. A
/// fixture may temporarily change only its disposable test namespace, must restore
/// any ABA substitution before returning, and must throw on an incomplete barrier.
enum IncidentLedgerReplacementBaselinePointV1: Sendable {
    case afterProjectDirectoryIdentityBeforeOpenLock
    case afterProjectOpenLockBeforeStoreInspection
    case afterFinalIdentityCheckBeforeCommit
    case afterCloseIdentityReattestationBeforeNamedMainCheckpoint
}

/// Package-only process-isolation barriers for the CR-01 open-time ABA
/// falsification fixture. The callback is synchronous and nonthrowing so the
/// private helper can pause on each side of `sqlite3_open_v2` while a parent
/// process owns mutation, timeout, kill, reap, and recovery. Public and normal
/// test opens always provide `nil`; the callback receives no SQLite handle.
package enum IncidentLedgerOpenABAProcessPointV1: Sendable {
    case beforeSQLiteOpen
    case afterSQLiteOpen
}

/// Internal evidence from the most recent explicit close-checkpoint attempt.
///
/// This is test instrumentation, not certification metadata. A synthetic result
/// is always marked so a refusal-path fixture cannot be reported as an observed
/// SQLite runtime outcome.
struct IncidentLedgerCheckpointAttemptV1: Equatable, Sendable {
    let databaseName: String
    let mode: Int32
    let resultCode: Int32
    let logFrames: Int32
    let checkpointedFrames: Int32
    let synthetic: Bool
}

/// Bounded, one-shot test input for contradictory or otherwise impractical
/// checkpoint outcomes. Production opens never receive this value.
struct IncidentLedgerSyntheticCheckpointOutcomeV1: Sendable {
    let resultCode: Int32
    let logFrames: Int32
    let checkpointedFrames: Int32
}

/// Package-only process-loss observation points used by the private crash helper.
///
/// This is deliberately separate from the throwing test fault injector. In
/// particular, the post-COMMIT point cannot throw and therefore cannot turn a
/// durable publication into a reported rollback failure.
package enum IncidentLedgerAbruptProcessPointV1: String, CaseIterable, Sendable {
    case beforeObservationBegin
    case afterObservationBeginBeforeWrite
    case beforeObservationCommit
    case afterObservationCommitBeforeReturn
}

fileprivate struct IncidentFileIdentityV1: Equatable, Sendable {
    let device: dev_t
    let inode: ino_t

    var canonicalDeviceID: UInt64 {
        UInt64(UInt32(bitPattern: device))
    }

    var canonicalInodeID: UInt64 {
        UInt64(inode)
    }
}

private struct StoredIncidentEventV1: Equatable, Sendable {
    let ordinal: Int64
    let eventID: String
    let incidentID: String
    let incidentDigest: String
    let observationKey: String
    let subjectIDDigest: String
    let subjectContentDigest: String
    let evidenceSetDigest: String
    let predecessorDigest: String
    let eventDigest: String
    let observedAtMilliseconds: Int64
    let retentionReviewAtMilliseconds: Int64?
    let failureCodes: [IncidentFailureCodeV1]
    let symptomCodes: [IncidentSymptomCodeV1]
}

private struct StoredIncidentTombstoneV1: Equatable, Sendable {
    let ordinal: Int64
    let eventID: String
    let incidentID: String
    let targetIncidentDigest: String
    let targetEventDigest: String
    let subjectIDDigest: String
    let subjectContentDigest: String
    let retentionPolicyDigest: String
    let reason: IncidentTombstoneReasonV1
    let predecessorDigest: String
    let eventDigest: String
    let tombstonedAtMilliseconds: Int64
}

private enum StoredLedgerEventV1: Equatable, Sendable {
    case observation(StoredIncidentEventV1)
    case tombstone(StoredIncidentTombstoneV1)

    var ordinal: Int64 {
        switch self {
        case .observation(let event): event.ordinal
        case .tombstone(let event): event.ordinal
        }
    }

    var predecessorDigest: String {
        switch self {
        case .observation(let event): event.predecessorDigest
        case .tombstone(let event): event.predecessorDigest
        }
    }

    var eventDigest: String {
        switch self {
        case .observation(let event): event.eventDigest
        case .tombstone(let event): event.eventDigest
        }
    }
}

private struct IncidentRedactedExportPayloadV1: Encodable {
    let schemaVersion: Int
    let recordType: String
    let ledgerProfile: String
    let projectDigest: String
    let accessPolicyDigest: String
    let retentionPolicyDigest: String
    let incidentID: String
    let incidentDigest: String
    let observationKey: String
    let subjectIDDigest: String
    let subjectContentDigest: String
    let evidenceSetDigest: String
    let observationEventID: String
    let observationEventDigest: String
    let failureCodes: [String]
    let symptomCodes: [String]
    let observedAtMilliseconds: String
    let retentionReviewAtMilliseconds: String
    let lifecycleState: String
    let tombstoneEventID: String
    let tombstoneEventDigest: String
    let tombstoneReason: String
    let tombstonedAtMilliseconds: String
    let limitationCodes: [String]
    let authorizing: Bool
    let certified: Bool
    let protectedAuthorityVerified: Bool
    let rawContentStored: Bool
    let physicalErasurePerformed: Bool
}

private struct IncidentLedgerMetadataV1: Equatable, Sendable {
    let eventCount: Int64
    let headDigest: String
}

private struct IncidentSchemaObjectV1: Equatable, Sendable {
    let type: String
    let name: String
    let tableName: String
    let normalizedSQL: String
}

private struct IncidentSchemaColumnV1: Equatable, Sendable {
    let name: String
    let type: String
    let notNull: Int64
    let defaultValue: String?
    let primaryKeyPosition: Int64
    let hidden: Int64

    init(
        name: String,
        type: String,
        primaryKeyPosition: Int64,
        hidden: Int64,
        notNull: Int64 = 1,
        defaultValue: String? = nil
    ) {
        self.name = name
        self.type = type
        self.notNull = notNull
        self.defaultValue = defaultValue
        self.primaryKeyPosition = primaryKeyPosition
        self.hidden = hidden
    }
}

private struct IncidentSchemaTableV1: Equatable, Sendable {
    let name: String
    let columnCount: Int64
    let withoutRowID: Int64
    let strict: Int64
}

private struct IncidentSchemaForeignKeyV1: Equatable, Sendable {
    let identifier: Int64
    let sequence: Int64
    let referencedTable: String
    let sourceColumn: String
    let targetColumn: String
    let onUpdate: String
    let onDelete: String
    let match: String
}

private struct IncidentSchemaIndexV1: Equatable, Sendable {
    let unique: Int64
    let origin: String
    let partial: Int64
    let keyColumns: [String]
}

/// SQLite's C pointer is not declared `Sendable`. The box is owned by exactly one
/// ledger actor; its unchecked conformance records that confinement and gives an
/// emergency close if a caller forgets the explicit lifecycle method.
private final class IncidentSQLiteHandleBox: @unchecked Sendable {
    var pointer: OpaquePointer?
    var namespaceObserver: IncidentNamespaceObserverV1?

    init(_ pointer: OpaquePointer) {
        self.pointer = pointer
    }

    deinit {
        namespaceObserver?.stop()
        if let pointer { sqlite3_close_v2(pointer) }
    }
}

public actor LocalIncidentLedgerV1 {
    public static let profile = "veritas-founder-alpha-local-incident-ledger-v1"
    public static let retentionPolicyProfile =
        "veritas-founder-alpha-user-tombstone-and-retention-review-v1"
    public static let retentionPolicyDigest = ArtifactSnapshot.digest(
        Data(retentionPolicyProfile.utf8)
    )

    private static let schemaVersion: Int32 = 3
    private static let maximumCodesPerSet = 32
    public static let maximumEventsPerProject: Int64 = 4_096
    public static let maximumListPageSize = 100
    public static let maximumRetentionSweepPageSize = 100
    static let maximumDatabaseBytes: Int64 = 67_108_864
    private static let maximumSidecarBytes: Int64 = 67_108_864
    private static let admittedSQLitePageSize: Int64 = 4_096
    private static let maximumSQLitePageCount: Int64 = 16_384
    fileprivate static let maximumTimestampMilliseconds: Int64 = 253_402_300_799_999
    private static let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    private static let observationEventType = "OBSERVED_INCONCLUSIVE"
    private static let tombstoneEventType = "TOMBSTONED"
    private static let maximumRedactedExportBytes = 16_384
    private static let limitationCodes = [
        "SAME_USER_PRIVATE_STORAGE_ONLY",
        "HISTORY_NON_AUTHORIZING",
        "NO_PROTECTED_ROLLBACK_ANCHOR",
        "NO_RAW_CONTENT_STORED",
        "EVENT_COUNT_NOT_OCCURRENCE_FREQUENCY",
        "LOGICAL_TOMBSTONE_IS_NOT_PHYSICAL_ERASURE",
        "REDACTED_EXPORT_IS_NOT_ACCEPTANCE_OR_CERTIFICATION",
    ]
    private static let ledgerMetaTableSQL = """
        CREATE TABLE ledger_meta (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            schema_version INTEGER NOT NULL CHECK (schema_version = 3),
            profile TEXT NOT NULL,
            scope_id TEXT NOT NULL,
            project_digest TEXT NOT NULL,
            access_policy_digest TEXT NOT NULL,
            retention_policy_digest TEXT NOT NULL,
            genesis_digest TEXT NOT NULL,
            event_count INTEGER NOT NULL CHECK (event_count >= 0),
            head_digest TEXT NOT NULL,
            authorizing INTEGER NOT NULL CHECK (authorizing = 0),
            protected_authority_verified INTEGER NOT NULL CHECK (protected_authority_verified = 0),
            raw_content_stored INTEGER NOT NULL CHECK (raw_content_stored = 0)
        ) STRICT
        """
    private static let incidentEventsTableSQL = """
        CREATE TABLE incident_events (
            ordinal INTEGER PRIMARY KEY CHECK (ordinal > 0),
            event_id TEXT NOT NULL UNIQUE,
            event_type TEXT NOT NULL CHECK (event_type = 'OBSERVED_INCONCLUSIVE'),
            incident_id TEXT NOT NULL UNIQUE,
            incident_digest TEXT NOT NULL UNIQUE,
            observation_key TEXT NOT NULL UNIQUE,
            subject_id_digest TEXT NOT NULL,
            subject_content_digest TEXT NOT NULL,
            evidence_set_digest TEXT NOT NULL,
            predecessor_digest TEXT NOT NULL,
            event_digest TEXT NOT NULL UNIQUE,
            observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms >= 0),
            retention_review_at_ms INTEGER,
            authorizing INTEGER NOT NULL CHECK (authorizing = 0),
            protected_authority_verified INTEGER NOT NULL CHECK (protected_authority_verified = 0),
            raw_content_stored INTEGER NOT NULL CHECK (raw_content_stored = 0),
            UNIQUE (
                incident_id, incident_digest, event_digest,
                subject_id_digest, subject_content_digest
            )
        ) STRICT
        """
    private static let failureCodesTableSQL = """
        CREATE TABLE incident_failure_codes (
            event_ordinal INTEGER NOT NULL REFERENCES incident_events(ordinal) ON DELETE RESTRICT,
            position INTEGER NOT NULL CHECK (position >= 0),
            code TEXT NOT NULL,
            PRIMARY KEY (event_ordinal, position),
            UNIQUE (event_ordinal, code)
        ) STRICT
        """
    private static let symptomCodesTableSQL = """
        CREATE TABLE incident_symptom_codes (
            event_ordinal INTEGER NOT NULL REFERENCES incident_events(ordinal) ON DELETE RESTRICT,
            position INTEGER NOT NULL CHECK (position >= 0),
            code TEXT NOT NULL,
            PRIMARY KEY (event_ordinal, position),
            UNIQUE (event_ordinal, code)
        ) STRICT
        """
    private static let incidentTombstonesTableSQL = """
        CREATE TABLE incident_tombstones (
            ordinal INTEGER PRIMARY KEY CHECK (ordinal > 0),
            event_id TEXT NOT NULL UNIQUE,
            event_type TEXT NOT NULL CHECK (event_type = 'TOMBSTONED'),
            incident_id TEXT NOT NULL UNIQUE,
            target_incident_digest TEXT NOT NULL,
            target_event_digest TEXT NOT NULL,
            subject_id_digest TEXT NOT NULL,
            subject_content_digest TEXT NOT NULL,
            retention_policy_digest TEXT NOT NULL,
            reason_code TEXT NOT NULL CHECK (
                reason_code IN ('USER_REQUESTED', 'RETENTION_REVIEW_DUE')
            ),
            predecessor_digest TEXT NOT NULL,
            event_digest TEXT NOT NULL UNIQUE,
            tombstoned_at_ms INTEGER NOT NULL CHECK (tombstoned_at_ms >= 0),
            authorizing INTEGER NOT NULL CHECK (authorizing = 0),
            protected_authority_verified INTEGER NOT NULL CHECK (protected_authority_verified = 0),
            raw_content_stored INTEGER NOT NULL CHECK (raw_content_stored = 0),
            physical_erasure_performed INTEGER NOT NULL CHECK (physical_erasure_performed = 0),
            FOREIGN KEY (
                incident_id, target_incident_digest, target_event_digest,
                subject_id_digest, subject_content_digest
            ) REFERENCES incident_events (
                incident_id, incident_digest, event_digest,
                subject_id_digest, subject_content_digest
            ) ON DELETE RESTRICT
        ) STRICT
        """

    public nonisolated let scope: IncidentLedgerScopeV1
    public nonisolated let databaseURL: URL

    private let handleBox: IncidentSQLiteHandleBox
    private var namespaceObservationRequired = false
    private var namespaceCloseProbeForTesting: (@Sendable (Bool) throws -> Void)?
    /// The primary-file identity is observed and rechecked during this exact open;
    /// the project-directory identity is observed before SQLite opens. Both are
    /// rechecked at later ledger operation boundaries. These same-user bindings are
    /// current-path drift detectors, not open-time race protection, protected path,
    /// rollback, or replacement authority.
    private let databaseFileIdentity: IncidentFileIdentityV1
    private let projectDirectoryIdentity: IncidentFileIdentityV1
    private let genesisDigest: String
    private let faultInjector: (@Sendable (IncidentLedgerFaultPointV1) throws -> Void)?
    private let replacementBaselineProbe:
        (@Sendable (IncidentLedgerReplacementBaselinePointV1) throws -> Void)?
    private let abruptProcessProbe: (@Sendable (IncidentLedgerAbruptProcessPointV1) -> Void)?
    private let automaticCheckpointReadbackOverrideForTesting: Int64?
    private let eventCapacity: Int64
    private let clock: @Sendable () -> Date
    /// Once this actor observes current-path drift, it never resumes ledger work.
    /// This remembers an observed mismatch but does not detect unobserved ABA swaps.
    private var currentPathIntegrityRefused = false
    /// A failed rollback permanently removes this actor from the usable surface,
    /// even if SQLite cannot confirm immediate handle closure.
    private var transactionIntegrityPoisoned = false
    /// Consumed by the first close attempt only. The next attempt exercises the
    /// real SQLite API so refusal-path tests can prove retry behavior.
    private var syntheticCheckpointOutcomeForTesting: IncidentLedgerSyntheticCheckpointOutcomeV1?
    private var latestCheckpointAttemptForTestingValue: IncidentLedgerCheckpointAttemptV1?

    private var database: OpaquePointer? {
        get { handleBox.pointer }
        set { handleBox.pointer = newValue }
    }

    public static func open(
        rootDirectory: URL,
        scope: IncidentLedgerScopeV1
    ) async throws -> LocalIncidentLedgerV1 {
        try await openInternal(
            rootDirectory: rootDirectory,
            scope: scope,
            eventCapacity: maximumEventsPerProject,
            faultInjector: nil,
            openABAProcessProbe: nil,
            replacementBaselineProbe: nil,
            abruptProcessProbe: nil,
            automaticCheckpointReadbackOverrideForTesting: nil,
            syntheticCheckpointOutcomeForTesting: nil,
            clock: { Date() }
        )
    }

    static func openForTesting(
        rootDirectory: URL,
        scope: IncidentLedgerScopeV1,
        eventCapacity: Int64 = maximumEventsPerProject,
        clock: @escaping @Sendable () -> Date = { Date() },
        faultInjector: @escaping @Sendable (IncidentLedgerFaultPointV1) throws -> Void
    ) async throws -> LocalIncidentLedgerV1 {
        try await openInternal(
            rootDirectory: rootDirectory,
            scope: scope,
            eventCapacity: eventCapacity,
            faultInjector: faultInjector,
            openABAProcessProbe: nil,
            replacementBaselineProbe: nil,
            abruptProcessProbe: nil,
            automaticCheckpointReadbackOverrideForTesting: nil,
            syntheticCheckpointOutcomeForTesting: nil,
            clock: clock
        )
    }

    /// Dedicated checkpoint-control fixture entry point. It is internal to the
    /// module and keeps synthetic policy/results out of the public open surface.
    static func openForCheckpointTesting(
        rootDirectory: URL,
        scope: IncidentLedgerScopeV1,
        automaticCheckpointReadbackOverride: Int64? = nil,
        syntheticCheckpointOutcome: IncidentLedgerSyntheticCheckpointOutcomeV1? = nil
    ) async throws -> LocalIncidentLedgerV1 {
        try await openInternal(
            rootDirectory: rootDirectory,
            scope: scope,
            eventCapacity: maximumEventsPerProject,
            faultInjector: nil,
            openABAProcessProbe: nil,
            replacementBaselineProbe: nil,
            abruptProcessProbe: nil,
            automaticCheckpointReadbackOverrideForTesting: automaticCheckpointReadbackOverride,
            syntheticCheckpointOutcomeForTesting: syntheticCheckpointOutcome,
            clock: { Date() }
        )
    }

    /// Dedicated package-internal entry point for deterministic Baseline B
    /// barriers. The seam is absent from public/production opens and supplies no
    /// favorable product state or security authority.
    /// Historical pre-namespace-observer profile: preserves the original SQLite
    /// outcome experiment, NOT current production protection or acceptance.
    static func openForCoherentReplacementBaselineTesting(
        rootDirectory: URL,
        scope: IncidentLedgerScopeV1,
        replacementBaselineProbe:
            @escaping @Sendable (IncidentLedgerReplacementBaselinePointV1) throws -> Void
    ) async throws -> LocalIncidentLedgerV1 {
        try await openInternal(
            rootDirectory: rootDirectory,
            scope: scope,
            eventCapacity: maximumEventsPerProject,
            faultInjector: nil,
            openABAProcessProbe: nil,
            replacementBaselineProbe: replacementBaselineProbe,
            abruptProcessProbe: nil,
            automaticCheckpointReadbackOverrideForTesting: nil,
            syntheticCheckpointOutcomeForTesting: nil,
            observeNamespace: false,
            clock: { Date() }
        )
    }

    /// Test-only current-profile barrier; unlike the historical factory, this
    /// keeps namespace observation enabled and returns no handle or authority.
    static func openForNamespaceObservationTesting(
        rootDirectory: URL,
        scope: IncidentLedgerScopeV1,
        beforeCheckpoint: @escaping @Sendable () throws -> Void = {},
        closeProbe: (@Sendable (Bool) throws -> Void)? = nil
    ) async throws -> LocalIncidentLedgerV1 {
        let ledger = try await openInternal(
            rootDirectory: rootDirectory, scope: scope,
            eventCapacity: maximumEventsPerProject, faultInjector: nil,
            openABAProcessProbe: nil,
            replacementBaselineProbe: { point in
                if point == .afterCloseIdentityReattestationBeforeNamedMainCheckpoint {
                    try beforeCheckpoint()
                }
            },
            abruptProcessProbe: nil, automaticCheckpointReadbackOverrideForTesting: nil,
            syntheticCheckpointOutcomeForTesting: nil, clock: { Date() }
        )
        await ledger.setNamespaceCloseProbeForTesting(closeProbe)
        return ledger
    }

    private func setNamespaceCloseProbeForTesting(_ probe: (@Sendable (Bool) throws -> Void)?) {
        namespaceCloseProbeForTesting = probe
    }

    func namespaceObserverForTesting() -> IncidentNamespaceObserverV1? { handleBox.namespaceObserver }
    func dropNamespaceObserverForTesting() { handleBox.namespaceObserver = nil }

    /// Package-only CR-03 process barrier. The private helper gets no SQLite
    /// handle, synthetic result, or public execution authority. Normal opens
    /// still supply no probe. The callback must be bounded and one-shot.
    package static func openForCommitABAFixture(
        rootDirectory: URL,
        scope: IncidentLedgerScopeV1,
        beforeCommit: @escaping @Sendable () -> Void
    ) async throws -> LocalIncidentLedgerV1 {
        try await openForCoherentReplacementBaselineTesting(
            rootDirectory: rootDirectory,
            scope: scope,
            replacementBaselineProbe: { point in
                if case .afterFinalIdentityCheckBeforeCommit = point { beforeCommit() }
            }
        )
    }

    /// Dedicated package-only CR-01 entry point. Only the non-product helper
    /// target can span the actual SQLite open call; no handle or favorable state
    /// is exposed to the parent test runner.
    package static func openForOpenABAFixture(
        rootDirectory: URL,
        scope: IncidentLedgerScopeV1,
        openABAProcessProbe:
            @escaping @Sendable (IncidentLedgerOpenABAProcessPointV1) -> Void
    ) async throws -> LocalIncidentLedgerV1 {
        try await openInternal(
            rootDirectory: rootDirectory,
            scope: scope,
            eventCapacity: maximumEventsPerProject,
            faultInjector: nil,
            openABAProcessProbe: openABAProcessProbe,
            replacementBaselineProbe: nil,
            abruptProcessProbe: nil,
            automaticCheckpointReadbackOverrideForTesting: nil,
            syntheticCheckpointOutcomeForTesting: nil,
            clock: { Date() }
        )
    }

    package static func openForAbruptRestartFixture(
        rootDirectory: URL,
        scope: IncidentLedgerScopeV1,
        abruptProcessProbe: @escaping @Sendable (IncidentLedgerAbruptProcessPointV1) -> Void
    ) async throws -> LocalIncidentLedgerV1 {
        try await openInternal(
            rootDirectory: rootDirectory,
            scope: scope,
            eventCapacity: maximumEventsPerProject,
            faultInjector: nil,
            openABAProcessProbe: nil,
            replacementBaselineProbe: nil,
            abruptProcessProbe: abruptProcessProbe,
            automaticCheckpointReadbackOverrideForTesting: nil,
            syntheticCheckpointOutcomeForTesting: nil,
            clock: { Date() }
        )
    }

    private static func openInternal(
        rootDirectory: URL,
        scope: IncidentLedgerScopeV1,
        eventCapacity: Int64,
        faultInjector: (@Sendable (IncidentLedgerFaultPointV1) throws -> Void)?,
        openABAProcessProbe:
            (@Sendable (IncidentLedgerOpenABAProcessPointV1) -> Void)?,
        replacementBaselineProbe:
            (@Sendable (IncidentLedgerReplacementBaselinePointV1) throws -> Void)?,
        abruptProcessProbe: (@Sendable (IncidentLedgerAbruptProcessPointV1) -> Void)?,
        automaticCheckpointReadbackOverrideForTesting: Int64?,
        syntheticCheckpointOutcomeForTesting: IncidentLedgerSyntheticCheckpointOutcomeV1?,
        observeNamespace: Bool = true,
        clock: @escaping @Sendable () -> Date
    ) async throws -> LocalIncidentLedgerV1 {
        try Self.validate(scope: scope)
        guard eventCapacity > 0, eventCapacity <= maximumEventsPerProject else {
            throw IncidentLedgerErrorV1.invalidInput("Incident event capacity is outside the admitted range.")
        }

        guard rootDirectory.isFileURL else {
            throw IncidentLedgerErrorV1.unsupportedStorage
        }
        // Resolve only the caller-selected existing root. Every controlled
        // descendant is then created and checked without following symlinks.
        let admittedRoot = rootDirectory.resolvingSymlinksInPath().standardizedFileURL
        try Self.requireDirectoryWithoutSymlink(at: admittedRoot)

        let rootValues = try admittedRoot.resourceValues(forKeys: [
            .isDirectoryKey,
            .volumeIsLocalKey,
            .volumeIsReadOnlyKey,
        ])
        guard
            rootValues.isDirectory == true,
            rootValues.volumeIsLocal == true,
            rootValues.volumeIsReadOnly != true
        else {
            throw IncidentLedgerErrorV1.unsupportedStorage
        }

        let projectsDirectory = admittedRoot.appendingPathComponent("projects", isDirectory: true)
        let projectDirectory = projectsDirectory.appendingPathComponent(
            scope.projectDigest,
            isDirectory: true
        )
        guard
            Self.isStrictDescendant(projectsDirectory, of: admittedRoot),
            Self.isStrictDescendant(projectDirectory, of: admittedRoot)
        else {
            throw IncidentLedgerErrorV1.unsupportedStorage
        }
        try Self.createOrHardenPrivateDirectory(at: projectsDirectory)
        try Self.createOrHardenPrivateDirectory(at: projectDirectory)
        let projectDirectoryIdentity = try Self.validatedPrivateDirectoryIdentity(
            at: projectDirectory
        )
        try replacementBaselineProbe?(.afterProjectDirectoryIdentityBeforeOpenLock)

        let databaseURL = projectDirectory.appendingPathComponent(
            "incident-ledger-v1.sqlite3",
            isDirectory: false
        )
        guard Self.isStrictDescendant(databaseURL, of: admittedRoot) else {
            throw IncidentLedgerErrorV1.unsupportedStorage
        }
        // Cooperative same-version serialization prevents failed-first-open cleanup
        // from unlinking a store concurrently opened by another conforming process.
        // Locking the admitted project-directory descriptor adds no inventory file.
        // It is not authority and does not resist same-user directory replacement.
        var openLockDescriptor: Int32? = try Self.acquireProjectOpenLock(
            at: projectDirectory
        )
        defer {
            if let descriptor = openLockDescriptor {
                Self.releaseProjectOpenLockAfterFailure(descriptor)
            }
        }
        try replacementBaselineProbe?(.afterProjectOpenLockBeforeStoreInspection)
        let existedBeforeOpen = try Self.fileStatusIfPresent(at: databaseURL) != nil
        let sidecarURLs = [
            URL(fileURLWithPath: databaseURL.path + "-wal"),
            URL(fileURLWithPath: databaseURL.path + "-shm"),
        ]
        let newlyCreatedIdentity: IncidentFileIdentityV1?
        let openingIdentity: IncidentFileIdentityV1
        if existedBeforeOpen {
            newlyCreatedIdentity = nil
            openingIdentity = try Self.hardenPrivateRegularFile(at: databaseURL)
            try Self.requireAdmittedFileSize(
                at: databaseURL,
                maximumBytes: maximumDatabaseBytes
            )
            for sidecarURL in sidecarURLs {
                if try Self.fileStatusIfPresent(at: sidecarURL) != nil {
                    try Self.hardenPrivateRegularFile(at: sidecarURL)
                    try Self.requireAdmittedFileSize(
                        at: sidecarURL,
                        maximumBytes: maximumSidecarBytes
                    )
                }
            }
        } else {
            var orphanedSidecarExists = false
            for sidecarURL in sidecarURLs where try Self.fileStatusIfPresent(at: sidecarURL) != nil {
                orphanedSidecarExists = true
            }
            guard !orphanedSidecarExists else {
                throw IncidentLedgerErrorV1.integrity(
                    "Ledger sidecars exist without the primary database."
                )
            }
            let createdIdentity = try Self.securelyCreatePrivateFile(at: databaseURL)
            newlyCreatedIdentity = createdIdentity
            openingIdentity = createdIdentity
        }

        openABAProcessProbe?(.beforeSQLiteOpen)
        var handle: OpaquePointer?
        let openResult = sqlite3_open_v2(
            databaseURL.path,
            &handle,
            // The controlled descendants were lstat-checked and the primary
            // file was created with O_NOFOLLOW. SQLITE_OPEN_NOFOLLOW is not
            // used because the observed system SQLite/SwiftPM runtime refuses
            // WAL activation with that flag. Same-user path-swap races remain
            // outside the Founder Alpha trust claim.
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
            nil
        )
        if openResult == SQLITE_OK, handle != nil {
            openABAProcessProbe?(.afterSQLiteOpen)
        }
        guard openResult == SQLITE_OK, let handle else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "open failed"
            let closureConfirmed: Bool
            if let handle {
                closureConfirmed = sqlite3_close_v2(handle) == SQLITE_OK
            } else {
                closureConfirmed = true
            }
            if let newlyCreatedIdentity, closureConfirmed {
                try Self.removeFailedNewStoreIfUnchanged(
                    databaseURL: databaseURL,
                    expectedIdentity: newlyCreatedIdentity
                )
            }
            guard closureConfirmed else {
                throw IncidentLedgerErrorV1.integrity(
                    "SQLite open failed and handle closure was not confirmed; first-open cleanup was refused."
                )
            }
            throw IncidentLedgerErrorV1.sqlite(code: openResult, message: message)
        }

        // Disable SQLite's implicit last-connection WAL checkpoint for the entire
        // handle lifetime. Each eligible clean-close attempt performs an explicit
        // named-main checkpoint after current-path identity re-attestation;
        // observed drift can therefore close the actor-held handle without asking
        // this connection to checkpoint an ambiguous pathname.
        var noCheckpointOnCloseEnabled: Int32 = 0
        let noCheckpointResult = veritas_sqlite3_enable_no_checkpoint_on_close(
            handle,
            &noCheckpointOnCloseEnabled
        )
        guard noCheckpointResult == SQLITE_OK, noCheckpointOnCloseEnabled == 1 else {
            let closeResult = sqlite3_close_v2(handle)
            guard closeResult == SQLITE_OK else {
                throw IncidentLedgerErrorV1.integrity(
                    "SQLite close-checkpoint suppression failed and the close request was not accepted."
                )
            }
            if let newlyCreatedIdentity {
                try Self.removeFailedNewStoreIfUnchanged(
                    databaseURL: databaseURL,
                    expectedIdentity: newlyCreatedIdentity
                )
            }
            throw IncidentLedgerErrorV1.integrity(
                "SQLite close-checkpoint suppression is required by the admitted ledger profile."
            )
        }

        // NO_CKPT_ON_CLOSE controls only SQLite's implicit last-close behavior.
        // Disable commit-triggered WAL auto-checkpoints independently on this
        // exact actor-held connection before bootstrap can publish any schema or
        // ledger transaction. The same handle is read back after WAL admission.
        let automaticCheckpointResult = sqlite3_wal_autocheckpoint(handle, 0)
        guard automaticCheckpointResult == SQLITE_OK else {
            let closeResult = sqlite3_close_v2(handle)
            guard closeResult == SQLITE_OK else {
                throw IncidentLedgerErrorV1.integrity(
                    "SQLite automatic-checkpoint suppression failed and the close request was not accepted."
                )
            }
            if let newlyCreatedIdentity {
                try Self.removeFailedNewStoreIfUnchanged(
                    databaseURL: databaseURL,
                    expectedIdentity: newlyCreatedIdentity
                )
            }
            throw IncidentLedgerErrorV1.integrity(
                "SQLite automatic WAL checkpoint suppression is required by the admitted ledger profile."
            )
        }

        let databaseFileIdentity: IncidentFileIdentityV1
        do {
            databaseFileIdentity = try Self.validatedPrivateRegularFileIdentity(
                at: databaseURL
            )
            guard databaseFileIdentity == openingIdentity else {
                throw IncidentLedgerErrorV1.integrity(
                    "Primary ledger file identity changed while the database was opening."
                )
            }
        } catch {
            let identityError = error
            let closeResult = sqlite3_close_v2(handle)
            guard closeResult == SQLITE_OK else {
                throw IncidentLedgerErrorV1.integrity(
                    "Primary identity validation failed and SQLite closure was not confirmed; first-open cleanup was refused."
                )
            }
            if let newlyCreatedIdentity {
                try Self.removeFailedNewStoreIfUnchanged(
                    databaseURL: databaseURL,
                    expectedIdentity: newlyCreatedIdentity
                )
            }
            throw identityError
        }

        let genesisDigest = VeritasDigestFrameV1.digest(
            domain: "veritas-founder-alpha-incident-ledger-genesis-v1",
            fields: [
                Self.profile,
                scope.scopeID,
                scope.projectDigest,
                scope.accessPolicyDigest,
                scope.retentionPolicyDigest,
            ]
        )
        let ledger = LocalIncidentLedgerV1(
            scope: scope,
            databaseURL: databaseURL,
            database: handle,
            databaseFileIdentity: databaseFileIdentity,
            projectDirectoryIdentity: projectDirectoryIdentity,
            genesisDigest: genesisDigest,
            eventCapacity: eventCapacity,
            faultInjector: faultInjector,
            replacementBaselineProbe: replacementBaselineProbe,
            abruptProcessProbe: abruptProcessProbe,
            automaticCheckpointReadbackOverrideForTesting: automaticCheckpointReadbackOverrideForTesting,
            syntheticCheckpointOutcomeForTesting: syntheticCheckpointOutcomeForTesting,
            clock: clock
        )
        do {
            try await ledger.bootstrap(existedBeforeOpen: existedBeforeOpen)
            if observeNamespace { try await ledger.installNamespaceObserver() }
        } catch {
            let bootstrapError = error
            do {
                try await ledger.abortOpen()
            } catch let closeError {
                throw closeError
            }
            if let newlyCreatedIdentity {
                try Self.removeFailedNewStoreIfUnchanged(
                    databaseURL: databaseURL,
                    expectedIdentity: newlyCreatedIdentity
                )
            }
            throw bootstrapError
        }
        guard let descriptor = openLockDescriptor else {
            throw IncidentLedgerErrorV1.integrity(
                "Project open coordination was lost before successful return."
            )
        }
        // Clear ownership before the one attempted release so a close failure is
        // never retried by the defer path.
        openLockDescriptor = nil
        try Self.releaseProjectOpenLock(descriptor)
        return ledger
    }

    private init(
        scope: IncidentLedgerScopeV1,
        databaseURL: URL,
        database: OpaquePointer,
        databaseFileIdentity: IncidentFileIdentityV1,
        projectDirectoryIdentity: IncidentFileIdentityV1,
        genesisDigest: String,
        eventCapacity: Int64,
        faultInjector: (@Sendable (IncidentLedgerFaultPointV1) throws -> Void)?,
        replacementBaselineProbe:
            (@Sendable (IncidentLedgerReplacementBaselinePointV1) throws -> Void)?,
        abruptProcessProbe: (@Sendable (IncidentLedgerAbruptProcessPointV1) -> Void)?,
        automaticCheckpointReadbackOverrideForTesting: Int64?,
        syntheticCheckpointOutcomeForTesting: IncidentLedgerSyntheticCheckpointOutcomeV1?,
        clock: @escaping @Sendable () -> Date
    ) {
        self.scope = scope
        self.databaseURL = databaseURL
        self.handleBox = IncidentSQLiteHandleBox(database)
        self.databaseFileIdentity = databaseFileIdentity
        self.projectDirectoryIdentity = projectDirectoryIdentity
        self.genesisDigest = genesisDigest
        self.eventCapacity = eventCapacity
        self.faultInjector = faultInjector
        self.replacementBaselineProbe = replacementBaselineProbe
        self.abruptProcessProbe = abruptProcessProbe
        self.automaticCheckpointReadbackOverrideForTesting = automaticCheckpointReadbackOverrideForTesting
        self.syntheticCheckpointOutcomeForTesting = syntheticCheckpointOutcomeForTesting
        self.clock = clock
    }

    private func bootstrap(existedBeforeOpen: Bool) throws {
        try execute("PRAGMA busy_timeout=2500;")
        try execute("PRAGMA foreign_keys=ON;")
        try execute("PRAGMA trusted_schema=OFF;")
        guard try scalarInt64("PRAGMA page_size;") == Self.admittedSQLitePageSize else {
            throw IncidentLedgerErrorV1.integrity("SQLite page size is outside the admitted profile.")
        }
        guard try scalarInt64(
            "PRAGMA max_page_count=\(Self.maximumSQLitePageCount);"
        ) == Self.maximumSQLitePageCount else {
            throw IncidentLedgerErrorV1.integrity("SQLite page-count cap could not be enforced.")
        }
        let journalMode = try scalarText("PRAGMA journal_mode=WAL;").lowercased()
        guard journalMode == "wal" else {
            throw IncidentLedgerErrorV1.integrity("WAL mode was not admitted.")
        }
        let actualAutomaticCheckpointThreshold = try scalarInt64(
            "PRAGMA wal_autocheckpoint;"
        )
        let admittedAutomaticCheckpointThreshold =
            automaticCheckpointReadbackOverrideForTesting
            ?? actualAutomaticCheckpointThreshold
        guard
            actualAutomaticCheckpointThreshold == 0,
            admittedAutomaticCheckpointThreshold == 0
        else {
            throw IncidentLedgerErrorV1.integrity(
                "SQLite automatic-checkpoint suppression could not be read back on the admitted connection."
            )
        }
        try applyPrivateFileModes()
        try execute("PRAGMA synchronous=FULL;")

        let userVersion = try scalarInt64("PRAGMA user_version;")
        if userVersion == 0 {
            guard !existedBeforeOpen else {
                throw IncidentLedgerErrorV1.integrity(
                    "An existing unversioned database is never initialized in place."
                )
            }
            try initializeSchema()
            try faultInjector?(.duringFirstOpenAfterSchemaInitialization)
        } else if userVersion != Int64(Self.schemaVersion) {
            throw IncidentLedgerErrorV1.integrity(
                "Unsupported legacy or future schema version \(userVersion); no in-place reinterpretation is allowed."
            )
        }
        _ = try verifyIntegrityInternal()
    }

    private func abortOpen() throws {
        guard let database else { return }
        let observerError = handleBox.namespaceObserver?.stop()
        let closeResult = sqlite3_close_v2(database)
        // Never retry an indeterminate failed-open close through the handle-box
        // destructor. The path is retained and cleanup is refused in that case.
        self.database = nil
        guard closeResult == SQLITE_OK else {
            throw IncidentLedgerErrorV1.integrity(
                "Failed-open SQLite closure was not confirmed; first-open cleanup was refused."
            )
        }
        if let observerError { throw IncidentLedgerErrorV1.namespaceObservation(observerError) }
    }

    private func installNamespaceObserver() throws {
        try requireOpenedDatabaseFileIdentity()
        namespaceObservationRequired = true
        do {
            handleBox.namespaceObserver = try IncidentNamespaceObserverV1(
                directoryURL: databaseURL.deletingLastPathComponent(),
                device: projectDirectoryIdentity.device, inode: projectDirectoryIdentity.inode
            )
            try requireOpenedDatabaseFileIdentity()
        } catch let error as IncidentNamespaceRefusalV1 {
            throw IncidentLedgerErrorV1.namespaceObservation(error)
        }
    }

    private func pollNamespaceObserver() throws {
        guard !namespaceObservationRequired || handleBox.namespaceObserver != nil else {
            throw IncidentLedgerErrorV1.namespaceObservation(.unavailable(operation: "missing-observer", code: EBADF))
        }
        do { try handleBox.namespaceObserver?.poll() }
        catch let error as IncidentNamespaceRefusalV1 {
            throw IncidentLedgerErrorV1.namespaceObservation(error)
        }
    }

    func record(
        _ observation: IncidentObservationInputV1
    ) throws -> IncidentAppendDispositionV1 {
        try recordInternal(
            observation,
            admission: nil,
            collapseEquivalentReplays: false
        )
    }

    package func recordForAbruptRestartFixture(
        _ observation: IncidentObservationInputV1
    ) throws -> IncidentAppendDispositionV1 {
        try recordInternal(
            observation,
            admission: nil,
            collapseEquivalentReplays: false
        )
    }

    func record(
        _ observation: IncidentObservationInputV1,
        admission: PipelineIncidentWriteAdmissionV1,
        collapseEquivalentReplays: Bool
    ) throws -> IncidentAppendDispositionV1 {
        try recordInternal(
            observation,
            admission: admission,
            collapseEquivalentReplays: collapseEquivalentReplays
        )
    }

    private func recordInternal(
        _ observation: IncidentObservationInputV1,
        admission: PipelineIncidentWriteAdmissionV1?,
        collapseEquivalentReplays: Bool
    ) throws -> IncidentAppendDispositionV1 {
        try Task.checkCancellation()
        try requireCurrent(admission)
        try ensureOpen()
        try requireOpenedDatabaseFileIdentity()
        let normalized = try Self.validate(observation: observation)
        let incidentDigest = Self.incidentDigest(scope: scope, observation: normalized)
        try applyPrivateFileModes()
        abruptProcessProbe?(.beforeObservationBegin)
        try execute("BEGIN IMMEDIATE;")
        let appendedSummary: IncidentSummaryV1
        do {
            abruptProcessProbe?(.afterObservationBeginBeforeWrite)
            _ = try verifyIntegrityInternal()
            try Task.checkCancellation()
            try requireCurrent(admission)
            try requireOpenedDatabaseFileIdentity()
            if let existing = try event(forObservationKey: normalized.observationKey) {
                if try tombstone(forIncidentID: existing.incidentID) != nil {
                    throw IncidentLedgerErrorV1.incidentTombstoned
                }
                if collapseEquivalentReplays,
                   Self.isEquivalentReplay(existing: existing, observation: normalized) {
                    try commit(admission: admission)
                    return .idempotentDuplicate(try summary(from: existing))
                }
                guard existing.incidentDigest == incidentDigest else {
                    throw IncidentLedgerErrorV1.observationConflict
                }
                try commit(admission: admission)
                return .idempotentDuplicate(try summary(from: existing))
            }
            if try event(forIncidentID: normalized.incidentID) != nil {
                throw IncidentLedgerErrorV1.incidentIDConflict
            }

            let metadata = try readMetadata()
            guard metadata.eventCount < eventCapacity else {
                throw IncidentLedgerErrorV1.capacityExceeded
            }
            let ordinal = metadata.eventCount + 1
            let eventID = "event/\(String(format: "%012lld", ordinal))-\(incidentDigest.prefix(16))"
            let eventDigest = Self.eventDigest(
                scope: scope,
                ordinal: ordinal,
                eventID: eventID,
                incidentDigest: incidentDigest,
                observation: normalized,
                predecessorDigest: metadata.headDigest
            )
            let event = StoredIncidentEventV1(
                ordinal: ordinal,
                eventID: eventID,
                incidentID: normalized.incidentID,
                incidentDigest: incidentDigest,
                observationKey: normalized.observationKey,
                subjectIDDigest: normalized.subjectIDDigest,
                subjectContentDigest: normalized.subjectContentDigest,
                evidenceSetDigest: normalized.evidenceSetDigest,
                predecessorDigest: metadata.headDigest,
                eventDigest: eventDigest,
                observedAtMilliseconds: Self.milliseconds(normalized.observedAt),
                retentionReviewAtMilliseconds: normalized.retentionReviewAt.map(Self.milliseconds),
                failureCodes: normalized.failureCodes,
                symptomCodes: normalized.symptomCodes
            )

            try insert(event: event)
            try faultInjector?(.afterEventInsertBeforeMetadataUpdate)
            try requireOpenedDatabaseFileIdentity()
            try updateMetadata(
                expected: metadata,
                next: IncidentLedgerMetadataV1(eventCount: ordinal, headDigest: eventDigest)
            )
            _ = try verifyIntegrityInternal()
            let summary = try summary(from: event)
            abruptProcessProbe?(.beforeObservationCommit)
            try commit(admission: admission)
            appendedSummary = summary
        } catch {
            let originalError = error
            try rollbackOrPoison()
            throw originalError
        }
        abruptProcessProbe?(.afterObservationCommitBeforeReturn)
        return .appended(appendedSummary)
    }

    private func requireCurrent(_ admission: PipelineIncidentWriteAdmissionV1?) throws {
        if let admission, !admission.isCurrent {
            throw IncidentLedgerErrorV1.admissionRevoked
        }
    }

    private func commit(admission: PipelineIncidentWriteAdmissionV1?) throws {
        try Task.checkCancellation()
        guard let admission else {
            try requireOpenedDatabaseFileIdentity()
            try replacementBaselineProbe?(.afterFinalIdentityCheckBeforeCommit)
            try execute("COMMIT;")
            return
        }
        let committed = try admission.commitIfCurrent {
            try Task.checkCancellation()
            try requireOpenedDatabaseFileIdentity()
            try replacementBaselineProbe?(.afterFinalIdentityCheckBeforeCommit)
            try execute("COMMIT;")
        }
        guard committed else {
            throw IncidentLedgerErrorV1.admissionRevoked
        }
    }

    public func list(
        subjectContentDigest: String? = nil,
        limit: Int = maximumListPageSize,
        beforeOrdinal: Int64? = nil,
        includeTombstoned: Bool = false
    ) throws -> [IncidentSummaryV1] {
        try ensureOpen()
        try requireOpenedDatabaseFileIdentity()
        if let subjectContentDigest {
            guard Self.isDigest(subjectContentDigest) else {
                throw IncidentLedgerErrorV1.invalidInput("Subject digest must be lowercase SHA-256.")
            }
        }
        guard (1...Self.maximumListPageSize).contains(limit) else {
            throw IncidentLedgerErrorV1.invalidInput("Incident list limit is outside the admitted range.")
        }
        if let beforeOrdinal, beforeOrdinal <= 0 {
            throw IncidentLedgerErrorV1.invalidInput("Incident list cursor must be a positive ordinal.")
        }
        var predicates: [String] = []
        if subjectContentDigest != nil { predicates.append("subject_content_digest = ?") }
        if beforeOrdinal != nil { predicates.append("ordinal < ?") }
        if !includeTombstoned {
            predicates.append(
                "NOT EXISTS (SELECT 1 FROM incident_tombstones WHERE incident_tombstones.incident_id = incident_events.incident_id)"
            )
        }
        let whereClause = predicates.isEmpty ? "" : " WHERE \(predicates.joined(separator: " AND "))"
        let sql = "SELECT \(Self.eventColumns) FROM incident_events\(whereClause) ORDER BY ordinal DESC LIMIT ?;"
        return try withVerifiedReadTransaction { _ in
            try withStatement(sql) { statement in
                var bindIndex: Int32 = 1
                if let subjectContentDigest {
                    try bindText(subjectContentDigest, at: bindIndex, to: statement)
                    bindIndex += 1
                }
                if let beforeOrdinal {
                    sqlite3_bind_int64(statement, bindIndex, beforeOrdinal)
                    bindIndex += 1
                }
                sqlite3_bind_int64(statement, bindIndex, Int64(limit))
                var summaries: [IncidentSummaryV1] = []
                while true {
                    let result = sqlite3_step(statement)
                    if result == SQLITE_DONE { break }
                    guard result == SQLITE_ROW else { throw sqliteError(result) }
                    summaries.append(try summary(from: readEvent(statement)))
                }
                return summaries
            }
        }
    }

    public func inspect(selection: IncidentSelectionV1) throws -> IncidentViewV1 {
        try ensureOpen()
        try requireOpenedDatabaseFileIdentity()
        try Self.validate(selection: selection)
        guard selection.projectDigest == scope.projectDigest else {
            throw IncidentLedgerErrorV1.selectionMismatch
        }
        return try withVerifiedReadTransaction { _ in
            guard let event = try event(forIncidentID: selection.incidentID) else {
                throw IncidentLedgerErrorV1.incidentNotFound
            }
            guard Self.matches(selection: selection, event: event) else {
                throw IncidentLedgerErrorV1.selectionMismatch
            }
            let storedTombstone = try tombstone(forIncidentID: event.incidentID)
            return IncidentViewV1(
                scope: scope,
                summary: try summary(from: event),
                lifecycleState: storedTombstone == nil ? .active : .tombstoned,
                tombstone: storedTombstone.map(Self.tombstoneView),
                limitationCodes: Self.limitationCodes
            )
        }
    }

    /// Read and explain one exact incident in one verified transaction. A
    /// tombstone is displayed honestly; it never becomes active through explain.
    public func explain(selection: IncidentSelectionV1) throws -> IncidentExplanationV1 {
        try Task.checkCancellation()
        try ensureOpen()
        try requireOpenedDatabaseFileIdentity()
        try Self.validate(selection: selection)
        guard selection.projectDigest == scope.projectDigest else {
            throw IncidentLedgerErrorV1.selectionMismatch
        }
        let explanation = try withVerifiedReadTransaction { verification in
            guard let event = try event(forIncidentID: selection.incidentID) else {
                throw IncidentLedgerErrorV1.incidentNotFound
            }
            guard Self.matches(selection: selection, event: event) else {
                throw IncidentLedgerErrorV1.selectionMismatch
            }
            let storedTombstone = try tombstone(forIncidentID: event.incidentID)
            let view = IncidentViewV1(scope: scope, summary: try summary(from: event),
                lifecycleState: storedTombstone == nil ? .active : .tombstoned,
                tombstone: storedTombstone.map(Self.tombstoneView), limitationCodes: Self.limitationCodes)
            let explanation = IncidentExplanationV1(view: view, verification: verification)
#if DEBUG
            beforeExplanationCompletionForTesting?()
#endif
            try Task.checkCancellation()
            return explanation
        }
#if DEBUG
        afterExplanationTransactionForTesting?()
#endif
        try Task.checkCancellation()
        return explanation
    }

#if DEBUG
    private var beforeExplanationCompletionForTesting: (@Sendable () -> Void)?
    private var afterExplanationTransactionForTesting: (@Sendable () -> Void)?
    package func setBeforeExplanationCompletionForTesting(_ body: (@Sendable () -> Void)?) {
        beforeExplanationCompletionForTesting = body
    }
    package func setAfterExplanationTransactionForTesting(_ body: (@Sendable () -> Void)?) {
        afterExplanationTransactionForTesting = body
    }
#endif

    /// Derive a historical pattern from exact selections in ONE verified SQLite
    /// read transaction. No nested inspect calls, await, writes or model calls.
    /// The transaction's head is a same-user snapshot binding, not a protected
    /// authority or a promise that these observations remain current afterwards.
    public func observeFailurePattern(
        selections: [IncidentSelectionV1]
    ) throws -> FailurePatternObservationV2 {
        guard (2...FailurePatternObservationV2.maximumMembers).contains(selections.count) else {
            throw FailurePatternRefusalV2.invalidMemberCount
        }
        guard selections.allSatisfy(FailurePatternReducerV2.validSelection) else {
            throw FailurePatternRefusalV2.invalidSelection
        }
        guard Set(selections.map(\.incidentID)).count == selections.count else {
            throw FailurePatternRefusalV2.duplicateMember
        }
        try ensureOpen()
        try requireOpenedDatabaseFileIdentity()
        guard selections.allSatisfy({ $0.projectDigest == scope.projectDigest }) else {
            throw IncidentLedgerErrorV1.selectionMismatch
        }
        return try withVerifiedReadTransaction { verification in
            var views: [IncidentViewV1] = []
            for selection in selections {
                try Task.checkCancellation()
                guard let event = try event(forIncidentID: selection.incidentID) else {
                    throw IncidentLedgerErrorV1.incidentNotFound
                }
                guard Self.matches(selection: selection, event: event) else {
                    throw IncidentLedgerErrorV1.selectionMismatch
                }
                let storedTombstone = try tombstone(forIncidentID: event.incidentID)
                views.append(IncidentViewV1(scope: scope, summary: try summary(from: event),
                    lifecycleState: storedTombstone == nil ? .active : .tombstoned,
                    tombstone: storedTombstone.map(Self.tombstoneView), limitationCodes: Self.limitationCodes))
            }
            try Task.checkCancellation()
            return try FailurePatternReducerV2.observe(scope: scope, verification: verification, views: views)
        }
    }

    public func tombstone(
        selection: IncidentSelectionV1,
        reason: IncidentTombstoneReasonV1,
        expectedRetentionPolicyDigest: String
    ) throws -> IncidentTombstoneDispositionV1 {
        try tombstoneInternal(
            selection: selection,
            reason: reason,
            expectedRetentionPolicyDigest: expectedRetentionPolicyDigest,
            admission: nil
        )
    }

    public func tombstone(
        selection: IncidentSelectionV1,
        reason: IncidentTombstoneReasonV1,
        expectedRetentionPolicyDigest: String,
        admission: IncidentLifecycleMutationAdmissionV1
    ) throws -> IncidentTombstoneDispositionV1 {
        try tombstoneInternal(
            selection: selection,
            reason: reason,
            expectedRetentionPolicyDigest: expectedRetentionPolicyDigest,
            admission: admission
        )
    }

    private func tombstoneInternal(
        selection: IncidentSelectionV1,
        reason: IncidentTombstoneReasonV1,
        expectedRetentionPolicyDigest: String,
        admission: IncidentLifecycleMutationAdmissionV1?
    ) throws -> IncidentTombstoneDispositionV1 {
        try Task.checkCancellation()
        try requireCurrent(admission)
        try ensureOpen()
        try requireOpenedDatabaseFileIdentity()
        try Self.validate(selection: selection)
        guard selection.projectDigest == scope.projectDigest else {
            throw IncidentLedgerErrorV1.selectionMismatch
        }
        guard Self.isDigest(expectedRetentionPolicyDigest),
              expectedRetentionPolicyDigest == scope.retentionPolicyDigest else {
            throw IncidentLedgerErrorV1.retentionPolicyMismatch
        }
        guard let tombstonedAtMilliseconds = Self.validatedMilliseconds(clock()) else {
            throw IncidentLedgerErrorV1.invalidInput("Ledger clock is outside the admitted range.")
        }

        try applyPrivateFileModes()
        try execute("BEGIN IMMEDIATE;")
        do {
            _ = try verifyIntegrityInternal()
            try Task.checkCancellation()
            try requireCurrent(admission)
            try requireOpenedDatabaseFileIdentity()
            guard let observation = try event(forIncidentID: selection.incidentID) else {
                throw IncidentLedgerErrorV1.incidentNotFound
            }
            guard Self.matches(selection: selection, event: observation) else {
                throw IncidentLedgerErrorV1.selectionMismatch
            }
            if let existing = try tombstone(forIncidentID: observation.incidentID) {
                guard existing.reason == reason,
                      existing.retentionPolicyDigest == expectedRetentionPolicyDigest,
                      existing.targetIncidentDigest == observation.incidentDigest,
                      existing.targetEventDigest == observation.eventDigest,
                      existing.subjectIDDigest == observation.subjectIDDigest,
                      existing.subjectContentDigest == observation.subjectContentDigest else {
                    throw IncidentLedgerErrorV1.tombstoneConflict
                }
                try commit(admission: admission)
                return .idempotentDuplicate(Self.tombstoneView(existing))
            }

            if reason == .retentionReviewDue {
                guard let reviewAt = observation.retentionReviewAtMilliseconds else {
                    throw IncidentLedgerErrorV1.retentionDeadlineMissing
                }
                guard tombstonedAtMilliseconds >= reviewAt else {
                    throw IncidentLedgerErrorV1.retentionNotDue
                }
            }

            let metadata = try readMetadata()
            guard metadata.eventCount < eventCapacity else {
                throw IncidentLedgerErrorV1.capacityExceeded
            }
            let ordinal = metadata.eventCount + 1
            let eventID = Self.tombstoneEventID(
                scope: scope,
                observation: observation,
                reason: reason
            )
            let eventDigest = Self.tombstoneEventDigest(
                scope: scope,
                ordinal: ordinal,
                eventID: eventID,
                observation: observation,
                reason: reason,
                tombstonedAtMilliseconds: tombstonedAtMilliseconds,
                predecessorDigest: metadata.headDigest
            )
            let stored = StoredIncidentTombstoneV1(
                ordinal: ordinal,
                eventID: eventID,
                incidentID: observation.incidentID,
                targetIncidentDigest: observation.incidentDigest,
                targetEventDigest: observation.eventDigest,
                subjectIDDigest: observation.subjectIDDigest,
                subjectContentDigest: observation.subjectContentDigest,
                retentionPolicyDigest: scope.retentionPolicyDigest,
                reason: reason,
                predecessorDigest: metadata.headDigest,
                eventDigest: eventDigest,
                tombstonedAtMilliseconds: tombstonedAtMilliseconds
            )
            try insert(tombstone: stored)
            try faultInjector?(.afterTombstoneInsertBeforeMetadataUpdate)
            try requireOpenedDatabaseFileIdentity()
            try updateMetadata(
                expected: metadata,
                next: IncidentLedgerMetadataV1(eventCount: ordinal, headDigest: eventDigest)
            )
            _ = try verifyIntegrityInternal()
            try faultInjector?(.beforeTombstoneCommit)
            try requireOpenedDatabaseFileIdentity()
            try commit(admission: admission)
            return .appended(Self.tombstoneView(stored))
        } catch {
            let originalError = error
            try rollbackOrPoison()
            throw originalError
        }
    }

    private func requireCurrent(
        _ admission: IncidentLifecycleMutationAdmissionV1?
    ) throws {
        if let admission, !admission.isCurrent {
            throw IncidentLedgerErrorV1.admissionRevoked
        }
    }

    private func commit(
        admission: IncidentLifecycleMutationAdmissionV1?
    ) throws {
        try Task.checkCancellation()
        guard let admission else {
            try requireOpenedDatabaseFileIdentity()
            try execute("COMMIT;")
            return
        }
        let committed = try admission.commitIfCurrent {
            try Task.checkCancellation()
            try requireOpenedDatabaseFileIdentity()
            try execute("COMMIT;")
        }
        guard committed else {
            throw IncidentLedgerErrorV1.admissionRevoked
        }
    }

    /// Logically tombstones one bounded page of observations whose stored
    /// retention-review deadline is due. The first page freezes one clock sample
    /// and one event high-watermark; continuation pages reuse both values.
    ///
    /// This mutation is non-authorizing and performs no physical erasure. The
    /// continuation seal is unkeyed same-user integrity metadata, not authority.
    public func sweepRetentionReviewDue(
        expectedRetentionPolicyDigest: String,
        batchSize: Int,
        continuation: IncidentRetentionSweepContinuationV1? = nil,
        admission: IncidentLifecycleMutationAdmissionV1
    ) throws -> IncidentRetentionSweepPageV1 {
        try Task.checkCancellation()
        try requireCurrent(admission)
        try ensureOpen()
        guard Self.isDigest(expectedRetentionPolicyDigest),
              expectedRetentionPolicyDigest == scope.retentionPolicyDigest else {
            throw IncidentLedgerErrorV1.retentionPolicyMismatch
        }
        guard (1...Self.maximumRetentionSweepPageSize).contains(batchSize) else {
            throw IncidentLedgerErrorV1.invalidInput(
                "Retention-sweep batch size is outside the admitted range."
            )
        }

        try requireOpenedDatabaseFileIdentity()
        if let continuation {
            guard continuation.isBound(
                to: scope,
                databaseFileIdentity: databaseFileIdentity
            ), continuation.batchSize == batchSize else {
                throw IncidentLedgerErrorV1.invalidInput(
                    "Retention-sweep continuation binding does not match this page."
                )
            }
        }
        try applyPrivateFileModes()
        try requireOpenedDatabaseFileIdentity()

        try execute("BEGIN IMMEDIATE;")
        do {
            try requireOpenedDatabaseFileIdentity()
            _ = try verifyIntegrityInternal()
            let startingMetadata = try readMetadata()
            try Task.checkCancellation()
            try requireCurrent(admission)

            let cutoffAtMilliseconds: Int64
            let initialEventHighWatermark: Int64
            let cursor: (
                retentionReviewAtMilliseconds: Int64,
                observationOrdinal: Int64
            )?

            if let continuation {
                guard continuation.isBound(
                    to: scope,
                    databaseFileIdentity: databaseFileIdentity
                ),
                    continuation.batchSize == batchSize,
                    continuation.initialEventHighWatermark <= startingMetadata.eventCount
                else {
                    throw IncidentLedgerErrorV1.integrity(
                        "Retention-sweep continuation no longer matches the opened ledger."
                    )
                }
                cutoffAtMilliseconds = continuation.cutoffAtMilliseconds
                initialEventHighWatermark = continuation.initialEventHighWatermark
                cursor = (
                    continuation.lastRetentionReviewAtMilliseconds,
                    continuation.lastObservationOrdinal
                )

                guard
                    let anchor = try event(
                        forOrdinal: continuation.lastObservationOrdinal
                    ),
                    anchor.ordinal <= continuation.initialEventHighWatermark,
                    anchor.retentionReviewAtMilliseconds
                        == continuation.lastRetentionReviewAtMilliseconds,
                    continuation.lastRetentionReviewAtMilliseconds
                        <= continuation.cutoffAtMilliseconds,
                    let anchorTombstone = try tombstone(
                        forIncidentID: anchor.incidentID
                    ),
                    Self.matchesRetentionSweepTombstone(
                        anchorTombstone,
                        observation: anchor,
                        scope: scope
                    )
                else {
                    throw IncidentLedgerErrorV1.integrity(
                        "Retention-sweep continuation cursor is not an exact processed anchor."
                    )
                }
                guard try retentionSweepPrefixIsResolved(
                    cutoffAtMilliseconds: continuation.cutoffAtMilliseconds,
                    initialEventHighWatermark: continuation.initialEventHighWatermark,
                    throughRetentionReviewAtMilliseconds:
                        continuation.lastRetentionReviewAtMilliseconds,
                    throughObservationOrdinal: continuation.lastObservationOrdinal
                ) else {
                    throw IncidentLedgerErrorV1.integrity(
                        "Retention-sweep continuation would skip unresolved due work."
                    )
                }
            } else {
                guard let admittedClock = Self.validatedMilliseconds(clock()) else {
                    throw IncidentLedgerErrorV1.invalidInput(
                        "Ledger clock is outside the admitted range."
                    )
                }
                cutoffAtMilliseconds = admittedClock
                initialEventHighWatermark = startingMetadata.eventCount
                cursor = nil
            }

            let candidates = try retentionSweepCandidates(
                cutoffAtMilliseconds: cutoffAtMilliseconds,
                initialEventHighWatermark: initialEventHighWatermark,
                after: cursor,
                limit: batchSize + 1
            )
            let hasLookahead = candidates.count > batchSize
            let pageObservations = Array(candidates.prefix(batchSize))

            var classified: [(
                observation: StoredIncidentEventV1,
                existing: StoredIncidentTombstoneV1?
            )] = []
            classified.reserveCapacity(pageObservations.count)
            var appendedTombstoneCount = 0
            var replayedTombstoneCount = 0
            for observation in pageObservations {
                if let existing = try tombstone(
                    forIncidentID: observation.incidentID
                ) {
                    guard Self.matchesRetentionSweepTombstone(
                        existing,
                        observation: observation,
                        scope: scope
                    ) else {
                        throw IncidentLedgerErrorV1.tombstoneConflict
                    }
                    replayedTombstoneCount += 1
                    classified.append((observation, existing))
                } else {
                    appendedTombstoneCount += 1
                    classified.append((observation, nil))
                }
            }

            guard Int64(appendedTombstoneCount)
                <= eventCapacity - startingMetadata.eventCount else {
                throw IncidentLedgerErrorV1.capacityExceeded
            }

            var nextOrdinal = startingMetadata.eventCount
            var nextHeadDigest = startingMetadata.headDigest
            var tombstoneViews: [IncidentTombstoneV1] = []
            tombstoneViews.reserveCapacity(classified.count)
            for item in classified {
                if let existing = item.existing {
                    tombstoneViews.append(Self.tombstoneView(existing))
                    continue
                }

                nextOrdinal += 1
                let eventID = Self.tombstoneEventID(
                    scope: scope,
                    observation: item.observation,
                    reason: .retentionReviewDue
                )
                let eventDigest = Self.tombstoneEventDigest(
                    scope: scope,
                    ordinal: nextOrdinal,
                    eventID: eventID,
                    observation: item.observation,
                    reason: .retentionReviewDue,
                    tombstonedAtMilliseconds: cutoffAtMilliseconds,
                    predecessorDigest: nextHeadDigest
                )
                let stored = StoredIncidentTombstoneV1(
                    ordinal: nextOrdinal,
                    eventID: eventID,
                    incidentID: item.observation.incidentID,
                    targetIncidentDigest: item.observation.incidentDigest,
                    targetEventDigest: item.observation.eventDigest,
                    subjectIDDigest: item.observation.subjectIDDigest,
                    subjectContentDigest: item.observation.subjectContentDigest,
                    retentionPolicyDigest: scope.retentionPolicyDigest,
                    reason: .retentionReviewDue,
                    predecessorDigest: nextHeadDigest,
                    eventDigest: eventDigest,
                    tombstonedAtMilliseconds: cutoffAtMilliseconds
                )
                try insert(tombstone: stored)
                try faultInjector?(.afterTombstoneInsertBeforeMetadataUpdate)
                try requireOpenedDatabaseFileIdentity()
                nextHeadDigest = eventDigest
                tombstoneViews.append(Self.tombstoneView(stored))
            }

            if appendedTombstoneCount > 0 {
                try updateMetadata(
                    expected: startingMetadata,
                    next: IncidentLedgerMetadataV1(
                        eventCount: nextOrdinal,
                        headDigest: nextHeadDigest
                    )
                )
            }

            _ = try verifyIntegrityInternal()
            try requireOpenedDatabaseFileIdentity()

            let nextContinuation: IncidentRetentionSweepContinuationV1?
            if hasLookahead, let last = pageObservations.last,
               let lastReview = last.retentionReviewAtMilliseconds {
                do {
                    nextContinuation = try .make(
                        scope: scope,
                        databaseFileIdentity: databaseFileIdentity,
                        batchSize: batchSize,
                        cutoffAtMilliseconds: cutoffAtMilliseconds,
                        initialEventHighWatermark: initialEventHighWatermark,
                        lastRetentionReviewAtMilliseconds: lastReview,
                        lastObservationOrdinal: last.ordinal
                    )
                } catch {
                    throw IncidentLedgerErrorV1.integrity(
                        "Retention-sweep continuation could not be encoded canonically."
                    )
                }
            } else {
                nextContinuation = nil
            }

            let preparedPage = try IncidentRetentionSweepPageV1(
                scope: scope,
                cutoffAtMilliseconds: cutoffAtMilliseconds,
                initialEventHighWatermark: initialEventHighWatermark,
                batchSize: batchSize,
                processedObservationCount: pageObservations.count,
                appendedTombstoneCount: appendedTombstoneCount,
                replayedTombstoneCount: replayedTombstoneCount,
                tombstones: tombstoneViews,
                continuation: nextContinuation
            )

            try Task.checkCancellation()
            try requireCurrent(admission)
            try faultInjector?(.beforeTombstoneCommit)
            try requireOpenedDatabaseFileIdentity()
            try commit(admission: admission)
            return preparedPage
        } catch {
            let originalError = error
            try rollbackOrPoison()
            throw originalError
        }
    }

    public func redactedExport(
        selection: IncidentSelectionV1
    ) throws -> IncidentRedactedExportV1 {
        try ensureOpen()
        try requireOpenedDatabaseFileIdentity()
        try Self.validate(selection: selection)
        guard selection.projectDigest == scope.projectDigest else {
            throw IncidentLedgerErrorV1.selectionMismatch
        }
        return try withVerifiedReadTransaction { _ in
            guard let observation = try event(forIncidentID: selection.incidentID) else {
                throw IncidentLedgerErrorV1.incidentNotFound
            }
            guard Self.matches(selection: selection, event: observation) else {
                throw IncidentLedgerErrorV1.selectionMismatch
            }
            let storedTombstone = try tombstone(forIncidentID: observation.incidentID)
            return try Self.makeRedactedExport(
                scope: scope,
                observation: observation,
                tombstone: storedTombstone
            )
        }
    }

    public func verifyIntegrity() throws -> IncidentLedgerVerificationV1 {
        try ensureOpen()
        try requireOpenedDatabaseFileIdentity()
        return try withVerifiedReadTransaction { $0 }
    }

#if DEBUG
    /// Deterministic SQLite authorization refusal, not a simulated I/O failure.
    /// Internal test surface only: no handle, caller callback or authority escapes.
    /// Install after seeding; nil unregisters the callback on this exact connection.
    enum TransactionEndDenialForTesting: Sendable {
        case commit, commitAndRollback
    }

    func setTransactionEndDenialForTesting(_ denial: TransactionEndDenialForTesting?) throws {
        try ensureOpen()
        guard let database else { throw IncidentLedgerErrorV1.closed }
        let result: Int32
        switch denial {
        case .commit:
            result = sqlite3_set_authorizer(database, { _, action, operation, _, _, _ in
                guard action == SQLITE_TRANSACTION, let operation else { return SQLITE_OK }
                return strcmp(operation, "COMMIT") == 0 ? SQLITE_DENY : SQLITE_OK
            }, nil)
        case .commitAndRollback:
            result = sqlite3_set_authorizer(database, { _, action, operation, _, _, _ in
                guard action == SQLITE_TRANSACTION, let operation else { return SQLITE_OK }
                return strcmp(operation, "COMMIT") == 0 || strcmp(operation, "ROLLBACK") == 0
                    ? SQLITE_DENY : SQLITE_OK
            }, nil)
        case nil:
            result = sqlite3_set_authorizer(database, nil, nil)
        }
        guard result == SQLITE_OK else { throw sqliteError(result) }
    }
#endif

    /// Reads the connection-local policy from the actor-owned SQLite handle.
    /// An external connection is not evidence for this setting.
    func automaticCheckpointThresholdForTesting() throws -> Int64 {
        try ensureOpen()
        try requireOpenedDatabaseFileIdentity()
        return try scalarInt64("PRAGMA wal_autocheckpoint;")
    }

    /// Remains readable after close so a test can bind the close result to the
    /// exact named-database request that produced it.
    func latestCheckpointAttemptForTesting() -> IncidentLedgerCheckpointAttemptV1? {
        latestCheckpointAttemptForTestingValue
    }

    /// Test-only cleanup after an adverse replacement fixture makes a normal
    /// checkpoint attempt non-favorable. Every admitted handle has implicit
    /// checkpoint-on-close disabled, so this closes without retrying the ambiguous
    /// checkpoint. It is not available to the public product surface.
    func abortForCoherentReplacementBaselineTesting() throws {
        guard let database else { return }
        let observerError = handleBox.namespaceObserver?.stop()
        let closeResult = sqlite3_close_v2(database)
        guard closeResult == SQLITE_OK else { throw sqliteError(closeResult) }
        self.database = nil
        if let observerError { throw IncidentLedgerErrorV1.namespaceObservation(observerError) }
    }

    public func close() throws {
        guard let database else { return }
        // Every handle was admitted with SQLite's implicit close checkpoint
        // disabled. Re-attest immediately before this close attempt's explicit
        // named-main checkpoint.
        // If drift was observed earlier or is observed now, close the actor-held
        // handle, then report integrity refusal without checkpointing.
        var pathIntegrityError: Error?
        do {
            try requireOpenedDatabaseFileIdentity()
            try replacementBaselineProbe?(
                .afterCloseIdentityReattestationBeforeNamedMainCheckpoint
            )
            try pollNamespaceObserver()
            pathIntegrityError = nil
        } catch {
            pathIntegrityError = error
        }
        if pathIntegrityError == nil {
            let databaseName = "main"
            var logFrames: Int32 = -2
            var checkpointedFrames: Int32 = -2
            let checkpointResult: Int32
            let synthetic: Bool
            if let outcome = syntheticCheckpointOutcomeForTesting {
                syntheticCheckpointOutcomeForTesting = nil
                checkpointResult = outcome.resultCode
                logFrames = outcome.logFrames
                checkpointedFrames = outcome.checkpointedFrames
                synthetic = true
            } else {
                checkpointResult = databaseName.withCString { name in
                    sqlite3_wal_checkpoint_v2(
                        database,
                        name,
                        SQLITE_CHECKPOINT_FULL,
                        &logFrames,
                        &checkpointedFrames
                    )
                }
                synthetic = false
            }
            latestCheckpointAttemptForTestingValue = IncidentLedgerCheckpointAttemptV1(
                databaseName: databaseName,
                mode: SQLITE_CHECKPOINT_FULL,
                resultCode: checkpointResult,
                logFrames: logFrames,
                checkpointedFrames: checkpointedFrames,
                synthetic: synthetic
            )
            guard checkpointResult == SQLITE_OK else { throw sqliteError(checkpointResult) }
            guard
                logFrames >= 0,
                checkpointedFrames >= 0,
                checkpointedFrames == logFrames
            else {
                throw IncidentLedgerErrorV1.integrity(
                    "Explicit main WAL checkpoint accounting was incomplete."
                )
            }
        }
        // A second boundary observes changes during checkpoint; it does not undo
        // checkpoint effects or make the interval atomic. Actual SQLite outcomes
        // above remain recorded unchanged.
        if pathIntegrityError == nil {
            do {
                try namespaceCloseProbeForTesting?(false)
                try pollNamespaceObserver()
            } catch { pathIntegrityError = error }
        }
        // End coverage before SQLite's legitimate sidecar namespace cleanup.
        // These are directory/kqueue FDs, never independently opened DB/WAL FDs.
        if let observerError = handleBox.namespaceObserver?.stop(), pathIntegrityError == nil {
            pathIntegrityError = IncidentLedgerErrorV1.namespaceObservation(observerError)
        }
        do { try namespaceCloseProbeForTesting?(true) }
        catch { if pathIntegrityError == nil { pathIntegrityError = error } }
        let closeResult = sqlite3_close_v2(database)
        guard closeResult == SQLITE_OK else { throw sqliteError(closeResult) }
        self.database = nil
        if let pathIntegrityError { throw pathIntegrityError }
    }

    private func initializeSchema() throws {
        try execute("BEGIN IMMEDIATE;")
        var committed = false
        defer {
            if !committed { try? execute("ROLLBACK;") }
        }
        for sql in [
            Self.ledgerMetaTableSQL,
            Self.incidentEventsTableSQL,
            Self.failureCodesTableSQL,
            Self.symptomCodesTableSQL,
            Self.incidentTombstonesTableSQL,
        ] {
            try execute(sql + ";")
        }
        try withStatement(
            """
            INSERT INTO ledger_meta (
                singleton, schema_version, profile, scope_id, project_digest,
                access_policy_digest, retention_policy_digest, genesis_digest,
                event_count, head_digest, authorizing,
                protected_authority_verified, raw_content_stored
            ) VALUES (1, 3, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0, 0);
            """
        ) { statement in
            try bindText(Self.profile, at: 1, to: statement)
            try bindText(scope.scopeID, at: 2, to: statement)
            try bindText(scope.projectDigest, at: 3, to: statement)
            try bindText(scope.accessPolicyDigest, at: 4, to: statement)
            try bindText(scope.retentionPolicyDigest, at: 5, to: statement)
            try bindText(genesisDigest, at: 6, to: statement)
            try bindText(genesisDigest, at: 7, to: statement)
            try stepDone(statement)
        }
        try execute("PRAGMA user_version=3;")
        try execute("COMMIT;")
        committed = true
    }

    private func insert(event: StoredIncidentEventV1) throws {
        try withStatement(
            """
            INSERT INTO incident_events (
                ordinal, event_id, event_type, incident_id, incident_digest,
                observation_key, subject_id_digest, subject_content_digest,
                evidence_set_digest, predecessor_digest, event_digest,
                observed_at_ms, retention_review_at_ms, authorizing,
                protected_authority_verified, raw_content_stored
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0);
            """
        ) { statement in
            sqlite3_bind_int64(statement, 1, event.ordinal)
            try bindText(event.eventID, at: 2, to: statement)
            try bindText(Self.observationEventType, at: 3, to: statement)
            try bindText(event.incidentID, at: 4, to: statement)
            try bindText(event.incidentDigest, at: 5, to: statement)
            try bindText(event.observationKey, at: 6, to: statement)
            try bindText(event.subjectIDDigest, at: 7, to: statement)
            try bindText(event.subjectContentDigest, at: 8, to: statement)
            try bindText(event.evidenceSetDigest, at: 9, to: statement)
            try bindText(event.predecessorDigest, at: 10, to: statement)
            try bindText(event.eventDigest, at: 11, to: statement)
            sqlite3_bind_int64(statement, 12, event.observedAtMilliseconds)
            if let retentionReviewAtMilliseconds = event.retentionReviewAtMilliseconds {
                sqlite3_bind_int64(statement, 13, retentionReviewAtMilliseconds)
            } else {
                sqlite3_bind_null(statement, 13)
            }
            try stepDone(statement)
        }
        try insert(codes: event.failureCodes, table: "incident_failure_codes", ordinal: event.ordinal)
        try insert(codes: event.symptomCodes, table: "incident_symptom_codes", ordinal: event.ordinal)
    }

    private func insert(tombstone: StoredIncidentTombstoneV1) throws {
        try withStatement(
            """
            INSERT INTO incident_tombstones (
                ordinal, event_id, event_type, incident_id,
                target_incident_digest, target_event_digest,
                subject_id_digest, subject_content_digest,
                retention_policy_digest, reason_code,
                predecessor_digest, event_digest, tombstoned_at_ms,
                authorizing, protected_authority_verified,
                raw_content_stored, physical_erasure_performed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0);
            """
        ) { statement in
            sqlite3_bind_int64(statement, 1, tombstone.ordinal)
            try bindText(tombstone.eventID, at: 2, to: statement)
            try bindText(Self.tombstoneEventType, at: 3, to: statement)
            try bindText(tombstone.incidentID, at: 4, to: statement)
            try bindText(tombstone.targetIncidentDigest, at: 5, to: statement)
            try bindText(tombstone.targetEventDigest, at: 6, to: statement)
            try bindText(tombstone.subjectIDDigest, at: 7, to: statement)
            try bindText(tombstone.subjectContentDigest, at: 8, to: statement)
            try bindText(tombstone.retentionPolicyDigest, at: 9, to: statement)
            try bindText(tombstone.reason.rawValue, at: 10, to: statement)
            try bindText(tombstone.predecessorDigest, at: 11, to: statement)
            try bindText(tombstone.eventDigest, at: 12, to: statement)
            sqlite3_bind_int64(statement, 13, tombstone.tombstonedAtMilliseconds)
            try stepDone(statement)
        }
    }

    private func insert<Code: RawRepresentable>(
        codes: [Code],
        table: String,
        ordinal: Int64
    ) throws where Code.RawValue == String {
        precondition(["incident_failure_codes", "incident_symptom_codes"].contains(table))
        for (position, code) in codes.enumerated() {
            try withStatement(
                "INSERT INTO \(table) (event_ordinal, position, code) VALUES (?, ?, ?);"
            ) { statement in
                sqlite3_bind_int64(statement, 1, ordinal)
                sqlite3_bind_int64(statement, 2, Int64(position))
                try bindText(code.rawValue, at: 3, to: statement)
                try stepDone(statement)
            }
        }
    }

    private func updateMetadata(
        expected: IncidentLedgerMetadataV1,
        next: IncidentLedgerMetadataV1
    ) throws {
        try withStatement(
            """
            UPDATE ledger_meta
            SET event_count = ?, head_digest = ?
            WHERE singleton = 1 AND event_count = ? AND head_digest = ?;
            """
        ) { statement in
            sqlite3_bind_int64(statement, 1, next.eventCount)
            try bindText(next.headDigest, at: 2, to: statement)
            sqlite3_bind_int64(statement, 3, expected.eventCount)
            try bindText(expected.headDigest, at: 4, to: statement)
            try stepDone(statement)
        }
        guard let database, sqlite3_changes(database) == 1 else {
            throw IncidentLedgerErrorV1.integrity("Ledger head changed during append.")
        }
    }

    private func verifyIntegrityInternal() throws -> IncidentLedgerVerificationV1 {
        try verifySQLiteResourceBounds()
        guard try scalarText("PRAGMA quick_check;") == "ok" else {
            throw IncidentLedgerErrorV1.integrity("SQLite quick_check did not return ok.")
        }
        try withStatement("PRAGMA foreign_key_check;") { statement in
            guard sqlite3_step(statement) == SQLITE_DONE else {
                throw IncidentLedgerErrorV1.integrity(
                    "SQLite foreign-key validation found an orphaned row."
                )
            }
        }
        guard try scalarInt64("PRAGMA user_version;") == Int64(Self.schemaVersion) else {
            throw IncidentLedgerErrorV1.integrity("Schema version changed.")
        }
        try verifySchemaShape()
        try verifyMetadataIdentity()
        let metadata = try readMetadata()
        guard metadata.eventCount <= eventCapacity else {
            throw IncidentLedgerErrorV1.integrity("Event count exceeds the admitted per-project capacity.")
        }
        let events = try readAllLedgerEvents()
        guard Int64(events.count) == metadata.eventCount else {
            throw IncidentLedgerErrorV1.integrity("Event count differs from metadata.")
        }
        var predecessor = genesisDigest
        var observationsByIncidentID: [String: StoredIncidentEventV1] = [:]
        var tombstonedIncidentIDs = Set<String>()
        var observationCount: Int64 = 0
        var tombstoneCount: Int64 = 0
        for (index, ledgerEvent) in events.enumerated() {
            guard ledgerEvent.ordinal == Int64(index + 1) else {
                throw IncidentLedgerErrorV1.integrity("Event ordinals contain a gap or reorder.")
            }
            guard ledgerEvent.predecessorDigest == predecessor else {
                throw IncidentLedgerErrorV1.integrity("Event predecessor chain is not contiguous.")
            }
            switch ledgerEvent {
            case .observation(let event):
                observationCount += 1
                let normalized = try Self.normalizedObservation(from: event)
                guard event.incidentDigest == Self.incidentDigest(
                    scope: scope,
                    observation: normalized
                ) else {
                    throw IncidentLedgerErrorV1.integrity(
                        "Incident digest does not match stored fields."
                    )
                }
                let expectedEventID = "event/\(String(format: "%012lld", event.ordinal))-\(event.incidentDigest.prefix(16))"
                guard event.eventID == expectedEventID else {
                    throw IncidentLedgerErrorV1.integrity("Event identity is not canonical.")
                }
                guard event.eventDigest == Self.eventDigest(
                    scope: scope,
                    ordinal: event.ordinal,
                    eventID: event.eventID,
                    incidentDigest: event.incidentDigest,
                    observation: normalized,
                    predecessorDigest: event.predecessorDigest
                ) else {
                    throw IncidentLedgerErrorV1.integrity(
                        "Event digest does not match stored fields."
                    )
                }
                guard observationsByIncidentID.updateValue(event, forKey: event.incidentID) == nil else {
                    throw IncidentLedgerErrorV1.integrity("Incident identity is duplicated.")
                }

            case .tombstone(let event):
                tombstoneCount += 1
                guard let observation = observationsByIncidentID[event.incidentID] else {
                    throw IncidentLedgerErrorV1.integrity(
                        "A tombstone target does not precede its lifecycle event."
                    )
                }
                guard tombstonedIncidentIDs.insert(event.incidentID).inserted else {
                    throw IncidentLedgerErrorV1.integrity(
                        "An incident has more than one deletion tombstone."
                    )
                }
                guard event.targetIncidentDigest == observation.incidentDigest,
                      event.targetEventDigest == observation.eventDigest,
                      event.subjectIDDigest == observation.subjectIDDigest,
                      event.subjectContentDigest == observation.subjectContentDigest,
                      event.retentionPolicyDigest == scope.retentionPolicyDigest,
                      event.tombstonedAtMilliseconds >= observation.observedAtMilliseconds,
                      event.eventID == Self.tombstoneEventID(
                        scope: scope,
                        observation: observation,
                        reason: event.reason
                      ),
                      event.eventDigest == Self.tombstoneEventDigest(
                        scope: scope,
                        ordinal: event.ordinal,
                        eventID: event.eventID,
                        observation: observation,
                        reason: event.reason,
                        tombstonedAtMilliseconds: event.tombstonedAtMilliseconds,
                        predecessorDigest: event.predecessorDigest
                      ) else {
                    throw IncidentLedgerErrorV1.integrity(
                        "Tombstone identity, target, policy, time, or digest differs."
                    )
                }
                if event.reason == .retentionReviewDue {
                    guard let reviewAt = observation.retentionReviewAtMilliseconds,
                          event.tombstonedAtMilliseconds >= reviewAt else {
                        throw IncidentLedgerErrorV1.integrity(
                            "A retention-driven tombstone predates or lacks its review deadline."
                        )
                    }
                }
            }
            predecessor = ledgerEvent.eventDigest
        }
        guard metadata.headDigest == predecessor else {
            throw IncidentLedgerErrorV1.integrity("Ledger head differs from replayed chain.")
        }
        return IncidentLedgerVerificationV1(
            profile: Self.profile,
            eventCount: metadata.eventCount,
            observationCount: observationCount,
            tombstoneCount: tombstoneCount,
            headDigest: metadata.headDigest,
            authorizing: false,
            protectedAuthorityVerified: false,
            rawContentStored: false
        )
    }

    private func verifySQLiteResourceBounds() throws {
        let pageSize = try scalarInt64("PRAGMA page_size;")
        let pageCount = try scalarInt64("PRAGMA page_count;")
        let freePages = try scalarInt64("PRAGMA freelist_count;")
        guard pageSize == Self.admittedSQLitePageSize,
              pageCount > 0,
              pageCount <= Self.maximumSQLitePageCount,
              freePages >= 0,
              freePages <= pageCount,
              pageCount <= Self.maximumDatabaseBytes / pageSize else {
            throw IncidentLedgerErrorV1.integrity(
                "SQLite page or freelist resources exceed the admitted profile."
            )
        }
    }

    private func verifySchemaShape() throws {
        let expectedObjects = [
            IncidentSchemaObjectV1(
                type: "table",
                name: "incident_events",
                tableName: "incident_events",
                normalizedSQL: Self.normalizeSchemaSQL(Self.incidentEventsTableSQL)
            ),
            IncidentSchemaObjectV1(
                type: "table",
                name: "incident_failure_codes",
                tableName: "incident_failure_codes",
                normalizedSQL: Self.normalizeSchemaSQL(Self.failureCodesTableSQL)
            ),
            IncidentSchemaObjectV1(
                type: "table",
                name: "incident_symptom_codes",
                tableName: "incident_symptom_codes",
                normalizedSQL: Self.normalizeSchemaSQL(Self.symptomCodesTableSQL)
            ),
            IncidentSchemaObjectV1(
                type: "table",
                name: "incident_tombstones",
                tableName: "incident_tombstones",
                normalizedSQL: Self.normalizeSchemaSQL(Self.incidentTombstonesTableSQL)
            ),
            IncidentSchemaObjectV1(
                type: "table",
                name: "ledger_meta",
                tableName: "ledger_meta",
                normalizedSQL: Self.normalizeSchemaSQL(Self.ledgerMetaTableSQL)
            ),
        ]
        let observedObjects = try withStatement(
            """
            SELECT type, name, tbl_name, sql
            FROM sqlite_schema
            WHERE NOT (type = 'index' AND sql IS NULL)
            ORDER BY type ASC, name ASC;
            """
        ) { statement in
            var objects: [IncidentSchemaObjectV1] = []
            while true {
                let result = sqlite3_step(statement)
                if result == SQLITE_DONE { break }
                guard result == SQLITE_ROW else { throw sqliteError(result) }
                objects.append(IncidentSchemaObjectV1(
                    type: text(statement, 0),
                    name: text(statement, 1),
                    tableName: text(statement, 2),
                    normalizedSQL: Self.normalizeSchemaSQL(text(statement, 3))
                ))
            }
            return objects
        }
        guard observedObjects == expectedObjects else {
            throw IncidentLedgerErrorV1.integrity(
                "Ledger schema contains missing, extra, or substituted objects."
            )
        }

        let expectedColumns: [(String, [IncidentSchemaColumnV1])] = [
            ("ledger_meta", [
                .init(name: "singleton", type: "INTEGER", primaryKeyPosition: 1, hidden: 0, notNull: 0),
                .init(name: "schema_version", type: "INTEGER", primaryKeyPosition: 0, hidden: 0),
                .init(name: "profile", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "scope_id", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "project_digest", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "access_policy_digest", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "retention_policy_digest", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "genesis_digest", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "event_count", type: "INTEGER", primaryKeyPosition: 0, hidden: 0),
                .init(name: "head_digest", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "authorizing", type: "INTEGER", primaryKeyPosition: 0, hidden: 0),
                .init(name: "protected_authority_verified", type: "INTEGER", primaryKeyPosition: 0, hidden: 0),
                .init(name: "raw_content_stored", type: "INTEGER", primaryKeyPosition: 0, hidden: 0),
            ]),
            ("incident_events", [
                .init(name: "ordinal", type: "INTEGER", primaryKeyPosition: 1, hidden: 0, notNull: 0),
                .init(name: "event_id", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "event_type", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "incident_id", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "incident_digest", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "observation_key", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "subject_id_digest", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "subject_content_digest", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "evidence_set_digest", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "predecessor_digest", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "event_digest", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "observed_at_ms", type: "INTEGER", primaryKeyPosition: 0, hidden: 0),
                .init(name: "retention_review_at_ms", type: "INTEGER", primaryKeyPosition: 0, hidden: 0, notNull: 0),
                .init(name: "authorizing", type: "INTEGER", primaryKeyPosition: 0, hidden: 0),
                .init(name: "protected_authority_verified", type: "INTEGER", primaryKeyPosition: 0, hidden: 0),
                .init(name: "raw_content_stored", type: "INTEGER", primaryKeyPosition: 0, hidden: 0),
            ]),
            ("incident_failure_codes", [
                .init(name: "event_ordinal", type: "INTEGER", primaryKeyPosition: 1, hidden: 0),
                .init(name: "position", type: "INTEGER", primaryKeyPosition: 2, hidden: 0),
                .init(name: "code", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
            ]),
            ("incident_symptom_codes", [
                .init(name: "event_ordinal", type: "INTEGER", primaryKeyPosition: 1, hidden: 0),
                .init(name: "position", type: "INTEGER", primaryKeyPosition: 2, hidden: 0),
                .init(name: "code", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
            ]),
            ("incident_tombstones", [
                .init(name: "ordinal", type: "INTEGER", primaryKeyPosition: 1, hidden: 0, notNull: 0),
                .init(name: "event_id", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "event_type", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "incident_id", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "target_incident_digest", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "target_event_digest", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "subject_id_digest", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "subject_content_digest", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "retention_policy_digest", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "reason_code", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "predecessor_digest", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "event_digest", type: "TEXT", primaryKeyPosition: 0, hidden: 0),
                .init(name: "tombstoned_at_ms", type: "INTEGER", primaryKeyPosition: 0, hidden: 0),
                .init(name: "authorizing", type: "INTEGER", primaryKeyPosition: 0, hidden: 0),
                .init(name: "protected_authority_verified", type: "INTEGER", primaryKeyPosition: 0, hidden: 0),
                .init(name: "raw_content_stored", type: "INTEGER", primaryKeyPosition: 0, hidden: 0),
                .init(name: "physical_erasure_performed", type: "INTEGER", primaryKeyPosition: 0, hidden: 0),
            ]),
        ]
        for (tableName, expected) in expectedColumns {
            let pragma: String
            switch tableName {
            case "ledger_meta": pragma = "PRAGMA table_xinfo('ledger_meta');"
            case "incident_events": pragma = "PRAGMA table_xinfo('incident_events');"
            case "incident_failure_codes": pragma = "PRAGMA table_xinfo('incident_failure_codes');"
            case "incident_symptom_codes": pragma = "PRAGMA table_xinfo('incident_symptom_codes');"
            case "incident_tombstones": pragma = "PRAGMA table_xinfo('incident_tombstones');"
            default: preconditionFailure("Unregistered incident schema table.")
            }
            let observed = try withStatement(pragma) { statement in
                var columns: [IncidentSchemaColumnV1] = []
                while true {
                    let result = sqlite3_step(statement)
                    if result == SQLITE_DONE { break }
                    guard result == SQLITE_ROW else { throw sqliteError(result) }
                    columns.append(IncidentSchemaColumnV1(
                        name: text(statement, 1),
                        type: text(statement, 2),
                        primaryKeyPosition: sqlite3_column_int64(statement, 5),
                        hidden: sqlite3_column_int64(statement, 6),
                        notNull: sqlite3_column_int64(statement, 3),
                        defaultValue: sqlite3_column_type(statement, 4) == SQLITE_NULL
                            ? nil
                            : text(statement, 4)
                    ))
                }
                return columns
            }
            guard observed == expected else {
                throw IncidentLedgerErrorV1.integrity(
                    "Ledger table \(tableName) has a missing, extra, reordered, or mistyped column."
                )
            }
        }
        try verifyTableProperties()
        try verifyForeignKeys()
        try verifyIndexes()
    }

    private func verifyTableProperties() throws {
        let expected = [
            IncidentSchemaTableV1(name: "incident_events", columnCount: 16, withoutRowID: 0, strict: 1),
            IncidentSchemaTableV1(name: "incident_failure_codes", columnCount: 3, withoutRowID: 0, strict: 1),
            IncidentSchemaTableV1(name: "incident_symptom_codes", columnCount: 3, withoutRowID: 0, strict: 1),
            IncidentSchemaTableV1(name: "incident_tombstones", columnCount: 17, withoutRowID: 0, strict: 1),
            IncidentSchemaTableV1(name: "ledger_meta", columnCount: 13, withoutRowID: 0, strict: 1),
        ]
        let observed = try withStatement("PRAGMA table_list;") { statement in
            var tables: [IncidentSchemaTableV1] = []
            while true {
                let result = sqlite3_step(statement)
                if result == SQLITE_DONE { break }
                guard result == SQLITE_ROW else { throw sqliteError(result) }
                let name = text(statement, 1)
                if name.hasPrefix("sqlite_") { continue }
                guard text(statement, 0) == "main", text(statement, 2) == "table" else {
                    throw IncidentLedgerErrorV1.integrity(
                        "Ledger schema contains a non-main or non-table object."
                    )
                }
                tables.append(IncidentSchemaTableV1(
                    name: name,
                    columnCount: sqlite3_column_int64(statement, 3),
                    withoutRowID: sqlite3_column_int64(statement, 4),
                    strict: sqlite3_column_int64(statement, 5)
                ))
            }
            return tables.sorted { $0.name < $1.name }
        }
        guard observed == expected else {
            throw IncidentLedgerErrorV1.integrity(
                "Ledger table count, rowid mode, or STRICT property differs."
            )
        }
    }

    private func verifyForeignKeys() throws {
        let expectedByTable: [String: [IncidentSchemaForeignKeyV1]] = [
            "ledger_meta": [],
            "incident_events": [],
            "incident_failure_codes": [IncidentSchemaForeignKeyV1(
                identifier: 0,
                sequence: 0,
                referencedTable: "incident_events",
                sourceColumn: "event_ordinal",
                targetColumn: "ordinal",
                onUpdate: "NO ACTION",
                onDelete: "RESTRICT",
                match: "NONE"
            )],
            "incident_symptom_codes": [IncidentSchemaForeignKeyV1(
                identifier: 0,
                sequence: 0,
                referencedTable: "incident_events",
                sourceColumn: "event_ordinal",
                targetColumn: "ordinal",
                onUpdate: "NO ACTION",
                onDelete: "RESTRICT",
                match: "NONE"
            )],
            "incident_tombstones": [
                IncidentSchemaForeignKeyV1(
                    identifier: 0,
                    sequence: 0,
                    referencedTable: "incident_events",
                    sourceColumn: "incident_id",
                    targetColumn: "incident_id",
                    onUpdate: "NO ACTION",
                    onDelete: "RESTRICT",
                    match: "NONE"
                ),
                IncidentSchemaForeignKeyV1(
                    identifier: 0,
                    sequence: 1,
                    referencedTable: "incident_events",
                    sourceColumn: "target_incident_digest",
                    targetColumn: "incident_digest",
                    onUpdate: "NO ACTION",
                    onDelete: "RESTRICT",
                    match: "NONE"
                ),
                IncidentSchemaForeignKeyV1(
                    identifier: 0,
                    sequence: 2,
                    referencedTable: "incident_events",
                    sourceColumn: "target_event_digest",
                    targetColumn: "event_digest",
                    onUpdate: "NO ACTION",
                    onDelete: "RESTRICT",
                    match: "NONE"
                ),
                IncidentSchemaForeignKeyV1(
                    identifier: 0,
                    sequence: 3,
                    referencedTable: "incident_events",
                    sourceColumn: "subject_id_digest",
                    targetColumn: "subject_id_digest",
                    onUpdate: "NO ACTION",
                    onDelete: "RESTRICT",
                    match: "NONE"
                ),
                IncidentSchemaForeignKeyV1(
                    identifier: 0,
                    sequence: 4,
                    referencedTable: "incident_events",
                    sourceColumn: "subject_content_digest",
                    targetColumn: "subject_content_digest",
                    onUpdate: "NO ACTION",
                    onDelete: "RESTRICT",
                    match: "NONE"
                ),
            ],
        ]
        for tableName in expectedByTable.keys.sorted() {
            let sql = "PRAGMA foreign_key_list(\(Self.sqliteLiteral(tableName)));"
            let observed = try withStatement(sql) { statement in
                var foreignKeys: [IncidentSchemaForeignKeyV1] = []
                while true {
                    let result = sqlite3_step(statement)
                    if result == SQLITE_DONE { break }
                    guard result == SQLITE_ROW else { throw sqliteError(result) }
                    foreignKeys.append(IncidentSchemaForeignKeyV1(
                        identifier: sqlite3_column_int64(statement, 0),
                        sequence: sqlite3_column_int64(statement, 1),
                        referencedTable: text(statement, 2),
                        sourceColumn: text(statement, 3),
                        targetColumn: text(statement, 4),
                        onUpdate: text(statement, 5),
                        onDelete: text(statement, 6),
                        match: text(statement, 7)
                    ))
                }
                return foreignKeys
            }
            guard let expected = expectedByTable[tableName], observed == expected else {
                throw IncidentLedgerErrorV1.integrity(
                    "Ledger table \(tableName) has substituted foreign-key semantics."
                )
            }
        }
    }

    private func verifyIndexes() throws {
        let expectedByTable: [String: [IncidentSchemaIndexV1]] = [
            "ledger_meta": [],
            "incident_events": [
                .init(unique: 1, origin: "u", partial: 0, keyColumns: ["event_digest"]),
                .init(unique: 1, origin: "u", partial: 0, keyColumns: ["event_id"]),
                .init(unique: 1, origin: "u", partial: 0, keyColumns: ["incident_digest"]),
                .init(unique: 1, origin: "u", partial: 0, keyColumns: ["incident_id"]),
                .init(unique: 1, origin: "u", partial: 0, keyColumns: ["observation_key"]),
                .init(
                    unique: 1,
                    origin: "u",
                    partial: 0,
                    keyColumns: [
                        "incident_id", "incident_digest", "event_digest",
                        "subject_id_digest", "subject_content_digest",
                    ]
                ),
            ],
            "incident_failure_codes": [
                .init(unique: 1, origin: "u", partial: 0, keyColumns: ["event_ordinal", "code"]),
                .init(unique: 1, origin: "pk", partial: 0, keyColumns: ["event_ordinal", "position"]),
            ],
            "incident_symptom_codes": [
                .init(unique: 1, origin: "u", partial: 0, keyColumns: ["event_ordinal", "code"]),
                .init(unique: 1, origin: "pk", partial: 0, keyColumns: ["event_ordinal", "position"]),
            ],
            "incident_tombstones": [
                .init(unique: 1, origin: "u", partial: 0, keyColumns: ["event_digest"]),
                .init(unique: 1, origin: "u", partial: 0, keyColumns: ["event_id"]),
                .init(unique: 1, origin: "u", partial: 0, keyColumns: ["incident_id"]),
            ],
        ]
        for tableName in expectedByTable.keys.sorted() {
            let listSQL = "PRAGMA index_list(\(Self.sqliteLiteral(tableName)));"
            let rows = try withStatement(listSQL) { statement in
                var values: [(name: String, unique: Int64, origin: String, partial: Int64)] = []
                while true {
                    let result = sqlite3_step(statement)
                    if result == SQLITE_DONE { break }
                    guard result == SQLITE_ROW else { throw sqliteError(result) }
                    values.append((
                        name: text(statement, 1),
                        unique: sqlite3_column_int64(statement, 2),
                        origin: text(statement, 3),
                        partial: sqlite3_column_int64(statement, 4)
                    ))
                }
                return values
            }
            var observed: [IncidentSchemaIndexV1] = []
            for row in rows {
                let xinfoSQL = "PRAGMA index_xinfo(\(Self.sqliteLiteral(row.name)));"
                let keyColumns = try withStatement(xinfoSQL) { statement in
                    var keys: [String] = []
                    var auxiliaryRows = 0
                    while true {
                        let result = sqlite3_step(statement)
                        if result == SQLITE_DONE { break }
                        guard result == SQLITE_ROW else { throw sqliteError(result) }
                        let columnID = sqlite3_column_int64(statement, 1)
                        let descending = sqlite3_column_int64(statement, 3)
                        let collation = text(statement, 4)
                        let isKey = sqlite3_column_int64(statement, 5)
                        guard descending == 0, collation == "BINARY" else {
                            throw IncidentLedgerErrorV1.integrity(
                                "Ledger index ordering or collation differs."
                            )
                        }
                        if isKey == 1 {
                            guard columnID >= 0,
                                  sqlite3_column_type(statement, 2) != SQLITE_NULL else {
                                throw IncidentLedgerErrorV1.integrity(
                                    "Ledger index contains an expression key."
                                )
                            }
                            keys.append(text(statement, 2))
                        } else {
                            guard columnID == -1 else {
                                throw IncidentLedgerErrorV1.integrity(
                                    "Ledger index contains an unexpected auxiliary column."
                                )
                            }
                            auxiliaryRows += 1
                        }
                    }
                    guard auxiliaryRows == 1, !keys.isEmpty else {
                        throw IncidentLedgerErrorV1.integrity(
                            "Ledger index key shape differs."
                        )
                    }
                    return keys
                }
                observed.append(.init(
                    unique: row.unique,
                    origin: row.origin,
                    partial: row.partial,
                    keyColumns: keyColumns
                ))
            }
            observed.sort(by: Self.indexDescriptorLessThan)
            let expected = (expectedByTable[tableName] ?? []).sorted(by: Self.indexDescriptorLessThan)
            guard observed == expected else {
                throw IncidentLedgerErrorV1.integrity(
                    "Ledger table \(tableName) has missing or substituted uniqueness indexes."
                )
            }
        }
    }

    private static func indexDescriptorLessThan(
        _ lhs: IncidentSchemaIndexV1,
        _ rhs: IncidentSchemaIndexV1
    ) -> Bool {
        let left = "\(lhs.origin)|\(lhs.keyColumns.joined(separator: ","))"
        let right = "\(rhs.origin)|\(rhs.keyColumns.joined(separator: ","))"
        return left < right
    }

    private static func normalizeSchemaSQL(_ sql: String) -> String {
        let trimmed = sql.trimmingCharacters(in: .whitespacesAndNewlines)
        let withoutSemicolon = trimmed.last == ";" ? String(trimmed.dropLast()) : trimmed
        return withoutSemicolon.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    private static func sqliteLiteral(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "''"))'"
    }

    private func verifyMetadataIdentity() throws {
        try withStatement(
            """
            SELECT schema_version, profile, scope_id, project_digest,
                   access_policy_digest, retention_policy_digest, genesis_digest,
                   authorizing, protected_authority_verified, raw_content_stored
            FROM ledger_meta WHERE singleton = 1;
            """
        ) { statement in
            guard sqlite3_step(statement) == SQLITE_ROW else {
                throw IncidentLedgerErrorV1.integrity("Ledger metadata is missing.")
            }
            guard
                sqlite3_column_int64(statement, 0) == Int64(Self.schemaVersion),
                text(statement, 1) == Self.profile,
                text(statement, 2) == scope.scopeID,
                text(statement, 3) == scope.projectDigest,
                text(statement, 4) == scope.accessPolicyDigest,
                text(statement, 5) == scope.retentionPolicyDigest,
                text(statement, 6) == genesisDigest,
                sqlite3_column_int64(statement, 7) == 0,
                sqlite3_column_int64(statement, 8) == 0,
                sqlite3_column_int64(statement, 9) == 0,
                sqlite3_step(statement) == SQLITE_DONE
            else {
                throw IncidentLedgerErrorV1.integrity("Ledger metadata identity or zero-authority flags differ.")
            }
        }
    }

    private func readMetadata() throws -> IncidentLedgerMetadataV1 {
        try withStatement(
            "SELECT event_count, head_digest FROM ledger_meta WHERE singleton = 1;"
        ) { statement in
            guard sqlite3_step(statement) == SQLITE_ROW else {
                throw IncidentLedgerErrorV1.integrity("Ledger metadata is missing.")
            }
            let metadata = IncidentLedgerMetadataV1(
                eventCount: sqlite3_column_int64(statement, 0),
                headDigest: text(statement, 1)
            )
            guard sqlite3_step(statement) == SQLITE_DONE else {
                throw IncidentLedgerErrorV1.integrity("Ledger metadata is duplicated.")
            }
            return metadata
        }
    }

    private func readAllLedgerEvents() throws -> [StoredLedgerEventV1] {
        var events = try withStatement(
            "SELECT \(Self.eventColumns) FROM incident_events ORDER BY ordinal ASC;"
        ) { statement in
            var events: [StoredLedgerEventV1] = []
            while true {
                let result = sqlite3_step(statement)
                if result == SQLITE_DONE { break }
                guard result == SQLITE_ROW else { throw sqliteError(result) }
                events.append(.observation(try readEvent(statement)))
            }
            return events
        }
        try withStatement(
            "SELECT \(Self.tombstoneColumns) FROM incident_tombstones ORDER BY ordinal ASC;"
        ) { statement in
            while true {
                let result = sqlite3_step(statement)
                if result == SQLITE_DONE { break }
                guard result == SQLITE_ROW else { throw sqliteError(result) }
                events.append(.tombstone(try readTombstone(statement)))
            }
        }
        return events.sorted { $0.ordinal < $1.ordinal }
    }

    private func event(forObservationKey key: String) throws -> StoredIncidentEventV1? {
        try oneEvent(
            sql: "SELECT \(Self.eventColumns) FROM incident_events WHERE observation_key = ?;",
            value: key
        )
    }

    private func event(forIncidentID incidentID: String) throws -> StoredIncidentEventV1? {
        try oneEvent(
            sql: "SELECT \(Self.eventColumns) FROM incident_events WHERE incident_id = ?;",
            value: incidentID
        )
    }

    private func event(forOrdinal ordinal: Int64) throws -> StoredIncidentEventV1? {
        try withStatement(
            "SELECT \(Self.eventColumns) FROM incident_events WHERE ordinal = ?;"
        ) { statement in
            sqlite3_bind_int64(statement, 1, ordinal)
            let result = sqlite3_step(statement)
            if result == SQLITE_DONE { return nil }
            guard result == SQLITE_ROW else { throw sqliteError(result) }
            let event = try readEvent(statement)
            guard sqlite3_step(statement) == SQLITE_DONE else {
                throw IncidentLedgerErrorV1.integrity(
                    "A unique observation-ordinal lookup returned multiple rows."
                )
            }
            return event
        }
    }

    private func retentionSweepCandidates(
        cutoffAtMilliseconds: Int64,
        initialEventHighWatermark: Int64,
        after cursor: (
            retentionReviewAtMilliseconds: Int64,
            observationOrdinal: Int64
        )?,
        limit: Int
    ) throws -> [StoredIncidentEventV1] {
        let cursorPredicate = cursor == nil ? "" : """
              AND (
                    e.retention_review_at_ms > ?
                    OR (
                         e.retention_review_at_ms = ?
                         AND e.ordinal > ?
                    )
                  )
            """
        let sql = """
            SELECT \(Self.eventColumns)
            FROM incident_events AS e
            WHERE e.retention_review_at_ms IS NOT NULL
              AND e.retention_review_at_ms <= ?
              AND e.ordinal <= ?
            \(cursorPredicate)
              AND NOT EXISTS (
                    SELECT 1
                    FROM incident_tombstones AS u
                    WHERE u.incident_id = e.incident_id
                      AND u.reason_code = 'USER_REQUESTED'
                  )
            ORDER BY e.retention_review_at_ms ASC, e.ordinal ASC
            LIMIT ?;
            """
        return try withStatement(sql) { statement in
            var bindIndex: Int32 = 1
            sqlite3_bind_int64(statement, bindIndex, cutoffAtMilliseconds)
            bindIndex += 1
            sqlite3_bind_int64(statement, bindIndex, initialEventHighWatermark)
            bindIndex += 1
            if let cursor {
                sqlite3_bind_int64(
                    statement,
                    bindIndex,
                    cursor.retentionReviewAtMilliseconds
                )
                bindIndex += 1
                sqlite3_bind_int64(
                    statement,
                    bindIndex,
                    cursor.retentionReviewAtMilliseconds
                )
                bindIndex += 1
                sqlite3_bind_int64(
                    statement,
                    bindIndex,
                    cursor.observationOrdinal
                )
                bindIndex += 1
            }
            sqlite3_bind_int64(statement, bindIndex, Int64(limit))
            var events: [StoredIncidentEventV1] = []
            events.reserveCapacity(limit)
            while true {
                let result = sqlite3_step(statement)
                if result == SQLITE_DONE { break }
                guard result == SQLITE_ROW else { throw sqliteError(result) }
                events.append(try readEvent(statement))
            }
            return events
        }
    }

    private func retentionSweepPrefixIsResolved(
        cutoffAtMilliseconds: Int64,
        initialEventHighWatermark: Int64,
        throughRetentionReviewAtMilliseconds: Int64,
        throughObservationOrdinal: Int64
    ) throws -> Bool {
        try withStatement(
            """
            SELECT COUNT(*)
            FROM incident_events AS e
            WHERE e.retention_review_at_ms IS NOT NULL
              AND e.retention_review_at_ms <= ?
              AND e.ordinal <= ?
              AND (
                    e.retention_review_at_ms < ?
                    OR (
                         e.retention_review_at_ms = ?
                         AND e.ordinal <= ?
                    )
                  )
              AND NOT EXISTS (
                    SELECT 1
                    FROM incident_tombstones AS t
                    WHERE t.incident_id = e.incident_id
                  );
            """
        ) { statement in
            sqlite3_bind_int64(statement, 1, cutoffAtMilliseconds)
            sqlite3_bind_int64(statement, 2, initialEventHighWatermark)
            sqlite3_bind_int64(
                statement,
                3,
                throughRetentionReviewAtMilliseconds
            )
            sqlite3_bind_int64(
                statement,
                4,
                throughRetentionReviewAtMilliseconds
            )
            sqlite3_bind_int64(statement, 5, throughObservationOrdinal)
            guard sqlite3_step(statement) == SQLITE_ROW else {
                throw IncidentLedgerErrorV1.integrity(
                    "Retention-sweep prefix query returned no count."
                )
            }
            let unresolvedCount = sqlite3_column_int64(statement, 0)
            guard unresolvedCount >= 0,
                  sqlite3_step(statement) == SQLITE_DONE else {
                throw IncidentLedgerErrorV1.integrity(
                    "Retention-sweep prefix query returned an invalid count."
                )
            }
            return unresolvedCount == 0
        }
    }

    private func tombstone(
        forIncidentID incidentID: String
    ) throws -> StoredIncidentTombstoneV1? {
        try withStatement(
            "SELECT \(Self.tombstoneColumns) FROM incident_tombstones WHERE incident_id = ?;"
        ) { statement in
            try bindText(incidentID, at: 1, to: statement)
            let result = sqlite3_step(statement)
            if result == SQLITE_DONE { return nil }
            guard result == SQLITE_ROW else { throw sqliteError(result) }
            let event = try readTombstone(statement)
            guard sqlite3_step(statement) == SQLITE_DONE else {
                throw IncidentLedgerErrorV1.integrity(
                    "A unique tombstone lookup returned multiple rows."
                )
            }
            return event
        }
    }

    private func oneEvent(sql: String, value: String) throws -> StoredIncidentEventV1? {
        try withStatement(sql) { statement in
            try bindText(value, at: 1, to: statement)
            let result = sqlite3_step(statement)
            if result == SQLITE_DONE { return nil }
            guard result == SQLITE_ROW else { throw sqliteError(result) }
            let event = try readEvent(statement)
            guard sqlite3_step(statement) == SQLITE_DONE else {
                throw IncidentLedgerErrorV1.integrity("A unique incident lookup returned multiple rows.")
            }
            return event
        }
    }

    private func readEvent(_ statement: OpaquePointer) throws -> StoredIncidentEventV1 {
        let ordinal = sqlite3_column_int64(statement, 0)
        guard
            text(statement, 2) == Self.observationEventType,
            sqlite3_column_int64(statement, 13) == 0,
            sqlite3_column_int64(statement, 14) == 0,
            sqlite3_column_int64(statement, 15) == 0
        else {
            throw IncidentLedgerErrorV1.integrity("Event type or zero-authority flags differ.")
        }
        let rawFailureCodes = try readCodes(table: "incident_failure_codes", ordinal: ordinal)
        let rawSymptomCodes = try readCodes(table: "incident_symptom_codes", ordinal: ordinal)
        let failureCodes = try Self.decodeFailureCodes(rawFailureCodes)
        let symptomCodes = try Self.decodeSymptomCodes(rawSymptomCodes)
        return StoredIncidentEventV1(
            ordinal: ordinal,
            eventID: text(statement, 1),
            incidentID: text(statement, 3),
            incidentDigest: text(statement, 4),
            observationKey: text(statement, 5),
            subjectIDDigest: text(statement, 6),
            subjectContentDigest: text(statement, 7),
            evidenceSetDigest: text(statement, 8),
            predecessorDigest: text(statement, 9),
            eventDigest: text(statement, 10),
            observedAtMilliseconds: sqlite3_column_int64(statement, 11),
            retentionReviewAtMilliseconds: sqlite3_column_type(statement, 12) == SQLITE_NULL
                ? nil
                : sqlite3_column_int64(statement, 12),
            failureCodes: failureCodes,
            symptomCodes: symptomCodes
        )
    }

    private func readTombstone(
        _ statement: OpaquePointer
    ) throws -> StoredIncidentTombstoneV1 {
        guard
            text(statement, 2) == Self.tombstoneEventType,
            let reason = IncidentTombstoneReasonV1(rawValue: text(statement, 9)),
            sqlite3_column_int64(statement, 13) == 0,
            sqlite3_column_int64(statement, 14) == 0,
            sqlite3_column_int64(statement, 15) == 0,
            sqlite3_column_int64(statement, 16) == 0
        else {
            throw IncidentLedgerErrorV1.integrity(
                "Tombstone type, reason, or zero-authority flags differ."
            )
        }
        return StoredIncidentTombstoneV1(
            ordinal: sqlite3_column_int64(statement, 0),
            eventID: text(statement, 1),
            incidentID: text(statement, 3),
            targetIncidentDigest: text(statement, 4),
            targetEventDigest: text(statement, 5),
            subjectIDDigest: text(statement, 6),
            subjectContentDigest: text(statement, 7),
            retentionPolicyDigest: text(statement, 8),
            reason: reason,
            predecessorDigest: text(statement, 10),
            eventDigest: text(statement, 11),
            tombstonedAtMilliseconds: sqlite3_column_int64(statement, 12)
        )
    }

    private func readCodes(table: String, ordinal: Int64) throws -> [String] {
        precondition(["incident_failure_codes", "incident_symptom_codes"].contains(table))
        return try withStatement(
            "SELECT position, code FROM \(table) WHERE event_ordinal = ? ORDER BY position ASC;"
        ) { statement in
            sqlite3_bind_int64(statement, 1, ordinal)
            var codes: [String] = []
            while true {
                let result = sqlite3_step(statement)
                if result == SQLITE_DONE { break }
                guard result == SQLITE_ROW else { throw sqliteError(result) }
                guard sqlite3_column_int64(statement, 0) == Int64(codes.count) else {
                    throw IncidentLedgerErrorV1.integrity("Incident codes contain a position gap.")
                }
                codes.append(text(statement, 1))
            }
            return codes
        }
    }

    private func summary(from event: StoredIncidentEventV1) throws -> IncidentSummaryV1 {
        IncidentSummaryV1(
            projectDigest: scope.projectDigest,
            ordinal: event.ordinal,
            eventID: event.eventID,
            incidentID: event.incidentID,
            incidentDigest: event.incidentDigest,
            observationKey: event.observationKey,
            subjectIDDigest: event.subjectIDDigest,
            subjectContentDigest: event.subjectContentDigest,
            evidenceSetDigest: event.evidenceSetDigest,
            failureCodes: event.failureCodes,
            symptomCodes: event.symptomCodes,
            observedAt: Self.date(event.observedAtMilliseconds),
            retentionReviewAt: event.retentionReviewAtMilliseconds.map(Self.date),
            eventDigest: event.eventDigest,
            authorizing: false,
            protectedAuthorityVerified: false,
            rawContentStored: false
        )
    }

    private func applyPrivateFileModes() throws {
        for (url, maximumBytes) in [
            (databaseURL, Self.maximumDatabaseBytes),
            (URL(fileURLWithPath: databaseURL.path + "-wal"), Self.maximumSidecarBytes),
            (URL(fileURLWithPath: databaseURL.path + "-shm"), Self.maximumSidecarBytes),
        ] {
            if try Self.fileStatusIfPresent(at: url) != nil {
                try Self.hardenPrivateRegularFile(at: url)
                try Self.requireAdmittedFileSize(at: url, maximumBytes: maximumBytes)
            }
        }
    }

    private func withVerifiedReadTransaction<T>(
        _ body: (IncidentLedgerVerificationV1) throws -> T
    ) throws -> T {
        try requireOpenedDatabaseFileIdentity()
        try applyPrivateFileModes()
        try execute("BEGIN;")
        do {
            let verification = try verifyIntegrityInternal()
            let value = try body(verification)
            try requireOpenedDatabaseFileIdentity()
            try execute("COMMIT;")
            return value
        } catch {
            let originalError = error
            try rollbackOrPoison()
            throw originalError
        }
    }

    private func rollbackOrPoison() throws {
        do {
            try faultInjector?(.beforeRollback)
            try execute("ROLLBACK;")
        } catch {
            transactionIntegrityPoisoned = true
            if let database {
                let observerError = handleBox.namespaceObserver?.stop()
                let closeResult = sqlite3_close_v2(database)
                guard closeResult == SQLITE_OK else {
                    throw IncidentLedgerErrorV1.integrity(
                        "Transaction rollback failed; the ledger is poisoned and SQLite handle closure was not confirmed."
                    )
                }
                self.database = nil
                if let observerError { throw IncidentLedgerErrorV1.namespaceObservation(observerError) }
            }
            throw IncidentLedgerErrorV1.integrity(
                "Transaction rollback failed; the ledger was closed and must be reopened."
            )
        }
    }

    private static func isStrictDescendant(_ child: URL, of root: URL) -> Bool {
        let rootPath = root.standardizedFileURL.path
        let childPath = child.standardizedFileURL.path
        return childPath.hasPrefix(rootPath + "/")
    }

    private static func requireDirectoryWithoutSymlink(at url: URL) throws {
        guard let status = try fileStatusIfPresent(at: url) else {
            throw IncidentLedgerErrorV1.unsupportedStorage
        }
        guard fileType(status) == mode_t(0o040000) else {
            throw IncidentLedgerErrorV1.unsupportedStorage
        }
    }

    private static func createOrHardenPrivateDirectory(at url: URL) throws {
        if try fileStatusIfPresent(at: url) == nil {
            try FileManager.default.createDirectory(
                at: url,
                withIntermediateDirectories: false,
                attributes: [.posixPermissions: NSNumber(value: 0o700)]
            )
        }
        guard let initialStatus = try fileStatusIfPresent(at: url) else {
            throw IncidentLedgerErrorV1.integrity("Private ledger directory disappeared.")
        }
        guard fileType(initialStatus) == mode_t(0o040000) else {
            throw IncidentLedgerErrorV1.integrity(
                "Private ledger directory is missing, redirected, or not a directory."
            )
        }
        guard Darwin.chmod(url.path, mode_t(0o700)) == 0 else {
            throw filesystemError("Unable to harden private ledger directory")
        }
        let hardenedStatus = try requiredFileStatus(at: url)
        guard
            fileType(hardenedStatus) == mode_t(0o040000),
            hardenedStatus.st_uid == geteuid(),
            hardenedStatus.st_mode & mode_t(0o777) == mode_t(0o700)
        else {
            throw IncidentLedgerErrorV1.integrity(
                "Private ledger directory ownership or mode is not admitted."
            )
        }
    }

    /// Acquires one owner-only, cooperative lock on the admitted project-directory
    /// descriptor. All conforming Veritas opens hold it through bootstrap and any
    /// failed-first-open cleanup without adding an inventory file. Same-user
    /// directory replacement can bypass this and remains outside the Alpha claim.
    private static func acquireProjectOpenLock(at url: URL) throws -> Int32 {
        let descriptor = Darwin.open(
            url.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK
        )
        guard descriptor >= 0 else {
            throw filesystemError("Unable to open project directory for coordination")
        }

        do {
            var descriptorStatus = stat()
            guard Darwin.fstat(descriptor, &descriptorStatus) == 0 else {
                throw filesystemError("Unable to inspect project coordination descriptor")
            }
            let descriptorIdentity = IncidentFileIdentityV1(
                device: descriptorStatus.st_dev,
                inode: descriptorStatus.st_ino
            )
            guard
                fileType(descriptorStatus) == mode_t(0o040000),
                descriptorStatus.st_uid == geteuid(),
                descriptorStatus.st_mode & mode_t(0o777) == mode_t(0o700)
            else {
                throw IncidentLedgerErrorV1.integrity(
                    "Project coordination descriptor is not an admitted owner-only directory."
                )
            }
            let pathStatus = try requiredFileStatus(at: url)
            guard
                fileType(pathStatus) == mode_t(0o040000),
                pathStatus.st_uid == geteuid(),
                pathStatus.st_mode & mode_t(0o777) == mode_t(0o700),
                IncidentFileIdentityV1(
                    device: pathStatus.st_dev,
                    inode: pathStatus.st_ino
                ) == descriptorIdentity
            else {
                throw IncidentLedgerErrorV1.integrity(
                    "Project directory changed identity before coordination."
                )
            }
            guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
                throw IncidentLedgerErrorV1.integrity(
                    "Another conforming process is opening this project ledger."
                )
            }
            let lockedPathStatus = try requiredFileStatus(at: url)
            guard fileType(lockedPathStatus) == mode_t(0o040000),
                  lockedPathStatus.st_uid == geteuid(),
                  lockedPathStatus.st_mode & mode_t(0o777) == mode_t(0o700),
                  IncidentFileIdentityV1(
                      device: lockedPathStatus.st_dev,
                      inode: lockedPathStatus.st_ino
                  ) == descriptorIdentity else {
                throw IncidentLedgerErrorV1.integrity(
                    "Project directory changed identity during coordination."
                )
            }
            return descriptor
        } catch {
            let acquisitionError = error
            _ = flock(descriptor, LOCK_UN)
            let closeResult = Darwin.close(descriptor)
            guard closeResult == 0 else {
                throw IncidentLedgerErrorV1.integrity(
                    "Project coordination failed and descriptor closure was not confirmed."
                )
            }
            throw acquisitionError
        }
    }

    private static func releaseProjectOpenLock(_ descriptor: Int32) throws {
        let unlockResult = flock(descriptor, LOCK_UN)
        let closeResult = Darwin.close(descriptor)
        guard unlockResult == 0, closeResult == 0 else {
            throw IncidentLedgerErrorV1.integrity(
                "Project coordination release was not confirmed."
            )
        }
    }

    /// One best-effort release attempt after another error is already in flight.
    /// No second close is attempted when the result is indeterminate.
    private static func releaseProjectOpenLockAfterFailure(_ descriptor: Int32) {
        _ = flock(descriptor, LOCK_UN)
        _ = Darwin.close(descriptor)
    }

    private static func securelyCreatePrivateFile(
        at url: URL
    ) throws -> IncidentFileIdentityV1 {
        let descriptor = Darwin.open(
            url.path,
            O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            mode_t(0o600)
        )
        guard descriptor >= 0 else {
            throw filesystemError("Unable to create private ledger database")
        }

        var initialStatus = stat()
        guard Darwin.fstat(descriptor, &initialStatus) == 0 else {
            let closeResult = Darwin.close(descriptor)
            guard closeResult == 0 else {
                throw IncidentLedgerErrorV1.integrity(
                    "New ledger descriptor inspection failed and closure was not confirmed; the path was retained."
                )
            }
            throw IncidentLedgerErrorV1.integrity(
                "New ledger descriptor inspection failed; the unverified path was retained."
            )
        }
        let createdIdentity = IncidentFileIdentityV1(
            device: initialStatus.st_dev,
            inode: initialStatus.st_ino
        )

        do {
            guard
                fileType(initialStatus) == mode_t(0o100000),
                initialStatus.st_nlink == 1,
                initialStatus.st_uid == geteuid()
            else {
                throw IncidentLedgerErrorV1.integrity(
                    "New ledger descriptor is not an admitted owner-only regular file."
                )
            }
            let hardenedIdentity = try hardenPrivateRegularFileDescriptor(
                descriptor,
                expectedIdentity: createdIdentity
            )
            guard hardenedIdentity == createdIdentity else {
                throw IncidentLedgerErrorV1.integrity(
                    "New ledger descriptor changed identity while it was being hardened."
                )
            }
        } catch {
            let hardeningError = error
            let closeResult = Darwin.close(descriptor)
            guard closeResult == 0 else {
                throw IncidentLedgerErrorV1.integrity(
                    "New ledger hardening failed and descriptor closure was not confirmed; the path was retained."
                )
            }
            try removeFailedNewStoreIfUnchanged(
                databaseURL: url,
                expectedIdentity: createdIdentity
            )
            throw hardeningError
        }

        guard Darwin.close(descriptor) == 0 else {
            throw IncidentLedgerErrorV1.integrity(
                "New ledger descriptor closure was not confirmed; the path was retained."
            )
        }

        do {
            let currentIdentity = try validatedPrivateRegularFileIdentity(at: url)
            guard currentIdentity == createdIdentity else {
                throw IncidentLedgerErrorV1.integrity(
                    "New ledger path changed identity after descriptor closure."
                )
            }
            return createdIdentity
        } catch {
            let validationError = error
            try removeFailedNewStoreIfUnchanged(
                databaseURL: url,
                expectedIdentity: createdIdentity
            )
            throw validationError
        }
    }

    @discardableResult
    private static func hardenPrivateRegularFile(
        at url: URL
    ) throws -> IncidentFileIdentityV1 {
        let descriptor = Darwin.open(
            url.path,
            O_RDWR | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK
        )
        guard descriptor >= 0 else {
            throw filesystemError("Unable to open private ledger file without following links")
        }

        let hardenedIdentity: IncidentFileIdentityV1
        do {
            hardenedIdentity = try hardenPrivateRegularFileDescriptor(
                descriptor,
                expectedIdentity: nil
            )
        } catch {
            let hardeningError = error
            let closeResult = Darwin.close(descriptor)
            guard closeResult == 0 else {
                throw IncidentLedgerErrorV1.integrity(
                    "Private ledger hardening failed and descriptor closure was not confirmed."
                )
            }
            throw hardeningError
        }

        guard Darwin.close(descriptor) == 0 else {
            throw IncidentLedgerErrorV1.integrity(
                "Private ledger descriptor closure was not confirmed."
            )
        }
        let currentIdentity = try validatedPrivateRegularFileIdentity(at: url)
        guard currentIdentity == hardenedIdentity else {
            throw IncidentLedgerErrorV1.integrity(
                "Private ledger path changed identity after hardening."
            )
        }
        return hardenedIdentity
    }

    private static func hardenPrivateRegularFileDescriptor(
        _ descriptor: Int32,
        expectedIdentity: IncidentFileIdentityV1?
    ) throws -> IncidentFileIdentityV1 {
        var initialStatus = stat()
        guard Darwin.fstat(descriptor, &initialStatus) == 0 else {
            throw filesystemError("Unable to inspect private ledger descriptor")
        }
        let initialIdentity = IncidentFileIdentityV1(
            device: initialStatus.st_dev,
            inode: initialStatus.st_ino
        )
        guard
            fileType(initialStatus) == mode_t(0o100000),
            initialStatus.st_nlink == 1,
            initialStatus.st_uid == geteuid(),
            expectedIdentity == nil || expectedIdentity == initialIdentity
        else {
            throw IncidentLedgerErrorV1.integrity(
                "Ledger descriptor identity, ownership, link count, or type is not admitted."
            )
        }
        guard Darwin.fchmod(descriptor, mode_t(0o600)) == 0 else {
            throw filesystemError("Unable to harden private ledger descriptor")
        }

        var hardenedStatus = stat()
        guard Darwin.fstat(descriptor, &hardenedStatus) == 0 else {
            throw filesystemError("Unable to re-inspect hardened private ledger descriptor")
        }
        let hardenedIdentity = IncidentFileIdentityV1(
            device: hardenedStatus.st_dev,
            inode: hardenedStatus.st_ino
        )
        guard
            hardenedIdentity == initialIdentity,
            fileType(hardenedStatus) == mode_t(0o100000),
            hardenedStatus.st_nlink == 1,
            hardenedStatus.st_uid == geteuid(),
            hardenedStatus.st_mode & mode_t(0o777) == mode_t(0o600)
        else {
            throw IncidentLedgerErrorV1.integrity(
                "Private ledger descriptor changed identity or failed owner-only hardening."
            )
        }
        return hardenedIdentity
    }

    /// Read-only current-path validation. This does not bind the path to the
    /// SQLite handle and remains subject to same-user ABA and TOCTOU races.
    private static func validatedPrivateRegularFileIdentity(
        at url: URL
    ) throws -> IncidentFileIdentityV1 {
        let status = try requiredFileStatus(at: url)
        guard
            fileType(status) == mode_t(0o100000),
            status.st_nlink == 1,
            status.st_uid == geteuid(),
            status.st_mode & mode_t(0o777) == mode_t(0o600)
        else {
            throw IncidentLedgerErrorV1.integrity(
                "Private ledger path ownership, mode, link count, or type is not admitted."
            )
        }
        return IncidentFileIdentityV1(device: status.st_dev, inode: status.st_ino)
    }

    private static func validatedPrivateDirectoryIdentity(
        at url: URL
    ) throws -> IncidentFileIdentityV1 {
        let status = try requiredFileStatus(at: url)
        guard
            fileType(status) == mode_t(0o040000),
            status.st_uid == geteuid(),
            status.st_mode & mode_t(0o777) == mode_t(0o700)
        else {
            throw IncidentLedgerErrorV1.integrity(
                "Private ledger project directory ownership, mode, or type is not admitted."
            )
        }
        return IncidentFileIdentityV1(device: status.st_dev, inode: status.st_ino)
    }

    /// Rechecks the current primary path against the identity captured by this
    /// exact ledger open without mutating a replacement. The retention sweep calls
    /// this at every page entry, including the first page, before trusting a
    /// continuation. All ledger read and mutation surfaces also use it at entry
    /// and before publication. This remains current-path re-attestation—not
    /// SQLite-handle identity, protected rollback, or path-swap proof.
    private func requireOpenedDatabaseFileIdentity() throws {
        try ensureOpen()
        guard !currentPathIntegrityRefused else {
            throw IncidentLedgerErrorV1.integrity(
                "This ledger previously observed current-path identity drift."
            )
        }
        let currentProjectIdentity: IncidentFileIdentityV1
        let current: IncidentFileIdentityV1
        do {
            currentProjectIdentity = try Self.validatedPrivateDirectoryIdentity(
                at: databaseURL.deletingLastPathComponent()
            )
            current = try Self.validatedPrivateRegularFileIdentity(at: databaseURL)
        } catch {
            currentPathIntegrityRefused = true
            throw error
        }
        guard currentProjectIdentity == projectDirectoryIdentity else {
            currentPathIntegrityRefused = true
            throw IncidentLedgerErrorV1.integrity(
                "Project directory identity no longer matches this open ledger."
            )
        }
        guard current == databaseFileIdentity else {
            currentPathIntegrityRefused = true
            throw IncidentLedgerErrorV1.integrity(
                "Primary ledger file identity no longer matches this open ledger."
            )
        }
        try pollNamespaceObserver()
    }

    private static func requireAdmittedFileSize(
        at url: URL,
        maximumBytes: Int64
    ) throws {
        let status = try requiredFileStatus(at: url)
        guard status.st_size >= 0, status.st_size <= maximumBytes else {
            throw IncidentLedgerErrorV1.integrity(
                "Ledger file exceeds the admitted byte capacity."
            )
        }
    }

    private static func removeFailedNewStoreIfUnchanged(
        databaseURL: URL,
        expectedIdentity: IncidentFileIdentityV1
    ) throws {
        guard let primaryStatus = try fileStatusIfPresent(at: databaseURL) else { return }
        guard
            fileType(primaryStatus) == mode_t(0o100000),
            primaryStatus.st_uid == geteuid(),
            primaryStatus.st_nlink == 1,
            primaryStatus.st_dev == expectedIdentity.device,
            primaryStatus.st_ino == expectedIdentity.inode
        else {
            throw IncidentLedgerErrorV1.integrity(
                "Failed first-open database changed identity; cleanup was refused."
            )
        }

        for sidecarURL in [
            URL(fileURLWithPath: databaseURL.path + "-wal"),
            URL(fileURLWithPath: databaseURL.path + "-shm"),
        ] {
            guard let sidecarStatus = try fileStatusIfPresent(at: sidecarURL) else { continue }
            guard
                fileType(sidecarStatus) == mode_t(0o100000),
                sidecarStatus.st_uid == geteuid(),
                sidecarStatus.st_nlink == 1
            else {
                throw IncidentLedgerErrorV1.integrity(
                    "Failed first-open sidecar is not an admitted cleanup candidate."
                )
            }
            guard Darwin.unlink(sidecarURL.path) == 0 else {
                throw filesystemError("Unable to remove failed first-open sidecar")
            }
        }
        guard Darwin.unlink(databaseURL.path) == 0 else {
            throw filesystemError("Unable to remove failed first-open database")
        }
    }

    private static func fileStatusIfPresent(at url: URL) throws -> stat? {
        var status = stat()
        let result = url.path.withCString { Darwin.lstat($0, &status) }
        if result == 0 { return status }
        if errno == ENOENT { return nil }
        throw filesystemError("Unable to inspect private ledger path")
    }

    private static func requiredFileStatus(at url: URL) throws -> stat {
        guard let status = try fileStatusIfPresent(at: url) else {
            throw IncidentLedgerErrorV1.integrity("Private ledger path disappeared.")
        }
        return status
    }

    private static func fileType(_ status: stat) -> mode_t {
        status.st_mode & mode_t(0o170000)
    }

    private static func filesystemError(_ prefix: String) -> IncidentLedgerErrorV1 {
        .integrity("\(prefix): errno \(errno).")
    }

    private func ensureOpen() throws {
        guard database != nil, !transactionIntegrityPoisoned else {
            throw IncidentLedgerErrorV1.closed
        }
    }

    private func execute(_ sql: String) throws {
        guard let database else { throw IncidentLedgerErrorV1.closed }
        var messagePointer: UnsafeMutablePointer<CChar>?
        let result = sqlite3_exec(database, sql, nil, nil, &messagePointer)
        if result != SQLITE_OK {
            let message = messagePointer.map { String(cString: $0) }
                ?? String(cString: sqlite3_errmsg(database))
            sqlite3_free(messagePointer)
            throw IncidentLedgerErrorV1.sqlite(code: result, message: message)
        }
    }

    private func withStatement<T>(
        _ sql: String,
        _ body: (OpaquePointer) throws -> T
    ) throws -> T {
        guard let database else { throw IncidentLedgerErrorV1.closed }
        var statement: OpaquePointer?
        let result = sqlite3_prepare_v2(database, sql, -1, &statement, nil)
        guard result == SQLITE_OK, let statement else { throw sqliteError(result) }
        defer { sqlite3_finalize(statement) }
        return try body(statement)
    }

    private func scalarText(_ sql: String) throws -> String {
        try withStatement(sql) { statement in
            guard sqlite3_step(statement) == SQLITE_ROW else {
                throw IncidentLedgerErrorV1.integrity("Expected one scalar text row.")
            }
            let value = text(statement, 0)
            guard sqlite3_step(statement) == SQLITE_DONE else {
                throw IncidentLedgerErrorV1.integrity("Scalar text query returned extra rows.")
            }
            return value
        }
    }

    private func scalarInt64(_ sql: String) throws -> Int64 {
        try withStatement(sql) { statement in
            guard sqlite3_step(statement) == SQLITE_ROW else {
                throw IncidentLedgerErrorV1.integrity("Expected one scalar integer row.")
            }
            let value = sqlite3_column_int64(statement, 0)
            guard sqlite3_step(statement) == SQLITE_DONE else {
                throw IncidentLedgerErrorV1.integrity("Scalar integer query returned extra rows.")
            }
            return value
        }
    }

    private func bindText(_ value: String, at index: Int32, to statement: OpaquePointer) throws {
        let result = value.withCString {
            sqlite3_bind_text(statement, index, $0, -1, Self.sqliteTransient)
        }
        guard result == SQLITE_OK else { throw sqliteError(result) }
    }

    private func stepDone(_ statement: OpaquePointer) throws {
        let result = sqlite3_step(statement)
        guard result == SQLITE_DONE else { throw sqliteError(result) }
    }

    private func text(_ statement: OpaquePointer, _ index: Int32) -> String {
        guard let bytes = sqlite3_column_text(statement, index) else { return "" }
        return String(cString: bytes)
    }

    private func sqliteError(_ code: Int32) -> IncidentLedgerErrorV1 {
        let message = database.map { String(cString: sqlite3_errmsg($0)) } ?? "database closed"
        return .sqlite(code: code, message: message)
    }

    private static let eventColumns = """
        ordinal, event_id, event_type, incident_id, incident_digest,
        observation_key, subject_id_digest, subject_content_digest,
        evidence_set_digest, predecessor_digest, event_digest,
        observed_at_ms, retention_review_at_ms, authorizing,
        protected_authority_verified, raw_content_stored
        """
    private static let tombstoneColumns = """
        ordinal, event_id, event_type, incident_id,
        target_incident_digest, target_event_digest,
        subject_id_digest, subject_content_digest,
        retention_policy_digest, reason_code,
        predecessor_digest, event_digest, tombstoned_at_ms,
        authorizing, protected_authority_verified,
        raw_content_stored, physical_erasure_performed
        """

    private static func validate(scope: IncidentLedgerScopeV1) throws {
        guard
            scope.scopeID == "scope/veritas-private",
            isDigest(scope.projectDigest),
            isDigest(scope.accessPolicyDigest),
            isDigest(scope.retentionPolicyDigest)
        else {
            throw IncidentLedgerErrorV1.invalidInput("Ledger scope bindings are invalid.")
        }
    }

    private static func validate(selection: IncidentSelectionV1) throws {
        guard
            isDigest(selection.projectDigest),
            isIncidentID(selection.incidentID),
            isDigest(selection.incidentDigest),
            isDigest(selection.subjectIDDigest),
            isDigest(selection.subjectContentDigest),
            selection.subjectIDDigest != selection.subjectContentDigest,
            isDigest(selection.observationEventDigest)
        else {
            throw IncidentLedgerErrorV1.invalidInput(
                "Incident selection bindings are invalid."
            )
        }
    }

    private static func matches(
        selection: IncidentSelectionV1,
        event: StoredIncidentEventV1
    ) -> Bool {
        selection.incidentID == event.incidentID
            && selection.incidentDigest == event.incidentDigest
            && selection.subjectIDDigest == event.subjectIDDigest
            && selection.subjectContentDigest == event.subjectContentDigest
            && selection.observationEventDigest == event.eventDigest
    }

    private static func matchesRetentionSweepTombstone(
        _ tombstone: StoredIncidentTombstoneV1,
        observation: StoredIncidentEventV1,
        scope: IncidentLedgerScopeV1
    ) -> Bool {
        tombstone.reason == .retentionReviewDue
            && tombstone.retentionPolicyDigest == scope.retentionPolicyDigest
            && tombstone.incidentID == observation.incidentID
            && tombstone.targetIncidentDigest == observation.incidentDigest
            && tombstone.targetEventDigest == observation.eventDigest
            && tombstone.subjectIDDigest == observation.subjectIDDigest
            && tombstone.subjectContentDigest == observation.subjectContentDigest
    }

    private static func validate(
        observation: IncidentObservationInputV1
    ) throws -> IncidentObservationInputV1 {
        guard let observedAtMilliseconds = validatedMilliseconds(observation.observedAt) else {
            throw IncidentLedgerErrorV1.invalidInput("Observed timestamp is outside the admitted range.")
        }
        let retentionReviewAtMilliseconds: Int64?
        if let retentionReviewAt = observation.retentionReviewAt {
            guard
                let value = validatedMilliseconds(retentionReviewAt),
                value > observedAtMilliseconds
            else {
                throw IncidentLedgerErrorV1.invalidInput(
                    "Retention-review timestamp must be later and inside the admitted range."
                )
            }
            retentionReviewAtMilliseconds = value
        } else {
            retentionReviewAtMilliseconds = nil
        }
        guard
            isIncidentID(observation.incidentID),
            isDigest(observation.observationKey),
            isDigest(observation.subjectIDDigest),
            isDigest(observation.subjectContentDigest),
            observation.subjectIDDigest != observation.subjectContentDigest,
            isDigest(observation.evidenceSetDigest)
        else {
            throw IncidentLedgerErrorV1.invalidInput("Incident identity, digests, or timestamps are invalid.")
        }
        let failureCodes = try validate(codes: observation.failureCodes, label: "failure")
        let symptomCodes = try validate(codes: observation.symptomCodes, label: "symptom")
        return IncidentObservationInputV1(
            incidentID: observation.incidentID,
            observationKey: observation.observationKey,
            subjectIDDigest: observation.subjectIDDigest,
            subjectContentDigest: observation.subjectContentDigest,
            evidenceSetDigest: observation.evidenceSetDigest,
            failureCodes: failureCodes,
            symptomCodes: symptomCodes,
            observedAt: date(observedAtMilliseconds),
            retentionReviewAt: retentionReviewAtMilliseconds.map(date)
        )
    }

    private static func normalizedObservation(
        from event: StoredIncidentEventV1
    ) throws -> IncidentObservationInputV1 {
        try validate(observation: IncidentObservationInputV1(
            incidentID: event.incidentID,
            observationKey: event.observationKey,
            subjectIDDigest: event.subjectIDDigest,
            subjectContentDigest: event.subjectContentDigest,
            evidenceSetDigest: event.evidenceSetDigest,
            failureCodes: event.failureCodes,
            symptomCodes: event.symptomCodes,
            observedAt: date(event.observedAtMilliseconds),
            retentionReviewAt: event.retentionReviewAtMilliseconds.map(date)
        ))
    }

    private static func tombstoneView(
        _ event: StoredIncidentTombstoneV1
    ) -> IncidentTombstoneV1 {
        IncidentTombstoneV1(
            ordinal: event.ordinal,
            eventID: event.eventID,
            incidentID: event.incidentID,
            targetIncidentDigest: event.targetIncidentDigest,
            targetEventDigest: event.targetEventDigest,
            subjectIDDigest: event.subjectIDDigest,
            subjectContentDigest: event.subjectContentDigest,
            retentionPolicyDigest: event.retentionPolicyDigest,
            reason: event.reason,
            tombstonedAt: date(event.tombstonedAtMilliseconds),
            predecessorDigest: event.predecessorDigest,
            eventDigest: event.eventDigest,
            authorizing: false,
            protectedAuthorityVerified: false,
            rawContentStored: false,
            physicalErasurePerformed: false
        )
    }

    private static func makeRedactedExport(
        scope: IncidentLedgerScopeV1,
        observation: StoredIncidentEventV1,
        tombstone: StoredIncidentTombstoneV1?
    ) throws -> IncidentRedactedExportV1 {
        let lifecycleState: IncidentLifecycleStateV1 = tombstone == nil ? .active : .tombstoned
        let payload = IncidentRedactedExportPayloadV1(
            schemaVersion: 1,
            recordType: "VERITAS_REDACTED_INCIDENT",
            ledgerProfile: profile,
            projectDigest: scope.projectDigest,
            accessPolicyDigest: scope.accessPolicyDigest,
            retentionPolicyDigest: scope.retentionPolicyDigest,
            incidentID: observation.incidentID,
            incidentDigest: observation.incidentDigest,
            observationKey: observation.observationKey,
            subjectIDDigest: observation.subjectIDDigest,
            subjectContentDigest: observation.subjectContentDigest,
            evidenceSetDigest: observation.evidenceSetDigest,
            observationEventID: observation.eventID,
            observationEventDigest: observation.eventDigest,
            failureCodes: observation.failureCodes.map(\.rawValue),
            symptomCodes: observation.symptomCodes.map(\.rawValue),
            observedAtMilliseconds: String(observation.observedAtMilliseconds),
            retentionReviewAtMilliseconds: observation.retentionReviewAtMilliseconds
                .map(String.init) ?? "NONE",
            lifecycleState: lifecycleState.rawValue,
            tombstoneEventID: tombstone?.eventID ?? "NONE",
            tombstoneEventDigest: tombstone?.eventDigest ?? "NONE",
            tombstoneReason: tombstone?.reason.rawValue ?? "NONE",
            tombstonedAtMilliseconds: tombstone
                .map { String($0.tombstonedAtMilliseconds) } ?? "NONE",
            limitationCodes: limitationCodes,
            authorizing: false,
            certified: false,
            protectedAuthorityVerified: false,
            rawContentStored: false,
            physicalErasurePerformed: false
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(payload),
              !data.isEmpty,
              data.count <= maximumRedactedExportBytes else {
            throw IncidentLedgerErrorV1.exportEncodingFailed
        }
        return IncidentRedactedExportV1(
            canonicalData: data,
            digest: ArtifactSnapshot.digest(data),
            incidentID: observation.incidentID,
            lifecycleState: lifecycleState,
            authorizing: false,
            certified: false,
            rawContentStored: false,
            physicalErasurePerformed: false
        )
    }

    private static func validate<Code: RawRepresentable & Hashable>(
        codes: [Code],
        label: String
    ) throws -> [Code] where Code.RawValue == String {
        let rawValues = codes.map(\.rawValue)
        guard
            !codes.isEmpty,
            codes.count <= maximumCodesPerSet,
            Set(codes).count == codes.count,
            rawValues == rawValues.sorted()
        else {
            throw IncidentLedgerErrorV1.invalidInput(
                "Incident \(label) codes must be a bounded, unique, sorted closed-code set."
            )
        }
        return codes
    }

    private static func decodeFailureCodes(
        _ rawValues: [String]
    ) throws -> [IncidentFailureCodeV1] {
        let codes = rawValues.compactMap(IncidentFailureCodeV1.init(rawValue:))
        guard codes.count == rawValues.count else {
            throw IncidentLedgerErrorV1.integrity("Unknown failure code is stored.")
        }
        do { return try validate(codes: codes, label: "failure") }
        catch { throw IncidentLedgerErrorV1.integrity("Stored failure-code set is invalid.") }
    }

    private static func decodeSymptomCodes(
        _ rawValues: [String]
    ) throws -> [IncidentSymptomCodeV1] {
        let codes = rawValues.compactMap(IncidentSymptomCodeV1.init(rawValue:))
        guard codes.count == rawValues.count else {
            throw IncidentLedgerErrorV1.integrity("Unknown symptom code is stored.")
        }
        do { return try validate(codes: codes, label: "symptom") }
        catch { throw IncidentLedgerErrorV1.integrity("Stored symptom-code set is invalid.") }
    }

    private static func isDigest(_ value: String) -> Bool {
        value.count == 64 && value.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil
    }

    private static func isIncidentID(_ value: String) -> Bool {
        value.range(of: "^incident/[0-9a-f]{64}$", options: .regularExpression) != nil
    }

    private static func incidentDigest(
        scope: IncidentLedgerScopeV1,
        observation: IncidentObservationInputV1
    ) -> String {
        var fields = [
            profile,
            scope.scopeID,
            scope.projectDigest,
            scope.accessPolicyDigest,
            scope.retentionPolicyDigest,
            observation.incidentID,
            observation.observationKey,
            observation.subjectIDDigest,
            observation.subjectContentDigest,
            observation.evidenceSetDigest,
            String(milliseconds(observation.observedAt)),
            observation.retentionReviewAt.map { String(milliseconds($0)) } ?? "NONE",
            String(observation.failureCodes.count),
        ]
        fields.append(contentsOf: observation.failureCodes.map(\.rawValue))
        fields.append(String(observation.symptomCodes.count))
        fields.append(contentsOf: observation.symptomCodes.map(\.rawValue))
        return VeritasDigestFrameV1.digest(
            domain: "veritas-founder-alpha-incident-v1",
            fields: fields
        )
    }

    private static func isEquivalentReplay(
        existing: StoredIncidentEventV1,
        observation: IncidentObservationInputV1
    ) -> Bool {
        existing.incidentID == observation.incidentID
            && existing.observationKey == observation.observationKey
            && existing.subjectIDDigest == observation.subjectIDDigest
            && existing.subjectContentDigest == observation.subjectContentDigest
            && existing.evidenceSetDigest == observation.evidenceSetDigest
            && existing.failureCodes == observation.failureCodes
            && existing.symptomCodes == observation.symptomCodes
    }

    private static func eventDigest(
        scope: IncidentLedgerScopeV1,
        ordinal: Int64,
        eventID: String,
        incidentDigest: String,
        observation: IncidentObservationInputV1,
        predecessorDigest: String
    ) -> String {
        VeritasDigestFrameV1.digest(
            domain: "veritas-founder-alpha-incident-event-v1",
            fields: [
                profile,
                scope.scopeID,
                scope.projectDigest,
                String(ordinal),
                eventID,
                observationEventType,
                incidentDigest,
                observation.observationKey,
                observation.subjectIDDigest,
                observation.subjectContentDigest,
                observation.evidenceSetDigest,
                predecessorDigest,
                String(milliseconds(observation.observedAt)),
                observation.retentionReviewAt.map { String(milliseconds($0)) } ?? "NONE",
                "authorizing=false",
                "protectedAuthorityVerified=false",
                "rawContentStored=false",
            ]
        )
    }

    private static func tombstoneEventID(
        scope: IncidentLedgerScopeV1,
        observation: StoredIncidentEventV1,
        reason: IncidentTombstoneReasonV1
    ) -> String {
        let digest = VeritasDigestFrameV1.digest(
            domain: "veritas-founder-alpha-incident-tombstone-id-v1",
            fields: [
                profile,
                scope.scopeID,
                scope.projectDigest,
                scope.retentionPolicyDigest,
                observation.incidentID,
                observation.incidentDigest,
                observation.eventDigest,
                observation.subjectIDDigest,
                observation.subjectContentDigest,
                reason.rawValue,
            ]
        )
        return "tombstone/\(digest)"
    }

    private static func tombstoneEventDigest(
        scope: IncidentLedgerScopeV1,
        ordinal: Int64,
        eventID: String,
        observation: StoredIncidentEventV1,
        reason: IncidentTombstoneReasonV1,
        tombstonedAtMilliseconds: Int64,
        predecessorDigest: String
    ) -> String {
        VeritasDigestFrameV1.digest(
            domain: "veritas-founder-alpha-incident-tombstone-event-v1",
            fields: [
                profile,
                scope.scopeID,
                scope.projectDigest,
                String(ordinal),
                eventID,
                tombstoneEventType,
                observation.incidentID,
                observation.incidentDigest,
                observation.eventDigest,
                observation.subjectIDDigest,
                observation.subjectContentDigest,
                scope.retentionPolicyDigest,
                reason.rawValue,
                predecessorDigest,
                String(tombstonedAtMilliseconds),
                "authorizing=false",
                "protectedAuthorityVerified=false",
                "rawContentStored=false",
                "physicalErasurePerformed=false",
            ]
        )
    }

    private static func milliseconds(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1_000).rounded(.towardZero))
    }

    private static func validatedMilliseconds(_ date: Date) -> Int64? {
        let seconds = date.timeIntervalSince1970
        guard seconds.isFinite else { return nil }
        let value = (seconds * 1_000).rounded(.towardZero)
        guard
            value.isFinite,
            value >= 0,
            value <= Double(maximumTimestampMilliseconds)
        else {
            return nil
        }
        return Int64(value)
    }

    private static func date(_ milliseconds: Int64) -> Date {
        Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1_000)
    }
}
