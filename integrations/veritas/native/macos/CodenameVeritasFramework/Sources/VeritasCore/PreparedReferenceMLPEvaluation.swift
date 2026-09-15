import CryptoKit
import Foundation

// Internal reference computation only. Identifies bytes, not provenance or permission.
// No lookup by name, app/graph admission, persistence, learning or model promotion.
struct PreparedReferenceMLPEvaluation: Sendable {
    enum Failure: Error, Equatable, Sendable {
        case invalidScopeID, invalidRunID, malformedModelDigest, malformedInputDigest
        case modelDigestMismatch, inputByteCountMismatch, inputDigestMismatch, inputNonfinite
        case malformedContextDigest
    }

    let scopeID: String
    let runID: String
    let modelSHA256: String
    let inputSHA256: String
    let preparedSHA256: String
    let contextSHA256: String?
    let shape: ReferenceMLP.Shape
    private let model: ReferenceMLP
    private let input: [Float]

    struct Result: Sendable {
        let scopeID: String
        let runID: String
        let modelSHA256: String
        let inputSHA256: String
        let preparedSHA256: String
        let outputWidth: Int
        let outputBytes: Data
        let outputSHA256: String
        let resultSHA256: String
        let contextSHA256: String?
        var authoritative: Bool { false }

        // Suppress a module-visible synthesized initializer. Only this file constructs results.
        fileprivate init(prepared: PreparedReferenceMLPEvaluation, outputBytes: Data) {
            scopeID = prepared.scopeID
            runID = prepared.runID
            modelSHA256 = prepared.modelSHA256
            inputSHA256 = prepared.inputSHA256
            preparedSHA256 = prepared.preparedSHA256
            outputWidth = prepared.shape.output
            self.outputBytes = outputBytes
            outputSHA256 = PreparedReferenceMLPEvaluation.digest(outputBytes)
            contextSHA256 = prepared.contextSHA256
            let version = contextSHA256 == nil ? "v1" : "v2"
            let contextFrame = contextSHA256.map { "context=\($0)\0" } ?? ""
            let frame = "veritas/bn02/evaluation-result/\(version)\0" +
                "scope=\(scopeID)\0run=\(runID)\0prepared=\(preparedSHA256)\0" +
                "model=\(modelSHA256)\0shape=\(outputWidth)\0" +
                "input=\(inputSHA256)\0output=\(outputSHA256)\0" + contextFrame
            var identity = SHA256()
            identity.update(data: Data(frame.utf8))
            identity.update(data: outputBytes)
            resultSHA256 = identity.finalize().map { String(format: "%02x", $0) }.joined()
        }
    }

    init(
        model: ReferenceMLP, scopeID: String, runID: String, inputBytes: Data,
        expectedModelSHA256: String, expectedInputSHA256: String, contextSHA256: String? = nil
    ) throws {
        // Fixed precedence; bound UTF-8 inspection before scanning characters.
        guard Self.validID(scopeID) else { throw Failure.invalidScopeID }
        guard Self.validID(runID) else { throw Failure.invalidRunID }
        guard Self.validDigest(expectedModelSHA256) else { throw Failure.malformedModelDigest }
        guard Self.validDigest(expectedInputSHA256) else { throw Failure.malformedInputDigest }
        if let contextSHA256, !Self.validDigest(contextSHA256) { throw Failure.malformedContextDigest }
        guard expectedModelSHA256 == model.modelSHA256 else { throw Failure.modelDigestMismatch }
        // Shape is already checked by ReferenceMLP, including its <=4096 widths.
        let byteCount = model.shape.input.multipliedReportingOverflow(by: 4)
        guard !byteCount.overflow, inputBytes.count == byteCount.partialValue
        else { throw Failure.inputByteCountMismatch }

        // Caller must not race mutation against this synchronous copy. Hash and
        // decode the SAME owned bytes, never the caller's mutable external buffer.
        let owned = [UInt8](inputBytes)
        let inputDigest = Self.digest(Data(owned))
        guard expectedInputSHA256 == inputDigest else { throw Failure.inputDigestMismatch }
        var decoded: [Float] = []
        decoded.reserveCapacity(model.shape.input)
        for offset in stride(from: 0, to: owned.count, by: 4) {
            let bits = UInt32(owned[offset]) | (UInt32(owned[offset + 1]) << 8)
                | (UInt32(owned[offset + 2]) << 16) | (UInt32(owned[offset + 3]) << 24)
            let value = Float(bitPattern: bits)
            guard value.isFinite else { throw Failure.inputNonfinite }
            decoded.append(value)
        }
        self.model = model
        self.input = decoded
        self.scopeID = scopeID
        self.runID = runID
        self.modelSHA256 = model.modelSHA256
        self.inputSHA256 = inputDigest
        self.shape = model.shape
        self.contextSHA256 = contextSHA256
        // v1 remains byte-identical when context is absent. v2 records extra identity,
        // not source permission, freshness, runtime attestation or execution authority.
        let version = contextSHA256 == nil ? "v1" : "v2"
        let contextFrame = contextSHA256.map { "context=\($0)\0" } ?? ""
        let frame = "veritas/bn02/prepared-evaluation/\(version)\0" +
            "scope=\(scopeID)\0run=\(runID)\0model=\(model.modelSHA256)\0" +
            "shape=\(model.shape.input):\(model.shape.hidden):\(model.shape.output)\0" +
            "input=\(inputDigest)\0" + contextFrame
        var identity = SHA256()
        identity.update(data: Data(frame.utf8))
        identity.update(data: owned)
        preparedSHA256 = identity.finalize().map { String(format: "%02x", $0) }.joined()
    }

    func evaluate(deadline: ContinuousClock.Instant) throws -> Result {
        let values = try model.evaluate(input, deadline: deadline)
        var bytes = Data()
        bytes.reserveCapacity(shape.output * 4)
        for value in values {
            let bits = value.bitPattern
            for shift in [0, 8, 16, 24] {
                bytes.append(UInt8(truncatingIfNeeded: bits >> shift))
            }
        }
        let result = Result(prepared: self, outputBytes: bytes)
        // Include encoding and hashing in the cooperative deadline, not just inference.
        try Self.requireCompletionBeforeDeadline(ContinuousClock().now, deadline: deadline)
        return result
    }

    // Pure boundary predicate for deterministic equality/expiry tests. It cannot
    // construct results or inject a clock into the real evaluate path.
    static func requireCompletionBeforeDeadline(
        _ completedAt: ContinuousClock.Instant, deadline: ContinuousClock.Instant
    ) throws {
        guard completedAt < deadline else { throw ReferenceMLP.Failure.deadlineExceeded }
    }

    private static func validID(_ text: String) -> Bool {
        let bytes = Array(text.utf8.prefix(97))
        guard !bytes.isEmpty, bytes.count <= 96, (97...122).contains(bytes[0]) else { return false }
        return bytes.dropFirst().allSatisfy {
            (97...122).contains($0) || (48...57).contains($0) || $0 == 95 || $0 == 46 || $0 == 45
        }
    }

    private static func validDigest(_ text: String) -> Bool {
        let bytes = Array(text.utf8.prefix(65))
        return bytes.count == 64 && bytes.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    private static func digest(_ bytes: Data) -> String {
        SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }
}
