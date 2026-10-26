import Darwin
import Dispatch
import Foundation
import VeritasCore
import VeritasSQLiteSupport

private let probeScopeID = "scope/veritas-private"
private let probeAccessPolicyDigest = ArtifactSnapshot.digest(
    Data("veritas-abrupt-restart-access-policy".utf8)
)
private let b2DeadlineNanoseconds: UInt64 = 5_000_000_000
private let b2MaximumFrameBytes = 512

private enum ProbeContractFailure: Error {
    case invalidResult
}

private enum B2RecoveryCase: String {
    case cr01A = "CR-01-A"
    case cr03MainAfterReap = "CR-03-MAIN-AFTER-REAP"
    case cr04MainOnly = "CR-04-MAIN-ONLY"
    case cr04WALControl = "CR-04-WAL-CONTROL"
    case cr04WALIdentity = "CR-04-WAL-IDENTITY"
    case cr05MainOnly = "CR-05-MAIN-ONLY"
    case cr05WALControl = "CR-05-WAL-CONTROL"
    case cr05RemovedSHM = "CR-05-SHM-REMOVE"
    case cr05CorruptedSHM = "CR-05-SHM-CORRUPT"

    var expectsCandidate: Bool {
        switch self {
        case .cr01A, .cr04MainOnly, .cr05MainOnly: false
        case .cr03MainAfterReap, .cr04WALControl, .cr04WALIdentity,
             .cr05WALControl, .cr05RemovedSHM, .cr05CorruptedSHM: true
        }
    }

    var expectedEvents: Int64 {
        expectsCandidate ? 2 : 1
    }
}

private enum B3BDivergentBranch: String {
    case a = "A"
    case b = "B"

    var opposite: B3BDivergentBranch { self == .a ? .b : .a }
    var timeOffset: TimeInterval { self == .a ? 1 : 2 }
}

private enum B3BDivergentRecoveryState: String {
    case m0 = "M0"
    case a = "A"
    case b = "B"

    var branch: B3BDivergentBranch? {
        switch self {
        case .m0: nil
        case .a: .a
        case .b: .b
        }
    }
}

private enum B3BDivergentRecoveryPurpose: String {
    case baselineExact = "BASELINE_EXACT"
    case controlDiscover = "CONTROL_DISCOVER"
    case finalExact = "FINAL_EXACT"
}

private enum CR09Node: String {
    case p = "P"
    case a = "A"
    case b = "B"

    var expectedEvents: Int64 { self == .p ? 1 : 2 }
}

private enum CR09Order: String {
    case ab = "AB"
    case ba = "BA"
}

private enum CR09Position: String {
    case first = "FIRST"
    case second = "SECOND"
}

private struct CR09RawChain {
    let node: CR09Node
    let eventCount: Int64
    let h0: String
    let predecessorDigest: String
    let headDigest: String
}

private struct CR09ProjectInventory {
    let mainIdentity: (device: UInt64, inode: UInt64)
    let mainByteCount: Int64
    let mainDigest: String
    let fileDigests: [String: String]
}

private let cr09LedgerProfile = "veritas-founder-alpha-local-incident-ledger-v1"
private let cr09AccessPolicyLabel = "veritas-abrupt-restart-access-policy"
private let cr09AccessPolicyDigest =
    "dcc995ac46821de27687dd47a3a38783fd36fa903edadd814e315b37abfe8ff3"
private let cr09RetentionProfile =
    "veritas-founder-alpha-user-tombstone-and-retention-review-v1"
private let cr09RetentionDigest =
    "ec4e487a3eadc0adf75428018e930f4bb638c84fd7b3776c017b82c86300777e"
private let cr09ProjectDigest =
    "1a41e406287e2dd2f4696878d59964eca256ced61e00a467e60d1d018c5ff969"
private let cr09GenesisDigest =
    "d1aa6e848bafc99c0a9789496990747ffc9d0e738328511832dcc0ecc7557866"
private let cr09MaximumMainOrWALBytes: Int64 = 67_108_864
private let cr09MaximumSHMBytes: Int64 = 1_048_576

private let cr09ExpectedVectors: [CR09Node: [String]] = [
    .p: [
        "b0616509a37223f86e6aac2f2f96aac41a58e00df6c5e3ed77bd7c287ba90fa2",
        "b2b504fa382c20072a7294f674b3887b0fd63fd1c8608ae7a29b9ac20fa5cdf5",
        "0011602a9b14bee69261dfb85fbf82fb60917af152f4bc51d33a80c9bad4d971",
        "a987312a01c6aaa936f24b498743d456e358b8169c2608520fa74dc6cffe2720",
        "dac1e2aad2273419c267e9dd06cfa021a3bd58d2a27f9726c228be128b8984ab",
    ],
    .a: [
        "9995c8f426e5d99e89e75753e19f556974ce5f7806180fda85d3689aaf3d6e27",
        "46c44a8eb0e71fde7efed87fdcc8802cf7d273eec41c531cfd6200cd0d67481d",
        "512d026a9b73833b13d627efe2ed8affbec774d56b06683d092e3044479983a4",
        "2ea8e27b1121b66e181f6f035d1ba1f439d1538d5ded854a0fb3d7e312433fba",
        "6e39a08834cf3632b3588c00b02306287023d525e995fdf97e31a8aa00075e70",
    ],
    .b: [
        "6e328d23e7bee2c40cdf1c719560d29bf8ed50fa29b4411c74fecf12d0f6da65",
        "38986acea1be01be9b9fb978f4f28de1903417b0d4a1d5d0985ac089d9529963",
        "058476c985e24795a3498cd69813273832d624a6c729a1430886dd66ac8abd27",
        "00eab13b8c8911d04538aa53b3f409322cf496d45b942b16469396051c635a03",
        "cd73bc86eb29bde7a307d879bb0896103382c942fdc45e04f6ae6cc2aff3fd2e",
    ],
]

private struct B3BPrivateRootBinding {
    let descriptor: Int32
    let canonicalPath: String
    let device: UInt64
    let inode: UInt64
}

private func probeDigest(_ value: String) -> String {
    ArtifactSnapshot.digest(Data(value.utf8))
}

private func admittedDigest(_ value: String) -> Bool {
    value.utf8.count == 64 && value.utf8.allSatisfy { byte in
        (byte >= Character("0").asciiValue! && byte <= Character("9").asciiValue!)
            || (byte >= Character("a").asciiValue! && byte <= Character("f").asciiValue!)
    }
}

private func admittedRequest(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 96 && value.utf8.allSatisfy { byte in
        (byte >= Character("0").asciiValue! && byte <= Character("9").asciiValue!)
            || (byte >= Character("a").asciiValue! && byte <= Character("z").asciiValue!)
            || byte == Character("-").asciiValue!
    }
}

private func admittedIncidentID(_ value: String) -> Bool {
    guard value.hasPrefix("incident/") else { return false }
    return admittedDigest(String(value.dropFirst("incident/".count)))
}

private func admittedRoot(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 4_096
}

private func admitB3BPrivateRoot(_ value: String) -> B3BPrivateRootBinding? {
    guard admittedRoot(value) else { return nil }
    guard let resolvedPointer = value.withCString({ Darwin.realpath($0, nil) }) else {
        return nil
    }
    defer { Darwin.free(resolvedPointer) }
    let resolved = String(cString: resolvedPointer)
    guard resolved.hasPrefix("/private/tmp/") else { return nil }
    let descriptor = Darwin.open(
        resolved,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard descriptor >= 0 else { return nil }
    var status = stat()
    guard
        Darwin.fstat(descriptor, &status) == 0,
        status.st_mode & mode_t(0o170000) == mode_t(0o040000),
        status.st_uid == Darwin.geteuid(),
        status.st_mode & mode_t(0o777) == mode_t(0o700)
    else {
        _ = Darwin.close(descriptor)
        return nil
    }
    return B3BPrivateRootBinding(
        descriptor: descriptor,
        canonicalPath: resolved,
        device: UInt64(status.st_dev),
        inode: UInt64(status.st_ino)
    )
}

private func revalidateB3BPrivateRoot(_ binding: B3BPrivateRootBinding) -> Bool {
    var descriptorStatus = stat()
    var pathStatus = stat()
    return Darwin.fstat(binding.descriptor, &descriptorStatus) == 0
        && binding.canonicalPath.withCString({ Darwin.lstat($0, &pathStatus) }) == 0
        && descriptorStatus.st_mode & mode_t(0o170000) == mode_t(0o040000)
        && pathStatus.st_mode & mode_t(0o170000) == mode_t(0o040000)
        && descriptorStatus.st_uid == Darwin.geteuid()
        && pathStatus.st_uid == Darwin.geteuid()
        && descriptorStatus.st_mode & mode_t(0o777) == mode_t(0o700)
        && pathStatus.st_mode & mode_t(0o777) == mode_t(0o700)
        && UInt64(descriptorStatus.st_dev) == binding.device
        && UInt64(descriptorStatus.st_ino) == binding.inode
        && UInt64(pathStatus.st_dev) == binding.device
        && UInt64(pathStatus.st_ino) == binding.inode
}

private func admittedRepetition(_ value: String) -> Int? {
    guard let repetition = Int(value), repetition == 0 || repetition == 1 else {
        return nil
    }
    return repetition
}

private func writeProbeBytes(_ text: String, descriptor: Int32) {
    let bytes = Array(text.utf8)
    bytes.withUnsafeBytes { rawBuffer in
        guard let baseAddress = rawBuffer.baseAddress else { Darwin._exit(72) }
        var offset = 0
        while offset < rawBuffer.count {
            let written = Darwin.write(
                descriptor,
                baseAddress.advanced(by: offset),
                rawBuffer.count - offset
            )
            if written > 0 {
                offset += written
            } else if written < 0, errno == EINTR {
                continue
            } else {
                Darwin._exit(72)
            }
        }
    }
}

private func failProbe(_ code: String, exitStatus: Int32) -> Never {
    writeProbeBytes("PROBE_ERROR|v2|\(code)\n", descriptor: STDERR_FILENO)
    Darwin._exit(exitStatus)
}

private final class CR03Once: @unchecked Sendable {
    private let lock = NSLock()
    private var calls = 0
    func enter() {
        let first = lock.withLock { calls += 1; return calls == 1 }
        guard first else { failProbe("CR03_DUPLICATE_BARRIER", exitStatus: 78) }
    }
    func requireOnce() {
        guard lock.withLock({ calls == 1 }) else { failProbe("CR03_MISSING_BARRIER", exitStatus: 78) }
    }
}

private func remainingPollMilliseconds(deadline: UInt64) -> Int32 {
    let now = DispatchTime.now().uptimeNanoseconds
    guard now < deadline else { return 0 }
    let remaining = deadline - now
    let milliseconds = (remaining + 999_999) / 1_000_000
    return Int32(min(milliseconds, UInt64(Int32.max)))
}

private func readBoundedLine(descriptor: Int32, deadline: UInt64) -> String {
    var bytes: [UInt8] = []
    bytes.reserveCapacity(128)
    while bytes.count < b2MaximumFrameBytes {
        let timeout = remainingPollMilliseconds(deadline: deadline)
        guard timeout > 0 else { failProbe("PARENT_FRAME_TIMEOUT", exitStatus: 77) }
        var pollDescriptor = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
        let pollResult = Darwin.poll(&pollDescriptor, 1, timeout)
        if pollResult < 0, errno == EINTR { continue }
        guard pollResult == 1 else { failProbe("PARENT_FRAME_TIMEOUT", exitStatus: 77) }
        guard pollDescriptor.revents & Int16(POLLNVAL | POLLERR) == 0 else {
            failProbe("PARENT_FRAME_DESCRIPTOR", exitStatus: 78)
        }
        var byte: UInt8 = 0
        let count = withUnsafeMutableBytes(of: &byte) { rawBuffer in
            Darwin.read(descriptor, rawBuffer.baseAddress, 1)
        }
        if count < 0, errno == EINTR { continue }
        guard count == 1 else { failProbe("PARENT_FRAME_EOF", exitStatus: 78) }
        bytes.append(byte)
        if byte == 0x0A {
            return String(decoding: bytes, as: UTF8.self)
        }
    }
    failProbe("PARENT_FRAME_OVERSIZE", exitStatus: 78)
}

private func waitForExactParentFrame(_ expected: String, deadline: UInt64) {
    guard readBoundedLine(descriptor: STDIN_FILENO, deadline: deadline) == expected else {
        failProbe("PARENT_FRAME_CONTRACT", exitStatus: 78)
    }
}

private func pauseUntilKilled() -> Never {
    while true { _ = Darwin.pause() }
}

private func probeScope(projectDigest: String) -> IncidentLedgerScopeV1 {
    IncidentLedgerScopeV1(
        scopeID: probeScopeID,
        projectDigest: projectDigest,
        accessPolicyDigest: probeAccessPolicyDigest,
        retentionPolicyDigest: LocalIncidentLedgerV1.retentionPolicyDigest
    )
}

private func probeCandidateObservation() -> IncidentObservationInputV1 {
    IncidentObservationInputV1(
        incidentID: "incident/\(probeDigest("abrupt-restart-candidate-incident"))",
        observationKey: probeDigest("abrupt-restart-candidate-observation"),
        subjectIDDigest: probeDigest("abrupt-restart-subject-id"),
        subjectContentDigest: probeDigest("abrupt-restart-subject-content"),
        evidenceSetDigest: probeDigest("abrupt-restart-evidence"),
        failureCodes: [.deterministicCheckFailed, .testFailed],
        symptomCodes: [.failingTest],
        observedAt: Date(timeIntervalSince1970: 1_900_000_000),
        retentionReviewAt: Date(timeIntervalSince1970: 1_907_776_000)
    )
}

private func probeB3BBaselineObservation(repetition: Int) -> IncidentObservationInputV1 {
    let label = "b3-cr04-wal-divergent-\(repetition)-baseline"
    return IncidentObservationInputV1(
        incidentID: "incident/\(probeDigest("incident-\(label)"))",
        observationKey: probeDigest("observation-\(label)"),
        subjectIDDigest: probeDigest("subject-id-\(label)"),
        subjectContentDigest: probeDigest("subject-content-\(label)"),
        evidenceSetDigest: probeDigest("evidence-\(label)"),
        failureCodes: [.factEvidenceMissing, .requirementMissing],
        symptomCodes: [.missingCitation, .missingSection],
        observedAt: Date(timeIntervalSince1970: 1_800_000_000),
        retentionReviewAt: Date(timeIntervalSince1970: 1_807_776_000)
    )
}

private func probeB3BDivergentObservation(
    repetition: Int,
    branch: B3BDivergentBranch
) -> IncidentObservationInputV1 {
    let domain = "veritas-b3b-cr04-divergent-v1|repetition=\(repetition)" +
        "|branch=\(branch.rawValue)|field="
    let observedAt = 1_910_000_000 + TimeInterval(repetition * 10) + branch.timeOffset
    return IncidentObservationInputV1(
        incidentID: "incident/\(probeDigest(domain + "incident"))",
        observationKey: probeDigest(domain + "observation"),
        subjectIDDigest: probeDigest(domain + "subject-id"),
        subjectContentDigest: probeDigest(domain + "subject-content"),
        evidenceSetDigest: probeDigest(domain + "evidence"),
        failureCodes: [.deterministicCheckFailed, .testFailed],
        symptomCodes: [.failingTest],
        observedAt: Date(timeIntervalSince1970: observedAt),
        retentionReviewAt: Date(timeIntervalSince1970: observedAt + 7_776_000)
    )
}

private func probeB3BVerifyFrozenVector(
    repetition: Int,
    branch: B3BDivergentBranch,
    observation: IncidentObservationInputV1
) -> Bool {
    let vectors: [String: [String]] = [
        "0A": [
            "b7b8cbae6c52fe9104025cd8052ab4acf9d79dd8ebf4a3b210f970e99b17cbf1",
            "9a1a327febe18558cd73e5581a69071484cb1fd1356d4c8c948f7c03924718b1",
            "6305ca46b767bef143b18373d66ec9ae0ceb7d0f6727e702a47ef729e0eef303",
            "ff2f04151cfecc172fcf6a08efb37eab8b68db29f6e9009f54ac99e1d75630a3",
            "f928806df073f1ee75688651128ba3790b769c29bb7fac6932e5c19c5afe971c",
        ],
        "0B": [
            "45bdf7c2f4b5ecdf3bac9a237911557b85feabf96076544a93c311f95f7d6c7f",
            "b6764b957f50c6a7e202f7c96551fc4b62e69a8eb3e82d004dc2f1a65beb607d",
            "e9da5700d1c7fc984fca661b70bcd22206c2167c62000038aadba8eb17308cac",
            "e77d1d314083f94f0e47af38b6d402c306ae81fdaa0fee2fa051d1e40186b072",
            "7597e6c2c7f3a9fdd4af465800d4986e2d1076d7dbc9ea176916bba0262f9692",
        ],
        "1A": [
            "93aca01ef2f5f0ff3993cceceff3ceeefe5ab81c084df26ce8a41ef5fa01296f",
            "7be57fa674f2cf282ed7e918a42654af3ea9a01d1a1ddd2fecaa6328bcfa167e",
            "60f3d7957d7892d8f4b74384e2298f8be152617fbfcf0ac2825a9e78443e7ebe",
            "19217a8776160a48f0e628f958f16b1de5a2ec59da738244d85edf574d30eb9f",
            "4ff3a9be99ea23a8a8268734dd4ab01c23049b6888acb5c3a6231669a1c08192",
        ],
        "1B": [
            "cd1c367e35cdd4e02f61c34ea598a96ce2d1e3c84e19310d9acc13a83bb9333c",
            "5cf9cdd7633dd23d9c3225ab9d8695c5d7f49fb27744d03fcd0ad2e57fb4093e",
            "dcdc7c82c685d81ad6790414f93485f6693984eff902cc928fcb5f9002044eb9",
            "3b1b2d5f527d2c6eaaa5f9716df6629f5984ff50ba623aef94ed1faf4e6a4da0",
            "aca49a6962b68437ace5659c1523ea3f2993306f8e0585fe6f8c4ff27753e8aa",
        ],
    ]
    guard let expected = vectors["\(repetition)\(branch.rawValue)"] else { return false }
    let expectedObservedAt = 1_910_000_000 +
        TimeInterval(repetition * 10) + branch.timeOffset
    return observation.incidentID == "incident/" + expected[0]
        && observation.observationKey == expected[1]
        && observation.subjectIDDigest == expected[2]
        && observation.subjectContentDigest == expected[3]
        && observation.evidenceSetDigest == expected[4]
        && observation.failureCodes == [.deterministicCheckFailed, .testFailed]
        && observation.symptomCodes == [.failingTest]
        && observation.observedAt == Date(timeIntervalSince1970: expectedObservedAt)
        && observation.retentionReviewAt == Date(
            timeIntervalSince1970: expectedObservedAt + 7_776_000
        )
}

private func probeCR09Observation(_ node: CR09Node) -> IncidentObservationInputV1 {
    let domain = "veritas-cr09-closed-sibling-v1|node=\(node.rawValue)|field="
    let observedAt: TimeInterval
    let failureCodes: [IncidentFailureCodeV1]
    let symptomCodes: [IncidentSymptomCodeV1]
    switch node {
    case .p:
        observedAt = 1_920_000_000
        failureCodes = [.factEvidenceMissing, .requirementMissing]
        symptomCodes = [.missingCitation, .missingSection]
    case .a:
        observedAt = 1_920_000_001
        failureCodes = [.deterministicCheckFailed, .testFailed]
        symptomCodes = [.failingTest]
    case .b:
        observedAt = 1_920_000_002
        failureCodes = [.deterministicCheckFailed, .testFailed]
        symptomCodes = [.failingTest]
    }
    return IncidentObservationInputV1(
        incidentID: "incident/\(probeDigest(domain + "incident"))",
        observationKey: probeDigest(domain + "observation"),
        subjectIDDigest: probeDigest(domain + "subject-id"),
        subjectContentDigest: probeDigest(domain + "subject-content"),
        evidenceSetDigest: probeDigest(domain + "evidence"),
        failureCodes: failureCodes,
        symptomCodes: symptomCodes,
        observedAt: Date(timeIntervalSince1970: observedAt),
        retentionReviewAt: Date(timeIntervalSince1970: observedAt + 7_776_000)
    )
}

private func probeCR09FrozenConstantsAreExact() -> Bool {
    // Deliberately an INDEPENDENT re-derivation of the v1 frame layout
    // ([u8 tag][u64 BE length][value], tag 0 domain / tag 1 field), NOT a call
    // into VeritasCore's VeritasDigestFrameV1. Sharing the primitive here would
    // turn this frozen-constant check into a tautology against the very code it
    // exists to catch drifting.
    var genesisFrames = Data()
    for (tag, value) in [
        (UInt8(0x00), "veritas-founder-alpha-incident-ledger-genesis-v1"),
        (UInt8(0x01), cr09LedgerProfile),
        (UInt8(0x01), probeScopeID),
        (UInt8(0x01), cr09ProjectDigest),
        (UInt8(0x01), cr09AccessPolicyDigest),
        (UInt8(0x01), cr09RetentionDigest),
    ] {
        genesisFrames.append(tag)
        var length = UInt64(value.utf8.count).bigEndian
        withUnsafeBytes(of: &length) { genesisFrames.append(contentsOf: $0) }
        genesisFrames.append(contentsOf: value.utf8)
    }
    guard
        probeDigest("veritas-cr09-closed-sibling-v1|scope=project") == cr09ProjectDigest,
        probeDigest(cr09AccessPolicyLabel) == cr09AccessPolicyDigest,
        probeAccessPolicyDigest == cr09AccessPolicyDigest,
        probeScopeID == "scope/veritas-private",
        LocalIncidentLedgerV1.profile == cr09LedgerProfile,
        LocalIncidentLedgerV1.retentionPolicyProfile == cr09RetentionProfile,
        LocalIncidentLedgerV1.retentionPolicyDigest == cr09RetentionDigest,
        ArtifactSnapshot.digest(genesisFrames) == cr09GenesisDigest
    else {
        return false
    }
    for node in [CR09Node.p, .a, .b] {
        guard let expected = cr09ExpectedVectors[node], expected.count == 5 else {
            return false
        }
        let observation = probeCR09Observation(node)
        guard
            observation.incidentID == "incident/" + expected[0],
            observation.observationKey == expected[1],
            observation.subjectIDDigest == expected[2],
            observation.subjectContentDigest == expected[3],
            observation.evidenceSetDigest == expected[4],
            observation.observedAt == Date(
                timeIntervalSince1970: 1_920_000_000 + (node == .p ? 0 : node == .a ? 1 : 2)
            ),
            observation.retentionReviewAt == Date(
                timeIntervalSince1970: 1_927_776_000 + (node == .p ? 0 : node == .a ? 1 : 2)
            )
        else {
            return false
        }
        switch node {
        case .p:
            guard
                observation.failureCodes == [.factEvidenceMissing, .requirementMissing],
                observation.symptomCodes == [.missingCitation, .missingSection]
            else { return false }
        case .a, .b:
            guard
                observation.failureCodes == [.deterministicCheckFailed, .testFailed],
                observation.symptomCodes == [.failingTest]
            else { return false }
        }
    }
    return true
}

private func cr09DirectoryEntries(_ descriptor: Int32) throws -> Set<String> {
    let enumerationDescriptor = ".".withCString {
        Darwin.openat(
            descriptor,
            $0,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
    }
    guard enumerationDescriptor >= 0 else {
        throw ProbeContractFailure.invalidResult
    }
    var sourceStatus = stat()
    var enumerationStatus = stat()
    guard
        Darwin.fstat(descriptor, &sourceStatus) == 0,
        Darwin.fstat(enumerationDescriptor, &enumerationStatus) == 0,
        UInt64(sourceStatus.st_dev) == UInt64(enumerationStatus.st_dev),
        UInt64(sourceStatus.st_ino) == UInt64(enumerationStatus.st_ino)
    else {
        _ = Darwin.close(enumerationDescriptor)
        throw ProbeContractFailure.invalidResult
    }
    guard let directory = Darwin.fdopendir(enumerationDescriptor) else {
        _ = Darwin.close(enumerationDescriptor)
        throw ProbeContractFailure.invalidResult
    }
    var directoryIsOpen = true
    defer {
        if directoryIsOpen { _ = Darwin.closedir(directory) }
    }
    var names = Set<String>()
    errno = 0
    while let entry = Darwin.readdir(directory) {
        var nameStorage = entry.pointee.d_name
        let nameCapacity = MemoryLayout.size(ofValue: nameStorage)
        let name = withUnsafePointer(to: &nameStorage) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: nameCapacity) {
                String(cString: $0)
            }
        }
        if name == "." || name == ".." { continue }
        guard !name.isEmpty, names.insert(name).inserted else {
            throw ProbeContractFailure.invalidResult
        }
    }
    let enumerationErrno = errno
    let closeResult = Darwin.closedir(directory)
    directoryIsOpen = false
    guard enumerationErrno == 0, closeResult == 0 else {
        throw ProbeContractFailure.invalidResult
    }
    return names
}

private func cr09RelativeEntryExists(
    directoryDescriptor: Int32,
    name: String
) throws -> Bool {
    var status = stat()
    errno = 0
    let result = name.withCString {
        Darwin.fstatat(directoryDescriptor, $0, &status, AT_SYMLINK_NOFOLLOW)
    }
    if result == 0 { return true }
    guard errno == ENOENT else { throw ProbeContractFailure.invalidResult }
    return false
}

private func cr09RelativeRegularSnapshot(
    directoryDescriptor: Int32,
    name: String,
    maximumBytes: Int64,
    requireNonempty: Bool
) throws -> (identity: (device: UInt64, inode: UInt64), byteCount: Int64, digest: String) {
    let descriptor = name.withCString {
        Darwin.openat(
            directoryDescriptor,
            $0,
            O_RDONLY | O_NOFOLLOW | O_CLOEXEC
        )
    }
    guard descriptor >= 0 else { throw ProbeContractFailure.invalidResult }
    var descriptorIsOpen = true
    defer {
        if descriptorIsOpen { _ = Darwin.close(descriptor) }
    }
    var before = stat()
    guard
        Darwin.fstat(descriptor, &before) == 0,
        before.st_mode & mode_t(0o170000) == mode_t(0o100000),
        before.st_uid == Darwin.geteuid(),
        before.st_mode & mode_t(0o777) == mode_t(0o600),
        before.st_nlink == 1,
        before.st_size >= (requireNonempty ? 1 : 0),
        before.st_size <= maximumBytes
    else {
        throw ProbeContractFailure.invalidResult
    }
    let byteCount = Int(before.st_size)
    var bytes = [UInt8](repeating: 0, count: byteCount)
    var offset = 0
    while offset < byteCount {
        let readCount = bytes.withUnsafeMutableBytes { buffer in
            Darwin.read(
                descriptor,
                buffer.baseAddress?.advanced(by: offset),
                byteCount - offset
            )
        }
        if readCount < 0, errno == EINTR { continue }
        guard readCount > 0 else { throw ProbeContractFailure.invalidResult }
        offset += readCount
    }
    var extra: UInt8 = 0
    let extraCount = withUnsafeMutableBytes(of: &extra) { buffer in
        Darwin.read(descriptor, buffer.baseAddress, 1)
    }
    var after = stat()
    guard
        extraCount == 0,
        Darwin.fstat(descriptor, &after) == 0,
        UInt64(before.st_dev) == UInt64(after.st_dev),
        UInt64(before.st_ino) == UInt64(after.st_ino),
        before.st_size == after.st_size,
        before.st_mode == after.st_mode,
        before.st_uid == after.st_uid,
        before.st_nlink == after.st_nlink,
        Darwin.close(descriptor) == 0
    else {
        throw ProbeContractFailure.invalidResult
    }
    descriptorIsOpen = false
    return (
        (UInt64(before.st_dev), UInt64(before.st_ino)),
        Int64(before.st_size),
        ArtifactSnapshot.digest(Data(bytes))
    )
}

private func cr09ProjectInventory(
    rootBinding: B3BPrivateRootBinding,
    projectDigest: String,
    requireMainOnly: Bool
) throws -> CR09ProjectInventory {
    guard
        projectDigest == cr09ProjectDigest,
        revalidateB3BPrivateRoot(rootBinding)
    else {
        throw ProbeContractFailure.invalidResult
    }
    let projectsDescriptor = "projects".withCString {
        Darwin.openat(
            rootBinding.descriptor,
            $0,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
    }
    guard projectsDescriptor >= 0 else { throw ProbeContractFailure.invalidResult }
    var projectsIsOpen = true
    defer {
        if projectsIsOpen { _ = Darwin.close(projectsDescriptor) }
    }
    var projectsStatus = stat()
    guard
        Darwin.fstat(projectsDescriptor, &projectsStatus) == 0,
        projectsStatus.st_mode & mode_t(0o170000) == mode_t(0o040000),
        projectsStatus.st_uid == Darwin.geteuid(),
        projectsStatus.st_mode & mode_t(0o777) == mode_t(0o700)
    else {
        throw ProbeContractFailure.invalidResult
    }
    let projectDescriptor = projectDigest.withCString {
        Darwin.openat(
            projectsDescriptor,
            $0,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
    }
    guard projectDescriptor >= 0 else { throw ProbeContractFailure.invalidResult }
    var projectIsOpen = true
    defer {
        if projectIsOpen { _ = Darwin.close(projectDescriptor) }
    }
    var projectStatus = stat()
    guard
        Darwin.fstat(projectDescriptor, &projectStatus) == 0,
        projectStatus.st_mode & mode_t(0o170000) == mode_t(0o040000),
        projectStatus.st_uid == Darwin.geteuid(),
        projectStatus.st_mode & mode_t(0o777) == mode_t(0o700)
    else {
        throw ProbeContractFailure.invalidResult
    }
    let mainName = "incident-ledger-v1.sqlite3"
    let walName = mainName + "-wal"
    let shmName = mainName + "-shm"
    let admittedNames: Set<String> = [mainName, walName, shmName]
    let observedNames = try cr09DirectoryEntries(projectDescriptor)
    guard
        observedNames.contains(mainName),
        observedNames.isSubset(of: admittedNames),
        !requireMainOnly || observedNames == [mainName]
    else {
        throw ProbeContractFailure.invalidResult
    }
    var digests = [String: String]()
    var mainSnapshot: (
        identity: (device: UInt64, inode: UInt64),
        byteCount: Int64,
        digest: String
    )?
    for name in observedNames {
        let snapshot = try cr09RelativeRegularSnapshot(
            directoryDescriptor: projectDescriptor,
            name: name,
            maximumBytes: name == shmName
                ? cr09MaximumSHMBytes
                : cr09MaximumMainOrWALBytes,
            requireNonempty: name == mainName
        )
        digests[name] = snapshot.digest
        if name == mainName { mainSnapshot = snapshot }
    }
    guard
        let mainSnapshot,
        Darwin.close(projectDescriptor) == 0
    else {
        throw ProbeContractFailure.invalidResult
    }
    projectIsOpen = false
    guard
        Darwin.close(projectsDescriptor) == 0,
        revalidateB3BPrivateRoot(rootBinding)
    else {
        throw ProbeContractFailure.invalidResult
    }
    projectsIsOpen = false
    return CR09ProjectInventory(
        mainIdentity: mainSnapshot.identity,
        mainByteCount: mainSnapshot.byteCount,
        mainDigest: mainSnapshot.digest,
        fileDigests: digests
    )
}

private func cr09AdmittedSQLiteURIPath(_ path: String) -> Bool {
    path.hasPrefix("/private/tmp/") && path.utf8.allSatisfy { byte in
        (byte >= Character("0").asciiValue! && byte <= Character("9").asciiValue!)
            || (byte >= Character("A").asciiValue! && byte <= Character("Z").asciiValue!)
            || (byte >= Character("a").asciiValue! && byte <= Character("z").asciiValue!)
            || byte == Character("/").asciiValue!
            || byte == Character(".").asciiValue!
            || byte == Character("_").asciiValue!
            || byte == Character("-").asciiValue!
    }
}

private func cr09SQLiteText(
    _ statement: OpaquePointer,
    _ index: Int32
) throws -> String {
    guard
        sqlite3_column_type(statement, index) == SQLITE_TEXT,
        let bytes = sqlite3_column_text(statement, index)
    else {
        throw ProbeContractFailure.invalidResult
    }
    let byteCount = Int(sqlite3_column_bytes(statement, index))
    guard byteCount >= 0 else {
        throw ProbeContractFailure.invalidResult
    }
    let buffer = UnsafeBufferPointer(start: bytes, count: byteCount)
    guard
        !buffer.contains(0),
        let exact = String(bytes: buffer, encoding: .utf8)
    else {
        throw ProbeContractFailure.invalidResult
    }
    return exact
}

private func cr09Prepare(
    _ database: OpaquePointer,
    sql: String
) throws -> OpaquePointer {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK,
          let statement else {
        throw ProbeContractFailure.invalidResult
    }
    return statement
}

private func cr09ReadRawChain(
    rootBinding: B3BPrivateRootBinding,
    projectDigest: String,
    node: CR09Node,
    expectedH0: String? = nil,
    expectedHead: String? = nil
) throws -> CR09RawChain {
    guard
        projectDigest == cr09ProjectDigest,
        revalidateB3BPrivateRoot(rootBinding)
    else {
        throw ProbeContractFailure.invalidResult
    }
    let databasePath = rootBinding.canonicalPath + "/projects/" + projectDigest
        + "/incident-ledger-v1.sqlite3"
    guard cr09AdmittedSQLiteURIPath(databasePath) else {
        throw ProbeContractFailure.invalidResult
    }
    let inventoryBefore = try cr09ProjectInventory(
        rootBinding: rootBinding,
        projectDigest: projectDigest,
        requireMainOnly: false
    )
    let databaseURI = "file:" + databasePath + "?mode=ro&immutable=1"
    var database: OpaquePointer?
    guard sqlite3_open_v2(
        databaseURI,
        &database,
        SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX | SQLITE_OPEN_URI,
        nil
    ) == SQLITE_OK, let database else {
        if let database { _ = sqlite3_close(database) }
        throw ProbeContractFailure.invalidResult
    }
    var databaseIsOpen = true
    defer {
        if databaseIsOpen { _ = sqlite3_close(database) }
    }
    guard
        sqlite3_db_readonly(database, "main") == 1,
        let openedFilename = sqlite3_db_filename(database, "main"),
        String(cString: openedFilename) == databasePath,
        sqlite3_uri_boolean(openedFilename, "immutable", 0) == 1
    else {
        throw ProbeContractFailure.invalidResult
    }

    let eventStatement = try cr09Prepare(
        database,
        sql: "SELECT ordinal, incident_id, predecessor_digest, event_digest "
            + "FROM incident_events ORDER BY ordinal ASC;"
    )
    var eventRows = [(Int64, String, String, String)]()
    do {
        while true {
            let result = sqlite3_step(eventStatement)
            if result == SQLITE_DONE { break }
            guard
                result == SQLITE_ROW,
                sqlite3_column_type(eventStatement, 0) == SQLITE_INTEGER
            else {
                throw ProbeContractFailure.invalidResult
            }
            eventRows.append((
                sqlite3_column_int64(eventStatement, 0),
                try cr09SQLiteText(eventStatement, 1),
                try cr09SQLiteText(eventStatement, 2),
                try cr09SQLiteText(eventStatement, 3)
            ))
        }
    } catch {
        _ = sqlite3_finalize(eventStatement)
        throw error
    }
    guard sqlite3_finalize(eventStatement) == SQLITE_OK else {
        throw ProbeContractFailure.invalidResult
    }

    let tombstoneStatement = try cr09Prepare(
        database,
        sql: "SELECT COUNT(*) FROM incident_tombstones;"
    )
    let tombstoneExact = sqlite3_step(tombstoneStatement) == SQLITE_ROW
    guard
        tombstoneExact,
        sqlite3_column_type(tombstoneStatement, 0) == SQLITE_INTEGER,
        sqlite3_column_int64(tombstoneStatement, 0) == 0,
        sqlite3_step(tombstoneStatement) == SQLITE_DONE
    else {
        _ = sqlite3_finalize(tombstoneStatement)
        throw ProbeContractFailure.invalidResult
    }
    guard sqlite3_finalize(tombstoneStatement) == SQLITE_OK else {
        throw ProbeContractFailure.invalidResult
    }

    let metaStatement = try cr09Prepare(
        database,
        sql: "SELECT singleton, schema_version, profile, scope_id, project_digest, "
            + "access_policy_digest, retention_policy_digest, genesis_digest, "
            + "event_count, head_digest, authorizing, "
            + "protected_authority_verified, raw_content_stored "
            + "FROM ledger_meta ORDER BY singleton ASC;"
    )
    do {
        guard
            sqlite3_step(metaStatement) == SQLITE_ROW,
            sqlite3_column_type(metaStatement, 0) == SQLITE_INTEGER,
            sqlite3_column_int64(metaStatement, 0) == 1,
            sqlite3_column_type(metaStatement, 1) == SQLITE_INTEGER,
            // Independently pinned, like the rest of this raw reader: the
            // stored schema version must be exactly the current one (3).
            sqlite3_column_int64(metaStatement, 1) == 3,
            try cr09SQLiteText(metaStatement, 2) == cr09LedgerProfile,
            try cr09SQLiteText(metaStatement, 3) == probeScopeID,
            try cr09SQLiteText(metaStatement, 4) == cr09ProjectDigest,
            try cr09SQLiteText(metaStatement, 5) == cr09AccessPolicyDigest,
            try cr09SQLiteText(metaStatement, 6) == cr09RetentionDigest,
            try cr09SQLiteText(metaStatement, 7) == cr09GenesisDigest,
            sqlite3_column_type(metaStatement, 8) == SQLITE_INTEGER,
            sqlite3_column_type(metaStatement, 10) == SQLITE_INTEGER,
            sqlite3_column_type(metaStatement, 11) == SQLITE_INTEGER,
            sqlite3_column_type(metaStatement, 12) == SQLITE_INTEGER
        else {
            throw ProbeContractFailure.invalidResult
        }
    } catch {
        _ = sqlite3_finalize(metaStatement)
        throw error
    }
    let metaEventCount = sqlite3_column_int64(metaStatement, 8)
    let metaHead: String
    do {
        metaHead = try cr09SQLiteText(metaStatement, 9)
        guard
            sqlite3_column_int64(metaStatement, 10) == 0,
            sqlite3_column_int64(metaStatement, 11) == 0,
            sqlite3_column_int64(metaStatement, 12) == 0,
            sqlite3_step(metaStatement) == SQLITE_DONE
        else {
            throw ProbeContractFailure.invalidResult
        }
    } catch {
        _ = sqlite3_finalize(metaStatement)
        throw error
    }
    guard sqlite3_finalize(metaStatement) == SQLITE_OK else {
        throw ProbeContractFailure.invalidResult
    }

    let pIncident = probeCR09Observation(.p).incidentID
    let aIncident = probeCR09Observation(.a).incidentID
    let bIncident = probeCR09Observation(.b).incidentID
    guard
        Int64(eventRows.count) == node.expectedEvents,
        metaEventCount == node.expectedEvents,
        eventRows[0].0 == 1,
        eventRows[0].1 == pIncident,
        eventRows[0].2 == cr09GenesisDigest,
        admittedDigest(eventRows[0].3)
    else {
        throw ProbeContractFailure.invalidResult
    }
    let h0 = eventRows[0].3
    let predecessor: String
    switch node {
    case .p:
        predecessor = cr09GenesisDigest
        guard eventRows.count == 1, metaHead == h0 else {
            throw ProbeContractFailure.invalidResult
        }
    case .a, .b:
        predecessor = eventRows[1].2
        let expectedIncident = node == .a ? aIncident : bIncident
        let oppositeIncident = node == .a ? bIncident : aIncident
        guard
            eventRows.count == 2,
            eventRows[1].0 == 2,
            eventRows[1].1 == expectedIncident,
            eventRows.allSatisfy({ $0.1 != oppositeIncident }),
            eventRows[1].2 == h0,
            admittedDigest(eventRows[1].3),
            eventRows[1].3 == metaHead
        else {
            throw ProbeContractFailure.invalidResult
        }
    }
    let closeResult = sqlite3_close(database)
    databaseIsOpen = false
    let inventoryAfter = try cr09ProjectInventory(
        rootBinding: rootBinding,
        projectDigest: projectDigest,
        requireMainOnly: false
    )
    guard
        expectedH0.map({ $0 == h0 }) ?? true,
        expectedHead.map({ $0 == metaHead }) ?? true,
        closeResult == SQLITE_OK,
        inventoryBefore.mainIdentity.device == inventoryAfter.mainIdentity.device,
        inventoryBefore.mainIdentity.inode == inventoryAfter.mainIdentity.inode,
        inventoryBefore.mainByteCount == inventoryAfter.mainByteCount,
        inventoryBefore.mainDigest == inventoryAfter.mainDigest,
        inventoryBefore.fileDigests == inventoryAfter.fileDigests,
        revalidateB3BPrivateRoot(rootBinding)
    else {
        throw ProbeContractFailure.invalidResult
    }
    return CR09RawChain(
        node: node,
        eventCount: metaEventCount,
        h0: h0,
        predecessorDigest: predecessor,
        headDigest: metaHead
    )
}

private func cr09VerifyThroughLedger(
    rootBinding: B3BPrivateRootBinding,
    projectDigest: String,
    node: CR09Node,
    expectedH0: String,
    expectedHead: String
) async throws {
    guard revalidateB3BPrivateRoot(rootBinding) else {
        throw ProbeContractFailure.invalidResult
    }
    let ledger = try await LocalIncidentLedgerV1.open(
        rootDirectory: URL(
            fileURLWithPath: rootBinding.canonicalPath,
            isDirectory: true
        ),
        scope: probeScope(projectDigest: projectDigest)
    )
    let verification = try await ledger.verifyIntegrity()
    let list = try await ledger.list(includeTombstoned: true)
    try await ledger.close()
    let p = probeCR09Observation(.p)
    guard
        verification.eventCount == node.expectedEvents,
        verification.observationCount == node.expectedEvents,
        verification.tombstoneCount == 0,
        verification.headDigest == expectedHead,
        verification.authorizing == false,
        verification.protectedAuthorityVerified == false,
        verification.rawContentStored == false,
        Int64(list.count) == node.expectedEvents,
        list.allSatisfy({
            $0.authorizing == false
                && $0.protectedAuthorityVerified == false
                && $0.rawContentStored == false
        })
    else {
        throw ProbeContractFailure.invalidResult
    }
    switch node {
    case .p:
        guard probeMatchesObservationSummary(
            list[0],
            observation: p,
            projectDigest: projectDigest,
            ordinal: 1,
            expectedEventDigest: expectedH0
        ) else {
            throw ProbeContractFailure.invalidResult
        }
    case .a, .b:
        let branch = probeCR09Observation(node)
        let opposite = probeCR09Observation(node == .a ? .b : .a)
        guard
            probeMatchesObservationSummary(
                list[0],
                observation: branch,
                projectDigest: projectDigest,
                ordinal: 2,
                expectedEventDigest: expectedHead
            ),
            probeMatchesObservationSummary(
                list[1],
                observation: p,
                projectDigest: projectDigest,
                ordinal: 1,
                expectedEventDigest: expectedH0
            ),
            !list.contains(where: { $0.incidentID == opposite.incidentID })
        else {
            throw ProbeContractFailure.invalidResult
        }
    }
    guard revalidateB3BPrivateRoot(rootBinding) else {
        throw ProbeContractFailure.invalidResult
    }
}

private func probeMatchesObservationSummary(
    _ summary: IncidentSummaryV1,
    observation: IncidentObservationInputV1,
    projectDigest: String,
    ordinal: Int64,
    expectedEventDigest: String? = nil
) -> Bool {
    summary.projectDigest == projectDigest
        && summary.ordinal == ordinal
        && summary.incidentID == observation.incidentID
        && summary.observationKey == observation.observationKey
        && summary.subjectIDDigest == observation.subjectIDDigest
        && summary.subjectContentDigest == observation.subjectContentDigest
        && summary.evidenceSetDigest == observation.evidenceSetDigest
        && summary.failureCodes == observation.failureCodes
        && summary.symptomCodes == observation.symptomCodes
        && summary.observedAt == observation.observedAt
        && summary.retentionReviewAt == observation.retentionReviewAt
        && (expectedEventDigest.map { summary.eventDigest == $0 } ?? true)
        && summary.authorizing == false
        && summary.protectedAuthorityVerified == false
        && summary.rawContentStored == false
}

private func matchesCandidateSummary(
    _ summary: IncidentSummaryV1,
    projectDigest: String
) -> Bool {
    let candidate = probeCandidateObservation()
    return summary.projectDigest == projectDigest
        && summary.ordinal == 2
        && summary.incidentID == candidate.incidentID
        && summary.observationKey == candidate.observationKey
        && summary.subjectIDDigest == candidate.subjectIDDigest
        && summary.subjectContentDigest == candidate.subjectContentDigest
        && summary.evidenceSetDigest == candidate.evidenceSetDigest
        && summary.failureCodes == candidate.failureCodes
        && summary.symptomCodes == candidate.symptomCodes
        && summary.observedAt == candidate.observedAt
        && summary.retentionReviewAt == candidate.retentionReviewAt
}

private func waitForLegacyParentKill(
    point: IncidentLedgerAbruptProcessPointV1,
    expected: IncidentLedgerAbruptProcessPointV1
) {
    guard point == expected else { return }
    writeProbeBytes(
        "READY|v1|\(point.rawValue)|\(Darwin.getpid())\n",
        descriptor: STDOUT_FILENO
    )
    pauseUntilKilled()
}

@main
private struct VeritasLedgerCrashProbe {
    static func main() async {
        do {
            try await run()
            failProbe("FAULT_POINT_NOT_REACHED", exitStatus: 73)
        } catch let error as IncidentLedgerErrorV1 {
            switch error {
            case .integrity:
                failProbe("LEDGER_INTEGRITY_REFUSAL", exitStatus: 74)
            case let .sqlite(code, _):
                failProbe("LEDGER_SQLITE_\(code)", exitStatus: 74)
            default:
                failProbe("LEDGER_TYPED_REFUSAL", exitStatus: 74)
            }
        } catch {
            failProbe("LEDGER_OPERATION_REFUSED", exitStatus: 74)
        }
    }

    private static func run() async throws {
        let arguments = CommandLine.arguments
        if arguments.count >= 2 {
            switch arguments[1] {
            case "b2-cr01":
                try await runB2CR01(arguments)
            case "b2-cr03-main":
                try await runCR03Main(arguments)
            case "b2-abrupt":
                try await runB2Abrupt(arguments)
            case "b2-recover":
                try await runB2Recovery(arguments)
            case "b3-cr04-abrupt":
                try await runB3CR04Abrupt(arguments)
            case "b3-cr04-divergent-abrupt":
                try await runB3BCR04DivergentAbrupt(arguments)
            case "b3-cr04-divergent-recover":
                try await runB3BCR04DivergentRecovery(arguments)
            case "b3-cr09-build":
                try await runCR09Build(arguments)
            case "b3-cr09-control":
                try await runCR09Control(arguments)
            case "b3-cr09-present":
                try await runCR09Present(arguments)
            default:
                try await runLegacyAbrupt(arguments)
            }
        } else {
            failProbe("ARGUMENT_CONTRACT", exitStatus: 75)
        }
    }

    private static func runLegacyAbrupt(_ arguments: [String]) async throws {
        guard arguments.count == 4 else {
            failProbe("ARGUMENT_CONTRACT", exitStatus: 75)
        }
        let rootPath = arguments[1]
        let projectDigest = arguments[2]
        guard
            admittedRoot(rootPath),
            admittedDigest(projectDigest),
            let crashPoint = IncidentLedgerAbruptProcessPointV1(rawValue: arguments[3])
        else {
            failProbe("ARGUMENT_VALUE", exitStatus: 76)
        }

        let ledger = try await LocalIncidentLedgerV1.openForAbruptRestartFixture(
            rootDirectory: URL(fileURLWithPath: rootPath, isDirectory: true),
            scope: probeScope(projectDigest: projectDigest),
            abruptProcessProbe: { point in
                waitForLegacyParentKill(point: point, expected: crashPoint)
            }
        )
        _ = try await ledger.recordForAbruptRestartFixture(probeCandidateObservation())
        try await ledger.close()
    }

    private static func runCR03Main(_ arguments: [String]) async throws {
        guard arguments.count == 7, let root = admitB3BPrivateRoot(arguments[2]),
              admittedDigest(arguments[3]), admittedRequest(arguments[4]),
              let repetition = admittedRepetition(arguments[5]),
              ["control", "aba"].contains(arguments[6]) else {
            failProbe("ARGUMENT_VALUE", exitStatus: 76)
        }
        let request = arguments[4], projectDigest = arguments[3], mode = arguments[6]
        let pid = Darwin.getpid(), deadline = DispatchTime.now().uptimeNanoseconds + b2DeadlineNanoseconds
        let once = CR03Once()
        let ledger: LocalIncidentLedgerV1
        if mode == "aba" {
            ledger = try await LocalIncidentLedgerV1.openForCommitABAFixture(
                rootDirectory: URL(fileURLWithPath: root.canonicalPath, isDirectory: true),
                scope: probeScope(projectDigest: projectDigest),
                beforeCommit: {
                    once.enter()
                    writeProbeBytes("CR03_READY|v1|request=\(request)|repetition=\(repetition)|pid=\(pid)\n", descriptor: STDOUT_FILENO)
                    waitForExactParentFrame("CR03_CONTINUE|v1|request=\(request)|repetition=\(repetition)|pid=\(pid)\n", deadline: deadline)
                    // Require EOF immediately after the one admitted frame. Parent
                    // closes its input writer; duplicate or trailing bytes refuse.
                    var byte: UInt8 = 0
                    var pollFD = pollfd(fd: STDIN_FILENO, events: Int16(POLLIN), revents: 0)
                    while true {
                        let result = Darwin.poll(&pollFD, 1, remainingPollMilliseconds(deadline: deadline))
                        if result < 0 && errno == EINTR { continue }
                        guard result == 1 else { failProbe("CR03_INPUT_NOT_CLOSED", exitStatus: 78) }
                        let count = Darwin.read(STDIN_FILENO, &byte, 1)
                        if count < 0 && errno == EINTR { continue }
                        guard count == 0 else { failProbe("CR03_EXTRA_PARENT_BYTES", exitStatus: 78) }
                        break
                    }
                }
            )
        } else {
            ledger = try await LocalIncidentLedgerV1.open(
                rootDirectory: URL(fileURLWithPath: root.canonicalPath, isDirectory: true),
                scope: probeScope(projectDigest: projectDigest)
            )
        }
        var record = "UNMODELED", candidate = "nil"
        do {
            let disposition = try await ledger.recordForAbruptRestartFixture(probeCandidateObservation())
            if case let .appended(summary) = disposition {
                record = "APPENDED"; candidate = summary.eventDigest
            }
        } catch let error as IncidentLedgerErrorV1 {
            if case let .integrity(message) = error,
               message == "Transaction rollback failed; the ledger was closed and must be reopened." {
                record = "ROLLBACK_POISON"
            }
        } catch { /* Record refusal remains unmodeled, but still attempt close once. */ }
        var close = "UNMODELED"
        do { try await ledger.close(); close = "RETURNED" }
        catch let error as IncidentLedgerErrorV1 {
            if case .sqlite(code: 10, message: _) = error { close = "SQLITE_IOERR" }
        } catch { /* No synthetic success or close retry. */ }
        if mode == "aba" { once.requireOnce() }
        guard revalidateB3BPrivateRoot(root), Darwin.close(root.descriptor) == 0 else {
            failProbe("CR03_ROOT_CLEANUP_REFUSED", exitStatus: 78)
        }
        guard record != "UNMODELED", close != "UNMODELED" else {
            failProbe("CR03_UNMODELED_OPERATION_RESULT", exitStatus: 78)
        }
        writeProbeBytes("CR03_WRITER|v1|request=\(request)|repetition=\(repetition)|record=\(record)|close=\(close)|candidate_digest=\(candidate)|authorizing=false|pid=\(pid)\n", descriptor: STDOUT_FILENO)
        // Process exit, not close() return, precedes a parent's separate recovery.
        Darwin._exit(0)
    }

    private static func runB2CR01(_ arguments: [String]) async throws {
        guard arguments.count == 6 else {
            failProbe("ARGUMENT_CONTRACT", exitStatus: 75)
        }
        let rootPath = arguments[2]
        let projectDigest = arguments[3]
        let request = arguments[4]
        guard
            admittedRoot(rootPath),
            admittedDigest(projectDigest),
            admittedRequest(request),
            let repetition = admittedRepetition(arguments[5])
        else {
            failProbe("ARGUMENT_VALUE", exitStatus: 76)
        }
        let deadline = DispatchTime.now().uptimeNanoseconds + b2DeadlineNanoseconds
        let pid = Darwin.getpid()
        let ledger: LocalIncidentLedgerV1
        do {
            ledger = try await LocalIncidentLedgerV1.openForOpenABAFixture(
                rootDirectory: URL(fileURLWithPath: rootPath, isDirectory: true),
                scope: probeScope(projectDigest: projectDigest),
                openABAProcessProbe: { point in
                    let phase: String
                    switch point {
                    case .beforeSQLiteOpen: phase = "BEFORE_SQLITE_OPEN"
                    case .afterSQLiteOpen: phase = "AFTER_SQLITE_OPEN"
                    }
                    writeProbeBytes(
                        "VERITAS_B2_CHILD|v1|request=\(request)|case=CR-01" +
                            "|repetition=\(repetition)|phase=\(phase)|pid=\(pid)\n",
                        descriptor: STDOUT_FILENO
                    )
                    waitForExactParentFrame(
                        "VERITAS_B2_CONTINUE|v1|request=\(request)|case=CR-01" +
                            "|repetition=\(repetition)|phase=\(phase)|pid=\(pid)\n",
                        deadline: deadline
                    )
                }
            )
        } catch let error as IncidentLedgerErrorV1 {
            // SQLite primary result code 10 is SQLITE_IOERR. Keep the helper's
            // package surface independent of a direct SQLite3 target import.
            guard case let .sqlite(code, _) = error, code == 10 else {
                throw error
            }
            writeProbeBytes(
                "VERITAS_B2_CHILD|v1|request=\(request)|case=CR-01" +
                    "|repetition=\(repetition)|phase=OPEN_SUCCEEDED_BOOTSTRAP_REFUSED" +
                    "|sqlite_code=\(code)|authorizing=false|pid=\(pid)\n",
                descriptor: STDOUT_FILENO
            )
            pauseUntilKilled()
        }
        let verification = try await ledger.verifyIntegrity()
        let list = try await ledger.list(includeTombstoned: true)
        guard
            verification.eventCount == 1,
            verification.observationCount == 1,
            verification.tombstoneCount == 0,
            verification.authorizing == false,
            verification.protectedAuthorityVerified == false,
            verification.rawContentStored == false,
            list.count == 1,
            list.allSatisfy({
                $0.authorizing == false
                    && $0.protectedAuthorityVerified == false
                    && $0.rawContentStored == false
            })
        else {
            throw ProbeContractFailure.invalidResult
        }
        writeProbeBytes(
            "VERITAS_B2_CHILD|v1|request=\(request)|case=CR-01" +
                "|repetition=\(repetition)|phase=OPEN_BOOTSTRAP_VERIFIED" +
                "|events=1|authorizing=false|pid=\(pid)\n",
            descriptor: STDOUT_FILENO
        )
        pauseUntilKilled()
    }

    private static func runB2Abrupt(_ arguments: [String]) async throws {
        guard arguments.count == 7 else {
            failProbe("ARGUMENT_CONTRACT", exitStatus: 75)
        }
        let rootPath = arguments[2]
        let projectDigest = arguments[3]
        let request = arguments[4]
        guard
            admittedRoot(rootPath),
            admittedDigest(projectDigest),
            admittedRequest(request),
            let repetition = admittedRepetition(arguments[5]),
            arguments[6] == IncidentLedgerAbruptProcessPointV1
                .afterObservationCommitBeforeReturn.rawValue
        else {
            failProbe("ARGUMENT_VALUE", exitStatus: 76)
        }
        let pid = Darwin.getpid()
        let ledger = try await LocalIncidentLedgerV1.openForAbruptRestartFixture(
            rootDirectory: URL(fileURLWithPath: rootPath, isDirectory: true),
            scope: probeScope(projectDigest: projectDigest),
            abruptProcessProbe: { point in
                guard point == .afterObservationCommitBeforeReturn else { return }
                writeProbeBytes(
                    "VERITAS_B2_CHILD|v1|request=\(request)|case=CR-05" +
                        "|repetition=\(repetition)|phase=AFTER_OBSERVATION_COMMIT" +
                        "|pid=\(pid)\n",
                    descriptor: STDOUT_FILENO
                )
                pauseUntilKilled()
            }
        )
        _ = try await ledger.recordForAbruptRestartFixture(probeCandidateObservation())
        try await ledger.close()
    }

    private static func runB3CR04Abrupt(_ arguments: [String]) async throws {
        guard arguments.count == 7 else {
            failProbe("ARGUMENT_CONTRACT", exitStatus: 75)
        }
        let rootPath = arguments[2]
        let projectDigest = arguments[3]
        let request = arguments[4]
        guard
            admittedRoot(rootPath),
            admittedDigest(projectDigest),
            admittedRequest(request),
            let repetition = admittedRepetition(arguments[5]),
            arguments[6] == IncidentLedgerAbruptProcessPointV1
                .afterObservationCommitBeforeReturn.rawValue
        else {
            failProbe("ARGUMENT_VALUE", exitStatus: 76)
        }
        let pid = Darwin.getpid()
        let ledger = try await LocalIncidentLedgerV1.openForAbruptRestartFixture(
            rootDirectory: URL(fileURLWithPath: rootPath, isDirectory: true),
            scope: probeScope(projectDigest: projectDigest),
            abruptProcessProbe: { point in
                guard point == .afterObservationCommitBeforeReturn else { return }
                writeProbeBytes(
                    "VERITAS_B3_CHILD|v1|request=\(request)|case=CR-04" +
                        "|variant=WAL_IDENTITY_GENERATOR|repetition=\(repetition)" +
                        "|phase=AFTER_OBSERVATION_COMMIT|pid=\(pid)\n",
                    descriptor: STDOUT_FILENO
                )
                pauseUntilKilled()
            }
        )
        _ = try await ledger.recordForAbruptRestartFixture(probeCandidateObservation())
        try await ledger.close()
    }

    private static func runB3BCR04DivergentAbrupt(_ arguments: [String]) async throws {
        guard arguments.count == 8 else {
            failProbe("ARGUMENT_CONTRACT", exitStatus: 75)
        }
        let rootPath = arguments[2]
        let projectDigest = arguments[3]
        let request = arguments[4]
        guard
            admittedDigest(projectDigest),
            admittedRequest(request),
            let repetition = admittedRepetition(arguments[5]),
            let branch = B3BDivergentBranch(rawValue: arguments[6]),
            arguments[7] == IncidentLedgerAbruptProcessPointV1
                .afterObservationCommitBeforeReturn.rawValue,
            let rootBinding = admitB3BPrivateRoot(rootPath)
        else {
            failProbe("ARGUMENT_VALUE", exitStatus: 76)
        }
        let observation = probeB3BDivergentObservation(
            repetition: repetition,
            branch: branch
        )
        guard probeB3BVerifyFrozenVector(
            repetition: repetition,
            branch: branch,
            observation: observation
        ) else {
            failProbe("B3B_VECTOR_DRIFT", exitStatus: 76)
        }
        guard revalidateB3BPrivateRoot(rootBinding) else {
            _ = Darwin.close(rootBinding.descriptor)
            failProbe("B3B_ROOT_IDENTITY_DRIFT", exitStatus: 78)
        }
        let pid = Darwin.getpid()
        let ledger = try await LocalIncidentLedgerV1.openForAbruptRestartFixture(
            rootDirectory: URL(fileURLWithPath: rootBinding.canonicalPath, isDirectory: true),
            scope: probeScope(projectDigest: projectDigest),
            abruptProcessProbe: { point in
                guard point == .afterObservationCommitBeforeReturn else { return }
                guard revalidateB3BPrivateRoot(rootBinding) else {
                    failProbe("B3B_ROOT_IDENTITY_DRIFT", exitStatus: 78)
                }
                writeProbeBytes(
                    "VERITAS_B3_CHILD|v1|request=\(request)|case=CR-04" +
                        "|variant=WAL_DIVERGENT_GENERATOR|repetition=\(repetition)" +
                        "|branch=\(branch.rawValue)|phase=AFTER_OBSERVATION_COMMIT" +
                        "|pid=\(pid)\n",
                    descriptor: STDOUT_FILENO
                )
                pauseUntilKilled()
            }
        )
        _ = try await ledger.recordForAbruptRestartFixture(observation)
        try await ledger.close()
        _ = Darwin.close(rootBinding.descriptor)
    }

    private static func runB3BCR04DivergentRecovery(_ arguments: [String]) async throws {
        guard arguments.count == 11 else {
            failProbe("ARGUMENT_CONTRACT", exitStatus: 75)
        }
        let rootPath = arguments[2]
        let projectDigest = arguments[3]
        let request = arguments[4]
        guard
            admittedDigest(projectDigest),
            admittedRequest(request),
            let repetition = admittedRepetition(arguments[5]),
            let expectedState = B3BDivergentRecoveryState(rawValue: arguments[6]),
            let purpose = B3BDivergentRecoveryPurpose(rawValue: arguments[7]),
            admittedIncidentID(arguments[8]),
            admittedDigest(arguments[9]),
            let rootBinding = admitB3BPrivateRoot(rootPath)
        else {
            failProbe("ARGUMENT_VALUE", exitStatus: 76)
        }
        let expectedHeadArgument = arguments[10]
        let admittedCombination: Bool
        switch (expectedState, purpose) {
        case (.m0, .baselineExact):
            admittedCombination = admittedDigest(expectedHeadArgument)
        case (.a, .controlDiscover), (.b, .controlDiscover):
            admittedCombination = expectedHeadArgument == "DISCOVER"
        case (.b, .finalExact):
            admittedCombination = admittedDigest(expectedHeadArgument)
        default:
            admittedCombination = false
        }
        guard admittedCombination else {
            _ = Darwin.close(rootBinding.descriptor)
            failProbe("ARGUMENT_VALUE", exitStatus: 76)
        }

        let expectedBaselineIncidentID = arguments[8]
        let expectedBaselineEventDigest = arguments[9]
        let baselineObservation = probeB3BBaselineObservation(repetition: repetition)
        guard baselineObservation.incidentID == expectedBaselineIncidentID else {
            _ = Darwin.close(rootBinding.descriptor)
            failProbe("B3B_BASELINE_VECTOR_DRIFT", exitStatus: 76)
        }
        let branchA = probeB3BDivergentObservation(repetition: repetition, branch: .a)
        let branchB = probeB3BDivergentObservation(repetition: repetition, branch: .b)
        guard
            probeB3BVerifyFrozenVector(repetition: repetition, branch: .a, observation: branchA),
            probeB3BVerifyFrozenVector(repetition: repetition, branch: .b, observation: branchB)
        else {
            _ = Darwin.close(rootBinding.descriptor)
            failProbe("B3B_VECTOR_DRIFT", exitStatus: 76)
        }

        guard revalidateB3BPrivateRoot(rootBinding) else {
            _ = Darwin.close(rootBinding.descriptor)
            failProbe("B3B_ROOT_IDENTITY_DRIFT", exitStatus: 78)
        }

        let ledger = try await LocalIncidentLedgerV1.open(
            rootDirectory: URL(fileURLWithPath: rootBinding.canonicalPath, isDirectory: true),
            scope: probeScope(projectDigest: projectDigest)
        )
        let verification = try await ledger.verifyIntegrity()
        let list = try await ledger.list(includeTombstoned: true)
        let baseline = list.first { $0.incidentID == baselineObservation.incidentID }
        let foundA = list.first { $0.incidentID == branchA.incidentID }
        let foundB = list.first { $0.incidentID == branchB.incidentID }
        let expectedEvents: Int64 = expectedState == .m0 ? 1 : 2
        let branchAPresent = foundA != nil
        let branchBPresent = foundB != nil
        let expectedBranchSummary: IncidentSummaryV1?
        let expectedBranchObservation: IncidentObservationInputV1?
        switch expectedState {
        case .m0:
            expectedBranchSummary = nil
            expectedBranchObservation = nil
        case .a:
            expectedBranchSummary = foundA
            expectedBranchObservation = branchA
        case .b:
            expectedBranchSummary = foundB
            expectedBranchObservation = branchB
        }
        let baselineExact = baseline.map {
            probeMatchesObservationSummary(
                $0,
                observation: baselineObservation,
                projectDigest: projectDigest,
                ordinal: 1,
                expectedEventDigest: expectedBaselineEventDigest
            )
        } ?? false
        let branchExact: Bool
        if let expectedBranchSummary, let expectedBranchObservation {
            branchExact = probeMatchesObservationSummary(
                expectedBranchSummary,
                observation: expectedBranchObservation,
                projectDigest: projectDigest,
                ordinal: 2
            ) && expectedBranchSummary.eventDigest == verification.headDigest
        } else {
            branchExact = true
        }
        let expectedPresence: Bool
        switch expectedState {
        case .m0: expectedPresence = !branchAPresent && !branchBPresent
        case .a: expectedPresence = branchAPresent && !branchBPresent
        case .b: expectedPresence = !branchAPresent && branchBPresent
        }
        let computedHead = verification.headDigest
        let headExact: Bool
        switch purpose {
        case .controlDiscover:
            headExact = admittedDigest(computedHead)
        case .baselineExact, .finalExact:
            headExact = computedHead == expectedHeadArgument
        }
        guard
            verification.eventCount == expectedEvents,
            verification.observationCount == expectedEvents,
            verification.tombstoneCount == 0,
            verification.authorizing == false,
            verification.protectedAuthorityVerified == false,
            verification.rawContentStored == false,
            Int64(list.count) == expectedEvents,
            baselineExact,
            branchExact,
            expectedPresence,
            headExact,
            list.allSatisfy({
                $0.authorizing == false
                    && $0.protectedAuthorityVerified == false
                    && $0.rawContentStored == false
            })
        else {
            throw ProbeContractFailure.invalidResult
        }
        try await ledger.close()
        guard revalidateB3BPrivateRoot(rootBinding) else {
            _ = Darwin.close(rootBinding.descriptor)
            failProbe("B3B_ROOT_IDENTITY_DRIFT", exitStatus: 78)
        }
        guard Darwin.close(rootBinding.descriptor) == 0 else {
            failProbe("B3B_ROOT_DESCRIPTOR_CLOSE", exitStatus: 78)
        }
        let pid = Darwin.getpid()
        writeProbeBytes(
            "VERITAS_B3_RECOVERY|v1|request=\(request)|case=CR-04" +
                "|variant=WAL_DIVERGENT_RECOVERY|repetition=\(repetition)" +
                "|state=\(expectedState.rawValue)|purpose=\(purpose.rawValue)" +
                "|outcome=RECOVERED_EXACT|events=\(expectedEvents)" +
                "|branch_a_present=\(branchAPresent)" +
                "|branch_b_present=\(branchBPresent)|baseline_exact=true" +
                "|head_digest=\(computedHead)|authorizing=false|pid=\(pid)\n",
            descriptor: STDOUT_FILENO
        )
        Darwin._exit(0)
    }

    private static func cr09AdmitExisting(
        rootBinding: B3BPrivateRootBinding,
        projectDigest: String,
        node: CR09Node,
        expectedH0: String,
        expectedHead: String,
        installedSourceMainDigest: String
    ) async throws -> (chain: CR09RawChain, inventory: CR09ProjectInventory) {
        let pristine = try cr09ProjectInventory(
            rootBinding: rootBinding,
            projectDigest: projectDigest,
            requireMainOnly: true
        )
        guard
            pristine.mainDigest == installedSourceMainDigest,
            pristine.fileDigests == [
                "incident-ledger-v1.sqlite3": installedSourceMainDigest,
            ]
        else {
            throw ProbeContractFailure.invalidResult
        }
        let before = try cr09ReadRawChain(
            rootBinding: rootBinding,
            projectDigest: projectDigest,
            node: node,
            expectedH0: expectedH0,
            expectedHead: expectedHead
        )
        try await cr09VerifyThroughLedger(
            rootBinding: rootBinding,
            projectDigest: projectDigest,
            node: node,
            expectedH0: expectedH0,
            expectedHead: expectedHead
        )
        let after = try cr09ReadRawChain(
            rootBinding: rootBinding,
            projectDigest: projectDigest,
            node: node,
            expectedH0: expectedH0,
            expectedHead: expectedHead
        )
        guard
            before.node == after.node,
            before.eventCount == after.eventCount,
            before.h0 == after.h0,
            before.predecessorDigest == after.predecessorDigest,
            before.headDigest == after.headDigest
        else {
            throw ProbeContractFailure.invalidResult
        }
        let inventory = try cr09ProjectInventory(
            rootBinding: rootBinding,
            projectDigest: projectDigest,
            requireMainOnly: false
        )
        return (after, inventory)
    }

    private static func runCR09Build(_ arguments: [String]) async throws {
        guard arguments.count == 7 else {
            failProbe("ARGUMENT_CONTRACT", exitStatus: 75)
        }
        let rootPath = arguments[2]
        let projectDigest = arguments[3]
        let request = arguments[4]
        guard
            projectDigest == cr09ProjectDigest,
            admittedRequest(request),
            let node = CR09Node(rawValue: arguments[5]),
            probeCR09FrozenConstantsAreExact(),
            let rootBinding = admitB3BPrivateRoot(rootPath)
        else {
            failProbe("ARGUMENT_VALUE", exitStatus: 76)
        }
        let expectedInputHead = arguments[6]
        let inputCombinationExact: Bool
        switch node {
        case .p:
            let projectsAlreadyExists = try cr09RelativeEntryExists(
                directoryDescriptor: rootBinding.descriptor,
                name: "projects"
            )
            inputCombinationExact = expectedInputHead == "GENESIS"
                && !projectsAlreadyExists
        case .a, .b:
            inputCombinationExact = admittedDigest(expectedInputHead)
        }
        guard inputCombinationExact else {
            _ = Darwin.close(rootBinding.descriptor)
            failProbe("ARGUMENT_VALUE", exitStatus: 76)
        }

        if node != .p {
            let inputInventory = try cr09ProjectInventory(
                rootBinding: rootBinding,
                projectDigest: projectDigest,
                requireMainOnly: true
            )
            let input = try cr09ReadRawChain(
                rootBinding: rootBinding,
                projectDigest: projectDigest,
                node: .p,
                expectedH0: expectedInputHead,
                expectedHead: expectedInputHead
            )
            guard
                inputInventory.fileDigests.count == 1,
                input.h0 == expectedInputHead,
                input.headDigest == expectedInputHead
            else {
                throw ProbeContractFailure.invalidResult
            }
            try await cr09VerifyThroughLedger(
                rootBinding: rootBinding,
                projectDigest: projectDigest,
                node: .p,
                expectedH0: expectedInputHead,
                expectedHead: expectedInputHead
            )
        }

        let ledger = try await LocalIncidentLedgerV1.open(
            rootDirectory: URL(
                fileURLWithPath: rootBinding.canonicalPath,
                isDirectory: true
            ),
            scope: probeScope(projectDigest: projectDigest)
        )
        if node == .p {
            let initial = try await ledger.verifyIntegrity()
            let initialList = try await ledger.list(includeTombstoned: true)
            guard
                initial.eventCount == 0,
                initial.observationCount == 0,
                initial.tombstoneCount == 0,
                initial.headDigest == cr09GenesisDigest,
                initial.authorizing == false,
                initial.protectedAuthorityVerified == false,
                initial.rawContentStored == false,
                initialList.isEmpty
            else {
                throw ProbeContractFailure.invalidResult
            }
        }
        let disposition = try await ledger.recordForAbruptRestartFixture(
            probeCR09Observation(node)
        )
        guard case let .appended(appendedSummary) = disposition else {
            throw ProbeContractFailure.invalidResult
        }
        let verification = try await ledger.verifyIntegrity()
        let list = try await ledger.list(includeTombstoned: true)
        try await ledger.close()
        guard
            verification.eventCount == node.expectedEvents,
            verification.observationCount == node.expectedEvents,
            verification.tombstoneCount == 0,
            verification.headDigest == appendedSummary.eventDigest,
            verification.authorizing == false,
            verification.protectedAuthorityVerified == false,
            verification.rawContentStored == false,
            Int64(list.count) == node.expectedEvents,
            probeMatchesObservationSummary(
                appendedSummary,
                observation: probeCR09Observation(node),
                projectDigest: projectDigest,
                ordinal: node == .p ? 1 : 2,
                expectedEventDigest: verification.headDigest
            )
        else {
            throw ProbeContractFailure.invalidResult
        }
        let chain = try cr09ReadRawChain(
            rootBinding: rootBinding,
            projectDigest: projectDigest,
            node: node,
            expectedH0: node == .p ? verification.headDigest : expectedInputHead,
            expectedHead: verification.headDigest
        )
        let inventory = try cr09ProjectInventory(
            rootBinding: rootBinding,
            projectDigest: projectDigest,
            requireMainOnly: false
        )
        guard
            inventory.fileDigests["incident-ledger-v1.sqlite3"] == inventory.mainDigest,
            chain.headDigest == verification.headDigest,
            chain.predecessorDigest == (node == .p ? cr09GenesisDigest : expectedInputHead),
            Darwin.close(rootBinding.descriptor) == 0
        else {
            throw ProbeContractFailure.invalidResult
        }
        let pid = Darwin.getpid()
        writeProbeBytes(
            "VERITAS_B3_CHILD|v1|request=\(request)|case=CR-09|variant=FORK_BUILD" +
                "|node=\(node.rawValue)|phase=CLOSED_AND_INSPECTED_EXACT" +
                "|events=\(node.expectedEvents)" +
                "|stored_predecessor_digest=\(chain.predecessorDigest)" +
                "|head_digest=\(chain.headDigest)" +
                "|post_close_inventory_admitted=true|authorizing=false|pid=\(pid)\n",
            descriptor: STDOUT_FILENO
        )
        Darwin._exit(0)
    }

    private static func runCR09Control(_ arguments: [String]) async throws {
        guard arguments.count == 9 else {
            failProbe("ARGUMENT_CONTRACT", exitStatus: 75)
        }
        let rootPath = arguments[2]
        let projectDigest = arguments[3]
        let request = arguments[4]
        guard
            projectDigest == cr09ProjectDigest,
            admittedRequest(request),
            let node = CR09Node(rawValue: arguments[5]),
            admittedDigest(arguments[6]),
            admittedDigest(arguments[7]),
            admittedDigest(arguments[8]),
            probeCR09FrozenConstantsAreExact(),
            let rootBinding = admitB3BPrivateRoot(rootPath)
        else {
            failProbe("ARGUMENT_VALUE", exitStatus: 76)
        }
        let expectedH0 = arguments[6]
        let expectedHead = arguments[7]
        let sourceMainDigest = arguments[8]
        guard (node == .p) == (expectedH0 == expectedHead) else {
            _ = Darwin.close(rootBinding.descriptor)
            failProbe("ARGUMENT_VALUE", exitStatus: 76)
        }
        let admitted = try await cr09AdmitExisting(
            rootBinding: rootBinding,
            projectDigest: projectDigest,
            node: node,
            expectedH0: expectedH0,
            expectedHead: expectedHead,
            installedSourceMainDigest: sourceMainDigest
        )
        guard
            admitted.inventory.fileDigests["incident-ledger-v1.sqlite3"]
                == admitted.inventory.mainDigest,
            Darwin.close(rootBinding.descriptor) == 0
        else {
            throw ProbeContractFailure.invalidResult
        }
        let pid = Darwin.getpid()
        writeProbeBytes(
            "VERITAS_B3_CHILD|v1|request=\(request)|case=CR-09" +
                "|variant=FORK_SOURCE_CONTROL|node=\(node.rawValue)|phase=ADMITTED_EXACT" +
                "|events=\(admitted.chain.eventCount)" +
                "|baseline_event_digest=\(admitted.chain.h0)" +
                "|stored_predecessor_digest=\(admitted.chain.predecessorDigest)" +
                "|head_digest=\(admitted.chain.headDigest)" +
                "|installed_source_main_digest=\(sourceMainDigest)" +
                "|post_close_inventory_admitted=true|authorizing=false|pid=\(pid)\n",
            descriptor: STDOUT_FILENO
        )
        Darwin._exit(0)
    }

    private static func runCR09Present(_ arguments: [String]) async throws {
        guard arguments.count == 12 else {
            failProbe("ARGUMENT_CONTRACT", exitStatus: 75)
        }
        let rootPath = arguments[2]
        let projectDigest = arguments[3]
        let request = arguments[4]
        guard
            projectDigest == cr09ProjectDigest,
            admittedRequest(request),
            let repetition = admittedRepetition(arguments[5]),
            arguments[5] == String(repetition),
            let order = CR09Order(rawValue: arguments[6]),
            let position = CR09Position(rawValue: arguments[7]),
            let branch = CR09Node(rawValue: arguments[8]),
            branch != .p,
            admittedDigest(arguments[9]),
            admittedDigest(arguments[10]),
            admittedDigest(arguments[11]),
            probeCR09FrozenConstantsAreExact(),
            let rootBinding = admitB3BPrivateRoot(rootPath)
        else {
            failProbe("ARGUMENT_VALUE", exitStatus: 76)
        }
        let combinationExact: Bool
        switch (repetition, order, position, branch) {
        case (0, .ab, .first, .a), (0, .ab, .second, .b),
             (1, .ba, .first, .b), (1, .ba, .second, .a):
            combinationExact = true
        default:
            combinationExact = false
        }
        guard combinationExact else {
            _ = Darwin.close(rootBinding.descriptor)
            failProbe("ARGUMENT_VALUE", exitStatus: 76)
        }
        let expectedH0 = arguments[9]
        let expectedHead = arguments[10]
        let sourceMainDigest = arguments[11]
        guard expectedH0 != expectedHead else {
            _ = Darwin.close(rootBinding.descriptor)
            failProbe("ARGUMENT_VALUE", exitStatus: 76)
        }
        let admitted = try await cr09AdmitExisting(
            rootBinding: rootBinding,
            projectDigest: projectDigest,
            node: branch,
            expectedH0: expectedH0,
            expectedHead: expectedHead,
            installedSourceMainDigest: sourceMainDigest
        )
        guard
            admitted.chain.predecessorDigest == expectedH0,
            admitted.chain.headDigest == expectedHead,
            admitted.inventory.fileDigests["incident-ledger-v1.sqlite3"]
                == admitted.inventory.mainDigest,
            Darwin.close(rootBinding.descriptor) == 0
        else {
            throw ProbeContractFailure.invalidResult
        }
        let pid = Darwin.getpid()
        writeProbeBytes(
            "VERITAS_B3_CHILD|v1|request=\(request)|case=CR-09" +
                "|variant=FORK_PRESENTATION|repetition=\(repetition)" +
                "|order=\(order.rawValue)|position=\(position.rawValue)" +
                "|branch=\(branch.rawValue)|phase=ADMITTED_EXACT|events=2" +
                "|baseline_event_digest=\(admitted.chain.h0)" +
                "|stored_predecessor_digest=\(admitted.chain.predecessorDigest)" +
                "|branch_event_digest=\(admitted.chain.headDigest)" +
                "|head_digest=\(admitted.chain.headDigest)" +
                "|installed_source_main_digest=\(sourceMainDigest)" +
                "|baseline_present=true|expected_branch_present=true" +
                "|opposite_branch_present=false|pristine_main_only_before_open=true" +
                "|closed_project_inventory_exact=true" +
                "|post_close_inventory_admitted=true" +
                "|protected_authority_verified=false|authorizing=false|pid=\(pid)\n",
            descriptor: STDOUT_FILENO
        )
        Darwin._exit(0)
    }

    private static func runB2Recovery(_ arguments: [String]) async throws {
        guard arguments.count == 10 else {
            failProbe("ARGUMENT_CONTRACT", exitStatus: 75)
        }
        let rootPath = arguments[2]
        let projectDigest = arguments[3]
        let request = arguments[4]
        guard
            admittedRoot(rootPath),
            admittedDigest(projectDigest),
            admittedRequest(request),
            let recoveryCase = B2RecoveryCase(rawValue: arguments[5]),
            let repetition = admittedRepetition(arguments[6]),
            let expectedEvents = Int64(arguments[7]),
            expectedEvents == recoveryCase.expectedEvents,
            admittedIncidentID(arguments[8]),
            admittedDigest(arguments[9])
        else {
            failProbe("ARGUMENT_VALUE", exitStatus: 76)
        }
        let expectedBaselineIncidentID = arguments[8]
        let expectedBaselineEventDigest = arguments[9]
        let pid = Darwin.getpid()
        do {
            let ledger = try await LocalIncidentLedgerV1.open(
                rootDirectory: URL(fileURLWithPath: rootPath, isDirectory: true),
                scope: probeScope(projectDigest: projectDigest)
            )
            let verification = try await ledger.verifyIntegrity()
            let list = try await ledger.list(includeTombstoned: true)
            let baseline = list.first {
                $0.incidentID == expectedBaselineIncidentID
            }
            let candidate = list.first {
                $0.incidentID == probeCandidateObservation().incidentID
            }
            let candidatePresent = candidate != nil
            guard
                verification.eventCount == expectedEvents,
                verification.observationCount == expectedEvents,
                verification.tombstoneCount == 0,
                verification.authorizing == false,
                verification.protectedAuthorityVerified == false,
                verification.rawContentStored == false,
                Int64(list.count) == expectedEvents,
                baseline?.projectDigest == projectDigest,
                baseline?.ordinal == 1,
                baseline?.eventDigest == expectedBaselineEventDigest,
                candidatePresent == recoveryCase.expectsCandidate,
                recoveryCase.expectsCandidate
                    ? (candidate.map {
                        matchesCandidateSummary($0, projectDigest: projectDigest)
                            && verification.headDigest == $0.eventDigest
                    } ?? false)
                    : verification.headDigest == expectedBaselineEventDigest,
                list.allSatisfy({
                    $0.authorizing == false
                        && $0.protectedAuthorityVerified == false
                        && $0.rawContentStored == false
                })
            else {
                throw ProbeContractFailure.invalidResult
            }
            try await ledger.close()
            writeProbeBytes(
                "VERITAS_B2_RECOVERY|v1|request=\(request)|case=\(recoveryCase.rawValue)" +
                    "|repetition=\(repetition)|outcome=RECOVERED_EXACT" +
                    "|events=\(expectedEvents)|candidate_present=\(candidatePresent)" +
                    "|head_digest=\(verification.headDigest)" +
                    "|authorizing=false|pid=\(pid)\n",
                descriptor: STDOUT_FILENO
            )
            Darwin._exit(0)
        } catch let error as IncidentLedgerErrorV1 {
            switch error {
            case .integrity:
                writeProbeBytes(
                    "VERITAS_B2_RECOVERY|v1|request=\(request)" +
                        "|case=\(recoveryCase.rawValue)|repetition=\(repetition)" +
                        "|outcome=REFUSED_INTEGRITY|authorizing=false|pid=\(pid)\n",
                    descriptor: STDOUT_FILENO
                )
            case let .sqlite(code, _):
                writeProbeBytes(
                    "VERITAS_B2_RECOVERY|v1|request=\(request)" +
                        "|case=\(recoveryCase.rawValue)|repetition=\(repetition)" +
                        "|outcome=REFUSED_SQLITE|sqlite_code=\(code)" +
                        "|authorizing=false|pid=\(pid)\n",
                    descriptor: STDOUT_FILENO
                )
            default:
                throw error
            }
            Darwin._exit(0)
        }
    }
}
