import CryptoKit
import Foundation

/// Exact refusal vocabulary for the opt-in evidence format, not ordinary JSON.
public enum MAC1JSONErrorV1: String, Error, Sendable {
    case input = "INVALID_JSON_INPUT"
    case size = "INVALID_JSON_SIZE"
    case utf8 = "INVALID_JSON_UTF8"
    case bom = "INVALID_JSON_BOM"
    case depth = "INVALID_JSON_DEPTH"
    case objectSize = "INVALID_JSON_OBJECT_SIZE"
    case string = "INVALID_JSON_STRING"
    case surrogate = "INVALID_JSON_STRING_SURROGATE"
    case duplicateKey = "INVALID_JSON_DUPLICATE_KEY"
    case keyNotNFC = "INVALID_JSON_KEY_NOT_NFC"
    case number = "INVALID_JSON_NUMBER"
    case syntax = "INVALID_JSON_SYNTAX"
}

/// Explicit-version raw-byte codec. No legacy writer, digest domain, or record
/// is migrated by calling this API. A consumer must bind the profile separately.
public enum MAC1JSONV1 {
    public static let profile = "veritas-mac1-canonical-json-v1"
    public static let maximumBytes = 1_048_576
    public static let maximumDepth = 128
    public static let maximumObjectMembers = 4_096

    public struct Result: Sendable {
        public let profile: String
        public let canonical: String
        public let sha256: String
    }

    public static func canonicalize(_ input: Data) throws -> Result {
        guard input.count <= maximumBytes else { throw MAC1JSONErrorV1.size }
        // Own the bytes and use zero-based offsets, even for a Data subsequence.
        let bytes = Array(input)
        if bytes.starts(with: [0xEF, 0xBB, 0xBF]) { throw MAC1JSONErrorV1.bom }
        guard String(validating: bytes, as: UTF8.self) != nil else { throw MAC1JSONErrorV1.utf8 }
        var parser = Parser(bytes: bytes)
        let emitted = try parser.document()
        guard emitted.count <= maximumBytes else { throw MAC1JSONErrorV1.size }
        guard let canonical = String(validating: emitted, as: UTF8.self) else { throw MAC1JSONErrorV1.utf8 }
        let digest = SHA256.hash(data: Data(emitted)).map { String(format: "%02x", $0) }.joined()
        return Result(profile: profile, canonical: canonical, sha256: digest)
    }

    private struct Member {
        let key: Data
        let value: [UInt8]
    }

    private struct Parser {
        let bytes: [UInt8]
        var index = 0

        mutating func document() throws -> [UInt8] {
            whitespace()
            let result = try value(depth: 0)
            whitespace()
            guard index == bytes.count else { throw MAC1JSONErrorV1.syntax }
            return result
        }

        mutating func whitespace() {
            while index < bytes.count && [9, 10, 13, 32].contains(bytes[index]) { index += 1 }
        }

        mutating func consume(_ byte: UInt8) -> Bool {
            guard index < bytes.count, bytes[index] == byte else { return false }
            index += 1
            return true
        }

        mutating func value(depth: Int) throws -> [UInt8] {
            whitespace()
            guard index < bytes.count else { throw MAC1JSONErrorV1.syntax }
            switch bytes[index] {
            case 0x7B, 0x5B:
                guard depth < maximumDepth else { throw MAC1JSONErrorV1.depth }
                return try bytes[index] == 0x7B ? object(depth: depth + 1) : array(depth: depth + 1)
            case 0x22:
                return Self.escaped(try string())
            case 0x74, 0x66, 0x6E:
                for literal in [Array("true".utf8), Array("false".utf8), Array("null".utf8)] {
                    if bytes[index...].starts(with: literal) {
                        index += literal.count
                        return literal
                    }
                }
                throw MAC1JSONErrorV1.syntax
            case 0x2D, 0x30...0x39, 0x2B, 0x4E, 0x49:
                return try number()
            default:
                throw MAC1JSONErrorV1.syntax
            }
        }

        mutating func object(depth: Int) throws -> [UInt8] {
            index += 1
            whitespace()
            if consume(0x7D) { return [0x7B, 0x7D] }
            var members: [Member] = []
            var seen = Set<Data>()
            while true {
                whitespace()
                guard index < bytes.count, bytes[index] == 0x22 else { throw MAC1JSONErrorV1.syntax }
                let keyBytes = try string()
                if keyBytes.contains(0) { throw MAC1JSONErrorV1.duplicateKey }
                guard let keyText = String(validating: keyBytes, as: UTF8.self) else { throw MAC1JSONErrorV1.utf8 }
                let key = Data(keyBytes)
                // String == and Set<String> collapse canonical equivalents.
                guard Data(keyText.precomposedStringWithCanonicalMapping.utf8) == key else { throw MAC1JSONErrorV1.keyNotNFC }
                guard !seen.contains(key) else { throw MAC1JSONErrorV1.duplicateKey }
                guard members.count < maximumObjectMembers else { throw MAC1JSONErrorV1.objectSize }
                seen.insert(key)
                whitespace()
                guard consume(0x3A) else { throw MAC1JSONErrorV1.syntax }
                members.append(Member(key: key, value: try value(depth: depth)))
                whitespace()
                if consume(0x7D) { break }
                guard consume(0x2C) else { throw MAC1JSONErrorV1.syntax }
            }
            members.sort { $0.key.lexicographicallyPrecedes($1.key) }
            var emitted: [UInt8] = [0x7B]
            for (offset, member) in members.enumerated() {
                if offset != 0 { emitted.append(0x2C) }
                emitted += Self.escaped(Array(member.key))
                emitted.append(0x3A)
                emitted += member.value
            }
            emitted.append(0x7D)
            return emitted
        }

        mutating func array(depth: Int) throws -> [UInt8] {
            index += 1
            whitespace()
            if consume(0x5D) { return [0x5B, 0x5D] }
            var emitted: [UInt8] = [0x5B]
            while true {
                emitted += try value(depth: depth)
                whitespace()
                if consume(0x5D) { emitted.append(0x5D); return emitted }
                guard consume(0x2C) else { throw MAC1JSONErrorV1.syntax }
                emitted.append(0x2C)
            }
        }

        mutating func string() throws -> [UInt8] {
            guard consume(0x22) else { throw MAC1JSONErrorV1.string }
            var decoded: [UInt8] = []
            while index < bytes.count {
                let byte = bytes[index]
                index += 1
                if byte == 0x22 { return decoded }
                guard byte >= 0x20 else { throw MAC1JSONErrorV1.string }
                if byte != 0x5C { decoded.append(byte); continue }
                guard index < bytes.count else { throw MAC1JSONErrorV1.string }
                let escaped = bytes[index]
                index += 1
                switch escaped {
                case 0x22, 0x5C, 0x2F: decoded.append(escaped)
                case 0x62: decoded.append(8)
                case 0x66: decoded.append(12)
                case 0x6E: decoded.append(10)
                case 0x72: decoded.append(13)
                case 0x74: decoded.append(9)
                case 0x75:
                    var scalar = try hex4()
                    if (0xD800...0xDBFF).contains(scalar) {
                        guard consume(0x5C), consume(0x75) else { throw MAC1JSONErrorV1.surrogate }
                        let low = try hex4()
                        guard (0xDC00...0xDFFF).contains(low) else { throw MAC1JSONErrorV1.surrogate }
                        scalar = 0x10000 + ((scalar - 0xD800) << 10) + low - 0xDC00
                    } else if (0xDC00...0xDFFF).contains(scalar) {
                        throw MAC1JSONErrorV1.surrogate
                    }
                    guard let value = Unicode.Scalar(scalar) else { throw MAC1JSONErrorV1.surrogate }
                    decoded += String(value).utf8
                default: throw MAC1JSONErrorV1.string
                }
            }
            throw MAC1JSONErrorV1.string
        }

        mutating func hex4() throws -> UInt32 {
            guard bytes.count - index >= 4 else { throw MAC1JSONErrorV1.string }
            var result: UInt32 = 0
            for _ in 0..<4 {
                let byte = bytes[index]
                let digit: UInt32
                switch byte {
                case 0x30...0x39: digit = UInt32(byte - 0x30)
                case 0x41...0x46: digit = UInt32(byte - 0x41 + 10)
                case 0x61...0x66: digit = UInt32(byte - 0x61 + 10)
                default: throw MAC1JSONErrorV1.string
                }
                result = result * 16 + digit
                index += 1
            }
            return result
        }

        mutating func number() throws -> [UInt8] {
            let start = index
            while index < bytes.count && ![9, 10, 13, 32, 0x2C, 0x5D, 0x7D].contains(bytes[index]) { index += 1 }
            let token = Array(bytes[start..<index])
            let magnitude = token.first == 0x2D ? Array(token.dropFirst()) : token
            guard !magnitude.isEmpty, magnitude.allSatisfy({ (0x30...0x39).contains($0) }),
                  magnitude.count == 1 || magnitude.first != 0x30,
                  token != [0x2D, 0x30] else { throw MAC1JSONErrorV1.number }
            let maximum = Array("9007199254740991".utf8)
            guard magnitude.count < maximum.count ||
                    (magnitude.count == maximum.count && !maximum.lexicographicallyPrecedes(magnitude)) else { throw MAC1JSONErrorV1.number }
            return token
        }

        /// Valid non-ASCII UTF-8 bytes pass through verbatim. Only ASCII bytes
        /// need escaping, so grapheme and normalization semantics cannot intrude.
        static func escaped(_ decoded: [UInt8]) -> [UInt8] {
            let hex = Array("0123456789abcdef".utf8)
            var emitted: [UInt8] = [0x22]
            for byte in decoded {
                switch byte {
                case 0x22, 0x5C: emitted += [0x5C, byte]
                case 8: emitted += [0x5C, 0x62]
                case 12: emitted += [0x5C, 0x66]
                case 10: emitted += [0x5C, 0x6E]
                case 13: emitted += [0x5C, 0x72]
                case 9: emitted += [0x5C, 0x74]
                case 0..<0x20: emitted += [0x5C, 0x75, 0x30, 0x30, hex[Int(byte >> 4)], hex[Int(byte & 15)]]
                default: emitted.append(byte)
                }
            }
            emitted.append(0x22)
            return emitted
        }
    }
}
