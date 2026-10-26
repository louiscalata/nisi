// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

// Nisi V1-01 session seam (quality increment 2026-09-21): one bounded live
// on-device model turn with NATIVE multi-turn context.
//
// Scope: send, multi-turn context, single-flight, cancellation and
// unavailable-model/error states. No shell, files, Jev, network egress or
// background work. SystemLanguageModel is the ON-DEVICE model;
// PrivateCloudComputeLanguageModel is never constructed.
//
// Quality fix: the session is now created ONCE per conversation and seeded
// from the stored transcript (NativeTranscriptBuilder), so the framework keeps
// native history and `ask` streams only the new user text — no more flattened
// "User:/Assistant:" re-prompting. Sampling is randomTopK(50)@0.7 instead of
// greedy, with a raised token budget.
//
// All decision logic lives in the pure layers (NisiChatLog, NisiTurnController,
// NativeTranscriptBuilder, TranscriptExport); this actor is the thin
// FoundationModels transport over them. It typechecks against the installed
// macOS 27 SDK and reports live evidence via `ask()`.

import Foundation
import FoundationModels
import CryptoKit

@available(macOS 26.0, *)
struct TurnEvidence: Sendable, Codable {
    var status: String
    var modelAvailability: String
    var transcriptDropped: Int
    var requestChars: Int
    var chunks: Int
    var streamedChars: Int
    var replyChars: Int
    var replySha256: String
    var contentPersisted: Bool
    var networkEgress: Bool
    var externalToolsEnabled: Bool
    var acceptanceAuthorityGranted: Bool
    var backend: String
    var transport: String
    var nativeSession: Bool
    // V1 adaptive-depth evidence (2026-09-23, AGIW):
    var turnMode: String = "fast"
    var reasoningLevel: String = "none"
    var continuationLegs: Int = 0
    var budgetExhausted: Bool = false
    var continuationHeuristic: String = "none"
}

/// Adaptive turn tier for the AGIW inference build. `.auto` upgrades longer
/// prompts automatically: at or above the deep-think threshold a turn becomes
/// the experimental research tier (deep reasoning instruction + structured
/// research answer) with autocontinue armed, so long requests get finished,
/// well-reasoned replies instead of cut-off prose.
@available(macOS 26.0, *)
enum TurnMode: String, Sendable {
    case auto
    case fast
    case deep
    case experimental

    /// Prompts at or above this many UTF-16 units automatically get the
    /// experimental research tier (the "gets a bit longer" trigger).
    static let deepThinkThresholdUtf16 = 500

    func resolve(userTextUtf16: Int) -> TurnMode {
        switch self {
        case .auto:
            return userTextUtf16 >= TurnMode.deepThinkThresholdUtf16 ? .experimental : .fast
        default:
            return self
        }
    }
}

struct PendingTurn: Sendable {
    let id: UUID
    let dropped: Int
}

@available(macOS 26.0, *)
actor NisiChatSession {
    private var log: ChatLog
    private var controller = TurnController()
    private let model = SystemLanguageModel.default
    private let instructions = NativeTranscriptBuilder.defaultInstructions
    private var session: LanguageModelSession?
    private var pendingBaseLog: ChatLog?
    private var pendingTurnID: UUID?
    private var executingTurnID: UUID?

    init(maxContextUtf16: Int) throws {
        log = try ChatLog(maxContextUtf16: maxContextUtf16)
    }

    /// Seeds prior transcript entries (user/assistant only) so a fresh session
    /// can carry a previous exchange into the next live turn. Bounded by the
    /// log window; refusals throw without mutating the claimed range.
    func seedContext(_ entries: [ChatMessage]) throws {
        guard pendingBaseLog == nil && !controller.isBusy else { throw SeamError.busy }
        var next = log
        for entry in entries {
            _ = try next.append(entry)
        }
        log = next
        session = nil
    }

    func replaceContext(_ entries: [ChatMessage], maxContextUtf16: Int) throws {
        guard pendingBaseLog == nil && !controller.isBusy else { throw SeamError.busy }
        log = try ChatLog(maxContextUtf16: maxContextUtf16, initial: entries)
        session = nil
        lastDropCount = 0
    }

    var contextLimitUtf16: Int { log.maxContextUtf16 }

    var transcriptCount: Int { log.count }

    func transcript() -> [ChatMessage] { log.transcript }

    func export() -> TranscriptExport { TranscriptExport.from(log.transcript) }

    var availabilityDescription: String {
        switch model.availability {
        case .available: return "available"
        default: return "unavailable"
        }
    }

    func beginUserTurn(_ text: String) throws -> PendingTurn {
        guard pendingBaseLog == nil && !controller.isBusy else { throw SeamError.busy }
        let prior = log
        let dropped = try log.append(ChatMessage(role: .user, text: text))
        guard controller.beginTurn() else {
            log = prior
            throw SeamError.busy
        }
        let turn = PendingTurn(id: UUID(), dropped: dropped)
        pendingBaseLog = prior
        pendingTurnID = turn.id
        lastDropCount = dropped
        return turn
    }

    /// The current user turn is already in the visible log. Model requests
    /// receive earlier turns here, then the current turn exactly once as the
    /// new prompt. A mismatch is a caller error, never a silent replay.
    func contextBeforePendingUser(_ text: String, turn: PendingTurn) throws -> [ChatMessage] {
        guard pendingTurnID == turn.id,
              let current = log.transcript.last,
              current.role == .user,
              current.text == text else {
            throw SeamError.streamError("PENDING_USER_MISMATCH")
        }
        return Array(log.transcript.dropLast())
    }

    private func rollBackPendingUser() {
        if let prior = pendingBaseLog { log = prior }
        pendingBaseLog = nil
        pendingTurnID = nil
        executingTurnID = nil
        lastDropCount = 0
        controller.finishTurn()
        // A failed or cancelled native request may have changed its private
        // transcript, so the next request must rebuild from retained history.
        session = nil
    }

    func abortPendingUser(turn: PendingTurn) {
        guard pendingTurnID == turn.id else { return }
        rollBackPendingUser()
    }

    private func claimExecution(turn: PendingTurn) throws {
        guard pendingTurnID == turn.id && controller.isBusy else {
            throw SeamError.streamError("PENDING_TURN_MISMATCH")
        }
        guard executingTurnID == nil else { throw SeamError.busy }
        executingTurnID = turn.id
    }

    func beginLocalStream(userText: String, turn: PendingTurn) throws -> [ChatMessage] {
        try claimExecution(turn: turn)
        do { return try contextBeforePendingUser(userText, turn: turn) }
        catch {
            rollBackPendingUser()
            throw error
        }
    }

    /// Appends an assistant reply (used by non-AFM backends such as the
    /// loopback local route so their replies share the same persistence log).
    @discardableResult
    func addAssistant(_ text: String, turn: PendingTurn) throws -> Int {
        guard pendingTurnID == turn.id && executingTurnID == turn.id else {
            throw SeamError.streamError("PENDING_TURN_MISMATCH")
        }
        do {
            let dropped = try log.append(ChatMessage(role: .assistant, text: text))
            pendingBaseLog = nil
            pendingTurnID = nil
            executingTurnID = nil
            lastDropCount = 0
            controller.finishTurn()
            // Local backend turns are absent from any existing AFM session.
            session = nil
            return dropped
        } catch {
            rollBackPendingUser()
            throw error
        }
    }

    func clearConversation() throws {
        guard !controller.isBusy && pendingTurnID == nil else { throw SeamError.busy }
        log = try ChatLog(maxContextUtf16: log.maxContextUtf16)
        pendingBaseLog = nil
        lastDropCount = 0
        session = nil
    }

    /// Clears any native transcript that may contain request-local file
    /// excerpts. The next turn is rebuilt only from the retained chat log.
    func clearNativeReferenceContext() throws {
        guard !controller.isBusy && pendingTurnID == nil else { throw SeamError.busy }
        session = nil
    }

    func deleteCurrentConversation(fileURL: URL) throws {
        guard !controller.isBusy && pendingTurnID == nil else { throw SeamError.busy }
        try ConversationStore.delete(fileURL: fileURL)
        try clearConversation()
    }

    /// Rebuilds the native session from the CURRENT log transcript. Used when
    /// the conversation is reset (e.g. after deleting the open conversation in
    /// the window) so the next turn's native context matches exactly what the
    /// log holds — never stale turns from a deleted file.
    private var lastDropCount = 0

    func cancelTurn() {
        controller.requestHalt()
    }

    /// Requests the next streaming turn. Exactly one turn at a time: a second
    /// request while one is in flight throws `.busy` without queuing.
    ///
    /// The conversation's native LanguageModelSession is created lazily on the
    /// first turn, seeded with the stored transcript (instructions first), and
    /// reused for every later turn: only `userText` is fed each time. Restore
    /// therefore carries prior turns WITHOUT replaying generation.
    ///
    /// Adaptive depth (AGIW, 2026-09-23): `mode` defaults to `.auto`, which
    /// upgrades prompts at or above the deep-think threshold (500 UTF-16) to
    /// the experimental research tier and arms autocontinue. macOS 26 exposes
    /// no stopReason, so truncation is detected with an honest budget heuristic
    /// (~4 UTF-16 chars/token, leg >= 80% of the estimated budget counts as
    /// truncated) and continuation legs re-request on the SAME native session
    /// with a minimal "Continue exactly where you left off" prompt — the model
    /// sees its own partial reply in context and completes it. All legs are
    /// atomic with the turn: they share one single-flight slot, one assistant
    /// message in the log, and one evidence record.
    ///
    /// `onSnapshot` receives EDITABLE display deltas as content streams (each
    /// delta extends the previous; cumulative resolution happens inside,
    /// including across continuation legs — simply append to your live text).
    /// Returns the evidence plus the joined reply text.
    func ask(
        userText: String,
        turn: PendingTurn,
        maxTokens: Int = 1280,
        mode: TurnMode = .auto,
        maxContinuationLegs: Int = 2,
        referenceContext: String? = nil,
        onSnapshot: ((String) -> Void)? = nil
    ) async throws -> (TurnEvidence, String) {
        try claimExecution(turn: turn)
        let hasReference = referenceContext?.isEmpty == false
        defer {
            if pendingTurnID == turn.id { rollBackPendingUser() }
            // Framework transcripts can retain the full prompt. Discard the
            // native session after a cited-reference turn, even on success.
            if hasReference { session = nil }
        }
        guard availabilityDescription == "available" else {
            throw SeamError.modelUnavailable(availabilityDescription)
        }

        let dropped = lastDropCount
        let effectiveMode = mode.resolve(userTextUtf16: userText.utf16.count)
        let prior = try contextBeforePendingUser(userText, turn: turn)
        let modelPrior = try NativeTranscriptBuilder.priorForRequest(
            prior, userText: userText, referenceContext: referenceContext,
            maxContextUtf16: log.maxContextUtf16
        )

        if session == nil || dropped > 0 || hasReference {
            session = LanguageModelSession(
                model: model,
                tools: [],
                transcript: NativeTranscriptBuilder.build(
                    instructions: instructions,
                    messages: modelPrior
                )
            )
        }
        guard let session else { throw SeamError.streamError("session creation failed") }

        let options = NativeTranscriptBuilder.tuning(maxTokens: maxTokens)
        let threshold = maxTokens * 4 * 80 / 100
        var legPrompt = NativeTranscriptBuilder.tieredPrompt(
            userText: NativeTranscriptBuilder.requestPrompt(userText: userText, referenceContext: referenceContext),
            mode: effectiveMode
        )
        var legs: [String] = []
        var continuationLegs = 0
        var budgetExhausted = false

        var legIndex = 0
        while true {
            var snapshots: [String] = []
            var legBaseline = ""
            do {
                for try await snapshot in session.streamResponse(to: legPrompt, options: options) {
                    guard controller.recordChunk(snapshot.content) else {
                        throw CancellationError()
                    }
                    // Snapshots are cumulative within a leg; deltas are the
                    // edit-distance for the live display (per-leg baselines so
                    // continuation legs append naturally).
                    let delta = snapshot.content.count >= legBaseline.count
                        ? String(snapshot.content.dropFirst(legBaseline.count))
                        : snapshot.content
                    legBaseline = snapshot.content
                    onSnapshot?(delta)
                    snapshots.append(snapshot.content)
                }
            } catch {
                throw TurnController.classifyStop(error: error, haltArmed: controller.haltArmed)
            }
            let legReply = TurnController.finalContent(from: snapshots)
            let legChars = legReply.utf16.count
            legs.append(legReply)

            if legIndex == 0 {
                budgetExhausted = legChars >= threshold
            }
            // Stop rules: first leg under budget (natural end), continuation
            // leg producing (near-)nothing (the model signalled it was done),
            // or the continuation budget is exhausted.
            if legIndex == 0 && !budgetExhausted { break }
            if legChars == 0 { break }
            if legIndex >= maxContinuationLegs { break }
            if legIndex > 0 && legChars < 10 { break }
            legPrompt = NativeTranscriptBuilder.continuationPrompt
            legIndex += 1
            continuationLegs = legIndex
        }

        // Continuation legs extend the same reply, so the joined text (in order)
        // is the single assistant message.
        let reply = legs.joined()
        let replySha256 = SHA256.hash(data: Data(reply.utf8))
            .map { String(format: "%02x", $0) }.joined()

        var evidence = TurnEvidence(
            status: "PASS",
            modelAvailability: availabilityDescription,
            transcriptDropped: dropped,
            requestChars: userText.utf16.count,
            chunks: controller.chunkCount,
            streamedChars: controller.streamedUtf16,
            replyChars: reply.utf16.count,
            replySha256: replySha256,
            contentPersisted: false,
            networkEgress: false,
            externalToolsEnabled: false,
            acceptanceAuthorityGranted: false,
            backend: "afm-ondevice",
            transport: "on-device",
            nativeSession: true,
            turnMode: effectiveMode.rawValue,
            reasoningLevel: effectiveMode == .fast ? "none" : "prompt-level",
            continuationLegs: continuationLegs,
            budgetExhausted: budgetExhausted,
            continuationHeuristic: "budget-80pct"
        )

        if !reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            do {
                let assistantDropped = try log.append(ChatMessage(role: .assistant, text: reply))
                pendingBaseLog = nil
                pendingTurnID = nil
                executingTurnID = nil
                lastDropCount = 0
                controller.finishTurn()
                if assistantDropped > 0 { self.session = nil }
            } catch {
                evidence.status = "REPLY_NOT_RETAINED"
            }
        } else {
            evidence.status = "EMPTY_REPLY"
        }
        return (evidence, reply)
    }
}
