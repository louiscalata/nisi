import Darwin
import Foundation
import Testing
@testable import VeritasCore

private func withSnapshotFiles(_ body: (URL) throws -> Void) throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("veritas-snapshot-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(
        at: directory, withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o700]
    )
    defer {
        do { try FileManager.default.removeItem(at: directory) }
        catch { Issue.record("Snapshot fixture cleanup failed: \(error)") }
    }
    try body(directory)
}

private func appendSnapshotBytes(_ data: Data, to url: URL) throws {
    let handle = try FileHandle(forWritingTo: url)
    defer { try? handle.close() }
    try handle.seekToEnd()
    try handle.write(contentsOf: data)
}

#if DEBUG
private final class SnapshotReadProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var observations: [ArtifactSnapshotter.ReadObservation] = []
    private var errors: [String] = []
    private let action: @Sendable (ArtifactSnapshotter.ReadObservation) throws -> Void

    init(action: @escaping @Sendable (ArtifactSnapshotter.ReadObservation) throws -> Void = { _ in }) {
        self.action = action
    }

    func observe(_ event: ArtifactSnapshotter.ReadObservation) {
        lock.withLock { observations.append(event) }
        do { try action(event) }
        catch { lock.withLock { errors.append(String(describing: error)) } }
    }

    func verify(closes: Int = 1) {
        let state = lock.withLock { (observations, errors) }
        #expect(state.1.isEmpty, "The scheduled filesystem mutation must really succeed.")
        let results = state.0.compactMap { event -> Int32? in
            if case let .closed(status) = event { return status }
            return nil
        }
        #expect(results == Array(repeating: Int32(0), count: closes))
    }

    func count(_ event: ArtifactSnapshotter.ReadObservation) -> Int {
        lock.withLock { observations.filter { $0 == event }.count }
    }
}
#endif

@Suite("Bounded artifact URL intake")
struct ArtifactSnapshotterTests {
    @Test("Regular files preserve bytes, filename, kind and owned content")
    func regularFiles() throws {
        try withSnapshotFiles { directory in
            for (name, kind) in [("input.JSON", ArtifactKind.json), ("input.md", .markdown),
                                 ("input.markdown", .markdown), ("input.txt", .text),
                                 ("literal%00-name.txt", .text), ("question?mark#name.txt", .text)] {
                let url = directory.appendingPathComponent(name)
                let bytes = Data("hello".utf8)
                try bytes.write(to: url)
                let snapshot = try ArtifactSnapshotter().snapshot(url: url)
                #expect(snapshot.displayName == name)
                #expect(snapshot.kind == kind)
                #expect(snapshot.bytes == bytes)
                #expect(snapshot.subjectDigest == "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
                try Data("other".utf8).write(to: url)
                #expect(snapshot.bytes == bytes)
            }
            let url = directory.appendingPathComponent("invalid-utf8.txt")
            try Data([0xff]).write(to: url)
            let snapshot = try ArtifactSnapshotter().snapshot(url: url)
            #expect(snapshot.bytes == Data([0xff]))
            #expect(snapshot.text == nil) // The later gate owns text validity.
        }
    }

    @Test("One byte, exact configured limits, one over and empty")
    func byteBoundaries() throws {
        try withSnapshotFiles { directory in
            let url = directory.appendingPathComponent("bounded.txt")
            for limit in [1, 32, ArtifactSnapshotter.prototypeByteLimit] {
                let reader = ArtifactSnapshotter(byteLimit: limit)
                try Data(repeating: 65, count: limit).write(to: url)
                #expect(try reader.snapshot(url: url).bytes.count == limit)
                try Data(repeating: 65, count: limit + 1).write(to: url)
                #expect(throws: SnapshotError.exceedsByteLimit(actual: limit + 1, limit: limit)) {
                    try reader.snapshot(url: url)
                }
                try Data().write(to: url)
                #expect(throws: SnapshotError.empty) { try reader.snapshot(url: url) }
            }
        }
    }

    @Test("Nonpositive budgets refuse; Int.max does not overflow or preallocate")
    func configurationLimits() throws {
        try withSnapshotFiles { directory in
            let url = directory.appendingPathComponent("small.txt")
            try Data([65]).write(to: url)
            for limit in [Int.min, -1, 0] {
                let reader = ArtifactSnapshotter(byteLimit: limit)
                #expect(throws: SnapshotError.invalidByteLimit) { try reader.snapshot(url: url) }
                #expect(throws: SnapshotError.invalidByteLimit) {
                    try reader.snapshot(displayName: "small.txt", kind: .text, bytes: Data([65]))
                }
            }
            #expect(try ArtifactSnapshotter(byteLimit: Int.max).snapshot(url: url).bytes == Data([65]))
        }
    }

    @Test("Directories, final-component symlinks and a real FIFO are refused")
    func nonRegularFiles() throws {
        try withSnapshotFiles { directory in
            let reader = ArtifactSnapshotter()
            #expect(throws: SnapshotError.notRegularFile) { try reader.snapshot(url: directory) }
            let target = directory.appendingPathComponent("target.txt")
            try Data([65]).write(to: target)
            for (name, destination) in [("alias", target), ("dangling", directory.appendingPathComponent("absent"))] {
                let link = directory.appendingPathComponent(name)
                try FileManager.default.createSymbolicLink(at: link, withDestinationURL: destination)
                #expect(throws: SnapshotError.notRegularFile) { try reader.snapshot(url: link) }
            }
            let fifo = directory.appendingPathComponent("fifo")
            let created = fifo.path.withCString { mkfifo($0, 0o600) }
            try #require(created == 0)
            #expect(throws: SnapshotError.notRegularFile) { try reader.snapshot(url: fifo) }
        }
    }

    @Test("Missing, nonlocal, relative and malformed URLs cannot alias a local path")
    func invalidURLs() throws {
        try withSnapshotFiles { directory in
            let target = directory.appendingPathComponent("prefix.txt")
            try Data([65]).write(to: target)
            let nulURL = try #require(URL(string: target.absoluteString + "%00ignored"))
            try #require(nulURL.path(percentEncoded: false).utf8.contains(0))
            let remote = try #require(URL(string: "https://example.invalid/artifact.txt"))
            let cwdDepth = FileManager.default.currentDirectoryPath.split(separator: "/").count
            let relativePath = String(repeating: "../", count: cwdDepth) + target.path.dropFirst()
            let relative = try #require(URL(string: "file:" + relativePath))
            try #require(!relative.path(percentEncoded: false).hasPrefix("/"))
            // The raw relative path really resolves to the existing test file;
            // refusal must not merely be a side effect of a missing target.
            try #require(Data(contentsOf: URL(fileURLWithPath: relativePath)) == Data([65]))
            let authorityURLs = try ["remote.invalid", "localhost", "user@localhost", "localhost:99"].map {
                try #require(URL(string: "file://" + $0 + target.path))
            }
            let query = try #require(URL(string: target.absoluteString + "?ignored"))
            let fragment = try #require(URL(string: target.absoluteString + "#ignored"))
            for url in [directory.appendingPathComponent("missing"), remote, nulURL, relative, query, fragment] + authorityURLs {
                #expect(throws: SnapshotError.unreadable) { try ArtifactSnapshotter().snapshot(url: url) }
            }
        }
    }

    @Test("Multiple real chunks; debug-only eight interrupted reads recover")
    func chunkedReading() throws {
        try withSnapshotFiles { directory in
            let url = directory.appendingPathComponent("chunks.txt")
            let bytes = Data((0..<70_000).map { UInt8($0 % 251) })
            try bytes.write(to: url)
            #expect(try ArtifactSnapshotter().snapshot(url: url).bytes == bytes)
            #if DEBUG
            let probe = SnapshotReadProbe()
            let reader = ArtifactSnapshotter(
                forReadBoundaryTesting: probe.observe, chunkSize: 7,
                failures: Array(repeating: .interrupted, count: 8)
            )
            #expect(try reader.snapshot(url: url).bytes == bytes)
            probe.verify()
            #expect(probe.count(.firstRead) == 1)
            #endif
        }
    }

    @Test("Growth limits; debug-only append between admission and read")
    func fileGrowth() throws {
        try withSnapshotFiles { directory in
            let url = directory.appendingPathComponent("growing.txt")
            try Data([65]).write(to: url)
            #expect(try ArtifactSnapshotter(byteLimit: 4).snapshot(url: url).bytes.count == 1)
            try appendSnapshotBytes(Data(repeating: 66, count: 4), to: url)
            #expect(throws: SnapshotError.exceedsByteLimit(actual: 5, limit: 4)) {
                try ArtifactSnapshotter(byteLimit: 4).snapshot(url: url)
            }
            #if DEBUG
            for (additional, error) in [(1, SnapshotError.changedDuringRead), (4, .readExceededByteLimit(limit: 4))] {
                try Data([65]).write(to: url)
                let probe = SnapshotReadProbe { event in
                    if event == .admitted { try appendSnapshotBytes(Data(repeating: 66, count: additional), to: url) }
                }
                let reader = ArtifactSnapshotter(byteLimit: 4, forReadBoundaryTesting: probe.observe)
                #expect(throws: error) { try reader.snapshot(url: url) }
                #expect(probe.count(.admitted) == 1)
                probe.verify()
            }
            #endif
        }
    }

    @Test("Truncated files; debug-only truncation before and after a first chunk")
    func fileTruncation() throws {
        try withSnapshotFiles { directory in
            let url = directory.appendingPathComponent("shrinking.txt")
            try Data().write(to: url)
            #expect(throws: SnapshotError.empty) { try ArtifactSnapshotter().snapshot(url: url) }
            try Data([65]).write(to: url)
            #expect(try ArtifactSnapshotter().snapshot(url: url).bytes.count == 1)
            #if DEBUG
            for point in [ArtifactSnapshotter.ReadObservation.admitted, .firstRead] {
                try Data(repeating: 65, count: 8).write(to: url)
                let probe = SnapshotReadProbe { event in
                    if event == point {
                        let handle = try FileHandle(forWritingTo: url)
                        defer { try? handle.close() }
                        try handle.truncate(atOffset: 1)
                    }
                }
                let reader = ArtifactSnapshotter(forReadBoundaryTesting: probe.observe, chunkSize: 2)
                #expect(throws: SnapshotError.changedDuringRead) { try reader.snapshot(url: url) }
                #expect(probe.count(point) == 1)
                probe.verify()
            }
            #endif
        }
    }

    @Test("Replacement files; debug-only replacement and same-inode edits in flight")
    func fileReplacement() throws {
        try withSnapshotFiles { directory in
            let url = directory.appendingPathComponent("replaced.txt")
            try Data([65]).write(to: url)
            #expect(try ArtifactSnapshotter().snapshot(url: url).bytes == Data([65]))
            try Data([66]).write(to: url, options: .atomic)
            #expect(try ArtifactSnapshotter().snapshot(url: url).bytes == Data([66]))
            #if DEBUG
            for point in [ArtifactSnapshotter.ReadObservation.admitted, .beforePathCheck] {
                for mode in 0..<3 {
                    try Data(repeating: 65, count: 8).write(to: url, options: .atomic)
                    let parked = directory.appendingPathComponent(UUID().uuidString)
                    let probe = SnapshotReadProbe { event in
                        guard event == point else { return }
                        if mode == 2 {
                            // Same inode and length, forced distinct mtime: detected
                            // metadata drift, not proof against an ABA adversary.
                            let handle = try FileHandle(forWritingTo: url)
                            defer { try? handle.close() }
                            try handle.write(contentsOf: Data(repeating: 66, count: 8))
                            try FileManager.default.setAttributes(
                                [.modificationDate: Date(timeIntervalSince1970: 1)], ofItemAtPath: url.path
                            )
                        } else {
                            try FileManager.default.moveItem(at: url, to: parked)
                            if mode == 0 { try Data(repeating: 66, count: 8).write(to: url) }
                            else { try FileManager.default.createSymbolicLink(at: url, withDestinationURL: parked) }
                        }
                    }
                    let reader = ArtifactSnapshotter(forReadBoundaryTesting: probe.observe)
                    #expect(throws: SnapshotError.changedDuringRead) { try reader.snapshot(url: url) }
                    #expect(probe.count(point) == 1)
                    probe.verify()
                    if mode == 1 { try FileManager.default.removeItem(at: url) }
                }
            }
            #endif
        }
    }

    @Test("Repeated real reads; debug-only errno refusal and single close observation")
    func readErrorsAndClose() throws {
        try withSnapshotFiles { directory in
            let url = directory.appendingPathComponent("read.txt")
            try Data([65]).write(to: url)
            for _ in 0..<16 {
                #expect(try ArtifactSnapshotter().snapshot(url: url).bytes == Data([65]))
            }
            #if DEBUG
            for faults in [[ArtifactSnapshotter.ReadFailure.ioError], Array(repeating: .interrupted, count: 9)] {
                let probe = SnapshotReadProbe()
                let reader = ArtifactSnapshotter(forReadBoundaryTesting: probe.observe, failures: faults)
                #expect(throws: SnapshotError.unreadable) { try reader.snapshot(url: url) }
                probe.verify()
            }
            for (target, error) in [(directory, SnapshotError.notRegularFile), (url, .exceedsByteLimit(actual: 2, limit: 1))] {
                try Data([65, 66]).write(to: url)
                let probe = SnapshotReadProbe()
                let reader = ArtifactSnapshotter(byteLimit: 1, forReadBoundaryTesting: probe.observe)
                #expect(throws: error) { try reader.snapshot(url: target) }
                probe.verify()
            }
            try Data().write(to: url)
            let probe = SnapshotReadProbe()
            let reader = ArtifactSnapshotter(forReadBoundaryTesting: probe.observe)
            #expect(throws: SnapshotError.empty) { try reader.snapshot(url: url) }
            probe.verify()
            #endif
        }
    }
}
