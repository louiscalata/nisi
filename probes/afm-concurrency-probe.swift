// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

// On-device model concurrency measurement. Local, no network, nothing leaves the Mac.
// Runs N requests concurrently on N SEPARATE sessions for N in 1...16 (52 measured
// requests per sweep plus one warm-up) and counts every refusal the API can return.
// The sequential baseline is a stable 0.25 s/request and is not re-measured here.
//
// Build (needs macOS 26+, Apple Silicon, Apple Intelligence enabled):
//   swiftc -O -parse-as-library -target arm64-apple-macos26.0 \
//     -o afm-concurrency-probe afm-concurrency-probe.swift
import Foundation
import FoundationModels

@available(macOS 26.0, *)
struct Probe {
    static let prompt = "Reply with exactly: ok"
    static let instructions = "You reply with a single lowercase word and nothing else."

    static func options() -> GenerationOptions {
        #if compiler(>=6.4)
        return GenerationOptions(samplingMode: .greedy, maximumResponseTokens: 4)
        #else
        return GenerationOptions(sampling: .greedy, maximumResponseTokens: 4)
        #endif
    }

    struct Outcome {
        let ok: Bool
        let code: String
        let seconds: Double
    }

    // One request on its own fresh session.
    static func one(_ model: SystemLanguageModel) async -> Outcome {
        let start = Date()
        do {
            let session = LanguageModelSession(model: model, tools: [], instructions: instructions)
            let response = try await session.respond(to: prompt, options: options())
            let text = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
            return Outcome(ok: true, code: text.isEmpty ? "EMPTY" : "OK", seconds: Date().timeIntervalSince(start))
        } catch let e as LanguageModelSession.GenerationError {
            return Outcome(ok: false, code: describe(e), seconds: Date().timeIntervalSince(start))
        } catch {
            let s = String(describing: error)
            let code = s.contains("concurrentRequests") ? "MODEL_CONCURRENT_REQUEST_REJECTED"
                     : s.contains("rateLimited") ? "MODEL_RATE_LIMITED"
                     : "OTHER(\(s.prefix(60)))"
            return Outcome(ok: false, code: code, seconds: Date().timeIntervalSince(start))
        }
    }

    static func describe(_ e: LanguageModelSession.GenerationError) -> String {
        switch e {
        case .exceededContextWindowSize: return "MODEL_CONTEXT_EXHAUSTED"
        case .assetsUnavailable: return "MODEL_ASSETS_UNAVAILABLE"
        case .guardrailViolation: return "MODEL_GUARDRAIL_REFUSAL"
        case .unsupportedGuide: return "MODEL_GUIDE_UNSUPPORTED"
        case .unsupportedLanguageOrLocale: return "MODEL_LANGUAGE_UNSUPPORTED"
        case .decodingFailure: return "MODEL_STRUCTURED_DECODING_FAILED"
        case .rateLimited: return "MODEL_RATE_LIMITED"
        case .concurrentRequests: return "MODEL_CONCURRENT_REQUEST_REJECTED"
        case .refusal: return "MODEL_REFUSED"
        @unknown default: return "MODEL_GENERATION_UNKNOWN_FAILURE"
        }
    }

    static func summarize(_ label: String, _ outcomes: [Outcome], wall: Double) {
        var counts: [String: Int] = [:]
        for o in outcomes { counts[o.code, default: 0] += 1 }
        let oks = outcomes.filter { $0.ok }.map { $0.seconds }
        let mean = oks.isEmpty ? 0 : oks.reduce(0,+) / Double(oks.count)
        let slowest = oks.max() ?? 0
        let tally = counts.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: " ")
        print(String(format: "%-26s wall=%6.2fs  ok=%2d/%2d  mean=%5.2fs  slowest=%5.2fs  %@",
                     (label as NSString).utf8String!, wall, oks.count, outcomes.count, mean, slowest, tally))
    }
}

@available(macOS 26.0, *)
func run() async {
    let model = SystemLanguageModel.default
    guard case .available = model.availability else {
        print("model unavailable: \(model.availability)"); return
    }
    print("SystemLanguageModel.default is available\n")

    // Warm up so model-load cost does not land inside a measured arm.
    let warm = await Probe.one(model)
    print(String(format: "warmup: %@ in %.2fs\n", warm.code, warm.seconds))

    for n in [1, 2, 3, 4, 6, 8, 12, 16] {
        // Concurrent arm only: the sequential baseline is a stable 0.25s/request,
        // so throughput is what distinguishes the concurrency levels.
        let c0 = Date()
        var con: [Probe.Outcome] = []
        await withTaskGroup(of: Probe.Outcome.self) { group in
            for _ in 0..<n { group.addTask { await Probe.one(model) } }
            for await o in group { con.append(o) }
        }
        let wall = Date().timeIntervalSince(c0)
        Probe.summarize("concurrent n=\(n)", con, wall: wall)
        let okCount = con.filter { $0.ok }.count
        print(String(format: "   throughput %.2f req/s   (sequential baseline ~4.0 req/s)", Double(okCount) / wall))
    }
}

@main
struct Main {
    static func main() async {
        if #available(macOS 26.0, *) { await run() } else { print("needs macOS 26+") }
    }
}
