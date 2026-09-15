// AFM bridge v0.5 — vision demo via the public API.
// Transcript.Attachment : PromptRepresentable; PromptBuilder accepts it.
//   AttachmentSegment init verified; ImageAttachment(imageURL:) verified.
// Compile: xcrun swiftc -parse-as-library -O -o afm-bridge-v5 afm-bridge-v5.swift
import Foundation
import FoundationModels

@main
struct AFMBridgeV5 {
    static func main() async throws {
        let model = SystemLanguageModel.default
        guard model.isAvailable else {
            print("{\"error\":\"SystemLanguageModel not available\"}")
            return
        }
        let url = URL(fileURLWithPath: "/tmp/afm-vision.png")
        let attachment = Transcript.Attachment.image(Transcript.ImageAttachment(imageURL: url))
        let session = LanguageModelSession(model: model)
        let response = try await session.respond(to: Prompt {
            "Describe this image in one short sentence."
            attachment
        })
        var out: [String: Any] = [
            "demo": "vision input",
            "model": "SystemLanguageModel.default",
            "image": url.path,
            "content": response.content,
            "usage.input": response.usage.input.totalTokenCount,
            "usage.output": response.usage.output.totalTokenCount,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys]),
           let s = String(data: data, encoding: .utf8) {
            print(s)
        }
    }
}