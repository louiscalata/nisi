import Darwin
import Foundation
import Testing
@testable import CodenameVeritasApp
@testable import VeritasCore

private func makePrivateWriterRoot() throws -> URL {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("veritas-private-writer-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(
        at: root,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: NSNumber(value: 0o700)]
    )
    guard Darwin.chmod(root.path, mode_t(0o700)) == 0 else {
        throw PrivateVerifiedWriteErrorV1.invalidDestination
    }
    return root
}

private func expectWriterError(
    _ expected: PrivateVerifiedWriteErrorV1,
    operation: () throws -> Void
) {
    do {
        try operation()
        Issue.record("Expected private writer refusal \(expected).")
    } catch let error as PrivateVerifiedWriteErrorV1 {
        switch (expected, error) {
        case (.invalidDestination, .invalidDestination),
             (.destinationExists, .destinationExists),
             (.sourceDigestMismatch, .sourceDigestMismatch),
             (.admissionRevoked, .admissionRevoked):
            break
        default:
            Issue.record("Expected \(expected), received \(error).")
        }
    } catch {
        Issue.record("Expected PrivateVerifiedWriteErrorV1, received \(error).")
    }
}

private func liveWriterAdmission() throws -> PrivateWriteAdmissionV1 {
    let control = PrivateWriteAdmissionControlV1()
    guard let admission = control.issue() else {
        throw PrivateVerifiedWriteErrorV1.admissionRevoked
    }
    return admission
}

@Suite("Private verified file writer")
struct PrivateVerifiedFileWriterTests {
    @Test("Exact bytes publish once with private permissions and verified readback")
    func exactBytesPublishOnce() throws {
        let root = try makePrivateWriterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let bytes = Data("private accepted bytes".utf8)
        let digest = ArtifactSnapshot.digest(bytes)
        let destination = root.appendingPathComponent("accepted.txt")

        let receipt = try PrivateVerifiedFileWriterV1.writeNew(
            bytes: bytes,
            expectedDigest: digest,
            to: destination,
            admission: try liveWriterAdmission()
        )

        #expect(receipt.destinationURL == destination.standardizedFileURL)
        #expect(receipt.byteCount == bytes.count)
        #expect(receipt.digest == digest)
        #expect(receipt.destinationIdentityVerified)
        #expect(receipt.readbackVerified)
        #expect(receipt.replacedExistingFile == false)
        #expect(try Data(contentsOf: destination) == bytes)
        let attributes = try FileManager.default.attributesOfItem(atPath: destination.path)
        let permissions = try #require(attributes[.posixPermissions] as? NSNumber)
        #expect((permissions.intValue & 0o777) == 0o600)
    }

    @Test("Existing files and symbolic links are never replaced")
    func existingDestinationsAreRefused() throws {
        let root = try makePrivateWriterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let original = Data("do not replace".utf8)
        let replacement = Data("new bytes".utf8)
        let digest = ArtifactSnapshot.digest(replacement)
        let existing = root.appendingPathComponent("existing.txt")
        try original.write(to: existing)

        expectWriterError(.destinationExists) {
            _ = try PrivateVerifiedFileWriterV1.writeNew(
                bytes: replacement,
                expectedDigest: digest,
                to: existing,
                admission: try liveWriterAdmission()
            )
        }
        #expect(try Data(contentsOf: existing) == original)

        let target = root.appendingPathComponent("target.txt")
        let link = root.appendingPathComponent("link.txt")
        try original.write(to: target)
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: target)
        expectWriterError(.destinationExists) {
            _ = try PrivateVerifiedFileWriterV1.writeNew(
                bytes: replacement,
                expectedDigest: digest,
                to: link,
                admission: try liveWriterAdmission()
            )
        }
        #expect(try Data(contentsOf: target) == original)
    }

    @Test("Digest mismatch and revoked acceptance publish nothing")
    func invalidAuthorityPublishesNothing() throws {
        let root = try makePrivateWriterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let bytes = Data("frozen bytes".utf8)
        let destination = root.appendingPathComponent("mismatch.txt")

        expectWriterError(.sourceDigestMismatch) {
            _ = try PrivateVerifiedFileWriterV1.writeNew(
                bytes: bytes,
                expectedDigest: ArtifactSnapshot.digest(Data("different".utf8)),
                to: destination,
                admission: try liveWriterAdmission()
            )
        }
        #expect(!FileManager.default.fileExists(atPath: destination.path))

        let control = PrivateWriteAdmissionControlV1()
        let admission = try #require(control.issue())
        control.invalidate()
        let revokedDestination = root.appendingPathComponent("revoked.txt")
        expectWriterError(.admissionRevoked) {
            _ = try PrivateVerifiedFileWriterV1.writeNew(
                bytes: bytes,
                expectedDigest: ArtifactSnapshot.digest(bytes),
                to: revokedDestination,
                admission: admission
            )
        }
        #expect(!FileManager.default.fileExists(atPath: revokedDestination.path))
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
    }

    @Test("A group- or world-accessible destination directory is refused")
    func nonPrivateDirectoryIsRefused() throws {
        let root = try makePrivateWriterRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        #expect(Darwin.chmod(root.path, mode_t(0o755)) == 0)
        let bytes = Data("private bytes".utf8)
        let destination = root.appendingPathComponent("refused.txt")

        expectWriterError(.invalidDestination) {
            _ = try PrivateVerifiedFileWriterV1.writeNew(
                bytes: bytes,
                expectedDigest: ArtifactSnapshot.digest(bytes),
                to: destination,
                admission: try liveWriterAdmission()
            )
        }
        #expect(!FileManager.default.fileExists(atPath: destination.path))
    }
}
