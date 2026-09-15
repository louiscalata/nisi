// Content-bearing Apple Foundation Models probe.
//
// Reads ONE bounded artifact from stdin and asks the on-device model for a
// short advisory reading of it. This is the first path in the project where
// caller-supplied content reaches a model at all, so its boundaries are
// deliberate and narrow:
//
//   - stdin only. No argv, no file paths, no environment reads. This process
//     cannot choose what it sees; the caller's consent gate already did.
//   - SystemLanguageModel is the ON-DEVICE model. PrivateCloudComputeLanguageModel
//     is a different class and is never constructed here, so nothing leaves the
//     machine.
//   - The artifact is never echoed back and never written anywhere. Only digests,
//     counts, and a length-capped advisory string are emitted.
//   - No transcript is retained; the session is discarded with the process.
//   - Every authority flag is false. An advisory reading is not a verdict.
//
// Build (the executor pins the resulting binary by digest, so record it):
//
//   swiftc -O -parse-as-library -target arm64-apple-macos26.0 \
//     -o afm-content-probe afm-content-probe.swift
//   shasum -a 256 afm-content-probe
//
// -parse-as-library is required: a lone .swift file is otherwise compiled as
// top-level code and @main is rejected. The binary is deliberately not
// committed - it is rebuilt and re-pinned, never trusted from a checkout.
//
// The build is byte-identical when repeated to the SAME output path, and only
// then: the linker derives LC_UUID from the output path as well as the content,
// so building to a different path moves 868 bytes and changes the digest.
// Pin the digest of the binary you actually built, not one copied from a note.
import Foundation
import FoundationModels

struct Header: Decodable {
    let consentDigest: String
    let contentSha256: String
    let contentBytes: Int
    let maxAdvisoryChars: Int
    let kind: String
}

struct Evidence: Encodable {
    let schemaVersion: Int
    let status: String
    let evidenceClass: String
    let consentDigest: String
    let contentSha256: String
    let contentBytes: Int
    let kind: String
    let promptSha256: String
    let advisory: String
    let advisoryChars: Int
    let advisorySha256: String
    let modelParticipation: String
    let modelIdentityStatus: String
    let route: String
    let quiescent: Bool
    let contentPersisted: Bool
    let transcriptPersisted: Bool
    let networkEgress: Bool
    let externalToolsEnabled: Bool
    let acceptanceAuthorityGranted: Bool
    let limitationCodes: [String]
}

func sha256Hex(_ data: Data) -> String {
    var context = [UInt8](repeating: 0, count: 32)
    data.withUnsafeBytes { raw in
        _ = CommonCryptoSHA256(raw.baseAddress, UInt32(data.count), &context)
    }
    return context.map { String(format: "%02x", $0) }.joined()
}

@_silgen_name("CC_SHA256")
func CommonCryptoSHA256(_ data: UnsafeRawPointer?, _ len: UInt32, _ md: UnsafeMutablePointer<UInt8>) -> UnsafeMutablePointer<UInt8>?

func emit(_ evidence: Evidence) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    guard let data = try? encoder.encode(evidence),
          let line = String(data: data, encoding: .utf8) else {
        FileHandle.standardError.write(Data("ENCODE_FAILED\n".utf8))
        exit(70)
    }
    print(line)
}

func refuse(_ code: String) -> Never {
    FileHandle.standardError.write(Data((code + "\n").utf8))
    exit(65)
}

@available(macOS 26.0, *)
func run() async {
    // One line of header, then the raw artifact bytes. Bounded before anything
    // is decoded: this process refuses oversized input rather than buffering it.
    let stdin = FileHandle.standardInput
    guard let all = try? stdin.readToEnd(), all.count <= 131_072 else { refuse("STDIN_BYTES") }
    guard let newline = all.firstIndex(of: 0x0A) else { refuse("STDIN_FRAMING") }
    let headerData = all[all.startIndex..<newline]
    let content = Data(all[all.index(after: newline)...])
    guard let header = try? JSONDecoder().decode(Header.self, from: Data(headerData)) else { refuse("HEADER_INVALID") }

    guard header.contentBytes == content.count,
          header.contentBytes > 0, header.contentBytes <= 65_536,
          header.maxAdvisoryChars > 0, header.maxAdvisoryChars <= 2048,
          header.consentDigest.count == 64, header.contentSha256.count == 64,
          ["json", "markdown", "text"].contains(header.kind) else { refuse("HEADER_BOUNDS") }
    guard sha256Hex(content) == header.contentSha256 else { refuse("CONTENT_DIGEST_MISMATCH") }
    guard let text = String(data: content, encoding: .utf8) else { refuse("CONTENT_NOT_UTF8") }

    let model = SystemLanguageModel.default
    guard case .available = model.availability else { refuse("MODEL_UNAVAILABLE") }

    let instructions = """
    You read one local file and describe it. Reply with at most three short \
    sentences. State what the file appears to be and anything notable about its \
    structure. Do not give advice, do not judge quality, and do not claim any \
    approval, certification or correctness.
    """
    let prompt = "File kind: \(header.kind)\n\n\(text)"
    let promptDigest = sha256Hex(Data(prompt.utf8))

    let session = LanguageModelSession(model: model, tools: [], instructions: instructions)
    let options: GenerationOptions
    #if compiler(>=6.4)
    options = GenerationOptions(samplingMode: .greedy, maximumResponseTokens: 220)
    #else
    options = GenerationOptions(sampling: .greedy, maximumResponseTokens: 220)
    #endif

    // Truncate to the cap in UTF-16 code units, not Characters. The reader on
    // the other side counts in UTF-16 (it is JavaScript) and must be able to
    // check the cap exactly rather than approximately.
    var advisory: String
    do {
        let response = try await session.respond(to: prompt, options: options)
        advisory = String(response.content.prefix(header.maxAdvisoryChars))
        while advisory.utf16.count > header.maxAdvisoryChars { advisory = String(advisory.dropLast()) }
    } catch {
        refuse("MODEL_REFUSED")
    }

    emit(Evidence(
        schemaVersion: 1,
        status: "PASS",
        evidenceClass: "CONSENTED_CONTENT_ADVISORY_READING",
        consentDigest: header.consentDigest,
        contentSha256: header.contentSha256,
        contentBytes: header.contentBytes,
        kind: header.kind,
        promptSha256: promptDigest,
        advisory: advisory,
        advisoryChars: advisory.utf16.count,
        advisorySha256: sha256Hex(Data(advisory.utf8)),
        modelParticipation: "PARTICIPATED",
        modelIdentityStatus: "MODEL_ID_NOT_EXPOSED_BY_API",
        route: "system-on-device-requested",
        quiescent: true,
        contentPersisted: false,
        transcriptPersisted: false,
        networkEgress: false,
        externalToolsEnabled: false,
        acceptanceAuthorityGranted: false,
        limitationCodes: ["ADVISORY_READING_NON_AUTHORIZING", "NO_ACCEPTANCE_OR_CERTIFICATION"]
    ))
}

@main
struct Main {
    static func main() async {
        if #available(macOS 26.0, *) { await run() } else { refuse("PLATFORM") }
    }
}
