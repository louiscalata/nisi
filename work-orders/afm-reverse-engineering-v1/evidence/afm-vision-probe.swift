import Foundation
import CoreTransferable
import UniformTypeIdentifiers
import FoundationModels

@main
struct Probe {
    static func main() async throws {
        let url = URL(fileURLWithPath: "/tmp/afm-vision.png")
        let attachment: any PromptRepresentable = Transcript.Attachment.image(Transcript.ImageAttachment(imageURL: url))
        let prompt = Prompt(attachment)
        print("PASS: \(prompt.segments.count) segments")
    }
}
