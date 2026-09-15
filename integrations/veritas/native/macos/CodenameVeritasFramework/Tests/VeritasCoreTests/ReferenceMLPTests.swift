import CryptoKit
import Foundation
import Testing
@testable import VeritasCore

private let mlpOracleSHA256 = "5e6cec5bf961d0442ac90ade16fccfeb08b0d45858bea307f216334c7ba0dda0"
private let mlpOracleIDs = [
    "relu-positive", "relu-zero-input", "relu-negative-input", "multi-input-output",
    "separate-multiply-add", "bias-first-order", "relu-positive-zero", "finite-subnormal",
    "finite-underflow", "no-output-activation",
]
private struct MLPOracle: Decodable {
    let profile: String
    let oracleVersion: Int
    let comparison: String
    let weightLayout: String
    let cases: [MLPVector]
}
private struct MLPVector: Decodable {
    let id: String
    let shape: [Int]
    let weights: [String]
    let input: [String]
    let expected: [String]
}
private func mlpDigest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}
private func mlpBits(_ hex: String) throws -> UInt32 {
    try #require(UInt32(hex, radix: 16))
}
private func mlpBytes(_ values: [Float]) -> Data {
    var bytes = Data()
    for value in values {
        let bits = value.bitPattern
        for shift in [0, 8, 16, 24] { bytes.append(UInt8(truncatingIfNeeded: bits >> shift)) }
    }
    return bytes
}
private func mlpFixture() throws -> (Data, MLPOracle) {
    let url = try #require(Bundle.module.url(forResource: "reference-mlp-v1", withExtension: "json", subdirectory: "Fixtures"))
    let bytes = try Data(contentsOf: url)
    guard mlpDigest(bytes) == mlpOracleSHA256 else { throw CocoaError(.fileReadCorruptFile) }
    return (bytes, try JSONDecoder().decode(MLPOracle.self, from: bytes))
}
private func makeMLP(_ i: Int = 1, _ h: Int = 1, _ o: Int = 1, weights: [Float] = [1, 0, 1, 0]) throws -> ReferenceMLP {
    let bytes = mlpBytes(weights)
    return try ReferenceMLP(shape: .init(input: i, hidden: h, output: o), weightBytes: bytes, expectedWeightsSHA256: mlpDigest(bytes))
}
private func mlpDeadline() -> ContinuousClock.Instant { .now.advanced(by: .milliseconds(900)) }
private func mlpRefuses(_ expected: ReferenceMLP.Failure, _ operation: () throws -> Void) {
    do {
        try operation()
        Issue.record("Expected exact reference MLP refusal: \(expected)")
    } catch let failure as ReferenceMLP.Failure {
        #expect(failure == expected)
    } catch {
        Issue.record("Wrong error type instead of reference MLP refusal: \(error)")
    }
}

// This suite exercises real arithmetic only. It does not admit a plugin or prove
// learned quality, full BN-01/BN-02, app integration, authority or memory efficacy.
@Suite("BN-02 — Reference MLP arithmetic preparation")
struct ReferenceMLPTests {
    @Test("Oracle bytes, version and ten case identities are frozen")
    func oracleInventory() throws {
        let (bytes, oracle) = try mlpFixture()
        #expect(oracle.profile == "veritas-bn02-reference-mlp-prep-v1")
        #expect(oracle.oracleVersion == 1)
        #expect(oracle.comparison == "exact-binary32-output-bits")
        #expect(oracle.weightLayout == "little-endian-W1-row-major,b1,W2-row-major,b2")
        #expect(oracle.cases.map(\.id) == mlpOracleIDs)
        #expect(Set(oracle.cases.map(\.id)).count == 10)
        var altered = bytes
        altered.append(32)
        #expect(mlpDigest(altered) != mlpOracleSHA256)
    }

    @Test("Real forward results match independent exact-bit oracles and reject wrong arithmetic")
    func knownVectors() throws {
        let (_, oracle) = try mlpFixture()
        for vector in oracle.cases {
            let weights = try vector.weights.map { Float(bitPattern: try mlpBits($0)) }
            let input = try vector.input.map { Float(bitPattern: try mlpBits($0)) }
            let expected = try vector.expected.map(mlpBits)
            let kernel = try makeMLP(vector.shape[0], vector.shape[1], vector.shape[2], weights: weights)
            #expect(try kernel.evaluate(input, deadline: mlpDeadline()).map(\.bitPattern) == expected)
        }
        // Deliberately wrong implementations: the frozen oracle must distinguish them.
        let fused = Float(bitPattern: 0xbc941b90).addingProduct(
            Float(bitPattern: 0x3e1d89d9), Float(bitPattern: 0x3df0f0f1)
        )
        #expect(fused.bitPattern == 0x37a7c3e9)
        #expect(fused.bitPattern != 0x37a7c400)
        let wrongReduction: Float = Float(-16_777_216) + (Float(16_777_216) + Float(1))
        #expect(wrongReduction.bitPattern == Float(0).bitPattern)
        #expect(wrongReduction.bitPattern != Float(1).bitPattern)
    }

    @Test("Checked shape costs include exact parameter and output boundaries without allocation")
    func shapeCostAndBounds() throws {
        let small = try ReferenceMLP.Shape(input: 2, hidden: 2, output: 2)
        #expect(small.cost.parameterCount == 12)
        #expect(small.cost.weightBytes == 48)
        #expect(small.cost.scalarOperations == 18)
        #expect(small.cost.evaluationBufferBytes == 24)
        let boundary = try ReferenceMLP.Shape(input: 4095, hidden: 4095, output: 1)
        #expect(boundary.cost.parameterCount == 16_777_216)
        #expect(boundary.cost.weightBytes == 67_108_864)
        #expect(boundary.cost.scalarOperations == 33_550_335)
        #expect(boundary.cost.evaluationBufferBytes == 32_764)
        let outputBoundary = try ReferenceMLP.Shape(input: 1, hidden: 1, output: 4096)
        #expect(outputBoundary.output * 4 == 16_384)
        // No maximum-size weight buffer/inference/throughput claim from this shape-only test.
    }

    @Test("Invalid dimensions and exact one-over parameter count refuse before allocation")
    func shapeRefusals() {
        for invalid in [Int.min, -1, 0, 4097, Int.max] {
            mlpRefuses(.shapeOutOfBounds) { _ = try ReferenceMLP.Shape(input: invalid, hidden: 1, output: 1) }
            mlpRefuses(.shapeOutOfBounds) { _ = try ReferenceMLP.Shape(input: 1, hidden: invalid, output: 1) }
            mlpRefuses(.shapeOutOfBounds) { _ = try ReferenceMLP.Shape(input: 1, hidden: 1, output: invalid) }
        }
        mlpRefuses(.parameterLimitExceeded) { _ = try ReferenceMLP.Shape(input: 4094, hidden: 4096, output: 1) }
        mlpRefuses(.parameterLimitExceeded) { _ = try ReferenceMLP.Shape(input: 4096, hidden: 4096, output: 4096) }
    }

    @Test("Empty, short, trailing and misaligned byte lengths refuse before digest work")
    func weightLength() throws {
        let shape = try ReferenceMLP.Shape(input: 1, hidden: 1, output: 1)
        for count in [0, 1, 12, 15, 17, 20] {
            mlpRefuses(.weightByteCountMismatch) {
                _ = try ReferenceMLP(shape: shape, weightBytes: Data(repeating: 0, count: count), expectedWeightsSHA256: "invalid")
            }
        }
    }

    @Test("All parameter regions reject infinity and quiet or signaling NaN")
    func nonfiniteWeights() {
        for bits: UInt32 in [0x7f800000, 0xff800000, 0x7fc00000, 0x7f800001] {
            for index in 0..<4 {
                var weights: [Float] = [1, 0, 1, 0]
                weights[index] = Float(bitPattern: bits)
                mlpRefuses(.weightNonfinite) { _ = try makeMLP(weights: weights) }
            }
        }
    }

    @Test("Weight and shape identity are exact; hashes do not confer permission")
    func digestAndShapeBindings() throws {
        let shape = try ReferenceMLP.Shape(input: 1, hidden: 1, output: 1)
        let bytes = mlpBytes([1, 0, 1, 0])
        for invalid in ["", String(repeating: "a", count: 63), String(repeating: "a", count: 65), String(repeating: "G", count: 64), String(repeating: "A", count: 64)] {
            mlpRefuses(.malformedDigest) { _ = try ReferenceMLP(shape: shape, weightBytes: bytes, expectedWeightsSHA256: invalid) }
        }
        mlpRefuses(.weightDigestMismatch) { _ = try ReferenceMLP(shape: shape, weightBytes: bytes, expectedWeightsSHA256: String(repeating: "0", count: 64)) }
        var changed = bytes
        changed[0] = 1
        mlpRefuses(.weightDigestMismatch) { _ = try ReferenceMLP(shape: shape, weightBytes: changed, expectedWeightsSHA256: mlpDigest(bytes)) }
        var swapped = Data()
        for offset in stride(from: 0, to: bytes.count, by: 4) { swapped.append(contentsOf: bytes[offset..<offset + 4].reversed()) }
        mlpRefuses(.weightDigestMismatch) { _ = try ReferenceMLP(shape: shape, weightBytes: swapped, expectedWeightsSHA256: mlpDigest(bytes)) }
        let original = try makeMLP()
        // Independent Node Buffer.writeFloatLE + SHA-256 framing, not kernel-recorded values.
        #expect(original.weightsSHA256 == "5c0f50c6e283d64f560a7925aaed8b2540ff26747b986dbb10d97c7d4d19f5ee")
        #expect(original.modelSHA256 == "c6fe078f93379cad37ab4b338792bd3ff01989f5de6e09b83f0b5492d62dd271")
        let newBytes = try ReferenceMLP(shape: shape, weightBytes: changed, expectedWeightsSHA256: mlpDigest(changed))
        #expect(original.modelSHA256 != newBytes.modelSHA256)
        let shared: [Float] = [2, -3, -1, 1, 4, 5, -2]
        let a = try makeMLP(1, 2, 1, weights: shared)
        let b = try makeMLP(2, 1, 2, weights: shared)
        #expect(a.weightsSHA256 == b.weightsSHA256)
        #expect(a.modelSHA256 != b.modelSHA256)
    }

    @Test("Wrong input count and nonfinite input refuse before arithmetic")
    func inputRefusals() throws {
        let kernel = try makeMLP()
        for input: [Float] in [[], [1, 2]] {
            mlpRefuses(.inputCountMismatch) { _ = try kernel.evaluate(input, deadline: mlpDeadline()) }
        }
        for value: Float in [.infinity, -.infinity, .nan] {
            mlpRefuses(.inputNonfinite) { _ = try kernel.evaluate([value], deadline: mlpDeadline()) }
        }
    }

    @Test("Hidden and output product or accumulation overflow refuses all output")
    func intermediateOverflow() throws {
        let m = Float.greatestFiniteMagnitude
        let examples: [(Int, Int, Int, [Float], [Float])] = [
            (1, 1, 1, [2, 0, 1, 0], [m]),
            (2, 1, 1, [m, m, 0, 1, 0], [1, 1]),
            (1, 1, 1, [1, 0, 2, 0], [m]),
            (1, 2, 1, [1, 1, 0, 0, m, m, 0], [1]),
        ]
        for (i, h, o, weights, input) in examples {
            let kernel = try makeMLP(i, h, o, weights: weights)
            mlpRefuses(.intermediateNonfinite) { _ = try kernel.evaluate(input, deadline: mlpDeadline()) }
        }
    }

    @Test("Expired and unbounded future deadlines refuse")
    func deadlineRefusals() throws {
        let kernel = try makeMLP()
        mlpRefuses(.deadlineExceeded) { _ = try kernel.evaluate([1], deadline: .now.advanced(by: .seconds(-1))) }
        mlpRefuses(.deadlineOutOfRange) { _ = try kernel.evaluate([1], deadline: .now.advanced(by: .seconds(10))) }
    }

    @Test("Kernel owns weight values and repeats bit-identically after caller mutation")
    func ownershipAndRepeat() throws {
        let raw = mlpBytes([1, 0, 1, 0])
        let mutable = NSMutableData(data: raw)
        let borrowed = Data(bytesNoCopy: mutable.mutableBytes, count: mutable.length, deallocator: .none)
        let kernel = try ReferenceMLP(shape: .init(input: 1, hidden: 1, output: 1), weightBytes: borrowed, expectedWeightsSHA256: mlpDigest(raw))
        let identity = kernel.modelSHA256
        mutable.mutableBytes.storeBytes(of: Float(2).bitPattern.littleEndian, as: UInt32.self)
        #expect(mlpDigest(borrowed) != kernel.weightsSHA256)
        for _ in 0..<16 { #expect(try kernel.evaluate([3], deadline: mlpDeadline()) == [3]) }
        #expect(kernel.modelSHA256 == identity)
        #expect(kernel.weightsSHA256 == mlpDigest(raw))
        withExtendedLifetime(mutable) {}
    }

    @Test("Immutable kernel supports bounded concurrent read-only evaluations")
    func concurrentReads() async throws {
        let kernel = try makeMLP(1, 2, 1, weights: [2, -3, -1, 1, 4, 5, -2])
        let results = try await withThrowingTaskGroup(of: [UInt32].self) { group in
            for _ in 0..<8 { group.addTask { try kernel.evaluate([-1], deadline: mlpDeadline()).map(\.bitPattern) } }
            var outputs: [[UInt32]] = []
            for try await output in group { outputs.append(output) }
            return outputs
        }
        #expect(results.count == 8)
        #expect(results.allSatisfy { $0 == [0x41900000] })
    }
}
