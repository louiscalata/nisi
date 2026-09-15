// AFM bridge v0.4 — full manual tool-calling loop via the public API.
// Loop (all symbols verified in the macOS 27 SDK swiftinterface):
//   respond(GenerationOptions(toolCallingMode: .required))
//   -> scan transcript for .toolCalls -> ToolCall(toolName, arguments: GeneratedContent)
//   -> decode args via arguments.value(GetTimeArgs.self)
//   -> tool.call(arguments:) -> Segment.text(TextSegment(content:))
//   -> Transcript.Entry.toolOutput(ToolOutput(id:toolName:segments:))
//   -> new LanguageModelSession(model:tools:transcript:) and respond again.
// Compile: xcrun swiftc -parse-as-library -O -o afm-bridge-v4 afm-bridge-v4.swift
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
        let s = f.string(from: Date())
        // The model may supply a non-format string (e.g. "time"); fall back.
        if s.isEmpty {
            f.dateFormat = "yyyy-MM-dd HH:mm:ss zzz"
            return f.string(from: Date())
        }
        return s
    }
}

func lastToolCall(in transcript: Transcript) -> Transcript.ToolCall? {
    for entry in transcript {
        if case let .toolCalls(calls) = entry, let call = calls.first {
            return call
        }
    }
    return nil
}

@main
struct AFMBridgeV4 {
    static func main() async throws {
        let model = SystemLanguageModel.default
        guard model.isAvailable else {
            print("{\"error\":\"SystemLanguageModel not available\"}")
            return
        }
        let tool = GetTimeTool()
        let options = GenerationOptions(maximumResponseTokens: 128)
        var out: [String: Any] = ["demo": "manual tool-calling loop", "model": "SystemLanguageModel.default"]

        // Turn 1: force a tool call.
        let session1 = LanguageModelSession(
            model: model,
            tools: [tool],
            instructions: "Use the get_time tool to answer time questions. Reply with the tool result only."
        )
        let r1 = try await session1.respond(to: "What time is it in UTC?", options: options)
        out["turn1.response"] = r1.content
        out["turn1.usage"] = ["input": r1.usage.input.totalTokenCount, "output": r1.usage.output.totalTokenCount]

        guard let call = lastToolCall(in: session1.transcript) else {
            out["error"] = "no toolCall entry in transcript"
            out["transcript"] = String(describing: session1.transcript.map { String(describing: $0) })
            printJSON(out)
            return
        }
        out["toolCall.id"] = call.id
        out["toolCall.name"] = call.toolName

        // Decode + execute.
        let args: GetTimeArgs
        let result: String
        do {
            args = try call.arguments.value(GetTimeArgs.self)
            result = try await tool.call(arguments: args)
        } catch {
            out["error"] = "decode-or-call failed: \(error)"
            printJSON(out)
            return
        }
        out["toolCall.decode"] = ["format": args.format, "timezone": args.timezone]
        out["toolResult"] = result

        // Turn 2: attach toolOutput entry, continue in a new transcript-backed session.
        let outputEntry = Transcript.Entry.toolOutput(
            Transcript.ToolOutput(
                id: call.id,
                toolName: call.toolName,
                segments: [.text(Transcript.TextSegment(id: call.id, content: result))]
            )
        )
        var entries = Array(session1.transcript)
        entries.append(outputEntry)
        let session2 = LanguageModelSession(
            model: model,
            tools: [tool],
            transcript: Transcript(entries: entries)
        )
        let r2 = try await session2.respond(to: "Answer with the tool result.", options: options)
        out["turn2.response"] = r2.content
        out["turn2.usage"] = ["input": r2.usage.input.totalTokenCount, "output": r2.usage.output.totalTokenCount]

        printJSON(out)
    }

    static func printJSON(_ object: [String: Any]) {
        if let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]),
           let s = String(data: data, encoding: .utf8) {
            print(s)
        }
    }
}