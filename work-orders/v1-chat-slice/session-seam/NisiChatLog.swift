// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

// Pure conversation-log core for the Nisi V1-01 chat seam.
//
// Deterministic by design: no model, no I/O, no FoundationModels import.
// The in-process self-test exercises these rules without any inference.
// The session actor in NisiChatSession.swift layers model access on top.

import Foundation

struct ChatMessage: Equatable, Sendable {
    enum Role: String, Sendable {
        case user
        case assistant
    }

    let role: Role
    let text: String

    init(role: Role, text: String) {
        self.role = role
        self.text = text
    }

    var utf16Count: Int { text.utf16.count }
}

enum ChatLogError: Error, Equatable, Sendable {
    case emptyMessage
    case messageTooLarge(utf16: Int, limit: Int)
    case invalidBudget
}

/// Bounded, tail-kept transcript.
///
/// Invariants:
///   - A message is never split; an oversized single message is refused.
///   - When the accumulated transcript exceeds the UTF-16 budget, the oldest
///     messages are dropped from the front until it fits (tail-kept).
///   - The newest message is always retained.
struct ChatLog: Sendable {
    let maxContextUtf16: Int
    private var messages: [ChatMessage] = []

    init(maxContextUtf16: Int, initial: [ChatMessage] = []) throws {
        guard maxContextUtf16 >= 1 else { throw ChatLogError.invalidBudget }
        self.maxContextUtf16 = maxContextUtf16
        for message in initial {
            _ = try append(message)
        }
    }

    var count: Int { messages.count }
    var transcript: [ChatMessage] { messages }
    var totalUtf16: Int { messages.reduce(0) { $0 + $1.utf16Count } }

    /// Appends and returns the number of transcript messages dropped to fit
    /// the window (0 when nothing was dropped). Refuses empty/oversized input.
    @discardableResult
    mutating func append(_ message: ChatMessage) throws -> Int {
        let trimmed = message.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw ChatLogError.emptyMessage }
        // Validate whitespace-only input without rewriting the bytes the model
        // actually saw. A trimmed assistant reply would make the native session,
        // saved transcript and reply digest disagree.
        let clean = message
        guard clean.utf16Count <= maxContextUtf16 else {
            throw ChatLogError.messageTooLarge(utf16: clean.utf16Count, limit: maxContextUtf16)
        }
        let before = messages.count
        messages = fitted(messages + [clean])
        // Dropped = previously held messages that no longer fit: before + the
        // one new message, minus what remains.
        return before + 1 - messages.count
    }

    private func fitted(_ all: [ChatMessage]) -> [ChatMessage] {
        var kept: [ChatMessage] = []
        var used = 0
        for message in all.reversed() {
            let cost = message.utf16Count
            if used + cost > maxContextUtf16 { break }
            kept.append(message)
            used += cost
        }
        return kept.reversed()
    }
}

/// Single-flight guard for one in-flight model turn.
enum FlightState: Equatable, Sendable {
    case idle
    case inFlight
    case complete
}

struct FlightGuard: Sendable {
    private(set) var state: FlightState = .idle

    /// One flight at a time: refused only while a flight is in progress.
    /// A completed flight is allowed to begin again (consecutive turns).
    @discardableResult
    mutating func begin() -> Bool {
        guard state != .inFlight else { return false }
        state = .inFlight
        return true
    }

    mutating func finish() {
        state = .complete
    }

    var isBusy: Bool { state == .inFlight }
}
