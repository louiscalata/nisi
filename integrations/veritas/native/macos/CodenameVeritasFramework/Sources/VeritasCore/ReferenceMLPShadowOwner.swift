import Foundation

// Internal, same-process numeric SHADOW owner. Control calls are trusted developer
// harness calls, not evidence of user consent, graph admission or protected authority.
// No app/AFM/registry/feature-policy route may treat this owner as a complete gate.
actor ReferenceMLPShadowOwner {
    enum Failure: Error, Equatable, Sendable {
        case invalidScope, invalidBudget, disabled, busy, pendingPermit, wrongScope
        case weightBudgetExceeded, operationBudgetExceeded, outputBudgetExceeded
        case expired, deadlineOutOfRange, foreignPermit, revoked, permitUnavailable
        case foreignRun, runUnavailable, resultAlreadyClaimed
    }

    struct Budget: Sendable {
        let maxWeightBytes: Int
        let maxOperations: Int
        let maxOutputBytes: Int
        let maxInferenceMs: Int

        init(maxWeightBytes: Int, maxOperations: Int, maxOutputBytes: Int, maxInferenceMs: Int) throws {
            guard (1...67_108_864).contains(maxWeightBytes),
                  (1...100_000_000).contains(maxOperations),
                  (1...16_384).contains(maxOutputBytes),
                  (1...1_000).contains(maxInferenceMs) else { throw Failure.invalidBudget }
            self.maxWeightBytes = maxWeightBytes
            self.maxOperations = maxOperations
            self.maxOutputBytes = maxOutputBytes
            self.maxInferenceMs = maxInferenceMs
        }
    }

    fileprivate final class Identity: Sendable {}
    final class Permit: Sendable {
        fileprivate let owner: Identity
        fileprivate let generation: Identity
        fileprivate init(owner: Identity, generation: Identity) {
            self.owner = owner
            self.generation = generation
        }
    }
    final class RunTicket: Sendable {
        fileprivate let owner: Identity
        fileprivate let generation: Identity
        fileprivate init(owner: Identity, generation: Identity) {
            self.owner = owner
            self.generation = generation
        }
    }
    enum State: String, Sendable { case off, ready, prepared, running, stopping }

    private struct Pending: Sendable {
        let token: Permit
        let prepared: PreparedReferenceMLPEvaluation
        let deadline: ContinuousClock.Instant
    }
    private struct Active: Sendable {
        let ticket: RunTicket
        let task: Task<PreparedReferenceMLPEvaluation.Result, Error>
        let deadline: ContinuousClock.Instant
        var resultClaimed = false
    }
    private let identity = Identity()
    private var generation = Identity()
    private let scopeID: String
    private let budget: Budget
    private var enabled = false
    private var pending: Pending?
    private var active: Active?

#if DEBUG
    enum DeliveryProbePoint: Equatable, Sendable { case afterWorkerJoinedBeforeDeliveryRecheck }
    // Debug developer scheduling only. No input/output/worker/permission is exposed.
    // The ordinary initializer installs no callback; optimized builds omit this seam.
    // A test callback can suspend indefinitely, so its owner must release and join it.
    private let deliveryProbeForTesting: (@Sendable (DeliveryProbePoint) async -> Void)?
#endif

    init(scopeID: String, budget: Budget) throws {
        self.scopeID = try Self.checkedScope(scopeID)
        self.budget = budget
#if DEBUG
        self.deliveryProbeForTesting = nil
#endif
    }

#if DEBUG
    init(scopeID: String, budget: Budget,
         forPostAwaitRevocationTesting probe: @escaping @Sendable (DeliveryProbePoint) async -> Void) throws {
        self.scopeID = try Self.checkedScope(scopeID)
        self.budget = budget
        self.deliveryProbeForTesting = probe
    }
#endif

    private static func checkedScope(_ scopeID: String) throws -> String {
        let bytes = Array(scopeID.utf8.prefix(97))
        guard !bytes.isEmpty, bytes.count <= 96, (97...122).contains(bytes[0]),
              bytes.dropFirst().allSatisfy({ (97...122).contains($0) || (48...57).contains($0) || [45, 46, 95].contains($0) })
        else { throw Failure.invalidScope }
        return scopeID
    }

    var state: State {
        if active != nil { return enabled ? .running : .stopping }
        if !enabled { return .off }
        return pending == nil ? .ready : .prepared
    }

    // A local controller action, never callable by interpreting model/JSON ALLOW.
    func enable() throws {
        guard active == nil else { throw Failure.busy }
        // Repeated ON must not silently revoke a prepared request.
        if enabled { return }
        generation = Identity()
        enabled = true
    }

    func grant(_ prepared: PreparedReferenceMLPEvaluation, deadline: ContinuousClock.Instant) throws -> Permit {
        guard enabled else { throw Failure.disabled }
        guard active == nil else { throw Failure.busy }
        guard pending == nil else { throw Failure.pendingPermit }
        guard prepared.scopeID == scopeID else { throw Failure.wrongScope }
        // Numeric payload/work only. The model/input were constructed already;
        // construction peaks, workspace, packaging and total process RSS are NOT admitted.
        guard prepared.shape.cost.weightBytes <= budget.maxWeightBytes else { throw Failure.weightBudgetExceeded }
        guard prepared.shape.cost.scalarOperations <= budget.maxOperations else { throw Failure.operationBudgetExceeded }
        guard prepared.shape.output * 4 <= budget.maxOutputBytes else { throw Failure.outputBudgetExceeded }
        let now = ContinuousClock().now
        guard deadline > now else { throw Failure.expired }
        guard deadline <= now.advanced(by: .milliseconds(budget.maxInferenceMs)) else { throw Failure.deadlineOutOfRange }
        let token = Permit(owner: identity, generation: generation)
        pending = Pending(token: token, prepared: prepared, deadline: deadline)
        return token
    }

    func begin(_ token: Permit) throws -> RunTicket {
        guard token.owner === identity else { throw Failure.foreignPermit }
        guard token.generation === generation else { throw Failure.revoked }
        guard enabled else { throw Failure.disabled }
        guard active == nil else { throw Failure.busy }
        guard let capture = pending, capture.token === token else { throw Failure.permitUnavailable }
        pending = nil // One attempt consumes the permit, including expiry/cancellation.
        guard capture.deadline > ContinuousClock().now else { throw Failure.expired }
        try Task.checkCancellation()
        let prepared = capture.prepared
        let deadline = capture.deadline
        let task = Task.detached(priority: .utility) {
            try Task.checkCancellation()
            let output = try prepared.evaluate(deadline: deadline)
            try Task.checkCancellation()
            return output
        }
        let ticket = RunTicket(owner: identity, generation: generation)
        active = Active(ticket: ticket, task: task, deadline: deadline)
        return ticket
    }

    func result(for ticket: RunTicket) async throws -> PreparedReferenceMLPEvaluation.Result {
        guard ticket.owner === identity else { throw Failure.foreignRun }
        guard ticket.generation === generation else { throw Failure.revoked }
        guard var run = active, run.ticket === ticket else { throw Failure.runUnavailable }
        guard !run.resultClaimed else { throw Failure.resultAlreadyClaimed }
        run.resultClaimed = true
        active = run
        let worker = run.task
        let outcome = await withTaskCancellationHandler {
            await worker.result
        } onCancel: {
            worker.cancel()
        }
#if DEBUG
        if let deliveryProbeForTesting {
            await deliveryProbeForTesting(.afterWorkerJoinedBeforeDeliveryRecheck)
        }
#endif
        // Await is reentrant. OFF or a newer run must never be overwritten here.
        guard ticket.generation === generation, enabled else { throw Failure.revoked }
        guard active?.ticket === ticket else { throw Failure.runUnavailable }
        active = nil // Worker has joined; success, error and cancellation consume delivery.
        try Task.checkCancellation()
        guard run.deadline > ContinuousClock().now else { throw Failure.expired }
        return try outcome.get()
    }

    func off() async {
        enabled = false
        generation = Identity()
        pending = nil
        guard let run = active else { return }
        run.task.cancel()
        _ = await run.task.result // Never claim physical stop before the worker joins.
        if active?.ticket === run.ticket { active = nil }
    }
}
