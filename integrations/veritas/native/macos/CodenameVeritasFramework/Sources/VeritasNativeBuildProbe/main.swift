import Foundation
import Darwin
import VeritasCore

// Private synthetic process experiment, not an installed app or approval service.
@main @MainActor struct VeritasNativeBuildProbe {
    static func main() async {
#if DEBUG
        do {
            let args = Array(CommandLine.arguments.dropFirst())
            guard args == ["observe"] || (args.count == 3 && ["verify", "run"].contains(args[0])) else {
                throw ProbeFailure.arguments
            }
            var output: [String: Any] = ["authorizing": false, "productionAdmission": false]
            if args[0] == "observe" {
                let observation = try NativeBuildAdmission.observeCurrent()
                output["cdhash"] = observation.cdhash; output["identifier"] = observation.identifier
                output["flags"] = observation.flags; output["entitlementsSHA256"] = observation.entitlementsSHA256
                output["status"] = "OBSERVED_ONLY"
            } else {
                let envelope = try boundedFile(args[1], maximum: 2_048)
                let key = try boundedFile(args[2], maximum: 32)
                let time = Date().timeIntervalSince1970 * 1_000
                guard time.isFinite, time >= 0, time < Double(UInt64.max) else { throw ProbeFailure.clock }
                let admission = try NativeBuildAdmission.forSignedFixture(envelope, publicKey: key, nowMilliseconds: UInt64(time))
                output["buildAdmissionReceiptSHA256"] = admission.receiptSHA256
                output["status"] = "MATCHED_TEST_AUTHORITY_ONLY"
                if args[0] == "run" {
                    let owner = try ReferenceArtifactShadowRunOwner.forAdmittedBuildTests(admission)
                    do {
                        let snapshot = ArtifactSnapshot(displayName: "Synthetic fixture", kind: .text, bytes: Data("reference".utf8))
                        let lease = try owner.bindSelection(snapshot, profile: .prototype, hostEpoch: 1)
                        let token = try owner.authorizeLocalReferenceOnce(lease, deadline: .now.advanced(by: .milliseconds(900)))
                        let result = try await owner.result(for: owner.begin(token))
                        output["outputSHA256"] = result.outputSHA256
                        output["deliveryBuildReceiptSHA256"] = result.buildAdmissionReceiptSHA256
                        output["status"] = "REFERENCE_RAN_UNDER_TEST_AUTHORITY_ONLY"
                    } catch { await owner.revokeAndJoin(); throw error }
                    await owner.revokeAndJoin()
                }
            }
            let bytes = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
            FileHandle.standardOutput.write(bytes + Data([10]))
        } catch {
            // Closed error categories only; never echo input/key/envelope bytes.
            let category: String
            if let failure = error as? NativeBuildAdmission.Failure { category = String(describing: failure) }
            else if let failure = error as? ReferenceArtifactShadowRunOwner.Failure { category = String(describing: failure) }
            else { category = "probeInputOrRuntimeFailure" }
            print("{\"authorizing\":false,\"status\":\"REFUSED\",\"reason\":\"\(category)\"}")
            exit(2)
        }
#else
        print("{\"authorizing\":false,\"status\":\"DEBUG_FIXTURE_UNAVAILABLE\"}")
        exit(2)
#endif
    }
    enum ProbeFailure: Error { case arguments, byteCount, clock, inputFile }
    private static func boundedFile(_ path: String, maximum: Int) throws -> Data {
        // Diagnostic fixture policy: current-user, single-link regular files.
        // Never follow a final symlink or wait on a FIFO/device. These checks are
        // input hygiene, not protected custody; the signed bytes still decide.
        let descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK)
        guard descriptor >= 0 else { throw ProbeFailure.inputFile }
        defer { close(descriptor) }
        var before = stat()
        guard fstat(descriptor, &before) == 0, (before.st_mode & S_IFMT) == S_IFREG,
              before.st_uid == geteuid(), before.st_nlink == 1,
              before.st_size > 0, before.st_size <= maximum else { throw ProbeFailure.inputFile }
        var bytes = [UInt8](repeating: 0, count: Int(before.st_size))
        var offset = 0
        while offset < bytes.count {
            let remaining = bytes.count - offset
            let count = bytes.withUnsafeMutableBytes {
                pread(descriptor, $0.baseAddress!.advanced(by: offset), remaining, off_t(offset))
            }
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else { throw ProbeFailure.inputFile }
            offset += count
        }
        var after = stat()
        guard fstat(descriptor, &after) == 0,
              before.st_dev == after.st_dev, before.st_ino == after.st_ino,
              before.st_size == after.st_size, before.st_mode == after.st_mode,
              before.st_uid == after.st_uid, before.st_nlink == after.st_nlink,
              before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
              before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec,
              before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec,
              before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec
        else { throw ProbeFailure.inputFile }
        return Data(bytes)
    }
}
