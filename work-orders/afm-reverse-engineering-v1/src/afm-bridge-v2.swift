// AFM bridge v0.2 — one-shot generation attempt via LanguageModelSession
// with an instructions string (public FoundationModels, macOS 27).
// If this compiles and runs, it proves the generation path; if the model
// service refuses, we keep v0.1 (capability report) as the delivered proof.
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
        session.transcript.append(.text("Say OK."))
        let response = try await session.explanation // Response<String>
        if let value = try? await response.value {
            print(value)
        } else {
            print("{\"error\":\"no explanation value\"}")
        }
    }
}