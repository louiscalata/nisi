import Foundation
import Testing
@testable import VeritasCore

@Suite("Historical gate import staging — no adjudication or durable authority")
struct HistoricalGateImportTests {
    private typealias Refusal = HistoricalGateImportRefusalV1
    private func hash(_ data: Data) -> String { ArtifactSnapshot.digest(data) }
    private var scope: HistoricalGateScopeV1 { .init(projectDigest: String(repeating: "a", count: 64), ownerDigest: String(repeating: "b", count: 64)) }
    private func fixture() throws -> Data {
        try Data(contentsOf: #require(Bundle.module.url(forResource: "gate-events-mac-20260908", withExtension: "jsonl", subdirectory: "Fixtures")))
    }
    private func finding(_ id: String = "1111111111111111") -> [String: Any] {
        ["event_id": id, "ts": "2026-08-20T22:25:23-0700", "host": "mac", "run_id": "synthetic-run",
         "attempt": "attempt0", "outcome": "unadjudicated", "candidate_sha256": "2222222222222222",
         "ruleset_hash": "3333333333333333", "ast_grep_version": "ast-grep 0.45.1", "rule_id": "test-rule",
         "severity": "error", "match_hash": "4444444444444444", "language": "python"]
    }
    private func encode(_ objects: [[String: Any]]) throws -> Data {
        try objects.reduce(into: Data()) { bytes, object in
            bytes.append(try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])); bytes.append(10)
        }
    }
    private func session(_ data: Data, rows: Int) throws -> HistoricalGateImportSessionV1 {
        try .init(scope: scope, batchID: "batch/test", sourceSHA256: hash(data), expectedRows: rows)
    }
    private func run(_ data: Data, rows: Int) async throws -> HistoricalGateImportReceiptV1 {
        try await session(data, rows: rows).importSnapshot(data, scope: scope, batchID: "batch/test")
    }

    @Test("Actual 80-row snapshot imports twice with exact pins and zero new replay observations")
    func retainedSnapshot() async throws {
        let bytes = try fixture()
        #expect(hash(bytes) == "0ddf797a0089caa34d6faa01207112cfed631c2507aa1c300875f5c5ff2c97c9")
        let owner = try session(bytes, rows: 80)
        let first = try await owner.importSnapshot(bytes, scope: scope, batchID: "batch/test")
        let second = try await owner.importSnapshot(bytes, scope: scope, batchID: "batch/test")
        #expect(first.addedObservationCount == 80 && !first.replayed)
        #expect(second.addedObservationCount == 0 && second.replayed)
        #expect(first.batch == second.batch)
        let rows = first.batch.observations
        #expect(rows.filter { $0.kind == .ruleFinding }.count == 18)
        #expect(rows.filter { $0.kind == .taskDisposition }.count == 61)
        #expect(rows.filter { $0.kind == .assertedAdjudication }.count == 1)
        #expect(Set(rows.map(\.observationID)).count == 80)
        #expect(rows.allSatisfy { $0.status == "CANDIDATE" && !$0.authorizing })
        #expect(!first.batch.authorizing && !first.batch.durableImportPerformed && !first.batch.historicalFactsVerified)
        #expect(first.batch.confirmedIncidentCount == 0)
        #expect(rows.filter { $0.sourceQualityCodes.contains("RULESET_LABEL_ABSENT") }.count == 23)
        #expect(rows.contains { $0.sourceQualityCodes.contains("SOURCE_VERIFIED_WITH_INCOMPLETE_CHECK_EVIDENCE") })
        #expect(first.batch.relationships.contains { $0.kind == .repeatedFindingLabels })
        #expect(first.batch.relationships.contains { $0.kind == .assertedAdjudicationReference })
        let encoded = String(decoding: try JSONEncoder().encode(first), as: UTF8.self)
        for label in ["codemode-20260823-075038", "py-mutable-default-arg", "93735581b94e9961", "task_policy_conflict"] {
            #expect(!encoded.contains(label))
        }
        // Derived prefix, not a recovered independent historical snapshot.
        var prefix = Data(bytes.split(separator: 10).prefix(48).joined(separator: [10])); prefix.append(10)
        let older = try await run(prefix, rows: 48)
        #expect(older.batch.observations.filter { $0.kind == .ruleFinding }.count == 17)
        #expect(older.batch.observations.filter { $0.kind == .taskDisposition }.count == 31)
        #expect(older.batch.sourceDigest != first.batch.sourceDigest)
        #expect(older.batch.observations[0].observationID != rows[0].observationID)
    }

    @Test("Concurrent duplicate imports materialize one in-memory batch")
    func concurrentReplay() async throws {
        let bytes = try encode([finding()]), owner = try session(bytes, rows: 1), scope = self.scope
        let receipts = try await withThrowingTaskGroup(of: HistoricalGateImportReceiptV1.self) { group in
            for _ in 0..<8 { group.addTask { try await owner.importSnapshot(bytes, scope: scope, batchID: "batch/test") } }
            var results: [HistoricalGateImportReceiptV1] = []
            for try await result in group { results.append(result) }; return results
        }
        #expect(receipts.reduce(0) { $0 + $1.addedObservationCount } == 1)
        #expect(receipts.filter { !$0.replayed }.count == 1)
        #expect(Set(receipts.map { $0.batch.batchDigest }).count == 1)
    }

    @Test("Source identity, scope, framing and declared row count cannot drift")
    func bindingRefusals() async throws {
        let bytes = try encode([finding(), finding("5555555555555555")]), owner = try session(bytes, rows: 2)
        let accepted = try await owner.importSnapshot(bytes, scope: scope, batchID: "batch/test")
        let reordered = try encode([finding("5555555555555555"), finding()])
        for value in [reordered, bytes + Data("\n".utf8), try encode([finding()])] {
            do { _ = try await owner.importSnapshot(value, scope: scope, batchID: "batch/test"); Issue.record("source drift accepted") }
            catch { #expect(error as? Refusal == .sourceMismatch) }
        }
        for other in [HistoricalGateScopeV1(projectDigest: String(repeating: "c", count: 64), ownerDigest: scope.ownerDigest),
                      HistoricalGateScopeV1(projectDigest: scope.projectDigest, ownerDigest: String(repeating: "c", count: 64))] {
            do { _ = try await owner.importSnapshot(bytes, scope: other, batchID: "batch/test"); Issue.record("scope changed") }
            catch { #expect(error as? Refusal == .scopeMismatch) }
        }
        do { _ = try await owner.importSnapshot(bytes, scope: scope, batchID: "batch/other"); Issue.record("batch changed") }
        catch { #expect(error as? Refusal == .scopeMismatch) }
        do { _ = try await run(bytes, rows: 1); Issue.record("wrong cardinality") }
        catch { #expect(error as? Refusal == .rowCount) }
        let replay = try await owner.importSnapshot(bytes, scope: scope, batchID: "batch/test")
        #expect(replay.batch == accepted.batch)
    }

    @Test("Closed parser refuses malformed, escalated and mistyped rows atomically")
    func closedRowRefusals() async throws {
        var variants: [[String: Any]] = []
        let changes: [(String, Any)] = [("extra", false), ("outcome", "CONFIRMED"), ("host", "other"),
            ("event_id", "ABCDEF1234567890"), ("candidate_sha256", "short"), ("ts", "2026-02-30T22:25:23-0700"),
            ("kind", "unknown"), ("rule_id", NSNull()), ("ruleset_hash", NSNull()), ("verified", true), ("attempt", 1)]
        for (key, value) in changes {
            var row = finding(); row[key] = value; variants.append(row)
        }
        var missing = finding(); missing.removeValue(forKey: "severity"); variants.append(missing)
        for row in variants {
            let data = try encode([finding(), row]), owner = try session(data, rows: 2)
            do { _ = try await owner.importSnapshot(data, scope: scope, batchID: "batch/test"); Issue.record("malformed row accepted") }
            catch { #expect(error as? Refusal == .malformedRow) }
            #expect(await owner.stagedObservationCountForTesting == 0)
        }
        let valid = try encode([finding()])
        var duplicate = Data("{\"event_id\":\"9999999999999999\",".utf8)
        duplicate.append(valid.dropFirst())
        for data in [duplicate, Data([0xEF, 0xBB, 0xBF]) + valid, Data([0xFF]) + valid, Data("[]\n".utf8), Data("\n".utf8)] {
            do { _ = try await run(data, rows: 1); Issue.record("invalid framing or grammar accepted") }
            catch { #expect(error as? Refusal == .malformedRow) }
        }
    }

    @Test("Repeated and conflicting source labels remain explicit rows and relations")
    func relationships() async throws {
        let first = finding(); var conflict = first; conflict["severity"] = "warning"
        let adjudication: [String: Any] = ["event_id": "9999999999999999", "ts": "2026-08-20T22:25:23-0700", "host": "mac",
            "run_id": "synthetic-run", "attempt": "adjudication", "kind": "adjudication", "rule_id": "test-rule", "outcome": "task_policy_conflict"]
        let result = try await run(encode([first, first, conflict, adjudication]), rows: 4)
        let links = result.batch.relationships
        #expect(result.batch.observations.count == 4)
        #expect(links.filter { $0.kind == .canonicalDuplicate }.count == 1)
        #expect(links.filter { $0.kind == .sourceEventConflict }.count == 2)
        #expect(links.filter { $0.kind == .repeatedFindingLabels }.count == 3)
        #expect(links.filter { $0.kind == .assertedAdjudicationReference }.count == 3)
        #expect(result.batch.confirmedIncidentCount == 0)
        let reversed = try await run(encode([adjudication, first]), rows: 2)
        #expect(reversed.batch.relationships.contains { $0.kind == .assertedAdjudicationReference && $0.fromOrdinal == 1 && $0.toOrdinal == 2 })
        var wrongRun = adjudication; wrongRun["run_id"] = "different-run"
        var wrongRule = adjudication; wrongRule["rule_id"] = "different-rule"
        let unrelated = try await run(encode([first, wrongRun, wrongRule]), rows: 3)
        #expect(!unrelated.batch.relationships.contains { $0.kind == .assertedAdjudicationReference })
        let ordered = try encode([first]), shuffled = Data("  ".utf8) + ordered
        let a = try await run(ordered, rows: 1), b = try await run(shuffled, rows: 1)
        #expect(a.batch.observations[0].canonicalRowDigest == b.batch.observations[0].canonicalRowDigest)
        #expect(a.batch.observations[0].rawRowDigest != b.batch.observations[0].rawRowDigest)
        #expect(a.batch.batchDigest != b.batch.batchDigest)
    }

    @Test("Relationship and byte bounds fail without partial materialization")
    func resourceBounds() async throws {
        let repeated = try encode(Array(repeating: finding(), count: 48)), owner = try session(repeated, rows: 48)
        do { _ = try await owner.importSnapshot(repeated, scope: scope, batchID: "batch/test"); Issue.record("link cap bypassed") }
        catch { #expect(error as? Refusal == .relationshipLimit) }
        #expect(await owner.stagedObservationCountForTesting == 0)
        let oversized = Data(repeating: 32, count: HistoricalGateImportSessionV1.maximumBytes + 1)
        do { _ = try await run(oversized, rows: 1); Issue.record("source cap bypassed") }
        catch { #expect(error as? Refusal == .sourceLimit) }
        let largeRow = Data(repeating: 32, count: HistoricalGateImportSessionV1.maximumRowBytes + 1)
        do { _ = try await run(largeRow, rows: 1); Issue.record("row cap bypassed") }
        catch { #expect(error as? Refusal == .malformedRow) }
    }

    @Test("Declaration and cancellation refusal do not create observations")
    func declarationAndCancellation() async throws {
        let bytes = try encode([finding()])
        for count in [0, 513] {
            #expect(throws: Refusal.invalidDeclaration) { try session(bytes, rows: count) }
        }
        #expect(throws: Refusal.invalidDeclaration) {
            try HistoricalGateImportSessionV1(scope: self.scope, batchID: "bad batch", sourceSHA256: hash(bytes), expectedRows: 1)
        }
        let owner = try session(bytes, rows: 1), scope = self.scope
        let task = Task { withUnsafeCurrentTask { $0?.cancel() }; return try await owner.importSnapshot(bytes, scope: scope, batchID: "batch/test") }
        do { _ = try await task.value; Issue.record("canceled import accepted") }
        catch { #expect(error is CancellationError) }
        #expect(await owner.stagedObservationCountForTesting == 0)
        _ = try await owner.importSnapshot(bytes, scope: scope, batchID: "batch/test")
        await owner.setAfterSourceValidationForTesting { withUnsafeCurrentTask { $0?.cancel() } }
        try await withAsyncTestCleanup(operation: { () async throws -> Void in
            let replay = Task { try await owner.importSnapshot(bytes, scope: scope, batchID: "batch/test") }
            do { _ = try await replay.value; Issue.record("cancellation during replay hashing was ignored") }
            catch { #expect(error is CancellationError) }
        }, cleanup: { await owner.setAfterSourceValidationForTesting(nil) })
        #expect(await owner.stagedObservationCountForTesting == 1)
    }

    @Test("Task status is source data, never converted into trusted incident state")
    func taskStatusNotAuthority() async throws {
        let row: [String: Any] = ["event_id": "1111111111111111", "ts": "2026-08-20T22:25:23-0700", "host": "mac", "run_id": "synthetic-run",
            "attempt": "task-final", "kind": "task_disposition", "terminal_reason": "VERIFIED", "gate_status": "PASS", "gate_rules": [],
            "ruleset_hash": "3333333333333333", "model_verify_status": "PASS", "findings_truncated": false, "verified": true, "outcome": "unadjudicated"]
        let result = try await run(encode([row]), rows: 1)
        #expect(result.batch.observations[0].status == "CANDIDATE")
        #expect(!result.batch.historicalFactsVerified)
        var absent = row; absent["ruleset_hash"] = NSNull()
        let missingRules = try await run(encode([absent]), rows: 1)
        #expect(missingRules.batch.observations[0].sourceQualityCodes.contains("RULESET_LABEL_ABSENT"))
        #expect(missingRules.batch.observations[0].sourceQualityCodes.contains("SOURCE_VERIFIED_WITH_INCOMPLETE_CHECK_EVIDENCE"))
        var truncated = row; truncated["findings_truncated"] = true
        let partial = try await run(encode([truncated]), rows: 1)
        #expect(partial.batch.observations[0].sourceQualityCodes.contains("SOURCE_FINDINGS_TRUNCATED"))
        #expect(partial.batch.observations[0].sourceQualityCodes.contains("SOURCE_VERIFIED_WITH_INCOMPLETE_CHECK_EVIDENCE"))
        var absentKey = row; absentKey.removeValue(forKey: "ruleset_hash")
        do { _ = try await run(encode([absentKey]), rows: 1); Issue.record("missing required null-capable key accepted") }
        catch { #expect(error as? Refusal == .malformedRow) }
        let changes: [(String, Any)] = [("verified", 1), ("verified", NSNull()), ("gate_rules", ["a", "a"]), ("gate_status", "CERTIFIED")]
        for (key, value) in changes {
            var bad = row; bad[key] = value
            do { _ = try await run(encode([bad]), rows: 1); Issue.record("mistyped task row accepted") }
            catch { #expect(error as? Refusal == .malformedRow) }
        }
    }
}
