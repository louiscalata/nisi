import Foundation
import Testing
@testable import VeritasCore

// Filename retained for inventory continuity; this is NOT official FI0.6.
// The 11 old V1 tests and five failing adverse controls are retained privately.
@Suite("Experimental prevention candidate registry — no evaluation or promotion")
struct PreventionCandidateRegistryTests {
    private typealias Registry = PreventionCandidateRegistryV2
    private typealias Refusal = PreventionCandidateRefusalV2
    private func register(_ owner: Registry, id: String = "p", control: String = "coverage",
                          family: String = "family", rates: [String: Double] = ["recurrence": 0.25]) async
        -> Result<PreventionCandidateV2, Refusal> {
        await owner.registerCandidate(policyID: id, controlType: control,
            targetFailureFamily: family, rateUpperBounds: rates)
    }

    @Test("Registration is not an experiment and absent guardrails never pass")
    func truthfulStates() async throws {
        let owner = Registry()
        let configured = try await register(owner).get()
        let absent = try await register(owner, id: "empty", rates: [:]).get()
        for record in [configured, absent] {
            #expect(record.status == .candidate)
            #expect(record.experiment == .notRun)
            #expect(record.authorizing == false)
            #expect(record.limitationCodes.contains("NO_PROMOTION_AUTHORITY"))
            #expect(record.limitationCodes.contains("NO_COUNTERFACTUAL_EXPERIMENT_RUN"))
            #expect(record.limitationCodes.contains("NO_INDEPENDENT_CERTIFICATION"))
            #expect(record.limitationCodes.contains("CONTROL_FAMILY_AND_METRIC_REFERENCES_UNVERIFIED"))
        }
        #expect(configured.guardrails == .notEvaluated)
        #expect(absent.guardrails == .notConfigured)
        #expect(!configured.limitationCodes.contains("NO_GUARDRAILS_CONFIGURED"))
        #expect(absent.limitationCodes.contains("NO_GUARDRAILS_CONFIGURED"))
        #expect(await owner.count == 2)
    }

    @Test("NFC spelling, insertion order and signed zero cannot change identity")
    func normalization() async throws {
        let owner = Registry()
        let first = try await register(owner, rates: ["caf\u{00e9}": -0.0, "z": 1]).get()
        let replay = try await register(owner, rates: ["z": 1, "cafe\u{0301}": 0.0]).get()
        let other = try await register(Registry(), rates: ["z": 1, "cafe\u{0301}": 0.0]).get()
        #expect(first == replay)
        #expect(first == other)
        #expect(first.rateUpperBounds[0].name == "caf\u{00e9}")
        #expect(first.rateUpperBounds[0].maximumRate.bitPattern == 0)
        #expect(await owner.count == 1)
        let sorted = try await register(Registry(), rates: ["\u{00e9}a": 0.1, "e\u{0301}b": 0.2, "z": 0.3]).get()
        #expect(sorted.rateUpperBounds.map(\.name) == ["z", "\u{00e9}a", "\u{00e9}b"])
    }

    @Test("Definition and record hashes match independent binary64 framing vector")
    func digestVectors() async throws {
        // Independent Node crypto oracle retained in the work packet.
        let candidate = try await register(Registry()).get()
        #expect(candidate.definitionDigest == "1a9c7ef583191d064295029ec462bb213b3fd89d21e5d591be539e3bfbd3dea1")
        #expect(candidate.recordDigest == "eec184cc6989d6359c7872dd8783d9b238878d56bdeb974f26d4701f63772f43")
        let a = try await register(Registry(), control: "ab", family: "c").get()
        let b = try await register(Registry(), control: "a", family: "bc").get()
        #expect(a.definitionDigest != b.definitionDigest)
        let changed = try await register(Registry(), rates: ["recurrence": 0.25.nextUp]).get()
        #expect(candidate.definitionDigest != changed.definitionDigest)
    }

    @Test("Identifier refusals are typed and never occupy a registry slot")
    func invalidIdentifiers() async throws {
        let invalid = ["", " ", "\n", "a\0b", "caf\u{00e9}", String(repeating: "a", count: 129)]
        for value in invalid {
            let owner = Registry()
            #expect(await register(owner, id: value) == .failure(.invalidID))
            #expect(await register(owner, control: value) == .failure(.invalidControl))
            #expect(await register(owner, family: value) == .failure(.invalidFamily))
            #expect(await owner.count == 0)
            #expect(await owner.candidate(policyID: "p") == nil)
            #expect(await owner.restrict(policyID: value, to: .revoke) == .failure(.invalidID))
            _ = try await register(owner).get()
            #expect(await owner.count == 1)
        }
    }

    @Test("Rate limits reject non-finite, out-of-range and unbounded metadata")
    func invalidRates() async throws {
        let invalidValues: [Double] = [-Double.leastNonzeroMagnitude, 1.0.nextUp, .infinity, -.infinity,
                                      .nan, Double(bitPattern: 0x7ff0000000000001), -1, 2]
        for value in invalidValues {
            let owner = Registry()
            #expect(await register(owner, rates: ["recurrence": value]) == .failure(.invalidRateValue))
            #expect(await owner.count == 0)
            _ = try await register(owner).get()
        }
        for key in ["", "   ", "\n", "a\0b", String(repeating: "a", count: 129)] {
            let owner = Registry()
            #expect(await register(owner, rates: [key: 0.5]) == .failure(.invalidRateName))
            #expect(await owner.count == 0)
        }
        let owner = Registry()
        let tooMany = Dictionary(uniqueKeysWithValues: (0...16).map { ("r\($0)", 0.5) })
        #expect(await register(owner, rates: tooMany) == .failure(.tooManyRates))
        #expect(await owner.count == 0)
        _ = try await register(owner, rates: ["zero": 0, "one": 1]).get()
    }

    @Test("Every normalized content conflict refuses and preserves original definition")
    func conflicts() async throws {
        let owner = Registry()
        let first = try await register(owner).get()
        #expect(try await register(owner).get() == first)
        #expect(await register(owner, control: "other") == .failure(.idConflict))
        #expect(await register(owner, family: "other") == .failure(.idConflict))
        for rates: [String: Double] in [[:], ["recurrence": 0.5], ["renamed": 0.25], ["recurrence": 0.25, "extra": 0.1]] {
            #expect(await register(owner, rates: rates) == .failure(.idConflict))
            #expect(await owner.candidate(policyID: "p") == first)
        }
        #expect(await owner.count == 1)
    }

    @Test("Restrictions are monotonic, bounded and cannot resurrect a candidate")
    func terminalLifecycle() async throws {
        let owner = Registry()
        let initial = try await register(owner).get()
        #expect(await owner.restrict(policyID: "missing", to: .revoke) == .failure(.notFound))
        let quarantined = try await owner.restrict(policyID: "p", to: .quarantine).get()
        #expect(quarantined.status == .quarantined)
        #expect(try await owner.restrict(policyID: "p", to: .quarantine).get() == quarantined)
        let expired = try await owner.restrict(policyID: "p", to: .expire).get()
        #expect(expired.status == .expired)
        #expect(await owner.restrict(policyID: "p", to: .quarantine) == .failure(.terminalRestriction))
        let revoked = try await owner.restrict(policyID: "p", to: .revoke).get()
        #expect(revoked.status == .revoked)
        #expect(revoked.restrictionHistory == [.quarantine, .expire, .revoke])
        #expect(try await owner.restrict(policyID: "p", to: .revoke).get() == revoked)
        #expect(await owner.restrict(policyID: "p", to: .expire) == .failure(.terminalRestriction))
        #expect(await owner.restrict(policyID: "p", to: .quarantine) == .failure(.terminalRestriction))
        #expect(try await register(owner).get() == revoked)
        #expect(await register(owner, family: "other") == .failure(.idConflict))
        #expect(initial.status == .candidate) // Earlier value snapshots do not mutate.
        #expect(initial.definitionDigest == revoked.definitionDigest)
        #expect(initial.recordDigest != revoked.recordDigest)
        #expect(await owner.count == 1)
        let direct = Registry()
        _ = try await register(direct).get()
        #expect(try await direct.restrict(policyID: "p", to: .revoke).get().restrictionHistory == [.revoke])
    }

    @Test("Full capacity keeps exact replays and conflicts truthful, even after revocation")
    func capacity() async throws {
        let owner = try Registry(capacity: 2)
        _ = try await register(owner).get()
        _ = try await register(owner, id: "second").get()
        #expect(await register(owner, id: "third") == .failure(.capacityExceeded))
        #expect(await register(owner, control: "other") == .failure(.idConflict))
        let revoked = try await owner.restrict(policyID: "p", to: .revoke).get()
        #expect(try await register(owner).get() == revoked)
        #expect(await register(owner, id: "third") == .failure(.capacityExceeded))
        #expect(await owner.count == 2)
        #expect(await owner.candidate(policyID: "third") == nil)
    }

    @Test("Concurrent registrations cannot overfill capacity or replace an identity")
    func concurrentAdmission() async throws {
        let owner = try Registry(capacity: 8)
        let results = await withTaskGroup(of: Result<PreventionCandidateV2, Refusal>.self) { group in
            for i in 0..<64 {
                group.addTask {
                    await owner.registerCandidate(policyID: "p-\(i)", controlType: "coverage",
                        targetFailureFamily: "family", rateUpperBounds: [:])
                }
            }
            var values: [Result<PreventionCandidateV2, Refusal>] = []
            for await result in group { values.append(result) }
            return values
        }
        #expect(results.filter { if case .success = $0 { true } else { false } }.count == 8)
        #expect(results.filter { $0 == .failure(.capacityExceeded) }.count == 56)
        #expect(await owner.count == 8)
        let single = Registry()
        let raced = await withTaskGroup(of: Result<PreventionCandidateV2, Refusal>.self) { group in
            for type in ["one", "two"] {
                group.addTask {
                    await single.registerCandidate(policyID: "same", controlType: type,
                        targetFailureFamily: "family", rateUpperBounds: [:])
                }
            }
            var values: [Result<PreventionCandidateV2, Refusal>] = []
            for await result in group { values.append(result) }
            return values
        }
        #expect(raced.filter { if case .success = $0 { true } else { false } }.count == 1)
        #expect(raced.filter { $0 == .failure(.idConflict) }.count == 1)
        #expect(await single.count == 1)
    }

    @Test("Diagnostic schema exposes restrictions and limitations without truth booleans")
    func diagnosticEncoding() async throws {
        let owner = Registry()
        _ = try await register(owner).get()
        let record = try await owner.restrict(policyID: "p", to: .revoke).get()
        let encoded = try JSONEncoder().encode(record)
        let object = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        #expect(Set(object.keys) == Set(["schemaVersion", "policyID", "controlType", "targetFailureFamily",
            "rateUpperBounds", "restrictionHistory", "definitionDigest", "recordDigest", "status",
            "experiment", "guardrails", "authorizing", "limitationCodes"]))
        #expect(object["schemaVersion"] as? Int == 2)
        #expect(object["authorizing"] as? Bool == false)
        #expect(object["experiment"] as? String == "NOT_RUN")
        #expect(object["guardrails"] as? String == "NOT_EVALUATED")
        #expect(object["status"] as? String == "REVOKED")
        #expect(object["restrictionHistory"] as? [String] == ["REVOKED"])
        let rates = try #require(object["rateUpperBounds"] as? [[String: String]])
        #expect(rates == [["name": "recurrence", "maximumRateBits": "3fd0000000000000"]])
    }

    @Test("Exact metadata and registry boundaries remain usable")
    func maximumBoundaries() async throws {
        for bad in [0, -1, 257, Int.max] {
            #expect(throws: Refusal.invalidCapacity) { _ = try Registry(capacity: bad) }
        }
        let maxID = String(repeating: "a", count: 128)
        let rates = Dictionary(uniqueKeysWithValues: (0..<16).map {
            (String(repeating: "r", count: 125) + String(format: "%03d", $0), 0.5)
        })
        let owner = Registry()
        let record = try await register(owner, id: maxID, control: maxID, family: maxID, rates: rates).get()
        #expect(record.rateUpperBounds.count == 16)
        #expect(await owner.candidate(policyID: maxID) == record)
        for i in 1..<256 { _ = try await register(owner, id: "p-\(i)").get() }
        #expect(await owner.count == 256)
        #expect(await register(owner, id: "overflow") == .failure(.capacityExceeded))
    }
}
