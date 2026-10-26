import AppKit
import Testing
@testable import CodenameVeritasApp
@testable import VeritasCore

#if DEBUG
private actor AppKitReferenceLatch {
    private var reached = false, released = false
    private var waiter: CheckedContinuation<Void, Never>?
    func hold() async {
        guard !reached else { return }
        reached = true
        if !released { await withCheckedContinuation { waiter = $0 } }
    }
    func release() { released = true; waiter?.resume(); waiter = nil }
    var hasArrived: Bool { reached }
}

@MainActor private func appKitWait(_ predicate: @MainActor () async -> Bool) async throws {
    let deadline = ContinuousClock().now.advanced(by: .seconds(3))
    while !(await predicate()) {
        try #require(ContinuousClock().now < deadline, "Hosted test boundary not reached")
        try await Task.sleep(for: .milliseconds(2))
    }
}

@MainActor private func withAppKitCleanup(
    _ model: AppModel, delegate: AppDelegate? = nil, latch: AppKitReferenceLatch? = nil,
    _ body: @MainActor () async throws -> Void
) async throws {
    let outcome: Result<Void, Error>
    do { try await body(); outcome = .success(()) } catch { outcome = .failure(error) }
    model.beginShutdown()
    await latch?.release() // Release before joining, including on assertion failure.
    await model.awaitSettledForTesting()
    await model.finishShutdown()
    await delegate?.awaitTerminationForTesting()
    try outcome.get()
}

@MainActor private func prepareHostedModel(_ model: AppModel) async {
    model.select(snapshot: ArtifactSnapshot(displayName: "hosted.json", kind: .json,
        bytes: Data("{\"name\":\"hosted\"}".utf8)))
    model.setMode(.assist)
    await model.awaitSettledForTesting()
}

@Suite("Real AppKit termination entry", .serialized)
@MainActor
struct AppKitIntegrationTests {
    @Test(arguments: [ReferenceArtifactShadowRunOwner.ProbePoint.beforeEnable, .afterCleanupBeforeDelivery])
    func terminationWaitsForRealReferenceCleanup(point: ReferenceArtifactShadowRunOwner.ProbePoint) async throws {
        let latch = AppKitReferenceLatch()
        let owner = try ReferenceArtifactShadowRunOwner.forSchedulingTests { if $0 == point { await latch.hold() } }
        let model = AppModel.forReferenceRunTests(owner: owner), sender = NSApplication.shared
        var replies: [Bool] = [], correctSenders: [Bool] = []
        let delegate = AppDelegate(model: model) { actual, value in
            correctSenders.append(actual === sender); replies.append(value)
        }
        try await withAppKitCleanup(model, delegate: delegate, latch: latch) {
            await prepareHostedModel(model)
            try #require(model.prepareReferenceRunReview())
            let review = try #require(model.referenceRunReview)
            try #require(model.confirmReferenceRunReview(review))
            try await appKitWait { await latch.hasArrived }
            #expect(delegate.applicationShouldTerminate(sender) == .terminateLater)
            // Same actor turn: shutdown admission must close before child tasks run.
            #expect(model.effectiveState == .stoppingUncertain && owner.state == .stopping)
            #expect(!model.canRunReferenceModel && model.referenceTaskRetainedForTesting)
            #expect(delegate.applicationShouldTerminate(sender) == .terminateLater)
            try await appKitWait { model.referenceShutdownJoinChecksForTesting > 0 || !replies.isEmpty }
            #expect(replies.isEmpty)
            #expect(model.effectiveState == .stoppingUncertain)
            #expect(delegate.terminationLaunchCountForTesting == 1)
            await latch.release()
            await delegate.awaitTerminationForTesting()
            #expect(replies == [true] && correctSenders == [true])
            #expect(model.effectiveState == .off && !model.referenceTaskRetainedForTesting)
            #expect(owner.state == .unbound)
            #expect(await owner.workerStateForTesting == .off)
            #expect(model.referenceRunDelivery == nil)
            #expect(delegate.applicationShouldTerminate(sender) == .terminateNow)
            #expect(replies == [true] && delegate.terminationLaunchCountForTesting == 1)
        }
    }

    @Test func terminationWithoutReferenceWorkStillRepliesOnce() async throws {
        let model = AppModel(analyzer: DeterministicOnlyOrchestrator(), incidentHistoryConfiguration: nil)
        var replies: [Bool] = []
        let delegate = AppDelegate(model: model) { _, value in replies.append(value) }
        try await withAppKitCleanup(model, delegate: delegate) {
            #expect(delegate.applicationShouldTerminate(NSApplication.shared) == .terminateLater)
            #expect(delegate.applicationShouldTerminate(NSApplication.shared) == .terminateLater)
            await delegate.awaitTerminationForTesting()
            #expect(replies == [true] && delegate.terminationLaunchCountForTesting == 1)
            #expect(model.effectiveState == .off)
            #expect(delegate.applicationShouldTerminate(NSApplication.shared) == .terminateNow)
        }
    }

}
#endif
