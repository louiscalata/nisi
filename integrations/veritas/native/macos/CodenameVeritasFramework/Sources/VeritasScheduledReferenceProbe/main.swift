import Darwin
import Foundation
import VeritasCore

// Private fixed-input integration probe, deliberately not a product. Its pipe is
// NOT a production permission channel. Release builds cannot run this fixture.
@main @MainActor struct VeritasScheduledReferenceProbe {
    enum Refusal: Error { case frame, schema, identity, io, deadline }
    static let limit = 8_192
    static let domain = "veritas/scheduled-reference-probe/v1\0"

    static func canonical(_ value: [String: String]) throws -> Data {
        Data(try MAC1JSONV1.canonicalize(JSONEncoder().encode(value)).canonical.utf8)
    }
    static func fingerprint(_ bytes: Data) -> String {
        ArtifactSnapshot.digest(Data(domain.utf8) + bytes)
    }
    static func waitFor(_ fd: Int32, _ events: Int16, until: ContinuousClock.Instant) throws {
        while true {
            guard ContinuousClock().now < until else { throw Refusal.deadline }
            var item = pollfd(fd: fd, events: events, revents: 0)
            let result = poll(&item, 1, 50)
            if result < 0 && errno == EINTR { continue }
            guard result >= 0 else { throw Refusal.io }
            if result > 0 { return } // read/write classifies HUP/ERR safely.
        }
    }
    static func readExact(_ count: Int, until: ContinuousClock.Instant) throws -> Data {
        var bytes = [UInt8](repeating: 0, count: count), offset = 0
        while offset < count {
            try waitFor(STDIN_FILENO, Int16(POLLIN), until: until)
            let remaining = count - offset
            let n = bytes.withUnsafeMutableBytes { Darwin.read(STDIN_FILENO, $0.baseAddress!.advanced(by: offset), remaining) }
            if n < 0 && errno == EINTR { continue }
            guard n > 0 else { throw Refusal.io }
            offset += n
        }
        return Data(bytes)
    }
    static func readFrame(until: ContinuousClock.Instant) throws -> (Data, [String: String]) {
        let header = try readExact(4, until: until)
        let count = header.reduce(0) { ($0 << 8) | Int($1) }
        guard (1...limit).contains(count) else { throw Refusal.frame }
        let raw = try readExact(count, until: until)
        let normalized = try MAC1JSONV1.canonicalize(raw)
        guard Data(normalized.canonical.utf8) == raw else { throw Refusal.frame }
        return (raw, try JSONDecoder().decode([String: String].self, from: raw))
    }
    static func emit(_ value: [String: String], until: ContinuousClock.Instant) throws {
        let raw = try canonical(value)
        guard raw.count <= limit else { throw Refusal.frame }
        var length = UInt32(raw.count).bigEndian
        let header = withUnsafeBytes(of: &length) { Data($0) }
        let frame = header + raw
        var offset = 0
        while offset < frame.count {
            try waitFor(STDOUT_FILENO, Int16(POLLOUT), until: until)
            let n = frame.withUnsafeBytes { Darwin.write(STDOUT_FILENO, $0.baseAddress!.advanced(by: offset), frame.count - offset) }
            if n < 0 && errno == EINTR { continue }
            guard n > 0 else { throw Refusal.io }
            offset += n
        }
    }
    static func exactKeys(_ value: [String: String], _ keys: [String]) throws {
        guard Set(value.keys) == Set(keys) else { throw Refusal.schema }
    }
    static func hex(_ value: String?, count: Int = 64) -> Bool {
        guard let value else { return false }
        return value.utf8.count == count && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
    static func main() async {
        signal(SIGPIPE, SIG_IGN)
#if DEBUG
        var owner: ReferenceArtifactShadowRunOwner?
        let deadline = ContinuousClock().now.advanced(by: .seconds(10))
        do {
            guard Array(CommandLine.arguments.dropFirst()) == ["fixed-reference-v1"] else { throw Refusal.schema }
            let (raw, request) = try readFrame(until: deadline)
            try exactKeys(request, ["kind", "runID", "generation", "nonce", "fixture", "graphSHA256", "runSHA256", "topologySHA256", "planSHA256"])
            guard request["kind"] == "PREPARE_V1", request["generation"] == "1", request["fixture"] == "reference-text-prototype-v1",
                  hex(request["nonce"]), request["runID"] == "run." + request["nonce"]!,
                  ["graphSHA256", "runSHA256", "topologySHA256", "planSHA256"].allSatisfy({ hex(request[$0]) })
            else { throw Refusal.identity }
            let requestSHA = fingerprint(raw)
            let instance = try ReferenceArtifactShadowRunOwner.forIsolatedTests()
            owner = instance
            let snapshot = ArtifactSnapshot(displayName: "Fixed synthetic reference", kind: .text, bytes: Data("reference".utf8))
            let lease = try instance.bindSelection(snapshot, profile: .prototype, hostEpoch: 1)
            let review = try instance.reviewDescriptor(for: lease)
            let ready = ["kind": "READY_V1", "requestSHA256": requestSHA,
                "subjectSHA256": review.subjectSHA256, "profileID": review.profileID,
                "profileSHA256": review.profileSHA256, "packageSHA256": review.packageSHA256,
                "buildReceiptSHA256": review.buildReceiptSHA256, "declaredBytes": String(review.declaredBytes),
                "scalarOperations": String(review.scalarOperations), "taskSlots": String(review.taskSlots),
                "authority": "DEBUG_SYNTHETIC_ONLY", "execution": "NOT_BEGUN"]
            let readySHA = try fingerprint(canonical(ready))
            try emit(ready, until: deadline)
            let (goRaw, go) = try readFrame(until: deadline)
            try exactKeys(go, ["kind", "requestSHA256", "readySHA256", "runID", "permitID", "workSHA256", "windowIndex"])
            guard go["kind"] == "GO_V1", go["requestSHA256"] == requestSHA, go["readySHA256"] == readySHA,
                  go["runID"] == request["runID"], hex(go["workSHA256"]),
                  go["permitID"]?.hasPrefix("permit-") == true, hex(String(go["permitID"]!.dropFirst(7)), count: 16),
                  let window = Int(go["windowIndex"]!), window >= 0, window <= 9_007_199_254_740_991,
                  String(window) == go["windowIndex"] else { throw Refusal.identity }
            // Require EOF before execution: duplicate GO/trailing input cannot start work.
            try waitFor(STDIN_FILENO, Int16(POLLIN), until: deadline)
            var extra: UInt8 = 0
            guard Darwin.read(STDIN_FILENO, &extra, 1) == 0 else { throw Refusal.frame }
            let goSHA = fingerprint(goRaw)
            // The local test host creates its own opaque token; serialized GO is
            // only diagnostic coordination, not a decoded production consent.
            let token = try instance.authorizeLocalReferenceOnce(lease, deadline: .now.advanced(by: .milliseconds(900)))
            let ticket = try instance.begin(token)
            try emit(["kind": "BEGUN_V1", "goSHA256": goSHA, "authority": "DEBUG_SYNTHETIC_ONLY"], until: deadline)
            let delivery = try await instance.result(for: ticket)
            await instance.revokeAndJoin()
            guard instance.state == .unbound else { throw Refusal.identity }
            let result = ["kind": "RESULT_V1", "requestSHA256": requestSHA, "goSHA256": goSHA,
                "nativeRunID": delivery.runID, "subjectSHA256": delivery.subjectSHA256,
                "profileSHA256": delivery.profileSHA256, "hostEpoch": String(delivery.hostEpoch),
                "preparedSHA256": delivery.preparedSHA256, "contextSHA256": delivery.contextSHA256,
                "outputSHA256": delivery.outputSHA256, "resultSHA256": delivery.resultSHA256,
                "outputHex": delivery.outputBytes.map { String(format: "%02x", $0) }.joined(),
                "buildReceiptSHA256": delivery.buildAdmissionReceiptSHA256,
                "authority": "DEBUG_SYNTHETIC_ONLY", "cleanup": "JOINED_UNBOUND"]
            try emit(result, until: deadline)
        } catch {
            await owner?.revokeAndJoin()
            try? emit(["kind": "REFUSED_V1", "authority": "DEBUG_SYNTHETIC_ONLY"], until: deadline)
            exit(2)
        }
#else
        exit(2)
#endif
    }
}
