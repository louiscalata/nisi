// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

// Nisi — conversation history listing (V1-02 inspect/delete UI support).
//
// Pure, deterministic layer over the JSONL store directory: scan it, verify
// each conversation against its sha256 sidecar, and summarize for display
// (message count, utf16 total, state). Deletion stays ConversationStore.delete
// (ordinary file removal; no secure-erasure claim). No model, no network.

import Foundation

struct ConversationSummary: Codable, Equatable, Sendable {
    var fileName: String
    var urlPath: String
    var conversationId: String?
    var schema: Int?
    var messageCount: Int
    var totalUtf16: Int
    var state: String      // "verified" | "corrupt"
    var modified: Date
}

enum ConversationListing {
    /// Directory scan, newest modification first. Non-conversation files are
    /// ignored; loadable-with-matching-sidecar files are "verified", anything
    /// else true conversation files are reported "corrupt" (never silently
    /// deleted or overwritten — the window's clean-start path is explicit).
    static func list(directory: URL) -> [ConversationSummary] {
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        var summaries: [ConversationSummary] = []
        for file in files where file.pathExtension == "jsonl" && !file.lastPathComponent.hasPrefix(".") {
            let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate ?? .distantPast
            var summary = ConversationSummary(
                fileName: file.lastPathComponent,
                urlPath: file.path,
                conversationId: nil,
                schema: nil,
                messageCount: 0,
                totalUtf16: 0,
                state: "corrupt",
                modified: modified
            )
            if let loaded = try? ConversationStore(fileURL: file).load() {
                summary.conversationId = loaded.manifest.conversationId
                summary.schema = loaded.manifest.schema
                summary.messageCount = loaded.transcript.count
                summary.totalUtf16 = loaded.transcript.reduce(0) { $0 + $1.text.utf16.count }
                summary.state = "verified"
            }
            summaries.append(summary)
        }
        return summaries.sorted { $0.modified > $1.modified }
    }
}