// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

// Nisi V1-01 chat window (accepted 2026-09-21) with V1-02 lifecycle wiring:
// the running conversation persists to the default Nisi location after every
// PASS turn (ConversationStore) and is restored on launch. Honest persistence:
// nothing is written while a turn is in flight or after a non-PASS turn; the
// caption shows the last saved digest.
//
// V1-02 history UI (2026-09-21): the History panel lists every conversation in
// the Nisi app-support directory (message count, utf16 total, verified/corrupt
// state, newest first) and deletes one via ConversationStore.delete — ordinary
// file removal, no secure-erasure claim. Deleting the OPEN conversation also
// clears its in-memory and native model context before starting a new one.
//
// AGIW window improvements (2026-09-23): live streaming display of the turn in
// progress (AFM snapshot deltas and local deltas both render as they arrive),
// a segmented backend toggle (AFM / local resident gemma) remembered via
// @AppStorage, distinct red error notices, and a native context reset when the
// open conversation is deleted so the next turn never inherits stale turns.

import SwiftUI
import AppKit

@available(macOS 26.0, *)
struct NisiChatWindow: View {
    let session: NisiChatSession
    private let store = ConversationStore(fileURL: NisiChatWindow.defaultConversationURL())
    @State private var draft = ""
    @State private var history: [ChatMessage] = []
    @State private var busy = false
    @State private var notice = ""
    @State private var savedDigest = ""
    @State private var manifest: ConversationManifest?
    @State private var showHistory = false
    @State private var conversations: [ConversationSummary] = []
    @State private var pendingDelete: ConversationSummary?
    @AppStorage("nisi-backend") private var backendPref = "afm"
    @State private var liveText = ""
    @State private var activeTurnID: UUID?
    @State private var noticeIsError = false
    @State private var ready = false
    @State private var restoring = false
    @State private var projectContextStatus = "No project files selected"
    @State private var projectSourceLabels: [String] = []

    static func defaultDirectoryURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("Nisi", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: dir.path)
        return dir
    }

    static func defaultConversationURL() -> URL {
        defaultDirectoryURL().appendingPathComponent("conversation-default.jsonl")
    }

    var body: some View {
        VStack(spacing: 8) {
            List(Array(history.enumerated()), id: \.offset) { _, message in
                HStack(alignment: .top) {
                    Text(message.role == .user ? "You" : "Nisi")
                        .font(.caption).foregroundStyle(.secondary)
                    Text(message.text).textSelection(.enabled)
                    Spacer()
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(message.role == .user ? "You" : "Nisi"): \(message.text)")
            }

            if !ready {
                ProgressView("Loading conversation…")
            }

            if busy && liveText.isEmpty {
                HStack(alignment: .top) {
                    Text("nisi").font(.caption).italic().foregroundStyle(.secondary)
                    Text("thinking…").italic().foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.horizontal, 2)
            }

            if busy && !liveText.isEmpty {
                HStack(alignment: .top) {
                    Text("nisi").font(.caption).italic().foregroundStyle(.secondary)
                    Text(liveText).italic().foregroundStyle(.secondary)
                        .textSelection(.enabled)
                    Spacer()
                }
                .padding(.horizontal, 2)
            }

            if showHistory {
                List(conversations, id: \.urlPath) { summary in
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(summary.fileName).font(.caption)
                            Text("\(summary.messageCount) msgs · utf16 \(summary.totalUtf16) · \(summary.state)")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Delete") { pendingDelete = summary }
                            .font(.caption)
                    }
                }
                .frame(height: 140)
            }

            if !notice.isEmpty {
                Text(notice).font(.caption)
                    .foregroundStyle(noticeIsError ? .red : .orange)
            }
            if !savedDigest.isEmpty {
                Text("last verified save \(savedDigest)").font(.caption2).foregroundStyle(.secondary)
            }

            HStack {
                Button("Select project files…") { presentProjectPicker() }
                    .disabled(busy || !ready || manifest == nil)
                Button("Clear project files") { Task { await clearProjectFiles() } }
                    .disabled(busy || !ready || manifest == nil)
                Text(projectContextStatus).font(.caption2).foregroundStyle(.secondary)
                    .lineLimit(2)
                    .accessibilityIdentifier("nisi-project-context-status")
                Spacer()
            }
            .help("Selected text excerpts stop being usable after 24 hours and are removed on the next cache check, including app launch. Replies may quote them and remain in conversation history until deleted. Clear uses ordinary file removal.")
            if !projectSourceLabels.isEmpty {
                Text(projectSourceLabels.joined(separator: " · "))
                    .font(.caption2).foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .lineLimit(2)
                    .accessibilityLabel(projectSourceLabels.joined(separator: "; "))
                    .accessibilityIdentifier("nisi-project-context-sources")
                    .id(projectSourceLabels)
            }

            HStack {
                TextField("Message", text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .disabled(busy || !ready || manifest == nil)
                    .onSubmit { Task { await send() } }
                Button(busy ? "Sending…" : "Send") {
                    Task { await send() }
                }
                .disabled(busy || !ready || manifest == nil || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button(showHistory ? "Hide history" : "History") {
                    toggleHistory()
                }
                .disabled(busy || !ready)
                Picker("Backend", selection: $backendPref) {
                    Text("AFM").tag("afm")
                    Text("Local gemma").tag("local")
                }
                .pickerStyle(.segmented)
                .frame(width: 190)
                .disabled(busy || !ready)
                .help("Route this turn to the on-device AFM or the resident local gemma")
            }
        }
        .padding(12)
        .frame(minWidth: 480, minHeight: 360)
        .onAppear { Task { await restore() } }
        .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { _ in
            if ready && manifest != nil { refreshProjectContext() }
        }
        .confirmationDialog(
            "Delete this conversation?",
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            presenting: pendingDelete
        ) { summary in
            Button("Delete \(summary.fileName)", role: .destructive) {
                Task { await deleteHistory(summary) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { summary in
            Text("\(summary.messageCount) messages · utf16 \(summary.totalUtf16) · \(summary.state). Ordinary file removal — no secure-erasure claim.")
        }
    }

    @MainActor
    private func presentProjectPicker() {
        guard !busy, ready, let conversationID = manifest?.conversationId else { return }
        let panel = NSOpenPanel()
        panel.title = "Select project text files"
        panel.message = "Select up to eight UTF-8 text files, 16 KiB each."
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.resolvesAliases = false
        // Leave allowedContentTypes unset so source files with uncommon
        // extensions remain selectable. The cache validates actual bytes.
        panel.begin { response in
            guard response == .OK else { return }
            let urls = panel.urls
            Task { @MainActor in
                await acceptProjectFiles(urls, conversationID: conversationID)
            }
        }
    }

    @MainActor
    private func refreshProjectContext() {
        guard let manifest else {
            projectSourceLabels = []
            projectContextStatus = "No project files selected"
            return
        }
        do {
            let labels = try TemporaryContextStore().sourceLabels(conversationID: manifest.conversationId)
            projectSourceLabels = labels
            projectContextStatus = labels.isEmpty
                ? "No project files selected"
                : "\(labels.count) selected file(s) · usable for 24 hours · ordinary deletion"
        } catch {
            projectSourceLabels = []
            projectContextStatus = "Project cache refused: \(error)"
            noticeIsError = true
        }
    }

    @MainActor
    private func acceptProjectFiles(_ urls: [URL], conversationID: String) async {
        guard !busy, manifest?.conversationId == conversationID else { return }
        let access = urls.map { ($0, $0.startAccessingSecurityScopedResource()) }
        defer {
            for (url, started) in access where started { url.stopAccessingSecurityScopedResource() }
        }
        do {
            try await session.clearNativeReferenceContext()
            let summary = try TemporaryContextStore().grant(
                urls: urls, conversationID: conversationID)
            refreshProjectContext()
            notice = "cached \(summary.count) selected file(s) for 24 hours"
            noticeIsError = false
        } catch {
            notice = "project files refused: \(error)"
            noticeIsError = true
            refreshProjectContext()
        }
    }

    @MainActor
    private func clearProjectFiles() async {
        guard !busy, let manifest else { return }
        do {
            try await session.clearNativeReferenceContext()
            try TemporaryContextStore().revoke(conversationID: manifest.conversationId)
            projectSourceLabels = []
            projectContextStatus = "No project files selected"
            notice = "project excerpts cleared (ordinary file removal)"
            noticeIsError = false
        } catch {
            notice = "project cache not cleared: \(error)"
            noticeIsError = true
            refreshProjectContext()
        }
    }

    private func toggleHistory() {
        if showHistory {
            showHistory = false
        } else {
            refreshHistory()
            showHistory = true
        }
    }

    private func refreshHistory() {
        conversations = ConversationListing.list(directory: NisiChatWindow.defaultDirectoryURL())
    }

    private func deleteHistory(_ summary: ConversationSummary) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        let url = URL(fileURLWithPath: summary.urlPath)
        do {
            let cache = try TemporaryContextStore()
            if url.standardizedFileURL.path == NisiChatWindow.defaultConversationURL().standardizedFileURL.path {
                try await session.clearNativeReferenceContext()
                let clearedAllGrants = manifest?.conversationId == nil && summary.conversationId == nil
                if let conversationID = manifest?.conversationId ?? summary.conversationId {
                    try cache.revoke(conversationID: conversationID)
                } else {
                    try cache.revokeAll()
                }
                try await session.deleteCurrentConversation(fileURL: url)
                history = []
                manifest = ConversationManifest(
                    schema: 2,
                    conversationId: UUID().uuidString,
                    maxContextUtf16: await session.contextLimitUtf16,
                    createdAt: Date().timeIntervalSince1970
                )
                savedDigest = ""
                notice = clearedAllGrants
                    ? "conversation deleted; all temporary project grants revoked; new conversation started"
                    : "conversation deleted; new conversation started"
                noticeIsError = false
                projectSourceLabels = []
                projectContextStatus = "No project files selected"
            } else {
                if let conversationID = summary.conversationId {
                    try cache.revoke(conversationID: conversationID)
                } else {
                    try await session.clearNativeReferenceContext()
                    try cache.revokeAll()
                }
                try ConversationStore.delete(fileURL: url)
                notice = summary.conversationId == nil
                    ? "deleted \(summary.fileName); all temporary project grants revoked"
                    : "deleted \(summary.fileName)"
                noticeIsError = false
                refreshProjectContext()
            }
            refreshHistory()
        } catch {
            notice = "not deleted: \(error)"
            noticeIsError = true
        }
    }

    /// Loads the stored conversation on launch. Refusals are explicit: the
    /// window never silently overwrites a corrupt file; it reports the refusal
    /// and offers the clean-start clue rather than auto-deleting.
    private func restore() async {
        guard !ready && !restoring else { return }
        restoring = true
        defer { restoring = false; ready = true }
        do {
            let loaded = try store.loadWithDigest()
            manifest = loaded.manifest
            try await session.replaceContext(loaded.transcript, maxContextUtf16: loaded.manifest.maxContextUtf16)
            history = await session.transcript()
            savedDigest = String(loaded.digest.prefix(8))
            notice = ""
            noticeIsError = false
        } catch StoreError.missingFile {
            manifest = ConversationManifest(
                schema: 2,
                conversationId: UUID().uuidString,
                maxContextUtf16: 8192,
                createdAt: Date().timeIntervalSince1970
            )
            history = []
            savedDigest = ""
            notice = "new conversation"
            noticeIsError = false
        } catch {
            manifest = nil
            history = []
            savedDigest = ""
            notice = "refused load: \(error) (clean start: delete the conversation file)"
            noticeIsError = true
        }
        refreshProjectContext()
    }

    private func send() async {
        guard ready && !busy, let manifest else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let referenceContext: String?
        let submittedReferenceCount: Int
        let selectedFileCount: Int
        do {
            let context = try TemporaryContextStore().makePromptContext(
                query: text, maxUTF16: 1200, conversationID: manifest.conversationId)
            referenceContext = context.text.isEmpty ? nil : context.text
            submittedReferenceCount = context.sourceLabels.count
            selectedFileCount = context.selectedFileCount
            if referenceContext == nil { refreshProjectContext() }
        } catch {
            notice = "project cache refused: \(error)"
            noticeIsError = true
            return
        }
        busy = true
        draft = ""
        let turnID = UUID()
        activeTurnID = turnID
        let turn: PendingTurn
        do {
            turn = try await session.beginUserTurn(text)
            history.append(ChatMessage(role: .user, text: text))
        } catch {
            notice = "input refused: \(error)"
            noticeIsError = true
            draft = text
            activeTurnID = nil
            busy = false
            return
        }
        liveText = ""
        do {
            if let referenceContext {
                // An actor wait or another Nisi instance can expire or revoke
                // a grant after the first read. Refuse that copied excerpt
                // immediately before submitting the model request.
                let current = try TemporaryContextStore().makePromptContext(
                    query: text, maxUTF16: 1200, conversationID: manifest.conversationId)
                guard current.text == referenceContext else {
                    throw SeamError.streamError("PROJECT_CONTEXT_CHANGED_BEFORE_REQUEST")
                }
            }
            let (evidence, _): (TurnEvidence, String)
            if backendPref == "local" {
                (evidence, _) = try await NisiLocalTurn.run(
                    session: session,
                    userText: text,
                    turn: turn,
                    maxTokens: 1280,
                    referenceContext: referenceContext,
                ) { delta in
                    Task { @MainActor in
                        if activeTurnID == turnID && busy { liveText += delta }
                    }
                }
            } else {
                // The seam resolves cumulative snapshots into display deltas
                // (including across autocontinue legs); append as they arrive.
                (evidence, _) = try await session.ask(
                    userText: text, turn: turn, referenceContext: referenceContext
                ) { delta in
                    Task { @MainActor in
                        if activeTurnID == turnID && busy { liveText += delta }
                    }
                }
            }
            history = await session.transcript()
            if evidence.status == "PASS" {
                // Persist only after a PASS turn; digest is the honest proof.
                let transcript = await session.transcript()
                do {
                    let digest = try store.save(transcript: transcript, manifest: manifest)
                    savedDigest = String(digest.prefix(8))
                    notice = referenceContext == nil
                        ? ""
                        : "\(submittedReferenceCount) of \(selectedFileCount) selected project file(s) supplied for this reply"
                    noticeIsError = false
                } catch {
                    // A failed two-file save can leave a new JSONL body with
                    // the old sidecar. Show a digest only if the current disk
                    // pair still verifies; the in-memory reply is unsaved.
                    let verifiedSave = try? store.loadWithDigest()
                    savedDigest = verifiedSave.map { String($0.digest.prefix(8)) } ?? ""
                    notice = "reply complete; save failed: \(error)"
                    if verifiedSave == nil { notice += "; on-disk conversation not verified" }
                    noticeIsError = true
                }
            } else {
                notice = "turn finished with status \(evidence.status) (not persisted)"
                noticeIsError = true
                draft = text
            }
        } catch {
            await session.abortPendingUser(turn: turn)
            history = await session.transcript()
            notice = "turn stopped: \(error) (not persisted)"
            noticeIsError = true
            draft = text
        }
        activeTurnID = nil
        liveText = ""
        busy = false
    }
}
