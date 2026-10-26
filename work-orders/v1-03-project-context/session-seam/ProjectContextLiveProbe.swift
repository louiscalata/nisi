// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

// A live, process-local proof of the V1-03 selected-file reference path.
// Use a synthetic text file containing the fictional test fact below. The
// probe never saves a conversation and removes its temporary cache on exit.

import Foundation

@available(macOS 26.0, *)
@main
enum ProjectContextLiveProbe {
    private static let expectedFact = "blue lantern"
    private static let question = "According to the fictional Aurora Pecan protocol, what is its verification phrase? Cite the source ID."

    private struct Result: Encodable {
        let status: String
        let backend: String
        let sourceLabels: [String]
        let reply: String
        let replySha256: String
        let replyMentionsExpectedFact: Bool
        let replyMentionsSourceID: Bool
        let turnStatus: String?
        let reason: String?
    }

    private static func emit(_ result: Result) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        if let data = try? encoder.encode(result), let line = String(data: data, encoding: .utf8) {
            print(line)
        } else {
            fputs("{\"status\":\"ERROR\",\"reason\":\"JSON_ENCODING_FAILED\"}\n", stderr)
        }
    }

    private static func sourceID(from label: String) -> String? {
        guard label.first == "[", let closing = label.firstIndex(of: "]") else { return nil }
        return String(label[label.index(after: label.startIndex)..<closing])
    }

    private static func run(backend: String, filePath: String) async -> Result {
        let empty = [String]()
        guard (backend == "afm" || backend == "local"), filePath.hasPrefix("/") else {
            return Result(status: "ERROR", backend: backend, sourceLabels: empty, reply: "",
                          replySha256: "", replyMentionsExpectedFact: false,
                          replyMentionsSourceID: false, turnStatus: nil,
                          reason: "USAGE: --backend afm|local --file /absolute/synthetic.txt")
        }

        let conversationID = UUID().uuidString.lowercased()
        let cacheRoot = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".nisi-context-live-probe-\(UUID().uuidString)", isDirectory: true)
        var store: TemporaryContextStore?
        defer {
            if let store {
                do { try store.revoke(conversationID: conversationID) }
                catch { fputs("CACHE_REVOKE_FAILED: \(error)\n", stderr) }
            }
            if FileManager.default.fileExists(atPath: cacheRoot.path) {
                do { try FileManager.default.removeItem(at: cacheRoot) }
                catch { fputs("CACHE_ROOT_REMOVAL_FAILED: \(error)\n", stderr) }
            }
        }

        do {
            let cache = try TemporaryContextStore(baseDirectory: cacheRoot)
            store = cache
            _ = try cache.grant(urls: [URL(fileURLWithPath: filePath)], conversationID: conversationID)
            let references = try cache.makePromptContext(query: question, maxUTF16: 1200,
                                                         conversationID: conversationID)
            guard references.text.utf16.count <= 1200,
                  references.sourceLabels.count == 1,
                  references.text.localizedCaseInsensitiveContains("Aurora Pecan"),
                  references.text.localizedCaseInsensitiveContains(expectedFact),
                  let id = sourceID(from: references.sourceLabels[0]) else {
                return Result(status: "ERROR", backend: backend,
                              sourceLabels: references.sourceLabels, reply: "", replySha256: "",
                              replyMentionsExpectedFact: false, replyMentionsSourceID: false,
                              turnStatus: nil, reason: "SELECTED_FIXTURE_MISSING_EXPECTED_FACT")
            }

            let session = try NisiChatSession(maxContextUtf16: 8192)
            if backend == "afm", await session.availabilityDescription != "available" {
                return Result(status: "NOT_RUN", backend: backend,
                              sourceLabels: references.sourceLabels, reply: "", replySha256: "",
                              replyMentionsExpectedFact: false, replyMentionsSourceID: false,
                              turnStatus: nil, reason: "AFM_UNAVAILABLE")
            }

            let turn = try await session.beginUserTurn(question)
            let evidence: TurnEvidence
            let reply: String
            do {
                if backend == "afm" {
                    (evidence, reply) = try await session.ask(
                        userText: question, turn: turn, maxTokens: 1280,
                        mode: .fast, referenceContext: references.text)
                } else {
                    (evidence, reply) = try await NisiLocalTurn.run(
                        session: session, userText: question, turn: turn,
                        maxTokens: 1280, referenceContext: references.text)
                }
            } catch {
                await session.abortPendingUser(turn: turn)
                return Result(status: "ERROR", backend: backend,
                              sourceLabels: references.sourceLabels, reply: "", replySha256: "",
                              replyMentionsExpectedFact: false, replyMentionsSourceID: false,
                              turnStatus: nil, reason: "MODEL_TURN_FAILED: \(error)")
            }

            let mentionsFact = reply.localizedCaseInsensitiveContains(expectedFact)
            let mentionsSource = reply.contains(id)
            return Result(status: evidence.status == "PASS" && mentionsFact && mentionsSource
                            ? "PASS" : "FAIL",
                          backend: backend, sourceLabels: references.sourceLabels, reply: reply,
                          replySha256: evidence.replySha256,
                          replyMentionsExpectedFact: mentionsFact,
                          replyMentionsSourceID: mentionsSource,
                          turnStatus: evidence.status, reason: nil)
        } catch {
            return Result(status: "ERROR", backend: backend, sourceLabels: empty, reply: "",
                          replySha256: "", replyMentionsExpectedFact: false,
                          replyMentionsSourceID: false, turnStatus: nil,
                          reason: "CONTEXT_SETUP_FAILED: \(error)")
        }
    }

    static func main() async {
        let args = Array(CommandLine.arguments.dropFirst())
        guard args.count == 4, args[0] == "--backend", args[2] == "--file" else {
            emit(Result(status: "ERROR", backend: "", sourceLabels: [], reply: "",
                        replySha256: "", replyMentionsExpectedFact: false,
                        replyMentionsSourceID: false, turnStatus: nil,
                        reason: "USAGE: --backend afm|local --file /absolute/synthetic.txt"))
            return
        }
        emit(await run(backend: args[1], filePath: args[3]))
    }
}
