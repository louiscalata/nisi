import Darwin
import Foundation

/// Private test transport only. No shipped target depends on this module.
/// It serializes cooperating writers, not a hostile same-user process, and does
/// not establish durability, chronology, protected custody, or test acceptance.
public enum MachineEvidence {
    static let maximumFrameBytes = 262_144
    static let maximumFileBytes = 4 * 1_024 * 1_024
    static let pathKey = "VERITAS_TEST_EVIDENCE_PATH"
    static let deviceKey = "VERITAS_TEST_EVIDENCE_DEVICE"
    static let inodeKey = "VERITAS_TEST_EVIDENCE_INODE"
    static let prefixes = [
        "VERITAS_BASELINE_A_RESULT|", "VERITAS_BASELINE_B_RESULT|",
        "VERITAS_CHECKPOINT_CONTROL_RESULT|", "VERITAS_B3_CHILD|",
        "VERITAS_CR09_CUSTODY|", "VERITAS_CR09_BINDING|",
        "VERITAS_CR09_ADVERSE_TRANSCRIPT|",
        "VERITAS_FI08_EVIDENCE_JSON ", "VERITAS_FI09_EVIDENCE_JSON ",
    ]

    enum Failure: Error, Equatable {
        case configuration, frame, sinkIdentity, fileLimit, lockUnavailable
        case open(Int32), write(Int32), shortWrite, close(Int32)
    }

    struct Sink: Sendable {
        let path: String
        let device: UInt64
        let inode: UInt64

        static func from(_ environment: [String: String]) throws -> Sink? {
            let values = [pathKey, deviceKey, inodeKey].compactMap { environment[$0] }
            // Direct developer invocations retain their old, explicitly
            // non-authoritative stdout behavior. Partial configuration NEVER falls back.
            guard !values.isEmpty else { return nil }
            guard values.count == 3,
                  let path = environment[pathKey], path.hasPrefix("/"),
                  path.utf8.allSatisfy({ $0 >= 32 && $0 <= 126 }),
                  path.split(separator: "/", omittingEmptySubsequences: false).dropFirst()
                    .allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }),
                  let deviceText = environment[deviceKey], let device = UInt64(deviceText),
                  String(device) == deviceText,
                  let inodeText = environment[inodeKey], let inode = UInt64(inodeText),
                  String(inode) == inodeText, inode > 0 else { throw Failure.configuration }
            return Sink(path: path, device: device, inode: inode)
        }
    }

    struct Operations {
        var write: (Int32, UnsafeRawPointer?, Int) -> Int = { Darwin.write($0, $1, $2) }
        var close: (Int32) -> Int32 = { Darwin.close($0) }
    }

    static func bytes(for frame: String) throws -> [UInt8] {
        // Accept either the existing bare parent records or one already terminated
        // child record; reject embedded/double newlines rather than repairing them.
        guard frame.utf8.count <= maximumFrameBytes else { throw Failure.frame }
        var bytes = Array(frame.utf8)
        if bytes.last == 10 { bytes.removeLast() }
        let isJSONRecord = frame.hasPrefix("VERITAS_FI08_EVIDENCE_JSON ")
            || frame.hasPrefix("VERITAS_FI09_EVIDENCE_JSON ")
        guard !bytes.isEmpty, bytes.count < maximumFrameBytes,
              bytes.allSatisfy({ $0 >= 32 && $0 != 127 && (isJSONRecord || $0 <= 126) }),
              prefixes.contains(where: frame.hasPrefix) else { throw Failure.frame }
        bytes.append(10)
        return bytes
    }

    static func deliver(
        _ frame: String, environment: [String: String],
        legacyOutput: (String) -> Void = { print($0, terminator: "") }
    ) throws {
        let bytes = try bytes(for: frame)
        if let sink = try Sink.from(environment) {
            try append(bytes, to: sink)
        } else {
            legacyOutput(String(decoding: bytes, as: UTF8.self))
        }
    }

    private static func checkPath(_ sink: Sink) throws {
        // Reject observed ancestor symlinks too. The descriptor identity checks
        // below remain necessary: a path inspection is not an atomic open.
        var current = ""
        let components = sink.path.split(separator: "/")
        guard !components.isEmpty else { throw Failure.sinkIdentity }
        for (index, component) in components.enumerated() {
            current += "/" + component
            var info = stat()
            guard lstat(current, &info) == 0 else { throw Failure.sinkIdentity }
            if index == components.count - 1 {
                try checkIdentity(info, sink: sink)
            } else if info.st_mode & S_IFMT != S_IFDIR {
                throw Failure.sinkIdentity
            }
        }
    }

    private static func checkIdentity(_ info: stat, sink: Sink) throws {
        guard info.st_mode & S_IFMT == S_IFREG, info.st_mode & 0o7777 == 0o600,
              info.st_uid == geteuid(), info.st_nlink == 1,
              UInt64(UInt32(bitPattern: info.st_dev)) == sink.device,
              UInt64(info.st_ino) == sink.inode else { throw Failure.sinkIdentity }
    }

    static func append(_ bytes: [UInt8], to sink: Sink, operations: Operations = Operations()) throws {
        // The lower API also validates bytes: callers cannot bypass framing by
        // constructing a byte array directly.
        guard try self.bytes(for: String(decoding: bytes, as: UTF8.self)) == bytes else {
            throw Failure.frame
        }
        try checkPath(sink)
        let descriptor = open(sink.path, O_WRONLY | O_APPEND | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard descriptor >= 0 else { throw Failure.open(errno) }
        var failure: Error?
        do {
            var before = stat()
            guard fstat(descriptor, &before) == 0 else { throw Failure.sinkIdentity }
            try checkIdentity(before, sink: sink)
            // A bounded cooperative lock wait. This does not promise a hard OS
            // filesystem deadline; the runner separately owns the test process.
            var acquired = false
            for attempt in 0..<100 {
                if flock(descriptor, LOCK_EX | LOCK_NB) == 0 { acquired = true; break }
                guard errno == EWOULDBLOCK || errno == EAGAIN else { throw Failure.lockUnavailable }
                if attempt < 99 { usleep(10_000) }
            }
            guard acquired else { throw Failure.lockUnavailable }
            guard fstat(descriptor, &before) == 0 else { throw Failure.sinkIdentity }
            try checkIdentity(before, sink: sink)
            try checkPath(sink)
            guard before.st_size >= 0,
                  before.st_size <= maximumFileBytes - bytes.count else { throw Failure.fileLimit }
            let written = bytes.withUnsafeBytes { operations.write(descriptor, $0.baseAddress, $0.count) }
            guard written >= 0 else { throw Failure.write(errno) }
            // Do not retry, truncate, or pretend to recover a partial frame. Even
            // EINTR is an explicit failed attempt; the raw evidence is retained.
            guard written == bytes.count else { throw Failure.shortWrite }
            var after = stat()
            guard fstat(descriptor, &after) == 0 else { throw Failure.sinkIdentity }
            try checkIdentity(after, sink: sink)
            guard after.st_size == before.st_size + off_t(bytes.count) else { throw Failure.sinkIdentity }
            try checkPath(sink)
        } catch { failure = error }
        // Close exactly once, including every refusal after open. Close failure
        // is uncertainty, not evidence that no bytes were written.
        let closed = operations.close(descriptor)
        guard closed == 0 else { throw Failure.close(errno) }
        if let failure { throw failure }
        try checkPath(sink)
    }
}
