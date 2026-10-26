// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

// nisi-chat — Nisi V1-01 foundation executable.
//
//   nisi-chat --selftest   deterministic in-process suite (no model, no I/O)
//   nisi-chat --status     model availability + toolchain report (non-inference)
//   nisi-chat --turn       one live on-device streaming turn (JSON request)
//
// --turn request (one line of JSON on stdin):
//   {"user": "<1..4096 UTF-16>", "maxContextUtf16": 256..16384, "maxTokens": 64..2048}
// It runs real on-device inference: call only as part of the explicit
// streaming verification step.

import Foundation
import FoundationModels
import CryptoKit

// MARK: - Deterministic suite

enum NisiCheckSuite {
    static var failures = 0
    static var checks = 0

    static func check(_ condition: Bool, _ label: String) {
        checks += 1
        if condition {
            print("PASS \(label)")
        } else {
            failures += 1
            print("FAIL \(label)")
        }
    }

    static func expectThrows<T>(_ body: () throws -> T, _ label: String) {
        checks += 1
        do {
            _ = try body()
            failures += 1
            print("FAIL \(label) (no throw)")
        } catch {
            print("PASS \(label) (threw \(error))")
        }
    }

    static func runAll() -> Int {
        chatLogRules()
        turnControllerRules()
        classifierRules()
        promptAssemblerRules()
        exportRules()
        print(failures == 0
              ? "SELF-TEST OK (\(checks) checks)"
              : "SELF-TEST FAILURES: \(failures)/\(checks)")
        return failures == 0 ? 0 : 1
    }

    // MARK: ChatLog

    static func chatLogRules() {
        expectThrows({ try ChatLog(maxContextUtf16: 0) }, "zero budget refused")

        var log = try! ChatLog(maxContextUtf16: 100)
        expectThrows({ try log.append(ChatMessage(role: .user, text: "   ")) },
                     "empty message refused")
        expectThrows({ try log.append(ChatMessage(role: .user, text: String(repeating: "x", count: 101))) },
                     "oversized single message refused")
        check(log.count == 0 && log.transcript.isEmpty, "empty log stays empty after refusals")

        // UTF-16: "first message"=13, "second"=6, "third message"=13.
        var windowed = try! ChatLog(maxContextUtf16: 15)
        check(try! windowed.append(ChatMessage(role: .user, text: "first message")) == 0,
              "first append drops nothing")
        check(windowed.count == 1, "first message retained alone")
        _ = try! windowed.append(ChatMessage(role: .assistant, text: "second"))
        check(windowed.transcript.first?.text == "second",
              "tail-kept: overflow drops the oldest message, newest survives")
        check(windowed.count == 1 && windowed.totalUtf16 == 6,
              "window holds exactly the newest fitting message")
        let dropped = try! windowed.append(ChatMessage(role: .user, text: "third message"))
        check(dropped == 1, "second overflow also drops exactly one")
        check(windowed.transcript == [ChatMessage(role: .user, text: "third message")],
              "transcript equals the newest message after windowing")

        var tight = try! ChatLog(maxContextUtf16: 8)
        check(try! tight.append(ChatMessage(role: .user, text: "aaaa")) == 0, "aaaa fits (4)")
        check(try! tight.append(ChatMessage(role: .assistant, text: "bbbb")) == 0, "bbbb fits (8 total)")
        let d2 = try! tight.append(ChatMessage(role: .user, text: "cccc"))
        check(tight.transcript.last?.text == "cccc", "newest message retained")
        check(tight.transcript.count == 2 && d2 == 1,
              "tight window keeps the two newest (got \(tight.transcript.count) remain, \(d2) dropped)")
        check(tight.transcript.first?.text == "bbbb", "tight window dropped only the head")

        var exact = try! ChatLog(maxContextUtf16: 4)
        check(try! exact.append(ChatMessage(role: .user, text: "aaaa")) == 0, "exact-fit append allowed")
        _ = try! exact.append(ChatMessage(role: .assistant, text: "bbbb"))
        check(exact.transcript.count == 1 && exact.transcript.first?.text == "bbbb",
              "overflow at equality keeps newest only")

        let m = ChatMessage(role: .user, text: "héllo")
        check(m.utf16Count == 5, "utf16 counts accented chars as single units (got \(m.utf16Count))")
        check(m.role == .user, "role preserved")
        var exactReply = try! ChatLog(maxContextUtf16: 30)
        _ = try! exactReply.append(ChatMessage(role: .assistant, text: "  reply\n"))
        check(exactReply.transcript.first?.text == "  reply\n",
              "retained reply bytes match the model output")
    }

    // MARK: TurnController

    static func turnControllerRules() {
        var c = TurnController()
        check(c.beginTurn(), "first turn begins")
        check(c.isBusy, "controller reports busy in flight")
        check(c.beginTurn() == false, "second turn refused while busy")
        check(c.recordChunk("hi"), "chunk recorded while armed")
        check(c.recordChunk("there"), "second chunk recorded")
        check(c.chunkCount == 2 && c.streamedUtf16 == 7, "metrics accumulate (chunks=2, utf16=7)")
        c.requestHalt()
        check(c.haltArmed, "halt latched")
        check(c.recordChunk("late") == false, "post-halt chunk refused")
        check(c.chunkCount == 2, "refused chunk not counted")
        c.finishTurn()
        check(c.beginTurn(), "new turn allowed after completion")
        check(c.chunkCount == 0 && c.streamedUtf16 == 0 && !c.haltArmed,
              "per-turn counters reset on begin")
        c.finishTurn()
    }

    // MARK: classifier

    static func classifierRules() {
        let halt = TurnController.classifyStop(error: nil, haltArmed: true)
        check(halt == .cancelled, "halted stop classifies as cancelled")

        let cancel = TurnController.classifyStop(error: CancellationError(), haltArmed: false)
        check(cancel == .cancelled, "CancellationError classifies as cancelled")

        let generic = TurnController.classifyStop(error: NSError(domain: "x", code: 1), haltArmed: false)
        if case .streamError = generic {
            check(true, "generic error classifies as streamError")
        } else {
            check(false, "generic error classifies as streamError (got \(generic))")
        }

        let nilEnd = TurnController.classifyStop(error: nil, haltArmed: false)
        check(nilEnd == .cancelled, "clean end without retained result is not PASS")

        // Cumulative-snapshot semantics discovered on macOS 27 live streams:
        // the FINAL snapshot is the complete reply; joining duplicates prefixes.
        let cumulative = ["I", "I am a", "I am a private on-device assistant."]
        check(TurnController.finalContent(from: cumulative) == "I am a private on-device assistant.",
              "final snapshot wins over cumulative stream")
        check(TurnController.finalContent(from: ["", "hi", ""]) == "hi",
              "empty snapshots are skipped")
        check(TurnController.finalContent(from: []) == "", "no snapshots yields empty reply")
    }

    // MARK: PromptAssembler

    static func promptAssemblerRules() {
        let transcript = [
            ChatMessage(role: .user, text: "first"),
            ChatMessage(role: .assistant, text: "reply"),
        ]
        let prompt = PromptAssembler.assemble(transcript: transcript, instructions: "You are Nisi.")
        let lines = prompt.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
        check(lines.count == 3, "instructions + two transcript lines (got \(lines.count))")
        check(lines.first == "You are Nisi.", "instructions come first")
        check(lines[1] == "User: first" && lines[2] == "Assistant: reply",
              "role labels in transcript order")

        let empty = PromptAssembler.assemble(transcript: [], instructions: "I")
        check(empty == "I", "empty transcript yields instructions only")
    }

    // MARK: TranscriptExport

    static func exportRules() {
        let many = (0..<70).map { ChatMessage(role: $0 % 2 == 0 ? .user : .assistant, text: "m\($0)") }
        let export = TranscriptExport.from(many, maxEntries: 64)
        check(export.messageCount == 70, "export reports true transcript size")
        check(export.exportedCount == 64 && export.entries.count == 64,
              "export caps at 64 entries (got \(export.exportedCount))")
        check(export.entries.first?.text == "m6", "export keeps the newest tail")
        check(export.entries.last?.text == "m69", "export keeps the very last message")
        check(export.entries.allSatisfy { !$0.text.isEmpty && $0.chars == $0.text.utf16.count },
              "entry chars match utf16 counts")

        let small = TranscriptExport.from([ChatMessage(role: .user, text: "hi")], maxEntries: 64)
        check(small.messageCount == 1 && small.totalUtf16 == 2 && small.entries.count == 1,
              "small export intact")
    }
}

// MARK: - CLI

enum ChatFailure: Error {
    case refused(String)
}

@available(macOS 26.0, *)
@main
struct NisiChatCLI {
    static func main() async {
        let args = CommandLine.arguments
        if args.contains("--selftest") {
            exit(Int32(NisiCheckSuite.runAll()))
        }
        if args.contains("--status") {
            reportStatus()
            exit(0)
        }
        if args.contains("--turn") {
            await runTurn()
            return
        }
        FileHandle.standardError.write(Data("usage: nisi-chat --selftest | --status | --turn\n".utf8))
        exit(64)
    }

    // MARK: status (non-inference)

    static func reportStatus() {
        switch SystemLanguageModel.default.availability {
        case .available:
            print("model: available")
        default:
            print("model: unavailable")
        }
        #if arch(arm64) && os(macOS)
        print("target: arm64-apple-macos")
        #else
        print("target: unknown")
        #endif
    }

    // MARK: turn (explicit live verification)

    struct TurnRequest: Codable {
        let user: String
        let maxContextUtf16: Int?
        let maxTokens: Int?
        let prior: [PriorEntry]?
    }

    struct PriorEntry: Codable {
        let role: String
        let text: String
    }

    static func fail(_ code: String) -> Never {
        FileHandle.standardError.write(Data((code + "\n").utf8))
        exit(65)
    }

    static func runTurn() async {
        guard let raw = try? FileHandle.standardInput.readToEnd(), !raw.isEmpty else {
            fail("REQUEST_EMPTY")
        }
        guard let request = try? JSONDecoder().decode(TurnRequest.self, from: raw) else {
            fail("REQUEST_INVALID")
        }
        let user = request.user.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...4096).contains(user.utf16.count) else { fail("USER_BOUNDS") }
        let budget = request.maxContextUtf16 ?? 4096
        guard (256...16384).contains(budget) else { fail("BUDGET_BOUNDS") }
        let maxTokens = request.maxTokens ?? 640
        guard (64...2048).contains(maxTokens) else { fail("MAXTOKENS_BOUNDS") }

        let requestSha = sha256Hex(raw)
        print("REQUEST_SHA256: \(requestSha)")

        // Bounded prior-context seed: at most 16 entries, each 1..4096 UTF-16,
        // user/assistant roles only.
        let prior = (request.prior ?? []).map { (role: $0.role, text: $0.text) }
        guard prior.count <= 16 else { fail("PRIOR_BOUNDS") }
        for entry in prior {
            switch entry.role {
            case "user", "assistant": break
            default: fail("PRIOR_ROLE")
            }
            let text = entry.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard (1...4096).contains(text.utf16.count) else { fail("PRIOR_BOUNDS") }
        }
        print("PRIOR_ENTRIES: \(prior.count)")

        do {
            let session = try NisiChatSession(maxContextUtf16: budget)
            let priorMessages: [ChatMessage] = prior.compactMap { entry in
                let role: ChatMessage.Role
                switch entry.role {
                case "user": role = .user
                case "assistant": role = .assistant
                default: return nil
                }
                return ChatMessage(role: role, text: entry.text.trimmingCharacters(in: .whitespacesAndNewlines))
            }
            try await session.seedContext(priorMessages)
            let turn = try await session.beginUserTurn(user)
            let (evidence, reply) = try await session.ask(userText: user, turn: turn, maxTokens: maxTokens)
            print("REPLY_START")
            print(reply)
            print("REPLY_END")
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            if let data = try? encoder.encode(evidence) {
                print(String(data: data, encoding: .utf8) ?? "ENCODE_FAILED")
                exit(0)
            }
            fail("ENCODE_FAILED")
        } catch let error as SeamError {
            let code = switch error {
            case .modelUnavailable: "MODEL_UNAVAILABLE"
            case .busy: "BUSY"
            case .cancelled: "CANCELLED"
            case .streamError: "STREAM_ERROR"
            }
            fail(code)
        } catch {
            fail("UNEXPECTED")
        }
    }

    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
