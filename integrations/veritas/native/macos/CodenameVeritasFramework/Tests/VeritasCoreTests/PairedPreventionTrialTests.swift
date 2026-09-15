import Foundation
import Testing
@testable import VeritasCore

@Suite("Paired drafting execution — structural observations, no promotion")
struct PairedPreventionTrialTests {
    private typealias Runner = PairedPreventionTrialV1
    private typealias Refusal = PreventionTrialRefusalV1
    private let profile = CheckProfile(id: "trial-profile", requiredSections: ["Testing"])
    private func item(_ id: String, _ split: PreventionTrialSplitV1 = .evaluation,
                      prompt: String? = nil, profile: CheckProfile? = nil) -> PreventionTrialCaseV1 {
        .init(id: id, prompt: prompt ?? "Write a distinct note about \(id).", split: split, profile: profile ?? self.profile)
    }
    private var cases: [PreventionTrialCaseV1] { [item("a", .development), item("b")] }
    private func setup(control: String = "prompt-guidance") async throws -> (PreventionCandidateRegistryV2, PreventionCandidateV2) {
        let r = PreventionCandidateRegistryV2()
        return (r, try await r.registerCandidate(policyID: "p", controlType: control,
            targetFailureFamily: "coverage", rateUpperBounds: ["recurrence": 0.1]).get())
    }
    private func run(_ owner: Runner = Runner(), registry: PreventionCandidateRegistryV2, candidate: PreventionCandidateV2,
                     cases: [PreventionTrialCaseV1]? = nil, guidance: String = "Include Testing.", label: String = "synthetic-v1",
                     adapter: TrialAdapter = TrialAdapter()) async throws -> PairedPreventionTrialResultV1 {
        try await owner.run(registry: registry, candidate: candidate, guidance: guidance,
                            cases: cases ?? self.cases, adapterLabel: label, adapter: adapter)
    }
    private func refused(_ expected: Refusal, _ operation: () async throws -> PairedPreventionTrialResultV1) async {
        do { _ = try await operation(); Issue.record("expected refusal \(expected)") }
        catch let e as Refusal { #expect(e == expected) }
        catch { Issue.record("wrong refusal type \(type(of: error))") }
    }

    @Test("Every actual pair is graded with the same fixed rule and denominator")
    func outcomeTable() async throws {
        let (r,c) = try await setup()
        let adapter = TrialAdapter(plans: ["improved": [.fail,.pass], "regressed": [.pass,.fail],
            "both-pass": [.pass,.pass], "both-fail": [.fail,.fail], "missing": [.error,.pass]])
        let cohort = [item("improved",.development),item("regressed",.development),item("both-pass"),item("both-fail"),item("missing")]
        let v = try await run(registry:r,candidate:c,cases:cohort,adapter:adapter)
        #expect(v.total.total == 5)
        let counts: [Int] = [v.total.improved,v.total.regressed,v.total.unchangedPass,v.total.unchangedFail,v.total.unavailable]
        #expect(counts == [1,1,1,1,1])
        for group in [v.total, v.development, v.evaluation] {
            #expect(group.improved + group.regressed + group.unchangedPass + group.unchangedFail + group.unavailable == group.total)
        }
        #expect(v.development.total == 2 && v.evaluation.total == 3)
        #expect(v.development.improved == 1 && v.development.regressed == 1)
        #expect(v.pairs.map(\.caseID) == cohort.map(\.id))
        #expect(v.pairs.map(\.firstArm) == [.baseline,.treatment,.baseline,.treatment,.baseline])
        let requests = await adapter.requests
        #expect(requests.count == 10)
        #expect(requests.map(\.arm) == [.baseline,.treatment,.treatment,.baseline,.baseline,.treatment,.treatment,.baseline,.baseline,.treatment])
        for request in requests {
            #expect(request.guidance == (request.arm == .treatment ? "Include Testing." : nil))
            #expect(request.prompt == cohort.first(where: { $0.id == request.caseID })?.prompt)
        }
        #expect(v.pairs[0].baseline.outputDigest == ArtifactSnapshot.digest(Data("# Overview\nMissing required marker.".utf8)))
        #expect(v.scoringRule == "ALL_THREE_MARKDOWN_CHECKS_PASS_V1")
        #expect(v.authorizing == false && c.experiment == .notRun)
        #expect(await r.candidate(policyID: "p") == c)
    }

    @Test("Malformed or overlapping cohorts refuse before drafting")
    func invalidCohorts() async throws {
        let (r,c) = try await setup(), adapter = TrialAdapter()
        let invalid: [[PreventionTrialCaseV1]] = [[],[item("a",.development)],
            (0...16).map { item("x\($0)", $0 == 0 ? .development : .evaluation) },
            [item("a"),item("b")],[item("a",.development),item("b",.development)],
            [item("",.development),item("b")],[item("a",.development,prompt:" "),item("b")],
            [item("a",.development,prompt:String(repeating:"x",count:16_385)),item("b")]]
        for cohort in invalid { await refused(.invalidCohort) { try await run(registry:r,candidate:c,cases:cohort,adapter:adapter) } }
        for cohort in [[item("same",.development),item("same",prompt:"different")],
                       [item("a",.development,prompt:"same"),item("b",prompt:"same")],
                       [item("a",.development,prompt:" café "),item("b",prompt:"cafe\u{0301}")]] {
            await refused(.duplicateCase) { try await run(registry:r,candidate:c,cases:cohort,adapter:adapter) }
        }
        #expect(await adapter.requests.isEmpty)
    }

    @Test("Scoring profiles, guidance, adapter labels and candidate types are admitted first")
    func invalidConfiguration() async throws {
        let (r,c) = try await setup(), adapter = TrialAdapter()
        for p in [CheckProfile(id:"empty"), CheckProfile(id:"model",requiredSections:["Testing"],modelParticipationRequired:true),
                  CheckProfile(id:"bad",requiredSections:[String(repeating:"x",count:257)])] {
            await refused(.invalidProfile) { try await run(registry:r,candidate:c,cases:[item("a",.development,profile:p),item("b")],adapter:adapter) }
        }
        for g in ["", "  ", "x\0y",String(repeating:"x",count:4097)] {
            await refused(.invalidGuidance) { try await run(registry:r,candidate:c,guidance:g,adapter:adapter) }
        }
        for label in ["", "x/y",String(repeating:"a",count:129)] {
            await refused(.invalidAdapterLabel) { try await run(registry:r,candidate:c,label:label,adapter:adapter) }
        }
        let (other, unsupported) = try await setup(control:"arbitrary-action")
        await refused(.unsupportedCandidate) { try await run(registry:other,candidate:unsupported,adapter:adapter) }
        #expect(await adapter.requests.isEmpty)
    }

    @Test("Transport, empty, invalid UTF-8 and oversized responses stay in totals")
    func unavailableArms() async throws {
        let (r,c) = try await setup()
        let adapter = TrialAdapter(plans:["a":[.error,.pass],"b":[.pass,.empty],"c":[.invalidUTF8,.pass],"d":[.pass,.oversized]])
        let v = try await run(registry:r,candidate:c,cases:[item("a",.development),item("b"),item("c"),item("d")],adapter:adapter)
        #expect(v.total.total == 4 && v.total.unavailable == 4 && v.total.improved == 0)
        #expect(await adapter.requests.count == 8)
        #expect(v.pairs.allSatisfy { $0.baseline.outcome == .structuralPass || $0.treatment.outcome == .structuralPass })
        #expect(v.pairs[0].baseline.reasonCode == "ADAPTER_ERROR" && v.pairs[0].baseline.outputDigest == nil)
        #expect(v.pairs[1].treatment.outputByteCount == 0)
        #expect(v.pairs[3].treatment.outputByteCount == nil && v.pairs[3].treatment.outputDigest == nil)
        #expect(v.pairs[3].treatment.reasonCode == "OUTPUT_CAPTURE_LIMIT")
        let overflow = TrialAdapter(plans:["a":[.oversized,.oversizedOther],"b":[.swallowedOverflow,.pass]])
        let rejected = try await run(registry:r,candidate:c,adapter:overflow)
        #expect(rejected.pairs[0].baseline.captureID != rejected.pairs[0].treatment.captureID)
        #expect(rejected.pairs[0].baseline.outputIdentity == "NO_COMPLETE_OUTPUT_HASH")
        #expect(rejected.pairs[0].treatment.outputIdentity == "NO_COMPLETE_OUTPUT_HASH")
        #expect(rejected.total.unavailable == 2 && rejected.total.improved == 0)
        #expect(await overflow.lateWriteRefused())
        #expect(await overflow.lateOverflowWriteRefused())
    }

    @Test("Manifest identity binds prompt, profile, split, order, guidance and adapter label")
    func exactIdentity() async throws {
        let (r,c) = try await setup()
        let first = try await run(registry:r,candidate:c)
        let repeatRun = try await run(registry:r,candidate:c)
        #expect(first.trialDefinitionDigest == repeatRun.trialDefinitionDigest)
        #expect(first.resultDigest != repeatRun.resultDigest && first.runID != repeatRun.runID)
        // Independent field assembly: deleting capture identity from production
        // framing must fail even though every trial also has a distinct run ID.
        func armFields(_ arm: PreventionTrialArmObservationV1) -> [String] {
            [arm.arm.rawValue, arm.captureID, arm.outcome.rawValue, arm.reasonCode, arm.outputIdentity,
             arm.outputDigest ?? "NONE", arm.outputByteCount.map(String.init) ?? "NONE"]
        }
        var expectedFields: [String] = [first.runID, first.trialDefinitionDigest, String(first.pairs.count)]
        for pair in first.pairs {
            expectedFields.append(contentsOf: [pair.caseID, pair.caseDigest, pair.split.rawValue, pair.firstArm.rawValue])
            expectedFields.append(contentsOf: armFields(pair.baseline))
            expectedFields.append(contentsOf: armFields(pair.treatment))
            expectedFields.append(pair.outcome.rawValue)
        }
        #expect(first.resultDigest == VeritasDigestFrameV1.digest(domain:"veritas-paired-drafting-result-v1",fields:expectedFields))
        let variants = [
            try await run(registry:r,candidate:c,guidance:"Different guidance"),
            try await run(registry:r,candidate:c,label:"different"),
            try await run(registry:r,candidate:c,cases:Array(cases.reversed())),
            try await run(registry:r,candidate:c,cases:[item("a",.development,prompt:"Changed prompt"),item("b")]),
            try await run(registry:r,candidate:c,cases:[item("a"),item("b",.development)]),
            try await run(registry:r,candidate:c,cases:[item("a",.development,profile:.init(id:"other",requiredSections:["Risk"])),item("b")])]
        #expect(variants.allSatisfy { $0.trialDefinitionDigest != first.trialDefinitionDigest })
        let changedOutput = try await run(registry:r,candidate:c,adapter:TrialAdapter(plans:["a":[.fail,.fail]]))
        #expect(changedOutput.trialDefinitionDigest == first.trialDefinitionDigest)
        #expect(changedOutput.pairs[0].outcome == .unchangedFail)
    }

    @Test("A stale or restricted candidate never starts drafting")
    func restrictedBeforeRun() async throws {
        for restriction: PreventionCandidateRestrictionV2 in [.quarantine,.expire,.revoke] {
            let (r,c) = try await setup(), adapter = TrialAdapter()
            _ = try await r.restrict(policyID:"p",to:restriction).get()
            await refused(.candidateUnavailable) { try await run(registry:r,candidate:c,adapter:adapter) }
            #expect(await adapter.requests.isEmpty)
        }
        let (_,c) = try await setup(), adapter = TrialAdapter()
        await refused(.candidateUnavailable) { try await run(registry:PreventionCandidateRegistryV2(),candidate:c,adapter:adapter) }
        #expect(await adapter.requests.isEmpty)
    }

    @Test("Restriction during either arm suppresses delivery and later calls")
    func restrictionDuringAwait() async throws {
        for target in [0,1] {
            for restriction: PreventionCandidateRestrictionV2 in [.quarantine,.expire,.revoke] {
                let (r,c) = try await setup(), adapter = TrialAdapter(holdIndex:target), owner = Runner()
                let task = Task { try await run(owner,registry:r,candidate:c,adapter:adapter) }
                await adapter.waitUntilHeld()
                _ = try await r.restrict(policyID:"p",to:restriction).get()
                await adapter.release()
                await refused(.candidateUnavailable) { try await task.value }
                #expect(await adapter.requests.count == target + 1)
                // Subsequent refusal is candidate state, not a leaked running slot.
                await refused(.candidateUnavailable) { try await run(owner,registry:r,candidate:c) }
            }
        }
    }

    @Test("Overlap is refused until canceled adapter work actually returns")
    func cancellationAndOwnership() async throws {
        for target in [0,1] {
            let (r,c) = try await setup(), owner = Runner(), adapter = TrialAdapter(holdIndex:target)
            let task = Task { try await run(owner,registry:r,candidate:c,adapter:adapter) }
            await adapter.waitUntilHeld()
            task.cancel()
            let other = TrialAdapter()
            await refused(.alreadyRunning) { try await run(owner,registry:r,candidate:c,adapter:other) }
            #expect(await other.requests.isEmpty)
            await adapter.release() // Simulates cooperative backend finishing cleanup.
            do { _ = try await task.value; Issue.record("cancellation was swallowed") }
            catch { #expect(error is CancellationError) }
            #expect(await adapter.requests.count == target + 1)
            let next = try await run(owner,registry:r,candidate:c)
            #expect(next.total.total == 2)
        }
    }

    @Test("Pre-cancellation and adapter cancellation never become unavailable results")
    func cancellationTruth() async throws {
        let (r,c) = try await setup(), owner = Runner(), adapter = TrialAdapter()
        let cancelled = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await run(owner,registry:r,candidate:c,adapter:adapter)
        }
        do { _ = try await cancelled.value; Issue.record("pre-cancel returned") }
        catch { #expect(error is CancellationError) }
        #expect(await adapter.requests.isEmpty)
        let stops = TrialAdapter(plans:["a":[.cancel,.pass]])
        do { _ = try await run(owner,registry:r,candidate:c,adapter:stops); Issue.record("adapter cancellation returned") }
        catch { #expect(error is CancellationError) }
        #expect(await stops.requests.count == 1)
        #expect(try await run(owner,registry:r,candidate:c).total.total == 2)
    }

    @Test("Diagnostics contain no raw drafts, causal conclusion or promotion")
    func diagnosticBoundaryAndLimits() async throws {
        let (r,c) = try await setup()
        let cohort = (0..<16).map { item("task\($0)", $0 < 8 ? .development : .evaluation) }
        let adapter = TrialAdapter(), v = try await run(registry:r,candidate:c,cases:cohort,adapter:adapter)
        #expect(v.total.total == 16 && v.development.total == 8 && v.evaluation.total == 8)
        #expect(await adapter.requests.count == 32)
        let bytes = try JSONEncoder().encode(v), text = try #require(String(data:bytes,encoding:.utf8))
        let json = try #require(JSONSerialization.jsonObject(with:bytes) as? [String:Any])
        #expect(json["authorizing"] as? Bool == false)
        #expect(json["status"] as? String == "PAIRED_DRAFT_CALLS_OBSERVED")
        #expect(!text.contains("synthetic-private-body") && !text.contains("Write a distinct note"))
        for key in ["effective","avoidedFailure","promoted","certified","confidence","causalEffect"] { #expect(json[key] == nil) }
        #expect(v.limitationCodes.contains("STRUCTURAL_MARKERS_NOT_CONTENT_QUALITY"))
        #expect(v.limitationCodes.contains("CALLER_DECLARED_SPLITS_NOT_UNTOUCHED_HOLDOUTS"))
        #expect(v.limitationCodes.contains("ADAPTER_LABEL_AND_SESSION_ISOLATION_UNVERIFIED"))
    }
}

private actor TrialAdapter: PreventionDraftAdapterV1 {
    enum Reply: Sendable { case pass, fail, error, empty, invalidUTF8, oversized, oversizedOther, swallowedOverflow, cancel }
    enum FixtureError: Error { case unavailable }
    let plans: [String:[Reply]]
    let holdIndex: Int?
    var requests: [PreventionDraftRequestV1] = []
    private var held = false
    private var releaseWaiter: CheckedContinuation<Void,Never>?
    private var enteredWaiters: [CheckedContinuation<Void,Never>] = []
    private var lastSink: PreventionDraftSinkV1?
    private var overflowSink: PreventionDraftSinkV1?
    init(plans: [String:[Reply]] = [:], holdIndex: Int? = nil) { self.plans = plans; self.holdIndex = holdIndex }
    func waitUntilHeld() async {
        if held { return }
        await withCheckedContinuation { enteredWaiters.append($0) }
    }
    func release() { let waiter = releaseWaiter; releaseWaiter = nil; waiter?.resume() }
    func lateWriteRefused() async -> Bool {
        guard let lastSink else { return false }
        do { try await lastSink.append(Data("late".utf8)); return false }
        catch PreventionDraftSinkV1.Refusal.closed { return true } catch { return false }
    }
    func lateOverflowWriteRefused() async -> Bool {
        guard let overflowSink else { return false }
        do { try await overflowSink.append(Data("late".utf8)); return false }
        catch PreventionDraftSinkV1.Refusal.closed { return true } catch { return false }
    }
    func draft(_ request: PreventionDraftRequestV1, sink: PreventionDraftSinkV1) async throws {
        lastSink = sink
        let index = requests.count; requests.append(request)
        if index == holdIndex {
            await withCheckedContinuation { continuation in
                releaseWaiter = continuation; held = true
                let waiters = enteredWaiters; enteredWaiters.removeAll()
                for waiter in waiters { waiter.resume() }
            }
        }
        let reply = plans[request.caseID]?[request.arm == .baseline ? 0 : 1] ?? .pass
        switch reply {
        case .oversized, .oversizedOther, .swallowedOverflow: overflowSink = sink
        default: break
        }
        let bytes: Data
        switch reply {
        case .pass: bytes = Data("# Testing\nsynthetic-private-body".utf8)
        case .fail: bytes = Data("# Overview\nMissing required marker.".utf8)
        case .error: throw FixtureError.unavailable
        case .empty: bytes = Data()
        case .invalidUTF8: bytes = Data([0xff])
        case .oversized: bytes = Data(repeating:65,count:65_537)
        case .oversizedOther: bytes = Data(repeating:66,count:65_537)
        case .swallowedOverflow:
            try? await sink.append(Data(repeating:65,count:65_536))
            try? await sink.append(Data([66]))
            try? await sink.append(Data("# Testing".utf8))
            return
        case .cancel: throw CancellationError()
        }
        try await sink.append(bytes)
    }
}
