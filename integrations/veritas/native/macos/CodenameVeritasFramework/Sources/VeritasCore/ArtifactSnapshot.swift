import CryptoKit
import Darwin
import Foundation

public enum ArtifactKind: String, Codable, CaseIterable, Sendable {
    case json
    case markdown
    case text
}

public struct ArtifactSnapshot: Equatable, Sendable {
    public let displayName: String
    public let kind: ArtifactKind
    public let bytes: Data
    public let subjectDigest: String

    public var text: String? {
        String(data: bytes, encoding: .utf8)
    }

    public init(displayName: String, kind: ArtifactKind, bytes: Data) {
        self.displayName = displayName
        self.kind = kind
        self.bytes = bytes
        self.subjectDigest = Self.digest(bytes)
    }

    public static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

public enum SnapshotError: Error, Equatable, LocalizedError {
    case notRegularFile
    case empty
    case exceedsByteLimit(actual: Int, limit: Int)
    case invalidByteLimit
    case readExceededByteLimit(limit: Int)
    case changedDuringRead
    case unreadable

    public var errorDescription: String? {
        switch self {
        case .notRegularFile:
            "Select one regular file."
        case .empty:
            "The selected file is empty."
        case let .exceedsByteLimit(actual, limit):
            "The selected file is \(actual) bytes; the current profile allows \(limit)."
        case .invalidByteLimit:
            "The snapshot byte limit must be positive."
        case let .readExceededByteLimit(limit):
            "The selected file grew beyond the \(limit)-byte read limit."
        case .changedDuringRead:
            "The selected file changed while being read. Select it again."
        case .unreadable:
            "The selected file could not be read completely."
        }
    }
}

public struct ArtifactSnapshotter: Sendable {
    public static let prototypeByteLimit = 1_048_576

    public let byteLimit: Int

    #if DEBUG
    // Internal test controls, absent from optimized builds. They cannot supply
    // bytes, descriptors or successful read results to the reader.
    enum ReadObservation: Equatable, Sendable {
        case admitted, firstRead, beforePathCheck
        case closed(Int32)
    }
    enum ReadFailure: Sendable { case interrupted, ioError }
    private var readObserver: (@Sendable (ReadObservation) -> Void)?
    private var readFailures: [ReadFailure] = []
    private var readChunkSize = 16_384

    init(
        byteLimit: Int = Self.prototypeByteLimit,
        forReadBoundaryTesting observer: @escaping @Sendable (ReadObservation) -> Void,
        chunkSize: Int = 16_384,
        failures: [ReadFailure] = []
    ) {
        self.byteLimit = byteLimit
        self.readObserver = observer
        self.readChunkSize = min(16_384, max(1, chunkSize))
        self.readFailures = Array(failures.prefix(9))
    }
    #endif

    public init(byteLimit: Int = Self.prototypeByteLimit) {
        self.byteLimit = byteLimit
    }

    public func snapshot(displayName: String, kind: ArtifactKind, bytes: Data) throws -> ArtifactSnapshot {
        guard byteLimit > 0 else { throw SnapshotError.invalidByteLimit }
        guard !bytes.isEmpty else { throw SnapshotError.empty }
        guard bytes.count <= byteLimit else {
            throw SnapshotError.exceedsByteLimit(actual: bytes.count, limit: byteLimit)
        }
        return ArtifactSnapshot(displayName: displayName, kind: kind, bytes: bytes)
    }

    public func snapshot(url: URL) throws -> ArtifactSnapshot {
        guard byteLimit > 0 else { throw SnapshotError.invalidByteLimit }
        // Explicit decoding exposes U+0000; the legacy .path accessor may keep
        // that component percent-encoded. Validate the exact bytes used by POSIX.
        let path = url.path(percentEncoded: false)
        // The POSIX path must not silently discard a URL authority or resolve
        // against the process cwd. Local filenames with literal ?/# are encoded
        // path bytes, not URL query/fragment components, and remain supported.
        guard url.isFileURL, path.hasPrefix("/"), !path.utf8.contains(0),
              (url.host ?? "").isEmpty, url.user == nil, url.password == nil,
              url.port == nil, url.query == nil, url.fragment == nil else {
            throw SnapshotError.unreadable
        }
        let didAccess = url.startAccessingSecurityScopedResource()
        defer {
            if didAccess { url.stopAccessingSecurityScopedResource() }
        }

        // NOFOLLOW protects the final component, not every ancestor. NONBLOCK
        // prevents a FIFO open from waiting before fstat; ordinary disk I/O can
        // still block. This is not an interruptible or atomic filesystem snapshot.
        let descriptor = path.withCString {
            Darwin.open($0, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK | O_NOCTTY)
        }
        guard descriptor >= 0 else {
            throw errno == ELOOP ? SnapshotError.notRegularFile : SnapshotError.unreadable
        }
        var needsClose = true
        func closeDescriptor() -> Int32 {
            let status = Darwin.close(descriptor)
            #if DEBUG
            readObserver?(.closed(status))
            #endif
            return status
        }
        defer { if needsClose { _ = closeDescriptor() } }

        var initial = stat()
        guard fstat(descriptor, &initial) == 0 else { throw SnapshotError.unreadable }
        guard initial.st_mode & S_IFMT == S_IFREG else { throw SnapshotError.notRegularFile }
        guard initial.st_size >= 0 else { throw SnapshotError.unreadable }
        guard initial.st_size <= off_t(byteLimit) else {
            throw SnapshotError.exceedsByteLimit(actual: Int(initial.st_size), limit: byteLimit)
        }
        guard initial.st_size > 0 else { throw SnapshotError.empty }
        #if DEBUG
        readObserver?(.admitted)
        let chunkSize = readChunkSize
        var failureIndex = 0
        #else
        let chunkSize = 16_384
        #endif
        var buffer = [UInt8](repeating: 0, count: chunkSize)
        var data = Data()
        var interruptions = 0
        while true {
            // Never add one to an arbitrary limit. The one-byte sentinel is
            // inspected, never appended; accumulated payload stays within cap.
            let remaining = byteLimit - data.count
            let requested = remaining == 0 ? 1 : min(buffer.count, remaining)
            let count: Int
            let readError: Int32
            #if DEBUG
            if failureIndex < readFailures.count {
                readError = readFailures[failureIndex] == .interrupted ? EINTR : EIO
                failureIndex += 1
                count = -1
            } else {
                count = Darwin.read(descriptor, &buffer, requested)
                readError = errno
            }
            #else
            count = Darwin.read(descriptor, &buffer, requested)
            readError = errno
            #endif
            if count < 0 {
                if readError == EINTR, interruptions < 8 {
                    interruptions += 1
                    continue
                }
                throw SnapshotError.unreadable
            }
            guard count > 0 else { break }
            guard count <= remaining else {
                throw SnapshotError.readExceededByteLimit(limit: byteLimit)
            }
            #if DEBUG
            let isFirstRead = data.isEmpty
            #endif
            data.append(contentsOf: buffer.prefix(count))
            #if DEBUG
            if isFirstRead { readObserver?(.firstRead) }
            #endif
        }

        var final = stat()
        guard fstat(descriptor, &final) == 0 else { throw SnapshotError.unreadable }
        guard data.count == Int(initial.st_size), Self.sameFileState(initial, final) else {
            throw SnapshotError.changedDuringRead
        }
        #if DEBUG
        readObserver?(.beforePathCheck)
        #endif
        var named = stat()
        let namedStatus = path.withCString { lstat($0, &named) }
        guard namedStatus == 0, Self.sameFileState(final, named) else {
            throw SnapshotError.changedDuringRead
        }
        // Do not retry close on error/EINTR: the descriptor may already have
        // been released and reused. An earlier failure retains its own error.
        needsClose = false
        guard closeDescriptor() == 0 else {
            throw SnapshotError.unreadable
        }
        return try snapshot(
            displayName: url.lastPathComponent,
            kind: Self.kind(for: url),
            bytes: data
        )
    }

    private static func sameFileState(_ first: stat, _ second: stat) -> Bool {
        first.st_dev == second.st_dev && first.st_ino == second.st_ino &&
        first.st_mode == second.st_mode && first.st_size == second.st_size &&
        first.st_uid == second.st_uid && first.st_gid == second.st_gid &&
        first.st_nlink == second.st_nlink &&
        first.st_mtimespec.tv_sec == second.st_mtimespec.tv_sec &&
        first.st_mtimespec.tv_nsec == second.st_mtimespec.tv_nsec &&
        first.st_ctimespec.tv_sec == second.st_ctimespec.tv_sec &&
        first.st_ctimespec.tv_nsec == second.st_ctimespec.tv_nsec
    }

    private static func kind(for url: URL) -> ArtifactKind {
        switch url.pathExtension.lowercased() {
        case "json": .json
        case "md", "markdown": .markdown
        default: .text
        }
    }
}
