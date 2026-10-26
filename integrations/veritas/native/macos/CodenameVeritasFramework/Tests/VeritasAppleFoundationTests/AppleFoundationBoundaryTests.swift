import Foundation
import Testing
import VeritasCore
@testable import VeritasAppleFoundation

#if canImport(FoundationModels)
import FoundationModels
#endif

private struct ForeignBoundaryError: Error {}

private actor CancellationLatch {
    private var opened = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    func wait() async {
        if opened { return }
        await withCheckedContinuation { waiters.append($0) }
    }
    func open() {
        opened = true
        let pending = waiters
        waiters.removeAll()
        for waiter in pending { waiter.resume() }
    }
}

private actor CancellationInvocationCount {
    private(set) var count = 0
    func invoked() { count += 1 }
}

@Suite("Apple Foundation Models boundary")
struct AppleFoundationBoundaryTests {
    @Test("Factory creates an advisory orchestrator without running the model")
    func factoryBoundary() {
        let orchestrator: any AdvisoryOrchestrator = AppleFoundationOrchestratorFactory.make()
        let typeName = String(reflecting: type(of: orchestrator))

        #expect(!typeName.isEmpty)
    }

    @Test("Deterministic fallback is explicitly degraded")
    func deterministicFallback() async {
        let fallback = DeterministicOnlyOrchestrator(reasonCode: "TEST_FALLBACK")
        let probe = await fallback.probe()

        #expect(probe.state == .degraded)
        #expect(probe.provider == "none")
        #expect(probe.reasonCode == "TEST_FALLBACK")
    }

    @Test("Token budgeting sums the actual components and safety margin")
    func tokenBudgetArithmetic() {
        let budget = AppleTokenBudget(
            instructionTokens: 10,
            promptTokens: 20,
            schemaTokens: 30,
            responseTokens: 40,
            safetyMarginTokens: 5
        )

        #expect(budget.total == 105)
        #expect(budget.fits(contextSize: 105))
        #expect(budget.fits(contextSize: 104) == false)
        #expect(budget.fits(contextSize: 0) == false)
    }

    @Test("Raw advisory text is normalized and malformed values fail closed")
    func advisoryValidation() {
        #expect(AppleAdvisoryValidation.normalizedDimension(" Risk \n") == "risk")
        #expect(AppleAdvisoryValidation.normalizedSeverity(" WARNING ") == .warning)
        #expect(AppleAdvisoryValidation.normalizedSeverity("critical") == nil)
        #expect(AppleAdvisoryValidation.normalizedBoundedText("  finding  ") == "finding")
        #expect(AppleAdvisoryValidation.normalizedBoundedText(" \n\t ") == nil)
        #expect(AppleAdvisoryValidation.normalizedBoundedText(String(repeating: "é", count: 257)) == nil)
    }

#if canImport(FoundationModels)
    @Test("Every public AFM availability state has a stable fail-closed reason")
    func availabilityClassification() {
        let cases: [(SystemLanguageModel.Availability, String)] = [
            (.available, "MODEL_AVAILABLE"),
            (.unavailable(.deviceNotEligible), "MODEL_DEVICE_NOT_ELIGIBLE"),
            (.unavailable(.appleIntelligenceNotEnabled), "MODEL_APPLE_INTELLIGENCE_DISABLED"),
            (.unavailable(.modelNotReady), "MODEL_NOT_READY"),
        ]

        for (availability, expectedCode) in cases {
            #expect(AppleFoundationOrchestrator.availabilityReason(availability) == expectedCode)
        }
    }

    @Test("Every SDK error exposed by the active compiler maps to a stable non-authorizing code")
    func sdkErrorClassification() {
#if compiler(>=6.4)
        let cases: [(any Error, String)] = [
            (
                LanguageModelError.contextSizeExceeded(
                    .init(
                        contextSize: 4_096,
                        tokenCount: 4_097,
                        debugDescription: "fixture"
                    )
                ),
                "MODEL_CONTEXT_EXHAUSTED"
            ),
            (
                LanguageModelError.rateLimited(
                    .init(resetDate: nil, debugDescription: "fixture")
                ),
                "MODEL_RATE_LIMITED"
            ),
            (
                LanguageModelError.guardrailViolation(
                    .init(debugDescription: "fixture")
                ),
                "MODEL_GUARDRAIL_REFUSAL"
            ),
            (
                LanguageModelError.refusal(
                    .init(explanation: "fixture", debugDescription: "fixture")
                ),
                "MODEL_REFUSED"
            ),
            (
                LanguageModelError.unsupportedCapability(
                    .init(capability: .vision, debugDescription: "fixture")
                ),
                "MODEL_CAPABILITY_UNSUPPORTED"
            ),
            (
                LanguageModelError.unsupportedTranscriptContent(
                    .init(unsupportedContent: [], debugDescription: "fixture")
                ),
                "MODEL_TRANSCRIPT_UNSUPPORTED"
            ),
            (
                LanguageModelError.unsupportedGenerationGuide(
                    .init(schemaName: "Fixture", debugDescription: "fixture")
                ),
                "MODEL_GUIDE_UNSUPPORTED"
            ),
            (
                LanguageModelError.unsupportedLanguageOrLocale(
                    .init(languageCode: Locale.LanguageCode("en"), debugDescription: "fixture")
                ),
                "MODEL_LANGUAGE_UNSUPPORTED"
            ),
            (
                LanguageModelError.timeout(
                    .init(debugDescription: "fixture")
                ),
                "MODEL_RUNTIME_TIMEOUT"
            ),
            (
                SystemLanguageModel.Error.assetsUnavailable(
                    .init(debugDescription: "fixture")
                ),
                "MODEL_ASSETS_UNAVAILABLE"
            ),
            (
                GeneratedContent.ParsingError(
                    rawContent: "{",
                    debugDescription: "fixture"
                ),
                "MODEL_STRUCTURED_DECODING_FAILED"
            ),
            (
                LanguageModelSession.Error.concurrentRequests,
                "MODEL_CONCURRENT_REQUEST_REJECTED"
            ),
            (
                LanguageModelSession.Error.transcriptMutationWhileResponding,
                "MODEL_TRANSCRIPT_MUTATION_REJECTED"
            ),
        ]
#else
        let context = LanguageModelSession.GenerationError.Context(
            debugDescription: "fixture"
        )
        let refusal = LanguageModelSession.GenerationError.Refusal(
            transcriptEntries: []
        )
        let cases: [(any Error, String)] = [
            (
                LanguageModelSession.GenerationError.exceededContextWindowSize(context),
                "MODEL_CONTEXT_EXHAUSTED"
            ),
            (
                LanguageModelSession.GenerationError.assetsUnavailable(context),
                "MODEL_ASSETS_UNAVAILABLE"
            ),
            (
                LanguageModelSession.GenerationError.guardrailViolation(context),
                "MODEL_GUARDRAIL_REFUSAL"
            ),
            (
                LanguageModelSession.GenerationError.unsupportedGuide(context),
                "MODEL_GUIDE_UNSUPPORTED"
            ),
            (
                LanguageModelSession.GenerationError.unsupportedLanguageOrLocale(context),
                "MODEL_LANGUAGE_UNSUPPORTED"
            ),
            (
                LanguageModelSession.GenerationError.decodingFailure(context),
                "MODEL_STRUCTURED_DECODING_FAILED"
            ),
            (
                LanguageModelSession.GenerationError.rateLimited(context),
                "MODEL_RATE_LIMITED"
            ),
            (
                LanguageModelSession.GenerationError.concurrentRequests(context),
                "MODEL_CONCURRENT_REQUEST_REJECTED"
            ),
            (
                LanguageModelSession.GenerationError.refusal(refusal, context),
                "MODEL_REFUSED"
            ),
        ]
#endif

        for (error, expectedCode) in cases {
            #expect(
                AppleFoundationOrchestrator.normalizedErrorCode(
                    error,
                    fallback: "TEST_FALLBACK"
                ) == expectedCode
            )
        }

        #expect(
            AppleFoundationOrchestrator.normalizedErrorCode(
                ForeignBoundaryError(),
                fallback: "TEST_FALLBACK"
            ) == "TEST_FALLBACK"
        )
    }

    @Test("The local deadline error stays distinct from the SDK runtime timeout")
    func localTimeoutClassification() async {
        var normalizedCode: String?
        do {
            let _: Int = try await withTimeout(seconds: 1) {
                try await Task.sleep(for: .seconds(2))
                return 7
            }
        } catch {
            normalizedCode = AppleFoundationOrchestrator.normalizedErrorCode(
                error,
                fallback: "TEST_FALLBACK"
            )
        }

        #expect(normalizedCode == "MODEL_TIMEOUT")
    }
#endif

    @Test("Operation tracking refuses to call active work quiescent")
    func operationTracking() async {
        let tracker = AppleOperationTracker()
        let operationID = UUID()

        #expect(await tracker.isQuiescent())
        await tracker.begin(operationID)
        #expect(await tracker.isQuiescent() == false)
        await tracker.finish(operationID)
        #expect(await tracker.isQuiescent())
    }

    @Test("An already canceled deadline caller never invokes the operation body")
    func cancelledBeforeOperationStarts() async {
        let admission = CancellationLatch()
        let calls = CancellationInvocationCount()
        let caller = Task {
            await admission.wait()
            do {
                let _: Int = try await withTimeout(seconds: 2) {
                    await calls.invoked()
                    return 7
                }
                return "SUCCESS"
            } catch is CancellationError { return "CANCELLED" }
            catch { return "OTHER_ERROR" }
        }
        caller.cancel()
        await admission.open()
        #expect(await caller.value == "CANCELLED")
        #expect(await calls.count == 0)
    }

    @Test("Caller cancellation returns before noncooperative work drains and blocks another request")
    func cancelledTrackedOperationDrains() async throws {
        let orchestrator = AppleFoundationOrchestrator(timeoutSeconds: 1)
        let request = try #require(await orchestrator.beginRequest())
        let entered = CancellationLatch(), release = CancellationLatch()
        let caller = Task {
            do {
                let _: Int = try await orchestrator.runTrackedOperation {
                    await entered.open()
                    await release.wait()
                    return 7
                }
                return "SUCCESS"
            } catch is CancellationError { return "CANCELLED" }
            catch { return "OTHER_ERROR" }
        }
        await entered.wait()
        caller.cancel()
        let outcome = await caller.value
        await orchestrator.finishRequest(request)
        let busy = await orchestrator.isQuiescent() == false
        let rejected = await orchestrator.beginRequest() == nil
        // Drain before assertions, including when testing the broken baseline.
        await release.open()
        await orchestrator.waitUntilRequestReleased(request)
        #expect(outcome == "CANCELLED")
        #expect(busy)
        #expect(rejected)
        #expect(await orchestrator.isQuiescent())
        let next = try #require(await orchestrator.beginRequest())
        await orchestrator.finishRequest(next)
    }

    @Test("Late operation errors cannot replace the caller cancellation result")
    func cancelledLateFailure() async {
        let entered = CancellationLatch(), release = CancellationLatch()
        let drained = CancellationLatch()
        let caller = Task {
            do {
                let _: Int = try await withTimeout(seconds: 1) {
                    await entered.open()
                    await release.wait()
                    await drained.open()
                    throw ForeignBoundaryError()
                }
                return "SUCCESS"
            } catch is CancellationError { return "CANCELLED" }
            catch { return "OTHER_ERROR" }
        }
        await entered.wait()
        caller.cancel()
        let outcome = await caller.value
        await release.open()
        await drained.wait()
        #expect(outcome == "CANCELLED")
    }

    @Test("Cancellation has its own stable non-authorizing adapter reason")
    func cancellationClassification() {
        #expect(AppleFoundationOrchestrator.normalizedErrorCode(
            CancellationError(), fallback: "MODEL_GENERATION_FAILED"
        ) == "ANALYZER_REQUEST_CANCELLED")
    }

    @Test("Pre-canceled tracked work drains even when its body never starts")
    func precancelledTrackingDrains() async throws {
        let orchestrator = AppleFoundationOrchestrator(timeoutSeconds: 1)
        let request = try #require(await orchestrator.beginRequest())
        let admission = CancellationLatch(), calls = CancellationInvocationCount()
        let caller = Task {
            await admission.wait()
            do {
                let _: Int = try await orchestrator.runTrackedOperation {
                    await calls.invoked()
                    return 7
                }
                return false
            } catch is CancellationError { return true }
            catch { return false }
        }
        caller.cancel()
        await admission.open()
        let cancelled = await caller.value
        await orchestrator.finishRequest(request)
        await orchestrator.waitUntilRequestReleased(request)
        #expect(cancelled)
        #expect(await calls.count == 0)
        #expect(await orchestrator.isQuiescent())
    }

    @Test("Early cancellation survives late continuation and task-handle installation")
    func earlyCancellationInstallation() async {
        let gate = OneShotContinuation<Int>()
        let release = CancellationLatch(), cancelled = CancellationInvocationCount()
        #expect(gate.fail(CancellationError(), cancelOperation: true))
        #expect(!gate.succeed(42))
        #expect(!gate.mayStartOperation())
        let operation = Task<Void, Never> {
            await release.wait()
            if Task.isCancelled { await cancelled.invoked() }
        }
        let timer = Task<Void, Never> {
            await release.wait()
            if Task.isCancelled { await cancelled.invoked() }
        }
        gate.installOperation(operation)
        gate.installTimer(timer)
        var receivedCancellation = false
        do {
            let _: Int = try await withCheckedThrowingContinuation { gate.install($0) }
        } catch is CancellationError { receivedCancellation = true }
        catch {}
        await release.open()
        await operation.value
        await timer.value
        #expect(receivedCancellation)
        #expect(await cancelled.count == 2)
    }

    @Test("Success cancels an installed timer and a timer installed after completion")
    func completedGateCancelsTimers() async throws {
        let gate = OneShotContinuation<Int>()
        let release = CancellationLatch(), cancelled = CancellationInvocationCount()
        let first = Task<Void, Never> {
            await release.wait()
            if Task.isCancelled { await cancelled.invoked() }
        }
        gate.installTimer(first)
        #expect(gate.succeed(42))
        #expect(!gate.fail(CancellationError(), cancelOperation: true))
        let second = Task<Void, Never> {
            await release.wait()
            if Task.isCancelled { await cancelled.invoked() }
        }
        gate.installTimer(second)
        let value: Int = try await withCheckedThrowingContinuation { gate.install($0) }
        await release.open()
        await first.value
        await second.value
        #expect(value == 42)
        #expect(await cancelled.count == 2)
    }

    @Test("A cooperative child observes caller cancellation and reports completion exactly once")
    func cooperativeCancellationCompletion() async {
        let entered = CancellationLatch(), stop = CancellationLatch(), drained = CancellationLatch()
        let completions = CancellationInvocationCount(), cancellations = CancellationInvocationCount()
        let caller = Task {
            do {
                let _: Int = try await withTimeout(seconds: 1, operationFinished: {
                    await completions.invoked()
                    await drained.open()
                }) {
                    await withTaskCancellationHandler {
                        await entered.open()
                        await stop.wait()
                    } onCancel: { Task { await stop.open() } }
                    if Task.isCancelled { await cancellations.invoked() }
                    try Task.checkCancellation()
                    return 7
                }
                return false
            } catch is CancellationError { return true }
            catch { return false }
        }
        await entered.wait()
        caller.cancel()
        let cancelled = await caller.value
        await drained.wait()
        #expect(cancelled)
        #expect(await completions.count == 1)
        #expect(await cancellations.count == 1)
    }

    @Test("Deadline helper returns success and rejects a cooperative overrun")
    func deadlinePrimitive() async throws {
        let success: Int = try await withTimeout(seconds: 1) { 42 }
        #expect(success == 42)

        var timedOut = false
        do {
            let _: Int = try await withTimeout(seconds: 1) {
                try await Task.sleep(for: .seconds(2))
                return 7
            }
        } catch {
            timedOut = true
        }
        #expect(timedOut)
    }

    @Test("A noncooperative timeout remains nonquiescent and single-flight until actual drain")
    func noncooperativeTimeoutLifecycle() async throws {
        let orchestrator = AppleFoundationOrchestrator(timeoutSeconds: 1)
        let requestID = try #require(await orchestrator.beginRequest())
        let timedOperation = Task {
            do {
                let _: Int = try await orchestrator.runTrackedOperation {
                    await withCheckedContinuation { continuation in
                        DispatchQueue.global().asyncAfter(deadline: .now() + 1.35) {
                            continuation.resume(returning: 7)
                        }
                    }
                }
                return false
            } catch {
                return true
            }
        }

        try await Task.sleep(for: .milliseconds(1_100))
        #expect(await timedOperation.value)
        await orchestrator.finishRequest(requestID)
        #expect(await orchestrator.isQuiescent() == false)
        #expect(await orchestrator.beginRequest() == nil)

        await orchestrator.waitUntilRequestReleased(requestID)
        #expect(await orchestrator.isQuiescent())
        let nextRequestID = try #require(await orchestrator.beginRequest())
        await orchestrator.finishRequest(nextRequestID)
    }
}
