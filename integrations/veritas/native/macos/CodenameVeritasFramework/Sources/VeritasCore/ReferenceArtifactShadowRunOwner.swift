import Foundation

/// One same-process consent/run bridge. Package-only trusted host control, not
/// protected consent, release admission, a plugin registry or a global scheduler.
/// AppModel lifecycle wiring may retain this owner, but production admission and
/// the AFM route remain unavailable until their separate gates are met.
/// The host must retain this owner and call result or revokeAndJoin. Deinit does
/// not provide asynchronous cancellation/join for an unclaimed active run.
@MainActor
package final class ReferenceArtifactShadowRunOwner {
    package enum Failure: Error, Equatable, Sendable {
        case noSelection, foreignLease, staleLease, busy, pendingConsent
        case invalidSnapshot, invalidProfile, expired, deadlineOutOfRange
        case foreignConsent, revoked, consentUnavailable, foreignRun, runUnavailable
        case resultAlreadyClaimed, resultIdentityMismatch
        case preparationRefused, numericBudgetRefused, workerRefused, evaluationRefused, internalFailure
        case resourceBudgetRefused, resourceArithmeticOverflow
        case buildAdmissionRefused
    }
    package enum Action: String, Sendable { case bn01ReferenceEvaluation }
    package enum DataPurpose: String, Sendable { case selectedSnapshotBytesLocalOnly }
    package enum State: String, Sendable { case unbound, ready, consented, running, stopping }
    fileprivate final class Identity: Sendable {}

    package final class HostLease: Sendable {
        fileprivate let owner: Identity
        fileprivate let generation: Identity
        fileprivate init(owner: Identity, generation: Identity) {
            self.owner = owner; self.generation = generation
        }
    }
    /// Immutable display facts from the actual bound owner. No token or decoder
    /// can turn these values into build approval or authenticated human consent.
    package struct ReviewDescriptor: Sendable {
        package let subjectSHA256: String
        package let artifactKind: ArtifactKind
        package let inputByteCount: Int
        package let profileID, profileSHA256: String
        package let hostEpoch: UInt64
        package let packageSHA256, buildReceiptSHA256: String
        package let declaredBytes, scalarOperations, taskSlots: Int
        package let byteLimit, operationLimit, taskSlotLimit: Int
        package var authoritative: Bool { false }
        fileprivate init(selection: Selection, packageDigest: String, buildReceipt: String,
                         declaration: ResourceDeclaration, budget: ResourceBudget) {
            subjectSHA256 = selection.snapshot.subjectDigest; artifactKind = selection.snapshot.kind
            inputByteCount = selection.snapshot.bytes.count
            profileID = selection.profile.id; profileSHA256 = selection.profile.rulesFingerprint
            hostEpoch = selection.epoch; packageSHA256 = packageDigest
            buildReceiptSHA256 = buildReceipt
            declaredBytes = declaration.totalBytes; scalarOperations = declaration.operations; taskSlots = declaration.taskSlots
            byteLimit = budget.totalBytes; operationLimit = budget.operations; taskSlotLimit = budget.taskSlots
        }
    }
    // External tokens never retain selected bytes. Only the owner and its joined
    // task hold this payload, so keeping revoked tokens cannot pin input copies.
    fileprivate final class Selection: Sendable {
        let lease: HostLease
        let snapshot: ArtifactSnapshot
        let profile: CheckProfile
        let epoch: UInt64
        let staged: ResourceDeclaration
        init(lease: HostLease, snapshot: ArtifactSnapshot, profile: CheckProfile,
             epoch: UInt64, staged: ResourceDeclaration) {
            self.lease = lease; self.snapshot = snapshot; self.profile = profile
            self.epoch = epoch; self.staged = staged
        }
    }

    // Logical payload/scratch allowances, NOT physical allocation/RSS bounds.
    // The caller's original Data, Swift/OS allocator overhead, fixed catalog
    // bootstrap and unrelated owners are outside this single-owner accounting.
    enum ResourceComponent: CaseIterable, Sendable {
        case selectedBytes, preparationScratch, metadataScratch, modelWeights
        case numericBuffers, resultEnvelope, taskEnvelope
    }
    struct ResourceDeclaration: Sendable {
        let bytes: [ResourceComponent: Int]
        let totalBytes: Int
        let operations: Int
        let taskSlots: Int
        static var empty: Self { Self(bytes: Dictionary(uniqueKeysWithValues: ResourceComponent.allCases.map { ($0, 0) }),
                                      totalBytes: 0, operations: 0, taskSlots: 0) }
        private init(bytes: [ResourceComponent: Int], totalBytes: Int, operations: Int, taskSlots: Int) {
            self.bytes = bytes; self.totalBytes = totalBytes
            self.operations = operations; self.taskSlots = taskSlots
        }
        func adding(_ other: Self) throws -> Self {
            var combined: [ResourceComponent: Int] = [:]
            for component in ResourceComponent.allCases {
                guard let lhs = bytes[component], let rhs = other.bytes[component] else { throw Failure.resourceBudgetRefused }
                combined[component] = try Self.add(lhs, rhs)
            }
            return Self(bytes: combined, totalBytes: try Self.add(totalBytes, other.totalBytes),
                operations: try Self.add(operations, other.operations), taskSlots: try Self.add(taskSlots, other.taskSlots))
        }
        static func add(_ a: Int, _ b: Int) throws -> Int {
            let sum = a.addingReportingOverflow(b)
            guard a >= 0, b >= 0, !sum.overflow else { throw Failure.resourceArithmeticOverflow }
            return sum.partialValue
        }
        static func multiply(_ a: Int, _ b: Int) throws -> Int {
            let product = a.multipliedReportingOverflow(by: b)
            guard a >= 0, b >= 0, !product.overflow else { throw Failure.resourceArithmeticOverflow }
            return product.partialValue
        }
        fileprivate init(byteCount: Int, plugin: ReferenceArtifactPlugin, executing: Bool) throws {
            let shape = plugin.model.shape
            bytes = [
                .selectedBytes: byteCount,
                // Copy/array/digest/UTF-8 staging; execution also prepares its own copy.
                .preparationScratch: try Self.multiply(byteCount, executing ? 8 : 4),
                // Bounded profile framing and, for a run, encoder/canonicalizer copies.
                .metadataScratch: executing ? 65_536 : 16_384,
                // Execution eligibility allowance for the already resolved model,
                // not a reservation made before the fixed catalog was loaded.
                .modelWeights: executing ? shape.cost.weightBytes : 0,
                // Input tensor + decoded input + actual numeric working payload.
                .numericBuffers: executing ? try Self.add(shape.cost.evaluationBufferBytes,
                    Self.multiply(shape.input, 8)) : 0,
                .resultEnvelope: executing ? try Self.add(16_384, Self.multiply(shape.output, 4)) : 0,
                .taskEnvelope: executing ? 65_536 : 0
            ]
            totalBytes = try bytes.values.reduce(0) { try Self.add($0, $1) }
            operations = executing ? shape.cost.scalarOperations : 0
            taskSlots = executing ? 1 : 0
        }
    }
    struct ResourceBudget: Sendable {
        var componentLimits: [ResourceComponent: Int] = [
            // Aggregate capacity for one maximum run plus one staged replacement.
            // Each individual snapshot still has the independent 1 MiB input cap.
            .selectedBytes: 2_097_152, .preparationScratch: 12_582_912,
            .metadataScratch: 81_920, .modelWeights: 65_536,
            .numericBuffers: 65_536, .resultEnvelope: 65_536, .taskEnvelope: 65_536
        ]
        var totalBytes = 16_777_216
        var operations = 1_000_000
        var taskSlots = 1
        fileprivate func admit(_ incoming: ResourceDeclaration, occupied: ResourceDeclaration) throws {
            let declaration = try occupied.adding(incoming)
            for component in ResourceComponent.allCases {
                guard let amount = declaration.bytes[component], amount >= 0,
                      let limit = componentLimits[component], amount <= limit
                else { throw Failure.resourceBudgetRefused }
            }
            guard declaration.operations <= operations, declaration.taskSlots <= taskSlots,
                  declaration.totalBytes <= totalBytes
            else { throw Failure.resourceBudgetRefused }
        }
    }
    private final class Plan: Sendable {
        let plugin: ReferenceArtifactPlugin
        init() throws { plugin = try .resolve(.artifactProfileV1, objects: ReferenceArtifactPlugin.embeddedObjects) }
    }
    private final class Reservation: Sendable {
        let plan: Plan
        let selection: Selection
        let declaration: ResourceDeclaration
        init(plan: Plan, selection: Selection, declaration: ResourceDeclaration) {
            self.plan = plan; self.selection = selection; self.declaration = declaration
        }
    }
    package final class Consent: Sendable {
        fileprivate let lease: HostLease
        fileprivate let deadline: ContinuousClock.Instant
        package let action: Action = .bn01ReferenceEvaluation
        package let dataPurpose: DataPurpose = .selectedSnapshotBytesLocalOnly
        fileprivate init(lease: HostLease, deadline: ContinuousClock.Instant) {
            self.lease = lease; self.deadline = deadline
        }
    }
    package final class RunTicket: Sendable {
        fileprivate let consent: Consent
        fileprivate init(consent: Consent) { self.consent = consent }
    }
    package struct Delivery: Sendable {
        package let action: Action
        package let dataPurpose: DataPurpose
        package let hostEpoch: UInt64
        package let artifactKind: ArtifactKind
        package let subjectSHA256, profileID, profileSHA256: String
        package let runID, preparedSHA256, contextSHA256, outputSHA256, resultSHA256: String
        package let outputBytes: Data
        package let buildAdmissionReceiptSHA256: String
        package var authoritative: Bool { false }
        fileprivate init(consent: Consent, selection: Selection, result: PreparedReferenceMLPEvaluation.Result,
                         context: String, buildReceipt: String) {
            action = consent.action; dataPurpose = consent.dataPurpose
            hostEpoch = selection.epoch; artifactKind = selection.snapshot.kind
            subjectSHA256 = selection.snapshot.subjectDigest
            profileID = selection.profile.id; profileSHA256 = selection.profile.rulesFingerprint
            runID = result.runID; preparedSHA256 = result.preparedSHA256
            contextSHA256 = context; outputSHA256 = result.outputSHA256
            resultSHA256 = result.resultSHA256; outputBytes = result.outputBytes
            buildAdmissionReceiptSHA256 = buildReceipt
        }
    }
    private struct Active {
        let ticket: RunTicket
        let reservation: Reservation
        let task: Task<Delivery, Error>
        var claimed = false
    }
    private let identity = Identity()
    private var generation = Identity()
    private var selected: Selection?
    private var staging: ResourceDeclaration?
    private var pending: Consent?
    private var active: Active?
    private let worker: ReferenceMLPShadowOwner
    private let plan: Plan
    private let resourceBudget: ResourceBudget
    private let buildAdmission: NativeBuildAdmission
    private static let scope = "scope.bn01.native"

#if DEBUG
    enum ProbePoint: CaseIterable, Sendable {
        case beforePreparation, beforeEnable, afterEnable, afterGrant, afterBegin, afterWorkerJoined
        case afterCleanupBeforeDelivery
        static var workerBoundaries: [Self] { allCases.filter { $0 != .afterCleanupBeforeDelivery } }
    }
    private var probe: (@Sendable (ProbePoint) async -> Void)?
    static func forSchedulingTests(_ probe: @escaping @Sendable (ProbePoint) async -> Void) throws -> ReferenceArtifactShadowRunOwner {
        let value = try ReferenceArtifactShadowRunOwner.forIsolatedTests()
        value.probe = probe
        return value
    }
    static func forBudgetTests() throws -> ReferenceArtifactShadowRunOwner {
        try ReferenceArtifactShadowRunOwner(weightBudget: 1, buildAdmission: .forIsolatedOwnerTests())
    }
    static func forResourceTests(_ budget: ResourceBudget,
        probe: (@Sendable (ProbePoint) async -> Void)? = nil) throws -> ReferenceArtifactShadowRunOwner {
        let owner = try ReferenceArtifactShadowRunOwner(weightBudget: 65_536, resourceBudget: budget,
            buildAdmission: .forIsolatedOwnerTests())
        owner.probe = probe
        return owner
    }
    package static func forIsolatedTests() throws -> ReferenceArtifactShadowRunOwner {
        try ReferenceArtifactShadowRunOwner(weightBudget: 65_536, buildAdmission: .forIsolatedOwnerTests())
    }
    package static func forAdmittedBuildTests(_ admission: NativeBuildAdmission) throws -> ReferenceArtifactShadowRunOwner {
        try ReferenceArtifactShadowRunOwner(weightBudget: 65_536, buildAdmission: admission)
    }
    static func forBuildLifecycleTests(_ admission: NativeBuildAdmission,
        probe: @escaping @Sendable (ProbePoint) async -> Void) throws -> ReferenceArtifactShadowRunOwner {
        let owner = try forAdmittedBuildTests(admission); owner.probe = probe; return owner
    }
    func declarationForTesting(byteCount: Int, executing: Bool) throws -> ResourceDeclaration {
        try ResourceDeclaration(byteCount: byteCount, plugin: plan.plugin, executing: executing)
    }
    var reservedBytesForTesting: Int { get throws { try occupiedResources().totalBytes } }
    var reservedResourcesForTesting: ResourceDeclaration { get throws { try occupiedResources() } }
    var activeReservationForTesting: Bool { active != nil }
    var selectedPayloadForTesting: AnyObject? { selected }
    private(set) var ownedCopyCountForTesting = 0
    private(set) var preparationCountForTesting = 0
    private(set) var workerBeginCountForTesting = 0
    var workerStateForTesting: ReferenceMLPShadowOwner.State { get async { await worker.state } }
    var resultClaimedForTesting: Bool { active?.claimed == true }
    private(set) var deliveryAttemptCountForTesting = 0
#endif

    package convenience init() throws {
        let admission: NativeBuildAdmission
        do { admission = try .production() } catch { throw Failure.buildAdmissionRefused }
        try self.init(weightBudget: 65_536, buildAdmission: admission)
    }

    private init(weightBudget: Int, resourceBudget: ResourceBudget = .init(), buildAdmission: NativeBuildAdmission) throws {
        do { try buildAdmission.revalidate() } catch { throw Failure.buildAdmissionRefused }
        self.buildAdmission = buildAdmission
        // Fixed reference numeric envelope; not process RSS, a global compute
        // quota, model loading peak, AFM availability or app/runtime admission.
        worker = try ReferenceMLPShadowOwner(scopeID: Self.scope, budget: .init(
            maxWeightBytes: weightBudget, maxOperations: 1_000_000,
            maxOutputBytes: 64, maxInferenceMs: 1_000))
        plan = try Plan()
        self.resourceBudget = resourceBudget
    }

    private func occupiedResources() throws -> ResourceDeclaration {
        var used = active?.reservation.declaration ?? .empty
        // Selected and active can reference the SAME payload; charge it once.
        if let selected, active?.reservation.selection !== selected {
            used = try used.adding(selected.staged)
        }
        if let staging { used = try used.adding(staging) }
        return used
    }

    package var state: State {
        if let active { return active.ticket.consent.lease.generation === generation ? .running : .stopping }
        guard selected != nil else { return .unbound }
        return pending == nil ? .ready : .consented
    }

    /// Trusted host supplies its actual selection/profile/epoch, not model JSON.
    /// Even identical replacements rotate the opaque lease, preventing ABA reuse.
    /// Invalid replacement revokes old consent before validation can fail.
    package func bindSelection(_ snapshot: ArtifactSnapshot, profile: CheckProfile, hostEpoch: UInt64) throws -> HostLease {
        invalidate()
        try requireBuildAdmission()
        guard profile.resourceLimitsAdmitted else { throw Failure.invalidProfile }
        guard (1...1_048_576).contains(snapshot.bytes.count) else { throw Failure.invalidSnapshot }
        let declaration = try ResourceDeclaration(byteCount: snapshot.bytes.count, plugin: plan.plugin, executing: false)
        try resourceBudget.admit(declaration, occupied: occupiedResources())
        staging = declaration // Reserve BEFORE any owner-controlled snapshot copy.
        defer { staging = nil }
        // Caller must not concurrently mutate external backing during this copy.
#if DEBUG
        ownedCopyCountForTesting += 1
#endif
        let bytes = Data([UInt8](snapshot.bytes))
        guard ArtifactSnapshot.digest(bytes) == snapshot.subjectDigest,
              String(data: bytes, encoding: .utf8) != nil else { throw Failure.invalidSnapshot }
        let owned = ArtifactSnapshot(displayName: "Owned reference input", kind: snapshot.kind, bytes: bytes)
        let lease = HostLease(owner: identity, generation: generation)
        selected = Selection(lease: lease, snapshot: owned, profile: profile, epoch: hostEpoch, staged: declaration)
        return lease
    }

    /// A distinct controller action, never implied by selection or an ALLOW string.
    /// No decoder/initializer can reconstruct this token from diagnostic metadata.
    package func authorizeLocalReferenceOnce(_ lease: HostLease, deadline: ContinuousClock.Instant) throws -> Consent {
        guard lease.owner === identity else { throw Failure.foreignLease }
        guard selected != nil else { throw Failure.noSelection }
        guard selected?.lease === lease, lease.generation === generation else { throw Failure.staleLease }
        guard active == nil else { throw Failure.busy }
        guard pending == nil else { throw Failure.pendingConsent }
        try requireBuildAdmission()
        let now = ContinuousClock().now
        guard deadline > now else { throw Failure.expired }
        guard deadline <= now.advanced(by: .seconds(1)) else { throw Failure.deadlineOutOfRange }
        let consent = Consent(lease: lease, deadline: deadline)
        pending = consent
        return consent
    }

    /// Preparing display metadata never creates consent or starts the worker.
    package func reviewDescriptor(for lease: HostLease) throws -> ReviewDescriptor {
        guard lease.owner === identity else { throw Failure.foreignLease }
        guard let selection = selected else { throw Failure.noSelection }
        guard selection.lease === lease, lease.generation === generation else { throw Failure.staleLease }
        guard active == nil else { throw Failure.busy }
        guard pending == nil else { throw Failure.pendingConsent }
        try requireBuildAdmission()
        let declaration = try ResourceDeclaration(byteCount: selection.snapshot.bytes.count, plugin: plan.plugin, executing: true)
        try resourceBudget.admit(declaration, occupied: .empty)
        return ReviewDescriptor(selection: selection, packageDigest: plan.plugin.packageSHA256, buildReceipt: buildAdmission.receiptSHA256,
                               declaration: declaration, budget: resourceBudget)
    }

    package func begin(_ consent: Consent) throws -> RunTicket {
        guard consent.lease.owner === identity else { throw Failure.foreignConsent }
        guard consent.lease.generation === generation, let selection = selected,
              selection.lease === consent.lease else { throw Failure.revoked }
        guard active == nil else { throw Failure.busy }
        guard pending === consent else { throw Failure.consentUnavailable }
        pending = nil // Consume before expiry, cancellation, preparation, or ANY await.
        try requireBuildAdmission()
        guard consent.deadline > ContinuousClock().now else { throw Failure.expired }
        try Task.checkCancellation()
        let declaration = try ResourceDeclaration(byteCount: selection.snapshot.bytes.count, plugin: plan.plugin, executing: true)
        // Replace the selected charge atomically. No await, task or preparation
        // allocation is allowed between this check and installation in Active.
        try resourceBudget.admit(declaration, occupied: .empty)
        let reservation = Reservation(plan: plan, selection: selection, declaration: declaration)
        let ticket = RunTicket(consent: consent)
        let task = Task { try await self.execute(ticket) }
        active = Active(ticket: ticket, reservation: reservation, task: task)
        return ticket
    }

    private func requireLive(_ ticket: RunTicket) throws {
        guard ticket.consent.lease.generation === generation,
              selected?.lease === ticket.consent.lease else { throw Failure.revoked }
        guard let active, active.ticket === ticket,
              active.reservation.plan === plan,
              active.reservation.selection === selected else { throw Failure.runUnavailable }
        try requireBuildAdmission()
        try Task.checkCancellation()
        guard ticket.consent.deadline > ContinuousClock().now else { throw Failure.expired }
    }

    private func requireBuildAdmission() throws {
        do { try buildAdmission.revalidate() }
        catch { invalidate(); throw Failure.buildAdmissionRefused }
    }

    private func execute(_ ticket: RunTicket) async throws -> Delivery {
        let outcome: Result<Delivery, Error>
        do {
            try requireLive(ticket)
#if DEBUG
            if let probe { await probe(.beforePreparation) }
#endif
            try requireLive(ticket)
            guard let reservation = active?.reservation else { throw Failure.runUnavailable }
            let consent = ticket.consent, selection = reservation.selection
            let producer = try ReferenceArtifactShadowPreparation(scopeID: Self.scope,
                profile: selection.profile, plugin: reservation.plan.plugin)
#if DEBUG
            preparationCountForTesting += 1
#endif
            let candidate = try producer.prepare(snapshot: selection.snapshot)
            let prepared = try producer.preparedEvaluation(for: candidate)
#if DEBUG
            if let probe { await probe(.beforeEnable) }
#endif
            try requireLive(ticket)
            try await worker.enable()
#if DEBUG
            if let probe { await probe(.afterEnable) }
#endif
            try requireLive(ticket)
            let permit = try await worker.grant(prepared, deadline: consent.deadline)
#if DEBUG
            if let probe { await probe(.afterGrant) }
#endif
            try requireLive(ticket)
            let innerTicket = try await worker.begin(permit)
#if DEBUG
            workerBeginCountForTesting += 1
#endif
#if DEBUG
            if let probe { await probe(.afterBegin) }
#endif
            try requireLive(ticket)
            let result = try await worker.result(for: innerTicket)
#if DEBUG
            if let probe { await probe(.afterWorkerJoined) }
#endif
            try requireLive(ticket)
            guard result.runID == candidate.runID, result.preparedSHA256 == candidate.preparedSHA256,
                  result.contextSHA256 == candidate.contextSHA256 else { throw Failure.resultIdentityMismatch }
            outcome = .success(Delivery(consent: consent, selection: selection, result: result,
                context: candidate.contextSHA256, buildReceipt: buildAdmission.receiptSHA256))
        } catch { outcome = .failure(Self.operationalFailure(error)) }
        // A new task cannot be admitted while Active still retains this task.
        // Thus this old cleanup cannot disable a newer worker. Always join, even
        // when cancellation arrived during enable/grant/begin or delivery.
        await worker.off()
        return try outcome.get()
    }

    // Closed package boundary. Never leak a private preparation/worker enum into
    // future AppModel routing. Cancellation remains explicitly distinguishable.
    static func operationalFailure(_ error: any Error) -> any Error {
        if error is CancellationError { return CancellationError() }
        if let failure = error as? Failure { return failure }
        if error is ReferenceArtifactShadowPreparation.Failure || error is PreparedReferenceMLPEvaluation.Failure {
            return Failure.preparationRefused
        }
        if let failure = error as? ReferenceMLPShadowOwner.Failure {
            switch failure {
            case .expired: return Failure.expired
            case .deadlineOutOfRange: return Failure.deadlineOutOfRange
            case .weightBudgetExceeded, .operationBudgetExceeded, .outputBudgetExceeded, .invalidBudget:
                return Failure.numericBudgetRefused
            default: return Failure.workerRefused
            }
        }
        if let failure = error as? ReferenceMLP.Failure {
            switch failure {
            case .deadlineExceeded: return Failure.expired
            case .deadlineOutOfRange: return Failure.deadlineOutOfRange
            default: return Failure.evaluationRefused
            }
        }
        return Failure.internalFailure
    }

    package func result(for ticket: RunTicket) async throws -> Delivery {
        guard ticket.consent.lease.owner === identity else { throw Failure.foreignRun }
#if DEBUG
        deliveryAttemptCountForTesting += 1
#endif
        guard var run = active, run.ticket === ticket else { throw Failure.runUnavailable }
        guard !run.claimed else { throw Failure.resultAlreadyClaimed }
        run.claimed = true; active = run
        let task = run.task
        let outcome = await withTaskCancellationHandler { await task.result } onCancel: { task.cancel() }
#if DEBUG
        if let probe { await probe(.afterCleanupBeforeDelivery) }
#endif
        // The worker and bridge task have both settled before Active is released.
        defer { if active?.ticket === ticket { active = nil } }
        try requireLive(ticket) // Recheck AFTER every suspension, including worker.off.
        return try outcome.get()
    }

    /// MainActor synchronous revocation: safe to call from selection/OFF/shutdown.
    /// Cancellation is a request. State stays stopping until a result/join settles.
    package func invalidate() {
        generation = Identity(); selected = nil; pending = nil
        active?.task.cancel()
    }

    package func revokeAndJoin() async {
        invalidate()
        guard let run = active else { return }
        _ = await run.task.result
        if active?.ticket === run.ticket { active = nil }
        // Do not clear a newer selection installed during this await.
    }
}
