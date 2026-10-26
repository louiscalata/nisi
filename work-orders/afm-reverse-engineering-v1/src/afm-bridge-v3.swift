// AFM bridge v0.3 — real tool-calling demo via the public API.
// Uses @Generable (FoundationModelsMacros) + Tool protocol + LanguageModelSession.
// Compile: xcrun swiftc -parse-as-library -O -o afm-bridge-v3 afm-bridge-v3.swift
import Foundation
import FoundationModels

@Generable
struct GetTimeArgs {
    let format: String
    let timezone: String
}

struct GetTimeTool: Tool {
    typealias Arguments = GetTimeArgs
    typealias Output = String

    var name: String { "get_time" }
    var description: String { "Returns the current date/time in the requested format and timezone." }
    var includesSchemaInInstructions: Bool { true }

    func call(arguments: GetTimeArgs) async throws -> String {
        let f = DateFormatter()
        f.dateFormat = arguments.format.isEmpty ? "yyyy-MM-dd HH:mm:ss" : arguments.format
        f.timeZone = TimeZone(identifier: arguments.timezone) ?? .current
        return f.string(from: Date())
    }
}

@main
struct AFMBridgeV3 {
    static func main() async throws {
        let model = SystemLanguageModel.default
        guard model.isAvailable else {
            print("{\"error\":\"SystemLanguageModel not available\"}")
            return
        }
        let session = LanguageModelSession(
            model: model,
            tools: [GetTimeTool()],
            instructions: "Use the get_time tool to answer time questions. Reply with the tool result only."
        )
        let response = try await session.respond(to: "What time is it right now in UTC?")
        var out: [String: Any] = [
            "demo": "get_time tool round-trip",
            "model": "SystemLanguageModel.default",
            "content": response.content,
        ]
        out["usage.input"] = response.usage.input.totalTokenCount
        out["usage.output"] = response.usage.output.totalTokenCount
        if let data = try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys]),
           let s = String(data: data, encoding: .utf8) {
            print(s)
        }
    }
}