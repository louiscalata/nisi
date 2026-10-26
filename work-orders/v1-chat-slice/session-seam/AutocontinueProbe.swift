// Live proof probe for the V1 adaptive-depth / autocontinue feature.
// Scenarios:
//   short  -> short prompt: expects turnMode fast, continuationLegs 0
//   long   -> ~700 utf16 prompt (auto tier): expects experimental tier
//   trunc  -> long prompt + tiny budget: expects budgetExhausted + legs >= 1
import Foundation

@available(macOS 26.0, *)
@main
struct AutocontinueProbe {
    static let longPrompt = """
    Review this draft policy about private on-device AI assistants and
    recommend concrete improvements. Consider privacy, usability, honesty
    about limitations, and how a local model should handle refusal,
    persistence, and long-running research tasks. Be specific and complete —
    this needs a well-researched, finished answer that covers trade-offs and
    ends with clear recommendations. Also weigh how sampling temperature and
    output budgeting affect quality on-device, and how a suite-wide identity
    like AGIW with an inference member should present itself across CLI and a
    graphical window without contradictions.
    """

    static func main() async throws {
        let label = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "auto"
        let session = try NisiChatSession(maxContextUtf16: 8192)
        let (evidence, reply): (TurnEvidence, String)
        switch label {
        case "short":
            let prompt = "What time is it in Manila?"
            let turn = try await session.beginUserTurn(prompt)
            (evidence, reply) = try await session.ask(userText: prompt, turn: turn)
        case "long":
            let turn = try await session.beginUserTurn(longPrompt)
            (evidence, reply) = try await session.ask(userText: longPrompt, turn: turn)
        case "trunc":
            let turn = try await session.beginUserTurn(longPrompt)
            (evidence, reply) = try await session.ask(
                userText: longPrompt,
                turn: turn,
                maxTokens: 40,
                mode: .experimental,
                maxContinuationLegs: 2
            )
        default:
            print("usage: autocontinue-probe short|long|trunc")
            return
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        print(String(data: try! encoder.encode(evidence), encoding: .utf8)!)
        print("REPLY_UTF16=\(reply.utf16.count)")
    }
}
