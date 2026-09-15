// AFM bridge v0.2 — one-shot generation via LanguageModelSession.respond
// Public FoundationModels framework (macOS 27). Real symbols verified from
// the SDK swiftinterface:
//   func respond(to prompt: Swift::String, options: GenerationOptions = GenerationOptions())
//     async throws -> Response<Swift::String>
// Compile: xcrun swiftc -parse-as-library -O -o afm-bridge-v2 afm-bridge-v2.swift
import Foundation
import FoundationModels

@main
struct AFMBridgeV2 {
    static func main() async throws {
        let model = SystemLanguageModel.default
        guard model.isAvailable else {
            print("{\"error\":\"SystemLanguageModel not available\"}")
            return
        }
        let session = LanguageModelSession(
            model: model,
            tools: [],
            instructions: "You are a terse assistant. Reply with exactly one word."
        )
        let response = try await session.respond(to: "Say OK.")
        var out: [String: Any] = ["model": "SystemLanguageModel.default", "content": response.content]
        out["usage.input"] = response.usage.input.totalTokenCount
        out["usage.output"] = response.usage.output.totalTokenCount
        if let data = try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys]),
           let s = String(data: data, encoding: .utf8) {
            print(s)
        }
    }
}