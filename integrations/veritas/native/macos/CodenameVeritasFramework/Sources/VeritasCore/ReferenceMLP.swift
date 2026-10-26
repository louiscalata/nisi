import CryptoKit
import Foundation

// Internal BN-02 arithmetic preparation, not a plugin loader or admission authority.
// No app wiring, training, filesystem/network access, promotion or quality claim.
struct ReferenceMLP: Sendable {
    static let profile = "veritas-bn02-reference-mlp-prep-v1"

    enum Failure: Error, Equatable, Sendable {
        case shapeOutOfBounds, arithmeticOverflow, parameterLimitExceeded
        case operationLimitExceeded, outputLimitExceeded
        case weightByteCountMismatch, malformedDigest, weightDigestMismatch, weightNonfinite
        case inputCountMismatch, inputNonfinite, intermediateNonfinite
        case deadlineOutOfRange, deadlineExceeded
    }

    struct Cost: Sendable {
        let parameterCount: Int
        let weightBytes: Int
        let scalarOperations: Int
        // Numeric input/hidden/output payload only: excludes allocator/process overhead.
        let evaluationBufferBytes: Int
    }

    struct Shape: Sendable {
        let input: Int
        let hidden: Int
        let output: Int
        let cost: Cost

        init(input: Int, hidden: Int, output: Int) throws {
            guard (1...4096).contains(input), (1...4096).contains(hidden),
                  (1...4096).contains(output) else { throw Failure.shapeOutOfBounds }
            let first = try Self.multiply(input, hidden)
            let second = try Self.multiply(hidden, output)
            let matrices = try Self.add(first, second)
            let parameters = try Self.add(Self.add(matrices, hidden), output)
            guard parameters <= 16_777_216 else { throw Failure.parameterLimitExceeded }
            let operations = try Self.add(Self.multiply(2, matrices), hidden)
            guard operations <= 100_000_000 else { throw Failure.operationLimitExceeded }
            guard try Self.multiply(4, output) <= 16_384 else { throw Failure.outputLimitExceeded }
            self.input = input
            self.hidden = hidden
            self.output = output
            self.cost = Cost(
                parameterCount: parameters,
                weightBytes: try Self.multiply(4, parameters),
                scalarOperations: operations,
                evaluationBufferBytes: try Self.multiply(4, Self.add(Self.add(input, hidden), output))
            )
        }

        private static func add(_ a: Int, _ b: Int) throws -> Int {
            let result = a.addingReportingOverflow(b)
            guard !result.overflow else { throw Failure.arithmeticOverflow }
            return result.partialValue
        }

        private static func multiply(_ a: Int, _ b: Int) throws -> Int {
            let result = a.multipliedReportingOverflow(by: b)
            guard !result.overflow else { throw Failure.arithmeticOverflow }
            return result.partialValue
        }
    }

    let shape: Shape
    let weightsSHA256: String
    let modelSHA256: String
    private let weights: [Float]

    init(shape: Shape, weightBytes: Data, expectedWeightsSHA256: String) throws {
        // Bound length before copying/hashing; malformed huge data receives no scan.
        guard weightBytes.count == shape.cost.weightBytes else { throw Failure.weightByteCountMismatch }
        guard expectedWeightsSHA256.utf8.count == 64,
              expectedWeightsSHA256.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) })
        else { throw Failure.malformedDigest }
        // Own bytes even if the caller constructed Data over mutable external storage.
        // Caller must not race a mutation with this synchronous copy.
        let bytes = [UInt8](weightBytes)
        let weightDigest = Self.digest(bytes)
        guard weightDigest == expectedWeightsSHA256 else { throw Failure.weightDigestMismatch }
        var decoded: [Float] = []
        decoded.reserveCapacity(shape.cost.parameterCount)
        for offset in stride(from: 0, to: bytes.count, by: 4) {
            let bits = UInt32(bytes[offset]) | (UInt32(bytes[offset + 1]) << 8)
                | (UInt32(bytes[offset + 2]) << 16) | (UInt32(bytes[offset + 3]) << 24)
            let value = Float(bitPattern: bits)
            guard value.isFinite else { throw Failure.weightNonfinite }
            decoded.append(value)
        }
        var identity = SHA256()
        identity.update(data: Data((Self.profile + "\0\(shape.input):\(shape.hidden):\(shape.output)\0").utf8))
        identity.update(data: bytes)
        self.shape = shape
        self.weightsSHA256 = weightDigest
        self.modelSHA256 = identity.finalize().map { String(format: "%02x", $0) }.joined()
        self.weights = decoded
    }

    // Cooperative checks, NOT preemption or a guaranteed maximum elapsed duration.
    // The owner supplies a monotonic deadline; an unbounded future deadline refuses.
    func evaluate(_ input: [Float], deadline: ContinuousClock.Instant) throws -> [Float] {
        let clock = ContinuousClock()
        let now = clock.now
        guard deadline > now else { throw Failure.deadlineExceeded }
        guard deadline <= now.advanced(by: .seconds(1)) else { throw Failure.deadlineOutOfRange }
        guard input.count == shape.input else { throw Failure.inputCountMismatch }
        guard input.allSatisfy(\.isFinite) else { throw Failure.inputNonfinite }
        let firstBias = shape.hidden * shape.input
        let secondMatrix = firstBias + shape.hidden
        let secondBias = secondMatrix + shape.output * shape.hidden
        var hidden = [Float](repeating: 0, count: shape.hidden)
        for row in 0..<shape.hidden {
            try Self.checkDeadline(deadline, clock: clock)
            var accumulator = weights[firstBias + row]
            for column in 0..<shape.input {
                let product = Self.multiply(input[column], weights[row * shape.input + column])
                guard product.isFinite else { throw Failure.intermediateNonfinite }
                accumulator = Self.add(accumulator, product)
                guard accumulator.isFinite else { throw Failure.intermediateNonfinite }
            }
            hidden[row] = accumulator > 0 ? accumulator : Float(0)
        }
        var output = [Float](repeating: 0, count: shape.output)
        for row in 0..<shape.output {
            try Self.checkDeadline(deadline, clock: clock)
            var accumulator = weights[secondBias + row]
            for column in 0..<shape.hidden {
                let product = Self.multiply(hidden[column], weights[secondMatrix + row * shape.hidden + column])
                guard product.isFinite else { throw Failure.intermediateNonfinite }
                accumulator = Self.add(accumulator, product)
                guard accumulator.isFinite else { throw Failure.intermediateNonfinite }
            }
            output[row] = accumulator
        }
        try Self.checkDeadline(deadline, clock: clock)
        return output
    }

    // Deliberate call boundaries materialize binary32 products before addition.
    // Both toolchains must pass the no-FMA/bias-order bit oracles in debug/release.
    @inline(never) private static func multiply(_ a: Float, _ b: Float) -> Float { a * b }
    @inline(never) private static func add(_ a: Float, _ b: Float) -> Float { a + b }

    private static func checkDeadline(_ deadline: ContinuousClock.Instant, clock: ContinuousClock) throws {
        guard clock.now < deadline else { throw Failure.deadlineExceeded }
    }

    private static func digest(_ bytes: [UInt8]) -> String {
        SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }
}
