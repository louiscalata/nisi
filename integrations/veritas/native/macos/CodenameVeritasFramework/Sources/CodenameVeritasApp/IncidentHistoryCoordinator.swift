import Darwin
import Foundation
import VeritasCore

enum IncidentHistoryAvailabilityV1: String, Equatable, Sendable {
    case disabled = "DISABLED"
    case armed = "ARMED — NOT YET OPENED"
    case opening = "OPENING"
    case available = "AVAILABLE — LOCAL ONLY"
    case unavailable = "UNAVAILABLE"
    case refused = "REFUSED"
    case stopping = "STOPPING"
    case closed = "CLOSED"
}

enum IncidentHistoryCoordinatorReasonV1: String, Equatable, Sendable {
    case userDisabled = "INCIDENT_HISTORY_USER_DISABLED"
    case modeInactive = "INCIDENT_HISTORY_MODE_INACTIVE"
    case storageUnavailable = "INCIDENT_HISTORY_STORAGE_UNAVAILABLE"
    case historyNotFound = "INCIDENT_HISTORY_NOT_FOUND"
    case integrityRefused = "INCIDENT_HISTORY_INTEGRITY_REFUSED"
    case configurationInvalid = "INCIDENT_HISTORY_CONFIGURATION_INVALID"
    case captureCancelled = "INCIDENT_HISTORY_CAPTURE_CANCELLED"
    case openUncertain = "INCIDENT_HISTORY_OPEN_UNCERTAIN"
    case closeUncertain = "INCIDENT_HISTORY_CLOSE_UNCERTAIN"
    case shuttingDown = "INCIDENT_HISTORY_SHUTTING_DOWN"
    case closed = "INCIDENT_HISTORY_CLOSED"
    case selectionMismatch = "INCIDENT_HISTORY_SELECTION_MISMATCH"
    case incidentNotFound = "INCIDENT_HISTORY_INCIDENT_NOT_FOUND"
    case incidentTombstoned = "INCIDENT_HISTORY_INCIDENT_TOMBSTONED"
    case tombstoneConflict = "INCIDENT_HISTORY_TOMBSTONE_CONFLICT"
    case retentionNotDue = "INCIDENT_HISTORY_RETENTION_NOT_DUE"
    case retentionDeadlineMissing = "INCIDENT_HISTORY_RETENTION_DEADLINE_MISSING"
    case retentionPolicyMismatch = "INCIDENT_HISTORY_RETENTION_POLICY_MISMATCH"
    case exportEncodingFailed = "INCIDENT_HISTORY_EXPORT_ENCODING_FAILED"
    case capacityExceeded = "INCIDENT_HISTORY_CAPACITY_EXCEEDED"
}

enum IncidentHistoryRootPreparationV1: Sendable {
    case requireExisting
    case createPrivateChildren(anchor: URL, names: [String])
}

struct IncidentHistoryConfigurationV1: Sendable {
    static let retentionReviewInterval: TimeInterval = 30 * 24 * 60 * 60

    let rootDirectory: URL
    let scope: IncidentLedgerScopeV1
    let rootPreparation: IncidentHistoryRootPreparationV1

    static func founderAlphaDefault() -> IncidentHistoryConfigurationV1? {
        guard let applicationSupport = try? FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: false
        ) else {
            return nil
        }
        let names = ["Codename Veritas Framework", "Private Incident History"]
        let root = names.reduce(applicationSupport) { partial, name in
            partial.appendingPathComponent(name, isDirectory: true)
        }
        return IncidentHistoryConfigurationV1(
            rootDirectory: root,
            scope: IncidentLedgerScopeV1(
                scopeID: "scope/veritas-private",
                projectDigest: digest("codename-veritas-framework-founder-alpha-v1"),
                accessPolicyDigest: digest("same-user-private-app-support-0700-v1"),
                retentionPolicyDigest: LocalIncidentLedgerV1.retentionPolicyDigest
            ),
            rootPreparation: .createPrivateChildren(anchor: applicationSupport, names: names)
        )
    }

    static func existing(
        rootDirectory: URL,
        scope: IncidentLedgerScopeV1
    ) -> IncidentHistoryConfigurationV1 {
        IncidentHistoryConfigurationV1(
            rootDirectory: rootDirectory,
            scope: scope,
            rootPreparation: .requireExisting
        )
    }

    private static func digest(_ value: String) -> String {
        ArtifactSnapshot.digest(Data(value.utf8))
    }
}

typealias IncidentLedgerOpenerV1 = @Sendable (
    URL,
    IncidentLedgerScopeV1
) async throws -> LocalIncidentLedgerV1

enum IncidentLateOpenCleanupResultV1: String, Equatable, Sendable {
    case closed = "CLOSED"
    case failed = "FAILED"
    case timedOut = "TIMED_OUT"
}

typealias IncidentLateOpenCleanupObserverV1 = @Sendable (
    URL,
    IncidentLateOpenCleanupResultV1
) async -> Void

enum IncidentHistoryCoordinatorCaptureResultV1: Sendable {
    case completed(
        outcome: PipelineIncidentCaptureOutcomeV1,
        history: [IncidentSummaryV1]
    )
    case completedHistoryUnavailable(
        outcome: PipelineIncidentCaptureOutcomeV1,
        reason: IncidentHistoryCoordinatorReasonV1
    )
    case completedHistoryRefused(
        outcome: PipelineIncidentCaptureOutcomeV1,
        reason: IncidentHistoryCoordinatorReasonV1
    )
    case unavailable(IncidentHistoryCoordinatorReasonV1)
    case refused(IncidentHistoryCoordinatorReasonV1)
    case inactive(IncidentHistoryCoordinatorReasonV1)
}

enum IncidentHistoryCoordinatorCloseResultV1: Equatable, Sendable {
    case closed
    case uncertain(IncidentHistoryCoordinatorReasonV1)
}

enum IncidentHistoryCoordinatorListResultV1: Sendable {
    case available([IncidentSummaryV1])
    case unavailable(IncidentHistoryCoordinatorReasonV1)
    case refused(IncidentHistoryCoordinatorReasonV1)
    case inactive(IncidentHistoryCoordinatorReasonV1)
}

enum IncidentHistoryCoordinatorInspectResultV1: Sendable {
    case available(IncidentViewV1)
    case unavailable(IncidentHistoryCoordinatorReasonV1)
    case refused(IncidentHistoryCoordinatorReasonV1)
    case inactive(IncidentHistoryCoordinatorReasonV1)
}

enum IncidentHistoryCoordinatorTombstoneResultV1: Sendable {
    case completed(IncidentTombstoneDispositionV1)
    case unavailable(IncidentHistoryCoordinatorReasonV1)
    case refused(IncidentHistoryCoordinatorReasonV1)
    case inactive(IncidentHistoryCoordinatorReasonV1)
}

enum IncidentHistoryCoordinatorExplainResultV1: Sendable {
    case available(IncidentExplanationV1)
    case unavailable(IncidentHistoryCoordinatorReasonV1)
    case refused(IncidentHistoryCoordinatorReasonV1)
    case inactive(IncidentHistoryCoordinatorReasonV1)
}

enum IncidentHistoryCoordinatorRetentionSweepResultV1: Sendable {
    case completed(
        page: IncidentRetentionSweepPageV1,
        history: [IncidentSummaryV1]
    )
    case completedHistoryUnavailable(
        page: IncidentRetentionSweepPageV1,
        reason: IncidentHistoryCoordinatorReasonV1
    )
    case completedHistoryRefused(
        page: IncidentRetentionSweepPageV1,
        reason: IncidentHistoryCoordinatorReasonV1
    )
    case unavailable(IncidentHistoryCoordinatorReasonV1)
    case refused(IncidentHistoryCoordinatorReasonV1)
    case inactive(IncidentHistoryCoordinatorReasonV1)
}

enum IncidentHistoryCoordinatorExportResultV1: Sendable {
    case available(IncidentRedactedExportV1)
    case unavailable(IncidentHistoryCoordinatorReasonV1)
    case refused(IncidentHistoryCoordinatorReasonV1)
    case inactive(IncidentHistoryCoordinatorReasonV1)
}

/// Owns the single Founder Alpha ledger handle and its local-only lifecycle.
///
/// The actor never returns raw storage errors, never creates an alternate store,
/// and never reopens after terminal shutdown or an integrity refusal.
actor IncidentHistoryCoordinatorV1 {
    private enum Phase {
        case running
        case suspending
        case quarantined
        case shuttingDown
        case closed
    }

    private enum OpenFailure: Sendable {
        case unavailable
        case integrityRefused
        case configurationInvalid
        case openUncertain
    }

    private enum OpenResult: Sendable {
        case opened(LocalIncidentLedgerV1)
        case failed(OpenFailure)
    }

    private struct Opening: Sendable {
        let id: UUID
        let generation: UInt64
        let task: Task<OpenResult, Never>
    }

    private enum LedgerAccess: Sendable {
        case opened(LocalIncidentLedgerV1)
        case unavailable(IncidentHistoryCoordinatorReasonV1)
        case refused(IncidentHistoryCoordinatorReasonV1)
        case inactive(IncidentHistoryCoordinatorReasonV1)
    }

    private enum BoundedOpenResult: Sendable {
        case completed(OpenResult)
        case timedOut
    }

    private enum BoundedCloseResult: Sendable {
        case closed
        case failed
        case timedOut
    }

    private enum ActionFailure: Sendable {
        case unavailable(IncidentHistoryCoordinatorReasonV1)
        case refused(IncidentHistoryCoordinatorReasonV1)
        case inactive(IncidentHistoryCoordinatorReasonV1)
    }

    private final class RaceClaim: @unchecked Sendable {
        private let lock = NSLock()
        private var claimed = false

        func claim() -> Bool {
            lock.withLock {
                guard !claimed else { return false }
                claimed = true
                return true
            }
        }
    }

    private let configuration: IncidentHistoryConfigurationV1?
    private let adapter: PipelineIncidentAdapterV1
    private let opener: IncidentLedgerOpenerV1
    private let storageOperationTimeout: Duration
    private let lateOpenCleanupObserver: IncidentLateOpenCleanupObserverV1?
    private let mutationControl: IncidentLifecycleMutationControlV1

    private var phase: Phase = .running
    private var generation: UInt64 = 0
    private var opening: Opening?
    private var ledger: LocalIncidentLedgerV1?
    private var refusalReason: IncidentHistoryCoordinatorReasonV1?

    init(
        configuration: IncidentHistoryConfigurationV1?,
        adapter: PipelineIncidentAdapterV1,
        storageOperationTimeout: Duration = .seconds(3),
        opener: @escaping IncidentLedgerOpenerV1 = { root, scope in
            try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        },
        lateOpenCleanupObserver: IncidentLateOpenCleanupObserverV1? = nil,
        mutationControl: IncidentLifecycleMutationControlV1 = .init()
    ) {
        self.configuration = configuration
        self.adapter = adapter
        self.storageOperationTimeout = storageOperationTimeout
        self.opener = opener
        self.lateOpenCleanupObserver = lateOpenCleanupObserver
        self.mutationControl = mutationControl
    }

    func capture(
        snapshot: ArtifactSnapshot,
        profile: CheckProfile,
        mode: VeritasMode,
        result: PipelineResult,
        context: PipelineIncidentCaptureContextV1
    ) async -> IncidentHistoryCoordinatorCaptureResultV1 {
        let admittedGeneration = generation
        let access = await ledgerForUse()
        switch access {
        case .opened(let ledger):
            guard phase == .running,
                  generation == admittedGeneration,
                  !Task.isCancelled else {
                return .inactive(
                    phase == .closed ? .closed :
                        (phase == .shuttingDown ? .shuttingDown : .captureCancelled)
                )
            }
            let outcome = await adapter.capture(
                snapshot: snapshot,
                profile: profile,
                mode: mode,
                result: result,
                context: context,
                ledger: ledger
            )
            guard phase == .running,
                  generation == admittedGeneration,
                  !Task.isCancelled else {
                return .inactive(
                    phase == .closed ? .closed :
                        (phase == .shuttingDown ? .shuttingDown : .captureCancelled)
                )
            }

            if outcome.reason == .ledgerIntegrityRefused {
                await quarantine(ledger)
                return .completed(outcome: outcome, history: [])
            }
            if outcome.status == .unavailable {
                await discardTransientLedger(ledger)
                return .completed(outcome: outcome, history: [])
            }

            let history: [IncidentSummaryV1]
            if outcome.status == .appended || outcome.status == .idempotentDuplicate {
                do {
                    history = try await ledger.list()
                } catch let error as IncidentLedgerErrorV1 {
                    if error.isNamespaceOrIntegrityRefusal {
                        await quarantine(ledger)
                        return .completedHistoryRefused(
                            outcome: outcome,
                            reason: .integrityRefused
                        )
                    }
                    await discardTransientLedger(ledger)
                    return .completedHistoryUnavailable(
                        outcome: outcome,
                        reason: .storageUnavailable
                    )
                } catch {
                    await discardTransientLedger(ledger)
                    return .completedHistoryUnavailable(
                        outcome: outcome,
                        reason: .storageUnavailable
                    )
                }
            } else {
                history = []
            }
            return .completed(outcome: outcome, history: history)

        case .unavailable(let reason):
            return .unavailable(reason)
        case .refused(let reason):
            return .refused(reason)
        case .inactive(let reason):
            return .inactive(reason)
        }
    }

    func list() async -> IncidentHistoryCoordinatorListResultV1 {
        switch await ledgerForExistingUse() {
        case .opened(let ledger):
            do {
                return .available(try await ledger.list())
            } catch let error as IncidentLedgerErrorV1 {
                if error.isNamespaceOrIntegrityRefusal {
                    await quarantine(ledger)
                    return .refused(.integrityRefused)
                }
                await discardTransientLedger(ledger)
                return .unavailable(.storageUnavailable)
            } catch {
                await discardTransientLedger(ledger)
                return .unavailable(.storageUnavailable)
            }
        case .unavailable(let reason):
            return .unavailable(reason)
        case .refused(let reason):
            return .refused(reason)
        case .inactive(let reason):
            return .inactive(reason)
        }
    }

    func inspect(
        selection: IncidentSelectionV1
    ) async -> IncidentHistoryCoordinatorInspectResultV1 {
        switch await ledgerForExistingUse() {
        case .opened(let ledger):
            do {
                return .available(try await ledger.inspect(selection: selection))
            } catch let error as IncidentLedgerErrorV1 {
                switch await handleActionError(error, ledger: ledger) {
                case .unavailable(let reason): return .unavailable(reason)
                case .refused(let reason): return .refused(reason)
                case .inactive(let reason): return .inactive(reason)
                }
            } catch {
                await discardTransientLedger(ledger)
                return .unavailable(.storageUnavailable)
            }
        case .unavailable(let reason):
            return .unavailable(reason)
        case .refused(let reason):
            return .refused(reason)
        case .inactive(let reason):
            return .inactive(reason)
        }
    }

    func explain(selection: IncidentSelectionV1) async -> IncidentHistoryCoordinatorExplainResultV1 {
        let admittedGeneration = generation
        switch await ledgerForExistingUse() {
        case .opened(let ledger):
            guard phase == .running, generation == admittedGeneration, !Task.isCancelled else {
                return .inactive(.captureCancelled)
            }
            do {
                let value = try await ledger.explain(selection: selection)
                guard phase == .running, generation == admittedGeneration, !Task.isCancelled else {
                    return .inactive(.captureCancelled)
                }
                return .available(value)
            } catch let error as IncidentLedgerErrorV1 {
                switch await handleActionError(error, ledger: ledger) {
                case .unavailable(let reason): return .unavailable(reason)
                case .refused(let reason): return .refused(reason)
                case .inactive(let reason): return .inactive(reason)
                }
            } catch is CancellationError {
                return .inactive(.captureCancelled)
            } catch {
                await discardTransientLedger(ledger)
                return .unavailable(.storageUnavailable)
            }
        case .unavailable(let reason): return .unavailable(reason)
        case .refused(let reason): return .refused(reason)
        case .inactive(let reason): return .inactive(reason)
        }
    }

    func tombstone(
        selection: IncidentSelectionV1,
        reason: IncidentTombstoneReasonV1
    ) async -> IncidentHistoryCoordinatorTombstoneResultV1 {
        guard let configuration else { return .refused(.configurationInvalid) }
        let admittedGeneration = generation
        switch await ledgerForExistingUse() {
        case .opened(let ledger):
            guard phase == .running,
                  generation == admittedGeneration,
                  !Task.isCancelled else {
                return .inactive(phase == .closed ? .closed : .captureCancelled)
            }
            guard let admission = mutationControl.issueAdmission() else {
                return .inactive(.captureCancelled)
            }
            do {
                let disposition = try await ledger.tombstone(
                    selection: selection,
                    reason: reason,
                    expectedRetentionPolicyDigest: configuration.scope.retentionPolicyDigest,
                    admission: admission
                )
                guard phase == .running,
                      generation == admittedGeneration,
                      !Task.isCancelled else {
                    return .inactive(phase == .closed ? .closed : .captureCancelled)
                }
                return .completed(disposition)
            } catch let error as IncidentLedgerErrorV1 {
                switch await handleActionError(error, ledger: ledger) {
                case .unavailable(let reason): return .unavailable(reason)
                case .refused(let reason): return .refused(reason)
                case .inactive(let reason): return .inactive(reason)
                }
            } catch is CancellationError {
                return .inactive(.captureCancelled)
            } catch {
                await discardTransientLedger(ledger)
                return .unavailable(.storageUnavailable)
            }
        case .unavailable(let reason):
            return .unavailable(reason)
        case .refused(let reason):
            return .refused(reason)
        case .inactive(let reason):
            return .inactive(reason)
        }
    }

    func sweepRetentionReviewDue(
        batchSize: Int,
        continuation: IncidentRetentionSweepContinuationV1? = nil
    ) async -> IncidentHistoryCoordinatorRetentionSweepResultV1 {
        if let uncertainty = Self.closureUncertainty(refusalReason) {
            return .unavailable(uncertainty)
        }
        guard let configuration else { return .refused(.configurationInvalid) }
        let admittedGeneration = generation
        let access = await ledgerForExistingUse()
        if let uncertainty = Self.closureUncertainty(refusalReason) {
            return .unavailable(uncertainty)
        }
        switch access {
        case .opened(let ledger):
            guard phase == .running,
                  generation == admittedGeneration,
                  !Task.isCancelled else {
                switch phase {
                case .running:
                    return .inactive(.captureCancelled)
                case .suspending:
                    return .inactive(.modeInactive)
                case .quarantined:
                    let reason = refusalReason ?? .integrityRefused
                    return Self.closureUncertainty(reason) == nil
                        ? .refused(reason)
                        : .unavailable(reason)
                case .shuttingDown:
                    return .inactive(.shuttingDown)
                case .closed:
                    return .inactive(.closed)
                }
            }
            guard let admission = mutationControl.issueAdmission() else {
                return .inactive(.captureCancelled)
            }
            do {
                let page = try await ledger.sweepRetentionReviewDue(
                    expectedRetentionPolicyDigest: configuration.scope.retentionPolicyDigest,
                    batchSize: batchSize,
                    continuation: continuation,
                    admission: admission
                )

                if let uncertainty = Self.closureUncertainty(refusalReason) {
                    return .completedHistoryUnavailable(page: page, reason: uncertainty)
                }
                guard phase == .running,
                      generation == admittedGeneration,
                      !Task.isCancelled else {
                    switch phase {
                    case .running:
                        return .completedHistoryUnavailable(
                            page: page,
                            reason: .captureCancelled
                        )
                    case .suspending:
                        return .completedHistoryUnavailable(
                            page: page,
                            reason: .modeInactive
                        )
                    case .quarantined:
                        let reason = refusalReason ?? .integrityRefused
                        return Self.closureUncertainty(reason) == nil
                            ? .completedHistoryRefused(page: page, reason: reason)
                            : .completedHistoryUnavailable(page: page, reason: reason)
                    case .shuttingDown:
                        return .completedHistoryUnavailable(
                            page: page,
                            reason: .shuttingDown
                        )
                    case .closed:
                        return .completedHistoryUnavailable(page: page, reason: .closed)
                    }
                }

                do {
                    let history = try await ledger.list()
                    if let uncertainty = Self.closureUncertainty(refusalReason) {
                        return .completedHistoryUnavailable(page: page, reason: uncertainty)
                    }
                    guard phase == .running,
                          generation == admittedGeneration,
                          !Task.isCancelled else {
                        switch phase {
                        case .running:
                            return .completedHistoryUnavailable(
                                page: page,
                                reason: .captureCancelled
                            )
                        case .suspending:
                            return .completedHistoryUnavailable(
                                page: page,
                                reason: .modeInactive
                            )
                        case .quarantined:
                            let reason = refusalReason ?? .integrityRefused
                            return Self.closureUncertainty(reason) == nil
                                ? .completedHistoryRefused(page: page, reason: reason)
                                : .completedHistoryUnavailable(page: page, reason: reason)
                        case .shuttingDown:
                            return .completedHistoryUnavailable(
                                page: page,
                                reason: .shuttingDown
                            )
                        case .closed:
                            return .completedHistoryUnavailable(page: page, reason: .closed)
                        }
                    }
                    return .completed(page: page, history: history)
                } catch let error as IncidentLedgerErrorV1 {
                    let failure = await handleActionError(error, ledger: ledger)
                    if let uncertainty = Self.closureUncertainty(refusalReason) {
                        return .completedHistoryUnavailable(page: page, reason: uncertainty)
                    }
                    switch failure {
                    case .unavailable(let reason):
                        return .completedHistoryUnavailable(page: page, reason: reason)
                    case .refused(let reason):
                        return .completedHistoryRefused(page: page, reason: reason)
                    case .inactive(let reason):
                        return .completedHistoryUnavailable(page: page, reason: reason)
                    }
                } catch is CancellationError {
                    if let uncertainty = Self.closureUncertainty(refusalReason) {
                        return .completedHistoryUnavailable(page: page, reason: uncertainty)
                    }
                    return .completedHistoryUnavailable(
                        page: page,
                        reason: .captureCancelled
                    )
                } catch {
                    await discardTransientLedger(ledger)
                    return .completedHistoryUnavailable(
                        page: page,
                        reason: Self.closureUncertainty(refusalReason)
                            ?? .storageUnavailable
                    )
                }
            } catch let error as IncidentLedgerErrorV1 {
                let failure = await handleActionError(error, ledger: ledger)
                if let uncertainty = Self.closureUncertainty(refusalReason) {
                    return .unavailable(uncertainty)
                }
                switch failure {
                case .unavailable(let reason): return .unavailable(reason)
                case .refused(let reason): return .refused(reason)
                case .inactive(let reason): return .inactive(reason)
                }
            } catch is CancellationError {
                if let uncertainty = Self.closureUncertainty(refusalReason) {
                    return .unavailable(uncertainty)
                }
                return .inactive(.captureCancelled)
            } catch {
                await discardTransientLedger(ledger)
                return .unavailable(
                    Self.closureUncertainty(refusalReason) ?? .storageUnavailable
                )
            }
        case .unavailable(let reason):
            return .unavailable(reason)
        case .refused(let reason):
            return .refused(reason)
        case .inactive(let reason):
            return .inactive(reason)
        }
    }

    func redactedExport(
        selection: IncidentSelectionV1
    ) async -> IncidentHistoryCoordinatorExportResultV1 {
        switch await ledgerForExistingUse() {
        case .opened(let ledger):
            do {
                return .available(try await ledger.redactedExport(selection: selection))
            } catch let error as IncidentLedgerErrorV1 {
                switch await handleActionError(error, ledger: ledger) {
                case .unavailable(let reason): return .unavailable(reason)
                case .refused(let reason): return .refused(reason)
                case .inactive(let reason): return .inactive(reason)
                }
            } catch {
                await discardTransientLedger(ledger)
                return .unavailable(.storageUnavailable)
            }
        case .unavailable(let reason):
            return .unavailable(reason)
        case .refused(let reason):
            return .refused(reason)
        case .inactive(let reason):
            return .inactive(reason)
        }
    }

    /// Closes current or still-opening storage without granting future authority.
    /// This is reversible only while the coordinator remains in its running phase.
    func suspend() async -> IncidentHistoryCoordinatorCloseResultV1 {
        guard phase == .running else {
            if let uncertainty = Self.closureUncertainty(refusalReason) {
                return .uncertain(uncertainty)
            }
            return .closed
        }
        phase = .suspending
        advanceGeneration()
        let pendingOpen = opening
        opening = nil
        pendingOpen?.task.cancel()
        let installedLedger = ledger
        ledger = nil

        var uncertainty: IncidentHistoryCoordinatorReasonV1?
        if let installedLedger {
            if await Self.boundedClose(
                installedLedger,
                timeout: storageOperationTimeout
            ) != .closed {
                uncertainty = .closeUncertain
            }
        }
        if let pendingOpen {
            switch await pendingOpen.task.value {
            case .opened(let opened):
                if await Self.boundedClose(
                    opened,
                    timeout: storageOperationTimeout
                ) != .closed {
                    uncertainty = .closeUncertain
                }
            case .failed(.openUncertain):
                if uncertainty == nil { uncertainty = .openUncertain }
            case .failed:
                break
            }
        }
        if let uncertainty {
            phase = .quarantined
            refusalReason = uncertainty
            return .uncertain(uncertainty)
        }
        phase = .running
        return .closed
    }

    /// Terminal. No later call can reopen the ledger.
    func shutdown() async -> IncidentHistoryCoordinatorCloseResultV1 {
        while phase == .suspending {
            await Task.yield()
        }
        switch phase {
        case .closed:
            return Self.closureUncertainty(refusalReason)
                .map(IncidentHistoryCoordinatorCloseResultV1.uncertain) ?? .closed
        case .shuttingDown:
            while phase == .shuttingDown {
                await Task.yield()
            }
            return Self.closureUncertainty(refusalReason)
                .map(IncidentHistoryCoordinatorCloseResultV1.uncertain) ?? .closed
        case .running, .quarantined:
            phase = .shuttingDown
        case .suspending:
            preconditionFailure("Suspend wait must settle before shutdown transition.")
        }
        advanceGeneration()
        let pendingOpen = opening
        opening = nil
        pendingOpen?.task.cancel()
        let installedLedger = ledger
        ledger = nil

        var uncertainty = Self.closureUncertainty(refusalReason)
        if let installedLedger {
            if await Self.boundedClose(
                installedLedger,
                timeout: storageOperationTimeout
            ) != .closed {
                uncertainty = .closeUncertain
            }
        }
        if let pendingOpen {
            switch await pendingOpen.task.value {
            case .opened(let opened):
                if await Self.boundedClose(
                    opened,
                    timeout: storageOperationTimeout
                ) != .closed {
                    uncertainty = .closeUncertain
                }
            case .failed(.openUncertain):
                if uncertainty == nil { uncertainty = .openUncertain }
            case .failed:
                break
            }
        }
        if let uncertainty { refusalReason = uncertainty }
        phase = .closed
        return uncertainty.map(IncidentHistoryCoordinatorCloseResultV1.uncertain) ?? .closed
    }

    private func ledgerForUse() async -> LedgerAccess {
        switch phase {
        case .running:
            break
        case .quarantined:
            let reason = refusalReason ?? .integrityRefused
            return Self.closureUncertainty(reason) == nil
                ? .refused(reason)
                : .unavailable(reason)
        case .suspending:
            return .inactive(.modeInactive)
        case .shuttingDown:
            return .inactive(.shuttingDown)
        case .closed:
            return .inactive(.closed)
        }
        guard let configuration else {
            phase = .quarantined
            refusalReason = .configurationInvalid
            advanceGeneration()
            return .refused(.configurationInvalid)
        }
        if let ledger { return .opened(ledger) }

        let admittedGeneration = generation
        let activeOpening: Opening
        if let opening {
            activeOpening = opening
        } else {
            let id = UUID()
            let opener = self.opener
            let rawTask = Task.detached(priority: .utility) {
                do {
                    let preparedRoot = try Self.prepareRoot(configuration)
                    let databaseURL = preparedRoot
                        .appendingPathComponent("projects", isDirectory: true)
                        .appendingPathComponent(configuration.scope.projectDigest, isDirectory: true)
                        .appendingPathComponent("incident-ledger-v1.sqlite3")
                    let storeExistedBeforeOpen = Self.lstatStatus(databaseURL) != nil
                    let opened: LocalIncidentLedgerV1
                    do {
                        opened = try await opener(preparedRoot, configuration.scope)
                    } catch let error as IncidentLedgerErrorV1 {
                        if case .sqlite = error, storeExistedBeforeOpen {
                            return OpenResult.failed(.integrityRefused)
                        }
                        throw error
                    }
                    _ = try await opened.verifyIntegrity()
                    return OpenResult.opened(opened)
                } catch let error as IncidentLedgerErrorV1 {
                    switch error {
                    case .integrity, .namespaceObservation, .observationConflict, .incidentIDConflict,
                         .subjectMismatch, .selectionMismatch, .incidentTombstoned,
                         .tombstoneConflict, .retentionNotDue,
                         .retentionDeadlineMissing, .retentionPolicyMismatch,
                         .exportEncodingFailed:
                        return .failed(.integrityRefused)
                    case .invalidInput:
                        return .failed(.configurationInvalid)
                    case .unsupportedStorage, .closed, .sqlite,
                         .admissionRevoked, .incidentNotFound, .capacityExceeded:
                        return .failed(.unavailable)
                    }
                } catch {
                    return .failed(.unavailable)
                }
            }
            let timeout = storageOperationTimeout
            let lateOpenCleanupObserver = self.lateOpenCleanupObserver
            let task = Task.detached(priority: .utility) {
                switch await Self.boundedOpen(
                    rawTask,
                    timeout: timeout,
                    lateOpenCleanupObserver: lateOpenCleanupObserver
                ) {
                case .completed(let result):
                    return result
                case .timedOut:
                    return .failed(.openUncertain)
                }
            }
            activeOpening = Opening(id: id, generation: admittedGeneration, task: task)
            opening = activeOpening
        }

        let openResult = await activeOpening.task.value
        guard phase == .running,
              generation == activeOpening.generation else {
            return .inactive(phase == .closed ? .closed : .modeInactive)
        }
        if let ledger { return .opened(ledger) }
        guard opening?.id == activeOpening.id else { return .inactive(.modeInactive) }
        opening = nil

        switch openResult {
        case .opened(let opened):
            ledger = opened
            return .opened(opened)
        case .failed(.unavailable):
            return .unavailable(.storageUnavailable)
        case .failed(.configurationInvalid):
            phase = .quarantined
            refusalReason = .configurationInvalid
            advanceGeneration()
            return .refused(.configurationInvalid)
        case .failed(.integrityRefused):
            phase = .quarantined
            refusalReason = .integrityRefused
            advanceGeneration()
            return .refused(.integrityRefused)
        case .failed(.openUncertain):
            phase = .quarantined
            refusalReason = .openUncertain
            advanceGeneration()
            return .unavailable(.openUncertain)
        }
    }

    /// Read/delete/export actions never create an empty history store as a hidden
    /// side effect. Capture is the only path allowed to create the private store.
    private func ledgerForExistingUse() async -> LedgerAccess {
        switch phase {
        case .running:
            break
        case .quarantined:
            let reason = refusalReason ?? .integrityRefused
            return Self.closureUncertainty(reason) == nil
                ? .refused(reason)
                : .unavailable(reason)
        case .suspending:
            return .inactive(.modeInactive)
        case .shuttingDown:
            return .inactive(.shuttingDown)
        case .closed:
            return .inactive(.closed)
        }
        if let ledger { return .opened(ledger) }
        guard let configuration else { return .refused(.configurationInvalid) }
        let databaseURL = configuration.rootDirectory
            .appendingPathComponent("projects", isDirectory: true)
            .appendingPathComponent(configuration.scope.projectDigest, isDirectory: true)
            .appendingPathComponent("incident-ledger-v1.sqlite3")
        guard Self.lstatStatus(databaseURL) != nil else {
            return .unavailable(.historyNotFound)
        }
        return await ledgerForUse()
    }

    private func handleActionError(
        _ error: IncidentLedgerErrorV1,
        ledger affectedLedger: LocalIncidentLedgerV1
    ) async -> ActionFailure {
        switch error {
        case .integrity, .namespaceObservation, .observationConflict, .incidentIDConflict:
            await quarantine(affectedLedger)
            return .refused(.integrityRefused)
        case .invalidInput:
            return .refused(.configurationInvalid)
        case .unsupportedStorage, .closed, .sqlite:
            await discardTransientLedger(affectedLedger)
            return .unavailable(.storageUnavailable)
        case .admissionRevoked:
            return .inactive(.captureCancelled)
        case .incidentNotFound:
            return .refused(.incidentNotFound)
        case .subjectMismatch, .selectionMismatch:
            return .refused(.selectionMismatch)
        case .incidentTombstoned:
            return .refused(.incidentTombstoned)
        case .tombstoneConflict:
            return .refused(.tombstoneConflict)
        case .retentionNotDue:
            return .refused(.retentionNotDue)
        case .retentionDeadlineMissing:
            return .refused(.retentionDeadlineMissing)
        case .retentionPolicyMismatch:
            return .refused(.retentionPolicyMismatch)
        case .exportEncodingFailed:
            return .refused(.exportEncodingFailed)
        case .capacityExceeded:
            return .refused(.capacityExceeded)
        }
    }

    private func quarantine(_ affectedLedger: LocalIncidentLedgerV1) async {
        guard phase == .running else { return }
        phase = .quarantined
        refusalReason = .integrityRefused
        advanceGeneration()
        if let installed = ledger, installed === affectedLedger { ledger = nil }
        _ = await Self.boundedClose(affectedLedger, timeout: storageOperationTimeout)
    }

    private func discardTransientLedger(_ affectedLedger: LocalIncidentLedgerV1) async {
        if let installed = ledger, installed === affectedLedger { ledger = nil }
        if await Self.boundedClose(
            affectedLedger,
            timeout: storageOperationTimeout
        ) != .closed {
            phase = .quarantined
            refusalReason = .closeUncertain
            advanceGeneration()
        }
    }

    private func advanceGeneration() {
        mutationControl.invalidatePendingMutations()
        guard generation < .max else {
            phase = .quarantined
            return
        }
        generation += 1
    }

    private nonisolated static func closureUncertainty(
        _ reason: IncidentHistoryCoordinatorReasonV1?
    ) -> IncidentHistoryCoordinatorReasonV1? {
        switch reason {
        case .openUncertain, .closeUncertain:
            return reason
        default:
            return nil
        }
    }

    private nonisolated static func prepareRoot(
        _ configuration: IncidentHistoryConfigurationV1
    ) throws -> URL {
        guard configuration.rootDirectory.isFileURL else {
            throw IncidentLedgerErrorV1.invalidInput("History root must be a local file URL.")
        }
        switch configuration.rootPreparation {
        case .requireExisting:
            try requirePrivateDirectory(configuration.rootDirectory, harden: false)
            return configuration.rootDirectory

        case .createPrivateChildren(let anchor, let names):
            guard anchor.isFileURL,
                  !names.isEmpty,
                  names.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && !$0.contains("/") })
            else {
                throw IncidentLedgerErrorV1.invalidInput("Invalid private history root policy.")
            }
            try requirePrivateDirectory(anchor, harden: false)
            var current = anchor
            for name in names {
                current.appendPathComponent(name, isDirectory: true)
                if lstatStatus(current) == nil {
                    try FileManager.default.createDirectory(
                        at: current,
                        withIntermediateDirectories: false,
                        attributes: [.posixPermissions: NSNumber(value: 0o700)]
                    )
                }
                try requirePrivateDirectory(current, harden: true)
            }
            guard current.standardizedFileURL == configuration.rootDirectory.standardizedFileURL else {
                throw IncidentLedgerErrorV1.invalidInput("History root does not match its fixed policy.")
            }
            return current
        }
    }

    private nonisolated static func requirePrivateDirectory(
        _ url: URL,
        harden: Bool
    ) throws {
        guard let status = lstatStatus(url),
              (status.st_mode & S_IFMT) == S_IFDIR,
              (status.st_mode & S_IFMT) != S_IFLNK else {
            throw IncidentLedgerErrorV1.unsupportedStorage
        }
        if harden, chmod(url.path, mode_t(0o700)) != 0 {
            throw IncidentLedgerErrorV1.unsupportedStorage
        }
    }

    private nonisolated static func lstatStatus(_ url: URL) -> stat? {
        var status = stat()
        return url.withUnsafeFileSystemRepresentation { path in
            guard let path, lstat(path, &status) == 0 else { return nil }
            return status
        }
    }

    private nonisolated static func boundedOpen(
        _ task: Task<OpenResult, Never>,
        timeout: Duration,
        lateOpenCleanupObserver: IncidentLateOpenCleanupObserverV1?
    ) async -> BoundedOpenResult {
        let claim = RaceClaim()
        return await withCheckedContinuation { continuation in
            Task {
                let result = await task.value
                if claim.claim() {
                    continuation.resume(returning: .completed(result))
                } else if case .opened(let opened) = result {
                    let closeResult = await boundedClose(opened, timeout: timeout)
                    let observedResult: IncidentLateOpenCleanupResultV1
                    switch closeResult {
                    case .closed: observedResult = .closed
                    case .failed: observedResult = .failed
                    case .timedOut: observedResult = .timedOut
                    }
                    await lateOpenCleanupObserver?(opened.databaseURL, observedResult)
                }
            }
            Task {
                try? await Task.sleep(for: timeout)
                if claim.claim() {
                    continuation.resume(returning: .timedOut)
                }
            }
        }
    }

    private nonisolated static func boundedClose(
        _ ledger: LocalIncidentLedgerV1,
        timeout: Duration
    ) async -> BoundedCloseResult {
        let closeTask = Task {
            do {
                try await ledger.close()
                return true
            } catch {
                return false
            }
        }
        let claim = RaceClaim()
        return await withCheckedContinuation { continuation in
            Task {
                let closed = await closeTask.value
                if claim.claim() {
                    continuation.resume(returning: closed ? .closed : .failed)
                }
            }
            Task {
                try? await Task.sleep(for: timeout)
                if claim.claim() {
                    continuation.resume(returning: .timedOut)
                }
            }
        }
    }
}
