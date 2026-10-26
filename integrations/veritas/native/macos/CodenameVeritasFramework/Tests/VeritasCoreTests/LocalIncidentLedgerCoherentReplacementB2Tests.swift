import VeritasTestEvidenceSupport
import Darwin
import Dispatch
import Foundation
import Testing
@testable import VeritasCore

private enum CoherentReplacementB2Failure: Error {
    case filesystem(String)
    case process(String)
    case protocolViolation(String)
    case unexpected(String)
}

private enum CR09TestNode: String {
    case p = "P"
    case a = "A"
    case b = "B"

    var eventCount: Int64 { self == .p ? 1 : 2 }
}

private enum CR09TestOrder: String {
    case ab = "AB"
    case ba = "BA"
}

private enum CR09TestPosition: String {
    case first = "FIRST"
    case second = "SECOND"
}

private struct CR09TestChildResult {
    let node: CR09TestNode
    let h0: String
    let predecessor: String
    let head: String
    let installedMainDigest: String?
    let pid: Int32
}

private struct CR09TestProjectManifest {
    let identity: CoherentReplacementB2Identity
    let permissions: mode_t
    let files: [String: CoherentReplacementB2RegularState]
}

private struct CR09TestFrozenSource {
    let fixture: CR09TestFixture
    let snapshot: CoherentReplacementB3RegularSnapshot
    let manifest: CR09TestProjectManifest
}

private struct CR09TestOrderResult {
    let fixture: CR09TestFixture
    let projectsBinding: CoherentReplacementB3DirectoryBinding
    let retiredName: String
    let retiredManifest: CR09TestProjectManifest
    let canonicalManifest: CR09TestProjectManifest
    let firstHead: String
    let secondHead: String
    let firstPID: Int32
    let secondPID: Int32
}

private struct CR09TestParentResult {
    let repetition: Int
    let order: CR09TestOrder
    let h0: String
    let hA: String
    let hB: String
    let sourceADigest: String
    let sourceBDigest: String
    let firstHead: String
    let secondHead: String
}

private final class CR09TestFixture {
    let familyID: String
    let role: String
    let root: URL
    let rootBinding: CoherentReplacementB3DirectoryBinding
    let custody: CoherentReplacementB2FixtureCustody
    private(set) var projectsBinding: CoherentReplacementB3DirectoryBinding?
    private(set) var temporaryDirectoryBindings =
        [String: CoherentReplacementB3DirectoryBinding]()

    var temporaryDirectoryNames: Set<String> {
        Set(temporaryDirectoryBindings.keys)
    }

    init(familyID: String, role: String) throws {
        self.familyID = familyID
        self.role = role
        root = try coherentReplacementB3BRoot("cr09-\(familyID)-\(role)")
        custody = CoherentReplacementB2FixtureCustody(root: root)
        rootBinding = try coherentReplacementB3DirectoryBinding(root)
    }

    func makeChildTemporaryDirectory(_ label: String) throws -> URL {
        let name = "cr09-tmp-\(label)-\(cr09TestCompactUUID())"
        guard temporaryDirectoryBindings[name] == nil else {
            throw CoherentReplacementB2Failure.unexpected(
                "A CR-09 child TMPDIR name was not unique."
            )
        }
        let directory = root.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: false,
            attributes: [.posixPermissions: NSNumber(value: 0o700)]
        )
        temporaryDirectoryBindings[name] = try coherentReplacementB3DirectoryBinding(directory)
        return directory
    }

    func bindProjectsDirectory(_ binding: CoherentReplacementB3DirectoryBinding) throws {
        if let projectsBinding {
            guard projectsBinding.identity == binding.identity,
                  projectsBinding.permissions == binding.permissions else {
                throw CoherentReplacementB2Failure.unexpected(
                    "The CR-09 projects directory binding changed."
                )
            }
        } else {
            projectsBinding = binding
        }
    }
}

private let cr09TestProjectDigest =
    "1a41e406287e2dd2f4696878d59964eca256ced61e00a467e60d1d018c5ff969"
private let cr09TestAccessDigest =
    "dcc995ac46821de27687dd47a3a38783fd36fa903edadd814e315b37abfe8ff3"
private let cr09TestRetentionDigest =
    "ec4e487a3eadc0adf75428018e930f4bb638c84fd7b3776c017b82c86300777e"
private let cr09TestGenesisDigest =
    "d1aa6e848bafc99c0a9789496990747ffc9d0e738328511832dcc0ecc7557866"
private let cr09TestMainName = "incident-ledger-v1.sqlite3"

private func cr09TestCompactUUID() -> String {
    UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "")
}

private func cr09TestScope() -> IncidentLedgerScopeV1 {
    IncidentLedgerScopeV1(
        scopeID: "scope/veritas-private",
        projectDigest: cr09TestProjectDigest,
        accessPolicyDigest: cr09TestAccessDigest,
        retentionPolicyDigest: cr09TestRetentionDigest
    )
}

private func cr09TestObservation(_ node: CR09TestNode) -> IncidentObservationInputV1 {
    let domain = "veritas-cr09-closed-sibling-v1|node=\(node.rawValue)|field="
    let offset: TimeInterval = node == .p ? 0 : node == .a ? 1 : 2
    return IncidentObservationInputV1(
        incidentID: "incident/" + coherentReplacementB2Digest(domain + "incident"),
        observationKey: coherentReplacementB2Digest(domain + "observation"),
        subjectIDDigest: coherentReplacementB2Digest(domain + "subject-id"),
        subjectContentDigest: coherentReplacementB2Digest(domain + "subject-content"),
        evidenceSetDigest: coherentReplacementB2Digest(domain + "evidence"),
        failureCodes: node == .p
            ? [.factEvidenceMissing, .requirementMissing]
            : [.deterministicCheckFailed, .testFailed],
        symptomCodes: node == .p
            ? [.missingCitation, .missingSection]
            : [.failingTest],
        observedAt: Date(timeIntervalSince1970: 1_920_000_000 + offset),
        retentionReviewAt: Date(timeIntervalSince1970: 1_927_776_000 + offset)
    )
}

private func cr09TestVerifyFrozenConstants() throws {
    // Deliberately an INDEPENDENT re-derivation of the v1 frame layout
    // ([u8 tag][u64 BE length][value], tag 0 domain / tag 1 field), NOT a call
    // into VeritasDigestFrameV1. Sharing the primitive here would turn this
    // frozen-constant check into a tautology against the code it is checking.
    var frames = Data()
    for (tag, value) in [
        (UInt8(0x00), "veritas-founder-alpha-incident-ledger-genesis-v1"),
        (UInt8(0x01), "veritas-founder-alpha-local-incident-ledger-v1"),
        (UInt8(0x01), "scope/veritas-private"),
        (UInt8(0x01), cr09TestProjectDigest),
        (UInt8(0x01), cr09TestAccessDigest),
        (UInt8(0x01), cr09TestRetentionDigest),
    ] {
        frames.append(tag)
        var length = UInt64(value.utf8.count).bigEndian
        withUnsafeBytes(of: &length) { frames.append(contentsOf: $0) }
        frames.append(contentsOf: value.utf8)
    }
    let expected: [CR09TestNode: [String]] = [
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
    let scope = cr09TestScope()
    guard
        coherentReplacementB2Digest("veritas-cr09-closed-sibling-v1|scope=project")
            == cr09TestProjectDigest,
        coherentReplacementB2Digest("veritas-abrupt-restart-access-policy")
            == cr09TestAccessDigest,
        LocalIncidentLedgerV1.profile == "veritas-founder-alpha-local-incident-ledger-v1",
        LocalIncidentLedgerV1.retentionPolicyProfile
            == "veritas-founder-alpha-user-tombstone-and-retention-review-v1",
        LocalIncidentLedgerV1.retentionPolicyDigest == cr09TestRetentionDigest,
        scope.scopeID == "scope/veritas-private",
        scope.projectDigest == cr09TestProjectDigest,
        scope.accessPolicyDigest == cr09TestAccessDigest,
        scope.retentionPolicyDigest == cr09TestRetentionDigest,
        ArtifactSnapshot.digest(frames) == cr09TestGenesisDigest
    else {
        throw CoherentReplacementB2Failure.unexpected("CR-09 frozen scope drifted.")
    }
    for node in [CR09TestNode.p, .a, .b] {
        guard let vector = expected[node], vector.count == 5 else {
            throw CoherentReplacementB2Failure.unexpected("CR-09 vector missing.")
        }
        let observation = cr09TestObservation(node)
        let expectedFailureCodes: [IncidentFailureCodeV1] = node == .p
            ? [.factEvidenceMissing, .requirementMissing]
            : [.deterministicCheckFailed, .testFailed]
        let expectedSymptomCodes: [IncidentSymptomCodeV1] = node == .p
            ? [.missingCitation, .missingSection]
            : [.failingTest]
        let expectedOffset: TimeInterval = node == .p ? 0 : node == .a ? 1 : 2
        guard
            observation.incidentID == "incident/" + vector[0],
            observation.observationKey == vector[1],
            observation.subjectIDDigest == vector[2],
            observation.subjectContentDigest == vector[3],
            observation.evidenceSetDigest == vector[4],
            observation.failureCodes == expectedFailureCodes,
            observation.symptomCodes == expectedSymptomCodes,
            observation.observedAt
                == Date(timeIntervalSince1970: 1_920_000_000 + expectedOffset),
            observation.retentionReviewAt
                == Date(timeIntervalSince1970: 1_927_776_000 + expectedOffset)
        else {
            throw CoherentReplacementB2Failure.unexpected("CR-09 vector drifted.")
        }
    }
}

private struct CoherentReplacementB2Identity: Equatable {
    let device: UInt64
    let inode: UInt64
}

private struct CoherentReplacementB2RegularState {
    let identity: CoherentReplacementB2Identity
    let permissions: mode_t
    let byteCount: Int64
    let digest: String
}

private struct CoherentReplacementB2WALState {
    let pageSize: Int64
    let physicalFrameCapacity: Int64
    let byteCount: Int64
}

private struct CoherentReplacementB2ExecutableAdmission {
    let url: URL
    let identity: CoherentReplacementB2Identity
    let byteCount: Int64
    let digest: String
}

private enum CoherentReplacementB2RecoveryOutcome: Equatable {
    case recoveredExact(headDigest: String)
    case refusedIntegrity
    case refusedSQLite(Int32)
}

private enum CoherentReplacementB2CR01Outcome: Equatable {
    case bootstrapVerified
    case bootstrapRefusedSQLiteIOError
}

private enum CoherentReplacementB2SHMMutation: String {
    case remove
    case corrupt

    var recoveryCase: String {
        switch self {
        case .remove: "CR-05-SHM-REMOVE"
        case .corrupt: "CR-05-SHM-CORRUPT"
        }
    }

    var resultTarget: String {
        switch self {
        case .remove: "post-kill-shm-remove"
        case .corrupt: "post-kill-shm-corrupt"
        }
    }
}

private enum CoherentReplacementB3BBranch: String {
    case a = "A"
    case b = "B"

    var timeOffset: TimeInterval { self == .a ? 1 : 2 }
}

private enum CoherentReplacementB3BRecoveryState: String {
    case m0 = "M0"
    case a = "A"
    case b = "B"
}

private enum CoherentReplacementB3BRecoveryPurpose: String {
    case baselineExact = "BASELINE_EXACT"
    case controlDiscover = "CONTROL_DISCOVER"
    case finalExact = "FINAL_EXACT"
}

private struct CoherentReplacementB3BPreparedRoot {
    let root: URL
    let rootBinding: CoherentReplacementB3DirectoryBinding
    let project: URL
    let projectBinding: CoherentReplacementB3DirectoryBinding
    let main: CoherentReplacementB2RegularState
    let wal: CoherentReplacementB2RegularState?
}

private final class CoherentReplacementB2FixtureCustody {
    let root: URL
    private var liveChildren = 0
    private var retainedForSafety = false

    init(root: URL) {
        self.root = root
    }

    func childStarted() {
        liveChildren += 1
    }

    func childReaped() {
        guard liveChildren > 0 else {
            retain("child custody accounting underflow")
            return
        }
        liveChildren -= 1
    }

    func retain(_ reason: String) {
        retainedForSafety = true
        Issue.record("Retaining isolated Baseline B2 root for safety: \(reason)")
    }

    func removeIfSafe() {
        guard !retainedForSafety, liveChildren == 0 else {
            Issue.record(
                "Isolated Baseline B2 root was retained because child custody was not closed."
            )
            return
        }
        // Intentionally retain every validated private fixture. A prior implementation
        // recursively deleted this pathname after inventory validation; a same-UID
        // rename or replacement in that gap could redirect deletion to an unrelated
        // tree. Destructive cleanup stays disabled until a separately reviewed,
        // descriptor-relative quarantine and whitelist-unlink protocol exists.
    }
}

private final class CoherentReplacementB2ProcessSession {
    let process: Process
    let outputReader: FileHandle
    let errorReader: FileHandle
    let inputWriter: FileHandle?
    let custody: CoherentReplacementB2FixtureCustody
    let termination = DispatchSemaphore(value: 0)
    var reaped = false
    private(set) var launchUptimeNanoseconds: UInt64 = 0
    private var inputWriterCloseAttempted = false
    private var outputReaderCloseAttempted = false
    private var errorReaderCloseAttempted = false
    private var parentHandleCloseFailed = false

    init(
        executable: CoherentReplacementB2ExecutableAdmission,
        arguments: [String],
        acceptsInput: Bool,
        custody: CoherentReplacementB2FixtureCustody,
        failureContainmentDeadline: UInt64? = nil,
        exactEnvironment: [String: String]? = nil
    ) throws {
        self.custody = custody
        process = Process()
        let output = Pipe()
        let error = Pipe()
        let input = acceptsInput ? Pipe() : nil
        outputReader = output.fileHandleForReading
        errorReader = error.fileHandleForReading
        inputWriter = input?.fileHandleForWriting

        try coherentReplacementB2RevalidateProbeExecutable(executable)
        process.executableURL = executable.url
        process.arguments = arguments
        process.environment = exactEnvironment ?? [
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "TMPDIR": "/private/tmp",
        ]
        if let input {
            process.standardInput = input
        } else {
            process.standardInput = FileHandle.nullDevice
        }
        process.standardOutput = output
        process.standardError = error
        process.terminationHandler = { [termination] _ in termination.signal() }
        if let inputWriter {
            guard Darwin.fcntl(inputWriter.fileDescriptor, F_SETNOSIGPIPE, 1) == 0 else {
                throw CoherentReplacementB2Failure.process(
                    "Unable to suppress SIGPIPE on the B2 parent write descriptor."
                )
            }
        }
        launchUptimeNanoseconds = DispatchTime.now().uptimeNanoseconds
        try process.run()
        custody.childStarted()
        var executableRevalidationFailed = false
        do {
            try coherentReplacementB2RevalidateProbeExecutable(executable)
        } catch {
            executableRevalidationFailed = true
        }
        var childEndCloseFailed = false
        for handle in [
            Optional(output.fileHandleForWriting),
            Optional(error.fileHandleForWriting),
            input?.fileHandleForReading,
        ] {
            guard let handle else { continue }
            do {
                try handle.close()
            } catch {
                childEndCloseFailed = true
            }
        }
        if childEndCloseFailed || executableRevalidationFailed {
            custody.retain(
                childEndCloseFailed
                    ? "A child-side pipe end did not close after launch."
                    : "The admitted helper changed during process launch."
            )
            if process.isRunning {
                _ = Darwin.kill(process.processIdentifier, SIGKILL)
            }
            let containmentTimeout = failureContainmentDeadline.map {
                DispatchTime(uptimeNanoseconds: $0)
            } ?? (.now() + .seconds(5))
            if termination.wait(timeout: containmentTimeout) == .success {
                process.waitUntilExit()
                markReaped()
            } else {
                custody.retain("The child could not be reaped after pipe-close failure.")
            }
            do {
                try closeParentHandles()
            } catch {
                custody.retain("Parent handles also failed to close after launch failure.")
            }
            throw CoherentReplacementB2Failure.process(
                childEndCloseFailed
                    ? "A child-side pipe end failed to close after process launch."
                    : "The helper executable failed its post-spawn identity check."
            )
        }
    }

    func markReaped() {
        guard !reaped else { return }
        reaped = true
        custody.childReaped()
    }

    func closeInputAfterFrame() throws {
        guard !inputWriterCloseAttempted, let inputWriter else {
            throw CoherentReplacementB2Failure.process("Input was absent or already closed.")
        }
        inputWriterCloseAttempted = true
        do { try inputWriter.close() }
        catch { parentHandleCloseFailed = true; throw error }
    }

    func closeParentHandles() throws {
        func closeOnce(_ handle: FileHandle?, attempted: inout Bool) {
            guard !attempted else { return }
            attempted = true
            guard let handle else { return }
            do {
                try handle.close()
            } catch {
                parentHandleCloseFailed = true
            }
        }
        closeOnce(inputWriter, attempted: &inputWriterCloseAttempted)
        closeOnce(outputReader, attempted: &outputReaderCloseAttempted)
        closeOnce(errorReader, attempted: &errorReaderCloseAttempted)
        guard !parentHandleCloseFailed else {
            throw CoherentReplacementB2Failure.process(
                "One or more parent process-pipe handles did not close exactly."
            )
        }
    }
}

private let coherentReplacementB2DeadlineNanoseconds: UInt64 = 5_000_000_000
private let coherentReplacementB3BContainmentNanoseconds: UInt64 = 2_000_000_000
private let coherentReplacementB2MaximumFrameBytes = 1_024
private let cr09TestMaximumParentFrameBytes = 2_048
private let coherentReplacementB2MaximumSHMBytes: Int64 = 1_048_576
private let coherentReplacementB2AccessPolicyDigest = ArtifactSnapshot.digest(
    Data("veritas-abrupt-restart-access-policy".utf8)
)
private let coherentReplacementB2CandidateIncidentID = "incident/" + ArtifactSnapshot.digest(
    Data("abrupt-restart-candidate-incident".utf8)
)

private func coherentReplacementB2Digest(_ value: String) -> String {
    ArtifactSnapshot.digest(Data(value.utf8))
}

private func coherentReplacementB2IsDigest(_ value: String) -> Bool {
    value.utf8.count == 64 && value.utf8.allSatisfy { byte in
        (byte >= Character("0").asciiValue! && byte <= Character("9").asciiValue!)
            || (byte >= Character("a").asciiValue! && byte <= Character("f").asciiValue!)
    }
}

private func coherentReplacementB2Scope(
    caseID: String,
    repetition: Int
) -> IncidentLedgerScopeV1 {
    IncidentLedgerScopeV1(
        scopeID: "scope/veritas-private",
        projectDigest: coherentReplacementB2Digest("\(caseID)-\(repetition)"),
        accessPolicyDigest: coherentReplacementB2AccessPolicyDigest,
        retentionPolicyDigest: LocalIncidentLedgerV1.retentionPolicyDigest
    )
}

private func coherentReplacementB2BaselineObservation(
    caseID: String,
    repetition: Int
) -> IncidentObservationInputV1 {
    let label = "\(caseID)-\(repetition)-baseline"
    return IncidentObservationInputV1(
        incidentID: "incident/\(coherentReplacementB2Digest("incident-\(label)"))",
        observationKey: coherentReplacementB2Digest("observation-\(label)"),
        subjectIDDigest: coherentReplacementB2Digest("subject-id-\(label)"),
        subjectContentDigest: coherentReplacementB2Digest("subject-content-\(label)"),
        evidenceSetDigest: coherentReplacementB2Digest("evidence-\(label)"),
        failureCodes: [.factEvidenceMissing, .requirementMissing],
        symptomCodes: [.missingCitation, .missingSection],
        observedAt: Date(timeIntervalSince1970: 1_800_000_000),
        retentionReviewAt: Date(timeIntervalSince1970: 1_807_776_000)
    )
}

private func coherentReplacementB3BDivergentObservation(
    repetition: Int,
    branch: CoherentReplacementB3BBranch
) -> IncidentObservationInputV1 {
    let domain = "veritas-b3b-cr04-divergent-v1|repetition=\(repetition)" +
        "|branch=\(branch.rawValue)|field="
    let observedAt = 1_910_000_000 + TimeInterval(repetition * 10) + branch.timeOffset
    return IncidentObservationInputV1(
        incidentID: "incident/\(coherentReplacementB2Digest(domain + "incident"))",
        observationKey: coherentReplacementB2Digest(domain + "observation"),
        subjectIDDigest: coherentReplacementB2Digest(domain + "subject-id"),
        subjectContentDigest: coherentReplacementB2Digest(domain + "subject-content"),
        evidenceSetDigest: coherentReplacementB2Digest(domain + "evidence"),
        failureCodes: [.deterministicCheckFailed, .testFailed],
        symptomCodes: [.failingTest],
        observedAt: Date(timeIntervalSince1970: observedAt),
        retentionReviewAt: Date(timeIntervalSince1970: observedAt + 7_776_000)
    )
}

private func coherentReplacementB3BVerifyFrozenVectors() throws {
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
    for repetition in [0, 1] {
        for branch in [CoherentReplacementB3BBranch.a, .b] {
            let observation = coherentReplacementB3BDivergentObservation(
                repetition: repetition,
                branch: branch
            )
            let expectedObservedAt = 1_910_000_000 +
                TimeInterval(repetition * 10) + branch.timeOffset
            guard let expected = vectors["\(repetition)\(branch.rawValue)"],
                  observation.incidentID == "incident/" + expected[0],
                  observation.observationKey == expected[1],
                  observation.subjectIDDigest == expected[2],
                  observation.subjectContentDigest == expected[3],
                  observation.evidenceSetDigest == expected[4],
                  observation.failureCodes == [.deterministicCheckFailed, .testFailed],
                  observation.symptomCodes == [.failingTest],
                  observation.observedAt == Date(timeIntervalSince1970: expectedObservedAt),
                  observation.retentionReviewAt == Date(
                      timeIntervalSince1970: expectedObservedAt + 7_776_000
                  ) else {
                throw CoherentReplacementB2Failure.unexpected(
                    "A Baseline B3B independent frozen vector drifted."
                )
            }
        }
    }
}

private func coherentReplacementB2Root(_ label: String) throws -> URL {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(
        "veritas-coherent-replacement-b2-\(label)-\(UUID().uuidString)",
        isDirectory: true
    )
    try FileManager.default.createDirectory(
        at: root,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: NSNumber(value: 0o700)]
    )
    return root
}

private func coherentReplacementB3BRoot(_ label: String) throws -> URL {
    let root = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
        .appendingPathComponent(
            "veritas-coherent-replacement-b3b-\(label)-\(UUID().uuidString)",
            isDirectory: true
        )
    try FileManager.default.createDirectory(
        at: root,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: NSNumber(value: 0o700)]
    )
    return root
}

private func coherentReplacementB2Project(
    root: URL,
    scope: IncidentLedgerScopeV1
) -> URL {
    root.appendingPathComponent("projects", isDirectory: true)
        .appendingPathComponent(scope.projectDigest, isDirectory: true)
}

private func coherentReplacementB2FileDigest(_ url: URL) throws -> String {
    ArtifactSnapshot.digest(try Data(contentsOf: url, options: [.mappedIfSafe]))
}

private func coherentReplacementB2RegularState(
    _ url: URL,
    maximumBytes: Int64,
    requireNonempty: Bool = true
) throws -> CoherentReplacementB2RegularState {
    var status = stat()
    guard url.path.withCString({ Darwin.lstat($0, &status) }) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to inspect an isolated Baseline B2 regular file."
        )
    }
    let byteCount = Int64(status.st_size)
    guard
        status.st_mode & mode_t(0o170000) == mode_t(0o100000),
        status.st_uid == Darwin.geteuid(),
        status.st_nlink == 1,
        status.st_mode & mode_t(0o777) == mode_t(0o600),
        byteCount >= (requireNonempty ? 1 : 0),
        byteCount <= maximumBytes
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "An isolated Baseline B2 file was outside the admitted profile."
        )
    }
    return CoherentReplacementB2RegularState(
        identity: CoherentReplacementB2Identity(
            device: UInt64(status.st_dev),
            inode: UInt64(status.st_ino)
        ),
        permissions: status.st_mode & mode_t(0o777),
        byteCount: byteCount,
        digest: try coherentReplacementB2FileDigest(url)
    )
}

private func coherentReplacementB2AtomicSwap(_ first: URL, _ second: URL) throws {
    let result = first.path.withCString { firstPath in
        second.path.withCString { secondPath in
            Darwin.renameatx_np(
                AT_FDCWD,
                firstPath,
                AT_FDCWD,
                secondPath,
                UInt32(RENAME_SWAP)
            )
        }
    }
    guard result == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Isolated Baseline B2 RENAME_SWAP failed with errno \(errno)."
        )
    }
}

private func cr09TestOpenDirectory(
    parent: Int32,
    name: String
) throws -> Int32 {
    let descriptor = name.withCString {
        Darwin.openat(parent, $0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    }
    guard descriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to open a CR-09 directory descriptor-relatively."
        )
    }
    var status = stat()
    guard
        Darwin.fstat(descriptor, &status) == 0,
        status.st_mode & mode_t(0o170000) == mode_t(0o040000),
        status.st_uid == Darwin.geteuid(),
        status.st_mode & mode_t(0o777) == mode_t(0o700)
    else {
        _ = Darwin.close(descriptor)
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 directory was outside the private profile."
        )
    }
    return descriptor
}

private func cr09TestDirectoryBinding(
    descriptor: Int32
) throws -> CoherentReplacementB3DirectoryBinding {
    var status = stat()
    guard
        Darwin.fstat(descriptor, &status) == 0,
        status.st_mode & mode_t(0o170000) == mode_t(0o040000),
        status.st_uid == Darwin.geteuid(),
        status.st_mode & mode_t(0o777) == mode_t(0o700)
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 directory binding was outside the private profile."
        )
    }
    return CoherentReplacementB3DirectoryBinding(
        identity: CoherentReplacementB2Identity(
            device: UInt64(status.st_dev),
            inode: UInt64(status.st_ino)
        ),
        permissions: status.st_mode & mode_t(0o777)
    )
}

private func cr09TestCreateProjectsDirectory(_ fixture: CR09TestFixture) throws {
    let rootDescriptor = Darwin.open(
        fixture.root.path,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard rootDescriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem("Unable to open a CR-09 root.")
    }
    var rootIsOpen = true
    defer { if rootIsOpen { _ = Darwin.close(rootDescriptor) } }
    try coherentReplacementB3RequireAbsentRelativePath(
        directoryDescriptor: rootDescriptor,
        name: "projects"
    )
    let createResult = "projects".withCString {
        Darwin.mkdirat(rootDescriptor, $0, mode_t(0o700))
    }
    guard createResult == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to create the CR-09 projects directory."
        )
    }
    let projectsDescriptor = try cr09TestOpenDirectory(
        parent: rootDescriptor,
        name: "projects"
    )
    try fixture.bindProjectsDirectory(
        try cr09TestDirectoryBinding(descriptor: projectsDescriptor)
    )
    guard
        Darwin.fsync(projectsDescriptor) == 0,
        Darwin.close(projectsDescriptor) == 0,
        Darwin.fsync(rootDescriptor) == 0,
        Darwin.close(rootDescriptor) == 0
    else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to synchronize the CR-09 projects directory."
        )
    }
    rootIsOpen = false
}

private func cr09TestBindExistingProjectsDirectory(_ fixture: CR09TestFixture) throws {
    let rootDescriptor = Darwin.open(
        fixture.root.path,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard rootDescriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to bind an existing CR-09 projects directory."
        )
    }
    var rootIsOpen = true
    defer { if rootIsOpen { _ = Darwin.close(rootDescriptor) } }
    try cr09TestRevalidateDirectoryDescriptor(
        rootDescriptor,
        expected: fixture.rootBinding
    )
    let projectsDescriptor = try cr09TestOpenDirectory(
        parent: rootDescriptor,
        name: "projects"
    )
    var projectsIsOpen = true
    defer { if projectsIsOpen { _ = Darwin.close(projectsDescriptor) } }
    try fixture.bindProjectsDirectory(
        try cr09TestDirectoryBinding(descriptor: projectsDescriptor)
    )
    guard
        Darwin.close(projectsDescriptor) == 0,
        Darwin.close(rootDescriptor) == 0
    else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to close CR-09 projects enrollment descriptors."
        )
    }
    projectsIsOpen = false
    rootIsOpen = false
}

private func cr09TestPopulateMainOnlyFixture(
    _ fixture: CR09TestFixture,
    mainBytes: Data
) throws -> CR09TestFrozenSource {
    try cr09TestCreateProjectsDirectory(fixture)
    let rootDescriptor = Darwin.open(
        fixture.root.path,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard rootDescriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem("Unable to reopen a CR-09 root.")
    }
    var rootIsOpen = true
    defer { if rootIsOpen { _ = Darwin.close(rootDescriptor) } }
    let projectsDescriptor = try cr09TestOpenDirectory(parent: rootDescriptor, name: "projects")
    var projectsIsOpen = true
    defer { if projectsIsOpen { _ = Darwin.close(projectsDescriptor) } }
    try coherentReplacementB3RequireAbsentRelativePath(
        directoryDescriptor: projectsDescriptor,
        name: cr09TestProjectDigest
    )
    let createResult = cr09TestProjectDigest.withCString {
        Darwin.mkdirat(projectsDescriptor, $0, mode_t(0o700))
    }
    guard createResult == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to create a CR-09 project directory."
        )
    }
    let projectDescriptor = try cr09TestOpenDirectory(
        parent: projectsDescriptor,
        name: cr09TestProjectDigest
    )
    var projectIsOpen = true
    defer { if projectIsOpen { _ = Darwin.close(projectDescriptor) } }
    let written = try coherentReplacementB3WriteRelativePrivateFile(
        directoryDescriptor: projectDescriptor,
        name: cr09TestMainName,
        bytes: mainBytes
    )
    let readback = try coherentReplacementB3RelativeRegularSnapshot(
        directoryDescriptor: projectDescriptor,
        name: cr09TestMainName,
        maximumBytes: 67_108_864
    )
    guard
        written.identity == readback.state.identity,
        written.digest == readback.state.digest,
        readback.bytes == mainBytes,
        try coherentReplacementB3BDirectoryEntries(projectDescriptor) == [cr09TestMainName],
        Darwin.fsync(projectDescriptor) == 0,
        Darwin.close(projectDescriptor) == 0,
        Darwin.fsync(projectsDescriptor) == 0,
        Darwin.close(projectsDescriptor) == 0,
        Darwin.close(rootDescriptor) == 0
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 main-only copy did not freeze exactly."
        )
    }
    projectIsOpen = false
    projectsIsOpen = false
    rootIsOpen = false
    let manifests = try cr09TestValidateFixture(
        fixture,
        expectedProjects: [cr09TestProjectDigest],
        mainOnlyProjects: [cr09TestProjectDigest]
    )
    guard let manifest = manifests[cr09TestProjectDigest] else {
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 frozen source manifest was missing."
        )
    }
    return CR09TestFrozenSource(
        fixture: fixture,
        snapshot: readback,
        manifest: manifest
    )
}

private func cr09TestCaptureProject(
    projectsDescriptor: Int32,
    name: String,
    requireMainOnly: Bool
) throws -> CR09TestProjectManifest {
    let projectDescriptor = try cr09TestOpenDirectory(parent: projectsDescriptor, name: name)
    var projectIsOpen = true
    defer { if projectIsOpen { _ = Darwin.close(projectDescriptor) } }
    var status = stat()
    guard Darwin.fstat(projectDescriptor, &status) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to inspect a CR-09 project directory."
        )
    }
    let names = try coherentReplacementB3BDirectoryEntries(projectDescriptor)
    let admitted: Set<String> = [
        cr09TestMainName,
        cr09TestMainName + "-wal",
        cr09TestMainName + "-shm",
    ]
    guard
        names.contains(cr09TestMainName),
        names.isSubset(of: admitted),
        !requireMainOnly || names == [cr09TestMainName]
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 project contained an unknown, missing, or prohibited file."
        )
    }
    var files = [String: CoherentReplacementB2RegularState]()
    for fileName in names {
        files[fileName] = try coherentReplacementB3RelativeRegularSnapshot(
            directoryDescriptor: projectDescriptor,
            name: fileName,
            maximumBytes: fileName.hasSuffix("-shm")
                ? coherentReplacementB2MaximumSHMBytes
                : 67_108_864,
            requireNonempty: fileName == cr09TestMainName
        ).state
    }
    guard Darwin.close(projectDescriptor) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to close a CR-09 project descriptor."
        )
    }
    projectIsOpen = false
    return CR09TestProjectManifest(
        identity: CoherentReplacementB2Identity(
            device: UInt64(status.st_dev),
            inode: UInt64(status.st_ino)
        ),
        permissions: status.st_mode & mode_t(0o777),
        files: files
    )
}

private func cr09TestManifestsEqual(
    _ first: CR09TestProjectManifest,
    _ second: CR09TestProjectManifest
) -> Bool {
    guard
        first.identity == second.identity,
        first.permissions == second.permissions,
        Set(first.files.keys) == Set(second.files.keys)
    else {
        return false
    }
    for name in first.files.keys {
        guard let a = first.files[name], let b = second.files[name] else { return false }
        guard
            a.identity == b.identity,
            a.permissions == b.permissions,
            a.byteCount == b.byteCount,
            a.digest == b.digest
        else { return false }
    }
    return true
}

@discardableResult
private func cr09TestValidateFixture(
    _ fixture: CR09TestFixture,
    expectedProjects: Set<String>,
    mainOnlyProjects: Set<String> = []
) throws -> [String: CR09TestProjectManifest] {
    let rootDescriptor = Darwin.open(
        fixture.root.path,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard rootDescriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem("Unable to validate a CR-09 root.")
    }
    var rootIsOpen = true
    defer { if rootIsOpen { _ = Darwin.close(rootDescriptor) } }
    var rootStatus = stat()
    let expectedRootEntries = fixture.temporaryDirectoryNames.union(["projects"])
    guard
        Darwin.fstat(rootDescriptor, &rootStatus) == 0,
        UInt64(rootStatus.st_dev) == fixture.rootBinding.identity.device,
        UInt64(rootStatus.st_ino) == fixture.rootBinding.identity.inode,
        rootStatus.st_uid == Darwin.geteuid(),
        rootStatus.st_mode & mode_t(0o777) == mode_t(0o700),
        try coherentReplacementB3BDirectoryEntries(rootDescriptor) == expectedRootEntries
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A retained CR-09 root changed identity or exact inventory."
        )
    }
    for temporaryName in fixture.temporaryDirectoryNames {
        guard let expectedBinding = fixture.temporaryDirectoryBindings[temporaryName] else {
            throw CoherentReplacementB2Failure.unexpected(
                "A retained CR-09 child TMPDIR binding was missing."
            )
        }
        let temporaryDescriptor = try cr09TestOpenDirectory(
            parent: rootDescriptor,
            name: temporaryName
        )
        try cr09TestRevalidateDirectoryDescriptor(
            temporaryDescriptor,
            expected: expectedBinding
        )
        let temporaryEntries = try coherentReplacementB3BDirectoryEntries(temporaryDescriptor)
        let closeResult = Darwin.close(temporaryDescriptor)
        guard temporaryEntries.isEmpty, closeResult == 0 else {
            throw CoherentReplacementB2Failure.unexpected(
                "A retained CR-09 child TMPDIR was not empty and exact."
            )
        }
    }
    let projectsDescriptor = try cr09TestOpenDirectory(parent: rootDescriptor, name: "projects")
    var projectsIsOpen = true
    defer { if projectsIsOpen { _ = Darwin.close(projectsDescriptor) } }
    guard let expectedProjectsBinding = fixture.projectsBinding else {
        throw CoherentReplacementB2Failure.unexpected(
            "A retained CR-09 projects directory binding was missing."
        )
    }
    try cr09TestRevalidateDirectoryDescriptor(
        projectsDescriptor,
        expected: expectedProjectsBinding
    )
    guard try coherentReplacementB3BDirectoryEntries(projectsDescriptor) == expectedProjects else {
        throw CoherentReplacementB2Failure.unexpected(
            "A retained CR-09 projects directory had the wrong exact entries."
        )
    }
    var manifests = [String: CR09TestProjectManifest]()
    for projectName in expectedProjects {
        manifests[projectName] = try cr09TestCaptureProject(
            projectsDescriptor: projectsDescriptor,
            name: projectName,
            requireMainOnly: mainOnlyProjects.contains(projectName)
        )
    }
    guard Darwin.close(projectsDescriptor) == 0, Darwin.close(rootDescriptor) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "A retained CR-09 fixture descriptor did not close exactly."
        )
    }
    projectsIsOpen = false
    rootIsOpen = false
    return manifests
}

private func cr09TestValidatedCanonicalManifest(
    _ fixture: CR09TestFixture,
    requireMainOnly: Bool = false
) throws -> CR09TestProjectManifest {
    let manifests = try cr09TestValidateFixture(
        fixture,
        expectedProjects: [cr09TestProjectDigest],
        mainOnlyProjects: requireMainOnly ? [cr09TestProjectDigest] : []
    )
    guard let manifest = manifests[cr09TestProjectDigest] else {
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 canonical project manifest was missing."
        )
    }
    return manifest
}

private func cr09TestCanonicalSnapshot(
    _ fixture: CR09TestFixture,
    requireMainOnly: Bool
) throws -> CoherentReplacementB3RegularSnapshot {
    let rootDescriptor = Darwin.open(
        fixture.root.path,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard rootDescriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem("Unable to open a CR-09 source root.")
    }
    let projectsDescriptor = try cr09TestOpenDirectory(parent: rootDescriptor, name: "projects")
    let projectDescriptor = try cr09TestOpenDirectory(
        parent: projectsDescriptor,
        name: cr09TestProjectDigest
    )
    let names = try coherentReplacementB3BDirectoryEntries(projectDescriptor)
    guard
        names.contains(cr09TestMainName),
        !requireMainOnly || names == [cr09TestMainName]
    else {
        _ = Darwin.close(projectDescriptor)
        _ = Darwin.close(projectsDescriptor)
        _ = Darwin.close(rootDescriptor)
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 source was not main-only when required."
        )
    }
    let snapshot = try coherentReplacementB3RelativeRegularSnapshot(
        directoryDescriptor: projectDescriptor,
        name: cr09TestMainName,
        maximumBytes: 67_108_864
    )
    guard
        Darwin.close(projectDescriptor) == 0,
        Darwin.close(projectsDescriptor) == 0,
        Darwin.close(rootDescriptor) == 0
    else {
        throw CoherentReplacementB2Failure.filesystem(
            "A CR-09 source snapshot descriptor did not close exactly."
        )
    }
    return snapshot
}

private func cr09TestFrameFields(
    _ frame: String,
    maximumBytes: Int = coherentReplacementB2MaximumFrameBytes
) throws -> [Substring] {
    guard
        frame.utf8.count <= maximumBytes,
        frame.hasSuffix("\n"),
        !frame.dropLast().contains("\n"),
        !frame.contains("\r"),
        !frame.contains("\0")
    else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "A CR-09 child frame did not contain exactly one admitted line."
        )
    }
    return frame.dropLast().split(separator: "|", omittingEmptySubsequences: false)
}

private func cr09TestHex(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
}

private func cr09TestRecordAdverseTranscript(
    request: String,
    frame: Data,
    residualOutput: Data = Data(),
    standardError: Data = Data()
) {
    MachineEvidence.record(
        "VERITAS_CR09_ADVERSE_TRANSCRIPT|request=\(request)" +
            "|frame_hex=\(cr09TestHex(frame))" +
            "|residual_stdout_hex=\(cr09TestHex(residualOutput))" +
            "|stderr_hex=\(cr09TestHex(standardError))" +
            "|authorizing=false"
    )
}

private func cr09TestReadFrame(
    descriptor: Int32,
    deadline: UInt64,
    request: String
) throws -> (text: String, bytes: Data) {
    var bytes = [UInt8]()
    bytes.reserveCapacity(256)
    while bytes.count < coherentReplacementB2MaximumFrameBytes {
        let timeout = coherentReplacementB2RemainingMilliseconds(deadline: deadline)
        guard timeout > 0 else {
            let captured = Data(bytes)
            cr09TestRecordAdverseTranscript(request: request, frame: captured)
            throw CoherentReplacementB2Failure.process("The CR-09 child frame timed out.")
        }
        var pollDescriptor = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
        let pollResult = Darwin.poll(&pollDescriptor, 1, timeout)
        if pollResult < 0, errno == EINTR { continue }
        guard pollResult == 1 else {
            let captured = Data(bytes)
            cr09TestRecordAdverseTranscript(request: request, frame: captured)
            throw CoherentReplacementB2Failure.process("The CR-09 child frame timed out.")
        }
        guard pollDescriptor.revents & Int16(POLLERR | POLLNVAL) == 0 else {
            let captured = Data(bytes)
            cr09TestRecordAdverseTranscript(request: request, frame: captured)
            throw CoherentReplacementB2Failure.process("The CR-09 child pipe failed.")
        }
        var byte: UInt8 = 0
        let readCount = withUnsafeMutableBytes(of: &byte) { buffer in
            Darwin.read(descriptor, buffer.baseAddress, 1)
        }
        if readCount < 0, errno == EINTR { continue }
        guard readCount == 1 else {
            let captured = Data(bytes)
            cr09TestRecordAdverseTranscript(request: request, frame: captured)
            throw CoherentReplacementB2Failure.process("The CR-09 child frame ended early.")
        }
        bytes.append(byte)
        if byte == 0x0A {
            let captured = Data(bytes)
            guard let text = String(data: captured, encoding: .utf8) else {
                cr09TestRecordAdverseTranscript(request: request, frame: captured)
                throw CoherentReplacementB2Failure.protocolViolation(
                    "The CR-09 child frame was not strict UTF-8."
                )
            }
            return (text, captured)
        }
    }
    let captured = Data(bytes)
    cr09TestRecordAdverseTranscript(request: request, frame: captured)
    throw CoherentReplacementB2Failure.protocolViolation("The CR-09 child frame was oversized.")
}

private func cr09TestValidateTerminalEvidence(
    normalExit: Bool,
    exitStatus: Int32,
    reaped: Bool,
    eofObserved: Bool,
    residualOutput: Data,
    standardError: Data
) throws {
    guard
        normalExit,
        exitStatus == 0,
        reaped,
        eofObserved,
        residualOutput.isEmpty,
        standardError.isEmpty
    else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "A CR-09 child did not satisfy exact terminal transcript evidence."
        )
    }
}

private func cr09TestRunChild(
    executable: CoherentReplacementB2ExecutableAdmission,
    fixture: CR09TestFixture,
    temporaryDirectory: URL,
    request: String,
    arguments: [String]
) throws -> (frame: String, pid: Int32) {
    let provisionalContainment = DispatchTime.now().uptimeNanoseconds
        + coherentReplacementB2DeadlineNanoseconds
        + coherentReplacementB3BContainmentNanoseconds
    let session = try CoherentReplacementB2ProcessSession(
        executable: executable,
        arguments: arguments,
        acceptsInput: false,
        custody: fixture.custody,
        failureContainmentDeadline: provisionalContainment,
        exactEnvironment: [
            "PATH": "/usr/bin:/bin",
            "LANG": "C",
            "LC_ALL": "C",
            "TZ": "UTC",
            "TMPDIR": temporaryDirectory.path,
        ]
    )
    let acceptanceDeadline = session.launchUptimeNanoseconds
        + coherentReplacementB2DeadlineNanoseconds
    let containmentDeadline = acceptanceDeadline
        + coherentReplacementB3BContainmentNanoseconds
    defer {
        cleanupCoherentReplacementB3BSession(
            session,
            containmentDeadline: containmentDeadline
        )
    }
    let capturedFrame = try cr09TestReadFrame(
        descriptor: session.outputReader.fileDescriptor,
        deadline: acceptanceDeadline,
        request: request
    )
    do {
        try coherentReplacementB2WaitForExit(session, deadline: acceptanceDeadline)
    } catch {
        cr09TestRecordAdverseTranscript(request: request, frame: capturedFrame.bytes)
        throw error
    }
    let residualOutput = session.outputReader.readDataToEndOfFile()
    let standardError = session.errorReader.readDataToEndOfFile()
    do {
        try cr09TestValidateTerminalEvidence(
            normalExit: session.process.terminationReason == .exit,
            exitStatus: session.process.terminationStatus,
            reaped: session.reaped,
            eofObserved: true,
            residualOutput: residualOutput,
            standardError: standardError
        )
    } catch {
        cr09TestRecordAdverseTranscript(
            request: request,
            frame: capturedFrame.bytes,
            residualOutput: residualOutput,
            standardError: standardError
        )
        throw error
    }
    try session.closeParentHandles()
    let temporaryDescriptor = Darwin.open(
        temporaryDirectory.path,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard temporaryDescriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to reopen a CR-09 child TMPDIR."
        )
    }
    var temporaryIsOpen = true
    defer { if temporaryIsOpen { _ = Darwin.close(temporaryDescriptor) } }
    guard let temporaryBinding =
        fixture.temporaryDirectoryBindings[temporaryDirectory.lastPathComponent]
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The CR-09 child TMPDIR binding was missing after normal exit."
        )
    }
    try cr09TestRevalidateDirectoryDescriptor(
        temporaryDescriptor,
        expected: temporaryBinding
    )
    let temporaryEntries = try coherentReplacementB3BDirectoryEntries(temporaryDescriptor)
    let temporaryClose = Darwin.close(temporaryDescriptor)
    temporaryIsOpen = false
    guard temporaryEntries.isEmpty, temporaryClose == 0 else {
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 child TMPDIR was not empty after normal exit."
        )
    }
    return (capturedFrame.text, session.process.processIdentifier)
}

private func cr09TestRequest(_ label: String) -> String {
    "cr09-\(label)-\(cr09TestCompactUUID())"
}

private func cr09TestParseBuildFrame(
    _ frame: String,
    request: String,
    pid: Int32,
    node: CR09TestNode,
    expectedInputHead: String
) throws -> CR09TestChildResult {
    let fields = try cr09TestFrameFields(frame)
    guard
        fields.count == 13,
        fields[0] == "VERITAS_B3_CHILD",
        fields[1] == "v1",
        fields[2] == "request=\(request)",
        fields[3] == "case=CR-09",
        fields[4] == "variant=FORK_BUILD",
        fields[5] == "node=\(node.rawValue)",
        fields[6] == "phase=CLOSED_AND_INSPECTED_EXACT",
        fields[7] == "events=\(node.eventCount)",
        fields[8].hasPrefix("stored_predecessor_digest="),
        fields[9].hasPrefix("head_digest="),
        fields[10] == "post_close_inventory_admitted=true",
        fields[11] == "authorizing=false",
        fields[12] == "pid=\(pid)"
    else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "A CR-09 build child emitted a malformed or misordered frame."
        )
    }
    let predecessor = String(fields[8].dropFirst("stored_predecessor_digest=".count))
    let head = String(fields[9].dropFirst("head_digest=".count))
    guard
        coherentReplacementB2IsDigest(predecessor),
        coherentReplacementB2IsDigest(head),
        predecessor == (node == .p ? cr09TestGenesisDigest : expectedInputHead),
        node == .p ? expectedInputHead == "GENESIS" : coherentReplacementB2IsDigest(expectedInputHead)
    else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "A CR-09 build child emitted an unexpected chain digest."
        )
    }
    return CR09TestChildResult(
        node: node,
        h0: node == .p ? head : expectedInputHead,
        predecessor: predecessor,
        head: head,
        installedMainDigest: nil,
        pid: pid
    )
}

private func cr09TestRunBuild(
    executable: CoherentReplacementB2ExecutableAdmission,
    fixture: CR09TestFixture,
    node: CR09TestNode,
    expectedInputHead: String
) throws -> CR09TestChildResult {
    let request = cr09TestRequest(
        "\(fixture.familyID)-build-\(node.rawValue.lowercased())"
    )
    let temporary = try fixture.makeChildTemporaryDirectory("build-\(node.rawValue.lowercased())")
    let terminal = try cr09TestRunChild(
        executable: executable,
        fixture: fixture,
        temporaryDirectory: temporary,
        request: request,
        arguments: [
            "b3-cr09-build",
            fixture.root.path,
            cr09TestProjectDigest,
            request,
            node.rawValue,
            expectedInputHead,
        ]
    )
    do {
        let parsed = try cr09TestParseBuildFrame(
            terminal.frame,
            request: request,
            pid: terminal.pid,
            node: node,
            expectedInputHead: expectedInputHead
        )
        try cr09TestBindExistingProjectsDirectory(fixture)
        MachineEvidence.record(terminal.frame)
        return parsed
    } catch {
        cr09TestRecordAdverseTranscript(
            request: request,
            frame: Data(terminal.frame.utf8)
        )
        throw error
    }
}

private func cr09TestParseControlFrame(
    _ frame: String,
    request: String,
    pid: Int32,
    node: CR09TestNode,
    expectedH0: String,
    expectedHead: String,
    sourceDigest: String
) throws -> CR09TestChildResult {
    let fields = try cr09TestFrameFields(frame)
    guard
        fields.count == 15,
        fields[0] == "VERITAS_B3_CHILD",
        fields[1] == "v1",
        fields[2] == "request=\(request)",
        fields[3] == "case=CR-09",
        fields[4] == "variant=FORK_SOURCE_CONTROL",
        fields[5] == "node=\(node.rawValue)",
        fields[6] == "phase=ADMITTED_EXACT",
        fields[7] == "events=\(node.eventCount)",
        fields[8] == "baseline_event_digest=\(expectedH0)",
        fields[9] == "stored_predecessor_digest=\(node == .p ? cr09TestGenesisDigest : expectedH0)",
        fields[10] == "head_digest=\(expectedHead)",
        fields[11] == "installed_source_main_digest=\(sourceDigest)",
        fields[12] == "post_close_inventory_admitted=true",
        fields[13] == "authorizing=false",
        fields[14] == "pid=\(pid)"
    else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "A CR-09 source-control child emitted a malformed or misordered frame."
        )
    }
    return CR09TestChildResult(
        node: node,
        h0: expectedH0,
        predecessor: node == .p ? cr09TestGenesisDigest : expectedH0,
        head: expectedHead,
        installedMainDigest: sourceDigest,
        pid: pid
    )
}

private func cr09TestRunControl(
    executable: CoherentReplacementB2ExecutableAdmission,
    fixture: CR09TestFixture,
    node: CR09TestNode,
    expectedH0: String,
    expectedHead: String,
    sourceDigest: String
) throws -> CR09TestChildResult {
    let request = cr09TestRequest(
        "\(fixture.familyID)-control-\(node.rawValue.lowercased())"
    )
    let temporary = try fixture.makeChildTemporaryDirectory("control-\(node.rawValue.lowercased())")
    let terminal = try cr09TestRunChild(
        executable: executable,
        fixture: fixture,
        temporaryDirectory: temporary,
        request: request,
        arguments: [
            "b3-cr09-control",
            fixture.root.path,
            cr09TestProjectDigest,
            request,
            node.rawValue,
            expectedH0,
            expectedHead,
            sourceDigest,
        ]
    )
    do {
        let parsed = try cr09TestParseControlFrame(
            terminal.frame,
            request: request,
            pid: terminal.pid,
            node: node,
            expectedH0: expectedH0,
            expectedHead: expectedHead,
            sourceDigest: sourceDigest
        )
        MachineEvidence.record(terminal.frame)
        return parsed
    } catch {
        cr09TestRecordAdverseTranscript(
            request: request,
            frame: Data(terminal.frame.utf8)
        )
        throw error
    }
}

private func cr09TestParsePresentationFrame(
    _ frame: String,
    request: String,
    pid: Int32,
    repetition: Int,
    order: CR09TestOrder,
    position: CR09TestPosition,
    branch: CR09TestNode,
    expectedH0: String,
    expectedHead: String,
    sourceDigest: String
) throws -> CR09TestChildResult {
    let fields = try cr09TestFrameFields(frame)
    guard
        fields.count == 25,
        fields[0] == "VERITAS_B3_CHILD",
        fields[1] == "v1",
        fields[2] == "request=\(request)",
        fields[3] == "case=CR-09",
        fields[4] == "variant=FORK_PRESENTATION",
        fields[5] == "repetition=\(repetition)",
        fields[6] == "order=\(order.rawValue)",
        fields[7] == "position=\(position.rawValue)",
        fields[8] == "branch=\(branch.rawValue)",
        fields[9] == "phase=ADMITTED_EXACT",
        fields[10] == "events=2",
        fields[11] == "baseline_event_digest=\(expectedH0)",
        fields[12] == "stored_predecessor_digest=\(expectedH0)",
        fields[13] == "branch_event_digest=\(expectedHead)",
        fields[14] == "head_digest=\(expectedHead)",
        fields[15] == "installed_source_main_digest=\(sourceDigest)",
        fields[16] == "baseline_present=true",
        fields[17] == "expected_branch_present=true",
        fields[18] == "opposite_branch_present=false",
        fields[19] == "pristine_main_only_before_open=true",
        fields[20] == "closed_project_inventory_exact=true",
        fields[21] == "post_close_inventory_admitted=true",
        fields[22] == "protected_authority_verified=false",
        fields[23] == "authorizing=false",
        fields[24] == "pid=\(pid)"
    else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "A CR-09 presentation child emitted a malformed or misordered frame."
        )
    }
    return CR09TestChildResult(
        node: branch,
        h0: expectedH0,
        predecessor: expectedH0,
        head: expectedHead,
        installedMainDigest: sourceDigest,
        pid: pid
    )
}

private func cr09TestRunPresentation(
    executable: CoherentReplacementB2ExecutableAdmission,
    fixture: CR09TestFixture,
    repetition: Int,
    order: CR09TestOrder,
    position: CR09TestPosition,
    branch: CR09TestNode,
    expectedH0: String,
    expectedHead: String,
    sourceDigest: String
) throws -> CR09TestChildResult {
    let request = cr09TestRequest(
        "\(fixture.familyID)-present-\(order.rawValue.lowercased())-" +
            position.rawValue.lowercased()
    )
    let temporary = try fixture.makeChildTemporaryDirectory(
        "present-\(order.rawValue.lowercased())-\(position.rawValue.lowercased())"
    )
    let terminal = try cr09TestRunChild(
        executable: executable,
        fixture: fixture,
        temporaryDirectory: temporary,
        request: request,
        arguments: [
            "b3-cr09-present",
            fixture.root.path,
            cr09TestProjectDigest,
            request,
            "\(repetition)",
            order.rawValue,
            position.rawValue,
            branch.rawValue,
            expectedH0,
            expectedHead,
            sourceDigest,
        ]
    )
    do {
        let parsed = try cr09TestParsePresentationFrame(
            terminal.frame,
            request: request,
            pid: terminal.pid,
            repetition: repetition,
            order: order,
            position: position,
            branch: branch,
            expectedH0: expectedH0,
            expectedHead: expectedHead,
            sourceDigest: sourceDigest
        )
        MachineEvidence.record(terminal.frame)
        return parsed
    } catch {
        cr09TestRecordAdverseTranscript(
            request: request,
            frame: Data(terminal.frame.utf8)
        )
        throw error
    }
}

private func cr09TestRevalidateDirectoryDescriptor(
    _ descriptor: Int32,
    expected: CoherentReplacementB3DirectoryBinding
) throws {
    var status = stat()
    guard
        Darwin.fstat(descriptor, &status) == 0,
        status.st_mode & mode_t(0o170000) == mode_t(0o040000),
        status.st_uid == Darwin.geteuid(),
        expected.permissions == mode_t(0o700),
        status.st_mode & mode_t(0o777) == expected.permissions,
        UInt64(status.st_dev) == expected.identity.device,
        UInt64(status.st_ino) == expected.identity.inode
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A retained CR-09 directory descriptor changed identity."
        )
    }
}

private func cr09TestStageName(
    order: CR09TestOrder,
    position: CR09TestPosition
) -> String {
    ".cr09-stage-\(order.rawValue.lowercased())-" +
        "\(position.rawValue.lowercased())-\(cr09TestCompactUUID())"
}

private func cr09TestRetiredName(
    order: CR09TestOrder,
    branch: CR09TestNode
) -> String {
    ".cr09-retired-\(order.rawValue.lowercased())-" +
        "\(branch.rawValue.lowercased())-\(cr09TestCompactUUID())"
}

private func cr09TestStageAndInstall(
    projectsDescriptor: Int32,
    order: CR09TestOrder,
    position: CR09TestPosition,
    existingProjects: Set<String>,
    source: CR09TestFrozenSource
) throws -> CR09TestProjectManifest {
    let stageName = cr09TestStageName(order: order, position: position)
    let projectsBinding = try cr09TestDirectoryBinding(descriptor: projectsDescriptor)
    guard try coherentReplacementB3BDirectoryEntries(projectsDescriptor) == existingProjects else {
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 projects directory drifted before staging."
        )
    }
    try coherentReplacementB3RequireAbsentRelativePath(
        directoryDescriptor: projectsDescriptor,
        name: stageName
    )
    try coherentReplacementB3RequireAbsentRelativePath(
        directoryDescriptor: projectsDescriptor,
        name: cr09TestProjectDigest
    )
    let createResult = stageName.withCString {
        Darwin.mkdirat(projectsDescriptor, $0, mode_t(0o700))
    }
    guard createResult == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to create a CR-09 stage directory."
        )
    }
    guard
        try coherentReplacementB3BDirectoryEntries(projectsDescriptor)
            == existingProjects.union([stageName])
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 stage creation changed the projects inventory unexpectedly."
        )
    }
    let stageDescriptor = try cr09TestOpenDirectory(
        parent: projectsDescriptor,
        name: stageName
    )
    let stageBinding = try cr09TestDirectoryBinding(descriptor: stageDescriptor)
    guard stageBinding.identity.device == projectsBinding.identity.device else {
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 stage was not on the retained projects filesystem."
        )
    }
    var stageIsOpen = true
    defer { if stageIsOpen { _ = Darwin.close(stageDescriptor) } }
    let written = try coherentReplacementB3WriteRelativePrivateFile(
        directoryDescriptor: stageDescriptor,
        name: cr09TestMainName,
        bytes: source.snapshot.bytes
    )
    let readback = try coherentReplacementB3RelativeRegularSnapshot(
        directoryDescriptor: stageDescriptor,
        name: cr09TestMainName,
        maximumBytes: 67_108_864
    )
    try cr09TestRevalidateDirectoryDescriptor(
        stageDescriptor,
        expected: stageBinding
    )
    guard
        written.identity == readback.state.identity,
        written.identity != source.snapshot.state.identity,
        readback.state.digest == source.snapshot.state.digest,
        readback.bytes == source.snapshot.bytes,
        try coherentReplacementB3BDirectoryEntries(stageDescriptor) == [cr09TestMainName],
        Darwin.fsync(stageDescriptor) == 0
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 stage did not preserve the exact pristine main."
        )
    }
    try cr09TestRevalidateDirectoryDescriptor(
        stageDescriptor,
        expected: stageBinding
    )
    guard
        Darwin.close(stageDescriptor) == 0,
        Darwin.fsync(projectsDescriptor) == 0
    else {
        throw CoherentReplacementB2Failure.filesystem(
            "A CR-09 stage did not close and synchronize exactly."
        )
    }
    stageIsOpen = false
    let stageManifest = try cr09TestCaptureProject(
        projectsDescriptor: projectsDescriptor,
        name: stageName,
        requireMainOnly: true
    )
    guard
        stageManifest.identity == stageBinding.identity,
        stageManifest.permissions == stageBinding.permissions
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 stage identity changed after population."
        )
    }
    guard
        try coherentReplacementB3BDirectoryEntries(projectsDescriptor)
            == existingProjects.union([stageName])
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The CR-09 projects inventory drifted at the install boundary."
        )
    }
    let renameResult = stageName.withCString { stagePointer in
        cr09TestProjectDigest.withCString { canonicalPointer in
            Darwin.renameatx_np(
                projectsDescriptor,
                stagePointer,
                projectsDescriptor,
                canonicalPointer,
                UInt32(RENAME_EXCL)
            )
        }
    }
    guard renameResult == 0, Darwin.fsync(projectsDescriptor) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "A CR-09 stage install did not complete with RENAME_EXCL."
        )
    }
    try coherentReplacementB3RequireAbsentRelativePath(
        directoryDescriptor: projectsDescriptor,
        name: stageName
    )
    let canonicalManifest = try cr09TestCaptureProject(
        projectsDescriptor: projectsDescriptor,
        name: cr09TestProjectDigest,
        requireMainOnly: true
    )
    guard cr09TestManifestsEqual(stageManifest, canonicalManifest) else {
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 stage changed across canonical installation."
        )
    }
    guard
        try coherentReplacementB3BDirectoryEntries(projectsDescriptor)
            == existingProjects.union([cr09TestProjectDigest])
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 canonical install left an unexpected projects entry."
        )
    }
    return canonicalManifest
}

private func cr09TestRetireCanonical(
    projectsDescriptor: Int32,
    order: CR09TestOrder,
    branch: CR09TestNode,
    expectedProjects: Set<String>,
    expected: CR09TestProjectManifest
) throws -> String {
    let retiredName = cr09TestRetiredName(order: order, branch: branch)
    try coherentReplacementB3RequireAbsentRelativePath(
        directoryDescriptor: projectsDescriptor,
        name: retiredName
    )
    guard try coherentReplacementB3BDirectoryEntries(projectsDescriptor) == expectedProjects else {
        throw CoherentReplacementB2Failure.unexpected(
            "The CR-09 projects inventory drifted before canonical retirement."
        )
    }
    let immediatelyBefore = try cr09TestCaptureProject(
        projectsDescriptor: projectsDescriptor,
        name: cr09TestProjectDigest,
        requireMainOnly: false
    )
    guard cr09TestManifestsEqual(immediatelyBefore, expected) else {
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 canonical project changed before retirement."
        )
    }
    guard try coherentReplacementB3BDirectoryEntries(projectsDescriptor) == expectedProjects else {
        throw CoherentReplacementB2Failure.unexpected(
            "The CR-09 projects inventory changed at the retirement boundary."
        )
    }
    let renameResult = cr09TestProjectDigest.withCString { canonicalPointer in
        retiredName.withCString { retiredPointer in
            Darwin.renameatx_np(
                projectsDescriptor,
                canonicalPointer,
                projectsDescriptor,
                retiredPointer,
                UInt32(RENAME_EXCL)
            )
        }
    }
    guard renameResult == 0, Darwin.fsync(projectsDescriptor) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "A CR-09 canonical retirement did not complete with RENAME_EXCL."
        )
    }
    try coherentReplacementB3RequireAbsentRelativePath(
        directoryDescriptor: projectsDescriptor,
        name: cr09TestProjectDigest
    )
    let expectedAfterRetirement =
        expectedProjects.subtracting([cr09TestProjectDigest]).union([retiredName])
    guard
        try coherentReplacementB3BDirectoryEntries(projectsDescriptor)
            == expectedAfterRetirement
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The CR-09 projects inventory drifted after canonical retirement."
        )
    }
    let retired = try cr09TestCaptureProject(
        projectsDescriptor: projectsDescriptor,
        name: retiredName,
        requireMainOnly: false
    )
    guard cr09TestManifestsEqual(retired, expected) else {
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 retired project did not preserve its complete closed manifest."
        )
    }
    return retiredName
}

private func cr09TestRunOrder(
    executable: CoherentReplacementB2ExecutableAdmission,
    fixture: CR09TestFixture,
    repetition: Int,
    order: CR09TestOrder,
    firstBranch: CR09TestNode,
    firstSource: CR09TestFrozenSource,
    firstHead: String,
    secondBranch: CR09TestNode,
    secondSource: CR09TestFrozenSource,
    secondHead: String,
    h0: String
) throws -> CR09TestOrderResult {
    try cr09TestCreateProjectsDirectory(fixture)
    let rootDescriptor = Darwin.open(
        fixture.root.path,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard rootDescriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to retain a CR-09 order root descriptor."
        )
    }
    var rootIsOpen = true
    defer { if rootIsOpen { _ = Darwin.close(rootDescriptor) } }
    let projectsDescriptor = try cr09TestOpenDirectory(parent: rootDescriptor, name: "projects")
    var projectsIsOpen = true
    defer { if projectsIsOpen { _ = Darwin.close(projectsDescriptor) } }
    let projectsBinding = try cr09TestDirectoryBinding(descriptor: projectsDescriptor)
    try fixture.bindProjectsDirectory(projectsBinding)
    try cr09TestRevalidateDirectoryDescriptor(rootDescriptor, expected: fixture.rootBinding)
    try cr09TestRevalidateDirectoryDescriptor(projectsDescriptor, expected: projectsBinding)

    _ = try cr09TestStageAndInstall(
        projectsDescriptor: projectsDescriptor,
        order: order,
        position: .first,
        existingProjects: [],
        source: firstSource
    )
    let first = try cr09TestRunPresentation(
        executable: executable,
        fixture: fixture,
        repetition: repetition,
        order: order,
        position: .first,
        branch: firstBranch,
        expectedH0: h0,
        expectedHead: firstHead,
        sourceDigest: firstSource.snapshot.state.digest
    )
    let firstClosed = try cr09TestCaptureProject(
        projectsDescriptor: projectsDescriptor,
        name: cr09TestProjectDigest,
        requireMainOnly: false
    )
    let retiredName = try cr09TestRetireCanonical(
        projectsDescriptor: projectsDescriptor,
        order: order,
        branch: firstBranch,
        expectedProjects: [cr09TestProjectDigest],
        expected: firstClosed
    )
    try cr09TestRevalidateDirectoryDescriptor(rootDescriptor, expected: fixture.rootBinding)
    try cr09TestRevalidateDirectoryDescriptor(projectsDescriptor, expected: projectsBinding)

    _ = try cr09TestStageAndInstall(
        projectsDescriptor: projectsDescriptor,
        order: order,
        position: .second,
        existingProjects: [retiredName],
        source: secondSource
    )
    let second = try cr09TestRunPresentation(
        executable: executable,
        fixture: fixture,
        repetition: repetition,
        order: order,
        position: .second,
        branch: secondBranch,
        expectedH0: h0,
        expectedHead: secondHead,
        sourceDigest: secondSource.snapshot.state.digest
    )
    let secondClosed = try cr09TestCaptureProject(
        projectsDescriptor: projectsDescriptor,
        name: cr09TestProjectDigest,
        requireMainOnly: false
    )
    guard
        try coherentReplacementB3BDirectoryEntries(projectsDescriptor)
            == [cr09TestProjectDigest, retiredName]
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 order did not retain exactly canonical and retired projects."
        )
    }
    try cr09TestRevalidateDirectoryDescriptor(rootDescriptor, expected: fixture.rootBinding)
    try cr09TestRevalidateDirectoryDescriptor(projectsDescriptor, expected: projectsBinding)
    guard
        Darwin.close(projectsDescriptor) == 0,
        Darwin.close(rootDescriptor) == 0
    else {
        throw CoherentReplacementB2Failure.filesystem(
            "A CR-09 order descriptor did not close exactly."
        )
    }
    projectsIsOpen = false
    rootIsOpen = false
    let finalManifests = try cr09TestValidateFixture(
        fixture,
        expectedProjects: [cr09TestProjectDigest, retiredName]
    )
    guard
        let finalRetired = finalManifests[retiredName],
        let finalCanonical = finalManifests[cr09TestProjectDigest],
        cr09TestManifestsEqual(finalRetired, firstClosed),
        cr09TestManifestsEqual(finalCanonical, secondClosed)
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 order did not preserve both exact post-child manifests."
        )
    }
    return CR09TestOrderResult(
        fixture: fixture,
        projectsBinding: projectsBinding,
        retiredName: retiredName,
        retiredManifest: firstClosed,
        canonicalManifest: secondClosed,
        firstHead: first.head,
        secondHead: second.head,
        firstPID: first.pid,
        secondPID: second.pid
    )
}

private func cr09TestRequireParserRejection(_ operation: () throws -> Void) throws {
    var rejected = false
    do {
        try operation()
    } catch {
        rejected = true
    }
    guard rejected else {
        throw CoherentReplacementB2Failure.unexpected(
            "A CR-09 malformed child frame was not rejected."
        )
    }
}

private func cr09TestParserSelfCheck() throws {
    let digestA = String(repeating: "a", count: 64)
    let digestB = String(repeating: "b", count: 64)
    let digestC = String(repeating: "c", count: 64)
    let digestD = String(repeating: "d", count: 64)
    let request = "cr09-parser-self-check"
    let build =
        "VERITAS_B3_CHILD|v1|request=\(request)|case=CR-09|variant=FORK_BUILD" +
        "|node=A|phase=CLOSED_AND_INSPECTED_EXACT|events=2" +
        "|stored_predecessor_digest=\(digestA)|head_digest=\(digestB)" +
        "|post_close_inventory_admitted=true|authorizing=false|pid=42\n"
    _ = try cr09TestParseBuildFrame(
        build,
        request: request,
        pid: 42,
        node: .a,
        expectedInputHead: digestA
    )
    for candidate in [
        build.replacingOccurrences(
            of: "phase=CLOSED_AND_INSPECTED_EXACT",
            with: "phase=ADMITTED_EXACT"
        ),
        build.replacingOccurrences(
            of: "post_close_inventory_admitted=true",
            with: "post_close_inventory_admitted=false"
        ),
        build.replacingOccurrences(of: "pid=42", with: "pid=41"),
        build.replacingOccurrences(of: "|events=2", with: "|extra=true|events=2"),
    ] {
        try cr09TestRequireParserRejection {
            _ = try cr09TestParseBuildFrame(
                candidate,
                request: request,
                pid: 42,
                node: .a,
                expectedInputHead: digestA
            )
        }
    }

    let control =
        "VERITAS_B3_CHILD|v1|request=\(request)|case=CR-09" +
        "|variant=FORK_SOURCE_CONTROL|node=A|phase=ADMITTED_EXACT|events=2" +
        "|baseline_event_digest=\(digestA)|stored_predecessor_digest=\(digestA)" +
        "|head_digest=\(digestB)|installed_source_main_digest=\(digestA)" +
        "|post_close_inventory_admitted=true|authorizing=false|pid=42\n"
    _ = try cr09TestParseControlFrame(
        control,
        request: request,
        pid: 42,
        node: .a,
        expectedH0: digestA,
        expectedHead: digestB,
        sourceDigest: digestA
    )
    for candidate in [
        control.replacingOccurrences(of: "phase=ADMITTED_EXACT", with: "phase=WRONG"),
        control.replacingOccurrences(
            of: "post_close_inventory_admitted=true",
            with: "post_close_inventory_admitted=false"
        ),
        control.replacingOccurrences(of: "baseline_event_digest=", with: "baseline="),
        control + "extra\n",
    ] {
        try cr09TestRequireParserRejection {
            _ = try cr09TestParseControlFrame(
                candidate,
                request: request,
                pid: 42,
                node: .a,
                expectedH0: digestA,
                expectedHead: digestB,
                sourceDigest: digestA
            )
        }
    }

    let exact =
        "VERITAS_B3_CHILD|v1|request=\(request)|case=CR-09" +
        "|variant=FORK_PRESENTATION|repetition=0|order=AB|position=FIRST" +
        "|branch=A|phase=ADMITTED_EXACT|events=2|baseline_event_digest=\(digestA)" +
        "|stored_predecessor_digest=\(digestA)|branch_event_digest=\(digestB)" +
        "|head_digest=\(digestB)|installed_source_main_digest=\(digestA)" +
        "|baseline_present=true|expected_branch_present=true" +
        "|opposite_branch_present=false|pristine_main_only_before_open=true" +
        "|closed_project_inventory_exact=true|post_close_inventory_admitted=true" +
        "|protected_authority_verified=false|authorizing=false|pid=42\n"
    _ = try cr09TestParsePresentationFrame(
        exact,
        request: request,
        pid: 42,
        repetition: 0,
        order: .ab,
        position: .first,
        branch: .a,
        expectedH0: digestA,
        expectedHead: digestB,
        sourceDigest: digestA
    )
    let malformed = [
        exact.replacingOccurrences(of: "request=\(request)", with: "request=wrong"),
        exact.replacingOccurrences(of: "pid=42", with: "pid=41"),
        exact.replacingOccurrences(of: "order=AB", with: "order=BA"),
        exact.replacingOccurrences(of: "position=FIRST", with: "position=SECOND"),
        exact.replacingOccurrences(of: "branch=A", with: "branch=B"),
        exact.replacingOccurrences(of: "phase=ADMITTED_EXACT", with: "phase=WRONG"),
        exact.replacingOccurrences(of: "repetition=0", with: "repetition=+0"),
        exact.replacingOccurrences(of: "baseline_present=true", with: "baseline_present=false"),
        exact.replacingOccurrences(
            of: "expected_branch_present=true",
            with: "expected_branch_present=false"
        ),
        exact.replacingOccurrences(
            of: "opposite_branch_present=false",
            with: "opposite_branch_present=true"
        ),
        exact.replacingOccurrences(
            of: "post_close_inventory_admitted=true",
            with: "post_close_inventory_admitted=false"
        ),
        exact.replacingOccurrences(of: "|events=2", with: "|extra=true|events=2"),
        exact + "extra\n",
        exact.replacingOccurrences(of: digestB, with: digestB.uppercased()),
    ]
    for candidate in malformed {
        try cr09TestRequireParserRejection {
            _ = try cr09TestParsePresentationFrame(
                candidate,
                request: request,
                pid: 42,
                repetition: 0,
                order: .ab,
                position: .first,
                branch: .a,
                expectedH0: digestA,
                expectedHead: digestB,
                sourceDigest: digestA
            )
        }
    }

    try cr09TestValidateTerminalEvidence(
        normalExit: true,
        exitStatus: 0,
        reaped: true,
        eofObserved: true,
        residualOutput: Data(),
        standardError: Data()
    )
    let terminalNegatives: [(Bool, Int32, Bool, Bool, Data, Data)] = [
        (false, 0, true, true, Data(), Data()),
        (true, 1, true, true, Data(), Data()),
        (true, 0, false, true, Data(), Data()),
        (true, 0, true, false, Data(), Data()),
        (true, 0, true, true, Data([0x78]), Data()),
        (true, 0, true, true, Data(), Data([0x78])),
    ]
    for candidate in terminalNegatives {
        try cr09TestRequireParserRejection {
            try cr09TestValidateTerminalEvidence(
                normalExit: candidate.0,
                exitStatus: candidate.1,
                reaped: candidate.2,
                eofObserved: candidate.3,
                residualOutput: candidate.4,
                standardError: candidate.5
            )
        }
    }

    let parentAB = cr09TestParentResultFrame(
        repetition: 0,
        order: .ab,
        h0: digestA,
        hA: digestB,
        hB: digestC,
        sourceADigest: digestA,
        sourceBDigest: digestD,
        firstHead: digestB,
        secondHead: digestC
    ) + "\n"
    let parentBA = cr09TestParentResultFrame(
        repetition: 1,
        order: .ba,
        h0: digestA,
        hA: digestB,
        hB: digestC,
        sourceADigest: digestA,
        sourceBDigest: digestD,
        firstHead: digestC,
        secondHead: digestB
    ) + "\n"
    let parsedAB = try cr09TestParseParentResult(parentAB)
    let parsedBA = try cr09TestParseParentResult(parentBA)
    try cr09TestValidateParentPair(parsedAB, parsedBA)
    for candidate in [
        parentAB.replacingOccurrences(of: "repetition=0", with: "repetition=+0"),
        parentAB.replacingOccurrences(of: "order=AB", with: "order=BA"),
        parentAB.replacingOccurrences(of: "shared_predecessor=true", with: "shared=false"),
        parentAB.replacingOccurrences(of: "|h0=", with: "|extra=true|h0="),
        parentAB + "extra\n",
    ] {
        try cr09TestRequireParserRejection {
            _ = try cr09TestParseParentResult(candidate)
        }
    }
    let wrongBA = CR09TestParentResult(
        repetition: parsedBA.repetition,
        order: parsedBA.order,
        h0: parsedBA.h0,
        hA: parsedBA.hA,
        hB: parsedBA.hB,
        sourceADigest: parsedBA.sourceADigest,
        sourceBDigest: parsedBA.sourceBDigest,
        firstHead: parsedBA.hA,
        secondHead: parsedBA.hB
    )
    try cr09TestRequireParserRejection {
        try cr09TestValidateParentPair(parsedAB, wrongBA)
    }
}

private func coherentReplacementB2CopyPrivateFile(
    from source: URL,
    to destination: URL
) throws {
    try FileManager.default.copyItem(at: source, to: destination)
    guard Darwin.chmod(destination.path, mode_t(0o600)) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to harden an isolated Baseline B2 copy."
        )
    }
}

private func coherentReplacementB2ReadUInt32BigEndian(
    _ data: Data,
    offset: Int
) throws -> UInt32 {
    guard offset >= 0, offset + 4 <= data.count else {
        throw CoherentReplacementB2Failure.unexpected("The B2 WAL header was incomplete.")
    }
    return data[offset..<(offset + 4)].reduce(UInt32(0)) { partial, byte in
        (partial << 8) | UInt32(byte)
    }
}

private func coherentReplacementB2WALState(_ walURL: URL) throws -> CoherentReplacementB2WALState {
    let status = try coherentReplacementB2RegularState(
        walURL,
        maximumBytes: 67_108_864
    )
    guard status.byteCount >= 32 else {
        throw CoherentReplacementB2Failure.unexpected("The B2 WAL lacked a complete header.")
    }
    let handle = try FileHandle(forReadingFrom: walURL)
    let header: Data
    do {
        header = try handle.read(upToCount: 12) ?? Data()
        try handle.close()
    } catch {
        try? handle.close()
        throw error
    }
    guard header.count == 12 else {
        throw CoherentReplacementB2Failure.unexpected("The B2 WAL header read was incomplete.")
    }
    let magic = try coherentReplacementB2ReadUInt32BigEndian(header, offset: 0)
    guard magic == 0x377f0682 || magic == 0x377f0683 else {
        throw CoherentReplacementB2Failure.unexpected("The B2 WAL magic was not admitted.")
    }
    let encodedPageSize = try coherentReplacementB2ReadUInt32BigEndian(header, offset: 8)
    let pageSize = encodedPageSize == 1 ? Int64(65_536) : Int64(encodedPageSize)
    guard pageSize >= 512, pageSize <= 65_536, pageSize.nonzeroBitCount == 1 else {
        throw CoherentReplacementB2Failure.unexpected("The B2 WAL page size was invalid.")
    }
    let frameBytes = pageSize + 24
    let payloadBytes = status.byteCount - 32
    guard payloadBytes > 0, payloadBytes % frameBytes == 0 else {
        throw CoherentReplacementB2Failure.unexpected(
            "The B2 WAL did not contain an integral nonzero frame capacity."
        )
    }
    return CoherentReplacementB2WALState(
        pageSize: pageSize,
        physicalFrameCapacity: payloadBytes / frameBytes,
        byteCount: status.byteCount
    )
}

private func coherentReplacementB2ReadProbeExecutable(
    _ url: URL,
    expectedDigest: String
) throws -> CoherentReplacementB2ExecutableAdmission {
    guard url.path == url.standardizedFileURL.path else {
        throw CoherentReplacementB2Failure.unexpected(
            "The B2 helper path was not canonical."
        )
    }
    var pathStatus = stat()
    guard url.path.withCString({ Darwin.lstat($0, &pathStatus) }) == 0 else {
        throw CoherentReplacementB2Failure.filesystem("Unable to inspect the B2 helper path.")
    }
    let descriptor = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
    guard descriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to open the B2 helper without following links."
        )
    }
    let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: false)
    defer { try? handle.close() }
    var openedStatus = stat()
    guard Darwin.fstat(descriptor, &openedStatus) == 0 else {
        throw CoherentReplacementB2Failure.filesystem("Unable to inspect the opened B2 helper.")
    }
    let byteCount = Int64(openedStatus.st_size)
    guard
        pathStatus.st_mode & mode_t(0o170000) == mode_t(0o100000),
        openedStatus.st_mode & mode_t(0o170000) == mode_t(0o100000),
        pathStatus.st_uid == Darwin.geteuid(),
        openedStatus.st_uid == Darwin.geteuid(),
        pathStatus.st_nlink == 1,
        openedStatus.st_nlink == 1,
        openedStatus.st_mode & mode_t(0o100) != 0,
        openedStatus.st_mode & mode_t(0o022) == 0,
        pathStatus.st_dev == openedStatus.st_dev,
        pathStatus.st_ino == openedStatus.st_ino,
        byteCount > 8,
        byteCount <= 67_108_864
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The B2 helper identity or permissions were not admitted."
        )
    }
    let bytes = try handle.readToEnd() ?? Data()
    var finalOpenedStatus = stat()
    var finalPathStatus = stat()
    guard
        bytes.count == Int(byteCount),
        bytes.prefix(4).elementsEqual([0xCF, 0xFA, 0xED, 0xFE]),
        bytes[4..<8].elementsEqual([0x0C, 0x00, 0x00, 0x01]),
        Darwin.fstat(descriptor, &finalOpenedStatus) == 0,
        url.path.withCString({ Darwin.lstat($0, &finalPathStatus) }) == 0,
        finalOpenedStatus.st_dev == openedStatus.st_dev,
        finalOpenedStatus.st_ino == openedStatus.st_ino,
        finalOpenedStatus.st_size == openedStatus.st_size,
        finalPathStatus.st_dev == openedStatus.st_dev,
        finalPathStatus.st_ino == openedStatus.st_ino,
        finalPathStatus.st_size == openedStatus.st_size
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The B2 helper was not a stable thin 64-bit Mach-O object."
        )
    }
    let digest = ArtifactSnapshot.digest(bytes)
    guard digest == expectedDigest else {
        throw CoherentReplacementB2Failure.unexpected(
            "The B2 helper digest did not match the exact lane build."
        )
    }
    return CoherentReplacementB2ExecutableAdmission(
        url: url,
        identity: CoherentReplacementB2Identity(
            device: UInt64(openedStatus.st_dev),
            inode: UInt64(openedStatus.st_ino)
        ),
        byteCount: byteCount,
        digest: digest
    )
}

private func coherentReplacementB2RevalidateProbeExecutable(
    _ admission: CoherentReplacementB2ExecutableAdmission
) throws {
    let current = try coherentReplacementB2ReadProbeExecutable(
        admission.url,
        expectedDigest: admission.digest
    )
    guard
        current.identity == admission.identity,
        current.byteCount == admission.byteCount,
        current.digest == admission.digest
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The B2 helper changed between admission and launch."
        )
    }
}

private func coherentReplacementB2ProbeExecutable() throws
    -> CoherentReplacementB2ExecutableAdmission
{
    let environment = ProcessInfo.processInfo.environment
    guard
        let configured = environment["VERITAS_LEDGER_CRASH_PROBE_PATH"],
        !configured.isEmpty,
        let expectedDigest = environment["VERITAS_LEDGER_CRASH_PROBE_SHA256"],
        coherentReplacementB2IsDigest(expectedDigest)
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The exact B2 helper path and lane-build digest were not supplied."
        )
    }
    return try coherentReplacementB2ReadProbeExecutable(
        URL(fileURLWithPath: configured).standardizedFileURL,
        expectedDigest: expectedDigest
    )
}

private func coherentReplacementB2Request(_ label: String, repetition: Int) -> String {
    "\(label)-\(repetition)-\(UUID().uuidString.lowercased())"
}

private func coherentReplacementB2Deadline() -> UInt64 {
    DispatchTime.now().uptimeNanoseconds + coherentReplacementB2DeadlineNanoseconds
}

private func coherentReplacementB2RemainingMilliseconds(deadline: UInt64) -> Int32 {
    let now = DispatchTime.now().uptimeNanoseconds
    guard now < deadline else { return 0 }
    let remaining = deadline - now
    return Int32(min((remaining + 999_999) / 1_000_000, UInt64(Int32.max)))
}

private func coherentReplacementB2ReadLine(
    descriptor: Int32,
    deadline: UInt64
) throws -> String {
    var bytes: [UInt8] = []
    bytes.reserveCapacity(128)
    while bytes.count < coherentReplacementB2MaximumFrameBytes {
        let timeout = coherentReplacementB2RemainingMilliseconds(deadline: deadline)
        guard timeout > 0 else {
            throw CoherentReplacementB2Failure.process("The B2 child frame timed out.")
        }
        var pollDescriptor = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
        let pollResult = Darwin.poll(&pollDescriptor, 1, timeout)
        if pollResult < 0, errno == EINTR { continue }
        guard pollResult == 1 else {
            throw CoherentReplacementB2Failure.process("The B2 child frame timed out.")
        }
        guard pollDescriptor.revents & Int16(POLLERR | POLLNVAL) == 0 else {
            throw CoherentReplacementB2Failure.process("The B2 child pipe failed.")
        }
        var byte: UInt8 = 0
        let readCount = withUnsafeMutableBytes(of: &byte) { buffer in
            Darwin.read(descriptor, buffer.baseAddress, 1)
        }
        if readCount < 0, errno == EINTR { continue }
        guard readCount == 1 else {
            throw CoherentReplacementB2Failure.process("The B2 child frame ended early.")
        }
        bytes.append(byte)
        if byte == 0x0A { return String(decoding: bytes, as: UTF8.self) }
    }
    throw CoherentReplacementB2Failure.protocolViolation("The B2 child frame was oversized.")
}

private func coherentReplacementB2WriteLine(
    _ line: String,
    descriptor: Int32,
    deadline: UInt64
) throws {
    let bytes = Array(line.utf8)
    try bytes.withUnsafeBytes { rawBuffer in
        guard let baseAddress = rawBuffer.baseAddress else {
            throw CoherentReplacementB2Failure.process("The B2 parent frame was empty.")
        }
        var offset = 0
        while offset < rawBuffer.count {
            let timeout = coherentReplacementB2RemainingMilliseconds(deadline: deadline)
            guard timeout > 0 else {
                throw CoherentReplacementB2Failure.process("The B2 parent frame timed out.")
            }
            var pollDescriptor = pollfd(fd: descriptor, events: Int16(POLLOUT), revents: 0)
            let pollResult = Darwin.poll(&pollDescriptor, 1, timeout)
            if pollResult < 0, errno == EINTR { continue }
            guard pollResult == 1, pollDescriptor.revents & Int16(POLLERR | POLLNVAL) == 0 else {
                throw CoherentReplacementB2Failure.process("The B2 parent pipe failed.")
            }
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
                throw CoherentReplacementB2Failure.process("The B2 parent write failed.")
            }
        }
    }
}

private func coherentReplacementB2WaitForExit(
    _ session: CoherentReplacementB2ProcessSession,
    deadline: UInt64
) throws {
    let timeout = DispatchTime(uptimeNanoseconds: deadline)
    guard session.termination.wait(timeout: timeout) == .success else {
        throw CoherentReplacementB2Failure.process("The B2 child exceeded its deadline.")
    }
    session.process.waitUntilExit()
    session.markReaped()
}

private func coherentReplacementB2KillAndReap(
    _ session: CoherentReplacementB2ProcessSession
) throws {
    guard session.process.isRunning else {
        throw CoherentReplacementB2Failure.process("The B2 child exited before SIGKILL.")
    }
    guard Darwin.kill(session.process.processIdentifier, SIGKILL) == 0 else {
        throw CoherentReplacementB2Failure.process("Unable to SIGKILL the B2 child.")
    }
    let grace = DispatchTime.now() + .seconds(5)
    guard session.termination.wait(timeout: grace) == .success else {
        throw CoherentReplacementB2Failure.process("The B2 child was not reaped after SIGKILL.")
    }
    session.process.waitUntilExit()
    session.markReaped()
    guard
        session.process.terminationReason == .uncaughtSignal,
        session.process.terminationStatus == SIGKILL
    else {
        throw CoherentReplacementB2Failure.process("The B2 child had the wrong kill status.")
    }
}

private func coherentReplacementB3KillAndReap(
    _ session: CoherentReplacementB2ProcessSession,
    deadline: UInt64
) throws {
    guard session.process.isRunning else {
        throw CoherentReplacementB2Failure.process(
            "The Baseline B3 child exited before SIGKILL."
        )
    }
    guard Darwin.kill(session.process.processIdentifier, SIGKILL) == 0 else {
        throw CoherentReplacementB2Failure.process(
            "Unable to SIGKILL the Baseline B3 child."
        )
    }
    guard session.termination.wait(
        timeout: DispatchTime(uptimeNanoseconds: deadline)
    ) == .success else {
        throw CoherentReplacementB2Failure.process(
            "The Baseline B3 child was not reaped within its single absolute deadline."
        )
    }
    session.process.waitUntilExit()
    session.markReaped()
    guard
        session.process.terminationReason == .uncaughtSignal,
        session.process.terminationStatus == SIGKILL
    else {
        throw CoherentReplacementB2Failure.process(
            "The Baseline B3 child had the wrong kill status."
        )
    }
}

private func cleanupCoherentReplacementB2Session(
    _ session: CoherentReplacementB2ProcessSession
) {
    defer {
        do {
            try session.closeParentHandles()
        } catch {
            session.custody.retain("parent process-pipe handles did not close: \(error)")
        }
    }
    guard !session.reaped else { return }
    do {
        if session.process.isRunning {
            let killResult = Darwin.kill(session.process.processIdentifier, SIGKILL)
            guard killResult == 0 || errno == ESRCH else {
                throw CoherentReplacementB2Failure.process(
                    "Unable to terminate a nonterminal B2 child during cleanup."
                )
            }
        }
        guard session.termination.wait(timeout: .now() + .seconds(5)) == .success else {
            throw CoherentReplacementB2Failure.process(
                "A B2 child remained unreaped after cleanup grace."
            )
        }
        session.process.waitUntilExit()
        session.markReaped()
    } catch {
        session.custody.retain("child PID \(session.process.processIdentifier) was not reaped: \(error)")
    }
}

private func cleanupCoherentReplacementB3BSession(
    _ session: CoherentReplacementB2ProcessSession,
    containmentDeadline: UInt64
) {
    defer {
        do {
            try session.closeParentHandles()
        } catch {
            session.custody.retain("B3B parent process-pipe handles did not close: \(error)")
        }
    }
    guard !session.reaped else { return }
    do {
        if session.process.isRunning {
            let killResult = Darwin.kill(session.process.processIdentifier, SIGKILL)
            guard killResult == 0 || errno == ESRCH else {
                throw CoherentReplacementB2Failure.process(
                    "Unable to contain a nonterminal B3B child."
                )
            }
        }
        guard session.termination.wait(
            timeout: DispatchTime(uptimeNanoseconds: containmentDeadline)
        ) == .success else {
            throw CoherentReplacementB2Failure.process(
                "A B3B child remained unreaped after its absolute containment deadline."
            )
        }
        session.process.waitUntilExit()
        session.markReaped()
    } catch {
        session.custody.retain(
            "B3B child PID \(session.process.processIdentifier) was not contained: \(error)"
        )
    }
}

private func coherentReplacementB2RequireNoResidualOutput(
    _ session: CoherentReplacementB2ProcessSession
) throws {
    let output = session.outputReader.readDataToEndOfFile()
    let error = session.errorReader.readDataToEndOfFile()
    guard output.isEmpty, error.isEmpty else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "The B2 child emitted extra stdout or stderr bytes."
        )
    }
}

private func coherentReplacementB2RunRecovery(
    executable: CoherentReplacementB2ExecutableAdmission,
    root: URL,
    custody: CoherentReplacementB2FixtureCustody,
    scope: IncidentLedgerScopeV1,
    request: String,
    recoveryCase: String,
    repetition: Int,
    expectedEvents: Int64,
    expectedCandidate: Bool,
    expectedBaselineIncidentID: String,
    expectedBaselineEventDigest: String
) throws -> CoherentReplacementB2RecoveryOutcome {
    let session = try CoherentReplacementB2ProcessSession(
        executable: executable,
        arguments: [
            "b2-recover",
            root.path,
            scope.projectDigest,
            request,
            recoveryCase,
            "\(repetition)",
            "\(expectedEvents)",
            expectedBaselineIncidentID,
            expectedBaselineEventDigest,
        ],
        acceptsInput: false,
        custody: custody
    )
    defer { cleanupCoherentReplacementB2Session(session) }
    try coherentReplacementB2WaitForExit(session, deadline: coherentReplacementB2Deadline())
    guard
        session.process.terminationReason == .exit,
        session.process.terminationStatus == 0
    else {
        throw CoherentReplacementB2Failure.process(
            "The B2 recovery child did not exit normally."
        )
    }
    let outputData = session.outputReader.readDataToEndOfFile()
    let errorData = session.errorReader.readDataToEndOfFile()
    guard errorData.isEmpty else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "The B2 recovery child emitted stderr bytes."
        )
    }
    let output = String(decoding: outputData, as: UTF8.self)
    let pid = session.process.processIdentifier
    guard output.hasSuffix("\n"), output.filter({ $0 == "\n" }).count == 1 else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "The B2 recovery child emitted malformed or extra output."
        )
    }
    let fields = String(output.dropLast()).split(separator: "|", omittingEmptySubsequences: false)
    if
        fields.count == 11,
        fields[0] == "VERITAS_B2_RECOVERY",
        fields[1] == "v1",
        fields[2] == "request=\(request)",
        fields[3] == "case=\(recoveryCase)",
        fields[4] == "repetition=\(repetition)",
        fields[5] == "outcome=RECOVERED_EXACT",
        fields[6] == "events=\(expectedEvents)",
        fields[7] == "candidate_present=\(expectedCandidate)",
        fields[8].hasPrefix("head_digest="),
        coherentReplacementB2IsDigest(String(fields[8].dropFirst("head_digest=".count))),
        fields[9] == "authorizing=false",
        fields[10] == "pid=\(pid)"
    {
        return .recoveredExact(
            headDigest: String(fields[8].dropFirst("head_digest=".count))
        )
    }

    let refusedIntegrity =
        "VERITAS_B2_RECOVERY|v1|request=\(request)|case=\(recoveryCase)" +
        "|repetition=\(repetition)|outcome=REFUSED_INTEGRITY" +
        "|authorizing=false|pid=\(pid)\n"
    if output == refusedIntegrity { return .refusedIntegrity }

    guard
        fields.count == 9,
        fields[0] == "VERITAS_B2_RECOVERY",
        fields[1] == "v1",
        fields[2] == "request=\(request)",
        fields[3] == "case=\(recoveryCase)",
        fields[4] == "repetition=\(repetition)",
        fields[5] == "outcome=REFUSED_SQLITE",
        fields[6].hasPrefix("sqlite_code="),
        let sqliteCode = Int32(fields[6].dropFirst("sqlite_code=".count)),
        fields[7] == "authorizing=false",
        fields[8] == "pid=\(pid)"
    else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "The B2 recovery child emitted an unknown result frame."
        )
    }
    return .refusedSQLite(sqliteCode)
}

private func coherentReplacementB2RunAbruptCommit(
    executable: CoherentReplacementB2ExecutableAdmission,
    root: URL,
    custody: CoherentReplacementB2FixtureCustody,
    scope: IncidentLedgerScopeV1,
    repetition: Int
) throws {
    let request = coherentReplacementB2Request("cr05-abrupt", repetition: repetition)
    let session = try CoherentReplacementB2ProcessSession(
        executable: executable,
        arguments: [
            "b2-abrupt",
            root.path,
            scope.projectDigest,
            request,
            "\(repetition)",
            IncidentLedgerAbruptProcessPointV1.afterObservationCommitBeforeReturn.rawValue,
        ],
        acceptsInput: false,
        custody: custody
    )
    defer { cleanupCoherentReplacementB2Session(session) }
    let deadline = coherentReplacementB2Deadline()
    let expected =
        "VERITAS_B2_CHILD|v1|request=\(request)|case=CR-05" +
        "|repetition=\(repetition)|phase=AFTER_OBSERVATION_COMMIT" +
        "|pid=\(session.process.processIdentifier)\n"
    guard try coherentReplacementB2ReadLine(
        descriptor: session.outputReader.fileDescriptor,
        deadline: deadline
    ) == expected else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "The B2 abrupt child READY frame did not bind its request and PID."
        )
    }
    try coherentReplacementB2KillAndReap(session)
    try coherentReplacementB2RequireNoResidualOutput(session)
}

private func coherentReplacementB2RunCR01OpenABA(
    executable: CoherentReplacementB2ExecutableAdmission,
    root: URL,
    custody: CoherentReplacementB2FixtureCustody,
    scope: IncidentLedgerScopeV1,
    main: URL,
    alternate: URL,
    originalIdentity: CoherentReplacementB2Identity,
    alternateIdentity: CoherentReplacementB2Identity,
    repetition: Int
) throws -> CoherentReplacementB2CR01Outcome {
    let request = coherentReplacementB2Request("cr01-open", repetition: repetition)
    let session = try CoherentReplacementB2ProcessSession(
        executable: executable,
        arguments: [
            "b2-cr01",
            root.path,
            scope.projectDigest,
            request,
            "\(repetition)",
        ],
        acceptsInput: true,
        custody: custody
    )
    var alternateIsMain = false
    defer {
        cleanupCoherentReplacementB2Session(session)
        if alternateIsMain {
            if !session.reaped {
                session.custody.retain(
                    "CR-01 A-B-A restoration was withheld because its child remained unreaped."
                )
            } else {
                do {
                    try coherentReplacementB2AtomicSwap(main, alternate)
                } catch {
                    session.custody.retain("CR-01 A-B-A restoration failed: \(error)")
                }
            }
        }
    }
    let deadline = coherentReplacementB2Deadline()
    let pid = session.process.processIdentifier
    func readPhase(_ phase: String) throws -> String {
        do {
            return try coherentReplacementB2ReadLine(
                descriptor: session.outputReader.fileDescriptor,
                deadline: deadline
            )
        } catch {
            if !session.process.isRunning,
               session.termination.wait(timeout: .now() + .seconds(1)) == .success {
                session.process.waitUntilExit()
                session.markReaped()
                let diagnostic = String(
                    decoding: session.errorReader.readDataToEndOfFile(),
                    as: UTF8.self
                ).trimmingCharacters(in: .whitespacesAndNewlines)
                throw CoherentReplacementB2Failure.protocolViolation(
                    "CR-01 child exited during \(phase) with status " +
                        "\(session.process.terminationStatus): \(diagnostic)"
                )
            }
            throw error
        }
    }
    let before =
        "VERITAS_B2_CHILD|v1|request=\(request)|case=CR-01" +
        "|repetition=\(repetition)|phase=BEFORE_SQLITE_OPEN|pid=\(pid)\n"
    guard try readPhase("BEFORE_SQLITE_OPEN") == before else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "The CR-01 child did not reach the pre-open barrier."
        )
    }
    guard
        try coherentReplacementB2RegularState(
            main,
            maximumBytes: 67_108_864
        ).identity == originalIdentity,
        try coherentReplacementB2RegularState(
            alternate,
            maximumBytes: 67_108_864
        ).identity == alternateIdentity
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "CR-01 identities changed before the controlled swap."
        )
    }
    try coherentReplacementB2AtomicSwap(main, alternate)
    alternateIsMain = true
    guard
        try coherentReplacementB2RegularState(
            main,
            maximumBytes: 67_108_864
        ).identity == alternateIdentity
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "CR-01 did not install alternate B as the main pathname."
        )
    }
    let input = try #require(session.inputWriter)
    try coherentReplacementB2WriteLine(
        "VERITAS_B2_CONTINUE|v1|request=\(request)|case=CR-01" +
            "|repetition=\(repetition)|phase=BEFORE_SQLITE_OPEN|pid=\(pid)\n",
        descriptor: input.fileDescriptor,
        deadline: deadline
    )
    let after =
        "VERITAS_B2_CHILD|v1|request=\(request)|case=CR-01" +
        "|repetition=\(repetition)|phase=AFTER_SQLITE_OPEN|pid=\(pid)\n"
    guard try readPhase("AFTER_SQLITE_OPEN") == after else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "The CR-01 child did not reach the post-open barrier."
        )
    }
    try coherentReplacementB2AtomicSwap(main, alternate)
    alternateIsMain = false
    guard
        try coherentReplacementB2RegularState(
            main,
            maximumBytes: 67_108_864
        ).identity == originalIdentity,
        try coherentReplacementB2RegularState(
            alternate,
            maximumBytes: 67_108_864
        ).identity == alternateIdentity
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "CR-01 did not restore original A before path re-attestation."
        )
    }
    try coherentReplacementB2WriteLine(
        "VERITAS_B2_CONTINUE|v1|request=\(request)|case=CR-01" +
            "|repetition=\(repetition)|phase=AFTER_SQLITE_OPEN|pid=\(pid)\n",
        descriptor: input.fileDescriptor,
        deadline: deadline
    )
    let verified =
        "VERITAS_B2_CHILD|v1|request=\(request)|case=CR-01" +
        "|repetition=\(repetition)|phase=OPEN_BOOTSTRAP_VERIFIED" +
        "|events=1|authorizing=false|pid=\(pid)\n"
    let refused =
        "VERITAS_B2_CHILD|v1|request=\(request)|case=CR-01" +
        "|repetition=\(repetition)|phase=OPEN_SUCCEEDED_BOOTSTRAP_REFUSED" +
        "|sqlite_code=10|authorizing=false|pid=\(pid)\n"
    let terminal = try readPhase("OPEN_BOOTSTRAP_TERMINAL")
    let outcome: CoherentReplacementB2CR01Outcome
    if terminal == verified {
        outcome = .bootstrapVerified
    } else if terminal == refused {
        outcome = .bootstrapRefusedSQLiteIOError
    } else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "The CR-01 child emitted an unknown post-open terminal frame."
        )
    }
    try coherentReplacementB2KillAndReap(session)
    try coherentReplacementB2RequireNoResidualOutput(session)
    return outcome
}

private func coherentReplacementB2PrepareControlRoot(
    label: String,
    scope: IncidentLedgerScopeV1,
    main: URL,
    wal: URL?
) throws -> URL {
    let root = try coherentReplacementB2Root(label)
    let projects = root.appendingPathComponent("projects", isDirectory: true)
    let project = projects.appendingPathComponent(scope.projectDigest, isDirectory: true)
    do {
        try FileManager.default.createDirectory(
            at: projects,
            withIntermediateDirectories: false,
            attributes: [.posixPermissions: NSNumber(value: 0o700)]
        )
        try FileManager.default.createDirectory(
            at: project,
            withIntermediateDirectories: false,
            attributes: [.posixPermissions: NSNumber(value: 0o700)]
        )
        let controlMain = project.appendingPathComponent("incident-ledger-v1.sqlite3")
        try coherentReplacementB2CopyPrivateFile(from: main, to: controlMain)
        if let wal {
            try coherentReplacementB2CopyPrivateFile(
                from: wal,
                to: URL(fileURLWithPath: controlMain.path + "-wal")
            )
        }
        return root
    } catch {
        // Keep a partially constructed private fixture for diagnosis. Do not fall
        // back to recursive pathname deletion from an error path.
        Issue.record("Retaining incomplete Baseline B control root: \(root.path)")
        throw error
    }
}

private func coherentReplacementB2VerifiedAtStatus(
    directoryDescriptor: Int32,
    name: String,
    expected: CoherentReplacementB2RegularState
) throws -> stat {
    var status = stat()
    let result = name.withCString { namePointer in
        Darwin.fstatat(directoryDescriptor, namePointer, &status, AT_SYMLINK_NOFOLLOW)
    }
    guard
        result == 0,
        status.st_mode & mode_t(0o170000) == mode_t(0o100000),
        status.st_uid == Darwin.geteuid(),
        status.st_nlink == 1,
        status.st_mode & mode_t(0o777) == mode_t(0o600),
        Int64(status.st_size) == expected.byteCount,
        UInt64(status.st_dev) == expected.identity.device,
        UInt64(status.st_ino) == expected.identity.inode
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The B2 SHM path changed before its post-reap mutation."
        )
    }
    return status
}

@discardableResult
private func coherentReplacementB2MutateSHM(
    _ mutation: CoherentReplacementB2SHMMutation,
    project: URL,
    shm: URL,
    expected: CoherentReplacementB2RegularState
) throws -> String? {
    let directoryDescriptor = Darwin.open(
        project.path,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard directoryDescriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to open the B2 project directory without following links."
        )
    }
    defer { Darwin.close(directoryDescriptor) }
    let name = shm.lastPathComponent
    _ = try coherentReplacementB2VerifiedAtStatus(
        directoryDescriptor: directoryDescriptor,
        name: name,
        expected: expected
    )

    switch mutation {
    case .remove:
        let descriptor = name.withCString { namePointer in
            Darwin.openat(
                directoryDescriptor,
                namePointer,
                O_RDONLY | O_NOFOLLOW | O_CLOEXEC
            )
        }
        guard descriptor >= 0 else {
            throw CoherentReplacementB2Failure.filesystem("Unable to open B2 SHM before unlink.")
        }
        var openedStatus = stat()
        let fstatResult = Darwin.fstat(descriptor, &openedStatus)
        let closeResult = Darwin.close(descriptor)
        guard
            fstatResult == 0,
            closeResult == 0,
            UInt64(openedStatus.st_dev) == expected.identity.device,
            UInt64(openedStatus.st_ino) == expected.identity.inode
        else {
            throw CoherentReplacementB2Failure.unexpected(
                "The B2 SHM descriptor did not match its admitted path."
            )
        }
        let unlinkResult = name.withCString { namePointer in
            Darwin.unlinkat(directoryDescriptor, namePointer, 0)
        }
        guard unlinkResult == 0, Darwin.fsync(directoryDescriptor) == 0 else {
            throw CoherentReplacementB2Failure.filesystem(
                "Unable to durably remove post-reap B2 SHM."
            )
        }
        guard !FileManager.default.fileExists(atPath: shm.path) else {
            throw CoherentReplacementB2Failure.unexpected("Removed B2 SHM remained present.")
        }
        return nil

    case .corrupt:
        let descriptor = name.withCString { namePointer in
            Darwin.openat(
                directoryDescriptor,
                namePointer,
                O_RDWR | O_NOFOLLOW | O_CLOEXEC
            )
        }
        guard descriptor >= 0 else {
            throw CoherentReplacementB2Failure.filesystem("Unable to open B2 SHM for corruption.")
        }
        defer { Darwin.close(descriptor) }
        var openedStatus = stat()
        guard
            Darwin.fstat(descriptor, &openedStatus) == 0,
            UInt64(openedStatus.st_dev) == expected.identity.device,
            UInt64(openedStatus.st_ino) == expected.identity.inode,
            Int64(openedStatus.st_size) == expected.byteCount,
            expected.byteCount > 0,
            expected.byteCount <= coherentReplacementB2MaximumSHMBytes
        else {
            throw CoherentReplacementB2Failure.unexpected(
                "The B2 SHM corruption descriptor was not admitted."
            )
        }
        let block = [UInt8](repeating: 0xA5, count: 4_096)
        var offset: Int64 = 0
        while offset < expected.byteCount {
            let count = Int(min(Int64(block.count), expected.byteCount - offset))
            let written = block.withUnsafeBytes { buffer in
                Darwin.pwrite(descriptor, buffer.baseAddress, count, off_t(offset))
            }
            guard written == count else {
                throw CoherentReplacementB2Failure.filesystem(
                    "The complete B2 SHM corruption write was incomplete."
                )
            }
            offset += Int64(written)
        }
        guard Darwin.fsync(descriptor) == 0, Darwin.fsync(directoryDescriptor) == 0 else {
            throw CoherentReplacementB2Failure.filesystem(
                "Unable to fsync the complete B2 SHM corruption."
            )
        }
        let corrupted = try coherentReplacementB2RegularState(
            shm,
            maximumBytes: coherentReplacementB2MaximumSHMBytes
        )
        guard corrupted.identity == expected.identity, corrupted.digest != expected.digest else {
            throw CoherentReplacementB2Failure.unexpected(
                "The deterministic B2 SHM corruption was not observed."
            )
        }
        return corrupted.digest
    }
}

private struct CoherentReplacementB3DirectoryBinding {
    let identity: CoherentReplacementB2Identity
    let permissions: mode_t
}

private struct CoherentReplacementB3RegularSnapshot {
    let state: CoherentReplacementB2RegularState
    let bytes: Data
}

private func coherentReplacementB3DirectoryBinding(
    _ url: URL
) throws -> CoherentReplacementB3DirectoryBinding {
    var status = stat()
    guard
        url.path.withCString({ Darwin.lstat($0, &status) }) == 0,
        status.st_mode & mode_t(0o170000) == mode_t(0o040000),
        status.st_uid == Darwin.geteuid(),
        status.st_mode & mode_t(0o777) == mode_t(0o700)
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A Baseline B3 directory was outside the admitted private profile."
        )
    }
    return CoherentReplacementB3DirectoryBinding(
        identity: CoherentReplacementB2Identity(
            device: UInt64(status.st_dev),
            inode: UInt64(status.st_ino)
        ),
        permissions: status.st_mode & mode_t(0o777)
    )
}

private func coherentReplacementB3RelativeRegularSnapshot(
    directoryDescriptor: Int32,
    name: String,
    maximumBytes: Int64,
    requireNonempty: Bool = true
) throws -> CoherentReplacementB3RegularSnapshot {
    var pathStatus = stat()
    guard name.withCString({ pointer in
        Darwin.fstatat(directoryDescriptor, pointer, &pathStatus, AT_SYMLINK_NOFOLLOW)
    }) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to inspect a Baseline B3 relative regular path."
        )
    }
    let descriptor = name.withCString { pointer in
        Darwin.openat(directoryDescriptor, pointer, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
    }
    guard descriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to open a Baseline B3 relative regular file."
        )
    }
    var descriptorIsOpen = true
    defer {
        if descriptorIsOpen {
            _ = Darwin.close(descriptor)
        }
    }
    var openedStatus = stat()
    guard Darwin.fstat(descriptor, &openedStatus) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to inspect an opened Baseline B3 regular file."
        )
    }
    let byteCount = Int64(openedStatus.st_size)
    guard
        pathStatus.st_mode & mode_t(0o170000) == mode_t(0o100000),
        openedStatus.st_mode & mode_t(0o170000) == mode_t(0o100000),
        pathStatus.st_uid == Darwin.geteuid(),
        openedStatus.st_uid == Darwin.geteuid(),
        pathStatus.st_nlink == 1,
        openedStatus.st_nlink == 1,
        openedStatus.st_mode & mode_t(0o777) == mode_t(0o600),
        pathStatus.st_dev == openedStatus.st_dev,
        pathStatus.st_ino == openedStatus.st_ino,
        pathStatus.st_size == openedStatus.st_size,
        (!requireNonempty || byteCount > 0),
        byteCount <= maximumBytes
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A Baseline B3 regular file was outside the admitted profile."
        )
    }

    var bytes = Data()
    bytes.reserveCapacity(Int(byteCount))
    var buffer = [UInt8](repeating: 0, count: 65_536)
    while bytes.count < Int(byteCount) {
        let readCount = buffer.withUnsafeMutableBytes { rawBuffer in
            Darwin.read(descriptor, rawBuffer.baseAddress, rawBuffer.count)
        }
        if readCount < 0, errno == EINTR { continue }
        guard readCount > 0 else {
            throw CoherentReplacementB2Failure.filesystem(
                "A Baseline B3 descriptor read ended before the admitted size."
            )
        }
        bytes.append(buffer, count: readCount)
        guard bytes.count <= Int(byteCount) else {
            throw CoherentReplacementB2Failure.unexpected(
                "A Baseline B3 descriptor produced more bytes than admitted."
            )
        }
    }
    var finalOpenedStatus = stat()
    var finalPathStatus = stat()
    guard
        Darwin.fstat(descriptor, &finalOpenedStatus) == 0,
        name.withCString({ pointer in
            Darwin.fstatat(
                directoryDescriptor,
                pointer,
                &finalPathStatus,
                AT_SYMLINK_NOFOLLOW
            )
        }) == 0,
        finalOpenedStatus.st_dev == openedStatus.st_dev,
        finalOpenedStatus.st_ino == openedStatus.st_ino,
        finalOpenedStatus.st_size == openedStatus.st_size,
        finalPathStatus.st_dev == openedStatus.st_dev,
        finalPathStatus.st_ino == openedStatus.st_ino,
        finalPathStatus.st_size == openedStatus.st_size
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A Baseline B3 regular file drifted during descriptor admission."
        )
    }
    guard Darwin.close(descriptor) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to close an admitted Baseline B3 regular descriptor."
        )
    }
    descriptorIsOpen = false
    return CoherentReplacementB3RegularSnapshot(
        state: CoherentReplacementB2RegularState(
            identity: CoherentReplacementB2Identity(
                device: UInt64(openedStatus.st_dev),
                inode: UInt64(openedStatus.st_ino)
            ),
            permissions: openedStatus.st_mode & mode_t(0o777),
            byteCount: byteCount,
            digest: ArtifactSnapshot.digest(bytes)
        ),
        bytes: bytes
    )
}

private func coherentReplacementB3RelativeRegularState(
    directoryDescriptor: Int32,
    name: String,
    maximumBytes: Int64
) throws -> CoherentReplacementB2RegularState {
    try coherentReplacementB3RelativeRegularSnapshot(
        directoryDescriptor: directoryDescriptor,
        name: name,
        maximumBytes: maximumBytes
    ).state
}

private func coherentReplacementB3WALState(
    _ snapshot: CoherentReplacementB3RegularSnapshot
) throws -> CoherentReplacementB2WALState {
    let bytes = snapshot.bytes
    guard bytes.count >= 32 else {
        throw CoherentReplacementB2Failure.unexpected(
            "The Baseline B3 WAL lacked a complete descriptor-bound header."
        )
    }
    let magic = try coherentReplacementB2ReadUInt32BigEndian(bytes, offset: 0)
    guard magic == 0x377f0682 || magic == 0x377f0683 else {
        throw CoherentReplacementB2Failure.unexpected(
            "The Baseline B3 WAL descriptor bytes had an invalid magic."
        )
    }
    let encodedPageSize = try coherentReplacementB2ReadUInt32BigEndian(bytes, offset: 8)
    let pageSize = encodedPageSize == 1 ? Int64(65_536) : Int64(encodedPageSize)
    guard pageSize >= 512, pageSize <= 65_536, pageSize.nonzeroBitCount == 1 else {
        throw CoherentReplacementB2Failure.unexpected(
            "The Baseline B3 WAL descriptor bytes had an invalid page size."
        )
    }
    let frameBytes = pageSize + 24
    let payloadBytes = snapshot.state.byteCount - 32
    guard payloadBytes > 0, payloadBytes % frameBytes == 0 else {
        throw CoherentReplacementB2Failure.unexpected(
            "The Baseline B3 WAL descriptor bytes lacked integral nonzero frames."
        )
    }
    return CoherentReplacementB2WALState(
        pageSize: pageSize,
        physicalFrameCapacity: payloadBytes / frameBytes,
        byteCount: snapshot.state.byteCount
    )
}

private func coherentReplacementB3RequireAbsentRelativePath(
    directoryDescriptor: Int32,
    name: String
) throws {
    var status = stat()
    errno = 0
    let result = name.withCString { pointer in
        Darwin.fstatat(directoryDescriptor, pointer, &status, AT_SYMLINK_NOFOLLOW)
    }
    guard result == -1, errno == ENOENT else {
        throw CoherentReplacementB2Failure.unexpected(
            "A Baseline B3 path required to be absent was present or indeterminate."
        )
    }
}

private func coherentReplacementB3RunAbruptCommit(
    executable: CoherentReplacementB2ExecutableAdmission,
    root: URL,
    custody: CoherentReplacementB2FixtureCustody,
    scope: IncidentLedgerScopeV1,
    repetition: Int
) throws {
    let request = coherentReplacementB2Request("cr04-abrupt", repetition: repetition)
    let session = try CoherentReplacementB2ProcessSession(
        executable: executable,
        arguments: [
            "b3-cr04-abrupt",
            root.path,
            scope.projectDigest,
            request,
            "\(repetition)",
            IncidentLedgerAbruptProcessPointV1.afterObservationCommitBeforeReturn.rawValue,
        ],
        acceptsInput: false,
        custody: custody
    )
    defer { cleanupCoherentReplacementB2Session(session) }
    let deadline = coherentReplacementB2Deadline()
    let expected =
        "VERITAS_B3_CHILD|v1|request=\(request)|case=CR-04" +
        "|variant=WAL_IDENTITY_GENERATOR|repetition=\(repetition)" +
        "|phase=AFTER_OBSERVATION_COMMIT|pid=\(session.process.processIdentifier)\n"
    guard try coherentReplacementB2ReadLine(
        descriptor: session.outputReader.fileDescriptor,
        deadline: deadline
    ) == expected else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "The Baseline B3 CR-04 generator frame did not bind its exact case and PID."
        )
    }
    try coherentReplacementB3KillAndReap(session, deadline: deadline)
    try coherentReplacementB2RequireNoResidualOutput(session)
    try session.closeParentHandles()
}

private func coherentReplacementB3FreezeWALAlternate(
    project: URL,
    projectBinding: CoherentReplacementB3DirectoryBinding,
    walName: String,
    alternateName: String,
    expectedWAL: CoherentReplacementB2RegularState
) throws -> CoherentReplacementB2RegularState {
    let directoryDescriptor = Darwin.open(
        project.path,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard directoryDescriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to open the Baseline B3 project directory for alternate admission."
        )
    }
    var directoryIsOpen = true
    defer {
        if directoryIsOpen {
            _ = Darwin.close(directoryDescriptor)
        }
    }
    var directoryStatus = stat()
    guard
        Darwin.fstat(directoryDescriptor, &directoryStatus) == 0,
        UInt64(directoryStatus.st_dev) == projectBinding.identity.device,
        UInt64(directoryStatus.st_ino) == projectBinding.identity.inode
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The Baseline B3 project directory changed before alternate admission."
        )
    }
    let sourceSnapshot = try coherentReplacementB3RelativeRegularSnapshot(
        directoryDescriptor: directoryDescriptor,
        name: walName,
        maximumBytes: 67_108_864
    )
    guard sourceSnapshot.state.identity == expectedWAL.identity,
          sourceSnapshot.state.byteCount == expectedWAL.byteCount,
          sourceSnapshot.state.digest == expectedWAL.digest else {
        throw CoherentReplacementB2Failure.unexpected(
            "The Baseline B3 WAL changed before alternate construction."
        )
    }
    let copied = try coherentReplacementB3WriteRelativePrivateFile(
        directoryDescriptor: directoryDescriptor,
        name: alternateName,
        bytes: sourceSnapshot.bytes
    )
    guard
        copied.byteCount == expectedWAL.byteCount,
        copied.digest == expectedWAL.digest,
        copied.identity != expectedWAL.identity
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The Baseline B3 WAL alternate was not byte-identical and identity-distinct."
        )
    }
    let alternateDescriptor = alternateName.withCString { pointer in
        Darwin.openat(directoryDescriptor, pointer, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
    }
    guard alternateDescriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to reopen the Baseline B3 WAL alternate for synchronization."
        )
    }
    let alternateSync = Darwin.fsync(alternateDescriptor)
    let alternateClose = Darwin.close(alternateDescriptor)
    guard alternateSync == 0, alternateClose == 0, Darwin.fsync(directoryDescriptor) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to synchronize the frozen Baseline B3 WAL alternate."
        )
    }
    guard Darwin.close(directoryDescriptor) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to close the Baseline B3 alternate project descriptor."
        )
    }
    directoryIsOpen = false
    return copied
}

private func coherentReplacementB3WriteRelativePrivateFile(
    directoryDescriptor: Int32,
    name: String,
    bytes: Data
) throws -> CoherentReplacementB2RegularState {
    guard !bytes.isEmpty, bytes.count <= 67_108_864 else {
        throw CoherentReplacementB2Failure.unexpected(
            "A Baseline B3 mutation-subject file exceeded the admitted size."
        )
    }
    let descriptor = name.withCString { pointer in
        Darwin.openat(
            directoryDescriptor,
            pointer,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            mode_t(0o600)
        )
    }
    guard descriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to create a Baseline B3 descriptor-relative subject file."
        )
    }
    var descriptorIsOpen = true
    defer {
        if descriptorIsOpen {
            _ = Darwin.close(descriptor)
        }
    }
    try bytes.withUnsafeBytes { rawBuffer in
        guard let baseAddress = rawBuffer.baseAddress else {
            throw CoherentReplacementB2Failure.unexpected(
                "A Baseline B3 subject file had no bytes to write."
            )
        }
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
                throw CoherentReplacementB2Failure.filesystem(
                    "A Baseline B3 subject write was incomplete."
                )
            }
        }
    }
    var status = stat()
    guard
        Darwin.fchmod(descriptor, mode_t(0o600)) == 0,
        Darwin.fsync(descriptor) == 0,
        Darwin.fstat(descriptor, &status) == 0,
        status.st_mode & mode_t(0o170000) == mode_t(0o100000),
        status.st_uid == Darwin.geteuid(),
        status.st_nlink == 1,
        status.st_mode & mode_t(0o777) == mode_t(0o600),
        Int(status.st_size) == bytes.count
    else {
        throw CoherentReplacementB2Failure.filesystem(
            "A Baseline B3 subject file did not synchronize exactly."
        )
    }
    let closeResult = Darwin.close(descriptor)
    descriptorIsOpen = false
    guard closeResult == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "A Baseline B3 subject file did not close exactly."
        )
    }
    let admitted = try coherentReplacementB3RelativeRegularState(
        directoryDescriptor: directoryDescriptor,
        name: name,
        maximumBytes: 67_108_864
    )
    guard admitted.digest == ArtifactSnapshot.digest(bytes) else {
        throw CoherentReplacementB2Failure.unexpected(
            "A Baseline B3 subject file failed descriptor-bound readback."
        )
    }
    return admitted
}

private func coherentReplacementB3PrepareFreshMutationSubject(
    root: URL,
    scope: IncidentLedgerScopeV1,
    sourceProject: URL,
    sourceProjectBinding: CoherentReplacementB3DirectoryBinding,
    mainName: String,
    walName: String,
    shmName: String,
    alternateName: String,
    expectedMain: CoherentReplacementB2RegularState,
    expectedWAL: CoherentReplacementB2RegularState,
    expectedAlternate: CoherentReplacementB2RegularState
) throws -> CoherentReplacementB3DirectoryBinding {
    let sourceDescriptor = Darwin.open(
        sourceProject.path,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard sourceDescriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to open the Baseline B3 source project for a fresh subject."
        )
    }
    var sourceIsOpen = true
    defer {
        if sourceIsOpen {
            _ = Darwin.close(sourceDescriptor)
        }
    }
    var sourceStatus = stat()
    guard
        Darwin.fstat(sourceDescriptor, &sourceStatus) == 0,
        UInt64(sourceStatus.st_dev) == sourceProjectBinding.identity.device,
        UInt64(sourceStatus.st_ino) == sourceProjectBinding.identity.inode
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The Baseline B3 source project changed before subject construction."
        )
    }
    let mainSnapshot = try coherentReplacementB3RelativeRegularSnapshot(
        directoryDescriptor: sourceDescriptor,
        name: mainName,
        maximumBytes: 67_108_864
    )
    let walSnapshot = try coherentReplacementB3RelativeRegularSnapshot(
        directoryDescriptor: sourceDescriptor,
        name: walName,
        maximumBytes: 67_108_864
    )
    let alternateSnapshot = try coherentReplacementB3RelativeRegularSnapshot(
        directoryDescriptor: sourceDescriptor,
        name: alternateName,
        maximumBytes: 67_108_864
    )
    guard
        mainSnapshot.state.identity == expectedMain.identity,
        mainSnapshot.state.digest == expectedMain.digest,
        walSnapshot.state.identity == expectedWAL.identity,
        walSnapshot.state.digest == expectedWAL.digest,
        alternateSnapshot.state.identity == expectedAlternate.identity,
        alternateSnapshot.state.digest == expectedAlternate.digest
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The Baseline B3 frozen source changed before subject construction."
        )
    }
    guard Darwin.close(sourceDescriptor) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to close the Baseline B3 source before subject construction."
        )
    }
    sourceIsOpen = false

    let projects = root.appendingPathComponent("projects", isDirectory: true)
    let project = projects.appendingPathComponent(scope.projectDigest, isDirectory: true)
    try FileManager.default.createDirectory(
        at: projects,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: NSNumber(value: 0o700)]
    )
    try FileManager.default.createDirectory(
        at: project,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: NSNumber(value: 0o700)]
    )
    let projectBinding = try coherentReplacementB3DirectoryBinding(project)
    let destinationDescriptor = Darwin.open(
        project.path,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard destinationDescriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to open the fresh Baseline B3 mutation subject."
        )
    }
    var destinationIsOpen = true
    defer {
        if destinationIsOpen {
            _ = Darwin.close(destinationDescriptor)
        }
    }
    var destinationStatus = stat()
    guard
        Darwin.fstat(destinationDescriptor, &destinationStatus) == 0,
        UInt64(destinationStatus.st_dev) == projectBinding.identity.device,
        UInt64(destinationStatus.st_ino) == projectBinding.identity.inode
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The fresh Baseline B3 subject directory changed before population."
        )
    }
    let copiedMain = try coherentReplacementB3WriteRelativePrivateFile(
        directoryDescriptor: destinationDescriptor,
        name: mainName,
        bytes: mainSnapshot.bytes
    )
    let copiedWAL = try coherentReplacementB3WriteRelativePrivateFile(
        directoryDescriptor: destinationDescriptor,
        name: walName,
        bytes: walSnapshot.bytes
    )
    let copiedAlternate = try coherentReplacementB3WriteRelativePrivateFile(
        directoryDescriptor: destinationDescriptor,
        name: alternateName,
        bytes: alternateSnapshot.bytes
    )
    try coherentReplacementB3RequireAbsentRelativePath(
        directoryDescriptor: destinationDescriptor,
        name: shmName
    )
    guard
        copiedMain.digest == expectedMain.digest,
        copiedWAL.digest == expectedWAL.digest,
        copiedAlternate.digest == expectedAlternate.digest,
        copiedMain.identity != expectedMain.identity,
        copiedWAL.identity != expectedWAL.identity,
        copiedAlternate.identity != expectedAlternate.identity,
        copiedWAL.identity != copiedAlternate.identity
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The fresh Baseline B3 subject did not preserve exact distinct copies."
        )
    }
    guard Darwin.fsync(destinationDescriptor) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "The fresh Baseline B3 subject directory did not synchronize."
        )
    }
    let destinationClose = Darwin.close(destinationDescriptor)
    destinationIsOpen = false
    guard destinationClose == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "The fresh Baseline B3 subject directory did not close exactly."
        )
    }
    return projectBinding
}

private func coherentReplacementB3SwapDormantWAL(
    project: URL,
    projectBinding: CoherentReplacementB3DirectoryBinding,
    mainName: String,
    walName: String,
    shmName: String,
    alternateName: String,
    expectedMain: CoherentReplacementB2RegularState,
    expectedWAL: CoherentReplacementB2RegularState,
    expectedAlternate: CoherentReplacementB2RegularState,
    exactProjectNames: Set<String>? = nil
) throws {
    let directoryDescriptor = Darwin.open(
        project.path,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard directoryDescriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to open the Baseline B3 project directory for controlled replacement."
        )
    }
    var directoryIsOpen = true
    defer {
        if directoryIsOpen {
            _ = Darwin.close(directoryDescriptor)
        }
    }
    var directoryStatus = stat()
    guard
        Darwin.fstat(directoryDescriptor, &directoryStatus) == 0,
        directoryStatus.st_mode & mode_t(0o170000) == mode_t(0o040000),
        directoryStatus.st_uid == Darwin.geteuid(),
        directoryStatus.st_mode & mode_t(0o777) == projectBinding.permissions,
        UInt64(directoryStatus.st_dev) == projectBinding.identity.device,
        UInt64(directoryStatus.st_ino) == projectBinding.identity.inode
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The Baseline B3 project directory did not match its admitted identity."
        )
    }

    let mainBefore = try coherentReplacementB3RelativeRegularState(
        directoryDescriptor: directoryDescriptor,
        name: mainName,
        maximumBytes: 67_108_864
    )
    let walBefore = try coherentReplacementB3RelativeRegularState(
        directoryDescriptor: directoryDescriptor,
        name: walName,
        maximumBytes: 67_108_864
    )
    try coherentReplacementB3RequireAbsentRelativePath(
        directoryDescriptor: directoryDescriptor,
        name: shmName
    )
    let alternateBefore = try coherentReplacementB3RelativeRegularState(
        directoryDescriptor: directoryDescriptor,
        name: alternateName,
        maximumBytes: 67_108_864
    )
    guard
        mainBefore.identity == expectedMain.identity,
        mainBefore.byteCount == expectedMain.byteCount,
        mainBefore.digest == expectedMain.digest,
        walBefore.identity == expectedWAL.identity,
        walBefore.byteCount == expectedWAL.byteCount,
        walBefore.digest == expectedWAL.digest,
        alternateBefore.identity == expectedAlternate.identity,
        alternateBefore.byteCount == expectedAlternate.byteCount,
        alternateBefore.digest == expectedAlternate.digest,
        alternateBefore.identity != walBefore.identity
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The Baseline B3 main, WAL, or alternate changed before mutation."
        )
    }
    if let exactProjectNames {
        try coherentReplacementB3BValidateExactProjectDescriptor(
            directoryDescriptor,
            expectedNames: exactProjectNames
        )
    }

    let swapResult = walName.withCString { walPointer in
        alternateName.withCString { alternatePointer in
            Darwin.renameatx_np(
                directoryDescriptor,
                walPointer,
                directoryDescriptor,
                alternatePointer,
                UInt32(RENAME_SWAP)
            )
        }
    }
    guard swapResult == 0, Darwin.fsync(directoryDescriptor) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "The descriptor-relative Baseline B3 WAL RENAME_SWAP was not synchronized."
        )
    }
    if let exactProjectNames {
        try coherentReplacementB3BValidateExactProjectDescriptor(
            directoryDescriptor,
            expectedNames: exactProjectNames
        )
    }
    let mainAfter = try coherentReplacementB3RelativeRegularState(
        directoryDescriptor: directoryDescriptor,
        name: mainName,
        maximumBytes: 67_108_864
    )
    let walAfter = try coherentReplacementB3RelativeRegularState(
        directoryDescriptor: directoryDescriptor,
        name: walName,
        maximumBytes: 67_108_864
    )
    let alternateAfter = try coherentReplacementB3RelativeRegularState(
        directoryDescriptor: directoryDescriptor,
        name: alternateName,
        maximumBytes: 67_108_864
    )
    try coherentReplacementB3RequireAbsentRelativePath(
        directoryDescriptor: directoryDescriptor,
        name: shmName
    )
    guard
        mainAfter.identity == expectedMain.identity,
        mainAfter.byteCount == expectedMain.byteCount,
        mainAfter.digest == expectedMain.digest,
        walAfter.identity == expectedAlternate.identity,
        walAfter.byteCount == expectedAlternate.byteCount,
        walAfter.digest == expectedAlternate.digest,
        alternateAfter.identity == expectedWAL.identity,
        alternateAfter.byteCount == expectedWAL.byteCount,
        alternateAfter.digest == expectedWAL.digest
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The Baseline B3 WAL swap did not preserve the frozen identity mapping."
        )
    }
    guard Darwin.close(directoryDescriptor) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to close the Baseline B3 project descriptor before recovery."
        )
    }
    directoryIsOpen = false
}

private func coherentReplacementB3ValidateInventory(
    root: URL,
    rootBinding: CoherentReplacementB3DirectoryBinding,
    scope: IncidentLedgerScopeV1,
    allowedAdditionalFileNames: Set<String> = []
) throws {
    let currentRoot = try coherentReplacementB3DirectoryBinding(root)
    guard currentRoot.identity == rootBinding.identity else {
        throw CoherentReplacementB2Failure.unexpected(
            "The Baseline B3 cleanup root identity changed."
        )
    }
    let projectRelative = "projects/\(scope.projectDigest)"
    let mainName = "incident-ledger-v1.sqlite3"
    let allowedDirectories: Set<String> = ["projects", projectRelative]
    let requiredFiles: Set<String> = Set([
        "\(projectRelative)/\(mainName)",
    ]).union(allowedAdditionalFileNames.map { "\(projectRelative)/\($0)" })
    let optionalFiles: Set<String> = [
        "\(projectRelative)/\(mainName)-wal",
        "\(projectRelative)/\(mainName)-shm",
    ]
    let allowedFiles = requiredFiles.union(optionalFiles)
    var observedDirectories = Set<String>()
    var observedFiles = Set<String>()
    var enumerationError: Error?
    guard let enumerator = FileManager.default.enumerator(
        at: root,
        includingPropertiesForKeys: nil,
        options: [],
        errorHandler: { _, error in
            enumerationError = error
            return false
        }
    ) else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to enumerate the bounded Baseline B3 fixture."
        )
    }
    for case let entry as URL in enumerator {
        let baseRootPaths = [
            root.path,
            root.standardizedFileURL.path,
            root.resolvingSymlinksInPath().standardizedFileURL.path,
        ]
        var admittedRootPaths = Set(baseRootPaths)
        for candidate in baseRootPaths {
            if candidate.hasPrefix("/var/") {
                admittedRootPaths.insert("/private" + candidate)
            } else if candidate.hasPrefix("/private/var/") {
                admittedRootPaths.insert(String(candidate.dropFirst("/private".count)))
            }
        }
        guard let prefixRoot = admittedRootPaths.first(where: { candidate in
            let prefix = candidate.hasSuffix("/") ? candidate : candidate + "/"
            return entry.path.hasPrefix(prefix)
        }) else {
            throw CoherentReplacementB2Failure.unexpected(
                "A Baseline B3 inventory entry escaped its admitted root."
            )
        }
        let prefix = prefixRoot.hasSuffix("/") ? prefixRoot : prefixRoot + "/"
        let relative = String(entry.path.dropFirst(prefix.count))
        var status = stat()
        guard entry.path.withCString({ Darwin.lstat($0, &status) }) == 0 else {
            throw CoherentReplacementB2Failure.filesystem(
                "Unable to inspect a Baseline B3 inventory entry."
            )
        }
        let fileType = status.st_mode & mode_t(0o170000)
        if fileType == mode_t(0o040000) {
            guard
                allowedDirectories.contains(relative),
                status.st_uid == Darwin.geteuid(),
                status.st_mode & mode_t(0o777) == mode_t(0o700)
            else {
                throw CoherentReplacementB2Failure.unexpected(
                    "The Baseline B3 fixture contained an unknown or weak directory."
                )
            }
            observedDirectories.insert(relative)
        } else if fileType == mode_t(0o100000) {
            guard
                allowedFiles.contains(relative),
                status.st_uid == Darwin.geteuid(),
                status.st_nlink == 1,
                status.st_mode & mode_t(0o777) == mode_t(0o600)
            else {
                throw CoherentReplacementB2Failure.unexpected(
                    "The Baseline B3 fixture contained an unknown or weak regular file."
                )
            }
            observedFiles.insert(relative)
        } else {
            throw CoherentReplacementB2Failure.unexpected(
                "The Baseline B3 fixture contained a symlink or special file."
            )
        }
    }
    guard
        enumerationError == nil,
        observedDirectories == allowedDirectories,
        requiredFiles.isSubset(of: observedFiles)
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The Baseline B3 fixture inventory was incomplete."
        )
    }
}

private func coherentReplacementB3RunRecoveryControl(
    label: String,
    executable: CoherentReplacementB2ExecutableAdmission,
    scope: IncidentLedgerScopeV1,
    sourceMain: URL,
    sourceWAL: URL?,
    expectedMain: CoherentReplacementB2RegularState,
    expectedWAL: CoherentReplacementB2RegularState?,
    recoveryCase: String,
    repetition: Int,
    expectedEvents: Int64,
    expectedCandidate: Bool,
    expectedBaselineIncidentID: String,
    expectedBaselineEventDigest: String
) throws -> CoherentReplacementB2RecoveryOutcome {
    let root = try coherentReplacementB2PrepareControlRoot(
        label: label,
        scope: scope,
        main: sourceMain,
        wal: sourceWAL
    )
    let rootBinding = try coherentReplacementB3DirectoryBinding(root)
    let custody = CoherentReplacementB2FixtureCustody(root: root)
    var cleanupReady = false
    defer {
        if !cleanupReady {
            custody.retain("The Baseline B3 control did not reach validated cleanup.")
        }
        custody.removeIfSafe()
    }
    let project = coherentReplacementB2Project(root: root, scope: scope)
    let projectBinding = try coherentReplacementB3DirectoryBinding(project)
    let directoryDescriptor = Darwin.open(
        project.path,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard directoryDescriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to open a Baseline B3 control project directory."
        )
    }
    var directoryIsOpen = true
    defer {
        if directoryIsOpen {
            _ = Darwin.close(directoryDescriptor)
        }
    }
    var directoryStatus = stat()
    guard
        Darwin.fstat(directoryDescriptor, &directoryStatus) == 0,
        UInt64(directoryStatus.st_dev) == projectBinding.identity.device,
        UInt64(directoryStatus.st_ino) == projectBinding.identity.inode
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A Baseline B3 control project directory changed before admission."
        )
    }
    let mainName = "incident-ledger-v1.sqlite3"
    let copiedMain = try coherentReplacementB3RelativeRegularState(
        directoryDescriptor: directoryDescriptor,
        name: mainName,
        maximumBytes: 67_108_864
    )
    guard
        copiedMain.byteCount == expectedMain.byteCount,
        copiedMain.digest == expectedMain.digest,
        copiedMain.identity != expectedMain.identity
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A Baseline B3 control main was not an exact distinct copy."
        )
    }
    if let expectedWAL {
        let copiedWAL = try coherentReplacementB3RelativeRegularState(
            directoryDescriptor: directoryDescriptor,
            name: mainName + "-wal",
            maximumBytes: 67_108_864
        )
        guard
            copiedWAL.byteCount == expectedWAL.byteCount,
            copiedWAL.digest == expectedWAL.digest,
            copiedWAL.identity != expectedWAL.identity
        else {
            throw CoherentReplacementB2Failure.unexpected(
                "A Baseline B3 control WAL was not an exact distinct copy."
            )
        }
    } else {
        try coherentReplacementB3RequireAbsentRelativePath(
            directoryDescriptor: directoryDescriptor,
            name: mainName + "-wal"
        )
    }
    try coherentReplacementB3RequireAbsentRelativePath(
        directoryDescriptor: directoryDescriptor,
        name: mainName + "-shm"
    )
    guard Darwin.close(directoryDescriptor) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to close a Baseline B3 control directory before recovery."
        )
    }
    directoryIsOpen = false

    let outcome = try coherentReplacementB2RunRecovery(
        executable: executable,
        root: root,
        custody: custody,
        scope: scope,
        request: coherentReplacementB2Request(label, repetition: repetition),
        recoveryCase: recoveryCase,
        repetition: repetition,
        expectedEvents: expectedEvents,
        expectedCandidate: expectedCandidate,
        expectedBaselineIncidentID: expectedBaselineIncidentID,
        expectedBaselineEventDigest: expectedBaselineEventDigest
    )
    try coherentReplacementB3ValidateInventory(
        root: root,
        rootBinding: rootBinding,
        scope: scope
    )
    cleanupReady = true
    return outcome
}

private func coherentReplacementB3BPrepareRoot(
    label: String,
    scope: IncidentLedgerScopeV1,
    mainBytes: Data,
    walBytes: Data? = nil,
    alternateName: String? = nil,
    alternateBytes: Data? = nil
) throws -> CoherentReplacementB3BPreparedRoot {
    guard (alternateName == nil) == (alternateBytes == nil) else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "A B3B alternate name and bytes must be supplied together."
        )
    }
    let root = try coherentReplacementB3BRoot(label)
    let rootBinding = try coherentReplacementB3DirectoryBinding(root)
    let projects = root.appendingPathComponent("projects", isDirectory: true)
    let project = projects.appendingPathComponent(scope.projectDigest, isDirectory: true)
    try FileManager.default.createDirectory(
        at: projects,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: NSNumber(value: 0o700)]
    )
    try FileManager.default.createDirectory(
        at: project,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: NSNumber(value: 0o700)]
    )
    let projectBinding = try coherentReplacementB3DirectoryBinding(project)
    let descriptor = Darwin.open(
        project.path,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard descriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to open a fresh B3B project descriptor."
        )
    }
    var descriptorIsOpen = true
    defer {
        if descriptorIsOpen { _ = Darwin.close(descriptor) }
    }
    var status = stat()
    guard
        Darwin.fstat(descriptor, &status) == 0,
        UInt64(status.st_dev) == projectBinding.identity.device,
        UInt64(status.st_ino) == projectBinding.identity.inode
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A fresh B3B project changed before population."
        )
    }
    let mainName = "incident-ledger-v1.sqlite3"
    let main = try coherentReplacementB3WriteRelativePrivateFile(
        directoryDescriptor: descriptor,
        name: mainName,
        bytes: mainBytes
    )
    let wal: CoherentReplacementB2RegularState?
    if let walBytes {
        wal = try coherentReplacementB3WriteRelativePrivateFile(
            directoryDescriptor: descriptor,
            name: mainName + "-wal",
            bytes: walBytes
        )
    } else {
        wal = nil
        try coherentReplacementB3RequireAbsentRelativePath(
            directoryDescriptor: descriptor,
            name: mainName + "-wal"
        )
    }
    if let alternateName, let alternateBytes {
        _ = try coherentReplacementB3WriteRelativePrivateFile(
            directoryDescriptor: descriptor,
            name: alternateName,
            bytes: alternateBytes
        )
    }
    try coherentReplacementB3RequireAbsentRelativePath(
        directoryDescriptor: descriptor,
        name: mainName + "-shm"
    )
    guard Darwin.fsync(descriptor) == 0, Darwin.close(descriptor) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "A fresh B3B project did not synchronize and close exactly."
        )
    }
    descriptorIsOpen = false
    return CoherentReplacementB3BPreparedRoot(
        root: root,
        rootBinding: rootBinding,
        project: project,
        projectBinding: projectBinding,
        main: main,
        wal: wal
    )
}

private func coherentReplacementB3BEntryExists(
    directoryDescriptor: Int32,
    name: String
) throws -> Bool {
    var status = stat()
    errno = 0
    let result = name.withCString {
        Darwin.fstatat(directoryDescriptor, $0, &status, AT_SYMLINK_NOFOLLOW)
    }
    if result == 0 { return true }
    guard errno == ENOENT else {
        throw CoherentReplacementB2Failure.filesystem(
            "A B3B retained-inventory path could not be inspected."
        )
    }
    return false
}

private func coherentReplacementB3BDirectoryEntries(
    _ descriptor: Int32
) throws -> Set<String> {
    let enumerationDescriptor = ".".withCString {
        Darwin.openat(
            descriptor,
            $0,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
    }
    guard enumerationDescriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to reopen a B3B directory descriptor for independent enumeration."
        )
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
        throw CoherentReplacementB2Failure.unexpected(
            "A B3B enumeration descriptor did not bind the admitted directory."
        )
    }
    guard let directory = Darwin.fdopendir(enumerationDescriptor) else {
        _ = Darwin.close(enumerationDescriptor)
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to bind B3B enumeration to a directory descriptor."
        )
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
            pointer.withMemoryRebound(
                to: CChar.self,
                capacity: nameCapacity
            ) { String(cString: $0) }
        }
        if name == "." || name == ".." { continue }
        guard !name.isEmpty, names.insert(name).inserted else {
            throw CoherentReplacementB2Failure.unexpected(
                "A B3B descriptor enumeration contained an empty or duplicate name."
            )
        }
    }
    let enumerationErrno = errno
    let closeResult = Darwin.closedir(directory)
    directoryIsOpen = false
    guard enumerationErrno == 0, closeResult == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "A B3B descriptor enumeration did not finish and close exactly."
        )
    }
    return names
}

private func coherentReplacementB3BValidateExactProjectDescriptor(
    _ descriptor: Int32,
    expectedNames: Set<String>
) throws {
    guard try coherentReplacementB3BDirectoryEntries(descriptor) == expectedNames else {
        throw CoherentReplacementB2Failure.unexpected(
            "A B3B project descriptor contained an unknown or missing entry."
        )
    }
    for name in expectedNames {
        _ = try coherentReplacementB3RelativeRegularSnapshot(
            directoryDescriptor: descriptor,
            name: name,
            maximumBytes: name.hasSuffix("-shm")
                ? coherentReplacementB2MaximumSHMBytes
                : 67_108_864
        )
    }
}

private func coherentReplacementB3BValidateRetainedInventory(
    prepared: CoherentReplacementB3BPreparedRoot,
    scope: IncidentLedgerScopeV1,
    requiredNames: Set<String>,
    optionalNames: Set<String>
) throws {
    let mainName = "incident-ledger-v1.sqlite3"
    let allAdmitted = requiredNames.union(optionalNames)
    guard requiredNames.contains(mainName), requiredNames.isDisjoint(with: optionalNames) else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "A B3B retained-inventory profile was internally inconsistent."
        )
    }
    let rootDescriptor = Darwin.open(
        prepared.root.path,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard rootDescriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to open a B3B retained-inventory root."
        )
    }
    var rootIsOpen = true
    defer {
        if rootIsOpen { _ = Darwin.close(rootDescriptor) }
    }
    var rootStatus = stat()
    guard
        Darwin.fstat(rootDescriptor, &rootStatus) == 0,
        UInt64(rootStatus.st_dev) == prepared.rootBinding.identity.device,
        UInt64(rootStatus.st_ino) == prepared.rootBinding.identity.inode,
        rootStatus.st_uid == Darwin.geteuid(),
        rootStatus.st_mode & mode_t(0o777) == mode_t(0o700),
        try coherentReplacementB3BDirectoryEntries(rootDescriptor) == ["projects"]
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A B3B retained root changed identity or exact structure."
        )
    }
    let projectsDescriptor = "projects".withCString {
        Darwin.openat(
            rootDescriptor,
            $0,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
    }
    guard projectsDescriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to open the B3B projects directory descriptor-relatively."
        )
    }
    var projectsIsOpen = true
    defer {
        if projectsIsOpen { _ = Darwin.close(projectsDescriptor) }
    }
    var projectsStatus = stat()
    guard
        Darwin.fstat(projectsDescriptor, &projectsStatus) == 0,
        projectsStatus.st_mode & mode_t(0o170000) == mode_t(0o040000),
        projectsStatus.st_uid == Darwin.geteuid(),
        projectsStatus.st_mode & mode_t(0o777) == mode_t(0o700),
        try coherentReplacementB3BDirectoryEntries(projectsDescriptor) == [scope.projectDigest]
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The B3B projects descriptor did not contain exactly its frozen scope."
        )
    }
    let projectDescriptor = scope.projectDigest.withCString {
        Darwin.openat(
            projectsDescriptor,
            $0,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
    }
    guard projectDescriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to open the B3B project descriptor-relatively."
        )
    }
    var projectIsOpen = true
    defer {
        if projectIsOpen { _ = Darwin.close(projectDescriptor) }
    }
    var projectStatus = stat()
    guard
        Darwin.fstat(projectDescriptor, &projectStatus) == 0,
        UInt64(projectStatus.st_dev) == prepared.projectBinding.identity.device,
        UInt64(projectStatus.st_ino) == prepared.projectBinding.identity.inode,
        projectStatus.st_uid == Darwin.geteuid(),
        projectStatus.st_mode & mode_t(0o777) == mode_t(0o700)
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The B3B retained project changed identity."
        )
    }
    let observedNames = try coherentReplacementB3BDirectoryEntries(projectDescriptor)
    guard
        requiredNames.isSubset(of: observedNames),
        observedNames.isSubset(of: allAdmitted)
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "The B3B retained project contained an unknown or missing file."
        )
    }
    for name in observedNames {
        _ = try coherentReplacementB3RelativeRegularSnapshot(
            directoryDescriptor: projectDescriptor,
            name: name,
            maximumBytes: name.hasSuffix("-shm")
                ? coherentReplacementB2MaximumSHMBytes
                : 67_108_864,
            requireNonempty: requiredNames.contains(name)
        )
    }
    let projectCloseResult = Darwin.close(projectDescriptor)
    projectIsOpen = false
    guard projectCloseResult == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "A B3B retained project descriptor did not close exactly."
        )
    }
    let projectsCloseResult = Darwin.close(projectsDescriptor)
    projectsIsOpen = false
    guard projectsCloseResult == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "A B3B retained projects descriptor did not close exactly."
        )
    }
    let rootCloseResult = Darwin.close(rootDescriptor)
    rootIsOpen = false
    guard rootCloseResult == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "A B3B retained root descriptor did not close exactly."
        )
    }
}

private func coherentReplacementB3BRunGenerator(
    executable: CoherentReplacementB2ExecutableAdmission,
    prepared: CoherentReplacementB3BPreparedRoot,
    custody: CoherentReplacementB2FixtureCustody,
    scope: IncidentLedgerScopeV1,
    repetition: Int,
    branch: CoherentReplacementB3BBranch
) throws {
    let acceptanceDeadline = coherentReplacementB2Deadline()
    let containmentDeadline = acceptanceDeadline + coherentReplacementB3BContainmentNanoseconds
    let request = coherentReplacementB2Request(
        "cr04-divergent-generator-\(branch.rawValue.lowercased())",
        repetition: repetition
    )
    let session = try CoherentReplacementB2ProcessSession(
        executable: executable,
        arguments: [
            "b3-cr04-divergent-abrupt",
            prepared.root.path,
            scope.projectDigest,
            request,
            "\(repetition)",
            branch.rawValue,
            IncidentLedgerAbruptProcessPointV1.afterObservationCommitBeforeReturn.rawValue,
        ],
        acceptsInput: false,
        custody: custody,
        failureContainmentDeadline: containmentDeadline
    )
    defer {
        cleanupCoherentReplacementB3BSession(
            session,
            containmentDeadline: containmentDeadline
        )
    }
    let expected =
        "VERITAS_B3_CHILD|v1|request=\(request)|case=CR-04" +
        "|variant=WAL_DIVERGENT_GENERATOR|repetition=\(repetition)" +
        "|branch=\(branch.rawValue)|phase=AFTER_OBSERVATION_COMMIT" +
        "|pid=\(session.process.processIdentifier)\n"
    guard try coherentReplacementB2ReadLine(
        descriptor: session.outputReader.fileDescriptor,
        deadline: acceptanceDeadline
    ) == expected else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "A B3B generator emitted the wrong exact frame."
        )
    }
    try coherentReplacementB3KillAndReap(session, deadline: acceptanceDeadline)
    try coherentReplacementB2RequireNoResidualOutput(session)
    try session.closeParentHandles()
}

private func coherentReplacementB3BRunRecovery(
    executable: CoherentReplacementB2ExecutableAdmission,
    prepared: CoherentReplacementB3BPreparedRoot,
    custody: CoherentReplacementB2FixtureCustody,
    scope: IncidentLedgerScopeV1,
    repetition: Int,
    state: CoherentReplacementB3BRecoveryState,
    purpose: CoherentReplacementB3BRecoveryPurpose,
    expectedBaselineIncidentID: String,
    expectedBaselineEventDigest: String,
    expectedHead: String
) throws -> String {
    let acceptanceDeadline = coherentReplacementB2Deadline()
    let containmentDeadline = acceptanceDeadline + coherentReplacementB3BContainmentNanoseconds
    let purposeRequestLabel = purpose.rawValue.lowercased()
        .replacingOccurrences(of: "_", with: "-")
    let request = coherentReplacementB2Request(
        "cr04-divergent-recovery-\(state.rawValue.lowercased())-\(purposeRequestLabel)",
        repetition: repetition
    )
    let session = try CoherentReplacementB2ProcessSession(
        executable: executable,
        arguments: [
            "b3-cr04-divergent-recover",
            prepared.root.path,
            scope.projectDigest,
            request,
            "\(repetition)",
            state.rawValue,
            purpose.rawValue,
            expectedBaselineIncidentID,
            expectedBaselineEventDigest,
            expectedHead,
        ],
        acceptsInput: false,
        custody: custody,
        failureContainmentDeadline: containmentDeadline
    )
    defer {
        cleanupCoherentReplacementB3BSession(
            session,
            containmentDeadline: containmentDeadline
        )
    }
    try coherentReplacementB2WaitForExit(session, deadline: acceptanceDeadline)
    guard session.process.terminationReason == .exit, session.process.terminationStatus == 0 else {
        let diagnosticOutput = String(
            decoding: session.outputReader.readDataToEndOfFile(),
            as: UTF8.self
        )
        let diagnosticError = String(
            decoding: session.errorReader.readDataToEndOfFile(),
            as: UTF8.self
        )
        throw CoherentReplacementB2Failure.process(
            "A B3B recovery child did not exit normally: reason=" +
                "\(session.process.terminationReason.rawValue) status=" +
                "\(session.process.terminationStatus) stdout=\(diagnosticOutput)" +
                " stderr=\(diagnosticError)"
        )
    }
    let outputData = session.outputReader.readDataToEndOfFile()
    let errorData = session.errorReader.readDataToEndOfFile()
    guard errorData.isEmpty else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "A B3B recovery child emitted stderr bytes."
        )
    }
    let output = String(decoding: outputData, as: UTF8.self)
    guard output.hasSuffix("\n"), output.filter({ $0 == "\n" }).count == 1 else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "A B3B recovery child emitted malformed or extra output."
        )
    }
    let fields = String(output.dropLast()).split(
        separator: "|",
        omittingEmptySubsequences: false
    )
    let expectedEvents = state == .m0 ? 1 : 2
    let expectedA = state == .a
    let expectedB = state == .b
    guard
        fields.count == 16,
        fields[0] == "VERITAS_B3_RECOVERY",
        fields[1] == "v1",
        fields[2] == "request=\(request)",
        fields[3] == "case=CR-04",
        fields[4] == "variant=WAL_DIVERGENT_RECOVERY",
        fields[5] == "repetition=\(repetition)",
        fields[6] == "state=\(state.rawValue)",
        fields[7] == "purpose=\(purpose.rawValue)",
        fields[8] == "outcome=RECOVERED_EXACT",
        fields[9] == "events=\(expectedEvents)",
        fields[10] == "branch_a_present=\(expectedA)",
        fields[11] == "branch_b_present=\(expectedB)",
        fields[12] == "baseline_exact=true",
        fields[13].hasPrefix("head_digest="),
        coherentReplacementB2IsDigest(String(fields[13].dropFirst("head_digest=".count))),
        fields[14] == "authorizing=false",
        fields[15] == "pid=\(session.process.processIdentifier)"
    else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "A B3B recovery child emitted an unknown result frame."
        )
    }
    let head = String(fields[13].dropFirst("head_digest=".count))
    if purpose != .controlDiscover, head != expectedHead {
        throw CoherentReplacementB2Failure.unexpected(
            "A B3B exact recovery head drifted from its frozen oracle."
        )
    }
    try session.closeParentHandles()
    return head
}

private func coherentReplacementB3BRunControl(
    label: String,
    executable: CoherentReplacementB2ExecutableAdmission,
    scope: IncidentLedgerScopeV1,
    mainBytes: Data,
    walBytes: Data?,
    repetition: Int,
    state: CoherentReplacementB3BRecoveryState,
    purpose: CoherentReplacementB3BRecoveryPurpose,
    expectedBaselineIncidentID: String,
    expectedBaselineEventDigest: String,
    expectedHead: String
) throws -> (head: String, prepared: CoherentReplacementB3BPreparedRoot) {
    let prepared = try coherentReplacementB3BPrepareRoot(
        label: label,
        scope: scope,
        mainBytes: mainBytes,
        walBytes: walBytes
    )
    let custody = CoherentReplacementB2FixtureCustody(root: prepared.root)
    var inventoryValidated = false
    defer {
        if !inventoryValidated {
            custody.retain("A B3B control root did not reach exact retained inventory.")
        }
        custody.removeIfSafe()
    }
    let head = try coherentReplacementB3BRunRecovery(
        executable: executable,
        prepared: prepared,
        custody: custody,
        scope: scope,
        repetition: repetition,
        state: state,
        purpose: purpose,
        expectedBaselineIncidentID: expectedBaselineIncidentID,
        expectedBaselineEventDigest: expectedBaselineEventDigest,
        expectedHead: expectedHead
    )
    try coherentReplacementB3BValidateRetainedInventory(
        prepared: prepared,
        scope: scope,
        requiredNames: ["incident-ledger-v1.sqlite3"],
        optionalNames: ["incident-ledger-v1.sqlite3-wal", "incident-ledger-v1.sqlite3-shm"]
    )
    inventoryValidated = true
    return (head, prepared)
}

private func coherentReplacementB3BBuildBranch(
    executable: CoherentReplacementB2ExecutableAdmission,
    scope: IncidentLedgerScopeV1,
    m0: CoherentReplacementB3RegularSnapshot,
    repetition: Int,
    branch: CoherentReplacementB3BBranch
) throws -> (prepared: CoherentReplacementB3BPreparedRoot, wal: CoherentReplacementB3RegularSnapshot) {
    let prepared = try coherentReplacementB3BPrepareRoot(
        label: "cr04-divergent-builder-\(branch.rawValue.lowercased())-\(repetition)",
        scope: scope,
        mainBytes: m0.bytes
    )
    let custody = CoherentReplacementB2FixtureCustody(root: prepared.root)
    var inventoryValidated = false
    defer {
        if !inventoryValidated {
            custody.retain("A B3B branch builder did not reach exact retained inventory.")
        }
        custody.removeIfSafe()
    }
    try coherentReplacementB3BRunGenerator(
        executable: executable,
        prepared: prepared,
        custody: custody,
        scope: scope,
        repetition: repetition,
        branch: branch
    )
    let descriptor = Darwin.open(
        prepared.project.path,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard descriptor >= 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "Unable to open a B3B branch builder after reap."
        )
    }
    var descriptorIsOpen = true
    defer {
        if descriptorIsOpen { _ = Darwin.close(descriptor) }
    }
    var status = stat()
    guard
        Darwin.fstat(descriptor, &status) == 0,
        UInt64(status.st_dev) == prepared.projectBinding.identity.device,
        UInt64(status.st_ino) == prepared.projectBinding.identity.inode
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A B3B branch builder changed identity after child reap."
        )
    }
    let main = try coherentReplacementB3RelativeRegularSnapshot(
        directoryDescriptor: descriptor,
        name: "incident-ledger-v1.sqlite3",
        maximumBytes: 67_108_864
    )
    let wal = try coherentReplacementB3RelativeRegularSnapshot(
        directoryDescriptor: descriptor,
        name: "incident-ledger-v1.sqlite3-wal",
        maximumBytes: 67_108_864
    )
    guard
        main.bytes == m0.bytes,
        main.state.byteCount == m0.state.byteCount,
        main.state.digest == m0.state.digest,
        try coherentReplacementB3WALState(wal).physicalFrameCapacity > 0
    else {
        throw CoherentReplacementB2Failure.unexpected(
            "A B3B builder did not preserve exact M0 plus a structurally shaped WAL."
        )
    }
    if try coherentReplacementB3BEntryExists(
        directoryDescriptor: descriptor,
        name: "incident-ledger-v1.sqlite3-shm"
    ) {
        _ = try coherentReplacementB3RelativeRegularSnapshot(
            directoryDescriptor: descriptor,
            name: "incident-ledger-v1.sqlite3-shm",
            maximumBytes: coherentReplacementB2MaximumSHMBytes,
            requireNonempty: false
        )
    }
    guard Darwin.close(descriptor) == 0 else {
        throw CoherentReplacementB2Failure.filesystem(
            "A B3B builder descriptor did not close exactly."
        )
    }
    descriptorIsOpen = false
    try coherentReplacementB3BValidateRetainedInventory(
        prepared: prepared,
        scope: scope,
        requiredNames: ["incident-ledger-v1.sqlite3", "incident-ledger-v1.sqlite3-wal"],
        optionalNames: ["incident-ledger-v1.sqlite3-shm"]
    )
    inventoryValidated = true
    return (prepared, wal)
}

private struct CR03WriterReport {
    let record: String
    let close: String
    let candidateDigest: String?

    // Decodes API observations only AFTER actual Process wait/reap, never a
    // recovery verdict. Caller state is private harness state, not attestation.
    static func read(_ line: String, request: String, repetition: Int, pid: Int32,
                     reaped: Bool, normalExit: Bool) throws -> Self {
        guard reaped, normalExit, line.utf8.count <= 1024, line.hasSuffix("\n"),
              line.filter({ $0 == "\n" }).count == 1 else {
            throw CoherentReplacementB2Failure.protocolViolation("CR03 writer did not finish exactly.")
        }
        let fields = String(line.dropLast()).split(separator: "|", omittingEmptySubsequences: false)
        guard fields.count == 9, fields[0] == "CR03_WRITER", fields[1] == "v1",
              fields[2] == "request=\(request)", fields[3] == "repetition=\(repetition)",
              fields[7] == "authorizing=false", fields[8] == "pid=\(pid)",
              fields[6].hasPrefix("candidate_digest=") else {
            throw CoherentReplacementB2Failure.protocolViolation("CR03 writer frame identity refused.")
        }
        let candidate = String(fields[6].dropFirst("candidate_digest=".count))
        if fields[4] == "record=ROLLBACK_POISON", fields[5] == "close=RETURNED", candidate == "nil" {
            return Self(record: "ROLLBACK_POISON", close: "RETURNED", candidateDigest: nil)
        }
        guard fields[4] == "record=APPENDED", ["close=RETURNED", "close=SQLITE_IOERR"].contains(String(fields[5])),
              coherentReplacementB2IsDigest(candidate) else {
            throw CoherentReplacementB2Failure.protocolViolation("CR03 writer outcome tuple refused.")
        }
        return Self(record: "APPENDED", close: String(fields[5].dropFirst("close=".count)), candidateDigest: candidate)
    }
}

private func cr03RunWriter(executable: CoherentReplacementB2ExecutableAdmission, root: URL,
                          custody: CoherentReplacementB2FixtureCustody, scope: IncidentLedgerScopeV1,
                          repetition: Int, mode: String, main: URL, alternate: URL?,
                          original: CoherentReplacementB2RegularState,
                          copied: CoherentReplacementB2RegularState?) throws -> (CR03WriterReport, Int32) {
    let request = coherentReplacementB2Request("cr03-\(mode)", repetition: repetition)
    let session = try CoherentReplacementB2ProcessSession(executable: executable,
        arguments: ["b2-cr03-main", root.path, scope.projectDigest, request, "\(repetition)", mode],
        acceptsInput: mode == "aba", custody: custody)
    var swapped = false
    defer {
        cleanupCoherentReplacementB2Session(session)
        if swapped {
            // Retain uncertain namespace rather than performing another unchecked
            // restore after a failed swap. No recovery may follow this thrown path.
            custody.retain("CR03 namespace remains uncertain after failed ABA restoration.")
        }
    }
    let deadline = session.launchUptimeNanoseconds + coherentReplacementB2DeadlineNanoseconds
    let pid = session.process.processIdentifier
    if mode == "aba" {
        let alternate = try #require(alternate), copied = try #require(copied)
        let ready = try coherentReplacementB2ReadLine(descriptor: session.outputReader.fileDescriptor, deadline: deadline)
        guard ready == "CR03_READY|v1|request=\(request)|repetition=\(repetition)|pid=\(pid)\n" else {
            throw CoherentReplacementB2Failure.protocolViolation("CR03 pre-commit barrier refused.")
        }
        func identity(_ url: URL) throws -> CoherentReplacementB2Identity {
            try coherentReplacementB2RegularState(url, maximumBytes: 67_108_864).identity
        }
        guard try identity(main) == original.identity, try identity(alternate) == copied.identity,
              original.identity != copied.identity else {
            throw CoherentReplacementB2Failure.unexpected("CR03 pre-swap identities changed.")
        }
        try coherentReplacementB2AtomicSwap(main, alternate); swapped = true
        guard try identity(main) == copied.identity, try identity(alternate) == original.identity else {
            throw CoherentReplacementB2Failure.unexpected("CR03 alternate identity was not installed.")
        }
        try coherentReplacementB2AtomicSwap(main, alternate)
        guard try identity(main) == original.identity, try identity(alternate) == copied.identity else {
            throw CoherentReplacementB2Failure.unexpected("CR03 original identity was not restored.")
        }
        swapped = false
        let input = try #require(session.inputWriter)
        try coherentReplacementB2WriteLine("CR03_CONTINUE|v1|request=\(request)|repetition=\(repetition)|pid=\(pid)\n",
            descriptor: input.fileDescriptor, deadline: deadline)
        try session.closeInputAfterFrame()
    }
    let terminal = try coherentReplacementB2ReadLine(descriptor: session.outputReader.fileDescriptor, deadline: deadline)
    try coherentReplacementB2WaitForExit(session, deadline: deadline)
    try coherentReplacementB2RequireNoResidualOutput(session)
    let report = try CR03WriterReport.read(terminal, request: request, repetition: repetition, pid: pid,
        reaped: session.reaped, normalExit: session.process.terminationReason == .exit && session.process.terminationStatus == 0)
    try session.closeParentHandles()
    return (report, pid)
}

// Retain the actual pre-recovery bytes, not merely hashes of files that SQLite
// may checkpoint on the next open. Same-host cooperative fixture evidence only;
// descriptor binding does not claim protection from a malicious same-UID writer.
private func cr03RetainBeforeRecovery(root: URL, scope: IncidentLedgerScopeV1,
    rootBinding: CoherentReplacementB3DirectoryBinding,
    projectsBinding: CoherentReplacementB3DirectoryBinding,
    projectBinding: CoherentReplacementB3DirectoryBinding,
    original: CoherentReplacementB2RegularState,
    copied: CoherentReplacementB2RegularState?) throws -> [String] {
    var descriptors = [Int32]()
    defer { for descriptor in descriptors.reversed() { _ = Darwin.close(descriptor) } }
    let rootFD = Darwin.open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    guard rootFD >= 0 else { throw CoherentReplacementB2Failure.filesystem("CR03 snapshot root open failed.") }
    descriptors.append(rootFD)
    try cr09TestRevalidateDirectoryDescriptor(rootFD, expected: rootBinding)
    let projectsFD = try cr09TestOpenDirectory(parent: rootFD, name: "projects")
    descriptors.append(projectsFD)
    try cr09TestRevalidateDirectoryDescriptor(projectsFD, expected: projectsBinding)
    let projectFD = try cr09TestOpenDirectory(parent: projectsFD, name: scope.projectDigest)
    descriptors.append(projectFD)
    try cr09TestRevalidateDirectoryDescriptor(projectFD, expected: projectBinding)
    let allowedRoot: Set<String> = copied == nil ? ["projects"] : ["projects", "retained-alternate.sqlite3"]
    let names = try coherentReplacementB3BDirectoryEntries(projectFD)
    guard try coherentReplacementB3BDirectoryEntries(rootFD) == allowedRoot,
          try coherentReplacementB3BDirectoryEntries(projectsFD) == [scope.projectDigest],
          names.contains("incident-ledger-v1.sqlite3"),
          names.isSubset(of: ["incident-ledger-v1.sqlite3", "incident-ledger-v1.sqlite3-wal", "incident-ledger-v1.sqlite3-shm"]) else {
        throw CoherentReplacementB2Failure.unexpected("CR03 snapshot inventory refused.")
    }
    var captured = [(String, CoherentReplacementB3RegularSnapshot)]()
    for name in names.sorted() {
        let snapshot = try coherentReplacementB3RelativeRegularSnapshot(directoryDescriptor: projectFD,
            name: name, maximumBytes: name.hasSuffix("-shm") ? 1_048_576 : 67_108_864, requireNonempty: false)
        if name == "incident-ledger-v1.sqlite3", snapshot.state.identity != original.identity {
            throw CoherentReplacementB2Failure.unexpected("CR03 main identity changed before byte capture.")
        }
        captured.append((name, snapshot))
    }
    if let copied {
        let alternate = try coherentReplacementB3RelativeRegularSnapshot(directoryDescriptor: rootFD,
            name: "retained-alternate.sqlite3", maximumBytes: 67_108_864)
        guard alternate.state.identity == copied.identity, alternate.state.digest == copied.digest else {
            throw CoherentReplacementB2Failure.unexpected("CR03 alternate identity or bytes changed.")
        }
        captured.append(("retained-alternate.sqlite3", alternate))
    }
    var inventory = [String]()
    for (name, snapshot) in captured {
        let copyName = "cr03-before-\(name)"
        if snapshot.bytes.isEmpty {
            // The shared writer intentionally requires nonempty data. An empty
            // observed sidecar is still evidence and needs its own exclusive file.
            let fd = Darwin.openat(rootFD, copyName, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
            guard fd >= 0 else { throw CoherentReplacementB2Failure.filesystem("CR03 empty snapshot creation failed.") }
            let syncResult = Darwin.fsync(fd)
            let closeResult = Darwin.close(fd)
            guard syncResult == 0, closeResult == 0 else {
                throw CoherentReplacementB2Failure.filesystem("CR03 empty snapshot close or sync failed.")
            }
        } else {
            _ = try coherentReplacementB3WriteRelativePrivateFile(directoryDescriptor: rootFD, name: copyName, bytes: snapshot.bytes)
        }
        let readback = try coherentReplacementB3RelativeRegularSnapshot(directoryDescriptor: rootFD,
            name: copyName, maximumBytes: 67_108_864, requireNonempty: false)
        guard readback.bytes == snapshot.bytes, readback.state.identity != snapshot.state.identity else {
            throw CoherentReplacementB2Failure.unexpected("CR03 retained copy was not independent and byte-exact.")
        }
        inventory.append("\(copyName):\(readback.state.byteCount):\(readback.state.digest)")
    }
    guard try coherentReplacementB3BDirectoryEntries(projectFD) == names,
          try coherentReplacementB3BDirectoryEntries(rootFD) == allowedRoot.union(captured.map { "cr03-before-\($0.0)" }),
          Darwin.fsync(rootFD) == 0 else {
        throw CoherentReplacementB2Failure.unexpected("CR03 snapshot inventory did not finish exactly.")
    }
    while let descriptor = descriptors.popLast() {
        guard Darwin.close(descriptor) == 0 else {
            throw CoherentReplacementB2Failure.filesystem("CR03 snapshot directory close failed.")
        }
    }
    return inventory
}

@Suite("Founder Alpha coherent replacement Baseline B2 isolated process", .serialized)
struct LocalIncidentLedgerCoherentReplacementBaselineB2Tests {
    @Test("CR03 writer report cannot infer recovery or precede normal exit and reap")
    func cr03WriterReportBoundaries() throws {
        let digest = String(repeating: "a", count: 64)
        let base = "CR03_WRITER|v1|request=test|repetition=0|record=APPENDED|close=SQLITE_IOERR|candidate_digest=\(digest)|authorizing=false|pid=42\n"
        func parse(_ text: String, reaped: Bool = true, normalExit: Bool = true) throws -> CR03WriterReport {
            try CR03WriterReport.read(text, request: "test", repetition: 0, pid: 42, reaped: reaped, normalExit: normalExit)
        }
        let actual = try parse(base)
        #expect(actual.record == "APPENDED" && actual.close == "SQLITE_IOERR" && actual.candidateDigest == digest)
        _ = try parse(base.replacingOccurrences(of: "close=SQLITE_IOERR", with: "close=RETURNED"))
        let poison = base.replacingOccurrences(of: "record=APPENDED", with: "record=ROLLBACK_POISON")
            .replacingOccurrences(of: "close=SQLITE_IOERR", with: "close=RETURNED")
            .replacingOccurrences(of: digest, with: "nil")
        #expect(try parse(poison).candidateDigest == nil)
        #expect(throws: (any Error).self) { try parse(base, reaped: false) }
        #expect(throws: (any Error).self) { try parse(base, normalExit: false) }
        for text in ["", String(base.dropLast()), base + base, base + "x", base.replacingOccurrences(of: "|v1|", with: "|v2|"),
                     base.replacingOccurrences(of: "request=test", with: "request=stale"), base.replacingOccurrences(of: "repetition=0", with: "repetition=1"),
                     base.replacingOccurrences(of: "pid=42", with: "pid=43"), base.replacingOccurrences(of: "authorizing=false", with: "authorizing=true"),
                     base.replacingOccurrences(of: "|pid=42", with: "|extra=1|pid=42"), base.replacingOccurrences(of: "APPENDED", with: "UNKNOWN"),
                     base.replacingOccurrences(of: "pid=42\n", with: "pid=42|extra=1\n"),
                     base.replacingOccurrences(of: digest, with: ""), base.replacingOccurrences(of: digest, with: " " + digest),
                     base.replacingOccurrences(of: digest, with: digest + " "), poison.replacingOccurrences(of: "candidate_digest=nil", with: "candidate_digest=\(digest)"),
                     base.replacingOccurrences(of: "SQLITE_IOERR", with: "UNKNOWN"), base.replacingOccurrences(of: digest, with: "nil"),
                     base.replacingOccurrences(of: digest, with: digest.uppercased()), poison.replacingOccurrences(of: "close=RETURNED", with: "close=SQLITE_IOERR"),
                     String(repeating: "x", count: 1025) + "\n"] {
            #expect(throws: (any Error).self) { try parse(text) }
        }
    }

    @Test("CR03 separate writer exit and reap precede exact control-matched recovery", arguments: [0, 1])
    func cr03ProcessRecovery(repetition: Int) async throws {
        let executable = try coherentReplacementB2ProbeExecutable()
        let scope = coherentReplacementB2Scope(caseID: "cr03-process", repetition: repetition)
        let observation = coherentReplacementB2BaselineObservation(caseID: "cr03-process", repetition: repetition)
        var expectedHead: String?
        for mode in ["control", "aba"] {
            // Cooperative single-run quota, not a global concurrent admission owner.
            let roots = try FileManager.default.contentsOfDirectory(atPath: "/private/tmp")
                .filter { $0.hasPrefix("veritas-coherent-replacement-b3b-cr03-process-") }
            guard roots.count < 32 else { throw CoherentReplacementB2Failure.unexpected("CR03 retained-root quota reached; no automatic deletion.") }
            let root = try coherentReplacementB3BRoot("cr03-process-\(mode)-\(repetition)")
            let custody = CoherentReplacementB2FixtureCustody(root: root)
            defer { custody.removeIfSafe() }
            let seed = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
            let baseline: IncidentSummaryV1
            do {
                guard case let .appended(value) = try await seed.record(observation) else {
                    throw CoherentReplacementB2Failure.unexpected("CR03 seed was not appended.")
                }
                baseline = value
                try await seed.close()
            } catch {
                custody.retain("CR03 seed setup or close failed.")
                try? await seed.abortForCoherentReplacementBaselineTesting()
                throw error
            }
            let project = coherentReplacementB2Project(root: root, scope: scope)
            let rootBinding = try coherentReplacementB3DirectoryBinding(root)
            let projectsBinding = try coherentReplacementB3DirectoryBinding(root.appendingPathComponent("projects"))
            let projectBinding = try coherentReplacementB3DirectoryBinding(project)
            let main = project.appendingPathComponent("incident-ledger-v1.sqlite3")
            let original = try coherentReplacementB2RegularState(main, maximumBytes: 67_108_864)
            let alternate = mode == "aba" ? root.appendingPathComponent("retained-alternate.sqlite3") : nil
            var copied: CoherentReplacementB2RegularState?
            if let alternate {
                try coherentReplacementB2CopyPrivateFile(from: main, to: alternate)
                copied = try coherentReplacementB2RegularState(alternate, maximumBytes: 67_108_864)
                guard copied?.digest == original.digest, copied?.identity != original.identity else {
                    throw CoherentReplacementB2Failure.unexpected("CR03 alternate not byte-identical and distinct.")
                }
            }
            let (writer, pid) = try cr03RunWriter(executable: executable, root: root, custody: custody, scope: scope,
                repetition: repetition, mode: mode, main: main, alternate: alternate, original: original, copied: copied)
            guard try coherentReplacementB2RegularState(main, maximumBytes: 67_108_864).identity == original.identity else {
                throw CoherentReplacementB2Failure.unexpected("CR03 restored main identity changed after reap.")
            }
            let retained = try cr03RetainBeforeRecovery(root: root, scope: scope,
                rootBinding: rootBinding, projectsBinding: projectsBinding, projectBinding: projectBinding,
                original: original, copied: copied)
            let recovery = try coherentReplacementB2RunRecovery(executable: executable, root: root, custody: custody, scope: scope,
                request: coherentReplacementB2Request("cr03-recover-\(mode)", repetition: repetition), recoveryCase: "CR-03-MAIN-AFTER-REAP",
                repetition: repetition, expectedEvents: 2, expectedCandidate: true,
                expectedBaselineIncidentID: baseline.incidentID, expectedBaselineEventDigest: baseline.eventDigest)
            guard case let .recoveredExact(head) = recovery else {
                throw CoherentReplacementB2Failure.unexpected("CR03 independent recovery refused.")
            }
            if mode == "control" {
                guard writer.record == "APPENDED", writer.close == "RETURNED", writer.candidateDigest == head else {
                    throw CoherentReplacementB2Failure.unexpected("CR03 unmutated control did not close and recover exactly.")
                }
                expectedHead = head
            } else {
                guard head == expectedHead, writer.candidateDigest.map({ $0 == head }) ?? true else {
                    throw CoherentReplacementB2Failure.unexpected("CR03 recovered candidate disagrees with unmutated control.")
                }
            }
            // Human diagnostic channel only. The formal machine acceptance
            // grammar is unchanged and grants no credit for this new fixture.
            let recoveryLabel = mode == "control" ? "CONTROL_ESTABLISHED_EXACT" : "CONTROL_MATCHED_EXACT"
            print("CR03_PROCESS_DIAGNOSTIC|v1|mode=\(mode)|repetition=\(repetition)|writer_pid=\(pid)|record=\(writer.record)|close=\(writer.close)|reaped=true|recovery=\(recoveryLabel)|head=\(head)|authorizing=false|root=\(root.path)|inventory_phase=AFTER_WRITER_REAP_BEFORE_RECOVERY|copies=\(retained.joined(separator: ","))")
        }
    }

    @Test(
        "CR-01 isolated child admits alternate main across restored A-B-A around sqlite3_open_v2",
        arguments: [0, 1]
    )
    func openTimeMainABA(repetition: Int) async throws {
        let executable = try coherentReplacementB2ProbeExecutable()
        let root = try coherentReplacementB2Root("cr01-\(repetition)")
        let custody = CoherentReplacementB2FixtureCustody(root: root)
        var seedClosed = false
        defer {
            if !seedClosed {
                custody.retain("CR-01 parent seed ledger close was not confirmed.")
            }
            custody.removeIfSafe()
        }
        let scope = coherentReplacementB2Scope(caseID: "b2-cr01", repetition: repetition)
        let seed = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        let seedDisposition = try await seed.record(
            coherentReplacementB2BaselineObservation(caseID: "b2-cr01", repetition: repetition)
        )
        guard case let .appended(baselineSummary) = seedDisposition else {
            throw CoherentReplacementB2Failure.unexpected("CR-01 baseline did not append.")
        }
        #expect(try await seed.verifyIntegrity().eventCount == 1)
        try await seed.close()
        seedClosed = true

        let project = coherentReplacementB2Project(root: root, scope: scope)
        let main = project.appendingPathComponent("incident-ledger-v1.sqlite3")
        let alternate = project.appendingPathComponent(
            ".baseline-b2-cr01-alternate-\(repetition).sqlite3"
        )
        let original = try coherentReplacementB2RegularState(
            main,
            maximumBytes: 67_108_864
        )
        try coherentReplacementB2CopyPrivateFile(from: main, to: alternate)
        let copied = try coherentReplacementB2RegularState(
            alternate,
            maximumBytes: 67_108_864
        )
        guard original.digest == copied.digest, original.identity != copied.identity else {
            throw CoherentReplacementB2Failure.unexpected(
                "CR-01 alternate B was not a byte-identical distinct file."
            )
        }

        let openOutcome = try coherentReplacementB2RunCR01OpenABA(
            executable: executable,
            root: root,
            custody: custody,
            scope: scope,
            main: main,
            alternate: alternate,
            originalIdentity: original.identity,
            alternateIdentity: copied.identity,
            repetition: repetition
        )
        let restored = try coherentReplacementB2RegularState(
            main,
            maximumBytes: 67_108_864
        )
        guard restored.identity == original.identity, restored.digest == original.digest else {
            throw CoherentReplacementB2Failure.unexpected(
                "CR-01 did not leave canonical A unchanged after child reap."
            )
        }
        let displaced = try coherentReplacementB2RegularState(
            alternate,
            maximumBytes: 67_108_864
        )
        guard displaced.identity == copied.identity else {
            throw CoherentReplacementB2Failure.unexpected(
                "CR-01 did not retain the opened alternate identity after reap."
            )
        }
        // Leave the displaced private alternate in the retained fixture. Recursive
        // pathname deletion is intentionally disabled for this safety harness.
        let recovery = try coherentReplacementB2RunRecovery(
            executable: executable,
            root: root,
            custody: custody,
            scope: scope,
            request: coherentReplacementB2Request("cr01-recovery", repetition: repetition),
            recoveryCase: "CR-01-A",
            repetition: repetition,
            expectedEvents: 1,
            expectedCandidate: false,
            expectedBaselineIncidentID: baselineSummary.incidentID,
            expectedBaselineEventDigest: baselineSummary.eventDigest
        )
        guard recovery == .recoveredExact(headDigest: baselineSummary.eventDigest) else {
            throw CoherentReplacementB2Failure.unexpected(
                "CR-01 canonical A did not recover at the exact seed state."
            )
        }

        guard openOutcome == .bootstrapRefusedSQLiteIOError else {
            throw CoherentReplacementB2Failure.unexpected(
                "CR-01 behavior drifted from the frozen SQLite IOERR runtime refusal."
            )
        }
        MachineEvidence.record(
            "VERITAS_BASELINE_B_RESULT|case=CR-01|target=main-open" +
                "|repetition=\(repetition)|classification=RUNTIME_REFUSAL" +
                "|outcome=SQLITE_OPEN_ADMITTED_B_BOOTSTRAP_REFUSED_IOERR_A_RECOVERY_UNCHANGED" +
                "|sqlite_code=10|kill_signal=9|reaped=true|main_a_events=1" +
                "|baseline_head_verified=true|authorizing=false"
        )
    }

    @Test(
        "CR-05 post-kill removed SHM reaches one bounded restart disposition",
        arguments: [0, 1]
    )
    func removedSHM(repetition: Int) async throws {
        try await runPostKillSHM(mutation: .remove, repetition: repetition)
    }

    @Test(
        "CR-05 post-kill corrupted SHM reaches one bounded restart disposition",
        arguments: [0, 1]
    )
    func corruptedSHM(repetition: Int) async throws {
        try await runPostKillSHM(mutation: .corrupt, repetition: repetition)
    }

    private func runPostKillSHM(
        mutation: CoherentReplacementB2SHMMutation,
        repetition: Int
    ) async throws {
        let executable = try coherentReplacementB2ProbeExecutable()
        let root = try coherentReplacementB2Root("cr05-\(mutation.rawValue)-\(repetition)")
        let custody = CoherentReplacementB2FixtureCustody(root: root)
        var seedClosed = false
        defer {
            if !seedClosed {
                custody.retain("CR-05 parent seed ledger close was not confirmed.")
            }
            custody.removeIfSafe()
        }
        let scope = coherentReplacementB2Scope(
            caseID: "b2-cr05-\(mutation.rawValue)",
            repetition: repetition
        )
        let seed = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        let seedDisposition = try await seed.record(
            coherentReplacementB2BaselineObservation(
                caseID: "b2-cr05-\(mutation.rawValue)",
                repetition: repetition
            )
        )
        guard case let .appended(baselineSummary) = seedDisposition else {
            throw CoherentReplacementB2Failure.unexpected("CR-05 baseline did not append.")
        }
        #expect(try await seed.verifyIntegrity().eventCount == 1)
        try await seed.close()
        seedClosed = true

        try coherentReplacementB2RunAbruptCommit(
            executable: executable,
            root: root,
            custody: custody,
            scope: scope,
            repetition: repetition
        )

        let project = coherentReplacementB2Project(root: root, scope: scope)
        let main = project.appendingPathComponent("incident-ledger-v1.sqlite3")
        let wal = URL(fileURLWithPath: main.path + "-wal")
        let shm = URL(fileURLWithPath: main.path + "-shm")
        let mainBefore = try coherentReplacementB2RegularState(
            main,
            maximumBytes: 67_108_864
        )
        let walBefore = try coherentReplacementB2RegularState(
            wal,
            maximumBytes: 67_108_864
        )
        let shmBefore = try coherentReplacementB2RegularState(
            shm,
            maximumBytes: coherentReplacementB2MaximumSHMBytes
        )
        let walState = try coherentReplacementB2WALState(wal)
        #expect(walState.pageSize == 4_096)
        #expect(walState.physicalFrameCapacity > 0)
        #expect(walState.byteCount == walBefore.byteCount)

        let mainOnlyRoot = try coherentReplacementB2PrepareControlRoot(
            label: "cr05-main-only-\(mutation.rawValue)-\(repetition)",
            scope: scope,
            main: main,
            wal: nil
        )
        let mainOnlyCustody = CoherentReplacementB2FixtureCustody(root: mainOnlyRoot)
        defer { mainOnlyCustody.removeIfSafe() }
        let mainOnly = try coherentReplacementB2RunRecovery(
            executable: executable,
            root: mainOnlyRoot,
            custody: mainOnlyCustody,
            scope: scope,
            request: coherentReplacementB2Request("cr05-main-only", repetition: repetition),
            recoveryCase: "CR-05-MAIN-ONLY",
            repetition: repetition,
            expectedEvents: 1,
            expectedCandidate: false,
            expectedBaselineIncidentID: baselineSummary.incidentID,
            expectedBaselineEventDigest: baselineSummary.eventDigest
        )
        guard mainOnly == .recoveredExact(headDigest: baselineSummary.eventDigest) else {
            throw CoherentReplacementB2Failure.unexpected(
                "CR-05 main-only control did not remain at one baseline event."
            )
        }

        let walControlRoot = try coherentReplacementB2PrepareControlRoot(
            label: "cr05-wal-control-\(mutation.rawValue)-\(repetition)",
            scope: scope,
            main: main,
            wal: wal
        )
        let walControlCustody = CoherentReplacementB2FixtureCustody(root: walControlRoot)
        defer { walControlCustody.removeIfSafe() }
        let walControl = try coherentReplacementB2RunRecovery(
            executable: executable,
            root: walControlRoot,
            custody: walControlCustody,
            scope: scope,
            request: coherentReplacementB2Request("cr05-wal-control", repetition: repetition),
            recoveryCase: "CR-05-WAL-CONTROL",
            repetition: repetition,
            expectedEvents: 2,
            expectedCandidate: true,
            expectedBaselineIncidentID: baselineSummary.incidentID,
            expectedBaselineEventDigest: baselineSummary.eventDigest
        )
        guard case let .recoveredExact(walControlHeadDigest) = walControl else {
            throw CoherentReplacementB2Failure.unexpected(
                "CR-05 main-plus-WAL control did not recover the exact committed candidate."
            )
        }

        let mainAfterControls = try coherentReplacementB2RegularState(
            main,
            maximumBytes: 67_108_864
        )
        let walAfterControls = try coherentReplacementB2RegularState(
            wal,
            maximumBytes: 67_108_864
        )
        guard
            mainAfterControls.identity == mainBefore.identity,
            mainAfterControls.digest == mainBefore.digest,
            walAfterControls.identity == walBefore.identity,
            walAfterControls.digest == walBefore.digest
        else {
            throw CoherentReplacementB2Failure.unexpected(
                "CR-05 validation controls changed the original main or WAL."
            )
        }

        let corruptedDigest = try coherentReplacementB2MutateSHM(
            mutation,
            project: project,
            shm: shm,
            expected: shmBefore
        )
        let mainAfterMutation = try coherentReplacementB2RegularState(
            main,
            maximumBytes: 67_108_864
        )
        let walAfterMutation = try coherentReplacementB2RegularState(
            wal,
            maximumBytes: 67_108_864
        )
        guard
            mainAfterMutation.identity == mainBefore.identity,
            mainAfterMutation.digest == mainBefore.digest,
            walAfterMutation.identity == walBefore.identity,
            walAfterMutation.digest == walBefore.digest
        else {
            throw CoherentReplacementB2Failure.unexpected(
                "CR-05 SHM mutation changed main or WAL before recovery."
            )
        }

        let recovery = try coherentReplacementB2RunRecovery(
            executable: executable,
            root: root,
            custody: custody,
            scope: scope,
            request: coherentReplacementB2Request(
                "cr05-\(mutation.rawValue)-recovery",
                repetition: repetition
            ),
            recoveryCase: mutation.recoveryCase,
            repetition: repetition,
            expectedEvents: 2,
            expectedCandidate: true,
            expectedBaselineIncidentID: baselineSummary.incidentID,
            expectedBaselineEventDigest: baselineSummary.eventDigest
        )

        guard recovery == .recoveredExact(headDigest: walControlHeadDigest) else {
            throw CoherentReplacementB2Failure.unexpected(
                "CR-05 behavior drifted from the frozen exact recovery disposition."
            )
        }
        let rebuilt = try coherentReplacementB2RegularState(
            shm,
            maximumBytes: coherentReplacementB2MaximumSHMBytes
        )
        switch mutation {
        case .remove:
            break
        case .corrupt:
            guard let corruptedDigest, rebuilt.digest != corruptedDigest else {
                throw CoherentReplacementB2Failure.unexpected(
                    "CR-05 corrupted SHM was not rebuilt to different bytes."
                )
            }
        }
        MachineEvidence.record(
            "VERITAS_BASELINE_B_RESULT|case=CR-05|target=\(mutation.resultTarget)" +
                "|repetition=\(repetition)|classification=SAFE_RECOVERY" +
                "|outcome=VALID_WAL_EXACT_STATE_RECOVERED_WITH_ADMISSIBLE_SHM_REBUILD" +
                "|kill_signal=9|reaped=true|main_only_events=1" +
                "|wal_control_events=2|recovered_events=2" +
                "|recovery_head_matches_wal_control=true|shm_admitted=true" +
                "|authorizing=false"
        )
    }
}

@Suite("Founder Alpha coherent replacement Baseline B3 dormant WAL identity", .serialized)
struct LocalIncidentLedgerCoherentReplacementBaselineB3Tests {
    @Test(
        "CR-04 post-reap byte-identical WAL identity replacement recovers the exact control head",
        arguments: [0, 1]
    )
    func dormantWALIdentityReplacement(repetition: Int) async throws {
        let executable = try coherentReplacementB2ProbeExecutable()
        let root = try coherentReplacementB2Root("cr04-wal-identity-\(repetition)")
        let rootBinding = try coherentReplacementB3DirectoryBinding(root)
        let custody = CoherentReplacementB2FixtureCustody(root: root)
        var seedClosed = false
        var cleanupReady = false
        defer {
            if !seedClosed {
                custody.retain("The Baseline B3 CR-04 seed close was not confirmed.")
            }
            if !cleanupReady {
                custody.retain("The Baseline B3 CR-04 fixture did not reach validated cleanup.")
            }
            custody.removeIfSafe()
        }
        let scope = coherentReplacementB2Scope(
            caseID: "b3-cr04-wal-identity",
            repetition: repetition
        )
        let seed = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
        let seedDisposition = try await seed.record(
            coherentReplacementB2BaselineObservation(
                caseID: "b3-cr04-wal-identity",
                repetition: repetition
            )
        )
        guard case let .appended(baselineSummary) = seedDisposition else {
            throw CoherentReplacementB2Failure.unexpected(
                "The Baseline B3 CR-04 seed observation did not append."
            )
        }
        let seedVerification = try await seed.verifyIntegrity()
        guard
            seedVerification.eventCount == 1,
            seedVerification.headDigest == baselineSummary.eventDigest,
            seedVerification.authorizing == false,
            seedVerification.protectedAuthorityVerified == false
        else {
            throw CoherentReplacementB2Failure.unexpected(
                "The Baseline B3 CR-04 seed state was not exact."
            )
        }
        try await seed.close()
        seedClosed = true

        try coherentReplacementB3RunAbruptCommit(
            executable: executable,
            root: root,
            custody: custody,
            scope: scope,
            repetition: repetition
        )

        let project = coherentReplacementB2Project(root: root, scope: scope)
        let projectBinding = try coherentReplacementB3DirectoryBinding(project)
        let mainName = "incident-ledger-v1.sqlite3"
        let walName = mainName + "-wal"
        let shmName = mainName + "-shm"
        let alternateName = ".baseline-b3-cr04-wal-identity-\(repetition).wal"
        let main = project.appendingPathComponent(mainName)
        let wal = project.appendingPathComponent(walName)

        let generatorDescriptor = Darwin.open(
            project.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard generatorDescriptor >= 0 else {
            throw CoherentReplacementB2Failure.filesystem(
                "Unable to open the Baseline B3 generator project for admission."
            )
        }
        var generatorDescriptorIsOpen = true
        defer {
            if generatorDescriptorIsOpen {
                _ = Darwin.close(generatorDescriptor)
            }
        }
        var generatorDirectoryStatus = stat()
        guard
            Darwin.fstat(generatorDescriptor, &generatorDirectoryStatus) == 0,
            UInt64(generatorDirectoryStatus.st_dev) == projectBinding.identity.device,
            UInt64(generatorDirectoryStatus.st_ino) == projectBinding.identity.inode
        else {
            throw CoherentReplacementB2Failure.unexpected(
                "The Baseline B3 generator project changed before admission."
            )
        }
        let mainSnapshot = try coherentReplacementB3RelativeRegularSnapshot(
            directoryDescriptor: generatorDescriptor,
            name: mainName,
            maximumBytes: 67_108_864
        )
        let walSnapshot = try coherentReplacementB3RelativeRegularSnapshot(
            directoryDescriptor: generatorDescriptor,
            name: walName,
            maximumBytes: 67_108_864
        )
        let shmSnapshot = try coherentReplacementB3RelativeRegularSnapshot(
            directoryDescriptor: generatorDescriptor,
            name: shmName,
            maximumBytes: coherentReplacementB2MaximumSHMBytes
        )
        let mainBefore = mainSnapshot.state
        let walBefore = walSnapshot.state
        let walStructure = try coherentReplacementB3WALState(walSnapshot)
        guard
            walStructure.pageSize == 4_096,
            walStructure.physicalFrameCapacity > 0,
            walStructure.byteCount == walBefore.byteCount,
            shmSnapshot.state.byteCount > 0
        else {
            throw CoherentReplacementB2Failure.unexpected(
                "The Baseline B3 CR-04 dormant WAL was not structurally admitted."
            )
        }
        guard Darwin.close(generatorDescriptor) == 0 else {
            throw CoherentReplacementB2Failure.filesystem(
                "Unable to close the Baseline B3 generator descriptor before controls."
            )
        }
        generatorDescriptorIsOpen = false
        let alternateBefore = try coherentReplacementB3FreezeWALAlternate(
            project: project,
            projectBinding: projectBinding,
            walName: walName,
            alternateName: alternateName,
            expectedWAL: walBefore
        )

        let mainOnly = try coherentReplacementB3RunRecoveryControl(
            label: "cr04-main-only-\(repetition)",
            executable: executable,
            scope: scope,
            sourceMain: main,
            sourceWAL: nil,
            expectedMain: mainBefore,
            expectedWAL: nil,
            recoveryCase: "CR-04-MAIN-ONLY",
            repetition: repetition,
            expectedEvents: 1,
            expectedCandidate: false,
            expectedBaselineIncidentID: baselineSummary.incidentID,
            expectedBaselineEventDigest: baselineSummary.eventDigest
        )
        guard mainOnly == .recoveredExact(headDigest: baselineSummary.eventDigest) else {
            throw CoherentReplacementB2Failure.unexpected(
                "The Baseline B3 CR-04 main-only control did not recover H0."
            )
        }
        let walControl = try coherentReplacementB3RunRecoveryControl(
            label: "cr04-wal-control-\(repetition)",
            executable: executable,
            scope: scope,
            sourceMain: main,
            sourceWAL: wal,
            expectedMain: mainBefore,
            expectedWAL: walBefore,
            recoveryCase: "CR-04-WAL-CONTROL",
            repetition: repetition,
            expectedEvents: 2,
            expectedCandidate: true,
            expectedBaselineIncidentID: baselineSummary.incidentID,
            expectedBaselineEventDigest: baselineSummary.eventDigest
        )
        guard case let .recoveredExact(walControlHeadDigest) = walControl else {
            throw CoherentReplacementB2Failure.unexpected(
                "The Baseline B3 CR-04 main-plus-WAL control did not recover HA."
            )
        }

        let mutationRoot = try coherentReplacementB2Root(
            "cr04-wal-identity-subject-\(repetition)"
        )
        let mutationRootBinding = try coherentReplacementB3DirectoryBinding(mutationRoot)
        let mutationCustody = CoherentReplacementB2FixtureCustody(root: mutationRoot)
        var mutationCleanupReady = false
        defer {
            if !mutationCleanupReady {
                mutationCustody.retain(
                    "The fresh Baseline B3 CR-04 subject did not reach validated cleanup."
                )
            }
            mutationCustody.removeIfSafe()
        }
        let mutationProjectBinding = try coherentReplacementB3PrepareFreshMutationSubject(
            root: mutationRoot,
            scope: scope,
            sourceProject: project,
            sourceProjectBinding: projectBinding,
            mainName: mainName,
            walName: walName,
            shmName: shmName,
            alternateName: alternateName,
            expectedMain: mainBefore,
            expectedWAL: walBefore,
            expectedAlternate: alternateBefore
        )
        try coherentReplacementB3ValidateInventory(
            root: root,
            rootBinding: rootBinding,
            scope: scope,
            allowedAdditionalFileNames: [alternateName]
        )
        cleanupReady = true

        let mutationProject = coherentReplacementB2Project(root: mutationRoot, scope: scope)
        let mutationDescriptor = Darwin.open(
            mutationProject.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard mutationDescriptor >= 0 else {
            throw CoherentReplacementB2Failure.filesystem(
                "Unable to open the fresh Baseline B3 subject for exact admission."
            )
        }
        var mutationDescriptorIsOpen = true
        defer {
            if mutationDescriptorIsOpen {
                _ = Darwin.close(mutationDescriptor)
            }
        }
        let mutationMain = try coherentReplacementB3RelativeRegularState(
            directoryDescriptor: mutationDescriptor,
            name: mainName,
            maximumBytes: 67_108_864
        )
        let mutationWAL = try coherentReplacementB3RelativeRegularState(
            directoryDescriptor: mutationDescriptor,
            name: walName,
            maximumBytes: 67_108_864
        )
        let mutationAlternate = try coherentReplacementB3RelativeRegularState(
            directoryDescriptor: mutationDescriptor,
            name: alternateName,
            maximumBytes: 67_108_864
        )
        try coherentReplacementB3RequireAbsentRelativePath(
            directoryDescriptor: mutationDescriptor,
            name: shmName
        )
        guard
            mutationMain.digest == mainBefore.digest,
            mutationWAL.digest == walBefore.digest,
            mutationAlternate.digest == alternateBefore.digest,
            mutationWAL.identity != mutationAlternate.identity
        else {
            throw CoherentReplacementB2Failure.unexpected(
                "The fresh Baseline B3 subject did not preserve the exact frozen tuple."
            )
        }
        let mutationDescriptorClose = Darwin.close(mutationDescriptor)
        mutationDescriptorIsOpen = false
        guard mutationDescriptorClose == 0 else {
            throw CoherentReplacementB2Failure.filesystem(
                "Unable to close the fresh Baseline B3 subject before replacement."
            )
        }
        try coherentReplacementB3SwapDormantWAL(
            project: mutationProject,
            projectBinding: mutationProjectBinding,
            mainName: mainName,
            walName: walName,
            shmName: shmName,
            alternateName: alternateName,
            expectedMain: mutationMain,
            expectedWAL: mutationWAL,
            expectedAlternate: mutationAlternate
        )

        let recovery = try coherentReplacementB2RunRecovery(
            executable: executable,
            root: mutationRoot,
            custody: mutationCustody,
            scope: scope,
            request: coherentReplacementB2Request(
                "cr04-wal-identity-recovery",
                repetition: repetition
            ),
            recoveryCase: "CR-04-WAL-IDENTITY",
            repetition: repetition,
            expectedEvents: 2,
            expectedCandidate: true,
            expectedBaselineIncidentID: baselineSummary.incidentID,
            expectedBaselineEventDigest: baselineSummary.eventDigest
        )
        guard recovery == .recoveredExact(headDigest: walControlHeadDigest) else {
            throw CoherentReplacementB2Failure.unexpected(
                "The Baseline B3 CR-04 identity subject drifted from its frozen exact oracle."
            )
        }
        try coherentReplacementB3ValidateInventory(
            root: mutationRoot,
            rootBinding: mutationRootBinding,
            scope: scope,
            allowedAdditionalFileNames: [alternateName]
        )
        mutationCleanupReady = true
        MachineEvidence.record(
            "VERITAS_BASELINE_B_RESULT|case=CR-04|target=post-reap-wal-identity" +
                "|repetition=\(repetition)|classification=LIMITATION_REPRODUCED" +
                "|outcome=BYTE_IDENTICAL_DORMANT_WAL_REPLACEMENT_ADMITTED_EXACT_CONTROL_HEAD" +
                "|kill_signal=9|reaped=true|main_only_events=1|wal_control_events=2" +
                "|recovered_events=2|replacement_identity_distinct=true" +
                "|wal_bytes_equal=true|recovery_head_matches_wal_control=true" +
                "|no_shm_at_mutation=true|authorizing=false"
        )
    }

    @Test(
        "CR-04 post-reap divergent valid dormant WAL branch substitution recovers exact branch B",
        arguments: [0, 1]
    )
    func divergentDormantWALBranchSubstitution(repetition: Int) async throws {
        try coherentReplacementB3BVerifyFrozenVectors()
        let executable = try coherentReplacementB2ProbeExecutable()
        let scope = coherentReplacementB2Scope(
            caseID: "b3-cr04-wal-divergent",
            repetition: repetition
        )
        let seedRoot = try coherentReplacementB3BRoot("cr04-divergent-source-\(repetition)")
        let seedRootBinding = try coherentReplacementB3DirectoryBinding(seedRoot)
        let seedCustody = CoherentReplacementB2FixtureCustody(root: seedRoot)
        var seedClosed = false
        var seedInventoryValidated = false
        defer {
            if !seedClosed {
                seedCustody.retain("The B3B seed ledger did not close exactly.")
            }
            if !seedInventoryValidated {
                seedCustody.retain("The B3B seed root did not reach exact retained inventory.")
            }
            seedCustody.removeIfSafe()
        }

        let baselineObservation = coherentReplacementB2BaselineObservation(
            caseID: "b3-cr04-wal-divergent",
            repetition: repetition
        )
        let seed = try await LocalIncidentLedgerV1.open(
            rootDirectory: seedRoot,
            scope: scope
        )
        let seedDisposition = try await seed.record(baselineObservation)
        guard case let .appended(baselineSummary) = seedDisposition else {
            throw CoherentReplacementB2Failure.unexpected(
                "The B3B baseline observation did not append."
            )
        }
        let seedVerification = try await seed.verifyIntegrity()
        guard
            seedVerification.eventCount == 1,
            seedVerification.observationCount == 1,
            seedVerification.tombstoneCount == 0,
            seedVerification.headDigest == baselineSummary.eventDigest,
            seedVerification.authorizing == false,
            seedVerification.protectedAuthorityVerified == false,
            seedVerification.rawContentStored == false
        else {
            throw CoherentReplacementB2Failure.unexpected(
                "The B3B seed did not freeze exact H0."
            )
        }
        try await seed.close()
        seedClosed = true

        let seedProject = coherentReplacementB2Project(root: seedRoot, scope: scope)
        let seedProjectBinding = try coherentReplacementB3DirectoryBinding(seedProject)
        let seedDescriptor = Darwin.open(
            seedProject.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard seedDescriptor >= 0 else {
            throw CoherentReplacementB2Failure.filesystem(
                "Unable to open the B3B checkpointed seed project."
            )
        }
        var seedDescriptorIsOpen = true
        defer {
            if seedDescriptorIsOpen { _ = Darwin.close(seedDescriptor) }
        }
        let m0 = try coherentReplacementB3RelativeRegularSnapshot(
            directoryDescriptor: seedDescriptor,
            name: "incident-ledger-v1.sqlite3",
            maximumBytes: 67_108_864
        )
        for sidecar in ["incident-ledger-v1.sqlite3-wal", "incident-ledger-v1.sqlite3-shm"] {
            if try coherentReplacementB3BEntryExists(
                directoryDescriptor: seedDescriptor,
                name: sidecar
            ) {
                _ = try coherentReplacementB3RelativeRegularSnapshot(
                    directoryDescriptor: seedDescriptor,
                    name: sidecar,
                    maximumBytes: sidecar.hasSuffix("-shm")
                        ? coherentReplacementB2MaximumSHMBytes
                        : 67_108_864,
                    requireNonempty: false
                )
            }
        }
        guard Darwin.close(seedDescriptor) == 0 else {
            throw CoherentReplacementB2Failure.filesystem(
                "The B3B seed descriptor did not close exactly."
            )
        }
        seedDescriptorIsOpen = false
        let sourcePrepared = CoherentReplacementB3BPreparedRoot(
            root: seedRoot,
            rootBinding: seedRootBinding,
            project: seedProject,
            projectBinding: seedProjectBinding,
            main: m0.state,
            wal: nil
        )
        let m0Prepared = try coherentReplacementB3BPrepareRoot(
            label: "cr04-divergent-m0-\(repetition)",
            scope: scope,
            mainBytes: m0.bytes
        )
        guard
            m0Prepared.main.byteCount == m0.state.byteCount,
            m0Prepared.main.digest == m0.state.digest,
            m0Prepared.main.identity != m0.state.identity
        else {
            throw CoherentReplacementB2Failure.unexpected(
                "The B3B normalized M0 was not an exact identity-distinct main-only copy."
            )
        }
        let m0Custody = CoherentReplacementB2FixtureCustody(root: m0Prepared.root)
        var m0InventoryValidated = false
        defer {
            if !m0InventoryValidated {
                m0Custody.retain("The normalized B3B M0 root was not exactly retained.")
            }
            m0Custody.removeIfSafe()
        }

        let mainOnlyControl = try coherentReplacementB3BRunControl(
            label: "cr04-divergent-main-only-\(repetition)",
            executable: executable,
            scope: scope,
            mainBytes: m0.bytes,
            walBytes: nil,
            repetition: repetition,
            state: .m0,
            purpose: .baselineExact,
            expectedBaselineIncidentID: baselineSummary.incidentID,
            expectedBaselineEventDigest: baselineSummary.eventDigest,
            expectedHead: baselineSummary.eventDigest
        )
        let h0 = mainOnlyControl.head
        guard h0 == baselineSummary.eventDigest else {
            throw CoherentReplacementB2Failure.unexpected(
                "The B3B main-only control did not return exact H0."
            )
        }

        let branchA = try coherentReplacementB3BBuildBranch(
            executable: executable,
            scope: scope,
            m0: m0,
            repetition: repetition,
            branch: .a
        )
        let branchB = try coherentReplacementB3BBuildBranch(
            executable: executable,
            scope: scope,
            m0: m0,
            repetition: repetition,
            branch: .b
        )
        guard
            branchA.wal.bytes != branchB.wal.bytes,
            branchA.wal.state.digest != branchB.wal.state.digest
        else {
            throw CoherentReplacementB2Failure.unexpected(
                "The B3B branch WAL successors were not byte and digest distinct."
            )
        }

        let branchAControl = try coherentReplacementB3BRunControl(
            label: "cr04-divergent-control-a-\(repetition)",
            executable: executable,
            scope: scope,
            mainBytes: m0.bytes,
            walBytes: branchA.wal.bytes,
            repetition: repetition,
            state: .a,
            purpose: .controlDiscover,
            expectedBaselineIncidentID: baselineSummary.incidentID,
            expectedBaselineEventDigest: baselineSummary.eventDigest,
            expectedHead: "DISCOVER"
        )
        let branchBControl = try coherentReplacementB3BRunControl(
            label: "cr04-divergent-control-b-\(repetition)",
            executable: executable,
            scope: scope,
            mainBytes: m0.bytes,
            walBytes: branchB.wal.bytes,
            repetition: repetition,
            state: .b,
            purpose: .controlDiscover,
            expectedBaselineIncidentID: baselineSummary.incidentID,
            expectedBaselineEventDigest: baselineSummary.eventDigest,
            expectedHead: "DISCOVER"
        )
        let hA = branchAControl.head
        let hB = branchBControl.head
        guard h0 != hA, h0 != hB, hA != hB else {
            throw CoherentReplacementB2Failure.unexpected(
                "The B3B H0, HA, and HB controls were not pairwise distinct."
            )
        }

        let alternateName = ".baseline-b3b-cr04-wal-divergent-\(repetition).wal"
        let mutation = try coherentReplacementB3BPrepareRoot(
            label: "cr04-divergent-mutation-\(repetition)",
            scope: scope,
            mainBytes: m0.bytes,
            walBytes: branchA.wal.bytes,
            alternateName: alternateName,
            alternateBytes: branchB.wal.bytes
        )
        let mutationCustody = CoherentReplacementB2FixtureCustody(root: mutation.root)
        var mutationInventoryValidated = false
        defer {
            if !mutationInventoryValidated {
                mutationCustody.retain(
                    "The B3B mutation root did not reach exact retained inventory."
                )
            }
            mutationCustody.removeIfSafe()
        }
        let mutationDescriptor = Darwin.open(
            mutation.project.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard mutationDescriptor >= 0 else {
            throw CoherentReplacementB2Failure.filesystem(
                "Unable to open the fresh B3B mutation subject."
            )
        }
        var mutationDescriptorIsOpen = true
        defer {
            if mutationDescriptorIsOpen { _ = Darwin.close(mutationDescriptor) }
        }
        let mutationMain = try coherentReplacementB3RelativeRegularState(
            directoryDescriptor: mutationDescriptor,
            name: "incident-ledger-v1.sqlite3",
            maximumBytes: 67_108_864
        )
        let mutationWAL = try coherentReplacementB3RelativeRegularState(
            directoryDescriptor: mutationDescriptor,
            name: "incident-ledger-v1.sqlite3-wal",
            maximumBytes: 67_108_864
        )
        let mutationAlternate = try coherentReplacementB3RelativeRegularState(
            directoryDescriptor: mutationDescriptor,
            name: alternateName,
            maximumBytes: 67_108_864
        )
        try coherentReplacementB3RequireAbsentRelativePath(
            directoryDescriptor: mutationDescriptor,
            name: "incident-ledger-v1.sqlite3-shm"
        )
        guard Darwin.close(mutationDescriptor) == 0 else {
            throw CoherentReplacementB2Failure.filesystem(
                "The B3B mutation admission descriptor did not close exactly."
            )
        }
        mutationDescriptorIsOpen = false
        try coherentReplacementB3SwapDormantWAL(
            project: mutation.project,
            projectBinding: mutation.projectBinding,
            mainName: "incident-ledger-v1.sqlite3",
            walName: "incident-ledger-v1.sqlite3-wal",
            shmName: "incident-ledger-v1.sqlite3-shm",
            alternateName: alternateName,
            expectedMain: mutationMain,
            expectedWAL: mutationWAL,
            expectedAlternate: mutationAlternate,
            exactProjectNames: [
                "incident-ledger-v1.sqlite3",
                "incident-ledger-v1.sqlite3-wal",
                alternateName,
            ]
        )

        let recoveredHead = try coherentReplacementB3BRunRecovery(
            executable: executable,
            prepared: mutation,
            custody: mutationCustody,
            scope: scope,
            repetition: repetition,
            state: .b,
            purpose: .finalExact,
            expectedBaselineIncidentID: baselineSummary.incidentID,
            expectedBaselineEventDigest: baselineSummary.eventDigest,
            expectedHead: hB
        )
        guard recoveredHead == hB else {
            throw CoherentReplacementB2Failure.unexpected(
                "The B3B mutation subject did not recover exact HB."
            )
        }
        try coherentReplacementB3BValidateRetainedInventory(
            prepared: mutation,
            scope: scope,
            requiredNames: ["incident-ledger-v1.sqlite3", alternateName],
            optionalNames: ["incident-ledger-v1.sqlite3-wal", "incident-ledger-v1.sqlite3-shm"]
        )
        mutationInventoryValidated = true
        try coherentReplacementB3BValidateRetainedInventory(
            prepared: sourcePrepared,
            scope: scope,
            requiredNames: ["incident-ledger-v1.sqlite3"],
            optionalNames: ["incident-ledger-v1.sqlite3-wal", "incident-ledger-v1.sqlite3-shm"]
        )
        seedInventoryValidated = true
        try coherentReplacementB3BValidateRetainedInventory(
            prepared: m0Prepared,
            scope: scope,
            requiredNames: ["incident-ledger-v1.sqlite3"],
            optionalNames: []
        )
        m0InventoryValidated = true
        try coherentReplacementB3BValidateRetainedInventory(
            prepared: branchA.prepared,
            scope: scope,
            requiredNames: ["incident-ledger-v1.sqlite3", "incident-ledger-v1.sqlite3-wal"],
            optionalNames: ["incident-ledger-v1.sqlite3-shm"]
        )
        try coherentReplacementB3BValidateRetainedInventory(
            prepared: branchB.prepared,
            scope: scope,
            requiredNames: ["incident-ledger-v1.sqlite3", "incident-ledger-v1.sqlite3-wal"],
            optionalNames: ["incident-ledger-v1.sqlite3-shm"]
        )
        for control in [mainOnlyControl, branchAControl, branchBControl] {
            try coherentReplacementB3BValidateRetainedInventory(
                prepared: control.prepared,
                scope: scope,
                requiredNames: ["incident-ledger-v1.sqlite3"],
                optionalNames: [
                    "incident-ledger-v1.sqlite3-wal",
                    "incident-ledger-v1.sqlite3-shm",
                ]
            )
        }

        MachineEvidence.record(
            "VERITAS_BASELINE_B_RESULT|case=CR-04|target=post-reap-wal-divergent" +
                "|repetition=\(repetition)|classification=LIMITATION_REPRODUCED" +
                "|outcome=DIVERGENT_VALID_DORMANT_WAL_B_ADMITTED_EXACT_BRANCH_B_HEAD" +
                "|branch_a_kill_signal=9|branch_b_kill_signal=9" +
                "|all_children_reaped=true|main_only_events=1" +
                "|branch_a_control_events=2|branch_b_control_events=2" +
                "|recovered_events=2|branch_a_present=false|branch_b_present=true" +
                "|branch_heads_distinct=true|branch_wal_bytes_distinct=true" +
                "|branch_wal_digests_distinct=true|main_unchanged_through_swap=true" +
                "|canonical_wal_pre_recovery_is_branch_b=true" +
                "|alternate_wal_pre_recovery_is_branch_a=true" +
                "|recovery_head_matches_branch_b_control=true" +
                "|no_shm_at_mutation_pre_recovery=true" +
                "|parent_roots_retained_no_recursive_delete=true|authorizing=false"
        )
    }
}

private func cr09TestParentResultFrame(
    repetition: Int,
    order: CR09TestOrder,
    h0: String,
    hA: String,
    hB: String,
    sourceADigest: String,
    sourceBDigest: String,
    firstHead: String,
    secondHead: String
) -> String {
    "VERITAS_BASELINE_B_RESULT|case=CR-09|target=closed-sibling-fork" +
        "|repetition=\(repetition)|classification=LIMITATION_REPRODUCED" +
        "|outcome=BOTH_CLOSED_SIBLING_SUCCESSORS_ADMITTED_SEQUENTIALLY_" +
        "WITHOUT_PROTECTED_FORK_CHOICE|order=\(order.rawValue)|h0=\(h0)" +
        "|ha=\(hA)|hb=\(hB)|stored_predecessor_a=\(h0)" +
        "|stored_predecessor_b=\(h0)" +
        "|pristine_source_main_a_digest=\(sourceADigest)" +
        "|pristine_source_main_b_digest=\(sourceBDigest)" +
        "|first_head=\(firstHead)|second_head=\(secondHead)" +
        "|shared_predecessor=true|distinct_heads=true" +
        "|distinct_source_main_digests=true|branch_a_exact=true|branch_b_exact=true" +
        "|same_scope=true|same_canonical_project_path_within_order=true" +
        "|same_relative_path_shape_across_orders=true|all_children_reaped=true" +
        "|pristine_main_only_before_each_open=true" +
        "|no_live_handles_at_namespace_switches=true" +
        "|closed_projects_retired_intact=true|pristine_sources_unchanged=true" +
        "|parent_roots_retained_no_recursive_delete=true" +
        "|protected_authority_verified=false|authorizing=false"
}

private func cr09TestParentFieldValue(
    _ field: Substring,
    prefix: String
) -> String? {
    guard field.hasPrefix(prefix) else { return nil }
    return String(field.dropFirst(prefix.count))
}

private func cr09TestParseParentResult(_ frame: String) throws -> CR09TestParentResult {
    let fields = try cr09TestFrameFields(
        frame,
        maximumBytes: cr09TestMaximumParentFrameBytes
    )
    guard
        fields.count == 32,
        fields[0] == "VERITAS_BASELINE_B_RESULT",
        fields[1] == "case=CR-09",
        fields[2] == "target=closed-sibling-fork",
        let repetitionValue = cr09TestParentFieldValue(fields[3], prefix: "repetition="),
        let repetition = Int(repetitionValue),
        fields[4] == "classification=LIMITATION_REPRODUCED",
        fields[5]
            == "outcome=BOTH_CLOSED_SIBLING_SUCCESSORS_ADMITTED_SEQUENTIALLY_" +
                "WITHOUT_PROTECTED_FORK_CHOICE",
        let orderValue = cr09TestParentFieldValue(fields[6], prefix: "order="),
        let order = CR09TestOrder(rawValue: orderValue),
        repetitionValue == String(repetition),
        (order == .ab && repetitionValue == "0")
            || (order == .ba && repetitionValue == "1"),
        let h0 = cr09TestParentFieldValue(fields[7], prefix: "h0="),
        let hA = cr09TestParentFieldValue(fields[8], prefix: "ha="),
        let hB = cr09TestParentFieldValue(fields[9], prefix: "hb="),
        let predecessorA = cr09TestParentFieldValue(
            fields[10],
            prefix: "stored_predecessor_a="
        ),
        let predecessorB = cr09TestParentFieldValue(
            fields[11],
            prefix: "stored_predecessor_b="
        ),
        let sourceA = cr09TestParentFieldValue(
            fields[12],
            prefix: "pristine_source_main_a_digest="
        ),
        let sourceB = cr09TestParentFieldValue(
            fields[13],
            prefix: "pristine_source_main_b_digest="
        ),
        let firstHead = cr09TestParentFieldValue(fields[14], prefix: "first_head="),
        let secondHead = cr09TestParentFieldValue(fields[15], prefix: "second_head="),
        fields[16] == "shared_predecessor=true",
        fields[17] == "distinct_heads=true",
        fields[18] == "distinct_source_main_digests=true",
        fields[19] == "branch_a_exact=true",
        fields[20] == "branch_b_exact=true",
        fields[21] == "same_scope=true",
        fields[22] == "same_canonical_project_path_within_order=true",
        fields[23] == "same_relative_path_shape_across_orders=true",
        fields[24] == "all_children_reaped=true",
        fields[25] == "pristine_main_only_before_each_open=true",
        fields[26] == "no_live_handles_at_namespace_switches=true",
        fields[27] == "closed_projects_retired_intact=true",
        fields[28] == "pristine_sources_unchanged=true",
        fields[29] == "parent_roots_retained_no_recursive_delete=true",
        fields[30] == "protected_authority_verified=false",
        fields[31] == "authorizing=false",
        [h0, hA, hB, predecessorA, predecessorB, sourceA, sourceB, firstHead, secondHead]
            .allSatisfy(coherentReplacementB2IsDigest),
        predecessorA == h0,
        predecessorB == h0
    else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "A CR-09 parent result frame was malformed, misordered, or internally inconsistent."
        )
    }
    return CR09TestParentResult(
        repetition: repetition,
        order: order,
        h0: h0,
        hA: hA,
        hB: hB,
        sourceADigest: sourceA,
        sourceBDigest: sourceB,
        firstHead: firstHead,
        secondHead: secondHead
    )
}

private func cr09TestValidateParentPair(
    _ ab: CR09TestParentResult,
    _ ba: CR09TestParentResult
) throws {
    guard
        ab.repetition == 0,
        ab.order == .ab,
        ba.repetition == 1,
        ba.order == .ba,
        ab.h0 == ba.h0,
        ab.hA == ba.hA,
        ab.hB == ba.hB,
        ab.sourceADigest == ba.sourceADigest,
        ab.sourceBDigest == ba.sourceBDigest,
        Set([ab.h0, ab.hA, ab.hB]).count == 3,
        ab.sourceADigest != ab.sourceBDigest,
        ab.firstHead == ab.hA,
        ab.secondHead == ab.hB,
        ba.firstHead == ba.hB,
        ba.secondHead == ba.hA
    else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "The two CR-09 parent result frames did not satisfy the exact AB/BA oracle."
        )
    }
}

private func cr09TestCustodyFrame(
    familyID: String,
    fixtures: [(role: String, fixture: CR09TestFixture)]
) throws -> String {
    let expectedRoles = [
        "p_builder", "p_source", "p_control",
        "a_builder", "b_builder", "a_source", "b_source",
        "a_control", "b_control", "order_ab", "order_ba",
    ]
    guard
        familyID.count == 32,
        familyID.utf8.allSatisfy({
            ($0 >= Character("0").asciiValue! && $0 <= Character("9").asciiValue!)
                || ($0 >= Character("a").asciiValue! && $0 <= Character("f").asciiValue!)
        }),
        fixtures.map({ $0.role }) == expectedRoles
    else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "The CR-09 custody family or role order was not exact."
        )
    }
    var fields = ["VERITAS_CR09_CUSTODY", "v1", "family=\(familyID)"]
    var paths = [String]()
    var rootIdentities = [String]()
    for item in fixtures {
        let path = item.fixture.root.path
        let expectedRole = item.role.replacingOccurrences(of: "_", with: "-")
        let expectedBasenamePrefix =
            "veritas-coherent-replacement-b3b-cr09-\(familyID)-\(expectedRole)-"
        let basename = item.fixture.root.lastPathComponent
        let uuidSuffix = String(basename.dropFirst(expectedBasenamePrefix.count))
        guard
            item.fixture.familyID == familyID,
            item.fixture.role == expectedRole,
            path.hasPrefix("/private/tmp/veritas-coherent-replacement-b3b-cr09-"),
            basename.hasPrefix(expectedBasenamePrefix),
            UUID(uuidString: uuidSuffix) != nil,
            !path.contains("|"),
            !path.contains("\n"),
            !path.contains("\r"),
            !path.contains("\0")
        else {
            throw CoherentReplacementB2Failure.protocolViolation(
                "A CR-09 custody root was not safely frameable."
            )
        }
        paths.append(path)
        rootIdentities.append(
            "\(item.fixture.rootBinding.identity.device):" +
                "\(item.fixture.rootBinding.identity.inode)"
        )
        fields.append("\(item.role)=\(path)")
    }
    fields.append("authorizing=false")
    let frame = fields.joined(separator: "|")
    guard
        fields.count == 15,
        Set(paths).count == 11,
        Set(rootIdentities).count == 11,
        frame.utf8.count <= 4_096,
        frame.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
            == fields
    else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "The CR-09 custody frame exceeded its exact bound."
        )
    }
    return frame
}

private func cr09TestBindingFrame(
    familyID: String,
    executable: CoherentReplacementB2ExecutableAdmission,
    pSourceDigest: String,
    aSourceDigest: String,
    bSourceDigest: String,
    children: [(role: String, pid: Int32)],
    fixtures: [(role: String, fixture: CR09TestFixture)]
) throws -> String {
    let expectedChildRoles = [
        "p_builder", "p_control", "a_builder", "b_builder",
        "a_control", "b_control", "ab_first", "ab_second",
        "ba_first", "ba_second",
    ]
    let expectedFixtureRoles = [
        "p_builder", "p_source", "p_control",
        "a_builder", "b_builder", "a_source", "b_source",
        "a_control", "b_control", "order_ab", "order_ba",
    ]
    guard
        familyID.count == 32,
        familyID.utf8.allSatisfy({
            ($0 >= Character("0").asciiValue! && $0 <= Character("9").asciiValue!)
                || ($0 >= Character("a").asciiValue! && $0 <= Character("f").asciiValue!)
        }),
        coherentReplacementB2IsDigest(executable.digest),
        [pSourceDigest, aSourceDigest, bSourceDigest]
            .allSatisfy(coherentReplacementB2IsDigest),
        children.map({ $0.role }) == expectedChildRoles,
        children.allSatisfy({ $0.pid > 0 }),
        Set(children.map({ $0.pid })).count == expectedChildRoles.count,
        fixtures.map({ $0.role }) == expectedFixtureRoles
    else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "The CR-09 helper, source, child, or fixture binding was not exact."
        )
    }

    var fields = [
        "VERITAS_CR09_BINDING",
        "v1",
        "family=\(familyID)",
        "helper_binary_sha256=\(executable.digest)",
        "p_source_main_digest=\(pSourceDigest)",
        "a_source_main_digest=\(aSourceDigest)",
        "b_source_main_digest=\(bSourceDigest)",
    ]
    for child in children {
        fields.append("\(child.role)_pid=\(child.pid)")
    }
    var identities = [String]()
    for item in fixtures {
        let identity =
            "\(item.fixture.rootBinding.identity.device):" +
            "\(item.fixture.rootBinding.identity.inode)"
        identities.append(identity)
        fields.append("\(item.role)_identity=\(identity)")
    }
    fields.append("authorizing=false")
    let frame = fields.joined(separator: "|")
    guard
        fields.count == 29,
        Set(identities).count == expectedFixtureRoles.count,
        frame.utf8.count + 1 <= 4_096,
        frame.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
            == fields
    else {
        throw CoherentReplacementB2Failure.protocolViolation(
            "The CR-09 binding frame exceeded its exact contract."
        )
    }
    return frame
}

@Suite("Founder Alpha coherent replacement Baseline B3C closed sibling fork", .serialized)
struct LocalIncidentLedgerCoherentReplacementBaselineB3CTests {
    @Test("CR-09 exact closed sibling successors are admitted in AB and BA order")
    func closedSiblingForkBothOrders() throws {
        try cr09TestVerifyFrozenConstants()
        try cr09TestParserSelfCheck()
        let executable = try coherentReplacementB2ProbeExecutable()
        let familyID = cr09TestCompactUUID()
        var fixtures = [CR09TestFixture]()
        defer {
            for fixture in fixtures {
                fixture.custody.removeIfSafe()
            }
        }

        let pBuilder = try CR09TestFixture(familyID: familyID, role: "p-builder")
        fixtures.append(pBuilder)
        let pBuild = try cr09TestRunBuild(
            executable: executable,
            fixture: pBuilder,
            node: .p,
            expectedInputHead: "GENESIS"
        )
        let h0 = pBuild.head
        guard
            pBuild.predecessor == cr09TestGenesisDigest,
            coherentReplacementB2IsDigest(h0)
        else {
            throw CoherentReplacementB2Failure.unexpected(
                "CR-09 did not freeze an exact predecessor head."
            )
        }
        let pBuilderManifest = try cr09TestValidatedCanonicalManifest(pBuilder)
        let pBuilderMain = try cr09TestCanonicalSnapshot(pBuilder, requireMainOnly: false)

        let pSourceFixture = try CR09TestFixture(familyID: familyID, role: "p-source")
        fixtures.append(pSourceFixture)
        let pSource = try cr09TestPopulateMainOnlyFixture(
            pSourceFixture,
            mainBytes: pBuilderMain.bytes
        )
        _ = try cr09TestValidateFixture(
            pSourceFixture,
            expectedProjects: [cr09TestProjectDigest],
            mainOnlyProjects: [cr09TestProjectDigest]
        )

        let pControlFixture = try CR09TestFixture(familyID: familyID, role: "p-control")
        fixtures.append(pControlFixture)
        let pControlInput = try cr09TestPopulateMainOnlyFixture(
            pControlFixture,
            mainBytes: pSource.snapshot.bytes
        )
        let pControl = try cr09TestRunControl(
            executable: executable,
            fixture: pControlFixture,
            node: .p,
            expectedH0: h0,
            expectedHead: h0,
            sourceDigest: pControlInput.snapshot.state.digest
        )
        let pControlManifest = try cr09TestValidatedCanonicalManifest(pControlFixture)

        let aBuilderFixture = try CR09TestFixture(familyID: familyID, role: "a-builder")
        fixtures.append(aBuilderFixture)
        let aBuilderInput = try cr09TestPopulateMainOnlyFixture(
            aBuilderFixture,
            mainBytes: pSource.snapshot.bytes
        )
        let aBuild = try cr09TestRunBuild(
            executable: executable,
            fixture: aBuilderFixture,
            node: .a,
            expectedInputHead: h0
        )
        let hA = aBuild.head
        let aBuilderManifest = try cr09TestValidatedCanonicalManifest(aBuilderFixture)
        let aBuilderMain = try cr09TestCanonicalSnapshot(
            aBuilderFixture,
            requireMainOnly: false
        )

        let bBuilderFixture = try CR09TestFixture(familyID: familyID, role: "b-builder")
        fixtures.append(bBuilderFixture)
        let bBuilderInput = try cr09TestPopulateMainOnlyFixture(
            bBuilderFixture,
            mainBytes: pSource.snapshot.bytes
        )
        let bBuild = try cr09TestRunBuild(
            executable: executable,
            fixture: bBuilderFixture,
            node: .b,
            expectedInputHead: h0
        )
        let hB = bBuild.head
        let bBuilderManifest = try cr09TestValidatedCanonicalManifest(bBuilderFixture)
        let bBuilderMain = try cr09TestCanonicalSnapshot(
            bBuilderFixture,
            requireMainOnly: false
        )

        guard
            pControl.h0 == h0,
            pControl.head == h0,
            aBuild.predecessor == h0,
            bBuild.predecessor == h0,
            coherentReplacementB2IsDigest(hA),
            coherentReplacementB2IsDigest(hB),
            Set([h0, hA, hB]).count == 3,
            aBuilderInput.snapshot.state.digest == pSource.snapshot.state.digest,
            bBuilderInput.snapshot.state.digest == pSource.snapshot.state.digest,
            aBuilderInput.snapshot.state.identity != bBuilderInput.snapshot.state.identity,
            aBuilderInput.snapshot.state.identity != pSource.snapshot.state.identity,
            bBuilderInput.snapshot.state.identity != pSource.snapshot.state.identity,
            aBuilderMain.bytes != bBuilderMain.bytes,
            aBuilderMain.state.digest != bBuilderMain.state.digest
        else {
            throw CoherentReplacementB2Failure.unexpected(
                "CR-09 sibling builders did not remain independent and divergent."
            )
        }

        let aSourceFixture = try CR09TestFixture(familyID: familyID, role: "a-source")
        fixtures.append(aSourceFixture)
        let aSource = try cr09TestPopulateMainOnlyFixture(
            aSourceFixture,
            mainBytes: aBuilderMain.bytes
        )
        let bSourceFixture = try CR09TestFixture(familyID: familyID, role: "b-source")
        fixtures.append(bSourceFixture)
        let bSource = try cr09TestPopulateMainOnlyFixture(
            bSourceFixture,
            mainBytes: bBuilderMain.bytes
        )
        guard
            pSource.snapshot.state.identity != pBuilderMain.state.identity,
            pSource.snapshot.state.byteCount == pBuilderMain.state.byteCount,
            pSource.snapshot.state.digest == pBuilderMain.state.digest,
            pSource.snapshot.bytes == pBuilderMain.bytes,
            aSource.snapshot.state.identity != aBuilderMain.state.identity,
            aSource.snapshot.state.byteCount == aBuilderMain.state.byteCount,
            aSource.snapshot.state.digest == aBuilderMain.state.digest,
            aSource.snapshot.bytes == aBuilderMain.bytes,
            bSource.snapshot.state.identity != bBuilderMain.state.identity,
            bSource.snapshot.state.byteCount == bBuilderMain.state.byteCount,
            bSource.snapshot.state.digest == bBuilderMain.state.digest,
            bSource.snapshot.bytes == bBuilderMain.bytes,
            aSource.snapshot.state.digest != bSource.snapshot.state.digest,
            aSource.snapshot.state.identity != bSource.snapshot.state.identity
        else {
            throw CoherentReplacementB2Failure.unexpected(
                "CR-09 pristine sibling sources were not distinct."
            )
        }

        let aControlFixture = try CR09TestFixture(familyID: familyID, role: "a-control")
        fixtures.append(aControlFixture)
        let aControlInput = try cr09TestPopulateMainOnlyFixture(
            aControlFixture,
            mainBytes: aSource.snapshot.bytes
        )
        let aControl = try cr09TestRunControl(
            executable: executable,
            fixture: aControlFixture,
            node: .a,
            expectedH0: h0,
            expectedHead: hA,
            sourceDigest: aControlInput.snapshot.state.digest
        )
        let aControlManifest = try cr09TestValidatedCanonicalManifest(aControlFixture)
        let bControlFixture = try CR09TestFixture(familyID: familyID, role: "b-control")
        fixtures.append(bControlFixture)
        let bControlInput = try cr09TestPopulateMainOnlyFixture(
            bControlFixture,
            mainBytes: bSource.snapshot.bytes
        )
        let bControl = try cr09TestRunControl(
            executable: executable,
            fixture: bControlFixture,
            node: .b,
            expectedH0: h0,
            expectedHead: hB,
            sourceDigest: bControlInput.snapshot.state.digest
        )
        let bControlManifest = try cr09TestValidatedCanonicalManifest(bControlFixture)
        guard
            aControl.predecessor == h0,
            bControl.predecessor == h0,
            aControl.head == hA,
            bControl.head == hB
        else {
            throw CoherentReplacementB2Failure.unexpected(
                "CR-09 source controls did not preserve both exact sibling chains."
            )
        }

        let abFixture = try CR09TestFixture(familyID: familyID, role: "order-ab")
        fixtures.append(abFixture)
        let ab = try cr09TestRunOrder(
            executable: executable,
            fixture: abFixture,
            repetition: 0,
            order: .ab,
            firstBranch: .a,
            firstSource: aSource,
            firstHead: hA,
            secondBranch: .b,
            secondSource: bSource,
            secondHead: hB,
            h0: h0
        )
        let baFixture = try CR09TestFixture(familyID: familyID, role: "order-ba")
        fixtures.append(baFixture)
        let ba = try cr09TestRunOrder(
            executable: executable,
            fixture: baFixture,
            repetition: 1,
            order: .ba,
            firstBranch: .b,
            firstSource: bSource,
            firstHead: hB,
            secondBranch: .a,
            secondSource: aSource,
            secondHead: hA,
            h0: h0
        )

        for (fixture, frozenManifest) in [
            (pBuilder, pBuilderManifest),
            (aBuilderFixture, aBuilderManifest),
            (bBuilderFixture, bBuilderManifest),
            (pControlFixture, pControlManifest),
            (aControlFixture, aControlManifest),
            (bControlFixture, bControlManifest),
        ] {
            let currentManifest = try cr09TestValidatedCanonicalManifest(fixture)
            guard cr09TestManifestsEqual(currentManifest, frozenManifest) else {
                throw CoherentReplacementB2Failure.unexpected(
                    "A CR-09 builder or control changed after its post-child freeze."
                )
            }
        }
        for source in [pSource, aSource, bSource] {
            let currentManifest = try cr09TestValidatedCanonicalManifest(
                source.fixture,
                requireMainOnly: true
            )
            let current = try cr09TestCanonicalSnapshot(
                source.fixture,
                requireMainOnly: true
            )
            guard
                cr09TestManifestsEqual(currentManifest, source.manifest),
                current.state.identity == source.snapshot.state.identity,
                current.state.byteCount == source.snapshot.state.byteCount,
                current.state.digest == source.snapshot.state.digest,
                current.bytes == source.snapshot.bytes
            else {
                throw CoherentReplacementB2Failure.unexpected(
                    "A CR-09 pristine source changed after presentation."
                )
            }
        }
        let finalABManifests = try cr09TestValidateFixture(
            ab.fixture,
            expectedProjects: [cr09TestProjectDigest, ab.retiredName]
        )
        let finalBAManifests = try cr09TestValidateFixture(
            ba.fixture,
            expectedProjects: [cr09TestProjectDigest, ba.retiredName]
        )
        guard
            let finalABRetired = finalABManifests[ab.retiredName],
            let finalABCanonical = finalABManifests[cr09TestProjectDigest],
            let finalBARetired = finalBAManifests[ba.retiredName],
            let finalBACanonical = finalBAManifests[cr09TestProjectDigest]
        else {
            throw CoherentReplacementB2Failure.unexpected(
                "A CR-09 final order manifest was missing."
            )
        }
        guard
            ab.fixture.projectsBinding?.identity == ab.projectsBinding.identity,
            ab.fixture.projectsBinding?.permissions == ab.projectsBinding.permissions,
            ba.fixture.projectsBinding?.identity == ba.projectsBinding.identity,
            ba.fixture.projectsBinding?.permissions == ba.projectsBinding.permissions,
            cr09TestManifestsEqual(finalABRetired, ab.retiredManifest),
            cr09TestManifestsEqual(finalABCanonical, ab.canonicalManifest),
            cr09TestManifestsEqual(finalBARetired, ba.retiredManifest),
            cr09TestManifestsEqual(finalBACanonical, ba.canonicalManifest),
            fixtures.count == 11,
            fixtures.allSatisfy({ FileManager.default.fileExists(atPath: $0.root.path) }),
            pBuilder.temporaryDirectoryNames.count == 1,
            aBuilderFixture.temporaryDirectoryNames.count == 1,
            bBuilderFixture.temporaryDirectoryNames.count == 1,
            pControlFixture.temporaryDirectoryNames.count == 1,
            aControlFixture.temporaryDirectoryNames.count == 1,
            bControlFixture.temporaryDirectoryNames.count == 1,
            pSourceFixture.temporaryDirectoryNames.isEmpty,
            aSourceFixture.temporaryDirectoryNames.isEmpty,
            bSourceFixture.temporaryDirectoryNames.isEmpty,
            abFixture.temporaryDirectoryNames.count == 2,
            baFixture.temporaryDirectoryNames.count == 2,
            ab.firstHead == hA,
            ab.secondHead == hB,
            ba.firstHead == hB,
            ba.secondHead == hA
        else {
            throw CoherentReplacementB2Failure.unexpected(
                "CR-09 final custody or cross-order state was not exact."
            )
        }

        let custodyFixtures = [
            ("p_builder", pBuilder),
            ("p_source", pSourceFixture),
            ("p_control", pControlFixture),
            ("a_builder", aBuilderFixture),
            ("b_builder", bBuilderFixture),
            ("a_source", aSourceFixture),
            ("b_source", bSourceFixture),
            ("a_control", aControlFixture),
            ("b_control", bControlFixture),
            ("order_ab", abFixture),
            ("order_ba", baFixture),
        ]
        let custodyFrame = try cr09TestCustodyFrame(
            familyID: familyID,
            fixtures: custodyFixtures
        )
        try coherentReplacementB2RevalidateProbeExecutable(executable)
        let bindingFrame = try cr09TestBindingFrame(
            familyID: familyID,
            executable: executable,
            pSourceDigest: pSource.snapshot.state.digest,
            aSourceDigest: aSource.snapshot.state.digest,
            bSourceDigest: bSource.snapshot.state.digest,
            children: [
                ("p_builder", pBuild.pid),
                ("p_control", pControl.pid),
                ("a_builder", aBuild.pid),
                ("b_builder", bBuild.pid),
                ("a_control", aControl.pid),
                ("b_control", bControl.pid),
                ("ab_first", ab.firstPID),
                ("ab_second", ab.secondPID),
                ("ba_first", ba.firstPID),
                ("ba_second", ba.secondPID),
            ],
            fixtures: custodyFixtures
        )
        let abFrame = cr09TestParentResultFrame(
            repetition: 0,
            order: .ab,
            h0: h0,
            hA: hA,
            hB: hB,
            sourceADigest: aSource.snapshot.state.digest,
            sourceBDigest: bSource.snapshot.state.digest,
            firstHead: ab.firstHead,
            secondHead: ab.secondHead
        )
        let baFrame = cr09TestParentResultFrame(
            repetition: 1,
            order: .ba,
            h0: h0,
            hA: hA,
            hB: hB,
            sourceADigest: aSource.snapshot.state.digest,
            sourceBDigest: bSource.snapshot.state.digest,
            firstHead: ba.firstHead,
            secondHead: ba.secondHead
        )
        let parsedAB = try cr09TestParseParentResult(abFrame + "\n")
        let parsedBA = try cr09TestParseParentResult(baFrame + "\n")
        try cr09TestValidateParentPair(parsedAB, parsedBA)
        guard
            parsedAB.h0 == h0,
            parsedAB.hA == hA,
            parsedAB.hB == hB,
            parsedAB.sourceADigest == aSource.snapshot.state.digest,
            parsedAB.sourceBDigest == bSource.snapshot.state.digest,
            parsedBA.h0 == h0,
            parsedBA.hA == hA,
            parsedBA.hB == hB,
            parsedBA.sourceADigest == aSource.snapshot.state.digest,
            parsedBA.sourceBDigest == bSource.snapshot.state.digest
        else {
            throw CoherentReplacementB2Failure.protocolViolation(
                "The CR-09 parent result pair drifted from the frozen run state."
            )
        }
        MachineEvidence.record(custodyFrame)
        MachineEvidence.record(bindingFrame)
        MachineEvidence.record(abFrame)
        MachineEvidence.record(baFrame)
    }
}
