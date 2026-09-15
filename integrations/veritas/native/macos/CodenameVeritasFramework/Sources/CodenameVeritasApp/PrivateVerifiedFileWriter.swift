import Darwin
import Foundation
import VeritasCore

struct PrivateVerifiedWriteReceiptV1: Equatable, Sendable {
    let destinationURL: URL
    let byteCount: Int
    let digest: String
    let destinationIdentityVerified: Bool
    let readbackVerified: Bool
    let replacedExistingFile: Bool
}

final class PrivateWriteAdmissionControlV1: @unchecked Sendable {
    private let lock = NSLock()
    private var generation: UInt64 = 0

    func issue() -> PrivateWriteAdmissionV1? {
        lock.withLock {
            guard generation < .max else { return nil }
            return PrivateWriteAdmissionV1(control: self, generation: generation)
        }
    }

    func invalidate() {
        lock.withLock {
            if generation < .max { generation += 1 }
        }
    }

    fileprivate func commitIfCurrent(
        generation expected: UInt64,
        _ operation: () throws -> Void
    ) throws -> Bool {
        try lock.withLock {
            guard generation == expected, generation < .max else { return false }
            try operation()
            return true
        }
    }
}

struct PrivateWriteAdmissionV1: Sendable {
    private let control: PrivateWriteAdmissionControlV1
    private let generation: UInt64

    fileprivate init(control: PrivateWriteAdmissionControlV1, generation: UInt64) {
        self.control = control
        self.generation = generation
    }

    func commitIfCurrent(_ operation: () throws -> Void) throws -> Bool {
        try control.commitIfCurrent(generation: generation, operation)
    }
}

enum PrivateVerifiedWriteErrorV1: Error, LocalizedError, Sendable {
    case invalidDestination
    case destinationExists
    case byteLimitExceeded
    case sourceDigestMismatch
    case temporaryCreateFailed
    case writeFailed
    case syncFailed
    case identityMismatch
    case publishFailed
    case readbackMismatch
    case cleanupRefused
    case admissionRevoked

    var errorDescription: String? {
        switch self {
        case .invalidDestination: "Choose a new file in an existing local directory."
        case .destinationExists: "The destination already exists; Veritas will not replace it."
        case .byteLimitExceeded: "The export exceeds the private v1 byte limit."
        case .sourceDigestMismatch: "The source bytes do not match their frozen digest."
        case .temporaryCreateFailed: "The private temporary export could not be created."
        case .writeFailed: "The private export could not be written completely."
        case .syncFailed: "The private export could not be synchronized to storage."
        case .identityMismatch: "The export file identity changed during publication."
        case .publishFailed: "The export could not be published without replacing another file."
        case .readbackMismatch: "The published export did not read back as the exact source bytes."
        case .cleanupRefused: "A failed temporary export changed identity, so cleanup was refused."
        case .admissionRevoked: "The accepted-copy export became stale before publication."
        }
    }
}

/// Writes one new private file, publishes it with no-replace semantics, and then
/// proves byte-for-byte readback identity. This helper never interprets incident
/// history as acceptance; the caller must establish the appropriate source gate.
enum PrivateVerifiedFileWriterV1 {
    static let maximumBytes = ArtifactSnapshotter.prototypeByteLimit

    static func writeNew(
        bytes: Data,
        expectedDigest: String,
        to destinationURL: URL,
        admission: PrivateWriteAdmissionV1
    ) throws -> PrivateVerifiedWriteReceiptV1 {
        let sourceDigest = ArtifactSnapshot.digest(bytes)
        guard destinationURL.isFileURL,
              !bytes.isEmpty,
              bytes.count <= maximumBytes,
              sourceDigest == expectedDigest else {
            if bytes.count > maximumBytes { throw PrivateVerifiedWriteErrorV1.byteLimitExceeded }
            if sourceDigest != expectedDigest {
                throw PrivateVerifiedWriteErrorV1.sourceDigestMismatch
            }
            throw PrivateVerifiedWriteErrorV1.invalidDestination
        }

        let destination = destinationURL.standardizedFileURL
        let parent = destination.deletingLastPathComponent()
        let destinationName = destination.lastPathComponent
        guard !destinationName.isEmpty,
              destinationName != ".",
              destinationName != "..",
              destination.path != parent.path else {
            throw PrivateVerifiedWriteErrorV1.invalidDestination
        }

        let parentDescriptor = Darwin.open(
            parent.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW
        )
        guard parentDescriptor >= 0 else {
            throw PrivateVerifiedWriteErrorV1.invalidDestination
        }
        defer { Darwin.close(parentDescriptor) }
        guard isPrivateWritableDirectory(parentDescriptor) else {
            throw PrivateVerifiedWriteErrorV1.invalidDestination
        }
        switch entryState(parentDescriptor, name: destinationName) {
        case .present:
            throw PrivateVerifiedWriteErrorV1.destinationExists
        case .unknown:
            throw PrivateVerifiedWriteErrorV1.invalidDestination
        case .missing:
            break
        }

        let temporaryName = ".veritas-private-export-\(UUID().uuidString.lowercased()).tmp"
        let descriptor = temporaryName.withCString { name in
            Darwin.openat(
                parentDescriptor,
                name,
                O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,
                mode_t(0o600)
            )
        }
        guard descriptor >= 0 else { throw PrivateVerifiedWriteErrorV1.temporaryCreateFailed }

        var createdIdentity: (device: dev_t, inode: ino_t)?
        var descriptorOpen = true
        var published = false
        defer {
            if descriptorOpen { Darwin.close(descriptor) }
            if !published, let createdIdentity {
                try? removeIfSameIdentity(
                    parentDescriptor,
                    name: temporaryName,
                    expected: createdIdentity
                )
            }
        }

        var status = stat()
        guard fstat(descriptor, &status) == 0,
              (status.st_mode & S_IFMT) == S_IFREG,
              (status.st_mode & mode_t(0o777)) == mode_t(0o600),
              status.st_uid == geteuid(),
              status.st_nlink == 1 else {
            throw PrivateVerifiedWriteErrorV1.identityMismatch
        }
        createdIdentity = (status.st_dev, status.st_ino)

        try bytes.withUnsafeBytes { rawBuffer in
            guard let base = rawBuffer.baseAddress else {
                throw PrivateVerifiedWriteErrorV1.writeFailed
            }
            var offset = 0
            while offset < rawBuffer.count {
                let written = Darwin.write(
                    descriptor,
                    base.advanced(by: offset),
                    rawBuffer.count - offset
                )
                guard written > 0 else { throw PrivateVerifiedWriteErrorV1.writeFailed }
                offset += written
            }
        }
        guard fsync(descriptor) == 0 else { throw PrivateVerifiedWriteErrorV1.syncFailed }
        guard Darwin.close(descriptor) == 0 else { throw PrivateVerifiedWriteErrorV1.syncFailed }
        descriptorOpen = false

        guard let createdIdentity,
              try readExact(
                parentDescriptor,
                name: temporaryName,
                expectedIdentity: createdIdentity
              ) == bytes else {
            throw PrivateVerifiedWriteErrorV1.readbackMismatch
        }
        var renameResult: Int32 = -1
        let publish = {
            renameResult = temporaryName.withCString { source in
                destinationName.withCString { target in
                    renameatx_np(
                        parentDescriptor,
                        source,
                        parentDescriptor,
                        target,
                        UInt32(RENAME_EXCL)
                    )
                }
            }
        }
        guard try admission.commitIfCurrent(publish) else {
            throw PrivateVerifiedWriteErrorV1.admissionRevoked
        }
        guard renameResult == 0 else {
            if errno == EEXIST { throw PrivateVerifiedWriteErrorV1.destinationExists }
            throw PrivateVerifiedWriteErrorV1.publishFailed
        }
        published = true

        let destinationBytes = try readExact(
            parentDescriptor,
            name: destinationName,
            expectedIdentity: createdIdentity
        )
        guard destinationBytes == bytes,
              ArtifactSnapshot.digest(destinationBytes) == expectedDigest else {
            try? removeIfSameIdentity(
                parentDescriptor,
                name: destinationName,
                expected: createdIdentity
            )
            throw PrivateVerifiedWriteErrorV1.readbackMismatch
        }
        guard fsync(parentDescriptor) == 0 else {
            do {
                try removeIfSameIdentity(
                    parentDescriptor,
                    name: destinationName,
                    expected: createdIdentity
                )
            } catch {
                throw PrivateVerifiedWriteErrorV1.cleanupRefused
            }
            throw PrivateVerifiedWriteErrorV1.syncFailed
        }
        return PrivateVerifiedWriteReceiptV1(
            destinationURL: destination,
            byteCount: bytes.count,
            digest: expectedDigest,
            destinationIdentityVerified: true,
            readbackVerified: true,
            replacedExistingFile: false
        )
    }

    private enum EntryState {
        case missing
        case present
        case unknown
    }

    private static func entryState(_ directory: Int32, name: String) -> EntryState {
        var status = stat()
        let result = name.withCString { path in
            Darwin.fstatat(directory, path, &status, AT_SYMLINK_NOFOLLOW)
        }
        if result == 0 { return .present }
        return errno == ENOENT ? .missing : .unknown
    }

    private static func isPrivateWritableDirectory(_ descriptor: Int32) -> Bool {
        var status = stat()
        guard fstat(descriptor, &status) == 0,
              (status.st_mode & S_IFMT) == S_IFDIR,
              status.st_uid == geteuid(),
              (status.st_mode & mode_t(0o077)) == 0,
              (status.st_mode & S_IWUSR) != 0 else { return false }
        return true
    }

    private static func readExact(
        _ directory: Int32,
        name: String,
        expectedIdentity: (device: dev_t, inode: ino_t)
    ) throws -> Data {
        let descriptor = name.withCString { path in
            Darwin.openat(directory, path, O_RDONLY | O_NOFOLLOW)
        }
        guard descriptor >= 0 else { throw PrivateVerifiedWriteErrorV1.identityMismatch }
        defer { Darwin.close(descriptor) }
        var status = stat()
        guard fstat(descriptor, &status) == 0,
              (status.st_mode & S_IFMT) == S_IFREG,
              status.st_dev == expectedIdentity.device,
              status.st_ino == expectedIdentity.inode,
              status.st_uid == geteuid(),
              status.st_nlink == 1,
              status.st_size >= 0,
              status.st_size <= maximumBytes else {
            throw PrivateVerifiedWriteErrorV1.identityMismatch
        }
        var result = Data()
        result.reserveCapacity(Int(status.st_size))
        var buffer = [UInt8](repeating: 0, count: 16_384)
        while true {
            let count = buffer.withUnsafeMutableBytes { rawBuffer in
                Darwin.read(descriptor, rawBuffer.baseAddress, rawBuffer.count)
            }
            guard count >= 0 else { throw PrivateVerifiedWriteErrorV1.readbackMismatch }
            if count == 0 { break }
            result.append(contentsOf: buffer.prefix(count))
            guard result.count <= maximumBytes else {
                throw PrivateVerifiedWriteErrorV1.byteLimitExceeded
            }
        }
        return result
    }

    private static func removeIfSameIdentity(
        _ directory: Int32,
        name: String,
        expected: (device: dev_t, inode: ino_t)
    ) throws {
        var status = stat()
        let statResult = name.withCString { path in
            Darwin.fstatat(directory, path, &status, AT_SYMLINK_NOFOLLOW)
        }
        if statResult != 0, errno == ENOENT { return }
        guard statResult == 0 else { throw PrivateVerifiedWriteErrorV1.cleanupRefused }
        guard (status.st_mode & S_IFMT) == S_IFREG,
              status.st_dev == expected.device,
              status.st_ino == expected.inode,
              status.st_uid == geteuid(),
              status.st_nlink == 1 else {
            throw PrivateVerifiedWriteErrorV1.cleanupRefused
        }
        let unlinkResult = name.withCString { path in
            Darwin.unlinkat(directory, path, 0)
        }
        guard unlinkResult == 0 else {
            throw PrivateVerifiedWriteErrorV1.cleanupRefused
        }
    }
}
