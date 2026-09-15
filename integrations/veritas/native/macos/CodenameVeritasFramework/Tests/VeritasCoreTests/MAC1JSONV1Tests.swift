import Foundation
import Testing
@testable import VeritasCore

@Suite("MAC1 explicit-version raw JSON codec")
struct MAC1JSONV1Tests {
    private func canonical(_ input: String) throws -> MAC1JSONV1.Result {
        try MAC1JSONV1.canonicalize(Data(input.utf8))
    }

    private func refuse(_ input: Data, _ expected: MAC1JSONErrorV1) {
        do {
            _ = try MAC1JSONV1.canonicalize(input)
            Issue.record("Expected refusal \(expected.rawValue)")
        } catch let error as MAC1JSONErrorV1 {
            #expect(error == expected)
        } catch {
            Issue.record("Wrong error type: \(error)")
        }
    }

    private func hexData(_ text: String) throws -> Data {
        let characters = Array(text.utf8)
        try #require(characters.count.isMultiple(of: 2))
        return Data(try stride(from: 0, to: characters.count, by: 2).map { offset in
            let pair = String(decoding: characters[offset..<(offset + 2)], as: UTF8.self)
            return try #require(UInt8(pair, radix: 16))
        })
    }

    @Test("All 65 byte-exact historical cases meet independent expected outcomes")
    func historicalByteCorpus() throws {
        struct Fixture: Decodable {
            struct Row: Decodable {
                struct Expected: Decodable {
                    let outcome: String
                    let code: String?
                    let canonical: String?
                    let sha256: String?
                }
                let id: String
                let inputHex: String
                let expected: Expected
            }
            let schemaVersion: Int
            let profile: String
            let rows: [Row]
        }
        let file = try #require(Bundle.module.url(forResource: "mac1-json-v1-corpus", withExtension: "json", subdirectory: "Fixtures"))
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: file))
        try #require(fixture.schemaVersion == 1 && fixture.profile == MAC1JSONV1.profile)
        try #require(fixture.rows.count == 65 && Set(fixture.rows.map(\.id)).count == 65)
        for row in fixture.rows {
            let input = try hexData(row.inputHex)
            if row.expected.outcome == "REFUSE" {
                let code = try #require(row.expected.code)
                refuse(input, try #require(MAC1JSONErrorV1(rawValue: code)))
            } else {
                try #require(row.expected.outcome == "CANONICAL")
                let expected = try #require(row.expected.canonical)
                let digest = try #require(row.expected.sha256)
                let result = try MAC1JSONV1.canonicalize(input)
                #expect(Data(result.canonical.utf8) == Data(expected.utf8), "\(row.id)")
                #expect(result.sha256 == digest, "\(row.id)")
                #expect(result.profile == fixture.profile)
            }
        }
    }

    @Test("Golden bytes cover escaped scalars, literals, ordering and null")
    func exactGoldenBytes() throws {
        let cases: [(String, String)] = [
            (#"{"2":2,"10":1}"#, #"{"10":1,"2":2}"#),
            (#"{"__proto__":1,"":2}"#, #"{"":2,"__proto__":1}"#),
            (#"{"𐀀":1,"":2,"a":3}"#, #"{"a":3,"":2,"𐀀":1}"#),
            (#"{"\u007a":0,"a":1}"#, #"{"a":1,"z":0}"#),
            (#""\ud83e\uddea""#, #""🧪""#),
            (#""\udbff\udfff""#, "\"\u{10FFFF}\""),
            (#""\ufeff""#, "\"\u{FEFF}\""),
            (#""\/\b\f\n\r\t\u001f""#, #""/\b\f\n\r\t\u001f""#),
            (" \n {\"b\":[3,2,1],\"a\":null}\t", #"{"a":null,"b":[3,2,1]}"#),
            ("true", "true"), ("false", "false"), ("null", "null"),
            ("[]", "[]"), ("{}", "{}"), ("-9007199254740991", "-9007199254740991"),
            ("9007199254740991", "9007199254740991")
        ]
        for (input, expected) in cases {
            let output = try canonical(input)
            #expect(Data(output.canonical.utf8) == Data(expected.utf8))
            #expect(try canonical(output.canonical).sha256 == output.sha256)
        }
        #expect(try canonical(#"{"k":null}"#).sha256 != canonical("{}").sha256)
    }

    @Test("Refusal codes preserve grammar and numeric source distinctions")
    func exactRefusalCodes() {
        for input in ["-0", "1.0", "1e0", "+1", "01", "-01", "-", "NaN", "Infinity", "-.1", "1:",
                      "9007199254740992", "-9007199254740992", "-9223372036854775808", String(repeating: "9", count: 200)] {
            refuse(Data(input.utf8), .number)
        }
        for input in ["", ".1", "e1", "TRUE", "{}null", "truex", "[1,]", #"{"x":}"#, #"{"x"1}"#] {
            refuse(Data(input.utf8), .syntax)
        }
        for input in [#""\ud800""#, #""\udfff""#, #""\ud800\u0041""#, #""\ud800\ud800""#, #""\ud800x""#] {
            refuse(Data(input.utf8), .surrogate)
        }
        for input in [#""\xFF""#, #""\u123""#, #""\uZZZZ""#, "\"\n\"", "\"unfinished"] {
            refuse(Data(input.utf8), .string)
        }
    }

    @Test("Byte, depth and per-object member boundaries are exact")
    func resourceLimits() throws {
        func deep(_ count: Int) -> String { String(repeating: "[", count: count) + String(repeating: "]", count: count) }
        #expect(try canonical(deep(128)).canonical.utf8.count == 256)
        refuse(Data(deep(129).utf8), .depth)
        func object(_ count: Int) -> String { "{" + (0..<count).map { "\"k\($0)\":\($0)" }.joined(separator: ",") + "}" }
        _ = try canonical(object(4096))
        _ = try canonical("[" + object(3000) + "," + object(3000) + "]")
        refuse(Data(object(4097).utf8), .objectSize)
        let exact = "\"" + String(repeating: "x", count: 1_048_574) + "\""
        #expect(try canonical(exact).canonical.utf8.count == 1_048_576)
        refuse(Data((exact + " ").utf8), .size)
        let prefix = object(4096).dropLast()
        refuse(Data((prefix + ",\"overflow\":" + deep(129) + "}").utf8), .objectSize)
    }

    @Test("Unicode identity, malformed UTF-8 and refusal precedence are exact")
    func unicodeAndPrecedence() throws {
        refuse(Data(#"{"é":1,"\u00e9":2}"#.utf8), .duplicateKey)
        refuse(Data(#"{"🧪":1,"\ud83e\uddea":2}"#.utf8), .duplicateKey)
        refuse(Data("{\"e\u{301}\":1}".utf8), .keyNotNFC)
        refuse(Data("{\"é\":1,\"e\u{301}\":2}".utf8), .keyNotNFC)
        refuse(Data(#"{"\u0000":0}"#.utf8), .duplicateKey)
        let nfd = "\"e\u{301}\""
        #expect(try Data(canonical(nfd).canonical.utf8) == Data(nfd.utf8))
        for hex in ["7b2273223a22ff227d", "22c0af22", "22eda08022", "22f490808022", "22e28222"] {
            refuse(try hexData(hex), .utf8)
        }
        refuse(try hexData("efbbbf7b7d"), .bom)
        refuse(try hexData("efbbbfff"), .bom) // Leading BOM precedes later UTF-8 failure.
        refuse(try hexData("ffefbbbf"), .utf8)
        refuse(Data([0x22, 0x1F, 0x22]), .string)
    }

    @Test("Captured Data slices, digest bytes and immutable result values")
    func capturedBytesAndDigest() throws {
        var backing = Data([0xFF, 0x7B, 0x7D, 0xFF])
        let result = try MAC1JSONV1.canonicalize(backing[1..<3])
        backing[1] = 0
        #expect(result.canonical == "{}")
        let ordered = try canonical(#"{"2":2,"10":1}"#)
        #expect(ordered.sha256 == "4489ac68dd5e0c9eb21f0e6c3294139a7d51b793c0e2e515bdf6c12948537df1")
        #expect(ordered.profile == "veritas-mac1-canonical-json-v1")
        #expect(ordered.sha256.count == 64)
    }
}
