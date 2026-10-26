import VeritasTestEvidenceSupport
import Darwin
import Dispatch
import Foundation
import Testing
@testable import CodenameVeritasApp
@testable import VeritasCore

private actor DelayedAnalyzer: AdvisoryOrchestrator {
    private let delay: Duration
    private var activeOperations = 0

    init(delay: Duration = .milliseconds(120)) {
        self.delay = delay
    }

    func probe() async -> AnalyzerProbe {
        activeOperations += 1
        await uncancellableDelay()
        activeOperations -= 1
        return AnalyzerProbe(
            state: .ready,
            provider: "delayed-test-double",
            route: "injected"
        )
    }

    func proposePlan(for request: OrchestrationRequest) async throws -> AdvisoryPlan {
        AdvisoryPlan(
            subjectDigest: request.subjectDigest,
            proposedDimensionNames: [] ,
            rationale: "No model dimension required for this race test."
        )
    }

    func analyze(_ request: DimensionAnalysisRequest) async throws -> AdvisoryFinding {
        throw AdvisoryOrchestrationError.invalidFinding("UNEXPECTED_TEST_ANALYSIS")
    }

    func isQuiescent() async -> Bool {
        activeOperations == 0
    }

    func waitUntilActive() async {
        while activeOperations == 0 {
            await Task.yield()
        }
    }

    private func uncancellableDelay() async {
        let seconds = UInt64(max(0, delay.components.seconds))
        let fractionalNanoseconds = UInt64(max(0, delay.components.attoseconds / 1_000_000_000))
        let nanoseconds = max(1, seconds * 1_000_000_000 + fractionalNanoseconds)
        await withCheckedContinuation { continuation in
            DispatchQueue.global().asyncAfter(
                deadline: .now() + .nanoseconds(Int(clamping: nanoseconds))
            ) {
                continuation.resume()
            }
        }
    }
}

private actor SelectionRecordingAnalyzer: AdvisoryOrchestrator {
    private(set) var probeCount = 0
    private(set) var plans: [OrchestrationRequest] = []
    private(set) var findingCount = 0
    var callCount: Int { probeCount + plans.count + findingCount }

    func probe() async -> AnalyzerProbe {
        probeCount += 1
        return AnalyzerProbe(state: .ready, provider: "selection-test-double", route: "injected")
    }
    func proposePlan(for request: OrchestrationRequest) async throws -> AdvisoryPlan {
        plans.append(request)
        return AdvisoryPlan(subjectDigest: request.subjectDigest, proposedDimensionNames: [],
                            rationale: "No optional dimension requested by this intake test.")
    }
    func analyze(_ request: DimensionAnalysisRequest) async throws -> AdvisoryFinding {
        findingCount += 1
        throw AdvisoryOrchestrationError.invalidFinding("UNEXPECTED_SELECTION_TEST_FINDING")
    }
    func isQuiescent() async -> Bool { true }
}

@MainActor
private func withSelectionTestModel(
    platform: PlatformAdmission = PlatformRequirements.currentAdmission(),
    _ body: (AppModel, SelectionRecordingAnalyzer) async throws -> Void
) async throws {
    let analyzer = SelectionRecordingAnalyzer()
    let model = AppModel(analyzer: analyzer, platformAdmission: platform,
                         incidentHistoryConfiguration: nil)
    let outcome: Result<Void, any Error>
    do { try await body(model, analyzer); outcome = .success(()) }
    catch { outcome = .failure(error) }
    await model.shutdown()
    try outcome.get()
}

private func appSnapshot(_ name: String) -> ArtifactSnapshot {
    ArtifactSnapshot(
        displayName: "\(name).json",
        kind: .json,
        bytes: Data("{\"name\":\"\(name)\"}".utf8)
    )
}

private func failingAppSnapshot(_ name: String = "invalid") -> ArtifactSnapshot {
    ArtifactSnapshot(
        displayName: "\(name).json",
        kind: .json,
        bytes: Data("{".utf8)
    )
}

private func appDigest(_ value: String) -> String {
    ArtifactSnapshot.digest(Data(value.utf8))
}

private func appIncidentResult(
    snapshot: ArtifactSnapshot,
    profile: CheckProfile = .prototype
) async -> PipelineResult {
    await VeritasPipeline(analyzer: DeterministicOnlyOrchestrator()).analyze(
        snapshot: snapshot,
        profile: profile,
        mode: .assist
    )
}

private func appHistoryScope(_ name: String = UUID().uuidString) -> IncidentLedgerScopeV1 {
    IncidentLedgerScopeV1(
        scopeID: "scope/veritas-private",
        projectDigest: appDigest("app-project-\(name)"),
        accessPolicyDigest: appDigest("app-access-v1"),
        retentionPolicyDigest: LocalIncidentLedgerV1.retentionPolicyDigest
    )
}

@MainActor
private final class AppExplanationDeliveryGate {
    let entered = AsyncStream<Void>.makeStream()
    private var continuation: CheckedContinuation<Void, Never>?
    func wait() async {
        await withCheckedContinuation { pending in
            continuation = pending
            entered.continuation.yield(())
        }
    }
    func release() { continuation?.resume(); continuation = nil }
}

private func makeAppHistoryRoot() throws -> URL {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("veritas-app-history-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(
        at: root,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: NSNumber(value: 0o700)]
    )
    return root
}

private struct AppReplacementPathIdentity: Equatable {
    let device: dev_t
    let inode: ino_t
}

private struct AppPrimaryReplacementFixture {
    let original: URL
    let replacement: URL
    let replacementIdentity: AppReplacementPathIdentity
    let replacementBytes: Data
}

private func appReplacementPathIdentity(
    _ url: URL
) throws -> AppReplacementPathIdentity {
    var status = stat()
    guard url.path.withCString({ Darwin.lstat($0, &status) }) == 0 else {
        throw CocoaError(.fileReadUnknown)
    }
    return AppReplacementPathIdentity(device: status.st_dev, inode: status.st_ino)
}

private func installByteIdenticalAppPrimaryReplacement(
    at primary: URL
) throws -> AppPrimaryReplacementFixture {
    let originalIdentity = try appReplacementPathIdentity(primary)
    let original = URL(
        fileURLWithPath: primary.path + ".original-\(UUID().uuidString)"
    )
    try FileManager.default.moveItem(at: primary, to: original)
    do {
        try FileManager.default.copyItem(at: original, to: primary)
        guard Darwin.chmod(primary.path, mode_t(0o600)) == 0 else {
            throw CocoaError(.fileWriteNoPermission)
        }
        let replacementIdentity = try appReplacementPathIdentity(primary)
        guard replacementIdentity != originalIdentity else {
            throw CocoaError(.fileWriteUnknown)
        }
        return AppPrimaryReplacementFixture(
            original: original,
            replacement: primary,
            replacementIdentity: replacementIdentity,
            replacementBytes: try Data(contentsOf: primary, options: [.mappedIfSafe])
        )
    } catch {
        try? FileManager.default.removeItem(at: primary)
        try? FileManager.default.moveItem(at: original, to: primary)
        throw error
    }
}

private func restoreAppPrimaryReplacement(
    _ fixture: AppPrimaryReplacementFixture
) throws {
    guard FileManager.default.fileExists(atPath: fixture.original.path) else { return }
    if FileManager.default.fileExists(atPath: fixture.replacement.path) {
        try FileManager.default.removeItem(at: fixture.replacement)
    }
    try FileManager.default.moveItem(at: fixture.original, to: fixture.replacement)
}

private final class AppOpenCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func increment() {
        lock.withLock { count += 1 }
    }

    var value: Int {
        lock.withLock { count }
    }
}

private struct AppFaultCounts: Equatable, Sendable {
    let callbacks: Int
    let injected: Int
}

private final class AppFaultProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var callbackCount = 0
    private var injectedCount = 0

    func inject(_ point: IncidentLedgerFaultPointV1) throws {
        let shouldInject = lock.withLock {
            callbackCount += 1
            if case .afterEventInsertBeforeMetadataUpdate = point {
                injectedCount += 1
                return true
            }
            return false
        }
        if shouldInject {
            throw IncidentLedgerErrorV1.sqlite(code: 13, message: "INJECTED_FULL")
        }
    }

    func reset() {
        lock.withLock {
            callbackCount = 0
            injectedCount = 0
        }
    }

    var counts: AppFaultCounts {
        lock.withLock {
            AppFaultCounts(callbacks: callbackCount, injected: injectedCount)
        }
    }
}

private struct AppLateCleanupEvent: Equatable, Sendable {
    let databaseURL: URL
    let result: IncidentLateOpenCleanupResultV1
}

private final class AppLateCleanupWitness: @unchecked Sendable {
    let events: AsyncStream<AppLateCleanupEvent>
    private let continuation: AsyncStream<AppLateCleanupEvent>.Continuation

    init() {
        var capturedContinuation: AsyncStream<AppLateCleanupEvent>.Continuation?
        events = AsyncStream(bufferingPolicy: .bufferingNewest(1)) {
            capturedContinuation = $0
        }
        continuation = capturedContinuation!
    }

    func publish(databaseURL: URL, result: IncidentLateOpenCleanupResultV1) {
        continuation.yield(AppLateCleanupEvent(databaseURL: databaseURL, result: result))
        continuation.finish()
    }
}

private final class AppOpenGate: @unchecked Sendable {
    let entered: AsyncStream<Void>
    let release = DispatchSemaphore(value: 0)
    private let enteredContinuation: AsyncStream<Void>.Continuation

    init() {
        var continuation: AsyncStream<Void>.Continuation?
        entered = AsyncStream(bufferingPolicy: .bufferingNewest(1)) {
            continuation = $0
        }
        enteredContinuation = continuation!
    }

    func block() {
        enteredContinuation.yield(())
        release.wait()
    }
}

private final class AppTransactionGate: @unchecked Sendable {
    let entered: AsyncStream<Void>
    let release = DispatchSemaphore(value: 0)
    private let enteredContinuation: AsyncStream<Void>.Continuation

    init() {
        var continuation: AsyncStream<Void>.Continuation?
        entered = AsyncStream(bufferingPolicy: .bufferingNewest(1)) {
            continuation = $0
        }
        enteredContinuation = continuation!
    }

    func inject(_ point: IncidentLedgerFaultPointV1) throws {
        guard point == .afterEventInsertBeforeMetadataUpdate else { return }
        enteredContinuation.yield(())
        release.wait()
    }
}

private final class AppTombstoneCommitGate: @unchecked Sendable {
    let entered: AsyncStream<Void>
    let release = DispatchSemaphore(value: 0)
    private let continuation: AsyncStream<Void>.Continuation
    private let releaseLock = NSLock()
    private var releasedForBoundedTest = false

    init() {
        var captured: AsyncStream<Void>.Continuation?
        entered = AsyncStream(bufferingPolicy: .bufferingNewest(1)) {
            captured = $0
        }
        continuation = captured!
    }

    func inject(_ point: IncidentLedgerFaultPointV1) throws {
        guard point == .beforeTombstoneCommit else { return }
        continuation.yield(())
        release.wait()
    }

    func releaseOnceForBoundedTest() {
        let shouldRelease = releaseLock.withLock {
            guard !releasedForBoundedTest else { return false }
            releasedForBoundedTest = true
            return true
        }
        if shouldRelease { release.signal() }
    }
}

private enum AppIncidentActionOrderEvent: Equatable, Sendable {
    case actionStarted(IncidentActionExecutionKindV1)
    case retentionPageBlocked
    case retentionPageReleased
}

private final class AppIncidentActionOrderRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var recordedEvents: [AppIncidentActionOrderEvent] = []

    func record(_ event: AppIncidentActionOrderEvent) {
        lock.withLock { recordedEvents.append(event) }
    }

    var events: [AppIncidentActionOrderEvent] {
        lock.withLock { recordedEvents }
    }
}

private final class AppRetentionPageReturnGate: @unchecked Sendable {
    let entered: AsyncStream<IncidentRetentionSweepPageV1>
    private let enteredContinuation: AsyncStream<IncidentRetentionSweepPageV1>.Continuation
    private let onBlocked: @Sendable () -> Void
    private let onRelease: @Sendable () -> Void
    private let lock = NSLock()
    private var releaseContinuation: CheckedContinuation<Void, Never>?
    private var releaseRequested = false

    init(
        onBlocked: @escaping @Sendable () -> Void = {},
        onRelease: @escaping @Sendable () -> Void = {}
    ) {
        var captured: AsyncStream<IncidentRetentionSweepPageV1>.Continuation?
        entered = AsyncStream(bufferingPolicy: .bufferingNewest(1)) {
            captured = $0
        }
        enteredContinuation = captured!
        self.onBlocked = onBlocked
        self.onRelease = onRelease
    }

    func observe(_ page: IncidentRetentionSweepPageV1) async {
        await withCheckedContinuation { continuation in
            let shouldResume = lock.withLock {
                if releaseRequested {
                    releaseRequested = false
                    return true
                }
                releaseContinuation = continuation
                return false
            }
            if !shouldResume { onBlocked() }
            enteredContinuation.yield(page)
            if shouldResume { continuation.resume() }
        }
    }

    var waitingForRelease: Bool {
        lock.withLock { releaseContinuation != nil }
    }

    func release() {
        let continuation = lock.withLock {
            let pending = releaseContinuation
            releaseContinuation = nil
            if pending == nil { releaseRequested = true }
            return pending
        }
        onRelease()
        continuation?.resume()
    }
}

enum AppRetentionRevocationBoundary: String, CaseIterable, Sendable {
    case historyDisable
    case modeOff
    case shutdown
    case refresh
    case snapshotReplacement
    case profileReplacement
    case explicitReanalysis

    var expectedReason: IncidentHistoryCoordinatorReasonV1 {
        switch self {
        case .historyDisable:
            return .userDisabled
        case .modeOff:
            return .modeInactive
        case .shutdown:
            return .shuttingDown
        case .refresh, .snapshotReplacement, .profileReplacement, .explicitReanalysis:
            return .captureCancelled
        }
    }
}

private enum AppRetentionFixtureError: Error {
    case appendFailed(Int)
}

private func appendAppRetentionObservations(
    to ledger: LocalIncidentLedgerV1,
    count: Int,
    reviewAt: Date = Date(timeIntervalSince1970: 2_000),
    label: String = UUID().uuidString
) async throws -> [IncidentSummaryV1] {
    var summaries: [IncidentSummaryV1] = []
    summaries.reserveCapacity(count)
    for index in 0..<count {
        let input = IncidentObservationInputV1(
            incidentID: "incident/\(appDigest("retention-\(label)-\(index)"))",
            observationKey: appDigest("retention-observation-\(label)-\(index)"),
            subjectIDDigest: appDigest("retention-subject-id-\(label)-\(index)"),
            subjectContentDigest: appDigest("retention-subject-content-\(label)-\(index)"),
            evidenceSetDigest: appDigest("retention-evidence-\(label)-\(index)"),
            failureCodes: [.factEvidenceMissing, .requirementMissing],
            symptomCodes: [.missingCitation, .missingSection],
            observedAt: Date(timeIntervalSince1970: 1_000),
            retentionReviewAt: reviewAt
        )
        guard case let .appended(summary) = try await ledger.record(input) else {
            throw AppRetentionFixtureError.appendFailed(index)
        }
        summaries.append(summary)
    }
    return summaries
}

private func firstAppGateEvent<Element: Sendable>(
    from stream: AsyncStream<Element>,
    timeout: Duration = .seconds(2)
) async -> Element? {
    await withTaskGroup(of: Element?.self) { group in
        group.addTask {
            var iterator = stream.makeAsyncIterator()
            return await iterator.next()
        }
        group.addTask {
            try? await Task.sleep(for: timeout)
            return nil
        }
        let first = await group.next() ?? nil
        group.cancelAll()
        return first
    }
}

private final class AppFileWriteGate: @unchecked Sendable {
    let firstWriteEntered: AsyncStream<Void>
    let releaseFirstWrite = DispatchSemaphore(value: 0)
    private let continuation: AsyncStream<Void>.Continuation
    private let lock = NSLock()
    private var callCount = 0

    init() {
        var captured: AsyncStream<Void>.Continuation?
        firstWriteEntered = AsyncStream(bufferingPolicy: .bufferingNewest(1)) {
            captured = $0
        }
        continuation = captured!
    }

    func write(
        bytes: Data,
        digest: String,
        destination: URL,
        admission: PrivateWriteAdmissionV1
    ) throws -> PrivateVerifiedWriteReceiptV1 {
        let isFirst = lock.withLock {
            callCount += 1
            return callCount == 1
        }
        if isFirst {
            continuation.yield(())
            releaseFirstWrite.wait()
        }
        return try PrivateVerifiedFileWriterV1.writeNew(
            bytes: bytes,
            expectedDigest: digest,
            to: destination,
            admission: admission
        )
    }
}

private actor AppCompletionOrder {
    private(set) var values: [String] = []

    func append(_ value: String) {
        values.append(value)
    }
}

private enum FI09InjectedStorageErrorV1: Error {
    case unexpectedThrow
    case inventoryEscapedRoot
}

private struct FI09DirectoryEntryV1: Equatable {
    let relativePath: String
    let kind: String
    let byteCount: UInt64
    let posixPermissions: Int
}

private struct FI09BaselineEvidenceV1: Equatable {
    let artifactBytes: Data
    let resultBytes: Data
    let uncertifiedRecordBytes: Data
    let result: PipelineResult
    let effectiveState: EffectiveAppState
    let currentness: AcceptanceCurrentness
}

private struct FI09ScenarioExpectationV1 {
    let scenarioID: String
    let availability: IncidentHistoryAvailabilityV1
    let reason: IncidentHistoryCoordinatorReasonV1?
    let captureStatus: String?
    let captureReason: String?
    let openerCallCount: Int
    let faultCallbackCount: Int
    let injectedFaultCount: Int
    let historyCount: Int
}

private struct FI09ScenarioReceiptV1: Encodable, Equatable {
    let scenarioID: String
    let availability: String
    let reason: String?
    let captureStatus: String?
    let captureReason: String?
    let openerCallCount: Int
    let faultCallbackCount: Int
    let injectedFaultCount: Int
    let historyCount: Int
    let influenceFlagsAllFalse: Bool
}

private struct FI09CollectedEvidenceV1 {
    let baseline: FI09BaselineEvidenceV1
    let receipt: FI09ScenarioReceiptV1
}

private struct FI09EvidenceReportV1: Encodable {
    let schemaVersion = 1
    let profile = "veritas-fi09-native-baseline-invariance-v1"
    let status = "PASS_PRIVATE_NATIVE_BASELINE_INVARIANCE_ONLY"
    let scenarioIDs: [String]
    let scenarioCount: Int
    let outageScenarioReceipts: [FI09ScenarioReceiptV1]
    let positiveControlReceipt: FI09ScenarioReceiptV1
    let artifactDigest: String
    let resultEvidenceDigest: String
    let uncertifiedRecordDigest: String
    let negativeControlDigest: String
    let allOutageEvidenceIdentical: Bool
    let positiveControlEvidenceIdentical: Bool
    let negativeControlChanged: Bool
    let slowLateOpenEventCount: Int
    let slowLateOpenedLedgerObserved: Bool
    let slowLateOpenedLedgerClosed: Bool
    let storeFullFaultCallbackCount: Int
    let storeFullInjectedFaultCount: Int
    let storeFullRollbackEventCount: Int
    let storeFullRollbackStateRestored: Bool
    let corruptInventoryUnchanged: Bool
    let positiveControlPersistedEventCount: Int
    let allInfluenceFlagsFalse: Bool
    let productionUncertifiedRecordProducerPresent = true
    let certifiedStatusPossible = false
    let independentCertification = false
    let authorizing = false
}

private func fi09CanonicalBytes<T: Encodable>(_ value: T) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(value)
}

private func fi09DirectoryInventory(_ root: URL) throws -> [FI09DirectoryEntryV1] {
    let standardizedRoot = root.standardizedFileURL.path
    let requiredPrefix = standardizedRoot.hasSuffix("/") ? standardizedRoot : "\(standardizedRoot)/"
    let keys: [URLResourceKey] = [.isDirectoryKey, .isRegularFileKey]
    guard let enumerator = FileManager.default.enumerator(
        at: root,
        includingPropertiesForKeys: keys,
        options: [],
        errorHandler: nil
    ) else { return [] }

    var entries: [FI09DirectoryEntryV1] = []
    for case let url as URL in enumerator {
        let standardizedPath = url.standardizedFileURL.path
        guard standardizedPath.hasPrefix(requiredPrefix) else {
            throw FI09InjectedStorageErrorV1.inventoryEscapedRoot
        }
        let relativePath = String(standardizedPath.dropFirst(requiredPrefix.count))
        let values = try url.resourceValues(forKeys: Set(keys))
        let attributes = try FileManager.default.attributesOfItem(atPath: standardizedPath)
        let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue ?? -1
        let byteCount: UInt64
        if values.isRegularFile == true {
            byteCount = (attributes[.size] as? NSNumber)?.uint64Value ?? 0
        } else {
            byteCount = 0
        }
        let kind = values.isDirectory == true
            ? "DIRECTORY"
            : (values.isRegularFile == true ? "REGULAR_FILE" : "OTHER")
        entries.append(FI09DirectoryEntryV1(
            relativePath: relativePath,
            kind: kind,
            byteCount: byteCount,
            posixPermissions: permissions
        ))
    }
    return entries.sorted { $0.relativePath < $1.relativePath }
}

private func firstLateCleanupEvent(
    from stream: AsyncStream<AppLateCleanupEvent>,
    timeout: Duration = .seconds(2)
) async -> AppLateCleanupEvent? {
    await withTaskGroup(of: AppLateCleanupEvent?.self) { group in
        group.addTask {
            var iterator = stream.makeAsyncIterator()
            return await iterator.next()
        }
        group.addTask {
            try? await Task.sleep(for: timeout)
            return nil
        }
        let first = await group.next() ?? nil
        group.cancelAll()
        return first
    }
}

private func waitForMutationInvalidation(
    _ control: IncidentLifecycleMutationControlV1,
    after baseline: UInt64
) async -> Bool {
    let deadline = ContinuousClock().now.advanced(by: .seconds(2))
    while ContinuousClock().now < deadline {
        if control.invalidationCountForTesting() > baseline { return true }
        do { try await Task.sleep(for: .milliseconds(1)) }
        catch { return false }
    }
    return false
}

@MainActor
private func collectFI09Evidence(
    snapshot: ArtifactSnapshot,
    expectation: FI09ScenarioExpectationV1,
    configuration: IncidentHistoryConfigurationV1?,
    enableHistory: Bool,
    storageTimeout: Duration = .milliseconds(80),
    opener: @escaping IncidentLedgerOpenerV1 = { root, scope in
        try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
    },
    faultProbe: AppFaultProbe? = nil,
    lateOpenCleanupObserver: IncidentLateOpenCleanupObserverV1? = nil,
    afterEvidence: (() -> Void)? = nil
) async throws -> FI09CollectedEvidenceV1 {
    let openerCallCounter = AppOpenCounter()
    let model = AppModel(
        analyzer: DelayedAnalyzer(delay: .milliseconds(1)),
        incidentHistoryConfiguration: configuration,
        incidentStorageOperationTimeout: storageTimeout,
        incidentLedgerOpener: { root, scope in
            openerCallCounter.increment()
            return try await opener(root, scope)
        },
        incidentLateOpenCleanupObserver: lateOpenCleanupObserver
    )
    model.select(snapshot: snapshot)
    model.setMode(.assist)
    await model.awaitSettledForTesting()
    if enableHistory {
        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()
    }

    let result = try #require(model.result)
    let resultBytes = try #require(result.resultEvidenceData)
    let resultDigest = try #require(result.resultEvidenceDigest)
    #expect(ArtifactSnapshot.digest(resultBytes) == resultDigest)
    #expect(result.disposition == .needsAttention)
    #expect(result.canAcceptInsideVeritas == false)
    #expect(model.currentness == .none)
    #expect(model.effectiveState == .blocked)
    #expect(model.lastError == nil)
    #expect(model.selectedSnapshot == snapshot)
    #expect(model.incidentCaptureInFlight == false)
    #expect(model.incidentHistoryAvailability == expectation.availability)
    #expect(model.incidentHistoryReason == expectation.reason)
    #expect(model.incidentHistory.count == expectation.historyCount)
    #expect(openerCallCounter.value == expectation.openerCallCount)
    let faultCounts = faultProbe?.counts ?? AppFaultCounts(callbacks: 0, injected: 0)
    #expect(faultCounts.callbacks == expectation.faultCallbackCount)
    #expect(faultCounts.injected == expectation.injectedFaultCount)

    let outcome = model.incidentCaptureOutcome
    if let expectedStatus = expectation.captureStatus {
        let requiredOutcome = try #require(outcome)
        #expect(requiredOutcome.status.rawValue == expectedStatus)
        #expect(requiredOutcome.reason?.rawValue == expectation.captureReason)
        #expect(requiredOutcome.pipelineResultEvidenceDigest == resultDigest)
    } else {
        #expect(outcome == nil)
        #expect(expectation.captureReason == nil)
    }
    let influenceFlagsAllFalse: Bool
    if let outcome {
        #expect(outcome.authorizing == false)
        #expect(outcome.promptInfluence == false)
        #expect(outcome.repairInfluence == false)
        #expect(outcome.promotionInfluence == false)
        #expect(outcome.certificationInfluence == false)
        #expect(outcome.occurrenceCountEvidence == false)
        influenceFlagsAllFalse = !outcome.authorizing
            && !outcome.promptInfluence
            && !outcome.repairInfluence
            && !outcome.promotionInfluence
            && !outcome.certificationInfluence
            && !outcome.occurrenceCountEvidence
    } else {
        influenceFlagsAllFalse = true
    }

    let uncertifiedRecord = try #require(InternalUncertifiedRecordV1.make(
        result: result,
        currentness: model.currentness
    ))
    #expect(uncertifiedRecord.schemaVersion == 1)
    #expect(uncertifiedRecord.recordType == "VERITAS_INTERNAL_UNCERTIFIED_RECORD_V1")
    #expect(uncertifiedRecord.status == "UNCERTIFIED")
    #expect(uncertifiedRecord.failureIntelligenceUsed == false)
    #expect(uncertifiedRecord.authorizing == false)
    #expect(uncertifiedRecord.independentCertification == false)
    #expect(uncertifiedRecord.limitationCodes == [
        "FAILURE_INTELLIGENCE_NON_AUTHORIZING",
        "INTERNAL_PROTOCOL_RECORD_ONLY",
        "NOT_INDEPENDENT_CERTIFICATION",
    ])
    let evidence = FI09BaselineEvidenceV1(
        artifactBytes: snapshot.bytes,
        resultBytes: resultBytes,
        uncertifiedRecordBytes: try #require(uncertifiedRecord.canonicalData),
        result: result,
        effectiveState: model.effectiveState,
        currentness: model.currentness
    )
    let receipt = FI09ScenarioReceiptV1(
        scenarioID: expectation.scenarioID,
        availability: model.incidentHistoryAvailability.rawValue,
        reason: model.incidentHistoryReason?.rawValue,
        captureStatus: outcome?.status.rawValue,
        captureReason: outcome?.reason?.rawValue,
        openerCallCount: openerCallCounter.value,
        faultCallbackCount: faultCounts.callbacks,
        injectedFaultCount: faultCounts.injected,
        historyCount: model.incidentHistory.count,
        influenceFlagsAllFalse: influenceFlagsAllFalse
    )

    afterEvidence?()
    await model.shutdown()
    return FI09CollectedEvidenceV1(baseline: evidence, receipt: receipt)
}

#if DEBUG
private actor AppReferenceLatch {
    nonisolated let arrivals: AsyncStream<Void>
    private let signal: AsyncStream<Void>.Continuation
    private var waiter: CheckedContinuation<Void, Never>?
    private var entered = false, released = false
    init() {
        let pair = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
        arrivals = pair.stream; signal = pair.continuation
    }
    func suspend() async {
        guard !entered else { return }
        entered = true; signal.yield(()); signal.finish()
        if !released { await withCheckedContinuation { waiter = $0 } }
    }
    func release() { released = true; waiter?.resume(); waiter = nil; signal.finish() }
    nonisolated func wait() async throws {
        let stream = arrivals
        let arrived = try await withThrowingTaskGroup(of: Bool.self) { group in
            group.addTask { for await _ in stream { return true }; return false }
            group.addTask { try await Task.sleep(for: .seconds(3)); return false }
            let value = try await group.next() ?? false; group.cancelAll(); return value
        }
        try #require(arrived, "Real reference task did not reach its boundary")
    }
}

@MainActor private func withAppReferenceCleanup(
    _ model: AppModel, latch: AppReferenceLatch? = nil,
    _ body: @MainActor () async throws -> Void
) async throws {
    let outcome: Result<Void, Error>
    do { try await body(); outcome = .success(()) } catch { outcome = .failure(error) }
    model.beginShutdown(); await latch?.release()
    // Also settles an injected shutdown-join mutant; never abandon a live task
    // merely because the code under test prematurely reported closed.
    await model.awaitSettledForTesting(); await model.finishShutdown()
    try outcome.get()
}

@MainActor private func prepareAppReference(_ model: AppModel) async {
    model.select(snapshot: appSnapshot("reference")); model.setMode(.assist)
    await model.awaitSettledForTesting()
}

@MainActor private func appReferenceBoundary(_ name: String, model: AppModel) {
    switch name {
    case "selection": model.select(snapshot: appSnapshot("replacement"))
    case "identical": model.select(snapshot: model.selectedSnapshot!)
    case "invalid": model.select(snapshot: ArtifactSnapshot(displayName: "Empty", kind: .text, bytes: Data()))
    case "profile": model.setProfile(CheckProfile(id: "new-profile", requiredSections: []))
    case "off": model.setMode(.off)
    case "reanalyze": model.analyzeSelected()
    case "admission": model.revokeReferenceAdmissionForTesting()
    case "shutdown": model.beginShutdown()
    default: Issue.record("Unknown boundary")
    }
}

// Existing lifecycle tests go through the same review/confirm path as the UI.
// This helper grants no build authority and has no alternative execution path.
@MainActor private func startReviewedReferenceRun(_ model: AppModel) -> Bool {
    guard model.prepareReferenceRunReview(), let review = model.referenceRunReview else { return false }
    return model.confirmReferenceRunReview(review)
}

@Suite("App-owned reference run lifecycle", .serialized)
@MainActor
struct AppReferenceRunTests {
    @Test func reviewStagesExactOwnerFactsWithoutConsentOrWorker() async throws {
        let owner = try ReferenceArtifactShadowRunOwner.forIsolatedTests()
        let model = AppModel.forReferenceRunTests(owner: owner)
        try await withAppReferenceCleanup(model) {
            await prepareAppReference(model)
            #expect(model.prepareReferenceRunReview())
            let review = try #require(model.referenceRunReview), d = review.descriptor
            #expect(d.subjectSHA256 == model.selectedSnapshot?.subjectDigest)
            #expect(d.inputByteCount == model.selectedSnapshot?.bytes.count && d.artifactKind == .json)
            #expect(d.profileID == model.activeProfileID && d.profileSHA256 == CheckProfile.prototype.rulesFingerprint)
            #expect(d.packageSHA256 == "c4598e88e9e0a2ce52345bd4ff063359af603e2cbf275570f2453d5aca29fa5f")
            #expect(d.buildReceiptSHA256 == String(repeating: "0", count: 64) && !d.authoritative)
            #expect(d.scalarOperations == 68 && d.taskSlots == 1 && d.declaredBytes > d.inputByteCount)
            #expect(d.declaredBytes <= d.byteLimit && d.scalarOperations <= d.operationLimit && d.taskSlots <= d.taskSlotLimit)
            #expect(owner.state == .ready && owner.workerBeginCountForTesting == 0)
            #expect(!model.referenceTaskRetainedForTesting && model.referenceRunDelivery == nil)
            model.cancelReferenceRunReview(review)
            #expect(model.referenceRunReview == nil && owner.state == .unbound)
            #expect(try owner.reservedBytesForTesting == 0)
            #expect(!model.confirmReferenceRunReview(review))
        }
    }

    @Test func staleSheetActionsCannotChangeReplacementOrConfirmedRun() async throws {
        let latch = AppReferenceLatch()
        let owner = try ReferenceArtifactShadowRunOwner.forSchedulingTests { if $0 == .afterWorkerJoined { await latch.suspend() } }
        let model = AppModel.forReferenceRunTests(owner: owner)
        try await withAppReferenceCleanup(model, latch: latch) {
            await prepareAppReference(model)
            #expect(model.prepareReferenceRunReview()); let old = try #require(model.referenceRunReview)
            #expect(model.prepareReferenceRunReview()); let current = try #require(model.referenceRunReview)
            #expect(old !== current && old.descriptor.subjectSHA256 == current.descriptor.subjectSHA256)
            model.cancelReferenceRunReview(old); #expect(!model.confirmReferenceRunReview(old))
            #expect(model.referenceRunReview === current && owner.state == .ready)
            #expect(model.confirmReferenceRunReview(current)); try await latch.wait()
            #expect(model.referenceRunReview == nil && !model.confirmReferenceRunReview(current))
            model.cancelReferenceRunReview(old); model.cancelReferenceRunReview(current)
            #expect(!model.prepareReferenceRunReview() && model.referenceTaskRetainedForTesting)
            #expect(owner.workerBeginCountForTesting <= 1)
            await latch.release(); await model.awaitSettledForTesting()
            #expect(model.referenceRunDelivery != nil && owner.deliveryAttemptCountForTesting == 1)
        }
    }

    @Test(arguments: ["selection", "identical", "invalid", "profile", "off", "reanalyze", "admission", "shutdown"])
    func allHostBoundariesInvalidatePendingReview(boundary: String) async throws {
        let owner = try ReferenceArtifactShadowRunOwner.forIsolatedTests()
        let model = AppModel.forReferenceRunTests(owner: owner)
        try await withAppReferenceCleanup(model) {
            await prepareAppReference(model); #expect(model.prepareReferenceRunReview())
            let old = try #require(model.referenceRunReview)
            appReferenceBoundary(boundary, model: model)
            #expect(model.referenceRunReview == nil && !model.confirmReferenceRunReview(old))
            model.cancelReferenceRunReview(old)
            #expect(owner.state == .unbound && owner.workerBeginCountForTesting == 0)
            #expect(!model.referenceTaskRetainedForTesting)
        }
    }

    @Test func exclusiveReviewDeadlineDoesNotBecomeAnotherRunWindow() async throws {
        let start = ContinuousClock().now
        var now = start
        let owner = try ReferenceArtifactShadowRunOwner.forIsolatedTests()
        let model = AppModel.forReferenceRunTests(owner: owner, reviewClock: { now })
        try await withAppReferenceCleanup(model) {
            await prepareAppReference(model); #expect(model.prepareReferenceRunReview())
            let old = try #require(model.referenceRunReview)
            #expect(old.expiresAt == start.advanced(by: .seconds(60)))
            now = old.expiresAt
            #expect(!model.confirmReferenceRunReview(old))
            #expect(model.referenceRunFailure == .expired && model.referenceRunReview == nil)
            #expect(owner.state == .unbound && owner.workerBeginCountForTesting == 0)
            #expect(try owner.reservedBytesForTesting == 0)
            #expect(model.prepareReferenceRunReview()); let fresh = try #require(model.referenceRunReview)
            now = fresh.expiresAt.advanced(by: .milliseconds(-1))
            #expect(model.confirmReferenceRunReview(fresh)); await model.awaitSettledForTesting()
            #expect(model.referenceRunDelivery != nil) // Run deadline starts at confirmation, not review creation.
        }
    }

    @Test func buildRevocationBetweenReviewAndConfirmCannotStartWork() async throws {
        let admission = NativeBuildAdmission.forIsolatedOwnerTests()
        let owner = try ReferenceArtifactShadowRunOwner.forAdmittedBuildTests(admission)
        let model = AppModel.forReferenceRunTests(owner: owner)
        try await withAppReferenceCleanup(model) {
            await prepareAppReference(model); #expect(model.prepareReferenceRunReview())
            let old = try #require(model.referenceRunReview); admission.revoke()
            #expect(!model.confirmReferenceRunReview(old))
            #expect(model.referenceRunReview == nil && model.referenceRunFailure == .buildAdmissionRefused)
            #expect(owner.state == .unbound && owner.workerBeginCountForTesting == 0)
            #expect(!model.referenceTaskRetainedForTesting && !model.confirmReferenceRunReview(old))
        }
    }

    @Test func failedReplacementReviewCannotLeaveOldSelectionOrConsent() async throws {
        let admission = NativeBuildAdmission.forIsolatedOwnerTests()
        let owner = try ReferenceArtifactShadowRunOwner.forAdmittedBuildTests(admission)
        let model = AppModel.forReferenceRunTests(owner: owner)
        try await withAppReferenceCleanup(model) {
            await prepareAppReference(model); #expect(model.prepareReferenceRunReview())
            let old = try #require(model.referenceRunReview); admission.revoke()
            #expect(!model.prepareReferenceRunReview())
            #expect(model.referenceRunReview == nil && !model.confirmReferenceRunReview(old))
            #expect(owner.state == .unbound && owner.workerBeginCountForTesting == 0)
        }
    }

    @Test func defaultAdmissionDoesNotRunDespiteReadyPlatformAndSelection() async throws {
        let model = AppModel(analyzer: DeterministicOnlyOrchestrator(), incidentHistoryConfiguration: nil)
        try await withAppReferenceCleanup(model) {
            await prepareAppReference(model)
            #expect(!model.canRunReferenceModel)
            #expect(model.referenceRunUnavailableReason?.contains("admission is not complete") == true)
            #expect(!startReviewedReferenceRun(model))
            #expect(!model.referenceTaskRetainedForTesting)
            #expect(model.referenceRunDelivery == nil && model.referenceRunState == .unavailable)
        }
    }

    @Test func explicitActionDeliversExactNonAuthorizingOutputWithoutBaselineChanges() async throws {
        let owner = try ReferenceArtifactShadowRunOwner.forIsolatedTests()
        let model = AppModel.forReferenceRunTests(owner: owner)
        try await withAppReferenceCleanup(model) {
            await prepareAppReference(model)
            let snapshot = try #require(model.selectedSnapshot)
            let baseline = model.result?.resultEvidenceDigest, currentness = model.currentness
            let state = model.effectiveState, history = model.incidentHistory.count
            #expect(model.canRunReferenceModel && owner.state == .unbound)
            #expect(startReviewedReferenceRun(model))
            await model.awaitSettledForTesting()
            let output = try #require(model.referenceRunDelivery)
            #expect(output.subjectSHA256 == snapshot.subjectDigest && output.artifactKind == snapshot.kind)
            #expect(output.profileID == model.activeProfileID && output.profileSHA256 == CheckProfile.prototype.rulesFingerprint)
            #expect(output.hostEpoch > 0 && !output.authoritative && !output.outputBytes.isEmpty)
            #expect(ArtifactSnapshot.digest(output.outputBytes) == output.outputSHA256)
            #expect(model.referenceRunState == .completed && model.referenceRunFailure == nil)
            #expect(model.result?.resultEvidenceDigest == baseline && model.currentness == currentness)
            #expect(model.effectiveState == state && model.incidentHistory.count == history)
            #expect(model.incidentCaptureOutcome == nil && !model.incidentCaptureEnabled)
            #expect(!model.referenceTaskRetainedForTesting && owner.state == .unbound)
            #expect(await owner.workerStateForTesting == .off)
        }
    }

    @Test func selectionAnalysisAndModeNeverImplyReferenceConsent() async throws {
        let owner = try ReferenceArtifactShadowRunOwner.forIsolatedTests(), modelAnalyzer = SelectionRecordingAnalyzer()
        let model = AppModel.forReferenceRunTests(owner: owner, analyzer: modelAnalyzer)
        try await withAppReferenceCleanup(model) {
            await prepareAppReference(model)
            for index in 0..<12 {
                model.select(snapshot: appSnapshot("select-\(index)"))
                await model.awaitSettledForTesting()
            }
            #expect(owner.deliveryAttemptCountForTesting == 0 && owner.state == .unbound)
            #expect(!model.referenceTaskRetainedForTesting && model.referenceRunDelivery == nil)
            #expect(model.canRunReferenceModel)
            let calls = await modelAnalyzer.callCount
            #expect(startReviewedReferenceRun(model)); await model.awaitSettledForTesting()
            #expect(await modelAnalyzer.callCount == calls) // Reference action never calls AFM/analyzer.
        }
    }

    @Test func doubleActionCannotOverlapOrReplaceRetainedRun() async throws {
        let latch = AppReferenceLatch()
        let owner = try ReferenceArtifactShadowRunOwner.forSchedulingTests { if $0 == .afterWorkerJoined { await latch.suspend() } }
        let model = AppModel.forReferenceRunTests(owner: owner)
        try await withAppReferenceCleanup(model, latch: latch) {
            await prepareAppReference(model)
            #expect(startReviewedReferenceRun(model)); try await latch.wait()
            for _ in 0..<25 { #expect(!startReviewedReferenceRun(model)) }
            #expect(model.referenceRunState == .running && model.referenceTaskRetainedForTesting)
            await latch.release(); await model.awaitSettledForTesting()
            #expect(model.referenceRunDelivery != nil && owner.deliveryAttemptCountForTesting == 1)
        }
    }

    @Test(arguments: ReferenceArtifactShadowRunOwner.ProbePoint.allCases,
          ["selection", "identical", "invalid", "profile", "off", "reanalyze", "admission", "shutdown"])
    func allHostRevocationsSuppressDeliveryAndJoin(point: ReferenceArtifactShadowRunOwner.ProbePoint, boundary: String) async throws {
        let latch = AppReferenceLatch()
        let owner = try ReferenceArtifactShadowRunOwner.forSchedulingTests { if $0 == point { await latch.suspend() } }
        let model = AppModel.forReferenceRunTests(owner: owner)
        try await withAppReferenceCleanup(model, latch: latch) {
            await prepareAppReference(model)
            #expect(startReviewedReferenceRun(model)); try await latch.wait()
            appReferenceBoundary(boundary, model: model)
            #expect(owner.state == .stopping)
            #expect(model.referenceRunState == .stopping && model.referenceTaskRetainedForTesting)
            #expect(model.referenceRunDelivery == nil && !startReviewedReferenceRun(model))
            await latch.release(); await model.awaitSettledForTesting()
            #expect(model.referenceRunDelivery == nil && model.referenceRunFailure == nil)
            #expect(!model.referenceTaskRetainedForTesting && owner.state == .unbound)
            #expect(await owner.workerStateForTesting == .off)
        }
    }

    @Test func cancellationBeforeHostTaskStartsStillClaimsAndJoinsBegunWork() async throws {
        let owner = try ReferenceArtifactShadowRunOwner.forIsolatedTests()
        let model = AppModel.forReferenceRunTests(owner: owner)
        try await withAppReferenceCleanup(model) {
            await prepareAppReference(model)
            #expect(startReviewedReferenceRun(model))
            model.setMode(.off) // Same MainActor turn, before child task can start.
            #expect(model.referenceTaskRetainedForTesting && model.referenceRunState == .stopping)
            await model.awaitSettledForTesting()
            #expect(owner.deliveryAttemptCountForTesting == 1)
            #expect(owner.state == .unbound && model.referenceRunDelivery == nil)
            #expect(await owner.workerStateForTesting == .off)
            #expect(model.effectiveState == .off && !model.referenceTaskRetainedForTesting)
        }
    }

    @Test func offDoesNotReportCompleteWhileReferenceIsStillHeld() async throws {
        let latch = AppReferenceLatch()
        let owner = try ReferenceArtifactShadowRunOwner.forSchedulingTests { if $0 == .afterCleanupBeforeDelivery { await latch.suspend() } }
        let model = AppModel.forReferenceRunTests(owner: owner)
        try await withAppReferenceCleanup(model, latch: latch) {
            await prepareAppReference(model)
            #expect(startReviewedReferenceRun(model)); try await latch.wait()
            let checks = model.referenceQuiescenceChecksForTesting
            model.setMode(.off)
            let limit = ContinuousClock().now.advanced(by: .seconds(2))
            while model.referenceQuiescenceChecksForTesting == checks && ContinuousClock().now < limit { await Task.yield() }
            try #require(model.referenceQuiescenceChecksForTesting > checks)
            #expect(model.effectiveState == .stoppingUncertain && model.referenceTaskRetainedForTesting)
            await latch.release(); await model.awaitSettledForTesting()
            #expect(model.effectiveState == .off && model.referenceRunDelivery == nil)
        }
    }

    @Test func concurrentShutdownCallersWaitForReferenceJoin() async throws {
        let latch = AppReferenceLatch()
        let owner = try ReferenceArtifactShadowRunOwner.forSchedulingTests { if $0 == .afterCleanupBeforeDelivery { await latch.suspend() } }
        let model = AppModel.forReferenceRunTests(owner: owner)
        try await withAppReferenceCleanup(model, latch: latch) {
            await prepareAppReference(model)
            #expect(startReviewedReferenceRun(model)); try await latch.wait()
            model.beginShutdown()
            var finished = 0
            let first = Task { await model.finishShutdown(); finished += 1 }
            let second = Task { await model.finishShutdown(); finished += 1 }
            let limit = ContinuousClock().now.advanced(by: .seconds(2))
            while model.referenceShutdownJoinChecksForTesting < 2 && ContinuousClock().now < limit { await Task.yield() }
            // Nonthrowing: cleanup must always release and join the two tasks.
            #expect(model.referenceShutdownJoinChecksForTesting == 2)
            #expect(finished == 0 && model.effectiveState == .stoppingUncertain)
            await latch.release(); await first.value; await second.value
            #expect(finished == 2 && !model.referenceTaskRetainedForTesting)
            #expect(await owner.workerStateForTesting == .off)
            #expect(model.effectiveState == .off && model.referenceRunDelivery == nil)
        }
    }

    @Test(arguments: ["selection", "identical", "invalid", "profile", "off", "reanalyze", "admission", "shutdown"])
    func finalHostPublicationRechecksAfterBridgeHasJoined(boundary: String) async throws {
        let latch = AppReferenceLatch(), owner = try ReferenceArtifactShadowRunOwner.forIsolatedTests()
        let model = AppModel.forReferenceRunTests(owner: owner, beforePublication: { await latch.suspend() })
        try await withAppReferenceCleanup(model, latch: latch) {
            await prepareAppReference(model)
            #expect(startReviewedReferenceRun(model)); try await latch.wait()
            #expect(owner.state == .unbound && model.referenceTaskRetainedForTesting)
            #expect(await owner.workerStateForTesting == .off)
            appReferenceBoundary(boundary, model: model)
            await latch.release(); await model.awaitSettledForTesting()
            #expect(model.referenceRunDelivery == nil && model.referenceRunFailure == nil)
            #expect(!model.referenceTaskRetainedForTesting)
        }
    }

    @Test func newSelectionSurvivesOldJoinThenRequiresAnotherAction() async throws {
        let latch = AppReferenceLatch()
        let owner = try ReferenceArtifactShadowRunOwner.forSchedulingTests { if $0 == .afterWorkerJoined { await latch.suspend() } }
        let model = AppModel.forReferenceRunTests(owner: owner)
        try await withAppReferenceCleanup(model, latch: latch) {
            await prepareAppReference(model)
            #expect(startReviewedReferenceRun(model)); try await latch.wait()
            let replacement = appSnapshot("new-selection")
            model.select(snapshot: replacement)
            #expect(!startReviewedReferenceRun(model))
            await latch.release(); await model.awaitSettledForTesting()
            #expect(model.selectedSnapshot?.subjectDigest == replacement.subjectDigest)
            #expect(model.referenceRunDelivery == nil && model.canRunReferenceModel)
            #expect(startReviewedReferenceRun(model)); await model.awaitSettledForTesting()
            #expect(model.referenceRunDelivery?.subjectSHA256 == replacement.subjectDigest)
            #expect(owner.deliveryAttemptCountForTesting == 2)
        }
    }

    @Test func realBudgetRefusalStaysSeparateFromPipelineEvidence() async throws {
        let owner = try ReferenceArtifactShadowRunOwner.forBudgetTests()
        let model = AppModel.forReferenceRunTests(owner: owner)
        try await withAppReferenceCleanup(model) {
            await prepareAppReference(model)
            let baseline = model.result?.resultEvidenceDigest, priorError = model.lastError
            #expect(startReviewedReferenceRun(model)); await model.awaitSettledForTesting()
            #expect(model.referenceRunState == .refused && model.referenceRunFailure == .numericBudgetRefused)
            #expect(model.referenceRunDelivery == nil && model.result?.resultEvidenceDigest == baseline)
            #expect(model.lastError == priorError && !model.referenceTaskRetainedForTesting)
            #expect(owner.state == .unbound)
            #expect(await owner.workerStateForTesting == .off)
        }
    }

    @Test func deadlineStillAppliesAfterTheHostJoin() async throws {
        let latch = AppReferenceLatch(), owner = try ReferenceArtifactShadowRunOwner.forIsolatedTests()
        let model = AppModel.forReferenceRunTests(owner: owner, beforePublication: { await latch.suspend() })
        try await withAppReferenceCleanup(model, latch: latch) {
            await prepareAppReference(model)
            #expect(startReviewedReferenceRun(model)); try await latch.wait()
            try await Task.sleep(for: .milliseconds(950))
            await latch.release(); await model.awaitSettledForTesting()
            #expect(model.referenceRunDelivery == nil && model.referenceRunFailure == .expired)
            #expect(model.referenceRunState == .refused && !model.referenceTaskRetainedForTesting)
        }
    }
}
#endif

@Suite("Truthful menu-bar state")
@MainActor
struct AppModelTests {
    @Test("Unsupported platforms are blocked before analysis")
    func unsupportedPlatformCannotAnalyze() async throws {
        let denied = PlatformRequirements.evaluate(
            PlatformFacts(
                operatingSystem: .macOS,
                macOSMajor: 26,
                architecture: .x86_64
            )
        )
        try await withSelectionTestModel(platform: denied) { model, analyzer in
            model.select(snapshot: appSnapshot("unsupported"))
            model.setMode(.assist)
            await model.awaitSettledForTesting()
            #expect(model.effectiveState == .blocked)
            #expect(model.result == nil)
            #expect(model.lastError?.contains("PLATFORM_MACOS_27_REQUIRED") == true)
            #expect(model.lastError?.contains("PLATFORM_APPLE_SILICON_ARM64_REQUIRED") == true)
            #expect(await analyzer.callCount == 0)
        }
    }

    @Test("Mode intent without an artifact cannot fabricate readiness")
    func noArtifactNoReadyState() {
        let model = AppModel(analyzer: DelayedAnalyzer())

        model.setMode(.assist)

        #expect(model.effectiveState == .blocked)
        #expect(model.result == nil)
    }

    @Test("A newer selected snapshot owns the displayed result")
    func newestSnapshotWins() async throws {
        let model = AppModel(analyzer: DelayedAnalyzer())
        let first = appSnapshot("first")
        let second = appSnapshot("second")
        model.select(snapshot: first)
        model.setMode(.assist)
        model.select(snapshot: second)

        // Wait for owned analysis work, not elapsed wall time. Parallel builds
        // and tests may legitimately leave this task starting after 350 ms.
        await model.awaitSettledForTesting()

        #expect(model.selectedSnapshot?.subjectDigest == second.subjectDigest)
        #expect(model.result?.subjectDigest == second.subjectDigest)
        #expect(model.effectiveState == .assistReady)
        await model.shutdown()
    }

    @Test("Selection owns bytes before later external mutation and advisory dispatch")
    func selectedSnapshotOwnsExternalBytes() async throws {
        let original = Data("{\"name\":\"immutable-selection\"}".utf8)
        let buffer = UnsafeMutableRawPointer.allocate(byteCount: original.count, alignment: 1)
        defer { buffer.deallocate() }
        original.copyBytes(to: buffer.assumingMemoryBound(to: UInt8.self), count: original.count)
        let external = Data(bytesNoCopy: buffer, count: original.count, deallocator: .none)
        let snapshot = ArtifactSnapshot(displayName: "external.json", kind: .json, bytes: external)
        try await withSelectionTestModel { model, analyzer in
            model.select(snapshot: snapshot)
            buffer.storeBytes(of: UInt8(ascii: "z"), toByteOffset: 9, as: UInt8.self)
            // Prove the adverse fixture really aliases; small inline Data would not.
            try #require(snapshot.bytes[9] == UInt8(ascii: "z"))
            try #require(ArtifactSnapshot.digest(snapshot.bytes) != snapshot.subjectDigest)
            #expect(model.selectedSnapshot?.bytes == original)
            #expect(model.selectedSnapshot?.subjectDigest == ArtifactSnapshot.digest(original))
            #expect(model.selectedSnapshot?.displayName == "external.json")
            #expect(model.selectedSnapshot?.kind == .json)
            #expect(await analyzer.callCount == 0)
            model.setMode(.assist)
            await model.awaitSettledForTesting()
            let requests = await analyzer.plans
            let request = try #require(requests.first)
            #expect(requests.count == 1)
            #expect(request.excerpt == String(data: original, encoding: .utf8))
            #expect(request.subjectDigest == ArtifactSnapshot.digest(original))
            #expect(request.artifactKind == .json)
            #expect(model.result?.subjectDigest == request.subjectDigest)
            #expect(model.result?.canAcceptInsideVeritas == true)
            model.acceptExactVersion()
            await model.awaitSettledForTesting()
            #expect(model.currentness == .current)
            #expect(model.selectedSnapshot?.bytes == original)
        }
    }

    @Test("Empty, oversized and already-changed direct snapshots revoke selection without model calls")
    func directSnapshotSelectionRefusesInvalidInput() async throws {
        let original = Data("{\"name\":\"stale-before-selection\"}".utf8)
        let buffer = UnsafeMutableRawPointer.allocate(byteCount: original.count, alignment: 1)
        defer { buffer.deallocate() }
        original.copyBytes(to: buffer.assumingMemoryBound(to: UInt8.self), count: original.count)
        let stale = ArtifactSnapshot(displayName: "stale.json", kind: .json,
            bytes: Data(bytesNoCopy: buffer, count: original.count, deallocator: .none))
        buffer.storeBytes(of: UInt8(ascii: "z"), toByteOffset: 9, as: UInt8.self)
        try #require(ArtifactSnapshot.digest(stale.bytes) != stale.subjectDigest)
        let cases: [(ArtifactSnapshot, String)] = [
            (ArtifactSnapshot(displayName: "empty.txt", kind: .text, bytes: Data()),
             SnapshotError.empty.localizedDescription),
            (ArtifactSnapshot(displayName: "large.txt", kind: .text,
                              bytes: Data(repeating: 97, count: ArtifactSnapshotter.prototypeByteLimit + 1)),
             SnapshotError.exceedsByteLimit(actual: ArtifactSnapshotter.prototypeByteLimit + 1,
                                           limit: ArtifactSnapshotter.prototypeByteLimit).localizedDescription),
            (stale, "SNAPSHOT_IDENTITY_CHANGED: The snapshot bytes changed before selection. Choose the artifact again.")
        ]
        for (snapshot, message) in cases {
            try await withSelectionTestModel { model, analyzer in
                model.select(snapshot: appSnapshot("previously-accepted"))
                model.setMode(.assist)
                await model.awaitSettledForTesting()
                model.acceptExactVersion()
                await model.awaitSettledForTesting()
                try #require(model.currentness == .current)
                let priorCalls = await analyzer.callCount
                #expect(priorCalls == 2)
                model.select(snapshot: snapshot)
                #expect(model.selectedSnapshot == nil)
                #expect(model.result == nil)
                #expect(model.currentness == .stale)
                #expect(model.effectiveState == .blocked)
                #expect(model.lastError == message)
                model.analyzeSelected()
                await model.awaitSettledForTesting()
                #expect(await analyzer.callCount == priorCalls)
                #expect(model.selectedSnapshot == nil && model.result == nil)
            }
        }
    }

    @Test("Direct selection admits exact byte limits while OFF and leaves semantic checks to the gate")
    func directSnapshotSelectionByteBoundaries() async throws {
        try await withSelectionTestModel { model, analyzer in
            for bytes in [Data([97]), Data(repeating: 97, count: ArtifactSnapshotter.prototypeByteLimit),
                          Data([0xff])] {
                let snapshot = ArtifactSnapshot(displayName: "boundary.txt", kind: .text, bytes: bytes)
                model.select(snapshot: snapshot)
                await model.awaitSettledForTesting()
                #expect(model.selectedSnapshot?.bytes == bytes)
                #expect(model.selectedSnapshot?.subjectDigest == ArtifactSnapshot.digest(bytes))
                #expect(model.lastError == nil)
                #expect(model.effectiveState == .off)
                #expect(model.result == nil)
                #expect(await analyzer.callCount == 0)
            }
            // UTF-8 is a deterministic semantic check, not a new intake assumption.
            model.setMode(.assist)
            await model.awaitSettledForTesting()
            #expect(model.result?.deterministicPassed == false)
            #expect(await analyzer.callCount == 0)
        }
    }

    @Test("OFF remains uncertain until admitted analyzer work is actually quiescent")
    func offWaitsForQuiescence() async throws {
        let analyzer = DelayedAnalyzer(delay: .milliseconds(180))
        let model = AppModel(analyzer: analyzer)
        model.select(snapshot: appSnapshot("slow"))
        model.setMode(.assist)
        await analyzer.waitUntilActive()

        model.setMode(.off)
        #expect(model.effectiveState == .stoppingUncertain)
        try await Task.sleep(for: .milliseconds(50))
        #expect(model.effectiveState == .stoppingUncertain)
        await model.awaitSettledForTesting()
        #expect(model.effectiveState == .off)
    }

    @Test("Selecting another file while OFF is stopping restarts quiescence confirmation")
    func selectionDuringStopStillConvergesToOff() async throws {
        let analyzer = DelayedAnalyzer(delay: .milliseconds(220))
        let model = AppModel(analyzer: analyzer)
        model.select(snapshot: appSnapshot("slow-a"))
        model.setMode(.assist)
        await analyzer.waitUntilActive()

        model.setMode(.off)
        #expect(model.effectiveState == .stoppingUncertain)
        model.select(snapshot: appSnapshot("slow-b"))
        #expect(model.effectiveState == .stoppingUncertain)
        try await Task.sleep(for: .milliseconds(75))
        #expect(model.effectiveState == .stoppingUncertain)
        await model.awaitSettledForTesting()
        #expect(model.effectiveState == .off)
        #expect(model.selectedSnapshot?.subjectDigest == appSnapshot("slow-b").subjectDigest)
        #expect(model.result == nil)
    }

    @Test("A failed file selection cannot leave acceptance marked current")
    func failedSelectionStalesCurrentAcceptance() async throws {
        let model = AppModel(analyzer: DelayedAnalyzer(delay: .milliseconds(1)))
        model.select(snapshot: appSnapshot("accepted"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        #expect(model.result?.canAcceptInsideVeritas == true)

        model.acceptExactVersion()
        await model.awaitSettledForTesting()
        #expect(model.currentness == .current)

        let emptyURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("codename-veritas-empty-\(UUID().uuidString).json")
        try Data().write(to: emptyURL)
        defer { try? FileManager.default.removeItem(at: emptyURL) }

        model.select(url: emptyURL)

        #expect(model.selectedSnapshot == nil)
        #expect(model.result == nil)
        #expect(model.currentness == .stale)
        await model.shutdown()
    }

    @Test("ENFORCE stays blocked until a real enforcement route exists")
    func enforceCannotAppearReady() async throws {
        let model = AppModel(analyzer: DelayedAnalyzer())
        model.select(snapshot: appSnapshot("enforce"))
        model.setMode(.enforce)
        await model.awaitSettledForTesting()

        #expect(model.effectiveState == .blocked)
        #expect(model.result?.limitationCodes.contains("ENFORCE_ROUTE_NOT_IMPLEMENTED") == true)
    }

    @Test("Default-disabled history publishes a failure without opening storage")
    func disabledHistoryDoesNotOpenStorage() async throws {
        let root = try makeAppHistoryRoot()
        let scope = appHistoryScope()
        let counter = AppOpenCounter()
        let configuration = IncidentHistoryConfigurationV1.existing(
            rootDirectory: root,
            scope: scope
        )
        let model = AppModel(
            analyzer: DelayedAnalyzer(delay: .milliseconds(1)),
            incidentHistoryConfiguration: configuration,
            incidentLedgerOpener: { root, scope in
                counter.increment()
                return try await LocalIncidentLedgerV1.open(
                    rootDirectory: root,
                    scope: scope
                )
            }
        )
        let snapshot = failingAppSnapshot()

        model.select(snapshot: snapshot)
        model.setMode(.assist)
        await model.awaitSettledForTesting()

        #expect(model.result?.subjectDigest == snapshot.subjectDigest)
        #expect(model.result?.disposition == .needsAttention)
        #expect(model.incidentCaptureEnabled == false)
        #expect(model.incidentHistoryAvailability == .disabled)
        #expect(model.incidentCaptureOutcome == nil)
        #expect(model.incidentHistory.isEmpty)
        #expect(counter.value == 0)
        #expect(!FileManager.default.fileExists(
            atPath: root.appendingPathComponent("projects").path
        ))

        await model.shutdown()
        try FileManager.default.removeItem(at: root)
    }

    @Test("FI0.9 history outages preserve exact baseline and uncertified bytes")
    func failureIntelligenceOutagesPreserveBaseline() async throws {
        let snapshot = failingAppSnapshot("fi09-frozen-input")

        let disabledRoot = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: disabledRoot) }
        let disabled = try await collectFI09Evidence(
            snapshot: snapshot,
            expectation: FI09ScenarioExpectationV1(
                scenarioID: "DISABLED_HISTORY",
                availability: .disabled,
                reason: .userDisabled,
                captureStatus: nil,
                captureReason: nil,
                openerCallCount: 0,
                faultCallbackCount: 0,
                injectedFaultCount: 0,
                historyCount: 0
            ),
            configuration: .existing(
                rootDirectory: disabledRoot,
                scope: appHistoryScope("fi09-disabled")
            ),
            enableHistory: false
        )
        #expect(!FileManager.default.fileExists(
            atPath: disabledRoot.appendingPathComponent("projects").path
        ))
        let baseline = disabled.baseline

        var outageScenarios: [FI09CollectedEvidenceV1] = [disabled]

        outageScenarios.append(
            try await collectFI09Evidence(
                snapshot: snapshot,
                expectation: FI09ScenarioExpectationV1(
                    scenarioID: "ABSENT_CONFIGURATION",
                    availability: .refused,
                    reason: .configurationInvalid,
                    captureStatus: nil,
                    captureReason: nil,
                    openerCallCount: 0,
                    faultCallbackCount: 0,
                    injectedFaultCount: 0,
                    historyCount: 0
                ),
                configuration: nil,
                enableHistory: true
            )
        )

        let malformedConfiguration = IncidentHistoryConfigurationV1.existing(
            rootDirectory: try #require(URL(string: "https://invalid.veritas.local/history")),
            scope: appHistoryScope("fi09-malformed-configuration")
        )
        outageScenarios.append(
            try await collectFI09Evidence(
                snapshot: snapshot,
                expectation: FI09ScenarioExpectationV1(
                    scenarioID: "MALFORMED_CONFIGURATION",
                    availability: .refused,
                    reason: .configurationInvalid,
                    captureStatus: nil,
                    captureReason: nil,
                    openerCallCount: 0,
                    faultCallbackCount: 0,
                    injectedFaultCount: 0,
                    historyCount: 0
                ),
                configuration: malformedConfiguration,
                enableHistory: true
            )
        )

        let corruptRoot = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: corruptRoot) }
        let corruptScope = appHistoryScope("fi09-corrupt")
        let corruptProjectDirectory = corruptRoot
            .appendingPathComponent("projects", isDirectory: true)
            .appendingPathComponent(corruptScope.projectDigest, isDirectory: true)
        try FileManager.default.createDirectory(
            at: corruptProjectDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: NSNumber(value: 0o700)]
        )
        let corruptDatabase = corruptProjectDirectory
            .appendingPathComponent("incident-ledger-v1.sqlite3")
        let corruptBytes = Data("FI09-CORRUPT-DATABASE-CANARY".utf8)
        try corruptBytes.write(to: corruptDatabase)
        try FileManager.default.setAttributes(
            [.posixPermissions: NSNumber(value: 0o600)],
            ofItemAtPath: corruptDatabase.path
        )
        let corruptInventoryBefore = try fi09DirectoryInventory(corruptRoot)
        outageScenarios.append(
            try await collectFI09Evidence(
                snapshot: snapshot,
                expectation: FI09ScenarioExpectationV1(
                    scenarioID: "CORRUPT_DATABASE",
                    availability: .refused,
                    reason: .integrityRefused,
                    captureStatus: nil,
                    captureReason: nil,
                    openerCallCount: 1,
                    faultCallbackCount: 0,
                    injectedFaultCount: 0,
                    historyCount: 0
                ),
                configuration: .existing(rootDirectory: corruptRoot, scope: corruptScope),
                enableHistory: true
            )
        )
        #expect(try Data(contentsOf: corruptDatabase) == corruptBytes)
        let corruptInventoryAfter = try fi09DirectoryInventory(corruptRoot)
        let corruptInventoryUnchanged = corruptInventoryAfter == corruptInventoryBefore
        #expect(corruptInventoryUnchanged)

        let slowRoot = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: slowRoot) }
        let slowScope = appHistoryScope("fi09-slow")
        let slowGate = AppOpenGate()
        let slowWitness = AppLateCleanupWitness()
        outageScenarios.append(
            try await collectFI09Evidence(
                snapshot: snapshot,
                expectation: FI09ScenarioExpectationV1(
                    scenarioID: "SLOW_BUDGET_EXCEEDED",
                    availability: .unavailable,
                    reason: .openUncertain,
                    captureStatus: nil,
                    captureReason: nil,
                    openerCallCount: 1,
                    faultCallbackCount: 0,
                    injectedFaultCount: 0,
                    historyCount: 0
                ),
                configuration: .existing(rootDirectory: slowRoot, scope: slowScope),
                enableHistory: true,
                storageTimeout: .milliseconds(60),
                opener: { root, scope in
                    slowGate.block()
                    return try await LocalIncidentLedgerV1.open(
                        rootDirectory: root,
                        scope: scope
                    )
                },
                lateOpenCleanupObserver: { databaseURL, result in
                    slowWitness.publish(databaseURL: databaseURL, result: result)
                },
                afterEvidence: { slowGate.release.signal() }
            )
        )
        let slowLateCleanupEvent = await firstLateCleanupEvent(from: slowWitness.events)
        let slowLateOpenedLedgerObserved = slowLateCleanupEvent != nil
        #expect(slowLateOpenedLedgerObserved)
        let expectedSlowDatabase = slowRoot
            .appendingPathComponent("projects", isDirectory: true)
            .appendingPathComponent(slowScope.projectDigest, isDirectory: true)
            .appendingPathComponent("incident-ledger-v1.sqlite3")
            .standardizedFileURL
        #expect(slowLateCleanupEvent?.databaseURL.standardizedFileURL == expectedSlowDatabase)
        let slowLateOpenedLedgerClosed = slowLateCleanupEvent?.result == .closed
        #expect(slowLateOpenedLedgerClosed)
        let slowVerification = try await LocalIncidentLedgerV1.open(
            rootDirectory: slowRoot,
            scope: slowScope
        )
        let slowLateOpenEventCount = Int(try await slowVerification.verifyIntegrity().eventCount)
        #expect(slowLateOpenEventCount == 0)
        try await slowVerification.close()

        let unavailableRoot = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: unavailableRoot) }
        outageScenarios.append(
            try await collectFI09Evidence(
                snapshot: snapshot,
                expectation: FI09ScenarioExpectationV1(
                    scenarioID: "UNAVAILABLE_STORAGE",
                    availability: .unavailable,
                    reason: .storageUnavailable,
                    captureStatus: nil,
                    captureReason: nil,
                    openerCallCount: 1,
                    faultCallbackCount: 0,
                    injectedFaultCount: 0,
                    historyCount: 0
                ),
                configuration: .existing(
                    rootDirectory: unavailableRoot,
                    scope: appHistoryScope("fi09-unavailable")
                ),
                enableHistory: true,
                opener: { _, _ in throw IncidentLedgerErrorV1.unsupportedStorage }
            )
        )

        let storeFullRoot = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: storeFullRoot) }
        let storeFullScope = appHistoryScope("fi09-store-full")
        let storeFullFaultProbe = AppFaultProbe()
        let storeFullLedger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: storeFullRoot,
            scope: storeFullScope
        ) { point in
            try storeFullFaultProbe.inject(point)
        }
        let storeFullBefore = try await storeFullLedger.verifyIntegrity()
        storeFullFaultProbe.reset()
        outageScenarios.append(
            try await collectFI09Evidence(
                snapshot: snapshot,
                expectation: FI09ScenarioExpectationV1(
                    scenarioID: "STORE_FULL",
                    availability: .unavailable,
                    reason: .storageUnavailable,
                    captureStatus: PipelineIncidentCaptureStatusV1.unavailable.rawValue,
                    captureReason: PipelineIncidentCaptureReasonV1.ledgerWriteFailed.rawValue,
                    openerCallCount: 1,
                    faultCallbackCount: 2,
                    injectedFaultCount: 1,
                    historyCount: 0
                ),
                configuration: .existing(
                    rootDirectory: storeFullRoot,
                    scope: storeFullScope
                ),
                enableHistory: true,
                opener: { _, _ in storeFullLedger },
                faultProbe: storeFullFaultProbe
            )
        )
        let storeFullVerification = try await LocalIncidentLedgerV1.open(
            rootDirectory: storeFullRoot,
            scope: storeFullScope
        )
        let storeFullAfter = try await storeFullVerification.verifyIntegrity()
        let storeFullRollbackEventCount = Int(storeFullAfter.eventCount)
        #expect(storeFullRollbackEventCount == 0)
        let storeFullRollbackStateRestored = storeFullAfter == storeFullBefore
        #expect(storeFullRollbackStateRestored)
        try await storeFullVerification.close()

        let thrownRoot = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: thrownRoot) }
        outageScenarios.append(
            try await collectFI09Evidence(
                snapshot: snapshot,
                expectation: FI09ScenarioExpectationV1(
                    scenarioID: "UNEXPECTED_THROW",
                    availability: .unavailable,
                    reason: .storageUnavailable,
                    captureStatus: nil,
                    captureReason: nil,
                    openerCallCount: 1,
                    faultCallbackCount: 0,
                    injectedFaultCount: 0,
                    historyCount: 0
                ),
                configuration: .existing(
                    rootDirectory: thrownRoot,
                    scope: appHistoryScope("fi09-threw")
                ),
                enableHistory: true,
                opener: { _, _ in throw FI09InjectedStorageErrorV1.unexpectedThrow }
            )
        )

        #expect(outageScenarios.map(\.receipt.scenarioID) == [
            "DISABLED_HISTORY",
            "ABSENT_CONFIGURATION",
            "MALFORMED_CONFIGURATION",
            "CORRUPT_DATABASE",
            "SLOW_BUDGET_EXCEEDED",
            "UNAVAILABLE_STORAGE",
            "STORE_FULL",
            "UNEXPECTED_THROW",
        ])
        let allOutageEvidenceIdentical = outageScenarios.allSatisfy {
            $0.baseline == baseline
        }
        #expect(allOutageEvidenceIdentical)
        for scenario in outageScenarios {
            #expect(scenario.baseline == baseline)
        }

        let positiveRoot = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: positiveRoot) }
        let positiveScope = appHistoryScope("fi09-positive-control")
        let positiveControl = try await collectFI09Evidence(
            snapshot: snapshot,
            expectation: FI09ScenarioExpectationV1(
                scenarioID: "POSITIVE_CAPTURE_CONTROL",
                availability: .available,
                reason: nil,
                captureStatus: PipelineIncidentCaptureStatusV1.appended.rawValue,
                captureReason: nil,
                openerCallCount: 1,
                faultCallbackCount: 0,
                injectedFaultCount: 0,
                historyCount: 1
            ),
            configuration: .existing(rootDirectory: positiveRoot, scope: positiveScope),
            enableHistory: true
        )
        let positiveControlEvidenceIdentical = positiveControl.baseline == baseline
        #expect(positiveControlEvidenceIdentical)
        let positiveVerification = try await LocalIncidentLedgerV1.open(
            rootDirectory: positiveRoot,
            scope: positiveScope
        )
        let positiveControlPersistedEventCount = Int(
            try await positiveVerification.verifyIntegrity().eventCount
        )
        #expect(positiveControlPersistedEventCount == 1)
        try await positiveVerification.close()

        let negativeControl = try #require(InternalUncertifiedRecordV1.make(
            result: baseline.result,
            currentness: .stale
        ))
        let negativeControlBytes = try #require(negativeControl.canonicalData)
        let negativeControlChanged = negativeControlBytes != baseline.uncertifiedRecordBytes
        #expect(negativeControlChanged)

        let allInfluenceFlagsFalse = (
            outageScenarios.map(\.receipt) + [positiveControl.receipt]
        ).allSatisfy(\.influenceFlagsAllFalse)
        #expect(allInfluenceFlagsFalse)

        let report = FI09EvidenceReportV1(
            scenarioIDs: outageScenarios.map(\.receipt.scenarioID),
            scenarioCount: outageScenarios.count,
            outageScenarioReceipts: outageScenarios.map(\.receipt),
            positiveControlReceipt: positiveControl.receipt,
            artifactDigest: ArtifactSnapshot.digest(baseline.artifactBytes),
            resultEvidenceDigest: try #require(baseline.result.resultEvidenceDigest),
            uncertifiedRecordDigest: ArtifactSnapshot.digest(baseline.uncertifiedRecordBytes),
            negativeControlDigest: ArtifactSnapshot.digest(negativeControlBytes),
            allOutageEvidenceIdentical: allOutageEvidenceIdentical,
            positiveControlEvidenceIdentical: positiveControlEvidenceIdentical,
            negativeControlChanged: negativeControlChanged,
            slowLateOpenEventCount: slowLateOpenEventCount,
            slowLateOpenedLedgerObserved: slowLateOpenedLedgerObserved,
            slowLateOpenedLedgerClosed: slowLateOpenedLedgerClosed,
            storeFullFaultCallbackCount: storeFullFaultProbe.counts.callbacks,
            storeFullInjectedFaultCount: storeFullFaultProbe.counts.injected,
            storeFullRollbackEventCount: storeFullRollbackEventCount,
            storeFullRollbackStateRestored: storeFullRollbackStateRestored,
            corruptInventoryUnchanged: corruptInventoryUnchanged,
            positiveControlPersistedEventCount: positiveControlPersistedEventCount,
            allInfluenceFlagsFalse: allInfluenceFlagsFalse
        )
        let reportBytes = try fi09CanonicalBytes(report)
        let reportText = try #require(String(data: reportBytes, encoding: .utf8))
        MachineEvidence.record("VERITAS_FI09_EVIDENCE_JSON \(reportText)")
    }

    @Test("Explicit opt-in stores one failure and equivalent replays collapse across relaunch")
    func optInCaptureIsResultIsolatedAndReplayCollapsed() async throws {
        let root = try makeAppHistoryRoot()
        let scope = appHistoryScope()
        let configuration = IncidentHistoryConfigurationV1.existing(
            rootDirectory: root,
            scope: scope
        )
        let snapshot = failingAppSnapshot("replay")
        let model = AppModel(
            analyzer: DelayedAnalyzer(delay: .milliseconds(1)),
            incidentHistoryConfiguration: configuration
        )
        model.select(snapshot: snapshot)
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        let baseline = try #require(model.result)
        let baselineDigest = try #require(baseline.resultEvidenceDigest)

        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()

        #expect(model.result == baseline)
        #expect(model.result?.resultEvidenceDigest == baselineDigest)
        #expect(model.incidentCaptureOutcome?.status == .appended)
        #expect(model.incidentCaptureOutcome?.pipelineResultEvidenceDigest == baselineDigest)
        #expect(model.incidentHistoryAvailability == .available)
        #expect(model.incidentHistory.count == 1)
        #expect(model.incidentHistory[0].rawContentStored == false)
        #expect(model.incidentHistory[0].authorizing == false)

        model.analyzeSelected()
        await model.awaitSettledForTesting()
        #expect(model.result == baseline)
        #expect(model.incidentCaptureOutcome?.status == .idempotentDuplicate)
        #expect(model.incidentHistory.count == 1)
        await model.shutdown()

        let relaunched = AppModel(
            analyzer: DelayedAnalyzer(delay: .milliseconds(1)),
            incidentHistoryConfiguration: configuration
        )
        relaunched.select(snapshot: snapshot)
        relaunched.setMode(.assist)
        await relaunched.awaitSettledForTesting()
        relaunched.setIncidentCaptureEnabled(true)
        await relaunched.awaitSettledForTesting()
        #expect(relaunched.incidentCaptureOutcome?.status == .idempotentDuplicate)
        #expect(relaunched.incidentHistory.count == 1)
        await relaunched.shutdown()

        let verificationLedger = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: scope
        )
        #expect(try await verificationLedger.verifyIntegrity().eventCount == 1)
        try await verificationLedger.close()
        try FileManager.default.removeItem(at: root)
    }

    @Test("PASS and OFF routes never open incident storage")
    func noneligibleRoutesDoNotOpenStorage() async throws {
        let root = try makeAppHistoryRoot()
        let scope = appHistoryScope()
        let counter = AppOpenCounter()
        let model = AppModel(
            analyzer: DelayedAnalyzer(delay: .milliseconds(1)),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentLedgerOpener: { root, scope in
                counter.increment()
                return try await LocalIncidentLedgerV1.open(
                    rootDirectory: root,
                    scope: scope
                )
            }
        )
        model.select(snapshot: appSnapshot("passing"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        #expect(model.result?.deterministicPassed == true)

        model.setIncidentCaptureEnabled(true)
        model.analyzeSelected()
        await model.awaitSettledForTesting()
        #expect(model.incidentCaptureOutcome == nil)
        #expect(counter.value == 0)

        model.setMode(.off)
        await model.awaitSettledForTesting()
        #expect(model.effectiveState == .off)
        #expect(model.incidentCaptureEnabled == false)
        #expect(counter.value == 0)

        await model.shutdown()
        try FileManager.default.removeItem(at: root)
    }

    @Test("Snapshot replacement revokes capture while its one ledger open is blocked")
    func snapshotReplacementRevokesBlockedOpen() async throws {
        let root = try makeAppHistoryRoot()
        let scope = appHistoryScope()
        let gate = AppOpenGate()
        var entered = gate.entered.makeAsyncIterator()
        let model = AppModel(
            analyzer: DelayedAnalyzer(delay: .milliseconds(1)),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentLedgerOpener: { root, scope in
                gate.block()
                return try await LocalIncidentLedgerV1.open(
                    rootDirectory: root,
                    scope: scope
                )
            }
        )
        model.select(snapshot: failingAppSnapshot("old-subject"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        model.setIncidentCaptureEnabled(true)
        let didEnter: Void? = await entered.next()
        #expect(didEnter != nil)

        let replacement = appSnapshot("replacement")
        model.select(snapshot: replacement)
        gate.release.signal()
        await model.awaitSettledForTesting()

        #expect(model.selectedSnapshot?.subjectDigest == replacement.subjectDigest)
        #expect(model.result?.subjectDigest == replacement.subjectDigest)
        #expect(model.result?.deterministicPassed == true)
        #expect(model.incidentCaptureOutcome == nil)
        #expect(model.incidentHistory.isEmpty)
        await model.shutdown()

        let verificationLedger = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: scope
        )
        #expect(try await verificationLedger.verifyIntegrity().eventCount == 0)
        try await verificationLedger.close()
        try FileManager.default.removeItem(at: root)
    }

    @Test("Profile replacement revokes an in-transaction capture")
    func profileReplacementRevokesTransaction() async throws {
        let root = try makeAppHistoryRoot()
        let scope = appHistoryScope()
        let gate = AppTransactionGate()
        var entered = gate.entered.makeAsyncIterator()
        let injectedLedger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            faultInjector: gate.inject
        )
        let model = AppModel(
            analyzer: DelayedAnalyzer(delay: .milliseconds(1)),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentLedgerOpener: { _, _ in injectedLedger }
        )
        model.select(snapshot: failingAppSnapshot("profile-old"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        model.setIncidentCaptureEnabled(true)
        let didEnter: Void? = await entered.next()
        #expect(didEnter != nil)

        let replacementProfile = CheckProfile(
            id: "veritas-profile-replacement-test",
            requiredSections: ["Testing"]
        )
        model.setProfile(replacementProfile)
        model.setIncidentCaptureEnabled(false)
        gate.release.signal()
        await model.awaitSettledForTesting()

        #expect(model.result?.profileFingerprint == replacementProfile.rulesFingerprint)
        #expect(model.incidentCaptureEnabled == false)
        #expect(model.incidentHistory.isEmpty)
        await model.shutdown()

        let verificationLedger = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: scope
        )
        #expect(try await verificationLedger.verifyIntegrity().eventCount == 0)
        try await verificationLedger.close()
        try FileManager.default.removeItem(at: root)
    }

    @Test("OFF waits for an in-transaction capture to roll back and close")
    func offWaitsForIncidentRollback() async throws {
        let root = try makeAppHistoryRoot()
        let scope = appHistoryScope()
        let gate = AppTransactionGate()
        var entered = gate.entered.makeAsyncIterator()
        let injectedLedger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            faultInjector: gate.inject
        )
        let model = AppModel(
            analyzer: DelayedAnalyzer(delay: .milliseconds(1)),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentLedgerOpener: { _, _ in injectedLedger }
        )
        model.select(snapshot: failingAppSnapshot("off-transaction"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        model.setIncidentCaptureEnabled(true)
        let didEnter: Void? = await entered.next()
        #expect(didEnter != nil)

        model.setMode(.off)
        #expect(model.effectiveState == .stoppingUncertain)
        #expect(model.incidentCaptureEnabled == false)
        gate.release.signal()
        await model.awaitSettledForTesting()

        #expect(model.effectiveState == .off)
        #expect(model.incidentHistory.isEmpty)
        await model.shutdown()
        let verificationLedger = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: scope
        )
        #expect(try await verificationLedger.verifyIntegrity().eventCount == 0)
        try await verificationLedger.close()
        try FileManager.default.removeItem(at: root)
    }

    @Test("Unavailable and corrupt history cannot alter the displayed pipeline result")
    func historyFailuresAreClosedAndResultIsolated() async throws {
        let unavailableRoot = try makeAppHistoryRoot()
        let unavailableScope = appHistoryScope("unavailable")
        let unavailableModel = AppModel(
            analyzer: DelayedAnalyzer(delay: .milliseconds(1)),
            incidentHistoryConfiguration: .existing(
                rootDirectory: unavailableRoot,
                scope: unavailableScope
            ),
            incidentLedgerOpener: { _, _ in
                throw IncidentLedgerErrorV1.unsupportedStorage
            }
        )
        unavailableModel.select(snapshot: failingAppSnapshot("unavailable"))
        unavailableModel.setMode(.assist)
        await unavailableModel.awaitSettledForTesting()
        let unavailableBaseline = try #require(unavailableModel.result)
        unavailableModel.setIncidentCaptureEnabled(true)
        await unavailableModel.awaitSettledForTesting()

        #expect(unavailableModel.result == unavailableBaseline)
        #expect(unavailableModel.effectiveState == .blocked)
        #expect(unavailableModel.currentness == .none)
        #expect(unavailableModel.lastError == nil)
        #expect(unavailableModel.incidentHistoryAvailability == .unavailable)
        #expect(unavailableModel.incidentHistoryReason == .storageUnavailable)
        #expect(unavailableModel.incidentHistory.isEmpty)
        await unavailableModel.shutdown()
        try FileManager.default.removeItem(at: unavailableRoot)

        let corruptRoot = try makeAppHistoryRoot()
        let corruptScope = appHistoryScope("corrupt")
        let projectDirectory = corruptRoot
            .appendingPathComponent("projects", isDirectory: true)
            .appendingPathComponent(corruptScope.projectDigest, isDirectory: true)
        try FileManager.default.createDirectory(
            at: projectDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: NSNumber(value: 0o700)]
        )
        let databaseURL = projectDirectory.appendingPathComponent("incident-ledger-v1.sqlite3")
        let corruptBytes = Data("NOT-A-SQLITE-DATABASE-DO-NOT-REPLACE".utf8)
        try corruptBytes.write(to: databaseURL)
        try FileManager.default.setAttributes(
            [.posixPermissions: NSNumber(value: 0o600)],
            ofItemAtPath: databaseURL.path
        )
        let corruptModel = AppModel(
            analyzer: DelayedAnalyzer(delay: .milliseconds(1)),
            incidentHistoryConfiguration: .existing(
                rootDirectory: corruptRoot,
                scope: corruptScope
            )
        )
        corruptModel.select(snapshot: failingAppSnapshot("corrupt"))
        corruptModel.setMode(.assist)
        await corruptModel.awaitSettledForTesting()
        let corruptBaseline = try #require(corruptModel.result)
        corruptModel.setIncidentCaptureEnabled(true)
        await corruptModel.awaitSettledForTesting()

        #expect(corruptModel.result == corruptBaseline)
        #expect(corruptModel.effectiveState == .blocked)
        #expect(corruptModel.currentness == .none)
        #expect(corruptModel.lastError == nil)
        #expect(corruptModel.incidentHistoryAvailability == .refused)
        #expect(corruptModel.incidentHistoryReason == .integrityRefused)
        #expect(corruptModel.incidentHistory.isEmpty)
        #expect(try Data(contentsOf: databaseURL) == corruptBytes)

        await corruptModel.shutdown()
        #expect(try Data(contentsOf: databaseURL) == corruptBytes)
        try FileManager.default.removeItem(at: corruptRoot)
    }

    @Test("OFF is bounded when a ledger opener ignores cancellation")
    func offQuarantinesNoncooperativeOpen() async throws {
        let root = try makeAppHistoryRoot()
        let scope = appHistoryScope("off-noncooperative-open")
        let gate = AppOpenGate()
        let counter = AppOpenCounter()
        var entered = gate.entered.makeAsyncIterator()
        let model = AppModel(
            analyzer: DelayedAnalyzer(delay: .milliseconds(1)),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentStorageOperationTimeout: .milliseconds(120),
            incidentLedgerOpener: { root, scope in
                counter.increment()
                gate.block()
                return try await LocalIncidentLedgerV1.open(
                    rootDirectory: root,
                    scope: scope
                )
            }
        )
        model.select(snapshot: failingAppSnapshot("off-noncooperative-open"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        model.setIncidentCaptureEnabled(true)
        let didEnter: Void? = await entered.next()
        #expect(didEnter != nil)

        let clock = ContinuousClock()
        let started = clock.now
        model.setMode(.off)
        await model.awaitSettledForTesting()
        let elapsed = started.duration(to: clock.now)

        #expect(elapsed < .seconds(1))
        #expect(model.effectiveState == .off)
        #expect(model.incidentCaptureEnabled == false)
        #expect(model.incidentHistoryAvailability == .unavailable)
        #expect(model.incidentHistoryReason == .openUncertain)
        #expect(model.incidentHistory.isEmpty)
        #expect(counter.value == 1)

        gate.release.signal()
        try await Task.sleep(for: .milliseconds(300))
        await model.shutdown()
        #expect(model.incidentHistoryAvailability == .unavailable)
        #expect(model.incidentHistoryReason == .openUncertain)

        let verificationLedger = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: scope
        )
        #expect(try await verificationLedger.verifyIntegrity().eventCount == 0)
        try await verificationLedger.close()
        try FileManager.default.removeItem(at: root)
    }

    @Test("Shutdown is bounded when a ledger opener ignores cancellation")
    func shutdownQuarantinesNoncooperativeOpen() async throws {
        let root = try makeAppHistoryRoot()
        let scope = appHistoryScope("shutdown-noncooperative-open")
        let gate = AppOpenGate()
        var entered = gate.entered.makeAsyncIterator()
        let model = AppModel(
            analyzer: DelayedAnalyzer(delay: .milliseconds(1)),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentStorageOperationTimeout: .milliseconds(120),
            incidentLedgerOpener: { root, scope in
                gate.block()
                return try await LocalIncidentLedgerV1.open(
                    rootDirectory: root,
                    scope: scope
                )
            }
        )
        model.select(snapshot: failingAppSnapshot("shutdown-noncooperative-open"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        model.setIncidentCaptureEnabled(true)
        let didEnter: Void? = await entered.next()
        #expect(didEnter != nil)

        let clock = ContinuousClock()
        let started = clock.now
        await model.shutdown()
        let elapsed = started.duration(to: clock.now)

        #expect(elapsed < .seconds(1))
        #expect(model.effectiveState == .off)
        #expect(model.incidentHistoryAvailability == .unavailable)
        #expect(model.incidentHistoryReason == .openUncertain)

        gate.release.signal()
        try await Task.sleep(for: .milliseconds(300))
        let verificationLedger = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: scope
        )
        #expect(try await verificationLedger.verifyIntegrity().eventCount == 0)
        try await verificationLedger.close()
        try FileManager.default.removeItem(at: root)
    }

    @Test("OFF revokes a pending logical deletion before SQLite COMMIT")
    func offRevokesPendingTombstone() async throws {
        let root = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = appHistoryScope("off-tombstone-race")
        let gate = AppTombstoneCommitGate()
        let mutationControl = IncidentLifecycleMutationControlV1()
        let injectedLedger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { Date(timeIntervalSince1970: 1_900_000_000) },
            faultInjector: gate.inject
        )
        let model = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentLedgerOpener: { _, _ in injectedLedger },
            incidentMutationControl: mutationControl
        )
        model.select(snapshot: failingAppSnapshot("off-tombstone-race"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()
        let summary = try #require(model.incidentHistory.first)
        let baseline = try await injectedLedger.verifyIntegrity()
        var entered = gate.entered.makeAsyncIterator()

        model.deleteIncident(summary)
        let reachedCommit: Void? = await entered.next()
        #expect(reachedCommit != nil)
        let invalidationsBeforeOff = mutationControl.invalidationCountForTesting()
        model.setMode(.off)
        #expect(
            mutationControl.invalidationCountForTesting() > invalidationsBeforeOff
        )
        gate.release.signal()
        await model.awaitSettledForTesting()
        #expect(model.effectiveState == .off)
        await model.shutdown()

        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == baseline)
        #expect(try await reopened.inspect(selection: summary.selection).lifecycleState == .active)
        try await reopened.close()
    }

    @Test("History disable synchronously revokes a pending logical deletion before COMMIT")
    func historyDisableSynchronouslyRevokesPendingTombstone() async throws {
        let root = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = appHistoryScope("disable-tombstone-race")
        let gate = AppTombstoneCommitGate()
        let mutationControl = IncidentLifecycleMutationControlV1()
        let injectedLedger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { Date(timeIntervalSince1970: 1_900_000_000) },
            faultInjector: gate.inject
        )
        let model = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentLedgerOpener: { _, _ in injectedLedger },
            incidentMutationControl: mutationControl
        )
        model.select(snapshot: failingAppSnapshot("disable-tombstone-race"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()
        let summary = try #require(model.incidentHistory.first)
        let baseline = try await injectedLedger.verifyIntegrity()
        var entered = gate.entered.makeAsyncIterator()

        model.deleteIncident(summary)
        let reachedCommit: Void? = await entered.next()
        #expect(reachedCommit != nil)
        let invalidationsBeforeDisable = mutationControl.invalidationCountForTesting()
        model.setIncidentCaptureEnabled(false)
        #expect(
            mutationControl.invalidationCountForTesting() > invalidationsBeforeDisable
        )
        gate.release.signal()
        await model.awaitSettledForTesting()
        #expect(!model.incidentCaptureEnabled)
        #expect(model.incidentHistoryAvailability == .disabled)
        await model.shutdown()

        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == baseline)
        #expect(try await reopened.inspect(selection: summary.selection).lifecycleState == .active)
        try await reopened.close()
    }

    @Test("AppModel shutdown synchronously revokes a pending logical deletion before COMMIT")
    func appShutdownSynchronouslyRevokesPendingTombstone() async throws {
        let root = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = appHistoryScope("app-shutdown-tombstone-race")
        let gate = AppTombstoneCommitGate()
        let mutationControl = IncidentLifecycleMutationControlV1()
        let injectedLedger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { Date(timeIntervalSince1970: 1_900_000_000) },
            faultInjector: gate.inject
        )
        let model = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentLedgerOpener: { _, _ in injectedLedger },
            incidentMutationControl: mutationControl
        )
        model.select(snapshot: failingAppSnapshot("app-shutdown-tombstone-race"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()
        let summary = try #require(model.incidentHistory.first)
        let baseline = try await injectedLedger.verifyIntegrity()
        var entered = gate.entered.makeAsyncIterator()

        model.deleteIncident(summary)
        let reachedCommit: Void? = await entered.next()
        #expect(reachedCommit != nil)
        let invalidationsBeforeShutdown = mutationControl.invalidationCountForTesting()
        model.beginShutdown()
        #expect(
            mutationControl.invalidationCountForTesting() > invalidationsBeforeShutdown
        )
        gate.release.signal()
        await model.finishShutdown()
        #expect(model.desiredMode == .off)
        #expect(model.effectiveState == .off)

        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == baseline)
        #expect(try await reopened.inspect(selection: summary.selection).lifecycleState == .active)
        try await reopened.close()
    }

    @Test("Snapshot replacement synchronously revokes a pending logical deletion before COMMIT")
    func snapshotReplacementSynchronouslyRevokesPendingTombstone() async throws {
        let root = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = appHistoryScope("snapshot-tombstone-race")
        let gate = AppTombstoneCommitGate()
        let mutationControl = IncidentLifecycleMutationControlV1()
        let injectedLedger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { Date(timeIntervalSince1970: 1_900_000_000) },
            faultInjector: gate.inject
        )
        let model = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentLedgerOpener: { _, _ in injectedLedger },
            incidentMutationControl: mutationControl
        )
        model.select(snapshot: failingAppSnapshot("snapshot-tombstone-race"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()
        let summary = try #require(model.incidentHistory.first)
        let baseline = try await injectedLedger.verifyIntegrity()
        var entered = gate.entered.makeAsyncIterator()

        model.deleteIncident(summary)
        let reachedCommit: Void? = await entered.next()
        #expect(reachedCommit != nil)
        let replacement = appSnapshot("snapshot-replacement")
        let invalidationsBeforeReplacement = mutationControl.invalidationCountForTesting()
        model.select(snapshot: replacement)
        #expect(
            mutationControl.invalidationCountForTesting() > invalidationsBeforeReplacement
        )
        gate.release.signal()
        await model.awaitSettledForTesting()

        #expect(model.selectedSnapshot?.subjectDigest == replacement.subjectDigest)
        #expect(model.result?.subjectDigest == replacement.subjectDigest)
        #expect(model.result?.deterministicPassed == true)
        #expect(model.currentness == .none)
        await model.shutdown()

        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == baseline)
        #expect(try await reopened.inspect(selection: summary.selection).lifecycleState == .active)
        try await reopened.close()
    }

    @Test("Profile replacement synchronously revokes a pending logical deletion before COMMIT")
    func profileReplacementSynchronouslyRevokesPendingTombstone() async throws {
        let root = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = appHistoryScope("profile-tombstone-race")
        let gate = AppTombstoneCommitGate()
        let mutationControl = IncidentLifecycleMutationControlV1()
        let injectedLedger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { Date(timeIntervalSince1970: 1_900_000_000) },
            faultInjector: gate.inject
        )
        let model = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentLedgerOpener: { _, _ in injectedLedger },
            incidentMutationControl: mutationControl
        )
        let snapshot = failingAppSnapshot("profile-tombstone-race")
        model.select(snapshot: snapshot)
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()
        let summary = try #require(model.incidentHistory.first)
        let baseline = try await injectedLedger.verifyIntegrity()
        var entered = gate.entered.makeAsyncIterator()

        model.deleteIncident(summary)
        let reachedCommit: Void? = await entered.next()
        #expect(reachedCommit != nil)
        let replacementProfile = CheckProfile(
            id: "veritas-profile-tombstone-replacement",
            requiredSections: ["Testing"]
        )
        let invalidationsBeforeReplacement = mutationControl.invalidationCountForTesting()
        model.setProfile(replacementProfile)
        #expect(
            mutationControl.invalidationCountForTesting() > invalidationsBeforeReplacement
        )
        model.setIncidentCaptureEnabled(false)
        #expect(!model.incidentCaptureEnabled)
        gate.release.signal()
        await model.awaitSettledForTesting()

        let replacementResult = try #require(model.result)
        #expect(model.selectedSnapshot?.subjectDigest == snapshot.subjectDigest)
        #expect(replacementResult.subjectDigest == snapshot.subjectDigest)
        #expect(replacementResult.profileID == replacementProfile.id)
        #expect(replacementResult.profileFingerprint == replacementProfile.rulesFingerprint)
        #expect(replacementResult.disposition == .needsAttention)
        #expect(!replacementResult.deterministicPassed)
        #expect(!replacementResult.canAcceptInsideVeritas)
        #expect(model.currentness == .none)
        #expect(model.incidentHistoryAvailability == .disabled)
        await model.shutdown()

        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == baseline)
        #expect(try await reopened.inspect(selection: summary.selection).lifecycleState == .active)
        try await reopened.close()
    }

    @Test("A newer incident action synchronously revokes a pending logical deletion before COMMIT")
    func incidentActionSupersessionSynchronouslyRevokesPendingTombstone() async throws {
        let root = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = appHistoryScope("incident-action-tombstone-race")
        let gate = AppTombstoneCommitGate()
        let mutationControl = IncidentLifecycleMutationControlV1()
        let injectedLedger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { Date(timeIntervalSince1970: 1_900_000_000) },
            faultInjector: gate.inject
        )
        let model = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentLedgerOpener: { _, _ in injectedLedger },
            incidentMutationControl: mutationControl
        )
        model.select(snapshot: failingAppSnapshot("incident-action-tombstone-race"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        let resultBaseline = try #require(model.result)
        let currentnessBaseline = model.currentness
        #expect(currentnessBaseline == .none)
        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()
        let summary = try #require(model.incidentHistory.first)
        let historyBaseline = model.incidentHistory
        #expect(historyBaseline == [summary])
        #expect(model.inspectedIncident == nil)
        let ledgerBaseline = try await injectedLedger.verifyIntegrity()
        var entered = gate.entered.makeAsyncIterator()

        model.deleteIncident(summary)
        let reachedCommit: Void? = await entered.next()
        #expect(reachedCommit != nil)
        let invalidationsBeforeInspect = mutationControl.invalidationCountForTesting()
        model.inspectIncident(summary)
        #expect(model.incidentActionInFlight)
        #expect(
            mutationControl.invalidationCountForTesting() > invalidationsBeforeInspect
        )
        #expect(model.inspectedIncident == nil)
        #expect(model.result == resultBaseline)
        #expect(model.currentness == currentnessBaseline)
        gate.release.signal()
        await model.awaitSettledForTesting()

        let inspected = try #require(model.inspectedIncident)
        #expect(inspected.summary == summary)
        #expect(inspected.lifecycleState == .active)
        #expect(inspected.tombstone == nil)
        #expect(model.incidentActionReason == nil)
        #expect(!model.incidentActionInFlight)
        #expect(model.incidentHistory == historyBaseline)
        #expect(model.result == resultBaseline)
        #expect(model.currentness == currentnessBaseline)
        await model.shutdown()

        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == ledgerBaseline)
        let reopenedView = try await reopened.inspect(selection: summary.selection)
        #expect(reopenedView == inspected)
        #expect(reopenedView.lifecycleState == .active)
        #expect(reopenedView.tombstone == nil)
        try await reopened.close()
    }

    @Test("Coordinator shutdown revokes a pending logical deletion before COMMIT")
    func shutdownRevokesPendingTombstone() async throws {
        let root = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = appHistoryScope("shutdown-tombstone-race")
        let gate = AppTombstoneCommitGate()
        let mutationControl = IncidentLifecycleMutationControlV1()
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { Date(timeIntervalSince1970: 1_900_000_000) },
            faultInjector: gate.inject
        )
        guard case let .appended(summary) = try await ledger.record(
            IncidentObservationInputV1(
                incidentID: "incident/\(appDigest("shutdown-tombstone-race"))",
                observationKey: appDigest("shutdown-tombstone-observation"),
                subjectIDDigest: appDigest("shutdown-tombstone-subject-id"),
                subjectContentDigest: appDigest("shutdown-tombstone-subject-content"),
                evidenceSetDigest: appDigest("shutdown-tombstone-evidence"),
                failureCodes: [.schemaInvalid],
                symptomCodes: [.invalidStructure],
                observedAt: Date(timeIntervalSince1970: 1_800_000_000),
                retentionReviewAt: Date(timeIntervalSince1970: 1_807_776_000)
            )
        ) else {
            Issue.record("Shutdown tombstone fixture must append.")
            return
        }
        let baseline = try await ledger.verifyIntegrity()
        let coordinator = IncidentHistoryCoordinatorV1(
            configuration: .existing(rootDirectory: root, scope: scope),
            adapter: PipelineIncidentAdapterV1(
                control: PipelineIncidentCaptureControlV1(enabled: false)
            ),
            opener: { _, _ in ledger },
            mutationControl: mutationControl
        )
        guard case .available = await coordinator.list() else {
            Issue.record("Coordinator must install the exact injected ledger.")
            return
        }
        var entered = gate.entered.makeAsyncIterator()
        let deletion = Task {
            await coordinator.tombstone(selection: summary.selection, reason: .userRequested)
        }
        let reachedCommit: Void? = await entered.next()
        #expect(reachedCommit != nil)
        let invalidationsBeforeShutdown = mutationControl.invalidationCountForTesting()
        let shutdown = Task { await coordinator.shutdown() }
        #expect(await waitForMutationInvalidation(
            mutationControl,
            after: invalidationsBeforeShutdown
        ))
        gate.release.signal()
        if case .inactive(let reason) = await deletion.value {
            #expect(reason == .captureCancelled || reason == .closed)
        } else {
            Issue.record("Shutdown must prevent the pending tombstone from completing.")
        }
        #expect(await shutdown.value == .closed)

        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == baseline)
        #expect(try await reopened.inspect(selection: summary.selection).lifecycleState == .active)
        try await reopened.close()
    }

    @Test("Superseding a redacted export revokes the old publication")
    func supersededRedactedExportCannotPublish() async throws {
        let historyRoot = try makeAppHistoryRoot()
        let exportRoot = try makeAppHistoryRoot()
        defer {
            try? FileManager.default.removeItem(at: historyRoot)
            try? FileManager.default.removeItem(at: exportRoot)
        }
        let scope = appHistoryScope("superseded-redacted-export")
        let gate = AppFileWriteGate()
        let model = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: historyRoot, scope: scope),
            privateFileWriter: gate.write
        )
        model.select(snapshot: failingAppSnapshot("superseded-redacted-export"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()
        let summary = try #require(model.incidentHistory.first)
        model.prepareRedactedIncidentExport(summary)
        await model.awaitSettledForTesting()
        let prepared = try #require(model.preparedIncidentExport)
        var entered = gate.firstWriteEntered.makeAsyncIterator()
        let staleDestination = exportRoot.appendingPathComponent("stale.json")
        let currentDestination = exportRoot.appendingPathComponent("current.json")

        model.savePreparedIncidentExport(to: staleDestination)
        let firstReachedWriter: Void? = await entered.next()
        #expect(firstReachedWriter != nil)
        model.savePreparedIncidentExport(to: currentDestination)
        gate.releaseFirstWrite.signal()
        await model.awaitSettledForTesting()

        #expect(!FileManager.default.fileExists(atPath: staleDestination.path))
        #expect(try Data(contentsOf: currentDestination) == prepared.canonicalData)
        #expect(model.lastFileExportReceipt?.destinationURL == currentDestination)
        #expect(
            try FileManager.default.contentsOfDirectory(atPath: exportRoot.path).sorted()
                == ["current.json"]
        )
        await model.shutdown()
    }

    @Test("Shutdown revokes a pending redacted export without a hidden file")
    func shutdownRevokesPendingRedactedExport() async throws {
        let historyRoot = try makeAppHistoryRoot()
        let exportRoot = try makeAppHistoryRoot()
        defer {
            try? FileManager.default.removeItem(at: historyRoot)
            try? FileManager.default.removeItem(at: exportRoot)
        }
        let scope = appHistoryScope("shutdown-redacted-export")
        let gate = AppFileWriteGate()
        let model = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: historyRoot, scope: scope),
            privateFileWriter: gate.write
        )
        model.select(snapshot: failingAppSnapshot("shutdown-redacted-export"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()
        let summary = try #require(model.incidentHistory.first)
        model.prepareRedactedIncidentExport(summary)
        await model.awaitSettledForTesting()
        var entered = gate.firstWriteEntered.makeAsyncIterator()
        let destination = exportRoot.appendingPathComponent("must-not-publish.json")

        model.savePreparedIncidentExport(to: destination)
        let reachedWriter: Void? = await entered.next()
        #expect(reachedWriter != nil)
        model.beginShutdown()
        gate.releaseFirstWrite.signal()
        await model.finishShutdown()

        #expect(!FileManager.default.fileExists(atPath: destination.path))
        #expect(try FileManager.default.contentsOfDirectory(atPath: exportRoot.path).isEmpty)
    }

    @Test("Exact accepted-copy export publishes only current frozen bytes")
    func exactAcceptedCopyExportIsCurrentAndNoReplace() async throws {
        let exportRoot = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: exportRoot) }
        let snapshot = appSnapshot("accepted-export")
        let model = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: nil
        )
        model.select(snapshot: snapshot)
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        let result = try #require(model.result)
        #expect(result.canAcceptInsideVeritas)

        model.acceptExactVersion()
        await model.awaitSettledForTesting()
        #expect(model.currentness == .current)

        let destination = exportRoot.appendingPathComponent("accepted.json")
        model.exportAcceptedCopy(to: destination)
        await model.awaitSettledForTesting()
        let receipt = try #require(model.lastFileExportReceipt)
        #expect(receipt.destinationURL == destination.standardizedFileURL)
        #expect(receipt.digest == snapshot.subjectDigest)
        #expect(receipt.destinationIdentityVerified)
        #expect(receipt.readbackVerified)
        #expect(receipt.replacedExistingFile == false)
        #expect(try Data(contentsOf: destination) == snapshot.bytes)

        let staleDestination = exportRoot.appendingPathComponent("stale.json")
        model.select(snapshot: appSnapshot("replacement"))
        await model.awaitSettledForTesting()
        #expect(model.currentness != .current)
        model.exportAcceptedCopy(to: staleDestination)
        await model.awaitSettledForTesting()
        #expect(!FileManager.default.fileExists(atPath: staleDestination.path))
        await model.shutdown()
    }

    @Test("Incident inspect, redacted export, and logical deletion cannot alter authority")
    func incidentActionsRemainNonAuthorizing() async throws {
        let root = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = appHistoryScope("incident-actions")
        let model = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope)
        )
        let snapshot = failingAppSnapshot("incident-actions")
        model.select(snapshot: snapshot)
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        let baseline = try #require(model.result)
        let baselineDigest = try #require(baseline.resultEvidenceDigest)

        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()
        let summary = try #require(model.incidentHistory.first)

        model.inspectIncident(summary)
        await model.awaitSettledForTesting()
        #expect(model.inspectedIncident?.lifecycleState == .active)
        #expect(model.result == baseline)
        #expect(model.currentness == .none)

        model.explainIncident(summary)
        await model.awaitSettledForTesting()
        let explanation = try #require(model.incidentExplanation)
        #expect(explanation.incidentID == summary.incidentID)
        #expect(explanation.rootCause == "NOT_ESTABLISHED" && !explanation.authorizing)
        #expect(model.result == baseline && model.currentness == .none)

        model.prepareRedactedIncidentExport(summary)
        #expect(model.incidentExplanation == nil)
        await model.awaitSettledForTesting()
        let prepared = try #require(model.preparedIncidentExport)
        #expect(prepared.authorizing == false)
        #expect(prepared.certified == false)
        #expect(prepared.rawContentStored == false)
        #expect(prepared.physicalErasurePerformed == false)
        #expect(ArtifactSnapshot.digest(prepared.canonicalData) == prepared.digest)

        let destination = root.appendingPathComponent("redacted-incident.json")
        model.savePreparedIncidentExport(to: destination)
        await model.awaitSettledForTesting()
        #expect(try Data(contentsOf: destination) == prepared.canonicalData)
        #expect(model.lastFileExportReceipt?.digest == prepared.digest)
        #expect(model.result?.resultEvidenceDigest == baselineDigest)
        #expect(model.currentness == .none)

        model.deleteIncident(summary)
        await model.awaitSettledForTesting()
        #expect(model.incidentHistory.isEmpty)
        #expect(model.inspectedIncident?.lifecycleState == .tombstoned)
        #expect(model.inspectedIncident?.tombstone?.physicalErasurePerformed == false)
        #expect(model.result == baseline)
        #expect(model.currentness == .none)
        await model.shutdown()

        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        let verification = try await ledger.verifyIntegrity()
        #expect(verification.eventCount == 2)
        #expect(verification.observationCount == 1)
        #expect(verification.tombstoneCount == 1)
        try await ledger.close()
    }

    @Test("Completed and late explanations are cleared by every host supersession", arguments:
        ["off", "profile", "selection", "action", "disable", "shutdown"], [false, true])
    func explanationHostInvalidation(action: String, pending: Bool) async throws {
        let root = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let model = AppModel(analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: appHistoryScope()))
        let gate = AppExplanationDeliveryGate()
        let outcome: Result<Void, any Error>
        do {
            model.select(snapshot: failingAppSnapshot("explanation-\(action)-\(pending)"))
            model.setMode(.assist)
            await model.awaitSettledForTesting()
            model.setIncidentCaptureEnabled(true)
            await model.awaitSettledForTesting()
            let summary = try #require(model.incidentHistory.first)
            let baseline = try #require(model.result)
            if pending { model.beforeIncidentExplanationDeliveryForTesting = { await gate.wait() } }
            var entered = gate.entered.stream.makeAsyncIterator()
            model.explainIncident(summary)
            if pending { let reached: Void? = await entered.next(); #expect(reached != nil) }
            else { await model.awaitSettledForTesting(); #expect(model.incidentExplanation != nil) }
            switch action {
            case "off": model.setMode(.off)
            case "profile": model.setProfile(CheckProfile(id: "explanation-new", requiredSections: ["Testing"]))
            case "selection": model.select(snapshot: appSnapshot("explanation-new"))
            case "action": model.inspectIncident(summary)
            case "disable": model.setIncidentCaptureEnabled(false)
            case "shutdown": model.beginShutdown()
            default: Issue.record("Unknown test action")
            }
            #expect(model.incidentExplanation == nil)
            gate.release()
            await model.awaitSettledForTesting()
            #expect(model.incidentExplanation == nil)
            #expect(model.currentness != .current)
            if action == "action" || action == "disable" { #expect(model.result == baseline) }
            outcome = .success(())
        } catch { outcome = .failure(error) }
        gate.release()
        await model.shutdown()
        try outcome.get()
    }

    @Test("Explain does not create a missing store or enable history capture")
    func explanationDoesNotCreateStore() async throws {
        let root = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = appHistoryScope()
        let coordinator = IncidentHistoryCoordinatorV1(configuration: .existing(rootDirectory: root, scope: scope),
            adapter: PipelineIncidentAdapterV1())
        let selection = IncidentSelectionV1(projectDigest: scope.projectDigest, incidentID: "incident/\(appDigest("none"))",
            incidentDigest: appDigest("none"), subjectIDDigest: appDigest("id"), subjectContentDigest: appDigest("subject"),
            observationEventDigest: appDigest("event"))
        let result = await coordinator.explain(selection: selection)
        if case .unavailable(.historyNotFound) = result { } else { Issue.record("Missing store must be unavailable") }
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
        _ = await coordinator.shutdown()
    }

    @Test("Explanation integrity refusal quarantines history without changing the pipeline verdict")
    func explanationIntegrityQuarantine() async throws {
        let root = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = appHistoryScope()
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        let model = AppModel(analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentLedgerOpener: { _, _ in ledger })
        let outcome: Result<Void, any Error>
        do {
            model.select(snapshot: failingAppSnapshot("explain-refusal")); model.setMode(.assist)
            await model.awaitSettledForTesting()
            model.setIncidentCaptureEnabled(true); await model.awaitSettledForTesting()
            let summary = try #require(model.incidentHistory.first), baseline = model.result
            try await ledger.setTransactionEndDenialForTesting(.commitAndRollback)
            model.explainIncident(summary); await model.awaitSettledForTesting()
            #expect(model.incidentExplanation == nil && model.incidentActionReason == .integrityRefused)
            #expect(model.result == baseline && model.currentness == .none)
            model.explainIncident(summary); await model.awaitSettledForTesting()
            #expect(model.incidentExplanation == nil && model.incidentActionReason == .integrityRefused)
            outcome = .success(())
        } catch { outcome = .failure(error) }
        await model.shutdown(); try? await ledger.close()
        try outcome.get()
    }

    @Test("History reads work while capture is disabled and never create an empty store")
    func disabledHistoryReadIsAvailableWithoutHiddenCreation() async throws {
        let root = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = appHistoryScope("disabled-read")
        let configuration = IncidentHistoryConfigurationV1.existing(
            rootDirectory: root,
            scope: scope
        )
        let seed = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: configuration
        )
        seed.select(snapshot: failingAppSnapshot("disabled-read"))
        seed.setMode(.assist)
        await seed.awaitSettledForTesting()
        seed.setIncidentCaptureEnabled(true)
        await seed.awaitSettledForTesting()
        #expect(seed.incidentHistory.count == 1)
        await seed.shutdown()

        let reader = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: configuration
        )
        #expect(reader.incidentCaptureEnabled == false)
        #expect(reader.desiredMode == .off)
        reader.refreshIncidentHistory()
        await reader.awaitSettledForTesting()
        #expect(reader.incidentHistoryAvailability == .available)
        #expect(reader.incidentHistory.count == 1)
        #expect(reader.result == nil)
        #expect(reader.currentness == .none)
        await reader.shutdown()

        let emptyRoot = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: emptyRoot) }
        let missingReader = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(
                rootDirectory: emptyRoot,
                scope: appHistoryScope("missing-read")
            )
        )
        missingReader.refreshIncidentHistory()
        await missingReader.awaitSettledForTesting()
        #expect(missingReader.incidentHistoryAvailability == .unavailable)
        #expect(missingReader.incidentHistoryReason == .historyNotFound)
        #expect(
            try FileManager.default.contentsOfDirectory(atPath: emptyRoot.path).isEmpty
        )
        await missingReader.shutdown()
    }

    @Test("Shutdown serializes behind a close-uncertain suspend")
    func shutdownWaitsForSuspendingClose() async throws {
        let root = try makeAppHistoryRoot()
        let scope = appHistoryScope("suspend-shutdown-close")
        let gate = AppTransactionGate()
        var entered = gate.entered.makeAsyncIterator()
        let injectedLedger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            faultInjector: gate.inject
        )
        let control = PipelineIncidentCaptureControlV1(enabled: true)
        let coordinator = IncidentHistoryCoordinatorV1(
            configuration: .existing(rootDirectory: root, scope: scope),
            adapter: PipelineIncidentAdapterV1(control: control),
            storageOperationTimeout: .milliseconds(120),
            opener: { _, _ in injectedLedger }
        )
        let snapshot = failingAppSnapshot("suspend-shutdown-close")
        let result = await appIncidentResult(snapshot: snapshot)
        let capture = Task {
            await coordinator.capture(
                snapshot: snapshot,
                profile: .prototype,
                mode: .assist,
                result: result,
                context: PipelineIncidentCaptureContextV1(
                    runObservationDigest: appDigest("suspend-shutdown-close-run"),
                    observedAt: Date(timeIntervalSince1970: 1_800_000_000),
                    retentionReviewAt: nil
                )
            )
        }
        let didEnter: Void? = await entered.next()
        #expect(didEnter != nil)
        control.invalidatePendingCaptures()
        capture.cancel()

        let order = AppCompletionOrder()
        let suspendTask = Task {
            let closeResult = await coordinator.suspend()
            await order.append("suspend")
            return closeResult
        }
        for _ in 0..<100 { await Task.yield() }
        let shutdownTask = Task {
            let closeResult = await coordinator.shutdown()
            await order.append("shutdown")
            return closeResult
        }

        try await Task.sleep(for: .milliseconds(220))
        let completionOrder = await order.values
        #expect(completionOrder == ["suspend", "shutdown"])
        #expect(await suspendTask.value == .uncertain(.closeUncertain))
        #expect(await shutdownTask.value == .uncertain(.closeUncertain))

        gate.release.signal()
        _ = await capture.value
        try await Task.sleep(for: .milliseconds(120))
        let listing = await coordinator.list()
        if case .inactive(let reason) = listing {
            #expect(reason == .closed)
        } else {
            Issue.record("A terminally shut down coordinator must not list or reopen history.")
        }

        let verificationLedger = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: scope
        )
        #expect(try await verificationLedger.verifyIntegrity().eventCount == 0)
        try await verificationLedger.close()
        try FileManager.default.removeItem(at: root)
    }

    @Test("Retention review stops at four pages and one hundred observations")
    func retentionReviewStopsAtFourPagesAndOneHundredObservations() async throws {
        let root = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = appHistoryScope("retention-four-page-ceiling")
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { Date(timeIntervalSince1970: 3_000) }
        ) { _ in }
        let summaries = try await appendAppRetentionObservations(
            to: ledger,
            count: 101,
            label: "four-page-ceiling"
        )
        let model = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentLedgerOpener: { _, _ in ledger }
        )
        model.select(snapshot: appSnapshot("retention-four-page-ceiling"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        let resultBaseline = try #require(model.result)
        let currentnessBaseline = model.currentness
        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()

        model.reviewDueIncidentRetention()
        await model.awaitSettledForTesting()

        let state = try #require(model.incidentRetentionReviewState)
        #expect(state.pageCount == 4)
        #expect(state.processedObservationCount == 100)
        #expect(state.appendedTombstoneCount == 100)
        #expect(state.replayedTombstoneCount == 0)
        #expect(state.workRemaining)
        #expect(state.stop == .ceilingReached)
        #expect(!state.inFlight)
        #expect(model.incidentHistory.count == 1)
        #expect(model.incidentHistory.first == summaries.last)
        #expect(model.result == resultBaseline)
        #expect(model.currentness == currentnessBaseline)
        #expect(model.incidentActionReason == nil)

        let verification = try await ledger.verifyIntegrity()
        #expect(verification.eventCount == 201)
        #expect(verification.observationCount == 101)
        #expect(verification.tombstoneCount == 100)
        #expect(
            try await ledger.inspect(selection: summaries[0].selection).lifecycleState
                == .tombstoned
        )
        #expect(
            try await ledger.inspect(selection: summaries[100].selection).lifecycleState
                == .active
        )
        await model.shutdown()
    }

    @Test("Retention review exhausts a short final page")
    func retentionReviewExhaustsShortFinalPage() async throws {
        let root = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = appHistoryScope("retention-short-final-page")
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { Date(timeIntervalSince1970: 3_000) }
        ) { _ in }
        _ = try await appendAppRetentionObservations(
            to: ledger,
            count: 26,
            label: "short-final-page"
        )
        let model = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentLedgerOpener: { _, _ in ledger }
        )
        model.select(snapshot: appSnapshot("retention-short-final-page"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        let resultBaseline = try #require(model.result)
        let currentnessBaseline = model.currentness
        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()

        model.reviewDueIncidentRetention()
        await model.awaitSettledForTesting()

        let state = try #require(model.incidentRetentionReviewState)
        #expect(state.pageCount == 2)
        #expect(state.processedObservationCount == 26)
        #expect(state.appendedTombstoneCount == 26)
        #expect(state.replayedTombstoneCount == 0)
        #expect(!state.workRemaining)
        #expect(state.stop == .exhausted)
        #expect(model.incidentHistory.isEmpty)
        #expect(model.result == resultBaseline)
        #expect(model.currentness == currentnessBaseline)

        let verification = try await ledger.verifyIntegrity()
        #expect(verification.eventCount == 52)
        #expect(verification.observationCount == 26)
        #expect(verification.tombstoneCount == 26)
        await model.shutdown()
    }

    @Test("Committed retention survives supersession and explicit refresh reconciles history")
    func committedRetentionPageSurvivesSupersessionAndRefreshReconcilesHistory() async throws {
        let root = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = appHistoryScope("retention-post-commit-supersession")
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { Date(timeIntervalSince1970: 3_000) }
        ) { _ in }
        let summaries = try await appendAppRetentionObservations(
            to: ledger,
            count: 26,
            label: "post-commit-supersession"
        )
        let order = AppIncidentActionOrderRecorder()
        let gate = AppRetentionPageReturnGate(
            onBlocked: { order.record(.retentionPageBlocked) },
            onRelease: { order.record(.retentionPageReleased) }
        )
        defer { gate.release() }
        let model = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentLedgerOpener: { _, _ in ledger },
            incidentRetentionPageReturnObserver: gate.observe,
            incidentActionExecutionObserver: {
                order.record(.actionStarted($0))
            }
        )
        model.select(snapshot: appSnapshot("retention-post-commit-supersession"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        let resultBaseline = try #require(model.result)
        let currentnessBaseline = model.currentness
        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()
        model.refreshIncidentHistory()
        await model.awaitSettledForTesting()
        let historyBaseline = model.incidentHistory
        #expect(historyBaseline == Array(summaries.reversed()))
        model.reviewDueIncidentRetention()
        guard let committedPage = await firstAppGateEvent(from: gate.entered) else {
            gate.release()
            await model.shutdown()
            Issue.record("Retention review did not reach the post-COMMIT return seam.")
            return
        }
        #expect(committedPage.processedObservationCount == 25)
        #expect(committedPage.appendedTombstoneCount == 25)

        let replacementSelection = try #require(summaries.last)
        model.inspectIncident(replacementSelection)
        let cancelledState = try #require(model.incidentRetentionReviewState)
        #expect(cancelledState.stop == .interrupted(.captureCancelled))
        #expect(cancelledState.pageCount == 0)
        #expect(model.incidentActionInFlight)
        #expect(gate.waitingForRelease)
        #expect(model.inspectedIncident == nil)
        #expect(model.incidentHistory == historyBaseline)

        gate.release()
        await model.awaitSettledForTesting()

        let finalState = try #require(model.incidentRetentionReviewState)
        #expect(finalState.pageCount == 1)
        #expect(finalState.processedObservationCount == 25)
        #expect(finalState.appendedTombstoneCount == 25)
        #expect(finalState.replayedTombstoneCount == 0)
        #expect(finalState.workRemaining)
        #expect(finalState.stop == .interrupted(.captureCancelled))
        #expect(model.incidentHistory == historyBaseline)
        #expect(model.inspectedIncident?.summary == replacementSelection)
        #expect(model.inspectedIncident?.lifecycleState == .active)
        #expect(model.incidentActionReason == nil)
        #expect(!model.incidentActionInFlight)
        #expect(order.events == [
            .actionStarted(.retentionReview),
            .retentionPageBlocked,
            .retentionPageReleased,
            .actionStarted(.inspect),
        ])

        let verification = try await ledger.verifyIntegrity()
        #expect(verification.eventCount == 51)
        #expect(verification.observationCount == 26)
        #expect(verification.tombstoneCount == 25)

        model.refreshIncidentHistory()
        await model.awaitSettledForTesting()
        #expect(model.incidentHistory == [replacementSelection])
        #expect(model.incidentHistoryAvailability == .available)
        #expect(model.result == resultBaseline)
        #expect(model.currentness == currentnessBaseline)
        await model.shutdown()
    }

    @Test("A page-less retention failure creates no progress and no store")
    func pageLessRetentionFailureCreatesNoProgressAndNoStore() async throws {
        let root = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = appHistoryScope("retention-no-store")
        let model = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope)
        )
        model.select(snapshot: appSnapshot("retention-no-store"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        let resultBaseline = try #require(model.result)
        let currentnessBaseline = model.currentness
        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()

        model.reviewDueIncidentRetention()
        await model.awaitSettledForTesting()

        let state = try #require(model.incidentRetentionReviewState)
        #expect(state.pageCount == 0)
        #expect(state.processedObservationCount == 0)
        #expect(state.appendedTombstoneCount == 0)
        #expect(state.replayedTombstoneCount == 0)
        #expect(!state.workRemaining)
        #expect(state.stop == .interrupted(.historyNotFound))
        #expect(model.incidentActionReason == .historyNotFound)
        #expect(model.result == resultBaseline)
        #expect(model.currentness == currentnessBaseline)
        #expect(
            try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty
        )
        await model.shutdown()
    }

    @Test("Retention capacity refusal maps without progress or authority change")
    func retentionCapacityRefusalMapsWithoutProgressOrAuthorityChange() async throws {
        let root = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = appHistoryScope("retention-capacity-refusal")
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            eventCapacity: 1,
            clock: { Date(timeIntervalSince1970: 3_000) }
        ) { _ in }
        let summaries = try await appendAppRetentionObservations(
            to: ledger,
            count: 1,
            label: "capacity-refusal"
        )
        let ledgerBaseline = try await ledger.verifyIntegrity()
        let model = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentLedgerOpener: { _, _ in ledger }
        )
        model.select(snapshot: appSnapshot("retention-capacity-refusal"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        let resultBaseline = try #require(model.result)
        let currentnessBaseline = model.currentness
        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()
        model.refreshIncidentHistory()
        await model.awaitSettledForTesting()
        let historyBaseline = model.incidentHistory
        #expect(historyBaseline == summaries)

        model.reviewDueIncidentRetention()
        await model.awaitSettledForTesting()

        let state = try #require(model.incidentRetentionReviewState)
        #expect(state.pageCount == 0)
        #expect(state.processedObservationCount == 0)
        #expect(state.appendedTombstoneCount == 0)
        #expect(state.replayedTombstoneCount == 0)
        #expect(!state.workRemaining)
        #expect(state.stop == .interrupted(.capacityExceeded))
        #expect(model.incidentActionReason == .capacityExceeded)
        #expect(model.incidentHistory == historyBaseline)
        #expect(model.incidentHistoryAvailability == .available)
        #expect(model.result == resultBaseline)
        #expect(model.currentness == currentnessBaseline)
        #expect(try await ledger.verifyIntegrity() == ledgerBaseline)
        #expect(
            try await ledger.inspect(selection: summaries[0].selection).lifecycleState
                == .active
        )
        await model.shutdown()
    }

    @Test("Retention preserves an already-current accepted artifact")
    func retentionPreservesAlreadyCurrentAcceptedArtifact() async throws {
        let root = try makeAppHistoryRoot()
        let exportRoot = try makeAppHistoryRoot()
        defer {
            try? FileManager.default.removeItem(at: root)
            try? FileManager.default.removeItem(at: exportRoot)
        }
        let scope = appHistoryScope("retention-current-acceptance")
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { Date(timeIntervalSince1970: 3_000) }
        ) { _ in }
        _ = try await appendAppRetentionObservations(
            to: ledger,
            count: 1,
            label: "current-acceptance"
        )
        let snapshot = appSnapshot("retention-current-acceptance")
        let model = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentLedgerOpener: { _, _ in ledger }
        )
        model.select(snapshot: snapshot)
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        let resultBaseline = try #require(model.result)
        #expect(resultBaseline.canAcceptInsideVeritas)
        model.acceptExactVersion()
        await model.awaitSettledForTesting()
        #expect(model.currentness == .current)
        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()

        model.reviewDueIncidentRetention()
        await model.awaitSettledForTesting()

        let state = try #require(model.incidentRetentionReviewState)
        #expect(state.pageCount == 1)
        #expect(state.processedObservationCount == 1)
        #expect(state.appendedTombstoneCount == 1)
        #expect(state.replayedTombstoneCount == 0)
        #expect(!state.workRemaining)
        #expect(state.stop == .exhausted)
        #expect(model.result == resultBaseline)
        #expect(model.currentness == .current)
        #expect(model.result?.resultEvidenceDigest == resultBaseline.resultEvidenceDigest)

        let destination = exportRoot.appendingPathComponent("accepted-after-retention.json")
        model.exportAcceptedCopy(to: destination)
        await model.awaitSettledForTesting()
        let receipt = try #require(model.lastFileExportReceipt)
        #expect(receipt.digest == snapshot.subjectDigest)
        #expect(receipt.destinationURL == destination.standardizedFileURL)
        #expect(receipt.destinationIdentityVerified)
        #expect(receipt.readbackVerified)
        #expect(try Data(contentsOf: destination) == snapshot.bytes)
        #expect(model.currentness == .current)
        #expect(model.result == resultBaseline)

        let verification = try await ledger.verifyIntegrity()
        #expect(verification.observationCount == 1)
        #expect(verification.tombstoneCount == 1)
        await model.shutdown()
    }

    @Test("Replacement refusal preserves product authority state")
    func replacementFailurePreservesProductAuthorityState() async throws {
        let root = try makeAppHistoryRoot()
        let exportRoot = try makeAppHistoryRoot()
        defer {
            try? FileManager.default.removeItem(at: root)
            try? FileManager.default.removeItem(at: exportRoot)
        }
        let scope = appHistoryScope("replacement-authority-state")
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { Date(timeIntervalSince1970: 3_000) }
        ) { _ in }
        _ = try await appendAppRetentionObservations(
            to: ledger,
            count: 1,
            label: "replacement-authority-state"
        )
        let snapshot = appSnapshot("replacement-authority-state")
        let model = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentLedgerOpener: { _, _ in ledger }
        )
        model.select(snapshot: snapshot)
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        let resultBaseline = try #require(model.result)
        #expect(resultBaseline.canAcceptInsideVeritas)
        model.acceptExactVersion()
        await model.awaitSettledForTesting()
        #expect(model.currentness == .current)

        let destination = exportRoot.appendingPathComponent(
            "accepted-before-replacement.json"
        )
        model.exportAcceptedCopy(to: destination)
        await model.awaitSettledForTesting()
        let receiptBaseline = try #require(model.lastFileExportReceipt)
        let acceptedBytesBaseline = try Data(contentsOf: destination)
        #expect(acceptedBytesBaseline == snapshot.bytes)

        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()
        model.refreshIncidentHistory()
        await model.awaitSettledForTesting()
        let historyBaseline = model.incidentHistory
        let availabilityBaseline = model.incidentHistoryAvailability
        #expect(availabilityBaseline == .available)

        let fixture = try installByteIdenticalAppPrimaryReplacement(
            at: ledger.databaseURL
        )
        defer { try? restoreAppPrimaryReplacement(fixture) }

        model.reviewDueIncidentRetention()
        await model.awaitSettledForTesting()

        let state = try #require(model.incidentRetentionReviewState)
        #expect(state.pageCount == 0)
        #expect(state.processedObservationCount == 0)
        #expect(state.appendedTombstoneCount == 0)
        #expect(state.replayedTombstoneCount == 0)
        #expect(!state.workRemaining)
        #expect(state.stop == .interrupted(.integrityRefused))
        #expect(model.incidentActionReason == .integrityRefused)
        #expect(model.result == resultBaseline)
        #expect(model.result?.resultEvidenceDigest == resultBaseline.resultEvidenceDigest)
        #expect(model.currentness == .current)
        #expect(model.lastFileExportReceipt == receiptBaseline)
        #expect(try Data(contentsOf: destination) == acceptedBytesBaseline)
        #expect(model.incidentHistory == historyBaseline)
        #expect(model.incidentHistoryAvailability == availabilityBaseline)
        #expect(try Data(contentsOf: fixture.replacement) == fixture.replacementBytes)
        #expect(
            try appReplacementPathIdentity(fixture.replacement)
                == fixture.replacementIdentity
        )

        let postRefusalDestination = exportRoot.appendingPathComponent(
            "accepted-after-replacement-refusal.json"
        )
        model.exportAcceptedCopy(to: postRefusalDestination)
        await model.awaitSettledForTesting()
        let postRefusalReceipt = try #require(model.lastFileExportReceipt)
        #expect(postRefusalReceipt.destinationURL == postRefusalDestination.standardizedFileURL)
        #expect(postRefusalReceipt.digest == snapshot.subjectDigest)
        #expect(postRefusalReceipt.destinationIdentityVerified)
        #expect(postRefusalReceipt.readbackVerified)
        #expect(!postRefusalReceipt.replacedExistingFile)
        #expect(try Data(contentsOf: postRefusalDestination) == snapshot.bytes)

        try restoreAppPrimaryReplacement(fixture)
        await model.shutdown()
    }

    @Test(
        "Retention pre-COMMIT revocation preserves the exact boundary",
        arguments: AppRetentionRevocationBoundary.allCases
    )
    func retentionPreCommitRevocationPreservesBoundary(
        _ boundary: AppRetentionRevocationBoundary
    ) async throws {
        let root = try makeAppHistoryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = appHistoryScope("retention-precommit-\(boundary.rawValue)")
        let gate = AppTombstoneCommitGate()
        defer { gate.releaseOnceForBoundedTest() }
        let mutationControl = IncidentLifecycleMutationControlV1()
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { Date(timeIntervalSince1970: 3_000) },
            faultInjector: gate.inject
        )
        let summaries = try await appendAppRetentionObservations(
            to: ledger,
            count: 1,
            label: "precommit-\(boundary.rawValue)"
        )
        let model = AppModel(
            analyzer: DeterministicOnlyOrchestrator(),
            incidentHistoryConfiguration: .existing(rootDirectory: root, scope: scope),
            incidentLedgerOpener: { _, _ in ledger },
            incidentMutationControl: mutationControl
        )
        model.select(snapshot: appSnapshot("retention-precommit-\(boundary.rawValue)"))
        model.setMode(.assist)
        await model.awaitSettledForTesting()
        model.setIncidentCaptureEnabled(true)
        await model.awaitSettledForTesting()
        model.reviewDueIncidentRetention()
        guard await firstAppGateEvent(from: gate.entered) != nil else {
            gate.releaseOnceForBoundedTest()
            await model.shutdown()
            Issue.record("Retention review did not reach the pre-COMMIT gate.")
            return
        }
        let invalidationsBeforeBoundary = mutationControl.invalidationCountForTesting()

        switch boundary {
        case .historyDisable:
            model.setIncidentCaptureEnabled(false)
        case .modeOff:
            model.setMode(.off)
        case .shutdown:
            model.beginShutdown()
        case .refresh:
            model.refreshIncidentHistory()
        case .snapshotReplacement:
            model.select(snapshot: appSnapshot("retention-boundary-replacement"))
        case .profileReplacement:
            model.setProfile(CheckProfile(
                id: "retention-boundary-profile",
                requiredSections: []
            ))
        case .explicitReanalysis:
            model.analyzeSelected()
        }

        #expect(
            mutationControl.invalidationCountForTesting() > invalidationsBeforeBoundary
        )
        let immediateState = try #require(model.incidentRetentionReviewState)
        #expect(immediateState.stop == .interrupted(boundary.expectedReason))
        #expect(immediateState.pageCount == 0)
        #expect(immediateState.processedObservationCount == 0)
        #expect(!immediateState.workRemaining)
        gate.releaseOnceForBoundedTest()

        if boundary == .shutdown {
            await model.finishShutdown()
        } else {
            await model.awaitSettledForTesting()
            await model.shutdown()
        }

        let finalState = try #require(model.incidentRetentionReviewState)
        #expect(finalState.stop == .interrupted(boundary.expectedReason))
        #expect(finalState.pageCount == 0)
        #expect(finalState.processedObservationCount == 0)
        #expect(finalState.appendedTombstoneCount == 0)
        #expect(finalState.replayedTombstoneCount == 0)
        #expect(!finalState.workRemaining)

        let reopened = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: scope
        )
        let verification = try await reopened.verifyIntegrity()
        #expect(verification.eventCount == 1)
        #expect(verification.observationCount == 1)
        #expect(verification.tombstoneCount == 0)
        #expect(
            try await reopened.inspect(selection: summaries[0].selection).lifecycleState
                == .active
        )
        try await reopened.close()
    }
}
