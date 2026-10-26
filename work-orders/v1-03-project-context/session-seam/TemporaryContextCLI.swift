// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

import Foundation
import Darwin

@available(macOS 26.0, *)
@main
enum TemporaryContextCLI {
    private static var checks = 0
    private static var failures = 0

    private static func check(_ condition: Bool, _ label: String) {
        checks += 1
        if !condition {
            failures += 1
            fputs("FAIL: \(label)\n", stderr)
        }
    }

    private static func rejects(_ label: String, _ body: () throws -> Void,
                                where matches: (TemporaryContextStoreError) -> Bool) {
        checks += 1
        do {
            try body()
            failures += 1
            fputs("FAIL: \(label) accepted\n", stderr)
        } catch let error as TemporaryContextStoreError {
            if !matches(error) {
                failures += 1
                fputs("FAIL: \(label) gave \(error)\n", stderr)
            }
        } catch {
            failures += 1
            fputs("FAIL: \(label) gave unexpected \(error)\n", stderr)
        }
    }

    private static func write(_ text: String, to url: URL) throws {
        try Data(text.utf8).write(to: url)
    }

    private static func cachePath(_ root: URL, _ id: String) -> URL {
        root.appendingPathComponent("cache/\(id).json")
    }

    private static func run() throws {
        let fm = FileManager.default
        let fixture = fm.homeDirectoryForCurrentUser
            .appendingPathComponent(".nisi-context-selftest-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: fixture, withIntermediateDirectories: false)
        defer { try? fm.removeItem(at: fixture) }
        let cache = fixture.appendingPathComponent("cache", isDirectory: true)
        let source = fixture.appendingPathComponent("source.txt")
        let second = fixture.appendingPathComponent("second.txt")
        let id = UUID().uuidString.lowercased()
        let otherID = UUID().uuidString.lowercased()
        var clock = Date(timeIntervalSince1970: 1_800_000_000)
        let store = try TemporaryContextStore(baseDirectory: cache, now: { clock })

        check(try store.load(conversationID: id).isEmpty, "absent cache loads empty")
        let absentPrompt = try store.makePromptContext(query: "alpha", maxUTF16: 512,
                                                       conversationID: id)
        check(absentPrompt.text.isEmpty && absentPrompt.sourceLabels.isEmpty,
              "absent cache contributes no prompt context")

        let emptyID = UUID().uuidString.lowercased()
        let emptyFile = fixture.appendingPathComponent("empty.txt")
        try Data().write(to: emptyFile)
        let emptyGrant = try store.grant(urls: [emptyFile], conversationID: emptyID)
        let emptyLoaded = try store.load(conversationID: emptyID)
        let emptyPrompt = try store.makePromptContext(query: "anything", maxUTF16: 1_200,
                                                      conversationID: emptyID)
        check(emptyGrant.count == 1 && emptyLoaded.count == 1 &&
              emptyLoaded[0].text.isEmpty && emptyPrompt.text.isEmpty &&
              emptyPrompt.sourceLabels.isEmpty && emptyPrompt.selectedFileCount == 1,
              "selected empty UTF-8 file loads but contributes no reference prompt")
        try store.revoke(conversationID: emptyID)

        try write("alpha context with a precise citation\n", to: source)
        try write("beta unrelated context\n", to: second)
        let grant = try store.grant(urls: [source, second], conversationID: id)
        check(grant.count == 2 && grant.expiresAt == clock.addingTimeInterval(24 * 60 * 60),
              "grant records exact files and 24-hour lifetime")
        let loaded = try store.load(conversationID: id)
        check(loaded.count == 2 && loaded[0].sourcePath == source.path &&
              loaded[0].text.contains("alpha context"), "load returns selected excerpts")
        check(loaded[0].byteEnd == Data(loaded[0].text.utf8).count &&
              loaded[0].sha256.count == 64, "excerpt has byte range and content hash")
        let prompt = try store.makePromptContext(query: "alpha context", maxUTF16: 1200,
                                                 conversationID: id)
        check(prompt.text.utf16.count <= 1200 && prompt.text.contains("alpha context") &&
              prompt.text.contains("[Source:") && prompt.text.contains("sha256:") &&
              prompt.text.contains("bytes 0..<") && !prompt.sourceLabels.isEmpty,
              "retrieval is capped and cites source, hash, and byte range")
        check(prompt.sourceLabels.first?.contains(source.path) == true,
              "lexical ranking selects the matching source first")
        let betaPrompt = try store.makePromptContext(query: "beta context", maxUTF16: 1200,
                                                     conversationID: id)
        check(betaPrompt.sourceLabels.first?.contains(second.path) == true,
              "lexical ranking changes source order with the query")
        func citationID(for path: String, in labels: [String]) -> String? {
            guard let label = labels.first(where: { $0.contains(path) }),
                  let close = label.firstIndex(of: "]") else { return nil }
            return String(label[...close])
        }
        let originalSourceID = citationID(for: source.path, in: prompt.sourceLabels)
        let betaRankedSourceID = citationID(for: source.path, in: betaPrompt.sourceLabels)
        check(originalSourceID != nil && originalSourceID == betaRankedSourceID,
              "source ID stays stable when query ranking changes")
        let restoredLabels = try TemporaryContextStore(baseDirectory: cache, now: { clock })
            .sourceLabels(conversationID: id)
        check(restoredLabels.sorted() == prompt.sourceLabels.sorted(),
              "reopened cache restores the stable source-ID map")
        let originalSecondID = citationID(for: second.path, in: prompt.sourceLabels)
        check(originalSecondID != nil, "initial prompt includes second source ID")
        try write("alpha context with a precise citation and revised content\n", to: source)
        _ = try store.grant(urls: [source, second], conversationID: id)
        let revisedPrompt = try store.makePromptContext(query: "alpha context", maxUTF16: 1200,
                                                        conversationID: id)
        check(citationID(for: source.path, in: revisedPrompt.sourceLabels) != originalSourceID &&
              citationID(for: second.path, in: revisedPrompt.sourceLabels) != nil &&
              citationID(for: second.path, in: revisedPrompt.sourceLabels) == originalSecondID,
              "regrant changes only the modified source ID")
        check(try store.load(conversationID: otherID).isEmpty,
              "conversation identifiers isolate cache entries")

        let longID = UUID().uuidString.lowercased()
        let longSource = fixture.appendingPathComponent("long-unicode.txt")
        let longText = String(repeating: "padding ", count: 1_500) +
            "café 🛰️ starlingtoken = BLUE_CEDAR_73\n"
        try write(longText, to: longSource)
        check(longText.utf16.count > 1_200 && Data(longText.utf8).count <=
              TemporaryContextStore.maximumBytesPerFile,
              "fixture has a bounded late answer beyond the prompt budget")
        _ = try store.grant(urls: [longSource], conversationID: longID)
        let longPrompt = try store.makePromptContext(query: "starlingtoken", maxUTF16: 1_200,
                                                     conversationID: longID)
        check(longPrompt.text.utf16.count <= 1_200 &&
              longPrompt.text.contains("starlingtoken = BLUE_CEDAR_73") &&
              longPrompt.text.contains("café 🛰️"),
              "query-specific snippet includes late answer and preceding Unicode")
        if let headerStart = longPrompt.text.range(of: "[Source: "),
           let headerEnd = longPrompt.text.range(of: "]\n", range: headerStart.lowerBound..<longPrompt.text.endIndex) {
            let header = String(longPrompt.text[headerStart.lowerBound..<headerEnd.upperBound])
            let fields = header.components(separatedBy: "bytes ")
            let byteRange = fields.last?.components(separatedBy: "; captured").first?
                .components(separatedBy: "..<")
            if let byteRange, byteRange.count == 2,
               let start = Int(byteRange[0]), let end = Int(byteRange[1]),
               start > 0, end > start, end <= Data(longText.utf8).count {
                let bytes = Data(longText.utf8)
                let reconstructed = String(data: bytes.subdata(in: start..<end), encoding: .utf8)
                let emitted = String(longPrompt.text[headerEnd.upperBound...])
                check(reconstructed == emitted,
                      "nonzero citation byte range reconstructs emitted UTF-8 snippet exactly")
            } else {
                check(false, "late-snippet citation has a valid nonzero byte range")
            }
        } else {
            check(false, "late-snippet citation has a parseable source header")
        }
        try store.revoke(conversationID: longID)

        // The source-offset digits can be wider than the reserved "0" in the
        // first-pass header. A full ASCII passage exposes any final-cap drift.
        let capID = UUID().uuidString.lowercased()
        let capSource = fixture.appendingPathComponent("cap-offset.txt")
        let capText = String(repeating: "filler ", count: 1_200) +
            "needleword " + String(repeating: "tail ", count: 650)
        try write(capText, to: capSource)
        _ = try store.grant(urls: [capSource], conversationID: capID)
        let cappedPrompt = try store.makePromptContext(query: "needleword", maxUTF16: 1_200,
                                                       conversationID: capID)
        check(cappedPrompt.text.contains("needleword") && cappedPrompt.text.utf16.count <= 1_200,
              "full matching passage plus nonzero-offset citation stays within final UTF-16 cap (actual \(cappedPrompt.text.utf16.count))")
        if let bytesField = cappedPrompt.text.components(separatedBy: "bytes ").last?
            .components(separatedBy: "..<").first,
           let start = Int(bytesField),
           let headerEnd = cappedPrompt.text.range(of: "]\n", options: .backwards) {
            let emitted = String(cappedPrompt.text[headerEnd.upperBound...])
            check(start > 1_000 && emitted.utf16.count >= 700,
                  "cap fixture selects a full-sized passage from mid-file")
        } else {
            check(false, "cap fixture has a parseable citation offset")
        }
        try store.revoke(conversationID: capID)

        let capacityID = UUID().uuidString.lowercased()
        var maximumFiles: [URL] = []
        for index in 0..<TemporaryContextStore.maximumFiles {
            let file = fixture.appendingPathComponent("capacity-\(index).txt")
            // U+0001 is valid single-byte UTF-8 and expands to six ASCII
            // characters when JSON encoded, exercising the encoded-file cap.
            try Data(repeating: 1, count: TemporaryContextStore.maximumBytesPerFile)
                .write(to: file)
            maximumFiles.append(file)
        }
        let capacityGrant = try store.grant(urls: maximumFiles, conversationID: capacityID)
        let capacityLoaded = try store.load(conversationID: capacityID)
        check(capacityGrant.count == 8 && capacityLoaded.count == 8 &&
              capacityLoaded.allSatisfy {
                  $0.byteEnd == 16 * 1024 && $0.text.utf8.count == 16 * 1024
              }, "eight maximum-size, JSON-escaped UTF-8 files grant and load")
        try store.revoke(conversationID: capacityID)

        let deepID = UUID().uuidString.lowercased()
        var deepDirectory = fixture
        for _ in 0..<5 {
            deepDirectory.appendPathComponent(String(repeating: "p", count: 180), isDirectory: true)
        }
        try fm.createDirectory(at: deepDirectory, withIntermediateDirectories: true)
        let deepFile = deepDirectory.appendingPathComponent("answer.txt")
        try write("ORANGE_MAPLE_42 is the selected answer.\n", to: deepFile)
        check((900...1_100).contains(deepFile.path.utf8.count),
              "fixture uses a descriptor-openable absolute path near 1000 bytes")
        _ = try store.grant(urls: [deepFile], conversationID: deepID)
        check(try store.load(conversationID: deepID).first?.sourcePath == deepFile.path,
              "long selected path remains exact in the cache")
        let deepPrompt = try store.makePromptContext(query: "ORANGE_MAPLE_42", maxUTF16: 1_200,
                                                     conversationID: deepID)
        let deepHasAnswer = deepPrompt.text.contains("ORANGE_MAPLE_42 is the selected answer")
        check(deepPrompt.text.utf16.count <= 1_200 &&
              deepHasAnswer &&
              deepPrompt.text.contains("[Source:") && !deepPrompt.sourceLabels.isEmpty,
              "long-path source supplies cited answer within the 1200-unit prompt cap (actual \(deepPrompt.text.utf16.count), answer \(deepHasAnswer), labels \(deepPrompt.sourceLabels.count))")
        try store.revoke(conversationID: deepID)

        let twoFactID = UUID().uuidString.lowercased()
        let copperFile = fixture.appendingPathComponent("a-copper.txt")
        let silverFile = fixture.appendingPathComponent("b-silver.txt")
        try write(String(repeating: "copper filler ", count: 400) +
                  "copperquery FACT_COPPER_17\n", to: copperFile)
        try write(String(repeating: "silver filler ", count: 400) +
                  "silverquery FACT_SILVER_29\n", to: silverFile)
        _ = try store.grant(urls: [copperFile, silverFile], conversationID: twoFactID)
        let twoFactPrompt = try store.makePromptContext(query: "copperquery silverquery",
                                                        maxUTF16: 1_200,
                                                        conversationID: twoFactID)
        let copperID = citationID(for: copperFile.path, in: twoFactPrompt.sourceLabels)
        let silverID = citationID(for: silverFile.path, in: twoFactPrompt.sourceLabels)
        check(twoFactPrompt.text.utf16.count <= 1_200 &&
              twoFactPrompt.text.contains("copperquery FACT_COPPER_17") &&
              twoFactPrompt.text.contains("silverquery FACT_SILVER_29") &&
              twoFactPrompt.sourceLabels.count == 2 && twoFactPrompt.selectedFileCount == 2 &&
              copperID != nil && silverID != nil && copperID != silverID,
              "two query-relevant long files both contribute cited facts under 1200 units")
        try store.revoke(conversationID: twoFactID)

        let unusualPathID = UUID().uuidString.lowercased()
        let unusualPathFile = fixture.appendingPathComponent("odd\u{000B}line\u{2028}name.txt")
        try write("ODD_PATH_FACT_41\n", to: unusualPathFile)
        _ = try store.grant(urls: [unusualPathFile], conversationID: unusualPathID)
        let unusualPathPrompt = try store.makePromptContext(query: "ODD_PATH_FACT_41",
                                                            maxUTF16: 1_200,
                                                            conversationID: unusualPathID)
        check(unusualPathPrompt.text.contains("ODD_PATH_FACT_41") &&
              unusualPathPrompt.text.contains("[Source:") &&
              unusualPathPrompt.text.utf16.count <= 1_200 &&
              !unusualPathPrompt.text.contains("\u{000B}") &&
              !unusualPathPrompt.text.contains("\u{2028}") &&
              unusualPathPrompt.sourceLabels.count == 1 &&
              !unusualPathPrompt.sourceLabels[0].contains("\u{000B}") &&
              !unusualPathPrompt.sourceLabels[0].contains("\u{2028}"),
              "selected filename controls and line separators cannot break citation formatting")
        try store.revoke(conversationID: unusualPathID)

        let narrowID = UUID().uuidString.lowercased()
        let emojiFile = fixture.appendingPathComponent("a-emoji.txt")
        let asciiFile = fixture.appendingPathComponent("b-ascii.txt")
        try write("😀", to: emojiFile)
        try write("A", to: asciiFile)
        _ = try store.grant(urls: [emojiFile, asciiFile], conversationID: narrowID)
        let widePrompt = try store.makePromptContext(query: "", maxUTF16: 1_200,
                                                    conversationID: narrowID)
        if let firstHeaderEnd = widePrompt.text.range(of: "]\n") {
            let oneUnitBudget = String(widePrompt.text[..<firstHeaderEnd.upperBound]).utf16.count + 1
            let narrowPrompt = try store.makePromptContext(query: "", maxUTF16: oneUnitBudget,
                                                          conversationID: narrowID)
            check(widePrompt.sourceLabels.first?.contains(emojiFile.path) == true &&
                  narrowPrompt.text.utf16.count <= oneUnitBudget &&
                  narrowPrompt.text.hasSuffix("A") &&
                  narrowPrompt.sourceLabels.count == 1 &&
                  narrowPrompt.sourceLabels[0].contains(asciiFile.path),
                  "small budget skips an unrenderable grapheme and uses a fitting later source")
        } else {
            check(false, "small-budget fallback fixture has a citation header")
        }
        try store.revoke(conversationID: narrowID)

        rejects("zero retrieval limit", {
            _ = try store.makePromptContext(query: "alpha", maxUTF16: 0, conversationID: id)
        }, where: { $0 == .invalidLimit })
        rejects("invalid conversation identifier", {
            _ = try store.load(conversationID: "../other")
        }, where: { $0 == .invalidConversationID })

        let leafLink = fixture.appendingPathComponent("leaf-link.txt")
        try fm.createSymbolicLink(at: leafLink, withDestinationURL: source)
        rejects("selected symlink leaf", {
            _ = try store.grant(urls: [leafLink], conversationID: otherID)
        }, where: { if case .unsafePath = $0 { return true }; return false })

        let realDir = fixture.appendingPathComponent("real", isDirectory: true)
        let linkedDir = fixture.appendingPathComponent("linked", isDirectory: true)
        try fm.createDirectory(at: realDir, withIntermediateDirectories: false)
        let nested = realDir.appendingPathComponent("nested.txt")
        try write("nested context", to: nested)
        try fm.createSymbolicLink(at: linkedDir, withDestinationURL: realDir)
        rejects("selected symlink ancestor", {
            _ = try store.grant(urls: [linkedDir.appendingPathComponent("nested.txt")],
                                conversationID: otherID)
        }, where: { if case .unsafePath = $0 { return true }; return false })

        let oversized = fixture.appendingPathComponent("oversized.txt")
        try Data(repeating: 65, count: TemporaryContextStore.maximumBytesPerFile + 1).write(to: oversized)
        rejects("oversized source", {
            _ = try store.grant(urls: [oversized], conversationID: otherID)
        }, where: { if case .fileTooLarge = $0 { return true }; return false })
        let binary = fixture.appendingPathComponent("binary.txt")
        try Data([65, 0, 66]).write(to: binary)
        rejects("binary source", {
            _ = try store.grant(urls: [binary], conversationID: otherID)
        }, where: { if case .notRegularTextFile = $0 { return true }; return false })
        check(try store.load(conversationID: id).count == 2,
              "rejected grants preserve the existing conversation")
        check(try store.load(conversationID: otherID).isEmpty,
              "rejected grants create no other conversation cache")

        // A cache file with group/world-readable permissions must never be read.
        let file = cachePath(fixture, id)
        check(file.path.withCString { Darwin.chmod($0, mode_t(0o644)) } == 0,
              "fixture changes cache permissions")
        rejects("unsafe cache permissions", {
            _ = try store.load(conversationID: id)
        }, where: { $0 == .malformedCache })
        check(file.path.withCString { Darwin.chmod($0, mode_t(0o600)) } == 0,
              "fixture restores cache permissions")

        try store.revoke(conversationID: id)
        check(try store.load(conversationID: id).isEmpty && !fm.fileExists(atPath: file.path),
              "revoke removes cache and blocks further retrieval")

        _ = try store.grant(urls: [source], conversationID: id)
        clock = clock.addingTimeInterval(24 * 60 * 60)
        let atBoundary = try? store.load(conversationID: id)
        check((atBoundary?.isEmpty ?? true) && !fm.fileExists(atPath: file.path),
              "exact 24-hour boundary refuses and removes cache")

        _ = try store.grant(urls: [source], conversationID: otherID)
        let orphanFile = cachePath(fixture, otherID)
        clock = clock.addingTimeInterval(24 * 60 * 60)
        let restartedStore = try TemporaryContextStore(baseDirectory: cache, now: { clock })
        let restartedExcerpts = try restartedStore.load(conversationID: otherID)
        check(!fm.fileExists(atPath: orphanFile.path) && restartedExcerpts.isEmpty,
              "fresh store initialization sweeps an expired orphan cache")

        let partialWrite = cache.appendingPathComponent(".context-\(UUID().uuidString).tmp")
        try Data("interrupted write".utf8).write(to: partialWrite)
        check(partialWrite.path.withCString { Darwin.chmod($0, mode_t(0o600)) } == 0,
              "fixture creates owner-only interrupted write")
        try fm.setAttributes([.modificationDate: clock.addingTimeInterval(-61)],
                             ofItemAtPath: partialWrite.path)
        let activeWrite = cache.appendingPathComponent(".context-\(UUID().uuidString).tmp")
        try Data("active write".utf8).write(to: activeWrite)
        check(activeWrite.path.withCString { Darwin.chmod($0, mode_t(0o600)) } == 0,
              "fixture creates owner-only active write")
        try fm.setAttributes([.modificationDate: clock], ofItemAtPath: activeWrite.path)
        _ = try TemporaryContextStore(baseDirectory: cache, now: { clock })
        check(!fm.fileExists(atPath: partialWrite.path) &&
              fm.fileExists(atPath: activeWrite.path),
              "fresh store removes stale temp and preserves active temp")
        clock = clock.addingTimeInterval(61)
        _ = try TemporaryContextStore(baseDirectory: cache, now: { clock })
        check(!fm.fileExists(atPath: activeWrite.path),
              "active temp is removed after reaching cleanup age")

        _ = try store.grant(urls: [source], conversationID: id)
        clock = clock.addingTimeInterval(-60)
        rejects("clock regression", {
            _ = try store.load(conversationID: id)
        }, where: { $0 == .clockRegression })
        check(try store.load(conversationID: id).isEmpty && !fm.fileExists(atPath: file.path),
              "clock regression removes future-created cache")

        // A forged cache symlink must be rejected; never follow it to source.
        try fm.createSymbolicLink(at: file, withDestinationURL: source)
        rejects("symlink cache entry", {
            _ = try store.load(conversationID: id)
        }, where: { if case .unsafePath = $0 { return true }; return false })
        check(try String(contentsOf: source, encoding: .utf8).contains("alpha context"),
              "unsafe cache refusal leaves symlink target untouched")
        try store.revoke(conversationID: id)
        check(!fm.fileExists(atPath: file.path), "revoke unlinks an owned cache symlink")

        let clearFirstID = UUID().uuidString.lowercased()
        let clearSecondID = UUID().uuidString.lowercased()
        _ = try store.grant(urls: [source], conversationID: clearFirstID)
        _ = try store.grant(urls: [second], conversationID: clearSecondID)
        let decoy = cache.appendingPathComponent("notes-not-a-uuid.json")
        try write("keep this unrelated file", to: decoy)
        check(try store.load(conversationID: clearFirstID).count == 1 &&
              store.load(conversationID: clearSecondID).count == 1,
              "fixture has two distinct live grants before revokeAll")
        try store.revokeAll()
        check(try store.load(conversationID: clearFirstID).isEmpty &&
              store.load(conversationID: clearSecondID).isEmpty &&
              !fm.fileExists(atPath: cachePath(fixture, clearFirstID).path) &&
              !fm.fileExists(atPath: cachePath(fixture, clearSecondID).path),
              "revokeAll removes both UUID conversation grants")
        check(try String(contentsOf: decoy, encoding: .utf8) == "keep this unrelated file",
              "revokeAll leaves non-UUID decoy untouched")
        try fm.removeItem(at: decoy)

        let sourceFIFO = fixture.appendingPathComponent("source-pipe")
        check(sourceFIFO.path.withCString { Darwin.mkfifo($0, mode_t(0o600)) } == 0,
              "fixture creates source FIFO")
        rejects("selected FIFO", {
            _ = try store.grant(urls: [sourceFIFO], conversationID: id)
        }, where: {
            if case .notRegularTextFile = $0 { return true }
            return false
        })

        check(file.path.withCString { Darwin.mkfifo($0, mode_t(0o600)) } == 0,
              "fixture creates cache FIFO")
        rejects("cache FIFO", {
            _ = try store.load(conversationID: id)
        }, where: { $0 == .malformedCache })
    }

    static func main() {
        guard CommandLine.arguments == [CommandLine.arguments[0], "--selftest"] else {
            fputs("usage: TemporaryContextCLI --selftest\n", stderr)
            exit(2)
        }
        do { try run() }
        catch {
            failures += 1
            fputs("FAIL: harness stopped: \(error)\n", stderr)
        }
        print("TemporaryContextCLI: \(checks - failures)/\(checks) checks passed")
        exit(failures == 0 ? 0 : 1)
    }
}
