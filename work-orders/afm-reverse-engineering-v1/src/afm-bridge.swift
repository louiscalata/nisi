// AFM bridge v0.1 — runtime capability report for the on-device model.
// Uses ONLY the public FoundationModels framework (macOS 27).
// Compile: xcrun swiftc -O -o afm-bridge afm-bridge.swift
import Foundation
import FoundationModels

@main
struct AFMBridge {
    static func main() async {
        var report: [String: Any] = [:]
        report["provider"] = "Apple Foundation Models (macOS 27, on-device)"
        report["model"] = "SystemLanguageModel.default"
        let model = SystemLanguageModel.default
        report["isAvailable"] = model.isAvailable
        // Capability introspection (macOS 27 LanguageModel conformance)
        let caps = model.capabilities
        report["capability.toolCalling"] = caps.contains(.toolCalling)
        report["capability.vision"] = caps.contains(.vision)
        report["capability.guidedGeneration"] = caps.contains(.guidedGeneration)
        report["capability.reasoning"] = caps.contains(.reasoning)
        report["useCases"] = ["general", "contentTagging"]
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]),
           let s = String(data: data, encoding: .utf8) {
            print(s)
        }
    }
}