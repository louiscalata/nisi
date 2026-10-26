import VeritasTestEvidenceSupport
import Foundation
import Dispatch
import Testing
@testable import VeritasCore

private func adapterDigest(_ value: String) -> String {
    ArtifactSnapshot.digest(Data(value.utf8))
}

private func adapterScope(
    _ project: String = "adapter-project",
    access: String = "adapter-access-v1",
    retention: String = "adapter-retention-v1"
) -> IncidentLedgerScopeV1 {
    IncidentLedgerScopeV1(
        scopeID: "scope/veritas-private",
        projectDigest: adapterDigest(project),
        accessPolicyDigest: adapterDigest(access),
        retentionPolicyDigest: adapterDigest(retention)
    )
}

private func makeAdapterRoot() throws -> URL {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("veritas-pipeline-adapter-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(
        at: root,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: NSNumber(value: 0o700)]
    )
    return root
}

private func adapterContext(
    run: String = "adapter-run-1",
    observedAt: Date = Date(timeIntervalSince1970: 1_800_000_000),
    retentionReviewAt: Date? = Date(timeIntervalSince1970: 1_801_209_600)
) -> PipelineIncidentCaptureContextV1 {
    PipelineIncidentCaptureContextV1(
        runObservationDigest: adapterDigest(run),
        observedAt: observedAt,
        retentionReviewAt: retentionReviewAt
    )
}

private func adapterSnapshot(
    _ bytes: Data = Data("{".utf8),
    kind: ArtifactKind = .json,
    displayName: String = "adapter-artifact.json"
) -> ArtifactSnapshot {
    ArtifactSnapshot(displayName: displayName, kind: kind, bytes: bytes)
}

private func adapterResult(
    snapshot: ArtifactSnapshot,
    profile: CheckProfile = .prototype,
    mode: VeritasMode = .assist
) async -> PipelineResult {
    await VeritasPipeline(analyzer: DeterministicOnlyOrchestrator()).analyze(
        snapshot: snapshot,
        profile: profile,
        mode: mode
    )
}

private func copiedResult(
    _ result: PipelineResult,
    deterministicChecks: [CheckOutcome]? = nil,
    deterministicPassed: Bool? = nil,
    modelParticipation: ModelParticipation? = nil
) -> PipelineResult {
    PipelineResult(
        subjectDigest: result.subjectDigest,
        artifactKind: result.artifactKind,
        profileID: result.profileID,
        profileFingerprint: result.profileFingerprint,
        mode: result.mode,
        disposition: result.disposition,
        deterministicChecks: deterministicChecks ?? result.deterministicChecks,
        deterministicPassed: deterministicPassed ?? result.deterministicPassed,
        modelParticipation: modelParticipation ?? result.modelParticipation,
        analyzerProbe: result.analyzerProbe,
        advisoryReceipt: result.advisoryReceipt,
        advisoryCoverage: result.advisoryCoverage,
        advisoryPlan: result.advisoryPlan,
        findings: result.findings,
        canAcceptInsideVeritas: result.canAcceptInsideVeritas,
        limitationCodes: result.limitationCodes
    )
}

private final class AdapterBlockingFaultGate: @unchecked Sendable {
    let entered: AsyncStream<Void>
    let release = DispatchSemaphore(value: 0)
    private let enteredContinuation: AsyncStream<Void>.Continuation
    private let lock = NSLock()
    private var firstWrite = true

    init() {
        var continuation: AsyncStream<Void>.Continuation?
        self.entered = AsyncStream(bufferingPolicy: .bufferingNewest(1)) {
            continuation = $0
        }
        self.enteredContinuation = continuation!
    }

    func inject(_ point: IncidentLedgerFaultPointV1) throws {
        guard point == .afterEventInsertBeforeMetadataUpdate else { return }
        let shouldBlock = lock.withLock {
            guard firstWrite else { return false }
            firstWrite = false
            return true
        }
        guard shouldBlock else { return }
        enteredContinuation.yield(())
        _ = release.wait(timeout: .now() + 5)
        throw IncidentLedgerErrorV1.integrity("INJECTED_QUEUE_BLOCK")
    }
}

private final class AdapterTransactionFaultGate: @unchecked Sendable {
    let entered: AsyncStream<Void>
    let release = DispatchSemaphore(value: 0)
    private let enteredContinuation: AsyncStream<Void>.Continuation

    init() {
        var continuation: AsyncStream<Void>.Continuation?
        self.entered = AsyncStream(bufferingPolicy: .bufferingNewest(1)) {
            continuation = $0
        }
        self.enteredContinuation = continuation!
    }

    func inject(_ point: IncidentLedgerFaultPointV1) throws {
        guard point == .afterEventInsertBeforeMetadataUpdate else { return }
        enteredContinuation.yield(())
        _ = release.wait(timeout: .now() + 5)
    }
}

private func blockerObservation() -> IncidentObservationInputV1 {
    IncidentObservationInputV1(
        incidentID: "incident/\(adapterDigest("blocker-incident"))",
        observationKey: adapterDigest("blocker-observation"),
        subjectIDDigest: adapterDigest("blocker-subject-id"),
        subjectContentDigest: adapterDigest("blocker-subject-content"),
        evidenceSetDigest: adapterDigest("blocker-evidence"),
        failureCodes: [.deterministicCheckFailed],
        symptomCodes: [.invalidStructure],
        observedAt: Date(timeIntervalSince1970: 1_799_000_000),
        retentionReviewAt: Date(timeIntervalSince1970: 1_799_086_400)
    )
}

private struct FI08TransientEnvelopeEvidenceV1: Encodable {
    let schemaVersion: Int
    let profile: String
    let status: String
    let envelopeDigest: String
    let resultEvidenceDigest: String
    let snapshotterAdmissionUsed: Bool
    let rawEnvelopeEntryPointReached: Bool
    let canonicalRoundTrip: Bool
    let positiveAppendCount: Int
    let finalPrimaryLedgerEventCount: Int
    let finalSubstitutedLedgerEventCount: Int
    let bindingRefusalCount: Int
    let scopeRefusalCount: Int
    let unsupportedCapabilityRefusalCount: Int
    let malformedEnvelopeRefusalCount: Int
    let digestMismatchRefused: Bool
    let duplicateKeyRefused: Bool
    let mutatedBindings: [String]
    let actorAuthoritySupported: Bool
    let protectedAuthoritySupported: Bool
    let highWatermarkSupported: Bool
    let forkReconciliationSupported: Bool
    let durableRunProvenance: Bool
    let productIntegratedRawEnvelope: Bool
    let publicUnvalidatedLedgerWriteExposed: Bool
    let physicalDiskFullTested: Bool
    let authorizing: Bool
    let promptInfluence: Bool
    let repairInfluence: Bool
    let promotionInfluence: Bool
    let certificationInfluence: Bool
    let independentCertification: Bool
    let fi08Accepted: Bool
    let fi04Accepted: Bool
}

@Suite("FA-P0 deterministic pipeline incident adapter")
struct PipelineIncidentAdapterTests {
    @Test("Canonical capture envelopes bind production inputs and refuse unsupported authority claims")
    func canonicalCaptureEnvelope() async throws {
        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scopeA = adapterScope("envelope-project-a")
        let scopeB = adapterScope("envelope-project-b")
        let ledgerA = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scopeA)
        let ledgerB = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scopeB)
        let snapshotA = try ArtifactSnapshotter().snapshot(
            displayName: "envelope.json",
            kind: .json,
            bytes: Data([0xff])
        )
        let resultA = await adapterResult(snapshot: snapshotA)
        let contextA = adapterContext(run: "envelope-run-a")
        let envelope = try PipelineIncidentCaptureEnvelopeV1.make(
            snapshot: snapshotA,
            profile: .prototype,
            mode: .assist,
            result: resultA,
            scope: scopeA,
            context: contextA
        )
        let canonicalData = try envelope.canonicalData()
        #expect(try PipelineIncidentCaptureEnvelopeV1.decodeCanonical(canonicalData) == envelope)

        let canonicalText = String(decoding: canonicalData, as: UTF8.self)
        for (key, expectedError) in [
            ("actorIdentityDigest", PipelineIncidentCaptureEnvelopeErrorV1.actorAuthorityUnsupported),
            ("protectedAuthorityDigest", .protectedAuthorityUnsupported),
            ("sourceEventHighWatermark", .highWatermarkUnsupported),
            ("forkHeadDigest", .forkReconciliationUnsupported),
        ] {
            #expect(throws: expectedError) {
                try PipelineIncidentCaptureEnvelopeV1.decodeCanonical(
                    Data(("{\"" + key + "\":null," + canonicalText.dropFirst()).utf8)
                )
            }
            // A nested unsupported claim must not become a top-level claim.
            #expect(throws: PipelineIncidentCaptureEnvelopeErrorV1.inputNonCanonical) {
                try PipelineIncidentCaptureEnvelopeV1.decodeCanonical(
                    Data(("{\"extra\":{\"" + key + "\":null}," + canonicalText.dropFirst()).utf8)
                )
            }
        }
        #expect(throws: PipelineIncidentCaptureEnvelopeErrorV1.duplicateObjectKey) {
            try PipelineIncidentCaptureEnvelopeV1.decodeCanonical(
                Data(("{\"schemaVersion\":1," + canonicalText.dropFirst()).utf8)
            )
        }
        for malformed in [
            canonicalText + "null", "[" + canonicalText + "]",
            canonicalText.replacingOccurrences(of: "\"schemaVersion\":", with: "\"\\u0073chemaVersion\":"),
        ] {
            #expect(throws: PipelineIncidentCaptureEnvelopeErrorV1.inputNonCanonical) {
                try PipelineIncidentCaptureEnvelopeV1.decodeCanonical(Data(malformed.utf8))
            }
        }
        for (key, expectedError) in [
            ("actorAuthorityStatus", PipelineIncidentCaptureEnvelopeErrorV1.actorAuthorityUnsupported),
            ("protectedAuthorityStatus", .protectedAuthorityUnsupported),
            ("highWatermarkStatus", .highWatermarkUnsupported),
            ("forkReconciliationStatus", .forkReconciliationUnsupported),
        ] {
            for value in ["null", "true", "1", "[]", #"{"status":"UNSUPPORTED"}"#, #""SUPPORTED""#] {
                let altered = canonicalText.replacingOccurrences(
                    of: "\"" + key + "\":\"UNSUPPORTED\"",
                    with: "\"" + key + "\":" + value
                )
                #expect(altered != canonicalText)
                #expect(throws: expectedError) {
                    try PipelineIncidentCaptureEnvelopeV1.decodeCanonical(Data(altered.utf8))
                }
            }
        }

        let positive = await enabled.capture(
            snapshot: snapshotA,
            profile: .prototype,
            mode: .assist,
            result: resultA,
            context: contextA,
            envelopeData: canonicalData,
            ledger: ledgerA
        )
        #expect(positive.status == .appended)
        #expect(positive.captureEnvelopeDigest == envelope.envelopeDigest)
        #expect(!positive.authorizing)
        #expect(!positive.promptInfluence)
        #expect(!positive.repairInfluence)
        #expect(!positive.promotionInfluence)
        #expect(!positive.certificationInfluence)
        #expect(!positive.occurrenceCountEvidence)

        let alternateRunContext = adapterContext(run: "envelope-run-b")
        let alternateRunEnvelope = try PipelineIncidentCaptureEnvelopeV1.make(
            snapshot: snapshotA,
            profile: .prototype,
            mode: .assist,
            result: resultA,
            scope: scopeA,
            context: alternateRunContext
        )
        let snapshotContent = try ArtifactSnapshotter().snapshot(
            displayName: "envelope-content.json",
            kind: .json,
            bytes: Data([0xfe])
        )
        let contentResult = await adapterResult(snapshot: snapshotContent)
        let contentEnvelope = try PipelineIncidentCaptureEnvelopeV1.make(
            snapshot: snapshotContent,
            profile: .prototype,
            mode: .assist,
            result: contentResult,
            scope: scopeA,
            context: contextA
        )
        let snapshotType = try ArtifactSnapshotter().snapshot(
            displayName: "envelope.txt",
            kind: .text,
            bytes: Data([0xff])
        )
        let typeResult = await adapterResult(snapshot: snapshotType)
        let typeEnvelope = try PipelineIncidentCaptureEnvelopeV1.make(
            snapshot: snapshotType,
            profile: .prototype,
            mode: .assist,
            result: typeResult,
            scope: scopeA,
            context: contextA
        )
        let alternateProfile = CheckProfile(id: "veritas-envelope-alternate-profile")
        let profileResult = await adapterResult(snapshot: snapshotA, profile: alternateProfile)
        let profileEnvelope = try PipelineIncidentCaptureEnvelopeV1.make(
            snapshot: snapshotA,
            profile: alternateProfile,
            mode: .assist,
            result: profileResult,
            scope: scopeA,
            context: contextA
        )
        let modeResult = await adapterResult(snapshot: snapshotA, mode: .enforce)
        let modeEnvelope = try PipelineIncidentCaptureEnvelopeV1.make(
            snapshot: snapshotA,
            profile: .prototype,
            mode: .enforce,
            result: modeResult,
            scope: scopeA,
            context: contextA
        )
        let alteredResult = copiedResult(
            resultA,
            deterministicChecks: [CheckOutcome(
                id: "DET-002-UTF8",
                status: .fail,
                explanation: "A coherent alternate result envelope."
            )]
        )
        let resultEnvelope = try PipelineIncidentCaptureEnvelopeV1.make(
            snapshot: snapshotA,
            profile: .prototype,
            mode: .assist,
            result: alteredResult,
            scope: scopeA,
            context: contextA
        )
        let observedAtEnvelope = try PipelineIncidentCaptureEnvelopeV1.make(
            snapshot: snapshotA,
            profile: .prototype,
            mode: .assist,
            result: resultA,
            scope: scopeA,
            context: adapterContext(
                run: "envelope-run-a",
                observedAt: Date(timeIntervalSince1970: 1_800_000_001)
            )
        )
        let retentionEnvelope = try PipelineIncidentCaptureEnvelopeV1.make(
            snapshot: snapshotA,
            profile: .prototype,
            mode: .assist,
            result: resultA,
            scope: scopeA,
            context: adapterContext(
                run: "envelope-run-a",
                retentionReviewAt: Date(timeIntervalSince1970: 1_801_209_601)
            )
        )
        let scopeEnvelopes = try [
            adapterScope("envelope-project-b"),
            adapterScope("envelope-project-a", access: "alternate-access"),
            adapterScope("envelope-project-a", retention: "alternate-retention"),
        ].map { alternateScope in
            try PipelineIncidentCaptureEnvelopeV1.make(
                snapshot: snapshotA,
                profile: .prototype,
                mode: .assist,
                result: resultA,
                scope: alternateScope,
                context: contextA
            )
        }

        #expect(contentEnvelope.subjectContentDigest != envelope.subjectContentDigest)
        #expect(contentEnvelope.subjectIDDigest != envelope.subjectIDDigest)
        #expect(typeEnvelope.subjectType != envelope.subjectType)
        #expect(typeEnvelope.subjectIDDigest != envelope.subjectIDDigest)
        #expect(profileEnvelope.profileID != envelope.profileID)
        #expect(profileEnvelope.profileFingerprint != envelope.profileFingerprint)
        #expect(resultEnvelope.resultEvidenceDigest != envelope.resultEvidenceDigest)
        #expect(resultEnvelope.evidenceSetDigest != envelope.evidenceSetDigest)

        let bindingEnvelopes = [
            alternateRunEnvelope,
            contentEnvelope,
            typeEnvelope,
            profileEnvelope,
            modeEnvelope,
            resultEnvelope,
            observedAtEnvelope,
            retentionEnvelope,
        ]
        for alternate in bindingEnvelopes {
            let outcome = await enabled.capture(
                snapshot: snapshotA,
                profile: .prototype,
                mode: .assist,
                result: resultA,
                context: contextA,
                envelopeData: try alternate.canonicalData(),
                ledger: ledgerA
            )
            #expect(outcome.status == .refused)
            #expect(outcome.reason == .captureEnvelopeBindingMismatch)
            #expect(outcome.captureEnvelopeDigest == nil)
        }
        for alternate in scopeEnvelopes {
            let outcome = await enabled.capture(
                snapshot: snapshotA,
                profile: .prototype,
                mode: .assist,
                result: resultA,
                context: contextA,
                envelopeData: try alternate.canonicalData(),
                ledger: ledgerA
            )
            #expect(outcome.status == .refused)
            #expect(outcome.reason == .captureEnvelopeScopeMismatch)
            #expect(outcome.captureEnvelopeDigest == nil)
        }

        let projectSubstitution = await enabled.capture(
            snapshot: snapshotA,
            profile: .prototype,
            mode: .assist,
            result: resultA,
            context: contextA,
            envelopeData: canonicalData,
            ledger: ledgerB
        )
        #expect(projectSubstitution.status == .refused)
        #expect(projectSubstitution.reason == .captureEnvelopeScopeMismatch)

        guard var raw = try JSONSerialization.jsonObject(with: canonicalData) as? [String: Any] else {
            Issue.record("The canonical envelope must decode as one JSON object.")
            return
        }
        func encoded(_ object: [String: Any]) throws -> Data {
            try JSONSerialization.data(
                withJSONObject: object,
                options: [.sortedKeys, .withoutEscapingSlashes]
            )
        }
        let unsupportedClaims: [(String, Any, PipelineIncidentCaptureReasonV1)] = [
            ("actorIdentityDigest", adapterDigest("forged-actor"), .actorAuthorityUnsupported),
            ("protectedAuthorityDigest", adapterDigest("forged-authority"), .protectedAuthorityUnsupported),
            ("sourceEventHighWatermark", 7, .highWatermarkUnsupported),
            ("forkHeadDigest", adapterDigest("forged-fork"), .forkReconciliationUnsupported),
        ]
        for (key, value, expectedReason) in unsupportedClaims {
            var claimed = raw
            claimed[key] = value
            let outcome = await enabled.capture(
                snapshot: snapshotA,
                profile: .prototype,
                mode: .assist,
                result: resultA,
                context: contextA,
                envelopeData: try encoded(claimed),
                ledger: ledgerA
            )
            #expect(outcome.status == .refused)
            #expect(outcome.reason == expectedReason)
            #expect(outcome.captureEnvelopeDigest == nil)
        }

        let unsupportedStatuses: [(String, PipelineIncidentCaptureReasonV1)] = [
            ("actorAuthorityStatus", .actorAuthorityUnsupported),
            ("protectedAuthorityStatus", .protectedAuthorityUnsupported),
            ("highWatermarkStatus", .highWatermarkUnsupported),
            ("forkReconciliationStatus", .forkReconciliationUnsupported),
        ]
        for (key, expectedReason) in unsupportedStatuses {
            var claimed = raw
            claimed[key] = "SUPPORTED"
            let outcome = await enabled.capture(
                snapshot: snapshotA,
                profile: .prototype,
                mode: .assist,
                result: resultA,
                context: contextA,
                envelopeData: try encoded(claimed),
                ledger: ledgerA
            )
            #expect(outcome.status == .refused)
            #expect(outcome.reason == expectedReason)
            #expect(outcome.captureEnvelopeDigest == nil)
        }

        var extraField = raw
        extraField["unknown"] = "refuse"
        var missingField = raw
        missingField.removeValue(forKey: "profileID")
        var futureSchema = raw
        futureSchema["schemaVersion"] = 2
        var wrongCaseDigest = raw
        wrongCaseDigest["runObservationDigest"] = envelope.runObservationDigest.uppercased()
        var invalidRetention = raw
        invalidRetention["retentionReviewAtPresent"] = true
        invalidRetention["retentionReviewAtMilliseconds"] = envelope.observedAtMilliseconds
        let reversedFragments = try raw.keys.sorted(by: >).map { key -> String in
            let keyData = try JSONSerialization.data(withJSONObject: key, options: [.fragmentsAllowed])
            let valueData = try JSONSerialization.data(
                withJSONObject: raw[key]!,
                options: [.fragmentsAllowed, .withoutEscapingSlashes]
            )
            return "\(String(decoding: keyData, as: UTF8.self)):\(String(decoding: valueData, as: UTF8.self))"
        }
        let reordered = Data("{\(reversedFragments.joined(separator: ","))}".utf8)
        var oversizedEnvelope = canonicalData
        oversizedEnvelope.append(Data(
            repeating: 0x20,
            count: PipelineIncidentCaptureEnvelopeV1.maximumCanonicalBytes
                - canonicalData.count + 1
        ))
        let malformedEnvelopes = try [
            encoded(extraField),
            encoded(missingField),
            encoded(futureSchema),
            encoded(wrongCaseDigest),
            encoded(invalidRetention),
            reordered,
            oversizedEnvelope,
        ]
        for malformed in malformedEnvelopes {
            let outcome = await enabled.capture(
                snapshot: snapshotA,
                profile: .prototype,
                mode: .assist,
                result: resultA,
                context: contextA,
                envelopeData: malformed,
                ledger: ledgerA
            )
            #expect(outcome.status == .refused)
            #expect(outcome.reason == .captureEnvelopeInvalid)
            #expect(outcome.captureEnvelopeDigest == nil)
        }

        raw["envelopeDigest"] = String(repeating: "0", count: 64)
        let digestSubstitution = await enabled.capture(
            snapshot: snapshotA,
            profile: .prototype,
            mode: .assist,
            result: resultA,
            context: contextA,
            envelopeData: try encoded(raw),
            ledger: ledgerA
        )
        #expect(digestSubstitution.status == .refused)
        #expect(digestSubstitution.reason == .captureEnvelopeDigestMismatch)

        guard let canonicalText = String(data: canonicalData, encoding: .utf8) else {
            Issue.record("The canonical envelope must be UTF-8.")
            return
        }
        let duplicateSchemaKey = Data(
            "{\"schemaVersion\":1,\(canonicalText.dropFirst())".utf8
        )
        let duplicateKey = await enabled.capture(
            snapshot: snapshotA,
            profile: .prototype,
            mode: .assist,
            result: resultA,
            context: contextA,
            envelopeData: duplicateSchemaKey,
            ledger: ledgerA
        )
        #expect(duplicateKey.status == .refused)
        #expect(duplicateKey.reason == .captureEnvelopeInvalid)

        let primaryEventCount = try await ledgerA.verifyIntegrity().eventCount
        let substitutedEventCount = try await ledgerB.verifyIntegrity().eventCount
        #expect(primaryEventCount == 1)
        #expect(substitutedEventCount == 0)

        let evidence = FI08TransientEnvelopeEvidenceV1(
            schemaVersion: 1,
            profile: "veritas-fi08-transient-core-admission-v1",
            status: "PASS_PRIVATE_FI08_TRANSIENT_CORE_ADMISSION_AND_UNSUPPORTED_REFUSAL_SLICE_ONLY",
            envelopeDigest: envelope.envelopeDigest,
            resultEvidenceDigest: envelope.resultEvidenceDigest,
            snapshotterAdmissionUsed: true,
            rawEnvelopeEntryPointReached: true,
            canonicalRoundTrip: true,
            positiveAppendCount: 1,
            finalPrimaryLedgerEventCount: Int(primaryEventCount),
            finalSubstitutedLedgerEventCount: Int(substitutedEventCount),
            bindingRefusalCount: bindingEnvelopes.count,
            scopeRefusalCount: scopeEnvelopes.count + 1,
            unsupportedCapabilityRefusalCount: unsupportedClaims.count + unsupportedStatuses.count,
            malformedEnvelopeRefusalCount: malformedEnvelopes.count,
            digestMismatchRefused: true,
            duplicateKeyRefused: true,
            mutatedBindings: [
                "ACCESS_POLICY",
                "ACTOR_AUTHORITY_STATUS",
                "FORK_RECONCILIATION_STATUS",
                "HIGH_WATERMARK_STATUS",
                "MODE",
                "OBSERVED_AT",
                "PROFILE_ID_AND_FINGERPRINT",
                "PROJECT",
                "PROTECTED_AUTHORITY_STATUS",
                "RESULT_AND_EVIDENCE_SET",
                "RETENTION_POLICY",
                "RETENTION_REVIEW_AT",
                "RUN",
                "SUBJECT_CONTENT_AND_ID",
                "SUBJECT_TYPE_AND_ID",
            ],
            actorAuthoritySupported: false,
            protectedAuthoritySupported: false,
            highWatermarkSupported: false,
            forkReconciliationSupported: false,
            durableRunProvenance: false,
            productIntegratedRawEnvelope: false,
            publicUnvalidatedLedgerWriteExposed: false,
            physicalDiskFullTested: false,
            authorizing: false,
            promptInfluence: false,
            repairInfluence: false,
            promotionInfluence: false,
            certificationInfluence: false,
            independentCertification: false,
            fi08Accepted: false,
            fi04Accepted: false
        )
        let evidenceEncoder = JSONEncoder()
        evidenceEncoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let evidenceData = try evidenceEncoder.encode(evidence)
        MachineEvidence.record("VERITAS_FI08_EVIDENCE_JSON \(String(decoding: evidenceData, as: UTF8.self))")
        try await ledgerA.close()
        try await ledgerB.close()
    }

    @Test("Over-limit direct snapshots are refused before incident storage")
    func overLimitSnapshotRefusal() async throws {
        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: adapterScope())
        let snapshot = adapterSnapshot(
            Data(repeating: 0x61, count: ArtifactSnapshotter.prototypeByteLimit + 1),
            displayName: "over-limit.txt"
        )
        let result = await adapterResult(snapshot: snapshot)
        let outcome = await enabled.capture(
            snapshot: snapshot,
            profile: .prototype,
            mode: .assist,
            result: result,
            context: adapterContext(run: "over-limit"),
            ledger: ledger
        )

        #expect(outcome.status == .refused)
        #expect(outcome.reason == .snapshotByteLimitExceeded)
        #expect(outcome.storedEvidenceSetDigest == nil)
        #expect(try await ledger.verifyIntegrity().eventCount == 0)
        try await ledger.close()
    }

    @Test("Unadmitted profile resources cannot reach incident storage")
    func unadmittedProfileStorageRefusal() async throws {
        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: adapterScope())
        let profile = CheckProfile(
            id: String(repeating: "p", count: CheckProfile.maximumIDBytes + 1)
        )
        let snapshot = try ArtifactSnapshotter().snapshot(
            displayName: "profile-limit.json",
            kind: .json,
            bytes: Data([0xff])
        )
        let result = await adapterResult(snapshot: snapshot, profile: profile)
        let outcome = await enabled.capture(
            snapshot: snapshot,
            profile: profile,
            mode: .assist,
            result: result,
            context: adapterContext(run: "profile-limit"),
            ledger: ledger
        )

        #expect(outcome.status == .refused)
        #expect(outcome.reason == .unsupportedCheck)
        #expect(outcome.storedEvidenceSetDigest == nil)
        #expect(try await ledger.verifyIntegrity().eventCount == 0)
        try await ledger.close()
    }

    private let enabled = PipelineIncidentAdapterV1(enabled: true)

    @Test("Invalid JSON appends exact closed codes without changing the result")
    func invalidJSONCapture() async throws {
        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: adapterScope())
        let snapshot = adapterSnapshot()
        let result = await adapterResult(snapshot: snapshot)
        let before = result
        let beforeDigest = result.resultEvidenceDigest

        let outcome = await enabled.capture(
            snapshot: snapshot,
            profile: .prototype,
            mode: .assist,
            result: result,
            context: adapterContext(),
            ledger: ledger
        )

        #expect(outcome.status == .appended)
        #expect(outcome.summary?.subjectContentDigest == snapshot.subjectDigest)
        #expect(outcome.summary?.failureCodes == [.deterministicCheckFailed, .schemaInvalid])
        #expect(outcome.summary?.symptomCodes == [.invalidStructure])
        #expect(outcome.summary?.evidenceSetDigest == outcome.storedEvidenceSetDigest)
        #expect(outcome.pipelineResultEvidenceDigest == beforeDigest)
        #expect(result == before)
        #expect(result.resultEvidenceDigest == beforeDigest)
        #expect(!outcome.authorizing)
        #expect(!outcome.promptInfluence)
        #expect(!outcome.repairInfluence)
        #expect(!outcome.promotionInfluence)
        #expect(!outcome.certificationInfluence)
        #expect(!outcome.occurrenceCountEvidence)
        #expect(try await ledger.verifyIntegrity().eventCount == 1)
        try await ledger.close()
    }

    @Test("Invalid UTF-8 captures FAIL while ignoring its dependent NOT_RUN")
    func invalidUTF8Capture() async throws {
        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: adapterScope())
        let snapshot = adapterSnapshot(Data([0xFF]), kind: .text, displayName: "binary.txt")
        let result = await adapterResult(snapshot: snapshot)

        let outcome = await enabled.capture(
            snapshot: snapshot,
            profile: .prototype,
            mode: .assist,
            result: result,
            context: adapterContext(run: "invalid-utf8"),
            ledger: ledger
        )

        #expect(result.deterministicChecks.map(\.status) == [.pass, .fail, .notRun])
        #expect(outcome.status == .appended)
        #expect(outcome.summary?.failureCodes == [.deterministicCheckFailed, .schemaInvalid])
        #expect(outcome.summary?.symptomCodes == [.invalidStructure])
        try await ledger.close()
    }

    @Test("Missing Markdown section maps only the frozen requirement codes")
    func missingSectionCapture() async throws {
        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: adapterScope())
        let profile = CheckProfile(id: "adapter-markdown", requiredSections: ["Testing"])
        let snapshot = adapterSnapshot(Data("# Overview\nNo test heading.".utf8), kind: .markdown)
        let result = await adapterResult(snapshot: snapshot, profile: profile)

        let outcome = await enabled.capture(
            snapshot: snapshot,
            profile: profile,
            mode: .assist,
            result: result,
            context: adapterContext(run: "missing-section"),
            ledger: ledger
        )

        #expect(outcome.status == .appended)
        #expect(outcome.summary?.failureCodes == [.deterministicCheckFailed, .requirementMissing])
        #expect(outcome.summary?.symptomCodes == [.missingSection])
        try await ledger.close()
    }

    @Test("Exact retry context is idempotent and appends once")
    func stableRetryIsIdempotent() async throws {
        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: adapterScope())
        let snapshot = adapterSnapshot()
        let result = await adapterResult(snapshot: snapshot)
        let context = adapterContext(run: "stable-retry")

        let first = await enabled.capture(
            snapshot: snapshot, profile: .prototype, mode: .assist,
            result: result, context: context, ledger: ledger
        )
        let second = await enabled.capture(
            snapshot: snapshot, profile: .prototype, mode: .assist,
            result: result, context: context, ledger: ledger
        )

        #expect(first.status == .appended)
        #expect(second.status == .idempotentDuplicate)
        #expect(first.summary == second.summary)
        #expect(try await ledger.verifyIntegrity().eventCount == 1)
        try await ledger.close()
    }

    @Test("Equivalent retry with a different clock preserves the first stored observation")
    func changedRetryClockCollapses() async throws {
        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: adapterScope())
        let snapshot = adapterSnapshot()
        let result = await adapterResult(snapshot: snapshot)
        let firstContext = adapterContext(run: "clock-bound-retry")
        let changedContext = adapterContext(
            run: "clock-bound-retry",
            observedAt: Date(timeIntervalSince1970: 1_800_000_001),
            retentionReviewAt: Date(timeIntervalSince1970: 1_801_209_601)
        )

        let first = await enabled.capture(
            snapshot: snapshot, profile: .prototype, mode: .assist,
            result: result, context: firstContext, ledger: ledger
        )
        let changed = await enabled.capture(
            snapshot: snapshot, profile: .prototype, mode: .assist,
            result: result, context: changedContext, ledger: ledger
        )

        #expect(first.status == .appended)
        #expect(changed.status == .idempotentDuplicate)
        #expect(changed.summary == first.summary)
        #expect(!changed.occurrenceCountEvidence)
        #expect(try await ledger.verifyIntegrity().eventCount == 1)
        try await ledger.close()
    }

    @Test("Disabled and unavailable capture preserve the exact result")
    func disabledAndUnavailable() async {
        let snapshot = adapterSnapshot()
        let result = await adapterResult(snapshot: snapshot)
        let before = result
        let beforeDigest = result.resultEvidenceDigest
        let disabled = await PipelineIncidentAdapterV1().capture(
            snapshot: snapshot, profile: .prototype, mode: .assist,
            result: result, context: adapterContext(), ledger: nil
        )
        let unavailable = await enabled.capture(
            snapshot: snapshot, profile: .prototype, mode: .assist,
            result: result, context: adapterContext(), ledger: nil
        )

        #expect(disabled.status == .skipped)
        #expect(disabled.reason == .disabled)
        #expect(unavailable.status == .unavailable)
        #expect(unavailable.reason == .ledgerUnavailable)
        #expect(unavailable.storedEvidenceSetDigest == nil)
        #expect(result == before)
        #expect(result.resultEvidenceDigest == beforeDigest)
    }

    @Test("Deterministic PASS is never captured")
    func passIsSkipped() async throws {
        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: adapterScope())
        let snapshot = adapterSnapshot(Data(#"{"ok":true}"#.utf8))
        let result = await adapterResult(snapshot: snapshot)

        let outcome = await enabled.capture(
            snapshot: snapshot, profile: .prototype, mode: .assist,
            result: result, context: adapterContext(run: "passing"), ledger: ledger
        )

        #expect(result.deterministicPassed)
        #expect(outcome.status == .skipped)
        #expect(outcome.reason == .deterministicPass)
        #expect(try await ledger.verifyIntegrity().eventCount == 0)
        try await ledger.close()
    }

    @Test("OFF pipeline output is refused and never captured")
    func offResultIsRefused() async throws {
        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: adapterScope())
        let snapshot = adapterSnapshot()
        let result = await VeritasPipeline(analyzer: DeterministicOnlyOrchestrator()).analyze(
            snapshot: snapshot,
            profile: .prototype,
            mode: .off
        )

        let outcome = await enabled.capture(
            snapshot: snapshot, profile: .prototype, mode: .off,
            result: result, context: adapterContext(run: "off-capture"), ledger: ledger
        )

        #expect(outcome.status == .refused)
        #expect(outcome.reason == .transcriptMismatch)
        #expect(outcome.storedEvidenceSetDigest == nil)
        #expect(try await ledger.verifyIntegrity().eventCount == 0)
        try await ledger.close()
    }

    @Test("Stale subject, kind, profile, and mode bindings append nothing")
    func staleBindingsAreSkipped() async throws {
        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: adapterScope())
        let snapshot = adapterSnapshot()
        let result = await adapterResult(snapshot: snapshot)
        let attempts = [
            await enabled.capture(
                snapshot: adapterSnapshot(Data("[".utf8)), profile: .prototype, mode: .assist,
                result: result, context: adapterContext(run: "stale-subject"), ledger: ledger
            ),
            await enabled.capture(
                snapshot: adapterSnapshot(snapshot.bytes, kind: .text), profile: .prototype, mode: .assist,
                result: result, context: adapterContext(run: "stale-kind"), ledger: ledger
            ),
            await enabled.capture(
                snapshot: snapshot, profile: CheckProfile(id: "changed-profile"), mode: .assist,
                result: result, context: adapterContext(run: "stale-profile"), ledger: ledger
            ),
            await enabled.capture(
                snapshot: snapshot, profile: .prototype, mode: .enforce,
                result: result, context: adapterContext(run: "stale-mode"), ledger: ledger
            ),
        ]

        #expect(attempts.allSatisfy { $0.reason == .bindingMismatch })
        #expect(try await ledger.verifyIntegrity().eventCount == 0)
        try await ledger.close()
    }

    @Test("Reordered or contradictory result fields are refused before storage")
    func malformedTranscriptIsSkipped() async throws {
        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: adapterScope())
        let snapshot = adapterSnapshot()
        let result = await adapterResult(snapshot: snapshot)
        let reordered = copiedResult(result, deterministicChecks: result.deterministicChecks.reversed())
        let contradictory = copiedResult(result, modelParticipation: .participated)
        let forgedPass = copiedResult(result, deterministicPassed: true)

        let reorderedOutcome = await enabled.capture(
            snapshot: snapshot, profile: .prototype, mode: .assist,
            result: reordered, context: adapterContext(run: "reordered"), ledger: ledger
        )
        let contradictoryOutcome = await enabled.capture(
            snapshot: snapshot, profile: .prototype, mode: .assist,
            result: contradictory, context: adapterContext(run: "contradictory"), ledger: ledger
        )
        let forgedPassOutcome = await enabled.capture(
            snapshot: snapshot, profile: .prototype, mode: .assist,
            result: forgedPass, context: adapterContext(run: "forged-pass"), ledger: ledger
        )

        #expect(reorderedOutcome.status == .refused)
        #expect(reorderedOutcome.reason == .transcriptMismatch)
        #expect(contradictoryOutcome.status == .refused)
        #expect(contradictoryOutcome.reason == .malformedResult)
        #expect(forgedPassOutcome.status == .refused)
        #expect(forgedPassOutcome.reason == .malformedResult)
        #expect(try await ledger.verifyIntegrity().eventCount == 0)
        try await ledger.close()
    }

    @Test("INCONCLUSIVE has a closed mapping while ERROR and unknown checks refuse")
    func closedMappingContract() throws {
        let inconclusive = try PipelineIncidentAdapterV1.map(checks: [
            CheckOutcome(
                id: "DET-001-NONEMPTY",
                status: .inconclusive,
                explanation: "This explanation is never parsed."
            ),
        ])
        #expect(inconclusive.failureCodes == [.deterministicCheckInconclusive])
        #expect(inconclusive.symptomCodes == [.inconclusiveResult])

        for checks in [
            [CheckOutcome(id: "DET-001-NONEMPTY", status: .error, explanation: "ignored")],
            [CheckOutcome(id: "DET-003-STRUCTURE", status: .fail, explanation: "ignored")],
            [CheckOutcome(id: "DET-999-UNKNOWN", status: .fail, explanation: "ignored")],
        ] {
            do {
                _ = try PipelineIncidentAdapterV1.map(checks: checks)
                Issue.record("Unsupported check mapping must throw.")
            } catch {
                #expect(error as? PipelineIncidentCaptureReasonV1 == .unsupportedCheck)
            }
        }
    }

    @Test("Invalid retry identity or retention time is refused before storage")
    func invalidContextIsSkipped() async throws {
        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: adapterScope())
        let snapshot = adapterSnapshot()
        let result = await adapterResult(snapshot: snapshot)
        let invalidDigest = PipelineIncidentCaptureContextV1(
            runObservationDigest: "not-a-digest",
            observedAt: Date(timeIntervalSince1970: 1_800_000_000),
            retentionReviewAt: nil
        )
        let invalidRetention = PipelineIncidentCaptureContextV1(
            runObservationDigest: adapterDigest("invalid-retention"),
            observedAt: Date(timeIntervalSince1970: 1_800_000_000),
            retentionReviewAt: Date(timeIntervalSince1970: 1_799_999_999)
        )
        let arabicIndicDigest = PipelineIncidentCaptureContextV1(
            runObservationDigest: String(repeating: "١", count: 64),
            observedAt: Date(timeIntervalSince1970: 1_800_000_000),
            retentionReviewAt: nil
        )
        let fullWidthDigest = PipelineIncidentCaptureContextV1(
            runObservationDigest: String(repeating: "１", count: 64),
            observedAt: Date(timeIntervalSince1970: 1_800_000_000),
            retentionReviewAt: nil
        )

        for context in [invalidDigest, invalidRetention, arabicIndicDigest, fullWidthDigest] {
            let outcome = await enabled.capture(
                snapshot: snapshot, profile: .prototype, mode: .assist,
                result: result, context: context, ledger: ledger
            )
            #expect(outcome.status == .refused)
            #expect(outcome.reason == .contextInvalid)
        }
        #expect(try await ledger.verifyIntegrity().eventCount == 0)
        try await ledger.close()
    }

    @Test("Closed ledger reports unavailability without changing result evidence")
    func closedLedgerIsIsolated() async throws {
        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = adapterScope()
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        try await ledger.close()
        let snapshot = adapterSnapshot()
        let result = await adapterResult(snapshot: snapshot)
        let before = result.resultEvidenceDigest

        let outcome = await enabled.capture(
            snapshot: snapshot, profile: .prototype, mode: .assist,
            result: result, context: adapterContext(run: "closed-ledger"), ledger: ledger
        )

        #expect(outcome.status == .unavailable)
        #expect(outcome.reason == .ledgerClosed)
        #expect(outcome.storedEvidenceSetDigest == nil)
        #expect(result.resultEvidenceDigest == before)
        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity().eventCount == 0)
        try await reopened.close()
    }

    @Test("Integrity, SQLite, and rollback failures never claim evidence was stored")
    func writeFailuresNeverClaimStorage() async throws {
        func runInjectedFailure(
            name: String,
            expectedStatus: PipelineIncidentCaptureStatusV1,
            expectedReason: PipelineIncidentCaptureReasonV1,
            injector: @escaping @Sendable (IncidentLedgerFaultPointV1) throws -> Void
        ) async throws {
            let root = try makeAdapterRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let scope = adapterScope("write-failure-\(name)")
            let ledger = try await LocalIncidentLedgerV1.openForTesting(
                rootDirectory: root,
                scope: scope,
                faultInjector: injector
            )
            let snapshot = adapterSnapshot()
            let result = await adapterResult(snapshot: snapshot)
            let outcome = await enabled.capture(
                snapshot: snapshot, profile: .prototype, mode: .assist,
                result: result, context: adapterContext(run: name), ledger: ledger
            )

            #expect(outcome.status == expectedStatus)
            #expect(outcome.reason == expectedReason)
            #expect(outcome.storedEvidenceSetDigest == nil)
            try? await ledger.close()

            let reopened = try await LocalIncidentLedgerV1.open(
                rootDirectory: root,
                scope: scope
            )
            #expect(try await reopened.verifyIntegrity().eventCount == 0)
            try await reopened.close()
        }

        try await runInjectedFailure(
            name: "integrity",
            expectedStatus: .refused,
            expectedReason: .ledgerIntegrityRefused
        ) { point in
            guard point == .afterEventInsertBeforeMetadataUpdate else { return }
            throw IncidentLedgerErrorV1.integrity("INJECTED_CORRUPT_WRITE")
        }
        try await runInjectedFailure(
            name: "sqlite",
            expectedStatus: .unavailable,
            expectedReason: .ledgerWriteFailed
        ) { point in
            guard point == .afterEventInsertBeforeMetadataUpdate else { return }
            throw IncidentLedgerErrorV1.sqlite(code: 10, message: "RAW-SQLITE-CANARY")
        }
        try await runInjectedFailure(
            name: "rollback",
            expectedStatus: .refused,
            expectedReason: .ledgerIntegrityRefused
        ) { point in
            switch point {
            case .afterEventInsertBeforeMetadataUpdate:
                throw IncidentLedgerErrorV1.integrity("INJECTED_PRIMARY_FAILURE")
            case .afterTombstoneInsertBeforeMetadataUpdate:
                break
            case .beforeTombstoneCommit:
                break
            case .beforeRollback:
                throw IncidentLedgerErrorV1.integrity("INJECTED_ROLLBACK_FAILURE")
            case .duringFirstOpenAfterSchemaInitialization:
                return
            }
        }
    }

    @Test("Queued cancellation, disable, and currentness invalidation append nothing")
    func queuedRevocationIsAtomic() async throws {
        enum Revocation: Equatable {
            case cancel
            case disable
            case invalidate
        }

        for revocation in [Revocation.cancel, .disable, .invalidate] {
            let root = try makeAdapterRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let gate = AdapterBlockingFaultGate()
            let scope = adapterScope("queued-\(String(describing: revocation))")
            let ledger = try await LocalIncidentLedgerV1.openForTesting(
                rootDirectory: root,
                scope: scope,
                faultInjector: gate.inject
            )
            var enteredEvents = gate.entered.makeAsyncIterator()
            let blocker = Task {
                try await ledger.record(blockerObservation())
            }
            let entered: Void? = await enteredEvents.next()
            #expect(entered != nil)

            let control = PipelineIncidentCaptureControlV1(enabled: true)
            let adapter = PipelineIncidentAdapterV1(control: control)
            let snapshot = adapterSnapshot()
            let result = await adapterResult(snapshot: snapshot)
            let admissions = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
            control.setAdmissionObserverForTesting { admissions.continuation.yield(()) }
            defer {
                control.setAdmissionObserverForTesting(nil)
                admissions.continuation.finish()
            }
            var issued = admissions.stream.makeAsyncIterator()
            let capture = Task {
                await adapter.capture(
                    snapshot: snapshot, profile: .prototype, mode: .assist,
                    result: result,
                    context: adapterContext(run: "queued-\(String(describing: revocation))"),
                    ledger: ledger
                )
            }

            let didIssue: Void? = await issued.next()
            #expect(didIssue != nil)
            control.setAdmissionObserverForTesting(nil)
            #expect(control.issuedAdmissionCountForTesting() == 1)
            switch revocation {
            case .cancel:
                capture.cancel()
            case .disable:
                control.setEnabled(false)
            case .invalidate:
                control.invalidatePendingCaptures()
            }
            gate.release.signal()
            do {
                _ = try await blocker.value
                Issue.record("The blocking write must roll back.")
            } catch {
                #expect(error as? IncidentLedgerErrorV1 == .integrity("INJECTED_QUEUE_BLOCK"))
            }

            let outcome = await capture.value
            #expect(outcome.status == .skipped)
            #expect(outcome.reason == (revocation == .cancel ? .cancelled : .admissionRevoked))
            #expect(outcome.storedEvidenceSetDigest == nil)
            #expect(try await ledger.verifyIntegrity().eventCount == 0)
            try await ledger.close()
        }
    }

    @Test("Cancellation and currentness invalidation roll back the adapter transaction")
    func transactionRevocationIsAtomic() async throws {
        enum Revocation: Equatable {
            case cancel
            case invalidate
        }

        for revocation in [Revocation.cancel, .invalidate] {
            let root = try makeAdapterRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let gate = AdapterTransactionFaultGate()
            let ledger = try await LocalIncidentLedgerV1.openForTesting(
                rootDirectory: root,
                scope: adapterScope("transaction-\(String(describing: revocation))"),
                faultInjector: gate.inject
            )
            var enteredEvents = gate.entered.makeAsyncIterator()
            let control = PipelineIncidentCaptureControlV1(enabled: true)
            let adapter = PipelineIncidentAdapterV1(control: control)
            let snapshot = adapterSnapshot()
            let result = await adapterResult(snapshot: snapshot)
            let capture = Task {
                await adapter.capture(
                    snapshot: snapshot, profile: .prototype, mode: .assist,
                    result: result,
                    context: adapterContext(run: "transaction-\(String(describing: revocation))"),
                    ledger: ledger
                )
            }

            let entered: Void? = await enteredEvents.next()
            #expect(entered != nil)
            switch revocation {
            case .cancel:
                capture.cancel()
            case .invalidate:
                control.invalidatePendingCaptures()
            }
            gate.release.signal()

            let outcome = await capture.value
            #expect(outcome.status == .skipped)
            #expect(outcome.reason == (revocation == .cancel ? .cancelled : .admissionRevoked))
            #expect(outcome.storedEvidenceSetDigest == nil)
            #expect(try await ledger.verifyIntegrity().eventCount == 0)
            try await ledger.close()
        }
    }

    @Test("Same exact failed result with different caller run IDs is replay-collapsed")
    func callerRunIDCannotInflateOccurrences() async throws {
        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: adapterScope())
        let snapshot = adapterSnapshot()
        let result = await adapterResult(snapshot: snapshot)
        let first = await enabled.capture(
            snapshot: snapshot, profile: .prototype, mode: .assist,
            result: result, context: adapterContext(run: "replay-a"), ledger: ledger
        )
        let replay = await enabled.capture(
            snapshot: snapshot, profile: .prototype, mode: .assist,
            result: result,
            context: adapterContext(
                run: "replay-b",
                observedAt: Date(timeIntervalSince1970: 1_800_000_100),
                retentionReviewAt: Date(timeIntervalSince1970: 1_801_209_700)
            ),
            ledger: ledger
        )

        #expect(first.status == .appended)
        #expect(replay.status == .idempotentDuplicate)
        #expect(first.summary == replay.summary)
        #expect(!first.occurrenceCountEvidence)
        #expect(!replay.occurrenceCountEvidence)
        #expect(try await ledger.verifyIntegrity().eventCount == 1)
        try await ledger.close()
    }

    @Test("Raw artifact, display name, explanation, prompt, and credential canaries never persist")
    func privacyCanaries() async throws {
        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: adapterScope())
        let contentCanary = "RAW-ADAPTER-CONTENT-CANARY-726F"
        let nameCanary = "private-user-path-canary.json"
        let snapshot = adapterSnapshot(
            Data("{\(contentCanary)".utf8),
            displayName: nameCanary
        )
        let result = await adapterResult(snapshot: snapshot)
        _ = await enabled.capture(
            snapshot: snapshot, profile: .prototype, mode: .assist,
            result: result, context: adapterContext(run: "privacy-canary"), ledger: ledger
        )
        let projectDirectory = ledger.databaseURL.deletingLastPathComponent()
        try await ledger.close()

        let files = try FileManager.default.contentsOfDirectory(
            at: projectDirectory,
            includingPropertiesForKeys: [.isRegularFileKey]
        )
        let storedBytes = try files.reduce(into: Data()) { combined, url in
            if try url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true {
                combined.append(try Data(contentsOf: url))
            }
        }
        for canary in [
            contentCanary,
            nameCanary,
            "The snapshot is not valid JSON.",
            "SYSTEM PROMPT CANARY",
            "sk-proj-credential-canary",
        ] {
            #expect(storedBytes.range(of: Data(canary.utf8)) == nil)
        }
    }

    @Test("Project scope domain-separates incident and evidence identities")
    func projectScopeSeparation() async throws {
        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let firstLedger = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: adapterScope("project-a")
        )
        let secondLedger = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: adapterScope("project-b")
        )
        let snapshot = adapterSnapshot()
        let result = await adapterResult(snapshot: snapshot)
        let context = adapterContext(run: "same-run-cross-project")

        let first = await enabled.capture(
            snapshot: snapshot, profile: .prototype, mode: .assist,
            result: result, context: context, ledger: firstLedger
        )
        let second = await enabled.capture(
            snapshot: snapshot, profile: .prototype, mode: .assist,
            result: result, context: context, ledger: secondLedger
        )

        #expect(first.status == .appended)
        #expect(second.status == .appended)
        #expect(first.summary?.incidentID != second.summary?.incidentID)
        #expect(first.storedEvidenceSetDigest != second.storedEvidenceSetDigest)
        try await firstLedger.close()
        try await secondLedger.close()
    }

    @Test("Concurrent exact retries serialize to one append")
    func concurrentExactRetries() async throws {
        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: adapterScope())
        let snapshot = adapterSnapshot()
        let result = await adapterResult(snapshot: snapshot)
        let context = adapterContext(run: "concurrent-retry")

        let statuses = await withTaskGroup(
            of: PipelineIncidentCaptureStatusV1.self,
            returning: [PipelineIncidentCaptureStatusV1].self
        ) { group in
            for _ in 0..<10 {
                group.addTask {
                    await enabled.capture(
                        snapshot: snapshot, profile: .prototype, mode: .assist,
                        result: result, context: context, ledger: ledger
                    ).status
                }
            }
            var values: [PipelineIncidentCaptureStatusV1] = []
            for await status in group { values.append(status) }
            return values
        }

        #expect(statuses.filter { $0 == .appended }.count == 1)
        #expect(statuses.filter { $0 == .idempotentDuplicate }.count == 9)
        #expect(try await ledger.verifyIntegrity().eventCount == 1)
        try await ledger.close()
    }

    @Test("Incident capture cannot change an independently accepted version")
    func acceptanceRemainsIndependent() async throws {
        let acceptedSnapshot = adapterSnapshot(Data(#"{"accepted":true}"#.utf8))
        let acceptedResult = await adapterResult(snapshot: acceptedSnapshot)
        let acceptance = PrototypeAcceptanceLedger()
        _ = try await acceptance.accept(
            snapshot: acceptedSnapshot,
            profile: .prototype,
            mode: .assist,
            mutationSequence: 1,
            result: acceptedResult
        )

        let root = try makeAdapterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: adapterScope())
        let failingSnapshot = adapterSnapshot()
        let failingResult = await adapterResult(snapshot: failingSnapshot)
        _ = await enabled.capture(
            snapshot: failingSnapshot, profile: .prototype, mode: .assist,
            result: failingResult, context: adapterContext(run: "acceptance-isolation"), ledger: ledger
        )

        #expect(await acceptance.currentness(
            snapshot: acceptedSnapshot,
            profile: .prototype,
            mode: .assist,
            result: acceptedResult
        ) == .current)
        try await ledger.close()
    }
}
