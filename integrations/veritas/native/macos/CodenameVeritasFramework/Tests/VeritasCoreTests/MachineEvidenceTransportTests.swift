import Darwin
import Dispatch
import Foundation
import Testing
@testable import VeritasTestEvidenceSupport

private struct EvidenceFixture {
    let root: URL
    let path: String
    let sink: MachineEvidence.Sink

    init() throws {
        root = URL(fileURLWithPath: "/private/tmp/veritas-machine-evidence-test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        path = root.appendingPathComponent("machine.log").path
        let fd = open(path, O_CREAT | O_EXCL | O_WRONLY | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw CocoaError(.fileWriteUnknown) }
        var info = stat()
        let observed = fstat(fd, &info)
        let closed = close(fd)
        guard observed == 0, closed == 0 else { throw CocoaError(.fileReadUnknown) }
        sink = MachineEvidence.Sink(path: path, device: UInt64(UInt32(bitPattern: info.st_dev)),
                                    inode: UInt64(info.st_ino))
    }

    var environment: [String: String] {
        [MachineEvidence.pathKey: path, MachineEvidence.deviceKey: String(sink.device),
         MachineEvidence.inodeKey: String(sink.inode)]
    }

    func read() throws -> Data { try Data(contentsOf: URL(fileURLWithPath: path)) }
    func cleanup() { try? FileManager.default.removeItem(at: root) }
}

@Suite("Private machine evidence transport")
struct MachineEvidenceTransportTests {
    private let frame = "VERITAS_BASELINE_A_RESULT|case=transport-control"

    @Test("Only a wholly absent sink configuration may use non-authoritative legacy output")
    func configuration() throws {
        let f = try EvidenceFixture(); defer { f.cleanup() }
        #expect(try MachineEvidence.Sink.from([:]) == nil)
        #expect(try MachineEvidence.Sink.from(f.environment)?.inode == f.sink.inode)
        var zeroDevice = f.environment; zeroDevice[MachineEvidence.deviceKey] = "0"
        #expect(try MachineEvidence.Sink.from(zeroDevice)?.device == 0)
        var bad: [[String: String]] = []
        for key in f.environment.keys { var e = f.environment; e.removeValue(forKey: key); bad.append(e) }
        for key in [MachineEvidence.deviceKey, MachineEvidence.inodeKey] {
            for value in ["", "-1", "+1", "01", "0x1", " 1", "1\n", "18446744073709551616"] {
                var e = f.environment; e[key] = value; bad.append(e)
            }
        }
        for value in ["relative", f.root.path + "/./machine.log", f.path + "\n", f.path + "\0"] {
            var e = f.environment; e[MachineEvidence.pathKey] = value; bad.append(e)
        }
        var zero = f.environment; zero[MachineEvidence.inodeKey] = "0"; bad.append(zero)
        for e in bad { #expect(throws: MachineEvidence.Failure.configuration) { try MachineEvidence.Sink.from(e) } }
        #expect(try f.read().isEmpty)
    }

    @Test("Configured delivery never copies a machine frame into the human transcript")
    func deliveryChannels() throws {
        let f = try EvidenceFixture(); defer { f.cleanup() }
        var legacy: [String] = []
        try MachineEvidence.deliver(frame, environment: [:], legacyOutput: { legacy.append($0) })
        #expect(legacy == [frame + "\n"])
        legacy = []
        try MachineEvidence.deliver(frame, environment: f.environment, legacyOutput: { legacy.append($0) })
        #expect(legacy.isEmpty)
        #expect(try f.read() == Data((frame + "\n").utf8))
        var partial = f.environment; partial.removeValue(forKey: MachineEvidence.inodeKey)
        #expect(throws: MachineEvidence.Failure.configuration) {
            try MachineEvidence.deliver(frame, environment: partial, legacyOutput: { legacy.append($0) })
        }
        #expect(legacy.isEmpty)
    }

    @Test("Bare and singly terminated frames produce the same exact bytes")
    func frameTerminators() throws {
        #expect(try MachineEvidence.bytes(for: frame) == Array((frame + "\n").utf8))
        #expect(try MachineEvidence.bytes(for: frame + "\n") == Array((frame + "\n").utf8))
        for prefix in MachineEvidence.prefixes {
            #expect(try MachineEvidence.bytes(for: prefix + "test").last == 10)
        }
        let json = "VERITAS_FI09_EVIDENCE_JSON {\"text\":\"—é\"}"
        #expect(try MachineEvidence.bytes(for: json) == Array((json + "\n").utf8))
        for control in ["\t", "\r", "\0", "\u{7f}"] {
            #expect(throws: MachineEvidence.Failure.frame) {
                try MachineEvidence.bytes(for: json + control)
            }
        }
    }

    @Test("Malformed transport frames refuse before any bytes are appended")
    func invalidFrames() throws {
        let f = try EvidenceFixture(); defer { f.cleanup() }
        for bad in ["", "\n", "prefix " + frame, frame + "\n\n", frame + "\nx", frame + "\r",
                    frame + "\0", frame + "\t", frame + "é", frame + "\u{7f}", "VERITAS_UNKNOWN|x"] {
            #expect(throws: MachineEvidence.Failure.frame) {
                try MachineEvidence.deliver(bad, environment: f.environment)
            }
        }
        #expect(throws: MachineEvidence.Failure.frame) { try MachineEvidence.append([0xff, 10], to: f.sink) }
        #expect(try f.read().isEmpty)
    }

    @Test("The exact frame byte limit is admitted and one byte over refuses")
    func frameLimit() throws {
        let f = try EvidenceFixture(); defer { f.cleanup() }
        let exact = frame + String(repeating: "x", count: MachineEvidence.maximumFrameBytes - 1 - frame.utf8.count)
        try MachineEvidence.deliver(exact, environment: f.environment)
        #expect(try f.read().count == MachineEvidence.maximumFrameBytes)
        #expect(throws: MachineEvidence.Failure.frame) { try MachineEvidence.deliver(exact + "x", environment: f.environment) }
        #expect(try f.read().count == MachineEvidence.maximumFrameBytes)
    }

    @Test("Unsafe filesystem objects refuse without opening a blocking FIFO")
    func objectSafety() throws {
        for mutation in ["mode", "link", "symlink", "directory", "fifo", "parent-symlink"] {
            let f = try EvidenceFixture(); defer { f.cleanup() }
            switch mutation {
            case "mode": #expect(chmod(f.path, 0o644) == 0)
            case "link": #expect(link(f.path, f.root.appendingPathComponent("hardlink").path) == 0)
            case "parent-symlink":
                let alias = f.root.appendingPathComponent("alias").path
                #expect(symlink(f.root.path, alias) == 0)
                let redirected = MachineEvidence.Sink(path: alias + "/machine.log", device: f.sink.device, inode: f.sink.inode)
                #expect(throws: MachineEvidence.Failure.sinkIdentity) {
                    try MachineEvidence.append(MachineEvidence.bytes(for: frame), to: redirected)
                }
                continue
            default:
                let original = f.root.appendingPathComponent("original").path
                #expect(rename(f.path, original) == 0)
                if mutation == "symlink" { #expect(symlink(original, f.path) == 0) }
                if mutation == "directory" { #expect(mkdir(f.path, 0o700) == 0) }
                if mutation == "fifo" { #expect(mkfifo(f.path, 0o600) == 0) }
            }
            #expect(throws: MachineEvidence.Failure.sinkIdentity) {
                try MachineEvidence.append(MachineEvidence.bytes(for: frame), to: f.sink)
            }
        }
    }

    @Test("Incorrect preopened identity and disappeared paths refuse")
    func boundIdentity() throws {
        let f = try EvidenceFixture(); defer { f.cleanup() }
        for wrong in [MachineEvidence.Sink(path: f.path, device: f.sink.device + 1, inode: f.sink.inode),
                      MachineEvidence.Sink(path: f.path, device: f.sink.device, inode: f.sink.inode + 1)] {
            #expect(throws: MachineEvidence.Failure.sinkIdentity) { try MachineEvidence.append(MachineEvidence.bytes(for: frame), to: wrong) }
        }
        #expect(try f.read().isEmpty)
        #expect(unlink(f.path) == 0)
        #expect(throws: MachineEvidence.Failure.sinkIdentity) { try MachineEvidence.append(MachineEvidence.bytes(for: frame), to: f.sink) }
    }

    @Test("Path substitution after append cannot report a successful transport")
    func replacedAfterWrite() throws {
        let f = try EvidenceFixture(); defer { f.cleanup() }
        let oldPath = f.root.appendingPathComponent("preserved-original").path
        var operations = MachineEvidence.Operations()
        var closed = 0
        operations.write = { fd, bytes, count in
            let result = Darwin.write(fd, bytes, count)
            #expect(rename(f.path, oldPath) == 0)
            let other = open(f.path, O_CREAT | O_EXCL | O_WRONLY, 0o600)
            #expect(other >= 0)
            if other >= 0 { #expect(close(other) == 0) }
            return result
        }
        operations.close = { closed += 1; return Darwin.close($0) }
        #expect(throws: MachineEvidence.Failure.sinkIdentity) {
            try MachineEvidence.append(MachineEvidence.bytes(for: frame), to: f.sink, operations: operations)
        }
        #expect(closed == 1)
        #expect(try f.read().isEmpty)
        #expect(try Data(contentsOf: URL(fileURLWithPath: oldPath)) == Data((frame + "\n").utf8))
    }

    @Test("A short write is retained as incomplete evidence and never retried")
    func shortWrite() throws {
        let f = try EvidenceFixture(); defer { f.cleanup() }
        var writes = 0, closes = 0
        var operations = MachineEvidence.Operations()
        operations.write = { fd, bytes, _ in writes += 1; return Darwin.write(fd, bytes, 2) }
        operations.close = { closes += 1; return Darwin.close($0) }
        #expect(throws: MachineEvidence.Failure.shortWrite) {
            try MachineEvidence.append(MachineEvidence.bytes(for: frame), to: f.sink, operations: operations)
        }
        #expect(writes == 1); #expect(closes == 1)
        #expect(try f.read() == Data("VE".utf8))
    }

    @Test("EINTR and I/O failure are explicit failed attempts with no retry")
    func writeFailures() throws {
        for code in [EINTR, EIO] {
            let f = try EvidenceFixture(); defer { f.cleanup() }
            var writes = 0, closes = 0
            var operations = MachineEvidence.Operations()
            operations.write = { _, _, _ in writes += 1; errno = code; return -1 }
            operations.close = { closes += 1; return Darwin.close($0) }
            #expect(throws: MachineEvidence.Failure.write(code)) {
                try MachineEvidence.append(MachineEvidence.bytes(for: frame), to: f.sink, operations: operations)
            }
            #expect(writes == 1); #expect(closes == 1); #expect(try f.read().isEmpty)
        }
    }

    @Test("Close failure refuses even when the complete frame was appended")
    func closeFailure() throws {
        let f = try EvidenceFixture(); defer { f.cleanup() }
        var closes = 0
        var operations = MachineEvidence.Operations()
        operations.close = { fd in closes += 1; #expect(Darwin.close(fd) == 0); errno = EIO; return -1 }
        #expect(throws: MachineEvidence.Failure.close(EIO)) {
            try MachineEvidence.append(MachineEvidence.bytes(for: frame), to: f.sink, operations: operations)
        }
        #expect(closes == 1); #expect(try f.read() == Data((frame + "\n").utf8))
    }

    @Test("Aggregate byte capacity is checked under the append lock")
    func aggregateLimit() throws {
        let f = try EvidenceFixture(); defer { f.cleanup() }
        let bytes = try MachineEvidence.bytes(for: frame)
        let fd = open(f.path, O_WRONLY)
        #expect(fd >= 0)
        #expect(ftruncate(fd, off_t(MachineEvidence.maximumFileBytes - bytes.count)) == 0)
        #expect(close(fd) == 0)
        try MachineEvidence.append(bytes, to: f.sink)
        #expect(try f.read().count == MachineEvidence.maximumFileBytes)
        #expect(throws: MachineEvidence.Failure.fileLimit) { try MachineEvidence.append(bytes, to: f.sink) }
        #expect(try f.read().count == MachineEvidence.maximumFileBytes)
    }

    @Test("An already held cooperating lock refuses within the bounded retry window")
    func heldLock() throws {
        let f = try EvidenceFixture(); defer { f.cleanup() }
        let fd = open(f.path, O_WRONLY)
        #expect(fd >= 0); defer { if fd >= 0 { _ = close(fd) } }
        #expect(flock(fd, LOCK_EX | LOCK_NB) == 0)
        let start = ContinuousClock.now
        #expect(throws: MachineEvidence.Failure.lockUnavailable) {
            try MachineEvidence.append(MachineEvidence.bytes(for: frame), to: f.sink)
        }
        #expect(start.duration(to: .now) < .seconds(4))
        #expect(try f.read().isEmpty)
    }

    @Test("Concurrent cooperating writers preserve each exact frame without interleaving")
    func concurrentWriters() async throws {
        let f = try EvidenceFixture(); defer { f.cleanup() }
        let expected = Set((0..<64).map { "VERITAS_BASELINE_A_RESULT|case=writer-\($0)|" + String(repeating: "x", count: 1_024) })
        try await withThrowingTaskGroup(of: Void.self) { group in
            for line in expected {
                group.addTask { try MachineEvidence.append(MachineEvidence.bytes(for: line), to: f.sink) }
            }
            try await group.waitForAll()
        }
        let actual = String(decoding: try f.read(), as: UTF8.self).split(separator: "\n").map(String.init)
        #expect(actual.count == 64); #expect(Set(actual) == expected)
    }
}
