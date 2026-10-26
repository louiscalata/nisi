import Darwin
import Foundation
import SQLite3
import Testing
@testable import VeritasCore

private func namespaceRoot() throws -> URL {
    let parent = ProcessInfo.processInfo.environment["VERITAS_NAMESPACE_TEST_ROOT"]
        ?? FileManager.default.temporaryDirectory.path
    let url = URL(fileURLWithPath: parent).appendingPathComponent("veritas-namespace-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    return url
}

private func namespaceScope() -> IncidentLedgerScopeV1 {
    let digest = ArtifactSnapshot.digest(Data("namespace-tests".utf8))
    return IncidentLedgerScopeV1(scopeID: "scope/veritas-private", projectDigest: digest,
        accessPolicyDigest: digest, retentionPolicyDigest: LocalIncidentLedgerV1.retentionPolicyDigest)
}

private func namespaceObservation(_ id: String) -> IncidentObservationInputV1 {
    let digest = ArtifactSnapshot.digest(Data(id.utf8))
    return IncidentObservationInputV1(incidentID: "incident/\(digest)", observationKey: digest,
        subjectIDDigest: ArtifactSnapshot.digest(Data(("subject-id/" + id).utf8)), subjectContentDigest: digest, evidenceSetDigest: digest,
        failureCodes: [.requirementMissing], symptomCodes: [.missingSection],
        observedAt: Date(timeIntervalSince1970: 1_800_000_000), retentionReviewAt: nil)
}

private func namespaceWatcher(_ root: URL, closeCall: @escaping @Sendable (Int32) -> Int32 = Darwin.close) throws -> IncidentNamespaceObserverV1 {
    var status = stat()
    try #require(lstat(root.path, &status) == 0)
    return try IncidentNamespaceObserverV1(directoryURL: root, device: status.st_dev, inode: status.st_ino, closeCall: closeCall)
}

private func expectNamespaceClosed(_ observer: IncidentNamespaceObserverV1, descriptors: [Int32]) {
    #expect(descriptors.count == 2 && Set(descriptors).count == 2 && descriptors.allSatisfy { $0 >= 0 })
    #expect(observer.descriptorsForTesting == [-1, -1])
    #expect(observer.closeResults.map(\.descriptor) == descriptors)
    #expect(observer.closeResults.map(\.role) == ["kqueue", "directory"])
    #expect(observer.closeResults.allSatisfy { $0.resultCode == 0 && $0.errorCode == nil })
}

private func expectNamespaceRefusal(_ operation: () async throws -> Void) async -> IncidentNamespaceRefusalV1? {
    do { try await operation(); Issue.record("Expected typed namespace refusal"); return nil }
    catch let error as IncidentLedgerErrorV1 {
        guard case let .namespaceObservation(reason) = error else {
            Issue.record("Wrong ledger refusal: \(error)"); return nil
        }
        return reason
    } catch { Issue.record("Wrong error: \(error)"); return nil }
}

private final class NamespaceFaultProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var fds: [Int32] = []
    private var polls = 0
    private var closed: [(Int32, Int32)] = []
    private var watcher: IncidentNamespaceObserverV1?
    var descriptors: [Int32] { lock.withLock { fds } }
    var pollCount: Int { lock.withLock { polls } }
    func store(_ value: [Int32]) { lock.withLock { fds = value } }
    func nextPoll() -> Int { lock.withLock { polls += 1; return polls } }
    func realClose(_ fd: Int32) -> Int32 {
        let result = Darwin.close(fd)
        lock.withLock { closed.append((fd, result)) }
        return result
    }
    var closedDescriptors: [Int32] { lock.withLock { closed.map(\.0) } }
    var closeResults: [Int32] { lock.withLock { closed.map(\.1) } }
    func storeWatcher(_ value: IncidentNamespaceObserverV1) { lock.withLock { watcher = value } }
    var storedWatcher: IncidentNamespaceObserverV1? { lock.withLock { watcher } }
}

private struct NamespaceChildResult {
    let pid: pid_t
    let status: Int32
    let timedOut: Bool
    let reaped: Bool
    var succeeded: Bool { reaped && !timedOut && status == 0 }
}

private enum NamespaceChildError: Error, Equatable {
    case spawn(Int32)
}

// Test-only, fixed executables, no shell and no inherited database descriptors.
// The parent never opens/closes main/WAL to copy or compare their bytes: doing
// so can disturb SQLite's process-wide POSIX advisory locks.
private func namespaceChild(_ executable: String, _ arguments: [String],
                            log: URL, timeout: Duration = .seconds(5)) throws -> NamespaceChildResult {
    try #require(["/bin/cp", "/usr/bin/cmp", "/bin/sleep", "/usr/bin/true", "/usr/bin/false"].contains(executable))
    var actions: posix_spawn_file_actions_t?
    try #require(posix_spawn_file_actions_init(&actions) == 0)
    defer { #expect(posix_spawn_file_actions_destroy(&actions) == 0) }
    var attributes: posix_spawnattr_t?
    try #require(posix_spawnattr_init(&attributes) == 0)
    defer { #expect(posix_spawnattr_destroy(&attributes) == 0) }
    try #require(posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_CLOEXEC_DEFAULT)) == 0)
    try #require(posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0) == 0)
    try #require(posix_spawn_file_actions_addopen(&actions, STDOUT_FILENO, log.path,
                                                O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600) == 0)
    try #require(posix_spawn_file_actions_adddup2(&actions, STDOUT_FILENO, STDERR_FILENO) == 0)
    let allocated = ([executable] + arguments).map { strdup($0) }
    defer { for pointer in allocated { free(pointer) } }
    try #require(allocated.allSatisfy { $0 != nil })
    var argv = allocated + [nil], env: [UnsafeMutablePointer<CChar>?] = [nil]
    var pid: pid_t = 0
    let spawnResult = argv.withUnsafeMutableBufferPointer { args in
        env.withUnsafeMutableBufferPointer { environment in
            posix_spawn(&pid, executable, &actions, &attributes, args.baseAddress!, environment.baseAddress!)
        }
    }
    guard spawnResult == 0 else { throw NamespaceChildError.spawn(spawnResult) }
    try #require(pid > 0)
    let clock = ContinuousClock(), deadline = clock.now.advanced(by: timeout)
    var status: Int32 = -1, timedOut = false, killDeadline: ContinuousClock.Instant?
    while true {
        let waited = waitpid(pid, &status, WNOHANG)
        if waited == pid { return NamespaceChildResult(pid: pid, status: status, timedOut: timedOut, reaped: true) }
        let waitError = errno
        if waited < 0 && waitError != EINTR {
            // Do not signal an unowned/reaped PID or mistake ECHILD for our own reap.
            throw IncidentLedgerErrorV1.integrity("Test child wait failed: \(waitError); custody unresolved.")
        }
        if !timedOut && clock.now >= deadline {
            timedOut = true
            let result = kill(pid, SIGKILL), code = errno
            try #require(result == 0 || code == ESRCH)
            killDeadline = clock.now.advanced(by: .seconds(2))
        }
        if let killDeadline, clock.now >= killDeadline {
            throw IncidentLedgerErrorV1.integrity("Test child did not reap after kill; retain fixture custody.")
        }
        var delay = timespec(tv_sec: 0, tv_nsec: 2_000_000)
        _ = nanosleep(&delay, nil)
    }
}

private struct NamespaceFileIdentity: Equatable {
    let device: dev_t
    let inode: ino_t
    let size: off_t
}

private func namespaceFileIdentity(_ file: URL) throws -> NamespaceFileIdentity {
    var value = stat()
    try #require(lstat(file.path, &value) == 0 && value.st_mode & S_IFMT == S_IFREG)
    try #require(value.st_uid == geteuid() && value.st_nlink == 1)
    try #require(value.st_mode & 0o7777 == 0o600)
    return NamespaceFileIdentity(device: value.st_dev, inode: value.st_ino, size: value.st_size)
}

private func namespaceSwap(_ a: URL, _ b: URL) throws {
    try #require(renameatx_np(AT_FDCWD, a.path, AT_FDCWD, b.path, UInt32(RENAME_SWAP)) == 0)
}

@Suite("Directory namespace observation", .serialized)
struct IncidentNamespaceObserverTests {
    @Test(arguments: ["success", "exit-failure", "timeout", "spawn-failure"])
    func boundedCopyChildCustody(mode: String) throws {
        let root = try namespaceRoot(), log = root.appendingPathComponent("child.log")
        if mode == "spawn-failure" {
            try Data("existing evidence".utf8).write(to: log, options: .withoutOverwriting)
            #expect(throws: NamespaceChildError.spawn(EEXIST)) { _ = try namespaceChild("/usr/bin/true", [], log: log) }
            #expect(try Data(contentsOf: log) == Data("existing evidence".utf8))
            return
        }
        let executable = mode == "timeout" ? "/bin/sleep" : mode == "exit-failure" ? "/usr/bin/false" : "/usr/bin/true"
        let result = try namespaceChild(executable, mode == "timeout" ? ["30"] : [], log: log,
                                        timeout: mode == "timeout" ? .milliseconds(20) : .seconds(5))
        #expect(result.pid > 0 && result.reaped)
        #expect(result.timedOut == (mode == "timeout"))
        #expect(result.succeeded == (mode == "success"))
        #expect(result.status == (mode == "success" ? 0 : mode == "exit-failure" ? 256 : SIGKILL))
        // waitpid itself, not a stale PID liveness probe, proved our child was reaped.
    }

    @Test(arguments: [false, true], [0, 1])
    func coherentMainWALAtGuardedClose(swap: Bool, repetition: Int) async throws {
        let root = try namespaceRoot(), scope = namespaceScope(), hook = NamespaceFaultProbe()
        let seed = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        _ = try await seed.record(namespaceObservation("seed-\(repetition)"))
        let main = seed.databaseURL, wal = URL(fileURLWithPath: main.path + "-wal")
        try await seed.close()
        // Sibling of project directory: copy creation must not itself trigger its watch.
        let copies = root.appendingPathComponent("coherent-alternates")
        try FileManager.default.createDirectory(at: copies, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let altMain = copies.appendingPathComponent("main.copy"), altWAL = copies.appendingPathComponent("wal.copy")
        let ledger = try await LocalIncidentLedgerV1.openForNamespaceObservationTesting(rootDirectory: root, scope: scope) {
            try #require(hook.nextPoll() == 1)
            if swap {
                let originalMain = try namespaceFileIdentity(main), originalWAL = try namespaceFileIdentity(wal)
                try namespaceSwap(main, altMain)
                var mainSwapped = true, walSwapped = false
                defer {
                    // Only owned synthetic fixtures; restore any partially completed swap.
                    if walSwapped { do { try namespaceSwap(wal, altWAL) } catch { Issue.record("WAL restoration failed: \(error)") } }
                    if mainSwapped { do { try namespaceSwap(main, altMain) } catch { Issue.record("Main restoration failed: \(error)") } }
                }
                try namespaceSwap(wal, altWAL); walSwapped = true
                try #require(namespaceFileIdentity(main) != originalMain)
                try #require(namespaceFileIdentity(wal) != originalWAL)
                try namespaceSwap(wal, altWAL); walSwapped = false
                try namespaceSwap(main, altMain); mainSwapped = false
                try #require(namespaceFileIdentity(main) == originalMain)
                try #require(namespaceFileIdentity(wal) == originalWAL)
            }
        }
        try await withAsyncTestCleanup(operation: {
            _ = try await ledger.record(namespaceObservation("live-wal-\(repetition)"))
            let before = try await ledger.verifyIntegrity()
            try #require(before.eventCount == 2)
            let originalMain = try namespaceFileIdentity(main), originalWAL = try namespaceFileIdentity(wal)
            try #require(originalWAL.size > 32)
            // No other actor caller and no outstanding transaction during these copies.
            // Plain cp (-X suppresses xattrs, no -c clone request) and cmp run outside parent.
            for (index, pair) in [(main, altMain), (wal, altWAL)].enumerated() {
                let copy = try namespaceChild("/bin/cp", ["-X", pair.0.path, pair.1.path], log: copies.appendingPathComponent("copy-\(index).log"))
                try #require(copy.succeeded)
                let compare = try namespaceChild("/usr/bin/cmp", ["-s", pair.0.path, pair.1.path], log: copies.appendingPathComponent("compare-\(index).log"))
                try #require(compare.succeeded)
                let source = try namespaceFileIdentity(pair.0), destination = try namespaceFileIdentity(pair.1)
                try #require(source.device == destination.device && source.inode != destination.inode && source.size == destination.size)
            }
            try #require(namespaceFileIdentity(main) == originalMain)
            try #require(namespaceFileIdentity(wal) == originalWAL)
            // Copying did not dirty the watched directory or the logical ledger.
            #expect(try await ledger.verifyIntegrity() == before)
            let observer = try #require(await ledger.namespaceObserverForTesting())
            let descriptors = observer.descriptorsForTesting
            if swap {
                let reason = try #require(await expectNamespaceRefusal { try await ledger.close() })
                guard case let .changed(mask) = reason else { Issue.record("Wrong namespace refusal"); return }
                #expect(mask & UInt32(NOTE_WRITE) != 0)
                #expect(await ledger.latestCheckpointAttemptForTesting() == nil)
                #expect(observer.refusal == reason)
                #expect(throws: reason) { try observer.poll() }
            } else {
                try await ledger.close()
                let attempt = try #require(await ledger.latestCheckpointAttemptForTesting())
                #expect(attempt.databaseName == "main" && attempt.mode == SQLITE_CHECKPOINT_FULL)
                #expect(attempt.resultCode == SQLITE_OK && !attempt.synthetic)
                #expect(attempt.logFrames >= 0 && attempt.logFrames == attempt.checkpointedFrames)
            }
            #expect(hook.pollCount == 1)
            expectNamespaceClosed(observer, descriptors: descriptors)
            do { _ = try await ledger.list(); Issue.record("Closed actor still served data") }
            catch let error as IncidentLedgerErrorV1 { if case .closed = error {} else { Issue.record("Expected closed actor, got \(error)") } }
            let refusal = observer.refusal
            try await ledger.abortForCoherentReplacementBaselineTesting()
            #expect(observer.refusal == refusal)
            let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
            try await withAsyncTestCleanup(operation: {
                #expect(try await reopened.verifyIntegrity() == before)
                #expect(try await reopened.list().count == 2)
                try await reopened.close()
            }, cleanup: { do { try await reopened.abortForCoherentReplacementBaselineTesting() } catch { Issue.record("Reopen cleanup: \(error)") } })
        }, cleanup: { do { try await ledger.abortForCoherentReplacementBaselineTesting() } catch { Issue.record("Cleanup: \(error)") } })
    }

    @Test func defaultFreshAndReopenedLedger() async throws {
        let root = try namespaceRoot()
        for index in 0..<2 {
            let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: namespaceScope())
            try await withAsyncTestCleanup(operation: {
                _ = try await ledger.record(namespaceObservation("ordinary-\(index)"))
                #expect(try await ledger.list().count == index + 1)
                #expect(try await ledger.verifyIntegrity().eventCount == Int64(index + 1))
                let observer = try #require(await ledger.namespaceObserverForTesting())
                let descriptors = observer.descriptorsForTesting
                try await ledger.close()
                #expect(observer.refusal == .stopped)
                expectNamespaceClosed(observer, descriptors: descriptors)
                let attempt = try #require(await ledger.latestCheckpointAttemptForTesting())
                #expect(attempt.resultCode == SQLITE_OK && !attempt.synthetic)
            }, cleanup: { do { try await ledger.abortForCoherentReplacementBaselineTesting() } catch { Issue.record("Cleanup: \(error)") } })
        }
    }

    @Test(arguments: ["create", "remove", "rename"])
    func externalEntryChangesRefuse(action: String) async throws {
        let root = try namespaceRoot()
        let seed = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: namespaceScope())
        let project = seed.databaseURL.deletingLastPathComponent()
        try await seed.close()
        let file = project.appendingPathComponent("sentinel")
        if action != "create" { try Data("fixture".utf8).write(to: file, options: .withoutOverwriting) }
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: namespaceScope())
        try await withAsyncTestCleanup(operation: {
            if action == "create" { try Data().write(to: file, options: .withoutOverwriting) }
            else if action == "remove" { try FileManager.default.removeItem(at: file) }
            else { try FileManager.default.moveItem(at: file, to: project.appendingPathComponent("moved")) }
            let first = await expectNamespaceRefusal { _ = try await ledger.list() }
            let second = await expectNamespaceRefusal { _ = try await ledger.verifyIntegrity() }
            #expect(first == second && first != nil)
            let close = await expectNamespaceRefusal { try await ledger.close() }
            #expect(close == first)
            #expect(await ledger.latestCheckpointAttemptForTesting() == nil)
        }, cleanup: { do { try await ledger.abortForCoherentReplacementBaselineTesting() } catch { Issue.record("Cleanup: \(error)") } })
    }

    @Test func restoredEntryABALatches() throws {
        let root = try namespaceRoot(), a = root.appendingPathComponent("a"), b = root.appendingPathComponent("b")
        try Data("a".utf8).write(to: a, options: .withoutOverwriting)
        let watcher = try namespaceWatcher(root)
        defer { #expect(watcher.stop() == nil) }
        try watcher.poll()
        try FileManager.default.moveItem(at: a, to: b)
        try FileManager.default.moveItem(at: b, to: a)
        #expect(throws: IncidentNamespaceRefusalV1.self) { try watcher.poll() }
        let first = try #require(watcher.refusal)
        guard case let .changed(mask) = first else { Issue.record("Missing change signal"); return }
        #expect(mask & UInt32(NOTE_WRITE) != 0)
        #expect(throws: first) { try watcher.poll() }
        #expect(watcher.refusal == first)
    }

    @Test func preRegistrationAndContentBlindSpots() throws {
        let root = try namespaceRoot(), file = root.appendingPathComponent("a"), moved = root.appendingPathComponent("b")
        try Data("a".utf8).write(to: file, options: .withoutOverwriting)
        try FileManager.default.moveItem(at: file, to: moved)
        try FileManager.default.moveItem(at: moved, to: file)
        let watcher = try namespaceWatcher(root)
        defer { #expect(watcher.stop() == nil) }
        try watcher.poll() // Explicitly no retroactive ABA claim.
        let handle = try FileHandle(forWritingTo: file)
        try handle.write(contentsOf: Data("changed".utf8))
        try handle.close()
        try watcher.poll() // Directory watcher does not check file contents.
    }

    @Test func changeAtFinalCloseBoundarySkipsCheckpoint() async throws {
        let root = try namespaceRoot(), scope = namespaceScope()
        let seed = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        _ = try await seed.record(namespaceObservation("close-boundary"))
        let before = try await seed.verifyIntegrity(), project = seed.databaseURL.deletingLastPathComponent()
        try await seed.close()
        let ledger = try await LocalIncidentLedgerV1.openForNamespaceObservationTesting(rootDirectory: root, scope: scope) {
            let entry = project.appendingPathComponent("transient")
            try Data().write(to: entry, options: .withoutOverwriting)
            try FileManager.default.removeItem(at: entry)
        }
        let refusal = await expectNamespaceRefusal { try await ledger.close() }
        #expect(refusal != nil)
        #expect(await ledger.latestCheckpointAttemptForTesting() == nil)
        try await ledger.abortForCoherentReplacementBaselineTesting()
        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == before)
        try await reopened.close()
    }

    @Test func checkpointFailureRetainsGuardAndActualResult() async throws {
        let root = try namespaceRoot()
        let ledger = try await LocalIncidentLedgerV1.openForCheckpointTesting(rootDirectory: root, scope: namespaceScope(),
            syntheticCheckpointOutcome: .init(resultCode: SQLITE_IOERR, logFrames: -1, checkpointedFrames: -1))
        do { try await ledger.close(); Issue.record("Expected SQLite refusal") }
        catch let error as IncidentLedgerErrorV1 { if case let .sqlite(code, _) = error { #expect(code == SQLITE_IOERR) } else { Issue.record("Wrong error") } }
        let first = try #require(await ledger.latestCheckpointAttemptForTesting())
        try Data().write(to: ledger.databaseURL.deletingLastPathComponent().appendingPathComponent("after-failure"), options: .withoutOverwriting)
        #expect(await expectNamespaceRefusal { try await ledger.close() } != nil)
        #expect(await ledger.latestCheckpointAttemptForTesting() == first)
        try await ledger.abortForCoherentReplacementBaselineTesting()
    }

    @Test func rollbackPoisonSettlesAndReopens() async throws {
        let root = try namespaceRoot(), probe = NamespaceFaultProbe()
        let ledger = try await LocalIncidentLedgerV1.openForTesting(rootDirectory: root, scope: namespaceScope()) { point in
            if point == .afterEventInsertBeforeMetadataUpdate || point == .beforeRollback {
                _ = probe.nextPoll()
                throw IncidentLedgerErrorV1.integrity("test rollback poison")
            }
        }
        do { _ = try await ledger.record(namespaceObservation("rollback")); Issue.record("Expected rollback poison") }
        catch let error as IncidentLedgerErrorV1 {
            if case let .integrity(message) = error { #expect(message == "Transaction rollback failed; the ledger was closed and must be reopened.") }
            else { Issue.record("Did not reach rollback poison: \(error)") }
        }
        #expect(probe.pollCount == 2)
        try await ledger.close()
        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: namespaceScope())
        #expect(try await reopened.verifyIntegrity().eventCount == 0)
        try await reopened.close()
    }

    @Test func stopIsLatchedAndIdempotent() throws {
        let watcher = try namespaceWatcher(namespaceRoot())
        let descriptors = watcher.descriptorsForTesting
        #expect(watcher.stop() == nil)
        #expect(throws: IncidentNamespaceRefusalV1.stopped) { try watcher.poll() }
        let probe = NamespaceFaultProbe()
        let uncertain = try namespaceWatcher(namespaceRoot(), closeCall: { fd in
            let result = probe.realClose(fd)
            if probe.closeResults.count == 1 { errno = EIO; return -1 } // Injected report, not a real OS close failure.
            return result
        })
        #expect(uncertain.stop() == .unavailable(operation: "close-observer", code: EIO))
        #expect(uncertain.stop() == nil)
        #expect(uncertain.refusal == .unavailable(operation: "close-observer", code: EIO))
        #expect(probe.closeResults == [0, 0]) // Both real closes succeeded, exactly once.
        #expect(uncertain.closeResults.map(\.resultCode) == [-1, 0])
        #expect(uncertain.closeResults.map(\.errorCode) == [EIO, nil])
        expectNamespaceClosed(watcher, descriptors: descriptors)
        #expect(watcher.stop() == nil)
        #expect(throws: IncidentNamespaceRefusalV1.stopped) { try watcher.poll() }
    }

    @Test func deinitReleasesOnlyDirectoryAndQueue() throws {
        let root = try namespaceRoot(), probe = NamespaceFaultProbe()
        var watcher: IncidentNamespaceObserverV1? = try namespaceWatcher(root, closeCall: probe.realClose)
        let descriptors = try #require(watcher?.descriptorsForTesting)
        for descriptor in descriptors { #expect(fcntl(descriptor, F_GETFD) & FD_CLOEXEC != 0) }
        var directoryStatus = stat()
        #expect(fstat(descriptors[1], &directoryStatus) == 0)
        #expect(directoryStatus.st_mode & S_IFMT == S_IFDIR)
        watcher = nil
        #expect(probe.closedDescriptors == descriptors && probe.closeResults == [0, 0])
    }

    @Test(arguments: ["missing", "file", "symlink", "identity"])
    func registrationRefusesInvalidDirectory(kind: String) throws {
        let root = try namespaceRoot(), target = root.appendingPathComponent("target")
        if kind == "file" { try Data().write(to: target, options: .withoutOverwriting) }
        if kind == "symlink" { try FileManager.default.createSymbolicLink(at: target, withDestinationURL: root) }
        #expect(throws: IncidentNamespaceRefusalV1.self) {
            _ = try IncidentNamespaceObserverV1(directoryURL: kind == "identity" ? root : target, device: 0, inode: 0)
        }
    }

    @Test(arguments: 0..<6)
    func malformedEventsRefused(variant: Int) {
        #expect(throws: IncidentNamespaceRefusalV1.malformedEvent) {
            try IncidentNamespaceObserverV1.validateEvent(ident: variant == 0 ? 9 : 8, expected: 8,
                filter: variant == 1 ? Int16(EVFILT_READ) : Int16(EVFILT_VNODE),
                flags: variant == 2 ? UInt16(EV_ERROR) : 0,
                mask: variant == 3 ? 0 : variant == 4 ? UInt32(NOTE_EXTEND) : UInt32(NOTE_WRITE),
                data: variant == 5 ? 1 : 0)
        }
    }

    @Test func typedRefusalMappingAndValidEvent() throws {
        #expect(IncidentLedgerErrorV1.namespaceObservation(.stopped).isNamespaceOrIntegrityRefusal)
        #expect(!IncidentLedgerErrorV1.sqlite(code: 10, message: "actual").isNamespaceOrIntegrityRefusal)
        try IncidentNamespaceObserverV1.validateEvent(ident: 8, expected: 8, filter: Int16(EVFILT_VNODE),
            flags: UInt16(EV_CLEAR), mask: UInt32(NOTE_WRITE), data: 0)
    }

    @Test(arguments: ["receipt", "initial-poll", "later-poll"])
    func injectedKernelFailuresPreserveCauseAndCleanup(mode: String) throws {
        let root = try namespaceRoot(), probe = NamespaceFaultProbe()
        var status = stat()
        try #require(lstat(root.path, &status) == 0)
        let call: NamespaceEventCallV1 = { queue, change, changes, event, events, timeout in
            if let change {
                probe.store([queue, Int32(change.pointee.ident)])
                let count = namespaceKevent(queue, change, changes, event, events, timeout)
                if mode == "receipt" { event?.pointee.data = Int(EIO) }
                return count
            }
            let count = probe.nextPoll()
            if mode == "initial-poll" || (mode == "later-poll" && count > 1) {
                errno = EIO
                return -1
            }
            return namespaceKevent(queue, change, changes, event, events, timeout)
        }
        let expected = IncidentNamespaceRefusalV1.unavailable(
            operation: mode == "receipt" ? "register-receipt" : "poll", code: EIO)
        if mode == "later-poll" {
            let watcher = try IncidentNamespaceObserverV1(directoryURL: root, device: status.st_dev, inode: status.st_ino, eventCall: call, closeCall: probe.realClose)
            #expect(watcher.refusal == nil)
            #expect(throws: expected) { try watcher.poll() }
            let count = probe.pollCount
            #expect(throws: expected) { try watcher.poll() }
            #expect(probe.pollCount == count) // Latched; the backend is not retried.
            #expect(watcher.stop() == nil)
            #expect(watcher.refusal == expected)
        } else {
            #expect(throws: expected) {
                _ = try IncidentNamespaceObserverV1(directoryURL: root, device: status.st_dev, inode: status.st_ino, eventCall: call, closeCall: probe.realClose)
            }
        }
        #expect(probe.descriptors.count == 2)
        #expect(probe.closedDescriptors == probe.descriptors && probe.closeResults == [0, 0])
    }

    @Test func afterCheckpointRefusalRetainsAttemptAndStopsBeforeSQLiteClose() async throws {
        let root = try namespaceRoot(), scope = namespaceScope(), probe = NamespaceFaultProbe()
        let seed = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        _ = try await seed.record(namespaceObservation("after-checkpoint"))
        let before = try await seed.verifyIntegrity(), project = seed.databaseURL.deletingLastPathComponent()
        let wal = URL(fileURLWithPath: seed.databaseURL.path + "-wal")
        try await seed.close()
        let ledger = try await LocalIncidentLedgerV1.openForNamespaceObservationTesting(rootDirectory: root, scope: scope, closeProbe: { stopped in
            if stopped {
                let watcher = try #require(probe.storedWatcher)
                expectNamespaceClosed(watcher, descriptors: probe.descriptors)
                #expect(FileManager.default.fileExists(atPath: wal.path))
            } else {
                let transient = project.appendingPathComponent("after-checkpoint")
                try Data().write(to: transient, options: .withoutOverwriting)
                try FileManager.default.removeItem(at: transient)
            }
            _ = probe.nextPoll()
        })
        let observer = try #require(await ledger.namespaceObserverForTesting())
        probe.store(observer.descriptorsForTesting)
        probe.storeWatcher(observer)
        #expect(await expectNamespaceRefusal { try await ledger.close() } != nil)
        #expect(probe.pollCount == 2)
        let attempt = try #require(await ledger.latestCheckpointAttemptForTesting())
        #expect(attempt.resultCode == SQLITE_OK && !attempt.synthetic)
        #expect(attempt.databaseName == "main" && attempt.mode == SQLITE_CHECKPOINT_FULL)
        #expect(observer.refusal != .stopped)
        try await ledger.abortForCoherentReplacementBaselineTesting()
        let reopened = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        #expect(try await reopened.verifyIntegrity() == before)
        try await reopened.close()
    }

    @Test func abortDoesNotEraseLatchedRefusal() async throws {
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: namespaceRoot(), scope: namespaceScope())
        let observer = try #require(await ledger.namespaceObserverForTesting())
        let descriptors = observer.descriptorsForTesting
        try Data().write(to: ledger.databaseURL.deletingLastPathComponent().appendingPathComponent("abort-entry"), options: .withoutOverwriting)
        let first = await expectNamespaceRefusal { _ = try await ledger.list() }
        try await ledger.abortForCoherentReplacementBaselineTesting()
        #expect(observer.refusal == first && first != nil)
        expectNamespaceClosed(observer, descriptors: descriptors)
    }

    @Test func missingRequiredObserverCannotDowngrade() async throws {
        let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: namespaceRoot(), scope: namespaceScope())
        await ledger.dropNamespaceObserverForTesting()
        #expect(await expectNamespaceRefusal { _ = try await ledger.list() }
            == .unavailable(operation: "missing-observer", code: EBADF))
        #expect(await expectNamespaceRefusal { try await ledger.close() }
            == .unavailable(operation: "missing-observer", code: EBADF))
        #expect(await ledger.latestCheckpointAttemptForTesting() == nil)
    }
}
