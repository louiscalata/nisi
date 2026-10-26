// PRIVATE Nisi kernel. Links three unchanged frozen Veritas source files.
// Artifact structure only: no models, user-code execution, UI or file selection.
import Darwin
import Foundation

enum KernelError: Error { case input, output }
let artifactCap = 1_048_576
let headerCap = 4096
let schema = "nisi-swift-artifact-v1"

// Adapted from Fable 5.1's retained bounded draft. This synchronous pipe reader
// has no wall deadline. The future host owns timeout, cancellation and drain.
// Content is bounded, not Foundation's internal heap allocation capacity.
func readBounded(fd: Int32, cap: Int) throws -> Data {
    guard cap >= 0 && cap < Int.max else { throw KernelError.input }
    var out = Data()
    var buffer = [UInt8](repeating: 0, count: 16_384)
    var retries = 8
    while true {
        let remaining = cap - out.count
        let requested = min(buffer.count, remaining + 1)
        let (count, readError) = buffer.withUnsafeMutableBytes { raw in
            let count = Darwin.read(fd, raw.baseAddress, requested)
            return (count, errno)
        }
        if count > 0 {
            guard count <= remaining else { throw KernelError.input }
            out.append(contentsOf: buffer[0..<count])
        } else if count == 0 {
            return out
        } else if readError == EINTR && retries > 0 {
            retries -= 1
        } else {
            throw KernelError.input
        }
    }
}

func writeAll(fd: Int32, data: Data) throws {
    try data.withUnsafeBytes { raw in
        var offset = 0
        var retries = 8
        while offset < raw.count {
            let count = Darwin.write(fd, raw.baseAddress!.advanced(by: offset), raw.count - offset)
            let writeError = errno
            if count > 0 { offset += count }
            else if count < 0 && writeError == EINTR && retries > 0 { retries -= 1 }
            else { throw KernelError.output }
        }
    }
}

func digestIsValid(_ value: String) -> Bool {
    value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
}

func selectedProfile(_ id: String) throws -> (ArtifactKind, CheckProfile) {
    let kind: ArtifactKind
    let sections: [String]
    switch id {
    case "nisi-json-structure-v1": kind = .json; sections = []
    case "nisi-markdown-sections-v1": kind = .markdown; sections = ["Testing", "Rollback"]
    case "nisi-text-structure-v1": kind = .text; sections = []
    default: throw KernelError.input
    }
    return (kind, CheckProfile(id: id, requiredSections: sections,
        allowedAdvisoryDimensions: [], modelParticipationRequired: false, maximumAdvisoryDimensions: 0))
}

struct KernelReport: Encodable {
    let schemaVersion: String
    let expectationFingerprint: String
    let preparationFingerprint: String
    let path: String
    let artifactSha256: String
    let profileId: String
    let rulesFingerprint: String
    let sourceFingerprint: String
    let requestSha256: String
    let artifactByteLength: Int
    let status: CheckStatus
    let outcomes: [CheckOutcome]
    let authorizing = false
}

func evaluate(_ frame: Data) throws -> Data {
    guard frame.count >= 4 else { throw KernelError.input }
    let length = frame.prefix(4).reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    guard length > 0 && length <= UInt32(headerCap) else { throw KernelError.input }
    let boundary = 4 + Int(length)
    guard frame.count >= boundary else { throw KernelError.input }
    let header = try StrictJSONDocumentValidator.inspectTopLevelObject(Data(frame[4..<boundary]))
    let names = ["schemaVersion", "expectationFingerprint", "preparationFingerprint", "path", "artifactSha256",
        "profileId", "rulesFingerprint", "sourceFingerprint"]
    guard header.keys == Set(names.map { Data($0.utf8) }),
          header.stringMembers.count == names.count else { throw KernelError.input }
    func field(_ key: String) throws -> String {
        guard let value = header.string(for: key) else { throw KernelError.input }
        return value
    }
    guard try field("schemaVersion") == schema else { throw KernelError.input }
    for key in ["expectationFingerprint", "preparationFingerprint", "artifactSha256", "rulesFingerprint", "sourceFingerprint"] {
        guard try digestIsValid(field(key)) else { throw KernelError.input }
    }
    let path = try field("path")
    guard !path.isEmpty, path.utf8.count <= 512,
          path.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) ||
              (97...122).contains($0) || [45, 46, 47, 95].contains($0) }) else { throw KernelError.input }
    let id = try field("profileId")
    let (kind, profile) = try selectedProfile(id)
    guard try field("sourceFingerprint") == NisiBuildIdentity.sourceFingerprint,
          try field("rulesFingerprint") == profile.rulesFingerprint else { throw KernelError.input }
    let artifact = Data(frame[boundary...])
    guard artifact.count <= artifactCap,
          try field("artifactSha256") == ArtifactSnapshot.digest(artifact) else { throw KernelError.input }
    let snapshot = ArtifactSnapshot(displayName: path, kind: kind, bytes: artifact)
    let outcomes = DeterministicGateRunner().run(snapshot: snapshot, profile: profile)
    // An incomplete check inventory is never PASS, even if another check failed.
    let status: CheckStatus = outcomes.contains(where: { ![.pass, .fail].contains($0.status) })
        ? .inconclusive : (outcomes.contains(where: { $0.status == .fail }) ? .fail : .pass)
    let report = KernelReport(schemaVersion: schema, expectationFingerprint: try field("expectationFingerprint"),
        preparationFingerprint: try field("preparationFingerprint"), path: path,
        artifactSha256: snapshot.subjectDigest, profileId: id, rulesFingerprint: profile.rulesFingerprint,
        sourceFingerprint: NisiBuildIdentity.sourceFingerprint, requestSha256: ArtifactSnapshot.digest(frame),
        artifactByteLength: artifact.count, status: status, outcomes: outcomes)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    var output = try encoder.encode(report)
    output.append(10)
    guard output.count <= 16_384 else { throw KernelError.output }
    return output
}

// Ignore SIGPIPE so broken output becomes an explicit failed process, not success.
Darwin.signal(SIGPIPE, SIG_IGN)
do {
    guard CommandLine.arguments.count == 1 else { throw KernelError.input }
    let frame = try readBounded(fd: STDIN_FILENO, cap: 4 + headerCap + artifactCap)
    try writeAll(fd: STDOUT_FILENO, data: evaluate(frame))
    Darwin.exit(0)
} catch {
    try? writeAll(fd: STDERR_FILENO, data: Data("NISI_SWIFT_KERNEL_REFUSED\n".utf8))
    Darwin.exit(2)
}
