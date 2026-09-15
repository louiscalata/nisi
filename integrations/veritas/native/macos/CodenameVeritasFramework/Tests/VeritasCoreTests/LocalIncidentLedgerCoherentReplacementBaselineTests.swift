import VeritasTestEvidenceSupport
import Darwin
import Dispatch
import Foundation
import SQLite3
import Testing
@testable import VeritasCore

private enum CoherentReplacementBaselineFailure: Error {
    case filesystem(String)
    case sqlite(String)
    case unexpected(String)
}

enum CheckpointControlSyntheticFailure: String, CaseIterable, Sendable {
    case nonSuccess
    case incompleteAccounting
}

private struct CoherentReplacementWALState: Equatable {
    let pageSize: Int64
    let physicalFrameCapacity: Int64
    let byteCount: Int64
}

private enum CoherentReplacementManifestKind: String, Equatable {
    case directory
    case regularFile
}

private struct CoherentReplacementManifestEntry: Equatable {
    let kind: CoherentReplacementManifestKind
    let permissions: mode_t
    let owner: uid_t
    let byteCount: off_t
    let contentDigest: String?
}

private func coherentReplacementDigest(_ value: String) -> String {
    ArtifactSnapshot.digest(Data(value.utf8))
}

private func coherentReplacementScope(
    caseID: String,
    repetition: Int
) -> IncidentLedgerScopeV1 {
    IncidentLedgerScopeV1(
        scopeID: "scope/veritas-private",
        projectDigest: coherentReplacementDigest(
            "coherent-replacement-\(caseID)-\(repetition)"
        ),
        accessPolicyDigest: coherentReplacementDigest("access"),
        retentionPolicyDigest: LocalIncidentLedgerV1.retentionPolicyDigest
    )
}

private func coherentReplacementObservation(
    caseID: String,
    repetition: Int,
    index: Int
) -> IncidentObservationInputV1 {
    let label = "\(caseID)-\(repetition)-\(index)"
    return IncidentObservationInputV1(
        incidentID: "incident/\(coherentReplacementDigest("incident-\(label)"))",
        observationKey: coherentReplacementDigest("observation-\(label)"),
        subjectIDDigest: coherentReplacementDigest("subject-id-\(label)"),
        subjectContentDigest: coherentReplacementDigest("subject-content-\(label)"),
        evidenceSetDigest: coherentReplacementDigest("evidence-\(label)"),
        failureCodes: [.factEvidenceMissing, .requirementMissing],
        symptomCodes: [.missingCitation, .missingSection],
        observedAt: Date(timeIntervalSince1970: 1_900_000_000 + Double(index)),
        retentionReviewAt: Date(timeIntervalSince1970: 1_907_776_000 + Double(index))
    )
}

private func makeCoherentReplacementRoot(_ label: String) throws -> URL {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(
        "veritas-coherent-replacement-\(label)-\(UUID().uuidString)",
        isDirectory: true
    )
    try FileManager.default.createDirectory(
        at: root,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: NSNumber(value: 0o700)]
    )
    return root
}

private func removeCoherentReplacementRoot(_ root: URL) {
    guard FileManager.default.fileExists(atPath: root.path) else { return }
    do {
        try FileManager.default.removeItem(at: root)
    } catch {
        Issue.record("Unable to remove coherent-replacement test root: \(error)")
    }
}

private func appendCoherentReplacementObservation(
    to ledger: LocalIncidentLedgerV1,
    caseID: String,
    repetition: Int,
    index: Int
) async throws -> IncidentSummaryV1 {
    let input = coherentReplacementObservation(
        caseID: caseID,
        repetition: repetition,
        index: index
    )
    guard case let .appended(summary) = try await ledger.record(input) else {
        throw CoherentReplacementBaselineFailure.unexpected(
            "\(caseID) observation \(index) was not appended."
        )
    }
    return summary
}

private func coherentReplacementFileDigest(_ url: URL) throws -> String {
    ArtifactSnapshot.digest(try Data(contentsOf: url, options: [.mappedIfSafe]))
}

private func coherentReplacementReadUInt32BigEndian(
    _ data: Data,
    offset: Int
) throws -> UInt32 {
    guard offset >= 0, offset + 4 <= data.count else {
        throw CoherentReplacementBaselineFailure.unexpected(
            "The WAL header was shorter than the requested integer."
        )
    }
    return data[offset..<(offset + 4)].reduce(UInt32(0)) { partial, byte in
        (partial << 8) | UInt32(byte)
    }
}

private func coherentReplacementWALState(_ walURL: URL) throws -> CoherentReplacementWALState {
    var status = stat()
    guard walURL.path.withCString({ Darwin.lstat($0, &status) }) == 0 else {
        throw CoherentReplacementBaselineFailure.filesystem(
            "Unable to inspect the CR-06 WAL file."
        )
    }
    guard status.st_mode & mode_t(0o170000) == mode_t(0o100000), status.st_size >= 32 else {
        throw CoherentReplacementBaselineFailure.unexpected(
            "The CR-06 WAL path was not a complete regular WAL header."
        )
    }

    let handle = try FileHandle(forReadingFrom: walURL)
    let header: Data
    do {
        header = try handle.read(upToCount: 12) ?? Data()
        try handle.close()
    } catch {
        try? handle.close()
        throw error
    }
    guard header.count == 12 else {
        throw CoherentReplacementBaselineFailure.unexpected(
            "The CR-06 WAL header read was incomplete."
        )
    }
    let magic = try coherentReplacementReadUInt32BigEndian(header, offset: 0)
    guard magic == 0x377f0682 || magic == 0x377f0683 else {
        throw CoherentReplacementBaselineFailure.unexpected(
            "The CR-06 WAL magic value was not admitted."
        )
    }
    let encodedPageSize = try coherentReplacementReadUInt32BigEndian(header, offset: 8)
    let pageSize = encodedPageSize == 1 ? Int64(65_536) : Int64(encodedPageSize)
    guard
        pageSize >= 512,
        pageSize <= 65_536,
        pageSize.nonzeroBitCount == 1
    else {
        throw CoherentReplacementBaselineFailure.unexpected(
            "The CR-06 WAL page size was outside SQLite's admitted range."
        )
    }
    let frameBytes = pageSize + 24
    let payloadBytes = Int64(status.st_size) - 32
    guard payloadBytes >= 0, payloadBytes % frameBytes == 0 else {
        throw CoherentReplacementBaselineFailure.unexpected(
            "The CR-06 WAL byte count was not an integral frame capacity."
        )
    }
    return CoherentReplacementWALState(
        pageSize: pageSize,
        physicalFrameCapacity: payloadBytes / frameBytes,
        byteCount: Int64(status.st_size)
    )
}

private func coherentReplacementSQLiteScalarInt64(
    database: OpaquePointer,
    sql: String
) throws -> Int64 {
    var statement: OpaquePointer?
    let prepareResult = sqlite3_prepare_v2(database, sql, -1, &statement, nil)
    guard prepareResult == SQLITE_OK, let statement else {
        throw CoherentReplacementBaselineFailure.sqlite(
            "SQLite scalar prepare failed: \(String(cString: sqlite3_errmsg(database)))"
        )
    }
    defer { sqlite3_finalize(statement) }
    guard sqlite3_step(statement) == SQLITE_ROW else {
        throw CoherentReplacementBaselineFailure.sqlite(
            "SQLite scalar query did not return one row."
        )
    }
    let value = sqlite3_column_int64(statement, 0)
    guard sqlite3_step(statement) == SQLITE_DONE else {
        throw CoherentReplacementBaselineFailure.sqlite(
            "SQLite scalar query returned more than one row."
        )
    }
    return value
}

private func coherentReplacementSQLiteScalarInt64(
    databaseURL: URL,
    sql: String,
    immutable: Bool
) throws -> Int64 {
    var database: OpaquePointer?
    let location = immutable ? databaseURL.absoluteString + "?immutable=1" : databaseURL.path
    let flags = SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX | (immutable ? SQLITE_OPEN_URI : 0)
    let openResult = sqlite3_open_v2(location, &database, flags, nil)
    guard openResult == SQLITE_OK, let database else {
        let message = database.map { String(cString: sqlite3_errmsg($0)) } ?? "open failed"
        if let database { sqlite3_close_v2(database) }
        throw CoherentReplacementBaselineFailure.sqlite(
            "SQLite read-only open failed (\(openResult)): \(message)"
        )
    }
    defer { sqlite3_close_v2(database) }
    return try coherentReplacementSQLiteScalarInt64(database: database, sql: sql)
}

private func coherentReplacementRuntimeDefaultAutoCheckpointThreshold() throws -> Int64 {
    var database: OpaquePointer?
    let openResult = sqlite3_open_v2(
        ":memory:",
        &database,
        SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX,
        nil
    )
    guard openResult == SQLITE_OK, let database else {
        let message = database.map { String(cString: sqlite3_errmsg($0)) } ?? "open failed"
        if let database { sqlite3_close_v2(database) }
        throw CoherentReplacementBaselineFailure.sqlite(
            "SQLite runtime-default probe open failed (\(openResult)): \(message)"
        )
    }
    defer { sqlite3_close_v2(database) }
    return try coherentReplacementSQLiteScalarInt64(
        database: database,
        sql: "PRAGMA wal_autocheckpoint;"
    )
}

private func coherentReplacementPrimaryEventCount(
    databaseURL: URL,
    root: URL,
    repetition: Int,
    phase: String
) throws -> Int64 {
    let snapshotDirectory = root.appendingPathComponent(
        "cr06-primary-snapshot-\(repetition)-\(phase)",
        isDirectory: true
    )
    try FileManager.default.createDirectory(
        at: snapshotDirectory,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: NSNumber(value: 0o700)]
    )
    let snapshotURL = snapshotDirectory.appendingPathComponent("primary.sqlite3")
    try FileManager.default.copyItem(at: databaseURL, to: snapshotURL)
    guard Darwin.chmod(snapshotURL.path, mode_t(0o600)) == 0 else {
        throw CoherentReplacementBaselineFailure.filesystem(
            "Unable to harden the isolated CR-06 primary copy."
        )
    }
    return try coherentReplacementSQLiteScalarInt64(
        databaseURL: snapshotURL,
        sql: "SELECT event_count FROM ledger_meta WHERE singleton = 1;",
        immutable: true
    )
}

private func coherentReplacementManifest(
    root: URL
) throws -> [String: CoherentReplacementManifestEntry] {
    var manifest: [String: CoherentReplacementManifestEntry] = [:]
    let canonicalRoot = root.resolvingSymlinksInPath().standardizedFileURL

    func add(_ url: URL, relativePath: String) throws {
        var status = stat()
        guard url.path.withCString({ Darwin.lstat($0, &status) }) == 0 else {
            throw CoherentReplacementBaselineFailure.filesystem(
                "Unable to inspect the CR-08 closed-store manifest."
            )
        }
        let fileType = status.st_mode & mode_t(0o170000)
        let kind: CoherentReplacementManifestKind
        let contentDigest: String?
        switch fileType {
        case mode_t(0o040000):
            kind = .directory
            contentDigest = nil
        case mode_t(0o100000):
            kind = .regularFile
            contentDigest = try coherentReplacementFileDigest(url)
        default:
            throw CoherentReplacementBaselineFailure.unexpected(
                "The CR-08 closed store contained a non-regular, non-directory entry."
            )
        }
        manifest[relativePath] = CoherentReplacementManifestEntry(
            kind: kind,
            permissions: status.st_mode & mode_t(0o777),
            owner: status.st_uid,
            byteCount: status.st_size,
            contentDigest: contentDigest
        )
    }

    try add(canonicalRoot, relativePath: ".")
    guard let enumerator = FileManager.default.enumerator(
        at: canonicalRoot,
        includingPropertiesForKeys: nil,
        options: [],
        errorHandler: { url, error in
            Issue.record(
                "Unable to enumerate CR-08 manifest entry \(url.path): \(error)"
            )
            return false
        }
    ) else {
        throw CoherentReplacementBaselineFailure.filesystem(
            "Unable to enumerate the CR-08 closed store."
        )
    }
    for case let url as URL in enumerator {
        let level = enumerator.level
        let components = url.pathComponents
        guard level > 0, level <= components.count else {
            throw CoherentReplacementBaselineFailure.unexpected(
                "The CR-08 manifest enumerator returned an invalid relative level."
            )
        }
        try add(
            url,
            relativePath: components.suffix(level).joined(separator: "/")
        )
    }
    return manifest
}

private func requireCoherentReplacementClosedTuple(
    _ manifest: [String: CoherentReplacementManifestEntry]
) throws {
    let primaryPaths = manifest.keys.filter {
        $0.hasSuffix("/incident-ledger-v1.sqlite3")
    }
    guard
        primaryPaths.count == 1,
        let primaryPath = primaryPaths.first,
        manifest[primaryPath]?.kind == .regularFile,
        manifest[primaryPath + "-wal"]?.kind == .regularFile,
        !manifest.keys.contains(where: { $0.hasSuffix("-journal") })
    else {
        throw CoherentReplacementBaselineFailure.unexpected(
            "The CR-08 fixture was not one coherent closed main-plus-WAL tuple."
        )
    }
}

@Suite("Founder Alpha coherent replacement baselines", .serialized)
struct LocalIncidentLedgerCoherentReplacementBaselineTests {
    @Test(
        "CR-12 normal control preserves exact event accounting across close and reopen",
        arguments: [0, 1]
    )
    func normalControl(repetition: Int) async throws {
        let root = try makeCoherentReplacementRoot("cr12-\(repetition)")
        defer { removeCoherentReplacementRoot(root) }
        let scope = coherentReplacementScope(caseID: "cr12", repetition: repetition)
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        let first = try await appendCoherentReplacementObservation(
            to: ledger,
            caseID: "cr12",
            repetition: repetition,
            index: 0
        )
        let second = try await appendCoherentReplacementObservation(
            to: ledger,
            caseID: "cr12",
            repetition: repetition,
            index: 1
        )
        let beforeVerification = try await ledger.verifyIntegrity()
        let beforeList = try await ledger.list(includeTombstoned: true)
        let firstView = try await ledger.inspect(selection: first.selection)
        let secondView = try await ledger.inspect(selection: second.selection)
        let firstExport = try await ledger.redactedExport(selection: first.selection)
        let secondExport = try await ledger.redactedExport(selection: second.selection)

        #expect(beforeVerification.eventCount == 2)
        #expect(beforeVerification.observationCount == 2)
        #expect(beforeVerification.tombstoneCount == 0)
        #expect(beforeVerification.authorizing == false)
        #expect(beforeVerification.protectedAuthorityVerified == false)
        #expect(beforeVerification.rawContentStored == false)
        #expect(beforeList == [second, first])
        #expect(firstView.summary == first)
        #expect(secondView.summary == second)
        #expect(firstExport.authorizing == false)
        #expect(secondExport.authorizing == false)
        try await ledger.close()

        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == beforeVerification)
        #expect(try await reopened.list(includeTombstoned: true) == beforeList)
        #expect(try await reopened.inspect(selection: first.selection) == firstView)
        #expect(try await reopened.inspect(selection: second.selection) == secondView)
        #expect(try await reopened.redactedExport(selection: first.selection) == firstExport)
        #expect(try await reopened.redactedExport(selection: second.selection) == secondExport)
        try await reopened.close()

        MachineEvidence.record(
            "VERITAS_BASELINE_A_RESULT|case=CR-12|repetition=\(repetition)" +
                "|classification=NORMAL_CONTROL_COMPLETE|events=2"
        )
    }

    @Test(
        "CR-06 same-handle control prevents primary advancement before named-main close",
        arguments: [0, 1]
    )
    func automaticCheckpointControl(repetition: Int) async throws {
        let root = try makeCoherentReplacementRoot("cr06-\(repetition)")
        defer { removeCoherentReplacementRoot(root) }
        let scope = coherentReplacementScope(caseID: "cr06", repetition: repetition)

        // Establish a closed, queryable primary baseline before testing that the
        // reopened actor-held connection does not move later WAL state early.
        let seed = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        _ = try await appendCoherentReplacementObservation(
            to: seed,
            caseID: "cr06-seed",
            repetition: repetition,
            index: 0
        )
        let seedVerification = try await seed.verifyIntegrity()
        #expect(seedVerification.eventCount == 1)
        try await seed.close()

        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        let databaseURL = ledger.databaseURL
        let walURL = URL(fileURLWithPath: databaseURL.path + "-wal")
        let primaryBeforeDigest = try coherentReplacementFileDigest(databaseURL)
        let formerDefaultThreshold = try coherentReplacementRuntimeDefaultAutoCheckpointThreshold()
        #expect(formerDefaultThreshold > 0)
        let sameHandleThreshold = try await ledger.automaticCheckpointThresholdForTesting()
        #expect(sameHandleThreshold == 0)

        var committedBeforeExtra = 0
        var thresholdState: CoherentReplacementWALState?
        let maximumBeforeExtra = Int(LocalIncidentLedgerV1.maximumEventsPerProject - 2)
        for index in 0..<maximumBeforeExtra {
            _ = try await appendCoherentReplacementObservation(
                to: ledger,
                caseID: "cr06",
                repetition: repetition,
                index: index
            )
            committedBeforeExtra += 1
            let state = try coherentReplacementWALState(walURL)
            if state.physicalFrameCapacity > formerDefaultThreshold {
                thresholdState = state
                break
            }
        }
        let crossedState = try #require(thresholdState)
        #expect(crossedState.pageSize == 4_096)
        #expect(crossedState.physicalFrameCapacity > formerDefaultThreshold)

        _ = try await appendCoherentReplacementObservation(
            to: ledger,
            caseID: "cr06",
            repetition: repetition,
            index: committedBeforeExtra
        )
        let liveVerification = try await ledger.verifyIntegrity()
        let expectedLiveCount = seedVerification.eventCount + Int64(committedBeforeExtra + 1)
        #expect(liveVerification.eventCount == expectedLiveCount)
        #expect(liveVerification.observationCount == expectedLiveCount)
        #expect(liveVerification.tombstoneCount == 0)

        let primaryAfterDigest = try coherentReplacementFileDigest(databaseURL)
        let primaryEventCount = try coherentReplacementPrimaryEventCount(
            databaseURL: databaseURL,
            root: root,
            repetition: repetition,
            phase: "before-close"
        )
        #expect(primaryAfterDigest == primaryBeforeDigest)
        #expect(primaryEventCount == seedVerification.eventCount)
        #expect(primaryEventCount < liveVerification.eventCount)

        let sqliteVersion = sqlite3_libversion_number()
        let sqliteSourceID = coherentReplacementDigest(String(cString: sqlite3_sourceid()))
        MachineEvidence.record(
            "VERITAS_BASELINE_A_RESULT|case=CR-06|repetition=\(repetition)" +
                "|classification=CHECKPOINT_CONTROLLED_BEFORE_CLOSE" +
                "|same_handle_threshold=\(sameHandleThreshold)" +
                "|former_default_threshold=\(formerDefaultThreshold)" +
                "|physical_frames=\(crossedState.physicalFrameCapacity)" +
                "|primary_event_count_before_close=\(primaryEventCount)" +
                "|live_event_count=\(liveVerification.eventCount)" +
                "|sqlite_version_number=\(sqliteVersion)" +
                "|sqlite_source_id_digest=\(sqliteSourceID)"
        )

        try await ledger.close()
        let closeAttempt = try #require(await ledger.latestCheckpointAttemptForTesting())
        #expect(closeAttempt.databaseName == "main")
        #expect(closeAttempt.mode == SQLITE_CHECKPOINT_FULL)
        #expect(closeAttempt.resultCode == SQLITE_OK)
        #expect(closeAttempt.logFrames >= 0)
        #expect(closeAttempt.checkpointedFrames == closeAttempt.logFrames)
        #expect(closeAttempt.synthetic == false)

        let primaryAfterCloseDigest = try coherentReplacementFileDigest(databaseURL)
        let primaryEventCountAfterClose = try coherentReplacementPrimaryEventCount(
            databaseURL: databaseURL,
            root: root,
            repetition: repetition,
            phase: "after-close"
        )
        #expect(primaryAfterCloseDigest != primaryBeforeDigest)
        #expect(primaryEventCountAfterClose == liveVerification.eventCount)

        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == liveVerification)
        try await reopened.close()

        MachineEvidence.record(
            "VERITAS_CHECKPOINT_CONTROL_RESULT|case=CR-06|repetition=\(repetition)" +
                "|classification=NAMED_MAIN_FULL_CHECKPOINT_COMPLETE" +
                "|result=\(closeAttempt.resultCode)" +
                "|log_frames=\(closeAttempt.logFrames)" +
                "|checkpointed_frames=\(closeAttempt.checkpointedFrames)" +
                "|post_close_primary_events=\(primaryEventCountAfterClose)"
        )
    }

    @Test("Checkpoint policy readback mismatch refuses first open and cleans the new store")
    func automaticCheckpointReadbackMismatchRefusesOpen() async throws {
        let root = try makeCoherentReplacementRoot("checkpoint-readback-refusal")
        defer { removeCoherentReplacementRoot(root) }
        let scope = coherentReplacementScope(caseID: "checkpoint-readback", repetition: 0)
        let databaseURL = root
            .appendingPathComponent("projects", isDirectory: true)
            .appendingPathComponent(scope.projectDigest, isDirectory: true)
            .appendingPathComponent("incident-ledger-v1.sqlite3")

        do {
            _ = try await LocalIncidentLedgerV1.openForCheckpointTesting(
                rootDirectory: root,
                scope: scope,
                automaticCheckpointReadbackOverride: 1
            )
            Issue.record("A synthetic nonzero same-handle readback must refuse first open.")
        } catch let error as IncidentLedgerErrorV1 {
            guard case .integrity = error else {
                Issue.record("Expected integrity refusal, received \(error).")
                return
            }
        }
        #expect(!FileManager.default.fileExists(atPath: databaseURL.path))
        #expect(!FileManager.default.fileExists(atPath: databaseURL.path + "-wal"))
        #expect(!FileManager.default.fileExists(atPath: databaseURL.path + "-shm"))

        MachineEvidence.record(
            "VERITAS_CHECKPOINT_CONTROL_RESULT|case=POLICY_READBACK_REFUSAL" +
                "|classification=TEST_ONLY_SYNTHETIC_REFUSAL" +
                "|synthetic_readback_override=1"
        )
    }

    @Test(
        "Synthetic non-success and incomplete checkpoint accounting refuse but remain retryable",
        arguments: CheckpointControlSyntheticFailure.allCases
    )
    func syntheticCheckpointFailureIsRetryable(
        failure: CheckpointControlSyntheticFailure
    ) async throws {
        let root = try makeCoherentReplacementRoot("checkpoint-\(failure.rawValue)")
        defer { removeCoherentReplacementRoot(root) }
        let scope = coherentReplacementScope(
            caseID: "checkpoint-\(failure.rawValue)",
            repetition: 0
        )
        let outcome: IncidentLedgerSyntheticCheckpointOutcomeV1
        switch failure {
        case .nonSuccess:
            outcome = IncidentLedgerSyntheticCheckpointOutcomeV1(
                resultCode: SQLITE_BUSY,
                logFrames: 12,
                checkpointedFrames: 4
            )
        case .incompleteAccounting:
            outcome = IncidentLedgerSyntheticCheckpointOutcomeV1(
                resultCode: SQLITE_OK,
                logFrames: 12,
                checkpointedFrames: 11
            )
        }
        let ledger = try await LocalIncidentLedgerV1.openForCheckpointTesting(
            rootDirectory: root,
            scope: scope,
            syntheticCheckpointOutcome: outcome
        )
        _ = try await appendCoherentReplacementObservation(
            to: ledger,
            caseID: "checkpoint-\(failure.rawValue)",
            repetition: 0,
            index: 0
        )
        let before = try await ledger.verifyIntegrity()

        do {
            try await ledger.close()
            Issue.record("The synthetic checkpoint nonpass must refuse close.")
        } catch let error as IncidentLedgerErrorV1 {
            switch failure {
            case .nonSuccess:
                guard case let .sqlite(code, _) = error, code == SQLITE_BUSY else {
                    Issue.record("Expected synthetic SQLITE_BUSY refusal, received \(error).")
                    return
                }
            case .incompleteAccounting:
                guard case .integrity = error else {
                    Issue.record("Expected incomplete-accounting refusal, received \(error).")
                    return
                }
            }
        }
        let refusedAttempt = try #require(await ledger.latestCheckpointAttemptForTesting())
        #expect(refusedAttempt.databaseName == "main")
        #expect(refusedAttempt.mode == SQLITE_CHECKPOINT_FULL)
        #expect(refusedAttempt.resultCode == outcome.resultCode)
        #expect(refusedAttempt.logFrames == outcome.logFrames)
        #expect(refusedAttempt.checkpointedFrames == outcome.checkpointedFrames)
        #expect(refusedAttempt.synthetic == true)
        #expect(try await ledger.verifyIntegrity() == before)

        // The synthetic outcome is one-shot. Retry must use the real named-main
        // FULL checkpoint and preserve the exact committed ledger state.
        try await ledger.close()
        let retryAttempt = try #require(await ledger.latestCheckpointAttemptForTesting())
        #expect(retryAttempt.databaseName == "main")
        #expect(retryAttempt.mode == SQLITE_CHECKPOINT_FULL)
        #expect(retryAttempt.resultCode == SQLITE_OK)
        #expect(retryAttempt.logFrames >= 0)
        #expect(retryAttempt.checkpointedFrames == retryAttempt.logFrames)
        #expect(retryAttempt.synthetic == false)

        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == before)
        try await reopened.close()

        MachineEvidence.record(
            "VERITAS_CHECKPOINT_CONTROL_RESULT|case=\(failure.rawValue)" +
                "|classification=TEST_ONLY_SYNTHETIC_REFUSAL_THEN_REAL_RETRY" +
                "|synthetic_result=\(outcome.resultCode)" +
                "|synthetic_log_frames=\(outcome.logFrames)" +
                "|synthetic_checkpointed_frames=\(outcome.checkpointedFrames)" +
                "|retry_result=\(retryAttempt.resultCode)"
        )
    }

    @Test(
        "CR-08 accepts a coherent older closed store after live advancement",
        arguments: [0, 1]
    )
    func coherentOlderClosedStoreBaseline(repetition: Int) async throws {
        let root = try makeCoherentReplacementRoot("cr08-live-\(repetition)")
        let archiveRoot = try makeCoherentReplacementRoot("cr08-archive-\(repetition)")
        defer {
            removeCoherentReplacementRoot(root)
            removeCoherentReplacementRoot(archiveRoot)
        }
        let scope = coherentReplacementScope(caseID: "cr08", repetition: repetition)

        let initial = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        let olderSummary = try await appendCoherentReplacementObservation(
            to: initial,
            caseID: "cr08",
            repetition: repetition,
            index: 0
        )
        let olderVerification = try await initial.verifyIntegrity()
        let olderList = try await initial.list(includeTombstoned: true)
        #expect(olderVerification.eventCount == 1)
        #expect(olderList == [olderSummary])
        try await initial.close()

        let liveProjects = root.appendingPathComponent("projects", isDirectory: true)
        let archiveProjects = archiveRoot.appendingPathComponent("projects", isDirectory: true)
        let liveOlderManifest = try coherentReplacementManifest(root: liveProjects)
        try requireCoherentReplacementClosedTuple(liveOlderManifest)
        try FileManager.default.copyItem(at: liveProjects, to: archiveProjects)
        #expect(try coherentReplacementManifest(root: archiveProjects) == liveOlderManifest)

        let archiveValidation = try await LocalIncidentLedgerV1.open(
            rootDirectory: archiveRoot,
            scope: scope
        )
        #expect(try await archiveValidation.verifyIntegrity() == olderVerification)
        #expect(try await archiveValidation.list(includeTombstoned: true) == olderList)
        try await archiveValidation.close()
        let frozenOlderManifest = try coherentReplacementManifest(root: archiveProjects)

        let advanced = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        let newerSummary = try await appendCoherentReplacementObservation(
            to: advanced,
            caseID: "cr08",
            repetition: repetition,
            index: 1
        )
        let advancedVerification = try await advanced.verifyIntegrity()
        let advancedList = try await advanced.list(includeTombstoned: true)
        #expect(advancedVerification.eventCount == 2)
        #expect(advancedVerification.headDigest != olderVerification.headDigest)
        #expect(advancedList == [newerSummary, olderSummary])
        try await advanced.close()

        let advancedProjects = root.appendingPathComponent(
            "projects.advanced-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.moveItem(at: liveProjects, to: advancedProjects)
        try FileManager.default.copyItem(at: archiveProjects, to: liveProjects)
        #expect(try coherentReplacementManifest(root: liveProjects) == frozenOlderManifest)
        #expect(try coherentReplacementManifest(root: advancedProjects) != frozenOlderManifest)

        let rolledBack = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        let rolledBackVerification = try await rolledBack.verifyIntegrity()
        let rolledBackList = try await rolledBack.list(includeTombstoned: true)
        #expect(rolledBackVerification == olderVerification)
        #expect(rolledBackList == olderList)
        #expect(rolledBackList == [olderSummary])
        #expect(rolledBackList.allSatisfy { $0.incidentID != newerSummary.incidentID })
        #expect(try await rolledBack.inspect(selection: olderSummary.selection).summary == olderSummary)
        try await rolledBack.close()

        MachineEvidence.record(
            "VERITAS_BASELINE_A_RESULT|case=CR-08|repetition=\(repetition)" +
                "|classification=ADMITTED_OLDER_STATE" +
                "|older_events=\(olderVerification.eventCount)" +
                "|advanced_events=\(advancedVerification.eventCount)" +
                "|rolled_back_events=\(rolledBackVerification.eventCount)"
        )
    }
}

private struct CoherentReplacementPathIdentity: Equatable, Sendable {
    let device: UInt64
    let inode: UInt64
}

private enum CoherentReplacementCommitABATarget: String, Sendable {
    case main
    case directory
}

private final class CoherentReplacementOneShotProbe: @unchecked Sendable {
    private let expectedPoint: IncidentLedgerReplacementBaselinePointV1
    private let action: @Sendable () throws -> Void
    private let lock = NSLock()
    private var invocationCount = 0

    init(
        expectedPoint: IncidentLedgerReplacementBaselinePointV1,
        action: @escaping @Sendable () throws -> Void
    ) {
        self.expectedPoint = expectedPoint
        self.action = action
    }

    func inject(_ point: IncidentLedgerReplacementBaselinePointV1) throws {
        guard point == expectedPoint else { return }
        lock.lock()
        invocationCount += 1
        let count = invocationCount
        lock.unlock()
        guard count == 1 else {
            throw CoherentReplacementBaselineFailure.unexpected(
                "A Baseline B lifecycle barrier was reached more than once."
            )
        }
        try action()
    }

    func requireExactlyOnce() throws {
        lock.lock()
        let count = invocationCount
        lock.unlock()
        guard count == 1 else {
            throw CoherentReplacementBaselineFailure.unexpected(
                "A Baseline B lifecycle barrier was not reached exactly once."
            )
        }
    }
}

private func coherentReplacementProjectDirectory(
    root: URL,
    scope: IncidentLedgerScopeV1
) -> URL {
    root.appendingPathComponent("projects", isDirectory: true)
        .appendingPathComponent(scope.projectDigest, isDirectory: true)
}

private func coherentReplacementCreatePrivateDirectory(_ url: URL) throws {
    try FileManager.default.createDirectory(
        at: url,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: NSNumber(value: 0o700)]
    )
}

private func coherentReplacementPathIdentity(
    _ url: URL,
    expectedType: mode_t
) throws -> CoherentReplacementPathIdentity {
    var status = stat()
    guard url.path.withCString({ Darwin.lstat($0, &status) }) == 0 else {
        throw CoherentReplacementBaselineFailure.filesystem(
            "Unable to inspect a Baseline B replacement path."
        )
    }
    guard
        status.st_mode & mode_t(0o170000) == expectedType,
        status.st_uid == Darwin.geteuid(),
        status.st_nlink == 1 || expectedType == mode_t(0o040000)
    else {
        throw CoherentReplacementBaselineFailure.unexpected(
            "A Baseline B replacement path was outside the admitted fixture profile."
        )
    }
    return CoherentReplacementPathIdentity(
        device: UInt64(status.st_dev),
        inode: UInt64(status.st_ino)
    )
}

private func coherentReplacementAtomicSwap(_ first: URL, _ second: URL) throws {
    let result = first.path.withCString { firstPath in
        second.path.withCString { secondPath in
            Darwin.renameatx_np(
                AT_FDCWD,
                firstPath,
                AT_FDCWD,
                secondPath,
                UInt32(RENAME_SWAP)
            )
        }
    }
    guard result == 0 else {
        let code = errno
        throw CoherentReplacementBaselineFailure.filesystem(
            "Atomic Baseline B RENAME_SWAP failed with errno \(code)."
        )
    }
}

private func coherentReplacementCopyPrivateFile(from source: URL, to destination: URL) throws {
    try FileManager.default.copyItem(at: source, to: destination)
    guard Darwin.chmod(destination.path, mode_t(0o600)) == 0 else {
        throw CoherentReplacementBaselineFailure.filesystem(
            "Unable to harden a Baseline B alternate file."
        )
    }
    _ = try coherentReplacementPathIdentity(destination, expectedType: mode_t(0o100000))
}

private func coherentReplacementRequireIntegrityRefusal(_ error: Error?) throws {
    guard let error = error as? IncidentLedgerErrorV1 else {
        throw CoherentReplacementBaselineFailure.unexpected(
            "The Baseline B operation did not produce a typed ledger refusal."
        )
    }
    guard case .integrity = error else {
        throw CoherentReplacementBaselineFailure.unexpected(
            "The Baseline B operation did not produce the required integrity refusal."
        )
    }
}

private func coherentReplacementRunNonconformingTouch(_ sentinel: URL) throws {
    let executable = URL(fileURLWithPath: "/usr/bin/touch", isDirectory: false)
    var executableStatus = stat()
    guard
        executable.path.withCString({ Darwin.lstat($0, &executableStatus) }) == 0,
        executableStatus.st_mode & mode_t(0o170000) == mode_t(0o100000),
        executableStatus.st_uid == 0,
        executableStatus.st_mode & mode_t(0o111) != 0
    else {
        throw CoherentReplacementBaselineFailure.unexpected(
            "The fixed nonconforming child executable was not admitted."
        )
    }

    let process = Process()
    let standardOutput = Pipe()
    let standardError = Pipe()
    process.executableURL = executable
    process.arguments = [sentinel.path]
    process.environment = [
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "TMPDIR": "/private/tmp",
    ]
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = standardOutput
    process.standardError = standardError
    let termination = DispatchSemaphore(value: 0)
    process.terminationHandler = { _ in termination.signal() }
    try process.run()
    guard termination.wait(timeout: .now() + .seconds(5)) == .success else {
        if process.isRunning { _ = Darwin.kill(process.processIdentifier, SIGKILL) }
        process.waitUntilExit()
        throw CoherentReplacementBaselineFailure.unexpected(
            "The nonconforming same-UID child exceeded its bounded deadline."
        )
    }
    process.waitUntilExit()
    guard
        process.terminationReason == .exit,
        process.terminationStatus == 0,
        standardOutput.fileHandleForReading.readDataToEndOfFile().isEmpty,
        standardError.fileHandleForReading.readDataToEndOfFile().isEmpty
    else {
        throw CoherentReplacementBaselineFailure.unexpected(
            "The nonconforming same-UID child did not complete its exact write."
        )
    }
}

@Suite("Founder Alpha coherent replacement Baseline B", .serialized)
struct LocalIncidentLedgerCoherentReplacementBaselineBTests {
    @Test(
        "CR-02 replacement directory is mutated before the first public integrity refusal",
        arguments: [0, 1]
    )
    func directoryReplacementBeforeOpenLock(repetition: Int) async throws {
        let root = try makeCoherentReplacementRoot("baseline-b-cr02-\(repetition)")
        defer { removeCoherentReplacementRoot(root) }
        let scope = coherentReplacementScope(caseID: "baseline-b-cr02", repetition: repetition)
        let projects = root.appendingPathComponent("projects", isDirectory: true)
        let project = coherentReplacementProjectDirectory(root: root, scope: scope)
        let alternate = projects.appendingPathComponent(
            ".baseline-b-cr02-alternate-\(repetition)",
            isDirectory: true
        )
        try coherentReplacementCreatePrivateDirectory(projects)
        try coherentReplacementCreatePrivateDirectory(project)
        try coherentReplacementCreatePrivateDirectory(alternate)
        let capturedIdentity = try coherentReplacementPathIdentity(
            project,
            expectedType: mode_t(0o040000)
        )
        let probe = CoherentReplacementOneShotProbe(
            expectedPoint: .afterProjectDirectoryIdentityBeforeOpenLock
        ) {
            try coherentReplacementAtomicSwap(project, alternate)
        }

        let ledger = try await LocalIncidentLedgerV1.openForCoherentReplacementBaselineTesting(
            rootDirectory: root,
            scope: scope,
            replacementBaselineProbe: probe.inject
        )
        try probe.requireExactlyOnce()
        let activeIdentity = try coherentReplacementPathIdentity(
            project,
            expectedType: mode_t(0o040000)
        )
        let displacedIdentity = try coherentReplacementPathIdentity(
            alternate,
            expectedType: mode_t(0o040000)
        )
        guard activeIdentity != capturedIdentity, displacedIdentity == capturedIdentity else {
            throw CoherentReplacementBaselineFailure.unexpected(
                "CR-02 did not preserve the exact stable directory replacement."
            )
        }
        guard FileManager.default.fileExists(atPath: ledger.databaseURL.path) else {
            throw CoherentReplacementBaselineFailure.unexpected(
                "CR-02 did not demonstrate bootstrap mutation on the replacement directory."
            )
        }

        var verificationError: Error?
        do {
            _ = try await ledger.verifyIntegrity()
        } catch {
            verificationError = error
        }
        try coherentReplacementRequireIntegrityRefusal(verificationError)

        var closeError: Error?
        do {
            try await ledger.close()
        } catch {
            closeError = error
        }
        try coherentReplacementRequireIntegrityRefusal(closeError)

        MachineEvidence.record(
            "VERITAS_BASELINE_B_RESULT|case=CR-02|target=directory" +
                "|repetition=\(repetition)|classification=LIMITATION_REPRODUCED" +
                "|outcome=BOOTSTRAP_MUTATED_REPLACEMENT_BEFORE_PUBLIC_REFUSAL" +
                "|authorizing=false"
        )
    }

    @Test(
        "CR-03 main A-B-A publishes durably while COMMIT reports failure and rollback poisons",
        arguments: [0, 1]
    )
    func mainABABeforeCommit(repetition: Int) async throws {
        try await runCommitABA(target: .main, repetition: repetition)
    }

    @Test(
        "CR-03 directory A-B-A after the final check remains invisible to COMMIT",
        arguments: [0, 1]
    )
    func directoryABABeforeCommit(repetition: Int) async throws {
        try await runCommitABA(target: .directory, repetition: repetition)
    }

    private func runCommitABA(
        target: CoherentReplacementCommitABATarget,
        repetition: Int
    ) async throws {
        let root = try makeCoherentReplacementRoot(
            "baseline-b-cr03-\(target.rawValue)-\(repetition)"
        )
        defer { removeCoherentReplacementRoot(root) }
        let scope = coherentReplacementScope(
            caseID: "baseline-b-cr03-\(target.rawValue)",
            repetition: repetition
        )
        let seed = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        let seedSummary = try await appendCoherentReplacementObservation(
            to: seed,
            caseID: "baseline-b-cr03-seed-\(target.rawValue)",
            repetition: repetition,
            index: 0
        )
        try await seed.close()

        let project = coherentReplacementProjectDirectory(root: root, scope: scope)
        let main = project.appendingPathComponent("incident-ledger-v1.sqlite3")
        let selected = target == .main ? main : project
        let alternate = project.deletingLastPathComponent().appendingPathComponent(
            ".baseline-b-cr03-\(target.rawValue)-alternate-\(repetition)" +
                (target == .main ? ".sqlite3" : ""),
            isDirectory: target == .directory
        )
        if target == .main {
            try coherentReplacementCopyPrivateFile(from: main, to: alternate)
        } else {
            try coherentReplacementCreatePrivateDirectory(alternate)
        }
        let expectedType = target == .main ? mode_t(0o100000) : mode_t(0o040000)
        let probe = CoherentReplacementOneShotProbe(
            expectedPoint: .afterFinalIdentityCheckBeforeCommit
        ) {
            let before = try coherentReplacementPathIdentity(
                selected,
                expectedType: expectedType
            )
            try coherentReplacementAtomicSwap(selected, alternate)
            let during = try coherentReplacementPathIdentity(
                selected,
                expectedType: expectedType
            )
            guard during != before else {
                throw CoherentReplacementBaselineFailure.unexpected(
                    "CR-03 did not install a distinct temporary identity."
                )
            }
            try coherentReplacementAtomicSwap(selected, alternate)
            let after = try coherentReplacementPathIdentity(
                selected,
                expectedType: expectedType
            )
            guard after == before else {
                throw CoherentReplacementBaselineFailure.unexpected(
                    "CR-03 did not restore the original identity before COMMIT."
                )
            }
        }
        let ledger = try await LocalIncidentLedgerV1.openForCoherentReplacementBaselineTesting(
            rootDirectory: root,
            scope: scope,
            replacementBaselineProbe: probe.inject
        )
        if target == .main {
            let attemptedObservation = coherentReplacementObservation(
                caseID: "baseline-b-cr03-live-main",
                repetition: repetition,
                index: 1
            )
            var recordError: Error?
            var recordDisposition: IncidentAppendDispositionV1?
            do {
                recordDisposition = try await ledger.record(attemptedObservation)
            } catch {
                recordError = error
            }
            try probe.requireExactlyOnce()
            guard
                let ledgerError = recordError as? IncidentLedgerErrorV1,
                case let .integrity(message) = ledgerError,
                message == "Transaction rollback failed; the ledger was closed and must be reopened."
            else {
                // Failure-only evidence. Never emit a Baseline-B PASS frame or
                // substitute a successful append for the exact required refusal.
                func describe(_ error: Error?) -> String {
                    String(String(reflecting: error).prefix(512))
                }
                let disposition: String
                switch recordDisposition {
                case .appended?: disposition = "APPENDED"
                case .idempotentDuplicate?: disposition = "IDEMPOTENT_DUPLICATE"
                case nil: disposition = "nil"
                }
                var removeError: Error?
                do { try FileManager.default.removeItem(at: alternate) }
                catch { removeError = error }
                var firstCloseError: Error?
                do { try await ledger.close() }
                catch { firstCloseError = error }
                let checkpoint = await ledger.latestCheckpointAttemptForTesting()
                // A checkpoint error from close() does not confirm handle
                // closure. Use the existing test-only abort seam, never retry
                // the ambiguous checkpoint, before opening a diagnostic handle.
                var abortError: Error?
                var closeOrAbortReturned = firstCloseError == nil
                if !closeOrAbortReturned {
                    do {
                        try await ledger.abortForCoherentReplacementBaselineTesting()
                        closeOrAbortReturned = true
                    } catch { abortError = error }
                }
                var reopenState = "NOT_ATTEMPTED_WITHOUT_CLEANUP_AND_CLOSE_OR_ABORT_RETURN"
                var reopenError: Error?
                var verificationError: Error?
                var reopenedCloseError: Error?
                var reopenedAbortError: Error?
                var counts = "event=nil,observation=nil,list=nil,attemptedPresent=nil"
                if removeError == nil && closeOrAbortReturned {
                    do {
                        let diagnostic = try await LocalIncidentLedgerV1.open(
                            rootDirectory: root, scope: scope
                        )
                        reopenState = "OPENED"
                        do {
                            let integrity = try await diagnostic.verifyIntegrity()
                            let list = try await diagnostic.list(includeTombstoned: true)
                            let present = list.contains { $0.incidentID == attemptedObservation.incidentID }
                            let seedExact = list.contains(seedSummary)
                            let candidate: IncidentSummaryV1?
                            if case let .appended(summary)? = recordDisposition {
                                candidate = summary
                            } else { candidate = nil }
                            let candidateExact = candidate.map { list.contains($0) } ?? false
                            let headMatchesCandidate = candidate.map {
                                integrity.headDigest == $0.eventDigest && $0.ordinal == 2
                            } ?? false
                            let allInfluenceFalse = !integrity.authorizing
                                && !integrity.protectedAuthorityVerified
                                && !integrity.rawContentStored
                                && list.allSatisfy {
                                    !$0.authorizing && !$0.protectedAuthorityVerified && !$0.rawContentStored
                                }
                            counts = "event=\(integrity.eventCount),observation=\(integrity.observationCount)," +
                                "tombstones=\(integrity.tombstoneCount),list=\(list.count),attemptedPresent=\(present)," +
                                "seedExact=\(seedExact),candidateExact=\(candidateExact)," +
                                "headMatchesCandidate=\(headMatchesCandidate),allInfluenceFalse=\(allInfluenceFalse)"
                        } catch { verificationError = error }
                        // Await even when verify/list fails; preserve mismatch as primary error.
                        do { try await diagnostic.close() }
                        catch {
                            reopenedCloseError = error
                            do { try await diagnostic.abortForCoherentReplacementBaselineTesting() }
                            catch { reopenedAbortError = error }
                        }
                    } catch {
                        reopenState = "OPEN_FAILED"
                        reopenError = error
                    }
                }
                throw CoherentReplacementBaselineFailure.unexpected(
                    "CR-03 main ABA did not produce the exact rollback-poison refusal; " +
                        "observed error: \(describe(recordError)); disposition=\(disposition); " +
                        "removeError=\(describe(removeError)); firstCloseError=\(describe(firstCloseError)); " +
                        "checkpoint=\(String(reflecting: checkpoint)); testAbortError=\(describe(abortError)); " +
                        "closeOrAbortReturned=\(closeOrAbortReturned); priorSQLiteDestructionConfirmed=false; " +
                        "independentRecovery=false; recoveryScope=SAME_PROCESS_FRESH_HANDLE_DIAGNOSTIC_ONLY; " +
                        "reopen=\(reopenState); reopenError=\(describe(reopenError)); \(counts); " +
                        "verificationError=\(describe(verificationError)); reopenedCloseError=\(describe(reopenedCloseError)); " +
                        "reopenedAbortError=\(describe(reopenedAbortError))."
                )
            }
            try FileManager.default.removeItem(at: alternate)
            try await ledger.close()
            let reopened = try await LocalIncidentLedgerV1.open(
                rootDirectory: root,
                scope: scope
            )
            let recovered = try await reopened.verifyIntegrity()
            let recoveredList = try await reopened.list(includeTombstoned: true)
            #expect(recovered.eventCount == 2)
            #expect(recovered.observationCount == 2)
            #expect(recoveredList.count == 2)
            #expect(recoveredList.contains {
                $0.incidentID == attemptedObservation.incidentID
            })
            try await reopened.close()

            MachineEvidence.record(
                "VERITAS_BASELINE_B_RESULT|case=CR-03|target=main" +
                    "|repetition=\(repetition)|classification=LIMITATION_REPRODUCED" +
                    "|outcome=COMMIT_PUBLISHED_DESPITE_REPORTED_ROLLBACK_FAILURE" +
                    "|authorizing=false"
            )
            return
        }

        let appended = try await appendCoherentReplacementObservation(
            to: ledger,
            caseID: "baseline-b-cr03-live-directory",
            repetition: repetition,
            index: 1
        )
        try probe.requireExactlyOnce()
        let verification = try await ledger.verifyIntegrity()
        #expect(verification.eventCount == 2)
        #expect(verification.observationCount == 2)
        #expect(try await ledger.inspect(selection: appended.selection).summary == appended)
        try FileManager.default.removeItem(at: alternate)
        try await ledger.close()

        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == verification)
        try await reopened.close()

        MachineEvidence.record(
            "VERITAS_BASELINE_B_RESULT|case=CR-03|target=directory" +
                "|repetition=\(repetition)|classification=LIMITATION_REPRODUCED" +
                "|outcome=COMMIT_SUCCEEDED_AFTER_UNOBSERVED_ABA" +
                "|authorizing=false"
        )
    }

    @Test(
        "CR-07 restored main-WAL ABA is refused by named-main checkpoint before test-only abort recovery",
        arguments: [0, 1]
    )
    func mainWALABABeforeCheckpoint(repetition: Int) async throws {
        let root = try makeCoherentReplacementRoot("baseline-b-cr07-\(repetition)")
        defer { removeCoherentReplacementRoot(root) }
        let scope = coherentReplacementScope(caseID: "baseline-b-cr07", repetition: repetition)
        let seed = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        _ = try await appendCoherentReplacementObservation(
            to: seed,
            caseID: "baseline-b-cr07-seed",
            repetition: repetition,
            index: 0
        )
        try await seed.close()

        let project = coherentReplacementProjectDirectory(root: root, scope: scope)
        let main = project.appendingPathComponent("incident-ledger-v1.sqlite3")
        let wal = URL(fileURLWithPath: main.path + "-wal")
        let alternateMain = project.appendingPathComponent(
            ".baseline-b-cr07-main-alternate-\(repetition).sqlite3"
        )
        let alternateWAL = project.appendingPathComponent(
            ".baseline-b-cr07-wal-alternate-\(repetition)"
        )
        let probe = CoherentReplacementOneShotProbe(
            expectedPoint: .afterCloseIdentityReattestationBeforeNamedMainCheckpoint
        ) {
            let mainBefore = try coherentReplacementPathIdentity(
                main,
                expectedType: mode_t(0o100000)
            )
            let walBefore = try coherentReplacementPathIdentity(
                wal,
                expectedType: mode_t(0o100000)
            )
            try coherentReplacementAtomicSwap(main, alternateMain)
            try coherentReplacementAtomicSwap(wal, alternateWAL)
            let mainDuring = try coherentReplacementPathIdentity(
                main,
                expectedType: mode_t(0o100000)
            )
            let walDuring = try coherentReplacementPathIdentity(
                wal,
                expectedType: mode_t(0o100000)
            )
            guard mainDuring != mainBefore, walDuring != walBefore else {
                throw CoherentReplacementBaselineFailure.unexpected(
                    "CR-07 did not install both temporary replacement identities."
                )
            }
            try coherentReplacementAtomicSwap(wal, alternateWAL)
            try coherentReplacementAtomicSwap(main, alternateMain)
            guard
                try coherentReplacementPathIdentity(
                    main,
                    expectedType: mode_t(0o100000)
                ) == mainBefore,
                try coherentReplacementPathIdentity(
                    wal,
                    expectedType: mode_t(0o100000)
                ) == walBefore
            else {
                throw CoherentReplacementBaselineFailure.unexpected(
                    "CR-07 did not restore both original identities before checkpoint."
                )
            }
        }
        let ledger = try await LocalIncidentLedgerV1.openForCoherentReplacementBaselineTesting(
            rootDirectory: root,
            scope: scope,
            replacementBaselineProbe: probe.inject
        )
        _ = try await appendCoherentReplacementObservation(
            to: ledger,
            caseID: "baseline-b-cr07-live",
            repetition: repetition,
            index: 1
        )
        let beforeClose = try await ledger.verifyIntegrity()
        #expect(beforeClose.eventCount == 2)
        try coherentReplacementCopyPrivateFile(from: main, to: alternateMain)
        try coherentReplacementCopyPrivateFile(from: wal, to: alternateWAL)
        var closeError: Error?
        do {
            try await ledger.close()
        } catch {
            closeError = error
        }
        try probe.requireExactlyOnce()
        let attempt = try #require(await ledger.latestCheckpointAttemptForTesting())
        #expect(attempt.databaseName == "main")
        #expect(attempt.mode == SQLITE_CHECKPOINT_FULL)
        #expect(attempt.resultCode == SQLITE_IOERR)
        #expect(attempt.synthetic == false)
        guard
            let ledgerError = closeError as? IncidentLedgerErrorV1,
            case let .sqlite(code, _) = ledgerError,
            code == SQLITE_IOERR
        else {
            throw CoherentReplacementBaselineFailure.unexpected(
                "CR-07 did not refuse the ambiguous checkpoint with SQLITE_IOERR."
            )
        }
        try await ledger.abortForCoherentReplacementBaselineTesting()
        try FileManager.default.removeItem(at: alternateMain)
        try FileManager.default.removeItem(at: alternateWAL)

        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == beforeClose)
        try await reopened.close()

        MachineEvidence.record(
            "VERITAS_BASELINE_B_RESULT|case=CR-07|target=main-wal" +
                "|repetition=\(repetition)|classification=SAFE_REFUSAL" +
                "|outcome=CHECKPOINT_REFUSED_TEST_ABORT_REOPEN_PRESERVED" +
                "|authorizing=false"
        )
    }

    @Test(
        "CR-10 same-UID child writes while the project-directory flock is held",
        arguments: [0, 1]
    )
    func nonconformingChildIgnoresProjectFlock(repetition: Int) async throws {
        let root = try makeCoherentReplacementRoot("baseline-b-cr10-\(repetition)")
        defer { removeCoherentReplacementRoot(root) }
        let scope = coherentReplacementScope(caseID: "baseline-b-cr10", repetition: repetition)
        let projects = root.appendingPathComponent("projects", isDirectory: true)
        let project = coherentReplacementProjectDirectory(root: root, scope: scope)
        try coherentReplacementCreatePrivateDirectory(projects)
        try coherentReplacementCreatePrivateDirectory(project)
        let sentinel = project.appendingPathComponent(
            ".baseline-b-cr10-nonconforming-child-\(repetition)"
        )
        let probe = CoherentReplacementOneShotProbe(
            expectedPoint: .afterProjectOpenLockBeforeStoreInspection
        ) {
            try coherentReplacementRunNonconformingTouch(sentinel)
        }
        let ledger = try await LocalIncidentLedgerV1.openForCoherentReplacementBaselineTesting(
            rootDirectory: root,
            scope: scope,
            replacementBaselineProbe: probe.inject
        )
        try probe.requireExactlyOnce()
        let sentinelIdentity = try coherentReplacementPathIdentity(
            sentinel,
            expectedType: mode_t(0o100000)
        )
        #expect(sentinelIdentity.device > 0)
        let sentinelData = try Data(contentsOf: sentinel)
        #expect(sentinelData.isEmpty)
        try FileManager.default.removeItem(at: sentinel)
        _ = try await appendCoherentReplacementObservation(
            to: ledger,
            caseID: "baseline-b-cr10",
            repetition: repetition,
            index: 0
        )
        #expect(try await ledger.verifyIntegrity().eventCount == 1)
        try await ledger.close()

        MachineEvidence.record(
            "VERITAS_BASELINE_B_RESULT|case=CR-10|target=project-directory" +
                "|repetition=\(repetition)|classification=LIMITATION_REPRODUCED" +
                "|outcome=NONCONFORMING_CHILD_WRITE_SUCCEEDED_WHILE_FLOCK_HELD" +
                "|authorizing=false"
        )
    }
}
