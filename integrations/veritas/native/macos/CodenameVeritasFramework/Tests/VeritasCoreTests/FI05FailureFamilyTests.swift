import Foundation
import Testing
@testable import VeritasCore

// Filename retained; this suite is NOT official FI0.5/protected adjudication.
@Suite("Failure pattern observation from one ledger snapshot — non-authorizing")
struct FailurePatternObservationTests {
    private typealias Refusal = FailurePatternRefusalV2
    private func digest(_ text: String) -> String { ArtifactSnapshot.digest(Data(text.utf8)) }
    private var scope: IncidentLedgerScopeV1 {
        IncidentLedgerScopeV1(scopeID: "scope/veritas-private", projectDigest: digest("project"),
            accessPolicyDigest: digest("access"), retentionPolicyDigest: LocalIncidentLedgerV1.retentionPolicyDigest)
    }
    private func verification(profile: String = LocalIncidentLedgerV1.profile, events: Int64 = 100,
                              observations: Int64 = 100, tombstones: Int64 = 0, head: String? = nil,
                              authorizing: Bool = false, protected: Bool = false, raw: Bool = false) -> IncidentLedgerVerificationV1 {
        IncidentLedgerVerificationV1(profile: profile, eventCount: events, observationCount: observations,
            tombstoneCount: tombstones, headDigest: head ?? digest("head"), authorizing: authorizing,
            protectedAuthorityVerified: protected, rawContentStored: raw)
    }
    private func view(_ index: Int, customScope: IncidentLedgerScopeV1? = nil, summaryProject: String? = nil,
                      id: String? = nil, key: String? = nil, event: String? = nil, ordinal: Int64? = nil,
                      eventID: String? = nil, subjectID: String? = nil, content: String? = nil,
                      failures: [IncidentFailureCodeV1] = [.requirementMissing, .testFailed],
                      symptoms: [IncidentSymptomCodeV1] = [.failingTest, .missingSection],
                      observed: Date = Date(timeIntervalSince1970: 1_800_000_000),
                      retention: Date? = nil, active: Bool = true, authorizing: Bool = false,
                      protected: Bool = false, raw: Bool = false) -> IncidentViewV1 {
        let scope = customScope ?? self.scope, n = ordinal ?? Int64(index), incidentDigest = digest("incident-data-\(index)")
        let summary = IncidentSummaryV1(projectDigest: summaryProject ?? scope.projectDigest, ordinal: n,
            eventID: eventID ?? "event/\(String(format: "%012lld", n))-\(incidentDigest.prefix(16))",
            incidentID: id ?? "incident/" + digest("incident-\(index)"), incidentDigest: incidentDigest,
            observationKey: key ?? digest("observation-\(index)"), subjectIDDigest: subjectID ?? digest("subject-id-\(index)"),
            subjectContentDigest: content ?? digest("content-\(index)"), evidenceSetDigest: digest("evidence-\(index)"),
            failureCodes: failures, symptomCodes: symptoms, observedAt: observed, retentionReviewAt: retention,
            eventDigest: event ?? digest("event-\(index)"), authorizing: authorizing,
            protectedAuthorityVerified: protected, rawContentStored: raw)
        return IncidentViewV1(scope: scope, summary: summary, lifecycleState: active ? .active : .tombstoned,
            tombstone: nil, limitationCodes: [])
    }
    private func observe(_ views: [IncidentViewV1], verification: IncidentLedgerVerificationV1? = nil) throws -> FailurePatternObservationV2 {
        try FailurePatternReducerV2.observe(scope: scope, verification: verification ?? self.verification(), views: views)
    }
    private func input(_ index: Int) -> IncidentObservationInputV1 {
        IncidentObservationInputV1(incidentID: "incident/" + digest("real-\(index)"),
            observationKey: digest("real-observation-\(index)"), subjectIDDigest: digest("real-subject-id"),
            subjectContentDigest: digest("real-content-\(index)"), evidenceSetDigest: digest("real-evidence-\(index)"),
            failureCodes: [.requirementMissing, .testFailed], symptomCodes: [.failingTest, .missingSection],
            // Historical fixture dates must precede the live tombstone clock.
            observedAt: Date(timeIntervalSince1970: 1_700_000_000 + Double(index)), retentionReviewAt: nil)
    }
    private func withLedger(_ body: (LocalIncidentLedgerV1, URL) async throws -> Void) async throws {
        let base = ProcessInfo.processInfo.environment["VERITAS_NAMESPACE_TEST_ROOT"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.temporaryDirectory
        let root = base.appendingPathComponent("veritas-pattern-observation-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
            attributes: [.posixPermissions: NSNumber(value: 0o700)])
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        do {
            for i in 1...3 { _ = try await ledger.record(input(i)) }
            try await body(ledger, root)
            try await ledger.close()
        } catch {
            try await ledger.close()
            throw error
        }
        // Retained under the owned test root; never delete adverse evidence.
    }

    @Test("Real ledger capture binds one head, actual membership and historical lifecycle")
    func realLedgerCapture() async throws {
        try await withLedger { ledger, root in
            let all = try await ledger.list()
            let selected = Array(all.prefix(2)).map(\.selection)
            let before = try await ledger.verifyIntegrity()
            let observation = try await ledger.observeFailurePattern(selections: selected)
            #expect(observation.ledgerHeadDigest == before.headDigest)
            #expect(observation.ledgerEventCount == before.eventCount)
            #expect(observation.memberCount == 2)
            #expect(Set(observation.members.map(\.incidentID)) == Set(selected.map(\.incidentID)))
            #expect(observation.sharedFailureCodes == ["REQUIREMENT_MISSING", "TEST_FAILED"])
            #expect(observation.sharedSymptomCodes == ["FAILING_TEST", "MISSING_SECTION"])
            #expect(observation.authorizing == false)
            #expect(observation.adjudication == "NOT_PERFORMED")
            #expect(observation.rootCause == "NOT_ESTABLISHED")
            #expect(try await ledger.verifyIntegrity() == before)
            let data = try JSONEncoder().encode(observation)
            try data.write(to: root.appendingPathComponent("observation.json"), options: .withoutOverwriting)
            _ = try await ledger.record(input(4))
            let later = try await ledger.observeFailurePattern(selections: selected.reversed())
            #expect(later.patternDigest == observation.patternDigest)
            #expect(later.membershipDigest == observation.membershipDigest)
            #expect(later.observationDigest != observation.observationDigest)
            #expect(later.ledgerEventCount == 4)
            _ = try await ledger.tombstone(selection: selected[0], reason: .userRequested,
                expectedRetentionPolicyDigest: scope.retentionPolicyDigest)
            do { _ = try await ledger.observeFailurePattern(selections: selected); Issue.record("tombstoned selection was observed") }
            catch { #expect(error as? Refusal == .inactiveMember) }
            #expect(observation.status == "PATTERN_OBSERVED") // Old value is historical, never current authority.
            #expect(observation.limitationCodes.contains("SNAPSHOT_MAY_BECOME_STALE"))
        }
    }

    @Test("Public capture refuses malformed, duplicate, stale and absent selections without writes")
    func publicSelectionRefusals() async throws {
        try await withLedger { ledger, _ in
            let summaries = try await ledger.list(), first = summaries[0].selection, second = summaries[1].selection
            let before = try await ledger.verifyIntegrity()
            let bad = IncidentSelectionV1(projectDigest: first.projectDigest, incidentID: "",
                incidentDigest: first.incidentDigest, subjectIDDigest: first.subjectIDDigest,
                subjectContentDigest: first.subjectContentDigest, observationEventDigest: first.observationEventDigest)
            for (selections, reason) in [([], Refusal.invalidMemberCount), ([first], .invalidMemberCount),
                                          (Array(repeating: first, count: 65), .invalidMemberCount),
                                          ([first, first], .duplicateMember), ([bad, second], .invalidSelection)] {
                do { _ = try await ledger.observeFailurePattern(selections: selections); Issue.record("invalid selection admitted") }
                catch { #expect(error as? Refusal == reason) }
            }
            for item in [
                IncidentSelectionV1(projectDigest: digest("other-project"), incidentID: first.incidentID,
                    incidentDigest: first.incidentDigest, subjectIDDigest: first.subjectIDDigest,
                    subjectContentDigest: first.subjectContentDigest, observationEventDigest: first.observationEventDigest),
                IncidentSelectionV1(projectDigest: first.projectDigest, incidentID: first.incidentID,
                    incidentDigest: digest("wrong-record"), subjectIDDigest: first.subjectIDDigest,
                    subjectContentDigest: first.subjectContentDigest, observationEventDigest: first.observationEventDigest)
            ] {
                do { _ = try await ledger.observeFailurePattern(selections: [item, second]); Issue.record("stale/scope substitution admitted") }
                catch { #expect(error as? IncidentLedgerErrorV1 == .selectionMismatch) }
            }
            let cancelled = Task {
                withUnsafeCurrentTask { $0?.cancel() }
                return try await ledger.observeFailurePattern(selections: [first, second])
            }
            do { _ = try await cancelled.value; Issue.record("cancelled observation returned a record") }
            catch { #expect(error is CancellationError) }
            let missing = view(99).summary.selection
            do { _ = try await ledger.observeFailurePattern(selections: [missing, second]); Issue.record("missing member admitted") }
            catch { #expect(error as? IncidentLedgerErrorV1 == .incidentNotFound) }
            #expect(try await ledger.verifyIntegrity() == before)
        }
    }

    @Test("Code intersections and separate membership identities cannot manufacture a common cause")
    func intersectionsAndIdentity() throws {
        let a = view(1), b = view(2)
        let first = try observe([a,b])
        #expect(first == (try observe([b,a])))
        let reordered = view(2, failures: [.testFailed, .requirementMissing], symptoms: [.missingSection, .failingTest])
        #expect(first == (try observe([reordered,a])))
        let different = try observe([view(3),view(4)])
        #expect(first.patternDigest == different.patternDigest)
        #expect(first.membershipDigest != different.membershipDigest)
        #expect(first.observationDigest != different.observationDigest)
        let mixed = view(2, failures: [.factEvidenceMissing, .testFailed], symptoms: [.missingCitation, .missingSection])
        let subset = try observe([a,mixed])
        #expect(subset.sharedFailureCodes == ["TEST_FAILED"])
        #expect(subset.sharedSymptomCodes == ["MISSING_SECTION"])
        let symptom = try observe([a,view(2, failures: [.schemaInvalid])])
        #expect(symptom.kind == .symptomOnly); #expect(symptom.sharedFailureCodes.isEmpty)
        let failure = try observe([a,view(2, symptoms: [.missingCitation])])
        #expect(failure.kind == .failureOnly); #expect(failure.sharedSymptomCodes.isEmpty)
        #expect(throws: Refusal.noSharedPattern) { try observe([a,view(2, failures: [.schemaInvalid], symptoms: [.invalidStructure])]) }
        #expect(throws: Refusal.invalidCodes) { try observe([a,view(2, failures: [])]) }
        #expect(throws: Refusal.invalidCodes) { try observe([a,view(2, symptoms: [.failingTest,.failingTest])]) }
        #expect(throws: Refusal.invalidCodes) { try observe([a,view(2, failures: Array(repeating: .testFailed, count: 33))]) }
    }

    @Test("Scope and capture claims are complete, bounded and non-authorizing")
    func scopeAndSnapshot() throws {
        for altered in [
            IncidentLedgerScopeV1(scopeID: "other", projectDigest: scope.projectDigest, accessPolicyDigest: scope.accessPolicyDigest, retentionPolicyDigest: scope.retentionPolicyDigest),
            IncidentLedgerScopeV1(scopeID: scope.scopeID, projectDigest: digest("other"), accessPolicyDigest: scope.accessPolicyDigest, retentionPolicyDigest: scope.retentionPolicyDigest),
            IncidentLedgerScopeV1(scopeID: scope.scopeID, projectDigest: scope.projectDigest, accessPolicyDigest: digest("other"), retentionPolicyDigest: scope.retentionPolicyDigest),
            IncidentLedgerScopeV1(scopeID: scope.scopeID, projectDigest: scope.projectDigest, accessPolicyDigest: scope.accessPolicyDigest, retentionPolicyDigest: digest("other"))
        ] {
            #expect(throws: Refusal.invalidScope) { try observe([view(1),view(2, customScope: altered)]) }
        }
        #expect(throws: Refusal.invalidScope) { try observe([view(1),view(2, summaryProject: digest("other"))]) }
        for bad in [verification(profile: "wrong"), verification(events: 4097), verification(events: 1, observations: 1),
                    verification(observations: 1), verification(tombstones: -1), verification(tombstones: 2),
                    verification(head: "BAD"), verification(authorizing: true), verification(protected: true), verification(raw: true)] {
            #expect(throws: Refusal.invalidSnapshot) { try observe([view(1),view(2)], verification: bad) }
        }
        let a = try observe([view(1),view(2)])
        let b = try observe([view(1),view(2)], verification: verification(head: digest("other-head")))
        #expect(a.membershipDigest == b.membershipDigest)
        #expect(a.observationDigest != b.observationDigest)
    }

    @Test("Membership bounds and unique identities do not count aliases as repeated failures")
    func memberBoundsAndDuplicates() throws {
        #expect(throws: Refusal.invalidMemberCount) { try observe([]) }
        #expect(throws: Refusal.invalidMemberCount) { try observe([view(1)]) }
        #expect(throws: Refusal.invalidMemberCount) { try observe((1...65).map { view($0) }) }
        #expect(try observe((1...64).map { view($0) }).memberCount == 64)
        let first = view(1)
        for duplicate in [first, view(2, id: first.summary.incidentID), view(2, key: first.summary.observationKey),
                          view(2, event: first.summary.eventDigest), view(2, ordinal: 1)] {
            #expect(throws: Refusal.duplicateMember) { try observe([first,duplicate]) }
        }
        let sameContent = try observe([view(1),view(2, content: first.summary.subjectContentDigest)])
        #expect(sameContent.memberCount == 2)
        #expect(sameContent.distinctSubjectContentCount == 1)
        #expect(sameContent.limitationCodes.contains("MEMBER_COUNT_NOT_INDEPENDENT_OCCURRENCES"))
    }

    @Test("Inactive or malformed members refuse the entire cohort instead of being filtered")
    func malformedMembers() throws {
        #expect(throws: Refusal.inactiveMember) { try observe([view(1),view(2, active: false),view(3)]) }
        for bad in [view(2, id: ""), view(2, id: "incident/" + String(repeating: "A", count: 64)),
                    view(2, key: "not-a-digest"), view(2, event: String(repeating: "a", count: 65)),
                    view(2, ordinal: 0), view(2, ordinal: 101), view(2, eventID: "event/fake"),
                    view(2, subjectID: digest("content-2")), view(2, authorizing: true),
                    view(2, protected: true), view(2, raw: true)] {
            #expect(throws: Refusal.invalidMember) { try observe([view(1),bad,view(3)]) }
        }
    }

    @Test("Observation dates and diagnostic encoding never claim adjudication or current retention")
    func timeAndEncoding() throws {
        for date in [Date(timeIntervalSince1970: .nan), Date(timeIntervalSince1970: .infinity),
                     Date(timeIntervalSince1970: -1), Date(timeIntervalSince1970: 253_402_300_801)] {
            #expect(throws: Refusal.invalidTime) { try observe([view(1),view(2, observed: date)]) }
        }
        let base = Date(timeIntervalSince1970: 1_800_000_000)
        for date in [base,base.addingTimeInterval(-1),Date(timeIntervalSince1970: .infinity)] {
            #expect(throws: Refusal.invalidTime) { try observe([view(1),view(2, retention: date)]) }
        }
        let historical = try observe([view(1, observed: Date(timeIntervalSince1970: 10), retention: Date(timeIntervalSince1970: 20)),
                                      view(2, observed: Date(timeIntervalSince1970: 11))])
        #expect(historical.firstObservedAtMilliseconds == 10_000)
        #expect(historical.lastObservedAtMilliseconds == 11_000)
        #expect(historical.limitationCodes.contains("RETENTION_REVIEW_DEADLINE_NOT_AUTOMATIC_EXPIRY"))
        let object = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(historical)) as? [String: Any])
        #expect(Set(object.keys) == Set(["schemaVersion","status","adjudication","rootCause","authorizing","observationID",
            "scope","ledgerProfile","ledgerHeadDigest","ledgerEventCount","ledgerObservationCount","ledgerTombstoneCount",
            "members","memberCount","distinctSubjectContentCount","firstObservedAtMilliseconds","lastObservedAtMilliseconds",
            "sharedFailureCodes","sharedSymptomCodes","kind","patternDigest","membershipDigest","observationDigest","limitationCodes"]))
        #expect(object["adjudication"] as? String == "NOT_PERFORMED")
        #expect(object["rootCause"] as? String == "NOT_ESTABLISHED")
        #expect(object["authorizing"] as? Bool == false)
        #expect(object["status"] as? String == "PATTERN_OBSERVED")
        #expect(object["schemaVersion"] as? Int == 2)
        let altered = try observe([view(1, observed: Date(timeIntervalSince1970: 10), retention: Date(timeIntervalSince1970: 21)),
                                   view(2, observed: Date(timeIntervalSince1970: 11))])
        #expect(historical.patternDigest == altered.patternDigest)
        #expect(historical.membershipDigest != altered.membershipDigest)
    }

    @Test("Same-owner concurrent append and captures keep a coherent head-bound cohort")
    func concurrentCapture() async throws {
        try await withLedger { ledger, _ in
            let selected = try await ledger.list().prefix(2).map(\.selection)
            let before = try await ledger.verifyIntegrity()
            let extra = input(4)
            let captured = try await withThrowingTaskGroup(of: FailurePatternObservationV2?.self) { group in
                group.addTask { _ = try await ledger.record(extra); return nil }
                for _ in 0..<12 { group.addTask { try await ledger.observeFailurePattern(selections: selected) } }
                var values: [FailurePatternObservationV2] = []
                for try await value in group { if let value { values.append(value) } }
                return values
            }
            let after = try await ledger.verifyIntegrity()
            #expect(captured.count == 12)
            #expect(before.eventCount == 3); #expect(after.eventCount == 4)
            for value in captured {
                #expect(value.memberCount == 2)
                if value.ledgerEventCount == 3 { #expect(value.ledgerHeadDigest == before.headDigest) }
                else { #expect(value.ledgerEventCount == 4); #expect(value.ledgerHeadDigest == after.headDigest) }
                #expect(value.membershipDigest == captured[0].membershipDigest)
            }
        }
    }
}
