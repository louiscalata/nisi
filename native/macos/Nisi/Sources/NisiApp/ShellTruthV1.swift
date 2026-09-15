import Foundation
import VeritasCore

// E13 one-switch comprehension and status truth.
//
// Every sentence the menu bar shows about state is derived here, purely, from
// a value snapshot of the model, so the shell's truth can be tested without
// the app, the ledger, a model, or timing. Nothing in this file has authority:
// it describes state, it never decides, admits, accepts, or repairs.

/// Value snapshot of everything the shell is allowed to describe.
struct ShellTruthInputV1: Equatable, Sendable {
    var desiredMode: VeritasMode = .off
    var effectiveState: EffectiveAppState = .off
    var profileID: String = CheckProfile.prototype.id
    var selectedDisplayName: String?
    var selectedSubjectDigest: String?
    var result: PipelineResult?
    var currentness: AcceptanceCurrentness = .none
    var lastError: String?
    var incidentHistoryAvailability: IncidentHistoryAvailabilityV1 = .disabled
    var incidentHistoryReason: IncidentHistoryCoordinatorReasonV1? = .userDisabled
    var incidentCaptureInFlight = false
    var incidentCaptureStatus: PipelineIncidentCaptureStatusV1?
    var incidentCaptureReason: PipelineIncidentCaptureReasonV1?
    var incidentActionInFlight = false
    var incidentActionReason: IncidentHistoryCoordinatorReasonV1?
    var fileExportInFlight = false
    var lastFileExportDigest: String?
}

enum ShellModeAgreementV1: Equatable, Sendable {
    /// The effective state is the one the requested mode implies.
    case agrees
    /// A transition is in progress; the effective state is not yet the requested one.
    case pending(String)
    /// The effective state differs and will not converge without an action.
    case divergent(String)

    var explanation: String? {
        switch self {
        case .agrees: nil
        case .pending(let text), .divergent(let text): text
        }
    }
}

struct ShellModeTruthV1: Equatable, Sendable {
    let desired: VeritasMode
    let profileID: String
    let effective: EffectiveAppState
    let agreement: ShellModeAgreementV1

    var label: String {
        "Requested \(desired.rawValue) · profile \(profileID) · effective \(effective.rawValue)"
    }
}

/// Whether any request has actually routed anywhere, in words a participant
/// can act on. `PARTICIPATED` never implies authority.
enum ShellRoutingTruthV1: String, Equatable, Sendable {
    case noRouteRequested = "NO ROUTE REQUESTED"
    case analysisInFlight = "ANALYSIS RUNNING — NO VERDICT YET"
    case routeUnavailable = "NO ROUTE EXISTS FOR THIS MODE — NOTHING RAN"
    case deterministicOnly = "DETERMINISTIC CHECKS ONLY — NO MODEL RAN"
    case modelParticipated = "MODEL PARTICIPATED — ADVISORY ONLY"
    case modelParticipatedPartial = "MODEL PARTICIPATED ON PART OF THE ARTIFACT — ADVISORY ONLY"
    case modelUnavailable = "MODEL UNAVAILABLE — ADVISORY SKIPPED"
    case modelFailed = "MODEL FAILED — ADVISORY SKIPPED"
}

/// The last artifact decision, separated from acceptance and from every
/// infrastructure outcome.
enum ShellDecisionTruthV1: Equatable, Sendable {
    /// Nothing is analyzed for the current mode, profile, and file.
    case none
    /// An earlier result existed and was cleared by a mode, profile, or file change.
    case superseded
    /// The route produced no checks at all (no route exists for the mode).
    case noChecksRan(subjectPrefix: String)
    case checksPassed(passed: Int, total: Int, subjectPrefix: String)
    case checksFailed(failed: Int, total: Int, subjectPrefix: String)

    var label: String {
        switch self {
        case .none:
            "NO VERDICT — nothing is analyzed for the current mode, profile, and file"
        case .superseded:
            "NO CURRENT VERDICT — the earlier result was cleared when analysis was requested again or the mode, profile, or file changed"
        case .noChecksRan(let prefix):
            "NO CHECKS RAN — no route exists for the requested mode on \(prefix)…"
        case let .checksPassed(passed, total, prefix):
            "DETERMINISTIC PASS — \(passed)/\(total) checks on \(prefix)…"
        case let .checksFailed(failed, total, prefix):
            "DETERMINISTIC FAIL — \(failed)/\(total) checks failed on \(prefix)…"
        }
    }
}

enum ShellAcceptanceTruthV1: Equatable, Sendable {
    case notAccepted
    case current(subjectPrefix: String)
    case stale

    var label: String {
        switch self {
        case .notAccepted: "NOT ACCEPTED"
        case .current(let prefix): "ACCEPTED — exact bytes \(prefix)… are current"
        case .stale: "STALE — an earlier acceptance no longer applies to what is shown"
        }
    }
}

/// Coarse refusal class. The class tells the participant *what kind of thing*
/// refused; the exact reason is always shown verbatim beside it.
enum ShellRefusalClassV1: String, Equatable, Sendable {
    /// This machine cannot host the product.
    case platform = "PLATFORM"
    /// The selected artifact or the request itself.
    case input = "INPUT"
    /// No route exists for the requested mode; nothing ran.
    case route = "ROUTE"
    /// Deterministic checks failed on the artifact. The only class that is
    /// about the artifact.
    case artifact = "ARTIFACT"
    /// The advisory model route or its coverage. Never an artifact verdict.
    case advisory = "ADVISORY"
    /// Acceptance of an analyzed snapshot was refused; nothing changed.
    case acceptance = "ACCEPTANCE"
    /// Optional local incident history. Cannot change results.
    case history = "HISTORY"
    /// A private file export.
    case export = "EXPORT"
    /// Shutting down.
    case lifecycle = "LIFECYCLE"
    /// A message the shell cannot classify. Shown verbatim, never guessed.
    case unclassified = "UNCLASSIFIED"

    /// True for every class except `artifact`: the refusal says nothing about
    /// the artifact, and any existing verdict still stands.
    var artifactVerdictUnaffected: Bool { self != .artifact }
}

/// Whether a refusal is known to describe the state shown now, or is the most
/// recent message the model kept, which may predate the current analysis.
enum ShellRefusalCurrencyV1: Equatable, Sendable {
    case current
    case mostRecentMessage
    /// The model mirrors a refused or unavailable capture into the history
    /// availability with a coarse reason and does not clear the capture
    /// outcome afterwards, so an availability refusal that matches that
    /// mirror may be the same event as the capture refusal shown above it,
    /// or a later, separate outage. The shell cannot tell; it says so.
    case mayMirrorCapture

    var note: String? {
        switch self {
        case .current: nil
        case .mostRecentMessage: "Most recent message; it may predate the current analysis."
        case .mayMirrorCapture: "May be the same event as the capture refusal above, or a later outage; the app does not distinguish them."
        }
    }
}

struct ShellRefusalV1: Equatable, Sendable {
    let refusalClass: ShellRefusalClassV1
    /// The code or message exactly as produced. Never paraphrased.
    let exactReason: String
    /// The last truthful result that still stands after this refusal.
    let preservedResult: String
    let nextSafeAction: String
    let currency: ShellRefusalCurrencyV1

    init(
        refusalClass: ShellRefusalClassV1,
        exactReason: String,
        preservedResult: String,
        nextSafeAction: String,
        currency: ShellRefusalCurrencyV1 = .current
    ) {
        self.refusalClass = refusalClass
        self.exactReason = exactReason
        self.preservedResult = preservedResult
        self.nextSafeAction = nextSafeAction
        self.currency = currency
    }

    var artifactVerdictUnaffected: Bool { refusalClass.artifactVerdictUnaffected }
}

struct ShellCoverageV1: Equatable, Sendable {
    let project: String
    let client: String
    let subject: String
    let outsideCoverage: String
}

/// Stable identifiers for keyboard/VoiceOver automation and tests.
enum ShellAccessibilityIDV1 {
    static let truthBlock = "veritas.shell.truth"
    static let modePicker = "veritas.shell.modePicker"
    static let chooseFile = "veritas.shell.chooseFile"
    static let analyze = "veritas.shell.analyze"
    static let accept = "veritas.shell.accept"
    static let clear = "veritas.shell.clear"
    static let exportAcceptedCopy = "veritas.shell.exportAcceptedCopy"
    static let historyToggle = "veritas.shell.historyToggle"
    static let refreshHistory = "veritas.shell.refreshHistory"
    static let refusal = "veritas.shell.refusal"
}

struct ShellTruthV1: Equatable, Sendable {
    static let scopeStatement =
        "Acceptance binds only the frozen snapshot bytes, profile, mode, and evidence shown here. It does not protect this Mac, watch other apps or files, or certify universal correctness."
    static let indicatorStatement =
        "The menu-bar icon never changes color or meaning. It is not a protection indicator, and READY is not a certificate."
    static let projectCoverage = "this macOS user session, private and local only"
    static let clientCoverage = "the Nisi menu bar, the only covered client"
    static let outsideCoverage =
        "every other app, file, process, and account on this Mac is outside coverage"

    let coverage: ShellCoverageV1
    let mode: ShellModeTruthV1
    let routing: ShellRoutingTruthV1
    let decision: ShellDecisionTruthV1
    let acceptance: ShellAcceptanceTruthV1
    /// Most actionable first. Empty when nothing refused.
    let refusals: [ShellRefusalV1]

    init(input: ShellTruthInputV1) {
        coverage = ShellCoverageV1(
            project: Self.projectCoverage,
            client: Self.clientCoverage,
            subject: Self.subject(input),
            outsideCoverage: Self.outsideCoverage
        )
        mode = ShellModeTruthV1(
            desired: input.desiredMode,
            profileID: input.profileID,
            effective: input.effectiveState,
            agreement: Self.agreement(input)
        )
        routing = Self.routing(input)
        decision = Self.decision(input)
        acceptance = Self.acceptance(input)
        refusals = Self.refusals(input, decision: decision, acceptance: acceptance)
    }

    /// One VoiceOver-readable sentence sequence carrying every truth above.
    var accessibilitySummary: String {
        var parts = [mode.label + "."]
        if let explanation = mode.agreement.explanation { parts.append(explanation) }
        parts.append("Routing: \(routing.rawValue).")
        parts.append("Decision: \(decision.label).")
        parts.append("Acceptance: \(acceptance.label).")
        parts.append("Coverage: \(coverage.project); \(coverage.client); \(coverage.subject); \(coverage.outsideCoverage).")
        if refusals.isEmpty {
            parts.append("No refusal.")
        } else {
            parts.append("\(refusals.count) refusal\(refusals.count == 1 ? "" : "s").")
            for (index, refusal) in refusals.enumerated() {
                var line = "\(index + 1). \(refusal.refusalClass.rawValue): \(refusal.exactReason) Preserved: \(refusal.preservedResult) Next: \(refusal.nextSafeAction)"
                if let note = refusal.currency.note { line += " \(note)" }
                if refusal.artifactVerdictUnaffected { line += " This is not an artifact verdict." }
                parts.append(line)
            }
        }
        parts.append(Self.scopeStatement)
        parts.append(Self.indicatorStatement)
        return parts.joined(separator: " ")
    }

    // MARK: - Derivations

    private static func subject(_ input: ShellTruthInputV1) -> String {
        guard let digest = input.selectedSubjectDigest else {
            return "no artifact selected"
        }
        let name = input.selectedDisplayName ?? "unnamed artifact"
        return "artifact \(name) · sha256:\(digest.prefix(16))…"
    }

    private static func agreement(_ input: ShellTruthInputV1) -> ShellModeAgreementV1 {
        let desired = input.desiredMode
        let hasArtifact = input.selectedSubjectDigest != nil
        switch (desired, input.effectiveState) {
        case (.off, .off), (.assist, .assistReady), (.enforce, .enforceReady):
            return .agrees
        case (.off, .stoppingUncertain):
            // Produced by an OFF request, by choosing (or failing to choose) a
            // file while OFF, and by quitting while OFF; all end in a
            // quiescence check the shell cannot tell apart.
            return .pending(
                "OFF is in effect but not yet confirmed: the app is checking that no admitted work remains, after an OFF request, a file choice while OFF, or while quitting. Nothing runs meanwhile; OFF is confirmed when the state reads OFF."
            )
        case (.off, _):
            return .divergent(
                "OFF was requested but the state has not returned to OFF. Nothing here is authorized."
            )
        case (_, .starting):
            return .pending(
                "\(desired.rawValue) was requested; analysis is running. No verdict exists yet."
            )
        case (_, .stoppingUncertain):
            // The only writer of this pair is app shutdown.
            return .pending(
                "The app is shutting down; admitted work is draining. \(desired.rawValue) will not resume in this launch."
            )
        case (_, .off):
            return .divergent(
                "\(desired.rawValue) was requested but nothing is analyzed for it."
            )
        case (_, .blocked):
            return .divergent(
                hasArtifact
                    ? "\(desired.rawValue) was requested but the route is blocked. The refusal below says why."
                    : "\(desired.rawValue) was requested with no artifact selected; readiness cannot exist without one."
            )
        case (.assist, .degraded):
            return .divergent(degradedExplanation(input.result))
        case (.enforce, .degraded):
            return .divergent(
                "ENFORCE cannot run degraded; nothing is enforced."
            )
        case (.enforce, .assistReady), (.assist, .enforceReady):
            return .divergent(
                "The effective state does not match the requested mode. Re-select the mode; treat the current state as unconfirmed."
            )
        }
    }

    private static func degradedExplanation(_ result: PipelineResult?) -> String {
        guard let result else {
            return "ASSIST is degraded; deterministic checks stand. No result is available to say why."
        }
        switch result.modelParticipation {
        case .unavailable:
            return "ASSIST is degraded: the advisory model was unavailable. Deterministic checks stand."
        case .failed:
            return "ASSIST is degraded: the advisory model failed. Deterministic checks stand."
        case .participated:
            if let coverage = result.advisoryCoverage, !coverage.complete {
                return "ASSIST is degraded: the advisory model analyzed only \(coverage.analyzedCharacters) of \(coverage.artifactCharacters) characters. Deterministic checks stand."
            }
            return "ASSIST is degraded: \(result.limitationCodes.joined(separator: ", ")). Deterministic checks stand."
        case .notRun:
            return "ASSIST is degraded: the advisory model did not run (\(result.limitationCodes.joined(separator: ", "))). Deterministic checks stand."
        }
    }

    private static func routing(_ input: ShellTruthInputV1) -> ShellRoutingTruthV1 {
        if input.effectiveState == .starting { return .analysisInFlight }
        guard let result = input.result else { return .noRouteRequested }
        if result.deterministicChecks.isEmpty { return .routeUnavailable }
        switch result.modelParticipation {
        case .notRun: return .deterministicOnly
        case .participated:
            if let coverage = result.advisoryCoverage, !coverage.complete {
                return .modelParticipatedPartial
            }
            return .modelParticipated
        case .unavailable: return .modelUnavailable
        case .failed: return .modelFailed
        }
    }

    private static func decision(_ input: ShellTruthInputV1) -> ShellDecisionTruthV1 {
        guard let result = input.result else {
            return input.currentness == .stale ? .superseded : .none
        }
        let prefix = String(result.subjectDigest.prefix(12))
        let total = result.deterministicChecks.count
        if total == 0 { return .noChecksRan(subjectPrefix: prefix) }
        let passed = result.deterministicChecks.filter { $0.status == .pass }.count
        if result.deterministicPassed {
            return .checksPassed(passed: passed, total: total, subjectPrefix: prefix)
        }
        return .checksFailed(failed: total - passed, total: total, subjectPrefix: prefix)
    }

    private static func acceptance(_ input: ShellTruthInputV1) -> ShellAcceptanceTruthV1 {
        switch input.currentness {
        case .none:
            return .notAccepted
        case .stale:
            return .stale
        case .current:
            let digest = input.result?.subjectDigest ?? input.selectedSubjectDigest ?? ""
            return .current(subjectPrefix: String(digest.prefix(12)))
        }
    }

    private static func preserved(
        decision: ShellDecisionTruthV1,
        acceptance: ShellAcceptanceTruthV1
    ) -> String {
        "\(decision.label). \(acceptance.label)."
    }

    private static func refusals(
        _ input: ShellTruthInputV1,
        decision: ShellDecisionTruthV1,
        acceptance: ShellAcceptanceTruthV1
    ) -> [ShellRefusalV1] {
        let preserved = preserved(decision: decision, acceptance: acceptance)
        var refusals = [ShellRefusalV1]()

        if let message = input.lastError, !message.isEmpty {
            refusals.append(classify(message: message, preserved: preserved))
        }

        if let result = input.result {
            refusals.append(contentsOf: resultRefusals(result, preserved: preserved, acceptance: acceptance))
        }

        var captureMirror: (availability: IncidentHistoryAvailabilityV1, reason: IncidentHistoryCoordinatorReasonV1)?
        if let status = input.incidentCaptureStatus,
           let refusal = captureRefusal(status: status, reason: input.incidentCaptureReason, preserved: preserved) {
            refusals.append(refusal)
            // The model's own mapping of a capture outcome onto history
            // availability (AppModel: unavailable -> storageUnavailable;
            // refused -> integrityRefused for an integrity refusal, else
            // configurationInvalid). Used only to annotate, never to hide.
            switch status {
            case .unavailable:
                captureMirror = (.unavailable, .storageUnavailable)
            case .refused:
                captureMirror = (.refused, input.incidentCaptureReason == .ledgerIntegrityRefused ? .integrityRefused : .configurationInvalid)
            case .skipped, .appended, .idempotentDuplicate:
                captureMirror = nil
            }
        }

        switch input.incidentHistoryAvailability {
        case .unavailable, .refused:
            if let reason = input.incidentHistoryReason {
                var refusal = historyRefusal(reason, context: "History is \(input.incidentHistoryAvailability.rawValue).", preserved: preserved)
                if let mirror = captureMirror, mirror.availability == input.incidentHistoryAvailability, mirror.reason == reason {
                    refusal = ShellRefusalV1(
                        refusalClass: refusal.refusalClass,
                        exactReason: refusal.exactReason,
                        preservedResult: refusal.preservedResult,
                        nextSafeAction: refusal.nextSafeAction,
                        currency: .mayMirrorCapture
                    )
                }
                refusals.append(refusal)
            }
        case .disabled, .armed, .opening, .available, .stopping, .closed:
            break
        }

        // A refused history action is kept by the model until the next
        // action; it is only meaningful while history is in use.
        if let reason = input.incidentActionReason {
            switch input.incidentHistoryAvailability {
            case .disabled, .closed:
                break
            case .armed, .opening, .available, .unavailable, .refused, .stopping:
                let refusal = historyRefusal(reason, context: "The history action was refused.", preserved: preserved)
                refusals.append(ShellRefusalV1(
                    refusalClass: refusal.refusalClass,
                    exactReason: refusal.exactReason,
                    preservedResult: refusal.preservedResult,
                    nextSafeAction: refusal.nextSafeAction,
                    currency: .mostRecentMessage
                ))
            }
        }

        if input.effectiveState == .stoppingUncertain, input.desiredMode != .off {
            refusals.append(ShellRefusalV1(
                refusalClass: .lifecycle,
                exactReason: "APP_SHUTTING_DOWN",
                preservedResult: preserved,
                nextSafeAction: "Let the app finish quitting. Nothing will be accepted, exported, or stored meanwhile; relaunch to continue."
            ))
        }

        return refusals
    }

    private static func resultRefusals(
        _ result: PipelineResult,
        preserved: String,
        acceptance: ShellAcceptanceTruthV1
    ) -> [ShellRefusalV1] {
        let limitations = result.limitationCodes.joined(separator: ", ")
        if result.deterministicChecks.isEmpty {
            // No route exists for the requested mode: nothing ran, nothing was judged.
            return [ShellRefusalV1(
                refusalClass: .route,
                exactReason: limitations.isEmpty ? "NO_ROUTE" : limitations,
                preservedResult: "Nothing ran and nothing was judged for \(result.mode.rawValue). \(preserved)",
                nextSafeAction: "\(result.mode.rawValue) has no route in this prototype; nothing was enforced or judged. Request ASSIST to analyze this file."
            )]
        }
        if !result.deterministicPassed {
            let failed = result.deterministicChecks
                .filter { $0.status != .pass }
                .map { "\($0.id) \($0.status.rawValue): \($0.explanation)" }
            return [ShellRefusalV1(
                refusalClass: .artifact,
                exactReason: failed.isEmpty ? "DETERMINISTIC_FAIL" : failed.joined(separator: " | "),
                preservedResult: "\(preserved) Nothing was accepted.",
                nextSafeAction: "Fix the artifact or select another file. Acceptance is not available for this snapshot."
            )]
        }
        // Deterministic PASS from here on: anything else is about the advisory route.
        let coverageText: String? = {
            guard let coverage = result.advisoryCoverage, !coverage.complete else { return nil }
            return "\(coverage.analyzedCharacters)/\(coverage.artifactCharacters) characters"
        }()
        let blocked = result.disposition == .blocked
        let degraded = result.disposition == .degraded
        // Acceptance-aware tail: re-running Analyze marks a current acceptance
        // stale until it is accepted again, so the instruction must say so.
        let rerunTail: String = {
            if case .current = acceptance {
                return "Re-running Analyze marks the current acceptance stale until you accept again; advisory findings never grant acceptance."
            }
            return "Re-run Analyze later for advisory findings; they never grant acceptance."
        }()
        switch result.modelParticipation {
        case .unavailable, .failed:
            var reason = "MODEL_\(result.modelParticipation.rawValue)"
            if !limitations.isEmpty { reason += " [\(limitations)]" }
            let cause = result.modelParticipation == .failed ? "failed" : "was unavailable"
            return [ShellRefusalV1(
                refusalClass: .advisory,
                exactReason: reason,
                preservedResult: preserved,
                nextSafeAction: blocked
                    ? "The advisory model \(cause) and this profile requires it, so acceptance is not available. Re-run Analyze when the model is available. The deterministic verdict stands."
                    : (result.canAcceptInsideVeritas
                        ? "Deterministic checks stand and acceptance remains available. \(rerunTail)"
                        : "Deterministic checks stand. Re-run Analyze when the advisory model is available; acceptance is not available for this snapshot.")
            )]
        case .participated where blocked, .notRun where blocked:
            let reason = limitations.isEmpty ? "ADVISORY_ROUTE_BLOCKED" : limitations
            return [ShellRefusalV1(
                refusalClass: .advisory,
                exactReason: coverageText.map { "\(reason) (\($0))" } ?? reason,
                preservedResult: preserved,
                nextSafeAction: coverageText != nil
                    ? "This profile requires complete advisory coverage and the model analyzed only part of the artifact, so acceptance is not available. Select a smaller artifact; the profile is fixed by the app configuration. The deterministic verdict stands."
                    : "The advisory route is blocked for this profile, so acceptance is not available. Re-run Analyze; if it repeats, the profile is fixed by the app configuration. The deterministic verdict stands."
            )]
        case .participated where degraded:
            var reason = coverageText.map { "ADVISORY_COVERAGE_PARTIAL \($0)" } ?? "ADVISORY_DEGRADED"
            if !limitations.isEmpty { reason += " [\(limitations)]" }
            return [ShellRefusalV1(
                refusalClass: .advisory,
                exactReason: reason,
                preservedResult: preserved,
                nextSafeAction: result.canAcceptInsideVeritas
                    ? "The advisory findings cover only part of the artifact; deterministic checks stand and acceptance remains available. Select a smaller artifact for complete advisory coverage. \(rerunTail)"
                    : "The advisory findings cover only part of the artifact and acceptance is not available. Select a smaller artifact. The deterministic verdict stands."
            )]
        case .participated, .notRun:
            if degraded {
                return [ShellRefusalV1(
                    refusalClass: .advisory,
                    exactReason: limitations.isEmpty ? "ADVISORY_DEGRADED" : limitations,
                    preservedResult: preserved,
                    nextSafeAction: "The advisory route is degraded; deterministic checks stand. \(rerunTail)"
                )]
            }
            return []
        }
    }

    private static let platformMessagePrefix = "Codename Veritas Framework requires macOS"
    private static let noArtifactMessage =
        "Select an artifact before requesting a route. No readiness has been established."
    private static let snapshotIdentityPrefix = "SNAPSHOT_IDENTITY_CHANGED:"
    private static let acceptanceMessagePrefixes = [
        "Analyzer finding rejected: ACCEPT_",
        "Analyzer finding rejected: RESULT_NOT_ACCEPTABLE",
    ]
    private static let fixedSnapshotErrors: [SnapshotError] = [
        .notRegularFile, .empty, .invalidByteLimit, .changedDuringRead, .unreadable,
    ]
    private static let exportErrors: [PrivateVerifiedWriteErrorV1] = [
        .invalidDestination, .destinationExists, .byteLimitExceeded, .sourceDigestMismatch,
        .temporaryCreateFailed, .writeFailed, .syncFailed, .identityMismatch,
        .publishFailed, .readbackMismatch, .cleanupRefused, .admissionRevoked,
    ]

    private static func classify(message: String, preserved: String) -> ShellRefusalV1 {
        if message.hasPrefix(platformMessagePrefix) {
            return ShellRefusalV1(
                refusalClass: .platform,
                exactReason: message,
                preservedResult: "Nothing was analyzed on this machine. \(preserved)",
                nextSafeAction: "Use macOS 27 or later on Apple Silicon. No artifact was judged."
            )
        }
        if message == noArtifactMessage || message.hasPrefix(snapshotIdentityPrefix)
            || fixedSnapshotErrors.contains(where: { $0.errorDescription == message })
            || (message.hasPrefix("The selected file is ") && message.contains(" bytes; the current profile allows "))
            || (message.hasPrefix("The selected file grew beyond the ") && message.hasSuffix("-byte read limit.")) {
            return ShellRefusalV1(
                refusalClass: .input,
                exactReason: message,
                preservedResult: "No verdict exists for this selection. \(preserved)",
                nextSafeAction: "Choose one regular UTF-8 text, Markdown, or JSON file within the profile's byte limit, then request ASSIST."
            )
        }
        if acceptanceMessagePrefixes.contains(where: { message.hasPrefix($0) }) {
            return ShellRefusalV1(
                refusalClass: .acceptance,
                exactReason: message,
                preservedResult: "Nothing was accepted or changed. \(preserved)",
                nextSafeAction: "Acceptance was refused. Run Analyze again on the same file, then Accept.",
                currency: .mostRecentMessage
            )
        }
        if let error = exportErrors.first(where: { $0.errorDescription == message }) {
            return ShellRefusalV1(
                refusalClass: .export,
                exactReason: message,
                preservedResult: "No file was replaced or partially written. \(preserved)",
                nextSafeAction: exportNextAction(error),
                currency: .mostRecentMessage
            )
        }
        return ShellRefusalV1(
            refusalClass: .unclassified,
            exactReason: message,
            preservedResult: preserved,
            nextSafeAction: "Read the exact message above. No result was changed by it; re-select the file or mode to retry.",
            currency: .mostRecentMessage
        )
    }

    private static func exportNextAction(_ error: PrivateVerifiedWriteErrorV1) -> String {
        switch error {
        case .admissionRevoked:
            "The export admission was superseded by a newer selection, an acceptance change or clear, or shutdown. Nothing was written. For an accepted copy, re-establish acceptance and export again; for a redacted incident report, prepare it again, then save."
        case .byteLimitExceeded:
            "The accepted bytes exceed the private export limit; this export cannot succeed. Nothing was written."
        case .sourceDigestMismatch:
            "The bytes no longer match the accepted digest; nothing was written. Analyze and accept again, then export."
        case .invalidDestination, .destinationExists:
            "Choose a new file name in an existing local folder and export again. Existing files are never replaced."
        case .temporaryCreateFailed, .writeFailed, .syncFailed, .identityMismatch,
             .publishFailed, .readbackMismatch, .cleanupRefused:
            "The export could not be completed safely and no existing file was replaced. Export again to a new destination; if it repeats, check the destination volume."
        }
    }

    private static func captureRefusal(
        status: PipelineIncidentCaptureStatusV1,
        reason: PipelineIncidentCaptureReasonV1?,
        preserved: String
    ) -> ShellRefusalV1? {
        switch status {
        case .appended, .idempotentDuplicate:
            return nil
        case .skipped:
            guard let reason else { return nil }
            switch reason {
            case .disabled, .cancelled, .admissionRevoked, .deterministicPass, .branchNotEligible:
                return nil
            case .bindingMismatch, .malformedResult, .transcriptMismatch, .unsupportedCheck,
                 .contextInvalid, .snapshotByteLimitExceeded, .captureEnvelopeInvalid,
                 .captureEnvelopeDigestMismatch, .captureEnvelopeBindingMismatch,
                 .captureEnvelopeScopeMismatch, .actorAuthorityUnsupported,
                 .protectedAuthorityUnsupported, .highWatermarkUnsupported,
                 .forkReconciliationUnsupported, .evidenceEncodingFailed,
                 .ledgerUnavailable, .ledgerInputRejected, .ledgerClosed,
                 .ledgerIntegrityRefused, .ledgerObservationConflict,
                 .ledgerIncidentIDConflict, .ledgerIncidentTombstoned,
                 .ledgerCapacityExceeded, .ledgerWriteFailed, .ledgerUnexpectedFailure:
                return historyCaptureRefusal(reason, preserved: preserved)
            }
        case .unavailable, .refused:
            guard let reason else {
                return ShellRefusalV1(
                    refusalClass: .history,
                    exactReason: "INCIDENT_CAPTURE_\(status.rawValue)",
                    preservedResult: "The pipeline result is unchanged; history cannot alter results. \(preserved)",
                    nextSafeAction: "Nothing to do for the artifact. Check local history storage if you rely on stored fingerprints."
                )
            }
            return historyCaptureRefusal(reason, preserved: preserved)
        }
    }

    private static let capacityAction =
        "History is at capacity; nothing was stored. Deleting does not free space, because deletions are recorded, not erased. Turn history off to keep working (the toggle is available in ASSIST). The result stands."
    private static let integrityAction =
        "The history store failed its integrity check and was not reinterpreted; nothing was stored. Turn history off to keep working; the store keeps its bytes for inspection. Results are unaffected."
    private static let quarantineAction =
        "History is quarantined for this launch after an uncertain open or close; Refresh cannot recover it. Relaunch the app to use history again. Results are unaffected."

    private static func historyCaptureRefusal(
        _ reason: PipelineIncidentCaptureReasonV1,
        preserved: String
    ) -> ShellRefusalV1 {
        let next: String
        switch reason {
        case .disabled:
            next = "History is off. Turn it on in ASSIST if you want failures remembered; results do not change."
        case .cancelled, .admissionRevoked:
            next = "A newer selection or mode change superseded this capture. Nothing to do."
        case .deterministicPass, .branchNotEligible:
            next = "Only deterministic failures are captured. Nothing to do."
        case .snapshotByteLimitExceeded:
            next = "The snapshot exceeds the history byte limit. The result stands; a smaller file can be remembered."
        case .contextInvalid, .bindingMismatch, .malformedResult, .transcriptMismatch,
             .unsupportedCheck, .captureEnvelopeInvalid, .captureEnvelopeDigestMismatch,
             .captureEnvelopeBindingMismatch, .captureEnvelopeScopeMismatch,
             .actorAuthorityUnsupported, .ledgerInputRejected:
            next = "The capture was refused by an integrity check and nothing was stored. Refresh Local History; if it repeats, report the exact code. The result stands."
        case .protectedAuthorityUnsupported, .highWatermarkUnsupported,
             .forkReconciliationUnsupported:
            next = "The capture asked for a capability this history version does not support; nothing was stored. The result stands."
        case .evidenceEncodingFailed, .ledgerWriteFailed, .ledgerUnexpectedFailure:
            next = "History storage could not record the failure; nothing was stored. Check local disk, then Refresh Local History. The result stands."
        case .ledgerUnavailable, .ledgerClosed:
            next = "History storage was unavailable or already closed; nothing was stored. Refresh Local History when the state settles. The result stands."
        case .ledgerIntegrityRefused:
            next = integrityAction
        case .ledgerObservationConflict, .ledgerIncidentIDConflict:
            next = "The store holds a different record under this identity, a conflict rather than a duplicate; nothing was stored. Refresh Local History; if it repeats, turn history off and keep the store for inspection. The result stands."
        case .ledgerIncidentTombstoned:
            next = "This fingerprint is already tombstoned; nothing new was stored. Nothing to do."
        case .ledgerCapacityExceeded:
            next = capacityAction
        }
        return ShellRefusalV1(
            refusalClass: .history,
            exactReason: reason.rawValue,
            preservedResult: "The pipeline result is unchanged; history cannot alter results. \(preserved)",
            nextSafeAction: next
        )
    }

    private static func historyRefusal(
        _ reason: IncidentHistoryCoordinatorReasonV1,
        context: String,
        preserved: String
    ) -> ShellRefusalV1 {
        let next: String
        switch reason {
        case .userDisabled:
            next = "History is off by choice. Turn it on in ASSIST if you want failures remembered."
        case .modeInactive:
            next = "History only runs in ASSIST. Request ASSIST to use it."
        case .storageUnavailable:
            next = "Local history storage could not be used. The result stands; check disk space and permissions, then Refresh Local History."
        case .historyNotFound:
            next = "No history store exists yet. It is created on the first stored failure; nothing to do."
        case .integrityRefused:
            next = integrityAction
        case .configurationInvalid:
            next = "History refused. If a capture refusal is shown above, this reflects it; otherwise the history configuration was rejected and storage was not opened. Results are unaffected."
        case .captureCancelled, .shuttingDown, .closed:
            next = "History was closing or superseded. Wait for the state to settle, then Refresh Local History; after a shutdown, relaunch."
        case .openUncertain, .closeUncertain:
            next = quarantineAction
        case .selectionMismatch, .incidentNotFound, .incidentTombstoned, .tombstoneConflict:
            next = "The stored fingerprint changed under this action. Refresh Local History and choose again."
        case .retentionNotDue, .retentionDeadlineMissing, .retentionPolicyMismatch:
            next = "Retention review did not apply. Nothing was deleted; nothing to do."
        case .exportEncodingFailed:
            next = "The redacted export could not be encoded; no file was written. Prepare it again."
        case .capacityExceeded:
            next = capacityAction
        }
        return ShellRefusalV1(
            refusalClass: .history,
            exactReason: reason.rawValue,
            preservedResult: "\(context) The pipeline result is unchanged; history cannot alter results. \(preserved)",
            nextSafeAction: next
        )
    }
}

extension ShellTruthInputV1 {
    @MainActor
    init(model: AppModel) {
        self.init(
            desiredMode: model.desiredMode,
            effectiveState: model.effectiveState,
            profileID: model.activeProfileID,
            selectedDisplayName: model.selectedSnapshot?.displayName,
            selectedSubjectDigest: model.selectedSnapshot?.subjectDigest,
            result: model.result,
            currentness: model.currentness,
            lastError: model.lastError,
            incidentHistoryAvailability: model.incidentHistoryAvailability,
            incidentHistoryReason: model.incidentHistoryReason,
            incidentCaptureInFlight: model.incidentCaptureInFlight,
            incidentCaptureStatus: model.incidentCaptureOutcome?.status,
            incidentCaptureReason: model.incidentCaptureOutcome?.reason,
            incidentActionInFlight: model.incidentActionInFlight,
            incidentActionReason: model.incidentActionReason,
            fileExportInFlight: model.fileExportInFlight,
            lastFileExportDigest: model.lastFileExportReceipt?.digest
        )
    }
}
