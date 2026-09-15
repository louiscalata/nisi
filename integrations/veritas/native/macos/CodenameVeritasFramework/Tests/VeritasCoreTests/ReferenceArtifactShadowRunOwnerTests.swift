import Foundation
import Testing
@testable import VeritasCore

private typealias NativeOwner = ReferenceArtifactShadowRunOwner
private func nativeSnapshot(_ text: String = "private fixture", kind: ArtifactKind = .text) -> ArtifactSnapshot {
    ArtifactSnapshot(displayName: "Fixture", kind: kind, bytes: Data(text.utf8))
}
private func nativeDeadline() -> ContinuousClock.Instant { .now.advanced(by: .milliseconds(900)) }
// Keep cleanup on the same executor as the host lifecycle under test. The
// older generic nonisolated test helper intentionally is not changed globally.
@MainActor private func withNativeCleanup<Value>(operation: @MainActor () async throws -> Value,
                                                cleanup: @MainActor () async -> Void) async throws -> Value {
    let result: Result<Value, Error>
    do { result = .success(try await operation()) } catch { result = .failure(error) }
    await cleanup()
    return try result.get()
}
@MainActor private func nativeRefuses(_ expected: NativeOwner.Failure, _ body: () async throws -> Void) async {
    do { try await body(); Issue.record("Missing bridge refusal: \(expected)") }
    catch let failure as NativeOwner.Failure { #expect(failure == expected) }
    catch { Issue.record("Wrong bridge error: \(error)") }
}

#if DEBUG
private final class WeakNativePayload {
    weak var value: AnyObject?
    init(_ value: AnyObject?) { self.value = value }
}
private actor NativeBridgeLatch {
    nonisolated let arrivals: AsyncStream<Void>
    private let signal: AsyncStream<Void>.Continuation
    private var waiter: CheckedContinuation<Void, Never>?
    private var released = false
    private var entered = false
    init() {
        let pair = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
        arrivals = pair.stream; signal = pair.continuation
    }
    func suspend() async {
        guard !entered else { return }
        entered = true; signal.yield(()); signal.finish()
        if released { return }
        await withCheckedContinuation { waiter = $0 }
    }
    func release() { released = true; waiter?.resume(); waiter = nil; signal.finish() }
    nonisolated func waitForArrival() async throws {
        let stream = arrivals
        let arrived = try await withThrowingTaskGroup(of: Bool.self) { group in
            group.addTask { for await _ in stream { return true }; return false }
            group.addTask { try await Task.sleep(for: .seconds(3)); return false }
            let result = try await group.next() ?? false
            group.cancelAll(); return result
        }
        try #require(arrived, "Bridge did not reach its real scheduling boundary")
    }
}
@MainActor private func withHeldBridge(at point: NativeOwner.ProbePoint,
    _ body: (NativeOwner, NativeOwner.RunTicket, Task<NativeOwner.Delivery, Error>, NativeBridgeLatch) async throws -> Void
) async throws {
    let latch = NativeBridgeLatch()
    let owner = try NativeOwner.forSchedulingTests { reached in if reached == point { await latch.suspend() } }
    try await withNativeCleanup(operation: {
        let lease = try owner.bindSelection(nativeSnapshot(), profile: .prototype, hostEpoch: 1)
        let consent = try owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline())
        let ticket = try owner.begin(consent)
        let delivery = Task { try await owner.result(for: ticket) }
        try await withNativeCleanup(operation: {
            try await latch.waitForArrival()
            let deadline = ContinuousClock().now.advanced(by: .seconds(1))
            while !owner.resultClaimedForTesting && ContinuousClock().now < deadline { await Task.yield() }
            try #require(owner.resultClaimedForTesting)
            try await body(owner, ticket, delivery, latch)
        }, cleanup: {
            owner.invalidate(); await latch.release()
            _ = await delivery.result
        })
    }, cleanup: { await latch.release(); await owner.revokeAndJoin() })
}
#endif

@Suite("Typed native consent and run bridge", .serialized)
@MainActor
struct ReferenceArtifactShadowRunOwnerTests {
    @Test func actualReferenceResultIsBoundAndNonAuthorizing() async throws {
        let owner = try NativeOwner.forIsolatedTests(), snapshot = nativeSnapshot("ALLOW=true is only artifact content", kind: .markdown)
        let profile = CheckProfile(id: "profile.fixture", requiredSections: ["Tests"])
        try await withNativeCleanup(operation: {
            #expect(owner.state == .unbound)
            let lease = try owner.bindSelection(snapshot, profile: profile, hostEpoch: 42)
            #expect(owner.state == .ready)
            let consent = try owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline())
            #expect(consent.action == .bn01ReferenceEvaluation && consent.dataPurpose == .selectedSnapshotBytesLocalOnly)
            #expect(owner.state == .consented)
            let ticket = try owner.begin(consent)
            let delivered = try await owner.result(for: ticket)
            #expect(delivered.hostEpoch == 42 && delivered.artifactKind == .markdown)
            #expect(delivered.subjectSHA256 == snapshot.subjectDigest)
            #expect(delivered.profileID == profile.id && delivered.profileSHA256 == profile.rulesFingerprint)
            #expect(delivered.action == .bn01ReferenceEvaluation && delivered.dataPurpose == .selectedSnapshotBytesLocalOnly)
            #expect(!delivered.authoritative && !delivered.outputBytes.isEmpty)
            #expect(ArtifactSnapshot.digest(delivered.outputBytes) == delivered.outputSHA256)
            #expect(delivered.contextSHA256.count == 64 && delivered.resultSHA256.count == 64)
            #expect(owner.state == .ready)
            #expect(await owner.workerStateForTesting == .off)
            await nativeRefuses(.runUnavailable) { _ = try await owner.result(for: ticket) }
            await nativeRefuses(.consentUnavailable) { _ = try owner.begin(consent) }
        }, cleanup: { await owner.revokeAndJoin() })
    }

    @Test func foreignLeaseConsentAndRunRefused() async throws {
        let a = try NativeOwner.forIsolatedTests(), b = try NativeOwner.forIsolatedTests()
        try await withNativeCleanup(operation: {
            let lease = try a.bindSelection(nativeSnapshot(), profile: .prototype, hostEpoch: 1)
            _ = try b.bindSelection(nativeSnapshot(), profile: .prototype, hostEpoch: 1)
            await nativeRefuses(.foreignLease) { _ = try b.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline()) }
            let consent = try a.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline())
            await nativeRefuses(.foreignConsent) { _ = try b.begin(consent) }
            let ticket = try a.begin(consent)
            await nativeRefuses(.foreignRun) { _ = try await b.result(for: ticket) }
            _ = try await a.result(for: ticket)
        }, cleanup: { await a.revokeAndJoin(); await b.revokeAndJoin() })
    }

    @Test func pendingConsentCannotBeOverwritten() async throws {
        let owner = try NativeOwner.forIsolatedTests()
        try await withNativeCleanup(operation: {
            let lease = try owner.bindSelection(nativeSnapshot(), profile: .prototype, hostEpoch: 7)
            let first = try owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline())
            await nativeRefuses(.pendingConsent) { _ = try owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline()) }
            let ticket = try owner.begin(first)
            await nativeRefuses(.busy) { _ = try owner.begin(first) }
            _ = try await owner.result(for: ticket)
        }, cleanup: { await owner.revokeAndJoin() })
    }

    @Test(arguments: ["bytes", "kind", "profile-id", "profile-rules", "epoch", "identical"])
    func replacementRevokesLeaseAndConsent(change: String) async throws {
        let owner = try NativeOwner.forIsolatedTests()
        try await withNativeCleanup(operation: {
            let snapshot = nativeSnapshot(), profile = CheckProfile(id: "same", requiredSections: ["Tests"])
            let old = try owner.bindSelection(snapshot, profile: profile, hostEpoch: 1)
            let consent = try owner.authorizeLocalReferenceOnce(old, deadline: nativeDeadline())
            let replacement = nativeSnapshot(change == "bytes" ? "new bytes" : "private fixture", kind: change == "kind" ? .markdown : .text)
            let newProfile = CheckProfile(id: change == "profile-id" ? "other" : "same", requiredSections: change == "profile-rules" ? ["Rollback"] : ["Tests"])
            let current = try owner.bindSelection(replacement, profile: newProfile, hostEpoch: change == "epoch" ? 2 : 1)
            await nativeRefuses(.staleLease) { _ = try owner.authorizeLocalReferenceOnce(old, deadline: nativeDeadline()) }
            await nativeRefuses(.revoked) { _ = try owner.begin(consent) }
            let ticket = try owner.begin(owner.authorizeLocalReferenceOnce(current, deadline: nativeDeadline()))
            let result = try await owner.result(for: ticket)
            #expect(result.subjectSHA256 == replacement.subjectDigest && result.artifactKind == replacement.kind)
            #expect(result.profileID == newProfile.id && result.profileSHA256 == newProfile.rulesFingerprint)
            #expect(result.hostEpoch == (change == "epoch" ? 2 : 1))
        }, cleanup: { await owner.revokeAndJoin() })
    }

    @Test(arguments: ["empty", "oversize", "utf8", "profile"])
    func invalidReplacementClearsOldAuthority(kind: String) async throws {
        let owner = try NativeOwner.forIsolatedTests()
        try await withNativeCleanup(operation: {
            let lease = try owner.bindSelection(nativeSnapshot(), profile: .prototype, hostEpoch: 1)
            let consent = try owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline())
            let bytes = kind == "empty" ? Data() : kind == "oversize" ? Data(repeating: 1, count: 1_048_577) : kind == "utf8" ? Data([0xff]) : Data("valid".utf8)
            let profile = kind == "profile" ? CheckProfile(id: "") : .prototype
            await nativeRefuses(kind == "profile" ? .invalidProfile : .invalidSnapshot) {
                _ = try owner.bindSelection(ArtifactSnapshot(displayName: "invalid", kind: .text, bytes: bytes), profile: profile, hostEpoch: 2)
            }
            #expect(owner.state == .unbound)
            await nativeRefuses(.revoked) { _ = try owner.begin(consent) }
        }, cleanup: { await owner.revokeAndJoin() })
    }

    @Test func ownsBytesBeforeLaterExternalMutation() async throws {
        let storage = UnsafeMutableRawPointer.allocate(byteCount: 256, alignment: 1)
        defer { storage.deallocate() }
        storage.initializeMemory(as: UInt8.self, repeating: UInt8(ascii: "a"), count: 256)
        let data = Data(bytesNoCopy: storage, count: 256, deallocator: .none)
        let original = ArtifactSnapshot(displayName: "Mutable", kind: .text, bytes: data)
        let owner = try NativeOwner.forIsolatedTests()
        try await withNativeCleanup(operation: {
            let lease = try owner.bindSelection(original, profile: .prototype, hostEpoch: 1)
            storage.storeBytes(of: UInt8(ascii: "X"), as: UInt8.self)
            let ticket = try owner.begin(owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline()))
            #expect(try await owner.result(for: ticket).subjectSHA256 == original.subjectDigest)
            await nativeRefuses(.invalidSnapshot) { _ = try owner.bindSelection(original, profile: .prototype, hostEpoch: 2) }
        }, cleanup: { await owner.revokeAndJoin() })
    }

    @Test func deadlinesAreMonotonicBoundedAndConsumeExpiredAttempt() async throws {
        let owner = try NativeOwner.forIsolatedTests()
        try await withNativeCleanup(operation: {
            let lease = try owner.bindSelection(nativeSnapshot(), profile: .prototype, hostEpoch: 1)
            await nativeRefuses(.expired) { _ = try owner.authorizeLocalReferenceOnce(lease, deadline: .now.advanced(by: .seconds(-1))) }
            await nativeRefuses(.deadlineOutOfRange) { _ = try owner.authorizeLocalReferenceOnce(lease, deadline: .now.advanced(by: .seconds(2))) }
            let deadline = ContinuousClock().now.advanced(by: .milliseconds(50))
            let consent = try owner.authorizeLocalReferenceOnce(lease, deadline: deadline)
            try await ContinuousClock().sleep(until: deadline.advanced(by: .milliseconds(1)))
            await nativeRefuses(.expired) { _ = try owner.begin(consent) }
            await nativeRefuses(.consentUnavailable) { _ = try owner.begin(consent) }
            #expect(await owner.workerStateForTesting == .off)
        }, cleanup: { await owner.revokeAndJoin() })
    }

    @Test func cancelledBeginConsumesConsentWithoutWork() async throws {
        let owner = try NativeOwner.forIsolatedTests()
        try await withNativeCleanup(operation: {
            let lease = try owner.bindSelection(nativeSnapshot(), profile: .prototype, hostEpoch: 1)
            let consent = try owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline())
            let attempt = Task { try owner.begin(consent) }
            attempt.cancel() // MainActor task has not had an opportunity to start.
            do { _ = try await attempt.value; Issue.record("Cancelled begin returned a ticket") }
            catch is CancellationError {}
            catch { Issue.record("Wrong cancellation: \(error)") }
            await nativeRefuses(.consentUnavailable) { _ = try owner.begin(consent) }
            #expect(await owner.workerStateForTesting == .off)
        }, cleanup: { await owner.revokeAndJoin() })
    }

    @Test func invalidateBeforeBeginNeedsNewSelectionAndAction() async throws {
        let owner = try NativeOwner.forIsolatedTests()
        let lease = try owner.bindSelection(nativeSnapshot(), profile: .prototype, hostEpoch: 1)
        let consent = try owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline())
        owner.invalidate()
        #expect(owner.state == .unbound)
        await nativeRefuses(.noSelection) { _ = try owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline()) }
        await nativeRefuses(.revoked) { _ = try owner.begin(consent) }
        await owner.revokeAndJoin()
        #expect(await owner.workerStateForTesting == .off)
    }

#if DEBUG
    @Test func resourceDeclarationUsesActualPlanAndCheckedArithmetic() throws {
        let owner = try NativeOwner.forIsolatedTests()
        let stage = try owner.declarationForTesting(byteCount: 100, executing: false)
        let run = try owner.declarationForTesting(byteCount: 100, executing: true)
        #expect(stage.bytes[.selectedBytes] == 100 && stage.bytes[.preparationScratch] == 400)
        #expect(stage.operations == 0 && stage.taskSlots == 0)
        #expect(run.bytes[.preparationScratch] == 800 && run.bytes[.modelWeights] == 160)
        #expect(run.bytes[.numericBuffers] == 80 && run.bytes[.resultEnvelope] == 16_400)
        #expect(run.operations == 68 && run.taskSlots == 1)
        #expect(run.totalBytes == run.bytes.values.reduce(0, +))
        #expect(throws: NativeOwner.Failure.resourceArithmeticOverflow) {
            _ = try NativeOwner.ResourceDeclaration.add(Int.max, 1)
        }
        #expect(throws: NativeOwner.Failure.resourceArithmeticOverflow) {
            _ = try NativeOwner.ResourceDeclaration.multiply(Int.max, 8)
        }
        #expect(throws: NativeOwner.Failure.resourceArithmeticOverflow) {
            _ = try owner.declarationForTesting(byteCount: -1, executing: true)
        }
    }

    @Test func buildRevocationBeforeSelectionRefusesWithoutOwnedCopy() async throws {
        let admission = NativeBuildAdmission.forIsolatedOwnerTests()
        let owner = try NativeOwner.forAdmittedBuildTests(admission)
        admission.revoke()
        await nativeRefuses(.buildAdmissionRefused) { _ = try owner.bindSelection(nativeSnapshot(), profile: .prototype, hostEpoch: 1) }
        #expect(owner.ownedCopyCountForTesting == 0 && owner.preparationCountForTesting == 0)
        #expect(try owner.reservedBytesForTesting == 0)
        #expect(owner.state == .unbound)
    }

    @Test func buildRevocationBeforeBeginConsumesConsentWithoutWork() async throws {
        let admission = NativeBuildAdmission.forIsolatedOwnerTests()
        let owner = try NativeOwner.forAdmittedBuildTests(admission)
        let lease = try owner.bindSelection(nativeSnapshot(), profile: .prototype, hostEpoch: 1)
        let consent = try owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline())
        admission.revoke()
        await nativeRefuses(.buildAdmissionRefused) { _ = try owner.begin(consent) }
        await nativeRefuses(.revoked) { _ = try owner.begin(consent) }
        #expect(owner.preparationCountForTesting == 0 && owner.workerBeginCountForTesting == 0)
        #expect(try owner.reservedBytesForTesting == 0)
        await owner.revokeAndJoin()
    }

    @Test(arguments: NativeOwner.ProbePoint.allCases)
    func buildRevocationAtAwaitBoundariesSuppressesDeliveryAndJoins(point: ReferenceArtifactShadowRunOwner.ProbePoint) async throws {
        let admission = NativeBuildAdmission.forIsolatedOwnerTests(), latch = NativeBridgeLatch()
        let owner = try NativeOwner.forBuildLifecycleTests(admission) { if $0 == point { await latch.suspend() } }
        try await withNativeCleanup(operation: {
            let lease = try owner.bindSelection(nativeSnapshot(), profile: .prototype, hostEpoch: 1)
            let ticket = try owner.begin(owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline()))
            let delivery = Task { try await owner.result(for: ticket) }
            try await withNativeCleanup(operation: {
                try await latch.waitForArrival()
                admission.revoke()
                await latch.release()
                do { _ = try await delivery.value; Issue.record("Revoked build delivered output") }
                catch let failure as NativeOwner.Failure { #expect(failure == .revoked || failure == .buildAdmissionRefused) }
                #expect(try owner.reservedBytesForTesting == 0)
                #expect(await owner.workerStateForTesting == .off)
                if point == .beforePreparation { #expect(owner.preparationCountForTesting == 0 && owner.workerBeginCountForTesting == 0) }
            }, cleanup: { await latch.release(); _ = await delivery.result })
        }, cleanup: { await latch.release(); await owner.revokeAndJoin() })
    }

    @Test(arguments: NativeOwner.ResourceComponent.allCases)
    func everyResourceComponentRefusesOneUnderBeforePreparation(component: ReferenceArtifactShadowRunOwner.ResourceComponent) async throws {
        let snapshot = nativeSnapshot()
        let observer = try NativeOwner.forIsolatedTests()
        let stage = try observer.declarationForTesting(byteCount: snapshot.bytes.count, executing: false)
        let run = try observer.declarationForTesting(byteCount: snapshot.bytes.count, executing: true)
        var budget = NativeOwner.ResourceBudget()
        budget.componentLimits[component] = try #require(run.bytes[component]) - 1
        let owner = try NativeOwner.forResourceTests(budget)
        try await withNativeCleanup(operation: {
            if try #require(stage.bytes[component]) > #require(budget.componentLimits[component]) {
                await nativeRefuses(.resourceBudgetRefused) {
                    _ = try owner.bindSelection(snapshot, profile: .prototype, hostEpoch: 1)
                }
                #expect(owner.ownedCopyCountForTesting == 0)
                #expect(try owner.reservedBytesForTesting == 0)
            } else {
                let lease = try owner.bindSelection(snapshot, profile: .prototype, hostEpoch: 1)
                let consent = try owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline())
                await nativeRefuses(.resourceBudgetRefused) { _ = try owner.begin(consent) }
                await nativeRefuses(.consentUnavailable) { _ = try owner.begin(consent) }
                #expect(try owner.reservedBytesForTesting == stage.totalBytes)
            }
            #expect(!owner.activeReservationForTesting)
            #expect(owner.preparationCountForTesting == 0 && owner.workerBeginCountForTesting == 0)
            #expect(await owner.workerStateForTesting == .off)
        }, cleanup: { await owner.revokeAndJoin() })
        #expect(try owner.reservedBytesForTesting == 0)
    }

    @Test(arguments: ["staging-total", "run-total", "operations", "slots"])
    func totalAndNonByteBudgetsRefuseBeforeWork(boundary: String) async throws {
        let snapshot = nativeSnapshot(), observer = try NativeOwner.forIsolatedTests()
        let stage = try observer.declarationForTesting(byteCount: snapshot.bytes.count, executing: false)
        let run = try observer.declarationForTesting(byteCount: snapshot.bytes.count, executing: true)
        var budget = NativeOwner.ResourceBudget()
        switch boundary {
        case "staging-total": budget.totalBytes = stage.totalBytes - 1
        case "run-total": budget.totalBytes = run.totalBytes - 1
        case "operations": budget.operations = run.operations - 1
        default: budget.taskSlots = 0
        }
        let owner = try NativeOwner.forResourceTests(budget)
        try await withNativeCleanup(operation: {
            if boundary == "staging-total" {
                await nativeRefuses(.resourceBudgetRefused) { _ = try owner.bindSelection(snapshot, profile: .prototype, hostEpoch: 1) }
                #expect(owner.ownedCopyCountForTesting == 0)
            } else {
                let lease = try owner.bindSelection(snapshot, profile: .prototype, hostEpoch: 1)
                let consent = try owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline())
                await nativeRefuses(.resourceBudgetRefused) { _ = try owner.begin(consent) }
                await nativeRefuses(.consentUnavailable) { _ = try owner.begin(consent) }
            }
            #expect(owner.preparationCountForTesting == 0 && owner.workerBeginCountForTesting == 0)
            #expect(!owner.activeReservationForTesting)
        }, cleanup: { await owner.revokeAndJoin() })
        #expect(try owner.reservedBytesForTesting == 0)
    }

    @Test func exactRunBudgetPromotesAndDemotesOnlyAfterJoin() async throws {
        let snapshot = nativeSnapshot(), observer = try NativeOwner.forIsolatedTests()
        let run = try observer.declarationForTesting(byteCount: snapshot.bytes.count, executing: true)
        let stage = try observer.declarationForTesting(byteCount: snapshot.bytes.count, executing: false)
        var budget = NativeOwner.ResourceBudget()
        budget.componentLimits = run.bytes; budget.totalBytes = run.totalBytes
        budget.operations = run.operations; budget.taskSlots = run.taskSlots
        let owner = try NativeOwner.forResourceTests(budget)
        try await withNativeCleanup(operation: {
            let lease = try owner.bindSelection(snapshot, profile: .prototype, hostEpoch: 1)
            #expect(try owner.reservedBytesForTesting == stage.totalBytes)
            let ticket = try owner.begin(owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline()))
            #expect(try owner.reservedBytesForTesting == run.totalBytes)
            #expect(owner.preparationCountForTesting == 0) // Task has not started on MainActor.
            #expect(try await owner.result(for: ticket).hostEpoch == 1)
            #expect(try owner.reservedBytesForTesting == stage.totalBytes)
            #expect(owner.preparationCountForTesting == 1 && owner.workerBeginCountForTesting == 1)
            #expect(!owner.activeReservationForTesting && !owner.resultClaimedForTesting)
        }, cleanup: { await owner.revokeAndJoin() })
        #expect(try owner.reservedBytesForTesting == 0)
    }

    @Test func invalidUTF8ReleasesStagingReservation() async throws {
        let owner = try NativeOwner.forIsolatedTests()
        let invalid = ArtifactSnapshot(displayName: "bad", kind: .text, bytes: Data([0xff]))
        await nativeRefuses(.invalidSnapshot) { _ = try owner.bindSelection(invalid, profile: .prototype, hostEpoch: 1) }
        #expect(owner.ownedCopyCountForTesting == 1 && owner.preparationCountForTesting == 0)
        #expect(try owner.reservedBytesForTesting == 0)
        #expect(owner.state == .unbound)
    }

    @Test func revocationBeforePreparationHoldsReservationUntilJoined() async throws {
        try await withHeldBridge(at: .beforePreparation) { owner, _, delivery, latch in
            let charged = try owner.reservedBytesForTesting
            owner.invalidate()
            #expect(try owner.reservedBytesForTesting == charged)
            #expect(owner.activeReservationForTesting && owner.preparationCountForTesting == 0)
            await latch.release()
            await nativeRefuses(.revoked) { _ = try await delivery.value }
            #expect(try owner.reservedBytesForTesting == 0)
            #expect(owner.preparationCountForTesting == 0 && owner.workerBeginCountForTesting == 0)
        }
    }

    @Test func retainedTokensDoNotRetainRevokedInputPayload() async throws {
        let owner = try NativeOwner.forIsolatedTests()
        let lease = try owner.bindSelection(nativeSnapshot(), profile: .prototype, hostEpoch: 1)
        let payload = WeakNativePayload(owner.selectedPayloadForTesting)
        let consent = try owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline())
        let ticket = try owner.begin(consent)
        try await withNativeCleanup(operation: { _ = try await owner.result(for: ticket) },
            cleanup: { await owner.revokeAndJoin() })
        withExtendedLifetime((lease, consent, ticket)) { #expect(payload.value == nil) }
        #expect(try owner.reservedBytesForTesting == 0)
    }

    @Test(arguments: [false, true])
    func replacementWhileDrainingReservesCombinedPeak(exactFit: Bool) async throws {
        let first = nativeSnapshot("old"), next = nativeSnapshot("replacement input")
        let observer = try NativeOwner.forIsolatedTests()
        let run = try observer.declarationForTesting(byteCount: first.bytes.count, executing: true)
        let staged = try observer.declarationForTesting(byteCount: next.bytes.count, executing: false)
        var budget = NativeOwner.ResourceBudget()
        budget.totalBytes = run.totalBytes + staged.totalBytes - (exactFit ? 0 : 1)
        let latch = NativeBridgeLatch()
        let owner = try NativeOwner.forResourceTests(budget) { if $0 == .afterWorkerJoined { await latch.suspend() } }
        try await withNativeCleanup(operation: {
            let lease = try owner.bindSelection(first, profile: .prototype, hostEpoch: 1)
            let ticket = try owner.begin(owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline()))
            try await latch.waitForArrival()
            if exactFit {
                // Replacing the pending selection repeatedly must not accumulate a charge.
                var replacement: NativeOwner.HostLease?
                for _ in 0..<3 { replacement = try owner.bindSelection(next, profile: .prototype, hostEpoch: 2) }
                #expect(try owner.reservedBytesForTesting == budget.totalBytes)
                #expect(owner.ownedCopyCountForTesting == 4)
                await nativeRefuses(.busy) { _ = try owner.authorizeLocalReferenceOnce(#require(replacement), deadline: nativeDeadline()) }
                await latch.release()
                await nativeRefuses(.revoked) { _ = try await owner.result(for: ticket) }
                #expect(try owner.reservedBytesForTesting == staged.totalBytes)
                #expect(owner.state == .ready)
                let fresh = try owner.begin(owner.authorizeLocalReferenceOnce(#require(replacement), deadline: nativeDeadline()))
                #expect(try await owner.result(for: fresh).hostEpoch == 2)
            } else {
                await nativeRefuses(.resourceBudgetRefused) { _ = try owner.bindSelection(next, profile: .prototype, hostEpoch: 2) }
                #expect(owner.ownedCopyCountForTesting == 1)
                #expect(try owner.reservedBytesForTesting == run.totalBytes)
                #expect(owner.activeReservationForTesting && owner.state == .stopping)
                await latch.release()
                await nativeRefuses(.revoked) { _ = try await owner.result(for: ticket) }
                #expect(try owner.reservedBytesForTesting == 0)
            }
        }, cleanup: { await latch.release(); await owner.revokeAndJoin() })
        #expect(try owner.reservedBytesForTesting == 0)
    }

    @Test(arguments: [NativeOwner.ResourceComponent.selectedBytes, .preparationScratch, .metadataScratch], [false, true])
    func simultaneousComponentBudgetsApplyToCombinedReservations(
        component: ReferenceArtifactShadowRunOwner.ResourceComponent, exactFit: Bool) async throws {
        let first = nativeSnapshot("original"), next = nativeSnapshot("replacement")
        let observer = try NativeOwner.forIsolatedTests()
        let run = try observer.declarationForTesting(byteCount: first.bytes.count, executing: true)
        let stage = try observer.declarationForTesting(byteCount: next.bytes.count, executing: false)
        let combined = try run.adding(stage)
        var budget = NativeOwner.ResourceBudget()
        budget.componentLimits[component] = try #require(combined.bytes[component]) - (exactFit ? 0 : 1)
        let latch = NativeBridgeLatch()
        let owner = try NativeOwner.forResourceTests(budget) { if $0 == .beforePreparation { await latch.suspend() } }
        try await withNativeCleanup(operation: {
            let lease = try owner.bindSelection(first, profile: .prototype, hostEpoch: 1)
            let ticket = try owner.begin(owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline()))
            try await latch.waitForArrival()
            if exactFit {
                _ = try owner.bindSelection(next, profile: .prototype, hostEpoch: 2)
                #expect(try owner.reservedResourcesForTesting.bytes == combined.bytes)
                #expect(owner.ownedCopyCountForTesting == 2)
            } else {
                await nativeRefuses(.resourceBudgetRefused) { _ = try owner.bindSelection(next, profile: .prototype, hostEpoch: 2) }
                #expect(owner.ownedCopyCountForTesting == 1)
                #expect(try owner.reservedResourcesForTesting.bytes == run.bytes)
            }
            await latch.release()
            await nativeRefuses(.revoked) { _ = try await owner.result(for: ticket) }
            #expect(owner.preparationCountForTesting == 0 && owner.workerBeginCountForTesting == 0)
            #expect(try owner.reservedResourcesForTesting.bytes == (exactFit ? stage.bytes : NativeOwner.ResourceDeclaration.empty.bytes))
        }, cleanup: { await latch.release(); await owner.revokeAndJoin() })
    }

    @Test func operationalFailureVocabularyAndRealBudgetRefusal() async throws {
        let cases: [(any Error, NativeOwner.Failure)] = [
            (ReferenceArtifactShadowPreparation.Failure.foreignCandidate, .preparationRefused),
            (PreparedReferenceMLPEvaluation.Failure.inputNonfinite, .preparationRefused),
            (ReferenceMLPShadowOwner.Failure.expired, .expired),
            (ReferenceMLPShadowOwner.Failure.deadlineOutOfRange, .deadlineOutOfRange),
            (ReferenceMLPShadowOwner.Failure.weightBudgetExceeded, .numericBudgetRefused),
            (ReferenceMLPShadowOwner.Failure.revoked, .workerRefused),
            (ReferenceMLP.Failure.deadlineExceeded, .expired),
            (ReferenceMLP.Failure.intermediateNonfinite, .evaluationRefused),
            (NSError(domain: "test-unexpected", code: 1), .internalFailure),
        ]
        for (source, expected) in cases { #expect(NativeOwner.operationalFailure(source) as? NativeOwner.Failure == expected) }
        #expect(NativeOwner.operationalFailure(CancellationError()) is CancellationError)
        let owner = try NativeOwner.forBudgetTests()
        try await withNativeCleanup(operation: {
            let lease = try owner.bindSelection(nativeSnapshot(), profile: .prototype, hostEpoch: 1)
            let consent = try owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline())
            let ticket = try owner.begin(consent)
            await nativeRefuses(.numericBudgetRefused) { _ = try await owner.result(for: ticket) }
            await nativeRefuses(.consentUnavailable) { _ = try owner.begin(consent) }
            #expect(owner.state == .ready && !owner.resultClaimedForTesting)
            #expect(await owner.workerStateForTesting == .off)
        }, cleanup: { await owner.revokeAndJoin() })
    }

    @Test(arguments: ReferenceArtifactShadowRunOwner.ProbePoint.workerBoundaries, [false, true])
    func unclaimedRunShutdownAndInvalidReplacementJoin(point: ReferenceArtifactShadowRunOwner.ProbePoint, invalidReplacement: Bool) async throws {
        let latch = NativeBridgeLatch()
        let owner = try NativeOwner.forSchedulingTests { if $0 == point { await latch.suspend() } }
        try await withNativeCleanup(operation: {
            let lease = try owner.bindSelection(nativeSnapshot(), profile: .prototype, hostEpoch: 1)
            let ticket = try owner.begin(owner.authorizeLocalReferenceOnce(lease, deadline: nativeDeadline()))
            try await latch.waitForArrival()
            #expect(!owner.resultClaimedForTesting)
            if invalidReplacement {
                await nativeRefuses(.invalidSnapshot) { _ = try owner.bindSelection(nativeSnapshot(""), profile: .prototype, hostEpoch: 2) }
                #expect(owner.state == .stopping)
            }
            let join = Task { await owner.revokeAndJoin() }
            try await withNativeCleanup(operation: {
                let deadline = ContinuousClock().now.advanced(by: .seconds(1))
                while owner.state != .stopping && ContinuousClock().now < deadline { await Task.yield() }
                try #require(owner.state == .stopping)
                await latch.release()
                await join.value
                #expect(owner.state == .unbound)
                #expect(await owner.workerStateForTesting == .off)
                await nativeRefuses(.runUnavailable) { _ = try await owner.result(for: ticket) }
            }, cleanup: { await latch.release(); await join.value })
        }, cleanup: { await latch.release(); await owner.revokeAndJoin() })
    }

    @Test(arguments: NativeOwner.ProbePoint.allCases)
    func revocationAtEveryAwaitBoundaryJoinsAndSuppresses(point: ReferenceArtifactShadowRunOwner.ProbePoint) async throws {
        try await withHeldBridge(at: point) { owner, _, delivery, latch in
            owner.invalidate()
            #expect(owner.state == .stopping)
            await latch.release()
            await nativeRefuses(.revoked) { _ = try await delivery.value }
            #expect(owner.state == .unbound)
            #expect(await owner.workerStateForTesting == .off)
        }
    }

    @Test func duplicateDeliveryIsRefusedWhileClaimIsOutstanding() async throws {
        try await withHeldBridge(at: .afterWorkerJoined) { owner, ticket, delivery, latch in
            try #require(owner.deliveryAttemptCountForTesting == 1)
            let duplicate = Task { try await owner.result(for: ticket) }
            try await withNativeCleanup(operation: {
                let deadline = ContinuousClock().now.advanced(by: .seconds(1))
                while owner.deliveryAttemptCountForTesting < 2 && ContinuousClock().now < deadline { await Task.yield() }
                try #require(owner.deliveryAttemptCountForTesting == 2)
                // Release BEFORE waiting for either result: even the broken
                // guard variant must settle and fail by assertion, not deadlock.
                await latch.release()
                await nativeRefuses(.resultAlreadyClaimed) { _ = try await duplicate.value }
                _ = try await delivery.value
                #expect(owner.state == .ready)
            }, cleanup: { await latch.release(); duplicate.cancel(); _ = await duplicate.result })
        }
    }

    @Test func callerCancellationJoinsInnerWorker() async throws {
        try await withHeldBridge(at: .afterBegin) { owner, _, delivery, latch in
            delivery.cancel()
            await latch.release()
            do { _ = try await delivery.value; Issue.record("Cancelled caller received result") }
            catch is CancellationError {}
            catch { Issue.record("Wrong caller cancellation: \(error)") }
            #expect(owner.state == .ready)
            #expect(await owner.workerStateForTesting == .off)
        }
    }

    @Test func newSelectionDuringOldJoinSurvivesWithoutNewWorkerOverlap() async throws {
        try await withHeldBridge(at: .afterWorkerJoined) { owner, _, delivery, latch in
            let join = Task { await owner.revokeAndJoin() }
            // Wait on observable owner state, not a timing sleep.
            let deadline = ContinuousClock().now.advanced(by: .seconds(1))
            while owner.state != .stopping && ContinuousClock().now < deadline { await Task.yield() }
            try #require(owner.state == .stopping)
            let next = try owner.bindSelection(nativeSnapshot("new selection"), profile: .prototype, hostEpoch: 2)
            await nativeRefuses(.busy) { _ = try owner.authorizeLocalReferenceOnce(next, deadline: nativeDeadline()) }
            await latch.release()
            _ = await delivery.result
            await join.value
            #expect(owner.state == .ready)
            let nextTicket = try owner.begin(owner.authorizeLocalReferenceOnce(next, deadline: nativeDeadline()))
            #expect(try await owner.result(for: nextTicket).hostEpoch == 2)
            #expect(await owner.workerStateForTesting == .off)
        }
    }
#endif
}
