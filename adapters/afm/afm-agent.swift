// AFM agent CLI — on-device tool-augmented answers via the public API.
// Two tools (get_time, count_words), manifest loop identical to
// work-orders/afm-reverse-engineering-v1/src/afm-bridge-v6.swift.
// Usage: afm-agent "What time is it in UTC and how many words in 'a b c'?"
// Compile: xcrun swiftc -parse-as-library -O -o afm-agent afm-agent.swift
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
        "\(arguments.text.split(whereSeparator: \.isWhitespace).count)"
    }
}

@main
struct AFMAgent {
    static func main() async throws {
        let prompt = CommandLine.arguments.dropFirst().joined(separator: " ")
        guard !prompt.isEmpty else {
            print("usage: afm-agent \"<question>\"")
            return
        }
        let model = SystemLanguageModel.default
        guard model.isAvailable else {
            print("SystemLanguageModel not available")
            return
        }
        let timeTool = GetTimeTool()
        let wordsTool = CountWordsTool()
        let tools: [any Tool] = [timeTool, wordsTool]
        let options = GenerationOptions(maximumResponseTokens: 160)

        let session1 = LanguageModelSession(
            model: model,
            tools: tools,
            instructions: "Use the get_time and count_words tools to answer questions. Reply with the tool results only."
        )
        let r1 = try await session1.respond(to: prompt, options: options)
        var entries = Array(session1.transcript)
        var calls: [Transcript.ToolCall] = []
        for entry in session1.transcript {
            if case let .toolCalls(cs) = entry { calls += Array(cs) }
        }

        if !calls.isEmpty {
            var outputs: [Transcript.Entry] = []
            for call in calls {
                do {
                    let result: String
                    switch call.toolName {
                    case timeTool.name:
                        result = try await timeTool.call(arguments: call.arguments.value(GetTimeArgs.self))
                    case wordsTool.name:
                        result = try await wordsTool.call(arguments: call.arguments.value(CountWordsArgs.self))
                    default:
                        result = "unknown tool"
                    }
                    outputs.append(.toolOutput(Transcript.ToolOutput(
                        id: call.id, toolName: call.toolName,
                        segments: [.text(Transcript.TextSegment(id: call.id, content: result))]
                    )))
                } catch {
                    outputs.append(.toolOutput(Transcript.ToolOutput(
                        id: call.id, toolName: call.toolName,
                        segments: [.text(Transcript.TextSegment(id: call.id, content: "tool error"))]
                    )))
                }
            }
            entries.append(contentsOf: outputs)
            let session2 = LanguageModelSession(model: model, tools: tools, transcript: Transcript(entries: entries))
            let r2 = try await session2.respond(to: "Answer with the tool results.", options: options)
            print(r2.content)
            return
        }
        print(r1.content)
    }
}