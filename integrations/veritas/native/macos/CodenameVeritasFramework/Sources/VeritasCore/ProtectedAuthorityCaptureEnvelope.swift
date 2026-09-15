import Foundation

// MARK: - FI0.8 Protected Authority Support

/// Capability status for protected-authority features.
///
/// When protected authority is available, these statuses change from `.unsupported`
/// to `.supported`, enabling the full pipeline.
public enum ProtectedAuthorityCapabilityStatusV1: String, Codable, Sendable {
    case supported = "SUPPORTED"
    case unsupported = "UNSUPPORTED"
}

/// Extended envelope for protected-authority operations.
///
/// This envelope binds the same production inputs as the non-authorizing envelope
/// but adds protected-authority claims: actor identity, authority receipt,
/// high-watermark, and fork reconciliation.
public struct ProtectedAuthorityCaptureEnvelopeV1: Equatable, Sendable {
    public static let schemaVersion = 1
    public static let maximumCanonicalBytes = 32_768

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

    // Protected-authority claims
    public let actorIdentityDigest: String?
    public let actorCapabilityDigest: String?
    public let actorRole: String?
    public let adjudicationClaim: String?
    public let protectedAuthorityDigest: String?
    public let protectedAuthorityVerified: Bool?
    public let authorityReceiptDigest: String?
    public let sourceEventHighWatermark: Int64?
    public let highWatermarkDigest: String?
    public let sourceStreamRootDigest: String?
    public let forkHeadDigest: String?
    public let forkMergeRequest: String?
    public let forkReconciliationVerified: Bool?

    public let envelopeDigest: String

    private struct Wire: Codable {
        let accessPolicyDigest: String
        let actorCapabilityDigest: String?
        let actorIdentityDigest: String?
        let actorRole: String?
        let adjudicationClaim: String?
        let authorityReceiptDigest: String?
        let envelopeDigest: String
        let evidenceSetDigest: String
        let forkHeadDigest: String?
        let forkMergeRequest: String?
        let forkReconciliationVerified: Bool?
        let highWatermarkDigest: String?
        let highWatermarkSupported: ProtectedAuthorityCapabilityStatusV1
        let mode: VeritasMode
        let observedAtMilliseconds: Int64
        let profileFingerprint: String
        let profileID: String
        let projectDigest: String
        let protectedAuthorityDigest: String?
        let protectedAuthoritySupported: ProtectedAuthorityCapabilityStatusV1
        let protectedAuthorityVerified: Bool?
        let resultEvidenceDigest: String
        let retentionPolicyDigest: String
        let retentionReviewAtMilliseconds: Int64
        let retentionReviewAtPresent: Bool
        let runObservationDigest: String
        let schemaVersion: Int
        let scopeID: String
        let sourceEventHighWatermark: Int64?
        let sourceStreamRootDigest: String?
        let subjectContentDigest: String
        let subjectIDDigest: String
        let subjectType: ArtifactKind

        private enum CodingKeys: String, CodingKey {
            case accessPolicyDigest, actorCapabilityDigest, actorIdentityDigest, actorRole,
                 adjudicationClaim, authorityReceiptDigest, envelopeDigest, evidenceSetDigest,
                 forkHeadDigest, forkMergeRequest, forkReconciliationVerified, highWatermarkDigest,
                 highWatermarkSupported, mode, observedAtMilliseconds, profileFingerprint,
                 profileID, projectDigest, protectedAuthorityDigest, protectedAuthoritySupported,
                 protectedAuthorityVerified, resultEvidenceDigest, retentionPolicyDigest,
                 retentionReviewAtMilliseconds, retentionReviewAtPresent, runObservationDigest,
                 schemaVersion, scopeID, sourceEventHighWatermark, sourceStreamRootDigest,
                 subjectContentDigest, subjectIDDigest, subjectType
        }

        // Canonical bytes must have a fixed, stable key set regardless of which
        // optional claims are present -- decodeCanonical's `keys == exactWireKeys`
        // check depends on it. The default synthesized encoder omits nil optionals
        // entirely (encodeIfPresent), which made that check unsatisfiable for any
        // envelope with an absent claim, including the fully-absent ("non-protected")
        // envelope this type explicitly models. `encode(_:forKey:)` on an Optional
        // writes JSON null instead of omitting the key; decode keeps using the
        // synthesized initializer (decodeIfPresent already accepts null or absent).
        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(accessPolicyDigest, forKey: .accessPolicyDigest)
            try container.encode(actorCapabilityDigest, forKey: .actorCapabilityDigest)
            try container.encode(actorIdentityDigest, forKey: .actorIdentityDigest)
            try container.encode(actorRole, forKey: .actorRole)
            try container.encode(adjudicationClaim, forKey: .adjudicationClaim)
            try container.encode(authorityReceiptDigest, forKey: .authorityReceiptDigest)
            try container.encode(envelopeDigest, forKey: .envelopeDigest)
            try container.encode(evidenceSetDigest, forKey: .evidenceSetDigest)
            try container.encode(forkHeadDigest, forKey: .forkHeadDigest)
            try container.encode(forkMergeRequest, forKey: .forkMergeRequest)
            try container.encode(forkReconciliationVerified, forKey: .forkReconciliationVerified)
            try container.encode(highWatermarkDigest, forKey: .highWatermarkDigest)
            try container.encode(highWatermarkSupported, forKey: .highWatermarkSupported)
            try container.encode(mode, forKey: .mode)
            try container.encode(observedAtMilliseconds, forKey: .observedAtMilliseconds)
            try container.encode(profileFingerprint, forKey: .profileFingerprint)
            try container.encode(profileID, forKey: .profileID)
            try container.encode(projectDigest, forKey: .projectDigest)
            try container.encode(protectedAuthorityDigest, forKey: .protectedAuthorityDigest)
            try container.encode(protectedAuthoritySupported, forKey: .protectedAuthoritySupported)
            try container.encode(protectedAuthorityVerified, forKey: .protectedAuthorityVerified)
            try container.encode(resultEvidenceDigest, forKey: .resultEvidenceDigest)
            try container.encode(retentionPolicyDigest, forKey: .retentionPolicyDigest)
            try container.encode(retentionReviewAtMilliseconds, forKey: .retentionReviewAtMilliseconds)
            try container.encode(retentionReviewAtPresent, forKey: .retentionReviewAtPresent)
            try container.encode(runObservationDigest, forKey: .runObservationDigest)
            try container.encode(schemaVersion, forKey: .schemaVersion)
            try container.encode(scopeID, forKey: .scopeID)
            try container.encode(sourceEventHighWatermark, forKey: .sourceEventHighWatermark)
            try container.encode(sourceStreamRootDigest, forKey: .sourceStreamRootDigest)
            try container.encode(subjectContentDigest, forKey: .subjectContentDigest)
            try container.encode(subjectIDDigest, forKey: .subjectIDDigest)
            try container.encode(subjectType, forKey: .subjectType)
        }
    }

    private static let exactWireKeys = Set([
        "accessPolicyDigest",
        "actorCapabilityDigest",
        "actorIdentityDigest",
        "actorRole",
        "adjudicationClaim",
        "authorityReceiptDigest",
        "envelopeDigest",
        "evidenceSetDigest",
        "forkHeadDigest",
        "forkMergeRequest",
        "forkReconciliationVerified",
        "highWatermarkDigest",
        "highWatermarkSupported",
        "mode",
        "observedAtMilliseconds",
        "profileFingerprint",
        "profileID",
        "projectDigest",
        "protectedAuthorityDigest",
        "protectedAuthoritySupported",
        "protectedAuthorityVerified",
        "resultEvidenceDigest",
        "retentionPolicyDigest",
        "retentionReviewAtMilliseconds",
        "retentionReviewAtPresent",
        "runObservationDigest",
        "schemaVersion",
        "scopeID",
        "sourceEventHighWatermark",
        "sourceStreamRootDigest",
        "subjectContentDigest",
        "subjectIDDigest",
        "subjectType",
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
        self.actorIdentityDigest = wire.actorIdentityDigest
        self.actorCapabilityDigest = wire.actorCapabilityDigest
        self.actorRole = wire.actorRole
        self.adjudicationClaim = wire.adjudicationClaim
        self.protectedAuthorityDigest = wire.protectedAuthorityDigest
        self.protectedAuthorityVerified = wire.protectedAuthorityVerified
        self.authorityReceiptDigest = wire.authorityReceiptDigest
        self.sourceEventHighWatermark = wire.sourceEventHighWatermark
        self.highWatermarkDigest = wire.highWatermarkDigest
        self.sourceStreamRootDigest = wire.sourceStreamRootDigest
        self.forkHeadDigest = wire.forkHeadDigest
        self.forkMergeRequest = wire.forkMergeRequest
        self.forkReconciliationVerified = wire.forkReconciliationVerified
        self.envelopeDigest = wire.envelopeDigest
    }

    public static func make(
        snapshot: ArtifactSnapshot,
        profile: CheckProfile,
        mode: VeritasMode,
        result: PipelineResult,
        scope: IncidentLedgerScopeV1,
        context: PipelineIncidentCaptureContextV1,
        actorIdentityDigest: String?,
        actorCapabilityDigest: String?,
        actorRole: String?,
        adjudicationClaim: String?,
        protectedAuthorityDigest: String?,
        protectedAuthorityVerified: Bool?,
        authorityReceiptDigest: String?,
        sourceEventHighWatermark: Int64?,
        highWatermarkDigest: String?,
        sourceStreamRootDigest: String?,
        forkHeadDigest: String?,
        forkMergeRequest: String?,
        forkReconciliationVerified: Bool?
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
            throw ProtectedAuthorityCaptureEnvelopeErrorV1.bindingMismatch
        }
        let retentionReviewAtPresent = context.retentionReviewAt != nil
        let retentionReviewAtMilliseconds: Int64
        if let retentionReviewAt = context.retentionReviewAt {
            guard let value = milliseconds(retentionReviewAt), value > observedAtMilliseconds else {
                throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
            }
            retentionReviewAtMilliseconds = value
        } else {
            retentionReviewAtMilliseconds = 0
        }

        // Validate protected-authority claims when present.
        if let actorIdentityDigest {
            guard isDigest(actorIdentityDigest) else {
                throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
            }
        }
        if let actorCapabilityDigest {
            guard isDigest(actorCapabilityDigest) else {
                throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
            }
        }
        if let protectedAuthorityDigest {
            guard isDigest(protectedAuthorityDigest) else {
                throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
            }
        }
        if let authorityReceiptDigest {
            guard isDigest(authorityReceiptDigest) else {
                throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
            }
        }
        if let highWatermarkDigest {
            guard isDigest(highWatermarkDigest) else {
                throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
            }
        }
        if let sourceStreamRootDigest {
            guard isDigest(sourceStreamRootDigest) else {
                throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
            }
        }
        if let forkHeadDigest {
            guard isDigest(forkHeadDigest) else {
                throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
            }
        }
        if let forkMergeRequest {
            guard isDigest(forkMergeRequest) else {
                throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
            }
        }

        let subjectIDDigest = VeritasDigestFrameV1.digest(
            domain: "veritas-protected-subject-id-v1",
            fields: [
                "veritas-pipeline-protected-capture-v1",
                scope.scopeID,
                scope.projectDigest,
                snapshot.kind.rawValue,
                profile.rulesFingerprint,
                snapshot.subjectDigest,
            ]
        )
        let evidenceSetDigest = VeritasDigestFrameV1.digest(
            domain: "veritas-protected-evidence-set-v1",
            fields: [
                "veritas-pipeline-protected-capture-v1",
                scope.scopeID,
                scope.projectDigest,
                resultEvidenceDigest,
            ]
        )

        let highWatermarkSupported: ProtectedAuthorityCapabilityStatusV1
        if sourceEventHighWatermark != nil || highWatermarkDigest != nil || sourceStreamRootDigest != nil {
            highWatermarkSupported = .supported
        } else {
            highWatermarkSupported = .unsupported
        }

        let provisional = Wire(
            accessPolicyDigest: scope.accessPolicyDigest,
            actorCapabilityDigest: actorCapabilityDigest,
            actorIdentityDigest: actorIdentityDigest,
            actorRole: actorRole,
            adjudicationClaim: adjudicationClaim,
            authorityReceiptDigest: authorityReceiptDigest,
            envelopeDigest: "",
            evidenceSetDigest: evidenceSetDigest,
            forkHeadDigest: forkHeadDigest,
            forkMergeRequest: forkMergeRequest,
            forkReconciliationVerified: forkReconciliationVerified,
            highWatermarkDigest: highWatermarkDigest,
            highWatermarkSupported: highWatermarkSupported,
            mode: mode,
            observedAtMilliseconds: observedAtMilliseconds,
            profileFingerprint: profile.rulesFingerprint,
            profileID: profile.id,
            projectDigest: scope.projectDigest,
            protectedAuthorityDigest: protectedAuthorityDigest,
            protectedAuthoritySupported: protectedAuthorityDigest != nil ? .supported : .unsupported,
            protectedAuthorityVerified: protectedAuthorityVerified,
            resultEvidenceDigest: resultEvidenceDigest,
            retentionPolicyDigest: scope.retentionPolicyDigest,
            retentionReviewAtMilliseconds: retentionReviewAtMilliseconds,
            retentionReviewAtPresent: retentionReviewAtPresent,
            runObservationDigest: context.runObservationDigest,
            schemaVersion: schemaVersion,
            scopeID: scope.scopeID,
            sourceEventHighWatermark: sourceEventHighWatermark,
            sourceStreamRootDigest: sourceStreamRootDigest,
            subjectContentDigest: snapshot.subjectDigest,
            subjectIDDigest: subjectIDDigest,
            subjectType: snapshot.kind
        )
        let digest = self.digest(for: provisional)
        let wire = Wire(
            accessPolicyDigest: provisional.accessPolicyDigest,
            actorCapabilityDigest: provisional.actorCapabilityDigest,
            actorIdentityDigest: provisional.actorIdentityDigest,
            actorRole: provisional.actorRole,
            adjudicationClaim: provisional.adjudicationClaim,
            authorityReceiptDigest: provisional.authorityReceiptDigest,
            envelopeDigest: digest,
            evidenceSetDigest: provisional.evidenceSetDigest,
            forkHeadDigest: provisional.forkHeadDigest,
            forkMergeRequest: provisional.forkMergeRequest,
            forkReconciliationVerified: provisional.forkReconciliationVerified,
            highWatermarkDigest: provisional.highWatermarkDigest,
            highWatermarkSupported: provisional.highWatermarkSupported,
            mode: provisional.mode,
            observedAtMilliseconds: provisional.observedAtMilliseconds,
            profileFingerprint: provisional.profileFingerprint,
            profileID: provisional.profileID,
            projectDigest: provisional.projectDigest,
            protectedAuthorityDigest: provisional.protectedAuthorityDigest,
            protectedAuthoritySupported: provisional.protectedAuthoritySupported,
            protectedAuthorityVerified: provisional.protectedAuthorityVerified,
            resultEvidenceDigest: provisional.resultEvidenceDigest,
            retentionPolicyDigest: provisional.retentionPolicyDigest,
            retentionReviewAtMilliseconds: provisional.retentionReviewAtMilliseconds,
            retentionReviewAtPresent: provisional.retentionReviewAtPresent,
            runObservationDigest: provisional.runObservationDigest,
            schemaVersion: provisional.schemaVersion,
            scopeID: provisional.scopeID,
            sourceEventHighWatermark: provisional.sourceEventHighWatermark,
            sourceStreamRootDigest: provisional.sourceStreamRootDigest,
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
            throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
        }
        return data
    }

    public static func decodeCanonical(_ data: Data) throws -> Self {
        guard !data.isEmpty, data.count <= maximumCanonicalBytes else {
            throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
        }
        guard let shape = try? StrictJSONDocumentValidator.inspectTopLevelObject(data) else {
            throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
        }
        guard shape.keys == Set(exactWireKeys.map { Data($0.utf8) }) else {
            throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
        }
        let wire: Wire
        do {
            wire = try JSONDecoder().decode(Wire.self, from: data)
        } catch {
            throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
        }
        guard wire.schemaVersion == schemaVersion else {
            throw ProtectedAuthorityCaptureEnvelopeErrorV1.schemaUnsupported
        }
        let envelope = Self(wire: wire)
        try envelope.validate()
        guard try envelope.canonicalData() == data else {
            throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
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
            actorCapabilityDigest: actorCapabilityDigest,
            actorIdentityDigest: actorIdentityDigest,
            actorRole: actorRole,
            adjudicationClaim: adjudicationClaim,
            authorityReceiptDigest: authorityReceiptDigest,
            envelopeDigest: envelopeDigest,
            evidenceSetDigest: evidenceSetDigest,
            forkHeadDigest: forkHeadDigest,
            forkMergeRequest: forkMergeRequest,
            forkReconciliationVerified: forkReconciliationVerified,
            highWatermarkDigest: highWatermarkDigest,
            highWatermarkSupported: highWatermarkStatus,
            mode: mode,
            observedAtMilliseconds: observedAtMilliseconds,
            profileFingerprint: profileFingerprint,
            profileID: profileID,
            projectDigest: projectDigest,
            protectedAuthorityDigest: protectedAuthorityDigest,
            protectedAuthoritySupported: protectedAuthorityStatus,
            protectedAuthorityVerified: protectedAuthorityVerified,
            resultEvidenceDigest: resultEvidenceDigest,
            retentionPolicyDigest: retentionPolicyDigest,
            retentionReviewAtMilliseconds: retentionReviewAtMilliseconds,
            retentionReviewAtPresent: retentionReviewAtPresent,
            runObservationDigest: runObservationDigest,
            schemaVersion: Self.schemaVersion,
            scopeID: scopeID,
            sourceEventHighWatermark: sourceEventHighWatermark,
            sourceStreamRootDigest: sourceStreamRootDigest,
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
              envelopeDigest == Self.digest(for: wire) else {
            throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
        }

        // Validate optional protected-authority claims when present.
        if let actorIdentityDigest {
            guard Self.isDigest(actorIdentityDigest) else {
                throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
            }
        }
        if let actorCapabilityDigest {
            guard Self.isDigest(actorCapabilityDigest) else {
                throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
            }
        }
        if let protectedAuthorityDigest {
            guard Self.isDigest(protectedAuthorityDigest) else {
                throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
            }
        }
        if let authorityReceiptDigest {
            guard Self.isDigest(authorityReceiptDigest) else {
                throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
            }
        }
        if let highWatermarkDigest {
            guard Self.isDigest(highWatermarkDigest) else {
                throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
            }
        }
        if let sourceStreamRootDigest {
            guard Self.isDigest(sourceStreamRootDigest) else {
                throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
            }
        }
        if let forkHeadDigest {
            guard Self.isDigest(forkHeadDigest) else {
                throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
            }
        }
        if let forkMergeRequest {
            guard Self.isDigest(forkMergeRequest) else {
                throw ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical
            }
        }
    }

    private static func digest(for wire: Wire) -> String {
        VeritasDigestFrameV1.digest(
            domain: "veritas-protected-capture-envelope-v1",
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
                wire.highWatermarkSupported.rawValue,
                wire.protectedAuthoritySupported.rawValue,
                wire.forkReconciliationVerified.map { $0 ? "FORK_RECONCILIATION_VERIFIED" : "FORK_RECONCILIATION_NOT_VERIFIED" } ?? "FORK_RECONCILIATION_NOT_PRESENT",
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


    private var highWatermarkStatus: ProtectedAuthorityCapabilityStatusV1 {
        sourceEventHighWatermark != nil || highWatermarkDigest != nil || sourceStreamRootDigest != nil
            ? .supported : .unsupported
    }

    private var protectedAuthorityStatus: ProtectedAuthorityCapabilityStatusV1 {
        protectedAuthorityDigest != nil ? .supported : .unsupported
    }
}

/// Errors for the protected-authority envelope.
public enum ProtectedAuthorityCaptureEnvelopeErrorV1: Error, Equatable, Sendable {
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
