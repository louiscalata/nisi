import Foundation
import Observation
import VeritasAppleFoundation
import VeritasCore

typealias PrivateFileWriteOperationV1 = @Sendable (
    Data,
    String,
    URL,
    PrivateWriteAdmissionV1
) throws -> PrivateVerifiedWriteReceiptV1

typealias IncidentRetentionPageReturnObserverV1 = @Sendable (
    IncidentRetentionSweepPageV1
) async -> Void

enum IncidentActionExecutionKindV1: Equatable, Sendable {
    case inspect
    case explain
    case tombstone
    case redactedExport
    case retentionReview
}

typealias IncidentActionExecutionObserverV1 = @Sendable (
    IncidentActionExecutionKindV1
) -> Void

enum EffectiveAppState: String, Equatable {
    case off = "OFF"
    case starting = "STARTING"
    case assistReady = "ASSIST READY"
    case enforceReady = "ENFORCE READY"
    case degraded = "DEGRADED"
    case blocked = "BLOCKED"
    case stoppingUncertain = "STOPPING UNCERTAIN"
}

enum IncidentRetentionReviewStopV1: Equatable, Sendable {
    case running
    case exhausted
    case ceilingReached
    case interrupted(IncidentHistoryCoordinatorReasonV1)
    case invalidAggregation
}

struct IncidentRetentionReviewStateV1: Equatable, Sendable {
    let pageCount: Int
    let processedObservationCount: Int
    let appendedTombstoneCount: Int
    let replayedTombstoneCount: Int
    let workRemaining: Bool
    let stop: IncidentRetentionReviewStopV1

    var inFlight: Bool { stop == .running }

    var reason: IncidentHistoryCoordinatorReasonV1? {
        guard case .interrupted(let reason) = stop else { return nil }
        return reason
    }

    static let runningEmpty = IncidentRetentionReviewStateV1(
        pageCount: 0,
        processedObservationCount: 0,
        appendedTombstoneCount: 0,
        replayedTombstoneCount: 0,
        workRemaining: false,
        stop: .running
    )
}

@MainActor
@Observable
final class AppModel {
    enum ReferenceRunState: String { case unavailable, idle, running, stopping, completed, refused }
    // Deliberately no production admission issuer until native/runtime gates pass.
    // This same-process identity is not authenticated human consent.
    fileprivate final class ReferenceAdmission {}
    /// UI carries this exact object back, never reconstructs consent from fields.
    final class ReferenceRunReview: Identifiable {
        let id = UUID()
        let descriptor: ReferenceArtifactShadowRunOwner.ReviewDescriptor
        let expiresAt: ContinuousClock.Instant
        fileprivate let lease: ReferenceArtifactShadowRunOwner.HostLease
        fileprivate let admission: ReferenceAdmission
        fileprivate init(descriptor: ReferenceArtifactShadowRunOwner.ReviewDescriptor,
                         lease: ReferenceArtifactShadowRunOwner.HostLease, admission: ReferenceAdmission,
                         expiresAt: ContinuousClock.Instant) {
            self.descriptor = descriptor; self.lease = lease; self.admission = admission; self.expiresAt = expiresAt
        }
    }
    private(set) var referenceRunReview: ReferenceRunReview?
    private var referenceAdmission: ReferenceAdmission?
    private var referenceRunOwner: ReferenceArtifactShadowRunOwner?
    private var referenceRunTask: Task<Void, Never>?
    private var referenceRunTaskID: UUID?
    private(set) var referenceRunState: ReferenceRunState = .unavailable
    private(set) var referenceRunDelivery: ReferenceArtifactShadowRunOwner.Delivery?
    private(set) var referenceRunFailure: ReferenceArtifactShadowRunOwner.Failure?

#if DEBUG
    private(set) var referenceQuiescenceChecksForTesting = 0
    private(set) var referenceShutdownJoinChecksForTesting = 0
    private var referenceBeforePublication: (@MainActor () async -> Void)?
    private var referenceReviewClockForTesting: (@MainActor () -> ContinuousClock.Instant)?
    static func forReferenceRunTests(
        owner: ReferenceArtifactShadowRunOwner,
        analyzer: any AdvisoryOrchestrator = DeterministicOnlyOrchestrator(),
        platformAdmission: PlatformAdmission = PlatformRequirements.currentAdmission(),
        beforePublication: (@MainActor () async -> Void)? = nil,
        reviewClock: (@MainActor () -> ContinuousClock.Instant)? = nil
    ) -> AppModel {
        let model = AppModel(analyzer: analyzer, platformAdmission: platformAdmission,
                             incidentHistoryConfiguration: nil)
        model.referenceAdmission = ReferenceAdmission()
        model.referenceRunOwner = owner
        model.referenceBeforePublication = beforePublication
        model.referenceReviewClockForTesting = reviewClock
        model.referenceRunState = .idle
        return model
    }
    func revokeReferenceAdmissionForTesting() {
        referenceAdmission = nil
        advanceAdmissionEpoch()
    }
    var referenceTaskRetainedForTesting: Bool { referenceRunTask != nil }
#endif

    private static let incidentRetentionReviewPageSize = 25
    private static let maximumIncidentRetentionReviewPages = 4
    private static let maximumIncidentRetentionReviewObservations = 100

    private enum LifecyclePhase {
        case running
        case shuttingDown
        case closed
    }

    private enum SnapshotSelectionFailure: Error, LocalizedError {
        case identityChanged

        var errorDescription: String? {
            "SNAPSHOT_IDENTITY_CHANGED: The snapshot bytes changed before selection. Choose the artifact again."
        }
    }

    private(set) var desiredMode: VeritasMode = .off
    var effectiveState: EffectiveAppState = .off
    private(set) var selectedSnapshot: ArtifactSnapshot?
    var result: PipelineResult?
    var currentness: AcceptanceCurrentness = .none
    var lastError: String?

    private(set) var incidentHistoryAvailability: IncidentHistoryAvailabilityV1 = .disabled
    private(set) var incidentHistoryReason: IncidentHistoryCoordinatorReasonV1? = .userDisabled
    private(set) var incidentHistory: [IncidentSummaryV1] = []
    private(set) var incidentCaptureOutcome: PipelineIncidentCaptureOutcomeV1?
    private(set) var incidentCaptureInFlight = false
    private(set) var inspectedIncident: IncidentViewV1?
    private(set) var incidentExplanation: IncidentExplanationV1?
#if DEBUG
    var beforeIncidentExplanationDeliveryForTesting: (@MainActor () async -> Void)?
#endif
    private(set) var preparedIncidentExport: IncidentRedactedExportV1?
    private(set) var incidentActionInFlight = false
    private(set) var incidentActionReason: IncidentHistoryCoordinatorReasonV1?
    private(set) var incidentRetentionReviewState: IncidentRetentionReviewStateV1?
    private(set) var lastFileExportReceipt: PrivateVerifiedWriteReceiptV1?
    private(set) var fileExportInFlight = false

    private let snapshotter = ArtifactSnapshotter()
    private var profile: CheckProfile
    private let pipeline: VeritasPipeline
    private let ledger = PrototypeAcceptanceLedger()
    private let platformAdmission: PlatformAdmission
    private let incidentCaptureControl: PipelineIncidentCaptureControlV1
    private let incidentMutationControl: IncidentLifecycleMutationControlV1
    private let incidentHistoryCoordinator: IncidentHistoryCoordinatorV1
    private let privateWriteAdmissionControl = PrivateWriteAdmissionControlV1()
    private let privateFileWriter: PrivateFileWriteOperationV1
    private let incidentRetentionPageReturnObserver: IncidentRetentionPageReturnObserverV1
    private let incidentActionExecutionObserver: IncidentActionExecutionObserverV1

    private var lifecyclePhase: LifecyclePhase = .running
    private var admissionEpoch: UInt64 = 0
    private var analysisTask: Task<Void, Never>?
    private var analysisTaskID: UUID?
    private var acceptanceTask: Task<Void, Never>?
    private var acceptanceTaskID: UUID?
    private var acceptanceMutationSequence: UInt64 = 0
    private var quiescenceTask: Task<Void, Never>?
    private var quiescenceTaskID: UUID?
    private var incidentCaptureTask: Task<Void, Never>?
    private var incidentCaptureTaskID: UUID?
    private var incidentRefreshTask: Task<Void, Never>?
    private var incidentRefreshTaskID: UUID?
    private var incidentLifecycleTask: Task<Void, Never>?
    private var incidentLifecycleTaskID: UUID?
    private var incidentActionTask: Task<Void, Never>?
    private var incidentActionTaskID: UUID?
    private var incidentRetentionReviewOwnerTaskID: UUID?
    private var fileExportTask: Task<Void, Never>?
    private var fileExportTaskID: UUID?
    private var retiredTasks: [Task<Void, Never>] = []
    private var retiredIncidentTasks: [Task<Void, Never>] = []

    init(
        analyzer: (any AdvisoryOrchestrator)? = nil,
        platformAdmission: PlatformAdmission = PlatformRequirements.currentAdmission(),
        profile: CheckProfile = .prototype,
        incidentHistoryConfiguration: IncidentHistoryConfigurationV1? = .founderAlphaDefault(),
        incidentStorageOperationTimeout: Duration = .seconds(3),
        incidentLedgerOpener: @escaping IncidentLedgerOpenerV1 = { root, scope in
            try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        },
        incidentLateOpenCleanupObserver: IncidentLateOpenCleanupObserverV1? = nil,
        incidentMutationControl: IncidentLifecycleMutationControlV1 = .init(),
        privateFileWriter: @escaping PrivateFileWriteOperationV1 = {
            bytes, digest, destination, admission in
            try PrivateVerifiedFileWriterV1.writeNew(
                bytes: bytes,
                expectedDigest: digest,
                to: destination,
                admission: admission
            )
        },
        incidentRetentionPageReturnObserver: @escaping IncidentRetentionPageReturnObserverV1 = {
            _ in
        },
        incidentActionExecutionObserver: @escaping IncidentActionExecutionObserverV1 = {
            _ in
        }
    ) {
        self.platformAdmission = platformAdmission
        self.profile = profile
        pipeline = VeritasPipeline(
            analyzer: analyzer ?? AppleFoundationOrchestratorFactory.make()
        )
        let control = PipelineIncidentCaptureControlV1(enabled: false)
        incidentCaptureControl = control
        self.incidentMutationControl = incidentMutationControl
        incidentHistoryCoordinator = IncidentHistoryCoordinatorV1(
            configuration: incidentHistoryConfiguration,
            adapter: PipelineIncidentAdapterV1(control: control),
            storageOperationTimeout: incidentStorageOperationTimeout,
            opener: incidentLedgerOpener,
            lateOpenCleanupObserver: incidentLateOpenCleanupObserver,
            mutationControl: incidentMutationControl
        )
        self.privateFileWriter = privateFileWriter
        self.incidentRetentionPageReturnObserver = incidentRetentionPageReturnObserver
        self.incidentActionExecutionObserver = incidentActionExecutionObserver
    }

    /// The identifier of the check profile in effect, for the shell's E13
    /// "selected mode and profile" truth. Read-only; profile changes stay
    /// behind `setProfile`.
    var activeProfileID: String { profile.id }

    var referenceRunUnavailableReason: String? {
        guard lifecyclePhase == .running else { return "App shutdown is in progress or complete." }
        guard referenceRunTask == nil else { return "The previous reference run must finish and join first." }
        guard referenceAdmission != nil, referenceRunOwner != nil else {
            return "Unavailable: native reference-run admission is not complete. No model will run."
        }
        guard platformAdmission.allowed else { return platformAdmission.userMessage }
        guard desiredMode == .assist else { return "Reference runs require ASSIST mode." }
        guard selectedSnapshot != nil else { return "Select an exact artifact first." }
        return nil
    }

    var canRunReferenceModel: Bool { referenceRunUnavailableReason == nil }

    private func referenceReviewNow() -> ContinuousClock.Instant {
#if DEBUG
        if let referenceReviewClockForTesting { return referenceReviewClockForTesting() }
#endif
        return ContinuousClock().now
    }

    /// Stage exact owned input and immutable display facts, but no consent/task.
    /// Repeated preparation deliberately replaces a pending review with a new lease.
    @discardableResult
    func prepareReferenceRunReview() -> Bool {
        guard canRunReferenceModel, let admission = referenceAdmission,
              let owner = referenceRunOwner, let snapshot = selectedSnapshot else { return false }
        referenceRunReview = nil
        do {
            let lease = try owner.bindSelection(snapshot, profile: profile, hostEpoch: admissionEpoch)
            let descriptor = try owner.reviewDescriptor(for: lease)
            referenceRunReview = ReferenceRunReview(descriptor: descriptor, lease: lease, admission: admission,
                expiresAt: referenceReviewNow().advanced(by: .seconds(60)))
            referenceRunFailure = nil
            return true
        } catch {
            owner.invalidate()
            referenceRunFailure = (error as? ReferenceArtifactShadowRunOwner.Failure) ?? .internalFailure
            referenceRunState = .refused
            return false
        }
    }

    func cancelReferenceRunReview(_ review: ReferenceRunReview) {
        guard referenceRunReview === review else { return } // Old sheet must be inert.
        referenceRunReview = nil
        referenceRunOwner?.invalidate()
    }

    /// Only exact current confirmation can mint consent. No one-step bypass.
    /// Expiry is checked on action; an idle expired sheet may remain until dismissal.
    @discardableResult
    func confirmReferenceRunReview(_ review: ReferenceRunReview) -> Bool {
        guard referenceRunReview === review else { return false }
        referenceRunReview = nil // Consume before validation, authorization or task creation.
        guard canRunReferenceModel, let admission = referenceAdmission,
              admission === review.admission, let owner = referenceRunOwner,
              let snapshot = selectedSnapshot,
              admissionEpoch == review.descriptor.hostEpoch,
              snapshot.kind == review.descriptor.artifactKind,
              snapshot.subjectDigest == review.descriptor.subjectSHA256,
              profile.id == review.descriptor.profileID,
              profile.rulesFingerprint == review.descriptor.profileSHA256 else {
            referenceRunOwner?.invalidate(); return false
        }
        guard referenceReviewNow() < review.expiresAt else {
            owner.invalidate(); referenceRunFailure = .expired; referenceRunState = .refused; return false
        }
        let epoch = admissionEpoch, activeProfile = profile, taskID = UUID()
        let deadline = ContinuousClock().now.advanced(by: .milliseconds(900))
        do {
            let consent = try owner.authorizeLocalReferenceOnce(review.lease, deadline: deadline)
            let ticket = try owner.begin(consent)
            referenceRunDelivery = nil; referenceRunFailure = nil
            referenceRunState = .running; referenceRunTaskID = taskID
            // Strong ownership is intentional until join. No early cancellation
            // return: begin() already created work even if this task hasn't started.
            referenceRunTask = Task { [self, owner] in
                let outcome: Result<ReferenceArtifactShadowRunOwner.Delivery, Error>
                do { outcome = .success(try await owner.result(for: ticket)) }
                catch { outcome = .failure(error) }
                await owner.revokeAndJoin()
#if DEBUG
                if let referenceBeforePublication { await referenceBeforePublication() }
#endif
                guard referenceRunTaskID == taskID else { return }
                referenceRunTask = nil; referenceRunTaskID = nil
                guard lifecyclePhase == .running, referenceAdmission === admission,
                      epoch == admissionEpoch, desiredMode == .assist,
                      selectedSnapshot?.kind == snapshot.kind,
                      selectedSnapshot?.subjectDigest == snapshot.subjectDigest,
                      profile.id == activeProfile.id,
                      profile.rulesFingerprint == activeProfile.rulesFingerprint,
                      !Task.isCancelled else {
                    referenceRunState = referenceAdmission == nil ? .unavailable : .idle
                    return
                }
                guard ContinuousClock().now < deadline else {
                    referenceRunState = .refused; referenceRunFailure = .expired
                    return
                }
                switch outcome {
                case .success(let delivery):
                    referenceRunDelivery = delivery; referenceRunState = .completed
                case .failure(let error):
                    referenceRunFailure = (error as? ReferenceArtifactShadowRunOwner.Failure) ?? .internalFailure
                    referenceRunState = .refused
                }
            }
            return true
        } catch {
            // There is no run ticket on this path; revoke any partially minted consent.
            owner.invalidate()
            referenceRunDelivery = nil
            referenceRunFailure = (error as? ReferenceArtifactShadowRunOwner.Failure) ?? .internalFailure
            referenceRunState = .refused
            return false
        }
    }

    private func invalidateReferenceRun() {
        referenceRunReview = nil
        referenceRunOwner?.invalidate() // Synchronous invalidation precedes cancellation.
        referenceRunDelivery = nil; referenceRunFailure = nil
        referenceRunTask?.cancel()
        // Keep the ONE handle until the task completes owner.revokeAndJoin().
        // Never append reference work to an unbounded retired-task array.
        referenceRunState = referenceRunTask != nil ? .stopping
            : (referenceAdmission == nil ? .unavailable : .idle)
    }

    var digestLabel: String {
        guard let digest = selectedSnapshot?.subjectDigest else { return "No exact subject" }
        return "sha256:\(digest.prefix(16))…"
    }

    var incidentCaptureEnabled: Bool {
        incidentCaptureControl.isEnabled
    }

    func setIncidentCaptureEnabled(_ enabled: Bool) {
        guard lifecyclePhase == .running else { return }
        if !enabled || desiredMode != .assist {
            incidentMutationControl.invalidatePendingMutations()
            cancelIncidentAction(
                retentionReason: enabled ? .modeInactive : .userDisabled
            )
        }
        if enabled, desiredMode != .assist {
            incidentCaptureControl.invalidatePendingCaptures()
            incidentCaptureControl.setEnabled(false)
            incidentHistoryAvailability = .disabled
            incidentHistoryReason = .modeInactive
            return
        }
        incidentCaptureControl.invalidatePendingCaptures()
        cancelIncidentCapture()
        cancelIncidentRefresh()
        incidentCaptureControl.setEnabled(enabled)
        incidentCaptureOutcome = nil
        incidentCaptureInFlight = false
        if enabled {
            incidentHistoryAvailability = .armed
            incidentHistoryReason = nil
            if let snapshot = selectedSnapshot,
               let result,
               result.subjectDigest == snapshot.subjectDigest,
               result.profileFingerprint == profile.rulesFingerprint,
               result.mode == .assist {
                scheduleIncidentCaptureIfEligible(
                    snapshot: snapshot,
                    profile: profile,
                    mode: .assist,
                    result: result,
                    epoch: admissionEpoch
                )
            }
        } else {
            incidentHistoryAvailability = .disabled
            incidentHistoryReason = .userDisabled
            startIncidentSuspend()
        }
    }

    func refreshIncidentHistory() {
        guard lifecyclePhase == .running else { return }
        incidentMutationControl.invalidatePendingMutations()
        cancelIncidentAction(retentionReason: .captureCancelled)
        if incidentCaptureControl.isEnabled {
            incidentCaptureControl.invalidatePendingCaptures()
        }
        cancelIncidentCapture()
        cancelIncidentRefresh()
        let taskID = UUID()
        let epoch = admissionEpoch
        let priorLifecycle = incidentLifecycleTask
        let priorTasks = retiredIncidentTasks
        retiredIncidentTasks.removeAll()
        incidentRefreshTaskID = taskID
        incidentHistoryAvailability = .opening
        incidentHistoryReason = nil
        incidentRefreshTask = Task { [weak self] in
            guard let self else { return }
            for task in priorTasks { await task.value }
            if let priorLifecycle { await priorLifecycle.value }
            guard lifecyclePhase == .running,
                  epoch == admissionEpoch,
                  taskID == incidentRefreshTaskID,
                  !Task.isCancelled else {
                finishIncidentRefresh(taskID: taskID)
                return
            }
            let listing = await incidentHistoryCoordinator.list()
            guard lifecyclePhase == .running,
                  epoch == admissionEpoch,
                  taskID == incidentRefreshTaskID,
                  !Task.isCancelled else {
                finishIncidentRefresh(taskID: taskID)
                return
            }
            switch listing {
            case .available(let history):
                incidentHistory = history
                incidentHistoryAvailability = .available
                incidentHistoryReason = nil
            case .unavailable(let reason):
                incidentHistory = []
                incidentHistoryAvailability = .unavailable
                incidentHistoryReason = reason
            case .refused(let reason):
                incidentHistory = []
                incidentHistoryAvailability = .refused
                incidentHistoryReason = reason
            case .inactive(let reason):
                incidentHistoryAvailability = incidentCaptureControl.isEnabled ? .armed : .disabled
                incidentHistoryReason = reason
            }
            finishIncidentRefresh(taskID: taskID)
        }
    }

    func inspectIncident(_ summary: IncidentSummaryV1) {
        startIncidentAction(.inspect(summary.selection))
    }

    func explainIncident(_ summary: IncidentSummaryV1) {
        startIncidentAction(.explain(summary.selection))
    }

    func deleteIncident(_ summary: IncidentSummaryV1) {
        startIncidentAction(.tombstone(summary.selection))
    }

    func prepareRedactedIncidentExport(_ summary: IncidentSummaryV1) {
        startIncidentAction(.redactedExport(summary.selection))
    }

    func reviewDueIncidentRetention() {
        startIncidentAction(.retentionReview)
    }

    private enum IncidentUserAction: Sendable {
        case inspect(IncidentSelectionV1)
        case explain(IncidentSelectionV1)
        case tombstone(IncidentSelectionV1)
        case redactedExport(IncidentSelectionV1)
        case retentionReview

        var executionKind: IncidentActionExecutionKindV1 {
            switch self {
            case .inspect: .inspect
            case .explain: .explain
            case .tombstone: .tombstone
            case .redactedExport: .redactedExport
            case .retentionReview: .retentionReview
            }
        }
    }

    private func startIncidentAction(_ action: IncidentUserAction) {
        guard lifecyclePhase == .running else { return }
        let predecessor = incidentActionTask
        incidentMutationControl.invalidatePendingMutations()
        cancelIncidentAction(retentionReason: .captureCancelled)
        let taskID = UUID()
        let epoch = admissionEpoch
        incidentActionTaskID = taskID
        incidentActionInFlight = true
        incidentActionReason = nil
        if case .redactedExport = action { preparedIncidentExport = nil }
        incidentActionTask = Task { [weak self] in
            guard let self else { return }
            if let predecessor { await predecessor.value }
            guard isCurrentIncidentAction(taskID), epoch == admissionEpoch else { return }
            incidentActionExecutionObserver(action.executionKind)
            let ownsRetentionReview: Bool
            if case .retentionReview = action {
                incidentRetentionReviewOwnerTaskID = taskID
                incidentRetentionReviewState = .runningEmpty
                ownsRetentionReview = true
            } else {
                ownsRetentionReview = false
            }
            defer {
                if ownsRetentionReview {
                    finishIncidentRetentionReviewIfOwned(taskID: taskID)
                }
                finishIncidentAction(taskID: taskID)
            }
            switch action {
            case .explain(let selection):
                let response = await incidentHistoryCoordinator.explain(selection: selection)
#if DEBUG
                await beforeIncidentExplanationDeliveryForTesting?()
#endif
                guard isCurrentIncidentAction(taskID), epoch == admissionEpoch else { return }
                switch response {
                case .available(let explanation):
                    incidentExplanation = explanation
                    incidentActionReason = nil
                case .unavailable(let reason), .refused(let reason), .inactive(let reason):
                    incidentActionReason = reason
                }

            case .inspect(let selection):
                let response = await incidentHistoryCoordinator.inspect(selection: selection)
                guard isCurrentIncidentAction(taskID) else { return }
                switch response {
                case .available(let view):
                    inspectedIncident = view
                    incidentActionReason = nil
                case .unavailable(let reason), .refused(let reason), .inactive(let reason):
                    incidentActionReason = reason
                }

            case .tombstone(let selection):
                let response = await incidentHistoryCoordinator.tombstone(
                    selection: selection,
                    reason: .userRequested
                )
                guard isCurrentIncidentAction(taskID) else { return }
                switch response {
                case .completed:
                    incidentHistory.removeAll { $0.incidentID == selection.incidentID }
                    preparedIncidentExport = nil
                    incidentActionReason = nil
                    let inspected = await incidentHistoryCoordinator.inspect(selection: selection)
                    guard isCurrentIncidentAction(taskID) else { return }
                    if case .available(let view) = inspected { inspectedIncident = view }
                case .unavailable(let reason), .refused(let reason), .inactive(let reason):
                    incidentActionReason = reason
                }

            case .redactedExport(let selection):
                let response = await incidentHistoryCoordinator.redactedExport(selection: selection)
                guard isCurrentIncidentAction(taskID) else { return }
                switch response {
                case .available(let export):
                    preparedIncidentExport = export
                    incidentActionReason = nil
                case .unavailable(let reason), .refused(let reason), .inactive(let reason):
                    incidentActionReason = reason
                }

            case .retentionReview:
                await performIncidentRetentionReview(taskID: taskID, epoch: epoch)
            }
        }
    }

    private func performIncidentRetentionReview(taskID: UUID, epoch: UInt64) async {
        guard retentionActionMayContinue(taskID: taskID, epoch: epoch) else {
            stopIncidentRetentionReviewIfOwned(
                taskID: taskID,
                reason: incidentRetentionInterruptionReason()
            )
            if isCurrentIncidentAction(taskID) {
                incidentActionReason = incidentRetentionInterruptionReason()
            }
            return
        }

        var continuation: IncidentRetentionSweepContinuationV1?
        var expectedScope: IncidentLedgerScopeV1?
        var expectedCutoffAtMilliseconds: Int64?
        var expectedInitialEventHighWatermark: Int64?

        while retentionActionMayContinue(taskID: taskID, epoch: epoch) {
            let requestedContinuation = continuation
            let response = await incidentHistoryCoordinator.sweepRetentionReviewDue(
                batchSize: Self.incidentRetentionReviewPageSize,
                continuation: requestedContinuation
            )

            switch response {
            case .completed(let page, let history):
                await incidentRetentionPageReturnObserver(page)
                let pageIsValid = accountCommittedRetentionPageIfOwned(
                    page,
                    requestedContinuation: requestedContinuation,
                    taskID: taskID,
                    expectedScope: &expectedScope,
                    expectedCutoffAtMilliseconds: &expectedCutoffAtMilliseconds,
                    expectedInitialEventHighWatermark: &expectedInitialEventHighWatermark
                )
                guard pageIsValid else {
                    if isCurrentIncidentAction(taskID) {
                        incidentActionReason = .configurationInvalid
                    }
                    return
                }
                guard isCurrentIncidentAction(taskID), epoch == admissionEpoch else {
                    stopIncidentRetentionReviewIfOwned(
                        taskID: taskID,
                        reason: incidentRetentionInterruptionReason()
                    )
                    return
                }
                incidentHistory = history
                incidentHistoryAvailability = .available
                incidentHistoryReason = nil
                incidentActionReason = nil
                guard incidentRetentionReviewState?.inFlight == true,
                      let nextContinuation = page.continuation else { return }
                continuation = nextContinuation

            case .completedHistoryUnavailable(let page, let reason):
                await incidentRetentionPageReturnObserver(page)
                let pageIsValid = accountCommittedRetentionPageIfOwned(
                    page,
                    requestedContinuation: requestedContinuation,
                    taskID: taskID,
                    expectedScope: &expectedScope,
                    expectedCutoffAtMilliseconds: &expectedCutoffAtMilliseconds,
                    expectedInitialEventHighWatermark: &expectedInitialEventHighWatermark
                )
                guard pageIsValid else {
                    if isCurrentIncidentAction(taskID) {
                        incidentActionReason = .configurationInvalid
                    }
                    return
                }
                stopIncidentRetentionReviewIfOwned(taskID: taskID, reason: reason)
                guard isCurrentIncidentAction(taskID), epoch == admissionEpoch else { return }
                incidentHistory = []
                incidentHistoryAvailability = .unavailable
                incidentHistoryReason = reason
                incidentActionReason = reason
                return

            case .completedHistoryRefused(let page, let reason):
                await incidentRetentionPageReturnObserver(page)
                let pageIsValid = accountCommittedRetentionPageIfOwned(
                    page,
                    requestedContinuation: requestedContinuation,
                    taskID: taskID,
                    expectedScope: &expectedScope,
                    expectedCutoffAtMilliseconds: &expectedCutoffAtMilliseconds,
                    expectedInitialEventHighWatermark: &expectedInitialEventHighWatermark
                )
                guard pageIsValid else {
                    if isCurrentIncidentAction(taskID) {
                        incidentActionReason = .configurationInvalid
                    }
                    return
                }
                stopIncidentRetentionReviewIfOwned(taskID: taskID, reason: reason)
                guard isCurrentIncidentAction(taskID), epoch == admissionEpoch else { return }
                incidentHistory = []
                incidentHistoryAvailability = .refused
                incidentHistoryReason = reason
                incidentActionReason = reason
                return

            case .unavailable(let reason), .refused(let reason), .inactive(let reason):
                stopIncidentRetentionReviewIfOwned(taskID: taskID, reason: reason)
                guard isCurrentIncidentAction(taskID), epoch == admissionEpoch else { return }
                incidentActionReason = reason
                return
            }
        }

        stopIncidentRetentionReviewIfOwned(
            taskID: taskID,
            reason: incidentRetentionInterruptionReason()
        )
    }

    private func retentionActionMayContinue(taskID: UUID, epoch: UInt64) -> Bool {
        lifecyclePhase == .running
            && epoch == admissionEpoch
            && incidentActionTaskID == taskID
            && incidentRetentionReviewOwnerTaskID == taskID
            && desiredMode == .assist
            && incidentCaptureControl.isEnabled
            && !Task.isCancelled
    }

    private func incidentRetentionInterruptionReason() -> IncidentHistoryCoordinatorReasonV1 {
        switch lifecyclePhase {
        case .shuttingDown:
            return .shuttingDown
        case .closed:
            return .closed
        case .running:
            if desiredMode != .assist { return .modeInactive }
            if !incidentCaptureControl.isEnabled { return .userDisabled }
            return .captureCancelled
        }
    }

    private func accountCommittedRetentionPageIfOwned(
        _ page: IncidentRetentionSweepPageV1,
        requestedContinuation: IncidentRetentionSweepContinuationV1?,
        taskID: UUID,
        expectedScope: inout IncidentLedgerScopeV1?,
        expectedCutoffAtMilliseconds: inout Int64?,
        expectedInitialEventHighWatermark: inout Int64?
    ) -> Bool {
        guard incidentRetentionReviewOwnerTaskID == taskID,
              let current = incidentRetentionReviewState else { return false }

        let (pageCount, pageOverflow) = current.pageCount.addingReportingOverflow(1)
        let (processedCount, processedOverflow) = current.processedObservationCount
            .addingReportingOverflow(page.processedObservationCount)
        let (appendedCount, appendedOverflow) = current.appendedTombstoneCount
            .addingReportingOverflow(page.appendedTombstoneCount)
        let (replayedCount, replayedOverflow) = current.replayedTombstoneCount
            .addingReportingOverflow(page.replayedTombstoneCount)
        guard !pageOverflow, !processedOverflow, !appendedOverflow, !replayedOverflow else {
            incidentRetentionReviewState = IncidentRetentionReviewStateV1(
                pageCount: current.pageCount,
                processedObservationCount: current.processedObservationCount,
                appendedTombstoneCount: current.appendedTombstoneCount,
                replayedTombstoneCount: current.replayedTombstoneCount,
                workRemaining: current.workRemaining,
                stop: retentionStopPreservingNewerBoundary(
                    current.stop,
                    fallback: .invalidAggregation
                )
            )
            return false
        }

        let workRemaining = page.continuation != nil
        let accounted = IncidentRetentionReviewStateV1(
            pageCount: pageCount,
            processedObservationCount: processedCount,
            appendedTombstoneCount: appendedCount,
            replayedTombstoneCount: replayedCount,
            workRemaining: workRemaining,
            stop: .running
        )
        incidentRetentionReviewState = accounted

        if expectedScope == nil {
            expectedScope = page.scope
            expectedCutoffAtMilliseconds = page.cutoffAtMilliseconds
            expectedInitialEventHighWatermark = page.initialEventHighWatermark
        }
        let continuationAdvanced = page.continuation.map { next in
            requestedContinuation.map { next != $0 } ?? true
        } ?? true
        let pageIsValid = page.batchSize == Self.incidentRetentionReviewPageSize
            && page.processedObservationCount >= 0
            && page.processedObservationCount <= Self.incidentRetentionReviewPageSize
            && page.processedObservationCount
                == page.appendedTombstoneCount + page.replayedTombstoneCount
            && page.processedObservationCount == page.tombstones.count
            && (page.continuation == nil
                || page.processedObservationCount == Self.incidentRetentionReviewPageSize)
            && continuationAdvanced
            && page.scope == expectedScope
            && page.cutoffAtMilliseconds == expectedCutoffAtMilliseconds
            && page.initialEventHighWatermark == expectedInitialEventHighWatermark
            && !page.authorizing
            && !page.certified
            && !page.protectedAuthorityVerified
            && !page.rawContentStored
            && !page.physicalErasurePerformed
            && pageCount <= Self.maximumIncidentRetentionReviewPages
            && processedCount <= Self.maximumIncidentRetentionReviewObservations
            && processedCount == appendedCount + replayedCount

        guard pageIsValid else {
            incidentRetentionReviewState = IncidentRetentionReviewStateV1(
                pageCount: pageCount,
                processedObservationCount: processedCount,
                appendedTombstoneCount: appendedCount,
                replayedTombstoneCount: replayedCount,
                workRemaining: workRemaining,
                stop: retentionStopPreservingNewerBoundary(
                    current.stop,
                    fallback: .invalidAggregation
                )
            )
            return false
        }

        let pageStop: IncidentRetentionReviewStopV1
        if !workRemaining {
            pageStop = .exhausted
        } else if pageCount == Self.maximumIncidentRetentionReviewPages
                    || processedCount == Self.maximumIncidentRetentionReviewObservations {
            pageStop = .ceilingReached
        } else {
            pageStop = .running
        }
        incidentRetentionReviewState = IncidentRetentionReviewStateV1(
            pageCount: pageCount,
            processedObservationCount: processedCount,
            appendedTombstoneCount: appendedCount,
            replayedTombstoneCount: replayedCount,
            workRemaining: workRemaining,
            stop: retentionStopPreservingNewerBoundary(
                current.stop,
                fallback: pageStop
            )
        )
        return true
    }

    private func retentionStopPreservingNewerBoundary(
        _ current: IncidentRetentionReviewStopV1,
        fallback: IncidentRetentionReviewStopV1
    ) -> IncidentRetentionReviewStopV1 {
        switch current {
        case .interrupted, .invalidAggregation:
            return current
        case .running, .exhausted, .ceilingReached:
            return fallback
        }
    }

    private func stopIncidentRetentionReviewIfOwned(
        taskID: UUID,
        reason: IncidentHistoryCoordinatorReasonV1
    ) {
        guard incidentRetentionReviewOwnerTaskID == taskID,
              let current = incidentRetentionReviewState else { return }
        switch current.stop {
        case .interrupted, .invalidAggregation:
            return
        case .running, .exhausted, .ceilingReached:
            break
        }
        incidentRetentionReviewState = IncidentRetentionReviewStateV1(
            pageCount: current.pageCount,
            processedObservationCount: current.processedObservationCount,
            appendedTombstoneCount: current.appendedTombstoneCount,
            replayedTombstoneCount: current.replayedTombstoneCount,
            workRemaining: current.workRemaining,
            stop: .interrupted(reason)
        )
    }

    private func finishIncidentRetentionReviewIfOwned(taskID: UUID) {
        guard incidentRetentionReviewOwnerTaskID == taskID else { return }
        if incidentRetentionReviewState?.inFlight == true {
            stopIncidentRetentionReviewIfOwned(
                taskID: taskID,
                reason: incidentRetentionInterruptionReason()
            )
        }
        incidentRetentionReviewOwnerTaskID = nil
    }

    private func isCurrentIncidentAction(_ taskID: UUID) -> Bool {
        lifecyclePhase == .running
            && incidentActionTaskID == taskID
            && !Task.isCancelled
    }

    private func finishIncidentAction(taskID: UUID) {
        guard incidentActionTaskID == taskID else { return }
        incidentActionTask = nil
        incidentActionTaskID = nil
        incidentActionInFlight = false
    }

    func savePreparedIncidentExport(to destinationURL: URL) {
        guard lifecyclePhase == .running,
              let preparedIncidentExport else { return }
        startFileExport(
            bytes: preparedIncidentExport.canonicalData,
            digest: preparedIncidentExport.digest,
            destinationURL: destinationURL
        )
    }

    func exportAcceptedCopy(to destinationURL: URL) {
        guard lifecyclePhase == .running,
              currentness == .current,
              desiredMode == .assist,
              let snapshot = selectedSnapshot,
              let result,
              result.subjectDigest == snapshot.subjectDigest,
              result.profileID == profile.id,
              result.profileFingerprint == profile.rulesFingerprint,
              result.mode == .assist,
              result.resultEvidenceDigest != nil else { return }

        cancelFileExport()
        let taskID = UUID()
        let epoch = admissionEpoch
        let activeProfile = profile
        let evidenceDigest = result.resultEvidenceDigest
        fileExportTaskID = taskID
        fileExportInFlight = true
        lastFileExportReceipt = nil
        fileExportTask = Task { [weak self] in
            guard let self else { return }
            let observedCurrentness = await ledger.currentness(
                snapshot: snapshot,
                profile: activeProfile,
                mode: .assist,
                result: result
            )
            guard lifecyclePhase == .running,
                  observedCurrentness == .current,
                  currentness == .current,
                  epoch == admissionEpoch,
                  taskID == fileExportTaskID,
                  selectedSnapshot?.subjectDigest == snapshot.subjectDigest,
                  self.result?.resultEvidenceDigest == evidenceDigest,
                  !Task.isCancelled,
                  let admission = privateWriteAdmissionControl.issue() else {
                finishFileExport(taskID: taskID)
                return
            }
            await performFileExport(
                bytes: snapshot.bytes,
                digest: snapshot.subjectDigest,
                destinationURL: destinationURL,
                admission: admission,
                taskID: taskID
            )
        }
    }

    private func startFileExport(
        bytes: Data,
        digest: String,
        destinationURL: URL
    ) {
        cancelFileExport()
        guard let admission = privateWriteAdmissionControl.issue() else {
            lastError = PrivateVerifiedWriteErrorV1.admissionRevoked.localizedDescription
            return
        }
        let taskID = UUID()
        fileExportTaskID = taskID
        fileExportInFlight = true
        lastFileExportReceipt = nil
        fileExportTask = Task { [weak self] in
            guard let self else { return }
            await performFileExport(
                bytes: bytes,
                digest: digest,
                destinationURL: destinationURL,
                admission: admission,
                taskID: taskID
            )
        }
    }

    private func performFileExport(
        bytes: Data,
        digest: String,
        destinationURL: URL,
        admission: PrivateWriteAdmissionV1,
        taskID: UUID
    ) async {
        do {
            let writer = privateFileWriter
            let receipt = try await Task.detached(priority: .utility) {
                try writer(bytes, digest, destinationURL, admission)
            }.value
            guard lifecyclePhase == .running,
                  taskID == fileExportTaskID,
                  !Task.isCancelled else { return }
            lastFileExportReceipt = receipt
            lastError = nil
        } catch {
            guard lifecyclePhase == .running,
                  taskID == fileExportTaskID,
                  !Task.isCancelled else { return }
            lastError = error.localizedDescription
        }
        finishFileExport(taskID: taskID)
    }

    private func finishFileExport(taskID: UUID) {
        guard fileExportTaskID == taskID else { return }
        fileExportTask = nil
        fileExportTaskID = nil
        fileExportInFlight = false
    }

    func setMode(_ mode: VeritasMode) {
        guard lifecyclePhase == .running, mode != desiredMode else { return }
        if mode != .assist {
            incidentMutationControl.invalidatePendingMutations()
        }
        invalidateIncidentCapture(disable: mode != .assist, inactiveReason: .modeInactive)
        advanceAdmissionEpoch()
        desiredMode = mode
        result = nil
        if currentness == .current { currentness = .stale }
        cancelAcceptanceTask()
        if mode == .off {
            effectiveState = .stoppingUncertain
            cancelAnalysisTask()
            startIncidentSuspend()
            startQuiescenceConfirmation(epoch: admissionEpoch)
            lastError = nil
            return
        }
        cancelQuiescenceTask()
        guard platformAdmission.allowed else {
            effectiveState = .blocked
            lastError = platformAdmission.userMessage
            return
        }
        guard selectedSnapshot != nil else {
            effectiveState = .blocked
            lastError = "Select an artifact before requesting a route. No readiness has been established."
            return
        }
        lastError = nil
        analyzeSelected()
    }

    func select(url: URL) {
        guard lifecyclePhase == .running else { return }
        do {
            select(snapshot: try snapshotter.snapshot(url: url))
        } catch {
            refuseSelection(error)
        }
    }

    func select(snapshot: ArtifactSnapshot) {
        guard lifecyclePhase == .running else { return }
        let owned: ArtifactSnapshot
        do {
            owned = try ownedSelection(snapshot)
        } catch {
            refuseSelection(error)
            return
        }
        incidentMutationControl.invalidatePendingMutations()
        invalidateIncidentCapture(disable: false, inactiveReason: .captureCancelled)
        advanceAdmissionEpoch()
        cancelAnalysisTask()
        cancelAcceptanceTask()
        selectedSnapshot = owned
        result = nil
        if currentness == .current { currentness = .stale }
        lastError = nil
        if desiredMode != .off {
            analyzeSelected()
        } else {
            effectiveState = .stoppingUncertain
            startQuiescenceConfirmation(epoch: admissionEpoch)
        }
    }

    private func ownedSelection(_ snapshot: ArtifactSnapshot) throws -> ArtifactSnapshot {
        // Check before copying/hashing. A public ArtifactSnapshot can bypass the
        // snapshotter and can retain externally mutable Data backing.
        guard !snapshot.bytes.isEmpty else { throw SnapshotError.empty }
        guard snapshot.bytes.count <= snapshotter.byteLimit else {
            throw SnapshotError.exceedsByteLimit(actual: snapshot.bytes.count, limit: snapshotter.byteLimit)
        }
        // The caller must not mutate external backing concurrently with this
        // synchronous copy. Later mutations cannot change the selected subject.
        let bytes = Data([UInt8](snapshot.bytes))
        let owned = try snapshotter.snapshot(displayName: snapshot.displayName,
                                            kind: snapshot.kind, bytes: bytes)
        guard owned.subjectDigest == snapshot.subjectDigest else {
            throw SnapshotSelectionFailure.identityChanged
        }
        return owned
    }

    private func refuseSelection(_ error: any Error) {
        incidentMutationControl.invalidatePendingMutations()
        invalidateIncidentCapture(disable: false, inactiveReason: .captureCancelled)
        advanceAdmissionEpoch()
        cancelAnalysisTask()
        cancelAcceptanceTask()
        selectedSnapshot = nil
        result = nil
        if currentness == .current { currentness = .stale }
        lastError = error.localizedDescription
        if desiredMode == .off {
            effectiveState = .stoppingUncertain
            startQuiescenceConfirmation(epoch: admissionEpoch)
        } else {
            effectiveState = .blocked
        }
    }

    func setProfile(_ replacement: CheckProfile) {
        guard lifecyclePhase == .running, replacement != profile else { return }
        incidentMutationControl.invalidatePendingMutations()
        invalidateIncidentCapture(disable: false, inactiveReason: .captureCancelled)
        advanceAdmissionEpoch()
        cancelAnalysisTask()
        cancelAcceptanceTask()
        profile = replacement
        result = nil
        if currentness == .current { currentness = .stale }
        if desiredMode != .off, selectedSnapshot != nil {
            analyzeSelected()
        }
    }

    func analyzeSelected() {
        guard lifecyclePhase == .running,
              let snapshot = selectedSnapshot,
              desiredMode != .off else { return }
        incidentMutationControl.invalidatePendingMutations()
        invalidateIncidentCapture(disable: false, inactiveReason: .captureCancelled)
        guard platformAdmission.allowed else {
            effectiveState = .blocked
            result = nil
            lastError = platformAdmission.userMessage
            return
        }
        advanceAdmissionEpoch()
        let epoch = admissionEpoch
        let mode = desiredMode
        let activeProfile = profile
        let taskID = UUID()
        effectiveState = .starting
        cancelQuiescenceTask()
        cancelAnalysisTask()
        result = nil
        if currentness == .current { currentness = .stale }
        analysisTaskID = taskID
        analysisTask = Task { [weak self] in
            guard let self else { return }
            let computed = await pipeline.analyze(
                snapshot: snapshot,
                profile: activeProfile,
                mode: mode
            )
            guard lifecyclePhase == .running,
                  epoch == admissionEpoch,
                  taskID == analysisTaskID,
                  !Task.isCancelled else {
                finishDiscardedWork(taskID: taskID)
                return
            }
            let observedCurrentness = await ledger.currentness(
                snapshot: snapshot,
                profile: activeProfile,
                mode: mode,
                result: computed
            )
            guard lifecyclePhase == .running,
                  epoch == admissionEpoch,
                  taskID == analysisTaskID,
                  !Task.isCancelled else {
                finishDiscardedWork(taskID: taskID)
                return
            }

            // Baseline authority is published before the optional history side effect.
            result = computed
            currentness = observedCurrentness
            effectiveState = switch computed.disposition {
            case .off: .off
            case .ready: mode == .assist ? .assistReady : .enforceReady
            case .needsAttention, .blocked: .blocked
            case .degraded: .degraded
            }
            analysisTask = nil
            analysisTaskID = nil
            scheduleIncidentCaptureIfEligible(
                snapshot: snapshot,
                profile: activeProfile,
                mode: mode,
                result: computed,
                epoch: epoch
            )
        }
    }

    func acceptExactVersion() {
        guard lifecyclePhase == .running,
              platformAdmission.allowed,
              let snapshot = selectedSnapshot,
              let result,
              result.subjectDigest == snapshot.subjectDigest,
              desiredMode == .assist else { return }
        privateWriteAdmissionControl.invalidate()
        let activeProfile = profile
        let epoch = admissionEpoch
        let evidenceDigest = result.resultEvidenceDigest
        acceptanceMutationSequence &+= 1
        let mutationSequence = acceptanceMutationSequence
        let taskID = UUID()
        cancelAcceptanceTask()
        acceptanceTaskID = taskID
        acceptanceTask = Task { [weak self] in
            guard let self else { return }
            do {
                _ = try await ledger.accept(
                    snapshot: snapshot,
                    profile: activeProfile,
                    mode: .assist,
                    mutationSequence: mutationSequence,
                    result: result
                )
                guard lifecyclePhase == .running,
                      epoch == admissionEpoch,
                      taskID == acceptanceTaskID,
                      selectedSnapshot?.subjectDigest == snapshot.subjectDigest,
                      self.result?.resultEvidenceDigest == evidenceDigest,
                      !Task.isCancelled else { return }
                let observedCurrentness = await ledger.currentness(
                    snapshot: snapshot,
                    profile: activeProfile,
                    mode: .assist,
                    result: result
                )
                guard lifecyclePhase == .running,
                      epoch == admissionEpoch,
                      taskID == acceptanceTaskID,
                      selectedSnapshot?.subjectDigest == snapshot.subjectDigest,
                      self.result?.resultEvidenceDigest == evidenceDigest,
                      !Task.isCancelled else { return }
                currentness = observedCurrentness
                lastError = nil
            } catch {
                guard lifecyclePhase == .running,
                      epoch == admissionEpoch,
                      taskID == acceptanceTaskID,
                      !Task.isCancelled else { return }
                lastError = error.localizedDescription
            }
            if acceptanceTaskID == taskID {
                acceptanceTask = nil
                acceptanceTaskID = nil
            }
        }
    }

    func clearAcceptance() {
        guard lifecyclePhase == .running else { return }
        privateWriteAdmissionControl.invalidate()
        acceptanceMutationSequence &+= 1
        let mutationSequence = acceptanceMutationSequence
        let taskID = UUID()
        cancelAcceptanceTask()
        acceptanceTaskID = taskID
        acceptanceTask = Task { [weak self] in
            guard let self else { return }
            let cleared = await ledger.clear(mutationSequence: mutationSequence)
            guard lifecyclePhase == .running,
                  taskID == acceptanceTaskID,
                  !Task.isCancelled else { return }
            if cleared { currentness = .none }
            acceptanceTask = nil
            acceptanceTaskID = nil
        }
    }

    /// Synchronous authority revocation used by the AppKit termination delegate.
    func beginShutdown() {
        guard lifecyclePhase == .running else { return }
        incidentMutationControl.invalidatePendingMutations()
        privateWriteAdmissionControl.invalidate()
        lifecyclePhase = .shuttingDown
        incidentCaptureControl.invalidatePendingCaptures()
        incidentCaptureControl.setEnabled(false)
        advanceAdmissionEpoch()
        retireCurrentTasksForShutdown()
        incidentCaptureInFlight = false
        incidentHistoryAvailability = .stopping
        incidentHistoryReason = .shuttingDown
        effectiveState = .stoppingUncertain
    }

    /// Awaits every retained task and terminally closes the incident coordinator.
    func finishShutdown() async {
        if lifecyclePhase == .running { beginShutdown() }
        guard lifecyclePhase == .shuttingDown else { return }
        let referenceTask = referenceRunTask
        let coordinatorTask = Task { await incidentHistoryCoordinator.shutdown() }
        let tasks = retiredTasks + retiredIncidentTasks
        retiredTasks.removeAll()
        retiredIncidentTasks.removeAll()
        for task in tasks { await task.value }
        let closeResult = await coordinatorTask.value
#if DEBUG
        referenceShutdownJoinChecksForTesting += 1
#endif
        await referenceTask?.value
        lifecyclePhase = .closed
        desiredMode = .off
        effectiveState = .off
        switch closeResult {
        case .closed:
            incidentHistoryAvailability = .closed
            incidentHistoryReason = .closed
        case .uncertain(let reason):
            incidentHistoryAvailability = .unavailable
            incidentHistoryReason = reason
        }
    }

    func shutdown() async {
        beginShutdown()
        await finishShutdown()
    }

    /// Package-internal deterministic synchronization seam for native tests.
    /// Production UI never calls this and no readiness claim depends on timing sleeps.
    func awaitSettledForTesting() async {
        while true {
            let retired = retiredTasks + retiredIncidentTasks
            retiredTasks.removeAll()
            retiredIncidentTasks.removeAll()
            let current = [
                analysisTask,
                acceptanceTask,
                quiescenceTask,
                incidentCaptureTask,
                incidentRefreshTask,
                incidentLifecycleTask,
                incidentActionTask,
                fileExportTask,
                referenceRunTask,
            ].compactMap { $0 }
            if retired.isEmpty && current.isEmpty { return }
            for task in retired { await task.value }
            for task in current { await task.value }
            await Task.yield()
        }
    }

    private func scheduleIncidentCaptureIfEligible(
        snapshot: ArtifactSnapshot,
        profile: CheckProfile,
        mode: VeritasMode,
        result: PipelineResult,
        epoch: UInt64
    ) {
        guard lifecyclePhase == .running,
              incidentCaptureControl.isEnabled,
              mode == .assist,
              result.disposition == .needsAttention,
              !result.deterministicPassed,
              result.modelParticipation == .notRun,
              let resultDigest = result.resultEvidenceDigest else { return }

        cancelIncidentCapture()
        cancelIncidentRefresh()
        let taskID = UUID()
        let priorLifecycle = incidentLifecycleTask
        let priorTasks = retiredIncidentTasks
        retiredIncidentTasks.removeAll()
        let runDigest = ArtifactSnapshot.digest(Data(
            "veritas-app-capture-v1|\(epoch)|\(taskID.uuidString.lowercased())|\(resultDigest)".utf8
        ))
        let observedAt = Date()
        let context = PipelineIncidentCaptureContextV1(
            runObservationDigest: runDigest,
            observedAt: observedAt,
            retentionReviewAt: observedAt.addingTimeInterval(
                IncidentHistoryConfigurationV1.retentionReviewInterval
            )
        )
        incidentCaptureTaskID = taskID
        incidentCaptureInFlight = true
        incidentCaptureOutcome = nil
        incidentHistoryAvailability = .opening
        incidentHistoryReason = nil
        incidentCaptureTask = Task { [weak self] in
            guard let self else { return }
            for task in priorTasks { await task.value }
            if let priorLifecycle { await priorLifecycle.value }
            guard lifecyclePhase == .running,
                  epoch == admissionEpoch,
                  taskID == incidentCaptureTaskID,
                  incidentCaptureControl.isEnabled,
                  self.result?.resultEvidenceDigest == resultDigest,
                  !Task.isCancelled else {
                finishIncidentCapture(taskID: taskID)
                return
            }
            let capture = await incidentHistoryCoordinator.capture(
                snapshot: snapshot,
                profile: profile,
                mode: mode,
                result: result,
                context: context
            )
            guard lifecyclePhase == .running,
                  epoch == admissionEpoch,
                  taskID == incidentCaptureTaskID,
                  incidentCaptureControl.isEnabled,
                  self.result?.resultEvidenceDigest == resultDigest,
                  !Task.isCancelled else {
                finishIncidentCapture(taskID: taskID)
                return
            }
            switch capture {
            case .completed(let outcome, let history):
                incidentCaptureOutcome = outcome
                if outcome.status == .appended || outcome.status == .idempotentDuplicate {
                    incidentHistory = history
                    incidentHistoryAvailability = .available
                    incidentHistoryReason = nil
                } else if outcome.status == .unavailable {
                    incidentHistoryAvailability = .unavailable
                    incidentHistoryReason = .storageUnavailable
                } else if outcome.status == .refused {
                    incidentHistoryAvailability = .refused
                    incidentHistoryReason = outcome.reason == .ledgerIntegrityRefused
                        ? .integrityRefused
                        : .configurationInvalid
                } else {
                    incidentHistoryAvailability = .armed
                    incidentHistoryReason = .captureCancelled
                }
            case .completedHistoryUnavailable(let outcome, let reason):
                incidentCaptureOutcome = outcome
                incidentHistory = []
                incidentHistoryAvailability = .unavailable
                incidentHistoryReason = reason
            case .completedHistoryRefused(let outcome, let reason):
                incidentCaptureOutcome = outcome
                incidentHistory = []
                incidentHistoryAvailability = .refused
                incidentHistoryReason = reason
            case .unavailable(let reason):
                incidentHistory = []
                incidentHistoryAvailability = .unavailable
                incidentHistoryReason = reason
            case .refused(let reason):
                incidentHistory = []
                incidentHistoryAvailability = .refused
                incidentHistoryReason = reason
            case .inactive(let reason):
                incidentHistoryAvailability = incidentCaptureControl.isEnabled ? .armed : .disabled
                incidentHistoryReason = reason
            }
            finishIncidentCapture(taskID: taskID)
        }
    }

    private func invalidateIncidentCapture(
        disable: Bool,
        inactiveReason: IncidentHistoryCoordinatorReasonV1
    ) {
        incidentCaptureControl.invalidatePendingCaptures()
        cancelIncidentCapture()
        cancelIncidentRefresh()
        cancelIncidentAction(retentionReason: inactiveReason)
        incidentCaptureOutcome = nil
        incidentCaptureInFlight = false
        if disable {
            incidentCaptureControl.setEnabled(false)
            incidentHistoryAvailability = .disabled
            incidentHistoryReason = inactiveReason
        } else if incidentCaptureControl.isEnabled {
            incidentHistoryAvailability = .armed
            incidentHistoryReason = nil
        }
    }

    private func startIncidentSuspend() {
        incidentMutationControl.invalidatePendingMutations()
        cancelIncidentAction(retentionReason: incidentRetentionInterruptionReason())
        let priorLifecycle = incidentLifecycleTask
        if priorLifecycle != nil, retiredIncidentTasks.isEmpty { return }
        let taskID = UUID()
        let draining = retiredIncidentTasks
        retiredIncidentTasks.removeAll()
        incidentLifecycleTaskID = taskID
        incidentLifecycleTask = Task { [weak self] in
            guard let self else { return }
            if let priorLifecycle { await priorLifecycle.value }
            for task in draining { await task.value }
            let closeResult = await incidentHistoryCoordinator.suspend()
            guard lifecyclePhase == .running,
                  taskID == incidentLifecycleTaskID,
                  !Task.isCancelled else { return }
            incidentLifecycleTask = nil
            incidentLifecycleTaskID = nil
            switch closeResult {
            case .closed:
                if incidentCaptureControl.isEnabled {
                    incidentHistoryAvailability = .armed
                    incidentHistoryReason = nil
                } else {
                    incidentHistoryAvailability = .disabled
                }
            case .uncertain(let reason):
                incidentHistoryAvailability = .unavailable
                incidentHistoryReason = reason
            }
            if desiredMode == .off {
                startQuiescenceConfirmation(epoch: admissionEpoch)
            }
        }
    }

    private func finishIncidentCapture(taskID: UUID) {
        guard incidentCaptureTaskID == taskID else { return }
        incidentCaptureTask = nil
        incidentCaptureTaskID = nil
        incidentCaptureInFlight = false
        if desiredMode == .off {
            startQuiescenceConfirmation(epoch: admissionEpoch)
        }
    }

    private func finishIncidentRefresh(taskID: UUID) {
        guard incidentRefreshTaskID == taskID else { return }
        incidentRefreshTask = nil
        incidentRefreshTaskID = nil
        if desiredMode == .off {
            startQuiescenceConfirmation(epoch: admissionEpoch)
        }
    }

    private func finishDiscardedWork(taskID: UUID) {
        guard analysisTaskID == taskID else { return }
        analysisTask = nil
        analysisTaskID = nil
        if lifecyclePhase == .running, desiredMode == .off {
            startQuiescenceConfirmation(epoch: admissionEpoch)
        }
    }

    private func startQuiescenceConfirmation(epoch: UInt64) {
        guard lifecyclePhase == .running else { return }
        cancelQuiescenceTask()
        let taskID = UUID()
        quiescenceTaskID = taskID
        quiescenceTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                let analyzerQuiescent = await pipeline.analyzerIsQuiescent()
                let incidentQuiescent = incidentCaptureTask == nil
                    && incidentRefreshTask == nil
                    && incidentLifecycleTask == nil
                    && incidentActionTask == nil
                    && fileExportTask == nil
                    && retiredIncidentTasks.isEmpty
                guard lifecyclePhase == .running,
                      epoch == admissionEpoch,
                      desiredMode == .off,
                      taskID == quiescenceTaskID,
                      !Task.isCancelled else { return }
#if DEBUG
                if analyzerQuiescent && incidentQuiescent {
                    referenceQuiescenceChecksForTesting += 1
                }
#endif
                if analyzerQuiescent && incidentQuiescent && referenceRunTask == nil {
                    effectiveState = .off
                    quiescenceTask = nil
                    quiescenceTaskID = nil
                    return
                }
                do {
                    try await Task.sleep(for: .milliseconds(100))
                } catch {
                    return
                }
            }
        }
    }

    private func cancelAnalysisTask() {
        if let analysisTask {
            analysisTask.cancel()
            retiredTasks.append(analysisTask)
        }
        analysisTask = nil
        analysisTaskID = nil
    }

    private func advanceAdmissionEpoch() {
        invalidateReferenceRun()
        privateWriteAdmissionControl.invalidate()
        admissionEpoch &+= 1
    }

    private func cancelAcceptanceTask() {
        if let acceptanceTask {
            acceptanceTask.cancel()
            retiredTasks.append(acceptanceTask)
        }
        acceptanceTask = nil
        acceptanceTaskID = nil
    }

    private func cancelQuiescenceTask() {
        if let quiescenceTask {
            quiescenceTask.cancel()
            retiredTasks.append(quiescenceTask)
        }
        quiescenceTask = nil
        quiescenceTaskID = nil
    }

    private func cancelIncidentCapture() {
        if let incidentCaptureTask {
            incidentCaptureTask.cancel()
            retiredIncidentTasks.append(incidentCaptureTask)
        }
        incidentCaptureTask = nil
        incidentCaptureTaskID = nil
        incidentCaptureInFlight = false
    }

    private func cancelIncidentRefresh() {
        if let incidentRefreshTask {
            incidentRefreshTask.cancel()
            retiredIncidentTasks.append(incidentRefreshTask)
        }
        incidentRefreshTask = nil
        incidentRefreshTaskID = nil
    }

    private func cancelIncidentAction(
        retentionReason: IncidentHistoryCoordinatorReasonV1? = nil
    ) {
        // An old snapshot explanation must not linger beside a new action/run.
        incidentExplanation = nil
        if let taskID = incidentActionTaskID,
           incidentRetentionReviewOwnerTaskID == taskID {
            stopIncidentRetentionReviewIfOwned(
                taskID: taskID,
                reason: retentionReason ?? incidentRetentionInterruptionReason()
            )
        }
        if let incidentActionTask {
            incidentActionTask.cancel()
            retiredIncidentTasks.append(incidentActionTask)
        }
        incidentActionTask = nil
        incidentActionTaskID = nil
        incidentActionInFlight = false
    }

    private func cancelFileExport() {
        privateWriteAdmissionControl.invalidate()
        if let fileExportTask {
            fileExportTask.cancel()
            retiredIncidentTasks.append(fileExportTask)
        }
        fileExportTask = nil
        fileExportTaskID = nil
        fileExportInFlight = false
    }

    private func retireCurrentTasksForShutdown() {
        cancelAnalysisTask()
        cancelAcceptanceTask()
        cancelQuiescenceTask()
        cancelIncidentCapture()
        cancelIncidentRefresh()
        cancelIncidentAction()
        cancelFileExport()
        if let incidentLifecycleTask {
            incidentLifecycleTask.cancel()
            retiredIncidentTasks.append(incidentLifecycleTask)
        }
        incidentLifecycleTask = nil
        incidentLifecycleTaskID = nil
    }
}
