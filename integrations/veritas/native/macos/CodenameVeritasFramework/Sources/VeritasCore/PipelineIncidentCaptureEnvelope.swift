import Foundation

/// V1 deliberately supports only a non-authorizing local candidate capture.
/// The explicit status fields make unsupported authority features visible and
/// fail closed instead of allowing their absence to be mistaken for proof.
public enum PipelineIncidentCapabilityStatusV1: String, Codable, Sendable {
    case unsupported = "UNSUPPORTED"
}

public enum PipelineIncidentCaptureEnvelopeErrorV1: Error, Equatable, Sendable {
    case inputNonCanonical
    case duplicateObjectKey
    case schemaUnsupported
    case digestMismatch
    case bindingMismatch
    case scopeMismatch
    case actorAuthorityUnsupported
    case protectedAuthorityUnsupported
    case highWatermarkUnsupported
    case forkReconciliationUnsupported
}

/// Canonical, transient binding for one non-authorizing incident-capture attempt.
///
/// This envelope proves that the fields presented to the capture entry point are
/// internally consistent with the actual snapshot, result, profile, mode, and
/// opened project ledger. It does not authenticate the caller and is not yet
/// persisted as durable run provenance; those are protected-authority/schema-v2
/// concerns.
public struct PipelineIncidentCaptureEnvelopeV1: Equatable, Sendable {
    public static let schemaVersion = 1
    public static let maximumCanonicalBytes = 16_384

    public let runObservationDigest: String
    public let subjectContentDigest: String
    public let subjectType: ArtifactKind
    public let subjectIDDigest: String
    public let profileID: String
    public let profileFingerprint: String
    public let mode: VeritasMode
    public let resultEvidenceDigest: String
    public let evidenceSetDigest: String
    public let scopeID: String
    public let projectDigest: String
    public let accessPolicyDigest: String
    public let retentionPolicyDigest: String
    public let observedAtMilliseconds: Int64
    public let retentionReviewAtPresent: Bool
    public let retentionReviewAtMilliseconds: Int64
    public let actorAuthorityStatus: PipelineIncidentCapabilityStatusV1
    public let protectedAuthorityStatus: PipelineIncidentCapabilityStatusV1
    public let highWatermarkStatus: PipelineIncidentCapabilityStatusV1
    public let forkReconciliationStatus: PipelineIncidentCapabilityStatusV1
    public let envelopeDigest: String

    private struct Wire: Codable {
        let accessPolicyDigest: String
        let actorAuthorityStatus: PipelineIncidentCapabilityStatusV1
        let envelopeDigest: String
        let evidenceSetDigest: String
        let forkReconciliationStatus: PipelineIncidentCapabilityStatusV1
        let highWatermarkStatus: PipelineIncidentCapabilityStatusV1
        let mode: VeritasMode
        let observedAtMilliseconds: Int64
        let profileFingerprint: String
        let profileID: String
        let projectDigest: String
        let protectedAuthorityStatus: PipelineIncidentCapabilityStatusV1
        let resultEvidenceDigest: String
        let retentionPolicyDigest: String
        let retentionReviewAtMilliseconds: Int64
        let retentionReviewAtPresent: Bool
        let runObservationDigest: String
        let schemaVersion: Int
        let scopeID: String
        let subjectContentDigest: String
        let subjectIDDigest: String
        let subjectType: ArtifactKind
    }

    private static let exactWireKeys = Set([
        "accessPolicyDigest",
        "actorAuthorityStatus",
        "envelopeDigest",
        "evidenceSetDigest",
        "forkReconciliationStatus",
        "highWatermarkStatus",
        "mode",
        "observedAtMilliseconds",
        "profileFingerprint",
        "profileID",
        "projectDigest",
        "protectedAuthorityStatus",
        "resultEvidenceDigest",
        "retentionPolicyDigest",
        "retentionReviewAtMilliseconds",
        "retentionReviewAtPresent",
        "runObservationDigest",
        "schemaVersion",
        "scopeID",
        "subjectContentDigest",
        "subjectIDDigest",
        "subjectType",
    ])

    private static let actorClaimKeys = Set([
        "actorIdentityDigest", "actorCapabilityDigest", "actorRole", "adjudicationClaim",
    ])
    private static let protectedAuthorityClaimKeys = Set([
        "protectedAuthorityDigest", "protectedAuthorityVerified", "authorityReceiptDigest",
    ])
    private static let highWatermarkClaimKeys = Set([
        "sourceEventHighWatermark", "highWatermarkDigest", "sourceStreamRootDigest",
    ])
    private static let forkClaimKeys = Set([
        "forkHeadDigest", "forkMergeRequest", "forkReconciliationVerified",
    ])

    private init(wire: Wire) {
        self.runObservationDigest = wire.runObservationDigest
        self.subjectContentDigest = wire.subjectContentDigest
        self.subjectType = wire.subjectType
        self.subjectIDDigest = wire.subjectIDDigest
        self.profileID = wire.profileID
        self.profileFingerprint = wire.profileFingerprint
        self.mode = wire.mode
        self.resultEvidenceDigest = wire.resultEvidenceDigest
        self.evidenceSetDigest = wire.evidenceSetDigest
        self.scopeID = wire.scopeID
        self.projectDigest = wire.projectDigest
        self.accessPolicyDigest = wire.accessPolicyDigest
        self.retentionPolicyDigest = wire.retentionPolicyDigest
        self.observedAtMilliseconds = wire.observedAtMilliseconds
        self.retentionReviewAtPresent = wire.retentionReviewAtPresent
        self.retentionReviewAtMilliseconds = wire.retentionReviewAtMilliseconds
        self.actorAuthorityStatus = wire.actorAuthorityStatus
        self.protectedAuthorityStatus = wire.protectedAuthorityStatus
        self.highWatermarkStatus = wire.highWatermarkStatus
        self.forkReconciliationStatus = wire.forkReconciliationStatus
        self.envelopeDigest = wire.envelopeDigest
    }

    public static func make(
        snapshot: ArtifactSnapshot,
        profile: CheckProfile,
        mode: VeritasMode,
        result: PipelineResult,
        scope: IncidentLedgerScopeV1,
        context: PipelineIncidentCaptureContextV1
    ) throws -> Self {
        guard snapshot.bytes.count <= ArtifactSnapshotter.prototypeByteLimit,
              result.subjectDigest == snapshot.subjectDigest,
              result.artifactKind == snapshot.kind,
              result.profileID == profile.id,
              result.profileFingerprint == profile.rulesFingerprint,
              result.mode == mode,
              let resultEvidenceDigest = result.resultEvidenceDigest,
              let observedAtMilliseconds = milliseconds(context.observedAt),
              isDigest(context.runObservationDigest) else {
            throw PipelineIncidentCaptureEnvelopeErrorV1.bindingMismatch
        }
        let retentionReviewAtPresent = context.retentionReviewAt != nil
        let retentionReviewAtMilliseconds: Int64
        if let retentionReviewAt = context.retentionReviewAt {
            guard let value = milliseconds(retentionReviewAt), value > observedAtMilliseconds else {
                throw PipelineIncidentCaptureEnvelopeErrorV1.inputNonCanonical
            }
            retentionReviewAtMilliseconds = value
        } else {
            retentionReviewAtMilliseconds = 0
        }
        let subjectIDDigest = VeritasDigestFrameV1.digest(
            domain: "veritas-pipeline-subject-id-v1",
            fields: [
                PipelineIncidentAdapterV1.profile,
                scope.scopeID,
                scope.projectDigest,
                snapshot.kind.rawValue,
                profile.rulesFingerprint,
                snapshot.subjectDigest,
            ]
        )
        let evidenceSetDigest = VeritasDigestFrameV1.digest(
            domain: "veritas-pipeline-evidence-set-v1",
            fields: [
                PipelineIncidentAdapterV1.profile,
                scope.scopeID,
                scope.projectDigest,
                resultEvidenceDigest,
            ]
        )
        let provisional = Wire(
            accessPolicyDigest: scope.accessPolicyDigest,
            actorAuthorityStatus: .unsupported,
            envelopeDigest: "",
            evidenceSetDigest: evidenceSetDigest,
            forkReconciliationStatus: .unsupported,
            highWatermarkStatus: .unsupported,
            mode: mode,
            observedAtMilliseconds: observedAtMilliseconds,
            profileFingerprint: profile.rulesFingerprint,
            profileID: profile.id,
            projectDigest: scope.projectDigest,
            protectedAuthorityStatus: .unsupported,
            resultEvidenceDigest: resultEvidenceDigest,
            retentionPolicyDigest: scope.retentionPolicyDigest,
            retentionReviewAtMilliseconds: retentionReviewAtMilliseconds,
            retentionReviewAtPresent: retentionReviewAtPresent,
            runObservationDigest: context.runObservationDigest,
            schemaVersion: schemaVersion,
            scopeID: scope.scopeID,
            subjectContentDigest: snapshot.subjectDigest,
            subjectIDDigest: subjectIDDigest,
            subjectType: snapshot.kind
        )
        let digest = digest(for: provisional)
        let wire = Wire(
            accessPolicyDigest: provisional.accessPolicyDigest,
            actorAuthorityStatus: provisional.actorAuthorityStatus,
            envelopeDigest: digest,
            evidenceSetDigest: provisional.evidenceSetDigest,
            forkReconciliationStatus: provisional.forkReconciliationStatus,
            highWatermarkStatus: provisional.highWatermarkStatus,
            mode: provisional.mode,
            observedAtMilliseconds: provisional.observedAtMilliseconds,
            profileFingerprint: provisional.profileFingerprint,
            profileID: provisional.profileID,
            projectDigest: provisional.projectDigest,
            protectedAuthorityStatus: provisional.protectedAuthorityStatus,
            resultEvidenceDigest: provisional.resultEvidenceDigest,
            retentionPolicyDigest: provisional.retentionPolicyDigest,
            retentionReviewAtMilliseconds: provisional.retentionReviewAtMilliseconds,
            retentionReviewAtPresent: provisional.retentionReviewAtPresent,
            runObservationDigest: provisional.runObservationDigest,
            schemaVersion: provisional.schemaVersion,
            scopeID: provisional.scopeID,
            subjectContentDigest: provisional.subjectContentDigest,
            subjectIDDigest: provisional.subjectIDDigest,
            subjectType: provisional.subjectType
        )
        let envelope = Self(wire: wire)
        try envelope.validate()
        return envelope
    }

    public func canonicalData() throws -> Data {
        try validate()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(wire)
        guard data.count <= Self.maximumCanonicalBytes else {
            throw PipelineIncidentCaptureEnvelopeErrorV1.inputNonCanonical
        }
        return data
    }

    public static func decodeCanonical(_ data: Data) throws -> Self {
        guard !data.isEmpty, data.count <= maximumCanonicalBytes else {
            throw PipelineIncidentCaptureEnvelopeErrorV1.inputNonCanonical
        }
        let shape: StrictJSONDocumentValidator.ObjectShape
        do {
            shape = try StrictJSONDocumentValidator.inspectTopLevelObject(data)
        } catch StrictJSONValidationFailure.duplicateObjectKey,
                StrictJSONValidationFailure.unicodeEquivalentObjectKey {
            throw PipelineIncidentCaptureEnvelopeErrorV1.duplicateObjectKey
        } catch {
            throw PipelineIncidentCaptureEnvelopeErrorV1.inputNonCanonical
        }
        let keys = shape.keys
        if !keys.isDisjoint(with: actorClaimKeys.map { Data($0.utf8) }) {
            throw PipelineIncidentCaptureEnvelopeErrorV1.actorAuthorityUnsupported
        }
        if !keys.isDisjoint(with: protectedAuthorityClaimKeys.map { Data($0.utf8) }) {
            throw PipelineIncidentCaptureEnvelopeErrorV1.protectedAuthorityUnsupported
        }
        if !keys.isDisjoint(with: highWatermarkClaimKeys.map { Data($0.utf8) }) {
            throw PipelineIncidentCaptureEnvelopeErrorV1.highWatermarkUnsupported
        }
        if !keys.isDisjoint(with: forkClaimKeys.map { Data($0.utf8) }) {
            throw PipelineIncidentCaptureEnvelopeErrorV1.forkReconciliationUnsupported
        }
        guard keys == Set(exactWireKeys.map { Data($0.utf8) }) else {
            throw PipelineIncidentCaptureEnvelopeErrorV1.inputNonCanonical
        }
        guard shape.string(for: "actorAuthorityStatus")
                == PipelineIncidentCapabilityStatusV1.unsupported.rawValue else {
            throw PipelineIncidentCaptureEnvelopeErrorV1.actorAuthorityUnsupported
        }
        guard shape.string(for: "protectedAuthorityStatus")
                == PipelineIncidentCapabilityStatusV1.unsupported.rawValue else {
            throw PipelineIncidentCaptureEnvelopeErrorV1.protectedAuthorityUnsupported
        }
        guard shape.string(for: "highWatermarkStatus")
                == PipelineIncidentCapabilityStatusV1.unsupported.rawValue else {
            throw PipelineIncidentCaptureEnvelopeErrorV1.highWatermarkUnsupported
        }
        guard shape.string(for: "forkReconciliationStatus")
                == PipelineIncidentCapabilityStatusV1.unsupported.rawValue else {
            throw PipelineIncidentCaptureEnvelopeErrorV1.forkReconciliationUnsupported
        }
        let wire: Wire
        do {
            wire = try JSONDecoder().decode(Wire.self, from: data)
        } catch {
            throw PipelineIncidentCaptureEnvelopeErrorV1.inputNonCanonical
        }
        guard wire.schemaVersion == schemaVersion else {
            throw PipelineIncidentCaptureEnvelopeErrorV1.schemaUnsupported
        }
        let envelope = Self(wire: wire)
        try envelope.validate()
        guard try envelope.canonicalData() == data else {
            throw PipelineIncidentCaptureEnvelopeErrorV1.inputNonCanonical
        }
        return envelope
    }

    func hasSameScope(as scope: IncidentLedgerScopeV1) -> Bool {
        scopeID == scope.scopeID
            && projectDigest == scope.projectDigest
            && accessPolicyDigest == scope.accessPolicyDigest
            && retentionPolicyDigest == scope.retentionPolicyDigest
    }

    private var wire: Wire {
        Wire(
            accessPolicyDigest: accessPolicyDigest,
            actorAuthorityStatus: actorAuthorityStatus,
            envelopeDigest: envelopeDigest,
            evidenceSetDigest: evidenceSetDigest,
            forkReconciliationStatus: forkReconciliationStatus,
            highWatermarkStatus: highWatermarkStatus,
            mode: mode,
            observedAtMilliseconds: observedAtMilliseconds,
            profileFingerprint: profileFingerprint,
            profileID: profileID,
            projectDigest: projectDigest,
            protectedAuthorityStatus: protectedAuthorityStatus,
            resultEvidenceDigest: resultEvidenceDigest,
            retentionPolicyDigest: retentionPolicyDigest,
            retentionReviewAtMilliseconds: retentionReviewAtMilliseconds,
            retentionReviewAtPresent: retentionReviewAtPresent,
            runObservationDigest: runObservationDigest,
            schemaVersion: Self.schemaVersion,
            scopeID: scopeID,
            subjectContentDigest: subjectContentDigest,
            subjectIDDigest: subjectIDDigest,
            subjectType: subjectType
        )
    }

    private func validate() throws {
        guard scopeID == "scope/veritas-private",
              !profileID.isEmpty,
              profileID.utf8.count <= 128,
              Self.isDigest(runObservationDigest),
              Self.isDigest(subjectContentDigest),
              Self.isDigest(subjectIDDigest),
              Self.isDigest(profileFingerprint),
              Self.isDigest(resultEvidenceDigest),
              Self.isDigest(evidenceSetDigest),
              Self.isDigest(projectDigest),
              Self.isDigest(accessPolicyDigest),
              Self.isDigest(retentionPolicyDigest),
              observedAtMilliseconds >= 0,
              (!retentionReviewAtPresent && retentionReviewAtMilliseconds == 0)
                || (retentionReviewAtPresent
                    && retentionReviewAtMilliseconds > observedAtMilliseconds),
              actorAuthorityStatus == .unsupported,
              protectedAuthorityStatus == .unsupported,
              highWatermarkStatus == .unsupported,
              forkReconciliationStatus == .unsupported else {
            throw PipelineIncidentCaptureEnvelopeErrorV1.inputNonCanonical
        }
        guard envelopeDigest == Self.digest(for: wire) else {
            throw PipelineIncidentCaptureEnvelopeErrorV1.digestMismatch
        }
    }

    private static func digest(for wire: Wire) -> String {
        VeritasDigestFrameV1.digest(
            domain: "veritas-pipeline-capture-envelope-v1",
            fields: [
                String(wire.schemaVersion),
                wire.runObservationDigest,
                wire.subjectContentDigest,
                wire.subjectType.rawValue,
                wire.subjectIDDigest,
                wire.profileID,
                wire.profileFingerprint,
                wire.mode.rawValue,
                wire.resultEvidenceDigest,
                wire.evidenceSetDigest,
                wire.scopeID,
                wire.projectDigest,
                wire.accessPolicyDigest,
                wire.retentionPolicyDigest,
                String(wire.observedAtMilliseconds),
                wire.retentionReviewAtPresent ? "RETENTION_PRESENT" : "RETENTION_ABSENT",
                String(wire.retentionReviewAtMilliseconds),
                wire.actorAuthorityStatus.rawValue,
                wire.protectedAuthorityStatus.rawValue,
                wire.highWatermarkStatus.rawValue,
                wire.forkReconciliationStatus.rawValue,
            ]
        )
    }

    private static func milliseconds(_ date: Date) -> Int64? {
        let maximum: Int64 = 253_402_300_799_999
        let seconds = date.timeIntervalSince1970
        guard seconds.isFinite else { return nil }
        let value = (seconds * 1_000).rounded(.towardZero)
        guard value.isFinite, value >= 0, value <= Double(maximum) else { return nil }
        return Int64(value)
    }

    private static func isDigest(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { byte in
            (0x30...0x39).contains(byte) || (0x61...0x66).contains(byte)
        }
    }

}
