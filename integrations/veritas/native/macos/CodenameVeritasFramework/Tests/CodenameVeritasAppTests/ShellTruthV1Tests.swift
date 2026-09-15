import Foundation
import Testing
@testable import CodenameVeritasApp
@testable import VeritasCore

// E13 one-switch comprehension: the shell's truth is a pure function of a
// value snapshot. These tests pin what a participant can read for every state
// and refusal class, and that no infrastructure refusal is ever presented as
// an artifact verdict.

private let subject = "1a41e406287e2dd2f4696878d59964eca256ced61e00a467e60d1d018c5ff969"
private let prefix12 = String(subject.prefix(12))

private func result(
    passed: Bool,
    disposition: PipelineDisposition = .ready,
    participation: ModelParticipation = .notRun,
    canAccept: Bool = true,
    limitations: [String] = [],
    checks: [CheckOutcome]? = nil,
    coverage: AdvisoryCoverage? = nil,
    mode: VeritasMode = .assist
) -> PipelineResult {
    PipelineResult(
        subjectDigest: subject,
        artifactKind: .text,
        profileID: "prototype",
        profileFingerprint: "fp",
        mode: mode,
        disposition: disposition,
        deterministicChecks: checks ?? [
            CheckOutcome(id: "utf8", status: .pass, explanation: "UTF-8 decodes."),
            CheckOutcome(
                id: "size",
                status: passed ? .pass : .fail,
                explanation: passed ? "Within limit." : "Exceeds the profile limit."
            ),
        ],
        deterministicPassed: passed,
        modelParticipation: participation,
        analyzerProbe: nil,
        advisoryCoverage: coverage,
        advisoryPlan: [],
        findings: [],
        canAcceptInsideVeritas: canAccept,
        limitationCodes: limitations
    )
}

/// The exact shape VeritasPipeline.analyze returns for ENFORCE: no checks ran.
private func enforceResult() -> PipelineResult {
    result(
        passed: false, disposition: .blocked, participation: .notRun, canAccept: false,
        limitations: ["ENFORCE_ROUTE_NOT_IMPLEMENTED", "NO_EXTERNAL_ACTION_WITHHELD"],
        checks: [], mode: .enforce
    )
}

@Suite("E13 shell truth")
struct ShellTruthV1Tests {
    @Test("OFF at rest agrees, routes nothing, refuses nothing, and names the profile")
    func offAtRest() {
        let truth = ShellTruthV1(input: ShellTruthInputV1())
        #expect(truth.mode.agreement == .agrees)
        #expect(truth.mode.profileID == CheckProfile.prototype.id)
        #expect(truth.mode.label == "Requested OFF · profile \(CheckProfile.prototype.id) · effective OFF")
        #expect(truth.routing == .noRouteRequested)
        #expect(truth.decision == .none)
        #expect(truth.acceptance == .notAccepted)
        #expect(truth.refusals.isEmpty)
        #expect(truth.coverage.subject == "no artifact selected")
        let summary = truth.accessibilitySummary
        #expect(summary.contains("No refusal."))
        #expect(summary.contains("Coverage: \(ShellTruthV1.projectCoverage); \(ShellTruthV1.clientCoverage); no artifact selected; \(ShellTruthV1.outsideCoverage)."))
        #expect(summary.contains(ShellTruthV1.scopeStatement))
        #expect(summary.hasSuffix(ShellTruthV1.indicatorStatement))
    }

    @Test("ASSIST without an artifact is an INPUT refusal, not readiness and not an artifact verdict")
    func assistWithoutArtifact() {
        var input = ShellTruthInputV1()
        input.desiredMode = .assist
        input.effectiveState = .blocked
        input.lastError = "Select an artifact before requesting a route. No readiness has been established."
        let truth = ShellTruthV1(input: input)

        guard case .divergent(let text) = truth.mode.agreement else {
            Issue.record("expected divergent agreement"); return
        }
        #expect(text.contains("no artifact selected"))
        #expect(truth.routing == .noRouteRequested)
        #expect(truth.refusals.count == 1)
        #expect(truth.refusals[0].refusalClass == .input)
        #expect(truth.refusals[0].exactReason == input.lastError)
        #expect(truth.refusals[0].artifactVerdictUnaffected)
        #expect(truth.refusals[0].currency == .current)
        #expect(truth.refusals[0].nextSafeAction.contains("Choose one regular"))
    }

    @Test("A denied platform is a PLATFORM refusal carrying the exact limitation codes")
    func deniedPlatform() {
        let denied = PlatformRequirements.evaluate(
            PlatformFacts(operatingSystem: .macOS, macOSMajor: 26, architecture: .x86_64)
        )
        var input = ShellTruthInputV1()
        input.desiredMode = .assist
        input.effectiveState = .blocked
        input.selectedDisplayName = "notes.md"
        input.selectedSubjectDigest = subject
        input.lastError = denied.userMessage
        let truth = ShellTruthV1(input: input)

        #expect(truth.refusals.count == 1)
        #expect(truth.refusals[0].refusalClass == .platform)
        #expect(truth.refusals[0].exactReason.contains("PLATFORM_MACOS_27_REQUIRED"))
        #expect(truth.refusals[0].exactReason.contains("PLATFORM_APPLE_SILICON_ARM64_REQUIRED"))
        #expect(truth.refusals[0].artifactVerdictUnaffected)
        #expect(truth.coverage.subject.contains("notes.md"))
        #expect(truth.coverage.subject.contains(String(subject.prefix(16))))
    }

    @Test("Every snapshot refusal reason classifies as INPUT")
    func snapshotErrorsAreInput() {
        let errors: [SnapshotError] = [
            .notRegularFile, .empty, .exceedsByteLimit(actual: 9_000, limit: 4_096),
            .invalidByteLimit, .readExceededByteLimit(limit: 4_096), .changedDuringRead, .unreadable,
        ]
        for error in errors {
            var input = ShellTruthInputV1()
            input.desiredMode = .assist
            input.effectiveState = .blocked
            input.lastError = error.errorDescription
            let truth = ShellTruthV1(input: input)
            #expect(truth.refusals.map(\.refusalClass) == [.input], "\(error)")
            #expect(truth.refusals.first?.exactReason == error.errorDescription)
        }
    }

    @Test("Every private-export refusal classifies as EXPORT, preserves the verdict, and is marked as a message")
    func exportErrorsAreExport() {
        let errors: [PrivateVerifiedWriteErrorV1] = [
            .invalidDestination, .destinationExists, .byteLimitExceeded, .sourceDigestMismatch,
            .temporaryCreateFailed, .writeFailed, .syncFailed, .identityMismatch,
            .publishFailed, .readbackMismatch, .cleanupRefused, .admissionRevoked,
        ]
        for error in errors {
            var input = ShellTruthInputV1()
            input.desiredMode = .assist
            input.effectiveState = .assistReady
            input.selectedSubjectDigest = subject
            input.result = result(passed: true)
            input.currentness = .current
            input.lastError = error.errorDescription
            let truth = ShellTruthV1(input: input)
            #expect(truth.refusals.map(\.refusalClass) == [.export], "\(error)")
            #expect(truth.refusals.first?.currency == .mostRecentMessage)
            #expect(truth.refusals.first?.preservedResult.contains("DETERMINISTIC PASS") == true)
            #expect(truth.refusals.first?.preservedResult.contains("ACCEPTED") == true)
            #expect(truth.acceptance == .current(subjectPrefix: prefix12))
        }
    }

    @Test("Export next actions distinguish revoked admission, byte limit, digest drift, and destination problems")
    func exportNextActionsArePerCase() {
        func next(_ error: PrivateVerifiedWriteErrorV1) -> String {
            var input = ShellTruthInputV1()
            input.lastError = error.errorDescription
            return ShellTruthV1(input: input).refusals.first?.nextSafeAction ?? ""
        }
        #expect(next(.admissionRevoked).contains("re-establish acceptance"))
        #expect(next(.admissionRevoked).contains("redacted incident report, prepare it again"))
        #expect(next(.byteLimitExceeded).contains("cannot succeed"))
        #expect(next(.sourceDigestMismatch).contains("Analyze and accept again"))
        #expect(next(.destinationExists).contains("new file name"))
        #expect(next(.readbackMismatch).contains("no existing file was replaced"))
        #expect(!next(.admissionRevoked).contains("new destination"))
        #expect(!next(.byteLimitExceeded).contains("export again"))
    }

    @Test("Acceptance-ledger refusals are ACCEPTANCE, verbatim, with the acceptance retry path")
    func acceptanceRefusalIsAcceptance() {
        for code in ["ACCEPT_MUTATION_SEQUENCE_STALE", "ACCEPT_EVIDENCE_DIGEST_UNAVAILABLE", "RESULT_NOT_ACCEPTABLE"] {
            let message = AdvisoryOrchestrationError.invalidFinding(code).localizedDescription
            var input = ShellTruthInputV1()
            input.desiredMode = .assist
            input.effectiveState = .assistReady
            input.result = result(passed: true)
            input.lastError = message
            let truth = ShellTruthV1(input: input)
            #expect(truth.refusals.map(\.refusalClass) == [.acceptance], "\(code)")
            #expect(truth.refusals.first?.exactReason == message)
            #expect(truth.refusals.first?.preservedResult.contains("Nothing was accepted or changed") == true)
            #expect(truth.refusals.first?.nextSafeAction.contains("then Accept") == true)
            #expect(truth.refusals.first?.currency == .mostRecentMessage)
        }
    }

    @Test("A deterministic FAIL is the only ARTIFACT refusal and names the failed checks")
    func deterministicFailIsArtifact() {
        var input = ShellTruthInputV1()
        input.desiredMode = .assist
        input.effectiveState = .blocked
        input.selectedSubjectDigest = subject
        input.result = result(passed: false, disposition: .blocked, canAccept: false)
        let truth = ShellTruthV1(input: input)

        #expect(truth.decision == .checksFailed(failed: 1, total: 2, subjectPrefix: prefix12))
        #expect(truth.routing == .deterministicOnly)
        #expect(truth.refusals.count == 1)
        #expect(truth.refusals[0].refusalClass == .artifact)
        #expect(!truth.refusals[0].artifactVerdictUnaffected)
        #expect(truth.refusals[0].exactReason == "size FAIL: Exceeds the profile limit.")
        #expect(truth.refusals[0].nextSafeAction.contains("Acceptance is not available"))
    }

    @Test("ENFORCE with an artifact is a ROUTE refusal: no checks ran, nothing was judged")
    func enforceIsRouteNotArtifact() {
        var input = ShellTruthInputV1()
        input.desiredMode = .enforce
        input.effectiveState = .blocked
        input.selectedSubjectDigest = subject
        input.result = enforceResult()
        let truth = ShellTruthV1(input: input)

        #expect(truth.routing == .routeUnavailable)
        #expect(truth.decision == .noChecksRan(subjectPrefix: prefix12))
        #expect(truth.refusals.map(\.refusalClass) == [.route])
        #expect(truth.refusals[0].artifactVerdictUnaffected)
        #expect(truth.refusals[0].exactReason == "ENFORCE_ROUTE_NOT_IMPLEMENTED, NO_EXTERNAL_ACTION_WITHHELD")
        #expect(truth.refusals[0].preservedResult.contains("Nothing ran and nothing was judged for ENFORCE"))
        #expect(truth.refusals[0].nextSafeAction.contains("Request ASSIST"))
        #expect(!truth.accessibilitySummary.contains("DETERMINISTIC FAIL"))
        #expect(!truth.accessibilitySummary.contains("Fix the artifact"))
        guard case .divergent(let text) = truth.mode.agreement else {
            Issue.record("expected divergent agreement"); return
        }
        #expect(text.contains("route is blocked"))
    }

    @Test("A degraded route with an unavailable model is an ADVISORY refusal that leaves the PASS verdict standing")
    func degradedUnavailableIsAdvisory() {
        var input = ShellTruthInputV1()
        input.desiredMode = .assist
        input.effectiveState = .degraded
        input.selectedSubjectDigest = subject
        input.result = result(
            passed: true, disposition: .degraded, participation: .unavailable,
            canAccept: true, limitations: ["ADVISORY_UNAVAILABLE"]
        )
        let truth = ShellTruthV1(input: input)

        #expect(truth.routing == .modelUnavailable)
        #expect(truth.decision == .checksPassed(passed: 2, total: 2, subjectPrefix: prefix12))
        #expect(truth.refusals.count == 1)
        #expect(truth.refusals[0].refusalClass == .advisory)
        #expect(truth.refusals[0].artifactVerdictUnaffected)
        #expect(truth.refusals[0].exactReason == "MODEL_UNAVAILABLE [ADVISORY_UNAVAILABLE]")
        #expect(truth.refusals[0].nextSafeAction.contains("acceptance remains available"))
        guard case .divergent(let text) = truth.mode.agreement else {
            Issue.record("expected divergent agreement"); return
        }
        #expect(text.contains("the advisory model was unavailable"))
    }

    @Test("A degraded route after partial-coverage participation says so, and never says the model did not participate")
    func degradedPartialCoverageIsTruthful() {
        var input = ShellTruthInputV1()
        input.desiredMode = .assist
        input.effectiveState = .degraded
        input.selectedSubjectDigest = subject
        input.result = result(
            passed: true, disposition: .degraded, participation: .participated, canAccept: true,
            limitations: ["PARTIAL_ADVISORY_COVERAGE", "OPTIONAL_MODEL_COVERAGE_INCOMPLETE"],
            coverage: AdvisoryCoverage(artifactCharacters: 12_000, analyzedCharacters: 8_000)
        )
        let truth = ShellTruthV1(input: input)

        #expect(truth.routing == .modelParticipatedPartial)
        #expect(truth.refusals.map(\.refusalClass) == [.advisory])
        #expect(truth.refusals[0].exactReason == "ADVISORY_COVERAGE_PARTIAL 8000/12000 characters [PARTIAL_ADVISORY_COVERAGE, OPTIONAL_MODEL_COVERAGE_INCOMPLETE]")
        #expect(truth.refusals[0].nextSafeAction.contains("acceptance remains available"))
        guard case .divergent(let text) = truth.mode.agreement else {
            Issue.record("expected divergent agreement"); return
        }
        #expect(text.contains("analyzed only 8000 of 12000 characters"))
        #expect(!truth.accessibilitySummary.contains("did not participate"))
        #expect(!truth.accessibilitySummary.contains("MODEL_PARTICIPATED"))
    }

    @Test("BLOCKED with PASS under a model-required profile carries an ADVISORY refusal, never zero refusals")
    func blockedRequiredCoverageHasRefusal() {
        var input = ShellTruthInputV1()
        input.desiredMode = .assist
        input.effectiveState = .blocked
        input.selectedSubjectDigest = subject
        input.result = result(
            passed: true, disposition: .blocked, participation: .participated, canAccept: false,
            limitations: ["REQUIRED_MODEL_COVERAGE_INCOMPLETE"],
            coverage: AdvisoryCoverage(artifactCharacters: 20_000, analyzedCharacters: 8_000)
        )
        let truth = ShellTruthV1(input: input)

        #expect(truth.decision == .checksPassed(passed: 2, total: 2, subjectPrefix: prefix12))
        #expect(truth.refusals.map(\.refusalClass) == [.advisory])
        #expect(truth.refusals[0].exactReason == "REQUIRED_MODEL_COVERAGE_INCOMPLETE (8000/20000 characters)")
        #expect(truth.refusals[0].nextSafeAction.contains("acceptance is not available"))
        #expect(truth.refusals[0].artifactVerdictUnaffected)
        #expect(!truth.accessibilitySummary.contains("No refusal."))
    }

    @Test("History outages are HISTORY refusals that cannot alter the displayed verdict")
    func historyOutageIsHistory() {
        var input = ShellTruthInputV1()
        input.desiredMode = .assist
        input.effectiveState = .assistReady
        input.selectedSubjectDigest = subject
        input.result = result(passed: true)
        input.incidentHistoryAvailability = .unavailable
        input.incidentHistoryReason = .integrityRefused
        let truth = ShellTruthV1(input: input)

        #expect(truth.mode.agreement == .agrees)
        #expect(truth.decision == .checksPassed(passed: 2, total: 2, subjectPrefix: prefix12))
        #expect(truth.refusals.map(\.refusalClass) == [.history])
        #expect(truth.refusals[0].exactReason == "INCIDENT_HISTORY_INTEGRITY_REFUSED")
        #expect(truth.refusals[0].artifactVerdictUnaffected)
        #expect(truth.refusals[0].preservedResult.contains("history cannot alter results"))
        #expect(truth.refusals[0].nextSafeAction.contains("Turn history off"))
    }

    @Test("The availability mirror of a refused or unavailable capture is shown with a mirror note, never hidden and never presented as a separate fact")
    func captureMirrorIsAnnotatedNotHidden() {
        let cases: [(PipelineIncidentCaptureStatusV1, PipelineIncidentCaptureReasonV1, IncidentHistoryAvailabilityV1, IncidentHistoryCoordinatorReasonV1)] = [
            (.refused, .transcriptMismatch, .refused, .configurationInvalid),
            (.refused, .ledgerCapacityExceeded, .refused, .configurationInvalid),
            (.refused, .ledgerIntegrityRefused, .refused, .integrityRefused),
            (.unavailable, .ledgerUnavailable, .unavailable, .storageUnavailable),
        ]
        for (status, reason, availability, mirrorReason) in cases {
            var input = ShellTruthInputV1()
            input.desiredMode = .assist
            input.effectiveState = .assistReady
            input.result = result(passed: false, disposition: .blocked, canAccept: false)
            input.incidentCaptureStatus = status
            input.incidentCaptureReason = reason
            input.incidentHistoryAvailability = availability
            input.incidentHistoryReason = mirrorReason
            let history = ShellTruthV1(input: input).refusals.filter { $0.refusalClass == .history }
            #expect(history.count == 2, "\(reason)")
            #expect(history.first?.exactReason == reason.rawValue)
            #expect(history.first?.currency == .current)
            #expect(history.last?.exactReason == mirrorReason.rawValue)
            #expect(history.last?.currency == .mayMirrorCapture, "\(reason)")
            #expect(history.last?.nextSafeAction.contains("storage was not opened") == false || mirrorReason == .configurationInvalid)
        }
        // A fresh outage that is NOT the mirror of the shown capture stays a plain, current refusal.
        var fresh = ShellTruthInputV1()
        fresh.incidentCaptureStatus = .refused
        fresh.incidentCaptureReason = .transcriptMismatch
        fresh.incidentHistoryAvailability = .unavailable
        fresh.incidentHistoryReason = .storageUnavailable
        let refusals = ShellTruthV1(input: fresh).refusals
        #expect(refusals.map(\.exactReason) == ["DETERMINISTIC_TRANSCRIPT_MISMATCH", "INCIDENT_HISTORY_STORAGE_UNAVAILABLE"])
        #expect(refusals.last?.currency == .current)
        // A genuine configuration problem with no capture is a plain refusal whose text covers both readings.
        var configuration = ShellTruthInputV1()
        configuration.incidentHistoryAvailability = .refused
        configuration.incidentHistoryReason = .configurationInvalid
        let only = ShellTruthV1(input: configuration).refusals
        #expect(only.map(\.exactReason) == ["INCIDENT_HISTORY_CONFIGURATION_INVALID"])
        #expect(only.first?.currency == .current)
        #expect(only.first?.nextSafeAction.contains("otherwise the history configuration was rejected") == true)
    }

    @Test("A blocked required-model route after a failed or unavailable model names the model, not partial coverage")
    func blockedFailedModelIsNotPartialCoverage() {
        for participation in [ModelParticipation.failed, .unavailable] {
            var input = ShellTruthInputV1()
            input.desiredMode = .assist
            input.effectiveState = .blocked
            input.selectedSubjectDigest = subject
            input.result = result(
                passed: true, disposition: .blocked, participation: participation, canAccept: false,
                limitations: ["ANALYZER_TIMEOUT", "REQUIRED_MODEL_EVIDENCE_MISSING", "DETERMINISTIC_RESULT_PRESERVED"],
                coverage: AdvisoryCoverage(artifactCharacters: 12_000, analyzedCharacters: 8_000)
            )
            let truth = ShellTruthV1(input: input)
            #expect(truth.refusals.map(\.refusalClass) == [.advisory], "\(participation)")
            #expect(truth.refusals[0].exactReason.hasPrefix("MODEL_\(participation.rawValue)"))
            #expect(!truth.refusals[0].exactReason.contains("characters"))
            #expect(!truth.refusals[0].nextSafeAction.contains("analyzed only part"))
            #expect(truth.refusals[0].nextSafeAction.contains("this profile requires it"))
            #expect(truth.routing == (participation == .failed ? .modelFailed : .modelUnavailable))
        }
    }

    @Test("A stale history-action refusal is a message while history is in use and vanishes once history is off")
    func staleActionRefusalFollowsHistoryState() {
        var input = ShellTruthInputV1()
        input.desiredMode = .assist
        input.effectiveState = .assistReady
        input.incidentHistoryAvailability = .available
        input.incidentHistoryReason = nil
        input.incidentActionReason = .selectionMismatch
        let live = ShellTruthV1(input: input).refusals
        #expect(live.map(\.refusalClass) == [.history])
        #expect(live.first?.currency == .mostRecentMessage)

        input.desiredMode = .off
        input.effectiveState = .off
        input.incidentHistoryAvailability = .disabled
        input.incidentHistoryReason = .modeInactive
        #expect(ShellTruthV1(input: input).refusals.isEmpty)
        input.incidentHistoryAvailability = .closed
        input.incidentHistoryReason = .closed
        #expect(ShellTruthV1(input: input).refusals.isEmpty)
    }

    @Test("Advisory next actions tell an accepted user that re-analysis makes the acceptance stale")
    func advisoryWordingIsAcceptanceAware() {
        var input = ShellTruthInputV1()
        input.desiredMode = .assist
        input.effectiveState = .degraded
        input.selectedSubjectDigest = subject
        input.result = result(passed: true, disposition: .degraded, participation: .unavailable, canAccept: true)
        input.currentness = .current
        let accepted = ShellTruthV1(input: input).refusals.first?.nextSafeAction ?? ""
        #expect(accepted.contains("marks the current acceptance stale"))
        #expect(!accepted.contains("never change acceptance"))
        input.currentness = .none
        let notAccepted = ShellTruthV1(input: input).refusals.first?.nextSafeAction ?? ""
        #expect(notAccepted.contains("never grant acceptance"))
        #expect(!notAccepted.contains("stale"))
    }

    @Test("Capacity and quarantine next actions never instruct an action the ledger refuses")
    func historyNextActionsMatchLedgerSemantics() {
        func action(capture reason: PipelineIncidentCaptureReasonV1) -> String {
            var input = ShellTruthInputV1()
            input.incidentCaptureStatus = .refused
            input.incidentCaptureReason = reason
            return ShellTruthV1(input: input).refusals.first?.nextSafeAction ?? ""
        }
        func action(history reason: IncidentHistoryCoordinatorReasonV1) -> String {
            var input = ShellTruthInputV1()
            input.incidentHistoryAvailability = .available
            input.incidentHistoryReason = nil
            input.incidentActionReason = reason
            return ShellTruthV1(input: input).refusals.first?.nextSafeAction ?? ""
        }
        // Deletions append tombstones, so they cannot free capacity.
        for text in [action(capture: .ledgerCapacityExceeded), action(history: .capacityExceeded)] {
            #expect(text.contains("Deleting does not free space"))
            #expect(!text.contains("Delete stored fingerprints"))
            #expect(!text.contains("new history store"))
            #expect(text.contains("toggle is available in ASSIST"))
        }
        // The coordinator quarantines for the process lifetime after an uncertain open/close.
        for text in [action(history: .openUncertain), action(history: .closeUncertain)] {
            #expect(text.contains("Relaunch the app"))
            #expect(!text.hasPrefix("Refresh"))
        }
        // A conflict is not a duplicate.
        for text in [action(capture: .ledgerObservationConflict), action(capture: .ledgerIncidentIDConflict)] {
            #expect(text.contains("a conflict rather than a duplicate"))
            #expect(!text.contains("equivalent fingerprint already exists"))
        }
        #expect(action(capture: .ledgerIncidentTombstoned).contains("already tombstoned"))
        // Integrity refusals point at an action the menu bar offers.
        for text in [action(capture: .ledgerIntegrityRefused), action(history: .integrityRefused)] {
            #expect(text.contains("Turn history off"))
        }
    }

    @Test("Ordinary capture skips are not refusals")
    func captureSkipsAreNotRefusals() {
        for reason in [PipelineIncidentCaptureReasonV1.disabled, .cancelled, .admissionRevoked, .deterministicPass, .branchNotEligible] {
            var input = ShellTruthInputV1()
            input.desiredMode = .assist
            input.effectiveState = .assistReady
            input.result = result(passed: true)
            input.incidentCaptureStatus = .skipped
            input.incidentCaptureReason = reason
            #expect(ShellTruthV1(input: input).refusals.isEmpty, "\(reason)")
        }
        var appended = ShellTruthInputV1()
        appended.incidentCaptureStatus = .appended
        #expect(ShellTruthV1(input: appended).refusals.isEmpty)
    }

    @Test("Every capture reason that stores nothing yields a HISTORY refusal with its exact code and a next action")
    func everyStoringFailureIsActionable() {
        let reasons: [PipelineIncidentCaptureReasonV1] = [
            .bindingMismatch, .malformedResult, .transcriptMismatch, .unsupportedCheck, .contextInvalid,
            .snapshotByteLimitExceeded, .captureEnvelopeInvalid, .captureEnvelopeDigestMismatch,
            .captureEnvelopeBindingMismatch, .captureEnvelopeScopeMismatch, .actorAuthorityUnsupported,
            .protectedAuthorityUnsupported, .highWatermarkUnsupported, .forkReconciliationUnsupported,
            .evidenceEncodingFailed, .ledgerUnavailable, .ledgerInputRejected, .ledgerClosed,
            .ledgerIntegrityRefused, .ledgerObservationConflict, .ledgerIncidentIDConflict,
            .ledgerIncidentTombstoned, .ledgerCapacityExceeded, .ledgerWriteFailed, .ledgerUnexpectedFailure,
        ]
        for status in [PipelineIncidentCaptureStatusV1.skipped, .unavailable, .refused] {
            for reason in reasons {
                var input = ShellTruthInputV1()
                input.incidentCaptureStatus = status
                input.incidentCaptureReason = reason
                let truth = ShellTruthV1(input: input)
                #expect(truth.refusals.count == 1, "\(status) \(reason)")
                #expect(truth.refusals.first?.refusalClass == .history)
                #expect(truth.refusals.first?.exactReason == reason.rawValue)
                #expect(truth.refusals.first?.nextSafeAction.isEmpty == false)
            }
        }
    }

    @Test("Every history reason yields a non-empty next safe action")
    func everyHistoryReasonIsActionable() {
        let reasons: [IncidentHistoryCoordinatorReasonV1] = [
            .userDisabled, .modeInactive, .storageUnavailable, .historyNotFound, .integrityRefused,
            .configurationInvalid, .captureCancelled, .openUncertain, .closeUncertain, .shuttingDown,
            .closed, .selectionMismatch, .incidentNotFound, .incidentTombstoned, .tombstoneConflict,
            .retentionNotDue, .retentionDeadlineMissing, .retentionPolicyMismatch,
            .exportEncodingFailed, .capacityExceeded,
        ]
        for reason in reasons {
            var input = ShellTruthInputV1()
            input.incidentHistoryAvailability = .available
            input.incidentHistoryReason = nil
            input.incidentActionReason = reason
            let truth = ShellTruthV1(input: input)
            #expect(truth.refusals.count == 1, "\(reason)")
            #expect(truth.refusals.first?.refusalClass == .history)
            #expect(truth.refusals.first?.exactReason == reason.rawValue)
            #expect(truth.refusals.first?.currency == .mostRecentMessage)
            #expect(truth.refusals.first?.nextSafeAction.isEmpty == false)
        }
    }

    @Test("Choosing a file while OFF is pending confirmation, not an OFF request draining, and not a refusal")
    func selectWhileOffIsPendingNotRefusal() {
        var input = ShellTruthInputV1()
        input.desiredMode = .off
        input.effectiveState = .stoppingUncertain
        input.selectedSubjectDigest = subject
        let truth = ShellTruthV1(input: input)
        guard case .pending(let text) = truth.mode.agreement else {
            Issue.record("expected pending agreement"); return
        }
        #expect(text.contains("after an OFF request, a file choice while OFF, or while quitting"))
        #expect(text.contains("OFF is confirmed when the state reads OFF"))
        #expect(truth.refusals.isEmpty)
    }

    @Test("Shutdown is described as shutdown and carries one LIFECYCLE refusal")
    func shutdownIsLifecycle() {
        var input = ShellTruthInputV1()
        input.desiredMode = .assist
        input.effectiveState = .stoppingUncertain
        input.result = result(passed: true)
        input.currentness = .current
        let truth = ShellTruthV1(input: input)
        guard case .pending(let text) = truth.mode.agreement else {
            Issue.record("expected pending agreement"); return
        }
        #expect(text.contains("shutting down"))
        #expect(text.contains("ASSIST will not resume in this launch"))
        #expect(!text.contains("previous OFF"))
        #expect(truth.refusals.map(\.refusalClass) == [.lifecycle])
        #expect(truth.refusals[0].exactReason == "APP_SHUTTING_DOWN")
        #expect(truth.refusals[0].nextSafeAction.contains("Nothing will be accepted, exported, or stored"))
    }

    @Test("A cleared result after an earlier acceptance reads as superseded, never as 'nothing has been analyzed'")
    func clearedResultIsSuperseded() {
        var input = ShellTruthInputV1()
        input.desiredMode = .assist
        input.effectiveState = .starting
        input.selectedSubjectDigest = subject
        input.currentness = .stale
        let truth = ShellTruthV1(input: input)
        #expect(truth.decision == .superseded)
        #expect(truth.acceptance == .stale)
        #expect(!truth.decision.label.contains("nothing has been analyzed"))
        #expect(truth.decision.label.contains("analysis was requested again"))
        #expect(truth.routing == .analysisInFlight)
        #expect(truth.refusals.isEmpty)
    }

    @Test("ENFORCE without an artifact stays divergent and explains why")
    func enforceWithoutArtifactIsDivergent() {
        var input = ShellTruthInputV1()
        input.desiredMode = .enforce
        input.effectiveState = .blocked
        guard case .divergent(let text) = ShellTruthV1(input: input).mode.agreement else {
            Issue.record("expected divergent agreement"); return
        }
        #expect(text.contains("no artifact selected"))
    }

    @Test("An unknown message is shown verbatim as UNCLASSIFIED, never guessed")
    func unknownMessageIsUnclassified() {
        var input = ShellTruthInputV1()
        input.lastError = "SOMETHING_NEW: nobody mapped this yet"
        let truth = ShellTruthV1(input: input)
        #expect(truth.refusals.map(\.refusalClass) == [.unclassified])
        #expect(truth.refusals[0].exactReason == input.lastError)
        #expect(truth.refusals[0].artifactVerdictUnaffected)
        #expect(truth.refusals[0].currency == .mostRecentMessage)
    }

    @Test("No positive label implies device protection or certification, and the rendered summary carries both disclaimers")
    func noProtectionImplication() {
        var input = ShellTruthInputV1()
        input.desiredMode = .assist
        input.effectiveState = .assistReady
        input.selectedSubjectDigest = subject
        input.result = result(passed: true, participation: .participated)
        input.currentness = .current
        let truth = ShellTruthV1(input: input)
        let positiveLabels = [
            truth.mode.label, truth.routing.rawValue, truth.decision.label,
            truth.acceptance.label, truth.coverage.project, truth.coverage.client,
        ]
        for label in positiveLabels {
            let upper = label.uppercased()
            #expect(!upper.contains("PROTECT"), "\(label)")
            #expect(!upper.contains("CERTIF"), "\(label)")
            #expect(!upper.contains("SECURE"), "\(label)")
        }
        let summary = truth.accessibilitySummary
        #expect(summary.contains("does not protect this Mac"))
        #expect(summary.contains("not a protection indicator"))
        #expect(summary.contains("READY is not a certificate"))
        #expect(truth.routing == .modelParticipated)
        #expect(truth.routing.rawValue.contains("ADVISORY ONLY"))
    }

    @Test("The accessibility summary carries every truth in order")
    func summaryCarriesEverything() {
        var input = ShellTruthInputV1()
        input.desiredMode = .assist
        input.effectiveState = .degraded
        input.selectedDisplayName = "spec.json"
        input.selectedSubjectDigest = subject
        input.result = result(passed: true, disposition: .degraded, participation: .failed)
        input.incidentHistoryAvailability = .available
        input.incidentHistoryReason = nil
        input.incidentActionReason = .capacityExceeded
        let summary = ShellTruthV1(input: input).accessibilitySummary
        let expectedOrder = [
            "Requested ASSIST · profile \(CheckProfile.prototype.id) · effective DEGRADED.",
            "the advisory model failed",
            "Routing: MODEL FAILED — ADVISORY SKIPPED.",
            "Decision: DETERMINISTIC PASS — 2/2 checks",
            "Acceptance: NOT ACCEPTED.",
            "Coverage: \(ShellTruthV1.projectCoverage); \(ShellTruthV1.clientCoverage); artifact spec.json",
            "2 refusals.",
            "1. ADVISORY: MODEL_FAILED",
            "This is not an artifact verdict.",
            "2. HISTORY: INCIDENT_HISTORY_CAPACITY_EXCEEDED",
            ShellTruthV1.scopeStatement,
            ShellTruthV1.indicatorStatement,
        ]
        var cursor = summary.startIndex
        for fragment in expectedOrder {
            guard let range = summary.range(of: fragment, range: cursor..<summary.endIndex) else {
                Issue.record("missing or out of order: \(fragment)\n\(summary)")
                return
            }
            cursor = range.upperBound
        }
    }

    @Test("The model snapshot feeds the same truth the view renders")
    @MainActor
    func inputFromModel() async {
        let model = AppModel(analyzer: nil, incidentHistoryConfiguration: nil)
        #expect(ShellTruthInputV1(model: model) == ShellTruthInputV1(
            profileID: model.activeProfileID,
            incidentHistoryAvailability: model.incidentHistoryAvailability,
            incidentHistoryReason: model.incidentHistoryReason
        ))
        #expect(model.activeProfileID == CheckProfile.prototype.id)
        #expect(ShellTruthV1(input: ShellTruthInputV1(model: model)).refusals.isEmpty)

        model.setMode(.assist)
        let truth = ShellTruthV1(input: ShellTruthInputV1(model: model))
        #expect(truth.mode.effective == .blocked)
        #expect(truth.mode.profileID == model.activeProfileID)
        #expect(truth.refusals.map(\.refusalClass) == [.input])
        #expect(truth.refusals.first?.exactReason == model.lastError)

        model.setMode(.off)
        await model.finishShutdown()
    }
}
