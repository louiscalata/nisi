import CryptoKit
import Foundation
import Testing
@testable import VeritasCore

private struct PreparedOracle: Decodable {
    let oracleVersion: Int
    let scopeID: String
    let runID: String
    let shape: [Int]
    let weightHex: String
    let weightsSHA256: String
    let modelSHA256: String
    let inputHex: String
    let inputSHA256: String
    let preparedSHA256: String
    let outputHex: String
    let outputSHA256: String
    let resultSHA256: String
}
private func preparedHash(_ bytes: Data) -> String {
    SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
}
private func preparedBytes(_ values: [Float]) -> Data {
    var bytes = Data()
    for value in values {
        for shift in [0, 8, 16, 24] {
            bytes.append(UInt8(truncatingIfNeeded: value.bitPattern >> shift))
        }
    }
    return bytes
}
private func preparedHex(_ text: String) throws -> Data {
    let characters = Array(text)
    try #require(characters.count.isMultiple(of: 2))
    var bytes = Data()
    for offset in stride(from: 0, to: characters.count, by: 2) {
        bytes.append(try #require(UInt8(String(characters[offset...offset + 1]), radix: 16)))
    }
    return bytes
}
private func preparedFixture() throws -> (Data, PreparedOracle) {
    let url = try #require(Bundle.module.url(forResource: "prepared-mlp-v1", withExtension: "json", subdirectory: "Fixtures"))
    let bytes = try Data(contentsOf: url)
    try #require(preparedHash(bytes) == "da4784cd6e96e1871088d91a57214765e512453141e58eaa3f169520077532c4")
    return (bytes, try JSONDecoder().decode(PreparedOracle.self, from: bytes))
}
private func preparedModel(
    _ weights: [Float] = [2, -3, -1, 1, 4, 5, -2], i: Int = 1, h: Int = 2, o: Int = 1
) throws -> ReferenceMLP {
    let bytes = preparedBytes(weights)
    return try ReferenceMLP(shape: .init(input: i, hidden: h, output: o), weightBytes: bytes, expectedWeightsSHA256: preparedHash(bytes))
}
private func preparedRun(
    _ model: ReferenceMLP, scope: String = "scope.test", run: String = "run.test",
    bytes: Data = preparedBytes([-1])
) throws -> PreparedReferenceMLPEvaluation {
    try PreparedReferenceMLPEvaluation(model: model, scopeID: scope, runID: run, inputBytes: bytes,
        expectedModelSHA256: model.modelSHA256, expectedInputSHA256: preparedHash(bytes))
}
private func preparedDeadline() -> ContinuousClock.Instant { .now.advanced(by: .milliseconds(900)) }
private func preparedRefuses(_ expected: PreparedReferenceMLPEvaluation.Failure, _ operation: () throws -> Void) {
    do { try operation(); Issue.record("Missing prepared-run refusal: \(expected)") }
    catch let error as PreparedReferenceMLPEvaluation.Failure { #expect(error == expected) }
    catch { Issue.record("Wrong prepared-run error: \(error)") }
}
private func preparedKernelRefuses(_ expected: ReferenceMLP.Failure, _ operation: () throws -> Void) {
    do { try operation(); Issue.record("Missing propagated kernel refusal: \(expected)") }
    catch let error as ReferenceMLP.Failure { #expect(error == expected) }
    catch { Issue.record("Wrong propagated kernel error: \(error)") }
}

// Native execution of a pinned reference computation; not admission or a durable audit receipt.
@Suite("BN-02 — Prepared reference model/input/result binding")
struct PreparedReferenceMLPEvaluationTests {
    @Test("Preimplementation fixture binds real inference and exact result bytes and identities")
    func frozenOracleAndRealOutput() throws {
        let (raw, oracle) = try preparedFixture()
        let json = try #require(JSONSerialization.jsonObject(with: raw) as? [String: Any])
        #expect(Set(json.keys) == Set(["oracleVersion", "scopeID", "runID", "shape", "weightHex", "weightsSHA256", "modelSHA256", "inputHex", "inputSHA256", "preparedSHA256", "outputHex", "outputSHA256", "resultSHA256"]))
        #expect(oracle.oracleVersion == 1)
        #expect(oracle.shape == [1, 2, 1])
        let weights = try preparedHex(oracle.weightHex)
        let model = try ReferenceMLP(shape: .init(input: 1, hidden: 2, output: 1), weightBytes: weights, expectedWeightsSHA256: oracle.weightsSHA256)
        let input = try preparedHex(oracle.inputHex)
        let prepared = try PreparedReferenceMLPEvaluation(model: model, scopeID: oracle.scopeID, runID: oracle.runID,
            inputBytes: input, expectedModelSHA256: oracle.modelSHA256, expectedInputSHA256: oracle.inputSHA256)
        let result = try prepared.evaluate(deadline: preparedDeadline())
        #expect(prepared.scopeID == "scope.test" && prepared.runID == "run.test")
        #expect(prepared.modelSHA256 == oracle.modelSHA256)
        #expect(prepared.inputSHA256 == oracle.inputSHA256)
        #expect(prepared.preparedSHA256 == oracle.preparedSHA256)
        #expect(result.outputBytes == (try preparedHex(oracle.outputHex)))
        #expect(result.outputBytes == preparedBytes([18]))
        #expect(result.outputSHA256 == oracle.outputSHA256)
        #expect(result.resultSHA256 == oracle.resultSHA256)
        #expect(result.scopeID == prepared.scopeID && result.runID == prepared.runID)
        #expect(result.modelSHA256 == prepared.modelSHA256 && result.inputSHA256 == prepared.inputSHA256)
        #expect(result.preparedSHA256 == prepared.preparedSHA256)
        #expect(result.outputWidth == 1 && !result.authoritative)
        #expect(preparedHash(raw + Data([32])) != preparedHash(raw))
    }

    @Test("IDs have exact ASCII grammar and 1 through 96 byte bounds")
    func identifierBoundaries() throws {
        let model = try preparedModel()
        for valid in ["a", "z0_a.b-c", String(repeating: "a", count: 96)] {
            let prepared = try preparedRun(model, scope: valid, run: valid)
            #expect(prepared.scopeID == valid && prepared.runID == valid)
        }
        for invalid in ["", "A", "0a", "a/b", "a b", "a\n", "a\0b", "é", "a🙂", String(repeating: "a", count: 97), String(repeating: "a", count: 1_000_000)] {
            preparedRefuses(.invalidScopeID) { _ = try preparedRun(model, scope: invalid) }
            preparedRefuses(.invalidRunID) { _ = try preparedRun(model, run: invalid) }
        }
    }

    @Test("Digest syntax is exactly 64 lowercase ASCII hexadecimal bytes")
    func digestBoundaries() throws {
        let model = try preparedModel(), bytes = preparedBytes([-1])
        let valid = preparedHash(bytes)
        for invalid in ["", String(repeating: "a", count: 63), String(repeating: "a", count: 65), String(repeating: "A", count: 64), String(repeating: "g", count: 64), String(repeating: "é", count: 32), String(repeating: "a", count: 63) + "\0", String(repeating: "a", count: 63) + "\n", String(repeating: "a", count: 1_000_000)] {
            preparedRefuses(.malformedModelDigest) {
                _ = try PreparedReferenceMLPEvaluation(model: model, scopeID: "s", runID: "r", inputBytes: bytes,
                    expectedModelSHA256: invalid, expectedInputSHA256: valid)
            }
            preparedRefuses(.malformedInputDigest) {
                _ = try PreparedReferenceMLPEvaluation(model: model, scopeID: "s", runID: "r", inputBytes: bytes,
                    expectedModelSHA256: model.modelSHA256, expectedInputSHA256: invalid)
            }
        }
    }

    @Test("Paired invalid arguments preserve all eight preparation refusal priorities")
    func refusalPrecedence() throws {
        let model = try preparedModel(), wrong = String(repeating: "0", count: 64)
        let nan = preparedBytes([Float(bitPattern: 0x7fc00001)])
        let cases: [(PreparedReferenceMLPEvaluation.Failure, String, String, String, String, Data)] = [
            (.invalidScopeID, "", "", "", "", Data()),
            (.invalidRunID, "s", "", "", "", Data()),
            (.malformedModelDigest, "s", "r", "", "", Data()),
            (.malformedInputDigest, "s", "r", wrong, "", Data()),
            (.modelDigestMismatch, "s", "r", wrong, wrong, Data()),
            (.inputByteCountMismatch, "s", "r", model.modelSHA256, wrong, nan + Data([0])),
            (.inputDigestMismatch, "s", "r", model.modelSHA256, wrong, nan),
            (.inputNonfinite, "s", "r", model.modelSHA256, preparedHash(nan), nan),
        ]
        for (failure, scope, run, modelHash, inputHash, bytes) in cases {
            preparedRefuses(failure) {
                _ = try PreparedReferenceMLPEvaluation(model: model, scopeID: scope, runID: run,
                    inputBytes: bytes, expectedModelSHA256: modelHash, expectedInputSHA256: inputHash)
            }
        }
    }

    @Test("Input length, changed bytes, endian change and nonzero Data indices are handled")
    func inputByteBinding() throws {
        let model = try preparedModel(), bytes = preparedBytes([-1])
        for bad in [Data(), Data([0]), bytes.dropLast(), bytes + Data([0])] {
            preparedRefuses(.inputByteCountMismatch) { _ = try preparedRun(model, bytes: bad) }
        }
        var changed = bytes; changed[0] ^= 1
        for bad in [changed, Data(bytes.reversed())] {
            preparedRefuses(.inputDigestMismatch) {
                _ = try PreparedReferenceMLPEvaluation(model: model, scopeID: "s", runID: "r", inputBytes: bad,
                    expectedModelSHA256: model.modelSHA256, expectedInputSHA256: preparedHash(bytes))
            }
        }
        let prefixed = Data([42, 43]) + bytes
        let sliced = prefixed[2...]
        #expect(sliced.startIndex == 2)
        let slicedResult = try preparedRun(model, bytes: sliced).evaluate(deadline: preparedDeadline())
        #expect(slicedResult.outputBytes == preparedBytes([18]))
    }

    @Test("Correctly hashed infinity and all NaN encodings refuse before inference")
    func nonfiniteInputs() throws {
        let model = try preparedModel()
        for bits: UInt32 in [0x7f800000, 0xff800000, 0x7fc00001, 0x7f800001, 0xffc00001] {
            preparedRefuses(.inputNonfinite) { _ = try preparedRun(model, bytes: preparedBytes([Float(bitPattern: bits)])) }
        }
    }

    @Test("Construction owns input and concrete model despite later external-buffer mutation")
    func immutableOwnership() throws {
        // Four-byte Data may inline-copy even with bytesNoCopy. Use a 16-byte
        // input and REQUIRE a live external alias as the mutation control.
        let weights = preparedBytes([2, 0, 0, 0, -3, 0, 0, 0, -1, 1, 4, 5, -2])
        let input = preparedBytes([-1, 0, 0, 0])
        let mutableWeights = NSMutableData(data: weights), mutableInput = NSMutableData(data: input)
        let borrowedWeights = Data(bytesNoCopy: mutableWeights.mutableBytes, count: mutableWeights.length, deallocator: .none)
        let borrowedInput = Data(bytesNoCopy: mutableInput.mutableBytes, count: mutableInput.length, deallocator: .none)
        let model = try ReferenceMLP(shape: .init(input: 4, hidden: 2, output: 1), weightBytes: borrowedWeights, expectedWeightsSHA256: preparedHash(weights))
        let prepared = try preparedRun(model, bytes: borrowedInput)
        let identity = prepared.preparedSHA256
        mutableWeights.mutableBytes.storeBytes(of: Float(99).bitPattern.littleEndian, as: UInt32.self)
        mutableInput.mutableBytes.storeBytes(of: Float(99).bitPattern.littleEndian, as: UInt32.self)
        try #require(preparedHash(borrowedInput) != prepared.inputSHA256)
        try #require(preparedHash(borrowedWeights) != model.weightsSHA256)
        let result = try prepared.evaluate(deadline: preparedDeadline())
        #expect(result.outputBytes == preparedBytes([18]))
        #expect(result.preparedSHA256 == identity && prepared.preparedSHA256 == identity)
        withExtendedLifetime((mutableWeights, mutableInput)) {}
    }

    @Test("Scope/run/model/shape/input changes cannot silently retain the bound identity")
    func bindingMutations() throws {
        let model = try preparedModel(), input = preparedBytes([-1])
        let original = try preparedRun(model).evaluate(deadline: preparedDeadline())
        for (scope, run) in [("scope.other", "run.test"), ("scope.test", "run.other")] {
            let result = try preparedRun(model, scope: scope, run: run).evaluate(deadline: preparedDeadline())
            #expect(result.modelSHA256 == original.modelSHA256 && result.inputSHA256 == original.inputSHA256)
            #expect(result.outputBytes == original.outputBytes && result.outputSHA256 == original.outputSHA256)
            #expect(result.preparedSHA256 != original.preparedSHA256 && result.resultSHA256 != original.resultSHA256)
        }
        let changed = try preparedModel([3, -3, -1, 1, 4, 5, -2])
        let otherShape = try preparedModel(i: 2, h: 1, o: 2)
        #expect(otherShape.weightsSHA256 == model.weightsSHA256)
        for substitute in [changed, otherShape] {
            preparedRefuses(.modelDigestMismatch) {
                _ = try PreparedReferenceMLPEvaluation(model: substitute, scopeID: "scope.test", runID: "run.test",
                    inputBytes: input, expectedModelSHA256: model.modelSHA256, expectedInputSHA256: preparedHash(input))
            }
        }
        let changedResult = try preparedRun(changed).evaluate(deadline: preparedDeadline())
        #expect(changedResult.modelSHA256 != original.modelSHA256)
        #expect(changedResult.inputSHA256 == original.inputSHA256)
        #expect(changedResult.preparedSHA256 != original.preparedSHA256 && changedResult.resultSHA256 != original.resultSHA256)
        let changedInput = try preparedRun(model, bytes: preparedBytes([1])).evaluate(deadline: preparedDeadline())
        #expect(changedInput.modelSHA256 == original.modelSHA256)
        #expect(changedInput.inputSHA256 != original.inputSHA256)
        #expect(changedInput.preparedSHA256 != original.preparedSHA256 && changedInput.resultSHA256 != original.resultSHA256)
        #expect(changedInput.outputBytes == preparedBytes([2]))
    }

    @Test("Repeated and concurrent evaluations preserve bit-identical non-authorizing results")
    func repeatedConcurrentResults() async throws {
        let prepared = try preparedRun(preparedModel())
        let reference = try prepared.evaluate(deadline: preparedDeadline())
        for _ in 0..<8 {
            #expect(try prepared.evaluate(deadline: preparedDeadline()).resultSHA256 == reference.resultSHA256)
        }
        let results = try await withThrowingTaskGroup(of: PreparedReferenceMLPEvaluation.Result.self) { group in
            for _ in 0..<8 { group.addTask { try prepared.evaluate(deadline: preparedDeadline()) } }
            var values: [PreparedReferenceMLPEvaluation.Result] = []
            for try await result in group { values.append(result) }
            return values
        }
        #expect(results.count == 8)
        #expect(results.allSatisfy { $0.resultSHA256 == reference.resultSHA256 && $0.outputBytes == reference.outputBytes && !$0.authoritative })
    }

    @Test("Output is owned little-endian binary32 with shape-bound multiple values")
    func outputLayoutAndOwnership() throws {
        let model = try preparedModel([1, 0, 1, 2, -1, 0, 0, 0], i: 1, h: 1, o: 3)
        let result = try preparedRun(model, bytes: preparedBytes([2])).evaluate(deadline: preparedDeadline())
        #expect(result.outputWidth == 3)
        #expect(result.outputBytes == Data([0, 0, 0, 64, 0, 0, 128, 64, 0, 0, 0, 192]))
        let originalHash = result.resultSHA256
        var clientCopy = result.outputBytes; clientCopy[0] ^= 1
        #expect(clientCopy != result.outputBytes)
        #expect(result.outputSHA256 == preparedHash(result.outputBytes) && result.resultSHA256 == originalHash)
        let identity = try preparedModel([1, 0, 1, 0], i: 1, h: 1, o: 1)
        let subnormal = preparedBytes([Float(bitPattern: 1)])
        #expect(try preparedRun(identity, bytes: subnormal).evaluate(deadline: preparedDeadline()).outputBytes == subnormal)
    }

    @Test("Kernel deadlines and nonfinite intermediate errors return no replacement result")
    func failurePropagation() throws {
        let prepared = try preparedRun(preparedModel())
        preparedKernelRefuses(.deadlineExceeded) { _ = try prepared.evaluate(deadline: .now.advanced(by: .seconds(-1))) }
        preparedKernelRefuses(.deadlineOutOfRange) { _ = try prepared.evaluate(deadline: .now.advanced(by: .seconds(10))) }
        let overflowing = try preparedRun(preparedModel([2, 0, 1, 0], i: 1, h: 1, o: 1), bytes: preparedBytes([.greatestFiniteMagnitude]))
        preparedKernelRefuses(.intermediateNonfinite) { _ = try overflowing.evaluate(deadline: preparedDeadline()) }
    }

    @Test("Final packaging deadline comparison refuses equality and expiry without clock races")
    func completionDeadlineBoundary() throws {
        let end = ContinuousClock().now
        try PreparedReferenceMLPEvaluation.requireCompletionBeforeDeadline(end.advanced(by: .nanoseconds(-1)), deadline: end)
        for observed in [end, end.advanced(by: .nanoseconds(1))] {
            preparedKernelRefuses(.deadlineExceeded) {
                try PreparedReferenceMLPEvaluation.requireCompletionBeforeDeadline(observed, deadline: end)
            }
        }
        // Source review verifies evaluate samples the real clock AFTER constructing Result.
        // This predicate test does not claim a measured in-flight serialization timeout.
    }
}
