// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

// Nisi V1-02 — bounded JSONL conversation store with a sha256 integrity
// sidecar (decided storage choice, 2026-09-21, Option 1).
//
// Contract:
// - One file per conversation; header line is a ConversationManifest JSON
//   (schema 2), followed by one TranscriptEntry JSON per message line.
// - A `.sha256` sidecar holds the hex digest of the whole file.
// - save() rewrites the file atomically and refuses to write more than
//   maxFileBytes (drops oldest entries first; never below one entry).
// - load() verifies the sidecar, parses the header, refuses on schema/
//   checksum/malformed data, and applies the same tail-kept window as the
//   in-memory ChatLog (maxEntries).
// - delete() removes file + sidecar. Ordinary file removal only: NO
//   secure-erasure claim (roadmap rule).
//
// Pure of any FoundationModels import: persistence is lifecycle, not the model
// seam. Honest persistence: callers persist only after a PASS turn and must
// set the evidence contentPersisted flag from the returned digest.

import Foundation
import CryptoKit
import Darwin

@available(macOS 26.0, *)
enum StoreError: Error, Equatable, Sendable {
    case missingFile
    case missingSidecar
    case checksumMismatch
    case malformedHeader
    case unsupportedSchema(Int)
    case malformedEntryLine(Int)
    case refused(String)
}

struct ConversationManifest: Codable, Equatable, Sendable {
    var schema: Int
    var conversationId: String
    var maxContextUtf16: Int
    var createdAt: Double
}

struct ConversationStore {
    let fileURL: URL
    let maxEntries: Int
    let maxFileBytes: Int

    init(fileURL: URL, maxEntries: Int = 64, maxFileBytes: Int = 1_048_576) {
        self.fileURL = fileURL
        self.maxEntries = maxEntries
        self.maxFileBytes = maxFileBytes
    }

    var sidecarURL: URL { fileURL.appendingPathExtension("sha256") }

    private static func boundedRegularFile(_ url: URL, maxBytes: Int) throws -> Data {
        // Inspect and read the same descriptor. Checking URL metadata before
        // Data(contentsOf:) would permit a path swap between the two calls.
        let descriptor = url.path.withCString { Darwin.open($0, O_RDONLY | O_NOFOLLOW | O_CLOEXEC) }
        guard descriptor >= 0 else { throw StoreError.refused("cannot open regular conversation file") }
        defer { Darwin.close(descriptor) }
        var metadata = stat()
        guard Darwin.fstat(descriptor, &metadata) == 0,
              metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG) else {
            throw StoreError.refused("not a regular conversation file")
        }
        guard metadata.st_size >= 0, metadata.st_size <= maxBytes else {
            throw StoreError.refused("conversation file exceeds cap")
        }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: min(65_536, maxBytes))
        while true {
            let count = buffer.withUnsafeMutableBytes { raw in
                Darwin.read(descriptor, raw.baseAddress, raw.count)
            }
            if count == 0 { return data }
            if count < 0 {
                if errno == EINTR { continue }
                throw StoreError.refused("conversation file read failed")
            }
            guard count <= maxBytes - data.count else {
                throw StoreError.refused("conversation file changed or exceeds cap")
            }
            data.append(contentsOf: buffer.prefix(count))
        }
    }

    private static func validManifest(_ manifest: ConversationManifest) -> Bool {
        (1...65_536).contains(manifest.maxContextUtf16)
            && !manifest.conversationId.isEmpty
            && manifest.conversationId.utf8.count <= 128
            && manifest.createdAt.isFinite
            && manifest.createdAt >= 0
    }

    private static func writePrivateAtomic(_ data: Data, to url: URL) throws {
        let temporary = url.deletingLastPathComponent()
            .appendingPathComponent(".nisi-\(UUID().uuidString).tmp")
        var descriptor = temporary.path.withCString {
            Darwin.open($0, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, mode_t(0o600))
        }
        guard descriptor >= 0 else { throw StoreError.refused("private file creation failed") }
        var installed = false
        defer {
            if descriptor >= 0 { Darwin.close(descriptor) }
            if !installed { _ = temporary.path.withCString { Darwin.unlink($0) } }
        }
        try data.withUnsafeBytes { bytes in
            guard let base = bytes.baseAddress else { return }
            var offset = 0
            while offset < bytes.count {
                let written = Darwin.write(descriptor, base.advanced(by: offset), bytes.count - offset)
                if written < 0 && errno == EINTR { continue }
                guard written > 0 else { throw StoreError.refused("private file write failed") }
                offset += written
            }
        }
        guard Darwin.fsync(descriptor) == 0 else {
            throw StoreError.refused("private file sync failed")
        }
        let closed = Darwin.close(descriptor)
        descriptor = -1
        guard closed == 0 else { throw StoreError.refused("private file close failed") }
        let renamed = temporary.path.withCString { source in
            url.path.withCString { destination in Darwin.rename(source, destination) }
        }
        guard renamed == 0 else { throw StoreError.refused("private file install failed") }
        installed = true
    }

    // MARK: load

    func load() throws -> (manifest: ConversationManifest, transcript: [ChatMessage]) {
        let verified = try loadWithDigest()
        return (verified.manifest, verified.transcript)
    }

    /// Return the digest verified against the exact bytes parsed below. The
    /// window can display the restored save without a second sidecar read.
    func loadWithDigest() throws -> (manifest: ConversationManifest,
                                     transcript: [ChatMessage], digest: String) {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { throw StoreError.missingFile }
        guard maxEntries >= 1 && maxFileBytes >= 1 else { throw StoreError.refused("invalid store cap") }
        let data = try Self.boundedRegularFile(fileURL, maxBytes: maxFileBytes)
        guard FileManager.default.fileExists(atPath: sidecarURL.path) else {
            throw StoreError.missingSidecar
        }
        let sidecarData = try Self.boundedRegularFile(sidecarURL, maxBytes: 128)
        guard let sidecar = String(data: sidecarData, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) else { throw StoreError.missingSidecar }
        let actual = ConversationStore.sha256Hex(data)
        guard actual == sidecar else { throw StoreError.checksumMismatch }

        guard let text = String(data: data, encoding: .utf8) else { throw StoreError.malformedHeader }
        var lines = text.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
        guard let headerLine = lines.first,
              let headerData = headerLine.data(using: .utf8),
              let manifest = try? JSONDecoder().decode(ConversationManifest.self, from: headerData) else {
            throw StoreError.malformedHeader
        }
        guard manifest.schema == 2 else { throw StoreError.unsupportedSchema(manifest.schema) }
        guard Self.validManifest(manifest) else { throw StoreError.malformedHeader }

        lines.removeFirst()
        var transcript: [ChatMessage] = []
        for (index, line) in lines.enumerated() {
            guard let entryData = line.data(using: .utf8),
                  let entry = try? JSONDecoder().decode(TranscriptEntry.self, from: entryData),
                  entry.role == "user" || entry.role == "assistant",
                  entry.text.utf16.count == entry.chars else {
                throw StoreError.malformedEntryLine(index)
            }
            let role: ChatMessage.Role = entry.role == "user" ? .user : .assistant
            transcript.append(ChatMessage(role: role, text: entry.text))
        }
        // Same tail-kept window rule as the in-memory seam applies to disk.
        let capped = Array(transcript.suffix(maxEntries))
        return (manifest, capped, actual)
    }

    // MARK: save

    @discardableResult
    func save(transcript: [ChatMessage], manifest: ConversationManifest) throws -> String {
        guard maxEntries >= 1 && maxFileBytes >= 1 else { throw StoreError.refused("invalid store cap") }
        guard manifest.schema == 2, Self.validManifest(manifest) else { throw StoreError.malformedHeader }
        var entries = transcript.suffix(maxEntries).map {
            TranscriptEntry(role: $0.role.rawValue, chars: $0.utf16Count, text: $0.text)
        }
        let header = try JSONEncoder().encode(manifest)
        var body = Data(header + Data("\n".utf8))
        let encoder = JSONEncoder()
        for entry in entries {
            body.append(try encoder.encode(entry))
            body.append(Data("\n".utf8))
        }
        while body.count > maxFileBytes, entries.count > 1 {
            entries.removeFirst()
            body = Data()
            body.append(header)
            body.append(Data("\n".utf8))
            for entry in entries {
                body.append(try encoder.encode(entry))
                body.append(Data("\n".utf8))
            }
        }
        guard body.count <= maxFileBytes else {
            throw StoreError.refused("transcript exceeds file cap \(maxFileBytes) bytes")
        }
        let digest = ConversationStore.sha256Hex(body)
        try Self.writePrivateAtomic(body, to: fileURL)
        try Self.writePrivateAtomic(Data((digest + "\n").utf8), to: sidecarURL)
        return digest
    }

    // MARK: delete (ordinary removal; no secure-erasure claim)

    static func delete(fileURL: URL) throws {
        let fm = FileManager.default
        if fm.fileExists(atPath: fileURL.path) { try fm.removeItem(at: fileURL) }
        let sidecar = fileURL.appendingPathExtension("sha256")
        if fm.fileExists(atPath: sidecar.path) { try fm.removeItem(at: sidecar) }
    }

    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
