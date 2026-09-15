import Foundation

/// A bounded grammar pass that runs before `JSONSerialization`.
///
/// Foundation accepts JSON objects with repeated keys and exposes only the last
/// value. That behavior is unsafe for an assurance gate because two components
/// can interpret the same bytes differently. This scanner rejects repeated and
/// Unicode-normalization-equivalent object keys while bounding nesting and key
/// count. The artifact gate still performs its platform conformance check after
/// this pass. Typed evidence readers use the exact top-level shape from this
/// scanner instead of a lossy Foundation dictionary, then decode their schema.
enum StrictJSONValidationFailure: Error, Equatable, Sendable {
    case invalidSyntax
    case duplicateObjectKey
    case unicodeEquivalentObjectKey
    case nulObjectKey
    case byteLimitExceeded
    case nestingLimitExceeded
    case objectKeyLimitExceeded
}

struct StrictJSONDocumentValidator: Sendable {
    static let maximumBytes = ArtifactSnapshotter.prototypeByteLimit
    static let maximumNestingDepth = 128
    static let maximumObjectKeys = 4_096

    struct ObjectShape: Sendable {
        let keys: Set<Data>
        let stringMembers: [Data: String]

        func string(for key: String) -> String? {
            stringMembers[Data(key.utf8)]
        }
    }

    static func validate(_ data: Data) throws {
        guard data.count <= maximumBytes else {
            throw StrictJSONValidationFailure.byteLimitExceeded
        }
        var scanner = Scanner(bytes: Array(data))
        try scanner.scanDocument()
    }

    /// Structural inspection only: this does not certify canonical bytes,
    /// restrict ordinary JSON numbers to integers, or normalize keys/values.
    static func inspectTopLevelObject(_ data: Data) throws -> ObjectShape {
        guard data.count <= maximumBytes else {
            throw StrictJSONValidationFailure.byteLimitExceeded
        }
        var scanner = Scanner(bytes: Array(data))
        try scanner.scanDocument()
        guard let keys = scanner.rootKeys else {
            throw StrictJSONValidationFailure.invalidSyntax
        }
        return ObjectShape(keys: keys, stringMembers: scanner.rootStringMembers)
    }

    private struct Scanner {
        let bytes: [UInt8]
        var index = 0
        var objectKeyCount = 0
        var rootKeys: Set<Data>?
        var rootStringMembers: [Data: String] = [:]

        mutating func scanDocument() throws {
            skipWhitespace()
            _ = try scanValue(depth: 0)
            skipWhitespace()
            guard index == bytes.count else { throw failure }
        }

        private var failure: StrictJSONValidationFailure { .invalidSyntax }

        private mutating func scanValue(depth: Int) throws -> String? {
            guard index < bytes.count else { throw failure }
            switch bytes[index] {
            case 0x7B: // {
                try scanObject(depth: depth)
            case 0x5B: // [
                try scanArray(depth: depth)
            case 0x22: // "
                return try scanStringLiteral()
            case 0x74: // true
                try scanLiteral([0x74, 0x72, 0x75, 0x65])
            case 0x66: // false
                try scanLiteral([0x66, 0x61, 0x6C, 0x73, 0x65])
            case 0x6E: // null
                try scanLiteral([0x6E, 0x75, 0x6C, 0x6C])
            case 0x2D, 0x30...0x39:
                try scanNumber()
            default:
                throw failure
            }
            return nil
        }

        private mutating func scanObject(depth: Int) throws {
            guard depth <= StrictJSONDocumentValidator.maximumNestingDepth else {
                throw StrictJSONValidationFailure.nestingLimitExceeded
            }
            index += 1
            if depth == 0 { rootKeys = [] }
            skipWhitespace()
            if consume(0x7D) { return } // }

            var exactKeys = Set<Data>()
            var normalizedKeys = Set<String>()
            while true {
                guard index < bytes.count, bytes[index] == 0x22 else { throw failure }
                let key = try scanStringLiteral()
                guard !key.unicodeScalars.contains(where: { $0.value == 0 }) else {
                    throw StrictJSONValidationFailure.nulObjectKey
                }
                let exactKey = Data(key.utf8)
                guard exactKeys.insert(exactKey).inserted else {
                    throw StrictJSONValidationFailure.duplicateObjectKey
                }
                let normalizedKey = key.precomposedStringWithCanonicalMapping
                guard normalizedKeys.insert(normalizedKey).inserted else {
                    throw StrictJSONValidationFailure.unicodeEquivalentObjectKey
                }
                objectKeyCount += 1
                guard objectKeyCount <= StrictJSONDocumentValidator.maximumObjectKeys else {
                    throw StrictJSONValidationFailure.objectKeyLimitExceeded
                }

                skipWhitespace()
                guard consume(0x3A) else { throw failure } // :
                skipWhitespace()
                let stringValue = try scanValue(depth: depth + 1)
                if depth == 0 {
                    rootKeys?.insert(exactKey)
                    if let stringValue { rootStringMembers[exactKey] = stringValue }
                }
                skipWhitespace()
                if consume(0x7D) { return }
                guard consume(0x2C) else { throw failure } // ,
                skipWhitespace()
            }
        }

        private mutating func scanArray(depth: Int) throws {
            guard depth <= StrictJSONDocumentValidator.maximumNestingDepth else {
                throw StrictJSONValidationFailure.nestingLimitExceeded
            }
            index += 1
            skipWhitespace()
            if consume(0x5D) { return } // ]
            while true {
                _ = try scanValue(depth: depth + 1)
                skipWhitespace()
                if consume(0x5D) { return }
                guard consume(0x2C) else { throw failure } // ,
                skipWhitespace()
            }
        }

        /// Decode one string without a Foundation object parser. Exact UTF-8
        /// scalar sequences survive; malformed UTF-8 and lone surrogates refuse.
        private mutating func scanStringLiteral() throws -> String {
            guard consume(0x22) else { throw failure }
            var decoded: [UInt8] = []
            while index < bytes.count {
                let byte = bytes[index]
                if byte == 0x22 {
                    index += 1
                    guard let string = String(bytes: decoded, encoding: .utf8) else {
                        throw failure
                    }
                    return string
                }
                if byte < 0x20 { throw failure }
                if byte == 0x5C { // \\
                    index += 1
                    guard index < bytes.count else { throw failure }
                    switch bytes[index] {
                    case 0x22, 0x5C, 0x2F:
                        decoded.append(bytes[index])
                        index += 1
                    case 0x62: decoded.append(8); index += 1
                    case 0x66: decoded.append(12); index += 1
                    case 0x6E: decoded.append(10); index += 1
                    case 0x72: decoded.append(13); index += 1
                    case 0x74: decoded.append(9); index += 1
                    case 0x75: // uXXXX
                        index += 1
                        var scalar = try scanHexQuad()
                        if (0xD800...0xDBFF).contains(scalar) {
                            guard consume(0x5C), consume(0x75) else { throw failure }
                            let low = try scanHexQuad()
                            guard (0xDC00...0xDFFF).contains(low) else { throw failure }
                            scalar = 0x10000 + ((scalar - 0xD800) << 10) + low - 0xDC00
                        } else if (0xDC00...0xDFFF).contains(scalar) {
                            throw failure
                        }
                        guard let value = Unicode.Scalar(scalar) else { throw failure }
                        decoded.append(contentsOf: String(value).utf8)
                    default:
                        throw failure
                    }
                } else {
                    decoded.append(byte)
                    index += 1
                }
            }
            throw failure
        }

        private mutating func scanHexQuad() throws -> UInt32 {
            guard index + 4 <= bytes.count else { throw failure }
            var value: UInt32 = 0
            for byte in bytes[index..<(index + 4)] {
                let digit: UInt32
                switch byte {
                case 0x30...0x39: digit = UInt32(byte - 0x30)
                case 0x41...0x46: digit = UInt32(byte - 0x41 + 10)
                case 0x61...0x66: digit = UInt32(byte - 0x61 + 10)
                default: throw failure
                }
                value = (value << 4) | digit
            }
            index += 4
            return value
        }

        private mutating func scanLiteral(_ literal: [UInt8]) throws {
            guard index + literal.count <= bytes.count,
                  Array(bytes[index..<(index + literal.count)]) == literal else {
                throw failure
            }
            index += literal.count
        }

        private mutating func scanNumber() throws {
            if consume(0x2D) { // -
                guard index < bytes.count else { throw failure }
            }
            if consume(0x30) { // 0
                if index < bytes.count, (0x30...0x39).contains(bytes[index]) { throw failure }
            } else {
                guard index < bytes.count, (0x31...0x39).contains(bytes[index]) else {
                    throw failure
                }
                repeat { index += 1 } while index < bytes.count && (0x30...0x39).contains(bytes[index])
            }
            if consume(0x2E) { // .
                guard index < bytes.count, (0x30...0x39).contains(bytes[index]) else {
                    throw failure
                }
                repeat { index += 1 } while index < bytes.count && (0x30...0x39).contains(bytes[index])
            }
            if index < bytes.count, (bytes[index] == 0x65 || bytes[index] == 0x45) { // e/E
                index += 1
                if index < bytes.count, (bytes[index] == 0x2B || bytes[index] == 0x2D) {
                    index += 1
                }
                guard index < bytes.count, (0x30...0x39).contains(bytes[index]) else {
                    throw failure
                }
                repeat { index += 1 } while index < bytes.count && (0x30...0x39).contains(bytes[index])
            }
        }

        private mutating func skipWhitespace() {
            while index < bytes.count,
                  bytes[index] == 0x20 || bytes[index] == 0x09
                    || bytes[index] == 0x0A || bytes[index] == 0x0D {
                index += 1
            }
        }

        private mutating func consume(_ byte: UInt8) -> Bool {
            guard index < bytes.count, bytes[index] == byte else { return false }
            index += 1
            return true
        }

    }
}
