import CryptoKit
import Foundation
import Testing
@testable import VeritasCore

private func shadowBytes(_ values: [Float]) -> Data {
    var bytes = Data()
    for value in values {
        for shift in [0, 8, 16, 24] { bytes.append(UInt8(truncatingIfNeeded: value.bitPattern >> shift)) }
    }
    return bytes
}
private func shadowHash(_ bytes: Data) -> String {
    SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
}
private func shadowPrepared(scope: String = "scope.test", overflow: Bool = false) throws -> PreparedReferenceMLPEvaluation {
    let weights = shadowBytes(overflow ? [.greatestFiniteMagnitude, 0, 1, 0] : [2, -3, -1, 1, 4, 5, -2])
    let model = try ReferenceMLP(shape: .init(input: 1, hidden: overflow ? 1 : 2, output: 1),
        weightBytes: weights, expectedWeightsSHA256: shadowHash(weights))
    let input = shadowBytes(overflow ? [2] : [-1])
    return try PreparedReferenceMLPEvaluation(model: model, scopeID: scope, runID: "run.test",
        inputBytes: input, expectedModelSHA256: model.modelSHA256, expectedInputSHA256: shadowHash(input))
}
private func shadowBudget(weight: Int = 28, operations: Int = 10, output: Int = 4, ms: Int = 1000) throws -> ReferenceMLPShadowOwner.Budget {
    try .init(maxWeightBytes: weight, maxOperations: operations, maxOutputBytes: output, maxInferenceMs: ms)
}
private func shadowDeadline() -> ContinuousClock.Instant { .now.advanced(by: .milliseconds(900)) }
private func shadowRefuses(_ failure: ReferenceMLPShadowOwner.Failure, _ operation: () async throws -> Void) async {
    do { try await operation(); Issue.record("Missing owner refusal: \(failure)") }
    catch let error as ReferenceMLPShadowOwner.Failure { #expect(error == failure) }
    catch { Issue.record("Wrong owner error: \(error)") }
}
private func withShadowOwner(_ body: (ReferenceMLPShadowOwner) async throws -> Void) async throws {
    let owner = try ReferenceMLPShadowOwner(scopeID: "scope.test", budget: shadowBudget())
    try await withAsyncTestCleanup(operation: { try await body(owner) }, cleanup: { await owner.off() })
}
// Test-side caller scheduling only. It never enters the production worker or supplies results.
private actor ShadowCallerLatch {
    private var isOpen = false
    private var waiter: CheckedContinuation<Void, Never>?
    func wait() async {
        if isOpen { return }
        await withCheckedContinuation { waiter = $0 }
    }
    func open() { isOpen = true; waiter?.resume(); waiter = nil }
}

#if DEBUG
// This gate pauses delivery AFTER the actual numeric worker has joined. It never
// supplies a result or changes inference. Timeout is failure escape, not ordering.
private actor ShadowJoinedDeliveryLatch {
    nonisolated let entered: AsyncStream<Void>
    private let signal: AsyncStream<Void>.Continuation
    private var waiter: CheckedContinuation<Void, Never>?
    private var isOpen = false
    private(set) var arrivalCount = 0

    init() {
        let pair = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
        entered = pair.stream
        signal = pair.continuation
    }

    func suspend(at point: ReferenceMLPShadowOwner.DeliveryProbePoint) async {
        #expect(point == .afterWorkerJoinedBeforeDeliveryRecheck)
        arrivalCount += 1
        guard arrivalCount == 1 else { return }
        signal.yield(())
        signal.finish()
        if isOpen { return }
        await withCheckedContinuation { waiter = $0 }
    }

    nonisolated func waitForEntry() async throws {
        let stream = entered
        let arrived = try await withThrowingTaskGroup(of: Bool.self) { group in
            group.addTask {
                for await _ in stream { return true }
                return false
            }
            group.addTask {
                try await Task.sleep(for: .seconds(5))
                return false
            }
            let value = try await group.next() ?? false
            group.cancelAll()
            return value
        }
        try #require(arrived, "Real worker delivery never reached the post-join barrier")
    }

    func release() {
        isOpen = true
        waiter?.resume()
        waiter = nil
        signal.finish()
    }
}

private typealias ShadowDeliveryTask = Task<PreparedReferenceMLPEvaluation.Result, any Error>
private enum ShadowScheduleTestFailure: Error { case expectedBodyFailure }

private func withSuspendedShadowDelivery(_ body: (
    ReferenceMLPShadowOwner, ReferenceMLPShadowOwner.Permit,
    ReferenceMLPShadowOwner.RunTicket, ShadowDeliveryTask, ShadowJoinedDeliveryLatch
) async throws -> Void) async throws {
    let latch = ShadowJoinedDeliveryLatch()
    let owner = try ReferenceMLPShadowOwner(scopeID: "scope.test", budget: shadowBudget(),
        forPostAwaitRevocationTesting: { point in await latch.suspend(at: point) })
    try await withAsyncTestCleanup(operation: {
        try await owner.enable()
        let permit = try await owner.grant(shadowPrepared(), deadline: shadowDeadline())
        let ticket = try await owner.begin(permit)
        let delivery = Task { try await owner.result(for: ticket) }
        try await withAsyncTestCleanup(operation: {
            try await latch.waitForEntry()
            #expect(await latch.arrivalCount == 1)
            #expect(await owner.state == .running)
            try await body(owner, permit, ticket, delivery, latch)
        }, cleanup: {
            // Release first: cancellation cannot force arbitrary test callbacks to return.
            await latch.release()
            delivery.cancel()
            _ = await delivery.result
        })
    }, cleanup: {
        await owner.off()
        #expect(await owner.state == .off)
    })
}
#endif

@Suite("BN-01 — Internal reference SHADOW run ownership")
struct ReferenceMLPShadowOwnerTests {
    @Test("Scope and numeric budget bounds refuse before creating a usable owner")
    func constructionBounds() async throws {
        for scope in ["", "A", "1a", "a/b", "a\n", "a\0b", "é", String(repeating: "a", count: 97)] {
            await shadowRefuses(.invalidScope) { _ = try ReferenceMLPShadowOwner(scopeID: scope, budget: shadowBudget()) }
        }
        for scope in ["a", "a.b-c_0", String(repeating: "a", count: 96)] {
            let owner = try ReferenceMLPShadowOwner(scopeID: scope, budget: shadowBudget())
            #expect(await owner.state == .off)
        }
        for value in [Int.min, -1, 0, 67_108_865, Int.max] {
            await shadowRefuses(.invalidBudget) { _ = try shadowBudget(weight: value) }
        }
        for value in [-1, 0, 100_000_001, Int.max] {
            await shadowRefuses(.invalidBudget) { _ = try shadowBudget(operations: value) }
        }
        for value in [-1, 0, 16_385, Int.max] {
            await shadowRefuses(.invalidBudget) { _ = try shadowBudget(output: value) }
        }
        for value in [-1, 0, 1001, Int.max] {
            await shadowRefuses(.invalidBudget) { _ = try shadowBudget(ms: value) }
        }
        _ = try shadowBudget(weight: 67_108_864, operations: 100_000_000, output: 16_384, ms: 1000)
        _ = try shadowBudget(weight: 1, operations: 1, output: 1, ms: 1)
    }

    @Test("OFF, repeated ON and one pending permit preserve explicit lifecycle")
    func pendingLifecycle() async throws {
        try await withShadowOwner { owner in
            let prepared = try shadowPrepared()
            await shadowRefuses(.disabled) { _ = try await owner.grant(prepared, deadline: shadowDeadline()) }
            try await owner.enable()
            #expect(await owner.state == .ready)
            let permit = try await owner.grant(prepared, deadline: shadowDeadline())
            #expect(await owner.state == .prepared)
            try await owner.enable()
            await shadowRefuses(.pendingPermit) { _ = try await owner.grant(prepared, deadline: shadowDeadline()) }
            await owner.off()
            #expect(await owner.state == .off)
            await shadowRefuses(.revoked) { _ = try await owner.begin(permit) }
            try await owner.enable()
            await shadowRefuses(.revoked) { _ = try await owner.begin(permit) }
        }
    }

    @Test("Exact frozen real result is delivered once with no authority")
    func exactResult() async throws {
        try await withShadowOwner { owner in
            try await owner.enable()
            let permit = try await owner.grant(shadowPrepared(), deadline: shadowDeadline())
            let ticket = try await owner.begin(permit)
            #expect(await owner.state == .running)
            let result = try await owner.result(for: ticket)
            #expect(result.outputBytes == shadowBytes([18]))
            #expect(result.resultSHA256 == "f16761a12a2cf256cd2bed02c17df07cab49971301268dd0c72b2450eef12920")
            #expect(result.scopeID == "scope.test" && result.runID == "run.test" && !result.authoritative)
            #expect(await owner.state == .ready)
            await shadowRefuses(.permitUnavailable) { _ = try await owner.begin(permit) }
            await shadowRefuses(.runUnavailable) { _ = try await owner.result(for: ticket) }
        }
    }

    @Test("Scope and opaque owner identity cannot be substituted")
    func foreignIdentities() async throws {
        try await withShadowOwner { first in
            try await withShadowOwner { second in
                try await first.enable(); try await second.enable()
                await shadowRefuses(.wrongScope) { _ = try await first.grant(shadowPrepared(scope: "other.scope"), deadline: shadowDeadline()) }
                let permit = try await first.grant(shadowPrepared(), deadline: shadowDeadline())
                await shadowRefuses(.foreignPermit) { _ = try await second.begin(permit) }
                let ticket = try await first.begin(permit)
                await shadowRefuses(.foreignRun) { _ = try await second.result(for: ticket) }
                #expect(await second.state == .ready)
                _ = try await first.result(for: ticket)
            }
        }
    }

    @Test("Exact 28 weight bytes, 10 operations and 4 output bytes pass; one-under refuses")
    func payloadBudgets() async throws {
        let cases: [(ReferenceMLPShadowOwner.Budget, ReferenceMLPShadowOwner.Failure)] = [
            (try shadowBudget(weight: 27), .weightBudgetExceeded),
            (try shadowBudget(operations: 9), .operationBudgetExceeded),
            (try shadowBudget(output: 3), .outputBudgetExceeded)
        ]
        for (budget, failure) in cases {
            let owner = try ReferenceMLPShadowOwner(scopeID: "scope.test", budget: budget)
            try await withAsyncTestCleanup(operation: {
                try await owner.enable()
                await shadowRefuses(failure) { _ = try await owner.grant(shadowPrepared(), deadline: shadowDeadline()) }
                #expect(await owner.state == .ready)
            }, cleanup: { await owner.off() })
        }
    }

    @Test("Expired or overlong deadlines refuse; delayed begin and delivery consume permission")
    func deadlines() async throws {
        try await withShadowOwner { owner in
            try await owner.enable()
            await shadowRefuses(.expired) { _ = try await owner.grant(shadowPrepared(), deadline: .now) }
            await shadowRefuses(.deadlineOutOfRange) { _ = try await owner.grant(shadowPrepared(), deadline: .now.advanced(by: .seconds(2))) }
            let deadline = ContinuousClock.now.advanced(by: .milliseconds(100))
            let permit = try await owner.grant(shadowPrepared(), deadline: deadline)
            try await ContinuousClock().sleep(until: deadline)
            await shadowRefuses(.expired) { _ = try await owner.begin(permit) }
            await shadowRefuses(.permitUnavailable) { _ = try await owner.begin(permit) }
            #expect(await owner.state == .ready)
            let deliveryDeadline = ContinuousClock.now.advanced(by: .milliseconds(100))
            let next = try await owner.grant(shadowPrepared(), deadline: deliveryDeadline)
            let ticket = try await owner.begin(next)
            try await ContinuousClock().sleep(until: deliveryDeadline)
            await shadowRefuses(.expired) { _ = try await owner.result(for: ticket) }
            #expect(await owner.state == .ready)
            await shadowRefuses(.runUnavailable) { _ = try await owner.result(for: ticket) }
        }
    }

    @Test("Concurrent begin consumes exactly one permit and blocks new admission while active")
    func concurrentBegin() async throws {
        try await withShadowOwner { owner in
            try await owner.enable()
            let prepared = try shadowPrepared()
            let permit = try await owner.grant(prepared, deadline: shadowDeadline())
            let outcomes = await withTaskGroup(of: Result<ReferenceMLPShadowOwner.RunTicket, Error>.self) { group in
                for _ in 0..<2 { group.addTask { do { return .success(try await owner.begin(permit)) } catch { return .failure(error) } } }
                var results: [Result<ReferenceMLPShadowOwner.RunTicket, Error>] = []
                for await value in group { results.append(value) }
                return results
            }
            var tickets: [ReferenceMLPShadowOwner.RunTicket] = []
            var busy = 0
            for outcome in outcomes {
                switch outcome {
                case .success(let ticket): tickets.append(ticket)
                case .failure(let error): #expect(error as? ReferenceMLPShadowOwner.Failure == .busy); busy += 1
                }
            }
            #expect(tickets.count == 1 && busy == 1)
            await shadowRefuses(.busy) { try await owner.enable() }
            await shadowRefuses(.busy) { _ = try await owner.grant(prepared, deadline: shadowDeadline()) }
            _ = try await owner.result(for: #require(tickets.first))
        }
    }

    @Test("Concurrent result claimers never duplicate delivery, regardless of completion ordering")
    func concurrentDelivery() async throws {
        try await withShadowOwner { owner in
            try await owner.enable()
            let permit = try await owner.grant(shadowPrepared(), deadline: shadowDeadline())
            let ticket = try await owner.begin(permit)
            let flags = await withTaskGroup(of: Bool.self) { group in
                for _ in 0..<2 { group.addTask {
                    do { let result = try await owner.result(for: ticket); #expect(!result.authoritative); return true }
                    catch let error as ReferenceMLPShadowOwner.Failure {
                        // Other waiter still suspended vs already finalized: both
                        // legitimate serialized states, neither delivers output.
                        #expect(error == .resultAlreadyClaimed || error == .runUnavailable)
                        return false
                    } catch { Issue.record("Unexpected delivery error: \(error)"); return false }
                } }
                var results: [Bool] = []
                for await flag in group { results.append(flag) }
                return results
            }
            #expect(flags.filter { $0 }.count == 1 && flags.filter { !$0 }.count == 1)
            #expect(await owner.state == .ready)
        }
#if DEBUG
        // Deterministic duplicate claim while the first real result is joined but
        // suspended before publication. The earlier test remains in optimized builds.
        try await withSuspendedShadowDelivery { owner, _, ticket, delivery, latch in
            await shadowRefuses(.resultAlreadyClaimed) { _ = try await owner.result(for: ticket) }
            #expect(await latch.arrivalCount == 1)
            await latch.release()
            let result = try await delivery.value
            #expect(result.outputBytes == shadowBytes([18]) && !result.authoritative)
            #expect(await owner.state == .ready)
            await shadowRefuses(.runUnavailable) { _ = try await owner.result(for: ticket) }
        }
#endif
    }

    @Test("OFF after launch but before delivery joins the worker and revokes output")
    func offAfterLaunch() async throws {
        try await withShadowOwner { owner in
            try await owner.enable()
            let permit = try await owner.grant(shadowPrepared(), deadline: shadowDeadline())
            let ticket = try await owner.begin(permit)
            async let first: Void = owner.off()
            async let second: Void = owner.off()
            _ = await (first, second)
            #expect(await owner.state == .off)
            await shadowRefuses(.revoked) { _ = try await owner.result(for: ticket) }
            await shadowRefuses(.revoked) { _ = try await owner.begin(permit) }
        }
#if DEBUG
        try await withSuspendedShadowDelivery { owner, permit, ticket, delivery, latch in
            async let first: Void = owner.off()
            async let second: Void = owner.off()
            _ = await (first, second)
            #expect(await owner.state == .off)
            await latch.release()
            await shadowRefuses(.revoked) { _ = try await delivery.value }
            #expect(await owner.state == .off)
            await shadowRefuses(.revoked) { _ = try await owner.result(for: ticket) }
            await shadowRefuses(.revoked) { _ = try await owner.begin(permit) }
        }
        // A throwing body must release/join the same suspended delivery and preserve
        // the original failure; cleanup's OFF assertion runs before it escapes.
        do {
            try await withSuspendedShadowDelivery { _, _, _, _, _ in
                throw ShadowScheduleTestFailure.expectedBodyFailure
            }
            Issue.record("Test body failure was swallowed")
        } catch {
            #expect(error is ShadowScheduleTestFailure)
        }
#endif
    }

    @Test("An old revoked ticket cannot clear a new active run at the pre-await guard")
    func newGenerationSurvives() async throws {
        try await withShadowOwner { owner in
            try await owner.enable()
            let oldPermit = try await owner.grant(shadowPrepared(), deadline: shadowDeadline())
            let old = try await owner.begin(oldPermit)
            await owner.off()
            try await owner.enable()
            let newPermit = try await owner.grant(shadowPrepared(), deadline: shadowDeadline())
            let current = try await owner.begin(newPermit)
            await shadowRefuses(.revoked) { _ = try await owner.result(for: old) }
            #expect(await owner.state == .running)
            let result = try await owner.result(for: current)
            #expect(result.outputBytes == shadowBytes([18]) && !result.authoritative)
        }
#if DEBUG
        // This continuation passed the pre-await guard in the OLD generation.
        try await withSuspendedShadowDelivery { owner, oldPermit, _, delivery, latch in
            await owner.off()
            try await owner.enable()
            let permit = try await owner.grant(shadowPrepared(), deadline: shadowDeadline())
            let current = try await owner.begin(permit)
            await latch.release()
            await shadowRefuses(.revoked) { _ = try await delivery.value }
            #expect(await owner.state == .running)
            await shadowRefuses(.revoked) { _ = try await owner.begin(oldPermit) }
            let result = try await owner.result(for: current)
            #expect(result.outputBytes == shadowBytes([18]))
            #expect(result.resultSHA256 == "f16761a12a2cf256cd2bed02c17df07cab49971301268dd0c72b2450eef12920")
            #expect(!result.authoritative && result.runID == "run.test")
            #expect(await latch.arrivalCount == 2)
            #expect(await owner.state == .ready)
        }
#endif
    }

    @Test("Pre-cancelled callers consume begin/delivery and cannot receive a favorable result")
    func callerCancellation() async throws {
        try await withShadowOwner { owner in
            try await owner.enable()
            let permit = try await owner.grant(shadowPrepared(), deadline: shadowDeadline())
            let startLatch = ShadowCallerLatch()
            let start = Task { await startLatch.wait(); return try await owner.begin(permit) }
            start.cancel(); await startLatch.open()
            do { _ = try await start.value; Issue.record("Cancelled begin delivered a ticket") }
            catch { #expect(error is CancellationError) }
            await shadowRefuses(.permitUnavailable) { _ = try await owner.begin(permit) }
            let next = try await owner.grant(shadowPrepared(), deadline: shadowDeadline())
            let ticket = try await owner.begin(next)
            let resultLatch = ShadowCallerLatch()
            let delivery = Task { await resultLatch.wait(); return try await owner.result(for: ticket) }
            delivery.cancel(); await resultLatch.open()
            do { _ = try await delivery.value; Issue.record("Cancelled caller received output") }
            catch { #expect(error is CancellationError) }
            #expect(await owner.state == .ready)
        }
#if DEBUG
        try await withSuspendedShadowDelivery { owner, _, ticket, delivery, latch in
            delivery.cancel()
            // Explicit release is necessary for the test callback. It is not a
            // claim that cancellation can preempt arbitrary code or neural work.
            await latch.release()
            do { _ = try await delivery.value; Issue.record("Post-join cancelled caller received output") }
            catch { #expect(error is CancellationError) }
            #expect(await owner.state == .ready)
            await shadowRefuses(.runUnavailable) { _ = try await owner.result(for: ticket) }
        }
#endif
    }

    @Test("Actual numeric failure propagates without restoring permission or inventing output")
    func arithmeticFailure() async throws {
        try await withShadowOwner { owner in
            try await owner.enable()
            let permit = try await owner.grant(shadowPrepared(overflow: true), deadline: shadowDeadline())
            let ticket = try await owner.begin(permit)
            do { _ = try await owner.result(for: ticket); Issue.record("Overflow became a result") }
            catch { #expect(error as? ReferenceMLP.Failure == .intermediateNonfinite) }
            #expect(await owner.state == .ready)
            await shadowRefuses(.permitUnavailable) { _ = try await owner.begin(permit) }
            await shadowRefuses(.runUnavailable) { _ = try await owner.result(for: ticket) }
        }
    }
}
