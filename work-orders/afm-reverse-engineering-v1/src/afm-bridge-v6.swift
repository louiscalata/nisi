// AFM bridge v0.6 — two-tool agent round via the public API.
// Proves: multiple tools, per-tool structured decode, all call outputs fed
// back in one transcript turn, final grounded answer.
// Compile: xcrun swiftc -parse-as-library -O -o afm-bridge-v6 afm-bridge-v6.swift
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
        if s.isEmpty {
            f.dateFormat = "yyyy-MM-dd HH:mm:ss zzz"
            return f.string(from: Date())
        }
        return s
    }
}

@Generable
struct CountWordsArgs {
    let text: String
}

struct CountWordsTool: Tool {
    typealias Arguments = CountWordsArgs
    typealias Output = String
    var name: String { "count_words" }
    var description: String { "Returns the number of words in the supplied text." }
    var includesSchemaInInstructions: Bool { true }

    func call(arguments: CountWordsArgs) async throws -> String {
        let words = arguments.text.split(whereSeparator: \.isWhitespace)
        return "\(words.count)"
    }
}

@main
struct AFMBridgeV6 {
    static func main() async throws {
        let model = SystemLanguageModel.default
        guard model.isAvailable else {
            print("{\"error\":\"SystemLanguageModel not available\"}")
            return
        }
        let timeTool = GetTimeTool()
        let wordsTool = CountWordsTool()
        let tools: [any Tool] = [timeTool, wordsTool]
        let options = GenerationOptions(maximumResponseTokens: 128)
        var out: [String: Any] = ["demo": "two-tool agent round", "model": "SystemLanguageModel.default"]

        let session1 = LanguageModelSession(
            model: model,
            tools: tools,
            instructions: "Use the get_time and count_words tools to answer questions. Reply with the tool results only."
        )
        let r1 = try await session1.respond(
            to: "What time is it in UTC and how many words are in 'one two three four five'?",
            options: options
        )
        out["turn1.response"] = r1.content
        out["turn1.usage"] = ["input": r1.usage.input.totalTokenCount, "output": r1.usage.output.totalTokenCount]

        // Collect every tool call in the latest batch.
        var entries = Array(session1.transcript)
        var calls: [Transcript.ToolCall] = []
        for entry in session1.transcript {
            if case let .toolCalls(cs) = entry { calls += Array(cs) }
        }
        out["toolCalls"] = calls.map { $0.toolName }
        guard !calls.isEmpty else {
            out["error"] = "no tool calls issued"
            printJSON(out)
            return
        }

        // Execute each call; append one toolOutput entry per call.
        var results: [String: Any] = [:]
        var outputs: [Transcript.Entry] = []
        for call in calls {
            do {
                let result: String
                switch call.toolName {
                case timeTool.name:
                    let args = try call.arguments.value(GetTimeArgs.self)
                    result = try await timeTool.call(arguments: args)
                    results[call.toolName] = ["args": ["format": args.format, "timezone": args.timezone], "result": result]
                case wordsTool.name:
                    let args = try call.arguments.value(CountWordsArgs.self)
                    result = try await wordsTool.call(arguments: args)
                    results[call.toolName] = ["args": ["text": args.text], "result": result]
                default:
                    result = "unknown tool"
                }
                outputs.append(.toolOutput(
                    Transcript.ToolOutput(
                        id: call.id,
                        toolName: call.toolName,
                        segments: [.text(Transcript.TextSegment(id: call.id, content: result))]
                    )
                ))
            } catch {
                out["callError.\(call.toolName)"] = String(describing: error)
            }
        }
        out["toolResults"] = results
        entries.append(contentsOf: outputs)

        // Turn 2: final grounded answer.
        let session2 = LanguageModelSession(model: model, tools: tools, transcript: Transcript(entries: entries))
        let r2 = try await session2.respond(to: "Answer with the tool results.", options: options)
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