import Foundation

/// Volatile coordinator correlation for one attempted capture. Founder Alpha
/// validates but does not persist this digest or use it as occurrence authority.
/// Equivalent replays preserve the first stored timestamps.
public struct PipelineIncidentCaptureContextV1: Equatable, Sendable {
    /// Volatile retry correlation supplied by the coordinator. Founder Alpha
    /// validates this value but never treats it as occurrence-count authority.
    public let runObservationDigest: String
    public let observedAt: Date
    public let retentionReviewAt: Date?

    public init(
        runObservationDigest: String,
        observedAt: Date,
        retentionReviewAt: Date?
    ) {
        self.runObservationDigest = runObservationDigest
        self.observedAt = observedAt
        self.retentionReviewAt = retentionReviewAt
    }
}

/// Switch/currentness authority for the non-authorizing capture seam.
///
/// A coordinator must invalidate pending captures when its snapshot changes.
/// Disabling or invalidating advances the generation, so a capture already
/// queued behind the ledger cannot commit under stale authority.
public final class PipelineIncidentCaptureControlV1: @unchecked Sendable {
    private let lock = NSLock()
    private var enabledState: Bool
    private var generation: UInt64 = 0
    private var issuedAdmissions: UInt64 = 0
#if DEBUG
    private var admissionObserverForTesting: (@Sendable () -> Void)?
    func setAdmissionObserverForTesting(_ observer: (@Sendable () -> Void)?) {
        lock.withLock { admissionObserverForTesting = observer }
    }
#endif

    public init(enabled: Bool = false) {
        self.enabledState = enabled
    }

    public var isEnabled: Bool {
        lock.withLock { enabledState }
    }

    public func setEnabled(_ enabled: Bool) {
        lock.withLock {
            guard enabledState != enabled else { return }
            advanceGeneration()
            enabledState = enabled && generation < .max
        }
    }

    /// The future app coordinator must call this for snapshot replacement,
    /// profile replacement, or any other currentness-invalidating mutation.
    public func invalidatePendingCaptures() {
        lock.withLock {
            advanceGeneration()
        }
    }

    fileprivate func issueAdmission() -> PipelineIncidentWriteAdmissionV1? {
        let admission: PipelineIncidentWriteAdmissionV1? = lock.withLock {
            guard enabledState, generation < .max else { return nil }
            issuedAdmissions += 1
            return PipelineIncidentWriteAdmissionV1(
                control: self,
                generation: generation
            )
        }
#if DEBUG
        // Observe actual issuance, not a guessed number of executor yields.
        // Never invoke a test callback while holding the capture-control lock.
        if admission != nil {
            let observer = lock.withLock { admissionObserverForTesting }
            observer?()
        }
#endif
        return admission
    }

    fileprivate func isCurrent(generation expected: UInt64) -> Bool {
        lock.withLock {
            enabledState && generation == expected
        }
    }

    fileprivate func commitIfCurrent(
        generation expected: UInt64,
        _ operation: () throws -> Void
    ) throws -> Bool {
        try lock.withLock {
            guard enabledState, generation == expected else { return false }
            try operation()
            return true
        }
    }

    func issuedAdmissionCountForTesting() -> UInt64 {
        lock.withLock { issuedAdmissions }
    }

    private func advanceGeneration() {
        guard generation < .max else {
            enabledState = false
            return
        }
        generation += 1
    }
}

struct PipelineIncidentWriteAdmissionV1: Sendable {
    private let control: PipelineIncidentCaptureControlV1
    private let generation: UInt64

    init(control: PipelineIncidentCaptureControlV1, generation: UInt64) {
        self.control = control
        self.generation = generation
    }

    var isCurrent: Bool {
        control.isCurrent(generation: generation)
    }

    func commitIfCurrent(_ operation: () throws -> Void) throws -> Bool {
        try control.commitIfCurrent(generation: generation, operation)
    }
}

public enum PipelineIncidentCaptureStatusV1: String, Sendable {
    case skipped = "SKIPPED"
    case appended = "APPENDED"
    case idempotentDuplicate = "IDEMPOTENT_DUPLICATE"
    case unavailable = "UNAVAILABLE"
    case refused = "REFUSED"
}

/// Closed public reasons. Underlying SQLite messages never cross this boundary.
public enum PipelineIncidentCaptureReasonV1: String, Error, Sendable {
    case disabled = "INCIDENT_CAPTURE_DISABLED"
    case cancelled = "INCIDENT_CAPTURE_CANCELLED"
    case admissionRevoked = "INCIDENT_CAPTURE_ADMISSION_REVOKED"
    case deterministicPass = "DETERMINISTIC_PASS_NOT_CAPTURED"
    case branchNotEligible = "PIPELINE_BRANCH_NOT_ELIGIBLE"
    case bindingMismatch = "PIPELINE_BINDING_MISMATCH"
    case malformedResult = "PIPELINE_RESULT_MALFORMED"
    case transcriptMismatch = "DETERMINISTIC_TRANSCRIPT_MISMATCH"
    case unsupportedCheck = "UNSUPPORTED_DETERMINISTIC_CHECK"
    case contextInvalid = "INCIDENT_CAPTURE_CONTEXT_INVALID"
    case snapshotByteLimitExceeded = "SNAPSHOT_BYTE_LIMIT_EXCEEDED"
    case captureEnvelopeInvalid = "INCIDENT_CAPTURE_ENVELOPE_INVALID"
    case captureEnvelopeDigestMismatch = "INCIDENT_CAPTURE_ENVELOPE_DIGEST_MISMATCH"
    case captureEnvelopeBindingMismatch = "INCIDENT_CAPTURE_ENVELOPE_BINDING_MISMATCH"
    case captureEnvelopeScopeMismatch = "INCIDENT_CAPTURE_ENVELOPE_SCOPE_MISMATCH"
    case actorAuthorityUnsupported = "INCIDENT_ACTOR_AUTHORITY_UNSUPPORTED"
    case protectedAuthorityUnsupported = "INCIDENT_PROTECTED_AUTHORITY_UNSUPPORTED"
    case highWatermarkUnsupported = "INCIDENT_HIGH_WATERMARK_UNSUPPORTED"
    case forkReconciliationUnsupported = "INCIDENT_FORK_RECONCILIATION_UNSUPPORTED"
    case evidenceEncodingFailed = "INCIDENT_EVIDENCE_ENCODING_FAILED"
    case ledgerUnavailable = "INCIDENT_LEDGER_UNAVAILABLE"
    case ledgerInputRejected = "INCIDENT_LEDGER_INPUT_REJECTED"
    case ledgerClosed = "INCIDENT_LEDGER_CLOSED"
    case ledgerIntegrityRefused = "INCIDENT_LEDGER_INTEGRITY_REFUSED"
    case ledgerObservationConflict = "INCIDENT_LEDGER_OBSERVATION_CONFLICT"
    case ledgerIncidentIDConflict = "INCIDENT_LEDGER_INCIDENT_ID_CONFLICT"
    case ledgerIncidentTombstoned = "INCIDENT_LEDGER_INCIDENT_TOMBSTONED"
    case ledgerCapacityExceeded = "INCIDENT_LEDGER_CAPACITY_EXCEEDED"
    case ledgerWriteFailed = "INCIDENT_LEDGER_WRITE_FAILED"
    case ledgerUnexpectedFailure = "INCIDENT_LEDGER_UNEXPECTED_FAILURE"
}

/// Capture evidence is intentionally separate from `PipelineResult`. Every effect
/// flag is frozen false so local history cannot become a reverse decision channel.
public struct PipelineIncidentCaptureOutcomeV1: Equatable, Sendable {
    public let status: PipelineIncidentCaptureStatusV1
    public let reason: PipelineIncidentCaptureReasonV1?
    public let pipelineResultEvidenceDigest: String?
    public let storedEvidenceSetDigest: String?
    /// Canonical transient attempt binding. Founder Alpha does not yet persist
    /// this as durable run provenance or treat it as occurrence authority.
    public let captureEnvelopeDigest: String?
    public let summary: IncidentSummaryV1?
    public let authorizing: Bool
    public let promptInfluence: Bool
    public let repairInfluence: Bool
    public let promotionInfluence: Bool
    public let certificationInfluence: Bool
    /// Event rows are fingerprints, not independently verified occurrences.
    public let occurrenceCountEvidence: Bool

    private init(
        status: PipelineIncidentCaptureStatusV1,
        reason: PipelineIncidentCaptureReasonV1?,
        pipelineResultEvidenceDigest: String?,
        storedEvidenceSetDigest: String?,
        summary: IncidentSummaryV1?,
        captureEnvelopeDigest: String? = nil
    ) {
        self.status = status
        self.reason = reason
        self.pipelineResultEvidenceDigest = pipelineResultEvidenceDigest
        self.storedEvidenceSetDigest = storedEvidenceSetDigest
        self.captureEnvelopeDigest = captureEnvelopeDigest
        self.summary = summary
        self.authorizing = false
        self.promptInfluence = false
        self.repairInfluence = false
        self.promotionInfluence = false
        self.certificationInfluence = false
        self.occurrenceCountEvidence = false
    }

    fileprivate static func skipped(_ reason: PipelineIncidentCaptureReasonV1) -> Self {
        Self(
            status: .skipped,
            reason: reason,
            pipelineResultEvidenceDigest: nil,
            storedEvidenceSetDigest: nil,
            summary: nil
        )
    }

    fileprivate static func unavailable(
        _ reason: PipelineIncidentCaptureReasonV1,
        pipelineDigest: String?
    ) -> Self {
        Self(
            status: .unavailable,
            reason: reason,
            pipelineResultEvidenceDigest: pipelineDigest,
            storedEvidenceSetDigest: nil,
            summary: nil
        )
    }

    fileprivate static func refused(
        _ reason: PipelineIncidentCaptureReasonV1,
        pipelineDigest: String?
    ) -> Self {
        Self(
            status: .refused,
            reason: reason,
            pipelineResultEvidenceDigest: pipelineDigest,
            storedEvidenceSetDigest: nil,
            summary: nil
        )
    }

    fileprivate static func recorded(
        _ disposition: IncidentAppendDispositionV1,
        pipelineDigest: String,
        storedDigest: String,
        captureEnvelopeDigest: String
    ) -> Self {
        switch disposition {
        case .appended(let summary):
            Self(
                status: .appended,
                reason: nil,
                pipelineResultEvidenceDigest: pipelineDigest,
                storedEvidenceSetDigest: storedDigest,
                summary: summary,
                captureEnvelopeDigest: captureEnvelopeDigest
            )
        case .idempotentDuplicate(let summary):
            Self(
                status: .idempotentDuplicate,
                reason: nil,
                pipelineResultEvidenceDigest: pipelineDigest,
                storedEvidenceSetDigest: storedDigest,
                summary: summary,
                captureEnvelopeDigest: captureEnvelopeDigest
            )
        }
    }
}

struct PipelineIncidentCodeMappingV1: Equatable, Sendable {
    let failureCodes: [IncidentFailureCodeV1]
    let symptomCodes: [IncidentSymptomCodeV1]
}

/// FA-P0 is a non-authorizing capture seam. It has no default storage authority,
/// does not run unless explicitly enabled, and never changes the supplied result.
public struct PipelineIncidentAdapterV1: Sendable {
    public static let profile = "veritas-pipeline-incident-adapter-v1"

    public let control: PipelineIncidentCaptureControlV1

    public var enabled: Bool { control.isEnabled }

    public init(enabled: Bool = false) {
        self.control = PipelineIncidentCaptureControlV1(enabled: enabled)
    }

    public init(control: PipelineIncidentCaptureControlV1) {
        self.control = control
    }

    public func capture(
        snapshot: ArtifactSnapshot,
        profile: CheckProfile,
        mode: VeritasMode,
        result: PipelineResult,
        context: PipelineIncidentCaptureContextV1,
        ledger: LocalIncidentLedgerV1?
    ) async -> PipelineIncidentCaptureOutcomeV1 {
        await captureInternal(
            snapshot: snapshot,
            profile: profile,
            mode: mode,
            result: result,
            context: context,
            suppliedEnvelopeData: nil,
            ledger: ledger
        )
    }

    /// Strict raw-envelope entry point used by future decoded/coordinator inputs
    /// and by poisoning tests. The envelope remains non-authorizing and is
    /// rebound to every actual production value before storage.
    public func capture(
        snapshot: ArtifactSnapshot,
        profile: CheckProfile,
        mode: VeritasMode,
        result: PipelineResult,
        context: PipelineIncidentCaptureContextV1,
        envelopeData: Data,
        ledger: LocalIncidentLedgerV1?
    ) async -> PipelineIncidentCaptureOutcomeV1 {
        await captureInternal(
            snapshot: snapshot,
            profile: profile,
            mode: mode,
            result: result,
            context: context,
            suppliedEnvelopeData: envelopeData,
            ledger: ledger
        )
    }

    private func captureInternal(
        snapshot: ArtifactSnapshot,
        profile: CheckProfile,
        mode: VeritasMode,
        result: PipelineResult,
        context: PipelineIncidentCaptureContextV1,
        suppliedEnvelopeData: Data?,
        ledger: LocalIncidentLedgerV1?
    ) async -> PipelineIncidentCaptureOutcomeV1 {
        guard let admission = control.issueAdmission() else { return .skipped(.disabled) }
        guard !Task.isCancelled else { return .skipped(.cancelled) }
        guard snapshot.bytes.count <= ArtifactSnapshotter.prototypeByteLimit else {
            return .refused(
                .snapshotByteLimitExceeded,
                pipelineDigest: result.resultEvidenceDigest
            )
        }

        guard
            result.subjectDigest == snapshot.subjectDigest,
            result.artifactKind == snapshot.kind,
            result.profileID == profile.id,
            result.profileFingerprint == profile.rulesFingerprint,
            result.mode == mode
        else {
            return .skipped(.bindingMismatch)
        }

        let rerun = DeterministicGateRunner().run(snapshot: snapshot, profile: profile)
        guard rerun == result.deterministicChecks else {
            return .refused(.transcriptMismatch, pipelineDigest: result.resultEvidenceDigest)
        }
        let rerunPassed = !rerun.isEmpty && rerun.allSatisfy { $0.status == .pass }
        guard result.deterministicPassed == rerunPassed else {
            return .refused(.malformedResult, pipelineDigest: result.resultEvidenceDigest)
        }
        if rerunPassed {
            return .skipped(.deterministicPass)
        }
        guard mode == .assist, result.disposition == .needsAttention else {
            return .skipped(.branchNotEligible)
        }
        guard
            !result.deterministicChecks.isEmpty,
            result.modelParticipation == .notRun,
            result.analyzerProbe == nil,
            result.advisoryReceipt == nil,
            result.advisoryCoverage == nil,
            result.advisoryPlan.isEmpty,
            result.findings.isEmpty,
            !result.canAcceptInsideVeritas,
            result.limitationCodes == ["DETERMINISTIC_GATE_FAILED_MODEL_SKIPPED"]
        else {
            return .refused(.malformedResult, pipelineDigest: result.resultEvidenceDigest)
        }
        guard !Task.isCancelled else { return .skipped(.cancelled) }
        guard admission.isCurrent else { return .skipped(.admissionRevoked) }

        let mapping: PipelineIncidentCodeMappingV1
        do {
            mapping = try Self.map(checks: rerun)
        } catch {
            return .refused(.unsupportedCheck, pipelineDigest: result.resultEvidenceDigest)
        }

        guard let pipelineDigest = result.resultEvidenceDigest else {
            return .refused(.evidenceEncodingFailed, pipelineDigest: nil)
        }
        guard let normalizedContext = Self.normalize(context: context) else {
            return .refused(.contextInvalid, pipelineDigest: pipelineDigest)
        }
        let suppliedEnvelope: PipelineIncidentCaptureEnvelopeV1?
        if let suppliedEnvelopeData {
            do {
                suppliedEnvelope = try PipelineIncidentCaptureEnvelopeV1.decodeCanonical(
                    suppliedEnvelopeData
                )
            } catch let error as PipelineIncidentCaptureEnvelopeErrorV1 {
                return .refused(
                    Self.captureReason(for: error),
                    pipelineDigest: pipelineDigest
                )
            } catch {
                return .refused(.captureEnvelopeInvalid, pipelineDigest: pipelineDigest)
            }
        } else {
            suppliedEnvelope = nil
        }
        guard let ledger else {
            return .unavailable(
                .ledgerUnavailable,
                pipelineDigest: pipelineDigest
            )
        }
        let expectedEnvelope: PipelineIncidentCaptureEnvelopeV1
        do {
            expectedEnvelope = try PipelineIncidentCaptureEnvelopeV1.make(
                snapshot: snapshot,
                profile: profile,
                mode: mode,
                result: result,
                scope: ledger.scope,
                context: normalizedContext
            )
        } catch {
            return .refused(.captureEnvelopeInvalid, pipelineDigest: pipelineDigest)
        }
        let captureEnvelope: PipelineIncidentCaptureEnvelopeV1
        if let suppliedEnvelope {
            guard suppliedEnvelope.hasSameScope(as: ledger.scope) else {
                return .refused(.captureEnvelopeScopeMismatch, pipelineDigest: pipelineDigest)
            }
            guard suppliedEnvelope == expectedEnvelope else {
                return .refused(.captureEnvelopeBindingMismatch, pipelineDigest: pipelineDigest)
            }
            captureEnvelope = suppliedEnvelope
        } else {
            captureEnvelope = expectedEnvelope
        }
        let subjectIDDigest = captureEnvelope.subjectIDDigest
        let evidenceSetDigest = captureEnvelope.evidenceSetDigest
        let distinctBindings = Set([subjectIDDigest, snapshot.subjectDigest, evidenceSetDigest])
        guard distinctBindings.count == 3 else {
            return .refused(.contextInvalid, pipelineDigest: pipelineDigest)
        }

        let failureValues = mapping.failureCodes.map(\.rawValue)
        let symptomValues = mapping.symptomCodes.map(\.rawValue)
        let observationKey = VeritasDigestFrameV1.digest(
            domain: "veritas-pipeline-observation-key-v1",
            fields: [
                Self.profile,
                ledger.scope.scopeID,
                ledger.scope.projectDigest,
                subjectIDDigest,
                snapshot.subjectDigest,
                evidenceSetDigest,
            ] + failureValues + symptomValues
        )
        let incidentDigest = VeritasDigestFrameV1.digest(
            domain: "veritas-pipeline-incident-id-v1",
            fields: [
                Self.profile,
                ledger.scope.scopeID,
                ledger.scope.projectDigest,
                observationKey,
                evidenceSetDigest,
            ] + failureValues + symptomValues
        )
        let observation = IncidentObservationInputV1(
            incidentID: "incident/\(incidentDigest)",
            observationKey: observationKey,
            subjectIDDigest: subjectIDDigest,
            subjectContentDigest: snapshot.subjectDigest,
            evidenceSetDigest: evidenceSetDigest,
            failureCodes: mapping.failureCodes,
            symptomCodes: mapping.symptomCodes,
            observedAt: normalizedContext.observedAt,
            retentionReviewAt: normalizedContext.retentionReviewAt
        )

        guard !Task.isCancelled else { return .skipped(.cancelled) }
        guard admission.isCurrent else { return .skipped(.admissionRevoked) }
        do {
            let disposition = try await ledger.record(
                observation,
                admission: admission,
                collapseEquivalentReplays: true
            )
            return .recorded(
                disposition,
                pipelineDigest: pipelineDigest,
                storedDigest: evidenceSetDigest,
                captureEnvelopeDigest: captureEnvelope.envelopeDigest
            )
        } catch is CancellationError {
            return .skipped(.cancelled)
        } catch let error as IncidentLedgerErrorV1 {
            if error == .admissionRevoked {
                return .skipped(.admissionRevoked)
            }
            let reason: PipelineIncidentCaptureReasonV1
            let status: PipelineIncidentCaptureStatusV1
            switch error {
            case .invalidInput:
                reason = .ledgerInputRejected
                status = .refused
            case .unsupportedStorage:
                reason = .ledgerUnavailable
                status = .unavailable
            case .closed:
                reason = .ledgerClosed
                status = .unavailable
            case .integrity, .namespaceObservation:
                reason = .ledgerIntegrityRefused
                status = .refused
            case .observationConflict:
                reason = .ledgerObservationConflict
                status = .refused
            case .incidentIDConflict:
                reason = .ledgerIncidentIDConflict
                status = .refused
            case .incidentTombstoned:
                reason = .ledgerIncidentTombstoned
                status = .refused
            case .capacityExceeded:
                reason = .ledgerCapacityExceeded
                status = .refused
            case .sqlite:
                reason = .ledgerWriteFailed
                status = .unavailable
            case .incidentNotFound, .subjectMismatch, .selectionMismatch,
                 .tombstoneConflict, .retentionNotDue,
                 .retentionDeadlineMissing, .retentionPolicyMismatch,
                 .exportEncodingFailed:
                reason = .ledgerUnexpectedFailure
                status = .refused
            case .admissionRevoked:
                reason = .admissionRevoked
                status = .skipped
            }
            switch status {
            case .unavailable:
                return .unavailable(reason, pipelineDigest: pipelineDigest)
            case .refused:
                return .refused(reason, pipelineDigest: pipelineDigest)
            case .skipped:
                return .skipped(reason)
            case .appended, .idempotentDuplicate:
                return .refused(.ledgerUnexpectedFailure, pipelineDigest: pipelineDigest)
            }
        } catch {
            return .refused(
                .ledgerUnexpectedFailure,
                pipelineDigest: pipelineDigest
            )
        }
    }

    private static func captureReason(
        for error: PipelineIncidentCaptureEnvelopeErrorV1
    ) -> PipelineIncidentCaptureReasonV1 {
        switch error {
        case .inputNonCanonical, .duplicateObjectKey, .schemaUnsupported:
            .captureEnvelopeInvalid
        case .digestMismatch:
            .captureEnvelopeDigestMismatch
        case .bindingMismatch:
            .captureEnvelopeBindingMismatch
        case .scopeMismatch:
            .captureEnvelopeScopeMismatch
        case .actorAuthorityUnsupported:
            .actorAuthorityUnsupported
        case .protectedAuthorityUnsupported:
            .protectedAuthorityUnsupported
        case .highWatermarkUnsupported:
            .highWatermarkUnsupported
        case .forkReconciliationUnsupported:
            .forkReconciliationUnsupported
        }
    }

    static func map(checks: [CheckOutcome]) throws -> PipelineIncidentCodeMappingV1 {
        let admittedIDs = Set([
            "DET-001-NONEMPTY",
            "DET-002-UTF8",
            "DET-003-JSON-STRUCTURE",
            "DET-003-REQUIRED-SECTIONS",
        ])
        guard
            !checks.isEmpty,
            Set(checks.map(\.id)).count == checks.count,
            checks.allSatisfy({ check in
                admittedIDs.contains(check.id)
                    || (check.id == "DET-003-STRUCTURE" && check.status == .notRun)
            })
        else {
            throw PipelineIncidentCaptureReasonV1.unsupportedCheck
        }

        var failureCodes = Set<IncidentFailureCodeV1>()
        var symptomCodes = Set<IncidentSymptomCodeV1>()
        for check in checks {
            switch check.status {
            case .pass, .notRun:
                continue
            case .error:
                throw PipelineIncidentCaptureReasonV1.unsupportedCheck
            case .inconclusive:
                failureCodes.insert(.deterministicCheckInconclusive)
                symptomCodes.insert(.inconclusiveResult)
            case .fail:
                failureCodes.insert(.deterministicCheckFailed)
                switch check.id {
                case "DET-001-NONEMPTY":
                    symptomCodes.insert(.invalidStructure)
                case "DET-002-UTF8", "DET-003-JSON-STRUCTURE":
                    failureCodes.insert(.schemaInvalid)
                    symptomCodes.insert(.invalidStructure)
                case "DET-003-REQUIRED-SECTIONS":
                    failureCodes.insert(.requirementMissing)
                    symptomCodes.insert(.missingSection)
                default:
                    throw PipelineIncidentCaptureReasonV1.unsupportedCheck
                }
            }
        }
        guard !failureCodes.isEmpty, !symptomCodes.isEmpty else {
            throw PipelineIncidentCaptureReasonV1.unsupportedCheck
        }
        return PipelineIncidentCodeMappingV1(
            failureCodes: failureCodes.sorted { $0.rawValue < $1.rawValue },
            symptomCodes: symptomCodes.sorted { $0.rawValue < $1.rawValue }
        )
    }

    private static func normalize(
        context: PipelineIncidentCaptureContextV1
    ) -> PipelineIncidentCaptureContextV1? {
        guard isDigest(context.runObservationDigest),
              let observedMilliseconds = milliseconds(context.observedAt) else {
            return nil
        }
        let retentionMilliseconds: Int64?
        if let retentionReviewAt = context.retentionReviewAt {
            guard let value = milliseconds(retentionReviewAt), value > observedMilliseconds else {
                return nil
            }
            retentionMilliseconds = value
        } else {
            retentionMilliseconds = nil
        }
        return PipelineIncidentCaptureContextV1(
            runObservationDigest: context.runObservationDigest,
            observedAt: Date(timeIntervalSince1970: TimeInterval(observedMilliseconds) / 1_000),
            retentionReviewAt: retentionMilliseconds.map {
                Date(timeIntervalSince1970: TimeInterval($0) / 1_000)
            }
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
