// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

// Pure turn-control layer for the Nisi V1-01 chat seam.
// No FoundationModels import, no model, no I/O: fully deterministic and
// exercised by the self-test suite. The actor in NisiChatSession.swift is a
// thin transport over this logic.

import Foundation

enum SeamError: Error, Sendable {
    case modelUnavailable(String)
    case busy
    case cancelled
    case streamError(String)
}

extension SeamError: Equatable {
    static func == (lhs: SeamError, rhs: SeamError) -> Bool {
        switch (lhs, rhs) {
        case (.modelUnavailable(let a), .modelUnavailable(let b)): return a == b
        case (.busy, .busy): return true
        case (.cancelled, .cancelled): return true
        case (.streamError(let a), .streamError(let b)): return a == b
        default: return false
        }
    }
}

/// One-flight-at-a-time turn control plus stream metrics and halt handling.
/// Owns no model references; the actor adapts it to the AFM transport.
struct TurnController: Sendable {
    private(set) var flight = FlightGuard()
    private(set) var haltRequested = false
    private(set) var chunkCount = 0
    private(set) var streamedUtf16 = 0

    var isBusy: Bool { flight.isBusy }

    /// Begins a turn: refused while one is already in flight. Resets all
    /// per-turn counters on success.
    @discardableResult
    mutating func beginTurn() -> Bool {
        guard flight.begin() else { return false }
        haltRequested = false
        chunkCount = 0
        streamedUtf16 = 0
        return true
    }

    mutating func finishTurn() {
        flight.finish()
    }

    /// Cooperative halt; the next chunk boundary observes it.
    mutating func requestHalt() {
        haltRequested = true
    }

    var haltArmed: Bool { haltRequested }

    /// Records one delivered chunk. Returns false when a halt was requested,
    /// which the caller treats as the stop signal for the turn.
    @discardableResult
    mutating func recordChunk(_ text: String) -> Bool {
        if haltRequested { return false }
        chunkCount += 1
        streamedUtf16 += text.utf16.count
        return true
    }

    /// Deterministic classification of how a turn stopped.
    /// - halt requested or CancellationError  -> `.cancelled`
    /// - nil error (loop end)                  -> `.cancelled` (no result retained)
    /// - any other error                       -> `.streamError(description)`
    static func classifyStop(error: (any Error)?, haltArmed: Bool) -> SeamError {
        if haltArmed { return .cancelled }
        if let error {
            if error is CancellationError { return .cancelled }
            return .streamError(String(describing: error))
        }
        return .cancelled
    }

    /// On-device AFM snapshots deliver the CUMULATIVE partial response: each
    /// snapshot.content extends the previous one and the final snapshot is the
    /// complete reply. Joining snapshots would duplicate prefixes, so the reply
    /// is the LAST non-empty snapshot. Verified live on macOS 27 (2026-09-21):
    /// 9 cumulative snapshots, 222 UTF-16 received, final reply 35 chars.
    static func finalContent(from snapshots: [String]) -> String {
        var latest = ""
        for snapshot in snapshots where !snapshot.isEmpty {
            latest = snapshot
        }
        return latest
    }
}

/// Deterministic prompt assembly: instructions first, then role-labelled
/// transcript lines in order, one message per line.
struct PromptAssembler {
    static func assemble(transcript: [ChatMessage], instructions: String) -> String {
        var parts = [instructions]
        for message in transcript {
            switch message.role {
            case .user: parts.append("User: \(message.text)")
            case .assistant: parts.append("Assistant: \(message.text)")
            }
        }
        return parts.joined(separator: "\n")
    }
}

/// Bounded transcript export: tail-kept at `maxEntries`, no persistence.
struct TranscriptEntry: Codable, Equatable, Sendable {
    let role: String
    let chars: Int
    let text: String
}

struct TranscriptExport: Codable, Equatable, Sendable {
    let messageCount: Int
    let exportedCount: Int
    let totalUtf16: Int
    let entries: [TranscriptEntry]

    static func from(_ transcript: [ChatMessage], maxEntries: Int = 64) -> TranscriptExport {
        let capped = Array(transcript.suffix(maxEntries))
        return TranscriptExport(
            messageCount: transcript.count,
            exportedCount: capped.count,
            totalUtf16: capped.reduce(0) { $0 + $1.utf16Count },
            entries: capped.map { TranscriptEntry(role: $0.role.rawValue, chars: $0.utf16Count, text: $0.text) }
        )
    }
}