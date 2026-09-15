import Foundation
import Testing
import VeritasCore
@testable import VeritasAppleFoundation

private final class ProbeCompletionWitness: @unchecked Sendable {
    private let lock = NSLock()
    private var finished = false
    func markFinished() { lock.lock(); finished = true; lock.unlock() }
    func isFinished() -> Bool { lock.lock(); defer { lock.unlock() }; return finished }
}

private actor TrialBackend: AppleTrialBackend {
    enum Behavior: Sendable { case normal, limit, reusedSession, failure, hold, cancel }
    let behavior: Behavior
    private(set) var inputs: [(String, String)] = []
    private(set) var returned = false
    private var started = false
    private var startedWaiters: [CheckedContinuation<Void, Never>] = []
    private var releaseWaiter: CheckedContinuation<Void, Never>?
    private let reusedID = UUID().uuidString
    init(_ behavior: Behavior = .normal) { self.behavior = behavior }
    func generate(instructions: String, prompt: String) async throws -> AppleTrialCompletion {
        inputs.append((instructions, prompt))
        if behavior == .hold {
            await withCheckedContinuation { continuation in
                releaseWaiter = continuation; started = true
                let waiters = startedWaiters; startedWaiters.removeAll()
                for waiter in waiters { waiter.resume() }
            }
        }
        if behavior == .failure { throw AppleTrialFailure(code: "MODEL_REFUSED") }
        if behavior == .cancel { throw CancellationError() }
        returned = true
        return .init(text: prompt.contains("Requested additional guidance:") ? "# Testing\nTwo synthetic checks." : "# Overview\nSynthetic overview.",
            sessionID: behavior == .reusedSession ? reusedID : UUID().uuidString,
            instructionTokens: 40, promptTokens: 50, contextSize: 4096, inputTokens: 90,
            outputTokens: behavior == .limit ? 256 : 20, reasoningTokens: 0)
    }
    func waitStarted() async {
        if started { return }; await withCheckedContinuation { startedWaiters.append($0) }
    }
    func release() { let waiter = releaseWaiter; releaseWaiter = nil; waiter?.resume() }
}

@Suite("AFM paired trial boundary — injected SDK responses, no live inference")
struct ApplePreventionTrialTests {
    private func completion(output: Int? = 20, input: Int? = 90, reasoning: Int? = 0,
                            text: String = "# Testing\nChecks", session: String = UUID().uuidString) -> AppleTrialCompletion {
        .init(text: text, sessionID: session, instructionTokens: 40, promptTokens: 50,
              contextSize: 4096, inputTokens: input, outputTokens: output, reasoningTokens: reasoning)
    }
    @Test("Token preflight refuses invalid and overflowing counts without wrapping")
    func budget() {
        #expect(AppleTrialRules.budgetFits(instructions: 40, prompt: 50, context: 410))
        #expect(!AppleTrialRules.budgetFits(instructions: 40, prompt: 50, context: 409))
        for context in [0,-1] { #expect(!AppleTrialRules.budgetFits(instructions: 0, prompt: 0, context: context)) }
        #expect(!AppleTrialRules.budgetFits(instructions: -1, prompt: 50, context: 4096))
        #expect(!AppleTrialRules.budgetFits(instructions: 1, prompt: -1, context: 4096))
        #expect(!AppleTrialRules.budgetFits(instructions: Int.max, prompt: 1, context: Int.max))
        #expect(AppleTrialRules.responseTokens == 256 && AppleTrialRules.margin == 64)
    }
    @Test("Final prompt includes exact guidance only on treatment")
    func prompt() {
        let task = "Unique task", guidance = "Unique guidance"
        #expect(AppleTrialRules.prompt(task: task, guidance: nil) == "Documentation task:\nUnique task")
        #expect(AppleTrialRules.prompt(task: task, guidance: guidance) == "Documentation task:\nUnique task\nRequested additional guidance:\nUnique guidance")
        #expect(!AppleTrialRules.instructions.contains("Testing"))
    }
    @Test("SDK usage at the cap is completion unknown, not a successful capture")
    func completionLimits() {
        #expect(AppleTrialRules.refusal(completion(output: 255)) == nil)
        for count in [256,257,Int.max] {
            #expect(AppleTrialRules.refusal(completion(output: count)) == "OUTPUT_LIMIT_REACHED_OR_COMPLETION_UNKNOWN")
        }
        for value in [completion(output: nil),completion(output: -1),completion(output: 0),completion(input: nil),completion(input: -1),completion(input: 0),
                      completion(input: 4097),completion(reasoning: nil),completion(reasoning: -1),completion(reasoning: 21)] {
            #expect(AppleTrialRules.refusal(value) == "MODEL_USAGE_UNAVAILABLE_OR_INVALID")
        }
        #expect(AppleTrialRules.refusal(completion(session: "not-uuid")) == "SESSION_ID_INVALID")
        #expect(AppleTrialRules.refusal(completion(text: "")) == "MODEL_OUTPUT_EMPTY_OR_OVER_LIMIT")
        #expect(AppleTrialRules.refusal(completion(text: String(repeating: "é", count: 32_769))) == "MODEL_OUTPUT_EMPTY_OR_OVER_LIMIT")
    }
    @Test("Fixed probe executes four distinct calls and keeps trial non-authorizing")
    func fixedProbe() async throws {
        let backend = TrialBackend(), result = try await AppleFoundationPreventionProbe.run(backend: backend)
        let inputs = await backend.inputs
        #expect(inputs.count == 4 && result.calls.count == 4)
        #expect(Set(result.calls.compactMap(\.sessionID)).count == 4)
        #expect(result.calls.map(\.arm) == [.baseline,.treatment,.treatment,.baseline])
        #expect(result.calls.allSatisfy { $0.runID == result.trial.runID })
        #expect(result.calls.map(\.caseID) == ["doc-a","doc-a","doc-b","doc-b"])
        #expect(inputs.map { $0.1.contains("Requested additional guidance:") } == [false,true,true,false])
        #expect(inputs.allSatisfy { $0.0 == AppleTrialRules.instructions })
        #expect(result.trial.total.improved == 2 && result.trial.total.unavailable == 0)
        #expect(result.status == "COMPLETED_AFM_DRAFTING_TRIAL") // Injected test, NOT model evidence.
        #expect(!result.authority && !result.productionAdmission && !result.externalToolsEnabled)
        #expect(result.trial.authorizing == false && result.trial.pairs.count == 2)
    }
    @Test("Refusal, cap and reused sessions cannot produce a completed probe")
    func unavailable() async throws {
        for behavior in [TrialBackend.Behavior.failure,.limit,.reusedSession] {
            let result = try await AppleFoundationPreventionProbe.run(backend: TrialBackend(behavior))
            #expect(result.calls.count == 4 && result.trial.total.total == 2)
            #expect(result.status == "INCOMPLETE_AFM_DRAFTING_TRIAL")
            #expect(result.trial.total.unavailable == 2 && result.trial.total.improved == 0)
            #expect(result.trial.pairs.allSatisfy { $0.baseline.outputDigest == nil || $0.treatment.outputDigest == nil })
        }
    }
    @Test("Cancellation stays joined to a held backend rather than returning early")
    func cancellationJoin() async throws {
        let backend = TrialBackend(.hold)
        let witness = ProbeCompletionWitness()
        let task = Task {
            defer { witness.markFinished() }
            return try await AppleFoundationPreventionProbe.run(backend: backend)
        }
        await backend.waitStarted(); task.cancel()
        // Give an erroneous early-return cancellation wrapper scheduling turns.
        // This observes the OUTER task, not only the still-held backend.
        for _ in 0..<100 { await Task.yield() }
        #expect(!witness.isFinished())
        #expect(await backend.returned == false)
        #expect(await backend.inputs.count == 1)
        await backend.release()
        do { _ = try await task.value; Issue.record("cancellation returned a probe result") }
        catch is CancellationError {} catch { Issue.record("wrong cancellation error") }
        #expect(witness.isFinished())
        #expect(await backend.returned)
        #expect(await backend.inputs.count == 1)
    }
    @Test("Pre-cancellation and SDK cancellation do not turn into unavailable success")
    func cancellationTruth() async {
        for behavior in [TrialBackend.Behavior.normal,.cancel] {
            let backend = TrialBackend(behavior)
            let task = Task {
                if behavior == .normal { withUnsafeCurrentTask { $0?.cancel() } }
                return try await AppleFoundationPreventionProbe.run(backend: backend)
            }
            do { _ = try await task.value; Issue.record("expected cancellation") }
            catch is CancellationError {} catch { Issue.record("wrong cancellation type") }
            #expect(await backend.inputs.count == (behavior == .normal ? 0 : 1))
        }
    }
    @Test("Probe encoding retains observations but not raw prompt/draft or authority")
    func encoding() async throws {
        let result = try await AppleFoundationPreventionProbe.run(backend: TrialBackend())
        let data = try JSONEncoder().encode(result)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object["authority"] as? Bool == false)
        #expect(object["productionAdmission"] as? Bool == false)
        #expect(object["rawDraftsRetained"] as? Bool == false)
        let text = String(decoding: data, as: UTF8.self)
        #expect(!text.contains("Synthetic overview") && !text.contains("Two synthetic checks"))
        #expect(!text.contains("Write a short Markdown note") && !text.contains("Requested additional guidance"))
        #expect(result.limitationCodes.contains("NO_TYPED_COMPLETION_REASON"))
        #expect(result.limitationCodes.contains("NO_EFFICACY_OR_HOLDOUT_CONCLUSION"))
    }
}
