// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

// Nisi — bigger local-model route (loopback backend).
//
// Design decision (roadmap, 2026-09-21, Louis): alongside the on-device AFM
// seam, chat can route to a resident local LLM loaded in LM Studio on THIS Mac
// — quality mode. Loopback HTTP only (`127.0.0.1:1234`); nothing leaves the
// machine, so `networkEgress` stays false and `transport` is reported
// honestly as "loopback-http". Only already-resident models are used (no cold
// start, no eviction); default is `google/gemma-4-26b-a4b-qat` (the only model
// REPORTED_LOADED as of 2026-09-21).
//
// Request building and SSE parsing are pure and deterministic-testable; the
// streaming call is the only I/O.

import Foundation
import CryptoKit

final class LocalNoRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

struct LocalBackendConfig: Equatable, Sendable {
    var endpoint: URL
    var model: String

    static let configuredGemma = LocalBackendConfig(
        endpoint: URL(string: "http://127.0.0.1:1234/v1/chat/completions")!,
        model: "google/gemma-4-26b-a4b-qat"
    )

    var isLoopbackEndpoint: Bool {
        endpoint.scheme == "http" && endpoint.host == "127.0.0.1" && endpoint.port == 1234
            && endpoint.user == nil && endpoint.password == nil
    }
}

struct ChatMessageDTO: Codable, Equatable, Sendable {
    let role: String
    let content: String
}

enum LocalChatRequest {
    static func messages(instructions: String, priorTranscript: [ChatMessage], newUserText: String) -> [ChatMessageDTO] {
        var result = [ChatMessageDTO(role: "system", content: instructions)]
        result += priorTranscript.map { ChatMessageDTO(role: $0.role.rawValue, content: $0.text) }
        result.append(ChatMessageDTO(role: "user", content: newUserText))
        return result
    }

    /// OpenAI-compatible chat completion body (stream: true).
    static func body(model: String, messages: [ChatMessageDTO], maxTokens: Int, stream: Bool = true) throws -> Data {
        let payload: [String: Any] = [
            "model": model,
            "messages": messages.map { ["role": $0.role, "content": $0.content] },
            "max_tokens": maxTokens,
            "temperature": 0.8,
            "stream": stream,
        ]
        return try JSONSerialization.data(withJSONObject: payload)
    }
}

enum SSEParser {
    /// Extracts `choices[0].delta.content` from a `data: {...}` line.
    static func content(fromLine line: String) -> String? {
        guard line.hasPrefix("data: ") else { return nil }
        let payload = String(line.dropFirst(6))
        guard payload != "[DONE]",
              let data = payload.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let choices = object["choices"] as? [[String: Any]],
              let delta = choices.first?["delta"] as? [String: Any],
              let content = delta["content"] as? String, !content.isEmpty else {
            return nil
        }
        return content
    }

    static func isDone(_ line: String) -> Bool {
        line.trimmingCharacters(in: .whitespaces) == "data: [DONE]"
    }

    /// A provider may send its terminal reason with or without a content delta.
    static func finishReason(fromLine line: String) -> String? {
        guard line.hasPrefix("data: "),
              let data = String(line.dropFirst(6)).data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let choices = object["choices"] as? [[String: Any]] else {
            return nil
        }
        guard let reason = choices.first?["finish_reason"], !(reason is NSNull) else {
            return nil
        }
        return reason as? String ?? "INVALID_FINISH_REASON"
    }
}

struct SSECompletion {
    private(set) var sawDone = false
    private(set) var sawLengthFinish = false
    private(set) var sawNonStopFinish = false

    mutating func content(from line: String) -> String? {
        if SSEParser.isDone(line) {
            sawDone = true
            return nil
        }
        if let reason = SSEParser.finishReason(fromLine: line) {
            if reason == "length" {
                sawLengthFinish = true
            } else if reason != "stop" {
                sawNonStopFinish = true
            }
        }
        return SSEParser.content(fromLine: line)
    }

    func requireComplete() throws {
        guard sawDone else { throw LocalTurnError.streamFailed("SSE_INCOMPLETE") }
        guard !sawLengthFinish else { throw LocalTurnError.streamFailed("SSE_OUTPUT_LIMIT") }
        guard !sawNonStopFinish else { throw LocalTurnError.streamFailed("SSE_NONSTOP_FINISH") }
    }
}

struct SSELineDecoder {
    let maxLineBytes: Int
    let maxStreamBytes: Int
    private var line = Data()
    private var totalBytes = 0

    init(maxLineBytes: Int = 262_144, maxStreamBytes: Int = 2_097_152) {
        self.maxLineBytes = maxLineBytes
        self.maxStreamBytes = maxStreamBytes
    }

    mutating func take(_ byte: UInt8) throws -> String? {
        totalBytes += 1
        guard totalBytes <= maxStreamBytes else {
            throw LocalTurnError.streamFailed("SSE_STREAM_TOO_LARGE")
        }
        if byte == 10 {
            // Count the CR toward both byte caps, then normalize CRLF to one line ending.
            if line.last == 13 { line.removeLast() }
            guard let result = String(data: line, encoding: .utf8) else {
                throw LocalTurnError.streamFailed("SSE_INVALID_UTF8")
            }
            line.removeAll(keepingCapacity: true)
            return result
        }
        guard line.count < maxLineBytes else {
            throw LocalTurnError.streamFailed("SSE_LINE_TOO_LARGE")
        }
        line.append(byte)
        return nil
    }
}

enum LocalModelInventory {
    static let maxBytes = 262_144
    static let endpoint = URL(string: "http://127.0.0.1:1234/api/v1/models")!

    /// Fail closed when the chosen model is absent at preflight. LM Studio may
    /// still unload it before the POST; the two requests cannot be atomic.
    static func isLoaded(_ data: Data, model: String) throws -> Bool {
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let models = object["models"] as? [[String: Any]] else {
            throw LocalTurnError.streamFailed("MODEL_INVENTORY_INVALID")
        }
        var loaded = false
        for item in models {
            guard let key = item["key"] as? String, !key.isEmpty,
                  let instances = item["loaded_instances"] as? [[String: Any]] else {
                throw LocalTurnError.streamFailed("MODEL_INVENTORY_INVALID")
            }
            if key == model && !instances.isEmpty { loaded = true }
        }
        return loaded
    }

    static func requireLoaded(model: String, using client: URLSession) async throws {
        var request = URLRequest(url: endpoint)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 5
        let (bytes, response) = try await client.bytes(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw LocalTurnError.streamFailed("MODEL_INVENTORY_UNAVAILABLE")
        }
        var data = Data()
        for try await byte in bytes {
            guard data.count < maxBytes else {
                throw LocalTurnError.streamFailed("MODEL_INVENTORY_TOO_LARGE")
            }
            data.append(byte)
        }
        guard try isLoaded(data, model: model) else {
            throw LocalTurnError.streamFailed("MODEL_NOT_LOADED")
        }
    }
}

struct LocalModelBackend {
    let config: LocalBackendConfig

    /// Streams the model's reply as content deltas.
    func stream(instructions: String, priorTranscript: [ChatMessage], newUserText: String, maxTokens: Int) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    guard config.isLoopbackEndpoint else {
                        throw LocalTurnError.streamFailed("LOOPBACK_ONLY")
                    }
                    let messages = LocalChatRequest.messages(
                        instructions: instructions, priorTranscript: priorTranscript, newUserText: newUserText
                    )
                    let body = try LocalChatRequest.body(model: config.model, messages: messages, maxTokens: maxTokens)
                    var request = URLRequest(url: config.endpoint)
                    request.httpMethod = "POST"
                    request.httpBody = body
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.timeoutInterval = 120
                    let configuration = URLSessionConfiguration.ephemeral
                    configuration.timeoutIntervalForRequest = 120
                    configuration.timeoutIntervalForResource = 120
                    let client = URLSession(configuration: configuration,
                                            delegate: LocalNoRedirectDelegate(), delegateQueue: nil)
                    defer { client.invalidateAndCancel() }
                    try await LocalModelInventory.requireLoaded(model: config.model, using: client)
                    let (bytes, response) = try await client.bytes(for: request)
                    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                        throw URLError(.badServerResponse)
                    }
                    var completion = SSECompletion()
                    var decoder = SSELineDecoder()
                    for try await byte in bytes {
                        guard let line = try decoder.take(byte) else { continue }
                        if let content = completion.content(from: line) {
                            continuation.yield(content)
                        }
                        if completion.sawDone { break }
                    }
                    try completion.requireComplete()
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

enum LocalTurnError: Error {
    case streamFailed(String)
}

/// Shared loopback turn runner used by BOTH the CLI and the window (backend
/// toggle): streams true deltas, appends to the conversation via
/// `session.addAssistant`, and returns evidence raised identically in both
/// surfaces. The window passes deltas straight to its live display.
enum NisiLocalTurn {
    static func run(
        session: NisiChatSession,
        userText: String,
        turn: PendingTurn,
        maxTokens: Int,
        referenceContext: String? = nil,
        onDelta: ((String) -> Void)? = nil
    ) async throws -> (TurnEvidence, String) {
        let backend = LocalModelBackend(config: .configuredGemma)
        var deltas: [String] = []
        // Acquisition errors belong to the caller that already owns this
        // lease. A duplicate runner must not abort the first active stream.
        let prior = try await session.beginLocalStream(userText: userText, turn: turn)
        let maxReplyUtf16 = await session.contextLimitUtf16
        var replyUtf16 = 0
        do {
            let modelPrior = try NativeTranscriptBuilder.priorForRequest(
                prior, userText: userText, referenceContext: referenceContext,
                maxContextUtf16: maxReplyUtf16
            )
            for try await delta in backend.stream(
                instructions: NativeTranscriptBuilder.defaultInstructions,
                priorTranscript: modelPrior,
                newUserText: NativeTranscriptBuilder.requestPrompt(
                    userText: userText, referenceContext: referenceContext),
                maxTokens: maxTokens
            ) {
                guard delta.utf16.count <= maxReplyUtf16 - replyUtf16 else {
                    throw LocalTurnError.streamFailed("REPLY_EXCEEDS_CONTEXT")
                }
                replyUtf16 += delta.utf16.count
                deltas.append(delta)
                onDelta?(delta)
            }
        } catch let error as LocalTurnError {
            await session.abortPendingUser(turn: turn)
            throw error
        } catch {
            await session.abortPendingUser(turn: turn)
            throw LocalTurnError.streamFailed(String(describing: error))
        }
        // The loopback backend yields true deltas (not cumulative snapshots),
        // so the reply is the joined stream.
        let reply = deltas.joined()
        let replySha256 = SHA256.hash(data: Data(reply.utf8))
            .map { String(format: "%02x", $0) }.joined()
        let hasReply = !reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        var evidence = TurnEvidence(
            status: hasReply ? "PASS" : "EMPTY_REPLY",
            modelAvailability: "loopback-responded",
            transcriptDropped: turn.dropped,
            requestChars: userText.utf16.count,
            chunks: deltas.count,
            streamedChars: reply.utf16.count,
            replyChars: reply.utf16.count,
            replySha256: replySha256,
            contentPersisted: false,
            networkEgress: false,
            externalToolsEnabled: false,
            acceptanceAuthorityGranted: false,
            backend: "lmstudio-loopback",
            transport: "loopback-http",
            nativeSession: false
        )
        if hasReply {
            if (try? await session.addAssistant(reply, turn: turn)) == nil {
                evidence.status = "REPLY_NOT_RETAINED"
            }
        } else {
            await session.abortPendingUser(turn: turn)
        }
        return (evidence, reply)
    }
}
