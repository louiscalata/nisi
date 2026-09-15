import Darwin
import Dispatch
import Foundation
import SQLite3
import Testing
@testable import VeritasCore

private enum LedgerTestFailure: Error {
    case sqlite(String)
    case unexpected(String)
}

private final class TombstoneCommitGate: @unchecked Sendable {
    let entered: AsyncStream<Void>
    let release = DispatchSemaphore(value: 0)
    private let arrival = DispatchSemaphore(value: 0)
    private let continuation: AsyncStream<Void>.Continuation

    init() {
        var captured: AsyncStream<Void>.Continuation?
        entered = AsyncStream(bufferingPolicy: .bufferingNewest(1)) {
            captured = $0
        }
        continuation = captured!
    }

    func inject(_ point: IncidentLedgerFaultPointV1) throws {
        guard point == .beforeTombstoneCommit else { return }
        arrival.signal()
        continuation.yield(())
        release.wait()
    }

    func waitUntilEntered(timeoutSeconds: Double = 3) -> Bool {
        arrival.wait(timeout: .now() + timeoutSeconds) == .success
    }
}

private final class FirstOpenInitializationGate: @unchecked Sendable {
    let entered: AsyncStream<Void>
    let release = DispatchSemaphore(value: 0)
    private let arrival = DispatchSemaphore(value: 0)
    private let continuation: AsyncStream<Void>.Continuation

    init() {
        var captured: AsyncStream<Void>.Continuation?
        entered = AsyncStream(bufferingPolicy: .bufferingNewest(1)) {
            captured = $0
        }
        continuation = captured!
    }

    func inject(_ point: IncidentLedgerFaultPointV1) throws {
        guard point == .duringFirstOpenAfterSchemaInitialization else { return }
        arrival.signal()
        continuation.yield(())
        release.wait()
        throw IncidentLedgerErrorV1.integrity("INJECTED_FIRST_OPEN_FAILURE")
    }

    func waitUntilEntered(timeoutSeconds: Double = 3) -> Bool {
        arrival.wait(timeout: .now() + timeoutSeconds) == .success
    }
}

private final class LedgerClockProbe: @unchecked Sendable {
    private let lock = NSLock()
    private let values: [Date]
    private var calls = 0

    init(_ values: [Date]) {
        precondition(!values.isEmpty)
        self.values = values
    }

    func read() -> Date {
        lock.withLock {
            let value = values[min(calls, values.count - 1)]
            calls += 1
            return value
        }
    }

    var callCount: Int {
        lock.withLock { calls }
    }
}

private final class NthSweepInsertFault: @unchecked Sendable {
    private let lock = NSLock()
    private let failAt: Int
    private var insertionCount = 0

    init(failAt: Int) {
        precondition(failAt > 0)
        self.failAt = failAt
    }

    func inject(_ point: IncidentLedgerFaultPointV1) throws {
        guard point == .afterTombstoneInsertBeforeMetadataUpdate else { return }
        let shouldFail = lock.withLock {
            insertionCount += 1
            return insertionCount == failAt
        }
        if shouldFail {
            throw IncidentLedgerErrorV1.integrity(
                "INJECTED_SWEEP_INSERT_FAILURE_\(failAt)"
            )
        }
    }
}

private final class SweepInsertProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var insertionCount = 0

    func inject(_ point: IncidentLedgerFaultPointV1) {
        guard point == .afterTombstoneInsertBeforeMetadataUpdate else { return }
        lock.withLock { insertionCount += 1 }
    }

    var callCount: Int {
        lock.withLock { insertionCount }
    }
}

private final class LedgerCompletionSignal: @unchecked Sendable {
    private let semaphore = DispatchSemaphore(value: 0)

    func signal() {
        semaphore.signal()
    }

    func wait(timeoutSeconds: Double = 3) -> Bool {
        semaphore.wait(timeout: .now() + timeoutSeconds) == .success
    }
}

private func ledgerDigest(_ value: String) -> String {
    ArtifactSnapshot.digest(Data(value.utf8))
}

private func ledgerScope(
    project: String = "project",
    access: String = "access"
) -> IncidentLedgerScopeV1 {
    IncidentLedgerScopeV1(
        scopeID: "scope/veritas-private",
        projectDigest: ledgerDigest(project),
        accessPolicyDigest: ledgerDigest(access),
        retentionPolicyDigest: LocalIncidentLedgerV1.retentionPolicyDigest
    )
}

private func ledgerObservation(
    incidentID: String = "incident/\(ledgerDigest("founder-alpha-001"))",
    observationKey: String = "observation",
    subject: String = "subject-content",
    evidence: String = "evidence",
    observedAt: Date = Date(timeIntervalSince1970: 1_800_000_000),
    retentionReviewAt: Date? = Date(timeIntervalSince1970: 1_807_776_000)
) -> IncidentObservationInputV1 {
    IncidentObservationInputV1(
        incidentID: incidentID,
        observationKey: ledgerDigest(observationKey),
        subjectIDDigest: ledgerDigest("subject-id"),
        subjectContentDigest: ledgerDigest(subject),
        evidenceSetDigest: ledgerDigest(evidence),
        failureCodes: [.factEvidenceMissing, .requirementMissing],
        symptomCodes: [.missingCitation, .missingSection],
        observedAt: observedAt,
        retentionReviewAt: retentionReviewAt
    )
}

private func ledgerDate(milliseconds: Int64) -> Date {
    Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1_000)
}

private func appendSweepObservation(
    to ledger: LocalIncidentLedgerV1,
    label: String,
    reviewAtMilliseconds: Int64,
    observedAtMilliseconds: Int64 = 1_000
) async throws -> IncidentSummaryV1 {
    let input = ledgerObservation(
        incidentID: "incident/\(ledgerDigest("sweep-\(label)-incident"))",
        observationKey: "sweep-\(label)-observation",
        subject: "sweep-\(label)-subject",
        evidence: "sweep-\(label)-evidence",
        observedAt: ledgerDate(milliseconds: observedAtMilliseconds),
        retentionReviewAt: ledgerDate(milliseconds: reviewAtMilliseconds)
    )
    guard case let .appended(summary) = try await ledger.record(input) else {
        throw LedgerTestFailure.unexpected(
            "Sweep fixture \(label) did not append its observation."
        )
    }
    return summary
}

private func expectNonAuthorizingSweepPage(
    _ page: IncidentRetentionSweepPageV1
) {
    #expect(page.authorizing == false)
    #expect(page.certified == false)
    #expect(page.protectedAuthorityVerified == false)
    #expect(page.rawContentStored == false)
    #expect(page.physicalErasurePerformed == false)
    #expect(page.limitationCodes.contains("LOGICAL_TOMBSTONE_IS_NOT_PHYSICAL_ERASURE"))
    for tombstone in page.tombstones {
        #expect(tombstone.reason == .retentionReviewDue)
        #expect(tombstone.authorizing == false)
        #expect(tombstone.protectedAuthorityVerified == false)
        #expect(tombstone.rawContentStored == false)
        #expect(tombstone.physicalErasurePerformed == false)
    }
}

private func decodeSweepBase64URL(_ value: String) -> Data? {
    var base64 = value.replacingOccurrences(of: "-", with: "+")
        .replacingOccurrences(of: "_", with: "/")
    switch base64.utf8.count % 4 {
    case 0: break
    case 2: base64 += "=="
    case 3: base64 += "="
    default: return nil
    }
    return Data(base64Encoded: base64)
}

private func encodeSweepBase64URL(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

/// Deliberately an INDEPENDENT re-derivation of the v1 frame layout, not a call
/// into `VeritasDigestFrameV1`. Routing this through the shared primitive would
/// make every sweep-token test a tautology against the code it is checking.
private func appendSweepTokenFrame(tag: UInt8, _ value: Data, to data: inout Data) {
    data.append(tag)
    var length = UInt64(value.count).bigEndian
    withUnsafeBytes(of: &length) { data.append(contentsOf: $0) }
    data.append(value)
}

private func sealedSweepToken(prefix: String, payload: Data) -> String {
    var framed = Data()
    appendSweepTokenFrame(
        tag: 0x00,
        Data("veritas-founder-alpha-retention-sweep-continuation-seal-v2".utf8),
        to: &framed
    )
    appendSweepTokenFrame(tag: 0x01, payload, to: &framed)
    return [
        prefix,
        encodeSweepBase64URL(payload),
        ArtifactSnapshot.digest(framed),
    ].joined(separator: ".")
}

private func sweepTokenParts(_ sealedToken: String) throws -> [String] {
    let parts = sealedToken.split(separator: ".", omittingEmptySubsequences: false)
        .map(String.init)
    guard parts.count == 3 else {
        throw LedgerTestFailure.unexpected("Sweep token did not contain three parts.")
    }
    return parts
}

private func sweepTokenPayload(_ sealedToken: String) throws -> Data {
    let parts = try sweepTokenParts(sealedToken)
    guard let payload = decodeSweepBase64URL(parts[1]) else {
        throw LedgerTestFailure.unexpected("Sweep token payload was not base64url.")
    }
    return payload
}

private func resealedSweepToken(
    _ sealedToken: String,
    mutate: (inout [String: Any]) throws -> Void
) throws -> String {
    let parts = try sweepTokenParts(sealedToken)
    let payload = try sweepTokenPayload(sealedToken)
    guard var claims = try JSONSerialization.jsonObject(with: payload) as? [String: Any] else {
        throw LedgerTestFailure.unexpected("Sweep token payload was not an object.")
    }
    try mutate(&claims)
    let canonical = try JSONSerialization.data(
        withJSONObject: claims,
        options: [.sortedKeys, .withoutEscapingSlashes]
    )
    return sealedSweepToken(prefix: parts[0], payload: canonical)
}

private func expectSweepContinuationRefusal(
    _ expected: IncidentRetentionSweepContinuationRefusalV1,
    token: String
) {
    do {
        _ = try IncidentRetentionSweepContinuationV1(sealedToken: token)
        Issue.record("Expected sweep continuation refusal \(expected).")
    } catch {
        #expect(error == expected)
    }
}

private func makeLedgerRoot() throws -> URL {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(
        "veritas-founder-alpha-ledger-\(UUID().uuidString)",
        isDirectory: true
    )
    try FileManager.default.createDirectory(
        at: root,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: NSNumber(value: 0o700)]
    )
    return root
}

private struct LedgerTestPathIdentity: Equatable {
    let device: dev_t
    let inode: ino_t
}

private struct LedgerTestPathStatus: Equatable {
    let identity: LedgerTestPathIdentity
    let fileType: mode_t
    let permissions: mode_t
    let owner: uid_t
    let group: gid_t
    let linkCount: nlink_t
    let byteCount: off_t
    let modifiedSeconds: Int64
    let modifiedNanoseconds: Int64
}

private struct LedgerTestDirectoryEntrySnapshot: Equatable {
    let name: String
    let status: LedgerTestPathStatus
    let bytes: Data
}

private struct LedgerTestDirectorySnapshot: Equatable {
    let directoryStatus: LedgerTestPathStatus
    let entries: [LedgerTestDirectoryEntrySnapshot]
}

private func ledgerTestPathStatus(_ url: URL) throws -> LedgerTestPathStatus {
    var status = stat()
    guard url.path.withCString({ Darwin.lstat($0, &status) }) == 0 else {
        throw LedgerTestFailure.unexpected("Unable to inspect replacement fixture path.")
    }
    return LedgerTestPathStatus(
        identity: LedgerTestPathIdentity(device: status.st_dev, inode: status.st_ino),
        fileType: status.st_mode & mode_t(0o170000),
        permissions: status.st_mode & mode_t(0o777),
        owner: status.st_uid,
        group: status.st_gid,
        linkCount: status.st_nlink,
        byteCount: status.st_size,
        modifiedSeconds: Int64(status.st_mtimespec.tv_sec),
        modifiedNanoseconds: Int64(status.st_mtimespec.tv_nsec)
    )
}

private func ledgerTestPathIdentity(_ url: URL) throws -> LedgerTestPathIdentity {
    try ledgerTestPathStatus(url).identity
}

private func ledgerTestDirectorySnapshot(
    _ directory: URL
) throws -> LedgerTestDirectorySnapshot {
    let directoryStatus = try ledgerTestPathStatus(directory)
    guard directoryStatus.fileType == mode_t(0o040000) else {
        throw LedgerTestFailure.unexpected("Replacement fixture root is not a directory.")
    }
    let entries = try FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: nil,
        options: []
    ).sorted { $0.lastPathComponent < $1.lastPathComponent }
    let snapshots = try entries.map { entry in
        let status = try ledgerTestPathStatus(entry)
        guard status.fileType == mode_t(0o100000) else {
            throw LedgerTestFailure.unexpected(
                "Replacement fixture contains a non-regular entry."
            )
        }
        return LedgerTestDirectoryEntrySnapshot(
            name: entry.lastPathComponent,
            status: status,
            bytes: try Data(contentsOf: entry, options: [.mappedIfSafe])
        )
    }
    return LedgerTestDirectorySnapshot(
        directoryStatus: directoryStatus,
        entries: snapshots
    )
}

private func replacePrimaryWithByteIdenticalCopy(
    at primary: URL
) throws -> (original: URL, replacement: URL) {
    let original = URL(fileURLWithPath: primary.path + ".original-\(UUID().uuidString)")
    try FileManager.default.moveItem(at: primary, to: original)
    do {
        try FileManager.default.copyItem(at: original, to: primary)
        guard Darwin.chmod(primary.path, mode_t(0o600)) == 0 else {
            throw LedgerTestFailure.unexpected(
                "Unable to harden byte-identical replacement fixture."
            )
        }
    } catch {
        try? FileManager.default.removeItem(at: primary)
        try? FileManager.default.moveItem(at: original, to: primary)
        throw error
    }
    return (original, primary)
}

private func restorePrimary(
    original: URL,
    replacement: URL
) throws {
    guard FileManager.default.fileExists(atPath: original.path) else { return }
    try FileManager.default.removeItem(at: replacement)
    try FileManager.default.moveItem(at: original, to: replacement)
}

private final class LedgerPrimaryReplacementFault: @unchecked Sendable {
    private let lock = NSLock()
    private let trigger: IncidentLedgerFaultPointV1
    private var databaseURL: URL?
    private var armed = false
    private var paths: (original: URL, replacement: URL)?
    private var installedSnapshot: LedgerTestDirectorySnapshot?

    init(trigger: IncidentLedgerFaultPointV1) {
        self.trigger = trigger
    }

    func configure(databaseURL: URL) {
        lock.withLock { self.databaseURL = databaseURL }
    }

    func arm() {
        lock.withLock { armed = true }
    }

    func inject(_ point: IncidentLedgerFaultPointV1) throws {
        guard point == trigger else { return }
        let selectedURL: URL? = lock.withLock {
            guard armed, paths == nil else { return nil }
            armed = false
            return databaseURL
        }
        guard let selectedURL else { return }
        let replacement = try replacePrimaryWithByteIdenticalCopy(at: selectedURL)
        do {
            let snapshot = try ledgerTestDirectorySnapshot(
                selectedURL.deletingLastPathComponent()
            )
            lock.withLock {
                paths = replacement
                installedSnapshot = snapshot
            }
        } catch {
            try? restorePrimary(
                original: replacement.original,
                replacement: replacement.replacement
            )
            throw error
        }
    }

    func installedFixtureIsUnchanged() throws -> Bool {
        let state = lock.withLock { (paths, installedSnapshot) }
        guard let paths = state.0, let installedSnapshot = state.1 else {
            throw LedgerTestFailure.unexpected(
                "Replacement fixture was not installed before comparison."
            )
        }
        return try ledgerTestDirectorySnapshot(
            paths.replacement.deletingLastPathComponent()
        ) == installedSnapshot
    }

    func restore() throws {
        let replacement = lock.withLock { paths }
        if let replacement {
            try restorePrimary(
                original: replacement.original,
                replacement: replacement.replacement
            )
            lock.withLock {
                paths = nil
                installedSnapshot = nil
            }
        }
    }
}

private func mutateSQLite(_ databaseURL: URL, sql: String) throws {
    var database: OpaquePointer?
    let openResult = sqlite3_open_v2(
        databaseURL.path,
        &database,
        SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX,
        nil
    )
    guard openResult == SQLITE_OK, let database else {
        throw LedgerTestFailure.sqlite("open \(openResult)")
    }
    defer { sqlite3_close_v2(database) }
    var message: UnsafeMutablePointer<CChar>?
    let result = sqlite3_exec(database, sql, nil, nil, &message)
    if result != SQLITE_OK {
        let text = message.map { String(cString: $0) } ?? "mutation failed"
        sqlite3_free(message)
        throw LedgerTestFailure.sqlite(text)
    }
}

private func expectIntegrityRefusal(
    _ operation: () async throws -> Void
) async {
    do {
        try await operation()
        Issue.record("Expected incident-ledger integrity refusal.")
    } catch let error as IncidentLedgerErrorV1 {
        guard case .integrity = error else {
            Issue.record("Expected integrity refusal, received \(error).")
            return
        }
    } catch {
        Issue.record("Expected IncidentLedgerErrorV1, received \(error).")
    }
}

private func expectClosedRefusal(
    _ operation: () async throws -> Void
) async {
    do {
        try await operation()
        Issue.record("Expected a closed incident ledger.")
    } catch let error as IncidentLedgerErrorV1 {
        #expect(error == .closed)
    } catch {
        Issue.record("Expected IncidentLedgerErrorV1.closed, received \(error).")
    }
}

private let abruptRestartScopeID = "scope/veritas-private"
private let abruptRestartAccessPolicyDigest = ledgerDigest(
    "veritas-abrupt-restart-access-policy"
)

private func abruptRestartScope(project: String) -> IncidentLedgerScopeV1 {
    IncidentLedgerScopeV1(
        scopeID: abruptRestartScopeID,
        projectDigest: ledgerDigest(project),
        accessPolicyDigest: abruptRestartAccessPolicyDigest,
        retentionPolicyDigest: LocalIncidentLedgerV1.retentionPolicyDigest
    )
}

private func abruptRestartCandidateObservation() -> IncidentObservationInputV1 {
    IncidentObservationInputV1(
        incidentID: "incident/\(ledgerDigest("abrupt-restart-candidate-incident"))",
        observationKey: ledgerDigest("abrupt-restart-candidate-observation"),
        subjectIDDigest: ledgerDigest("abrupt-restart-subject-id"),
        subjectContentDigest: ledgerDigest("abrupt-restart-subject-content"),
        evidenceSetDigest: ledgerDigest("abrupt-restart-evidence"),
        failureCodes: [.deterministicCheckFailed, .testFailed],
        symptomCodes: [.failingTest],
        observedAt: Date(timeIntervalSince1970: 1_900_000_000),
        retentionReviewAt: Date(timeIntervalSince1970: 1_907_776_000)
    )
}

private func validatedAbruptRestartProbeExecutable() throws -> URL {
    var candidates: [URL] = []
    if let configured = ProcessInfo.processInfo.environment[
        "VERITAS_LEDGER_CRASH_PROBE_PATH"
    ], !configured.isEmpty {
        candidates.append(URL(fileURLWithPath: configured).standardizedFileURL)
    }

    var searchDirectory = URL(
        fileURLWithPath: CommandLine.arguments[0]
    ).standardizedFileURL.deletingLastPathComponent()
    for _ in 0..<6 {
        candidates.append(
            searchDirectory.appendingPathComponent(
                "VeritasLedgerCrashProbe",
                isDirectory: false
            )
        )
        searchDirectory.deleteLastPathComponent()
    }

    var seen = Set<String>()
    for candidate in candidates where seen.insert(candidate.path).inserted {
        guard let status = try? ledgerTestPathStatus(candidate) else { continue }
        guard
            status.fileType == mode_t(0o100000),
            status.owner == Darwin.geteuid(),
            status.linkCount == 1,
            status.permissions & mode_t(0o111) != 0
        else { continue }
        return candidate
    }
    throw LedgerTestFailure.unexpected(
        "The exact private ledger crash-probe executable was not found or admitted."
    )
}

private func readAbruptRestartReadyFrame(
    descriptor: Int32,
    timeoutMilliseconds: Int32 = 5_000
) throws -> String {
    var pollDescriptor = pollfd(
        fd: descriptor,
        events: Int16(POLLIN),
        revents: 0
    )
    let pollResult = Darwin.poll(&pollDescriptor, 1, timeoutMilliseconds)
    guard
        pollResult == 1,
        pollDescriptor.revents & Int16(POLLIN) != 0
    else {
        throw LedgerTestFailure.unexpected(
            "The ledger crash probe did not emit its bounded READY frame."
        )
    }
    var bytes = [UInt8](repeating: 0, count: 256)
    let byteCount = bytes.withUnsafeMutableBytes { buffer -> Int in
        guard let baseAddress = buffer.baseAddress else { return -1 }
        return Darwin.read(descriptor, baseAddress, buffer.count)
    }
    guard byteCount > 0, byteCount <= bytes.count else {
        throw LedgerTestFailure.unexpected(
            "The ledger crash probe emitted an unreadable READY frame."
        )
    }
    return String(decoding: bytes.prefix(byteCount), as: UTF8.self)
}

private func runAbruptRestartProbe(
    executableURL: URL,
    root: URL,
    scope: IncidentLedgerScopeV1,
    point: IncidentLedgerAbruptProcessPointV1
) throws {
    let process = Process()
    let standardOutput = Pipe()
    let standardError = Pipe()
    process.executableURL = executableURL
    process.arguments = [root.path, scope.projectDigest, point.rawValue]
    process.environment = [
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "TMPDIR": "/private/tmp",
    ]
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = standardOutput
    process.standardError = standardError
    try process.run()
    try? standardOutput.fileHandleForWriting.close()
    try? standardError.fileHandleForWriting.close()

    var reaped = false
    defer {
        if !reaped {
            if process.isRunning {
                _ = Darwin.kill(process.processIdentifier, SIGKILL)
            }
            process.waitUntilExit()
        }
    }

    let expectedFrame = "READY|v1|\(point.rawValue)|\(process.processIdentifier)\n"
    let observedFrame = try readAbruptRestartReadyFrame(
        descriptor: standardOutput.fileHandleForReading.fileDescriptor
    )
    guard observedFrame == expectedFrame else {
        throw LedgerTestFailure.unexpected(
            "The ledger crash probe READY frame did not bind the selected point and PID."
        )
    }
    guard Darwin.kill(process.processIdentifier, SIGKILL) == 0 else {
        throw LedgerTestFailure.unexpected("Unable to terminate the admitted ledger crash probe.")
    }
    process.waitUntilExit()
    reaped = true

    guard
        process.terminationReason == .uncaughtSignal,
        process.terminationStatus == SIGKILL
    else {
        throw LedgerTestFailure.unexpected(
            "The ledger crash probe did not terminate with the required SIGKILL status."
        )
    }
    let errorBytes = standardError.fileHandleForReading.readDataToEndOfFile()
    guard errorBytes.isEmpty else {
        throw LedgerTestFailure.unexpected(
            "The ledger crash probe emitted an unexpected error record."
        )
    }
}

private func expectNonAuthorizingIncidentSummary(_ summary: IncidentSummaryV1) {
    #expect(summary.authorizing == false)
    #expect(summary.protectedAuthorityVerified == false)
    #expect(summary.rawContentStored == false)
}

@Suite("Founder Alpha durable incident ledger")
struct LocalIncidentLedgerTests {
    @Test("Extra objects, authority columns, and weakened constraints fail closed")
    func exactSchemaShape() async throws {
        for sql in [
            "CREATE TABLE injected_shadow (value TEXT) STRICT;",
            "ALTER TABLE incident_events ADD COLUMN actor_identity_digest TEXT;",
            "CREATE VIEW injected_authority AS SELECT 1 AS protected_authority_verified;",
            """
            CREATE TRIGGER sqliteXhidden
            BEFORE INSERT ON incident_events
            BEGIN
                SELECT RAISE(ABORT, 'poisoned');
            END;
            """,
            """
            BEGIN IMMEDIATE;
            CREATE TABLE ledger_meta_weakened (
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                schema_version INTEGER NOT NULL CHECK (schema_version = 3),
                profile TEXT,
                scope_id TEXT NOT NULL,
                project_digest TEXT NOT NULL,
                access_policy_digest TEXT NOT NULL,
                retention_policy_digest TEXT NOT NULL,
                genesis_digest TEXT NOT NULL,
                event_count INTEGER NOT NULL CHECK (event_count >= 0),
                head_digest TEXT NOT NULL,
                authorizing INTEGER NOT NULL CHECK (authorizing = 0),
                protected_authority_verified INTEGER NOT NULL CHECK (protected_authority_verified = 0),
                raw_content_stored INTEGER NOT NULL CHECK (raw_content_stored = 0)
            ) STRICT;
            INSERT INTO ledger_meta_weakened
            SELECT * FROM ledger_meta;
            DROP TABLE ledger_meta;
            ALTER TABLE ledger_meta_weakened RENAME TO ledger_meta;
            COMMIT;
            """,
        ] {
            let root = try makeLedgerRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let scope = ledgerScope(project: ledgerDigest(sql))
            let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
            _ = try await ledger.record(ledgerObservation())
            let databaseURL = ledger.databaseURL
            try await ledger.close()
            try mutateSQLite(databaseURL, sql: sql)

            await expectIntegrityRefusal {
                _ = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
            }
        }
    }

    @Test("Per-project capacity and paginated reads refuse N+1 without changing the head")
    func boundedCapacityAndPagination() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: ledgerScope(),
            eventCapacity: 2,
            faultInjector: { _ in }
        )
        _ = try await ledger.record(ledgerObservation(
            incidentID: "incident/\(ledgerDigest("bounded-1"))",
            observationKey: "bounded-observation-1",
            evidence: "bounded-evidence-1"
        ))
        _ = try await ledger.record(ledgerObservation(
            incidentID: "incident/\(ledgerDigest("bounded-2"))",
            observationKey: "bounded-observation-2",
            evidence: "bounded-evidence-2"
        ))
        let before = try await ledger.verifyIntegrity()

        do {
            _ = try await ledger.record(ledgerObservation(
                incidentID: "incident/\(ledgerDigest("bounded-3"))",
                observationKey: "bounded-observation-3",
                evidence: "bounded-evidence-3"
            ))
            Issue.record("The first append beyond capacity must fail closed.")
        } catch let error as IncidentLedgerErrorV1 {
            #expect(error == .capacityExceeded)
        }

        let after = try await ledger.verifyIntegrity()
        #expect(after == before)
        #expect(after.eventCount == 2)
        let newest = try await ledger.list(limit: 1)
        #expect(newest.count == 1)
        #expect(newest[0].ordinal == 2)
        let older = try await ledger.list(limit: 1, beforeOrdinal: newest[0].ordinal)
        #expect(older.count == 1)
        #expect(older[0].ordinal == 1)

        do {
            _ = try await ledger.list(limit: LocalIncidentLedgerV1.maximumListPageSize + 1)
            Issue.record("An oversized list page must be rejected.")
        } catch let error as IncidentLedgerErrorV1 {
            guard case .invalidInput = error else {
                Issue.record("Expected invalidInput for the oversized page, received \(error).")
                return
            }
        }
        try await ledger.close()
    }

    @Test("Oversized existing database files are refused before SQLite verification")
    func oversizedDatabaseRefusal() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "oversized-database")
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        let databaseURL = ledger.databaseURL
        try await ledger.close()

        let handle = try FileHandle(forWritingTo: databaseURL)
        try handle.truncate(atOffset: UInt64(LocalIncidentLedgerV1.maximumDatabaseBytes + 1))
        try handle.close()

        await expectIntegrityRefusal {
            _ = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        }
    }

    @Test("An exact non-authorizing incident survives close and reopen")
    func persistenceAndReplay() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope()
        let observation = ledgerObservation()

        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        let disposition = try await ledger.record(observation)
        let firstVerification = try await ledger.verifyIntegrity()
        let databaseURL = ledger.databaseURL

        guard case let .appended(summary) = disposition else {
            Issue.record("First observation must append.")
            return
        }
        #expect(summary.subjectContentDigest == observation.subjectContentDigest)
        #expect(summary.authorizing == false)
        #expect(summary.protectedAuthorityVerified == false)
        #expect(summary.rawContentStored == false)
        #expect(firstVerification.eventCount == 1)
        #expect(firstVerification.headDigest == summary.eventDigest)
        try await ledger.close()

        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        let secondVerification = try await reopened.verifyIntegrity()
        let listed = try await reopened.list()
        let view = try await reopened.inspect(selection: summary.selection)
        #expect(secondVerification == firstVerification)
        #expect(listed == [summary])
        #expect(view.summary == summary)
        #expect(view.limitationCodes.contains("HISTORY_NON_AUTHORIZING"))
        #expect(FileManager.default.fileExists(atPath: databaseURL.path))
        try await reopened.close()
    }

    @Test("Exact duplicate is idempotent and divergent reuse is refused")
    func duplicateAndConflict() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: ledgerScope()
        )
        let observation = ledgerObservation()
        _ = try await ledger.record(observation)
        let duplicate = try await ledger.record(observation)
        guard case .idempotentDuplicate = duplicate else {
            Issue.record("Exact duplicate must be idempotent.")
            return
        }
        #expect(try await ledger.verifyIntegrity().eventCount == 1)

        do {
            _ = try await ledger.record(
                ledgerObservation(observationKey: "observation", evidence: "changed-evidence")
            )
            Issue.record("Divergent observation-key reuse must fail.")
        } catch let error as IncidentLedgerErrorV1 {
            #expect(error == .observationConflict)
        }
        do {
            _ = try await ledger.record(
                ledgerObservation(observationKey: "different-observation", evidence: "changed-evidence")
            )
            Issue.record("Divergent incident-ID reuse must fail with the closed conflict reason.")
        } catch let error as IncidentLedgerErrorV1 {
            #expect(error == .incidentIDConflict)
        }
        #expect(try await ledger.verifyIntegrity().eventCount == 1)
        try await ledger.close()
    }

    @Test("Orderly error between insert and head update rolls back completely")
    func orderlyTransactionRollback() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope()
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope
        ) { point in
            guard point == .afterEventInsertBeforeMetadataUpdate else { return }
            throw IncidentLedgerErrorV1.integrity("INJECTED_BEFORE_COMMIT")
        }
        do {
            _ = try await ledger.record(ledgerObservation())
            Issue.record("Injected pre-commit failure must escape.")
        } catch let error as IncidentLedgerErrorV1 {
            #expect(error == .integrity("INJECTED_BEFORE_COMMIT"))
        }
        #expect(try await ledger.verifyIntegrity().eventCount == 0)
        try await ledger.close()

        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.list().isEmpty)
        #expect(try await reopened.verifyIntegrity().eventCount == 0)
        try await reopened.close()
    }

    @Test("Deleted event row is detected on the next open")
    func deletedRowRefused() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope()
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        _ = try await ledger.record(ledgerObservation())
        let databaseURL = ledger.databaseURL
        try await ledger.close()

        try mutateSQLite(databaseURL, sql: "PRAGMA foreign_keys=OFF; DELETE FROM incident_failure_codes; DELETE FROM incident_symptom_codes; DELETE FROM incident_events;")
        await expectIntegrityRefusal {
            _ = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        }
    }

    @Test("Tampered event digest is detected on the next open")
    func tamperedDigestRefused() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope()
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        _ = try await ledger.record(ledgerObservation())
        let databaseURL = ledger.databaseURL
        try await ledger.close()

        try mutateSQLite(
            databaseURL,
            sql: "UPDATE incident_events SET event_digest = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE ordinal = 1;"
        )
        await expectIntegrityRefusal {
            _ = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        }
    }

    @Test("Live tampering is refused before list or duplicate reads return")
    func liveTamperRefused() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: ledgerScope()
        )
        let observation = ledgerObservation()
        _ = try await ledger.record(observation)
        try mutateSQLite(
            ledger.databaseURL,
            sql: "UPDATE incident_failure_codes SET code = 'DETERMINISTIC_CHECK_FAILED' WHERE event_ordinal = 1 AND position = 0;"
        )

        await expectIntegrityRefusal {
            _ = try await ledger.list()
        }
        await expectIntegrityRefusal {
            _ = try await ledger.record(observation)
        }
        try await ledger.close()
    }

    @Test("Orphaned code rows fail foreign-key verification")
    func orphanedCodeRefused() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: ledgerScope()
        )
        try mutateSQLite(
            ledger.databaseURL,
            sql: "PRAGMA foreign_keys=OFF; INSERT INTO incident_failure_codes (event_ordinal, position, code) VALUES (999, 0, 'TEST_FAILED');"
        )
        await expectIntegrityRefusal {
            _ = try await ledger.verifyIntegrity()
        }
        try await ledger.close()
    }

    @Test("Projects-directory symlink cannot escape the selected root")
    func projectsSymlinkRefused() async throws {
        let root = try makeLedgerRoot()
        let outside = try makeLedgerRoot()
        defer {
            try? FileManager.default.removeItem(at: root)
            try? FileManager.default.removeItem(at: outside)
        }
        try FileManager.default.createSymbolicLink(
            at: root.appendingPathComponent("projects"),
            withDestinationURL: outside
        )
        await expectIntegrityRefusal {
            _ = try await LocalIncidentLedgerV1.open(
                rootDirectory: root,
                scope: ledgerScope()
            )
        }
    }

    @Test("Database symlink cannot redirect SQLite or chmod")
    func databaseSymlinkRefused() async throws {
        let root = try makeLedgerRoot()
        let outside = try makeLedgerRoot()
        defer {
            try? FileManager.default.removeItem(at: root)
            try? FileManager.default.removeItem(at: outside)
        }
        let scope = ledgerScope()
        let projectDirectory = root
            .appendingPathComponent("projects", isDirectory: true)
            .appendingPathComponent(scope.projectDigest, isDirectory: true)
        try FileManager.default.createDirectory(
            at: projectDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: NSNumber(value: 0o700)]
        )
        let outsideFile = outside.appendingPathComponent("redirected.sqlite3")
        #expect(FileManager.default.createFile(atPath: outsideFile.path, contents: Data()))
        try FileManager.default.createSymbolicLink(
            at: projectDirectory.appendingPathComponent("incident-ledger-v1.sqlite3"),
            withDestinationURL: outsideFile
        )
        await expectIntegrityRefusal {
            _ = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        }
    }

    @Test("Hard-linked database is refused before SQLite or chmod")
    func databaseHardLinkRefused() async throws {
        let root = try makeLedgerRoot()
        let outside = try makeLedgerRoot()
        defer {
            try? FileManager.default.removeItem(at: root)
            try? FileManager.default.removeItem(at: outside)
        }
        let scope = ledgerScope()
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        _ = try await ledger.record(ledgerObservation())
        let databaseURL = ledger.databaseURL
        try await ledger.close()
        try FileManager.default.linkItem(
            at: databaseURL,
            to: outside.appendingPathComponent("aliased.sqlite3")
        )
        await expectIntegrityRefusal {
            _ = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        }
    }

#if DEBUG
    @Test("SQLite read COMMIT denial preserves the error and rolls back", arguments: [false, true])
    func readCommitDenialPreservesError(listRead: Bool) async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "read-commit-denied-\(listRead)")
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        try await withAsyncTestCleanup {
            _ = try await ledger.record(ledgerObservation())
            let baseline = try await ledger.verifyIntegrity()
            let baselineList = try await ledger.list()
            #expect(baseline.eventCount == 1 && baselineList.count == 1)
            try await ledger.setTransactionEndDenialForTesting(.commit)
            var delivered = false
            do {
                if listRead { _ = try await ledger.list() }
                else { _ = try await ledger.verifyIntegrity() }
                delivered = true
                Issue.record("SQLite must refuse the read transaction COMMIT.")
            } catch let error as IncidentLedgerErrorV1 {
                guard case let .sqlite(code, message) = error else { throw error }
                #expect(code == SQLITE_AUTH)
                #expect(!message.isEmpty)
                // The original error must not be reconstructed from the successful
                // rollback's reset SQLite message. Do not freeze SDK-specific prose.
                #expect(message != String(cString: sqlite3_errstr(SQLITE_OK)))
            }
            #expect(!delivered)
            try await ledger.setTransactionEndDenialForTesting(nil)
            // A missing rollback leaves BEGIN nested and makes these reads fail.
            #expect(try await ledger.verifyIntegrity() == baseline)
            #expect(try await ledger.list() == baselineList)
            try await ledger.close()
            let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
            try await withAsyncTestCleanup {
                let reopenedVerification = try await reopened.verifyIntegrity()
                let reopenedList = try await reopened.list()
                #expect(reopenedVerification == baseline)
                #expect(reopenedList == baselineList)
            } cleanup: {
                do { try await reopened.close() }
                catch { Issue.record("Reopened read fixture cleanup failed: \(error)") }
            }
        } cleanup: {
            do { try await ledger.setTransactionEndDenialForTesting(nil) }
            catch let error as IncidentLedgerErrorV1 { #expect(error == .closed) }
            catch { Issue.record("Authorizer cleanup failed: \(error)") }
            do { try await ledger.close() }
            catch { Issue.record("Read fixture cleanup failed: \(error)") }
        }
    }

    @Test("SQLite read COMMIT and ROLLBACK denial closes the ledger", arguments: [false, true])
    func readCommitAndRollbackDenialCloses(listRead: Bool) async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "read-rollback-denied-\(listRead)")
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        try await withAsyncTestCleanup {
            _ = try await ledger.record(ledgerObservation())
            let baseline = try await ledger.verifyIntegrity()
            let baselineList = try await ledger.list()
            #expect(baseline.eventCount == 1 && baselineList.count == 1)
            try await ledger.setTransactionEndDenialForTesting(.commitAndRollback)
            var delivered = false
            do {
                if listRead { _ = try await ledger.list() }
                else { _ = try await ledger.verifyIntegrity() }
                delivered = true
                Issue.record("SQLite must refuse both transaction-ending statements.")
            } catch let error as IncidentLedgerErrorV1 {
                #expect(error == .integrity(
                    "Transaction rollback failed; the ledger was closed and must be reopened."
                ))
            }
            #expect(!delivered)
            await expectClosedRefusal { _ = try await ledger.verifyIntegrity() }
            await expectClosedRefusal { _ = try await ledger.list() }
            await expectClosedRefusal { try await ledger.setTransactionEndDenialForTesting(nil) }
            let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
            try await withAsyncTestCleanup {
                let reopenedVerification = try await reopened.verifyIntegrity()
                let reopenedList = try await reopened.list()
                #expect(reopenedVerification == baseline)
                #expect(reopenedList == baselineList)
            } cleanup: {
                do { try await reopened.close() }
                catch { Issue.record("Reopened poisoned fixture cleanup failed: \(error)") }
            }
        } cleanup: {
            do { try await ledger.setTransactionEndDenialForTesting(nil) }
            catch let error as IncidentLedgerErrorV1 { #expect(error == .closed) }
            catch { Issue.record("Authorizer cleanup failed: \(error)") }
            do { try await ledger.close() }
            catch { Issue.record("Poisoned fixture cleanup failed: \(error)") }
        }
    }
#endif

    @Test("Rollback failure poisons and closes the ledger")
    func rollbackFailurePoisonsLedger() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: ledgerScope()
        ) { point in
            switch point {
            case .afterEventInsertBeforeMetadataUpdate:
                throw IncidentLedgerErrorV1.integrity("INJECTED_PRIMARY_FAILURE")
            case .afterTombstoneInsertBeforeMetadataUpdate:
                break
            case .beforeTombstoneCommit:
                break
            case .beforeRollback:
                throw IncidentLedgerErrorV1.integrity("INJECTED_ROLLBACK_FAILURE")
            case .duringFirstOpenAfterSchemaInitialization:
                break
            }
        }
        do {
            _ = try await ledger.record(ledgerObservation())
            Issue.record("Injected rollback failure must escape.")
        } catch let error as IncidentLedgerErrorV1 {
            #expect(error == .integrity(
                "Transaction rollback failed; the ledger was closed and must be reopened."
            ))
        }
        do {
            _ = try await ledger.verifyIntegrity()
            Issue.record("Poisoned ledger must remain closed.")
        } catch let error as IncidentLedgerErrorV1 {
            #expect(error == .closed)
        }
    }

    @Test("Failed first-open initialization cleans only its exact new store")
    func failedFirstOpenCanRetry() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope()
        await expectIntegrityRefusal {
            _ = try await LocalIncidentLedgerV1.openForTesting(
                rootDirectory: root,
                scope: scope
            ) { point in
                guard point == .duringFirstOpenAfterSchemaInitialization else { return }
                throw IncidentLedgerErrorV1.integrity("INJECTED_FIRST_OPEN_FAILURE")
            }
        }

        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity().eventCount == 0)
        try await reopened.close()
    }

    @Test("Scope substitution and future schema versions fail closed")
    func scopeAndVersionRefusal() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope()
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        let databaseURL = ledger.databaseURL
        try await ledger.close()

        await expectIntegrityRefusal {
            _ = try await LocalIncidentLedgerV1.open(
                rootDirectory: root,
                scope: ledgerScope(access: "substituted-access")
            )
        }
        try mutateSQLite(databaseURL, sql: "PRAGMA user_version=4;")
        await expectIntegrityRefusal {
            _ = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        }
    }

    @Test("Inspect requires the exact subject digest")
    func subjectBinding() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: ledgerScope()
        )
        let observation = ledgerObservation()
        _ = try await ledger.record(observation)

        do {
            guard case let .appended(summary) = try await ledger.record(
                ledgerObservation(
                    incidentID: "incident/\(ledgerDigest("subject-binding"))",
                    observationKey: "subject-binding-observation"
                )
            ) else {
                Issue.record("Subject-binding fixture must append.")
                return
            }
            let substituted = IncidentSelectionV1(
                projectDigest: summary.projectDigest,
                incidentID: summary.incidentID,
                incidentDigest: summary.incidentDigest,
                subjectIDDigest: summary.subjectIDDigest,
                subjectContentDigest: ledgerDigest("different-subject"),
                observationEventDigest: summary.eventDigest
            )
            _ = try await ledger.inspect(selection: substituted)
            Issue.record("Cross-subject inspect must fail.")
        } catch let error as IncidentLedgerErrorV1 {
            #expect(error == .selectionMismatch)
        }
        try await ledger.close()
    }

    @Test("Raw-shaped identity is rejected and private files contain no canaries")
    func privacyContractAndCanaries() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: ledgerScope()
        )
        let rawIdentityCanary = "incident/users-louis-private-artifact-md"
        let rejected = IncidentObservationInputV1(
            incidentID: rawIdentityCanary,
            observationKey: ledgerDigest("rejected-raw-identity"),
            subjectIDDigest: ledgerDigest("rejected-subject-id"),
            subjectContentDigest: ledgerDigest("rejected-subject-content"),
            evidenceSetDigest: ledgerDigest("rejected-evidence"),
            failureCodes: [.factEvidenceMissing],
            symptomCodes: [.missingCitation],
            observedAt: Date(timeIntervalSince1970: 1_800_000_000),
            retentionReviewAt: nil
        )
        do {
            _ = try await ledger.record(rejected)
            Issue.record("Text-shaped incident identity must be refused.")
        } catch let error as IncidentLedgerErrorV1 {
            guard case .invalidInput = error else {
                Issue.record("Expected invalidInput, received \(error).")
                return
            }
        }
        _ = try await ledger.record(ledgerObservation())
        let projectDirectory = ledger.databaseURL.deletingLastPathComponent()
        try await ledger.close()

        let forbidden = [
            "RAW-ARTIFACT-CANARY-92D4",
            "/Users/example/private-artifact.md",
            "SYSTEM PROMPT CANARY",
            "MODEL TRANSCRIPT CANARY",
            rawIdentityCanary,
        ]
        let files = try FileManager.default.contentsOfDirectory(
            at: projectDirectory,
            includingPropertiesForKeys: [.isRegularFileKey]
        )
        let bytes = try files.reduce(into: Data()) { combined, url in
            let values = try url.resourceValues(forKeys: [.isRegularFileKey])
            if values.isRegularFile == true { combined.append(try Data(contentsOf: url)) }
        }
        for canary in forbidden {
            #expect(bytes.range(of: Data(canary.utf8)) == nil)
        }
        let databaseMode = try FileManager.default.attributesOfItem(
            atPath: ledger.databaseURL.path
        )[.posixPermissions] as? NSNumber
        #expect(databaseMode?.intValue == 0o600)
    }

    @Test("Database, WAL, SHM, and controlled directories are private while open")
    func liveFileModes() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: ledgerScope()
        )
        _ = try await ledger.record(ledgerObservation())

        let databaseURL = ledger.databaseURL
        let urls = [
            databaseURL,
            URL(fileURLWithPath: databaseURL.path + "-wal"),
            URL(fileURLWithPath: databaseURL.path + "-shm"),
        ]
        for url in urls {
            #expect(FileManager.default.fileExists(atPath: url.path))
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
            #expect((attributes[.ownerAccountID] as? NSNumber)?.uint32Value == geteuid())
        }
        for directory in [
            databaseURL.deletingLastPathComponent(),
            databaseURL.deletingLastPathComponent().deletingLastPathComponent(),
        ] {
            let attributes = try FileManager.default.attributesOfItem(atPath: directory.path)
            #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o700)
        }
        try await ledger.close()
    }

    @Test("Non-finite and out-of-range timestamps are rejected without trapping")
    func unsafeTimestampsRefused() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: ledgerScope()
        )
        let unsafeSeconds = [Double.infinity, Double.nan, Double.greatestFiniteMagnitude]
        for (index, seconds) in unsafeSeconds.enumerated() {
            let observation = IncidentObservationInputV1(
                incidentID: "incident/\(ledgerDigest("unsafe-time-\(index)"))",
                observationKey: ledgerDigest("unsafe-time-observation-\(index)"),
                subjectIDDigest: ledgerDigest("unsafe-time-subject-id-\(index)"),
                subjectContentDigest: ledgerDigest("unsafe-time-subject-content-\(index)"),
                evidenceSetDigest: ledgerDigest("unsafe-time-evidence-\(index)"),
                failureCodes: [.testFailed],
                symptomCodes: [.failingTest],
                observedAt: Date(timeIntervalSince1970: seconds),
                retentionReviewAt: nil
            )
            do {
                _ = try await ledger.record(observation)
                Issue.record("Unsafe timestamp must be refused.")
            } catch let error as IncidentLedgerErrorV1 {
                guard case .invalidInput = error else {
                    Issue.record("Expected invalidInput, received \(error).")
                    return
                }
            }
        }
        #expect(try await ledger.verifyIntegrity().eventCount == 0)
        try await ledger.close()
    }

    @Test("Malformed code sets are refused before storage")
    func malformedCodesRefused() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: ledgerScope()
        )
        let invalid = IncidentObservationInputV1(
            incidentID: "incident/\(ledgerDigest("founder-alpha-002"))",
            observationKey: ledgerDigest("invalid-observation"),
            subjectIDDigest: ledgerDigest("subject-id"),
            subjectContentDigest: ledgerDigest("subject-content"),
            evidenceSetDigest: ledgerDigest("evidence"),
            failureCodes: [.requirementMissing, .factEvidenceMissing],
            symptomCodes: [.missingSection],
            observedAt: Date(timeIntervalSince1970: 1_800_000_000),
            retentionReviewAt: nil
        )
        do {
            _ = try await ledger.record(invalid)
            Issue.record("Unsorted code sets must fail.")
        } catch let error as IncidentLedgerErrorV1 {
            guard case .invalidInput = error else {
                Issue.record("Expected invalidInput, received \(error).")
                return
            }
        }
        #expect(try await ledger.verifyIntegrity().eventCount == 0)
        try await ledger.close()
    }

    @Test("Explanation binds exact read snapshot, recorded meanings and lifecycle without authority")
    func explanationSnapshotAndLifecycle() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope()
        let ledger = try await LocalIncidentLedgerV1.openForTesting(rootDirectory: root, scope: scope,
            clock: { Date(timeIntervalSince1970: 1_900_000_000) }, faultInjector: { _ in })
        try await withAsyncTestCleanup {
            guard case .appended(let summary) = try await ledger.record(ledgerObservation(subject: "RAW_SECRET_CANARY")) else {
                Issue.record("Expected fresh observation"); return
            }
            let before = try await ledger.verifyIntegrity()
            let value = try await ledger.explain(selection: summary.selection)
            #expect(value.projectDigest == scope.projectDigest)
            #expect(value.scopeDigest == ledgerDigest(scope.scopeID))
            #expect(value.accessPolicyDigest == scope.accessPolicyDigest)
            #expect(value.retentionPolicyDigest == scope.retentionPolicyDigest)
            #expect(value.incidentID == summary.incidentID && value.incidentDigest == summary.incidentDigest)
            #expect(value.subjectIDDigest == summary.subjectIDDigest && value.subjectContentDigest == summary.subjectContentDigest)
            #expect(value.observationEventDigest == summary.eventDigest && value.evidenceSetDigest == summary.evidenceSetDigest)
            #expect(value.asOfLedgerHeadDigest == before.headDigest && value.asOfLedgerEventCount == 1)
            #expect(value.lifecycle == "ACTIVE" && value.tombstoneEventDigest == nil)
            #expect(!value.authorizing && !value.historicalFactsVerified)
            #expect(value.rootCause == "NOT_ESTABLISHED" && value.adjudication == "NOT_PERFORMED")
            #expect(value.recommendedAction == "NONE" && value.modelParticipation == "NOT_RUN")
            #expect(value.interpretation == "OBSERVED_CODES_ONLY")
            let data = try JSONEncoder().encode(value)
            let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
            #expect(json["explanationDigest"] as? String == value.explanationDigest)
            #expect(!String(decoding: data, as: UTF8.self).contains("RAW_SECRET_CANARY"))
            #expect(try await ledger.verifyIntegrity() == before)
            #expect(try await ledger.explain(selection: summary.selection) == value)
            let view = try await ledger.inspect(selection: summary.selection)
            let sameCountOtherHead = IncidentLedgerVerificationV1(profile: before.profile,
                eventCount: before.eventCount, observationCount: before.observationCount,
                tombstoneCount: before.tombstoneCount, headDigest: ledgerDigest("other-valid-shaped-head"),
                authorizing: false, protectedAuthorityVerified: false, rawContentStored: false)
            let otherHead = IncidentExplanationV1(view: view, verification: sameCountOtherHead)
            #expect(otherHead.asOfLedgerEventCount == value.asOfLedgerEventCount)
            #expect(otherHead.explanationDigest != value.explanationDigest)
            _ = try await ledger.record(ledgerObservation(incidentID: "incident/\(ledgerDigest("unrelated"))", observationKey: "other"))
            let newer = try await ledger.explain(selection: summary.selection)
            #expect(newer.signals == value.signals && newer.lifecycle == value.lifecycle)
            #expect(newer.explanationDigest != value.explanationDigest)
            #expect(newer.asOfLedgerEventCount == 2 && newer.asOfLedgerHeadDigest != value.asOfLedgerHeadDigest)
            _ = try await ledger.tombstone(selection: summary.selection, reason: .userRequested,
                expectedRetentionPolicyDigest: scope.retentionPolicyDigest)
            let deleted = try await ledger.explain(selection: summary.selection)
            #expect(deleted.lifecycle == "TOMBSTONED" && deleted.tombstoneEventDigest != nil)
            #expect(deleted.asOfLedgerEventCount == 3 && deleted.explanationDigest != newer.explanationDigest)
            #expect(deleted.signals == value.signals && !deleted.authorizing)
        } cleanup: { try? await ledger.close() }
    }

    @Test("Explanation rejects every substituted selection component and missing identities")
    func explanationSelectionRefusal() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: ledgerScope())
        try await withAsyncTestCleanup {
            guard case .appended(let summary) = try await ledger.record(ledgerObservation()) else { Issue.record("Expected append"); return }
            let s = summary.selection, other = ledgerDigest("substitution")
            let baseline = try await ledger.verifyIntegrity()
            for component in 0..<6 {
                let changed = IncidentSelectionV1(projectDigest: component == 0 ? other : s.projectDigest,
                    incidentID: component == 1 ? "incident/\(other)" : s.incidentID,
                    incidentDigest: component == 2 ? other : s.incidentDigest,
                    subjectIDDigest: component == 3 ? other : s.subjectIDDigest,
                    subjectContentDigest: component == 4 ? other : s.subjectContentDigest,
                    observationEventDigest: component == 5 ? other : s.observationEventDigest)
                do { _ = try await ledger.explain(selection: changed); Issue.record("Substitution accepted: \(component)") }
                catch let error as IncidentLedgerErrorV1 {
                    #expect(error == (component == 1 ? .incidentNotFound : .selectionMismatch))
                }
            }
            let malformed = IncidentSelectionV1(projectDigest: "bad", incidentID: s.incidentID, incidentDigest: s.incidentDigest,
                subjectIDDigest: s.subjectIDDigest, subjectContentDigest: s.subjectContentDigest, observationEventDigest: s.observationEventDigest)
            do { _ = try await ledger.explain(selection: malformed); Issue.record("Malformed selection accepted") }
            catch let error as IncidentLedgerErrorV1 { guard case .invalidInput = error else { throw error } }
            #expect(try await ledger.verifyIntegrity() == baseline)
        } cleanup: { try? await ledger.close() }
    }

    @Test("Every admitted explanation code has a stable fixed meaning and canonical order")
    func explanationClosedVocabulary() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: ledgerScope())
        try await withAsyncTestCleanup {
            let base = ledgerObservation()
            let input = IncidentObservationInputV1(incidentID: base.incidentID, observationKey: base.observationKey,
                subjectIDDigest: base.subjectIDDigest, subjectContentDigest: base.subjectContentDigest,
                evidenceSetDigest: base.evidenceSetDigest, failureCodes: IncidentFailureCodeV1.allCases.sorted { $0.rawValue < $1.rawValue },
                symptomCodes: IncidentSymptomCodeV1.allCases.sorted { $0.rawValue < $1.rawValue }, observedAt: base.observedAt, retentionReviewAt: nil)
            guard case .appended(let summary) = try await ledger.record(input) else { Issue.record("Expected append"); return }
            let value = try await ledger.explain(selection: summary.selection)
            #expect(value.signals.map(\.code) == IncidentFailureCodeV1.allCases.map(\.rawValue).sorted() + IncidentSymptomCodeV1.allCases.map(\.rawValue).sorted())
            #expect(value.signals.count == 11 && value.signals.allSatisfy { !$0.meaning.isEmpty })
            #expect(value.signals.first { $0.code == "FACT_EVIDENCE_MISSING" }?.meaning == "The record reports missing factual support. This does not establish that a claim is false.")
            #expect(value.signals.first { $0.code == "DETERMINISTIC_CHECK_INCONCLUSIVE" }?.meaning == "The recorded check was inconclusive. It establishes neither a pass nor a failure.")
        } cleanup: { try? await ledger.close() }
    }

    @Test("Explanation never delivers a denied read COMMIT", arguments: [false, true])
    func explanationReadEndRefusal(poison: Bool) async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: ledgerScope())
        try await withAsyncTestCleanup {
            guard case .appended(let summary) = try await ledger.record(ledgerObservation()) else { Issue.record("Expected append"); return }
            let baseline = try await ledger.verifyIntegrity()
            try await ledger.setTransactionEndDenialForTesting(poison ? .commitAndRollback : .commit)
            do { _ = try await ledger.explain(selection: summary.selection); Issue.record("Read end failure delivered explanation") }
            catch let error as IncidentLedgerErrorV1 {
                if poison { guard case .integrity = error else { throw error } }
                else { guard case .sqlite(let code, _) = error else { throw error }; #expect(code == SQLITE_AUTH) }
            }
            if !poison {
                try await ledger.setTransactionEndDenialForTesting(nil)
                #expect(try await ledger.verifyIntegrity() == baseline)
                #expect(try await ledger.explain(selection: summary.selection).asOfLedgerHeadDigest == baseline.headDigest)
            } else { await expectClosedRefusal { _ = try await ledger.explain(selection: summary.selection) } }
        } cleanup: {
            try? await ledger.setTransactionEndDenialForTesting(nil)
            try? await ledger.close()
        }
    }

    @Test("Cancellation before or after explanation COMMIT never delivers", arguments: [false, true])
    func explanationCancellation(afterCommit: Bool) async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: ledgerScope())
        let gate = TombstoneCommitGate()
        defer { gate.release.signal() }
        try await withAsyncTestCleanup {
            guard case .appended(let summary) = try await ledger.record(ledgerObservation()) else { Issue.record("Expected append"); return }
            let baseline = try await ledger.verifyIntegrity()
            if afterCommit { await ledger.setAfterExplanationTransactionForTesting { try? gate.inject(.beforeTombstoneCommit) } }
            else { await ledger.setBeforeExplanationCompletionForTesting { try? gate.inject(.beforeTombstoneCommit) } }
            var entered = gate.entered.makeAsyncIterator()
            let task = Task { try await ledger.explain(selection: summary.selection) }
            let reached: Void? = await entered.next(); #expect(reached != nil)
            task.cancel(); gate.release.signal()
            do { _ = try await task.value; Issue.record("Cancelled explanation delivered") }
            catch is CancellationError { }
            await ledger.setBeforeExplanationCompletionForTesting(nil)
            await ledger.setAfterExplanationTransactionForTesting(nil)
            #expect(try await ledger.verifyIntegrity() == baseline)
            #expect(try await ledger.explain(selection: summary.selection).asOfLedgerHeadDigest == baseline.headDigest)
        } cleanup: {
            await ledger.setBeforeExplanationCompletionForTesting(nil)
            await ledger.setAfterExplanationTransactionForTesting(nil)
            try? await ledger.close()
        }
    }

    @Test("Exact selection inspect and tombstone survive restart without physical erasure")
    func exactSelectionTombstoneAndRestart() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "tombstone-restart")
        let due = Date(timeIntervalSince1970: 1_807_776_000)
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { due }
        ) { _ in }
        let observation = ledgerObservation(
            incidentID: "incident/\(ledgerDigest("tombstone-restart"))",
            observationKey: "tombstone-restart-observation"
        )
        guard case let .appended(summary) = try await ledger.record(observation) else {
            Issue.record("Lifecycle fixture must append its observation.")
            return
        }

        let active = try await ledger.inspect(selection: summary.selection)
        #expect(active.lifecycleState == .active)
        #expect(active.tombstone == nil)

        let disposition = try await ledger.tombstone(
            selection: summary.selection,
            reason: .retentionReviewDue,
            expectedRetentionPolicyDigest: scope.retentionPolicyDigest
        )
        guard case let .appended(tombstone) = disposition else {
            Issue.record("First lifecycle deletion must append a tombstone.")
            return
        }
        #expect(tombstone.physicalErasurePerformed == false)
        #expect(tombstone.authorizing == false)
        #expect(try await ledger.list().isEmpty)
        #expect(try await ledger.list(includeTombstoned: true) == [summary])
        let verification = try await ledger.verifyIntegrity()
        #expect(verification.eventCount == 2)
        #expect(verification.observationCount == 1)
        #expect(verification.tombstoneCount == 1)
        try await ledger.close()

        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        let deleted = try await reopened.inspect(selection: summary.selection)
        #expect(deleted.lifecycleState == .tombstoned)
        #expect(deleted.tombstone == tombstone)
        let duplicate = try await reopened.tombstone(
            selection: summary.selection,
            reason: .retentionReviewDue,
            expectedRetentionPolicyDigest: scope.retentionPolicyDigest
        )
        #expect(duplicate == .idempotentDuplicate(tombstone))
        do {
            _ = try await reopened.record(observation)
            Issue.record("Recapture must not resurrect a tombstoned incident.")
        } catch let error as IncidentLedgerErrorV1 {
            #expect(error == .incidentTombstoned)
        }
        try await reopened.close()
    }

    @Test("Retention deletion uses the ledger clock and refuses every no-op boundary")
    func retentionClockAndPolicyRefusal() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "retention-boundary")
        let beforeDue = Date(timeIntervalSince1970: 1_807_775_999)
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { beforeDue }
        ) { _ in }
        guard case let .appended(summary) = try await ledger.record(ledgerObservation(
            incidentID: "incident/\(ledgerDigest("retention-boundary"))",
            observationKey: "retention-boundary-observation"
        )) else {
            Issue.record("Retention fixture must append.")
            return
        }
        let before = try await ledger.verifyIntegrity()

        do {
            _ = try await ledger.tombstone(
                selection: summary.selection,
                reason: .retentionReviewDue,
                expectedRetentionPolicyDigest: scope.retentionPolicyDigest
            )
            Issue.record("Retention deletion before the exact deadline must fail.")
        } catch let error as IncidentLedgerErrorV1 {
            #expect(error == .retentionNotDue)
        }
        do {
            _ = try await ledger.tombstone(
                selection: summary.selection,
                reason: .userRequested,
                expectedRetentionPolicyDigest: ledgerDigest("wrong-policy")
            )
            Issue.record("A substituted retention policy must fail.")
        } catch let error as IncidentLedgerErrorV1 {
            #expect(error == .retentionPolicyMismatch)
        }
        #expect(try await ledger.verifyIntegrity() == before)

        let userDeletion = try await ledger.tombstone(
            selection: summary.selection,
            reason: .userRequested,
            expectedRetentionPolicyDigest: scope.retentionPolicyDigest
        )
        guard case .appended = userDeletion else {
            Issue.record("The declared user-request path must append once.")
            return
        }
        do {
            _ = try await ledger.tombstone(
                selection: summary.selection,
                reason: .retentionReviewDue,
                expectedRetentionPolicyDigest: scope.retentionPolicyDigest
            )
            Issue.record("Divergent tombstone reason reuse must fail.")
        } catch let error as IncidentLedgerErrorV1 {
            #expect(error == .tombstoneConflict)
        }
        try await ledger.close()
    }

    @Test("Retention-driven deletion refuses an incident without a review deadline")
    func missingRetentionDeadlineRefused() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "missing-retention")
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { Date(timeIntervalSince1970: 1_900_000_000) }
        ) { _ in }
        let input = IncidentObservationInputV1(
            incidentID: "incident/\(ledgerDigest("missing-retention"))",
            observationKey: ledgerDigest("missing-retention-observation"),
            subjectIDDigest: ledgerDigest("missing-retention-subject-id"),
            subjectContentDigest: ledgerDigest("missing-retention-subject-content"),
            evidenceSetDigest: ledgerDigest("missing-retention-evidence"),
            failureCodes: [.testFailed],
            symptomCodes: [.failingTest],
            observedAt: Date(timeIntervalSince1970: 1_800_000_000),
            retentionReviewAt: nil
        )
        guard case let .appended(summary) = try await ledger.record(input) else {
            Issue.record("Missing-retention fixture must append.")
            return
        }
        let before = try await ledger.verifyIntegrity()
        do {
            _ = try await ledger.tombstone(
                selection: summary.selection,
                reason: .retentionReviewDue,
                expectedRetentionPolicyDigest: scope.retentionPolicyDigest
            )
            Issue.record("A missing review deadline must not authorize retention deletion.")
        } catch let error as IncidentLedgerErrorV1 {
            #expect(error == .retentionDeadlineMissing)
        }
        #expect(try await ledger.verifyIntegrity() == before)
        try await ledger.close()
    }

    @Test("All exact selection substitutions fail without changing the ledger")
    func exactSelectionSubstitutionRefused() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let ledger = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: ledgerScope(project: "selection-substitution")
        )
        guard case let .appended(summary) = try await ledger.record(ledgerObservation(
            incidentID: "incident/\(ledgerDigest("selection-substitution"))",
            observationKey: "selection-substitution-observation"
        )) else {
            Issue.record("Selection fixture must append.")
            return
        }
        let selection = summary.selection
        let substitutions = [
            IncidentSelectionV1(
                projectDigest: ledgerDigest("other-project"),
                incidentID: selection.incidentID,
                incidentDigest: selection.incidentDigest,
                subjectIDDigest: selection.subjectIDDigest,
                subjectContentDigest: selection.subjectContentDigest,
                observationEventDigest: selection.observationEventDigest
            ),
            IncidentSelectionV1(
                projectDigest: selection.projectDigest,
                incidentID: selection.incidentID,
                incidentDigest: ledgerDigest("other-incident-digest"),
                subjectIDDigest: selection.subjectIDDigest,
                subjectContentDigest: selection.subjectContentDigest,
                observationEventDigest: selection.observationEventDigest
            ),
            IncidentSelectionV1(
                projectDigest: selection.projectDigest,
                incidentID: selection.incidentID,
                incidentDigest: selection.incidentDigest,
                subjectIDDigest: ledgerDigest("other-subject-id"),
                subjectContentDigest: selection.subjectContentDigest,
                observationEventDigest: selection.observationEventDigest
            ),
            IncidentSelectionV1(
                projectDigest: selection.projectDigest,
                incidentID: selection.incidentID,
                incidentDigest: selection.incidentDigest,
                subjectIDDigest: selection.subjectIDDigest,
                subjectContentDigest: selection.subjectContentDigest,
                observationEventDigest: ledgerDigest("other-event")
            ),
        ]
        let before = try await ledger.verifyIntegrity()
        for substituted in substitutions {
            do {
                _ = try await ledger.inspect(selection: substituted)
                Issue.record("Every coherent-looking selection substitution must fail.")
            } catch let error as IncidentLedgerErrorV1 {
                #expect(error == .selectionMismatch)
            }
        }
        #expect(try await ledger.verifyIntegrity() == before)
        try await ledger.close()
    }

    @Test("Redacted export is canonical across repeat and restart and contains no canaries")
    func deterministicRedactedExportAndCanaries() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "redacted-export")
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        guard case let .appended(summary) = try await ledger.record(ledgerObservation(
            incidentID: "incident/\(ledgerDigest("redacted-export"))",
            observationKey: "redacted-export-observation"
        )) else {
            Issue.record("Export fixture must append.")
            return
        }
        let first = try await ledger.redactedExport(selection: summary.selection)
        let second = try await ledger.redactedExport(selection: summary.selection)
        #expect(first == second)
        #expect(first.digest == ArtifactSnapshot.digest(first.canonicalData))
        #expect(first.authorizing == false)
        #expect(first.certified == false)
        #expect(first.rawContentStored == false)
        try await ledger.close()

        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        let third = try await reopened.redactedExport(selection: summary.selection)
        #expect(third == first)
        let forbidden = [
            "RAW-ARTIFACT-CANARY-92D4",
            "/Users/example/private-artifact.md",
            "SYSTEM PROMPT CANARY",
            "MODEL TRANSCRIPT CANARY",
            "sk-live-secret-canary",
            "SQLite error",
        ]
        for canary in forbidden {
            #expect(first.canonicalData.range(of: Data(canary.utf8)) == nil)
        }
        let object = try #require(
            JSONSerialization.jsonObject(with: first.canonicalData) as? [String: Any]
        )
        #expect(object["recordType"] as? String == "VERITAS_REDACTED_INCIDENT")
        #expect(object["lifecycleState"] as? String == "ACTIVE")
        #expect(object["physicalErasurePerformed"] as? Bool == false)
        try await reopened.close()
    }

    @Test("Tombstone insert failure rolls back payload and global head")
    func tombstoneRollback() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "tombstone-rollback")
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { Date(timeIntervalSince1970: 1_900_000_000) }
        ) { point in
            guard point == .afterTombstoneInsertBeforeMetadataUpdate else { return }
            throw IncidentLedgerErrorV1.integrity("INJECTED_TOMBSTONE_FAILURE")
        }
        guard case let .appended(summary) = try await ledger.record(ledgerObservation(
            incidentID: "incident/\(ledgerDigest("tombstone-rollback"))",
            observationKey: "tombstone-rollback-observation"
        )) else {
            Issue.record("Rollback fixture must append its observation.")
            return
        }
        let before = try await ledger.verifyIntegrity()
        do {
            _ = try await ledger.tombstone(
                selection: summary.selection,
                reason: .userRequested,
                expectedRetentionPolicyDigest: scope.retentionPolicyDigest
            )
            Issue.record("Injected tombstone failure must escape.")
        } catch let error as IncidentLedgerErrorV1 {
            #expect(error == .integrity("INJECTED_TOMBSTONE_FAILURE"))
        }
        #expect(try await ledger.verifyIntegrity() == before)
        #expect(try await ledger.inspect(selection: summary.selection).lifecycleState == .active)
        try await ledger.close()
    }

    @Test("Tombstone commit is atomic with lifecycle admission and cancellation")
    func tombstoneCommitRevocationIsAtomic() async throws {
        enum Revocation {
            case lifecycle
            case cancellation
        }

        for revocation in [Revocation.lifecycle, .cancellation] {
            let root = try makeLedgerRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let scope = ledgerScope(project: "tombstone-revocation-\(revocation)")
            let gate = TombstoneCommitGate()
            let ledger = try await LocalIncidentLedgerV1.openForTesting(
                rootDirectory: root,
                scope: scope,
                clock: { Date(timeIntervalSince1970: 1_900_000_000) },
                faultInjector: gate.inject
            )
            guard case let .appended(summary) = try await ledger.record(ledgerObservation(
                incidentID: "incident/\(ledgerDigest("tombstone-revocation-\(revocation)"))",
                observationKey: "tombstone-revocation-observation-\(revocation)"
            )) else {
                Issue.record("Revocation fixture must append its observation.")
                return
            }
            let before = try await ledger.verifyIntegrity()
            let control = IncidentLifecycleMutationControlV1()
            let admission = try #require(control.issueAdmission())
            var entered = gate.entered.makeAsyncIterator()
            let mutation = Task {
                try await ledger.tombstone(
                    selection: summary.selection,
                    reason: .userRequested,
                    expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
                    admission: admission
                )
            }
            let reachedCommit: Void? = await entered.next()
            #expect(reachedCommit != nil)
            switch revocation {
            case .lifecycle:
                control.invalidatePendingMutations()
            case .cancellation:
                mutation.cancel()
            }
            gate.release.signal()
            do {
                _ = try await mutation.value
                Issue.record("A revoked tombstone must roll back before COMMIT.")
            } catch let error as IncidentLedgerErrorV1 {
                #expect(revocation == .lifecycle)
                #expect(error == .admissionRevoked)
            } catch is CancellationError {
                #expect(revocation == .cancellation)
            }
            #expect(try await ledger.verifyIntegrity() == before)
            #expect(try await ledger.inspect(selection: summary.selection).lifecycleState == .active)
            try await ledger.close()
        }
    }

    @Test("Retention sweep freezes exact cutoff, order, and initial high-watermark")
    func retentionSweepFrozenPagination() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "retention-sweep-frozen-pagination")
        let firstClock = Date(timeIntervalSince1970: 30.0025)
        let admittedCutoff = Int64(
            (firstClock.timeIntervalSince1970 * 1_000).rounded(.towardZero)
        )
        let lossyRoundTrip = Int64(
            (ledgerDate(milliseconds: admittedCutoff).timeIntervalSince1970 * 1_000)
                .rounded(.towardZero)
        )
        #expect(admittedCutoff == 30_002)
        #expect(lossyRoundTrip == 30_001)

        let clock = LedgerClockProbe([
            firstClock,
            Date(timeIntervalSince1970: 900),
        ])
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: clock.read
        ) { _ in }
        let observationA = try await appendSweepObservation(
            to: ledger,
            label: "frozen-a",
            reviewAtMilliseconds: 20_000
        )
        let observationB = try await appendSweepObservation(
            to: ledger,
            label: "frozen-b",
            reviewAtMilliseconds: 10_000
        )
        let observationC = try await appendSweepObservation(
            to: ledger,
            label: "frozen-c",
            reviewAtMilliseconds: 10_000
        )
        let observationD = try await appendSweepObservation(
            to: ledger,
            label: "frozen-d",
            reviewAtMilliseconds: 30_000
        )
        #expect(clock.callCount == 0)

        let control = IncidentLifecycleMutationControlV1()
        let admission = try #require(control.issueAdmission())
        let firstPage = try await ledger.sweepRetentionReviewDue(
            expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
            batchSize: 2,
            admission: admission
        )
        #expect(clock.callCount == 1)
        #expect(firstPage.cutoffAtMilliseconds == admittedCutoff)
        #expect(firstPage.initialEventHighWatermark == 4)
        #expect(firstPage.batchSize == 2)
        #expect(firstPage.processedObservationCount == 2)
        #expect(firstPage.appendedTombstoneCount == 2)
        #expect(firstPage.replayedTombstoneCount == 0)
        #expect(firstPage.tombstones.map(\.incidentID) == [
            observationB.incidentID,
            observationC.incidentID,
        ])
        let continuation = try #require(firstPage.continuation)
        #expect(continuation.sealedToken.utf8.count
            <= IncidentRetentionSweepContinuationV1.maximumSealedTokenUTF8Bytes)
        #expect(
            try IncidentRetentionSweepContinuationV1(
                sealedToken: continuation.sealedToken
            ) == continuation
        )
        expectNonAuthorizingSweepPage(firstPage)

        let lateObservation = try await appendSweepObservation(
            to: ledger,
            label: "frozen-late",
            reviewAtMilliseconds: 15_000
        )
        let secondPage = try await ledger.sweepRetentionReviewDue(
            expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
            batchSize: 2,
            continuation: continuation,
            admission: admission
        )
        #expect(clock.callCount == 1)
        #expect(secondPage.cutoffAtMilliseconds == firstPage.cutoffAtMilliseconds)
        #expect(secondPage.initialEventHighWatermark == firstPage.initialEventHighWatermark)
        #expect(secondPage.processedObservationCount == 2)
        #expect(secondPage.appendedTombstoneCount == 2)
        #expect(secondPage.replayedTombstoneCount == 0)
        #expect(secondPage.tombstones.map(\.incidentID) == [
            observationA.incidentID,
            observationD.incidentID,
        ])
        #expect(secondPage.continuation == nil)
        expectNonAuthorizingSweepPage(secondPage)

        let finalVerification = try await ledger.verifyIntegrity()
        #expect(finalVerification.eventCount == 9)
        #expect(finalVerification.observationCount == 5)
        #expect(finalVerification.tombstoneCount == 4)
        #expect(
            try await ledger.inspect(selection: lateObservation.selection).lifecycleState
                == .active
        )
        try await ledger.close()

        let reopened = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: scope
        )
        #expect(try await reopened.verifyIntegrity() == finalVerification)
        for summary in [observationA, observationB, observationC, observationD] {
            #expect(
                try await reopened.inspect(selection: summary.selection).lifecycleState
                    == .tombstoned
            )
        }
        #expect(
            try await reopened.inspect(selection: lateObservation.selection).lifecycleState
                == .active
        )
        try await reopened.close()

        let inclusiveRoot = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: inclusiveRoot) }
        let inclusiveScope = ledgerScope(project: "retention-sweep-inclusive-cutoff")
        let inclusiveLedger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: inclusiveRoot,
            scope: inclusiveScope,
            clock: { Date(timeIntervalSince1970: 20) }
        ) { _ in }
        let exactlyDue = try await appendSweepObservation(
            to: inclusiveLedger,
            label: "inclusive-cutoff",
            reviewAtMilliseconds: 20_000
        )
        let inclusiveAdmission = try #require(
            IncidentLifecycleMutationControlV1().issueAdmission()
        )
        let inclusivePage = try await inclusiveLedger.sweepRetentionReviewDue(
            expectedRetentionPolicyDigest: inclusiveScope.retentionPolicyDigest,
            batchSize: 1,
            admission: inclusiveAdmission
        )
        #expect(inclusivePage.cutoffAtMilliseconds == 20_000)
        #expect(inclusivePage.tombstones.map(\.incidentID) == [exactlyDue.incidentID])
        #expect(inclusivePage.appendedTombstoneCount == 1)
        expectNonAuthorizingSweepPage(inclusivePage)
        try await inclusiveLedger.close()
    }

    @Test("Retention sweep excludes user tombstones and replays without head movement")
    func retentionSweepUserExclusionAndReplay() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "retention-sweep-replay")
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            eventCapacity: 8,
            clock: { ledgerDate(milliseconds: 40_000) }
        ) { _ in }
        let userDeleted = try await appendSweepObservation(
            to: ledger,
            label: "replay-user",
            reviewAtMilliseconds: 5_000
        )
        let existingRetention = try await appendSweepObservation(
            to: ledger,
            label: "replay-existing",
            reviewAtMilliseconds: 10_000
        )
        let newFirst = try await appendSweepObservation(
            to: ledger,
            label: "replay-new-first",
            reviewAtMilliseconds: 20_000
        )
        let newSecond = try await appendSweepObservation(
            to: ledger,
            label: "replay-new-second",
            reviewAtMilliseconds: 30_000
        )
        _ = try await ledger.tombstone(
            selection: userDeleted.selection,
            reason: .userRequested,
            expectedRetentionPolicyDigest: scope.retentionPolicyDigest
        )
        let existingDisposition = try await ledger.tombstone(
            selection: existingRetention.selection,
            reason: .retentionReviewDue,
            expectedRetentionPolicyDigest: scope.retentionPolicyDigest
        )
        guard case let .appended(existingTombstone) = existingDisposition else {
            throw LedgerTestFailure.unexpected(
                "Replay fixture did not append its exact retention tombstone."
            )
        }

        let control = IncidentLifecycleMutationControlV1()
        let admission = try #require(control.issueAdmission())
        let firstPage = try await ledger.sweepRetentionReviewDue(
            expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
            batchSize: 2,
            admission: admission
        )
        #expect(firstPage.processedObservationCount == 2)
        #expect(firstPage.appendedTombstoneCount == 1)
        #expect(firstPage.replayedTombstoneCount == 1)
        #expect(firstPage.tombstones.first == existingTombstone)
        #expect(firstPage.tombstones.map(\.incidentID) == [
            existingRetention.incidentID,
            newFirst.incidentID,
        ])
        let continuation = try #require(firstPage.continuation)
        let secondPage = try await ledger.sweepRetentionReviewDue(
            expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
            batchSize: 2,
            continuation: continuation,
            admission: admission
        )
        #expect(secondPage.processedObservationCount == 1)
        #expect(secondPage.appendedTombstoneCount == 1)
        #expect(secondPage.replayedTombstoneCount == 0)
        #expect(secondPage.tombstones.map(\.incidentID) == [newSecond.incidentID])
        #expect(secondPage.continuation == nil)
        expectNonAuthorizingSweepPage(firstPage)
        expectNonAuthorizingSweepPage(secondPage)

        let committed = try await ledger.verifyIntegrity()
        #expect(committed.eventCount == 8)
        #expect(committed.observationCount == 4)
        #expect(committed.tombstoneCount == 4)
        let expectedReplay = [
            existingTombstone,
            try #require(firstPage.tombstones.last),
            try #require(secondPage.tombstones.first),
        ]
        try await ledger.close()

        let reopened = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            eventCapacity: 8,
            clock: { ledgerDate(milliseconds: 40_000) }
        ) { _ in }
        let beforeReplay = try await reopened.verifyIntegrity()
        let replayAdmission = try #require(
            IncidentLifecycleMutationControlV1().issueAdmission()
        )
        let replayPage = try await reopened.sweepRetentionReviewDue(
            expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
            batchSize: 100,
            admission: replayAdmission
        )
        #expect(replayPage.processedObservationCount == 3)
        #expect(replayPage.appendedTombstoneCount == 0)
        #expect(replayPage.replayedTombstoneCount == 3)
        #expect(replayPage.tombstones == expectedReplay)
        #expect(replayPage.continuation == nil)
        #expect(try await reopened.verifyIntegrity() == beforeReplay)
        #expect(
            try await reopened.inspect(selection: userDeleted.selection).lifecycleState
                == .tombstoned
        )
        expectNonAuthorizingSweepPage(replayPage)
        try await reopened.close()
    }

    @Test("Retention sweep empty, future, policy, and page bounds are fail-closed")
    func retentionSweepEmptyFutureAndBounds() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "retention-sweep-empty")
        let clock = LedgerClockProbe([ledgerDate(milliseconds: 20_000)])
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: clock.read
        ) { _ in }
        let future = try await appendSweepObservation(
            to: ledger,
            label: "empty-future",
            reviewAtMilliseconds: 30_000
        )
        guard case let .appended(noDeadline) = try await ledger.record(
            ledgerObservation(
                incidentID: "incident/\(ledgerDigest("sweep-empty-none"))",
                observationKey: "sweep-empty-none",
                subject: "sweep-empty-none",
                evidence: "sweep-empty-none",
                observedAt: ledgerDate(milliseconds: 1_000),
                retentionReviewAt: nil
            )
        ) else {
            throw LedgerTestFailure.unexpected(
                "No-deadline sweep fixture did not append."
            )
        }
        let before = try await ledger.verifyIntegrity()
        let control = IncidentLifecycleMutationControlV1()
        let admission = try #require(control.issueAdmission())

        for invalidBatch in [0, LocalIncidentLedgerV1.maximumRetentionSweepPageSize + 1] {
            do {
                _ = try await ledger.sweepRetentionReviewDue(
                    expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
                    batchSize: invalidBatch,
                    admission: admission
                )
                Issue.record("Invalid retention-sweep page bound must fail.")
            } catch let error as IncidentLedgerErrorV1 {
                guard case .invalidInput = error else {
                    Issue.record("Expected invalidInput, received \(error).")
                    continue
                }
            }
        }
        do {
            _ = try await ledger.sweepRetentionReviewDue(
                expectedRetentionPolicyDigest: ledgerDigest("wrong-retention-policy"),
                batchSize: 1,
                admission: admission
            )
            Issue.record("Substituted sweep policy must fail.")
        } catch let error as IncidentLedgerErrorV1 {
            #expect(error == .retentionPolicyMismatch)
        }
        #expect(clock.callCount == 0)

        let page = try await ledger.sweepRetentionReviewDue(
            expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
            batchSize: 5,
            admission: admission
        )
        #expect(clock.callCount == 1)
        #expect(page.cutoffAtMilliseconds == 20_000)
        #expect(page.initialEventHighWatermark == 2)
        #expect(page.processedObservationCount == 0)
        #expect(page.appendedTombstoneCount == 0)
        #expect(page.replayedTombstoneCount == 0)
        #expect(page.tombstones.isEmpty)
        #expect(page.continuation == nil)
        #expect(try await ledger.verifyIntegrity() == before)
        #expect(
            try await ledger.inspect(selection: future.selection).lifecycleState == .active
        )
        #expect(
            try await ledger.inspect(selection: noDeadline.selection).lifecycleState
                == .active
        )
        expectNonAuthorizingSweepPage(page)
        try await ledger.close()
    }

    @Test("Retention sweep parser, binding, cursor, and unresolved-prefix refusals")
    func retentionSweepContinuationRefusals() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "retention-sweep-continuation-refusals")
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { ledgerDate(milliseconds: 40_000) }
        ) { _ in }
        let first = try await appendSweepObservation(
            to: ledger,
            label: "continuation-first",
            reviewAtMilliseconds: 10_000
        )
        let middle = try await appendSweepObservation(
            to: ledger,
            label: "continuation-middle",
            reviewAtMilliseconds: 20_000
        )
        let last = try await appendSweepObservation(
            to: ledger,
            label: "continuation-last",
            reviewAtMilliseconds: 30_000
        )
        let control = IncidentLifecycleMutationControlV1()
        let admission = try #require(control.issueAdmission())
        let firstPage = try await ledger.sweepRetentionReviewDue(
            expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
            batchSize: 1,
            admission: admission
        )
        #expect(firstPage.tombstones.map(\.incidentID) == [first.incidentID])
        expectNonAuthorizingSweepPage(firstPage)
        let continuation = try #require(firstPage.continuation)
        let token = continuation.sealedToken
        let parts = try sweepTokenParts(token)

        expectSweepContinuationRefusal(
            .oversized,
            token: String(
                repeating: "x",
                count: IncidentRetentionSweepContinuationV1.maximumSealedTokenUTF8Bytes + 1
            )
        )
        expectSweepContinuationRefusal(.malformed, token: "not-a-token")
        expectSweepContinuationRefusal(
            .unsupportedVersion,
            token: ["unsupported-prefix", parts[1], parts[2]].joined(separator: ".")
        )
        // A retired v1 token (private seal framing) must refuse at the prefix
        // guard as an unsupported version, never surface as a seal mismatch.
        expectSweepContinuationRefusal(
            .unsupportedVersion,
            token: ["veritas-retention-sweep-continuation-v1", parts[1], parts[2]]
                .joined(separator: ".")
        )
        var mismatchedSeal = parts[2]
        let replacement = mismatchedSeal.first == "0" ? "1" : "0"
        mismatchedSeal.replaceSubrange(
            mismatchedSeal.startIndex...mismatchedSeal.startIndex,
            with: replacement
        )
        expectSweepContinuationRefusal(
            .sealMismatch,
            token: [parts[0], parts[1], mismatchedSeal].joined(separator: ".")
        )
        var nonCanonicalPayload = Data([0x20])
        nonCanonicalPayload.append(try sweepTokenPayload(token))
        expectSweepContinuationRefusal(
            .nonCanonical,
            token: sealedSweepToken(prefix: parts[0], payload: nonCanonicalPayload)
        )
        expectSweepContinuationRefusal(
            .unsupportedVersion,
            token: try resealedSweepToken(token) {
                $0["schemaVersion"] = 2
            }
        )
        expectSweepContinuationRefusal(
            .malformed,
            token: try resealedSweepToken(token) {
                $0["batchSize"] = "01"
            }
        )

        let baseline = try await ledger.verifyIntegrity()
        do {
            _ = try await ledger.sweepRetentionReviewDue(
                expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
                batchSize: 2,
                continuation: continuation,
                admission: admission
            )
            Issue.record("Continuation batch substitution must fail.")
        } catch let error as IncidentLedgerErrorV1 {
            guard case .invalidInput = error else {
                Issue.record("Expected invalidInput, received \(error).")
                return
            }
        }
        do {
            _ = try await ledger.sweepRetentionReviewDue(
                expectedRetentionPolicyDigest: ledgerDigest("substituted-policy"),
                batchSize: 1,
                continuation: continuation,
                admission: admission
            )
            Issue.record("Continuation policy substitution must fail.")
        } catch let error as IncidentLedgerErrorV1 {
            #expect(error == .retentionPolicyMismatch)
        }
        let substitutedScopeToken = try IncidentRetentionSweepContinuationV1(
            sealedToken: resealedSweepToken(token) {
                $0["projectDigest"] = ledgerDigest("substituted-project")
            }
        )
        do {
            _ = try await ledger.sweepRetentionReviewDue(
                expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
                batchSize: 1,
                continuation: substitutedScopeToken,
                admission: admission
            )
            Issue.record("Continuation scope substitution must fail.")
        } catch let error as IncidentLedgerErrorV1 {
            guard case .invalidInput = error else {
                Issue.record("Expected invalidInput, received \(error).")
                return
            }
        }
        let missingAnchorToken = try IncidentRetentionSweepContinuationV1(
            sealedToken: resealedSweepToken(token) {
                $0["lastRetentionReviewAtMilliseconds"] = "20000"
                $0["lastObservationOrdinal"] = String(middle.ordinal)
            }
        )
        await expectIntegrityRefusal {
            _ = try await ledger.sweepRetentionReviewDue(
                expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
                batchSize: 1,
                continuation: missingAnchorToken,
                admission: admission
            )
        }
        #expect(try await ledger.verifyIntegrity() == baseline)

        _ = try await ledger.tombstone(
            selection: last.selection,
            reason: .retentionReviewDue,
            expectedRetentionPolicyDigest: scope.retentionPolicyDigest
        )
        let afterLastTombstone = try await ledger.verifyIntegrity()
        let skippedPrefixToken = try IncidentRetentionSweepContinuationV1(
            sealedToken: resealedSweepToken(token) {
                $0["lastRetentionReviewAtMilliseconds"] = "30000"
                $0["lastObservationOrdinal"] = String(last.ordinal)
            }
        )
        await expectIntegrityRefusal {
            _ = try await ledger.sweepRetentionReviewDue(
                expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
                batchSize: 1,
                continuation: skippedPrefixToken,
                admission: admission
            )
        }
        #expect(try await ledger.verifyIntegrity() == afterLastTombstone)

        let otherRoot = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: otherRoot) }
        let otherLedger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: otherRoot,
            scope: scope,
            clock: { ledgerDate(milliseconds: 40_000) }
        ) { _ in }
        let otherBefore = try await otherLedger.verifyIntegrity()
        let otherAdmission = try #require(
            IncidentLifecycleMutationControlV1().issueAdmission()
        )
        do {
            _ = try await otherLedger.sweepRetentionReviewDue(
                expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
                batchSize: 1,
                continuation: continuation,
                admission: otherAdmission
            )
            Issue.record("Continuation database identity substitution must fail.")
        } catch let error as IncidentLedgerErrorV1 {
            guard case .invalidInput = error else {
                Issue.record("Expected invalidInput, received \(error).")
                return
            }
        }
        #expect(try await otherLedger.verifyIntegrity() == otherBefore)
        try await otherLedger.close()
        try await ledger.close()
    }

    @Test("Retention sweep capacity and every insert prefix roll back atomically")
    func retentionSweepCapacityAndInsertRollback() async throws {
        do {
            let root = try makeLedgerRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let scope = ledgerScope(project: "retention-sweep-capacity")
            let insertProbe = SweepInsertProbe()
            let ledger = try await LocalIncidentLedgerV1.openForTesting(
                rootDirectory: root,
                scope: scope,
                eventCapacity: 3,
                clock: { ledgerDate(milliseconds: 40_000) },
                faultInjector: insertProbe.inject
            )
            var observations: [IncidentSummaryV1] = []
            for index in 1...3 {
                observations.append(try await appendSweepObservation(
                    to: ledger,
                    label: "capacity-\(index)",
                    reviewAtMilliseconds: Int64(index * 10_000)
                ))
            }
            let beforeVerification = try await ledger.verifyIntegrity()
            let beforeList = try await ledger.list(includeTombstoned: true)
            let admission = try #require(
                IncidentLifecycleMutationControlV1().issueAdmission()
            )
            do {
                _ = try await ledger.sweepRetentionReviewDue(
                    expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
                    batchSize: 3,
                    admission: admission
                )
                Issue.record("A sweep that cannot fit every new tombstone must fail.")
            } catch let error as IncidentLedgerErrorV1 {
                #expect(error == .capacityExceeded)
            }
            #expect(insertProbe.callCount == 0)
            #expect(try await ledger.verifyIntegrity() == beforeVerification)
            #expect(try await ledger.list(includeTombstoned: true) == beforeList)
            for observation in observations {
                #expect(
                    try await ledger.inspect(selection: observation.selection).lifecycleState
                        == .active
                )
            }
            try await ledger.close()
        }

        for failAt in 1...3 {
            let root = try makeLedgerRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let scope = ledgerScope(project: "retention-sweep-insert-rollback-\(failAt)")
            let fault = NthSweepInsertFault(failAt: failAt)
            let ledger = try await LocalIncidentLedgerV1.openForTesting(
                rootDirectory: root,
                scope: scope,
                eventCapacity: 6,
                clock: { ledgerDate(milliseconds: 40_000) },
                faultInjector: fault.inject
            )
            var observations: [IncidentSummaryV1] = []
            for index in 1...3 {
                observations.append(try await appendSweepObservation(
                    to: ledger,
                    label: "insert-rollback-\(failAt)-\(index)",
                    reviewAtMilliseconds: Int64(index * 10_000)
                ))
            }
            let beforeVerification = try await ledger.verifyIntegrity()
            let beforeList = try await ledger.list(includeTombstoned: true)
            let admission = try #require(
                IncidentLifecycleMutationControlV1().issueAdmission()
            )
            do {
                _ = try await ledger.sweepRetentionReviewDue(
                    expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
                    batchSize: 3,
                    admission: admission
                )
                Issue.record("Injected sweep insert failure \(failAt) must escape.")
            } catch let error as IncidentLedgerErrorV1 {
                #expect(error == .integrity("INJECTED_SWEEP_INSERT_FAILURE_\(failAt)"))
            }
            #expect(try await ledger.verifyIntegrity() == beforeVerification)
            #expect(try await ledger.list(includeTombstoned: true) == beforeList)
            for observation in observations {
                #expect(
                    try await ledger.inspect(selection: observation.selection).lifecycleState
                        == .active
                )
            }
            try await ledger.close()
        }
    }

    @Test("Retention sweep commit fault, admission revocation, and cancellation roll back")
    func retentionSweepCommitRevocationIsAtomic() async throws {
        do {
            let root = try makeLedgerRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let scope = ledgerScope(project: "retention-sweep-stale-admission")
            let ledger = try await LocalIncidentLedgerV1.openForTesting(
                rootDirectory: root,
                scope: scope,
                eventCapacity: 4,
                clock: { ledgerDate(milliseconds: 40_000) }
            ) { _ in }
            let observation = try await appendSweepObservation(
                to: ledger,
                label: "stale-admission",
                reviewAtMilliseconds: 10_000
            )
            let beforeVerification = try await ledger.verifyIntegrity()
            let beforeList = try await ledger.list(includeTombstoned: true)
            let control = IncidentLifecycleMutationControlV1()
            let admission = try #require(control.issueAdmission())
            control.invalidatePendingMutations()
            do {
                _ = try await ledger.sweepRetentionReviewDue(
                    expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
                    batchSize: 1,
                    admission: admission
                )
                Issue.record("A stale lifecycle admission must be refused before mutation.")
            } catch let error as IncidentLedgerErrorV1 {
                #expect(error == .admissionRevoked)
            }
            #expect(try await ledger.verifyIntegrity() == beforeVerification)
            #expect(try await ledger.list(includeTombstoned: true) == beforeList)
            #expect(
                try await ledger.inspect(selection: observation.selection).lifecycleState
                    == .active
            )
            try await ledger.close()
        }

        do {
            let root = try makeLedgerRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let scope = ledgerScope(project: "retention-sweep-commit-fault")
            let ledger = try await LocalIncidentLedgerV1.openForTesting(
                rootDirectory: root,
                scope: scope,
                eventCapacity: 4,
                clock: { ledgerDate(milliseconds: 40_000) }
            ) { point in
                guard point == .beforeTombstoneCommit else { return }
                throw IncidentLedgerErrorV1.integrity("INJECTED_SWEEP_COMMIT_FAILURE")
            }
            var observations: [IncidentSummaryV1] = []
            for index in 1...2 {
                observations.append(try await appendSweepObservation(
                    to: ledger,
                    label: "commit-fault-\(index)",
                    reviewAtMilliseconds: Int64(index * 10_000)
                ))
            }
            let beforeVerification = try await ledger.verifyIntegrity()
            let beforeList = try await ledger.list(includeTombstoned: true)
            let admission = try #require(
                IncidentLifecycleMutationControlV1().issueAdmission()
            )
            do {
                _ = try await ledger.sweepRetentionReviewDue(
                    expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
                    batchSize: 2,
                    admission: admission
                )
                Issue.record("Injected sweep commit failure must escape.")
            } catch let error as IncidentLedgerErrorV1 {
                #expect(error == .integrity("INJECTED_SWEEP_COMMIT_FAILURE"))
            }
            #expect(try await ledger.verifyIntegrity() == beforeVerification)
            #expect(try await ledger.list(includeTombstoned: true) == beforeList)
            for observation in observations {
                #expect(
                    try await ledger.inspect(selection: observation.selection).lifecycleState
                        == .active
                )
            }
            try await ledger.close()
        }

        enum Revocation: CustomStringConvertible {
            case lifecycle
            case cancellation

            var description: String {
                switch self {
                case .lifecycle: "lifecycle"
                case .cancellation: "cancellation"
                }
            }
        }

        for revocation in [Revocation.lifecycle, .cancellation] {
            let root = try makeLedgerRoot()
            var retainRootForLiveTask = false
            defer {
                if !retainRootForLiveTask {
                    try? FileManager.default.removeItem(at: root)
                }
            }
            let scope = ledgerScope(project: "retention-sweep-revocation-\(revocation)")
            let gate = TombstoneCommitGate()
            let ledger = try await LocalIncidentLedgerV1.openForTesting(
                rootDirectory: root,
                scope: scope,
                eventCapacity: 4,
                clock: { ledgerDate(milliseconds: 40_000) },
                faultInjector: gate.inject
            )
            var observations: [IncidentSummaryV1] = []
            for index in 1...2 {
                observations.append(try await appendSweepObservation(
                    to: ledger,
                    label: "revocation-\(revocation)-\(index)",
                    reviewAtMilliseconds: Int64(index * 10_000)
                ))
            }
            let beforeVerification = try await ledger.verifyIntegrity()
            let beforeList = try await ledger.list(includeTombstoned: true)
            let control = IncidentLifecycleMutationControlV1()
            let admission = try #require(control.issueAdmission())
            let completion = LedgerCompletionSignal()
            let mutation = Task {
                defer { completion.signal() }
                return try await ledger.sweepRetentionReviewDue(
                    expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
                    batchSize: 2,
                    admission: admission
                )
            }
            let reachedCommit = await Task.detached {
                gate.waitUntilEntered()
            }.value
            if !reachedCommit {
                mutation.cancel()
                gate.release.signal()
            }
            #expect(reachedCommit)
            switch revocation {
            case .lifecycle:
                control.invalidatePendingMutations()
            case .cancellation:
                mutation.cancel()
            }
            gate.release.signal()
            let settled = await Task.detached {
                completion.wait()
            }.value
            #expect(settled)
            if !settled {
                mutation.cancel()
                gate.release.signal()
                let drained = await Task.detached {
                    completion.wait()
                }.value
                #expect(drained)
                if drained {
                    _ = await mutation.result
                    try? await ledger.close()
                } else {
                    retainRootForLiveTask = true
                }
                return
            }
            do {
                _ = try await mutation.value
                Issue.record("A revoked retention sweep must roll back before COMMIT.")
            } catch let error as IncidentLedgerErrorV1 {
                #expect(revocation.description == Revocation.lifecycle.description)
                #expect(error == .admissionRevoked)
            } catch is CancellationError {
                #expect(revocation.description == Revocation.cancellation.description)
            }
            #expect(try await ledger.verifyIntegrity() == beforeVerification)
            #expect(try await ledger.list(includeTombstoned: true) == beforeList)
            for observation in observations {
                #expect(
                    try await ledger.inspect(selection: observation.selection).lifecycleState
                        == .active
                )
            }
            try await ledger.close()
        }
    }

    @Test("Retention first-open coordination is nonblocking and adds no inventory file")
    func retentionSweepFirstOpenCoordinationInventory() async throws {
        let root = try makeLedgerRoot()
        var retainRootForLiveTask = false
        defer {
            if !retainRootForLiveTask {
                try? FileManager.default.removeItem(at: root)
            }
        }
        let scope = ledgerScope(project: "retention-sweep-first-open-coordination")
        let gate = FirstOpenInitializationGate()
        let projectDirectory = root
            .appendingPathComponent("projects", isDirectory: true)
            .appendingPathComponent(scope.projectDigest, isDirectory: true)
        let admittedInventory = Set([
            "incident-ledger-v1.sqlite3",
            "incident-ledger-v1.sqlite3-wal",
            "incident-ledger-v1.sqlite3-shm",
        ])

        let firstCompletion = LedgerCompletionSignal()
        let firstOpen = Task { () -> Bool in
            defer { firstCompletion.signal() }
            do {
                let unexpected = try await LocalIncidentLedgerV1.openForTesting(
                    rootDirectory: root,
                    scope: scope,
                    faultInjector: gate.inject
                )
                try await unexpected.close()
                return false
            } catch let error as IncidentLedgerErrorV1 {
                return error == .integrity("INJECTED_FIRST_OPEN_FAILURE")
            } catch {
                return false
            }
        }
        defer { gate.release.signal() }
        let reachedInitialization = await Task.detached {
            gate.waitUntilEntered()
        }.value
        if !reachedInitialization {
            firstOpen.cancel()
            gate.release.signal()
            let drained = await Task.detached {
                firstCompletion.wait()
            }.value
            #expect(drained)
            if drained {
                _ = await firstOpen.value
            } else {
                retainRootForLiveTask = true
            }
        }
        #expect(reachedInitialization)
        guard reachedInitialization else { return }

        let blockedInventory = Set(
            try FileManager.default.contentsOfDirectory(atPath: projectDirectory.path)
        )
        #expect(blockedInventory.contains("incident-ledger-v1.sqlite3"))
        #expect(blockedInventory.isSubset(of: admittedInventory))
        #expect(blockedInventory.allSatisfy { !$0.lowercased().contains("lock") })

        let secondCompletion = LedgerCompletionSignal()
        let secondOpen = Task { () -> IncidentLedgerErrorV1? in
            defer { secondCompletion.signal() }
            do {
                let unexpected = try await LocalIncidentLedgerV1.open(
                    rootDirectory: root,
                    scope: scope
                )
                try await unexpected.close()
                return nil
            } catch let error as IncidentLedgerErrorV1 {
                return error
            } catch {
                return nil
            }
        }
        let secondWasNonblocking = await Task.detached {
            secondCompletion.wait()
        }.value
        if !secondWasNonblocking {
            secondOpen.cancel()
            gate.release.signal()
            firstOpen.cancel()
            let secondDrain = Task.detached {
                secondCompletion.wait()
            }
            let firstDrain = Task.detached {
                firstCompletion.wait()
            }
            let secondDrained = await secondDrain.value
            let firstDrained = await firstDrain.value
            #expect(secondDrained)
            #expect(firstDrained)
            if secondDrained { _ = await secondOpen.value }
            if firstDrained { _ = await firstOpen.value }
            if !secondDrained || !firstDrained {
                retainRootForLiveTask = true
            }
        }
        #expect(secondWasNonblocking)
        guard secondWasNonblocking else { return }
        #expect(await secondOpen.value == .integrity(
            "Another conforming process is opening this project ledger."
        ))

        gate.release.signal()
        let firstSettled = await Task.detached {
            firstCompletion.wait()
        }.value
        #expect(firstSettled)
        if !firstSettled {
            firstOpen.cancel()
            gate.release.signal()
            let drained = await Task.detached {
                firstCompletion.wait()
            }.value
            #expect(drained)
            if drained {
                _ = await firstOpen.value
            } else {
                retainRootForLiveTask = true
            }
            return
        }
        #expect(await firstOpen.value)
        let failedInventory = Set(
            try FileManager.default.contentsOfDirectory(atPath: projectDirectory.path)
        )
        #expect(failedInventory.isEmpty)

        let reopened = try await LocalIncidentLedgerV1.open(
            rootDirectory: root,
            scope: scope
        )
        #expect(try await reopened.verifyIntegrity().eventCount == 0)
        let reopenedInventory = Set(
            try FileManager.default.contentsOfDirectory(atPath: projectDirectory.path)
        )
        #expect(reopenedInventory.contains("incident-ledger-v1.sqlite3"))
        #expect(reopenedInventory.isSubset(of: admittedInventory))
        #expect(reopenedInventory.allSatisfy { !$0.lowercased().contains("lock") })
        try await reopened.close()
    }

    @Test("Deleted tombstone row is detected by the unified global head")
    func deletedTombstoneRefused() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "deleted-tombstone")
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { Date(timeIntervalSince1970: 1_900_000_000) }
        ) { _ in }
        guard case let .appended(summary) = try await ledger.record(ledgerObservation(
            incidentID: "incident/\(ledgerDigest("deleted-tombstone"))",
            observationKey: "deleted-tombstone-observation"
        )) else {
            Issue.record("Deleted-tombstone fixture must append.")
            return
        }
        _ = try await ledger.tombstone(
            selection: summary.selection,
            reason: .userRequested,
            expectedRetentionPolicyDigest: scope.retentionPolicyDigest
        )
        let databaseURL = ledger.databaseURL
        try await ledger.close()
        try mutateSQLite(databaseURL, sql: "DELETE FROM incident_tombstones;")
        await expectIntegrityRefusal {
            _ = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        }
    }

    @Test("Current-path replacement refuses every ledger read surface")
    func currentPathReplacementRefusesReadSurfaces() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "replacement-read-surfaces")
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        guard case let .appended(summary) = try await ledger.record(ledgerObservation()) else {
            Issue.record("Replacement fixture must append."); return
        }
        let paths = try replacePrimaryWithByteIdenticalCopy(at: ledger.databaseURL)
        defer { try? restorePrimary(original: paths.original, replacement: paths.replacement) }
        let installedSnapshot = try ledgerTestDirectorySnapshot(
            ledger.databaseURL.deletingLastPathComponent()
        )
        await expectIntegrityRefusal { _ = try await ledger.list() }
        await expectIntegrityRefusal { _ = try await ledger.inspect(selection: summary.selection) }
        await expectIntegrityRefusal { _ = try await ledger.redactedExport(selection: summary.selection) }
        await expectIntegrityRefusal { _ = try await ledger.verifyIntegrity() }
        await expectIntegrityRefusal {
            _ = try await ledger.record(ledgerObservation(
                incidentID: "incident/\(ledgerDigest("replacement-entry-record"))",
                observationKey: "replacement-entry-record-observation"
            ))
        }
        await expectIntegrityRefusal {
            _ = try await ledger.tombstone(
                selection: summary.selection,
                reason: .userRequested,
                expectedRetentionPolicyDigest: scope.retentionPolicyDigest
            )
        }
        #expect(
            try ledgerTestDirectorySnapshot(
                ledger.databaseURL.deletingLastPathComponent()
            ) == installedSnapshot
        )
        try restorePrimary(original: paths.original, replacement: paths.replacement)
        await expectIntegrityRefusal { try await ledger.close() }
    }

    @Test("Byte-identical primary replacement still refuses by file identity")
    func byteIdenticalReplacementStillRefuses() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "replacement-byte-identical")
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        _ = try await ledger.record(ledgerObservation())
        let originalIdentity = try ledgerTestPathIdentity(ledger.databaseURL)
        let paths = try replacePrimaryWithByteIdenticalCopy(at: ledger.databaseURL)
        defer { try? restorePrimary(original: paths.original, replacement: paths.replacement) }

        #expect(try Data(contentsOf: paths.original) == Data(contentsOf: paths.replacement))
        let replacementStatus = try ledgerTestPathStatus(paths.replacement)
        #expect(replacementStatus.identity != originalIdentity)
        #expect(replacementStatus.fileType == mode_t(0o100000))
        #expect(replacementStatus.permissions == mode_t(0o600))
        #expect(replacementStatus.owner == geteuid())
        #expect(replacementStatus.linkCount == 1)
        await expectIntegrityRefusal { _ = try await ledger.list() }

        try restorePrimary(original: paths.original, replacement: paths.replacement)
        await expectIntegrityRefusal { try await ledger.close() }
    }

    @Test("Close observes a newly installed replacement and leaves it unchanged")
    func closeRefusesNewReplacementWithoutCheckpointing() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "replacement-close-direct")
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        _ = try await ledger.record(ledgerObservation())
        let before = try await ledger.verifyIntegrity()
        let paths = try replacePrimaryWithByteIdenticalCopy(at: ledger.databaseURL)
        defer { try? restorePrimary(original: paths.original, replacement: paths.replacement) }
        let replacementSnapshot = try ledgerTestDirectorySnapshot(
            ledger.databaseURL.deletingLastPathComponent()
        )

        await expectIntegrityRefusal { try await ledger.close() }
        await expectClosedRefusal { _ = try await ledger.verifyIntegrity() }
        #expect(
            try ledgerTestDirectorySnapshot(
                ledger.databaseURL.deletingLastPathComponent()
            ) == replacementSnapshot
        )

        try restorePrimary(original: paths.original, replacement: paths.replacement)
        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == before)
        try await reopened.close()
    }

    @Test("Close after a latched replacement leaves the installed fixture unchanged")
    func closeAfterLatchedReplacementDoesNotCheckpoint() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "replacement-close-latched")
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        _ = try await ledger.record(ledgerObservation())
        let before = try await ledger.verifyIntegrity()
        let paths = try replacePrimaryWithByteIdenticalCopy(at: ledger.databaseURL)
        defer { try? restorePrimary(original: paths.original, replacement: paths.replacement) }
        await expectIntegrityRefusal { _ = try await ledger.list() }
        let replacementSnapshot = try ledgerTestDirectorySnapshot(
            ledger.databaseURL.deletingLastPathComponent()
        )

        await expectIntegrityRefusal { try await ledger.close() }
        await expectClosedRefusal { _ = try await ledger.verifyIntegrity() }
        #expect(
            try ledgerTestDirectorySnapshot(
                ledger.databaseURL.deletingLastPathComponent()
            ) == replacementSnapshot
        )

        try restorePrimary(original: paths.original, replacement: paths.replacement)
        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == before)
        try await reopened.close()
    }

    @Test("Clean close checkpoints committed WAL state into the primary database")
    func cleanCloseCheckpointsCommittedState() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "clean-close-checkpoint")
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        guard case let .appended(summary) = try await ledger.record(ledgerObservation(
            incidentID: "incident/\(ledgerDigest("clean-close-checkpoint"))",
            observationKey: "clean-close-checkpoint-observation"
        )) else {
            Issue.record("Clean-close checkpoint fixture must append.")
            return
        }
        let before = try await ledger.verifyIntegrity()
        let databaseURL = ledger.databaseURL
        let walURL = URL(fileURLWithPath: databaseURL.path + "-wal")
        let shmURL = URL(fileURLWithPath: databaseURL.path + "-shm")
        #expect(FileManager.default.fileExists(atPath: walURL.path))

        try await ledger.close()
        if FileManager.default.fileExists(atPath: walURL.path) {
            try FileManager.default.removeItem(at: walURL)
        }
        if FileManager.default.fileExists(atPath: shmURL.path) {
            try FileManager.default.removeItem(at: shmURL)
        }

        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == before)
        #expect(try await reopened.inspect(selection: summary.selection).summary == summary)
        try await reopened.close()
    }

    @Test("Current-path replacement rolls back an observation before COMMIT")
    func currentPathReplacementRollsBackRecordBeforeCommit() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "replacement-record-rollback")
        let fault = LedgerPrimaryReplacementFault(
            trigger: .afterEventInsertBeforeMetadataUpdate
        )
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            faultInjector: fault.inject
        )
        fault.configure(databaseURL: ledger.databaseURL)
        let before = try await ledger.verifyIntegrity()
        let beforeList = try await ledger.list(includeTombstoned: true)
        fault.arm()
        defer { try? fault.restore() }

        await expectIntegrityRefusal {
            _ = try await ledger.record(ledgerObservation(
                incidentID: "incident/\(ledgerDigest("replacement-record"))",
                observationKey: "replacement-record-observation"
            ))
        }
        #expect(try fault.installedFixtureIsUnchanged())
        try fault.restore()
        await expectIntegrityRefusal { try await ledger.close() }
        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == before)
        #expect(try await reopened.list(includeTombstoned: true) == beforeList)
        try await reopened.close()
    }

    @Test("Current-path replacement rolls back a tombstone before COMMIT")
    func currentPathReplacementRollsBackTombstoneBeforeCommit() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "replacement-tombstone-rollback")
        let fault = LedgerPrimaryReplacementFault(trigger: .beforeTombstoneCommit)
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root,
            scope: scope,
            clock: { Date(timeIntervalSince1970: 1_900_000_000) },
            faultInjector: fault.inject
        )
        fault.configure(databaseURL: ledger.databaseURL)
        guard case let .appended(summary) = try await ledger.record(ledgerObservation(
            incidentID: "incident/\(ledgerDigest("replacement-tombstone"))",
            observationKey: "replacement-tombstone-observation"
        )) else {
            Issue.record("Replacement tombstone fixture must append.")
            return
        }
        let before = try await ledger.verifyIntegrity()
        fault.arm()
        defer { try? fault.restore() }

        await expectIntegrityRefusal {
            _ = try await ledger.tombstone(
                selection: summary.selection,
                reason: .userRequested,
                expectedRetentionPolicyDigest: scope.retentionPolicyDigest
            )
        }
        #expect(try fault.installedFixtureIsUnchanged())
        try fault.restore()
        await expectIntegrityRefusal { try await ledger.close() }
        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == before)
        #expect(
            try await reopened.inspect(selection: summary.selection).lifecycleState == .active
        )
        try await reopened.close()
    }

    @Test("Project-directory replacement refuses without mutating the replacement")
    func projectDirectoryReplacementRefusesWithoutMutation() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "replacement-project-directory")
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        _ = try await ledger.record(ledgerObservation())
        let project = ledger.databaseURL.deletingLastPathComponent()
        let originalIdentity = try ledgerTestPathIdentity(project)
        let original = URL(
            fileURLWithPath: project.path + ".original-\(UUID().uuidString)"
        )
        try FileManager.default.moveItem(at: project, to: original)
        defer {
            if FileManager.default.fileExists(atPath: original.path) {
                try? FileManager.default.removeItem(at: project)
                try? FileManager.default.moveItem(at: original, to: project)
            }
        }
        try FileManager.default.copyItem(at: original, to: project)
        let replacementStatus = try ledgerTestPathStatus(project)
        #expect(replacementStatus.identity != originalIdentity)
        #expect(replacementStatus.fileType == mode_t(0o040000))
        #expect(replacementStatus.permissions == mode_t(0o700))
        #expect(replacementStatus.owner == geteuid())
        let replacementSnapshot = try ledgerTestDirectorySnapshot(project)
        await expectIntegrityRefusal { _ = try await ledger.list() }
        #expect(try ledgerTestDirectorySnapshot(project) == replacementSnapshot)
        try FileManager.default.removeItem(at: project)
        try FileManager.default.moveItem(at: original, to: project)
        await expectIntegrityRefusal { try await ledger.close() }
    }

    @Test("Retention continuation refuses replacement between pages and preserves page one")
    func retentionContinuationRefusesReplacementBetweenPages() async throws {
        let root = try makeLedgerRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let scope = ledgerScope(project: "replacement-retention-continuation")
        let ledger = try await LocalIncidentLedgerV1.openForTesting(
            rootDirectory: root, scope: scope,
            clock: { Date(timeIntervalSince1970: 2_000_000) }, faultInjector: { _ in }
        )
        let firstObservation = try await appendSweepObservation(
            to: ledger,
            label: "one",
            reviewAtMilliseconds: 1_500,
            observedAtMilliseconds: 1_000
        )
        let secondObservation = try await appendSweepObservation(
            to: ledger,
            label: "two",
            reviewAtMilliseconds: 2_000
        )
        let control = IncidentLifecycleMutationControlV1()
        let admission = try #require(control.issueAdmission())
        let first = try await ledger.sweepRetentionReviewDue(
            expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
            batchSize: 1, admission: admission
        )
        let continuation = try #require(first.continuation)
        let afterFirstPage = try await ledger.verifyIntegrity()
        let paths = try replacePrimaryWithByteIdenticalCopy(at: ledger.databaseURL)
        defer { try? restorePrimary(original: paths.original, replacement: paths.replacement) }
        await expectIntegrityRefusal {
            _ = try await ledger.sweepRetentionReviewDue(
                expectedRetentionPolicyDigest: scope.retentionPolicyDigest,
                batchSize: 1, continuation: continuation, admission: admission
            )
        }
        try restorePrimary(original: paths.original, replacement: paths.replacement)
        await expectIntegrityRefusal { try await ledger.close() }
        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == afterFirstPage)
        #expect(afterFirstPage.eventCount == 3)
        #expect(
            try await reopened.inspect(selection: firstObservation.selection).lifecycleState
                == .tombstoned
        )
        #expect(
            try await reopened.inspect(selection: secondObservation.selection).lifecycleState
                == .active
        )
        try await reopened.close()
    }

    @Test(
        "Abrupt helper termination preserves only complete observation transactions",
        arguments: IncidentLedgerAbruptProcessPointV1.allCases
    )
    func abruptProcessRestartFalsification(
        point: IncidentLedgerAbruptProcessPointV1
    ) async throws {
        let probeExecutable = try validatedAbruptRestartProbeExecutable()
        let candidate = abruptRestartCandidateObservation()

        for repetition in 0..<2 {
            let root = try makeLedgerRoot()
            defer { try? FileManager.default.removeItem(at: root) }
            let scope = abruptRestartScope(
                project: "abrupt-restart-\(point.rawValue)-\(repetition)"
            )
            let ledger = try await LocalIncidentLedgerV1.open(
                rootDirectory: root,
                scope: scope
            )
            guard case let .appended(baselineSummary) = try await ledger.record(
                ledgerObservation(
                    incidentID: "incident/\(ledgerDigest("abrupt-baseline-\(repetition)"))",
                    observationKey: "abrupt-baseline-\(repetition)",
                    subject: "abrupt-baseline-subject-\(repetition)",
                    evidence: "abrupt-baseline-evidence-\(repetition)"
                )
            ) else {
                Issue.record("The abrupt-restart baseline observation did not append.")
                return
            }
            let baselineVerification = try await ledger.verifyIntegrity()
            let baselineList = try await ledger.list(includeTombstoned: true)
            #expect(baselineVerification.eventCount == 1)
            #expect(baselineList == [baselineSummary])
            expectNonAuthorizingIncidentSummary(baselineSummary)
            try await ledger.close()

            try runAbruptRestartProbe(
                executableURL: probeExecutable,
                root: root,
                scope: scope,
                point: point
            )

            let reopened = try await LocalIncidentLedgerV1.open(
                rootDirectory: root,
                scope: scope
            )
            let recoveredVerification = try await reopened.verifyIntegrity()
            let recoveredList = try await reopened.list(includeTombstoned: true)
            for summary in recoveredList {
                expectNonAuthorizingIncidentSummary(summary)
            }

            switch point {
            case .beforeObservationBegin,
                 .afterObservationBeginBeforeWrite,
                 .beforeObservationCommit:
                #expect(recoveredVerification == baselineVerification)
                #expect(recoveredList == baselineList)
                #expect(recoveredList.allSatisfy { $0.incidentID != candidate.incidentID })

            case .afterObservationCommitBeforeReturn:
                #expect(recoveredVerification.eventCount == 2)
                #expect(recoveredVerification.observationCount == 2)
                #expect(recoveredVerification.tombstoneCount == 0)
                #expect(recoveredVerification.authorizing == false)
                #expect(recoveredVerification.protectedAuthorityVerified == false)
                #expect(recoveredVerification.rawContentStored == false)
                #expect(recoveredList.map(\.ordinal).sorted() == [1, 2])
                #expect(recoveredList.contains(baselineSummary))
                let committedSummary = try #require(
                    recoveredList.first { $0.incidentID == candidate.incidentID }
                )
                #expect(committedSummary.ordinal == 2)
                expectNonAuthorizingIncidentSummary(committedSummary)

                let beforeReplay = recoveredVerification
                guard case let .idempotentDuplicate(replayed) = try await reopened.record(
                    candidate
                ) else {
                    Issue.record("The recovered committed observation did not replay idempotently.")
                    return
                }
                #expect(replayed == committedSummary)
                #expect(try await reopened.verifyIntegrity() == beforeReplay)
            }
            try await reopened.close()
        }
    }
}
